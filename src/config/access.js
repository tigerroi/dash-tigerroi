// Role-based access, mirroring database.rules.json. The rules are the real enforcement — this
// only keeps the UI from asking for data the database will refuse (and from showing buttons that
// would fail). Roles are read from /roles/{uid} at login (see useFirebaseAuth); an account with
// no entry there is a plain "user".
//
// A user can hold several roles: the value is a comma-joined string ("user,keuangan"). Every
// helper here parses that string, so callers keep passing the raw `user.role` they always did.
//
// Why whole collections instead of hiding single fields: RTDB read permission cascades. Granting
// .read on `adsenseAccounts` grants every child below it, and a deeper rule cannot take it back.
// Since the dashboard lists these collections by reading the collection node, the secrets they
// hold (passwordAkun / passwordDomain / passwordWp / rekening, and clientSecret / refreshToken)
// can only be protected by restricting the whole collection.
// "telegramInbox" berdiri di sini dengan alasan yang berbeda dari tiga lainnya: yang disimpannya
// bukan rahasia kita melainkan identitas ORANG LUAR — nama profil dan @username setiap orang yang
// pernah mengirim pesan ke bot, termasuk yang salah alamat. Bot-nya publik, jadi daftar itu tidak
// bisa dibatasi di sisi Telegram; yang membatasinya adalah siapa yang boleh membukanya di sini.
//
// Ia juga satu-satunya kunci di daftar ini yang BUKAN halaman penuh melainkan sebuah tab
// (`/notifications/calon`) — dan itu justru gunanya: induknya terbuka untuk semua role, dan tanpa
// key sendiri tab ini akan ikut terbuka. `useFirebaseStore` sudah hanya berlangganan node ini untuk
// admin, jadi tab yang tampil bagi yang lain akan selamanya berbunyi "belum ada" — sebuah daftar
// kosong yang berbohong, bukan daftar yang ditutup.
export const ADMIN_ONLY_RESOURCES = [
  "gamAccounts",
  "adsenseAccounts",
  "googleApiConfigs",
  "telegramInbox",
];

// The mirror image: only Keuangan (and admin) may see these. Expenses holds spending records the
// rest of the team has no business reading.
//
// `invalidTraffic` ikut di sini bukan karena isinya rahasia, melainkan karena ia hanya berarti di
// halaman Laba Rugi — dan halaman itu sendiri tertutup untuk selain Keuangan (KEUANGAN_PAGES di
// bawah). Sebuah koleksi yang boleh dibaca semua orang tapi tidak muncul di halaman mana pun yang
// mereka bisa buka cuma menambah langganan yang tidak pernah dipakai.
//
// `adxCosts` ikut di sini dengan alasan yang sama seperti `invalidTraffic`: ia tab di bawah Laba
// Rugi, dan tab tidak boleh lebih terbuka daripada induknya (dijaga navigation.test.mjs). Yang
// disimpannya memang bukan rahasia sebesar isi `gamAccounts` — alamat email akun, tanpa
// passwordnya — dan Keuangan justru role yang membayar tagihan ini.
// `companyPercents` ikut dengan alasan yang sama seperti dua di atasnya: ia tab di bawah
// Accounting, dan tab tidak boleh lebih terbuka daripada induknya. Ia juga LEBIH tertutup daripada
// tempat asalnya (kolom % Company di /domains, yang terbaca semua akun yang login) — dan itu
// perbaikan, bukan efek samping: tarif bagi hasil dengan company adalah isi kesepakatan, dan satu-
// satunya yang perlu membacanya adalah yang menghitung labanya.
export const KEUANGAN_RESOURCES = [
  "expenses",
  "whitelistTopup",
  "invalidTraffic",
  "adxCosts",
  "companyPercents",
  // `bonusPercents` ikut dengan alasan yang sama dengan `companyPercents`: tab di bawah Accounting,
  // dan isinya bahan dasar bonus yang dihitung ketiga laporannya.
  "bonusPercents",
  // `accountCloses` ikut dengan alasan yang sama seperti empat di atasnya (tab di bawah Accounting,
  // dan tab tidak boleh lebih terbuka daripada induknya) plus satu yang khusus: isinya adalah laba
  // rugi sebuah domain sebulan penuh — earning, belanja, potongan, dan bonus — yaitu persis yang
  // menutup halaman Laba Rugi itu sendiri.
  "accountCloses",
  // `payouts` ikut dengan alasan yang sama seperti tiga di atasnya — ia tab di bawah Accounting,
  // dan tab tidak boleh lebih terbuka daripada induknya. Isinya juga menuntutnya sendiri: nomor
  // rekening dan nama pemiliknya, di samping seluruh pendapatan tiap domain.
  "payouts",
];

