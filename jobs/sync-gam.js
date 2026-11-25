import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  fetchGamDailyRevenue,
  fetchGamHourlyFillRate,
  fetchGamHourlyRevenue,
  fetchGamSites,
  getGamNetwork,
  getGoogleServiceAccountToken,
} from "./gam-client.js";
import { evaluateGamPolicyStatus } from "./gam-policy-helper.js";
import { recordHourlyGamSnapshots, recordRoiSnapshot } from "./snapshot-helper.js";
import { toWibDateTime } from "./timezone-cutoff.js";

/**
 * Job Sinkronisasi Google Ad Manager (GAM) ke Supabase TigerROI
 * Menarik pendapatan AdX dan AdSense dari 4 network GAM (Trayedit, TikTok, Tacobell, IHOP)
 * Dijalankan terjadwal via GitHub Actions atau lokal.
 */

// Muat variabel environment (.env, server/.env jika ada)
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

const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";

// Daftar Network GAM beserta domain utamanya
const GAM_NETWORKS = [
  { domain: "trayedit.com", networkCode: "23344333667", defaultSiteCode: "tray-decor" },
  { domain: "tiktokmodapk.net", networkCode: "23367555867", defaultSiteCode: "tiktok-mod" },
  { domain: "tacobellmenuu.us", networkCode: "23380486168", defaultSiteCode: "taco-fries" },
  { domain: "ihopmenuwithprices.us", networkCode: "23340206616", defaultSiteCode: "ihop-menu" },
  { domain: "cmhhealths.com", networkCode: "23350466753", defaultSiteCode: "cmhhealths" },
  { domain: "uniqueinfo24.com", networkCode: "23342288590", defaultSiteCode: "uniqueinfo24" },
  { domain: "ziperto.org", networkCode: "23355757170", defaultSiteCode: "ziperto" },
  { domain: "workmoney24.com", networkCode: "23342288461", defaultSiteCode: "workmoney24" },
  { domain: "velocitytv.com.pk", networkCode: "23360577147", defaultSiteCode: "velocitytv" },
  // foodsfact.org adalah shared domain (hanya 5 subdomain resmi yang disinkronkan ke TigerROI)
  { domain: "foodsfact.org", networkCode: "21869641910", defaultSiteCode: "foodsfact", isShared: true },
];

// Kurs resmi konversi mata uang GAM ke IDR
const GAM_FX_RATES = {
  "23380486168": 190.87, // Tacobell (INR)
  "23344333667": 18155.28, // Trayedit (USD)
  "23367555867": 18155.28, // TikTok Mod (USD)
  "23340206616": 18155.28, // IHOP (USD)
  "23350466753": 18155.28, // CMH Healths (USD)
  "23342288590": 18155.28, // UniqueInfo24 (USD)
  "23355757170": 18155.28, // Ziperto (USD)
  "23342288461": 18155.28, // WorkMoney24 (USD)
  "23360577147": 18155.28, // Velocity TV (USD)
  "21869641910": 18155.28, // FoodsFact (USD)
};

// Zona waktu resmi untuk masing-masing network Google Ad Manager:
const GAM_PRESET_TIMEZONES = {
  "cmhhealths.com": "GMT+1",
  "trayedit.com": "GMT+6",
  "tiktokmodapk.net": "GMT+5",
  "tacobellmenuu.us": "GMT+5",
  "ihopmenuwithprices.us": "GMT-3",
  "uniqueinfo24.com": "GMT+6",
  "ziperto.org": "America/New_York",
  "velocitytv.com.pk": "Asia/Karachi",
  "workmoney24.com": "GMT+6",
  "foodsfact.org": "America/Denver",
  "23350466753": "GMT+1",
  "23344333667": "GMT+6",
  "23367555867": "GMT+5",
  "23380486168": "GMT+5",
  "23340206616": "GMT-3",
  "23342288590": "GMT+6",
  "23355757170": "America/New_York",
  "23360577147": "Asia/Karachi",
  "23342288461": "GMT+6",
  "21869641910": "America/Denver",
};

function formatIsoDate(d) {
  if (!d) return "";
  const s = String(d).replace(/\D/g, "");
  if (s.length === 8) {
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  }
  return String(d);
}

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

// Format tanggal YYYY-MM-DD berdasarkan zona waktu spesifik network GAM
function getNetworkDate(daysAgo = 0, timeZone = "Asia/Jakarta") {
  const d = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone || "Asia/Jakarta",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return formatter.format(d);
  } catch {
    return getJakartaDate(daysAgo);
  }
}

