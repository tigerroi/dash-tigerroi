import assert from "node:assert/strict";
import test from "node:test";
import { buildFounderRoi } from "./founderRoi.js";

const range = { from: "2026-08-01", to: "2026-08-31" };
const adAccounts = [
  { name: "Akun Godek", userOwner: "Godek", balance: 500000 },
  { name: "Akun Nur", userOwner: "Nur", balance: 250000 },
  { name: "Akun Aca", userOwner: "Aca" },
];

function rows() {
  return [
    { date: "2026-08-02", pic: "Godek", earning: 3000000, spending: 1000000, totalSpending: 1000000 },
    { date: "2026-08-02", pic: "Nur", earning: 6000000, spending: 2000000, totalSpending: 2000000 },
    { date: "2026-08-03", pic: "Aca", earning: 900000, spending: 400000, totalSpending: 400000 },
  ];
}

test("profit & ROI memakai ER − pembagi, diurutkan Profit Founder tertinggi (mode advertiser)", () => {
  const report = buildFounderRoi({
    roiReports: rows(),
    adAccounts,
    range,
    mode: "advertiser",
    whitelistTopup: [
      { date: "2026-08-01", pic: "Godek", nominal: 1000000 },
      { date: "2026-08-01", pic: "Nur", nominal: 3000000 },
    ],
  });

  assert.deepEqual(
    report.rows.map((row) => row.name),
    ["Nur", "Godek", "Aca"],
  );
  const [nur, godek, aca] = report.rows;
  assert.equal(godek.roiFounder, 200);
  assert.equal(godek.roiAdvertiser, 200);
  assert.equal(godek.balance, 500000);
  assert.equal(godek.profitFounder, 2000000);
  assert.equal(godek.profitAdvertiser, 2000000);
  assert.equal(nur.profitFounder, 3000000);
  assert.equal(nur.profitAdvertiser, 4000000);
  assert.equal(nur.roiFounder, 100);
  assert.equal(nur.roiAdvertiser, 200);
  // Tanpa top-up: tidak ada ROI Founder, bukan −100% atau 0%.
  assert.equal(aca.topup, 0);
  assert.equal(aca.roiFounder, "");
  assert.equal(aca.roiAdvertiser, 125);
  // Profit tidak ikut lantai ROI: tanpa top-up, profit founder = earning.
  assert.equal(aca.profitFounder, 900000);

  assert.equal(report.totals.topup, 4000000);
  assert.equal(report.totals.earning, 9900000);
  assert.equal(report.totals.profitFounder, 5900000);
  assert.equal(report.totals.roiFounder, 147.5);
});

test("earning yang tidak diketahui tidak menghasilkan ROI", () => {
  const report = buildFounderRoi({
    roiReports: [{ date: "2026-08-02", pic: "Godek", spending: 1000000, totalSpending: 1000000 }],
    adAccounts,
    range,
    mode: "advertiser",
    whitelistTopup: [{ date: "2026-08-01", pic: "Godek", nominal: 1000000 }],
  });
  const [godek] = report.rows;
  assert.equal(godek.earning, "");
  assert.equal(godek.roiFounder, "");
  assert.equal(godek.roiAdvertiser, "");
  assert.equal(godek.profitFounder, "");
  assert.equal(godek.profitAdvertiser, "");
});

test("mode default menggabungkan metrik ke akun whitelist BD R 16 tanpa PIC", () => {
  const report = buildFounderRoi({
    roiReports: rows(),
    adAccounts: [{ name: "BD R 16", spendCap: 5000000, amountSpent: 2000000 }],
    range,
    whitelistTopup: [
      { date: "2026-08-01", nominal: 2000 },
    ],
  });

  assert.equal(report.rows.length, 1);
  const [wl] = report.rows;
  assert.equal(wl.name, "BD R 16");
  assert.equal(wl.topup, 2000);
  assert.equal(wl.totalSpending, 3400000); // 1000000 + 2000000 + 400000
  assert.equal(wl.earning, 9900000); // 3000000 + 6000000 + 900000
  assert.equal(wl.profitAdvertiser, 6500000);
  assert.equal(wl.profitFounder, 9898000);
  assert.equal(wl.roiFounder, 494900); // ((9900000 - 2000) / 2000) * 100
});

