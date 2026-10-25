// Logika murni untuk Management API plugin RabbitROI yang terpasang di tiap subdomain WordPress:
// bentuk alamat, pembacaan amplop jawaban, skema field, dan penjaga "tersimpan tapi tidak berubah".
//
// Dipisah dari plugin-api.mjs (yang memanggil jaringan) dan sync-plugin.mjs (yang menulis ke RTDB)
// supaya semuanya bisa diuji tanpa satu pun situs WordPress hidup — sama seperti gating-core.js
// terhadap keitaro-gate.js.

// Namespace REST plugin. Versi pluginnya sendiri boleh naik (fitur ini ada sejak 0.4.7); yang tidak
// boleh ikut naik diam-diam adalah `v1` di sini — kalau plugin merilis `v2`, alamat lama akan
// menjawab 404 dan itu harus terbaca sebagai perubahan yang disengaja, bukan sebagai situs mati.
export const PLUGIN_NAMESPACE = "/wp-json/rabbitroi/v1/manage";

/**
 * Dua node, dan pemisahannya BUKAN kerapian.
 *
 * `pluginSites` adalah cermin status (enroll, versi, ping terakhir) — itu yang dilanggan halaman.
 * `pluginKeys` memuat `api_key` tiap situs, dan tidak ada satu pun kode di `src/` yang membacanya.
 *
 * Izin baca RTDB MENURUN: satu `.read` di induk memberi seluruh anak, dan aturan yang lebih dalam
 * tidak bisa menariknya kembali. Digabung jadi satu node, tiap superadmin yang membuka halaman ini
 * akan mengunduh seluruh api_key ke browsernya hanya untuk melihat kolom "Versi".
 *
 * Yang TIDAK dijaga pemisahan ini: aturan database keduanya sama (admin|superadmin), jadi seseorang
 * yang mengetik path-nya sendiri tetap bisa membacanya. Yang dihapus adalah keharusan — bukan
 * kemungkinan. Kunci ini tidak bisa dienkripsi di sini, lihat catatan `pluginKeyEntry`.
 */
export const PLUGIN_SITES_PATH = "pluginSites";
export const PLUGIN_KEYS_PATH = "pluginKeys";

// Cabang isu sync-nya, sejajar dengan `gamAccounts`/`adsenseAccounts`/`gating`. Namanya sama dengan
// key halaman supaya ikon peringatan di topbar menunjuk halaman yang benar.
export const PLUGIN_ISSUES_BRANCH = "plugin";

// Grup pengaturan yang bisa dibaca/ditulis. Nilainya adalah SEGMEN ALAMAT di API plugin, jadi
// daftar ini sekaligus yang memvalidasi `:group` — tanpa itu, `:group` dari request akan disambung
// mentah ke URL dan siapa pun bisa mengarahkannya ke endpoint plugin mana pun, termasuk AutoPost
// yang sengaja tidak didokumentasikan.
export const PLUGIN_GROUPS = ["ads-settings", "header-footer", "behaviour", "cmp", "security"];

/**
 * Error yang datang DARI plugin, dibedakan dari error jaringan.
 *
 * `code` dipertahankan apa adanya karena tiap kode menuntut tindakan yang berbeda dan tidak satu
 * pun bisa disimpulkan dari kode HTTP-nya: `already_enrolled` (409) diperbaiki dengan reset,
 * `not_enrolled` (403) dengan enroll, `invalid_key` (401) dengan reset + enroll ulang — ketiganya
 * akan terbaca sebagai "gagal" yang sama kalau hanya statusnya yang sampai ke layar.
 */
export class PluginError extends Error {
  constructor(message, { code = "", status = 0 } = {}) {
    super(message);
    this.name = "PluginError";
    this.code = code;
    this.status = status;
  }
}

/**
 * Kalimat untuk tiap kode error — apa yang terjadi DAN siapa yang memperbaikinya.
 *
 * `invalid_key` yang paling perlu dijelaskan: ia berarti kunci yang kita simpan tidak lagi dikenali
 * situsnya (plugin dipasang ulang, database situs di-restore, atau ada yang menekan reset dari sisi
 * sana). Tidak ada jumlah percobaan yang akan memperbaikinya — yang dibutuhkan enroll ulang, dan
 * itu hanya mungkin setelah reset, yang justru butuh kunci yang sudah tidak berlaku itu.
 */
const ERROR_HINTS = {
  enroll_disabled:
    "Build plugin di situs ini tidak menyertakan enroll token — enroll tidak mungkin sampai pluginnya dibangun ulang.",
  https_required: "Enroll harus lewat HTTPS. Situs ini menjawab dari HTTP.",
  invalid_enroll_token: "Enroll token ditolak situs ini — periksa PLUGIN_ENROLL_TOKEN di server.",
  already_enrolled:
    "Situs ini sudah pernah enroll dengan kunci lain. Reset dulu, baru enroll lagi.",
  not_enrolled: "Situs ini belum enroll.",
  invalid_key:
    "Kunci yang tersimpan tidak dikenali situs ini lagi — pluginnya dipasang ulang atau di-reset dari sisi sana. Enroll ulang tidak bisa dilakukan dari sini sampai seseorang menekan reset di situsnya.",
  not_found: "Yang diminta tidak ada di situs ini.",
  save_failed: "Situs menolak menyimpan.",
};

export function pluginErrorHint(code, message) {
  const hint = ERROR_HINTS[code];
  const detail = String(message || "").trim();
  if (!hint) return detail || `Plugin menjawab "${code || "tanpa kode"}".`;
  // Pesan dari plugin ikut disebut, bukan diganti: `save_failed` sendiri tidak menyebut slug mana
  // yang duplikat, dan itulah satu-satunya keterangan yang bisa dipakai memperbaikinya.
  return detail && detail !== hint ? `${hint} (${detail})` : hint;
}

/**
 * Hostname subdomain → alamat dasar Management API-nya.
 *
 * Yang masuk ke sini HARUS berasal dari baris `subDomains` di RTDB, bukan dari request. Enroll
 * token dibagi ke SELURUH armada plugin: dikirim ke host yang salah, satu request sudah cukup untuk
 * menyerahkan kunci yang membuka setiap situs kita kepada siapa pun yang memegang host itu.
 *
 * Karena itu bentuknya diperiksa keras di sini juga — bukan karena RTDB tidak dipercaya, melainkan
 * karena `subDomains.name` diisi manusia lewat form dan pernah berisi URL lengkap, spasi, dan
 * "https://" di depannya. Satu saja yang lolos, alamatnya berubah jadi host lain.
 */
export function pluginHostname(host) {
  const name = String(host || "")
    .trim()
    .toLowerCase()
    // "https://sub.domain.com/" ditulis di form lebih sering daripada hostname telanjang. Dibuang
    // di sini, bukan ditolak: yang mengisinya sudah menulis situs yang benar.
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");

  if (!name) throw new PluginError("Subdomain ini tidak punya nama host.");
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(name)) {
    throw new PluginError(`"${host}" bukan hostname yang bisa dipakai sebagai alamat plugin.`);
  }
  return name;
}

export function pluginBaseUrl(host) {
  // HTTPS, tanpa pilihan. Enroll memang mensyaratkannya di sisi plugin, tapi endpoint operasi tidak
  // — dan semuanya mengirim api_key di header tiap request.
  return `https://${pluginHostname(host)}${PLUGIN_NAMESPACE}`;
}

/**
 * Amplop jawaban → data, atau `PluginError`.
 *
 * Ada DUA bentuk gagal dan keduanya harus dibaca, karena datang dari lapisan yang berbeda:
 *
 *   { success: false, error: { code, message } }        <- handler plugin (validasi/logika)
 *   { code, message, data: { status } }                 <- lapisan izin WordPress REST
 *
 * Yang kedua tidak punya field `success` sama sekali. Sebuah pembaca yang hanya memeriksa
 * `success === false` akan menganggap penolakan izin sebagai jawaban SUKSES, lalu meneruskan objek
 * error itu sebagai kalau ia data pengaturan — dan form di layar akan terisi kolom "code" dan
 * "message" seolah itu isi situsnya.
 */
