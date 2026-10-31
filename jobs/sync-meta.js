import { createClient } from "@supabase/supabase-js";
import { fetchAccountCampaigns, fetchAccountOverview, fetchCampaignInsights } from "./meta-client.js";
import { recordRoiSnapshot } from "./snapshot-helper.js";

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

// Pencocokan nama campaign Meta ke site_code menggunakan tabel subdomains & sites
function matchSiteCode(campaignName, sitesList) {
  const name = String(campaignName || "").trim();
  const nameLower = name.toLowerCase();

  // Ambil token kata pertama (misal: "RHGK" dari "RHGK 01 PROS EU RI CARROU...")
  const firstWord = (name.split(/[\s_-]+/)[0] || "").toLowerCase();

  // 1. Prioritaskan pencocokan pola spesifik (misal kode link Keitaro: "RHGK", "4QCP", "WYJ7")
  // Urutkan pola yang lebih panjang lebih dulu agar "careers-tiktok" menang atas "tiktok"
  const sortedSites = [...sitesList].sort((a, b) => {
    const lenA = (a.campaign_pattern || "").length;
    const lenB = (b.campaign_pattern || "").length;
    return lenB - lenA;
  });

  for (const site of sortedSites) {
    if (!site.campaign_pattern) continue;
    const patterns = String(site.campaign_pattern)
      .split(",")
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean);

    for (const pattern of patterns) {
      if (firstWord && firstWord === pattern) {
        return site.site_code;
      }
      if (nameLower.includes(pattern)) {
        return site.site_code;
      }
    }
  }

  // 2. Cek kecocokan langsung site_code di nama campaign
  for (const site of sitesList) {
    if (!site.site_code) continue;
    const code = site.site_code.toLowerCase();
    if (nameLower.includes(code)) {
      return site.site_code;
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
    if (startError)
      console.warn("Peringatan: Gagal mencatat start ke sync_runs:", startError.message);

    // 3. Ambil daftar pemetaan sites & subdomains
    const [{ data: sitesList, error: sitesError }, { data: subdomainsList }] = await Promise.all([
      supabase.from("sites").select("site_code, campaign_pattern, is_active").eq("is_active", true),
      supabase.from("subdomains").select("id, name, site_code, pic, pic_user_id"),
    ]);

    if (sitesError) throw new Error(`Gagal membaca tabel sites: ${sitesError.message}`);
    const sites = sitesList || [];
    const subdomains = subdomainsList || [];
    console.log(`Memuat ${sites.length} site dan ${subdomains.length} subdomain aktif.`);

    // 4. Ambil daftar akun Meta aktif dari meta_accounts
    const { data: accountsList, error: accountsError } = await supabase
      .from("meta_accounts")
      .select("id, account_id, name, access_token, currency, is_active")
      .eq("is_active", true);

    if (accountsError)
      throw new Error(`Gagal membaca tabel meta_accounts: ${accountsError.message}`);

    const accounts = accountsList || [];
    if (accounts.length === 0) {
      console.log(
        "ℹ️ Tidak ada akun aktif di meta_accounts. Memeriksa ad_accounts...",
      );
      try {
        const { data: adAccList } = await supabase
          .from("ad_accounts")
          .select("id, account_id, act_id, name, currency, status, sync_disabled")
          .or("status.eq.ACTIVE,sync_disabled.eq.false");
        if (adAccList && adAccList.length > 0) {
          console.log(`ℹ️ Menemukan ${adAccList.length} akun aktif dari ad_accounts.`);
          for (const a of adAccList) {
            const actId = a.account_id || a.act_id;
            if (actId) {
              accounts.push({
                id: a.id,
                account_id: actId,
                name: a.name || actId,
                access_token: null,
                currency: a.currency || "IDR",
                is_active: true,
              });
            }
          }
        }
      } catch (err) {
        console.warn(`Gagal memeriksa ad_accounts: ${err.message}`);
      }
    }

    if (accounts.length === 0) {
      console.log(
        "ℹ️ Memeriksa META_ACCOUNT_ID dari environment...",
      );
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

    const daysBack = Number(process.env.DAYS_BACK || 30);
    const dateToday = getJakartaDate(0);
    const dateSince = getJakartaDate(daysBack);
    const dateRange = { since: dateSince, until: dateToday };
    console.log(
      `Rentang Penarikan Meta Ads: ${dateRange.since} s/d ${dateRange.until} (${daysBack} hari ke belakang)...`,
    );

    let totalSyncedRows = 0;
    const errors = [];

    // Map agregasi: key `${date}_${site_code}` -> { date, site_code, spend, impressions, clicks, campaignCount }
    const dailyMap = new Map();

    for (const account of accounts) {
      // Prioritaskan token dari environment GitHub Secrets (GLOBAL_META_TOKEN) di atas database
      const token = GLOBAL_META_TOKEN || account.access_token;
      if (!token) {
        const msg = `Akun ${account.name} (${account.account_id}) tidak memiliki access token (baik di env maupun DB).`;
        console.error(`❌ ${msg}`);
        errors.push(msg);
        continue;
      }

      console.log(`\n--> Menarik data untuk: ${account.name} (${account.account_id})...`);
      console.log(`    Menggunakan token: ${GLOBAL_META_TOKEN ? "GitHub Secret (META_ACCESS_TOKEN)" : "Database Supabase"}`);

      try {
        // A. Ambil status dan saldo akun
        const overview = await fetchAccountOverview(account.account_id, token);
        console.log(
          `    Saldo/Limit: ${overview.currency} ${overview.remainingBudget.toLocaleString()} | Spent: ${overview.amountSpent}`,
        );

        // B. Ambil insights campaign (spend harian)
        const insights = await fetchCampaignInsights(account.account_id, token, dateRange);
        console.log(`    Ditemukan ${insights.length} baris insights campaign.`);

        let accountSpendToday = 0;
        for (const ins of insights) {
          if (ins.date === dateToday) {
            accountSpendToday += Number(ins.spend || 0);
          }
        }

        // Update informasi saldo & spend hari ini di meta_accounts & ad_accounts jika baris ada di database
        if (account.id !== "env-account") {
          await supabase
            .from("meta_accounts")
            .update({
              currency: overview.currency,
              balance: overview.balance,
              spend_cap: overview.spendCap,
              amount_spent: overview.amountSpent,
              spend_today: accountSpendToday,
              last_synced_at: new Date().toISOString(),
              last_error: null,
            })
            .eq("account_id", account.account_id);

          try {
            await supabase
              .from("ad_accounts")
              .update({
                currency: overview.currency,
                balance: overview.balance,
                spend_cap: overview.spendCap,
                amount_spent: overview.amountSpent,
                spend_today: accountSpendToday,
                status: "ACTIVE",
                updated_at: new Date().toISOString(),
              })
              .or(`account_id.eq.${account.account_id},act_id.eq.${account.account_id}`);
          } catch {
            // Lanjutkan jika tabel ad_accounts belum diperbarui
          }
        }

        for (const row of insights) {
          const siteCode = matchSiteCode(row.campaignName, sites);
          const nameLower = String(row.campaignName || "").toLowerCase();

          // Cari kecocokan subdomain spesifik
          let matchedSubName = "";
          for (const sub of subdomains) {
            if (!sub.name) continue;
            const subName = sub.name.toLowerCase();
            const regex = new RegExp(`(^|[^a-z0-9])${subName}([^a-z0-9]|$)`, "i");
            if (regex.test(nameLower)) {
              matchedSubName = sub.name;
              break;
            }
          }
          if (!matchedSubName && siteCode && siteCode !== "unmapped") {
            const matchingSubs = subdomains.filter((s) => s.site_code === siteCode);
            const suffix = siteCode.split("-").pop();
            const defaultSub = matchingSubs.find((s) => s.name === suffix) || matchingSubs[0];
            matchedSubName = defaultSub ? defaultSub.name : "";
          }

          const aggKey = `${row.date}__${siteCode}__${matchedSubName}`;

          if (!dailyMap.has(aggKey)) {
            dailyMap.set(aggKey, {
              date: row.date,
              site_code: siteCode,
              subdomain: matchedSubName,
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

        // C. Ambil daftar seluruh campaign Meta untuk halaman Campaign Fleet
        try {
          const rawCampaigns = await fetchAccountCampaigns(account.account_id, token);
          console.log(`    Ditemukan ${rawCampaigns.length} campaign Meta pada armada.`);

          // Daftar subdomain sudah dimuat di awal
          const dbSubdomains = subdomains;

          // Ambil daftar profil tim
          const { data: profilesList } = await supabase
            .from("profiles")
            .select("id, name, email, role, campaigns");

          // Siapkan wadah campaign per profil ID
          const userCampaignsMap = new Map();
          for (const p of profilesList || []) {
            userCampaignsMap.set(p.id, []);
          }

          // Cari profil Superadmin untuk menampung campaign tanpa PIC
          const superadminProfile = (profilesList || []).find((p) => 
            (p.role || "").includes("superadmin") || (p.email || "").includes("superadmin")
          );

          for (const c of rawCampaigns) {
            const siteCode = matchSiteCode(c.campaign, sites);
            const firstToken = c.campaign.split(/[\s_-]+/)[0] || "";
            const nameLower = String(c.campaign || "").toLowerCase();

            // 1. Cari kecocokan nama subdomain spesifik (contoh: "careers", "mod", "deals", "burrito")
            let matchedSub = null;
            if (dbSubdomains && dbSubdomains.length > 0) {
              const sorted = [...dbSubdomains].sort((a, b) => (b.name || "").length - (a.name || "").length);
              for (const sub of sorted) {
                if (!sub.name) continue;
                const subNameLower = sub.name.toLowerCase();
                const regex = new RegExp(`(^|[^a-z0-9])${subNameLower}([^a-z0-9]|$)`, "i");
                if (regex.test(nameLower)) {
                  matchedSub = sub;
                  break;
                }
              }
              // Jika tidak cocok kata spesifik, cari subdomain dengan site_code yang sama
              if (!matchedSub && siteCode && siteCode !== "unmapped") {
                const matchingBySite = dbSubdomains.filter((s) => s.site_code === siteCode);
                const suffix = siteCode.split("-").pop();
                matchedSub = matchingBySite.find((s) => s.name === suffix) || matchingBySite[0] || null;
              }
            }

            const picName = matchedSub?.pic || null;
            const subName = matchedSub?.name || siteCode || "";

            const enriched = {
              ...c,
              account: account.name || "Meta Ads",
              subDomain: subName,
              campaignCode: firstToken,
              subDomainSource: subName ? "otomatis" : "",
              pic: picName,
              owner: picName ? picName : "Belum ada PIC",
            };

            // 2. Hubungkan ke user profil advertiser yang sesuai
            let targetUserId = null;
            if (picName) {
              const matchedProf = (profilesList || []).find((p) => {
                const pName = (p.name || "").toLowerCase();
                const pEmail = (p.email || "").toLowerCase();
                const targetPic = picName.toLowerCase();
                return pName.includes(targetPic) || pEmail.includes(targetPic);
              });
              if (matchedProf) targetUserId = matchedProf.id;
            }

            // Jika campaign belum ada PIC-nya (atau PIC profil tidak ditemukan),
            // letakkan di profil Superadmin dengan penanda "Belum ada PIC"
            if (!targetUserId && superadminProfile) {
              targetUserId = superadminProfile.id;
            }

            if (targetUserId && userCampaignsMap.has(targetUserId)) {
              userCampaignsMap.get(targetUserId).push(enriched);
            }
          }

          // Simpan pembagian campaign ke database Supabase
          for (const [profId, camps] of userCampaignsMap.entries()) {
            await supabase
              .from("profiles")
              .update({
                campaigns: camps,
                updated_at: new Date().toISOString(),
              })
              .eq("id", profId);
          }
          console.log(`    ✅ Berhasil mendistribusikan ${rawCampaigns.length} campaign ke profil PIC masing-masing.`);
        } catch (campErr) {
          console.warn(`    ⚠️ Gagal memperbarui daftar campaign armada: ${campErr.message}`);
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
      subdomain: row.subdomain || "",
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
      console.log(`\nMelakukan upsert ${upsertRows.length} baris per subdomain ke tabel daily_stats...`);
      const { error: upsertError } = await supabase
        .from("daily_stats")
        .upsert(upsertRows, { onConflict: "date,site_code,subdomain,source" });

      if (upsertError) {
        throw new Error(`Gagal upsert ke daily_stats: ${upsertError.message}`);
      }
      totalSyncedRows = upsertRows.length;
      console.log(`✅ Berhasil upsert ${totalSyncedRows} baris daily_stats per subdomain.`);
    } else {
      console.log("ℹ️ Tidak ada data spend campaign baru untuk di-upsert.");
    }

    // 5b. Catat snapshot ROI realtime untuk jam sync ini
    try {
      await recordRoiSnapshot(supabase);
    } catch (snapErr) {
      console.warn(`⚠️ Gagal mencatat roi_snapshots: ${snapErr.message}`);
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

    console.log(
      `\n[${finishedAt}] Selesai. Status: ${status}, Baris Disinkronkan: ${totalSyncedRows}`,
    );

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
