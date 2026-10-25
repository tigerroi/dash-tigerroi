import assert from "node:assert/strict";
import test from "node:test";
import { siteKey } from "../../functions/fill-rate-core.js";
import {
  boundedRange,
  dashedSplit,
  decodeSiteKey,
  fillRateOwners,
  fillRateRows,
  fillRateSeries,
  formatRate,
  rateOf,
  siteTotals,
  slotLabel,
  wibTodayRange,
} from "./fillRate.js";
import { subDomainOwnerIndex } from "./subDomainOwners.js";

// Cermin sisi sync: kunci yang ditulis functions/ harus terbaca balik di sini.
test("decodeSiteKey membaca balik siteKey sisi sync", () => {
  assert.deepEqual(decodeSiteKey(siteKey("brands.stylefemale.com")), { host: "brands.stylefemale.com", netDomain: "" });
  assert.deepEqual(decodeSiteKey(siteKey("(Not applicable)", "stylefemale.com")), { host: "", netDomain: "stylefemale.com" });
  assert.deepEqual(decodeSiteKey(siteKey("", "", "23349918610")), { host: "", netDomain: "" });
});

const tree = {
  "2026-09-24": {
    "a,x,com": { h10: { req: 100, imp: 40 }, h11: { req: 50, imp: 45, partial: true } },
    "b,x,com": { h10: { req: 0, imp: 0 } },
    "_net_x,com": { h10: { req: 10, imp: 0 } },
  },
};

test("fillRateRows: jam tanpa awalan h, ember network berlabel", () => {
  const rows = fillRateRows(tree);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.find((r) => r.subDomain === "a.x.com" && r.hour === "11"), {
    date: "2026-09-24", hour: "11", subDomain: "a.x.com", netDomain: "", req: 50, imp: 45, partial: true,
  });
  assert.equal(rows.find((r) => r.netDomain === "x.com").subDomain, "(tanpa situs) x.com");
});

test("rateOf: permintaan 0 bukan 0% dan bukan Infinity", () => {
  assert.equal(rateOf(0, 0), null);
  assert.equal(rateOf(0, 5), null);
  assert.equal(rateOf(89949, 37713).toFixed(2), "41.93");
  assert.equal(formatRate(null), "-");
  assert.equal(formatRate(41.9265), "41,93%");
});

const owners = fillRateOwners(subDomainOwnerIndex([{ name: "a.x.com", parentDomain: "x.com", pic: "Aldi" }], [{ domainUrl: "x.com" }]));

test("fillRateOwners: ember network milik domainnya, tanpa PIC", () => {
  assert.equal(owners.domainOf("(tanpa situs) x.com"), "x.com");
  assert.equal(owners.picOf("(tanpa situs) x.com", ""), "");
  assert.equal(owners.domainOf("a.x.com"), "x.com");
});

test("fillRateSeries: domain = Σimp ÷ Σreq, bukan rata-rata rasio", () => {
  const { series, points } = fillRateSeries(fillRateRows(tree), owners, "domain");
  assert.deepEqual(series, [{ id: "s0", label: "x.com" }]);
  const h10 = points.find((p) => p.hour === "10");
  assert.equal(h10.s0Req, 110);
  assert.equal(h10.s0Imp, 40);
  assert.equal(h10.s0Rate.toFixed(2), "36.36");
  assert.equal(h10.totalRate.toFixed(2), "36.36");
  assert.equal(points.find((p) => p.hour === "11").partial, true);
  assert.deepEqual(points.map((p) => p.slot), ["2026-09-24T10", "2026-09-24T11"]);
});

test("fillRateSeries: lebih dari 8 rincian -> 8 teratas + Lainnya", () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({
    date: "2026-09-24", hour: "01", subDomain: `s${i}.x.com`, netDomain: "", req: 100 - i, imp: 10, partial: false,
  }));
  const { series, points } = fillRateSeries(rows, owners, "subDomain");
  assert.equal(series.length, 9);
  assert.equal(series[0].label, "s0.x.com");
  assert.equal(series[8].label, "Lainnya");
  assert.equal(points[0].s8Req, 92 + 91);
  assert.equal(points[0].s8Imp, 20);
});

test("dashedSplit: titik partial dan titik sebelumnya ikut ruas putus-putus", () => {
  const out = dashedSplit(
    [{ partial: false, v: 1 }, { partial: false, v: 2 }, { partial: true, v: 3 }],
    ["v"],
  );
  assert.deepEqual(out.map((p) => [p.vSolid, p.vDashed]), [[1, null], [2, 2], [null, 3]]);
});

test("siteTotals: situs belum terdaftar ditandai, ember network tidak", () => {
  const rows = siteTotals(fillRateRows(tree), owners, new Set(["a.x.com"]));
  assert.deepEqual(rows.map((r) => [r.subDomain, r.req, r.unregistered]), [
    ["a.x.com", 150, false],
    ["(tanpa situs) x.com", 10, false],
    ["b.x.com", 0, true],
  ]);
  assert.equal(rows[2].rate, null);
  assert.equal(rows[1].pic, "");
});

test("wibTodayRange memakai tanggal WIB, bukan jam perangkat", () => {
  assert.deepEqual(wibTodayRange(new Date("2026-09-23T17:30:00Z")), { from: "2026-09-24", to: "2026-09-24" });
});

test("boundedRange: rentang yang dikosongkan tidak pernah berarti seluruh riwayat", () => {
  const now = new Date("2026-09-24T06:00:00Z");
  assert.deepEqual(boundedRange({ from: "", to: "" }, now), { from: "2026-08-25", to: "2026-09-24" });
  assert.deepEqual(boundedRange({ from: "2026-09-01", to: "" }, now), { from: "2026-09-01", to: "2026-09-24" });
  assert.deepEqual(boundedRange({ from: "", to: "2026-09-10" }, now), { from: "2026-08-11", to: "2026-09-10" });
  assert.deepEqual(boundedRange({ from: "2026-09-20", to: "2026-09-22" }, now), { from: "2026-09-20", to: "2026-09-22" });
});

test("slotLabel: jam saja untuk satu hari, tanggal + jam untuk beberapa hari", () => {
  const point = { date: "2026-09-24", hour: "13" };
  assert.equal(slotLabel(point, false), "13:00");
  assert.equal(slotLabel(point, true), "24 Sep 13:00");
});
