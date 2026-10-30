import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import xlsx from "xlsx";

/**
 * Script Pengimpor File Excel Closing Harian (Meta Ads + Google Ad Manager)
 * Menggabungkan data seperti di roi.adsgo.live dan langsung menyimpannya ke tabel Supabase `country_roi`.
 *
 * Penggunaan:
 *   node jobs/import-country-closing-excel.js <path-meta.xlsx> <path-gam.xlsx> [subDomain] [tanggal]
 */

function loadEnv() {
  const envCandidates = [resolve(".env"), resolve("server/.env"), resolve("jobs/.env")];
  for (const envPath of envCandidates) {
    if (existsSync(envPath)) {
      const lines = readFileSync(envPath, "utf-8").split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx > 0) {
          const k = trimmed.slice(0, eqIdx).trim();
          const v = trimmed
            .slice(eqIdx + 1)
            .trim()
            .replace(/^["']|["']$/g, "");
          if (!process.env[k]) process.env[k] = v;
        }
      }
    }
  }
  if (!process.env.SUPABASE_URL && process.env.VITE_SUPABASE_URL) {
    process.env.SUPABASE_URL = process.env.VITE_SUPABASE_URL;
  }
}

loadEnv();

const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const AD_TAX_RATE = 0.05; // 5% Pajak Iklan

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("❌ SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY wajib diisi.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Kamus terjemahan Nama Negara Indonesia ke Kode ISO 2 Huruf
const ISO_BY_INDONESIAN_NAME = {
  italia: "IT",
  romania: "RO",
  polandia: "PL",
  portugal: "PT",
  yunani: "GR",
  hungaria: "HU",
  spanyol: "ES",
  lituania: "LT",
  prancis: "FR",
  slowakia: "SK",
  latvia: "LV",
  malta: "MT",
  ceko: "CZ",
  estonia: "EE",
  belgia: "BE",
  jerman: "DE",
  norwegia: "NO",
  austria: "AT",
  "united kingdom": "GB",
  "inggris raya": "GB",
  denmark: "DK",
  belanda: "NL",
  "selandia baru": "NZ",
  swiss: "CH",
  kanada: "CA",
  "amerika serikat": "US",
  australia: "AU",
  brasil: "BR",
  finlandia: "FI",
  swedia: "SE",
  irlandia: "IE",
  singapura: "SG",
  malaysia: "MY",
  indonesia: "ID",
  turki: "TR",
  mesir: "EG",
  india: "IN",
};

// Kamus Nama Bahasa Indonesia dari Kode ISO
const NAME_BY_ISO = {
  IT: "Italia",
  RO: "Romania",
  PL: "Polandia",
  PT: "Portugal",
  GR: "Yunani",
  HU: "Hungaria",
  ES: "Spanyol",
  LT: "Lituania",
  FR: "Prancis",
  SK: "Slowakia",
  LV: "Latvia",
  MT: "Malta",
  CZ: "Ceko",
  EE: "Estonia",
  BE: "Belgia",
  DE: "Jerman",
  NO: "Norwegia",
  AT: "Austria",
  GB: "United Kingdom",
  DK: "Denmark",
  NL: "Belanda",
  NZ: "Selandia Baru",
  CH: "Swiss",
  CA: "Kanada",
  US: "Amerika Serikat",
  AU: "Australia",
  BR: "Brasil",
  FI: "Finlandia",
  SE: "Swedia",
  IE: "Irlandia",
  SG: "Singapura",
  MY: "Malaysia",
  ID: "Indonesia",
  TR: "Turki",
  EG: "Mesir",
  IN: "India",
};

async function main() {
  const metaFilePath = process.argv[2];
  const gamFilePath = process.argv[3];
  const defaultSubDomain = process.argv[4] || "insurance.tiktokmodapk.net";
  const defaultDate = process.argv[5] || "2026-10-23";

  if (!metaFilePath || !gamFilePath) {
    console.log("Penggunaan: node jobs/import-country-closing-excel.js <file-meta.xlsx> <file-gam.xlsx> [subdomain] [tanggal]");
    process.exit(1);
  }

  console.log("===============================================================");
  console.log("   TIGERROI - IMPOR DATA CLOSING NEGARA (META + GAM EXCEL)");
  console.log("===============================================================");
  console.log(`File Meta : ${metaFilePath}`);
  console.log(`File GAM  : ${gamFilePath}`);
  console.log(`Subdomain : ${defaultSubDomain}`);
  console.log(`Tanggal   : ${defaultDate}`);
  console.log("---------------------------------------------------------------");

  // 1. Baca File Excel Meta Ads
  const metaWb = xlsx.readFile(metaFilePath);
  const metaSheet = metaWb.Sheets[metaWb.SheetNames[0]];
  const metaRows = xlsx.utils.sheet_to_json(metaSheet);

  const spendByCountry = new Map(); // iso -> { spend, impressions, clicks }
  for (const r of metaRows) {
    const rawCountry = String(r["Negara"] || r["Country"] || "").trim().toUpperCase();
    if (!rawCountry || rawCountry === "TOTAL") continue;

    const spend = Number(r["Jumlah yang dibelanjakan (IDR)"] || r["Amount spent (IDR)"] || r["Spend"] || 0);
    const impressions = Number(r["Impressions"] || 0);
    const clicks = Number(r["Link clicks"] || r["Clicks"] || 0);

    spendByCountry.set(rawCountry, {
      countryCode: rawCountry,
      spend,
      impressions,
      clicks,
    });
  }
  console.log(`✅ Berhasil membaca ${spendByCountry.size} negara dari file Meta Ads.`);

  // 2. Baca File Excel GAM / AdSense
  const gamWb = xlsx.readFile(gamFilePath);
  const gamSheet = gamWb.Sheets[gamWb.SheetNames[0]];
  const gamRows = xlsx.utils.sheet_to_json(gamSheet);

  const earnByCountry = new Map(); // iso -> { earning, impressions, clicks, countryName }
  for (const r of gamRows) {
    const rawCountry = String(r["Country"] || r["Negara"] || "").trim();
    if (!rawCountry || rawCountry.toLowerCase() === "total") continue;

    const lower = rawCountry.toLowerCase();
    const isoCode = ISO_BY_INDONESIAN_NAME[lower] || rawCountry.toUpperCase();
    const earning = Number(r["Total Revenue"] || r["Earnings"] || r["Pendapatan"] || 0);
    const impressions = Number(r["Ad impressions"] || r["Impressions"] || 0);
    const clicks = Number(r["Clicks"] || 0);

    earnByCountry.set(isoCode, {
      countryCode: isoCode,
      countryName: NAME_BY_ISO[isoCode] || rawCountry,
      earning,
      impressions,
      clicks,
    });
  }
  console.log(`✅ Berhasil membaca ${earnByCountry.size} negara dari file Google Ad Manager.`);

  // 3. Gabungkan keduanya
  const allCodes = new Set([...spendByCountry.keys(), ...earnByCountry.keys()]);
  const records = [];

  let totalMetaSpend = 0;
  let totalAdTax = 0;
  let totalGAMRevenue = 0;

  for (const code of allCodes) {
    const metaItem = spendByCountry.get(code) || {};
    const gamItem = earnByCountry.get(code) || {};

    const countryName = gamItem.countryName || NAME_BY_ISO[code] || code;
    const spend = Number(metaItem.spend || 0);
    const earning = Number(gamItem.earning || 0);
    const impressions = Number(gamItem.impressions || metaItem.impressions || 0);
    const clicks = Number(metaItem.clicks || gamItem.clicks || 0);

    const adTax = spend * AD_TAX_RATE;
    const totalSpending = spend + adTax;
    const profit = earning - totalSpending;
    const roi = totalSpending > 0 ? ((earning - totalSpending) / totalSpending) * 100 : 0;
    const cpc = clicks > 0 ? (spend > 0 ? spend / clicks : earning / clicks) : 0;

    totalMetaSpend += spend;
    totalAdTax += adTax;
    totalGAMRevenue += earning;

    records.push({
      date: defaultDate,
      sub_domain: defaultSubDomain,
      country_code: code,
      country_name: countryName,
      spend: Math.round(spend * 100) / 100,
      impressions,
      clicks,
      cpc: Math.round(cpc * 100) / 100,
      earning: Math.round(earning * 100) / 100,
      profit: Math.round(profit * 100) / 100,
      roi: Math.round(roi * 100) / 100,
    });
  }

  // Urutkan dari spend tertinggi
  records.sort((a, b) => b.spend - a.spend);

  console.log("\n---------------------------------------------------------------");
  console.log(`Total Spend Meta : Rp ${Math.round(totalMetaSpend).toLocaleString("id-ID")}`);
  console.log(`Total Ad Tax 5%  : Rp ${Math.round(totalAdTax).toLocaleString("id-ID")}`);
  console.log(`Total Spending   : Rp ${Math.round(totalMetaSpend + totalAdTax).toLocaleString("id-ID")}`);
  console.log(`Total Earning GAM: Rp ${Math.round(totalGAMRevenue).toLocaleString("id-ID")}`);
  const overallRoi = totalMetaSpend + totalAdTax > 0
    ? (((totalGAMRevenue - (totalMetaSpend + totalAdTax)) / (totalMetaSpend + totalAdTax)) * 100).toFixed(2)
    : 0;
  console.log(`Overall ROI      : +${overallRoi}%`);
  console.log("---------------------------------------------------------------");

  // 4. Upsert ke Supabase
  console.log(`Menyimpan ${records.length} baris ke tabel Supabase 'country_roi'...`);
  const { error: upsertErr } = await supabase.from("country_roi").upsert(records, {
    onConflict: "date,sub_domain,country_code",
  });

  if (upsertErr) {
    console.error(`❌ Gagal menyimpan ke Supabase: ${upsertErr.message}`);
    process.exit(1);
  }

  console.log(`🎉 SUKSES! Data closing negara berhasil disimpan ke Supabase.`);
  console.log(`Buka dashboard TigerROI masdef dan segarkan tab Laporan ROI untuk melihat hasilnya!`);
}

main().catch((e) => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
