// Kembalikan belanja Meta ke baris `roiReports` dari `userReports/{id}.campaignHistory`, untuk
// ad account yang SUDAH TIDAK BISA DIBACA (syncDisabled, terarsip, atau tidak terdaftar).
//
//   npm run migrate:spend-from-history -- --dry
//   npm run migrate:spend-from-history -- --sub=coverage.designingaround.com --since=2026-08-21 --until=2026-08-25
//
// ═══ APA YANG SALAH ═══
//
// Penulis ROI terjadwal (sync-subdomains.mjs) dan `migrate:roi-spend` sama-sama MELEWATI akun
// `syncDisabled`, tapi tetap menganggap sisi Meta run itu utuh (`metaComplete: true`). Tiap hari yang
// ditulis ULANG sesudah sebuah akun dimatikan kehilangan belanja akun itu, dan barisnya berbunyi
// `metaMissing: "unmapped"` — "tidak ada campaign yang menunjuk ke sini" — padahal campaign-nya ada
// dan uangnya sudah keluar. Contoh: LINCAH 1240 membelanjakan Rp 381.703 untuk
// coverage.designingaround.com 21–25 Agu 2026, dan `migrate:roi-spend` (2 Sep) mengosongkannya.
//
// ═══ SUMBERNYA ═══
//
// `campaignHistory` lahir dari `fetchCampaignSpend` per hari (`time_increment=1`) — panggilan yang
// SAMA dengan spend baris ROI, bukan `dailySpend` (rekaman "spend hari ini" bertanggal jam run).
// Ia ditulis ulang tiap sync untuk jendela beberapa hari terakhir, jadi hari TERAKHIR sebelum akunnya
// berhenti terbaca bisa masih separuh hari. Angka itu lantai, bukan tebakan.
//
// Yang diambil hanya campaign dari akun yang TIDAK terbaca hari ini: belanja akun yang masih terbaca
// sudah ada di barisnya, dan menambahkannya lagi berarti menghitung dua kali. Subdomainnya dipetakan
// dengan resolver HARI INI (sama dengan sync dan `migrate:roi-spend`).
//
// ═══ IDEMPOTENT ═══
//
// Dua penjaga. Campaign yang namanya sudah berdiri di `campaigns` tidak ditambahkan lagi; dan belanja
// baris tidak boleh melampaui total riwayat SELURUH akun untuk hari + subdomain itu — nama saja tidak
// cukup, karena campaign yang diganti namanya sesudah barisnya ditulis (JsR1-01 "MEXICO" → "EU non
// CMP", 4 Agu) akan terhitung dua kali. Baris yang selisihnya tidak persis sebesar belanja akun yang
// hilang dilewati dan disebutkan. Run kedua tidak menulis apa pun. Kolom turunan (pajak, total, ROI, profit, fluk) dihitung lewat
// `roiReportUpdate` — satu rumus — dan kolom fluk hari BERIKUTNYA ikut dihitung ulang, karena
// pembandingnya baru saja berubah.

import { get, orderByKey, query, ref, startAt, update } from "firebase/database";
import { connect } from "../db.mjs";
import {
  adTaxRate,
  buildCampaignResolver,
  normalizeName,
  previousRoiReport,
  roiReportUpdate,
  zonedDateKey,
} from "../sync-core.js";

const SPEND_KEYS = [
  "metaMissing",
  "spending",
  "metaAds",
  "adTax",
  "totalSpending",
  "flukSpend",
  "profit",
  "roi",
  "flukRoi",
  "results",
  "cpr",
  "campaigns",
];
const FLUK_KEYS = ["flukSpend", "flukRoi"];

const dry = process.argv.includes("--dry");
const argOf = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const since = argOf("since", "2026-08-01");
const until = argOf("until", zonedDateKey());
const onlySub = argOf("sub", "");
if (!DAY.test(since) || !DAY.test(until) || since > until) {
  console.error(`Rentang tidak sah: ${since} s/d ${until} (bentuknya YYYY-MM-DD).`);
  process.exit(1);
}

