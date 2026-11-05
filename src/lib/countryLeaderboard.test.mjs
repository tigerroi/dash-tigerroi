import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCountryLeaderboard,
  getCountryFlag,
  getCountryIndonesianName,
} from "./countryLeaderboard.js";

test("getCountryFlag mengembalikan bendera emoji yang tepat", () => {
  assert.equal(getCountryFlag("TR"), "🇹🇷");
  assert.equal(getCountryFlag("SA"), "🇸🇦");
  assert.equal(getCountryFlag("ID"), "🇮🇩");
  assert.equal(getCountryFlag(""), "🌐");
});

test("getCountryIndonesianName menerjemahkan kode negara ke Bahasa Indonesia", () => {
  assert.equal(getCountryIndonesianName("AE"), "Uni Emirat Arab");
  assert.equal(getCountryIndonesianName("SA"), "Arab Saudi");
  assert.equal(getCountryIndonesianName("TR"), "Turki");
  assert.equal(getCountryIndonesianName("MX"), "Meksiko");
  assert.equal(getCountryIndonesianName("EG"), "Mesir");
});

test("buildCountryLeaderboard menghitung agregasi metrik dan kartu sorotan dengan benar", () => {
  const rows = [
    {
      country_code: "AE",
      date: "2026-10-28",
      spend: 100000,
      earning: 500000,
      impressions: 10000,
      clicks: 500,
    },
    {
      country_code: "AE",
      date: "2026-10-29",
      spend: 100000,
      earning: 600000,
      impressions: 12000,
      clicks: 600,
    },
    {
      country_code: "EG",
      date: "2026-10-28",
      spend: 150000,
      earning: 100000, // rugi
      impressions: 5000,
      clicks: 200,
    },
  ];

  const result = buildCountryLeaderboard(rows, {
    adTaxRate: 0,
    minSpendThreshold: 50000,
  });

  assert.equal(result.items.length, 2);
  const ae = result.items.find((i) => i.countryCode === "AE");
  assert.ok(ae);
  assert.equal(ae.totalSpend, 200000);
  assert.equal(ae.earning, 1100000);
  assert.equal(ae.profit, 900000);
  assert.equal(ae.roi, 450);
  assert.equal(ae.daysRatio, "2/2");
  assert.equal(ae.recommendation, "Naikkan");

  // Sorotan best
  assert.equal(result.highlights.best?.countryCode, "AE");
  // Sorotan lowest
  assert.equal(result.highlights.lowest?.countryCode, "EG");
});
