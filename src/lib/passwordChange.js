// Aturan form ganti password, dipisah dari komponennya supaya bisa diuji tanpa DOM.
//
// Yang diperiksa di sini adalah yang TIDAK bisa dijawab Firebase: konfirmasi yang tidak cocok
// bukan konsep yang dikenal `updatePassword`, dan password baru yang sama persis dengan yang lama
// diterimanya tanpa keluhan — form yang lalu berkata "berhasil" untuk password yang tidak berubah
// adalah kabar yang salah tentang keadaan akun.
//
// Yang benar dan salahnya password lama TIDAK diperiksa di sini: itu jawaban server, dan menebaknya
// di browser berarti menaruh password lama di suatu tempat untuk dibandingkan.

// Batas Firebase Auth. Ditulis di sini supaya pesannya menyebut angka yang sama dengan yang
// benar-benar ditolak server, bukan angka yang lebih longgar dan berakhir sebagai auth/weak-password.
export const MIN_PASSWORD_LENGTH = 6;

export function validatePasswordChange({ currentPassword, newPassword, confirmPassword }) {
  if (!currentPassword) {
    return "Password lama belum diisi.";
  }

  if (String(newPassword || "").length < MIN_PASSWORD_LENGTH) {
    return `Password baru minimal ${MIN_PASSWORD_LENGTH} karakter.`;
  }

  if (newPassword === currentPassword) {
    return "Password baru masih sama dengan yang lama.";
  }

  if (confirmPassword !== newPassword) {
    return "Konfirmasi password belum sama.";
  }

  return "";
}
