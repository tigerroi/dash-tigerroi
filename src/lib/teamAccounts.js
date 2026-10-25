import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Membuat akun tim baru menggunakan instance klien Supabase terpisah tanpa penyimpanan sesi (persistSession: false),
// sehingga tidak menimpa/mengganti sesi login admin yang sedang aktif di browser.
export async function createTeamAccount(email, password, metadata = {}) {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Konfigurasi Supabase frontend belum lengkap di environment.");
  }

  const secondaryClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const { data, error } = await secondaryClient.auth.signUp({
    email,
    password,
    options: {
      data: {
        name: metadata.name || email.split("@")[0],
        username: metadata.username || null,
        role: metadata.role || "user",
      },
    },
  });

  if (error) {
    throw error;
  }

  return data.user?.id;
}
