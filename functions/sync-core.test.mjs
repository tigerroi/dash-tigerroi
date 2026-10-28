import assert from "node:assert";
import {
  accountKeys,
  accountKeysByOwner,
  accountLabel,
  adsenseCountryDimensions,
  adTaxRate,
  advertiserSpendRows,
  balanceSnapshotEntry,
  buildCampaignMap,
  buildCampaignResolver,
  buildCodeIndex,
  CAMPAIGN_GONE_STATUS,
  campaignHistoryEntries,
  campaignHistoryPruneBefore,
  campaignRowBelongsTo,
  campaignStatusLabel,
  campaignStatusRefresh,
  collectCountryEarning,
  collectCountrySpend,
  costPerResult,
  countryRoiByUser,
  countryRoiRows,
  countryRoiStatus,
  dailySpendEntries,
  dailySpendPruneBefore,
  dashboardStatsFrom,
  dateKeyFrom,
  dateKeysBetween,
  dueRetries,
  excessSnapshotKeys,
  excessSyncRunKeys,
  expiredCampaignHistoryKeys,
  expiredDailySpendKeys,
  expiredRoiReportKeys,
  expiredRoiSnapshotKeys,
  financialPoint,
  financialWindow,
  financialWrite,
  futureRoiReportKeys,
  gamRowsByDay,
  historyKey,
  LEGACY_ROI_KEY_BOUND,
  latestSnapshotFor,
  leftoverRunningIds,
  MAX_SYNC_RETRIES,
  matchCode,
  mergeFinancialSeries,
  metaRowsByDay,
  missingCampaignExpired,
  missingCampaignRow,
  nextRetryAt,
  nextRunAfter,
  parseCampaignCodes,
  permanentAccountError,
  previousRoiReport,
  previousRoiSnapshot,
  reportDayKey,
  reportPeriod,
  reportRange,
  retryOutcome,
  retryRunning,
  retrySeed,
  roiHistoryDays,
  roiPreviousLookbackDays,
  roiReportKey,
  roiReportPruneBefore,
  roiReportUpdate,
  roiReportWindowStart,
  roiSnapshotKey,
  roiSnapshotPruneBefore,
  roiSnapshotWindowStart,
  runningDayKey,
  scheduleIntervalMs,
  shiftDateKey,
  subdomainUpdate,
  supersededRoiReportKeys,
  syncIssuesUpdate,
  syncRunEntry,
  syncRunKey,
  syncStatusUpdate,
  USER_REPORTS_PATH,
  unreadableActIds,
  unreadableEarningByDate,
  unreadableEarningDomains,
  unreadableSpendRows,
  userReportsPath,
  zonedClock,
  zonedDateKey,
} from "./sync-core.js";

// buildCampaignMap: normalized campaign name -> normalized subdomain, from users' campaigns[].
const users = {
  u1: { campaigns: [{ campaign: "Camp A", subDomain: "Sub.One" }] },
  u2: { campaigns: { x: { campaign: "Camp B", subDomain: "sub.two" }, y: { campaign: "" } } },
};
const map = buildCampaignMap(users);
assert.equal(map.get("camp a"), "sub.one");
assert.equal(map.get("camp b"), "sub.two");
assert.equal(map.size, 2, "blank campaign name skipped");

// roiReportUpdate tanpa spend: kolom META ADS dikosongkan (jadi "-"), bukan diisi 0 — dan
// barisnya menyebut sebabnya. null, bukan sekadar tidak ditulis: update() menggabung, jadi angka
// sync sebelumnya di hari yang sama akan menempel pada baris yang campaign-nya sudah tidak
// teratribusi lagi.
const noSpend = roiReportUpdate(
  { name: "s", pic: "p" },
  { earning: 100, impressions: 1000, clicks: 10 },
);
assert.equal(noSpend.earning, 100);
assert.equal(noSpend.ecpm, 100, "100/1000*1000");
assert.equal(noSpend.spending, null);
assert.equal(noSpend.adTax, null);
assert.equal(noSpend.totalSpending, null);
assert.equal(noSpend.roi, null, "tanpa spend tidak ada ROI — bukan 0%");
assert.equal(noSpend.profit, null, "earning dikurangi nol adalah klaim yang tidak kita punya");
assert.equal(
  noSpend.metaMissing,
  "unmapped",
  "sebabnya ditulis, bukan disimpulkan dari sel kosong",
);

// roiReportUpdate with spend: ROI + profit dihitung dari total spending (spend + ad tax), tarif
// yang sama dengan ROI per negara — kalau tidak, satu subdomain dan baris-baris negaranya akan
// melaporkan ROI berbeda untuk uang yang sama.
const withSpend = roiReportUpdate({ name: "s" }, { earning: 150, impressions: 0, clicks: 0 }, 100, {
  adTaxRate: 0.05,
});
assert.equal(withSpend.spending, 100);
assert.equal(withSpend.adTax, 5, "100 × 5%");
assert.equal(withSpend.totalSpending, 105);
assert.equal(withSpend.profit, 45, "150 - 105");
assert.equal(withSpend.roi, 42.86, "(150-105)/105*100");

// Earning per sumber ikut ditulis ke barisnya: kolom GAM dan AdSense di tabel ROI membacanya,
// dan totalnya tetap `earning` — ROI dihitung dari jumlahnya, bukan dari satu sumber.
const perSumber = roiReportUpdate(
  { name: "s" },
  { earning: 10, impressions: 100, clicks: 4, adx: 7, adsense: 2, adServer: 1 },
  5,
  { adTaxRate: 0 },
);
assert.equal(perSumber.adxRevenue, 7);
assert.equal(perSumber.adsenseRevenue, 2);
assert.equal(perSumber.adServerRevenue, 1);
assert.equal(perSumber.earning, 10, "jumlah ketiganya");
assert.equal(perSumber.roi, 100, "(10-5)/5*100 — dari total, bukan dari AdX saja");

// Laporan yang tidak membawa rinciannya (network yang metriknya ditolak) tidak dikarang jadi 0:
// nol di kolom sumber adalah klaim bahwa sumber itu tidak menghasilkan apa-apa.
const tanpaRincian = roiReportUpdate(
  { name: "s" },
  { earning: 10, impressions: 100, clicks: 4 },
  5,
  { adTaxRate: 0 },
);
assert.equal(tanpaRincian.adxRevenue, null);
assert.equal(tanpaRincian.adsenseRevenue, null);
assert.equal(tanpaRincian.earning, 10);

// Tarif 0 mengembalikannya ke ROI kotor — Settings boleh menurunkannya sampai nol.
const noTax = roiReportUpdate({ name: "s" }, { earning: 150, impressions: 0, clicks: 0 }, 100, {
  adTaxRate: 0,
});
assert.equal(noTax.adTax, 0);
assert.equal(noTax.roi, 50, "(150-100)/100*100");

// spend = 0 known -> roi 0, not divide-by-zero.
const zeroSpend = roiReportUpdate({ name: "s" }, { earning: 10, impressions: 0, clicks: 0 }, 0, {
  adTaxRate: 0.05,
});
assert.equal(zeroSpend.roi, 0);
assert.equal(zeroSpend.spending, 0);

// CPR = spend / hasil.
const withCpr = roiReportUpdate({ name: "s" }, { earning: 150, impressions: 0, clicks: 0 }, 90, {
  results: 4,
});
assert.equal(withCpr.cpr, 22.5, "90 / 4");
assert.equal(withCpr.results, 4);

// Tanpa hasil, CPR "-" — bukan 0, yang akan terbaca sebagai hasil gratis. "-" juga menimpa angka
// CPR sisa sync sebelumnya, karena update() menggabung dan bukan mengganti seluruh baris.
assert.equal(zeroSpend.cpr, "-", "hasil 0 -> tidak ada CPR");
assert.equal(
  roiReportUpdate({ name: "s" }, { earning: 1, impressions: 0, clicks: 0 }, 50).cpr,
  "-",
  "extra.results tidak dikirim",
);

// Spend tidak diketahui -> tidak ada CPR sama sekali (kolomnya "-" di UI), sama seperti ROI.
assert.equal(noSpend.cpr, null);

// Sisi Meta yang tidak lengkap (token kosong / laporan akun gagal) BUKAN "tanpa campaign": angka
// spend yang sudah ada di baris hari itu dibiarkan, seperti earning yang laporannya gagal, dan
// tandanya berbeda supaya orang tahu yang ini diperbaiki di sync-nya.
const metaGagal = roiReportUpdate(
  { name: "s" },
  { earning: 100, impressions: 0, clicks: 0 },
  undefined,
  { metaComplete: false },
);
assert.equal(metaGagal.metaMissing, "unavailable");
assert.equal("spending" in metaGagal, false, "yang lama tidak dihapus kegagalan API");
assert.equal("roi" in metaGagal, false);

// Spend yang kembali teratribusi membersihkan tandanya, kalau tidak catatannya menempel selamanya.
assert.equal(withSpend.metaMissing, null);

// Rincian "Campaign digabung": nama + spend tiap campaign yang menumpuk di subdomain ini.
const merged = roiReportUpdate({ name: "s" }, { earning: 1, impressions: 0, clicks: 0 }, 30, {
  campaigns: [
    { name: "nPJL-06 Turki", spend: 20.005 },
    { name: "", spend: 99 },
    { name: "pBRw-01 Carrou", spend: 10 },
  ],
});
assert.deepEqual(merged.campaigns, [
  { name: "nPJL-06 Turki", spend: 20.01 },
  { name: "pBRw-01 Carrou", spend: 10 },
]);

// null, bukan array kosong: update() menggabung, jadi daftar sync sebelumnya harus dihapus
// eksplisit — kalau tidak, badge tetap menyebut campaign yang spend-nya sudah tidak masuk lagi.
assert.equal(withCpr.campaigns, null, "tidak ada campaign -> field dihapus");

console.log("sync-core.test ok");

// --- Overview panels -------------------------------------------------------

// financialPoint: one chart point per day, in the shape LineChart reads.
const point = financialPoint("2026-08-05", 1234.567, 890.1);
assert.equal(point.date, "2026-08-05");
assert.equal(point.period, "05/08/26", "X axis label");
assert.equal(point.grossRevenue, 1234.57, "rounded to cents");
assert.equal(point.totalSpend, 890.1);

// advertiserSpendRows: summed per owner, keyed by user id so Detail links somewhere real.
const spendRows = advertiserSpendRows(
  { u1: { name: "Nurjaman" }, u2: { name: "Muhajir" }, u3: { name: "Arsip", deletedAt: "x" } },
  {
    a1: { userOwner: "Nurjaman", balance: 100.5, spendToday: 40 },
    a2: { userOwner: "nurjaman", balance: 50, spendToday: 2.25 },
    a3: { userOwner: "Nurjaman", balance: 9, spendToday: 9, deletedAt: "x" },
    a4: { userOwner: "Tidak Ada", balance: 999, spendToday: 999 },
  },
);
assert.equal(spendRows.length, 1, "Muhajir owns no account, so no row");
const [spendId, spendRow] = spendRows[0];
assert.equal(spendId, "u1", "keyed by user id");
assert.equal(spendRow.pic, "Nurjaman");
assert.equal(spendRow.balance, 150.5, "summed, archived account excluded");
assert.equal(spendRow.spendToday, 42.25);
assert.equal(spendRow.userId, "u1");

// dashboardStatsFrom: totals across accounts and campaigns.
const stats = dashboardStatsFrom(
  {
    u1: { campaigns: [{ campaign: "a" }, { campaign: "b" }] },
    u2: { campaigns: { x: { campaign: "c" } } },
  },
  { a1: { spendToday: 10.5 }, a2: { spendToday: 4.5 }, a3: { spendToday: 100, deletedAt: "x" } },
);
assert.equal(stats.totalSpend, 15);
assert.equal(stats.managedCampaigns, 3, "array and object shapes both counted");

// roiReportUpdate extras: fluctuation needs a previous row, "-" when there is none.
const round2 = (value) => Math.round(value * 100) / 100;
const first = roiReportUpdate({ name: "s" }, { earning: 100, impressions: 10, clicks: 5 }, 40);
assert.equal(first.flukEarn, "-", "no previous row, no change to show");
assert.equal(first.flukSpend, "-");
const second = roiReportUpdate({ name: "s" }, { earning: 150, impressions: 10, clicks: 5 }, 50, {
  previous: first,
  metaBalance: 1234,
});
assert.equal(second.flukEarn, 50, "150 - 100");
assert.equal(second.flukSpend, 10, "50 - 40");
assert.equal(second.flukRoi, round2(second.roi - first.roi), "roi delta");
assert.equal(second.metaBalance, 1234);
// Extras are optional: absent means the column stays "-" rather than showing a fake zero.
assert.equal("metaBalance" in first, false);

