# 🎯 Aturan Pencocokan Data Site & Sub ID Keitaro Tracker (TigerROI)

Dokumen ini menjelaskan integrasi laporan Keitaro Tracker ke dashboard TigerROI, aturan hierarki pencocokan `site_code` / `sub_id`, struktur kolom CSV, dan alasan arsitektur di balik metode impor CSV.

---

## 1. Status Lisensi Keitaro Tracker masdef

* **URL Tracker**: `https://appscity.tech/admin` (Server Hetzner terpisah).
* **Paket Lisensi**: **Keitaro Advanced Edition**.
* **Ketersediaan API**:
  * ✅ **Click API**: Tersedia (digunakan untuk tracking klik, pengalihan trafik, dan parameter URL).
  * ❌ **Admin API (`/admin_api/v1`)**: **TIDAK TERSEDIA**. Berdasarkan spesifikasi resmi Keitaro, Admin API hanya disertakan pada lisensi **Expert** dan **Enterprise**. Pada paket Advanced, endpoint `/admin_api/v1` tidak dapat diakses untuk penarikan analitik otomatis.
* **Solusi Target**: **Fitur Impor CSV Laporan Keitaro** yang divalidasi dan diagregasi langsung ke tabel `daily_stats` dengan penanda `source = 'keitaro'`.

---

## 2. Cara Ekspor Laporan dari Keitaro Tracker

Untuk mendapatkan data yang presisi, lakukan ekspor dari dashboard Keitaro:
1. Login ke Keitaro: `https://appscity.tech/admin`
2. Buka menu **Reports** (Laporan) atau tab **Campaigns** (Kampanye).
3. Pilih rentang tanggal yang ingin diimpor (misal: Kemarin atau 7 Hari Terakhir).
4. Klik tombol **Export** -> pilih format **CSV**.
5. Keitaro mendukung pemisah koma (`,`), titik koma (`;`), maupun tab (`\t`). Sistem TigerROI akan **mendeteksi delimiter secara otomatis**.

---

## 3. Spesifikasi Kolom CSV yang Didukung

Sistem pengurai TigerROI (`src/lib/keitaroCsvParser.js`) sangat fleksibel dan otomatis memetakan nama kolom tanpa peduli huruf besar/kecil (*case-insensitive*):

| Kategori Data | Variasi Nama Header yang Dikenali | Keterangan |
|---|---|---|
| **Tanggal (Wajib)** | `Date`, `datetime`, `Day`, `Tanggal`, `day_of_month` | Format: `YYYY-MM-DD`, `DD.MM.YYYY`, `DD/MM/YYYY`, `YYYY-MM-DD HH:mm:ss` |
| **Pengenal Situs (Wajib salah satu)** | `Site`, `site_code`, `Sub ID 1`, `sub_id_1`, `sub_id`, `Campaign`, `campaign_name` | Kunci untuk memetakan baris ke `site_code` TigerROI |
| **Klik** | `Clicks`, `raw_clicks`, `unique_clicks`, `Klik` | Jumlah klik pengunjung |
| **Biaya (Spend)** | `Cost`, `Spend`, `Biaya`, `pengeluaran`, `ad_spend` | Biaya iklan (mendukung `$`, `Rp`, `€`, desimal koma/titik) |
| **Pendapatan (Revenue)** | `Revenue`, `Pendapatan`, `Income`, `omset` | Pendapatan konversi/postback dari Keitaro |
| **Penayangan (Impresi)** | `Impressions`, `Penayangan`, `Views` | Default sama dengan jumlah klik jika tidak disediakan |
| **Konversi** | `Conversions`, `Leads`, `Sales`, `Konversi` | Disimpan ke kolom `metadata` |

---

## 4. Aturan & Hierarki Pencocokan `site / sub_id`

Sesuai komitmen **TigerROI**, satu kode situs (`site_code`) harus **identik dan konsisten** di seluruh sistem:
- Parameter URL iklan Meta: `site` atau `sub_id`
- Nama kampanye di Keitaro
- Ad unit di Google Ad Manager (GAM)
- Kolom `site_code` di tabel database `public.sites` dan `public.daily_stats`

### 4 Domain Utama TigerROI:
| Domain WordPress | `site_code` Database | Pola Keitaro (`campaign_pattern`) |
|---|---|---|
| `ihopmenuwithprices.us` | **`ihop-menu`** | `pBRw`, `ihop` |
| `trayedit.com` | **`tray-decor`** | `TvH1`, `tray` |
| `tacobellmenuu.us` | **`taco-fries`** | `taco` |
| `tiktokmodapk.net` | **`tiktok-mod`** | `tiktok` |

