// One-off: isi koleksi `invalidTraffic` dengan hasil pengecekan invalid traffic yang selama ini
// tinggal di spreadsheet (April–Juli 2026, 31 baris).
//
//   npm run seed:invalid-traffic -- --dry
//   npm run seed:invalid-traffic
//   npm run seed:invalid-traffic -- --replace-legacy      (lihat "BARIS LAMA" di bawah)
//
// YANG DITULIS CUMA APA YANG DIKETIK ORANG: bulan, jenis akun, domain, dan ketiga Check-nya.
// Earning, Ad Spend + Ad Tax, Potongan Company, Net Profit, dan Total IVT % TIDAK ditulis — halaman
// menurunkannya dari baris ROI bulan itu tiap kali dirender (`invalidTrafficRows` di
// src/lib/invalidTraffic.js). Menyalinnya ke RTDB akan menghasilkan dua angka untuk uang yang sama:
// yang di baris ini beku di nilai hari migrasi, yang di sebelahnya bergerak mengikuti sync — dan
// tidak ada apa pun di layar yang bisa menjelaskan selisihnya.
//
// `nominal` ADALAH pengecualian, dan itu satu-satunya: `buildProfitLoss` membacanya, dan Laba Rugi
// tidak boleh bergantung pada halaman yang sedang dibuka orang. Ia jumlah ketiga Check.
//
// KOLOM TOTAL SPREADSHEET DIPAKAI SEBAGAI CHECKSUM, bukan sebagai nilai. Ia kolom TURUNAN di sana
// (jumlah ketiga Check), jadi menuliskannya berarti menyalin hasil hitungan orang alih-alih
// menghitungnya sendiri. Yang tidak cocok DISEBUTKAN dan tidak menghentikan run — satu baris
// (Juni, designingaround.com, Ad-Exchanger) memang tidak cocok di spreadsheetnya: totalnya
// Rp 2.516 sementara Check-nya berjumlah Rp 3.851, karena Check 2 tidak ikut terjumlah di sana.
// Yang benar adalah jumlah Check-nya, dan itu yang ditulis.
//
// BARIS LAMA. Koleksi ini sudah dipakai dengan bentuk yang lama — satu baris per domain per bulan,
// tanpa jenis akun. Baris lama untuk bulan + domain yang sama TIDAK ikut tergantikan sendiri, dan
// dibiarkan ia akan dijumlahkan BERSAMA dua baris baru di Laba Rugi: invalid traffic bulan itu
// terhitung dua kali, dan tidak ada tanda apa pun di layar selain laba yang lebih kecil. Karena itu
// script berhenti dan menyebutkan barisnya; `--replace-legacy` yang menghapusnya. Menghapus data
// harus diminta, tidak boleh jadi efek samping dari menjalankan sebuah seed.
//
// Idempotent: sebuah baris dikenali dari BULAN + DOMAIN + JENIS AKUN-nya, dan hanya yang belum ada
// yang ditulis. Ketiganya dipakai bersama karena tidak satu pun cukup sendirian — satu domain
// punya dua baris tiap bulan (Adsense dan Ad-Exchanger), dan satu jenis akun berdiri di banyak
// domain. Dijalankan dua kali tidak menghasilkan baris kembar, jadi run yang putus di tengah cukup
// dijalankan ulang.
//
// Kuncinya PUSH KEY, bukan turunan dari ketiga nilai itu: nama domain memuat titik, dan titik tidak
// boleh ada di kunci RTDB.
//
// TIDAK ada urutan deploy yang mengikat di sini, berbeda dari seed-adx-costs: node `invalidTraffic`
// sudah punya aturannya di database.rules.json sejak lama, dan bentuk barunya tidak menambah satu
// pun field yang divalidasi.

import { get, push, ref, remove, update } from "firebase/database";
import { connect } from "../db.mjs";

