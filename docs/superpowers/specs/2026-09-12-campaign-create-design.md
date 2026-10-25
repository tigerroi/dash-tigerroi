# Buat campaign baru dari halaman Campaign (tahap 2)

Tanggal: 12 Sep 2026 · Status: desain, dibangun di atas pembuktian ke Meta produksi hari itu juga

Tahap 2 dari [halaman Campaign](2026-09-11-campaign-fleet-design.md). Tahap 1 menyalin campaign yang
sudah ada; ia tidak bisa mengarahkan iklan ke subdomain LAIN, karena link creative tidak termasuk
field yang bisa diubah Meta. Satu-satunya jalan ke sana adalah iklan yang benar-benar baru, dan itu
isi dokumen ini.

**Di luar lingkup**: objective selain yang dipakai armada, video, katalog, jadwal mulai/selesai,
lifetime budget, bid cap, minat/perilaku, penempatan di luar bawaan armada, dan AI (tahap 3).

## Penghalang yang sudah diketahui: app Meta masih Development Mode

Dibuktikan ke API produksi 12 Sep 2026, langkah demi langkah di `act_787769106149598`:

| Langkah | Panggilan | Hasil |
|---|---|---|
| Unggah gambar | `POST /act_…/adimages` (multipart) | **OK** — `hash`, `url`, `url_128`; nama berkas ikut tersimpan |
| Buat campaign | `POST /act_…/campaigns` | **OK** (PAUSED) |
| Buat ad set | `POST /act_…/adsets` | **OK** (PAUSED, `is_dynamic_creative`, pixel) |
| **Buat ad creative** | `POST /act_…/adcreatives` | **GAGAL `(#100-1885183)`** "materi iklan dibuat oleh aplikasi dalam mode pengembangan" |
| Buat iklan | `POST /act_…/ads` | tidak sampai |

Semua yang lahir di uji itu dihapus (`status=DELETED`), termasuk kedua gambar ujinya.

- **Penghalangnya app, bukan izin Halaman.** Halaman Sonet Media 01 (`1273663929164175`) sudah
  dipegang System User sejak 12 Sep (`GET /me/accounts`: `ADVERTISE`, `MANAGE`) — dan error izin
  Halaman `(#10-3858749)` yang menutup tahap 1 pada 11 Sep memang sudah hilang. Yang menggantikannya
  `(#100-1885183)`, dan ia muncul untuk creative yang DIBUAT dari nol juga: satu-satunya app yang
  terlibat di sana app kita sendiri, "New RabbitROI" (`1785524669295127`).
- **Yang membukanya satu saklar di luar repo ini**: developers.facebook.com → app New RabbitROI →
  Settings → Basic (Privacy Policy URL + kategori) → App Mode **Development → Live**.
- **Ia menutup tahap 1 juga.** Iklan tidak pernah ikut tersalin (0 dari 5, dua kali diuji) karena
  salinan iklan juga melahirkan creative baru. Jadi satu saklar itu membuka keduanya sekaligus, dan
  tidak ada jalan lain: seluruh alasan fitur ini ada adalah membuat creative.
- **Yang tetap dibangun sekarang**: seluruh jalurnya, karena empat dari lima langkahnya sudah
  terbukti dan yang kelima cuma menunggu saklar. Yang TIDAK boleh adalah menyembunyikan
  keadaannya — `(#100-1885183)` diterjemahkan jadi kalimat yang menyebut App Mode berikut tempat
  mengubahnya (`explainWriteFailure`), bukan diteruskan sebagai pesan Meta yang menyuruh orang
  mencari "postingan materi iklan".

## Bentuk yang dibuat: pola armada, bukan Ads Manager kedua

Dibaca dari seluruh armada (12 Sep 2026: 196 campaign, 552 ad set, ~460 iklan di 15 ad account):

