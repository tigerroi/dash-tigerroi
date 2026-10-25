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

test("profit & ROI memakai ER − pembagi, diurutkan Profit Founder tertinggi", () => {
  const report = buildFounderRoi({
    roiReports: rows(),
    adAccounts,
    range,
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
    whitelistTopup: [{ date: "2026-08-01", pic: "Godek", nominal: 1000000 }],
  });
  const [godek] = report.rows;
  assert.equal(godek.earning, "");
  assert.equal(godek.roiFounder, "");
  assert.equal(godek.roiAdvertiser, "");
  assert.equal(godek.profitFounder, "");
  assert.equal(godek.profitAdvertiser, "");
});
