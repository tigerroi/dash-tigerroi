// One-off: kembalikan belanja iklan Mei 2026 ke tempatnya, dan batalkan penurunan belanja
// `accountCloses` yang dilakukan `migrate:weekly-financials`.
//
//   npm run migrate:may-spend -- --dry
//   npm run migrate:may-spend
//
// ═══ APA YANG SALAH ═══
//
// `migrate:weekly-financials` (4 Sep 2026) menemukan belanja Mei terhitung dua kali — `roiReports`
// Rp 30.138.554 ditambah `accountCloses` Rp 21.082.102 berjumlah Rp 51,2 juta untuk bulan yang
// menurut spreadsheet membelanjakan Rp 36.990.790 — dan membetulkannya dari UJUNG YANG SALAH: ia
// menurunkan belanja xiaomi yang diketik orang menjadi Rp 6.852.236 dan membiarkan baris ROI-nya
// utuh. Yang tumpang tindih memang hilang; yang tertinggal adalah belanja xiaomi berdiri atas nama
// subdomain lain.
//
// Audit 5 Sep 2026 (ke Meta API produksi, ke cermin Keitaro, dan ke spreadsheet acuan):
//
//   1. EMPAT subdomain membelanjakan Rp 21.794.184 sepanjang Mei dan berearning Rp 0 — bukan ""
//      melainkan nol yang dilaporkan GAM — lalu keempatnya MULAI berearning dalam dua minggu
//      pertama Juni: care.petcins.com (4 Jun), petnutrition.petcins.com (4 Jun),
//      gifts.masseffectstore.com (8 Jun), tracking.psaonlineappointment.com (12 Jun).
//   2. Baris-baris itu membawa daftar campaign-nya sendiri (`campaigns`), dan kodenya — pBRw,
//      9brW, kBCD, kYfc — adalah kode yang di cermin Keitaro HARI INI menunjuk keempat subdomain
//      itu. Baris Mei-nya ditulis 2 Sep 2026 oleh backfill, yaitu dengan pendaftaran kode HARI
//      INI, bukan tujuan campaign-nya pada bulan Mei.
//   3. Yang berearning Rp 78.890.471 pada Mei adalah xiaomidriversdownload.com — domain yang akun
//      GAM-nya ditutup Google bulan itu, dan yang menurut dashboard cuma membelanjakan Rp 6,85
//      juta (ROI 1052%) sementara Rp 21,79 juta terbakar tanpa hasil di tempat lain.
//   4. Meta sendiri menjawab Rp 31.095.996 (tanpa pajak) untuk SELURUH akun yang tokennya bisa
//      dibaca sepanjang Mei — sisanya terhadap total spreadsheet berjalan di LINCAH 1240, yang
//      token ini tidak punya izin membacanya, jadi campaign-nya memang tidak pernah masuk
//      `roiReports`.
//
// Uang yang sama, dan yang lebih dipercaya adalah angka ketikan: ia dicatat saat campaign-nya
// masih menunjuk ke sana.
//
// ═══ YANG DITULIS ═══
//
//   `accountCloses` Mei    belanja kembali ke angka spreadsheet (Rp 21.082.102, empat baris)
//   `dashboard/roiReports` belanja Mei keempat subdomain itu jadi "" + `metaMissing: "unmapped"`
//   `weeklyFinancials` Mei belanja bulan itu jadi Rp 15.908.688 (= total sheet − akun tutup)
//
// KOSONG, BUKAN NOL, dan itu bukan kehalusan: yang kita ketahui bukan "subdomain ini tidak
// membelanjakan apa pun pada Mei" melainkan "tidak ada campaign yang menunjuk ke sini bulan itu".
// Nol di sana adalah pernyataan yang tidak ada buktinya, dan ROI −100% yang lahir darinya tidak
// bisa dibedakan dari subdomain yang beriklan tanpa hasil. `unmapped` adalah sebab yang sama yang
// sudah dipakai baris lain, dan ia yang membuat selnya berbunyi "-" alih-alih Rp 0.
//
// KONSEKUENSI YANG DIKETAHUI DAN DITERIMA: belanja yang TERPETAKAN Mei tinggal Rp 8.344.370,
// sementara belanja usaha bulan itu Rp 36.990.790. Selisihnya `coverageGap` sisi belanja — sebagian
// besar akun LINCAH 1240 yang tidak terbaca — dan Laba Rugi sudah menyebutkannya sendiri. Yang
// TIDAK boleh adalah menambalnya dengan membagi rata sisa itu ke baris mana pun: tidak ada satu
// pun bukti tentang subdomain mana yang menerimanya, dan angka yang dikarang di baris harian akan
// dibaca sebagai hasil pengukuran selamanya.
//
// Idempotent: baris yang belanjanya sudah "" dilewati, dan angka `accountCloses` yang sudah sama
// tidak ditulis ulang. Menjalankan `seed:account-closes` sesudah ini TIDAK merusak apa pun — ia
// menulis angka spreadsheet yang sama.

