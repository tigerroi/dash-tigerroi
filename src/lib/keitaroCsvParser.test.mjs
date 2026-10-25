import assert from "node:assert/strict";
import test from "node:test";
import {
  detectColumnIndices,
  detectDelimiter,
  matchSiteCode,
  normalizeDate,
  parseCsvRows,
  parseNumeric,
  processKeitaroCsv,
} from "./keitaroCsvParser.js";

const mockSites = [
  {
    site_code: "ihop-menu",
    name: "IHOP Menu Prices",
    domain: "ihopmenuwithprices.us",
    campaign_pattern: "pBRw, ihop",
  },
  {
    site_code: "tray-decor",
    name: "Tray Decor",
    domain: "trayedit.com",
    campaign_pattern: "TvH1, tray",
  },
  {
    site_code: "taco-fries",
    name: "Taco Bell Fries",
    domain: "tacobellmenuu.us",
    campaign_pattern: "taco",
  },
  {
    site_code: "tiktok-mod",
    name: "TikTok Mod APK",
    domain: "tiktokmodapk.net",
    campaign_pattern: "tiktok",
  },
];

test("detectDelimiter mengenali koma, titik koma, dan tab dengan benar", () => {
  assert.equal(detectDelimiter("date,campaign,clicks,cost"), ",");
  assert.equal(detectDelimiter("date;campaign;clicks;cost"), ";");
  assert.equal(detectDelimiter("date\tcampaign\tclicks\tcost"), "\t");
});

test("parseCsvRows mengurai petik ganda dan baris dengan tepat", () => {
  const csv = `Date,Campaign,Clicks\n2026-10-25,"ACA T2 (WL) pBRw (ihopmenuwithprices.us)",150\n2026-10-25,"Camp with ""quote""",200`;
  const rows = parseCsvRows(csv, ",");
  assert.equal(rows.length, 3);
  assert.equal(rows[1][1], "ACA T2 (WL) pBRw (ihopmenuwithprices.us)");
  assert.equal(rows[2][1], 'Camp with "quote"');
  assert.equal(rows[2][2], "200");
});

test("normalizeDate menangani berbagai format tanggal", () => {
  assert.equal(normalizeDate("2026-10-25"), "2026-10-25");
  assert.equal(normalizeDate("2026-10-25 14:30:00"), "2026-10-25");
  assert.equal(normalizeDate("25.10.2026"), "2026-10-25");
  assert.equal(normalizeDate("25/10/2026"), "2026-10-25");
  assert.equal(normalizeDate("25-10-2026"), "2026-10-25");
  assert.equal(normalizeDate("invalid"), null);
});

test("parseNumeric membersihkan format angka dan mata uang", () => {
  assert.equal(parseNumeric("$1,250.50"), 1250.5);
  assert.equal(parseNumeric("1.250,50"), 1250.5);
  assert.equal(parseNumeric("125,50"), 125.5);
  assert.equal(parseNumeric("Rp 50.000"), 50000);
  assert.equal(parseNumeric("", 0), 0);
});

test("matchSiteCode memetakan berbagai jenis input ke site_code yang tepat", () => {
  // 1. Direct match
  assert.equal(matchSiteCode(["ihop-menu"], mockSites), "ihop-menu");
  assert.equal(matchSiteCode(["tray_decor"], mockSites), "tray-decor");

  // 2. Sub ID / Query parameter
  assert.equal(matchSiteCode(["https://go.tigerroi.com/camp?site=taco-fries"], mockSites), "taco-fries");

  // 3. Pattern match (kode 4 huruf Keitaro)
  assert.equal(
    matchSiteCode(["ACA T2 (WL) pBRw"], mockSites),
    "ihop-menu"
  );
  assert.equal(
    matchSiteCode(["ACA T2 (WL) TvH1"], mockSites),
    "tray-decor"
  );

  // 4. Domain match dalam kurung
  assert.equal(
    matchSiteCode(["ACA T2 (WL) (tiktokmodapk.net)"], mockSites),
    "tiktok-mod"
  );

  // 5. Unknown candidate
  assert.equal(matchSiteCode(["random_unrelated_site"], mockSites), null);
});

test("processKeitaroCsv mengolah CSV laporan Keitaro dan mengagregasi data", () => {
  const csvContent = `Date;Campaign;Sub ID 1;Clicks;Cost;Revenue
2026-10-24;ACA T2 (WL) pBRw (ihopmenuwithprices.us);ihop-menu;1200;$150.00;$320.50
2026-10-24;ACA T2 (WL) pBRw Subcamp 2;ihop-menu;800;$100.00;$180.00
2026-10-24;ACA T2 (WL) TvH1 (trayedit.com);tray-decor;500;$50.00;$120.00
2026-10-24;Campaign Asing Tidak Terdaftar;unknown;100;$10.00;$0.00`;

  const result = processKeitaroCsv(csvContent, mockSites);

  assert.equal(result.success, true);
  assert.equal(result.summary.validAggregatedRows, 2); // ihop-menu dan tray-decor
  assert.equal(result.summary.unmatchedRows, 1); // 1 tidak cocok

  // Cek agregasi ihop-menu (dua campaign digabung)
  const ihop = result.dailyStats.find((s) => s.site_code === "ihop-menu");
  assert.ok(ihop);
  assert.equal(ihop.date, "2026-10-24");
  assert.equal(ihop.source, "keitaro");
  assert.equal(ihop.clicks, 2000); // 1200 + 800
  assert.equal(ihop.spend, 250); // 150 + 100
  assert.equal(ihop.revenue, 500.5); // 320.5 + 180
  assert.equal(Number((ihop.revenue - ihop.spend).toFixed(2)), 250.5); // 500.5 - 250
  assert.equal(ihop.metadata.profit, 250.5);
  assert.equal(ihop.campaign_count, 2);
  assert.equal(ihop.roi_percent, 100.2); // (250.5 / 250) * 100

  // Cek baris yang tidak cocok dicatat dengan rapi
  assert.equal(result.unmatched.length, 1);
  assert.equal(result.unmatched[0].candidates.includes("unknown"), true);
});

test("processKeitaroCsv menolak CSV yang tidak memiliki kolom pengenal", () => {
  const invalidCsv = `Date,Clicks,Cost\n2026-10-25,100,20`;
  const result = processKeitaroCsv(invalidCsv, mockSites);
  assert.equal(result.success, false);
  assert.match(result.error, /wajib memiliki minimal satu kolom pengenal/);
});
