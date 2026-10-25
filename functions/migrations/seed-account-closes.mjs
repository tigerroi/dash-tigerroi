// Earning bulanan subdomain xiaomidriversdownload.com, April–Juni 2026, dari spreadsheet
// Klassifikasi Sub-Domain.
//
//   npm run seed:account-closes            (tulis)
//   npm run seed:account-closes -- --dry   (lihat dulu, tanpa menulis)
//
// Butuh `npm run deploy:rules` lebih dulu — node `accountCloses` baru.
//
// KENAPA INI DIKETIK DAN BUKAN DISYNC. Akun GAM xiaomidriversdownload.com (network 23350141053)
// ditutup Google pada Mei 2026. `reports:run` tidak akan menjawab lagi untuk network itu,
// subdomainnya tidak pernah terdaftar di /sub-domains, dan `dashboard/roiReports` tidak memuat SATU
// baris pun atas namanya — bulan apa pun. Tiga bulan terakhir domain itu cuma ada di spreadsheet.
//
// YANG DITULIS CUMA KOLOM "(Input)"-NYA: bulan, advertiser, jenis akun, subdomain, earning, dan ad
// spend + ad tax. Seluruh kolom "(Auto)" — Company, Invalid Traffic, Net Profit, Bonus, Net Income
// Owner — diturunkan dashboard dari aturan yang sudah ada, dan dipakai di sini sebagai CHECKSUM:
// selisih di atas Rp 1 menghentikan run. Ditulis, mereka beku pada hari migrasi sementara
// tetangganya bergerak.
//
// Idempotent lewat kunci turunan `{bulan}__{subdomain}__{jenis}__{pic}` — keempatnya, karena
// KEEMPATNYA yang membedakan satu baris dari baris lain (kunci ember di `addBucket` juga begitu).
// Satu subdomain bisa punya baris AdSense DAN Ad-Exchanger di bulan yang sama (April dan Juni
// memang begitu), DAN bisa dipegang dua advertiser sekaligus: flash.xiaomidriversdownload.com
// April berdiri dua kali, Aca Rp 902.639 dan Nurjaman Rp 5.036.731. Tanpa PIC di kunci, yang kedua
// menimpa yang pertama diam-diam — jumlah baris yang dicetak tetap 17, yang tersimpan 16, dan
// selisihnya cuma terbaca sebagai porsi invalid traffic yang meleset di lima baris lain.

import { get, ref, update } from "firebase/database";
import { connect } from "../db.mjs";

const dry = process.argv.includes("--dry");

const ADX = "Ad-Exchanger";
const ADSENSE = "Adsense";

// month, pic, jenis, subdomain, earning, adSpend+adTax | checksum: company, ivt, netProfit, bonus
const ROWS = [
  ["2026-04", "Aca", ADSENSE, "usb", 5_557_184, 873_229, 0, 25_653, 4_658_302, 465_830],
  ["2026-04", "Aca", ADSENSE, "tools", 907_491, 414_111, 0, 4_189, 489_191, 48_919],
  ["2026-04", "Aca", ADX, "flash", 902_639, 383_459, 90_264, 5_476, 423_440, 42_344],
  ["2026-04", "Aca", ADX, "data", 2_401_074, 903_702, 240_107, 14_565, 1_242_699, 124_270],
  ["2026-04", "Nurjaman", ADSENSE, "firmware", 6_601_826, 1_518_302, 0, 30_475, 5_053_049, 757_957],
  ["2026-04", "Nurjaman", ADX, "pro", 17_700_248, 4_154_919, 1_770_025, 107_374, 11_667_930, 1_750_190],
  ["2026-04", "Nurjaman", ADX, "dev", 91_679, 31_648, 9_168, 556, 50_307, 7_546],
  ["2026-04", "Nurjaman", ADX, "flash", 5_036_731, 2_269_702, 503_673, 30_554, 2_232_802, 334_920],
  ["2026-05", "Aca", ADX, "data", 25_427_816, 7_007_796, 2_542_782, 156_935, 15_720_304, 1_572_030],
  ["2026-05", "Aca", ADX, "flash", 11_483_398, 3_452_333, 1_148_340, 70_873, 6_811_852, 681_185],
  ["2026-05", "Nurjaman", ADX, "pro", 35_525_950, 8_705_977, 3_552_595, 219_258, 23_048_120, 3_457_218],
  ["2026-05", "Nurjaman", ADX, "dev", 6_453_307, 1_915_996, 645_331, 39_828, 3_852_152, 577_823],
  ["2026-06", "Aca", ADSENSE, "tools", 878_924, 215_474, 0, 878_924, -215_474, -21_547],
  ["2026-06", "Aca", ADX, "data", 488_577, 172_025, 73_287, 0, 243_265, 24_327],
  ["2026-06", "Nurjaman", ADSENSE, "firmware", 565_175, 289_010, 0, 565_175, -289_010, -43_352],
  ["2026-06", "Nurjaman", ADSENSE, "usb", 156_187, 296_149, 0, 156_187, -296_149, -44_422],
  ["2026-06", "Nurjaman", ADX, "pro", 1_164_183, 896_927, 174_627, 0, 92_629, 13_894],
].map(([month, pic, accountType, host, earning, totalSpending, company, ivt, netProfit, bonus]) => ({
  month,
  pic,
  accountType,
  subDomain: `${host}.xiaomidriversdownload.com`,
  earning,
  totalSpending,
  company,
  ivt,
  netProfit,
  bonus,
}));