import { get, ref, update } from "firebase/database";
import { connect } from "../db.mjs";

const ACTOR = "migration:may-spend-attribution";
const dry = process.argv.includes("--dry");
const MONTH = "2026-05";

// Total bulanan sheet "DatMas | Lap.Arus Pendapatan (C)" untuk Mei — angka yang sama yang dipakai
// `backfill-weekly-financials`, dan yang tidak berubah oleh migrasi ini.
const SHEET_TOTAL_SPENDING = 36_990_790;
const AD_TAX_RATE = 0.05;

// Belanja akun tutup Mei menurut spreadsheet "Klassifikasi Sub-Domain" — angka yang sama yang
// ditulis `seed:account-closes`, dikembalikan per baris supaya jumlahnya persis Rp 21.082.102.
const CLOSE_SPENDING = {
  "data.xiaomidriversdownload.com": 7_007_796,
  "flash.xiaomidriversdownload.com": 3_452_333,
  "pro.xiaomidriversdownload.com": 8_705_977,
  "dev.xiaomidriversdownload.com": 1_915_996,
};

const rp = (n) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;
const round2 = (n) => Math.round(n * 100) / 100;
const amount = (value) => (value === "" || value == null ? null : Number(value) || 0);

const db = await connect();

// --- 1. baris ROI Mei --------------------------------------------------------------------------

const roiRaw = Object.entries((await get(ref(db, "dashboard/roiReports"))).val() || {})
  .map(([key, row]) => ({ key, ...(row || {}) }))
  .filter((row) => String(row.date || row.key.split("__")[0]).startsWith(MONTH));

const bySub = new Map();
for (const row of roiRaw) {
  const name = String(row.subDomain || "").toLowerCase();
  if (!name) continue;
  const entry = bySub.get(name) || { rows: [], earning: 0, spending: 0, earningKnown: false };
  entry.rows.push(row);
  const earning = amount(row.earning);
  const spending = amount(row.totalSpending);
  if (earning !== null) {
    entry.earning += earning;
    entry.earningKnown = true;
  }
  if (spending !== null) entry.spending += spending;
  bySub.set(name, entry);
}

// Aturannya SATU dan tanpa penilaian per baris: subdomain yang sepanjang Mei membelanjakan uang dan
// berearning NOL — nol yang benar-benar dilaporkan GAM, bukan yang tidak diketahui. Yang berearning
// walau sedikit (coverage.designingaround.com, Rp 6.257) TIDAK ikut: begitu sebuah baris menerima
// uang, tidak ada lagi yang bisa memastikan campaign-nya menunjuk ke tempat lain.
const stripped = [...bySub]
  .filter(([, e]) => e.spending > 0 && e.earningKnown && e.earning === 0)
  .sort((a, b) => b[1].spending - a[1].spending);

