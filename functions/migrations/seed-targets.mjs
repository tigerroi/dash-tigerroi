// One-off: isi `domainTargets` dengan target yang selama ini tinggal di spreadsheet
// (Juli–Agustus 2026, 29 baris).
//
//   npm run seed:targets -- --dry
//   npm run seed:targets
//   npm run seed:targets -- --replace-legacy      (lihat "BENTUK LAMA" di bawah)
//
// YANG DITULIS CUMA APA YANG DIKETIK ORANG: status terkini, target, kendala, dan catatan. Kolom
// PAYOUT SEBELUMNYA, TERCAPAI, dan SISA TARGET dari spreadsheet TIDAK ditulis — halaman
// menurunkannya dari baris ROI tiap kali dirender (`buildTargetRows` di src/lib/targets.js).
// Menyalinnya ke RTDB menghasilkan dua angka untuk uang yang sama: yang di baris ini beku di nilai
// hari migrasi, yang di sebelahnya bergerak mengikuti sync — dan tidak ada apa pun di layar yang
// bisa menjelaskan selisihnya.
//
// KONSEKUENSI YANG DIKETAHUI DAN DITERIMA: Payout Sebelumnya baris JULI adalah realisasi JUNI, dan
// itu hanya muncul kalau `roiReports` bulan Juni masih ada. Yang tidak terjangkau berbunyi "-",
// bukan angka spreadsheet-nya — "-" yang jujur lebih baik daripada angka yang tidak akan pernah
// cocok dengan kolom Tercapai di baris bulan sebelumnya.
//
// BENTUK LAMA. Node ini sudah dipakai dengan bentuk yang lama — satu ANGKA telanjang di
// `domainTargets/{id}/{YYYY-MM}`, target domain itu tanpa pemisahan jenis akun. Menulis anak di
// bawahnya membuat RTDB mengganti angka itu dengan sebuah objek, jadi angka lamanya hilang tanpa
// jejak. Script berhenti dan menyebutkan bulannya; `--replace-legacy` yang melanjutkannya —
// angka lama itu jatuh ke baris Ad-Exchanger persis seperti yang dilakukan `targetMonthRecord` di
// layar, KECUALI kalau spreadsheet ini memang membawa baris Ad-Exchanger untuk bulan itu (yang
// diketik orang menang atas yang ditebak dari bentuk lama). Menghapus data harus diminta, tidak
// boleh jadi efek samping dari menjalankan sebuah seed.
//
// Idempotent: satu baris dikenali dari DOMAIN + BULAN + JENIS AKUN-nya, yaitu alamat node-nya
// sendiri (`domainTargets/{domainId}/{YYYY-MM}/{slug}`), dan hanya yang belum ada yang ditulis.
// Dijalankan dua kali tidak menimpa apa pun, jadi run yang putus di tengah cukup dijalankan ulang.
//
// TIDAK ada urutan deploy yang mengikat: `domainTargets` sudah punya aturannya di
// database.rules.json sejak lama (.read auth != null, .write admin|keuangan), dan bentuk barunya
// tidak menambah satu pun field yang divalidasi.

import { get, ref, update } from "firebase/database";
import { connect } from "../db.mjs";

// Tahun yang tidak disebut spreadsheet — kolomnya cuma "July"/"August". Berdiri sebagai konstanta
// dan bukan disisipkan dua puluh sembilan kali, supaya salah tahun terbaca sebagai satu angka yang
// keliru dan bukan sebagai dua puluh sembilan baris yang harus dibaca satu per satu.
const YEAR = 2026;
const MONTHS = { July: "07", August: "08" };

// Slug jenis akun. Sama persis dengan ACCOUNT_TYPE_SLUGS di src/lib/targets.js — beda sedikit,
// baris yang ditulis di sini tersimpan di alamat yang tidak pernah dibaca halamannya.
const ADSENSE = "adsense";
const AD_EXCHANGE = "ad-exchanger";