console.log("sync-core overview tests ok");

// dateKeyFrom: GAM's DATE dimension arrives as an int, "20260730".
assert.equal(dateKeyFrom("20260730"), "2026-07-30");
assert.equal(dateKeyFrom(20260730), "2026-07-30", "number works too");
assert.equal(dateKeyFrom("2026-07-30"), "2026-07-30", "Meta's format passes through");
assert.equal(dateKeyFrom("(Not applicable)"), "", "junk rejected, not coerced to a date");
assert.equal(dateKeyFrom(""), "");

// mergeFinancialSeries: union, not intersection — a day that earned without any ad spend is
// real and must still plot, and so is the reverse.
const series = mergeFinancialSeries(
  new Map([
    ["2026-08-02", 100],
    ["2026-08-01", 50],
  ]),
  new Map([
    ["2026-08-01", 30],
    ["2026-08-03", 70],
  ]),
);
assert.equal(series.length, 3, "three distinct days across both sides");
assert.deepEqual(
  series.map((p) => p.date),
  ["2026-08-01", "2026-08-02", "2026-08-03"],
  "sorted ascending for the chart's X axis",
);
assert.equal(series[1].grossRevenue, 100);
assert.equal(series[1].totalSpend, 0, "revenue with no spend that day");
assert.equal(series[2].grossRevenue, 0, "spend with no revenue that day");
assert.equal(series[2].totalSpend, 70);

// financialWindow berakhir pada hari BERJALAN di kedua sisi, dan mundur dari hari yang sudah
// selesai. Yang dilarang bukan menampilkan hari ini, melainkan memasangkan revenue kemarin dengan
// spend hari ini dalam satu titik — jadi keduanya harus berakhir pada hari yang sama. "Hari ini"
// dihitung menurut zona operasi, bukan UTC: di GMT+7 keduanya berbeda hari sepanjang 00:00-07:00 WIB.
const w = financialWindow(7, new Date("2026-08-08T00:35:00Z"));
assert.equal(w.until, "2026-08-08", "hari berjalan menurut Asia/Jakarta (08 Agu 07:35 WIB)");
assert.equal(w.settled, "2026-08-07", "hari yang sudah selesai tetap disebut terpisah");
assert.equal(w.running, "2026-08-08");
assert.equal(w.since, "2026-08-01", "7 hari mundur dari hari yang sudah selesai");
assert.deepEqual(w.gamRange.endDate, { year: 2026, month: 8, day: 8 });
assert.ok(w.since < w.until, "window spans backwards");

// SYNC_INCLUDE_TODAY=0 mengembalikannya ke hari selesai saja — angka setengah hari bisa dimatikan
// tanpa menyentuh kode.
process.env.SYNC_INCLUDE_TODAY = "0";
const settledOnly = financialWindow(7, new Date("2026-08-08T00:35:00Z"));
assert.equal(settledOnly.until, "2026-08-07", "tanpa hari berjalan, jendelanya berakhir kemarin");
assert.equal(settledOnly.running, "");
delete process.env.SYNC_INCLUDE_TODAY;

// Titik hari berjalan ditandai, titik hari selesai tidak. Grafik menggambar yang partial dengan
// garis putus-putus, dan tanpa penanda ini ujung yang belum selesai terbaca sebagai margin jatuh.
const marked = mergeFinancialSeries(
  new Map([
    ["2026-08-07", 100],
    ["2026-08-08", 20],
  ]),
  new Map([
    ["2026-08-07", 50],
    ["2026-08-08", 40],
  ]),
  0.05,
  "2026-08-08",
);
assert.equal(marked[0].partial, false, "hari yang sudah selesai");
assert.equal(marked[1].partial, true, "hari berjalan");

// Titik grafik membawa ad tax-nya sendiri, sama seperti baris ROI. Tanpa ini garis "Pengeluaran"
// berarti Meta spend telanjang sementara kolom Total Spend di tabel berarti spend + pajak, dan
// memfilter satu subdomain memberi dua angka berbeda untuk hari yang sama.
const taxedPoint = financialPoint("2026-08-09", 742983, 138136, 0.05);
assert.equal(taxedPoint.totalSpend, 138136, "Meta spend telanjang tetap disimpan");
assert.equal(taxedPoint.adTax, 6906.8, "138136 × 5%");
assert.equal(taxedPoint.totalSpending, 145042.8, "= kolom AD SPEND+AD TAX di rekap advertiser");
assert.equal(taxedPoint.date, "2026-08-09");

// Tarif 0 mengembalikannya ke spend telanjang — Settings boleh menurunkannya sampai nol.
assert.equal(financialPoint("2026-08-09", 1, 100, 0).totalSpending, 100);

console.log("sync-core financials tests ok");

// --- Campaign codes -------------------------------------------------------------------------
// The Keitaro code at the front of a Meta campaign name is what maps it to a subdomain.

assert.deepEqual(parseCampaignCodes("pBRw, TvH1"), ["pbrw", "tvh1"], "comma separated");
assert.deepEqual(parseCampaignCodes("pBRw TvH1\n5mxp"), ["pbrw", "tvh1", "5mxp"], "any separator");
assert.deepEqual(parseCampaignCodes(""), [], "blank field owns no code");
assert.deepEqual(
  parseCampaignCodes("nPJL-06 Pros Turki Carrou LKM  85 10 Adset"),
  ["npjl", "06", "pros", "turki", "carrou", "lkm", "85", "10", "adset"],
  "a campaign name splits into the same tokens the codes are matched against",
);

const codeSubs = {
  a: { name: "puppy.petcins.com", campaignCodes: "TvH1" },
  b: { name: "dogtraining.petcins.com", campaignCodes: "5rx7, 3zbx" },
  c: { name: "gone.petcins.com", campaignCodes: "TvH1", deletedAt: "2026-08-01" },
};
const index = buildCodeIndex(codeSubs);
assert.equal(index.byCode.get("tvh1"), "puppy.petcins.com");
assert.equal(index.byCode.get("5rx7"), "dogtraining.petcins.com", "one subdomain owns many codes");
assert.equal(index.byCode.get("3zbx"), "dogtraining.petcins.com");
assert.equal(index.conflicts.length, 0, "an archived subdomain does not clash over a code");

const clash = buildCodeIndex({
  a: { name: "puppy.petcins.com", campaignCodes: "TvH1" },
  b: { name: "insurance.petcins.com", campaignCodes: "tvh1" },
});
assert.equal(clash.byCode.get("tvh1"), "puppy.petcins.com", "first owner keeps a contested code");
assert.deepEqual(clash.conflicts, [
  { code: "tvh1", kept: "puppy.petcins.com", ignored: "insurance.petcins.com" },
]);

// Kode terdaftar PERTAMA di nama yang menang — aturan yang sama dipakai sync DAN vonis nama di
// halaman Campaign, supaya dialog tidak menyetujui nama yang oleh sync dipetakan ke subdomain lain.
assert.deepEqual(matchCode("TvH1-14 Pros MEA 5rx7", index.byCode), {
  subDomain: "puppy.petcins.com",
  code: "tvh1",
});
assert.deepEqual(
  matchCode("nPJL-06 Pros Turki", index.byCode),
  { subDomain: "", code: "npjl" },
  "tanpa kode terdaftar, token pertama tetap disebut supaya pesannya bisa menunjuk kodenya",
);
assert.deepEqual(matchCode("", index.byCode), { subDomain: "", code: "" });

const { resolve } = buildCampaignResolver(
  { u1: { campaigns: [{ campaign: "Kampanye Tanpa Kode", subDomain: "seniorpet.petcins.com" }] } },
  codeSubs,
);
assert.deepEqual(
  resolve("TvH1-14 Pros MEA Carrou LKM  81  10 Adset"),
  { subDomain: "puppy.petcins.com", source: "code", code: "tvh1" },
  "the code in the name decides",
);
assert.equal(
  resolve("3zbx-7 Pros Turki Carrou LMP  43 5 Adset").subDomain,
  "dogtraining.petcins.com",
  "several campaigns can land on one subdomain",
);
assert.equal(
  resolve("Kampanye Tanpa Kode").source,
  "manual",
  "a hand-entered mapping wins over the codes",
);
assert.equal(resolve("d4k8-2 Pros TSM Carrou LMP  11 5 Adset").subDomain, "", "unknown code");
assert.equal(
  resolve("Promo tvh1x Adset").subDomain,
  "",
  "codes match whole tokens only — 'tvh1' must not match inside 'tvh1x'",
);

console.log("sync-core campaign code tests ok");

// --- Riwayat saldo --------------------------------------------------------------------------
// Dua panel di Profile User membaca users/{id}.dailySpend dan .balanceSnapshots. Tidak ada yang
// pernah menulisnya, jadi keduanya selalu kosong; ini yang mengisinya.

const runAt = new Date("2026-08-07T14:32:10.000Z");

// Kunci RTDB tidak boleh memuat . $ # [ ] / — nama campaign Meta memuat hampir semuanya.
assert.equal(historyKey("nPJL-06 Pros Turki/Carrou"), "npjl-06-pros-turki-carrou");
assert.equal(historyKey(""), "x", "kunci kosong bukan kunci");
assert.ok(historyKey("x".repeat(400)).length <= 120, "kunci dipotong sebelum batas RTDB");

const spendEntries = dailySpendEntries(
  "acc1",
  { name: "Ads Nurjaman", actId: "act_1", spendToday: 55 },
  [
    { name: "TvH1-14 Pros MEA", spend: 30.005 },
    { name: "3zbx-7 Pros Turki", spend: 25 },
    { name: "Jeda Total", spend: 0 },
    { name: "", spend: 99 },
  ],
  runAt,
);
assert.equal(spendEntries.length, 2, "campaign tanpa spend dan tanpa nama tidak jadi baris");
assert.deepEqual(spendEntries[0], [
  "2026-08-07__acc1__tvh1-14-pros-mea",
  {
    date: "2026-08-07",
    account: "Ads Nurjaman",
    campaign: "TvH1-14 Pros MEA",
    amount: 30.01,
    note: "Sync Meta 21:32",
  },
]);
// Kuncinya tanggal + akun + campaign: sync kedua di hari yang sama menimpa baris hari itu,
// bukan menambah satu baris tiap kali dijalankan.
const secondRun = dailySpendEntries(
  "acc1",
  { name: "Ads Nurjaman", spendToday: 80 },
  [{ name: "TvH1-14 Pros MEA", spend: 45 }],
  // 12:00Z = 19:00 WIB, masih hari yang sama dengan runAt (14:32Z = 21:32 WIB).
  new Date("2026-08-07T12:00:00.000Z"),
);
assert.equal(secondRun[0][0], spendEntries[0][0], "kunci sama sepanjang hari itu");
assert.equal(secondRun[0][1].amount, 45, "angkanya yang diperbarui");

// ...dan "hari itu" adalah hari OPERASI, bukan hari UTC. 19:00Z masih 8 Agu pukul 02:00 WIB, jadi
// ia baris hari berikutnya — dengan jam WIB di catatannya. Dibiarkan UTC, kolom Tanggal menyebut
// 7 Agu di sebelah catatan "Sync Meta 02:00", dua hari berbeda dalam satu baris.
const dinihari = dailySpendEntries(
  "acc1",
  { name: "Ads Nurjaman", spendToday: 80 },
  [{ name: "TvH1-14 Pros MEA", spend: 45 }],
  new Date("2026-08-07T19:00:00.000Z"),
);
assert.equal(dinihari[0][0], "2026-08-08__acc1__tvh1-14-pros-mea");
assert.equal(dinihari[0][1].date, "2026-08-08");
assert.equal(dinihari[0][1].note, "Sync Meta 02:00");

// Meta memberi angka akun tanpa merinci campaign-nya. Spend-nya nyata, jadi barisnya tetap ada.
const noDetail = dailySpendEntries("acc2", { name: "Ads B", spendToday: 12.5 }, [], runAt);
assert.deepEqual(
  noDetail.map(([key]) => key),
  ["2026-08-07__acc2"],
);
assert.equal(noDetail[0][1].campaign, "Tanpa rincian campaign");
assert.equal(noDetail[0][1].amount, 12.5);
assert.deepEqual(
  dailySpendEntries("acc3", { name: "Ads C", spendToday: 0 }, [], runAt),
  [],
  "akun yang tidak belanja hari ini tidak menulis baris apa pun",
);