const rupiah = (value) => `Rp ${Math.round(value).toLocaleString("id-ID")}`;
const slug = (value) =>
  String(value)
    .replace(/[^a-z0-9]+/gi, "-")
    .toLowerCase();

// --- 1. checksum internal spreadsheet ----------------------------------------------------------
//
// Net Profit = earning − belanja − company − invalid traffic. Kalau baris yang disalin ke sini
// tidak memenuhinya, salah satu angkanya salah ketik — dan tidak ada yang akan memeriksanya lagi
// setelah tersimpan.

const problems = [];
for (const row of ROWS) {
  const netProfit = row.earning - row.totalSpending - row.company - row.ivt;
  if (Math.abs(netProfit - row.netProfit) > 1) {
    problems.push(
      `${row.month} ${row.subDomain} (${row.accountType}): Net Profit hitung ${rupiah(netProfit)} vs spreadsheet ${rupiah(row.netProfit)}`,
    );
  }
}

if (problems.length) {
  console.error("Checksum spreadsheet tidak cocok — tidak ada yang ditulis:");
  for (const line of problems) console.error(`  ${line}`);
  process.exit(1);
}

const db = await connect();

// --- 2. yang diturunkan dashboard harus cocok juga ---------------------------------------------

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

// 2a. Tarif Company yang berlaku pada tanggal 1 tiap bulan.
const percents = Object.values((await get(ref(db, "companyPercents"))).val() || {})
  .filter((row) => String(row?.domain || "").toLowerCase() === "xiaomidriversdownload.com")
  .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(String(row?.effectiveFrom || "")))
  .sort((a, b) => String(a.effectiveFrom).localeCompare(String(b.effectiveFrom)));

const percentAt = (date) => {
  let value = null;
  for (const row of percents) {
    if (String(row.effectiveFrom) <= date) value = Number(row.percent);
  }
  return value;
};

for (const row of ROWS) {
  const expected = row.accountType === ADX ? percentAt(`${row.month}-01`) : null;
  const company = expected === null ? 0 : Math.round((row.earning * expected) / 100);
  if (Math.abs(company - row.company) > 1) {
    fail(
      `Company ${row.month} ${row.subDomain}: tarif ${expected ?? "(tidak ada)"}% menghasilkan ${rupiah(company)}, spreadsheet ${rupiah(row.company)}.`,
    );
  }
}

// 2b. Invalid traffic dibagi menurut porsi earning di dalam (bulan, domain, jenis akun) — persis
// `spreadInvalidTraffic`. Nominalnya sudah ada di koleksi `invalidTraffic`; kalau tidak, baris ini
// akan dihitung dengan invalid traffic nol dan labanya terlalu besar tanpa berbunyi salah.
const traffic = new Map();
for (const row of Object.values((await get(ref(db, "invalidTraffic"))).val() || {})) {
  const month = String(row?.month || String(row?.date || "").slice(0, 7));
  if (String(row?.domain || "").toLowerCase() !== "xiaomidriversdownload.com") continue;
  const total =
    ["check1", "check2", "check3"].reduce((sum, key) => sum + (Number(row[key]) || 0), 0) ||
    Number(row.nominal) ||
    0;
  // Baris LAMA tanpa jenis akun dibagi ke KEDUA sisi, sepola dengan `bucketOf`.
  for (const type of row?.accountType ? [row.accountType] : [ADX, ADSENSE]) {
    const key = `${month}|${type}`;
    traffic.set(key, (traffic.get(key) || 0) + (row?.accountType ? total : total / 2));
  }
}

