// Subdomain milik seorang user — dan baris ROI mana yang ikut dengannya.
//
// Kepemilikan tinggal di record subdomain (`subDomains.pic`), satu tempat. Kolom `pic` di baris
// ROI BUKAN kepemilikan: ia stempel PIC pada saat baris itu ditulis, dan tidak pernah ditulis
// ulang. Begitu sebuah subdomain berpindah tangan, ratusan baris lamanya tetap menyebut nama PIC
// yang dulu — pada 17 Agu 2026 delapan subdomain milik Lightman membawa 600+ baris ber-`pic`
// "Nurjaman WL 2", nama yang bukan user mana pun lagi. Halaman /users/{uid} yang menyaring lewat
// `pic` karena itu memperlihatkan riwayat yang bolong, dan filter sub-domain-nya berisi daftar
// yang tidak sama dengan subdomain yang dipegang user itu.
//
// Jadi yang menentukan baris ini milik siapa adalah NAMA SUBDOMAIN-nya, dicocokkan ke daftar
// subdomain yang dipegang user sekarang. Nama subdomain ada di baris sejak awal; PIC-nya bisa
// berganti kapan saja tanpa satu pun baris lama ikut berubah.

// Nilai sel bisa datang sebagai teks, array (hasil impor), atau `{ value }`. Ketiganya
// dibandingkan sebagai nama yang sama.
function nameKey(value) {
  const raw = Array.isArray(value) ? value[0] : (value?.value ?? value);
  return String(raw ?? "")
    .trim()
    .toLowerCase();
}

/**
 * Subdomain yang dipegang user ini. Kepemilikan dicocokkan longgar di kedua sisi karena record
 * subdomain menyimpan PIC-nya dengan nama kolom yang berbeda-beda tergantung umur datanya, dan
 * yang tersimpan bisa nama, username, email, atau id user-nya.
 */
export function assignedSubDomains(user, subDomains) {
  const userKeys = [user?.id, user?.name, user?.username, user?.email].map(nameKey).filter(Boolean);
  if (userKeys.length === 0) return [];

  return (Array.isArray(subDomains) ? subDomains : []).filter((item) => {
    if (!item || item.deletedAt) return false;
    return [item.pic, item.user, item.userOwner, item.userId, item.ownerId]
      .map(nameKey)
      .filter(Boolean)
      .some((key) => userKeys.includes(key));
  });
}

/** Kunci pembanding nama subdomain, untuk dipakai berulang kali tanpa menormalkan lagi tiap baris. */
export function subDomainNameKeys(subDomains) {
  const keys = new Set();
  for (const item of Array.isArray(subDomains) ? subDomains : []) {
    const key = nameKey(item?.name ?? item);
    if (key) keys.add(key);
  }
  return keys;
}

/**
 * Baris ROI (harian maupun snapshot) untuk subdomain-subdomain itu.
 *
 * Daftar kosong menghasilkan tabel kosong, dan itu memang jawabannya: user yang belum memegang
 * subdomain apa pun tidak punya baris ROI. Jatuh kembali ke pencocokan `pic` di keadaan itu akan
 * menghidupkan lagi persis riwayat ber-PIC basi yang fungsi ini ada untuk membuangnya.
 */
export function rowsForSubDomains(rows, nameKeys) {
  const keys = nameKeys instanceof Set ? nameKeys : subDomainNameKeys(nameKeys);
  if (keys.size === 0) return [];

  return (Array.isArray(rows) ? rows : []).filter((row) => keys.has(nameKey(row?.subDomain)));
}
