// One-off: buang `budgetPerDay` dari tiap baris `users`.
//
//   npm run migrate:drop-budget -- --dry
//   npm run migrate:drop-budget
//
// KENAPA INI PERLU ADA. Halaman /spending sempat menyimpan budget/hari tiap advertiser di baris
// user-nya, dan sempat punya tombol "bagi rata" yang mengisinya sekaligus. Sekali ditekan, ia
// menulis Rp 333.333 ke baris SETIAP orang di tim — angka yang lahir dari satu percobaan proyeksi,
// lalu berdiri di profil mereka sebagai fakta, ikut terbaca setiap akun yang login (`users`
// `.read: auth != null`) dan ikut terbawa ke tiap laporan yang membacanya.
//
// Halaman itu sekarang kalkulator: angkanya tinggal di alamat halaman, dan yang boleh tinggal di
// RTDB cuma yang datang dari API. Field-nya sudah tidak dibaca satu baris kode pun — yang tersisa
// hanya nilai yang terlanjur tertulis, dan nilai yatim di node yang dibaca seluruh tim adalah
// angka yang suatu hari akan dipercaya seseorang.
//
// Idempotent: yang disentuh hanya baris yang MASIH punya field-nya, jadi menjalankannya dua kali
// tidak mengubah apa-apa pada kali kedua. Baris terarsip (`deletedAt`) ikut dibersihkan — ia tetap
// terbaca oleh yang membuka arsip.

import { get, ref, update } from "firebase/database";
import { connect } from "../db.mjs";

const dry = process.argv.includes("--dry");
const db = await connect();

const users = (await get(ref(db, "users"))).val() || {};
const affected = Object.entries(users).filter(
  ([, row]) => row && row.budgetPerDay !== undefined && row.budgetPerDay !== null,
);

if (!affected.length) {
  console.log("Tidak ada baris users yang membawa budgetPerDay. Tidak ada yang perlu dibuang.");
  process.exit(0);
}

for (const [id, row] of affected) {
  console.log(`  ${row.name || id}: ${row.budgetPerDay}`);
}
console.log(`${affected.length} baris membawa budgetPerDay.`);

if (dry) {
  console.log("--dry: tidak ada yang ditulis.");
  process.exit(0);
}

// `null` pada sebuah child adalah cara RTDB menghapusnya. Ditulis per baris, bukan satu update
// besar berkunci "users": yang kedua akan menghapus seluruh koleksi kalau path-nya salah ketik.
for (const [id] of affected) {
  await update(ref(db, `users/${id}`), { budgetPerDay: null });
}

console.log(`Selesai. ${affected.length} baris dibersihkan.`);
process.exit(0);
