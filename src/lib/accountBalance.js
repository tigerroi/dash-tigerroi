/**
 * Kolom "Saldo Kembar" di /gam-accounts dan /adsense-accounts.
 *
 * SATU KANTONG UANG, DUA BARIS. Ketujuh network GAM kita membawa `propertyCode` berbentuk
 * `ca-pub-…` — akun AdSense yang sama — dan akun itu berdiri lagi sebagai barisnya sendiri di
 * halaman AdSense: petcins.com ≡ "Dian ramadani", designingaround.com ≡ "MUZAKKIR WALAT", dan
 * seterusnya. `payments/unpaid` menjawab per PUBLISHER, jadi kedua baris menyebut angka yang sama
 * dan angka itu benar di keduanya — yang salah cuma menjumlahkannya.
 *
 * DITURUNKAN SAAT DIRENDER, tidak ditulis sync — alasan yang sama dengan kolom Status Sync di Ad
 * Accounts dan seluruh kolom otomatis Invalid Traffic: yang ditulis benar pada detik ia ditulis dan
 * basi sesudahnya. Baris kembar yang dihapus orang siang ini akan tetap mengaku kembar sampai sync
 * berikutnya jalan, dan yang membacanya tidak punya cara tahu mana yang basi.
 *
 * Bisa diturunkan sama sekali karena `gamAccounts` DAN `adsenseAccounts` dua-duanya
 * ADMIN_ONLY_RESOURCES: yang boleh membuka salah satu halaman sudah melanggan keduanya. Kalau salah
 * satunya suatu hari dibuka lebih lebar, kolom ini kosong untuk role itu — bukan salah, cuma tidak
 * tahu — dan saat itulah ia harus pindah ke sisi sync.
 */

// "ca-pub-123" / "pub-123" / "accounts/pub-123" -> "pub-123". Cerminan `accountResourceName` di
// functions/adsense.js: record GAM menyimpan awalan "ca-", record AdSense tidak, dan dua bentuk
// untuk satu publisher berarti tidak satu pun baris kembar yang pernah dikenali.
export function publisherKey(value) {
  const raw = String(value || "")
    .trim()
    .toLowerCase();
  if (!raw) return "";
  return raw.replace(/^accounts\//, "").replace(/^ca-/, "");
}

const publisherOf = (row) => publisherKey(row?.publisherId || row?.accountName);

/**
 * Baris satu halaman akun, berikut `saldoShared` yang menyebut halaman seberangnya.
 *
 * `label` adalah nama halaman LAIN — yang dituju orang saat ia bertanya "kenapa angka ini muncul
 * dua kali", bukan halaman yang sedang dibukanya.
 */
export function accountBalanceRows(items = [], siblings = [], label = "") {
  const shared = new Set(
    (siblings || [])
      .filter((row) => row && !row.deletedAt)
      .map(publisherOf)
      .filter(Boolean),
  );
  return (items || []).map((row) => {
    const key = publisherOf(row);
    // Kosong, bukan "Tidak": kolom yang menuliskan sesuatu di tiap baris berhenti dibaca, dan yang
    // ikut berhenti dibaca adalah tujuh baris yang benar-benar menuntut perhatian.
    return { ...row, saldoShared: key && shared.has(key) ? `Juga di ${label}` : "" };
  });
}
