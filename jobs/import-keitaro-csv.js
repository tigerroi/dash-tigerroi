#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { processKeitaroCsv } from "../src/lib/keitaroCsvParser.js";

/**
 * CLI Skrip Impor CSV Laporan Keitaro ke Supabase TigerROI
 *
 * Penggunaan:
 *   node jobs/import-keitaro-csv.js <lokasi-file.csv> [--dry-run]
 *
 * Contoh:
 *   node jobs/import-keitaro-csv.js ./laporan-keitaro-oktober.csv
 *   node jobs/import-keitaro-csv.js ./laporan.csv --dry-run
 */

// Muat variabel environment (.env, server/.env jika ada)
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
          const v = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
          if (!process.env[k]) process.env[k] = v;
        }
      }
    }
  }

  // Fallback VITE_SUPABASE_URL jika SUPABASE_URL tidak didefinisikan
  if (!process.env.SUPABASE_URL && process.env.VITE_SUPABASE_URL) {
    process.env.SUPABASE_URL = process.env.VITE_SUPABASE_URL;
  }
}

loadEnv();

const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";

const args = process.argv.slice(2);
const isDryRun = args.includes("--dry-run");
const filePath = args.find((a) => !a.startsWith("--"));

async function notifyTelegram(message) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: "Markdown",
      }),
    });
  } catch {
    // Abaikan kegagalan notifikasi non-kritis
  }
}

