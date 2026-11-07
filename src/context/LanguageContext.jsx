import { createContext, useContext, useMemo, useState } from "react";

const STORAGE_KEY = "tigerroi_lang";

// Kamus terjemahan frasa langsung (gettext-style) dari Bahasa Indonesia -> English
export const PHRASE_DICTIONARY_EN = {
  // Preset Tanggal & Kalender
  "hari ini": "Today",
  "kemarin": "Yesterday",
  "hari ini dan kemarin": "Today and yesterday",
  "7 hari terakhir": "Last 7 days",
  "14 hari terakhir": "Last 14 days",
  "28 hari terakhir": "Last 28 days",
  "30 hari terakhir": "Last 30 days",
  "minggu ini": "This week",
  "minggu lalu": "Last week",
  "bulan ini": "This month",
  "bulan lalu": "Last month",
  "semua tanggal": "All dates",
  "rentang tanggal": "Date range",
  "rentang waktu": "Date range",
  "rentang tanggal kustom": "Custom date range",
  "rentang tanggal riwayat spend": "Spend history date range",
  "filter periode laporan roi realtime": "Realtime ROI report date filter",
  "filter periode roi founder": "Founder ROI period filter",
  "periode bulanan": "Monthly period",
  "sejak": "Since",
  "sampai": "Until",
  "terapkan": "Apply",
  "batal": "Cancel",
  "hari": "days",
  "poin": "pts",
  "hari selesai": "Completed days",
  "berjalan, hanya di heatmap & kurva": "ongoing, heatmap & curves only",
  "(sebagian)": "(partial)",

  // Tabel & Paginasi
  "halaman": "Page",
  "dari": "of",
  "sebelumnya": "Previous",
  "berikutnya": "Next",
  "baris": "rows",
  "jumlah baris per halaman": "Rows per page",
  "actions": "Actions",
  "aksi": "Actions",
  "detail": "Detail",
  "tidak ada data untuk ditampilkan": "No data to display",
  "belum ada data": "No data available",
  "memuat data...": "Loading data...",
  "memuat...": "Loading...",
  "total": "Total",
  "tidak ada baris roi maupun top-up pada periode ini.": "No ROI or top-up records in this period.",
  "semua subdomain": "All subdomains",

  // Kolom-kolom Utama
  "nama akun (whitelist)": "Account Name (Whitelist)",
  "nama akun": "Account Name",
  "nama akun ads": "Ad Account Name",
  "act id meta": "Meta ACT ID",
  "sisa saldo": "Remaining Balance",
  "pengeluaran hari ini": "Today's Spend",
  "batas pengeluaran": "Spend Cap",
  "total spend": "Total Spend",
  "total keseluruhan spend": "Total Spend",
  "total topup (tu)": "Total TopUp (TU)",
  "total spending + tax (st)": "Total Spending + Tax (ST)",
  "total earning (er)": "Total Earnings (ER)",
  "profit advertiser": "Advertiser Profit",
  "profit founder": "Founder Profit",
  "roi overall advertiser": "Overall Advertiser ROI",
  "roi overall founder": "Overall Founder ROI",
  "tanggal": "Date",
  "campaign": "Campaign",
  "kampanye": "Campaign",
  "kode": "Code",
  "sub domain": "Sub Domain",
  "subdomain": "Sub Domain",
  "spend": "Spend",
  "hasil": "Results",
  "biaya/hasil": "Cost / Result",
  "catatan": "Notes",
  "ad account": "Ad Account",
  "saldo berkurang": "Deducted Balance",
  "rekap riwayat saldo berkurang (daily spend)": "Daily Balance Deduction (Daily Spend)",
  "riwayat spend campaign": "Campaign Spend History",
  "spend & hasil tiap campaign per hari. diisi sync meta; masa simpan 90 hari terakhir.": "Spend & results per campaign daily. Filled by Meta Sync; 90 days retention.",
  "catatan pengurangan saldo harian dari akun iklan user.": "Daily balance deduction records from user's ad accounts.",
  "sinkronisasi otomatis meta": "Automatic Meta Sync",
  "anggaran": "Budget",
  "anggaran harian": "Daily Budget",
  "total/hari": "Total/day",
  "tidak diatur di level campaign": "Not set at campaign level",

  // Profil & User Detail
  "profile user": "User Profile",
  "detail informasi pengguna dan aset yang terhubung.": "User information and connected assets details.",
  "kembali": "Back",
  "total saldo (semua act)": "Total Balance (All Act)",
  "bergabung pada": "Joined At",
  "sub domain assigned": "Assigned Sub Domains",
  "daftar sub domain beserta performa google ad manager hari ini (real-time).": "List of sub domains with today's real-time Google Ad Manager performance.",
  "daftar ad account (act) & saldo": "Ad Accounts (Act) & Balance List",
  "saldo dan spend terbaru untuk akun iklan milik user ini.": "Latest balance and spend for this user's ad accounts.",
  "user tidak ditemukan": "User not found",

  // Negara & Klasemen
  "roi per negara": "ROI by Country",
  "paling unggul": "Top Performer",
  "roi terendah": "Lowest ROI",
  "sedang naik · 3 hari terakhir": "Rising · Last 3 days",
  "sedang naik": "Rising",
  "sedang turun · 3 hari terakhir": "Declining · Last 3 days",
  "sedang turun": "Declining",
  "klasemen negara": "Country Leaderboard",
  "prioritas penurunan anggaran": "Budget Cut Priorities",
  "prioritas penurunan anggaran 3 hari terakhir": "Budget Cut Priorities (Last 3 days)",
  "rekomendasi": "Recommendation",
  "naikkan": "Scale Up",
  "pertahankan": "Maintain",
  "turunkan": "Scale Down",
  "hari untung": "Profitable Days",
  "rugi beruntun": "Consecutive Loss",
  "untung": "profit",
  "tidak ada yang rugi": "No loss",
  "rugi": "Loss",
  "disembunyikan": "hidden",
  "dengan total spend di bawah": "with Total Spend below",
  "negara": "Country",
  "cpc": "CPC",
  "ecpm": "eCPM",
  "roi 3 hari": "3-day ROI",
  "heatmap roi harian": "Daily ROI Heatmap",
  "warna = roi hari itu; sentuh sel untuk rincian subdomain.": "Color = Daily ROI; hover/tap cell for subdomain breakdown.",
  "kurva roi harian": "Daily ROI Curves",
  "klik nama negara untuk menyembunyikan/menampilkan dari grafik kurva:": "Click country name to toggle on curve chart:",
  "tampilkan ringkas": "Show compact",
  "tampilkan semua": "Show all",
  "semua negara": "All Countries",

  // Terjadwal (Scheduled Launches)
  "campaign terjadwal": "Scheduled Campaigns",
  "daftar ad set yang dijadwalkan jalan di masa depan dari kampanye meta ads.": "List of ad sets scheduled to run in the future from Meta Ads campaigns.",
  "jadwal tayang": "Launch Schedule",
  "waktu mulai": "Start Time",
  "waktu selesai": "End Time",
  "ad set / campaign": "Ad Set / Campaign",
  "semua status": "All statuses",
  "semua pic": "All PICs",
  "tidak ada campaign terjadwal saat ini.": "No scheduled campaigns at this moment.",
  "membaca jadwal dari meta...": "Reading schedule from Meta...",
  "membaca jadwal ad set seluruh ad account dari meta...": "Reading ad set schedule for all ad accounts from Meta...",
  "tidak ada campaign maupun ad set yang terjadwal — semua yang saklarnya on sudah tayang.": "No scheduled campaigns or ad sets — all active ones are already running.",

  // Navigasi & Grup
  "ringkasan": "Summary",
  "grafik": "Charts",
  "laporan roi": "ROI Reports",
  "laporan roi realtime": "Realtime ROI Report",
  "import csv keitaro": "Import Keitaro CSV",
  "kalender": "Calendar",
  "earning harian": "Daily Earnings",
  "terjadwal": "Scheduled",
  "rasio penayangan": "Fill Rate",
  "metrik adwords": "AdWords Metrics",
  "keuangan": "Finance",
  "accounting": "Accounting",
  "laba rugi": "Profit & Loss",
  "cash flow": "Cash Flow",
  "laba per domain": "Domain Profit",
  "pencairan": "Payouts",
  "akun ditutup": "Account Close",
  "invalid traffic": "Invalid Traffic",
  "cost ad exchange": "Cost Ad Exchange",
  "expenses": "Expenses",
  "whitelist top-up": "Whitelist Top-Up",
  "proyeksi budget": "Budget Projection",
  "aset": "Assets",
  "ad accounts": "Ad Accounts",
  "domains": "Domains",
  "sub domains": "Sub Domains",
  "plugin": "Plugins",
  "admin": "Admin",
  "team": "Team",
  "notifikasi": "Notifications",
  "settings": "Settings",
  "orang": "People",
  "topik": "Topics",
  "peringatan roi": "ROI Alerts",
  "google api": "Google API",
  "collapse": "Collapse",
  "logout": "Log Out",

  // Tombol & Aksi
  "simpan": "Save",
  "hapus": "Delete",
  "edit": "Edit",
  "tambah": "Add",
  "perbarui": "Refresh",
  "filter": "Filter",
  "tutup": "Close",
  "semua": "All",
  "cari": "Search",
  "konfirmasi": "Confirm",
  "semua kode keitaro": "All Keitaro Codes",
  "pilih...": "Select...",
  "tidak ada pilihan yang cocok.": "No matching options.",

  // Status & Notifikasi
  "synced": "Synced",
  "pending": "Pending",
  "gagal": "Failed",
  "aktif": "Active",
  "nonaktif": "Disabled",
  "selesai": "Completed",
  "sync berikutnya dalam": "Next sync in",
  "sedang sync...": "Sync in progress...",
  "sync otomatis belum berjalan": "Auto sync not running yet",
  "sync tergantung": "Sync stalled",
  "tanpa kabar": "no update",
  "run terakhir gagal": "last run failed",
  "jadwal terlewat": "Schedule missed",
  "sync sebentar lagi": "Syncing shortly",
  "saldo meta menipis:": "Meta balance running low:",
  "top-up sebelum iklannya berhenti.": "Top-up before ads stop running.",
  "belum ada hari yang selesai di rentang ini": "No completed days in this date range",
  "belum ada campaign": "No campaigns found",
  "total users": "Total Users",
  "active domains": "Active Domains",
  "managed campaigns": "Managed Campaigns",
};

