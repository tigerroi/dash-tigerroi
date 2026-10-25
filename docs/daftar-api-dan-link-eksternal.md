# 🌐 Daftar Lengkap API & Link Eksternal TigerROI (RabbitROI)

Dokumen ini mencatat seluruh integrasi API pihak ketiga (*third-party services*), endpoint URL eksternal, protokol, kebutuhan izin/kredensial, serta berkas kode yang mengelolanya untuk persiapan migrasi ke lingkungan **Production (`tigerroi.com`)**.

---

## 📑 Daftar Isi

1. [Google APIs & Layanan Google](#1-google-apis--layanan-google)
2. [Meta Marketing API (Facebook & Instagram Ads)](#2-meta-marketing-api-facebook--instagram-ads)
3. [Cloudflare API (Manajemen Domain & DNS)](#3-cloudflare-api-manajemen-domain--dns)
4. [Keitaro Tracker & Vi-Control (Gating & Traffic Cloaking)](#4-keitaro-tracker--vi-control-gating--traffic-cloaking)
5. [CloudPanel & Server VPS (Otomatisasi Hosting WordPress)](#5-cloudpanel--server-vps-otomatisasi-hosting-wordpress)
6. [WordPress REST API (RabbitROI / TigerROI Plugin)](#6-wordpress-rest-api-plugin-di-tiap-subdomain)
7. [Telegram Bot API (Notifikasi & Pengingat)](#7-telegram-bot-api-notifikasi--pengingat)
8. [Exchange Rate API (Konversi Kurs Valuta Asing)](#8-exchange-rate-api-konversi-kurs-valuta-asing)
9. [Ringkasan Variabel Lingkungan (.env) yang Dibutuhkan](#9-ringkasan-variabel-lingkungan-env)

---

## 1. Google APIs & Layanan Google

### A. Google Ad Manager (GAM) API
* **Base URL / Endpoint**: `https://admanager.googleapis.com/v1`
* **Kegunaan**:
  * Menarik laporan pendapatan harian otomatis: *Ad Exchange Revenue*, *AdSense in GAM Revenue*, dan *Ad Server Revenue*.
  * Menarik data volume impresi, klik, dan eCPM per unit iklan (*Ad Unit*) yang dipetakan ke subdomain.
* **Autentikasi**: OAuth 2.0 Access Token (Bearer Token).
* **Scope**: `https://www.googleapis.com/auth/admanager`
* **File Pengelola**:
  * [`functions/gam.js`](file:///d:/My%20file/ADS/rabbitroi-dash-main/functions/gam.js)
  * [`functions/sync-gam.mjs`](file:///d:/My%20file/ADS/rabbitroi-dash-main/functions/sync-gam.mjs)

### B. Google AdSense Management API
* **Base URL / Endpoint**: `https://adsense.googleapis.com/v2`
* **Kegunaan**:
  * Mengambil saldo akun AdSense saat ini dan total pembayaran historis (*payments*).
  * Meninjau status persetujuan situs (*site approval*) dan peringatan kebijakan (*policy alerts*).
  * Membaca daftar ad units AdSense mandiri.
* **Autentikasi**: OAuth 2.0 Access Token (Bearer Token).
* **Scope**: `https://www.googleapis.com/auth/adsense.readonly`
* **File Pengelola**:
  * [`functions/adsense.js`](file:///d:/My%20file/ADS/rabbitroi-dash-main/functions/adsense.js)
  * [`functions/sync-adsense.mjs`](file:///d:/My%20file/ADS/rabbitroi-dash-main/functions/sync-adsense.mjs)

### C. Google OAuth 2.0 Authorization Server
* **Endpoints**:
  * Authorization Endpoint: `https://accounts.google.com/o/oauth2/v2/auth`
  * Token Endpoint: `https://oauth2.googleapis.com/token`
* **Kegunaan**:
  * Alur login *consent* untuk mendapatkan `refresh_token` dan `access_token` multi-scope (Ad Manager + AdSense).
* **Kebutuhan Konsol Google Cloud**:
  * Mengaktifkan API: *Google Ad Manager API* & *AdSense Management API*.
  * Konfigurasi *OAuth 2.0 Client IDs (Web Application)*:
    * Authorized JavaScript Origins: `https://dash.tigerroi.com`, `https://tigerroi.com`
    * Authorized Redirect URIs: `https://api.tigerroi.com/auth/google/callback` dan `https://asia-southeast1-{PROJECT_ID}.cloudfunctions.net/oauth`
* **File Pengelola**:
  * [`functions/google-oauth-core.js`](file:///d:/My%20file/ADS/rabbitroi-dash-main/functions/google-oauth-core.js)
  * [`server/google-auth.js`](file:///d:/My%20file/ADS/rabbitroi-dash-main/server/google-auth.js)
  * [`functions/oauth.mjs`](file:///d:/My%20file/ADS/rabbitroi-dash-main/functions/oauth.mjs)

### D. Firebase Cloud & Realtime Database
* **Endpoints**:
  * Realtime Database: `https://{FIREBASE_PROJECT_ID}-default-rtdb.asia-southeast1.firebasedatabase.app`
  * Firebase Auth JWK: `https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com`
  * Token Issuer: `https://securetoken.google.com/{FIREBASE_PROJECT_ID}`
* **Kegunaan**:
  * Penyimpanan data operasional *realtime* (laporan ROI, subdomain, user, audit log).
  * Autentikasi sesi login pengguna dashboard dan verifikasi ID Token di backend.
* **File Pengelola**:
  * [`src/config/firebase.js`](file:///d:/My%20file/ADS/rabbitroi-dash-main/src/config/firebase.js)
  * [`server/auth.js`](file:///d:/My%20file/ADS/rabbitroi-dash-main/server/auth.js)
  * [`functions/db.mjs`](file:///d:/My%20file/ADS/rabbitroi-dash-main/functions/db.mjs)

### E. Tag Script Iklan (Sisi Frontend Website)
* **Google Publisher Tag (GPT)**: `https://securepubads.g.doubleclick.net/tag/js/gpt.js`
* **Google AdSense Tag**: `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js`
* **Kegunaan**: Injeksi otomatis tag iklan resmi ke situs WordPress via plugin.
* **File Pengelola**:
  * [`functions/gpt-inject-core.js`](file:///d:/My%20file/ADS/rabbitroi-dash-main/functions/gpt-inject-core.js)
  * [`functions/adsense-inject-core.js`](file:///d:/My%20file/ADS/rabbitroi-dash-main/functions/adsense-inject-core.js)

---

## 2. Meta Marketing API (Facebook & Instagram Ads)

* **Base URL / Endpoint**: `https://graph.facebook.com/v25.0` (atau versi API yang dikonfigurasi)
* **Autentikasi**: Header `Authorization: Bearer <META_ACCESS_TOKEN>` menggunakan **System User Long-Lived Token** dari Meta Business Manager.
* **Izin / Permissions yang Wajib**:
  * `ads_read`: Membaca data akun, sisa limit saldo (*spend cap*), mata uang, dan status akun.
  * `read_insights`: Menarik metrik belanja harian (*spend*), impresi, klik, CPC, CPR, dan CTR.
  * `ads_management`: Menyalakan atau mematikan (*toggle active/paused*) status campaign, serta menduplikasi campaign antar akun iklan.
* **Endpoints Utama**:
  * `GET /{act_id}`: Memeriksa saldo dan batas limit pengeluaran.
  * `GET /{act_id}/insights`: Mengambil data spending dan metrik performa kampanye.
  * `POST /{campaign_id}`: Mengubah status aktif/nonaktif kampanye.
  * `POST /{act_id}/campaigns`: Kloning / pembuatan armada kampanye baru.
* **File Pengelola**:
  * [`functions/meta.js`](file:///d:/My%20file/ADS/rabbitroi-dash-main/functions/meta.js)
  * [`functions/sync-meta.mjs`](file:///d:/My%20file/ADS/rabbitroi-dash-main/functions/sync-meta.mjs)
  * [`server/campaign-manage.js`](file:///d:/My%20file/ADS/rabbitroi-dash-main/server/campaign-manage.js)
  * [`server/campaign-create.js`](file:///d:/My%20file/ADS/rabbitroi-dash-main/server/campaign-create.js)

---

## 3. Cloudflare API (Manajemen Domain & DNS)

* **Base URL / Endpoint**: `https://api.cloudflare.com/client/v4`
* **Autentikasi**: Header `Authorization: Bearer <CLOUDFLARE_API_TOKEN>`
* **Izin API Token**: `Zone - DNS - Edit` dan `Zone - Zone - Read`
* **Endpoints Utama**:
  * `GET /zones`: Mencari Zone ID untuk domain induk (misal: `tigerroi.com`).
  * `GET /zones/{zone_id}/dns_records`: Membaca daftar DNS record domain.
  * `POST /zones/{zone_id}/dns_records`: Membuat DNS record tipe **A** atau **CNAME** baru saat subdomain dibuat via fitur `SetupSub`.
  * `DELETE /zones/{zone_id}/dns_records/{record_id}`: Menghapus record DNS.
* **File Pengelola**:
  * [`functions/cloudflare.js`](file:///d:/My%20file/ADS/rabbitroi-dash-main/functions/cloudflare.js)
  * [`server/cloudflare.js`](file:///d:/My%20file/ADS/rabbitroi-dash-main/server/cloudflare.js)
  * [`src/lib/cloudflareDns.js`](file:///d:/My%20file/ADS/rabbitroi-dash-main/src/lib/cloudflareDns.js)

---

## 4. Keitaro Tracker & Vi-Control (Gating & Traffic Cloaking)

### A. Vi-Control API (Gating Traffic Realtime)
* **Base URL / Endpoint**: `https://go.{domain}:8443` (diatur via `VI_CONTROL_BASE_URL`)
* **Autentikasi**: Header `X-Api-Key: <VI_CONTROL_API_KEY>`
* **Kegunaan**:
  * Membuka atau menutup gerbang trafik iklan (*Traffic Gating*).
  * Memisahkan trafik bot/pemeriksa iklan Meta dari pengunjung asli untuk mengamankan kampanye arbitrase.
* **File Pengelola**:
  * [`functions/keitaro-gate.js`](file:///d:/My%20file/ADS/rabbitroi-dash-main/functions/keitaro-gate.js)
  * [`server/gating.js`](file:///d:/My%20file/ADS/rabbitroi-dash-main/server/gating.js)
  * [`src/components/ViControl.jsx`](file:///d:/My%20file/ADS/rabbitroi-dash-main/src/components/ViControl.jsx)

### B. Keitaro Admin API
* **Base URL / Endpoint**: `https://{domain-keitaro}` (diatur via `KEITARO_BASE_URL`)
* **Autentikasi**: Header `Api-Key: <KEITARO_API_KEY>`
* **Kegunaan**:
  * Mengambil daftar kampanye aktif dan mencocokkan kode kampanye Keitaro ke subdomain.
  * Membuat landing page baru secara otomatis saat setup subdomain.
* **File Pengelola**:
  * [`functions/keitaro-admin.js`](file:///d:/My%20file/ADS/rabbitroi-dash-main/functions/keitaro-admin.js)
  * [`server/keitaro.js`](file:///d:/My%20file/ADS/rabbitroi-dash-main/server/keitaro.js)

---

## 5. CloudPanel & Server VPS (Otomatisasi Hosting WordPress)

* **Protokol**: SSH (Port 22) menggunakan SSH Key (*Public/Private Key*)
* **Skrip Otomatisasi**: [`server/cloudpanel/rabbitroi-setup-sub.sh`](file:///d:/My%20file/ADS/rabbitroi-dash-main/server/cloudpanel/rabbitroi-setup-sub.sh)
* **Kegunaan**:
  * Menjalankan perintah pembuatan *vHost* situs baru di CloudPanel melalui CLI `clpctl`.
  * Membuat database MySQL dan akun pengguna database secara otomatis.
  * Memasang WordPress via WP-CLI (`wp core install`).
  * Menerbitkan sertifikat SSL Let's Encrypt gratis via CLI CloudPanel.
  * Mengunduh, mengaktifkan, dan mengonfigurasi plugin RabbitROI / TigerROI di WordPress.
* **File Pengelola**:
  * [`server/setup-sub.js`](file:///d:/My%20file/ADS/rabbitroi-dash-main/server/setup-sub.js)

---

## 6. WordPress REST API (Plugin di Tiap Subdomain)

* **Base URL / Endpoint**: `https://{subdomain.tigerroi.com}/wp-json/rabbitroi/v1` dan `wp-json/autopost/v1`
* **Autentikasi**: Header `X-Site-Key` atau `PLUGIN_ENROLL_TOKEN`
* **Endpoints Utama**:
  * `GET /wp-json/rabbitroi/v1/ping`: Mengecek status kesehatan plugin dan konektivitas website.
  * `POST /wp-json/rabbitroi/v1/enroll`: Mendaftarkan situs baru ke sistem dashboard pusat.
  * `POST /wp-json/rabbitroi/v1/settings`: Memperbarui konfigurasi tag AdSense, unit GPT, dan proteksi iklan secara terpusat tanpa membuka wp-admin.
  * `POST /wp-json/autopost/v1/create`: Menerbitkan artikel postingan baru ke WordPress secara otomatis.
* **File Pengelola**:
  * [`functions/sync-plugin.mjs`](file:///d:/My%20file/ADS/rabbitroi-dash-main/functions/sync-plugin.mjs)
  * [`functions/autopost-core.js`](file:///d:/My%20file/ADS/rabbitroi-dash-main/functions/autopost-core.js)
  * [`server/plugin.js`](file:///d:/My%20file/ADS/rabbitroi-dash-main/server/plugin.js)

---

## 7. Telegram Bot API (Notifikasi & Pengingat)

* **Base URL / Endpoint**: `https://api.telegram.org`
* **Autentikasi**: Melalui Token Bot di path URL (`/bot<TELEGRAM_BOT_TOKEN>/...`)
* **Endpoints Utama**:
  * `POST /bot{token}/sendMessage`:
    * Mengirim pesan peringatan saldo limit iklan menipis (*low balance alert*).
    * Mengirim notifikasi lonjakan spending atau penurunan ROI tajam (*anomaly alert*).
    * Mengirim pengingat tagihan invoice perpanjangan domain yang mendekati jatuh tempo (*due date reminder*).
  * `GET /bot{token}/getUpdates`:
    * Membaca pesan masuk dari pengguna baru yang menyapa bot (`/start`) untuk didaftarkan ke grup penerima laporan.
* **File Pengelola**:
  * [`functions/telegram.mjs`](file:///d:/My%20file/ADS/rabbitroi-dash-main/functions/telegram.mjs)
  * [`functions/notifications-core.js`](file:///d:/My%20file/ADS/rabbitroi-dash-main/functions/notifications-core.js)
  * [`functions/telegram-inbox-core.js`](file:///d:/My%20file/ADS/rabbitroi-dash-main/functions/telegram-inbox-core.js)

---

## 8. Exchange Rate API (Konversi Kurs Valuta Asing)

* **Base URL / Endpoint**: `https://open.er-api.com/v6/latest/USD`
* **Karakteristik**: API Publik Gratis (Tanpa API Key, diperbarui harian).
* **Kegunaan**:
  * Menormalkan angka pendapatan Google Ad Manager (yang sering kali dalam USD) ke dalam Rupiah (IDR), sehingga perbandingan dengan biaya belanja Meta Ads (IDR) menghasilkan nilai ROI yang akurat dan tidak bias kurs.
* **File Pengelola**:
  * [`functions/fx.mjs`](file:///d:/My%20file/ADS/rabbitroi-dash-main/functions/fx.mjs)

---

## 9. Ringkasan Variabel Lingkungan (.env)

Untuk menjalankan seluruh integrasi di atas secara lengkap di production, variabel-variabel berikut harus terisi:

### File `/.env` (Frontend Dashboard):
```env
VITE_FIREBASE_API_KEY=AIzaSy...
VITE_FIREBASE_AUTH_DOMAIN=tigerroi-prod.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=tigerroi-prod
VITE_FIREBASE_STORAGE_BUCKET=tigerroi-prod.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
VITE_FIREBASE_DATABASE_URL=https://tigerroi-prod-default-rtdb.asia-southeast1.firebasedatabase.app
VITE_CONTROL_API_URL=https://api.tigerroi.com
VITE_OAUTH_FN_URL=https://asia-southeast1-tigerroi-prod.cloudfunctions.net/oauth
VITE_FUNCTIONS_ENABLED=true
```

### File `/server/.env` (Server Kontrol Backend):
```env
PORT=8080
HOST=0.0.0.0
ALLOWED_ORIGINS=https://dash.tigerroi.com,https://tigerroi.com
FIREBASE_PROJECT_ID=tigerroi-prod
SYNC_USER_EMAIL=sync@tigerroi.com
SYNC_USER_PASSWORD=...

# Meta
META_ACCESS_TOKEN=EAAB...

# Cloudflare
CLOUDFLARE_API_TOKEN=...

# Keitaro & Gating
VI_CONTROL_BASE_URL=https://go.tigerroi.com:8443
VI_CONTROL_API_KEY=...
KEITARO_BASE_URL=https://tracker.tigerroi.com
KEITARO_API_KEY=...

# Plugin & WordPress
PLUGIN_ENROLL_TOKEN=...
AUTOPOST_SECRET=...
```

### File `/functions/.env` (Cloud Functions Worker & Cron Sync):
```env
TELEGRAM_BOT_TOKEN=...
TELEGRAM_DEFAULT_CHAT_ID=...
CLOUDFLARE_API_TOKEN=...
```
