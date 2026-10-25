import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { verifyIdToken } from "../server/auth.js";

// Muat variabel environment dari .env atau server/.env
function loadEnv() {
  const envPaths = [resolve(".env"), resolve("server/.env")];
  for (const envPath of envPaths) {
    if (existsSync(envPath)) {
      const content = readFileSync(envPath, "utf-8");
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx !== -1) {
          const key = trimmed.slice(0, eqIdx).trim();
          const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
          if (!process.env[key]) {
            process.env[key] = val;
          }
        }
      }
    }
  }
}

loadEnv();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log("===============================================================");
console.log("   TIGERROI - UJI KONEKSI, AUTH & CRUD SUPABASE");
console.log("===============================================================");
console.log("URL Proyek:", SUPABASE_URL || "(kosong)");

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error("❌ Variabel SUPABASE_URL dan VITE_SUPABASE_ANON_KEY wajib ada di .env");
  process.exit(1);
}

const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let adminClient = null;
if (SUPABASE_SERVICE_KEY) {
  adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function runTests() {
  let passed = 0;
  let total = 0;

  // 1. Uji Operasi Baca Publik / RLS Terbuka (domains)
  total++;
  console.log("\n1. Menguji Operasi Baca Dasar (Anon Client) pada Tabel domains...");
  try {
    const { data, error } = await anonClient.from("domains").select("id, domain_url, status").limit(5);
    if (error) {
      console.log(`  ❌ Gagal membaca domains: ${error.message}`);
    } else {
      console.log(`  ✅ [PASS] Berhasil membaca data domains (Jumlah baris: ${data?.length || 0})`);
      passed++;
    }
  } catch (err) {
    console.log(`  ❌ Error: ${err.message}`);
  }

  // 2. Uji Operasi Tulis & Baca Dasar (Service Role)
  total++;
  console.log("\n2. Menguji Operasi Tulis & Baca Dasar (Service Role Client)...");
  if (!adminClient) {
    console.log("  ⚠️ Kunci SUPABASE_SERVICE_ROLE_KEY tidak ditemukan, pengujian dilewati.");
  } else {
    try {
      const testJobName = `test_crud_${Date.now()}`;
      // INSERT
      const { data: inserted, error: insertError } = await adminClient
        .from("sync_runs")
        .insert({
          job_name: testJobName,
          status: "success",
          rows_synced: 10,
          details: { note: "Uji baca/tulis dasar TigerROI" },
        })
        .select()
        .single();

      if (insertError) {
        console.log(`  ❌ Gagal INSERT ke sync_runs: ${insertError.message}`);
      } else {
        // SELECT & VERIFY
        const { data: fetched, error: fetchError } = await adminClient
          .from("sync_runs")
          .select("*")
          .eq("id", inserted.id)
          .single();

        if (fetchError || !fetched) {
          console.log(`  ❌ Gagal membaca kembali data yang baru ditulis: ${fetchError?.message}`);
        } else {
          // CLEANUP
          await adminClient.from("sync_runs").delete().eq("id", inserted.id);
          console.log(`  ✅ [PASS] Berhasil INSERT, SELECT, dan DELETE data di tabel sync_runs`);
          passed++;
        }
      }
    } catch (err) {
      console.log(`  ❌ Error: ${err.message}`);
    }
  }

  // 3. Uji Autentikasi Login Pengguna (Email & Password)
  total++;
  console.log("\n3. Menguji Alur Autentikasi Supabase Auth...");
  const testEmail = process.env.TEST_USER_EMAIL || process.env.SYNC_USER_EMAIL;
  const testPassword = process.env.TEST_USER_PASSWORD || process.env.SYNC_USER_PASSWORD;

  if (!testEmail || !testPassword) {
    console.log("  ℹ️ Tip: Tambahkan TEST_USER_EMAIL dan TEST_USER_PASSWORD di .env untuk menguji login akun live.");
    console.log("  ℹ️ Mencoba menguji handshake koneksi auth server Supabase...");
    try {
      const { error } = await anonClient.auth.signInWithPassword({
        email: "test_probe@example.com",
        password: "invalid_password_for_probe",
      });
      // Response "Invalid login credentials" membuktikan server Auth hidup dan merespons dengan benar
      if (error && (error.status === 400 || error.message.toLowerCase().includes("invalid"))) {
        console.log(`  ✅ [PASS] Endpoint Supabase Auth aktif dan merespons dengan benar (${error.message})`);
        passed++;
      } else {
        console.log(`  ⚠️ Respons Auth: ${error?.message || "OK"}`);
      }
    } catch (err) {
      console.log(`  ❌ Error: ${err.message}`);
    }
  } else {
    try {
      const { data, error } = await anonClient.auth.signInWithPassword({
        email: testEmail,
        password: testPassword,
      });

      if (error) {
        console.log(`  ❌ Gagal login akun ${testEmail}: ${error.message}`);
      } else {
        console.log(`  ✅ [PASS] Berhasil login sebagai user: ${data.user.email} (ID: ${data.user.id})`);
        
        // Uji verifikasi token JWT di middleware server
        const token = data.session.access_token;
        const verified = await verifyIdToken(token);
        console.log(`  ✅ [PASS] Verifikasi JWT server/auth.js berhasil untuk UID: ${verified.uid}`);
        passed++;
      }
    } catch (err) {
      console.log(`  ❌ Error: ${err.message}`);
    }
  }

  // 4. Uji View Laporan ROI (view_daily_roi)
  total++;
  console.log("\n4. Menguji View Perhitungan ROI (view_daily_roi)...");
  try {
    const { data, error } = await anonClient.from("view_daily_roi").select("*").limit(5);
    if (error) {
      console.log(`  ❌ Gagal query view_daily_roi: ${error.message}`);
    } else {
      console.log(`  ✅ [PASS] Berhasil query view_daily_roi (Jumlah baris: ${data?.length || 0})`);
      passed++;
    }
  } catch (err) {
    console.log(`  ❌ Error: ${err.message}`);
  }

  console.log("\n===============================================================");
  console.log(`Hasil Pengujian: ${passed} / ${total} Berhasil`);
  console.log("===============================================================\n");
}

runTests();