export function unwrapPlugin(body, httpStatus = 0) {
  if (body === null || typeof body !== "object") {
    throw new PluginError(
      httpStatus
        ? `Situs menjawab HTTP ${httpStatus} tanpa JSON — kemungkinan bukan halaman plugin (WAF, halaman login, atau redirect).`
        : "Situs menjawab tanpa JSON yang bisa dibaca.",
      { status: httpStatus },
    );
  }

  if (body.success === true) {
    // `data` boleh objek kosong (header/footer yang belum diisi), tapi tidak boleh hilang.
    return body.data ?? {};
  }

  if (body.success === false) {
    const code = String(body.error?.code || "");
    throw new PluginError(pluginErrorHint(code, body.error?.message), { code, status: httpStatus });
  }

  // Bentuk WordPress REST. `data.status` dipakai, bukan status HTTP-nya, karena proxy di depan
  // situs (Cloudflare) kadang menormalkan kode yang lewat dan yang tersisa sebagai kebenaran
  // tinggal yang ditulis WordPress sendiri di dalam body.
  if (typeof body.code === "string" && body.code) {
    const status = Number(body.data?.status || httpStatus || 0);
    throw new PluginError(pluginErrorHint(body.code, body.message), { code: body.code, status });
  }

  throw new PluginError(
    `Situs menjawab bentuk yang tidak dikenal${httpStatus ? ` (HTTP ${httpStatus})` : ""}.`,
    { status: httpStatus },
  );
}

// --- Skema field --------------------------------------------------------------------------------
//
// Ditulis SEKALI, di sini, dan dikirim ke browser lewat `GET /plugin/schema`.
//
// Alternatifnya adalah menulisnya dua kali — sekali untuk validasi sisi server, sekali untuk
// menggambar form — persis seperti `campaignCommandEntry` dan `reminders-core.js` terpaksa ditulis
// dua kali. Di sana yang diduplikasi adalah selusin baris; di sini empat puluh field dengan enum,
// batas, dan label masing-masing, dan yang bergeser sedikit tidak akan berbunyi sebagai kesalahan:
// form menawarkan pilihan yang ditolak server, atau lebih buruk, pilihan yang DITERIMA server tapi
// diabaikan diam-diam oleh plugin.
//
// Tipe:
//   text      string apa adanya
//   textarea  string panjang (daftar IP/ASN)
//   html      kode iklan / script — dikirim mentah, plugin yang meng-encode
//   url       string, divalidasi bentuknya
//   int       angka bulat, `min` kalau ada
//   bool01    0/1 — bentuk yang dipakai pengaturan iklan
//   boolean   true/false — bentuk yang dipakai behaviour. BEDA dari bool01, dan tidak bisa
//             disamakan: plugin membaca keduanya dari tabel yang berbeda.
//   enum      salah satu `options`
//   list      array string (UI: satu per baris)
//   range     "lo-hi" — satu angka dikirim sebagai rentang yang kedua sisinya sama, karena itu
//             bentuk yang dibacakan situs kembali (lihat `normalizeField`)
//   sizes     daftar "LEBARxTINGGI" dipisah koma; "" sah dan berarti "pakai bawaan kode iklan situs"

export const ADS_FIELDS = [
  { name: "id_publisher", label: "ID Publisher AdSense", type: "text", group: "Umum" },
  { name: "jumlah_iklan", label: "Jumlah slot iklan", type: "int", min: 0, group: "Umum" },
  { name: "opacity", label: "Opasitas", type: "int", min: 0, group: "Umum" },
  {
    name: "mode_tampilan",
    label: "Mode tampilan",
    type: "enum",
    options: ["Acak", "Berurutan", "Stacked"],
    group: "Umum",
  },
  { name: "posisi", label: "Posisi", type: "enum", options: ["Fixed", "Absolute"], group: "Umum" },
  { name: "margin_top", label: "Margin atas", type: "int", group: "Umum" },
  { name: "margin_bottom", label: "Margin bawah", type: "int", group: "Umum" },
  { name: "interval_durasi", label: "Interval durasi", type: "int", min: 0, group: "Umum" },
  { name: "jenis_pengalihan", label: "Jenis pengalihan", type: "text", group: "Umum" },

  { name: "kode_iklan_1", label: "Kode iklan 1", type: "html", group: "Kode iklan" },
  { name: "kode_iklan_2", label: "Kode iklan 2", type: "html", group: "Kode iklan" },
  { name: "kode_iklan_3", label: "Kode iklan 3", type: "html", group: "Kode iklan" },
  { name: "kode_iklan_4", label: "Kode iklan 4", type: "html", group: "Kode iklan" },
  { name: "kode_iklan_5", label: "Kode iklan 5", type: "html", group: "Kode iklan" },

  { name: "refresh_blank", label: "Refresh saat blank", type: "bool01", group: "Perilaku slot" },
  {
    name: "sembunyikan_vinyet",
    label: "Sembunyikan vinyet",
    type: "bool01",
    group: "Perilaku slot",
  },
  {
    name: "sembunyikan_anchor",
    label: "Sembunyikan anchor",
    type: "bool01",
    group: "Perilaku slot",
  },
  {
    name: "sembunyikan_elemen_blank",
    label: "Sembunyikan elemen blank",
    type: "bool01",
    group: "Perilaku slot",
  },
  {
    name: "tampilkan_close_ads",
    label: "Tampilkan tombol close",
    type: "bool01",
    group: "Perilaku slot",
  },
  { name: "auto_scroll", label: "Auto scroll", type: "bool01", group: "Perilaku slot" },

  {
    name: "akses_lokasi_mode",
    label: "Mode akses lokasi",
    type: "enum",
    options: ["off", "termasuk", "kecualikan"],
    group: "Pembatasan akses",
  },
  {
    name: "akses_lokasi_countries",
    label: "Daftar negara",
    type: "list",
    group: "Pembatasan akses",
    help: "Satu negara per baris.",
  },
  { name: "akses_asn_mode", label: "Mode ASN", type: "text", group: "Pembatasan akses" },
  { name: "akses_asn_list", label: "Daftar ASN", type: "textarea", group: "Pembatasan akses" },
  {
    name: "detektor_perangkat",
    label: "Detektor perangkat",
    type: "enum",
    options: ["yes", "no"],
    group: "Pembatasan akses",
  },
  {
    name: "blokir_ip_address",
    label: "IP diblokir",
    type: "textarea",
    group: "Pembatasan akses",
    help: "Satu IP per baris.",
  },

  { name: "simpan_log", label: "Simpan log", type: "text", group: "Log" },
  { name: "simpan_durasi", label: "Durasi simpan", type: "text", group: "Log" },
];

/**
 * Behaviour — label, urutan, dan kalimatnya MENIRU layar pengaturan plugin itu sendiri.
 *
 * Itu bukan selera: orang yang sama membuka dua layar untuk pengaturan yang sama, dan dua nama
 * berbeda untuk satu field ("Jumlah lolos" di sini, "Kunjungan Normal (Lolos)" di sana) membuat
 * keduanya terbaca sebagai dua pengaturan yang berbeda. Yang paling mahal adalah `behaviour_batas`
 * dan `behaviour_cover_after`: keduanya berupa angka ambang, dan tertukar berarti iklan
 * disembunyikan dari pengunjung yang seharusnya melihatnya.
 *
 * Kalau layar plugin berubah, yang di sini ikut — bukan sebaliknya. Plugin yang memiliki
 * perilakunya; halaman ini cuma remote control.
 */
const BEHAVIOUR_SECTION = "Deteksi Behaviour (Pengunjung Berulang)";
const BEHAVIOUR_DELAY_SECTION = "Delay Iklan";

export const BEHAVIOUR_SECTIONS = {
  [BEHAVIOUR_SECTION]: {
    description:
      "Jika satu IP mengakses landing page melebihi batas dalam rentang waktu tertentu, landing page tetap ditampilkan namun semua iklan disembunyikan — bot tidak di-redirect, tapi tidak melihat iklan.",
    // Ketergantungan yang tidak terlihat dari field mana pun di layar ini: tanpa log, kunjungan IP
    // tidak pernah tercatat dan seluruh bagian ini diam tanpa satu pun tanda kesalahan.
    notice: "Fitur ini membutuhkan Simpan Log = Aktifkan di tab Iklan agar kunjungan IP tercatat.",
  },
};

