// Meta (Facebook) Marketing API client — read ad account balance & spend.
// https://developers.facebook.com/docs/marketing-api/reference/ad-account
// Auth: a System User access token (Business Manager) with ads_read. Server-to-server,
// no OAuth dance — the token is passed in.

const VERSION = process.env.META_API_VERSION || "v25.0";
const BASE = `https://graph.facebook.com/${VERSION}`;

// `balance`, `amount_spent`, `spend_cap`, dan `daily_budget` datang sebagai string dalam satuan
// terkecil mata uang akun; `insights.spend` sudah dalam satuan utuh dan tidak pernah dibagi.
//
// Default 1 karena akun kita berdenominasi IDR, dan rupiah tidak punya subsatuan di Meta:
// `spend_cap` 1075000 memang batas Rp 1.075.000 yang diketik di Ads Manager, apa adanya.
// Sebelumnya default ini 100, dan setiap angka saldo tampil seperseratus dari yang sebenarnya.
//
// Mata uang bersen (USD, EUR) perlu META_MINOR_UNIT=100. Memastikannya satu perintah:
// `npm run meta:check`, lalu cocokkan kolom `batas` dengan angka di kartu "Batas pengeluaran
// akun" milik akun itu — kalau meleset 100x, pembagi inilah yang salah.
const MINOR = Number(process.env.META_MINOR_UNIT || 1);

// Dibaca campaign-create-core.js, yang menyusun payload anggaran campaign baru: satuan terkecil
// mata uang akun tidak boleh punya dua sumber — yang satu akan meleset seratus kali lipat.
export const META_MINOR_UNIT = MINOR;

// Meta menghitung pemakaian API per app, dan yang membuat sebuah app dicap anomali bukan jumlah
// panggilannya melainkan bentuknya: puluhan request meletus dalam sedetik, lalu diulang lagi
// begitu error karena tombolnya diklik ulang. Semua panggilan Graph lewat satu antrean di sini —
// satu request pada satu waktu, berjarak minimum, melambat sendiri saat Meta bilang kuotanya
// menipis, dan mundur dengan jeda menaik kalau tetap kena limit.
const MIN_INTERVAL_MS = Number(process.env.META_MIN_INTERVAL_MS ?? 400);
const MAX_RETRIES = Number(process.env.META_MAX_RETRIES ?? 3);
const RETRY_BASE_MS = Number(process.env.META_RETRY_BASE_MS ?? 1000);

// Kode transient yang layak diulang. Sisanya (izin kurang, app diblokir, ID salah) tidak akan
// berubah kalau dicoba lagi — mengulangnya cuma menambah beban yang bikin kita dicurigai.
const RETRYABLE = new Set([1, 2, 4, 17, 32, 341, 613, 80000, 80001, 80002, 80003, 80004]);

let queue = Promise.resolve();
let nextCallAt = 0;
let backoffUntil = 0;

const sleep = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

// Satu request pada satu waktu, tidak lebih rapat dari MIN_INTERVAL_MS.
function schedule(task) {
  const run = queue.then(async () => {
    await sleep(Math.max(nextCallAt, backoffUntil) - Date.now());
    try {
      return await task();
    } finally {
      nextCallAt = Date.now() + MIN_INTERVAL_MS;
    }
  });
  // Satu panggilan gagal tidak boleh memutus antrean panggilan berikutnya.
  queue = run.then(
    () => {},
    () => {},
  );
  return run;
}

// Meta menempelkan pemakaian kuota di header setiap respons. Membacanya berarti kita melambat
// sebelum ditolak, bukan sesudah — dan penolakan itulah yang tercatat sebagai perilaku buruk.
function observeUsage(res) {
  const header = res?.headers?.get?.("x-app-usage") || res?.headers?.get?.("x-ad-account-usage");
  if (!header) return;
  let usage;
  try {
    usage = JSON.parse(header);
  } catch {
    return;
  }
  const peak = Math.max(...Object.values(usage).filter((v) => typeof v === "number"), 0);
  if (peak >= 95) backoffUntil = Date.now() + 60_000;
  else if (peak >= 75) backoffUntil = Date.now() + 10_000;
}

// Berapa lama menunggu sebelum mencoba lagi, atau null kalau errornya memang tidak bisa diulang.
// Diekspor supaya bisa diuji langsung: menunggu jeda aslinya di dalam tes berarti tes yang
// jalan lima menit.
export function retryDelay(error, attempt) {
  if (attempt >= MAX_RETRIES || !RETRYABLE.has(error?.code)) return null;
  // Untuk throttle per-use-case Meta menyebutkan sendiri berapa menit lagi aksesnya pulih.
  const minutes = Number(error?.error_data?.estimated_time_to_regain_access) || 0;
  if (minutes > 0) return Math.min(minutes * 60_000, 300_000);
  return 2 ** attempt * RETRY_BASE_MS;
}

function graphUrl(path, token, params = {}) {
  const url = new URL(`${BASE}/${path}`);
  url.searchParams.set("access_token", token);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url;
}

/**
 * Body Graph -> objek, dengan aman.
 *
 * Meta hampir selalu membalas JSON — termasuk untuk error. TAPI edge di depannya (Cloudflare/nginx)
 * sesekali membalas halaman HTML pada 5xx, dan `res.json()` mentah melempar
 * `Unexpected token '<', "<!DOCTYPE "... is not valid JSON` — pesan yang tidak menyebut Meta, status,
 * maupun bahwa ini transien. Dibaca sebagai teks lalu diurai sendiri: yang non-JSON dibungkus jadi
 * error yang terbaca menyebut status + cuplikan. Tidak ditandai retryable di sini: sweep
 * `syncRetries` yang mengulang akun yang gagal, berjarak — bukan menahan run 9 menit ini dengan
 * jeda menaik per akun.
 */
async function parseGraphBody(res) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    const snippet = text.replace(/\s+/g, " ").trim().slice(0, 100);
    return {
      error: {
        message: `balasan non-JSON (HTTP ${res.status})${snippet ? `: ${snippet}` : ""}`,
      },
    };
  }
}

async function request(url, path, init, { retry = true } = {}) {
  for (let attempt = 0; ; attempt++) {
    const { res, data } = await schedule(async () => {
      const res = await fetch(url, init);
      observeUsage(res);
      return { res, data: await parseGraphBody(res) };
    });
    if (res.ok && !data.error) return data;

    // Tulisan yang tidak aman diulang (salin campaign/ad set) mematikan percobaan ulang: kode 1/2
    // bisa datang SESUDAH Meta sempat membuat salinannya, dan mengulangnya menghasilkan kembaran.
    const wait = retry ? retryDelay(data.error, attempt) : null;
    if (wait === null) {
      throw new Error(`Meta ${path} -> ${describeGraphError(data.error, res.status)}`);
    }
    // Di luar antrean: panggilan lain boleh jalan selama yang ini menunggu gilirannya lagi.
    await sleep(wait);
  }
}

async function graph(path, token, params = {}) {
  return request(graphUrl(path, token, params), path);
}

// Satu-satunya tulisan ke Meta di seluruh dashboard. Lewat `request` yang sama dengan pembacaan,
// bukan `fetch` sendiri: antrean, jeda minimum, dan mundur saat kuota menipis berlaku per app —
// panggilan tulis yang menyelinap di luar antrean itulah yang membuat app dicap anomali.
//
// Parameternya tetap di query string (bentuk yang diterima Graph untuk POST), jadi tidak ada body
// yang perlu di-encode terpisah.
async function graphPost(path, token, params = {}, options = {}) {
  return request(graphUrl(path, token, params), path, { method: "POST" }, options);
}

