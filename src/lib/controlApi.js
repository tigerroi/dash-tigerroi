import { supabase } from "../config/supabase";

/**
 * Klien server kontrol (Bun + Elysia, lihat server/).
 *
 * Namanya "kontrol" dan bukan "gating" karena server itu sekarang memegang dua hal: gating campaign
 * Keitaro DAN saklar on/off campaign Meta. Keduanya punya masalah yang sama — tombolnya menulis niat
 * ke RTDB lalu menunggu cron dua menitan — dan server yang sama menghapus tunggu itu untuk keduanya.
 *
 * Yang dibawanya dibanding antrean RTDB: gate/ungate SEKETIKA alih-alih menunggu siklus dua menit,
 * dan pratinjau SEGAR alih-alih salinan yang bisa berumur sepuluh menit.
 *
 * API key vi-control TIDAK ada di sini dan tidak boleh pernah ada. Yang dikirim browser adalah ID
 * token Firebase miliknya sendiri — token yang sama yang sudah dipakai untuk membaca RTDB — dan
 * server yang mencocokkan uid-nya dengan `/roles/{uid}`, tempat yang sama yang dibaca
 * `database.rules.json`.
 *
 * Kalau `VITE_GATING_API_URL` tidak di-set, seluruh modul ini diam dan halaman jatuh ke antrean
 * RTDB. Itu bukan mode darurat melainkan jalur yang memang tetap bekerja: server ini boleh mati,
 * boleh belum dipasang, dan gating tetap jalan — lebih lambat.
 */

// `VITE_GATING_API_URL` masih dibaca sebagai nama lama supaya konfigurasi yang sudah dipasang tidak
// mati diam-diam saat namanya berubah.
const BASE = String(
  import.meta.env.VITE_CONTROL_API_URL || import.meta.env.VITE_GATING_API_URL || "",
).replace(/\/+$/, "");

export const CONTROL_API_ENABLED = Boolean(BASE);

export class ControlApiError extends Error {
  constructor(message, { status = 0, offline = false, body = null } = {}) {
    super(message);
    this.status = status;
    // Dibedakan karena akibatnya berbeda: yang `offline` layak dicoba lagi lewat antrean, yang
    // ditolak server (403, 422) tidak akan berubah hasilnya lewat jalur mana pun.
    this.offline = offline;
    // Jawaban server apa adanya. Dialog halaman Campaign membaca `needsConfirm` + `subDomain` dari
    // sini untuk menanyakan konfirmasi, bukan menebaknya dari kalimat error.
    this.body = body;
  }
}

/**
 * Pengamat tiap panggilan ke server kontrol — dipasang `activityRecorder`, dipakai jejak aktivitas.
 *
 * Sebuah SLOT dan bukan `import` dari sana, supaya arah impornya tetap satu arah: pencatat jejak
 * memakai modul ini untuk mengirim jejaknya sendiri, jadi modul ini yang mengimpor pencatat akan
 * membuat lingkaran — dan lingkaran impor yang bekerja hari ini adalah lingkaran yang pecah pada
 * hari salah satu sisinya berubah jadi konstanta yang dibaca saat modul dimuat.
 *
 * Yang lewat sini adalah operasi paling mahal di seluruh dashboard: gate/ungate trafik iklan,
 * saklar campaign Meta, dan penulisan pengaturan iklan ke armada situs. Tidak satu pun dari
 * ketiganya menyentuh RTDB dari browser, jadi tanpa pengamat ini merekalah yang justru hilang dari
 * log audit.
 */
let observer = null;

export function observeControlRequests(fn) {
  observer = fn;
}

