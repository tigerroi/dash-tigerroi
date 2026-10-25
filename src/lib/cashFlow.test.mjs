import assert from "node:assert/strict";
import test from "node:test";
import { buildCashFlow, cashFlowMonths } from "./cashFlow.js";
import { monthRange } from "./dateRange.js";

// Bulan PENUH sebagai rentang — bentuk yang dipakai halaman ini sebagai bawaan. `monthRange`
// memotong bulan BERJALAN di hari ini, jadi `now` yang jauh di depan dioper supaya hasilnya tidak
// bergantung pada jam mesin yang menjalankan tes; seluruh fixture di berkas ini bertanggal 2026.
const bulan = (key) => monthRange(key, new Date(2030, 0, 1));

// Satu baris ROI harian. Rincian sumber earning-nya yang menentukan jenis akunnya — tidak ada
// field "jenis akun" di baris ROI, persis seperti di RTDB.
function adx(date, subDomain, pic, earning, totalSpending) {
  return { date, subDomain, pic, earning, totalSpending, adxRevenue: earning, adsenseRevenue: 0 };
}

function adsense(date, subDomain, pic, earning, totalSpending) {
  return { date, subDomain, pic, earning, totalSpending, adxRevenue: 0, adsenseRevenue: earning };
}

const DOMAINS = [{ domainUrl: "xiaomidriversdownload.com" }, { domainUrl: "designingaround.com" }];

function rowOf(report, subDomain, accountType, pic) {
  return report.rows.find(
    (row) =>
      row.subDomain === subDomain &&
      row.accountType === accountType &&
      (!pic || row.pic === pic),
  );
}

test("rantainya: bruto, ROI, potongan Company, invalid traffic, net profit, bonus, net income owner", () => {
  const store = {
    domains: DOMAINS,
    subDomains: [{ name: "flash.xiaomidriversdownload.com", parentDomain: "xiaomidriversdownload.com" }],
    companyPercents: [
      { domain: "xiaomidriversdownload.com", effectiveFrom: "2026-01-01", percent: 10 },
    ],
    invalidTraffic: [
      {
        month: "2026-04",
        domain: "xiaomidriversdownload.com",
        accountType: "Ad-Exchanger",
        check1: 5000,
      },
    ],
    users: [{ name: "Aca", bonusPercent: 10 }],
    roiReports: [adx("2026-04-10", "flash.xiaomidriversdownload.com", "Aca", 1_000_000, 400_000)],
  };

  const row = rowOf(buildCashFlow(store, bulan("2026-04")), "flash.xiaomidriversdownload.com", "Ad-Exchanger");

  assert.equal(row.earning, 1_000_000);
  assert.equal(row.totalSpending, 400_000);
  assert.equal(row.grossProfit, 600_000);
  assert.equal(row.roi, 150); // (1.000.000 − 400.000) / 400.000
  assert.deepEqual(row.companyPercents, [10]);
  assert.equal(row.company, 100_000);
  // Satu-satunya ember Ad-Exchanger domain itu, jadi seluruh nominalnya jatuh ke sini.
  assert.equal(row.invalidTraffic, 5000);
  assert.equal(row.invalidTrafficShare, 100);
  assert.equal(row.netProfit, 495_000); // 600.000 − 100.000 − 5.000
  assert.equal(row.netRoi, 123.75); // 495.000 / 400.000
  assert.equal(row.bonusPercent, 10);
  assert.equal(row.bonus, 49_500);
  assert.equal(row.netIncomeOwner, 445_500);
});

/**
 * Porsi biaya operasional: dibagi menurut porsi earning, dan SENGAJA di luar kolom Net Profit.
 *
 * Dua hal yang dijaga tes ini, dan keduanya keputusan:
 *
 *   1. Net Profit TIDAK ikut berkurang. Kartu di kepala halaman menjumlahkan Biaya Operasional
 *      sebagai item Cash Out tersendiri, sementara "Akun Close Cut" menjumlahkan `netIncomeOwner`
 *      domain yang ditutup — dimasukkan ke Net Profit, porsi milik domain yang ditutup dikurangkan
 *      dua kali dari Net Income Owner di kartu itu.
 *   2. Bonus dihitung dari Net Profit DIKURANGI porsi itu, dan porsinya berdiri sebagai kolom
 *      sendiri. Bonus yang tidak bisa dihitung ulang dari kolom-kolom yang terlihat adalah kolom
 *      yang cuma bisa dipercaya.
 */
test("porsi biaya operasional mengurangi dasar bonus tanpa menyentuh Net Profit", () => {
  const store = {
    domains: DOMAINS,
    subDomains: [
      { name: "flash.xiaomidriversdownload.com", parentDomain: "xiaomidriversdownload.com" },
      { name: "tools.designingaround.com", parentDomain: "designingaround.com" },
    ],
    users: [{ name: "Aca", bonusPercent: 10 }],
    expenses: [
      { date: "2026-07-05", itemName: "Sewa server", qty: 1, nominal: 300_000, total: 300_000 },
    ],
    roiReports: [
      adx("2026-07-10", "flash.xiaomidriversdownload.com", "Aca", 900_000, 400_000),
      adx("2026-07-10", "tools.designingaround.com", "Aca", 300_000, 100_000),
    ],
  };

  const report = buildCashFlow(store, bulan("2026-07"));
  const flash = rowOf(report, "flash.xiaomidriversdownload.com", "Ad-Exchanger");
  const tools = rowOf(report, "tools.designingaround.com", "Ad-Exchanger");

  // 900rb : 300rb dari 1,2jt → 3/4 dan 1/4 dari Rp 300.000.
  assert.equal(flash.operatingExpense, 225_000);
  assert.equal(tools.operatingExpense, 75_000);
  assert.equal(report.totals.operatingExpense, 300_000);

  assert.equal(flash.netProfit, 500_000, "kolom Net Profit berhenti di potongan pencairan");
  assert.equal(flash.bonus, 27_500, "10% dari 500.000 − 225.000");
  assert.equal(tools.netProfit, 200_000);
  assert.equal(tools.bonus, 12_500, "10% dari 200.000 − 75.000");
  // Net Income Owner tetap Net Profit dikurangi bonus — dua kolom yang berdiri di sebelahnya.
  assert.equal(flash.netIncomeOwner, 472_500);
});

test("biaya bertanggal sebelum Juli 2026 tidak menyentuh dasar bonus satu baris pun", () => {
  const store = {
    domains: DOMAINS,
    subDomains: [{ name: "flash.xiaomidriversdownload.com", parentDomain: "xiaomidriversdownload.com" }],
    users: [{ name: "Aca", bonusPercent: 10 }],
    expenses: [
      { date: "2026-06-05", itemName: "Sewa server", qty: 1, nominal: 300_000, total: 300_000 },
    ],
    roiReports: [adx("2026-06-10", "flash.xiaomidriversdownload.com", "Aca", 900_000, 400_000)],
  };

  const row = rowOf(buildCashFlow(store, bulan("2026-06")), "flash.xiaomidriversdownload.com", "Ad-Exchanger");

  assert.equal(row.operatingExpense, 0);
  assert.equal(row.bonus, 50_000, "10% dari 500.000 penuh, sama seperti sebelum aturan ini ada");
});

