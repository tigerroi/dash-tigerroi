# Server kontrol (Bun + Elysia)

Menggantikan dua Cloud Function terjadwal — `scheduledGating` dan `scheduledCampaignCommands` —
dan menghapus tunggu dua menit yang keduanya paksakan.

## Kenapa ada

**Koreksi yang perlu dibaca duluan:** DRS **tidak** memblokir `scheduledGating`. Yang diblokir DRS
adalah grant `allUsers` — yaitu jalur **browser → Cloud Function**. Fungsi terjadwal dipanggil Cloud
Scheduler dengan service account internal dan berjalan normal.

Yang sebenarnya jadi masalah adalah akibat dari blokir itu: karena browser tidak bisa memanggil
fungsi apa pun, satu-satunya jalur yang tersisa adalah antrean RTDB. Konsekuensinya dua:

| | Lewat antrean | Lewat server ini |
|---|---|---|
| Menekan Gate → hasil terlihat | sampai 2 menit | ~3 detik |
| Umur pratinjau di dialog konfirmasi | sampai 10 menit | detik ini juga |

Server ini memegang API key vi-control (yang tidak boleh sampai ke browser) dan menjalankan
gate/ungate saat tombolnya ditekan.

## Yang TIDAK berubah

Antrean RTDB tetap hidup sebagai jalur cadangan, dan cron di dalam proses ini yang mengurasnya —
menggantikan Cloud Scheduler. Kalau server ini mati atau tidak terjangkau dari browser, halaman
`/vi-control` jatuh sendiri ke antrean dan gating tetap jalan, hanya lebih lambat.

Logikanya **tidak diduplikasi**: tiap endpoint memanggil modul yang sama yang dipakai cron
(`functions/sync-gating.mjs`), termasuk `guardReason` — penjaga gate-ganda. Menekan tombol dan
menunggu cron tidak bisa menghasilkan keputusan yang berbeda.

## Endpoint

Semua butuh `Authorization: Bearer <Firebase ID token>` dan role **superadmin**, kecuali `/livez`.

| | |
|---|---|
| `GET /livez` | tanpa auth, tanpa RTDB, tanpa Keitaro — untuk uptime check |
| `GET /gating/campaigns` | daftar campaign (cache 15 detik; `?fresh=1` melewatinya) |
| `GET /gating/campaigns/:id/preview` | pratinjau segar, **berbentuk identik dengan baris cermin RTDB** |
| `POST /gating/campaigns/:id/gate` | jalankan sekarang |
| `POST /gating/campaigns/:id/ungate` | jalankan sekarang |
| `POST /gating/refresh` | paksa cermin dibaca ulang |
| `POST /gating/sync` | satu siklus penuh (antrean + cermin), jalur yang sama dengan cron |
| `POST /campaigns/:id/status` | nyalakan/matikan campaign Meta sekarang; body `{ userId, status }` |
| `GET /plugin/schema` | definisi field plugin — satu-satunya, dipakai server & browser |
| `POST /plugin/sites/:id/enroll` · `/reset` · `/ping` | daur hidup enrollment satu situs |
| `GET/POST /plugin/sites/:id/config/:group` | `ads-settings` / `header-footer` / `behaviour` |
| `GET /plugin/sites/:id/landings` · `POST` | daftar & simpan landing page |
| `POST /plugin/bulk/enroll` · `/bulk/config/:group` | terapkan ke banyak situs sekaligus |
| `POST /plugin/sync` | satu siklus ping armada |
| `POST /google/configs/:id/consent` | URL consent Google untuk satu kredensial (**admin**, bukan superadmin) |
| `GET /google/callback` | tempat Google mengembalikan orangnya — **tanpa auth**, dijaga `state` sekali pakai |
| `POST /discover/:kind` | "Impor dari Google" — `gamAccounts` · `adsenseAccounts` · `domains` · `subDomains` (**admin**, **202** + hasil di RTDB) |
| `POST /activity-logs` | jejak aktivitas dari browser — **setiap akun yang login**, bukan superadmin |
| `GET /cloudflare/zones` | zona (domain) di akun Cloudflare yang terhubung |
| `GET /cloudflare/zones/:zoneId/dns` | record DNS satu zona, berikut nama zonanya |
| `POST /cloudflare/zones/:zoneId/dns` | tambah record |
| `POST /cloudflare/zones/:zoneId/dns/:recordId` | sunting record (PUT ke Cloudflare) |
| `POST /cloudflare/zones/:zoneId/dns/:recordId/delete` | hapus record — POST, lihat di bawah |

