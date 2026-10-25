import assert from "node:assert";

const {
  ADS_FIELDS,
  BEHAVIOUR_FIELDS,
  CMP_FIELDS,
  LANDING_FIELDS,
  PLUGIN_GROUPS,
  PLUGIN_SCHEMA,
  SECURITY_FIELDS,
  PLUGIN_NAMESPACE,
  PluginError,
  bulkSummary,
  decodeEntities,
  normalizeVersion,
  pluginUpdateRow,
  updateOutcome,
  updatePayload,
  landingRows,
  mediaList,
  normalizeField,
  pluginBaseUrl,
  pluginErrorHint,
  pluginFailureStatus,
  pluginKeyEntry,
  pluginPingIds,
  pluginSiteRow,
  toPluginPayload,
  unappliedFields,
  unwrapPlugin,
} = await import("./plugin-core.js");

// --- Alamat -------------------------------------------------------------------------------------

assert.equal(pluginBaseUrl("sub.domain.com"), `https://sub.domain.com${PLUGIN_NAMESPACE}`);

// Yang diisi manusia lewat form: URL lengkap, huruf besar, garis miring di ekor. Ditolak mentah-
// mentah, halaman akan bilang "hostname tidak berbentuk" untuk situs yang sebenarnya benar.
assert.equal(pluginBaseUrl(" HTTPS://Sub.Domain.com/ "), `https://sub.domain.com${PLUGIN_NAMESPACE}`);
assert.equal(pluginBaseUrl("http://a.b.co"), `https://a.b.co${PLUGIN_NAMESPACE}`);

// HTTPS selalu, walau yang ditulis http: api_key ikut di header TIAP request, bukan cuma saat enroll.
assert.ok(pluginBaseUrl("a.b.co").startsWith("https://"));

// Yang tidak berbentuk hostname ditolak. Ini gerbang yang menahan enroll token — dibagi ke seluruh
// armada — dari terkirim ke host yang bukan milik kita.
for (const bad of ["", "   ", "localhost", "sub.domain.com/../evil", "a b.com", "sub..com"]) {
  assert.throws(() => pluginBaseUrl(bad), PluginError, `seharusnya ditolak: ${JSON.stringify(bad)}`);
}

// `assert.throws` tidak mengembalikan error yang ditangkapnya, dan yang perlu diperiksa di bawah
// justru isinya — `code` dan `status` yang menentukan tombol apa yang ditawarkan halaman.
function caught(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("seharusnya melempar, tapi tidak.");
}

// --- Amplop jawaban -----------------------------------------------------------------------------

assert.deepEqual(unwrapPlugin({ success: true, data: { version: "0.4.7" } }), { version: "0.4.7" });
// `data` boleh kosong (header/footer yang belum pernah diisi), tapi tidak boleh hilang jadi undefined.
assert.deepEqual(unwrapPlugin({ success: true }), {});

// Bentuk 1: error dari handler plugin.
const handlerError = caught(() =>
  unwrapPlugin({ success: false, error: { code: "save_failed", message: "slug wajib diisi." } }),
);
assert.ok(handlerError instanceof PluginError);
assert.equal(handlerError.code, "save_failed");
assert.match(handlerError.message, /slug wajib diisi/);

/**
 * Bentuk 2: error dari lapisan izin WordPress — TANPA field `success` sama sekali.
 *
 * Ini yang paling penting diuji. Pembaca yang cuma memeriksa `success === false` akan menganggap
 * penolakan izin sebagai jawaban SUKSES dan meneruskan `{ code, message, data }` sebagai kalau itu
 * isi pengaturan situsnya — form di layar akan terisi kolom bernama "code" dan "message".
 */
const authError = caught(() =>
  unwrapPlugin({ code: "invalid_key", message: "API key tidak valid.", data: { status: 401 } }),
);
assert.ok(authError instanceof PluginError);
assert.equal(authError.code, "invalid_key");
assert.equal(authError.status, 401);
assert.match(authError.message, /dipasang ulang|di-reset/);

