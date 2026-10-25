// One-off: tulis ulang SISI EARNING baris `dashboard/roiReports` (dan pendapatan harian
// `dashboard/weeklyFinancials`) dari laporan Google dalam IDR, untuk rentang tanggal yang diminta.
//
//   npm run migrate:roi-earning -- --dry --domain-start=sheetz.us:2026-09-01
//   npm run migrate:roi-earning -- --domain-start=sheetz.us:2026-09-01
//   npm run migrate:roi-earning -- --since=2026-08-01 --until=2026-08-31
//
// Pasangan `backfill-roi-spend.mjs`: yang itu menulis ulang sisi Meta, yang ini sisi Google. Bawaan
// rentangnya sama (1 Agu 2026 s/d KEMARIN) dan alasannya sama: April–Juli berstatus "Sudah Cair".
// Hari berjalan tidak ikut — barisnya masih ditimpa sync tiap jam.
//
// DUA KEADAAN YANG DIPERBAIKINYA (audit 19 Sep 2026, Agustus diadu dengan laporan Google):
//
//   1. KURS. Empat network menagih dalam USD, dan earning-nya dikalikan kurs open.er-api yang cuma
//      punya kurs HARI INI — seluruh Agustus ditulis ulang 2 Sep dengan satu kurs (17.765), sementara
//      layar Ad Manager memakai kurs Google per hari. Angka USD-nya sama persis; yang meleset cuma
//      rupiahnya, −0,66% sampai +0,25% per network. Laporan GAM sekarang DIMINTA dalam IDR
//      (`GAM_CURRENCY`, gam.js), dan script ini memakai laporan yang sama.
//   2. SUBDOMAIN YANG TERLAMBAT DIDAFTARKAN. Sync cuma menulis kemarin + hari ini, jadi subdomain
//      yang didaftarkan sesudah harinya lewat tidak pernah mendapat earning untuk hari-hari itu:
//      housing.bispdailyupdates.pk berdiri di Agustus dengan spend (dari `migrate:roi-spend`) dan
//      earning kosong, dan tabel Cash Flow membuang barisnya utuh — Rp 292.549 pendapatan plus
//      belanjanya. Baris yang belum ada DIBUAT kalau earning-nya di atas nol.
//
// `--domain-start=DOMAIN:YYYY-MM-DD` (boleh berulang atau dipisah koma) menyebut hari pertama sebuah
// domain jadi milik usaha ini — sheetz.us baru dimulai 1 Sep 2026, walau akun AdSense-nya
// melaporkan pendapatan Agustus (milik pemilik sebelumnya). Hari SEBELUM tanggal itu: baris ROI-nya
// tidak disentuh dan pendapatannya tidak ikut ke `weeklyFinancials`. Sesudahnya diperlakukan seperti
// domain lain — mengecualikannya seluruhnya membuang pendapatan September yang sah (dry-run pertama
// 19 Sep 2026: −Rp 8,5 juta di weeklyFinancials).
//
// YANG DISENTUH di baris ROI cuma kolom yang lahir dari earning (`EARNING_KEYS`), plus `profit`/
// `roi`/`flukRoi` kalau spend baris itu diketahui — nilainya dari `roiReportUpdate`, rumus yang sama
// dengan sync. Spend tidak dibaca ulang. `time`/`updatedAt` dibiarkan: ini bukan hasil sync baru.
// Di `weeklyFinancials` yang ditulis cuma `grossRevenue`; titik yang diisi dari spreadsheet
// (`source: "spreadsheet"`) dilewati.
//
// TIGA BATAS YANG DIKETAHUI:
//
//   1. Satu akun yang GAGAL dibaca menghentikan seluruh run — alasan yang sama dengan `metaComplete`:
//      subdomain yang tidak muncul di laporan berarti nol HANYA kalau semua laporan berhasil.
//   2. `roiSnapshots` dan ROI per Negara TIDAK ikut. Snapshot tidak bisa diminta ulang ke Google
//      ("keadaan pukul 15:00" tidak ada di API mana pun), dan masa simpannya cuma 3 hari.
//   3. Selama server/functions masih menjalankan kode LAMA, sync tiap jam menulis ulang 30 hari
//      terakhir `weeklyFinancials` (dan kemarin + hari ini di `roiReports`) dengan kurs lama. Deploy
//      dulu; script ini untuk hari-hari yang tidak disentuh sync lagi.

import { get, ref, update } from "firebase/database";
import { connect } from "../db.mjs";
import {
  dateDimension,
  earningAccounts,
  earningRowsByDimensions,
  gamRowsByDay,
  normalizeName,
  previousRoiReport,
  roiReportKey,
  roiReportUpdate,
  adTaxRate,
  shiftDateKey,
  zonedDateKey,
} from "../sync-core.js";