/**
 * POST dengan parameter di BADAN, bukan di query string.
 *
 * `graphPost` di atas menaruh parameternya di URL, dan itu cukup untuk tulisan yang isinya beberapa
 * puluh karakter (status, nama, anggaran). Yang membuat campaign tidak begitu: `asset_feed_spec`
 * memuat tiga hash gambar, judul, body, dan link sekaligus, dan `targeting` memuat daftar negara —
 * satu URL yang memuat keduanya sudah ribuan karakter, dan yang memotongnya di tengah jalan (proxy,
 * log akses) tidak berbunyi sebagai kesalahan yang menyebut Meta.
 */
async function graphPostForm(path, token, params = {}, options = {}) {
  const body = new URLSearchParams({ ...params, access_token: token });
  return request(new URL(`${BASE}/${path}`), path, { method: "POST", body }, options);
}

/**
 * Unggah satu berkas ke Graph (hari ini: gambar iklan).
 *
 * NAMA FIELD-nya adalah nama berkas yang tersimpan di pustaka Meta — dibuktikan 12 Sep 2026:
 * `bytes=<base64>` diterima juga, tapi tiap gambar yang masuk lewat sana bernama "bytes", dan
 * pustaka yang seluruh barisnya bernama sama tidak bisa dipilih orang di galeri mana pun.
 *
 * Tanpa percobaan ulang: unggahan yang sebenarnya berhasil lalu terputus sebelum jawabannya sampai
 * akan menghasilkan gambar kembar di pustaka.
 */
async function graphPostFile(path, token, { fileName, data, contentType }) {
  const body = new FormData();
  body.set("access_token", token);
  body.set(fileName, new Blob([data], { type: contentType }), fileName);
  return request(new URL(`${BASE}/${path}`), path, { method: "POST", body }, { retry: false });
}

/**
 * Seluruh baris satu edge Graph, halaman demi halaman.
 *
 * Meta memotong daftar pada `limit` dan menaruh sisanya di `paging.next` — tanpa mengikutinya,
 * jawabannya adalah data yang KURANG tanpa satu pun error, dan itu bentuk kegagalan yang paling
 * sulit terlihat: tabelnya terisi, hanya tidak lengkap. Insights per hari membuat ini nyata —
 * satu akun dengan 60 campaign × 8 negara × 2 hari sudah melewati 500 baris.
 *
 * `paging.next` adalah URL utuh (access_token-nya sudah menempel), jadi dipakai apa adanya.
 */
async function graphAll(path, token, params = {}) {
  let url = graphUrl(path, token, params);
  const rows = [];
  // Batas halaman sebagai jaring pengaman: cursor Meta yang berputar tidak boleh menggantung run.
  for (let page = 0; url && page < 50; page++) {
    const data = await request(url, path);
    rows.push(...(data.data || []));
    url = data.paging?.next ? new URL(data.paging.next) : null;
  }
  return rows;
}

// "(#200)" berarti dua hal berbeda di Meta — izin ads_read kurang, atau app-nya diblokir — jadi
// code dan subcode ikut dibawa. Tanpa itu dashboard tidak bisa membedakan keduanya.
function describeGraphError(error, status) {
  if (!error) return `HTTP ${status}`;
  const code = [error.code, error.error_subcode].filter(Boolean).join("-");
  const parts = [error.message || `HTTP ${status}`];
  if (error.error_user_msg && error.error_user_msg !== error.message)
    parts.push(error.error_user_msg);
  return code ? `${parts.join(" — ")} (#${code})` : parts.join(" — ");
}

// actId may be given with or without the "act_" prefix.
function normalizeActId(actId) {
  const raw = String(actId).trim();
  return raw.startsWith("act_") ? raw : `act_${raw}`;
}

export async function fetchAccount(actId, token) {
  const id = normalizeActId(actId);

  const acc = await graph(id, token, {
    fields: "balance,amount_spent,spend_cap,currency,account_status",
  });

  // Today's spend via insights (major units, decimal string). Empty when no delivery today.
  const insights = await graph(`${id}/insights`, token, {
    fields: "spend",
    date_preset: "today",
  });
  const spendToday = Number(insights.data?.[0]?.spend || 0);

  // Meta punya dua angka yang sama-sama bisa disebut "saldo", dan yang dibaca operator di Ads
  // Manager sebagai "Batas pengeluaran akun -> Jumlah yang tersisa" adalah `spend_cap` dikurangi
  // `amount_spent` — bukan `balance`. `balance` adalah tagihan berjalan yang belum ditagih; ia
  // NAIK saat beriklan, jadi arahnya justru berlawanan dengan sisa saldo yang dicari.
  //
  // `amount_spent` ikut nol lagi saat tombol "Reset sekarang" di kartu batas ditekan, jadi
  // pasangan cap/spent ini memang pasangan yang sama dengan yang tampil di layar Meta.
  const spendCap = toMajor(acc.spend_cap);
  const amountSpent = toMajor(acc.amount_spent);

  return {
    // Akun tanpa batas pengeluaran dikirim Meta sebagai spend_cap 0, dan 0 - amount_spent akan
    // tampil sebagai sisa saldo minus. Akun begitu tidak punya angka sisa sama sekali, jadi ""
    // (kolomnya jadi "-"), bukan nol yang terbaca sebagai "saldo habis".
    remaining: spendCap > 0 ? round2(spendCap - amountSpent) : "",
    spendCap,
    amountSpent,
    amountDue: toMajor(acc.balance),
    spendToday,
    currency: acc.currency || "",
    accountStatus: acc.account_status ?? null,
  };
}

function toMajor(minorString) {
  const n = Number(minorString);
  return Number.isFinite(n) ? n / MINOR : 0;
}

// Selisih dua pembagian float meninggalkan ekor seperti 3234.2800000000002, yang lolos ke RTDB
// dan ke snapshot saldo apa adanya.
function round2(n) {
  return Math.round(n * 100) / 100;
}

// Day-by-day spend for one ad account over a date range. `time_increment=1` makes Meta return
// one row per day with date_start, which is what the Overview chart needs — `date_preset=today`
// can only ever produce a single point.
export async function fetchDailySpend(actId, token, since, until) {
  const id = normalizeActId(actId);
  const rows = await graphAll(`${id}/insights`, token, {
    fields: "spend",
    time_range: JSON.stringify({ since, until }),
    time_increment: "1",
    limit: "500",
  });
  return rows.map((row) => ({
    date: row.date_start || "",
    spend: Number(row.spend || 0),
  }));
}

// --- "Hasil" (Results) ------------------------------------------------------------------------
//
// Meta tidak mengirim kolom "Hasil" apa adanya. Di Ads Manager, hasil sebuah campaign adalah
// jumlah EVENT YANG DIOPTIMASI ad set-nya — dan itu berbeda per ad set, bukan satu definisi untuk
// semua. Yang tersedia di insights cuma `actions`: daftar SEMUA event yang pernah terjadi, dari
// klik tautan sampai like.
//
// Dulu hasil dipilih dari daftar prioritas tetap (purchase -> lead -> ... -> link_click), dan
// untuk campaign yang tidak dioptimasi ke salah satunya, daftar itu jatuh sampai ujungnya:
// "kBCD-06 Pros Turki" (10 ad set, optimasi OFFSITE_CONVERSIONS/CONTENT_VIEW) terbaca 4.908 hasil
// @ Rp 19,46 — angka klik tautan — sementara Ads Manager menampilkan 2.449 @ Rp 39,01, yaitu
// ViewContent. Bukan selisih kecil: dua kolom itu dipakai menilai campaign mana yang dimatikan.
//
// Sekarang tujuannya dibaca dari ad set-nya sendiri (`optimization_goal` + `promoted_object.
// custom_event_type`), lalu action_type itu yang dihitung.

