// One-off: isi koleksi `payouts` dengan riwayat pencairan yang selama ini tinggal di spreadsheet
// (April–Juli 2026, 20 baris).
//
//   npm run seed:payouts -- --dry
//   npm run seed:payouts
//
// YANG DITULIS CUMA APA YANG DIKETIK ORANG: bulan, domain, saldo sebelumnya, angka notifikasi
// pembayaran, fee rekening perantara, potongan konversi, rekening tujuan, kode PIP, dan statusnya.
//
// Earning Google, Potongan Company, Invalid Traffic, Earning Final, Nominal Fee, Sunat Google,
// Saldo Close, dan Saldo Akhir TIDAK ditulis — halaman menurunkannya dari `roiReports`,
// `companyPercents`, dan `invalidTraffic` tiap kali dirender (`payoutRows` di src/lib/payouts.js).
// Menyalinnya ke RTDB menghasilkan dua angka untuk uang yang sama: yang di baris ini beku di nilai
// hari migrasi, yang di sebelahnya bergerak mengikuti sync — dan tidak ada apa pun di layar yang
// bisa menjelaskan selisihnya.
//
// KOLOM SALDO AKHIR SPREADSHEET DIPAKAI SEBAGAI CHECKSUM, bukan sebagai nilai. Ia turunan di sana
// juga, dan tiga angka penyusunnya (Real Masuk, fee, potongan konversi) semuanya ditulis script ini
// — jadi selisih berarti salah satu dari ketiganya salah ketik. Selisihnya DISEBUTKAN dan tidak
// menghentikan run, karena LIMA baris memang tidak akan pernah cocok:
//
//   Mei designingaround.com, Juni designingaround.com, Juli petcins.com
//     Spreadsheet mengurangkan "Sunat Google" DUA KALI: sekali lewat Real Masuk (yang memang sudah
//     dipotong Google), sekali lagi di kolom Saldo Akhir. Di sini Saldo Akhir adalah sisa dari yang
//     BENAR-BENAR mendarat, jadi sunatnya cukup sekali.
//   Mei & Juli psaonlineappointment.com
//     Spreadsheet menghitung Saldo Akhir dari Earning Final, bukan dari Real Masuk; yang Juli malah
//     tidak mengurangkan potongan konversinya sama sekali (Juni, baris yang sama, mengurangkannya).
//     Tiga baris psaonlineappointment.com memakai tiga rumus yang berbeda di sana.
//
// SATU LAGI YANG SENGAJA TIDAK DIREPRODUKSI, dan sudah disebut di seed-company-percents: potongan
// Company kena pendapatan Ad Exchange saja. Baris Mei psaonlineappointment.com dipotong 5% atas
// pendapatan AdSense-nya di spreadsheet (Rp 258.250); kolom Company Ad Exchange di halaman ini akan
// berbunyi Rp 0 untuk baris itu, dan Earning Final-nya lebih besar sebesar angka tersebut.
//
// Idempotent: sebuah baris dikenali dari BULAN + DOMAIN-nya, dan hanya yang belum ada yang ditulis.
// Dijalankan dua kali tidak menghasilkan baris kembar, jadi run yang putus di tengah cukup
// dijalankan ulang.
//
// Kuncinya PUSH KEY, bukan turunan dari bulan + domain: nama domain memuat titik, dan titik tidak
// boleh ada di kunci RTDB.
//
// BUTUH `npm run deploy:rules` JALAN LEBIH DULU — node `payouts` baru, dan tanpa aturannya setiap
// tulisan di sini ditolak permission-denied.

import { get, push, ref, update } from "firebase/database";
import { connect } from "../db.mjs";

// Tahun yang tidak disebut spreadsheet — kolomnya cuma "April".."July".
const YEAR = 2026;
const MONTHS = { April: "04", May: "05", June: "06", July: "07" };

// Kode PIP disalin VERBATIM dari spreadsheet, berikut DUA spasi yang mengapit "• • • •" — kecuali
// satu baris berbahasa Inggris (GG104HWN56) yang cuma satu spasi sesudahnya. Dirapikan jadi satu
// spasi, teksnya berhenti sama dengan notifikasi Google yang jadi buktinya; ia bukan kalimat kita,
// melainkan kutipan.

const OCBC = ["OCBC", "DWIKI ARDIANSAH", "071810143017"];
const MEEZAN = ["Meezan bank", "Imran Aslam", "PK88MEZN0026010114310624"];

