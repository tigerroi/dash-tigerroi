import { formatDayMonth } from "./formatDate.js";

/**
 * Tab Rasio Penayangan — sisi browser. Node-nya ditulis `functions/sync-fill-rate.mjs`:
 * `dashboard/fillRate/{YYYY-MM-DD}/{siteKey}/h{HH} = { req, imp, partial? }`.
 *
 * `decodeSiteKey` adalah CERMIN `siteKey` di functions/fill-rate-core.js (titik jadi koma, ember
 * `_net_{domain}` untuk permintaan tanpa situs). Dijaga fillRate.test.mjs, yang mengimpor berkas
 * seberangnya — beda sedikit, satu domain berbunyi dua nama di tab ini tanpa error di mana pun.
 */
export const FILL_RATE_PATH = "dashboard/fillRate";
export const FILL_RATE_STATUS_PATH = "dashboard/fillRateStatus";
export const NET_PREFIX = "_net_";
export const TOP_SERIES = 8;
export const OTHER_LABEL = "Lainnya";
// Ujung rentang yang dikosongkan dijepit: node ini tidak pernah dipangkas, dan "semua tanggal"
// berarti unduhan yang tumbuh tiap hari.
export const MAX_OPEN_DAYS = 31;

const OPERATION_ZONE = "Asia/Jakarta";
const NET_LABEL = "(tanpa situs) ";

export function decodeSiteKey(key) {
  const text = String(key || "");
  if (text.startsWith(NET_PREFIX)) {
    const domain = text.slice(NET_PREFIX.length).replace(/,/g, ".");
    // Tanpa titik = kode network (akun tanpa nama domain), bukan domain.
    return { host: "", netDomain: domain.includes(".") ? domain : "" };
  }
  return { host: text.replace(/,/g, "."), netDomain: "" };
}

export const netLabel = (domain) => `${NET_LABEL}${domain || "?"}`;

export function fillRateRows(tree) {
  const rows = [];
  for (const [date, sites] of Object.entries(tree || {})) {
    for (const [key, hours] of Object.entries(sites || {})) {
      const { host, netDomain } = decodeSiteKey(key);
      const subDomain = host || netLabel(netDomain);
      for (const [hourKey, leaf] of Object.entries(hours || {})) {
        rows.push({
          date,
          hour: hourKey.replace(/^h/, ""),
          subDomain,
          netDomain,
          req: Number(leaf?.req) || 0,
          imp: Number(leaf?.imp) || 0,
          partial: leaf?.partial === true,
        });
      }
    }
  }
  return rows;
}

// Indeks pemilik (subDomainOwnerIndex) yang juga mengenal ember network: domainnya tertulis di
// labelnya sendiri, dan ia tidak punya PIC — memilih advertiser membuangnya, karena ia bukan milik
// siapa pun.
export function fillRateOwners(owners) {
  const isNet = (name) => String(name || "").startsWith(NET_LABEL);
  return {
    domainOf: (name) =>
      isNet(name)
        ? String(name).slice(NET_LABEL.length).replace(/^\?$/, "")
        : owners.domainOf(name),
    picOf: (name, pic) => (isNet(name) ? "" : owners.picOf(name, pic)),
  };
}

// Permintaan 0 tidak punya rasio: null memutus garis Recharts, sepola getNetPercentage.
export function rateOf(req, imp) {
  return req > 0 ? (imp / req) * 100 : null;
}

export function formatRate(value) {
  return Number.isFinite(value)
    ? `${value.toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`
    : "-";
}

/**
 * Deret grafik: satu titik per jam, satu seri per rincian (domain atau subdomain). Rasio tiap seri
 * dan total dihitung dari JUMLAH (Σimp ÷ Σreq), bukan rata-rata rasio. Rincian dibatasi 8 teratas
 * menurut permintaan; sisanya satu seri "Lainnya".
 */
