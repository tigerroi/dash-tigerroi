import assert from "node:assert";
import {
  aggregate,
  gamReportCurrency,
  rekeyToSyncDays,
  reportDefinition,
  widenedRange,
  wibHourRows,
} from "./gam.js";

// Metric order: IMPRESSIONS, CLICKS, AD_EXCHANGE_REVENUE, ADSENSE_REVENUE, AD_SERVER_REVENUE.
// GA v1 returns money as doubleValue in currency units (no micros) and counts as intValue strings.
const rows = [
  { metricValueGroups: [{ primaryValues: [{ intValue: "1000" }, { intValue: "10" }, { doubleValue: 5 }] }] },
  { metricValueGroups: [{ primaryValues: [{ intValue: "1000" }, { intValue: "10" }, { doubleValue: 5 }] }] },
];

const t = aggregate(rows);
assert.equal(t.impressions, 2000);
assert.equal(t.clicks, 20);
assert.equal(t.earning, 10, "5+5 dollars");

// Earning adalah JUMLAH seluruh metrik revenue, dan rinciannya dibawa terpisah. Baris yang cuma
// membawa AdX (network yang tidak dilayani sumber lain) tetap punya ketiga angkanya.
assert.equal(t.adx, 10);
assert.equal(t.adsense, 0);
assert.equal(t.adServer, 0);

// Tiga sumber sekaligus: kolom Earning harus sama dengan jumlah kolom sumbernya, kalau tidak
// tabelnya menampilkan uang yang tidak jatuh di kolom mana pun.
const campur = aggregate([
  {
    metricValueGroups: [
      {
        primaryValues: [
          { intValue: "100" },
          { intValue: "4" },
          { doubleValue: 7 },
          { doubleValue: 2 },
          { doubleValue: 1 },
        ],
      },
    ],
  },
]);
assert.equal(campur.adx, 7);
assert.equal(campur.adsense, 2);
assert.equal(campur.adServer, 1);
assert.equal(campur.earning, 10, "7 + 2 + 1 — bukan AdX saja");
assert.equal(campur.cpc, 2.5, "10 / 4: CPC ikut total, bukan satu sumber");
assert.equal(t.pageRpm, 5, "10 / 2000 * 1000");
assert.equal(t.cpc, 0.5, "10 / 20");

// Empty / malformed rows must not throw or divide by zero.
const z = aggregate([{}, { metricValueGroups: [] }]);
assert.equal(z.impressions, 0);
assert.equal(z.pageRpm, 0);
assert.equal(z.cpc, 0);

// Mata uang laporan DIMINTA: bawaannya IDR, dan `GAM_CURRENCY=""` mengembalikan mata uang network.
const range = { startDate: { year: 2026, month: 8, day: 1 }, endDate: { year: 2026, month: 8, day: 31 } };
const saved = process.env.GAM_CURRENCY;
delete process.env.GAM_CURRENCY;
assert.equal(gamReportCurrency(), "IDR");
assert.equal(reportDefinition(["SITE"], ["IMPRESSIONS"], range).currencyCode, "IDR");
process.env.GAM_CURRENCY = "";
assert.equal(gamReportCurrency(), "");
assert.equal(
  "currencyCode" in reportDefinition(["SITE"], ["IMPRESSIONS"], range),
  false,
  "kosong = field tidak dikirim sama sekali, bukan currencyCode kosong",
);
if (saved === undefined) delete process.env.GAM_CURRENCY;
else process.env.GAM_CURRENCY = saved;

console.log("gam.test ok");

