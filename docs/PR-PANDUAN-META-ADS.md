# 📋 PR: Panduan Lengkap Setup & Integrasi Meta Ads API (TigerROI)

Dokumen ini khusus dibuat untuk **masdef** sebagai panduan Pekerjaan Rumah (PR) untuk menyiapkan integrasi Meta Ads Marketing API ke TigerROI kapan pun masdef sudah memiliki waktu luang.

---

## 📌 Status Terkini Proyek
- ✅ **Google Ad Manager (GAM) API**: **100% Tuntas & Terverifikasi**.
  - Service Account `tigerroi-reader@tigerroi-gam.iam.gserviceaccount.com` sudah aktif.
  - Ke-4 Network Code (`Trayedit`, `TikTok`, `Tacobell`, `IHOP`) berhasil ditarik laporannya dengan aman.
- ⏳ **Meta Ads API**: **Ditunda sebagai PR**. 
  - Seluruh kode sinkronisasi (`jobs/meta-client.js`, `jobs/sync-meta.js`, `jobs/test-meta-read.js`, dan workflow GitHub Actions) sudah siap 100%.
  - Hanya memerlukan **Token Akses Meta** (`META_ACCESS_TOKEN`) dan **ID Akun Iklan** (`META_ACCOUNT_IDS`).

---

## 🎯 Target yang Dibutuhkan
Ketika masdef mengerjakan PR ini nanti, yang dibutuhkan hanyalah 2 data:
1. **`META_ACCESS_TOKEN`**: Token permanen (System User Long-Lived Token) yang memiliki izin:
   - `ads_read` (membaca konfigurasi iklan/campaign)
   - `read_insights` (membaca laporan biaya/spend, impresi, klik)
2. **ID Akun Iklan** (satu atau lebih): Format diawali dengan `act_`, contoh: `act_123456789012345`.

---

## 🛠️ Langkah-demi-Langkah Pembuatan Kredensial Meta Ads

Kita menggunakan metode **System User Long-Lived Token** karena token ini **permanen (tidak kedaluwarsa setelah 60 hari)** dan tidak terikat dengan pergantian password akun Facebook pribadi.