async function request(path, { method = "GET", payload } = {}) {
  if (!BASE) throw new ControlApiError("Server kontrol belum dikonfigurasi.", { offline: true });

  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new ControlApiError("Sesi login sudah berakhir.", { status: 401 });

  // Unggah gambar mengirim FormData: Content-Type-nya TIDAK boleh diisi sendiri — yang menyusun
  // batas multipart-nya browser, dan header yang ditulis tangan kehilangan `boundary=` sehingga
  // server menerima badan yang tidak bisa diurai. Ia juga tidak di-JSON-kan.
  const multipart = typeof FormData !== "undefined" && payload instanceof FormData;

  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(payload && !multipart ? { "Content-Type": "application/json" } : {}),
      },
      body: multipart ? payload : payload ? JSON.stringify(payload) : undefined,
    });
  } catch (error) {
    // Server mati, DNS gagal, CORS ditolak — semuanya sampai ke sini sebagai TypeError tanpa detail.
    // Ditandai offline supaya pemanggilnya tahu antrean masih layak dicoba.
    report(path, method, "tak terjangkau");
    throw new ControlApiError(`Server kontrol tidak bisa dihubungi: ${error.message}`, {
      offline: true,
    });
  }

  const body = await res.json().catch(() => null);
  report(path, method, res.ok ? "ok" : `HTTP ${res.status}`);
  if (!res.ok) {
    throw new ControlApiError(body?.error || `Server kontrol menjawab HTTP ${res.status}.`, {
      status: res.status,
      // 502/503 = servernya hidup tapi tidak bisa menyelesaikan (Keitaro mati, RTDB tak
      // terjangkau). Antrean tidak akan lebih berhasil sekarang, tapi siklus berikutnya bisa.
      offline: res.status === 502 || res.status === 503,
      body,
    });
  }
  return body;
}

/**
 * Laporkan satu panggilan ke pengamat, kalau ada.
 *
 * `/activity-logs` DILEWATI, dan itu bukan penghematan: pengirimannya sendiri lewat `request`, jadi
 * mencatatnya akan menghasilkan satu jejak baru tiap kali jejak dikirim — penyangga yang tidak
 * pernah bisa kosong, dan lima menit sekali ia tumbuh alih-alih menyusut.
 *
 * Tidak pernah melempar: sebuah pencatat yang menggagalkan gate/ungate yang dicatatnya adalah
 * kerusakan yang jauh lebih mahal daripada baris yang hilang.
 */
function report(path, method, outcome) {
  if (!observer || path.startsWith("/activity-logs")) return;
  try {
    observer({ path, method, outcome });
  } catch {
    // Sengaja diam.
  }
}

// Pratinjau segar, diambil saat dialog konfirmasi dibuka.
export function fetchPreview(campaignId) {
  return request(`/gating/campaigns/${encodeURIComponent(campaignId)}/preview`);
}

// Gate/ungate seketika. SELALU 200 kalau sampai ke vi-control — yang menentukan hasilnya field
// `status` (`ok` / `aborted` / `problem`), sama seperti API di baliknya.
export function runGate(campaignId, action) {
  return request(`/gating/campaigns/${encodeURIComponent(campaignId)}/${action}`, {
    method: "POST",
  });
}

/**
 * "Impor dari Google" — network GAM/AdSense, domain, dan subdomain.
 *
 * `kind` adalah kunci resource-nya apa adanya ("gamAccounts", "adsenseAccounts", "domains",
 * "subDomains"), sama dengan yang dipakai `src/config/resources.js`. Server yang memilih fungsi
 * impornya, dan fungsi itu SAMA dengan yang dipanggil CLI di functions/.
 *
 * Tidak ada antrean RTDB sebagai cadangan di sini — berbeda dari gating dan saklar campaign, dan
 * sama seperti /plugin: yang harus dijalankan adalah pembacaan API Google yang butuh refresh token,
 * dan itu tidak pernah ada di browser. Kalau server tak terjangkau, jalur yang tersisa adalah CLI.
 *
 * Bisa berjalan MENIT-an: dua di antaranya menjalankan laporan GAM yang di-poll sampai satu menit
 * per network.
 */
export function runDiscover(kind) {
  return request(`/discover/${encodeURIComponent(kind)}`, { method: "POST" });
}

export function requestRefresh() {
  return request("/gating/refresh", { method: "POST" });
}

/**
 * Nyalakan/matikan satu campaign Meta, sekarang juga.
 *
 * `userId` ikut dikirim karena /users dikunci push-key: campaign tinggal di dalam baris profil
 * seseorang, dan tanpa tahu baris mana, server tidak bisa memeriksa kepemilikannya sama sekali.
 * Server tetap mencari campaign-nya sendiri di baris itu — yang dikirim dari sini tidak dipercaya.
 */
export function setCampaignStatusNow(userId, campaignId, status) {
  return request(`/campaigns/${encodeURIComponent(campaignId)}/status`, {
    method: "POST",
    payload: { userId, status },
  });
}

