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

const INDONESIAN_DAYS = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
const INDONESIAN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

/**
 * Format tanggal Indonesia singkat untuk header kolom heatmap: "Min 18 Okt"
 */
export function formatIndonesianDayDate(isoDateStr) {
  if (!isoDateStr) return "";
  const parts = String(isoDateStr).slice(0, 10).split("-");
  if (parts.length < 3) return isoDateStr;
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  if (!y || !m || !d) return isoDateStr;
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dayName = INDONESIAN_DAYS[dt.getUTCDay()] || "";
  const monthName = INDONESIAN_MONTHS[m - 1] || "";
  return `${dayName} ${d} ${monthName}`;
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

/**
 * Menentukan kategori warna heatmap berdasarkan nilai ROI dan spend
 */
export function getRoiHeatmapCategory(roi, totalSpend) {
  if (totalSpend === undefined || totalSpend === null || totalSpend < 1000) {
    return "none"; // tanpa ROI (belanja < Rp 1.000)
  }
  if (roi < -60) return "severe-loss"; // < -60%
  if (roi < -30) return "medium-loss"; // -60 s/d -30%
  if (roi < 0) return "light-loss"; // -30 s/d 0%
  if (roi < 30) return "low-profit"; // 0 s/d 30%
  if (roi < 100) return "medium-profit"; // 30 s/d 100%
  return "high-profit"; // >= 100%
}

/**
 * Membangun data untuk Heatmap ROI Harian per Negara
 */
export function buildCountryDailyHeatmap(rows = [], { adTaxRate = 0, dateWindow = null } = {}) {
  let filtered = Array.isArray(rows) ? rows : [];
  if (dateWindow?.from && dateWindow?.to) {
    filtered = filtered.filter((r) => {
      const d = String(r.date || r.created_at || "").slice(0, 10);
      return d >= dateWindow.from && d <= dateWindow.to;
    });
  }

  // Cari semua tanggal unik dan urutkan menaik
  const dates = [...new Set(filtered.map((r) => String(r.date || "").slice(0, 10)).filter(Boolean))].sort();
  const lastDate = dates[dates.length - 1] || "";

  // Agregasi Total per tanggal
  const totalPerDate = new Map();
  dates.forEach((d) => totalPerDate.set(d, { spend: 0, earning: 0, profit: 0, roi: 0 }));

  // Agregasi per negara dan tanggal
  const countryMap = new Map();

  for (const r of filtered) {
    const rawCode = r.country_code || r.countryCode || r.isoCode || r.country || "";
    let code = String(rawCode).trim().toUpperCase();
    if (code.length > 2) {
      const m = code.match(/\b([A-Z]{2})\b/);
      if (m) code = m[1];
    }
    if (!code) continue;

    const itemDate = String(r.date || "").slice(0, 10);
    if (!itemDate || !totalPerDate.has(itemDate)) continue;

    const itemSpend = Number(r.spend || r.spending || 0);
    const itemEarning = Number(r.earning || r.revenue || 0);
    const itemTax = itemSpend * (adTaxRate / 100);
    const itemTotalSpend = itemSpend + itemTax;
    const subDomain = String(r.sub_domain || r.subDomain || "").trim();

    // Update total per date
    const tot = totalPerDate.get(itemDate);
    tot.spend += itemTotalSpend;
    tot.earning += itemEarning;

    if (!countryMap.has(code)) {
      countryMap.set(code, {
        countryCode: code,
        countryName: getCountryIndonesianName(code),
        flag: getCountryFlag(code),
        totalSpend: 0,
        days: new Map(), // date -> { spend, earning, subdomains: Map(name -> { spend, earning }) }
      });
    }

    const cEntry = countryMap.get(code);
    cEntry.totalSpend += itemTotalSpend;

    if (!cEntry.days.has(itemDate)) {
      cEntry.days.set(itemDate, { spend: 0, earning: 0, subdomains: new Map() });
    }
    const dayData = cEntry.days.get(itemDate);
    dayData.spend += itemTotalSpend;
    dayData.earning += itemEarning;

    if (subDomain) {
      if (!dayData.subdomains.has(subDomain)) {
        dayData.subdomains.set(subDomain, { name: subDomain, spend: 0, earning: 0 });
      }
      const sData = dayData.subdomains.get(subDomain);
      sData.spend += itemTotalSpend;
      sData.earning += itemEarning;
    }
  }

  // Hitung total row
  const totalRow = {
    label: "Total",
    days: {},
  };
  dates.forEach((d) => {
    const tot = totalPerDate.get(d);
    tot.profit = tot.earning - tot.spend;
    tot.roi = tot.spend > 0 ? (tot.profit / tot.spend) * 100 : 0;
    totalRow.days[d] = {
      date: d,
      spend: tot.spend,
      earning: tot.earning,
      profit: tot.profit,
      roi: tot.roi,
      category: getRoiHeatmapCategory(tot.roi, tot.spend),
      isPartial: d === lastDate,
    };
  });

  // Susun baris tiap negara
  const countryRows = [];
  for (const c of countryMap.values()) {
    const row = {
      countryCode: c.countryCode,
      countryName: c.countryName,
      flag: c.flag,
      totalSpend: c.totalSpend,
      days: {},
    };

    dates.forEach((d) => {
      const dData = c.days.get(d);
      if (dData && dData.spend > 0) {
        const profit = dData.earning - dData.spend;
        const roi = (profit / dData.spend) * 100;
        const subList = Array.from(dData.subdomains.values()).map((s) => ({
          name: s.name,
          spend: s.spend,
          earning: s.earning,
          profit: s.earning - s.spend,
          roi: s.spend > 0 ? ((s.earning - s.spend) / s.spend) * 100 : 0,
        })).sort((a, b) => b.spend - a.spend);

        row.days[d] = {
          date: d,
          spend: dData.spend,
          earning: dData.earning,
          profit,
          roi,
          category: getRoiHeatmapCategory(roi, dData.spend),
          isPartial: d === lastDate,
          subdomains: subList,
        };
      } else {
        row.days[d] = {
          date: d,
          spend: 0,
          earning: 0,
          profit: 0,
          roi: null,
          category: "none",
          isPartial: d === lastDate,
          subdomains: [],
        };
      }
    });

    countryRows.push(row);
  }

  // Urutkan negara berdasarkan total spend terbesar
  countryRows.sort((a, b) => b.totalSpend - a.totalSpend);

  return {
    dates,
    lastDate,
    totalRow,
    countryRows,
  };
}

/**
 * Membangun titik data deret Kurva ROI Harian untuk Recharts
 */
export function buildCountryRoiCurves(rows = [], { adTaxRate = 0, dateWindow = null } = {}) {
  let filtered = Array.isArray(rows) ? rows : [];
  if (dateWindow?.from && dateWindow?.to) {
    filtered = filtered.filter((r) => {
      const d = String(r.date || r.created_at || "").slice(0, 10);
      return d >= dateWindow.from && d <= dateWindow.to;
    });
  }

  const dates = [...new Set(filtered.map((r) => String(r.date || "").slice(0, 10)).filter(Boolean))].sort();

  // Akumulasi negara
  const countryTotals = new Map();
  const dateCountryMap = new Map(); // `${date}__${code}` -> { spend, earning }

  for (const r of filtered) {
    const rawCode = r.country_code || r.countryCode || r.isoCode || r.country || "";
    let code = String(rawCode).trim().toUpperCase();
    if (code.length > 2) {
      const m = code.match(/\b([A-Z]{2})\b/);
      if (m) code = m[1];
    }
    if (!code) continue;

    const itemDate = String(r.date || "").slice(0, 10);
    if (!itemDate) continue;

    const itemSpend = Number(r.spend || r.spending || 0);
    const itemEarning = Number(r.earning || r.revenue || 0);
    const itemTax = itemSpend * (adTaxRate / 100);
    const itemTotalSpend = itemSpend + itemTax;

    if (!countryTotals.has(code)) {
      countryTotals.set(code, {
        code,
        name: getCountryIndonesianName(code),
        flag: getCountryFlag(code),
        totalSpend: 0,
      });
    }
    countryTotals.get(code).totalSpend += itemTotalSpend;

    const key = `${itemDate}__${code}`;
    if (!dateCountryMap.has(key)) {
      dateCountryMap.set(key, { spend: 0, earning: 0 });
    }
    const cell = dateCountryMap.get(key);
    cell.spend += itemTotalSpend;
    cell.earning += itemEarning;
  }

  // Urutkan series berdasarkan total spend
  const sortedCountries = Array.from(countryTotals.values()).sort((a, b) => b.totalSpend - a.totalSpend);
  const series = sortedCountries.map((c) => ({
    key: `roi_${c.code}`,
    code: c.code,
    name: c.name,
    label: c.name,
    flag: c.flag,
    totalSpend: c.totalSpend,
  }));

  // Buat array points untuk setiap tanggal
  const points = dates.map((d) => {
    const pt = {
      stamp: d,
      date: d,
      label: formatIndonesianDayDate(d),
    };

    series.forEach((s) => {
      const key = `${d}__${s.code}`;
      const data = dateCountryMap.get(key);
      if (data && data.spend >= 1000) {
        const profit = data.earning - data.spend;
        const roi = (profit / data.spend) * 100;
        pt[s.key] = Number(roi.toFixed(1));
        pt[`${s.key}__spend`] = data.spend;
        pt[`${s.key}__profit`] = profit;
        pt[`${s.key}__earning`] = data.earning;
      } else {
        pt[s.key] = null;
        pt[`${s.key}__spend`] = 0;
        pt[`${s.key}__profit`] = 0;
        pt[`${s.key}__earning`] = 0;
      }
    });

    return pt;
  });

  return {
    dates,
    series,
    points,
  };
}

/**
 * Membangun tabel "Prioritas penurunan anggaran - 3 hari terakhir"
 * Pasangan negara x subdomain yang rugi, rugi terbesar dulu.
 */
export function buildBudgetCutPriorities(rows = [], { subDomains = [], adTaxRate = 0, recentDays = 3 } = {}) {
  const allFiltered = Array.isArray(rows) ? rows : [];
  if (allFiltered.length === 0) return [];

  // Cari semua tanggal unik berurutan
  const allDates = [...new Set(allFiltered.map((r) => String(r.date || "").slice(0, 10)).filter(Boolean))].sort();
  if (allDates.length === 0) return [];

  // 3 hari terakhir
  const target3Dates = new Set(allDates.slice(-recentDays));

  // Buat mapping subdomain -> PIC
  const subDomainPicMap = new Map();
  if (Array.isArray(subDomains)) {
    subDomains.forEach((s) => {
      const name = String(s?.name || "").trim().toLowerCase();
      const pic = String(s?.pic || s?.advertiser || s?.user_name || "").trim();
      if (name && pic) {
        subDomainPicMap.set(name, pic);
      }
    });
  }

  // Kumpulkan histori harian per pasangan `${code}__${subDomain}` untuk hitung rugi beruntun
  // pairHistory: Map(pairKey -> Map(date -> { spend, earning, profit }))
  const pairHistory = new Map();
  // pair3Days: Map(pairKey -> { code, subDomain, spend, earning })
  const pair3Days = new Map();

  for (const r of allFiltered) {
    const rawCode = r.country_code || r.countryCode || r.isoCode || r.country || "";
    let code = String(rawCode).trim().toUpperCase();
    if (code.length > 2) {
      const m = code.match(/\b([A-Z]{2})\b/);
      if (m) code = m[1];
    }
    const subDomain = String(r.sub_domain || r.subDomain || "").trim();
    if (!code || !subDomain) continue;

    const itemDate = String(r.date || "").slice(0, 10);
    if (!itemDate) continue;

    const itemSpend = Number(r.spend || r.spending || 0);
    const itemEarning = Number(r.earning || r.revenue || 0);
    const itemTax = itemSpend * (adTaxRate / 100);
    const itemTotalSpend = itemSpend + itemTax;
    const itemProfit = itemEarning - itemTotalSpend;

    const pairKey = `${code}__${subDomain.toLowerCase()}`;

    // Riwayat harian
    if (!pairHistory.has(pairKey)) {
      pairHistory.set(pairKey, new Map());
    }
    const dMap = pairHistory.get(pairKey);
    if (!dMap.has(itemDate)) {
      dMap.set(itemDate, { spend: 0, earning: 0, profit: 0 });
    }
    const dayStat = dMap.get(itemDate);
    dayStat.spend += itemTotalSpend;
    dayStat.earning += itemEarning;
    dayStat.profit += itemProfit;

    // 3 hari terakhir akumulasi
    if (target3Dates.has(itemDate)) {
      if (!pair3Days.has(pairKey)) {
        pair3Days.set(pairKey, {
          pairKey,
          code,
          subDomain,
          totalSpend: 0,
          earning: 0,
        });
      }
      const p3 = pair3Days.get(pairKey);
      p3.totalSpend += itemTotalSpend;
      p3.earning += itemEarning;
    }
  }

  const results = [];

  for (const p3 of pair3Days.values()) {
    const profit = p3.earning - p3.totalSpend;
    // Hanya ambil yang rugi (profit < 0)
    if (profit >= 0) continue;

    const roi = p3.totalSpend > 0 ? (profit / p3.totalSpend) * 100 : 0;

    // Hitung rugi beruntun: mundur dari tanggal paling baru
    const dMap = pairHistory.get(p3.pairKey);
    let consecutiveLossDays = 0;
    for (let i = allDates.length - 1; i >= 0; i--) {
      const d = allDates[i];
      const dStat = dMap?.get(d);
      if (dStat && dStat.spend > 0) {
        if (dStat.profit < 0) {
          consecutiveLossDays++;
        } else {
          // Begitu ada hari untung, rangkaian rugi beruntun terputus
          break;
        }
      } else {
        // Jika tidak ada spend di hari tersebut, hentikan rantai
        break;
      }
    }

    const subKey = p3.subDomain.toLowerCase();
    const pic = subDomainPicMap.get(subKey) || "Tim";

    results.push({
      countryCode: p3.code,
      country: getCountryIndonesianName(p3.code),
      flag: getCountryFlag(p3.code),
      subDomain: p3.subDomain,
      pic,
      totalSpend: p3.totalSpend,
      earning: p3.earning,
      profit,
      roi,
      consecutiveLossDays: Math.max(1, consecutiveLossDays),
    });
  }

  // Urutkan dari rugi terbesar dulu (profit paling negatif)
  results.sort((a, b) => a.profit - b.profit);

  return results;
}
