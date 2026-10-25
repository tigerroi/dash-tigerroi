import assert from "node:assert/strict";
import test from "node:test";
import { lowBalanceAdvertisers } from "./alerts.js";

const rows = [
  { pic: "A", balance: 50_000 },
  { pic: "B", balance: 2_000_000 },
  { pic: "C", balance: 0 },
  { pic: "D" },
];

test("saldo di bawah ambang disebut, tertipis dulu", () => {
  const out = lowBalanceAdvertisers(rows, { balanceThreshold: 100_000 });
  assert.deepEqual(out.map((row) => row.pic), ["C", "A"]);
});

test("ambang kosong jatuh ke bawaan, bukan nol", () => {
  assert.deepEqual(lowBalanceAdvertisers(rows, { balanceThreshold: "" }).map((r) => r.pic), ["C", "A"]);
});

test("aturan lowBalance yang dimatikan juga mematikan peringatan layar", () => {
  assert.equal(lowBalanceAdvertisers(rows, { lowBalance: false }).length, 0);
});
