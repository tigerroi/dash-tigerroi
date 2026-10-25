# RabbitROI Database Schema

Dokumen ini merangkum struktur data Firebase Realtime Database yang digunakan oleh project RabbitROI Dashboard, termasuk relasi antar data yang dipakai di UI.

## Struktur Root

```text
/
  users/
  userReports/
  domains/
  subDomains/
  reminders/
  adAccounts/
  adsenseAccounts/
  googleApiConfigs/
  pluginSites/
  pluginKeys/
  dashboard/
    stats
    weeklyFinancials
    advertiserSpend
    roiReports
    roiSnapshots
    reminderNotices
    gating/
  settings/
    roi
    telegram
```

## Relasi Utama

| Data | Relasi |
| --- | --- |
| `domains.userOwner` | Mengarah ke `users.name` |
| `subDomains.parentDomain` | Mengarah ke `domains.domainUrl` |
| `subDomains.pic` | Mengarah ke `users.name` |
| `dashboard.roiReports.pic` | Mengarah ke `users.name` |
| `dashboard.roiReports.subDomain` | Mengarah ke `subDomains.name` |
| `dashboard.roiSnapshots.subDomain` | Mengarah ke `subDomains.name` (baris per sync, bentuknya sama) |
| `dashboard.advertiserSpend.userId` | Dipakai untuk link ke `/users/{id}` |
| `userReports/{id}.countryRoi.subDomain` | Mengarah ke subdomain milik user |
| `users/{id}.masterRoiReports.subDomain` | Mengarah ke subdomain milik user |
| `adsenseAccounts.publisherId` | Identitas utama Adsense Account untuk sync/status per akun |
| `adsenseAccounts.googleCredential` | Opsional, mengarah ke `googleApiConfigs.name`; kosong berarti memakai credential default dari `.env` |

> Catatan: relasi saat ini belum memakai foreign key formal. Banyak relasi masih berbasis string seperti `users.name`, `domains.domainUrl`, dan `subDomains.name`.

## Collections

### `users/{id}`

Menyimpan data user/team dan data detail profile user.

```text
users/{id}
  id
  name
  username
  email
  role: admin | user | advertiser
  telegramChatId        // ditulis admin ATAU orangnya sendiri (aturan cocok lewat email)
  notificationTopics/{topik}   // boolean per topik: reminders | roiAlerts | syncIssues
  totalBalance
  createdAt
  createdBy
  updatedAt
  updatedBy

  subDomains[]          // optional nested data profile
  adAccounts[]          // optional nested data profile
  campaigns[]           // data campaign user
  campaignCommands/     // antrean saklar on/off per campaign
  masterRoiReports[]    // report realtime khusus user
  roiReports[]          // fallback report user
```

Riwayat panel Profile User (`campaignHistory`, `countryRoi`, `dailySpend`, `balanceSnapshots`) TIDAK
lagi di sini — lihat `userReports/{id}` di bawah.

Relasi:

- `subDomains[].name` cocok dengan `subDomains.name`.
- `adAccounts[]` dapat fallback dari collection root `adAccounts`.
- `masterRoiReports[].subDomain` dan `userReports/{id}.countryRoi[].subDomain` cocok dengan
  subdomain milik user.

### `userReports/{id}`

Riwayat yang cuma dibaca dua layar: panel-panel di `/users/{id}`, dan rincian negara tiap baris
tabel "Laporan ROI Realtime" (`countryRoi` saja). Kuncinya user id yang sama dengan `users/{id}`.

```text
userReports/{id}
  campaignHistory/{tanggal__akun__campaignId}   // riwayat spend campaign per-hari (90 hari)
  countryRoi/{tanggal__subdomain__negara}       // ROI per negara (ditulis ulang utuh tiap sync)
  dailySpend/{tanggal__akun__campaign}          // riwayat saldo berkurang (30 hari)
  balanceSnapshots/{waktu__akun}                // log saldo per-sync (60 baris terakhir)
```

Kenapa ia berdiri sendiri dan bukan cabang di bawah `users/{id}`: `users` dilanggan browser SETIAP
akun pada SETIAP muat halaman — ia yang memberi nama, PIC, dan baris campaign ke hampir tiap layar
— dan keempat riwayat ini 2,81 MB dari 3,12 MB node itu (8 Sep 2026). Selama mereka tinggal di sana,
orang yang cuma membuka Domains mengunduh riwayat spend campaign 90 hari milik lima advertiser untuk
menggambar tabel domain. `countryRoi` menambah satu lagi yang tidak terlihat di angka muat halaman:
ia ditulis ulang UTUH tiap sync, jadi tiap tab yang dibiarkan terbuka menerima 745 KB delta per jam.

Aturannya sama persis dengan `users` (`.read: auth != null`, `.write` admin) — memisahkan datanya
bukan menutupnya. Dilanggan sisi UI lewat `useStickyValue` + `needsUserReports`, jadi ia hanya
diunduh oleh sesi yang benar-benar membuka salah satu dari kedua layar itu. Aturan bacanya (cabang
baru menang, `users/{id}` jadi cadangan sampai migrasi jalan) ada di `src/lib/userReports.js`.

Penulisnya: `sync-meta.mjs` (tiga cabang pertama kecuali countryRoi) dan `sync-subdomains.mjs`
(`countryRoi`). Riwayat lama dipindahkan sekali oleh `npm run migrate:user-reports`.

Kolom yang tampil di halaman `/users`:

| Field DB | Label UI | Catatan |
| --- | --- | --- |
| `name` | Nama PIC | Required di form |
| `username` | Username | Required di form |
| `email` | Email | Required di form |
| `role` | Role | `admin`, `user`, `advertiser` |
| `telegramChatId` | Telegram ID | Optional; juga bisa diisi orangnya sendiri di `/notifications` |

Field yang saat ini ada di form add/edit:

```text
name
username
email
role
telegramChatId
```

### `domains/{id}`

Menyimpan domain utama.

```text
domains/{id}
  id
  domainUrl
  userOwner
  networkCode
  status: Active | Inactive
  createdAt
  createdBy
  updatedAt
  updatedBy
```

Relasi:

- `userOwner` mengambil nilai dari `users.name`.

Kolom yang tampil di halaman `/domains`:

| Field DB | Label UI | Catatan |
| --- | --- | --- |
| `domainUrl` | URL Domain | Required di form |
| `networkCode` | Kode Jaringan | Number, required di form |
| `status` | Status | `Active`, `Inactive` |

Field yang saat ini ada di form add/edit:

```text
domainUrl
userOwner
networkCode
status
```

Field yang ada di form tetapi tidak tampil di tabel utama:

```text
userOwner
```

### `subDomains/{id}`

Menyimpan subdomain dan PIC pemiliknya.

```text
subDomains/{id}
  id
  name
  parentDomain
  campaignCodes           // "pBRw, TvH1" — kode link Keitaro milik subdomain ini
  pic
  status: Active | Inactive
  revenueToday
  cpc
  ecpm
  createdAt
  createdBy
  updatedAt
  updatedBy
```

Relasi:

- `parentDomain` mengambil nilai dari `domains.domainUrl`.
- `pic` mengambil nilai dari `users.name`.
- `campaignCodes` dicocokkan dengan kode di awal nama campaign Meta, sehingga satu subdomain bisa
  menampung banyak campaign. Satu-satunya field yang boleh ditulis role `advertiser` (lihat
  `database.rules.json`), karena merekalah yang membuat link-nya.

