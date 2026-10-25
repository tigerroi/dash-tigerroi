import { createClient } from "@supabase/supabase-js";

/**
 * Koneksi backend ke basis data Supabase (PostgreSQL).
 * Menggunakan SUPABASE_SERVICE_ROLE_KEY untuk operasi server dan sinkronisasi cron Hetzner.
 */
export async function connect() {
  const supabaseUrl = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "";

  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      "Konfigurasi Supabase backend belum lengkap. Setel SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY di .env.",
    );
  }

  const client = createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return client;
}