// Tahun yang tidak disebut spreadsheet — kolomnya cuma "April".."July". Berdiri sebagai konstanta
// dan bukan disisipkan tiga puluh satu kali, supaya salah tahun terbaca sebagai satu angka yang
// keliru dan bukan sebagai tiga puluh satu baris yang harus dibaca satu per satu.
const YEAR = 2026;

const MONTHS = { April: "04", May: "05", June: "06", July: "07" };

const ADSENSE = "Adsense";
const AD_EXCHANGE = "Ad-Exchanger";

// Apa adanya dari spreadsheet: [bulan, jenis akun, domain, total menurut spreadsheet, check1,
// check2, check3]. Kolom total dipakai sebagai checksum saja — lihat catatan di atas. Check yang
// KOSONG tidak ditulis sama sekali, dan itu bukan kerapian: Rp 0 di kolom Check adalah klaim bahwa
// pengecekan ketiga dilakukan dan tidak menemukan apa-apa.
const ROWS = [
  ["April", ADSENSE, "xiaomidriversdownload.com", 60317, 59975, 342, ""],
  ["April", ADSENSE, "designingaround.com", 24150, 4300, 19850, ""],
  ["April", AD_EXCHANGE, "xiaomidriversdownload.com", 158525, 87457, 71068, ""],
  ["May", ADSENSE, "dekadeko.com", 9813, 9813, "", ""],
  ["May", AD_EXCHANGE, "designingaround.com", 16259, 16201, 58, ""],
  ["May", ADSENSE, "psaonlineappointment.com", 27453, 27453, "", ""],
  ["May", ADSENSE, "stylefemale.com", 14135, 14135, "", ""],
  ["May", AD_EXCHANGE, "stylefemale.com", 204502, 204502, "", ""],
  ["May", AD_EXCHANGE, "xiaomidriversdownload.com", 486894, 485267, 1627, ""],
  ["May", ADSENSE, "xiaomidriversdownload.com", 0, "", "", ""],
  ["May", ADSENSE, "masseffectstore.com", 23124, 23124, "", ""],
  ["June", AD_EXCHANGE, "petcins.com", 449184, 449184, "", ""],
  ["June", AD_EXCHANGE, "masseffectstore.com", 147605, 147605, "", ""],
  ["June", AD_EXCHANGE, "stylefemale.com", 203198, 203198, "", ""],
  ["June", AD_EXCHANGE, "psaonlineappointment.com", 56262, 56262, "", ""],
  ["June", ADSENSE, "xiaomidriversdownload.com", 1600286, 1600286, "", ""],
  // Satu-satunya baris yang checksum-nya tidak cocok: 2.516 + 1.335 = 3.851, bukan 2.516.
  ["June", AD_EXCHANGE, "designingaround.com", 2516, 2516, 1335, ""],
  ["June", ADSENSE, "designingaround.com", 2140, 1725, 415, ""],
  ["June", ADSENSE, "dekadeko.com", 3115, 2685, 430, ""],
  ["July", ADSENSE, "designingaround.com", 0, "", "", ""],
  ["July", AD_EXCHANGE, "designingaround.com", 135393, 135393, "", ""],
  ["July", ADSENSE, "stylefemale.com", 3, 3, "", ""],
  ["July", AD_EXCHANGE, "stylefemale.com", 509246, 509246, "", ""],
  ["July", ADSENSE, "dekadeko.com", 0, "", "", ""],
  ["July", AD_EXCHANGE, "dekadeko.com", 0, "", "", ""],
  ["July", ADSENSE, "psaonlineappointment.com", 0, "", "", ""],
  ["July", AD_EXCHANGE, "psaonlineappointment.com", 37558, 37558, "", ""],
  ["July", ADSENSE, "masseffectstore.com", 0, "", "", ""],
  ["July", AD_EXCHANGE, "masseffectstore.com", 86935, 86935, "", ""],
  ["July", ADSENSE, "petcins.com", 0, "", "", ""],
  ["July", AD_EXCHANGE, "petcins.com", 331576, 331576, "", ""],
];

