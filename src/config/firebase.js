import { supabase } from "./supabase";

// Re-ekspor klien Supabase untuk menggantikan Firebase
export { supabase };

// Stub transisi sementara untuk modul yang sedang dimigrasi
export const auth = {
  get currentUser() {
    return null;
  },
  onAuthStateChanged: () => () => {},
};

export const database = null;
export const functions = null;
export const app = null;
export const firebaseConfig = {};
