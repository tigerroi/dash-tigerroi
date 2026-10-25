/**
 * Langganan yang terlalu berat untuk dipasang di setiap halaman.
 *
 * `dashboard/roiSnapshots` 2,1 MB — satu baris per SYNC per subdomain, masa simpan tiga hari — dan
 * sampai berkas ini ada ia dilanggan setiap akun pada setiap muat halaman, termasuk yang seumur
 * sesinya cuma membuka Domains dan Expenses. Itu unduhan terbesar kedua sesudah `users`, untuk node
 * yang cuma dibaca dua tab Overview dan panel realtime di profil user.
 *
 * YANG DIJAWAB DI SINI CUMA "SIAPA YANG MEMBUTUHKANNYA". Kapan ia dilepas TIDAK dijawab di sini,
 * dan itu disengaja: langganan yang dicabut begitu orang pindah tab akan mengunduh 2,1 MB LAGI
 * setiap kali ia kembali, dan orang yang bolak-balik antara Grafik dan ROI membayar lebih mahal
 * daripada sebelum ada berkas ini. Yang memasangnya (`useFirebaseStore`) memasangnya SEKALI lalu
 * membiarkannya hidup sampai sesi berakhir — jadi yang benar-benar dihemat adalah sesi yang tidak
 * pernah membuka halaman-halaman ini sama sekali, dan muat halaman PERTAMA setiap sesi.
 *
 * Dibaca dari ROUTE, bukan dari string alamat: `resolveRoute` sudah tahu mana halaman detail dan
 * mana form (`/users/{id}` butuh, `/users/{id}/edit` dan `/users/new` tidak), dan mengurai alamat
 * untuk kedua kalinya di sini berarti dua pengurai yang harus tetap sepakat.
 */
export function needsRoiSnapshots(route) {
  if (!route) return false;

  // Tab Grafik memakainya untuk dua grafik per subdomain, tab ROI untuk tabel "Laporan ROI
  // Realtime". Ringkasan dan Kalender TIDAK: keduanya membaca `roiReports` (baris harian), karena
  // baris snapshot kumulatif sejak tengah malam dan menjumlahkannya per hari melipatgandakan
  // pendapatan.
  if (route.kind === "dashboard") return route.tab === "grafik" || route.tab === "roi";

  // Panel "Report Master Realtime ROI" di /users/{uid}.
  return route.kind === "detail" && route.key === "users";
}

/**
 * `userReports/{id}` — campaignHistory, countryRoi, dailySpend, balanceSnapshots.
 *
 * 2,81 MB untuk DUA layar. Selama keempatnya tinggal di bawah `users`, tiap akun mengunduhnya pada
 * tiap muat halaman — termasuk sesi yang seumur hidupnya cuma membuka Domains.
 *
 * DUA, BUKAN SATU, dan yang kedua mudah terlewat: `countryRoi` juga mengisi rincian negara di tiap
 * baris tabel "Laporan ROI Realtime" (`buildCountryBreakdown` di lib/countryBreakdown.js), yang
 * menyisir SELURUH user — bukan cuma yang sedang dibuka. Ketinggalan di sini, lencana negara di tab
 * itu kosong untuk semua baris, dan tidak ada satu pun pesan yang menyebutkan kenapa.
 *
 * Tab Grafik TIDAK ikut walau ia butuh `roiSnapshots`: ia tidak menggambar satu pun rincian negara.
 * Begitu juga form user — `/users/{id}/edit` dan `/users/new` tidak menggambar satu pun panel
 * riwayat, dan `resolveRoute` sudah membedakannya dari halaman detail.
 */
export function needsUserReports(route) {
  if (!route) return false;
  if (route.kind === "dashboard") return route.tab === "roi";
  return route.kind === "detail" && route.key === "users";
}
