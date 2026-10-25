export const firebasePaths = {
  users: "users",
  domains: "domains",
  subDomains: "subDomains",
  adAccounts: "adAccounts",
  // Dua koleksi, dua API. gamAccounts = network Ad Manager, adsenseAccounts = akun AdSense
  // berdiri sendiri. Yang lama dulu bernama adsenseAccounts padahal isinya network GAM.
  gamAccounts: "gamAccounts",
  adsenseAccounts: "adsenseAccounts",
  googleApiConfigs: "googleApiConfigs",
  expenses: "expenses",
  /**
   * Invalid traffic per domain per bulan — potongan Google atas trafik yang dinilai tidak sah.
   *
   * Diinput orang, tidak bisa disync: angkanya baru muncul di laporan Ad Manager beberapa hari
   * sesudahnya dan tidak punya dimensi yang bisa diminta per hari. Ia berdiri sebagai koleksi
   * sendiri (bukan kolom di `domains`) karena nilainya berganti tiap bulan, dan sebuah kolom yang
   * ditimpa tiap bulan akan menghapus riwayat bulan sebelumnya — bulan lampau di halaman Laba
   * Rugi akan ikut berubah tiap kali angka bulan ini diperbarui.
   */
  invalidTraffic: "invalidTraffic",
  /**
   * Biaya penyambungan domain ke Ad Exchange — satu baris per penyambungan (tanggal + company),
   * bukan satu nilai per domain.
   *
   * Koleksi sendiri dan bukan kolom di `domains` dengan alasan yang sama persis seperti
   * `invalidTraffic`: satu domain disambungkan berkali-kali ke company yang berbeda-beda, dan
   * sebuah kolom yang ditimpa tiap penyambungan menghapus biaya yang sudah dibayar sebelumnya.
   *
   * Diinput orang dan tidak bisa disync: tidak ada satu pun API yang tahu berapa yang dibayar ke
   * Holuron LLC untuk sebuah link.
   */
  adxCosts: "adxCosts",
  /**
   * Tarif Potongan Company Ad Exchange per domain, BERIKUT tanggal mulai berlakunya — satu baris
   * per (domain, tanggal), bukan satu nilai per domain.
   *
   * Ia pindah dari kolom `domains.companyPercent`, dan alasannya sama persis dengan dua koleksi di
   * atasnya: sebuah kolom yang ditimpa tiap kali tarifnya berubah menghitung ulang seluruh bulan
   * lampau dengan tarif hari ini — laba Juni yang sudah dilaporkan berubah sendiri tanpa satu pun
   * baris yang disunting.
   */
  companyPercents: "companyPercents",
  /**
   * Tarif bonus advertiser per orang, BERIKUT bulan mulai berlakunya — pola dan alasan yang sama
   * dengan `companyPercents`. Lihat src/lib/bonusPercent.js.
   */
  bonusPercents: "bonusPercents",
  /**
   * Pencairan earning Google ke rekening — satu baris per (domain, bulan).
   *
   * Koleksi sendiri dan bukan turunan dari `roiReports`: yang disimpannya justru yang TIDAK ada di
   * laporan mana pun — saldo sisa bulan sebelumnya, angka notifikasi pembayaran, fee rekening
   * perantara, potongan konversi mata uang, dan rekening tujuannya. Sisi hitungannya (earning,
   * potongan Company, invalid traffic) diturunkan saat dirender dan tidak ikut tersimpan, sepola
   * dengan kolom otomatis `invalidTraffic`.
   */
  payouts: "payouts",
  accountCloses: "accountCloses",
  whitelistTopup: "whitelistTopup",
  reminders: "reminders",
  /**
   * Riwayat yang cuma dibaca dua layar: campaignHistory, countryRoi, dailySpend, balanceSnapshots
   * — satu cabang per user.
   *
   * Pindah dari bawah `users/{id}`, dan sebabnya biaya bacaan. `users` dilanggan SETIAP akun pada
   * SETIAP muat halaman (ia yang memberi nama, PIC, dan baris campaign ke hampir tiap layar), dan
   * keempat riwayat ini 2,81 MB dari 3,12 MB node itu — jadi orang yang cuma membuka Domains
   * mengunduh riwayat spend campaign 90 hari milik lima advertiser untuk menggambar tabel domain.
   * Yang membacanya cuma panel-panel di `/users/{id}` dan rincian negara di tab "Laporan ROI
   * Realtime" (`countryRoi`, lewat `buildCountryBreakdown` yang menyisir seluruh user).
   * Yang tidak terlihat di angka muat halaman: `countryRoi` (745 KB) ditulis ulang UTUH tiap sync,
   * jadi selama ia tinggal di `users`, tiap tab yang dibiarkan terbuka menerima 745 KB delta per
   * jam untuk panel yang tidak sedang digambar.
   *
   * Dilanggan lewat `useStickyValue` seperti `roiSnapshots`, dan yang memutuskan kapan
   * `needsUserReports` di lib/heavyData.js — bukan aturan database: `userReports` sengaja
   * seterbuka `users` (tiap akun yang login boleh membacanya), karena memisahkan data bukan
   * menutupnya dan panel yang membacanya memang terbuka untuk semua.
   */
  userReports: "userReports",
  domainTargets: "domainTargets",
  dashboardStats: "dashboard/stats",
  weeklyFinancials: "dashboard/weeklyFinancials",
  advertiserSpend: "dashboard/advertiserSpend",
  roiReports: "dashboard/roiReports",
  // Satu baris per SYNC (tanggal + jam + subdomain) untuk tabel "Laporan ROI Realtime" di Overview.
  // Terpisah dari roiReports — yang di sana satu baris per hari dan boleh dijumlahkan, yang di sini
  // kumulatif sejak tengah malam dan tidak boleh.
  roiSnapshots: "dashboard/roiSnapshots",
  roiSettings: "settings/roi",
  /**
   * Ambang peringatan ROI — dibaca `scheduledSync`, diisi admin di tab Peringatan ROI halaman
   * Notification Center (pindah dari Settings: "berapa ambangnya" dan "siapa yang dikabari" adalah
   * satu pertanyaan, dan selama keduanya berjauhan, ambang yang menyala tanpa penerima adalah
   * keadaan yang tidak terlihat di layar mana pun).
   *
   * Di `settings` bersama tarif ad tax dan chat Telegram, bukan di env: ambang berubah karena
   * keputusan (biaya iklan naik, target margin bergeser), dan keputusan tidak boleh butuh deploy.
   * Yang TIDAK boleh ikut ke sini tetap token botnya — ia secret Cloud Functions, karena `settings`
   * terbaca setiap akun yang login.
   */
  alertSettings: "settings/alerts",
  /**
   * Chat tujuan notifikasi yang TIDAK punya baris di Team: grup, channel, dan chat pribadi orang di
   * luar tim (pemilik, akuntan, teknisi yang dipanggil saat sync tumbang).
   *
   * Koleksi sendiri dan bukan di `settings`: jumlahnya bertambah dan berkurang seperti data biasa,
   * dan tiap barisnya punya saklar per topik. Yang berbentuk anggota tim TIDAK di sini melainkan di
   * baris `users`-nya sendiri (`telegramChatId` + `notificationTopics`) — satu orang, satu baris,
   * supaya chat id yang berubah tidak harus dibetulkan di dua tempat.
   *
   * Node tujuan yang LAMA (`settings/telegram/chatIds`, satu teks berisi semua id) sudah tidak
   * dibaca satu baris kode pun — tidak di sini, tidak di `functions/`. Ia dibiarkan berdiri di RTDB
   * apa adanya: yang dihapus tidak bisa dibaca kembali oleh siapa pun yang perlu tahu chat mana saja
   * yang dulu menerima.
   */
  notificationGroups: "notificationGroups",
  /**
   * Chat yang menyapa bot dan belum jadi penerima — daftar TAWARAN, bukan daftar tujuan.
   *
   * Ditulis cron di server (`functions/sync-telegram-inbox.mjs`), dibaca tab "Calon Penerima" di
   * Notification Center. Di bawah `dashboard` dan bukan koleksi berkunci push seperti
   * `notificationGroups`, karena kuncinya BUKAN push key melainkan turunan chat id
   * (`inboxChatKey`): pesan kedua dari orang yang sama harus mendarat di baris yang sama, dan push
   * key baru tiap kali berarti satu baris tawaran per pesan yang pernah dikirim orang itu.
   *
   * Yang tersimpan cuma identitas chat-nya — id, nama, username. TIDAK isi pesannya: `dashboard`
   * terbaca setiap akun yang login, dan orang yang mengetik sesuatu ke bot tidak sedang
   * menerbitkannya ke seluruh tim.
   */
  telegramInbox: "dashboard/telegramInbox/chats",
  /**
   * Setelan per topik: saklar globalnya dan role yang disiarkan.
   *
   * Di `settings` (dibaca semua akun yang login, ditulis admin) bersama tarif ad tax dan ambang
   * peringatan, alasan yang sama dengan keduanya: siapa yang menerima apa berubah karena orang
   * masuk/keluar tim, dan itu tidak boleh butuh deploy. Yang TIDAK boleh ikut ke sini tetap token
   * botnya — ia secret Cloud Functions.
   */
  notificationSettings: "settings/notifications",
  syncStatus: "dashboard/syncStatus",
  syncRuns: "dashboard/syncRuns",
  // Kegagalan per-akun dari run terakhir tiap modul sync. Dibaca ikon peringatan di topbar —
  // sebelumnya kegagalan seperti ini hanya ada di log Cloud Function.
  syncIssues: "dashboard/syncIssues",
  // Yang sedang diantre untuk dicoba lagi — akun GAM/Meta maupun situs plugin, cabangnya bernama
  // sama dengan cabang syncIssues. Dibaca indikator "sedang mencoba lagi" di topbar.
  syncRetries: "dashboard/syncRetries",
  // Gating campaign Keitaro. Lima node di bawah satu cabang, karena kelimanya ditulis run yang
  // sama dan hanya berarti kalau dibaca bersama: baris campaign tanpa `mirroredAt` di sebelahnya
  // tidak bisa dibedakan dari baris basi. Cerminan `GATING_PATH` di functions/gating-core.js.
  gateCampaigns: "dashboard/gating/campaigns",
  gatePreviews: "dashboard/gating/previews",
  gateRuns: "dashboard/gating/runs",
  gateCommands: "dashboard/gating/commands",
  gateStatus: "dashboard/gating/status",
  // Stempel "tolong segarkan sekarang". Tombolnya tidak bisa memanggil apa pun secara langsung
  // (DRS memblokir `allUsers`, dan API key vi-control tidak boleh sampai ke browser), jadi yang
  // bisa ia lakukan hanya menaruh waktu di sini — run terjadwal berikutnya yang membacanya.
  gateRefreshRequest: "dashboard/gating/refreshRequestedAt",
  /**
   * Cermin status plugin RabbitROI per subdomain — TANPA api_key.
   *
   * Kuncinya tinggal di `pluginKeys`, node terpisah yang tidak pernah dilanggan satu pun kode di
   * sini. Izin baca RTDB menurun: digabung jadi satu node, tiap superadmin yang membuka halaman
   * /plugin akan mengunduh seluruh api_key armada ke browsernya hanya untuk melihat kolom "Versi".
   * Cerminan `PLUGIN_SITES_PATH` di functions/plugin-core.js.
   */
  pluginSites: "pluginSites",
  // Job salinan campaign dari halaman /campaigns — ditulis server kontrol, dilanggan superadmin.
  // Cerminan `COPY_JOBS_PATH` di functions/campaign-manage-core.js.
  campaignCopyJobs: "dashboard/campaignCopyJobs",
  // Job buat campaign dari halaman yang sama. Cerminan `CREATE_JOBS_PATH` di
  // functions/campaign-create-core.js.
  campaignCreateJobs: "dashboard/campaignCreateJobs",
  /**
   * Daftar negara yang disimpan advertiser untuk dipakai ulang di dialog Buat campaign.
   *
   * BUKAN di bawah `users`, dan itu bukan kerapian: node itu dilanggan tiap muat halaman setiap akun
   * (ia memberi nama, PIC, dan baris campaign ke hampir tiap layar), jadi preset yang menumpang di
   * sana akan diunduh SEMUA ORANG untuk dialog yang cuma bisa dibuka superadmin.
   */
  countryPresets: "dashboard/countryPresets",
  /**
   * Template ukuran slot GPT yang disimpan dari tab AdX di /plugin.
   *
   * Node sendiri di bawah `dashboard`, dilanggan bersama cermin status plugin — satu-satunya layar
   * yang membacanya ada di halaman itu, dan menumpang node yang dilanggan semua orang berarti tiap
   * akun mengunduhnya untuk tab yang cuma bisa dibuka superadmin.
   */
  gptSizeTemplates: "dashboard/gptSizeTemplates",
  /**
   * Kode unit AdSense yang terakhir di-inject ke tiap subdomain, berkunci ID subdomain — tab AdSense di
   * /plugin mengisi form dari sini, jadi inject ulang tidak perlu menempel lagi.
   *
   * Superadmin, sepola template GPT. Slot AdSense tidak bisa dibaca balik dari situs tanpa menghubungi
   * WordPress-nya satu per satu, dan tidak bisa dibuat lewat API — kode yang sudah ditempel orang
   * adalah satu-satunya salinannya di dashboard.
   */
  adsenseSlots: "dashboard/adsenseSlots",
  // Daftar URL cloaking untuk landing "Buat dari preset" di /plugin — server kontrol memilih satu
  // secara acak dan menuliskannya ke landing yang baru lahir. Cerminan `CLOAKING_URLS_PATH` di
  // functions/sync-plugin.mjs.
  cloakingUrls: "dashboard/cloakingUrls",
  /**
   * Secret TOTP akun yang 2FA-nya dipegang bersama, untuk halaman /otp.
   *
   * SUPERADMIN SAJA di kedua arah — satu-satunya node dengan `.read` sekeras itu, dan alasannya
   * sama dengan `pluginKeys`: izin baca RTDB menurun, jadi node inilah satu-satunya tempat isinya
   * bisa dijaga. Secret TOTP adalah setengah dari kunci sebuah akun; tersimpan di bawah `users`
   * atau `adAccounts`, ia ikut terbaca setiap orang yang boleh membaca koleksi itu.
   *
   * Tidak dienkripsi, sepola dengan `pluginKeys` dan `passwordAkun`: yang dijaga aturan database,
   * bukan sandi kedua yang hilang bersama orang yang menyimpannya.
   */
  otpSecrets: "otpSecrets",
  // Jejak aktivitas TIDAK di sini: sejak pindah ke SQLite di server kontrol (server/activity-db.js),
  // browser tidak menyentuh RTDB untuk itu sama sekali — dibaca lewat GET /activity-logs. Lihat
  // src/hooks/useActivityLogs.js.
};