// HTML (halaman login, blokir Cloudflare, error PHP) sampai ke sini sebagai null.
assert.throws(() => unwrapPlugin(null, 403), /bukan halaman plugin/);
assert.throws(() => unwrapPlugin({ aneh: true }), /bentuk yang tidak dikenal/);

// Kode yang tidak dikenal tetap membawa pesan aslinya, bukan ditelan.
assert.match(pluginErrorHint("kode_baru", "sesuatu terjadi"), /sesuatu terjadi/);
// Yang dikenal menyebut solusinya DAN pesan aslinya.
assert.match(pluginErrorHint("already_enrolled", "Situs sudah enroll."), /Reset dulu/);

// --- Normalisasi field --------------------------------------------------------------------------

const jumlahIklan = ADS_FIELDS.find((f) => f.name === "jumlah_iklan");
assert.equal(normalizeField(jumlahIklan, "4"), 4);
assert.equal(normalizeField(jumlahIklan, ""), null);
assert.throws(() => normalizeField(jumlahIklan, "3.5"), /angka bulat/);
assert.throws(() => normalizeField(jumlahIklan, "-1"), /minimal 0/);

// 0/1 sebagai ANGKA, bukan "0": string "0" truthy di beberapa jalur PHP, dan saklar yang dimatikan
// orang akan tetap menyala.
const refreshBlank = ADS_FIELDS.find((f) => f.name === "refresh_blank");
assert.strictEqual(normalizeField(refreshBlank, "1"), 1);
assert.strictEqual(normalizeField(refreshBlank, false), 0);
assert.strictEqual(normalizeField(refreshBlank, "0"), 0);

// behaviour memakai boolean JSON sungguhan — bentuk yang BERBEDA dari bool01 di atas, dan tidak
// bisa disamakan karena plugin membacanya dari tabel yang berbeda.
const detection = BEHAVIOUR_FIELDS.find((f) => f.name === "behaviour_detection");
assert.strictEqual(normalizeField(detection, "1"), true);
assert.strictEqual(normalizeField(detection, false), false);

/**
 * Enum yang salah DITOLAK di sini, sebelum menyentuh jaringan.
 *
 * Plugin mengabaikan enum tidak sah dan tetap menjawab 200 berisi nilai LAMA (Lampiran C). Tanpa
 * penolakan ini, salah ketik satu enum menghasilkan "Tersimpan." di layar untuk pengaturan yang
 * tidak berubah sama sekali.
 */
const action = BEHAVIOUR_FIELDS.find((f) => f.name === "behaviour_action");
assert.equal(normalizeField(action, "redirect"), "redirect");
assert.throws(() => normalizeField(action, "hapus_iklan"), /bukan pilihan yang sah/);
// `radio` cuma cara MENGGAMBAR enum; kalau ia tidak ikut jalur validasi yang sama, nilai yang tidak
// sah lolos ke plugin — yang mengabaikannya diam-diam sambil menjawab 200, dan layar bilang
// "Tersimpan." untuk pengaturan yang tidak berubah.
assert.equal(action.type, "radio");
assert.equal(normalizeField(action, "cover_ads"), "cover_ads");

const redirectUrl = BEHAVIOUR_FIELDS.find((f) => f.name === "behaviour_redirect_url");
assert.equal(normalizeField(redirectUrl, "https://youtube.com"), "https://youtube.com");
assert.equal(normalizeField(redirectUrl, ""), "");
assert.throws(() => normalizeField(redirectUrl, "youtube.com"), /URL lengkap/);

// Daftar: textarea satu-per-baris ATAU array. Keduanya masuk karena yang satu datang dari form dan
// yang satu dari "salin dari situs lain".
const countries = ADS_FIELDS.find((f) => f.name === "akses_lokasi_countries");
assert.deepEqual(normalizeField(countries, "Indonesia\n Malaysia \n\n"), ["Indonesia", "Malaysia"]);
assert.deepEqual(normalizeField(countries, ["Indonesia", ""]), ["Indonesia"]);