// Apa adanya dari spreadsheet. Angka yang KOSONG tidak ditulis sama sekali, dan itu bukan
// kerapian: Rp 0 di kolom Saldo Sebelumnya adalah klaim bahwa bulan lalu habis tepat di nol,
// sementara yang sebenarnya terjadi adalah kolomnya memang dibiarkan kosong.
const ROWS = [
  {
    month: "April",
    domain: "xiaomidriversdownload.com",
    saldoSebelumnya: 116882,
    realMasuk: 36737889,
    rekening: OCBC,
    kodePip: "Pembayaran otomatis: Rekening bank  • • • •  017 sebesar Rp 36.737.889. GG104DV4Y2",
    status: "Sudah Cair",
    saldoAkhir: 36737889,
  },
  {
    month: "April",
    domain: "designingaround.com",
    saldoSebelumnya: 410187,
    realMasuk: 3176798,
    rekening: OCBC,
    kodePip: "Pembayaran otomatis: Rekening bank  • • • •  017 sebesar Rp 3.176.798. GG104ED2D4",
    status: "Sudah Cair",
    saldoAkhir: 3176798,
  },
  {
    month: "May",
    domain: "dekadeko.com",
    saldoSebelumnya: 487686,
    realMasuk: 2562411,
    rekening: OCBC,
    kodePip: "Pembayaran otomatis: Rekening bank  • • • •  017 Rp 2.562.411. GG104F8XCG",
    status: "Sudah Cair",
    saldoAkhir: 2562411,
  },
  {
    month: "May",
    domain: "designingaround.com",
    realMasuk: 4411521,
    rekening: OCBC,
    kodePip: "Pembayaran otomatis: Rekening bank  • • • •  017 sebesar Rp 4.411.521. GG104F25BR",
    status: "Sudah Cair",
    // Sunat Google (Rp 69.087) dikurangkan dua kali di spreadsheet — lihat catatan di kepala berkas.
    saldoAkhir: 4342434,
  },
  {
    month: "May",
    domain: "psaonlineappointment.com",
    saldoSebelumnya: 215163,
    realMasuk: 4882513,
    feePercent: 5,
    potonganKonversi: 451487,
    rekening: MEEZAN,
    kodePip:
      "Pembayaran otomatis: Transfer bank ke rekening bank  • • • •  0624 Rp 5.380.512. GG104FBHE7",
    status: "Sudah Cair",
    // Dihitung dari Earning Final di spreadsheet, bukan dari Real Masuk.
    saldoAkhir: 4398849,
  },
  {
    month: "May",
    domain: "stylefemale.com",
    saldoSebelumnya: 711749,
    realMasuk: 41935908,
    rekening: OCBC,
    kodePip: "Pembayaran otomatis: Rekening bank  • • • •  017 Rp 41.935.908. GG104F2M96",
    status: "Sudah Cair",
    saldoAkhir: 41935908,
  },
  {
    month: "May",
    domain: "xiaomidriversdownload.com",
    // Akun ditutup: tidak ada yang mendarat di rekening, dan seluruh saldonya hangus.
    realMasuk: 0,
    rekening: OCBC,
    kodePip: "Saldo Pencairan Sudah Diminuskan Google (FIX Tidak Cair)",
    status: "Account Close",
    saldoAkhir: 0,
  },
  {
    month: "May",
    domain: "masseffectstore.com",
    saldoSebelumnya: 2088656,
    realMasuk: 2065532,
    rekening: OCBC,
    kodePip: "Pembayaran otomatis: Rekening bank  • • • •  017 sebesar Rp 2.065.532. GG104F28XL",
    status: "Sudah Cair",
    saldoAkhir: 2065532,
  },
  {
    month: "June",
    domain: "petcins.com",
    saldoSebelumnya: 1174267,
    realMasuk: 60679245,
    rekening: OCBC,
    kodePip: "Pembayaran otomatis: Rekening bank  • • • •  017 sebesar Rp 60.679.245. GG104GJGNV",
    status: "Sudah Cair",
    saldoAkhir: 60679245,
  },
  {
    month: "June",
    domain: "masseffectstore.com",
    realMasuk: 41334946,
    rekening: OCBC,
    kodePip: "Pembayaran otomatis: Rekening bank  • • • •  017 sebesar Rp 41.334.946. GG104GK5V0",
    status: "Sudah Cair",
    saldoAkhir: 41334946,
  },
  {
    month: "June",
    domain: "stylefemale.com",
    realMasuk: 103194238,
    rekening: OCBC,
    kodePip: "Pembayaran otomatis: Rekening bank  • • • •  017 sebesar Rp 103.194.238. GG104GIVOS",
    status: "Sudah Cair",
    saldoAkhir: 103194238,
  },
  {
    month: "June",
    domain: "psaonlineappointment.com",
    realMasuk: 36770155,
    feePercent: 5,
    potonganKonversi: 6685574,
    rekening: MEEZAN,
    kodePip:
      "Pembayaran otomatis: Transfer bank ke rekening bank  • • • •  0624 sebesar US$2.049,39. GG104GHUAN",
    status: "Sudah Cair",
    saldoAkhir: 28246073,
  },
  {
    month: "June",
    domain: "xiaomidriversdownload.com",
    realMasuk: 0,
    rekening: OCBC,
    status: "Account Close",
    saldoAkhir: 0,
  },
  {
    month: "June",
    domain: "designingaround.com",
    realMasuk: 11399996,
    rekening: OCBC,
    kodePip: "Pembayaran otomatis: Rekening bank  • • • •  017 sebesar Rp 11.399.996. GG104GCSCT",
    status: "Sudah Cair",
    saldoAkhir: 11431467,
  },
  {
    month: "June",
    domain: "dekadeko.com",
    realMasuk: 3690459,
    rekening: OCBC,
    kodePip: "Pembayaran otomatis: Rekening bank  • • • •  017 sebesar Rp 3.690.459. GG104GI0I5",
    status: "Sudah Cair",
    saldoAkhir: 3690459,
  },
  {
    month: "July",
    domain: "designingaround.com",
    realMasuk: 38690091,
    rekening: OCBC,
    kodePip:
      "Pembayaran otomatis tertunda: Rekening bank  • • • •  017 sebesar Rp 38.690.091. GG104I25R0",
    status: "Pending Payment",
    saldoAkhir: 38690091,
  },
  {
    month: "July",
    domain: "stylefemale.com",
    realMasuk: 160989523,
    rekening: OCBC,
    kodePip: "Pembayaran otomatis: Rekening bank  • • • •  017 sebesar Rp 160.989.523. GG104HWPMX",
    status: "Pending Payment",
    saldoAkhir: 160989523,
  },
  {
    month: "July",
    domain: "psaonlineappointment.com",
    realMasuk: 40107832,
    feePercent: 5,
    potonganKonversi: 7036271,
    rekening: MEEZAN,
    kodePip:
      "Automatic payment: Wire transfer to bank account  • • • • 0624 for $2,271.89. GG104HWN56",
    status: "Pending Payment",
    // Potongan konversinya tidak ikut dikurangkan di spreadsheet — lihat catatan di kepala berkas.
    saldoAkhir: 39353724,
  },
  {
    month: "July",
    domain: "masseffectstore.com",
    realMasuk: 61437700,
    rekening: OCBC,
    kodePip: "Pembayaran otomatis: Rekening bank  • • • •  017 sebesar Rp 61.437.700. GG104HU9DE",
    status: "Pending Payment",
    saldoAkhir: 61437700,
  },
  {
    month: "July",
    domain: "petcins.com",
    realMasuk: 93106008,
    rekening: OCBC,
    kodePip: "Pembayaran otomatis: Rekening bank  • • • •  017 sebesar Rp 93.106.008. GG104I1EO1",
    status: "Pending Payment",
    saldoAkhir: 93197378,
  },
];

