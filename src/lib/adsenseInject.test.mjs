import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  ADSENSE_MAX_SLOTS,
  adsenseCodesKey,
  adsenseDraftOf,
  filledCodes,
  slotIdOf,
} from "./adsenseInject.js";
import { GPT_MAX_SLOTS } from "./gptInject.js";

test("jumlah kotak sama dengan sisi server", () => {
  const core = readFileSync(new URL("../../functions/gpt-inject-core.js", import.meta.url), "utf8");
  assert.match(core, new RegExp(`export const GPT_MAX_SLOTS = ${ADSENSE_MAX_SLOTS};`));
  assert.equal(ADSENSE_MAX_SLOTS, GPT_MAX_SLOTS);
});

test("draf dari baris tersimpan selalu lima kotak", () => {
  assert.deepEqual(adsenseDraftOf(null), ["", "", "", "", ""]);
  assert.deepEqual(adsenseDraftOf({ codes: ["a", "b"] }), ["a", "b", "", "", ""]);
  assert.deepEqual(adsenseDraftOf({ codes: { 0: "a", 2: "c" } }), ["a", "", "c", "", ""]);
});

test("yang dikirim: ekor kosong dibuang, tengah kosong tetap", () => {
  assert.deepEqual(filledCodes([" a ", "", "c", " ", ""]), ["a", "", "c"]);
  assert.deepEqual(filledCodes(["", ""]), []);
  assert.equal(adsenseCodesKey(["a", "", ""]), adsenseCodesKey([" a"]));
  assert.notEqual(adsenseCodesKey(["a"]), adsenseCodesKey(["a", "b"]));
});

test("ID slot dibaca untuk label", () => {
  assert.equal(slotIdOf('<ins class="adsbygoogle" data-ad-slot="3445630456"></ins>'), "3445630456");
  assert.equal(slotIdOf("<div></div>"), "");
});
