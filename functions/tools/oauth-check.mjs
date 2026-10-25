import { get, ref } from "firebase/database";
import { connect } from "../db.mjs";
import { SCOPES, scopeSummary } from "../google-oauth-core.js";
import { accessTokenFrom } from "../oauth.mjs";

/**
 * Kesiapan tiap kredensial Google, tanpa menekan tombol Login satu per satu.
 *
 *   npm run oauth:check
 *   npm run oauth:check -- https://alamat-lain/google/callback
 *
 * Menjawab dua pertanyaan yang keduanya pernah memakan waktu berjam-jam, dan keduanya TIDAK
 * terlihat di dashboard:
 *
 *   1. **Alamat callback sudah terdaftar di OAuth client itu?** Kalau belum, tombol Login membawa
 *      orangnya ke layar "Access blocked: This app's request is invalid — Error 400:
 *      redirect_uri_mismatch", dan alurnya berhenti di Google: dashboard tidak pernah tahu ada yang
 *      gagal, karena browsernya tidak pernah kembali.
 *   2. **Token yang tersimpan sekarang membawa scope apa?** Kredensial yang consent-nya lebih tua
 *      dari `adsense.readonly` tetap berstatus "Connected" dan tetap gagal membaca AdSense dengan
 *      `403 insufficient authentication scopes` — pesan yang bentuknya sama persis dengan token
 *      kedaluwarsa. Itu yang terjadi pada petcins.com.
 *
 * CARA PEMERIKSAAN PERTAMA, dan kenapa ia tinggal di tools/ dan bukan di jalur produksi: Google
 * tidak punya API untuk menanyakan "redirect URI apa saja yang terdaftar". Yang dilakukan di sini
 * adalah meminta halaman consent lalu membaca ALASAN penolakannya — terkubur sebagai base64 di
 * parameter `authError` pada redirect ke halaman error. Bentuk itu tidak didokumentasikan Google dan
 * boleh berubah kapan saja; sebuah alat diagnosis boleh bergantung padanya, tombol yang dipakai
 * orang tidak.
 */
const CALLBACK =
  process.argv[2] ||
  (process.env.CONTROL_PUBLIC_URL
    ? `${process.env.CONTROL_PUBLIC_URL.replace(/\/+$/, "")}/google/callback`
    : "http://localhost:8080/google/callback");

async function redirectRegistered(clientId, redirectUri) {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES[0],
    access_type: "offline",
  }).toString();

  // `redirect: "manual"` — yang dicari justru ADA di header Location-nya, dan mengikutinya hanya
  // menukar jawaban itu dengan halaman HTML yang isinya dirender JavaScript.
  const res = await fetch(url, { redirect: "manual" });
  const location = res.headers.get("location") || "";
  if (!location.includes("signin/oauth/error")) return { ok: true, reason: "" };

  const raw = new URL(location).searchParams.get("authError") || "";
  const blob = Buffer.from(raw, "base64url").toString("utf8");
  return {
    ok: false,
    reason: blob.includes("redirect_uri_mismatch")
      ? "redirect_uri_mismatch — alamat callback belum terdaftar di OAuth client ini"
      : blob.replace(/[^\x20-\x7e]+/g, " ").trim().slice(0, 120),
  };
}

const db = await connect();
const configs = (await get(ref(db, "googleApiConfigs"))).val() || {};

console.log(`Alamat callback yang diperiksa: ${CALLBACK}\n`);
let blocked = 0;

for (const cfg of Object.values(configs)) {
  if (!cfg || cfg.deletedAt) continue;
  const name = cfg.name || "(tanpa nama)";

  if (!cfg.clientId) {
    console.log(`${name}\n  Client ID belum diisi — tombol Login tidak akan jalan.\n`);
    continue;
  }

  const redirect = await redirectRegistered(cfg.clientId, CALLBACK);
  const callbackLine = redirect.ok ? "callback  OK" : `callback  BELUM — ${redirect.reason}`;
  if (!redirect.ok) blocked++;

  // Scope dibaca dari token yang BENAR-BENAR tersimpan, bukan dari SCOPES yang diminta: yang
  // pertama itulah yang menentukan halaman mana yang bisa diisi.
  let scopeLine = "scope     belum pernah connect";
  if (cfg.refreshToken) {
    try {
      const token = await accessTokenFrom(cfg);
      const info = await (
        await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${token}`)
      ).json();
      const granted = info.scope || "";
      const missing = SCOPES.filter((scope) => !granted.split(/\s+/).includes(scope));
      scopeLine = missing.length
        ? `scope     KURANG — punya "${scopeSummary(granted)}", butuh consent ulang`
        : `scope     OK — ${scopeSummary(granted)}`;
    } catch (error) {
      scopeLine = `scope     tidak bisa dibaca — ${error.message}`;
    }
  }

  console.log(`${name}\n  ${callbackLine}\n  ${scopeLine}\n`);
}

if (blocked) {
  console.log(
    `${blocked} kredensial akan berhenti di layar error Google. Tambahkan ${CALLBACK} ke\n` +
      "Authorized redirect URIs OAuth client-nya masing-masing di Google Cloud Console.",
  );
}
process.exit(0);