if (!stripped.length)
  console.log(`Tidak ada subdomain Mei yang berbelanja tanpa earning — sudah bersih.\n`);

console.log("Subdomain Mei yang berbelanja dan berearning Rp 0 (belanjanya dikosongkan):\n");
let strippedTotal = 0;
for (const [name, entry] of stripped) {
  strippedTotal += entry.spending;
  console.log(
    `  ${name.padEnd(38)} ${rp(entry.spending).padStart(15)}  ${entry.rows.length} baris`,
  );
}
console.log(`  ${"TOTAL".padEnd(38)} ${rp(strippedTotal).padStart(15)}\n`);

const roiUpdates = {};
let touched = 0;
for (const [, entry] of stripped) {
  for (const row of entry.rows) {
    if (amount(row.totalSpending) === null && row.metaMissing === "unmapped") continue;
    roiUpdates[row.key] = {
      spending: "",
      totalSpending: "",
      metaAds: "",
      profit: "",
      roi: "",
      // Sebabnya, dengan kosakata yang sudah dipakai baris lain: tidak ada campaign Meta yang
      // menunjuk ke subdomain ini pada bulan itu. Tanpa ini, sel kosongnya tidak bisa dibedakan
      // dari laporan Meta yang gagal datang.
      metaMissing: "unmapped",
      updatedAt: new Date().toISOString(),
      updatedBy: ACTOR,
    };
    touched += 1;
  }
}

const mappedAfter = roiRaw.reduce((total, row) => {
  if (roiUpdates[row.key]) return total;
  return total + (amount(row.totalSpending) || 0);
}, 0);

// --- 2. accountCloses Mei ----------------------------------------------------------------------

const closes = Object.entries((await get(ref(db, "accountCloses"))).val() || {})
  .map(([id, row]) => ({ id, ...(row || {}) }))
  .filter((row) => String(row.month || String(row.date || "").slice(0, 7)) === MONTH);

const closeUpdates = {};
let closeTotal = 0;
console.log("Belanja akun ditutup Mei, dikembalikan ke angka spreadsheet:\n");
for (const row of closes) {
  const want = CLOSE_SPENDING[String(row.subDomain || "").toLowerCase()];
  if (want == null) {
    console.error(`Baris accountCloses tak dikenal: ${row.subDomain}. Tidak ada yang ditulis.`);
    process.exit(1);
  }
  closeTotal += want;
  const before = Number(row.totalSpending) || 0;
  console.log(
    `  ${String(row.subDomain).padEnd(38)} ${rp(before).padStart(15)} -> ${rp(want).padStart(15)}`,
  );
  if (Math.abs(before - want) <= 1) continue;
  closeUpdates[row.id] = {
    totalSpending: want,
    note:
      "Belanja spreadsheet, dikembalikan 5 Sep 2026: penurunan 4 Sep membetulkan hitungan ganda " +
      "dari ujung yang salah — yang tumpang tindih ada di baris ROI subdomain lain, bukan di sini.",
    updatedAt: new Date().toISOString(),
    updatedBy: ACTOR,
  };
}
const missing = Object.keys(CLOSE_SPENDING).filter(
  (name) => !closes.some((row) => String(row.subDomain || "").toLowerCase() === name),
);
if (missing.length) {
  console.error(`\nBaris accountCloses Mei tidak lengkap — hilang: ${missing.join(", ")}`);
  process.exit(1);
}
console.log(`  ${"TOTAL".padEnd(38)} ${" ".repeat(15)}    ${rp(closeTotal).padStart(15)}\n`);

// --- 3. weeklyFinancials Mei -------------------------------------------------------------------
//
// Belanja usaha Mei DIKURANGI belanja akun tutup, karena Laba Rugi menjumlahkan keduanya. Totalnya
// tidak berubah sedikit pun (Rp 36.990.790); yang berubah cuma pembagiannya antara dua sumber itu.

