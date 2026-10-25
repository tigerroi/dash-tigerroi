/**
 * Pengurai dan Validator CSV Laporan Keitaro untuk TigerROI
 *
 * Mengolah ekspor CSV dari Keitaro Tracker (laporan kampanye, sub_id, atau klik harian)
 * dan memvalidasi serta memetakan barisnya ke format tabel `daily_stats` (source = 'keitaro').
 */

/**
 * Deteksi delimiter utama dari baris header CSV (koma, titik koma, atau tab)
 */
export function detectDelimiter(headerLine) {
  const commas = (headerLine.match(/,/g) || []).length;
  const semicolons = (headerLine.match(/;/g) || []).length;
  const tabs = (headerLine.match(/\t/g) || []).length;

  if (semicolons > commas && semicolons > tabs) return ";";
  if (tabs > commas && tabs > semicolons) return "\t";
  return ",";
}

/**
 * Pengurai baris CSV standar RFC-4180
 * Menangani teks berpetik, kutipan di dalam teks (""), dan pemisah dinamis.
 */
export function parseCsvRows(text, delimiter = ",") {
  const rows = [];
  let currentRow = [];
  let currentVal = "";
  let insideQuotes = false;
  let i = 0;

  const len = text.length;
  while (i < len) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        currentVal += '"';
        i += 2;
        continue;
      }
      insideQuotes = !insideQuotes;
      i++;
      continue;
    }

    if (!insideQuotes && char === delimiter) {
      currentRow.push(currentVal.trim());
      currentVal = "";
      i++;
      continue;
    }

    if (!insideQuotes && (char === "\r" || char === "\n")) {
      currentRow.push(currentVal.trim());
      currentVal = "";
      if (currentRow.some((c) => c !== "")) {
        rows.push(currentRow);
      }
      currentRow = [];
      if (char === "\r" && nextChar === "\n") i++;
      i++;
      continue;
    }

    currentVal += char;
    i++;
  }

  if (currentVal !== "" || currentRow.length > 0) {
    currentRow.push(currentVal.trim());
    if (currentRow.some((c) => c !== "")) {
      rows.push(currentRow);
    }
  }

  return rows;
}

/**
 * Normalisasi header kolom untuk pencocokan toleran huruf besar/kecil dan karakter khusus
 */
function cleanKey(header) {
  return String(header || "")
    .toLowerCase()
    .replace(/[\s_\-]/g, "")
    .trim();
}

/**
 * Deteksi indeks kolom berdasarkan nama header yang umum di Keitaro
 */
export function detectColumnIndices(headers) {
  const map = {
    date: -1,
    site: -1,
    sub_id_1: -1,
    sub_id_2: -1,
    campaign: -1,
    clicks: -1,
    impressions: -1,
    cost: -1,
    revenue: -1,
    conversions: -1,
  };

  headers.forEach((h, index) => {
    const k = cleanKey(h);

    // Tanggal
    if (map.date === -1 && (k === "date" || k === "datetime" || k === "day" || k === "tanggal" || k === "dayofmonth")) {
      map.date = index;
    }
    // Kolom Situs Eksplisit
    else if (map.site === -1 && (k === "site" || k === "sitecode" || k === "kodesitus" || k === "domain" || k === "hostname")) {
      map.site = index;
    }
    // Sub ID 1 (umumnya berisi site_code di parameter URL Keitaro)
    else if (map.sub_id_1 === -1 && (k === "subid1" || k === "subid" || k === "sub1")) {
      map.sub_id_1 = index;
    }
    // Sub ID 2
    else if (map.sub_id_2 === -1 && (k === "subid2" || k === "sub2")) {
      map.sub_id_2 = index;
    }
    // Campaign Name
    else if (map.campaign === -1 && (k === "campaign" || k === "campaignname" || k === "kampanye" || k === "namakampanye")) {
      map.campaign = index;
    }
    // Clicks
    else if (map.clicks === -1 && (k === "clicks" || k === "rawclicks" || k === "uniqueclicks" || k === "klik")) {
      map.clicks = index;
    }
    // Impressions
    else if (map.impressions === -1 && (k === "impressions" || k === "penayangan" || k === "impresi" || k === "views")) {
      map.impressions = index;
    }
    // Cost / Spend
    else if (map.cost === -1 && (k === "cost" || k === "spend" || k === "biaya" || k === "pengeluaran" || k === "adspend")) {
      map.cost = index;
    }
    // Revenue
    else if (map.revenue === -1 && (k === "revenue" || k === "pendapatan" || k === "income" || k === "omset")) {
      map.revenue = index;
    }
    // Conversions
    else if (map.conversions === -1 && (k === "conversions" || k === "leads" || k === "sales" || k === "konversi")) {
      map.conversions = index;
    }
  });

  return map;
}

