// One-off: isi koleksi `adxCosts` dengan riwayat penyambungan Ad Exchange yang selama ini tinggal
// di spreadsheet (April–Agustus 2026, 20 baris).
//
//   npm run seed:adx-costs -- --dry
//   npm run seed:adx-costs
//
// KENAPA SEBUAH SCRIPT DAN BUKAN IMPOR FILE DI HALAMANNYA. `parseImportFile` memetakan kolom apa
// adanya, sebagai teks: "21/04/2026" akan tersimpan sebagai teks itu juga — dan seluruh dashboard
// ini menyimpan tanggal sebagai ISO `YYYY-MM-DD` karena baris yang tanggalnya sudah diformat akan
// diurutkan sebagai teks ("01 Sep" jatuh sebelum "09 Agu"). Begitu juga "Rp1,238,073", yang lolos
// sebagai teks lalu tidak pernah ikut terjumlah di ringkasan bawah tabel. Yang menerjemahkan
// keduanya harus berdiri di antara spreadsheet dan RTDB, sekali, di tempat yang bisa dibaca ulang.
//
// URUTAN DEPLOY MENGIKAT: `npm run deploy:rules` harus jalan LEBIH DULU. Node `adxCosts` belum
// punya aturannya sampai itu, jadi script ini ditolak database di baris pertama.
//
// Idempotent: sebuah baris dikenali dari TANGGAL + DOMAIN + COMPANY-nya, dan hanya yang belum ada
// yang ditulis. Ketiganya dipakai bersama karena tidak satu pun cukup sendirian — satu domain
// disambungkan berkali-kali (designingaround.com empat kali dalam empat bulan), dan satu company
// menyambungkan beberapa domain di hari yang sama (Holuron LLC, 2 Juni). Dijalankan dua kali tidak
// menghasilkan baris kembar, jadi run yang putus di tengah cukup dijalankan ulang.
//
// Kuncinya PUSH KEY, bukan turunan dari ketiga nilai itu: nama domain memuat titik, dan titik tidak
// boleh ada di kunci RTDB.
//
// SETUP YANG KOSONG DITULIS "Belum", bukan dibiarkan tidak ada. Sel kosong di spreadsheet berarti
// langkah itu belum dikerjakan — itulah yang dicari orang saat membuka halaman ini — dan field yang
// hilang dari baris akan digambar "-", yang terbaca sebagai "tidak diketahui".

import { get, push, ref, update } from "firebase/database";
import { connect } from "../db.mjs";

