import assert from "node:assert/strict";
import test from "node:test";
import { syncProgress } from "./syncProgress.js";

test("tahap yang selesai jadi persen", () => {
  assert.deepEqual(syncProgress({ progress: { done: 1, total: 10, stage: "ROI" } }), {
    done: 1,
    total: 10,
    percent: 10,
    stage: "ROI",
  });
});

test("dibulatkan ke bawah — tahap terakhir yang belum mulai bukan 100%", () => {
  assert.equal(syncProgress({ progress: { done: 7, total: 8 } }).percent, 87);
  assert.equal(syncProgress({ progress: { done: 8, total: 8 } }).percent, 100);
});

test("tanpa progress: null, bukan 0% — run sync versi lama tidak menulisnya", () => {
  assert.equal(syncProgress({ running: true }), null);
  assert.equal(syncProgress(null), null);
  assert.equal(syncProgress({ progress: { done: 2 } }), null);
  assert.equal(syncProgress({ progress: { done: 2, total: 0 } }), null);
  assert.equal(syncProgress({ progress: { done: "dua", total: 8 } }), null);
});

test("done dijepit ke total, dan awal run tetap 0%", () => {
  assert.equal(syncProgress({ progress: { done: 9, total: 8 } }).percent, 100);
  assert.equal(syncProgress({ progress: { done: 9, total: 8 } }).done, 8);
  assert.equal(syncProgress({ progress: { done: 0, total: 8 } }).percent, 0);
});

test("nama tahap yang bukan teks tidak ikut ke layar", () => {
  assert.equal(syncProgress({ progress: { done: 1, total: 4, stage: 12 } }).stage, "");
});
