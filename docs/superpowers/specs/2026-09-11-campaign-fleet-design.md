# Halaman Campaign: duplikasi dan kelola campaign Meta dari dashboard

Tanggal: 11 Sep 2026 · Status: disetujui; direvisi 11 Sep 2026 sesudah pembuktian ke Meta produksi

## Revisi 11 Sep 2026: salin BERTAHAP, bukan antrean asinkron

Pembuktian ke Meta produksi (lampiran di akhir) membatalkan jalur asinkron. Bagian di bawah yang
menyebut `async_batch_requests`, `requestSetId`, `submittedAt`, mode `direct`/`async`, batas 4–51
iklan, dan cron pemantau batch **digantikan** oleh revisi ini — begitu juga tiap aturan di bawah yang
berselisih dengannya (mis. ganti nama yang gagal = `done` di bagian 5 kini `partial`).

- **`async_batch_requests` tidak bisa dipakai app ini.** Satu item selalu ditolak `(#194) param
  adbatch has too few elements` (batasnya minimal 2, tidak tertulis di dokumentasi); dua item ditolak
  `(#10) Application does not have permission for this action` — termasuk untuk membuat campaign
  biasa. Membukanya butuh App Review.
- **Salin bertahap, seluruhnya panggilan langsung:** (1) salin campaign TANPA isinya
  (`deep_copy=false`, `PAUSED`, `ONLY_TOP_LEVEL_RENAME` berakhiran unik per job dan per salinan,
  ` (salinan {jobId}-{n})`); (2) LANGSUNG ganti namanya ke nama yang diminta; (3) salin tiap ad set
  sumber yang saklarnya ACTIVE atau PAUSED ke campaign baru itu (`POST /{ad_set_id}/copies`,
  `campaign_id`, `deep_copy=true`, `status_option=INHERITED_FROM_SOURCE` — campaign-nya sudah
  PAUSED, jadi tidak ada yang tayang, dan saklar tiap ad set tetap seperti aslinya). Ganti nama yang
  gagal tidak menghentikan ad set; salinannya `partial` dan tertinggal bernama sementara.
- **Nama campaign harus unik di ad account-nya (revisi 11 Sep 2026, sesudah review akhir).** Sync
  melebur campaign Meta per NAMA (`mergeCampaignSources`, kunci `normalizeName`), jadi dua campaign
  bernama sama di satu akun jadi SATU baris tabel dengan `campaignId` milik yang didaftar Meta
  terakhir: salinannya hilang dari tabel, atau saklar baris sumber menyalakan salinannya. Karena itu
  (a) salin dan ganti nama menolak 422 nama yang sudah dipakai campaign lain di akun itu
  (`fetchCampaignSettings`, ditambah nama job salinan akun itu yang masih berjalan; campaign yang
  diganti namanya dikecualikan, dan nama yang tampak "tidak berubah" menurut baris tabel TETAP
  diperiksa — baris itu basi persis saat campaign baru diganti nama di Ads Manager); (b) campaign tanpa isi
  tidak pernah lahir dengan nama persis sumbernya, sekejap pun (akhiran di atas); (c) isian nama di
  dialog salin bawaannya `{nama sumber} (salinan)`.
- **Batas: paling banyak 3 iklan PER AD SET** (batas salinan langsung Meta berlaku per panggilan) dan
  paling banyak 50 ad set per campaign. Yang melebihi ditolak 422 sebelum menyentuh Meta, dengan nama
  ad set-nya.
- **Iklan yang tidak ikut tersalin HARUS terdeteksi.** Deep copy MELEWATKAN iklan tanpa satu pun
  error kalau System User tidak punya izin beriklan di Halaman yang dipakai creative-nya — campaign
  dan ad set tersalin, iklannya tidak. Jumlah iklan yang lahir (`ad_object_ids` bertipe `ad`)
  dibandingkan dengan jumlah iklan sumber PER AD SET (dipotong di jumlah sumbernya, jadi kelebihan di
  satu ad set tidak menutupi yang hilang di ad set lain); selisihnya membuat salinan berstatus
  `partial` dengan sebab yang menyebut izin Halaman. `copyOutcome` menurunkan `partial` sendiri dari
  catatan salinan.
