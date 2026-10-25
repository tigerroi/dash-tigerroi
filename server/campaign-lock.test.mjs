import { describe, expect, it } from "bun:test";
import { createLock } from "./campaign-lock.js";

describe("createLock", () => {
  it("tugas berjalan berurutan, tidak pernah bersamaan", async () => {
    const lock = createLock();
    let inside = 0;
    let peak = 0;
    const task = async () => {
      inside++;
      peak = Math.max(peak, inside);
      await Bun.sleep(5);
      inside--;
    };
    await Promise.all([lock.run(task), lock.run(task), lock.run(task)]);
    expect(peak).toBe(1);
  });

  it("tryRun menyerah saat sibuk, dan jalan lagi sesudahnya", async () => {
    const lock = createLock();
    let release;
    const busy = lock.run(() => new Promise((resolve) => (release = resolve)));
    await Bun.sleep(0);
    expect(lock.isBusy()).toBe(true);
    expect(lock.tryRun(async () => 1)).toBe(null);
    release();
    await busy;
    expect(await lock.tryRun(async () => 2)).toBe(2);
  });

  it("tugas yang melempar tidak mengunci selamanya", async () => {
    const lock = createLock();
    await expect(lock.run(async () => { throw new Error("gagal"); })).rejects.toThrow("gagal");
    expect(await lock.run(async () => "lanjut")).toBe("lanjut");
  });
});
