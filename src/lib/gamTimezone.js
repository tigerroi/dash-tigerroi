/**
 * Helper Penanganan Zona Waktu dan Jam Live GAM (Google Ad Manager)
 * Menampilkan zona waktu GAM beserta jam live saat ini di zona waktu tersebut.
 */

export const GAM_DEFAULT_TIMEZONES = {
  "cmhhealths.com": "GMT+1",
  "trayedit.com": "GMT+6",
  "tiktokmodapk.net": "GMT+5",
  "tacobellmenuu.us": "GMT+5",
  "ihopmenuwithprices.us": "GMT-3",
  "uniqueinfo24.com": "GMT+6",
  "ziperto.org": "GMT-5",
  "23355757170": "GMT-5",
};

/**
 * Parsing zona waktu GAM dan hitung waktu saat ini di zona tersebut.
 * @param {string} tzInput String zona waktu (misal "GMT+5", "GMT -3", "America/New_York")
 * @param {Date} [date] Tanggal patokan (default: new Date())
 * @returns {object|null} Komponen waktu zona GAM
 */
export function getGamTimeParts(tzInput, date = new Date()) {
  if (!tzInput || tzInput === "-") return null;
  const str = String(tzInput).trim();
  // Bersihkan jika ada format sebelumnya
  const cleanStr = str.split("·")[0].split("(")[0].trim();

  // 1. Dukungan format offset GMT / UTC seperti "GMT+5", "GMT +5", "GMT-3", "+5", "-3"
  const gmtMatch = cleanStr.match(/^(?:GMT|UTC)?\s*([+-]?\d+)(?::(\d+))?$/i);
  if (gmtMatch) {
    const hours = parseInt(gmtMatch[1], 10);
    const mins = gmtMatch[2] ? parseInt(gmtMatch[2], 10) : 0;
    const offsetMs = (hours * 60 + (hours < 0 ? -mins : mins)) * 60 * 1000;
    const utcMs = date.getTime() + date.getTimezoneOffset() * 60 * 1000;
    const targetDate = new Date(utcMs + offsetMs);
    const h = String(targetDate.getHours()).padStart(2, "0");
    const m = String(targetDate.getMinutes()).padStart(2, "0");
    const day = String(targetDate.getDate()).padStart(2, "0");
    const months = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
    const month = months[targetDate.getMonth()];
    const tzLabel = `GMT${hours >= 0 ? `+${hours}` : hours}`;

    return {
      hours: h,
      minutes: m,
      time: `${h}:${m}`,
      day,
      month,
      fullDate: `${day} ${month}`,
      fullDateTime: `${day} ${month}, ${h}:${m}`,
      diffDay: date.getDate() !== targetDate.getDate(),
      tzLabel,
    };
  }

  // 2. Dukungan format nama wilayah IANA (misal "Asia/Jakarta", "America/New_York")
  try {
    const timePart = new Intl.DateTimeFormat("id-ID", {
      timeZone: cleanStr,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
    const datePart = new Intl.DateTimeFormat("id-ID", {
      timeZone: cleanStr,
      day: "2-digit",
      month: "short",
    }).format(date);
    const localDayPart = new Intl.DateTimeFormat("id-ID", {
      day: "2-digit",
      month: "short",
    }).format(date);
    const formattedTime = timePart.replace(".", ":");
    const [h, m] = formattedTime.split(":");

    return {
      hours: h,
      minutes: m || "00",
      time: formattedTime,
      fullDate: datePart,
      fullDateTime: `${datePart}, ${formattedTime}`,
      diffDay: datePart !== localDayPart,
      tzLabel: cleanStr,
    };
  } catch {
    return null;
  }
}

/**
 * Format string zona waktu GAM beserta jam live saat ini.
 * Contoh hasil: "GMT+5 · Jam 11:00" atau "GMT-3 · Jam 03:00 (08 Nov)"
 */
export function formatGamZoneWithTime(tzInput, date = new Date()) {
  if (!tzInput || tzInput === "-") return "-";
  const parts = getGamTimeParts(tzInput, date);
  if (!parts) return tzInput;
  const dateSuffix = parts.diffDay ? ` (${parts.fullDate})` : "";
  return `${parts.tzLabel || tzInput} · Jam ${parts.time}${dateSuffix}`;
}

/**
 * Format waktu GAM lengkap untuk kolom tersendiri
 */
export function formatGamTime(tzInput, date = new Date()) {
  const parts = getGamTimeParts(tzInput, date);
  if (!parts) return "-";
  return parts.fullDateTime;
}

