// Warna grafik untuk Recharts.
//
// Seluruh warna dashboard ini tinggal sebagai token CSS di `src/styles.css`, dan tema gelap cuma
// menyebut ulang nilainya. Recharts adalah satu-satunya bagian yang tidak ikut: warnanya diberikan
// sebagai prop JS (`stroke="…"`, `fill="…"`) yang berakhir sebagai atribut SVG, dan atribut SVG
// TIDAK memahami `var(--token)` — ia diam-diam terbaca sebagai warna yang tidak sah, dan garisnya
// hilang. Bukan error, cuma grafik kosong.
//
// Jadi warnanya DIBACA dari token yang sama, bukan disalin ke daftar kedua di sini. Daftar kedua
// akan berbeda dari CSS suatu hari, dan yang berbeda adalah legenda HTML di bawah kanvas melawan
// garis di dalamnya — dua hijau yang mengaku subdomain yang sama.
const TOKENS = {
  grid: "--chart-grid",
  axis: "--chart-axis",
  zeroLine: "--chart-zero-line",
  dotStroke: "--chart-dot-stroke",
  dotFill: "--chart-dot-fill",
  barCursor: "--chart-bar-cursor",
  revenue: "--chart-revenue",
  spend: "--chart-spend",
  profit: "--chart-profit",
  roi: "--chart-roi",
};

// Enam belas, sepola dengan COLORS lama di SubDomainRoiCharts: warna diambil per POSISI deret.
export const SERIES_COUNT = 16;

// Nilai terang, kembar dari blok `:root`. Ini BUKAN sumber kebenaran — ia yang dipakai saat tidak
// ada dokumen untuk dibaca (test node, render sebelum stylesheet terpasang). Terang, karena itu
// bawaan halaman ini untuk perangkat yang tidak menyatakan temanya.
const FALLBACK = {
  grid: "#e4e4e7",
  axis: "#71717a",
  zeroLine: "#a1a1aa",
  dotStroke: "#ffffff",
  dotFill: "#000000",
  barCursor: "rgba(113, 113, 122, 0.08)",
  revenue: "#16a34a",
  spend: "#dc2626",
  profit: "#7c3aed",
  roi: "#2563eb",
  series: [
    "#2563eb",
    "#ea580c",
    "#10b981",
    "#eab308",
    "#ec4899",
    "#7c3aed",
    "#ef4444",
    "#16a34a",
    "#0891b2",
    "#f97316",
    "#4f46e5",
    "#84cc16",
    "#db2777",
    "#0d9488",
    "#a16207",
    "#64748b",
  ],
};

export function readChartPalette(root) {
  if (!root || typeof globalThis.getComputedStyle !== "function") {
    return FALLBACK;
  }

  const style = globalThis.getComputedStyle(root);
  // Token yang tidak terbaca (stylesheet belum sampai, browser tanpa custom property) jatuh ke
  // nilai terang — bukan ke string kosong, yang oleh Recharts digambar sebagai hitam.
  const read = (token, fallback) => style.getPropertyValue(token).trim() || fallback;

  const palette = { series: [] };
  for (const [name, token] of Object.entries(TOKENS)) {
    palette[name] = read(token, FALLBACK[name]);
  }
  for (let index = 0; index < SERIES_COUNT; index += 1) {
    palette.series.push(read(`--chart-series-${index + 1}`, FALLBACK.series[index]));
  }
  return palette;
}

// Armada yang lebih besar dari paletnya mengulang dari awal, persis seperti sebelumnya: yang
// membedakan dua kurva sewarna adalah tooltip dan chip-nya, bukan warnanya.
export function seriesColor(palette, index) {
  const colors = palette?.series?.length ? palette.series : FALLBACK.series;
  return colors[index % colors.length];
}

export const FALLBACK_CHART_PALETTE = FALLBACK;
