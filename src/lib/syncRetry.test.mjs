import assert from "node:assert/strict";
import { anyRetryRunning, retryEntries, retryStatus } from "./syncRetry.js";

const now = new Date("2026-08-22T12:00:00.000Z");
const antrean = (extra) => ({
  s1: { name: "fitness.stylefemale.com", message: "db down", attempts: 1, ...extra },
});

// Tidak ada antrean = tidak ada kalimat. Bukan "tidak akan dicoba lagi": sync penuh berikutnya tetap
// mencoba semuanya, dan janji yang salah membuat orang menunggu sesuatu yang tidak datang.
assert.equal(retryStatus(null, now), null);
assert.equal(retryStatus({}, now), null);

const menunggu = retryStatus(antrean({ nextAt: "2026-08-22T12:04:00.000Z" }), now);
assert.equal(menunggu.running, false);
assert.match(menunggu.label, /Percobaan 2 dari 5 dalam 4 menit/);
assert.equal(menunggu.targets, "fitness.stylefemale.com");

// Jadwal yang sudah lewat (siklusnya tersendat) tidak boleh berbunyi negatif.
assert.match(
  retryStatus(antrean({ nextAt: "2026-08-22T11:58:00.000Z" }), now).label,
  /sebentar lagi/,
);

const berjalan = retryStatus(antrean({ nextAt: "2026-08-22T11:58:00.000Z", running: true }), now);
assert.equal(berjalan.running, true);
assert.match(berjalan.label, /Mencoba lagi sekarang — percobaan 2 dari 5/);

// Cabang dengan banyak antrean: yang disebut adalah percobaan TERDEKAT, dan namanya dipotong supaya
// kalimat statusnya tetap terbaca.
const banyak = Object.fromEntries(
  Array.from({ length: 5 }, (_, index) => [
    `s${index}`,
    { name: `situs${index}`, attempts: index, nextAt: `2026-08-22T12:0${index + 1}:00.000Z` },
  ]),
);
assert.equal(retryEntries(banyak).length, 5);
const status = retryStatus(banyak, now);
assert.match(status.label, /Percobaan 1 dari 5 dalam 1 menit/);
assert.equal(status.targets, "situs0, situs1, situs2 +2 lagi");

assert.equal(anyRetryRunning({ a: antrean({}), b: antrean({ running: true }) }), true);
assert.equal(anyRetryRunning({ a: antrean({}) }), false);
assert.equal(anyRetryRunning(null), false);

console.log("syncRetry tests ok");
