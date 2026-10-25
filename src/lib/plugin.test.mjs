import assert from "node:assert";
import { readFileSync } from "node:fs";
import nodePath from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const {
  PLUGIN_GROUPS,
  bulkLabel,
  bulkMessage,
  bulkTone,
  changedValues,
  groupFields,
  hasChanges,
  pluginSiteState,
  pluginSummary,
  toFormValue,
  toFormValues,
  toPluginRows,
  unappliedMessage,
} = await import("./plugin.js");

/**
 * `PLUGIN_GROUPS` ditulis DUA KALI — di sini dan di functions/plugin-core.js — dan tes ini menjaga
 * keduanya sama persis dengan MEMBACA berkas seberangnya, persis pola `campaignCommandEntry`.
 *
 * Salinan di `src/` memang belum dibaca satu komponen pun, dan justru itu yang membuatnya berbahaya
 * dibiarkan tanpa penjaga: grup baru yang lahir di server tidak akan pernah ikut ke sini sampai ada
 * yang membacanya, dan yang pertama membacanya akan menemukan daftar yang diam-diam sudah basi.
 * Daftar itu bukan hiasan — ia yang memvalidasi `:group`, yang disambung mentah jadi segmen alamat
 * di API plugin.
 */
test("PLUGIN_GROUPS sama persis dengan yang di functions/plugin-core.js", () => {
  const root = nodePath.join(nodePath.dirname(fileURLToPath(import.meta.url)), "../..");
  const core = readFileSync(nodePath.join(root, "functions/plugin-core.js"), "utf8");
  const line = core.match(/export const PLUGIN_GROUPS = (\[[^\]]*\]);/);

  assert.ok(line, "PLUGIN_GROUPS tidak ditemukan di functions/plugin-core.js");
  assert.deepEqual(PLUGIN_GROUPS, JSON.parse(line[1]));
});

const SUBDOMAINS = [
  { id: "s2", name: "zeta.rabbit.live", parentDomain: "rabbit.live", pic: "Nur", status: "Active" },
  { id: "s1", name: "alfa.rabbit.live", parentDomain: "rabbit.live", pic: "Aldi", status: "Active" },
  { id: "s3", name: "", pic: "tanpa nama" },
];

test("baris dipimpin subDomains, bukan cermin plugin", () => {
  // Situs yang belum pernah di-enroll tidak punya baris cermin sama sekali — dan itu justru daftar
  // yang paling sering dibuka orang di halaman ini.
  const rows = toPluginRows(SUBDOMAINS, { s1: { enrolled: true, version: "0.4.7" } });

  assert.deepEqual(
    rows.map((row) => row.name),
    ["alfa.rabbit.live", "zeta.rabbit.live"],
  );
  assert.equal(rows[0].enrolled, true);
  assert.equal(rows[0].version, "0.4.7");
  assert.equal(rows[1].enrolled, false);
  assert.equal(rows[1].mirrored, false);
});

test("baris tanpa nama host dibuang — tidak ada alamat yang bisa dipakai", () => {
  assert.equal(toPluginRows(SUBDOMAINS, {}).length, 2);
});

test("status subdomain dan status plugin tidak dilebur", () => {
  const [row] = toPluginRows([{ id: "s1", name: "a.b.co", status: "Inactive" }], {
    s1: { enrolled: true },
  });
  // Subdomain yang sudah tidak dipakai tetap boleh punya plugin yang hidup; satu kolom untuk
  // keduanya membuat keduanya tidak bisa dibaca.
  assert.equal(row.subdomainStatus, "Inactive");
  assert.equal(row.enrolled, true);
});

test("belum enroll menawarkan Enroll, dan tidak menawarkan yang lain", () => {
  const state = pluginSiteState({ enrolled: false }, { canManage: true });
  assert.equal(state.canEnroll, true);
  assert.equal(state.canManage, false);
  assert.equal(state.canReset, false);
  assert.equal(state.label, "Belum");
});

test("terhubung menawarkan Kelola, Ping, dan Reset", () => {
  const state = pluginSiteState({ enrolled: true }, { canManage: true });
  assert.equal(state.canManage, true);
  assert.equal(state.canPing, true);
  assert.equal(state.canReset, true);
  assert.equal(state.tone, "success");
});

test("enroll yang gagal tetap bisa dikelola — situsnya bisa saja sudah hidup lagi", () => {
  const state = pluginSiteState({ enrolled: true, error: "timeout" }, { canManage: true });
  assert.equal(state.canManage, true);
  assert.equal(state.tone, "warning");
  assert.equal(state.reason, "timeout");
});