Kolom yang tampil di halaman `/sub-domains`:

| Field DB | Label UI | Catatan |
| --- | --- | --- |
| `name` | Sub Domain | Required di form |
| `parentDomain` | Domain Induk | Select dari `domains.domainUrl` |
| `pic` | PIC / User | Select dari `users.name` |
| `status` | Status | `Active`, `Inactive` |

Field yang saat ini ada di form add/edit:

```text
name
parentDomain
pic
status
```

### `whitelists/{id}` — dihapus

Halaman Whitelists sudah tidak ada, dan tidak ada satu pun yang membaca node ini lagi: kolom `WL`
di kedua tabel ROI sudah dihapus, dan sync berhenti menulis `wl` karena tanpa halamannya tidak ada
apa pun yang bisa merawat daftarnya. Aturan `whitelists` ikut dilepas dari `database.rules.json`.

Datanya sendiri **tidak dihapus** dari database — ia hanya tidak lagi dibaca. Mengembalikan
halamannya berarti mengembalikan entri `resources`, `navItems`, `firebasePaths`, dan blok rules-nya.

### `adAccounts/{id}`

Menyimpan akun iklan Meta.

```text
adAccounts/{id}
  id
  name
  actId
  userOwner            // -> users.name; menentukan di profil user siapa campaign-nya disimpan
  syncStatus
  balance
  spendToday
  createdAt
  createdBy
  updatedAt
  updatedBy
```

Catatan:

- `syncStatus` saat ini dipakai untuk status dummy/cek status dari UI.
- Pada profile user, data ad account bisa berasal dari `users/{id}.adAccounts[]` atau fallback dari root `adAccounts`.

Kolom yang tampil di halaman `/ad-accounts`:

| Field DB | Label UI | Catatan |
| --- | --- | --- |
| `name` | Nama Akun Ads | Required di form |
| `actId` | ACT ID Meta | Required di form |
| `syncStatus` | Status Sync | Diubah oleh tombol `Cek Status` |

Field yang saat ini ada di form add/edit:

```text
name
actId
```

Field sistem/sync yang tampil di tabel:

```text
syncStatus
lastSyncActionAt
```

### `adsenseAccounts/{id}`

Menyimpan akun Adsense, domain, saldo, payout, dan data pendukung akun. Identitas utama untuk pengecekan/sync akun adalah `publisherId`.

```text
adsenseAccounts/{id}
  id
  name
  publisherId
  googleCredential
  status: Akun Close | Limit Iklan | Iklan Belum Tayang | Ready   # ditulis sync, lihat functions/account-status.js
  statusDetail                                                    # pesan notif Google, atau sebab status tidak bisa dicek
  syncStatus
  lastSyncActionAt
  lastSyncPublisherId
  emailAkun
  passwordAkun
  totalPayout
  kodeCustomer
  nomorHp
  emailPemulihan
  negara
  expDomain
  emailDomain
  passwordDomain
  server
  usernameWp
  passwordWp
  saldo
  namaRekening
  noRekening
  networkCode
  createdAt
  createdBy
  updatedAt
  updatedBy
```

Relasi:

- `googleCredential` opsional mengambil nilai dari `googleApiConfigs.name`. Jika kosong, proses API memakai credential default dari `.env`.
- `publisherId` dipakai sebagai identitas akun Adsense saat proses sync/cek status agar pengecekan bisa spesifik ke akun tersebut.

Catatan:

- Field password disembunyikan di tabel dan bisa dilihat dengan icon mata.
- `networkCode` berupa number.
- `expDomain` berupa date.
- `lastSyncPublisherId` diisi dari `publisherId` saat tombol cek status/sync dijalankan, agar audit sync tetap spesifik ke akun Publisher.

Kolom yang tampil di halaman `/adsense-accounts`:

| Field DB | Label UI | Catatan |
| --- | --- | --- |
| `name` | Nama Domain | Required di form |
| `publisherId` | ID Publisher | Required di form, identitas utama sync |
| `status` | Status Akun | `Akun Close`, `Limit Iklan`, `Iklan Belum Tayang`, `Ready` — ditulis sync tiap run dari API AdSense |
| `statusDetail` | Keterangan Status | Pesan notif Google saat `Limit Iklan`, atau sebab status tidak bisa dicek. Kosong kalau statusnya sudah menjelaskan dirinya |
| `syncStatus` | Status Sync | Boolean/status hasil cek |
| `emailAkun` | Email Akun | Email login akun |
| `passwordAkun` | Pass Akun | Secret, bisa toggle lihat password |
| `totalPayout` | Total Payout | Nilai uang |
| `kodeCustomer` | Kode Customer | Data akun |
| `nomorHp` | Nomor HP | Data akun |
| `emailPemulihan` | Email Pemulihan | Data recovery |
| `negara` | Negara | Tampil di tabel/import |
| `expDomain` | EXP Domain | Date |
| `emailDomain` | Email Domain | Tampil di tabel/import |
| `passwordDomain` | Pass Domain | Secret, bisa toggle lihat password |
| `server` | Server | Data hosting/server |
| `usernameWp` | Username WP | Tampil di tabel/import |
| `passwordWp` | Password WP | Secret, bisa toggle lihat password |
| `saldo` | Saldo | Nilai uang |
| `namaRekening` | Nama Di Rekening | Data payout |
| `noRekening` | No Rekening | Data payout |
| `networkCode` | Kode Jaringan | Number |

Field yang saat ini ada di form add/edit:

```text
name
publisherId
googleCredential
status
emailAkun
passwordAkun
totalPayout
kodeCustomer
nomorHp
emailPemulihan
expDomain
server
usernameWp
passwordWp
saldo
namaRekening
noRekening
networkCode
```

Field yang ada di form tetapi tidak tampil di tabel utama:

```text
googleCredential
```

Field yang tampil di tabel tetapi belum masuk form add/edit saat ini:

```text
negara
emailDomain
passwordDomain
```

### `googleApiConfigs/{id}`

Menyimpan konfigurasi credential Google API untuk proses autentikasi dan pengambilan data melalui API.

```text
googleApiConfigs/{id}
  id
  name
  clientId
  clientSecret
  refreshToken        // diisi oleh proses OAuth (functions/tools/authorize.mjs); secret
  status
  lastAuthActionAt
  createdAt
  createdBy
  updatedAt
  updatedBy
```

Catatan:

- `status` didapat dari aksi Login/Reconnect.
- `clientSecret` termasuk secret dan disembunyikan di tabel.
- `clientSecret` disimpan di `googleApiConfigs`, bukan di `adsenseAccounts`.
- Config ini dipakai sebagai credential API dan dapat dipilih di `adsenseAccounts.googleCredential`. Jika Adsense tidak memilih credential, sistem memakai credential default dari `.env`.

Kolom yang tampil di halaman `/google-api-configs`:

| Field DB | Label UI | Catatan |
| --- | --- | --- |
| `name` | Nama Akun/Client | Required di form |
| `clientId` | Client ID | Required di form |
| `status` | Status Koneksi | Diubah oleh Login/Reconnect |

Field yang saat ini ada di form add/edit:

```text
name
clientId
clientSecret
```

Field yang tersimpan dari aksi Login/Reconnect:

