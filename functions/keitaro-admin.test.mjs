import assert from "node:assert/strict";
import { test } from "node:test";
import {
  campaignCode,
  campaignNameFor,
  keitaroNamePrefix,
  landingUrlComplaint,
} from "./keitaro-admin.js";

test("awalan bawaan = PIC huruf besar + T2 (WL); PIC kosong = kosong", () => {
  assert.equal(keitaroNamePrefix("Aca"), "ACA T2 (WL)");
  assert.equal(keitaroNamePrefix("  nurjaman "), "NURJAMAN T2 (WL)");
  assert.equal(keitaroNamePrefix(""), "");
  assert.equal(keitaroNamePrefix(undefined), "");
});

test("kode = 4 karakter terakhir alias", () => {
  assert.equal(campaignCode("gmBdXw"), "BdXw");
  assert.equal(campaignCode("wx7S1mRH"), "1mRH");
});

test("nama campaign berkode dan berhostname di ekor", () => {
  assert.equal(campaignNameFor("ACA T2 (WL)", "1mRH", "a.b.com"), "ACA T2 (WL) 1mRH (a.b.com)");
  assert.equal(campaignNameFor("", "1mRH", "a.b.com"), "1mRH (a.b.com)");
});

test("URL landing wajib https di hostname subdomain itu", () => {
  assert.equal(landingUrlComplaint("https://a.b.com/x?k=v", "a.b.com"), "");
  assert.match(landingUrlComplaint("http://a.b.com/x", "a.b.com"), /https/);
  assert.match(landingUrlComplaint("https://evil.com/x", "a.b.com"), /harus di a\.b\.com/);
  assert.match(landingUrlComplaint("bukan url", "a.b.com"), /tidak terbaca/);
});