const dry = process.argv.includes("--dry");

const norm = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase();
const rupiah = (value) => `Rp ${Math.round(Number(value || 0)).toLocaleString("id-ID")}`;
// Sama persis dengan `monthOf` di src/lib/payouts.js: dua pembaca bulan yang berbeda berarti baris
// yang di layar berbunyi Juni lolos pemeriksaan kembar di sini sebagai bulan yang lain.
const monthOf = (row) => {
  const month = String(row?.month ?? "").trim();
  if (/^\d{4}-\d{2}$/.test(month)) return month;
  const fromDate = String(row?.date ?? "").slice(0, 7);
  return /^\d{4}-\d{2}$/.test(fromDate) ? fromDate : "";
};
const identityOf = (row) => `${monthOf(row)}|${norm(row?.domain)}`;

const db = await connect();
const existing = (await get(ref(db, "payouts"))).val() || {};
const existingRows = Object.entries(existing).filter(([, row]) => row);
const seen = new Set(existingRows.map(([, row]) => identityOf(row)));

// --- terjemahkan spreadsheet jadi baris RTDB ---------------------------------------------------

const wanted = [];
const mismatched = [];

for (const entry of ROWS) {
  if (!MONTHS[entry.month]) throw new Error(`Bulan tidak dikenali: ${entry.month}`);
  const month = `${YEAR}-${MONTHS[entry.month]}`;
  const [bank, namaRekening, noRekening] = entry.rekening;

  const row = {
    month,
    // Tanggal yang benar-benar dibaca filter periode, selalu tanggal 1 — sepola dengan
    // `invalidTraffic`. Bulan yang disimpan sebagai "2026-04" telanjang diurai `new Date()` sebagai
    // tengah malam UTC, dan di zona negatif ia mundur ke Maret.
    date: `${month}-01`,
    domain: entry.domain,
    bank,
    namaRekening,
    noRekening,
    status: entry.status,
  };
  for (const field of ["saldoSebelumnya", "realMasuk", "feePercent", "potonganKonversi"]) {
    if (entry[field] !== undefined) row[field] = entry[field];
  }
  if (entry.kodePip) row.kodePip = entry.kodePip;

  // Checksum: Saldo Akhir yang akan digambar halaman dari ketiga angka yang ditulis baris ini.
  const fee = entry.feePercent ? (entry.realMasuk * entry.feePercent) / 100 : 0;
  const saldoAkhir = Math.round(entry.realMasuk - fee - (entry.potonganKonversi || 0));
  if (saldoAkhir !== entry.saldoAkhir) {
    mismatched.push({ row, saldoAkhir, spreadsheet: entry.saldoAkhir });
  }

  wanted.push(row);
}

