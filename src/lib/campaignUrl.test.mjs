import assert from "node:assert/strict";
import { test } from "node:test";
import { campaignUrlForCodes, subDomainRows } from "./campaignUrl.js";

const url = (alias) => `https://rabbitracing.live/${alias}?bit=[race]`;

test("satu link per kode, dan yang tidak disebut kode tidak ikut", () => {
  const stored = [url("2jvm2W7J"), url("JsFTQbDw"), url("xxxYYYY")].join(", ");

  assert.equal(campaignUrlForCodes(stored, "2W7J"), url("2jvm2W7J"));
  // Dua kode diketik, dua link digambar — jumlahnya mengikuti kode, bukan jumlah campaign.
  assert.equal(
    campaignUrlForCodes(stored, "2W7J, QbDw"),
    [url("2jvm2W7J"), url("JsFTQbDw")].join(", "),
  );
});

test("urutannya urutan kode yang diketik", () => {
  const stored = [url("2jvm2W7J"), url("JsFTQbDw")].join(", ");

  assert.equal(
    campaignUrlForCodes(stored, "QbDw 2W7J"),
    [url("JsFTQbDw"), url("2jvm2W7J")].join(", "),
  );
});

test("kode dicocokkan tanpa peduli besar kecil hurufnya", () => {
  // Kode diketik orang; alias dibuat Keitaro. Yang gagal cocok tidak berbunyi sebagai kesalahan
  // apa pun — kolomnya cuma menggambar seluruh link, seperti sebelum penyaringan ini ada.
  assert.equal(campaignUrlForCodes(url("2jvm2W7J"), "2w7j"), url("2jvm2W7J"));
});

test("kode yang tidak punya link tidak menggambar link milik kode lain", () => {
  const stored = [url("2jvm2W7J"), url("JsFTQbDw")].join(", ");

  assert.equal(campaignUrlForCodes(stored, "2W7J, mxcb"), url("2jvm2W7J"));
});

test("satu link tidak dipakai dua kali", () => {
  // Kode yang satu adalah potongan dari yang lain: tanpa penjagaan ini keduanya menunjuk link yang
  // sama, dan kolomnya menggambar satu link dua kali.
  assert.equal(campaignUrlForCodes(url("2jvm2W7J"), "2W7J, W7J"), url("2jvm2W7J"));
});

test("yang tidak cocok satu pun dibiarkan utuh", () => {
  const stored = [url("2jvm2W7J"), url("JsFTQbDw")].join(", ");

  // Kolom Kode Campaign yang masih kosong: link-nya tetap ada, dan menyembunyikannya membuat
  // kolom ini kosong justru untuk baris yang paling perlu dilengkapi.
  assert.equal(campaignUrlForCodes(stored, ""), stored);
  assert.equal(campaignUrlForCodes(stored, "mxcb"), stored);
});

test("baris tanpa campaign url tidak disentuh", () => {
  assert.equal(campaignUrlForCodes("", "2W7J"), "");
  assert.equal(campaignUrlForCodes(undefined, "2W7J"), undefined);
  assert.equal(campaignUrlForCodes(null, "2W7J"), null);
});

test("baris yang tidak berubah dikembalikan apa adanya", () => {
  const rows = [
    { id: "a", campaignCodes: "2W7J", campaignUrl: [url("2jvm2W7J"), url("JsFTQbDw")].join(", ") },
    { id: "b", campaignCodes: "mxcb", campaignUrl: url("zzzz") },
    { id: "c" },
  ];
  const derived = subDomainRows(rows);

  assert.equal(derived[0].campaignUrl, url("2jvm2W7J"));
  assert.equal(derived[1], rows[1], "yang tidak disaring tetap objek yang sama");
  assert.equal(derived[2], rows[2]);
});
