import assert from "node:assert/strict";
import test from "node:test";
import { advertiserRoiSeries, NO_PIC_LABEL } from "./advertiserRoiSeries.js";

const rows = [
  { date: "2026-08-22", subDomain: "trends.a.com", pic: "Aca", spending: 100_000, earning: 400_000 },
  { date: "2026-08-22", subDomain: "shoes.a.com", pic: "Aca", spending: 100_000, earning: 100_000 },
  { date: "2026-08-23", subDomain: "trends.a.com", pic: "Aca", spending: 200_000, earning: 300_000 },
  { date: "2026-08-23", subDomain: "x.b.com", pic: "Nur", spending: 50_000, earning: 150_000 },
];

test("satu titik per hari, uang subdomain dijumlahkan ke advertisernya", () => {
  const { series, points } = advertiserRoiSeries(rows, 0);

  assert.deepEqual(
    series.map((item) => [item.key, item.name]),
    [
      ["a0", "Aca"],
      ["a1", "Nur"],
    ],
  );
  assert.deepEqual(
    points.map((point) => point.date),
    ["2026-08-22", "2026-08-23"],
  );
  // 22 Agu: (500.000 − 200.000) / 200.000
  assert.equal(points[0].a0, 150);
  assert.equal(points[0].a0__spend, 200_000);
  // Nur belum punya baris 22 Agu: garisnya putus, bukan nol.
  assert.equal(points[0].a1, null);
  assert.equal(points[1].a0, 50);
});

test("PIC ditambal dari picOf, yang tanpa pemilik berdiri paling ujung", () => {
  const { series } = advertiserRoiSeries(
    [...rows, { date: "2026-08-22", subDomain: "lost.c.com", spending: 10_000, earning: 20_000 }],
    0,
    (name, pic) => pic || (name === "x.b.com" ? "Nur" : ""),
  );

  assert.equal(series.at(-1).name, NO_PIC_LABEL);
});

test("subdomain di bawah lantai belanja tetap menyumbang uangnya", () => {
  const { points } = advertiserRoiSeries(
    [
      { date: "2026-08-22", subDomain: "big.a.com", pic: "Aca", spending: 100_000, earning: 100_000 },
      { date: "2026-08-22", subDomain: "tiny.a.com", pic: "Aca", spending: 500, earning: 50_000 },
    ],
    0,
  );

  assert.equal(points[0].a0__earning, 150_000);
});

test("earning yang tidak diketahui tidak dihitung nol", () => {
  const { series, points } = advertiserRoiSeries(
    [{ date: "2026-08-22", subDomain: "t.a.com", pic: "Aca", spending: 100_000 }],
    0,
  );

  assert.equal(series.length, 0);
  assert.equal(points[0].a0, null);
});

test("ad tax ikut menaikkan penyebut", () => {
  const { points } = advertiserRoiSeries(
    [{ date: "2026-08-22", subDomain: "t.a.com", pic: "Aca", spending: 100_000, earning: 400_000 }],
    0.05,
  );

  assert.equal(points[0].a0__spend, 105_000);
  assert.equal(Math.round(points[0].a0), 281);
});