// Kode iklan lolos UTUH — yang meng-encode base64 adalah pluginnya sendiri.
const kode = ADS_FIELDS.find((f) => f.name === "kode_iklan_1");
const snippet = '<ins class="adsbygoogle" data-ad-client="ca-pub-1"></ins>';
assert.equal(normalizeField(kode, snippet), snippet);

// --- Payload partial ----------------------------------------------------------------------------

/**
 * Hanya field yang BENAR-BENAR ada di `values` yang dikirim.
 *
 * POST plugin bersifat partial. Mengirim field yang tidak diubah berarti menulis ulang nilai yang
 * kita baca beberapa menit lalu — dan menimpa perubahan orang lain yang terjadi di sela-sela.
 */
const payload = toPluginPayload("ads-settings", { jumlah_iklan: "3", mode_tampilan: "Acak" });
assert.deepEqual(payload, { jumlah_iklan: 3, mode_tampilan: "Acak" });
assert.equal(Object.hasOwn(payload, "opacity"), false);

// Field di luar skema dibuang, tidak diteruskan mentah.
assert.deepEqual(toPluginPayload("ads-settings", { jumlah_iklan: 1, sesuatu_asing: "x" }), {
  jumlah_iklan: 1,
});

assert.throws(() => toPluginPayload("ads-settings", {}), /Tidak ada field yang diubah/);
assert.throws(() => toPluginPayload("autopost", { x: 1 }), /tidak dikenal/);

// Grup yang boleh diminta = segmen alamat di API plugin, jadi daftarnya sekaligus yang menahan
// `:group` dari menunjuk endpoint lain (AutoPost sengaja tidak didokumentasikan).
assert.deepEqual(PLUGIN_GROUPS, ["ads-settings", "header-footer", "behaviour", "cmp", "security"]);

// --- CMP ----------------------------------------------------------------------------------------

/**
 * SATU-SATUNYA grup yang menolak nilai tidak sah alih-alih mengabaikannya (`save_failed`, 400) —
 * dan yang ditolak adalah SELURUH permintaan, termasuk field lain di body yang sama.
 *
 * Karena itu field ketiga yang ikut terkirim bukan sekadar sampah yang diabaikan: ia menjatuhkan
 * simpanan yang sah bersamanya. `cmp_referrer_policy` adalah kunci penyimpanan internal plugin dan
 * bukan parameter API, jadi ia TIDAK boleh ada di skema — dan penjagaannya adalah `toPluginPayload`
 * yang cuma meneruskan field yang terdaftar.
 */
assert.deepEqual(
  CMP_FIELDS.map((field) => field.name),
  ["cmp_enabled", "cmp_code"],
);

assert.deepEqual(
  toPluginPayload("cmp", { cmp_enabled: true, cmp_referrer_policy: "no-referrer" }),
  { cmp_enabled: true },
);

// Klien non-PHP: "true"/"1"/1 hidup, "false"/"0"/0 mati. Yang dikirim SELALU boolean sungguhan —
// `0` sebagai angka adalah nilai yang tidak sah di grup yang menolaknya, dan yang dibaca orang
// adalah kegagalan menyimpan untuk sakelar yang baru saja ia matikan.
assert.deepEqual(toPluginPayload("cmp", { cmp_enabled: "1" }), { cmp_enabled: true });
assert.deepEqual(toPluginPayload("cmp", { cmp_enabled: "0" }), { cmp_enabled: false });
assert.deepEqual(toPluginPayload("cmp", { cmp_enabled: false }), { cmp_enabled: false });

// Partial sungguhan di kedua arah: kode saja tidak menyentuh sakelar, sakelar saja tidak menyentuh
// kode. Kode CMP dikirim apa adanya — yang di dalamnya memang `<script>`.
assert.deepEqual(toPluginPayload("cmp", { cmp_code: "<script>fc()</script>" }), {
  cmp_code: "<script>fc()</script>",
});

// Kotak kode yang DIKOSONGKAN orang tetap terkirim sebagai string kosong, bukan dibuang seperti
// enum/int kosong: mengosongkan kode CMP adalah tindakan yang disengaja, dan field yang tidak
// terkirim membuat kode lama bertahan di situs sementara layar menunjukkan kotak kosong.
assert.deepEqual(toPluginPayload("cmp", { cmp_code: "" }), { cmp_code: "" });

