// Klien Management API plugin RabbitROI (versi plugin >= 0.4.7).
//
// Satu situs WordPress = satu alamat = satu kunci. Berbeda dari vi-control dan Meta yang punya satu
// kunci untuk seluruh armada, di sini tiap situs meng-generate `api_key`-nya sendiri saat enroll —
// jadi bocornya kunci satu situs tidak memengaruhi situs lain.
//
// DUA kredensial, dan keduanya tidak boleh sampai ke browser:
//
//   enroll token  — dibagi ke SELURUH armada, ditanam saat build plugin. Hanya dipakai `enroll`.
//                   Ini yang paling berbahaya: satu token membuka setiap situs kita.
//   api_key       — unik per situs, dipakai semua endpoint lain.
//
// Karena itu tidak ada satu pun pemanggil modul ini di `src/`. Yang memanggilnya hanya server
// kontrol (`server/plugin.js`) dan siklus ping (`sync-plugin.mjs`).

import { PluginError, pluginBaseUrl, unwrapPlugin } from "./plugin-core.js";

// WordPress bersama dengan plugin cache, WAF, dan shared hosting bisa lambat — tapi tidak semenit.
// Batas ini yang membedakan "situs lambat" dari "situs mati" di layar; tanpanya, satu situs yang
// menggantung menahan seluruh siklus terapkan-massal di belakangnya.
const TIMEOUT_MS = Number(process.env.PLUGIN_TIMEOUT_MS || 20_000);

/**
 * Batas tunggu KHUSUS untuk ganti versi, dan jauh lebih panjang.
 *
 * `/manage/update` mengunduh paket, membongkarnya, membuang plugin lama, lalu memasang yang baru —
 * pekerjaan puluhan detik di shared hosting, bukan sebuah pembacaan JSON. Dengan batas 20 detik
 * milik endpoint lain, yang terjadi bukan sekadar "gagal": koneksi diputus DI TENGAH pemasangan,
 * kita melaporkan gagal, dan situsnya bisa saja berhasil memasangnya sedetik kemudian — atau
 * tertinggal tanpa plugin sama sekali. Menunggu lebih lama jauh lebih murah daripada menebak.
 */
const UPDATE_TIMEOUT_MS = Number(process.env.PLUGIN_UPDATE_TIMEOUT_MS || 120_000);

async function request(host, path, { method = "GET", apiKey, enrollToken, payload, timeout } = {}) {
  const base = pluginBaseUrl(host);

  const headers = { Accept: "application/json" };
  if (enrollToken) headers["X-RabbitROI-Enroll"] = enrollToken;
  if (apiKey) headers["X-RabbitROI-Key"] = apiKey;
  if (payload) headers["Content-Type"] = "application/json";

  const limit = Number(timeout) > 0 ? Number(timeout) : TIMEOUT_MS;

  let res;
  let text;
  try {
    res = await fetch(`${base}${path}`, {
      method,
      headers,
      body: payload ? JSON.stringify(payload) : undefined,
      signal: AbortSignal.timeout(limit),
      // Redirect DIIKUTI dengan sengaja: banyak situs memasang canonical redirect (www ↔ non-www,
      // trailing slash) di depan REST API-nya, dan `manual` akan melaporkan tiap situs seperti itu
      // sebagai "menjawab tanpa JSON" — kegagalan yang tidak menyebut sebabnya sama sekali.
      redirect: "follow",
    });
    text = await res.text();
  } catch (error) {
    if (error.name === "TimeoutError") {
      throw new PluginError(`${host} tidak menjawab dalam ${Math.round(limit / 1000)} detik.`, {
        code: "timeout",
      });
    }
    // DNS mati, TLS ditolak, koneksi ditutup. Dibedakan dari jawaban yang isinya error, karena yang
    // ini tidak mengabarkan apa pun tentang plugin — situsnya sendiri yang tidak bisa dihubungi.
    throw new PluginError(`${host} tidak bisa dihubungi: ${error.message}`, {
      code: "unreachable",
    });
  }

  // Amplopnya yang diurai, bukan `res.ok` yang dipercaya: kedua bentuk gagal plugin datang dengan
  // JSON yang bisa dibaca, dan kode HTTP-nya bisa dinormalkan proxy di depan situs.
  return unwrapPlugin(safeJson(text), res.status);
}