// Apa adanya dari spreadsheet: [bulan, domain, jenis, status terkini, target, kendala, catatan].
// Kolom PAYOUT SEBELUMNYA, TERCAPAI, dan SISA TARGET sengaja tidak ada di sini — lihat catatan di
// atas. Target yang KOSONG (bukan Rp 0) tidak ditulis sama sekali: nol adalah pernyataan ("bulan
// ini domain ini memang tidak ditargetkan"), dan tiga baris di bawah memang belum menyatakan apa
// pun.
const ROWS = [
  ["July", "designingaround.com", ADSENSE, "Running Iklan", 10000000, "", ""],
  ["July", "designingaround.com", AD_EXCHANGE, "Running Iklan", 50000000, "", "FOKUS ADX"],
  ["July", "stylefemale.com", ADSENSE, "Running Iklan", 2000000, "", ""],
  ["July", "stylefemale.com", AD_EXCHANGE, "Running Iklan", 200000000, "", ""],
  ["July", "dekadeko.com", ADSENSE, "Limit Iklan Belum Tayang", 10000000, "IKLAN LIMIT", ""],
  ["July", "dekadeko.com", AD_EXCHANGE, "Review", 0, "REVIEW GOOGLE", ""],
  ["July", "psaonlineappointment.com", ADSENSE, "Limit Iklan Belum Tayang", 0, "IKLAN LIMIT", ""],
  ["July", "psaonlineappointment.com", AD_EXCHANGE, "Running Iklan", 50000000, "", "SUDAH TARGET"],
  ["July", "masseffectstore.com", ADSENSE, "Ready", 0, "", "FOKUS ADX"],
  ["July", "masseffectstore.com", AD_EXCHANGE, "Running Iklan", 100000000, "", ""],
  ["July", "petcins.com", ADSENSE, "Ready", 0, "", "FOKUS ADX"],
  ["July", "petcins.com", AD_EXCHANGE, "Running Iklan", 150000000, "", ""],

  ["August", "designingaround.com", ADSENSE, "Limit", 10000000, "", ""],
  ["August", "designingaround.com", AD_EXCHANGE, "Limit", 50000000, "", ""],
  ["August", "stylefemale.com", ADSENSE, "", 0, "", ""],
  ["August", "stylefemale.com", AD_EXCHANGE, "Running Iklan", 200000000, "", ""],
  ["August", "dekadeko.com", ADSENSE, "Limit", 0, "", ""],
  ["August", "dekadeko.com", AD_EXCHANGE, "Review", 0, "", ""],
  ["August", "psaonlineappointment.com", ADSENSE, "", 0, "", ""],
  ["August", "psaonlineappointment.com", AD_EXCHANGE, "Limit", 50000000, "", ""],
  ["August", "masseffectstore.com", ADSENSE, "", 0, "", ""],
  ["August", "masseffectstore.com", AD_EXCHANGE, "Limit", 100000000, "", ""],
  ["August", "petcins.com", ADSENSE, "", 0, "", ""],
  ["August", "petcins.com", AD_EXCHANGE, "Limit", 150000000, "", ""],
  ["August", "bispdailyupdates.pk", ADSENSE, "", "", "", ""],
  ["August", "bispdailyupdates.pk", AD_EXCHANGE, "Limit", 50000000, "", "Menunggu Iklan Stabil"],
  ["August", "sheetz.us", ADSENSE, "", "", "", ""],
  ["August", "sheetz.us", AD_EXCHANGE, "Akun Disable Sementara", "", "", "26 Hari"],
  ["August", "theglobesimregistration.ph", AD_EXCHANGE, "Ready", "", "", "Menunggu Iklan Stabil"],
];

const dry = process.argv.includes("--dry");
const replaceLegacy = process.argv.includes("--replace-legacy");

const norm = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase();
const rupiah = (value) => (value === "" ? "-" : `Rp ${Number(value || 0).toLocaleString("id-ID")}`);

const db = await connect();

// --- domain id: satu-satunya hal yang tidak ada di spreadsheet ---------------------------------
//
// Baris target tinggal DI BAWAH id domainnya, jadi domain yang belum terdaftar di /domains tidak
// bisa ditulis sama sekali — berbeda dari seed-invalid-traffic, yang barisnya berdiri sendiri dan
// cuma kehilangan kolom turunannya. Yang tidak ketemu disebutkan dan dilewati; menebak id-nya
// berarti target sebuah domain tersimpan di bawah domain lain.
const domains = Object.entries((await get(ref(db, "domains"))).val() || {}).filter(
  ([, row]) => row,
);
const idByDomain = new Map(domains.map(([id, row]) => [norm(row.domainUrl), id]));

const existing = (await get(ref(db, "domainTargets"))).val() || {};

const wanted = [];
const unknownDomains = new Set();