const db = await connect();
const val = async (path) => (await get(ref(db, path))).val() || {};
const subs = await val("subDomains");
const users = await val("users");
const adAccounts = await val("adAccounts");
const reports = await val("userReports");
const rate = adTaxRate(await val("settings/roi"));
// Mundur sehari supaya hari pertama rentang punya pembanding untuk kolom fluk.
const rows =
  (await get(query(ref(db, "dashboard/roiReports"), orderByKey(), startAt("2026-07-01")))).val() ||
  {};

const idByName = new Map();
for (const [id, sub] of Object.entries(subs)) {
  if (sub && !sub.deletedAt && sub.name) idByName.set(normalizeName(sub.name), id);
}
const { resolve, conflicts } = buildCampaignResolver(users, subs);
if (conflicts.length) {
  console.error("Kode campaign bentrok — perbaiki dulu di /sub-domains:");
  for (const c of conflicts) console.error(`  ${c.code}: ${c.kept} vs ${c.ignored}`);
  process.exit(1);
}
const readableActs = new Set(
  Object.values(adAccounts)
    .filter((a) => a?.actId && !a.deletedAt && !a.syncDisabled)
    .map((a) => a.actId),
);

// Riwayat bisa berdiri di dua user (akun yang berpindah pemilik); kuncinya sama, jadi dilebur.
const history = new Map();
for (const report of Object.values(reports)) {
  for (const [key, row] of Object.entries(report?.campaignHistory || {})) {
    const day = key.slice(0, 10);
    if (day < since || day > until || !row?.campaign) continue;
    const prev = history.get(key);
    if (!prev || Number(row.spend) > Number(prev.spend)) history.set(key, row);
  }
}

// day__id -> belanja riwayat SELURUH akun. Ini penjaga idempotensinya: nama campaign saja tidak
// cukup, karena campaign yang diganti namanya sesudah barisnya ditulis tidak akan dikenali di
// `campaigns` — dan belanja akun yang dulu masih terbaca lalu terhitung dua kali.
const historyTotal = new Map();
// day__id -> [{ name, spend, results, account }] — hanya akun yang TIDAK terbaca hari ini
const extra = new Map();
for (const row of history.values()) {
  const spend = Number(row.spend) || 0;
  if (spend <= 0) continue;
  const { subDomain } = resolve(row.campaign);
  const id = subDomain && idByName.get(normalizeName(subDomain));
  if (!id) continue;
  if (onlySub && normalizeName(subs[id].name) !== normalizeName(onlySub)) continue;
  const key = `${row.date}__${id}`;
  historyTotal.set(key, (historyTotal.get(key) || 0) + spend);
  if (readableActs.has(row.adAccount)) continue;
  extra.set(key, [
    ...(extra.get(key) || []),
    { name: row.campaign, spend, results: Number(row.results) || 0, account: row.account },
  ]);
}

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const rupiah = (n) => (typeof n === "number" ? Math.round(n).toLocaleString("id-ID") : '""');
const now = new Date();
const patches = {};
const report = [];
const touchedIds = new Map(); // id -> hari yang diubah

