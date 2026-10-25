// Angka uang dari mana pun asalnya: number dari sync, atau teks berformat dari baris lama
// ("Rp 1.000").
//
// Angka dari sync sudah berupa number dan bisa berdesimal (saldo 142228.46). Yang menyisir
// non-digit hanya boleh kena teks berformat, di mana "." adalah pemisah ribuan — menyisirnya pada
// 100.5 mengubah saldo itu jadi 1005.
export function toAmount(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  return Number(String(value || "").replace(/[^\d-]/g, "") || 0);
}
