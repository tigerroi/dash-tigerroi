# Panduan & Tutorial Mendapatkan Kredensial API Meta Ads & Google Ad Manager

Dokumen ini adalah panduan langkah-demi-langkah untuk **masdef** dalam menyiapkan API Key resmi:
1. **Meta Ads Marketing API** (`META_ACCESS_TOKEN` & `act_ID`)
2. **Google Ad Manager (GAM) API** (`Network Code`, `client_email`, & `private_key`)

---

## DAFTAR CHECKLIST PR

- [ ] **Bagian 1: Meta Ads**
  - [ ] Membuat App di *Meta for Developers* (Marketing API)
  - [ ] Membuat *System User* permanen di Business Manager
  - [ ] Memberikan aset Akun Iklan ke System User (Izin: Read-only)
  - [ ] Generate token permanen dengan scope `ads_read` dan `read_insights`
  - [ ] Menyimpan `META_ACCESS_TOKEN` dan ID Akun Iklan (`act_...`)
- [ ] **Bagian 2: Google Ad Manager (GAM)**
  - [ ] Menyalakan akses API di Google Ad Manager
  - [ ] Mencatat `Network Code` Ad Manager
  - [ ] Membuat Service Account di *Google Cloud Console*
  - [ ] Mengunduh kunci privat JSON Service Account
  - [ ] Menambahkan email Service Account sebagai User di dashboard GAM

---

## BAGIAN 1: TUTORIAL MENDAPATKAN TOKEN META ADS API

Kita menggunakan metode **System User Long-Lived Token** (token permanen yang tidak kedaluwarsa setelah 60 hari dan tidak bergantung pada login akun Facebook pribadi).