## Impor dari Google

`POST /discover/:kind` menjalankan fungsi impor yang **sama** dengan CLI di `functions/`
(`npm run import:networks`, `import:adsense`, `discover:domains`, `discover:subdomains`) — sepola
dengan gating dan saklar campaign: menekan tombol tidak boleh menghasilkan baris yang berbeda dari
menjalankan CLI-nya. `kind` adalah kunci koleksinya apa adanya, sama dengan `src/config/resources.js`.

- **Admin, bukan superadmin** — cerminan `.write` pada keempat koleksi itu di `database.rules.json`.
- **Satu kunci untuk keempat jenis.** Dua klik pada tombol yang sama membuat dua baris untuk domain
  yang sama: keduanya membaca daftar "yang sudah ada" sebelum yang lain menulis. Yang kedua dijawab
  409 berikut jenis yang sedang jalan.
- **422 vs 502.** Prasyarat yang belum terpenuhi (belum ada kredensial terhubung, belum ada network
  untuk ditanyai) dijawab 422: servernya sehat, yang kurang ada di halaman lain. 502 untuk laporan
  Google yang gagal — itu yang layak dicoba lagi.
- **Tanpa cadangan antrean RTDB**, seperti `/plugin`: yang dijalankan adalah pembacaan API Google
  dengan refresh token yang tidak pernah ada di browser. Server mati = kembali ke CLI.
- **Menjawab 202, bukan hasilnya.** Impor domain memakan ~53 detik, dan tidak ada satu pun batas di
  jalurnya yang cukup longgar untuk dijamin: Bun menutup koneksi yang diam 10 detik (`idleTimeout`
  bawaan — itulah 502 pertama), nginx 120 detik, dan Cloudflare di depan keduanya memutus pada 100
  detik dengan 524 tanpa bisa dinaikkan. Jadi hasilnya dipindahkan ke tempat yang tidak punya batas
  waktu: `dashboard/discoverRuns/{kind}` (`state`: `running` → `done`/`failed`), yang dilanggan
  halaman lewat `awaitDiscoverRun`. Impor yang tabnya ditutup di tengah jalan tetap selesai.
- **`startedAt` di jawaban 202 adalah tandanya.** Node itu menyimpan hasil impor TERAKHIR; tanpa
  mencocokkan `startedAt`, langganan yang baru dipasang menemukan hasil kemarin dan melaporkannya
  sebagai hasil klik barusan.

`gate`/`ungate` **selalu 200 kalau sampai ke vi-control** — yang menentukan hasilnya field `status`
(`ok` / `aborted` / `problem`), diteruskan apa adanya. Dipetakan ke kode HTTP, `aborted` (ditolak,
tidak ada yang ditulis) akan lebur dengan `problem` (TERSIMPAN tapi verifikasinya gagal), dan
bedanya justru satu-satunya yang menentukan apakah seseorang harus membuka Keitaro.

## Saklar campaign Meta

Menggantikan `scheduledCampaignCommands`. Masalahnya identik dengan gating: tombol di
`/users/{uid}` hanya menulis niat ke `users/{uid}/campaignCommands` lalu menunggu cron — dan yang
dimatikan orang biasanya campaign yang sedang membakar anggaran.

Dua hal yang BERBEDA dari gating dan tidak boleh disamakan:

- **Urutan cron-nya kebalikan.** Di sini `refreshCampaignStatuses` jalan **sebelum**
  `applyCampaignCommands`. Meta butuh waktu menampakkan perubahan, jadi bacaan status yang datang
  belakangan akan menimpa perintah yang baru diterapkan dengan keadaan lamanya — dan tombol yang
  baru ditekan melompat balik ke posisi semula di layar. (Gating sebaliknya: vi-control memverifikasi
  sebelum menjawab, jadi cerminnya disegarkan sesudah.)
