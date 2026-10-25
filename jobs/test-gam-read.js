import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { getGoogleServiceAccountToken, getGamNetwork, fetchGamDailyRevenue } from "./gam-client.js";

/**
 * Skrip Uji Coba Read-Only Google Ad Manager API
 * Menguji koneksi Service Account dan menarik info network GAM.
 *
 * Penggunaan:
 *   node jobs/test-gam-read.js <path-ke-file.json> <network-code>
 * Contoh:
 *   node jobs/test-gam-read.js ./service-account.json 23344333667
 */

async function main() {
  const jsonArg = process.argv[2] || process.env.GAM_KEY_FILE || "./service-account.json";
  const networkCode = process.argv[3] || process.env.GAM_NETWORK_CODE || "23344333667"; // default Trayedit

  console.log("===============================================================");
  console.log("   TIGERROI - UJI KONEKSI GOOGLE AD MANAGER API");
  console.log("===============================================================");

  let clientEmail = process.env.GAM_CLIENT_EMAIL;
  let privateKey = process.env.GAM_PRIVATE_KEY;

  if ((!clientEmail || !privateKey) && existsSync(resolve(jsonArg))) {
    try {
      const content = JSON.parse(readFileSync(resolve(jsonArg), "utf-8"));
      clientEmail = content.client_email;
      privateKey = content.private_key;
      console.log(`Memuat kredensial dari file JSON: ${jsonArg}`);
    } catch (e) {
      console.error(`❌ Gagal membaca file JSON ${jsonArg}: ${e.message}`);
    }
  }

  if (!clientEmail || !privateKey) {
    console.error("❌ Kredensial Service Account belum ditemukan.");
    console.log("   Gunakan: node jobs/test-gam-read.js <lokasi-file.json> <network-code>");
    console.log("   Contoh:  node jobs/test-gam-read.js ./gam-key.json 23344333667");
    process.exit(1);
  }

  console.log(`Target Network Code : ${networkCode}`);
  console.log(`Service Account     : ${clientEmail}`);
  console.log("---------------------------------------------------------------");

  try {
    // 1. Dapatkan Access Token OAuth2 Google
    console.log("\n1. Mengautentikasi ke Google OAuth2...");
    const accessToken = await getGoogleServiceAccountToken({ clientEmail, privateKey });
    console.log("   ✅ Berhasil mendapatkan Google OAuth2 Access Token!");

    // 2. Ambil Info Jaringan (Network)
    console.log(`\n2. Menghubungi Google Ad Manager Network [${networkCode}]...`);
    const networkInfo = await getGamNetwork(networkCode, accessToken);
    console.log(`   Nama Jaringan GAM: ${networkInfo.displayName}`);
    console.log(`   Mata Uang Akun   : ${networkInfo.currencyCode}`);
    console.log(`   Zona Waktu       : ${networkInfo.timeZone}`);
    console.log("   ✅ [PASS] Akses API Service Account Terverifikasi!");

    // 3. Uji coba pembuatan laporan hari ini / kemarin
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    console.log(`\n3. Menguji Penarikan Data Laporan Pendapatan (${yesterday} s/d ${today})...`);
    const rows = await fetchGamDailyRevenue(networkCode, accessToken, {
      startDate: yesterday,
      endDate: today,
    });

    console.log(`   Berhasil menarik ${rows.length} baris unit iklan GAM:`);
    let totalAdx = 0;
    let totalAdSense = 0;
    for (const r of rows.slice(0, 5)) {
      console.log(`   - [${r.date}] ${r.adUnitName}: AdX = ${networkInfo.currencyCode} ${r.adxRevenue} | AdSense = ${networkInfo.currencyCode} ${r.adsenseRevenue} | Impresi: ${r.impressions}`);
      totalAdx += r.adxRevenue;
      totalAdSense += r.adsenseRevenue;
    }

    if (rows.length > 5) {
      console.log(`   ... dan ${rows.length - 5} baris lainnya.`);
    }

    console.log("\n===============================================================");
    console.log(`✅ [PASS] UJI KONEKSI GOOGLE AD MANAGER SUKSES 100%!`);
    console.log("===============================================================\n");
  } catch (err) {
    console.error("\n❌ Uji koneksi GAM Gagal:", err.message);
    process.exit(1);
  }
}

main();