// --- Keamanan -----------------------------------------------------------------------------------

/**
 * Grup KEDUA yang menolak alih-alih mengabaikan, jadi taruhan tiap field yang tidak dikenal sama
 * dengan CMP: satu nama asing menjatuhkan seluruh permintaan, termasuk field sah di body yang sama.
 *
 * `hidden_login_form` / `url_login` / `aksi_login` sengaja TIDAK punya permukaan API sama sekali —
 * slug yang salah ketik lalu didorong ke armada mencabut pintu masuk wp-admin di tiap host, dan
 * tidak ada endpoint yang bisa mengembalikannya. `behaviour_*` juga tidak di sini: ia tetap lewat
 * /manage/behaviour, dan dua endpoint yang menulis kunci yang sama dengan dua aturan validasi
 * berbeda adalah cara tercepat membuat armada tidak konsisten.
 */
assert.deepEqual(
  SECURITY_FIELDS.map((field) => field.name),
  [
    "test_mode_behaviour",
    "vi_gate_enabled",
    "video_adclick_resume",
    "video_randpos_enabled",
    "video_randpos_top",
    "video_randpos_bottom",
    "video_randpos_interval",
    "gpt_sizes",
  ],
);

assert.deepEqual(
  toPluginPayload("security", {
    vi_gate_enabled: true,
    hidden_login_form: 1,
    url_login: "rahasia",
    behaviour_detection: true,
  }),
  { vi_gate_enabled: true },
);

// Boolean sungguhan, bukan 0/1 — alasan yang sama dengan `cmp_enabled`: di grup yang menolak, `0`
// sebagai angka adalah nilai tidak sah, dan yang dibaca orang adalah kegagalan menyimpan untuk
// saklar yang baru saja ia matikan.
assert.deepEqual(toPluginPayload("security", { vi_gate_enabled: "0" }), { vi_gate_enabled: false });
assert.deepEqual(toPluginPayload("security", { video_adclick_resume: "1" }), {
  video_adclick_resume: true,
});

assert.deepEqual(toPluginPayload("security", { test_mode_behaviour: "bypass" }), {
  test_mode_behaviour: "bypass",
});
assert.throws(
  () => toPluginPayload("security", { test_mode_behaviour: "respect-behaviour" }),
  /bukan pilihan yang sah/,
);

/**
 * SATU ANGKA DIKIRIM SEBAGAI RENTANG, dan itu bukan kerapian.
 *
 * Situs membacakan `video_randpos_interval` kembali sebagai "lo-hi" apa pun yang dikirim: "20"
 * tersimpan dan dilaporkan "20-20". Dikirim apa adanya, `unappliedFields` membandingkan "20" dengan
 * "20-20" dan melaporkan field yang justru tersimpan DENGAN BENAR sebagai "ditolak diam-diam di
 * sana" — di satu-satunya penjaga yang halaman ini punya untuk kegagalan yang sungguhan.
 */
assert.deepEqual(toPluginPayload("security", { video_randpos_interval: "20" }), {
  video_randpos_interval: "20-20",
});
assert.deepEqual(toPluginPayload("security", { video_randpos_interval: "10-30" }), {
  video_randpos_interval: "10-30",
});
// Spasi di sekitar tanda hubung diketik orang lebih sering daripada tidak.
assert.deepEqual(toPluginPayload("security", { video_randpos_interval: " 10 - 30 " }), {
  video_randpos_interval: "10-30",
});
// "0" = mati, dan ia bentuk yang sah — bukan kotak kosong.
assert.deepEqual(toPluginPayload("security", { video_randpos_interval: "0" }), {
  video_randpos_interval: "0-0",
});