- **Job dijalankan di latar sesudah route menjawab**: route menulis job `requested`, menjawab
  `{ jobId, state: "running" }`, lalu menyalin; progresnya (`progress: { done, total }` ad set)
  ditulis ke node job yang sudah dilanggan halaman. Satu salinan bisa berarti puluhan panggilan, dan
  permintaan HTTP yang menggantung selama itu tidak berguna bagi siapa pun. Tiap salinan dicatat di
  `copies/{i}` begitu lahir (bukan cuma di tulisan akhir), dan tulisan progres yang gagal cuma
  dicatat di log — ia tidak boleh menghilangkan salinan yang sudah lahir.
- **Status job:** `requested` → `running` → `done` / `partial` / `failed` / `unknown`; `requested`
  >10 menit sejak diminta atau `running` >30 menit sejak AKTIVITAS TERAKHIR (`updatedAt`) →
  `unknown`. Salin campaign yang gagal dengan hasil TIDAK PASTI (kode 1/2, jaringan putus/waktu
  habis, balasan non-JSON/HTTP 5xx, sukses tanpa ID) juga `unknown` (`uncertain: true` di salinan,
  "periksa Ads Manager"), bukan `failed`: salinannya mungkin sudah lahir. Cron hanya menyapu yang
  menggantung (menulis path yang berubah saja) dan membuang job >7 hari (tiap 5 menit) — tidak ada
  lagi yang dipantau di Meta. Satu sumber, satu job: selain pemeriksaan job aktif di RTDB, server
  memegang penjaga di dalam prosesnya sampai penyalinan selesai, karena dua klik bersamaan sama-sama
  membaca daftar job sebelum yang lain menulis.
- **Prasyarat di Business Manager:** System User harus diberi tiap Halaman Facebook yang dipakai
  creative iklan armada, dengan izin **Create ads**. Pada 11 Sep 2026 System User belum punya satu
  Halaman pun (`me/accounts` kosong); sebelas Halaman dipakai iklan armada.

## Tujuan dan tahapan

Tujuan jangka panjangnya mengurangi pekerjaan advertiser. Ia dipecah jadi tahap yang masing-masing
punya desain dan rencananya sendiri:

| Tahap | Isi | Dokumen |
|---|---|---|
| **1 (dokumen ini)** | Duplikasi campaign + ubah anggaran, nama, dan targeting, tanpa AI | ini |
| 2 | Form buat campaign dari nol (objective, ad set, iklan, Page, gambar) | menyusul |
| 3+ | AI: optimasi campaign berjalan, peluncuran, kreatif | menyusul |

Tahap 1 sengaja tanpa AI: semua tahap sesudahnya butuh jalur tulis ke Meta yang sudah terbukti.

**Di luar lingkup tahap 1**: arsip/hapus, jadwal mulai/selesai, lifetime budget, bid strategy,
minat dan penempatan, menyalin ke ad account lain, menyalin untuk subdomain lain.

## Fakta yang sudah diperiksa

- **Token produksi sudah cukup** (debug_token, 11 Sep 2026): System User, app "New RabbitROI", tidak
  kedaluwarsa, scope `ads_management`, `ads_read`, `business_management`, `pages_manage_ads`,
  `pages_read_engagement`, `pages_show_list`, `catalog_management`, `threads_business_basic`,
  `public_profile` — persis set use case "Create & manage ads". Tidak butuh App Review: seluruh ad
  account milik Business Manager sendiri.
- **Versi API.** Kode mematok `v21.0` sebagai bawaan dan tidak ada env yang mengubahnya. Marketing
  API v21.0 berakhir 9 Sep 2025; v25.0 belum punya tanggal berakhir. Meta menjawab permintaan
  `v21.0`, `v24.0`, dan `v25.0` dengan header `facebook-api-version: v26.0` — jadi hari ini tidak ada
  yang rusak, tapi perilaku endpoint tulis ikut bergeser tiap Meta menaikkan versi.
- **`POST /{campaign_id}/copies`**: `deep_copy` (bawaan `false`; `true` ikut menyalin ad set dan
  iklan), `status_option` (bawaan `PAUSED`), `rename_options` (`rename_strategy`
  `DEEP_RENAME`/`ONLY_TOP_LEVEL_RENAME`/`NO_RENAME`, `rename_prefix`, `rename_suffix`). Jawabannya
  `copied_campaign_id` + `ad_object_ids`. **Batas: 3 iklan untuk panggilan langsung, 51 untuk
  asinkron.** Dokumentasinya tidak menyebut ad account tujuan — salinan tinggal di akun yang sama.