test("potongan Company kena Ad Exchange saja — baris AdSense tidak dipotong walau domainnya bertarif", () => {
  const store = {
    domains: DOMAINS,
    subDomains: [],
    companyPercents: [
      { domain: "xiaomidriversdownload.com", effectiveFrom: "2026-01-01", percent: 20 },
    ],
    users: [],
    roiReports: [
      adsense("2026-04-10", "usb.xiaomidriversdownload.com", "Aca", 500_000, 100_000),
      adx("2026-04-10", "data.xiaomidriversdownload.com", "Aca", 500_000, 100_000),
    ],
  };

  const report = buildCashFlow(store, bulan("2026-04"));
  assert.equal(rowOf(report, "usb.xiaomidriversdownload.com", "Adsense").company, 0);
  assert.deepEqual(rowOf(report, "usb.xiaomidriversdownload.com", "Adsense").companyPercents, []);
  assert.equal(rowOf(report, "data.xiaomidriversdownload.com", "Ad-Exchanger").company, 100_000);
});

test("tarif yang berganti di tengah bulan dihitung PER HARI, dan kolomnya menyebut keduanya", () => {
  const store = {
    domains: DOMAINS,
    subDomains: [],
    companyPercents: [
      { domain: "designingaround.com", effectiveFrom: "2026-05-01", percent: 74 },
      { domain: "designingaround.com", effectiveFrom: "2026-05-21", percent: 54 },
    ],
    users: [],
    roiReports: [
      adx("2026-05-10", "wealth.designingaround.com", "Aca", 1_000_000, 0),
      adx("2026-05-25", "wealth.designingaround.com", "Aca", 1_000_000, 0),
    ],
  };

  const row = rowOf(buildCashFlow(store, bulan("2026-05")), "wealth.designingaround.com", "Ad-Exchanger");
  // 74% dari sejuta + 54% dari sejuta — bukan salah satu tarif dikalikan dua juta.
  assert.equal(row.company, 1_280_000);
  assert.deepEqual(row.companyPercents, [54, 74]);
});

test("hari yang belum punya tarif tidak dipotong, dan earning-nya dilaporkan terpisah", () => {
  const store = {
    domains: DOMAINS,
    subDomains: [],
    // Tarif baru berlaku 1 Juni: hari-hari Mei tidak boleh ikut terpotong olehnya.
    companyPercents: [
      { domain: "xiaomidriversdownload.com", effectiveFrom: "2026-06-01", percent: 10 },
    ],
    users: [],
    roiReports: [adx("2026-05-10", "data.xiaomidriversdownload.com", "Aca", 800_000, 0)],
  };

  const row = rowOf(buildCashFlow(store, bulan("2026-05")), "data.xiaomidriversdownload.com", "Ad-Exchanger");
  assert.equal(row.company, 0);
  assert.deepEqual(row.companyPercents, []);
  assert.equal(row.earningWithoutPercent, 800_000);
});

test("invalid traffic domain dibagi ke subdomainnya menurut porsi earning", () => {
  const store = {
    domains: DOMAINS,
    subDomains: [],
    companyPercents: [],
    invalidTraffic: [
      { month: "2026-04", domain: "xiaomidriversdownload.com", accountType: "Adsense", check1: 100 },
    ],
    users: [],
    roiReports: [
      adsense("2026-04-10", "usb.xiaomidriversdownload.com", "Aca", 750_000, 0),
      adsense("2026-04-10", "tools.xiaomidriversdownload.com", "Aca", 250_000, 0),
      // Ad-Exchanger di domain yang sama TIDAK ikut dibagi: nominalnya bertanda jenis akun.
      adx("2026-04-10", "data.xiaomidriversdownload.com", "Aca", 1_000_000, 0),
    ],
  };

  const report = buildCashFlow(store, bulan("2026-04"));
  assert.equal(rowOf(report, "usb.xiaomidriversdownload.com", "Adsense").invalidTraffic, 75);
  assert.equal(rowOf(report, "usb.xiaomidriversdownload.com", "Adsense").invalidTrafficShare, 75);
  assert.equal(rowOf(report, "tools.xiaomidriversdownload.com", "Adsense").invalidTraffic, 25);
  assert.equal(rowOf(report, "data.xiaomidriversdownload.com", "Ad-Exchanger").invalidTraffic, 0);
  assert.equal(rowOf(report, "data.xiaomidriversdownload.com", "Ad-Exchanger").invalidTrafficShare, "");
});

test("baris invalid traffic LAMA tanpa jenis akun dibagi ke kedua sisi domain itu", () => {
  const store = {
    domains: DOMAINS,
    subDomains: [],
    companyPercents: [],
    invalidTraffic: [{ month: "2026-04", domain: "xiaomidriversdownload.com", nominal: 100 }],
    users: [],
    roiReports: [
      adsense("2026-04-10", "usb.xiaomidriversdownload.com", "Aca", 500_000, 0),
      adx("2026-04-10", "data.xiaomidriversdownload.com", "Aca", 500_000, 0),
    ],
  };

  const report = buildCashFlow(store, bulan("2026-04"));
  assert.equal(rowOf(report, "usb.xiaomidriversdownload.com", "Adsense").invalidTraffic, 50);
  assert.equal(rowOf(report, "data.xiaomidriversdownload.com", "Ad-Exchanger").invalidTraffic, 50);
});

test("beberapa baris pengecekan di bulan yang sama tidak membuat porsinya melewati 100%", () => {
  const store = {
    domains: DOMAINS,
    subDomains: [],
    companyPercents: [],
    invalidTraffic: [
      { month: "2026-04", domain: "xiaomidriversdownload.com", accountType: "Adsense", check1: 100 },
      { month: "2026-04", domain: "xiaomidriversdownload.com", accountType: "Adsense", check1: 300 },
    ],
    users: [],
    roiReports: [
      adsense("2026-04-10", "usb.xiaomidriversdownload.com", "Aca", 750_000, 0),
      adsense("2026-04-10", "tools.xiaomidriversdownload.com", "Aca", 250_000, 0),
    ],
  };

  const row = rowOf(buildCashFlow(store, bulan("2026-04")), "usb.xiaomidriversdownload.com", "Adsense");
  assert.equal(row.invalidTraffic, 300); // 75% dari 400
  assert.equal(row.invalidTrafficShare, 75);
});

test("satu subdomain yang dipegang dua advertiser berdiri sebagai dua baris", () => {
  const store = {
    domains: DOMAINS,
    subDomains: [],
    companyPercents: [],
    users: [],
    roiReports: [
      adx("2026-04-10", "flash.xiaomidriversdownload.com", "Aca", 900_000, 380_000),
      adx("2026-04-11", "flash.xiaomidriversdownload.com", "Nurjaman", 5_000_000, 2_200_000),
    ],
  };

  const report = buildCashFlow(store, bulan("2026-04"));
  const rows = report.rows.filter((row) => row.subDomain === "flash.xiaomidriversdownload.com");
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((row) => row.pic).sort(),
    ["Aca", "Nurjaman"],
  );
  assert.equal(rowOf(report, "flash.xiaomidriversdownload.com", "Ad-Exchanger", "Aca").earning, 900_000);
});

