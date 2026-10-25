import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Tema gelap di dashboard ini bukan daftar selektor melainkan satu lapis token: `:root` menyebut
// nilai terangnya, `:root[data-theme="dark"]` menyebut ulang nilai yang sama, dan SISA berkas cuma
// memakai `var(--token)`.
//
// Dua aturan itu yang dijaga di sini, karena keduanya gagal tanpa suara. Satu warna mentah yang
// lolos ke selektor komponen tidak berubah apa-apa di layar orang bermode terang — yang melihatnya
// cuma orang bermode gelap, sebagai teks putih di atas putih. Dan token yang lupa diberi nilai
// gelap persis sama buruknya.
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(path.join(root, "styles.css"), "utf8").split("\r\n").join("\n");

const DARK_SELECTOR = ':root[data-theme="dark"] {';

function blocks() {
  const darkStart = css.indexOf(DARK_SELECTOR);
  assert.ok(darkStart > 0, "blok tema gelap harus ada");
  const lightEnd = css.indexOf("\n}\n", css.indexOf(":root {"));
  const darkEnd = css.indexOf("\n}\n", darkStart);
  assert.ok(lightEnd > 0 && lightEnd < darkStart, "blok :root harus mendahului blok gelap");

  return {
    light: css.slice(0, lightEnd),
    dark: css.slice(darkStart, darkEnd),
    rest: css.slice(darkEnd),
  };
}

const tokensOf = (text) => new Set([...text.matchAll(/^\s+(--[a-z0-9-]+):/gm)].map((m) => m[1]));

// Pilihan orang harus bisa mengalahkan setelan perangkat, dan itu hanya mungkin kalau nilai
// gelapnya digantung pada atribut. Digantung pada media query, satu-satunya cara mengalahkannya
// adalah blok gelap KEDUA — dan dua daftar nilai gelap adalah persis yang lapis token ini ada
// untuk mencegahnya.
test("nilai gelap digantung pada atribut, bukan pada media query", () => {
  assert.ok(!css.includes("prefers-color-scheme: dark) {"), "tidak boleh ada blok @media gelap");
  assert.equal(css.split(DARK_SELECTOR).length - 1, 1, "blok gelap harus tepat satu");
});

test("tiap token punya nilai di kedua tema", () => {
  const { light, dark } = blocks();
  const lightTokens = tokensOf(light);
  const darkTokens = tokensOf(dark);

  assert.ok(lightTokens.size > 100, `token terang cuma ${lightTokens.size}`);
  const tanpaGelap = [...lightTokens].filter((token) => !darkTokens.has(token));
  assert.deepEqual(tanpaGelap, [], `token tanpa nilai gelap: ${tanpaGelap.join(", ")}`);

  // Arah sebaliknya juga salah: token yang hanya ada di blok gelap tidak punya nilai bawaan sama
  // sekali, jadi ia kosong justru di tema yang dipakai perangkat yang tidak menyatakan apa-apa.
  const tanpaTerang = [...darkTokens].filter((token) => !lightTokens.has(token));
  assert.deepEqual(tanpaTerang, [], `token tanpa nilai terang: ${tanpaTerang.join(", ")}`);
});

test("tiap var() yang dipakai benar-benar didefinisikan", () => {
  const { light } = blocks();
  const defined = tokensOf(light);
  const used = new Set([...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]));
  const hilang = [...used].filter((token) => !defined.has(token));
  assert.deepEqual(hilang, [], `dipakai tapi tidak didefinisikan: ${hilang.join(", ")}`);
});

test("tidak ada warna mentah di luar dua blok token", () => {
  const { rest } = blocks();
  const mentah = rest
    .split("\n")
    // Komentar mengutip warna sebagai contoh, bukan memakainya sebagai nilai.
    .filter((line) => /^\s*[-a-z]+:/.test(line))
    .filter((line) => /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/.test(line));

  assert.deepEqual(
    mentah.map((line) => line.trim()),
    [],
    "warna harus lewat token supaya tema gelap tidak perlu menyebut selektor ini",
  );
});