export const BEHAVIOUR_FIELDS = [
  {
    name: "behaviour_detection",
    label: "Aktifkan deteksi pengunjung berulang",
    type: "boolean",
    group: BEHAVIOUR_SECTION,
  },
  {
    name: "behaviour_lolos",
    label: "Kunjungan Normal (Lolos)",
    unit: "(kali)",
    type: "int",
    min: 0,
    group: BEHAVIOUR_SECTION,
    help: "Berapa kunjungan pertama yang dibiarkan lolos normal sebelum delay/aksi mulai berlaku. Default: 1. Isi 0 agar delay/aksi berlaku sejak kunjungan pertama.",
  },
  {
    name: "behaviour_batas",
    label: "Batas Pengulangan Delay",
    unit: "(kali)",
    type: "int",
    min: 0,
    group: BEHAVIOUR_SECTION,
    help: "Berapa kali delay ads / sembunyikan iklan sebelum IP di-redirect permanen. Kunjungan dihitung dalam rentang Durasi Blokir. Isi 0 agar IP langsung di-redirect pada pengulangan pertama (tanpa jeda delay).",
  },
  {
    // Angka dan satuannya berdampingan dalam satu baris, seperti di layar plugin. Tetap DUA field
    // terpisah supaya selisihnya tetap terbaca per field — yang digabung cuma gambarnya.
    name: "behaviour_durasi",
    label: "Durasi Blokir Redirect",
    type: "int",
    min: 1,
    group: BEHAVIOUR_SECTION,
    pairWith: "behaviour_durasi_unit",
    help: "Setelah pengunjung ter-redirect, ia akan tetap di-redirect selama durasi ini. 1 bulan = 30 hari.",
  },
  {
    name: "behaviour_durasi_unit",
    label: "Satuan durasi",
    type: "enum",
    options: ["menit", "jam", "hari", "bulan"],
    optionLabels: { menit: "Menit", jam: "Jam", hari: "Hari", bulan: "Bulan" },
    group: BEHAVIOUR_SECTION,
    // Digambar oleh pasangannya di atas, bukan sebagai baris sendiri.
    renderedBy: "behaviour_durasi",
  },
  {
    /**
     * Radio, bukan dropdown — dan itu meniru plugin dengan alasan yang bisa disebut.
     *
     * Ketiga pilihannya berakibat sangat berbeda (iklan disembunyikan / ditutupi tapi tetap
     * terhitung impresi / pengunjung dibuang ke URL lain), dan di dropdown hanya satu yang terbaca
     * pada satu waktu. Keterangan tiap pilihan justru bagian yang menentukan pilihannya.
     */
    name: "behaviour_action",
    label: "Aksi Ketika Batas Terlampaui",
    type: "radio",
    options: ["hide_ads", "cover_ads", "redirect"],
    optionLabels: {
      hide_ads: "Sembunyikan iklan",
      cover_ads: "Tutup iklan (cover permanen)",
      redirect: "Redirect ke URL",
    },
    optionHelp: {
      hide_ads: "LP tetap tampil, semua slot iklan disembunyikan.",
      cover_ads:
        "Iklan tetap dimuat & terhitung impresi, tapi ditutupi long screenshot sehingga tidak bisa diklik.",
      redirect: "Pengunjung langsung diarahkan ke URL lain.",
    },
    group: BEHAVIOUR_SECTION,
  },
  {
    name: "behaviour_cover_after",
    label: "Tutup Iklan Setelah",
    unit: "(jumlah kunjungan)",
    type: "int",
    min: 0,
    group: BEHAVIOUR_SECTION,
    help: "Ambang khusus mode Tutup iklan, terpisah dari Kunjungan Normal (Lolos) di atas.",
  },
  {
    name: "behaviour_redirect_url",
    label: "URL Redirect",
    type: "url",
    group: BEHAVIOUR_SECTION,
    help: "Dipakai hanya kalau aksinya Redirect ke URL.",
  },

  {
    name: "behaviour_delay_enabled",
    label: "Aktifkan delay iklan",
    type: "boolean",
    group: BEHAVIOUR_DELAY_SECTION,
  },
  {
    name: "behaviour_delay_seconds",
    label: "Delay",
    unit: "(detik)",
    type: "int",
    min: 1,
    group: BEHAVIOUR_DELAY_SECTION,
  },
  {
    name: "behaviour_delay_scope",
    label: "Cakupan Delay",
    type: "radio",
    options: ["repeat", "all"],
    optionLabels: { repeat: "Kunjungan berulang saja", all: "Semua kunjungan" },
    optionHelp: {
      repeat: "Delay hanya berlaku setelah ambang kunjungan berulang terlampaui.",
      all: "Delay berlaku untuk setiap pengunjung, termasuk yang pertama kali datang.",
    },
    group: BEHAVIOUR_DELAY_SECTION,
  },
];

export const HEADER_FOOTER_FIELDS = [
  {
    name: "header_code",
    label: "Header code",
    type: "html",
    group: "Header & Footer",
    help: "Disimpan apa adanya, tidak di-strip.",
  },
  { name: "footer_code", label: "Footer code", type: "html", group: "Header & Footer" },
];

/**
 * CMP — sakelar consent Google, dan SATU-SATUNYA grup yang gagal dengan cara berbeda.
 *
 * Seluruh halaman /plugin dibangun di atas satu kenyataan: plugin MENGABAIKAN nilai yang tidak sah
 * lalu menjawab 200 berisi nilai lama (lihat `unappliedFields`). Grup ini kebalikannya — ia menolak
 * dengan `save_failed` (400) dan TIDAK menulis satu field pun, termasuk field lain yang ikut di
 * body yang sama. Jadi di sini "Tersimpan." benar-benar berarti tersimpan, dan sebuah kegagalan
 * benar-benar berarti tidak ada yang berubah — tidak ada keadaan setengah jadi di antaranya.
 *
 * Yang TIDAK berubah karenanya adalah `normalizeField`: ia tetap memvalidasi lebih dulu, karena
 * 400 dari situs sampai ke layar sebagai kalimat plugin, sementara penolakan di sini menyebut
 * label yang sedang dibaca orang di form.
 *
 * FIELDNYA CUMA DUA, DAN YANG KETIGA BERBAHAYA. `cmp_referrer_policy` adalah kunci penyimpanan
 * internal plugin, bukan parameter API: POST yang membawanya ditolak `save_failed` dan menjatuhkan
 * seluruh permintaan bersamanya. Ia tidak ada di daftar ini, dan `toPluginPayload` hanya
 * meneruskan field yang ada di daftar — jadi ia tidak bisa ikut terkirim dari form maupun dari
 * terapkan-massal. Itu penjagaan yang sama yang membuang `sesuatu_asing` di grup mana pun.
 *
 * `cmp_enabled` sengaja `boolean` dan bukan `bool01`: plugin membacanya sebagai boolean sungguhan,
 * dan keduanya TIDAK bisa disamakan — `0` sebagai angka lolos sebagai nilai yang tidak sah di
 * grup yang menolaknya, dan yang dibaca orang adalah kegagalan menyimpan untuk sakelar yang baru
 * saja ia matikan.
 */
export const CMP_FIELDS = [
  {
    name: "cmp_enabled",
    label: "Aktifkan CMP",
    type: "boolean",
    group: "CMP",
    help: "Dialog consent hanya muncul di wilayah yang mewajibkannya (Eropa) dan hanya pada halaman yang benar-benar dirender — pengalihan tidak punya dokumen, jadi tidak tersentuh.",
  },
  {
    name: "cmp_code",
    label: "Kode CMP",
    type: "html",
    group: "CMP",
    help: "Disimpan apa adanya, tidak di-strip.",
  },
];

/**
 * Keamanan — grup KEDUA yang menolak alih-alih mengabaikan, dan satu-satunya yang bentuk nilainya
 * berubah dalam perjalanan.
 *
 * Sepola CMP: nilai yang tidak sah dijawab `save_failed` (400) dan yang ditolak adalah SELURUH
 * permintaan — tidak satu field pun tertulis, termasuk yang sah di body yang sama. Nama field di
 * luar daftar ini ikut ditolak begitu, dan yang menahannya `toPluginPayload` yang cuma meneruskan
 * field terdaftar.
 *
 * SEMBUNYIKAN FORM LOGIN SENGAJA TIDAK ADA DI SINI, dan ketiadaannya bukan kelalaian.
 * `hidden_login_form`, `url_login`, dan `aksi_login` tidak punya permukaan API sama sekali: satu
 * slug yang salah ketik lalu didorong ke seluruh armada mencabut pintu masuk wp-admin di tiap host
 * sekaligus, dan tidak ada satu pun endpoint yang bisa mengembalikannya — yang tersisa cuma masuk
 * ke hosting tiap situs satu per satu. Mengirimnya = `save_failed`, jadi kalaupun ada yang
 * menambahkannya ke daftar ini, yang didapat adalah grup yang gagal menyimpan seluruhnya.
 *
 * `behaviour_*` juga tidak di sini — ia tetap lewat `/manage/behaviour`. Dua endpoint yang menulis
 * kunci yang sama dengan dua aturan validasi yang berbeda adalah cara tercepat membuat armada tidak
 * konsisten, dan selisihnya cuma terbaca dengan membuka dua tab dan mengadu angkanya.
 */
