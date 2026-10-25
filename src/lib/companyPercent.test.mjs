import assert from "node:assert/strict";
import { test } from "node:test";
import { companyPercentIndex, companyPercentRows } from "./companyPercent.js";

const rows = [
  { id: "a", domain: "alpha.com", percent: 10, effectiveFrom: "2026-01-01" },
  { id: "b", domain: "alpha.com", percent: 20, effectiveFrom: "2026-06-15" },
  { id: "c", domain: "beta.com", percent: 15, effectiveFrom: "2026-03-01" },
];

test("tarif yang berlaku pada sebuah tanggal", () => {
  const { percentAt } = companyPercentIndex(rows);

  assert.equal(percentAt("alpha.com", "2026-05-31"), 10);
  assert.equal(percentAt("alpha.com", "2026-06-14"), 10, "sehari sebelum berlaku, masih yang lama");
  assert.equal(percentAt("alpha.com", "2026-06-15"), 20, "hari berlakunya sendiri sudah yang baru");
  assert.equal(percentAt("alpha.com", "2026-12-31"), 20, "yang terakhir berlaku sampai kapan pun");
});

test("sebelum baris paling awal TIDAK jatuh ke baris paling awal", () => {
  const { percentAt } = companyPercentIndex(rows);

  assert.equal(
    percentAt("beta.com", "2026-02-28"),
    null,
    "tarif yang diisi hari ini tidak boleh menyentuh laba bulan lampau",
  );
});

test("domain yang tidak punya baris sama sekali menghasilkan null, bukan 0", () => {
  const { percentAt } = companyPercentIndex(rows);
  assert.equal(percentAt("gamma.com", "2026-06-01"), null);
});

test("tarif KOSONG berarti 'sejak tanggal ini tidak diketahui', bukan tarif lama diteruskan", () => {
  const { percentAt } = companyPercentIndex([
    { domain: "alpha.com", percent: 10, effectiveFrom: "2026-01-01" },
    { domain: "alpha.com", percent: "", effectiveFrom: "2026-06-01" },
  ]);

  assert.equal(percentAt("alpha.com", "2026-05-31"), 10);
  assert.equal(percentAt("alpha.com", "2026-06-01"), null);
});

test("nama domain dicocokkan tanpa peduli besar-kecil huruf dan spasi", () => {
  const { percentAt } = companyPercentIndex([
    { domain: "  Alpha.COM ", percent: 10, effectiveFrom: "2026-01-01" },
  ]);
  assert.equal(percentAt("alpha.com", "2026-02-01"), 10);
});

test("baris tanpa tanggal berlaku dilewati — ia tidak bisa dicari siapa pun", () => {
  const { percentAt } = companyPercentIndex([
    { domain: "alpha.com", percent: 10, effectiveFrom: "" },
    { domain: "alpha.com", percent: 30, effectiveFrom: "2026-01-01" },
  ]);
  assert.equal(percentAt("alpha.com", "2026-02-01"), 30);
});

test("dua baris bertanggal sama diputus updatedAt — yang disimpan belakangan menang", () => {
  const { percentAt } = companyPercentIndex([
    { domain: "alpha.com", percent: 10, effectiveFrom: "2026-01-01", updatedAt: "2026-01-01T00:00:00Z" },
    { domain: "alpha.com", percent: 25, effectiveFrom: "2026-01-01", updatedAt: "2026-02-01T00:00:00Z" },
  ]);
  assert.equal(percentAt("alpha.com", "2026-03-01"), 25);
});

test("berlaku s/d adalah sehari sebelum tarif berikutnya, dan menyeberang bulan", () => {
  const derived = companyPercentRows(
    [
      { id: "a", domain: "alpha.com", percent: 10, effectiveFrom: "2026-01-01" },
      { id: "b", domain: "alpha.com", percent: 20, effectiveFrom: "2026-09-01" },
    ],
    {},
    new Date(2026, 8, 15),
  );

  assert.equal(derived[0].effectiveTo, "2026-08-31", "bukan 2026-09-00");
  assert.equal(derived[1].effectiveTo, "", "yang terakhir tidak punya ujung");
});

test("empat status, dan keempatnya berarti tindakan berbeda", () => {
  const derived = companyPercentRows(
    [
      { id: "lalu", domain: "alpha.com", percent: 10, effectiveFrom: "2026-01-01" },
      { id: "kini", domain: "alpha.com", percent: 20, effectiveFrom: "2026-06-15" },
      { id: "nanti", domain: "alpha.com", percent: 25, effectiveFrom: "2026-12-01" },
      { id: "sendiri", domain: "beta.com", percent: 15, effectiveFrom: "2026-03-01" },
    ],
    {},
    new Date(2026, 8, 2),
  );
  const statusOf = (id) => derived.find((row) => row.id === id).status;

  assert.equal(statusOf("lalu"), "Berakhir", "tetap dipakai bulan lampau — bukan baris mati");
  assert.equal(statusOf("kini"), "Aktif");
  assert.equal(statusOf("nanti"), "Terjadwal");
  assert.equal(statusOf("sendiri"), "Aktif", "satu-satunya baris domainnya");
});

test("tarif yang tidak pernah berlaku sehari pun ditandai Ditimpa", () => {
  const derived = companyPercentRows(
    [
      { id: "a", domain: "alpha.com", percent: 10, effectiveFrom: "2026-06-01", updatedAt: "1" },
      { id: "b", domain: "alpha.com", percent: 20, effectiveFrom: "2026-06-01", updatedAt: "2" },
    ],
    {},
    new Date(2026, 8, 2),
  );

  assert.equal(derived[0].status, "Ditimpa", "hampir selalu salah ketik tanggal");
  assert.equal(derived[1].status, "Aktif");
});

test("urutan status sama dengan urutan yang dipakai pencarinya", () => {
  const list = [
    { domain: "alpha.com", percent: 10, effectiveFrom: "2026-01-01" },
    { domain: "alpha.com", percent: 20, effectiveFrom: "2026-06-15" },
  ];
  const now = new Date(2026, 8, 2);
  const active = companyPercentRows(list, {}, now).find((row) => row.status === "Aktif");
  const { percentAt } = companyPercentIndex(list);

  assert.equal(
    active.percent,
    percentAt("alpha.com", "2026-09-02"),
    "kolom yang menyebut sebuah baris Aktif harus baris yang sama dengan yang dipakai Laba Rugi",
  );
});