// Ditulis Keuangan, dibaca semua. Reminder ada di sini dan bukan di daftar atas karena badge
// jatuh tempo di topbar memang ditujukan ke seluruh tim: pengingat perpanjangan domain yang cuma
// terlihat Keuangan tidak menahan siapa pun selain Keuangan. Yang menambah/mengubah/menandai
// selesai tetap admin + Keuangan — cerminan aturan `reminders` di database.rules.json (.read
// "auth != null", .write admin|keuangan).
//
// Nominalnya ikut terbaca semua orang, dan itu keputusan: tagihan yang jatuh tempo bukan rahasia
// gaji. Yang rahasia tetap di `expenses`.
const KEUANGAN_WRITE_RESOURCES = [...KEUANGAN_RESOURCES, "reminders"];

// Halaman — bukan koleksi — yang juga hanya untuk Keuangan. Dipisah dari daftar di atas karena
// yang di sana adalah node database yang dilanggan store; Laba Rugi tidak punya node sendiri, ia
// menjumlahkan node lain.
//
// Kenapa ia harus ikut tertutup: laba bersihnya adalah pendapatan dikurangi pengeluaran, dan
// pengeluaran hanya boleh dibaca Keuangan. Dibuka untuk semua, store tidak akan pernah melanggan
// `expenses` bagi role lain — jadi halaman ini akan menampilkan pendapatan dikurangi NOL dan
// menyebutnya laba. Angka yang salah dan tidak ada tandanya di layar.
// "cashFlow" ikut di sini dengan alasan yang sama persis, dan ia menunjukkan kenapa daftar ini
// harus halaman dan bukan koleksi: halaman itu tidak punya node sendiri, ia menjumlahkan
// `roiReports` (terbuka untuk semua yang login) dengan `companyPercents` dan `invalidTraffic`
// (KEUANGAN_RESOURCES). Dibuka untuk role lain, store tidak akan pernah melanggan kedua yang
// terakhir — dan halamannya akan melaporkan Net Profit tanpa satu pun potongan lalu menyebutnya
// laba. Angka yang salah dan tidak ada tandanya di layar.
// "domainProfit" ikut dengan alasan yang persis sama: ia menjumlahkan baris yang SAMA dengan
// "cashFlow", cuma pada tingkat domain. Ketinggalan di sini, tab-nya terbuka untuk role yang tidak
// pernah melanggan `companyPercents` dan `invalidTraffic` — dan halamannya melaporkan Net Profit
// tanpa satu pun potongan lalu menyebutnya laba.
export const KEUANGAN_PAGES = ["profitLoss", "cashFlow", "domainProfit"];

