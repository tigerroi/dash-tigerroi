import { canManageNotifications, canReadResource, isSuperAdmin } from "../config/access.js";

/**
 * Node RTDB yang dilanggan sebuah sesi, dan siapa yang mendapatkannya.
 *
 * Daftar ini dulu tinggal di dalam `useFirebaseStore` — tempat yang benar selama cuma satu berkas
 * yang membutuhkannya. Ia pindah ke sini begitu ada pembaca KEDUA: panel "Estimasi biaya Firebase"
 * di /activity-logs, yang menjawab "berapa yang diunduh tiap kali seseorang membuka dashboard" dan
 * karena itu harus menyebut daftar yang SAMA PERSIS dengan yang benar-benar dilanggan. Disalin, ia
 * akan tetap menyebut lima node gating pada hari halaman /vi-control dilepas — dan estimasinya
 * meleset tanpa satu pun tanda, ke arah yang menenangkan.
 *
 * YANG TIDAK ADA DI SINI: `roiSnapshots` dan `userReports`. Keduanya langganan BERAT yang dipasang
 * menurut route (lihat lib/heavyData.js) dan bukan menurut role, jadi ia bukan bagian dari bacaan
 * dasar sebuah sesi — ia menyusul kalau sesi itu benar-benar membuka halaman yang membacanya.
 */

const dashboardSubscriptions = {
  dashboardStats: "object",
  weeklyFinancials: "array",
  advertiserSpend: "array",
  roiReports: "array",
  // Tarif ad tax dipakai tiap kali sebuah ROI ditampilkan, jadi ia diikuti seperti data lain:
  // admin mengubahnya di halaman Settings dan tabel yang sedang terbuka ikut berubah.
  roiSettings: "object",
  // Ambang peringatan ROI. Diikuti seperti data lain, alasan yang sama dengan tarif ad tax:
  // halaman Settings harus menampilkan yang benar-benar tersimpan, bukan yang terakhir diketik.
  alertSettings: "object",
  // Setelan per topik notifikasi: saklar globalnya dan role yang disiarkan. Diikuti seperti data
  // lain supaya kolom "Penerima" ikut berubah begitu admin lain menggeser saklarnya.
  notificationSettings: "object",
  // Status sync otomatis (hitung mundur di topbar). Diikuti seperti data lain supaya "Syncing..."
  // muncul sendiri saat run mulai, tanpa perlu refresh.
  syncStatus: "object",
  // Hanya EKOR live-nya yang tinggal di RTDB — run terbaru, dibaca ikon peringatan topbar
  // (SyncIssuesAlert) untuk tahap yang gagal. Riwayat penuhnya pindah ke SQLite server; drain di
  // server menyisakan beberapa run terbaru di sini. Halaman Settings membaca lewat GET /sync-runs.
  syncRuns: "array",
  // Bagian sync yang gagal pada run terakhir. Diikuti seperti data lain supaya ikon peringatannya
  // padam sendiri begitu run berikutnya berhasil.
  syncIssues: "object",
  // Antrean percobaan ulang. Diikuti seperti data lain supaya indikator "sedang mencoba lagi"
  // menyala dan padam sendiri — ia berumur beberapa menit, jauh lebih pendek dari umur sebuah tab.
  syncRetries: "object",
  // Target earning per domain per bulan. Object bertingkat {domainId: {YYYY-MM: angka}}, diikuti
  // seperti data lain supaya angka yang baru disimpan langsung tampil di tabel yang terbuka.
  domainTargets: "object",
};

/**
 * Cermin gating Keitaro. Dipisah dari daftar di atas karena halaman /vi-control hanya untuk
 * superadmin — melanggankan lima node ini ke setiap akun yang login berarti mengunduh 55 baris
 * campaign, pratinjaunya, dan 50 baris riwayat untuk halaman yang tidak akan pernah mereka buka.
 *
 * Aturan database tidak menolaknya (`dashboard` dibaca semua akun yang login, dan izin baca RTDB
 * menurun — cabang di bawahnya tidak bisa menariknya kembali). Yang menahan di sini adalah
 * langganannya sendiri, dan yang benar-benar dijaga aturan database adalah TULISANNYA: perintah
 * baru di `dashboard/gating/commands` hanya boleh dibuat superadmin.
 */
export const gatingSubscriptions = {
  gateCampaigns: "object",
  gatePreviews: "object",
  gateRuns: "object",
  gateCommands: "object",
  gateStatus: "object",
};

