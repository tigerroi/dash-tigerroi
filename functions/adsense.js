// AdSense Management API v2 REST client.
// https://developers.google.com/adsense/management/reference/rest/v2/accounts.reports/generate
// Auth is passed in as an OAuth access token (see oauth.mjs) — this file is auth-agnostic.
//
// KENAPA ADA DUA KLIEN. Ini bukan varian dari gam.js: Ad Manager dan AdSense adalah dua API
// dengan dua identitas (`networkCode` vs `accounts/pub-…`), dua nama enum, dan dua bentuk
// jawaban. Yang disamakan justru keluarannya — `runAccountReportByDimensions` mengembalikan
// baris berbentuk sama persis dengan `runNetworkReportByDimensions` di gam.js — supaya seluruh
// hilirnya (gamRowsByDay, pencocokan nama site, collectCountryEarning, roiReportUpdate) tidak
// perlu tahu laporan itu datang dari mana.

const BASE = "https://adsense.googleapis.com/v2";

// ESTIMATED_EARNINGS, bukan TOTAL_EARNINGS: yang kedua sudah dipotong bagian penerbit lain pada
// akun host, dan tidak tersedia di semua akun. Ganti lewat env kalau akun menolaknya.
const METRICS = (process.env.ADSENSE_METRICS || "ESTIMATED_EARNINGS,IMPRESSIONS,CLICKS").split(",");

/**
 * Nama dimensi Ad Manager -> padanannya di AdSense.
 *
 * Sisi pemanggil bicara dalam enum GAM (`SITE`, `DATE`, `COUNTRY_CODE`) karena itu yang tertulis
 * di env dan di sync-subdomains. Yang tidak terdaftar dipakai apa adanya — nama enum yang sama
 * ada di kedua API untuk sebagian besar dimensi, dan menebak-nebak terjemahan justru menutupi
 * pesan error asli dari Google.
 *
 * `SITE` -> `DOMAIN_NAME`: "host tempat iklan ditayangkan", jadi nilainya hostname penuh
 * ("wealth.example.com"), yang memang bentuk `subDomains.name`. `OWNED_SITE_DOMAIN_NAME` hanya
 * memberi domain terverifikasi — seluruh subdomain akan menggumpal jadi satu baris.
 */
const DIMENSION_ALIASES = {
  SITE: "DOMAIN_NAME",
  SITE_NAME: "DOMAIN_NAME",
  AD_UNIT_NAME: "AD_UNIT_NAME",
  DATE: "DATE",
  COUNTRY_CODE: "COUNTRY_CODE",
  COUNTRY_NAME: "COUNTRY_NAME",
};

export function adsenseDimension(name) {
  const key = String(name || "")
    .trim()
    .toUpperCase();
  return DIMENSION_ALIASES[key] || key;
}

// "ca-pub-123" / "pub-123" / "accounts/pub-123" -> "accounts/pub-123".
// Record GAM menyimpan propertyCode berawalan "ca-", sedangkan API AdSense tidak mengenalnya.
export function accountResourceName(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.startsWith("accounts/")) return raw;
  return `accounts/${raw.replace(/^ca-/, "")}`;
}

async function api(path, accessToken) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new Error(`AdSense GET ${path} -> ${res.status}: ${data.error?.message || text}`);
  }
  return data;
}

