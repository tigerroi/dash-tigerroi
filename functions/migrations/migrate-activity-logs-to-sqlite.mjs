// One-off migration: salin jejak aktivitas dari RTDB `activityLogs` ke SQLite lokal di server VPS.
//
// Jejak pindah dari RTDB ke SQLite (server/activity-db.js) karena node itu paling cepat tumbuh dan
// menyeret database yang dibaca halaman lain. Baris yang sudah ada tetap ingin terbaca di hari-hari
// pertama setelah migrasi, jadi ~30 hari terakhir disalin dulu, bukan dibiarkan hilang.
//
// JALANKAN DI VPS, DI BAWAH BUN, sebagai SUPERADMIN — dua alasan:
//   - openActivityDb memakai `bun:sqlite`, jadi bukan `node`.
//   - `.read` pada activityLogs adalah SUPERADMIN (lihat database.rules.json); SYNC_USER yang admin
//     tidak bisa membacanya. Set SYNC_USER_EMAIL/PASSWORD ke akun superadmin untuk run ini.
//
//   ACTIVITY_DB_PATH=/data/activity.sqlite \
//   SYNC_USER_EMAIL=super@... SYNC_USER_PASSWORD=... \
//   bun functions/migrations/migrate-activity-logs-to-sqlite.mjs
//
// Idempoten: insertRows memakai INSERT OR REPLACE berkunci id, jadi dijalankan dua kali menimpa
// baris yang sama, tidak menggandakannya. Tidak menghapus apa pun dari RTDB — setelah hasilnya
// diverifikasi, node `activityLogs` dan aturannya di database.rules.json dibuang manual.

import { get, ref } from "firebase/database";
import { openActivityDb } from "../../server/activity-db.js";
import { connect } from "../db.mjs";

const db = await connect().catch((error) => {
  console.error(`Gagal masuk (butuh akun SUPERADMIN untuk membaca activityLogs): ${error.message}`);
  process.exit(1);
});

const value = (await get(ref(db, "activityLogs"))).val() || {};
const rows = Object.entries(value).map(([id, row]) => ({ ...row, id }));

if (!rows.length) {
  console.log("activityLogs kosong — tidak ada yang disalin.");
  process.exit(0);
}

const activityDb = openActivityDb();
// Sepotong demi sepotong: satu node 30 hari bisa puluhan ribu baris, dan satu transaksi raksasa
// menahan seluruhnya di memori tanpa alasan.
const CHUNK = 1000;
let done = 0;
for (let i = 0; i < rows.length; i += CHUNK) {
  done += activityDb.insertRows(rows.slice(i, i + CHUNK));
}

console.log(
  `${done} baris disalin ke SQLite (${process.env.ACTIVITY_DB_PATH || "./activity.sqlite"}).`,
);
process.exit(0);
