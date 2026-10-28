// One-off: isi `whitelistTopup` dengan riwayat top-up April–Juli 2026 yang selama ini tinggal di
// spreadsheet (120 baris). Agustus ke atas sudah diinput lewat halamannya dan tidak disentuh.
//
//   npm run seed:whitelist-topup -- --dry
//   npm run seed:whitelist-topup
//
// KENAPA INI PERLU. `whitelistTopup` di RTDB baru dimulai 3 Agustus 2026. Tanpa keempat bulan
// sebelumnya, kartu "TopUp WL" di Cash Flow berbunyi Rp 0 untuk April–Juli — dan Rp 0 di sana
// bukan "tidak ada setoran" melainkan "belum diinput", dua hal yang tidak bisa dibedakan di layar.
// Kolom Total Topup di /spending juga membaca node ini, jadi porsi dana untuk periode lama tidak
// bisa dihitung sama sekali.
//
// SUMBERNYA DITULIS APA ADANYA sebagai teks spreadsheet, lalu diurai regex — bukan diketik ulang
// jadi array JS. Seratus dua puluh baris yang dipindahkan tangan ke literal JS adalah seratus dua
// puluh kesempatan salah ketik yang tidak berbunyi sebagai kesalahan di mana pun; yang di bawah ini
// bisa diadu baris per baris dengan spreadsheet-nya tanpa membaca satu tanda kurung pun.
//
// IDEMPOTENT LEWAT KUNCI TURUNAN, bukan push key. Tanggal + akun TIDAK unik: 12 Mei 2026 memuat
// DUA top-up TBZ 1236 senilai Rp 500.000 masing-masing, dan itu memang dua setoran. Kuncinya karena
// itu memuat nomor urut kejadian dalam hari itu — `2026-05-12__TBZ-1236__2` — jadi run yang putus
// di tengah cukup dijalankan ulang, dan baris kembar tidak pernah lahir. Push key baru tiap kali
// akan menggandakan setoran yang sama di kartu Cash Flow dan di kolom Total Topup, dan itu tidak
// terlihat sampai totalnya diadu dengan rekening.
//
// PIC DARI `adAccounts.userOwner`, BUKAN DARI KOLOM KETERANGAN — aturan yang sama dengan
// `backfill-whitelist-topup-pic.mjs`, dan alasan yang sama: keterangan adalah teks bebas, dan satu
// keterangan yang kebetulan menyebut sebuah nama memindahkan setoran orang lain ke baris itu.
// Akun yang belum terdaftar di /ad-accounts (TBZ 0975/0987/0988/1054/1234/1238, WL Personal
// ACA/NUR) ditulis TANPA pic; nama tebakan lebih buruk daripada sel kosong, karena porsi dana orang
// lain ikut bergeser karenanya. Keterangannya tetap tersimpan di `note`, jadi PIC-nya bisa diisi
// belakangan tanpa kehilangan petunjuknya.
//
// KOLOM TOTAL DIPAKAI SEBAGAI CHECKSUM, bukan sebagai nilai: ia turunan di spreadsheet juga
// (nominal + fee). Selisih di baris mana pun MENGHENTIKAN run — angka yang salah baca tidak boleh
// tersimpan diam-diam, karena sesudah itu tidak ada yang memeriksanya lagi.

import { get, ref, set } from "firebase/database";
import { connect } from "../db.mjs";