/**
 * Ad set di dalam satu campaign, diambil saat barisnya dibuka di /users/{uid}.
 *
 * TIDAK ada cadangan RTDB, dan tidak perlu ada: yang dibaca bukan niat yang bisa diantrekan
 * melainkan keadaan Meta pada detik ini, dan ia memang tidak dicerminkan ke database sama sekali
 * (satu ad account memuat ratusan ad set — lihat komentarnya di functions/meta.js). Server yang
 * mati berarti panelnya tidak bisa dibuka, bukan angka yang basi tanpa tanda.
 *
 * `userId` ikut dikirim dengan alasan yang sama seperti saklar campaign: /users dikunci push-key,
 * jadi tanpa tahu baris profil mana, server tidak bisa memeriksa bahwa ID campaign yang dioper
 * memang milik akun yang dituju — dan tanpa itu endpoint ini jadi proxy Meta untuk campaign siapa
 * saja di Business Manager.
 */
export function fetchCampaignAdSets(userId, campaignId) {
  return request(
    `/campaigns/${encodeURIComponent(campaignId)}/adsets?userId=${encodeURIComponent(userId)}`,
  );
}

/**
 * Nyalakan/matikan satu ad set, sekarang juga.
 *
 * TIDAK ada cadangan antrean RTDB — berbeda dari saklar campaign di atas, dan sepola /plugin: ad
 * set tidak dicerminkan ke RTDB sama sekali, jadi tidak ada baris yang bisa diantrekan maupun
 * ditandai "menunggu". Panel yang memuat saklar ini pun cuma bisa dibuka lewat server yang sama,
 * jadi server yang mati menghilangkan saklarnya berikut panelnya — bukan menundanya diam-diam.
 *
 * `campaignId` ikut dikirim bukan sebagai hiasan: server memakainya untuk membuktikan ad set ini
 * memang milik campaign yang memang milik user itu. Ketiganya diperiksa di sana, dan tidak satu pun
 * dipercaya dari sini.
 */
export function setAdSetStatusNow(userId, campaignId, adSetId, status) {
  return request(
    `/campaigns/${encodeURIComponent(campaignId)}/adsets/${encodeURIComponent(adSetId)}/status`,
    { method: "POST", payload: { userId, status } },
  );
}

/**
 * Mulai consent Google untuk satu kredensial di /google-api-configs.
 *
 * Yang dikembalikan cuma URL-nya; yang mengarahkan browser ke sana adalah halaman. URL itu hanya
 * bisa dibentuk di server karena `state` sekali pakai yang menjaga callback-nya harus tertulis di
 * record kredensialnya SEBELUM orangnya sampai ke layar Google — sebuah state yang dikarang browser
 * tidak menjaga apa pun.
 *
 * Menggantikan `VITE_OAUTH_FN_URL` (Cloud Function gen1 `oauth`), yang di bawah DRS tidak pernah
 * bisa dipanggil browser sama sekali — karena itu tombolnya selama ini disembunyikan dan consent
 * hanya bisa lewat `cd functions && npm run authorize`.
 */
export function startGoogleAuth(configId) {
  return request(`/google/configs/${encodeURIComponent(configId)}/consent`, { method: "POST" });
}

/**
 * Manajemen plugin RabbitROI di tiap situs WordPress.
 *
 * BEDA PALING PENTING dari gating dan saklar campaign di atas: yang ini TIDAK punya jalur cadangan.
 *
 * Keduanya di atas menulis niat ke antrean RTDB kalau server tak terjangkau, dan cron yang
 * menyelesaikannya — jadi server yang mati memperlambat, tidak mematikan. Di sini tidak ada yang
 * bisa diantrekan: enroll token dan api_key tiap situs tinggal di server, dan situsnya sendiri
 * tidak akan menjawab browser (endpoint plugin tidak mengirim header CORS untuk origin dashboard,
 * jadi `fetch` dari halaman ditolak sebelum sampai ke PHP-nya).
 *
 * Karena itu halaman /plugin memeriksa `CONTROL_API_ENABLED` dan mengatakan apa adanya kalau server
 * belum dikonfigurasi — bukan menggambar tombol yang pasti gagal.
 */

// Skema field: satu-satunya definisi, dipakai server untuk memvalidasi dan halaman untuk menggambar
// form. Diambil sekali per sesi — isinya statis, dan yang mengubahnya adalah deploy server.
export function fetchPluginSchema() {
  return request("/plugin/schema");
}

export function enrollPluginSite(subdomainId) {
  return request(`/plugin/sites/${encodeURIComponent(subdomainId)}/enroll`, { method: "POST" });
}