- **Izinnya bukan superadmin,** melainkan **admin ATAU pemilik campaign itu**, dicocokkan lewat
  email — cerminan `canToggleCampaign`, `assertMayToggle`, dan aturan `users/$uid/campaignCommands`.
  Karena itu `userId` ikut dikirim di body: /users dikunci push-key, jadi tanpa tahu baris profil
  mana yang dituju, kepemilikannya tidak bisa diperiksa sama sekali.

**Campaign dicari di baris user itu sendiri, bukan dipercaya dari request.** Tanpa itu, siapa pun
yang boleh menyentuh satu user bisa mengoper ID campaign milik ad account mana pun di Business
Manager — dan Meta akan menurutinya, karena token System User punya akses ke semuanya. Ada tesnya
(`campaigns.test.mjs`, "tidak bisa diselundupkan lewat userId sendiri").

## Manajemen plugin RabbitROI

Halaman `/plugin` mengelola plugin di tiap subdomain lewat Management API-nya (plugin >= 0.4.7).
Selengkapnya: [docs/plugin.md](../docs/plugin.md).

Yang **berbeda** dari dua fitur di atas dan tidak boleh disamakan:

- **Tidak ada antrean RTDB sebagai cadangan.** Gating dan saklar campaign jatuh ke antrean saat
  server ini mati; di sini tidak ada yang bisa diantrekan. Enroll token dan `api_key` tiap situs
  tinggal di sini, dan situsnya sendiri tidak menjawab browser (tidak ada header CORS untuk origin
  dashboard). Server mati = halaman `/plugin` benar-benar tidak bisa apa-apa, dan halamannya
  mengatakan begitu.
- **Yang menegakkan izinnya server ini, bukan aturan database.** Halaman itu tidak menulis apa pun
  ke RTDB, jadi tidak ada `.validate` yang menahannya — hanya `requireSuperAdmin` di `plugin.js`.
- **Hostname datang dari `subDomains`, tidak pernah dari request.** Enroll token dibagi ke seluruh
  armada; dititipkan lewat request, satu panggilan sudah cukup untuk menyerahkannya ke host mana
  pun. Ada tesnya (`plugin.test.mjs`, "hostname datang dari subDomains, bukan dari request").
- **Kegagalan di situs selalu 502 berikut `code`**, tidak pernah kode aslinya. `invalid_key` (401
  dari WordPress) yang diteruskan apa adanya akan dibaca browser sebagai token Firebase kedaluwarsa,
  dan orangnya disuruh login ulang untuk situs yang kuncinya bermasalah.
- **`PLUGIN_ENROLL_TOKEN` kosong tidak menjatuhkan proses** — beda dari `VI_CONTROL_API_KEY`. Yang
  mati cuma `enroll`; mengelola situs yang sudah enroll tetap jalan dengan kunci di RTDB.

## DNS Cloudflare (tab "DNS Record" di `/domains`)

Zona Cloudflare tiap domain berikut record DNS-nya — dibaca, ditambah, disunting, dan dihapus dari
dashboard. Superadmin, sekelas `/plugin`, dan yang perlu dibaca sebelum menyentuhnya:

- **Tidak ada antrean RTDB sebagai cadangan, dan tidak ada cermin sama sekali.** Sepola `/plugin`
  untuk yang pertama (token tinggal di sini, dan Cloudflare tidak mengirim header CORS untuk origin
  dashboard); sepola panel ad set untuk yang kedua — yang dicari orang di layar itu adalah keadaan
  DNS pada detik ini, dan cermin sejam lalu justru jawaban yang salah. Server mati = tab itu tidak
  bisa dibuka, dan halamannya mengatakan begitu.
- **Yang menegakkan izinnya server ini, bukan aturan database.** Tab itu tidak menulis satu pun
  baris RTDB, jadi tidak ada `.validate` yang menahannya — hanya `requireSuperAdmin` di
  `cloudflare.js`. `SUPERADMIN_PAGES` di frontend cuma menyembunyikan tabnya.
