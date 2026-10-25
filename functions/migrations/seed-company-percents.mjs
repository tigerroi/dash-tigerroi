// One-off: isi koleksi `companyPercents` dengan riwayat tarif Potongan Company Ad Exchange yang
// selama ini tinggal di spreadsheet (April–Juli 2026).
//
//   npm run seed:company-percents -- --dry
//   npm run seed:company-percents
//   npm run seed:company-percents -- --drop-legacy
//
// JALANKAN INI, BUKAN `migrate:company-percent`. Yang itu memindahkan satu nilai per domain dari
// kolom `domains.companyPercent` dan memberinya tanggal 01 Jan 2020 — tarif HARI INI yang dipakaikan
// ke seluruh riwayat, persis kebohongan yang koleksi ini ada untuk menghapusnya. Data di bawah
// adalah tarif yang BENAR-BENAR berlaku tiap bulan, jadi ia lebih baik di tiap barisnya.
// `--drop-legacy` membuang baris 01 Jan 2020 itu kalau migrasinya terlanjur jalan.
//
// YANG DIAMATI PER BULAN, YANG DITULIS PER PERUBAHAN. Spreadsheet menyebut tarif tiap bulan untuk
// tiap subdomain; yang disimpan cuma saat tarifnya BERGANTI (xiaomidriversdownload.com: 10% sejak
// April, 15% sejak Juni — dua baris, bukan empat). Itu seluruh gunanya tanggal berlaku, dan baris
// yang mengulang tarif yang sama cuma membuat kolom "Berlaku s/d" penuh rentang sebulan-sebulan
// yang tidak menandai apa pun.
//
// TANGGALNYA TANGGAL 1, dan itu satu-satunya jawaban yang datanya ada: spreadsheet menyebut BULAN,
// jadi yang diketahui cuma "tarifnya sudah berganti pada bulan ini". Kalau ternyata sebuah tarif
// berganti di tengah bulan (domain yang di-relink 21 Mei, lihat Cost Ad Exchange), tanggalnya
// disunting di halaman Potongan Company — di situlah presisi itu bisa ditambahkan, dan koleksi ini
// memang bertanggal supaya bisa.
//
// KOLOM POTONGAN DIPAKAI SEBAGAI CHECKSUM. Ia turunan di spreadsheet juga (tarif x earning), jadi
// menuliskannya berarti menyalin hasil hitungan orang; yang dipakai script ini cuma untuk MENGUJI
// bahwa tarif yang dibacanya benar. Selisih di atas Rp 1 disebutkan dan menghentikan run.
//
// Idempotent: sebuah baris dikenali dari DOMAIN + TANGGAL BERLAKU-nya. Tarif yang sudah ditulis
// lalu disunting orang di halamannya TIDAK ditimpa kembali — yang diperiksa keberadaan barisnya,
// bukan isinya.

import { get, push, ref, remove, update } from "firebase/database";
import { connect } from "../db.mjs";

const ADSENSE = "Adsense";
const AD_EXCHANGE = "Ad-Exchanger";

// Tanggal yang dipakai `migrate-company-percent.mjs` untuk baris warisan kolom lama.
const LEGACY_FROM = "2020-01-01";

const MONTHS = { April: "2026-04", May: "2026-05", June: "2026-06", July: "2026-07" };

