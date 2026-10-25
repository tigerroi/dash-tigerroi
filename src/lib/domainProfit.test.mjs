import assert from "node:assert/strict";
import test from "node:test";
import { buildDomainProfit } from "./domainProfit.js";
import { buildCashFlow, cashFlowTotals } from "./cashFlow.js";
import { monthRange } from "./dateRange.js";

// Bulan PENUH sebagai rentang — bentuk yang dipakai halaman ini sebagai bawaan. `now` yang jauh di
// depan dioper supaya `monthRange` tidak memotong bulan berjalan di hari mesin menjalankan tes.
const bulan = (key) => monthRange(key, new Date(2030, 0, 1));

function adx(date, subDomain, pic, earning, totalSpending) {
  return { date, subDomain, pic, earning, totalSpending, adxRevenue: earning, adsenseRevenue: 0 };
}

const STORE = {
  domains: [{ domainUrl: "stylefemale.com" }, { domainUrl: "designingaround.com" }],
  subDomains: [
    { name: "trends.stylefemale.com", parentDomain: "stylefemale.com" },
    { name: "shoes.stylefemale.com", parentDomain: "stylefemale.com" },
    { name: "wealth.designingaround.com", parentDomain: "designingaround.com" },
  ],
  companyPercents: [{ domain: "stylefemale.com", effectiveFrom: "2026-01-01", percent: 10 }],
  users: [
    { name: "Nurjaman", bonusPercent: 15 },
    { name: "Aca", bonusPercent: 10 },
  ],
  roiReports: [
    adx("2026-06-10", "trends.stylefemale.com", "Nurjaman", 10_000_000, 2_000_000),
    adx("2026-06-11", "shoes.stylefemale.com", "Aca", 6_000_000, 1_000_000),
    adx("2026-06-12", "wealth.designingaround.com", "Aca", 4_000_000, 1_500_000),
  ],
};

const domainOf = (report, name) => report.rows.find((row) => row.domain === name);

test("satu baris per domain, dijumlah dari baris subdomain penyusunnya", () => {
  const report = buildDomainProfit(STORE, bulan("2026-06"));

  assert.deepEqual(
    report.rows.map((row) => row.domain),
    ["stylefemale.com", "designingaround.com"],
  );

  const style = domainOf(report, "stylefemale.com");
  assert.equal(style.earning, 16_000_000);
  assert.equal(style.totalSpending, 3_000_000);
  // Dua subdomain, dua PIC — dan itu yang membuat kolom Bonus tidak bisa dihitung dari agregat ini.
  assert.deepEqual(style.pics.sort(), ["Aca", "Nurjaman"]);
  assert.equal(style.subDomains, 2);
  assert.deepEqual(style.companyPercents, [10]);
  assert.equal(style.company, 1_600_000); // 10% dari earning Ad Exchange domain itu
});

test("ROI baris domain dari JUMLAH uangnya, bukan rata-rata ROI subdomainnya", () => {
  const report = buildDomainProfit(STORE, bulan("2026-06"));
  const style = domainOf(report, "stylefemale.com");

  // trends 400%, shoes 500% — rata-ratanya 450%, dan itu BUKAN jawabannya.
  assert.equal(style.roi, 433.33); // (16.000.000 − 3.000.000) / 3.000.000
});

test("bonus dijumlah dari baris, jadi domain berpemilik dua orang memakai dua tarif", () => {
  const report = buildDomainProfit(STORE, bulan("2026-06"));
  const style = domainOf(report, "stylefemale.com");
  const rows = buildCashFlow(STORE, bulan("2026-06")).rows.filter(
    (row) => row.domain === "stylefemale.com",
  );

  assert.equal(style.bonus, cashFlowTotals(rows).bonus);
  // Dua tarif yang benar-benar dipakai, bukan satu yang dipilih mewakili keduanya.
  assert.deepEqual(style.bonusPercents, [10, 15]);
});