const dry = process.argv.includes("--dry");
const replaceLegacy = process.argv.includes("--replace-legacy");

const norm = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase();
const rupiah = (value) => `Rp ${Number(value || 0).toLocaleString("id-ID")}`;
// Bulan sebuah baris RTDB: dari `month` kalau ada, dari `date` untuk baris bentuk lama. Sama persis
// dengan `monthOf` di src/lib/invalidTraffic.js — kalau keduanya berbeda, baris yang di layar
// berbunyi Juni akan lolos pemeriksaan tabrakan di sini sebagai bulan yang lain.
const monthOf = (row) => {
  const month = String(row?.month ?? "").trim();
  if (/^\d{4}-\d{2}$/.test(month)) return month;
  const fromDate = String(row?.date ?? "").slice(0, 7);
  return /^\d{4}-\d{2}$/.test(fromDate) ? fromDate : "";
};
const identityOf = (row) => [monthOf(row), norm(row?.domain), norm(row?.accountType)].join("|");

const db = await connect();
const existing = (await get(ref(db, "invalidTraffic"))).val() || {};
const existingRows = Object.entries(existing).filter(([, row]) => row);
const seen = new Set(existingRows.map(([, row]) => identityOf(row)));

// --- terjemahkan spreadsheet jadi baris RTDB ---------------------------------------------------

const wanted = [];
const mismatched = [];

for (const [monthName, accountType, domain, spreadsheetTotal, ...checks] of ROWS) {
  const month = `${YEAR}-${MONTHS[monthName]}`;
  if (!MONTHS[monthName]) throw new Error(`Bulan tidak dikenali: ${monthName}`);

  const row = {
    month,
    // Tanggal yang benar-benar dibaca `buildProfitLoss`, `profitLossMonths`, dan filter periode.
    // Selalu tanggal 1: hari di dalam baris ini tidak dipakai siapa pun.
    date: `${month}-01`,
    accountType,
    domain,
  };
  checks.forEach((value, index) => {
    if (value !== "") row[`check${index + 1}`] = value;
  });
  row.nominal = checks.reduce((total, value) => total + (value === "" ? 0 : Number(value)), 0);

  if (row.nominal !== spreadsheetTotal) {
    mismatched.push({ row, spreadsheetTotal });
  }
  wanted.push(row);
}

if (mismatched.length) {
  console.log(`\n${mismatched.length} baris yang total spreadsheet-nya ≠ jumlah Check-nya:`);
  for (const { row, spreadsheetTotal } of mismatched) {
    console.log(
      `  ! ${row.month} ${row.domain} (${row.accountType}): spreadsheet ${rupiah(spreadsheetTotal)}, jumlah Check ${rupiah(row.nominal)} — yang ditulis jumlah Check-nya`,
    );
  }
}

// --- baris lama yang akan dijumlahkan dua kali -------------------------------------------------

// Bentuk lama koleksi ini tidak punya jenis akun, jadi identitasnya tidak akan pernah sama dengan
// baris baru mana pun — ia lolos pemeriksaan kembar di bawah lalu berdiri BERDAMPINGAN dengan dua
// baris penggantinya. Laba Rugi menjumlahkan `nominal` seluruh baris bulan itu.
const wantedMonthDomain = new Set(wanted.map((row) => `${row.month}|${norm(row.domain)}`));
const legacy = existingRows.filter(
  ([, row]) =>
    !norm(row?.accountType) && wantedMonthDomain.has(`${monthOf(row)}|${norm(row?.domain)}`),
);