// --- Jam network -> hari WIB --------------------------------------------------------------------
{
  const raw = (date, hour, site, rev) => ({
    dimensionValues: [{ intValue: date }, { intValue: String(hour) }, { stringValue: site }],
    metricValueGroups: [{ primaryValues: [{ intValue: "10" }, { intValue: "1" }, { doubleValue: rev }] }],
  });
  const day = (d) => ({ year: 2026, month: 9, day: d });
  const wib22 = { startDate: day(22), endDate: day(22) };
  const keysOf = (rows) => rows.map((r) => r.dimensionValues.map((v) => v.stringValue).join("|"));

  // Karachi (UTC+5) = WIB − 2 jam: jam 22 & 23 tanggal 21 sudah 22 Sep WIB, jam 22 tanggal 22 sudah 23.
  const karachi = rekeyToSyncDays(
    [raw("20260921", 21, "a", 1), raw("20260921", 22, "a", 2), raw("20260921", 23, "a", 3),
     raw("20260922", 0, "a", 4), raw("20260922", 21, "a", 5), raw("20260922", 22, "a", 99)],
    "Asia/Karachi", wib22, true, "Asia/Jakarta",
  );
  assert.deepEqual(keysOf(karachi), ["20260922|a"]);
  assert.equal(aggregate(karachi).earning, 2 + 3 + 4 + 5, "jam 21 tgl 21 dan jam 22 tgl 22 bukan milik 22 Sep WIB");
  assert.equal(aggregate(karachi).impressions, 40, "hitungan ikut dijumlah");

  // Los Angeles (PDT, UTC−7) = WIB − 14 jam: 22 Sep WIB = 21 Sep 10:00 s/d 22 Sep 09:59 LA.
  const la = rekeyToSyncDays(
    [raw("20260921", 9, "b", 1), raw("20260921", 10, "b", 2), raw("20260922", 9, "b", 3), raw("20260922", 10, "b", 4)],
    "America/Los_Angeles", wib22, true, "Asia/Jakarta",
  );
  assert.equal(aggregate(la).earning, 5);

  // PST (UTC−8, sesudah DST berakhir 1 Nov 2026) = WIB − 15 jam: jam 9 LA sudah hari WIB berikutnya.
  const pst = rekeyToSyncDays(
    [raw("20261109", 8, "b", 1), raw("20261109", 9, "b", 2)],
    "America/Los_Angeles", { startDate: { year: 2026, month: 11, day: 10 }, endDate: { year: 2026, month: 11, day: 10 } },
    true, "Asia/Jakarta",
  );
  assert.equal(aggregate(pst).earning, 2);

  // Tanpa DATE di permintaan: tanggalnya cuma dipakai menyaring, lalu dibuang dari kunci.
  const noDate = rekeyToSyncDays([raw("20260921", 22, "a", 2), raw("20260922", 1, "a", 3)], "Asia/Karachi", wib22, false, "Asia/Jakarta");
  assert.deepEqual(keysOf(noDate), ["a"]);
  assert.equal(aggregate(noDate).earning, 5);

  // Rentang network melebar sehari di kedua ujung, termasuk lintas bulan.
  assert.deepEqual(
    widenedRange({ startDate: { year: 2026, month: 10, day: 1 }, endDate: { year: 2026, month: 10, day: 31 } }),
    { startDate: day(30), endDate: { year: 2026, month: 11, day: 1 } },
  );
}

// --- Rasio penayangan per jam WIB ---------------------------------------------------------------
{
  const raw = (date, hour, site, req, imp) => ({
    dimensionValues: [{ intValue: date }, { intValue: String(hour) }, { stringValue: site }],
    metricValueGroups: [{ primaryValues: [{ intValue: String(req) }, { intValue: String(imp) }] }],
  });
  const day = (d) => ({ year: 2026, month: 9, day: d });
  const range = { startDate: day(23), endDate: day(24) };

  // Network WIB: jam dipakai apa adanya, dua digit.
  assert.deepEqual(
    wibHourRows([raw("20260924", 5, "a.x.com", 100, 40)], "Asia/Jakarta", range, "Asia/Jakarta"),
    [{ date: "2026-09-24", hour: "05", site: "a.x.com", req: 100, imp: 40 }],
  );

  // Karachi (UTC+5): 23:00 tgl 23 = 01:00 WIB tgl 24. 21:00 tgl 22 = 23:00 WIB tgl 22 -> di luar rentang.
  const karachi = wibHourRows(
    [raw("20260923", 23, "k.x.com", 10, 5), raw("20260922", 21, "k.x.com", 99, 99)],
    "Asia/Karachi", range, "Asia/Jakarta",
  );
  assert.deepEqual(karachi, [{ date: "2026-09-24", hour: "01", site: "k.x.com", req: 10, imp: 5 }]);

  // Los Angeles (PDT, UTC−7): 10:00 tgl 23 = 00:00 WIB tgl 24.
  const la = wibHourRows([raw("20260923", 10, "l.x.com", 7, 3)], "America/Los_Angeles", range, "Asia/Jakarta");
  assert.deepEqual(la, [{ date: "2026-09-24", hour: "00", site: "l.x.com", req: 7, imp: 3 }]);

  // Dua baris yang jatuh ke jam WIB + situs yang sama dijumlahkan.
  const merged = wibHourRows(
    [raw("20260924", 5, "a.x.com", 1, 1), raw("20260924", 5, "a.x.com", 2, 1)],
    "Asia/Jakarta", range, "Asia/Jakarta",
  );
  assert.deepEqual(merged, [{ date: "2026-09-24", hour: "05", site: "a.x.com", req: 3, imp: 2 }]);

  // Zona network yang tidak diketahui ("") dibaca sebagai zona tujuan, sepola fetchRows.
  assert.equal(wibHourRows([raw("20260924", 5, "a.x.com", 1, 1)], "", range, "Asia/Jakarta")[0].hour, "05");
}
console.log("gam.test wibHourRows ok");
