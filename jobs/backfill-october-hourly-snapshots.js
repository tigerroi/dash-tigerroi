#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

/**
 * TigerROI - Rekonstruksi & Backfill Riwayat Snapshot Per Jam (1-31 Oktober 2026)
 *
 * Mengambil data harian per subdomain dari view_daily_roi untuk bulan Oktober 2026,
 * kemudian menyusun titik data kumulatif jam demi jam (01:00 s/d 23:00 dan closing 23:59)
 * ke tabel `roi_snapshots`, sehingga Laporan Realtime ROI dapat menampilkan riwayat
 * per jam lengkap di setiap tanggal bulan Oktober.
 *
 * Penggunaan:
 *   node jobs/backfill-october-hourly-snapshots.js [--start=2026-10-01] [--end=2026-10-31] [--dry-run]
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

const args = process.argv.slice(2);
const isDryRun = args.includes("--dry-run");

const startArg = args.find((a) => a.startsWith("--start="));
const endArg = args.find((a) => a.startsWith("--end="));

const START_DATE = startArg ? startArg.split("=")[1] : "2026-10-01";
const END_DATE = endArg ? endArg.split("=")[1] : "2026-10-31";

// Bobot kumulatif per jam (01:00 s/d 23:00, ditutup 23:59 sebesar 100%)
// Berdasarkan kurva aktivitas trafik iklan arbitrase harian (WIB)
const HOURLY_CUMULATIVE_FRACTIONS = [
  { time: "01:00", fraction: 0.02 },
  { time: "02:00", fraction: 0.04 },
  { time: "03:00", fraction: 0.06 },
  { time: "04:00", fraction: 0.08 },
  { time: "05:00", fraction: 0.11 },
  { time: "06:00", fraction: 0.15 },
  { time: "07:00", fraction: 0.20 },
  { time: "08:00", fraction: 0.26 },
  { time: "09:00", fraction: 0.32 },
  { time: "10:00", fraction: 0.38 },
  { time: "11:00", fraction: 0.45 },
  { time: "12:00", fraction: 0.52 },
  { time: "13:00", fraction: 0.58 },
  { time: "14:00", fraction: 0.64 },
  { time: "15:00", fraction: 0.70 },
  { time: "16:00", fraction: 0.76 },
  { time: "17:00", fraction: 0.81 },
  { time: "18:00", fraction: 0.86 },
  { time: "19:00", fraction: 0.90 },
  { time: "20:00", fraction: 0.94 },
  { time: "21:00", fraction: 0.97 },
  { time: "22:00", fraction: 0.985 },
  { time: "23:00", fraction: 0.995 },
  { time: "23:59", fraction: 1.0 }, // Closing final 100%
];

async function run() {
  console.log("========================================================================");
  console.log("   TIGERROI - BACKFILL SNAPSHOT ROI PER JAM (01:00 - 23:59)            ");
  console.log(`   Rentang Tanggal: ${START_DATE} s/d ${END_DATE}                      `);
  console.log("========================================================================");

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("❌ SUPABASE_URL atau SUPABASE_SERVICE_ROLE_KEY belum di-set.");
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1. Ambil data harian dari view_daily_roi untuk rentang tanggal yang dipilih
  console.log(`\n📥 Membaca data harian dari view_daily_roi (${START_DATE} s/d ${END_DATE})...`);
  const { data: dailyRows, error: fetchErr } = await supabase
    .from("view_daily_roi")
    .select("*")
    .gte("date", START_DATE)
    .lte("date", END_DATE)
    .order("date", { ascending: true });

  if (fetchErr) {
    console.error(`❌ Gagal membaca view_daily_roi: ${fetchErr.message}`);
    process.exit(1);
  }

  if (!dailyRows || dailyRows.length === 0) {
    console.log("ℹ️ Tidak ada data di view_daily_roi pada rentang tanggal tersebut.");
    return;
  }

  console.log(`✅ Ditemukan ${dailyRows.length} baris data harian per subdomain.`);

  // 2. Susun baris snapshot per jam (24 titik per baris harian)
  const allSnapshotRows = [];

  for (const daily of dailyRows) {
    const dateStr = String(daily.date).slice(0, 10);
    const siteCode = daily.site_code || "";
    const subDomain = daily.sub_domain || daily.subdomain || daily.site_name || "";
    const campaign = daily.campaign || siteCode;
    const domain = daily.domain || "-";
    const pic = daily.pic || "-";
    const currency = daily.currency || daily.currency_code || "IDR";
    const fxRate = Number(daily.fx_rate || 1.0);

    const totalSpend = Number(daily.spending || daily.spend_idr || daily.meta_spend || 0);
    const totalEarning = Number(daily.earning || daily.raw_revenue || daily.gam_revenue || 0);
    const totalClicks = Number(daily.clicks || 0);
    const totalImpressions = Number(daily.impressions || 0);

    let prevSpend = 0;
    let prevEarning = 0;
    let prevRoi = 0;

    for (const h of HOURLY_CUMULATIVE_FRACTIONS) {
      const safeTimeKey = h.time.replace(":", "-");
      const subKey = subDomain || "root";
      const snapshotId = `${dateStr}T${safeTimeKey}__${siteCode}__${subKey}`;

      const cumSpend = Math.round(totalSpend * h.fraction * 100) / 100;
      const cumEarning = Math.round(totalEarning * h.fraction * 100) / 100;
      const cumClicks = Math.round(totalClicks * h.fraction);
      const cumImp = Math.round(totalImpressions * h.fraction);

      const cumProfit = Math.round((cumEarning - cumSpend) * 100) / 100;
      const cumRoi =
        cumSpend > 0 ? Math.round(((cumEarning - cumSpend) / cumSpend) * 10000) / 100 : 0;
      const cpc = cumClicks > 0 ? Math.round((cumSpend / cumClicks) * 10000) / 10000 : 0;

      const flukSpend = Math.round((cumSpend - prevSpend) * 100) / 100;
      const flukEarn = Math.round((cumEarning - prevEarning) * 100) / 100;
      const flukRoi = Math.round((cumRoi - prevRoi) * 100) / 100;

      allSnapshotRows.push({
        id: snapshotId,
        date: dateStr,
        time: h.time,
        site_code: siteCode,
        sub_domain: subDomain,
        campaign,
        domain,
        pic,
        spending: cumSpend,
        meta_spend: cumSpend,
        ad_tax: 0,
        total_spending: cumSpend,
        earning: cumEarning,
        gam_revenue: cumEarning,
        adsense_revenue: 0,
        profit: cumProfit,
        roi: cumRoi,
        clicks: cumClicks,
        impressions: cumImp,
        cpc,
        currency,
        fx_rate: fxRate,
        fluk_spend: flukSpend,
        fluk_earn: flukEarn,
        fluk_roi: flukRoi,
        created_at: new Date().toISOString(),
      });

      prevSpend = cumSpend;
      prevEarning = cumEarning;
      prevRoi = cumRoi;
    }
  }

  console.log(`\n📊 Total snapshot yang akan di-upsert: ${allSnapshotRows.length} baris.`);

  if (isDryRun) {
    console.log("\n[DRY RUN] Pratinjau 5 baris pertama:");
    console.table(allSnapshotRows.slice(0, 5));
    return;
  }

  // 3. Simpan ke database dalam batch 500 baris
  const BATCH_SIZE = 500;
  let totalSaved = 0;

  console.log(`💾 Menyimpan ke tabel public.roi_snapshots dalam batch per ${BATCH_SIZE} baris...`);

  for (let i = 0; i < allSnapshotRows.length; i += BATCH_SIZE) {
    const batch = allSnapshotRows.slice(i, i + BATCH_SIZE);
    const { error: upsertErr } = await supabase.from("roi_snapshots").upsert(batch, {
      onConflict: "id",
    });

    if (upsertErr) {
      console.error(`❌ Gagal menyimpan batch ke-${i}: ${upsertErr.message}`);
      process.exit(1);
    }

    totalSaved += batch.length;
    process.stdout.write(`   Tersimpan: ${totalSaved} / ${allSnapshotRows.length} baris...\r`);
  }

  console.log(`\n✅ SUKSES! Berhasil merekonstruksi dan menyimpan ${totalSaved} baris snapshot per jam ke Supabase.`);
}

run().catch((err) => {
  console.error("❌ Fatal Error:", err);
  process.exit(1);
});
