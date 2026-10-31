#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { matchSiteCode } from "../src/lib/keitaroCsvParser.js";

/**
 * TigerROI - Sinkronisasi Otomatis Keitaro Expert Tracker via Admin API
 *
 * Mengambil data laporan kampanye, klik, biaya iklan, dan konversi dari
 * Keitaro Tracker (https://appscity.tech/admin_api/v1) dan menyimpannya ke Supabase (daily_stats).
 *
 * Penggunaan:
 *   node jobs/sync-keitaro.js [--days=1] [--dry-run]
 */

function loadEnv() {
  const envCandidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "server", ".env"),
    path.resolve(process.cwd(), "jobs", ".env"),
  ];

  for (const envPath of envCandidates) {
    if (fs.existsSync(envPath)) {
      const lines = fs.readFileSync(envPath, "utf-8").split("\n");
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
const KEITARO_URL = (process.env.KEITARO_URL || "https://appscity.tech").replace(/\/+$/, "");
const KEITARO_API_KEY = process.env.KEITARO_API_KEY || "";

const args = process.argv.slice(2);
const isDryRun = args.includes("--dry-run");
const daysArg = args.find((a) => a.startsWith("--days="));
const daysCount = daysArg ? Math.max(1, parseInt(daysArg.split("=")[1], 10) || 1) : 1;

function getDateRange(days) {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - (days - 1));

  const format = (d) => d.toISOString().slice(0, 10);
  return { from: format(from), to: format(to) };
}

async function fetchKeitaroReport(from, to) {
  const endpoint = `${KEITARO_URL}/admin_api/v1/report/build`;
  console.log(`🌐 Mengambil laporan dari Keitaro Admin API: ${endpoint}`);
  console.log(`   Rentang tanggal: ${from} s/d ${to}`);

  const payload = {
    range: {
      from,
      to,
      timezone: "Asia/Jakarta",
    },
    columns: [
      "campaign_id",
      "campaign",
      "sub_id_1",
      "clicks",
      "cost",
      "revenue",
      "conversions",
    ],
    grouping: ["day", "campaign_id"],
    filters: [],
  };

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Api-Key": KEITARO_API_KEY,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Keitaro API Error (${res.status} ${res.statusText}): ${errorText}`);
  }

  const json = await res.json();
  return Array.isArray(json?.rows) ? json.rows : Array.isArray(json) ? json : [];
}

async function run() {
  console.log("===============================================================");
  console.log("       TIGERROI - SINKRONISASI KEITARO EXPERT ADMIN API       ");
  console.log("===============================================================");

  if (!KEITARO_API_KEY) {
    console.error("❌ KEITARO_API_KEY belum diisi di file .env");
    console.log("   Tambahkan di .env:");
    console.log("   KEITARO_URL=https://appscity.tech");
    console.log("   KEITARO_API_KEY=your_api_key");
    process.exit(1);
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("❌ SUPABASE_URL atau SUPABASE_SERVICE_ROLE_KEY belum di-set di .env");
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const range = getDateRange(daysCount);

  // Ambil daftar situs terdaftar
  const { data: sitesList, error: siteError } = await supabase
    .from("sites")
    .select("site_code, name, domain, campaign_pattern, is_active");

  if (siteError) {
    console.error(`❌ Gagal mengambil tabel sites: ${siteError.message}`);
    process.exit(1);
  }

  console.log(`✅ Berhasil memuat ${sitesList?.length || 0} situs terdaftar dari Supabase.`);

  let rawRows = [];
  try {
    rawRows = await fetchKeitaroReport(range.from, range.to);
    console.log(`✅ Berhasil menerima ${rawRows.length} baris data dari Keitaro Tracker.`);
  } catch (err) {
    console.error(`❌ Gagal mengambil data Keitaro: ${err.message}`);
    process.exit(1);
  }

  if (rawRows.length === 0) {
    console.log("ℹ️ Tidak ada data trafik Keitaro pada rentang tanggal tersebut.");
    return;
  }

  // Agregasi per (date, site_code)
  const aggregated = new Map();
  let matchedCount = 0;
  let unmatchedCount = 0;

  for (const row of rawRows) {
    const dateStr = String(row.day || row.date || range.to).slice(0, 10);
    const campaignName = String(row.campaign || row.campaign_name || "");
    const subId1 = String(row.sub_id_1 || row.subId1 || "");
    const siteCandidate = subId1 || campaignName;

    const matched = matchSiteCode(
      [subId1, campaignName, String(row.campaign_id || "")],
      sitesList || [],
    );

    if (!matched) {
      unmatchedCount++;
      continue;
    }

    matchedCount++;
    const key = `${dateStr}__${matched.site_code}`;
    const prev = aggregated.get(key) || {
      date: dateStr,
      site_code: matched.site_code,
      source: "keitaro",
      clicks: 0,
      impressions: 0,
      spend: 0,
      revenue: 0,
      campaigns: new Set(),
    };

    const clicks = parseInt(row.clicks || 0, 10) || 0;
    const cost = parseFloat(row.cost || 0) || 0;
    const revenue = parseFloat(row.revenue || 0) || 0;

    prev.clicks += clicks;
    prev.impressions += clicks; // fallback
    prev.spend += cost;
    prev.revenue += revenue;
    if (campaignName) prev.campaigns.add(campaignName);

    aggregated.set(key, prev);
  }

  console.log(`\n📊 Ringkasan Pemetaan:`);
  console.log(` - Baris Cocok       : ${matchedCount}`);
  console.log(` - Baris Tidak Cocok : ${unmatchedCount}`);
  console.log(` - Hasil Agregasi    : ${aggregated.size} baris unik (date × site_code)`);

  const recordsToUpsert = Array.from(aggregated.values()).map((item) => {
    const profit = Math.round((item.revenue - item.spend) * 100) / 100;
    const roi_percent =
      item.spend > 0
        ? Math.round(((item.revenue - item.spend) / item.spend) * 10000) / 100
        : 0;
    const cpc = item.clicks > 0 ? Math.round((item.spend / item.clicks) * 100) / 100 : 0;

    return {
      date: item.date,
      site_code: item.site_code,
      source: "keitaro",
      clicks: item.clicks,
      impressions: item.impressions,
      spend: Math.round(item.spend * 100) / 100,
      revenue: Math.round(item.revenue * 100) / 100,
      profit,
      roi_percent,
      cpc,
      metadata: {
        campaigns: Array.from(item.campaigns),
        synced_at: new Date().toISOString(),
      },
    };
  });

  if (isDryRun) {
    console.log("\n[DRY RUN] Pratinjau data siap di-upsert:");
    console.table(recordsToUpsert);
    return;
  }

  console.log(`\n💾 Menyimpan ${recordsToUpsert.length} baris ke tabel public.daily_stats...`);
  const { error: upsertErr } = await supabase.from("daily_stats").upsert(recordsToUpsert, {
    onConflict: "date,site_code,source",
  });

  if (upsertErr) {
    console.error(`❌ Gagal menyimpan ke daily_stats: ${upsertErr.message}`);
    process.exit(1);
  }

  console.log("✅ Berhasil menyimpan data Keitaro ke database Supabase!");

  // Catat run log ke sync_runs
  await supabase.from("sync_runs").insert({
    job_name: "keitaro_api_sync",
    status: "success",
    records_synced: recordsToUpsert.length,
    message: `Berhasil sinkronisasi ${recordsToUpsert.length} baris data dari Keitaro Admin API (${range.from} s/d ${range.to}).`,
    created_at: new Date().toISOString(),
  });
}

run().catch((err) => {
  console.error("❌ Fatal Error:", err);
  process.exit(1);
});
