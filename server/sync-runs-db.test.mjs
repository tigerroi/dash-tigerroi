import { describe, expect, it } from "bun:test";
import { openSyncRunsDb } from "./sync-runs-db.js";

function db() {
  return openSyncRunsDb(":memory:");
}

function entry(overrides = {}) {
  return {
    startedAt: "2026-08-19T09:00:00.000Z",
    durationSec: 42,
    ok: true,
    summary: "GAM ok | ROI ok",
    stages: [{ name: "GAM", ok: true, detail: "5 ok" }],
    ...overrides,
  };
}

describe("upsertRuns / recent", () => {
  it("key yang sama menimpa, dan stages dibaca balik sebagai array", () => {
    const store = db();
    store.upsertRuns([{ key: "20260819090000", entry: entry() }]);
    store.upsertRuns([{ key: "20260819090000", entry: entry({ summary: "diperbarui" }) }]);
    const runs = store.recent();
    expect(runs).toHaveLength(1);
    expect(runs[0].summary).toBe("diperbarui");
    expect(runs[0].stages).toEqual([{ name: "GAM", ok: true, detail: "5 ok" }]);
  });

  it("terbaru dulu, dan ok:false terbaca sebagai gagal", () => {
    const store = db();
    store.upsertRuns([
      { key: "20260818090000", entry: entry() },
      { key: "20260820090000", entry: entry({ ok: false, failed: 1 }) },
    ]);
    const runs = store.recent();
    expect(runs.map((r) => r.id)).toEqual(["20260820090000", "20260818090000"]);
    expect(runs[0].ok).toBe(false);
  });
});

describe("prune", () => {
  it("menyisakan `keep` terbaru", () => {
    const store = db();
    store.upsertRuns(
      Array.from({ length: 5 }, (_, i) => ({
        key: `2026081909000${i}`,
        entry: entry(),
      })),
    );
    expect(store.prune(2)).toBe(3);
    const runs = store.recent();
    expect(runs).toHaveLength(2);
    expect(runs[0].id).toBe("20260819090004");
  });
});
