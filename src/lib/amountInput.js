// Kotak nominal uang diketik dengan pemisah ribuan supaya "500.000" bisa dibaca sekilas — nol
// yang kelebihan satu adalah salah ketik termahal di halaman keuangan.
//
// Yang berpisah di sini hanya tampilan: `digitsOnly` mengembalikan bentuk yang disimpan (digit
// polos, seperti sebelum ada format ini), `formatAmountInput` bentuk yang dilihat. Titik tidak
// pernah ikut tersimpan, jadi Number() di compute dan toAmount() tetap membaca angka yang sama.

export function digitsOnly(value) {
  return String(value ?? "").replace(/\D/g, "");
}

export function formatAmountInput(value) {
  // Number dari field compute (Total, Fee) ikut lewat sini; pecahannya dibuang karena rupiah di
  // dashboard ini selalu bulat.
  const digits =
    typeof value === "number" ? digitsOnly(Math.round(Math.abs(value))) : digitsOnly(value);

  // Kotak kosong tetap kosong — "0" yang muncul sendiri akan ikut terketik jadi "5000000".
  // (Field compute mengirim number, jadi 0-nya tetap tampil "0" seperti sebelum ada format ini.)
  if (!digits) {
    return "";
  }

  return Number(digits).toLocaleString("id-ID");
}
