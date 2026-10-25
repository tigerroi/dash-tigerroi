import assert from "node:assert/strict";
import test from "node:test";
import { navItems } from "../config/navigation.js";
import { resources } from "../config/resources.js";
import { resolveRoute } from "./resolveRoute.js";

// Halaman VI Control pindah alamat dari /gating ke /vi-control. Yang dijaga di sini: alamat lamanya
// tetap membuka halaman yang sama. Kalau tidak, bookmark dan tautan yang sudah beredar berakhir di
// halaman "tidak ditemukan" — dan halaman itu tidak memberi tahu ke mana halamannya pindah.
test("alamat baru dan alamat lama VI Control menghasilkan rute yang sama", () => {
  const baru = resolveRoute("/vi-control", {});
  const lama = resolveRoute("/gating", {});

  assert.deepEqual(baru, { kind: "gating", key: "gating" });
  assert.deepEqual(lama, baru);
});

// `key` yang ikut berganti berarti SUPERADMIN_PAGES, canReadResource, dan aturan database harus
// berganti serempak untuk perubahan yang tidak terlihat siapa pun di layar.
test("kunci aksesnya tetap `gating`, bukan ikut nama barunya", () => {
  assert.equal(resolveRoute("/vi-control", {}).key, "gating");
});

// Proyeksi Budget pindah alamat dari /spending ke /proyeksi-budget, dan alasannya sama persis
// dengan VI Control di atas: alamat lamanya sudah beredar sebagai bookmark, dan alamat yang mati
// mendarat di halaman "tidak ditemukan" yang tidak menyebut ke mana halamannya pindah.
test("alamat baru dan alamat lama Proyeksi Budget menghasilkan rute yang sama", () => {
  const baru = resolveRoute("/proyeksi-budget", {});
  const lama = resolveRoute("/spending", {});

  assert.deepEqual(baru, { kind: "spending", key: "spending" });
  assert.deepEqual(lama, baru);
});

// `key` inilah SATU-SATUNYA penjaga halaman ini — tidak ada satu pun aturan database di
// belakangnya. Ikut berganti nama, "spending" di SUPERADMIN_PAGES tidak lagi cocok dengan apa pun
// dan halamannya terbuka untuk siapa saja yang mengetik alamatnya.
test("kunci aksesnya tetap `spending`, bukan ikut nama barunya", () => {
  assert.equal(resolveRoute("/proyeksi-budget", {}).key, "spending");
});

test("alamat yang bukan keduanya tidak ikut terbaca sebagai halaman itu", () => {
  assert.equal(resolveRoute("/vi-control/57", {}).kind, "missing");
  assert.equal(resolveRoute("/gating-lama", {}).kind, "missing");
  assert.equal(resolveRoute("/proyeksi-budget/2026-08", {}).kind, "missing");
});

// Tanpa `key`, `canReadResource` tidak pernah ditanya di App — dan halaman superadmin itu terbuka
// untuk siapa saja yang mengetik alamatnya.
test("/activity-logs membawa key-nya, supaya gerbang superadmin ikut memeriksanya", () => {
  assert.deepEqual(resolveRoute("/activity-logs", {}), {
    kind: "activityLogs",
    key: "activityLogs",
  });
});

// Tab Overview adalah route sungguhan, sepola dengan tab lain di dashboard ini: `/` dan
// `/dashboard` mendarat di tab pertama, dan alamat tab yang dibagikan membuka tab itu.
test("tab Overview dibaca dari alamatnya, dan alamat lamanya tetap tab pertama", () => {
  assert.deepEqual(resolveRoute("/dashboard", {}), {
    kind: "dashboard",
    key: "dashboard",
    tab: "ringkasan",
  });
  assert.deepEqual(resolveRoute("/", {}), {
    kind: "dashboard",
    key: "dashboard",
    tab: "ringkasan",
  });
  assert.equal(resolveRoute("/dashboard/grafik", {}).tab, "grafik");
  assert.equal(resolveRoute("/dashboard/roi", {}).tab, "roi");
  assert.equal(resolveRoute("/dashboard/rasio-penayangan", {}).tab, "rasio-penayangan");
  assert.equal(resolveRoute("/dashboard/entah", {}).kind, "missing");
});

