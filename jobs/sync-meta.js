import { createClient } from "@supabase/supabase-js";
import { fetchAccountOverview, fetchCampaignInsights } from "./meta-client.js";

/**
 * Job Sinkronisasi Meta Ads ke Supabase TigerROI
 * Dijalankan terjadwal melalui GitHub Actions (.github/workflows/sync-meta.yml) atau lokal.
 */

const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const GLOBAL_META_TOKEN = process.env.META_ACCESS_TOKEN || "";


if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("❌ SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY wajib diisi.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Format tanggal YYYY-MM-DD zona waktu Jakarta (WIB / UTC+7)
function getJakartaDate(daysAgo = 0) {
  const d = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(d);
}

// Pencocokan nama campaign Meta ke site_code menggunakan tabel sites
function matchSiteCode(campaignName, sitesList) {
  const nameLower = String(campaignName || "").toLowerCase();

  for (const site of sitesList) {
    if (!site.site_code) continue;
    const code = site.site_code.toLowerCase();

    // 1. Cek kecocokan langsung site_code di nama campaign
    if (nameLower.includes(code)) {
      return site.site_code;
    }

    // 2. Cek pola campaign_pattern jika dikonfigurasi (misal kode Keitaro: "pBRw, TvH1")
    if (site.campaign_pattern) {
      const patterns = String(site.campaign_pattern)
        .split(",")
        .map((p) => p.trim().toLowerCase())
        .filter(Boolean);

      for (const pattern of patterns) {
        if (nameLower.includes(pattern)) {
          return site.site_code;
        }
      }
    }
  }

  return "unmapped";
}

async function sendTelegramAlert(message) {
  // Telegram ditunda sesuai instruksi (docs/deferred-features.md)
  console.warn(`[Alert] ${message}`);
}


export async function runSyncMeta() {
  const startedAt = new Date().toISOString();
  console.log(`[${startedAt}] Memulai Sinkronisasi Meta Ads ke Supabase...`);

  let runId = null;

  try {
    // 1. Query ringan ke Supabase untuk menjaga project Free Tier tetap aktif (tidak pause)
    const { count, error: pingError } = await supabase
      .from("sync_runs")
      .select("*", { count: "exact", head: true });

    if (pingError) {
      console.warn(`[keep-alive] Ping Supabase menghasilkan: ${pingError.message}`);
    } else {
      console.log(`[keep-alive] Koneksi Supabase aktif (total sync runs tercatat: ${count})`);
    }

    // 2. Buat entri run baru di tabel sync_runs
    const { data: runRecord, error: startError } = await supabase
      .from("sync_runs")
      .insert({
        job_name: "sync-meta",
        status: "running",
        started_at: startedAt,
      })
      .select("id")
      .single();

    if (runRecord) runId = runRecord.id;
    if (startError) console.warn("Peringatan: Gagal mencatat start ke sync_runs:", startError.message);

    // 3. Ambil daftar pemetaan sites
    const { data: sitesList, error: sitesError } = await supabase
      .from("sites")
      .select("site_code, campaign_pattern, is_active")
      .eq("is_active", true);

    if (sitesError) throw new Error(`Gagal membaca tabel sites: ${sitesError.message}`);
    const sites = sitesList || [];
    console.log(`Memuat ${sites.length} site aktif untuk pemetaan campaign.`);

    // 4. Ambil daftar akun Meta aktif dari meta_accounts
    const { data: accountsList, error: accountsError } = await supabase
      .from("meta_accounts")
      .select("id, account_id, name, access_token, currency, is_active")
      .eq("is_active", true);

    if (accountsError) throw new Error(`Gagal membaca tabel meta_accounts: ${accountsError.message}`);

    const accounts = accountsList || [];
    if (accounts.length === 0) {
      console.log("ℹ️ Tidak ada akun aktif di meta_accounts. Memeriksa META_ACCOUNT_ID dari environment...");
      if (process.env.META_ACCOUNT_ID && GLOBAL_META_TOKEN) {
        accounts.push({
          id: "env-account",
          account_id: process.env.META_ACCOUNT_ID,
          name: "Default Env Account",
          access_token: null,
          is_active: true,
        });
      }
    }

    console.log(`Memproses ${accounts.length} akun Meta Ads...`);

    const dateToday = getJakartaDate(0);
    const dateYesterday = getJakartaDate(1);
    const dateRange = { since: dateYesterday, until: dateToday };

    let totalSyncedRows = 0;
    const errors = [];

    // Map agregasi: key `${date}_${site_code}` -> { date, site_code, spend, impressions, clicks, campaignCount }
    const dailyMap = new Map();

    for (const account of accounts) {
      const token = account.access_token || GLOBAL_META_TOKEN;
      if (!token) {
        const msg = `Akun ${account.name} (${account.account_id}) tidak memiliki access token (baik di DB maupun env).`;
        console.error(`❌ ${msg}`);
        errors.push(msg);
        continue;
      }

      console.log(`\n--> Menarik data untuk: ${account.name} (${account.account_id})...`);

      try {
        // A. Ambil status dan saldo akun
        const overview = await fetchAccountOverview(account.account_id, token);
        console.log(`    Saldo/Limit: ${overview.currency} ${overview.remainingBudget.toLocaleString()} | Spent: ${overview.amountSpent}`);

        // Update informasi saldo di meta_accounts jika baris ada di database
        if (account.id !== "env-account") {
          await supabase
            .from("meta_accounts")
            .update({
              currency: overview.currency,
              balance: overview.balance,
              spend_cap: overview.spendCap,
              amount_spent: overview.amountSpent,
              last_synced_at: new Date().toISOString(),
              last_error: null,
            })
            .eq("id", account.id);
        }

        // B. Ambil insights campaign 2 hari (kemarin & hari ini)
        const insights = await fetchCampaignInsights(account.account_id, token, dateRange);
        console.log(`    Ditemukan ${insights.length} baris insights campaign.`);

        for (const row of insights) {
          const siteCode = matchSiteCode(row.campaignName, sites);
          const aggKey = `${row.date}__${siteCode}`;

          if (!dailyMap.has(aggKey)) {
            dailyMap.set(aggKey, {
              date: row.date,
              site_code: siteCode,
              source: "meta",
              spend: 0,
              impressions: 0,
              clicks: 0,
              campaign_count: 0,
              meta_account_id: account.account_id,
            });
          }

          const current = dailyMap.get(aggKey);
          current.spend += row.spend;
          current.impressions += row.impressions;
          current.clicks += row.clicks;
          current.campaign_count += 1;
        }
      } catch (accErr) {
        const errorMsg = `Akun ${account.name}: ${accErr.message}`;
        console.error(`    ❌ ${errorMsg}`);
        errors.push(errorMsg);

        if (account.id !== "env-account") {
          await supabase
            .from("meta_accounts")
            .update({ last_error: accErr.message })
            .eq("id", account.id);
        }
      }
    }

    // 5. Upsert hasil agregasi ke tabel daily_stats
    const upsertRows = Array.from(dailyMap.values()).map((row) => ({
      date: row.date,
      site_code: row.site_code,
      source: "meta",
      spend: Math.round(row.spend * 100) / 100,
      impressions: row.impressions,
      clicks: row.clicks,
      cpc: row.clicks > 0 ? Math.round((row.spend / row.clicks) * 10000) / 10000 : 0,
      campaign_count: row.campaign_count,
      meta_account_id: row.meta_account_id,
      updated_at: new Date().toISOString(),
    }));

    if (upsertRows.length > 0) {
      console.log(`\nMelakukan upsert ${upsertRows.length} baris ke tabel daily_stats...`);
      const { error: upsertError } = await supabase
        .from("daily_stats")
        .upsert(upsertRows, { onConflict: "date,site_code,source" });

      if (upsertError) {
        throw new Error(`Gagal upsert ke daily_stats: ${upsertError.message}`);
      }
      totalSyncedRows = upsertRows.length;
      console.log(`✅ Berhasil upsert ${totalSyncedRows} baris daily_stats.`);
    } else {
      console.log("ℹ️ Tidak ada data spend campaign baru untuk di-upsert.");
    }

    // 6. Catat keberhasilan ke sync_runs
    const finishedAt = new Date().toISOString();
    const isSuccess = errors.length === 0 || totalSyncedRows > 0;
    const status = isSuccess ? "success" : "failed";

    if (runId) {
      await supabase
        .from("sync_runs")
        .update({
          status,
          finished_at: finishedAt,
          rows_synced: totalSyncedRows,
          error_message: errors.length ? errors.join("; ") : null,
          details: {
            accounts_processed: accounts.length,
            errors_count: errors.length,
          },
        })
        .eq("id", runId);
    }

    console.log(`\n[${finishedAt}] Selesai. Status: ${status}, Baris Disinkronkan: ${totalSyncedRows}`);

    if (errors.length && !isSuccess) {
      const alertText = `Sync Meta Gagal:\n${errors.join("\n")}`;
      await sendTelegramAlert(alertText);
      process.exit(1);
    }
  } catch (fatalErr) {
    console.error("\n❌ Fatal Error pada job sync-meta:", fatalErr.message);

    if (runId) {
      await supabase
        .from("sync_runs")
        .update({
          status: "failed",
          finished_at: new Date().toISOString(),
          error_message: fatalErr.message,
        })
        .eq("id", runId);
    }

    await sendTelegramAlert(`Fatal error saat menjalankan sync-meta: ${fatalErr.message}`);
    process.exit(1);
  }
}

// Jalankan otomatis jika dipanggil langsung via CLI
if (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}`) {
  runSyncMeta();
}