// Snapshot pertama tidak punya pembanding; "turun 0" akan terbaca sebagai saldo yang diam.
const [firstKey, firstSnap] = balanceSnapshotEntry(
  "acc1",
  { name: "Ads Nurjaman", balance: 200.456, spendToday: 55 },
  null,
  runAt,
);
assert.equal(firstKey, "202608071432__acc1");
assert.equal(
  firstSnap.syncedAt,
  "2026-08-07 21:32",
  "terbaca orang, jam WIB, tetap terurut sebagai tanggal",
);
assert.equal(firstSnap.balance, 200.46);
assert.equal(firstSnap.dailyReduction, 55);
assert.equal(firstSnap.source, "Meta Ads API");
assert.equal(firstSnap.note, "Snapshot pertama untuk akun ini.");

const [, dropped] = balanceSnapshotEntry(
  "acc1",
  { name: "Ads Nurjaman", balance: 145, spendToday: 55 },
  firstSnap,
  new Date("2026-08-07T19:00:00.000Z"),
);
assert.equal(dropped.note, "Saldo turun sejak 2026-08-07 21:32.");
const [, toppedUp] = balanceSnapshotEntry("acc1", { balance: 900 }, firstSnap, runAt);
assert.equal(toppedUp.note, "Saldo naik (top-up) sejak 2026-08-07 21:32.");
// Catatan sengaja tanpa "Rp <angka>": renderCell memperlakukan teks semacam itu sebagai nilai
// uang dan akan meringkas seluruh kalimat jadi satu angka.
for (const snap of [firstSnap, dropped, toppedUp]) {
  assert.ok(!/rp\s*\d/i.test(snap.note), `catatan tidak boleh terbaca sebagai uang: ${snap.note}`);
}

// --- Riwayat spend campaign per-hari ----------------------------------------------------------
//
// Berbeda dari dailySpendEntries: tanggalnya dari Meta (date_start), bukan jam run, dan tiap
// campaign bisa punya banyak baris (satu per hari). Kuncinya tanggal__akun__campaign.
const resolveCode = (name) =>
  /^tvh1/i.test(name)
    ? { subDomain: "puppy.petcins.com", code: "TvH1" }
    : { subDomain: "", code: "" };
const historyRows = campaignHistoryEntries(
  "acc1",
  { name: "Ads Nurjaman", actId: "act_1" },
  [
    {
      date: "2026-08-06",
      id: "111",
      name: "TvH1-14 Pros MEA",
      spend: 30.005,
      results: 12,
      resultType: "onsite_conversion.messaging_first_reply",
      costPerResult: 2.5,
    },
    { date: "2026-08-07", id: "111", name: "TvH1-14 Pros MEA", spend: 25, results: 9 },
    // Tanpa tanggal (Meta diminta date_preset, bukan rentang) atau tanpa nama: dilewati, bukan baris.
    { date: "", id: "222", name: "Nama Ada Tanpa Tanggal", spend: 99 },
    { date: "2026-08-07", id: "333", name: "", spend: 5 },
  ],
  resolveCode,
);
assert.equal(historyRows.length, 2, "baris tanpa tanggal atau tanpa nama tidak jadi baris");
assert.deepEqual(historyRows[0], [
  "2026-08-06__acc1__111",
  {
    date: "2026-08-06",
    campaign: "TvH1-14 Pros MEA",
    campaignId: "111",
    account: "Ads Nurjaman",
    adAccount: "act_1",
    subDomain: "puppy.petcins.com",
    campaignCode: "TvH1",
    spend: 30.01,
    results: 12,
    resultType: "onsite_conversion.messaging_first_reply",
    costPerResult: 2.5,
  },
]);
// Dua hari untuk campaign yang sama = dua kunci berbeda (bukan saling menimpa seperti dailySpend).
assert.notEqual(historyRows[0][0], historyRows[1][0], "hari berbeda, kunci berbeda");
assert.equal(historyRows[1][1].costPerResult, "", 'CPR yang tidak dikirim jadi "" bukan 0');

// Masa simpan: hanya kunci berbentuk tanggal yang lebih tua dari cutoff yang dibuang; baris lain
// (mis. hasil input tangan yang tak berawalan tanggal) tidak tersentuh.
const historyExisting = {
  "2026-05-01__acc1__111": { spend: 1 }, // > 90 hari sebelum 2026-08-07 → kadaluwarsa
  "2026-08-06__acc1__111": { spend: 2 }, // dalam jendela → tetap
  "manual-note": { spend: 3 }, // bukan kunci tanggal → tak tersentuh
};
assert.deepEqual(
  expiredCampaignHistoryKeys(historyExisting, runAt, 90),
  ["2026-05-01__acc1__111"],
  "hanya baris tanggal di luar masa simpan yang dibuang",
);

// Pembanding = snapshot terakhir milik akun yang sama, bukan yang terakhir ditulis siapa pun.
const snapshots = {
  "202608070900__acc1": { balance: 300, syncedAt: "2026-08-07 09:00" },
  "202608071432__acc1": { balance: 200, syncedAt: "2026-08-07 14:32" },
  "202608071500__acc2": { balance: 999, syncedAt: "2026-08-07 15:00" },
};
assert.equal(latestSnapshotFor(snapshots, "acc1").balance, 200);
assert.equal(latestSnapshotFor(snapshots, "acc2").balance, 999);
assert.equal(latestSnapshotFor(snapshots, "acc9"), null);
assert.equal(latestSnapshotFor(undefined, "acc1"), null);

// Riwayat tetap dipangkas walau sudah pindah dari `users`: panelnya bertabel halaman, dan riwayat
// berbulan-bulan yang tidak pernah digulir siapa pun cuma memperlambat panel yang membukanya.
const dailySpendHistory = {
  "2026-06-01__acc1": {},
  "2026-08-06__acc1": {},
  "2026-08-07__acc1": {},
  manual_entry: {},
};
assert.deepEqual(
  expiredDailySpendKeys(dailySpendHistory, runAt, 30),
  ["2026-06-01__acc1"],
  "hanya yang lewat masa simpan; baris berbentuk lain (impor/tangan) tidak disentuh",
);
assert.deepEqual(
  excessSnapshotKeys({ ...snapshots, catatan_manual: {} }, 2),
  ["202608070900__acc1"],
  "yang paling lama dibuang lebih dulu, kunci asing dilewati",
);
assert.deepEqual(excessSnapshotKeys(snapshots, 10), [], "masih di bawah jatah simpan");

// --- Riwayat panel Profile User tinggal di pohonnya sendiri ------------------------------------
//
// Pindah dari `users/{id}`, yang dilanggan browser tiap muat halaman siapa pun. Path-nya diturunkan
// di satu tempat: dirakit sendiri di sisi penulis, sebuah salah ketik menulis riwayat ke cabang
// yang tidak dibaca satu panel pun — dan panelnya lalu kosong tanpa satu pun pesan kesalahan.
assert.equal(userReportsPath("u1"), `${USER_REPORTS_PATH}/u1`);
assert.notEqual(USER_REPORTS_PATH, "users", "pohon sendiri, bukan cabang di bawah users");

// Kedua batas permintaan pemangkasan HARUS sama persis dengan cutoff penyaringnya. Lebih longgar,
// baris kedaluwarsa tidak pernah ikut terminta dan tertinggal selamanya; lebih ketat, yang belum
// waktunya ikut terbawa. Keduanya diam — sepola `roiReportPruneBefore`.
assert.equal(dailySpendPruneBefore(runAt, 30), "2026-07-08");
assert.deepEqual(
  expiredDailySpendKeys(dailySpendHistory, runAt, 30),
  expiredDailySpendKeys(
    Object.fromEntries(
      Object.entries(dailySpendHistory).filter(([key]) => key < dailySpendPruneBefore(runAt, 30)),
    ),
    runAt,
    30,
  ),
  "memangkas dari hasil permintaan berbatas = memangkas dari seluruh cabang",
);
assert.equal(campaignHistoryPruneBefore(runAt, 90), "2026-05-09");
assert.deepEqual(
  expiredCampaignHistoryKeys(historyExisting, runAt, 90),
  expiredCampaignHistoryKeys(
    Object.fromEntries(
      Object.entries(historyExisting).filter(
        ([key]) => key < campaignHistoryPruneBefore(runAt, 90),
      ),
    ),
    runAt,
    90,
  ),
  "memangkas dari hasil permintaan berbatas = memangkas dari seluruh cabang",
);

// --- Kolom tabel Kampanye -------------------------------------------------------------------

// Tiga label, dan ketiganya sepakat dengan posisi saklar di sebelahnya: On berbunyi
// "Aktif"/"Terjadwal", Off berbunyi "Tidak aktif". Yang dibaca adalah `status` milik Meta (posisi
// saklar), bukan `effective_status` — review dan limit tidak lagi punya labelnya sendiri.
const labelNow = new Date("2026-09-03T10:00:00+07:00");
assert.equal(campaignStatusLabel("ACTIVE", "", labelNow), "Aktif");
assert.equal(campaignStatusLabel("PAUSED", "", labelNow), "Tidak aktif");
assert.equal(campaignStatusLabel("ARCHIVED", "", labelNow), "Tidak aktif");
assert.equal(
  campaignStatusLabel("ACTIVE", "2026-09-10T00:00:00+0700", labelNow),
  "Terjadwal",
  "offset Meta ditulis tanpa titik dua, dan itu bentuk di luar ISO 8601",
);
assert.equal(
  campaignStatusLabel("ACTIVE", "2026-09-01T00:00:00+0700", labelNow),
  "Aktif",
  "jadwal yang sudah lewat berarti campaign-nya memang sedang tayang",
);
assert.equal(
  campaignStatusLabel("ACTIVE", "bukan tanggal", labelNow),
  "Aktif",
  "jadwal yang tidak terurai tidak boleh menerbitkan 'Terjadwal' untuk seluruh armada",
);
assert.equal(campaignStatusLabel("SESUATU_YANG_BARU"), "", "status asing lebih baik kosong");
assert.equal(campaignStatusLabel(undefined), "", "status tidak terbaca bukan berarti aktif");

assert.equal(costPerResult(90, 4), 22.5);
assert.equal(costPerResult(100, 3), 33.33, "dibulatkan ke sen");
assert.equal(costPerResult(90, 0), "", "tanpa hasil tidak ada CPR — 0 terbaca sebagai gratis");
assert.equal(costPerResult(undefined, undefined), "");

console.log("sync-core riwayat saldo tests ok");

// --- ROI per negara ---------------------------------------------------------------------------
// GAM (site × negara) + Meta (campaign × negara), dijodohkan lewat kode ISO negara.

assert.equal(adTaxRate(), 0.05, "5% kalau env tidak diisi");

// GAM menamai negara, Meta memberi kodenya. Kode yang menjodohkan, nama yang ditampilkan.
const countrySubs = {
  s1: { name: "puppy.petcins.com", pic: "Nurjaman", campaignCodes: "TvH1" },
  s2: { name: "gone.petcins.com", pic: "Nurjaman", deletedAt: "2026-08-01" },
};
const countryIdByName = new Map([["puppy.petcins.com", "s1"]]);

const earningByCountry = new Map();
const unmatchedSites = collectCountryEarning(
  [
    { keys: ["puppy.petcins.com", "ID", "Indonesia"], earning: 120 },
    { keys: ["puppy.petcins.com", "ID", "Indonesia"], earning: 30 },
    { keys: ["puppy.petcins.com", "MY", "Malaysia"], earning: 10 },
    { keys: ["belum-diimpor.petcins.com", "ID", "Indonesia"], earning: 999 },
  ],
  countryIdByName,
  earningByCountry,
);
assert.deepEqual(unmatchedSites, ["belum-diimpor.petcins.com"], "site tak dikenal dilaporkan");
assert.equal(
  earningByCountry.get("s1").get("ID").earning,
  150,
  "satu negara bisa datang dari beberapa baris — dijumlahkan, bukan ditimpa",
);
assert.equal(earningByCountry.get("s1").get("ID").country, "Indonesia");
assert.equal(earningByCountry.has("s1"), true);

const spendByCountry = new Map();
const { resolve: resolveCountry } = buildCampaignResolver({}, countrySubs);
const unmatchedCountryCampaigns = collectCountrySpend(
  [
    { name: "TvH1-14 Pros MEA", country: "ID", spend: 40 },
    { name: "TvH1-20 Pros MEA", country: "ID", spend: 20 },
    { name: "TvH1-14 Pros MEA", country: "SG", spend: 25 },
    { name: "d4k8-2 Tanpa Kode", country: "ID", spend: 999 },
  ],
  resolveCountry,
  countryIdByName,
  spendByCountry,
);
assert.deepEqual(unmatchedCountryCampaigns, ["d4k8-2 Tanpa Kode"]);
assert.equal(spendByCountry.get("s1").get("ID"), 60, "beberapa campaign menumpuk di negara sama");

