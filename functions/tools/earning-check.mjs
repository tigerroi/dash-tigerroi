// Adu Earning yang dipakai dashboard dengan angka di laporan GAM/AdSense.
//
//   npm run earning:check -- stylefemale.com 2026-07
//   npm run earning:check -- stylefemale.com 2026-05 2026-06 2026-07
//   npm run earning:check -- stylefemale.com 2026-07 --hari      (rincian per hari)
//
// KENAPA ALAT INI ADA. Earning di dashboard datang dari API — `earningRowsByDimensions` memanggil
// Ad Manager `reports:run` (atau AdSense v2), dan `roiReportUpdate` menuliskan hasilnya ke
// `dashboard/roiReports`. Tapi angka BULANAN di layar bukan angka yang diminta ke API sekali
// sebulan: ia JUMLAH baris harian yang tersimpan, dan dua hal bisa membuatnya lebih kecil daripada
// laporan yang sama dibuka di konsol Ad Manager:
//
//   1. HARI YANG TIDAK PERNAH DISYNC tidak punya baris. Tiap run cuma meminta rentang
//      `GAM_RANGE_DAYS` (default 1) — kemarin, plus hari berjalan. Bulan yang lewat sebelum sync
//      ini jalan, atau hari yang sync-nya gagal dan tidak pernah diulang, tidak punya barisnya
//      sama sekali. Yang hilang bukan angka yang salah melainkan hari yang tidak ada.
//
//   2. SITUS YANG BELUM TERDAFTAR DI /sub-domains DIBUANG. `sync-subdomains.mjs` mencocokkan nama
//      situs di laporan dengan `subDomains.name`; yang tidak cocok masuk `unmatchedGam` dan tidak
//      pernah jadi baris ROI. Laporan GAM menghitungnya, dashboard tidak.
//
// Keduanya BUKAN kesalahan pembacaan API, dan itu yang alat ini ada untuk membuktikan: ia
// memisahkan "angkanya beda" dari "harinya tidak ada" dan "situsnya tidak terdaftar" — tiga
// keadaan yang diperbaiki di tiga tempat berbeda.
//
// HANYA MEMBACA. Tidak ada satu pun tulisan ke RTDB.

import { get, ref } from "firebase/database";
import { connect } from "../db.mjs";

const args = process.argv.slice(2);
const perDay = args.includes("--hari");
const positional = args.filter((arg) => !arg.startsWith("--"));
const domainArg = positional[0];
const months = positional.slice(1).filter((arg) => /^\d{4}-\d{2}$/.test(arg));

if (!domainArg || months.length === 0) {
  console.log("Pakai: npm run earning:check -- <domain> <YYYY-MM> [YYYY-MM ...] [--hari]");
  process.exit(1);
}

const norm = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase();
const rupiah = (value) => `Rp ${Math.round(Number(value) || 0).toLocaleString("id-ID")}`;
const pad = (text, width) => String(text).padEnd(width);
const padLeft = (text, width) => String(text).padStart(width);
const hasAmount = (value) => value !== null && value !== undefined && value !== "" && value !== "-";

const db = await connect();
const [reportsSnap, subsSnap, domainsSnap] = await Promise.all([
  get(ref(db, "dashboard/roiReports")),
  get(ref(db, "subDomains")),
  get(ref(db, "domains")),
]);

const reports = Object.values(reportsSnap.val() || {}).filter(Boolean);
const subs = Object.values(subsSnap.val() || {}).filter(Boolean);
const domains = Object.values(domainsSnap.val() || {}).filter(Boolean);

const domain = norm(domainArg);
if (!domains.some((row) => norm(row.domainUrl) === domain)) {
  console.log(
    `! ${domainArg} tidak terdaftar di /domains — pencocokan akhiran tidak akan bekerja.`,
  );
}

// Subdomain milik domain ini menurut /sub-domains. Inilah daftar yang benar-benar bisa jadi baris
// ROI; nama situs di laporan yang tidak ada di sini dibuang sisi sync.
const registered = subs
  .filter((row) => norm(row.parentDomain) === domain || norm(row.name).endsWith(`.${domain}`))
  .map((row) => norm(row.name));
const registeredSet = new Set(registered);

console.log(`\n${domainArg} — ${registered.length} subdomain terdaftar di /sub-domains`);
console.log(registered.length ? `  ${registered.join(", ")}` : "  (tidak ada)");