// Apa adanya dari spreadsheet: BULAN, tanggal (dd/mm/yyyy), Nama/Kode, Nominal, Fee, Total,
// Keterangan.
const SHEET = `
APRIL 13/04/2026 TBZ 0975 Rp1,000,000 Rp50,000 Rp1,050,000 TOP-UP PERDANA
APRIL 13/04/2026 TBZ 0987 Rp1,000,000 Rp50,000 Rp1,050,000 TOP-UP PERDANA, NUR
APRIL 13/04/2026 TBZ 0988 Rp1,000,000 Rp50,000 Rp1,050,000 TOP-UP PERDANA, ACA
APRIL 13/04/2026 TBZ 1054 Rp1,000,000 Rp50,000 Rp1,050,000 TOP-UP PERDANA
APRIL 19/04/2026 TBZ 0988 Rp2,000,000 Rp100,000 Rp2,100,000 ACA
APRIL 19/04/2026 TBZ 0987 Rp2,000,000 Rp100,000 Rp2,100,000 NUR
APRIL 24/04/2026 WL Personal ACA Rp500,000 Rp25,000 Rp525,000 JAGO ACA
APRIL 24/04/2026 WL Personal NUR Rp500,000 Rp25,000 Rp525,000 JAGO NUR
APRIL 27/04/2026 TBZ 1233 Rp5,000,000 Rp250,000 Rp5,250,000 NUR
MAY 05/05/2026 TBZ 1235 Rp5,000,000 Rp250,000 Rp5,250,000 ACA
MAY 06/05/2026 TBZ 1233 Rp1,000,000 Rp50,000 Rp1,050,000 NUR
MAY 06/05/2026 TBZ 1234 Rp1,000,000 Rp50,000 Rp1,050,000 NUR
MAY 07/05/2026 TBZ 1233 Rp1,000,000 Rp50,000 Rp1,050,000 NUR
MAY 07/05/2026 TBZ 1233 Rp3,000,000 Rp150,000 Rp3,150,000 NUR
MAY 08/05/2026 TBZ 1233 Rp2,000,000 Rp100,000 Rp2,100,000 NUR
MAY 10/05/2026 TBZ 1235 Rp4,000,000 Rp200,000 Rp4,200,000 ACA
MAY 11/05/2026 TBZ 1233 Rp2,000,000 Rp100,000 Rp2,100,000 NUR
MAY 11/05/2026 TBZ 1234 Rp2,000,000 Rp100,000 Rp2,100,000 NUR
MAY 12/05/2026 TBZ 1236 Rp500,000 Rp25,000 Rp525,000 Bambang, ibnu, firman
MAY 12/05/2026 TBZ 1236 Rp500,000 Rp25,000 Rp525,000 Bambang, ibnu, firman
MAY 14/05/2026 TBZ 1235 Rp1,000,000 Rp50,000 Rp1,050,000 ACA
MAY 15/05/2026 TBZ 1233 Rp1,000,000 Rp50,000 Rp1,050,000 NUR
MAY 15/05/2026 TBZ 1234 Rp1,000,000 Rp50,000 Rp1,050,000 NUR
MAY 16/05/2026 TBZ 1236 Rp500,000 Rp25,000 Rp525,000 Bambang, ibnu, firman
MAY 16/05/2026 TBZ 1235 Rp1,000,000 Rp50,000 Rp1,050,000 ACA
MAY 16/05/2026 TBZ 1233 Rp2,000,000 Rp100,000 Rp2,100,000 NUR
MAY 16/05/2026 TBZ 1234 Rp2,000,000 Rp100,000 Rp2,100,000 NUR
MAY 23/05/2026 TBZ 1236 Rp2,000,000 Rp100,000 Rp2,100,000 Bambang, ibnu, firman
MAY 25/05/2026 TBZ 1235 Rp1,000,000 Rp50,000 Rp1,050,000 ACA
MAY 25/05/2026 TBZ 1236 Rp2,000,000 Rp100,000 Rp2,100,000 Bambang, ibnu, firman
MAY 26/05/2026 TBZ 1235 Rp2,000,000 Rp100,000 Rp2,100,000 ACA
MAY 28/05/2026 TBZ 1235 Rp2,000,000 Rp100,000 Rp2,100,000 ACA
JUNE 05/06/2026 TBZ 1233 Rp2,000,000 Rp100,000 Rp2,100,000 NUR
JUNE 05/06/2026 TBZ 1238 Rp2,000,000 Rp100,000 Rp2,100,000 NUR
JUNE 08/06/2026 TBZ 1235 Rp3,000,000 Rp150,000 Rp3,150,000 ACA
JUNE 08/06/2026 TBZ 1233 Rp1,000,000 Rp50,000 Rp1,050,000 NUR
JUNE 08/06/2026 TBZ 1238 Rp1,000,000 Rp50,000 Rp1,050,000 NUR
JUNE 10/06/2026 TBZ 1233 Rp2,000,000 Rp100,000 Rp2,100,000 NUR
JUNE 10/06/2026 TBZ 1247 Rp2,000,000 Rp100,000 Rp2,100,000 NUR
JUNE 12/06/2026 TBZ 1235 Rp4,000,000 Rp200,000 Rp4,200,000 ACA
JUNE 13/06/2026 TBZ 1233 Rp2,000,000 Rp100,000 Rp2,100,000 NUR
JUNE 13/06/2026 TBZ 1247 Rp2,000,000 Rp100,000 Rp2,100,000 NUR
JUNE 14/06/2026 TBZ 1233 Rp3,000,000 Rp150,000 Rp3,150,000 NUR
JUNE 14/06/2026 TBZ 1247 Rp3,000,000 Rp150,000 Rp3,150,000 NUR
JUNE 15/06/2026 TBZ 1233 Rp3,000,000 Rp150,000 Rp3,150,000 NUR
JUNE 15/06/2026 TBZ 1247 Rp3,000,000 Rp150,000 Rp3,150,000 NUR
JUNE 16/06/2026 TBZ 1235 Rp4,000,000 Rp200,000 Rp4,200,000 ACA
JUNE 16/06/2026 TBZ 1233 Rp2,000,000 Rp100,000 Rp2,100,000 NUR
JUNE 16/06/2026 TBZ 1247 Rp3,000,000 Rp150,000 Rp3,150,000 NUR
JUNE 18/06/2026 TBZ 1233 Rp1,500,000 Rp75,000 Rp1,575,000 NUR
JUNE 18/06/2026 TBZ 1247 Rp1,500,000 Rp75,000 Rp1,575,000 NUR
JUNE 19/06/2026 TBZ 1235 Rp2,000,000 Rp100,000 Rp2,100,000 ACA
JUNE 19/06/2026 TBZ 1233 Rp1,000,000 Rp50,000 Rp1,050,000 NUR
JUNE 19/06/2026 TBZ 1247 Rp1,000,000 Rp50,000 Rp1,050,000 NUR
JUNE 27/06/2026 TBZ 1235 Rp3,000,000 Rp150,000 Rp3,150,000 ACA
JULY 01/07/2026 TBZ 1233 Rp1,000,000 Rp50,000 Rp1,050,000 NUR
JULY 04/07/2026 TBZ 1233 Rp1,500,000 Rp75,000 Rp1,575,000 NUR
JULY 04/07/2026 TBZ 1247 Rp1,500,000 Rp75,000 Rp1,575,000 NUR
JULY 07/07/2026 TBZ 1233 Rp1,500,000 Rp75,000 Rp1,575,000 NUR
JULY 07/07/2026 TBZ 1235 Rp2,000,000 Rp100,000 Rp2,100,000 ACA
JULY 09/07/2026 TBZ 1236 Rp2,000,000 Rp100,000 Rp2,100,000 FIRMAN IBNU
JULY 09/07/2026 TBZ 1233 Rp2,000,000 Rp100,000 Rp2,100,000 NUR
JULY 09/07/2026 TBZ 1247 Rp2,000,000 Rp100,000 Rp2,100,000 NUR
JULY 11/07/2026 TBZ 1235 Rp3,000,000 Rp150,000 Rp3,150,000 ACA
JULY 11/07/2026 TBZ 1236 Rp2,000,000 Rp100,000 Rp2,100,000 FIRMAN IBNU
JULY 11/07/2026 TBZ 1233 Rp2,000,000 Rp100,000 Rp2,100,000 NUR
JULY 11/07/2026 TBZ 1247 Rp2,000,000 Rp100,000 Rp2,100,000 NUR
JULY 14/07/2026 TBZ 1235 Rp1,000,000 Rp50,000 Rp1,050,000 ACA
JULY 14/07/2026 TBZ 1236 Rp2,000,000 Rp100,000 Rp2,100,000 FIRMAN IBNU
JULY 14/07/2026 TBZ 1233 Rp1,500,000 Rp75,000 Rp1,575,000 NUR
JULY 14/07/2026 TBZ 1247 Rp1,500,000 Rp75,000 Rp1,575,000 NUR
JULY 16/07/2026 TBZ 1235 Rp1,000,000 Rp50,000 Rp1,050,000 ACA
JULY 16/07/2026 TBZ 1236 Rp2,000,000 Rp100,000 Rp2,100,000 FIRMAN IBNU
JULY 16/07/2026 TBZ 1233 Rp1,000,000 Rp50,000 Rp1,050,000 NUR
JULY 16/07/2026 TBZ 1247 Rp1,000,000 Rp50,000 Rp1,050,000 NUR
JULY 17/07/2026 TBZ 1233 Rp1,500,000 Rp75,000 Rp1,575,000 NUR
JULY 17/07/2026 TBZ 1247 Rp1,500,000 Rp75,000 Rp1,575,000 NUR
JULY 17/07/2026 TBZ 1236 Rp2,000,000 Rp100,000 Rp2,100,000 FIRMAN IBNU
JULY 18/07/2026 TBZ 1235 Rp1,500,000 Rp75,000 Rp1,575,000 ACA
JULY 19/07/2026 TBZ 1236 Rp2,000,000 Rp100,000 Rp2,100,000 FIRMAN IBNU
JULY 20/07/2026 TBZ 1233 Rp1,500,000 Rp75,000 Rp1,575,000 NUR
JULY 20/07/2026 TBZ 1247 Rp1,500,000 Rp75,000 Rp1,575,000 NUR
JULY 20/07/2026 TBZ 1235 Rp1,000,000 Rp50,000 Rp1,050,000 ACA
JULY 21/07/2026 TBZ 1236 Rp2,000,000 Rp100,000 Rp2,100,000 FIRMAN IBNU
JULY 22/07/2026 TBZ 1235 Rp3,000,000 Rp150,000 Rp3,150,000 ACA
JULY 22/07/2026 TBZ 1233 Rp2,000,000 Rp100,000 Rp2,100,000 NUR
JULY 22/07/2026 TBZ 1247 Rp2,000,000 Rp100,000 Rp2,100,000 NUR
JULY 22/07/2026 TBZ 1236 Rp3,000,000 Rp150,000 Rp3,150,000 FIRMAN IBNU
JULY 23/07/2026 TBZ 1233 Rp3,000,000 Rp150,000 Rp3,150,000 NUR
JULY 23/07/2026 TBZ 1247 Rp3,000,000 Rp150,000 Rp3,150,000 NUR
JULY 24/07/2026 TBZ 1235 Rp3,000,000 Rp150,000 Rp3,150,000 ACA
JULY 24/07/2026 TBZ 1236 Rp3,000,000 Rp150,000 Rp3,150,000 FIRMAN IBNU
JULY 24/07/2026 TBZ 1233 Rp3,000,000 Rp150,000 Rp3,150,000 NUR
JULY 24/07/2026 TBZ 1247 Rp3,000,000 Rp150,000 Rp3,150,000 NUR
JULY 24/07/2026 TBZ 1268 Rp1,000,000 Rp50,000 Rp1,050,000 WL BARU IBNU
JULY 25/07/2026 TBZ 1235 Rp2,000,000 Rp100,000 Rp2,100,000 ACA
JULY 25/07/2026 TBZ 1236 Rp2,000,000 Rp100,000 Rp2,100,000 FIRMAN IBNU
JULY 25/07/2026 TBZ 1233 Rp3,000,000 Rp150,000 Rp3,150,000 NUR
JULY 25/07/2026 TBZ 1247 Rp3,000,000 Rp150,000 Rp3,150,000 NUR
JULY 26/07/2026 TBZ 1235 Rp2,000,000 Rp100,000 Rp2,100,000 ACA
JULY 26/07/2026 TBZ 1236 Rp2,000,000 Rp100,000 Rp2,100,000 FIRMAN IBNU
JULY 26/07/2026 TBZ 1233 Rp3,000,000 Rp150,000 Rp3,150,000 NUR
JULY 26/07/2026 TBZ 1247 Rp3,000,000 Rp150,000 Rp3,150,000 NUR
JULY 27/07/2026 TBZ 1235 Rp3,000,000 Rp150,000 Rp3,150,000 ACA
JULY 27/07/2026 TBZ 1236 Rp2,000,000 Rp100,000 Rp2,100,000 FIRMAN
JULY 27/07/2026 TBZ 1268 Rp2,000,000 Rp100,000 Rp2,100,000 IBNU
JULY 27/07/2026 TBZ 1233 Rp2,000,000 Rp100,000 Rp2,100,000 NUR
JULY 27/07/2026 TBZ 1247 Rp2,000,000 Rp100,000 Rp2,100,000 NUR
JULY 28/07/2026 TBZ 1236 Rp2,000,000 Rp100,000 Rp2,100,000 FIRMAN
JULY 28/07/2026 TBZ 1233 Rp2,000,000 Rp100,000 Rp2,100,000 NUR
JULY 28/07/2026 TBZ 1247 Rp2,000,000 Rp100,000 Rp2,100,000 NUR
JULY 29/07/2026 TBZ 1235 Rp2,000,000 Rp100,000 Rp2,100,000 ACA
JULY 29/07/2026 TBZ 1268 Rp2,000,000 Rp100,000 Rp2,100,000 IBNU
JULY 29/07/2026 TBZ 1233 Rp2,000,000 Rp100,000 Rp2,100,000 NUR
JULY 29/07/2026 TBZ 1247 Rp2,000,000 Rp100,000 Rp2,100,000 NUR
JULY 29/07/2026 TBZ 1236 Rp2,000,000 Rp100,000 Rp2,100,000 FIRMAN
JULY 30/07/2026 TBZ 1268 Rp2,000,000 Rp100,000 Rp2,100,000 IBNU
JULY 30/07/2026 TBZ 1236 Rp1,000,000 Rp50,000 Rp1,050,000 FIRMAN
JULY 30/07/2026 TBZ 1233 Rp2,000,000 Rp100,000 Rp2,100,000 NUR
JULY 30/07/2026 TBZ 1247 Rp2,000,000 Rp100,000 Rp2,100,000 NUR
`;