- **Asinkron**: `POST /act_{id}/async_batch_requests` (`name`, `adbatch` = daftar
  `{name, relative_url, body}`); status di `GET /{set}?fields=id,name,success_count,error_count,is_completed`,
  hasil per permintaan di `GET /{set}/requests?fields=id,status,result,input`. **Dokumentasi
  asinkron tidak mencontohkan `copies`** — dibuktikan di langkah pertama implementasi.
- **Link iklan tidak bisa diubah**: `object_story_spec`/`link_data`/`url_tags` pada ad creative
  tidak termasuk field yang bisa diperbarui. Karena itu salinan hanya untuk subdomain yang SAMA.
- **Penyegaran dua menitan (`campaignStatusRefresh`) cuma memperbarui baris yang sudah ada** —
  status, jadwal, anggaran. Ia tidak menambah baris baru dan tidak membaca nama. Campaign baru dan
  nama baru baru tampil lewat `syncCampaigns` (sync penuh per jam, atau per akun lewat `only`).

## 1. Arsitektur

Pendekatan **campuran**: anggaran, nama, dan targeting ditulis langsung lewat server kontrol;
salinan ikut dicatat di RTDB supaya progresnya terbaca semua superadmin dan tidak hilang saat tab
ditutup.

| Unit | Tanggung jawab | Bergantung pada |
|---|---|---|
| `functions/meta.js` | Panggilan Meta saja: salin (langsung + batch), baca status batch, ubah campaign, ubah ad set, baca targeting lengkap | `graphPost`/`request` yang ada |
| `functions/campaign-manage-core.js` | Aturan murni: vonis nama, anggaran, penggabungan targeting, mode salin, bentuk + transisi job | `parseCampaignCodes`, `buildCodeIndex` |
| `server/campaign-manage.js` | Route `/fleet/...`, gerbang `requireSuperAdmin`, kepemilikan, urutan tulis | dua unit di atas |
| `server/campaign-rows.js` | `campaignRowOf` dipindah dari `server/campaigns.js`, dipakai kedua berkas | store |
| `server/account-sync-queue.js` | Antrean sync per ad account, digabung dengan jeda ~30 detik | `syncCampaigns` |
| RTDB `dashboard/campaignCopyJobs/{jobId}` | Catatan job salinan | `.validate` di rules |
| `src/components/campaigns/*` | Halaman `/campaigns`, dialog, panel Salinan | `controlApi` |

- **Versi dipatok ke `v25.0`** di `functions/meta.js` dan `tools/meta-check.mjs`, sebagai commit
  pertama yang berdiri sendiri.
- **Penjaga tumpang-tindih bersama.** `runCampaignCycle` di `server/index.js` punya `campaignRunning`
  lokal. Antrean sync dan penyegaran status tidak boleh berjalan bersamaan — keduanya menulis
  `users/{id}/campaigns` — jadi penjaganya dipindah ke satu modul yang dipakai keduanya.
- **Tiap tulisan yang berhasil memasukkan ad account-nya ke antrean sync.** Lima ganti nama di satu
  akun dibayar satu `syncCampaigns(db, token, [accountId])`. Kegagalan sync cuma dicatat di log
  server; sync per jam membawa perubahannya.

### Route

Semua `requireSuperAdmin`. `userId` ikut di body/query karena campaign tinggal di baris profil
pemiliknya, dan `campaignRowOf` mencarinya di sana — ID dari request tidak pernah dipercaya sebagai
alamat Meta.

| Method + path | Body/query | Guna |
|---|---|---|
| `POST /fleet/campaigns/:campaignId/copies` | `{ userId, name, count }` | Duplikasi |
| `GET /fleet/campaigns/:campaignId` | `?userId=` | Nilai segar untuk form ubah campaign |
| `POST /fleet/campaigns/:campaignId` | `{ userId, name?, dailyBudget? }` | Ubah campaign |
| `GET /fleet/campaigns/:campaignId/adsets/:adSetId` | `?userId=` | Nilai segar untuk form ubah ad set |
| `POST /fleet/campaigns/:campaignId/adsets/:adSetId` | `{ userId, name?, dailyBudget?, countries?, ageMin?, ageMax? }` | Ubah ad set |

