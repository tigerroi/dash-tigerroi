import { SCOPES } from "./google-oauth-core.js";

// OAuth2 for the Ad Manager API. clientId/clientSecret/refreshToken come from a
// googleApiConfigs record (or the GAM_* env defaults). See tools/authorize.mjs for the
// one-time consent that produces the refresh token — atau tombol Login di /google-api-configs,
// yang menjalankan consent yang sama lewat server kontrol (server/google-auth.js).

/**
 * Scope yang diminta saat consent — definisinya di `google-oauth-core.js`, di-ekspor ulang dari
 * sini supaya pemanggilnya (functions/index.js, tools/authorize.mjs) cukup mengimpor satu modul.
 *
 * Pindah ke sana karena yang MEMERIKSA scope mana yang benar-benar diberikan Google tinggal di file
 * itu, dan daftar yang diminta harus tidak pernah bisa bergeser dari daftar yang diperiksa.
 */
export { SCOPES };

export const REDIRECT = process.env.OAUTH_REDIRECT || "http://localhost:4571/callback";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";

/**
 * URL consent Google. Dipakai CLI (`tools/authorize.mjs`, redirect localhost, tanpa `state`) DAN
 * server kontrol (redirect publik, `state` sekali pakai) — yang berbeda cuma dua argumen terakhir.
 *
 * Disusun sendiri dengan `URLSearchParams`, bukan lewat `OAuth2Client.generateAuthUrl`: yang dibuat
 * library itu cuma URL ini, dan library-nya rusak di Node 24 (lihat `accessTokenFrom`).
 *
 * `access_type=offline` + `prompt=consent` memaksa Google mengembalikan refresh token.
 * `select_account` ikut diminta karena "consent" saja TIDAK menawarkan pemilihan akun: browser yang
 * sudah login satu akun Google akan memakainya diam-diam, dan kredensial untuk network baru tersimpan
 * atas nama akun lama — tokennya sah, sync-nya jalan, dan network yang dicari tidak pernah muncul
 * karena akun itu memang tidak punya aksesnya.
 *
 * Callback server kontrol datang sebagai GET biasa dari browser tanpa header apa pun, jadi di sana
 * `state` adalah SATU-SATUNYA yang menghubungkan jawaban Google dengan kredensial yang dimaksud.
 */
export function consentUrlFor({ clientId }, redirectUri = REDIRECT, state) {
  const url = new URL(AUTH_URL);
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    access_type: "offline",
    prompt: "select_account consent",
    scope: SCOPES.join(" "),
    ...(state ? { state } : {}),
  });
  return url.toString();
}

/**
 * Tukar authorization code jadi token. `redirectUri` HARUS sama persis dengan yang dipakai saat
 * meminta consent — Google mencocokkannya, dan yang tidak cocok ditolak dengan `redirect_uri_mismatch`
 * yang tidak menyebut nilai mana yang diharapkannya. Jawabannya bentuk mentah Google
 * (`refresh_token`, `scope`, ...), yang dibaca `credentialAuthResult`.
 */
export function exchangeCode({ clientId, clientSecret }, redirectUri, code) {
  return postToken(
    {
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code,
      grant_type: "authorization_code",
    },
    "Tukar authorization code",
  );
}

// Endpoint penukaran token Google. Satu-satunya alamat yang dipanggil fungsi di bawah.
export const TOKEN_URL = "https://oauth2.googleapis.com/token";

/**
 * Refresh token -> access token, lewat `fetch` LANGSUNG dan bukan `OAuth2Client.getAccessToken()`.
 *
 * Bukan selera. google-auth-library@9 menukar token lewat gaxios@6, yang di dalamnya memakai
 * node-fetch@3 — dan di Node 24 tiap panggilan ke alamat ini gagal dengan `Premature close`,
 * sebelum satu pun kredensial sempat dinilai. Terbukti dengan kredensial DUMMY: yang kembali bukan
 * `invalid_grant` melainkan kegagalan transport, sementara `fetch` bawaan Node ke URL yang sama
 * menjawab 400 dengan normal.
 *
 * Akibatnya seluruh CLI di folder ini tidak bisa dipakai di mesin ber-Node modern: `npm run
 * sync:roi` melaporkan "13 sumber gagal dibaca" untuk kredensial yang sehat, dan yang membacanya
 * akan mengejar izin Google yang tidak pernah bermasalah. Cloud Functions memakai Node 22
 * (`engines` di package.json) sehingga tidak terkena — itu yang membuat kegagalan ini hanya muncul
 * di sisi orang, bukan di produksi.
 *
 * Yang dilakukan di sini persis alur refresh OAuth2 yang didokumentasikan Google, dan tidak ada
 * yang hilang: `getAccessToken()` menyimpan cache di dalam instance client, sementara pemanggil di
 * repo ini selalu membuat client baru tiap panggilan — jadi tidak pernah ada cache untuk hilang.
 *
 * `invalid_grant` disebut namanya: itu satu-satunya kegagalan di sini yang menuntut orang consent
 * ulang, dan pesan aslinya dari Google ("Token has been expired or revoked.") tidak mengatakan apa
 * yang harus dilakukan.
 */
export async function accessTokenFrom({ clientId, clientSecret, refreshToken }) {
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Kredensial OAuth tidak lengkap (clientId/clientSecret/refreshToken).");
  }

  const body = await postToken(
    {
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    },
    "Tukar refresh token",
  );
  const token = body?.access_token;
  if (!token) throw new Error("Gagal menukar refresh token jadi access token.");
  return token;
}

async function postToken(params, label) {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });

  // Dibaca sebagai teks dulu: jawaban gagal Google TIDAK selalu JSON (halaman error dari proxy,
  // 502 dari perantara), dan `response.json()` yang meledak di situ menyembunyikan status HTTP-nya
  // — satu-satunya petunjuk yang tersisa untuk membedakan izin dari gangguan sesaat.
  const raw = await response.text();
  let body = null;
  try {
    body = JSON.parse(raw);
  } catch {
    body = null;
  }

  if (!response.ok) {
    const code = body?.error || "";
    const detail = body?.error_description || raw.slice(0, 200);
    if (code === "invalid_grant" && params.grant_type === "refresh_token") {
      throw new Error(
        `Refresh token ditolak Google (invalid_grant): ${detail}. Perlu consent ulang — tombol Login di /google-api-configs, atau npm run authorize.`,
      );
    }
    throw new Error(`${label} gagal (HTTP ${response.status})${code ? ` ${code}` : ""}: ${detail}`);
  }
  return body || {};
}