for (const month of months) {
  const rows = reports.filter((row) => {
    if (String(row?.date ?? "").slice(0, 7) !== month) return false;
    const host = norm(row.subDomain);
    return host === domain || host.endsWith(`.${domain}`);
  });

  console.log(`\n=== ${month} ===`);
  if (rows.length === 0) {
    console.log("  Tidak ada satu pun baris ROI. Bulan ini belum pernah tersentuh sync.");
    continue;
  }

  // Hari mana saja yang punya baris — pertanyaan pertama, karena bulan yang cuma tersync separuh
  // menghasilkan total yang lebih kecil tanpa satu pun angka yang salah.
  const daysWithRows = new Set(rows.map((row) => String(row.date).slice(0, 10)));
  const [year, index] = month.split("-").map(Number);
  const daysInMonth = new Date(year, index, 0).getDate();
  const allDays = Array.from(
    { length: daysInMonth },
    (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`,
  );
  const missingDays = allDays.filter((day) => !daysWithRows.has(day));

  const byHost = new Map();
  let unknownEarning = 0;
  for (const row of rows) {
    const host = norm(row.subDomain);
    const entry = byHost.get(host) || {
      earning: 0,
      adx: 0,
      adsense: 0,
      adServer: 0,
      days: 0,
      unknown: 0,
    };
    if (hasAmount(row.earning)) {
      entry.earning += Number(row.earning) || 0;
      entry.adx += Number(row.adxRevenue) || 0;
      entry.adsense += Number(row.adsenseRevenue) || 0;
      entry.adServer += Number(row.adServerRevenue) || 0;
      entry.days += 1;
    } else {
      entry.unknown += 1;
      unknownEarning += 1;
    }
    byHost.set(host, entry);
  }

  const sorted = [...byHost].sort((a, b) => b[1].earning - a[1].earning);
  const width = Math.max(...sorted.map(([host]) => host.length), 20);
  console.log(
    `  ${pad("Subdomain", width)} ${padLeft("Earning", 18)} ${padLeft("AdX+AdServer", 18)} ${padLeft("AdSense", 14)}  hari`,
  );
  let total = 0;
  for (const [host, entry] of sorted) {
    total += entry.earning;
    const note = registeredSet.has(host) ? "" : "  <- TIDAK terdaftar";
    const unknown = entry.unknown ? ` +${entry.unknown} hari tanpa earning` : "";
    console.log(
      `  ${pad(host, width)} ${padLeft(rupiah(entry.earning), 18)} ${padLeft(rupiah(entry.adx + entry.adServer), 18)} ${padLeft(rupiah(entry.adsense), 14)}  ${entry.days}${unknown}${note}`,
    );
  }
  console.log(`  ${pad("TOTAL", width)} ${padLeft(rupiah(total), 18)}`);

  // "Tidak ada baris" punya DUA arti, dan keduanya tidak bisa dibedakan dari sini: hari yang tidak
  // pernah disync, ATAU hari yang seluruh subdomainnya tidak menghasilkan apa-apa (sisi sync hanya
  // menulis baris untuk subdomain yang muncul di laporan). Menyebutnya "earning yang hilang" akan
  // mengirim orang mengejar uang yang memang tidak pernah ada — Mei 2026 punya 14 hari tanpa baris
  // dan totalnya tetap sama persis dengan laporan GAM.
  //
  // Yang membedakannya cuma satu: TOTAL di atas diadu dengan laporan bulan itu di konsol. Cocok,
  // hari-hari itu memang nol; kurang, hari-hari itu yang hilang.
  console.log(
    `\n  Hari yang punya baris: ${daysWithRows.size} dari ${daysInMonth}.` +
      (missingDays.length
        ? `\n  Tanpa baris sama sekali (${missingDays.length} hari): ${missingDays.join(", ")}` +
          "\n  -> bisa berarti hari itu belum pernah disync, bisa juga berarti seluruh subdomain" +
          "\n     tidak menghasilkan apa-apa hari itu. Yang membedakan cuma TOTAL di atas diadu" +
          "\n     dengan laporan bulan itu di konsol Ad Manager."
        : ""),
  );
  if (unknownEarning) {
    console.log(
      `  ${unknownEarning} baris ADA tapi earning-nya tidak diketahui (laporan gagal saat itu) — dilewati, bukan dihitung nol.`,
    );
  }

  // Subdomain terdaftar yang TIDAK punya satu baris pun bulan ini: entah memang tidak menghasilkan,
  // entah namanya tidak cocok dengan nama situs di laporan.
  const silent = registered.filter((host) => !byHost.has(host));
  if (silent.length) {
    console.log(`  Terdaftar tapi tanpa baris bulan ini: ${silent.join(", ")}`);
  }

  if (perDay) {
    console.log("\n  Per hari:");
    const byDay = new Map();
    for (const row of rows) {
      const day = String(row.date).slice(0, 10);
      byDay.set(
        day,
        (byDay.get(day) || 0) + (hasAmount(row.earning) ? Number(row.earning) || 0 : 0),
      );
    }
    for (const day of allDays) {
      const value = byDay.has(day) ? rupiah(byDay.get(day)) : "(tidak ada baris)";
      console.log(`    ${day}  ${padLeft(value, 18)}`);
    }
  }
}

console.log(
  "\nAngka di atas adalah yang dipakai kolom Earning di halaman Invalid Traffic dan Target.\n" +
    "Adu kolom AdX+AdServer dengan 'Pendapatan Ad Exchange' di konsol Ad Manager untuk bulan yang\n" +
    "sama; kolom AdSense tidak ada di laporan itu, jadi TOTAL Earning memang akan lebih besar.\n\n" +
    "Kalau AdX+AdServer lebih kecil daripada laporan GAM, sebabnya salah satu dari:\n" +
    "  - hari yang tidak punya baris (disebut di atas)     -> sync ulang mundur:\n" +
    "      GAM_RANGE_DAYS=<jumlah hari> npm run sync:roi   (melebar mundur dari kemarin, seluruh armada)\n" +
    "    atau isi lewat kolom 'Earning - input manual' di baris Invalid Traffic-nya\n" +
    "  - situs yang belum terdaftar di /sub-domains        -> daftarkan, atau terima sebagai selisih\n" +
    "  - angka per subdomain yang memang berbeda           -> GAM menyatakan ulang pendapatan setelah\n" +
    "    bulan ditutup; baris harian kita membeku di angka saat ia disync, dan sync ulang mundur\n" +
    "    itulah yang menyegarkannya.",
);
process.exit(0);
