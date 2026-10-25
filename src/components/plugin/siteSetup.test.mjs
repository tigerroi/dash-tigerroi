import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// Aturan bawaan centang Setting Sub — disalin dari SiteSetup.jsx apa adanya lewat teksnya, karena
// berkas .jsx tidak bisa diimpor node:test tanpa transform.
const source = readFileSync(new URL("./SiteSetup.jsx", import.meta.url), "utf8");
const body = source.slice(source.indexOf("const FRESH_ITEMS"), source.indexOf("export const PAGES = ["));
const { defaultDeploymentTasks } = new Function(
  `${body.replace("export function", "function")}; return { defaultDeploymentTasks };`,
)();

test("situs hidup berartikel tidak pernah mencentang trash", () => {
  const status = {
    pending: ["trash"],
    tasks: { trash: { ok: false, count: 25 }, plugins: { ok: true } },
  };
  assert.deepEqual(defaultDeploymentTasks(status), []);
});

test("WordPress baru: semua yang pending dicentang", () => {
  const status = {
    pending: ["trash", "permalink", "plugins", "theme"],
    tasks: { trash: { count: 2 }, plugins: { w3tc: false } },
  };
  assert.deepEqual(defaultDeploymentTasks(status), ["trash", "permalink", "plugins", "theme"]);
});

test("plugin lengkap tapi drop-in hilang → dropin, bukan plugins", () => {
  const status = {
    pending: ["plugins"],
    tasks: { plugins: { w3tc: true, eztoc: true, redis: true, dropin: false } },
  };
  assert.deepEqual(defaultDeploymentTasks(status), ["dropin"]);
});

test("belum ada status = tidak ada yang dicentang", () => {
  assert.deepEqual(defaultDeploymentTasks(null), []);
});
