// Teks sebuah sel apa adanya: sisi sync menulis sebagian nilai sebagai array atau `{ value }`
// (kolom yang digabung dari beberapa campaign), dan yang dicari di sini adalah namanya.
//
// Sengaja BUKAN `firstValue`: yang itu menjatuhkan nilai kosong ke `"-"` supaya tabel punya sesuatu
// untuk digambar, dan `"-"` yang masuk ke pengelompokan berubah jadi subdomain bernama "-" —
// selengkap dengan kurva, chip, dan pilihan filternya sendiri.
export function cellText(value) {
  const raw = Array.isArray(value) ? value[0] : value;
  const unwrapped = raw && typeof raw === "object" && "value" in raw ? raw.value : raw;

  return unwrapped === null || unwrapped === undefined ? "" : String(unwrapped).trim();
}