test("total halaman ini sama persis dengan total tab Cash Flow bulan yang sama", () => {
  const report = buildDomainProfit(STORE, bulan("2026-06"));
  const cashFlow = buildCashFlow(STORE, bulan("2026-06"));

  for (const key of ["earning", "totalSpending", "company", "netProfit", "bonus", "operatingExpense"]) {
    assert.equal(report.totals[key], cashFlow.totals[key], key);
  }
});

test("Net Income Owner dikurangi Biaya Operasional, sepola sheet Rekap % Advertiser", () => {
  const juli = (row) => ({ ...row, date: row.date.replace("2026-06", "2026-07") });
  const store = {
    ...STORE,
    roiReports: STORE.roiReports.map(juli),
    expenses: [{ date: "2026-07-05", nominal: 2_000_000, qty: 1 }],
  };
  const report = buildDomainProfit(store, bulan("2026-07"));
  const cashFlow = buildCashFlow(store, bulan("2026-07"));

  assert.equal(report.totals.operatingExpense, 2_000_000);
  assert.equal(
    report.totals.netIncomeOwner,
    report.totals.netProfit - report.totals.operatingExpense - report.totals.bonus,
  );
  assert.equal(
    report.totals.netIncomeOwner,
    cashFlow.totals.netIncomeOwner - cashFlow.totals.operatingExpense,
  );
});

test("penyaring advertiser bekerja SEBELUM pengelompokan — domain menyempit ke bagian orang itu", () => {
  const report = buildDomainProfit(STORE, bulan("2026-06"), { pic: "Aca" });
  const style = domainOf(report, "stylefemale.com");

  assert.equal(style.earning, 6_000_000); // hanya shoes, bukan seluruh domain
  assert.deepEqual(style.pics, ["Aca"]);
  // Pilihan dropdown tetap memuat semua nama bulan itu: diambil sebelum penyaringnya dipakai.
  assert.deepEqual(report.picOptions.sort(), ["Aca", "Nurjaman"]);
});

test("domain yang ditandai Account Close pindah ke tabelnya sendiri, tidak dibuang", () => {
  const store = {
    ...STORE,
    payouts: [{ month: "2026-06", domain: "designingaround.com", status: "Account Close" }],
  };
  const report = buildDomainProfit(store, bulan("2026-06"));

  assert.deepEqual(
    report.rows.map((row) => row.domain),
    ["stylefemale.com"],
  );
  assert.deepEqual(
    report.closedRows.map((row) => row.domain),
    ["designingaround.com"],
  );
  assert.equal(report.closedTotals.earning, 4_000_000);
  // Uangnya tidak hilang: kedua tabel bersama-sama masih berjumlah sebesar tab Cash Flow.
  assert.equal(
    report.totals.earning + report.closedTotals.earning,
    buildCashFlow(store, bulan("2026-06")).totals.earning,
  );
});

test("status pencairan LAIN tidak memindahkan domainnya", () => {
  const store = {
    ...STORE,
    payouts: [{ month: "2026-06", domain: "designingaround.com", status: "Sudah Cair" }],
  };
  const report = buildDomainProfit(store, bulan("2026-06"));

  assert.equal(report.closedRows.length, 0);
  assert.equal(report.rows.length, 2);
});

test("penutupan di BULAN LAIN tidak memindahkan domainnya di bulan ini", () => {
  const store = {
    ...STORE,
    payouts: [{ month: "2026-05", domain: "designingaround.com", status: "Account Close" }],
  };

  assert.equal(buildDomainProfit(store, bulan("2026-06")).closedRows.length, 0);
});

test("bulan tanpa satu pun baris menghasilkan tabel kosong, bukan baris nol", () => {
  const report = buildDomainProfit(STORE, bulan("2026-07"));

  assert.deepEqual(report.rows, []);
  assert.deepEqual(report.closedRows, []);
  assert.equal(report.totals.earning, 0);
});