for (const [monthName, domain, slug, status, target, kendala, catatan] of ROWS) {
  if (!MONTHS[monthName]) throw new Error(`Bulan tidak dikenali: ${monthName}`);
  const month = `${YEAR}-${MONTHS[monthName]}`;
  const domainId = idByDomain.get(norm(domain));
  if (!domainId) {
    unknownDomains.add(norm(domain));
    continue;
  }

  const values = {};
  if (status) values.status = status;
  if (target !== "") values.target = Number(target);
  if (kendala) values.kendala = kendala;
  if (catatan) values.catatan = catatan;

  // Baris yang tidak menyatakan apa pun tidak ditulis: sebuah node kosong tidak berbeda dari baris
  // yang belum pernah diisi, kecuali ia berdiri di RTDB sebagai baris yang ada.
  if (Object.keys(values).length === 0) continue;

  wanted.push({ domain, domainId, month, slug, values, target });
}

if (unknownDomains.size) {
  console.log(
    `\nBelum terdaftar di /domains, barisnya DILEWATI (daftarkan dulu, lalu jalankan lagi): ${[...unknownDomains].join(", ")}`,
  );
}

// --- bentuk lama yang akan hilang begitu anaknya ditulis ----------------------------------------

const legacyMonths = [
  ...new Set(
    wanted
      .filter(({ domainId, month }) => {
        const stored = existing?.[domainId]?.[month];
        return stored !== undefined && stored !== null && typeof stored !== "object";
      })
      .map(({ domainId, month, domain }) => `${domainId}|${month}|${domain}`),
  ),
];

if (legacyMonths.length) {
  console.log(
    `\n${legacyMonths.length} bulan masih berbentuk LAMA (satu angka, tanpa jenis akun):`,
  );
  for (const entry of legacyMonths) {
    const [domainId, month, domain] = entry.split("|");
    console.log(`  ~ ${month} ${domain}: ${rupiah(existing[domainId][month])}`);
  }
  if (!replaceLegacy) {
    console.log(
      "\nDitulis begitu saja, angka lama itu hilang tanpa jejak.\n" +
        "Jalankan ulang dengan --replace-legacy: angka lamanya jatuh ke baris Ad-Exchanger (persis\n" +
        "seperti yang dibaca halamannya), kecuali kalau seed ini memang membawa baris Ad-Exchanger\n" +
        "untuk bulan itu.",
    );
    process.exit(1);
  }
}

// --- apa yang akan ditulis ---------------------------------------------------------------------

// Node bulan yang akan ditulis, satu per (domain, bulan) — bukan satu tulisan per jenis akun.
// Bentuk lama harus ikut diselamatkan di tulisan yang SAMA: `update` pada anak sebuah angka
// telanjang mengganti angka itu lebih dulu.
const byMonth = new Map();
const skipped = [];
const pending = [];

for (const row of wanted) {
  const stored = existing?.[row.domainId]?.[row.month];
  const current = stored && typeof stored === "object" ? stored : {};
  if (current[row.slug]) {
    skipped.push(row);
    continue;
  }

  const key = `${row.domainId}|${row.month}`;
  const entry = byMonth.get(key) || {
    domain: row.domain,
    month: row.month,
    domainId: row.domainId,
    values: {},
  };

  // Angka bentuk lama jatuh ke Ad-Exchanger, aturan yang sama dengan `targetMonthRecord` di layar.
  // Yang diketik orang di spreadsheet MENANG atasnya, dan penjaganya adalah `!entry.values[...]`:
  // tanpa itu, urutan baris yang menentukan siapa yang menang — baris Ad-Exchanger yang kebetulan
  // diproses lebih dulu akan ditimpa angka lama saat baris Adsense di sebelahnya menyusul.
  if (
    !entry.values[AD_EXCHANGE] &&
    Number.isFinite(Number(stored)) &&
    String(stored).trim() !== ""
  ) {
    entry.values[AD_EXCHANGE] = { target: Number(stored) };
  }
  entry.values[row.slug] = row.values;
  byMonth.set(key, entry);
  pending.push(row);
}

for (const row of skipped) {
  console.log(`  = ${row.month} ${row.domain} (${row.slug}) sudah ada`);
}

console.log(
  `\n${ROWS.length} baris di script, ${pending.length} akan ditulis ke ${byMonth.size} node bulan.`,
);
for (const row of pending) {
  console.log(
    `  + ${row.month} ${row.domain} (${row.slug}) target ${rupiah(row.target)}${row.values.status ? ` — ${row.values.status}` : ""}`,
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

for (const entry of byMonth.values()) {
  await update(ref(db, `domainTargets/${entry.domainId}/${entry.month}`), entry.values);
}

console.log(`\nSelesai. ${pending.length} baris ditulis ke domainTargets.`);
process.exit(0);
