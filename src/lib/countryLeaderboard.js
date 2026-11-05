import { roiPercent, withAdTax } from "./adTax.js";

// Kamus nama negara resmi Bahasa Indonesia untuk negara-negara umum
export const ID_COUNTRY_NAMES = {
  AE: "Uni Emirat Arab",
  SA: "Arab Saudi",
  TR: "Turki",
  MX: "Meksiko",
  IN: "India",
  AR: "Argentina",
  KW: "Kuwait",
  OM: "Oman",
  PH: "Filipina",
  MA: "Maroko",
  CO: "Kolombia",
  VN: "Vietnam",
  RO: "Rumania",
  QA: "Qatar",
  EG: "Mesir",
  CL: "Cile",
  PL: "Polandia",
  IT: "Italia",
  US: "Amerika Serikat",
  GB: "Inggris",
  DE: "Jerman",
  FR: "Prancis",
  ES: "Spanyol",
  NL: "Belanda",
  BR: "Brasil",
  ID: "Indonesia",
  MY: "Malaysia",
  SG: "Singapura",
  TH: "Thailand",
  PK: "Pakistan",
  BD: "Bangladesh",
  JP: "Jepang",
  KR: "Korea Selatan",
  ZA: "Afrika Selatan",
  NG: "Nigeria",
  DZ: "Aljazair",
  IQ: "Irak",
  JO: "Yordania",
  LB: "Lebanon",
  BH: "Bahrain",
  AU: "Australia",
  NZ: "Selandia Baru",
  CA: "Kanada",
  PT: "Portugal",
  GR: "Yunani",
  SE: "Swedia",
  NO: "Norwegia",
  DK: "Denmark",
  FI: "Finlandia",
  AT: "Austria",
  CH: "Swiss",
  BE: "Belgia",
  CZ: "Ceko",
  HU: "Hungaria",
  IE: "Irlandia",
};

let intlNames = null;
try {
  intlNames = new Intl.DisplayNames(["id"], { type: "region" });
} catch {
  intlNames = null;
}

/**
 * Mendapatkan emoji bendera negara dari kode ISO 2-huruf.
 */
