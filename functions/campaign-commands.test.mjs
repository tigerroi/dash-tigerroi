import assert from "node:assert";

// Sama seperti meta.test.mjs: knob dibaca saat import, jadi throttling dimatikan lebih dulu.
process.env.META_MIN_INTERVAL_MS = "0";

const {
  CAMPAIGN_STATUSES,
  campaignCommandEntry,
  campaignCommandUpdate,
  campaignEntries,
  expiredCampaignCommandKeys,
  pendingCampaignCommands,
} = await import("./sync-core.js");
const { applyCampaignCommands, applyOneCampaignCommand } = await import("./campaign-commands.mjs");

// --- helper murni -------------------------------------------------------------------------------

assert.deepEqual(CAMPAIGN_STATUSES, ["ACTIVE", "PAUSED"]);

// campaignEntries: array DAN objek (RTDB mengembalikan array berlubang sebagai objek), dengan
// kuncinya — kunci itulah yang dipakai sebagai potongan path saat satu baris diperbarui.
assert.deepEqual(
  campaignEntries([{ campaign: "a" }, { campaign: "b" }]).map(([key]) => key),
  ["0", "1"],
);
assert.deepEqual(
  campaignEntries({ x: { campaign: "a" }, y: { campaign: "b" } }).map(([key]) => key),
  ["x", "y"],
);
assert.deepEqual(campaignEntries(null), []);

// Bentuk perintah harus sama persis dengan yang ditulis browser (src/lib/campaignCommands.js).
const entry = campaignCommandEntry(
  { campaignId: "120210", campaign: "nPJL-06", adAccount: "act_1" },
  "PAUSED",
  "dev@rabbitracing.live",
  new Date("2026-08-12T03:00:00.000Z"),
);
assert.equal(entry.state, "pending");
assert.equal(entry.desiredStatus, "PAUSED");
assert.equal(entry.campaignId, "120210");
assert.throws(() => campaignCommandEntry({ campaignId: "1" }, "ARCHIVED", "a"), /tidak dikenal/);
assert.throws(() => campaignCommandEntry({ campaign: "x" }, "PAUSED", "a"), /ID Meta/);

// pendingCampaignCommands: hanya yang menunggu, dan hanya dari user yang belum dihapus.
const users = {
  u1: {
    email: "a@x.id",
    campaigns: [{ campaignId: "120210", campaign: "nPJL-06", configuredStatus: "ACTIVE" }],
    campaignCommands: {
      120210: { campaignId: "120210", desiredStatus: "PAUSED", state: "pending", requestedAt: "2026-08-12T03:00:00.000Z" },
      120211: { campaignId: "120211", desiredStatus: "ACTIVE", state: "applied", requestedAt: "2026-08-12T02:00:00.000Z" },
      120212: { campaignId: "120212", desiredStatus: "ARCHIVED", state: "pending", requestedAt: "2026-08-12T03:00:00.000Z" },
    },
  },
  u2: {
    deletedAt: "2026-08-01T00:00:00.000Z",
    campaignCommands: { 9: { desiredStatus: "PAUSED", state: "pending", requestedAt: "2026-08-12T03:00:00.000Z" } },
  },
};
const now = new Date("2026-08-12T03:05:00.000Z");
const pending = pendingCampaignCommands(users, now);
assert.equal(pending.length, 1, "yang applied, statusnya asing, dan milik user terhapus dilewati");
assert.deepEqual(
  { userId: pending[0].userId, campaignId: pending[0].campaignId, expired: pending[0].expired },
  { userId: "u1", campaignId: "120210", expired: false },
);

// Perintah yang menggantung berjam-jam tetap terdaftar, ditandai kedaluwarsa — dilewati diam-diam,
// ia akan menulis "Menunggu" di layar selamanya.
const stale = pendingCampaignCommands(users, new Date("2026-08-12T12:00:00.000Z"));
assert.equal(stale[0].expired, true);

// campaignCommandUpdate: sukses memperbarui baris campaign DI TEMPAT, lewat kuncinya sendiri.
const okUpdate = campaignCommandUpdate(users.u1, pending[0], { ok: true }, now);
assert.deepEqual(okUpdate, {
  "campaignCommands/120210/state": "applied",
  "campaignCommands/120210/appliedAt": "2026-08-12T03:05:00.000Z",
  "campaignCommands/120210/error": null,
  "campaigns/0/configuredStatus": "PAUSED",
  "campaigns/0/status": "Tidak aktif",
  "campaigns/0/statusAppliedAt": "2026-08-12T03:05:00.000Z",
});

// Gagal: barisnya TIDAK disentuh. Campaign yang masih menyala di Meta tidak boleh tertulis mati.
const failUpdate = campaignCommandUpdate(users.u1, pending[0], { ok: false, error: "boom" }, now);
assert.deepEqual(Object.keys(failUpdate).filter((k) => k.startsWith("campaigns/")), []);
assert.equal(failUpdate["campaignCommands/120210/state"], "failed");
assert.equal(failUpdate["campaignCommands/120210/error"], "boom");

// Pesan Meta yang panjang dipotong agar muat di batas 500 karakter milik aturan database. Tanpa ini
// tulisannya ditolak seluruhnya, perintahnya tidak pernah lepas dari "pending", dan penerap
// mengulanginya tiap dua menit selamanya.
const longError = campaignCommandUpdate(
  users.u1,
  pending[0],
  { ok: false, error: "x".repeat(900) },
  now,
);
assert.ok(longError["campaignCommands/120210/error"].length <= 500);
assert.match(longError["campaignCommands/120210/error"], /…$/);

