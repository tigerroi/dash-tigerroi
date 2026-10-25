import assert from "node:assert/strict";
import test from "node:test";
import { canOpenPage } from "./access.js";
import { activeNavPath, matchNavItem, navItems, pageTabs, sidebarItems } from "./navigation.js";

const allowAll = () => true;
// Sidebar dan tab menyaring lewat HALAMAN yang boleh dibuka (DashboardShell), bukan node yang boleh
// dibaca — keduanya sama untuk semua role kecuali tamu.
const canRead = (role) => (key) => canOpenPage(role, key);

test("tiap item punya path unik, dan tiap parent menunjuk item yang ada", () => {
  const paths = navItems.map((item) => item.path);
  assert.equal(new Set(paths).size, paths.length);

  for (const item of navItems) {
    if (!item.parent) continue;
    const parent = navItems.find((entry) => entry.path === item.parent);
    assert.ok(parent, `parent ${item.parent} tidak ada`);
    // Tab dari sebuah tab tidak dirender di mana pun — pageTabs hanya sedalam satu lapis.
    assert.equal(parent.parent, undefined);
  }
});

test("hanya item tanpa parent yang jadi baris sidebar, dan grup ikut induknya", () => {
  const rows = sidebarItems(allowAll);
  assert.equal(rows.length, 17);
  assert.ok(rows.every((item) => item.group));
  assert.ok(!rows.some((item) => item.path === "/sub-domains"));
});

test("halaman anak menyalakan baris induknya", () => {
  assert.equal(activeNavPath("/sub-domains"), "/domains");
  // Whitelist Top-Up dan Expenses berinduk ke Accounting: seluruh uang tim ini punya satu induk.
  assert.equal(activeNavPath("/whitelist-topup/new"), "/profit-loss");
  assert.equal(activeNavPath("/expenses/abc/edit"), "/profit-loss");
  assert.equal(activeNavPath("/google-api-configs"), "/settings");
  assert.equal(activeNavPath("/domains/abc/edit"), "/domains");
});

// `startsWith` telanjang menyalakan Domains untuk alamat yang cuma berawalan sama.
test("kecocokan alamat per segmen, bukan per awalan huruf", () => {
  assert.equal(activeNavPath("/domains-lama"), "");
  assert.equal(activeNavPath("/entah"), "");
});

test("tab memuat induk lebih dulu, dan disaring izin role", () => {
  assert.deepEqual(
    pageTabs("/profit-loss", allowAll).map((item) => item.path),
    [
      "/profit-loss",
      "/cash-flow",
      "/domain-profit",
      "/payouts",
      "/account-closes",
      "/invalid-traffic",
      "/adx-costs",
      "/company-percents",
      "/bonus-percents",
      "/expenses",
      "/whitelist-topup",
    ],
  );

  // Kesebelas tab Accounting berizin sama persis, jadi yang boleh membuka induknya melihat semuanya —
  // dan yang tidak boleh tidak melihat satu pun.
  assert.deepEqual(
    pageTabs("/profit-loss", canRead("keuangan")).map((item) => item.path),
    [
      "/profit-loss",
      "/cash-flow",
      "/domain-profit",
      "/payouts",
      "/account-closes",
      "/invalid-traffic",
      "/adx-costs",
      "/company-percents",
      "/bonus-percents",
      "/expenses",
      "/whitelist-topup",
    ],
  );
  assert.deepEqual(pageTabs("/profit-loss", canRead("advertiser")), []);

  // Tamu: tiga tab laporan, tanpa satu pun tab input — dan satu baris sidebar saja.
  assert.deepEqual(
    pageTabs("/profit-loss", canRead("guest")).map((item) => item.path),
    ["/profit-loss", "/cash-flow", "/domain-profit"],
  );
  assert.deepEqual(
    sidebarItems(canRead("guest")).map((item) => item.path),
    ["/profit-loss"],
  );

  // Ad Accounts tidak punya tab lagi sejak Top-Up pindah: satu tab bukan pilihan, ia cuma judul
  // kedua, jadi halamannya digambar tanpa kepala tab sama sekali.
  assert.deepEqual(pageTabs("/ad-accounts", allowAll), []);

  // Campaign: daftar armada dan Pekerjaan, dua pertanyaan yang tidak pernah ditanyakan bersamaan.
  // Keduanya superadmin — dan untuk role lain tidak satu pun tab yang digambar, karena induknya
  // sendiri tertutup.
  assert.deepEqual(
    pageTabs("/campaigns", canRead("superadmin")).map((item) => item.path),
    ["/campaigns", "/campaigns/pekerjaan"],
  );
  assert.deepEqual(pageTabs("/campaigns", canRead("admin")), []);
  // Tab kedua menyalakan dirinya sendiri, bukan induknya: `matchNavItem` memilih item TERDALAM, dan
  // alamat tab yang berada DI BAWAH alamat induknya adalah tempat aturan itu menentukan.
  assert.equal(matchNavItem("/campaigns/pekerjaan").path, "/campaigns/pekerjaan");
  assert.equal(activeNavPath("/campaigns/pekerjaan"), "/campaigns");

  // Plugin: daftar armada dan generator kode iklan. Superadmin saja, sepola Campaign.
  assert.deepEqual(
    pageTabs("/plugin/adsense", canRead("superadmin")).map((item) => item.path),
    [
      "/plugin",
      "/plugin/setup-sub",
      "/plugin/adx",
      "/plugin/adsense",
      "/plugin/cek",
      "/plugin/cloaking",
    ],
  );
  assert.deepEqual(pageTabs("/plugin", canRead("admin")), []);
  assert.equal(activeNavPath("/plugin/adx"), "/plugin");
  assert.equal(activeNavPath("/plugin/adsense"), "/plugin");
  assert.equal(activeNavPath("/plugin/cek"), "/plugin");
  assert.equal(activeNavPath("/plugin/setup-sub"), "/plugin");

  // Google API tertutup untuk selain admin; yang tersisa cuma Settings sendiri, dan satu tab
  // bukan pilihan.
  assert.deepEqual(pageTabs("/settings", canRead("user")), []);
  assert.deepEqual(
    pageTabs("/settings", canRead("admin")).map((item) => item.path),
    ["/settings", "/google-api-configs"],
  );
});

// Yang jadi tab tidak boleh lebih terbuka daripada induknya: induk yang tersembunyi berarti
// tab-nya tidak punya satu pun jalan menuju halamannya.
test("tiap tab dapat dicapai oleh role yang boleh membacanya", () => {
  for (const role of ["user", "advertiser", "keuangan", "guest", "admin", "superadmin"]) {
    for (const item of navItems) {
      if (!item.parent || !canOpenPage(role, item.key)) continue;
      assert.ok(
        pageTabs(item.path, canRead(role)).some((tab) => tab.path === item.path),
        `${item.path} tidak terjangkau oleh ${role}`,
      );
    }
  }
});

// Tab yang alamatnya berada DI BAWAH alamat induknya: `/dashboard` cocok sebagai awalan untuk
// keduanya, dan yang menyala harus tetap tab yang sedang dibuka. Ini yang dipakai PageTabs untuk
// menentukan tab aktif.
test("alamat tab yang bersarang di bawah induknya menyalakan tab itu, bukan induknya", () => {
  assert.equal(matchNavItem("/dashboard/roi").path, "/dashboard/roi");
  assert.equal(matchNavItem("/dashboard/grafik").path, "/dashboard/grafik");
  assert.equal(matchNavItem("/dashboard").path, "/dashboard");
  assert.equal(matchNavItem("/whitelist-topup/new").path, "/whitelist-topup");
});
