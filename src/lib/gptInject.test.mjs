import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  BUILT_IN_GPT_TEMPLATES,
  chosenUnits,
  GPT_MAX_SLOTS,
  gptSpecKey,
  gptTemplateEntry,
  gptTemplateSizesUpdate,
  gptTemplatesOf,
  matchingTemplate,
} from "./gptInject.js";

test("jumlah slot maksimum sama dengan sisi server", () => {
  const core = readFileSync(new URL("../../functions/gpt-inject-core.js", import.meta.url), "utf8");
  assert.match(core, new RegExp(`export const GPT_MAX_SLOTS = ${GPT_MAX_SLOTS};`));
});

test("template bawaan Ad Manager memuat 35 ukuran contoh", () => {
  assert.equal(BUILT_IN_GPT_TEMPLATES[0].sizes.split(",").length, 35);
});

test("template disimpan dengan nama unik dan ukuran yang dirapikan", () => {
  assert.deepEqual(gptTemplateEntry({ name: " Uji A ", sizes: "300x250\n 728x90" }), {
    name: "Uji A",
    sizes: "300x250,728x90",
  });
  assert.throws(() => gptTemplateEntry({ name: "", sizes: "300x250" }));
  assert.throws(() => gptTemplateEntry({ name: "x", sizes: "  " }));
  assert.throws(() => gptTemplateEntry({ name: "mobile", sizes: "300x250" }, gptTemplatesOf([])));
});

test("daftar template: bawaan dulu, yang diarsipkan tidak ikut", () => {
  const list = gptTemplatesOf([
    { id: "b", name: "Zeta", sizes: "320x50" },
    { id: "a", name: "Alfa", sizes: "300x250" },
    { id: "c", name: "Dihapus", sizes: "1x1", deletedAt: "2026-09-14" },
  ]);
  assert.equal(list[0].builtIn, true);
  assert.deepEqual(
    list.filter((item) => !item.builtIn).map((item) => item.name),
    ["Alfa", "Zeta"],
  );
  assert.equal(matchingTemplate(list, "300x250, 336x280").id, "builtin-rectangle");
  assert.equal(matchingTemplate(list, "300x250,999x9"), null);
});

test("kunci pilihan berubah kalau apa pun yang ditulis berubah, termasuk unitnya", () => {
  const base = { sizes: "300x250", slots: 3 };
  assert.equal(gptSpecKey(base, { 1: "a" }), gptSpecKey({ sizes: " 300x250 ", slots: "3" }, { 1: "a" }));
  assert.notEqual(gptSpecKey(base), gptSpecKey({ ...base, slots: 2 }));
  assert.notEqual(gptSpecKey(base, { 1: "a" }), gptSpecKey(base, { 1: "b" }));
});

test("unit terpilih: pilihan admin, atau unit Ad Exchange Display network itu", () => {
  const networks = [
    {
      networkCode: "1",
      units: [
        { adUnitCode: "ca-pub-9-tag", adExchange: true },
        { adUnitCode: "header", adExchange: false },
      ],
    },
    { networkCode: "2", units: [{ adUnitCode: "header", adExchange: false }] },
  ];
  assert.deepEqual(chosenUnits(networks), { 1: "ca-pub-9-tag" });
  assert.deepEqual(chosenUnits(networks, { 1: "header", 2: "header" }), { 1: "header", 2: "header" });
  assert.deepEqual(chosenUnits(networks, { 1: "tidak-ada" }), { 1: "ca-pub-9-tag" });
});

test("template tersimpan bisa diperbarui ukurannya, bawaan tidak", () => {
  assert.deepEqual(gptTemplateSizesUpdate({ id: "a", name: "Uji" }, " 300x250\n320x50 "), {
    sizes: "300x250,320x50",
  });
  assert.throws(() => gptTemplateSizesUpdate({ id: "builtin-mobile", builtIn: true }, "300x250"));
  assert.throws(() => gptTemplateSizesUpdate({ id: "a" }, "  "));
});