### 5 Tingkat Hierarki Pencocokan (Prioritas Tertinggi ke Terendah):

1. **Pencocokan Langsung (Exact Match)**:
   - Jika kolom `Sub ID 1`, `site`, atau `site_code` berisi nama kode situs yang terdaftar (contoh: `"ihop-menu"`, `"tray-decor"`, `"taco_fries"`), sistem langsung memetakannya.
2. **Ekstraksi Parameter URL**:
   - Jika teks mengandung link atau query string (contoh: `https://go.tigerroi.com/camp?site=ihop-menu` atau `?sub_id=tray-decor`), parameter `site` diekstrak secara otomatis.
3. **Pencocokan Pola Kampanye Keitaro (`campaign_pattern`)**:
   - Nama kampanye armada Keitaro mengikuti pola bawaan:  
     `{PIC} T2 (WL) {KodeAlias} ({hostname})`  
     *Contoh:* `ACA T2 (WL) pBRw (ihopmenuwithprices.us)`
   - Kode 4-karakter unik Keitaro (contoh: `pBRw`, `TvH1`) dicocokkan dengan kolom `campaign_pattern` pada tabel `public.sites`.
4. **Pencocokan Hostname / Domain di Dalam Kurung**:
   - Sistem membaca hostname di dalam tanda kurung pada nama campaign, contoh `(ihopmenuwithprices.us)`, lalu mencocokkannya ke kolom `domain` pada tabel `public.sites`.
5. **Pencocokan Kata Kunci (Substring Match)**:
   - Jika nama campaign memuat potongan kata `site_code` (contoh: `ihop-menu` atau `tiktok-mod`).

> [!NOTE]
> Baris CSV yang tidak memenuhi salah satu dari ke-5 aturan di atas akan dikelompokkan ke dalam daftar **`unmatched`** (tidak cocok), disertai baris nomor dan kandidat teks aslinya, sehingga data yang masuk ke database dijamin 100% valid dan bersih.

---

## 5. Penyimpanan Data di Supabase (`daily_stats`)

Data laporan yang valid akan diagregasi per `(date, site_code)` lalu di-upsert ke tabel `public.daily_stats`:
* **`date`**: Tanggal metrik (`YYYY-MM-DD`).
* **`site_code`**: Kode situs resmi (`ihop-menu`, `tray-decor`, dll).
* **`source`**: Diberi nilai **`'keitaro'`** (membedakan dari `meta`, `gam`, dan `adsense`).
* **`spend`**: Total biaya iklan yang dicatat di Keitaro.
* **`revenue`**: Total pendapatan yang dicatat di Keitaro.
* **`profit`**: Otomatis dihitung oleh database PostgreSQL (`revenue - spend`).
* **`roi_percent`**: Persentase ROI `((revenue - spend) / spend) * 100`.
* **`clicks`**: Total klik teragregasi.
* **`impressions`**: Total impresi teragregasi.
* **`cpc`**: Biaya per klik `(spend / clicks)`.
* **`metadata`**: Menyimpan detail nama kampanye asli, jumlah baris CSV yang digabung, dan timestamp impor.
* **Kunci Unik**: `UNIQUE(date, site_code, source)`.

Setiap proses impor juga otomatis mencatat run log ke tabel `public.sync_runs` dengan `job_name: 'keitaro_csv_import'`, sehingga riwayat data terjaga dan proyek Supabase Free tier tetap aktif.

---

## 6. Cara Menjalankan Impor

### Opsi A: Melalui Baris Perintah (CLI Terminal)

1. **Uji Coba Terlebih Dahulu (Dry-Run, Tanpa Menulis ke DB)**:
   ```powershell
   node jobs/import-keitaro-csv.js ./laporan-keitaro.csv --dry-run
   ```
2. **Eksekusi Impor Langsung ke Supabase**:
   ```powershell
   npm run import:keitaro ./laporan-keitaro.csv
   ```
   *atau:*
   ```powershell
   node jobs/import-keitaro-csv.js ./laporan-keitaro.csv
   ```

### Opsi B: Melalui Antarmuka Dashboard (Frontend UI)

Gunakan komponen **`KeitaroCsvImportDialog`** di dashboard TigerROI:
1. Seret (*drag & drop*) atau pilih file `.csv` laporan Keitaro.
2. Sistem secara instan menampilkan ringkasan metrik (Total Baris, Klik, Biaya, Pendapatan, dan Baris Tidak Cocok).
3. Periksa pratinjau tabel 10 baris pertama.
4. Klik tombol **Simpan ke Database** untuk langsung mengunggahnya ke Supabase via autentikasi aman.
