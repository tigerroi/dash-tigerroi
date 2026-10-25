import assert from "node:assert/strict";
import { test } from "node:test";
import { ACCOUNT_TYPES, AD_EXCHANGE, ADSENSE } from "./earningByAccountType.js";
import { invalidTrafficRows, invalidTrafficTotal } from "./invalidTraffic.js";

const store = {
  domains: [
    { domainUrl: "xiaomidriversdownload.com", companyPercent: 10 },
    { domainUrl: "petcins.com", companyPercent: 20 },
    // Tarif Company belum diisi — sengaja, itu keadaan yang diuji di bawah.
    { domainUrl: "dekadeko.com" },
  ],
  subDomains: [
    { name: "a.xiaomidriversdownload.com", parentDomain: "xiaomidriversdownload.com" },
    { name: "b.xiaomidriversdownload.com", parentDomain: "xiaomidriversdownload.com" },
    { name: "a.petcins.com", parentDomain: "petcins.com" },
  ],
  roiReports: [
    // Subdomain Ad Exchange: seluruh pendapatannya AdX, jadi seluruh belanjanya juga.
    {
      date: "2026-04-11",
      subDomain: "a.xiaomidriversdownload.com",
      earning: 26132371,
      totalSpending: 7743430,
      adxRevenue: 26132371,
      adsenseRevenue: 0,
      adServerRevenue: 0,
    },
    // Subdomain AdSense: adx/adServer nol, dan nol itu benar.
    {
      date: "2026-04-12",
      subDomain: "b.xiaomidriversdownload.com",
      earning: 13066501,
      totalSpending: 2805642,
      adxRevenue: 0,
      adsenseRevenue: 13066501,
      adServerRevenue: 0,
    },
  ],
};

const row = (extra) => invalidTrafficRows([{ id: "r", ...extra }], store)[0];

test("dua pilihan jenis akun, dan keduanya dipakai", () => {
  assert.deepEqual(ACCOUNT_TYPES, [ADSENSE, AD_EXCHANGE]);
});

test("total invalid traffic adalah jumlah ketiga Check", () => {
  assert.equal(invalidTrafficTotal({ check1: 59975, check2: 342 }), 60317);
  assert.equal(invalidTrafficTotal({ check1: 87457, check2: 71068, check3: 0 }), 158525);
});

test("baris lama tanpa Check mempertahankan nominal yang sudah tersimpan", () => {
  assert.equal(
    invalidTrafficTotal({ nominal: 24150 }),
    24150,
    "membuka form baris lama tidak boleh mengosongkan angkanya",
  );
  assert.equal(
    invalidTrafficTotal({ nominal: 24150, check1: 4300, check2: 19850 }),
    24150,
    "begitu Check-nya diisi, itulah yang berlaku",
  );
});

test("baris Ad Exchange: earning AdX, belanjanya, lalu invalid traffic", () => {
  const result = row({
    month: "2026-04",
    domain: "xiaomidriversdownload.com",
    accountType: AD_EXCHANGE,
    check1: 87457,
    check2: 71068,
  });

  assert.equal(result.earning, 26132371);
  assert.equal(result.totalSpending, 7743430);
  assert.equal(result.nominal, 158525);
  assert.equal(
    result.netProfit,
    26132371 - 7743430 - 158525,
    "earning − belanja − invalid traffic, TANPA potongan Company",
  );
  assert.equal(result.trafficPercent, "0.61%");
});

// Potongan Company sengaja tidak ikut halaman ini, tidak sebagai kolom maupun di dalam Net Profit:
// tarifnya punya tanggal berlaku, jadi sebulan bisa memuat dua tarif — dan halaman ini menghitung
// dari agregat sebulan. Lihat catatan di kepala invalidTraffic.js.
test("Potongan Company tidak ikut sama sekali, bahkan sebagai kolom", () => {
  const result = row({
    month: "2026-04",
    domain: "xiaomidriversdownload.com",
    accountType: AD_EXCHANGE,
    check1: 87457,
  });

  assert.equal(result.companyCut, undefined, "kolomnya tidak lagi diturunkan");
});

test("baris AdSense: earning dan belanja subdomain AdSense-nya saja", () => {
  const result = row({
    month: "2026-04",
    domain: "xiaomidriversdownload.com",
    accountType: ADSENSE,
    check1: 59975,
    check2: 342,
  });

  assert.equal(result.earning, 13066501, "hanya adsenseRevenue");
  assert.equal(result.totalSpending, 2805642, "belanja subdomain AdSense-nya saja");
  assert.equal(result.netProfit, 13066501 - 2805642 - 60317);
  assert.equal(result.trafficPercent, "0.46%");
});