export function resetPluginSite(subdomainId) {
  return request(`/plugin/sites/${encodeURIComponent(subdomainId)}/reset`, { method: "POST" });
}

// POST walau ia cuma membaca: ia menulis cermin status di RTDB, dan GET yang mengubah keadaan
// adalah GET yang akan diulang browser atau tombol back tanpa diminta.
export function pingPluginSite(subdomainId) {
  return request(`/plugin/sites/${encodeURIComponent(subdomainId)}/ping`, { method: "POST" });
}

export function fetchPluginConfig(subdomainId, group) {
  return request(`/plugin/sites/${encodeURIComponent(subdomainId)}/config/${group}`);
}

/**
 * Simpan sebagian pengaturan satu situs.
 *
 * Jawabannya membawa `unapplied` — nama field yang dikirim tapi TIDAK berubah di situs. Plugin
 * mengabaikan nilai enum yang tidak sah sambil tetap menjawab 200, jadi tanpa daftar ini
 * "Tersimpan." di layar bisa berarti tidak ada satu pun yang tersimpan.
 */
export function savePluginConfig(subdomainId, group, values) {
  return request(`/plugin/sites/${encodeURIComponent(subdomainId)}/config/${group}`, {
    method: "POST",
    payload: { values },
  });
}

export function fetchPluginLandings(subdomainId) {
  return request(`/plugin/sites/${encodeURIComponent(subdomainId)}/landings`);
}

export function fetchPluginLanding(subdomainId, landingId) {
  return request(
    `/plugin/sites/${encodeURIComponent(subdomainId)}/landings/${encodeURIComponent(landingId)}`,
  );
}

// Landing dari preset "Buat LP Baru" → { id, slug, url, parameterKey, parameterValue, link }.
export function createPluginLandingPreset(subdomainId, slug = "") {
  return request(`/plugin/sites/${encodeURIComponent(subdomainId)}/landings/create`, {
    method: "POST",
    payload: slug ? { slug } : {},
  });
}

export function fetchPluginLandingLink(subdomainId, landingId) {
  return request(
    `/plugin/sites/${encodeURIComponent(subdomainId)}/landings/${encodeURIComponent(landingId)}/link`,
  );
}

// Landing + campaign Keitaro (salinan template) untuk tautan landing ini, lalu gate vi-control.
export function createKeitaroCampaign(subdomainId, url, namePrefix = "") {
  return request(`/keitaro/sites/${encodeURIComponent(subdomainId)}/campaign`, {
    method: "POST",
    payload: { url, namePrefix },
  });
}

export function fetchPluginLicense(subdomainId) {
  return request(`/plugin/sites/${encodeURIComponent(subdomainId)}/license`);
}

export function savePluginLicense(subdomainId, licenseKey, force = false) {
  return request(`/plugin/sites/${encodeURIComponent(subdomainId)}/license`, {
    method: "POST",
    payload: { licenseKey, ...(force ? { force: true } : {}) },
  });
}

export function fetchPluginDeployment(subdomainId) {
  return request(`/plugin/sites/${encodeURIComponent(subdomainId)}/deployment`);
}

// Menjawab begitu dimulai; hasilnya di `subDomains/{id}/siteTasks/deployment`.
export function runPluginDeployment(subdomainId, tasks) {
  return request(`/plugin/sites/${encodeURIComponent(subdomainId)}/deployment`, {
    method: "POST",
    payload: { tasks },
  });
}

// Rakit menu Main Nav + Footer. Hasilnya di `subDomains/{id}/siteTasks/menus`.
export function runPluginMenus(subdomainId) {
  return request(`/plugin/sites/${encodeURIComponent(subdomainId)}/menus`, { method: "POST" });
}

export function fetchPluginLegalPages(subdomainId) {
  return request(`/plugin/sites/${encodeURIComponent(subdomainId)}/legal-pages`);
}

// Kunci AI di BODY. Hasilnya di `subDomains/{id}/siteTasks/legal`.
export function runPluginLegalPages(subdomainId, aiKey, pages) {
  return request(`/plugin/sites/${encodeURIComponent(subdomainId)}/legal-pages`, {
    method: "POST",
    payload: { aiKey, pages },
  });
}

