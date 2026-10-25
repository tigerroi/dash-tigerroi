import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildCashFlow } from "./cashFlow.js";
import { monthRange } from "./dateRange.js";
import { expenseTotal } from "./operatingExpense.js";
import {
  buildProfitLoss,
  deltaOf,
  profitLossLines,
  profitLossMonths,
  topupFee,
} from "./profitLoss.js";

// Bulan PENUH sebagai rentang. `monthRange` memotong bulan BERJALAN di hari ini (lihat
// dateRange.js), jadi `now` yang jauh di depan dioper supaya hasilnya tidak bergantung pada jam
// mesin yang menjalankan tes — seluruh fixture di berkas ini bertanggal 2026.
const bulan = (key) => monthRange(key, new Date(2030, 0, 1));

// Pembulatan yang sama dengan modulnya, untuk assertion yang menyusun angkanya sendiri.
const round2 = (value) => Math.round(value * 100) / 100;

const financials = [
  // Agustus: dua hari terisi.
  { date: "2026-08-01", grossRevenue: 1000, totalSpend: 400, adTax: 20, totalSpending: 420 },
  { date: "2026-08-02", grossRevenue: 1500, totalSpend: 600, adTax: 30, totalSpending: 630 },
  // Juli, sebagai pembanding.
  { date: "2026-07-31", grossRevenue: 800, totalSpend: 500, adTax: 25, totalSpending: 525 },
];

const expenses = [
  { date: "2026-08-01", itemName: "Server", qty: 1, nominal: 300, total: 300 },
  { date: "2026-08-05", itemName: "Server", qty: 2, nominal: 100, total: 200 },
  { date: "2026-08-06", itemName: "Domain", qty: 1, nominal: 50, total: 50 },
  { date: "2026-07-02", itemName: "Server", qty: 1, nominal: 900, total: 900 },
];

const whitelistTopup = [
  { date: "2026-08-03", namaKode: "WL-A", nominal: 500000, feeTopup: 25000, total: 525000 },
  { date: "2026-07-03", namaKode: "WL-A", nominal: 200000, feeTopup: 10000, total: 210000 },
];

