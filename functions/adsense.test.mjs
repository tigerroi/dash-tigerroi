import assert from "node:assert/strict";
import {
  accountResourceName,
  adsenseDimension,
  parseReport,
  runAccountReportByDimensions,
} from "./adsense.js";
import { gamRowsByDay } from "./sync-core.js";

// accountResourceName: satu alamat, berapa pun bentuk yang tersimpan di record.
assert.equal(accountResourceName("pub-123"), "accounts/pub-123");
assert.equal(accountResourceName("accounts/pub-123"), "accounts/pub-123");
// propertyCode GAM berawalan "ca-", dan API AdSense tidak mengenalnya.
assert.equal(accountResourceName("ca-pub-123"), "accounts/pub-123");
assert.equal(accountResourceName(""), "");
assert.equal(accountResourceName(null), "");

// Pemanggil bicara dalam enum GAM; SITE harus jadi DOMAIN_NAME, bukan OWNED_SITE_DOMAIN_NAME —
// yang terakhir menggumpalkan semua subdomain jadi satu baris domain induk.
assert.equal(adsenseDimension("SITE"), "DOMAIN_NAME");
assert.equal(adsenseDimension("site"), "DOMAIN_NAME");
assert.equal(adsenseDimension("DATE"), "DATE");
assert.equal(adsenseDimension("COUNTRY_CODE"), "COUNTRY_CODE");
// Yang tidak dikenal dipakai apa adanya: menebak terjemahan hanya menutupi pesan asli Google.
assert.equal(adsenseDimension("SOMETHING_NEW"), "SOMETHING_NEW");

// parseReport: kolom dibaca lewat headers, bukan posisi tetap.
const report = {
  headers: [
    { name: "DATE" },
    { name: "DOMAIN_NAME" },
    { name: "CLICKS" },
    { name: "ESTIMATED_EARNINGS", currencyCode: "IDR" },
    { name: "IMPRESSIONS" },
  ],
  rows: [
    {
      cells: [
        { value: "2026-08-11" },
        { value: "dekadeko.com" },
        { value: "7" },
        { value: "1234.56" },
        { value: "900" },
      ],
    },
  ],
};
const rows = parseReport(report, 2);
assert.equal(rows.length, 1);
assert.deepEqual(rows[0].keys, ["2026-08-11", "dekadeko.com"]);
assert.equal(rows[0].clicks, 7);
assert.equal(rows[0].impressions, 900);
assert.equal(rows[0].earning, 1234.56);
// Seluruh pendapatan akun AdSense berdiri sendiri adalah pendapatan AdSense. adx/adServer nol di
// sini BUKAN "tidak diketahui": sumbernya memang tidak ada, dan kolom GAM di tabel ROI harus 0.
assert.equal(rows[0].adsense, 1234.56);
assert.equal(rows[0].adx, 0);
assert.equal(rows[0].adServer, 0);

// Urutan metrik yang berbeda tidak boleh menggeser artinya.
const swapped = parseReport(
  {
    headers: [{ name: "DATE" }, { name: "ESTIMATED_EARNINGS" }, { name: "CLICKS" }],
    rows: [{ cells: [{ value: "2026-08-11" }, { value: "10" }, { value: "2" }] }],
  },
  1,
);
assert.equal(swapped[0].earning, 10);
assert.equal(swapped[0].clicks, 2);

// Laporan kosong bukan kesalahan — akun yang kemarin tidak menghasilkan apa pun memang begitu.
assert.deepEqual(parseReport({ headers: [], rows: [] }, 0), []);
assert.deepEqual(parseReport(undefined, 0), []);

// Bentuknya harus bisa langsung dipecah per hari oleh helper yang sama dengan baris GAM — itulah
// yang membuat sisi ROI tidak perlu tahu laporan ini datang dari API mana.
const byDay = gamRowsByDay(parseReport(report, 2));
assert.deepEqual([...byDay.keys()], ["2026-08-11"]);
assert.equal(byDay.get("2026-08-11")[0].key, "dekadeko.com");
assert.equal(byDay.get("2026-08-11")[0].earning, 1234.56);

console.log("adsense.test ok");

// Mata uang laporan dibaca dari header kolom uang dan menempel di tiap baris: `accounts.list`
// AdSense v2 tidak mengembalikan mata uang sama sekali, jadi ini satu-satunya yang tahu angka di
// atas USD atau IDR.
assert.equal(rows[0].reportCurrency, "IDR");
const usdRows = parseReport(
  {
    headers: [{ name: "DOMAIN_NAME" }, { name: "ESTIMATED_EARNINGS", currencyCode: "USD" }],
    rows: [{ cells: [{ value: "marriage.psaonlineappointment.com" }, { value: "0.76" }] }],
  },
  1,
);
assert.equal(usdRows[0].reportCurrency, "USD");
assert.equal(usdRows[0].earning, 0.76);
// Header tanpa mata uang tidak ditebak — sisi sync yang jatuh ke mata uang akun.
const noCurrency = parseReport(
  {
    headers: [{ name: "DOMAIN_NAME" }, { name: "ESTIMATED_EARNINGS" }],
    rows: [{ cells: [{ value: "a.web.id" }, { value: "10" }] }],
  },
  1,
);
assert.equal(noCurrency[0].reportCurrency, "");

// Laporan diminta langsung dalam rupiah (ADSENSE_CURRENCY, default IDR): pembulatan dua desimal
// pada angka dolar sekecil ini saja sudah ±0,7%, dan kurs gratis cuma punya kurs hari ini.
// Kosong = ikut mata uang akun, satu-satunya cara meminta angka apa adanya (dipakai migrasi).
const urls = [];
const savedFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  urls.push(String(url));
  return { ok: true, text: async () => JSON.stringify({ headers: [], rows: [] }) };
};
const day = {
  startDate: { year: 2026, month: 8, day: 21 },
  endDate: { year: 2026, month: 8, day: 21 },
};
await runAccountReportByDimensions("pub-1", day, "t", ["SITE"]);
assert.ok(urls.at(-1).includes("currencyCode=IDR"), urls.at(-1));
process.env.ADSENSE_CURRENCY = "";
await runAccountReportByDimensions("pub-1", day, "t", ["SITE"]);
assert.ok(!urls.at(-1).includes("currencyCode"), urls.at(-1));
process.env.ADSENSE_CURRENCY = "USD";
await runAccountReportByDimensions("pub-1", day, "t", ["SITE"]);
assert.ok(urls.at(-1).includes("currencyCode=USD"), urls.at(-1));
delete process.env.ADSENSE_CURRENCY;
globalThis.fetch = savedFetch;
