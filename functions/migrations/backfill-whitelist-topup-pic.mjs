// One-off: isi `pic` pada baris `whitelistTopup` yang ditulis sebelum kolom itu ada.
//
//   npm run migrate:topup-pic -- --dry
//   npm run migrate:topup-pic
//
// KENAPA INI PERLU ADA. Halaman Whitelist Top-Up sekarang menyimpan PIC di barisnya — diisi
// otomatis dari `adAccounts.userOwner` akun yang dipilih di Nama / Kode. Baris lama tidak
// membawanya, jadi kolom PIC-nya berbunyi "-" untuk seluruh riwayat, dan Proyeksi Budget harus
// menebak pemiliknya lewat pemetaan akun yang cuma tahu keadaan HARI INI.
//
// Yang diisikan adalah pemilik akun saat migrasi ini dijalankan — itu satu-satunya kepemilikan yang
// tercatat di mana pun. Akun yang sudah berpindah tangan akan membekukan pemilik BARUNYA ke setoran
// lama; itu tidak lebih buruk daripada keadaan sekarang (pemetaan yang sama, dibaca ulang tiap kali
// halaman dibuka), dan sejak dibekukan ia berhenti bergeser lagi. Baris yang PIC-nya salah karena
// itu dibetulkan lewat halamannya, satu per satu.
//
// Idempotent: yang disentuh hanya baris yang `pic`-nya masih kosong. Baris yang akunnya tidak
// ditemukan, atau akunnya belum punya User Pemilik, DILEWATI dan disebutkan di ringkasan — nama
// tebakan lebih buruk daripada sel kosong, karena porsi dana orang lain ikut bergeser karenanya.
// Baris terarsip (`deletedAt`) ikut diisi: ia tetap terbaca oleh yang membuka arsip.

import { get, ref, update } from "firebase/database";
import { connect } from "../db.mjs";

const dry = process.argv.includes("--dry");
const db = await connect();

const accountName = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase();

const accounts = (await get(ref(db, "adAccounts"))).val() || {};
const ownerByName = new Map();
for (const row of Object.values(accounts)) {
  const name = accountName(row?.name);
  const owner = String(row?.userOwner ?? "").trim();
  if (name && owner) ownerByName.set(name, owner);
}

const topups = (await get(ref(db, "whitelistTopup"))).val() || {};
const pending = Object.entries(topups).filter(
  ([, row]) => row && !String(row.pic ?? "").trim(),
);

const filled = [];
const skipped = [];
for (const [id, row] of pending) {
  const owner = ownerByName.get(accountName(row.namaKode));
  if (owner) filled.push([id, row, owner]);
  else skipped.push([id, row]);
}

console.log(`${Object.keys(topups).length} baris whitelistTopup, ${pending.length} tanpa PIC.`);
for (const [, row, owner] of filled) {
  console.log(`  ${row.date || "?"} ${row.namaKode || "?"} -> ${owner}`);
}
for (const [, row] of skipped) {
  console.log(`  ${row.date || "?"} ${row.namaKode || "?"} -> (dilewati: akun tanpa User Pemilik)`);
}

if (!filled.length) {
  console.log("Tidak ada yang bisa diisi.");
  process.exit(0);
}

if (dry) {
  console.log(`--dry: tidak ada yang ditulis. ${filled.length} baris akan diisi.`);
  process.exit(0);
}

// Ditulis per baris, bukan satu update besar berkunci "whitelistTopup": yang kedua menimpa seluruh
// koleksi kalau path-nya salah ketik.
for (const [id, , owner] of filled) {
  await update(ref(db, `whitelistTopup/${id}`), { pic: owner });
}

console.log(
  `Selesai. ${filled.length} baris diisi, ${skipped.length} dilewati (isi User Pemilik akunnya di /ad-accounts lalu jalankan lagi).`,
);
process.exit(0);