assert.throws(
  () => toPluginPayload("security", { video_randpos_interval: "61" }),
  /maksimal 60 per sisi/,
);
assert.throws(
  () => toPluginPayload("security", { video_randpos_interval: "30-10" }),
  /batas bawah \(30\) tidak boleh melebihi batas atas \(10\)/,
);
assert.throws(
  () => toPluginPayload("security", { video_randpos_interval: "10-20-30" }),
  /satu angka \(20\) atau dua angka/,
);
assert.throws(
  () => toPluginPayload("security", { video_randpos_interval: "sepuluh" }),
  /satu angka \(20\) atau dua angka/,
);

// Persen posisi tetap `int` biasa, dengan langit-langit yang diperiksa di sini — bukan dijepit
// diam-diam oleh situs, yang di grup ini justru menolak seluruh permintaan.
assert.deepEqual(toPluginPayload("security", { video_randpos_top: "15" }), {
  video_randpos_top: 15,
});
assert.throws(() => toPluginPayload("security", { video_randpos_top: "250" }), /maksimal 100/);

/**
 * `gpt_sizes` KOSONG adalah nilai yang sah dan berarti sesuatu — "pakai daftar yang tertulis di
 * kode iklan situs". Karena itu ia dikirim sebagai string kosong alih-alih dijatuhkan seperti enum
 * dan angka kosong: field yang tidak terkirim membuat daftar lama bertahan di situs sementara layar
 * menunjukkan kotak kosong. Aturan yang sama dengan `cmp_code`.
 */
assert.deepEqual(toPluginPayload("security", { gpt_sizes: "" }), { gpt_sizes: "" });
assert.deepEqual(toPluginPayload("security", { gpt_sizes: "320x480,300x250,336x280" }), {
  gpt_sizes: "320x480,300x250,336x280",
});
// Dinormalkan supaya yang dikirim satu bentuk: `unappliedFields` membandingkannya dengan jawaban
// situs, dan "320X480" yang dijawab "320x480" akan terbaca sebagai nilai yang ditolak.
assert.deepEqual(toPluginPayload("security", { gpt_sizes: " 320X480 , 300x250 " }), {
  gpt_sizes: "320x480,300x250",
});
// `fluid` bukan ukuran melainkan permintaan agar slotnya mengikuti lebar wadahnya.
assert.deepEqual(toPluginPayload("security", { gpt_sizes: "fluid,300x250" }), {
  gpt_sizes: "fluid,300x250",
});

assert.throws(() => toPluginPayload("security", { gpt_sizes: "320*480" }), /bukan ukuran yang sah/);
assert.throws(() => toPluginPayload("security", { gpt_sizes: "10x250" }), /di luar batas 20-2000/);
assert.throws(
  () => toPluginPayload("security", { gpt_sizes: "300x2500" }),
  /di luar batas 20-2000/,
);
assert.throws(
  () =>
    toPluginPayload("security", {
      gpt_sizes: Array.from({ length: 21 }, (_, i) => `${300 + i}x250`).join(","),
    }),
  /maksimal 20 ukuran/,
);

/**
 * Bentuk yang dikirim SAMA dengan bentuk yang dijawab situs — itulah seluruh guna normalisasi di
 * atas. Diperiksa lewat `unappliedFields` sendiri, bukan dengan membandingkan string di kepala:
 * yang harus benar bukan bentuknya melainkan bahwa penjaga itu DIAM untuk nilai yang tersimpan
 * dengan benar.
 */
{
  const payload = toPluginPayload("security", {
    video_randpos_interval: "20",
    gpt_sizes: " 320X480 ",
    vi_gate_enabled: true,
  });
  assert.deepEqual(
    unappliedFields(payload, {
      video_randpos_interval: "20-20",
      gpt_sizes: "320x480",
      vi_gate_enabled: true,
    }),
    [],
  );
}

// --- "Tersimpan tapi tidak berubah" -------------------------------------------------------------

/**
 * Penjaga paling penting di modul ini: plugin menjawab 200 + success:true untuk enum yang
 * diabaikannya. Yang membedakan "tersimpan" dari "tersimpan dan berubah" cuma perbandingan ini.
 */
assert.deepEqual(unappliedFields({ jumlah_iklan: 4 }, { jumlah_iklan: "3" }), ["jumlah_iklan"]);

