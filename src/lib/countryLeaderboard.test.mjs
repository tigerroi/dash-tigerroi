import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCountryLeaderboard,
  buildCountryDailyHeatmap,
  buildCountryRoiCurves,
  buildBudgetCutPriorities,
  formatIndonesianDayDate,
  getCountryFlag,
  getCountryIndonesianName,
  getRoiHeatmapCategory,
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

test("formatIndonesianDayDate memformat YYYY-MM-DD ke Hari Tgl Bulan Indonesia", () => {
  assert.equal(formatIndonesianDayDate("2026-10-18"), "Min 18 Okt");
  assert.equal(formatIndonesianDayDate("2026-10-19"), "Sen 19 Okt");
  assert.equal(formatIndonesianDayDate("2026-10-23"), "Jum 23 Okt");
});

test("getRoiHeatmapCategory mengembalikan klasifikasi legend yang akurat", () => {
  assert.equal(getRoiHeatmapCategory(150, 50000), "high-profit");
  assert.equal(getRoiHeatmapCategory(50, 50000), "medium-profit");
  assert.equal(getRoiHeatmapCategory(10, 50000), "low-profit");
  assert.equal(getRoiHeatmapCategory(-15, 50000), "light-loss");
  assert.equal(getRoiHeatmapCategory(-45, 50000), "medium-loss");
  assert.equal(getRoiHeatmapCategory(-85, 50000), "severe-loss");
  assert.equal(getRoiHeatmapCategory(100, 500), "none"); // spend < 1000
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

test("buildCountryDailyHeatmap menghasilkan baris Total dan baris tiap negara dengan subdomains", () => {
  const rows = [
    {
      country_code: "TR",
      sub_domain: "menu.ihopmenuwithprices.us",
      date: "2026-10-20",
      spend: 100000,
      earning: 300000,
    },
    {
      country_code: "TR",
      sub_domain: "deals.ihopmenuwithprices.us",
      date: "2026-10-20",
      spend: 50000,
      earning: 150000,
    },
    {
      country_code: "SA",
      sub_domain: "fries.tacobellmenuu.us",
      date: "2026-10-20",
      spend: 200000,
      earning: 600000,
    },
  ];

  const heatmap = buildCountryDailyHeatmap(rows, { adTaxRate: 0 });
  assert.equal(heatmap.dates.length, 1);
  assert.equal(heatmap.dates[0], "2026-10-20");

  // Total
  const totalDay = heatmap.totalRow.days["2026-10-20"];
  assert.equal(totalDay.spend, 350000);
  assert.equal(totalDay.earning, 1050000);
  assert.equal(totalDay.roi, 200);

  // Country TR
  const trRow = heatmap.countryRows.find((r) => r.countryCode === "TR");
  assert.ok(trRow);
  assert.equal(trRow.days["2026-10-20"].spend, 150000);
  assert.equal(trRow.days["2026-10-20"].subdomains.length, 2);
});

test("buildBudgetCutPriorities menyaring pasangan negara x subdomain yang rugi dengan rugi beruntun", () => {
  const rows = [
    {
      country_code: "MX",
      sub_domain: "wiki.masseffectstore.com",
      date: "2026-10-28",
      spend: 3000,
      earning: 200, // rugi
    },
    {
      country_code: "MX",
      sub_domain: "wiki.masseffectstore.com",
      date: "2026-10-29",
      spend: 4000,
      earning: 300, // rugi
    },
    {
      country_code: "MX",
      sub_domain: "wiki.masseffectstore.com",
      date: "2026-10-30",
      spend: 5000,
      earning: 500, // rugi
    },
    {
      country_code: "TR",
      sub_domain: "good.domain.com",
      date: "2026-10-30",
      spend: 10000,
      earning: 50000, // untung -> tidak boleh masuk daftar potong anggaran
    },
  ];

  const subDomains = [
    { name: "wiki.masseffectstore.com", pic: "Rabbit" },
  ];

  const priorities = buildBudgetCutPriorities(rows, {
    subDomains,
    adTaxRate: 0,
    recentDays: 3,
  });

  assert.equal(priorities.length, 1);
  const item = priorities[0];
  assert.equal(item.countryCode, "MX");
  assert.equal(item.subDomain, "wiki.masseffectstore.com");
  assert.equal(item.pic, "Rabbit");
  assert.equal(item.totalSpend, 12000);
  assert.equal(item.earning, 1000);
  assert.equal(item.profit, -11000);
  assert.equal(item.consecutiveLossDays, 3);
});
