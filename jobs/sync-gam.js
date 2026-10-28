import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { getGoogleServiceAccountToken, fetchGamDailyRevenue } from "./gam-client.js";

/**
 * Job Sinkronisasi Google Ad Manager (GAM) ke Supabase TigerROI
 * Menarik pendapatan AdX dan AdSense dari 4 network GAM (Trayedit, TikTok, Tacobell, IHOP)
 * Dijalankan terjadwal via GitHub Actions atau lokal.
 */

// Muat variabel environment (.env, server/.env jika ada)
function loadEnv() {
  const envCandidates = [
    resolve(".env"),
    resolve("server/.env"),
    resolve("jobs/.env"),
  ];

  for (const envPath of envCandidates) {
    if (existsSync(envPath)) {
      const lines = readFileSync(envPath, "utf-8").split("\n");
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

  if (!process.env.SUPABASE_URL && process.env.VITE_SUPABASE_URL) {
    process.env.SUPABASE_URL = process.env.VITE_SUPABASE_URL;
  }
}

loadEnv();

const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";


// Daftar 4 Network GAM beserta domain utamanya
const GAM_NETWORKS = [
  { domain: "trayedit.com", networkCode: "23344333667", defaultSiteCode: "tray-decor" },
  { domain: "tiktokmodapk.net", networkCode: "23367555867", defaultSiteCode: "tiktok-mod" },
  { domain: "tacobellmenuu.us", networkCode: "23380486168", defaultSiteCode: "taco-fries" },
  { domain: "ihopmenuwithprices.us", networkCode: "23340206616", defaultSiteCode: "ihop-menu" },
];

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

// Mengambil kredensial Service Account dari env atau file lokal
function loadServiceAccountCredentials() {
  let clientEmail = process.env.GAM_CLIENT_EMAIL;
  let privateKey = process.env.GAM_PRIVATE_KEY;

  if (clientEmail && privateKey) {
    return { clientEmail, privateKey };
  }

  // Cek jika ada file service-account.json lokal
  const possibleFiles = [
    resolve("./service-account.json"),
    resolve("./gam-credentials.json"),
    resolve("./google-key.json"),
  ];

  for (const file of possibleFiles) {
    if (existsSync(file)) {
      try {
        const parsed = JSON.parse(readFileSync(file, "utf-8"));
        if (parsed.client_email && parsed.private_key) {
          return {
            clientEmail: parsed.client_email,
            privateKey: parsed.private_key,
          };
        }
      } catch {
        // Lanjutkan pencarian
      }
    }
  }

  return null;
}

// Pencocokan baris GAM (siteName / URL / adUnitName) ke subdomain & site_code
function mapGamRowToSite(row, defaultSiteCode, subdomainsList, sitesList) {
  const host = String(row.siteName || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const unit = String(row.adUnitName || "").toLowerCase();

  // 1. Prioritas 1: Cocokkan host URL langsung ke 17 subdomain
  if (host) {
    for (const sub of (subdomainsList || [])) {
      const subHost = String(sub.name || "").toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
      if (host === subHost || host.endsWith(`.${subHost}`) || subHost.includes(host)) {
        return {
          siteCode: sub.site_code || defaultSiteCode,
          subdomainName: sub.name,
        };
      }
    }
  }

  // 2. Prioritas 2: Cocokkan nama unit iklan ke sites
  for (const s of (sitesList || [])) {
    if (!s.site_code) continue;
    if (unit.includes(s.site_code.toLowerCase())) {
      return {
        siteCode: s.site_code,
        subdomainName: s.name || s.site_code,
      };
    }
  }

  // 3. Fallback ke default site code network tersebut
  return {
    siteCode: defaultSiteCode || "unmapped",
    subdomainName: host || defaultSiteCode || "unmapped",
  };
}

async function sendTelegramAlert(message) {
  // Telegram ditunda sesuai instruksi (docs/deferred-features.md)
  console.warn(`[Alert] ${message}`);
}


export async function runSyncGam() {
  const startedAt = new Date().toISOString();
  console.log(`[${startedAt}] Memulai Sinkronisasi Google Ad Manager (GAM) ke Supabase...`);

  let runId = null;

  try {
    // 1. Keep-alive query ke Supabase
    await supabase.from("sync_runs").select("*", { count: "exact", head: true });

    // 2. Catat start ke sync_runs
    const { data: runRecord } = await supabase
      .from("sync_runs")
      .insert({
        job_name: "sync-gam",
        status: "running",
        started_at: startedAt,
      })
      .select("id")
      .single();

    if (runRecord) runId = runRecord.id;

    // 3. Ambil kredensial Service Account
    const creds = loadServiceAccountCredentials();
    if (!creds) {
      throw new Error(
        "Kredensial Service Account GAM belum ditemukan di GAM_CLIENT_EMAIL / GAM_PRIVATE_KEY atau file service-account.json",
      );
    }

    console.log(`Mengautentikasi Service Account: ${creds.clientEmail}...`);
    const accessToken = await getGoogleServiceAccountToken(creds);

    // 4. Ambil daftar sites dan subdomains untuk pencocokan unit iklan & URL
    const [{ data: sitesList }, { data: subdomainsList }] = await Promise.all([
      supabase.from("sites").select("site_code, is_active").eq("is_active", true),
      supabase.from("subdomains").select("name, site_code, parent_domain"),
    ]);

    const sites = sitesList || [];
    const subdomains = subdomainsList || [];

    const daysBack = Number(process.env.DAYS_BACK || 30);
    const dateToday = getJakartaDate(0);
    const dateSince = getJakartaDate(daysBack);
    const dateRange = { startDate: dateSince, endDate: dateToday };

    console.log(`Rentang Penarikan GAM: ${dateRange.startDate} s/d ${dateRange.endDate} (${daysBack} hari ke belakang)...`);

    let totalSyncedRows = 0;
    const errors = [];
    const dailyMap = new Map(); // key `${date}__${site_code}` -> aggregated data

    // 5. Loop ke 4 Network GAM
    for (const net of GAM_NETWORKS) {
      console.log(`\n--> Menarik Pendapatan GAM untuk ${net.domain} (Network: ${net.networkCode})...`);

      try {
        const rows = await fetchGamDailyRevenue(net.networkCode, accessToken, dateRange);
        console.log(`    Ditemukan ${rows.length} baris unit iklan.`);

        for (const row of rows) {
          const mapped = mapGamRowToSite(row, net.defaultSiteCode, subdomains, sites);
          const siteCode = mapped.siteCode;
          const aggKey = `${row.date}__${siteCode}`;

          if (!dailyMap.has(aggKey)) {
            dailyMap.set(aggKey, {
              date: row.date,
              site_code: siteCode,
              source: "gam",
              revenue: 0,
              spend: 0,
              impressions: 0,
              clicks: 0,
              metadata: {
                adx_revenue: 0,
                adsense_revenue: 0,
                network_codes: [net.networkCode],
                subdomains: {},
              },
            });
          }

          const current = dailyMap.get(aggKey);
          current.revenue += row.totalRevenue;
          current.impressions += row.impressions;
          current.clicks += row.clicks;
          current.metadata.adx_revenue += row.adxRevenue;
          current.metadata.adsense_revenue += row.adsenseRevenue;

          // Catat breakdown per subdomain
          current.metadata.subdomains = current.metadata.subdomains || {};
          current.metadata.subdomains[mapped.subdomainName] = current.metadata.subdomains[mapped.subdomainName] || {
            revenue: 0,
            impressions: 0,
            clicks: 0,
          };
          current.metadata.subdomains[mapped.subdomainName].revenue += row.totalRevenue;
          current.metadata.subdomains[mapped.subdomainName].impressions += row.impressions;
          current.metadata.subdomains[mapped.subdomainName].clicks += row.clicks;
          if (!current.metadata.network_codes.includes(net.networkCode)) {
            current.metadata.network_codes.push(net.networkCode);
          }
        }
      } catch (netErr) {
        const msg = `Network ${net.domain} (${net.networkCode}): ${netErr.message}`;
        console.error(`    ❌ ${msg}`);
        errors.push(msg);
      }
    }

    // 6. Upsert ke tabel daily_stats
    const upsertRows = Array.from(dailyMap.values()).map((row) => ({
      date: row.date,
      site_code: row.site_code,
      source: "gam",
      revenue: Math.round(row.revenue * 100) / 100,
      spend: 0,
      impressions: row.impressions,
      clicks: row.clicks,
      cpc: 0,
      metadata: row.metadata,
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
      console.log(`✅ Berhasil upsert ${totalSyncedRows} baris pendapatan GAM ke daily_stats.`);
    }

    // 7. Catat status akhir ke sync_runs
    const finishedAt = new Date().toISOString();
    const isSuccess = errors.length < GAM_NETWORKS.length;
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
            networks_processed: GAM_NETWORKS.length,
            errors_count: errors.length,
          },
        })
        .eq("id", runId);
    }

    console.log(`\n[${finishedAt}] Selesai. Status: ${status}, Baris Disinkronkan: ${totalSyncedRows}`);
  } catch (fatalErr) {
    console.error("\n❌ Fatal error saat sinkronisasi GAM:", fatalErr.message);

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

    await sendTelegramAlert(`Fatal error pada sync-gam: ${fatalErr.message}`);
    process.exit(1);
  }
}

// Jalankan otomatis bila dipanggil langsung
import { fileURLToPath } from "node:url";
const isDirectRun =
  process.argv[1] &&
  resolve(fileURLToPath(import.meta.url)).toLowerCase() ===
    resolve(process.argv[1]).toLowerCase();

if (isDirectRun) {
  runSyncGam();
}