// Role "guest": tamu yang cuma boleh MEMBACA ketiga laporan Accounting — dan tidak satu halaman
// lain pun, termasuk Overview yang terbuka untuk tiap akun yang login.
//
// Karena itu ada DUA pertanyaan yang jawabannya berbeda untuk role ini, dan keduanya tidak boleh
// dilebur ke satu fungsi:
//
//   canOpenPage     -> halaman mana yang boleh DIBUKA (sidebar, tab, gerbang di App): tiga ini saja.
//   canReadResource -> node mana yang boleh DILANGGAN: seluruh bahan ketiga laporan itu, termasuk
//                      KEUANGAN_RESOURCES. Dipersempit ke tiga kunci halaman, store tidak pernah
//                      melanggan `expenses`, `companyPercents`, dan `invalidTraffic` — dan halamannya
//                      melaporkan laba tanpa satu pun potongan. Alasan yang sama persis dengan
//                      KEUANGAN_PAGES di atas.
//
// Yang DIKETAHUI dan diterima: izin baca RTDB menurun per node, jadi akun tamu yang memakai SDK
// langsung bisa membaca tiap node yang dibaca ketiga halaman itu — termasuk `payouts` (nomor
// rekening) dan `expenses` — plus seluruh node yang `.read: auth != null`. Yang dijaga role ini
// adalah MENU dan HALAMANNYA, bukan isi database-nya.
export const GUEST_PAGES = ["profitLoss", "cashFlow", "domainProfit"];

// Tamu MURNI: seluruh role-nya "guest". Role tambahan di sebelahnya menambah hak, sepola dengan
// "user,keuangan" — tamu yang juga keuangan adalah keuangan.
export function isGuestOnly(role) {
  const roles = parseRoles(role);
  return roles.length > 0 && roles.every((r) => r === "guest");
}

// Halaman yang boleh dibuka. Untuk semua role selain tamu murni ini persis `canReadResource`.
export function canOpenPage(role, key) {
  if (isGuestOnly(role)) return GUEST_PAGES.includes(key);

  return canReadResource(role, key);
}

// Halaman pertama sesudah login, tujuan "/" dan tombol kembali di halaman kosong. Untuk tamu
// `/dashboard` tertutup, dan tujuan yang berakhir di "Akses ditolak" tidak punya jalan keluar.
export function homePath(role) {
  return isGuestOnly(role) ? "/profit-loss" : "/dashboard";
}