Ad set dibuktikan milik campaign itu dengan membacanya ulang dari Meta, sepola saklar ad set.

### Node job

```
dashboard/campaignCopyJobs/{jobId}
  sourceCampaignId   "120212345678"        string angka
  sourceName         nama campaign sumber
  userId, accountId, actId
  count              1..5
  names              ["nPJL-07 ... #1", ...]
  mode               "direct" | "async"
  state              requested | running | done | partial | failed | unknown
  requestSetId       hanya mode async
  copies/{i}         { name, campaignId, renameError }
  error              sebab, untuk failed/unknown
  requestedBy, requestedAt, updatedAt, finishedAt
```

- Ditulis server. `.validate` menuntut `sourceCampaignId`, `state`, `requestedAt`, dan `state` dari
  daftar di atas; butuh `npm run deploy:rules`.
- Dilanggan **hanya superadmin** (`campaignSubscriptions` di `src/lib/storeSubscriptions.js`, sepola
  `gatingSubscriptions`), jadi estimasi biaya Firebase ikut benar tanpa disentuh.
- Cron semenit (penjaga tumpang-tindihnya sendiri) memeriksa job `running`, menandai yang kedaluwarsa,
  dan membuang job lebih dari 7 hari.

## 2. Duplikasi

**Form**: Nama (diisi awal nama sumber) dan Jumlah salinan (1–5; lebih dari satu → akhiran
` #1`…` #n`). Tidak ada anggaran, negara, maupun status: **salinan selalu lahir `PAUSED`**, diubah
lewat fitur edit, lalu dinyalakan dengan saklar yang sudah ada.

**Vonis nama** (`campaignNameVerdict`, dipakai juga ganti nama campaign di bagian 3). "Kode" di sini
berarti kode terdaftar PERTAMA yang ditemukan di nama — aturan `matchCode` di `sync-meta.mjs`, yang
dipindah ke `sync-core.js` supaya sync dan vonis ini memakai fungsi yang sama. Aturan yang berbeda
berarti dialog menyetujui nama yang oleh sync dipetakan ke subdomain lain.

| Keadaan | Hasil |
|---|---|
| Nama tidak membawa satu pun kode terdaftar | ditolak — belanjanya tidak masuk ROI siapa pun |
| Sumber terpetakan lewat kode, nama membawa kode subdomain LAIN | ditolak — link iklannya tetap ke subdomain sumber |
| Sumber belum terpetakan atau dipetakan manual | boleh, konfirmasi menyebut subdomain yang dituju |
| Kode milik subdomain yang sama | boleh |

**Alur server**

1. Tolak 409 kalau ada job `requested`/`running` untuk sumber yang sama.
2. Hitung iklan sumber (`fetchCampaignAds`): ≤3 → `direct`, 4–51 → `async`, >51 → 422.
3. **Tulis job `requested` dulu**, baru panggil Meta.
4. Salin dengan `deep_copy=true`, `status_option=PAUSED`, `rename_strategy=NO_RENAME`, lalu ganti
   nama campaign salinannya lewat panggilan terpisah — `copies` hanya bisa menambah awalan/akhiran,
   dan awalan mendorong kode Keitaro keluar dari posisi pertama.
   - `direct`: satu panggilan per salinan → ganti nama → `done`/`partial`/`failed` → antrean sync.
   - `async`: satu batch berisi `count` permintaan → simpan `requestSetId`, `running`. Cron membaca
     `is_completed`, mengganti nama tiap salinan yang lahir, menulis `done`/`partial`/`failed`, lalu
     antrean sync.

**Yang sengaja tidak dilakukan**

- **Tidak ada percobaan ulang untuk salinan**, termasuk percobaan ulang otomatis di `request` untuk
  kode sementara (1, 2, 4, 17, …): kode 1/2 bisa datang sesudah Meta sempat membuat salinannya.
  `graphPost` mendapat opsi `retry: false`, dipakai hanya oleh panggilan salin dan pengiriman batch.
- Job `requested` lebih dari 10 menit, atau `running` yang belum `is_completed` setelah 60 menit →
  `unknown` dengan kalimat "periksa Ads Manager sebelum menyalin lagi". Bukan `failed`: server tidak
  tahu apakah salinannya sudah lahir.
- Ganti nama yang gagal tidak menggagalkan job: `done` + `renameError` pada salinan itu, dan namanya
  bisa dibetulkan lewat fitur edit.