// Satu endpoint untuk create dan update, persis seperti API plugin: yang membedakan adalah ada
// tidaknya `id` di dalam `values`.
export function savePluginLanding(subdomainId, values) {
  return request(`/plugin/sites/${encodeURIComponent(subdomainId)}/landings`, {
    method: "POST",
    payload: { values },
  });
}

/**
 * AutoPost — kunci AI ada di BODY, tidak pernah di alamat.
 *
 * Alamat masuk ke log akses server kontrol, ke riwayat browser, dan ke header `Referer` yang ikut
 * tiap permintaan berikutnya. Tiga tempat yang tidak satu pun dijaga sekeras body request, untuk
 * kredensial yang ditagihkan per panggilan ke pemiliknya.
 */
export function generatePluginKeywords(subdomainId, aiKey, values) {
  return request(`/plugin/sites/${encodeURIComponent(subdomainId)}/autopost/keywords`, {
    method: "POST",
    payload: { aiKey, values },
  });
}

/**
 * Kirim N kata kunci sebagai N job. SELALU 200 kalau sampai ke server — hasilnya per KATA KUNCI.
 *
 * Sepola dengan terapkan-massal di bawah, dan di sini alasannya lebih keras: job yang sudah lahir
 * tidak bisa ditarik kembali, jadi satu kata kunci yang ditolak di tengah daftar tidak boleh
 * terbaca sebagai "tidak ada yang terkirim" — mengulanginya dari awal menghasilkan artikel ganda.
 */
export function submitPluginAutopost(subdomainId, aiKey, keywords, values) {
  return request(`/plugin/sites/${encodeURIComponent(subdomainId)}/autopost`, {
    method: "POST",
    payload: { aiKey, keywords, values },
  });
}

// Di-poll selama masih ada job berjalan. TIDAK menyentuh RTDB sama sekali di sisi server — lihat
// `listAutopost` di functions/sync-plugin.mjs.
export function fetchPluginAutopostJobs(subdomainId, query = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    const text = String(value ?? "").trim();
    if (text) params.set(key, text);
  }
  const search = params.toString();
  return request(
    `/plugin/sites/${encodeURIComponent(subdomainId)}/autopost/jobs${search ? `?${search}` : ""}`,
  );
}

// Satu job BERIKUT lognya, dibaca saat barisnya dibuka. Daftar di atas sengaja tidak membawa log:
// satu job yang berjalan lima menit menumpuk puluhan baris, dan menariknya ulang tiap tiga detik
// untuk dua puluh job memindahkan ratusan kilobyte demi satu kolom persentase.
export function fetchPluginAutopostJob(subdomainId, jobId) {
  return request(
    `/plugin/sites/${encodeURIComponent(subdomainId)}/autopost/job/${encodeURIComponent(jobId)}`,
  );
}

// Terapkan massal. SELALU 200 kalau sampai ke server — hasilnya per situs di `results`, dan
// `summary` memisahkan yang berhasil, yang tersimpan-tanpa-berubah, dan yang gagal.
export function enrollPluginSites(siteIds) {
  return request("/plugin/bulk/enroll", { method: "POST", payload: { siteIds } });
}

export function savePluginConfigMany(siteIds, group, values) {
  return request(`/plugin/bulk/config/${group}`, { method: "POST", payload: { siteIds, values } });
}

/**
 * Kirim satu batch jejak aktivitas (lihat src/lib/activityLog.js).
 *
 * TIDAK ada antrean RTDB sebagai cadangan, dan itu bukan kelalaian — sama seperti /plugin, tapi
 * dengan alasan yang berbeda dan lebih tajam: DUA field terpenting di baris ini hanya ada di sisi
 * server. Browser tidak tahu alamat IP publiknya sendiri, dan `User-Agent` yang ditulis browser
 * tentang dirinya sendiri adalah klaim, bukan bukti. Sebuah jalur yang membiarkan halaman menulis
 * langsung ke RTDB akan menghasilkan log audit yang setiap barisnya bisa dikarang oleh yang
 * dicatatnya.
 *
 * Yang menggantikan cadangan itu adalah penyangga di localStorage: server yang mati tidak
 * menghilangkan satu baris pun, ia cuma menundanya sampai ada yang menerimanya.
 */
export function sendActivityLogs(events) {
  return request("/activity-logs", { method: "POST", payload: { events } });
}

