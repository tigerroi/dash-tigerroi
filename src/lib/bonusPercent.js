import { companyPercentIndex, companyPercentRows } from "./companyPercent.js";
import { toPercent } from "./numbers.js";

/**
 * Tarif bonus advertiser, BERTANGGAL — pola yang sama persis dengan Potongan Company, dan alasan
 * yang sama persis: `users.bonusPercent` satu nilai per orang, ditimpa tiap kali berubah, jadi
 * menaikkan tarif hari ini menghitung ulang bonus seluruh bulan lampau — termasuk bulan yang
 * uangnya sudah pindah ke rekening orang itu.
 *
 * SATUANNYA BULAN (`effectiveFrom` selalu tanggal 1). Dasar bonus adalah net profit SEBULAN milik
 * orang itu, jadi tarif yang berganti di tengah bulan tidak punya arti yang bisa dihitung.
 *
 * `users.bonusPercent` TIDAK dibuang: ia jadi tarif SEBELUM baris bertanggal pertama orang itu.
 * Itu yang membuat fitur ini tidak butuh migrasi — orang tanpa satu baris pun dihitung persis
 * seperti sebelumnya — dan yang membuat baris pertama tidak menghapus bonus bulan-bulan lampau.
 * Karena itu kolomnya juga keluar dari form Team: menyuntingnya di sana akan menghitung ulang
 * seluruh masa sebelum baris pertama, persis bug yang koleksi ini ada untuk mencegahnya.
 */
export function bonusPercentIndex(bonusPercents = [], users = []) {
  const dated = companyPercentIndex(bonusPercents, "user");
  const legacy = new Map();
  for (const user of users || []) {
    const key = normalize(user?.name);
    if (key) legacy.set(key, toPercent(user?.bonusPercent));
  }

  // Baris bertarif KOSONG menang atas `users.bonusPercent`: ia keputusan orang ("sejak bulan ini
  // tidak dapat bonus"), bukan ketiadaan data.
  return (name, date) => {
    const entry = dated.entryAt(name, date);
    return entry ? entry.percent : (legacy.get(normalize(name)) ?? null);
  };
}

export const bonusPercentRows = (items, store, now) =>
  companyPercentRows(items, store, now, "user");

function normalize(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}