/**
 * DUA sistem `key` berjalan berdampingan di dashboard ini, dan keduanya harus menyebut nama yang
 * sama untuk halaman yang sama:
 *
 *   navigation.js  -> menyaring baris sidebar dan tab (`sidebarItems(canRead)`)
 *   resolveRoute   -> menyalakan gerbang izin di App (`forbidden` hanya bertanya kalau ada `key`)
 *
 * Selama keduanya sepakat, halaman yang hilang dari sidebar juga tertutup bagi yang mengetik
 * alamatnya. Begitu salah satunya lupa menyebut key — dan Settings, Target, serta Overview memang
 * sempat begitu — yang menyaring tinggal sidebar: mengetatkan sebuah halaman akan menghilangkan
 * menunya sambil membiarkan halamannya terbuka, tanpa satu pun tanda di layar.
 */
test("tiap halaman di menu membawa key yang sama di route-nya", () => {
  for (const item of navItems) {
    const route = resolveRoute(item.path, resources);
    assert.equal(route.key, item.key, `${item.path} (${route.kind})`);
  }
});

// Halaman tambah/sunting mewarisi key induknya: yang tidak boleh membaca Target juga tidak boleh
// membuka formnya.
//
// Alamat sunting membawa TIGA hal, karena itulah yang mengunci satu baris target: domain, bulan,
// dan jenis akun. Satu domain punya dua baris tiap bulan (Adsense dan Ad-Exchanger), dan alamat
// tanpa jenisnya membuka salah satu dari keduanya tanpa cara memilih yang mana.
test("form target ikut membawa key induknya, berikut domain + bulan + jenisnya", () => {
  assert.equal(resolveRoute("/targets/new", {}).key, "targets");
  assert.deepEqual(resolveRoute("/targets/abc/2026-08/ad-exchanger/edit", {}), {
    kind: "targetForm",
    key: "targets",
    domainId: "abc",
    month: "2026-08",
    slug: "ad-exchanger",
  });

  // Alamat bentuk lama (tanpa jenis akun) tidak lagi membuka form yang menyunting entah baris yang
  // mana — dan menebak salah satunya berarti Simpan menulis ke baris yang tidak diminta siapa pun.
  assert.equal(resolveRoute("/targets/abc/2026-08/edit", {}).kind, "missing");
});

// Halaman ini terbuka untuk SEMUA role — tiap orang mengatur saklarnya sendiri di sana — jadi
// key-nya bukan penjaga hari ini. Ia tetap harus ada: dua sistem `key` berjalan berdampingan, dan
// halaman yang key-nya cuma disebut di navigation.js akan tetap terbuka bagi yang mengetik
// alamatnya pada hari ia diketatkan.
test("/notifications membawa key-nya sendiri, dan tab-nya dibaca dari alamat", () => {
  assert.deepEqual(resolveRoute("/notifications", {}), {
    kind: "notifications",
    key: "notifications",
    tab: "orang",
  });
  assert.equal(resolveRoute("/notifications/topik", {}).tab, "topik");
  assert.equal(resolveRoute("/notifications/peringatan", {}).tab, "peringatan");
  assert.equal(resolveRoute("/notifications/entah", {}).kind, "missing");
});

// Tab Calon Penerima adalah satu-satunya di halaman ini yang tidak boleh dibuka semua role: isinya
// nama profil orang luar yang menyapa bot publik kita. Kalau key-nya ikut jatuh ke "notifications",
// alamat yang diketik tangan membukanya bagi siapa saja — dan yang menyambut mereka bukan penolakan
// melainkan daftar kosong, karena langganan RTDB-nya memang cuma untuk admin.
test("/notifications/calon memakai key sendiri, bukan key induknya", () => {
  assert.deepEqual(resolveRoute("/notifications/calon", {}), {
    kind: "notifications",
    key: "telegramInbox",
    tab: "calon",
  });
});