/**
 * Baca sepotong jejak untuk halaman /activity-logs.
 *
 * Sejak jejak tinggal di SQLite server (bukan lagi RTDB), halaman tidak bisa lagi berlangganan
 * langsung — ia meminta rentang tanggal yang sedang dipilih ke sini. Gerbangnya superadmin di sisi
 * server; token yang sama yang menjaga endpoint lain di modul ini yang membawanya.
 */
export function fetchActivityLogs({ start, end } = {}) {
  const params = new URLSearchParams();
  if (start) params.set("start", start);
  if (end) params.set("end", end);
  const qs = params.toString();
  return request(`/activity-logs${qs ? `?${qs}` : ""}`);
}

/**
 * Log "Sync Otomatis" untuk halaman Settings.
 *
 * Sejak log pindah ke SQLite server (dari `dashboard/syncRuns` di RTDB), halaman memintanya ke sini.
 * `syncStatus` (hitung mundur di topbar) TETAP di RTDB dan tetap lewat store — cuma log historisnya
 * yang pindah. Gerbangnya admin di sisi server.
 */
/**
 * Jadwal tayang armada untuk tab "Terjadwal" di Overview — ad set yang akan mulai tayang, berikut
 * PIC-nya. Dibaca server dari Meta dengan cermin BERSAMA dua menit; `refresh` melewatinya, tapi
 * server menahannya ke paling sering tiap 30 detik.
 */
export function fetchScheduledLaunches({ refresh = false } = {}) {
  return request(`/scheduled-launches${refresh ? "?refresh=1" : ""}`);
}

// Geser jam mulai satu ad set yang belum tayang (admin atau pemilik ad account-nya). `startTime`
// jam operasi "YYYY-MM-DDTHH:MM"; yang menormalkan dan menolaknya server (`shiftedStartTime`).
export function shiftAdSetStart(adSetId, startTime) {
  return request(`/scheduled-launches/adsets/${encodeURIComponent(adSetId)}/start`, {
    method: "POST",
    payload: { startTime },
  });
}

export function fetchSyncRuns() {
  return request("/sync-runs");
}

// Jalankan SATU tahap sync sekarang (admin). Menjawab begitu run-nya berangkat; hasilnya tercatat
// di log run yang sama.
export function runSyncStageNow(stage) {
  return request("/sync-runs/stages", { method: "POST", payload: { stage } });
}

/**
 * Ganti versi plugin di beberapa situs sekaligus.
 *
 * `version` kosong = rilis stabil terbaru (server yang menerjemahkannya jadi body `{}`, sesuai
 * kontrak API plugin). SELALU 200 kalau sampai ke server — hasilnya per situs di `results`, karena
 * batch yang berhenti di tengah meninggalkan armada dengan dua versi plugin tanpa catatan mana yang
 * sudah.
 */
export function updatePluginSites(siteIds, version) {
  return request("/plugin/bulk/update", { method: "POST", payload: { siteIds, version } });
}

/**
 * Inject kode iklan Ad Manager. Alurnya dimulai dari SUBDOMAIN: `fetchGptNetworks` menjawab akun GAM,
 * network code, properti, dan unit iklan tiap subdomain terpilih (dibaca server dari /gam-accounts dan
 * Ad Manager API). Pratinjau dan inject mengirim PILIHAN (ukuran, jumlah slot, kode unit per network)
 * — path unit dan div id disusun server dari daftar Ad Manager, tidak pernah dari request.
 */
export function fetchGptNetworks(siteIds) {
  return request("/plugin/gpt/networks", { method: "POST", payload: { siteIds } });
}

// Pratinjau SELURUH subdomain terpilih — tiap situs membawa stempel div-nya sendiri (`divStamp`).
export function previewGptInject(siteIds, options, adUnitCodes) {
  return request("/plugin/gpt/preview", {
    method: "POST",
    payload: { siteIds, options, adUnitCodes },
  });
}

// `dryRun` membaca tiap situs dan melaporkan rencananya (header diganti/ditambahkan, kotak mana yang
// dikosongkan) tanpa menulis. SELALU 200 kalau pilihannya sah — hasilnya per situs.
export function injectGptSites(siteIds, options, adUnitCodes, { dryRun = false } = {}) {
  return request("/plugin/bulk/gpt-inject", {
    method: "POST",
    payload: { siteIds, options, adUnitCodes, dryRun },
  });
}