// Tujuan optimasi konversi menyebut event pixel-nya di `custom_event_type`. Satu event bisa punya
// beberapa nama di `actions` (bentuk pixel, bentuk "omni" yang menggabung web + app, dan bentuk
// pendeknya); dicoba berurutan, yang pertama ketemu dipakai.
const CUSTOM_EVENT_ACTIONS = {
  CONTENT_VIEW: ["offsite_conversion.fb_pixel_view_content", "omni_view_content", "view_content"],
  PURCHASE: ["offsite_conversion.fb_pixel_purchase", "omni_purchase", "purchase"],
  LEAD: ["offsite_conversion.fb_pixel_lead", "omni_lead", "lead"],
  COMPLETE_REGISTRATION: [
    "offsite_conversion.fb_pixel_complete_registration",
    "omni_complete_registration",
    "complete_registration",
  ],
  ADD_TO_CART: ["offsite_conversion.fb_pixel_add_to_cart", "omni_add_to_cart", "add_to_cart"],
  INITIATED_CHECKOUT: [
    "offsite_conversion.fb_pixel_initiate_checkout",
    "omni_initiated_checkout",
    "initiate_checkout",
  ],
  ADD_PAYMENT_INFO: ["offsite_conversion.fb_pixel_add_payment_info", "add_payment_info"],
  SEARCH: ["offsite_conversion.fb_pixel_search", "omni_search", "search"],
  SUBSCRIBE: ["offsite_conversion.fb_pixel_subscribe", "subscribe"],
  START_TRIAL: ["offsite_conversion.fb_pixel_start_trial", "start_trial"],
  CONTACT: ["offsite_conversion.fb_pixel_contact", "contact"],
  SUBMIT_APPLICATION: ["offsite_conversion.fb_pixel_submit_application", "submit_application"],
};

// Tujuan optimasi yang event-nya sudah tertentu tanpa perlu `custom_event_type`.
const GOAL_ACTIONS = {
  LINK_CLICKS: ["link_click"],
  LANDING_PAGE_VIEWS: ["landing_page_view", "omni_landing_page_view"],
  POST_ENGAGEMENT: ["post_engagement"],
  PAGE_LIKES: ["like", "onsite_conversion.post_net_like"],
  EVENT_RESPONSES: ["rsvp"],
  THRUPLAY: ["video_view"],
  VIDEO_VIEWS: ["video_view"],
  APP_INSTALLS: ["mobile_app_install", "omni_app_install", "app_install"],
  LEAD_GENERATION: ["onsite_conversion.lead_grouped", "leadgen_grouped", "lead"],
  QUALITY_LEAD: ["onsite_conversion.lead_grouped", "leadgen_grouped", "lead"],
  CONVERSATIONS: ["onsite_conversion.messaging_conversation_started_7d"],
  QUALITY_CALL: ["onsite_conversion.total_messaging_connection"],
  DERIVED_EVENTS: [],
  // REACH dan IMPRESSIONS tidak punya baris di `actions` sama sekali — "hasil"-nya adalah jangkauan
  // dan tayangan, yang datang sebagai kolom insights tersendiri. Dibiarkan kosong supaya
  // pemanggilnya jatuh ke daftar cadangan, bukan mengarang angka dari event lain.
  REACH: [],
  IMPRESSIONS: [],
};