// Formula: Ad Tax = spend × 5%, Total = spend + tax, ROI% = (earning − total) / total × 100.
const runCountryAt = new Date("2026-08-07T14:32:10.000Z");
const countryRows = Object.fromEntries(
  countryRoiRows(countrySubs.s1, earningByCountry.get("s1"), spendByCountry.get("s1"), {
    now: runCountryAt,
    rate: 0.05,
  }),
);
// Kuncinya bertanggal, seperti baris ROI subdomain: hari selesai dan hari berjalan harus bisa
// duduk bersama di `countryRoi` yang sama, dan kunci tanpa tanggal membuat yang satu menimpa yang
// lain — angka final kemarin hilang dari panelnya setiap kali sync hari berjalan jalan.
const idRow = countryRows["2026-08-07__puppy-petcins-com__ID"];
assert.equal(idRow.spending, 60);
assert.equal(idRow.adTax, 3, "60 × 5%");
assert.equal(idRow.totalSpending, 63);
assert.equal(idRow.earning, 150);
assert.equal(idRow.profit, 87, "150 − 63");
assert.equal(idRow.roi, 138.1, "(150 − 63) / 63 × 100");
assert.equal(idRow.country, "Indonesia");
assert.equal(idRow.isoCode, "ID");
assert.equal(idRow.subDomain, "puppy.petcins.com");
assert.equal(idRow.date, "2026-08-07");
assert.equal(idRow.status, "Active");

// Gabungan kedua sisi, bukan irisan: negara yang menghasilkan tanpa iklan dan negara yang
// diiklankan tanpa hasil justru dua keadaan yang paling perlu terlihat.
const myRow = countryRows["2026-08-07__puppy-petcins-com__MY"];
assert.equal(myRow.spending, 0);
assert.equal(myRow.roi, 0, "tanpa spend tidak ada yang bisa dibagi — 0, bukan Infinity");
assert.equal(myRow.status, "Inactive");
const sgRow = countryRows["2026-08-07__puppy-petcins-com__SG"];
assert.equal(sgRow.earning, 0);
assert.equal(sgRow.totalSpending, 26.25, "25 + 5%");
assert.equal(sgRow.roi, -100, "uang keluar tanpa satu pun revenue");
assert.equal(sgRow.status, "Review", "beriklan tanpa hasil — yang paling perlu dilihat");

// Impresi, klik, dan rincian sumber revenue per negara. Semuanya SUDAH datang bersama earning
// (`METRICS` di gam.js dikirim untuk laporan negara juga) dan dulu dibuang di collectCountryEarning
// — tanpa keduanya tabel per negara tidak bisa menyebut CPC/CTR/eCPM-nya sama sekali.
const trafficByCountry = new Map();
collectCountryEarning(
  [
    {
      keys: ["puppy.petcins.com", "ID", "Indonesia"],
      earning: 120,
      impressions: 800,
      clicks: 150,
      adx: 100,
      adsense: 0,
      adServer: 20,
    },
    {
      keys: ["puppy.petcins.com", "ID", "Indonesia"],
      earning: 30,
      impressions: 200,
      clicks: 50,
      adx: 30,
      adsense: 0,
      adServer: 0,
    },
    // Negara yang ditayangi tanpa satu pun klik: CPC-nya benar-benar 0, bukan "tidak tahu".
    { keys: ["puppy.petcins.com", "MY", "Malaysia"], earning: 0, impressions: 40, clicks: 0 },
  ],
  countryIdByName,
  trafficByCountry,
);
const idTraffic = trafficByCountry.get("s1").get("ID");
assert.equal(idTraffic.impressions, 1000, "impresi ikut dijumlahkan seperti earning");
assert.equal(idTraffic.clicks, 200);
assert.equal(idTraffic.adx, 130, "rincian sumber revenue juga, bukan cuma totalnya");
assert.equal(idTraffic.adServer, 20);

const trafficRows = Object.fromEntries(
  countryRoiRows(countrySubs.s1, trafficByCountry.get("s1"), spendByCountry.get("s1"), {
    now: runCountryAt,
    rate: 0.05,
  }),
);
const idTrafficRow = trafficRows["2026-08-07__puppy-petcins-com__ID"];
assert.equal(idTrafficRow.impressions, 1000);
assert.equal(idTrafficRow.clicks, 200);
assert.equal(idTrafficRow.ctr, 20, "200 / 1000 — dalam persen, seperti kolom ROI di sebelahnya");
assert.equal(idTrafficRow.cpc, 0.75, "150 / 200");
assert.equal(idTrafficRow.ecpm, 150, "150 / 1000 × 1000");
assert.equal(idTrafficRow.adxRevenue, 130);
assert.equal(
  idTrafficRow.adsenseRevenue,
  0,
  "akun ini memang tidak dilayani AdSense — 0, bukan '-'",
);

const myTrafficRow = trafficRows["2026-08-07__puppy-petcins-com__MY"];
assert.equal(myTrafficRow.clicks, 0);
assert.equal(myTrafficRow.cpc, 0, "klik yang benar-benar nol -> CPC 0");
assert.equal(myTrafficRow.ctr, 0);
assert.equal(myTrafficRow.ecpm, 0, "40 impresi tanpa revenue");

// Baris yang laporannya TIDAK membawa metriknya (GAM_METRICS diganti, laporan lama) tetap kosong
// — nol untuk impresi yang tidak pernah dilaporkan adalah klaim bahwa negara itu tidak ditayangi
// iklan, dan eCPM yang lahir dari pembagi karangan itu ikut berbohong.
assert.equal(idRow.impressions, null, "tidak dibawa laporan, bukan nol");
assert.equal(idRow.clicks, null);
assert.equal(idRow.ctr, null);
assert.equal(idRow.cpc, null, "tanpa jumlah klik, CPC tidak bisa dihitung maupun dikarang");
assert.equal(idRow.ecpm, null);
assert.equal(idRow.adxRevenue, null);

// Laporan negara yang GAGAL mengosongkan sisi trafik seluruhnya, sepola dengan earning/ROI-nya:
// run yang laporannya gagal tidak membawa impresi maupun klik, cuma sisi Meta-nya.
const [[, failedRow]] = countryRoiRows(
  countrySubs.s1,
  trafficByCountry.get("s1"),
  spendByCountry.get("s1"),
  { now: runCountryAt, rate: 0.05, earningKnown: false },
);
assert.equal(failedRow.earning, null);
assert.equal(failedRow.impressions, null);
assert.equal(failedRow.ctr, null);
assert.equal(failedRow.cpc, null);
assert.equal(failedRow.ecpm, null);
assert.equal(failedRow.adxRevenue, null);
assert.equal(failedRow.spending > 0, true, "sisi Meta tetap ada — itu yang masih diketahui");

assert.equal(countryRoiStatus(0, 0), "Inactive");
assert.equal(countryRoiStatus(10, 0), "Review");
assert.equal(countryRoiStatus(10, 5), "Active");

// Negara yang tidak dikenali sebagai kode ISO tetap jadi baris, hanya tanpa isoCode — datanya
// nyata, dan menyembunyikannya berarti earning-nya hilang tanpa jejak.
const oddEarning = new Map();
collectCountryEarning(
  [{ keys: ["puppy.petcins.com", "(Not applicable)", "Tidak diketahui"], earning: 5 }],
  countryIdByName,
  oddEarning,
);
const [[oddKey, oddRow]] = countryRoiRows(countrySubs.s1, oddEarning.get("s1"), new Map(), {
  now: runCountryAt,
});
assert.equal(oddKey, "2026-08-07__puppy-petcins-com__tidak-diketahui");
assert.equal(oddRow.isoCode, "", "bukan kode ISO, jadi tidak berpura-pura jadi kode");
assert.equal(oddRow.country, "Tidak diketahui");

// Dikelompokkan per user lewat PIC subdomain — itu satu-satunya yang menentukan panel siapa yang
// menampilkannya.
const countryUsers = {
  u1: { name: "Nurjaman" },
  u2: { name: "Muhajir" },
};
const grouped = countryRoiByUser(countrySubs, countryUsers, earningByCountry, spendByCountry, {
  now: runCountryAt,
  rate: 0.05,
});
assert.equal(grouped.entries.length, 1);
assert.equal(grouped.entries[0][0], "u1");
assert.equal(Object.keys(grouped.entries[0][1]).length, 3, "ID, MY, SG");
assert.deepEqual(grouped.unowned, [], "semua subdomain di run ini punya PIC");

// Dua hari yang digabung ke satu objek `countryRoi` tidak saling menimpa, dan hari berjalan
// membawa tandanya. Ini yang membuat filter periode di panel ROI per Negara punya lebih dari satu
// hari untuk disaring.
const rowsForDay = (day, partial) =>
  countryRoiByUser(countrySubs, countryUsers, earningByCountry, spendByCountry, {
    now: runCountryAt,
    day,
    rate: 0.05,
    partial,
  }).entries[0][1];
const bothDays = { ...rowsForDay("2026-08-07", false), ...rowsForDay("2026-08-08", true) };
assert.equal(Object.keys(bothDays).length, 6, "3 negara × 2 hari, tidak ada yang tertimpa");
assert.equal(bothDays["2026-08-07__puppy-petcins-com__ID"].partial, false, "hari selesai");
assert.equal(bothDays["2026-08-08__puppy-petcins-com__ID"].partial, true, "hari berjalan");

const orphan = countryRoiByUser(
  { s3: { name: "yatim.petcins.com", pic: "" } },
  countryUsers,
  new Map([["s3", new Map([["ID", { country: "Indonesia", earning: 10 }]])]]),
  new Map(),
);
assert.equal(orphan.entries.length, 0, "tanpa PIC tidak ada halaman yang bisa menampilkannya");
assert.deepEqual(orphan.unowned, ["yatim.petcins.com"]);

// Tarif ad tax datang dari halaman Settings; env dan 5% hanya jaring pengaman.
assert.equal(adTaxRate({ adTaxPercent: 11 }), 0.11, "Settings menang atas apa pun");
assert.equal(adTaxRate({ adTaxPercent: 0 }), 0, "0% itu keputusan, bukan nilai kosong");
assert.equal(adTaxRate({ adTaxPercent: "" }), 0.05, "field kosong bukan tarif 0");
assert.equal(adTaxRate(null), 0.05);
assert.equal(
  countryRoiRows(
    { name: "s" },
    new Map([["ID", { country: "Indonesia", earning: 210 }]]),
    new Map([["ID", 100]]),
    { rate: 0.2 },
  )[0][1].roi,
  75,
  "tarif 20%: (210 − 120) / 120",
);

console.log("sync-core ROI per negara tests ok");

// --- Riwayat baris ROI ------------------------------------------------------------------------
// dashboard/roiReports dulu berkunci id subdomain saja, jadi tiap sync menimpa baris yang sama dan
// tidak ada satu pun hari kemarin yang bisa dibuka lagi.

assert.equal(roiReportKey("-Nsub1", runCountryAt), "2026-08-07__-Nsub1");

const roiHistory = {
  "2026-08-05__-Nsub1": { roi: 10 },
  "2026-08-06__-Nsub1": { roi: 20 },
  "2026-08-07__-Nsub1": { roi: 30 },
  "2026-08-06__-Nsub2": { roi: 99 },
  "-Nsub3": { roi: 7 },
  catatan_manual: { roi: 1 },
};

// Pembandingnya baris hari lain, bukan baris hari ini: membandingkan hari ini dengan dirinya
// sendiri membuat fluktuasi selalu 0 setelah sync kedua di hari yang sama.
assert.equal(
  previousRoiReport(roiHistory, "-Nsub1", runCountryAt).roi,
  20,
  "kemarin, bukan hari ini",
);
assert.equal(previousRoiReport(roiHistory, "-Nsub2", runCountryAt).roi, 99);
assert.equal(
  previousRoiReport(roiHistory, "-Nsub3", runCountryAt).roi,
  7,
  "baris bentuk lama tetap jadi pembanding sync pertama setelah perubahan ini",
);
assert.equal(previousRoiReport(roiHistory, "-Nbaru", runCountryAt), null);
assert.equal(previousRoiReport({}, "-Nsub1", runCountryAt), null);

