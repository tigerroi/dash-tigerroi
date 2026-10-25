# Activity Logs

Jejak aktivitas setiap orang di dashboard: login, halaman yang dibuka, tombol yang ditekan, dan
operasi data — berikut **IP, kota pemilik IP itu, dan perangkatnya**. Halaman `/activity-logs`
(grup Admin di sidebar), **superadmin saja**.

## Jalurnya

```
klik / pindah halaman / operasi
        │
        ▼
  localStorage (penyangga, maks 500 baris)     ← dicatat SEKARANG, tanpa jaringan
        │
        │  tiap 5 menit · jaringan kembali · tab ditinggalkan · logout
        ▼
  POST /activity-logs  (server kontrol)        ← mencap ip, kota, User-Agent
        │
        ▼
  SQLite di VPS  activity_logs(id PK)          ← server/activity-db.js, bukan lagi RTDB
        │
        ▲  GET /activity-logs?start=&end=      ← superadmin; per rentang tanggal
        │
  /activity-logs                               ← fetch, bukan langganan realtime
```

**Pindah dari RTDB ke SQLite** (per Agu 2026): node `activityLogs` adalah yang paling cepat tumbuh
di seluruh database — tiap klik tiap orang — dan menyeret database yang dibaca halaman lain. Ia
dipindahkan ke satu file SQLite di server kontrol ([`server/activity-db.js`](../server/activity-db.js),
`bun:sqlite`, tanpa dependency baru). Karena browser tidak bisa lagi membaca RTDB, halaman
`/activity-logs` **meminta** rentangnya lewat `GET /activity-logs` (gerbang superadmin) alih-alih
berlangganan. Konsekuensinya diketahui dan diterima: tidak ada lagi pembaruan realtime — ini
tampilan historis, satu bacaan saat dibuka sudah cukup. Baris lama disalin sekali oleh
[`migrate-activity-logs-to-sqlite.mjs`](../functions/migrations/migrate-activity-logs-to-sqlite.mjs).

## Tiga hal yang menentukan seluruh rancangannya

**1. IP tidak bisa datang dari browser.** Sebuah halaman tidak tahu alamat publiknya sendiri; yang
mengaku tahu sedang mengutip layanan pihak ketiga — atau mengarangnya. Kota diturunkan dari IP itu,
jadi ia mewarisi masalah yang sama, dan `User-Agent` yang ditulis browser tentang dirinya sendiri
adalah klaim. Ketiganya karena itu **dicap server** dan tidak pernah dibaca dari body: log yang tiap
barisnya bisa dikarang oleh orang yang dicatatnya bukan log audit.

Akibat yang diketahui dan diterima: **tidak ada jalur cadangan RTDB**, satu-satunya fitur begitu
selain `/plugin`. Yang menggantikannya adalah penyangga di localStorage — server yang mati tidak
menghilangkan satu baris pun, ia cuma menundanya sampai ada yang menerimanya.

**2. `id` dibuat browser, dan itu yang membuat kiriman ulang aman.** Server memakainya apa adanya
sebagai `PRIMARY KEY` baris (`INSERT OR REPLACE`), jadi batch yang sebenarnya sampai tapi jawabannya
hilang di jaringan — lalu dikirim lagi lima menit kemudian — **menimpa baris yang sama** alih-alih
menggandakannya. Tanpa ini, satu jaringan yang buruk menghasilkan riwayat yang menyebut satu klik
sebagai lima klik.

**3. Login yang GAGAL tidak punya token, dan justru itu yang paling perlu tercatat.** Ia tetap
ditulis ke penyangga dan berangkat menumpang **sesi berikutnya yang berhasil login di perangkat yang
sama**. Server mencap `reportedByUid`/`reportedByEmail` — siapa yang benar-benar mengirim — di
samping `actorEmail`, jadi baris titipan tidak bisa menyamar sebagai baris yang dikirim pemiliknya
sendiri. Tanpa cap itu, seseorang bisa menaruh kejadian atas nama orang lain di riwayat hanya dengan
menyunting localStorage-nya.

## Yang dicatat, dan dari mana

| Kategori | Dari mana | Contoh |
|---|---|---|
| `auth` | [`useFirebaseAuth`](../src/hooks/useFirebaseAuth.js) | `login`, `login_failed`, `logout`, `password_changed` |
| `navigation` | `path` milik router, lewat [`useActivityLogger`](../src/hooks/useActivityLogger.js) | `page_view` |
| `interaction` | **satu** pendengar klik di `document` | `click` + label tombolnya |
| `operation` | penulisan RTDB ([`firebaseRepository`](../src/lib/firebaseRepository.js)) + tiap panggilan server kontrol ([`controlApi`](../src/lib/controlApi.js)) | `update:users`, `archive:domains`, `update:role`, `control:post` |