| Tingkat | Yang dipakai armada | Sebaran |
|---|---|---|
| Campaign | `OUTCOME_LEADS`, `AUCTION`, **CBO** `daily_budget`, `LOWEST_COST_WITHOUT_CAP`, `special_ad_categories: []` | 187 dari 196 (sisanya `OUTCOME_TRAFFIC`) |
| Ad set | `OFFSITE_CONVERSIONS` + `IMPRESSIONS` + `promoted_object {pixel_id, CONTENT_VIEW}`, `is_dynamic_creative: true` | 491 dari 552 |
| Iklan | `asset_feed_spec` **CAROUSEL_IMAGE, 3 gambar**, 1 judul, 1 body, 1 CTA, `link_urls` = alias Keitaro, `url_tags: "bit=[race]"`, `object_story_spec: { page_id }` | 416 dari ~460 |

Dan bentuk campaign-nya: **N ad set bertargeting IDENTIK, masing-masing berisi SATU iklan yang
bedanya cuma judul + body.** "5 Adset"/"10 Adset" di nama campaign adalah uji variasi teks, bukan
variasi negara — kelima ad set `tbxW-01 Pros MEA Carrou SM 01 5 Adset` menargetkan sebelas negara
yang sama persis dan beriklan dengan tiga gambar yang sama persis.

- **Form-nya karena itu tidak menawarkan objective, optimization goal, billing event, maupun bid
  strategy.** Tiap kombinasi lain menuntut field lain yang menyusul di belakangnya (`promoted_object`
  berbentuk lain, `destination_type`, `bid_amount`), dan form yang menawarkan semua objective Meta
  adalah Ads Manager kedua yang setengah jadi — dengan penolakan Meta sebagai satu-satunya
  keterangan. Yang dipilih orang hanya yang benar-benar berbeda antar-campaign: akun, tujuan,
  anggaran, negara, umur, gambar, CTA, dan teksnya.
- **Yang MENYIMPANG dari kebiasaan armada, satu dan disengaja: nama ad set diberi akhiran ` #n`.**
  Armada menamai kelima ad set persis sama dengan campaign-nya; di panel ad set kita, lima baris
  bernama sama tidak bisa dibedakan satu sama lain — dan panel itu justru dibuka orang untuk mencari
  ad set MANA yang membakar anggaran. Nama iklan mengikuti nama ad set-nya.

## Alur dan aturan

### Yang tidak pernah dipercaya dari request

Sepola `campaignRowOf` di tahap 1 dan `pluginHostname` di `/plugin`:

| Nilai | Datang dari | Kalau dipercaya dari request |
|---|---|---|
| `act_…` | `adAccounts/{accountId}.actId` di RTDB | endpoint ini jadi pembuat campaign di ad account mana pun di Business Manager |
| Link iklan | `subDomains/{id}.campaignUrl`, dipilih menurut kodenya | belanjanya tercatat di subdomain yang salah, dan tidak ada apa pun yang mengabarkannya |
| `page_id` | harus ada di `GET /me/accounts` | iklan lahir dari Halaman yang System User tidak pegang — gagal dengan pesan izin yang menyesatkan |
| `pixel_id` | harus ada di `GET /act_…/adspixels` akun itu | konversi tercatat di pixel orang lain |

Hash gambar TIDAK diperiksa ulang: Meta sendiri menolak hash yang bukan milik akun itu, dan
memeriksanya berarti mengunduh seluruh pustaka (80 gambar di satu akun) untuk pemeriksaan yang sudah
dilakukan di ujung sana.

### Nama campaign

- **Kodenya wajib kode subdomain tujuan** (`createNameVerdict`, memakai `matchCode` yang SAMA dengan
  sync). Berbeda dari `campaignNameVerdict` tahap 1, yang menanyakan konfirmasi kalau namanya
  memetakan ke subdomain yang belum terlihat: di sini LINK-nya kita yang tentukan, jadi nama yang
  membawa kode lain pasti salah — bukan keadaan yang perlu dikonfirmasi.
- **Harus unik di ad account itu** (`assertNamesFree` yang sudah ada, berikut nama job yang masih
  berjalan): sync melebur campaign per nama, dan dua campaign bernama sama jadi satu baris tabel.

### Job di latar

Node `dashboard/campaignCreateJobs/{jobId}`, ditulis server, dilanggan superadmin saja:

```
accountId, actId        akun tempat campaign lahir
name                    nama campaign
subDomain, code, link   tujuan iklannya
pageId, pixelId
variants                [{ title, body }]   1..10
images                  [hash]              2..10
state                   requested | running | done | partial | failed | unknown
campaignId              begitu lahir
adSets/{i}              { name, adSetId, adId, error }
progress                { done, total }
error, requestedBy, requestedAt, updatedAt, finishedAt
```

- **Sama sekali bukan node baru dalam hal aturannya**: `stalledJobPatch`, `expiredCopyJobIds`, dan
  `newCopyJobId` dipakai apa adanya — yang membedakan job salin dan job buat cuma ISInya, tidak ada
  satu pun aturan menggantung/kedaluwarsa yang ditulis dua kali. Node-nya sendiri terpisah karena
  bentuk barisnya memang berbeda, dan `.validate` yang menuntut `sourceCampaignId` tidak bisa
  menampung keduanya tanpa berhenti menuntut apa pun.
- **Ditulis `requested` sebelum Meta disentuh**, dijalankan di latar sesudah route menjawab, progres
  ditulis tiap ad set — persis kontrak `runCopyJob`, dan karena alasan yang sama: satu campaign 10
  variasi berarti 21 panggilan, dan permintaan HTTP yang menggantung selama itu tidak berguna bagi
  siapa pun.
- **Tidak ada percobaan ulang** (`retry: false`): campaign yang terlanjur lahir tidak bisa ditarik
  kembali, dan kode 1/2 bisa datang sesudah Meta membuatnya.
- **Yang lahir sebagian tetap `partial` berikut sebabnya**, bukan dihapus otomatis. Membersihkan
  sendiri berarti menghapus objek Meta atas keputusan yang tidak diminta siapa pun; yang sudah lahir
  disebutkan ID-nya supaya bisa dibereskan orang di Ads Manager atau lewat tombol Ubah.
- **Ad set yang gagal tidak menghentikan sisanya** (satu variasi ditolak karena teksnya, yang lain
  tidak), TAPI campaign yang gagal menghentikan seluruhnya — tidak ada tempat bagi ad set untuk
  lahir.
- Selesai (apa pun hasilnya, asal campaign-nya lahir) → ad account masuk **antrean sync**, supaya
  barisnya muncul di tabel tanpa menunggu sync per jam.

### Route (semua `requireSuperAdmin`, prefix `/fleet`)

| Method + path | Body/query | Guna |
|---|---|---|
| `GET /fleet/accounts/:accountId/assets` | — | pixel, Halaman, dan pustaka gambar akun itu, untuk mengisi form |
| `POST /fleet/accounts/:accountId/images` | multipart `file` | unggah satu gambar → `{ hash, name, url }` |
| `POST /fleet/campaigns` | lihat node job | buat campaign + N ad set + N iklan |

- **Unggah lewat multipart, bukan `bytes=` base64.** Keduanya diterima Meta, tapi `bytes=` membuat
  seluruh pustaka berisi gambar bernama "bytes" — nama field-lah yang jadi nama berkasnya di sana
  (dibuktikan 12 Sep), dan pustaka yang setiap barisnya bernama sama tidak bisa dipilih orang.
  Batas 8 MB diperiksa di server berikut sebabnya; **nginx di depannya perlu
  `client_max_body_size 8m`** untuk route ini — bawaannya 1 MB, dan yang ditolak di sana menjawab
  HTML 413 yang tidak menyebut apa pun tentang gambar.
- `GET .../assets` menjawab tiga daftar sekaligus karena ketiganya dibutuhkan dialog yang sama pada
  detik yang sama; tiga route berarti tiga keadaan gagal untuk satu dialog.

### Dialog

Satu dialog bertahap di `/campaigns` (tombol **Buat campaign** di kepala halaman):

1. **Tujuan** — ad account, subdomain + kode (link-nya digambar apa adanya), nama campaign,
   anggaran harian.
2. **Target** — negara, umur.
3. **Kreatif** — Halaman, pixel, gambar (unggah ATAU pilih dari pustaka akun itu), CTA, lalu 1–10
   baris judul + body.