/**
 * `invalid_key` adalah JALAN BUNTU, dan harus terlihat begitu.
 *
 * Kunci kita tidak dikenali situs itu lagi; reset — satu-satunya jalan ke enroll ulang — justru
 * membutuhkan kunci yang sudah tidak berlaku. Digambar seperti kegagalan biasa, orang akan menekan
 * tombol yang sama berkali-kali untuk sesuatu yang tidak akan pernah berhasil dari sini.
 */
test("kunci yang ditolak situs tidak menawarkan Kelola, dan bilang kenapa", () => {
  const state = pluginSiteState(
    { enrolled: true, error: "ditolak", errorCode: "invalid_key" },
    { canManage: true },
  );
  assert.equal(state.canManage, false);
  assert.equal(state.tone, "danger");
  assert.match(state.reason, /Tidak ada tombol di sini yang bisa memperbaikinya/);
});

// Situs yang sudah enroll dengan kunci yang tidak kita punya: enroll lagi akan ditolak dengan pesan
// yang sama selamanya, jadi tombol Enroll-nya dimatikan berikut satu-satunya jalan keluarnya.
test("already_enrolled tanpa kunci di sisi kita tidak menawarkan Enroll", () => {
  const state = pluginSiteState(
    { enrolled: false, errorCode: "already_enrolled" },
    { canManage: true },
  );
  assert.equal(state.canEnroll, false);
  assert.equal(state.label, "Terkunci");
  assert.match(state.reason, /dari WordPress situsnya sendiri/);
});

test("tanpa server kontrol, tidak ada satu tombol pun — dan alasannya disebut", () => {
  const state = pluginSiteState({ enrolled: true }, { canManage: true, serverReady: false });
  assert.equal(state.canManage, false);
  assert.equal(state.canEnroll, false);
  assert.match(state.reason, /VITE_CONTROL_API_URL/);
});

test("bukan superadmin tidak dapat tombol apa pun", () => {
  const state = pluginSiteState({ enrolled: true }, { canManage: false });
  assert.equal(state.canManage, false);
  assert.match(state.reason, /superadmin/);
});

test("ringkasan memisahkan yang belum dipasang dari yang berhenti menjawab", () => {
  const summary = pluginSummary([
    { enrolled: true },
    { enrolled: true, error: "timeout" },
    { enrolled: false },
  ]);
  assert.deepEqual(summary, { total: 3, enrolled: 2, pending: 1, failing: 1 });
});

// --- Form ---------------------------------------------------------------------------------------

test("nilai API jadi bentuk kotak isian: string, kecuali saklar", () => {
  assert.equal(toFormValue({ type: "int" }, 3), "3");
  assert.equal(toFormValue({ type: "text" }, null), "");
  assert.equal(toFormValue({ type: "bool01" }, "1"), true);
  assert.equal(toFormValue({ type: "bool01" }, "0"), false);
  assert.equal(toFormValue({ type: "boolean" }, true), true);
  // Daftar jadi satu-per-baris, apa pun bentuk aslinya — situs menjawab array, tapi kolom lama
  // kadang berisi teks berkoma.
  assert.equal(toFormValue({ type: "list" }, ["Indonesia", "Malaysia"]), "Indonesia\nMalaysia");
  assert.equal(toFormValue({ type: "list" }, "Indonesia, Malaysia"), "Indonesia\nMalaysia");
});

/**
 * Hanya yang BENAR-BENAR diubah yang dikirim.
 *
 * Mengirim seluruh form berarti menulis ulang tiap field dengan nilai yang kita baca beberapa menit
 * lalu — dan di halaman yang mengelola armada, itu berarti perubahan orang lain di sela-sela hilang
 * tanpa jejak, di situs yang sedang menerima trafik berbayar.
 */
test("hanya field yang berubah yang ikut dikirim", () => {
  const fields = [{ name: "a", type: "text" }, { name: "b", type: "int" }, { name: "c", type: "bool01" }];
  const original = { a: "satu", b: "3", c: false };

  assert.deepEqual(changedValues(fields, { ...original }, original), {});
  assert.deepEqual(changedValues(fields, { ...original, b: "4" }, original), { b: "4" });
  assert.deepEqual(changedValues(fields, { ...original, c: true }, original), { c: true });
  assert.equal(hasChanges(fields, { ...original }, original), false);
  assert.equal(hasChanges(fields, { ...original, a: "dua" }, original), true);
});

