# Panduan Penyiapan Firebase (TigerROI)

Dokumen ini berisi checklist langkah manual untuk menyambungkan project Firebase baru (`dashboard-tigerroi`), inisialisasi superadmin, dan penjelasan aturan database (`database.rules.json`).

---

## 1. Checklist Manual di Firebase Console

Buka [Firebase Console](https://console.firebase.google.com/) dan pilih project **`dashboard-tigerroi`**:

### Langkah 1: Upgrade ke Paket Blaze (Pay as you go)
- **Tujuan:** Cloud Functions memerlukan akses jaringan keluar (*outbound internet access*) untuk menghubungi Meta Graph API, Google Ad Manager, Telegram API, dan Cloudflare. Paket gratis (Spark) membatasi koneksi hanya ke layanan Google.
- **Tindakan:** Klik **Upgrade** di pojok kiri bawah konsol dan pilih **Blaze Plan**. Atur *budget alert* (misal $5 atau $10) untuk memantau pemakaian.

### Langkah 2: Aktifkan Firebase Authentication
1. Buka menu **Build** > **Authentication** > klik **Get Started**.
2. Masuk ke tab **Sign-in method**:
   - Aktifkan provider **Email/Password**.
   - Aktifkan provider **Google** (pilih email support project).
3. Masuk ke tab **Users**:
   - Klik **Add user**.
   - Buat akun utama Anda (email & password).
   - **Salin nilai `User UID`** akun tersebut.

### Langkah 3: Buat Akun Khusus Background Sync (`SYNC_USER`)
1. Di tab **Users**, klik **Add user** lagi.
2. Buat akun sistem (contoh: `sync@tigerroi.internal`).
3. **Salin nilai `User UID`** akun sync ini.
4. Nilai email & password akun ini diisikan ke:
   - `functions/.env.sync` (`SYNC_USER_EMAIL` dan `SYNC_USER_PASSWORD`)
   - `server/.env` (`SYNC_USER_EMAIL` dan `SYNC_USER_PASSWORD`)

### Langkah 4: Aktifkan Realtime Database (RTDB)
1. Buka menu **Build** > **Realtime Database** > klik **Create Database**.
2. **PILIH REGION: Singapore (`asia-southeast1`)**  
   *(Semua konfigurasi TigerROI disetel ke region ini. Jangan memilih US).*
3. Pilih **Start in locked mode** lalu klik **Enable**.
4. Catat URL database:  
   `https://dashboard-tigerroi-default-rtdb.asia-southeast1.firebasedatabase.app`

### Langkah 5: Pasang Aturan Keamanan Database (`database.rules.json`)
1. Buka tab **Rules** di Realtime Database.
2. Salin seluruh isi dari file [`database.rules.json`](../database.rules.json) di repo ini ke editor Firebase Console.
3. Klik **Publish**.

### Langkah 6: Inisialisasi Akun Superadmin Pertama (Bootstrap Role)
Aturan database melarang penulisan apa pun tanpa role `admin` atau `superadmin`. Karena database baru masih kosong, role pertama harus dimasukkan manual dari konsol:
1. Buka tab **Data** di Realtime Database.
2. Klik tombol tambah **(+)** di bawah root:
   - **Name:** `roles`
3. Klik tanda tambah **(+)** di dalam node `roles`:
   - **Name:** `<UID_user_utama_masdef_dari_Langkah_2>`
   - **Value:** `"superadmin"`
4. Klik tanda tambah **(+)** lagi di dalam node `roles`:
   - **Name:** `<UID_user_sync_dari_Langkah_3>`
   - **Value:** `"admin"`
5. Klik **Add**.

---

## 2. Analisis Keamanan `database.rules.json`

Aturan database ini dirancang dengan pengamanan tingkat tinggi:

1. **Akses Publik Tertutup (Zero Public Access)**:
   - Tidak ada aturan `.read: true` maupun `.write: true`. Siapa pun yang tidak terautentikasi ditolak 100%.
2. **Role-Based Access Control (RBAC)**:
   - Dipisahkan ke dalam peran: `superadmin`, `admin`, `user`, `advertiser`, `keuangan`, `guest`.
3. **Isolasi Node Rahasia**:
   - `/otpSecrets`: Hanya terbaca dan tertulis oleh `superadmin`.
   - `/pluginKeys` dan `/googleApiConfigs`: Hanya `admin` dan `superadmin`.
   - Node Finansial (`/expenses`, `/payouts`, dll.): Hanya divisi `keuangan` dan `admin/superadmin`.
4. **Validasi Skema Ketat (`.validate`)**:
   - Membatasi tipe data dan panjang string.
   - Aturan `"$other": { ".validate": false }` mencegah penambahan field liar yang tidak dikenal.

---

## 3. Skrip Pengujian Koneksi Firebase

Setelah mengisi file `.env` di root, jalankan pengujian login dan baca/tulis:
```powershell
npm run test:firebase
```
Skrip ini akan memverifikasi:
- Autentikasi email & password
- Pembacaan role di `/roles/{uid}`
- Hak akses baca ke database
- Hak akses tulis ke `/dashboard/smokeTest` lalu membersihkannya kembali