const TEST_MODE_SECTION = "Perilaku Test Mode";
const VI_GATE_SECTION = "VI Gate Beacon";
const RANDPOS_SECTION = "Acak Posisi Video Player";
const GPT_SIZES_SECTION = "Ukuran Slot Iklan (GPT)";

export const SECURITY_SECTIONS = {
  [TEST_MODE_SECTION]: {
    description:
      "Menentukan apa yang terjadi pada kunjungan yang membawa ?test_mode= di alamatnya — apakah ia dilewatkan begitu saja, atau ikut dihitung dan kena delay seperti pengunjung biasa.",
    // Ini jebakan yang tidak terlihat dari field mana pun: pilihan yang benar untuk MENGUJI adalah
    // pilihan yang salah untuk dibiarkan, dan yang membedakannya cuma ingatan orang yang mengujinya.
    notice:
      "Kembalikan ke Lewati deteksi behaviour setelah selesai menguji. Dengan Ikut deteksi behaviour, tiap kunjungan test ikut terakumulasi di hitungan behaviour situs itu.",
  },
  [VI_GATE_SECTION]: {
    description:
      "Beacon yang mengabari gate saat halaman benar-benar dirender, plus resume palsu yang memutar ulang video begitu pengunjung kembali dari klik iklan.",
    // Ketergantungan yang tidak bisa dibaca dari salah satu saklarnya, dan yang tidak ditolak
    // endpoint-nya: keduanya sah sebagai keadaan tersimpan, jadi yang menyalakan satu tanpa yang
    // lain menyimpan setelan yang tampak menyala dan tidak pernah berjalan sedetik pun di halaman.
    notice:
      "Fake Resume Video hanya berjalan kalau VI Gate Beacon menyala. Situs menerima kombinasi resume menyala + beacon mati tanpa mengeluh, dan yang tersimpan lalu tidak berlaku di halaman mana pun.",
  },
  [RANDPOS_SECTION]: {
    description:
      "Menggeser video player ke posisi acak di dalam zona antara batas atas dan batas bawah, lalu mengacaknya lagi tiap selang waktu tertentu.",
  },
  [GPT_SIZES_SECTION]: {
    description:
      "Menimpa daftar ukuran slot yang diminta ke Google Publisher Tag. Hanya berlaku kalau kode iklan situs sudah ditulis memakai window.__rbtSizes; dikosongkan berarti memakai daftar yang tertulis di kode iklan situs itu sendiri.",
  },
};

export const SECURITY_FIELDS = [
  {
    /**
     * Radio, bukan dropdown — alasan yang sama dengan `behaviour_action`.
     *
     * Kedua pilihannya berakibat berlawanan pada data yang sedang dikumpulkan situs, dan yang
     * menentukan pilihannya justru keterangan tiap pilihan. Di dropdown hanya satu yang terbaca
     * pada satu waktu, dan yang dipilih orang adalah yang namanya paling tidak menakutkan.
     */
    name: "test_mode_behaviour",
    label: "Perilaku Test Mode",
    type: "radio",
    options: ["bypass", "respect_behaviour"],
    optionLabels: {
      bypass: "Lewati deteksi behaviour",
      respect_behaviour: "Ikut deteksi behaviour",
    },
    optionHelp: {
      bypass:
        "Kunjungan ber-?test_mode= tidak dihitung dan tidak kena delay maupun aksi behaviour. Ini keadaan normalnya.",
      respect_behaviour:
        "Kunjungan test ikut dihitung dan kena delay/aksi — satu-satunya cara menguji Penundaan Iklan tanpa logout dulu.",
    },
    group: TEST_MODE_SECTION,
  },

  {
    name: "vi_gate_enabled",
    label: "VI Gate Beacon",
    type: "boolean",
    group: VI_GATE_SECTION,
  },
  {
    name: "video_adclick_resume",
    label: "Fake Resume Video saat Klik Iklan",
    type: "boolean",
    group: VI_GATE_SECTION,
  },

  {
    // Saklar induk atas tiga field di bawahnya, jadi ia satu baris penuh di ATASNYA — sepola
    // `behaviour_detection`. Di separuh baris, ia berdiri berdampingan dengan salah satu angka yang
    // justru diaturnya dan terbaca sebagai setelan yang setara dengannya.
    name: "video_randpos_enabled",
    label: "Acak posisi video player",
    type: "boolean",
    group: RANDPOS_SECTION,
    wide: true,
  },
  {
    name: "video_randpos_top",
    label: "Batas atas",
    unit: "(%)",
    type: "int",
    min: 0,
    max: 100,
    group: RANDPOS_SECTION,
    help: "Persen jarak dari tepi ATAS layar. Zona acaknya ada di antara batas atas dan batas bawah.",
  },
  {
    name: "video_randpos_bottom",
    label: "Batas bawah",
    unit: "(%)",
    type: "int",
    min: 0,
    max: 100,
    group: RANDPOS_SECTION,
    help: "Persen jarak dari tepi BAWAH layar.",
  },
  {
    name: "video_randpos_interval",
    label: "Acak ulang tiap",
    unit: "(detik)",
    type: "range",
    min: 0,
    max: 60,
    group: RANDPOS_SECTION,
    help: "Satu angka (20) atau rentang (10-30), maksimal 60 detik per sisi. Isi 0 untuk mematikan pengacakan ulang. Situs selalu membacakannya kembali sebagai rentang, jadi 20 tersimpan dan terbaca lagi sebagai 20-20.",
  },

  {
    name: "gpt_sizes",
    label: "Ukuran Slot Iklan (GPT)",
    type: "sizes",
    maxItems: 20,
    minSide: 20,
    maxSide: 2000,
    group: GPT_SIZES_SECTION,
    // Melebar penuh: dua puluh ukuran dalam satu baris, dan yang membedakan satu daftar dari daftar
    // lain justru ada di ekornya. Dipotong separuh kolom, dua daftar yang berbeda tampak identik.
    wide: true,
    help: "LEBARxTINGGI dipisah koma, mis. 320x480,300x250,336x280 — boleh juga fluid. Maksimal 20 ukuran, tiap sisi 20-2000 px. Dikosongkan berarti memakai daftar yang tertulis di kode iklan situs.",
  },
];

/**
 * Field landing yang ditawarkan dashboard — bukan seluruh Lampiran A.
 *
 * Lampiran A memuat 35 field dan sebagian besarnya tidak menyebutkan nilai yang sah di mana pun
 * (`protect_elementor`, `referrer_option`, `auto_refresh_option`). Sebuah form yang menawarkan
 * kotak kosong untuk field yang isinya tidak diketahui bukan kelengkapan — ia mengundang seseorang
 * menulis tebakan ke situs yang sedang menerima trafik berbayar, dan POST-nya partial: yang tidak
 * dikirim tetap seperti semula, jadi field yang TIDAK ada di sini aman sepenuhnya.
 */