// Angka yang datang sebagai 3 dari satu endpoint dan "3" dari endpoint lain tidak boleh terbaca
// sebagai perubahan: kedua sisi perbandingan lewat toFormValues dulu.
test("bentuk yang berbeda untuk nilai yang sama bukan perubahan", () => {
  const fields = [{ name: "jumlah_iklan", type: "int" }];
  const dariApi = toFormValues(fields, { jumlah_iklan: 3 });
  const dariApiLain = toFormValues(fields, { jumlah_iklan: "3" });
  assert.deepEqual(changedValues(fields, dariApiLain, dariApi), {});
});

test("grup mengikuti urutan skema, bukan alfabet", () => {
  const groups = groupFields([
    { name: "a", group: "Umum" },
    { name: "b", group: "Log" },
    { name: "c", group: "Umum" },
  ]);
  assert.deepEqual(
    groups.map((group) => group.name),
    ["Umum", "Log"],
  );
  assert.equal(groups[0].fields.length, 2);
});

// Disebut dengan label yang dibaca orang di form: seseorang yang baru mengetik di kotak "Jumlah
// slot iklan" tidak punya cara tahu bahwa itu `jumlah_iklan`.
test("field yang tidak berubah disebut dengan label formnya", () => {
  const message = unappliedMessage(
    ["jumlah_iklan"],
    [{ name: "jumlah_iklan", label: "Jumlah slot iklan" }],
  );
  assert.match(message, /Jumlah slot iklan/);
  assert.equal(unappliedMessage([], []), "");
});

// --- Terapkan massal --------------------------------------------------------------------------------

test("tidak-berubah berwarna kuning, bukan merah", () => {
  // Perubahannya sampai ke situs; hanya nilainya yang ditolak diam-diam. Merah mengundang
  // pengulangan, dan pengulangan tidak akan mengubah apa pun.
  assert.equal(bulkTone("ok"), "success");
  assert.equal(bulkTone("unapplied"), "warning");
  assert.equal(bulkTone("failed"), "danger");
  assert.equal(bulkLabel("unapplied"), "Tidak berubah");
});

test("kalimat massal tidak pernah menyembunyikan yang tidak berubah", () => {
  const bersih = bulkMessage({ total: 3, ok: 3, unapplied: 0, failed: 0 }, "Pengaturan Iklan");
  assert.equal(bersih.tone, "success");
  assert.match(bersih.message, /3 berhasil/);

  const sebagian = bulkMessage({ total: 3, ok: 1, unapplied: 2, failed: 0 }, "Behaviour");
  assert.equal(sebagian.tone, "warning");
  assert.match(sebagian.message, /2 tidak berubah/);

  const gagal = bulkMessage({ total: 3, ok: 1, unapplied: 1, failed: 1 }, "Behaviour");
  assert.equal(gagal.tone, "error");
  assert.match(gagal.message, /1 gagal/);
});

// --- URL media: apa pun bentuknya, jadi daftar URL bersih --------------------------------------

const { mediaList, unwrapMedia } = await import("./plugin.js");

// Bentuk yang SEDANG ADA DI PRODUKSI, dan yang paling sering salah dibaca: JSON dengan komanya
// hilang — dipisah baris baru — plus tanda kutip ter-escape yang menempel di URL pertama dan
// terakhir. `JSON.parse` menolaknya, dan pembaca yang menyerah di situ meneruskan seluruh blok itu
// apa adanya ke kotak isian, kurung siku dan segalanya.
test("JSON yang komanya hilang tetap terbaca sebagai daftar URL", () => {
  const blob = [
    '["\\"https://a.live/x1.m3u8"',
    '"https://a.live/x2.m3u8"',
    '"https://a.live/x3.m3u8\\""]',
  ].join("\n");

  assert.deepEqual(mediaList(blob), [
    "https://a.live/x1.m3u8",
    "https://a.live/x2.m3u8",
    "https://a.live/x3.m3u8",
  ]);
});

test("empat bentuk lain ikut terbaca", () => {
  // array sungguhan
  assert.deepEqual(mediaList(["https://a", "https://b"]), ["https://a", "https://b"]);
  // JSON yang sah
  assert.deepEqual(mediaList('["https://a","https://b"]'), ["https://a", "https://b"]);
  // teks satu-URL-per-baris
  assert.deepEqual(mediaList("https://a\nhttps://b"), ["https://a", "https://b"]);
  // array berisi SATU blob berbaris banyak
  assert.deepEqual(mediaList(["https://a\nhttps://b"]), ["https://a", "https://b"]);

  assert.deepEqual(mediaList(null), []);
  assert.deepEqual(mediaList([]), []);
  assert.deepEqual(mediaList("   "), []);
});