// Tarif Company tidak lagi dibaca halaman ini sama sekali, jadi domain yang belum punya tarif
// tetap menghasilkan Net Profit yang penuh — berbeda dari sebelumnya, di mana ia mengosongkannya.
test("domain tanpa tarif Company tetap punya Net Profit", () => {
  const withRoi = {
    ...store,
    subDomains: [...store.subDomains, { name: "a.dekadeko.com", parentDomain: "dekadeko.com" }],
    roiReports: [
      ...store.roiReports,
      {
        date: "2026-04-11",
        subDomain: "a.dekadeko.com",
        earning: 1000,
        totalSpending: 100,
        adxRevenue: 1000,
        adsenseRevenue: 0,
        adServerRevenue: 0,
      },
    ],
  };
  const [result] = invalidTrafficRows(
    [{ month: "2026-04", domain: "dekadeko.com", accountType: AD_EXCHANGE, check1: 10 }],
    withRoi,
  );

  assert.equal(result.earning, 1000);
  assert.equal(result.netProfit, 1000 - 100 - 10);
});

test("bulan tanpa satu pun baris ROI: kolom otomatisnya kosong, bukan Rp 0", () => {
  const result = row({
    month: "2026-05",
    domain: "xiaomidriversdownload.com",
    accountType: AD_EXCHANGE,
    check1: 100,
  });

  assert.equal(result.earning, "");
  assert.equal(result.totalSpending, "");
  assert.equal(result.netProfit, "");
  assert.equal(result.trafficPercent, "", "tanpa pembagi tidak ada persen");
});

test("baris lama tanpa Jenis Akun menjumlahkan KEDUA sumber", () => {
  const result = row({
    date: "2026-04-01",
    domain: "xiaomidriversdownload.com",
    check1: 1000,
  });

  assert.equal(result.month, "2026-04", "bulannya dibaca dari `date` baris lama");
  assert.equal(result.accountType, "");
  assert.equal(result.earning, 26132371 + 13066501);
  assert.equal(result.totalSpending, 7743430 + 2805642);
});

test("baris ROI tanpa rincian sumber jatuh ke Ad Exchange, berikut belanjanya", () => {
  const legacy = {
    ...store,
    roiReports: [
      {
        date: "2026-06-01",
        subDomain: "a.petcins.com",
        earning: 500,
        totalSpending: 200,
      },
    ],
  };
  const [adx] = invalidTrafficRows(
    [{ month: "2026-06", domain: "petcins.com", accountType: AD_EXCHANGE }],
    legacy,
  );
  const [adsense] = invalidTrafficRows(
    [{ month: "2026-06", domain: "petcins.com", accountType: ADSENSE }],
    legacy,
  );

  assert.equal(adx.earning, 500);
  assert.equal(adx.totalSpending, 200);
  assert.equal(adsense.earning, 0, "dan nol di sini adalah nol yang diketahui");
  assert.equal(adsense.totalSpending, 0);
});

test("baris ROI yang earning-nya tidak diketahui dilewati berikut belanjanya", () => {
  const broken = {
    ...store,
    roiReports: [
      { date: "2026-07-01", subDomain: "a.petcins.com", earning: "", totalSpending: 900 },
    ],
  };
  const [result] = invalidTrafficRows(
    [{ month: "2026-07", domain: "petcins.com", accountType: AD_EXCHANGE }],
    broken,
  );

  assert.equal(result.earning, "", "tanpa earning tidak ada yang bisa menentukan sumbernya");
  assert.equal(result.totalSpending, "", "dan belanjanya tidak boleh jatuh ke sembarang kolom");
});

test("satu baris ROI bercampur dibagi sebanding, belanjanya ikut", () => {
  const mixed = {
    ...store,
    roiReports: [
      {
        date: "2026-08-01",
        subDomain: "a.petcins.com",
        earning: 1000,
        totalSpending: 400,
        adxRevenue: 600,
        adServerRevenue: 150,
        adsenseRevenue: 250,
      },
    ],
  };
  const [adx] = invalidTrafficRows(
    [{ month: "2026-08", domain: "petcins.com", accountType: AD_EXCHANGE }],
    mixed,
  );
  const [adsense] = invalidTrafficRows(
    [{ month: "2026-08", domain: "petcins.com", accountType: ADSENSE }],
    mixed,
  );

  assert.equal(adx.earning, 750, "AdX + Ad Server");
  assert.equal(adsense.earning, 250);
  assert.equal(adx.totalSpending, 300, "400 × 750/1000");
  assert.equal(adsense.totalSpending, 100);
});

test("subdomain yang belum terdaftar dicocokkan lewat akhiran nama domainnya", () => {
  const unregistered = {
    ...store,
    subDomains: [],
    roiReports: [
      {
        date: "2026-09-01",
        subDomain: "belum-terdaftar.petcins.com",
        earning: 100,
        totalSpending: 10,
        adxRevenue: 100,
        adsenseRevenue: 0,
        adServerRevenue: 0,
      },
    ],
  };
  const [result] = invalidTrafficRows(
    [{ month: "2026-09", domain: "petcins.com", accountType: AD_EXCHANGE }],
    unregistered,
  );
  assert.equal(result.earning, 100);
});

