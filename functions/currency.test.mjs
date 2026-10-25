import assert from "node:assert/strict";
import { convertRowsToIdr, roiReportUpdate } from "./sync-core.js";

const rates = { IDR: 16000, USD: 1 };

// convertRowsToIdr: metrik uang dikali kurs; keys/impressions/clicks dibiarkan; currency+kurs ditempel.
const [usd] = convertRowsToIdr(
  [{ keys: ["s"], earning: 56.71, adx: 56.71, adsense: 0, adServer: 0, impressions: 1000, clicks: 5 }],
  "USD",
  rates,
);
assert.equal(usd.currency, "USD");
assert.equal(usd.fxRate, 16000);
assert.equal(usd.earning, 56.71 * 16000);
assert.equal(usd.adx, 56.71 * 16000);
assert.equal(usd.impressions, 1000);
assert.equal(usd.clicks, 5);

// IDR: nilai tidak diubah, kurs null (tidak ada konversi) — kolomnya tampil Rp seperti biasa.
const [idr] = convertRowsToIdr([{ earning: 400000 }], "IDR", rates);
assert.equal(idr.earning, 400000);
assert.equal(idr.currency, "IDR");
assert.equal(idr.fxRate, null);

// Mata uang tak dikenal: TIDAK dikali (fxRate null), tapi tetap ditandai — jangan mengarang angka.
const [gbp] = convertRowsToIdr([{ earning: 10 }], "GBP", rates);
assert.equal(gbp.earning, 10);
assert.equal(gbp.currency, "GBP");
assert.equal(gbp.fxRate, null);

// Inti perbaikan: earning USD (dikonversi) vs spend IDR menghasilkan ROI benar, bukan -99,98%.
const metrics = {
  earning: 56.71 * 16000,
  impressions: 1000,
  clicks: 5,
  adx: 56.71 * 16000,
  adsense: 0,
  adServer: 0,
  currency: "USD",
  fxRate: 16000,
};
const report = roiReportUpdate({ name: "correction" }, metrics, 185970, {
  adTaxRate: 0,
  day: "2026-08-12",
});
assert.ok(report.roi > 300, `harusnya untung, malah ${report.roi}`);
assert.equal(report.currency, "USD");
assert.equal(report.fxRate, 16000);

// Mata uang yang DISEBUT laporan menang atas mata uang akun. Akun AdSense v2 tidak punya field
// mata uang sama sekali, jadi argumen ketiganya selalu jatuh ke "IDR" — dan earning USD yang
// dikira rupiah adalah ROI -99,96% untuk subdomain yang justru untung (marriage.psaonline...,
// 21 Agu 2026: IDR 13.521 di layar AdSense tersimpan sebagai Rp 1).
const [fromReport] = convertRowsToIdr([{ earning: 0.76, adsense: 0.76, reportCurrency: "USD" }], "IDR", rates);
assert.equal(fromReport.currency, "USD");
assert.equal(fromReport.fxRate, 16000);
assert.equal(fromReport.earning, 0.76 * 16000);
assert.equal(fromReport.adsense, 0.76 * 16000);
// Penandanya tidak ikut tersimpan di baris: yang dibaca UI adalah `currency` + `fxRate`.
assert.equal("reportCurrency" in fromReport, false);

// Baris tanpa penanda tetap memakai mata uang akun — jalur GAM tidak berubah sama sekali.
const [fromAccount] = convertRowsToIdr([{ earning: 2 }], "USD", rates);
assert.equal(fromAccount.currency, "USD");
assert.equal(fromAccount.earning, 32000);

// Laporan yang memang IDR tidak dikali apa pun, walau akunnya tercatat lain.
const [reportIdr] = convertRowsToIdr([{ earning: 13521, reportCurrency: "IDR" }], "USD", rates);
assert.equal(reportIdr.currency, "IDR");
assert.equal(reportIdr.fxRate, null);
assert.equal(reportIdr.earning, 13521);

console.log("currency.test.mjs OK");
