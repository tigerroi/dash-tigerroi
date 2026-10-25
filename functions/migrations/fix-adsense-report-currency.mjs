// One-off: betulkan baris ROI yang earning AdSense-nya tersimpan sebagai rupiah padahal dolar.
//
//   npm run migrate:adsense-currency -- --dry   # lihat rencananya, tidak menulis apa pun
//   npm run migrate:adsense-currency            # tulis
//
// Sebabnya ada di adsense.js: `accounts.list` AdSense v2 tidak mengembalikan mata uang, jadi
// mata uang akun selalu kosong dan `convertRowsToIdr` tidak mengalikan apa pun. Sejak laporan
// dibaca mata uangnya sendiri (`reportCurrency`) baris baru sudah benar — yang tertinggal adalah
// baris yang terlanjur ditulis: "Rp 1" untuk hari yang di layar AdSense berbunyi IDR 13.521.
//
// KURSNYA DARI GOOGLE, BUKAN DARI API KURS. Laporan yang sama diminta dua kali — sekali dalam USD,
// sekali dalam IDR (`currencyCode`) — dan perbandingan keduanya per situs per hari yang dipakai
// menskala baris lama. Kurs harian open.er-api hanya punya kurs HARI INI, jadi memakainya untuk
// hari-hari lampau berarti menulis angka yang tidak akan pernah cocok dengan layar AdSense.
//
// Baris snapshot (per sync) tidak bisa diminta ulang ke Google sama sekali — laporannya selalu
// untuk hari penuh, dan "keadaan pukul 15:00" tidak ada di API mana pun. Karena itu baris snapshot
// DISKALA, sementara baris harian ditulis dari angka IDR yang benar-benar dilaporkan Google.
//
// Idempotent: baris yang earning-nya sudah jauh di atas total USD hari itu (mustahil untuk angka
// dolar) dianggap sudah dibetulkan dan dilewati.

import { get, ref, update } from "firebase/database";
import { connect } from "../db.mjs";
import { runAccountReportByDimensions } from "../adsense.js";
import { accessTokenFrom } from "../oauth.mjs";
import { adsenseAccountName, earningAccounts, resolveCredential } from "../sync-core.js";

const dry = process.argv.includes("--dry");
// Batas hari: baris SEBELUM tanggal ini yang dibetulkan. Bawaannya BESOK, jadi hari berjalan ikut
// — snapshot pagi ini ditulis sync versi lama dan tidak akan ditulis ulang oleh siapa pun (satu
// baris per jam, bukan satu baris yang ditimpa).
const tomorrow = (() => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
})();
const until = process.argv.find((a) => a.startsWith("--until="))?.slice(8) || tomorrow;
const since = process.argv.find((a) => a.startsWith("--since="))?.slice(8) || "2026-07-01";

const round = (n, p = 2) => Math.round(n * 10 ** p) / 10 ** p;
const toDateParts = (iso) => {
  const [year, month, day] = iso.split("-").map(Number);
  return { year, month, day };
};
const dayBefore = (iso) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

const db = await connect();
const configs = (await get(ref(db, "googleApiConfigs"))).val() || {};
const adsense = (await get(ref(db, "adsenseAccounts"))).val() || {};
const range = { startDate: toDateParts(since), endDate: toDateParts(dayBefore(until)) };

// --- Berapa rupiah satu situs pada satu hari, menurut Google sendiri -----------------------------
const usdBySiteDay = new Map(); // "site|date" -> jumlah dalam mata uang laporan bawaan (USD)
const idrBySiteDay = new Map(); // "site|date" -> jumlah yang sama, diminta dalam IDR
const affectedSites = new Set();

for (const { account, label } of earningAccounts({}, adsense)) {
  const token = await accessTokenFrom(resolveCredential(account, configs));
  const address = adsenseAccountName(account);
  const fetchIn = async (currency) => {
    // `fetchReport` membaca mata uangnya dari env — satu-satunya cara meminta laporan yang sama
    // dalam dua mata uang tanpa mengubah tanda tangan fungsi yang dipakai sync.
    const before = process.env.ADSENSE_CURRENCY;
    process.env.ADSENSE_CURRENCY = currency;
    try {
      return await runAccountReportByDimensions(address, range, token, ["DATE", "SITE"]);
    } finally {
      if (before === undefined) delete process.env.ADSENSE_CURRENCY;
      else process.env.ADSENSE_CURRENCY = before;
    }
  };

  // Apa adanya, mengikuti mata uang akun — itu bentuk angka yang terlanjur tersimpan di RTDB.
  const native = await fetchIn("");
  const currency = native.find((r) => r.reportCurrency)?.reportCurrency || "";
  if (currency !== "USD") {
    console.log(`· ${label} — laporan ${currency || "tanpa mata uang"}, tidak terpengaruh`);
    continue;
  }
  const inIdr = await fetchIn("IDR");
  for (const row of native) {
    const key = `${row.keys[1]}|${row.keys[0]}`;
    usdBySiteDay.set(key, (usdBySiteDay.get(key) || 0) + row.earning);
    affectedSites.add(row.keys[1]);
  }
  for (const row of inIdr) {
    const key = `${row.keys[1]}|${row.keys[0]}`;
    idrBySiteDay.set(key, (idrBySiteDay.get(key) || 0) + row.earning);
  }
  console.log(`! ${label} — laporan USD, ${affectedSites.size} situs terpengaruh`);
}

if (affectedSites.size === 0) {
  console.log("Tidak ada akun AdSense yang melapor dalam USD — tidak ada yang dibetulkan.");
  process.exit(0);
}

