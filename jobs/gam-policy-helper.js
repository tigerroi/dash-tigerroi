/**
 * Helper Pemeriksaan Kebijakan & Pembatasan Iklan (Policy Center & Limits)
 * Google Ad Manager (GAM) & AdSense
 */

import { fetchGamHourlyFillRate, fetchGamSites } from "./gam-client.js";

/**
 * Daftar pembatasan Pusat Kebijakan aktif di Google Ad Manager.
 */
export const KNOWN_GAM_POLICY_RESTRICTIONS = {
  // cmhhealths.com (GAM Network 23350466753)
  // Akun sedang dinilai: Penayangan iklan dibatasi sejak 14 Nov 2026 (Display ca-pub-3885553227294332)
  "23350466753": {
    domain: "cmhhealths.com",
    status: "Limit Iklan",
    detail: "Penayangan iklan dibatasi sejak 14 Nov 2026 (Akun sedang dinilai - Display ca-pub-3885553227294332)",
    since: "2026-11-14",
    active: true,
  },
};

/**
 * Memeriksa status kebijakan dan pembatasan Google untuk satu network GAM.
 * Menggabungkan:
 * 1. AdSense Management API Alerts (jika API diaktifkan di Google Cloud)
 * 2. GAM Sites REST API Approval (deteksi domain ditolak / review)
 * 3. Pusat Kebijakan Ad Manager (deteksi pembatasan traffic tidak valid Display)
 */
export async function evaluateGamPolicyStatus(networkCode, accessToken, domainName = "") {
  const code = String(networkCode || "").trim();
  const domain = String(domainName || "").toLowerCase().trim();

  let googleStatus = "Ready";
  let googleStatusDetail = "Tidak ada masalah saat ini";

  // Tier 1: Cek apakah ada pembatasan aktif di Pusat Kebijakan Ad Manager (Traffic Tidak Valid)
  const knownRestriction = KNOWN_GAM_POLICY_RESTRICTIONS[code];
  if (knownRestriction && knownRestriction.active) {
    return {
      status: knownRestriction.status,
      detail: knownRestriction.detail,
      source: "policy_center",
    };
  }

  // Tier 2: Cek GAM Sites REST API v1
  try {
    const sitesList = await fetchGamSites(code, accessToken);
    const disapproved = (sitesList || []).filter((s) => s.approvalStatus === "DISAPPROVED");
    const requiresReview = (sitesList || []).filter((s) => s.approvalStatus === "REQUIRES_REVIEW");

    if (disapproved.length > 0) {
      const reasons = disapproved
        .flatMap((s) => s.disapprovalReasons || [])
        .map((r) => r.type || r.details)
        .filter(Boolean);
      const reasonText = reasons.length > 0 ? reasons.join(", ") : "Ditolak Google";
      return {
        status: "Limit Iklan",
        detail: `Situs bermasalah: ${disapproved.map((s) => s.url).join(", ")} (${reasonText})`,
        source: "sites_api",
      };
    }

    if (requiresReview.length > 0) {
      return {
        status: "Perlu Review",
        detail: `Menunggu peninjauan Google: ${requiresReview.map((s) => s.url).join(", ")}`,
        source: "sites_api",
      };
    }
  } catch (siteErr) {
    // Jika gagal fetch sites, jangan langsung gagalkan seluruh pengecekan
    console.warn(`    ⚠️ [Policy Helper] Gagal fetch sites (${code} / ${domain}): ${siteErr.message}`);
  }

  // Tier 2.5: Deteksi Otomatis Pembatasan Penayangan dari Anomali Fill Rate (Ad Requests vs Impressions)
  try {
    const today = new Date().toISOString().slice(0, 10);
    const hourlyRows = await fetchGamHourlyFillRate(code, accessToken, { startDate: today, endDate: today });
    let totalReq = 0;
    let totalImp = 0;
    for (const r of hourlyRows || []) {
      totalReq += r.requests || 0;
      totalImp += r.impressions || 0;
    }
    // Jika ada traffic permintaan iklan yang signifikan (>= 50 requests) tapi tayangan 0
    if (totalReq >= 50 && totalImp === 0) {
      return {
        status: "Limit Iklan",
        detail: `Penayangan iklan dibatasi Google (0 tayangan dari ${totalReq.toLocaleString("id-ID")} permintaan iklan hari ini)`,
        source: "fill_rate_anomaly",
      };
    }
  } catch (fillErr) {
    // Abaikan jika reporting belum ada
  }

  // Tier 3: Cek AdSense Alerts API (jika AdSense Management API aktif)
  try {
    // Ambil propertyCode dari GAM Network
    const netRes = await fetch(`https://admanager.googleapis.com/v1/networks/${code}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (netRes.ok) {
      const netInfo = await netRes.json();
      const pubCode = netInfo.propertyCode; // contoh: "ca-pub-4792810451416544"
      if (pubCode) {
        const alertRes = await fetch(`https://adsense.googleapis.com/v2/accounts/${pubCode}/alerts`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (alertRes.ok) {
          const alertData = await alertRes.json();
          const alerts = Array.isArray(alertData.alerts) ? alertData.alerts : [];
          for (const a of alerts) {
            const isThrottled = /throttl|serving-limit|ad-limit/i.test(String(a.type || ""));
            const isSevere = String(a.severity || "").toUpperCase() === "SEVERE";
            const msg = String(a.message || "");
            const hasKeyword = /dibatasi|batasi|limited|restrict|traffic tidak valid/i.test(msg);

            if (isThrottled || (isSevere && hasKeyword)) {
              return {
                status: "Limit Iklan",
                detail: msg.trim() || "Penayangan iklan saat ini dibatasi karena traffic tidak valid.",
                source: "adsense_api",
              };
            }
          }
        }
      }
    }
  } catch (asErr) {
    // Abaikan jika AdSense API belum diaktifkan
  }

  return {
    status: googleStatus,
    detail: googleStatusDetail,
    source: "default",
  };
}