// Kolom yang lahir dari earning, persis yang ditulis cabang `metrics` di `roiReportUpdate`.
const EARNING_KEYS = [
  "earning",
  "adsense",
  "currency",
  "fxRate",
  "adxRevenue",
  "adsenseRevenue",
  "adServerRevenue",
  "impressions",
  "clicks",
  "cpc",
  "ecpm",
  "pageRpm",
  "flukEarn",
  "gamMissing",
  "gamStale",
];
// Butuh kedua sisi; hanya disalin kalau spend baris itu diketahui.
const RATIO_KEYS = ["profit", "roi", "flukRoi"];

const dry = process.argv.includes("--dry");
const argOf = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const today = zonedDateKey();
const since = argOf("since", "2026-08-01");
const until = argOf("until", shiftDateKey(today, -1));
if (!DAY.test(since) || !DAY.test(until) || since > until) {
  console.error(`Rentang tidak sah: ${since} s/d ${until} (bentuknya YYYY-MM-DD).`);
  process.exit(1);
}
if (until >= today) {
  console.error(`--until harus sebelum hari ini (${today}): baris hari berjalan milik sync.`);
  process.exit(1);
}
const domainStarts = [];
for (const arg of process.argv.filter((a) => a.startsWith("--domain-start="))) {
  for (const item of arg.slice("--domain-start=".length).split(",")) {
    const [domain, start] = item.split(":");
    if (!normalizeName(domain) || !DAY.test(start || "")) {
      console.error(`--domain-start tidak sah: "${item}" (bentuknya domain.com:YYYY-MM-DD).`);
      process.exit(1);
    }
    domainStarts.push({ domain: normalizeName(domain), start });
  }
}
// Host yang pada `day` belum milik usaha ini.
const skippedHost = (host, day) => {
  const name = normalizeName(host);
  return domainStarts.some(
    ({ domain, start }) => day < start && (name === domain || name.endsWith(`.${domain}`)),
  );
};

const days = [];
for (let d = since; d <= until; d = shiftDateKey(d, 1)) days.push(d);
const inRange = new Set(days);
const gamDay = (key) => {
  const [year, month, day] = key.split("-").map(Number);
  return { year, month, day };
};
const range = { startDate: gamDay(since), endDate: gamDay(until) };

const db = await connect();
const read = async (path) => (await get(ref(db, path))).val() || {};
const configs = await read("googleApiConfigs");
const subs = await read("subDomains");
const rate = adTaxRate(await read("settings/roi"));
const rows = await read("dashboard/roiReports");
const financials = await read("dashboard/weeklyFinancials");
const accounts = earningAccounts(await read("gamAccounts"), await read("adsenseAccounts"));

const idByName = new Map();
for (const [id, sub] of Object.entries(subs)) {
  if (!sub || sub.deletedAt || !sub.name) continue;
  idByName.set(normalizeName(sub.name), id);
}
const subSkipped = (sub, day) =>
  skippedHost(sub?.name, day) || (sub?.parentDomain && skippedHost(sub.parentDomain, day));

// --- Tarik laporan Google, dalam IDR ------------------------------------------------------------
const dim = process.env.GAM_SUBDOMAIN_DIMENSION || "SITE";
const totalsByDay = new Map(); // day -> Map(id -> metrics)
const revenueByDay = new Map(); // day -> IDR, seluruh usaha kecuali domain yang dikecualikan
const unmatched = new Map(); // site -> IDR
const skippedEarning = new Map(); // site -> IDR
for (const { account, provider, label } of accounts) {
  let report;
  try {
    report = await earningRowsByDimensions(account, configs, [dateDimension(), dim], range);
  } catch (e) {
    console.error(`\nGAGAL membaca ${provider} ${label}: ${e.message}`);
    console.error("Run dihentikan: subdomain yang tidak muncul di laporan baru berarti nol kalau");
    console.error("SEMUA laporan berhasil. Jalankan lagi setelah akunnya bisa dibaca.");
    process.exit(1);
  }
  // Tidak ada konversi di sini: yang bukan IDR berarti `GAM_CURRENCY` dikosongkan atau Google
  // menjawab mata uang lain, dan mengalikannya dengan kurs hari ini adalah persis yang diperbaiki.
  const foreign = report.find((r) => (r.reportCurrency || "") !== "IDR");
  if (foreign) {
    console.error(`\n${label} menjawab dalam "${foreign.reportCurrency || "(tidak disebut)"}", bukan IDR.`);
    console.error("Run dihentikan. Periksa GAM_CURRENCY / ADSENSE_CURRENCY (harus IDR atau tidak diset).");
    process.exit(1);
  }
  console.log(`  ${provider.padEnd(7)} ${label}: ${report.length} baris`);
  for (const [day, dayRows] of gamRowsByDay(report)) {
    if (!inRange.has(day)) continue;
    const totals = totalsByDay.get(day) || new Map();
    totalsByDay.set(day, totals);
    for (const row of dayRows) {
      if (skippedHost(row.key, day)) {
        skippedEarning.set(row.key, (skippedEarning.get(row.key) || 0) + row.earning);
        continue;
      }
      revenueByDay.set(day, (revenueByDay.get(day) || 0) + row.earning);
      const id = idByName.get(normalizeName(row.key));
      if (!id) {
        if (row.earning) unmatched.set(row.key, (unmatched.get(row.key) || 0) + row.earning);
        continue;
      }
      const cur = totals.get(id) || {
        earning: 0,
        impressions: 0,
        clicks: 0,
        adx: 0,
        adsense: 0,
        adServer: 0,
        currency: "IDR",
        fxRate: null,
      };
      cur.earning += row.earning;
      cur.impressions += row.impressions;
      cur.clicks += row.clicks;
      cur.adx += row.adx || 0;
      cur.adsense += row.adsense || 0;
      cur.adServer += row.adServer || 0;
      totals.set(id, cur);
    }
  }
}