describe("profitLoss", () => {
  test("rantainya: laba kotor → net profit → net income owner", () => {
    const report = buildProfitLoss({
      financials,
      expenses,
      whitelistTopup,
      range: bulan("2026-08"),
      now: new Date(2026, 7, 10),
    });

    assert.equal(report.revenue, 2500, "1000 + 1500");
    assert.equal(report.adSpend, 1000, "400 + 600");
    assert.equal(report.adTax, 50, "20 + 30");
    assert.equal(report.totalAdSpend, 1050);
    assert.equal(report.grossProfit, 1450, "2500 − 1050");
    assert.equal(report.operatingExpenses, 550, "300 + 200 + 50");
    assert.equal(report.netProfit, 900, "1450 − 550, tanpa potongan lain");
    assert.equal(report.netIncomeOwner, 900, "tanpa bonus advertiser");
  });

  test("fee top-up tidak dikurangkan — rantainya tidak menghitungnya sebagai biaya", () => {
    const report = buildProfitLoss({
      financials,
      expenses,
      whitelistTopup,
      range: bulan("2026-08"),
      now: new Date(2026, 7, 10),
    });

    assert.equal(report.topupFees, 25000, "tetap dilaporkan sebagai catatan");
    assert.equal(report.netProfit, 900, "dan tetap di luar laba");
  });

  test("nominal top-up tidak ikut dikurangkan — ia sudah terhitung sebagai belanja iklan", () => {
    const report = buildProfitLoss({
      financials: [],
      expenses: [],
      whitelistTopup: [{ date: "2026-08-03", nominal: 500000, feeTopup: 25000, total: 525000 }],
      range: bulan("2026-08"),
      now: new Date(2026, 7, 10),
    });

    // Menjumlahkan nominalnya akan membuat laba 500.000 lebih kecil tanpa satu pun uang tambahan
    // yang benar-benar keluar.
    assert.equal(report.netProfit, 0);
    assert.equal(report.topupNominal, 500000, "tetap dilaporkan, untuk ditampilkan sebagai catatan");
  });

  test("marjin tanpa pendapatan itu null, bukan nol", () => {
    const kosong = buildProfitLoss({ range: bulan("2026-08"), now: new Date(2026, 7, 10) });
    assert.equal(kosong.revenue, 0);
    assert.equal(kosong.margin, null);

    const berisi = buildProfitLoss({
      financials: [{ date: "2026-08-01", grossRevenue: 1000, totalSpend: 0, totalSpending: 0 }],
      range: bulan("2026-08"),
      now: new Date(2026, 7, 10),
    });
    assert.equal(berisi.margin, 100, "marjinnya net income owner terhadap pendapatan");
  });

  test("baris lama tanpa kolom turunan tetap terhitung", () => {
    // Pengeluaran sebelum kolom Total dihitung form: hanya nominal dan qty.
    assert.equal(expenseTotal({ nominal: 150, qty: 3 }), 450);
    assert.equal(expenseTotal({ nominal: 150, qty: 3, total: 450 }), 450);
    // Total 0 yang sah tidak boleh jatuh ke perhitungan cadangan.
    assert.equal(expenseTotal({ nominal: 150, qty: 3, total: 0 }), 0);

    // Top-up sebelum kolom Fee ada: fee = total − nominal, tanpa perlu tahu tarifnya.
    assert.equal(topupFee({ nominal: 500000, total: 525000 }), 25000);
    assert.equal(topupFee({ nominal: 500000 }), 0, "tanpa fee maupun total");
  });

  test("pajak iklan dibaca dari tiap hari, bukan dihitung ulang dengan tarif hari ini", () => {
    // Dua hari dengan tarif berbeda (5% lalu 10%). Menghitung ulang seluruh bulan dengan satu
    // tarif akan menghasilkan angka ketiga yang tidak pernah benar untuk hari mana pun.
    const report = buildProfitLoss({
      financials: [
        { date: "2026-08-01", grossRevenue: 0, totalSpend: 1000, adTax: 50, totalSpending: 1050 },
        { date: "2026-08-02", grossRevenue: 0, totalSpend: 1000, adTax: 100, totalSpending: 1100 },
      ],
      range: bulan("2026-08"),
      now: new Date(2026, 7, 10),
    });
    assert.equal(report.adTax, 150);
    assert.equal(report.totalAdSpend, 2150);
  });

  test("titik lama tanpa totalSpending sama sekali tidak menghasilkan pajak negatif", () => {
    // Titik 6-9 Juli di RTDB: ditulis sebelum kedua kolom itu ada, hanya membawa totalSpend.
    // `totalSpending − totalSpend` di sana adalah `0 − spend`, dan baris Pajak Iklan-nya terbaca
    // minus — dua baris bertetangga yang tidak bisa dijumlahkan pembacanya.
    const report = buildProfitLoss({
      financials: [{ date: "2026-08-01", grossRevenue: 0, totalSpend: 851061 }],
      range: bulan("2026-08"),
      now: new Date(2026, 7, 10),
    });
    assert.equal(report.adTax, 0, "tidak diketahui menambah nol");
    assert.equal(report.totalAdSpend, 851061);
    assert.equal(report.adSpend + report.adTax, report.totalAdSpend, "ketiganya tetap berjumlah");
  });

  test("titik lama tanpa kolom adTax diturunkan dari selisihnya", () => {
    const report = buildProfitLoss({
      financials: [{ date: "2026-08-01", grossRevenue: 0, totalSpend: 1000, totalSpending: 1050 }],
      range: bulan("2026-08"),
      now: new Date(2026, 7, 10),
    });
    assert.equal(report.adTax, 50);
    assert.equal(report.totalAdSpend, 1050);
  });

  test("hari yang diharapkan berhenti di kemarin untuk bulan berjalan", () => {
    // 10 Agustus: sync baru melaporkan sampai 9 Agustus, jadi yang diharapkan 9 hari — bukan 31,
    // yang akan menyalakan peringatan 'belum lengkap' tiap hari sepanjang bulan.
    const berjalan = buildProfitLoss({ range: bulan("2026-08"), now: new Date(2026, 7, 10) });
    assert.equal(berjalan.daysExpected, 9);

    // Bulan yang sudah lewat diharapkan penuh.
    const lampau = buildProfitLoss({ range: bulan("2026-07"), now: new Date(2026, 7, 10) });
    assert.equal(lampau.daysExpected, 31);

    // Bulan yang belum datang tidak diharapkan punya apa-apa.
    const depan = buildProfitLoss({ range: bulan("2026-09"), now: new Date(2026, 7, 10) });
    assert.equal(depan.daysExpected, 0);
  });

  test("hari terisi dihitung dari titik yang benar-benar ada", () => {
    const report = buildProfitLoss({
      financials,
      range: bulan("2026-08"),
      now: new Date(2026, 7, 10),
    });
    assert.equal(report.daysWithData, 2);
    assert.equal(report.daysExpected, 9, "7 hari belum punya angka");
  });

  test("kedua penyusun Pengeluaran operasional berdiri di satu daftar, terurut besar dulu", () => {
    const report = buildProfitLoss({
      financials,
      expenses,
      adxCosts: [{ date: "2026-08-04", domain: "petcins.com", nominal: 400 }],
      range: bulan("2026-08"),
      now: new Date(2026, 7, 10),
    });

    assert.deepEqual(
      report.operatingExpenseBreakdown.map((row) => [row.label, row.total, row.source]),
      [
        ["Server", 500, "Expenses"],
        ["petcins.com", 400, "Cost Ad Exchange"],
        ["Domain", 50, "Expenses"],
      ],
      "diurut dari yang terbesar, lintas sumber — itu pertanyaan yang dibawa orang ke panel ini",
    );
    assert.equal(
      report.operatingExpenseBreakdown.reduce((total, row) => total + row.total, 0),
      report.operatingExpenses,
      "jumlahnya persis sebesar baris Pengeluaran operasional di rantai",
    );
  });

  test("dua baris bernama sama dari dua sumber tidak saling menimpa", () => {
    // "Domain" sebagai nama item Expenses dan "Domain" sebagai nama domain Cost Ad Exchange adalah
    // dua baris yang berbeda. Tanpa `key` yang membawa sumbernya, React menggambar salah satunya.
    const report = buildProfitLoss({
      financials,
      expenses: [{ date: "2026-08-06", itemName: "petcins.com", qty: 1, nominal: 50, total: 50 }],
      adxCosts: [{ date: "2026-08-04", domain: "petcins.com", nominal: 400 }],
      range: bulan("2026-08"),
      now: new Date(2026, 7, 10),
    });

    const keys = report.operatingExpenseBreakdown.map((row) => row.key);
    assert.equal(new Set(keys).size, 2, keys.join(" / "));
  });

  test("rincian dikelompokkan per nama dan diurutkan dari yang terbesar", () => {
    const report = buildProfitLoss({
      financials,
      expenses,
      whitelistTopup,
      range: bulan("2026-08"),
      now: new Date(2026, 7, 10),
    });
    assert.deepEqual(report.expenseBreakdown, [
      { label: "Server", total: 500 },
      { label: "Domain", total: 50 },
    ]);
    assert.deepEqual(report.topupBreakdown, [{ label: "WL-A", total: 25000 }]);
  });

  test("baris tanpa nama tidak hilang dari rincian", () => {
    const report = buildProfitLoss({
      expenses: [{ date: "2026-08-01", itemName: "", nominal: 70, qty: 1 }],
      range: bulan("2026-08"),
      now: new Date(2026, 7, 10),
    });
    assert.deepEqual(report.expenseBreakdown, [{ label: "(tanpa nama)", total: 70 }]);
    assert.equal(report.operatingExpenses, 70);
  });

  test("deltaOf: tumbuh dari nol tidak punya persen", () => {
    assert.deepEqual(deltaOf(150, 100), { delta: 50, percent: 50 });
    assert.deepEqual(deltaOf(50, 100), { delta: -50, percent: -50 });
    assert.deepEqual(deltaOf(100, 0), { delta: 100, percent: null });
    // Pembanding negatif: besarannya yang dipakai, supaya rugi yang mengecil tidak terbaca
    // sebagai penurunan.
    assert.deepEqual(deltaOf(-50, -100), { delta: 50, percent: 50 });
  });

  test("profitLossLines mengikuti urutan rantai, net income owner di ujung", () => {
    const report = buildProfitLoss({
      financials,
      expenses,
      whitelistTopup,
      range: bulan("2026-08"),
      now: new Date(2026, 7, 10),
    });
    const lines = profitLossLines(report);
    assert.equal(lines.at(-1).key, "netIncomeOwner");
    assert.equal(lines.at(-1).value, report.netIncomeOwner);
    // Tiap subtotal berdiri tepat setelah komponennya, supaya kolomnya bisa dibaca menurun tanpa
    // perlu menghitung sendiri.
    assert.deepEqual(
      lines.map((line) => line.key),
      [
        "revenue",
        "adSpend",
        "adTax",
        "totalAdSpend",
        "grossProfit",
        "companyDeduction",
        "invalidTraffic",
        "payoutCost",
        "operatingExpenses",
        "netProfit",
        "advertiserBonus",
        "netIncomeOwner",
      ],
    );
    // Arah uang tiap baris, yang menentukan warnanya di layar. Dipisah dari `kind` (tingkat baris
    // di tabel) karena keduanya tidak sejalan: "Total belanja iklan" subtotal yang KELUAR, "Laba
    // kotor" subtotal yang boleh MINUS.
    assert.deepEqual(
      lines.map((line) => line.flow),
      ["in", "out", "out", "out", "net", "out", "out", "out", "out", "net", "out", "net"],
    );
    assert.deepEqual(
      lines.filter((line) => line.flow === "net").map((line) => line.key),
      ["grossProfit", "netProfit", "netIncomeOwner"],
      "hanya yang boleh minus yang warnanya mengikuti tandanya",
    );

    // Fee top-up sengaja TIDAK punya baris di sini: ia tidak dikurangkan, dan sebuah baris di
    // tengah rantai yang tidak ikut dijumlah adalah cara paling cepat membuat kolomnya tidak bisa
    // dibaca menurun.
    assert.equal(
      lines.some((line) => line.key === "topupFees"),
      false,
    );
  });
});