## 3. Edit anggaran, nama, targeting

**Umum**
- Form dibuka dengan nilai yang dibaca langsung dari Meta (route `GET` di atas), bukan dari RTDB.
- Hanya field yang berubah yang dikirim.
- Sesudah berhasil panel dibaca ulang dari Meta dan `adSetCache` dibuang — tidak ditambal di layar.
- Baris `metaMissing`, diarsipkan, atau tanpa `campaignId`: tombol mati berikut sebabnya.

**Anggaran**
- Hanya **anggaran harian**, di tingkat yang memegangnya: campaign (CBO) atau ad set (ABO). Tingkat
  yang salah menampilkan "anggaran dipegang campaign/ad set", bukan kotak isian.
- Lifetime budget: tanpa kotak edit, berikut sebabnya.
- Dikonversi lewat `META_MINOR_UNIT` yang sama dengan pembacaan. Konfirmasi menyebut lama → baru dan
  persen perubahannya. Minimum anggaran milik Meta; penolakannya ditampilkan apa adanya.

**Nama**
- Ad set: bebas (pemetaan subdomain hanya membaca nama campaign).
- Campaign: `campaignNameVerdict` yang sama dengan duplikasi, dengan campaign itu sendiri sebagai
  "sumber". Selalu memasukkan akunnya ke antrean sync.

**Targeting ad set**
- Server membaca ulang `targeting` lengkap dari Meta sesaat sebelum menulis, mengganti
  `geo_locations.countries`, `age_min`, `age_max` saja, lalu mengirimnya utuh. Aman untuk "ganti
  utuh" maupun "tambal", dan perubahan di Ads Manager selama form terbuka tidak tertimpa.
- Hanya bisa diedit kalau `geo_locations` berisi negara saja (`location_types` boleh). Wilayah, kota,
  kode pos, atau radius → tanpa kotak edit, "ubah di Ads Manager".
- Negara: kode ISO dua huruf, nama lewat `Intl.DisplayNames`. Umur 18–65. Batas lain (Advantage+
  audience, aturan per negara) ditolak Meta dan kalimatnya ditampilkan apa adanya.
- Konfirmasi menyebut bahwa perubahan besar pada targeting atau anggaran mengulang fase pembelajaran
  Meta.

## 4. Halaman `/campaigns`

- Baris sidebar sendiri, grup **Aset** sesudah Ad Accounts, label **Campaign**, ikon `Megaphone`,
  `key: "campaigns"` di `SUPERADMIN_PAGES`.
- **Panel Salinan** (hanya kalau ada job 7 hari terakhir): sumber → nama, akun, status berlencana
  (Berjalan biru, Selesai hijau, Sebagian kuning, Tidak diketahui kuning, Gagal merah) dengan sebab
  di bawah pil, "n dari m" salinan yang lahir, waktu, peminta; job selesai menaut ke baris barunya.
- **Tabel** dari `users/*/campaigns` (sudah dilanggan store):
  Kampanye (nama, akun, pemilik → profil) · Sub Domain (hanya baca + sumber pemetaan) · Status
  (saklar yang ada) · Anggaran (angka + CBO/ABO/lifetime) · Aksi (Duplikasi, Ubah). Baris dibuka ke
  panel ad set yang sama dengan profil, ditambah tombol Ubah per ad set.
- **Filter di alamat**, `replace`: `?q=`, `?pemilik=`, `?akun=`, `?subdomain=`, `?status=`,
  `?adset=`, plus paginasi.
- **Dipindah, bukan disalin**: `CampaignStatusCell` dan `normalizeCampaignRows` keluar dari
  `UserDetail.jsx`; `CampaignAdSets` mendapat prop untuk tombol Ubah. Profil tetap tanpa tombol edit.
  Tabelnya sendiri tidak dipakai bersama — kolomnya berbeda.
- **Server kontrol tidak terjangkau**: tabel dan panel Salinan tetap tergambar (RTDB); tombol
  Duplikasi/Ubah tidak digambar, diganti satu kalimat sebab — sepola `/plugin`.
- **Dialog** Duplikasi, Ubah campaign, Ubah ad set: tombol simpan terkunci selama permintaan
  berjalan; penolakan ditampilkan di dalam dialog, bukan toast.
- Token tema saja, tabel menggulir di `.table-wrap`.

