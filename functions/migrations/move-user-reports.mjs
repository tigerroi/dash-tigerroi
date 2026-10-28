// One-off: riwayat panel Profile User pindah dari `users/{id}` ke `userReports/{id}`.
//
//   npm run migrate:user-reports -- --dry
//   npm run migrate:user-reports
//   npm run migrate:user-reports -- --drop-legacy
//
// KENAPA INI PERLU ADA. `users` dilanggan browser SETIAP akun pada SETIAP muat halaman — ia yang
// memberi nama, PIC, dan baris campaign ke hampir tiap layar. Empat cabang di bawahnya tidak dibaca
// satu layar pun di luar `/users/{id}`, dan per 8 Sep 2026 keempatnya 2,81 MB dari 3,12 MB node itu:
// orang yang cuma membuka Domains mengunduh riwayat spend campaign 90 hari milik lima advertiser
// untuk menggambar tabel domain. Ditambah satu yang tidak terlihat di angka muat halaman —
// `countryRoi` (745 KB) ditulis ulang UTUH tiap sync, jadi tiap tab yang dibiarkan terbuka menerima
// 745 KB delta per jam untuk panel yang tidak sedang digambar.
//
// DUA LANGKAH, DAN PEMISAHANNYA DISENGAJA. Yang pertama MENYALIN (tanpa `--drop-legacy`): sesudahnya
// data berdiri di kedua tempat, dan itu keadaan yang aman untuk di-deploy — UserDetail membaca
// cabang baru dengan cabang lama sebagai cadangan, jadi bundel lama maupun baru sama-sama menemukan
// datanya. Yang kedua MEMBUANG cabang lama, dan itu baru boleh dijalankan sesudah bundel barunya
// benar-benar tayang. Dibalik, ada jendela di mana panel Profile User kosong untuk semua orang.
//
// IDEMPOTENT: kunci tujuannya turunan penuh dari kunci asalnya (`userReports/{uid}/{cabang}/{key}`),
// jadi menyalin dua kali menulis nilai yang sama ke alamat yang sama. Tidak ada push key di mana pun
// di jalur ini.
//
// YANG SUDAH ADA DI TUJUAN TIDAK DITIMPA, dan itu bukan kehati-hatian berlebih: begitu sync versi
// baru jalan sekali, `userReports` sudah memuat baris JAM INI sementara `users` membeku di jam
// sebelum deploy. Menyalin apa adanya akan mengembalikan baris lama ke atas baris yang lebih baru —
// dan yang terbaca orang di panel adalah saldo yang mundur sejam tanpa sebab.

import { get, ref, update } from "firebase/database";
import { connect } from "../db.mjs";
import { USER_REPORTS_PATH } from "../sync-core.js";

// Keempatnya, dan tidak satu pun lebih. `campaigns` dan `campaignCommands` sengaja TETAP di
// `users`: yang pertama dibaca tabel Overview, yang kedua ditulis dari halaman mana saja.
const BRANCHES = ["campaignHistory", "countryRoi", "dailySpend", "balanceSnapshots"];

const dry = process.argv.includes("--dry");
const dropLegacy = process.argv.includes("--drop-legacy");
const db = await connect();

const users = (await get(ref(db, "users"))).val() || {};

// Node barunya belum punya aturan sampai `npm run deploy:rules` jalan, dan RTDB menolak bacaan ke
// path yang tidak disebut aturan mana pun. Ditangkap di sini karena kalimat aslinya cuma
// "Permission denied" berikut stack trace @firebase/database — yang terbaca seperti kredensial
// SYNC_USER yang salah, bukan seperti satu perintah yang belum dijalankan.
let existing;
try {
  existing = (await get(ref(db, USER_REPORTS_PATH))).val() || {};
} catch (error) {
  console.error(
    `Tidak bisa membaca \`${USER_REPORTS_PATH}\`: ${error.message}\n` +
      "Jalankan `npm run deploy:rules` lebih dulu — node ini baru, dan RTDB menolak bacaan ke path " +
      "yang belum disebut database.rules.json.",
  );
  process.exit(1);
}

const plan = [];
let copied = 0;
let skipped = 0;

for (const [uid, user] of Object.entries(users)) {
  for (const branch of BRANCHES) {
    const rows = user?.[branch];
    if (!rows || typeof rows !== "object") continue;
    const already = existing[uid]?.[branch] || {};
    const values = {};
    for (const [key, row] of Object.entries(rows)) {
      if (key in already) {
        skipped += 1;
        continue;
      }
      values[key] = row;
      copied += 1;
    }
    if (Object.keys(values).length) {
      plan.push({ uid, name: user.name || user.email || uid, branch, values });
    }
  }
}

const rowsOf = (entry) => Object.keys(entry.values).length;
console.log(
  `${Object.keys(users).length} user, ${plan.length} cabang untuk disalin ` +
    `(${copied} baris; ${skipped} sudah ada di tujuan dan dibiarkan).`,
);
for (const entry of plan) {
  console.log(`  ${entry.name} / ${entry.branch}: ${rowsOf(entry)} baris`);
}

