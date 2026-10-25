/**
 * Riwayat yang tinggal di `userReports/{id}`, dibaca dengan `users/{id}` sebagai CADANGAN.
 *
 * Empat cabang pindah dari bawah `users/{id}` ke pohonnya sendiri — `campaignHistory`,
 * `countryRoi`, `dailySpend`, `balanceSnapshots` — karena `users` dilanggan setiap akun pada setiap
 * muat halaman sementara keempatnya cuma dipakai dua layar. Lihat `needsUserReports` di
 * heavyData.js untuk siapa yang melanggannya, dan firebasePaths.js untuk angkanya.
 *
 * ATURANNYA DITULIS SEKALI DI SINI karena pembacanya DUA — panel-panel di `/users/{id}` dan
 * rincian negara di tab "Laporan ROI Realtime" — dan yang paling mudah salah bukan bentuk datanya
 * melainkan urutan menangnya. Disalin, salah satu layar akan menampilkan riwayat lama setelah
 * migrasi dan tidak ada apa pun yang menyebutkan bahwa keduanya membaca tempat yang berbeda.
 *
 * CABANG BARU MENANG, cabang lama jadi cadangan, dan keduanya memang harus ada: sampai
 * `npm run migrate:user-reports` dijalankan, datanya masih di `users`; sesudahnya cabang lamanya
 * kosong. Jadi berkas ini benar sebelum maupun sesudah migrasi, dan urutan deploy tidak bisa
 * mengosongkan panel siapa pun.
 *
 * `undefined` yang diperiksa, bukan kebenaran nilainya: sebuah cabang yang benar-benar kosong di
 * pohon baru (`{}`) adalah jawaban yang sah — "user ini memang tidak punya riwayat" — dan `||`
 * akan menjatuhkannya kembali ke salinan lama yang seharusnya sudah tidak dibaca lagi.
 */
export function userReportBranch(user, userReports, branch) {
  const value = userReports?.[user?.id]?.[branch];
  return value === undefined ? user?.[branch] : value;
}

/**
 * Bentuk yang dimakan `buildCountryBreakdown`: baris user apa adanya, dengan `countryRoi` yang
 * sudah ditukar ke cabang barunya.
 *
 * Ia menyisir SELURUH user, jadi ia tidak bisa sekadar membaca `store.userReports` — user yang
 * baris riwayatnya belum dipindahkan tidak punya cabang di sana, dan rincian negaranya akan hilang
 * dari tabel tanpa satu pun tanda. `id`-nya yang menjodohkan keduanya.
 *
 * BARIS USER-nya DIBAWA UTUH, bukan diganti objek `{ countryRoi }` seadanya: `buildCountryBreakdown`
 * menyusun id tiap baris negara dari `user.id` (jatuh ke `user.name`, lalu ke "user"), dan itu
 * satu-satunya yang membedakan negara yang sama milik dua user — persis keadaan yang disebut
 * fungsi itu sendiri, dua orang yang sempat memegang subdomain yang sama. Tanpa `id`, seluruh
 * armada memakai awalan "user" dan React membuang baris yang key-nya kembar.
 */
export function countryRoiSources(users, userReports) {
  return (Array.isArray(users) ? users : []).map((user) => ({
    ...user,
    countryRoi: userReportBranch(user, userReports, "countryRoi"),
  }));
}
