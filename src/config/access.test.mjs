import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  accessDeniedReason,
  ADMIN_ONLY_RESOURCES,
  canOpenPage,
  canReadResource,
  canGateCampaign,
  canManagePlugin,
  canToggleCampaign,
  canWrite,
  canEditCampaignCodes,
  canEditSettings,
  canWriteTargets,
  GUEST_PAGES,
  hasRole,
  homePath,
  isAdmin,
  isGuestOnly,
  isSuperAdmin,
  KEUANGAN_RESOURCES,
  parseRoles,
} from "./access.js";

describe("access", () => {
  test("role gabungan dibaca per-role, bukan sebagai satu string utuh", () => {
    assert.deepEqual(parseRoles("admin,keuangan"), ["admin", "keuangan"]);
    assert.equal(isAdmin("admin,keuangan"), true);
    assert.equal(isAdmin("keuangan,admin"), true);
    assert.equal(isAdmin("adminx"), false, "cocok sebagian bukan role");
    assert.equal(hasRole("user,advertiser", "advertiser"), true);
  });

  test("superadmin berlaku sebagai admin, berdiri sendiri tanpa role admin di sebelahnya", () => {
    // Akun yang rolenya hanya "superadmin" tidak boleh kehilangan apa pun: sebelum role ini ada,
    // nilai itu lolos .validate database tapi tidak berhak apa-apa — admin yang "dinaikkan" jadi
    // superadmin akan terkunci dari halamannya sendiri.
    assert.equal(isAdmin("superadmin"), true);
    assert.equal(isSuperAdmin("superadmin"), true);
    assert.equal(isSuperAdmin("admin"), false, "admin biasa bukan superadmin");
  });

  test("superadmin lolos SETIAP pemeriksaan izin, apa pun resource-nya", () => {
    // Termasuk kunci yang tidak dikenal siapa pun: yang diuji bukan "superadmin ada di daftar yang
    // benar", melainkan bahwa daftar itu tidak pernah ditanya. Sebuah resource yang ditambahkan
    // besok — dan sengaja tidak diberikan ke admin — tetap terbuka untuknya.
    for (const key of [...ADMIN_ONLY_RESOURCES, ...KEUANGAN_RESOURCES, "users", "resource-baru"]) {
      assert.equal(canReadResource("superadmin", key), true, `baca ${key}`);
      assert.equal(canWrite("superadmin", key), true, `tulis ${key}`);
    }
    assert.equal(canEditSettings("superadmin"), true);
    assert.equal(canWriteTargets("superadmin"), true);
    assert.equal(canEditCampaignCodes("superadmin"), true);
    // Campaign milik orang lain — yang untuk role lain dicocokkan lewat email.
    assert.equal(canToggleCampaign("superadmin", "orang@lain.com", "super@admin.com"), true);
  });

  test("koleksi rahasia hanya untuk admin", () => {
    for (const key of ["adsenseAccounts", "googleApiConfigs"]) {
      assert.equal(canReadResource("admin", key), true);
      assert.equal(canReadResource("user", key), false);
      assert.equal(canReadResource("keuangan", key), false);
      assert.equal(canReadResource("advertiser", key), false);
    }
  });

  test("koleksi keuangan hanya untuk keuangan dan admin", () => {
    for (const key of ["expenses", "whitelistTopup"]) {
      assert.equal(canReadResource("keuangan", key), true);
      assert.equal(canReadResource("user,keuangan", key), true);
      assert.equal(canReadResource("admin", key), true);
      assert.equal(canReadResource("user", key), false);
      assert.equal(canReadResource("advertiser", key), false);
    }
  });

  test("halaman Laba Rugi ikut tertutup seperti koleksi keuangan", () => {
    // Bukan preferensi tampilan. Laba bersihnya adalah pendapatan dikurangi pengeluaran, dan
    // store tidak pernah melanggan `expenses` untuk role yang tidak berhak membacanya — jadi
    // sebuah kebocoran di sini tidak menampilkan angka rahasia, ia menampilkan angka SALAH:
    // pendapatan dikurangi nol, tanpa satu pun tanda di layar.
    assert.equal(canReadResource("admin", "profitLoss"), true);
    assert.equal(canReadResource("keuangan", "profitLoss"), true);
    assert.equal(canReadResource("user,keuangan", "profitLoss"), true);
    assert.equal(canReadResource("user", "profitLoss"), false);
    assert.equal(canReadResource("advertiser", "profitLoss"), false);
    assert.equal(canReadResource("", "profitLoss"), false);
  });

  // Halaman Spending TIDAK ikut Laba Rugi ke admin+keuangan. Yang di sana laporan atas bulan yang
  // sudah lewat, dan Keuangan harus membukanya untuk bekerja; yang di sini rencana ke depan atas
  // ORANG — berapa dana yang akan diberikan kepada tiap advertiser, berdampingan dengan hasil tiap
  // rekannya. Admin ikut ditolak, dan itulah yang membedakan daftar ini dari KEUANGAN_PAGES.
  test("halaman Spending superadmin saja, admin dan keuangan pun ditolak", () => {
    assert.equal(canReadResource("superadmin", "spending"), true);
    assert.equal(canReadResource("admin", "spending"), false);
    assert.equal(canReadResource("keuangan", "spending"), false);
    assert.equal(canReadResource("admin,keuangan", "spending"), false);
    assert.equal(canReadResource("advertiser", "spending"), false);
    assert.equal(canReadResource("user", "spending"), false);
    assert.equal(canReadResource("", "spending"), false);
  });

  test("koleksi biasa terbuka untuk semua yang login", () => {
    for (const role of ["user", "advertiser", "keuangan", "admin"]) {
      assert.equal(canReadResource(role, "domains"), true);
      assert.equal(canReadResource(role, "subDomains"), true);
    }
  });

  test("reminder dibaca seluruh tim — badge jatuh tempo bukan milik satu role", () => {
    assert.equal(canReadResource("user", "reminders"), true);
    assert.equal(canReadResource("advertiser", "reminders"), true);
    assert.equal(canReadResource("keuangan", "reminders"), true);
    // Yang benar-benar rahasia tetap tertutup.
    assert.equal(canReadResource("user", "expenses"), false);
  });

  // Tamu: dua pertanyaan, dua jawaban. Yang DIBUKA cuma tiga laporan; yang DILANGGAN seluruh
  // bahannya — tanpa `expenses`/`companyPercents`/`invalidTraffic`, ketiga halaman itu melaporkan
  // laba tanpa satu pun potongan.
  test("tamu membuka tiga laporan Accounting saja, tapi melanggan seluruh bahannya", () => {
    for (const key of GUEST_PAGES) {
      assert.equal(canOpenPage("guest", key), true, `buka ${key}`);
    }
    for (const key of ["dashboard", "payouts", "expenses", "domains", "users", "settings", "notifications", "targets", "reminders"]) {
      assert.equal(canOpenPage("guest", key), false, `buka ${key}`);
    }
    for (const key of [...KEUANGAN_RESOURCES, "domains", "subDomains", "users"]) {
      assert.equal(canReadResource("guest", key), true, `langgan ${key}`);
      assert.equal(canWrite("guest", key), false, `tulis ${key}`);
    }
    for (const key of ADMIN_ONLY_RESOURCES) {
      assert.equal(canReadResource("guest", key), false, `langgan ${key}`);
    }
    assert.equal(canReadResource("guest", "spending"), false);
    assert.equal(canWriteTargets("guest"), false);
    assert.equal(canEditSettings("guest"), false);
    assert.equal(homePath("guest"), "/profit-loss");
    assert.match(accessDeniedReason("dashboard", "guest"), /Akun tamu/);
  });

  test("role tambahan di sebelah guest menambah hak, bukan menguncinya", () => {
    assert.equal(isGuestOnly("guest"), true);
    assert.equal(isGuestOnly("guest,keuangan"), false);
    assert.equal(isGuestOnly(""), false);
    assert.equal(canOpenPage("guest,keuangan", "payouts"), true);
    assert.equal(canOpenPage("guest,user", "dashboard"), true);
    assert.equal(homePath("guest,admin"), "/dashboard");
    // Untuk role lain, halaman yang boleh dibuka persis node yang boleh dibaca.
    for (const role of ["user", "advertiser", "keuangan", "admin", "superadmin"]) {
      for (const key of ["dashboard", "profitLoss", "payouts", "gamAccounts", "spending"]) {
        assert.equal(canOpenPage(role, key), canReadResource(role, key), `${role} ${key}`);
      }
      assert.equal(homePath(role), "/dashboard");
    }
  });

  test("pesan penolakan menyebut role yang benar-benar berhak", () => {
    assert.match(accessDeniedReason("profitLoss"), /admin dan keuangan/);
    assert.match(accessDeniedReason("expenses"), /admin dan keuangan/);
    assert.match(accessDeniedReason("adsenseAccounts"), /hanya untuk admin\./);
    // Tanpa baris ini, orang yang membuka /spending akan dibilang "hanya untuk admin" — dan yang
    // admin akan mencoba lagi, mengira ada yang rusak.
    assert.match(accessDeniedReason("spending"), /hanya untuk superadmin/);
  });

  test("saklar campaign: admin untuk siapa saja, selain itu hanya profil sendiri", () => {
    assert.equal(canToggleCampaign("admin", "budi@x.id", "admin@x.id"), true);
    assert.equal(canToggleCampaign("advertiser", "budi@x.id", "budi@x.id"), true);
    // Email dicocokkan tanpa peduli huruf besar/kecil dan spasi di ujung — begitulah orang
    // mengetikkannya saat baris user dibuat.
    assert.equal(canToggleCampaign("user", " Budi@X.id ", "budi@x.id"), true);
    assert.equal(canToggleCampaign("advertiser", "budi@x.id", "siti@x.id"), false);
    // Profil tanpa email tidak cocok dengan siapa pun — termasuk dengan penonton tanpa email.
    // Kalau tidak, satu baris user yang emailnya kosong bisa disentuh sembarang akun.
    assert.equal(canToggleCampaign("user", "", ""), false);
    assert.equal(canToggleCampaign("user", "", "budi@x.id"), false);
  });

  test("menulis tetap admin, kecuali keuangan pada koleksinya sendiri", () => {
    assert.equal(canWrite("admin", "domains"), true);
    assert.equal(canWrite("keuangan", "domains"), false);
    assert.equal(canWrite("keuangan", "expenses"), true);
    assert.equal(canWrite("keuangan", "whitelistTopup"), true);
    assert.equal(canWrite("keuangan", "reminders"), true);
    assert.equal(canWrite("user", "expenses"), false);
    // Reminder dibaca semua, ditulis tidak: badge di topbar untuk seluruh tim, tombol "tandai
    // selesai" tidak.
    assert.equal(canWrite("user", "reminders"), false);
    assert.equal(canWrite("advertiser", "reminders"), false);
    // Laba Rugi tidak punya tulisan sama sekali — ia menjumlahkan node lain.
    assert.equal(canWrite("keuangan", "profitLoss"), false);
  });

  test("gating cuma superadmin — admin ikut ditolak", () => {
    assert.equal(canGateCampaign("superadmin"), true);
    // Satu-satunya tempat superadmin dan admin benar-benar berbeda. Kalau ini pernah berubah jadi
    // `true`, seluruh maksud halaman itu hilang tanpa satu baris pun yang terlihat salah.
    assert.equal(canGateCampaign("admin"), false);
    assert.equal(canGateCampaign("advertiser"), false);
    assert.equal(canGateCampaign("user"), false);
    assert.equal(canGateCampaign(""), false);
    // Role gabungan tetap terbaca.
    assert.equal(canGateCampaign("user,superadmin"), true);

    // Halamannya ikut tertutup, bukan cuma tombolnya: menu di sidebar disaring lewat fungsi ini.
    assert.equal(canReadResource("superadmin", "gating"), true);
    assert.equal(canReadResource("admin", "gating"), false);
    assert.equal(canReadResource("keuangan", "gating"), false);
    assert.equal(canReadResource("user", "gating"), false);

    // Dan alasan penolakannya menyebut role yang benar — "hanya untuk admin" akan menyuruh seorang
    // admin mencoba lagi dengan hak yang sudah ia punya.
    assert.equal(accessDeniedReason("gating"), "Halaman ini hanya untuk superadmin.");
  });

  test("plugin cuma superadmin — admin ikut ditolak", () => {
    // Sepola dengan gating, dengan satu perbedaan yang menentukan siapa yang menegakkan apa:
    // gating punya antrean RTDB, jadi tombol yang lolos di layar tetap ditolak `.validate`. Halaman
    // /plugin tidak menulis antrean apa pun — yang menegakkannya gerbang `requireSuperAdmin` di
    // server/plugin.js, dan daftar ini cuma menjaga menu serta halamannya. Karena itu baris di bawah
    // adalah satu-satunya yang berbunyi kalau "plugin" pernah hilang dari SUPERADMIN_PAGES: aturan
    // database `pluginSites` sengaja ADMIN (SYNC_USER yang menulisnya adalah admin), jadi ia tidak
    // akan menolak siapa pun yang lolos dari sini.
    assert.equal(canManagePlugin("superadmin"), true);
    assert.equal(canManagePlugin("admin"), false);
    assert.equal(canManagePlugin("keuangan"), false);
    assert.equal(canManagePlugin("advertiser"), false);
    assert.equal(canManagePlugin("user"), false);
    assert.equal(canManagePlugin(""), false);
    // Role gabungan tetap terbaca.
    assert.equal(canManagePlugin("user,superadmin"), true);

    // Halamannya ikut tertutup, bukan cuma tombolnya: menu di sidebar disaring lewat fungsi ini.
    assert.equal(canReadResource("superadmin", "plugin"), true);
    assert.equal(canReadResource("admin", "plugin"), false);
    assert.equal(canReadResource("keuangan", "plugin"), false);
    assert.equal(canReadResource("user", "plugin"), false);

    assert.equal(accessDeniedReason("plugin"), "Halaman ini hanya untuk superadmin.");
  });

  test("halaman Campaign cuma superadmin — admin ikut ditolak", () => {
    // Yang menegakkannya gerbang `requireSuperAdmin` di server/campaign-manage.js; daftar ini menjaga
    // menu dan halamannya. Halaman itu menyalin campaign dan menaikkan anggaran iklan yang hidup.
    assert.equal(canReadResource("superadmin", "campaigns"), true);
    assert.equal(canReadResource("admin", "campaigns"), false);
    assert.equal(canReadResource("keuangan", "campaigns"), false);
    assert.equal(canReadResource("advertiser", "campaigns"), false);
    assert.equal(accessDeniedReason("campaigns"), "Halaman ini hanya untuk superadmin.");
  });

  test("activity logs cuma superadmin — admin ikut ditolak", () => {
    // Yang dijaga di sini bukan tombol: halaman itu tidak punya satu pun tombol yang mengubah data.
    // Yang dijaga adalah ISINYA — alamat IP, kota, dan perangkat setiap orang di tim berikut jam
    // berapa mereka membuka apa. Dibuka untuk admin, dashboard ini berubah jadi alat pengawasan
    // antar-rekan kerja tanpa satu baris pun yang terlihat salah.
    assert.equal(canReadResource("superadmin", "activityLogs"), true);
    assert.equal(canReadResource("admin", "activityLogs"), false);
    assert.equal(canReadResource("keuangan", "activityLogs"), false);
    assert.equal(canReadResource("advertiser", "activityLogs"), false);
    assert.equal(canReadResource("user", "activityLogs"), false);
    assert.equal(canReadResource("user,superadmin", "activityLogs"), true);

    assert.equal(accessDeniedReason("activityLogs"), "Halaman ini hanya untuk superadmin.");
  });
});
