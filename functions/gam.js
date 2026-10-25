// Google Ad Manager API (Beta) REST client.
// Flow per docs: create report -> run (async operation) -> poll operation -> fetchRows.
// https://developers.google.com/ad-manager/api/beta/reference/rest/v1/networks.reports
// Auth is passed in as an OAuth access token (see oauth.mjs) — this file is auth-agnostic.

const BASE = "https://admanager.googleapis.com/v1";

// ponytail: metric/dimension enum names differ by network type (AdSense-in-GAM vs AdX
// vs Ad Server). Defaults below suit an Ad Exchange network. Override via env if rejected
// or zero — verify the exact names against YOUR network in the API Explorer first. Revenue
// metrics come as doubleValue in currency units (not micros) in the GA v1 API.
// https://developers.google.com/ad-manager/api/beta/reference/rest/v1/Report#Metric
//
// KETIGA metrik revenue diminta, bukan AdX saja: satu network bisa dilayani lebih dari satu
// sumber permintaan, dan laporan yang hanya menanyakan satu di antaranya melaporkan sebagian
// uang sebagai seluruh uang. Ketiganya juga yang memecah kolom Earning per sumber di tabel ROI —
// kolom yang dulu berjudul "ADSENSE" untuk angka yang seluruhnya Ad Exchange.
const DIMENSIONS = (process.env.GAM_DIMENSIONS || "DATE,AD_UNIT_NAME").split(",");
const METRICS = (
  process.env.GAM_METRICS ||
  "IMPRESSIONS,CLICKS,AD_EXCHANGE_REVENUE,ADSENSE_REVENUE,AD_SERVER_REVENUE"
).split(",");

// MATA UANG LAPORAN DIMINTA, bukan dikonversi sendiri — sepola `ADSENSE_CURRENCY` di adsense.js.
// Empat dari delapan network kita menagih dalam USD, dan sampai 19 Sep 2026 angkanya dikalikan
// kurs open.er-api, yang cuma punya kurs HARI INI: satu bulan penuh yang ditulis ulang pada satu
// hari memakai satu kurs untuk 31 hari, sementara layar Ad Manager memakai kurs Google per hari.
// Agustus 2026 meleset −0,66% sampai +0,25% per network (−Rp 395 ribu bruto), padahal angka
// USD-nya sama persis. `reportDefinition.currencyCode` DITERIMA API v1 (dibuktikan ke produksi 19
// Sep 2026) dan menjawab sama sampai rupiah dengan layar Ad Manager. `GAM_CURRENCY=""` (kosong,
// bukan tidak diset) = ikut mata uang network, jalur lama lewat convertRowsToIdr.
export function gamReportCurrency() {
  return String(process.env.GAM_CURRENCY ?? "IDR")
    .trim()
    .toUpperCase();
}

// Dipisah dari pemanggilan HTTP-nya supaya bisa diuji tanpa jaringan.
export function reportDefinition(
  dimensions,
  metrics,
  dateRange,
  currencyCode = gamReportCurrency(),
) {
  return {
    dimensions,
    metrics,
    dateRange: { fixed: dateRange },
    reportType: "HISTORICAL",
    ...(currencyCode ? { currencyCode } : {}),
  };
}

// Metrik revenue -> nama sumbernya di baris kami. Yang tidak terdaftar tetap ikut dijumlahkan ke
// `earning` (lihat rowMetrics): total yang kurang lebih berbahaya daripada rincian yang kurang.
const REVENUE_SOURCES = {
  AD_EXCHANGE_REVENUE: "adx",
  ADSENSE_REVENUE: "adsense",
  AD_SERVER_REVENUE: "adServer",
};

async function api(path, accessToken, { method = "GET", body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new Error(`GAM ${method} ${path} -> ${res.status}: ${data.error?.message || text}`);
  }
  return data;
}