// Potongan Company dan bonus advertiser: dua-duanya bertarif per pemilik, jadi keduanya dihitung
// dari baris ROI — satu-satunya tempat earning dan belanja punya nama domain dan PIC-nya.
describe("profitLoss: potongan per pemilik", () => {
  const domains = [{ domainUrl: "alpha.com" }, { domainUrl: "beta.com" }];
  // Tarif Potongan Company tinggal di koleksinya sendiri sejak ia punya tanggal berlaku. Keduanya
  // berlaku jauh sebelum bulan yang diuji, jadi seluruh Agustus memakai satu tarif.
  const companyPercents = [
    { domain: "alpha.com", percent: 20, effectiveFrom: "2026-01-01" },
    { domain: "beta.com", percent: 10, effectiveFrom: "2026-01-01" },
  ];
  const subDomains = [
    { name: "satu.alpha.com", parentDomain: "alpha.com", pic: "Nur" },
    { name: "dua.beta.com", parentDomain: "beta.com", pic: "Aca" },
  ];
  const users = [
    { name: "Nur", bonusPercent: 15 },
    { name: "Aca", bonusPercent: 10 },
  ];
  const roiReports = [
    { date: "2026-08-01", subDomain: "satu.alpha.com", pic: "Nur", earning: 1000000, totalSpending: 300000 },
    { date: "2026-08-01", subDomain: "dua.beta.com", pic: "Aca", earning: 500000, totalSpending: 100000 },
  ];
  const financialsBulan = [
    { date: "2026-08-01", grossRevenue: 1500000, totalSpend: 400000, adTax: 0, totalSpending: 400000 },
  ];
  const sumber = {
    financials: financialsBulan,
    expenses: [{ date: "2026-08-01", itemName: "Server", qty: 1, nominal: 50000, total: 50000 }],
    invalidTraffic: [{ date: "2026-08-01", domain: "alpha.com", nominal: 10000 }],
    roiReports,
    subDomains,
    domains,
    companyPercents,
    users,
    range: bulan("2026-08"),
    now: new Date(2026, 7, 10),
  };

  test("rantai penuhnya sama dengan yang dihitung tangan", () => {
    const report = buildProfitLoss(sumber);

    assert.equal(report.grossProfit, 1100000, "1.500.000 − 400.000");
    assert.equal(report.companyDeduction, 250000, "20% dari 1jt + 10% dari 500rb");
    assert.equal(report.invalidTraffic, 10000);
    assert.equal(report.netProfit, 790000, "1.100.000 − 250.000 − 10.000 − 50.000");
    // Beban Rp 50.000 dibagi menurut porsi earning — Nur 2/3 (33.333,33), Aca 1/3 (16.666,67) —
    // lalu bonus dihitung dari sisanya. Nur: (1jt − 300rb − 200rb − 10rb − 33.333,33) × 15%;
    // Aca: (500rb − 100rb − 50rb − 16.666,67) × 10%.
    assert.equal(report.bonusOperatingExpense, 50000);
    assert.equal(report.advertiserBonus, 101833.33);
    assert.equal(report.netIncomeOwner, 688166.67);
  });

  /**
   * Cost Ad Exchange menyatu dengan Expenses di baris Pengeluaran operasional — SATU baris di
   * rantai, satu kantong yang dibagi, satu panel rincian.
   *
   * Yang dijaga tes ini adalah bahwa keduanya diperlakukan sama: biaya penyambungan alpha.com
   * dibagi menurut porsi earning seperti sewa server, bukan dibebankan penuh ke PIC domain itu.
   * Konsekuensinya diketahui dan diterima — Aca ikut menanggung sebagian biaya link alpha.com —
   * dan itu harga dari satu aturan pembagian alih-alih dua. Dibagi per domain, `adxCosts` akan
   * punya pembaginya sendiri berikut sisa yang tidak terbagi, untuk baris rantai yang sama.
   */
  test("Cost Ad Exchange menyatu dengan Expenses, berikut cara membaginya", () => {
    const tanpa = buildProfitLoss(sumber);
    const dengan = buildProfitLoss({
      ...sumber,
      adxCosts: [{ date: "2026-08-15", domain: "alpha.com", nominal: 200000 }],
    });

    // Satu baris di layar, dua penyusun di belakangnya — dan keduanya berjumlah persis sebesar
    // baris itu, karena panel rinciannya diadu orang dengan angka di rantai.
    assert.equal(dengan.expenseCosts, 50000);
    assert.equal(dengan.adxCosts, 200000);
    assert.equal(dengan.operatingExpenses, 250000);
    assert.equal(dengan.expenseCosts + dengan.adxCosts, dengan.operatingExpenses);
    assert.equal(dengan.bonusOperatingExpense, 250000, "keduanya masuk dasar bonus, bukan salah satu");

    assert.equal(dengan.netProfit, tanpa.netProfit - 200000);
    // Rp 200.000 tambahan dibagi 2/3 : 1/3, jadi bonus turun 133.333,33 × 15% + 66.666,67 × 10%.
    assert.equal(dengan.advertiserBonus, 75166.67);
    assert.equal(
      dengan.netIncomeOwner,
      round2(tanpa.netIncomeOwner - 200000 + (tanpa.advertiserBonus - dengan.advertiserBonus)),
    );

    // Rinciannya per DOMAIN — pertanyaan yang dibawa orang saat baris ini naik adalah "domain mana
    // yang baru disambungkan", bukan "company mana yang dibayar".
    assert.deepEqual(dengan.adxCostBreakdown, [{ label: "alpha.com", total: 200000 }]);
  });

  // Bulan yang HANYA punya baris Cost Ad Exchange tetap bisa dibuka: pemilih bulan membaca
  // tiap sumber, dan bulan yang hilang dari daftar tidak bisa dipilih siapa pun.
  test("bulan yang cuma punya baris Cost Ad Exchange ikut di daftar bulan", () => {
    const months = profitLossMonths({
      adxCosts: [{ date: "2026-04-21", domain: "alpha.com", nominal: 1238073 }],
    });

    assert.deepEqual(months, ["2026-04"]);
  });

  test("baris ROI disaring bulan — rincian tiap bulan tidak boleh sama", () => {
    // Bug yang lolos seluruh test bermodal satu bulan, dan baru kelihatan dari data sungguhan:
    // rinciannya adalah SELURUH riwayat ROI di RTDB, jadi tiap bulan yang dibuka menampilkan
    // potongan dan bonus yang sama persis.
    const juli = { ...roiReports[0], date: "2026-07-15", earning: 9000000 };
    const report = buildProfitLoss({ ...sumber, roiReports: [...roiReports, juli] });

    assert.equal(report.coveredEarning, 1500000, "baris Juli tidak ikut ke laporan Agustus");
    assert.equal(report.companyDeduction, 250000);

    const bulanLalu = buildProfitLoss({ ...sumber, roiReports: [...roiReports, juli], range: bulan("2026-07") });
    assert.equal(bulanLalu.coveredEarning, 9000000, "dan Agustus tidak ikut ke laporan Juli");
  });

  test("tanpa beban sama sekali, dasar bonus kembali ke net profit barisnya", () => {
    const tanpaBeban = buildProfitLoss({ ...sumber, expenses: [] });
    assert.equal(tanpaBeban.bonusOperatingExpense, 0);
    assert.equal(tanpaBeban.advertiserBonus, 108500, "Nur 490rb × 15% + Aca 350rb × 10%");
    assert.equal(tanpaBeban.netProfit, 840000);
  });

  /**
   * Batas Juli 2026, dan ini tes yang menjaga uang yang sudah dibayarkan.
   *
   * April–Juni sudah dibayarkan atas dasar bonus TANPA pengeluaran operasional — blok bulan-bulan
   * itu di sheet acuannya juga masih memakai aturan lama. Aturan baru yang dibaca mundur menggeser
   * bonus bulan yang uangnya sudah pindah ke rekening orang, tanpa satu baris pun yang disunting
   * dan tanpa satu tanda pun di layar.
   */
  test("beban bertanggal sebelum Juli 2026 tidak menyentuh dasar bonus", () => {
    const juni = {
      ...sumber,
      expenses: [{ date: "2026-06-10", itemName: "Server", qty: 1, nominal: 50000, total: 50000 }],
      invalidTraffic: [{ date: "2026-06-01", domain: "alpha.com", nominal: 10000 }],
      roiReports: roiReports.map((row) => ({ ...row, date: "2026-06-01" })),
      financials: [
        { date: "2026-06-01", grossRevenue: 1500000, totalSpend: 400000, adTax: 0, totalSpending: 400000 },
      ],
      range: bulan("2026-06"),
      now: new Date(2026, 6, 10),
    };
    const report = buildProfitLoss(juni);

    assert.equal(report.operatingExpenses, 50000, "tetap dikurangkan penuh di rantai");
    assert.equal(report.bonusOperatingExpense, 0, "tapi tidak masuk dasar bonus siapa pun");
    assert.equal(report.advertiserBonus, 108500, "sama persis dengan sebelum aturan ini ada");
    assert.equal(report.netProfit, 790000);
    assert.equal(report.netIncomeOwner, 681500);
  });

  test("rentang yang menutup dua bulan hanya membebankan sisi Juli-nya", () => {
    const report = buildProfitLoss({
      ...sumber,
      expenses: [
        { date: "2026-06-10", itemName: "Server", qty: 1, nominal: 50000, total: 50000 },
        { date: "2026-07-10", itemName: "Server", qty: 1, nominal: 50000, total: 50000 },
      ],
      roiReports: roiReports.map((row) => ({ ...row, date: "2026-07-01" })),
      financials: [
        { date: "2026-07-01", grossRevenue: 1500000, totalSpend: 400000, adTax: 0, totalSpending: 400000 },
      ],
      invalidTraffic: [{ date: "2026-07-01", domain: "alpha.com", nominal: 10000 }],
      range: { from: "2026-06-01", to: "2026-07-31" },
      now: new Date(2026, 7, 10),
    });

    assert.equal(report.operatingExpenses, 100000, "kedua tagihan tetap keluar dari kantong");
    assert.equal(report.bonusOperatingExpense, 50000, "yang masuk dasar bonus cuma yang Juli");
  });

  test("rinciannya menyebut tarif tiap domain dan tiap PIC", () => {
    const report = buildProfitLoss(sumber);

    assert.deepEqual(report.companyBreakdown, [
      { label: "alpha.com", percents: [20], earning: 1000000, base: 1000000, total: 200000 },
      { label: "beta.com", percents: [10], earning: 500000, base: 500000, total: 50000 },
    ]);
    // Dasar tiap orang sudah dikurangi porsi biaya operasionalnya, dan porsi itu DISEBUT di baris
    // yang sama: dasar yang mengecil tanpa satu angka pun yang menerangkannya adalah persis yang
    // membuat orang berhenti mempercayai kolomnya.
    assert.deepEqual(report.bonusBreakdown, [
      { label: "Nur", percent: 15, base: 456666.67, operatingExpense: 33333.33, total: 68500 },
      { label: "Aca", percent: 10, base: 333333.33, operatingExpense: 16666.67, total: 33333.33 },
    ]);
  });

  test("domain tanpa tarif tidak dipotong 0% diam-diam — jumlahnya dilaporkan", () => {
    const report = buildProfitLoss({
      ...sumber,
      companyPercents: [{ domain: "beta.com", percent: 10, effectiveFrom: "2026-01-01" }],
    });

    assert.equal(report.companyDeduction, 50000, "hanya beta.com yang punya tarif");
    assert.equal(report.earningWithoutPercent, 1000000, "earning alpha.com, supaya kelihatan");
    const alpha = report.companyBreakdown.find((row) => row.label === "alpha.com");
    assert.deepEqual(alpha.percents, [], "bukan 0%");
    assert.equal(alpha.total, 0, "tidak dipotong, dan barisnya tetap ada supaya kelihatan");
  });

  test("tarif yang belum berlaku tidak menyentuh bulan sebelumnya", () => {
    const report = buildProfitLoss({
      ...sumber,
      companyPercents: [{ domain: "alpha.com", percent: 20, effectiveFrom: "2026-09-01" }],
    });

    assert.equal(report.companyDeduction, 0, "Agustus belum kena tarif yang berlaku September");
    assert.equal(
      report.earningWithoutPercent,
      1500000,
      "seluruh earning dilaporkan belum punya tarif, bukan diam-diam terpotong",
    );
  });

  test("tarif yang berganti di tengah bulan dipakai PER HARI, bukan satu untuk sebulan", () => {
    const report = buildProfitLoss({
      ...sumber,
      roiReports: [
        { date: "2026-08-01", subDomain: "satu.alpha.com", pic: "Nur", earning: 1000000, totalSpending: 300000 },
        { date: "2026-08-20", subDomain: "satu.alpha.com", pic: "Nur", earning: 1000000, totalSpending: 300000 },
      ],
      companyPercents: [
        { domain: "alpha.com", percent: 10, effectiveFrom: "2026-01-01" },
        { domain: "alpha.com", percent: 20, effectiveFrom: "2026-08-15" },
      ],
    });

    assert.equal(
      report.companyDeduction,
      300000,
      "1 Agu 10% (100.000) + 20 Agu 20% (200.000), bukan sebulan dengan salah satunya",
    );
    const alpha = report.companyBreakdown.find((row) => row.label === "alpha.com");
    assert.deepEqual(alpha.percents, [10, 20], "kedua tarif disebut, tidak dipilih salah satu");
  });

  test("PIC tanpa tarif bonus tidak dihitungi bonus, tapi tetap muncul", () => {
    const report = buildProfitLoss({ ...sumber, users: [{ name: "Nur", bonusPercent: 15 }] });

    assert.equal(report.advertiserBonus, 68500, "Aca tidak punya tarif");
    const aca = report.bonusBreakdown.find((row) => row.label === "Aca");
    assert.equal(aca.percent, null);
    assert.equal(aca.total, 0);
    assert.equal(
      aca.base,
      333333.33,
      "dasarnya tetap dihitung, berikut porsi bebannya, supaya tarifnya bisa diisi belakangan",
    );
  });

  test("tidak ada bonus dari kerugian", () => {
    const report = buildProfitLoss({
      ...sumber,
      roiReports: [
        {
          date: "2026-08-01",
          subDomain: "satu.alpha.com",
          pic: "Nur",
          earning: 100000,
          totalSpending: 900000,
        },
      ],
    });

    const nur = report.bonusBreakdown.find((row) => row.label === "Nur");
    assert.ok(nur.base < 0, "dasarnya minus");
    assert.equal(nur.total, 0, "bukan bonus negatif");
    assert.equal(report.advertiserBonus, 0);
  });

  test("invalid traffic satu domain dibagi menurut porsi earning tiap PIC di domain itu", () => {
    const report = buildProfitLoss({
      ...sumber,
      // Tanpa beban: yang diuji di sini pembagian invalid traffic, dan porsi biaya operasional
      // yang ikut mengurangi dasar cuma mengaburkan angka yang sedang diadu.
      expenses: [],
      subDomains: [
        ...subDomains,
        { name: "tiga.alpha.com", parentDomain: "alpha.com", pic: "Aca" },
      ],
      roiReports: [
        ...roiReports,
        {
          date: "2026-08-01",
          subDomain: "tiga.alpha.com",
          pic: "Aca",
          earning: 1000000,
          totalSpending: 0,
        },
      ],
      invalidTraffic: [{ date: "2026-08-01", domain: "alpha.com", nominal: 20000 }],
    });

    // alpha.com: Nur 1jt, Aca 1jt → 10.000 masing-masing.
    const nur = report.bonusBreakdown.find((row) => row.label === "Nur");
    assert.equal(nur.base, 1000000 - 300000 - 200000 - 10000);
    const aca = report.bonusBreakdown.find((row) => row.label === "Aca");
    // Aca: earning 1,5jt (1jt alpha + 500rb beta), spend 100rb, company 200rb + 50rb, IT 10rb.
    assert.equal(aca.base, 1500000 - 100000 - 250000 - 10000);
  });

  test("baris tanpa PIC tetap ikut menanggung invalid traffic domainnya", () => {
    // Dua peta yang dulu memakai kunci berbeda untuk ember yang sama ("(tanpa pic)" vs string
    // kosong): jatah invalid traffic baris tanpa PIC hilang diam-diam, dan dasar bonusnya terbaca
    // lebih besar daripada yang sebenarnya.
    const report = buildProfitLoss({
      ...sumber,
      expenses: [],
      roiReports: [
        // Subdomain yang belum terdaftar: tidak ada baris subDomains yang bisa menyebut PIC-nya.
        { date: "2026-08-01", subDomain: "baru.alpha.com", earning: 1000000, totalSpending: 0 },
      ],
      invalidTraffic: [{ date: "2026-08-01", domain: "alpha.com", nominal: 40000 }],
    });

    const tanpa = report.bonusBreakdown.find((row) => row.label === "(tanpa PIC)");
    assert.equal(tanpa.base, 1000000 - 200000 - 40000, "seluruh invalid traffic domain itu");
  });

  test("earning yang laporannya gagal tidak dianggap nol, dan selisihnya dilaporkan", () => {
    const report = buildProfitLoss({
      ...sumber,
      roiReports: [
        ...roiReports,
        { date: "2026-08-01", subDomain: "satu.alpha.com", pic: "Nur", earning: "" },
      ],
    });

    assert.equal(report.coveredEarning, 1500000, "baris tanpa earning dilewati");
    assert.equal(report.coverageGap, 0, "totalnya tetap dari weeklyFinancials");
  });

  test("pendapatan yang tidak punya baris ROI kelihatan sebagai selisih", () => {
    const report = buildProfitLoss({ ...sumber, roiReports: [roiReports[0]] });

    assert.equal(report.coveredEarning, 1000000);
    assert.equal(report.coverageGap, 500000, "500rb tidak dipotong Company maupun dibonuskan");
    assert.equal(report.companyDeduction, 200000);
  });

  test("potongan Company hanya kena pendapatan Ad Exchange, bukan AdSense", () => {
    // Pada Juli, memotong seluruh earning stylefemale.com dengan 10% menghasilkan Rp102.038 lebih
    // banyak daripada yang benar-benar dipotong — persis 10% dari pendapatan AdSense-nya.
    const report = buildProfitLoss({
      ...sumber,
      roiReports: [
        {
          date: "2026-08-01",
          subDomain: "satu.alpha.com",
          pic: "Nur",
          earning: 1000000,
          adxRevenue: 800000,
          adServerRevenue: 0,
          adsenseRevenue: 200000,
          totalSpending: 300000,
        },
      ],
    });

    const alpha = report.companyBreakdown.find((row) => row.label === "alpha.com");
    assert.equal(alpha.earning, 1000000);
    assert.equal(alpha.base, 800000, "AdSense-nya tidak lewat Ad Exchange");
    assert.equal(alpha.total, 160000, "20% dari 800rb, bukan dari 1jt");
  });

  test("baris tanpa rincian sumber dipotong dari earning penuh", () => {
    // Baris yang ditulis sebelum earning dipecah per sumber permintaan. Kelima network hari ini
    // seluruh pendapatannya Ad Exchange, jadi ini jawaban yang benar untuk hampir semua baris.
    const report = buildProfitLoss(sumber);
    const alpha = report.companyBreakdown.find((row) => row.label === "alpha.com");
    assert.equal(alpha.base, 1000000);
    assert.equal(alpha.total, 200000);
  });

  test("subdomain yang belum terdaftar dicocokkan lewat akhiran domainnya", () => {
    // Tanpa ini, situs GAM yang belum masuk /sub-domains kehilangan potongan Company-nya diam-diam.
    const report = buildProfitLoss({
      ...sumber,
      subDomains: [],
      roiReports: [
        { date: "2026-08-01", subDomain: "baru.alpha.com", pic: "Nur", earning: 1000000 },
      ],
    });

    assert.equal(report.companyDeduction, 200000);
    assert.equal(report.companyBreakdown[0].label, "alpha.com");
  });
});

