import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { openSyncRunsDb } from "./sync-runs-db.js";
import { drainSyncRuns, syncRunsRoutes } from "./sync-runs.js";

const URL_BASE = "http://localhost";

// Fake store dengan node dashboard/syncRuns yang bisa dibaca, di-update (null = hapus).
function fakeStore(initial = {}) {
  const state = { "dashboard/syncRuns": { ...initial } };
  return {
    state,
    read: async (path) => state[path] || null,
    update: async (path, values) => {
      state[path] = state[path] || {};
      for (const [k, v] of Object.entries(values)) {
        if (v === null) delete state[path][k];
        else state[path][k] = v;
      }
    },
    replace: async () => {},
  };
}

const entry = (over = {}) => ({
  startedAt: "2026-08-19T09:00:00.000Z",
  durationSec: 10,
  ok: true,
  summary: "ok",
  stages: [{ name: "GAM", ok: true, detail: "ok" }],
  ...over,
});

describe("drainSyncRuns", () => {
  it("menyalin ke SQLite lalu menghapus dari RTDB (keepLive:0 = drain penuh)", async () => {
    const store = fakeStore({ "20260819090000": entry(), "20260819100000": entry() });
    const syncRunsDb = openSyncRunsDb(":memory:");
    const res = await drainSyncRuns({ store, syncRunsDb, keepLive: 0 });
    expect(res.drained).toBe(2);
    expect(syncRunsDb.recent()).toHaveLength(2);
    expect(store.state["dashboard/syncRuns"]).toEqual({});
  });

  it("menyisakan `keepLive` run terbaru di RTDB sebagai ekor topbar", async () => {
    const store = fakeStore({
      "20260819090000": entry(),
      "20260819100000": entry(),
      "20260819110000": entry(),
    });
    const syncRunsDb = openSyncRunsDb(":memory:");
    const res = await drainSyncRuns({ store, syncRunsDb, keepLive: 2 });
    // Yang terhapus dari RTDB hanya yang tertua; SQLite tetap menyimpan semuanya.
    expect(res.drained).toBe(1);
    expect(syncRunsDb.recent()).toHaveLength(3);
    expect(Object.keys(store.state["dashboard/syncRuns"]).sort()).toEqual([
      "20260819100000",
      "20260819110000",
    ]);
  });

  it("idempoten: drain kedua tanpa baris baru tidak menggandakan", async () => {
    const store = fakeStore({ "20260819090000": entry(), "20260819100000": entry() });
    const syncRunsDb = openSyncRunsDb(":memory:");
    await drainSyncRuns({ store, syncRunsDb, keepLive: 0 });
    await drainSyncRuns({ store, syncRunsDb, keepLive: 0 });
    expect(syncRunsDb.recent()).toHaveLength(2);
  });

  it("mengabaikan kunci yang bukan stempel 14-digit", async () => {
    const store = fakeStore({ retry: { foo: 1 }, "20260819090000": entry() });
    const syncRunsDb = openSyncRunsDb(":memory:");
    await drainSyncRuns({ store, syncRunsDb, keepLive: 0 });
    expect(syncRunsDb.recent()).toHaveLength(1);
    expect(store.state["dashboard/syncRuns"].retry).toBeDefined();
  });
});

describe("GET /sync-runs", () => {
  function build(actor = { uid: "u1", role: "admin" }, store = fakeStore(), syncRunsDb = openSyncRunsDb(":memory:")) {
    const app = new Elysia().use(
      syncRunsRoutes({ db: {}, store, syncRunsDb, authorize: async () => actor }),
    );
    return { app, store, syncRunsDb };
  }

  function get(app) {
    return app.handle(new Request(`${URL_BASE}/sync-runs`, { headers: { authorization: "Bearer t" } }));
  }

  it("menggabung SQLite dengan RTDB yang belum di-drain, dedup lewat kunci, terbaru dulu", async () => {
    const store = fakeStore({ "20260819110000": entry({ summary: "live" }) });
    const syncRunsDb = openSyncRunsDb(":memory:");
    syncRunsDb.upsertRuns([{ key: "20260819090000", entry: entry({ summary: "lama" }) }]);
    const { app } = build(undefined, store, syncRunsDb);
    const body = await (await get(app)).json();
    expect(body.runs.map((r) => r.id)).toEqual(["20260819110000", "20260819090000"]);
    expect(body.runs[0].summary).toBe("live");
  });

  it("ditolak untuk yang bukan admin", async () => {
    const app = new Elysia().use(
      syncRunsRoutes({
        db: {},
        store: fakeStore(),
        syncRunsDb: openSyncRunsDb(":memory:"),
        authorize: async () => {
          const { AuthError } = await import("./auth.js");
          throw new AuthError("Khusus admin.", 403);
        },
      }),
    );
    const res = await app.handle(
      new Request(`${URL_BASE}/sync-runs`, { headers: { authorization: "Bearer t" } }),
    );
    expect(res.status).toBe(403);
  });
});

describe("POST /sync-runs/stages", () => {
  function build({ running = false, status = null } = {}) {
    const started = [];
    const store = fakeStore();
    if (status) store.state["dashboard/syncStatus"] = status;
    const syncStage = {
      names: () => ["GAM accounts", "ROI"],
      busy: () => running,
      start: (stage, actor) => started.push([stage, actor]),
    };
    const app = new Elysia().use(
      syncRunsRoutes({
        db: {},
        store,
        syncRunsDb: openSyncRunsDb(":memory:"),
        syncStage,
        authorize: async () => ({ uid: "u1", email: "a@r.live" }),
      }),
    );
    const post = (stage) =>
      app.handle(
        new Request(`${URL_BASE}/sync-runs/stages`, {
          method: "POST",
          headers: { authorization: "Bearer t", "content-type": "application/json" },
          body: JSON.stringify({ stage }),
        }),
      );
    return { post, started };
  }

  it("menjalankan tahap yang dikenal, atas nama pemintanya", async () => {
    const { post, started } = build();
    expect((await post("ROI")).status).toBe(200);
    expect(started).toEqual([["ROI", "a@r.live"]]);
  });

  it("tahap yang tidak ada ditolak 422 tanpa menjalankan apa pun", async () => {
    const { post, started } = build();
    expect((await post("Entah")).status).toBe(422);
    expect(started).toEqual([]);
  });

  it("409 selama run lain berjalan, di proses ini atau menurut syncStatus yang masih segar", async () => {
    expect((await build({ running: true }).post("ROI")).status).toBe(409);
    const fresh = { running: true, startedAt: new Date().toISOString() };
    expect((await build({ status: fresh }).post("ROI")).status).toBe(409);
    // Run yang mengaku berjalan sejak sejam lalu sudah mati — tidak menahan tombolnya selamanya.
    const stale = { running: true, startedAt: new Date(Date.now() - 3600e3).toISOString() };
    expect((await build({ status: stale }).post("ROI")).status).toBe(200);
  });
});
