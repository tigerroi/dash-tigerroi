// One-off: tulis ulang SISI SPEND baris `dashboard/roiReports` dari Meta, untuk rentang tanggal
// yang diminta.
//
//   npm run migrate:roi-spend -- --dry
//   npm run migrate:roi-spend
//   npm run migrate:roi-spend -- --since=2026-05-01 --until=2026-07-31
//
// Bawaannya 1 Agustus 2026 s/d hari ini, dan batas itu disengaja: April-Juli seluruhnya berstatus
// "Sudah Cair" di `payouts`, jadi menulis ulang belanjanya menggeser Net Profit dan dasar bonus
// bulan yang uangnya sudah dibayarkan. Rentangnya boleh diperlebar — tapi itu keputusan orang, bukan
// bawaan sebuah script.
//
// KENAPA INI PERLU ADA. `subDomains.campaignCodes` hanya dibaca saat sync menulis baris baru, dan
// sync penuh cuma menyentuh kemarin + hari ini. Kode yang baru didaftarkan (lihat
// `register-missing-campaign-codes.mjs`) karena itu tidak memperbaiki satu pun baris lampau:
// belanjanya tetap jatuh ke lantai di baris yang sudah tersimpan. Yang ini menariknya ulang dari
// Meta lalu menghitung atribusinya lagi dengan `buildCampaignResolver` yang SAMA dengan sync —
// bukan aturan tandingan.
//
// KENAPA AMAN. Simulasi 4 Sep 2026 menarik ulang seluruh Mei-Juli dan menghasilkan angka yang
// PERSIS sama dengan yang tersimpan (Rp 30.138.554 / 51.813.382 / 140.319.979, rupiah demi rupiah).
// Jadi penarikan ulang tidak menghasilkan angka baru untuk baris yang selama ini benar; yang
// berubah hanya baris yang atribusinya memang salah.
//
// YANG DISENTUH cuma kolom yang lahir dari spend — `spending`, `metaAds`, `adTax`, `totalSpending`,
// `flukSpend`, `profit`, `roi`, `flukRoi`, `results`, `cpr`, `campaigns`, `metaMissing`. Sisi GAM
// (earning, impresi, rincian sumber) TIDAK dibaca ulang dan tidak ditulis: laporan GAM adalah job
// asinkron per network, dan menariknya ulang untuk sebulan berarti puluhan job untuk memperbaiki
// kolom yang tidak sedang bermasalah. Kolom `time` dan `updatedAt` juga dibiarkan — baris ini bukan
// hasil sync baru.
//
// TIGA BATAS YANG DIKETAHUI:
//
//   1. Satu akun yang GAGAL dibaca menghentikan seluruh run. Baris tanpa spend punya dua arti yang
//      berlawanan ("tidak diiklankan" vs "spend-nya tidak sempat diambil"), dan hanya run yang tahu
//      yang mana — persis alasan `metaComplete` ada di sync. Run separuh akan mengosongkan kolom
//      uang subdomain yang campaign-nya kebetulan tinggal di akun yang gagal itu.
//   2. Tabel ROI per Negara TIDAK ikut ditulis ulang. Ia baris tersendiri dengan sisi earning-nya
//      sendiri; membetulkan spend-nya saja menghasilkan ROI negara yang tidak cocok dengan
//      subdomainnya.
//   3. Baris (hari + subdomain) yang belum ada sama sekali DIBUAT dengan earning KOSONG, bukan nol —
//      sisi GAM-nya tidak dibaca run ini, dan nol yang dikarang akan berbunyi "ROI -100%".
//      Jumlahnya disebutkan di ringkasan; sync berikutnya tidak akan mengisinya (ia cuma menyentuh
//      kemarin + hari ini), jadi kalau angkanya besar yang benar adalah menjalankan sync penuh
//      untuk rentang itu, bukan script ini.

import { get, ref, update } from "firebase/database";
import { connect } from "../db.mjs";
import { fetchCampaignResultGoals, fetchCampaignSpend } from "../meta.js";
import { clientStore } from "../store.mjs";
import {
  adTaxRate,
  buildCampaignResolver,
  metaRowsByDay,
  normalizeName,
  previousRoiReport,
  roiReportKey,
  roiReportUpdate,
  zonedDateKey,
} from "../sync-core.js";
import { loadUnreadableSpend } from "../unreadable-spend.mjs";

// Kolom yang lahir dari spend. Nilainya diambil dari `roiReportUpdate` — satu rumus, bukan salinan
// kedua di sini — lalu hanya kunci-kunci ini yang disalin ke baris yang sudah ada.
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

const dry = process.argv.includes("--dry");
const argOf = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const today = zonedDateKey();
const since = argOf("since", "2026-08-01");
const until = argOf("until", today);
if (!DAY.test(since) || !DAY.test(until) || since > until) {
  console.error(`Rentang tidak sah: ${since} s/d ${until} (bentuknya YYYY-MM-DD).`);
  process.exit(1);
}

const days = [];
for (let d = new Date(`${since}T00:00:00Z`); ; d.setUTCDate(d.getUTCDate() + 1)) {
  const key = d.toISOString().slice(0, 10);
  if (key > until) break;
  days.push(key);
}

