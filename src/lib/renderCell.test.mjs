import assert from "node:assert/strict";
import { test } from "node:test";

// `renderCell` mengembalikan elemen React, jadi yang diuji di sini adalah ATURAN yang menentukan
// sebuah sel digambar sebagai uang atau sebagai kalimat — satu-satunya bagian yang pernah salah,
// dan yang salahnya tidak berbunyi sebagai kesalahan apa pun di layar.
//
// Disalin dari renderCell.jsx dengan sengaja: berkas itu JSX, dan test runner ini menjalankan .mjs
// polos. Yang dijaga di bawah adalah bahwa pola di sini SAMA dengan yang di sana — dibaca dari
// berkasnya, bukan dipercaya begitu saja.
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./renderCell.jsx", import.meta.url), "utf8");

const PATTERN = /^-?\s*rp\s*[\d.,]+$/i;
const isRupiahText = (value) => typeof value === "string" && PATTERN.test(value.trim());
// Bagaimana sebuah sel uang dibaca jadi angka, kalau ia lolos pemeriksaan di atas.
const parseRupiah = (value) => Number(String(value).replace(/[^\d-]/g, "") || 0);

test("polanya sama persis dengan yang dipakai renderCell.jsx", () => {
  assert.ok(
    source.includes(PATTERN.source),
    "pola di test ini harus sama dengan `isRupiahText` di renderCell.jsx",
  );
});

test("teks berformat rupiah tetap digambar sebagai uang", () => {
  // Baris LAMA yang menyimpan uangnya sebagai teks — seluruh alasan pemeriksaan ini ada.
  assert.ok(isRupiahText("Rp 1.000"));
  assert.ok(isRupiahText("Rp1.000"));
  assert.ok(isRupiahText("-Rp 1.000"));
  assert.ok(isRupiahText("rp 1000"));
  assert.ok(isRupiahText("Rp 1.000,50"));
  assert.ok(isRupiahText(" Rp 1.000 "), "spasi di ujung bukan bagian dari nilainya");
});

/**
 * Kolom Kode PIP di halaman Pencairan: kutipan notifikasi pembayaran Google, yang MEMUAT sebuah
 * nominal di tengah kalimatnya.
 *
 * Sebelum polanya dijangkarkan, kalimat ini lolos sebagai "uang" — lalu seluruh non-digitnya
 * disisir, dan nomor rekening (017), nominalnya (38.690.091), serta kode PIP-nya (104I25R0)
 * terkelem jadi satu angka: Rp 1.738.690.091.104.250.
 */
test("kalimat yang MENYEBUT nominal bukan sel uang", () => {
  const kodePip =
    "Pembayaran otomatis tertunda: Rekening bank  • • • •  017 sebesar Rp 38.690.091. GG104I25R0";

  assert.equal(isRupiahText(kodePip), false);
  // Inilah angka yang tergambar kalau pemeriksaannya longgar — dicatat supaya kalau pola itu
  // dilonggarkan lagi suatu hari, yang gagal adalah test ini dan bukan orang yang membaca tabel.
  assert.equal(parseRupiah(kodePip), 1738690091104250);
});

test("kalimat lain yang memuat nominal ikut aman", () => {
  // Catatan bebas di Expenses/Reminder jatuh ke lubang yang sama sebelum ini.
  assert.equal(isRupiahText("sudah dibayar Rp 500.000 lewat transfer"), false);
  assert.equal(
    isRupiahText(
      "Automatic payment: Wire transfer to bank account  • • • • 0624 for $2,271.89. GG104HWN56",
    ),
    false,
  );
  assert.equal(isRupiahText("Saldo Pencairan Sudah Diminuskan Google (FIX Tidak Cair)"), false);
});

test("yang bukan teks tidak pernah lolos ke pemeriksaan ini", () => {
  // Angka dari sync sudah ditangani cabang `moneyKeys` di atasnya; yang di sini cuma teks.
  assert.equal(isRupiahText(1000), false);
  assert.equal(isRupiahText(null), false);
  assert.equal(isRupiahText(""), false);
  // Client id Google — alasan pemeriksaan ini tidak boleh cuma mencari huruf "rp".
  assert.equal(isRupiahText("930127.apps.googleusercontent.com"), false);
});

// --- Tautan --------------------------------------------------------------------------------
//
// Disiplin yang sama dengan `isRupiahText` di atas, dan pola yang sama dibaca dari berkas
// seberangnya: sebuah sel adalah tautan kalau SELURUH isinya tautan.
const URL_PATTERN = /^https?:\/\/\S+$/;
const urlList = (value) => {
  if (typeof value !== "string") return null;
  const parts = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.length) return null;
  return parts.every((part) => URL_PATTERN.test(part)) ? parts : null;
};

test("pola tautan sama persis dengan yang dipakai renderCell.jsx", () => {
  assert.ok(
    source.includes(URL_PATTERN.source),
    "pola di test ini harus sama dengan `urlList` di renderCell.jsx",
  );
});

test("sel berisi campaign URL digambar sebagai tautan", () => {
  assert.deepEqual(urlList("https://rabbitracing.live/JsFTQbDw?bit=[race]"), [
    "https://rabbitracing.live/JsFTQbDw?bit=[race]",
  ]);
  // Satu subdomain menaungi beberapa campaign — dan masing-masing link berdiri sendiri, bukan
  // satu <a> yang teksnya memuat koma.
  assert.deepEqual(urlList("https://a.test/x, https://b.test/y"), [
    "https://a.test/x",
    "https://b.test/y",
  ]);
});

test("yang bukan seluruhnya tautan tetap kalimat", () => {
  assert.equal(urlList("sudah dipindah ke https://a.test per Agustus"), null);
  // Hostname telanjang (`domainUrl` di /domains): tanpa skema, href-nya dibaca browser sebagai
  // path relatif dan tautannya mengirim orang ke halaman dashboard yang tidak ada.
  assert.equal(urlList("designingaround.com"), null);
  assert.equal(urlList(""), null);
  assert.equal(urlList(12), null);
});