test("belanja dibagi menurut porsi earning DI DALAM baris yang sumbernya bercampur", () => {
  const store = {
    domains: DOMAINS,
    subDomains: [],
    companyPercents: [],
    users: [],
    roiReports: [
      {
        date: "2026-04-10",
        subDomain: "mix.xiaomidriversdownload.com",
        pic: "Aca",
        earning: 1_000_000,
        totalSpending: 400_000,
        adxRevenue: 600_000,
        adsenseRevenue: 400_000,
      },
    ],
  };

  const report = buildCashFlow(store, bulan("2026-04"));
  assert.equal(rowOf(report, "mix.xiaomidriversdownload.com", "Ad-Exchanger").totalSpending, 240_000);
  assert.equal(rowOf(report, "mix.xiaomidriversdownload.com", "Adsense").totalSpending, 160_000);
});

test("baris tanpa earning dilewati berikut belanjanya", () => {
  const store = {
    domains: DOMAINS,
    subDomains: [],
    companyPercents: [],
    users: [],
    roiReports: [
      { date: "2026-04-10", subDomain: "data.xiaomidriversdownload.com", pic: "Aca", earning: "", totalSpending: 900_000 },
      adx("2026-04-11", "data.xiaomidriversdownload.com", "Aca", 100_000, 50_000),
    ],
  };

  const row = rowOf(buildCashFlow(store, bulan("2026-04")), "data.xiaomidriversdownload.com", "Ad-Exchanger");
  assert.equal(row.earning, 100_000);
  assert.equal(row.totalSpending, 50_000);
});

test("ember yang kosong di kedua sisi tidak jadi baris", () => {
  const store = {
    domains: DOMAINS,
    subDomains: [],
    companyPercents: [],
    users: [],
    roiReports: [adx("2026-04-10", "data.xiaomidriversdownload.com", "Aca", 100_000, 50_000)],
  };

  const report = buildCashFlow(store, bulan("2026-04"));
  assert.equal(report.rows.length, 1);
  assert.equal(report.rows[0].accountType, "Ad-Exchanger");
});

test("lantai belanja: ROI dan Net ROI kosong, bukan angka enam digit", () => {
  const store = {
    domains: DOMAINS,
    subDomains: [],
    companyPercents: [],
    users: [],
    roiReports: [adx("2026-04-10", "data.xiaomidriversdownload.com", "Aca", 826, 43)],
  };

  const row = rowOf(buildCashFlow(store, bulan("2026-04")), "data.xiaomidriversdownload.com", "Ad-Exchanger");
  assert.equal(row.roi, "");
  assert.equal(row.netRoi, "");
  // Yang TIDAK ikut dikosongkan: uangnya nyata berapa pun kecilnya pembagi.
  assert.equal(row.grossProfit, 783);
  assert.equal(row.netProfit, 783);
});

test("baris rugi di tengah bulan yang untung tetap mengurangi bonus, dan bonusnya boleh minus", () => {
  const store = {
    domains: DOMAINS,
    subDomains: [],
    companyPercents: [],
    users: [{ name: "Aca", bonusPercent: 10 }],
    roiReports: [
      adx("2026-06-10", "care.xiaomidriversdownload.com", "Aca", 2_000_000, 1_000_000),
      adx("2026-06-10", "tools.xiaomidriversdownload.com", "Aca", 100_000, 300_000),
    ],
  };

  const report = buildCashFlow(store, bulan("2026-06"));
  assert.equal(rowOf(report, "care.xiaomidriversdownload.com", "Ad-Exchanger").bonus, 100_000);
  assert.equal(rowOf(report, "tools.xiaomidriversdownload.com", "Ad-Exchanger").bonus, -20_000);
  // Jumlahnya = tarif × net profit sebulan, yaitu dasar yang sama dengan baris "Bonus advertiser"
  // di Laba Rugi.
  assert.equal(report.totals.bonus, 80_000);
});

test("bulan yang seluruhnya rugi tidak menghasilkan bonus negatif — tidak ada bonus dari kerugian", () => {
  const store = {
    domains: DOMAINS,
    subDomains: [],
    companyPercents: [],
    users: [{ name: "Aca", bonusPercent: 10 }],
    roiReports: [adx("2026-06-10", "tools.xiaomidriversdownload.com", "Aca", 100_000, 300_000)],
  };

  const row = rowOf(buildCashFlow(store, bulan("2026-06")), "tools.xiaomidriversdownload.com", "Ad-Exchanger");
  assert.equal(row.bonus, 0);
  assert.equal(row.bonusHeld, true);
  assert.equal(row.netIncomeOwner, row.netProfit);
});

test("advertiser tanpa tarif bonus tidak dibonuskan, dan itu dibedakan dari bonus yang ditahan", () => {
  const store = {
    domains: DOMAINS,
    subDomains: [],
    companyPercents: [],
    users: [{ name: "Aca" }],
    roiReports: [adx("2026-04-10", "data.xiaomidriversdownload.com", "Aca", 1_000_000, 200_000)],
  };

  const row = rowOf(buildCashFlow(store, bulan("2026-04")), "data.xiaomidriversdownload.com", "Ad-Exchanger");
  assert.equal(row.bonusPercent, null);
  assert.equal(row.bonus, 0);
  assert.equal(row.bonusHeld, false);
});

test("PIC diambil dari subDomains untuk baris ROI yang tidak membawanya", () => {
  const store = {
    domains: DOMAINS,
    subDomains: [
      {
        name: "data.xiaomidriversdownload.com",
        parentDomain: "xiaomidriversdownload.com",
        pic: "Nurjaman",
      },
    ],
    companyPercents: [],
    users: [],
    roiReports: [
      { date: "2026-04-10", subDomain: "data.xiaomidriversdownload.com", earning: 500_000, totalSpending: 100_000 },
    ],
  };

  assert.equal(buildCashFlow(store, bulan("2026-04")).rows[0].pic, "Nurjaman");
});

test("belanja yang tidak diketahui dihitung sebagai hari, bukan disamarkan jadi Rp 0", () => {
  const store = {
    domains: DOMAINS,
    subDomains: [],
    companyPercents: [],
    users: [],
    roiReports: [
      adx("2026-04-10", "data.xiaomidriversdownload.com", "Aca", 500_000, 100_000),
      { date: "2026-04-11", subDomain: "data.xiaomidriversdownload.com", pic: "Aca", earning: 500_000, adxRevenue: 500_000 },
    ],
  };

  const row = rowOf(buildCashFlow(store, bulan("2026-04")), "data.xiaomidriversdownload.com", "Ad-Exchanger");
  assert.equal(row.days, 2);
  assert.equal(row.daysWithoutSpend, 1);
  assert.equal(row.totalSpending, 100_000);
});

test("total dihitung dari jumlah uangnya, bukan dari rata-rata kolom persen", () => {
  const store = {
    domains: DOMAINS,
    subDomains: [],
    companyPercents: [],
    users: [{ name: "Aca", bonusPercent: 10 }],
    roiReports: [
      adx("2026-04-10", "kecil.xiaomidriversdownload.com", "Aca", 100_000, 2000),
      adx("2026-04-10", "besar.xiaomidriversdownload.com", "Aca", 2_000_000, 1_000_000),
    ],
  };

  const totals = buildCashFlow(store, bulan("2026-04")).totals;
  assert.equal(totals.earning, 2_100_000);
  assert.equal(totals.totalSpending, 1_002_000);
  assert.equal(totals.grossProfit, 1_098_000);
  assert.equal(totals.netProfit, 1_098_000);
  assert.equal(totals.bonus, 109_800);
  assert.equal(totals.netIncomeOwner, 988_200);
  // Rata-rata kedua kolom ROI adalah (4800 + 100) / 2 = 2450%. Yang benar 109,58%.
  assert.equal(totals.roi, 109.58);
});