/**
 * Cermin status plugin tiap situs. Superadmin saja, sepola dengan gating di atas — halaman /plugin
 * memang cuma untuk mereka, dan aturan `pluginSites` di database.rules.json menolak yang lain.
 *
 * Yang dilanggan hanya STATUSNYA. `pluginKeys` — api_key tiap situs — sengaja tidak ada di daftar
 * ini dan tidak boleh pernah ada: kuncinya cuma dipakai server kontrol, dan sebuah langganan di
 * sini akan mengunduh seluruh kunci armada ke browser hanya untuk menggambar kolom "Versi".
 */
export const pluginSubscriptions = {
  pluginSites: "object",
  // Template ukuran slot untuk generator kode Ad Manager di tab kedua halaman yang sama.
  gptSizeTemplates: "array",
  // Kode unit AdSense terakhir per subdomain, untuk tab AdSense di halaman yang sama.
  adsenseSlots: "object",
  // URL cloaking yang dipakai landing "Buat dari preset", tab URL Cloaking di halaman yang sama.
  cloakingUrls: "array",
};

/**
 * Job salinan campaign dari halaman /campaigns. Superadmin saja, sepola gating dan plugin: halaman
 * yang membacanya memang cuma untuk mereka, dan panel Salinan tidak digambar untuk role lain.
 */
const campaignSubscriptions = {
  campaignCopyJobs: "object",
  // Job BUAT campaign, node sendiri karena bentuk barisnya berbeda — panel Pekerjaan di halaman itu
  // menggabungkan keduanya jadi satu daftar berkolom Jenis.
  campaignCreateJobs: "object",
  // Preset negara per advertiser, dipakai dialog Buat campaign. Superadmin saja, sama dengan kedua
  // node job di atasnya: satu-satunya layar yang membacanya ada di halaman ini.
  countryPresets: "array",
};

/**
 * Chat yang menyapa bot dan belum jadi penerima. ADMIN saja, sepola dengan gating dan plugin di
 * atas — bukan karena isinya rahasia (aturan `dashboard` membolehkan tiap akun yang login
 * membacanya, dan izin baca RTDB menurun), melainkan karena panel yang menampilkannya hanya digambar
 * untuk admin: satu-satunya yang bisa dilakukan orang lain dengan node ini adalah mengunduhnya.
 */
const telegramInboxSubscriptions = {
  telegramInbox: "object",
};

/**
 * Dua node yang TIDAK ikut bacaan dasar. Kapan masing-masing menyusul diputuskan `needsRoiSnapshots`
 * / `needsUserReports` di lib/heavyData.js — dari ROUTE, bukan dari role.
 */
export const HEAVY_NODES = ["roiSnapshots", "userReports"];

/**
 * Peta nilai (`subscribeValue`) yang dilanggan sebuah role, apa adanya seperti yang dirakit
 * `useFirebaseStore`. Dipisah dari fungsi di bawahnya karena store memakai BENTUKNYA
 * ("array"/"object") juga, sementara penghitung biaya cuma butuh kuncinya.
 */
export function valueSubscriptionsFor(role) {
  return {
    ...dashboardSubscriptions,
    ...(canManageNotifications(role) ? telegramInboxSubscriptions : {}),
    ...(isSuperAdmin(role)
      ? { ...gatingSubscriptions, ...pluginSubscriptions, ...campaignSubscriptions }
      : {}),
  };
}

/**
 * Seluruh node yang diunduh SATU KALI MUAT APLIKASI oleh sebuah role.
 *
 * Bukan "per kunjungan halaman": berpindah halaman di dashboard ini tidak mengunduh apa pun —
 * langganannya dipasang sekali saat store mount dan hidup sampai sesinya selesai. Yang membayar
 * ulang adalah MUAT ULANG, yaitu login, refresh, dan tab baru.
 *
 * `notificationGroups` ikut untuk setiap role dan bukan cuma admin: halaman Notification Center
 * menampilkan siapa saja yang menerima tiap topik, dan itu dibuka semua orang.
 */
export function sessionNodes(role, resourceKeys = []) {
  const keys = new Set();
  for (const key of resourceKeys) {
    if (canReadResource(role, key)) keys.add(key);
  }
  for (const key of Object.keys(valueSubscriptionsFor(role))) keys.add(key);
  keys.add("notificationGroups");
  if (isSuperAdmin(role)) keys.add("otpSecrets");
  return [...keys];
}