// Halaman yang HANYA untuk superadmin — tidak untuk admin, dan ini satu-satunya tempat perbedaan
// itu benar-benar berarti hari ini.
//
// Gating mengubah ke mana pengunjung sebuah campaign iklan dikirim, pada campaign yang sedang
// berjalan dan sedang membakar anggaran. Salah menekan di sini tidak menghasilkan angka yang keliru
// di tabel — ia mengalihkan trafik sungguhan, dan yang paling mahal (menggating campaign yang sudah
// di-gate) memasang gate di depan gate tanpa satu pun sistem di jalurnya yang menolak.
//
// Cerminan `.validate` pada `dashboard/gating/commands/$id/state` di database.rules.json: di sana
// perintah baru (state "pending") hanya boleh ditulis superadmin. Aturan itu yang menegakkan;
// daftar ini hanya menjaga halaman dan tombolnya tidak tampil bagi yang akan ditolak database.
//
// "plugin" berdiri di sini dengan alasan yang sejenis tapi TIDAK sama, dan bedanya perlu dibaca
// karena ia mengubah siapa yang menegakkan apa. Gating dijaga aturan database — antreannya ada di
// RTDB, jadi tombol yang lolos di layar tetap ditolak di bawah. Halaman /plugin tidak menulis
// antrean apa pun: ia memanggil server kontrol, dan yang menegakkan izinnya adalah gerbang
// superadmin di `server/plugin.js`. Daftar ini menjaga menunya; server itu yang menjaga armadanya.
//
// Kenapa superadmin dan bukan admin: tombol di halaman itu menulis kode iklan dan aturan behaviour
// ke situs yang sedang menerima trafik berbayar. Kode iklan yang salah tidak menghasilkan error di
// mana pun — ia menghasilkan pendapatan nol, dan baru terbaca di laporan GAM keesokan harinya.
//
// "otp" berdiri di sini dengan alasan yang paling langsung dari ketiganya: yang ditempel di halaman
// itu adalah secret TOTP sebuah akun — setengah dari kuncinya. Halaman itu sendiri tidak menyimpan
// apa pun (tidak ke RTDB, tidak ke localStorage), jadi tidak ada aturan database yang bisa
// menjaganya dan tidak ada server yang bisa menolak; daftar ini benar-benar satu-satunya penjaga,
// dan itu berarti ia menjaga MENU dan halamannya, bukan rahasianya. Yang memegang secret-nya tetap
// orang, di luar dashboard ini.
//
// "spending" berdiri di sini karena ISINYA, dan itu golongan yang sama dengan "otp" dan
// "activityLogs": bukan tombol yang berbahaya, melainkan halaman yang tidak boleh dibaca. Kolom
// terakhirnya adalah keputusan pemodal tentang berapa dana yang akan diberikan kepada tiap orang
// di tim, berdampingan dengan hasil tiap rekan mereka — sebuah proyeksi yang belum diputuskan dan
// sudah terbaca seluruh tim bukan lagi bahan keputusan.
//
// Kenapa superadmin dan bukan admin+keuangan seperti Laba Rugi: yang di sana laporan atas bulan
// yang sudah lewat, dan Keuangan memang harus membukanya untuk bekerja. Yang di sini rencana ke
// depan atas orang, dan tidak ada pekerjaan Keuangan yang membutuhkannya.
//
// SATU HAL YANG HARUS DISEBUT APA ADANYA: tidak seperti tiga lainnya, halaman ini tidak membaca
// satu pun node yang tertutup — `roiReports` dan `users` sudah terbuka untuk tiap akun yang login,
// jadi angkanya benar untuk siapa pun yang membukanya. Karena itu TIDAK ADA aturan database yang
// menegakkan ini: daftar ini plus `key` di resolveRoute benar-benar satu-satunya penjaganya, dan
// yang dijaga adalah PEMBAGIANNYA, bukan bahannya. Siapa pun yang boleh membaca baris ROI tetap
// bisa menghitung ulang angka yang sama sendiri.
//
// "dnsRecords" berdiri di sini karena TOMBOLNYA, dan itu golongan yang sama dengan "gating" dan
// "plugin": bukan halaman yang tidak boleh dibaca, melainkan halaman yang salah tekannya mahal.
// Menghapus satu record A membuat sebuah subdomain berhenti menjawab pada detik itu juga, dan
// trafik iklan yang sedang berjalan ke sana mendarat di nama yang tidak ada — tidak ada satu pun
// sistem di jalurnya yang akan menolak, karena DNS memang kerjanya begitu. Kegagalannya juga tenang
// dengan cara yang sama seperti kode iklan yang salah di /plugin: tidak ada error di mana pun, cuma
// pendapatan yang berhenti dan baru terbaca di laporan keesokan harinya.
//
// Seperti "plugin" dan TIDAK seperti "gating", yang menegakkannya bukan aturan database melainkan
// gerbang `requireSuperAdmin` di `server/cloudflare.js` — halaman ini tidak menulis satu pun baris
// RTDB, jadi tidak ada `.validate` yang bisa ikut menjaga. Daftar ini menjaga menunya; server itu
// yang menjaga DNS armadanya.
//
// "campaigns" berdiri di sini karena TOMBOLNYA, sekelas "plugin" dan "dnsRecords": halaman itu
// menyalin campaign Meta dan menaikkan anggaran iklan yang sedang hidup. Yang benar-benar
// menegakkannya gerbang `requireSuperAdmin` di server/campaign-manage.js.
export const SUPERADMIN_PAGES = [
  "gating",
  "plugin",
  "otp",
  "activityLogs",
  "spending",
  "dnsRecords",
  "setupSub",
  "campaigns",
];