export function getCountryFlag(isoCode) {
  if (!isoCode || typeof isoCode !== "string" || isoCode.length !== 2) {
    return "🌐";
  }
  const clean = isoCode.toUpperCase();
  if (!/^[A-Z]{2}$/.test(clean)) return "🌐";
  const codePoints = clean.split("").map((c) => 127397 + c.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}

/**
 * Mendapatkan nama negara dalam Bahasa Indonesia.
 */
export function getCountryIndonesianName(codeOrName) {
  const str = String(codeOrName || "").trim();
  if (!str || str === "UNKNOWN") return "-";

  let code = "";
  if (str.length === 2 && /^[A-Za-z]{2}$/.test(str)) {
    code = str.toUpperCase();
  } else {
    const m = str.match(/\b([A-Za-z]{2})\b/);
    if (m) code = m[1].toUpperCase();
  }

  if (code && ID_COUNTRY_NAMES[code]) {
    return ID_COUNTRY_NAMES[code];
  }

  if (code && intlNames) {
    try {
      const name = intlNames.of(code);
      if (name && name !== code) return name;
    } catch {
      // Abaikan jika tidak didukung
    }
  }

  return str;
}

/**
 * Mengelompokkan dan menghitung metrik agregat klasemen ROI per negara
 */
export function buildCountryLeaderboard(rows = [], { adTaxRate = 0, minSpendThreshold = 100000, dateWindow = null } = {}) {
  // Saring berdasarkan rentang tanggal jika ada
  let filtered = Array.isArray(rows) ? rows : [];
  if (dateWindow?.from && dateWindow?.to) {
    filtered = filtered.filter((r) => {
      const d = r.date || r.created_at || "";
      const dateStr = String(d).slice(0, 10);
      return dateStr >= dateWindow.from && dateStr <= dateWindow.to;
    });
  }

  // Tentukan batas 3 hari terakhir dari data yang ada
  const allDates = [...new Set(filtered.map((r) => String(r.date || "").slice(0, 10)).filter(Boolean))].sort();
  const recent3Dates = new Set(allDates.slice(-3));

  // Map akumulasi per kode negara
  const map = new Map();

  for (const r of filtered) {
    const rawCode = r.country_code || r.countryCode || r.isoCode || r.country || "";
    let code = String(rawCode).trim().toUpperCase();
    if (code.length > 2) {
      const m = code.match(/\b([A-Z]{2})\b/);
      if (m) code = m[1];
    }
    if (!code) continue;

    if (!map.has(code)) {
      map.set(code, {
        countryCode: code,
        countryName: getCountryIndonesianName(code),
        flag: getCountryFlag(code),
        spend: 0,
        adTax: 0,
        totalSpend: 0,
        earning: 0,
        impressions: 0,
        clicks: 0,
        daysMap: new Map(), // date -> { spend, earning, profit }
        recent3Spend: 0,
        recent3Earning: 0,
      });
    }

    const entry = map.get(code);
    const itemSpend = Number(r.spend || r.spending || 0);
    const itemEarning = Number(r.earning || r.revenue || 0);
    const itemTax = itemSpend * (adTaxRate / 100);
    const itemTotalSpend = itemSpend + itemTax;
    const itemImpr = Number(r.impressions || 0);
    const itemClicks = Number(r.clicks || 0);
    const itemDate = String(r.date || "").slice(0, 10);

    entry.spend += itemSpend;
    entry.adTax += itemTax;
    entry.totalSpend += itemTotalSpend;
    entry.earning += itemEarning;
    entry.impressions += itemImpr;
    entry.clicks += itemClicks;

    if (itemDate) {
      if (!entry.daysMap.has(itemDate)) {
        entry.daysMap.set(itemDate, { spend: 0, earning: 0 });
      }
      const dayData = entry.daysMap.get(itemDate);
      dayData.spend += itemTotalSpend;
      dayData.earning += itemEarning;

      if (recent3Dates.has(itemDate)) {
        entry.recent3Spend += itemTotalSpend;
        entry.recent3Earning += itemEarning;
      }
    }
  }

  const allItems = [];
  let hiddenCount = 0;

  for (const entry of map.values()) {
    const profit = entry.earning - entry.totalSpend;
    const roi = entry.totalSpend > 0 ? (profit / entry.totalSpend) * 100 : 0;

    const recent3Profit = entry.recent3Earning - entry.recent3Spend;
    const roi3Hari = entry.recent3Spend > 0 ? (recent3Profit / entry.recent3Spend) * 100 : roi;
    const delta = roi3Hari - roi;

    // Hitung hari untung
    let profitableDays = 0;
    const totalDays = entry.daysMap.size;
    for (const d of entry.daysMap.values()) {
      if (d.earning - d.spend > 0) profitableDays++;
    }

    const cpc = entry.clicks > 0 ? entry.totalSpend / entry.clicks : 0;
    const ecpm = entry.impressions > 0 ? (entry.earning / entry.impressions) * 1000 : 0;

    // Tentukan rekomendasi
    let recommendation = "Pertahankan";
    let recommendationTone = "neutral";
    if (roi >= 300 && delta >= -100 && profit > 0) {
      recommendation = "Naikkan";
      recommendationTone = "success";
    } else if (roi < 0 || delta < -300) {
      recommendation = "Turunkan";
      recommendationTone = "danger";
    }

    const item = {
      countryCode: entry.countryCode,
      country: entry.countryName,
      countryLabel: `${entry.countryName} (${entry.countryCode})`,
      flag: entry.flag,
      spend: entry.spend,
      adTax: entry.adTax,
      totalSpend: entry.totalSpend,
      earning: entry.earning,
      profit,
      roi,
      roi3Hari,
      delta,
      profitableDays,
      totalDays,
      daysRatio: `${profitableDays}/${totalDays}`,
      cpc,
      ecpm,
      recommendation,
      recommendationTone,
    };

    if (entry.totalSpend < minSpendThreshold) {
      hiddenCount++;
    }

    allItems.push(item);
  }

  // Filter yang tampil di tabel (hanya di atas ambang batas spend)
  const visibleItems = allItems.filter((i) => i.totalSpend >= minSpendThreshold);

  // Cari highlight sorotan
  const itemsWithSpend = allItems.filter((i) => i.totalSpend > 10000);
  
  // Paling unggul (ROI tertinggi)
  const sortedByRoi = [...itemsWithSpend].sort((a, b) => b.roi - a.roi);
  const best = sortedByRoi[0] || null;

  // ROI terendah
  const sortedByRoiAsc = [...itemsWithSpend].sort((a, b) => a.roi - b.roi);
  const lowest = sortedByRoiAsc[0] || null;

  // Sedang naik (Delta terbesar)
  const sortedByDeltaDesc = [...itemsWithSpend].sort((a, b) => b.delta - a.delta);
  const fastestRising = sortedByDeltaDesc[0] || null;

  // Sedang turun (Delta terkecil / paling negatif)
  const sortedByDeltaAsc = [...itemsWithSpend].sort((a, b) => a.delta - b.delta);
  const steepestFalling = sortedByDeltaAsc[0] || null;

  return {
    items: visibleItems.sort((a, b) => b.totalSpend - a.totalSpend),
    allItems,
    hiddenCount,
    highlights: {
      best,
      lowest,
      fastestRising,
      steepestFalling,
    },
  };
}
