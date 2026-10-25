import { createRemoteJWKSet, jwtVerify } from "jose";
import { createClient } from "@supabase/supabase-js";
import { isAdmin, isSuperAdmin, roleOf } from "../functions/roles.mjs";

/**
 * Autentikasi dan otorisasi server TigerROI menggunakan Supabase JWT.
 *
 * Frontend mengirim Supabase access token (JWT) di header Authorization: Bearer <token>.
 * Server memverifikasi signature token menggunakan JWKS Supabase (ES256) atau Supabase Auth Admin API.
 */

const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const JWK_URL =
  process.env.SUPABASE_JWK_URL ||
  (SUPABASE_URL ? `${SUPABASE_URL}/auth/v1/.well-known/jwks.json` : "");

const ISSUER =
  process.env.SUPABASE_JWT_ISSUER ||
  (SUPABASE_URL ? `${SUPABASE_URL}/auth/v1` : "");

// Remote JWKS set yang di-cache otomatis oleh jose
let jwks = null;
if (JWK_URL) {
  try {
    jwks = createRemoteJWKSet(new URL(JWK_URL));
  } catch {
    jwks = null;
  }
}

// Supabase client instance di server untuk verifikasi fallback & database query
let supabaseAdmin = null;
if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
  supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const TOKEN_ERRORS = new Set([
  "ERR_JWS_SIGNATURE_VERIFICATION_FAILED",
  "ERR_JWT_CLAIM_VALIDATION_FAILED",
  "ERR_JWS_INVALID",
  "ERR_JWT_INVALID",
  "ERR_JOSE_ALG_NOT_ALLOWED",
  "ERR_JWKS_NO_MATCHING_KEY",
  "ERR_JWKS_MULTIPLE_MATCHING_KEYS",
]);

export class AuthError extends Error {
  constructor(message, status = 401) {
    super(message);
    this.status = status;
  }
}

/**
 * Memverifikasi Supabase JWT token dan mengembalikan identitas user { uid, email }.
 */
export async function verifyIdToken(token) {
  if (!token) throw new AuthError("Token tidak dikirim.");

  // 1. Coba verifikasi kriptografis lokal via JWKS (ES256)
  if (jwks) {
    try {
      const verifyOptions = {
        algorithms: ["ES256"],
      };
      if (ISSUER) {
        verifyOptions.issuer = ISSUER;
      }

      const { payload } = await jwtVerify(token, jwks, verifyOptions);
      if (!payload.sub) throw new AuthError("Token tidak membawa uid.");
      return { uid: payload.sub, email: String(payload.email || "") };
    } catch (error) {
      if (error?.code === "ERR_JWT_EXPIRED") {
        throw new AuthError("Token sudah kedaluwarsa — ambil token baru lalu coba lagi.");
      }

      // Jika error terkait algoritma atau key mismatch, coba fallback ke getUser
      if (!TOKEN_ERRORS.has(error?.code)) {
        // Jaringan JWKS putus atau masalah tak terduga, lempar jika tidak ada supabaseAdmin
        if (!supabaseAdmin) throw error;
      }
    }
  }

  // 2. Fallback: Verifikasi langsung via Supabase Auth API
  if (supabaseAdmin) {
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !user) {
      throw new AuthError(error?.message || "Token tidak sah.");
    }
    return { uid: user.id, email: String(user.email || "") };
  }

  throw new AuthError("Konfigurasi verifikasi autentikasi server belum tersedia.");
}

/**
 * Token → identitas superadmin, atau lempar AuthError (403).
 */
export async function requireSuperAdmin(db, token) {
  const actor = await verifyIdToken(token);
  const targetDb = db || supabaseAdmin;
  const role = await roleOf(targetDb, actor.uid);
  if (!isSuperAdmin(role)) {
    throw new AuthError("Hanya superadmin yang boleh mengakses fitur ini.", 403);
  }
  return { ...actor, role };
}

/**
 * Token → identitas admin / superadmin, atau lempar AuthError (403).
 */
export async function requireAdmin(db, token) {
  const actor = await verifyIdToken(token);
  const targetDb = db || supabaseAdmin;
  const role = await roleOf(targetDb, actor.uid);
  if (!isAdmin(role)) {
    throw new AuthError("Hanya admin yang boleh melakukan aksi ini.", 403);
  }
  return { ...actor, role };
}

/**
 * Token → identitas user aktif beserta role-nya.
 */
export async function requireUser(db, token) {
  const actor = await verifyIdToken(token);
  const targetDb = db || supabaseAdmin;
  return { ...actor, role: String((await roleOf(targetDb, actor.uid)) || "") };
}

/**
 * Memeriksa izin toggle campaign
 */
export function mayToggleCampaign(actor, user) {
  if (isAdmin(actor?.role)) return true;
  const owner = String(user?.email || "").trim().toLowerCase();
  const viewer = String(actor?.email || "").trim().toLowerCase();
  return Boolean(owner) && owner === viewer;
}

/**
 * Mengekstrak token dari header Authorization: Bearer <token>
 */
export function bearerToken(header) {
  const match = /^bearer\s+(.+)$/i.exec(String(header || "").trim());
  return match ? match[1].trim() : "";
}