### Langkah 1: Buat Meta Developer App
1. Buka [developers.facebook.com](https://developers.facebook.com/) dan login dengan akun Facebook Anda.
2. Di pojok kanan atas, klik **My Apps** -> klik tombol **Create App**.
3. Pada halaman pemilihan use case / skenario:
   - Pilih **Other** (atau *Manage advertising campaigns & stats* / *Business*), lalu klik **Next**.
4. Pilih App Type: **Business**, lalu klik **Next**.
5. Isi formulir:
   - **App Name**: `TigerROI Sync` (atau nama bebas yang masdef inginkan)
   - **Business Account**: Pilih Business Manager / Business Portfolio akun masdef.
6. Klik **Create App**.
7. Pada dashboard aplikasi baru tersebut, scroll dan cari produk **Marketing API**, lalu klik tombol **Set up**.

---

### Langkah 2: Buat System User di Meta Business Manager
1. Buka [business.facebook.com/settings](https://business.facebook.com/settings/) (Pengaturan Bisnis / Business Settings).
2. Pada panel navigasi di sebelah kiri:
   - Buka menu **Users** (Pengguna) -> klik **System Users** (Pengguna Sistem).
3. Klik tombol **Add** (Tambah).
4. Masukkan nama:
   - **System username**: `tigerroi-sync`
   - **System user role**: Pilih **Admin** (agar leluasa mengakses akun iklan yang dimiliki bisnis).
5. Klik **Create System User**.

---

### Langkah 3: Berikan Akses Akun Iklan ke System User
1. Masih di halaman System User (`tigerroi-sync`) yang baru saja dibuat, klik tombol **Add Assets** (Tambahkan Aset).
2. Di kolom sebelah kiri, pilih tipe aset: **Ad Accounts** (Akun Iklan).
3. Di kolom tengah, centang akun-akun iklan yang ingin ditarik datanya ke dashboard TigerROI.
4. Di panel sebelah kanan (bagian Permissions):
   - Nyalakan sakelar **View performance** / **Read-only** (hanya izin baca laporan performa iklan).
   - *Catatan*: TigerROI dirancang read-only murni untuk keamanan, tidak membutuhkan izin edit/kelola iklan.
5. Klik **Save Changes**.

---

### Langkah 4: Generate Token Permanen
1. Masih pada System User `tigerroi-sync` tersebut, klik tombol **Generate New Token**.
2. Pilih aplikasi (*Select App*): Pilih App `TigerROI Sync` yang dibuat di Langkah 1.
3. Di bagian masa berlaku (*Token Expiration*):
   - Pilih **Never** (Permanen / Tidak pernah kedaluwarsa). Jika tidak ada opsi Never, pilih durasi terpanjang (*60 days*).
4. Di daftar izin centang (*Available Permissions*), cari dan centang dua izin wajib ini:
   - ✅ **`ads_read`**
   - ✅ **`read_insights`**
5. Klik tombol **Generate Token**.
6. ⚠️ **PENTING**: Meta hanya akan menampilkan token ini **SATU KALI SAJA**.
   - Klik **Copy** lalu simpan sementara di catatan aman masdef.

---

### Langkah 5: Mencatat ID Akun Iklan (Ad Account ID)
1. Buka [adsmanager.facebook.com](https://adsmanager.facebook.com/).
2. Di sebelah kiri atas (pada dropdown pilihan akun iklan), perhatikan angka ID Akun Iklan masdef (contoh: `123456789012345`).
3. Tambahkan awalan `act_` di depannya:
   - Format: `act_123456789012345`
   - Jika memiliki lebih dari satu akun iklan, pisahkan dengan koma:
     `act_123456789012345,act_987654321098765`

---

## 🧪 Cara Mengetes Setelah Kredensial Siap

Kapan pun masdef sudah mendapatkan token dan ID akun iklan tersebut, masdef cukup menjalankan langkah pengujian sederhana berikut di terminal:

### Opsi A: Uji Cepat Langsung via Terminal
```powershell
$env:META_ACCESS_TOKEN="PASTE_TOKEN_META_MASDEF_DI_SINI"
node jobs/test-meta-read.js act_ID_AKUN_IKLAN_MASDEF
```

### Opsi B: Simpan di file `.env`
Buka file `.env` di folder root proyek, lalu lengkapi baris berikut:
```env
META_ACCESS_TOKEN=PASTE_TOKEN_META_MASDEF_DI_SINI
META_ACCOUNT_IDS=act_ID_AKUN_IKLAN_MASDEF
```
Lalu jalankan di terminal:
```powershell
node jobs/test-meta-read.js
```

### Hasil yang Diharapkan:
Skrip akan menampilkan:
- ✅ Status koneksi Meta Graph API: SUKSES
- ✅ Saldo / Limit akun iklan
- ✅ Data spend & impresi campaign 1 hari terakhir
- ✅ Pemetaan otomatis campaign ke `site_code` TigerROI

---

## 🔒 Konfigurasi di GitHub Secrets (Saat Siap Deploy)
Setelah pengujian lokal berhasil, masdef tinggal memasukkan token tersebut ke GitHub Secrets repository privat (`dash-tigerroi`):
1. Buka repositori di GitHub: `https://github.com/tigerroi/dash-tigerroi/settings/secrets/actions`
2. Tambahkan Secret:
   - Name: `META_ACCESS_TOKEN`
   - Secret: *(Token yang dibuat pada Langkah 4)*
3. Job `.github/workflows/sync-meta.yml` akan otomatis berjalan setiap 30 menit (atau 1 jam) untuk menyinkronkan biaya iklan ke Supabase secara gratis tanpa VPS.