function safeJson(text) {
  const body = String(text || "").trim();
  if (!body) return null;
  try {
    return JSON.parse(body);
  } catch {
    // Halaman HTML — halaman login, halaman blokir Cloudflare, atau error PHP mentah. `unwrapPlugin`
    // yang menerjemahkan null ini jadi kalimat yang menyebut kemungkinan-kemungkinan itu.
    return null;
  }
}

/**
 * Enroll: sekali per situs, menghasilkan `api_key` yang tidak akan pernah ditampilkan lagi.
 *
 * Situs yang sudah enroll menjawab `already_enrolled` (409). Itu BUKAN sesuatu yang boleh
 * di-retry: satu-satunya jalan keluar adalah reset, dan reset butuh kunci lama — jadi situs yang
 * kuncinya sudah hilang dari sisi kita tidak bisa dipulihkan dari dashboard sama sekali.
 */
export function enrollSite(host, enrollToken) {
  if (!enrollToken) throw new PluginError("PLUGIN_ENROLL_TOKEN belum di-set di server.");
  return request(host, "/enroll", { method: "POST", enrollToken });
}

export function resetSite(host, apiKey) {
  return request(host, "/reset", { method: "POST", apiKey });
}

export function pingSite(host, apiKey) {
  return request(host, "/ping", { apiKey });
}

export function readConfig(host, apiKey, group) {
  return request(host, `/${group}`, { apiKey });
}

export function writeConfig(host, apiKey, group, payload) {
  return request(host, `/${group}`, { method: "POST", apiKey, payload });
}

export function listLandings(host, apiKey) {
  return request(host, "/landing", { apiKey });
}

export function readLanding(host, apiKey, id) {
  return request(host, `/landing?id=${encodeURIComponent(id)}`, { apiKey });
}

// Tanpa `id` = create (slug wajib), dengan `id` = update partial. Satu endpoint untuk keduanya,
// persis seperti API-nya — memisahkannya di sini akan jadi dua fungsi yang mengirim request identik.
export function saveLanding(host, apiKey, payload) {
  return request(host, "/landing", { method: "POST", apiKey, payload });
}

/**
 * Landing dari preset "Buat LP Baru" (slug + parameter diacak situs, URL artikel ditarik saat itu).
 * Batasnya lebih longgar: `post_urls` ditarik sinkron dari seluruh post publish.
 */
export function createLandingPreset(host, apiKey, payload) {
  return request(host, "/landing/create", {
    method: "POST",
    apiKey,
    payload: payload || {},
    timeout: 60_000,
  });
}

// Lisensi — TIDAK digerbangi lisensi aktif di sisi plugin, jadi bisa dipasang sesudah enroll.
export function readLicense(host, apiKey) {
  return request(host, "/license", { apiKey });
}

export function writeLicense(host, apiKey, payload) {
  return request(host, "/license", { method: "POST", apiKey, payload, timeout: 60_000 });
}

// Deployment Tools ("Setting Sub"). POST destruktif dan lambat — PHP-nya dinaikkan ke 600 detik.
export function readDeployment(host, apiKey) {
  return request(host, "/deployment", { apiKey });
}

export function runDeployment(host, apiKey, tasks) {
  return request(host, "/deployment", {
    method: "POST",
    apiKey,
    payload: { tasks },
    timeout: 660_000,
  });
}

// Halaman legal. POST sinkron: satu panggilan AI per halaman, masing-masing sampai 120 detik.
export function readLegalPages(host, apiKey) {
  return request(host, "/legal-pages", { apiKey });
}

export function generateLegalPages(host, apiKey, payload) {
  return request(host, "/legal-pages", { method: "POST", apiKey, payload, timeout: 660_000 });
}

/**
 * Ganti versi plugin di satu situs.
 *
 * Body kosong (`{}`) berarti rilis stabil terbaru — itu kontrak API-nya, bukan `{version:"latest"}`.
 * Batas tunggunya sendiri karena ini pemasangan, bukan pembacaan.
 */
export function updateSite(host, apiKey, payload) {
  return request(host, "/update", {
    method: "POST",
    apiKey,
    payload: payload || {},
    timeout: UPDATE_TIMEOUT_MS,
  });
}