Empat seam, dan tidak satu pun bisa dibuang tanpa membuat "semua aktivitas" jadi janji setengah
kosong:

- **Klik dipasang di `document`, fase CAPTURE** — bukan `onClick` di lima puluh tombol. Dipasang per
  komponen, yang tercatat bukan "semua klik" melainkan "klik di tombol yang sempat diingat orang
  untuk dipasangi", dan tombol yang ditambahkan bulan depan hilang dari log tanpa satu pun tanda.
  Fase capture, karena sebagian handler memanggil `stopPropagation` — di fase bubble yang hilang
  justru tombol di dalam **dialog konfirmasi**, tempat keputusan yang paling ingin ditelusuri.
- **Operasi dicatat di `firebaseRepository`, bukan di `useFirebaseStore`.** Fungsi di store menangkap
  error-nya sendiri lalu memanggil `notifyError` dan mengembalikan `undefined` — dilihat dari luar,
  gagal dan berhasil bentuknya sama persis. Di lapisan repository tulisan yang gagal **melempar**,
  jadi `status: ok/failed` tiap baris adalah apa yang benar-benar terjadi.
- **Panggilan server kontrol dicatat lewat pengamat di `controlApi`.** Gate/ungate, saklar campaign
  Meta, dan seluruh halaman `/plugin` **tidak menyentuh RTDB dari browser sama sekali** — pencatat
  yang cuma mengintip penulisan RTDB akan melewatkan ketiganya sambil tampak lengkap. Endpoint
  `/activity-logs` sendiri dikecualikan: mencatatnya berarti tiap pengiriman jejak melahirkan jejak
  baru, dan penyangga yang tidak pernah bisa kosong.

## Yang TIDAK dicatat

- **Nilai field yang berbau rahasia** — password, secret TOTP, api_key, refresh token. `sanitizeDetail`
  di [`src/lib/activityLog.js`](../src/lib/activityLog.js) menggantinya `•••` **sebelum menyentuh
  penyangga**: yang tidak pernah ditulis ke localStorage juga tidak bisa terbaca dari sana. Nama
  field-nya tetap tampil — "password diubah" memang harus terbaca di log audit; yang tidak boleh
  cuma isinya.
- **Nilai baru sebuah baris.** Yang dicatat adalah *nama field* yang disentuh. Nilainya ada di
  barisnya sendiri, dan menyalinnya ke sini berarti node jejak menyimpan salinan kedua dari data
  yang izin bacanya sudah diatur di tempat lain.
- **Query di alamat.** Kunjungan halaman dicatat lewat **path saja**. Filter dan pencarian tinggal di
  query (lihat konvensi `useUrlState`), jadi satu kotak pencarian yang diketik menghasilkan satu
  perubahan alamat **per huruf** — dan query yang ikut tercatat berarti satu baris jejak per huruf.
- **Kota yang tidak ketemu.** Alamat di balik VPN, rentang CDN, dan sebagian alamat kantor memang
  tidak punya kota; selnya "-" apa adanya. Sebuah "Jakarta" yang dikarang akan dibaca sebagai fakta
  oleh orang yang sedang menelusuri akses mencurigakan.

## Izin: superadmin membaca, semua orang menulis

| | Siapa | Ditegakkan di |
|---|---|---|
| Baca | **superadmin** | `SUPERADMIN_PAGES` + `requireSuperAdmin` pada `GET /activity-logs` |
| Kirim | setiap akun yang login | `requireUser` di `server/activity.js` |
| Simpan | server kontrol | SQLite lokal (`server/activity-db.js`) |

**Asimetri baca-superadmin / kirim-siapa-saja itu disengaja.** Sejak jejak pindah ke SQLite, gerbangnya
bukan lagi aturan RTDB melainkan dua pemeriksa di `server/activity.js`: `GET` (baca halaman) memakai
`requireSuperAdmin`, `POST` (kirim jejak) memakai `requireUser` — setiap akun yang login boleh
mengirim, karena log yang cuma menerima kiriman superadmin tidak mencatat satu pun orang yang
aktivitasnya ingin dilihat. Ini persis asimetri `.read` superadmin / `.write` admin yang dulu berlaku
di RTDB, kini ditegakkan di server alih-alih di `database.rules.json`.

Kenapa **baca**-nya superadmin: isinya adalah ke mana dan kapan setiap orang di tim bergerak, berikut
alamat dan perangkatnya — alasan yang sama persis dengan `otpSecrets`.

