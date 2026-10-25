import assert from "node:assert/strict";
import test from "node:test";
import { accountBalanceRows, publisherKey } from "./accountBalance.js";

test("publisherKey menyamakan bentuk GAM dan AdSense", () => {
  assert.equal(publisherKey("ca-pub-2520327538603736"), "pub-2520327538603736");
  assert.equal(publisherKey("pub-2520327538603736"), "pub-2520327538603736");
  assert.equal(publisherKey("accounts/pub-2520327538603736"), "pub-2520327538603736");
  assert.equal(publisherKey(""), "");
  assert.equal(publisherKey(null), "");
});

test("accountBalanceRows menandai baris yang publisher-nya berdiri di halaman seberang", () => {
  const gam = [
    { id: "g1", name: "petcins.com", publisherId: "ca-pub-2520327538603736" },
    { id: "g2", name: "theglobesimregistration.ph", publisherId: "ca-pub-9547980715118100" },
    { id: "g3", name: "belum diisi" },
  ];
  const adsense = [
    { id: "a1", name: "Dian ramadani", publisherId: "pub-2520327538603736" },
    { id: "a2", name: "Zohaib Anjum", publisherId: "pub-9547980715118100", deletedAt: 1 },
  ];
  const rows = accountBalanceRows(gam, adsense, "AdSense");
  assert.equal(rows[0].saldoShared, "Juga di AdSense");
  // Baris seberang yang sudah dihapus tidak menandai apa pun — angkanya cuma berdiri di satu tempat.
  assert.equal(rows[1].saldoShared, "");
  assert.equal(rows[2].saldoShared, "");
  // Baris aslinya tidak disentuh.
  assert.equal(rows[0].name, "petcins.com");
});

test("accountBalanceRows aman tanpa halaman seberang", () => {
  const rows = accountBalanceRows([{ id: "a", publisherId: "pub-1" }], undefined, "GAM");
  assert.equal(rows[0].saldoShared, "");
});