// --- Bandingkan dengan baris ROI yang tersimpan -------------------------------------------------
const rupiah = (n) => (typeof n === "number" ? Math.round(n).toLocaleString("id-ID") : "-");
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const idsByDay = new Map();
for (const [key, row] of Object.entries(rows)) {
  const day = row?.date || key.slice(0, 10);
  if (!inRange.has(day) || !key.startsWith(`${day}__`)) continue;
  if (!idsByDay.has(day)) idsByDay.set(day, new Set());
  idsByDay.get(day).add(key.slice(day.length + 2));
}

const writes = [];
const created = [];
const now = new Date();
const ZERO = { earning: 0, impressions: 0, clicks: 0, adx: 0, adsense: 0, adServer: 0, currency: "IDR", fxRate: null };
for (const day of days) {
  const totals = totalsByDay.get(day) || new Map();
  const ids = new Set([...(idsByDay.get(day) || []), ...totals.keys()]);
  for (const id of ids) {
    const sub = subs[id];
    if (!sub || sub.deletedAt || subSkipped(sub, day)) continue;
    const key = roiReportKey(id, day);
    const existing = rows[key];
    // Semua laporan berhasil (yang gagal menghentikan run), jadi yang tidak muncul memang nol.
    const metrics = totals.get(id) || ZERO;
    const spend = typeof existing?.spending === "number" ? existing.spending : undefined;
    const report = roiReportUpdate(sub, metrics, spend, {
      now,
      day,
      partial: existing ? existing.partial === true : false,
      previous: previousRoiReport(rows, id, day),
      existing,
      adTaxRate: rate,
      metaComplete: spend !== undefined || !existing,
    });

    if (!existing) {
      // Baris baru hanya kalau memang ada UANGNYA — sepola backfill spend. Sisi Meta-nya tidak dibaca
      // run ini; `migrate:roi-spend` sudah membuat baris untuk tiap hari yang berbelanja, jadi hari
      // yang belum punya baris memang tanpa campaign ("unmapped"), sama seperti yang ditulis sync.
      if (!(metrics.earning > 0)) continue;
      created.push({ key, day, name: sub.name, report });
      rows[key] = report;
      continue;
    }

    const patch = {};
    for (const field of [...EARNING_KEYS, ...(spend !== undefined ? RATIO_KEYS : [])]) {
      if (!same(report[field], existing[field])) patch[field] = report[field];
    }
    const before = typeof existing.earning === "number" ? existing.earning : null;
    // Selisih sepersekian rupiah dari pembulatan float bukan perubahan.
    const moved = before === null || Math.abs(before - metrics.earning) >= 0.5;
    const shapeChanged = ["currency", "fxRate", "gamMissing", "gamStale"].some((f) => f in patch);
    if (!moved && !shapeChanged) continue;
    writes.push({ key, day, name: sub.name, before, after: report.earning, patch });
    rows[key] = { ...existing, ...patch };
  }
}

// --- weeklyFinancials: pendapatan harian seluruh usaha ------------------------------------------
const finWrites = [];
for (const day of days) {
  const point = financials[day];
  if (!point || point.source === "spreadsheet") continue;
  const after = Math.round((revenueByDay.get(day) || 0) * 100) / 100;
  if (Math.abs(Number(point.grossRevenue || 0) - after) < 0.5) continue;
  finWrites.push({ day, before: Number(point.grossRevenue || 0), after });
}