// "activityLogs" berdiri di sini karena isinya, bukan karena tombolnya — halaman itu tidak punya
// satu pun tombol yang mengubah apa pun. Yang tersimpan di baliknya adalah alamat IP, kota, dan
// perangkat setiap orang di tim berikut jam berapa mereka membuka apa; sebuah dashboard yang
// memperlihatkan itu ke seluruh tim mengubah dirinya jadi alat pengawasan antar-rekan kerja.
// Alasannya sama persis dengan `otpSecrets`: yang dijaga adalah ISI node-nya, dan karena izin baca
// RTDB menurun, `.read` pada node itu sendiri yang menegakkannya.
//
// SATU HAL YANG TIDAK BOLEH IKUT DIKETATKAN saat membaca ini nanti: yang superadmin hanya sisi
// BACA. Sisi tulisnya tetap terbuka untuk tiap akun yang login (lewat server kontrol, yang menulis
// sebagai SYNC_USER — admin), karena jejak yang cuma menerima kiriman superadmin tidak mencatat
// satu pun orang yang aktivitasnya ingin dilihat.

// "superadmin" berdiri di atas admin, dan hak yang dibawanya hari ini PERSIS sama dengan admin —
// karena itu ia dibaca lewat isAdmin() di bawah, bukan lewat cabang izin kedua. Sebuah role yang
// terdengar lebih tinggi tapi diperiksa di tempat lain akan mewarisi setengah izin admin dan
// kehilangan setengahnya diam-diam, dan yang memegangnya tidak punya cara tahu yang mana.
//
// Daftar ini adalah nilai yang DIKENALI sistem, bukan yang ditawarkan ke layar. `normalizeRole`
// (useFirebaseAuth & useFirebaseStore) membuang role di luar daftar ini dan menjadikannya "user" —
// jadi menghapus "superadmin" dari sini akan mengunci pemegangnya keluar dari dashboardnya sendiri.
export const ROLE_OPTIONS = ["superadmin", "admin", "user", "advertiser", "keuangan", "guest"];

// Yang boleh dipilih di form Team. "superadmin" sengaja tidak ada di sini: ia tidak diberikan
// lewat dashboard, dan sebuah pilihan di dropdown adalah pengumuman bahwa role itu ada kepada
// setiap admin yang membuka form. Diberikan lewat CLI saja (functions/tools/set-role.mjs).
export const ASSIGNABLE_ROLES = ROLE_OPTIONS.filter((role) => role !== "superadmin");

// Role yang bisa DISIARI notifikasi per topik (tab Topik di /notifications). Tamu tidak: ia bukan
// anggota tim, dan yang dikirim topik-topik itu (tagihan jatuh tempo, peringatan ROI, kegagalan
// sync) adalah urusan operasional. Cerminan `.validate` pada `settings/notifications/$topic/roles`
// di database.rules.json, yang juga tidak menyebutnya — pilihan yang tampil di sini tapi ditolak di
// sana cuma berbunyi "permission denied".
export const BROADCAST_ROLES = ASSIGNABLE_ROLES.filter((role) => role !== "guest");

// Role yang berlaku sebagai admin. Cerminan `(admin|superadmin)` di setiap aturan
// database.rules.json — kalau salah satunya berubah, yang lain harus ikut.
const ADMIN_ROLES = ["superadmin", "admin"];

// Superadmin tidak ikut satu pun pemeriksaan izin di bawah: tiap fungsi menjawab `true` untuknya
// SEBELUM melihat resource yang diminta.
//
// Hari ini itu tidak mengubah satu jawaban pun — superadmin sudah lolos lewat isAdmin(), dan tidak
// ada halaman yang tertutup untuk admin. Yang dijaga adalah aturan BERIKUTNYA: begitu ada resource
// yang sengaja tidak diberikan ke admin (seperti KEUANGAN_RESOURCES dulu ditulis), superadmin akan
// ikut kehilangannya tanpa ada yang menyadari. Gerbang di sini membuat "lolos semuanya" jadi sifat
// yang tertulis, bukan kebetulan dari susunan daftar.
export function isSuperAdmin(role) {
  return hasRole(role, "superadmin");
}

export function parseRoles(role) {
  return String(role || "")
    .toLowerCase()
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
}