4. **Tinjau** — daftar yang akan lahir (1 campaign, N ad set, N iklan), semuanya PAUSED.

- **Semua lahir PAUSED**, dan itu bukan setelan: campaign yang lahir menyala dari sebuah form berarti
  uang keluar sebelum ada yang melihat hasilnya di layar. Dinyalakan lewat saklar yang sudah ada di
  tabel.
- Penolakan ditampilkan DI DALAM dialog, bukan toast — sepola dialog salin/ubah.
- Panel **Salinan** jadi panel **Pekerjaan**: dua jenis job dalam satu daftar berkolom Jenis. Dua
  panel terpisah berarti dua tempat yang harus dilihat orang untuk tahu apa yang sedang berjalan.

## Penanganan gagal

| Keadaan | Jawaban |
|---|---|
| Bukan superadmin | 403 |
| Ad account tidak ada di `/ad-accounts`, atau sync-nya dimatikan | 404 / 422 |
| Aturan kita menolak (nama, kode, jumlah gambar/variasi, anggaran) | 422, sebelum menyentuh Meta |
| Halaman/pixel bukan milik kita | 422 |
| App masih Development Mode `(#100-1885183)` | 422 berikut kalimat yang menyebut App Mode |
| Meta menolak isian lain | 422, kalimat Meta apa adanya |
| Token, Meta tumbang, jaringan | 502 |
| `META_ACCESS_TOKEN` kosong | 503 |

## Tes

- `functions/campaign-create-core.test.mjs`: vonis nama (kode cocok/tidak/tidak terdaftar); batas
  gambar dan variasi; anggaran; susunan payload campaign/ad set/creative (termasuk `url_tags` yang
  dipisah dari link, dan `page_id` yang tidak boleh ikut ke `asset_feed_spec`); bentuk + transisi job;
  `partial` saat sebagian ad set gagal.
- `functions/meta.test.mjs`: bentuk request tiap tulisan baru; unggah multipart; `retry: false` pada
  pembuatan; terjemahan `(#100-1885183)`.
- `server/campaign-create.test.mjs` (bun): 403 admin biasa; job ditulis sebelum Meta dipanggil;
  actId/link/page/pixel tidak dipercaya dari request; 409 job kembar; batas ukuran unggah.
- `src/`: node job hanya dilanggan superadmin; `.validate`-nya terbaca dari `database.rules.json`.
- **Pembuktian produksi** sesudah app Live: satu campaign 1 variasi di akun uji → periksa di Ads
  Manager → hapus. Sebelum itu, jalurnya berhenti di langkah creative dengan kalimat App Mode, dan
  itu yang harus terlihat di panel Pekerjaan.

## Deploy

`npm run deploy:rules` (node job baru) → nginx (`client_max_body_size`) → server kontrol → hosting.

## Lampiran: pembuktian payload kode ini ke Meta produksi (12 Sep 2026)

Dijalankan lewat `functions/tools/meta-create-probe.mjs`, yang memakai `campaign-create-core.js` dan
`meta.js` yang SAMA dengan server — bukan parameter yang ditulis tangan. Akun `act_787769106149598`
(BD - R42), pixel `1810179687086885`, Halaman Sonet Media 01. Campaign uji dihapus (`status=DELETED`).

| Langkah | Payload dari | Jawaban |
|---|---|---|
| Campaign | `campaignPayload` (OUTCOME_LEADS, AUCTION, CBO 20.000, LOWEST_COST_WITHOUT_CAP, PAUSED) | **OK** `120249899094010479` |
| Ad set | `adSetPayload` (OFFSITE_CONVERSIONS, IMPRESSIONS, pixel CONTENT_VIEW, `is_dynamic_creative`, targeting negara+umur+penempatan armada, PAUSED) | **OK** `120249899094150479` |
| Creative | `creativePayload` (asset_feed_spec CAROUSEL_IMAGE 2 gambar, `url_tags` terpisah) | **GAGAL `(#100-1885183)`** — App Mode |
| Iklan | `adPayload` | tidak sampai |

