/**
 * Helper Penyesuaian Zona Waktu Spending Meta vs Google Ad Manager (GAM)
 * Menyelaraskan cut-off harian spending Meta Ads (WIB / GMT+7) ke siklus 24 jam GAM
 * masing-masing domain (GMT+1, GMT+5, GMT+6, GMT-3, dll).
 */

export const DOMAIN_GAM_TIMEZONES = {
  "cmhhealths.com": "GMT+1",
  "trayedit.com": "GMT+6",
  "tiktokmodapk.net": "GMT+5",
  "tacobellmenuu.us": "GMT+5",
  "ihopmenuwithprices.us": "GMT-3",
  "uniqueinfo24.com": "GMT+6",
};

/**
 * Mencari zona waktu GAM untuk sebuah subdomain.
 * @param {string} subdomainName Nama subdomain (FQDN atau slug)
 * @param {Array} [subdomainsList] Daftar subdomain dari database
 * @param {Array} [gamAccountsList] Daftar akun GAM dari database
 * @returns {string} Zona waktu GAM (misal "GMT+5")
 */
export function getGamTimezoneForSubdomain(subdomainName, subdomainsList = [], gamAccountsList = []) {
  if (!subdomainName) return "GMT+7";
  const subLower = String(subdomainName).trim().toLowerCase();

  // 1. Cari parent_domain dari subdomainsList
  let parent = "";
  for (const s of subdomainsList || []) {
    if ((s?.name || "").toLowerCase() === subLower) {
      parent = String(s?.parent_domain || "").toLowerCase().trim();
      break;
    }
  }

  // 2. Jika tidak ada di subdomainsList, ambil nama domain dari 2 label terakhir FQDN
  if (!parent && subLower.includes(".")) {
    const parts = subLower.split(".").filter(Boolean);
    if (parts.length >= 2) {
      parent = parts.slice(-2).join(".");
    }
  }

  // 3. Cari report_time_zone dari gamAccountsList di database
  for (const g of gamAccountsList || []) {
    const gName = String(g?.name || "").toLowerCase().trim();
    if (gName === parent || (g?.network_code && String(g.network_code) === parent)) {
      if (g?.report_time_zone) return g.report_time_zone;
      if (g?.reportTimeZone) return g.reportTimeZone;
    }
  }

  // 4. Fallback ke daftar paten resmi
  if (DOMAIN_GAM_TIMEZONES[parent]) {
    return DOMAIN_GAM_TIMEZONES[parent];
  }

  return "GMT+7";
}

/**
 * Menghitung jam cut-off WIB (00 s/d 23) untuk pergantian hari di zona waktu GAM.
 * @param {string} tzGam Zona waktu GAM (misal "GMT+5", "GMT-3")
 * @returns {number} Jam cut-off di WIB (0 s/d 23)
 */
export function getWibCutoffHour(tzGam) {
  if (!tzGam || tzGam === "-") return 0;
  const match = String(tzGam).trim().match(/^(?:GMT|UTC)?([+-]\d+)/i);
  if (!match) return 0;
  const offsetGam = parseInt(match[1], 10);
  return (7 - offsetGam + 24) % 24;
}

/**
 * Mengalokasikan tanggal spending Meta berdasarkan jam terjadinya (WIB) dan zona waktu GAM.
 * - Jika zona waktu GAM lebih lambat dari GMT+7 (misal GMT+5, GMT+1, GMT-3):
 *   Jam sebelum cut-off WIB dialokasikan ke hari sebelumnya (T-1).
 * - Jika zona waktu GAM lebih cepat dari GMT+7 (misal GMT+8, GMT+9):
 *   Jam setelah cut-off WIB dialokasikan ke hari berikutnya (T+1).
 * 
 * @param {string} dateStr Tanggal spending WIB (YYYY-MM-DD)
 * @param {number} hourWib Jam terjadinya spend di WIB (0 s/d 23)
 * @param {string} tzGam Zona waktu GAM (misal "GMT+5")
 * @returns {string} Tanggal target yang selaras dengan GAM (YYYY-MM-DD)
 */
export function adjustDateByGamTimezone(dateStr, hourWib, tzGam) {
  if (!tzGam || tzGam === "-" || hourWib === undefined || hourWib === null) return dateStr;
  const match = String(tzGam).trim().match(/^(?:GMT|UTC)?([+-]\d+)/i);
  if (!match) return dateStr;
  const offsetGam = parseInt(match[1], 10);

  const cutoffHourWib = (7 - offsetGam + 24) % 24;
  const d = new Date(dateStr + "T12:00:00Z");

  if (offsetGam < 7) {
    // GAM lebih lambat dari WIB
    if (hourWib < cutoffHourWib) {
      // Masuk ke hari sebelumnya (T-1)
      d.setUTCDate(d.getUTCDate() - 1);
      return d.toISOString().slice(0, 10);
    }
    return dateStr;
  } else if (offsetGam > 7) {
    // GAM lebih cepat dari WIB
    if (hourWib >= cutoffHourWib) {
      // Masuk ke hari berikutnya (T+1)
      d.setUTCDate(d.getUTCDate() + 1);
      return d.toISOString().slice(0, 10);
    }
    return dateStr;
  }

  return dateStr;
}