// Yang selesai dan sudah lewat masa simpan dibuang; yang menunggu tidak pernah ikut.
const commands = {
  a: { state: "applied", appliedAt: "2026-08-10T00:00:00.000Z" },
  b: { state: "applied", appliedAt: "2026-08-12T02:00:00.000Z" },
  c: { state: "pending", requestedAt: "2026-08-01T00:00:00.000Z" },
};
assert.deepEqual(expiredCampaignCommandKeys(commands, now), ["a"]);

// --- penerap ------------------------------------------------------------------------------------

function fakeStore(seed) {
  const data = structuredClone(seed);
  const writes = [];
  return {
    data,
    writes,
    read: async (path) => path.split("/").reduce((node, key) => node?.[key], data),
    update: async (path, values) => {
      writes.push([path, values]);
      for (const [key, value] of Object.entries(values)) {
        const parts = `${path}/${key}`.split("/");
        const last = parts.pop();
        let node = data;
        for (const part of parts) {
          node[part] = node[part] ?? {};
          node = node[part];
        }
        if (value === null) delete node[last];
        else node[last] = value;
      }
    },
    replace: async (path, value) => {
      writes.push([path, value]);
    },
  };
}

// Satu campaign gagal tidak boleh menjatuhkan campaign user lain di antrean yang sama.
const seed = {
  users: {
    u1: {
      campaigns: [{ campaignId: "1", campaign: "Satu", configuredStatus: "ACTIVE" }],
      campaignCommands: {
        1: { campaignId: "1", campaign: "Satu", desiredStatus: "PAUSED", state: "pending", requestedAt: "2026-08-12T03:00:00.000Z" },
      },
    },
    u2: {
      campaigns: [{ campaignId: "2", campaign: "Dua", configuredStatus: "PAUSED" }],
      campaignCommands: {
        2: { campaignId: "2", campaign: "Dua", desiredStatus: "ACTIVE", state: "pending", requestedAt: "2026-08-12T03:00:00.000Z" },
      },
    },
  },
};

const calls = [];
globalThis.fetch = async (url, init) => {
  const id = String(url).split("?")[0].split("/").pop();
  calls.push({ id, method: init?.method, status: new URL(String(url)).searchParams.get("status") });
  if (id === "1") {
    return { ok: false, text: async () => JSON.stringify({ error: { message: "Izin ads_management kurang", code: 200 } }) };
  }
  return { ok: true, text: async () => JSON.stringify({ success: true }) };
};

const store = fakeStore(seed);
const res = await applyCampaignCommands(store, "tok", now);
assert.equal(res.pending, 2);
assert.equal(res.applied, 1, "yang satu gagal, yang lain tetap jalan");
assert.equal(res.failed, 1);
assert.deepEqual(
  calls.map((c) => [c.id, c.method, c.status]),
  [
    ["1", "POST", "PAUSED"],
    ["2", "POST", "ACTIVE"],
  ],
  "menulis lewat POST, dengan status yang diminta",
);
assert.equal(store.data.users.u1.campaignCommands["1"].state, "failed");
assert.match(store.data.users.u1.campaignCommands["1"].error, /ads_management/);
assert.equal(
  store.data.users.u1.campaigns[0].configuredStatus,
  "ACTIVE",
  "baris yang gagal tidak berubah",
);
assert.equal(store.data.users.u2.campaignCommands["2"].state, "applied");
assert.equal(store.data.users.u2.campaigns[0].configuredStatus, "ACTIVE");
assert.equal(store.data.users.u2.campaigns[0].status, "Aktif");

// Kegagalan ikut tertulis ke syncIssues — cabangnya ditulis walau kosong, sama seperti sync lain.
const issues = store.writes.find(([path]) => path.endsWith("/campaignCommands"));
assert.ok(issues, "cabang syncIssues ditulis");
assert.equal(issues[1].count, 1);
assert.match(issues[1].items.i0.impact, /masih aktif/);

// Perintah kedaluwarsa ditandai gagal TANPA menyentuh Meta: menyalakan campaign atas keputusan
// enam jam lalu berarti membelanjakan uang yang tidak ada yang memutuskannya sekarang.
calls.length = 0;
const staleStore = fakeStore({
  users: {
    u1: {
      campaigns: [{ campaignId: "1", campaign: "Satu", configuredStatus: "PAUSED" }],
      campaignCommands: {
        1: { campaignId: "1", desiredStatus: "ACTIVE", state: "pending", requestedAt: "2026-08-11T03:00:00.000Z" },
      },
    },
  },
});
const staleRes = await applyCampaignCommands(staleStore, "tok", now);
assert.equal(staleRes.applied, 0);
assert.equal(staleRes.failed, 1);
assert.equal(calls.length, 0, "Meta tidak dipanggil sama sekali");
assert.match(staleStore.data.users.u1.campaignCommands["1"].error, /kedaluwarsa/);

// Jalur callable: satu perintah, dieksekusi langsung, dan kegagalannya dilempar ke pemanggil
// setelah ditandai — bukan ditelan diam-diam.
const oneStore = fakeStore({
  users: {
    u1: {
      campaigns: [{ campaignId: "2", campaign: "Dua", configuredStatus: "PAUSED" }],
      campaignCommands: {
        2: { campaignId: "2", campaign: "Dua", desiredStatus: "ACTIVE", state: "pending", requestedAt: "2026-08-12T03:00:00.000Z" },
      },
    },
  },
});
await applyOneCampaignCommand(oneStore, "tok", "u1", "2", now);
assert.equal(oneStore.data.users.u1.campaignCommands["2"].state, "applied");
assert.equal(oneStore.data.users.u1.campaigns[0].configuredStatus, "ACTIVE");
await assert.rejects(
  () => applyOneCampaignCommand(oneStore, "tok", "u1", "404", now),
  /tidak ditemukan/,
);

console.log("campaign-commands tests ok");