export const translations = {
  id: {
    // Navigasi & Grup
    "nav.group.ringkasan": "Ringkasan",
    "nav.group.keuangan": "Keuangan",
    "nav.group.aset": "Aset",
    "nav.group.admin": "Admin",
    "nav.overview": "Overview",
    "nav.accounting": "Accounting",
    "nav.reminder": "Reminder",
    "nav.target": "Target",
    "nav.budget_projection": "Proyeksi Budget",
    "nav.ad_accounts": "Ad Accounts",
    "nav.campaign": "Campaign",
    "nav.gam": "GAM",
    "nav.adsense": "AdSense",
    "nav.domains": "Domains",
    "nav.subdomains": "Sub Domains",
    "nav.gating": "VI Control",
    "nav.plugin": "Plugin",
    "nav.team": "Team",
    "nav.otp": "OTP",
    "nav.activity_logs": "Activity Logs",
    "nav.notifications": "Notifikasi",
    "nav.settings": "Settings",
    "nav.collapse": "Collapse",
    "nav.logout": "Logout",

    // Tab Overview
    "tab.ringkasan": "Ringkasan",
    "tab.grafik": "Grafik",
    "tab.negara": "Negara",
    "tab.laporan_roi": "Laporan ROI",
    "tab.kalender": "Kalender",
    "tab.earning_harian": "Earning Harian",
    "tab.terjadwal": "Terjadwal",
    "tab.rasio_penayangan": "Rasio Penayangan",
    "tab.metrik_adwords": "Metrik AdWords",

    // Tab Keuangan
    "tab.laba_rugi": "Laba Rugi",
    "tab.cash_flow": "Cash Flow",
    "tab.laba_domain": "Laba per Domain",
    "tab.proyeksi_budget": "Proyeksi Budget",

    // Tab Notifications & Settings
    "tab.orang": "Orang",
    "tab.topik": "Topik",
    "tab.peringatan_roi": "Peringatan ROI",
    "tab.google_api": "Google API",

    // Header & Kartu Statistik
    "overview.title": "Overview",
    "overview.subtitle": "Ringkasan performa monitoring ROI, diperbarui tiap sync.",
    "overview.total_spend": "Total Keseluruhan Spend",
    "overview.balance_spend_title": "Saldo & Pengeluaran Akun Whitelist",
    "overview.founder_roi_title": "ROI Founder (BD R 16)",
    "overview.next_sync": "Sync berikutnya dalam",
    "overview.sync_running": "Sedang sync...",

    // Tabel Kolom Umum
    "col.account_name": "Nama Akun (Whitelist)",
    "col.remaining_balance": "Sisa Saldo",
    "col.today_spend": "Pengeluaran Hari Ini",
    "col.actions": "Actions",
    "col.detail": "Detail",
    "col.date": "Tanggal",
    "col.campaign": "Campaign",
    "col.code": "Kode",
    "col.subdomain": "Sub Domain",
    "col.spend": "Spend",
    "col.result": "Hasil",
    "col.cost_per_result": "Biaya/hasil",
    "col.note": "Catatan",
    "col.total_topup": "Total TopUp (TU)",
    "col.total_spending_tax": "Total Spending + Tax (ST)",
    "col.total_earning": "Total Earning (ER)",
    "col.profit_advertiser": "Profit Advertiser",
    "col.profit_founder": "Profit Founder",
    "col.roi_overall_advertiser": "ROI Overall Advertiser",
    "col.roi_overall_founder": "ROI Overall Founder",
    "col.total": "Total",

    // Aksi & Tombol
    "btn.save": "Simpan",
    "btn.cancel": "Batal",
    "btn.delete": "Hapus",
    "btn.edit": "Edit",
    "btn.add": "Tambah",
    "btn.refresh": "Perbarui",
    "btn.filter": "Filter",
    "btn.close": "Tutup",
    "btn.all": "Semua",
    "btn.search": "Cari",
    "btn.loading": "Memuat...",
    "btn.confirm": "Konfirmasi",

    // Status
    "status.synced": "Synced",
    "status.pending": "Pending",
    "status.failed": "Gagal",
    "status.active": "Aktif",
    "status.disabled": "Nonaktif",
    "status.completed": "Selesai",

    // Pesan Kosong & Peringatan
    "empty.no_data": "Belum ada data",
    "empty.no_campaigns": "Belum ada campaign",
    "empty.no_days_completed": "Belum ada hari yang selesai di rentang ini",
    "empty.no_scheduled": "Tidak ada campaign terjadwal saat ini.",
  },

  en: {
    // Navigasi & Grup
    "nav.group.ringkasan": "Summary",
    "nav.group.keuangan": "Finance",
    "nav.group.aset": "Assets",
    "nav.group.admin": "Admin",
    "nav.overview": "Overview",
    "nav.accounting": "Accounting",
    "nav.reminder": "Reminder",
    "nav.target": "Target",
    "nav.budget_projection": "Budget Projection",
    "nav.ad_accounts": "Ad Accounts",
    "nav.campaign": "Campaigns",
    "nav.gam": "GAM",
    "nav.adsense": "AdSense",
    "nav.domains": "Domains",
    "nav.subdomains": "Sub Domains",
    "nav.gating": "VI Control",
    "nav.plugin": "Plugins",
    "nav.team": "Team",
    "nav.otp": "OTP",
    "nav.activity_logs": "Activity Logs",
    "nav.notifications": "Notifications",
    "nav.settings": "Settings",
    "nav.collapse": "Collapse",
    "nav.logout": "Log Out",

    // Tab Overview
    "tab.ringkasan": "Summary",
    "tab.grafik": "Charts",
    "tab.negara": "Countries",
    "tab.laporan_roi": "ROI Reports",
    "tab.kalender": "Calendar",
    "tab.earning_harian": "Daily Earnings",
    "tab.terjadwal": "Scheduled",
    "tab.rasio_penayangan": "Fill Rate",
    "tab.metrik_adwords": "AdWords Metrics",

    // Tab Keuangan
    "tab.laba_rugi": "Profit & Loss",
    "tab.cash_flow": "Cash Flow",
    "tab.laba_domain": "Domain Profit",
    "tab.proyeksi_budget": "Budget Projection",

    // Tab Notifications & Settings
    "tab.orang": "People",
    "tab.topik": "Topics",
    "tab.peringatan_roi": "ROI Alerts",
    "tab.google_api": "Google API",

    // Header & Kartu Statistik
    "overview.title": "Overview",
    "overview.subtitle": "ROI monitoring performance summary, updated every sync.",
    "overview.total_spend": "Total Spend",
    "overview.balance_spend_title": "Whitelist Account Balance & Spend",
    "overview.founder_roi_title": "Founder ROI (BD R 16)",
    "overview.next_sync": "Next sync in",
    "overview.sync_running": "Sync in progress...",

    // Tabel Kolom Umum
    "col.account_name": "Account Name (Whitelist)",
    "col.remaining_balance": "Remaining Balance",
    "col.today_spend": "Today's Spend",
    "col.actions": "Actions",
    "col.detail": "Detail",
    "col.date": "Date",
    "col.campaign": "Campaign",
    "col.code": "Code",
    "col.subdomain": "Sub Domain",
    "col.spend": "Spend",
    "col.result": "Results",
    "col.cost_per_result": "Cost / Result",
    "col.note": "Notes",
    "col.total_topup": "Total TopUp (TU)",
    "col.total_spending_tax": "Total Spending + Tax (ST)",
    "col.total_earning": "Total Earnings (ER)",
    "col.profit_advertiser": "Advertiser Profit",
    "col.profit_founder": "Founder Profit",
    "col.roi_overall_advertiser": "Overall Advertiser ROI",
    "col.roi_overall_founder": "Overall Founder ROI",
    "col.total": "Total",

    // Aksi & Tombol
    "btn.save": "Save",
    "btn.cancel": "Cancel",
    "btn.delete": "Delete",
    "btn.edit": "Edit",
    "btn.add": "Add",
    "btn.refresh": "Refresh",
    "btn.filter": "Filter",
    "btn.close": "Close",
    "btn.all": "All",
    "btn.search": "Search",
    "btn.loading": "Loading...",
    "btn.confirm": "Confirm",

    // Status
    "status.synced": "Synced",
    "status.pending": "Pending",
    "status.failed": "Failed",
    "status.active": "Active",
    "status.disabled": "Disabled",
    "status.completed": "Completed",

    // Pesan Kosong & Peringatan
    "empty.no_data": "No data available",
    "empty.no_campaigns": "No campaigns found",
    "empty.no_days_completed": "No completed days in this date range",
    "empty.no_scheduled": "No scheduled campaigns at this moment.",
  },
};

