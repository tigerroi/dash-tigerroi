import assert from "node:assert/strict";
import test from "node:test";
import {
  addLeaves,
  changedLeaves,
  fillRateLeaves,
  fillRateWindow,
  flattenFillRate,
  networkStatusKey,
  siteKey,
} from "./fill-rate-core.js";

test("siteKey: hostname jadi kunci RTDB yang sah, yang bukan hostname masuk ember network", () => {
  assert.equal(siteKey("Brands.StyleFemale.com"), "brands,stylefemale,com");
  assert.equal(
    siteKey("(Not applicable)", "stylefemale.com", "23349918610"),
    "_net_stylefemale,com",
  );
  assert.equal(siteKey("", "", "23349918610"), "_net_23349918610");
  // Karakter yang ditolak RTDB tidak pernah sampai ke kunci.
  assert.doesNotMatch(siteKey("a#b$c/d[e]", "x.com"), /[.#$/[\]]/);
});

test("fillRateLeaves: kunci jam berawalan h, jam terakhir network bertanda partial", () => {
  const { leaves, lastSlot } = fillRateLeaves(
    [
      { date: "2026-09-24", hour: "10", site: "a.x.com", req: 100, imp: 40 },
      { date: "2026-09-24", hour: "11", site: "a.x.com", req: 50, imp: 30 },
      { date: "2026-09-24", hour: "11", site: "b.x.com", req: 10, imp: 9 },
      { date: "2026-09-23", hour: "23", site: "a.x.com", req: 5, imp: 1 },
    ],
    { domain: "x.com", code: "1" },
  );
  assert.equal(lastSlot, "2026-09-24T11");
  assert.deepEqual(leaves["2026-09-24/a,x,com/h10"], { req: 100, imp: 40 });
  assert.deepEqual(leaves["2026-09-24/a,x,com/h11"], { req: 50, imp: 30, partial: true });
  assert.deepEqual(leaves["2026-09-24/b,x,com/h11"], { req: 10, imp: 9, partial: true });
  assert.deepEqual(leaves["2026-09-23/a,x,com/h23"], { req: 5, imp: 1 });
});

test("fillRateLeaves: situs non-hostname di jam yang sama dijumlahkan ke satu ember", () => {
  const { leaves } = fillRateLeaves(
    [
      { date: "2026-09-24", hour: "01", site: "(Not applicable)", req: 3, imp: 0 },
      { date: "2026-09-24", hour: "01", site: "", req: 2, imp: 0 },
      { date: "2026-09-24", hour: "02", site: "a.x.com", req: 1, imp: 1 },
    ],
    { domain: "x.com", code: "1" },
  );
  assert.deepEqual(leaves["2026-09-24/_net_x,com/h01"], { req: 5, imp: 0 });
});

test("addLeaves menjumlahkan jalur yang sama dari dua network", () => {
  const target = { "d/a/h01": { req: 1, imp: 1 } };
  addLeaves(target, {
    "d/a/h01": { req: 2, imp: 1, partial: true },
    "d/b/h01": { req: 1, imp: 0 },
  });
  assert.deepEqual(target, {
    "d/a/h01": { req: 3, imp: 2, partial: true },
    "d/b/h01": { req: 1, imp: 0 },
  });
});

test("flattenFillRate meratakan pohon RTDB ke jalur daun", () => {
  assert.deepEqual(flattenFillRate({ "2026-09-24": { "a,x,com": { h05: { req: 1, imp: 1 } } } }), {
    "2026-09-24/a,x,com/h05": { req: 1, imp: 1 },
  });
  assert.deepEqual(flattenFillRate(null), {});
});

test("changedLeaves: yang sama tidak ditulis, partial yang hilang ditulis ulang tanpa tanda", () => {
  const previous = {
    "d/a/h10": { req: 1, imp: 1 },
    "d/a/h11": { req: 5, imp: 5, partial: true },
  };
  const next = {
    "d/a/h10": { req: 1, imp: 1 },
    "d/a/h11": { req: 9, imp: 6 },
    "d/a/h12": { req: 2, imp: 2, partial: true },
  };
  assert.deepEqual(changedLeaves(previous, next), {
    "d/a/h11": { req: 9, imp: 6 },
    "d/a/h12": { req: 2, imp: 2, partial: true },
  });
  // Angka sama, cuma tanda partial yang lepas: tetap ditulis.
  assert.deepEqual(
    changedLeaves(
      { "d/a/h11": { req: 9, imp: 6, partial: true } },
      { "d/a/h11": { req: 9, imp: 6 } },
    ),
    {
      "d/a/h11": { req: 9, imp: 6 },
    },
  );
  // Tanpa perubahan: objek kosong (pemanggil tidak menulis apa pun).
  assert.deepEqual(changedLeaves(next, next), {});
});

test("fillRateWindow: kemarin + hari ini menurut WIB", () => {
  // 24 Sep 2026 00:30 WIB = 23 Sep 17:30 UTC.
  const w = fillRateWindow(new Date("2026-09-23T17:30:00Z"));
  assert.equal(w.from, "2026-09-23");
  assert.equal(w.to, "2026-09-24");
  assert.deepEqual(w.range, {
    startDate: { year: 2026, month: 9, day: 23 },
    endDate: { year: 2026, month: 9, day: 24 },
  });
});

test("networkStatusKey berawalan huruf", () => {
  assert.equal(networkStatusKey("23349918610"), "n23349918610");
});