- **Zona dibaca ULANG dari Cloudflare tiap operasi, tidak pernah dipercaya dari request.** Dua hal
  yang dijaganya sekaligus: kepemilikan (tanpa itu, endpoint ini jadi editor DNS untuk zona mana pun
  yang bisa disentuh token kita, cukup dengan mengoper id zona milik akun lain — prinsip yang sama
  dengan `campaignRowOf`), dan NAMA zonanya, yang dipakai melengkapi nama record. Zona di luar akun
  menjawab **404**, dan record-nya tidak pernah disentuh. Ada tesnya.
- **Hapus lewat POST `/delete`, bukan `DELETE`.** CORS server ini mengizinkan `["GET", "POST"]` saja,
  dan daftar itu berlaku untuk SETIAP endpoint di sini — melebarkannya demi satu route berarti
  mengubah aturan yang menjaga gate/ungate dan saklar campaign juga. `/delete` sebagai segmen di
  ujung dan bukan POST ke alamat record itu sendiri: alamat itu sudah berarti "sunting", dan dua arti
  untuk satu alamat yang dibedakan isi body-nya adalah cara sebuah penyuntingan yang body-nya gagal
  terurai menghapus record yang sedang disunting.
- **Sunting memakai PUT, bukan PATCH.** PATCH menambal field yang disebutkan saja, jadi kotak yang
  DIKOSONGKAN orang (komentar, priority) tidak akan pernah benar-benar terhapus — nilai lamanya
  bertahan di Cloudflare sementara layar menunjukkan kotak kosong. Ini kebalikan yang disengaja dari
  POST partial di `/plugin`, dan bedanya ada pada apa yang dibaca form: di sana form dibuka atas
  keadaan yang bisa berubah di sela-sela oleh orang lain, di sini satu record adalah satu baris utuh
  yang baru saja dibaca ulang.
- **`success: false` dengan HTTP 200 dibaca sebagai GAGAL.** Bentuk yang benar-benar dipakai
  Cloudflare, dan kegagalan diam yang sebentuk dengan plugin RabbitROI yang menjawab 200 berisi nilai
  lama: dibaca dari status HTTP-nya saja, layar akan berbunyi "Tersimpan." untuk record yang tidak
  pernah berubah.
- **Yang salah di sisi ORANG jadi 422, yang salah di sisi KITA jadi 502.** Bentuk record yang keliru
  digambar sebagai pesan di form; token yang ditolak tidak bisa dikerjakan siapa pun di layar itu,
  jadi ia tidak boleh menyamar sebagai kesalahan pengisian (`cloudflareFailureStatus`).
- **`CLOUDFLARE_API_TOKEN` kosong tidak menjatuhkan proses** — sepola `PLUGIN_ENROLL_TOKEN`. Yang
  mati cuma tab itu, dan ia menjawab 503 ber-`code: "no_token"` supaya halamannya bisa menyebutkan
  apa yang kurang.

Aturan apa yang boleh ditulis ke DNS tinggal di `functions/cloudflare-core.js`, bukan di sini —
keputusan yang tinggal di dalam pemanggil API tidak bisa diuji tanpa menghubungi Cloudflare.

## Tombol Login Google (`/google-api-configs`)

Consent OAuth untuk tiap kredensial `googleApiConfigs`, tanpa terminal. Sebelum ini consent hanya
bisa lewat `cd functions && npm run authorize -- "<nama>"`, yang menangkap redirect di
`localhost:4571` — artinya harus di laptop orang yang punya repo ini. Tombol di halamannya sudah
ada sejak lama tapi selalu tersembunyi: ia memanggil Cloud Function gen1 `oauth`, jalur browser →
Cloud Function yang di bawah DRS tidak pernah bisa dipanggil sama sekali.

**Yang berbeda dari setiap endpoint lain di server ini**, dan keduanya lahir dari satu kenyataan:
callback Google datang sebagai GET biasa dari browser, tanpa header `Authorization`.

- **Izin diperiksa di langkah pertama, bukan di callback.** Yang menjaga callback adalah `state`
  sekali pakai berumur 15 menit yang disimpan di `googleApiConfigs/{id}/authState` (node admin-only)
  dan dihapus **sebelum** code-nya ditukar. Di titik callback tidak ada identitas apa pun untuk
  diperiksa; sebuah `state` yang masih sah setelah dipakai adalah tautan yang, kalau bocor dari
  riwayat browser, memasang kredensial Google milik siapa pun ke record itu.
