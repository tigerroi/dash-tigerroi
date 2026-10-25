# 🚀 Checklist Deploy Cloudflare Worker Gateway (go.tigerroi.com)

Dokumen ini adalah panduan lengkap untuk **masdef** dalam meninjau, menguji, dan mendeploy **TigerROI Gateway** (`tigerroi-gateway/`) ke Cloudflare Workers gratis tanpa VPS.

---

## 📌 Ringkasan Gateway & Arsitektur

* **Domain Gateway**: `https://go.tigerroi.com/<slug>`
* **Fungsi Utama**: 
  1. Menjembatani URL iklan Meta / Google Ads ke kampanye Keitaro Tracker (`https://appscity.tech/<alias>`).
  2. Meneruskan seluruh parameter atribusi (`fbclid`, `utm_source`, `utm_campaign`, `sub_id`) 100% utuh tanpa terputus.
* **Prinsip Keamanan & Kepatuhan Iklan**:
  - ✅ **Perlakuan IDENTIK untuk Semua Pengunjung**: Tidak ada pengecekan User-Agent, tidak ada filter IP, tidak ada logika deteksi bot/crawler, dan tidak ada pengalihan bersyarat (*Zero Cloaking*).
  - ✅ **Konsistensi Kode**: Kode `site_code` identik dengan tabel database `public.sites`, ad unit GAM, dan kampanye tracker.

---

## 📋 Tabel Pemetaan Slug Gateway, Kode Situs, & Alias Keitaro

Semua slug telah dipetakan dan diverifikasi konsisten dengan 4 domain utama dan subdomain WordPress:

| Slug URL Gateway (`go.tigerroi.com/...`) | Kode Situs (`site_code`) | Alias Keitaro | Target Hostname WordPress | Kategori Domain |
|---|---|---|---|---|
| **`/insurance`** (atau `/tiktok-insurance`) | `tiktok-mod` | `tiktok` | `insurance.tiktokmodapk.net` | TikTok Mod APK (Subdomain 1) |
| **`/careers`** (atau `/tiktok-careers`) | `tiktok-mod` | `tiktok` | `careers.tiktokmodapk.net` | TikTok Mod APK (Subdomain 2) |
| **`/rewards`** (atau `/tiktok-rewards`) | `tiktok-mod` | `tiktok` | `rewards.tiktokmodapk.net` | TikTok Mod APK (Subdomain 3) |
| **`/mod`** (atau `/tiktok-mod`, `/tiktok`) | `tiktok-mod` | `tiktok` | `mod.tiktokmodapk.net` | TikTok Mod APK (Subdomain 4) |
| **`/cantina`** (atau `/taco-cantina`) | `taco-fries` | `taco` | `cantina.tacobellmenuu.us` | Taco Bell (Subdomain 5) |
| **`/burrito`** (atau `/grilledcheeseburrito`) | `taco-fries` | `taco` | `burrito.tacobellmenuu.us` | Taco Bell (Subdomain 6) |
| **`/fries`** (atau `/taco-fries`, `/taco`) | `taco-fries` | `taco` | `fries.tacobellmenuu.us` | Taco Bell (Subdomain 7) |
| **`/decor`** (atau `/decor-ideas`, `/tray`) | `tray-decor` | `TvH1` | `decor.trayedit.com` | Tray Decor (Subdomain 8) |
| **`/materials`** (atau `/tray-materials`) | `tray-decor` | `TvH1` | `materials.trayedit.com` | Tray Decor (Subdomain 9) |
| **`/cabinets`** (atau `/tray-cabinets`) | `tray-decor` | `TvH1` | `cabinets.trayedit.com` | Tray Decor (Subdomain 10) |
| **`/guides`** (atau `/tray-guides`) | `tray-decor` | `TvH1` | `guides.trayedit.com` | Tray Decor (Subdomain 11) |
| **`/styling`** (atau `/tray-styling`) | `tray-decor` | `TvH1` | `styling.trayedit.com` | Tray Decor (Subdomain 12) |
| **`/menu`** (atau `/ihop-menu`, `/ihop`) | `ihop-menu` | `pBRw` | `menu.ihopmenuwithprices.us` | IHOP Menu (Subdomain 13) |
| **`/deals`** (atau `/ihop-deals`) | `ihop-menu` | `pBRw` | `deals.ihopmenuwithprices.us` | IHOP Deals (Subdomain 14) |
| **`/keto`** (atau `/ihop-keto`) | `ihop-menu` | `pBRw` | `keto.ihopmenuwithprices.us` | IHOP Keto (Subdomain 15) |
| **`/hacks`** (atau `/ihop-hacks`) | `ihop-menu` | `pBRw` | `hacks.ihopmenuwithprices.us` | IHOP Hacks (Subdomain 16) |
| **`/news`** (atau `/ihop-news`) | `ihop-menu` | `pBRw` | `news.ihopmenuwithprices.us` | IHOP News (Subdomain 17) |

