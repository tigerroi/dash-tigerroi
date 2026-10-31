import { createClient } from "@supabase/supabase-js";

// Konfigurasi Klien Supabase untuk Frontend (Vite + React)
// Sesuai aturan keamanan: HANYA menggunakan anon / public key di browser!

const supabaseUrl =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_SUPABASE_URL) ||
  (typeof process !== "undefined" && (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL)) ||
  "https://dummy.supabase.co";

const supabaseAnonKey =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_SUPABASE_ANON_KEY) ||
  (typeof process !== "undefined" && (process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY)) ||
  "dummy-key";

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
