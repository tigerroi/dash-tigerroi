import { describe, expect, it } from "bun:test";
import { openActivityDb } from "./activity-db.js";

// `:memory:` — tiap test dapat database kosongnya sendiri, tanpa file di disk.
function db() {
  return openActivityDb(":memory:");
}

function row(overrides = {}) {
  return {
    id: "0d1e2f3a-4b5c-6d7e-8f90-a1b2c3d4e5f6",
    at: "2026-08-19T09:00:00.000Z",
    category: "operation",
    action: "update",
    ip: "114.125.1.1",
    city: "Medan",
    ...overrides,
  };
}

describe("insertRows", () => {
  it("id yang sama menimpa baris yang sama, bukan menggandakan", () => {
    // Batch yang sampai tapi jawabannya hilang di jaringan dikirim lagi lima menit kemudian.
    const store = db();
    store.insertRows([row()]);
    store.insertRows([row({ city: "Jakarta" })]);
    const all = store.queryRange({});
    expect(all).toHaveLength(1);
    expect(all[0].city).toBe("Jakarta");
  });

  it("field yang tidak diisi jadi string kosong, bukan null", () => {
    const store = db();
    store.insertRows([row()]);
    expect(store.queryRange({})[0].label).toBe("");
  });
});

describe("queryRange", () => {
  const store = db();
  store.insertRows([
    row({ id: "a".repeat(12), at: "2026-08-18T10:00:00.000Z" }),
    row({ id: "b".repeat(12), at: "2026-08-19T10:00:00.000Z" }),
    row({ id: "c".repeat(12), at: "2026-08-20T10:00:00.000Z" }),
  ]);

  it("menyaring lewat batas start/end", () => {
    const rows = store.queryRange({ start: "2026-08-19T00", end: "2026-08-19T99" });
    expect(rows).toHaveLength(1);
    expect(rows[0].at).toBe("2026-08-19T10:00:00.000Z");
  });

  it("mengembalikan yang TERBARU dulu", () => {
    const rows = store.queryRange({});
    expect(rows.map((r) => r.at)).toEqual([
      "2026-08-20T10:00:00.000Z",
      "2026-08-19T10:00:00.000Z",
      "2026-08-18T10:00:00.000Z",
    ]);
  });

  it("limit memotong dari yang terbaru", () => {
    const rows = store.queryRange({ limit: 2 });
    expect(rows).toHaveLength(2);
    expect(rows[0].at).toBe("2026-08-20T10:00:00.000Z");
  });
});

describe("prune", () => {
  it("membuang yang <= cutoff dan mengembalikan jumlahnya", () => {
    const store = db();
    store.insertRows([
      row({ id: "a".repeat(12), at: "2026-07-01T00:00:00.000Z" }),
      row({ id: "b".repeat(12), at: "2026-08-19T00:00:00.000Z" }),
    ]);
    expect(store.prune("2026-07-20T00:00:00.000Z")).toBe(1);
    expect(store.queryRange({})).toHaveLength(1);
  });
});