// Apa adanya dari spreadsheet, satu baris per subdomain per bulan:
// [bulan, jenis akun, subdomain, domain, earning, tarif %, potongan menurut spreadsheet].
// Tarif dan potongan yang KOSONG adalah sel kosong di sana — baris AdSense hampir semuanya begitu,
// karena potongan ini kena pendapatan Ad Exchange saja.
const ROWS = [
  ["April", ADSENSE,     "usb.xiaomidriversdownload.com",        "xiaomidriversdownload.com",   5557184,  "",  0],
  ["April", ADSENSE,     "tools.xiaomidriversdownload.com",      "xiaomidriversdownload.com",    907491,  "",  0],
  ["April", ADSENSE,     "coverage.designingaround.com",         "designingaround.com",          510016,  "",  0],
  ["April", AD_EXCHANGE, "flash.xiaomidriversdownload.com",      "xiaomidriversdownload.com",    902639,  10,  90264],
  ["April", AD_EXCHANGE, "data.xiaomidriversdownload.com",       "xiaomidriversdownload.com",   2401074,  10,  240107],
  ["April", ADSENSE,     "firmware.xiaomidriversdownload.com",   "xiaomidriversdownload.com",   6601826,  "",  0],
  ["April", AD_EXCHANGE, "pro.xiaomidriversdownload.com",        "xiaomidriversdownload.com",  17700248,  10,  1770025],
  ["April", AD_EXCHANGE, "dev.xiaomidriversdownload.com",        "xiaomidriversdownload.com",     91679,  10,  9168],
  ["April", AD_EXCHANGE, "flash.xiaomidriversdownload.com",      "xiaomidriversdownload.com",   5036731,  10,  503673],
  ["April", ADSENSE,     "kitchen.designingaround.com",          "designingaround.com",         2001749,  "",  0],

  ["May",   AD_EXCHANGE, "data.xiaomidriversdownload.com",       "xiaomidriversdownload.com",  25427816,  10,  2542782],
  ["May",   ADSENSE,     "beauty.stylefemale.com",               "stylefemale.com",             2261838,  "",  0],
  ["May",   AD_EXCHANGE, "flash.xiaomidriversdownload.com",      "xiaomidriversdownload.com",  11483398,  10,  1148340],
  ["May",   AD_EXCHANGE, "shoes.stylefemale.com",                "stylefemale.com",             5669010,  10,  566901],
  ["May",   AD_EXCHANGE, "wealth.designingaround.com",           "designingaround.com",         6706669,  74,  4962935],
  // ANOMALI, sengaja dibiarkan apa adanya — lihat pemeriksaan `adsenseWithPercent` di bawah.
  ["May",   ADSENSE,     "marriage.psaonlineappointment.com",    "psaonlineappointment.com",    5165000,   5,  258250],
  ["May",   ADSENSE,     "exterior.dekadeko.com",                "dekadeko.com",                 627140,  "",  0],
  ["May",   AD_EXCHANGE, "credit.designingaround.com",           "designingaround.com",         1531104,  74,  1133017],
  ["May",   ADSENSE,     "interior.dekadeko.com",                "dekadeko.com",                 795124,  "",  0],
  ["May",   AD_EXCHANGE, "garage.designingaround.com",           "designingaround.com",         9057868,  74,  6702822],
  ["May",   ADSENSE,     "furniture.dekadeko.com",               "dekadeko.com",                 659685,  "",  0],
  ["May",   AD_EXCHANGE, "pro.xiaomidriversdownload.com",        "xiaomidriversdownload.com",  35525950,  10,  3552595],
  ["May",   AD_EXCHANGE, "dev.xiaomidriversdownload.com",        "xiaomidriversdownload.com",   6453307,  10,  645331],
  ["May",   AD_EXCHANGE, "trends.stylefemale.com",               "stylefemale.com",            11750668,  10,  1175067],
  ["May",   AD_EXCHANGE, "wellness.stylefemale.com",             "stylefemale.com",            21869773,  10,  2186977],
  ["May",   AD_EXCHANGE, "thrift.stylefemale.com",               "stylefemale.com",             3494194,  10,  349419],

  ["June",  ADSENSE,     "tools.xiaomidriversdownload.com",      "xiaomidriversdownload.com",    878924,  "",  0],
  ["June",  AD_EXCHANGE, "care.petcins.com",                     "petcins.com",                 9076325,  20,  1815265],
  ["June",  AD_EXCHANGE, "seniorpet.petcins.com",                "petcins.com",                 9504105,  20,  1900821],
  ["June",  AD_EXCHANGE, "wealth.designingaround.com",           "designingaround.com",        12273618,  54,  6627754],
  ["June",  AD_EXCHANGE, "data.xiaomidriversdownload.com",       "xiaomidriversdownload.com",    488577,  15,  73287],
  ["June",  AD_EXCHANGE, "correction.psaonlineappointment.com",  "psaonlineappointment.com",   24985425,  20,  4997085],
  ["June",  AD_EXCHANGE, "apparel.masseffectstore.com",          "masseffectstore.com",        22087331,  20,  4417466],
  ["June",  AD_EXCHANGE, "shoes.stylefemale.com",                "stylefemale.com",            18305624,  10,  1830562],
  ["June",  ADSENSE,     "coverage.designingaround.com",         "designingaround.com",         5789536,  "",  0],
  ["June",  ADSENSE,     "material.dekadeko.com",                "dekadeko.com",                3545341,  "",  0],
  ["June",  ADSENSE,     "firmware.xiaomidriversdownload.com",   "xiaomidriversdownload.com",    565175,  "",  0],
  ["June",  ADSENSE,     "usb.xiaomidriversdownload.com",        "xiaomidriversdownload.com",    156187,  "",  0],
  ["June",  AD_EXCHANGE, "pro.xiaomidriversdownload.com",        "xiaomidriversdownload.com",   1164183,  15,  174627],
  ["June",  AD_EXCHANGE, "dogtraining.petcins.com",              "petcins.com",                22523535,  20,  4504707],
  ["June",  AD_EXCHANGE, "puppy.petcins.com",                    "petcins.com",                30570487,  20,  6114097],
  ["June",  AD_EXCHANGE, "gifts.masseffectstore.com",            "masseffectstore.com",        21860232,  20,  4372046],
  ["June",  AD_EXCHANGE, "setup.masseffectstore.com",            "masseffectstore.com",         7870541,  20,  1574108],
  ["June",  AD_EXCHANGE, "wellness.stylefemale.com",             "stylefemale.com",            53248707,  10,  5324871],
  ["June",  AD_EXCHANGE, "trends.stylefemale.com",               "stylefemale.com",            42666284,  10,  4266628],
  ["June",  AD_EXCHANGE, "tracking.psaonlineappointment.com",    "psaonlineappointment.com",    7015258,  20,  1403052],
  ["June",  AD_EXCHANGE, "support.psaonlineappointment.com",     "psaonlineappointment.com",   13503773,  20,  2700755],
  ["June",  AD_EXCHANGE, "garage.designingaround.com",           "designingaround.com",            1220,  54,  659],
  ["June",  AD_EXCHANGE, "credit.designingaround.com",           "designingaround.com",             351,  54,  190],

  ["July",  AD_EXCHANGE, "trends.stylefemale.com",               "stylefemale.com",            45388885,  10,  4538889],
  ["July",  AD_EXCHANGE, "tracking.psaonlineappointment.com",    "psaonlineappointment.com",   15686633,  20,  3137327],
  ["July",  AD_EXCHANGE, "puppy.petcins.com",                    "petcins.com",                23562044,  20,  4712409],
  ["July",  AD_EXCHANGE, "gifts.masseffectstore.com",            "masseffectstore.com",        18093740,  20,  3618748],
  ["July",  AD_EXCHANGE, "wellness.stylefemale.com",             "stylefemale.com",            38912127,  10,  3891213],
  ["July",  AD_EXCHANGE, "support.psaonlineappointment.com",     "psaonlineappointment.com",    4275701,  20,  855140],
  ["July",  AD_EXCHANGE, "dogtraining.petcins.com",              "petcins.com",                24701235,  20,  4940247],
  ["July",  AD_EXCHANGE, "setup.masseffectstore.com",            "masseffectstore.com",        11106267,  20,  2221253],
  ["July",  AD_EXCHANGE, "maternity.stylefemale.com",            "stylefemale.com",            16891295,  10,  1689130],
  ["July",  AD_EXCHANGE, "insurance.petcins.com",                "petcins.com",                35638305,  20,  7127661],
  ["July",  AD_EXCHANGE, "cosplay.masseffectstore.com",          "masseffectstore.com",        10010575,  20,  2002115],
  ["July",  AD_EXCHANGE, "wealth.designingaround.com",           "designingaround.com",        18911735,  20,  3782347],
  ["July",  AD_EXCHANGE, "apparel.masseffectstore.com",          "masseffectstore.com",        15829627,  20,  3165925],
  ["July",  AD_EXCHANGE, "shoes.stylefemale.com",                "stylefemale.com",            26698432,  10,  2669843],
  ["July",  AD_EXCHANGE, "correction.psaonlineappointment.com",  "psaonlineappointment.com",   18379685,  20,  3675937],
  ["July",  AD_EXCHANGE, "care.petcins.com",                     "petcins.com",                13355668,  20,  2671134],
  ["July",  AD_EXCHANGE, "thrift.stylefemale.com",               "stylefemale.com",            15801630,  10,  1580163],
  ["July",  AD_EXCHANGE, "art.masseffectstore.com",              "masseffectstore.com",        11106866,  20,  2221373],
  ["July",  AD_EXCHANGE, "credit.designingaround.com",           "designingaround.com",        12725837,  20,  2545167],
  ["July",  AD_EXCHANGE, "legal.psaonlineappointment.com",       "psaonlineappointment.com",    2445663,  20,  489133],
  ["July",  AD_EXCHANGE, "seniorpet.petcins.com",                "petcins.com",                  505311,  20,  101062],
  ["July",  AD_EXCHANGE, "garage.designingaround.com",           "designingaround.com",        16889359,  20,  3377872],
  ["July",  ADSENSE,     "bridal.stylefemale.com",               "stylefemale.com",             1020375,  "",  ""],
  ["July",  AD_EXCHANGE, "bridal.stylefemale.com",               "stylefemale.com",            34139373,  10,  3413937],
  ["July",  AD_EXCHANGE, "petnutrition.petcins.com",             "petcins.com",                19148629,  20,  3829726],
  ["July",  AD_EXCHANGE, "payments.psaonlineappointment.com",    "psaonlineappointment.com",   10958160,  20,  2191632],
  ["July",  AD_EXCHANGE, "accessories.masseffectstore.com",      "masseffectstore.com",         9675685,  20,  1935137],
];