- **Callback selalu menjawab redirect, tidak pernah JSON.** Yang membacanya adalah orang yang baru
  kembali dari layar consent, bukan `fetch`. Tujuannya selalu `/google-api-configs` di origin
  dashboard — tidak pernah alamat yang datang dari request, karena redirect yang tujuannya bisa
  ditentukan pemanggil adalah open redirect, dan yang ini berdiri di ujung alur OAuth.
- **ADMIN, bukan superadmin** — satu-satunya endpoint di server ini yang begitu. Cerminan `.write`
  pada `googleApiConfigs` di `database.rules.json`: gerbang yang lebih tinggi di sini akan menolak
  orang yang aturan databasenya justru mengizinkan menulis record yang sama.

### Tiga hasil, dan meleburnya menghapus satu-satunya hal yang menentukan langkah berikutnya

Sepola `ok`/`unapplied`/`failed` di plugin dan `ok`/`aborted`/`problem` di gating:

| `ok` | token baru datang, kedua scope diberikan | selesai |
|---|---|---|
| `partial` | token baru **tersimpan**, tapi scope-nya kurang | tersimpan ≠ bisa dipakai — halaman AdSense tetap kosong sampai consent diulang |
| `failed` | Google tidak mengembalikan refresh token | **tidak ada yang ditulis** — kredensialnya masih memakai token yang lama |

`failed` yang paling menipu: consent-nya berhasil, browsernya kembali dengan selamat, tidak ada
error di jalur mana pun — yang tidak terjadi cuma pergantian tokennya. Karena itu record tidak
disentuh sama sekali; status "Connected" untuk token lama yang scope-nya justru sedang diperbaiki
adalah kebohongan yang membuat orang berhenti mencari.

Ini bukan kemungkinan teoretis. Kredensial `petcins.com` berbulan-bulan berstatus "Connected"
dengan refresh token yang hanya membawa scope `admanager` — consent-nya terjadi sebelum
`adsense.readonly` masuk ke `SCOPES` — dan satu-satunya gejalanya adalah `/adsense-accounts` yang
kosong. Sejak consent lewat tombol ini, scope yang benar-benar diberikan tersimpan di record
(`scopes`, `scopeSummary`) dan tampil sebagai kolom **Izin** di halamannya.

### Pemasangan

1. `CONTROL_PUBLIC_URL` di `server/.env` = alamat publik server ini. Tidak bisa disimpulkan dari
   dalam container: yang diketahui proses ini cuma port yang didengarkannya. Kosong, hanya tombol
   ini yang mati (503 berikut sebabnya) — tidak ada fitur lain yang bergantung padanya.
2. Daftarkan `<CONTROL_PUBLIC_URL>/google/callback` sebagai **Authorized redirect URI** di **tiap**
   OAuth client Google (satu per kredensial). Dicocokkan karakter demi karakter, termasuk ada
   tidaknya garis miring di ujung; yang tidak terdaftar ditolak `redirect_uri_mismatch`, yang tidak
   menyebut nilai mana yang diharapkannya.
3. `DASHBOARD_URL` opsional — default `ALLOWED_ORIGINS` pertama, supaya tidak ada konfigurasi kedua
   yang bisa bergeser darinya.

`cd functions && npm run oauth:check` menjawab keduanya per kredensial: alamat callback sudah
terdaftar atau belum, dan scope apa yang dibawa token yang tersimpan sekarang. Langkah 2 yang
terlewat **tidak terlihat di dashboard sama sekali** — alurnya berhenti di layar Google
("Error 400: redirect_uri_mismatch") dan browsernya tidak pernah kembali membawa kabar apa pun.

Jalur CLI (`npm run authorize`) tidak dicabut dan tetap berguna: ia satu-satunya yang bekerja saat
server ini belum dipasang, dan redirect localhost-nya tidak butuh pendaftaran ulang di Google.

## Jejak aktivitas (`/activity-logs`)