// Masa simpan: hanya kunci bertanggal yang disentuh — baris hasil input tangan berbentuk lain.
assert.deepEqual(
  expiredRoiReportKeys(roiHistory, runCountryAt, 1),
  ["2026-08-05__-Nsub1"],
  "yang lewat batas simpan saja; kunci asing (input tangan) tidak disentuh",
);
assert.deepEqual(
  expiredRoiReportKeys(roiHistory, runCountryAt, 90),
  [],
  "masih di dalam masa simpan",
);
// Tanpa batas (bawaan): tidak ada satu baris pun yang dibuang, sekalipun bertahun-tahun lalu — bukan
// cutoff "hari ini" yang justru menghapus segalanya. Riwayat harian ini satu-satunya sumber Kalender
// untuk bulan yang snapshot per sync-nya sudah lewat.
assert.deepEqual(expiredRoiReportKeys(roiHistory, runCountryAt, 0), [], "0 = simpan selamanya");
assert.deepEqual(
  expiredRoiReportKeys(roiHistory, runCountryAt, -1),
  [],
  "negatif ikut dibaca tanpa batas",
);

// --- Jendela baca: apa yang DIMINTA, bukan apa yang dibuang -------------------------------------
//
// Yang dijaga di sini bukan angkanya melainkan HUBUNGANNYA dengan pemangkas di atas: jendela dan
// batas pangkas harus menutupi seluruh node di antara keduanya. Bocor sedikit, baris yang lolos
// dari keduanya tidak akan pernah dibuang dan tidak akan pernah jadi pembanding — dan tidak ada
// satu pun yang berbunyi salah.
{
  const period = reportPeriod(runCountryAt);
  assert.equal(period.since, "2026-08-06", "prasyarat: hari paling awal yang dilaporkan run ini");
  assert.equal(
    roiReportWindowStart(period, 3),
    "2026-08-03",
    "jendela mulai `days` hari SEBELUM hari paling awal run ini, bukan sebelum hari ini",
  );
  assert.equal(roiReportWindowStart(period), "2026-07-23", "bawaan 14 hari");

  // Tanpa batas simpan — keadaan yang ter-deploy sekarang — yang masih perlu terlihat pemangkas
  // cuma baris BENTUK LAMA (berkunci id subdomain telanjang). Kunci push RTDB diawali "-", kunci
  // bertanggal diawali "2": "0" memisahkan keduanya, dan itu yang membuat `endBefore` bisa dipakai.
  assert.equal(roiReportPruneBefore(runCountryAt, 0), LEGACY_ROI_KEY_BOUND);
  assert.ok(LEGACY_ROI_KEY_BOUND > "-Nsub1", "kunci push jatuh SEBELUM batas, jadi ikut terbawa");
  assert.ok(LEGACY_ROI_KEY_BOUND < "2026-08-05__-Nsub1", "kunci bertanggal jatuh sesudahnya");

  // Dengan batas simpan, cutoff-nya sendiri yang jadi batas — dan ia harus SAMA PERSIS dengan yang
  // dihitung `expiredRoiReportKeys`, atau permintaannya menjawab lebih sedikit daripada yang
  // dibuang pemangkas dan baris kedaluwarsa tertinggal selamanya.
  assert.equal(roiReportPruneBefore(runCountryAt, 1), "2026-08-06");
  assert.deepEqual(
    expiredRoiReportKeys(roiHistory, runCountryAt, 1),
    expiredRoiReportKeys(
      Object.fromEntries(
        Object.entries(roiHistory).filter(([key]) => key < roiReportPruneBefore(runCountryAt, 1)),
      ),
      runCountryAt,
      1,
    ),
    "memangkas dari hasil permintaan berbatas = memangkas dari seluruh node",
  );

  // Snapshot: jendelanya HARI BERJALAN, dan di sini ia tidak mengubah apa pun — `previousRoiSnapshot`
  // memang cuma mencocokkan kunci berawalan hari itu.
  assert.equal(roiSnapshotWindowStart(period), period.running || period.settled);
  assert.equal(
    roiSnapshotPruneBefore(runCountryAt, 3),
    "2026-08-04",
    "batas pangkas snapshot sama dengan cutoff `expiredRoiSnapshotKeys`",
  );

  const before = process.env.ROI_PREVIOUS_LOOKBACK_DAYS;
  process.env.ROI_PREVIOUS_LOOKBACK_DAYS = "7";
  assert.equal(roiPreviousLookbackDays(), 7, "bisa ditimpa env");
  process.env.ROI_PREVIOUS_LOOKBACK_DAYS = "";
  assert.equal(roiPreviousLookbackDays(), 14, "kosong = bawaan, BUKAN nol");
  process.env.ROI_PREVIOUS_LOOKBACK_DAYS = "bukan angka";
  assert.equal(roiPreviousLookbackDays(), 14, "sampah = bawaan");
  if (before === undefined) delete process.env.ROI_PREVIOUS_LOOKBACK_DAYS;
  else process.env.ROI_PREVIOUS_LOOKBACK_DAYS = before;
}
{
  const before = process.env.ROI_HISTORY_DAYS;
  process.env.ROI_HISTORY_DAYS = "";
  assert.equal(roiHistoryDays(), 0, "kosong = simpan selamanya");
  process.env.ROI_HISTORY_DAYS = "bukan angka";
  assert.equal(roiHistoryDays(), 0, "nilai sampah tidak ditebak jadi batas");
  process.env.ROI_HISTORY_DAYS = "30";
  assert.equal(roiHistoryDays(), 30, "batas tetap bisa diminta");
  if (before === undefined) delete process.env.ROI_HISTORY_DAYS;
  else process.env.ROI_HISTORY_DAYS = before;
}

// Baris bertanggal setelah hari terakhir yang dilaporkan run ini. Sekarang hari berjalan termasuk
// yang dilaporkan, jadi yang tersaring tinggal tanggal masa depan: sisa run yang zonanya keliru,
// dan baris hari berjalan yang tertinggal setelah SYNC_INCLUDE_TODAY dimatikan.
assert.deepEqual(futureRoiReportKeys(roiHistory, "2026-08-06"), ["2026-08-07__-Nsub1"]);
assert.deepEqual(
  futureRoiReportKeys(roiHistory, "2026-08-07"),
  [],
  "hari yang dilaporkan ikut disimpan",
);

// Sisa hari berjalan: baris yang masih bertanda partial di hari yang sudah selesai. Hanya hari
// yang diminta, hanya yang bertanda, dan id-nya bisa memuat "_" maupun "-" (push key RTDB).
{
  const rows = {
    "2026-08-20__-OzFuW6mKUgnJp-a1_0v": { date: "2026-08-20", partial: true },
    "2026-08-20__-Nfinal": { date: "2026-08-20", partial: false },
    "2026-08-20__-Nlama": { date: "2026-08-20" },
    "2026-08-21__-Nbesok": { date: "2026-08-21", partial: true },
    "-Nbentuk-lama": { partial: true },
  };
  assert.deepEqual(leftoverRunningIds(rows, "2026-08-20"), ["-OzFuW6mKUgnJp-a1_0v"]);
  assert.deepEqual(leftoverRunningIds(rows, "2026-08-22"), []);
  assert.deepEqual(leftoverRunningIds(null, "2026-08-20"), []);
}

// Baris bentuk lama yang sudah digantikan baris bertanggal hari ini. Dibiarkan, ia akan tampil
// selamanya sebagai baris kedua untuk subdomain yang sama.
assert.deepEqual(supersededRoiReportKeys(roiHistory, ["-Nsub3", "-Nsub1", "-Nbaru"]), ["-Nsub3"]);

// Pembanding "Fluk." harus hari yang lebih AWAL, bukan sekadar "hari lain". Sejak satu run menulis
// hari selesai dan hari berjalan sekaligus, "hari lain" yang paling akhir untuk baris kemarin
// adalah baris hari ini — dan Fluk. kemarin akan mengukur perubahan ke arah masa depan.
const duaHari = {
  "2026-08-06__-Nsub1": { roi: 20 },
  "2026-08-07__-Nsub1": { roi: 30 },
  "2026-08-08__-Nsub1": { roi: 40 },
};
assert.equal(previousRoiReport(duaHari, "-Nsub1", "2026-08-07").roi, 20, "kemarin, bukan hari ini");
assert.equal(previousRoiReport(duaHari, "-Nsub1", "2026-08-08").roi, 30);
assert.equal(previousRoiReport(duaHari, "-Nsub1", "2026-08-06"), null, "tidak ada hari sebelumnya");

// --- Snapshot per sync (tabel "Laporan ROI Realtime") ------------------------------------------
//
// Baris harian ditimpa tiap sync, jadi jejak hari berjalan hilang: pukul 09:00 ROI 40%, pukul 15:00
// ROI 180%, dan yang pertama tidak tersimpan di mana pun. Snapshot berkunci tanggal + JAM.

// Jam sync-nya, dalam zona operasi. runCountryAt adalah 07 Agu 2026, 21:32 WIB.
assert.equal(roiSnapshotKey("-Nsub1", runCountryAt, runCountryAt), "2026-08-07T21-32__-Nsub1");
// Hari yang dilaporkan dan jam sync-nya dua hal berbeda: sync 00:10 WIB menulis snapshot hari itu
// juga, dan kuncinya harus tetap bertanggal hari yang dilaporkan.
assert.equal(
  roiSnapshotKey("-Nsub1", "2026-08-08", new Date("2026-08-07T17:10:00Z")),
  "2026-08-08T00-10__-Nsub1",
);
// ":" tidak dipakai — kuncinya ikut masuk URL REST RTDB apa adanya.
assert.ok(!roiSnapshotKey("-Nsub1", runCountryAt, runCountryAt).includes(":"));

const snapshotHistory = {
  "2026-08-05T23-00__-Nsub1": { roi: 1 },
  "2026-08-06T23-00__-Nsub1": { roi: 5 },
  "2026-08-07T09-00__-Nsub1": { roi: 10 },
  "2026-08-07T14-00__-Nsub1": { roi: 20 },
  "2026-08-07T14-00__-Nsub2": { roi: 99 },
  "2026-08-07__-Nsub1": { roi: 77 },
};

// Pembanding "Fluk." baris snapshot = snapshot terakhir di HARI YANG SAMA.
assert.equal(previousRoiSnapshot(snapshotHistory, "-Nsub1", "2026-08-07").roi, 20);
// Bukan snapshot kemarin: snapshot pertama sebuah hari baru berisi beberapa menit, dan
// membandingkannya dengan satu hari penuh kemarin melaporkan penurunan raksasa tiap tengah malam.
assert.equal(previousRoiSnapshot(snapshotHistory, "-Nsub1", "2026-08-08"), null);
assert.equal(previousRoiSnapshot(snapshotHistory, "-Nsub2", "2026-08-07").roi, 99);
assert.equal(previousRoiSnapshot(snapshotHistory, "-Nbaru", "2026-08-07"), null);
// Baris harian (tanpa jam) bukan snapshot dan tidak pernah jadi pembandingnya.
assert.equal(
  previousRoiSnapshot({ "2026-08-07__-Nsub1": { roi: 77 } }, "-Nsub1", "2026-08-07"),
  null,
);

// Masa simpan snapshot dihitung terpisah dari riwayat harian — dan hanya kunci berbentuk snapshot
// yang disentuh, jadi baris harian di pohon yang sama tidak pernah ikut terhapus.
assert.deepEqual(
  expiredRoiSnapshotKeys(snapshotHistory, runCountryAt, 1),
  ["2026-08-05T23-00__-Nsub1"],
  "batasnya sama dengan riwayat harian: hari ini dan `days` hari sebelumnya disimpan",
);
assert.deepEqual(expiredRoiSnapshotKeys(snapshotHistory, runCountryAt, 3), []);

console.log("sync-core snapshot ROI tests ok");

// --- Hari yang dilaporkan, dalam zona operasi --------------------------------------------------
//
// Tiga jam yang dulu menghasilkan tiga tanggal berbeda untuk data yang sama. Sync jam 07:35 WIB
// dan jam 06:50 WIB berada di sisi tengah malam UTC yang berlawanan, jadi kunci barisnya dulu
// berbeda satu hari — dan kolom Date di Overview berganti hari jam tujuh pagi, bukan tengah malam.

const pagi = new Date("2026-08-08T00:35:00Z"); // 08 Agu 07:35 WIB
const subuh = new Date("2026-08-07T23:50:00Z"); // 08 Agu 06:50 WIB
const sore = new Date("2026-08-08T08:00:00Z"); // 08 Agu 15:00 WIB

assert.equal(zonedDateKey(pagi), "2026-08-08");
assert.equal(
  zonedDateKey(subuh),
  "2026-08-08",
  "06:50 WIB masih tanggal 8, walau UTC-nya tanggal 7",
);
assert.equal(zonedClock(pagi), "07:35");
assert.equal(zonedClock(subuh), "06:50");
assert.equal(shiftDateKey("2026-08-01", -1), "2026-07-31", "menyeberang bulan");

