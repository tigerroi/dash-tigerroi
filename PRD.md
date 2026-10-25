# PRD - Refactor Admin Dashboard RabbitROI ke React + Firebase Realtime Database

## 1. Ringkasan Produk

RabbitROI adalah admin dashboard untuk mengelola data operasional RabbitROI Data Center, termasuk user/PIC, domain, subdomain, whitelist, ad account Meta, Adsense account, Google API credential, serta dashboard monitoring ROI.

Project saat ini berupa kumpulan file HTML statis dengan data contoh yang sudah tertanam di markup. Refactor ini bertujuan mengubah dashboard menjadi aplikasi React modern dengan data mockup pada fase awal, lalu terhubung ke Firebase Realtime Database, dan akhirnya siap production.

## 2. Tujuan

- Mengubah seluruh halaman HTML admin dashboard menjadi aplikasi React single page app.
- Mempertahankan tampilan, struktur informasi, dan behavior utama dari file HTML dan screenshot yang sudah disediakan.
- Membuat data mockup dari sample data yang ada di HTML agar development tidak menunggu database.
- Menyiapkan arsitektur data yang mudah dipindahkan dari mockup ke Firebase Realtime Database.
- Menambahkan login page dan protected dashboard routes.
- Menyiapkan aplikasi agar siap digunakan di production pada phase 3.

## 3. Scope Modul

### 3.1 Login Page

Sumber: `login.html`

Fitur:

- Form login dengan field `username` dan `password`.
- CTA `Enter Dashboard`.
- Branding `ROI Center`.
- Setelah login sukses, user diarahkan ke dashboard.
- Pada phase 1, authentication menggunakan mock auth.
- Pada phase 2, authentication menggunakan Firebase Authentication atau mekanisme auth Firebase yang disepakati.

### 3.2 Dashboard / Overview

Sumber: `wizard mapping/index.html`

Fitur:

- Overview dashboard.
- Summary cards:
  - Total Users
  - Active Domains
  - Managed Campaigns
- Section welcome: `Welcome to Database Pusat ROI`.
- Grafik ROI dan filter data.
- Monitor Saldo & Spend Advertiser.
- Report Master Realtime ROI.
- Tabel monitor advertiser dengan kolom:
  - PIC / User
  - Sisa Saldo
  - Pengeluaran Hari Ini
  - Aksi
- Tabel report master dengan kolom:
  - NO
  - Date
  - Time
  - Campaign
  - Meta Ads
  - Adsense
  - ROI (%)
  - Profit
  - Sub-Domain
  - Meta M.
  - Ads M.
  - WL
  - Meta Balance
  - Plugin On
  - Spending
  - Fluktuasi Spending
  - Earning
  - Fluktuasi Earning
  - ROI
  - Fluktuasi ROI
  - Clicks
  - CPC
  - Page RPM
  - CPR

### 3.3 Users

Sumber:

- `users/index.html`
- `users/add-user.html`

Fitur:

- List data users.
- Search `Cari data...`.
- Tambah user.
- Edit user.
- Delete user.
- Tabel dengan kolom:
  - Nama PIC
  - Username
  - Email
  - Role
  - Telegram ID
  - Actions
- Form field:
  - Nama
  - Email Address
  - Role: `admin`, `user`
  - Telegram Chat ID

### 3.4 Data Domains

Sumber:

- `data domains/index.html`
- `data domains/add domain.html`

Fitur:

- List domain biasa.
- Tambah domain.
- Edit domain.
- Delete domain.
- Tabel dengan kolom:
  - URL Domain
  - Kode Jaringan
  - Status
  - Actions
- Form field:
  - Domain URL
  - User Pemilik
  - Kode Jaringan (AdX)

### 3.5 Data Sub Domains

Sumber:

- `data sub domains/index.html`
- `data sub domains/add sub domain.html`

Fitur:

- List subdomain.
- Search `Cari subdomain, domain, atau PIC...`.
- Tambah subdomain.
- Edit subdomain.
- Delete subdomain.
- Tabel dengan kolom:
  - Sub Domain
  - Domain Induk
  - PIC / User
  - Status
  - Actions
- Form field:
  - Subdomain Lengkap
  - Domain Induk
  - PIC / User Pemilik

### 3.6 Data Whitelist

Sumber:

- `data whitelist/index.html`
- `data whitelist/add whitelist.html`

Fitur:

- List whitelist.
- Search `Cari data...`.
- Tambah whitelist.
- Edit whitelist.
- Delete whitelist.
- Tabel dengan kolom:
  - Label
  - URL / Domain
  - Status
  - Actions
- Form field:
  - Label
  - URL / Domain
  - Status: `active`, `inactive`

### 3.7 Data Ad Account

Sumber:

- `data ad account/index.html`
- `data ad account/add ad account.html`

Fitur:

- List Meta ad account.
- Search `Cari data...`.
- Tambah ad account.
- Edit ad account.
- Delete ad account.
- Tabel dengan kolom:
  - Nama Akun Ads
  - ACT ID Meta
  - Actions
- Form field:
  - Nama Akun
  - Act ID Meta

### 3.8 Data Adsense Accounts

Sumber:

- `data adsense accounts/index.html`
- `data adsense accounts/add adsense account.html`

Fitur:

- List Adsense accounts.
- Search `Cari data...`.
- Tambah Adsense account.
- Edit Adsense account.
- Delete Adsense account.
- Tabel dengan kolom:
  - Nama Domain
  - ID Publisher
  - Status Akun
  - Email Akun
  - Pass Akun
  - Total Payout
  - Google A
  - Kode Customer
  - Nomor HP
  - Email Pemulihan
  - Negara
  - EXP Domain
  - Email Domain
  - Pass Domain
  - Server
  - Username WP
  - Password WP
  - Saldo
  - Nama Di Rekening
  - No Rekening
  - Kode Jaringan
  - Actions
- Form field:
  - Nama Domain
  - Publisher ID
  - Koneksi Google API
  - Status
  - Email Akun
  - Password Akun
  - Total Payout
  - Kode Customer
  - Nomor HP
  - Email Pemulihan
  - EXP Domain
  - Server
  - Saldo
  - Nama Rekening
  - No Rekening
  - Kode Jaringan

### 3.9 Google API Config

Sumber:

- `google api config/index.html`
- `google api config/add google api config.html`

Fitur:

- List Google API credentials.
- Tambah credential.
- Edit credential.
- Delete credential.
- Tabel dengan kolom:
  - Nama Akun/Client
  - Client ID
  - Status Koneksi
  - Actions
- Form field:
  - Nama Kredensial / Pemilik
  - Google Client ID
  - Google Client Secret

## 4. User Roles

### Admin

- Bisa mengakses seluruh modul.
- Bisa membuat, membaca, mengubah, dan menghapus data.
- Bisa melihat data credential sensitif sesuai aturan keamanan production.

### User / PIC

- Bisa melihat data yang berhubungan dengan dirinya.
- Hak CRUD dibatasi sesuai kebutuhan bisnis.
- Detail permission final perlu dikonfirmasi sebelum phase 2.

## 5. Routing React

Rute yang disarankan:

- `/login`
- `/dashboard`
- `/users`
- `/users/new`
- `/users/:id/edit`
- `/domains`
- `/domains/new`
- `/domains/:id/edit`
- `/sub-domains`
- `/sub-domains/new`
- `/sub-domains/:id/edit`
- `/whitelists`
- `/whitelists/new`
- `/whitelists/:id/edit`
- `/ad-accounts`
- `/ad-accounts/new`
- `/ad-accounts/:id/edit`
- `/adsense-accounts`
- `/adsense-accounts/new`
- `/adsense-accounts/:id/edit`
- `/google-api-configs`
- `/google-api-configs/new`
- `/google-api-configs/:id/edit`

## 6. UI/UX Requirements

