# Rencana Migrasi Database TigerROI: Firebase RTDB → Supabase (PostgreSQL)

Dokumen ini merinci arsitektur relasional, pemetaan tabel, aturan keamanan Row Level Security (RLS), dan mekanisme sinkronisasi data dari stack lama (Firebase Realtime Database) ke stack target (**Supabase PostgreSQL + Auth**).

---

## 1. Arsitektur & Kunci Penggabungan Data (site_code)

Sesuai aturan `AGENTS.md`:
Satu kode unik per situs (**`site_code`**) wajib konsisten di seluruh ekosistem:
1. Parameter URL iklan Meta: `site` / `sub_id` (misal: `ihop-menu`, `tray-decor`, `taco-fries`, `tiktok-mod`).
2. Kode unit iklan Google Ad Manager (GAM) / AdSense.
3. Nama campaign Keitaro Tracker.
4. Kolom `site_code` di seluruh tabel database TigerROI.

---

## 2. Pemetaan Koleksi Firebase → Tabel PostgreSQL Supabase

| Koleksi Firebase RTDB | Tabel PostgreSQL Supabase | Keterangan & Relasi |
| :--- | :--- | :--- |
| `users/{id}` & `roles/{uid}` | `profiles` | Terhubung ke `auth.users(id)` via foreign key. Menyimpan role (`superadmin`, `admin`, `user`, `advertiser`, `keuangan`), Telegram Chat ID, dan notifikasi. |
| `domains/{id}` | `domains` | Daftar domain induk WordPress. Unique `domain_url`. |
| `subDomains/{id}` | `subdomains` | Subdomain aktif. Memiliki `site_code` sebagai kunci agregasi, `parent_domain_id`, dan `pic_user_id`. |
| `adAccounts/{id}` | `ad_accounts` | Akun iklan Meta Ads (`act_...`), saldo sisa, mata uang, dan pemilik akun. |
| `adsenseAccounts/{id}` | `adsense_accounts` | Akun publisher AdSense, saldo, dan status peninjauan situs. |
| `googleApiConfigs/{id}` | `google_api_configs` | Kredensial OAuth (Client ID, Secret, Refresh Token) untuk API GAM & AdSense. **Admin-only**. |
| `userReports/{id}/campaignHistory` | `meta_daily_spend` | Belanja iklan Meta harian per `site_code`, akun, dan campaign. Unique per `(date, account_id, campaign_id)`. |
| `gamAccounts` & GAM report | `gam_daily_revenue` | Pendapatan harian GAM (AdX + AdSense in GAM) per `site_code` dan ad unit. Unique per `(date, site_code, ad_unit_name)`. |
| `dashboard/roiReports` | `daily_roi_reports` (Tabel) & `view_daily_roi` (View) | Ringkasan metrik ROI harian per `site_code`. Formula: `profit = total_revenue - meta_spend`, `roi = (profit / spend) * 100`. |
| `dashboard/countryRoi` | `country_roi` | Breakdown performa dan ROI per negara target. |
| `expenses/{id}` | `expenses` | Pengeluaran operasional dan biaya tim. Akses: Keuangan & Admin. |
| `whitelistTopup/{id}` | `whitelist_topup` | Riwayat setoran/top-up modal iklan advertiser. Akses: Keuangan & Admin. |
| `reminders/{id}` | `reminders` | Pengingat tagihan jatuh tempo domain/server. Dibaca seluruh tim, ditulis Keuangan & Admin. |
| `pluginSites/{id}` | `plugin_sites` | Cermin kesehatan plugin WordPress (versi plugin, PHP, WordPress). |
| `pluginKeys/{subdomainId}` | `plugin_keys` | API Key per situs untuk REST WordPress. **Rahasia Server** (Hanya service_role). |
| `dashboard/syncRuns` | `sync_runs` | Riwayat log eksekusi skrip sinkronisasi background cron. |

---

## 3. Matriks Hak Akses & Row Level Security (RLS)

Seluruh tabel **WAJIB** mengaktifkan RLS (`ENABLE ROW LEVEL SECURITY`).

| Tabel | Public (Anon/Unauthenticated) | Authenticated (User/Advertiser) | Keuangan | Admin / Superadmin | Service Role (Cron VPS) |
| :--- | :---: | :---: | :---: | :---: | :---: |
| `profiles` | ❌ | Baca profil sendiri & daftar tim | Baca profil sendiri & daftar tim | Baca & Edit semua | Full Access |
| `domains` | ❌ | Baca semua | Baca semua | Full Access | Full Access |
| `subdomains` | ❌ | Baca subdomain miliknya (PIC) | Baca semua | Full Access | Full Access |
| `ad_accounts` | ❌ | Baca akun miliknya | Baca semua | Full Access | Full Access |
| `adsense_accounts` | ❌ | ❌ | Baca semua | Full Access | Full Access |
| `google_api_configs` | ❌ | ❌ | ❌ | Full Access | Full Access |
| `meta_daily_spend` | ❌ | Baca sesuai `site_code` miliknya | Baca semua | Full Access | Full Access |
| `gam_daily_revenue` | ❌ | Baca sesuai `site_code` miliknya | Baca semua | Full Access | Full Access |
| `daily_roi_reports` | ❌ | Baca laporan miliknya (PIC) | Baca semua | Full Access | Full Access |
| `country_roi` | ❌ | Baca laporan miliknya (PIC) | Baca semua | Full Access | Full Access |
| `expenses` | ❌ | ❌ | Full Access | Full Access | Full Access |
| `whitelist_topup` | ❌ | ❌ | Full Access | Full Access | Full Access |
| `reminders` | ❌ | Baca semua | Full Access | Full Access | Full Access |
| `plugin_sites` | ❌ | Baca status situs miliknya | Baca semua | Full Access | Full Access |
| `plugin_keys` | ❌ | ❌ (Terblokir RLS) | ❌ (Terblokir RLS) | ❌ (Terblokir RLS) | **Full Access (Bypass)** |
| `sync_runs` | ❌ | Baca log | Baca log | Full Access | Full Access |

---

## 4. Mekanisme Eksekusi Sinkronisasi (Hetzner VPS Cron)

Skrip cron di Hetzner VPS (`jobs/`):
- Berjalan terjadwal via cron systemd (`node jobs/sync-gam.js`, `node jobs/sync-meta.js`, dst).
- Terhubung ke Supabase menggunakan **`SUPABASE_SERVICE_ROLE_KEY`** atau **`DATABASE_URL`** (koneksi Postgres direct).
- Menggunakan operasi `UPSERT` (`INSERT ... ON CONFLICT (...) DO UPDATE`) sehingga aman dijalankan berulang kali (*idempotent*).
