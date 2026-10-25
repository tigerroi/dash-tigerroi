/**
 * Kosakata status akun Google — sisi layar.
 *
 * CERMINAN dari `functions/account-status.js`, persis pola `campaignCommandEntry`: yang menulis
 * kolom Status adalah sync (yang tinggal di `functions/`, paket lain yang tidak bisa diimpor dari
 * sini), sementara yang menawarkan pilihannya di form adalah `src/config/resources.js`. Beda satu
 * huruf dan akibatnya sunyi: dropdown menawarkan "Ready " berspasi, orang memilihnya, dan sync
 * berikutnya menimpanya tanpa ada yang pernah tahu keduanya pernah berbeda — atau sebaliknya,
 * nilai yang ditulis sync tidak ada di daftar pilihan dan form membukanya sebagai kotak kosong.
 * Dijaga `accountStatus.test.mjs`, yang membaca berkas seberangnya.
 *
 * Yang TIDAK ikut dicerminkan adalah aturan penilaiannya (`accountStatusFrom`): tidak ada satu pun
 * tempat di layar yang menilai ulang status sebuah akun — yang digambar halaman ini adalah nilai
 * yang sudah tersimpan — dan salinan kedua yang tidak dipakai siapa pun adalah salinan yang tidak
 * akan pernah ikut diperbarui.
 */

// Empat keadaan, urut dari yang paling menghentikan pendapatan.
export const ACCOUNT_CLOSED = "Akun Close";
export const AD_LIMITED = "Limit Iklan";
export const ADS_NOT_SERVING = "Iklan Belum Tayang";
export const ADS_READY = "Ready";

export const ACCOUNT_STATUSES = [ACCOUNT_CLOSED, AD_LIMITED, ADS_NOT_SERVING, ADS_READY];