Jadi dua payload yang paling banyak fieldnya sudah diterima Meta apa adanya, dan yang tersisa cuma
saklar App Mode. Kalimat penolakannya sudah muncul dalam bentuk yang sudah diterjemahkan
(`explainWriteFailure`): "app Meta pemegang token ini masih Development Mode … Nyalakan App Mode:
Live di developers.facebook.com".

**Yang belum terbukti dan harus diuji sesudah app Live**: `POST /act_…/adcreatives` dengan
`asset_feed_spec` + `object_story_spec`, `POST /act_…/ads`, dan satu alur penuh dari dialognya
(pilih akun → subdomain → unggah gambar → dua variasi → Buat) berikut panel Pekerjaan yang
melaporkannya `done`.

## Lampiran C: App Mode diperiksa lagi, dan link/parameter dipisah (12 Sep 2026, sore)

`POST /act_787769106149598/adcreatives` dengan `creativePayload` yang sama dijalankan ulang: masih
`(#100-1885183)`, `error_user_title` "Postingan materi iklan dibuat oleh aplikasi yang terdapat di
mode pengembangan". Jadi app **New RabbitROI** (`1785524669295127`, token SYSTEM_USER, scope
`ads_management`/`pages_manage_ads`/`business_management` lengkap) **belum** Live, dan campaign yang
dibuat dari nol tetap berhenti di langkah creative. Tidak ada satu pun jalur pengganti untuk langkah
itu: creative dari postingan yang sudah ada ditolak `(#100-1815017)` karena iklannya dynamic creative
(lihat lampiran di [desain tahap 1](2026-09-11-campaign-fleet-design.md)), dan creative memang harus
lahir sebelum iklannya ada.

Yang berubah di tahap 2 karena itu bukan jalur Meta-nya melainkan formnya:

- **Link iklan dan parameternya jadi dua kotak.** Alamatnya readOnly dari Campaign URL baris
  subdomain; parameternya (`url_tags`) diisi dari link yang sama dan bisa diketik. `assertLinkOfSubDomain`
  sekarang mengadu sisi sebelum `?` saja dan mengembalikan alamatnya; `parseUrlTags` memeriksa
  bentuknya (`kunci=nilai` dipisah `&`, "?" di depan dibuang, link penuh ditolak `memuat alamat`);
  `joinLink` menyatukannya kembali untuk baris job. Node `campaignCreateJobs` TIDAK berubah — yang
  tersimpan tetap satu field `link` berisi link efektifnya, jadi tidak ada `deploy:rules` untuk ini.
- **Bug: tiap ad account yang dipilih menjawab 404.** `createAccountOptions`/`createSubDomainOptions`
  membaca `store.adAccounts`/`store.subDomains` dengan `Object.entries`, padahal keduanya ARRAY
  ber-`id` — yang terkirim ke server adalah nomor urut baris ("0", "1"), dan `adAccounts/0` tidak ada.
  `rowsOf` menerima kedua bentuk dan selalu memakai `id` barisnya.

## Lampiran D: jadwal mulai tayang, dibuktikan ke produksi (12 Sep 2026, sore)

Pertanyaannya: di mana `start_time` boleh ditulis, dan apa yang terjadi pada waktu lampau. Dijalankan
di `act_787769106149598` lewat `campaignPayload`/`adSetPayload` yang sama dengan server; tiap campaign
uji dihapus (`status=DELETED`) di akhir.

| Uji | Permintaan | Jawaban |
|---|---|---|
| `start_time` di campaign | `POST /act_…/campaigns` + `start_time=2026-09-20T01:59+07:00` | **200, lalu DIABAIKAN** — dibaca ulang `start_time` = `2026-09-12T15:39:09+0700` (jam pembuatan) |
| `start_time` di ad set | `POST /act_…/adsets` + `start_time=2026-09-20T01:59+07:00` | 200, tersimpan **persis** |
| `start_time` LAMPAU di ad set | `…start_time=2026-09-01T01:59+07:00` | **200, DIJEPIT ke jam sekarang** — tanpa satu pun error |
| Dari mana campaign mengambil jadwalnya | campaign tanpa `start_time`, dua ad set (20 dan 25 Sep) | campaign dibaca ulang **`2026-09-20T01:59+0700`** — ad set paling awal |
| Jalur kode sungguhan | `createPlan({ startTime })` → `adSetPayload` ×2 | campaign `2026-09-20T01:59+0700`, kedua ad set sama |