Satu-satunya endpoint di server ini yang terbuka untuk **setiap akun yang login**, sementara halaman
yang membacanya (`/activity-logs`) hanya untuk superadmin. Kebalikannya tidak masuk akal: jejak yang
cuma menerima kiriman superadmin tidak mencatat satu pun orang yang aktivitasnya ingin dilihat.

Browser mencatat ke `localStorage` lalu mengirim tiap **5 menit** (juga saat jaringan kembali dan
saat tab ditinggalkan). Yang dikirim cuma yang hanya diketahui browser — apa yang diklik, halaman
apa yang dibuka, kapan menurut jamnya sendiri. **Tiga field dicap di sini dan tidak pernah dibaca
dari body:**

| | Kenapa tidak boleh dari browser |
|---|---|
| `ip` | halaman tidak tahu alamat publiknya sendiri; yang mengaku tahu mengutip pihak ketiga atau mengarangnya |
| `city` / `region` / `country` | diturunkan dari IP di atas — `geoip-lite`, basis data lokal, tanpa memanggil siapa pun |
| `userAgent` → `browser`/`os`/`device` | `ua-parser-js`; yang ditulis browser tentang dirinya sendiri adalah klaim |

- **`TRUST_PROXY_HOPS`** (bawaan `1`) menentukan entri `X-Forwarded-For` mana yang dipakai —
  dihitung **dari kanan**. Header itu ditambahi tiap hop dan yang paling kiri ditulis KLIEN: diambil
  dari sana, siapa pun bisa mengganti alamatnya sendiri di seluruh log. Server yang menghadap
  internet langsung memakai `0`.
- **Kunci barisnya dibuat browser** dan dipakai apa adanya sebagai kunci RTDB, jadi batch yang
  sampai tapi jawabannya hilang di jaringan — lalu dikirim ulang — menimpa baris yang sama alih-alih
  menggandakannya.
- **`reportedByUid`/`reportedByEmail`** mencap siapa yang benar-benar mengirim, di samping
  `actorEmail`. Keduanya berbeda untuk satu hal yang paling perlu tercatat: **login yang gagal** —
  tidak punya token, jadi barisnya menunggu di perangkat itu dan menumpang sesi berikutnya.
- **Masa simpan `ACTIVITY_LOG_DAYS`** (bawaan 90 hari), dibuang cron `ACTIVITY_CRON` (bawaan 03:00).

Selengkapnya: [docs/activity-logs.md](../docs/activity-logs.md).

## Sync penuh untuk instansi tanpa Cloud Functions (`SYNC_SCHEDULE`)

Instansi 2 (project rabbitroi-dwiki, unit `rabbitroi-jon`) tidak punya Cloud Functions, jadi
`scheduledSync` tidak pernah jalan di sana: `dashboard/syncStatus` kosong, topbar menulis sync belum
berjalan, dan `roiReports` cuma terisi kalau seseorang menjalankan CLI dengan tangan.

- **`SYNC_SCHEDULE` (cron LIMA bidang, mis. `5 * * * *`) menyalakan sync penuh di proses ini**, plus
  retry akun yang gagal (`SYNC_RETRY_CRON`, bawaan detik ke-30 tiap menit). Kosong = mati, dan itu
  WAJIB untuk instansi 1: di sana `scheduledSync` sudah jalan, dan dua penjadwal untuk satu
  database menembakkan kuota GAM/Meta dua kali lalu saling menimpa `dashboard/syncStatus`.
- **Badannya satu** — `runFullSync`/`runSyncRetries` di `functions/sync-run.mjs`, yang juga dipanggil
  Cloud Function. Lima bidang dan bukan enam karena nilainya ditulis ke `syncStatus.schedule`, dan
  topbar menghitung jadwal berikutnya dari situ.
- **Tahap Meta campaigns dan Saklar campaign lewat `campaignLock`** yang sama dengan siklus saklar
  dua menitan dan antrean sync /campaigns: ketiganya menulis `users/{id}/campaigns`.
- Tidak ada batas 9 menit di sini, tapi tetap satu run pada satu waktu — run yang lebih lambat dari
  jadwalnya membuat run berikutnya dilewati, bukan diantrekan.

