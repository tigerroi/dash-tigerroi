import assert from "node:assert/strict";
import { test } from "node:test";
import { SYNC_WARM_PATHS, WARM_PATHS, warmCache } from "./warm-cache.js";

test("melanggan tiap path sekali", () => {
  const seen = [];
  warmCache({}, { paths: ["users", "adAccounts"], subscribe: (_db, path) => seen.push(path) });
  assert.deepEqual(seen, ["users", "adAccounts"]);
});

test("path yang gagal dilanggan tidak menjatuhkan sisanya", () => {
  const seen = [];
  const errors = [];
  warmCache(
    {},
    {
      paths: ["users", "adAccounts", "subDomains"],
      subscribe: (_db, path) => {
        if (path === "adAccounts") throw new Error("ditolak");
        seen.push(path);
        return () => {};
      },
      onError: (path, error) => errors.push([path, error.message]),
    },
  );
  assert.deepEqual(seen, ["users", "subDomains"]);
  assert.deepEqual(errors, [["adAccounts", "ditolak"]]);
});

test("pencabut yang dikembalikan mencabut semuanya, dan melewati yang bukan fungsi", () => {
  let stopped = 0;
  const stop = warmCache(
    {},
    {
      paths: ["users", "adAccounts"],
      subscribe: (_db, path) => (path === "users" ? undefined : () => stopped++),
    },
  );
  assert.doesNotThrow(() => stop());
  assert.equal(stopped, 1);
});

test("users ada di kedua daftar bawaan — ia sendirian hampir seluruh tagihan download", () => {
  assert.ok(WARM_PATHS.includes("users"));
  assert.ok(SYNC_WARM_PATHS.includes("users"));
  // Node yang cuma dibaca saat ada orang menekan tombol tidak boleh ikut: langganan untuknya
  // menahan salinan di memori tanpa pernah menghemat satu unduhan pun.
  assert.ok(!WARM_PATHS.includes("pluginKeys"));
  assert.equal(new Set(WARM_PATHS).size, WARM_PATHS.length);
  assert.equal(new Set(SYNC_WARM_PATHS).size, SYNC_WARM_PATHS.length);
});

/**
 * Penghangat yang tidak pernah dicabut di dalam Cloud Function menjawab `get()` dari cache yang
 * bisa diam-diam berhenti diperbarui (CPU instance dicekik di luar request). Yang menjaganya cuma
 * `finally` di sync-run.mjs, dan sebuah `finally` yang hilang tidak berbunyi sebagai kesalahan
 * di mana pun — ia cuma menghasilkan angka yang basi.
 */
test("run sync penuh mencabut penghangatnya di finally", async () => {
  const source = await import("node:fs/promises").then((fs) =>
    fs.readFile(new URL("./sync-run.mjs", import.meta.url), "utf8"),
  );
  assert.match(source, /const stopWarmCache = warmCache\(/);
  assert.match(source, /\}\s*finally\s*\{\s*stopWarmCache\(\);\s*\}/);
});
