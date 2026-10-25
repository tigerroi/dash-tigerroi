import assert from "node:assert/strict";
import test from "node:test";
import { auditBadgeTone, auditDomains, auditSummary, chunk, parseIdList, sitesOfDomain } from "./pluginAudit.js";

const rows = [
  { id: "a", name: "care.petcins.com", parentDomain: "petcins.com", enrolled: true },
  { id: "b", name: "tips.petcins.com", parentDomain: "", enrolled: false },
  // Induknya disebut: tidak boleh ikut ke petcins.com walau akhirannya cocok.
  { id: "c", name: "x.shop.petcins.com", parentDomain: "shop.petcins.com", enrolled: true },
  { id: "d", name: "fitness.stylefemale.com", parentDomain: "https://stylefemale.com/", enrolled: true },
];

test("domain dari /domains dan dari parentDomain subdomain, tanpa kembar", () => {
  assert.deepEqual(auditDomains([{ domainUrl: "https://www.petcins.com" }, { domainUrl: "old.com", deletedAt: 1 }], rows), [
    "petcins.com",
    "shop.petcins.com",
    "stylefemale.com",
  ]);
});

test("subdomain sebuah domain: parentDomain menentukan, akhiran jadi cadangan", () => {
  assert.deepEqual(sitesOfDomain(rows, "petcins.com").map((row) => row.id), ["a", "b"]);
  assert.deepEqual(sitesOfDomain(rows, "stylefemale.com").map((row) => row.id), ["d"]);
  assert.deepEqual(sitesOfDomain(rows, ""), []);
});

test("daftar id alamat dan gelombang", () => {
  assert.deepEqual(parseIdList("a, b,,a"), ["a", "b"]);
  assert.deepEqual(chunk([1, 2, 3], 2), [[1, 2], [3]]);
});

test("ringkasan memisahkan belum terhubung, tidak terbaca, dan bermasalah", () => {
  const detail = (problems) => ({ status: "ok", detail: { problems } });
  const summary = auditSummary([
    { enrolled: true, result: detail(0) },
    { enrolled: true, result: detail(2) },
    { enrolled: true, result: { status: "failed", error: "x" } },
    { enrolled: false, result: null },
  ]);
  assert.deepEqual(summary, {
    total: 4,
    checked: 2,
    clean: 1,
    withProblems: 1,
    unreachable: 1,
    notEnrolled: 1,
  });
});

test("badge Kode Iklan berwarna per jenis, CMP per posisi", () => {
  assert.equal(auditBadgeTone("adCode", { status: "ok", type: "AdX" }), "info");
  assert.equal(auditBadgeTone("adCode", { status: "ok", type: "AdSense" }), "purple");
  assert.equal(auditBadgeTone("adCode", { status: "fail", type: "" }), "danger");
  assert.equal(auditBadgeTone("cmp", { status: "ok", label: "On" }), "success");
  assert.equal(auditBadgeTone("displayMode", { status: "ok", label: "Acak" }), "neutral");
  assert.equal(auditBadgeTone("cmp", { status: "warn", label: "Off" }), "warning");
});
