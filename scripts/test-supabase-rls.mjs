import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// ==============================================================================
// Skrip Uji Keamanan Supabase Row Level Security (RLS) & Akses Service Role
// Memastikan:
// 1. Kunci anon / user biasa TIDAK BISA membaca tabel rahasia (google_api_configs, plugin_keys).
// 2. Kunci anon / user biasa TIDAK BISA menulis ke tabel yang dilindungi (domains).
// 3. Kunci service_role (backend VPS cron) BISA menulis dan membaca data.
// ==============================================================================

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const content = readFileSync(filePath, "utf-8");
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

const rootEnv = loadEnvFile(resolve(process.cwd(), ".env"));
const serverEnv = loadEnvFile(resolve(process.cwd(), "server", ".env"));

const SUPABASE_URL = 
  process.env.VITE_SUPABASE_URL || 
  process.env.SUPABASE_URL || 
  rootEnv.VITE_SUPABASE_URL || 
  serverEnv.SUPABASE_URL;

const ANON_KEY = 
  process.env.VITE_SUPABASE_ANON_KEY || 
  process.env.SUPABASE_ANON_KEY || 
  rootEnv.VITE_SUPABASE_ANON_KEY || 
  serverEnv.VITE_SUPABASE_ANON_KEY;

const SERVICE_ROLE_KEY = 
  process.env.SUPABASE_SERVICE_ROLE_KEY || 
  serverEnv.SUPABASE_SERVICE_ROLE_KEY || 
  rootEnv.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
  console.error("❌ Kredensial Supabase belum lengkap di .env atau server/.env!");
  console.error("   Pastikan variabel berikut terisi:");
  console.error("   - SUPABASE_URL / VITE_SUPABASE_URL");
  console.error("   - VITE_SUPABASE_ANON_KEY");
  console.error("   - SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

// Normalisasi base URL API REST
const REST_URL = `${SUPABASE_URL.replace(/\/+$/, "").replace(/\/rest\/v1$/, "")}/rest/v1`;

async function testFetch(path, { method = "GET", key, body = null } = {}) {
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Prefer: method === "POST" ? "return=representation" : undefined,
  };
  const res = await fetch(`${REST_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, ok: res.ok, data };
}

async function runTests() {
  console.log("===============================================================");
  console.log("   TIGERROI - UJI VALIDASI RLS & SERVICE ROLE SUPABASE");
  console.log("===============================================================");
  console.log(`Endpoint REST: ${REST_URL}\n`);

  let passedCount = 0;
  let totalCount = 0;

  function assertTest(name, condition, detail = "") {
    totalCount++;
    if (condition) {
      console.log(`  ✅ [PASS] ${name}`);
      passedCount++;
    } else {
      console.error(`  ❌ [FAIL] ${name}`);
      if (detail) console.error(`     Detail: ${detail}`);
    }
  }

  // --- UJI 1: Service Role Menulis ke Tabel sync_runs ---
  console.log("1. Menguji Kuasa Tulis Kunci service_role (Backend Cron)...");
  const testJob = {
    job_name: "test-rls-liveness",
    status: "success",
    rows_synced: 1,
    details: { tester: "tigerroi-audit-script" },
  };
  const writeRes = await testFetch("/sync_runs", {
    method: "POST",
    key: SERVICE_ROLE_KEY,
    body: testJob,
  });
  assertTest(
    "Job service_role berhasil menulis baris ke sync_runs",
    writeRes.ok && Array.isArray(writeRes.data) && writeRes.data.length > 0,
    JSON.stringify(writeRes.data),
  );
  const insertedId = writeRes.data?.[0]?.id;

  // --- UJI 2: Proteksi Tabel Sangat Rahasia (google_api_configs) ---
  console.log("\n2. Menguji Pembatasan Kunci Publik (Anon) pada Tabel Rahasia...");
  const googleConfigAnon = await testFetch("/google_api_configs?select=*", {
    method: "GET",
    key: ANON_KEY,
  });
  assertTest(
    "User biasa/anon TIDAK BISA membaca isi google_api_configs (RLS memblokir)",
    Array.isArray(googleConfigAnon.data) && googleConfigAnon.data.length === 0,
    `Mengembalikan ${JSON.stringify(googleConfigAnon.data)}`,
  );

  // --- UJI 3: Proteksi Kunci REST Armada (plugin_keys) ---
  console.log("\n3. Menguji Pembatasan Kunci REST WordPress (plugin_keys)...");
  const pluginKeysAnon = await testFetch("/plugin_keys?select=*", {
    method: "GET",
    key: ANON_KEY,
  });
  assertTest(
    "User biasa/anon TIDAK BISA membaca kunci plugin_keys",
    Array.isArray(pluginKeysAnon.data) && pluginKeysAnon.data.length === 0,
    `Mengembalikan ${JSON.stringify(pluginKeysAnon.data)}`,
  );

  // --- UJI 4: Proteksi Hak Tulis (Write Access) untuk Anon ---
  console.log("\n4. Menguji Proteksi Hak Tulis User Biasa/Anon...");
  const illegalWrite = await testFetch("/domains", {
    method: "POST",
    key: ANON_KEY,
    body: { domain_url: "hacker-test-site.com" },
  });
  assertTest(
    "User biasa/anon DITOLAK saat mencoba insert data ke tabel domains",
    !illegalWrite.ok || illegalWrite.status === 401 || illegalWrite.status === 403 || illegalWrite.data?.code === "42501",
    `Status HTTP: ${illegalWrite.status}, Pesan: ${JSON.stringify(illegalWrite.data)}`,
  );

  // --- BERSIHKAN DATA UJI ---
  if (insertedId) {
    await testFetch(`/sync_runs?id=eq.${insertedId}`, {
      method: "DELETE",
      key: SERVICE_ROLE_KEY,
    });
  }

  console.log("\n===============================================================");
  console.log(`Hasil Pengujian: ${passedCount} / ${totalCount} Berhasil.`);
  if (passedCount === totalCount) {
    console.log("🎉 SELURUH ATURAN KEAMANAN RLS DAN SERVICE ROLE VALID & SESUAI!");
  } else {
    console.log("⚠️ ADA ATURAN YANG BELUM SESUAI, PERIKSA SQL MIGRATION.");
  }
  console.log("===============================================================\n");
}

runTests().catch((err) => {
  console.error("Terjadi error saat menjalankan uji:", err);
  process.exit(1);
});