// Baris spreadsheet -> baris RTDB. `namaKode` non-greedy sampai "Rp" pertama, jadi nama berspasi
// ("WL Personal ACA", "TBZ 1233") tetap utuh tanpa perlu tahu jumlah katanya.
const LINE =
  /^(APRIL|MAY|JUNE|JULY)\s+(\d{2})\/(\d{2})\/(\d{4})\s+(.+?)\s+Rp\s*([\d,]+)\s+Rp\s*([\d,]+)\s+Rp\s*([\d,]+)\s*(.*)$/;

const dry = process.argv.includes("--dry");
const money = (text) => Number(String(text).replace(/,/g, ""));
const rupiah = (v) => `Rp ${Math.round(Number(v) || 0).toLocaleString("id-ID")}`;
const norm = (v) =>
  String(v ?? "")
    .trim()
    .toLowerCase();
// Kunci RTDB tidak boleh memuat . # $ [ ] / — nama akun tidak memuatnya, tapi spasinya diganti
// supaya kuncinya bisa dibaca utuh di konsol Firebase tanpa %20.
const slug = (v) => String(v).trim().replace(/\s+/g, "-");

const rows = [];
const bad = [];
const perDay = new Map();

for (const raw of SHEET.trim().split("\n")) {
  const line = raw.trim();
  if (!line) continue;
  const match = line.match(LINE);
  if (!match) {
    bad.push(`tidak terbaca: ${line}`);
    continue;
  }
  const [, bulan, dd, mm, yyyy, namaKode, nominalText, feeText, totalText, note] = match;
  const date = `${yyyy}-${mm}-${dd}`;
  const nominal = money(nominalText);
  const feeTopup = money(feeText);
  const total = money(totalText);

  // Kolom Total sebagai CHECKSUM, bukan sebagai nilai — lihat catatan di kepala berkas.
  if (nominal + feeTopup !== total) {
    bad.push(
      `checksum: ${date} ${namaKode} — ${rupiah(nominal)} + ${rupiah(feeTopup)} = ${rupiah(nominal + feeTopup)}, spreadsheet menulis ${rupiah(total)}`,
    );
    continue;
  }

  // Nomor urut kejadian dalam (tanggal, akun): 12 Mei memuat dua top-up TBZ 1236 yang sama besar,
  // dan keduanya nyata.
  const dayKey = `${date}|${norm(namaKode)}`;
  const seq = (perDay.get(dayKey) || 0) + 1;
  perDay.set(dayKey, seq);

  rows.push({
    id: `${date}__${slug(namaKode)}__${seq}`,
    bulan,
    date,
    namaKode: namaKode.trim(),
    nominal,
    feeTopup,
    total,
    note: note.trim(),
  });
}

