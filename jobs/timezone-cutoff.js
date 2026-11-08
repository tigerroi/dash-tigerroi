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
 * Menentukan tanggal alokasi spending Meta hari ini berdasarkan jam eksekusi WIB saat ini.
 * Jika jam sekarang di WIB belum mencapai jam cut-off GAM domain tersebut,
 * maka spending hari ini dimasukkan ke hari sebelumnya (T-1).
 * Begitu jam cut-off tercapai atau terlewati, spending hari ini masuk ke hari ini (T).
 *
 * @param {string} dateStr Tanggal spending dari Meta (YYYY-MM-DD)
 * @param {string} dateToday Tanggal hari ini di WIB (YYYY-MM-DD)
 * @param {number} currentHourWib Jam saat ini di WIB (0 s/d 23)
 * @param {string} tzGam Zona waktu GAM domain (misal "GMT+5", "GMT-3")
 * @returns {string} Tanggal target yang selaras dengan siklus GAM
 */
export function resolveGamTargetDate(dateStr, dateToday, currentHourWib, tzGam) {
  // Hanya sesuaikan tanggal hari ini (hari berjalan)
  if (dateStr !== dateToday) {
    return dateStr;
  }

  const cutoffHourWib = getWibCutoffHour(tzGam);
  const match = String(tzGam || "").trim().match(/^(?:GMT|UTC)?([+-]\d+)/i);
  const offsetGam = match ? parseInt(match[1], 10) : 7;

  if (offsetGam < 7) {
    // GAM lebih lambat dari WIB
    // Jika jam sekarang di WIB belum mencapai jam cut-off pergantian hari GAM:
    if (currentHourWib < cutoffHourWib) {
      // Masukkan ke hari kemarin (T-1)
      const d = new Date(dateToday + "T12:00:00Z");
      d.setUTCDate(d.getUTCDate() - 1);
      return d.toISOString().slice(0, 10);
    }
  }

  return dateToday;
}
