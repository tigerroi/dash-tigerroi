import { useEffect, useState } from "react";
import { normalizeRole } from "../config/access";
import { supabase } from "../config/supabase";
import { flushActivity, logActivity } from "../lib/activityRecorder";
import { readRole } from "../lib/firebaseRepository";
import { notifyError, notifySuccess } from "../lib/notify";

export function useFirebaseAuth(navigate) {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    // Bersihkan sisa demo user dari penyimpanan lokal
    localStorage.removeItem("rabbitroi_demo_user");

    // Ambil sesi awal Supabase
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) {
        setUser(await mapSupabaseUser(session.user));
      } else {
        setUser(null);
      }
      setAuthLoading(false);
    });

    // Dengarkan perubahan status autentikasi Supabase
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        setUser(await mapSupabaseUser(session.user));
      } else {
        setUser(null);
      }
      setAuthLoading(false);
    });

    return () => {
      subscription?.unsubscribe();
    };
  }, []);

  const login = async (payload) => {
    setAuthLoading(true);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: payload.email,
        password: payload.password,
      });

      if (error) {
        throw error;
      }

      const loggedUser = data.user;
      logActivity({
        category: "auth",
        action: "login",
        actor: { uid: loggedUser.id, email: loggedUser.email },
      });
      notifySuccess("Login berhasil.");
      navigate("/dashboard");
    } catch (error) {
      logActivity({
        category: "auth",
        action: "login_failed",
        status: "failed",
        detail: { email: payload.email, sebab: error.code || error.message },
      });
      notifyError(error, "Login gagal. Periksa email dan password kamu lalu coba lagi.");
    } finally {
      setAuthLoading(false);
    }
  };

  const logout = async () => {
    try {
      logActivity({ category: "auth", action: "logout" });
      await flushActivity();

      localStorage.removeItem("rabbitroi_demo_user");
      setUser(null);
      await supabase.auth.signOut();
      notifySuccess("Logout berhasil.");
      navigate("/login");
    } catch (error) {
      localStorage.removeItem("rabbitroi_demo_user");
      setUser(null);
      notifySuccess("Logout berhasil.");
      navigate("/login");
    }
  };

  const changePassword = async ({ currentPassword, newPassword }) => {
    if (user?.isDemo) {
      notifySuccess("Mode Demo: Password berhasil disimulasikan.");
      return true;
    }

    try {
      // Re-autentikasi password saat ini terlebih dahulu untuk keamanan
      const {
        data: { user: currentUser },
      } = await supabase.auth.getUser();

      if (!currentUser?.email) {
        notifyError(new Error("Tidak ada sesi aktif."), "Sesi kamu sudah berakhir. Login ulang.");
        return false;
      }

      const { error: verifyError } = await supabase.auth.signInWithPassword({
        email: currentUser.email,
        password: currentPassword,
      });

      if (verifyError) {
        throw new Error("Password lama salah. Coba lagi.");
      }

      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (updateError) {
        throw updateError;
      }

      logActivity({ category: "auth", action: "password_changed" });
      notifySuccess("Password berhasil diubah.");
      return true;
    } catch (error) {
      logActivity({
        category: "auth",
        action: "password_changed",
        status: "failed",
        detail: { sebab: error.code || error.message },
      });
      notifyError(error, error.message || "Password gagal diubah. Coba lagi.");
      return false;
    }
  };

  return { user, login, logout, changePassword, authLoading };
}

async function mapSupabaseUser(supabaseUser) {
  // Ambil role dan nama dari profiles di Supabase
  let role = null;
  let profileName = null;
  try {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role, name")
      .eq("id", supabaseUser.id)
      .maybeSingle();

    if (profile) {
      role = profile.role;
      profileName = profile.name;
    } else {
      // Fallback jika profile belum dibuat trigger
      role = await readRole(supabaseUser.id).catch(() => null);
    }
  } catch {
    role = await readRole(supabaseUser.id).catch(() => null);
  }

  return {
    uid: supabaseUser.id,
    name: profileName || supabaseUser.user_metadata?.name || supabaseUser.email || "User",
    email: supabaseUser.email,
    role: normalizeRole(role),
  };
}