for (const [label, at] of [
  ["pagi", pagi],
  ["subuh", subuh],
  ["sore", sore],
]) {
  assert.equal(reportDayKey(at), "2026-08-07", `hari yang dilaporkan sama sepanjang ${label}`);
}

const period = reportPeriod(pagi);
assert.equal(period.key, "2026-08-07", "hari acuan dashboard tetap hari yang sudah selesai");
assert.equal(period.settled, "2026-08-07");
assert.equal(period.running, "2026-08-08", "hari berjalan ikut dilaporkan");
// Sisi Meta diminta RENTANG yang sama persis dengan sisi GAM. Inilah perbaikannya: sebelumnya Meta
// dipanggil dengan date_preset=today sementara GAM melaporkan kemarin, dan ROI-nya membandingkan
// pendapatan sehari penuh dengan spend yang baru berjalan beberapa jam. Sekarang keduanya meminta
// dua hari yang sama, dan tiap baris tetap dipecah per hari sebelum ROI-nya dihitung.
assert.equal(period.since, "2026-08-07");
assert.equal(period.until, "2026-08-08");
assert.deepEqual(period.keys, ["2026-08-07", "2026-08-08"], "satu baris per hari, urut");
assert.deepEqual(period.gamRange.startDate, { year: 2026, month: 8, day: 7 });
assert.deepEqual(period.gamRange.endDate, { year: 2026, month: 8, day: 8 });
// Laporan yang hasilnya satu angka tanpa kolom tanggal (kolom Earning di /adsense-accounts) memakai
// rentang yang berhenti di hari selesai — kalau tidak, angkanya menjumlahkan dua hari lalu diberi
// label tanggal kemarin.
assert.deepEqual(period.settledRange.endDate, { year: 2026, month: 8, day: 7 });
assert.deepEqual(reportRange(pagi).endDate, { year: 2026, month: 8, day: 7 });

// Dimatikan, run kembali melaporkan hari selesai saja — dan `keys` ikut menyusut, jadi tidak ada
// hari berjalan yang ditulis diam-diam.
process.env.SYNC_INCLUDE_TODAY = "0";
const settledPeriod = reportPeriod(pagi);
assert.equal(settledPeriod.running, "");
assert.equal(settledPeriod.until, "2026-08-07");
assert.deepEqual(settledPeriod.keys, ["2026-08-07"]);
delete process.env.SYNC_INCLUDE_TODAY;

// GAM_RANGE_DAYS memundurkan awal rentang dari hari SELESAI, bukan dari hari berjalan: mengisi
// ulang tiga hari ke belakang tidak boleh berarti kehilangan salah satunya.
process.env.GAM_RANGE_DAYS = "3";
assert.deepEqual(reportPeriod(pagi).keys, ["2026-08-05", "2026-08-06", "2026-08-07", "2026-08-08"]);
// ...tapi kolom yang hasilnya SATU angka tidak ikut melebar. `settledRange` melebar bersamanya —
// itu gunanya — sementara `settledDayRange` tetap satu hari: kolom Earning di /gam-accounts diberi
// label `lastSyncReportDate` (hari selesai), dan kolom Status memutuskan "Iklan Belum Tayang" dari
// impresinya. Lewat jendela tiga hari, akun yang berhenti tayang dua hari lalu masih berbunyi
// "Ready" karena satu impresi dari hari pertama rentang itu.
const lebar = reportPeriod(pagi);
assert.deepEqual(lebar.settledRange.startDate, { year: 2026, month: 8, day: 5 });
assert.deepEqual(lebar.settledDayRange.startDate, { year: 2026, month: 8, day: 7 });
assert.deepEqual(lebar.settledDayRange.endDate, { year: 2026, month: 8, day: 7 });
delete process.env.GAM_RANGE_DAYS;

assert.deepEqual(dateKeysBetween("2026-07-30", "2026-08-02"), [
  "2026-07-30",
  "2026-07-31",
  "2026-08-01",
  "2026-08-02",
]);
assert.deepEqual(
  dateKeysBetween("2026-08-02", "2026-08-01"),
  [],
  "rentang terbalik bukan 400 hari",
);

// Baris memakai tanggal datanya, bukan tanggal sync-nya.
const aligned = roiReportUpdate({ name: "s" }, { earning: 100, impressions: 10, clicks: 2 }, 50, {
  now: pagi,
  day: period.key,
});
assert.equal(aligned.date, "2026-08-07", "kolom Date = hari data");
assert.equal(aligned.time, "07:35", "jam sync, dalam WIB");
assert.equal(aligned.partial, false, "hari yang sudah selesai — angkanya final");
assert.equal(roiReportKey("-Nsub1", period.key), "2026-08-07__-Nsub1");

// Baris hari berjalan: sama rumusnya, hanya ditandai. Tandanya ditulis ke barisnya sendiri, bukan
// disimpulkan dari tanggal di sisi UI — "hari ini" di browser yang zonanya bukan WIB adalah hari
// yang berbeda, dan baris yang sudah final tidak boleh berubah status karena tab dibiarkan terbuka.
const berjalan = roiReportUpdate({ name: "s" }, { earning: 40, impressions: 4, clicks: 1 }, 30, {
  now: pagi,
  day: period.running,
  partial: true,
});
assert.equal(berjalan.date, "2026-08-08");
assert.equal(berjalan.partial, true);
assert.equal(berjalan.roi, 26.98, "(40 − 31.5) / 31.5 × 100 — rumus yang sama, hari yang sama");

// Kedua sisi baris hari berjalan berasal dari hari yang sama. Yang dulu salah bukan "hari ini",
// melainkan mencampur dua hari dalam satu baris.
assert.equal(runningDayKey(pagi), "2026-08-08");
assert.equal(runningDayKey(subuh), "2026-08-08", "06:50 WIB masih hari yang sama");

// --- Satu laporan rentang, dipecah per hari ----------------------------------------------------
//
// Hari selesai dan hari berjalan datang dari SATU laporan GAM dengan DATE sebagai dimensi pertama.
// Satu laporan per hari akan berarti create/run/poll/delete dua kali per network, dan run penuh
// sudah menghabiskan menit dari batas 9 menit Cloud Functions.

const perHari = gamRowsByDay([
  { keys: ["20260807", "puppy.petcins.com"], earning: 100, impressions: 10, clicks: 2 },
  { keys: ["20260808", "puppy.petcins.com"], earning: 40, impressions: 4, clicks: 1 },
  { keys: ["20260808", "kitty.petcins.com"], earning: 7, impressions: 1, clicks: 0 },
  { keys: ["", "tanpa tanggal"], earning: 999 },
]);
assert.deepEqual([...perHari.keys()], ["2026-08-07", "2026-08-08"], "baris tanpa tanggal dilewati");
assert.equal(perHari.get("2026-08-07").length, 1);
assert.equal(perHari.get("2026-08-08").length, 2);
// Kunci tanggalnya dilepas: pengumpul di hilir melihat bentuk yang sama persis seperti waktu
// rentangnya masih satu hari, jadi pencocokan nama site dan collectCountryEarning tidak berubah.
assert.deepEqual(perHari.get("2026-08-07")[0].keys, ["puppy.petcins.com"]);
assert.equal(perHari.get("2026-08-07")[0].key, "puppy.petcins.com");
assert.equal(perHari.get("2026-08-07")[0].earning, 100, "angkanya tidak ikut disentuh");

// Baris negara: DATE dilepas, [site, kode, nama] tersisa — persis yang diharapkan
// collectCountryEarning, jadi laporannya bisa melebar tanpa mengubah pengumpulnya.
const negaraPerHari = gamRowsByDay([
  { keys: ["20260808", "puppy.petcins.com", "ID", "Indonesia"], earning: 12 },
]);
assert.deepEqual(negaraPerHari.get("2026-08-08")[0].keys, ["puppy.petcins.com", "ID", "Indonesia"]);

// Sisi Meta dipecah lewat `date` yang dibawa `time_increment=1`.
const metaPerHari = metaRowsByDay([
  { date: "2026-08-07", name: "A", spend: 30 },
  { date: "2026-08-08", name: "A", spend: 12 },
  { date: "", name: "B", spend: 5 },
]);
assert.deepEqual([...metaPerHari.keys()], ["2026-08-07", "2026-08-08"]);
assert.equal(metaPerHari.get("2026-08-08")[0].spend, 12);

console.log("sync-core hari laporan tests ok");

// --- Laporan GAM yang gagal bukan earning nol --------------------------------------------------
//
// 8 Agu 2026: laporan satu network gagal, barisnya tetap ditulis dengan earning 0, dan enam
// subdomain tampil "ROI -100%" — persis seperti subdomain yang beriklan tanpa hasil. 2,1 juta
// pendapatan hilang dari dashboard di balik angka yang tampak wajar.

const gagal = roiReportUpdate({ name: "s" }, null, 50, { adTaxRate: 0.05, day: "2026-08-07" });
assert.equal("earning" in gagal, false, "tidak ada earning yang dikarang");
assert.equal("roi" in gagal, false, "tanpa earning tidak ada ROI");
assert.equal("profit" in gagal, false);
assert.equal(gagal.gamMissing, true, "barisnya menyebut kenapa kolomnya kosong");
assert.equal(gagal.spending, 50, "sisi spend tetap ditulis — itu memang diketahui");
assert.equal(gagal.metaMissing, null, "yang hilang earning-nya, bukan spend-nya");
assert.equal(gagal.adTax, 2.5);

// Kalau sync sebelumnya di hari yang sama sudah membawa earning, angka itu dipakai lagi supaya
// ROI-nya tetap terhitung — dan barisnya ditandai sebagai data bawaan, bukan data run ini.
const bawaan = roiReportUpdate({ name: "s" }, null, 100, {
  adTaxRate: 0.05,
  day: "2026-08-07",
  existing: { earning: 210 },
});
assert.equal("earning" in bawaan, false, "kolom earning tidak ditimpa, yang lama dibiarkan");
assert.equal(bawaan.roi, 100, "(210-105)/105*100");
assert.equal(bawaan.gamStale, true);
assert.equal(bawaan.gamMissing, null, "bukan hilang — hanya tidak diperbarui run ini");

// Laporan yang berhasil membersihkan kedua tanda itu, kalau tidak ikon peringatannya menempel.
assert.equal(aligned.gamMissing, null);
assert.equal(aligned.gamStale, null);

// Earning 0 yang memang dilaporkan tetap 0 — nol yang nyata berbeda dari nol yang dikarang.
const nolAsli = roiReportUpdate({ name: "s" }, { earning: 0, impressions: 0, clicks: 0 }, 50, {
  adTaxRate: 0.05,
});
assert.equal(nolAsli.earning, 0);
assert.equal(nolAsli.roi, -100, "beriklan tanpa hasil: -100% yang jujur");

// Sisi negara mengikuti aturan yang sama.
const negaraGagal = countryRoiRows(
  { name: "sub.a", pic: "PIC" },
  new Map(),
  new Map([["ID", 100]]),
  { rate: 0.05, day: "2026-08-07", earningKnown: false },
);
assert.equal(negaraGagal.length, 1);
assert.equal(negaraGagal[0][1].earning, null);
assert.equal(negaraGagal[0][1].roi, null);
assert.equal(
  negaraGagal[0][1].status,
  "Unknown",
  "bukan Review — belum tentu ia tidak menghasilkan",
);
assert.equal(negaraGagal[0][1].spending, 100, "spend-nya diketahui, jadi tetap ditulis");
assert.equal(negaraGagal[0][1].date, "2026-08-07");

// subDomains: kolom uangnya tidak disentuh saat laporannya gagal.
const tanpaLaporan = subdomainUpdate(null);
assert.equal("revenueToday" in tanpaLaporan, false);
assert.equal(tanpaLaporan.syncStatus, true, "sync-nya memang jalan, hanya laporannya yang gagal");
assert.equal(subdomainUpdate({ earning: 100, impressions: 1000, clicks: 5 }).ecpm, 100);

console.log("sync-core earning tidak diketahui tests ok");

// --- Daftar isu yang dibaca ikon alert ---------------------------------------------------------

const issues = syncIssuesUpdate("ROI subdomain", [
  {
    source: "Laporan earning GAM",
    target: "masseffectstore.com",
    message: "GAM 500",
    impact: "Earning kosong.",
  },
]);
assert.equal(issues.count, 1);
assert.equal(issues.items.i0.target, "masseffectstore.com");
assert.equal(issues.items.i0.message, "GAM 500");
// Cabang yang bersih tetap ditulis: tanpa itu ikon alert menyala selamanya setelah satu kegagalan
// yang sudah pulih. RTDB membuang array kosong, jadi `count` yang menjadi jawabannya.
const bersih = syncIssuesUpdate("ROI subdomain", []);
assert.equal(bersih.count, 0);
assert.deepEqual(bersih.items, {});