```text
status
lastAuthActionAt
```

## Dashboard Data

### `dashboard/stats`

Ringkasan angka untuk halaman Overview.

```text
dashboard/stats
  managedCampaigns
  totalSpend
```

Pemakaian di UI:

| Field DB | Dipakai Untuk |
| --- | --- |
| `managedCampaigns` | Card `Managed Campaigns` di Overview |
| `totalSpend` | Teks `Total Keseluruhan Spend` di section Saldo & Pengeluaran Advertiser |

### `dashboard/weeklyFinancials`

Data chart pendapatan, pengeluaran, dan netto.

```text
dashboard/weeklyFinancials/{YYYY-MM-DD}
  id
  period
  date
  partial           // true = hari berjalan, angkanya belum selesai
  grossRevenue
  totalSpend        // Meta spend telanjang
  adTax
  totalSpending     // totalSpend + adTax — ini yang digambar garis "Pengeluaran"
```

Pemakaian di UI:

| Field DB | Dipakai Untuk |
| --- | --- |
| `period` | Label titik/axis chart |
| `date` | Filter range tanggal |
| `partial` | Titik hari berjalan: digambar **putus-putus** dan disebut di keterangan grafik |
| `grossRevenue` | Garis/metric pendapatan |
| `totalSpending` | Garis/metric pengeluaran (`totalSpend` adalah spend tanpa ad tax) |

Catatan:

- Persentase netto tidak disimpan sebagai field. UI menghitungnya dari `(grossRevenue - totalSpend) / totalSpend * 100`.
- Jendelanya berakhir pada hari berjalan, sama dengan baris ROI, jadi titik terakhir grafik dan baris
  terbaru tabel selalu hari yang sama. Titik bertanggal **setelah** itu dibuang tiap run — satu titik
  yang memasangkan revenue kemarin dengan spend hari ini terbaca sebagai margin yang jatuh.

### `dashboard/advertiserSpend`

Data pengeluaran advertiser pada Overview.

```text
dashboard/advertiserSpend/{id}
  id
  userId
  pic
  balance
  spendToday
```

Kolom yang tampil di section `Saldo & Pengeluaran Advertiser`:

| Field DB | Label UI | Catatan |
| --- | --- | --- |
| `pic` | PIC / User | Nama user/PIC |
| `balance` | Sisa Saldo | Nilai uang |
| `spendToday` | Pengeluaran Hari Ini | Nilai uang |
| `userId` | Detail | Dipakai untuk navigasi ke `/users/{id}` |

Relasi:

- `userId` dipakai untuk link ke `/users/{id}`.

### `dashboard/roiReports`

Riwayat ROI harian: sumber grafik Overview, halaman Targets, dan tabel `Laporan ROI Realtime` untuk
hari-hari yang snapshot per sync-nya sudah lewat masa simpan.

Berkunci **tanggal + id subdomain** (`{YYYY-MM-DD}__{subdomainId}`): satu baris per subdomain per
hari, jadi sync yang jalan berkali-kali sehari memperbarui baris hari itu dan hari-hari sebelumnya
tinggal sebagai riwayat. **Tidak ada masa simpan**: baris hari lampau disimpan selamanya, dan yang
berulang cuma penimpaan baris hari yang sama. Sengaja — hari yang sudah dibuang tidak bisa diminta
ulang ke GAM/Meta (snapshot per sync hanya bertahan tiga hari, dan ad account yang berpindah tangan
tidak bisa dibaca lagi sama sekali), jadi Kalender akan menggambar bulan yang lewat batas sebagai
petak-petak kosong yang tak terbedakan dari bulan yang memang belum pernah disync. Pertumbuhannya
linear dan kecil: satu baris per subdomain per hari, bukan per sync — itu `roiSnapshots`, yang masa
simpannya justru pendek karena seluruh pohonnya ikut diunduh browser. `ROI_HISTORY_DAYS` tetap ada
sebagai batas opsional; kosong/`0` (bawaan) berarti tidak ada yang dibuang.

Tiap run menulis **dua hari**: hari yang sudah selesai (kemarin, Asia/Jakarta) dan hari berjalan
(hari ini). Baris hari berjalan membawa `partial: true` — earning GAM-nya belum dikonsolidasi dan
spend Meta-nya masih naik sampai tengah malam. Kedua sisi baris itu tetap datang dari hari yang sama;
yang dilarang bukan menampilkan hari ini, melainkan mencampur dua hari dalam satu baris. Baris
bertanggal **setelah** hari terakhir yang dilaporkan dibuang (`futureRoiReportKeys`), jadi
`SYNC_INCLUDE_TODAY=0` ikut membersihkan sisa baris hari berjalan sendiri.

```text
dashboard/roiReports/{YYYY-MM-DD}__{subdomainId}
  id
  no
  date
  partial           // true = hari berjalan, angkanya belum selesai
  time
  campaign
  metaAds
  spending
  adTax             // spending × tarif Settings
  totalSpending     // spending + adTax
  flukSpend
  adsense
  earning
  flukEarn
  roi
  flukRoi
  profit
  subDomain
  clicks
  cpc
  ecpm
  pageRpm
  results
  cpr
  wl
  metaBalance
  pluginOn
  pic
```

### `dashboard/roiSnapshots`

Isi tabel **`Laporan ROI Realtime`** di Overview dan **`Report Master Realtime ROI`** di
`/users/{uid}`: satu baris per **sync**, bukan per hari.

Berkunci **tanggal + jam + id subdomain** (`{YYYY-MM-DD}T{HH-mm}__{subdomainId}`, jam zona operasi).
Baris harian di `dashboard/roiReports` ditimpa tiap sync, jadi jejak hari berjalan hilang — pukul
09:00 ROI 40%, pukul 15:00 ROI 180%, dan yang pertama tidak tersimpan di mana pun. Node ini
menyimpannya.

Isi barisnya **sama persis** dengan baris `dashboard/roiReports` (field yang sama, `partial: true`),
dengan dua perbedaan:

- **Hanya hari berjalan yang disnapshot.** Hari yang sudah selesai tidak berubah lagi di antara dua
  sync, jadi snapshot-nya akan jadi 24 salinan baris yang sama tiap hari; hari-hari backfill
  (`GAM_RANGE_DAYS`) sudah lewat sama sekali. Angka finalnya tinggal di `dashboard/roiReports`.
- **Kolom `fluk*` mengukur perubahan sejak sync sebelumnya di hari yang sama**, bukan sejak kemarin
  seperti baris harian. Snapshot pertama sebuah hari tidak punya pembanding: kolomnya `-`, bukan 0.

Masa simpannya sendiri, `ROI_SNAPSHOT_DAYS` (default 3 hari) — dan node ini satu-satunya yang
benar-benar dipangkas, sementara `dashboard/roiReports` disimpan selamanya: satu hari menulis satu
baris per sync per subdomain (24 baris/hari pada jadwal 60 menit) dan seluruh pohonnya ikut diunduh
browser tiap dashboard dibuka.

> **Baris snapshot KUMULATIF sejak tengah malam.** Laporan GAM dan Meta selalu untuk hari penuh,
> bukan untuk satu jam, jadi baris pukul 15:00 memuat seluruh hari sampai pukul 15:00. Menjumlahkan
> baris-baris satu hari melaporkan pendapatan berkali lipat — itu sebabnya node ini terpisah dari
> `dashboard/roiReports`, yang boleh dijumlahkan dan memang dijumlahkan grafik dan Targets. Yang
> per jam hanya kolom `Fluk.`.

