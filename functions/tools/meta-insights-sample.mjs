// Uji coba baca data Insights Meta Marketing API (100% READ-ONLY).
// Mengambil data performa iklan 1 hari (spend, impresi, klik, CPC, CTR, dsb.) dari 1 ad account.
//
// Cara penggunaan:
//   cd functions
//   npm run meta:insights
//   npm run meta:insights act_1234567890
//   npm run meta:insights act_1234567890 yesterday

import { resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";

const VERSION = process.env.META_API_VERSION || "v25.0";
const BASE = `https://graph.facebook.com/${VERSION}`;

function loadEnvSync() {
  const envPath = resolve(process.cwd(), ".env.sync");
  if (!existsSync(envPath)) return {};
  const content = readFileSync(envPath, "utf-8");
  const env = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      env[key] = val;
    }
  }
  return env;
}

const fileEnv = loadEnvSync();
const token = process.env.META_ACCESS_TOKEN || fileEnv.META_ACCESS_TOKEN;

if (!token) {
  console.error("❌ Token META_ACCESS_TOKEN belum diatur!");
  console.error("   Isi META_ACCESS_TOKEN di functions/.env.sync atau jalankan dengan:");
  console.error("   $env:META_ACCESS_TOKEN=\"token_anda\"; npm run meta:insights");
  process.exit(1);
}

async function graph(path, params = {}) {
  const url = new URL(`${BASE}/${path}`);
  url.searchParams.set("access_token", token);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok || data.error) {
    const code = data.error?.code ? ` [Code: ${data.error.code}]` : "";
    const msg = data.error?.message || `HTTP ${res.status}`;
    throw new Error(`${path} -> ${msg}${code}`);
  }
  return data;
}

function normalizeActId(raw) {
  const str = String(raw || "").trim();
  return str.startsWith("act_") ? str : `act_${str}`;
}

function formatMoney(amount, currency = "IDR") {
  const num = Number(amount || 0);
  if (currency === "IDR") {
    return `Rp ${Math.round(num).toLocaleString("id-ID")}`;
  }
  return `${currency} ${num.toFixed(2)}`;
}

async function getAvailableAccounts() {
  const res = await graph("me/adaccounts", {
    fields: "account_id,name,currency,account_status",
    limit: "50",
  });
  return res.data || [];
}

