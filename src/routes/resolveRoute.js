// Tab Overview, dipetakan dari alamatnya. `/` ikut di sini karena itu alamat yang dibuka orang
// pertama kali — ia harus mendarat di tab pertama, bukan di halaman "tidak ditemukan".
// Tab Notification Center, dipetakan dari alamatnya — sepola dengan DASHBOARD_TABS di bawah.
// Induknya "orang" dan bukan "topik": yang membuka halaman ini paling sering adalah orang yang
// mencari barisnya sendiri.
const NOTIFICATION_TABS = {
  "/notifications": "orang",
  "/notifications/topik": "topik",
  // Satu-satunya tab halaman ini yang membawa key-nya SENDIRI, jadi ia dipetakan berikut key-nya.
  // Ketiga tab lain terbuka untuk semua role; yang ini memuat identitas orang luar yang menyapa bot
  // publik kita, dan `telegramInbox` ada di ADMIN_ONLY_RESOURCES. Dibiarkan ber-key "notifications",
  // alamat yang diketik tangan akan membukanya untuk siapa saja — dan yang menyambut mereka adalah
  // daftar kosong (langganan RTDB-nya memang cuma untuk admin), bukan penolakan.
  "/notifications/calon": { tab: "calon", key: "telegramInbox" },
  "/notifications/peringatan": "peringatan",
};

// Tab halaman Campaign, sepola DASHBOARD_TABS: satu halaman, dua alamat. Keduanya ber-key sama
// ("campaigns", SUPERADMIN_PAGES) — yang dibaca kedua tab persis node yang sama, jadi tidak ada
// gerbang kedua untuk dijaga.
const CAMPAIGN_TABS = {
  "/campaigns": "daftar",
  "/campaigns/pekerjaan": "pekerjaan",
};

// Tab halaman Plugin, sepola CAMPAIGN_TABS: satu halaman, dua alamat, satu key ("plugin",
// SUPERADMIN_PAGES) — generator kode iklan menulis ke situs yang sama lewat gerbang server yang sama.
// `/plugin/inject-kode` alamat lama tab AdX (sebelum AdSense punya tabnya sendiri) — tetap dikenali,
// dan main.jsx menulis ulang alamatnya (PAGES_MOVED), sepola /gating.
const PLUGIN_TABS = {
  "/plugin": "daftar",
  "/plugin/adx": "adx",
  "/plugin/adsense": "adsense",
  "/plugin/cek": "cek",
  "/plugin/cloaking": "cloaking",
  "/plugin/inject-kode": "adx",
};

const DASHBOARD_TABS = {
  "/": "ringkasan",
  "/dashboard": "ringkasan",
  "/dashboard/grafik": "grafik",
  "/dashboard/roi": "roi",
  "/dashboard/kalender": "kalender",
  "/dashboard/terjadwal": "terjadwal",
  "/dashboard/rasio-penayangan": "rasio-penayangan",
};