test("bulan lain tidak ikut terhitung", () => {
  const store = {
    domains: DOMAINS,
    subDomains: [],
    companyPercents: [],
    users: [],
    roiReports: [
      adx("2026-04-10", "data.xiaomidriversdownload.com", "Aca", 100_000, 10_000),
      adx("2026-05-10", "data.xiaomidriversdownload.com", "Aca", 900_000, 10_000),
    ],
  };

  assert.equal(buildCashFlow(store, bulan("2026-04")).totals.earning, 100_000);
  assert.deepEqual(cashFlowMonths(store), ["2026-05", "2026-04"]);
});

// Baris nyata dari spreadsheet acuan (April 2026, xiaomidriversdownload.com, Adsense). Angka
// invalid traffic-nya adalah jumlah ketiga baris di sana; yang diperiksa di sini adalah bahwa
// pembagiannya kembali menghasilkan ketiganya.
test("mereproduksi kelompok Adsense April dari spreadsheet acuan", () => {
  const store = {
    domains: DOMAINS,
    subDomains: [],
    companyPercents: [],
    invalidTraffic: [
      {
        month: "2026-04",
        domain: "xiaomidriversdownload.com",
        accountType: "Adsense",
        check1: 60_317,
      },
    ],
    users: [
      { name: "Aca", bonusPercent: 10 },
      { name: "Nurjaman", bonusPercent: 15 },
    ],
    roiReports: [
      adsense("2026-04-10", "usb.xiaomidriversdownload.com", "Aca", 5_557_184, 873_229),
      adsense("2026-04-10", "tools.xiaomidriversdownload.com", "Aca", 907_491, 414_111),
      adsense("2026-04-10", "firmware.xiaomidriversdownload.com", "Nurjaman", 6_601_826, 1_518_302),
    ],
  };

  const report = buildCashFlow(store, bulan("2026-04"));

  const usb = rowOf(report, "usb.xiaomidriversdownload.com", "Adsense");
  assert.equal(usb.grossProfit, 4_683_955);
  assert.equal(Math.round(usb.roi), 536);
  assert.equal(Math.round(usb.invalidTraffic), 25_653);
  assert.equal(Math.round(usb.netProfit), 4_658_302);
  assert.equal(Math.round(usb.netRoi), 533);
  assert.equal(Math.round(usb.bonus), 465_830);
  assert.equal(Math.round(usb.netIncomeOwner), 4_192_472);

  const tools = rowOf(report, "tools.xiaomidriversdownload.com", "Adsense");
  assert.equal(tools.grossProfit, 493_380);
  assert.equal(Math.round(tools.invalidTraffic), 4_189);
  assert.equal(Math.round(tools.netProfit), 489_191);

  const firmware = rowOf(report, "firmware.xiaomidriversdownload.com", "Adsense");
  assert.equal(firmware.grossProfit, 5_083_524);
  assert.equal(Math.round(firmware.netProfit), 5_053_049);
  assert.equal(Math.round(firmware.bonus), 757_957);
  assert.equal(Math.round(firmware.netIncomeOwner), 4_295_092);
});

// --- kartu arus kas ---------------------------------------------------------------------------

import { cashFlowSummary } from "./cashFlow.js";

const CASH_STORE = {
  domains: DOMAINS,
  subDomains: [],
  companyPercents: [
    { domain: "xiaomidriversdownload.com", effectiveFrom: "2026-01-01", percent: 10 },
  ],
  invalidTraffic: [
    { month: "2026-04", domain: "xiaomidriversdownload.com", accountType: "Ad-Exchanger", check1: 5000 },
  ],
  whitelistTopup: [
    { date: "2026-04-13", namaKode: "TBZ 1233", nominal: 1_000_000, feeTopup: 50_000 },
    { date: "2026-04-19", namaKode: "TBZ 1233", nominal: 2_000_000, feeTopup: 100_000 },
    { date: "2026-05-05", namaKode: "TBZ 1235", nominal: 9_000_000, feeTopup: 450_000 },
  ],
  expenses: [
    { date: "2026-04-05", itemName: "Sewa server", nominal: 300_000, qty: 2, total: 600_000 },
    { date: "2026-05-05", itemName: "Sewa server", nominal: 300_000, qty: 1, total: 300_000 },
  ],
  adxCosts: [
    { date: "2026-04-21", domain: "xiaomidriversdownload.com", companyName: "X", nominal: 1_200_000 },
  ],
  payouts: [],
  users: [{ name: "Aca", bonusPercent: 10 }],
  roiReports: [adx("2026-04-10", "data.xiaomidriversdownload.com", "Aca", 10_000_000, 4_000_000)],
};

function summaryOf(store, month = "2026-04", business) {
  const range = bulan(month);
  return cashFlowSummary(store, range, buildCashFlow(store, range), business);
}

const itemOf = (group, key) => group.find((item) => item.key === key);

/**
 * Rentang yang memotong sebuah bulan tidak bisa membagi nominal bulanannya — aturan yang sama
 * dengan Laba Rugi, lewat `wholeMonthsIn` yang sama.
 */
test("invalid traffic bulan yang tidak tertutup penuh tidak ikut, dan namanya disebutkan", () => {
  const penuh = summaryOf(CASH_STORE);
  assert.equal(itemOf(penuh.outflow, "traffic").value, 5000);
  assert.deepEqual(penuh.partialMonths, []);

  const potong = cashFlowSummary(
    CASH_STORE,
    { from: "2026-04-01", to: "2026-04-20" },
    buildCashFlow(CASH_STORE, { from: "2026-04-01", to: "2026-04-20" }),
  );
  // Kosong, BUKAN Rp 0: bulan yang barisnya tidak boleh dibaca sama sekali tidak mengatakan bahwa
  // bulan itu bersih dari invalid traffic.
  assert.equal(itemOf(potong.outflow, "traffic").value, "");
  assert.deepEqual(potong.partialMonths, ["2026-04"]);
});

test("saldo berjalan dibaca sampai UJUNG rentang, bukan sampai awalnya", () => {
  // Yang dijawab kolom ini adalah "berapa yang masih ada di akun pada akhir periode ini", dan saldo
  // tidak lahir pada tanggal orang membuka laporannya.
  const sebagian = cashFlowSummary(
    CASH_STORE,
    { from: "2026-04-20", to: "2026-04-30" },
    buildCashFlow(CASH_STORE, { from: "2026-04-20", to: "2026-04-30" }),
  );
  const penuh = summaryOf(CASH_STORE);

  assert.equal(
    itemOf(sebagian.result, "balance").value,
    itemOf(penuh.result, "balance").value,
  );
});