for (const key of [...extra.keys()].sort()) {
  const existing = rows[key];
  const [day, id] = [key.slice(0, 10), key.slice(12)];
  if (!existing) {
    // Baris hari itu tidak ada sama sekali: earning-nya tidak diketahui run ini, dan membuat baris
    // baru berearning kosong di sini lebih baik diserahkan ke `migrate:roi-spend`.
    report.push({ key, name: subs[id].name, note: "baris tidak ada, dilewati" });
    continue;
  }
  const present = new Set((existing.campaigns || []).map((c) => normalizeName(c?.name)));
  const add = extra.get(key).filter((c) => !present.has(normalizeName(c.name)));
  if (!add.length) continue;

  const base = typeof existing.spending === "number" ? existing.spending : 0;
  const missing = add.reduce((s, c) => s + c.spend, 0);
  const room = (historyTotal.get(key) || 0) - base;
  if (room < 1) continue; // sudah terhitung (campaign-nya cuma berganti nama)
  if (Math.abs(room - missing) > 1) {
    // Barisnya memuat sebagian, atau belanja akun yang masih terbaca berbeda dari riwayatnya.
    // Tidak ada cara memastikan campaign mana yang kurang; yang dilaporkan, bukan ditebak.
    report.push({
      key,
      name: subs[id].name,
      note: `selisih riwayat Rp ${rupiah(room)} tidak sama dengan belanja akun yang hilang Rp ${rupiah(missing)}, dilewati`,
    });
    continue;
  }
  const spend = base + missing;
  const results = (Number(existing.results) || 0) + add.reduce((s, c) => s + c.results, 0);
  const campaigns = [
    ...(existing.campaigns || []),
    ...add.map(({ name, spend: s }) => ({ name, spend: s })),
  ];
  const next = roiReportUpdate(subs[id], null, spend, {
    now,
    day,
    partial: existing.partial === true,
    previous: previousRoiReport(rows, id, day),
    existing,
    adTaxRate: rate,
    metaComplete: true,
    results,
    campaigns,
  });
  const patch = {};
  for (const field of SPEND_KEYS) {
    if (field in next && !same(next[field], existing[field])) patch[field] = next[field];
  }
  if (!Object.keys(patch).length) continue;
  for (const [field, value] of Object.entries(patch)) patches[`${key}/${field}`] = value;
  rows[key] = { ...existing, ...patch };
  report.push({
    key,
    name: subs[id].name,
    pic: subs[id].pic,
    before: existing.totalSpending,
    after: next.totalSpending,
    accounts: [...new Set(add.map((c) => c.account))].join(", "),
  });
  touchedIds.set(id, [...(touchedIds.get(id) || []), day]);
}

// Kolom fluk hari sesudah tiap hari yang diubah: pembandingnya berubah.
for (const [id, days] of touchedIds) {
  for (const day of days) {
    const nextKey = Object.keys(rows)
      .filter((k) => k.endsWith(`__${id}`) && k.slice(0, 10) > day)
      .sort()[0];
    if (!nextKey || touchedIds.get(id).includes(nextKey.slice(0, 10))) continue;
    const row = rows[nextKey];
    const nextDay = nextKey.slice(0, 10);
    const recomputed = roiReportUpdate(
      subs[id],
      null,
      typeof row.spending === "number" ? row.spending : undefined,
      {
        now,
        day: nextDay,
        partial: row.partial === true,
        previous: previousRoiReport(rows, id, nextDay),
        existing: row,
        adTaxRate: rate,
        metaComplete: row.metaMissing !== "unavailable",
        results: Number(row.results) || 0,
        campaigns: row.campaigns,
      },
    );
    for (const field of FLUK_KEYS) {
      if (field in recomputed && !same(recomputed[field], row[field])) {
        patches[`${nextKey}/${field}`] = recomputed[field];
      }
    }
  }
}

let total = 0;
for (const r of report) {
  if (r.note) {
    console.log(`  ${r.key.slice(0, 10)}  ${r.name}: ${r.note}`);
    continue;
  }
  const delta = (Number(r.after) || 0) - (Number(r.before) || 0);
  total += delta;
  console.log(
    `  ${r.key.slice(0, 10)}  ${r.name} (${r.pic || "-"})  Total Spend ${rupiah(r.before)} -> ${rupiah(r.after)}  [${r.accounts}]`,
  );
}
console.log(
  `\n${report.filter((r) => !r.note).length} baris, Total Spend +Rp ${Math.round(total).toLocaleString("id-ID")} (termasuk pajak iklan), ${Object.keys(patches).length} field.`,
);

if (dry) {
  console.log("--dry: tidak ada yang ditulis.");
} else if (Object.keys(patches).length) {
  await update(ref(db, "dashboard/roiReports"), patches);
  console.log("Tersimpan.");
}
process.exit(0);
