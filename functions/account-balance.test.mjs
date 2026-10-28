import assert from "node:assert/strict";
import test from "node:test";
import { balanceMonth, balanceSplit, parseMoney, unpaidBalance } from "./account-balance.js";

// Bentuk yang benar-benar dikembalikan API produksi (4 Sep 2026) plus contoh dari dokumen Google.
test("parseMoney membaca kode maupun simbol mata uang", () => {
  assert.deepEqual(parseMoney("IDR 55,781,000"), { amount: 55781000, currency: "IDR" });
  assert.deepEqual(parseMoney("$1,227.48"), { amount: 1227.48, currency: "USD" });
  assert.deepEqual(parseMoney("¥1,235 JPY"), { amount: 1235, currency: "JPY" });
  assert.deepEqual(parseMoney("£87.65"), { amount: 87.65, currency: "GBP" });
  // Nol yang sah: akun yang saldonya benar-benar kosong.
  assert.deepEqual(parseMoney("IDR 0"), { amount: 0, currency: "IDR" });
});

// Yang tidak dikenali menjawab null, bukan 0 — nol adalah pernyataan bahwa akunnya tidak punya
// saldo, dan itu pernyataan yang salah untuk bentuk yang belum pernah kita lihat.
test("parseMoney menolak yang tidak bisa dipastikan", () => {
  assert.equal(parseMoney(""), null);
  assert.equal(parseMoney("1.227,48 EUR-gaya-Eropa 1.227,48"), null);
  assert.equal(parseMoney("55,781,000"), null, "tanpa mata uang");
  assert.equal(parseMoney("IDR sebentar lagi"), null);
});

test("unpaidBalance melewati saldo YouTube", () => {
  const payments = [
    { name: "accounts/pub-1/payments/youtube-unpaid", amount: "IDR 1,284" },
    { name: "accounts/pub-1/payments/unpaid", amount: "IDR 195,441,530" },
    { name: "accounts/pub-1/payments/20260821", amount: "IDR 160,989,523" },
  ];
  assert.deepEqual(unpaidBalance(payments), { amount: 195441530, currency: "IDR" });
  assert.equal(
    unpaidBalance([{ name: "accounts/pub-1/payments/20260821", amount: "IDR 1" }]),
    null,
  );
  assert.equal(unpaidBalance([]), null);
});

test("balanceMonth mengambil bulan kalender penuh terakhir", () => {
  assert.deepEqual(balanceMonth("2026-09-04"), {
    startDate: { year: 2026, month: 8, day: 1 },
    endDate: { year: 2026, month: 8, day: 31 },
  });
  // Januari mundur ke Desember tahun sebelumnya, dan Februari tidak pernah dihitung 30 hari.
  assert.deepEqual(balanceMonth("2026-01-15").startDate, { year: 2025, month: 12, day: 1 });
  assert.deepEqual(balanceMonth("2026-03-01").endDate, { year: 2026, month: 2, day: 28 });
  assert.deepEqual(balanceMonth("2024-03-01").endDate, { year: 2024, month: 2, day: 29 });
  assert.equal(balanceMonth(""), null);
});

// Angka nyata petcins.com, 4 Sep 2026: saldo IDR 55.781.000, AFC Agustus IDR 502.600.
test("balanceSplit menaruh sisanya di Ad-Exchange", () => {
  const out = balanceSplit({
    balance: { amount: 55781000, currency: "IDR" },
    adsenseEarning: 502600,
    rate: 1,
  });
  assert.equal(out.saldo, 55781000);
  assert.equal(out.saldoAdsense, 502600);
  assert.equal(out.saldoAdExchange, 55278400);
  assert.equal(out.saldoAdsense + out.saldoAdExchange, out.saldo, "pecahannya berjumlah saldo");
  assert.equal(out.saldoFxRate, null, "baris IDR dibiarkan bersih");
  assert.equal(out.saldoDetail, null, "keterangan lama dihapus, bukan ditulis kosong");
});

test("balanceSplit menormalkan mata uang asing ke IDR", () => {
  const out = balanceSplit({
    balance: { amount: 1227.48, currency: "USD" },
    adsenseEarning: 1.5,
    rate: 16000,
  });
  assert.equal(out.saldo, 19639680);
  assert.equal(out.saldoCurrency, "USD");
  assert.equal(out.saldoFxRate, 16000);
  assert.equal(out.saldoAdsense, 24000);
});

// Nilai lama dibiarkan berdiri: yang gagal TIDAK menulis Rp 0 ke kolom Saldo.
test("balanceSplit hanya menulis keterangan saat saldonya tidak terbaca", () => {
  assert.deepEqual(Object.keys(balanceSplit({ balance: null })), ["saldoDetail"]);
  assert.deepEqual(
    Object.keys(balanceSplit({ balance: { amount: 1, currency: "XAU" }, rate: null })),
    ["saldoDetail"],
  );
});

// Totalnya tetap ditulis — ia tidak bergantung pada laporan yang gagal itu — tapi pecahan LAMA
// dikosongkan: dua angka dari dua hari berbeda yang berdiri di satu baris tidak bisa dibedakan.
test("balanceSplit mengosongkan pecahan saat laporan AdSense gagal", () => {
  const out = balanceSplit({
    balance: { amount: 55781000, currency: "IDR" },
    adsenseEarning: null,
    adsenseNote: "AdSense GET /reports -> 403: SERVICE_DISABLED",
    rate: 1,
  });
  assert.equal(out.saldo, 55781000);
  assert.equal(out.saldoAdsense, null);
  assert.equal(out.saldoAdExchange, null);
  assert.match(out.saldoDetail, /SERVICE_DISABLED/);
});

// Residu minus adalah keadaan yang sah (potongan final memakan sisanya), dan
// "Ad-Exchange -Rp 300.000" adalah klaim yang tidak pernah benar.
test("balanceSplit menolak residu minus", () => {
  const out = balanceSplit({
    balance: { amount: 100000, currency: "IDR" },
    adsenseEarning: 900000,
    rate: 1,
  });
  assert.equal(out.saldo, 100000);
  assert.equal(out.saldoAdExchange, null);
  assert.match(out.saldoDetail, /melebihi saldo/);
});