// Setiap akun AdSense yang bisa dilihat kredensial ini.
// https://developers.google.com/adsense/management/reference/rest/v2/accounts/list
export async function listAccounts(token) {
  const out = [];
  let pageToken;
  do {
    const page = await api(
      `/accounts?pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`,
      token,
    );
    out.push(...(page.accounts || []));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return out; // each: { name: "accounts/pub-…", displayName, timeZone: {id}, currencyCode }
}

// Satu akun apa adanya. Yang dicari darinya cuma `state` (READY / NEEDS_ATTENTION / CLOSED) —
// satu-satunya tempat di kedua API ini yang mengatakan sebuah akun sudah ditutup Google.
// https://developers.google.com/adsense/management/reference/rest/v2/accounts/get
export async function getAccount(accountName, token) {
  return api(`/${accountResourceName(accountName)}`, token);
}

/**
 * Notif akun — daftar yang sama persis dengan pemberitahuan di dashboard AdSense, merah maupun
 * bukan. Ini satu-satunya sumber untuk "Iklan Dibatasi"; Ad Manager API tidak punya padanannya.
 *
 * TANPA `pageSize`, berbeda dari tiap list lain di berkas ini — dan itu bukan kelalaian: endpoint
 * ini MENOLAK parameternya ("Unknown name pageSize: Cannot bind query parameter", HTTP 400) dan
 * mengembalikan seluruh alert sekaligus tanpa `nextPageToken`.
 * https://developers.google.com/adsense/management/reference/rest/v2/accounts.alerts/list
 */
export async function listAlerts(accountName, token) {
  const data = await api(`/${accountResourceName(accountName)}/alerts`, token);
  return data.alerts || [];
}

/**
 * Pembayaran akun: satu baris `payments/unpaid` (saldo berjalan) plus pembayaran yang sudah cair.
 *
 * Ini SATU-SATUNYA endpoint di kedua API yang menyebutkan saldo, dan ia dipakai halaman GAM juga —
 * Ad Manager API v1 tidak punya resource pembayaran sama sekali (lihat account-balance.js).
 *
 * Riwayatnya TIDAK lengkap: tiap akun cuma mengembalikan pembayaran TERAKHIR, walau /payouts
 * mencatat pencairan tiap bulan. Cukup untuk saldo; tidak cukup untuk Total Payout, dan yang
 * menyimpulkan totalnya dari sini akan melaporkan satu bulan sebagai seumur hidup akun itu.
 * https://developers.google.com/adsense/management/reference/rest/v2/accounts.payments/list
 */
export async function listPayments(accountName, token) {
  const data = await api(`/${accountResourceName(accountName)}/payments`, token);
  return data.payments || [];
}

// Situs yang terdaftar pada satu akun AdSense — padanan listSites() di gam.js, dipakai impor
// domain/subdomain. Ini konfigurasi, bukan laporan, jadi situs yang kemarin tidak menghasilkan
// apa pun tetap terbawa.
// https://developers.google.com/adsense/management/reference/rest/v2/accounts.sites/list
export async function listSites(accountName, token) {
  const account = accountResourceName(accountName);
  const out = [];
  let pageToken;
  do {
    const page = await api(
      `/${account}/sites?pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`,
      token,
    );
    out.push(...(page.sites || []));
    pageToken = page.nextPageToken;
  } while (pageToken);
  // Disamakan bentuknya dengan gam.js listSites: { url, ... }. Di AdSense field-nya `domain`.
  return out.map((site) => ({ ...site, url: site.url || site.domain || "" }));
}

/**
 * Ad unit milik klien AFC sebuah akun (`ca-pub-…`) — dipakai inject AdSense untuk memastikan slot yang
 * ditempel superadmin benar-benar ada di akun itu.
 *
 * Membaca saja. `adunits.create` ada di API yang sama tapi tertutup untuk project di luar AdSense for
 * Platforms, jadi unit barunya tetap lahir di halaman AdSense.
 * https://developers.google.com/adsense/management/reference/rest/v2/accounts.adclients.adunits/list
 */
export async function listAdUnits(accountName, token) {
  const account = accountResourceName(accountName);
  const client = `${account}/adclients/ca-${account.split("/").pop()}`;
  const out = [];
  let pageToken;
  do {
    const page = await api(
      `/${client}/adunits?pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`,
      token,
    );
    out.push(...(page.adUnits || []));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return out; // each: { name: ".../adunits/{slot}", displayName, state, contentAdsSettings: { size, type } }
}

function dateParams(prefix, day) {
  return `${prefix}.year=${day.year}&${prefix}.month=${day.month}&${prefix}.day=${day.day}`;
}

/**
 * Satu laporan untuk satu akun, satu rentang.
 *
 * `reportingTimeZone` sengaja tidak dikirim, jadi Google memakai zona waktu akun AdSense-nya.
 * Pilihannya cuma itu atau GOOGLE_TIME_ZONE (Amerika/Los_Angeles) — tidak ada opsi "Asia/Jakarta"
 * untuk akun yang zonanya bukan itu. Akibatnya nyata dan tidak bisa dihilangkan dari sini: kalau
 * zona akun bukan WIB, "8 Agustus" versi AdSense bukan "8 Agustus" versi dashboard. Karena itu
 * zona akun ikut disimpan di record (lihat sync-adsense.mjs) supaya selisihnya terlihat, bukan
 * ditebak.
 */
async function fetchReport(accountName, dateRange, token, dimensions, currencyCode) {
  const account = accountResourceName(accountName);
  const params = [
    "dateRange=CUSTOM",
    dateParams("startDate", dateRange.startDate),
    dateParams("endDate", dateRange.endDate),
    ...dimensions.map((d) => `dimensions=${encodeURIComponent(adsenseDimension(d))}`),
    ...METRICS.map((m) => `metrics=${encodeURIComponent(String(m).trim())}`),
    "limit=100000",
  ];
  // Laporan diminta LANGSUNG dalam rupiah, dan itu keputusan yang disengaja.
  //
  // Alternatifnya — meminta mata uang akun lalu mengalikan dengan kurs harian — kalah di dua hal
  // sekaligus untuk angka sekecil ini: API membulatkan uang ke dua desimal, jadi USD 0,76 untuk
  // satu hari sudah membawa ralat ±0,7% sebelum dikali apa pun, dan kurs yang tersedia gratis cuma
  // kurs HARI INI — hari-hari lampau dikonversi dengan kurs yang salah dan tidak akan pernah cocok
  // dengan layar AdSense. Konversi Google sendiri memakai kurs hari itu.
  //
  // Yang membaca mata uangnya dari header laporan (`reportCurrency`) tetap ada dan tidak boleh
  // dibuang: kalau permintaan ini suatu saat ditolak akun tertentu, jawabannya datang dalam mata
  // uang lain — dan yang menangkapnya adalah pembacaan header itu, bukan asumsi di sini.
  // `ADSENSE_CURRENCY=""` (kosong, bukan tidak diset) berarti "ikut mata uang akun" — satu-satunya
  // cara meminta laporan apa adanya lagi, dan itu yang dipakai migrasi untuk membandingkan angka
  // lama dengan angka rupiahnya.
  //
  // `currencyCode` yang dioper pemanggil menang atas env, dan satu-satunya yang memakainya adalah
  // pecahan saldo: angka itu DIKURANGKAN dari saldo yang datang dalam mata uang pembayaran akun
  // (`payments` tidak menerima parameter mata uang sama sekali), dan dua mata uang yang saling
  // dikurangkan menghasilkan residu yang tampak wajar dan meleset ribuan kali.
  const requested = currencyCode ?? process.env.ADSENSE_CURRENCY ?? "IDR";
  if (requested) params.push(`currencyCode=${encodeURIComponent(requested)}`);
  return api(`/${account}/reports:generate?${params.join("&")}`, token);
}

// Indeks kolom -> perannya, dibaca dari `headers` dan bukan dari posisi tetap: METRICS bisa
// diganti lewat env, dan parser yang membaca "kolom ketiga" akan menaruh jumlah klik di kolom
// uang begitu urutannya berubah.
function columnRoles(headers, dimensionCount) {
  return (headers || []).map((header, index) => {
    const name = String(header?.name || "")
      .trim()
      .toUpperCase();
    // Mata uang kolom uang ikut dibaca dari header-nya. Akun AdSense v2 TIDAK punya field mata
    // uang (`accounts.list` hanya mengembalikan name/displayName/timeZone/state), jadi laporannya
    // sendiri adalah satu-satunya yang tahu angka ini USD atau IDR — dan tanpa itu, earning USD
    // ditulis ke RTDB seolah rupiah: 0,76 dolar tersimpan sebagai "Rp 1" untuk hari yang di layar
    // AdSense berbunyi IDR 13.521.
    const currencyCode = String(header?.currencyCode || "")
      .trim()
      .toUpperCase();
    if (index < dimensionCount) return { kind: "dimension" };
    if (name.includes("IMPRESSION")) return { kind: "impressions" };
    if (name.includes("CLICK")) return { kind: "clicks" };
    if (name.includes("EARNING")) return { kind: "earning", currencyCode };
    return { kind: "other" };
  });
}

// Mata uang laporan ini: dari header kolom uang, bukan dari record akun. Kosong berarti Google
// tidak menyebutnya — dan yang tidak disebut tidak ditebak; sisi sync jatuh ke mata uang akun.
function reportCurrency(roles) {
  return roles.find((role) => role.kind === "earning" && role.currencyCode)?.currencyCode || "";
}

function numeric(cell) {
  const n = Number(cell?.value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function parseRow(row, roles) {
  const cells = row?.cells || [];
  const keys = [];
  // Seluruh pendapatan akun AdSense berdiri sendiri adalah pendapatan AdSense: `adx` dan
  // `adServer` nol BUKAN karena tidak diketahui, melainkan karena sumbernya memang tidak ada di
  // sini. Itu yang membuat kolom GAM/AdSense di tabel ROI tetap terbaca benar.
  const out = { impressions: 0, clicks: 0, earning: 0, adx: 0, adsense: 0, adServer: 0 };
  cells.forEach((cell, index) => {
    const role = roles[index]?.kind;
    if (role === "dimension") keys.push(String(cell?.value ?? ""));
    else if (role === "impressions") out.impressions = numeric(cell);
    else if (role === "clicks") out.clicks = numeric(cell);
    else if (role === "earning") out.earning = numeric(cell);
  });
  out.adsense = out.earning;
  return { keys, ...out };
}

/**
 * Jawaban `reports:generate` -> baris berbentuk sama dengan runNetworkReportByDimensions di gam.js.
 *
 * Dipisah dari pemanggilan HTTP-nya supaya bisa diuji tanpa jaringan: pembacaan kolom lewat
 * `headers` adalah bagian yang paling mudah salah dan paling sunyi kalau salah — angka klik yang
 * mendarat di kolom uang tetap terlihat seperti uang.
 */
export function parseReport(report, dimensionCount) {
  const roles = columnRoles(report?.headers, dimensionCount);
  const currency = reportCurrency(roles);
  // `reportCurrency` menempel di tiap baris, bukan dikembalikan terpisah: bentuk keluaran kedua
  // klien harus tetap sama persis (satu array baris), dan convertRowsToIdr membacanya per baris.
  // Baris GAM datang tanpa field ini dan jatuh ke mata uang network-nya, seperti sebelumnya.
  return (report?.rows || []).map((row) => ({ ...parseRow(row, roles), reportCurrency: currency }));
}

// Rincian per kombinasi dimensi — bentuk yang sama dengan runNetworkReportByDimensions di gam.js:
// [{ keys: [...], impressions, clicks, earning, adx, adsense, adServer }].
export async function runAccountReportByDimensions(accountName, dateRange, token, dimensions) {
  const report = await fetchReport(accountName, dateRange, token, dimensions);
  return parseReport(report, dimensions.length);
}

// Rincian satu dimensi, `key` bukan `keys` — padanan runNetworkReportByDimension.
export async function runAccountReportByDimension(accountName, dateRange, token, dimension) {
  const rows = await runAccountReportByDimensions(accountName, dateRange, token, [dimension]);
  return rows.map(({ keys, ...metrics }) => ({ key: keys[0] || "", ...metrics }));
}

// Total satu akun untuk satu rentang, bentuknya sama dengan aggregate() di gam.js.
export async function runAccountReport(accountName, dateRange, token, { currencyCode } = {}) {
  const report = await fetchReport(accountName, dateRange, token, [], currencyCode);
  const roles = columnRoles(report.headers, 0);
  const currency = reportCurrency(roles);
  const totals = { impressions: 0, clicks: 0, earning: 0, adx: 0, adsense: 0, adServer: 0 };
  // Laporan tanpa dimensi tetap membawa baris `totals` sendiri; `rows` boleh kosong. Keduanya
  // dibaca, dengan `totals` didahulukan — menjumlahkan rows di atas totals akan menghitung dua kali.
  const source = report.totals ? [report.totals] : report.rows || [];
  for (const row of source) {
    const m = parseRow(row, roles);
    totals.impressions += m.impressions;
    totals.clicks += m.clicks;
    totals.earning += m.earning;
    totals.adsense += m.adsense;
  }
  totals.pageRpm = totals.impressions ? (totals.earning / totals.impressions) * 1000 : 0;
  totals.cpc = totals.clicks ? totals.earning / totals.clicks : 0;
  totals.earning = round(totals.earning, 2);
  totals.adsense = round(totals.adsense, 2);
  totals.pageRpm = round(totals.pageRpm, 2);
  totals.cpc = round(totals.cpc, 4);
  totals.reportCurrency = currency;
  return totals;
}

function round(n, places) {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}