async function run() {
  console.log("===============================================================");
  console.log("       TIGERROI - IMPOR CSV LAPORAN KEITARO TRACKER           ");
  console.log("===============================================================");

  if (!filePath) {
    console.error("❌ Lokasi file CSV belum ditentukan.");
    console.log("   Gunakan: node jobs/import-keitaro-csv.js <path-to-file.csv> [--dry-run]");
    console.log("   Contoh:  node jobs/import-keitaro-csv.js ./keitaro_report.csv");
    process.exit(1);
  }

  const resolvedPath = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`❌ File tidak ditemukan: ${resolvedPath}`);
    process.exit(1);
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("❌ SUPABASE_URL atau SUPABASE_SERVICE_ROLE_KEY belum di-set di .env");
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log(`\n📂 Membaca file: ${resolvedPath}`);
  const csvContent = fs.readFileSync(resolvedPath, "utf-8");

  // Ambil daftar situs dari database Supabase
  console.log("🔍 Mengambil daftar site_code dari tabel public.sites...");
  const { data: sitesList, error: siteError } = await supabase
    .from("sites")
    .select("site_code, name, domain, campaign_pattern, is_active");

  if (siteError) {
    console.error(`❌ Gagal mengambil tabel sites: ${siteError.message}`);
    process.exit(1);
  }

  console.log(`✅ Berhasil memuat ${sitesList?.length || 0} situs terdaftar.`);

  // Proses CSV
  console.log("⚙️  Memproses & memvalidasi struktur CSV...");
  const result = processKeitaroCsv(csvContent, sitesList || []);

  if (!result.success && result.dailyStats.length === 0) {
    console.error(`❌ Validasi CSV Gagal: ${result.error || "Tidak ada data yang valid"}`);
    if (result.errors?.length > 0) {
      console.log("\nDaftar Error:");
      result.errors.forEach((e) => console.log(` - Baris ${e.rowNumber}: ${e.message}`));
    }
    process.exit(1);
  }

  const summary = result.summary;
  console.log("\n📊 RINGKASAN HASIL ANALISIS CSV:");
  console.log(` - Pemisah (Delimiter)  : '${summary.detectedDelimiter}'`);
  console.log(` - Total Baris Input    : ${summary.totalInputLines}`);
  console.log(` - Baris Valid (Agregat): ${summary.validAggregatedRows}`);
  console.log(` - Baris Tidak Cocok    : ${summary.unmatchedRows}`);
  console.log(` - Total Klik           : ${summary.totalClicks.toLocaleString()}`);
  console.log(` - Total Biaya (Spend)  : $${summary.totalSpend.toLocaleString("en-US", { minimumFractionDigits: 2 })}`);
  console.log(` - Total Pendapatan     : $${summary.totalRevenue.toLocaleString("en-US", { minimumFractionDigits: 2 })}`);

  // Tabel Pratinjau
  console.log("\n📋 PRATINJAU DATA SIAP DI-UPSERT KE daily_stats (source = 'keitaro'):");
  console.table(
    result.dailyStats.map((row) => ({
      Tanggal: row.date,
      "Site Code": row.site_code,
      Klik: row.clicks,
      Spend: `$${row.spend.toFixed(2)}`,
      Revenue: `$${row.revenue.toFixed(2)}`,
      Profit: `$${(row.revenue - row.spend).toFixed(2)}`,
      "ROI %": `${row.roi_percent}%`,
      "Jml Camp": row.campaign_count,
    }))
  );

  // Tampilkan peringatan jika ada baris tidak cocok
  if (result.unmatched.length > 0) {
    console.log(`\n⚠️  PERINGATAN: ${result.unmatched.length} baris tidak dapat dicocokkan ke site_code:`);
    result.unmatched.slice(0, 10).forEach((u) => {
      console.log(`   - Baris ${u.rowNumber}: ${u.candidates.join(" | ")}`);
    });
    if (result.unmatched.length > 10) {
      console.log(`   ... dan ${result.unmatched.length - 10} baris lainnya.`);
    }
  }

  if (isDryRun) {
    console.log("\n🔍 Mode --dry-run aktif. Data TIDAK disimpan ke database.");
    process.exit(0);
  }

  // Simpan ke Supabase daily_stats
  console.log("\n💾 Menyimpan data ke tabel daily_stats...");
  const startTime = Date.now();

  const { error: upsertError } = await supabase
    .from("daily_stats")
    .upsert(result.dailyStats, { onConflict: "date,site_code,source" });

  if (upsertError) {
    console.error(`❌ Gagal menyimpan ke daily_stats: ${upsertError.message}`);

    // Catat kegagalan ke sync_runs
    await supabase.from("sync_runs").insert({
      job_name: "keitaro_csv_import",
      status: "failed",
      error_message: upsertError.message,
      finished_at: new Date().toISOString(),
      details: { file: path.basename(filePath), summary },
    });

    process.exit(1);
  }

  // Catat keberhasilan ke sync_runs (dan sekaligus menjaga free-tier Supabase tetap aktif)
  const { error: runLogErr } = await supabase.from("sync_runs").insert({
    job_name: "keitaro_csv_import",
    status: "success",
    rows_synced: result.dailyStats.length,
    finished_at: new Date().toISOString(),
    details: {
      file: path.basename(filePath),
      duration_ms: Date.now() - startTime,
      totalClicks: summary.totalClicks,
      totalSpend: summary.totalSpend,
      totalRevenue: summary.totalRevenue,
      unmatchedCount: summary.unmatchedRows,
    },
  });

  if (runLogErr) {
    console.warn(`⚠️ Catatan log sync_runs: ${runLogErr.message}`);
  }

  console.log("✅ BERHASIL! Seluruh data laporan Keitaro telah tersimpan di daily_stats.");
  console.log("   Kunci unik: (date + site_code + 'keitaro')");

  // Kirim notifikasi Telegram jika aktif
  await notifyTelegram(
    `📥 *TigerROI - Impor CSV Keitaro Sukses*\n\n` +
      `📁 File: \`${path.basename(filePath)}\`\n` +
      `📊 Baris Disinkronkan: *${result.dailyStats.length}*\n` +
      `🖱️ Total Klik: *${summary.totalClicks.toLocaleString()}*\n` +
      `💰 Total Spend: *$${summary.totalSpend}*\n` +
      `💵 Total Revenue: *$${summary.totalRevenue}*`
  );
}

run().catch((err) => {
  console.error("❌ Fatal Error:", err);
  process.exit(1);
});
