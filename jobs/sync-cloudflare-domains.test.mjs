import assert from "node:assert/strict";
import { test } from "node:test";
import { run } from "./sync-cloudflare-domains.js";

test("sync-cloudflare-domains.js mengekspor fungsi run", () => {
  assert.equal(typeof run, "function");
});

