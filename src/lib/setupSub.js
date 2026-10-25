// Keterangan run Setup Sub (`subDomains/{id}/setup.detail`) adalah catatan per langkah yang
// disambung spasi oleh server/setup-sub.js. Dipecah per kalimat untuk digambar.
export function setupDetailLines(text) {
  return String(text || "")
    .split(/(?<=\.)\s+/)
    .filter(Boolean);
}

// Kalimat yang menandai langkah bermasalah — yang membuat run berstatus "Sebagian". Dibaca dari
// kalimatnya karena catatan lama tidak membawa penanda apa pun. Hitungan nol ("0 gagal",
// "0 dilewati") dan halaman legal yang dilewati karena sudah ada BUKAN masalah.
export function isSetupWarning(line) {
  const text = String(line || "");
  const ratio = text.match(/(\d+) dari (\d+)/);
  if (ratio && Number(ratio[1]) < Number(ratio[2])) return true;
  if (/\b[1-9]\d* gagal\b/.test(text)) return true;
  if (/\bgate (?!ok\b)\w+/.test(text)) return true;
  const words = text.replace(/\b\d+ (dibuat|dilewati|gagal)\b/g, "");
  return /\b(gagal|ditolak|belum|dilewati|tidak)\b/i.test(words);
}