if (legacy.length) {
  console.log(`\n${legacy.length} baris bentuk LAMA berdiri di bulan + domain yang sama:`);
  for (const [key, row] of legacy) {
    console.log(`  ~ ${monthOf(row)} ${row.domain} ${rupiah(row.nominal)} (${key})`);
  }
  if (!replaceLegacy) {
    console.log(
      "\nDibiarkan, invalid traffic bulan itu terhitung DUA KALI di Laba Rugi.\n" +
        "Jalankan ulang dengan --replace-legacy untuk menghapusnya, atau hapus sendiri lewat halaman /invalid-traffic.",
    );
    process.exit(1);
  }
}

// --- apa yang akan ditulis ---------------------------------------------------------------------

const pending = [];
for (const row of wanted) {
  const identity = identityOf(row);
  if (seen.has(identity)) {
    console.log(`  = ${row.month} ${row.domain} (${row.accountType}) sudah ada`);
    continue;
  }
  seen.add(identity);
  pending.push(row);
}

console.log(
  `\n${ROWS.length} baris di script, ${existingRows.length} sudah ada di RTDB, ${pending.length} akan ditulis.`,
);
for (const row of pending) {
  console.log(`  + ${row.month} ${row.domain} (${row.accountType}) ${rupiah(row.nominal)}`);
}

// Domain yang tidak terdaftar tidak menghentikan apa pun — barisnya tetap dikurangkan dari laba.
// Yang hilang cuma kolom turunannya: tanpa baris di `domains`, subdomainnya tidak bisa dicocokkan
// ke domain induk mana pun, jadi seluruh kolom Earning/Belanja/Net Profit-nya kosong. Diperbaiki di
// /domains, bukan di sini.
//
// Tarif Potongan Company TIDAK diperiksa di sini, dan itu bukan kelalaian: sejak ia punya tanggal
// berlaku (koleksi `companyPercents`), halaman Invalid Traffic tidak memakainya sama sekali —
// tidak sebagai kolom maupun di dalam Net Profit.
const domains = Object.values((await get(ref(db, "domains"))).val() || {}).filter(Boolean);
const known = new Set(domains.map((row) => norm(row.domainUrl)));
const unknownDomains = [...new Set(wanted.map((row) => norm(row.domain)))].filter(
  (domain) => !known.has(domain),
);

if (unknownDomains.length) {
  console.log(
    `\nBelum terdaftar di /domains (kolom otomatisnya akan kosong): ${unknownDomains.join(", ")}`,
  );
}

if (!pending.length && !(replaceLegacy && legacy.length)) {
  console.log("\nTidak ada yang perlu dikerjakan.");
  process.exit(0);
}

if (dry) {
  console.log(
    `\n--dry: tidak ada yang ditulis. ${pending.length} baris akan dibuat` +
      (replaceLegacy && legacy.length ? `, ${legacy.length} baris lama akan dihapus.` : "."),
  );
  process.exit(0);
}

// --- tulis -------------------------------------------------------------------------------------

const now = new Date().toISOString();

// Baris baru DULU, penghapusan baris lama sesudahnya. Dibalik, run yang putus di tengah
// meninggalkan bulan yang invalid traffic-nya hilang seluruhnya dari Laba Rugi — kesalahan yang
// jauh lebih sulit dilihat daripada nominal yang terhitung dua kali.
for (const row of pending) {
  const rowRef = push(ref(db, "invalidTraffic"));
  await update(rowRef, {
    ...row,
    id: rowRef.key,
    createdAt: now,
    createdBy: "migration",
    updatedAt: now,
    updatedBy: "migration",
  });
}

if (replaceLegacy) {
  for (const [key, row] of legacy) {
    await remove(ref(db, `invalidTraffic/${key}`));
    console.log(`  - ${monthOf(row)} ${row.domain} ${rupiah(row.nominal)} dihapus (${key})`);
  }
}

console.log(
  `\nSelesai. ${pending.length} baris ditulis ke invalidTraffic` +
    (replaceLegacy && legacy.length ? `, ${legacy.length} baris lama dihapus.` : "."),
);
process.exit(0);
