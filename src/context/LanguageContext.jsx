import { createContext, useContext, useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "tigerroi_lang";

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
    return (key, fallback = "") => {
      if (!key) return fallback;
      const dict = translations[lang] || translations.id;
      if (dict[key] !== undefined) return dict[key];
      // Coba fallback ke kamus bahasa Indonesia jika di bahasa saat ini belum ada
      if (translations.id[key] !== undefined) return translations.id[key];
      return fallback || key;
    };
  }, [lang]);

  const value = useMemo(() => ({ lang, setLang, t }), [lang, t]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  return useContext(LanguageContext);
}