test("nomor urut kronologis dan berjenis akun tetap, bukan urutan input", () => {
  const rows = invalidTrafficRows(
    [
      { id: "c", month: "2026-07", domain: "petcins.com", accountType: AD_EXCHANGE },
      { id: "a", month: "2026-04", domain: "petcins.com", accountType: ADSENSE },
      { id: "b", month: "2026-04", domain: "petcins.com", accountType: AD_EXCHANGE },
    ],
    store,
  );

  assert.deepEqual(
    rows.map((entry) => [entry.id, entry.no]),
    [
      ["c", 3],
      ["a", 1],
      ["b", 2],
    ],
  );
});

// --- input manual: earning & belanja yang tidak terhandle API ---------------------------------

test("earning & belanja yang diketik dipakai saat bulan itu tidak punya baris ROI", () => {
  const result = row({
    month: "2026-05",
    domain: "xiaomidriversdownload.com",
    accountType: AD_EXCHANGE,
    earningManual: 78890471,
    totalSpendingManual: 21082102,
    check1: 485267,
    check2: 1627,
  });

  assert.equal(result.earning, 78890471);
  assert.equal(result.totalSpending, 21082102);
  assert.equal(result.nominal, 486894);
  assert.equal(result.netProfit, 78890471 - 21082102 - 486894);
  assert.equal(result.trafficPercent, "0.62%");
  assert.equal(result.dataSource, "Manual");
});

test("ketikan MENANG atas baris ROI yang ada — sync sebagian tidak boleh menghapusnya", () => {
  const result = row({
    month: "2026-04",
    domain: "xiaomidriversdownload.com",
    accountType: AD_EXCHANGE,
    earningManual: 99,
    totalSpendingManual: 11,
  });

  assert.equal(result.earning, 99, "bukan 26.132.371 dari baris ROI");
  assert.equal(result.totalSpending, 11);
});

test("mengosongkan kotaknya mengembalikan angka sync", () => {
  const result = row({
    month: "2026-04",
    domain: "xiaomidriversdownload.com",
    accountType: AD_EXCHANGE,
    earningManual: "",
    totalSpendingManual: "",
  });

  assert.equal(result.earning, 26132371);
  assert.equal(result.totalSpending, 7743430);
  assert.equal(result.dataSource, "API");
});

test("satu sisi diketik, sisi lain tetap dari sync — dan kolom Sumber menyebut yang mana", () => {
  const result = row({
    month: "2026-04",
    domain: "xiaomidriversdownload.com",
    accountType: AD_EXCHANGE,
    earningManual: 30000000,
  });

  assert.equal(result.earning, 30000000);
  assert.equal(result.totalSpending, 7743430, "belanjanya tetap dari baris ROI");
  assert.equal(result.dataSource, "Manual (earning)");

  const spendOnly = row({
    month: "2026-04",
    domain: "xiaomidriversdownload.com",
    accountType: AD_EXCHANGE,
    totalSpendingManual: 8000000,
  });
  assert.equal(spendOnly.dataSource, "Manual (spend)");
});

test("Net Profit butuh KEDUA sisi — bukan laba dari belanja nol yang dikarang", () => {
  const result = row({
    month: "2026-05",
    domain: "xiaomidriversdownload.com",
    accountType: AD_EXCHANGE,
    earningManual: 1000000,
    check1: 5000,
  });

  assert.equal(result.earning, 1000000);
  assert.equal(result.totalSpending, "", "tidak ada baris ROI, dan belanjanya tidak diketik");
  assert.equal(result.netProfit, "");
  assert.equal(result.trafficPercent, "0.50%", "persen invalid traffic cuma butuh earning");
});

test("nol yang DIKETIK adalah nol, bukan 'kosongkan lalu pakai sync'", () => {
  const result = row({
    month: "2026-04",
    domain: "xiaomidriversdownload.com",
    accountType: AD_EXCHANGE,
    earningManual: 0,
    totalSpendingManual: 0,
  });

  assert.equal(result.earning, 0);
  assert.equal(result.totalSpending, 0);
  assert.equal(result.dataSource, "Manual");
  assert.equal(result.trafficPercent, "", "tanpa pembagi tidak ada persen");
});

test("tanpa baris ROI dan tanpa ketikan, kolom Sumber diam", () => {
  const result = row({ month: "2026-05", domain: "xiaomidriversdownload.com", accountType: AD_EXCHANGE });

  assert.equal(result.earning, "");
  assert.equal(result.dataSource, "", "'API' di sini akan terbaca sebagai laporan yang menjawab nol");
});
