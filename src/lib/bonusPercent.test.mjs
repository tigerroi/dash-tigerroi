import assert from "node:assert/strict";
import { test } from "node:test";
import { bonusPercentIndex } from "./bonusPercent.js";

const users = [
  { name: "Nur", bonusPercent: 10 },
  { name: "Aca", bonusPercent: 15 },
];

test("tarif mengikuti bulan berlakunya, dan bulan lampau tetap tarif lamanya", () => {
  const percentAt = bonusPercentIndex(
    [{ user: "Nur", percent: 12, effectiveFrom: "2026-09-01" }],
    users,
  );

  assert.equal(percentAt("Nur", "2026-08-31"), 10, "sebelum baris pertama: users.bonusPercent");
  assert.equal(percentAt("nur", "2026-09-30"), 12, "dicocokkan tanpa memandang kapitalisasi");
  assert.equal(percentAt("Aca", "2026-09-30"), 15, "tanpa baris: persis seperti sebelumnya");
  assert.equal(percentAt("Siapa", "2026-09-30"), null);
});

test("baris bertarif kosong berarti berhenti dapat bonus, bukan kembali ke tarif lama", () => {
  const percentAt = bonusPercentIndex(
    [{ user: "Nur", percent: "", effectiveFrom: "2026-10-01" }],
    users,
  );
  assert.equal(percentAt("Nur", "2026-10-15"), null);
  assert.equal(percentAt("Nur", "2026-09-15"), 10);
});
