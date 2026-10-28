// One-off: `syncedAt` baris `users/{id}.balanceSnapshots` yang masih berstempel UTC -> WIB.
//
//   npm run migrate:snapshot-tz -- --dry
//   npm run migrate:snapshot-tz
//
// KENAPA INI PERLU ADA. `displayStamp` dulu menulis `date.toISOString()` — jam UTC TANPA penanda
// zona. `formatDateTime` di sisi layar cuma menerjemahkan stempel yang menyebut zonanya sendiri
// ("…Z" atau "+07:00"); yang tidak menyebutnya digambar apa adanya. Jadi jam UTC itu muncul di
// kolom "Waktu Sync" pada panel Riwayat Snapshot Saldo sebagai jam WIB — tujuh jam lebih awal,
// tanpa satu pun tanda di layar: sync pukul 17:07 berbunyi "10:07", dan snapshot pagi berdiri di
// tanggal kemarin. Sync sudah menulis WIB sejak perbaikannya di-deploy; yang tersisa baris lama.
//
// YANG MEMBUATNYA BISA DIKERJAKAN TANPA MENEBAK adalah kunci RTDB-nya, yang sengaja TIDAK ikut
// diubah: `202609031007__akun` selalu jam UTC. Baris yang `syncedAt`-nya sama persis dengan jam di
// kuncinya berarti belum dikonversi; yang tujuh jam di depannya berarti sudah. Karena itu skrip ini
// idempotent dengan sendirinya — dijalankan dua kali, yang kedua tidak menemukan apa pun — dan
// aman dijalankan setelah baris baru mulai berdatangan.
//
// Konversinya lewat `zonedDateKey` + `zonedClock`, fungsi yang SAMA yang dipakai `displayStamp`
// sekarang. Menambahkan tujuh jam sendiri di sini berarti aturan zona operasi punya salinan kedua,
// dan salinan itu akan salah pada hari SYNC_TIMEZONE diisi zona yang lain.
//
// `note` ikut digeser ("Saldo turun sejak 2026-09-03 10:07."): ia mengutip `syncedAt` snapshot
// SEBELUMNYA, dan kutipan yang tidak ikut berpindah menunjuk stempel yang sudah tidak ada di baris
// mana pun. Digeser hanya pada baris yang memang sedang dikonversi, jadi gerbang yang sama
// menjaganya dari tergeser dua kali.
//
// TIDAK menyentuh `users/{id}.dailySpend`, dan itu disengaja. Barisnya membawa jam di dalam
// catatannya ("Sync Meta 10:07") tapi TIDAK punya pembeda seperti di atas — kuncinya cuma tanggal,
// jadi tidak ada apa pun di baris itu yang membedakan jam UTC dari jam WIB. Menggesernya berarti
// menebak, dan sebagian akan melewati tengah malam sehingga tanggal DAN kuncinya ikut berpindah —
// berpotensi menabrak baris yang sudah ada di sana. Riwayatnya bergulir 30 hari dan membersihkan
// dirinya sendiri.

import { get, ref, update } from "firebase/database";
import { connect } from "../db.mjs";
import { zonedClock, zonedDateKey } from "../sync-core.js";

const dry = process.argv.includes("--dry");
const db = await connect();

// "202609031007__tbz-1236" -> Date pada 2026-09-03T10:07:00Z, atau null kalau bentuknya bukan itu.
function instantFromKey(key) {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})__/.exec(String(key));
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const at = new Date(`${year}-${month}-${day}T${hour}:${minute}:00Z`);
  return Number.isNaN(at.getTime()) ? null : at;
}

const stampOf = (at) => `${zonedDateKey(at)} ${zonedClock(at)}`;
const utcStampOf = (at) => `${at.toISOString().slice(0, 10)} ${at.toISOString().slice(11, 16)}`;

const users = (await get(ref(db, "users"))).val() || {};
const pending = [];
let total = 0;
let unreadable = 0;

for (const [uid, user] of Object.entries(users)) {
  for (const [key, snap] of Object.entries(user?.balanceSnapshots || {})) {
    total += 1;
    const at = instantFromKey(key);
    if (!at || !snap?.syncedAt) {
      unreadable += 1;
      continue;
    }
    const utc = utcStampOf(at);
    // Gerbangnya: hanya yang jam-nya masih sama dengan kuncinya. Yang lain sudah WIB.
    if (snap.syncedAt !== utc) continue;

    const values = { syncedAt: stampOf(at) };
    if (typeof snap.note === "string" && snap.note.includes(" ")) {
      const note = snap.note.replace(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/g, (found) => {
        const prev = new Date(`${found.replace(" ", "T")}:00Z`);
        return Number.isNaN(prev.getTime()) ? found : stampOf(prev);
      });
      if (note !== snap.note) values.note = note;
    }
    pending.push([`users/${uid}/balanceSnapshots/${key}`, snap, values]);
  }
}

console.log(
  `${total} snapshot, ${pending.length} masih berstempel UTC` +
    (unreadable ? `, ${unreadable} kuncinya tidak terbaca (dilewati)` : "") +
    ".",
);
for (const [path, snap, values] of pending.slice(0, 10)) {
  console.log(
    `  ${path.split("/").pop()} ${snap.account || "?"}: ${snap.syncedAt} -> ${values.syncedAt}`,
  );
}
if (pending.length > 10) console.log(`  ... dan ${pending.length - 10} baris lagi.`);

if (!pending.length) {
  console.log("Tidak ada yang perlu digeser.");
  process.exit(0);
}

if (dry) {
  console.log(`--dry: tidak ada yang ditulis. ${pending.length} baris akan digeser.`);
  process.exit(0);
}

// Per baris, bukan satu update besar berkunci "users": yang kedua menimpa seluruh koleksi kalau
// path-nya salah ketik.
for (const [path, , values] of pending) {
  await update(ref(db, path), values);
}

console.log(`Selesai. ${pending.length} snapshot digeser ke zona operasi.`);
process.exit(0);
