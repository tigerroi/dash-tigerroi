import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { getGoogleServiceAccountToken } from "./gam-client.js";
import { evaluateGamPolicyStatus } from "./gam-policy-helper.js";

/**
 * Job Sinkronisasi Status Kebijakan & Pembatasan Iklan GAM (Policy Center & Limits)
 * Dijalankan mandiri setiap 30 menit via GitHub Actions atau scheduler.
 * Memeriksa status 9 network GAM:
 * - ihopmenuwithprices.us (23340206616)
 * - tacobellmenuu.us (23380486168)
 * - tiktokmodapk.net (23367555867)
 * - trayedit.com (23344333667)
 * - cmhhealths.com (23350466753)
 * - uniqueinfo24.com (23342288590)
 * - ziperto.org (23355757170)
 * - workmoney24.com (23342288461)
 * - velocitytv.com.pk (23360577147)
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

const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌ SUPABASE_URL dan SUPABASE_KEY wajib diisi.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Daftar Network GAM resmi TigerROI
const GAM_NETWORKS = [
  { domain: "ihopmenuwithprices.us", networkCode: "23340206616" },
  { domain: "tacobellmenuu.us", networkCode: "23380486168" },
  { domain: "tiktokmodapk.net", networkCode: "23367555867" },
  { domain: "trayedit.com", networkCode: "23344333667" },
  { domain: "cmhhealths.com", networkCode: "23350466753" },
  { domain: "uniqueinfo24.com", networkCode: "23342288590" },
  { domain: "ziperto.org", networkCode: "23355757170" },
  { domain: "workmoney24.com", networkCode: "23342288461" },
  { domain: "velocitytv.com.pk", networkCode: "23360577147" },
  { domain: "foodsfact.org", networkCode: "21869641910" },
];

function loadServiceAccountCredentials() {
  const clientEmail = process.env.GAM_CLIENT_EMAIL;
  const privateKey = process.env.GAM_PRIVATE_KEY;

  if (clientEmail && privateKey) {
    return { clientEmail, privateKey };
  }

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
        // continue
      }
    }
  }

  return null;
}

export async function runSyncGamPolicy() {
  const startedAt = new Date().toISOString();
  console.log(`[${startedAt}] Memulai Sinkronisasi Status Kebijakan & Limit Google Ad Manager (30 Menitan)...`);

  let runId = null;

  try {
    // 1. Keep-alive Supabase
    await supabase.from("sync_runs").select("*", { count: "exact", head: true });

    const { data: runRecord } = await supabase
      .from("sync_runs")
      .insert({
        job_name: "sync-gam-policy",
        status: "running",
        started_at: startedAt,
      })
      .select("id")
      .single();

    if (runRecord) runId = runRecord.id;

    // 2. Kredensial Service Account
    const creds = loadServiceAccountCredentials();
    if (!creds) {
      throw new Error(
        "Kredensial Service Account GAM belum ditemukan di GAM_CLIENT_EMAIL / GAM_PRIVATE_KEY atau file service-account.json",
      );
    }

    console.log(`Mengautentikasi Service Account: ${creds.clientEmail}...`);
    const accessToken = await getGoogleServiceAccountToken(creds);

    // 3. Ambil akun GAM dari database
    const { data: gamAccountsList } = await supabase
      .from("gam_accounts")
      .select("id, name, network_code, status, status_auto, status_detail");

    const existingAccounts = gamAccountsList || [];
    const activeNetworks = [];
    const seenCodes = new Set();

    for (const acc of existingAccounts) {
      if (!acc.network_code) continue;
      const code = String(acc.network_code).trim();
      seenCodes.add(code);
      activeNetworks.push({
        id: acc.id,
        domain: acc.name || "unknown",
        networkCode: code,
        currentStatus: acc.status,
        currentStatusAuto: acc.status_auto,
        currentStatusDetail: acc.status_detail,
      });
    }

    for (const net of GAM_NETWORKS) {
      if (!seenCodes.has(net.networkCode)) {
        activeNetworks.push({
          id: null,
          domain: net.domain,
          networkCode: net.networkCode,
          currentStatus: "Ready",
          currentStatusAuto: "Ready",
          currentStatusDetail: null,
        });
        seenCodes.add(net.networkCode);
      }
    }

    console.log(`Total akun GAM yang diperiksa: ${activeNetworks.length} network.\n`);

    const updateResults = [];

    // 4. Evaluasi kebijakan per network
    for (const net of activeNetworks) {
      console.log(`--> Memeriksa status Pusat Kebijakan: ${net.domain} (${net.networkCode})...`);
      const policyResult = await evaluateGamPolicyStatus(net.networkCode, accessToken, net.domain);

      console.log(`    Status: ${policyResult.status} | Sumber: ${policyResult.source}`);
      console.log(`    Detail: ${policyResult.detail}`);

      const shouldSyncStatus =
        !net.currentStatus ||
        net.currentStatus === net.currentStatusAuto ||
        policyResult.status === "Limit Iklan" ||
        net.currentStatus === "Ready";

      const newStatus = shouldSyncStatus ? policyResult.status : net.currentStatus;

      const updatePayload = {
        status: newStatus,
        status_auto: policyResult.status,
        status_detail: policyResult.detail,
        updated_at: new Date().toISOString(),
      };

      const { data: updated, error: updateErr } = await supabase
        .from("gam_accounts")
        .update(updatePayload)
        .eq("network_code", net.networkCode)
        .select("id");

      if (updateErr || !updated || updated.length === 0) {
        // Fallback update by name
        const { data: nameUpdated } = await supabase
          .from("gam_accounts")
          .update(updatePayload)
          .eq("name", net.domain)
          .select("id");

        if (!nameUpdated || nameUpdated.length === 0) {
          // Insert jika belum ada
          await supabase.from("gam_accounts").insert({
            name: net.domain,
            network_code: net.networkCode,
            ...updatePayload,
          });
        }
      }

      updateResults.push({
        domain: net.domain,
        networkCode: net.networkCode,
        status: newStatus,
        statusAuto: policyResult.status,
        detail: policyResult.detail,
      });
    }

    const completedAt = new Date().toISOString();
    if (runId) {
      await supabase
        .from("sync_runs")
        .update({
          status: "completed",
          completed_at: completedAt,
          records_synced: updateResults.length,
          metadata: { results: updateResults },
        })
        .eq("id", runId);
    }

    console.log(`\n✅ [${completedAt}] Sinkronisasi Status Kebijakan GAM Selesai! (${updateResults.length} akun diperbarui)`);
    return { success: true, count: updateResults.length, results: updateResults };
  } catch (err) {
    console.error(`\n❌ [${new Date().toISOString()}] Sinkronisasi Status Kebijakan GAM Gagal:`, err.message);

    if (runId) {
      await supabase
        .from("sync_runs")
        .update({
          status: "failed",
          completed_at: new Date().toISOString(),
          error_message: err.message,
        })
        .eq("id", runId)
        .catch(() => {});
    }

    throw err;
  }
}

// Jalankan langsung jika dipanggil via node
if (process.argv[1] && process.argv[1].endsWith("sync-gam-policy.js")) {
  runSyncGamPolicy()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
