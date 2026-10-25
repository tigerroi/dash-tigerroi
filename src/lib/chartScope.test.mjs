import assert from "node:assert/strict";
import test from "node:test";
import { monthCoverage } from "./chartScope.js";

test("selisih cakupan dihitung dari hari-hari milik bulan itu saja", () => {
  const points = [
    { date: "2026-07-31", grossRevenue: 5_000_000 },
    { date: "2026-08-01", grossRevenue: 1_000_000 },
    { date: "2026-08-02", grossRevenue: 1_000_000 },
  ];

  const coverage = monthCoverage(points, "2026-08", 1_500_000);
  assert.equal(coverage.business, 2_000_000);
  assert.equal(coverage.gap, 500_000, "31 Juli tidak ikut menambah selisih Agustus");
});

test("bulan yang tidak dijangkau weeklyFinancials tidak melaporkan selisih", () => {
  // Riwayat harian jauh lebih panjang daripada jendela isian ulang grafik. Nol di sana berarti
  // "tidak ada yang membacanya", bukan "seluruh pendapatan bulan itu di luar cakupan".
  assert.equal(monthCoverage([{ date: "2026-08-01", grossRevenue: 100 }], "2026-06", 0), null);
  assert.equal(monthCoverage([], "2026-08", 1_000), null);
});

test("earning kalender yang tidak diketahui tidak bisa dikurangkan", () => {
  const points = [{ date: "2026-08-01", grossRevenue: 1_000_000 }];
  assert.equal(monthCoverage(points, "2026-08", ""), null);
  assert.equal(monthCoverage(points, "", 0), null);
});

// Pembulatan dua desimal di kedua sisi selalu menyisakan beberapa rupiah, dan peringatan yang
// menyala untuk itu berhenti dibaca sebelum sempat berguna.
test("selisih di bawah 1% pendapatan usaha tidak digambar", () => {
  const points = [{ date: "2026-08-01", grossRevenue: 1_000_000 }];
  assert.equal(monthCoverage(points, "2026-08", 999_995), null);
  assert.equal(monthCoverage(points, "2026-08", 980_000).gap, 20_000);
  // Kalender yang justru lebih besar (baris ROI menjangkau lebih jauh ke belakang daripada
  // weeklyFinancials) bukan "di luar cakupan" — dan angka negatif di lencana itu tidak menjawab apa
  // pun.
  assert.equal(monthCoverage(points, "2026-08", 1_200_000), null);
});
