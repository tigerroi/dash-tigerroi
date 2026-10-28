// One-off: pindahkan tarif Potongan Company dari kolom `domains.companyPercent` ke koleksi
// `companyPercents`, yang tiap barisnya punya tanggal mulai berlaku.
//
//   npm run migrate:company-percent -- --dry
//   npm run migrate:company-percent
//   npm run migrate:company-percent -- --drop-domain-field   (buang kolom lamanya)
//
// URUTAN DEPLOY MENGIKAT: `npm run deploy:rules` harus jalan LEBIH DULU. Node `companyPercents`
// belum punya aturannya sampai itu, jadi script ini ditolak database di baris pertama.
//
// TANGGAL BERLAKUNYA SENGAJA JAUH DI BELAKANG (lihat LEGACY_FROM). Tarif yang dipindahkan adalah
// tarif yang selama ini dipakai untuk MENGHITUNG SELURUH RIWAYAT — kolom lama tidak punya tanggal,
// jadi Laba Rugi memakainya untuk tiap bulan yang pernah dibuka. Diberi tanggal hari ini, bulan-
// bulan lampau mendadak kehilangan potongannya: laba Juni yang sudah dilaporkan naik puluhan juta
// pada hari migrasi ini jalan, dan yang melihatnya cuma orang yang kebetulan membuka bulan lama.
//
// "01 Jan 2020" terbaca di layar sebagai "sejak selamanya", dan itu memang artinya: ia lebih awal
// daripada baris apa pun yang pernah ada di dashboard ini (yang paling lama, `adxCosts`, mulai
// April 2026).
//
// KOLOM LAMA TIDAK IKUT DIHAPUS kecuali diminta. Sesudah migrasi ini tidak ada satu baris kode pun
// yang membacanya — `splitByOwner` dan halaman Invalid Traffic keduanya sudah pindah — jadi ia
// cuma data mati yang tidak mengubah angka apa pun. Yang membuatnya tetap berharga sehari-dua hari:
// ia satu-satunya cara mengadu hasil migrasi ini dengan keadaan sebelumnya. `--drop-domain-field`
// menghapusnya setelah itu.
//
// Idempotent: sebuah baris dikenali dari DOMAIN + TANGGAL BERLAKU-nya. Dijalankan dua kali tidak
// menghasilkan baris kembar, dan tarif yang sudah dipindahkan lalu diubah orang lewat halamannya
// TIDAK ditimpa kembali ke nilai lama — yang diperiksa keberadaan barisnya, bukan isinya.
//
// Kuncinya PUSH KEY, bukan turunan dari domain + tanggal: nama domain memuat titik, dan titik tidak
// boleh ada di kunci RTDB.

import { get, push, ref, remove, update } from "firebase/database";
import { connect } from "../db.mjs";

const LEGACY_FROM = "2020-01-01";

const dry = process.argv.includes("--dry");
const dropField = process.argv.includes("--drop-domain-field");

const norm = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase();
const identityOf = (row) => `${norm(row?.domain)}|${String(row?.effectiveFrom ?? "").trim()}`;
// Tarif dari kolom lama. Kosong tetap kosong: `Number("")` adalah 0, dan 0% berarti "domain ini
// tidak dipotong sama sekali" — klaim yang jauh berbeda dari "tarifnya belum diisi".
const toPercent = (value) => {
  if (value === null || value === undefined || value === "" || value === "-") return null;
  const percent = Number(String(value).replace("%", "").trim());
  return Number.isFinite(percent) ? percent : null;
};

const db = await connect();

const domains = Object.entries((await get(ref(db, "domains"))).val() || {}).filter(
  ([, row]) => row,
);
const existing = Object.values((await get(ref(db, "companyPercents"))).val() || {}).filter(Boolean);
const seen = new Set(existing.map(identityOf));

const pending = [];
const skipped = [];

for (const [, domain] of domains) {
  const domainUrl = String(domain?.domainUrl ?? "").trim();
  const percent = toPercent(domain?.companyPercent);
  if (!domainUrl) continue;
  // Domain yang kolomnya memang kosong tidak menghasilkan baris apa pun. Sebuah baris bertarif
  // kosong akan MENGUBAH arti keadaannya: di koleksi baru ia berbunyi "sejak 2020 tarifnya tidak
  // diketahui", yang kebetulan sama hasilnya hari ini tapi menghalangi baris bertanggal lebih awal
  // ditambahkan belakangan.
  if (percent === null) {
    skipped.push(domainUrl);
    continue;
  }

  const row = { domain: domainUrl, percent, effectiveFrom: LEGACY_FROM };
  if (seen.has(identityOf(row))) {
    console.log(`  = ${domainUrl} ${percent}% sejak ${LEGACY_FROM} sudah ada`);
    continue;
  }
  seen.add(identityOf(row));
  pending.push(row);
}

console.log(
  `\n${domains.length} domain, ${existing.length} baris tarif sudah ada di RTDB, ${pending.length} akan ditulis.`,
);
for (const row of pending) console.log(`  + ${row.domain} ${row.percent}% sejak ${LEGACY_FROM}`);
if (skipped.length) {
  console.log(
    `\nTanpa tarif di kolom lama, tidak dibuatkan baris (earning-nya memang tidak dipotong): ${skipped.join(", ")}`,
  );
}

const withField = domains.filter(([, row]) => row?.companyPercent !== undefined);
if (dropField) {
  console.log(`\n--drop-domain-field: ${withField.length} kolom lama akan dihapus dari domains.`);
} else if (withField.length) {
  console.log(
    `\n${withField.length} domain masih menyimpan kolom \`companyPercent\` yang tidak dibaca siapa pun lagi.\n` +
      "Biarkan dulu untuk mengadu hasilnya, lalu jalankan ulang dengan --drop-domain-field.",
  );
}

if (!pending.length && !dropField) {
  console.log("\nTidak ada yang perlu dikerjakan.");
  process.exit(0);
}

if (dry) {
  console.log("\n--dry: tidak ada yang ditulis.");
  process.exit(0);
}

const now = new Date().toISOString();

// Baris baru DULU, kolom lama dihapus sesudahnya. Dibalik, run yang putus di tengah meninggalkan
// tarif yang hilang dari kedua tempat — dan Laba Rugi berhenti memotong apa pun tanpa satu pun
// pesan, cuma laba yang mendadak lebih besar.
for (const row of pending) {
  const rowRef = push(ref(db, "companyPercents"));
  await update(rowRef, {
    ...row,
    note: "Dipindahkan dari kolom % Company di halaman Domains.",
    id: rowRef.key,
    createdAt: now,
    createdBy: "migration",
    updatedAt: now,
    updatedBy: "migration",
  });
}

if (dropField) {
  for (const [key, domain] of withField) {
    await remove(ref(db, `domains/${key}/companyPercent`));
    console.log(`  - ${domain.domainUrl} kolom companyPercent dihapus`);
  }
}

console.log(
  `\nSelesai. ${pending.length} baris ditulis ke companyPercents` +
    (dropField ? `, ${withField.length} kolom lama dihapus.` : "."),
);
process.exit(0);
