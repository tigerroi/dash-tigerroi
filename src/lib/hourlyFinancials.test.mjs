import assert from "node:assert/strict";
import { test } from "node:test";
import { hourlyFinancials } from "./hourlyFinancials.js";

test("menjumlahkan lintas subdomain per stempel, satu titik per stempel", () => {
  const rows = [
    { date: "2026-08-24", time: "09:00", subDomain: "a", spending: 100, earning: 500 },
    { date: "2026-08-24", time: "09:00", subDomain: "b", spending: 200, earning: 800 },
    { date: "2026-08-24", time: "15:00", subDomain: "a", spending: 150, earning: 900 },
  ];
  const points = hourlyFinancials(rows, 0); // rate 0 → totalSpending = spending

  // Dua stempel, bukan tiga baris — snapshot kumulatif tidak boleh menggandakan hari yang sama.
  assert.equal(points.length, 2);
  assert.equal(points[0].time, "09:00");
  assert.equal(points[0].grossRevenue, 1300); // 500 + 800
  assert.equal(points[0].totalSpend, 300); // 100 + 200
  assert.equal(points[1].grossRevenue, 900);
});

test("melewati earning/spend yang tidak diketahui, bukan menambahkan nol", () => {
  const rows = [{ date: "2026-08-24", time: "09:00", subDomain: "a", earning: 500 }]; // tanpa spending
  const points = hourlyFinancials(rows, 0);

  assert.equal(points[0].grossRevenue, 500);
  assert.equal(points[0].totalSpend, 0); // spend tak diketahui → tidak ditambahkan
});