/**
 * Empat aturan yang dulu ditulis ulang di profitLoss.js dan sudah berbeda perilaku dari salinan
 * aslinya. Yang diuji di sini bukan rumusnya (itu urusan modul masing-masing) melainkan bahwa
 * halaman ini MEMAKAI modul itu — satu-satunya cara dua tab bersebelahan berhenti menyebut dua
 * angka untuk uang yang sama.
 */
describe("profitLoss: memakai aturan yang sama dengan halaman sebelahnya", () => {
  const dasar = {
    domains: [{ domainUrl: "alpha.com" }],
    subDomains: [{ name: "satu.alpha.com", parentDomain: "alpha.com", pic: "Nur" }],
    users: [{ name: "Nur", bonusPercent: 10 }],
    companyPercents: [{ domain: "alpha.com", percent: 10, effectiveFrom: "2026-01-01" }],
    roiReports: [
      {
        date: "2026-08-01",
        subDomain: "satu.alpha.com",
        pic: "Nur",
        earning: 1000000,
        totalSpending: 200000,
      },
    ],
    financials: [
      { date: "2026-08-01", grossRevenue: 1000000, totalSpend: 200000, adTax: 0, totalSpending: 200000 },
    ],
    range: bulan("2026-08"),
    now: new Date(2026, 7, 10),
  };

  test("nominal invalid traffic dibaca dari Check-nya, bukan dari kolom turunan `nominal`", () => {
    // `nominal` ditulis form sebagai kolom turunan. Baris yang punya Check tapi belum sempat
    // menuliskannya berbunyi Rp 0 di sini dan angka penuh di tab Invalid Traffic sebelahnya.
    const report = buildProfitLoss({
      ...dasar,
      invalidTraffic: [
        { month: "2026-08", date: "2026-08-01", domain: "alpha.com", check1: 30000, check2: 20000 },
      ],
    });

    assert.equal(report.invalidTraffic, 50000);
    assert.equal(report.invalidTrafficBreakdown[0].total, 50000);
  });

  test("bulan invalid traffic dibaca dari kolom `month`, bukan cuma dari `date`", () => {
    const report = buildProfitLoss({
      ...dasar,
      invalidTraffic: [{ month: "2026-08", domain: "alpha.com", nominal: 40000 }],
    });

    assert.equal(report.invalidTraffic, 40000, "baris tanpa `date` tidak boleh hilang");
  });

  test("invalid traffic bertanda Adsense tidak membebani sisi Ad Exchange domain yang sama", () => {
    // Barisnya berdiri per (bulan, domain, JENIS AKUN) karena begitulah pengecekannya dilakukan.
    // Diabaikan, clawback atas pendapatan AdSense mengurangi dasar bonus advertiser Ad Exchange.
    const report = buildProfitLoss({
      ...dasar,
      invalidTraffic: [
        { month: "2026-08", domain: "alpha.com", accountType: "Adsense", nominal: 40000 },
      ],
    });

    const nur = report.bonusBreakdown.find((row) => row.label === "Nur");
    assert.equal(nur.base, 1000000 - 200000 - 100000, "seluruh earning-nya Ad Exchange");
    assert.equal(report.invalidTraffic, 40000, "totalnya tetap dikurangkan dari laba");
  });

  test("baris AdSense murni tanpa kolom adxRevenue tidak dipotong Company", () => {
    // `hasBreakdown` versi lama hanya memeriksa adxRevenue/adServerRevenue, jadi baris yang cuma
    // membawa adsenseRevenue jatuh utuh ke Ad Exchange — dipotong penuh di sini dan nol di
    // halaman sebelahnya.
    const report = buildProfitLoss({
      ...dasar,
      roiReports: [
        {
          date: "2026-08-01",
          subDomain: "satu.alpha.com",
          pic: "Nur",
          earning: 1000000,
          adsenseRevenue: 1000000,
          totalSpending: 200000,
        },
      ],
    });

    assert.equal(report.companyDeduction, 0);
    assert.equal(report.earningWithoutPercent, 0, "bukan tarif yang belum diisi — memang nol");
  });
});