// Perbandingannya SENGAJA longgar: situs menjawab dari kolom database, jadi 3 kembali sebagai "3"
// dan true sebagai "1". Ketat, tiap field akan tertandai gagal dan peringatannya tidak berarti apa-apa.
assert.deepEqual(unappliedFields({ jumlah_iklan: 4 }, { jumlah_iklan: "4" }), []);
assert.deepEqual(unappliedFields({ behaviour_detection: true }, { behaviour_detection: "1" }), []);
assert.deepEqual(unappliedFields({ refresh_blank: 0 }, { refresh_blank: false }), []);
assert.deepEqual(
  unappliedFields({ akses_lokasi_countries: ["Indonesia"] }, { akses_lokasi_countries: ["Indonesia"] }),
  [],
);

// Field yang tidak dikembalikan sama sekali bukan kegagalan — sebagian endpoint menjawab ringkasan.
assert.deepEqual(unappliedFields({ header_code: "<x>" }, {}), []);

// --- Baris RTDB ---------------------------------------------------------------------------------

const site = { id: "-Nsub1", name: "sub.domain.com" };
const fresh = pluginSiteRow(site, { enrolled: true, version: "0.4.7" }, null, new Date("2026-08-18T03:00:00Z"));
assert.equal(fresh.enrolled, true);
assert.equal(fresh.version, "0.4.7");
assert.equal(fresh.name, "sub.domain.com");

/**
 * `enrolled` BERTAHAN lewat kegagalan berikutnya.
 *
 * Disimpulkan dari `version` atau dari ping terakhir, situs yang enroll-nya berhasil tapi ping
 * berikutnya gagal akan digambar "belum enroll" — dan tombol Enroll yang muncul untuknya akan
 * dijawab `already_enrolled`, yang jalan keluarnya reset, yang membuang kunci yang masih sah.
 */
const afterFailure = pluginSiteRow(site, { error: "timeout", errorCode: "timeout" }, fresh);
assert.equal(afterFailure.enrolled, true);
assert.equal(afterFailure.version, "0.4.7");
assert.equal(afterFailure.error, "timeout");

// Jawaban berhasil menghapus kegagalan lama; dibiarkan, situs yang baru saja menjawab tetap merah.
const recovered = pluginSiteRow(site, { error: "", errorCode: "", errorAt: "" }, afterFailure);
assert.equal(recovered.error, "");

assert.throws(() => pluginKeyEntry("", "dev@x"), /tidak mengembalikan api_key/);
assert.equal(pluginKeyEntry("abc123", "dev@x").apiKey, "abc123");

// --- Landing ------------------------------------------------------------------------------------

const landings = landingRows([
  { id: 12, slug: "promo-a", title: "Watch Now", status: "1", template_file: "UniversalLongScreenshot" },
  { id: 3, slug: "promo-b", status: "0" },
  { slug: "tanpa-id" },
]);
assert.equal(landings.length, 2);
assert.deepEqual(landings.map((row) => row.id), ["3", "12"]);
// `status` dipetakan ke boolean SEKALI di sini: di JS, "0" truthy, dan tiap tabel yang memutuskan
// sendiri akan menggambar landing nonaktif sebagai aktif.
assert.equal(landings[0].active, false);
assert.equal(landings[1].active, true);

// --- Terapkan massal ------------------------------------------------------------------------------

// `unapplied` berdiri sendiri, bukan dilebur: dilebur ke berhasil ia hilang, dilebur ke gagal ia
// mengundang percobaan ulang yang tidak akan mengubah apa pun.
const summary = bulkSummary([
  { status: "ok" },
  { status: "ok" },
  { status: "unapplied" },
  { status: "failed" },
]);
assert.deepEqual(summary, { total: 4, ok: 2, unapplied: 1, failed: 1 });

// --- Kode HTTP ------------------------------------------------------------------------------------

/**
 * Kegagalan di SITUS tidak boleh keluar sebagai 401 milik kita. `invalid_key` yang diteruskan apa
 * adanya akan dibaca browser sebagai "token Firebase-mu kedaluwarsa", dan orangnya disuruh login
 * ulang untuk situs yang kuncinya bermasalah.
 */
