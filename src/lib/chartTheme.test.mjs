import assert from "node:assert/strict";
import test from "node:test";
import {
  FALLBACK_CHART_PALETTE,
  readChartPalette,
  SERIES_COUNT,
  seriesColor,
} from "./chartTheme.js";

// Tanpa dokumen (test node, render pertama sebelum stylesheet terpasang) paletnya harus tetap utuh
// — bukan objek berisi string kosong, yang oleh Recharts digambar hitam di atas hitam.
test("tanpa dokumen jatuh ke palet terang", () => {
  assert.equal(readChartPalette(null), FALLBACK_CHART_PALETTE);
  assert.equal(readChartPalette(undefined).revenue, "#16a34a");
});

test("membaca nilai token dari dokumen", () => {
  const values = {
    "--chart-grid": " #27272d ",
    "--chart-revenue": "#4ade80",
    "--chart-series-1": "#60a5fa",
  };
  const root = {};
  const previous = globalThis.getComputedStyle;
  globalThis.getComputedStyle = () => ({
    getPropertyValue: (token) => values[token] ?? "",
  });

  try {
    const palette = readChartPalette(root);
    assert.equal(palette.grid, "#27272d");
    assert.equal(palette.revenue, "#4ade80");
    assert.equal(palette.series[0], "#60a5fa");
    // Token yang tidak terbaca jatuh ke nilai terang, bukan ke string kosong.
    assert.equal(palette.spend, FALLBACK_CHART_PALETTE.spend);
    assert.equal(palette.series[1], FALLBACK_CHART_PALETTE.series[1]);
    assert.equal(palette.series.length, SERIES_COUNT);
  } finally {
    globalThis.getComputedStyle = previous;
  }
});

test("warna deret diambil per posisi dan mengulang", () => {
  const palette = FALLBACK_CHART_PALETTE;
  assert.equal(seriesColor(palette, 0), palette.series[0]);
  assert.equal(seriesColor(palette, SERIES_COUNT), palette.series[0]);
  assert.equal(seriesColor(palette, SERIES_COUNT + 3), palette.series[3]);
});

test("palet yang belum terisi tetap memberi warna", () => {
  assert.equal(seriesColor(undefined, 2), FALLBACK_CHART_PALETTE.series[2]);
  assert.equal(seriesColor({ series: [] }, 2), FALLBACK_CHART_PALETTE.series[2]);
});