export const LANDING_FIELDS = [
  {
    name: "slug",
    label: "Slug",
    type: "text",
    group: "Identitas",
    help: "Wajib saat membuat baru, unik, otomatis di-sanitize situs.",
  },
  { name: "title", label: "Judul", type: "text", group: "Identitas" },
  {
    name: "status",
    label: "Status",
    type: "enum",
    options: ["1", "0"],
    optionLabels: { 1: "Aktif", 0: "Nonaktif" },
    group: "Identitas",
  },
  { name: "description", label: "Deskripsi", type: "textarea", group: "Identitas" },
  { name: "inject_keywords", label: "Keyword", type: "textarea", group: "Identitas" },

  { name: "template_file", label: "Template", type: "text", group: "Tampilan" },
  {
    name: "number_images_displayed",
    label: "Jumlah gambar tampil",
    type: "int",
    min: 0,
    group: "Tampilan",
  },
  // Setelah dua field sempit di atas, jadi ia memulai barisnya sendiri. URL cloaking melebar penuh
  // karena bagian yang membedakannya justru ada di ekor — dipotong separuh kolom, dua URL yang
  // berbeda tampak identik.
  { name: "cloaking_url", label: "URL cloaking", type: "url", group: "Tampilan", wide: true },
  /**
   * URL media dikirim sebagai STRING, bukan array — walau Lampiran A menyebutnya array.
   *
   * Yang benar-benar tersimpan di kolomnya adalah teks, dan sebagian baris menyimpannya sebagai
   * JSON yang sudah di-encode (`["https://cdn/x.mp4"]`). Dibaca sebagai daftar, bentuk itu tidak
   * dikenali sebagai array sungguhan dan berakhir tampil apa adanya di kotak isian — kurung dan
   * tanda kutipnya ikut terbaca sebagai bagian dari URL, lalu ikut tersimpan begitu saat disimpan.
   *
   * `type: "media"` yang membereskan keduanya: yang masuk dilepas dari bungkus arraynya (lihat
   * `toFormValue` di src/lib/plugin.js), yang keluar selalu string polos.
   */
  { name: "video_urls", label: "URL video", type: "media", group: "Media", wide: true },
  { name: "universal_image_urls", label: "URL gambar", type: "media", group: "Media", wide: true },
  { name: "custom_html", label: "HTML kustom", type: "html", group: "Media" },
];

export const PLUGIN_SCHEMA = {
  "ads-settings": { title: "Pengaturan Iklan", fields: ADS_FIELDS },
  "header-footer": { title: "Header & Footer", fields: HEADER_FOOTER_FIELDS },
  behaviour: {
    title: "Behaviour",
    fields: BEHAVIOUR_FIELDS,
    sections: BEHAVIOUR_SECTIONS,
    // Satu kolom, meniru layar plugin: hampir tiap field di sana punya baris keterangan sendiri,
    // dan dua kolom membuat keterangan itu berdampingan dengan field yang bukan miliknya.
    columns: 1,
  },
  // Dua field, dan yang kedua adalah blok kode yang melebar penuh — satu kolom, supaya sakelarnya
  // tidak berdiri sendirian di separuh baris di sebelah textarea setinggi delapan baris.
  cmp: { title: "CMP", fields: CMP_FIELDS, columns: 1 },
  /**
   * Dua kolom, berbeda dari CMP dan Behaviour di sebelahnya.
   *
   * Isinya empat kontrol yang saling lepas, bukan satu daftar panjang yang tiap fieldnya butuh
   * baris keterangan sendiri — dan tiap kontrol sudah punya fieldset-nya sendiri. Satu kolom di
   * sini berarti empat saklar dan tiga angka pendek berderet ke bawah setinggi dua layar, dengan
   * separuh lebar tiap barisnya kosong.
   */
  security: { title: "Keamanan", fields: SECURITY_FIELDS, sections: SECURITY_SECTIONS },
  landing: { title: "Landing Page", fields: LANDING_FIELDS },
};

export function fieldsOf(group) {
  return PLUGIN_SCHEMA[group]?.fields || [];
}

// --- Normalisasi payload ------------------------------------------------------------------------

/**
 * Apa pun bentuk URL media yang tersimpan → daftar URL yang bersih.
 *
 * Ini fungsi yang paling banyak menelan bentuk rusak di seluruh modul ini, dan itu disengaja.
 * Yang benar-benar ditemukan di armada:
 *
 *   1. array sungguhan                    ["https://a", "https://b"]
 *   2. JSON yang sudah di-encode          '["https://a","https://b"]'
 *   3. teks satu-URL-per-baris            "https://a\nhttps://b"
 *   4. array berisi SATU blob berbaris    ["https://a\nhttps://b"]
 *   5. JSON yang KOMANYA HILANG           '["https://a"\n"https://b"]'
 *
 * Yang kelima yang paling penting, karena ia yang sedang ada di produksi: 120 URL video di satu
 * baris, dipisah baris baru alih-alih koma, dengan tanda kutip yang ikut ter-escape menempel di
 * URL pertama dan terakhir. `JSON.parse` menolaknya — dan pembaca yang cuma mencoba `JSON.parse`
 * lalu menyerah akan meneruskan seluruh blok itu apa adanya ke kotak isian, kurung siku dan
 * segalanya. Itu persis yang terjadi.
 *
 * Bentuk kelima bukan kecelakaan acak: ia adalah hasil dari MENGIRIM STRING ke field yang
 * dibaca plugin sebagai array. Jadi memperbaikinya dengan mengirim string lagi akan membuatnya
 * lahir kembali tiap kali seseorang menekan Simpan — karena itu `normalizeField` mengirim array.
 */
export function mediaList(value) {
  if (Array.isArray(value)) return value.flatMap((item) => mediaList(item));

  const text = String(value ?? "").trim();
  if (!text) return [];

  if (text.startsWith("[")) {
    try {
      const parsed = JSON.parse(text);
      // Elemennya sendiri bisa berupa blob berbaris banyak (bentuk 4), jadi tiap elemen diurai
      // ulang alih-alih dipercaya sebagai satu URL.
      if (Array.isArray(parsed)) return parsed.flatMap((item) => mediaList(item));
    } catch {
      // Bentuk 5. Kurung sikunya dibuang lalu diperlakukan sebagai teks biasa di bawah — bukan
      // dianggap gagal, karena isinya masih terbaca sempurna oleh manusia.
    }
  }

  return text
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .split(/[\r\n,]+/)
    .map(cleanMediaToken)
    .filter(Boolean);
}