if (mismatched.length) {
  console.log(`\n${mismatched.length} baris yang Saldo Akhir-nya ≠ kolom spreadsheet:`);
  for (const { row, saldoAkhir, spreadsheet } of mismatched) {
    console.log(
      `  ! ${row.month} ${row.domain}: spreadsheet ${rupiah(spreadsheet)}, halaman ${rupiah(saldoAkhir)}`,
    );
  }
  console.log(
    "\nLIMA baris memang tidak akan pernah cocok (lihat catatan di kepala berkas ini).\n" +
      "Yang KEENAM adalah salah ketik di Real Masuk, fee, atau potongan konversi.",
  );
}

// --- apa yang akan ditulis ---------------------------------------------------------------------

const pending = [];
for (const row of wanted) {
  const identity = identityOf(row);
  if (seen.has(identity)) {
    console.log(`  = ${row.month} ${row.domain} sudah ada`);
    continue;
  }
  seen.add(identity);
  pending.push(row);
}

console.log(
  `\n${ROWS.length} baris di script, ${existingRows.length} sudah ada di RTDB, ${pending.length} akan ditulis.`,
);
for (const row of pending) {
  console.log(`  + ${row.month} ${row.domain} ${rupiah(row.realMasuk)} (${row.status})`);
}

// Domain yang belum terdaftar tidak menghentikan apa pun — barisnya tetap tersimpan berikut
// rekening dan angka yang diketik. Yang hilang cuma kolom turunannya: tanpa baris di `domains`,
// subdomainnya tidak bisa dicocokkan ke domain induk mana pun, jadi Earning Google sampai Earning
// Final semuanya kosong. Diperbaiki di /domains, bukan di sini.
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

if (!pending.length) {
  console.log("\nTidak ada yang perlu dikerjakan.");
  process.exit(0);
}

if (dry) {
  console.log(`\n--dry: tidak ada yang ditulis. ${pending.length} baris akan dibuat.`);
  process.exit(0);
}

// --- tulis -------------------------------------------------------------------------------------

const now = new Date().toISOString();

for (const row of pending) {
  const rowRef = push(ref(db, "payouts"));
  await update(rowRef, {
    ...row,
    id: rowRef.key,
    createdAt: now,
    createdBy: "migration",
    updatedAt: now,
    updatedBy: "migration",
  });
}

console.log(`\nSelesai. ${pending.length} baris ditulis ke payouts.`);
process.exit(0);