// --- Laporan -------------------------------------------------------------------------------------
console.log(`\nRentang ${since} s/d ${until} · ${days.length} hari · ${accounts.length} akun dibaca.`);
for (const { domain, start } of domainStarts) console.log(`${domain} dihitung mulai ${start}.`);

const byMonth = new Map();
for (const w of writes) {
  const e = byMonth.get(w.day.slice(0, 7)) || { rows: 0, delta: 0 };
  e.rows++;
  e.delta += (w.after || 0) - (w.before || 0);
  byMonth.set(w.day.slice(0, 7), e);
}
for (const c of created) {
  const e = byMonth.get(c.day.slice(0, 7)) || { rows: 0, delta: 0 };
  e.rows++;
  e.delta += c.report.earning;
  byMonth.set(c.day.slice(0, 7), e);
}
if (byMonth.size) {
  console.log("\nroiReports — perubahan earning per bulan:");
  for (const [month, e] of [...byMonth].sort()) {
    console.log(`  ${month}: ${e.rows} baris, netto ${e.delta >= 0 ? "+" : "-"}Rp ${rupiah(Math.abs(e.delta))}`);
  }
}

const bySub = new Map();
for (const w of writes) {
  const e = bySub.get(w.name) || { rows: 0, delta: 0, filled: 0 };
  e.rows++;
  e.delta += (w.after || 0) - (w.before || 0);
  if (w.before === null) e.filled++;
  bySub.set(w.name, e);
}
for (const c of created) {
  const e = bySub.get(c.name) || { rows: 0, delta: 0, filled: 0 };
  e.rows++;
  e.delta += c.report.earning;
  e.filled++;
  bySub.set(c.name, e);
}
const shown = [...bySub].sort((a, b) => Math.abs(b[1].delta) - Math.abs(a[1].delta));
if (shown.length) {
  console.log("\nPer subdomain (netto, diurut dari yang terbesar):");
  for (const [name, e] of shown) {
    const note = e.filled ? ` · ${e.filled} baris earning-nya sebelumnya kosong/baru` : "";
    console.log(`  ${e.delta >= 0 ? "+" : "-"}Rp ${rupiah(Math.abs(e.delta)).padStart(10)}  ${name} (${e.rows} baris${note})`);
  }
}

if (finWrites.length) {
  const delta = finWrites.reduce((s, w) => s + w.after - w.before, 0);
  console.log(
    `\nweeklyFinancials — ${finWrites.length} hari, netto ${delta >= 0 ? "+" : "-"}Rp ${rupiah(Math.abs(delta))} pendapatan.`,
  );
}
if (skippedEarning.size) {
  console.log("\nPendapatan sebelum domain-nya dimulai (TIDAK ditulis ke mana pun):");
  for (const [site, idr] of [...skippedEarning].sort((a, b) => b[1] - a[1])) {
    if (idr >= 1) console.log(`  Rp ${rupiah(idr)} — ${site}`);
  }
}
if (unmatched.size) {
  console.log("\nSitus berearning yang BELUM terdaftar di /sub-domains (ikut weeklyFinancials, tidak punya baris ROI):");
  for (const [site, idr] of [...unmatched].sort((a, b) => b[1] - a[1])) {
    console.log(`  Rp ${rupiah(idr)} — ${site}`);
  }
}

if (!writes.length && !created.length && !finWrites.length) {
  console.log("\nTidak ada yang perlu diubah.");
  process.exit(0);
}
if (dry) {
  console.log(
    `\n--dry: tidak ada yang ditulis. ${writes.length} baris ROI disunting, ${created.length} dibuat, ` +
      `${finWrites.length} titik weeklyFinancials.`,
  );
  process.exit(0);
}

// Per baris, bukan satu update besar berkunci koleksi: yang kedua menimpa seluruh koleksi kalau
// path-nya salah ketik.
for (const w of writes) await update(ref(db, `dashboard/roiReports/${w.key}`), w.patch);
for (const c of created) await update(ref(db, `dashboard/roiReports/${c.key}`), c.report);
for (const w of finWrites) {
  await update(ref(db, `dashboard/weeklyFinancials/${w.day}`), { grossRevenue: w.after });
}
console.log(
  `\nSelesai. ${writes.length} baris ROI disunting, ${created.length} dibuat, ` +
    `${finWrites.length} titik weeklyFinancials. roiSnapshots dan ROI per Negara tidak ikut.`,
);
process.exit(0);