// Tanda kutip GANDA yang ikut terbawa — biasa maupun yang ter-escape — dibuang dari kedua ujung.
// Kutip TUNGGAL tidak: ia karakter yang sah di URL dan tidak muncul di satu pun bentuk rusak yang
// ditemukan; ikut dibuang, URL yang benar jadi salah tanpa ada yang tahu. Yang di TENGAH juga
// dibiarkan, alasan yang sama.
function cleanMediaToken(token) {
  return String(token)
    .trim()
    .replace(/^[\\"\s]+/, "")
    .replace(/[\\"\s]+$/, "");
}

/**
 * Nilai yang diketik orang → nilai yang dikirim ke plugin, atau lempar.
 *
 * Kenapa enum DIVALIDASI di sini padahal plugin juga memvalidasinya: plugin **mengabaikan** nilai
 * enum yang tidak sah dan menjawab 200 berisi nilai LAMA (Lampiran C menuliskannya sendiri). Jadi
 * salah ketik satu enum menghasilkan "Tersimpan." di layar untuk pengaturan yang tidak berubah
 * sama sekali — kegagalan yang tidak punya satu pun tanda, di halaman yang mengatur iklan.
 */
export function normalizeField(field, value) {
  const { type, label } = field;

  if (type === "int") {
    const text = String(value ?? "").trim();
    if (text === "") return null;
    const number = Number(text);
    if (!Number.isInteger(number)) throw new PluginError(`${label} harus angka bulat.`);
    if (typeof field.min === "number" && number < field.min) {
      throw new PluginError(`${label} minimal ${field.min}.`);
    }
    // Batas ATAS diperiksa di sini juga, bukan diserahkan ke situsnya. `/autopost/keywords`
    // menjepit `total_keyword` ke 1-100 tanpa mengabarkan apa pun: yang meminta 500 menerima 100
    // dengan amplop `success: true`, dan selisihnya tidak berbunyi sebagai kesalahan di mana pun.
    if (typeof field.max === "number" && number > field.max) {
      throw new PluginError(`${label} maksimal ${field.max}.`);
    }
    return number;
  }

  if (type === "bool01") {
    // 0/1 sebagai ANGKA. Plugin membacanya dari kolom int; dikirim sebagai "0", string itu truthy
    // di beberapa jalur PHP dan saklar yang dimatikan orang akan tetap menyala.
    return value === true || value === 1 || value === "1" ? 1 : 0;
  }

  if (type === "boolean") {
    return value === true || value === 1 || value === "1" || value === "true";
  }

  // `radio` ikut jalur `enum`: yang berbeda cuma cara ia DIGAMBAR, dan lupa menyamakannya di sini
  // membuka kembali lubang yang jadi alasan validasi ini ada — nilai enum yang tidak sah diabaikan
  // diam-diam oleh plugin sambil menjawab 200, jadi "Tersimpan." muncul untuk yang tidak berubah.
  if (type === "enum" || type === "radio") {
    const text = String(value ?? "").trim();
    if (text === "") return null;
    if (!field.options.includes(text)) {
      throw new PluginError(
        `${label}: "${text}" bukan pilihan yang sah (${field.options.join(", ")}).`,
      );
    }
    return text;
  }

  if (type === "media") {
    // ARRAY, sesuai Lampiran A — dan itu koreksi dari versi sebelumnya yang mengirim string.
    // Lihat catatan panjang di `mediaList` untuk bukti kenapa string justru yang merusaknya.
    return mediaList(value);
  }

  if (type === "list") {
    // Textarea satu-per-baris ATAU array. Keduanya diterima karena yang datang dari form adalah
    // teks, dan yang datang dari "salin dari situs lain" sudah berbentuk array.
    const items = Array.isArray(value)
      ? value
      : String(value ?? "")
          .split(/[\r\n]+/)
          .map((line) => line.trim());
    return items.map((item) => String(item).trim()).filter(Boolean);
  }

  if (type === "range") {
    /**
     * "20" DAN "10-30" sama-sama sah dikirim, tapi yang dikirim SELALU berbentuk "lo-hi".
     *
     * Situs membacakannya kembali dalam bentuk itu apa pun yang dikirim: "20" tersimpan dan
     * dilaporkan "20-20". Dikirim apa adanya, `unappliedFields` membandingkan "20" dengan "20-20",
     * tidak cocok, dan melaporkan field yang justru tersimpan DENGAN BENAR sebagai "nilainya
     * ditolak diam-diam di sana" — peringatan yang menyuruh orang mengulang sesuatu yang sudah
     * berhasil, di satu-satunya penjaga yang halaman ini punya untuk kegagalan yang sungguhan.
     *
     * Dinormalkan di sini, nilai yang dikirim sama dengan nilai yang tersimpan, dan sama dengan
     * nilai yang benar-benar berlaku di halaman.
     */
    const text = String(value ?? "").trim();
    if (text === "") return null;

    const parts = text.split("-").map((part) => part.trim());
    if (parts.length > 2 || parts.some((part) => !/^\d+$/.test(part))) {
      throw new PluginError(
        `${label} ditulis sebagai satu angka (20) atau dua angka dipisah tanda hubung (10-30).`,
      );
    }

    const lo = Number(parts[0]);
    const hi = Number(parts[1] ?? parts[0]);

    if (typeof field.max === "number" && (lo > field.max || hi > field.max)) {
      throw new PluginError(`${label} maksimal ${field.max} per sisi.`);
    }
    // Batas bawah yang melampaui batas atas bukan rentang. Diserahkan ke situsnya, ia jatuh ke
    // `save_failed` — yang di grup ini menjatuhkan SELURUH permintaan, termasuk field lain yang
    // sah di body yang sama.
    if (lo > hi) {
      throw new PluginError(
        `${label}: batas bawah (${lo}) tidak boleh melebihi batas atas (${hi}).`,
      );
    }
    return `${lo}-${hi}`;
  }

  if (type === "sizes") {
    /**
     * Daftar ukuran slot iklan — dan KOSONG di sini adalah nilai yang sah, bukan ketiadaan.
     *
     * "" berarti "pakai daftar yang tertulis di kode iklan situs", jadi ia dikirim sebagai string
     * kosong alih-alih dijatuhkan ke `null` seperti enum dan angka kosong. Aturan yang sama dengan
     * `cmp_code`: field yang tidak terkirim membuat daftar lama bertahan di situs sementara layar
     * menunjukkan kotak kosong.
     *
     * Diperiksa di sini, bukan diserahkan ke situs, karena grup ini MENOLAK: satu salah ketik di
     * antara dua puluh ukuran menjatuhkan seluruh permintaan bersama field lain yang sah.
     */
    const text = String(value ?? "").trim();
    if (text === "") return "";

    const sizes = text
      .split(",")
      // Huruf x dikecilkan dan spasinya dibuang supaya bentuk yang dikirim satu macam. Yang
      // dijawab situs adalah yang kita kirim, dan `unappliedFields` membandingkan keduanya.
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);

    if (typeof field.maxItems === "number" && sizes.length > field.maxItems) {
      throw new PluginError(
        `${label} maksimal ${field.maxItems} ukuran — yang ditulis ${sizes.length}.`,
      );
    }

    for (const size of sizes) {
      // `fluid` bukan ukuran melainkan permintaan agar slotnya mengikuti lebar wadahnya.
      if (size === "fluid") continue;

      const match = size.match(/^(\d+)x(\d+)$/);
      if (!match) {
        throw new PluginError(
          `${label}: "${size}" bukan ukuran yang sah — tulis LEBARxTINGGI (mis. 300x250) atau fluid.`,
        );
      }
      for (const side of [Number(match[1]), Number(match[2])]) {
        if (side < field.minSide || side > field.maxSide) {
          throw new PluginError(
            `${label}: "${size}" di luar batas ${field.minSide}-${field.maxSide} px per sisi.`,
          );
        }
      }
    }
    return sizes.join(",");
  }

  if (type === "url") {
    const text = String(value ?? "").trim();
    if (text === "") return "";
    if (!/^https?:\/\/\S+$/i.test(text)) {
      throw new PluginError(`${label} harus URL lengkap berawalan http:// atau https://.`);
    }
    return text;
  }

  // text / textarea / html — apa adanya. Kode iklan dan script header memang harus lolos utuh;
  // yang meng-encode base64 adalah pluginnya sendiri.
  return String(value ?? "");
}

/**
 * Nilai form → body POST, PARTIAL.
 *
 * Field yang tidak ada di `values` tidak ikut dikirim, dan itu bukan optimisasi: POST plugin
 * bersifat partial, jadi mengirim field yang tidak diubah berarti menulis ulang nilai yang kita
 * baca beberapa menit lalu — dan menimpa perubahan yang dibuat orang lain di sela-sela.
 */
export function toPluginPayload(group, values) {
  const fields = fieldsOf(group);
  if (!fields.length) throw new PluginError(`Grup pengaturan "${group}" tidak dikenal.`);

  const payload = {};
  for (const field of fields) {
    if (!Object.hasOwn(values || {}, field.name)) continue;
    const normalized = normalizeField(field, values[field.name]);
    // `null` berarti "kosong dan tidak ada artinya untuk dikirim" (int kosong, enum kosong).
    // Dikirim sebagai null, plugin akan menuliskannya sebagai 0 atau string kosong.
    if (normalized === null) continue;
    payload[field.name] = normalized;
  }

  if (!Object.keys(payload).length) {
    throw new PluginError("Tidak ada field yang diubah.");
  }
  return payload;
}

// --- Penjaga "tersimpan tapi tidak berubah" ------------------------------------------------------

/**
 * Apa yang dikirim vs apa yang dijawab situs. Yang tidak cocok dikembalikan namanya.
 *
 * Ini penjaga yang paling penting di modul ini, dan ia ada karena API-nya memang bekerja begitu:
 * "Nilai enum yang tidak valid akan diabaikan (field tetap memakai nilai lama)" — dengan HTTP 200
 * dan amplop `success: true`. Tanpa perbandingan ini, satu-satunya cara mengetahui pengaturan iklan
 * tidak jadi berubah adalah membuka situsnya dan melihat iklannya sendiri.
 *
 * Perbandingannya SENGAJA longgar. Situs menjawab dari kolom database: `3` yang dikirim kembali
 * sebagai `"3"`, `true` sebagai `"1"`. Perbandingan ketat akan menandai setiap field sebagai gagal
 * dan peringatan yang selalu menyala tidak menyampaikan apa pun.
 */
export function unappliedFields(sent, returned) {
  if (!returned || typeof returned !== "object") return [];
  return Object.keys(sent || {}).filter((key) => {
    // Field yang tidak dikembalikan sama sekali bukan kegagalan: beberapa endpoint menjawab
    // ringkasan, bukan baris penuh. Yang bisa dinilai hanya yang benar-benar ada jawabannya.
    if (!Object.hasOwn(returned, key)) return false;
    return !sameValue(sent[key], returned[key]);
  });
}

function sameValue(sent, got) {
  if (Array.isArray(sent) || Array.isArray(got)) {
    return JSON.stringify(toList(sent)) === JSON.stringify(toList(got));
  }
  return scalar(sent) === scalar(got);
}

function toList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value ?? "")
    .split(/[\r\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

// true/1/"1" adalah nilai yang sama yang lewat tiga lapisan berbeda (JSON kita, PHP, kolom MySQL).
function scalar(value) {
  if (value === true) return "1";
  if (value === false) return "0";
  return String(value ?? "").trim();
}

// --- Baris RTDB ----------------------------------------------------------------------------------

/**
 * Situs yang di-ping sweep armada: yang ENROLLED dan baris `subDomains`-nya masih hidup.
 *
 * `pluginSites` tidak ikut diarsipkan bersama subdomainnya, jadi tanpa saringan ini sub yang sudah
 * dilepas (testsub/wplogin/... .scheme.com.pk, 23 Sep 2026) di-ping tiap 30 menit dan dicoba ulang
 * tiap menit, selamanya berdiri sebagai "tidak bisa dihubungi" di isu sync — untuk situs yang
 * memang sengaja ditinggalkan.
 */
export function pluginPingIds(sites, subDomains) {
  return Object.entries(sites || {})
    .filter(([id, row]) => row?.enrolled && subDomains?.[id] && !subDomains[id].deletedAt)
    .map(([id]) => id);
}

/**
 * Baris cermin status satu situs. TIDAK memuat api_key — lihat catatan PLUGIN_SITES_PATH.
 *
 * `enrolled` disimpan sebagai boolean tersendiri dan bukan disimpulkan dari ada-tidaknya `version`:
 * situs yang enroll-nya berhasil tapi ping berikutnya gagal tetap enrolled, dan halaman yang
 * menyimpulkannya dari field lain akan menawarkan tombol Enroll untuk situs yang akan menjawab
 * `already_enrolled` — satu-satunya jalan keluarnya reset, yang membuang kunci yang masih sah.
 */
export function pluginSiteRow(subDomain, patch = {}, previous = null, now = new Date()) {
  const base = previous && typeof previous === "object" ? previous : {};
  return {
    subdomainId: String(subDomain?.id || base.subdomainId || ""),
    name: String(subDomain?.name || base.name || ""),
    enrolled: patch.enrolled ?? base.enrolled ?? false,
    siteId: String(patch.siteId ?? base.siteId ?? ""),
    version: String(patch.version ?? base.version ?? ""),
    php: String(patch.php ?? base.php ?? ""),
    wp: String(patch.wp ?? base.wp ?? ""),
    homeUrl: String(patch.homeUrl ?? base.homeUrl ?? ""),
    enrolledAt: String(patch.enrolledAt ?? base.enrolledAt ?? ""),
    enrolledBy: String(patch.enrolledBy ?? base.enrolledBy ?? ""),
    // Stempel jawaban TERAKHIR yang berhasil, apa pun endpointnya. Ping bukan satu-satunya bukti
    // situsnya hidup — membaca pengaturan pun membuktikannya, dan menandainya hanya dari ping
    // membuat situs yang baru saja dikelola tampak belum pernah dihubungi.
    lastSeenAt: String(patch.lastSeenAt ?? base.lastSeenAt ?? ""),
    // Kegagalan terakhir, DIPERTAHANKAN sampai ada jawaban berhasil yang menggantinya. Dihapus tiap
    // kali ada request baru, alasan situs mati akan hilang begitu ada yang menekan tombol lain.
    error: String(patch.error ?? base.error ?? ""),
    errorCode: String(patch.errorCode ?? base.errorCode ?? ""),
    errorAt: String(patch.errorAt ?? base.errorAt ?? ""),
    checkedAt: now.toISOString(),
  };
}

/**
 * Baris kunci. Sengaja hanya membawa kunci dan tanggalnya.
 *
 * TIDAK dienkripsi, dan itu keputusan yang bisa dibaca ulang: `POST /manage/reset` — satu-satunya
 * cara meng-enroll ulang sebuah situs — membutuhkan kunci LAMA. Dienkripsi dengan rahasia di sisi
 * server, hilangnya rahasia itu berarti tiap situs terkunci di `already_enrolled` selamanya, dan
 * jalan keluarnya cuma masuk ke WordPress tiap situs satu per satu. Kunci ini adalah satu-satunya
 * jalan pulang, jadi ia disimpan sebagai teks yang bisa dibaca — dijaga oleh aturan database, bukan
 * oleh sandi yang bisa ikut hilang.
 */
export function pluginKeyEntry(apiKey, actor, now = new Date()) {
  const key = String(apiKey || "").trim();
  if (!key) throw new PluginError("Situs tidak mengembalikan api_key saat enroll.");
  return { apiKey: key, enrolledAt: now.toISOString(), enrolledBy: String(actor || "dashboard") };
}

// --- Daftar landing -------------------------------------------------------------------------------

// Baris daftar landing. `status` dari plugin adalah string "1"/"0"; dipetakan ke boolean sekali di
// sini supaya tidak ada tabel yang memutuskan sendiri apakah "0" itu aktif (di JS, "0" truthy).
export function landingRow(landing) {
  const id = String(landing?.id ?? "").trim();
  if (!id) return null;
  return {
    id,
    slug: String(landing?.slug || ""),
    title: String(landing?.title || ""),
    active: String(landing?.status ?? "") === "1",
    templateFile: String(landing?.template_file || ""),
  };
}

export function landingRows(landings) {
  return (Array.isArray(landings) ? landings : [])
    .map(landingRow)
    .filter(Boolean)
    .sort((left, right) => Number(left.id) - Number(right.id));
}

/**
 * Tautan landing: alamatnya + pasangan parameter yang diacak situs saat landing dibuat.
 *
 * `link` = alamat + `?kunci=nilai` — bentuk yang dipasang di iklan. Ketiganya dikembalikan terpisah
 * juga, karena yang ditempel ke Keitaro kadang cuma parameternya.
 */
export function landingLink(host, landing, url = "") {
  const slug = String(landing?.slug || "").trim();
  const address = String(url || (slug ? `https://${host}/${slug}` : ""));
  const parameterKey = String(landing?.parameter_key || "").trim();
  const parameterValue = String(landing?.parameter_value || "").trim();
  const query = parameterKey ? `${parameterKey}=${encodeURIComponent(parameterValue)}` : "";
  return {
    id: String(landing?.id ?? ""),
    slug,
    url: address,
    parameterKey,
    parameterValue,
    link: query && address ? `${address}${address.includes("?") ? "&" : "?"}${query}` : address,
  };
}

// --- Setup situs: lisensi, deployment, halaman legal ------------------------------------------------

// Urutan kanonik plugin (trash → permalink → plugins → theme); `dropin` sengaja TIDAK di "all".
// `menus` paling akhir dan di luar "all": ia merakit menu dari konten yang SUDAH ada (kategori
// ber-post, Page publish), jadi dijalankan sesudah halaman legal dan AutoPost — bukan bersama trash.
export const DEPLOYMENT_TASKS = ["trash", "permalink", "plugins", "theme", "dropin", "menus"];
export const LEGAL_PAGES = [
  "Privacy Policy",
  "Disclaimer",
  "Terms & Conditions",
  "Contact Us",
  "About Us",
];

/**
 * Daftar task yang BOLEH dikirim — daftar putih, dan kosong DITOLAK di sini juga, bukan cuma di
 * plugin: endpoint-nya men-trash seluruh konten dan menghapus tiap plugin lain.
 */
export function deploymentTasks(tasks) {
  const list = [...new Set((Array.isArray(tasks) ? tasks : []).map((task) => String(task).trim()))];
  const unknown = list.filter((task) => !DEPLOYMENT_TASKS.includes(task));
  if (unknown.length) throw new PluginError(`Task tidak dikenal: ${unknown.join(", ")}.`);
  if (!list.length) throw new PluginError("Pilih minimal satu task Setting Sub.");
  return DEPLOYMENT_TASKS.filter((task) => list.includes(task));
}

export function legalPageList(pages) {
  const list = (Array.isArray(pages) ? pages : []).map((page) => String(page).trim());
  const unknown = list.filter((page) => !LEGAL_PAGES.includes(page));
  if (unknown.length) throw new PluginError(`Halaman tidak dikenal: ${unknown.join(", ")}.`);
  return LEGAL_PAGES.filter((page) => list.includes(page));
}

/**
 * Jawaban POST deployment / legal-pages → status yang disimpan di `subDomains/{id}/siteTasks`.
 *
 * HTTP 200 dari keduanya bisa berarti SEBAGIAN gagal, jadi `state` dibaca dari hitungannya, bukan
 * dari status HTTP. Nilai `undefined` tidak boleh lolos — RTDB menolak seluruh tulisannya.
 */
export function deploymentOutcome(data) {
  const results = (Array.isArray(data?.results) ? data.results : []).map((row) => ({
    task: String(row?.task || ""),
    label: String(row?.label || row?.task || ""),
    ok: Boolean(row?.ok),
    details: String(row?.details || "").slice(0, 2000),
  }));
  const failed = results.filter((row) => !row.ok).length;
  return {
    state: failed === 0 ? "done" : failed < results.length ? "partial" : "failed",
    results,
    detail: `${results.length - failed} dari ${results.length} task berhasil.`,
  };
}

export function legalOutcome(data) {
  const pages = (Array.isArray(data?.pages) ? data.pages : []).map((row) => ({
    title: String(row?.title || ""),
    status: String(row?.status || ""),
    url: String(row?.url || ""),
    message: String(row?.message || "").slice(0, 500),
  }));
  const failed = pages.filter((row) => row.status === "failed").length;
  return {
    state: failed === 0 ? "done" : failed < pages.length ? "partial" : "failed",
    pages,
    detail: `${Number(data?.created) || 0} dibuat, ${Number(data?.skipped) || 0} dilewati, ${failed} gagal.`,
  };
}

// --- Terapkan massal -------------------------------------------------------------------------------

/**
 * Ringkasan hasil "terapkan ke banyak situs".
 *
 * `unapplied` dihitung TERPISAH dari `failed`, dan itu bedanya yang menentukan tindakan: yang gagal
 * belum berubah sama sekali dan layak dicoba lagi; yang `unapplied` menjawab berhasil untuk
 * perubahan yang tidak terjadi, dan mencoba lagi tidak akan mengubah apa pun — yang dibutuhkan
 * adalah memperbaiki nilainya.
 */
export function bulkSummary(results) {
  const list = Array.isArray(results) ? results : [];
  return {
    total: list.length,
    ok: list.filter((row) => row.status === "ok").length,
    unapplied: list.filter((row) => row.status === "unapplied").length,
    failed: list.filter((row) => row.status === "failed").length,
  };
}

export function bulkRow(site, { status, error = "", unapplied = [], detail = null }) {
  return {
    subdomainId: String(site?.id || ""),
    name: String(site?.name || ""),
    status,
    error: String(error || ""),
    unapplied,
    // Keterangan per situs yang cuma dimiliki satu jenis operasi (inject GPT: cara header-nya
    // digabung, kotak mana yang dikosongkan). Tidak ada di baris operasi lain, bukan objek kosong.
    ...(detail ? { detail } : {}),
  };
}

// --- Ganti versi plugin --------------------------------------------------------------------------

// Sentinel "ambil rilis stabil terbaru". Dikirim sebagai body KOSONG (`{}`), bukan sebagai string
// "latest" — itu yang tertulis di dokumen API-nya, dan `{version:"latest"}` akan dibaca sebagai
// permintaan versi bernama "latest" yang tidak akan pernah ada.
export const PLUGIN_LATEST = "latest";

/**
 * Yang diketik orang → versi yang sah, atau lempar.
 *
 * Kosong berarti "stabil terbaru". Awalan `v` dibuang karena `release_tag` mengembalikannya dengan
 * `v` (`v0.4.8`) sementara `version` tidak (`0.4.8`) — orang akan menyalin salah satunya, dan yang
 * dikirim harus satu bentuk saja atau plugin mencari rilis yang tidak ada.
 */
export function normalizeVersion(input) {
  const text = String(input ?? "")
    .trim()
    .replace(/^v/i, "");
  if (!text || text.toLowerCase() === PLUGIN_LATEST) return "";
  if (!/^\d+\.\d+(\.\d+)?$/.test(text)) {
    throw new PluginError(`Versi "${input}" tidak berbentuk angka versi (mis. 0.4.8).`);
  }
  return text;
}

export function updatePayload(version) {
  const normalized = normalizeVersion(version);
  return normalized ? { version: normalized } : {};
}

// Pesan WordPress datang ber-entity HTML ("Unpacking the package&#8230;"). Ditampilkan mentah, yang
// terbaca orang adalah `&#8230;` — dan ini SATU-SATUNYA jendela ke apa yang terjadi di situs saat
// pemasangan gagal separuh jalan. Diurai jadi teks biasa, TIDAK pernah jadi HTML.
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…" };

export function decodeEntities(value) {
  return String(value ?? "")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (whole, name) => ENTITIES[name.toLowerCase()] ?? whole);
}

/**
 * Jawaban `/manage/update` → baris yang bisa dibaca orang.
 *
 * `installed` dan `version` dibaca TERPISAH, dan itu intinya. Plugin menjawab `success: true` untuk
 * pemasangan yang berhasil MAUPUN untuk permintaan yang tidak mengubah apa pun (versi yang diminta
 * sudah terpasang) — pola yang sama persis dengan enum yang diabaikan diam-diam di `/behaviour`.
 * Dinilai dari `success` saja, layar akan bilang "berhasil diperbarui" untuk situs yang versinya
 * tidak bergerak sedikit pun.
 */
export function pluginUpdateRow(data, requested = "") {
  const messages = Array.isArray(data?.messages) ? data.messages : [];
  return {
    installed: data?.installed === true,
    requested: String(data?.requested || requested || PLUGIN_LATEST),
    releaseTag: String(data?.release_tag || ""),
    version: String(data?.version || ""),
    messages: messages.map((line) => decodeEntities(line)).filter(Boolean),
  };
}

/**
 * Hasil satu pembaruan, dalam kosakata yang sama dengan sisa halaman ini: ok / unapplied / failed.
 *
 * `unapplied` bukan kegagalan dan bukan keberhasilan, dan memisahkannya di sini menentukan tindakan
 * berikutnya persis seperti di `unappliedFields`:
 *
 *   ok        — terpasang, dan versinya benar-benar jadi yang diminta.
 *   unapplied — situs menjawab tapi versinya TIDAK bergerak (sudah di versi itu, atau rilisnya
 *               tidak ditemukan). Mengulanginya tidak akan mengubah apa pun.
 *   failed    — dilempar sebelum sampai ke sini oleh pemanggilnya.
 *
 * Versi yang diminta spesifik ikut DIVERIFIKASI terhadap yang dijawab: `installed: true` yang
 * memasang versi lain dari yang diminta adalah hasil yang tidak boleh terbaca sebagai berhasil.
 */
export function updateOutcome(row, requestedVersion = "") {
  const want = normalizeVersion(requestedVersion);

  if (!row.installed) {
    return {
      status: "unapplied",
      note: row.version
        ? `Versi tidak berubah — masih ${row.version}.`
        : "Situs menjawab tapi tidak ada yang dipasang.",
    };
  }

  if (want && row.version && row.version !== want) {
    return {
      status: "unapplied",
      note: `Diminta ${want}, yang terpasang justru ${row.version}.`,
    };
  }

  return { status: "ok", note: "" };
}

// --- Kode HTTP untuk kegagalan plugin --------------------------------------------------------------

/**
 * `PluginError` → kode HTTP yang dijawab server kontrol.
 *
 * Yang dijaga di sini satu hal: kegagalan DI SITUS tidak boleh keluar sebagai 401/403/404 milik kita
 * sendiri. `invalid_key` (401 dari WordPress) yang diteruskan apa adanya akan dibaca browser sebagai
 * "token Firebase-mu kedaluwarsa", dan `controlApi` akan menyuruh orangnya login ulang untuk situs
 * yang kuncinya bermasalah — tindakan yang tidak akan memperbaiki apa pun.
 *
 * Jadi semua kegagalan upstream jadi 502, dan yang membedakannya adalah field `code` yang ikut
 * dikirim. 422 disisakan untuk yang ditolak SEBELUM menyentuh jaringan (enum salah, slug kosong,
 * hostname tak berbentuk) — itu yang bisa diperbaiki orangnya sendiri di form yang sedang terbuka.
 */
export function pluginFailureStatus(error) {
  if (!(error instanceof PluginError)) return 500;
  return error.code || error.status ? 502 : 422;
}