const token = process.env.META_ACCESS_TOKEN;
if (!token) {
  console.error("META_ACCESS_TOKEN kosong — tidak ada yang bisa ditarik ulang.");
  process.exit(1);
}

const db = await connect();
const subs = (await get(ref(db, "subDomains"))).val() || {};
const users = (await get(ref(db, "users"))).val() || {};
const adAccounts = (await get(ref(db, "adAccounts"))).val() || {};
const settings = (await get(ref(db, "settings/roi"))).val() || {};
const rows = (await get(ref(db, "dashboard/roiReports"))).val() || {};
const rate = adTaxRate(settings);

const idByName = new Map();
for (const [id, sub] of Object.entries(subs)) {
  if (!sub || sub.deletedAt || !sub.name) continue;
  idByName.set(normalizeName(sub.name), id);
}
const { resolve, conflicts } = buildCampaignResolver(users, subs);
if (conflicts.length) {
  console.error("Kode campaign bentrok — dua subdomain mengaku memiliki kode yang sama:");
  for (const c of conflicts) console.error(`  ${c.code}: ${c.kept} vs ${c.ignored}`);
  console.error("Perbaiki dulu di /sub-domains: atribusinya tidak bisa ditentukan run ini.");
  process.exit(1);
}

// --- Tarik ulang spend campaign per hari -------------------------------------------------------
const period = { since, until };
const perDay = new Map(); // day -> { spend: Map, results: Map, campaigns: Map }
const bucketOf = (day) => {
  if (!perDay.has(day)) {
    perDay.set(day, { spend: new Map(), results: new Map(), campaigns: new Map() });
  }
  return perDay.get(day);
};
const inRange = new Set(days);
const unmatched = new Map();
let accounts = 0;

function addSpendRows(dayRows) {
  for (const [day, dayList] of metaRowsByDay(dayRows)) {
    if (!inRange.has(day)) continue;
    const bucket = bucketOf(day);
    for (const { name, spend, results } of dayList) {
      const { subDomain } = resolve(name);
      const id = subDomain && idByName.get(normalizeName(subDomain));
      if (!id) {
        if (name) unmatched.set(name, (unmatched.get(name) || 0) + spend);
        continue;
      }
      bucket.spend.set(id, (bucket.spend.get(id) || 0) + spend);
      bucket.results.set(id, (bucket.results.get(id) || 0) + (results || 0));
      bucket.campaigns.set(id, [...(bucket.campaigns.get(id) || []), { name, spend }]);
    }
  }
}

for (const [, acct] of Object.entries(adAccounts)) {
  // Aturan lewat yang sama dengan sync-meta: akun terarsip dan akun yang saklarnya dimatikan
  // (disuspend Meta) memang tidak boleh dihubungi.
  if (acct?.deletedAt || acct?.syncDisabled || !acct?.actId) continue;
  const label = acct.name || acct.actId;
  let goals = null;
  try {
    goals = await fetchCampaignResultGoals(acct.actId, token);
  } catch (e) {
    console.error(
      `  tujuan ad set ${label} gagal (kolom Hasil jatuh ke daftar cadangan): ${e.message}`,
    );
  }
  let dayRows;
  try {
    dayRows = await fetchCampaignSpend(acct.actId, token, period, goals);
  } catch (e) {
    console.error(`\nGAGAL membaca ${label}: ${e.message}`);
    console.error(
      "Run dihentikan: spend yang tidak lengkap akan mengosongkan kolom uang subdomain",
    );
    console.error(
      "yang campaign-nya tinggal di akun ini. Jalankan lagi setelah akunnya bisa dibaca.",
    );
    process.exit(1);
  }
  accounts++;
  addSpendRows(dayRows);
}

// Akun yang dilewati di atas tetap membelanjakan uang pada hari-hari saat ia masih terbaca, dan
// run ini MENULIS ULANG hari-hari itu. Tanpa riwayatnya, belanja itu hilang dari baris ROI — persis
// yang terjadi 2 Sep 2026 (lihat `unreadableSpendRows` di sync-core.js).
const historyRows = await loadUnreadableSpend(clientStore(db), { adAccounts, users, since, until });
addSpendRows(historyRows);
if (historyRows.length) {
  console.log(`${historyRows.length} baris spend dari riwayat ad account nonaktif.`);
}

// --- Bandingkan dengan baris yang tersimpan ----------------------------------------------------
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const rupiah = (n) => (typeof n === "number" ? Math.round(n).toLocaleString("id-ID") : "-");

const writes = [];
const created = [];
const now = new Date();
// Baris yang sudah ada per hari, supaya subdomain yang KEHILANGAN spend-nya (kodenya pindah) ikut
// dibetulkan — bukan cuma yang mendapatkannya.
const idsByDay = new Map();
for (const [key, row] of Object.entries(rows)) {
  const day = row?.date || key.split("__")[0];
  if (!inRange.has(day)) continue;
  const id = key.slice(String(day).length + 2);
  if (!idsByDay.has(day)) idsByDay.set(day, new Set());
  idsByDay.get(day).add(id);
}

