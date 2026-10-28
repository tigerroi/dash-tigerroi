import assert from "node:assert/strict";
import { PLUGIN_ISSUES_BRANCH } from "./plugin-core.js";
import { MAX_SYNC_RETRIES, nextRetryAt, SYNC_RETRY_PATH } from "./sync-core.js";
import { retryPluginIssues } from "./sync-plugin.mjs";

// Store palsu seadanya: yang diuji di sini adalah GERBANG-nya — kapan sebuah percobaan ulang TIDAK
// dijalankan. Yang lolos gerbang menghubungi situs sungguhan, dan itu bukan yang bisa dibuktikan
// sebuah unit test.
function fakeStore(branch) {
  const writes = [];
  return {
    writes,
    read: async (path) => (path === `${SYNC_RETRY_PATH}/${PLUGIN_ISSUES_BRANCH}` ? branch : null),
    replace: async (path, value) => writes.push({ path, value }),
    update: async (path, values) => writes.push({ path, values }),
  };
}

const now = new Date("2026-08-22T12:00:00.000Z");
const entry = (extra) => ({
  s1: { name: "fitness.stylefemale.com", message: "db down", attempts: 0, ...extra },
});

// Antreannya kosong — cabangnya bahkan belum pernah ditulis.
let store = fakeStore(null);
assert.deepEqual(await retryPluginIssues(store, now), { retried: 0, skipped: true });
assert.equal(store.writes.length, 0, "yang dilewati tidak menulis apa pun");

// Belum jatuh tempo.
store = fakeStore(entry({ nextAt: nextRetryAt(0, now) }));
assert.equal((await retryPluginIssues(store, now)).skipped, true);
assert.equal(store.writes.length, 0);

// Percobaan sebelumnya masih berjalan — siklus semenit berikutnya tidak boleh masuk ke percobaan
// yang sama, walau jadwalnya sudah lewat.
store = fakeStore(entry({ nextAt: "2026-08-22T11:00:00.000Z", running: true }));
assert.equal((await retryPluginIssues(store, now)).skipped, true);
assert.equal(store.writes.length, 0);

// Jatah habis: yang mencoba lagi adalah sweep penuh berikutnya, bukan siklus ini.
store = fakeStore(entry({ nextAt: "2026-08-22T11:00:00.000Z", attempts: MAX_SYNC_RETRIES }));
assert.equal((await retryPluginIssues(store, now)).skipped, true);
assert.equal(store.writes.length, 0);

console.log("sync-plugin percobaan ulang tests ok");