- Desain mengikuti screenshot dan HTML lama: dark theme, sidebar, card dashboard, table-heavy admin layout.
- Layout harus responsive untuk desktop dan mobile.
- Sidebar dapat collapse atau berubah menjadi drawer pada mobile.
- Table harus mendukung horizontal scroll untuk kolom yang sangat banyak, terutama Adsense Accounts dan Report Master ROI.
- Setiap list page minimal memiliki:
  - Header title.
  - Search/filter jika ada di HTML.
  - Tombol tambah data.
  - Empty state.
  - Loading state.
  - Error state.
  - Action edit/delete.
- Form page minimal memiliki:
  - Validasi required.
  - Cancel/back action.
  - Submit state.
  - Success/error feedback.

## 7. Data Mockup Phase 1

Data mockup diambil dari sample data yang sudah ada di file HTML. Struktur mockup disarankan dipisah per modul:

- `mockUsers`
- `mockDomains`
- `mockSubDomains`
- `mockWhitelists`
- `mockAdAccounts`
- `mockAdsenseAccounts`
- `mockGoogleApiConfigs`
- `mockDashboardStats`
- `mockAdvertiserSpend`
- `mockRoiReports`

Semua halaman pada phase 1 harus berjalan penuh menggunakan mock data tanpa koneksi database.

## 8. Firebase Realtime Database Phase 2

Struktur node awal yang disarankan:

```text
/users/{userId}
/domains/{domainId}
/subDomains/{subDomainId}
/whitelists/{whitelistId}
/adAccounts/{adAccountId}
/adsenseAccounts/{adsenseAccountId}
/googleApiConfigs/{credentialId}
/dashboard/roiReports/{reportId}
/dashboard/advertiserSpend/{spendId}
```

Setiap record disarankan memiliki metadata:

```text
id
createdAt
createdBy
updatedAt
updatedBy
deletedAt
```

Untuk phase 2, implementasi Firebase harus mencakup:

- Firebase app initialization via environment variables.
- Realtime listener untuk list data.
- Create/update/delete data.
- Protected route setelah login.
- Database rules sesuai role.
- Mapping layer agar komponen React tidak bergantung langsung ke struktur Firebase mentah.

## 9. Security Requirements

- Firebase config tidak di-hardcode di repository; gunakan `.env`.
- Google Client Secret, password akun, password domain, password WP, dan credential sensitif harus diperlakukan sebagai data rahasia.
- Pada production, field sensitif tidak boleh tampil plain text secara default.
- Tambahkan show/hide control untuk field password jika tetap perlu dilihat admin.
- Validasi input dilakukan di client dan diamankan lagi oleh Firebase rules.
- Role-based access wajib tersedia sebelum production.
- Delete production sebaiknya soft delete, bukan hard delete langsung.

## 10. Non-Functional Requirements

- Aplikasi cepat dibuka dan tidak memuat semua data besar sekaligus tanpa pagination/filter.
- Table besar harus tetap usable dengan scroll, sticky header, atau pagination.
- State management sederhana dan mudah dirawat.
- Komponen form/table bisa dipakai ulang antar modul.
- Kode mudah dipindahkan dari mock service ke Firebase service.
- Build production bebas error TypeScript/lint jika TypeScript digunakan.

## 11. Tech Stack Rekomendasi

- React
- Vite
- React Router
- Firebase SDK
- Tailwind CSS
- Lucide React untuk icon
- Optional:
  - TypeScript untuk type safety.
  - TanStack Table untuk table kompleks.
  - React Hook Form + Zod untuk form validation.

## 12. Phase Plan

### Phase 1 - React App dengan Mock Data

Objective:
Membangun ulang seluruh dashboard sebagai React app menggunakan data mockup dari HTML.

Deliverables:

- Setup React app.
- Implement layout utama: sidebar, topbar/header, protected shell.
- Implement login page dengan mock authentication.
- Implement dashboard overview.
- Implement semua list page dan form page:
  - Users
  - Domains
  - Sub Domains
  - Whitelists
  - Ad Accounts
  - Adsense Accounts
  - Google API Configs
