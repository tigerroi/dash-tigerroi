// One-off: lepas tanda `partial` dari baris `dashboard/roiReports` yang tanggalnya sudah lewat.
//
//   npm run migrate:stale-partial -- --dry
//   npm run migrate:stale-partial
//
// KENAPA INI PERLU ADA. Run hari berjalan menulis baris tiap subdomain yang muncul di laporan jam
// itu, bertanda `partial: true`. Run berikutnya, yang menulis hari itu sebagai hari selesai, dulu
// hanya menyentuh subdomain yang muncul di laporan FINAL-nya — jadi subdomain yang sempat
// menghasilkan Rp 5 pukul 06:00 lalu tidak ada di laporan final ditinggalkan bertanda partial
// selamanya. Per 16 Sep 2026: 30 baris sejak 20 Agu, hampir tiap hari satu atau dua. Di Kalender
// satu baris begitu cukup membuat seluruh harinya berlabel "berjalan" dan terbuang dari sampel
// "potensi". Sync sudah menulis ulang sisa seperti itu (`leftoverRunningIds`); yang tersisa baris
// lama, dan tidak ada run yang akan menyentuhnya lagi.
//
// YANG DIUBAH CUMA TANDANYA, BUKAN ANGKANYA. Menulis ulang dari laporan final menuntut laporan
// GAM dan Meta hari-hari itu diminta lagi, dan yang dipertaruhkan hampir seluruhnya receh (Rp 0
// sampai ratusan rupiah). Angka setengah hari yang tetap berdiri adalah satu-satunya angka yang
// pernah ada untuk baris itu; tanda "berjalan" pada hari yang sudah lewat tiga minggu adalah
// kekeliruan yang pasti.
//
// Batasnya HARI INI dalam zona operasi (`zonedDateKey`), bukan "hari partial terbaru": dengan
// SYNC_INCLUDE_TODAY=0 hari partial terbaru sendiri bisa sisa yang tertinggal. Baris hari ini tidak
// disentuh — ia memang sedang berjalan. Idempotent: yang kedua kali tidak menemukan apa pun.

import { get, ref, update } from "firebase/database";
import { connect } from "../db.mjs";
import { zonedDateKey } from "../sync-core.js";

const dry = process.argv.includes("--dry");
const db = await connect();
const today = zonedDateKey(new Date());

const rows = (await get(ref(db, "dashboard/roiReports"))).val() || {};
const stale = Object.entries(rows).filter(
  ([key, row]) =>
    /^\d{4}-\d{2}-\d{2}__/.test(key) && row?.partial === true && key.slice(0, 10) < today,
);

if (!stale.length) {
  console.log(`Tidak ada baris bertanda partial sebelum ${today}. Tidak ada yang perlu diubah.`);
  process.exit(0);
}

for (const [key, row] of stale) {
  console.log(`  ${key.slice(0, 10)}  ${row.subDomain || key}  earning=${row.earning ?? "-"}`);
}
console.log(`${stale.length} baris bertanda partial sebelum ${today}.`);

if (dry) {
  console.log("--dry: tidak ada yang ditulis.");
  process.exit(0);
}

// Satu update berpath penuh per field, bukan objek baris: yang lain di baris itu tidak disentuh.
const writes = Object.fromEntries(stale.map(([key]) => [`${key}/partial`, false]));
await update(ref(db, "dashboard/roiReports"), writes);

console.log(`Selesai. ${stale.length} baris dilepas tandanya.`);
process.exit(0);