/**
 * Normalisasi format tanggal Keitaro ke format standar YYYY-MM-DD
 */
export function normalizeDate(raw) {
  if (!raw) return null;
  const str = String(raw).trim();

  // YYYY-MM-DD atau YYYY-MM-DD HH:mm:ss
  const isoMatch = str.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  // DD.MM.YYYY atau DD/MM/YYYY atau DD-MM-YYYY
  const dmyMatch = str.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (dmyMatch) {
    const [, d, m, y] = dmyMatch;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  const parsed = new Date(str);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().split("T")[0];
  }

  return null;
}

/**
 * Membersihkan angka dari simbol mata uang, pemisah ribuan, atau koma desimal
 */
export function parseNumeric(raw, fallback = 0) {
  if (raw === undefined || raw === null || raw === "") return fallback;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : fallback;

  const str = String(raw).trim();
  const isRupiah = /rp/i.test(str);
  let clean = str.replace(/[$\sRp€]/gi, "").trim();

  // Jika format Rupiah (contoh: Rp 50.000) atau ribuan bertitik berulang (1.500.000)
  if (isRupiah && /^\d{1,3}(?:\.\d{3})*(?:,\d+)?$/.test(clean)) {
    clean = clean.replace(/\./g, "").replace(",", ".");
  } else if (clean.includes(",") && clean.includes(".")) {
    // Menangani format Eropa vs US yang punya koma dan titik
    if (clean.lastIndexOf(",") > clean.lastIndexOf(".")) {
      // Format Eropa: 1.234,56
      clean = clean.replace(/\./g, "").replace(",", ".");
    } else {
      // Format US: 1,234.56
      clean = clean.replace(/,/g, "");
    }
  } else if (clean.includes(",")) {
    // Hanya ada koma: 123,45
    clean = clean.replace(",", ".");
  }

  const n = parseFloat(clean);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Ekstraksi token dari URL atau query string (?site=xxx atau ?sub_id=xxx)
 */
function extractFromUrlParam(text) {
  if (!text || typeof text !== "string") return null;
  const match = text.match(/[?&](?:site|sub_id|sub_id_1)=([^&#\s]+)/i);
  return match ? decodeURIComponent(match[1]).toLowerCase() : null;
}

/**
 * Pencocokan Site Code TigerROI berdasarkan aturan hierarki yang ketat
 */
export function matchSiteCode(candidates, sitesList = []) {
  if (!Array.isArray(candidates)) {
    candidates = [candidates].filter(Boolean);
  }

  const cleanCandidates = candidates
    .map((c) => String(c || "").trim())
    .filter(Boolean);

  if (cleanCandidates.length === 0 || !sitesList || sitesList.length === 0) {
    return null;
  }

  // 1. Prioritas Utama: Pencocokan Langsung (Exact Match) ke site_code
  for (const cand of cleanCandidates) {
    const candLower = cand.toLowerCase();
    const candNormalized = candLower.replace(/[\s_\-]/g, "");

    for (const site of sitesList) {
      if (!site.site_code) continue;
      const codeLower = site.site_code.toLowerCase();
      const codeNormalized = codeLower.replace(/[\s_\-]/g, "");

      if (candLower === codeLower || candNormalized === codeNormalized) {
        return site.site_code;
      }
    }
  }

  // 2. Prioritas Kedua: Ekstraksi dari parameter URL (misal: ?site=ihop-menu)
  for (const cand of cleanCandidates) {
    const paramVal = extractFromUrlParam(cand);
    if (paramVal) {
      for (const site of sitesList) {
        if (!site.site_code) continue;
        const codeLower = site.site_code.toLowerCase();
        if (paramVal === codeLower || paramVal.replace(/[\s_\-]/g, "") === codeLower.replace(/[\s_\-]/g, "")) {
          return site.site_code;
        }
      }
    }
  }

  // 3. Prioritas Ketiga: Pencocokan Pola Campaign Keitaro (campaign_pattern)
  // Contoh: kode 4-karakter Keitaro "pBRw" atau keyword di tabel sites
  for (const cand of cleanCandidates) {
    const candLower = cand.toLowerCase();

    for (const site of sitesList) {
      if (!site.campaign_pattern) continue;
      const patterns = String(site.campaign_pattern)
        .split(",")
        .map((p) => p.trim().toLowerCase())
        .filter(Boolean);

      for (const pat of patterns) {
        if (pat && candLower.includes(pat)) {
          return site.site_code;
        }
      }
    }
  }

  // 4. Prioritas Keempat: Pencocokan Nama Domain / Hostname
  // Contoh: "ACA T2 (WL) pBRw (ihopmenuwithprices.us)" -> domain ihopmenuwithprices.us
  for (const cand of cleanCandidates) {
    const candLower = cand.toLowerCase();

    for (const site of sitesList) {
      if (!site.domain) continue;
      const domainLower = site.domain.toLowerCase().trim();
      if (domainLower && candLower.includes(domainLower)) {
        return site.site_code;
      }
    }
  }

  // 5. Prioritas Kelima: Substring site_code di dalam nama campaign
  for (const cand of cleanCandidates) {
    const candLower = cand.toLowerCase();

    for (const site of sitesList) {
      if (!site.site_code) continue;
      const codeLower = site.site_code.toLowerCase();
      if (candLower.includes(codeLower)) {
        return site.site_code;
      }
    }
  }

  return null;
}

/**
 * Memproses dan memvalidasi seluruh konten CSV Keitaro
 *
 * @param {string} csvText - Teks isi file CSV
 * @param {Array} sitesList - Daftar baris dari tabel public.sites
 * @param {Object} [options] - Opsi tambahan (defaultDate jika baris CSV tidak punya kolom tanggal)
 */
export function processKeitaroCsv(csvText, sitesList = [], options = {}) {
  if (!csvText || typeof csvText !== "string" || !csvText.trim()) {
    return {
      success: false,
      error: "Isi file CSV kosong atau tidak terbaca.",
      summary: null,
      dailyStats: [],
      unmatched: [],
      errors: [],
    };
  }

  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    return {
      success: false,
      error: "File CSV harus memiliki minimal 1 baris header dan 1 baris data.",
      summary: null,
      dailyStats: [],
      unmatched: [],
      errors: [],
    };
  }

  const delimiter = detectDelimiter(lines[0]);
  const rows = parseCsvRows(csvText, delimiter);

  if (rows.length < 2) {
    return {
      success: false,
      error: "Tidak ada baris data valid yang ditemukan setelah parsing.",
      summary: null,
      dailyStats: [],
      unmatched: [],
      errors: [],
    };
  }

  const headers = rows[0];
  const col = detectColumnIndices(headers);

  // Validasi kolom minimal
  const hasIdentifier = col.site !== -1 || col.sub_id_1 !== -1 || col.campaign !== -1;
  if (!hasIdentifier) {
    return {
      success: false,
      error:
        "CSV Keitaro wajib memiliki minimal satu kolom pengenal: 'Campaign', 'Sub ID 1', 'site', atau 'site_code'. Kolom yang terdeteksi: " +
        headers.join(", "),
      summary: null,
      dailyStats: [],
      unmatched: [],
      errors: [],
    };
  }

  const unmatched = [];
  const errors = [];
  const aggregatedMap = new Map(); // key: `${date}:${site_code}`

  let totalClicks = 0;
  let totalCost = 0;
  let totalRevenue = 0;

  // Baca baris data (mulai dari index 1)
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const rowNumber = r + 1;

    // Ambil tanggal
    let rowDate = col.date !== -1 ? normalizeDate(row[col.date]) : null;
    if (!rowDate) {
      if (options.defaultDate) {
        rowDate = normalizeDate(options.defaultDate);
      } else {
        errors.push({
          rowNumber,
          data: row,
          message: `Kolom tanggal tidak valid atau kosong pada baris ${rowNumber}.`,
        });
        continue;
      }
    }

    // Kumpulkan kandidat identifier
    const candidates = [];
    if (col.site !== -1 && row[col.site]) candidates.push(row[col.site]);
    if (col.sub_id_1 !== -1 && row[col.sub_id_1]) candidates.push(row[col.sub_id_1]);
    if (col.sub_id_2 !== -1 && row[col.sub_id_2]) candidates.push(row[col.sub_id_2]);
    if (col.campaign !== -1 && row[col.campaign]) candidates.push(row[col.campaign]);

    const matchedSiteCode = matchSiteCode(candidates, sitesList);

    if (!matchedSiteCode) {
      unmatched.push({
        rowNumber,
        candidates,
        rowData: row,
        message: `Tidak dapat mencocokkan ke site_code TigerROI manapun untuk kandidat: [${candidates.join(", ")}]`,
      });
      continue;
    }

    // Ambil metrik
    const clicks = col.clicks !== -1 ? Math.round(parseNumeric(row[col.clicks], 0)) : 0;
    const impressions =
      col.impressions !== -1 ? Math.round(parseNumeric(row[col.impressions], clicks)) : clicks;
    const cost = col.cost !== -1 ? parseNumeric(row[col.cost], 0) : 0;
    const revenue = col.revenue !== -1 ? parseNumeric(row[col.revenue], 0) : 0;
    const conversions = col.conversions !== -1 ? Math.round(parseNumeric(row[col.conversions], 0)) : 0;

    totalClicks += clicks;
    totalCost += cost;
    totalRevenue += revenue;

    // Agregasi per (date, site_code)
    const aggKey = `${rowDate}:${matchedSiteCode}`;
    if (!aggregatedMap.has(aggKey)) {
      aggregatedMap.set(aggKey, {
        date: rowDate,
        site_code: matchedSiteCode,
        source: "keitaro",
        clicks: 0,
        impressions: 0,
        spend: 0,
        revenue: 0,
        conversions: 0,
        campaigns: new Set(),
        rawRowCount: 0,
      });
    }

    const current = aggregatedMap.get(aggKey);
    current.clicks += clicks;
    current.impressions += impressions;
    current.spend += cost;
    current.revenue += revenue;
    current.conversions += conversions;
    current.rawRowCount += 1;

    if (col.campaign !== -1 && row[col.campaign]) {
      current.campaigns.add(String(row[col.campaign]).trim());
    }
  }

  // Format ke baris daily_stats
  const dailyStats = [];
  for (const item of aggregatedMap.values()) {
    const spend = Number(item.spend.toFixed(2));
    const revenue = Number(item.revenue.toFixed(2));
    const profit = Number((revenue - spend).toFixed(2));
    const roi_percent = spend > 0 ? Number((((revenue - spend) / spend) * 100).toFixed(2)) : 0;
    const cpc = item.clicks > 0 ? Number((spend / item.clicks).toFixed(4)) : 0;

    dailyStats.push({
      date: item.date,
      site_code: item.site_code,
      source: "keitaro",
      clicks: item.clicks,
      impressions: item.impressions,
      spend,
      revenue,
      roi_percent,
      cpc,
      campaign_count: item.campaigns.size || 1,
      metadata: {
        profit,
        import_source: "keitaro_csv",
        imported_at: new Date().toISOString(),
        raw_rows_merged: item.rawRowCount,
        conversions: item.conversions,
        campaign_names: Array.from(item.campaigns),
      },
    });
  }

  // Urutkan berdasarkan tanggal descending lalu site_code
  dailyStats.sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    return a.site_code.localeCompare(b.site_code);
  });

  return {
    success: dailyStats.length > 0 || unmatched.length > 0,
    summary: {
      totalInputLines: rows.length - 1,
      validAggregatedRows: dailyStats.length,
      unmatchedRows: unmatched.length,
      errorRows: errors.length,
      totalClicks,
      totalSpend: Number(totalCost.toFixed(2)),
      totalRevenue: Number(totalRevenue.toFixed(2)),
      detectedDelimiter: delimiter === "\t" ? "\\t" : delimiter,
      detectedColumns: {
        date: col.date !== -1 ? headers[col.date] : "(default)",
        site: col.site !== -1 ? headers[col.site] : null,
        sub_id_1: col.sub_id_1 !== -1 ? headers[col.sub_id_1] : null,
        campaign: col.campaign !== -1 ? headers[col.campaign] : null,
        clicks: col.clicks !== -1 ? headers[col.clicks] : null,
        cost: col.cost !== -1 ? headers[col.cost] : null,
        revenue: col.revenue !== -1 ? headers[col.revenue] : null,
      },
    },
    dailyStats,
    unmatched,
    errors,
  };
}
