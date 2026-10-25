// Menu sidebar. Dua lapis, dan lapis keduanya BUKAN submenu yang mengembang di sidebar melainkan
// tab di dalam halamannya:
//
//   item tanpa `parent`  -> satu baris di sidebar
//   item dengan `parent` -> tab di kepala halaman induknya, tidak pernah tampil di sidebar
//
// Alasannya ruang. Sidebar sebelumnya memuat 19 baris untuk superadmin — 1015px di rail yang tidak
// bisa digulir, jadi Settings dan Activity Logs benar-benar tidak bisa diklik di layar laptop.
// Submenu yang mengembang tidak menolong: yang dibuka tetap menambah tinggi, dan yang tertutup
// menyembunyikan halaman di balik satu klik tambahan tanpa mengurangi baris saat dibuka.
//
// Yang dijadikan tab hanya yang memang satu bacaan dengan induknya:
//
//   Cash Flow -> Accounting. Rantai yang SAMA dengan induknya, dipecah sampai ke baris
//     penyusunnya (per advertiser per jenis akun per subdomain). Bukan halaman kedua melainkan
//     rincian dari kolom yang sama, dan satu-satunya tab lain di grup ini yang isinya laporan
//     alih-alih input.
//   Pencairan -> Accounting. Rantai yang sama, DILANJUTKAN sampai rekening: Laba Rugi berhenti di
//     laba, halaman itu meneruskannya lewat saldo sisa bulan lalu, sunat Google, fee rekening
//     perantara, dan potongan konversi. Bahannya pun sama (earning, tarif Company, invalid
//     traffic bulan itu), jadi yang diperbaiki di tab sebelah diperbaiki untuk halaman ini juga.
//   Invalid Traffic -> Accounting. Input untuk rantai di halaman itu (potongan per domain per
//     bulan); tidak ada orang yang membukanya untuk alasan lain.
//   Potongan Company -> Accounting. Tarif bagi hasil per domain berikut tanggal berlakunya; yang
//     membacanya cuma baris "Potongan Company Ad Exchange" di rantai halaman induknya. Sempat jadi
//     kolom di /domains dan pindah ke sini bersama riwayat tanggalnya.
//   Cost Ad Exchange -> Accounting. Biaya menyambungkan domain ke Ad Exchange. Ia MASUK rantai Laba
//     Rugi lewat baris Pengeluaran operasional (lihat resources.js), dan yang menyatukannya dengan
//     induknya bukan cuma perhitungan itu melainkan pertanyaannya: keduanya biaya yang dibayar ke
//     pihak luar atas sebuah domain.
//   Expenses -> Accounting. Baris-baris yang menjadi "Pengeluaran operasional" di rantai itu.
//     Sebelumnya barisnya sendiri di sidebar, dan itu meninggalkan halaman yang angkanya cuma
//     berarti sebagai bagian dari Laba Rugi berdiri sejauh dua baris dari tempat angka itu dibaca.
//   Whitelist Top-Up -> Accounting. Setoran ke akun whitelist berikut fee-nya, yang tampil sebagai
//     catatan di Laba Rugi. Sempat berdiri di bawah Ad Accounts (tempat akunnya dikelola) dan
//     kembali ke sini: yang dicari orang di baris top-up adalah uangnya, bukan akunnya — dan
//     seluruh uang tim ini sekarang punya satu induk.
//   Sub Domains -> Domains. Induk dan anak dari data yang sama.
//   Google API -> Settings. Sama-sama konfigurasi yang disentuh sekali lalu didiamkan.
//
// Reminder SEMPAT jadi tab di bawah Target dan dikembalikan jadi barisnya sendiri: halaman yang
// dicari orang justru saat ia teringat ada tagihan, dan yang dicari dengan cara begitu harus
// terbaca dari sidebar tanpa menebak ada apa di balik baris lain.
//
// GAM dan AdSense SENGAJA tidak digabung, walau terlihat paling mirip dari semuanya. Koleksi,
// halaman, dan cabang `dashboard/syncIssues/{gamAccounts,adsenseAccounts}` bernama sama supaya
// ikon peringatan sync menunjuk halaman yang benar (lihat CLAUDE.md); satu halaman bertab memutus
// lapis tengah itu. Yang membedakan keduanya di layar adalah ikonnya, bukan penggabungannya.
//
// `label` di induk yang punya tab harus menyebut isi tab-nya kalau keduanya bukan hal yang sama —
// baris sidebar adalah satu-satunya tempat orang mencari halaman yang tidak lagi punya barisnya
// sendiri. Kalau itu terasa dipaksakan, itu tanda penggabungannya yang salah, bukan labelnya.
export const navItems = [
  // Overview sendiri sudah memuat enam panel — kartu ringkasan, tiga grafik, dan dua tabel yang
  // masing-masing punya pemilih periodenya sendiri. Dipecah jadi tab, dengan aturan yang sama
  // seperti tab lain di dashboard ini: tiap tab adalah ROUTE sungguhan, jadi filter yang tinggal
  // di alamat ikut kembali bersama tombol Back.
  { path: "/dashboard", label: "Overview", key: "dashboard", group: "Ringkasan", tab: "Ringkasan" },
  { path: "/dashboard/grafik", label: "Grafik", key: "dashboard", parent: "/dashboard" },
  { path: "/dashboard/roi", label: "Laporan ROI", key: "dashboard", parent: "/dashboard" },
  // Kalender berdiri PALING KANAN, sesudah tiga tab yang sudah jadi kebiasaan orang: ia menjawab
  // pertanyaan yang datang belakangan ("hari itu kenapa"), bukan yang dibuka tiap pagi.
  { path: "/dashboard/kalender", label: "Kalender", key: "dashboard", parent: "/dashboard" },
  // Terjadwal menjawab pertanyaan yang diajukan SEBELUM menjadwalkan ("jam berapa yang masih
  // kosong"), dan terbuka untuk setiap yang boleh membuka Overview: gunanya justru supaya tiap
  // advertiser melihat jadwal rekannya.
  { path: "/dashboard/terjadwal", label: "Terjadwal", key: "dashboard", parent: "/dashboard" },

  // Rasio penayangan Ad Exchange per jam: kapan request naik dan apakah rasio yang dipenuhi Google
  // turun di jam yang sama. Datanya ditarik server kontrol tiap 10 menit (functions/sync-fill-rate.mjs).
  {
    path: "/dashboard/rasio-penayangan",
    label: "Rasio Penayangan",
    key: "dashboard",
    parent: "/dashboard",
  },

  // Label sidebar "Accounting" menaungi tujuh tab yang semuanya uang; `tab` tetap "Laba Rugi" karena
  // yang dibuka tab pertama memang laporan itu sendiri, bukan seluruh isi grupnya — dan kepala
  // halamannya menyebut nama yang sama.
  {
    path: "/profit-loss",
    label: "Accounting",
    key: "profitLoss",
    group: "Keuangan",
    tab: "Laba Rugi",
  },
  {
    // Rantai yang SAMA dengan induknya, dipecah sampai ke baris penyusunnya: satu baris per
    // advertiser per jenis akun per subdomain. Itu yang menjadikannya tab dan bukan barisnya
    // sendiri — bacaannya satu (siapa menghasilkan berapa bulan ini), periodenya sama-sama bulan
    // kalender, dan izinnya sama persis dengan induknya lewat KEUANGAN_PAGES.
    //
    // Berdiri TEPAT SESUDAH Laba Rugi, sebelum kelima tab input: ia satu-satunya tab lain di sini
    // yang isinya laporan, dan menaruhnya di ujung kanan berarti orang harus melewati lima halaman
    // input untuk mencapai rincian dari angka yang baru saja dibacanya.
    path: "/cash-flow",
    label: "Cash Flow",
    key: "cashFlow",
    parent: "/profit-loss",
  },
  {
    // Rantai yang sama lagi, pada TINGKAT ketiga: Laba Rugi menjawabnya untuk seluruh usaha, Cash
    // Flow per subdomain, dan yang ini per domain — tingkat yang dipakai orang saat menagih bagi
    // hasil, karena kesepakatan Potongan Company dan pencairan rekening keduanya berdiri per
    // domain. Bacaannya satu dengan induknya, periodenya sama-sama bulan kalender, dan izinnya
    // sama persis lewat KEUANGAN_PAGES.
    //
    // Berdiri tepat sesudah Cash Flow: ketiga tab laporan berderet dari yang paling luas ke yang
    // paling rinci, dan yang di sebelah kanannya sudah tab input.
    //
    // Sheet acuannya bernama "% Advertiser", dan label itu TIDAK dipakai: yang dibaca orang di
    // kepala halaman adalah labanya, sementara persentase cuma cara membaginya — dan tab bernama
    // persen berdiri di antara delapan tab yang semuanya menyebut isinya.
    path: "/domain-profit",
    label: "Laba per Domain",
    key: "domainProfit",
    parent: "/profit-loss",
  },
  {
    // Ujung rantai yang sama, satu langkah lebih jauh daripada Laba Rugi: yang di sana berhenti di
    // laba, yang di sini melanjutkannya sampai angka yang benar-benar mendarat di rekening. Tab dan
    // bukan barisnya sendiri karena bahannya pun sama — earning, tarif Company, dan invalid traffic
    // bulan itu — dan izinnya sama persis dengan induknya lewat KEUANGAN_RESOURCES.
    //
    // Berdiri sesudah kedua tab laporan dan sebelum kelima tab input: ia campuran keduanya (empat
    // angka diketik, delapan kolom diturunkan), dan tempatnya persis di batas itu.
    path: "/payouts",
    label: "Pencairan",
    key: "payouts",
    parent: "/profit-loss",
  },
  {
    // Laba rugi domain yang akunnya DITUTUP Google, diketik — satu-satunya tempat angka earning
    // diketik di seluruh dashboard ini, karena sumbernya benar-benar sudah tidak ada: network GAM
    // yang ditutup tidak menjawab `reports:run` lagi, dan `roiReports` tidak memuat satu baris pun
    // atas namanya. Berdiri tepat sesudah Pencairan karena di situlah sebuah domain ditandai
    // "Account Close"; barisnya di sini melengkapi tanda itu dengan angkanya.
    path: "/account-closes",
    label: "Akun Ditutup",
    key: "accountCloses",
    parent: "/profit-loss",
  },
  {
    path: "/invalid-traffic",
    label: "Invalid Traffic",
    key: "invalidTraffic",
    parent: "/profit-loss",
  },
  {
    // Alamatnya `/adx-costs` dan bukan `/profit-loss/adx`: `resolveRoute` mencocokkan
    // `^{path}/([^/]+)$` sebagai halaman detail, tapi `/profit-loss` bukan salah satu `resources`
    // dan tidak punya regex itu — jadi yang menahan di sini bukan tabrakan melainkan aturan yang
    // sama untuk semua tab di dashboard ini: tab adalah route sungguhan dengan alamatnya sendiri,
    // sepola dengan /invalid-traffic tepat di atasnya.
    path: "/adx-costs",
    label: "Cost Ad Exchange",
    key: "adxCosts",
    parent: "/profit-loss",
  },
  {
    // Tarif Potongan Company Ad Exchange berikut tanggal berlakunya — pindah dari kolom % Company
    // di halaman Domains. Ia tab DI SINI dan bukan di bawah Domains karena yang membacanya cuma
    // satu rantai: baris "Potongan Company Ad Exchange" di Laba Rugi, dua tab di sebelah kiri. Di
    // bawah Domains ia akan berdiri di antara data aset yang dibaca seluruh tim, sementara isinya
    // adalah tarif bagi hasil — dan izinnya memang lebih ketat daripada Domains.
    path: "/company-percents",
    label: "Potongan Company",
    key: "companyPercents",
    parent: "/profit-loss",
  },
  { path: "/bonus-percents", label: "Tarif Bonus", key: "bonusPercents", parent: "/profit-loss" },
  // Izinnya sama persis dengan induknya (admin + Keuangan lewat KEUANGAN_RESOURCES/KEUANGAN_PAGES),
  // jadi tidak ada role yang melihat induknya tanpa tab ini atau sebaliknya.
  { path: "/expenses", label: "Expenses", key: "expenses", parent: "/profit-loss" },
  {
    // Izin tab ini juga sama dengan induknya. Ia sempat berdiri di bawah Ad Accounts, dan yang
    // dibayar karenanya adalah advertiser biasa membuka Ad Accounts dengan satu tab yang tidak bisa
    // ia baca — `pageTabs` menyaringnya, tapi yang tersisa cuma satu tab, yaitu bukan tab sama
    // sekali. Di sini induk dan anak selalu terbuka bersamaan.
    path: "/whitelist-topup",
    label: "Whitelist Top-Up",
    key: "whitelistTopup",
    parent: "/profit-loss",
  },
  { path: "/reminders", label: "Reminder", key: "reminders", group: "Keuangan" },
  { path: "/targets", label: "Target", key: "targets", group: "Keuangan" },

  // Barisnya sendiri, bukan tab di bawah Laba Rugi — walau keduanya sama-sama uang. Laba Rugi
  // menjawab "bulan kemarin menghasilkan berapa" dari satu bulan kalender; halaman ini menjawab
  // "dana besok dibagi ke siapa" dari rentang tanggal yang dipilih bebas. Periodenya berbeda bentuk
  // (bulan vs rentang), jadi satu kepala halaman harus memuat dua pemilih periode yang tidak pernah
  // berlaku bersamaan — dan tab yang mengganti arti kontrol di atasnya adalah cara tercepat membuat
  // orang membaca angka periode yang salah.
  //
  // Izinnya juga lebih ketat daripada Laba Rugi (superadmin vs admin+keuangan), dan itu sendiri
  // sudah cukup: test di bawah menjaga tab agar tidak lebih TERBUKA daripada induknya, tapi tab
  // yang lebih TERTUTUP punya masalahnya sendiri — Keuangan akan melihat kepala halaman dengan
  // satu tab yang tidak bisa ia buka.
  //
  // Tetap di grup Keuangan walau halamannya SUPERADMIN saja (SUPERADMIN_PAGES), sepola dengan
  // "plugin" yang berdiri di grup Aset: grup menamai isi halaman, bukan siapa yang boleh
  // membukanya — dan `sidebarItems` sudah menyaring barisnya lewat `canRead`, jadi Keuangan tidak
  // pernah melihat grupnya bertambah satu baris yang tidak bisa ia buka.
  { path: "/proyeksi-budget", label: "Proyeksi Budget", key: "spending", group: "Keuangan" },

  // Tanpa tab lagi sejak Whitelist Top-Up pindah ke Accounting, jadi labelnya kembali menyebut satu
  // isi saja: aturan di kepala berkas ini menuntut label induk menyebut isi tab-nya, dan "& WL"
  // untuk halaman yang tidak lagi memuat WL adalah nama yang salah.
  { path: "/ad-accounts", label: "Ad Accounts", key: "adAccounts", group: "Aset" },
  // Superadmin saja (SUPERADMIN_PAGES). Barisnya sendiri, bukan tab di bawah Ad Accounts: isinya
  // meja kerja atas campaign seluruh armada — salin, anggaran, targeting — bukan daftar akun.
  // Dua tab karena isinya dua pertanyaan yang tidak pernah ditanyakan bersamaan: "campaign apa saja
  // yang ada" (tabel armada, ratusan baris) dan "apa yang sedang berjalan" (pekerjaan, habis sendiri).
  // Panel Pekerjaan dulu berdiri di atas tabelnya dan mendorongnya turun tiap kali ada job — yang
  // tergeser keluar layar justru yang dibuka orang tiap hari.
  {
    path: "/campaigns",
    label: "Campaign",
    key: "campaigns",
    group: "Aset",
    tab: "Daftar Campaign",
  },
  { path: "/campaigns/pekerjaan", label: "Pekerjaan", key: "campaigns", parent: "/campaigns" },
  { path: "/gam-accounts", label: "GAM", key: "gamAccounts", group: "Aset" },
  { path: "/adsense-accounts", label: "AdSense", key: "adsenseAccounts", group: "Aset" },
  { path: "/domains", label: "Domains", key: "domains", group: "Aset" },
  { path: "/sub-domains", label: "Sub Domains", key: "subDomains", parent: "/domains" },
  {
    // Record DNS Cloudflare tiap domain. Tab di bawah Domains karena bacaannya satu dengan
    // induknya — sebuah zona Cloudflare ADALAH sebuah domain, dan yang dijawabnya ("nama ini
    // menunjuk ke mana") adalah pertanyaan yang dibawa orang ke halaman itu.
    //
    // Ia tab yang LEBIH KETAT daripada induknya, dan itu dibolehkan — yang dilarang arah
    // sebaliknya (tab yang lebih terbuka daripada induk yang tersembunyi tidak punya jalan sama
    // sekali). Preseden yang sama: "Calon Penerima" di /notifications, yang juga membawa key-nya
    // sendiri supaya alamat yang diketik tangan tidak membukanya untuk siapa saja.
    //
    // Yang membuatnya tidak mengulangi masalah Whitelist Top-Up di bawah Ad Accounts — induk yang
    // tersisa satu tab, yaitu bukan tab sama sekali: /domains sudah punya Sub Domains, jadi yang
    // bukan superadmin tetap melihat dua tab.
    //
    // Kenapa superadmin: tombolnya mengubah ke mana sebuah domain menunjuk, dan satu record A yang
    // dihapus membuat subdomainnya berhenti menjawab seketika — sekelas /plugin, dan tanpa satu
    // pun aturan database yang bisa ikut menjaganya (halaman ini tidak menulis ke RTDB sama
    // sekali). Yang menegakkannya gerbang di server/cloudflare.js.
    path: "/dns-records",
    label: "DNS Record",
    key: "dnsRecords",
    parent: "/domains",
  },
  { path: "/vi-control", label: "VI Control", key: "gating", group: "Aset" },
  // Tiga tab, sepola Campaign: "situs mana saja yang terhubung dan bagaimana keadaannya" (daftar
  // armada), lalu inject kode iklan AdX dan AdSense. Ketiganya tidak pernah ditanyakan bersamaan —
  // dan generator yang berdiri di atas daftar mendorong tabel armada keluar layar pertama, padahal
  // tabel itu yang dibuka tiap hari. AdX dan AdSense TAB SENDIRI-SENDIRI, bukan dua mode di satu tab:
  // alurnya berbeda dari akarnya (tag AdX disusun dari unit yang dibaca Ad Manager, kode AdSense
  // ditempel), dan pertanyaan yang dibawa orang ke sana sudah menyebut jenisnya. Satu key: yang boleh
  // mengelola plugin satu situs juga yang boleh menulis kode iklannya ke banyak situs.
  { path: "/plugin", label: "Plugin", key: "plugin", group: "Aset", tab: "Daftar Plugin" },
  // Pasang subdomain terdaftar ke server CloudPanel (DNS, WordPress, SSL, plugin) lalu seluruh
  // onboarding situsnya. Tinggal di bawah Plugin, bukan Domains: yang boleh membukanya cuma superadmin,
  // sama persis dengan Plugin — sementara Domains terbuka untuk tiap akun yang login. Alamat lamanya
  // `/setup-sub` dialihkan (PAGES_MOVED).
  { path: "/plugin/setup-sub", label: "Setup Sub", key: "setupSub", parent: "/plugin" },
  { path: "/plugin/adx", label: "AdX", key: "plugin", parent: "/plugin" },
  { path: "/plugin/adsense", label: "AdSense", key: "plugin", parent: "/plugin" },
  // Membaca saja, tapi tetap SUPERADMIN: yang dibaca memakai kunci plugin tiap situs lewat gerbang
  // server yang sama, dan isinya kode iklan berikut network code seluruh armada.
  { path: "/plugin/cek", label: "Cek Situs", key: "plugin", parent: "/plugin" },
  // Daftar URL cloaking yang dipakai landing "Buat dari preset" di tab Landing tiap situs.
  { path: "/plugin/cloaking", label: "URL Cloaking", key: "plugin", parent: "/plugin" },

  { path: "/users", label: "Team", key: "users", group: "Admin" },
  { path: "/otp", label: "OTP", key: "otp", group: "Admin" },
  { path: "/activity-logs", label: "Activity Logs", key: "activityLogs", group: "Admin" },
  // Barisnya sendiri di sidebar, bukan tab di bawah Settings, dan alasannya sama persis dengan
  // Reminder: halaman ini dicari orang justru saat ia teringat menerima (atau tidak menerima)
  // sesuatu di Telegram, dan yang dicari dengan cara begitu harus terbaca tanpa menebak ada apa di
  // balik baris lain. Ia juga satu-satunya halaman di grup Admin yang dibuka SEMUA role — tiap
  // orang mengatur saklarnya sendiri di sini — jadi menyembunyikannya di balik Settings berarti
  // menyembunyikannya justru dari mayoritas yang membutuhkannya.
  //
  // Empat tab, semuanya route sungguhan seperti tab lain di dashboard ini. Yang jadi induk adalah
  // "Orang" dan bukan "Topik", karena itulah yang dicari mayoritas yang membukanya: seorang PIC
  // datang ke sini untuk barisnya sendiri, bukan untuk setelan yang tidak boleh ia sentuh.
  //
  // Grup sempat jadi tab tersendiri dan dibuang: pertanyaan yang dibawa orang ke halaman ini cuma
  // satu ("siapa saja yang dikirimi"), dan jawabannya yang dipecah dua daftar menuntut orang membuka
  // dua tempat untuk tahu kenapa sebuah pesan tidak sampai. Grup berdiri di daftar Orang, dibedakan
  // lencana Jenis.
  //
  // TIGA di antaranya memakai `key` yang sama karena izin bacanya memang sama — yang membedakan
  // admin dari yang lain di sini bukan halaman mana yang terbuka melainkan apa yang bisa ditekan di
  // dalamnya (`canManageNotifications`), dan tab yang disembunyikan akan membuat orang tidak pernah
  // tahu topik apa saja yang ada. Yang keempat (Calon Penerima) justru sebaliknya, dan alasannya
  // ditulis di barisnya sendiri: yang ditampilkannya bukan setelan kita melainkan identitas orang
  // luar.
  {
    path: "/notifications",
    label: "Notifikasi",
    key: "notifications",
    group: "Admin",
    tab: "Orang",
  },
  { path: "/notifications/topik", label: "Topik", key: "notifications", parent: "/notifications" },
  {
    // Satu-satunya tab di halaman ini yang key-nya BUKAN "notifications", dan itu disengaja: isinya
    // nama profil dan @username orang luar yang menyapa bot publik kita, dan tombolnya membuat
    // penerima baru. Tab yang ikut terbuka untuk semua role akan berbunyi "belum ada chat baru"
    // selamanya — `useFirebaseStore` cuma berlangganan node itu untuk admin.
    //
    // Berdiri sebagai tab dan bukan panel di atas daftar Orang: yang di sini adalah ANTREAN yang
    // habis begitu dikerjakan, sementara daftar Orang adalah keadaan yang dibaca terus. Panel yang
    // kosong hampir sepanjang waktu, tepat di atas tabel yang justru dicari orang, cuma mendorong
    // tabel itu turun tiap kali halaman dibuka.
    path: "/notifications/calon",
    label: "Calon Penerima",
    key: "telegramInbox",
    parent: "/notifications",
  },
  {
    // Ambangnya pindah dari `/settings?tab=peringatan` ke sini: yang di sana menjawab "berapa
    // ambangnya", yang di halaman ini menjawab "siapa yang dikabari" — dan satu-satunya pertanyaan
    // yang benar-benar ditanyakan orang adalah keduanya sekaligus.
    path: "/notifications/peringatan",
    label: "Peringatan ROI",
    key: "notifications",
    parent: "/notifications",
  },
  { path: "/settings", label: "Settings", key: "settings", group: "Admin" },
  {
    path: "/google-api-configs",
    label: "Google API",
    key: "googleApiConfigs",
    parent: "/settings",
  },
];