test("kartu arus kas: cash in, cash out, dan sisa saldo", () => {
  const s = summaryOf(CASH_STORE);

  // Kolom Total baris top-up: nominal BERIKUT fee perantaranya, karena keduanya benar-benar keluar
  // dari kantong pada hari yang sama. Baris fixture ini tidak membawa `total`, jadi ia sekaligus
  // menguji jalan cadangannya (nominal + fee) — yang tidak boleh jatuh ke nominal saja.
  assert.equal(itemOf(s.inflow, "topup").value, 3_150_000);
  assert.equal(itemOf(s.inflow, "earning").value, 10_000_000);
  assert.equal(s.inflowTotal, 13_150_000);

  assert.equal(itemOf(s.outflow, "spending").value, 4_000_000);
  assert.equal(itemOf(s.outflow, "company").value, 1_000_000); // 10% × 10 juta
  assert.equal(itemOf(s.outflow, "traffic").value, 5000);
  assert.equal(itemOf(s.outflow, "expenses").value, 600_000); // nominal × qty
  assert.equal(itemOf(s.outflow, "approval").value, 1_200_000);
  // Net profit = 10jt − 4jt − 1jt − 5rb = 4.995.000; bonus 10%.
  assert.equal(itemOf(s.outflow, "bonus").value, 499_500);
  assert.equal(s.outflowTotal, 4_000_000 + 1_000_000 + 5000 + 499_500 + 600_000 + 1_200_000);

  assert.equal(itemOf(s.result, "balance").value, -850_000); // 3,15jt topup − 4jt belanja
});

/**
 * Pendapatan dan belanja di kartu berskala USAHA, bukan jumlah baris ROI di tabel bawahnya.
 *
 * Itu yang dijawab sheet "Dashboard", dan itu juga baris Pendapatan dan Total belanja iklan di Laba
 * Rugi — angkanya dioper dari `buildProfitLoss` yang sama, jadi kedua tab tidak bisa menyebut dua
 * angka untuk uang yang sama. Mei 2026: belanja usaha Rp 36.990.790 melawan Rp 29.426.472 yang
 * punya baris ROI, dan selisihnya `coverageGap` — sebagian besar berjalan di ad account yang token
 * Meta kita tidak punya izin membacanya.
 */
test("Pendapatan dan Spending di kartu berskala usaha, bukan jumlah baris ROI", () => {
  const business = { revenue: 90_000_000, totalAdSpend: 30_000_000, spendUpTo: 44_000_000 };
  const s = summaryOf(CASH_STORE, "2026-04", business);

  assert.equal(itemOf(s.inflow, "earning").value, 90_000_000);
  assert.equal(itemOf(s.outflow, "spending").value, 30_000_000);
  // Rantai Cash Available ikut berskala usaha — kalau tidak, Laba Kotor Google lahir dari dua
  // sumber yang berbeda dan tidak bisa dihitung ulang dari kartu mana pun di sebelahnya.
  assert.equal(itemOf(s.result, "grossGoogle").value, 60_000_000);

  // Saldo berjalan dihitung dengan aturan yang SAMA: dua angka bertetangga di satu kartu yang
  // berselisih tanpa sebab yang terbaca lebih buruk daripada satu angka yang kurang presisi.
  assert.equal(itemOf(s.result, "balance").value, 3_150_000 - 44_000_000);
});

test("tanpa angka berskala usaha, kartunya jatuh ke jumlah baris ROI — bukan ke kosong", () => {
  const s = summaryOf(CASH_STORE);
  assert.equal(itemOf(s.inflow, "earning").value, 10_000_000);
  assert.equal(itemOf(s.outflow, "spending").value, 4_000_000);
});

// Bentuk kartunya mengikuti sheet "Dashboard" (DASHBOARD DATA CENTER): satu baris kepala berisi
// Cash Inflow / Cash Outflow / Result, lalu tiga kolom rincian. Yang dijaga di sini bukan
// tampilannya melainkan syarat yang membuat susunan itu bisa dipercaya.
test("baris kepala menjumlahkan kolom yang berdiri persis di bawahnya", () => {
  const s = summaryOf(CASH_STORE);

  // Kalau ketiganya tidak bisa dihitung ulang dari kolom di bawahnya, kartu ini tidak bisa diadu
  // dengan apa pun — termasuk dengan dirinya sendiri. Sheet acuannya menghitung Cash Inflow dari
  // pendapatan Google saja sementara kolomnya memuat top-up juga; di sini sengaja tidak.
  assert.equal(itemOf(s.headline, "inflow").value, s.inflowTotal);
  assert.equal(itemOf(s.headline, "outflow").value, s.outflowTotal);
  assert.equal(itemOf(s.headline, "statement").value, s.inflowTotal - s.outflowTotal);

  // Result MEMUAT top-up, karena ia menjumlahkan kolom yang berdiri persis di bawahnya — dan
  // top-up berdiri di sana. Yang menjaganya tetap terbaca adalah keterangan sumbernya, bukan
  // angka kedua di kartu yang sama.
  assert.equal(
    itemOf(s.headline, "statement").value,
    itemOf(s.inflow, "topup").value + itemOf(s.inflow, "earning").value - s.outflowTotal,
  );
});

test("Cash Available adalah rantai berjenjang, tiap baris dari baris di atasnya", () => {
  const s = summaryOf(CASH_STORE);
  const out = (key) => itemOf(s.outflow, key).value;

  // Laba Kotor Google = Pendapatan Kotor − Spending.
  assert.equal(itemOf(s.result, "grossGoogle").value, 10_000_000 - 4_000_000);
  // Pendapatan Bersih = Laba Kotor − Company − Invalid Traffic − Bonus − Biaya Operasional.
  // BERHENTI sebelum Akun Close, Approval, dan Potongan Pencairan — ketiganya baru masuk di Net
  // Income Owner, dan urutan itulah yang membuat kedua angka bisa dibedakan pembacanya.
  assert.equal(
    itemOf(s.result, "netGoogle").value,
    6_000_000 - out("company") - out("traffic") - out("bonus") - out("expenses"),
  );
});

// Aturan yang sama dengan `netIncomeOwner` sejak awal: invalid traffic belum diinput sejak Agustus
// dan baris pengeluaran tidak selalu ada. Mengosongkan seluruh rantai karena salah satunya belum
// ada berarti kolom ini kosong hampir sepanjang tahun.
test("potongan yang belum diinput dilewati sebagai nol, tidak mengosongkan rantainya", () => {
  const s = summaryOf({ ...CASH_STORE, invalidTraffic: [], expenses: [] });
  assert.equal(itemOf(s.outflow, "traffic").value, "");
  assert.equal(itemOf(s.outflow, "expenses").value, "");
  assert.equal(itemOf(s.result, "grossGoogle").value, 6_000_000);
  assert.equal(
    itemOf(s.result, "netGoogle").value,
    6_000_000 - itemOf(s.outflow, "company").value - itemOf(s.outflow, "bonus").value,
  );
});

test("Spending adalah belanja Meta BERIKUT pajaknya, satu angka", () => {
  const store = {
    ...CASH_STORE,
    invalidTraffic: [],
    roiReports: [
      {
        date: "2026-04-10",
        subDomain: "data.xiaomidriversdownload.com",
        pic: "Aca",
        earning: 5_000_000,
        adxRevenue: 5_000_000,
        spending: 1_000_000,
        adTax: 50_000,
        totalSpending: 1_050_000,
      },
    ],
  };
  assert.equal(itemOf(summaryOf(store).outflow, "spending").value, 1_050_000);
});