Sisi UI menggabung keduanya di `src/lib/roiRealtime.js`: snapshot dulu (terbaru di atas), lalu baris
harian untuk tiap hari + subdomain yang tidak punya snapshot.

Kolom yang tampil di section `Laporan ROI Realtime` Overview:

| Group UI | Field DB | Label UI |
| --- | --- | --- |
| Identitas | `no` | # NO |
| Identitas | `date` | Date |
| Identitas | `time` | Time |
| Identitas | `campaign` | Campaign |
| META ADS | `metaAds` atau `spending` | Spending |
| META ADS | `adTax` | Ad Tax |
| META ADS | `totalSpending` | Total Spend |
| META ADS | `flukSpend`, `fluctuationSpend`, atau `spendFluctuation` | Fluk. Spend. |
| EARNING | `adxRevenue` + `adServerRevenue` | GAM |
| EARNING | `adsenseRevenue` | AdSense |
| EARNING | `adsense` atau `earning` | Total (GAM + AdSense) |
| EARNING | `flukEarn`, `fluctuationEarn`, atau `earningFluctuation` | Fluk. Earn. |
| ROI (%) | `roi` | ROI — `(earning − totalSpending) / totalSpending × 100` |
| ROI (%) | `flukRoi` atau `roiFluctuation` | Fluk. ROI |
| Profit | `profit` | Profit |
| Domain | `subDomain` | Sub-Domain |
| META M. | `clicks` | Clicks |
| META M. | `cpc` | CPC |
| ADS M. | `pageRpm` atau `ecpm` | Page RPM |
| ADS M. | `cpr` | CPR (biaya Meta per hasil = `spending` / `results`) |
| Status | `metaBalance` atau `balance` | META BAL. |

`wl` dan `pluginOn` masih ditulis sync dan tetap ada di node ini, tapi tidak lagi punya kolom di
tabel: keduanya status subdomain, bukan angka performa, dan tempatnya di halaman Sub Domains.

Catatan:

- **Ad tax ikut dihitung.** `profit` dan `roi` dibagi `totalSpending`, bukan `spending` — yang keluar
  dari kantong advertiser adalah spend berikut pajaknya. Tarifnya dari halaman Settings
  (`settings/roi.adTaxPercent`).
- Baris riwayat membawa pajaknya sendiri dan **tidak** dihitung ulang saat tarifnya berubah: hari
  kemarin dipajaki dengan tarif kemarin. UI hanya menghitung `adTax`/`totalSpending` untuk baris
  yang belum membawanya (`src/lib/adTax.js`).
- Kolom "Fluk." membandingkan dengan baris **hari lain** terakhir milik subdomain itu, bukan dengan
  baris hari ini — kalau tidak, fluktuasi selalu 0 setelah sync kedua di hari yang sama.
- Baris bentuk lama (berkunci id subdomain saja) dihapus sync begitu baris bertanggal untuk
  subdomain itu ditulis; dibiarkan, ia akan tampil selamanya sebagai baris kedua yang tidak pernah
  diperbarui.

Relasi:

- `pic` cocok dengan `users.name`.
- `subDomain` cocok dengan `subDomains.name`.

### `settings/roi`

Pengaturan yang dipakai seluruh perhitungan ROI. Diatur admin di halaman `/settings`.

```text
settings/roi
  adTaxPercent      // persen, mis. 5
  updatedAt
  updatedBy
```

| Field DB | Label UI | Catatan |
| --- | --- | --- |
| `adTaxPercent` | Ad Tax (%) | 0–100. Kosong berarti belum diatur — perhitungan memakai 5% |

Catatan:

- Dibaca dua sisi: sync (`adTaxRate()` di `functions/sync-core.js`) menulis `adTax`/`totalSpending`
  ke tiap baris, UI (`adTaxRateOf()` di `src/lib/adTax.js`) menghitungnya untuk baris lama yang
  belum membawanya.
- Field yang dikosongkan **bukan** tarif 0: `Number("")` adalah 0, dan menerimanya berarti satu form
  yang tidak sengaja dikosongkan menghapus pajaknya dari seluruh dashboard tanpa suara. 0% yang
  memang diketik tetap diterima.
- `AD_TAX_RATE` di env masih dibaca sebagai jaring pengaman untuk runtime yang jalan sebelum node
  ini pernah diisi.
- Bisa dibaca semua role (tarifnya menentukan arti tiap ROI di layar), hanya admin yang menulis.

### `reminders/{id}`

Pengingat pembayaran/tagihan. Ditambah dan diubah admin + keuangan, **dibaca semua akun yang
login** — badge jatuh tempo di topbar dan panel di Overview memang ditujukan ke seluruh tim.

```text
reminders/{pushId}
  title                         // wajib
  type                          // "Pembayaran" | "Umum"
  dueDate                       // ISO "YYYY-MM-DD", .indexOn
  nominal                       // opsional; kosong bukan Rp 0
  status                        // "Belum" | "Selesai"
  note
  createdAt / createdBy / updatedAt / updatedBy
```

Catatan:

- "Jatuh tempo" = `status != "Selesai"` dan `dueDate <= hari ini + 2`
  (`REMINDER_LEAD_DAYS`). Satu definisi, dua salinan: `src/lib/reminders.js` (badge, panel
  Overview) dan `functions/reminders-core.js` (kiriman Telegram).
- `nominal` kosong dibiarkan kosong: reminder non-pembayaran tidak punya nominal, dan 0 yang
  dikarang tampil seolah tagihannya Rp 0.
- Halaman `/reminders` sengaja tanpa filter rentang tanggal — yang terlewat dan yang jatuh tempo
  bulan depan justru yang dicari.

### `settings/telegram` — PENINGGALAN

Chat tujuan versi lama: satu teks berisi semua id, dipisah koma.

```text
settings/telegram
  chatIds           // "123456789, -1002223334445"
  updatedAt
  updatedBy
```

Catatan:

- **Tidak ada satu baris kode pun yang membacanya lagi** — tidak di `src/`, tidak di `functions/`.
  Tujuannya pindah ke Notification Center: `users/{id}/notificationTopics`, `notificationGroups`, dan
  `settings/notifications`.
- Tidak ada pemindahan otomatis; id lamanya didaftarkan ulang lewat **Tambah Penerima** di
  `/notifications`. Nodenya dibiarkan berdiri apa adanya — dihapus, daftar chat lama hilang tanpa
  ada yang bisa membacanya kembali.
- **Token botnya tidak pernah di sini** — ia secret Cloud Functions (`TELEGRAM_BOT_TOKEN`).
  `settings` terbaca setiap akun yang login.

### `settings/alerts`

Ambang peringatan ROI. Diatur admin di `/notifications/peringatan`.

```text
settings/alerts
  enabled           // PENINGGALAN: tidak lagi diisi form mana pun, dan DITIMPA runAlerts dengan
                    // nilai settings/notifications/roiAlerts.enabled sebelum menilai
  minSpend, roiThreshold, balanceThreshold
  spendNoEarning, lowRoi, lowBalance
  updatedAt, updatedBy
```

### `settings/notifications`

Setelan per topik notifikasi. Diatur admin di `/notifications`.

