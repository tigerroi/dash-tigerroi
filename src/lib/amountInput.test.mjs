import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { digitsOnly, formatAmountInput } from "./amountInput.js";

describe("formatAmountInput", () => {
  test("angka yang diketik langsung bertitik", () => {
    assert.equal(formatAmountInput("500000"), "500.000");
    assert.equal(formatAmountInput("1500000"), "1.500.000");
    assert.equal(formatAmountInput("500"), "500");
  });

  test("kotak kosong tidak berubah jadi 0", () => {
    assert.equal(formatAmountInput(""), "");
    assert.equal(formatAmountInput(null), "");
    assert.equal(formatAmountInput(undefined), "");
  });

  test("nilai hitungan (Total/Fee) berupa number ikut diformat", () => {
    assert.equal(formatAmountInput(525000), "525.000");
    assert.equal(formatAmountInput(0), "0", "Total sebelum Nominal diisi tetap 0, seperti dulu");
    assert.equal(formatAmountInput(25000.4), "25.000", "fee 5% yang berkoma dibulatkan");
  });

  test("titik dari tampilan tidak ikut tersimpan", () => {
    assert.equal(digitsOnly("500.000"), "500000");
    assert.equal(digitsOnly("Rp 1.500.000"), "1500000");
    assert.equal(digitsOnly(""), "");
  });
});