/**
 * Dua sumber di rantai ini berdiri per BULAN dan tidak bisa dibelah per hari: nominal invalid
 * traffic dan earning akun yang ditutup. Rentang yang memotong sebuah bulan di tengah tidak punya
 * cara membaginya — jadi bulan itu tidak ikut, dan namanya disebutkan.
 */
describe("profitLoss: rentang yang memotong bulan", () => {
  const dasar = {
    domains: [{ domainUrl: "alpha.com" }],
    subDomains: [{ name: "satu.alpha.com", parentDomain: "alpha.com", pic: "Nur" }],
    users: [{ name: "Nur", bonusPercent: 10 }],
    companyPercents: [],
    roiReports: [],
    financials: [
      { date: "2026-08-05", grossRevenue: 1000000, totalSpend: 0, adTax: 0, totalSpending: 0 },
      { date: "2026-08-25", grossRevenue: 500000, totalSpend: 0, adTax: 0, totalSpending: 0 },
    ],
    invalidTraffic: [{ month: "2026-08", domain: "alpha.com", nominal: 40000 }],
    now: new Date(2026, 8, 10),
  };

  test("bulan yang tertutup PENUH memuat nominal bulanannya", () => {
    const report = buildProfitLoss({ ...dasar, range: bulan("2026-08") });

    assert.equal(report.invalidTraffic, 40000);
    assert.deepEqual(report.partialMonths, [], "tidak ada yang ketinggalan untuk disebutkan");
  });

  test("bulan yang cuma terpotong sebagian TIDAK ikut, dan namanya disebutkan", () => {
    // Sebuah rentang 10 hari yang menanggung invalid traffic sebulan penuh berbunyi rugi karena
    // rentangnya, bukan karena usahanya. Yang tidak ikut disebutkan supaya potongan yang hilang
    // tidak terbaca sebagai laba yang lebih besar.
    const report = buildProfitLoss({
      ...dasar,
      range: { from: "2026-08-01", to: "2026-08-10" },
    });

    assert.equal(report.invalidTraffic, 0);
    assert.deepEqual(report.partialMonths, ["2026-08"]);
    assert.equal(report.revenue, 1000000, "pendapatan hariannya tetap disaring per hari");
  });

  test("bulan tanpa baris bulanan sama sekali tidak ikut disebut", () => {
    // Peringatan yang menyala tiap hari untuk keadaan yang normal berhenti dibaca dalam sepekan.
    const report = buildProfitLoss({
      ...dasar,
      invalidTraffic: [],
      range: { from: "2026-08-01", to: "2026-08-10" },
    });

    assert.deepEqual(report.partialMonths, []);
  });

  test("rentang lintas bulan memuat yang utuh saja", () => {
    const report = buildProfitLoss({
      ...dasar,
      invalidTraffic: [
        { month: "2026-07", domain: "alpha.com", nominal: 10000 },
        { month: "2026-08", domain: "alpha.com", nominal: 40000 },
      ],
      range: { from: "2026-07-01", to: "2026-08-20" },
    });

    assert.equal(report.invalidTraffic, 10000, "Juli utuh, Agustus terpotong");
    assert.deepEqual(report.partialMonths, ["2026-08"]);
  });

  test("baris tanpa tanggal terbaca tidak ikut periode mana pun", () => {
    // Dibuang, bukan diloloskan seperti `filterByDateField`: di sana ia satu baris tabel yang hilang
    // dari pandangan, di sini ia uang yang ikut dijumlah ke periode ini DAN ke pembandingnya.
    const report = buildProfitLoss({
      ...dasar,
      expenses: [{ date: "", itemName: "Server", qty: 1, nominal: 999, total: 999 }],
      range: bulan("2026-08"),
    });

    assert.equal(report.operatingExpenses, 0);
  });
});

