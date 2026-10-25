import { describe, expect, it } from "bun:test";
import { createAccountSyncQueue } from "./account-sync-queue.js";
import { createLock } from "./campaign-lock.js";

function build({ run = async () => {} } = {}) {
  const timers = [];
  const cleared = [];
  const errors = [];
  let handleCounter = 0;
  const queue = createAccountSyncQueue({
    run,
    lock: createLock(),
    delayMs: 30_000,
    setTimer: (fn, ms) => {
      const handle = ++handleCounter;
      timers.push({ handle, fn, ms });
      return handle;
    },
    clearTimer: (handle) => {
      cleared.push(handle);
    },
    log: { error: (message) => errors.push(message) },
  });
  return { queue, timers, cleared, errors };
}

describe("createAccountSyncQueue", () => {
  it("beberapa tulisan dalam satu jeda digabung jadi satu sync", async () => {
    const calls = [];
    const { queue, timers } = build({ run: async (ids) => calls.push(ids) });
    queue.enqueue("k1");
    queue.enqueue("k2");
    queue.enqueue("k1");
    expect(timers.length).toBe(1);
    expect(timers[0].ms).toBe(30_000);
    await queue.flush();
    expect(calls).toEqual([["k1", "k2"]]);
    expect(queue.size()).toBe(0);
  });

  it("id kosong diabaikan", () => {
    const { queue, timers } = build();
    queue.enqueue("");
    queue.enqueue(null);
    expect(timers.length).toBe(0);
  });

  it("sync yang gagal dicatat, tidak melempar", async () => {
    const { queue, errors } = build({ run: async () => { throw new Error("RTDB tak terjangkau"); } });
    queue.enqueue("k1");
    await queue.flush();
    expect(errors[0]).toContain("RTDB tak terjangkau");
  });

  it("flush() membatalkan timer lama sebelum menuliskan yang baru", async () => {
    const calls = [];
    const { queue, timers, cleared } = build({ run: async (ids) => calls.push(ids) });

    // Pertama: enqueue("k1") → arm timer T1 (handle 1)
    queue.enqueue("k1");
    expect(timers.length).toBe(1);
    expect(timers[0].handle).toBe(1);
    const firstFn = timers[0].fn;

    // Kedua: flush() manual → harus batalkan T1, kosongkan pending, null timer
    await queue.flush();
    expect(calls).toEqual([["k1"]]);
    expect(cleared).toEqual([1]); // T1 harus dibatalkan
    expect(queue.size()).toBe(0);

    // Ketiga: enqueue("k2") → arm timer T2 (handle 2, baru)
    queue.enqueue("k2");
    expect(timers.length).toBe(2);
    expect(timers[1].handle).toBe(2);

    // Verifikasi: hanya T1 yang dibatalkan, T2 masih menunggu
    expect(cleared).toEqual([1]);

    // Simulasi: callback T2 jalan → call run dengan ["k2"]
    const secondFn = timers[1].fn;
    await secondFn();
    expect(calls).toEqual([["k1"], ["k2"]]);
  });
});