## 5. Penanganan gagal

| Keadaan | Jawaban |
|---|---|
| Bukan superadmin | 403 |
| Campaign bukan milik profil / ad set bukan milik campaign | 404 |
| Job salinan kembar sedang berjalan | 409 |
| Aturan kita menolak (nama, lokasi bukan negara saja, >51 iklan, anggaran di tingkat salah) | 422, sebelum menyentuh Meta |
| Meta menolak isian | 422, kalimat Meta apa adanya |
| Izin token, Meta tumbang, jaringan | 502 (`explainWriteFailure` yang ada) |
| `META_ACCESS_TOKEN` kosong | 503 |

- Pembacaan status batch yang gagal tidak mengubah status job.
- Jejak aksi sudah tercatat Activity Logs lewat pengamat `controlApi`.

## 6. Tes

- `functions/campaign-manage-core.test.mjs`: keempat baris vonis nama; anggaran di tingkat salah dan
  satuannya; penggabungan targeting (field lain utuh; wilayah/kota ditolak); batas 3/4/51/52 iklan;
  transisi job termasuk batas `unknown` 10 dan 60 menit; pembuangan 7 hari.
- `functions/meta.test.mjs`: bentuk request tiap tulisan baru; salinan tidak diulang pada kode
  sementara; tulisan edit tetap diulang.
- `server/campaign-manage.test.mjs` (bun): 403 untuk admin biasa; job ditulis sebelum Meta dipanggil;
  409; pembuktian ad set; beberapa tulisan ke satu akun → satu sync; penjaga bersama dengan
  penyegaran status.
- `src/`: `campaigns` di `SUPERADMIN_PAGES` + aturan navigasi; `campaignCopyJobs` hanya dilanggan
  superadmin; `.validate` node job terbaca dari `database.rules.json`.
- **Dua pembuktian ke Meta produksi, masing-masing dikonfirmasi pemilik sebelum dijalankan**:
  1. Langkah pertama implementasi: bentuk `copies` di dalam `async_batch_requests` pada campaign
     kecil. Kalau ditolak, jalur asinkron didesain ulang sebelum kode lain bergantung padanya.
  2. Sebelum dianggap selesai: satu alur lengkap (salin → ubah anggaran/targeting → nyalakan →
     matikan) pada campaign kecil milik sendiri.

## 7. Deploy

`npm run deploy:rules` (node job) → server kontrol → hosting. `CLAUDE.md` mendapat bagian baru yang
merangkum aturan di atas, sepola bagian "Saklar on/off campaign".

## Lampiran: hasil pembuktian ke Meta produksi (11 Sep 2026)

Campaign sumber: `120257531552730339` "tbxW-01 Pros MEA Carrou LM 01 1 Adset", `act_3100918953544891`
(TBZ 1221), saklar PAUSED, 1 ad set, 1 iklan (iklan ACTIVE, efektif `CAMPAIGN_PAUSED`). Semua salinan
uji dihapus (`status=DELETED`) di akhir tiap uji. Header `facebook-api-version` menjawab `v26.0` untuk
permintaan `v25.0`.

| Uji | Permintaan | Jawaban |
|---|---|---|
| Batch, 1 item `copies` (query string) | `POST /act_…/async_batch_requests` | `(#194) param adbatch has too few elements` |
| Batch, 1 item `copies` (body form) | sama | `(#194)` sama |
| Batch, 1 item buat campaign (sengaja tidak sah) | sama | `(#194)` sama |
| Batch, 2 item `copies` ke campaign yang tidak ada | sama | `(#10) Application does not have permission for this action` |
| Batch, 2 item buat campaign (sengaja tidak sah) | sama | `(#10)` sama |
| Salin langsung, deep copy | `POST /{campaign}/copies` | 200: campaign + 1 ad set tersalin (`ad_object_ids` tanpa `ad`); targeting dan anggaran utuh; **0 iklan**, masih 0 setelah 60 detik |
| Salin iklan ke ad set salinan | `POST /{ad}/copies` `adset_id=…` | `(#10)` subkode `3858749` "Izin Halaman tidak ada" — `page_id 1057042520835849`, `required_permission: Ads` |
| Halaman milik System User | `GET /me/accounts` | kosong |

Keputusan: jalur asinkron dibuang; salin bertahap lewat panggilan langsung (bagian Revisi di atas).
Pembuktian salin bertahap dijalankan lagi sesudah izin Halaman diberikan.