## Kenapa halaman ini membaca sepotong, per rentang tanggal

Node ini **tumbuh** — mengikuti jumlah klik, bukan jumlah baris data — jadi sejak dulu ia tidak
pernah dibaca sekaligus. [`useActivityLogs`](../src/hooks/useActivityLogs.js) meminta hanya rentang
tanggal yang sedang dipilih lewat `GET /activity-logs?start=&end=`; server menjawab dengan
`ORDER BY at DESC LIMIT 3000`. Batasnya memotong dari yang **terbaru**, dan halaman **mengatakan**
kalau terpotong — tabel yang diam-diam kehilangan baris tertua akan dibaca sebagai "tidak ada
aktivitas pagi itu".

Batas query diberi margin **sehari di kedua ujung** lalu disaring persis di sisi UI: `at` adalah
stempel UTC sementara rentang yang dipilih orang adalah hari menurut jamnya sendiri (WIB, tujuh jam
di depan). Tanpa margin, tujuh jam pertama tiap hari — 00:00–07:00 WIB, yang di UTC masih tanggal
kemarin — hilang dari hasil tanpa jejak. Margin itu dihitung browser dan dikirim sebagai `start`/`end`.

## Dua jam di tiap baris

`at` adalah jam **perangkat** dan boleh salah; `receivedAt` adalah jam **server**. Keduanya disimpan
berdampingan dan yang kedua tidak menggantikan yang pertama: yang menjelaskan urutan aneh di tabel
justru selisih keduanya, dan menimpa `at` akan menghapus satu-satunya petunjuk itu.

## Konfigurasi

| | Bawaan | |
|---|---|---|
| `ACTIVITY_FLUSH_MS` (browser, konstanta) | 5 menit | jadwal kiriman |
| `ACTIVITY_MAX_BUFFER` | 500 baris | penuh → yang **tertua** dibuang |
| `ACTIVITY_BATCH` | 100 | satu kiriman; sisanya menyusul di putaran yang sama |
| `TRUST_PROXY_HOPS` | `1` | entri `X-Forwarded-For` ke berapa dari kanan |
| `ACTIVITY_LOG_DAYS` | `90` | masa simpan |
| `ACTIVITY_CRON` | `0 0 3 * * *` | pembuangan baris lewat masa simpan |
| `ACTIVITY_DB_PATH` | `/data/activity.sqlite` | file SQLite di VPS (di volume yang bertahan) |

File SQLite-nya harus di **volume yang bertahan lewat redeploy** (lihat `VOLUME /data` di
`server/Dockerfile`) — tanpa mount, tiap container baru mulai dari jejak kosong. Baris lama disalin
sekali dengan `bun functions/migrations/migrate-activity-logs-to-sqlite.mjs` (dijalankan sebagai
**superadmin**: `.read` RTDB `activityLogs` bukan admin). Setelah hasilnya diverifikasi, node
`activityLogs` dan aturannya di `database.rules.json` boleh dibuang manual.

## Estimasi biaya Firebase

Panel kedua di `/activity-logs`, di bawah tabel jejak. Ia menjawab pertanyaan yang sampai sekarang
cuma dijawab tagihan Google sebulan kemudian sebagai **satu angka**: berapa yang benar-benar
diunduh dari RTDB, oleh siapa, dan berapa dolarnya. Aturannya di
[`src/lib/firebaseCost.js`](../src/lib/firebaseCost.js), pengukurnya
[`src/hooks/useNodeSizes.js`](../src/hooks/useNodeSizes.js).

```
muat aplikasi   = jejak yang jaraknya > 30 menit dari jejak sebelumnya, ATAU baris `auth`
unduhan / muat  = Σ ukuran node yang dilanggan ROLE itu  (+ node berat, kalau route-nya membukanya)
biaya           = unduhan ÷ 1 GiB × $1
```

- **BERPINDAH HALAMAN TIDAK MENGUNDUH APA PUN, dan itu pembeda utamanya dari "kunjungan halaman ×
  ukuran database".** Langganan store dipasang sekali saat aplikasi mount dan hidup sampai sesinya
  selesai; membuka sepuluh halaman berturut-turut membaca dari cache yang sama. Yang membayar ulang
  adalah muat aplikasi — login, refresh, tab baru — dan itulah yang dihitung. Dikalikan per
  kunjungan, angkanya berkali lipat dari tagihan yang benar-benar datang, dan yang membacanya akan
  mengejar penghematan yang tidak ada.