// Cadangan untuk campaign yang tujuannya tidak terbaca (ad set-nya gagal diambil, atau tujuan baru
// yang belum ada di peta di atas). Urutan lama, dan tetap bisa diganti lewat env.
const RESULT_ACTIONS = (
  process.env.META_RESULT_ACTIONS ||
  "offsite_conversion.fb_pixel_purchase,purchase,offsite_conversion.fb_pixel_lead,lead,complete_registration,link_click"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/**
 * action_type yang dihitung Ads Manager sebagai "Hasil" untuk satu ad set, urut dari yang paling
 * spesifik. Kosong = tujuannya memang tidak punya action (REACH/IMPRESSIONS) atau tidak dikenal.
 */
export function resultActionTypes(adSet) {
  const goal = String(adSet?.optimization_goal || "").toUpperCase();
  const event = String(adSet?.promoted_object?.custom_event_type || "").toUpperCase();
  // Custom conversion menang atas `custom_event_type`, yang untuknya cuma berbunyi "OTHER". Meta
  // melaporkannya dengan satu nama di `actions` DAN `cost_per_action_type`. Tanpa ini, ad set
  // "Pros" ber-VALUE (kL5r-01 ProsR18 G11, 26 Sep 2026: 3.529 hasil @ Rp 11,48) jatuh ke cadangan
  // purchase, dan biayanya kosong karena `fb_pixel_purchase` tidak ada di cost_per_action_type.
  const conversion = String(adSet?.promoted_object?.custom_conversion_id || "").trim();
  if (conversion) return [`offsite_conversion.custom.${conversion}`];
  if (event && CUSTOM_EVENT_ACTIONS[event]) return CUSTOM_EVENT_ACTIONS[event];
  if (GOAL_ACTIONS[goal]) return GOAL_ACTIONS[goal];
  return [];
}

/**
 * Peta campaignId -> action_type hasilnya, dibaca dari ad set-ADS SET milik campaign itu.
 *
 * Satu campaign bisa punya banyak ad set (yang di atas punya sepuluh). Kalau tujuannya berbeda-beda,
 * yang dipakai adalah yang paling banyak dipakai — Ads Manager sendiri menampilkan beberapa baris
 * hasil untuk campaign seperti itu, dan satu kolom tidak bisa memuat keduanya. Ad set yang sudah
 * dihapus tidak ikut: tujuannya tidak lagi menghasilkan apa pun hari ini.
 */
export async function fetchCampaignResultGoals(actId, token) {
  const id = normalizeActId(actId);
  const rows = await graphAll(`${id}/adsets`, token, {
    fields: "campaign_id,optimization_goal,promoted_object{custom_event_type,custom_conversion_id}",
    effective_status: JSON.stringify(["ACTIVE", "PAUSED", "CAMPAIGN_PAUSED", "ADSET_PAUSED"]),
    limit: "500",
  });
  const votes = new Map(); // campaignId -> Map(actionTypes.join("|") -> {types, count})
  for (const row of rows) {
    const campaignId = String(row?.campaign_id || "");
    const types = resultActionTypes(row);
    if (!campaignId || !types.length) continue;
    const key = types.join("|");
    const perCampaign = votes.get(campaignId) || new Map();
    const current = perCampaign.get(key) || { types, count: 0 };
    current.count += 1;
    perCampaign.set(key, current);
    votes.set(campaignId, perCampaign);
  }

  const goals = new Map();
  for (const [campaignId, perCampaign] of votes) {
    const winner = [...perCampaign.values()].sort((a, b) => b.count - a.count)[0];
    if (winner) goals.set(campaignId, winner.types);
  }
  return goals;
}

// Jumlah hasil dari satu baris insights. `preferred` adalah action_type tujuan ad set-nya; kalau
// tidak ada satu pun yang cocok, daftar cadangan yang dipakai. 0 berarti "tidak ada hasil yang
// dikenali" — pemanggilnya yang memutuskan itu jadi "-" atau bukan, karena membagi spend dengan 0
// tidak menghasilkan CPR.
export function resultsFromActions(actions, preferred = []) {
  if (!Array.isArray(actions)) return 0;
  for (const type of [...preferred, ...RESULT_ACTIONS]) {
    const value = Number(actions.find((a) => a?.action_type === type)?.value || 0);
    if (value > 0) return value;
  }
  return 0;
}

// action_type mana yang akhirnya terpakai — dipakai untuk mengambil biaya per hasil versi Meta
// sendiri, dan disimpan di baris campaign supaya kolomnya bisa dijelaskan.
export function resultActionUsed(actions, preferred = []) {
  if (!Array.isArray(actions)) return "";
  for (const type of [...preferred, ...RESULT_ACTIONS]) {
    if (Number(actions.find((a) => a?.action_type === type)?.value || 0) > 0) return type;
  }
  return "";
}

/**
 * Biaya per hasil MENURUT META (`cost_per_action_type`). Dipakai apa adanya, bukan dihitung ulang
 * dari spend/hasil: itu angka yang tertera di Ads Manager.
 *
 * `types` adalah nama-nama event yang sama, urut dari yang paling spesifik — dan harus lebih dari
 * satu, karena `cost_per_action_type` TIDAK selalu memakai nama yang sama dengan `actions`.
 * Campaign "kBCD-06 Pros Turki" mengirim hasilnya sebagai `offsite_conversion.fb_pixel_view_content`
 * tapi biayanya hanya sebagai `omni_view_content`/`view_content` — mencari satu nama saja
 * mengembalikan null, dan kolomnya jatuh ke hitungan sendiri tanpa ada yang tahu kenapa.
 *
 * null = Meta memang tidak mengirimkannya; pemanggilnya yang menghitung spend/hasil.
 */
/**
 * Nama-nama untuk mencari BIAYA hasil `resultType`. Kalau hasilnya datang dari tujuan ad set-nya,
 * daftar tujuan itu. Kalau jatuh ke cadangan, hanya nama lain untuk EVENT YANG SAMA (kelompok di
 * `CUSTOM_EVENT_ACTIONS`): `fb_pixel_purchase` di `actions` biayanya cuma ada sebagai
 * `purchase`/`omni_purchase`. Alias milik tujuan ad set tidak dipakai di situ, karena event-nya
 * sudah bukan event yang sama dan alias itu akan mengambil biaya milik event lain.
 */
export function resultCostAliases(resultType, preferred = []) {
  if (!resultType) return [];
  if (preferred.includes(resultType)) return preferred;
  return (
    Object.values(CUSTOM_EVENT_ACTIONS).find((group) => group.includes(resultType)) || [resultType]
  );
}

export function costPerResultFrom(costRows, types) {
  if (!Array.isArray(costRows)) return null;
  const candidates = (Array.isArray(types) ? types : [types]).filter(Boolean);
  for (const type of candidates) {
    const value = Number(costRows.find((c) => c?.action_type === type)?.value);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

// Nama, status, dan anggaran harian tiap campaign. Tidak ada satu pun dari ketiganya di insights —
// dari sana hanya keluar angka pemakaian, itulah sebabnya kolom Status di tabel Kampanye dulu
// selalu ditulis "Aktif" dan kolom Anggaran tidak pernah terisi.
//
// `daily_budget` hanya ada pada campaign yang anggarannya diatur di level campaign (CBO). Kalau
// anggarannya dipegang ad set, Meta tidak punya angka campaign-level untuk diberikan — kolomnya
// dibiarkan kosong, bukan diisi 0 yang akan terbaca sebagai "tidak dianggarkan".
export async function fetchCampaignSettings(actId, token) {
  const id = normalizeActId(actId);
  const rows = await graphAll(`${id}/campaigns`, token, {
    fields: "id,name,status,effective_status,start_time,daily_budget",
    limit: "500",
  });
  return rows.map((c) => ({
    // ID campaign di Meta — satu-satunya alamat yang bisa dipakai untuk menyalakan atau
    // mematikannya. Nama tidak bisa: ia boleh berubah dan boleh kembar antar akun.
    id: String(c.id || ""),
    name: c.name || "",
    // `status` adalah saklar yang dipegang orang; `effective_status` adalah keadaan campaign
    // setelah Meta ikut menimbang (review, limit, ad set yang jeda). Keduanya disimpan karena
    // yang satu adalah posisi tombol dan yang lain adalah kenyataan — campaign bisa berstatus
    // ACTIVE tapi effective-nya PENDING_REVIEW, dan tombol yang membaca effective_status akan
    // tampak mati padahal tidak ada yang mematikannya.
    status: c.status || "",
    effectiveStatus: c.effective_status || "",
    // Kapan campaign ini MULAI tayang. Tidak ada di `status` maupun di `effective_status` —
    // campaign yang dijadwalkan pekan depan berstatus ACTIVE dan efektif ACTIVE juga, persis sama
    // dengan yang sedang membelanjakan uang hari ini. Ads Manager membedakannya di kolom Delivery
    // ("Scheduled"), dan satu-satunya bahan untuk itu adalah field ini.
    startTime: c.start_time || "",
    dailyBudget: c.daily_budget === undefined ? null : toMajor(c.daily_budget),
  }));
}

// Nyalakan/matikan satu campaign. `status` (bukan `effective_status`) adalah field yang bisa
// ditulis; Meta menjawab `{success: true}` dan status barunya baru terlihat di laporan berikutnya.
export async function setCampaignStatus(campaignId, token, status) {
  const id = String(campaignId || "").trim();
  if (!id) throw new Error("ID campaign kosong.");
  if (status !== "ACTIVE" && status !== "PAUSED") {
    throw new Error(`Status campaign tidak dikenal: ${status}`);
  }
  try {
    await graphPost(id, token, { status });
  } catch (error) {
    throw new Error(explainWriteFailure(error.message));
  }
  return { id, status };
}

/**
 * Nyalakan/matikan satu AD SET. Bentuknya sama persis dengan `setCampaignStatus` di atas — field
 * `status` yang bisa ditulis, `effective_status` yang tidak — dan sengaja tidak dilebur jadi satu
 * fungsi bergaya "setObjectStatus": yang membedakan keduanya bukan cuma ID-nya melainkan siapa yang
 * boleh memanggilnya dan apa yang harus diperiksa lebih dulu (ad set wajib terbukti milik campaign
 * yang dituju, lihat server/campaigns.js), dan satu fungsi untuk keduanya menyembunyikan syarat itu.
 *
 * Yang TIDAK berubah karenanya: iklan yang ditolak Meta tetap tidak tayang walau ad set-nya
 * dinyalakan — yang menahannya bukan saklar ini.
 */
export async function setAdSetStatus(adSetId, token, status) {
  const id = String(adSetId || "").trim();
  if (!id) throw new Error("ID ad set kosong.");
  if (status !== "ACTIVE" && status !== "PAUSED") {
    throw new Error(`Status ad set tidak dikenal: ${status}`);
  }
  try {
    await graphPost(id, token, { status });
  } catch (error) {
    throw new Error(explainWriteFailure(error.message));
  }
  return { id, status };
}

// Meta menjawab penolakan izin TULIS dengan kalimat yang menyebut tiga sebab sekaligus — "tidak
// ada / tidak bisa dimuat karena izin kurang / tidak mendukung operasi ini" — lalu menempelkan link
// dokumentasi umum. Yang membacanya di dashboard akan mengejar sebab pertama, padahal ID itu ada di
// baris campaign justru karena token yang sama baru saja MEMBACAnya dari Meta.
//
// Jadi sebab yang benar disebutkan, dan kalimat link yang tidak menyempitkan apa pun dibuang.
function explainWriteFailure(message) {
  const text = String(message).replace(/\s*Please read the Graph API documentation at \S+/i, "");
  // Dibuktikan 12 Sep 2026: subkode ini menjawab SETIAP creative yang dibuat app ini — disalin
  // maupun dibuat dari nol — dan kalimat Meta-nya menyuruh orang mencari "postingan materi iklan"
  // yang tidak pernah ada. Yang menahannya satu saklar di luar repo ini, jadi itu yang disebutkan:
  // tanpa kalimat ini, yang terbaca di panel Pekerjaan adalah kegagalan yang tidak menunjuk siapa
  // pun, dan iklan yang tidak pernah lahir terlihat seperti salah isi form.
  if (/\(#100-1885183\)/.test(text)) {
    return `${text} — app Meta pemegang token ini masih Development Mode, jadi tidak satu pun iklan bisa lahir darinya (yang disalin maupun yang dibuat dari nol). Nyalakan App Mode: Live di developers.facebook.com — Settings > Basic, isi Privacy Policy URL dan kategori lebih dulu.`;
  }
  // Dibuktikan 12 Sep 2026: inilah yang tersisa begitu creative tidak lagi dibuat ulang oleh app
  // ini (iklan salinan memakai creative sumbernya). Ia per HALAMAN, bukan per app — jadi kalimatnya
  // menyuruh ke tempat yang berbeda dari saklar App Mode di atas, dan meleburnya membuat orang
  // menunggu App Review untuk sesuatu yang bisa diberikan sendiri dalam satu menit.
  if (/\(#100-1885499\)/.test(text)) {
    return `${text} — System User belum punya izin beriklan di Halaman iklan itu. Buka Business Manager > Halaman > Halaman itu > Tambahkan orang, pilih System User "rabbitroi-sync", lalu nyalakan akses Iklan (Create ads).`;
  }
  if (/\(#100-33\)|\(#200[-)]/.test(text)) {
    return `${text} — token Meta ini kemungkinan besar hanya punya izin ads_read; mengubah status campaign butuh ads_management.`;
  }
  return text;
}

// --- Salin campaign, BERTAHAP --------------------------------------------------------------
//
// Bukan satu deep copy campaign: salinan langsung Meta dibatasi 3 iklan PER PANGGILAN, dan jalur
// asinkronnya (`async_batch_requests`) tertutup untuk app ini (#194 untuk satu item, #10 untuk dua —
// lihat lampiran spec). Jadi campaign disalin tanpa isinya, lalu tiap ad set disalin ke dalamnya.
//
// Tidak satu pun panggilan di bagian ini diulang otomatis (`retry: false`).
const NO_RENAME = JSON.stringify({ rename_strategy: "NO_RENAME" });

// Campaign salinan TIDAK PERNAH lahir dengan nama persis sumbernya, sekejap pun: sync melebur campaign
// per nama, jadi dua campaign bernama sama di satu akun jadi satu baris tabel. Pemanggil memberi
// akhiran yang unik per job dan per salinan, lalu langsung mengganti namanya.
export async function copyCampaignShell(campaignId, token, { suffix = " (salinan)" } = {}) {
  const id = String(campaignId || "").trim();
  if (!id) throw new Error("ID campaign kosong.");
  const renameOptions = JSON.stringify({
    rename_strategy: "ONLY_TOP_LEVEL_RENAME",
    rename_suffix: suffix,
  });
  let data;
  try {
    data = await graphPost(
      `${id}/copies`,
      token,
      { deep_copy: "false", status_option: "PAUSED", rename_options: renameOptions },
      { retry: false },
    );
  } catch (error) {
    throw new Error(explainWriteFailure(error.message));
  }
  const copied = String(data?.copied_campaign_id || "");
  if (!copied) throw new Error("Meta tidak mengembalikan ID campaign salinan.");
  return { campaignId: copied };
}

/**
 * Salin satu ad set berikut iklannya ke campaign tujuan.
 *
 * `adIds` adalah iklan yang BENAR-BENAR lahir, dibaca dari `ad_object_ids`. Deep copy melewatkan
 * iklan tanpa satu pun error kalau System User tidak punya izin beriklan di Halaman yang dipakai
 * creative-nya (dibuktikan 11 Sep 2026), jadi pemanggilnya yang membandingkan jumlah ini dengan
 * jumlah iklan sumber — bukan menganggap deep copy berarti semuanya ikut.
 *
 * `INHERITED_FROM_SOURCE`: saklar tiap ad set tetap seperti aslinya. Tidak ada yang tayang karena
 * campaign salinannya lahir PAUSED.
 */
export async function copyAdSetInto(adSetId, token, { campaignId } = {}) {
  const id = String(adSetId || "").trim();
  if (!id) throw new Error("ID ad set kosong.");
  const target = String(campaignId || "").trim();
  if (!target) throw new Error("ID campaign tujuan kosong.");
  let data;
  try {
    data = await graphPost(
      `${id}/copies`,
      token,
      {
        campaign_id: target,
        deep_copy: "true",
        status_option: "INHERITED_FROM_SOURCE",
        rename_options: NO_RENAME,
      },
      { retry: false },
    );
  } catch (error) {
    throw new Error(explainWriteFailure(error.message));
  }
  const copied = String(data?.copied_adset_id || "");
  if (!copied) throw new Error("Meta tidak mengembalikan ID ad set salinan.");
  const adIds = (Array.isArray(data?.ad_object_ids) ? data.ad_object_ids : [])
    .filter((item) => item?.ad_object_type === "ad")
    .map((item) => String(item.copied_id || ""))
    .filter(Boolean);
  return { adSetId: copied, adIds };
}

// --- Baca dan ubah untuk form edit ---------------------------------------------------------

// Meta mengirim "0" untuk jenis anggaran yang tidak dipakai; nol di sini berarti "bukan jenis
// anggaran ini", bukan dianggarkan nol rupiah.
function budgetOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const major = toMajor(value);
  return major > 0 ? major : null;
}

function toMinor(major) {
  return Math.round(Number(major) * MINOR);
}

export async function fetchCampaignForEdit(campaignId, token) {
  const id = String(campaignId || "").trim();
  if (!id) throw new Error("ID campaign kosong.");
  const row = await graph(id, token, {
    fields: "id,name,status,daily_budget,lifetime_budget,account_id",
  });
  return {
    id: String(row?.id || id),
    name: row?.name || "",
    status: row?.status || "",
    dailyBudget: budgetOrNull(row?.daily_budget),
    lifetimeBudget: budgetOrNull(row?.lifetime_budget),
    accountId: String(row?.account_id || ""),
  };
}

export async function updateCampaign(campaignId, token, { name, dailyBudget } = {}) {
  const id = String(campaignId || "").trim();
  if (!id) throw new Error("ID campaign kosong.");
  const params = {};
  if (name !== undefined) params.name = String(name);
  if (dailyBudget !== undefined) params.daily_budget = String(toMinor(dailyBudget));
  if (!Object.keys(params).length) throw new Error("Tidak ada yang diubah.");
  try {
    await graphPost(id, token, params);
  } catch (error) {
    throw new Error(explainWriteFailure(error.message));
  }
  return { id };
}

// `targeting` diminta UTUH — yang menulisnya kembali harus mengirim seluruh isinya, dan potongan
// yang tidak diminta akan hilang dari ad set pada tulisan berikutnya.
export async function fetchAdSetForEdit(adSetId, token) {
  const id = String(adSetId || "").trim();
  if (!id) throw new Error("ID ad set kosong.");
  const row = await graph(id, token, {
    fields:
      "id,name,campaign_id,account_id,status,daily_budget,lifetime_budget,start_time,end_time,targeting",
  });
  return {
    id: String(row?.id || id),
    name: row?.name || "",
    campaignId: String(row?.campaign_id || ""),
    accountId: String(row?.account_id || ""),
    startTime: row?.start_time || "",
    endTime: row?.end_time || "",
    status: row?.status || "",
    dailyBudget: budgetOrNull(row?.daily_budget),
    lifetimeBudget: budgetOrNull(row?.lifetime_budget),
    targeting: row?.targeting && typeof row.targeting === "object" ? row.targeting : null,
  };
}

export async function updateAdSet(
  adSetId,
  token,
  { name, dailyBudget, targeting, startTime } = {},
) {
  const id = String(adSetId || "").trim();
  if (!id) throw new Error("ID ad set kosong.");
  const params = {};
  if (name !== undefined) params.name = String(name);
  if (dailyBudget !== undefined) params.daily_budget = String(toMinor(dailyBudget));
  if (targeting !== undefined) params.targeting = JSON.stringify(targeting);
  // Jadwal ditulis di AD SET, tidak pernah di campaign: yang di campaign diterima lalu diabaikan.
  if (startTime !== undefined) params.start_time = String(startTime);
  if (!Object.keys(params).length) throw new Error("Tidak ada yang diubah.");
  try {
    await graphPost(id, token, params);
  } catch (error) {
    throw new Error(explainWriteFailure(error.message));
  }
  return { id };
}

// --- Bahan form "Buat campaign" --------------------------------------------------------------
//
// Tiga daftar yang mengisi dialognya, semuanya dibaca segar dari Meta: apa yang boleh dipakai
// ditentukan Business Manager, bukan cermin RTDB yang bisa basi.

export async function fetchAdPixels(actId, token) {
  const rows = await graphAll(`${normalizeActId(actId)}/adspixels`, token, {
    fields: "id,name,last_fired_time,is_unavailable",
    limit: "50",
  });
  return rows.map((row) => ({
    id: String(row.id || ""),
    name: row.name || "",
    lastFired: row.last_fired_time || "",
    // Pixel yang dinonaktifkan Meta tetap ditampilkan, ditandai: yang menghilangkannya dari daftar
    // membuat ad set gagal lahir tanpa satu pun keterangan tentang pixel mana yang hilang.
    unavailable: Boolean(row.is_unavailable),
  }));
}

/**
 * Halaman Facebook yang benar-benar dipegang System User.
 *
 * Bukan daftar Halaman yang dipakai iklan armada: yang menentukan sebuah iklan boleh lahir adalah
 * izin System User atas Halaman itu (`ADVERTISE`), dan Halaman yang dipakai kemarin bisa saja
 * izinnya belum pernah diberikan — itu persis keadaan yang menutup salinan iklan sampai 12 Sep 2026.
 * Menawarkan Halaman yang pasti ditolak berarti memindahkan kegagalannya ke sesudah orang mengisi
 * seluruh form.
 */
export async function fetchPages(token) {
  const rows = await graphAll("me/accounts", token, { fields: "id,name,tasks", limit: "100" });
  return rows
    .map((row) => ({
      id: String(row.id || ""),
      name: row.name || "",
      canAdvertise: (Array.isArray(row.tasks) ? row.tasks : []).includes("ADVERTISE"),
    }))
    .filter((page) => page.id);
}

export async function fetchAdImages(actId, token, { limit = 200 } = {}) {
  const rows = await graphAll(`${normalizeActId(actId)}/adimages`, token, {
    fields: "hash,name,url_128,width,height,created_time,status",
    limit: String(Math.min(limit, 500)),
  });
  return rows
    .filter((row) => row.hash && row.status !== "DELETED")
    .map((row) => ({
      hash: String(row.hash),
      name: row.name || "",
      thumbnail: row.url_128 || "",
      width: Number(row.width) || 0,
      height: Number(row.height) || 0,
      createdTime: row.created_time || "",
    }))
    .slice(0, limit);
}

// Jawaban Meta: `{ images: { "<nama field>": { hash, url, width, height, ... } } }` — satu entri,
// berkunci nama field yang dikirim.
export async function uploadAdImage(actId, token, { fileName, data, contentType }) {
  const name = String(fileName || "").trim();
  if (!name) throw new Error("Nama berkas gambar kosong.");
  let body;
  try {
    body = await graphPostFile(`${normalizeActId(actId)}/adimages`, token, {
      fileName: name,
      data,
      contentType: contentType || "image/jpeg",
    });
  } catch (error) {
    throw new Error(explainWriteFailure(error.message));
  }
  const image = Object.values(body?.images || {})[0];
  if (!image?.hash) throw new Error("Meta tidak mengembalikan hash gambar.");
  return {
    hash: String(image.hash),
    name: image.name || name,
    thumbnail: image.url_128 || image.url || "",
    width: Number(image.width) || 0,
    height: Number(image.height) || 0,
  };
}

// --- Buat campaign, ad set, creative, iklan ---------------------------------------------------
//
// Tulisan yang MELAHIRKAN objek, jadi tidak satu pun diulang otomatis (`retry: false`), sepola
// salin campaign: kode 1/2 bisa datang sesudah Meta sempat membuatnya, dan yang sudah lahir tidak
// bisa ditarik kembali.
//
// Keputusan APA yang dikirim (objective, tujuan optimasi, bentuk targeting) tidak ada di sini
// melainkan di campaign-create-core.js — yang di sini cuma mengubahnya jadi permintaan Graph.
const NEW = { retry: false };

async function createObject(path, token, params, what) {
  let data;
  try {
    data = await graphPostForm(path, token, params, NEW);
  } catch (error) {
    throw new Error(explainWriteFailure(error.message));
  }
  const id = String(data?.id || "");
  if (!id) throw new Error(`Meta tidak mengembalikan ID ${what}.`);
  return id;
}

export async function createCampaign(actId, token, payload) {
  return createObject(`${normalizeActId(actId)}/campaigns`, token, payload, "campaign");
}

export async function createAdSet(actId, token, payload) {
  return createObject(`${normalizeActId(actId)}/adsets`, token, payload, "ad set");
}

export async function createAdCreative(actId, token, payload) {
  return createObject(`${normalizeActId(actId)}/adcreatives`, token, payload, "ad creative");
}

export async function createAd(actId, token, payload) {
  return createObject(`${normalizeActId(actId)}/ads`, token, payload, "iklan");
}

// Rentang tanggal untuk insights. Tanpa rentang, Meta diminta `date_preset=today` — hari berjalan,
// yang hanya benar untuk panel "Pengeluaran Hari Ini". Sisi ROI selalu mengoper rentang yang sama
// dengan yang diminta ke GAM; kalau tidak, satu baris memuat pendapatan kemarin dan spend hari ini.
//
// `time_increment=1` menyertai rentang: satu run melaporkan hari selesai DAN hari berjalan, dan
// tanpa pemecahan per hari Meta menjumlahkan keduanya menjadi satu angka yang tidak bisa
// dipasangkan dengan hari GAM mana pun. Setiap baris karena itu membawa `date` sendiri.
function insightsPeriod(range) {
  return range?.since && range?.until
    ? {
        time_range: JSON.stringify({ since: range.since, until: range.until }),
        time_increment: "1",
      }
    : { date_preset: "today" };
}

// Spend tiap campaign dipecah per negara — satu-satunya tempat negara muncul di data Meta, dan
// sisi Meta dari tabel "ROI per Negara".
//
// Negara datang sebagai kode ISO 3166-1 alpha-2 ("ID", "MY"), bukan nama, jadi sisi GAM-nya harus
// ikut diminta dalam bentuk kode supaya keduanya bisa dijodohkan (lihat GAM_COUNTRY_DIMENSIONS).
//
// `actions` sengaja tidak diminta: tabel per negara tidak punya kolom hasil/CPR, dan meminta
// breakdown action per negara membuat respons Meta membengkak tanpa ada yang membacanya.
export async function fetchCampaignSpendByCountry(actId, token, range) {
  const id = normalizeActId(actId);
  const rows = await graphAll(`${id}/insights`, token, {
    level: "campaign",
    breakdowns: "country",
    fields: "campaign_name,spend",
    ...insightsPeriod(range),
    limit: "500",
  });
  return rows.map((r) => ({
    date: r.date_start || "",
    name: r.campaign_name || "",
    country: String(r.country || "")
      .trim()
      .toUpperCase(),
    spend: Number(r.spend || 0),
  }));
}

// Per-campaign spend + hasil untuk satu ad account (insights `spend` sudah major units).
//
// `goals` adalah peta campaignId -> action_type hasilnya (`fetchCampaignResultGoals`). Tanpa itu
// hasil jatuh ke daftar cadangan — pemanggil yang tidak peduli kolom Hasil boleh melewatinya.
export async function fetchCampaignSpend(actId, token, range, goals = null) {
  const id = normalizeActId(actId);
  const rows = await graphAll(`${id}/insights`, token, {
    level: "campaign",
    // `cost_per_action_type` diminta bersama `actions`: biaya per hasil di Ads Manager adalah angka
    // Meta sendiri, bukan hasil bagi kita — dan meminta keduanya sekaligus tidak menambah request.
    fields: "campaign_id,campaign_name,spend,actions,cost_per_action_type",
    ...insightsPeriod(range),
    limit: "500",
  });
  return rows.map((r) => {
    const preferred = goals?.get(String(r.campaign_id || "")) || [];
    const resultType = resultActionUsed(r.actions, preferred);
    // Nama-nama lain untuk event YANG SAMA, dipakai mencari biayanya (lihat `resultCostAliases`).
    const aliases = resultCostAliases(resultType, preferred);
    return {
      // Tanggal barisnya, kosong hanya kalau Meta diminta tanpa rentang (panel hari ini). Sisi ROI
      // memakainya untuk memilih hari mana baris ini masuk.
      date: r.date_start || "",
      // Diminta bersama namanya supaya campaign yang sudah tidak ada di daftar campaign (dihapus
      // hari ini, tapi masih punya spend) tetap membawa alamat Meta-nya.
      id: String(r.campaign_id || ""),
      name: r.campaign_name || "",
      spend: Number(r.spend || 0),
      results: resultsFromActions(r.actions, preferred),
      // Event yang dihitung sebagai hasil, dan biaya per hasil versi Meta untuk event itu.
      resultType,
      costPerResult: costPerResultFrom(r.cost_per_action_type, aliases),
    };
  });
}

// --- Ad set di dalam satu campaign -------------------------------------------------------------
//
// Tabel "Manajemen Kampanye" berdiri di tingkat campaign, dan itu tingkat yang tidak bisa menjawab
// dua pertanyaan yang paling sering menyusulnya: ad set mana yang membakar anggarannya, dan kenapa
// sebuah campaign yang saklarnya On tidak mengeluarkan uang sama sekali.
//
// DIAMBIL SAAT DIKLIK, bukan dicerminkan ke RTDB seperti baris campaign — dan itu ukurannya, bukan
// kemalasan: satu ad account (TBZ 1247, diukur 7 Sep 2026) memuat 960 ad set atas 134 campaign,
// jadi mencerminkan armada tiap jam berarti belasan ribu baris ditulis ulang ke node yang sudah
// memuat campaigns + campaignHistory + dailySpend + balanceSnapshots. Yang dicari orang di panel
// ini adalah keadaan SEKARANG; cermin sejam lalu justru jawaban yang salah.

// `configured_status` sengaja TIDAK diminta: untuk ad set ia salinan `status`, dan dua field yang
// selalu sama akan dibaca sebagai dua keadaan yang berbeda.
//
// `effective_status` diminta justru karena di tingkat ini ia membawa satu keadaan yang tidak bisa
// dibaca dari mana pun: `CAMPAIGN_PAUSED` — ad set yang saklarnya sendiri On, tapi campaign di
// atasnya mati. Itu jawaban atas "kenapa ad set ini aktif dan tidak keluar uang", dan tanpa field
// ini panel cuma bisa menunjukkan nolnya.
const AD_SET_FIELDS = [
  "id",
  "name",
  "status",
  "effective_status",
  "start_time",
  "end_time",
  "updated_time",
  "daily_budget",
  "lifetime_budget",
  "budget_remaining",
  "bid_strategy",
  "optimization_goal",
  "billing_event",
  "promoted_object{custom_event_type,custom_conversion_id}",
  "targeting{age_min,age_max,geo_locations}",
].join(",");

/**
 * Setelan + status tiap ad set di dalam SATU campaign.
 *
 * Yang diarsipkan tidak disaring di sini, berbeda dari `fetchCampaignResultGoals` yang memang cuma
 * butuh tujuan optimasi yang masih berlaku: panel ini menjawab "isi campaign ini apa saja", dan ad
 * set yang dihapus dari daftar tanpa satu pun tanda terbaca sebagai ad set yang tidak pernah ada.
 * Statusnya sendiri yang menyebutkannya.
 */
export async function fetchAdSets(campaignId, token) {
  const id = String(campaignId || "").trim();
  if (!id) throw new Error("ID campaign kosong.");
  const rows = await graphAll(`${id}/adsets`, token, { fields: AD_SET_FIELDS, limit: "200" });
  return rows.map((row) => ({
    id: String(row.id || ""),
    name: row.name || "",
    // Posisi saklar ad set-nya sendiri (ACTIVE/PAUSED/ARCHIVED), sepola `configuredStatus` di baris
    // campaign — dan `effectiveStatus` yang membawa keadaan setelah campaign di atasnya ikut
    // menimbang. Keduanya disimpan karena yang satu posisi tombol dan yang lain kenyataan.
    status: row.status || "",
    effectiveStatus: row.effective_status || "",
    startTime: row.start_time || "",
    endTime: row.end_time || "",
    updatedTime: row.updated_time || "",
    // Anggaran ad set hanya ada kalau anggarannya DIPEGANG ad set (ABO). Pada campaign CBO Meta
    // tidak mengirim keduanya sama sekali, dan null bukan 0 — aturan yang sama dengan
    // `dailyBudget` di baris campaign.
    dailyBudget: row.daily_budget === undefined ? null : toMajor(row.daily_budget),
    lifetimeBudget: row.lifetime_budget === undefined ? null : toMajor(row.lifetime_budget),
    bidStrategy: row.bid_strategy || "",
    optimizationGoal: row.optimization_goal || "",
    billingEvent: row.billing_event || "",
    // Event pixel yang dioptimasi — bahan `resultActionTypes`, dan satu-satunya cara kolom Hasil
    // di sini menjadi angka yang sama dengan Ads Manager.
    customEventType: row.promoted_object?.custom_event_type || "",
    // Custom conversion yang dioptimasi (ad set "Pros" ber-VALUE): nama hasilnya di insights.
    customConversionId: String(row.promoted_object?.custom_conversion_id || ""),
    countries: toCountryList(row.targeting?.geo_locations?.countries),
    ageMin: Number(row.targeting?.age_min) || null,
    ageMax: Number(row.targeting?.age_max) || null,
  }));
}

/**
 * Ad set yang AKAN tayang di satu ad account — bahan tab "Terjadwal" di Overview.
 *
 * Dibaca per AD ACCOUNT, bukan per campaign: yang dicari adalah jadwal seluruh armada, dan satu
 * panggilan per campaign berarti ratusan panggilan untuk satu tab — bentuk request yang membuat
 * sebuah app dicap anomali.
 *
 * Hanya yang efektifnya ACTIVE yang diminta (`effective_status`): ad set berjadwal memang ACTIVE
 * di Meta, dan yang saklarnya mati atau campaign-nya jeda (`CAMPAIGN_PAUSED`) tidak akan
 * menyalakan trafik apa pun pada jamnya. Yang MASA DEPAN disaring pemanggilnya
 * (`scheduledLaunchRows`), bukan di sini — keputusan yang tinggal di dalam pemanggil API tidak bisa
 * diuji tanpa menghubungi Meta.
 */
export async function fetchActiveAdSetSchedules(actId, token) {
  const id = normalizeActId(actId);
  const rows = await graphAll(`${id}/adsets`, token, {
    fields:
      "id,name,status,effective_status,start_time,end_time,campaign{id,name,status,start_time}",
    effective_status: JSON.stringify(["ACTIVE"]),
    limit: "500",
  });
  return rows.map((row) => ({
    id: String(row.id || ""),
    name: row.name || "",
    status: row.status || "",
    effectiveStatus: row.effective_status || "",
    startTime: row.start_time || "",
    endTime: row.end_time || "",
    campaignId: String(row.campaign?.id || ""),
    campaign: row.campaign?.name || "",
    campaignStatus: row.campaign?.status || "",
    campaignStartTime: row.campaign?.start_time || "",
  }));
}

function toCountryList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((code) =>
      String(code || "")
        .trim()
        .toUpperCase(),
    )
    .filter(Boolean);
}

/**
 * Angka tiap ad set di dalam satu campaign, untuk satu periode.
 *
 * `goals` adalah peta adSetId -> action_type hasilnya (`adSetGoals` di adsets-core.js). Di tingkat
 * ini pemetaan itu EKSAK: tujuan optimasi adalah milik ad set, jadi tidak ada pemungutan suara
 * seperti di `fetchCampaignResultGoals` — campaign yang ad set-nya beroptimasi berbeda-beda
 * menampilkan angkanya masing-masing alih-alih satu tujuan yang menang.
 *
 * Ad set yang TIDAK tayang sepanjang periode tidak punya baris di sini sama sekali (Meta memang
 * tidak mengirim baris nol). Yang menggabungkannya dengan daftar setelan — dan memutuskan bahwa
 * ketiadaan baris berarti nol, bukan "tidak diketahui" — adalah `mergeAdSetRows`.
 */
export async function fetchAdSetInsights(campaignId, token, range, goals = null) {
  const id = String(campaignId || "").trim();
  if (!id) throw new Error("ID campaign kosong.");
  const rows = await graphAll(`${id}/insights`, token, {
    level: "adset",
    // CTR/CPC/CPM diminta ke Meta, bukan dihitung ulang dari spend/klik — alasan yang sama dengan
    // `cost_per_action_type`: yang dibaca orang di Ads Manager adalah angka Meta sendiri.
    fields:
      "adset_id,spend,impressions,clicks,ctr,cpc,cpm,reach,frequency,actions,cost_per_action_type",
    ...insightsPeriod(range),
    limit: "200",
  });
  return rows.map((r) => {
    const preferred = goals?.get(String(r.adset_id || "")) || [];
    const resultType = resultActionUsed(r.actions, preferred);
    const aliases = resultCostAliases(resultType, preferred);
    return {
      adSetId: String(r.adset_id || ""),
      date: r.date_start || "",
      spend: Number(r.spend || 0),
      impressions: Number(r.impressions || 0),
      clicks: Number(r.clicks || 0),
      reach: Number(r.reach || 0),
      // Kosong, bukan 0: Meta tidak mengirim CTR untuk baris tanpa tayangan, dan "CTR 0%" adalah
      // pernyataan tentang iklan yang pernah dilihat orang.
      ctr: numberOrBlank(r.ctr),
      cpc: numberOrBlank(r.cpc),
      cpm: numberOrBlank(r.cpm),
      frequency: numberOrBlank(r.frequency),
      results: resultsFromActions(r.actions, preferred),
      resultType,
      costPerResult: costPerResultFrom(r.cost_per_action_type, aliases),
    };
  });
}

function numberOrBlank(value) {
  if (value === undefined || value === null || value === "") return "";
  const n = Number(value);
  return Number.isFinite(n) ? n : "";
}

/**
 * Iklan di dalam satu campaign, satu panggilan untuk SELURUH ad set-nya.
 *
 * Ia yang menjawab "aktif tapi tidak ditayangkan". Ad set bisa berstatus ACTIVE — dan efektif
 * ACTIVE juga — sementara satu-satunya iklan di dalamnya ditolak Meta; yang terjadi lalu tidak ada
 * apa-apa, dan tidak ada satu pun field DI AD SET yang menyebutkannya. Campaign RNPX-01 (7 Sep
 * 2026) memperlihatkannya utuh: 5 ad set ACTIVE, tiga di antaranya beriklan `ACTIVE` dan masih
 * berimpresi pukul 14:00, dua sisanya beriklan `DISAPPROVED` dan berhenti sejak pukul 02:00 dan
 * 09:00 — persis pembagian 3/2 yang dibaca operatornya di Ads Manager.
 *
 * Diminta ke edge campaign, bukan per ad set: satu campaign 10 ad set berarti 10 panggilan kalau
 * ditanyakan satu-satu, dan bentuk request seperti itulah yang membuat sebuah app dicap anomali.
 */
export async function fetchCampaignAds(campaignId, token) {
  const id = String(campaignId || "").trim();
  if (!id) throw new Error("ID campaign kosong.");
  // `name` dan creative-nya diminta untuk PEMULIHAN salinan (lihat `repairCopiedAds`): iklan yang
  // tidak ikut tersalin dibuatkan ulang dengan creative iklan sumbernya, dan tanpa ID creative di
  // sini pemulihan itu butuh satu panggilan lagi per iklan. `page_id` ikut karena itulah yang
  // disebut penolakan izin Halaman — kegagalan yang tidak menyebut Halamannya mengirim orang
  // menyisir seluruh Business Manager.
  const rows = await graphAll(`${id}/ads`, token, {
    fields: "id,name,adset_id,status,effective_status,creative{id,object_story_spec{page_id}}",
    limit: "500",
  });
  return rows.map((row) => ({
    id: String(row.id || ""),
    name: row.name || "",
    adSetId: String(row.adset_id || ""),
    creativeId: String(row.creative?.id || ""),
    pageId: String(row.creative?.object_story_spec?.page_id || ""),
    status: row.status || "",
    // Yang menentukan tayang-tidaknya justru yang ini: `status` iklan tetap ACTIVE walau Meta sudah
    // menolaknya, dan itu sebabnya kolom Status di Ads Manager dan saklarnya bisa berselisih.
    effectiveStatus: row.effective_status || "",
  }));
}

/**
 * Nama iklan yang BENAR-BENAR berdiri di sebuah ad set.
 *
 * Dipakai pemulihan salinan untuk tahu iklan mana yang belum ada, dan hanya dipanggil kalau salinan
 * ad set itu melahirkan SEBAGIAN iklannya — keadaan yang jarang. Dicocokkan lewat nama karena salinan
 * Meta tidak mengganti nama iklan (`NO_RENAME`), dan tanpa itu satu-satunya pilihan adalah membuat
 * ulang semuanya: iklan kembar di ad set yang sudah punya isinya.
 */
export async function fetchAdSetAdNames(adSetId, token) {
  const id = String(adSetId || "").trim();
  if (!id) throw new Error("ID ad set kosong.");
  const rows = await graphAll(`${id}/ads`, token, { fields: "id,name", limit: "200" });
  return rows.map((row) => String(row.name || ""));
}
