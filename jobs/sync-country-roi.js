import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { fetchCampaignSpendByCountry } from "./meta-client.js";
import { fetchGamCountryRevenue, getGoogleServiceAccountToken } from "./gam-client.js";

/**
 * Job Sinkronisasi ROI per Negara (Country ROI) ke Supabase TigerROI
 * Menggabungkan biaya iklan Meta Ads per negara dengan pendapatan Google Ad Manager per negara.
 * Mendukung rentang multi-hari (semua hari sesuai campaign).
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

// Kurs mata uang GAM resmi TigerROI
const GAM_FX_RATES = {
  "23380486168": 190.87, // Tacobell (INR)
  "23344333667": 18155.28, // Trayedit (USD)
  "23367555867": 18155.28, // TikTok Mod (USD)
  "23340206616": 18155.28, // IHOP (USD)
};

// Pencocokan baris GAM (siteName / URL / adUnitName) ke subdomain & site_code
function mapGamRowToSite(row, defaultSiteCode, subdomainsList, sitesList) {
  const host = String(row.siteName || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
  const unit = String(row.adUnitName || "").toLowerCase();

  // 1. Prioritas 1: Cocokkan host URL langsung ke 17 subdomain resmi
  if (host) {
    for (const sub of subdomainsList || []) {
      if (!sub.name) continue;
      const subName = sub.name.toLowerCase();
      if (
        host === subName ||
        host.startsWith(subName + ".") ||
        host.endsWith("." + subName) ||
        host.includes("." + subName + ".") ||
        (sub.parent_domain && host === subName + "." + sub.parent_domain.toLowerCase())
      ) {
        return {
          siteCode: sub.site_code || defaultSiteCode,
          subdomainName: sub.name,
        };
      }
    }
  }

  // 2. Prioritas 2: Cocokkan nama unit iklan ke subdomain
  for (const sub of subdomainsList || []) {
    if (!sub.name) continue;
    const subName = sub.name.toLowerCase();
    const regex = new RegExp("(^|[^a-z0-9])" + subName + "([^a-z0-9]|$)", "i");
    if (regex.test(unit)) {
      return {
        siteCode: sub.site_code || defaultSiteCode,
        subdomainName: sub.name,
      };
    }
  }

  // 3. Prioritas 3: Cocokkan nama unit iklan ke sites
  for (const s of sitesList || []) {
    if (!s.site_code) continue;
    if (unit.includes(s.site_code.toLowerCase())) {
      const matchingSubs = (subdomainsList || []).filter((sub) => sub.site_code === s.site_code);
      const suffix = s.site_code.split("-").pop();
      const defaultSub = matchingSubs.find((sub) => sub.name === suffix) || matchingSubs[0];
      return {
        siteCode: s.site_code,
        subdomainName: defaultSub ? defaultSub.name : s.site_code,
      };
    }
  }

  // 4. Fallback ke default site code network tersebut
  const matchingSubs = (subdomainsList || []).filter((sub) => sub.site_code === defaultSiteCode);
  const suffix = (defaultSiteCode || "").split("-").pop();
  const defaultSub = matchingSubs.find((sub) => sub.name === suffix) || matchingSubs[0];

  return {
    siteCode: defaultSiteCode || "unmapped",
    subdomainName: defaultSub ? defaultSub.name : defaultSiteCode || "unmapped",
  };
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

let regionNames = null;
try {
  regionNames = new Intl.DisplayNames(["en"], { type: "region" });
} catch {
  regionNames = null;
}

function resolveCountryName(codeOrName) {
  const str = String(codeOrName || "").trim();
  if (!str || str === "UNKNOWN") return str || "-";
  if (str.length === 2 && /^[A-Za-z]{2}$/.test(str)) {
    const code = str.toUpperCase();
    if (regionNames) {
      try {
        const name = regionNames.of(code);
        if (name && name !== code) return name;
      } catch {
        // Abaikan jika tidak terdaftar
      }
    }
  }
  return str;
}

// Menyamakan nama subdomain antara GAM (domain utuh: keto.ihopmenuwithprices.us) dan Meta (slug: keto)
// Keduanya akan selalu dinormalkan menjadi FQDN resmi yang sama persis (misal: keto.ihopmenuwithprices.us)
function resolveCanonicalSubDomain(rawName, subdomains) {
  const clean = String(rawName || "").trim().toLowerCase().replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  if (!clean || clean === "unmapped") return clean;
  const slug = clean.split(".")[0];

  for (const s of subdomains) {
    const sName = String(s.name || "").trim().toLowerCase();
    const sSlug = sName.split(".")[0];
    const parent = String(s.parent_domain || "")
      .toLowerCase()
      .replace(/^https?:\/\//i, "")
      .replace(/\/.*$/, "")
      .trim();

    if (slug === sSlug || clean === sName) {
      if (sName.includes(".")) return sName;
      if (parent) return `${sSlug}.${parent}`;
      return sName;
    }
  }
  return clean;
}

export async function runSyncCountryRoi(startDate = null, endDate = null) {
  let start = startDate;
  let end = endDate;

  // Jika tidak ada argumen, cari rentang tanggal dari database view_daily_roi
  if (!start) {
    const { data: roiDates } = await supabase
      .from("view_daily_roi")
      .select("date")
      .order("date", { ascending: true });

    if (roiDates && roiDates.length > 0) {
      start = roiDates[0].date;
      end = roiDates[roiDates.length - 1].date;
    } else {
      start = getJakartaDate(30); // 30 hari ke belakang
      end = getJakartaDate(0);
    }
  } else if (!end) {
    end = start;
  }

  const startedAt = new Date().toISOString();
  console.log(`===============================================================`);
  console.log(`   TIGERROI - SINKRONISASI ROI PER NEGARA (MULTI-HARI)`);
  console.log(`===============================================================`);
  console.log(`Rentang Tanggal : ${start} s/d ${end}`);
  console.log(`Waktu Mulai     : ${startedAt}`);
  console.log(`---------------------------------------------------------------`);

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

    // 2. Ambil master subdomain beserta parent_domain untuk pembentukan FQDN
    const { data: subdomainsData } = await supabase
      .from("subdomains")
      .select("id, name, site_code, pic, parent_domain");
    const subdomains = subdomainsData || [];

    const { data: sitesData } = await supabase
      .from("sites")
      .select("id, name, site_code, domain");
    const sites = sitesData || [];

    // Map: date__subDomain__countryCode -> { date, subDomain, countryCode, spend, impressions, clicks }
    const spendMap = new Map();

    // 3. Tarik spend dari Meta Ads
    const { data: metaAccounts } = await supabase
      .from("meta_accounts")
      .select("id, account_id, access_token, is_active")
      .eq("is_active", true);

    const accounts = metaAccounts || [];
    if (accounts.length === 0) {
      try {
        const { data: adAccList } = await supabase
          .from("ad_accounts")
          .select("id, account_id, act_id, status, sync_disabled")
          .or("status.eq.ACTIVE,sync_disabled.eq.false");
        if (adAccList && adAccList.length > 0) {
          console.log(`ℹ️ Menemukan ${adAccList.length} akun aktif dari ad_accounts.`);
          for (const a of adAccList) {
            const actId = a.account_id || a.act_id;
            if (actId) {
              accounts.push({
                id: a.id,
                account_id: actId,
                access_token: null,
                is_active: true,
              });
            }
          }
        }
      } catch (err) {
        console.warn(`Gagal memeriksa ad_accounts: ${err.message}`);
      }
    }

    if (accounts.length === 0 && process.env.META_ACCOUNT_ID && GLOBAL_META_TOKEN) {
      accounts.push({
        id: "env-account",
        account_id: process.env.META_ACCOUNT_ID,
        access_token: null,
      });
    }

    console.log(`Ditemukan ${accounts.length} akun Meta Ads untuk di-scan.`);
    for (const acc of accounts) {
      const token = acc.access_token || GLOBAL_META_TOKEN;
      if (!token) {
        console.log(`ℹ️ Akun ${acc.account_id} belum memiliki token Meta.`);
        continue;
      }

      try {
        console.log(`Menarik data Meta Ads [${start} s/d ${end}] untuk akun ${acc.account_id}...`);
        const countryRows = await fetchCampaignSpendByCountry(acc.account_id, token, {
          since: start,
          until: end,
        });

        for (const r of countryRows) {
          const rowDate = r.date || start;
          const subDomain = resolveCanonicalSubDomain(
            matchSubDomain(r.campaignName, subdomains),
            subdomains,
          );
          const cCode = r.countryCode || "UNKNOWN";
          const key = `${rowDate}__${subDomain}__${cCode}`;

          const existing = spendMap.get(key) || {
            date: rowDate,
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
        console.log(`  -> Berhasil menarik ${countryRows.length} baris breakdown negara dari Meta.`);
      } catch (err) {
        console.warn(`⚠️ Gagal menarik breakdown negara Meta untuk akun ${acc.account_id}: ${err.message}`);
      }
    }

    // 4. Tarik revenue dari Google Ad Manager
    const earnMap = new Map(); // key: date__subDomain__countryCode -> { date, subDomain, countryCode, countryName, earning, impressions, clicks }

    let clientEmail = process.env.GAM_CLIENT_EMAIL;
    let privateKey = process.env.GAM_PRIVATE_KEY;
    if ((!clientEmail || !privateKey) && process.env.GAM_SERVICE_ACCOUNT_JSON) {
      try {
        const sa = JSON.parse(process.env.GAM_SERVICE_ACCOUNT_JSON);
        clientEmail = sa.client_email;
        privateKey = sa.private_key;
      } catch {
        // Abaikan jika format bukan JSON valid
      }
    }
    if ((!clientEmail || !privateKey) && existsSync(resolve("./service-account.json"))) {
      try {
        const sa = JSON.parse(readFileSync(resolve("./service-account.json"), "utf-8"));
        clientEmail = sa.client_email;
        privateKey = sa.private_key;
      } catch {
        // Abaikan jika parsing gagal
      }
    }

    if (clientEmail && privateKey) {
      try {
        const gamToken = await getGoogleServiceAccountToken({ clientEmail, privateKey });
        for (const net of GAM_NETWORKS) {
          try {
            console.log(`Menarik breakdown negara GAM [${start} s/d ${end}] untuk network ${net.domain}...`);
            const gamRows = await fetchGamCountryRevenue(net.networkCode, gamToken, {
              startDate: start,
              endDate: end,
            });

            // Pendapatan GAM ditarik langsung dalam mata uang IDR murni resmi (tidak dikalikan kurs ganda)
            for (const gr of gamRows) {
              const rowDate = gr.date || start;
              const mapped = mapGamRowToSite(
                { siteName: gr.siteName, adUnitName: gr.adUnitName },
                net.defaultSiteCode,
                subdomains,
                sites,
              );
              const subDomain = resolveCanonicalSubDomain(
                mapped.subdomainName || gr.siteName || net.domain,
                subdomains,
              );
              const cCode = gr.countryCode || "UNKNOWN";
              const key = `${rowDate}__${subDomain}__${cCode}`;

              const existing = earnMap.get(key) || {
                date: rowDate,
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
            console.log(`  -> Berhasil menarik ${gamRows.length} baris breakdown negara dari ${net.domain}.`);
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

    // 5. Gabungkan spend dan earning untuk semua hari
    const allKeys = new Set([...spendMap.keys(), ...earnMap.keys()]);
    console.log(`\nMenggabungkan data: total ${allKeys.size} kombinasi (tanggal x subdomain x negara).`);

    const recordsToUpsert = [];
    for (const key of allKeys) {
      const spendItem = spendMap.get(key) || {};
      const earnItem = earnMap.get(key) || {};

      const rowDate = spendItem.date || earnItem.date || start;
      const subDomain = spendItem.subDomain || earnItem.subDomain || "unknown";
      const countryCode = spendItem.countryCode || earnItem.countryCode || "UNKNOWN";
      const countryName = resolveCountryName(earnItem.countryName || countryCode);

      const spend = Number(spendItem.spend || 0);
      const impressions = Number(earnItem.impressions || spendItem.impressions || 0);
      const clicks = Number(earnItem.clicks || spendItem.clicks || 0);
      const earning = Number(earnItem.earning || 0);

      const adTax = spend * AD_TAX_RATE;
      const totalSpending = spend + adTax;
      const profit = earning - totalSpending;

      let roi = 0;
      if (totalSpending >= 100) {
        roi = ((earning - totalSpending) / totalSpending) * 100;
      } else if (totalSpending > 0) {
        roi = Math.min(((earning - totalSpending) / totalSpending) * 100, 999999.99);
      } else if (earning > 0) {
        roi = 999999.99;
      }
      roi = Math.min(Math.max(roi, -100), 999999.99);

      let cpc = 0;
      if (clicks > 0) {
        const rawCpc = spend > 0 ? spend / clicks : earning / clicks;
        cpc = Math.min(rawCpc, 999999.99);
      }

      recordsToUpsert.push({
        date: rowDate,
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
      console.log(`Menyimpan ${recordsToUpsert.length} baris ke tabel Supabase 'country_roi'...`);
      // Upsert dalam batch 500 baris agar aman dari limit payload
      const BATCH_SIZE = 500;
      for (let i = 0; i < recordsToUpsert.length; i += BATCH_SIZE) {
        const batch = recordsToUpsert.slice(i, i + BATCH_SIZE);
        const { error: upsertErr } = await supabase.from("country_roi").upsert(batch, {
          onConflict: "date,sub_domain,country_code",
        });

        if (upsertErr) {
          throw new Error(`Gagal menyimpan batch ${i}: ${upsertErr.message}`);
        }
      }
      console.log(`✅ Berhasil menyimpan ${recordsToUpsert.length} baris ke tabel country_roi.`);
    } else {
      console.log("ℹ️ Tidak ada data negara yang ditemukan.");
    }

    // 6. Catat sukses ke sync_runs
    if (runId) {
      await supabase
        .from("sync_runs")
        .update({
          status: "success",
          completed_at: new Date().toISOString(),
          summary: `Tersinkronisasi ${recordsToUpsert.length} baris negara (${start} s/d ${end})`,
        })
        .eq("id", runId);
    }

    console.log(`🎉 Sinkronisasi Selesai.`);
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
  const startArg = process.argv[2] || null;
  const endArg = process.argv[3] || null;
  runSyncCountryRoi(startArg, endArg)
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
