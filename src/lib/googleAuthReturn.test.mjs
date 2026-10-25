import assert from "node:assert/strict";
import test from "node:test";
import { googleAuthReturn } from "./googleAuthReturn.js";

test("alamat tanpa hasil consent tidak memunculkan apa-apa", () => {
  assert.equal(googleAuthReturn(""), null);
  assert.equal(googleAuthReturn("?page=2"), null);
});

test("berhasil menyebut kredensialnya, bukan 'Berhasil.'", () => {
  const res = googleAuthReturn("?googleAuth=ok&name=petcins.com");
  assert.equal(res.kind, "success");
  assert.match(res.message, /petcins\.com/);
});

// Yang paling menentukan di seluruh file ini: "tersimpan" bukan "berubah", dan sebuah toast hijau
// di sini adalah persis kegagalan yang membuat kredensial petcins.com berbulan-bulan terlihat
// terhubung dengan token yang tidak bisa membaca AdSense.
test("scope kurang berwarna kuning, bukan hijau dan bukan merah", () => {
  const res = googleAuthReturn("?googleAuth=partial&name=petcins.com&msg=izin%20AdSense%20tidak%20diberikan");
  assert.equal(res.kind, "warning");
  assert.match(res.detail, /AdSense/);
});

test("dibatalkan sendiri bukan kegagalan, dan menyebutkan tidak ada yang berubah", () => {
  const res = googleAuthReturn("?googleAuth=denied&name=petcins.com");
  assert.equal(res.kind, "warning");
  assert.match(res.message, /Tidak ada yang berubah/);
});

test("gagal menyebutkan token lama masih yang dipakai", () => {
  const res = googleAuthReturn("?googleAuth=failed&name=petcins.com&msg=invalid_grant");
  assert.equal(res.kind, "error");
  assert.match(res.message, /token lama/);
  assert.equal(res.detail, "invalid_grant");
});