## Lampiran: pembuktian salin bertahap sesudah izin Halaman (12 Sep 2026)

Izin Halaman sudah diberikan — `GET /me/accounts` menjawab **Sonet Media 01** (`1273663929164175`)
dengan task `ADVERTISE` dan `MANAGE`. Campaign sumber dipilih yang creative-nya memakai Halaman itu:
`120249830089850479` "Zvq2-02 Pros MEA Carrou SM 01 5 Adset" di `act_787769106149598` (BD - R42),
PAUSED, 5 ad set × 1 iklan. Salinannya dihapus (`status=DELETED`) di akhir.

| Uji | Permintaan | Jawaban |
|---|---|---|
| Salin campaign tanpa isi | `POST /{campaign}/copies` `deep_copy=false` | 200, campaign salinan lahir |
| Salin tiap ad set ke dalamnya | `POST /{ad_set}/copies` `deep_copy=true` | 200 × 5, **5 ad set lahir, 0 iklan** — `ad_object_ids` tanpa satu pun bertipe `ad`, masih 0 setelah 20 dan 40 detik |
| Salin satu iklan langsung | `POST /{ad}/copies` `adset_id=…` | `(#100-1885183)` "Postingan materi iklan dibuat oleh aplikasi yang dalam mode pengembangan. Ini harus bersifat publik untuk membuat iklan ini." |
| Buat ad creative dari NOL | `POST /act_…/adcreatives` | `(#100-1885183)` **sama persis** |

Keputusan: izin Halaman memang sudah benar — error `(#10-3858749)` hilang — tapi ada penghalang
KEDUA yang menutup iklan, dan ia bukan izin melainkan **app "New RabbitROI" (`1785524669295127`)
yang masih Development Mode**. Ia berlaku untuk creative yang disalin maupun yang dibuat dari nol,
jadi ia menutup tahap 1 dan tahap 2 dengan satu sebab yang sama. Yang membukanya App Mode → Live di
developers.facebook.com. Rinciannya, berikut langkah-langkah create yang SUDAH terbukti jalan, ada
di [desain tahap 2](2026-09-12-campaign-create-design.md).

## Lampiran: iklan salinan dibuatkan sendiri dari creative sumbernya (12 Sep 2026, sore)

Pertanyaannya: apakah iklan salinan bisa lahir TANPA menunggu App Mode → Live. Jawabannya ya untuk
langkah yang diblokir, dan ada satu penghalang lain di belakangnya.