Keputusan yang lahir darinya: jadwal dikirim **hanya ke ad set**; `campaignPayload` sengaja tidak
membawanya (nilai yang diterima lalu diabaikan adalah field yang tampak bekerja); waktu lampau
**ditolak di `parseStartTime`** karena Meta tidak menolaknya; dan kolom Status di tabel armada tidak
butuh field baru — Meta sendiri yang menurunkan `start_time` campaign, dan `campaignStatusLabel` sudah
membacanya jadi "Terjadwal".

Zona ditulis eksplisit `+07:00`: kelima belas ad account armada berzona **Asia/Jakarta**
(`timezone_name`, diperiksa run yang sama), sama dengan zona operasi dashboard — tapi `datetime-local`
di browser tidak membawa zona sama sekali.

**Jumlah ad set** tidak jadi angka tersendiri: kelima iklan campaign "5 Adset"
(`120249886291560479`) berjudul dan berbody BERBEDA — "Watch Anytime, Anywhere", "Watch Movies in HD",
"Start Streaming Today", "Discover, Watch, Repeat", "HD Quality, Every Time" — jadi satu variasi = satu
ad set tetap berlaku, dan kotak angkanya cuma menyetel panjang daftar variasinya.

## Lampiran E: App Mode Live — alur buat campaign terbukti UTUH (12 Sep 2026, malam)

Saklar App Mode digeser ke Live sesudah Privacy Policy URL diisi
(`https://rabbitroi-89973.web.app/privacy.html`, sumbernya `public/privacy.html` di repo ini) dan
kategori app dipilih. Keduanya SYARAT, bukan saklarnya — sesudah kedua field itu terisi, creative
masih ditolak `(#100-1885183)` sampai toggle di kepala dashboard app benar-benar digeser.

Satu job penuh dijalankan lewat `startCreateJob` + `runCreateJob` (modul yang sama dengan server,
store di memori), `act_787769106149598`, Halaman Sonet Media 01. Campaign ujinya dihapus di akhir.

```
rencana: 2 ad set, jadwal 2026-09-15T01:59:00+07:00, gambar per iklan 2/2
hasil job: done
  #1: adset=120249901638960479  creative=1397117125112626  iklan=120249901642520479
  #2: adset=120249901644030479  creative=2512727105884581  iklan=120249901646960479
dibaca ulang: PAUSED  daily_budget=20000  start_time=2026-09-15T01:59:00+0700
  iklan …6960  judul ["Iklan B"]  2 gambar
  iklan …2520  judul ["Iklan A"]  2 gambar
```

Yang sekaligus terbukti di satu run: campaign CBO + PAUSED, ad set dynamic creative ber-pixel,
**jadwal** yang naik sendiri ke campaign, **gambar milik tiap iklan** (dua carousel berbeda), nama
ad set berakhiran ` #n`, dan langkah creative + iklan yang selama ini tidak pernah lolos.

Sebelum saklar itu, SETIAP bentuk creative ditolak sama persis — bukan cuma pola armada:

| Bentuk | Jawaban |
|---|---|
| `asset_feed_spec` CAROUSEL_IMAGE (pola armada) | `(#100-1885183)` |
| `object_story_spec.link_data` (link ad biasa) | `(#100-1885183)` |
| `object_story_spec.link_data.child_attachments` (carousel biasa) | `(#100-1885183)` |

**Yang TIDAK ikut terbuka**: izin beriklan per Halaman. Iklan armada memakai 26 Halaman yang belum
diberikan ke System User, dan salinan campaign ber-Halaman itu tetap `(#100-1885499)` — App Mode dan
izin Halaman dua hal yang berbeda, dan kalimatnya di `explainWriteFailure` memang menyuruh ke dua
tempat yang berbeda.
