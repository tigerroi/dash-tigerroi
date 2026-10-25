// Kembalikan belanja ad account yang sudah tidak terbaca ke `dashboard/weeklyFinancials`, untuk
// hari-hari yang SUDAH DI LUAR jendela `sync-financials` (bawaan 30 hari) — yang di dalam jendela
// dibetulkan sync-nya sendiri sejak `unreadableSpendRows` ada.
//
//   npm run migrate:financials-spend -- --since=2026-08-01 --until=2026-08-17 --dry
//   npm run migrate:financials-spend -- --since=2026-08-01 --until=2026-08-17
//
// Sync menulis ulang tiga puluh hari tiap run dan melewati akun yang dimatikan, jadi tiap hari yang
// ditulis sesudah akunnya mati kehilangan belanja akun itu — bukan cuma hari sesudah ia mati.
// Hari-hari yang sudah keluar dari jendela membeku dalam keadaan itu. Totalnya adalah baris
// "Total belanja iklan" di Laba Rugi dan "Total Spending" di Cash Flow.
//
// Yang ditulis HANYA sisi belanja (`totalSpend`, `adTax`, `totalSpending`), dihitung lewat
// `financialPoint` yang sama dengan sync: belanja akun yang masih terbaca dibaca ULANG dari Meta,
// ditambah riwayat campaign akun yang tidak terbaca. Pendapatan tidak disentuh — membacanya ulang
// dari GAM berarti satu network yang gagal hari ini menurunkan pendapatan bulan lalu. Titik
// `source: "spreadsheet"` (April–Juli 2026, lihat `migrate:weekly-financials`) dilewati.
//
// Satu akun yang gagal dibaca MENGHENTIKAN run, alasan yang sama dengan `migrate:roi-spend`.

import { get, orderByKey, query, ref, startAt, update } from "firebase/database";
import { connect } from "../db.mjs";
import { fetchDailySpend } from "../meta.js";
import { clientStore } from "../store.mjs";
import { adTaxRate, dateKeyFrom, financialPoint } from "../sync-core.js";
import { loadUnreadableSpend } from "../unreadable-spend.mjs";

const dry = process.argv.includes("--dry");
const argOf = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const since = argOf("since");
const until = argOf("until");
if (!DAY.test(since || "") || !DAY.test(until || "") || since > until) {
  console.error("Wajib --since=YYYY-MM-DD dan --until=YYYY-MM-DD.");
  process.exit(1);
}
const token = process.env.META_ACCESS_TOKEN;
if (!token) {
  console.error("META_ACCESS_TOKEN kosong.");
  process.exit(1);
}

const db = await connect();
const store = clientStore(db);
const adAccounts = (await store.read("adAccounts")) || {};
const users = (await store.read("users")) || {};
const rate = adTaxRate(await store.read("settings/roi"));
const points =
  (await get(query(ref(db, "dashboard/weeklyFinancials"), orderByKey(), startAt(since)))).val() || {};

const spendByDate = new Map();
for (const account of Object.values(adAccounts)) {
  if (account?.deletedAt || account?.syncDisabled || !account?.actId) continue;
  let rows;
  try {
    rows = await fetchDailySpend(account.actId, token, since, until);
  } catch (e) {
    console.error(`GAGAL membaca ${account.name || account.actId}: ${e.message}`);
    console.error("Run dihentikan: belanja yang tidak lengkap akan MENURUNKAN total hari-hari itu.");
    process.exit(1);
  }
  for (const row of rows) {
    const date = dateKeyFrom(row.date);
    if (date) spendByDate.set(date, (spendByDate.get(date) || 0) + row.spend);
  }
}
const history = await loadUnreadableSpend(store, { adAccounts, users, since, until });
const restored = new Map();
for (const row of history) {
  spendByDate.set(row.date, (spendByDate.get(row.date) || 0) + row.spend);
  restored.set(row.date, (restored.get(row.date) || 0) + row.spend);
}

const rupiah = (n) => Math.round(n).toLocaleString("id-ID");
const patches = {};
let delta = 0;
for (const [date, point] of Object.entries(points).sort()) {
  if (date > until || !point) continue;
  if (point.source === "spreadsheet") {
    console.log(`  ${date}  dilewati (titik spreadsheet)`);
    continue;
  }
  const next = financialPoint(date, Number(point.grossRevenue) || 0, spendByDate.get(date) || 0, rate, {
    partial: point.partial === true,
  });
  const before = Number(point.totalSpend) || 0;
  if (Math.abs(next.totalSpend - before) < 1) continue;
  for (const field of ["totalSpend", "adTax", "totalSpending", "updatedAt"]) {
    patches[`${date}/${field}`] = next[field];
  }
  delta += next.totalSpending - (Number(point.totalSpending) || 0);
  console.log(
    `  ${date}  belanja Rp ${rupiah(before)} -> Rp ${rupiah(next.totalSpend)}  (riwayat akun nonaktif Rp ${rupiah(restored.get(date) || 0)})`,
  );
}
console.log(
  `\n${Object.keys(patches).length / 4} hari, Total belanja (+pajak) ${delta >= 0 ? "+" : "-"}Rp ${rupiah(Math.abs(delta))}.`,
);
if (dry) console.log("--dry: tidak ada yang ditulis.");
else if (Object.keys(patches).length) {
  await update(ref(db, "dashboard/weeklyFinancials"), patches);
  console.log("Tersimpan.");
}
process.exit(0);