- Extract sample data HTML menjadi mock data.
- Implement search/filter dasar.
- Implement mock CRUD di state lokal.
- Responsive UI sesuai screenshot.

Acceptance Criteria:

- Semua halaman dari folder project saat ini sudah memiliki versi React.
- Aplikasi bisa dijalankan tanpa Firebase.
- Login mock bisa mengarahkan user ke dashboard.
- Data list dan form tampil menggunakan mock data.
- Search/filter bekerja pada page yang memilikinya.
- Tidak ada halaman kosong untuk modul yang sudah ada di HTML.

### Phase 2 - Integrasi Firebase Realtime Database

Objective:
Mengganti mock data service dengan Firebase Realtime Database dan auth.

Deliverables:

- Setup Firebase project config via `.env`.
- Implement Firebase Authentication.
- Implement Firebase Realtime Database service layer.
- Migrasi CRUD per modul ke Firebase.
- Implement realtime listener untuk table/list data.
- Implement database rules berdasarkan role.
- Seed/import data awal dari mock data jika diperlukan.
- Implement loading/error state dari Firebase.

Acceptance Criteria:

- Login menggunakan Firebase auth.
- Data list berubah realtime saat data diubah.
- Create/update/delete tersimpan di Firebase.
- User tanpa login tidak bisa mengakses dashboard.
- Permission admin/user mulai diterapkan.
- Tidak ada credential rahasia yang tersimpan di source code.

### Phase 3 - Ready to Production

Objective:
Menyiapkan aplikasi agar aman, stabil, dan layak deploy.

Deliverables:

- Finalisasi role-based access.
- Review dan hardening Firebase security rules.
- Audit field sensitif.
- Implement pagination/filter untuk table besar.
- Add confirmation modal untuk delete.
- Add toast/notification untuk success/error.
- Add production build pipeline.
- Add environment documentation.
- Add QA checklist berdasarkan screenshot.
- Deploy ke hosting yang disepakati.

Acceptance Criteria:

- Production build berhasil tanpa error.
- Firebase rules sudah diuji untuk admin dan user.
- Data sensitif tidak tampil sembarangan.
- Semua modul utama lolos smoke test.
- UI sesuai screenshot dalam batas refactor React.
- Dashboard usable di desktop dan mobile.
- Dokumentasi setup dan deploy tersedia.

## 13. Suggested Component Structure

```text
src/
  app/
    router.tsx
  components/
    layout/
    table/
    form/
    feedback/
  features/
    auth/
    dashboard/
    users/
    domains/
    sub-domains/
    whitelists/
    ad-accounts/
    adsense-accounts/
    google-api-configs/
  data/
    mock/
  services/
    mock/
    firebase/
  types/
  utils/
```

## 14. Open Questions

- Apakah login production akan memakai Firebase Authentication username/password, email/password, atau custom auth?
- Apakah role `user` hanya boleh melihat data miliknya sendiri, atau boleh melihat semua data tetapi tidak bisa edit/delete?
- Field password dan secret pada Adsense/Google API perlu disimpan plain, dienkripsi client-side, atau dipindahkan ke backend/server function?
- Apakah dashboard ROI akan tetap input manual dari Firebase, atau nantinya menarik data dari API eksternal seperti Meta Ads/Google Adsense?
- Apakah delete data harus soft delete untuk semua modul?
- Apakah ada target hosting tertentu: Firebase Hosting, Vercel, Netlify, atau server sendiri?

## 15. Out of Scope Sementara

- Integrasi langsung Meta Ads API.
- Integrasi langsung Google Adsense API selain penyimpanan Google API config.
- Backend custom di luar Firebase.
- Migrasi data production dari sistem lama, kecuali seed dari data HTML/mock.
- Advanced analytics di luar report yang sudah terlihat pada HTML/screenshot.