test("bulan yang belum punya barisnya menghasilkan kosong, bukan Rp 0", () => {
  // Mei di fixture ini: ada top-up dan expenses; TIDAK ada invalid traffic, adxCosts, payouts,
  // maupun baris ROI. Enam dari tujuh item Cash Out karena itu tidak diketahui — keempat yang
  // lahir dari baris ROI ikut kosong, dan itu yang membedakan bulan yang belum tersentuh sync dari
  // bulan yang memang tidak membelanjakan apa pun.
  const s = summaryOf(CASH_STORE, "2026-05");

  assert.equal(itemOf(s.outflow, "traffic").value, "");
  assert.equal(itemOf(s.outflow, "approval").value, "");
  assert.equal(itemOf(s.outflow, "accountClose").value, "");
  assert.equal(itemOf(s.outflow, "spending").value, "");
  assert.equal(itemOf(s.outflow, "company").value, "");
  assert.equal(itemOf(s.outflow, "bonus").value, "");
  assert.equal(itemOf(s.outflow, "expenses").value, 300_000);
  assert.equal(itemOf(s.outflow, "payoutCost").value, "");
  assert.equal(s.outflowUnknown, 7);
  // Yang tidak diketahui DILEWATI dari total, bukan ditambahkan sebagai teks: `"" + 300000` bukan
  // 300000 melainkan teks "300000".
  assert.equal(s.outflowTotal, 300_000);
  assert.equal(typeof s.outflowTotal, "number");
});

test("baris yang ADA tapi nominalnya nol tetap Rp 0 — bukan kosong", () => {
  // Dua baris Cost Ad Exchange Juli 2026 keduanya "Garansi Delink": tidak ditagih, jadi tidak
  // membawa field biaya sama sekali. Barisnya ada, dan Rp 0 di sana benar.
  const store = {
    ...CASH_STORE,
    adxCosts: [
      { date: "2026-04-03", domain: "stylefemale.com", companyName: "Monumetric", note: "Garansi Delink" },
    ],
  };
  assert.equal(itemOf(summaryOf(store).outflow, "approval").value, 0);
});

/**
 * TOTAL AKUN CLOSE = jumlah kolom Saldo Close di tab Pencairan, definisi yang sama dengan sheet
 * "Dashboard" (SUMIFS kolom K 'DatMas | Laporan Pencairan').
 *
 * MENGGANTIKAN `accountCloseCut` (Gross Profit domain yang ditutup), yang menjawab pertanyaan yang
 * mirip tapi bukan yang ini — dan yang tidak pernah cocok dengan sheet yang diadu orang dengannya.
 * Yang hangus adalah SALDO-nya: earning dikurangi Company dan Invalid Traffic, ditambah sisa bulan
 * sebelumnya.
 */
test("Total Akun Close = jumlah Saldo Close domain yang ditandai Account Close", () => {
  const store = {
    ...CASH_STORE,
    payouts: [
      { month: "2026-04", domain: "xiaomidriversdownload.com", status: "Account Close" },
      { month: "2026-04", domain: "designingaround.com", status: "Sudah Cair" },
    ],
  };
  // Earning Rp 10jt − Company Rp 1jt − Invalid Traffic Rp 5rb = Rp 8.995.000 yang hangus. Belanja
  // iklan TIDAK dikurangkan: yang hangus adalah saldo yang belum sempat cair, bukan labanya.
  assert.equal(itemOf(summaryOf(store).outflow, "accountClose").value, 8_995_000);
});

test("bulan yang baris pencairannya ada dan tidak satu pun ditutup: Rp 0, dan nol itu benar", () => {
  const store = {
    ...CASH_STORE,
    payouts: [{ month: "2026-04", domain: "designingaround.com", status: "Sudah Cair" }],
  };
  assert.equal(itemOf(summaryOf(store).outflow, "accountClose").value, 0);

  // Tanpa satu pun baris pencairan, "tidak ada akun yang ditutup" belum pernah dinyatakan siapa
  // pun — itu kosong, bukan Rp 0.
  assert.equal(itemOf(summaryOf({ ...CASH_STORE, payouts: [] }).outflow, "accountClose").value, "");
});

// Domain yang ditutup dan tidak punya satu pun sumber earning — bukan baris ROI, bukan baris
// ketikan di tab Akun Ditutup — tidak bisa dihitung Saldo Close-nya. Satu baris begitu
// MENGOSONGKAN seluruh itemnya: yang tersisa kalau tidak adalah angka yang tampak lengkap dan
// diam-diam kurang satu domain.
test("domain yang ditutup tanpa sumber earning mengosongkan itemnya, bukan menjadikannya Rp 0", () => {
  const store = {
    ...CASH_STORE,
    payouts: [
      { month: "2026-04", domain: "dekadeko.com", status: "Sudah Cair" },
      { month: "2026-04", domain: "petcins.com", status: "Account Close" },
    ],
  };
  assert.equal(itemOf(summaryOf(store).outflow, "accountClose").value, "");
});

/**
 * AKUN YANG DITUTUP GOOGLE BERHENTI MENJAWAB `reports:run`, jadi pendapatannya tidak ada di
 * `roiReports` mana pun — ia cuma ada sebagai angka ketikan di tab Akun Ditutup. Tanpa dibaca,
 * Saldo Close-nya "" dan seluruh itemnya ikut kosong: kolom yang seluruh gunanya adalah menyebutkan
 * berapa saldo yang HANGUS justru kosong persis untuk satu-satunya baris yang menghanguskan
 * sesuatu. Mei 2026 di data nyata berbunyi Rp 0 untuk saldo yang sebenarnya Rp 70.514.530.
 */
test("earning ketikan tab Akun Ditutup mengisi Saldo Close domain yang tidak punya baris ROI", () => {
  const store = {
    ...CASH_STORE,
    roiReports: [],
    invalidTraffic: [],
    accountCloses: [
      {
        month: "2026-04",
        pic: "Aca",
        accountType: "Ad-Exchanger",
        subDomain: "data.xiaomidriversdownload.com",
        earning: 10_000_000,
        totalSpending: 4_000_000,
      },
    ],
    payouts: [{ month: "2026-04", domain: "xiaomidriversdownload.com", status: "Account Close" }],
  };
  // Rp 10jt − Company 10% = Rp 9.000.000 yang hangus.
  assert.equal(itemOf(summaryOf(store).outflow, "accountClose").value, 9_000_000);
});

test("Sisa Saldo butuh KEDUA sisinya — tanpa top-up ia kosong, bukan minus seluruh belanja", () => {
  const store = { ...CASH_STORE, whitelistTopup: [] };
  assert.equal(itemOf(summaryOf(store).result, "balance").value, "");
});

test("kartu TIDAK ikut penyaring tabel: sumbernya bulan, bukan baris yang tampil", () => {
  // Dua advertiser; ringkasan memakai totals bulan penuh yang dioper pemanggilnya.
  const store = {
    ...CASH_STORE,
    roiReports: [
      adx("2026-04-10", "data.xiaomidriversdownload.com", "Aca", 10_000_000, 4_000_000),
      adx("2026-04-10", "pro.xiaomidriversdownload.com", "Nurjaman", 6_000_000, 2_000_000),
    ],
  };
  assert.equal(itemOf(summaryOf(store).inflow, "earning").value, 16_000_000);
});

