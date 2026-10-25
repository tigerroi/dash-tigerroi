# Rasio Penayangan Ad Exchange per jam — desain

Tanggal: 24 Sep 2026. Status: disetujui dalam brainstorming, menunggu review spec.

## Tujuan

Mendeteksi penurunan fill-rate secepat GAM mengizinkan, per domain dan per subdomain, dan melihat
apakah naiknya volume permintaan iklan berjalan bersama turunnya rasio yang dipenuhi Google. Satu tab
berisi tiga grafik per jam: rasio, volume permintaan, dan gabungan keduanya (dua sumbu).

## Keputusan yang sudah diambil

| Pertanyaan | Jawaban |
|---|---|
| Sumber | GAM saja. AdSense API tidak punya dimensi `HOUR`. |
| Metrik | Pasangan Ad Exchange: `AD_EXCHANGE_TOTAL_REQUESTS` (Total permintaan Ad Exchange) dan `AD_EXCHANGE_IMPRESSIONS` (Tayangan Iklan Ad Exchange). Rasio = tayangan ÷ permintaan (Rasio penayangan Ad Exchange). |
| Agregasi domain | Σtayangan ÷ Σpermintaan, bukan rata-rata rasio. |
| Jam | WIB. |
| Penyimpanan | RTDB, ditarik tiap 10 menit, **tidak pernah dihapus**. |
| Bawaan halaman | Hari Ini (tanggal WIB); riwayat lewat pemilih periode. |
| Jam terakhir | Ditandai `partial`, digambar putus-putus/pucat. |
| Grafik gabungan | Satu grafik waktu dua sumbu, tanpa koefisien korelasi. |

## Bukti dari API produksi (24 Sep 2026, hanya membaca)

- `AD_REQUESTS` (Total panggilan iklan) **ditolak** bersama `HOUR`, termasuk `DATE + HOUR` saja
  (`400: An error has occurred`). `DATE + SITE` diterima. Jadi "Total rasio pengisian" di layar GAM
  tidak bisa diambil per jam.
- `AD_EXCHANGE_TOTAL_REQUESTS` dan `AD_EXCHANGE_IMPRESSIONS` diterima bersama `DATE, HOUR, SITE`.
  Diadu dengan layar Laporan interaktif stylefemale.com hari ini (Jam + Situs): lima baris dicek,
  kelimanya cocok sampai angka terakhir (mis. jam 4 brands.stylefemale.com 89.949 / 37.713 = 41,93%).
- Rasio AdX 0–2 poin di bawah "Total rasio pengisian" (stylefemale 22 Sep: 47,18% vs 49,12%), karena
  permintaan AdX dihitung sedikit lebih banyak; tayangannya sama persis di kedelapan network. Karena
  itu labelnya memakai **nama kolom Ad Exchange** dari layar GAM, bukan "Total rasio pengisian".
- Jeda GAM ±1 jam: pukul 13:00 WIB jam terakhir yang ada 11:00. **Jam terakhir selalu belum lengkap
  dan rasionya melonjak palsu** (permintaan tercatat lebih lambat dari tayangan): stylefemale jam 11
  68,9%, sheetz.us jam 9 94,8%. Itu alasan tanda `partial`.

## Bagian 1 — Data dan penarikan

### Penarikan

- Cron baru di server kontrol (`CRON_JOBS` di `server/index.js`), tiap **10 menit**, terpisah dari
  sync penuh: tidak menunggu tahap ROI/Meta, dan kegagalan tahap lain tidak menahannya.
- Satu laporan per network GAM: dimensi `DATE, HOUR, SITE`, dua metrik AdX, rentang **kemarin + hari
  ini** dalam satu laporan (jam-jam akhir kemarin tidak membeku setengah jadi).
- Network berzona bukan WIB dipetakan ke jam WIB. `rekeyToSyncDays` saat ini MENJUMLAHKAN jam ke
  hari WIB; di sini jamnya harus dipertahankan, jadi pemetaannya perlu varian yang menyimpan jam WIB
  (fungsi murni di `functions/gam.js`, memakai `hourInstant` yang sama).
- Akun yang dilewati sama dengan sync: `deletedAt`, tanpa `networkCode`. Satu network gagal tidak
  menghentikan yang lain; kegagalannya ditulis ke `dashboard/syncIssues/fillRate` (ikon topbar).
  Tidak ada antrean `syncRetries`: run berikutnya 10 menit lagi sudah menjadi retry-nya.

### Bentuk node

```
dashboard/fillRate/{YYYY-MM-DD}/{hostname}/h{HH} = { req, imp, partial? }
dashboard/fillRateStatus = { lastRunAt, networks: { {networkCode}: { ok, message?, lastHour? } } }
```

- Kunci situs = **hostname** dengan titik diganti koma (RTDB menolak titik). Bukan `subdomainId`:
  situs yang belum terdaftar tetap tercatat, dan subdomain yang didaftarkan belakangan langsung punya
  riwayat. Domain induk diturunkan saat digambar (`subDomainOwnerIndex`, pencocokan akhiran untuk yang
  belum terdaftar).
- Baris situs `(Not applicable)` disimpan di bawah kunci `_net_{networkCode}` supaya total domain sama
  dengan total network; ditempelkan ke domain lewat `gamAccounts.name`.