// Halaman tambah/sunting mewarisi key induknya, sepola dengan form Target: yang tidak boleh membaca
// halamannya juga tidak boleh membuka formnya.
test("form kontak dan form orang membawa key induknya berikut id-nya", () => {
  assert.deepEqual(resolveRoute("/notifications/kontak/new", {}), {
    kind: "notificationContactForm",
    key: "notifications",
  });
  assert.deepEqual(resolveRoute("/notifications/kontak/abc/edit", {}), {
    kind: "notificationContactForm",
    key: "notifications",
    id: "abc",
  });
  assert.deepEqual(resolveRoute("/notifications/orang/u1/edit", {}), {
    kind: "notificationPersonForm",
    key: "notifications",
    id: "u1",
  });
});



// Whitelist Top-Up adalah TAB di bawah Ad Accounts, tapi alamatnya `/whitelist-topup` dan BUKAN
// `/ad-accounts/topup`. Yang kedua akan tertangkap lebih dulu oleh regex detail milik `adAccounts`
// (`^/ad-accounts/([^/]+)$`, dan `adAccounts` berdiri lebih awal di `resources`) — halamannya tidak
// akan pernah tergambar, dan yang muncul adalah halaman detail untuk ad account ber-id "topup" yang
// tidak ada. Aturan yang sama berlaku untuk tab mana pun yang ditambahkan ke halaman ini nanti.
test("tab Ad Accounts beralamat sendiri, dan tidak tertelan regex detail induknya", () => {
  assert.deepEqual(resolveRoute("/whitelist-topup", resources), {
    kind: "list",
    key: "whitelistTopup",
  });
  assert.deepEqual(resolveRoute("/whitelist-topup/new", resources), {
    kind: "form",
    key: "whitelistTopup",
  });
  assert.deepEqual(resolveRoute("/whitelist-topup/t1/edit", resources), {
    kind: "form",
    key: "whitelistTopup",
    id: "t1",
  });

  // `/ad-accounts/{id}` tetap halaman detail — yang tidak boleh ikut bergeser saat tab ditambah.
  assert.deepEqual(resolveRoute("/ad-accounts/abc", resources), {
    kind: "detail",
    key: "adAccounts",
    id: "abc",
  });
});

// `key` inilah yang membuat alamat yang diketik tangan ditolak untuk selain superadmin.
test("halaman Campaign membawa kunci aksesnya sendiri, dan dua tabnya satu key", () => {
  assert.deepEqual(resolveRoute("/campaigns", resources), {
    kind: "campaigns",
    key: "campaigns",
    tab: "daftar",
  });
  // Tab kedua ber-key SAMA: yang dibaca keduanya node yang sama, jadi tidak ada gerbang kedua untuk
  // dijaga — dan key yang berbeda di sini akan membuka salah satunya untuk yang bukan superadmin.
  assert.deepEqual(resolveRoute("/campaigns/pekerjaan", resources), {
    kind: "campaigns",
    key: "campaigns",
    tab: "pekerjaan",
  });
  // Alamat lain di bawahnya tetap "tidak ditemukan": tab dipetakan APA ADANYA, bukan lewat awalan.
  assert.deepEqual(resolveRoute("/campaigns/apa-saja", resources), { kind: "missing" });
});

// Sepola Campaign: dua tab, satu key — dan key itulah yang menutup generator untuk selain superadmin.
test("halaman Plugin punya empat tab ber-key sama", () => {
  assert.deepEqual(resolveRoute("/plugin", resources), { kind: "plugin", key: "plugin", tab: "daftar" });
  assert.deepEqual(resolveRoute("/plugin/adx", resources), { kind: "plugin", key: "plugin", tab: "adx" });
  assert.deepEqual(resolveRoute("/plugin/adsense", resources), {
    kind: "plugin",
    key: "plugin",
    tab: "adsense",
  });
  assert.deepEqual(resolveRoute("/plugin/cek", resources), { kind: "plugin", key: "plugin", tab: "cek" });
  // Alamat lama tab AdX tetap membuka halaman yang sama (main.jsx lalu menulis ulang alamatnya).
  assert.equal(resolveRoute("/plugin/inject-kode", resources).tab, "adx");
  assert.deepEqual(resolveRoute("/plugin/apa-saja", resources), { kind: "missing" });
});
