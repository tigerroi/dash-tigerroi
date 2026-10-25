import assert from "node:assert/strict";
import test from "node:test";
import { fullSubDomain, shortSubDomain } from "./subDomainName.js";

test("nama subdomain pendek <-> penuh", () => {
  assert.equal(shortSubDomain("care.petcins.com", "https://petcins.com"), "care");
  assert.equal(shortSubDomain("x.other.com", "petcins.com"), "x.other.com");
  assert.equal(fullSubDomain("care", "petcins.com"), "care.petcins.com");
  assert.equal(fullSubDomain("a.b", "www.petcins.com/"), "a.b.petcins.com");
  assert.equal(fullSubDomain("care.petcins.com", "petcins.com"), "care.petcins.com");
  assert.equal(fullSubDomain("petcins.com", "petcins.com"), "petcins.com");
  // Baris lama yang tidak berakhiran domain induknya tidak berubah kalau namanya tidak disentuh.
  assert.equal(fullSubDomain("x.other.com", "petcins.com", "x.other.com"), "x.other.com");
  // Tapi domain induk yang diganti ikut memindahkan nama pendeknya.
  assert.equal(fullSubDomain("care", "masseffectstore.com", "care.petcins.com"), "care.masseffectstore.com");
});