### Langkah 1: Buat Meta Developer App
1. Buka [developers.facebook.com](https://developers.facebook.com/) dan login dengan akun Facebook Anda.
2. Klik tombol **My Apps** di pojok kanan atas, lalu klik **Create App**.
3. Pada pilihan *Use case*, pilih **Other** (atau *Manage advertising campaigns & stats* / *Business*), lalu klik **Next**.
4. Pilih tipe aplikasi: **Business**.
5. Isi **App Name** (contoh: `TigerROI Sync`) dan hubungkan ke akun **Business Manager / Business Portfolio** Anda.
6. Klik **Create App**.
7. Di halaman *App Dashboard*, cari produk **Marketing API**, lalu klik tombol **Set up**.

### Langkah 2: Buat System User di Business Manager
1. Buka [business.facebook.com/settings](https://business.facebook.com/settings/) (Pengaturan Bisnis / Business Settings).
2. Di menu sidebar kiri, buka **Users** -> pilih **System Users**.
3. Klik tombol **Add** (Tambah).
4. Beri nama (contoh: `tigerroi-sync`) dan pilih perannya sebagai **Admin** (agar leluasa mengakses akun iklan yang dimiliki bisnis).
5. Klik **Create System User**.

### Langkah 3: Beri Akses Akun Iklan ke System User
1. Masih di halaman System User yang baru dibuat, klik tombol **Add Assets** (Tambahkan Aset).
2. Pilih jenis aset **Ad Accounts** (Akun Iklan).
3. Centang semua akun iklan yang ingin disinkronkan ke dashboard TigerROI.
4. Di bagian izin sebelah kanan, nyalakan **View performance / Read-only** (cukup izin baca laporan).
5. Klik **Save Changes**.

### Langkah 4: Generate Token Permanen
1. Masih pada System User tersebut, klik tombol **Generate New Token**.
2. Pilih aplikasi (*App*) yang dibuat pada Langkah 1 tadi.
3. Di bagian masa berlaku (*Token Expiration*), pilih **Never** (Permanen/Tidak Pernah Kedaluwarsa) atau *60 days*.
4. Di daftar izin (*Permissions*), centang dua izin wajib berikut:
   - ✅ **`ads_read`** (Membaca akun iklan dan setelan campaign)
   - ✅ **`read_insights`** (Membaca laporan biaya, impresi, dan klik iklan)
5. Klik **Generate Token**.
6. ⚠️ **PENTING**: Salin token yang muncul dan simpan di pengelola kata sandi Anda. Token ini hanya ditampilkan **sekali saja** oleh Meta.

### Langkah 5: Mencatat Account ID Meta
1. Buka [adsmanager.facebook.com](https://adsmanager.facebook.com/).
2. Di bagian atas dekat dropdown akun iklan, Anda akan melihat nomor akun iklan (contoh: `123456789012345`).
3. Format yang digunakan TigerROI diawali `act_`, contoh: `act_123456789012345`.

---

## BAGIAN 2: TUTORIAL MENDAPATKAN KREDENSIAL GOOGLE AD MANAGER (GAM)

Google Ad Manager menggunakan mekanisme **Service Account Google Cloud** tanpa perlu login berulang.

### Langkah 1: Aktifkan Akses API di Google Ad Manager
1. Buka [admanager.google.com](https://admanager.google.com/) dan login.
2. Di sidebar kiri, klik **Admin** -> **Global settings** (Pengaturan Global) -> **Network settings**.
3. Catat angka **Network code** di bagian paling atas (contoh: `22123456789`). Ini adalah nomor jaringan GAM Anda.
4. Gulir ke bagian **API access**.
5. Pastikan tombol sakelar **API access** dalam posisi **Active / Enabled**.
6. Klik tombol **Save** di bagian bawah jika ada perubahan.

### Langkah 2: Buat Service Account di Google Cloud Console
1. Buka [console.cloud.google.com](https://console.cloud.google.com/).
2. Buat project baru (contoh: `tigerroi-admanager`) atau pilih project yang sudah ada.
3. Buka menu pencarian di bagian atas, cari **Google Ad Manager API**, lalu klik tombol **Enable** (Aktifkan).
4. Di sidebar kiri, pilih **IAM & Admin** -> **Service Accounts**.
5. Klik tombol **Create Service Account** di bagian atas:
   - **Service account name**: `tigerroi-gam-reader`
   - Klik **Create and Continue**, lalu klik **Done** (tidak perlu mengisi role di GCP).
6. Di daftar Service Account, klik email yang baru dibuat (formatnya: `tigerroi-gam-reader@project-id.iam.gserviceaccount.com`).
7. Buka tab **Keys** (Kunci) di bagian atas.
8. Klik **Add Key** -> **Create new key**.
9. Pilih format **JSON**, lalu klik **Create**.
10. File `.json` akan otomatis terunduh ke komputer Anda. Buka file tersebut dengan text editor (Notepad/VS Code). Anda akan melihat:
    - `"client_email"`: `tigerroi-gam-reader@...`
    - `"private_key"`: `-----BEGIN PRIVATE KEY-----\nMIIEv...`

### Langkah 3: Daftarkan Service Account ke Google Ad Manager
Agar Google Ad Manager mengenali Service Account GCP tadi:
1. Kembali ke [admanager.google.com](https://admanager.google.com/).
2. Di sidebar kiri, klik **Admin** -> **Access & authorization** (Akses & Otorisasi) -> **Users** (Pengguna).
3. Klik tombol **New user** (Pengguna Baru).
4. Isi data pengguna:
   - **Name**: `TigerROI Service Account`
   - **Email**: Masukkan email Service Account persis seperti di JSON tadi (`...@...iam.gserviceaccount.com`).
   - **Role**: Pilih **Trafficker** atau **Read Only / View Reports** (izin membaca laporan).
5. Klik **Save**. Sekarang Service Account tersebut sudah resmi menjadi pengguna Ad Manager Anda dengan hak baca laporan.

---

## TEMPAT MENYIMPAN HASIL AKHIR

Setelah semua kunci diperoleh, simpan nilainya di:

1. **Komputer Lokal (untuk uji coba di `.env`)**:
   ```env
   # Meta Ads
   META_ACCESS_TOKEN=EAABwz...
   META_ACCOUNT_ID=act_123456789012345

   # Google Ad Manager
   GAM_NETWORK_CODE=22123456789
   GAM_CLIENT_EMAIL=tigerroi-gam-reader@project-id.iam.gserviceaccount.com
   GAM_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n..."
   ```

2. **GitHub Repository Secrets (untuk GitHub Actions otomatis)**:
   Di `https://github.com/tigerroi/dash-tigerroi/settings/secrets/actions`:
   - `META_ACCESS_TOKEN`
   - `GAM_NETWORK_CODE`
   - `GAM_CLIENT_EMAIL`
   - `GAM_PRIVATE_KEY`