const dry = process.argv.includes("--dry");
const dropLegacy = process.argv.includes("--drop-legacy");

const norm = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase();
const rupiah = (value) => `Rp ${Number(value || 0).toLocaleString("id-ID")}`;

// --- 1. periksa checksum tiap baris ------------------------------------------------------------

const brokenChecksum = [];
for (const [month, , subDomain, , earning, percent, stated] of ROWS) {
  if (percent === "" || stated === "") continue;
  const computed = Math.round((earning * percent) / 100);
  // Toleransi Rp 1: spreadsheet membulatkan tiap selnya sendiri, dan selisih pembulatan bukan
  // tarif yang salah dibaca. Yang lebih besar dari itu selalu berarti angkanya yang keliru.
  if (Math.abs(computed - stated) > 1) {
    brokenChecksum.push({ month, subDomain, percent, stated, computed });
  }
}

if (brokenChecksum.length) {
  console.log(`\n${brokenChecksum.length} baris yang potongannya tidak sama dengan tarif x earning:`);
  for (const row of brokenChecksum) {
    console.log(
      `  ! ${row.month} ${row.subDomain} @${row.percent}%: spreadsheet ${rupiah(row.stated)}, hitungan ${rupiah(row.computed)}`,
    );
  }
  console.log("\nTarifnya tidak bisa dipercaya sebelum ini beres. Tidak ada yang ditulis.");
  process.exit(1);
}

