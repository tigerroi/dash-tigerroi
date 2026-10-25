import { fetchAccountOverview, fetchCampaignInsights } from "./meta-client.js";

/**
 * Skrip Uji Coba Read-Only Meta Ads API
 * Menarik saldo dan insights 1 hari dari 1 ad account tanpa menulis ke database.
 *
 * Penggunaan:
 *   node jobs/test-meta-read.js [act_ID]
 * Atau setel variabel di .env:
 *   META_ACCESS_TOKEN=...
 *   META_ACCOUNT_ID=...
 */

async function main() {
  const token = process.env.META_ACCESS_TOKEN;
  const actId = process.argv[2] || process.env.META_ACCOUNT_ID;

  console.log("===============================================================");
  console.log("   TIGERROI - UJI BACA READ-ONLY META ADS INSIGHTS");
  console.log("===============================================================");

  if (!token) {
    console.error("❌ Token META_ACCESS_TOKEN belum diisi di environment (.env).");
    console.log("   Silakan isi META_ACCESS_TOKEN terlebih dahulu.");
    process.exit(1);
  }

  if (!actId) {
    console.error("❌ Akun iklan belum ditentukan.");
    console.log("   Gunakan argumen CLI: node jobs/test-meta-read.js act_123456789");
    console.log("   Atau isi META_ACCOUNT_ID di .env.");
    process.exit(1);
  }

  console.log(`Menguji Akun: ${actId}`);
  console.log("Status Token: Terdeteksi (Panjang:", token.length, "karakter)");
  console.log("---------------------------------------------------------------");

  try {
    // 1. Ambil ringkasan akun (Saldo, Limit, Mata Uang)
    console.log("\n1. Mengambil Informasi Akun & Saldo...");
    const overview = await fetchAccountOverview(actId, token);
    console.log(`   Nama Akun    : ${overview.name}`);
    console.log(`   Mata Uang    : ${overview.currency}`);
    console.log(`   Batas Spend  : ${overview.spendCap ? overview.spendCap.toLocaleString() : "Tidak ada batas"}`);
    console.log(`   Total Spent  : ${overview.amountSpent.toLocaleString()}`);
    console.log(`   Sisa Saldo   : ${overview.remainingBudget ? overview.remainingBudget.toLocaleString() : "-"}`);
    console.log(`   Tagihan Berjalan : ${overview.balance.toLocaleString()}`);

    // 2. Ambil insights 1 hari terakhir
    console.log("\n2. Mengambil Insights Harian Campaign (Hari Ini)...");
    const insights = await fetchCampaignInsights(actId, token);

    console.log(`   Ditemukan ${insights.length} campaign aktif hari ini:\n`);

    let totalSpend = 0;
    let totalClicks = 0;
    let totalImpr = 0;

    for (const item of insights) {
      console.log(`   - [${item.campaignId}] ${item.campaignName}`);
      console.log(`     Spend: ${overview.currency} ${item.spend.toLocaleString()} | Impresi: ${item.impressions} | Klik: ${item.clicks} | CPC: ${item.cpc}`);
      totalSpend += item.spend;
      totalClicks += item.clicks;
      totalImpr += item.impressions;
    }

    console.log("\n---------------------------------------------------------------");
    console.log("RINGKASAN TOTAL HARI INI:");
    console.log(`Total Spend      : ${overview.currency} ${totalSpend.toLocaleString()}`);
    console.log(`Total Impresi    : ${totalImpr.toLocaleString()}`);
    console.log(`Total Klik       : ${totalClicks.toLocaleString()}`);
    console.log(`Rata-rata CPC    : ${totalClicks > 0 ? (totalSpend / totalClicks).toFixed(2) : 0}`);
    console.log("===============================================================");
    console.log("✅ [PASS] Uji baca Meta Ads sukses tanpa error!");
  } catch (err) {
    console.error("\n❌ Gagal menarik data dari Meta API:", err.message);
    process.exit(1);
  }
}

main();