export const LanguageContext = createContext({
  lang: "id",
  setLang: () => {},
  t: (key, fallback) => fallback || key,
});

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored === "en" ? "en" : "id";
    } catch {
      return "id";
    }
  });

  const setLang = (nextLang) => {
    const valid = nextLang === "en" ? "en" : "id";
    setLangState(valid);
    try {
      localStorage.setItem(STORAGE_KEY, valid);
    } catch {
      // Abaikan jika localStorage dibatasi
    }
  };

  const t = useMemo(() => {
    return (keyOrText, fallback = "") => {
      if (!keyOrText) return fallback;

      // 1. Jika Bahasa Indonesia (lang === 'id')
      if (lang === "id") {
        if (translations.id[keyOrText] !== undefined) {
          return translations.id[keyOrText];
        }
        return fallback || keyOrText;
      }

      // 2. Jika Bahasa Inggris (lang === 'en')
      // A. Cek kunci formal di kamus EN (misal 'nav.overview')
      if (translations.en[keyOrText] !== undefined) {
        return translations.en[keyOrText];
      }

      // B. Cek kamus frasa langsung (gettext-style)
      const cleanKey = String(keyOrText).trim();
      const lowerKey = cleanKey.toLowerCase();
      if (PHRASE_DICTIONARY_EN[cleanKey] !== undefined) {
        return PHRASE_DICTIONARY_EN[cleanKey];
      }
      if (PHRASE_DICTIONARY_EN[lowerKey] !== undefined) {
        return PHRASE_DICTIONARY_EN[lowerKey];
      }

      // C. Fallback ke fallback string yang diberikan
      if (fallback) return fallback;

      // D. Fallback ke kamus id jika ada
      if (translations.id[keyOrText] !== undefined) {
        return translations.id[keyOrText];
      }

      return keyOrText;
    };
  }, [lang]);

  const value = useMemo(() => ({ lang, setLang, t }), [lang, t]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  return useContext(LanguageContext);
}