## Auth

Tanpa service account. Verifikasi ID token hanya butuh kunci **publik** Google, jadi tidak ada file
kredensial yang harus dititipkan di host — satu file kredensial yang tidak perlu ada adalah satu
file kredensial yang tidak bisa bocor.

- Tanda tangan diperiksa terhadap JWKS Firebase, **`/jwk/` (tunggal)**. Yang plural menjawab 404
  berisi HTML, dan jose melaporkannya sebagai kegagalan mengurai kunci — pesan yang tidak menyebut
  URL-nya salah.
- `aud` dan `iss` ikut diperiksa, bukan cuma tanda tangannya: token dari project Firebase **mana
  pun** ditandatangani kunci Google yang sama. Tanpa memeriksa `aud`, siapa pun yang punya project
  Firebase gratis bisa membuat akun di sana lalu memakai tokennya di sini.
- Role dibaca dari `/roles/{uid}` — tempat yang sama yang dibaca `database.rules.json`.
- Kegagalan **tentang token** → 401. Bukan superadmin → 403 (bukan 401: browser akan menyegarkan
  token selamanya untuk penolakan yang tidak akan berubah karenanya). Pemeriksaannya sendiri yang
  gagal (RTDB tak terjangkau, JWKS tak terambil) → 503, karena itu bukan penolakan.

## Halaman Campaign (`/fleet`)

SUPERADMIN (`requireSuperAdmin` di `campaign-manage.js`). Menulis ke Meta dengan `META_ACCESS_TOKEN`.

| Method + path | Guna |
|---|---|
| `POST /fleet/campaigns/:id/copies` | Salin bertahap di latar (lahir PAUSED); menjawab `jobId` |
| `GET /fleet/campaigns/:id?userId=` | Nama + anggaran segar untuk form |
| `POST /fleet/campaigns/:id` | Ubah nama / anggaran harian campaign |
| `GET /fleet/campaigns/:id/adsets/:adSetId?userId=` | Nama, anggaran, ringkasan targeting |
| `POST /fleet/campaigns/:id/adsets/:adSetId` | Ubah nama / anggaran / negara / umur ad set |
| `GET /fleet/accounts/:accountId/assets` | Pixel, Halaman, dan pustaka gambar akun itu (bahan form Buat) |
| `POST /fleet/accounts/:accountId/images` | Unggah satu gambar (multipart `file`) → hash |
| `POST /fleet/campaigns` | Buat campaign + N ad set + N iklan di latar (lahir PAUSED); menjawab `jobId` |

- `CAMPAIGN_JOBS_CRON` (bawaan `20 */5 * * * *`) menyapu job yang menggantung di
  `dashboard/campaignCopyJobs` DAN `dashboard/campaignCreateJobs`, lalu membuang yang lebih dari 7
  hari. Penyalinan dan pembuatannya sendiri berjalan di latar proses ini sesudah route menjawab.
- **`POST /fleet/accounts/:id/images` butuh `client_max_body_size 8m` di nginx.** Bawaan nginx 1 MB,
  dan yang ditolak di sana menjawab HTML 413 yang tidak menyebut apa pun tentang gambar — batas
  8 MB milik server ini sendiri menjawab 422 berikut ukuran berkasnya.
- **App Meta pemegang token harus App Mode: Live.** Selama ia Development Mode, tiap creative baru
  ditolak `(#100-1885183)` — campaign dan ad set tetap lahir, job-nya `partial` dengan sebab yang
  menyebut saklarnya. Sejak 12 Sep 2026 app-nya Live dan alur buat campaign terbukti `done` ke
  produksi. Privacy Policy URL yang dituntut Meta dilayani hosting yang sama: `/privacy.html`.
- **SALINAN tidak lagi kena batas itu.** Iklan yang dilewatkan deep copy dibuatkan sendiri dengan
  `creative_id` iklan sumbernya, jadi tidak ada creative baru yang lahir. Yang tersisa adalah izin
  beriklan per HALAMAN (`(#100-1885499)`): beri System User akses Iklan (Create ads) pada Halaman
  iklan itu di Business Manager, dan pesan job-nya menyebutkan Halamannya.
