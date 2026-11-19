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
  "ziperto.org": "America/New_York",
  "velocitytv.com.pk": "Asia/Karachi",
  "workmoney24.com": "GMT+6",
  "foodsfact.org": "America/Denver",
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
 * Menghitung selisih jam zona waktu terhadap UTC (offset dalam jam).
 * Mendukung format GMT/UTC (misal "GMT+5", "GMT-3", "UTC+1") dan nama IANA (misal "America/Denver", "America/New_York", "Asia/Karachi").
 * @param {string} tzInput String zona waktu
 * @param {Date} [date] Tanggal patokan (default: new Date())
 * @returns {number} Offset terhadap UTC dalam satuan jam (misal 5, -3, -7)
 */
export function getGamTimezoneOffset(tzInput, date = new Date()) {
  if (!tzInput || tzInput === "-") return 7; // default WIB (+7)
  const clean = String(tzInput).trim();

  // 1. Cek format GMT/UTC seperti "GMT+5", "GMT-3", "UTC+1", "+5", "-3"
  const gmtMatch = clean.match(/^(?:GMT|UTC)?\s*([+-]?\d+)(?::(\d+))?$/i);
  if (gmtMatch) {
    const hours = parseInt(gmtMatch[1], 10);
    const mins = gmtMatch[2] ? parseInt(gmtMatch[2], 10) / 60 : 0;
    return hours >= 0 ? hours + mins : hours - mins;
  }

  // 2. Cek format nama wilayah IANA resmi (misal "America/Denver", "America/New_York")
  try {
    const utcParts = new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
    }).formatToParts(date);
    const targetParts = new Intl.DateTimeFormat("en-US", {
      timeZone: clean,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
    }).formatToParts(date);

    const getVal = (parts, type) => parseInt(parts.find((p) => p.type === type).value, 10);
    const utcMs = Date.UTC(
      getVal(utcParts, "year"),
      getVal(utcParts, "month") - 1,
      getVal(utcParts, "day"),
      getVal(utcParts, "hour"),
      getVal(utcParts, "minute"),
    );
    const targetMs = Date.UTC(
      getVal(targetParts, "year"),
      getVal(targetParts, "month") - 1,
      getVal(targetParts, "day"),
      getVal(targetParts, "hour"),
      getVal(targetParts, "minute"),
    );

    return (targetMs - utcMs) / (1000 * 60 * 60);
  } catch {
    return 7;
  }
}

/**
 * Menghitung jam cut-off WIB (00 s/d 23) untuk pergantian hari di zona waktu GAM.
 * @param {string} tzGam Zona waktu GAM (misal "GMT+5", "GMT-3", "America/Denver")
 * @returns {number} Jam cut-off di WIB (0 s/d 23)
 */
export function getWibCutoffHour(tzGam) {
  if (!tzGam || tzGam === "-") return 0;
  const offsetGam = getGamTimezoneOffset(tzGam);
  return (7 - Math.round(offsetGam) + 24) % 24;
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
 * @param {string} tzGam Zona waktu GAM domain (misal "GMT+5", "GMT-3", "America/Denver")
 * @returns {string} Tanggal target yang selaras dengan siklus GAM
 */
export function resolveGamTargetDate(dateStr, dateToday, currentHourWib, tzGam) {
  // Hanya sesuaikan tanggal hari ini (hari berjalan)
  if (dateStr !== dateToday) {
    return dateStr;
  }

  const cutoffHourWib = getWibCutoffHour(tzGam);
  const offsetGam = getGamTimezoneOffset(tzGam);

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

/**
 * Mengonversi tanggal dan jam dari zona waktu asal (misal "America/Denver", "GMT-3") ke tanggal dan jam WIB ("Asia/Jakarta").
 * @param {string} dateStr Tanggal asal "YYYY-MM-DD"
 * @param {string|number} hourStr Jam asal "00" s/d "23"
 * @param {string} fromTimeZone Zona waktu asal
 * @returns {{ date: string, hour: string, time: string }} Tanggal dan jam dalam WIB
 */
export function toWibDateTime(dateStr, hourStr, fromTimeZone) {
  if (!fromTimeZone || fromTimeZone === "Asia/Jakarta" || fromTimeZone === "GMT+7") {
    const h = String(hourStr || "00").padStart(2, "0");
    return {
      date: dateStr,
      hour: h,
      time: `${h}:00`,
    };
  }

  const y = parseInt(dateStr.slice(0, 4), 10);
  const m = parseInt(dateStr.slice(5, 7), 10);
  const d = parseInt(dateStr.slice(8, 10), 10);
  const h = parseInt(hourStr || "00", 10);

  const guess = Date.UTC(y, m - 1, d, h);
  const offsetHours = getGamTimezoneOffset(fromTimeZone, new Date(guess));
  const epochMs = guess - offsetHours * 3600 * 1000;

  const wibDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(epochMs));

  const wibHour = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta",
    hour: "2-digit",
    hour12: false,
  }).format(new Date(epochMs));

  return {
    date: wibDate,
    hour: wibHour,
    time: `${wibHour}:00`,
  };
}