// List every network the credential can access.
// https://developers.google.com/ad-manager/api/beta/reference/rest/v1/networks/list
export async function listNetworks(token) {
  const out = [];
  let pageToken;
  do {
    const page = await api(
      `/networks?pageSize=1000${pageToken ? `&pageToken=${pageToken}` : ""}`,
      token,
    );
    out.push(...(page.networks || []));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return out; // each: { name, networkCode, displayName, propertyCode, currencyCode, ... }
}

// List every site registered on a network — what GAM shows under Inventory → Sites, subsites
// included. On an Ad Exchange network this is the authoritative domain list: its ad unit tree is
// often just the default "ca-pub-…" nodes, which carry no hostname at all.
// https://developers.google.com/ad-manager/api/beta/reference/rest/v1/networks.sites/list
export async function listSites(networkCode, token) {
  const out = [];
  let pageToken;
  do {
    const page = await api(
      `/networks/${networkCode}/sites?pageSize=1000${pageToken ? `&pageToken=${pageToken}` : ""}`,
      token,
    );
    out.push(...(page.sites || []));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return out; // each: { name, url, approvalStatus, childNetworkCode, ... }
}

// List every ad unit in a network. This is configuration, not report data, so it also finds
// sites that earned nothing yesterday — which a report never returns.
// https://developers.google.com/ad-manager/api/beta/reference/rest/v1/networks.adUnits/list
export async function listAdUnits(networkCode, token) {
  const out = [];
  let pageToken;
  do {
    const page = await api(
      `/networks/${networkCode}/adUnits?pageSize=1000${pageToken ? `&pageToken=${pageToken}` : ""}`,
      token,
    );
    out.push(...(page.adUnits || []));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return out; // each: { name, adUnitCode, displayName, parentAdUnit, status, ... }
}

async function poll(operationName, token, tries = 30) {
  for (let i = 0; i < tries; i++) {
    const op = await api(`/${operationName}`, token);
    if (op.done) {
      if (op.error) throw new Error(`GAM report failed: ${op.error.message}`);
      return op.response;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("GAM report timed out");
}

/**
 * Run a report for one network over a date range and return aggregated totals.
 * @param {string} networkCode
 * @param {{startDate: {year,month,day}, endDate: {year,month,day}}} dateRange
 * @param {string} token OAuth access token with the admanager scope
 */
// --- Hari WIB untuk network yang zonanya bukan WIB ----------------------------------------------
//
// Laporan GAM selalu dalam zona NETWORK: "22 Sep" versi sheetz.us (Asia/Karachi) mulai pukul 02:00
// WIB, dan versi bispdailyupdates.pk (America/Los_Angeles) pukul 14:00 WIB — earning hari berjalan
// dua sampai empat belas jam tertinggal dari belanja Meta di baris ROI yang sama. Meminta WIB
// langsung (`timeZoneSource: PROVIDED`) DITOLAK untuk metrik Ad Exchange
// (`REPORT_ERROR_CONSTRAINTS_INCOMPATIBILITY`, dibuktikan ke produksi 22 Sep 2026); `HOUR` tidak.
// Jadi laporannya diminta per JAM network, dan tiap jam — satu titik waktu yang pasti — dipetakan
// ke tanggal WIB-nya. Keluarannya berbentuk sama persis dengan laporan biasa, jadi hilirnya tidak
// tahu apa pun tentang zona.

// Zona tujuan. Salinan `syncTimeZone()` di sync-core.js: sync-core mengimpor berkas ini, dan arah
// sebaliknya menutup lingkaran impor.
function targetTimeZone() {
  return process.env.SYNC_TIMEZONE || "Asia/Jakarta";
}

const networkZones = new Map();

// Zona network, sekali per proses. Yang gagal dibaca TIDAK di-cache dan tidak ditebak WIB: jatuh ke
// WIB berarti diam-diam kembali ke hari network yang salah label.
async function networkTimeZone(networkCode, token) {
  if (!networkZones.has(networkCode)) {
    const net = await api(`/networks/${networkCode}`, token);
    networkZones.set(networkCode, String(net.timeZone || ""));
  }
  return networkZones.get(networkCode);
}

function dateKeyIn(ms, timeZone) {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date(ms)); // YYYY-MM-DD
}

// Selisih zona terhadap UTC (ms) pada satu titik waktu.
function zoneOffset(ms, timeZone) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(new Date(ms))
      .map((x) => [x.type, x.value]),
  );
  return (
    Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000
  );
}

// "20260922" + jam 5 dalam `timeZone` -> epoch ms. Dua putaran supaya jam di sekitar pergantian DST
// memakai offset jam itu sendiri, bukan offset tengah malamnya.
// ponytail: jam yang terulang saat DST mundur (LA, awal Nov) dijawab GAM sebagai satu baris dan
// jatuh ke offset pertamanya — selisihnya satu jam, sekali setahun, di batas hari yang jauh dari WIB.
function hourInstant(dateValue, hour, timeZone) {
  const d = String(dateValue);
  const guess = Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), Number(hour));
  const first = guess - zoneOffset(guess, timeZone);
  return guess - zoneOffset(first, timeZone);
}