for (const day of days) {
  const bucket = perDay.get(day) || { spend: new Map(), results: new Map(), campaigns: new Map() };
  const ids = new Set([...(idsByDay.get(day) || []), ...bucket.spend.keys()]);
  for (const id of ids) {
    const sub = subs[id];
    // Subdomain yang barisnya ada tapi record-nya sudah dihapus: tidak ada yang bisa dihitung, dan
    // menulis baris atas nama subdomain yang tidak ada lagi cuma menambah baris yatim.
    if (!sub || sub.deletedAt) continue;
    const key = roiReportKey(id, day);
    const existing = rows[key];
    const spend = bucket.spend.has(id) ? bucket.spend.get(id) : undefined;
    const report = roiReportUpdate(sub, null, spend, {
      now,
      day,
      partial: existing ? existing.partial === true : day === today,
      previous: previousRoiReport(rows, id, day),
      existing,
      adTaxRate: rate,
      metaComplete: true,
      results: bucket.results.get(id) || 0,
      campaigns: bucket.campaigns.get(id),
    });

    if (!existing) {
      // Tidak ada baris sama sekali untuk hari ini: hanya dibuat kalau memang ada UANGNYA. Meta
      // mengembalikan baris berspend nol untuk hari campaign-nya berdiri tanpa membelanjakan
      // apa pun, dan baris baru "spend Rp 0, earning tidak diketahui" tidak mengabarkan apa pun —
      // ia cuma menambah satu hari bertanda peringatan di Kalender.
      if (!(typeof spend === "number" && spend > 0)) continue;
      created.push({ key, day, name: sub.name, spend, report });
      rows[key] = report;
      continue;
    }

    const patch = {};
    for (const field of SPEND_KEYS) {
      if (field in report && !same(report[field], existing[field])) patch[field] = report[field];
    }
    if (!Object.keys(patch).length) continue;
    writes.push({
      key,
      day,
      name: sub.name,
      before: existing.totalSpending,
      after: report.totalSpending,
      patch,
    });
    rows[key] = { ...existing, ...patch };
  }
}

// --- Laporan -----------------------------------------------------------------------------------
console.log(
  `Rentang ${since} s/d ${until} · ${days.length} hari · ${accounts} ad account dibaca.\n`,
);

const byMonth = new Map();
for (const w of [...writes, ...created]) {
  const month = w.day.slice(0, 7);
  const before = Number(w.before ?? 0) || 0;
  const after = Number(w.after ?? w.report?.totalSpending ?? 0) || 0;
  const e = byMonth.get(month) || { rows: 0, delta: 0 };
  e.rows++;
  e.delta += after - before;
  byMonth.set(month, e);
}
if (byMonth.size) {
  console.log("Perubahan per bulan (Total Spend):");
  for (const [month, e] of [...byMonth].sort()) {
    const sign = e.delta >= 0 ? "+" : "-";
    console.log(`  ${month}: ${e.rows} baris, netto ${sign}Rp ${rupiah(Math.abs(e.delta))}`);
  }
  console.log("");
}

const shown = [...writes].sort(
  (a, b) =>
    Math.abs((Number(b.after) || 0) - (Number(b.before) || 0)) -
    Math.abs((Number(a.after) || 0) - (Number(a.before) || 0)),
);
for (const w of shown.slice(0, 25)) {
  console.log(`~ ${w.day} ${w.name}: Rp ${rupiah(w.before)} -> Rp ${rupiah(w.after)}`);
}
if (shown.length > 25) console.log(`  … dan ${shown.length - 25} baris lagi.`);
for (const c of created) {
  console.log(
    `+ ${c.day} ${c.name}: Rp ${rupiah(c.report.totalSpending)} (baris BARU, earning belum diketahui)`,
  );
}
if (unmatched.size) {
  console.log("\nCampaign yang MASIH tidak ketempel ke subdomain mana pun:");
  for (const [name, spend] of [...unmatched].sort((a, b) => b[1] - a[1])) {
    console.log(`  Rp ${rupiah(spend * (1 + rate))} — ${name}`);
  }
}

if (!writes.length && !created.length) {
  console.log("Tidak ada baris yang perlu diubah.");
  process.exit(0);
}
if (dry) {
  console.log(
    `\n--dry: tidak ada yang ditulis. ${writes.length} baris disunting, ${created.length} baris dibuat.`,
  );
  process.exit(0);
}

// Ditulis per baris, bukan satu update besar berkunci "dashboard/roiReports": yang kedua menimpa
// seluruh koleksi kalau path-nya salah ketik.
for (const w of writes) await update(ref(db, `dashboard/roiReports/${w.key}`), w.patch);
for (const c of created) await update(ref(db, `dashboard/roiReports/${c.key}`), c.report);

console.log(
  `\nSelesai. ${writes.length} baris disunting, ${created.length} baris dibuat.` +
    "\nTabel ROI per Negara TIDAK ikut ditulis ulang (lihat catatan di kepala berkas ini).",
);
process.exit(0);