export function fillRateSeries(rows, owners, level) {
  const groupOf = (row) =>
    level === "domain"
      ? owners.domainOf(row.subDomain) || "(domain tidak diketahui)"
      : row.subDomain;

  const volume = new Map();
  for (const row of rows) volume.set(groupOf(row), (volume.get(groupOf(row)) || 0) + row.req);
  const ranked = [...volume.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name]) => name);
  const labels =
    ranked.length > TOP_SERIES ? [...ranked.slice(0, TOP_SERIES), OTHER_LABEL] : ranked;
  const series = labels.map((label, index) => ({ id: `s${index}`, label }));
  const idOf = new Map(series.map((item) => [item.label, item.id]));

  const slots = new Map();
  for (const row of rows) {
    const slot = `${row.date}T${row.hour}`;
    const point = slots.get(slot) || {
      slot,
      date: row.date,
      hour: row.hour,
      partial: false,
      totalReq: 0,
      totalImp: 0,
    };
    slots.set(slot, point);
    const id = idOf.get(groupOf(row)) || idOf.get(OTHER_LABEL);
    point[`${id}Req`] = (point[`${id}Req`] || 0) + row.req;
    point[`${id}Imp`] = (point[`${id}Imp`] || 0) + row.imp;
    point.totalReq += row.req;
    point.totalImp += row.imp;
    if (row.partial) point.partial = true;
  }

  const points = [...slots.values()].sort((a, b) => a.slot.localeCompare(b.slot));
  for (const point of points) {
    for (const { id } of series) {
      point[`${id}Req`] = point[`${id}Req`] || 0;
      point[`${id}Imp`] = point[`${id}Imp`] || 0;
      point[`${id}Rate`] = rateOf(point[`${id}Req`], point[`${id}Imp`]);
    }
    point.totalRate = rateOf(point.totalReq, point.totalImp);
  }
  return { series, points };
}

// Ruas jam `partial` digambar putus-putus. Titik tepat sebelum titik partial ikut ruas putus-putus
// supaya kedua ruas bersambung — aturan yang sama dengan `withRoiSeries` di RoiCurveChart.
export function dashedSplit(points, keys) {
  return points.map((point, index) => {
    const next = points[index + 1];
    const dashed = point.partial || (next?.partial === true && !point.partial);
    const out = { ...point };
    for (const key of keys) {
      out[`${key}Solid`] = point.partial ? null : point[key];
      out[`${key}Dashed`] = dashed ? point[key] : null;
    }
    return out;
  });
}

export function siteTotals(rows, owners, registered) {
  const bySite = new Map();
  for (const row of rows) {
    const total = bySite.get(row.subDomain) || {
      subDomain: row.subDomain,
      domain: owners.domainOf(row.subDomain),
      pic: owners.picOf(row.subDomain),
      req: 0,
      imp: 0,
      net: Boolean(row.netDomain) || row.subDomain.startsWith(NET_LABEL),
    };
    total.req += row.req;
    total.imp += row.imp;
    bySite.set(row.subDomain, total);
  }
  return [...bySite.values()]
    .map(({ net, ...total }) => ({
      ...total,
      rate: rateOf(total.req, total.imp),
      unregistered: !net && !registered.has(total.subDomain.toLowerCase()),
    }))
    .sort((a, b) => b.req - a.req || a.subDomain.localeCompare(b.subDomain));
}

function wibDateKey(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: OPERATION_ZONE }).format(now);
}

function shiftKey(key, days) {
  const base = new Date(`${key}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

// "Hari ini" versi OPERASI (WIB), bukan jam perangkat — baris ditulis dengan tanggal WIB.
export function wibTodayRange(now = new Date()) {
  const key = wibDateKey(now);
  return { from: key, to: key };
}

export function boundedRange({ from = "", to = "" } = {}, now = new Date()) {
  const end = to || wibDateKey(now);
  return { from: from || shiftKey(end, -(MAX_OPEN_DAYS - 1)), to: end };
}

export function slotLabel(point, multiDay) {
  const hour = `${point.hour}:00`;
  return multiDay ? `${formatDayMonth(point.date)} ${hour}` : hour;
}
