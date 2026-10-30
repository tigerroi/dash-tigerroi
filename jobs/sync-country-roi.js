import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { fetchCampaignSpendByCountry } from "./meta-client.js";
import { fetchGamCountryRevenue, getGoogleServiceAccountToken } from "./gam-client.js";

/**
 * Job Sinkronisasi ROI per Negara (Country ROI) ke Supabase TigerROI
 * Menggabungkan biaya iklan Meta Ads per negara dengan pendapatan Google Ad Manager per negara.
 * Hasilnya ditulis ke tabel `public.country_roi`.
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
const GLOBAL_META_TOKEN = process.env.META_ACCESS_TOKEN || "";
const AD_TAX_RATE = Number(process.env.AD_TAX_RATE || 0.05); // 5% Pajak Iklan

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("❌ SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY wajib diisi.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

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

// 4 Network GAM bawaan
const GAM_NETWORKS = [
  { domain: "trayedit.com", networkCode: "23344333667", defaultSiteCode: "tray-decor" },
  { domain: "tiktokmodapk.net", networkCode: "23367555867", defaultSiteCode: "tiktok-mod" },
  { domain: "tacobellmenuu.us", networkCode: "23380486168", defaultSiteCode: "taco-fries" },
  { domain: "ihopmenuwithprices.us", networkCode: "23340206616", defaultSiteCode: "ihop-menu" },
];

function matchSubDomain(campaignName, subdomains, defaultSubDomain = "") {
  const nameLower = String(campaignName || "").toLowerCase();
  for (const sub of subdomains) {
    const subName = (sub.name || "").toLowerCase();
    const slug = subName.split(".")[0];
    if (slug && nameLower.includes(slug)) {
      return sub.name;
    }
  }
  return defaultSubDomain || "unmapped";
}

export async function runSyncCountryRoi(targetDate = null) {
  const dateStr = targetDate || getJakartaDate(0);
  const startedAt = new Date().toISOString();
  console.log(`[${startedAt}] Memulai Sinkronisasi ROI per Negara untuk tanggal: ${dateStr}...`);

  let runId = null;

  try {
    // 1. Keep-alive Supabase
    await supabase.from("sync_runs").select("*", { count: "exact", head: true });

    const { data: runRecord } = await supabase
      .from("sync_runs")
      .insert({
        job_name: "sync-country-roi",
        status: "running",
        started_at: startedAt,
      })
      .select("id")
      .single();

    if (runRecord) runId = runRecord.id;

    // 2. Ambil master subdomain
    const { data: subdomainsData } = await supabase
      .from("subdomains")
      .select("id, name, site_code, pic");
    const subdomains = subdomainsData || [];

    // Map: subDomain -> countryCode -> { spend, impressions, clicks }
    const spendMap = new Map();

    // 3. Tarik spend dari Meta Ads
    const { data: metaAccounts } = await supabase
      .from("meta_accounts")
      .select("id, account_id, access_token, is_active")
      .eq("is_active", true);

    const accounts = metaAccounts || [];
    if (accounts.length === 0 && process.env.META_ACCOUNT_ID && GLOBAL_META_TOKEN) {
      accounts.push({
        id: "env-account",
        account_id: process.env.META_ACCOUNT_ID,
        access_token: null,
      });
    }

    console.log(`Ditemukan ${accounts.length} akun Meta Ads untuk di-scan per negara.`);
    for (const acc of accounts) {
      const token = acc.access_token || GLOBAL_META_TOKEN;
      if (!token) continue;

      try {
        const countryRows = await fetchCampaignSpendByCountry(acc.account_id, token, {
          since: dateStr,
          until: dateStr,
        });

        for (const r of countryRows) {
          const subDomain = matchSubDomain(r.campaignName, subdomains);
          const cCode = r.countryCode || "UNKNOWN";
          const key = `${subDomain}__${cCode}`;

          const existing = spendMap.get(key) || {
            subDomain,
            countryCode: cCode,
            spend: 0,
            impressions: 0,
            clicks: 0,
          };

          existing.spend += r.spend;
          existing.impressions += r.impressions;
          existing.clicks += r.clicks;
          spendMap.set(key, existing);
        }
      } catch (err) {
        console.warn(`⚠️ Gagal menarik breakdown negara Meta untuk akun ${acc.account_id}: ${err.message}`);
      }
    }

    // 4. Tarik revenue dari Google Ad Manager
    const earnMap = new Map(); // key: subDomain__countryCode -> { earning, impressions, clicks, countryName }

    let clientEmail = process.env.GAM_CLIENT_EMAIL;
    let privateKey = process.env.GAM_PRIVATE_KEY;
    if ((!clientEmail || !privateKey) && existsSync(resolve("./service-account.json"))) {
      try {
        const sa = JSON.parse(readFileSync(resolve("./service-account.json"), "utf-8"));
        clientEmail = sa.client_email;
        privateKey = sa.private_key;
      } catch {
        // Abaikan jika tidak valid
      }
    }

    if (clientEmail && privateKey) {
      try {
        const gamToken = await getGoogleServiceAccountToken({ clientEmail, privateKey });
        for (const net of GAM_NETWORKS) {
          try {
            console.log(`Menarik breakdown negara GAM untuk network ${net.domain} (${net.networkCode})...`);
            const gamRows = await fetchGamCountryRevenue(net.networkCode, gamToken, {
              startDate: dateStr,
              endDate: dateStr,
            });

            for (const gr of gamRows) {
              const subDomain = gr.siteName || net.domain;
              const cCode = gr.countryCode || "UNKNOWN";
              const key = `${subDomain}__${cCode}`;

              const existing = earnMap.get(key) || {
                subDomain,
                countryCode: cCode,
                countryName: gr.countryName || cCode,
                earning: 0,
                impressions: 0,
                clicks: 0,
              };

              existing.earning += gr.totalRevenue;
              existing.impressions += gr.impressions;
              existing.clicks += gr.clicks;
              earnMap.set(key, existing);
            }
          } catch (netErr) {
            console.warn(`⚠️ Gagal menarik GAM country report untuk ${net.domain}: ${netErr.message}`);
          }
        }
      } catch (authErr) {
        console.warn(`⚠️ Gagal autentikasi Service Account GAM: ${authErr.message}`);
      }
    } else {
      console.log("ℹ️ Kredensial Service Account GAM belum ditemukan di environment. Bagian GAM dilewati.");
    }

    // 5. Gabungkan spend dan earning
    const allKeys = new Set([...spendMap.keys(), ...earnMap.keys()]);
    console.log(`Menggabungkan data: total ${allKeys.size} kombinasi (subdomain x negara).`);

    const recordsToUpsert = [];
    for (const key of allKeys) {
      const spendItem = spendMap.get(key) || {};
      const earnItem = earnMap.get(key) || {};

      const subDomain = spendItem.subDomain || earnItem.subDomain || "unknown";
      const countryCode = spendItem.countryCode || earnItem.countryCode || "UNKNOWN";
      const countryName = earnItem.countryName || countryCode;

      const spend = Number(spendItem.spend || 0);
      const impressions = Number(earnItem.impressions || spendItem.impressions || 0);
      const clicks = Number(earnItem.clicks || spendItem.clicks || 0);
      const earning = Number(earnItem.earning || 0);

      const adTax = spend * AD_TAX_RATE;
      const totalSpending = spend + adTax;
      const profit = earning - totalSpending;
      const roi = totalSpending > 0 ? ((earning - totalSpending) / totalSpending) * 100 : 0;
      const cpc = clicks > 0 ? (spend > 0 ? spend / clicks : earning / clicks) : 0;

      recordsToUpsert.push({
        date: dateStr,
        sub_domain: subDomain,
        country_code: countryCode,
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

    if (recordsToUpsert.length > 0) {
      const { error: upsertErr } = await supabase.from("country_roi").upsert(recordsToUpsert, {
        onConflict: "date,sub_domain,country_code",
      });

      if (upsertErr) {
        throw new Error(`Gagal menyimpan data ke tabel country_roi: ${upsertErr.message}`);
      }
      console.log(`✅ Berhasil menyimpan ${recordsToUpsert.length} baris ke tabel country_roi.`);
    } else {
      console.log("ℹ️ Tidak ada data negara yang perlu disimpan untuk tanggal ini.");
    }

    // 6. Catat sukses ke sync_runs
    if (runId) {
      await supabase
        .from("sync_runs")
        .update({
          status: "success",
          completed_at: new Date().toISOString(),
          summary: `Tersinkronisasi ${recordsToUpsert.length} baris negara`,
        })
        .eq("id", runId);
    }

    console.log(`🎉 Sinkronisasi ROI per Negara Selesai Sukses.`);
  } catch (err) {
    console.error(`❌ Error Sinkronisasi ROI per Negara: ${err.message}`);
    if (runId) {
      await supabase
        .from("sync_runs")
        .update({
          status: "failed",
          completed_at: new Date().toISOString(),
          error_message: err.message,
        })
        .eq("id", runId);
    }
    throw err;
  }
}

// Jalankan jika dieksekusi langsung
if (process.argv[1] && process.argv[1].endsWith("sync-country-roi.js")) {
  const targetDateArg = process.argv[2] || null;
  runSyncCountryRoi(targetDateArg)
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
