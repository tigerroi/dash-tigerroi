import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function loadEnv() {
  const envPaths = [resolve(".env"), resolve("server/.env"), resolve("jobs/.env")];
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
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("❌ SUPABASE_URL atau SUPABASE_SERVICE_ROLE_KEY tidak ditemukan di environment.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function resetPassword() {
  const email = process.argv[2] || "zulfan@tigerroi.com";
  const newPassword = process.argv[3];

  if (!newPassword) {
    console.log("Cara pakai: node scripts/reset-user-password.js <email> <password_baru>");
    process.exit(1);
  }

  console.log(`Mencari akun ${email} di Supabase Auth...`);
  const { data, error } = await supabase.auth.admin.listUsers();

  if (error) {
    console.error("❌ Gagal mengambil daftar user:", error.message);
    process.exit(1);
  }

  const targetUser = data.users.find(
    (u) => String(u.email).toLowerCase() === email.toLowerCase(),
  );

  if (!targetUser) {
    console.error(`❌ User dengan email ${email} tidak ditemukan di Supabase Auth.`);
    process.exit(1);
  }

  const { error: updateError } = await supabase.auth.admin.updateUserById(targetUser.id, {
    password: newPassword,
  });

  if (updateError) {
    console.error("❌ Gagal mereset password:", updateError.message);
    process.exit(1);
  }

  console.log(`✅ Berhasil! Password untuk ${email} (UID: ${targetUser.id}) telah berhasil diubah.`);
}

resetPassword();

