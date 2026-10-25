// Klien AutoPost plugin RabbitROI — kembaran `plugin-api.mjs` untuk namespace di luar `/manage/`.
//
// Kunci dan gerbangnya sama persis (`X-RabbitROI-Key`, superadmin, lewat server kontrol). Yang
// berbeda cuma dua hal, dan keduanya sudah cukup untuk menjadikan ini modul sendiri: alamat
// dasarnya (`/autopost`, bukan `/manage`) dan amplop gagalnya (`message` di akar, bukan
// `error.code`). Lihat catatan panjang di `autopost-core.js`.

import { autopostBaseUrl, unwrapAutopost } from "./autopost-core.js";
import { PluginError } from "./plugin-core.js";

// Submit menjawab 202 SEBELUM artikelnya dibuat — koneksi ditutup lewat `fastcgi_finish_request()`
// dan prosesnya lanjut di latar. Jadi batas ini mengukur "situsnya menerima permintaan", bukan
// "artikelnya selesai"; yang kedua dipantau lewat job, bukan ditunggu di sini.
const TIMEOUT_MS = Number(process.env.AUTOPOST_TIMEOUT_MS || 20_000);

/**
 * Batas tunggu KHUSUS pembuatan kata kunci, dan jauh lebih panjang.
 *
 * `/autopost/keywords` SINKRON: satu panggilan AI yang umumnya 5–20 detik, dan dokumennya sendiri
 * meminta klien menyiapkan minimal 60 detik. Dengan batas 20 detik milik endpoint lain, yang
 * terjadi bukan sekadar "gagal" — kita memutus koneksi untuk panggilan AI yang sudah terlanjur
 * ditagihkan, lalu orang yang melihat kegagalannya menekannya lagi dan membayarnya dua kali.
 */
const KEYWORD_TIMEOUT_MS = Number(process.env.AUTOPOST_KEYWORD_TIMEOUT_MS || 90_000);

async function request(host, path, { method = "GET", apiKey, payload, timeout } = {}) {
  const base = autopostBaseUrl(host);

  const headers = { Accept: "application/json" };
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
      // Sepola dengan plugin-api.mjs: canonical redirect (www ↔ non-www, trailing slash) di depan
      // REST API adalah hal yang biasa, dan `manual` melaporkan tiap situs seperti itu sebagai
      // "menjawab tanpa JSON" — kegagalan yang tidak menyebut sebabnya sama sekali.
      redirect: "follow",
    });
    text = await res.text();
  } catch (error) {
    if (error.name === "TimeoutError") {
      throw new PluginError(`${host} tidak menjawab dalam ${Math.round(limit / 1000)} detik.`, {
        code: "timeout",
      });
    }
    throw new PluginError(`${host} tidak bisa dihubungi: ${error.message}`, { code: "unreachable" });
  }

  return unwrapAutopost(safeJson(text), res.status);
}

function safeJson(text) {
  const body = String(text || "").trim();
  if (!body) return null;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

export function generateKeywords(host, apiKey, payload) {
  return request(host, "/keywords", {
    method: "POST",
    apiKey,
    payload,
    timeout: KEYWORD_TIMEOUT_MS,
  });
}

// Satu keyword per panggilan — tidak ada endpoint batch di sisi plugin. Yang mengulanginya untuk
// tiap keyword adalah `submitAutopost` di sync-plugin.mjs, dengan pool-nya sendiri.
export function submitAutopostJob(host, apiKey, payload) {
  return request(host, "", { method: "POST", apiKey, payload });
}

export function readAutopostJob(host, apiKey, jobId) {
  return request(host, `/job/${encodeURIComponent(jobId)}`, { apiKey });
}

/**
 * Daftar job. `include_logs` sengaja jadi parameter dan bukan selalu menyala.
 *
 * Tanpa itu tiap baris kehilangan `logs` dan `final` dan diganti `log_count` — dan itu yang
 * dipakai polling: satu job yang berjalan lima menit menumpuk puluhan baris log, dan menariknya
 * ulang tiap tiga detik untuk dua puluh job berarti memindahkan ratusan kilobyte demi satu kolom
 * persentase yang bergerak.
 */
export function listAutopostJobs(host, apiKey, query = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    const text = String(value ?? "").trim();
    if (text) params.set(key, text);
  }
  const search = params.toString();
  return request(host, `/jobs${search ? `?${search}` : ""}`, { apiKey });
}