assert.equal(pluginFailureStatus(new PluginError("x", { code: "invalid_key", status: 401 })), 502);
assert.equal(pluginFailureStatus(new PluginError("x", { code: "timeout" })), 502);
// Yang ditolak SEBELUM menyentuh jaringan bisa diperbaiki orangnya di form yang sedang terbuka.
assert.equal(pluginFailureStatus(new PluginError("enum salah")), 422);
assert.equal(pluginFailureStatus(new Error("bug")), 500);

// --- URL media: apa pun bentuknya, dikirim sebagai array bersih ---------------------------------
//
// ARRAY, sesuai Lampiran A — dan itu koreksi dari versi sebelumnya yang mengirim string. Bentuk
// rusak yang ditemukan di produksi (JSON dengan koma yang hilang, tanda kutip ter-escape menempel
// di URL pertama dan terakhir) justru LAHIR dari mengirim string ke field yang dibaca plugin
// sebagai array: memperbaikinya dengan string lagi akan membuatnya lahir kembali tiap Simpan.

const video = LANDING_FIELDS.find((f) => f.name === "video_urls");
assert.equal(video.type, "media");

// Bentuk yang sedang ada di produksi: 120 URL dipisah baris baru alih-alih koma. `JSON.parse`
// menolaknya, dan yang menyerah di situ meneruskan seluruh blok apa adanya ke kotak isian.
const rusak = ['["\\"https://a.live/x1.m3u8"', '"https://a.live/x2.m3u8"', '"https://a.live/x3.m3u8\\""]'].join(
  "\n",
);
assert.deepEqual(normalizeField(video, rusak), [
  "https://a.live/x1.m3u8",
  "https://a.live/x2.m3u8",
  "https://a.live/x3.m3u8",
]);

assert.deepEqual(normalizeField(video, "https://cdn/x.mp4"), ["https://cdn/x.mp4"]);
assert.deepEqual(normalizeField(video, ["https://a.mp4", "https://b.mp4"]), [
  "https://a.mp4",
  "https://b.mp4",
]);
// Satu elemen array yang isinya blob berbaris banyak — bentuk yang lahir dari textarea yang
// dikirim utuh sebagai satu string.
assert.deepEqual(normalizeField(video, ["https://a.mp4\nhttps://b.mp4"]), [
  "https://a.mp4",
  "https://b.mp4",
]);
assert.deepEqual(normalizeField(video, null), []);

// Kutip TUNGGAL sah di dalam URL dan tidak muncul di satu pun bentuk rusak — ikut dibuang, URL
// yang benar jadi salah tanpa ada yang tahu.
assert.deepEqual(mediaList("\"https://a.live/x?q='v'\""), ["https://a.live/x?q='v'"]);

// --- Tata letak form ----------------------------------------------------------------------------
//
// Form digambar dua kolom, jadi field yang melebar penuh harus jatuh di AWAL baris. Di tengah, ia
// mendorong dirinya ke baris berikutnya dan meninggalkan satu sel kosong menganga di sebelah field
// sebelumnya — persis yang membuat tab Behaviour dan tab Iklan terbaca berantakan.
//
// Bukan "yang melebar harus terakhir": saklar induk seperti `behaviour_detection` justru paling
// terbaca sebagai satu baris penuh di ATAS field yang diaturnya.
//
// Grup ber-`columns: 1` DILEWATI, dan itu bukan lubang: `.plugin-form-single` benar-benar
// menggambar satu kolom, jadi di sana tiap field sudah memulai barisnya sendiri dan tidak ada sel
// kosong yang bisa menganga. Diperiksa juga, aturan ini menuntut CMP menaruh textarea kodenya di
// ATAS sakelarnya — urutan terbalik dari layar plugin, demi baris kedua yang tidak pernah ada.

