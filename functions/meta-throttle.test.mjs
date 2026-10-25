import assert from "node:assert";

// Knobs are read at import time. Kecil-kecil supaya tesnya cepat, perilakunya sama.
process.env.META_MINOR_UNIT = "100";
process.env.META_MIN_INTERVAL_MS = "50";
process.env.META_MAX_RETRIES = "2";
process.env.META_RETRY_BASE_MS = "10";
const { copyCampaignShell, fetchAccount, fetchCampaignSpend, retryDelay, setCampaignStatus } = await import("./meta.js");

const ok = (body, headers = {}) => ({
  ok: true,
  status: 200,
  headers: { get: (k) => headers[k.toLowerCase()] ?? null },
  text: async () => JSON.stringify(body),
});
const fail = (error) => ({
  ok: false,
  status: 400,
  headers: { get: () => null },
  text: async () => JSON.stringify({ error }),
});

// Panggilan berjarak minimum, dan tidak pernah dua-duanya jalan bersamaan — itu bentuk lalu
// lintas yang tidak terbaca sebagai ledakan.
let inFlight = 0;
const startedAt = [];
globalThis.fetch = async () => {
  inFlight++;
  assert.equal(inFlight, 1, "hanya satu request Graph pada satu waktu");
  startedAt.push(Date.now());
  await new Promise((r) => setTimeout(r, 5));
  inFlight--;
  return ok({ balance: "0", amount_spent: "0", data: [] });
};
await fetchAccount("act_1", "tok"); // 2 panggilan: fields + insights
await fetchCampaignSpend("act_1", "tok"); // 1 panggilan
assert.equal(startedAt.length, 3);
for (let i = 1; i < startedAt.length; i++) {
  // Ambang dilonggarkan sedikit: timer Node bangun beberapa ms lebih awal, dan tes yang
  // gagal acak lebih merepotkan daripada toleransi 5 ms.
  assert.ok(
    startedAt[i] - startedAt[i - 1] >= 45,
    `jarak antar panggilan ${startedAt[i] - startedAt[i - 1]}ms, harusnya >= 50ms`,
  );
}

// Rate limit (#17) transient: diulang, lalu berhasil.
let calls = 0;
globalThis.fetch = async () => {
  calls++;
  if (calls === 1) return fail({ message: "User request limit reached", code: 17 });
  return ok({ balance: "0", amount_spent: "0", spend_cap: "500", data: [] });
};
const retried = await fetchAccount("act_2", "tok");
assert.equal(retried.remaining, 5, "hasil setelah retry tetap terpakai");
assert.ok(calls >= 2, "panggilan yang kena limit diulang");

// Blokir app (#200) bukan transient: sekali coba, langsung menyerah. Mengulangnya hanya
// menambah beban ke app yang sudah bermasalah.
calls = 0;
globalThis.fetch = async () => {
  calls++;
  return fail({ message: "API access blocked.", code: 200 });
};
await assert.rejects(() => fetchAccount("act_3", "tok"), /API access blocked/);
assert.equal(calls, 1, "error permanen tidak diulang");

// Kalau limitnya tidak kunjung pulih, menyerah setelah MAX_RETRIES dan bilang kenapa.
calls = 0;
globalThis.fetch = async () => {
  calls++;
  return fail({ message: "User request limit reached", code: 17 });
};
await assert.rejects(() => fetchAccount("act_4", "tok"), /\(#17\)/);
assert.equal(calls, 3, "1 percobaan + 2 retry");

// Jedanya diuji langsung — menunggu jeda aslinya berarti tes yang jalan lima menit.
assert.equal(retryDelay({ code: 17 }, 0), 10, "percobaan pertama: base");
assert.equal(retryDelay({ code: 17 }, 1), 20, "naik dua kali lipat tiap percobaan");
assert.equal(retryDelay({ code: 17 }, 2), null, "berhenti di MAX_RETRIES");
assert.equal(retryDelay({ code: 200 }, 0), null, "error permanen tidak punya jeda");
// Meta menyebut sendiri berapa lama aksesnya pulih; angka itu yang dipakai, dibatasi 5 menit.
assert.equal(
  retryDelay({ code: 4, error_data: { estimated_time_to_regain_access: 2 } }, 0),
  120_000,
);
assert.equal(
  retryDelay({ code: 4, error_data: { estimated_time_to_regain_access: 90 } }, 0),
  300_000,
  "jeda dibatasi, tidak menggantung selamanya",
);

// Salinan TIDAK diulang walau kodenya sementara: kode 2 bisa datang sesudah Meta sempat membuat
// salinannya, dan mengulangnya berarti campaign kembar.
calls = 0;
globalThis.fetch = async () => {
  calls++;
  return fail({ message: "Service temporarily unavailable", code: 2 });
};
await assert.rejects(() => copyCampaignShell("120210", "tok"), /\(#2\)/);
assert.equal(calls, 1, "salin campaign tidak pernah diulang");

// Tulisan yang aman diulang tetap diulang.
calls = 0;
await assert.rejects(() => setCampaignStatus("120210", "tok", "PAUSED"), /\(#2\)/);
assert.equal(calls, 3, "saklar campaign tetap 1 percobaan + 2 retry");

console.log("meta-throttle.test ok");