- Kunci jam berawalan huruf (`h00`…`h23`), bukan `00`…`23`: SDK Firebase membaca kunci berbentuk
  angka (nol di depan pun diterima) sebagai indeks, dan node jam yang hampir penuh dikembalikan
  sebagai ARRAY berlubang — alasan yang sama dengan `c57` di antrean gating. Status per network
  berkunci `n{networkCode}` untuk alasan yang sama.
- `req`/`imp` integer. Rasio tidak disimpan.
- Jam terakhir yang dilaporkan tiap network bertanda `partial: true`; run berikutnya menimpanya tanpa
  tanda begitu jam sesudahnya muncul.
- `lastRunAt` ditulis sebagai stempel WIB tanpa zona (`displayStamp`), sesuai aturan stempel sync.
- **Tidak ada pemangkasan.**

### Hanya yang berubah yang ditulis

Tiap run membaca dua hari terakhir node itu (`readFrom(kemarin)`, ±110 KB) lalu hanya menulis
daun yang berbeda (termasuk hilangnya `partial`), dalam satu `update()`. Bukan cache memori: yang
dibandingkan adalah isi RTDB yang sebenarnya, jadi restart atau tulisan dari CLI tidak membuatnya
salah hitung. Harganya ±16 MB unduhan per hari (< $0,02).
Tab terbuka hanya menerima delta beberapa jam terakhir tiap 10 menit.

### Aturan database

`dashboard` sudah `.read: auth != null` dan `.write` admin; penulisnya SYNC_USER (admin). Query
`orderByKey` tidak butuh indeks. **Tidak butuh `npm run deploy:rules`.**

## Bagian 2 — Halaman dan grafik

### Tempat dan izin

Tab Overview baru `/dashboard/rasio-penayangan`, label **Rasio Penayangan**, `key: "dashboard"`
(terbuka untuk semua akun yang login, sama dengan tab Overview lain).

### Pembacaan

Bukan `useStickyValue` utuh: `orderByKey().startAt(dari).endAt(sampai)` pada `dashboard/fillRate`,
dipasang ulang saat periode berganti, plus langganan kecil `dashboard/fillRateStatus`. Satu hari
armada ±55 KB.

### Filter (di alamat)

- `?periode=` lewat `useUrlRange`, bawaan Hari Ini (tanggal WIB). Rentang yang dikosongkan (`..`)
  TIDAK berarti seluruh node: ujung yang kosong dijepit (`to` = hari ini WIB, `from` = 31 hari
  sebelum `to`), karena node ini tidak pernah dipangkas dan "semua tanggal" tumbuh tanpa batas.
- `?advertiser=`, `?domain=`, `?subdomain=` lewat `OwnerFilterFields` yang sama dengan tab Grafik dan
  Kalender (aturan "domain mengosongkan subdomain" ikut).

### Tiga grafik (Recharts, warna lewat `useChartPalette`)

1. **Rasio penayangan Ad Exchange per jam**: satu garis per rincian (tanpa filter per domain, domain
   dipilih per subdomain, subdomain dipilih satu garis). Tiap garis Σimp ÷ Σreq.
2. **Total permintaan Ad Exchange per jam**: batang bertumpuk, rincian sama.
3. **Gabungan** seluruh pilihan: batang total permintaan (sumbu kiri) + garis rasio (sumbu kanan).

- Rincian dibatasi **8 teratas menurut permintaan**; sisanya satu seri "Lainnya" (tetap Σimp ÷ Σreq).
- Jam `partial` putus-putus dan pucat.
- Permintaan 0 → rasio `null` (garis terputus), sepola `getNetPercentage`.
- Rentang beberapa hari = sumbu jam bersambung, label `formatDayMonth` + jam.
- Tooltip: permintaan, tayangan, rasio.

### Tabel

`DataTable` di bawah grafik, satu baris per situs untuk periode terpilih: Situs, Total permintaan Ad
Exchange, Tayangan Iklan Ad Exchange, Rasio penayangan Ad Exchange. Situs yang belum terdaftar di
`/sub-domains` diberi tanda.

### Umur data

Kepala tab menyebut "Ditarik {jam} WIB · jam terakhir {HH}:00 (belum lengkap)" dari
`fillRateStatus`, berikut network yang gagal di run itu.

## Pengujian

- `functions/`: varian pemetaan jam WIB (Karachi/LA → jam WIB yang benar, melintasi tengah malam),
  penanda `partial` pada jam terakhir per network, penyusun `update()` yang hanya berisi daun berubah,
  encode/decode hostname.
- `src/lib/`: agregasi rincian (ΣB÷ΣA, 8 teratas + Lainnya, `null` untuk permintaan 0), pemetaan
  hostname → domain untuk situs belum terdaftar.
- `navigation.test.mjs` / katalog UI tetap lulus (tab baru, tidak ada `<table>` di luar `DataTable`).

## Di luar cakupan

- Garis pembanding jam yang sama kemarin/minggu lalu.
- Peringatan Telegram saat rasio turun.
- "Total rasio pengisian" (`AD_REQUESTS`) per hari sebagai pembanding.
- Menghentikan pemangkasan node lain (tugas terpisah, disepakati 24 Sep 2026).

## Deploy

Server kontrol (cron baru) dan hosting. Tidak butuh `deploy:rules`.