test("mode default menghitung persentase roiFounder dengan angka riil topup dan earning", () => {
  const report = buildFounderRoi({
    roiReports: [
      { date: "2026-11-02", pic: "Godek", earning: 30148405, spending: 5967258, totalSpending: 5967258 },
    ],
    adAccounts: [{ name: "BD R 16", balance: 8778619 }],
    range: { from: "2026-11-01", to: "2026-11-06" },
    whitelistTopup: [
      { date: "2026-11-01", nominal: 10000000 },
    ],
  });

  const [wl] = report.rows;
  assert.equal(wl.topup, 10000000);
  assert.equal(wl.earning, 30148405);
  assert.equal(wl.profitFounder, 20148405);
  assert.equal(wl.roiFounder, 201.48); // +201.48%
});

test("mode default menampilkan semua akun whitelist saat ada beberapa akun (misal BD Q 07 dan BD R 16)", () => {
  const report = buildFounderRoi({
    roiReports: [
      { date: "2026-11-02", subDomain: "freelance.workmoney24.com", earning: 0, spending: 0, totalSpending: 0 },
      { date: "2026-11-02", subDomain: "trayedit.com", earning: 5000000, spending: 1000000, totalSpending: 1000000 },
    ],
    adAccounts: [
      { name: "BD Q 07", balance: 8000000 },
      { name: "BD R 16", balance: 2462000 },
    ],
    users: [
      {
        id: "u1",
        name: "Sullivan",
        campaigns: [
          { subDomain: "freelance.workmoney24.com", account: "BD Q 07" },
          { subDomain: "trayedit.com", account: "BD R 16" },
        ],
      },
    ],
    range: { from: "2026-11-01", to: "2026-11-09" },
    whitelistTopup: [
      { date: "2026-11-01", namaKode: "BD R 16", nominal: 20000000 },
    ],
  });

  assert.equal(report.rows.length, 2);
  const [q07, r16] = report.rows;
  assert.equal(q07.name, "BD Q 07");
  assert.equal(q07.balance, 8000000);
  assert.equal(q07.topup, 0);
  assert.equal(q07.totalSpending, 0);

  assert.equal(r16.name, "BD R 16");
  assert.equal(r16.balance, 2462000);
  assert.equal(r16.topup, 20000000);
  assert.equal(r16.totalSpending, 1000000);
  assert.equal(r16.earning, 5000000);
  assert.equal(r16.profitFounder, -15000000);

  assert.equal(report.totals.topup, 20000000);
  assert.equal(report.totals.totalSpending, 1000000);
  assert.equal(report.totals.earning, 5000000);
  assert.equal(report.totals.balance, 10462000);
});

test("mode default mendistribusikan spending & earning secara proporsional jika 1 subdomain menggunakan 2 akun WL", () => {
  const report = buildFounderRoi({
    roiReports: [
      {
        date: "2026-11-02",
        subDomain: "freelance.workmoney24.com",
        earning: 10000000,
        spending: 5000000,
        totalSpending: 5000000,
      },
    ],
    adAccounts: [
      { name: "BD Q 07", balance: 8000000 },
      { name: "BD R 16", balance: 2462000 },
    ],
    users: [
      {
        id: "u1",
        name: "Sullivan",
        campaigns: [
          // BD Q 07 spend 2.000.000 (40%), BD R 16 spend 3.000.000 (60%)
          { subDomain: "freelance.workmoney24.com", account: "BD Q 07", spendToday: 2000000 },
          { subDomain: "freelance.workmoney24.com", account: "BD R 16", spendToday: 3000000 },
        ],
      },
    ],
    range: { from: "2026-11-01", to: "2026-11-09" },
    whitelistTopup: [
      { date: "2026-11-01", namaKode: "BD Q 07", nominal: 5000000 },
      { date: "2026-11-01", namaKode: "BD R 16", nominal: 10000000 },
    ],
  });

  assert.equal(report.rows.length, 2);
  const [q07, r16] = report.rows;

  // BD Q 07 mendapat 40% (2/5)
  assert.equal(q07.name, "BD Q 07");
  assert.equal(q07.topup, 5000000);
  assert.equal(q07.totalSpending, 2000000);
  assert.equal(q07.earning, 4000000);
  assert.equal(q07.profitFounder, -1000000); // 4jt - 5jt

  // BD R 16 mendapat 60% (3/5)
  assert.equal(r16.name, "BD R 16");
  assert.equal(r16.topup, 10000000);
  assert.equal(r16.totalSpending, 3000000);
  assert.equal(r16.earning, 6000000);
  assert.equal(r16.profitFounder, -4000000); // 6jt - 10jt

  // Total terakumulasi utuh 100%
  assert.equal(report.totals.topup, 15000000);
  assert.equal(report.totals.totalSpending, 5000000);
  assert.equal(report.totals.earning, 10000000);
});