/**
 * Earning akun yang ditutup Google — satu-satunya angka earning yang diketik orang, dan satu-satunya
 * yang tidak ada di `weeklyFinancials` MAUPUN `roiReports`.
 */
describe("profitLoss: akun yang ditutup Google", () => {
  const dasar = {
    domains: [{ domainUrl: "tutup.com" }],
    subDomains: [],
    users: [{ name: "Nur", bonusPercent: 10 }],
    companyPercents: [{ domain: "tutup.com", percent: 10, effectiveFrom: "2026-01-01" }],
    roiReports: [],
    financials: [
      { date: "2026-05-10", grossRevenue: 0, totalSpend: 0, adTax: 0, totalSpending: 0 },
    ],
    accountCloses: [
      {
        month: "2026-05",
        pic: "Nur",
        accountType: "Ad-Exchanger",
        subDomain: "flash.tutup.com",
        earning: 20000000,
        totalSpending: 3000000,
      },
    ],
    range: bulan("2026-05"),
    now: new Date(2026, 5, 10),
  };

  test("earning dan belanjanya masuk rantai, dan Total belanja tetap = Belanja + Pajak", () => {
    const report = buildProfitLoss(dasar);

    assert.equal(report.revenue, 20000000, "tidak ada di weeklyFinancials, tapi uangnya nyata");
    assert.equal(report.adSpend, 3000000, "yang diketik sudah termasuk pajaknya");
    assert.equal(report.adTax, 0);
    assert.equal(report.totalAdSpend, 3000000, "kolomnya masih bisa dibaca menurun");
    assert.equal(report.grossProfit, 17000000);
  });

  test("ikut dipotong Company dan ikut jadi dasar bonus PIC-nya", () => {
    const report = buildProfitLoss(dasar);

    assert.equal(report.companyDeduction, 2000000, "10% dari 20jt");
    const nur = report.bonusBreakdown.find((row) => row.label === "Nur");
    assert.equal(nur.base, 20000000 - 3000000 - 2000000);
    assert.equal(report.advertiserBonus, 1500000);
  });

  test("selisihnya tidak menyamar jadi coverageGap — kedua sisi memuatnya", () => {
    const report = buildProfitLoss(dasar);

    assert.equal(report.coveredEarning, 20000000);
    assert.equal(report.coverageGap, 0);
    assert.equal(report.accountCloseEarning, 20000000, "disebutkan sendiri, karena ia diketik");
    assert.equal(report.accountCloseBreakdown[0].label, "flash.tutup.com");
  });

  test("baris ROI SELALU menang — laporan yang masih datang mengalahkan ketikannya", () => {
    const report = buildProfitLoss({
      ...dasar,
      roiReports: [
        {
          date: "2026-05-10",
          subDomain: "flash.tutup.com",
          pic: "Nur",
          earning: 5000000,
          totalSpending: 1000000,
        },
      ],
      financials: [
        { date: "2026-05-10", grossRevenue: 5000000, totalSpend: 1000000, adTax: 0, totalSpending: 1000000 },
      ],
    });

    assert.equal(report.accountCloseEarning, 0, "angka ketikannya diabaikan tanpa suara");
    assert.equal(report.revenue, 5000000);
    assert.equal(report.companyDeduction, 500000);
  });

  test("bulannya ikut di daftar bulan, walau tidak ada sumber lain yang menyebutkannya", () => {
    assert.equal(profitLossMonths({ accountCloses: dasar.accountCloses })[0], "2026-05");
  });
});