// Nama tab sebuah item: `tab` kalau ada, kalau tidak `label`. Yang memakainya cuma induk yang
// label sidebar-nya menyebut dua isi sekaligus — di kepala halaman, "Target & Reminder" untuk tab
// yang isinya target saja adalah nama yang salah.
export function navTabLabel(item) {
  return item.tab || item.label;
}

// Item yang cocok dengan sebuah alamat, yang paling dalam kalau ada beberapa. Dicocokkan persis
// atau sebagai segmen penuh — `startsWith` telanjang membuat `/domains` ikut menyala di
// `/domains-lama`, dan halaman aktif yang salah adalah kebohongan yang tenang.
export function matchNavItem(path) {
  return navItems
    .filter((item) => path === item.path || path.startsWith(`${item.path}/`))
    .sort((a, b) => b.path.length - a.path.length)[0];
}

// Alamat item sidebar yang harus menyala untuk sebuah path — induknya, kalau yang terbuka tab.
export function activeNavPath(path) {
  const match = matchNavItem(path);
  if (!match) return "";

  return match.parent || match.path;
}

// Baris sidebar: yang tidak punya induk dan boleh dibaca role ini.
export function sidebarItems(canRead) {
  return navItems.filter((item) => !item.parent && canRead(item.key));
}

// Tab di kepala halaman: induk lebih dulu, lalu anak-anaknya, semuanya disaring izin. Kembali
// kosong kalau yang tersisa cuma satu — satu tab bukan pilihan, ia cuma judul kedua.
export function pageTabs(path, canRead) {
  const rootPath = activeNavPath(path);
  if (!rootPath) return [];

  const root = navItems.find((item) => item.path === rootPath);
  const children = navItems.filter((item) => item.parent === rootPath);
  const visible = [root, ...children].filter((item) => item && canRead(item.key));

  return visible.length > 1 ? visible : [];
}