// --- 2. baris AdSense yang membawa tarif --------------------------------------------------------

// Potongan Company kena pendapatan Ad Exchange SAJA (`adExchangeEarning` di src/lib/profitLoss.js),
// jadi tarif pada baris AdSense adalah keadaan yang tidak bisa direproduksi dashboard: barisnya
// tetap ditulis sebagai tarif domain itu, tapi earning AdSense-nya tidak akan terpotong.
const adsenseWithPercent = ROWS.filter(([, type, , , , percent]) => type === ADSENSE && percent !== "");
if (adsenseWithPercent.length) {
  console.log(`\n${adsenseWithPercent.length} baris ADSENSE yang membawa tarif Company:`);
  for (const [month, , subDomain, , , percent, stated] of adsenseWithPercent) {
    console.log(`  ? ${month} ${subDomain} @${percent}% = ${rupiah(stated)}`);
  }
  console.log(
    "  Dashboard memotong pendapatan Ad Exchange SAJA, jadi potongan itu tidak akan muncul kembali\n" +
      "  di Laba Rugi. Tarifnya tetap dicatat sebagai tarif domain itu pada bulan tersebut.",
  );
}

// --- 3. satu tarif per (bulan, domain) ----------------------------------------------------------

const observed = new Map(); // "bulan|domain" -> Set<percent>
for (const [month, , , domain, , percent] of ROWS) {
  if (percent === "") continue;
  const key = `${MONTHS[month]}|${norm(domain)}`;
  if (!MONTHS[month]) throw new Error(`Bulan tidak dikenali: ${month}`);
  const set = observed.get(key) || new Set();
  set.add(percent);
  observed.set(key, set);
}