const earningByBucket = new Map();
for (const row of ROWS) {
  const key = `${row.month}|${row.accountType}`;
  earningByBucket.set(key, (earningByBucket.get(key) || 0) + row.earning);
}

for (const row of ROWS) {
  const key = `${row.month}|${row.accountType}`;
  const pool = earningByBucket.get(key) || 0;
  const share = pool > 0 ? row.earning / pool : 0;
  const expected = Math.round((traffic.get(key) || 0) * share);
  if (Math.abs(expected - row.ivt) > 1) {
    fail(
      `Invalid traffic ${row.month} ${row.subDomain} (${row.accountType}): dashboard membagi ${rupiah(expected)}, spreadsheet ${rupiah(row.ivt)}.` +
        `\n  Nominal (bulan, domain, jenis) tersimpan ${rupiah(traffic.get(key) || 0)} — perbaiki di tab Invalid Traffic dulu.`,
    );
  }
}

// 2c. Tarif bonus tiap advertiser.
const bonusPercent = new Map();
for (const row of Object.values((await get(ref(db, "users"))).val() || {})) {
  const name = String(row?.name || "").trim().toLowerCase();
  if (name) bonusPercent.set(name, Number(row?.bonusPercent) || null);
}

for (const row of ROWS) {
  const percent = bonusPercent.get(row.pic.toLowerCase());
  if (!percent) fail(`Tarif bonus ${row.pic} belum diisi di halaman Team.`);
  const bonus = Math.round((row.netProfit * percent) / 100);
  if (Math.abs(bonus - row.bonus) > 1) {
    fail(
      `Bonus ${row.month} ${row.subDomain}: ${percent}% dari net profit menghasilkan ${rupiah(bonus)}, spreadsheet ${rupiah(row.bonus)}.`,
    );
  }
}

// --- 3. tulis ----------------------------------------------------------------------------------

const existing = (await get(ref(db, "accountCloses"))).val() || {};
const now = new Date().toISOString();
const updates = {};
let baru = 0;

const seen = new Set();
for (const row of ROWS) {
  const id = `${row.month}__${slug(row.subDomain)}__${slug(row.accountType)}__${slug(row.pic)}`;
  if (seen.has(id)) fail(`Kunci kembar: ${id}. Dua baris berbeda akan tersimpan sebagai satu.`);
  seen.add(id);

  const before = existing[id];
  if (!before) baru += 1;

  updates[id] = {
    id,
    month: row.month,
    date: `${row.month}-01`,
    pic: row.pic,
    accountType: row.accountType,
    subDomain: row.subDomain,
    earning: row.earning,
    totalSpending: row.totalSpending,
    note: "Akun GAM ditutup Google; angka dari spreadsheet Klassifikasi Sub-Domain.",
    createdAt: before?.createdAt || now,
    createdBy: before?.createdBy || "seed:account-closes",
    updatedAt: now,
    updatedBy: "seed:account-closes",
  };

  console.log(
    `${before ? "timpa " : "baru  "} ${row.month} ${row.pic.padEnd(9)} ${row.accountType.padEnd(13)} ${row.subDomain.padEnd(38)}` +
      ` earning ${rupiah(row.earning).padStart(15)}  belanja ${rupiah(row.totalSpending).padStart(14)}`,
  );
}

console.log(`\n${ROWS.length} baris (${baru} baru, ${ROWS.length - baru} sudah ada).`);
console.log("Checksum Company, Invalid Traffic, dan Bonus cocok dengan turunan dashboard.");

if (dry) {
  console.log("--dry: tidak ada yang ditulis.");
  process.exit(0);
}

await update(ref(db, "accountCloses"), updates);
console.log("Tersimpan.");
process.exit(0);