// Mengambil kredensial Service Account dari env atau file lokal
function loadServiceAccountCredentials() {
  const clientEmail = process.env.GAM_CLIENT_EMAIL;
  const privateKey = process.env.GAM_PRIVATE_KEY;

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
function mapGamRowToSite(row, defaultSiteCode, subdomainsList, sitesList, isShared = false, networkDomain = "") {
  const host = String(row.siteName || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
  const unit = String(row.adUnitName || "").toLowerCase();

  const netDomainClean = (networkDomain || "").toLowerCase().trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");

  // Saring daftar subdomain agar HANYA mencakup subdomain milik network domain ini
  const scopedSubs = (subdomainsList || []).filter((sub) => {
    if (!sub.name) return false;
    if (!netDomainClean) return true;
    const parentClean = (sub.parent_domain || "").toLowerCase().trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    return (
      parentClean === netDomainClean ||
      sub.name.toLowerCase().endsWith(`.${netDomainClean}`) ||
      sub.name.toLowerCase() === netDomainClean ||
      sub.site_code === defaultSiteCode
    );
  });

  // 1. Prioritas 1: Cocokkan host URL langsung ke subdomain resmi
  if (host) {
    for (const sub of scopedSubs) {
      if (!sub.name) continue;
      const subName = sub.name.toLowerCase();
      // Cocokkan apakah host persis, berawalan nama subdomain, atau mengandung nama subdomain
      if (
        host === subName ||
        host.startsWith(`${subName}.`) ||
        host.endsWith(`.${subName}`) ||
        host.includes(`.${subName}.`) ||
        (sub.parent_domain && host === `${subName}.${sub.parent_domain.toLowerCase()}`)
      ) {
        return {
          siteCode: sub.site_code || defaultSiteCode,
          subdomainName: sub.name,
          matched: true,
        };
      }
    }
  }

  // 1b. Khusus Domain Tunggal Berbasis Path / URL Slug (misal: velocitytv.com.pk/news/ atau /finance/):
  // Jika adUnitName atau siteName memuat path landing page (HANYA dicek ke subdomain milik network ini)
  for (const sub of scopedSubs) {
    if (!sub.name) continue;
    const subName = sub.name.toLowerCase();
    const slug = subName.split(".")[0]; // "news", "dollar", "finance", "insurance"
    if (slug && (unit.includes(`/${slug}/`) || unit.includes(`/${slug}`) || host.includes(`/${slug}`))) {
      return {
        siteCode: sub.site_code || defaultSiteCode,
        subdomainName: sub.name,
        matched: true,
      };
    }
  }

  // 1c. Khusus Shared Domain FoodsFact (foodsfact.org):
  // Cocokkan langsung ke 5 subdomain resmi berdasarkan alias Keitaro, site_code, atau slug
  const FOODSFACT_SHARED_ALIASES = [
    { key: "dwdm", siteCode: "DWDM", subName: "eat.foodsfact.org" },
    { key: "8f9fdwdm", siteCode: "DWDM", subName: "eat.foodsfact.org" },
    { key: "wdm", siteCode: "DWDM", subName: "eat.foodsfact.org" },
    { key: "eat", siteCode: "DWDM", subName: "eat.foodsfact.org" },

    { key: "wmyn", siteCode: "WMYN", subName: "property.foodsfact.org" },
    { key: "6sp9wmyn", siteCode: "WMYN", subName: "property.foodsfact.org" },
    { key: "property", siteCode: "WMYN", subName: "property.foodsfact.org" },

    { key: "tx5x", siteCode: "TX5X", subName: "finance.foodsfact.org" },
    { key: "3brstx5x", siteCode: "TX5X", subName: "finance.foodsfact.org" },
    { key: "finance", siteCode: "TX5X", subName: "finance.foodsfact.org" },

    { key: "4svn", siteCode: "4SVN", subName: "insurance.foodsfact.org" },
    { key: "s6c34svn", siteCode: "4SVN", subName: "insurance.foodsfact.org" },
    { key: "insurance", siteCode: "4SVN", subName: "insurance.foodsfact.org" },

    { key: "tg1d", siteCode: "TG1D", subName: "guides.foodsfact.org" },
    { key: "clhntg1d", siteCode: "TG1D", subName: "guides.foodsfact.org" },
    { key: "guides", siteCode: "TG1D", subName: "guides.foodsfact.org" },
  ];

  if (isShared || host.includes("foodsfact") || unit.includes("foodsfact") || netDomainClean === "foodsfact.org") {
    for (const a of FOODSFACT_SHARED_ALIASES) {
      if (unit.includes(a.key) || host.includes(a.key)) {
        return {
          siteCode: a.siteCode,
          subdomainName: a.subName,
          matched: true,
        };
      }
    }
  }

  // 2. Prioritas 2: Cocokkan nama unit iklan ke subdomain (FQDN, slug, site_code, atau campaign_codes)
  for (const sub of scopedSubs) {
    if (!sub.name) continue;
    const subName = sub.name.toLowerCase();
    const slug = subName.split(".")[0];
    const sCode = (sub.site_code || "").toLowerCase();
    const cCodes = String(sub.campaign_codes || "")
      .split(/[^a-zA-Z0-9]+/)
      .map((c) => c.trim().toLowerCase())
      .filter(Boolean);

    // Cek kecocokan FQDN atau slug di unit
    const regex = new RegExp(`(^|[^a-z0-9])(${subName}|${slug})([^a-z0-9]|$)`, "i");
    if (regex.test(unit)) {
      return {
        siteCode: sub.site_code || defaultSiteCode,
        subdomainName: sub.name,
        matched: true,
      };
    }

    // Cek kecocokan site_code di unit
    if (sCode && (unit.includes(sCode) || unit === sCode)) {
      return {
        siteCode: sub.site_code,
        subdomainName: sub.name,
        matched: true,
      };
    }

    // Cek kecocokan campaign_codes di unit
    for (const code of cCodes) {
      if (unit.includes(code) || unit === code) {
        return {
          siteCode: sub.site_code,
          subdomainName: sub.name,
          matched: true,
        };
      }
    }

    // Variasi penamaan unit iklan singkat di GAM:
    // Contoh untuk /news: 'new1', 'new2', 'newanchor', 'news_top', 'new_1'
    if (slug === "news" && (/^new[0-9_]/.test(unit) || unit.startsWith("newanchor") || unit.startsWith("new_") || unit.startsWith("news"))) {
      return {
        siteCode: sub.site_code || defaultSiteCode,
        subdomainName: sub.name,
        matched: true,
      };
    }
    // Contoh untuk /insurance: 'ins1', 'ins2', 'insanchor', 'ins_top', 'ins_1'
    if (slug === "insurance" && (/^ins[0-9_]/.test(unit) || unit.startsWith("insanchor") || unit.startsWith("ins_") || unit.startsWith("insurance"))) {
      return {
        siteCode: sub.site_code || defaultSiteCode,
        subdomainName: sub.name,
        matched: true,
      };
    }
    // Contoh untuk /finance: 'fin1', 'fin2', 'financhor', 'fin_top', 'fin_1'
    if (slug === "finance" && (/^fin[0-9_]/.test(unit) || unit.startsWith("financhor") || unit.startsWith("fin_") || unit.startsWith("finance"))) {
      return {
        siteCode: sub.site_code || defaultSiteCode,
        subdomainName: sub.name,
        matched: true,
      };
    }
    // Contoh untuk /dollar: 'dol1', 'dol2', 'dolanchor', 'dol_top', 'dol_1'
    if (slug === "dollar" && (/^dol[0-9_]/.test(unit) || unit.startsWith("dolanchor") || unit.startsWith("dol_") || unit.startsWith("dollar"))) {
      return {
        siteCode: sub.site_code || defaultSiteCode,
        subdomainName: sub.name,
        matched: true,
      };
    }
  }

  // 3. Prioritas 3: Cocokkan nama unit iklan ke sites
  for (const s of sitesList || []) {
    if (!s.site_code) continue;
    if (unit.includes(s.site_code.toLowerCase())) {
      // Cari subdomain default untuk site ini
      const matchingSubs = scopedSubs.filter((sub) => sub.site_code === s.site_code);
      const suffix = s.site_code.split("-").pop();
      const defaultSub = matchingSubs.find((sub) => sub.name.toLowerCase().startsWith(suffix)) || matchingSubs[0];
      return {
        siteCode: s.site_code,
        subdomainName: defaultSub ? defaultSub.name : s.site_code,
        matched: true,
      };
    }
  }

  // KHUSUS SHARED DOMAIN (seperti foodsfact.org):
  // Jika tidak cocok dengan 5 subdomain resmi TigerROI, JANGAN PERNAH FALLBACK!
  // Abaikan/skip baris ini agar pendapatan milik orang lain tidak masuk ke dashboard.
  if (isShared) {
    return {
      siteCode: "unmapped",
      subdomainName: "unmapped",
      matched: false,
    };
  }

  // 4. Fallback ke default site code network tersebut (hanya untuk non-shared domain)
  const matchingSubs = scopedSubs.filter((sub) => sub.site_code === defaultSiteCode);
  const suffix = (defaultSiteCode || "").split("-").pop();
  const defaultSub = matchingSubs.find((sub) => sub.name === suffix) || matchingSubs[0];

  return {
    siteCode: defaultSiteCode || "unmapped",
    subdomainName: defaultSub ? defaultSub.name : defaultSiteCode || "unmapped",
    matched: true,
  };
}

async function sendTelegramAlert(message) {
  // Telegram ditunda sesuai instruksi (docs/deferred-features.md)
  console.warn(`[Alert] ${message}`);
}

async function retrySupabaseOp(fn, label = "Operasi Supabase", maxRetries = 3, delayMs = 2000) {
  let lastErr;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fn();
      if (res?.error) {
        lastErr = res.error;
        console.warn(`⚠️ ${label} percobaan ${i + 1}/${maxRetries} gagal: ${res.error.message}. Menunggu ${delayMs}ms...`);
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      console.warn(`⚠️ ${label} percobaan ${i + 1}/${maxRetries} error: ${err.message}. Menunggu ${delayMs}ms...`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
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

    // 4. Ambil daftar sites, subdomains, gam_accounts, dan domains untuk sinkronisasi
    const [{ data: sitesList }, { data: subdomainsList }, { data: gamAccountsList }, { data: domainsList }] = await Promise.all([
      supabase.from("sites").select("site_code, is_active").eq("is_active", true),
      supabase.from("subdomains").select("name, site_code, parent_domain"),
      supabase.from("gam_accounts").select("name, network_code, status"),
      supabase.from("domains").select("domain_url, network_code, status").not("network_code", "is", null),
    ]);

    const sites = sitesList || [];
    const subdomains = subdomainsList || [];

    // Bangun daftar Network GAM dinamis dari database Supabase (tabel gam_accounts & domains), fallback ke GAM_NETWORKS
    const activeNetworks = [];
    const seenCodes = new Set();

    if (gamAccountsList && gamAccountsList.length > 0) {
      for (const acc of gamAccountsList) {
        if (!acc.network_code) continue;
        const code = String(acc.network_code).trim();
        const status = String(acc.status || "").toLowerCase();
        if (status === "inactive" || status === "nonaktif" || status === "banned") continue;
        seenCodes.add(code);
        const preset = GAM_NETWORKS.find((n) => n.networkCode === code);
        activeNetworks.push({
          domain: acc.name || preset?.domain || "unknown",
          networkCode: code,
          defaultSiteCode: preset?.defaultSiteCode || (acc.name || "").split(".")[0] || "unmapped",
          isShared: preset?.isShared || false,
        });
      }
    }

    if (domainsList && domainsList.length > 0) {
      for (const dom of domainsList) {
        if (!dom.network_code) continue;
        const code = String(dom.network_code).trim();
        if (seenCodes.has(code)) continue;
        const status = String(dom.status || "").toLowerCase();
        if (status === "inactive" || status === "nonaktif" || status === "banned") continue;
        seenCodes.add(code);
        const preset = GAM_NETWORKS.find((n) => n.networkCode === code);
        activeNetworks.push({
          domain: dom.domain_url || preset?.domain || "unknown",
          networkCode: code,
          defaultSiteCode: preset?.defaultSiteCode || (dom.domain_url || "").split(".")[0] || "unmapped",
          isShared: preset?.isShared || false,
        });
      }
    }

    // Pastikan fallback GAM_NETWORKS tetap masuk jika belum tercatat di database
    for (const net of GAM_NETWORKS) {
      if (!seenCodes.has(net.networkCode)) {
        activeNetworks.push(net);
        seenCodes.add(net.networkCode);
      }
    }

    const dateToday = getJakartaDate(0);
    const currentMonthStart = dateToday.slice(0, 7) + "-01";
    const daysBack = process.env.DAYS_BACK && Number(process.env.DAYS_BACK) > 0
      ? Number(process.env.DAYS_BACK)
      : Math.max(1, Math.ceil((Date.now() - new Date(currentMonthStart).getTime()) / (24 * 60 * 60 * 1000)));

    // Untuk bulan berjalan, selalu tarik sejak tanggal 1 bulan ini agar tidak ada tanggal yang tertinggal/hilang
    let dateSince = getJakartaDate(daysBack);
    if (!process.env.ALLOW_PAST_MONTHS && dateSince < currentMonthStart) {
      dateSince = currentMonthStart;
    }
    const dateRange = { startDate: dateSince, endDate: dateToday };

    console.log(
      `Rentang Penarikan GAM: ${dateRange.startDate} s/d ${dateRange.endDate} (${daysBack} hari ke belakang, batas bulan: ${currentMonthStart})...`,
    );

    let totalSyncedRows = 0;
    const errors = [];
    const dailyMap = new Map(); // key `${date}__${site_code}` -> aggregated data
    const allHourlyGamRows = []; // Menyimpan data historis per jam dari GAM (Opsi 2)

    // 5. Loop ke seluruh Network GAM aktif
    for (const net of activeNetworks) {
      console.log(
        `\n--> Menarik Pendapatan GAM untuk ${net.domain} (Network: ${net.networkCode})...`,
      );

      try {
        // Tentukan zona waktu GAM untuk network ini (prioritas: setelan database -> preset domain -> Google API)
        const domainKey = String(net.domain || "").toLowerCase().trim();
        const codeKey = String(net.networkCode || "").trim();
        const existingAcc = (gamAccountsList || []).find(
          (a) =>
            String(a.network_code || "").trim() === codeKey ||
            String(a.name || "").toLowerCase().trim() === domainKey,
        );
        let networkTimeZone =
          existingAcc?.report_time_zone ||
          GAM_PRESET_TIMEZONES[domainKey] ||
          GAM_PRESET_TIMEZONES[codeKey];

        if (!networkTimeZone) {
          try {
            const netInfo = await getGamNetwork(net.networkCode, accessToken);
            if (netInfo?.timeZone) {
              networkTimeZone = netInfo.timeZone;
              console.log(`    Zona Waktu Network GAM: ${networkTimeZone}`);
            }
          } catch (tzErr) {
            console.warn(`    ⚠️ Gagal membaca zona waktu GAM (${net.domain}): ${tzErr.message}`);
          }
        }
        if (!networkTimeZone) networkTimeZone = "GMT+0";

        // Khusus uniqueinfo24.com: diselaraskan 100% mengikuti tanggal kalender GAM UI (tanpa pergeseran jam 23:00 ke 00:00 WIB)
        const isNonWib = networkTimeZone && networkTimeZone !== "Asia/Jakarta" && networkTimeZone !== "GMT+7" && net.domain !== "uniqueinfo24.com";

        // Pastikan tanggal akhir (endDate) tidak melebihi hari ini di zona waktu network tersebut
        // agar Google Ad Manager tidak menolak permintaan dengan error 'Date cannot be in the future'
        const netToday = getNetworkDate(0, networkTimeZone);
        const netEndDate = dateRange.endDate > netToday ? netToday : dateRange.endDate;
        const netStartDate = dateRange.startDate > netEndDate ? netEndDate : dateRange.startDate;
        const netDateRange = { startDate: netStartDate, endDate: netEndDate };

        console.log(`    Rentang penarikan network (${networkTimeZone}): ${netDateRange.startDate} s/d ${netDateRange.endDate} (Hari ini di network: ${netToday})`);

        const rows = await fetchGamDailyRevenue(net.networkCode, accessToken, netDateRange);
        console.log(`    Ditemukan ${rows.length} baris unit iklan.`);

        let netTotalRev = 0;
        let netLatestDate = "";

        for (const row of rows) {
          const mapped = mapGamRowToSite(row, net.defaultSiteCode, subdomains, sites, net.isShared, net.domain);
          // Jika shared domain dan bukan salah satu subdomain resmi TigerROI, abaikan baris ini!
          if (net.isShared && !mapped.matched) {
            continue;
          }

          netTotalRev += row.totalRevenue;
          if (!netLatestDate || row.date > netLatestDate) {
            netLatestDate = row.date;
          }

          const siteCode = mapped.siteCode;
          const subName = (mapped.subdomainName || "").toLowerCase().trim();
          const rowDate = formatIsoDate(row.date);
          const aggKey = `${rowDate}__${siteCode}__${subName}`;

          if (!dailyMap.has(aggKey)) {
            dailyMap.set(aggKey, {
              date: rowDate,
              site_code: siteCode,
              subdomain: subName,
              source: "gam",
              revenue: 0,
              spend: 0,
              impressions: 0,
              clicks: 0,
              metadata: {
                adx_revenue: 0,
                adsense_revenue: 0,
                network_codes: [net.networkCode],
              },
            });
          }

          const current = dailyMap.get(aggKey);
          current.revenue += row.totalRevenue;
          current.impressions += row.impressions;
          current.clicks += row.clicks;
          current.metadata.adx_revenue += row.adxRevenue;
          current.metadata.adsense_revenue += row.adsenseRevenue;
          if (!current.metadata.network_codes.includes(net.networkCode)) {
            current.metadata.network_codes.push(net.networkCode);
          }
        }

        // Hitung waktu lokal saat ini di zona waktu GAM tersebut
        const now = new Date();
        let gamLocalTime = "";
        const gmtMatch = String(networkTimeZone).trim().match(/^(?:GMT|UTC)?([+-]\d+)(?::(\d+))?$/i);
        if (gmtMatch) {
          const hours = parseInt(gmtMatch[1], 10);
          const mins = gmtMatch[2] ? parseInt(gmtMatch[2], 10) : 0;
          const offsetMs = (hours * 60 + (hours < 0 ? -mins : mins)) * 60 * 1000;
          const utcMs = now.getTime() + now.getTimezoneOffset() * 60 * 1000;
          const targetDate = new Date(utcMs + offsetMs);
          const h = String(targetDate.getHours()).padStart(2, "0");
          const m = String(targetDate.getMinutes()).padStart(2, "0");
          gamLocalTime = `${h}:${m}`;
        } else {
          try {
            gamLocalTime = new Intl.DateTimeFormat("en-GB", {
              timeZone: networkTimeZone,
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
            }).format(now);
          } catch {
            gamLocalTime = "";
          }
        }

        // Pendapatan GAM ditarik langsung dalam mata uang IDR murni
        const totalRevenueIdr = Math.round(netTotalRev);
        const formattedEarning = `Rp ${totalRevenueIdr.toLocaleString("id-ID")}`;
        const cleanReportDate = formatIsoDate(netLatestDate || dateRange.endDate);

        // 5a. Cek Status Persetujuan & Pusat Kebijakan Situs dari Policy Helper
        let googleStatus = "Ready";
        let googleStatusDetail = "Tidak ada masalah saat ini";

        try {
          const policyResult = await evaluateGamPolicyStatus(net.networkCode, accessToken, net.domain);
          if (policyResult.status === "Limit Iklan" || policyResult.status === "Perlu Review") {
            googleStatus = policyResult.status;
            googleStatusDetail = policyResult.detail;
          } else if (netTotalRev <= 0 && (!rows || rows.length === 0)) {
            googleStatus = "Iklan Belum Tayang";
            googleStatusDetail = "Belum ada penayangan iklan hari ini";
          } else {
            googleStatus = policyResult.status || "Ready";
            googleStatusDetail = policyResult.detail || "Tidak ada masalah saat ini";
          }
        } catch (siteErr) {
          console.warn(`    ⚠️ Gagal cek sites approval (${net.domain}): ${siteErr.message}`);
        }

        const updatePayload = {
          sync_status: "ok",
          status: googleStatus === "Limit Iklan" ? "Limit Iklan" : undefined,
          status_auto: googleStatus,
          status_detail: googleStatusDetail,
          sync_earning: formattedEarning,
          last_sync_report_date: cleanReportDate,
          updated_at: new Date().toISOString(),
        };
        if (updatePayload.status === undefined) delete updatePayload.status;

        const { data: updatedRows, error: updateAccErr } = await supabase
          .from("gam_accounts")
          .update(updatePayload)
          .eq("network_code", net.networkCode)
          .select("id");

        if (updateAccErr || !updatedRows || updatedRows.length === 0) {
          const { data: nameUpdated } = await supabase
            .from("gam_accounts")
            .update(updatePayload)
            .eq("name", net.domain)
            .select("id");

          if (!nameUpdated || nameUpdated.length === 0) {
            // Jika belum ada di tabel gam_accounts sama sekali, insert akun baru
            await supabase.from("gam_accounts").insert({
              name: net.domain,
              network_code: net.networkCode,
              status: googleStatus,
              ...updatePayload,
            });
            console.log(`    ✅ Inserted new gam_account (${net.domain}) ke database.`);
          }
        }

        console.log(
          `    ✅ Updated gam_accounts (${net.domain}): ${formattedEarning}, Tgl: ${cleanReportDate}, Waktu GAM: ${gamLocalTime} (${networkTimeZone})`,
        );

        // 5b. Tarik Laporan Rasio Penayangan (Fill Rate) per jam dari GAM
        console.log(`    --> Menarik Laporan Rasio Penayangan (Fill Rate) per jam...`);
        try {
          const fillRateRows = await fetchGamHourlyFillRate(net.networkCode, accessToken, dateRange);
          console.log(`    Ditemukan ${fillRateRows.length} baris rasio penayangan per jam.`);
          for (const fRow of fillRateRows) {
            const mapped = mapGamRowToSite({ siteName: fRow.siteName }, net.defaultSiteCode, subdomains, sites, net.isShared, net.domain);
            if (net.isShared && !mapped.matched) {
              continue;
            }

            const siteCode = mapped.siteCode;
            const subName = (mapped.subdomainName || "").toLowerCase().trim();
            const fRowDate = formatIsoDate(fRow.date);
            const aggKey = `${fRowDate}__${siteCode}__${subName}`;

            if (!dailyMap.has(aggKey)) {
              dailyMap.set(aggKey, {
                date: fRowDate,
                site_code: siteCode,
                subdomain: subName,
                source: "gam",
                revenue: 0,
                spend: 0,
                impressions: 0,
                clicks: 0,
                metadata: {
                  adx_revenue: 0,
                  adsense_revenue: 0,
                  network_codes: [net.networkCode],
                  hourly: {},
                  requests: 0,
                  full_host: fRow.siteName || "",
                },
              });
            }

            const current = dailyMap.get(aggKey);
            if (!current.metadata.hourly) current.metadata.hourly = {};
            if (!current.metadata.hourly[fRow.hour]) {
              current.metadata.hourly[fRow.hour] = { req: 0, imp: 0 };
            }
            current.metadata.hourly[fRow.hour].req += fRow.requests;
            current.metadata.hourly[fRow.hour].imp += fRow.impressions;
            current.metadata.requests = (current.metadata.requests || 0) + fRow.requests;
            if (fRow.siteName && !current.metadata.full_host) {
              current.metadata.full_host = fRow.siteName;
            }
          }
        } catch (fillErr) {
          console.warn(`    ⚠️ Peringatan Fill Rate (${net.domain}): ${fillErr.message}`);
        }

        // 5c. Tarik Laporan Pendapatan per jam (Hourly Revenue) dari GAM untuk riwayat seharian
        // Rentang per jam dibatasi 2 hari terakhir di zona waktu network tersebut
        console.log(`    --> Menarik Laporan Pendapatan per jam (Hourly Revenue)...`);
        let hourlyRevRows = [];
        const netHourlyStart = getNetworkDate(2, networkTimeZone);
        const netHourlyEnd = netToday;
        const hourlyDateRange = {
          startDate: netHourlyStart,
          endDate: netHourlyEnd,
        };
        console.log(`    Rentang per jam (${networkTimeZone}): ${hourlyDateRange.startDate} s/d ${hourlyDateRange.endDate}`);
        try {
          hourlyRevRows = await fetchGamHourlyRevenue(net.networkCode, accessToken, hourlyDateRange);
          console.log(`    Ditemukan ${hourlyRevRows.length} baris pendapatan per jam.`);
          for (const hRow of hourlyRevRows) {
            const mapped = mapGamRowToSite(hRow, net.defaultSiteCode, subdomains, sites, net.isShared, net.domain);
            if (net.isShared && !mapped.matched) {
              continue;
            }

            allHourlyGamRows.push({
              ...hRow,
              siteCode: mapped.siteCode,
              subdomainName: mapped.subdomainName,
              networkTimeZone,
              networkDomain: net.domain,
              keepGamDate: net.domain === "uniqueinfo24.com",
            });
          }
        } catch (hErr) {
          console.warn(`    ⚠️ Peringatan Hourly Revenue (${net.domain}): ${hErr.message}`);
        }

        // Jika network berada di zona waktu non-WIB (seperti America/Denver) dan data per jam berhasil ditarik:
        // Gunakan pemetaan per jam ke tanggal WIB untuk dailyMap agar pendapatan hari berjalan (WIB)
        // tidak kosong akibat perbedaan siklus pergantian hari GAM.
        if (isNonWib && hourlyRevRows.length > 0) {
          // Kumpulkan tanggal-tanggal WIB yang tercakup dalam laporan hourly (biasanya 2-3 hari terakhir)
          const hourlyDatesCovered = new Set();
          for (const hRow of hourlyRevRows) {
            const wib = toWibDateTime(formatIsoDate(hRow.date), hRow.hour, networkTimeZone);
            hourlyDatesCovered.add(wib.date);
          }

          // HANYA bersihkan data dailyMap untuk tanggal-tanggal yang tercakup oleh hourly (hari ini & kemarin).
          // Tanggal lampau (hari 1 s/d 16) dari awal bulan TETAP AMAN dan tidak terhapus!
          for (const [key, val] of dailyMap.entries()) {
            if (hourlyDatesCovered.has(val.date) && val.metadata?.network_codes?.includes(net.networkCode)) {
              if (val.metadata.network_codes.length === 1) {
                dailyMap.delete(key);
              } else {
                val.metadata.network_codes = val.metadata.network_codes.filter((c) => c !== net.networkCode);
              }
            }
          }

          // Masukkan kembali data per jam yang tanggalnya sudah dikonversi presisi ke tanggal WIB
          for (const hRow of hourlyRevRows) {
            const mapped = mapGamRowToSite(hRow, net.defaultSiteCode, subdomains, sites, net.isShared, net.domain);
            if (net.isShared && !mapped.matched) continue;

            const wib = toWibDateTime(formatIsoDate(hRow.date), hRow.hour, networkTimeZone);
            const wibDate = wib.date;
            const siteCode = mapped.siteCode;
            const subName = (mapped.subdomainName || "").toLowerCase().trim();
            const aggKey = `${wibDate}__${siteCode}__${subName}`;

            if (!dailyMap.has(aggKey)) {
              dailyMap.set(aggKey, {
                date: wibDate,
                site_code: siteCode,
                subdomain: subName,
                source: "gam",
                revenue: 0,
                spend: 0,
                impressions: 0,
                clicks: 0,
                metadata: {
                  adx_revenue: 0,
                  adsense_revenue: 0,
                  network_codes: [net.networkCode],
                },
              });
            }

            const current = dailyMap.get(aggKey);
            current.revenue += hRow.totalRevenue;
            current.impressions += hRow.impressions;
            current.clicks += hRow.clicks;
            current.metadata.adx_revenue += hRow.adxRevenue;
            current.metadata.adsense_revenue += hRow.adsenseRevenue;
            if (!current.metadata.network_codes.includes(net.networkCode)) {
              current.metadata.network_codes.push(net.networkCode);
            }
          }
          console.log(`    ✅ Berhasil menyelaraskan pendapatan ${net.domain} ke tanggal WIB.`);
        }
      } catch (netErr) {
        const msg = `Network ${net.domain} (${net.networkCode}): ${netErr.message}`;
        console.error(`    ❌ ${msg}`);
        errors.push(msg);

        await supabase
          .from("gam_accounts")
          .update({
            sync_status: "error",
            status_detail: netErr.message,
            updated_at: new Date().toISOString(),
          })
          .eq("network_code", net.networkCode);
      }
    }

    // 6. Upsert ke tabel daily_stats
    const upsertRows = Array.from(dailyMap.values()).map((row) => {
      let hourlyImp = 0;
      if (row.metadata?.hourly) {
        for (const h of Object.values(row.metadata.hourly)) {
          hourlyImp += h.imp || 0;
        }
      }
      return {
        date: row.date,
        site_code: row.site_code,
        subdomain: row.subdomain || "",
        source: "gam",
        revenue: Math.round(row.revenue * 100) / 100,
        spend: 0,
        impressions: Math.max(row.impressions || 0, hourlyImp),
        clicks: row.clicks || 0,
        cpc: 0,
        metadata: row.metadata,
        updated_at: new Date().toISOString(),
      };
    });

    if (upsertRows.length > 0) {
      console.log(`\nMelakukan upsert ${upsertRows.length} baris per subdomain ke tabel daily_stats...`);
      const { error: upsertError } = await retrySupabaseOp(
        () => supabase.from("daily_stats").upsert(upsertRows, { onConflict: "date,site_code,subdomain,source" }),
        "Upsert daily_stats",
        5,
        2500
      );

      if (upsertError) {
        throw new Error(`Gagal upsert ke daily_stats: ${upsertError.message}`);
      }
      totalSyncedRows = upsertRows.length;
      console.log(`✅ Berhasil upsert ${totalSyncedRows} baris pendapatan GAM ke daily_stats.`);
    }

    // 6b. Catat riwayat snapshot per jam GAM seharian penuh (Opsi 2)
    if (allHourlyGamRows.length > 0) {
      try {
        await recordHourlyGamSnapshots(supabase, allHourlyGamRows, subdomains, sites);
      } catch (hourlySnapErr) {
        console.warn(`⚠️ Gagal mencatat hourly gam snapshots: ${hourlySnapErr.message}`);
      }
    }

    // 6c. Catat snapshot ROI realtime untuk jam sync ini
    try {
      await recordRoiSnapshot(supabase);
    } catch (snapErr) {
      console.warn(`⚠️ Gagal mencatat roi_snapshots: ${snapErr.message}`);
    }

    // 6d. Perbarui evaluasi Auto Safe CTR Governor per subdomain hari ini
    try {
      const todayDate = getJakartaDate(0);
      const { data: todayGamStats } = await supabase
        .from("daily_stats")
        .select("subdomain,impressions,clicks")
        .eq("date", todayDate)
        .eq("source", "gam");

      if (todayGamStats && todayGamStats.length > 0) {
        for (const row of todayGamStats) {
          if (!row.subdomain) continue;
          const imp = Number(row.impressions) || 0;
          const clk = Number(row.clicks) || 0;
          const ctr = imp > 0 ? Number(((clk / imp) * 100).toFixed(2)) : 0;
          let ctrStatus = "safe";
          if (imp >= 50 && ctr >= 9.0) {
            ctrStatus = "emergency";
          }
          await supabase
            .from("subdomains")
            .update({
              ctr_today: ctr,
              ctr_status: ctrStatus,
              updated_at: new Date().toISOString(),
            })
            .eq("name", row.subdomain);
        }
        console.log(`✅ Evaluasi Auto Safe CTR selesai untuk ${todayGamStats.length} subdomain.`);
      }
    } catch (ctrErr) {
      console.warn(`[Auto Safe CTR] Catatan: ${ctrErr.message}`);
    }

    // 7. Catat status akhir ke sync_runs
    const finishedAt = new Date().toISOString();
    const isSuccess = errors.length < activeNetworks.length;
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
            networks_processed: activeNetworks.length,
            errors_count: errors.length,
          },
        })
        .eq("id", runId);
    }

    console.log(
      `\n[${finishedAt}] Selesai. Status: ${status}, Baris Disinkronkan: ${totalSyncedRows}`,
    );
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
  resolve(fileURLToPath(import.meta.url)).toLowerCase() === resolve(process.argv[1]).toLowerCase();

if (isDirectRun) {
  runSyncGam();
}