/**
 * Inject kode iklan AdSense. Yang dikirim adalah KODE UTUH yang ditempel dari halaman AdSense, per
 * subdomain — slot AdSense tidak bisa dibuat lewat API. Server mengurainya, mencocokkan slotnya dengan
 * ad unit akun itu, lalu hanya menulis Kode iklan 1…N + Jumlah slot iklan (header tidak disentuh).
 */
// `{ accounts: [{ accountName, publisherId, siteCount, error }], sites: { subdomainId: { accountName, publisherId } } }`
export function fetchAdsenseSites() {
  return request("/plugin/adsense/sites");
}

export function checkAdsenseCodes(siteId, codes) {
  return request("/plugin/adsense/check", { method: "POST", payload: { siteId, codes } });
}

// `items: [{ siteId, codes }]`. SELALU 200 kalau bentuknya sah — hasil per situs, termasuk kode yang
// ditolak di baris situs itu saja.
export function injectAdsenseSites(items, { dryRun = false } = {}) {
  return request("/plugin/bulk/adsense-inject", { method: "POST", payload: { items, dryRun } });
}

/**
 * Cek situs: baca kode iklan, CMP, network code AdX, landing page, dan behaviour tiap subdomain lalu
 * nilai di server. Tidak menulis ke situs. Paling banyak 20 id per panggilan — halamannya mengirim
 * per gelombang (`AUDIT_BATCH`). SELALU 200 — hasilnya per situs, `detail` berisi penilaiannya.
 */
export function auditPluginSites(siteIds) {
  return request("/plugin/audit", { method: "POST", payload: { siteIds } });
}

/**
 * DNS Cloudflare — tab "DNS Record" di halaman Domains.
 *
 * Sekelas /plugin dalam hal yang paling menentukan: TIDAK ADA JALUR CADANGAN. Token Cloudflare
 * tinggal di server (ia bisa mengubah ke mana setiap domain kita menunjuk, jadi ia tidak boleh
 * pernah ada di bundle ini), dan Cloudflare tidak mengirim header CORS untuk origin dashboard —
 * `fetch` langsung dari halaman ditolak sebelum sampai ke API-nya. Karena itu halamannya memeriksa
 * `CONTROL_API_ENABLED` dan mengatakan apa adanya kalau server belum dikonfigurasi, bukan
 * menggambar tombol yang pasti gagal.
 *
 * Tidak ada cermin RTDB juga, dan itu bukan kelalaian: yang dicari orang di layar ini adalah keadaan
 * DNS pada detik ini — sebuah cermin sejam lalu justru jawaban yang salah, dan dua sumber untuk satu
 * keadaan berarti dua jawaban yang berbeda suatu hari. Sepola panel ad set.
 */
export function fetchDnsZones() {
  return request("/cloudflare/zones");
}

export function fetchDnsRecords(zoneId) {
  return request(`/cloudflare/zones/${encodeURIComponent(zoneId)}/dns`);
}

export function createDnsRecordNow(zoneId, values) {
  return request(`/cloudflare/zones/${encodeURIComponent(zoneId)}/dns`, {
    method: "POST",
    payload: values,
  });
}

export function updateDnsRecordNow(zoneId, recordId, values) {
  return request(
    `/cloudflare/zones/${encodeURIComponent(zoneId)}/dns/${encodeURIComponent(recordId)}`,
    { method: "POST", payload: values },
  );
}

/**
 * POST, bukan DELETE — CORS server kontrol mengizinkan GET dan POST saja, dan melebarkannya demi
 * satu route berarti mengubah aturan yang menjaga gate/ungate dan saklar campaign juga. Alasan
 * lengkapnya di server/cloudflare.js.
 */
export function deleteDnsRecordNow(zoneId, recordId) {
  return request(
    `/cloudflare/zones/${encodeURIComponent(zoneId)}/dns/${encodeURIComponent(recordId)}/delete`,
    { method: "POST" },
  );
}

/**
 * Setup Sub (/plugin/setup-sub): site CloudPanel + WordPress + SSL + plugin untuk satu subdomain terdaftar.
 * Menjawab begitu setup MULAI; kemajuannya dibaca dari `subDomains/{id}/setup` yang sudah dilanggan.
 */