// Apa adanya dari spreadsheet. `date` sudah ISO; `costUsd`/`nominal` angka (kosong = baris yang
// tidak ditagih, lihat catatan "Garansi Delink" di kolom terakhirnya) — dan kosong di sini berarti
// TIDAK DITULIS sama sekali, bukan 0: nol adalah klaim bahwa biayanya benar-benar nol rupiah.
const ROWS = [
  ["2026-04-21", "xiaomidriversdownload.com", "andihildaismail@gmail.com", "23350141053", "Marktube Group", "90/10", 70, 1238073, "Done", "Done", ""],
  ["2026-05-10", "stylefemale.com", "aziezwahyudi28@gmail.com", "23349918610", "ProPS", "90/10", 75, 1326506, "Done", "Done", ""],
  ["2026-05-10", "designingaround.com", "asasemesta01@gmail.com", "23352267851", "Viqeo Inc", "80/20", 75, 1326506, "Done", "Done", ""],
  ["2026-05-21", "designingaround.com", "asasemesta01@gmail.com", "23352267851", "AdsVenture", "80/20", 45, 796000, "Done", "Done", "20/80"],
  ["2026-06-02", "psaonlineappointment.com", "ainu9415@gmail.com", "23353709939", "Holuron LLC", "80/20", 70, 1250000, "Done", "Done", ""],
  ["2026-06-02", "masseffectstore.com", "dayatsubadin@gmail.com", "23354905771", "Holuron LLC", "80/20", 70, 1250000, "Done", "Done", ""],
  ["2026-06-02", "petcins.com", "torikhandoko563@gmail.com", "23355628943", "Holuron LLC", "80/20", 70, 1250000, "Done", "Done", ""],
  ["2026-06-09", "stylefemale.com", "aziezwahyudi28@gmail.com", "23349918610", "H&T GAMING", "90/10", 75, 1354718, "Done", "Done", ""],
  ["2026-06-11", "xiaomidriversdownload.com", "andihildaismail@gmail.com", "23350141053", "Holuron LLC", "85/15", 70, 1259002, "Done", "Done", ""],
  ["2026-07-03", "stylefemale.com", "aziezwahyudi28@gmail.com", "23349918610", "Monumetric", "90/10", "", "", "Done", "Done", "Garansi Delink"],
  ["2026-07-03", "designingaround.com", "asasemesta01@gmail.com", "23352267851", "Holuron LLC", "80/20", "", "", "Done", "Done", "Garansi Delink"],
  ["2026-08-02", "designingaround.com", "asasemesta01@gmail.com", "23352267851", "objctv.one", "85/15", "", "", "Done", "Done", "Garansi Delink"],
  ["2026-08-07", "bispdailyupdates.pk", "mh27021993@gmail.com", "23347859451", "AdGlobex Media", "90/10", 60, 1075000, "Done", "Done", ""],
  ["2026-08-17", "bispdailyupdates.pk", "mh27021993@gmail.com", "23347859451", "Holuron LLC", "90/10", "", "", "Done", "Done", "Garansi Delink"],
  ["2026-08-18", "theglobesimregistration.ph", "alijani6598@gmail.com", "23189733017", "Monumetric", "90/10", 65, 1200000, "Done", "Belum", ""],
  ["2026-08-19", "bispdailyupdates.pk", "mh27021993@gmail.com", "23347859451", "SAN1GO", "90/10", "", "", "Done", "Done", "Garansi Delink"],
  ["2026-08-23", "psaonlineappointment.com", "ainu9415@gmail.com", "23353709939", "Monumetric", "92/8", 65, 1200000, "Belum", "Belum", ""],
  ["2026-08-23", "masseffectstore.com", "dayatsubadin@gmail.com", "23354905771", "Monumetric", "92/8", 65, 1200000, "Belum", "Belum", ""],
  ["2026-08-23", "petcins.com", "torikhandoko563@gmail.com", "23355628943", "Monumetric", "92/8", 65, 1200000, "Belum", "Belum", ""],
  ["2026-08-24", "bispdailyupdates.pk", "mh27021993@gmail.com", "23347859451", "New Dream Global Corp", "90/10", 65, 1200000, "Belum", "Belum", ""],
];

const dry = process.argv.includes("--dry");
const db = await connect();

const norm = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase();
const identity = (row) => [norm(row.date), norm(row.domain), norm(row.companyName)].join("|");

const existing = (await get(ref(db, "adxCosts"))).val() || {};
const seen = new Set(Object.values(existing).filter(Boolean).map(identity));

const pending = [];
for (const [date, domain, email, networkCode, companyName, ratio, costUsd, nominal, setupAdx, setupSub, note] of ROWS) {
  const row = {
    date,
    domain,
    email,
    networkCode,
    companyName,
    ratio,
    approvalStatus: "Approve",
    setupAdx,
    setupSub,
    note,
  };
  // Yang tidak ditagih tidak membawa field biayanya sama sekali — lihat catatan di atas.
  if (costUsd !== "") row.costUsd = String(costUsd);
  if (nominal !== "") row.nominal = String(nominal);

  if (seen.has(identity(row))) {
    console.log(`  = ${date} ${domain} (${companyName}) sudah ada`);
    continue;
  }

  seen.add(identity(row));
  pending.push(row);
}

console.log(
  `${ROWS.length} baris di script, ${Object.keys(existing).length} sudah ada di RTDB, ${pending.length} akan ditulis.`,
);
for (const row of pending) console.log(`  + ${row.date} ${row.domain} (${row.companyName})`);

if (!pending.length) {
  console.log("Tidak ada yang perlu dikerjakan.");
  process.exit(0);
}

if (dry) {
  console.log(`--dry: tidak ada yang ditulis. ${pending.length} baris akan dibuat.`);
  process.exit(0);
}

const now = new Date().toISOString();
// Per baris, bukan satu update besar berkunci "adxCosts": yang kedua menimpa seluruh koleksi kalau
// path-nya salah ketik.
for (const row of pending) {
  const rowRef = push(ref(db, "adxCosts"));
  await update(rowRef, {
    ...row,
    id: rowRef.key,
    createdAt: now,
    createdBy: "migration",
    updatedAt: now,
    updatedBy: "migration",
  });
}

console.log(`Selesai. ${pending.length} baris ditulis ke adxCosts.`);
process.exit(0);