const conflicting = [...observed].filter(([, set]) => set.size > 1);
if (conflicting.length) {
  console.log("\nSatu bulan + domain dengan lebih dari satu tarif — tidak bisa jadi satu baris:");
  for (const [key, set] of conflicting) console.log(`  ! ${key}: ${[...set].join("%, ")}%`);
  console.log("\nTidak ada yang ditulis.");
  process.exit(1);
}

// --- 4. kumpulkan jadi baris per PERUBAHAN ------------------------------------------------------

const byDomain = new Map();
for (const [key, set] of observed) {
  const [month, domain] = key.split("|");
  const list = byDomain.get(domain) || [];
  list.push({ month, percent: [...set][0] });
  byDomain.set(domain, list);
}

const wanted = [];
for (const [domain, list] of [...byDomain].sort()) {
  list.sort((a, b) => a.month.localeCompare(b.month));
  let previous = null;
  for (const entry of list) {
    // Bulan yang tarifnya sama dengan bulan sebelumnya TIDAK menghasilkan baris: tarif berlaku
    // sampai ada yang menggantikannya, dan baris yang mengulang nilai yang sama cuma memenuhi
    // kolom "Berlaku s/d" dengan rentang sebulan-sebulan yang tidak menandai apa pun.
    if (previous !== null && entry.percent === previous) continue;
    previous = entry.percent;
    wanted.push({
      domain,
      percent: entry.percent,
      effectiveFrom: `${entry.month}-01`,
      months: list.filter((each) => each.month >= entry.month).length,
    });
  }
}

// --- 5. apa yang akan ditulis -------------------------------------------------------------------

const db = await connect();
const existingRows = Object.entries((await get(ref(db, "companyPercents"))).val() || {}).filter(
  ([, row]) => row,
);
const identityOf = (row) => `${norm(row?.domain)}|${String(row?.effectiveFrom ?? "").trim()}`;
const seen = new Set(existingRows.map(([, row]) => identityOf(row)));

const pending = [];
for (const row of wanted) {
  if (seen.has(identityOf(row))) {
    console.log(`  = ${row.domain} ${row.percent}% sejak ${row.effectiveFrom} sudah ada`);
    continue;
  }
  seen.add(identityOf(row));
  pending.push(row);
}