// Menyimpan string gabungan apa adanya tapi membuang role yang tidak dikenal; hasil kosong jadi
// "user", jawaban yang sama dengan aturan database untuk akun tanpa entri /roles.
export function normalizeRole(role) {
  const roles = parseRoles(role).filter((r) => ROLE_OPTIONS.includes(r));
  return roles.length ? roles.join(",") : "user";
}

export function hasRole(role, target) {
  return parseRoles(role).includes(target);
}

// Settings terbuka untuk dibaca dan tertutup untuk ditulis — tarif ad tax menentukan arti setiap
// ROI di layar, jadi siapa pun yang membaca ROI berhak tahu tarif yang dipakai; yang mengubahnya
// tetap admin saja (dan aturan database yang benar-benar menegakkannya).
export function canEditSettings(role) {
  if (isSuperAdmin(role)) return true;

  return isAdmin(role);
}

export function isAdmin(role) {
  return ADMIN_ROLES.some((admin) => hasRole(role, admin));
}

export function canReadResource(role, key) {
  if (isSuperAdmin(role)) return true;

  // Sebelum cabang admin, bukan sesudah: yang di daftar ini justru tertutup UNTUK admin, dan
  // pemeriksaan yang datang belakangan tidak akan pernah tercapai.
  if (SUPERADMIN_PAGES.includes(key)) return false;

  if (KEUANGAN_RESOURCES.includes(key) || KEUANGAN_PAGES.includes(key)) {
    // Tamu ikut MEMBACA (bahan ketiga laporan Accounting, lihat GUEST_PAGES), tidak pernah menulis:
    // `canWrite` tidak menyebutnya sama sekali.
    return isAdmin(role) || hasRole(role, "keuangan") || hasRole(role, "guest");
  }

  return isAdmin(role) || !ADMIN_ONLY_RESOURCES.includes(key);
}

// Writes are admin-only across the board, with one carve-out: Keuangan does full CRUD on its own
// expenses (that is the whole point of the role). Everyone else gets a read-only dashboard until
// the per-role CRUD matrix is settled (PRD §4 leaves it open).
export function canWrite(role, key) {
  if (isSuperAdmin(role)) return true;

  return isAdmin(role) || (KEUANGAN_WRITE_RESOURCES.includes(key) && hasRole(role, "keuangan"));
}

// The one exception, mirrored by the `subDomains/$id/campaignCodes` rule: advertisers register
// the Keitaro codes of the links they cut. Those codes are what attribute Meta spend to a
// subdomain, so making them wait on an admin is what leaves ROI blank. Nothing else on the row
// opens up — the rule grants this single child path.
export function canEditCampaignCodes(role) {
  if (isSuperAdmin(role)) return true;

  return isAdmin(role) || hasRole(role, "advertiser");
}

// Saklar on/off campaign di /users/{uid}. Admin boleh untuk siapa saja; selain itu hanya orang
// yang campaign-nya sendiri — "campaign yang dia kelola" secara harfiah.
//
// Dicocokkan lewat email, bukan uid, karena /users dikunci push-key: aturan database tidak punya
// cara menemukan baris user berdasarkan auth.uid (lihat catatan di src/lib/firebaseRepository.js),
// jadi `auth.token.email` adalah satu-satunya tali yang menghubungkan akun yang login dengan baris
// profilnya. Cerminan aturan `users/$uid/campaignCommands` di database.rules.json — kalau salah
// satunya berubah, yang lain harus ikut, kalau tidak tombolnya tampil lalu ditolak database.
export function canToggleCampaign(role, profileEmail, viewerEmail) {
  if (isSuperAdmin(role)) return true;

  if (isAdmin(role)) {
    return true;
  }

  const owner = String(profileEmail || "")
    .trim()
    .toLowerCase();
  const viewer = String(viewerEmail || "")
    .trim()
    .toLowerCase();
  return Boolean(owner) && owner === viewer;
}