if (bad.length) {
  console.error(`${bad.length} baris bermasalah — tidak ada yang ditulis:`);
  for (const line of bad) console.error("  !", line);
  process.exit(1);
}

const db = await connect();

// PIC dibekukan dari pemilik akun, sama seperti kolom `compute` di formnya. Akun yang tidak
// terdaftar (atau terdaftar tanpa User Pemilik) ditulis TANPA pic — lihat catatan di kepala berkas.
const accounts = Object.values((await get(ref(db, "adAccounts"))).val() || {}).filter(Boolean);
const ownerOf = new Map();
for (const account of accounts) {
  const key = norm(account?.name);
  if (key && account?.userOwner) ownerOf.set(key, account.userOwner);
}

const existing = (await get(ref(db, "whitelistTopup"))).val() || {};
const pending = [];
const already = [];
const noOwner = new Map();

for (const row of rows) {
  const owner = ownerOf.get(norm(row.namaKode));
  if (owner) row.pic = owner;
  else {
    const entry = noOwner.get(row.namaKode) || { n: 0, total: 0 };
    entry.n += 1;
    entry.total += row.nominal;
    noOwner.set(row.namaKode, entry);
  }
  if (existing[row.id]) already.push(row);
  else pending.push(row);
}

const byMonth = new Map();
for (const row of rows) {
  const key = row.date.slice(0, 7);
  const entry = byMonth.get(key) || { n: 0, nominal: 0, fee: 0 };
  entry.n += 1;
  entry.nominal += row.nominal;
  entry.fee += row.feeTopup;
  byMonth.set(key, entry);
}