```text
settings/notifications/{topik}      // reminders | roiAlerts | syncIssues
  enabled           // boolean, TIDAK ADA = nyala
  roles             // teks gabungan koma: "admin,keuangan" — siaran per role
settings/notifications
  updatedAt
  updatedBy
```

### `notificationGroups`

Grup Telegram dan chat lain yang bukan milik seorang PIC. `.read` semua akun yang login, `.write`
admin.

```text
notificationGroups/{id}
  label             // "Grup Tim RabbitROI"
  chatId            // teks, bilangan bulat; grup diawali "-"
  enabled           // boolean
  pic               // opsional: lingkup Peringatan ROI (nama PIC). Kosong = seluruh armada.
  topics/{topik}    // boolean per topik
  id, createdAt, createdBy, updatedAt, updatedBy, deletedAt, deletedBy
```

Catatan:

- Yang berbentuk ORANG tidak di sini melainkan di baris `users`-nya sendiri (`telegramChatId` +
  `notificationTopics`) — satu orang, satu baris, supaya chat id yang berubah tidak harus dibetulkan
  di dua tempat.
- Aturan penerimanya di [notifications.md](notifications.md).

### `dashboard/telegramInbox`

Chat yang sudah menyapa bot — daftar **tawaran**, bukan daftar tujuan. Ditulis cron semenit di
`server/` ([`syncTelegramInbox`](../functions/sync-telegram-inbox.mjs)), dibaca tab "Calon Penerima"
(`/notifications/calon`, admin saja). `.read` semua akun yang login, `.write` admin (mewarisi `dashboard`).

```text
dashboard/telegramInbox
  offset                      // update_id terakhir + 1, untuk getUpdates
  chats/{cNNN}
    chatId                    // teks, bilangan bulat; grup diawali "-"
    type                      // "private" | "group" | "supergroup" | "channel"
    title                     // nama profil atau nama grup
    username                  // tanpa "@"; kosong untuk grup dan akun tanpa username
    firstSeenAt, lastSeenAt   // ISO
    dismissedAt, dismissedBy  // hanya kalau admin menekan Abaikan
```

Catatan:

- **Kunci berawalan huruf** (`c1847784116`, minus jadi `n`: `cn1002223334445`) — RTDB mengembalikan
  node berkunci angka sebagai array berlubang, alasan yang sama dengan `c57` di antrean gating.
- **Turunan chat id, bukan push key**: pesan kedua dari orang yang sama harus mendarat di baris yang
  sama. Push key baru tiap kali berarti satu baris tawaran per pesan yang pernah dikirim orang itu.
- **Isi pesannya TIDAK disimpan**, cuma identitas chat-nya — `dashboard` terbaca setiap akun yang
  login, dan orang yang mengetik sesuatu ke bot tidak sedang menerbitkannya ke seluruh tim.
- **"Sudah jadi penerima" bukan field di sini**, melainkan dihitung dari `users.telegramChatId` +
  `notificationGroups.chatId` tiap kali daftarnya digambar. Yang disimpan cuma `dismissedAt`, karena
  ia keputusan orang dan bukan turunan dari keadaan lain.
- `offset` MENGKONSUMSI: Telegram menghapus update di bawahnya, jadi `getUpdates` telanjang tidak
  akan melihat apa pun lagi selama server jalan. Selengkapnya di [notifications.md](notifications.md).

### `dashboard/syncIssueNotices`

Tanggal kiriman terakhir per kegagalan sync, ditulis tahap "Notifikasi kegagalan sync" di
`scheduledSync`.

```text
dashboard/syncIssueNotices/{cabang}__{target}   // "YYYY-MM-DD", zona operasi
```

Catatan:

- Bentuk dan alasannya sama persis dengan `reminderNotices` dan `alertNotices`, termasuk penyapuan
  penanda milik isu yang sudah pulih.
- Pesan errornya TIDAK ikut jadi kunci: satu network yang gagal dengan tiga pesan berbeda dalam
  sehari adalah satu kegagalan bagi orang yang harus memperbaikinya.

### `dashboard/reminderNotices`

Tanggal kiriman Telegram terakhir per reminder, ditulis `scheduledReminders`.

```text
dashboard/reminderNotices/{reminderId}   // "YYYY-MM-DD", zona operasi
```

Catatan:

- Penjaga kiriman ganda **per hari**, bukan per reminder: yang terlewat justru perlu diulang tiap
  pagi, tapi run yang diulang Cloud Scheduler tidak boleh mengirim daftar yang sama dua kali.
- Ditulis hanya kalau ada chat yang benar-benar menerima; kalau semua gagal, daftarnya tetap
  "belum dikabarkan".
- Penanda milik reminder yang selesai/dihapus disapu di run yang sama.

### `dashboard/syncStatus` dan `dashboard/syncRuns`

Ditulis sync terjadwal (`functions/scheduled-sync.js`) tiap run. Keduanya menggantikan tombol sync
yang sudah dihapus: sync jalan sendiri, jadi yang dibutuhkan bukan pemicunya melainkan kabar
kapan ia jalan lagi dan apa hasilnya.

```text
dashboard/syncStatus            // satu node, ditimpa tiap run
  running                       // true selama run berjalan -> topbar menulis "Syncing..."
  startedAt
  schedule                      // mis. "every 60 minutes"
  lastRunAt
  lastOk
  lastSummary
  lastDurationSec
  nextRunAt                     // "" kalau jadwalnya cron biasa (tidak ditebak)
  updatedAt

dashboard/syncRuns/{YYYYMMDDHHmmss}    // satu baris per run
  startedAt
  finishedAt
  durationSec
  ok
  failed                        // jumlah tahap yang gagal
  stages[]                      // { name, ok, detail } — detail memuat alasan aslinya
  summary
```

Catatan:

- `nextRunAt` dihitung dari waktu run **mulai** + interval jadwal, bukan dari waktu selesai: Cloud
  Scheduler memakai jarak tetap dari jamnya sendiri, jadi menambahkan interval ke waktu selesai akan
  makin meleset tiap run seiring durasi sync berubah.
- Hanya jadwal bentuk `every N minutes/hours` yang bisa dihitung mundur. Cron biasa sengaja tidak
  ditebak — tebakan yang meleset membuat hitung mundur di topbar berbohong, jadi UI-nya menulis
  "Menunggu jadwal".
- `syncRuns` dipangkas ke `SYNC_LOG_KEEP` (default 100) di run yang sama; node `dashboard` diikuti
  browser tiap halaman dibuka.
- Dibaca semua role (topbar), ditulis hanya oleh SYNC_USER lewat aturan `dashboard` yang sudah ada.

### `dashboard/gating/*`

Cermin gating campaign Keitaro (vi-control), ditulis `scheduledGating`
(`functions/sync-gating.mjs`) tiap dua menit. Dibaca halaman `/gating` — **superadmin saja**.