const weekly = (await get(ref(db, "dashboard/weeklyFinancials"))).val() || {};
const days = Object.keys(weekly)
  .filter((date) => date.startsWith(MONTH))
  .sort();
if (!days.length) {
  console.error("weeklyFinancials Mei kosong — jalankan migrate:weekly-financials dulu.");
  process.exit(1);
}

const targetSpending = round2(SHEET_TOTAL_SPENDING - closeTotal);

// Bentuk hariannya mengikuti porsi belanja `roiReports` yang TERSISA sesudah pengosongan di atas —
// bentuk dari data yang masih berdiri, bukan dari baris yang barusan dinyatakan bukan miliknya.
const weights = days.map((date) =>
  roiRaw.reduce((total, row) => {
    if (roiUpdates[row.key]) return total;
    if (String(row.date || row.key.split("__")[0]) !== date) return total;
    return total + (amount(row.totalSpending) || 0);
  }, 0),
);
const weightSum = weights.reduce((a, b) => a + b, 0);
const shares = weightSum > 0 ? weights.map((w) => w / weightSum) : days.map(() => 1 / days.length);
const raw = shares.map((s) => targetSpending * s);
const floors = raw.map((v) => Math.floor(v * 100) / 100);
let rest = round2(targetSpending - floors.reduce((a, b) => a + b, 0));
const perDay = [...floors];
for (const { i } of raw
  .map((v, i) => ({ i, frac: v - floors[i] }))
  .sort((a, b) => b.frac - a.frac)) {
  if (rest <= 0) break;
  const step = Math.min(0.01, rest);
  perDay[i] = round2(perDay[i] + step);
  rest = round2(rest - step);
}

const weeklyUpdates = {};
days.forEach((date, i) => {
  const totalSpending = perDay[i];
  const totalSpend = round2(totalSpending / (1 + AD_TAX_RATE));
  weeklyUpdates[date] = {
    totalSpend,
    adTax: round2(totalSpending - totalSpend),
    totalSpending,
    source: "spreadsheet",
    updatedAt: new Date().toISOString(),
    updatedBy: ACTOR,
  };
});

// --- 4. periksa sebelum menulis ----------------------------------------------------------------

const check = round2(targetSpending + closeTotal);
if (Math.abs(check - SHEET_TOTAL_SPENDING) > 1) {
  console.error(
    `Total Mei ${rp(check)} tidak sama dengan spreadsheet ${rp(SHEET_TOTAL_SPENDING)}.`,
  );
  process.exit(1);
}

console.log("Sesudahnya, Mei 2026 berbunyi:");
console.log(
  `  Laba Rugi · Total belanja iklan : ${rp(targetSpending)} (usaha) + ${rp(closeTotal)} (akun tutup) = ${rp(check)}`,
);
console.log(
  `  Cash Flow · belanja terpetakan  : ${rp(mappedAfter)} + ${rp(closeTotal)} = ${rp(mappedAfter + closeTotal)}`,
);
console.log(
  `  coverageGap sisi belanja        : ${rp(check - (mappedAfter + closeTotal))} (akun yang tidak terbaca token Meta)`,
);
console.log(
  `\nBaris: ${touched} baris ROI, ${Object.keys(closeUpdates).length} baris akun tutup, ${days.length} titik weeklyFinancials.`,
);

if (dry) {
  console.log("\n--dry: tidak ada yang ditulis.");
  process.exit(0);
}

for (const [key, patch] of Object.entries(roiUpdates)) {
  await update(ref(db, `dashboard/roiReports/${key}`), patch);
}
for (const [id, patch] of Object.entries(closeUpdates)) {
  await update(ref(db, `accountCloses/${id}`), patch);
}
for (const [date, patch] of Object.entries(weeklyUpdates)) {
  await update(ref(db, `dashboard/weeklyFinancials/${date}`), patch);
}

console.log("\nSelesai.");
process.exit(0);
