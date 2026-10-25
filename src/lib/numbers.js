// Helper angka yang dipakai hampir semua modul laporan. Satu salinan: `round` sempat ditulis delapan
// kali di folder ini, dan salinan yang lupa `Number(value) || 0` menjawab NaN untuk sel kosong.

// Kosong, "-", null, undefined = tidak diketahui. Nol BUKAN kosong.
export function hasAmount(value) {
  return value !== null && value !== undefined && value !== "" && value !== "-";
}

export function round(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

// "10%", "10", 10 -> 10. Kosong -> null, bukan 0: tarif yang belum diisi bukan tarif nol.
export function toPercent(value) {
  if (!hasAmount(value)) return null;
  const percent = Number(String(value).replace("%", "").trim());
  return Number.isFinite(percent) ? percent : null;
}

export function sumBy(rows, amountOf) {
  return round(rows.reduce((total, row) => total + (Number(amountOf(row)) || 0), 0));
}

export function ensure(map, key, create) {
  if (!map.has(key)) map.set(key, create());
  return map.get(key);
}
