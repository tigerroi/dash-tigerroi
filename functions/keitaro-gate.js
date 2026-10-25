// vi-control API — gate/ungate campaign Keitaro.
//
// Satu campaign Keitaro mengirim trafik ke tiga tempat: Landing (pengunjung asli), Bot Protection
// (bot), dan Flow 3 (trafik tidak memenuhi syarat). Dua yang terakhir menuju decoy yang sama
// (biasanya link YouTube). "Gating" mengarahkan ketiganya ke gate kita, yang mencatat kunjungan
// lalu meneruskan pengunjung ke tujuan yang sama seperti sebelumnya — dari sisi pengunjung tidak
// ada yang berubah, kita hanya jadi bisa mengukurnya.
//
// Auth: satu API key, header Bearer, backend-ke-backend. Key ini TIDAK BOLEH sampai ke browser:
// ia bisa mengubah tujuan trafik iklan yang sedang berjalan, dan bundle frontend dibaca siapa pun
// yang membuka devtools. Karena itu tidak ada satu pun pemanggil di src/ — yang memanggil hanya
// modul ini, dari Cloud Function terjadwal atau CLI (lihat sync-gating.mjs).

function getBase() {
  const url = process.env.VI_CONTROL_BASE_URL || "http://127.0.0.1:8443";
  return url.replace(/\/+$/, "");
}

// Daftar campaign membaca stream tiap campaign satu per satu di sisi sana — ~3 detik untuk 55
// campaign, dan lebih lambat kalau Keitaro sedang sibuk. Gate/ungate sendiri ~2 detik karena ia
// benar-benar mengklik kedua key untuk memverifikasi hasilnya.
const TIMEOUT_MS = Number(process.env.VI_CONTROL_TIMEOUT_MS || 45_000);

/**
 * Kalimat yang bisa dibaca orang untuk tiap kode error, karena kode HTTP sendiri tidak menyebut
 * siapa yang harus memperbaikinya.
 *
 * 502 adalah yang paling penting dibedakan: itu Keitaro yang menolak atau sedang mati, BUKAN
 * dashboard ini dan bukan gate-nya. Digabung jadi "gagal menghubungi API", orang akan mencari
 * penyebabnya di tempat yang salah setiap kali Keitaro sedang restart.
 */
const ERROR_HINTS = {
  401: "API key vi-control ditolak — periksa secret VI_CONTROL_API_KEY.",
  404: "Campaign ini tidak ada di Keitaro.",
  422: "Permintaan ditolak: parameternya tidak valid.",
  500: "Ada bug di sisi vi-control.",
  502: "Keitaro sedang down atau menolak permintaan — masalah di upstream, bukan di dashboard.",
};

async function request(path, apiKey, { method = "GET" } = {}) {
  const base = getBase();
  if (!apiKey) {
    throw new Error("VI_CONTROL_API_KEY belum di-set.");
  }

  // Batas waktu, bukan sekadar berharap: permintaan yang menggantung di dalam fungsi
  // terjadwal memakan seluruh jatah waktunya dan run-nya mati tanpa menulis apa pun.
  let res;
  let body;
  try {
    res = await fetch(`${base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await res.text();
    body = text ? safeJson(text) : null;
  } catch (error) {
    if (error.name === "TimeoutError") {
      throw new Error(`vi-control tidak menjawab dalam ${Math.round(TIMEOUT_MS / 1000)} detik.`);
    }
    throw new Error(`vi-control tidak bisa dihubungi: ${error.message}`);
  }

  if (!res.ok) {
    const hint = ERROR_HINTS[res.status] || `vi-control menjawab HTTP ${res.status}.`;
    const detail = body?.error || body?.detail;
    throw new Error(detail && detail !== "unauthorized" ? `${hint} (${detail})` : hint);
  }

  return body;
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    // Bukan JSON berarti yang menjawab bukan vi-control — proxy, halaman error, atau captive
    // portal. Potongan isinya ikut dibawa: "Unexpected token <" tidak menyebut siapa pun.
    throw new Error(`vi-control menjawab bukan JSON: ${text.slice(0, 120)}`);
  }
}

// Daftar seluruh campaign berikut status gating-nya. Ini satu-satunya sumber `gated` — preview
// TIDAK bisa dipakai untuk itu (lihat catatan di previewCampaign).
export function listCampaigns(apiKey) {
  return request("/campaigns", apiKey);
}

/**
 * Pratinjau: apa yang akan terjadi kalau campaign ini di-gate. Tidak menulis apa pun.
 *
 * PERINGATAN, dan ini tidak tertulis di dokumentasinya: preview untuk campaign yang SUDAH di-gate
 * tetap menjawab `applicable: true`, dengan `destinations` yang menunjuk ke URL gate itu sendiri.
 * Menggating-nya lagi berarti memasang gate di depan gate. Jadi yang menentukan sebuah campaign
 * boleh di-gate adalah `gated === false` dari /campaigns, bukan `applicable` dari sini.
 */
export function previewCampaign(campaignId, apiKey) {
  return request(`/campaigns/${encodeURIComponent(campaignId)}/preview`, apiKey);
}

/**
 * Jalankan gating. SELALU menjawab HTTP 200 — yang menentukan hasilnya adalah field `status`:
 *
 *   ok      — berhasil dan terverifikasi
 *   aborted — ditolak, tidak ada yang ditulis sama sekali (lihat plan.blockers)
 *   problem — tersimpan tapi verifikasi gagal; perlu dilihat manusia
 *
 * Gate menjalankan ulang pratinjaunya sendiri sebelum menulis, jadi ia bisa `aborted` walaupun
 * pratinjau semenit lalu bilang boleh — misalnya karena campaign-nya diubah orang lain di sela-sela.
 */
export function gateCampaign(campaignId, apiKey) {
  return request(`/campaigns/${encodeURIComponent(campaignId)}/gate`, apiKey, { method: "POST" });
}

// Kembalikan campaign ke URL langsungnya. Semantik `status` sama persis dengan gate.
export function ungateCampaign(campaignId, apiKey) {
  return request(`/campaigns/${encodeURIComponent(campaignId)}/ungate`, apiKey, { method: "POST" });
}

// Riwayat gate/ungate, terbaru dulu — termasuk yang gagal dan yang ditolak.
export function listGateRuns(apiKey, limit = 50) {
  return request(`/gate-runs?limit=${encodeURIComponent(limit)}`, apiKey);
}
