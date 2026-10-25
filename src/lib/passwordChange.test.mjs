import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MIN_PASSWORD_LENGTH, validatePasswordChange } from "./passwordChange.js";

const valid = {
  currentPassword: "lama123",
  newPassword: "baru12345",
  confirmPassword: "baru12345",
};

describe("validatePasswordChange", () => {
  test("form yang lengkap dan konsisten tidak punya keluhan", () => {
    assert.equal(validatePasswordChange(valid), "");
  });

  test("password lama wajib — reauthenticate tidak bisa dijalankan tanpanya", () => {
    assert.match(validatePasswordChange({ ...valid, currentPassword: "" }), /lama/i);
  });

  test("panjang minimum sama dengan yang ditolak Firebase", () => {
    const short = "x".repeat(MIN_PASSWORD_LENGTH - 1);
    assert.match(
      validatePasswordChange({ ...valid, newPassword: short, confirmPassword: short }),
      new RegExp(String(MIN_PASSWORD_LENGTH)),
    );
    const exact = "x".repeat(MIN_PASSWORD_LENGTH);
    assert.equal(validatePasswordChange({ ...valid, newPassword: exact, confirmPassword: exact }), "");
  });

  test("password baru yang sama dengan yang lama ditolak di sini", () => {
    // Firebase menerimanya tanpa keluhan, dan form-nya akan berkata "berhasil" untuk akun yang
    // passwordnya tidak berubah sama sekali.
    assert.match(
      validatePasswordChange({
        currentPassword: "sama12345",
        newPassword: "sama12345",
        confirmPassword: "sama12345",
      }),
      /sama dengan yang lama/i,
    );
  });

  test("konfirmasi yang meleset ditahan sebelum menyentuh server", () => {
    assert.match(validatePasswordChange({ ...valid, confirmPassword: "baru12346" }), /konfirmasi/i);
  });

  test("urutan keluhan: yang paling awal diisi orang disebut lebih dulu", () => {
    // Form kosong harus menyebut password lama, bukan konfirmasi — keluhan tentang kotak terakhir
    // pada form yang belum disentuh mengirim orang ke ujung yang salah.
    assert.match(validatePasswordChange({}), /lama/i);
  });
});