```text
dashboard/gating/campaigns/c{id}      // cermin GET /campaigns, ditimpa UTUH tiap penyegaran
  campaignId                          // "57" — angkanya; kuncinya "c57"
  name, alias, state
  gated                               // true | false | null  (null = stream gagal dibaca)
  landingUrl, decoyUrl

dashboard/gating/previews/c{id}       // hanya untuk yang `gated: false`
  applicable                          // boleh di-gate?
  blockers/{i0,i1,...}                // alasan kalau tidak, dalam bahasa manusia
  blockerCount
  alreadyGated                        // landing dipakai bersama campaign lain yang sudah di-gate
  landingName
  currentLandingUrl, currentBotProtectionUrl, currentFlow3Url
  willSetLandingUrl, willSetBotProtectionUrl, willSetFlow3Url   // "" untuk site baru
  siteStatus                          // "existing" | "new"
  checkedAt

dashboard/gating/runs/{uuid}          // 50 terakhir dari GET /gate-runs
  startedAt                           // ISO-Z; API mengirim "2026-08-17 05:24:31.293338+00"
  campaignId, campaignName
  action                              // "gate" | "ungate"
  status                              // "ok" | "aborted" | "problem"
  siteId, error, durationMs
  verified                            // true | false | "" (tidak sempat diverifikasi)
  passLocation, decoyLocation, cleanupComplete

dashboard/gating/status               // satu node
  mirroredAt, campaigns, gated, ungated, unknown

dashboard/gating/commands/c{id}       // antrean niat
  campaignId, campaign, action
  state                               // "pending" -> "applied" | "failed"
  requestedAt, requestedBy
  finishedAt, result, runId, error

dashboard/gating/refreshRequestedAt   // stempel tombol "Segarkan"
```

Catatan:

- **Kunci berawalan huruf** (`c57`, bukan `57`). ID campaign Keitaro angka mulai dari 1, dan RTDB
  mengembalikan node berkunci angka berurutan sebagai array berlubang.
- **`gated: null` bukan `false`** — stream campaign itu gagal dibaca. Dipetakan jadi `false`,
  halaman menawarkan tombol Gate untuk campaign yang mungkin sudah di-gate, dan gate kedua memasang
  gate di depan gate.
- **`status: "problem"` berarti perubahannya TERSIMPAN tapi verifikasinya gagal** — bukan "tidak
  jadi". `aborted` yang sebaliknya: ditolak, tidak ada yang ditulis sama sekali.
- `plan` dan `beforeState` dari API sengaja **tidak** dicerminkan: dua objek JSON besar per baris,
  dikalikan 50 baris, diunduh tiap browser yang membuka halaman — dan tidak satu pun ditampilkan.
- Tulisan `commands/{id}` dengan `state: "pending"` **hanya boleh superadmin** (`.validate` di
  `database.rules.json`); `applied`/`failed` boleh admin, karena yang menuliskannya SYNC_USER.
  Selengkapnya di [gating.md](gating.md).

### `pluginSites/{subdomainId}` dan `pluginKeys/{subdomainId}`

Status plugin RabbitROI di tiap subdomain, ditulis server kontrol (`functions/sync-plugin.mjs`)
setiap kali sebuah situs dihubungi — termasuk saat cuma dibaca. Dibaca halaman `/plugin` —
**superadmin saja**.

Kuncinya adalah **id baris `subDomains`** (push-key), bukan hostname: hostname bisa berubah, dan
node yang dikunci hostname akan meninggalkan baris yatim tiap kali seseorang membetulkan ejaan
sebuah subdomain.

```text
pluginSites/{subdomainId}             // cermin status — TANPA api_key
  subdomainId, name                   // name = hostname, disalin dari subDomains untuk dibaca
  enrolled                            // true | false — DISIMPAN, tidak disimpulkan dari field lain
  siteId, version, php, wp, homeUrl   // dari jawaban enroll/ping
  enrolledAt, enrolledBy
  lastSeenAt                          // jawaban BERHASIL terakhir, apa pun endpointnya
  error, errorCode, errorAt           // kegagalan terakhir; dihapus oleh jawaban berhasil berikutnya
  checkedAt                           // kapan baris ini terakhir ditulis

pluginKeys/{subdomainId}              // TIDAK PERNAH dilanggan satu pun kode di src/
  apiKey                              // unik per situs, lahir saat enroll
  enrolledAt, enrolledBy
```

- **Dua node, bukan satu, dan itu bukan kerapian.** Izin baca RTDB menurun: digabung, tiap
  superadmin yang membuka `/plugin` akan mengunduh seluruh `api_key` armada ke browsernya hanya
  untuk melihat kolom "Versi".
- **Aturannya `admin|superadmin`, bukan superadmin** — walau halamannya superadmin. Yang menulis
  kedua node ini adalah SYNC_USER, yang berrole admin; aturan superadmin di sini akan menolak
  penulisnya sendiri. Yang menegakkan siapa boleh menekan tombolnya adalah gerbang di
  `server/plugin.js`, bukan aturan database — halaman itu tidak menulis apa pun ke RTDB.
- **`apiKey` sengaja tidak dienkripsi.** `POST /manage/reset` — satu-satunya cara meng-enroll ulang
  sebuah situs — membutuhkan kunci LAMA. Rahasia enkripsi yang hilang mengunci tiap situs di
  `already_enrolled` selamanya.
- **`enrolled` bertahan lewat kegagalan.** Disimpulkan dari `version` atau dari ping terakhir, situs
  yang enroll-nya berhasil tapi ping berikutnya gagal akan digambar "belum enroll" — dan tombol
  Enroll yang muncul untuknya dijawab `already_enrolled`, yang jalan keluarnya reset, yang membuang
  kunci yang masih sah.
- Pengaturan yang diedit halaman itu (landing, iklan, header/footer, behaviour) **tidak ada di
  sini**: semuanya tinggal di database WordPress masing-masing situs. Selengkapnya di
  [plugin.md](plugin.md).

### `activityLogs/{id}`

Jejak aktivitas tiap orang di dashboard, ditulis **server kontrol** (`server/activity.js`) dari batch
yang dikirim browser tiap lima menit. Dibaca halaman `/activity-logs` — **superadmin saja**.

Kuncinya **dibuat browser** (UUID) dan dipakai apa adanya: batch yang sampai tapi jawabannya hilang
di jaringan, lalu dikirim ulang, menimpa baris yang sama alih-alih menggandakannya.

```text
activityLogs/{id}
  id, at                              // at = jam PERANGKAT, boleh salah — lihat receivedAt
  receivedAt                          // jam server; berdampingan dengan at, tidak menggantikannya
  category                            // auth | navigation | interaction | operation
  action                              // login, login_failed, page_view, click, update:users, ...
  page                                // PATH saja, tanpa query
  label, target, detail               // label tombol, node/endpoint, keterangan yang sudah diredaksi
  status                              // ok | failed — dari tulisan yang benar-benar melempar
  actorUid, actorEmail, actorRole     // disalin, bukan dirujuk: role yang berlaku SAAT itu
  ip, city, region, country           // DICAP SERVER — geoip-lite, basis data lokal
  browser, os, device, userAgent      // DICAP SERVER — ua-parser-js atas header, bukan klaim body
  reportedByUid, reportedByEmail      // siapa yang benar-benar mengirim barisnya
```

- **`ip`, kota, dan `userAgent` tidak pernah dibaca dari body.** Sebuah halaman tidak tahu alamat
  publiknya sendiri, dan kota diturunkan dari IP itu. Log yang tiap barisnya bisa dikarang oleh orang
  yang dicatatnya bukan log audit — itu juga alasan node ini tidak punya jalur tulis dari browser
  sama sekali.