test("bulan tanpa satu pun baris ROI: keempat item turunannya kosong, bukan Rp 0", () => {
  // April 2026 di data nyata: sudah ada top-up dan biaya, tapi `roiReports` baru dimulai Mei.
  const store = {
    ...CASH_STORE,
    invalidTraffic: [],
    payouts: [{ month: "2026-03", domain: "xiaomidriversdownload.com", status: "Account Close" }],
    whitelistTopup: [{ date: "2026-03-13", namaKode: "TBZ 1233", nominal: 1_000_000 }],
    expenses: [{ date: "2026-03-05", itemName: "Sewa server", nominal: 300_000, qty: 1, total: 300_000 }],
    adxCosts: [],
    roiReports: [],
  };
  const s = summaryOf(store, "2026-03");

  assert.equal(itemOf(s.inflow, "earning").value, "");
  assert.equal(itemOf(s.outflow, "spending").value, "");
  assert.equal(itemOf(s.outflow, "company").value, "");
  assert.equal(itemOf(s.outflow, "bonus").value, "");
  // Baris pencairannya ADA, tapi tanpa baris ROI tidak ada Net Income Owner untuk dipotong.
  assert.equal(itemOf(s.outflow, "accountClose").value, "");
  // Yang benar-benar diinput orang tetap terbaca.
  assert.equal(itemOf(s.inflow, "topup").value, 1_000_000);
  assert.equal(itemOf(s.outflow, "expenses").value, 300_000);
  // Sisa Saldo butuh belanja yang diketahui — top-up saja bukan saldo yang tersisa.
  assert.equal(itemOf(s.result, "balance").value, "");
});

// Setoran tidak habis pada bulan ia disetor, dan itu bukan kasus langka: Juli 2026 membelanjakan
// Rp 140,3 juta atas top-up Rp 137,5 juta karena sisa Juni masih ada di akunnya. Dihitung per
// bulan, saldonya berbunyi minus untuk akun yang sebenarnya masih berisi puluhan juta.
test("sisa saldo membawa sisa bulan-bulan sebelumnya, bukan selisih bulan itu saja", () => {
  const store = {
    ...CASH_STORE,
    invalidTraffic: [],
    adxCosts: [],
    expenses: [],
    whitelistTopup: [
      // April menyetor jauh lebih banyak daripada yang dibelanjakannya.
      { date: "2026-04-13", namaKode: "TBZ 1233", nominal: 10_000_000, feeTopup: 500_000 },
      { date: "2026-05-05", namaKode: "TBZ 1233", nominal: 1_000_000, feeTopup: 50_000 },
    ],
    roiReports: [
      adx("2026-04-10", "data.xiaomidriversdownload.com", "Aca", 5_000_000, 2_000_000),
      adx("2026-05-10", "data.xiaomidriversdownload.com", "Aca", 9_000_000, 5_000_000),
    ],
  };

  // April: 10,5jt disetor, 2jt dibelanjakan.
  assert.equal(itemOf(summaryOf(store, "2026-04").result, "balance").value, 8_500_000);

  // Mei membelanjakan Rp 5jt atas setoran Rp 1,05jt — selisih bulannya −3,95jt, tapi saldonya
  // 8,5jt + 1,05jt − 5jt. Yang dipakai memang sisa April, dan itu yang harus terbaca.
  const mei = summaryOf(store, "2026-05");
  assert.equal(itemOf(mei.inflow, "topup").value, 1_050_000);
  assert.equal(itemOf(mei.outflow, "spending").value, 5_000_000);
  assert.equal(itemOf(mei.result, "balance").value, 4_550_000);
});

test("saldo berjalan tetap butuh kedua sisinya", () => {
  const store = { ...CASH_STORE, whitelistTopup: [] };
  assert.equal(itemOf(summaryOf(store).result, "balance").value, "");

  // Bulan yang top-up-nya nol tapi bulan sebelumnya ada TETAP punya saldo: yang dihitung adalah
  // seluruh riwayat sampai bulan itu, bukan barisnya sendiri.
  const lanjutan = {
    ...CASH_STORE,
    whitelistTopup: [{ date: "2026-04-13", namaKode: "TBZ 1233", total: 5_000_000 }],
    roiReports: [
      adx("2026-04-10", "data.xiaomidriversdownload.com", "Aca", 5_000_000, 1_000_000),
      adx("2026-05-10", "data.xiaomidriversdownload.com", "Aca", 5_000_000, 1_000_000),
    ],
  };
  assert.equal(itemOf(summaryOf(lanjutan, "2026-05").inflow, "topup").value, "");
  assert.equal(itemOf(summaryOf(lanjutan, "2026-05").result, "balance").value, 3_000_000);
});

// --- akun yang ditutup Google ------------------------------------------------------------------

// Subdomain yang akun Google-nya ditutup tidak punya baris ROI dan tidak akan pernah punya:
// `reports:run` tidak menjawab lagi untuk network yang ditutup. Earning bulanannya diketik di
// `accountCloses`, lalu dilipat ke ember yang SAMA — supaya tarif Company bertanggal, pembagian
// invalid traffic, dan dasar bonus per PIC semuanya bekerja tanpa cabang perhitungan kedua.
test("earning yang diketik masuk sebagai baris biasa, berikut seluruh rantainya", () => {
  const store = {
    ...CASH_STORE,
    invalidTraffic: [
      {
        month: "2026-04",
        domain: "xiaomidriversdownload.com",
        accountType: "Ad-Exchanger",
        check1: 100_000,
      },
    ],
    roiReports: [],
    accountCloses: [
      {
        month: "2026-04",
        pic: "Aca",
        accountType: "Ad-Exchanger",
        subDomain: "pro.xiaomidriversdownload.com",
        earning: 8_000_000,
        totalSpending: 2_000_000,
      },
      {
        month: "2026-04",
        pic: "Aca",
        accountType: "Ad-Exchanger",
        subDomain: "dev.xiaomidriversdownload.com",
        earning: 2_000_000,
        totalSpending: 500_000,
      },
    ],
  };

  const report = buildCashFlow(store, bulan("2026-04"));
  const pro = rowOf(report, "pro.xiaomidriversdownload.com", "Ad-Exchanger");

  assert.equal(pro.earning, 8_000_000);
  assert.equal(pro.totalSpending, 2_000_000);
  // Tarif bertanggal domain itu, dicari pada tanggal 1 bulannya.
  assert.equal(pro.company, 800_000);
  // Invalid traffic domain dibagi menurut porsi earning: 8jt dari 10jt.
  assert.equal(pro.invalidTraffic, 80_000);
  assert.equal(pro.netProfit, 5_120_000);
  assert.equal(pro.bonus, 512_000); // tarif Aca 10%
  assert.equal(pro.netIncomeOwner, 4_608_000);
});