- **Batas sesi DITAKSIR dari jeda 30 menit**, karena baris jejak tidak membawa penanda sesi — ia
  lahir dari klik dan kunjungan halaman, bukan dari boot aplikasi. Baris `auth` selalu membuka sesi
  baru berapa pun jedanya: di situ aplikasinya memang baru saja mount.
- **Daftar node per role DIIMPOR, bukan ditulis ulang**
  ([`src/lib/storeSubscriptions.js`](../src/lib/storeSubscriptions.js), `sessionNodes`) — modul yang
  sama yang dipakai `useFirebaseStore` merakit langganannya. Ia pindah ke berkas sendiri justru
  karena pembacanya jadi dua; disalin, ia akan tetap menyebut lima node gating pada hari
  `/vi-control` dilepas, dan estimasinya meleset ke arah yang menenangkan tanpa satu pun tanda.
- **Dua node terberat menyusul menurut ROUTE, bukan menurut role.** `roiSnapshots` dan `userReports`
  hanya ikut kalau sesi itu benar-benar membuka halaman yang membacanya — dibaca lewat
  `resolveRoute` + `needsRoiSnapshots`/`needsUserReports`, bukan dengan mencocokkan potongan alamat
  sendiri. Diikutkan ke tiap sesi, estimasinya naik hampir 5 MB per sesi untuk sesuatu yang justru
  sudah dihemat `heavyData.js`.
- **Ukuran node DIUKUR runtime dari store**, bukan diketik dan bukan diukur di server. Yang diketik
  benar pada hari ia diketik dan basi diam-diam sesudahnya — persis pola "angka ketikan" yang
  ditolak di seluruh repo ini — sementara pengukuran di server berarti alat pengukur biaya mengunduh
  node terberat sekali sehari dan **menambah biaya yang sedang diukurnya**. Di sini yang diukur
  adalah data yang sudah terlanjur diunduh sesi itu; ia gratis. Diukur SEKALI saat panel dibuka
  (tombol "Ukur ulang node" untuk yang memintanya) — `JSON.stringify` atas tiga puluh node di setiap
  pembaruan langganan akan membekukan halaman tiap kali sync menulis satu baris.
- **Yang belum terukur TIDAK dinilai nol.** Nol di sana adalah klaim bahwa sebuah node tidak berisi
  apa-apa, dan yang paling mungkin belum terukur justru dua node terberat: keduanya baru dilanggan
  kalau sesi yang sedang mengukur kebetulan membuka halaman yang membacanya. Ia dikembalikan sebagai
  `unknownNodes`, tidak ikut dijumlah, dan panelnya menyebutkan namanya berikut cara mengukurnya.
  Yang sudah pernah terukur diingat per perangkat di `localStorage` (`rabbitroi.nodeSizes.v1`)
  berikut tanggal pengukurannya, jadi ia tidak hilang tiap kali panel dibuka ulang.
- **ANGKANYA LANTAI, dan mengatakannya adalah syarat ia boleh berdiri sama sekali.** Tiga yang tidak
  terhitung, disebut terpisah karena diperbaiki di tempat yang berbeda: delta yang diterima tab yang
  dibiarkan terbuka tiap kali sync menulis (besarnya tidak ada di jejak mana pun), sesi yang ditutup
  sebelum jejaknya sempat berangkat, dan baris yang terpotong batas 3.000 satu bacaan.
- **Dolar, bukan rupiah — satu-satunya angka uang di dashboard ini yang begitu.** Yang ditagihkan
  Google memang USD, dan tidak ada satu pun sumber kurs di sisi UI (`convertRowsToIdr` tinggal di
  sisi sync); kurs yang dikarang di browser menghasilkan rupiah yang tidak akan pernah cocok dengan
  invoice yang jadi pembandingnya. Empat desimal karena angkanya memang kecil — "$0" untuk unduhan
  200 MB tidak mengatakan apa-apa.
- **SENGAJA tidak ikut penyaring di kepala panel jejak**, sepola kartu Cash Flow — dan di sini
  alasannya lebih keras: batas sesi ditaksir dari jeda antar-baris, jadi penyaring kategori yang
  membuang kunjungan halaman akan memotong satu sesi jadi tiga dan **melipatgandakan** estimasinya.
  Yang tetap berlaku cuma rentang tanggalnya.
- **Rata-rata harian dibagi hari yang ADA jejaknya**, bukan panjang rentang yang dipilih — sepola
  `dayCount` di Proyeksi Budget. Rentang yang separuhnya akhir pekan akan melaporkan rata-rata yang
  separuh terlalu kecil kalau dibagi panjang rentangnya.