- **`.read` superadmin, `.write` `admin|superadmin`.** Asimetri yang disengaja: yang menulis cuma
  SYNC_USER (admin), dan aturan superadmin di sisi tulis akan menolak penulisnya sendiri — sama
  seperti `pluginSites`. Yang superadmin adalah sisi baca, karena isinya adalah ke mana dan kapan
  tiap orang bergerak.
- **`reportedBy*` ≠ `actor*` untuk login yang GAGAL.** Percobaan yang gagal tidak punya token, jadi
  barisnya menunggu di perangkat itu dan menumpang sesi berikutnya. Tanpa cap ini, seseorang bisa
  menaruh kejadian atas nama orang lain hanya dengan menyunting localStorage-nya.
- **`.indexOn: ["at"]`**, dipakai pembacaan halaman (per rentang tanggal) dan pembuangan baris lewat
  masa simpan. Node ini satu-satunya yang tumbuh mengikuti jumlah KLIK, bukan jumlah baris data —
  karena itu ia tidak dilanggan store, dan masa simpannya 90 hari (`ACTIVITY_LOG_DAYS`).
- **Rahasia tidak pernah sampai ke sini.** `sanitizeDetail` meredaksi nilai field yang berbau rahasia
  di sisi browser, sebelum menyentuh localStorage. Selengkapnya di [activity-logs.md](activity-logs.md).

## Nested User Detail Data

Halaman `/users/{id}` membangun data profile dari kombinasi:

- data nested di `users/{id}`
- fallback dari root collection seperti `subDomains`, `adAccounts`, dan `dashboard/roiReports`

Jika nested data tersedia, nested data diprioritaskan. Jika tidak tersedia, UI memakai fallback berdasarkan nama user/PIC.

### `users/{id}.subDomains[]`

```text
subDomains[]
  id
  name
  parentDomain
  status
  revenueToday
  cpc
  ecpm
```

Kolom yang tampil di section `Sub Domain Assigned`:

| Field DB | Label UI | Catatan |
| --- | --- | --- |
| `name` | Sub Domain | Klik untuk menampilkan summary ROI cepat |
| `parentDomain` | Domain Induk | Domain utama |
| `status` | Status | Status subdomain |
| `revenueToday` | Revenue (Today) | Nilai uang |
| `cpc` | CPC | Nilai uang |
| `ecpm` | eCPM | Nilai uang |

Tidak ada kolom `Actions` di sini. Tombol `Delete`-nya cuma memunculkan `window.confirm` dan tidak
pernah menghapus apa pun; subdomain diarsipkan lewat `/sub-domains`.

Summary yang muncul setelah subdomain diklik dihitung dari `masterRoiReports[]`:

```text
subDomain
metaSpend
gamRevenue
roiValue
```

### `users/{id}.adAccounts[]`

```text
adAccounts[]
  id
  name
  actId
  balance
  spendToday
  syncStatus
```

Kolom yang tampil di section `Daftar Ad Account (Act) & Saldo`:

| Field DB | Label UI | Catatan |
| --- | --- | --- |
| `name` | Nama Akun Ads | Nama akun Meta |
| `actId` | ACT ID Meta | ID akun Meta |
| `balance` | Sisa Saldo | Nilai uang |
| `spendToday` | Pengeluaran Hari Ini | Nilai uang |
| `syncStatus` | Status Sync | Status sync |

### `users/{id}.campaigns[]`

Ditulis oleh sync Meta (`syncCampaigns` di `functions/sync-meta.mjs`). Satu baris per campaign,
gabungan tiga panggilan Meta: insights (`spend`, `actions`, `cost_per_action_type`, dengan
`date_preset=today`), daftar campaign (`effective_status`, `daily_budget`), dan daftar ad set
(`optimization_goal`, `promoted_object.custom_event_type` — tujuan optimasi yang menentukan apa yang
dihitung sebagai "hasil").

```text
campaigns[]
  id                    // "{adAccountId}:{nama campaign ternormalisasi}"
  campaign
  account
  adAccount
  actName
  subDomain
  subDomainSource       // "manual" | "code" | ""
  campaignCode
  status
  result
  resultType            // action_type yang dihitung sebagai hasil, mis. "offsite_conversion.fb_pixel_view_content"
  costPerResult
  dailyBudget
  spendToday
  spendDate
```

Kolom yang tampil di section `Manajemen Kampanye (Campaign)`:

| Field DB | Label UI | Catatan |
| --- | --- | --- |
| `campaign` | Kampanye | Nama campaign |
| `account`, `adAccount`, atau `actName` | Akun | Ditampilkan di bawah nama campaign |
| `subDomain` | Sub Domain | Select dari subdomain; `subDomainSource` menjelaskan asal pemetaannya |
| `status` | Status | Dari `effective_status` Meta: `Aktif`, `Nonaktif`, `Limit`, `Review`, atau kosong kalau tidak terbaca |
| `result` | Hasil | Jumlah event yang **dioptimasi ad set campaign ini** (`resultActionTypes` + `resultsFromActions` di `meta.js`) |
| `resultType` | Hasil (subteks) | Event yang dihitung, dinamai lewat `resultLabel` di `src/lib/metaResults.js` — "2.449" tidak bisa dibedakan dari 2.449 lead tanpa ini |
| `costPerResult` | Biaya per hasil | Nilai uang, **dari `cost_per_action_type` Meta sendiri**; dihitung `spend / result` hanya kalau Meta tidak mengirimkannya, dan `""` kalau hasilnya 0 — bukan 0, yang terbaca sebagai gratis |
| `dailyBudget` | Anggaran | Nilai uang; `""` kalau anggarannya dipegang ad set (bukan CBO) |
| `spendToday` | Jumlah yang dibelanjakan | Nilai uang |
| `spendDate` | Tanggal spend | Ditampilkan sebagai subtext |

> **"Hasil" mengikuti tujuan ad set, bukan daftar prioritas tetap.** Meta tidak mengirim kolom Hasil;
> Ads Manager menghitungnya dari event yang dioptimasi tiap ad set. Dulu kami memilihnya dari daftar
> prioritas tetap (`META_RESULT_ACTIONS`: purchase → lead → … → link_click), dan campaign yang
> dioptimasi ke event lain jatuh sampai ujung daftar: "kBCD-06 Pros Turki" (10 ad set,
> OFFSITE_CONVERSIONS/CONTENT_VIEW) terbaca **4.908 hasil @ Rp 19,46** — itu klik tautan — sementara
> Ads Manager menampilkan **2.449 @ Rp 39,01**, yaitu ViewContent.
>
> `META_RESULT_ACTIONS` sekarang hanya cadangan, dipakai kalau daftar ad set gagal diambil atau
> tujuannya belum ada di peta `meta.js`.
>
> `cost_per_action_type` **tidak selalu memakai nama event yang sama dengan `actions`** — campaign di
> atas melaporkan hasilnya sebagai `offsite_conversion.fb_pixel_view_content` tapi biayanya hanya
> sebagai `omni_view_content`/`view_content`, jadi biayanya dicari lewat semua nama event itu.

Campaign yang sudah `ARCHIVED`/`DELETED` di Meta tidak ditulis kecuali masih ada spend hari ini.

> Sudah tidak dipakai lagi: `source`/`revenueSource` (dropdown-nya tidak pernah disimpan maupun
> dibaca), `delivery`, dan rincian bertingkat `detailItems[]`/`children[]` — tidak ada sumber data
> yang pernah mengisinya, jadi baris yang dibuka selalu memperlihatkan campaign yang sama lagi.
> Beberapa campaign yang menumpuk di satu subdomain diwakili badge "Campaign digabung" di tabel ROI.