console.log("sync-core isu sync tests ok");

// --- Retry akun yang gagal ---------------------------------------------------------------------

const t0 = new Date("2026-08-21T00:00:00.000Z");
// Benih dari daftar error: attempts 0, jatuh tempo 1 menit lagi. Akun tanpa id dilewati.
const seed = retrySeed(
  [
    { id: "a", name: "Akun A", message: "GAM 500" },
    { id: "b", name: "Akun B", message: "timeout" },
    { message: "tanpa id" },
  ],
  t0,
);
assert.deepEqual(Object.keys(seed), ["a", "b"]);
assert.equal(seed.a.attempts, 0);
assert.equal(seed.a.nextAt, new Date("2026-08-21T00:01:00.000Z").toISOString());

// Belum jatuh tempo -> tidak diambil; sudah lewat -> diambil.
assert.deepEqual(dueRetries(seed, t0), [], "nextAt 1 menit lagi, belum jatuh tempo");
const t1 = new Date("2026-08-21T00:01:00.000Z");
assert.deepEqual(
  dueRetries(seed, t1).map((d) => d.id),
  ["a", "b"],
);

// Pulih -> node dihapus (null). Masih gagal -> attempts naik, jeda tumbuh 1->2 menit, pesan diperbarui.
assert.equal(retryOutcome(seed.a, false, "", t1), null, "pulih dihapus dari antrean");
const after1 = retryOutcome(seed.a, true, "GAM 503", t1);
assert.equal(after1.attempts, 1);
assert.equal(after1.message, "GAM 503");
assert.equal(
  after1.nextAt,
  new Date("2026-08-21T00:03:00.000Z").toISOString(),
  "jeda ke-2 = 2 menit",
);

// Jatah habis di percobaan ke-5: dari attempts 4 yang masih gagal -> null (berhenti mencoba).
const entry = { name: "Akun A", message: "x", attempts: 4, nextAt: t0.toISOString() };
assert.equal(
  retryOutcome(entry, true, "masih gagal", t1),
  null,
  `berhenti di ${MAX_SYNC_RETRIES}×`,
);
// attempts >= maks tidak lagi jatuh tempo walau waktunya lewat.
assert.deepEqual(
  dueRetries({ z: { attempts: MAX_SYNC_RETRIES, nextAt: t0.toISOString() } }, t1),
  [],
);
// Benih kosong (semua pulih) menghasilkan objek kosong -> pemanggil menuliskannya sebagai null.
assert.deepEqual(retrySeed([], t0), {});

console.log("sync-core retry tests ok");
// Penanda "sedang dicoba lagi" — yang dibaca indikator di topbar.
const retryBerjalan = retryRunning(
  { name: "fitness.stylefemale.com", attempts: 1, nextAt: "" },
  t0,
);
assert.equal(retryBerjalan.running, true);
assert.equal(retryBerjalan.startedAt, t0.toISOString());
// Penandanya TIDAK ikut ke percobaan berikutnya: yang terbawa akan membuat indikatornya berputar
// selamanya untuk antrean yang sebenarnya sedang menunggu.
const sesudah = retryOutcome(retryBerjalan, true, "masih gagal", t1);
assert.equal("running" in sesudah, false);
assert.equal("startedAt" in sesudah, false);

console.log("sync-core penanda retry tests ok");

console.log("sync-core riwayat ROI tests ok");

// --- Status & log sync otomatis ----------------------------------------------------------------
// Sync yang jalan sendiri tidak punya siapa pun yang menonton hasilnya, jadi hasilnya ditulis.

assert.equal(syncRunKey(runAt), "20260807143210", "sortable sebagai teks");

// Hitung mundur di topbar berasal dari sini. Cron biasa sengaja tidak ditebak: tebakan yang
// meleset membuat hitung mundurnya berbohong.
assert.equal(scheduleIntervalMs("every 60 minutes"), 3_600_000);
assert.equal(scheduleIntervalMs("every 1 hours"), 3_600_000);
assert.equal(scheduleIntervalMs("every 15 minutes"), 900_000);
assert.equal(scheduleIntervalMs("EVERY 4 HOURS"), 14_400_000);
assert.equal(scheduleIntervalMs("0 */2 * * *"), null, "cron tidak diurai");
assert.equal(scheduleIntervalMs("every 0 minutes"), null);
assert.equal(scheduleIntervalMs(""), null);

const okRun = syncRunEntry(
  [
    { name: "GAM accounts", ok: true, detail: "2 ok, 0 gagal" },
    { name: "ROI", ok: true, detail: "5 subdomain terisi." },
  ],
  runAt,
  new Date("2026-08-07T14:34:40.000Z"),
);
assert.equal(okRun.ok, true);
assert.equal(okRun.failed, 0);
assert.equal(okRun.durationSec, 150);
assert.equal(okRun.startedAt, "2026-08-07T14:32:10.000Z");
assert.match(okRun.summary, /GAM accounts 2 ok/);

// Yang gagal disebut namanya: "sync gagal" saja tidak memberi tahu apa yang harus diperbaiki.
const failedRun = syncRunEntry(
  [
    { name: "GAM accounts", ok: true, detail: "2 ok" },
    { name: "Meta accounts", ok: false, detail: "token kadaluarsa" },
  ],
  runAt,
  new Date("2026-08-07T14:33:10.000Z"),
);
assert.equal(failedRun.ok, false);
assert.equal(failedRun.failed, 1);
assert.equal(failedRun.summary, "1 dari 2 tahap gagal: Meta accounts.");
assert.equal(failedRun.stages[1].detail, "token kadaluarsa", "alasannya ikut tersimpan");

// nextRunAt untuk bentuk interval dihitung dari waktu SELESAI. "every 60 minutes" adalah bentuk
// interval App Engine cron — "60 menit setelah run sebelumnya selesai", bukan jadwal jam dinding.
// Terbaca dari data produksi: jarak antar-selesai selalu 59-60 menit, jarak antar-mulai 62-77 menit
// (sepanjang durasi run). Dihitung dari waktu mulai, hitung mundurnya habis 2-8 menit terlalu cepat
// dan topbar menulis "jadwal terlewat" tiap jam untuk jadwal yang tidak terlewat.
const status = syncStatusUpdate(okRun, "every 60 minutes", runAt);
assert.equal(status.running, false);
assert.equal(status.lastOk, true);
assert.equal(status.nextRunAt, "2026-08-07T15:34:40.000Z", "selesai (14:34:40) + 60 menit");
assert.equal(status.lastDurationSec, 150);

// Jadwal produksi: cron jam dinding. Selesai 14:34:40 UTC = 21:34 WIB, tembakan berikutnya menit
// ke-5 jam 22 WIB = 15:05 UTC. Ini yang membuat deploy tidak lagi menggeser jadwal — dan kalau
// nextRunAt ikut melar seperti dulu, topbar akan menulis "terlewat" untuk jadwal yang sehat.
assert.equal(syncStatusUpdate(okRun, "5 * * * *", runAt).nextRunAt, "2026-08-07T15:05:00.000Z");

// Bentuk cron yang tidak bisa dihitung tanpa parser penuh tidak berpura-pura tahu.
assert.equal(syncStatusUpdate(okRun, "0 1-5 * * *", runAt).nextRunAt, "");
assert.equal(syncStatusUpdate(okRun, "kapan saja", runAt).nextRunAt, "");

// --- nextRunAfter -----------------------------------------------------------------------------
const at = (iso) => new Date(iso);
const iso = (date) => (date ? date.toISOString() : null);

// Cron dibaca di zona operasi (Asia/Jakarta, +07:00), bukan UTC.
assert.equal(
  iso(nextRunAfter("5 * * * *", at("2026-08-07T14:34:40Z"))),
  "2026-08-07T15:05:00.000Z",
);
// Menit yang sedang berjalan sudah lewat tembakannya — yang berikutnya sejam lagi, bukan detik ini.
assert.equal(
  iso(nextRunAfter("5 * * * *", at("2026-08-07T15:05:00Z"))),
  "2026-08-07T16:05:00.000Z",
);
// Beberapa menit dalam satu jam, dan step pada field jam (23:00 WIB = 16:00 UTC).
assert.equal(
  iso(nextRunAfter("0,30 * * * *", at("2026-08-07T15:05:00Z"))),
  "2026-08-07T15:30:00.000Z",
);
assert.equal(
  iso(nextRunAfter("0 */2 * * *", at("2026-08-07T15:05:00Z"))),
  "2026-08-07T17:00:00.000Z",
);
// Interval tetap dihitung dari titik yang diberikan.
assert.equal(
  iso(nextRunAfter("every 15 minutes", at("2026-08-07T15:05:00Z"))),
  "2026-08-07T15:20:00.000Z",
);
// Yang lebih jarang dari harian, dan bentuk yang tidak dikenali: null, bukan tebakan.
assert.equal(nextRunAfter("5 * * * 1", at("2026-08-07T15:05:00Z")), null);
assert.equal(nextRunAfter("5 * 1 * *", at("2026-08-07T15:05:00Z")), null);
assert.equal(nextRunAfter("60 * * * *", at("2026-08-07T15:05:00Z")), null);
assert.equal(nextRunAfter("", at("2026-08-07T15:05:00Z")), null);

// Log dipangkas seperti riwayat lain; kunci asing tidak disentuh.
const runs = {
  20260807100000: {},
  20260807110000: {},
  20260807120000: {},
  catatan_manual: {},
};
assert.deepEqual(excessSyncRunKeys(runs, 2), ["20260807100000"]);
assert.deepEqual(excessSyncRunKeys(runs, 10), []);

console.log("sync-core log sync tests ok");

// Laporan negara AdSense: satu dimensi (default COUNTRY_CODE) supaya tidak kena 500, dan bisa
// dimatikan lewat env kosong tanpa jadi isu sync.
delete process.env.ADSENSE_COUNTRY_DIMENSIONS;
assert.deepEqual(adsenseCountryDimensions(), ["COUNTRY_CODE"]);
process.env.ADSENSE_COUNTRY_DIMENSIONS = "";
assert.deepEqual(adsenseCountryDimensions(), []);
process.env.ADSENSE_COUNTRY_DIMENSIONS = "COUNTRY_NAME";
assert.deepEqual(adsenseCountryDimensions(), ["COUNTRY_NAME"]);
delete process.env.ADSENSE_COUNTRY_DIMENSIONS;
console.log("adsense country dimensions tests ok");

// --- Baris campaign yang sudah tidak punya sisi Meta -------------------------------------------

// TBZ 1247 berpindah pemilik dari Nurjaman ke Lightman. Kunci dibangun dari SELURUH adAccounts,
// jadi akun itu hanya muncul di daftar pemilik barunya.
const campaignAccounts = {
  a1: { actId: "act_951641072800026", name: "TBZ 1233", userOwner: "Nurjaman" },
  a2: { actId: "act_250080654510501", name: "TBZ 1247", userOwner: "Lightman" },
  a3: {
    actId: "act_111",
    name: "TBZ 0001",
    userOwner: "Nurjaman",
    deletedAt: "2026-08-07T00:00:00Z",
  },
  a4: { actId: "", name: "Belum dihubungkan", userOwner: "Nurjaman" },
};
const campaignUserIds = new Map([
  ["nurjaman", "u-nur"],
  ["lightman", "u-light"],
]);
const ownerKeys = accountKeysByOwner(campaignAccounts, campaignUserIds);
assert.deepEqual(
  [...(ownerKeys.get("u-nur") || [])].sort(),
  ["id:act_951641072800026", "name:tbz 1233"],
  "akun yang dihapus dan akun tanpa actId tidak ikut jadi kunci",
);
assert.deepEqual([...(ownerKeys.get("u-light") || [])].sort(), [
  "id:act_250080654510501",
  "name:tbz 1247",
]);
assert.deepEqual(accountKeys(campaignAccounts.a1), ["id:act_951641072800026", "name:tbz 1233"]);

const nurKeys = ownerKeys.get("u-nur");
assert.equal(
  campaignRowBelongsTo({ adAccount: "act_951641072800026", account: "TBZ 1233" }, nurKeys),
  true,
);
assert.equal(
  campaignRowBelongsTo({ adAccount: "act_250080654510501", account: "TBZ 1247" }, nurKeys),
  false,
  "akun yang sudah pindah pemilik bukan lagi campaign user ini",
);
assert.equal(
  campaignRowBelongsTo({ account: "TBZ 1233" }, nurKeys),
  true,
  "baris lama tanpa adAccount dicocokkan lewat namanya",
);
assert.equal(
  campaignRowBelongsTo({ campaign: "tanpa jejak akun" }, nurKeys),
  true,
  "yang tidak bisa dibuktikan asing tidak dibuang",
);