- `POST /fleet/campaigns` menerima `link` (salah satu Campaign URL baris subdomain — yang diadu cuma
  sisi sebelum `?`) dan `urlTags` opsional, yang jadi `url_tags` iklannya. `urlTags` berbentuk
  `kunci=nilai` dipisah `&`; link penuh di sana ditolak 422.
- Sync akun sesudah tulisan digabung ~30 detik dan memakai penjaga yang sama dengan siklus campaign.
- Tanpa `VITE_CONTROL_API_URL` di build hosting, halamannya tetap terbuka (tabel dari RTDB) tapi
  kolom Aksi tidak digambar.

## Menjalankan

```bash
cd server
cp .env.example .env      # isi VI_CONTROL_API_KEY + SYNC_USER_*
bun install
bun run dev               # atau: bun run start
bun test
```

Docker:

```bash
docker build -f server/Dockerfile -t rabbitroi-control .  # konteks build = root repo
docker run --env-file server/.env -p 8080:8080 rabbitroi-control
```

Image-nya memuat `functions/` juga — modul gating tinggal di sana dan sengaja tidak diduplikasi.

## Yang sudah terpasang (17 Agu 2026)

Server ini hidup di `95.216.224.118`, vhost **https://dashboard-api.adsgo.live** (di belakang
Cloudflare), dan `scheduledGating` + `scheduledCampaignCommands` sudah **dihapus** dari project —
cron di dalam proses inilah satu-satunya penguras antrean sekarang. Cara memastikannya masih begitu:

```bash
curl -s https://dashboard-api.adsgo.live/livez                   # -> ok, tanpa auth
npx firebase functions:list --project rabbitroi-89973            # tidak boleh ada scheduledGating
```

> **Nama lama `gating.adsgo.live` sudah TIDAK dilayani.** Baris `server_name` pada vhost hanya
> memuat nama baru, jadi apa pun yang masih memanggil nama lama gagal di lapisan koneksi — bukan
> 404 yang bisa dibaca, melainkan `Failed to fetch` tanpa satu pun jejak di log server ini.
>
> Alamat API dipanggang ke dalam bundle frontend saat build, jadi **mengganti nama server berarti
> build + deploy hosting di menit yang sama** — bukan "nanti saja, tab lama masih jalan". Sekali
> terlewat, akibatnya tidak seragam dan itu yang membuatnya lama tidak terbaca: `/vi-control` hanya
> melambat diam-diam (ia jatuh ke antrean RTDB, dan yang terlihat di log cuma
> `1 diterapkan … dari 1 antrean`), sementara `/plugin` — yang tidak punya antrean sebagai cadangan
> — berteriak `Skema pengaturan gagal diambil dari server`. Satu sebab, dua gejala yang tidak
> terlihat berhubungan.

Detak cron-nya terbaca dari RTDB tanpa membuka server: `dashboard/syncIssues/gating.checkedAt`
maju tiap dua menit, dan `dashboard/gating/status.mirroredAt` tiap sepuluh menit.

## Setelah server ini dipasang

1. Set `VITE_CONTROL_API_URL` di `.env` frontend lalu build ulang **dan deploy hosting** — nilainya
   ikut masuk ke bundle saat build, jadi `.env` yang benar tapi bundle lama berarti halaman `/vi-control`
   masih memakai antrean seperti sebelumnya (tidak error, hanya lebih lambat). (`VITE_GATING_API_URL`
   masih dibaca sebagai nama lama.)
2. `ALLOWED_ORIGINS` harus memuat origin dashboard. Jangan `*`: tiap request memang tetap butuh ID
   token superadmin, tapi CORS terbuka berarti halaman mana pun bisa mencoba memakai token yang
   sedang aktif di browser.
3. Matikan Cloud Function-nya supaya tidak ada dua penguras antrean:
   `firebase functions:delete scheduledGating scheduledCampaignCommands --project rabbitroi-89973`.
   Selama keduanya hidup, keduanya idempoten dan saling menjaga lewat `guardReason` — tapi keduanya
   juga membaca Keitaro tiap dua menit untuk jawaban yang sama.