export function resolveRoute(path, resources) {
  // Overview dan tab-tabnya. Satu halaman, tiga alamat: yang membedakan cuma bagian mana yang
  // dirender — sepola dengan tab lain (PageTabs), yang juga route sungguhan dan bukan panel yang
  // berganti isi tanpa pindah alamat.
  const dashboardTab = DASHBOARD_TABS[path];
  if (dashboardTab) {
    return { kind: "dashboard", key: "dashboard", tab: dashboardTab };
  }

  // Bukan salah satu `resources`: Settings tidak punya daftar, form tambah, atau baris untuk
  // dibuka — satu node nilai, satu halaman.
  //
  // `key` tetap diisi walau hari ini Settings boleh dibaca semua role, dan itu justru alasannya:
  // `navigation.js` sudah menamainya "settings" untuk menyaring sidebar, jadi dua sistem `key`
  // berjalan berdampingan. Tanpa key di sini, hanya yang di sidebar yang menyaring — dan hari
  // halaman ini diketatkan, menunya hilang sementara halamannya tetap terbuka untuk siapa saja
  // yang mengetik alamatnya.
  if (path === "/settings") {
    return { kind: "settings", key: "settings" };
  }

  // Bukan salah satu `resources`, alasan yang sama dengan Settings: Laba Rugi tidak punya node
  // sendiri untuk di-CRUD — ia menjumlahkan weeklyFinancials, expenses, dan whitelistTopup.
  if (path === "/profit-loss") {
    return { kind: "profitLoss", key: "profitLoss" };
  }

  // Bukan salah satu `resources`, alasan yang sama dengan Laba Rugi: halaman ini tidak punya node
  // sendiri untuk di-CRUD. Ia rantai yang sama, dipecah per subdomain — dan seluruh bahannya
  // (`roiReports`, `companyPercents`, `invalidTraffic`, `users`) sudah punya halamannya sendiri.
  //
  // `key` diisi supaya gerbang izin di App bekerja: "cashFlow" ada di KEUANGAN_PAGES, dan tanpa key
  // tidak ada yang diperiksa `canReadResource`.
  if (path === "/cash-flow") {
    return { kind: "cashFlow", key: "cashFlow" };
  }

  // Rantai yang sama lagi, dikelompokkan per domain. Bukan salah satu `resources` dengan alasan
  // yang sama dengan Cash Flow: tidak ada node untuk di-CRUD, seluruh bahannya sudah punya
  // halamannya sendiri. `key` diisi supaya gerbang izin di App bekerja — "domainProfit" ada
  // di KEUANGAN_PAGES.
  if (path === "/domain-profit") {
    return { kind: "domainProfit", key: "domainProfit" };
  }

  // Bukan salah satu `resources`, alasan yang sama: halaman Spending tidak menulis apa pun. Ia
  // menjumlahkan `roiReports` dan membaca budget/hari dari baris `users`; dana berikutnya yang
  // diketik orang tinggal di alamat, bukan di database.
  //
  // `key` diisi supaya gerbang izin di App bekerja — "spending" ada di SUPERADMIN_PAGES, dan tanpa
  // key tidak ada yang diperiksa `canReadResource`. Di halaman ini itu bukan formalitas: tidak ada
  // satu pun aturan database di belakangnya (yang dibacanya justru node yang terbuka untuk semua),
  // jadi key inilah satu-satunya penjaganya — sepola dengan "otp".
  //
  // Alamat lamanya `/spending` tetap dikenali dan menghasilkan halaman yang sama, sepola dengan
  // `/gating` -> `/vi-control`: ia sudah jadi bookmark dan tautan yang beredar, dan alamat yang
  // mati menghasilkan halaman "tidak ditemukan" yang tidak memberi tahu ke mana halamannya pindah.
  // App menulis ulang alamatnya ke yang kanonik (replace, bukan push -- lihat main.jsx);
  // `kind`/`key` sengaja tetap "spending" karena keduanya menamai gerbang izin (SUPERADMIN_PAGES)
  // yang tidak ikut berganti nama.
  if (path === "/proyeksi-budget" || path === "/spending") {
    return { kind: "spending", key: "spending" };
  }

  // Bukan salah satu `resources`, alasan yang sama dengan Settings: halaman ini tidak punya node
  // untuk di-CRUD. Yang ada di RTDB adalah cermin dari Keitaro — ditulis sync, tidak pernah dibuat
  // orang.
  //
  // Alamat lamanya `/gating` tetap dikenali dan menghasilkan halaman yang sama: ia sudah jadi
  // bookmark dan tautan yang beredar, dan alamat yang mati menghasilkan halaman "tidak ditemukan"
  // yang tidak memberi tahu ke mana halamannya pindah. App menulis ulang alamatnya ke yang kanonik
  // (replace, bukan push — lihat main.jsx); `kind`/`key` sengaja tetap "gating" karena keduanya
  // menamai node RTDB dan aturan database yang tidak ikut berganti nama.
  if (path === "/vi-control" || path === "/gating") {
    return { kind: "gating", key: "gating" };
  }

  // Bukan salah satu `resources`, alasan yang sama dengan gating: tidak ada baris untuk di-CRUD di
  // sini. Yang di RTDB cuma cermin status tiap situs; pengaturan yang diedit halaman ini tinggal di
  // database WordPress masing-masing situs dan dibaca lewat server kontrol tiap kali dibuka.
  const pluginTab = PLUGIN_TABS[path];
  if (pluginTab) {
    return { kind: "plugin", key: "plugin", tab: pluginTab };
  }

  // Bukan salah satu `resources`, alasan yang sama dengan plugin: tidak ada baris di RTDB yang
  // menjadi milik halaman ini. Record DNS tinggal di Cloudflare dan dibaca lewat server kontrol
  // tiap kali sebuah zona dibuka — tidak dicermin sama sekali, karena yang dicari orang di sana
  // adalah keadaan pada detik ini.
  //
  // `key` diisi supaya gerbang izin di App bekerja: "dnsRecords" ada di SUPERADMIN_PAGES, dan tanpa
  // key tidak ada yang diperiksa `canReadResource` — tab superadmin yang terbuka untuk siapa saja
  // yang mengetik alamatnya.
  if (path === "/dns-records") {
    return { kind: "dnsRecords", key: "dnsRecords" };
  }

  // Sepola DNS Record: bukan `resources`, dan `key` yang membuat gerbang superadmin bekerja.
  // `/setup-sub` alamat lama (tab di bawah Domains) — tetap dikenali, dialihkan PAGES_MOVED.
  if (path === "/plugin/setup-sub" || path === "/setup-sub") {
    return { kind: "setupSub", key: "setupSub" };
  }

  // Bukan salah satu `resources`: halaman armada campaign membaca `users/*/campaigns` yang sudah
  // dilanggan store dan menulis ke Meta lewat server kontrol. `key` diisi supaya gerbang izin di
  // App bekerja — "campaigns" ada di SUPERADMIN_PAGES, dan tanpa key halaman superadmin ini terbuka
  // untuk siapa saja yang mengetik alamatnya.
  const campaignTab = CAMPAIGN_TABS[path];
  if (campaignTab) {
    return { kind: "campaigns", key: "campaigns", tab: campaignTab };
  }

  // Bukan salah satu `resources`: tidak ada satu pun baris di RTDB yang menjadi milik halaman ini.
  // Secret-nya diketik orang, kodenya dihitung di browser, dan keduanya hilang saat tab-nya ditutup.
  //
  // `key` diisi supaya gerbang izin di App bekerja: "otp" ada di SUPERADMIN_PAGES, dan tanpa key
  // tidak ada yang diperiksa canReadResource — halaman superadmin yang terbuka untuk siapa saja
  // yang mengetik alamatnya.
  if (path === "/otp") {
    return { kind: "otp", key: "otp" };
  }

  // Halaman tambah berdiri sendiri, sepola dengan `/targets/new`: yang di layar daftar adalah kode
  // yang berganti tiap tiga puluh detik, dan sebuah form di atasnya membuat orang menggulir melewati
  // form itu setiap kali membuka halaman untuk menyalin satu kode.
  if (path === "/otp/new") {
    return { kind: "otpForm", key: "otp" };
  }

  // Bukan salah satu `resources`, alasan yang sama dengan gating dan plugin: tidak ada baris untuk
  // di-CRUD di sini. Yang di RTDB ditulis server kontrol dari jejak yang dikirim browser tiap orang,
  // dan halaman ini cuma membacanya.
  //
  // `key` diisi supaya gerbang izin di App bekerja: "activityLogs" ada di SUPERADMIN_PAGES, dan
  // tanpa key tidak ada yang diperiksa canReadResource — halaman superadmin yang terbuka untuk siapa
  // saja yang mengetik alamatnya.
  if (path === "/activity-logs") {
    return { kind: "activityLogs", key: "activityLogs" };
  }

  // Bukan salah satu `resources`, alasan yang sama dengan Settings: tidak ada daftar untuk di-CRUD
  // sebagai satu halaman penuh. Yang diubah halaman ini tersebar di tiga node yang sudah punya
  // pemiliknya masing-masing — baris `users`, `notificationGroups`, dan `settings/notifications`.
  //
  // `key` diisi walau halaman ini terbuka untuk semua role, alasan yang sama dengan Settings: dua
  // sistem `key` berjalan berdampingan (navigation.js dan gerbang izin di App), dan halaman yang
  // key-nya cuma disebut di salah satunya akan terbuka bagi yang mengetik alamatnya pada hari ia
  // diketatkan.
  //
  // Tiga tab + dua halaman form ber-`key: "notifications"` — yang membedakan admin dari yang lain di
  // sana bukan halaman mana yang terbuka melainkan apa yang boleh ditulis di dalamnya, dan itu
  // dijaga komponennya (`canManageNotifications`) plus aturan database. Tab keempat (Calon Penerima)
  // membawa key-nya sendiri; alasannya di NOTIFICATION_TABS.
  const notificationTab = NOTIFICATION_TABS[path];
  if (notificationTab) {
    const { tab, key } =
      typeof notificationTab === "string"
        ? { tab: notificationTab, key: "notifications" }
        : notificationTab;
    return { kind: "notifications", key, tab };
  }

  // Penerima yang TIDAK punya baris di Team — orang luar maupun grup. Satu form untuk keduanya:
  // yang membedakannya cuma tanda chat id-nya, dan itu dibaca sendiri (`isGroupChat`), bukan diisi
  // orang di kolom yang bisa keliru.
  if (path === "/notifications/kontak/new") {
    return { kind: "notificationContactForm", key: "notifications" };
  }

  const contactEditMatch = path.match(/^\/notifications\/kontak\/([^/]+)\/edit$/);
  if (contactEditMatch) {
    return { kind: "notificationContactForm", key: "notifications", id: contactEditMatch[1] };
  }

  // Tidak ada `/notifications/orang/new`: baris ANGGOTA TIM lahir di halaman Team bersama akun
  // loginnya, dan sebuah "tambah" di sini akan membuat baris kedua untuk orang yang sama. Yang bukan
  // anggota tim lewat `/notifications/kontak/new` di atas.
  const personEditMatch = path.match(/^\/notifications\/orang\/([^/]+)\/edit$/);
  if (personEditMatch) {
    return { kind: "notificationPersonForm", key: "notifications", id: personEditMatch[1] };
  }

  // `key` diisi dengan alasan yang sama seperti Settings: `navigation.js` menamainya "targets",
  // dan gerbang izin di App hanya bertanya kalau route-nya membawa key.
  if (path === "/targets") {
    return { kind: "targets", key: "targets" };
  }

  if (path === "/targets/new") {
    return { kind: "targetForm", key: "targets" };
  }

  // Target dikunci oleh domain id + bulan (YYYY-MM) + jenis akun, bukan satu id push-key seperti
  // resource lain — satu domain punya dua baris tiap bulan (Adsense dan Ad-Exchanger), dan alamat
  // tanpa jenisnya membuka salah satu dari keduanya tanpa cara memilih yang mana.
  //
  // Slug jenisnya dibaca APA ADANYA dan divalidasi form (`accountTypeOfSlug`), bukan didaftarkan
  // sebagai pilihan di regex ini: daftar kedua yang harus sepakat dengan ACCOUNT_TYPE_SLUGS adalah
  // cara sebuah jenis baru menghasilkan alamat "tidak ditemukan" alih-alih form yang mengeluh.
  const targetEditMatch = path.match(/^\/targets\/([^/]+)\/(\d{4}-\d{2})\/([^/]+)\/edit$/);
  if (targetEditMatch) {
    return {
      kind: "targetForm",
      key: "targets",
      domainId: targetEditMatch[1],
      month: targetEditMatch[2],
      slug: targetEditMatch[3],
    };
  }

  for (const [key, config] of Object.entries(resources)) {
    if (path === config.path) {
      return { kind: "list", key };
    }

    if (path === `${config.path}/new`) {
      return { kind: "form", key };
    }

    const editMatch = path.match(new RegExp(`^${config.path}/([^/]+)/edit$`));
    if (editMatch) {
      return { kind: "form", key, id: editMatch[1] };
    }

    const detailMatch = path.match(new RegExp(`^${config.path}/([^/]+)$`));
    if (detailMatch) {
      return { kind: "detail", key, id: detailMatch[1] };
    }
  }

  return { kind: "missing" };
}
