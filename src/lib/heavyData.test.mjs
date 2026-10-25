import assert from "node:assert";
import test from "node:test";
import { needsRoiSnapshots, needsUserReports } from "./heavyData.js";

test("hanya tab Grafik dan ROI yang membutuhkannya", () => {
  assert.equal(needsRoiSnapshots({ kind: "dashboard", key: "dashboard", tab: "grafik" }), true);
  assert.equal(needsRoiSnapshots({ kind: "dashboard", key: "dashboard", tab: "roi" }), true);
  // Ringkasan dan Kalender membaca baris HARIAN — baris snapshot kumulatif sejak tengah malam, dan
  // menjumlahkannya per hari melipatgandakan pendapatan.
  assert.equal(needsRoiSnapshots({ kind: "dashboard", key: "dashboard", tab: "ringkasan" }), false);
  assert.equal(needsRoiSnapshots({ kind: "dashboard", key: "dashboard", tab: "kalender" }), false);
});

test("profil user membutuhkannya, form dan daftarnya tidak", () => {
  assert.equal(needsRoiSnapshots({ kind: "detail", key: "users", id: "-Nabc" }), true);
  assert.equal(needsRoiSnapshots({ kind: "form", key: "users", id: "-Nabc" }), false);
  assert.equal(needsRoiSnapshots({ kind: "list", key: "users" }), false);
});

test("halaman lain tidak, termasuk yang berat sendiri", () => {
  for (const route of [
    { kind: "profitLoss", key: "profitLoss" },
    { kind: "cashFlow", key: "cashFlow" },
    { kind: "spending", key: "spending" },
    { kind: "detail", key: "subDomains", id: "-Nabc" },
    { kind: "missing" },
  ]) {
    assert.equal(needsRoiSnapshots(route), false, JSON.stringify(route));
  }
});

test("route yang belum ada tidak melempar", () => {
  assert.equal(needsRoiSnapshots(undefined), false);
  assert.equal(needsRoiSnapshots(null), false);
});

test("userReports: Profile User DAN tab ROI — countryRoi mengisi keduanya", () => {
  assert.equal(needsUserReports({ kind: "detail", key: "users", id: "-Nabc" }), true);
  // Rincian negara tiap baris "Laporan ROI Realtime" menyisir countryRoi SELURUH user.
  assert.equal(needsUserReports({ kind: "dashboard", key: "dashboard", tab: "roi" }), true);
  // Form dan daftar tidak menggambar satu pun panel riwayat itu.
  assert.equal(needsUserReports({ kind: "form", key: "users", id: "-Nabc" }), false);
  assert.equal(needsUserReports({ kind: "list", key: "users" }), false);
});

test("userReports: dua langganan berat, dua jawaban berbeda", () => {
  // Grafik butuh roiSnapshots tapi tidak menggambar satu pun rincian negara. Meleburnya
  // mengembalikan 2,81 MB ke halaman yang tidak memakainya.
  const grafik = { kind: "dashboard", key: "dashboard", tab: "grafik" };
  assert.equal(needsRoiSnapshots(grafik), true);
  assert.equal(needsUserReports(grafik), false);
  // Ringkasan dan Kalender tidak butuh keduanya.
  for (const tab of ["ringkasan", "kalender"]) {
    const route = { kind: "dashboard", key: "dashboard", tab };
    assert.equal(needsRoiSnapshots(route), false, tab);
    assert.equal(needsUserReports(route), false, tab);
  }
});

test("userReports: detail koleksi lain dan route kosong tidak melempar", () => {
  assert.equal(needsUserReports({ kind: "detail", key: "subDomains", id: "-Nabc" }), false);
  assert.equal(needsUserReports(undefined), false);
  assert.equal(needsUserReports(null), false);
});
