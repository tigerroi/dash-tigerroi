/**
 * Membaca role pengguna dari Supabase profiles.
 * Kompatibel dengan Supabase client dan fallback.
 */
export async function roleOf(db, uid) {
  if (!uid) return null;

  // Jika db adalah instance Supabase Client
  if (db && typeof db.from === "function") {
    const { data, error } = await db.from("profiles").select("role").eq("id", uid).maybeSingle();

    if (error || !data) return null;
    return data.role;
  }

  // Fallback jika snapshot RTDB lama dioper
  try {
    if (typeof db?.ref === "function" || typeof db?.get === "function") {
      const { get, ref } = await import("firebase/database");
      const snapshot = await get(ref(db, `roles/${uid}`));
      return snapshot.val();
    }
  } catch {
    // Abaikan jika SDK firebase sudah dicopot
  }

  return null;
}

export function parseRoles(role) {
  return String(role || "")
    .toLowerCase()
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
}

export function hasRole(role, target) {
  return parseRoles(role).includes(target);
}

const ADMIN_ROLES = ["superadmin", "admin"];

export function isAdmin(role) {
  return ADMIN_ROLES.some((admin) => hasRole(role, admin));
}

export function isSuperAdmin(role) {
  return hasRole(role, "superadmin");
}