if (dry) {
  console.log(
    `--dry: tidak ada yang ditulis.` +
      (dropLegacy ? ` Cabang lama di ${Object.keys(users).length} user akan dihapus.` : ""),
  );
  process.exit(0);
}

/**
 * `--drop-legacy` TIDAK MENYALIN APA PUN, dan itu bukan sekadar melewati langkah yang sudah selesai.
 *
 * Begitu sync versi baru jalan sekali, `userReports` sudah DIPANGKAS — snapshot saldo dibatasi 60
 * baris per user, riwayat lain 30 dan 90 hari — sementara cabang lama di `users` membeku di
 * keadaan sebelum deploy dan masih memuat baris yang sudah dibuang itu. Menyalin lagi pada tahap
 * ini menghidupkannya kembali: dijalankan 8 Sep 2026, ia mengembalikan dua stempel snapshot tertua
 * (6 baris per user) yang sudah sengaja dipangkas, dan jatah 60 baru pulih di run berikutnya.
 *
 * Lebih buruk dari kelebihan barisnya: verifikasi di bawah lalu LOLOS karena salinan itu sendiri
 * yang membuat kuncinya ada. Yang seharusnya memutuskan boleh-tidaknya menghapus jadi memeriksa
 * hasil kerjanya sendiri.
 */
if (dropLegacy && plan.length) {
  console.log(
    `--drop-legacy: ${copied} baris yang cuma ada di \`users\` TIDAK disalin — lihat verifikasi di bawah.`,
  );
}

// Per (user, cabang), bukan satu update besar berkunci "userReports": yang kedua menimpa seluruh
// pohon kalau satu path salah ketik.
if (!dropLegacy) {
  for (const entry of plan) {
    await update(ref(db, `${USER_REPORTS_PATH}/${entry.uid}/${entry.branch}`), entry.values);
  }
  console.log(`Disalin: ${copied} baris ke ${USER_REPORTS_PATH}.`);
}

if (!dropLegacy) {
  console.log(
    "Cabang lama di `users` DIBIARKAN. Deploy dulu bundel + functions barunya, pastikan panel " +
      "Profile User terisi, baru jalankan lagi dengan --drop-legacy.",
  );
  process.exit(0);
}

/**
 * Diverifikasi baris per baris sebelum dibuang: sebuah cabang yang gagal disalin diam-diam lalu
 * dihapus dari `users` adalah riwayat yang tidak bisa dikembalikan dari mana pun.
 *
 * SATU KETIADAAN YANG SAH, dan hanya satu: baris yang lebih TUA daripada baris tertua di cabang
 * tujuan. Itu tanda pemangkasan — masa simpannya lewat dan sync membuangnya — dan menuntutnya
 * kembali berarti migrasi ini menghidupkan ulang persis yang baru saja dibuang. Yang lebih muda
 * dari itu tidak punya penjelasan apa pun selain penyalinan yang gagal, dan itu MENGHENTIKAN run.
 *
 * Dibaca dari kunci, bukan dari tanggal di dalam barisnya: keempat cabang berkunci stempel
 * (`YYYY-MM-DD__…` atau `YYYYMMDDHHmm__…`), jadi urutan kunci ADALAH urutan waktu — aturan yang
 * sama yang membuat pemangkasannya sendiri bisa diminta lewat `orderByKey`.
 */
const after = (await get(ref(db, USER_REPORTS_PATH))).val() || {};
const removals = {};
let dropped = 0;
let pruned = 0;
for (const [uid, user] of Object.entries(users)) {
  for (const branch of BRANCHES) {
    const rows = user?.[branch];
    if (!rows || typeof rows !== "object") continue;
    const landed = after[uid]?.[branch] || {};
    const oldestLanded = Object.keys(landed).sort()[0];
    const missing = Object.keys(rows).filter((key) => !(key in landed));
    const unexplained = oldestLanded ? missing.filter((key) => key >= oldestLanded) : missing;
    if (unexplained.length) {
      console.error(
        `BERHENTI: ${user.name || uid} / ${branch} — ${unexplained.length} baris belum ada di ` +
          `tujuan dan tidak lebih tua daripada baris tertua di sana (mis. ${unexplained[0]}). ` +
          "Tidak ada satu pun cabang yang dihapus.",
      );
      process.exit(1);
    }
    pruned += missing.length;
    removals[`${uid}/${branch}`] = null;
    dropped += 1;
  }
}
if (pruned) {
  console.log(
    `${pruned} baris lama tidak ada di tujuan karena sudah lewat masa simpan — dilewati.`,
  );
}

if (!dropped) {
  console.log("Tidak ada cabang lama yang tersisa di `users`.");
  process.exit(0);
}
await update(ref(db, "users"), removals);
console.log(`Selesai. ${dropped} cabang lama dihapus dari \`users\`.`);
process.exit(0);