Yang dijalankan (`act_3100918953544891`, campaign sumber `120257531552730339` "tbxW-01 Pros MEA
Carrou LM 01 1 Adset", 1 ad set × 1 iklan, creative `1067796465644750`). Campaign ujinya dihapus
(`status=DELETED`) di akhir.

| Langkah | Permintaan | Jawaban |
|---|---|---|
| Salin campaign tanpa isi | `POST /{campaign}/copies` `deep_copy=false` | 200 → `120257781302080339` |
| Salin ad set ke dalamnya | `POST /{ad_set}/copies` `deep_copy=true` | 200 → ad set `120257781303040339`, `is_dynamic_creative: true`, **`ad_object_ids` tanpa satu pun bertipe `ad`** |
| Iklan di salinan | `GET /{campaign}/ads` | `[]` — gejala yang dilaporkan orangnya |
| Buat iklan dari creative SUMBER | `POST /act_…/ads` `creative={"creative_id":"1067796465644750"}` | **`(#100-1885499)`** "Tidak Ada Izin Pengiklan pada Halaman — Pemirsa harus memiliki izin pengiklan pada halaman untuk membuat sebuah iklan" |
| Creative dari nol (pembanding) | `POST /act_…/adcreatives` (`creativePayload`) | `(#100-1885183)` — masih Development Mode |
| Creative dari postingan yang sudah ada | `POST /act_…/adcreatives` `object_story_id=…` | `(#100-1815017)` "Materi Dinamis Belum Diisi dengan ID Set Produk" — jalur ini tertutup untuk iklan dynamic creative |

**Kesimpulannya dua, dan keduanya menentukan.** Pertama: memakai ulang `creative_id` iklan sumber
**melewati Development Mode** — penolakannya berpindah, dari `(#100-1885183)` ke penolakan yang tidak
menyebut app sama sekali. Tidak ada creative baru yang lahir, jadi aturan "postingan materi iklan
dibuat aplikasi mode pengembangan" tidak punya pijakan. Itu yang dipakai `repairCopiedAds`.

Kedua: yang tersisa adalah **izin beriklan per HALAMAN**, dan hari ini System User
`rabbitroi-sync` (`122097619533420767`) memegang **satu** Halaman — Sonet Media 01
(`1273663929164175`, task `ADVERTISE`) — sementara iklan armada memakai **26 Halaman lain**
(`1182126288310126` 20 iklan, `1164714390047072` 20, `1309354248923784` 20, `1153691864493282` 20,
`1065782886624498` 16, … `565143956673607` 1; namanya sendiri tidak bisa dibaca token ini —
`(#10) pages_read_engagement`). Tidak satu pun iklan armada memakai Sonet Media 01, jadi tidak ada
satu campaign pun yang bisa dipakai membuktikan pemulihan ini sampai lahir — dan creative BARU di
Sonet pun tidak bisa dibuat karena App Mode.

**Yang harus dilakukan supaya duplikasi lengkap hari ini** (tanpa menunggu App Review): di Business
Manager, beri System User `rabbitroi-sync` akses **Iklan (Create ads)** pada Halaman yang dipakai
iklan campaign yang mau disalin. Satu Halaman cukup untuk campaign-campaign Halaman itu; sesudahnya
pemulihan ini melahirkan iklannya, dan panel Pekerjaan berbunyi `done` alih-alih `partial`.

### Pembuktian TUNTAS: salinan lahir lengkap, tanpa App Mode Live (12 Sep 2026)

Campaign armada yang iklannya memakai **Sonet Media 01** — satu-satunya Halaman yang dipegang System
User — memang ada, dan itu yang membuat pemulihan ini bisa diuji sampai iklannya lahir. Semua campaign
bernama "… Carrou SM 01 …" di `act_787769106149598` (BD - R42) memakai Halaman itu.

Dijalankan lewat `startCopyJob` + `runCopyJob` (modul yang sama dengan server, store di memori),
sumber `120249886291560479` "7jNm-01 Pros UCMQC Carrou SM 01 5 Adset" (5 ad set × 1 iklan, kelimanya
`page_id: 1273663929164175`). Salinan ujinya dihapus di akhir.

```
rencana: 5 ad set / 5 iklan
hasil  : state "done" — adSets 5/5, ads 5/5, error ""
iklan di salinan 120249899441470479:
  120249899443970479 ACTIVE adset=120249899442750479 cr=4361417324173894
  120249899448220479 ACTIVE adset=120249899447470479 cr=1721484735750508
  120249899446850479 ACTIVE adset=120249899446330479 cr=1503203965163031
  120249899442380479 ACTIVE adset=120249899441820479 cr=2043581256330413
  120249899445890479 ACTIVE adset=120249899444890479 cr=2083887012242879
```

Deep copy melahirkan **0** iklan (seperti sebelumnya); kelima iklan itu lahir dari `repairCopiedAds`,
masing-masing di ad set salinannya sendiri, dengan creative iklan sumbernya dan saklar `ACTIVE` yang
diwarisi — di dalam campaign yang tetap PAUSED, jadi tidak ada yang tayang sampai ada yang
menyalakannya. **Duplikasi campaign karena itu sudah lengkap hari ini untuk campaign ber-Halaman Sonet
Media 01, tanpa menunggu App Mode → Live.** Yang masih menunggu izin Halaman adalah campaign yang
iklannya memakai 26 Halaman lain (lampiran di atas), dan kalimat job-nya menyebut ID Halamannya
satu per satu.

Pembuktian pada campaign yang Halamannya belum diberi izin, lewat modul yang sama (sumber
`120257531552730339` di `act_3100918953544891`): `state: "partial"`, `adSets 1/1`, `ads 0/1`, dan
error-nya berbunyi — `tbxW-01 …: iklan "tbxW-01 …" tidak bisa dibuatkan ulang (Halaman
1057042520835849) — … (#100-1885499) — System User belum punya izin beriklan di Halaman iklan itu.
Buka Business Manager > Halaman > Halaman itu > Tambahkan orang, pilih System User "rabbitroi-sync",
lalu nyalakan akses Iklan (Create ads).` Salinan ujinya dihapus juga.