// Banyak sekaligus. Server menjalankannya BERURUTAN; jawabannya { queued, skipped }.
// `licenses` = license key PER SUB (id -> key; tiap situs butuh lisensinya sendiri). `config` = peta
// grup pengaturan -> nilai, sama untuk seluruh id (sub satu domain). Yang kosong tidak dikirim.
// `site` = langkah situs sesudah enroll ({ deployment, legal, legalPages, autopost, menus, aiKey }),
// diteruskan apa adanya; server yang memvalidasinya.
export function setupSubMany(ids, { licenses = {}, config = null, site = {} } = {}) {
  const keys = Object.fromEntries(
    Object.entries(licenses)
      .map(([id, key]) => [id, String(key || "").trim()])
      .filter(([id, key]) => key && ids.includes(id)),
  );
  const groups = config
    ? Object.fromEntries(Object.entries(config).filter(([, values]) => Object.keys(values).length))
    : {};
  return request("/setup-sub/bulk", {
    method: "POST",
    payload: {
      ids,
      ...(Object.keys(keys).length ? { licenses: keys } : {}),
      ...(Object.keys(groups).length ? { config: groups } : {}),
      ...site,
    },
  });
}

/**
 * Halaman Campaign (/campaigns) — salin dan ubah campaign Meta. SUPERADMIN.
 *
 * TIDAK ADA JALUR CADANGAN, sepola saklar ad set: token Meta tinggal di server, dan yang diubah di
 * sini tidak dicerminkan ke RTDB sebagai niat yang bisa diantrekan. Server yang mati berarti
 * tombolnya tidak digambar, bukan tulisan yang diam-diam menunggu.
 *
 * `userId` ikut tiap panggilan dengan alasan yang sama dengan saklar campaign: server mencari
 * campaign-nya di profil itu, dan tidak mempercayai ID yang dikirim dari sini.
 */
export function copyCampaignNow(userId, campaignId, { name, count, confirmSubDomain } = {}) {
  return request(`/fleet/campaigns/${encodeURIComponent(campaignId)}/copies`, {
    method: "POST",
    payload: { userId, name, count, confirmSubDomain },
  });
}

export function fetchCampaignEdit(userId, campaignId) {
  return request(
    `/fleet/campaigns/${encodeURIComponent(campaignId)}?userId=${encodeURIComponent(userId)}`,
  );
}

export function updateCampaignNow(userId, campaignId, changes) {
  return request(`/fleet/campaigns/${encodeURIComponent(campaignId)}`, {
    method: "POST",
    payload: { userId, ...changes },
  });
}

export function fetchAdSetEdit(userId, campaignId, adSetId) {
  return request(
    `/fleet/campaigns/${encodeURIComponent(campaignId)}/adsets/${encodeURIComponent(adSetId)}?userId=${encodeURIComponent(userId)}`,
  );
}

export function updateAdSetNow(userId, campaignId, adSetId, changes) {
  return request(
    `/fleet/campaigns/${encodeURIComponent(campaignId)}/adsets/${encodeURIComponent(adSetId)}`,
    { method: "POST", payload: { userId, ...changes } },
  );
}

/**
 * Tombol Buat di /campaigns — bahan form, unggah gambar, dan pembuatannya sendiri.
 *
 * `accountId` dan `subDomainId` adalah KUNCI RTDB, bukan alamat Meta: server yang membacanya jadi
 * `act_…` dan link iklan, dengan alasan yang sama seperti `userId` di route salin — apa pun yang
 * dikirim dari sini tidak boleh bisa menunjuk ad account atau subdomain orang lain.
 */
export function fetchCampaignAssets(accountId) {
  return request(`/fleet/accounts/${encodeURIComponent(accountId)}/assets`);
}

/**
 * Unggah satu gambar ke pustaka ad account. Multipart, bukan JSON base64: nama berkasnya ikut
 * tersimpan di pustaka Meta, dan pustaka yang seluruh barisnya bernama sama tidak bisa dipilih orang.
 */
export function uploadCampaignImage(accountId, file) {
  const form = new FormData();
  form.set("file", file, file.name);
  return request(`/fleet/accounts/${encodeURIComponent(accountId)}/images`, {
    method: "POST",
    payload: form,
  });
}

export function createCampaignNow(payload) {
  return request("/fleet/campaigns", { method: "POST", payload });
}

// Lanjutkan job Buat campaign yang selesai SEBAGIAN, dari rencana yang tersimpan di job-nya.
export function resumeCreateJobNow(jobId) {
  return request(`/fleet/create-jobs/${encodeURIComponent(jobId)}/resume`, {
    method: "POST",
    payload: {},
  });
}