// Sama persis dengan `isWide` di FieldInput (src/components/Plugin.jsx). `radio` sempat tidak ada di
// sini, dan lubangnya tidak pernah terlihat karena satu-satunya grup ber-radio waktu itu (Behaviour)
// digambar satu kolom dan karena itu dilewati seluruhnya. Keamanan grup dua kolom pertama yang punya
// radio: dibiarkan, aturan ini diam persis untuk field yang paling lebar di halaman.
const isWideField = (field) =>
  field.wide === true || field.type === "html" || field.type === "radio";

for (const [groupKey, group] of Object.entries(PLUGIN_SCHEMA)) {
  if (group.columns === 1) continue;

  const byGroup = new Map();
  for (const field of group.fields) {
    if (!byGroup.has(field.group)) byGroup.set(field.group, []);
    byGroup.get(field.group).push(field);
  }

  for (const [name, list] of byGroup) {
    let column = 0;
    for (const field of list) {
      if (isWideField(field)) {
        assert.equal(
          column,
          0,
          `${groupKey}/${name}: "${field.label}" melebar penuh tapi jatuh di tengah baris`,
        );
        continue;
      }
      column = (column + 1) % 2;
    }
  }
}

// --- Ganti versi plugin ---------------------------------------------------------------------------

// Body KOSONG untuk rilis terbaru, bukan `{version:"latest"}` — itu kontrak API-nya, dan string
// "latest" akan dicari sebagai rilis bernama "latest" yang tidak akan pernah ada.
assert.deepEqual(updatePayload(""), {});
assert.deepEqual(updatePayload("latest"), {});
assert.deepEqual(updatePayload("0.4.8"), { version: "0.4.8" });
// `release_tag` mengembalikan "v0.4.8" sementara `version` "0.4.8"; orang akan menyalin salah
// satunya, jadi yang dikirim harus satu bentuk saja.
assert.deepEqual(updatePayload("v0.4.8"), { version: "0.4.8" });
assert.throws(() => normalizeVersion("abc"), /tidak berbentuk angka versi/);
assert.throws(() => normalizeVersion("0.4.8; rm -rf"), /tidak berbentuk angka versi/);

// Pesan WordPress datang ber-entity HTML, dan ia satu-satunya jendela ke apa yang terjadi di situs
// saat pemasangan gagal separuh jalan.
assert.equal(decodeEntities("Unpacking the package&#8230;"), "Unpacking the package…");
assert.equal(decodeEntities("a &amp; b"), "a & b");

const updated = pluginUpdateRow({
  installed: true,
  requested: "latest",
  release_tag: "v0.4.8",
  version: "0.4.8",
  messages: ["Unpacking the package&#8230;", "Plugin installed successfully."],
});
assert.equal(updated.version, "0.4.8");
assert.equal(updated.messages[0], "Unpacking the package…");

/**
 * `success: true` TIDAK berarti versinya berubah — pola yang sama dengan enum yang diabaikan
 * diam-diam di /behaviour. Dinilai dari `success` saja, layar bilang "berhasil diperbarui" untuk
 * situs yang versinya tidak bergerak sedikit pun.
 */
assert.equal(updateOutcome(updated, "").status, "ok");
assert.equal(updateOutcome({ ...updated, installed: false }, "").status, "unapplied");
// Diminta satu versi, yang terpasang versi lain: bukan keberhasilan.
assert.equal(updateOutcome(updated, "0.2.8").status, "unapplied");
assert.match(updateOutcome(updated, "0.2.8").note, /Diminta 0\.2\.8/);

// Ping armada: hanya situs enrolled yang baris subdomainnya MASIH hidup. Yang diarsipkan (atau
// barisnya sudah tidak ada) dilewati — situsnya sudah dilepas, dan pingnya cuma isu sync permanen.
assert.deepEqual(
  pluginPingIds(
    {
      live: { enrolled: true },
      archived: { enrolled: true },
      gone: { enrolled: true },
      notEnrolled: { enrolled: false },
    },
    {
      live: { name: "a.x.com" },
      archived: { name: "b.x.com", deletedAt: "2026-09-22T11:47:33.459Z" },
      notEnrolled: { name: "c.x.com" },
    },
  ),
  ["live"],
);

console.log("plugin-core: ok");