console.log(`${rows.length} baris terbaca dari spreadsheet.\n`);
console.log("Per bulan:");
for (const [month, v] of [...byMonth].sort()) {
  console.log(
    `  ${month}  ${String(v.n).padStart(3)} baris   nominal ${rupiah(v.nominal).padStart(16)}   fee ${rupiah(v.fee)}`,
  );
}

if (noOwner.size) {
  console.log(
    "\nAkun yang belum terdaftar di /ad-accounts (atau tanpa User Pemilik) — PIC dikosongkan:",
  );
  for (const [name, v] of noOwner) {
    console.log(`  ${name.padEnd(18)} ${String(v.n).padStart(2)} baris   ${rupiah(v.total)}`);
  }
  console.log("  Isi User Pemilik di /ad-accounts, lalu jalankan: npm run migrate:topup-pic");
}

console.log(
  `\n${Object.keys(existing).length} baris sudah ada di RTDB; ${already.length} di antaranya milik seed ini, ${pending.length} akan ditulis.`,
);

if (!pending.length) {
  console.log("Tidak ada yang perlu dikerjakan.");
  process.exit(0);
}

if (dry) {
  console.log("--dry: tidak ada yang ditulis.");
  process.exit(0);
}

const now = new Date().toISOString();
// Per baris dengan `set` ke kunci turunannya, bukan satu update besar berkunci "whitelistTopup":
// yang kedua menimpa seluruh koleksi kalau path-nya salah ketik — termasuk 149 baris Agustus dan
// September yang sudah diinput orang lewat halamannya.
for (const row of pending) {
  await set(ref(db, `whitelistTopup/${row.id}`), {
    ...row,
    rekeningSumber: "",
    rekeningTujuan: "",
    createdAt: now,
    createdBy: "migration",
    updatedAt: now,
    updatedBy: "migration",
  });
}

console.log(`Selesai. ${pending.length} baris ditulis ke whitelistTopup.`);
process.exit(0);