// --- Baris mana yang perlu dibetulkan -----------------------------------------------------------
function ratioFor(site, date) {
  const key = `${site}|${date}`;
  const usd = usdBySiteDay.get(key);
  const idr = idrBySiteDay.get(key);
  if (!usd || !idr) return null;
  return { ratio: idr / usd, usd, idr };
}

// Baris ini berdenominasi dolar (angka mentah dari laporan) atau sudah rupiah? Yang di atas total
// USD hari itu mustahil dolar — dan mengalikan angka rupiah sekali lagi adalah kesalahan yang jauh
// lebih sulit dilihat daripada "Rp 1", jadi pertanyaannya dijawab per baris, bukan diasumsikan.
const usdDenominated = (row, usd) => Number(row.earning) <= usd * 1.5;

async function fixNode(path, groupOf) {
  const all = (await get(ref(db, path))).val() || {};
  const groups = new Map();
  for (const [key, row] of Object.entries(all)) {
    const site = String(row?.subDomain || "");
    const date = String(row?.date || "");
    if (!affectedSites.has(site)) continue;
    if (!date || date >= until || date < since) continue;
    const earning = Number(row?.earning);
    if (!Number.isFinite(earning) || earning <= 0) continue;
    const info = ratioFor(site, date);
    if (!info) continue;
    const group = groupOf(row);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push({ key, row, info, date });
  }

  const updates = {};
  let count = 0;
  for (const [, rows] of groups) {
    rows.sort((a, b) => a.key.localeCompare(b.key));
    let previous = null;
    for (const { key, row, info } of rows) {
      // Baris harian: angka IDR yang benar-benar dilaporkan Google untuk hari itu — termasuk baris
      // yang sudah sempat dikonversi sendiri lewat kurs harian, yang meleset ~0,7% karena API
      // membulatkan dolarnya ke dua desimal. Baris snapshot: nilai lamanya diskala kalau masih
      // dolar, dibiarkan kalau sudah rupiah — hari yang belum selesai tidak bisa diminta ulang.
      const isUsd = usdDenominated(row, info.usd);
      const earning =
        row.partial === true
          ? round(isUsd ? Number(row.earning) * info.ratio : Number(row.earning))
          : round(info.idr);
      const totalSpending = Number(row.totalSpending);
      const impressions = Number(row.impressions) || 0;
      const clicks = Number(row.clicks) || 0;
      const rpm = impressions ? (earning / impressions) * 1000 : 0;
      const next = {
        earning,
        adsense: earning,
        // Seluruh pendapatan akun AdSense berdiri sendiri adalah pendapatan AdSense; adx/adServer
        // nol di baris ini sudah benar dan tidak disentuh.
        adsenseRevenue: earning,
        // Angkanya sekarang rupiah yang diminta ke Google, bukan dolar yang dikonversi sendiri —
        // jadi tidak ada nilai asli untuk ditampilkan dan tidak ada kurs untuk membaginya balik.
        currency: "IDR",
        fxRate: null,
        cpc: clicks ? earning / clicks : 0,
        ecpm: rpm,
        pageRpm: rpm,
      };
      if (Number.isFinite(totalSpending) && totalSpending > 0) {
        next.profit = round(earning - totalSpending);
        next.roi = round(((earning - totalSpending) / totalSpending) * 100);
      }
      // Fluktuasi dihitung ulang terhadap baris SEBELUMNYA yang juga dibetulkan: selisih antara
      // angka rupiah baru dan angka dolar lama bukan fluktuasi apa pun.
      next.flukEarn = previous ? round(earning - previous.earning) : "-";
      next.flukRoi =
        previous && typeof next.roi === "number" && typeof previous.roi === "number"
          ? round(next.roi - previous.roi)
          : "-";
      // Baris yang angkanya sudah persis dan tidak lagi membawa kurs tidak ditulis ulang: tulisan
      // yang tidak mengubah apa pun cuma menggeser `updatedAt` dan menghapus jejak sync aslinya.
      const settled =
        Math.abs(earning - Number(row.earning)) < 0.5 &&
        row.currency === "IDR" &&
        (row.fxRate === null || row.fxRate === undefined);
      if (settled) continue;
      for (const [field, value] of Object.entries(next)) updates[`${path}/${key}/${field}`] = value;
      previous = { earning, roi: next.roi };
      count++;
      console.log(
        `  ${key} ${String(row.subDomain).padEnd(40)} ${String(row.earning).padStart(8)} -> ${String(earning).padStart(9)}` +
          `${typeof next.roi === "number" ? `  ROI ${row.roi} -> ${next.roi}` : ""}`,
      );
    }
  }
  if (!dry && count) await update(ref(db), updates);
  return count;
}

console.log(`\ndashboard/roiReports (baris harian, ${since} s/d ${dayBefore(until)}):`);
const daily = await fixNode("dashboard/roiReports", (row) => row.subDomain);
console.log(`\ndashboard/roiSnapshots (baris per sync):`);
// Fluktuasi baris snapshot dibandingkan dengan snapshot SEBELUMNYA di hari yang sama, bukan
// kemarin — sama seperti yang ditulis sync.
const snapshots = await fixNode("dashboard/roiSnapshots", (row) => `${row.subDomain}|${row.date}`);

console.log(
  `\n${dry ? "DRY — tidak ada yang ditulis. " : ""}${daily} baris harian, ${snapshots} baris snapshot.`,
);
process.exit(0);