// Satu URL per BARIS, bukan dipisah koma: yang ada di lapangan adalah 120 URL dalam satu field,
// dan koma menjadikannya satu baris sepanjang layar yang tidak bisa dibaca apalagi disunting.
test("kotak isian menampilkan satu URL per baris", () => {
  assert.equal(unwrapMedia(["https://a", "https://b"]), "https://a\nhttps://b");
  assert.equal(unwrapMedia("https://a"), "https://a");
  assert.equal(unwrapMedia(null), "");
});

// Tanda kutip di TENGAH dibiarkan: sebuah URL boleh memuatnya, dan memotong di situ menghasilkan
// URL yang salah tanpa ada yang tahu.
test("hanya kutip di ujung yang dibuang", () => {
  assert.deepEqual(mediaList('"https://a.live/x?q=\'v\'"'), ["https://a.live/x?q='v'"]);
});

test("field media lewat toFormValue ikut terbaca bersih", () => {
  const fields = [{ name: "video_urls", type: "media" }];
  assert.deepEqual(toFormValues(fields, { video_urls: '["https://cdn/x.mp4"]' }), {
    video_urls: "https://cdn/x.mp4",
  });
});

// --- `?situs=` bertahan melewati refresh -----------------------------------------------------------

const { shouldForgetOpenSite } = await import("./plugin.js");

/**
 * Ini regresi yang benar-benar terjadi, dan akibatnya membatalkan seluruh gunanya `?situs=`.
 *
 * Saat halaman dimuat ulang, langganan RTDB belum mengirim apa pun: daftarnya kosong sementara id
 * situsnya sudah terbaca dari alamat. Penjaga yang menyimpulkan "situsnya sudah dihapus" dari
 * keadaan itu menghapus `?situs=` dan melempar orang kembali ke daftar armada — dan `?tab=` yang
 * tertinggal di belakangnya membuat seolah tab-nya yang rusak.
 */
test("selama daftarnya belum datang, situs yang terbuka TIDAK dilupakan", () => {
  assert.equal(shouldForgetOpenSite("s1", [], true), false);
  // Bahkan saat daftarnya sudah terisi sebagian tapi belum selesai dimuat.
  assert.equal(shouldForgetOpenSite("s1", [{ id: "s2" }], true), false);
});

test("setelah daftarnya datang, situs yang benar-benar tidak ada baru dilupakan", () => {
  assert.equal(shouldForgetOpenSite("s1", [{ id: "s2" }], false), true);
  assert.equal(shouldForgetOpenSite("s1", [], false), true);
});

test("situs yang ada tetap terbuka, dan alamat tanpa situs tidak menyuruh apa-apa", () => {
  assert.equal(shouldForgetOpenSite("s1", [{ id: "s1" }], false), false);
  assert.equal(shouldForgetOpenSite("", [{ id: "s1" }], false), false);
  assert.equal(shouldForgetOpenSite("", [], false), false);
});

/**
 * Tipe field datang dari server (`GET /plugin/schema`), jadi selama server kontrol belum di-deploy
 * ulang `video_urls` masih dikirim sebagai `list` — bukan `media`. Kalau cabang `list` memakai
 * pemecah baris polos, blob mentahnya tetap muncul di layar walau `mediaList` sudah benar.
 */
test("field list dibersihkan sama seperti media — tampilan tidak menunggu deploy server", () => {
  const asList = [{ name: "video_urls", type: "list" }];
  const blob = ['["\\"https://a.live/x1.m3u8"', '"https://a.live/x2.m3u8\\""]'].join("\n");

  assert.deepEqual(toFormValues(asList, { video_urls: blob }), {
    video_urls: "https://a.live/x1.m3u8\nhttps://a.live/x2.m3u8",
  });
});

// Daftar biasa tetap berperilaku sama seperti sebelumnya — pembersihnya lebih toleran, bukan
// lebih agresif.
test("daftar biasa tidak berubah artinya", () => {
  const asList = [{ name: "negara", type: "list" }];
  assert.deepEqual(toFormValues(asList, { negara: ["Indonesia", "Malaysia"] }), {
    negara: "Indonesia\nMalaysia",
  });
  assert.deepEqual(toFormValues(asList, { negara: "Indonesia, Malaysia" }), {
    negara: "Indonesia\nMalaysia",
  });
  // Bentuk JSON yang sudah di-encode ikut terbaca, yang dulu tampil lengkap dengan tanda bacanya.
  assert.deepEqual(toFormValues(asList, { negara: '["Indonesia","Malaysia"]' }), {
    negara: "Indonesia\nMalaysia",
  });
});