/**
 * Tombol Gate/Ungate di halaman /vi-control. Superadmin saja.
 *
 * Berdiri sendiri dan tidak lewat `canWrite`: gating bukan resource yang di-CRUD — tidak ada baris
 * yang dibuat, diubah, atau diarsipkan. Yang ditulis tombolnya adalah satu NIAT ke antrean
 * (`dashboard/gating/commands`), dan yang benar-benar memanggil vi-control adalah fungsi terjadwal
 * di sisi server, yang memegang API key-nya.
 */
export function canGateCampaign(role) {
  return isSuperAdmin(role);
}

/**
 * Tombol-tombol di halaman /plugin (enroll, simpan pengaturan, terapkan massal). Superadmin saja.
 *
 * Berdiri sendiri seperti `canGateCampaign` dan bukan lewat `canWrite`, karena yang diubahnya bukan
 * resource yang di-CRUD: tidak ada baris yang dibuat atau diarsipkan di dashboard ini. Yang ditulis
 * tombolnya adalah pengaturan di database WordPress situs lain, lewat server kontrol.
 *
 * SATU perbedaan penting dari gating yang tidak boleh dilupakan saat membaca fungsi ini: gating
 * punya antrean RTDB sebagai jalur cadangan, jadi tombolnya tetap berguna walau server mati. Di
 * sini tidak ada cadangan — enroll token dan api_key tiap situs tinggal di server, dan situsnya
 * sendiri tidak akan menjawab browser (tidak ada header CORS untuk origin dashboard). Server mati
 * berarti halaman ini benar-benar tidak bisa melakukan apa pun, dan halamannya mengatakan begitu
 * alih-alih menggambar tombol yang akan gagal.
 */
export function canManagePlugin(role) {
  return isSuperAdmin(role);
}

/**
 * Halaman Notification Center: siapa yang boleh mengubah SETELAN BERSAMA-nya.
 *
 * Halamannya sendiri terbuka untuk tiap akun yang login, dan itu inti fiturnya — saklar "saya mau
 * menerima apa" tidak berarti apa-apa kalau yang bisa membukanya cuma admin. Yang dijaga fungsi ini
 * cuma bagian yang menyangkut orang lain: saklar per topik, siaran per role, daftar grup, dan
 * saklar milik anggota tim yang lain.
 *
 * Cerminan aturan `notificationGroups` dan `settings` di database.rules.json (admin). Saklar milik
 * SENDIRI tidak lewat sini — yang mengizinkannya aturan `users/$uid/notificationTopics`, dicocokkan
 * lewat email persis seperti `canToggleCampaign`.
 */
export function canManageNotifications(role) {
  if (isSuperAdmin(role)) return true;

  return isAdmin(role);
}

// Target earning: dibaca semua akun login, ditulis admin + keuangan (aturan database yang
// menegakkannya; ini hanya menyembunyikan input dari yang tak berhak).
export function canWriteTargets(role) {
  if (isSuperAdmin(role)) return true;

  return isAdmin(role) || hasRole(role, "keuangan");
}

// Kalimat yang tepat untuk halaman yang ditolak. Sebelumnya satu kalimat untuk semua ("hanya
// untuk admin"), yang keliru begitu ada halaman milik Keuangan — dan orang yang sebenarnya
// berhak akan berhenti mencoba karena pesannya bilang ia tidak berhak.
export function accessDeniedReason(key, role) {
  if (isGuestOnly(role) && !GUEST_PAGES.includes(key)) {
    return "Akun tamu hanya bisa membuka Laba Rugi, Cash Flow, dan Laba per Domain.";
  }

  if (SUPERADMIN_PAGES.includes(key)) {
    return "Halaman ini hanya untuk superadmin.";
  }

  if (KEUANGAN_RESOURCES.includes(key) || KEUANGAN_PAGES.includes(key)) {
    return "Halaman ini hanya untuk admin dan keuangan.";
  }

  return "Halaman ini hanya untuk admin.";
}
