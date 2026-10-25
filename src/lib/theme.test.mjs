import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_THEME,
  nextTheme,
  normalizeTheme,
  resolveTheme,
  THEME_STORAGE_KEY,
} from "./theme.js";

test("pilihan yang tersimpan mengalahkan perangkat", () => {
  assert.equal(resolveTheme({ stored: "light", system: "dark" }), "light");
  assert.equal(resolveTheme({ stored: "dark", system: "light" }), "dark");
});

test("tanpa pilihan, perangkat yang menentukan", () => {
  assert.equal(resolveTheme({ stored: null, system: "dark" }), "dark");
  assert.equal(resolveTheme({ stored: null, system: "light" }), "light");
});

// Yang tidak menyatakan apa-apa jatuh ke terang: perangkat tanpa setelan tema, penyimpanan yang
// tidak bisa dibaca, dan nilai sampah dari versi lama.
test("yang tidak diketahui jatuh ke terang", () => {
  assert.equal(resolveTheme({ stored: null, system: null }), DEFAULT_THEME);
  assert.equal(resolveTheme({}), DEFAULT_THEME);
  assert.equal(resolveTheme(), DEFAULT_THEME);
  assert.equal(resolveTheme({ stored: "sepia", system: "neon" }), DEFAULT_THEME);
  assert.equal(normalizeTheme("sepia"), null);
  assert.equal(normalizeTheme(""), null);
  assert.equal(normalizeTheme(undefined), null);
});

test("menekan tombol membalik temanya", () => {
  assert.equal(nextTheme({ current: "light", system: "light" }).theme, "dark");
  assert.equal(nextTheme({ current: "dark", system: "light" }).theme, "light");
});

// Ini yang menggantikan keadaan ketiga di tombol: menekan sampai temanya sama dengan tema sistem
// mengembalikan dashboard ke "ikut perangkat", tanpa pilihan menu tersendiri untuk itu.
test("pilihan yang sama dengan perangkat TIDAK disimpan", () => {
  assert.equal(nextTheme({ current: "light", system: "dark" }).stored, null);
  assert.equal(nextTheme({ current: "dark", system: "light" }).stored, null);
});

test("pilihan yang berbeda dari perangkat disimpan", () => {
  assert.equal(nextTheme({ current: "dark", system: "dark" }).stored, "light");
  assert.equal(nextTheme({ current: "light", system: "light" }).stored, "dark");
});

// Perangkat yang tidak menyatakan apa-apa tidak bisa jadi alasan menghapus pilihan orang: tanpa
// ini, satu browser tanpa prefers-color-scheme membuat tombolnya berhenti mengingat apa pun.
test("perangkat yang tidak diketahui tetap menyimpan pilihan", () => {
  assert.equal(nextTheme({ current: "light", system: null }).stored, "dark");
  assert.equal(nextTheme({ current: "dark" }).stored, "light");
});

// Skrip boot di index.html adalah salinan kedua dari keputusan di atas — ia harus jalan sebelum
// bundel dimuat, jadi ia tidak bisa mengimpor apa pun dari sini. Yang dijaga di sini bukan
// bentuknya melainkan yang membuatnya gagal diam-diam: kunci penyimpanan yang tidak sama berarti
// tema tersimpan tidak terbaca saat boot, dan tiap muat halaman berkedip ke tema yang salah dulu.
test("skrip boot index.html memakai kunci dan aturan yang sama", () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const html = readFileSync(path.join(root, "index.html"), "utf8");
  const script = html.slice(html.indexOf("<script>"), html.indexOf("</script>"));

  assert.ok(script.includes(`"${THEME_STORAGE_KEY}"`), "kunci penyimpanan harus sama");
  assert.ok(script.includes("(prefers-color-scheme: dark)"), "harus membaca setelan perangkat");
  assert.ok(script.includes(`|| "${DEFAULT_THEME}"`), "bawaannya harus terang");
  assert.ok(script.includes("dataset.theme"), "harus memasang atribut yang dibaca CSS");

  // Tema tersimpan menang atas perangkat — urutan yang sama dengan resolveTheme().
  const storedFirst = script.indexOf("stored ===");
  const systemAfter = script.indexOf("system ||");
  assert.ok(storedFirst > 0 && systemAfter > storedFirst, "tersimpan harus diperiksa lebih dulu");
});