---

## 🛠️ Checklist Langkah-demi-Langkah Deploy ke Cloudflare

### Langkah 1: Pengaturan DNS di Dashboard Cloudflare
1. Buka [dash.cloudflare.com](https://dash.cloudflare.com/) dan pilih zona domain **`tigerroi.com`**.
2. Buka menu **DNS** -> **Records**.
3. Tambahkan DNS Record baru untuk subdomain gateway:
   - **Type**: `CNAME`
   - **Name**: `go`
   - **Target**: `tigerroi.com` (atau `100::` jika menggunakan format AAAA dummy)
   - **Proxy status**: **Proxied (Awan Oranye / Aktif)** ☁️
   - **TTL**: Auto
4. Klik **Save**.

---

### Langkah 2: Menjalankan Unit Test Lokal
Sebelum deploy, pastikan seluruh pengujian parameter dan respons identik lulus:
```powershell
node --test tigerroi-gateway/src/index.test.mjs
```
*Hasil yang diharapkan: 7/7 test PASS (100% Lulus).*

---

### Langkah 3: Deploy Menggunakan Wrangler
1. Buka terminal di folder proyek:
   ```powershell
   cd "D:\My file\ADS\rabbitroi-dash-main\tigerroi-gateway"
   ```
2. Login ke akun Cloudflare (hanya dilakukan sekali di browser):
   ```powershell
   npx wrangler login
   ```
3. Deploy Worker ke Cloudflare:
   ```powershell
   npx wrangler deploy
   ```
4. Output Wrangler akan menampilkan:
   ```
   Total Upload: ... KiB / gzip: ... KiB
   Uploaded tigerroi-gateway (0.xx sec)
   Deployed tigerroi-gateway triggers
     - go.tigerroi.com/*
   ```

---

## 🧪 Cara Mengetes Gateway Setelah Deploy

### Uji 1: Memeriksa Endpoint Health
Buka di browser atau terminal:
```powershell
curl -i https://go.tigerroi.com/health
```
*Respons:* HTTP 200 OK dengan JSON `{"status":"ok","service":"tigerroi-gateway"}`.

### Uji 2: Memeriksa Parameter `fbclid` & `UTM` Tetap Utuh
Jalankan di terminal:
```powershell
curl -I "https://go.tigerroi.com/ihop-menu?fbclid=TEST_FBCLID_12345&utm_source=facebook&utm_medium=cpc&utm_campaign=ihop_promo"
```
*Respons yang Diharapkan:*
- Status: **`HTTP/2 302`**
- Header **`Location`**:
  ```
  https://appscity.tech/pBRw?fbclid=TEST_FBCLID_12345&utm_source=facebook&utm_medium=cpc&utm_campaign=ihop_promo&site=ihop-menu&sub_id_1=ihop-menu
  ```
*Perhatikan: Seluruh parameter `fbclid` dan `UTM` tidak ada yang terpotong sedikit pun.*

### Uji 3: Memastikan Respons Identik Antara Reviewer Iklan & Pengunjung Biasa
Jalankan uji dengan User-Agent Meta Crawler:
```powershell
curl -I -A "facebookexternalhit/1.1" "https://go.tigerroi.com/tiktok-mod?fbclid=TEST_123"
```
Lalu bandingkan dengan User-Agent HP Android / iPhone:
```powershell
curl -I -A "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" "https://go.tigerroi.com/tiktok-mod?fbclid=TEST_123"
```
*Hasil:* Keduanya menerima header `Location` dan status `302` yang persis sama ke kampanye Keitaro tujuan, tanpa adanya perlakuan berbeda.