const goneNow = new Date("2026-08-17T10:00:00Z");
const gone = missingCampaignRow(
  { campaign: "kBCD-06", status: "Aktif", configuredStatus: "ACTIVE", subDomain: "a.example" },
  goneNow,
);
assert.equal(gone.status, CAMPAIGN_GONE_STATUS, "status terakhir tidak boleh membeku di Aktif");
assert.equal(gone.configuredStatus, "", "saklar tanpa lawan bicara bukan saklar mati");
assert.equal(gone.subDomain, "a.example", "pemetaannya tetap dibawa");
assert.equal(gone.missingSince, goneNow.toISOString());
assert.equal(
  missingCampaignRow(gone, new Date("2026-08-19T10:00:00Z")).missingSince,
  goneNow.toISOString(),
  "stempel hilang tidak digeser tiap kali diperiksa ulang",
);
assert.equal(missingCampaignExpired(gone, new Date("2026-08-20T10:00:00Z")), false);
assert.equal(missingCampaignExpired(gone, new Date("2026-08-25T10:00:00Z")), true);
assert.equal(
  missingCampaignExpired({ campaign: "masih ada" }, new Date("2026-09-01T00:00:00Z")),
  false,
  "baris yang tidak ditandai hilang tidak punya masa simpan",
);

// Penyegaran dua menitan: hanya kolom yang berubah, dan hanya untuk akun yang benar-benar dibaca.
const refreshUser = {
  campaigns: [
    {
      campaign: "A",
      campaignId: "1",
      adAccount: "act_1",
      status: "Aktif",
      configuredStatus: "ACTIVE",
      dailyBudget: 50000,
      statusAppliedAt: "2026-08-17T09:00:00.000Z",
    },
    {
      campaign: "B",
      campaignId: "2",
      adAccount: "act_1",
      status: "Aktif",
      configuredStatus: "ACTIVE",
    },
    {
      campaign: "C",
      campaignId: "3",
      adAccount: "act_1",
      status: "Aktif",
      configuredStatus: "ACTIVE",
    },
    {
      campaign: "D",
      campaignId: "4",
      adAccount: "act_2",
      status: "Aktif",
      configuredStatus: "ACTIVE",
    },
  ],
};
const live = new Map([
  [
    "1",
    { id: "1", status: "PAUSED", effectiveStatus: "PAUSED", startTime: "", dailyBudget: 50000 },
  ],
  ["3", { id: "3", status: "ACTIVE", effectiveStatus: "ACTIVE", startTime: "", dailyBudget: null }],
]);
const refreshed = campaignStatusRefresh(refreshUser, live, new Set(["id:act_1"]), goneNow);
assert.deepEqual(
  refreshed,
  {
    "campaigns/0/status": "Tidak aktif",
    "campaigns/0/configuredStatus": "PAUSED",
    "campaigns/0/statusAppliedAt": null,
    "campaigns/1/status": CAMPAIGN_GONE_STATUS,
    "campaigns/1/configuredStatus": "",
    "campaigns/1/metaMissing": true,
    "campaigns/1/missingSince": goneNow.toISOString(),
  },
  "C tidak berubah, D akunnya tidak dibaca run ini",
);
assert.deepEqual(
  campaignStatusRefresh(refreshUser, new Map(), new Set(), goneNow),
  {},
  "tidak ada akun yang terbaca berarti tidak ada kabar apa pun — bukan semua campaign hilang",
);
const returned = campaignStatusRefresh(
  {
    campaigns: {
      k9: {
        campaign: "A",
        campaignId: "1",
        adAccount: "act_1",
        status: CAMPAIGN_GONE_STATUS,
        configuredStatus: "",
        metaMissing: true,
        missingSince: "2026-08-10T00:00:00.000Z",
      },
    },
  },
  live,
  new Set(["id:act_1"]),
  goneNow,
);
assert.deepEqual(
  returned,
  {
    "campaigns/k9/status": "Tidak aktif",
    "campaigns/k9/configuredStatus": "PAUSED",
    "campaigns/k9/dailyBudget": 50000,
    "campaigns/k9/metaMissing": null,
    "campaigns/k9/missingSince": null,
  },
  "campaign yang dikeluarkan lagi dari arsip kehilangan tandanya, bukan menyandangnya selamanya",
);

console.log("sync-core campaign row tests ok");

// permanentAccountError: cuma izin akun yang dicabut yang boleh memicu auto-disable — bukan token
// kedaluwarsa, rate limit, atau kegagalan jaringan (yang pulih dengan retry).
assert.ok(
  permanentAccountError(
    "Ad account owner has NOT grant ads_management or ads_read permission (#200)",
  ),
);
assert.ok(permanentAccountError("(#200) Requires ads_management permission to manage the object"));
assert.ok(!permanentAccountError("Error validating access token: Session has expired (#190)"));
assert.ok(!permanentAccountError("(#17) User request limit reached"));
assert.ok(!permanentAccountError("fetch failed"));
assert.ok(!permanentAccountError(""));

console.log("sync-core permanentAccountError tests ok");

// --- Belanja ad account yang tidak terbaca lagi ------------------------------------------------
//
// Akun yang dimatikan dilewati sync, dan rentang yang ditulis ulang kehilangan belanjanya. Yang
// mengembalikannya riwayat campaign yang ditulis saat akunnya masih terbaca.
{
  const actIds = unreadableActIds({
    a: { actId: "act_dead", syncDisabled: "Nonaktif" },
    b: { actId: "act_gone", deletedAt: "2026-08-07T00:00:00Z" },
    c: { actId: "act_live" },
    // Didaftarkan ulang: baris lama terarsip, baris baru terbaca — belanjanya sudah dibaca langsung.
    d: { actId: "act_again", deletedAt: "2026-08-01T00:00:00Z" },
    e: { actId: "act_again" },
    f: { name: "tanpa actId", syncDisabled: "Nonaktif" },
  });
  assert.deepEqual([...actIds].sort(), ["act_dead", "act_gone"]);

  const row = (date, adAccount, campaign, spend, results = 0) => ({
    date,
    adAccount,
    campaign,
    account: "LINCAH 1240",
    spend,
    results,
  });
  const rows = unreadableSpendRows(
    [
      {
        "2026-08-21__dead__1": row("2026-08-21", "act_dead", "K4RY-01 SEA", 68, 4),
        "2026-08-22__dead__1": row("2026-08-22", "act_dead", "K4RY-01 SEA", 89378, 9070),
        // Akun yang masih terbaca: belanjanya sudah masuk dari Meta, tidak boleh dua kali.
        "2026-08-22__live__2": row("2026-08-22", "act_live", "JsR1-01", 5000),
        // Nol dan di luar rentang tidak jadi baris.
        "2026-08-23__dead__1": row("2026-08-23", "act_dead", "K4RY-01 SEA", 0),
        "2026-08-30__dead__1": row("2026-08-30", "act_dead", "K4RY-01 SEA", 1000),
      },
      // Akun yang berpindah pemilik meninggalkan kunci yang sama di user kedua: dilebur, angka
      // terbesar menang (yang kecil bacaan hari itu yang belum selesai).
      {
        "2026-08-22__dead__1": row("2026-08-22", "act_dead", "K4RY-01 SEA", 50000),
        "2026-08-21__gone__3": row("2026-08-21", "act_gone", "PSA-Ts-1", 700),
      },
    ],
    actIds,
    "2026-08-21",
    "2026-08-25",
  );
  assert.deepEqual(
    rows.map((r) => [r.date, r.name, r.spend, r.results]),
    [
      ["2026-08-21", "K4RY-01 SEA", 68, 4],
      ["2026-08-21", "PSA-Ts-1", 700, 0],
      ["2026-08-22", "K4RY-01 SEA", 89378, 9070],
    ],
  );
  // Bentuknya bisa langsung dipecah per hari seperti laporan Meta.
  assert.equal(metaRowsByDay(rows).get("2026-08-21").length, 2);
  assert.deepEqual(
    unreadableSpendRows(
      [{ x: row("2026-08-21", "act_dead", "A", 5) }],
      new Set(),
      "2026-08-01",
      "2026-08-31",
    ),
    [],
  );
}

// accountLabel membuang spasi ekor nama yang diketik orang.
assert.equal(accountLabel({ name: "sheetz.us " }), "sheetz.us");
assert.equal(accountLabel({ name: "  ", networkCode: "23342108020" }), "23342108020");
console.log("# sync-core accountLabel tests ok");

// --- Earning akun GAM/AdSense yang dimatikan -------------------------------------------------
//
// petcins.com dimatikan 23 Sep 2026; sync-financials yang menulis ulang 30 hari lalu kehilangan
// Rp 16,2 juta earning 25–31 Agu tanpa satu pun isu sync. Yang mengembalikannya baris ROI.
{
  const domains = unreadableEarningDomains(
    {
      pet: { name: "petcins.com", propertyCode: "ca-pub-111", syncDisabled: "Nonaktif" },
      style: { name: "stylefemale.com", propertyCode: "ca-pub-222" },
      // Record lama terarsip, domainnya masih punya akun yang hidup: bukan domain mati.
      oldStyle: { name: "StyleFemale.com ", deletedAt: "2026-06-01T00:00:00Z" },
      // GAM dimatikan tapi AdSense publisher yang sama masih dibaca: earning-nya tetap masuk.
      design: { name: "designingaround.com", propertyCode: "ca-pub-333", syncDisabled: "Nonaktif" },
    },
    {
      dian: { name: "Dian ramadani", publisherId: "pub-111", syncDisabled: "Nonaktif" },
      muz: { name: "MUZAKKIR WALAT", publisherId: "pub-333" },
    },
  );
  assert.deepEqual([...domains], ["petcins.com"]);

  const byDate = unreadableEarningByDate(
    {
      a: { date: "2026-08-30", subDomain: "puppy.petcins.com", earning: 7000000 },
      b: { date: "2026-08-30", subDomain: "Care.Petcins.com", earning: 111770 },
      // Domain hidup: sudah masuk dari laporan langsung, tidak boleh dua kali.
      c: { date: "2026-08-30", subDomain: "trends.stylefemale.com", earning: 2718681 },
      // Earning tidak diketahui bukan nol, dan di luar rentang tidak dihitung.
      d: { date: "2026-08-31", subDomain: "puppy.petcins.com", earning: "" },
      e: { date: "2026-08-10", subDomain: "puppy.petcins.com", earning: 500 },
      // parentDomain menang atas akhiran nama: subdomain ini milik domain lain.
      f: { date: "2026-08-31", subDomain: "x.petcins.com", earning: 900 },
      g: { date: "2026-08-31", subDomain: "vet.petcins.com", earning: 4480199 },
    },
    {
      s1: { name: "puppy.petcins.com", parentDomain: "petcins.com" },
      s2: { name: "x.petcins.com", parentDomain: "stylefemale.com" },
    },
    domains,
    "2026-08-25",
    "2026-09-24",
  );
  assert.deepEqual([...byDate].sort(), [
    ["2026-08-30", 7111770],
    ["2026-08-31", 4480199],
  ]);
  assert.equal(
    unreadableEarningByDate(
      { a: { date: "2026-08-30", subDomain: "a.b.com", earning: 1 } },
      {},
      new Set(),
      "2026-08-01",
      "2026-08-31",
    ).size,
    0,
  );
  console.log("sync-core unreadable earning tests ok");
}

// --- Titik grafik keuangan: sisi yang tidak lengkap tidak menimpa ------------------------------
//
// 24 Sep 2026 17:11: laporan GAM stylefemale.com gagal sesaat (HTML alih-alih JSON), dan 30 hari
// ditulis ulang tanpanya — Pendapatan Agustus jatuh dari Rp 402 juta ke Rp 372 juta.
{
  const point = financialPoint("2026-08-30", 5_000_000, 1_000_000, 0.11);
  assert.deepEqual(financialWrite(point, { revenueComplete: true, spendComplete: true }), point);

  const noRevenue = financialWrite(point, { revenueComplete: false, spendComplete: true });
  assert.equal("grossRevenue" in noRevenue, false, "yang tersimpan dibiarkan berdiri");
  assert.equal(noRevenue.totalSpending, point.totalSpending);

  const noSpend = financialWrite(point, { revenueComplete: true, spendComplete: false });
  for (const key of ["totalSpend", "adTax", "totalSpending"]) assert.equal(key in noSpend, false);
  assert.equal(noSpend.grossRevenue, 5_000_000);
  console.log("sync-core financialWrite tests ok");
}
