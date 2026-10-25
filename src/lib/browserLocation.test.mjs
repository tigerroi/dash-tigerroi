import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

// `window` palsu seadanya: alamat, dua fungsi History API, dan pendengar popstate. Modulnya
// membaca `window` saat dipanggil (bukan saat diimpor), jadi ini cukup untuk menguji satu hal yang
// tidak kelihatan dari kode pemanggilnya — pushState/replaceState TIDAK membangkitkan popstate,
// jadi yang mengabari pelanggan harus navigateTo sendiri.
function installWindow(url = "/plugin") {
  const listeners = new Set();
  const [pathname, query = ""] = url.split("?");
  globalThis.window = {
    location: { pathname, search: query ? `?${query}` : "" },
    history: {
      calls: [],
      pushState(_state, _title, next) {
        this.calls.push(["push", next]);
        apply(next);
      },
      replaceState(_state, _title, next) {
        this.calls.push(["replace", next]);
        apply(next);
      },
    },
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
  };

  function apply(next) {
    const [path, search = ""] = next.split("?");
    globalThis.window.location.pathname = path;
    globalThis.window.location.search = search ? `?${search}` : "";
  }

  return globalThis.window;
}

const { locationPath, locationSearch, navigateTo, subscribeLocation } = await import(
  "./browserLocation.js"
);

describe("navigateTo", () => {
  beforeEach(() => installWindow());

  test("mengabari pelanggan sendiri — pushState tidak membangkitkan popstate", () => {
    let notified = 0;
    const unsubscribe = subscribeLocation(() => notified++);
    navigateTo("/plugin?q=masse");
    unsubscribe();

    assert.equal(notified, 1);
    assert.equal(locationPath(), "/plugin");
    assert.equal(locationSearch(), "?q=masse");
  });

  test("push untuk yang membuka sesuatu, replace untuk perubahan filter", () => {
    navigateTo("/plugin?q=masse", { replace: true });
    navigateTo("/plugin?q=masse&situs=abc");
    assert.deepEqual(window.history.calls, [
      ["replace", "/plugin?q=masse"],
      ["push", "/plugin?q=masse&situs=abc"],
    ]);
  });

  test("alamat yang sama tidak menulis entri riwayat kembar", () => {
    installWindow("/plugin?q=masse");
    let notified = 0;
    const unsubscribe = subscribeLocation(() => notified++);
    navigateTo("/plugin?q=masse");
    unsubscribe();

    assert.deepEqual(window.history.calls, []);
    assert.equal(notified, 0);
  });

  test("berhenti mengabari setelah berhenti berlangganan", () => {
    let notified = 0;
    subscribeLocation(() => notified++)();
    navigateTo("/plugin?q=masse");
    assert.equal(notified, 0);
  });
});