/**
 * Potongan Company dan bonus advertiser dihitung DUA KALI di dashboard ini: sekali sebagai satu
 * angka di sini, sekali dipecah per subdomain di tab Cash Flow. Keduanya tab bersebelahan di kepala
 * halaman yang sama, jadi angkanya wajib sama persis — dan sampai tes ini ada, tidak ada apa pun
 * yang menjaganya. Keduanya sempat berselisih di dua tempat sekaligus: `accountCloses` yang cuma
 * dibaca salah satunya, dan pembagian invalid traffic yang mengabaikan Jenis Akun.
 */
describe("profitLoss ≡ cashFlow", () => {
  const store = {
    domains: [{ domainUrl: "alpha.com" }, { domainUrl: "beta.com" }],
    subDomains: [
      { name: "satu.alpha.com", parentDomain: "alpha.com", pic: "Nur" },
      { name: "dua.alpha.com", parentDomain: "alpha.com", pic: "Aca" },
      { name: "tiga.beta.com", parentDomain: "beta.com", pic: "Nur" },
    ],
    users: [
      { name: "Nur", bonusPercent: 15 },
      { name: "Aca", bonusPercent: 10 },
    ],
    // Tarif bonus bertanggal: kedua modul harus membaca 20% untuk Nur di Agustus, bukan 15%.
    bonusPercents: [{ user: "Nur", percent: 20, effectiveFrom: "2026-08-01" }],
    companyPercents: [
      { domain: "alpha.com", percent: 10, effectiveFrom: "2026-01-01" },
      // Tarif yang berganti di tengah bulan: kedua modul harus sama-sama menghitungnya per HARI.
      { domain: "alpha.com", percent: 20, effectiveFrom: "2026-08-15" },
      { domain: "beta.com", percent: 5, effectiveFrom: "2026-01-01" },
    ],
    roiReports: [
      {
        date: "2026-08-01",
        subDomain: "satu.alpha.com",
        pic: "Nur",
        earning: 1000000,
        totalSpending: 300000,
        adxRevenue: 800000,
        adServerRevenue: 0,
        adsenseRevenue: 200000,
      },
      {
        date: "2026-08-20",
        subDomain: "dua.alpha.com",
        pic: "Aca",
        earning: 500000,
        totalSpending: 100000,
      },
      {
        date: "2026-08-20",
        subDomain: "tiga.beta.com",
        pic: "Nur",
        earning: 800000,
        totalSpending: 200000,
      },
      // Laporan yang gagal datang: dilewati berikut belanjanya, di kedua modul.
      { date: "2026-08-21", subDomain: "satu.alpha.com", pic: "Nur", earning: "" },
    ],
    invalidTraffic: [
      { month: "2026-08", domain: "alpha.com", accountType: "Ad-Exchanger", check1: 40000 },
      { month: "2026-08", domain: "alpha.com", accountType: "Adsense", check1: 10000 },
      // Baris bentuk lama, tanpa jenis akun: dibagi ke kedua sisi domainnya.
      { month: "2026-08", domain: "beta.com", nominal: 20000 },
    ],
    accountCloses: [
      {
        month: "2026-08",
        pic: "Aca",
        accountType: "Ad-Exchanger",
        subDomain: "flash.beta.com",
        earning: 3000000,
        totalSpending: 500000,
      },
    ],
    payouts: [
      // Potongan pencairan: Rp 2.000.000 dibayarkan Google, Rp 100.000 fee perantara dan
      // Rp 150.000 konversi + pajak, jadi yang mendarat Rp 1.750.000 dan yang hilang Rp 250.000.
      {
        month: "2026-08",
        domain: "alpha.com",
        realMasuk: 2000000,
        feePercent: 5,
        potonganKonversi: 150000,
      },
      // Rekening lokal: tidak ada yang hilang di jalan, jadi ia tidak menghasilkan potongan apa pun.
      { month: "2026-08", domain: "beta.com", realMasuk: 800000 },
    ],
  };

  const report = buildProfitLoss({
    ...store,
    financials: [
      { date: "2026-08-01", grossRevenue: 2300000, totalSpend: 600000, adTax: 0, totalSpending: 600000 },
    ],
    range: bulan("2026-08"),
    now: new Date(2026, 7, 25),
  });
  const cash = buildCashFlow(store, bulan("2026-08"));

  test("potongan Company menyebut angka yang sama", () => {
    assert.equal(report.companyDeduction, cash.totals.company);
  });

  test("bonus advertiser menyebut angka yang sama", () => {
    assert.equal(report.advertiserBonus, cash.totals.bonus);
  });

  test("earning yang punya rinciannya sama, berikut invalid traffic yang membebaninya", () => {
    assert.equal(report.coveredEarning, cash.totals.earning);
    assert.equal(report.invalidTraffic, cash.totals.invalidTraffic);
  });

  test("earning yang belum punya tarif Company sama di keduanya", () => {
    assert.equal(report.earningWithoutPercent, cash.totals.earningWithoutPercent);
  });

  // Potongan pencairan masuk ke rantai lewat dua jalan yang berbeda — dijumlah langsung di Laba
  // Rugi, dibagi ke ember di Cash Flow — dan keduanya harus mendarat di angka yang sama. Persis
  // keadaan yang dulu membuat pembagian invalid traffic berselisih di dua tab bertetangga.
  /**
   * Porsi biaya operasional masuk ke rantai lewat dua jalan yang berbeda — dijumlah langsung lalu
   * dibagi ke PIC di Laba Rugi, dibagi ke baris lalu dijumlah di Cash Flow — dan keduanya harus
   * mendarat di bonus yang sama. Ini keadaan yang sama persis yang dulu membuat pembagian invalid
   * traffic berselisih di dua tab bertetangga, dan sekarang ia menyentuh dasar bonus: yang
   * berselisih bukan lagi satu kolom, melainkan berapa yang dibayarkan ke orang.
   */
  test("porsi biaya operasional menghasilkan bonus yang sama di kedua modul", () => {
    const expenses = [
      { date: "2026-08-05", itemName: "Sewa server", qty: 1, nominal: 900000, total: 900000 },
    ];
    const adxCosts = [{ date: "2026-08-09", domain: "alpha.com", nominal: 300000 }];

    const laba = buildProfitLoss({
      ...store,
      expenses,
      adxCosts,
      financials: [
        { date: "2026-08-01", grossRevenue: 2300000, totalSpend: 600000, adTax: 0, totalSpending: 600000 },
      ],
      range: bulan("2026-08"),
      now: new Date(2026, 7, 25),
    });
    const kas = buildCashFlow({ ...store, expenses, adxCosts }, bulan("2026-08"));

    assert.equal(laba.bonusOperatingExpense, 1_200_000, "keduanya masuk kantong yang dibagi");
    // Sampai RUPIAH, bukan sampai sen — alasan yang sama dengan potongan pencairan di atas: Cash
    // Flow membulatkan porsi tiap baris lalu menjumlahkannya.
    assert.ok(Math.abs(laba.advertiserBonus - kas.totals.bonus) < 1);
    assert.ok(Math.abs(laba.bonusOperatingExpense - kas.totals.operatingExpense) < 1);
    // Dan bonusnya memang BERGESER — tanpa ini tes di atas juga lulus untuk dua modul yang
    // sama-sama mengabaikan aturan ini.
    assert.ok(kas.totals.bonus < buildCashFlow(store, bulan("2026-08")).totals.bonus);
  });

  test("potongan pencairan menyebut angka yang sama", () => {
    assert.equal(report.payoutCost, 250_000);
    // Sampai RUPIAH, bukan sampai sen: Cash Flow membulatkan porsi TIAP EMBER lalu menjumlahkannya,
    // jadi satu nominal yang dibagi tiga ember berakhir 1 sen di bawah totalnya. Yang dijaga di
    // sini adalah bahwa keduanya membagi uang yang sama dengan pembagi yang sama — bukan bahwa
    // pembulatan per baris bisa dihindari.
    assert.ok(Math.abs(report.payoutCost - cash.totals.payoutCost) < 1);
  });
});
