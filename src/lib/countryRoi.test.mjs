import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { formatCtrPercent, normalizeCountryRoiRow, summarizeCountryRoi } from "./countryRoi.js";

describe("countryRoi", () => {
  test("baris negara membawa kolom uangnya sendiri", () => {
    const row = normalizeCountryRoiRow(
      { country: "Indonesia", isoCode: "ID", spending: 880000, earning: 2160000 },
      0.05,
    );
    assert.equal(row.countryLabel, "Indonesia (ID)");
    assert.equal(row.adTax, 44000);
    assert.equal(row.totalSpending, 924000);
    assert.equal(row.roi, 133.77, "(2.160.000 − 924.000) / 924.000");
  });

  test("label negara tetap terbaca tanpa kode ISO", () => {
    assert.equal(normalizeCountryRoiRow({ country: "Turki" }, 0.05).countryLabel, "Turki");
    assert.equal(normalizeCountryRoiRow({}, 0.05).countryLabel, "-");
  });

  test("ringkasan subdomain dihitung dari totalnya, bukan rata-rata persentase", () => {
    const summary = summarizeCountryRoi([
      normalizeCountryRoiRow({ spending: 1000, earning: 3000 }, 0.05),
      normalizeCountryRoiRow({ spending: 10, earning: 0 }, 0.05),
    ]);
    assert.equal(summary.spending, 1010);
    assert.equal(summary.adTax, 50.5);
    assert.equal(summary.totalSpending, 1060.5);
    assert.equal(summary.earning, 3000);
    assert.equal(summary.roi, 182.89, "(3000 − 1060,5) / 1060,5");
  });

  test("CPC dan eCPM ringkasan dari total klik, bukan rata-rata CPC tiap negara", () => {
    const summary = summarizeCountryRoi([
      normalizeCountryRoiRow({ earning: 1000, impressions: 5000, clicks: 1000 }, 0.05),
      // Negara sepi dengan CPC 10× lipat. Dirata-ratakan, ia menarik CPC subdomain dari 1,09
      // ke 5,5 — padahal 5 klik dari 5.005 tidak menggeser apa pun.
      normalizeCountryRoiRow({ earning: 50, impressions: 20, clicks: 5 }, 0.05),
    ]);
    assert.equal(summary.impressions, 5020);
    assert.equal(summary.clicks, 1005);
    assert.equal(summary.cpc, 1.04, "1050 / 1005");
    assert.equal(summary.ecpm, 209.16, "1050 / 5020 × 1000");
    assert.equal(summary.ctr, 20.02);
  });

  test("baris tanpa metrik tidak ikut jadi nol di pembagi", () => {
    const summary = summarizeCountryRoi([
      normalizeCountryRoiRow({ earning: 1000, impressions: 5000, clicks: 1000 }, 0.05),
      normalizeCountryRoiRow({ earning: 500 }, 0.05),
    ]);
    assert.equal(summary.impressions, 5000, "hanya baris yang benar-benar membawanya");
    assert.equal(summary.cpc, 1.5, "earning total dibagi klik yang diketahui");

    const kosong = summarizeCountryRoi([normalizeCountryRoiRow({ earning: 500 }, 0.05)]);
    assert.equal(kosong.impressions, null);
    assert.equal(kosong.cpc, null, "tidak ada satu pun klik yang dilaporkan — bukan 0");
    assert.equal(kosong.ecpm, null);
  });

  test("CTR ditulis sebagai persen, tanpa tanda plus", () => {
    assert.equal(formatCtrPercent(20), "20.00%");
    assert.equal(formatCtrPercent(0), "0.00%", "CTR nol tetap angka, bukan '-'");
    assert.equal(formatCtrPercent(null), "-", "tidak dilaporkan");
    assert.equal(formatCtrPercent(""), "-");
  });
});