// AdSense tidak dipotong Company, dan baris ketikan MENYEBUTKAN jenis akunnya alih-alih dibelah
// `sourceSplit`. Dibelah, baris tanpa rincian sumber jatuh utuh ke Ad Exchange — dan baris AdSense
// akan berbunyi kena potongan yang tidak pernah ditagihkan.
test("jenis akun baris ketikan menentukan embernya, bukan rincian sumber earning", () => {
  const store = {
    ...CASH_STORE,
    invalidTraffic: [],
    roiReports: [],
    accountCloses: [
      {
        month: "2026-04",
        pic: "Aca",
        accountType: "Adsense",
        subDomain: "usb.xiaomidriversdownload.com",
        earning: 5_000_000,
        totalSpending: 800_000,
      },
    ],
  };

  const row = rowOf(buildCashFlow(store, bulan("2026-04")), "usb.xiaomidriversdownload.com", "Adsense");
  assert.equal(row.earning, 5_000_000);
  assert.equal(row.company, 0);
  assert.deepEqual(row.companyPercents, []);
  // Dan TIDAK ada ember Ad-Exchanger untuk subdomain itu.
  assert.equal(rowOf(buildCashFlow(store, bulan("2026-04")), "usb.xiaomidriversdownload.com", "Ad-Exchanger"), undefined);
});

// Yang menahan koleksi ini supaya tidak jadi pintu belakang untuk mengarang earning. Laporan yang
// masih bisa datang selalu menang — kebalikan dari `earningManual` di Invalid Traffic, dan sengaja:
// yang di sana ada karena laporannya belum lengkap, yang di sini karena laporannya tidak akan
// pernah ada.
test("baris ROI selalu menang: subdomain yang punya laporan mengabaikan ketikannya", () => {
  const store = {
    ...CASH_STORE,
    invalidTraffic: [],
    roiReports: [adx("2026-04-10", "data.xiaomidriversdownload.com", "Aca", 1_000_000, 100_000)],
    accountCloses: [
      {
        month: "2026-04",
        pic: "Aca",
        accountType: "Ad-Exchanger",
        subDomain: "data.xiaomidriversdownload.com",
        earning: 99_000_000,
        totalSpending: 0,
      },
    ],
  };

  const row = rowOf(buildCashFlow(store, bulan("2026-04")), "data.xiaomidriversdownload.com", "Ad-Exchanger");
  assert.equal(row.earning, 1_000_000);
});

test("baris ketikan bulan lain, tanpa subdomain, atau tanpa earning tidak ikut", () => {
  const store = {
    ...CASH_STORE,
    invalidTraffic: [],
    roiReports: [],
    accountCloses: [
      { month: "2026-03", pic: "Aca", subDomain: "a.xiaomidriversdownload.com", earning: 1_000_000 },
      { month: "2026-04", pic: "Aca", subDomain: "", earning: 1_000_000 },
      { month: "2026-04", pic: "Aca", subDomain: "b.xiaomidriversdownload.com", earning: 0 },
    ],
  };

  assert.equal(buildCashFlow(store, bulan("2026-04")).rows.length, 0);
});

// Dan inilah gunanya: dengan barisnya masuk, "Total Akun Close" tidak lagi berbunyi "-" untuk bulan
// yang menutup sebuah domain.
test("Total Akun Close terhitung dari baris ketikan, bukan lagi kosong", () => {
  const store = {
    ...CASH_STORE,
    invalidTraffic: [],
    roiReports: [],
    payouts: [{ month: "2026-04", domain: "xiaomidriversdownload.com", status: "Account Close" }],
    accountCloses: [
      {
        month: "2026-04",
        pic: "Aca",
        accountType: "Ad-Exchanger",
        subDomain: "pro.xiaomidriversdownload.com",
        earning: 10_000_000,
        totalSpending: 4_000_000,
      },
    ],
  };

  const report = buildCashFlow(store, bulan("2026-04"));
  const s = cashFlowSummary(store, bulan("2026-04"), report);
  const row = rowOf(report, "pro.xiaomidriversdownload.com", "Ad-Exchanger");

  assert.equal(itemOf(s.inflow, "earning").value, 10_000_000);
  // Saldo yang hangus: earning ketikan dikurangi Company 10%. Belanja iklannya TIDAK dikurangkan —
  // yang hangus adalah saldo yang belum sempat cair, bukan labanya.
  assert.equal(itemOf(s.outflow, "accountClose").value, 9_000_000);
  assert.equal(itemOf(s.outflow, "bonus").value, row.bonus);
});

// Nominal yang tidak punya ember untuk dibagi DIKEMBALIKAN, bukan hilang. Sampai 4 Sep 2026 ia
// jatuh tanpa suara: April 2026 berbunyi Rp 242.992 di Laba Rugi dan Rp 218.842 di sini, untuk uang
// yang sama — dan kartu di kepala halaman ini menjumlahkan nominal PENUH, jadi satu halaman memuat
// dua angka Invalid Traffic yang berbeda.
test("invalid traffic yang tidak punya ember dilaporkan sebagai sisa, bukan dijatuhkan", () => {
  const store = {
    domains: DOMAINS,
    subDomains: [
      { name: "flash.designingaround.com", parentDomain: "designingaround.com" },
    ],
    users: [{ name: "Aca", bonusPercent: 10 }],
    // Domainnya cuma menghasilkan lewat Ad Exchange bulan itu.
    roiReports: [adx("2026-04-10", "flash.designingaround.com", "Aca", 1_000_000, 200_000)],
    invalidTraffic: [
      { month: "2026-04", domain: "designingaround.com", accountType: "Ad-Exchanger", check1: 5000 },
      // Sisi AdSense domain yang sama, yang bulan itu tidak menghasilkan sepeser pun.
      { month: "2026-04", domain: "designingaround.com", accountType: "Adsense", check1: 24150 },
    ],
  };

  const report = buildCashFlow(store, bulan("2026-04"));

  assert.equal(report.totals.invalidTraffic, 5000, "yang punya ember tetap terbagi");
  assert.equal(report.totals.invalidTrafficUnspread, 24150, "sisanya disebutkan, bukan hilang");
  // Kartu di kepala halaman menjumlahkan nominal penuh — dan kedua angka itu sekarang bisa
  // dijelaskan satu sama lain.
  const summary = cashFlowSummary(store, bulan("2026-04"), report);
  assert.equal(
    itemOf(summary.outflow, "traffic").value,
    report.totals.invalidTraffic + report.totals.invalidTrafficUnspread,
  );
});

// Yang TIDAK boleh terjadi: memindahkannya ke jenis akun lain di domain yang sama. Clawback atas
// pendapatan AdSense yang dibebankan ke ember Ad Exchange mengurangi dasar bonus advertiser yang
// tidak ada hubungannya dengan uang itu — cerminan tes bernama sama di profitLoss.test.mjs.
test("sisa itu tidak dipindahkan ke jenis akun lain di domain yang sama", () => {
  const store = {
    domains: DOMAINS,
    subDomains: [{ name: "flash.designingaround.com", parentDomain: "designingaround.com" }],
    users: [{ name: "Aca", bonusPercent: 10 }],
    roiReports: [adx("2026-04-10", "flash.designingaround.com", "Aca", 1_000_000, 200_000)],
    invalidTraffic: [
      { month: "2026-04", domain: "designingaround.com", accountType: "Adsense", check1: 24150 },
    ],
  };

  const row = rowOf(buildCashFlow(store, bulan("2026-04")), "flash.designingaround.com", "Ad-Exchanger");

  assert.equal(row.invalidTraffic, 0);
  assert.equal(row.netProfit, 800_000, "dasar bonusnya tidak tersentuh clawback sisi lain");
});