console.log(
  `\n${ROWS.length} baris pengamatan -> ${wanted.length} perubahan tarif di ${byDomain.size} domain.` +
    ` ${existingRows.length} baris sudah ada di RTDB, ${pending.length} akan ditulis.`,
);
for (const row of pending) {
  console.log(`  + ${row.domain} ${row.percent}% sejak ${row.effectiveFrom}`);
}

// Domain yang seluruh barisnya AdSense tidak punya tarif sama sekali, dan itu bukan kelalaian:
// tidak ada pendapatan Ad Exchange untuk dipotong.
const withoutRate = [...new Set(ROWS.map(([, , , domain]) => norm(domain)))].filter(
  (domain) => !byDomain.has(domain),
);
if (withoutRate.length) {
  console.log(`\nTanpa satu pun tarif di data ini (seluruh barisnya AdSense): ${withoutRate.join(", ")}`);
}

// --- 6. baris warisan yang berlaku untuk periode yang sama --------------------------------------

// `migrate-company-percent.mjs` menulis tarif HARI INI dengan tanggal 01 Jan 2020. Dibiarkan
// berdampingan dengan data di bawah, ia berlaku untuk seluruh bulan SEBELUM tarif paling awal tiap
// domain — dan tarif hari ini yang dipakaikan ke bulan lampau adalah persis kebohongan yang koleksi
// ini ada untuk menghapusnya.
const legacy = existingRows.filter(([, row]) => String(row?.effectiveFrom ?? "").trim() === LEGACY_FROM);
if (legacy.length) {
  console.log(`\n${legacy.length} baris warisan bertanggal ${LEGACY_FROM} (dari migrate:company-percent):`);
  for (const [key, row] of legacy) console.log(`  ~ ${row.domain} ${row.percent}% (${key})`);
  console.log(
    dropLegacy
      ? "  --drop-legacy: akan dihapus."
      : "  Ia berlaku untuk seluruh bulan sebelum tarif paling awal tiap domain, dengan tarif HARI INI.\n" +
          "  Jalankan ulang dengan --drop-legacy untuk membuangnya.",
  );
}

if (!pending.length && !(dropLegacy && legacy.length)) {
  console.log("\nTidak ada yang perlu dikerjakan.");
  process.exit(0);
}

if (dry) {
  console.log(
    `\n--dry: tidak ada yang ditulis. ${pending.length} baris akan dibuat` +
      (dropLegacy && legacy.length ? `, ${legacy.length} baris warisan akan dihapus.` : "."),
  );
  process.exit(0);
}

// --- 7. tulis -----------------------------------------------------------------------------------

const now = new Date().toISOString();

// Baris baru DULU, penghapusan warisan sesudahnya. Dibalik, run yang putus di tengah meninggalkan
// domain yang tidak punya tarif sama sekali — dan Laba Rugi berhenti memotongnya tanpa satu pun
// pesan, cuma laba yang mendadak lebih besar.
for (const row of pending) {
  const rowRef = push(ref(db, "companyPercents"));
  await update(rowRef, {
    domain: row.domain,
    percent: row.percent,
    effectiveFrom: row.effectiveFrom,
    note: "Riwayat tarif dari spreadsheet April-Juli 2026.",
    id: rowRef.key,
    createdAt: now,
    createdBy: "migration",
    updatedAt: now,
    updatedBy: "migration",
  });
}

if (dropLegacy) {
  for (const [key, row] of legacy) {
    await remove(ref(db, `companyPercents/${key}`));
    console.log(`  - ${row.domain} ${row.percent}% sejak ${LEGACY_FROM} dihapus (${key})`);
  }
}

console.log(
  `\nSelesai. ${pending.length} baris ditulis ke companyPercents` +
    (dropLegacy && legacy.length ? `, ${legacy.length} baris warisan dihapus.` : "."),
);
process.exit(0);