function shiftGamDay({ year, month, day }, days) {
  const t = new Date(Date.UTC(year, month - 1, day + days));
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

const dayKey = ({ year, month, day }) =>
  `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

// Rentang yang diminta ke network: sehari lebih lebar di KEDUA ujung, apa pun arah selisihnya — hari
// WIB selalu jatuh di dalam tiga hari network yang mengapitnya. endDate di masa depan diterima GAM.
export function widenedRange(range) {
  return { startDate: shiftGamDay(range.startDate, -1), endDate: shiftGamDay(range.endDate, 1) };
}

/**
 * Baris mentah berdimensi [DATE, HOUR, ...sisanya] dalam zona network -> baris mentah berdimensi
 * [DATE WIB, ...sisanya] (atau [...sisanya] kalau `keepDate` false), metriknya dijumlahkan per
 * kombinasi, dan jam di luar `range` (tanggal WIB) dibuang. Bentuknya tetap bentuk jawaban API,
 * jadi `rowMetrics`/`aggregate` membacanya tanpa tahu apa-apa.
 */
export function rekeyToSyncDays(rows, networkZone, range, keepDate, targetZone = targetTimeZone()) {
  const from = dayKey(range.startDate);
  const until = dayKey(range.endDate);
  const merged = new Map();
  for (const row of rows) {
    const [date, hour, ...rest] = (row.dimensionValues || []).map((v) =>
      v?.stringValue != null ? v.stringValue : String(v?.intValue ?? ""),
    );
    const day = dateKeyIn(hourInstant(date, hour, networkZone), targetZone);
    if (day < from || day > until) continue;
    const keys = keepDate ? [day.replaceAll("-", ""), ...rest] : rest;
    const id = JSON.stringify(keys);
    const values = (row.metricValueGroups?.[0]?.primaryValues || []).map(numeric);
    const prev = merged.get(id);
    if (!prev) {
      merged.set(id, { keys, values });
      continue;
    }
    values.forEach((v, i) => {
      prev.values[i] = (prev.values[i] || 0) + v;
    });
  }
  return [...merged.values()].map(({ keys, values }) => ({
    dimensionValues: keys.map((stringValue) => ({ stringValue })),
    metricValueGroups: [{ primaryValues: values.map((doubleValue) => ({ doubleValue })) }],
  }));
}

// --- Rasio penayangan Ad Exchange per JAM WIB ---------------------------------------------------
//
// `rekeyToSyncDays` di atas MENJUMLAHKAN jam-jam ke hari WIB dan membuang jamnya; tab Rasio
// Penayangan justru butuh jamnya. Jadi tiap jam network dipetakan ke tanggal DAN jam WIB-nya, dengan
// `hourInstant` yang sama. `AD_REQUESTS` (Total panggilan iklan) DITOLAK bersama HOUR (dibuktikan
// ke produksi 24 Sep 2026); pasangan AdX ini diterima dan cocok sampai angka terakhir dengan layar
// Laporan interaktif Ad Manager.
export const FILL_RATE_METRICS = ["AD_EXCHANGE_TOTAL_REQUESTS", "AD_EXCHANGE_IMPRESSIONS"];

function hourKeyIn(ms, timeZone) {
  const hour = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    hourCycle: "h23",
  }).format(new Date(ms));
  return hour.padStart(2, "0");
}

export function wibHourRows(rows, networkZone, range, targetZone = targetTimeZone()) {
  const from = dayKey(range.startDate);
  const until = dayKey(range.endDate);
  const merged = new Map();
  for (const row of rows || []) {
    const [date, hour, site = ""] = (row.dimensionValues || []).map((v) =>
      v?.stringValue != null ? v.stringValue : String(v?.intValue ?? ""),
    );
    const at = hourInstant(date, hour, networkZone || targetZone);
    const day = dateKeyIn(at, targetZone);
    if (day < from || day > until) continue;
    const wibHour = hourKeyIn(at, targetZone);
    const [req = 0, imp = 0] = (row.metricValueGroups?.[0]?.primaryValues || []).map(numeric);
    const id = `${day}|${wibHour}|${site}`;
    const prev = merged.get(id);
    if (prev) {
      prev.req += req;
      prev.imp += imp;
    } else {
      merged.set(id, { date: day, hour: wibHour, site, req, imp });
    }
  }
  return [...merged.values()];
}

async function fetchRows(networkCode, dateRange, token, dimensions, metrics, currencyCode) {
  const zone = await networkTimeZone(networkCode, token);
  if (!zone || zone === targetTimeZone()) {
    return fetchRawRows(networkCode, dateRange, token, dimensions, metrics, currencyCode);
  }
  const keepDate = dimensions[0] === "DATE";
  const rest = keepDate ? dimensions.slice(1) : dimensions;
  const hourly = metrics.filter((m) => !NOT_HOURLY.has(String(m).trim().toUpperCase()));
  const rows = await fetchRawRows(
    networkCode,
    widenedRange(dateRange),
    token,
    ["DATE", "HOUR", ...rest],
    hourly,
    currencyCode,
  );
  return rekeyToSyncDays(alignMetrics(rows, hourly, metrics), zone, dateRange, keepDate);
}

// Metrik yang DITOLAK Ad Manager bersama dimensi HOUR (REPORT_ERROR_CONSTRAINTS_INCOMPATIBILITY,
// diuji satu per satu 22 Sep 2026). Dilepas dari laporan per jam dan dijawab 0 di posisinya.
// ponytail: aman selama network ber-zona non-WIB tidak punya pendapatan Ad Server — keempatnya Rp 0
// April–Sep 2026. Kalau suatu hari ada, laporan DATE terpisah untuk metrik ini yang menambalnya.
const NOT_HOURLY = new Set(["AD_SERVER_REVENUE"]);

// Nilai baris yang diminta dengan `asked` ditata ulang ke urutan `wanted` (yang dibaca `rowMetrics`
// lewat posisi METRICS); yang tidak diminta jadi 0.
function alignMetrics(rows, asked, wanted) {
  if (asked.length === wanted.length) return rows;
  return rows.map((row) => {
    const values = row.metricValueGroups?.[0]?.primaryValues || [];
    const primaryValues = wanted.map((m) => {
      const i = asked.indexOf(m);
      return i < 0 ? { doubleValue: 0 } : values[i];
    });
    return { ...row, metricValueGroups: [{ primaryValues }] };
  });
}

async function fetchRawRows(networkCode, dateRange, token, dimensions, metrics, currencyCode) {
  const created = await api(`/networks/${networkCode}/reports`, token, {
    method: "POST",
    body: { reportDefinition: reportDefinition(dimensions, metrics, dateRange, currencyCode) },
  });
  try {
    const runOp = await api(`/${created.name}:run`, token, { method: "POST" });
    const result = await poll(runOp.name, token);
    const resultName = result?.reportResult || result?.name || `${created.name}/results/latest`;
    const rows = [];
    let pageToken;
    do {
      const page = await api(
        `/${resultName}:fetchRows${pageToken ? `?pageToken=${pageToken}` : ""}`,
        token,
      );
      rows.push(...(page.rows || []));
      pageToken = page.nextPageToken;
    } while (pageToken);
    return rows;
  } finally {
    // ponytail: created reports are persistent; delete so they don't pile up.
    // Ignore failure — a leaked report is harmless, a thrown cleanup error hides the real one.
    await api(`/${created.name}`, token, { method: "DELETE" }).catch(() => {});
  }
}

// Network-level totals (default dimensions/metrics).
// `reportCurrency` ditempel HANYA saat mata uangnya diminta — bentuk yang sama dengan baris AdSense.
// Itu yang membuat convertRowsToIdr berhenti mengalikan angka IDR dengan kurs USD network-nya;
// tanpa field ini, rupiah dari Google dikali 17.765 lagi.
function withCurrency(value, currencyCode) {
  return currencyCode ? { ...value, reportCurrency: currencyCode } : value;
}

export async function runNetworkReport(networkCode, dateRange, token) {
  const currency = gamReportCurrency();
  return withCurrency(
    aggregate(await fetchRows(networkCode, dateRange, token, DIMENSIONS, METRICS, currency)),
    currency,
  );
}

// Per-dimension breakdown: one entry per dimension value (e.g. per ad unit / site).
// Returns [{ key, impressions, clicks, earning }] — `key` is the dimension's string value.
export async function runNetworkReportByDimension(networkCode, dateRange, token, dimension) {
  const rows = await runNetworkReportByDimensions(networkCode, dateRange, token, [dimension]);
  return rows.map(({ keys, ...metrics }) => ({ key: keys[0] || "", ...metrics }));
}

// Breakdown across several dimensions at once: one entry per combination, `keys` in the order the
// dimensions were asked for. ROI per country needs this — a country on its own says nothing about
// which subdomain earned it, and the two have to be reported together to be joined at all.
// Returns [{ keys: [...], impressions, clicks, earning }].
export async function runNetworkReportByDimensions(networkCode, dateRange, token, dimensions) {
  const currency = gamReportCurrency();
  const rows = await fetchRows(networkCode, dateRange, token, dimensions, METRICS, currency);
  return rows.map((row) =>
    withCurrency({ keys: dimensionValues(row), ...rowMetrics(row) }, currency),
  );
}

// Satu laporan per network: DATE, HOUR, SITE × dua metrik AdX, rentangnya dilebarkan sehari di kedua
// ujung (hari WIB selalu jatuh di dalam tiga hari network yang mengapitnya), lalu dipetakan ke jam
// WIB. Tanpa `currencyCode`: kedua metriknya hitungan, bukan uang.
export async function runNetworkHourlyFillRate(networkCode, dateRange, token) {
  const zone = await networkTimeZone(networkCode, token);
  const rows = await fetchRawRows(
    networkCode,
    widenedRange(dateRange),
    token,
    ["DATE", "HOUR", "SITE"],
    FILL_RATE_METRICS,
    "",
  );
  return wibHourRows(rows, zone, dateRange);
}

function dimensionValues(row) {
  return (row.dimensionValues || []).map((v) =>
    v?.stringValue != null ? v.stringValue : v?.intValue != null ? String(v.intValue) : "",
  );
}

// Parse one row's metrics. Dipetakan lewat NAMA metriknya, bukan posisi tetap: METRICS bisa
// diganti lewat GAM_METRICS, dan parser yang membaca "kolom ketiga" akan diam-diam menaruh
// jumlah klik di kolom uang begitu urutannya berubah.
//
// `earning` adalah JUMLAH seluruh metrik revenue yang diminta, dan rinciannya dibawa terpisah
// (adx/adsense/adServer). Sebelumnya earning = AD_EXCHANGE_REVENUE saja, jadi network yang
// sebagiannya dilayani AdSense akan melaporkan ROI dari sebagian pendapatannya sendiri.
function rowMetrics(row) {
  const values = row.metricValueGroups?.[0]?.primaryValues || [];
  const out = { impressions: 0, clicks: 0, earning: 0, adx: 0, adsense: 0, adServer: 0 };

  METRICS.forEach((metric, index) => {
    const name = String(metric || "")
      .trim()
      .toUpperCase();
    const value = numeric(values[index]);
    if (name === "IMPRESSIONS") out.impressions = value;
    else if (name === "CLICKS") out.clicks = value;
    else if (name.endsWith("REVENUE")) {
      out.earning += value;
      const source = REVENUE_SOURCES[name];
      if (source) out[source] = value;
    }
  });

  return out;
}

// Sum METRICS across all rows.
export function aggregate(rows) {
  const totals = { impressions: 0, clicks: 0, earning: 0, adx: 0, adsense: 0, adServer: 0 };
  for (const row of rows) {
    const m = rowMetrics(row);
    totals.impressions += m.impressions;
    totals.clicks += m.clicks;
    totals.earning += m.earning;
    totals.adx += m.adx;
    totals.adsense += m.adsense;
    totals.adServer += m.adServer;
  }
  totals.pageRpm = totals.impressions ? (totals.earning / totals.impressions) * 1000 : 0;
  totals.cpc = totals.clicks ? totals.earning / totals.clicks : 0;
  // Round money to sensible precision so we don't persist 12-decimal floats.
  totals.earning = round(totals.earning, 2);
  totals.adx = round(totals.adx, 2);
  totals.adsense = round(totals.adsense, 2);
  totals.adServer = round(totals.adServer, 2);
  totals.pageRpm = round(totals.pageRpm, 2);
  totals.cpc = round(totals.cpc, 4);
  return totals;
}

function numeric(value) {
  if (value == null) return 0;
  // GA v1 ReportValue has no micros field — money comes as doubleValue in currency units.
  const n = Number(value.doubleValue ?? value.intValue ?? value.stringValue ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function round(n, places) {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}