async function main() {
  console.log("==================================================");
  console.log("   TIGERROI - META INSIGHTS SAMPLE (READ-ONLY)");
  console.log("==================================================\n");

  const args = process.argv.slice(2);
  let targetActId = args[0];
  const datePreset = args[1] || "today"; // "today", "yesterday", dsb.

  // Jika ACT ID tidak dioper via argumen, cari daftar ad account yang tersedia
  if (!targetActId) {
    console.log("🔍 Mencari ad account yang dapat diakses oleh token...");
    try {
      const accounts = await getAvailableAccounts();
      if (!accounts.length) {
        console.error("❌ Tidak ada ad account yang dapat diakses oleh token ini.");
        console.error("   Pastikan System User di Business Manager sudah diberi aset Ad Account.");
        process.exit(1);
      }
      targetActId = `act_${accounts[0].account_id}`;
      console.log(`ℹ️  Tidak ada ACT ID yang diberikan. Menggunakan akun pertama: ${accounts[0].name} (${targetActId})`);
      if (accounts.length > 1) {
        console.log(`   (Tersedia ${accounts.length} akun lain. Anda bisa menentukan akun spesifik: npm run meta:insights act_XXXXXXXX)`);
      }
    } catch (err) {
      console.error(`❌ Gagal mengambil daftar akun: ${err.message}`);
      process.exit(1);
    }
  } else {
    targetActId = normalizeActId(targetActId);
  }

  console.log(`\n⏳ Mengambil data untuk: ${targetActId} (Periode: ${datePreset})...\n`);

  // 1. Ambil detail akun
  let accountInfo;
  try {
    accountInfo = await graph(targetActId, {
      fields: "account_id,name,currency,account_status,balance,amount_spent,spend_cap",
    });
  } catch (err) {
    console.error(`❌ Gagal membaca detail akun ${targetActId}: ${err.message}`);
    process.exit(1);
  }

  const currency = accountInfo.currency || "IDR";
  const statusLabel =
    accountInfo.account_status === 1
      ? "Aktif (ACTIVE)"
      : accountInfo.account_status === 2
        ? "Dinonaktifkan (DISABLED)"
        : `Status: ${accountInfo.account_status}`;

  console.log("📋 INFORMASI AD ACCOUNT:");
  console.log(`   - Nama Akun   : ${accountInfo.name || "(tanpa nama)"}`);
  console.log(`   - Account ID  : act_${accountInfo.account_id}`);
  console.log(`   - Status Akun : ${statusLabel}`);
  console.log(`   - Mata Uang   : ${currency}`);

  // 2. Ambil Insights Akun 1 Hari
  let accountInsights = null;
  try {
    const res = await graph(`${targetActId}/insights`, {
      fields: "spend,impressions,clicks,cpc,cpm,ctr,actions,cost_per_action_type",
      date_preset: datePreset,
    });
    accountInsights = res.data?.[0] || null;
  } catch (err) {
    console.error(`❌ Gagal mengambil insights akun: ${err.message}`);
    process.exit(1);
  }

  console.log(`\n📊 RINGKASAN PERFORMA 1 HARI (${datePreset.toUpperCase()}):`);
  if (!accountInsights) {
    console.log(`   ⚠️  Tidak ada penayangan/spend pada periode "${datePreset}".`);
    console.log(`      (Tips: coba jalankan dengan 'yesterday' jika hari ini belum ada iklan tayang:`);
    console.log(`       npm run meta:insights ${targetActId} yesterday)`);
  } else {
    const spend = Number(accountInsights.spend || 0);
    const impressions = Number(accountInsights.impressions || 0);
    const clicks = Number(accountInsights.clicks || 0);
    const cpc = Number(accountInsights.cpc || 0);
    const cpm = Number(accountInsights.cpm || 0);
    const ctr = Number(accountInsights.ctr || 0);

    console.log(`   - Total Spend  : ${formatMoney(spend, currency)}`);
    console.log(`   - Impresi      : ${impressions.toLocaleString("id-ID")}`);
    console.log(`   - Klik         : ${clicks.toLocaleString("id-ID")}`);
    console.log(`   - CPC          : ${formatMoney(cpc, currency)}`);
    console.log(`   - CPM          : ${formatMoney(cpm, currency)}`);
    console.log(`   - CTR          : ${ctr.toFixed(2)}%`);

    // Konversi / Actions
    if (accountInsights.actions && accountInsights.actions.length > 0) {
      console.log("\n🎯 HASIL TINDAKAN / EVENT KONVERSI:");
      const primaryEvents = ["link_click", "landing_page_view", "onsite_conversion.post_save", "purchase", "lead"];
      for (const act of accountInsights.actions) {
        const val = Number(act.value || 0).toLocaleString("id-ID");
        const highlight = primaryEvents.includes(act.action_type) ? "⭐ " : "   ";
        console.log(`   ${highlight}${act.action_type.padEnd(30)}: ${val}`);
      }
    }
  }

  // 3. Ambil Rincian per Campaign
  console.log(`\n📑 RINCIAN PER CAMPAIGN (${datePreset.toUpperCase()}):`);
  try {
    const campRes = await graph(`${targetActId}/insights`, {
      level: "campaign",
      fields: "campaign_id,campaign_name,spend,impressions,clicks,cpc,ctr",
      date_preset: datePreset,
      limit: "25",
    });
    const campaigns = campRes.data || [];
    if (!campaigns.length) {
      console.log(`   (Tidak ada data campaign tayang pada periode ini)`);
    } else {
      console.log(
        `   ${"NAMA CAMPAIGN".padEnd(40)} | ${"SPEND".padEnd(15)} | ${"IMPRESI".padEnd(10)} | ${"KLIK".padEnd(8)} | ${"CPC".padEnd(10)} | CTR`,
      );
      console.log("   " + "-".repeat(95));
      for (const c of campaigns) {
        const name = (c.campaign_name || c.campaign_id || "").slice(0, 38).padEnd(40);
        const sp = formatMoney(c.spend, currency).padEnd(15);
        const imp = Number(c.impressions || 0).toLocaleString("id-ID").padEnd(10);
        const clk = Number(c.clicks || 0).toLocaleString("id-ID").padEnd(8);
        const cpcStr = formatMoney(c.cpc, currency).padEnd(10);
        const ctrStr = `${Number(c.ctr || 0).toFixed(2)}%`;
        console.log(`   ${name} | ${sp} | ${imp} | ${clk} | ${cpcStr} | ${ctrStr}`);
      }
    }
  } catch (err) {
    console.warn(`   ⚠️  Tidak dapat mengambil rincian level campaign: ${err.message}`);
  }

  console.log("\n==================================================");
  console.log("   PENGUJIAN READ-ONLY SELESAI");
  console.log("   (Tidak ada data yang diubah atau dikirim ke server)");
  console.log("==================================================\n");
}

main().catch((err) => {
  console.error("Terjadi error:", err);
  process.exit(1);
});