### `users/{id}.masterRoiReports[]`

```text
masterRoiReports[]
  id
  no
  date
  time
  campaign
  metaAds
  spending
  adsense
  earning
  roi
  subDomain
  clicks
  cpc
  ecpm
  pageRpm
  cpr
  wl
```

Kolom yang tampil di section `Report Master Realtime ROI Khusus Anda`:

> Isinya sama dengan tabel `Laporan ROI Realtime` di Overview, disaring ke PIC user ini: snapshot
> per sync dari `dashboard/roiSnapshots` untuk hari berjalan, baris harian `dashboard/roiReports`
> untuk hari-hari sebelumnya, urut terbaru dulu. Kartu ringkasan per subdomain di atasnya tetap
> dihitung dari baris HARIAN — baris snapshot kumulatif sejak tengah malam, jadi menjumlahkannya
> akan melipatgandakan pendapatan hari itu.


| Field DB | Label UI | Catatan |
| --- | --- | --- |
| — | # NO | Nomor urut tampilan, dihitung saat render. `no` tidak pernah ditulis oleh apa pun, dan nomor yang tersimpan akan melawan pengurutan kolom |
| `date` | Date | Tanggal baris |
| `time` | Time | Ditampilkan dengan status Live |
| `campaign` | Campaign | Nama campaign |
| `metaAds` atau `spending` | Meta Spend | Nilai uang |
| `adsense` atau `earning` | GAM Revenue | Nilai uang |
| `roi` | ROI | Persentase ROI |
| `subDomain` | Sub-Domain | Subdomain user |
| `clicks` | Clicks | Metric clicks |
| `cpc` | CPC | Nilai uang |
| `ecpm` atau `pageRpm` | eCPM | Nilai uang |
| `cpr` | CPR | Nilai uang |

### `userReports/{id}.countryRoi[]`

Ditulis Sync ROI (`syncSubdomains`) sebagai objek berkunci `tanggal__subdomain__NEGARA`, satu baris
per negara per subdomain per hari:

```text
countryRoi
  {YYYY-MM-DD__subdomain__ISO}
    date
    partial           // true = hari berjalan, angkanya belum selesai
    subDomain
    pic
    country
    isoCode
    spending          // Meta spend negara itu
    adTax             // spending × 5%
    totalSpending     // spending + adTax
    earning           // GAM revenue negara itu
    profit            // earning − totalSpending
    roi               // (earning − totalSpending) / totalSpending × 100
    status
    source            // "GAM + Meta Ads"
    updatedAt
```

Dibaca dua tempat: panel `ROI per Negara` di Profile User, dan kolom **`Negara`** pada tabel
`Laporan ROI Realtime` di Overview. Yang kedua menjodohkan barisnya dengan `dashboard/roiReports`
lewat `date` + `subDomain` (`src/lib/countryBreakdown.js`), lalu menampilkan negara ber-spend
terbesar di selnya dan sisanya di panel yang terbuka saat badge-nya di-hover. Node ini ditulis utuh
tiap sync — untuk kedua hari yang dilaporkan run itu sekaligus — jadi rincian negara ada pada baris
hari selesai dan baris hari berjalan; baris hari-hari sebelumnya di Overview menampilkan `-`.

Kuncinya dulu tanpa tanggal (`subdomain__NEGARA`). Selama begitu, sync hari berjalan akan menimpa
angka final kemarin di panel yang sama, dan filter periodenya tidak pernah punya lebih dari satu hari
untuk disaring.

Kolom yang tampil di section `ROI per Negara`:

| Field DB | Label UI | Catatan |
| --- | --- | --- |
| `country` dan `isoCode` | Negara | Ditampilkan sebagai `Nama (ISO)` |
| `spending` | Spend (Meta) | Nilai uang |
| `adTax` | Ad Tax | Nilai uang, 5% dari `spending` |
| `totalSpending` | Total Spend | Nilai uang, `spending + adTax` |
| `earning` | Earnings (GAM) | Nilai uang |
| `roi` | ROI % | `(earning − totalSpending) / totalSpending × 100` |
| `status` | Status | `Active` (spend + revenue), `Review` (spend tanpa revenue), `Inactive` (revenue tanpa spend) |
| `date`, `reportDate`, `createdAt`, atau `syncedAt` | Filter tanggal | Dipakai filter `Yesterday`, `Last 7 Days`, `Last 30 Days` |
| `partial` | — | `true` = hari berjalan. Di luar rentang `Yesterday`; `Hari Ini` berisi baris partial bertanggal paling baru |

Formula ROI per negara (beda dengan ROI subdomain di Overview, yang membagi dengan spend telanjang):

```text
Spending       = Meta Spend
Ad Tax         = Spending × 5%            (AD_TAX_RATE)
Total Spending = Spending + Ad Tax
ROI%           = (Earning − Total Spending) / Total Spending × 100
```

Catatan:

- Sumber datanya dua laporan: GAM `SITE × COUNTRY_CODE × COUNTRY_NAME` (`GAM_COUNTRY_DIMENSIONS`)
  dan Meta insights `level=campaign&breakdowns=country`. Keduanya dijodohkan lewat kode ISO negara
  — Meta hanya memberi kode, GAM memberi nama, jadi laporan GAM diminta membawa kodenya juga.
- Spend negara menempel di subdomain lewat pemetaan campaign yang sama dengan ROI subdomain (kode
  Keitaro di nama campaign, atau pemetaan manual), lalu subdomain menempel ke user lewat `pic`.
  Subdomain tanpa PIC tidak punya halaman yang bisa menampilkannya dan dilaporkan di ringkasan sync.
- Node ini ditulis utuh tiap sync (kedua hari sekaligus): negara yang hari ini tidak lagi
  dibelanjakan hilang dari tabel, bukan tertinggal sebagai baris basi. User yang run itu tidak
  menghasilkan baris sama sekali tidak disentuh, supaya laporan yang gagal tidak mengosongkan panel
  orang. Karena hanya hari-hari yang dilaporkan yang ditulis, node ini juga tidak tumbuh melewati dua
  hari — filter `Last 7 Days` di panelnya karena itu tidak akan pernah menemukan tujuh hari.
- UI menghitung ulang `adTax`, `totalSpending`, dan `roi` dari `spending`/`earning`
  (`src/lib/countryRoi.js`), jadi baris lama yang ditulis sebelum ad tax ada tetap dibaca dengan
  formula yang sama.
- Kontrol `Auto-Block Negara`, ambang `Block jika ROI <`, dan tombol `Analisis Negara`/`Analisis
  Semua` sudah dihapus dari UI: tidak ada fitur apa pun di belakangnya.
- Jika item tidak punya tanggal, item tetap ditampilkan agar data lama tidak hilang dari UI.

## Audit Fields

Saat data dibuat atau diupdate melalui app, field audit berikut otomatis ditambahkan:

```text
createdAt
createdBy
updatedAt
updatedBy
```

Saat data diarsipkan, app tidak melakukan hard delete. Data ditandai dengan:

```text
deletedAt
deletedBy
updatedAt
updatedBy
```

Data yang memiliki `deletedAt` tidak ditampilkan di UI.
