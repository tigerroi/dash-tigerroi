# Konvensi RabbitROI Dashboard

Aturan yang berlaku lintas halaman. Semuanya sudah punya satu tempat tinggal — pakai tempat itu,
jangan menulis salinannya di komponen.

## Tanggal: "09 Agu 2026", selalu

Satu format untuk seluruh dashboard, lewat [`src/lib/formatDate.js`](src/lib/formatDate.js):

| Fungsi | Hasil | Dipakai untuk |
|---|---|---|
| `formatDate(v)` | `09 Agu 2026` | semua tanggal |
| `formatDateTime(v)` | `09 Agu 2026, 14:32` | stempel waktu yang jamnya berarti (log sync, snapshot saldo) |
| `formatMonth(v)` | `Agu 2026` | kunci bulan `2026-08` (Targets, kolom Bulan) |
| `formatDayMonth(v)` | `09 Agu` | sumbu grafik yang sempit |

- **Jangan** pakai `toLocaleDateString`/`toLocaleString`, dan jangan menulis `dd/mm/yyyy` sendiri.
  Nama bulan dipilih karena `08/09/2026` tidak bisa dibedakan dari bulan tanpa tahu halaman mana
  yang sedang dibaca.
- **Simpan tanggal mentah (ISO `YYYY-MM-DD`), format hanya saat dirender.** Baris yang tanggalnya
  sudah diformat akan diurutkan sebagai teks — "01 Sep" jatuh sebelum "09 Agu" — dan filter periode
  di `src/lib/dateRange.js` membaca bentuk ISO.
- `renderCell` memformat sendiri nilai yang berbentuk tanggal, jadi **kolom tabel baru ikut format
  ini tanpa perlu didaftarkan** di mana pun.
- **Stempel waktu yang ditulis sisi sync TANPA menyebut zonanya wajib sudah dalam WIB**
  (`displayStamp` di [`functions/sync-core.js`](functions/sync-core.js), dari `zonedDateKey` +
  `zonedClock`). `formatDateTime` hanya menerjemahkan stempel yang membawa zonanya sendiri (`…Z`
  atau `+07:00`); yang tidak membawanya digambar apa adanya, jadi jam UTC yang tersimpan muncul di
  layar sebagai jam WIB — tujuh jam lebih awal, tanpa satu pun tanda. Kolom "Waktu Sync" di panel
  Riwayat Snapshot Saldo berbunyi "09:05" untuk sync pukul 16:05, dan snapshot pagi berdiri di
  tanggal kemarin. **Menambahkan "Z" bukan gantinya**: kolomnya lalu mengikuti jam PERANGKAT
  pembacanya, dan dua orang di dua zona menyebut jam berbeda untuk satu run yang sama — yang
  dicatat baris itu adalah jam OPERASI. Baris lama tetap membawa jam UTC-nya dan tidak bisa
  dibedakan dari yang baru; keduanya berbaur sampai riwayatnya habis sendiri.

## Komponen UI: cari di katalog dulu, baru menulis

**Sebelum membuat komponen UI apa pun, baca [`src/components/ui/README.md`](src/components/ui/README.md)**
— tabel "butuh apa → pakai apa → jangan apa". Rupa yang sedikit berbeda diselesaikan lewat prop atau
`className`, bukan komponen kedua.

- **Kembaran lahir karena komponennya tidak DITEMUKAN, bukan karena strukturnya.** Audit 17 Sep 2026
  menemukan 17 dialog yang menulis portal + backdrop + Escape sendiri — sementara `DialogShell` sudah
  ada, terkubur di `campaigns/`. Salinannya sudah mulai berbeda: tiga dialog tidak bisa ditutup lewat
  Escape, dan dua kelas kepala dialog berbeda untuk rupa yang sama. Begitu juga dua `Field` bernama
  sama dengan arti berbeda, tiga tombol salin, lima tombol Segarkan dengan tiga bunyi, dan tab Settings
  yang menulis `role="tablist"` sendiri.
- **Yang menegakkannya tes, bukan dokumen ini** ([`catalog.test.mjs`](src/components/ui/catalog.test.mjs)):
  berkas di `ui/` yang tidak tercantum di katalog gagal, dan pola yang punya pemilik (`createPortal`,
  `.modal-backdrop`, Escape, `<table>`, `<select>`, `react-select`, `navigator.clipboard`,
  `role="tablist"`, `empty-panel-message`, label "Segarkan") yang muncul di luar pemiliknya gagal —
  pesan gagalnya menyebut penggantinya. Pola baru yang sudah punya komponen ikut didaftarkan di sana.
- **Komponen yang dipakai SATU fitur tinggal di folder fiturnya**; begitu fitur kedua butuh, ia pindah
  ke `ui/` dan masuk katalog pada commit yang sama.

## Tabel: satu komponen, di atas TanStack Table

Tabel data digambar lewat [`DataTable`](src/components/ui/DataTable.jsx), yang dibangun di atas
`@tanstack/react-table` (headless). **Tabel baru tidak menulis `<table>` sendiri**; yang masih
begitu adalah sisa sebelum komponen ini dan dipindahkan bertahap.

- **Headless, dan itu syaratnya.** Markupnya tetap `.data-table` di styles.css, jadi tema gelap dan
  `styles.theme.test.mjs` tidak tahu library-nya ada. Grid yang membawa CSS sendiri (MUI, AG Grid)
  membawa hex sendiri juga.
- **Kolom boleh `[key, label]` atau definisi kolom TanStack**, bercampur dalam satu daftar
  (`normalizeColumns` di [`src/lib/dataTable.js`](src/lib/dataTable.js)). Yang pertama digambar
  `renderCell(value, key)`; yang kedua membawa `cell`, `footer`, `columns` (kepala berkelompok), dan
  `meta`: `align`, `hint` (`ColumnHint`), `headerClassName`, `className`, `sortValue`.
- **Urutan dan paging TIDAK diserahkan ke TanStack.** Urutannya `sortTableItems` (sel kosong selalu
  di bawah, "Rp 1.200.000" dibaca sebagai angka), pagingnya `useTablePagination`. Pengurut kedua
  milik library akan berselisih dengan yang pertama tepat di kolom yang paling sering diklik.
- **Keadaan yang harus tinggal di alamat dipegang pemanggil**: `sort`/`onSortChange`,
  `expanded`/`onExpandedChange` (baris yang dibuka, mis. `?adset=`), `rowSelection`.
- **`cell`/`header`/`footer` DIPANGGIL sebagai fungsi, bukan lewat `flexRender`**, dan karena itu
  **fungsi `cell` tidak boleh memanggil hook**. `flexRender` menjadikan fungsinya tipe komponen, dan
  kolom yang ditulis inline adalah fungsi baru tiap render: seluruh isi sel dipasang ulang — secret
  OTP tertutup lagi tiap detak, pemilih subdomain kehilangan menunya. Keadaan milik sel ditaruh di
  komponen bernama yang dikembalikan `cell` (`<OtpSecret>`, `<SiteActions>`).
- **Tidak ada `<table>` di luar `DataTable.jsx`** (17 Sep 2026). Varian rupa lewat `baseClassName`
  (`.master-roi-table`), bukan komponen kedua.
- **Kolom tanpa `cell` ditandai `meta.ownCell: false` SEBELUM TanStack menggabungkannya** dengan
  `defaultColumn`: sesudah itu `columnDef.cell` selalu terisi, dan kolom yang tidak membawa `cell`
  diam-diam kehilangan `renderCell` — "1200000" alih-alih "Rp 1.200.000".

## Pencarian dan filter tinggal di ALAMAT, bukan di `useState`

Tiap kotak pencarian, dropdown filter, pemilih periode, dan tab menulis dirinya ke query lewat
[`src/hooks/useUrlState.js`](src/hooks/useUrlState.js) — dipakai persis seperti `useState`:

| Hook | Untuk | Bentuk di alamat |
|---|---|---|
| `useUrlState(key, fallback)` | teks, pilihan dropdown, tab, baris yang sedang dibuka | `?q=masse` |
| `useUrlRange(key, fallback)` | rentang tanggal `{from,to}` | `?tanggal=2026-08-01..2026-08-19` |
| `useUrlRecord(prefix, fields)` | peta filter ResourceList yang jumlahnya dari konfigurasi | `?f_status=Aktif` |

Alasannya: keadaan yang tidak ada di alamat tidak bisa dikembalikan. Admin yang mencari "masse" di
`/plugin` lalu membuka satu situs kehilangan pencariannya begitu ia menekan Back atau "Semua situs"
— komponen daftarnya dibuang beserta `useState`-nya, dan yang kembali adalah seluruh armada.

- **Nilai yang sama dengan `fallback` TIDAK ditulis.** Alamat halaman yang belum disaring tetap
  bersih, dan "kembali ke bawaan" berarti tidak menyebut apa-apa. Karena itu rentang tanggal jadi
  satu parameter (`from..to`) dan bukan dua: `..` (dikosongkan orang, "semua tanggal") harus bisa
  dibedakan dari parameter yang tidak ada (bawaan halaman, mis. bulan berjalan di Expenses).
- **`replace`, kecuali yang benar-benar membuka sesuatu.** Mengetik di kotak pencarian dengan
  `push` menulis satu entri riwayat per huruf, dan Back berubah jadi tombol hapus-satu-huruf. Yang
  memakai `{ history: "push" }` cuma yang menggeser halaman ke isi lain — `?situs=` di `/plugin` —
  karena itulah yang membuat Back mengembalikan orang ke daftar yang masih tersaring. Tombol
  "Semua situs" menutupnya dengan `{ history: "replace" }`, supaya buka-tutup satu situs tidak
  menumpuk riwayat.
- **Satu halaman, satu nama parameter per filter.** Dua filter dengan nama sama saling menyaring:
  di `/users/{uid}` filter Kode di Manajemen Kampanye adalah `kode`, dan yang di Riwayat Spend
  `riwayatKode`.
- **Perpindahan halaman tidak membawa query halaman sebelumnya.** `?q=masse` milik `/plugin` tidak
  berarti apa-apa di `/users`; yang menyimpan daftar tersaring itu riwayat browser, bukan alamat
  berikutnya.
- **Satu penyimpan alamat untuk path DAN query**
  ([`src/lib/browserLocation.js`](src/lib/browserLocation.js)). `useRouter` dulu menyimpan pathname
  di `useState`-nya sendiri; dengan filter yang tinggal di query alamat yang sama, dua penyimpan
  yang tidak saling mengabari berarti salah satunya selalu basi — alamat kembali ke `?q=masse`
  setelah Back, tabelnya tidak. `pushState`/`replaceState` tidak membangkitkan `popstate`, jadi yang
  mengabari pelanggan adalah `navigateTo` sendiri.

## Langganan berat: yang dibaca SATU halaman tidak tinggal di node yang dilanggan semua

Izin baca RTDB menurun, dan `onValue` mengunduh satu node UTUH. Jadi sebuah cabang riwayat yang
menumpang node yang dilanggan tiap muat halaman akan diunduh oleh setiap orang yang membuka halaman
apa pun — termasuk yang tidak punya satu layar pun yang membacanya. Itu bukan soal kerapian: RTDB
menagih download $1/GB, dan yang paling mahal di database ini tidak pernah dilihat siapa pun.

- **Riwayat panel Profile User tinggal di `userReports/{id}`, bukan di bawah `users/{id}`** —
  `campaignHistory`, `countryRoi`, `dailySpend`, `balanceSnapshots`. `users` memberi nama, PIC, dan
  baris campaign ke hampir tiap layar sehingga ia dilanggan setiap akun pada setiap muat halaman;
  keempat riwayat itu 2,81 MB dari 3,12 MB node tersebut (8 Sep 2026), dan yang membacanya cuma dua
  layar. Yang tidak terlihat di angka muat halaman: `countryRoi` DITULIS ULANG UTUH tiap sync, jadi
  selama ia tinggal di `users` tiap tab yang dibiarkan terbuka menerima 745 KB delta per jam untuk
  panel yang tidak sedang digambar. `campaigns` dan `campaignCommands` TIDAK ikut pindah: yang
  pertama dibaca tabel Overview, yang kedua ditulis dari halaman mana saja.
- **PEMBACANYA DUA, DAN YANG KEDUA MUDAH TERLEWAT.** Selain panel di `/users/{id}`, `countryRoi`
  mengisi rincian negara tiap baris tabel "Laporan ROI Realtime" — dan `buildCountryBreakdown`
  menyisir countryRoi SELURUH user, bukan cuma yang sedang dibuka. Sebuah cabang riwayat yang
  dipindahkan tanpa mendaftar pembaca keduanya menghasilkan kolom yang kosong tanpa satu pun pesan.
- **Aturan "yang baru menang, yang lama jadi cadangan" ditulis SEKALI**
  ([`src/lib/userReports.js`](src/lib/userReports.js)), justru karena pembacanya dua. Yang diperiksa
  `undefined`, bukan kebenaran nilainya: cabang yang benar-benar kosong di pohon baru (`{}`) adalah
  jawaban yang sah, dan `||` akan menjatuhkannya kembali ke salinan lama.
- **Yang memutuskan kapan sebuah langganan berat dipasang adalah ROUTE, di
  [`src/lib/heavyData.js`](src/lib/heavyData.js)** — `needsRoiSnapshots` dan `needsUserReports` —
  dan dipasang lewat `useStickyValue`. Keduanya TIDAK sama daftarnya: tab Grafik butuh snapshot tapi
  tidak menggambar satu pun rincian negara. **Sekali dipasang ia TIDAK dilepas sampai sesi
  berakhir**: RTDB membuang cache sebuah path begitu langganan terakhirnya dicabut, jadi
  melepas-pasang berarti mengunduh megabyte-nya lagi tiap kali orang bolak-balik. Yang dihemat
  adalah sesi yang tidak pernah membuka halaman itu, dan muat halaman PERTAMA tiap sesi.
- **Memisahkan data bukan menutupnya.** `userReports` seterbuka `users` (`.read: auth != null`),
  karena panel yang membacanya memang terbuka untuk tiap akun yang login. Yang dijaga aturan
  database tetap yang isinya rahasia (`otpSecrets`, `pluginKeys`).
- **Sisi sync ikut menanggung akibatnya, dan itu harus dijawab bersamaan**: memindahkan riwayat
  tidak berarti apa-apa kalau sync lalu mengunduh node barunya utuh tiap jam. Yang dipangkas diminta
  BERBATAS (`dailySpendPruneBefore`, `campaignHistoryPruneBefore` — sepola `roiReportPruneBefore`),
  dan batas permintaannya WAJIB sama persis dengan cutoff penyaringnya: lebih longgar, baris
  kedaluwarsa tidak pernah ikut terminta dan tertinggal selamanya; lebih ketat, yang belum waktunya
  ikut terbawa. Keduanya diam, dan itu yang dijaga tesnya.
- **Bacaan berulang di dalam satu proses dijawab dari cache, bukan dikurangi**
  ([`functions/warm-cache.js`](functions/warm-cache.js)). `get()` di @firebase/database menjawab
  dari cache lokal kalau ada langganan aktif yang menutupi path-nya, dan pencariannya menyusuri
  leluhur. Di server kontrol langganan itu dipasang sekali saat start dan tidak pernah dilepas; di
  `scheduledSync` ia dipasang saat run mulai dan **dicabut di `finally`** — di luar sebuah request,
  Cloud Functions gen2 mencekik CPU instance-nya, jadi langganan yang bertahan antar-run bisa
  menjawab dari cache yang diam-diam berhenti diperbarui.

## Tema: satu lapis token, dan tiga keadaan di satu tombol

Dashboard ini punya tema terang dan gelap. Yang memilih adalah setelan perangkat, sampai ada orang
yang memilih lain lewat tombol di topbar (sebelah lencana akun). Yang tidak menyatakan apa-apa —
perangkat tanpa setelan tema, penyimpanan yang tidak bisa dibaca, nilai sampah dari versi lama —
jatuh ke **terang**. Bawaan itu keputusan, bukan kebetulan.

- **Keadaannya TIGA, tombolnya dua posisi**: "ikut perangkat" (belum pernah ditekan), "terang", dan
  "gelap". `null` di penyimpanan bukan berarti terang melainkan **belum memilih**, dan itu yang
  membuat dashboard ikut berpindah saat sistem masuk mode malam.
- **Pilihan yang KEBETULAN sama dengan perangkat dihapus, bukan disimpan** (`nextTheme` di
  [`src/lib/theme.js`](src/lib/theme.js)). Itu yang menggantikan posisi ketiga di tombol: saklar dua
  posisi yang selalu menyimpan berarti sekali ditekan, dashboard berhenti mengikuti perangkat
  selamanya — dan orang yang sistemnya berpindah gelap tiap senja tidak punya jalan kembali selain
  membersihkan localStorage. Dengan aturan ini, kembali ke "ikut perangkat" cukup dengan menekan
  tombolnya sampai temanya sama dengan tema sistem, yaitu persis gerakan yang sudah dilakukan orang
  untuk keluar dari tema yang tidak diinginkannya.
- **Nilai gelap digantung pada `data-theme`, BUKAN pada `@media (prefers-color-scheme: dark)`.**
  Lewat media query, pilihan orang cuma bisa mengalahkannya dengan blok gelap KEDUA — dan dua daftar
  nilai gelap adalah persis yang lapis token ini ada untuk mencegahnya. Konsekuensinya: yang membaca
  setelan perangkat adalah JS, bukan CSS.
- **Atributnya dipasang skrip inline di `index.html`, sebelum satu piksel pun digambar.** Bundel
  dimuat `type="module"`, yang selalu ditunda sampai dokumen selesai diurai: dipasang dari sana,
  temanya baru berlaku setelah halaman terang tergambar, dan yang dilihat orang bermode gelap adalah
  kilatan putih tiap berpindah halaman. Skrip itu salinan kedua dari `resolveTheme` — ia tidak bisa
  mengimpor apa pun — jadi kunci penyimpanan dan urutan keputusannya dijaga `src/lib/theme.test.mjs`,
  persis pola `campaignCommandEntry`. Bersandar pada JS tidak menambah cara baru untuk gagal:
  halaman ini React yang tidak menggambar apa pun tanpanya.
- **Ikon dan label tombol menyebut tema TUJUAN**, bukan tema yang sedang berlaku. Dua kebiasaan
  sama-sama beredar di luar sana ("matahari = sedang terang" vs "matahari = klik untuk terang"), dan
  tombol yang cuma ikon selalu bisa dibaca terbalik — yang memutuskan artinya adalah labelnya, yang
  berbunyi lengkap sebagai kalimat perintah.
- **Tidak ada satu pun hex di luar dua blok token di kepala [`src/styles.css`](src/styles.css).**
  Tema gelap yang ditulis per selektor akan selalu melewatkan satu selektor, dan yang terlewat tidak berbunyi sebagai kesalahan apa pun —
  yang melihatnya cuma orang bermode gelap, sebagai teks putih di atas putih, setelah fiturnya
  di-deploy. Dengan satu lapis token, blok gelap hanya menyebut ulang NILAI: halaman baru ikut gelap
  tanpa disentuh. Dijaga `src/lib/styles.theme.test.mjs`, yang menolak warna mentah di luar kedua
  blok itu, `var()` ke token yang tidak ada, token yang cuma punya nilai di salah satu tema, dan
  blok gelap yang kembali digantung pada media query.
- **Latar berwarna di tema gelap adalah warna yang SAMA pada opasitas rendah, bukan pastel yang
  dipilih satu per satu.** Pastel yang dipilih manual bergeser dari halaman ke halaman; yang
  ditumpuk di atas `--background` selalu ikut permukaan di belakangnya, dan satu lencana di dalam
  dialog tetap sewarna dengan kembarannya di tabel.
- **Yang jadi TEKS dan yang jadi ISIAN adalah dua token berbeda**, walau di tema terang nilainya
  sama. Keduanya bergerak berlawanan saat temanya gelap: warna yang dipakai sebagai teks harus makin
  terang supaya terbaca di atas hitam, sementara warna yang dipakai sebagai isian justru berbalik
  jadi terang dengan tulisan gelap di atasnya. Karena itu `--info-solid` (teks/ikon) berpisah dari
  `--info-fill` + `--info-fill-fg` (tanggal terpilih), dan `--indigo-solid` dari `--indigo-fill`.
- **Bayangan ikut token, bukan cuma warnanya.** Yang memisahkan panel dari halaman di tema terang
  adalah bayangan; di atas hitam bayangan hitam tidak memisahkan apa pun, dan yang mengangkat panel
  adalah batasnya. Yang tersisa cuma bayangan lapisan yang benar-benar melayang (dialog, popover,
  tooltip), dan itu justru dipekatkan.
- **Recharts adalah satu-satunya yang tidak bisa memakai `var()`.** Warnanya diberikan sebagai prop
  JS yang berakhir sebagai ATRIBUT SVG, dan atribut SVG tidak memahami `var(--token)` — nilainya
  terbaca sebagai warna yang tidak sah dan garisnya hilang tanpa error, cuma grafik kosong. Jadi
  warnanya DIBACA dari token yang sama lewat [`src/lib/chartTheme.js`](src/lib/chartTheme.js) +
  `useChartPalette`, bukan disalin jadi daftar kedua: daftar kedua akan berbeda dari CSS suatu hari,
  dan yang berbeda adalah legenda HTML di bawah kanvas melawan garis di dalamnya — dua hijau yang
  mengaku subdomain yang sama. Inline `style` biasa (toast di `main.jsx`) tidak kena aturan ini:
  di sana `var()` bekerja seperti di stylesheet mana pun.
- **`color-scheme` diumumkan di CSS DAN di `index.html`.** Yang di CSS membuat scrollbar, kotak
  centang, dan pemilih tanggal bawaan browser ikut gelap — tanpa itu, satu-satunya yang tetap putih
  menyilaukan justru bagian yang tidak bisa kita gaya sendiri. Yang di `<head>` untuk kanvas pertama
  yang dicat SEBELUM stylesheet sampai; tanpa itu tiap muat halaman diawali kilatan putih. Warna
  bilah alamat (`theme-color`) DIBACA dari `--background` saat tema dipasang, bukan disalin jadi
  daftar hex kedua di `<head>`.

## Uang dan ROI: satu rumus

[`withAdTax`](src/lib/adTax.js) adalah satu-satunya tempat ROI dihitung di sisi UI:
`ROI% = (earning − totalSpending) / totalSpending × 100`, dengan `totalSpending = spend + ad tax`.
Tabel yang membagi dengan spend telanjang akan melaporkan ROI berbeda untuk uang yang sama.

**Di bawah `MIN_ROI_SPEND` (Rp 1.000) tidak ada ROI sama sekali — `""`, bukan 0%.** Pembagi yang
mendekati nol meledakkan hasilnya: 3 Agu 2026 berbunyi **+355.456,11%** untuk hari yang
membelanjakan Rp 43, berdiri di kolom yang sama dengan +412% milik hari yang membelanjakan jutaan —
dan yang paling besar di layar justru yang paling tidak berarti. Di grafik satu titik seperti itu
menekan seluruh kurva bulan lain jadi garis datar di dasar kanvas.

- **Spend NOL jatuh ke aturan yang sama, dan itu MENGGANTIKAN aturan lama yang menjawab 0%.** Nol
  adalah sebuah pernyataan, dan pernyataan yang salah untuk subdomain yang menghasilkan Rp 826
  tanpa belanja sepeser pun; yang benar bukan nol melainkan "tidak ada ROI untuk dihitung". Yang
  dijaga aturan lama (jangan sampai Infinity) tetap terjaga.
- **Yang dilantai adalah PEMBAGINYA (`totalSpending`), bukan spend telanjang** — itu angka yang
  benar-benar dipakai membagi, dan angka yang sama dengan kolom Total Spend di layar.
- **`profit` TIDAK ikut dikosongkan.** Earning dikurangi belanja tetap uang yang nyata, berapa pun
  kecilnya pembagi.
- **Satu-satunya ROI yang tidak lewat `withAdTax` adalah `getNetPercentage`** (kurva grafik), dan
  lantainya sama. Yang dibedakan cuma bentuk "tidak ada nilainya": `null`, bukan `""`, karena itu
  yang membuat Recharts MEMUTUS garis alih-alih menggambar NaN di sumbu nol.
- Sisi `functions/` tidak ikut berubah: `roi` yang ditulis `roiReportUpdate` tidak dibaca satu
  halaman pun (semuanya menghitung ulang lewat `withAdTax`), dan peringatan ROI sudah punya lantai
  belanjanya sendiri (`minSpend`).

`earning` yang **tidak diketahui bukan nol**. Baris yang laporan GAM-nya gagal datang tanpa
earning; `withAdTax` mengembalikan `""` untuk earning/ROI/profit dan `earningKnown: false`. Nol yang
dikarang akan tampil sebagai "ROI −100%" — tidak bisa dibedakan dari subdomain yang beriklan tanpa
hasil.

**Begitu juga `spending`.** Tidak semua subdomain diiklankan di Meta — ada yang earning-nya murni
dari GAM — dan barisnya datang tanpa spend sama sekali. `withAdTax` mengembalikan `""` untuk
Spending/Ad Tax/Total Spend/ROI/profit dan `spendingKnown: false`; spend `0` yang **nyata** (campaign
ada, hari itu tidak membelanjakan apa pun) tetap `0`. Sisi sync menulis sebabnya di baris,
`metaMissing`: `"unmapped"` (tidak ada campaign Meta yang mengarah ke sana) atau `"unavailable"`
(sisi Meta run itu tidak lengkap) — yang pertama diperbaiki di /sub-domains, yang kedua di sync-nya,
dan sel kosong tanpa keterangan tidak bisa membedakan keduanya.

**Kode campaign yang TIDAK terdaftar tidak berbunyi sebagai apa pun.** Ia bukan `unmapped` di baris
mana pun — barisnya memang tidak ada: `buildCampaignResolver` menjatuhkan campaign-nya, belanjanya
tidak masuk ROI siapa pun, dan tidak ada satu isu sync pun yang menyebutkannya. Yang terlihat cuma
selisih terhadap Ads Manager, dan hanya oleh yang menghitungnya sendiri. Audit 4 Sep 2026 menemukan
Rp 4.809.704 (Apr–Agu) hilang begitu; dua script yang membereskannya, dan keduanya idempotent
ber-`--dry`:

- `migrations/register-missing-campaign-codes.mjs` (`npm run migrate:campaign-codes`) mendaftarkan
  kodenya. Tujuan tiap kode **dibaca dari cermin Keitaro** (`dashboard/gating/campaigns`), yang
  menyebut subdomain tujuan di ujung nama campaign-nya — bukan ditebak dari kemiripan nominal.
  Karena itu `LrLk` (Rp 2,1 jt, Mei) sengaja TIDAK ikut: campaign-nya sudah dihapus dari Keitaro,
  jadi tidak ada catatan yang menyebut tujuannya.
- `migrations/backfill-roi-spend.mjs` (`npm run migrate:roi-spend`) menulis ulang **sisi spend**
  baris `roiReports` yang sudah tersimpan — mendaftarkan kode saja tidak memperbaiki satu pun baris
  lampau, karena `campaignCodes` cuma dibaca saat sync menulis baris baru dan sync penuh hanya
  menyentuh kemarin + hari ini. Bawaannya 1 Agu 2026 s/d hari ini: April–Juli berstatus "Sudah
  Cair" di `payouts`, dan menulis ulang belanjanya menggeser Net Profit serta dasar bonus bulan yang
  uangnya sudah dibayarkan. Satu akun yang gagal dibaca **menghentikan seluruh run** — alasan yang
  sama dengan `metaComplete`. Tabel ROI per Negara tidak ikut, dan baris hari+subdomain yang belum
  ada hanya dibuat kalau spend-nya di atas nol.

Yang menjumlahkan uang lintas baris **wajib melewati yang tidak diketahui**, bukan menambahkannya:
`"" + 100` bukan 101, melainkan teks `"0100"`.

Earning bersumber dari **Google Ad Manager**, dan laporannya diminta per sumber permintaan:
`AD_EXCHANGE_REVENUE`, `ADSENSE_REVENUE`, `AD_SERVER_REVENUE`. `earning` adalah **jumlah ketiganya**
— ROI dihitung dari jumlah itu — dan rinciannya tinggal di baris sebagai `adxRevenue`,
`adsenseRevenue`, `adServerRevenue`. Tabel ROI memecahnya jadi dua kolom: **GAM** (AdX + Ad Server,
keduanya permintaan Ad Manager) dan **AdSense** (AdSense-in-GAM). Satu kolom berjudul "ADSENSE"
untuk semua baris adalah nama yang salah bagi subdomain yang tidak dimonetisasi lewat AdSense —
per 11 Agu 2026 seluruh pendapatan kelima network adalah Ad Exchange, jadi kolom AdSense-nya Rp 0.

Baris yang **tidak membawa rinciannya** (ditulis sebelum pemecahan ini, atau network yang metriknya
ditolak) menampilkan `"-"` di kedua kolom, bukan Rp 0: nol di kolom sumber adalah klaim bahwa sumber
itu tidak menghasilkan apa-apa.

## Dua sumber earning: GAM dan AdSense

Earning tidak selalu datang dari Ad Manager. Domain yang pengajuan Ad Manager-nya belum/tidak
disetujui Google tetap punya AdSense, dan itu API yang berbeda — bukan parameter yang berbeda.

| | Koleksi RTDB | Halaman | API | Alamat akun |
|---|---|---|---|---|
| Ad Manager | `gamAccounts` | `/gam-accounts` ("GAM") | `admanager.googleapis.com/v1` ([`gam.js`](functions/gam.js)) | `networkCode` |
| AdSense | `adsenseAccounts` | `/adsense-accounts` ("AdSense") | `adsense.googleapis.com/v2` ([`adsense.js`](functions/adsense.js)) | `accounts/pub-…` |

Ketiga lapisnya sejajar dan harus tetap begitu: koleksi, halaman, dan cabang
`dashboard/syncIssues/{gamAccounts,adsenseAccounts}` bernama sama, jadi ikon peringatan di topbar
menunjuk halaman yang benar. Koleksi `adsenseAccounts` dulu berisi network GAM — itu nama yang
salah, dan `migrations/migrate-gam-accounts.mjs` yang membetulkannya.

- **Yang bercabang hanya pemilihan API.** [`earningRowsByDimensions`](functions/sync-core.js) dan
  `earningUpdate` memilih klien lewat `accountProvider(account)`; keluaran kedua klien **berbentuk
  sama persis** (`{ keys, impressions, clicks, earning, adx, adsense, adServer }`), sehingga
  `gamRowsByDay`, pencocokan nama site, `collectCountryEarning`, dan `roiReportUpdate` tidak pernah
  tahu laporan itu datang dari mana. Percabangan di hilir adalah cara satu provider diam-diam
  ketinggalan di satu modul saja.
- **Tiap modul sync membaca kedua koleksi lewat `earningAccounts(gam, adsense)`.** Di situlah satu-
  satunya tempat aturan "akun mana yang dilewati" ditulis. Akun tanpa alamat di API-nya (record GAM
  tanpa `networkCode`, record AdSense tanpa Publisher ID) dilewati diam-diam — belum pernah
  dihubungkan bukan kegagalan, dan menjadikannya isu sync membuat daftar isu penuh baris yang tidak
  bisa diperbaiki siapa pun.
- **Pendapatan AdSense masuk kolom AdSense, `adx`/`adServer`-nya 0 — dan nol itu benar.** Berbeda
  dari baris lama yang tidak membawa rincian sama sekali (menampilkan `"-"`), di sini sumbernya
  memang tidak ada.
- **Dimensi diminta dalam enum GAM**, diterjemahkan `adsenseDimension()`: `SITE` → `DOMAIN_NAME`
  (hostname penuh, cocok dengan `subDomains.name`), bukan `OWNED_SITE_DOMAIN_NAME` yang
  menggumpalkan seluruh subdomain jadi satu baris domain induk.
- **Mata uangnya DIMINTA, bukan dikonversi sendiri: laporan AdSense DAN GAM selalu diminta dalam
  IDR** (`ADSENSE_CURRENCY` / `GAM_CURRENCY`, default `IDR`; kosong = ikut akun/network, jalur lama
  lewat `convertRowsToIdr`). Alasannya bukan selera: API membulatkan uang ke dua desimal, jadi
  satu hari senilai USD 0,76 sudah membawa ralat ±0,7% sebelum dikali apa pun, dan kurs gratis
  (open.er-api) cuma punya kurs HARI INI — hari lampau akan dikonversi dengan kurs yang salah dan
  tidak akan pernah cocok dengan layar AdSense. Konversi Google memakai kurs hari itu.
  - **GAM dulu dikira tidak bisa diminta lain, dan itu salah.** `reportDefinition.currencyCode`
    diterima Ad Manager API v1 (dibuktikan 19 Sep 2026) dan menjawab sama sampai rupiah dengan
    layar Ad Manager. Sampai itu diketahui, empat network USD (designingaround, psaonlineappointment,
    bispdailyupdates, theglobesimregistration) meleset −0,66% sampai +0,25% per bulan: Agustus
    ditulis ulang 2 Sep dengan SATU kurs untuk 31 hari. Baris lamanya dibetulkan
    `migrations/backfill-roi-earning.mjs` (`npm run migrate:roi-earning`), yang juga mengisi earning
    subdomain yang didaftarkan sesudah harinya lewat — sync cuma menulis kemarin + hari ini, dan
    `migrate:roi-spend` cuma sisi spend. `--domain-start=sheetz.us:2026-09-01`: usaha sheetz dimulai
    September, jadi pendapatan Agustus akun AdSense-nya (milik pemilik sebelumnya) tidak dihitung.
- **Yang tahu mata uang sebuah laporan hanyalah laporan itu sendiri** (`reportCurrency`, dari
  `currencyCode` di header kolom uang), dan itu tetap dibaca walau sekarang IDR yang diminta:
  `accounts.list` AdSense v2 **tidak mengembalikan mata uang sama sekali**, jadi record akun selalu
  kosong dan `convertRowsToIdr` yang mempercayainya tidak mengalikan apa pun. Itu yang membuat
  pendapatan satu akun USD tersimpan sebagai rupiah — 21 Agu 2026 marriage.psaonlineappointment.com
  berbunyi IDR 13.521 di layar AdSense dan **Rp 1** di dashboard, dengan ROI −99,96% untuk subdomain
  yang untung 592%. `migrations/fix-adsense-report-currency.mjs` yang membetulkan baris lamanya
  (baris harian ditulis ulang dari angka IDR Google; baris snapshot per sync tidak bisa diminta
  ulang, jadi diskala dengan perbandingan IDR/USD hari itu — dari Google, bukan dari API kurs).
- **Zona waktu laporan AdSense adalah zona akunnya, dan tidak bisa diminta lain.** Pilihan API cuma
  zona akun atau `GOOGLE_TIME_ZONE`. Kalau zona akun bukan Asia/Jakarta, "kemarin" versi akun itu
  bukan "kemarin" versi dashboard; karena itu `reportTimeZone` ikut disimpan di record dan tampil
  sebagai kolom, supaya selisihnya terlihat alih-alih ditebak dari angka yang aneh.
- **Consent meminta dua scope sekaligus** (`admanager` + `adsense.readonly`, lihat `SCOPES` di
  [`functions/google-oauth-core.js`](functions/google-oauth-core.js)). Kredensial lama tetap bekerja
  untuk GAM dengan token lamanya, tapi harus consent ulang sebelum bisa membaca AdSense — kegagalan
  scope berbunyi seperti izin, bentuknya sama persis dengan token kedaluwarsa. Mengaktifkan AdSense
  Management API di Cloud Console **tidak** mengubah token yang sudah terbit.
- **"Tersimpan" tidak berarti "terhubung", dan itu aturan tombol Login di `/google-api-configs`.**
  Consent-nya dijalankan server kontrol ([`server/google-auth.js`](server/google-auth.js), ADMIN —
  satu-satunya endpoint di sana yang bukan superadmin, cerminan `.write` pada `googleApiConfigs`).
  `credentialAuthResult` memecah jawabannya jadi tiga, persis seperti `ok`/`unapplied`/`failed` di
  plugin: `ok` (token baru, scope lengkap), `partial` (token baru tersimpan, scope-nya kurang), dan
  `failed` (Google tidak mengembalikan refresh token — **tidak ada yang ditulis**, karena status
  "Connected" untuk token lama yang scope-nya justru sedang diperbaiki adalah kebohongan yang
  membuat orang berhenti mencari). Scope yang benar-benar diberikan tersimpan di record dan tampil
  sebagai kolom **Izin**; kosong di sana berarti "belum pernah login lewat tombol".
- **Callback OAuth tidak bisa membawa header, jadi yang menjaganya `state` sekali pakai** di
  `googleApiConfigs/{id}/authState` — dihapus SEBELUM code-nya ditukar. Izin diperiksa di langkah
  pertama (yang meminta URL consent), bukan di callback, di mana tidak ada identitas apa pun untuk
  diperiksa.

### Status akun: empat keadaan, dan Google yang memutuskannya

Kolom **Status** di `/gam-accounts` dan `/adsense-accounts` dulu diketik orang
(Active/Inactive/Limit/Lepas Limit). Sekarang ia ditulis sync tiap run dengan salah satu dari empat
keadaan — **Akun Close**, **Limit Iklan**, **Iklan Belum Tayang**, **Ready** — dan aturannya di
[`functions/account-status.js`](functions/account-status.js), kosakatanya dicerminkan ke
[`src/lib/accountStatus.js`](src/lib/accountStatus.js) persis pola `campaignCommandEntry`.

- **Yang dijawabnya adalah keadaan yang diputuskan GOOGLE, dan itu sebabnya ia tidak boleh
  diketik.** Akun yang dibatasi semalam tetap berbunyi "Active" sampai ada yang kebetulan membuka
  konsolnya, dan tidak ada apa pun di layar yang membedakan "Active" yang dicek pagi ini dari
  "Active" yang diketik tiga bulan lalu. Dropdown-nya tetap ada — untuk akun yang API-nya memang
  tidak bisa menjawab, DAN untuk akun yang keadaan sebenarnya sudah diketahui orang lebih dulu.
- **YANG SUDAH DISUNTING ORANG TIDAK DITIMPA SYNC**, dan yang memutuskannya bukan penanda yang
  ditulis saat menyimpan melainkan DUA NILAI: `status` (yang berdiri di kolom) dan `statusAuto`
  (kolom **Status dari Google** — keadaan yang dibaca sync terakhir kali). Sync menulis keduanya
  sekaligus, jadi selama tidak ada yang menyentuhnya keduanya sama persis; begitu berbeda, yang
  mengubahnya cuma bisa orang. `accountStatusPinned` di
  [`functions/account-status.js`](functions/account-status.js), dan kedua penyusun tulisannya
  (`accountStatusFields`, `accountStatusNote`) tinggal di sana juga — sisi `sync-core.js` cuma
  I/O-nya, dan keputusan yang tinggal di dalam pemanggil API tidak bisa diuji tanpa menghubungi
  Google.
  - **Jalan kembali ke "ikut sync" TIDAK punya saklar tersendiri**: pilih nilai yang sama dengan
    "Status dari Google", dan kuncinya lepas sendiri — persis aturan `nextTheme`. Sebuah penanda
    `statusManual: true` yang ditulis saat menyimpan tidak punya itu: sekali ditekan, kolomnya beku
    selamanya dan yang membukanya kembali cuma orang yang tahu ada field bernama begitu. Kuncinya
    juga lepas sendiri pada hari Google akhirnya menyebut hal yang sama.
  - **`statusAuto` TETAP ditulis tiap run untuk baris yang dipegang, justru karena statusnya
    tidak.** Tanpa itu, baris yang dikunci berdiri tanpa satu pun tanda tentang apa yang dijawab
    Google hari ini — dan yang membacanya tidak punya cara tahu kuncian itu sudah tidak perlu lagi.
    Kolomnya BERLENCANA seperti kolom Status di sebelahnya (`badgeKeys` di
    [`src/lib/renderCell.jsx`](src/lib/renderCell.jsx)): dua kolom berkosakata sama yang satu
    berlencana dan satu tidak terbaca seolah yang kedua cuma catatan tentang yang pertama. Di form
    ia readOnly lewat `compute` — kotak yang bisa diketik berarti kuncinya bisa dilepas dengan
    mengarang jawaban Google.
  - **`statusDetail` ikut TIDAK disentuh pada baris yang dipegang**, termasuk saat pengecekannya
    gagal. Kolom itu satu-satunya tempat orang menuliskan sebab ia memegang statusnya ("sedang
    banding, tiket #123"), dan "Tidak bisa dicek: ..." di sana tidak menerangkan apa pun — status
    di sebelahnya memang tidak akan berubah walau pengecekannya berhasil. **Konsekuensinya
    diketahui**: pada baris yang dikunci, `statusAuto` yang gagal dibaca membeku di nilai run
    terakhir yang berhasil tanpa tanda apa pun.
  - **Baris yang lahir dari impor Google membawa `statusAuto` sejak baris pertamanya** (sama dengan
    `status`, "Iklan Belum Tayang"). `statusAuto` yang kosong berarti tidak ada pembanding sama
    sekali, jadi tanpa itu akun yang baru diimpor lalu langsung diberi status oleh orang — keadaan
    yang paling sering, karena barisnya memang berbunyi "belum pernah dicek" — ditimpa sync pertama
    yang berhasil. **Batas yang sama berlaku sekali untuk baris LAMA**: suntingan yang dibuat
    sebelum kolom ini ada tidak punya pembanding, dan ditimpa satu kali oleh run berikutnya.
- **SUMBERNYA API ADSENSE UNTUK KEDUA HALAMAN, termasuk halaman GAM.** Ad Manager API tidak punya
  notifikasi maupun status akun sama sekali; yang tahu sebuah akun dibatasi atau ditutup hanya sisi
  AdSense-nya. Network GAM membawa `propertyCode` berbentuk `ca-pub-…` — akun AdSense yang sama —
  dan `adsenseAccountName` sudah merapikan awalan "ca-" itu sejak lama. Bercabang di sini berarti
  halaman GAM tidak akan pernah tahu akunnya dibatasi.
- **"Limit Iklan" dibaca dari `accounts.alerts`, notif yang sama dengan yang merah di dashboard
  AdSense** (`type: "adsense-traffic-throttled"`, severity `SEVERE`). Dicocokkan DUA lapis, karena
  keduanya gagal dengan cara yang berlawanan: pencocokan tipe yang ketat diam pada hari Google
  mengganti namanya — dan yang diam di sini berbunyi "Ready" untuk akun yang justru sedang
  dibatasi — sementara "semua alert SEVERE = Limit Iklan" melabeli akun yang notif merahnya soal
  pajak. Endpoint ini MENOLAK `pageSize`, berbeda dari tiap list lain di `adsense.js`.
- **"Akun Close" dari `Account.state === "CLOSED"`, dan `NEEDS_ATTENTION` sengaja BUKAN keadaan
  kelima.** Yang kedua berarti "ada yang perlu diurus" — pajak, alamat penagihan, verifikasi — dan
  hampir semuanya tidak menghentikan tayangan iklan sedetik pun.
- **"Iklan Belum Tayang" satu-satunya yang TIDAK dilaporkan Google sebagai apa pun.** Tidak ada
  flag, tidak ada notif; yang tersisa adalah laporan hari terakhir yang sudah diambil
  `earningUpdate`. Nol impresi **DAN** nol pendapatan — keduanya, bukan impresinya saja: kedua API
  melaporkan impresi per jenis permintaan, dan network yang seluruh inventarisnya dilayani sumber
  lain mengembalikan nol impresi untuk hari yang tetap menghasilkan uang. Uang yang masuk adalah
  bukti iklan tayang.
  **SATU HARI, dan itu syarat yang mengikat pemanggilnya** (`period.settledDayRange`): diberi
  rentang beberapa hari, pertanyaannya diam-diam berubah jadi "apakah akun ini pernah menayangkan
  iklan minggu ini".
- **TIDAK ADA satu pun endpoint yang menjawab "iklan akun ini sedang dibatasi" selain
  `accounts.alerts`, dan itu sudah diperiksa** (3 Sep 2026, ke API produksi):
  `accounts.get` (`state`), `accounts.policyIssues`, `accounts.sites` (`state`),
  `accounts.adclients` (`state`) di AdSense v2, plus `networks.get`, `networks.sites`
  (`approvalStatus`), dan `networks.adUnits` di Ad Manager v1. Untuk masseffectstore.com —
  yang Ad Exchange-nya berhenti 31 Agu — SEMUANYA menjawab READY/APPROVED/ACTIVE dan
  `policyIssues` kosong. Jadi pembatasan yang terlihat di Pusat Kebijakan Ad Manager memang tidak
  punya jalan keluar lewat API mana pun, dan yang bisa dilaporkan kolom Status untuk akun seperti
  itu adalah "Iklan Belum Tayang" — bukan "Limit Iklan", yang hanya boleh datang dari notif Google
  sendiri.
- **Yang tidak bisa dipastikan MENJAWAB `null`, dan nilai lamanya dibiarkan berdiri.** Sekali
  kegagalan API dibaca sebagai "Ready", yang dilihat orang di kolom Status bukan lagi keadaan akun
  melainkan keadaan sync — dan keduanya tidak bisa dibedakan di layar. Sebabnya ditulis di kolom
  **Keterangan Status** (`statusDetail`), yang juga memuat pesan notif Google saat statusnya
  "Limit Iklan", dan DIKOSONGKAN begitu akunnya berhasil dicek lagi.
  Itu satu-satunya tempat "kenapa status ini tidak berubah-ubah" bisa terbaca: kredensial yang
  project Google Cloud-nya belum mengaktifkan AdSense Management API menjawab 403 `SERVICE_DISABLED`
  untuk seluruh akunnya, dan tanpa kalimat itu akun-akun tersebut berdiri selamanya dengan status
  yang diketik berbulan-bulan lalu.
- **Menumpang token dan laporan `earningUpdate`, bukan run tersendiri**, dan TIDAK PERNAH melempar:
  status adalah kolom tambahan, dan sync earning yang jatuh karena daftar alert gagal diambil
  berarti fitur baru menghapus fitur yang sudah dipakai tiap hari.
- **Satu publisher yang berdiri di KEDUA halaman boleh menyebut status berbeda, dan itu benar.**
  "Limit Iklan" berlaku pada akun pub-nya, jadi ia muncul di kedua barisnya; "Iklan Belum Tayang"
  berlaku pada laporan baris itu sendiri — network GAM yang menayangkan Ad Exchange sementara
  produk AdSense-nya tidak menayangkan apa pun memang dua keadaan yang berbeda.

### Saldo akun: satu angka Google, pecahannya RESIDU

Kolom **Saldo**, **Saldo Adsense**, dan **Saldo Ad-Exchange** di `/gam-accounts` dan
`/adsense-accounts` dulu diketik orang dan kosong di seluruh baris. Sekarang sync menulisnya tiap
run, menumpang token dan run `earningUpdate` yang sama dengan kolom Status. Aturannya di
[`functions/account-balance.js`](functions/account-balance.js), I/O-nya `accountBalanceUpdate` di
[`functions/sync-core.js`](functions/sync-core.js).

```
Saldo             = payments/unpaid                  (angka Google, bukan hitungan kita)
Saldo Adsense     = earning AFC bulan final terakhir  (AdSense Reports API)
Saldo Ad-Exchange = Saldo - Saldo Adsense             (sisanya)
```

- **SUMBERNYA API ADSENSE UNTUK KEDUA HALAMAN, termasuk halaman GAM** — alasan yang sama persis
  dengan kolom Status: Ad Manager API v1 **tidak punya satu pun resource pembayaran, saldo, atau
  tagihan**. Yang ada cuma `networks.mcmEarnings` (bagi hasil parent/child MCM per bulan, ditanyakan
  pada network PARENT yang bukan milik kita), dan untuk ketujuh network kita ia menjawab 400.
- **TIDAK ADA PECAHAN SALDO DI API MANA PUN, dan itu sudah diperiksa** (4 Sep 2026, ke API
  produksi): schema `Payment` cuma membawa `name`/`date`/`amount`; `accounts.adclients` tidak pernah
  menyebut Ad Exchange (hanya `AFC`, dua klien YouTube, satu `AFS` partner); **tidak ada resource
  `transactions` di AdSense v2** — halaman Transaksi di UI, yang memang memecah saldo per produk,
  tidak punya padanan API — dan `adsenseplatform.googleapis.com` cuma melayani platform host. Jadi
  pecahannya DIREKONSTRUKSI, dan cara merekonstruksinya adalah keputusan.
- **Yang dipakai RESIDU, bukan prorata porsi laporan.** Prorata ditolak oleh satu akun:
  designingaround.com Agustus 2026 melaporkan AdX Rp 1.384 dan AFC Rp 2.061.896, jadi ia menaruh
  99,93% dari saldo Rp 23.016.432 di kolom AdSense. Uang itu Ad Exchange lewat **MCM** —
  inventarisnya didelegasikan ke parent (lihat `/adx-costs`: Marktube, Holuron, Monumetric), yang
  tidak muncul di laporan network sendiri sama sekali: Juli-nya melaporkan Rp 2.696 lalu dibayar
  Rp 38.690.091. Residu benar justru karena ia tidak menuntut laporan melihat seluruh uangnya — apa
  pun yang tidak terlihat AdSense memang Ad Exchange.
- **Selisihnya diketahui dan diterima**: `Saldo Adsense` adalah earning ESTIMASI yang belum kena
  potongan final Google (saldo ÷ laporan bulan yang sama: 0,856 petcins / 0,813 masseffectstore /
  0,913 stylefemale), jadi kolomnya kelebihan ~9-19% DARI ANGKANYA SENDIRI dan residunya kekurangan
  sebesar itu — Rp 8 sampai Rp ~250.000, alias 0,00003%-1,1% dari saldonya. Yang eksak cuma halaman
  Transaksi AdSense, dan itu memang harus diketik orang.
- **Jendelanya bulan kalender penuh terakhir, dan itu tebakan yang dibuat dengan bukti.**
  `payments` cuma mengembalikan SATU baris terbayar (yang terakhir), jadi tidak ada apa pun di API
  yang menyebutkan periode mana yang sedang menganggur. Yang mengarahkannya: saldo stylefemale ÷
  laporan AGUSTUS = 0,913, hampir sama dengan pembayaran 21 Agu ÷ laporan JULI = 0,899; dengan
  September ikut, rasionya jatuh ke 0,778. Kalau ternyata bulan berjalan sudah ikut, yang meleset
  cuma PECAHANNYA — totalnya tetap angka Google.
- **`payments/unpaid` menjawab per PUBLISHER, dan tujuh publisher berdiri di DUA halaman**
  (petcins.com ≡ "Dian ramadani", designingaround.com ≡ "MUZAKKIR WALAT", …). Kedua baris menyebut
  angka yang sama dan angka itu benar di keduanya; yang salah cuma menjumlahkannya. Penandanya
  kolom **Saldo Kembar**, DITURUNKAN saat dirender
  ([`src/lib/accountBalance.js`](src/lib/accountBalance.js), `derive`) dan bukan ditulis sync —
  alasan yang sama dengan kolom turunan Invalid Traffic: yang ditulis benar pada detik ia ditulis
  dan basi sesudahnya. Bisa diturunkan sama sekali karena kedua koleksi ADMIN_ONLY, jadi yang boleh
  membuka salah satu halaman sudah melanggan keduanya.
- **`youtube-unpaid` DILEWATI.** Ia saldo produk lain di kantong yang sama, dan menjumlahkannya ke
  sini berarti kolom Saldo memuat uang yang tidak berasal dari satu pun domain di dashboard ini.
- **Dinormalkan ke IDR** (`saldoCurrency` + `saldoFxRate` ikut disimpan, sepola `convertRowsToIdr`):
  tiga dari tujuh publisher menjawab dalam USD, dan `payments` **menolak** parameter mata uang —
  berbeda dari laporan, yang bisa diminta IDR. Kurs HARI INI memang kurs yang benar di sini: yang
  dikonversi uang yang belum cair, bukan pendapatan hari lampau. Laporan pecahannya diminta dalam
  **mata uang pembayaran**, bukan IDR: angkanya dikurangkan dari saldo, dan dua mata uang yang
  saling dikurangkan menghasilkan residu yang tampak wajar dan meleset ribuan kali.
- **Yang tidak bisa dipastikan MENJAWAB null, dan nilai lamanya dibiarkan berdiri** — sepola kolom
  Status. Sebabnya di kolom **Keterangan Saldo** (`saldoDetail`), yang DIKOSONGKAN begitu akunnya
  berhasil dibaca lagi. Laporan AdSense yang gagal tidak menghapus totalnya (ia tidak bergantung
  padanya) tapi MENGOSONGKAN pecahannya: dua angka dari dua hari berbeda yang berdiri di satu baris
  tidak bisa dibedakan. Residu minus juga dikosongkan — ia keadaan yang sah, dan
  "Ad-Exchange −Rp 300.000" adalah klaim yang tidak pernah benar.
- **Riwayat pembayaran TIDAK bisa dipakai mengisi Total Payout.** `payments` mengembalikan satu
  baris terbayar per akun walau `/payouts` mencatat pencairan tiap bulan; yang menyimpulkan totalnya
  dari sini akan melaporkan satu bulan sebagai seumur hidup akun itu.
- Tidak butuh `npm run deploy:rules`: `gamAccounts`/`adsenseAccounts` tidak punya `.validate`.

## Satu baris = satu hari, di kedua sisi

`reportPeriod()` di [`functions/sync-core.js`](functions/sync-core.js) menentukan hari-hari satu run,
dan rentang yang sama dipakai GAM maupun Meta:

| | Hari | Tanda di baris | Dipakai untuk |
|---|---|---|---|
| `period.settled` (= `period.key`) | kemarin, Asia/Jakarta | — | hari acuan dashboard, default semua tabel |
| `period.running` | hari ini | `partial: true` | pilihan "Hari Ini" |

Yang dilarang **bukan** menampilkan hari ini — melainkan mencampur dua hari dalam satu baris. Sekali
waktu earning GAM kemarin dipasangkan dengan spend Meta `date_preset=today`, dan ROI-nya terbaca
600%. Jadi: **kalau sebuah baris memuat earning dan spend, keduanya harus datang dari hari yang sama**
(`gamRowsByDay` / `metaRowsByDay` memecah laporan rentang menjadi hari-harinya).

- **Hari berjalan wajib ditandai, bukan disimpulkan dari tanggal.** Baris membawa `partial: true`
  sendiri; "hari ini" di browser yang zonanya bukan WIB adalah hari yang berbeda, dan baris final
  tidak boleh berubah status karena tab dibiarkan terbuka melewati tengah malam. Di sisi UI, pakai
  `isPartialRow()` dari [`src/lib/dateRange.js`](src/lib/dateRange.js).
- **Default tabel ROI adalah hari berjalan** (`filterRunningDay`, "Hari Ini"), karena itu yang dicari
  orang tiap membuka dashboard. Panel "Laporan ROI Realtime" di Overview **tidak memakai keterangan
  prosa** untuk itu: yang menyebutkan periodenya adalah pemilih di sebelah kanan judul, dan yang
  menyebutkan umur tiap baris adalah kolom Date + Time-nya sendiri. Label "Berjalan" per baris pun
  sudah dibuang — sejak tiap sync menulis barisnya sendiri, kata itu menempel di hampir seluruh
  tabel dan tidak membedakan apa pun.
  **Konsekuensinya diketahui dan diterima**: angka hari berjalan adalah setengah hari, dan tidak ada
  lagi kalimat di layar yang mencegah orang mengadunya dengan laporan AdSense sehari penuh. Yang
  tersisa sebagai penjaga cuma pemilih periodenya. Aturan yang sama berlaku untuk "Report Master
  Realtime ROI" dan "ROI per Negara" di `/users/{uid}` — keduanya juga tanpa keterangan prosa dan
  tanpa label "Berjalan".
- **`filterRunningDay` menyaring lewat hari partial TERBARU, bukan "semua yang partial".** Baris
  snapshot bertahan beberapa hari dan semuanya bertanda partial, jadi aturan lama menumpuk tiga hari
  ke dalam pilihan yang berbunyi "Hari Ini". Tanggalnya tetap dibaca dari baris (hari operasi),
  bukan dari jam browser.
- **"Hari ini berjalan?" = tanda `partial` DAN tanggal hari berjalan (`isRunningRow`), di SETIAP
  pembaca** — Kalender, Grafik, Proyeksi Budget. Tanda saja dulu cukup untuk Kalender dan Grafik,
  dan pertengahan September petak 20 Agu masih berlabel "berjalan" (dan terbuang dari sampel
  potensi) karena satu baris receh: subdomain yang ditulis saat harinya berjalan lalu tidak muncul
  di laporan FINAL tidak pernah ditulis ulang. Sisi sync sekarang menulis ulang sisa itu dari
  laporan final hari yang sama (`leftoverRunningIds`, "tidak ada di laporan yang lengkap" = nol);
  30 baris lama (20 Agu–15 Sep 2026) dilepas tandanya oleh `npm run migrate:stale-partial`, angkanya
  dibiarkan — tidak ada laporan final yang bisa diminta ulang untuk receh seperti itu.
- **Laporan yang hasilnya satu angka tanpa kolom tanggal** (kolom Earning di `/gam-accounts` dan
  `/adsense-accounts`)
  memakai `period.settledDayRange` — SATU hari, hari selesai itu sendiri. Menjumlahkan beberapa
  hari lalu memberinya label tanggal kemarin (`lastSyncReportDate`) adalah angka yang berbohong,
  dan itu berlaku ke DUA arah: ke depan (hari berjalan, `gamRange`) maupun ke belakang
  (`settledRange`, yang ikut melebar bersama `GAM_RANGE_DAYS`).
  **Yang paling gawat bukan kolom uangnya melainkan kolom Status**: "Iklan Belum Tayang"
  diputuskan dari impresi laporan yang sama, jadi lewat jendela tiga hari sebuah akun yang berhenti
  tayang dua hari lalu tetap berbunyi "Ready" karena satu impresi dari hari pertama rentang itu —
  masseffectstore.com, 3 Sep 2026. `settledRange` tetap ada untuk `reportRange()`, yaitu bawaan
  penemuan situs, di mana rentang yang lebar memang gunanya.
- Matikan seluruhnya dengan `SYNC_INCLUDE_TODAY=0`; sisa baris hari berjalan ikut dibuang sendiri.

### Tabel Overview memuat satu baris per SYNC, dan baris itu kumulatif

Baris harian (`dashboard/roiReports/{tanggal}__{subdomainId}`) ditimpa tiap sync, jadi jejak hari
berjalan hilang: pukul 09:00 ROI 40%, pukul 15:00 ROI 180%, dan yang pertama tidak tersimpan di mana
pun. Karena itu hari berjalan **juga** ditulis ke
`dashboard/roiSnapshots/{tanggal}T{jam}__{subdomainId}` — satu baris per sync, masa simpan
`ROI_SNAPSHOT_DAYS` (default 3 hari) — dan itulah isi tabel **"Laporan ROI Realtime"**.

**Snapshot tinggal di pohonnya sendiri, dan itu bukan kerapian.** Laporan GAM maupun Meta selalu
untuk hari penuh, jadi baris pukul 15:00 memuat seluruh hari sampai pukul 15:00 — kumulatif, bukan
per jam. Satu penjumlah yang memakannya (grafik Overview, `realizedEarning` di Targets) akan
melaporkan pendapatan berkali lipat untuk hari yang sama. Yang menjumlahkan uang membaca
`roiReports`; yang menampilkan keadaan membaca `roiSnapshots`. Yang benar-benar per jam hanya kolom
`Fluk.`, dan untuk baris snapshot pembandingnya adalah **snapshot sebelumnya di hari yang sama**
(bukan kemarin, seperti baris harian).

Sisi UI menggabungkan keduanya di [`src/lib/roiRealtime.js`](src/lib/roiRealtime.js): snapshot dulu,
lalu baris harian untuk hari + subdomain yang tidak punya snapshot (hari yang lewat masa simpan
snapshot, dan hari sebelum fitur ini ada). Baris harian hari yang sama dibuang — ia salinan sync
terakhir, dan dua baris kembar terbaca sebagai dua kejadian.

**DUA panel menggambar tabel itu, dan keduanya memakai SATU komponen**
([`src/components/ui/RealtimeRoiTable.jsx`](src/components/ui/RealtimeRoiTable.jsx), barisnya
dinormalkan `normalizeRealtimeRoiRow` di `roiRealtime.js`): "Laporan ROI Realtime" di Overview dan
"Report Master Realtime ROI Khusus Anda" di `/users/{uid}`. Yang berbeda cuma BARIS yang dioper
pemanggilnya — seluruh armada di satu sisi, subdomain yang dipegang orang itu di sisi lain — dan
`countryBreakdown`-nya, yang di kedua tempat dikumpulkan dari SELURUH user lewat `countryRoiSources`
(baris negara dimiliki lewat PIC subdomain, jadi subdomain yang baru berpindah tangan masih
meninggalkan baris hari itu di user sebelumnya).

- **Ditulis dua kali, keduanya berselisih tanpa berbunyi sebagai kesalahan apa pun.** Sampai
  komponen ini ada, tabel di profil user kehilangan **Fluk. Spend**, **Fluk. Earn**, **Fluk. ROI**,
  **Profit**, **Negara**, dan **META BAL.** — plus kepala kelompok berwarna yang memisahkan sisi
  Meta dari sisi earning, dan catatan "belum diperbarui" untuk baris `gamStale`. Tidak ada satu pun
  pesan yang menyebutkan kolomnya ADA di halaman sebelah; yang terlihat cuma tabel yang lebih
  pendek daripada tabel yang namanya menjanjikan hal yang sama.
- **Kunci kolom eCPM-nya `pageRpm` di kedua tabel.** Dua penormal memakai dua kunci (`ecpm` di
  satu, `pageRpm` di satunya), dan yang membaca kunci barisnya adalah PENGURUTAN kolom — kepala
  kolom yang diklik lalu tidak mengubah apa pun, tanpa error di mana pun.
- Yang TIDAK ikut ke komponen ini adalah pemilih periode dan penyaring subdomain di kepala panel:
  keduanya milik halamannya, dan alamat parameternya memang berbeda (`?roi=` di Overview,
  `?master=` + `?masterSub=` di profil user).

Rentangnya diminta ke tiap API **sekali**, dengan `DATE` sebagai dimensi pertama — bukan satu laporan
per hari. Laporan GAM adalah job asinkron yang di-poll sampai satu menit per network, dan run yang
menembakkannya dua kali tidak selesai dalam batas 9 menit Cloud Functions.

Tanggal di RTDB memakai zona operasi, bukan UTC: `zonedDateKey()`, bukan `toISOString().slice(0,10)`.

**Network GAM yang zonanya bukan WIB dilaporkan per JAM, lalu dipetakan ke hari WIB** (`fetchRows`
+ `rekeyToSyncDays` di [`functions/gam.js`](functions/gam.js)). Laporan GAM selalu dalam zona
network — sheetz.us/theglobesimregistration.ph/psaonlineappointment.com `Asia/Karachi` (−2 jam),
bispdailyupdates.pk `America/Los_Angeles` (−14 jam) — jadi "hari ini" versi network berjalan jam-jam
di belakang belanja Meta di baris yang sama, dan untuk LA hari WIB baru muncul lewat pukul 14:00.
- **Meminta WIB langsung DITOLAK** (`timeZoneSource: PROVIDED` → `REPORT_ERROR_CONSTRAINTS_INCOMPATIBILITY`
  untuk metrik Ad Exchange, 22 Sep 2026); `HOUR` diterima. Tiap jam network adalah titik waktu pasti,
  jadi tidak ada snapshot atau selisih kumulatif yang perlu dihitung — tetap SATU laporan per network.
- Rentangnya diminta sehari lebih lebar di kedua ujung, jam di luar hari WIB dibuang, dan keluarannya
  berbentuk sama persis dengan laporan biasa (`DATE` WIB di depan): hilirnya tidak tahu apa pun.
- **`AD_SERVER_REVENUE` tidak bisa digabung dengan `HOUR`** dan dijawab 0 di laporan per jam
  (`NOT_HOURLY`) — aman selama network itu tidak punya pendapatan Ad Server (Rp 0 April–Sep 2026).
- **AdSense TIDAK ikut**: API-nya tidak punya dimensi `HOUR` dan zonanya tidak bisa diminta lain, jadi
  akun AdSense ber-zona Karachi tetap memakai hari akunnya (selisih 2 jam atas ~US$1/hari).
- Baris lama tidak ditulis ulang sendiri; `migrate:roi-earning` untuk rentang yang perlu.

### Kalender laporan: satu petak per hari, dan "potensi" yang tahu diri

Tab **Kalender** (`/dashboard/kalender`) menampilkan sebulan sekaligus: tiap petak memuat ROI hari
itu, belanja → pendapatan, dan chip yang menuntut tindakan. Aturannya di
[`src/lib/calendarReport.js`](src/lib/calendarReport.js).

- **Sumbernya `roiReports` (baris harian), bukan `roiSnapshots`.** Alasan yang sama dengan grafik:
  baris snapshot kumulatif sejak tengah malam, dan yang menjumlahkannya per hari melipatgandakan
  pendapatan.
- **"Tidak diketahui bukan nol" berlaku juga di tingkat HARI.** Hari yang seluruh laporan
  earning-nya gagal berjumlah 0, dan 0 dibagi spend yang nyata berbunyi "ROI −100%" — tak
  terbedakan dari hari yang benar-benar rugi total. Hari tanpa satu pun baris berearning
  mengembalikan `""`, dan yang dilewati DIHITUNG (`earningUnknown`, `unmapped`, `unavailable`) lalu
  jadi chip peringatan di petaknya, karena tiap sebab diperbaiki di tempat yang berbeda: earning
  yang gagal di sisi sync, `unmapped` di /sub-domains → Edit, `unavailable` di sisi sync lagi, dan
  baris tanpa `metaMissing` sama sekali (ditulis sync versi lama) tidak bisa diperbaiki siapa pun.
  **Lencananya menghitung SUBDOMAIN (`incompleteSubDomains`), bukan sebab**: dijumlahkan dari
  `earningUnknown + spendUnknown`, subdomain yang kehilangan keduanya terhitung dua kali — dan "⚠ 2"
  untuk satu subdomain bermasalah mengirim orang mencari baris yang tidak ada.
- **Potensi = MEDIAN hari-dalam-minggu yang sama, minimal 4 sampel, dan HANYA untuk hari ini ke
  depan.** Median karena satu hari anomali menggeser rata-rata dan tidak pernah kembali. Empat
  sampel karena angka bernama "biasanya" yang lahir dari dua hari cuma tebakan yang memakai huruf
  yang sama. Hanya untuk hari ini ke depan karena hari lampau sudah punya angka nyata, dan dua angka
  berdampingan di petak yang sama akan dibaca sebagai vonis. Hari `partial` tidak pernah jadi
  sampel — setengah hari yang dibandingkan dengan hari penuh.
- **TIDAK ada proyeksi akhir hari dari bentuk kurva intraday.** Bahannya cuma `roiSnapshots`, yang
  masa simpannya 3 hari — dua hari penuh sebagai sampel — dan tebakan yang digambar sebesar angka
  nyata di petak yang sama adalah kebohongan yang tenang. Potensi digambar miring, pucat, berlabel.
- **Tiga hari ber-ROI tertinggi bulan itu diberi garis emas/perak/perunggu** (`roiRanking`). Hanya
  hari MILIK bulan yang sedang digambar — medali untuk 31 Juli di halaman Agustus adalah peringkat
  dari lomba yang tidak sedang berlangsung — dan hanya hari yang ROI-nya sah; lantai belanja di
  `roiPercent` yang membuat peringkat ini bisa dipercaya sama sekali, karena tanpanya yang menang
  selalu hari yang membelanjakan Rp 43. Hari berjalan IKUT diperingkat: ROI-nya rasio yang sah walau
  harinya belum selesai, dan petaknya sudah menyebut "berjalan" tepat di sebelah medalinya. Yang
  berubah cuma garisnya, dipertebal lewat `box-shadow: inset` dan bukan `border-width`, supaya petak
  berperingkat tidak bergeser sepiksel pun terhadap tetangganya. Warnanya logam, bukan hijau
  berjenjang: hijau sudah berarti "untung" di seluruh dashboard ini.
- **Petak memuat empat baris, dan itu batasnya.** Peringkat subdomain, rincian sumber earning, dan
  belanja per advertiser tinggal di panel rincian — "sekilas" adalah satu-satunya hal yang bisa
  diberikan kalender dan tidak bisa diberikan tabel.
- **Panel rincian berdiri DI SEBELAH KANAN kalender.** Di bawahnya, ia mendorong petak-petak keluar
  dari layar pertama: begitu sebuah tanggal diklik, yang tidak terlihat lagi justru tanggal-tanggal
  lain — padahal membandingkan satu hari dengan tetangganya adalah satu-satunya hal yang bisa
  diberikan kalender. Kolomnya 320px dan TETAP; kalendernya yang mengalah. Di bawah 1180px keduanya
  kembali bertumpuk.
- **Ini satu-satunya halaman yang TIDAK menggulir sebagai halaman**, dan tingginya DIUKUR
  ([`useFillViewport`](src/hooks/useFillViewport.js)), bukan dihitung. Halaman yang digulir untuk
  melihat minggu terakhir menaikkan panel rincian bersamanya, dan angka yang sedang dibaca
  kehilangan tanggal yang menjelaskannya — jadi yang menggulir adalah kolom kanannya sendiri.
  - **`calc(100dvh - 168px)` ditolak**: ia menuntut daftar tinggi segala yang berdiri di atasnya
    (topbar, tab, judul halaman, jaraknya), dan daftar itu meleset pada hari seseorang menambah
    satu baris di antaranya — tanpa berbunyi sebagai kesalahan apa pun. Yang diukur adalah jarak
    elemen dari puncak DOKUMEN (`rect.top + scrollY`, bukan dari puncak viewport yang bergeser
    mengikuti gulungan), dan satu-satunya angka yang tersisa adalah padding bawah `.content`.
  - **`align-items: stretch` HANYA saat tingginya benar-benar terpasang** (`.is-locked`). Tanpa
    tinggi pasti, "stretch" berarti setinggi kolom TERTINGGI: panel kanan setinggi 18 subdomain
    membuat tiap petak jadi 345px — persis kebalikan dari yang fitur ini ada untuk melakukannya.
  - **Petaknya berbagi sisa tinggi** (`grid-auto-rows: minmax(92px, 1fr)`) dengan LANTAI setinggi
    isi terpadatnya; petak `overflow: hidden` yang menyusut di bawah itu memotong angka tanpa
    memberi tahu siapa pun. Begitu lantainya tercapai, yang menggulir adalah petak-petaknya di
    dalam panel.
  - **Titik putus dua-kolomnya dibaca dari CSS-nya sendiri** (`gridTemplateColumns` yang benar-benar
    terpakai), bukan disalin sebagai angka kedua di JS: satu `@media` yang digeser suatu hari akan
    meninggalkan tinggi terkunci pada layout yang sudah bertumpuk.
- **Daftar subdomain di panel itu KARTU, bukan tabel.** Enam kolom di lebar 320px berarti tiap
  kolom memuat dua kata dan seluruh angkanya membungkus. Tiap kartu: nama + ROI, lalu spend →
  earning → profit, lalu batang proporsi belanja terhadap pembelanja terbesar hari itu (terhadap
  TOTAL hari, seluruh batang jadi sliver di hari yang belanjanya menyebar rata). Baris yang
  spend-nya tidak diketahui tidak menggambar batang sama sekali melainkan `MetaSpendNote` yang
  sama dengan tabel ROI — batang selebar nol adalah klaim bahwa uangnya tidak keluar.
- **Panel dipasang ulang tiap ganti tanggal (`key` = kunci harinya), supaya animasi masuknya
  berjalan lagi.** Yang cuma berganti angka di tempat tidak mengabarkan apa pun kepada orang yang
  baru saja mengklik tanggal lain. Jeda berurutan tiap kartu dipasang sebagai `animationDelay`
  inline — ia turunan dari POSISI baris, bukan nilai tema, dan `styles.theme.test.mjs` menolak
  `var()` ke apa pun yang bukan token. Semua geraknya mati di bawah `prefers-reduced-motion`.
- **Reminder berdiri pada TANGGAL jatuh temponya, bukan lewat `dueReminders`.** Yang itu menjawab
  "apa yang perlu diperhatikan sekarang" dan membawa serta yang sudah lewat; sebuah pengingat yang
  muncul di tiga petak sekaligus tidak lagi menjawab "kapan".
- **Pengeluaran hari itu hanya digambar untuk yang boleh membaca `expenses`.** Store tidak
  melanggan node itu untuk role lain, jadi panelnya akan selalu berbunyi Rp 0 — nol yang lahir dari
  izin baca, alasan yang sama persis yang menutup halaman Laba Rugi.
- **"Hari ini" di kalender adalah hari OPERASI, dibaca dari baris bertanda `partial`**
  (`runningDayKey` di [`src/lib/dateRange.js`](src/lib/dateRange.js), diberikan ke
  `buildCalendarMonth` sebagai `today`) — bukan tanggal di jam browser. Yang bergeser bersamanya
  bukan cuma petak yang bertanda hari ini melainkan batas "potensi" (hari lampau tidak
  menggambarnya) dan hari yang tidak boleh jadi sampel median; browser di zona lain, atau tab yang
  dibiarkan terbuka melewati tengah malam sebelum sync berikutnya jalan, menandai hari yang berbeda
  dari yang ditandai sisi sync. Dibaca dari `roiReports` yang BELUM disaring: hari yang sedang
  berjalan adalah keadaan usaha, bukan turunan dari filter — memilih advertiser yang kebetulan tidak
  punya baris hari ini tidak boleh memindahkan "hari ini" ke kemarin. Tanpa satu pun baris berjalan,
  jam browser yang dipakai; di situ memang tidak ada hari operasi untuk ditanyakan.
- **Bulan dan tanggal terpilih tinggal di alamat** (`?bulan=`, `?tanggal=`), dan tanggal yang
  bukan milik bulan yang sedang digambar jatuh kembali ke hari ini — panel yang menampilkan hari
  yang tidak ada di layar tidak bisa ditutup siapa pun.
- **Penyempit advertiser/domain/subdomain memakai state yang SAMA dengan tab Grafik**
  (`?advertiser=`, `?domain=`, `?subdomain=`), lewat `OwnerFilterFields` yang dipakai kedua
  dialognya. Keduanya tab berbeda, jadi hanya satu yang pernah tergambar sekaligus, dan perpindahan
  halaman tidak membawa query. Yang penting dari komponen bersamanya bukan ketiga `<select>`-nya
  melainkan ATURAN di antaranya — memilih advertiser atau domain mengosongkan subdomain; disalin,
  salah satu tab akan lupa dan menghasilkan dua filter yang saling meniadakan.
- **Reminder tidak ikut disaring.** Sewa server dan perpanjangan domain tidak dimiliki advertiser
  mana pun, jadi tidak ada aturan kepemilikan yang bisa menyaringnya — dan menyembunyikannya saat
  sebuah nama dipilih berarti tagihan yang jatuh tempo hilang dari layar orang yang kebetulan
  sedang menyaring.

## Saklar on/off campaign: niat dulu, Meta belakangan

Tombol di `/users/{uid}` **tidak** memanggil Meta. Ia menulis niat ke
`users/{uid}/campaignCommands/{campaignId}`, dan yang memanggil Meta adalah
[`applyCampaignCommands`](functions/campaign-commands.mjs) — dijalankan `scheduledCampaignCommands`
tiap 2 menit, callable `setCampaignStatus`, atau CLI. DRS memblokir `allUsers`, jadi antrean di RTDB
adalah satu-satunya jalur yang bekerja tanpa itu dilonggarkan; callable hanya mempercepat, tidak
mengubah hasil.

- **Bentuk perintahnya ada di dua tempat dan harus sama persis**: `campaignCommandEntry` di
  [`functions/sync-core.js`](functions/sync-core.js) dan di
  [`src/lib/campaignCommands.js`](src/lib/campaignCommands.js). Beda sedikit, perintahnya lolos
  aturan database tapi tidak pernah dieksekusi siapa pun.
- **`configuredStatus` ≠ `status`.** Yang pertama adalah posisi saklar (`status` milik Meta,
  ACTIVE/PAUSED); yang kedua label kolom Status. Tombol yang membaca label akan tampak mati untuk
  campaign yang jadwalnya belum sampai — padahal tidak ada yang mematikannya.
- **Label kolom Status ada TIGA, dan ketiganya sepakat dengan saklar**: saklar On berbunyi
  **Aktif** atau **Terjadwal**, saklar Off berbunyi **Tidak aktif**. Diturunkan
  `campaignStatusLabel` di [`functions/sync-core.js`](functions/sync-core.js) dari `status` milik
  Meta — POSISI SAKLARNYA — bukan lagi dari `effective_status`, yang menyebar campaign bersaklar
  On ke "Review" dan "Limit": dua kata yang tidak menerangkan saklarnya dan tidak menuntut tindakan
  siapa pun di halaman ini. **Konsekuensinya diketahui dan diterima**: campaign yang ditahan Meta
  (review, izin tagihan) dan campaign yang seluruh ad set-nya jeda sekarang berbunyi "Aktif", sama
  dengan yang benar-benar tayang, dan yang membedakannya tinggal Ads Manager. `effective_status`
  tetap diminta — `ARCHIVED_STATUS` di [`functions/sync-meta.mjs`](functions/sync-meta.mjs), yang
  menahan campaign terarsip supaya tidak masuk tabel sama sekali, masih membacanya.
- **"Terjadwal" TIDAK ada di Meta sebagai status, dan itu yang membuatnya butuh field sendiri.**
  Campaign yang mulai tayang pekan depan berstatus `ACTIVE` dan efektif `ACTIVE` juga — persis sama
  dengan yang sedang membelanjakan uang hari ini. Yang membedakannya cuma `start_time`, dan itulah
  yang dibaca kolom Delivery di Ads Manager; `fetchCampaignSettings` memintanya, barisnya
  menyimpannya sebagai `startTime`, dan kolom Status menyebut tanggalnya di bawah pilnya — pil
  "Terjadwal" yang tidak menyebut KAPAN cuma memindahkan pertanyaannya ke Ads Manager.
  - **Yang memutuskan labelnya sisi SYNC, bukan browser.** "Besok" versi tab yang dibiarkan terbuka
    semalaman adalah hari yang berbeda, dan dua tempat yang memutuskan hal yang sama akan
    berselisih suatu hari. Browser cuma membaca `startTime` untuk menyebut tanggalnya.
  - **Jadwal yang kosong atau tidak terurai jatuh ke "Aktif".** Campaign tanpa jadwal memang tayang
    sekarang; menebak "Terjadwal" dari ketiadaan berarti seluruh armada berbunyi terjadwal pada
    hari Meta berhenti mengirimkan field itu. Meta menulis offsetnya tanpa titik dua
    (`+0700`) — bentuk di luar ISO 8601 yang diurai tiap mesin JS dengan pengurai warisannya
    sendiri, dan yang gagal menjawab `NaN` alih-alih melempar — jadi titik duanya disisipkan dulu.
  - **Nadanya BIRU, bukan kuning.** Tidak ada yang tertahan dan tidak ada yang perlu dikerjakan,
    cuma tanggal yang belum sampai; kuning akan berdiri di kolom yang sama dengan campaign yang
    benar-benar bermasalah, dan yang membacanya akan mengejar sesuatu yang tidak ada.
  - **Perintah saklar yang baru diterapkan menulis "Aktif", bukan "Terjadwal"** — penerapnya tidak
    punya `startTime`. Itu bukan tebakan yang menyamar: barisnya membawa `statusAppliedAt`, dan
    kolom Status memang menyebut "status akhir menyusul saat sync" di bawah pilnya. Penyegaran dua
    menitan yang membetulkannya.
- **Posisi yang tidak diketahui bukan "mati".** Baris tanpa `campaignId` (disync sebelum fitur ini,
  atau diturunkan dari laporan ROI) tidak punya alamat di Meta: tombolnya dimatikan berikut alasannya,
  bukan digambar mati.
- **Jalur cepatnya server sendiri** (`server/`, Bun + Elysia), yang juga menggantikan
  `scheduledCampaignCommands`. `POST /campaigns/:id/status` memanggil `applyOneCampaignCommand` —
  modul yang sama dengan cron dan callable — dan mencari campaign-nya di baris user yang dituju,
  bukan mempercayainya dari request. Antrean RTDB tetap jadi cadangan otomatis.
- **Arahnya dua, dan keduanya cepat.** Yang keluar adalah antrean di atas; yang masuk adalah
  `refreshCampaignStatuses` — satu bacaan `fetchCampaignSettings` per ad account, tanpa insights,
  menumpang jadwal dua menit yang sama dan dijalankan **sebelum** penerap saklar (kalau sesudah,
  perintah yang baru dieksekusi tertimpa bacaan Meta yang lebih tua darinya). Campaign yang
  dimatikan orang langsung di Ads Manager tidak lewat antrean mana pun, dan sync penuh baru jalan
  sejam lagi — sampai penyegaran ini ada, tabelnya menulis "Aktif" untuk campaign yang sudah
  berhenti.
- Hak aksesnya admin **atau pemilik campaign**, dicocokkan lewat email karena `/users` dikunci
  push-key. `canToggleCampaign` di [`src/config/access.js`](src/config/access.js) dan aturan
  `users/$uid/campaignCommands` di `database.rules.json` adalah cerminan satu sama lain.

### Ad set: dibaca saat diklik, tidak pernah dicerminkan

Tiap baris di "Manajemen Kampanye" bisa dibuka, dan isinya ad set campaign itu berikut status,
anggaran, dan angkanya hari ini ([`CampaignAdSets.jsx`](src/components/CampaignAdSets.jsx), lewat
`GET /campaigns/:id/adsets` di [`server/campaigns.js`](server/campaigns.js)). Ia menjawab dua
pertanyaan yang tidak bisa dijawab tingkat campaign: ad set mana yang membakar anggarannya, dan
kenapa campaign bersaklar On tidak mengeluarkan uang.

- **TIDAK ada di RTDB, dan itu ukurannya.** Satu ad account memuat 960 ad set atas 134 campaign
  (TBZ 1247, diukur 7 Sep 2026), jadi mencerminkan armada tiap jam berarti belasan ribu baris
  ditulis ulang ke node yang sudah memuat `campaigns` + `campaignHistory` + `dailySpend` +
  `balanceSnapshots`, untuk panel yang dibuka sesekali. Yang dicari orang di sini keadaan pada
  detik ini; cermin sejam lalu justru jawaban yang salah. Konsekuensinya diketahui: tanpa server
  kontrol panelnya tidak bisa dibuka sama sekali — tidak ada antrean yang bisa menggantikan
  pembacaan, sepola `/plugin` — dan yang digambar adalah sebabnya, bukan tabel kosong yang terbaca
  seperti campaign tanpa ad set.
- **Dua panggilan, dan yang kedua boleh gagal sendirian.** `fetchAdSets` (setelan + status) dan
  `fetchAdSetInsights` (angkanya). Insights yang gagal TIDAK menjatuhkan panel: daftar ad set
  berikut status dan anggarannya sudah di tangan, dan itu setengah dari yang dicari orang. Yang
  membedakannya `metricsKnown: false` — seluruh kolom angka kosong, bukan nol.
- **"Tidak tayang" dan "tidak terbaca" adalah dua keadaan, dan keduanya kosong kalau dilebur.**
  Meta tidak mengirim baris insights untuk ad set yang tidak tayang sama sekali; laporannya
  BERHASIL, jadi ketiadaan barisnya adalah jawaban Meta dan nol di sana benar — aturan yang sama
  dengan spend `0` yang nyata di baris ROI. Yang menjawab `""` cuma panggilan yang gagal. Dilebur,
  panel melaporkan "Rp 0" untuk campaign yang laporannya tidak pernah datang. Yang tetap kosong
  walau laporannya berhasil adalah yang butuh pembagi (CTR, CPC, CPM, biaya/hasil): "CTR 0%" adalah
  pernyataan tentang iklan yang pernah dilihat orang.
- **Label statusnya lewat `campaignStatusLabel` yang SAMA dengan baris campaign** — "Aktif" /
  "Terjadwal" / "Tidak aktif", dari POSISI SAKLAR ad set-nya sendiri. Ditulis ulang, panel ini akan
  berbunyi "Paused" untuk keadaan yang di baris tepat di atasnya berbunyi "Tidak aktif". Nada
  warnanya pun satu tempat ([`src/lib/campaignTone.js`](src/lib/campaignTone.js), pindah dari
  UserDetail.jsx): dua peta warna untuk satu kosakata berarti pil "Terjadwal" biru di satu baris
  dan hijau di baris di bawahnya.
- **STATUSNYA PUNYA LABEL KEEMPAT: "Tidak ditayangkan", dan itu satu-satunya yang
  merah.** Ia pengecualian yang disengaja dari aturan "label = posisi saklar" yang berlaku di tabel
  campaign: di sana keadaan yang ditahan Meta sengaja dilebur ke "Aktif" karena tidak ada tindakan
  yang dituntutnya di halaman itu, sementara panel ini justru dibuka orang untuk mencari tahu KENAPA
  uangnya tidak keluar. Kata-katanya diambil dari kolom Penayangan Ads Manager supaya bisa diadu
  tanpa menerjemahkan apa pun di kepala, dan karena itu ia TIDAK menyebut ulang posisi saklarnya —
  yang membedakannya dari "Tidak aktif" adalah pil itu memang bukan yang tergambar, dan yang
  menyebut sebabnya kalimat di bawahnya.
  - **Sumbernya IKLAN di dalam ad set, dan itu tidak ada di satu pun field ad set.** Campaign
    RNPX-01 (Godek, act_3100918953544891, dibaca 7 Sep 2026) memperlihatkannya utuh: 5 ad set
    berstatus ACTIVE **dan efektif ACTIVE juga**, tiga di antaranya beriklan `ACTIVE` dan masih
    berimpresi pukul 14:00, dua sisanya beriklan `DISAPPROVED` dan berhenti sejak pukul 02:00 dan
    09:00 — pembagian 3/2 yang persis dibaca operatornya di Ads Manager. `fetchCampaignAds` meminta
    seluruh iklan campaign itu SEKALI (edge `{campaign_id}/ads`, bukan per ad set: 10 ad set berarti
    10 panggilan, dan bentuk request seperti itulah yang membuat sebuah app dicap anomali).
  - **`status` iklan tetap ACTIVE walau Meta sudah menolaknya** — yang dibaca `effective_status`,
    dan hanya `ACTIVE` yang dihitung bisa tayang. Daftar putih, bukan daftar hitam: daftar hitam
    yang meleset DIAM untuk ad set yang benar-benar berhenti, dan diam di sini adalah persis
    kegagalan yang fitur ini ada untuk menghapusnya.
  - **Sumber KEDUA: keadaan efektif ad set itu sendiri** (`DISAPPROVED`, `PENDING_REVIEW`,
    `WITH_ISSUES`, `PENDING_BILLING_INFO`). Yang ini gratis; yang pertama menuntut satu panggilan
    lagi. Keduanya perlu — tanpa yang pertama, dua dari lima ad set RNPX-01 berbunyi "Aktif".
  - **Daftar iklan yang GAGAL dibaca tidak memvonis siapa pun** (`ads: null`, `adsKnown: false`) —
    bukan disimpulkan sebagai "tidak punya iklan", sepola earning yang tidak diketahui yang tidak
    pernah dinilai nol. Gagalnya juga tidak menjatuhkan panel: kolom angkanya tetap terisi.
  - **TIGA yang sengaja TIDAK ikut merah.** `CAMPAIGN_PAUSED` (sebabnya berdiri di baris tepat di
    atasnya yang sudah berbunyi "Tidak aktif" — mewarnai merah seluruh ad set milik campaign yang
    memang sedang dimatikan orang menghapus arti merahnya), "Terjadwal" (belum waktunya tayang,
    bukan kegagalan), dan saklar Off.
  - **Pilnya menyebut SEBABNYA di bawahnya**, karena ketiganya diperbaiki di tempat yang berbeda:
    iklan yang ditolak lewat banding, iklan yang dimatikan lewat saklarnya sendiri, ad set tanpa
    iklan dengan membuatkan iklannya. Yang disebut adalah penahan TERBANYAK berikut porsinya
    ("2 dari 3 iklannya dimatikan") — menyebut semuanya menghasilkan kalimat sepanjang barisnya
    sendiri, menyebut satu tanpa angka menyembunyikan bahwa yang harus dibanding ada lima.
  - **Kepala panel menghitungnya terpisah** ("5 saklar On · 2 tidak ditayangkan"), karena itu
    persis bentuk pertanyaannya — dan tanpa angka itu satu-satunya cara mengetahuinya adalah
    membaca kesepuluh pil satu per satu.
  - Nada merahnya dari `getCampaignTone` yang sama, dicocokkan pada kata "tidak ditayangkan" SEBELUM
    "aktif" — labelnya diawali kata itu, dan pemeriksaan yang terbalik menelannya jadi hijau tanpa
    berbunyi sebagai kesalahan di mana pun. Dijaga `src/lib/campaignTone.test.mjs`.
- **`effective_status` DIMINTA di sini, berbeda dari baris campaign yang membuangnya.** Di tingkat
  ini ia membawa satu keadaan yang tidak bisa dibaca dari kolom mana pun: `CAMPAIGN_PAUSED` — ad
  set yang saklarnya sendiri On sementara campaign di atasnya mati. Itulah jawaban atas "kenapa ad
  set ini Aktif tapi Rp 0", dan tanpa penanda `pausedByCampaign` yang terlihat cuma nolnya. Yang
  TIDAK ikut berubah adalah labelnya: pilnya tetap "Aktif", karena itu posisi saklarnya sendiri.
- **Hasil di sini EKSAK, dan itu satu-satunya tempat di dashboard yang begitu.**
  `fetchCampaignResultGoals` harus memungut suara — satu campaign bisa memuat sepuluh ad set
  beroptimasi berbeda dan kolomnya cuma satu. Di panel ini tiap ad set membawa tujuannya sendiri
  (`adSetGoals` di [`functions/adsets-core.js`](functions/adsets-core.js)), jadi tidak ada yang
  kalah suara.
- **Anggaran yang kosong punya DUA arti, dan keterangan di bawahnya yang membedakan.** Pada
  campaign CBO, Meta tidak mengirim `daily_budget` maupun `lifetime_budget` untuk ad set-nya sama
  sekali — `budgetLevel` diturunkan dari ADA-TIDAKNYA angka itu, bukan dari setelan yang bisa
  ditanyakan.
- **Periodenya HARI INI**, sama dengan tabel induknya yang memang LIVE. Riwayat per hari sudah
  punya tempatnya sendiri di "Riwayat Spend Campaign"; dua periode berbeda di satu layar cuma akan
  diadu orang.
- **Gerbangnya `requireUser`, BUKAN `mayToggleCampaign`.** Ini pembacaan, dan baris campaign
  induknya sudah terbaca setiap akun yang login (`users` ber-`.read: auth != null`); gerbang yang
  lebih ketat cuma menutup panel di halaman yang tabelnya sendiri terbuka. Yang tetap dijaga adalah
  ALAMAT META-nya: `campaignRowOf` mencari campaign itu di baris profil yang dituju, sama dengan
  endpoint saklar — tanpa itu, endpoint ini jadi pembaca Meta untuk campaign mana pun di Business
  Manager, cukup dengan mengoper ID milik ad account orang lain.
- **Cerminnya DUA MENIT, di dalam tab yang sedang terbuka** ([`adSetCache.js`](src/lib/adSetCache.js)).
  Tanpa itu, orang yang membandingkan tiga campaign menembakkan dua panggilan Meta tiap kali sebuah
  baris dibuka ulang — dan yang dibayar bukan cuma tunggu ~2 detik: pemakaian API dihitung per app,
  dan yang membuat sebuah app dicap anomali adalah BENTUKNYA, yaitu request yang meletus berulang
  karena tombolnya diklik lagi. Permintaan yang bersamaan untuk campaign yang sama digabung jadi
  satu, dan yang GAGAL tidak pernah ikut tersimpan — kegagalan yang dicermin akan menjawab error
  yang sama selama dua menit walau Meta sudah pulih sedetik kemudian.
  - **Dua menit karena itu jarak penyegaran status campaign di tabel induknya.** Angka ad set tidak
    boleh mengaku lebih segar daripada baris tepat di atasnya. Lebih panjang dari itu mengembalikan
    persis masalah yang membuat ad set tidak dicerminkan ke RTDB sejak awal.
  - **TIDAK di localStorage.** Yang tersimpan di sana melewati penutupan tab, dan panel yang dibuka
    besok pagi akan menggambar angka kemarin sore sebelum sempat menyebutkan umurnya.
  - **Umurnya DISEBUTKAN di kepala panel** ("Dibaca baru saja" / "2 menit lalu"), dan tombol
    Segarkan melewatinya. Itu syarat cerminnya boleh ada sama sekali: panel ini menjanjikan keadaan
    sekarang, dan angka dari pembacaan dua menit lalu tanpa satu pun tanda umur tidak bisa dibedakan
    dari angka yang baru diambil. Penyegaran yang GAGAL tidak mengosongkan panel — angka lamanya
    tetap digambar, dengan sebab dan umurnya di atasnya.
  - **Saklar campaign yang disentuh MEMBUANG cerminnya** (`setCampaignStatus` di
    [`useFirebaseStore.js`](src/hooks/useFirebaseStore.js)): mematikan campaign mengubah
    `effective_status` SETIAP ad set-nya, dan panel yang menjawab dari cermin akan menerangkan Rp 0
    dengan sebab yang sudah tidak berlaku.
- **Baris yang sedang dibuka tinggal di ALAMAT** (`?adset=`), `replace` bukan `push`: ia membuka
  isi di dalam halaman yang sama, jadi Back yang menutupnya satu per satu akan berubah jadi tombol
  "tutup panel". Baris tanpa `campaignId` tombolnya dimatikan berikut alasannya — sepola saklar di
  kolom Status, bukan tombol yang gagal setelah diklik.
- **Saklar on/off per ad set ADA, dan ia tulisan KEDUA ke Meta di seluruh dashboard ini**
  (`setAdSetStatus`, `POST /campaigns/:id/adsets/:adSetId/status`). Izinnya sudah terbukti ke API
  produksi (7 Sep 2026) dengan tulisan yang tidak mengubah apa pun: `PAUSED` ke ad set yang memang
  sudah `PAUSED`.
  - **TIGA hal yang membedakannya dari saklar campaign, dan ketiganya disengaja.** Pertama, **tidak
    ada antrean RTDB sebagai cadangan**: baris campaign dicerminkan di RTDB sehingga cron bisa
    mengurasnya, sementara ad set tidak dicerminkan sama sekali — tidak ada baris untuk ditandai
    "menunggu", dan panelnya sendiri memang tidak bisa dibuka kalau server kontrol mati. Polanya
    `/plugin`: server mati = saklarnya tidak ada, bukan saklar yang diam-diam mengantre. Kedua,
    **ad set-nya dibuktikan milik campaign yang dituju**, dibaca ulang dari Meta dan bukan dipercaya
    dari request — `campaignRowOf` cuma membuktikan CAMPAIGN-nya milik orang itu, dan tanpa
    pemeriksaan kedua, ID ad set yang dioper bisa milik ad account mana pun di Business Manager.
    Ketiga, **izinnya `mayToggleCampaign`, bukan `requireUser`** seperti gerbang baca panelnya: yang
    boleh membaca jauh lebih banyak daripada yang boleh mematikan.
  - **Sesudah berhasil, panelnya DIBACA ULANG — bukan ditambal di layar.** Label statusnya
    diputuskan sisi server (`mergeAdSetRows`), dan menambalnya di browser berarti menyalin keputusan
    itu ke tempat kedua. Cerminnya dibuang lebih dulu supaya pembacaan itu benar-benar ke Meta.
  - **Kalimat penolakannya sama PERSIS dengan saklar campaign** ("Hanya admin atau pemilik campaign
    yang boleh mengubah status"): yang menjaga keduanya satu aturan, dan dua kalimat berbeda untuk
    satu penolakan membuat orang mengira ada dua izin yang berbeda.
  - **Posisinya dari `configuredStatus`, bukan dari labelnya** — sama dengan saklar campaign, dan di
    sini taruhannya lebih terlihat: label bisa berbunyi "Tidak ditayangkan" untuk ad set yang
    saklarnya justru On, dan saklar yang membaca label akan tampak mati untuk sesuatu yang tidak ada
    yang mematikannya. Yang diarsipkan Meta digambar mati berikut sebabnya, bukan tombol yang pasti
    gagal.
  - **Yang TIDAK dijanjikannya**: menyalakan ad set yang iklannya ditolak tidak membuatnya tayang
    (pilnya tetap "Tidak ditayangkan" — yang menahannya bukan saklar ini), dan di campaign CBO
    mematikan satu ad set memindahkan anggarannya ke ad set lain, bukan menghematnya.

### Tab Terjadwal: jadwal tayang armada, supaya tidak menyala serentak

Tab **Terjadwal** di Overview (`/dashboard/terjadwal`) memuat ad set yang AKAN mulai tayang di
seluruh armada, berikut PIC-nya. Gunanya bukan anggaran melainkan server situs: iklan yang menyala
di jam yang sama mengirim lonjakan trafik berbayar ke hosting yang sebagian besar berbagi mesin.
Aturannya di [`functions/scheduled-launches-core.js`](functions/scheduled-launches-core.js) (mana
yang terjadwal) dan [`src/lib/scheduledLaunches.js`](src/lib/scheduledLaunches.js) (mana yang
bersamaan), route-nya `GET /scheduled-launches` di
[`server/scheduled-launches.js`](server/scheduled-launches.js).

- **Dibaca per AD ACCOUNT dari Meta, tidak dicerminkan** — alasan yang sama dengan panel ad set.
  Satu panggilan `act_…/adsets?effective_status=["ACTIVE"]` per akun, bukan per campaign (diadu ke
  produksi 17 Sep 2026: 14 akun, 216 ad set aktif, 10 terjadwal). Yang dilewati sama dengan sync:
  `deletedAt`, `syncDisabled`, tanpa `actId`.
- **Terjadwal = saklar ad set On, campaign On, dan `start_time` di masa depan.** Jadwal kosong atau
  tidak terurai TIDAK ditebak terjadwal, sepola `campaignStatusLabel`. "Campaign baru" vs "Ad set"
  dibaca dari `start_time` campaign (yang diisi Meta dari ad set paling awal).
- **Jamnya ditulis dua kali**: `startMs` (absolut, yang diadu) dan `startWib` (jam operasi tanpa
  zona, yang digambar). Diberikan dengan `+0700`, `formatDateTime` menggambarnya menurut jam
  PERANGKAT, dan dua advertiser di dua zona menyepakati "09:00" untuk dua saat berbeda.
- **Cermin BERSAMA dua menit di server**, bukan per tab: yang membukanya seluruh tim. Segarkan
  melewatinya tapi tidak lebih sering dari 30 detik; permintaan bersamaan berbagi satu pembacaan, dan
  yang gagal tidak dicermin.
- **Gerbangnya `requireUser`** — tujuannya justru tiap advertiser melihat jadwal rekannya.
- **Akun yang gagal dibaca DISEBUT** (`failedAccounts`): daftar yang kehilangan satu akun terbaca
  sebagai jam yang kosong.
- **Seluruh jadwal digambar, satu kartu per MENIT WIB** (`launchSlots`), dan kartu yang memuat dua
  campaign atau lebih bertanda `clash`: kuning, berlencana "n campaign mulai bersamaan", dan disebut
  lagi di peringatan DI ATAS daftar berikut jam dan PIC-nya — kartu kuning yang jatuh di bawah
  lipatan layar tidak terlihat oleh orang yang sedang memilih jam. "Bersamaan" berarti jam mulai
  yang SAMA PERSIS, bukan "berdekatan": jadwal yang masih berjeda, berapa pun kecilnya (00:59 lawan
  01:00 pun), sudah dipisahkan orangnya dengan sengaja, dan jendela 60 menit yang sempat dipakai
  menyalakan peringatan untuk hampir seluruh armada. Kartu biasa sengaja NETRAL, bukan hijau.
  Kuncinya `startWib` terpotong di menit — jam operasi, bukan detik Meta. Tiap campaign menyebut
  berapa dari ad set-nya yang mulai di menit itu. Server tetap menjawab per ad set.
- **Bentrok = menit yang sama DAN SERVER yang sama** (`sameServer`, `launchSlots(rows, { servers })`).
  Yang dijaga tab ini mesinnya, jadi dua situs di dua VPS berbeda yang menyala bersamaan berdiri di
  kartu yang sama tanpa tanda kuning, dan tombol Geser cuma digambar di campaign yang bentrok.
  - **Servernya dibaca dari record DNS Cloudflare** (`serverIndex`/`launchServers` di
    scheduled-launches-core.js): `content` A/AAAA adalah IP origin walau di-proxy, CNAME diikuti,
    wildcard jadi cadangan. BUKAN kolom "Server" di /gam-accounts — teks ketikan per AKUN, sementara
    subdomain satu akun bisa tinggal di mesin berbeda. Dibaca server kontrol bersama jadwalnya
    (satu cermin dua menit), dikirim sebagai `servers` (hostname → server) untuk seluruh
    `subDomains`; subdomain campaign dari `campaignIndexOf`.
  - **Server yang TIDAK DIKETAHUI dihitung SAMA** — subdomain tak terpetakan, tanpa record, atau
    Cloudflare gagal dibaca (`servers: null` + `serverError`, disebut di atas daftar; jadwalnya
    tetap tampil). Yang tidak bisa dibuktikan berbeda tidak boleh berbunyi aman; tanpa token
    Cloudflare, aturannya kembali ke "menit sama = bentrok".
- **Ad set tiap campaign di balik chevron**, dan yang digambar hanya ad set yang mulai di MENIT
  kartu itu — sisanya berdiri di kartunya sendiri, dan "2 dari 5 ad set" di barisnya sudah menyebut
  bahwa ada yang lain. Isinya cuma nama + ID, karena server memang cuma menjawab itu per ad set dan
  jamnya sudah di kepala kartu. Yang terbuka tinggal di alamat (`?adset=`, `replace`), berkunci
  menit + campaign: satu campaign bisa berdiri di beberapa kartu.
- **Yang dihitung CAMPAIGN, bukan ad set.** Ad set satu campaign yang mulai bersamaan TIDAK saling
  menandai: campaign "5 Adset" memang diluncurkan serentak, dan menghitungnya membuat tiap campaign
  baru bentrok dengan dirinya sendiri. Campaign milik PIC yang SAMA tetap dihitung: server situs
  tidak tahu siapa pemilik trafiknya.
- **Penyaring PIC (`?pic=`) menyaring JAM, bukan isinya.** Jam yang memuat campaign orang itu tetap
  menggambar SEMUA campaign di menit itu — yang dicari orang yang menyaring dirinya sendiri justru
  milik siapa jadwalnya bertabrakan.
- **Subdomain dan PIC cadangan dari baris campaign armada** (`campaignIndexOf`), bukan dari Meta.
- **Tombol Geser di kartu yang BENTROK menulis jam mulai baru langsung ke Meta**
  (`POST /scheduled-launches/adsets/:adSetId/start`, satu ad set per request, berurutan).
  - **SELURUH ad set terjadwal campaign itu bergeser dengan SELISIH yang sama** (`shiftPlan`),
    termasuk yang mulai di jam lain — jarak antar ad set yang disusun orangnya tetap utuh; menyamakan
    semuanya ke satu jam justru menyalakan campaign itu serentak. Daftarnya disebut sebelum Simpan.
  - **Ditulis di AD SET**, karena `start_time` campaign diterima lalu diabaikan Meta; jam campaign
    "Campaign baru" ikut bergeser sendiri. Aturan jamnya `parseStartTime` yang sama dengan Buat
    campaign (lampau ditolak — Meta menjepitnya ke jam sekarang), ditambah dua: ad set yang SUDAH
    tayang tidak bisa digeser, dan jam baru harus sebelum `end_time` (`shiftedStartTime`).
  - **Izinnya admin ATAU pemilik ad account-nya** (`mayToggleCampaign`), dan pemilik dibaca lewat
    aturan nama yang SAMA dengan sync (`adAccounts.userOwner` ↔ `users.name`, `launchOwnerOf`) —
    bukan lewat baris campaign di profil: campaign yang baru dibuat di Ads Manager belum masuk profil
    siapa pun sampai sync berikutnya, padahal justru itu yang paling sering perlu digeser.
  - **Ad set dibaca ulang dari Meta dan `account_id`-nya harus ad account armada** — tanpa itu route
    ini editor jadwal untuk ad set mana pun di Business Manager.
  - **Cermin bersama DIBUANG sesudah tulisan**, dan tab membaca ulang: tanpa itu seluruh tim masih
    melihat bentrok yang sudah dihapus sampai dua menit.
  - Usulan jam di dialog = menit kosong terdekat berlangkah 15 menit (`freeMinuteAfter`); menit yang
    sudah dipakai campaign lain boleh dipilih (menukar dua jadwal) tapi disebut di dialog.
- Tidak butuh `npm run deploy:rules`. Yang perlu di-deploy ulang server kontrol dan hosting.

### Tab Rasio Penayangan: permintaan vs yang dipenuhi Google, per jam

Tab **Rasio Penayangan** di Overview (`/dashboard/rasio-penayangan`) menggambar **Total permintaan
Ad Exchange**, **Tayangan Iklan Ad Exchange**, dan **Rasio penayangan Ad Exchange** (tayangan ÷
permintaan) per jam WIB, per domain atau subdomain — plus satu grafik dua sumbu untuk melihat
apakah naiknya permintaan berjalan bersama turunnya rasio. Penarikannya
[`functions/sync-fill-rate.mjs`](functions/sync-fill-rate.mjs) (cron server kontrol tiap 10 menit,
`FILL_RATE_CRON`), aturannya [`functions/fill-rate-core.js`](functions/fill-rate-core.js) dan
[`src/lib/fillRate.js`](src/lib/fillRate.js).

- **Bukan "Total rasio pengisian", dan itu bukan pilihan.** `AD_REQUESTS` DITOLAK Ad Manager bersama
  dimensi `HOUR` (24 Sep 2026, termasuk `DATE + HOUR` saja). Pasangan AdX diterima dan cocok sampai
  angka terakhir dengan Laporan interaktif (Jam + Situs); rasionya 0–2 poin di bawah "Total rasio
  pengisian" karena permintaan AdX dihitung sedikit lebih banyak. Labelnya nama kolom GAM persis.
- **Node `dashboard/fillRate/{tanggal}/{situs}/h{HH}` TIDAK PERNAH dipangkas.** Yang membuatnya
  murah dibuka adalah kunci tanggalnya: halaman meminta rentangnya saja (`useFillRate`, bukan
  `useStickyValue`), dan rentang yang dikosongkan dijepit 31 hari (`boundedRange`).
- **Kunci jam `h05`, bukan `05`** — kunci berbentuk angka (nol di depan pun) dibaca SDK sebagai
  indeks, dan node jam kembali sebagai array berlubang. Status network berkunci `n{kode}`.
- **Kunci situs = hostname (titik → koma), bukan `subdomainId`**: situs yang belum terdaftar tetap
  tercatat, dan subdomain yang didaftarkan belakangan langsung punya riwayat. Permintaan tanpa situs
  (`(Not applicable)`) masuk ember `_net_{domain akun GAM}` supaya total domain = total network.
- **Jam terakhir tiap network bertanda `partial`**: permintaan tercatat lebih lambat dari tayangan,
  jadi rasionya selalu melonjak palsu (68,9%, 94,8%). Digambar putus-putus; run berikutnya menimpanya.
- **Hanya daun yang berubah yang ditulis** (`changedLeaves`), jadi tab terbuka menerima delta
  beberapa jam terakhir, bukan seluruh hari tiap 10 menit. Kegagalan per network ke
  `dashboard/syncIssues/fillRate`; tidak ada antrean retry — run berikutnya sudah retry-nya.
- Tidak butuh `npm run deploy:rules`. Yang perlu di-deploy ulang server kontrol dan hosting.

### Baris campaign bertahan, kecuali dua hal

`users/{id}.campaigns` sengaja menahan baris yang tidak dikembalikan Meta pada run terakhir:
laporan yang gagal sesaat tidak boleh menghapus pemetaan yang membuat ROI bekerja. Dua yang **tidak**
ikut bertahan, karena bertahan berarti berbohong:

| | Tandanya | Yang terjadi |
|---|---|---|
| Ad account sudah bukan milik user itu | `adAccount`/`account` tidak ada di `adAccounts` miliknya | baris dibuang |
| Campaign tidak ada lagi di Meta | akunnya **berhasil** dibaca run ini, campaign-nya tidak ikut kembali | ditandai `metaMissing`, dibuang setelah `CAMPAIGN_MISSING_DAYS` (7 hari) |

- **"Tidak dikembalikan" ≠ "tidak diminta".** Baris hanya boleh dinilai hilang kalau
  `fetchCampaignSettings` untuk akunnya berhasil; akun yang gagal dibaca tidak mengabarkan apa pun
  tentang campaign-nya, dan menyimpulkan dari ketiadaan adalah cara pemetaan hilang tanpa jejak.
- **Kepemilikan dibaca dari seluruh `adAccounts`, bukan dari akun yang disync run ini.** Run yang
  dibatasi ke satu akun (`node sync-meta.mjs <id>`) tidak boleh menyimpulkan bahwa akun lain sudah
  bukan milik user itu. TBZ 1247 berpindah dari Nurjaman ke Lightman dan 107 barisnya tinggal di
  profil Nurjaman — campaign akun orang lain, lengkap dengan spend dan status hari terakhir akun itu
  masih miliknya.
- **Yang ditandai hilang berhenti bergaya seperti campaign sehat**: statusnya jadi
  `CAMPAIGN_GONE_STATUS` ("Tidak ada di Meta") alih-alih membeku di "Aktif", dan `configuredStatus`
  dikosongkan — saklar tanpa lawan bicara bukan saklar mati. `campaignToggleState` menyebut sebabnya
  alih-alih menyuruh menunggu sync yang tidak akan pernah membawa apa-apa.
- **Baris lama dicocokkan lewat `campaignId` dulu, baru namanya**, di sisi sync penuh maupun
  penyegaran. Nama boleh berubah; dicocokkan lewat nama saja, campaign yang diganti namanya berdiri
  dua kali dan yang lama membeku selamanya karena namanya tidak akan pernah kembali dari Meta.

## Halaman Campaign: salin dan kelola campaign Meta dari dashboard

`/campaigns` (SUPERADMIN, grup Aset) memuat campaign seluruh armada dan menulis ke Meta lewat server
kontrol: duplikasi, anggaran harian, nama, dan negara/umur ad set. Aturannya di
[`functions/campaign-manage-core.js`](functions/campaign-manage-core.js), job salinannya di
[`functions/campaign-copy-jobs.mjs`](functions/campaign-copy-jobs.mjs), route-nya di
[`server/campaign-manage.js`](server/campaign-manage.js). Desain dan hasil pembuktiannya:
[docs/superpowers/specs/2026-09-11-campaign-fleet-design.md](docs/superpowers/specs/2026-09-11-campaign-fleet-design.md).

- **Salinan BERTAHAP, bukan satu deep copy**: campaign tanpa isinya (`deep_copy=false`, PAUSED) →
  LANGSUNG ganti nama → tiap ad set ACTIVE/PAUSED disalin ke dalamnya (`POST /{ad_set}/copies`,
  `campaign_id`, `deep_copy=true`, `INHERITED_FROM_SOURCE`). Salinan langsung Meta dibatasi 3 iklan
  per panggilan, dan jalur asinkronnya (`async_batch_requests`) TERTUTUP untuk app ini: satu item
  ditolak `#194` (minimal dua, tidak tertulis di dokumentasi), dua item ditolak `#10` (izin app).
  Batasnya jadi ≤3 iklan per ad set dan ≤50 ad set per campaign, ditolak 422 sebelum menyentuh Meta.
- **Nama campaign harus unik di ad account-nya, karena sync melebur campaign per NAMA**
  (`mergeCampaignSources`, kunci `normalizeName`): dua campaign bernama sama jadi SATU baris dengan
  `campaignId` milik yang didaftar Meta terakhir — salinannya hilang dari tabel, atau saklar baris
  sumber diam-diam menyalakan salinannya. Salin dan ganti nama menolak 422 nama yang sudah dipakai
  (`assertNamesFree`, diadu dengan `fetchCampaignSettings` akun itu plus nama job salinan yang masih
  berjalan; bacaan yang gagal = 502, bukan lolos). Campaign tanpa isi lahir BERAKHIRAN unik per job
  (`ONLY_TOP_LEVEL_RENAME`, ` (salinan {jobId}-{n})`) — tidak pernah kembar dengan sumbernya
  sekejap pun — dan dialog mengisi `{nama sumber} (salinan)`. Ganti nama yang gagal membuat salinan
  `partial` (bernama sementara, ad set-nya tetap disalin), bukan `done`.
- **Deep copy MELEWATKAN iklan diam-diam, dan yang tersalin lalu DIBUATKAN SENDIRI.** Campaign dan
  ad set tersalin, iklannya tidak, tanpa satu pun error di jawaban Meta. Sebabnya: deep copy membuat
  creative BARU lewat app kita, dan app yang masih **Development Mode** ditolak `(#100-1885183)` untuk
  tiap creative — berlaku SELURUH armada sekaligus (dibuktikan 12 Sep 2026; app-nya sudah Live sejak
  sore itu, lihat "Buat campaign" di bawah). Karena itu jumlah iklan yang lahir (`ad_object_ids` bertipe `ad`) diadu dengan jumlah
  iklan sumber PER AD SET — kelebihan di satu ad set tidak menutupi yang hilang di ad set lain — dan
  yang kurang dibuatkan sendiri oleh `repairCopiedAds` dengan **creative iklan SUMBERNYA**
  (`POST /act_X/ads` ber-`creative_id`, tanpa satu creative baru pun lahir).
  - **Itu MENGHAPUS Development Mode sebagai penghalang salinan**, dan dibuktikan ke produksi lewat
    `runCopyJob` sendiri (12 Sep 2026): campaign ber-Halaman **Sonet Media 01** disalin `done` dengan
    **5 ad set / 5 iklan** sementara deep copy-nya melahirkan 0 — app-nya masih Development Mode.
    Pada campaign yang Halamannya belum diberi izin, penolakannya berpindah dari `(#100-1885183)` ke
    `(#100-1885499)` — **System User belum punya izin beriklan di Halaman creative itu**, per Halaman. Yang tersisa jadi satu sebab
    yang bisa diberikan sendiri dalam satu menit di Business Manager, dan `explainWriteFailure`
    menyebutkan Halamannya berikut langkahnya. Keduanya TIDAK dilebur: satu menyuruh ke dashboard
    app, satu ke Business Manager, dan yang dilebur membuat orang menunggu App Review untuk sesuatu
    yang tidak menunggu apa pun.
  - **Dicocokkan lewat NAMA iklan, bukan lewat selisih jumlahnya** (`adsToRepair`). Salinan yang
    melahirkan sebagian iklannya tidak mengabarkan yang MANA, dan membuat sebanyak selisihnya
    menghasilkan iklan kembar di ad set yang sudah punya isinya. Nama iklan tidak diganti salinan
    Meta (`NO_RENAME`), jadi itu satu-satunya penanda yang ada; yang namanya kosong di sisi sumber
    tidak pernah dipulihkan.
  - **Saklarnya mengikuti iklan SUMBER, bukan dipaksa PAUSED** — sepola `INHERITED_FROM_SOURCE` yang
    dipakai salinan ad set-nya. Satu iklan mati di dalam ad set yang menyala adalah persis keadaan
    "ad set aktif tapi Rp 0" yang panel ad set ada untuk menerangkannya. Campaign-nya sendiri tetap
    lahir PAUSED, jadi tidak ada uang yang keluar sebelum ada yang menyalakannya.
  - **Konsekuensi yang diketahui dan diterima**: iklan hasil pemulihan BERBAGI creative dengan iklan
    sumbernya, jadi mengubah teks atau gambarnya di Ads Manager mengubah keduanya. Itu harga untuk
    salinan yang punya iklan sama sekali — dan begitu app-nya Live, deep copy melahirkan creative-nya
    sendiri lagi dan pemulihan ini tidak menemukan apa pun untuk dikerjakan.
- **Salinan hanya untuk subdomain yang SAMA.** Link iklan tinggal di creative, dan `object_story_spec`
  tidak bisa diubah. Nama salinan wajib membawa kode Keitaro subdomain sumber; kode subdomain lain
  ditolak.
- **Vonis nama memakai `matchCode` yang sama dengan sync** (kode terdaftar PERTAMA). Campaign yang
  belum terpetakan atau dipetakan manual boleh kode mana pun, tapi server menjawab 409 `needsConfirm`
  berikut subdomain yang dituju, dan dialog menanyakannya.
- **Salinan lahir PAUSED dan TIDAK PERNAH diulang otomatis** (`retry: false` di `graphPost`): kode
  1/2 bisa datang sesudah Meta sempat membuat salinannya. Karena itu salin campaign yang gagal
  dengan hasil TIDAK PASTI (kode 1/2, jaringan putus/waktu habis, non-JSON/HTTP 5xx —
  `metaOutcomeUncertain`) membuat job `unknown` ("periksa Ads Manager"), bukan `failed`.
- **Job ditulis `requested` SEBELUM Meta disentuh, lalu route menjawab dan penyalinan berjalan di
  latar** dengan progres per ad set di `dashboard/campaignCopyJobs`. Tiap salinan dicatat di
  `copies/{i}` begitu lahir; tulisan progres yang gagal cuma masuk log. `requested` >10 menit atau
  `running` >30 menit sejak aktivitas terakhir (`updatedAt`) → `unknown`, bukan `failed`. Satu
  sumber, satu job berjalan (409) — dijaga RTDB DAN penjaga di dalam proses server, karena dua klik
  bersamaan sama-sama membaca daftar job sebelum yang lain menulis. Cron lima menitan cuma menyapu
  yang menggantung (path yang berubah saja) dan membuang job >7 hari.
- **Dua TAB, bukan dua panel bertumpuk: Daftar Campaign dan Pekerjaan** (`/campaigns` dan
  `/campaigns/pekerjaan`, route sungguhan sepola tab Overview). Isinya dua pertanyaan yang tidak
  pernah ditanyakan bersamaan — "campaign apa saja yang ada" dan "apa yang sedang berjalan" — dan
  panel Pekerjaan yang berdiri DI ATAS tabel mendorongnya turun tiap kali ada job: yang tergeser
  keluar layar pertama justru yang dibuka orang tiap hari.
  - **Lencana angka di tab Pekerjaan** (`runningJobCount`), dan ia memenuhi syarat lencana tab:
    isinya ANTREAN — job yang berjalan habis sendiri, jadi angkanya benar-benar kembali ke nol.
    Tanpa lencana itu, berpindah tab adalah satu-satunya cara mengetahui ada yang sedang dikerjakan,
    dan itu persis yang hilang saat panelnya pindah dari atas tabel. Dihitung dari node-nya langsung,
    bukan dari `campaignJobRows`: ia dipanggil tiap render di main.jsx, termasuk di halaman lain.
  - **Toast hasil tetap hidup di KEDUA tab** — `jobs` dan efeknya berdiri di luar percabangan tab.
    Hasil sebuah pekerjaan harus sampai ke orangnya walau ia sedang membaca tabel armada; digambar
    hanya di tab Pekerjaan, satu-satunya yang melihatnya adalah orang yang sudah menunggu di sana.
  - **"Lihat di tabel" BERPINDAH ALAMAT** (`/campaigns?q=…`), bukan cuma menulis `?q=`: tabelnya tab
    lain sekarang, dan menyaring tabel yang tidak sedang digambar tidak melakukan apa pun.
  - **Tab Pekerjaan yang kosong menyebut masa simpannya**, bukan digambar kosong: tab tanpa satu
    kalimat pun terbaca seperti halaman yang gagal memuat, dan daftar yang kosong karena job-nya
    sudah dibuang (>7 hari) bukan daftar yang kosong karena tidak ada yang pernah dikerjakan.
- **Hasil job diumumkan dari NODE-nya, bukan dari tombolnya** (`finishedJobToasts`). Tombol Duplikat
  cuma bisa berbunyi "sedang dikerjakan": route menjawab sesudah job ditulis `requested` dan sebelum
  satu ad set pun disalin. Yang tahu hasilnya adalah node yang SUDAH dilanggan panel Pekerjaan, jadi
  toast lahir dari PERPINDAHAN status job — `requested`/`running` → `done`/`partial`/`failed`/
  `unknown` — dan berlaku untuk kedua jenis pekerjaan.
  - **Pembacaan PERTAMA tiap sesi tidak menoast apa pun**, dan job yang muncul pertama kali sudah
    dalam keadaan selesai juga tidak. Node job menyimpan riwayat tujuh hari: tanpa aturan itu,
    membuka halaman ini memuntahkan selusin toast tentang pekerjaan yang sudah lama selesai.
  - **Iklan disebut TERPISAH dari campaign-nya** ("1 dari 1 campaign, 0 dari 1 iklan lahir"). Itu
    yang menerangkan kata "Sebagian": campaign salinan hampir selalu lahir, yang kurang isinya —
    dan toast yang cuma menyebut campaign akan terbaca seperti keberhasilan.
  - **Kalimat sebab di atas 120 karakter DITUKAR dengan "Sebabnya ada di panel Pekerjaan"**, bukan
    dipotong: pesan Meta yang diterjemahkan menaruh tindakannya di EKOR kalimat ("beri izin beriklan
    di Halaman itu"), jadi potongan di tengah justru membuang satu-satunya bagian yang berguna.
    Panelnya berdiri di halaman yang sama, tepat di atas tabelnya.
  - **`notifyWarning`, BUKAN `notifyError`.** Yang kedua meluluskan pesannya lewat `friendlyError`,
    yang menerjemahkan pola Meta jadi kalimat umum — kalimat yang menyebut ID Halaman yang harus
    diberi izin akan tergantikan oleh "Aplikasi Meta sedang diblokir. Hubungi admin."
- **Tindakan MASSAL di tabel armada** (Nyalakan, Matikan, Ubah anggaran) lewat kotak pilih-baris
  (`RowCheckbox`, pemilik kedua sesudah /plugin). "Pilih semua" = yang TERLIHAT (tersaring), dan
  baris tanpa alamat Meta tidak bisa dipilih. Tidak ada route massal: tiap campaign lewat route
  per-campaign yang sama (`setCampaignStatusNow`, `updateCampaignNow`), BERURUTAN (`runEach`) —
  bentuk request yang meletus bersamaan adalah yang membuat app dicap anomali. Satu yang ditolak
  tidak menghentikan sisanya, dan hasilnya SATU toast yang menyebut yang gagal. Saklar yang sudah di
  posisi tujuan tidak dikirim; anggaran hanya untuk baris ber-anggaran harian di campaign (yang lain
  disebut jumlahnya dan dilewati). Tidak ada cadangan antrean RTDB untuk saklar massal — tombolnya
  memang cuma digambar saat server kontrol ada.
- **Anggaran hanya HARIAN, di tingkat yang memegangnya** (campaign CBO, ad set ABO). `"0"` dari Meta
  berarti "bukan jenis anggaran ini", bukan nol rupiah.
- **Targeting dibaca ulang dari Meta sesaat sebelum ditulis**, cuma `countries`/`age_min`/`age_max`
  yang diganti, lalu dikirim utuh. Hanya ad set yang lokasinya negara saja yang bisa diedit.
- **Penolakan Meta berkode 100 (selain subkode 33) jadi 422**, sisanya 502 (`metaFailureStatus`).
- **Tulisan yang mengubah baris tabel memasukkan ad account-nya ke antrean sync** (~30 detik, digabung
  per akun), memakai SATU penjaga dengan siklus campaign (`server/campaign-lock.js`).
- **Versi Meta API dipatok `v25.0`.** Pada 11 Sep 2026 Meta menjawab `v21.0` dan `v25.0` sebagai
  `v26.0` diam-diam.
- Butuh `npm run deploy:rules` (node job baru), deploy ulang server kontrol, dan hosting.

### Buat campaign: satu POLA, bukan Ads Manager kedua

Tombol **Buat campaign** di `/campaigns` melahirkan satu campaign berikut isinya — bukan menyalin
campaign yang sudah ada. Itu satu-satunya jalan ke subdomain LAIN: link iklan tinggal di creative,
dan `object_story_spec` tidak bisa diubah, jadi salinan selamanya mengarah ke tujuan sumbernya.
Aturannya di [`functions/campaign-create-core.js`](functions/campaign-create-core.js), orkestrasinya
di [`functions/campaign-create-jobs.mjs`](functions/campaign-create-jobs.mjs), route-nya di
[`server/campaign-create.js`](server/campaign-create.js), dialognya di
[`src/components/campaigns/CreateCampaignDialog.jsx`](src/components/campaigns/CreateCampaignDialog.jsx).

- **SUDAH TERBUKTI UTUH sejak app-nya Live (12 Sep 2026).** Satu job penuh lewat `runCreateJob`
  sendiri: 2 ad set, 2 creative, 2 iklan, `state: done`, jadwal dan anggaran CBO terbaca kembali dari
  Meta, tiap iklan membawa judul dan gambarnya sendiri. Sebelum saklar itu digeser, tiap creative app
  ini ditolak `(#100-1885183)` — SETIAP bentuk, bukan cuma pola armada: dynamic creative, link ad
  biasa, dan carousel `child_attachments` ketiganya diuji dan ditolak sama persis.
  - **Cabang `(#100-1885183)` di `explainWriteFailure` TETAP ADA**, walau hari ini tidak berbunyi:
    app bisa dikembalikan ke Development Mode kapan saja, dan kalimat Meta aslinya menyuruh orang
    mencari "postingan materi iklan" yang tidak pernah ada. Yang membukanya satu saklar di luar repo
    ini — developers.facebook.com → app → **App Mode: Live** di bar paling atas; Settings › Basic
    (Privacy Policy URL + kategori) cuma SYARATNYA, bukan saklarnya. Halaman kebijakan privasinya
    tinggal di repo ini, [`public/privacy.html`](public/privacy.html), dilayani Firebase Hosting apa
    adanya — berkas statis menang atas rewrite `**` ke index.html, jadi SPA-nya tidak menelannya.
- **Bentuknya POLA ARMADA, dan form-nya tidak menawarkan alternatif.** Dibaca dari armada (12 Sep
  2026: 196 campaign, 552 ad set, ~460 iklan): campaign `OUTCOME_LEADS` + AUCTION + **CBO** +
  `LOWEST_COST_WITHOUT_CAP`; ad set `OFFSITE_CONVERSIONS` + `IMPRESSIONS` + `promoted_object`
  {pixel, `CONTENT_VIEW`} + `is_dynamic_creative`; iklan `asset_feed_spec` **CAROUSEL_IMAGE**, 2–10
  gambar, satu judul, satu body, `url_tags` terpisah dari alias. Objective lain menyeret field lain
  di belakangnya (`promoted_object` berbentuk lain, `destination_type`, `bid_amount`), dan form yang
  menawarkan semuanya adalah Ads Manager setengah jadi yang satu-satunya keterangannya penolakan
  Meta. Yang dipilih orang cuma yang berbeda antar-campaign: akun, tujuan, anggaran, negara, umur,
  Halaman, pixel, gambar, CTA, dan teksnya.
- **Satu campaign = N ad set bertargeting IDENTIK, masing-masing satu iklan yang bedanya cuma judul
  + body.** Itu yang dibaca dari armada: "5 Adset" di nama campaign adalah uji variasi TEKS, bukan
  variasi negara. Nama ad set diberi akhiran ` #n` — MENYIMPANG dari kebiasaan armada yang menamai
  kelimanya sama persis, karena di panel ad set kita lima baris bernama sama tidak bisa dibedakan,
  padahal panel itu dibuka justru untuk mencari ad set MANA yang membakar anggaran.
- **JADWAL mulai tayang ditulis di AD SET, tidak pernah di campaign** (`parseStartTime`,
  `adSetPayload.start_time`). Dibuktikan ke produksi 12 Sep 2026, dua arah: `start_time` pada
  `POST /act_…/campaigns` DITERIMA (200) lalu DIABAIKAN — campaign-nya dibaca ulang dengan jam
  pembuatannya — sementara di ad set ia tersimpan persis. Yang mengisi `start_time` campaign adalah
  Meta sendiri, dari ad set yang PALING AWAL (dua ad set 20 dan 25 Sep menghasilkan campaign 20 Sep),
  jadi kolom Status di tabel armada berbunyi **"Terjadwal" berikut tanggalnya** tanpa satu field pun
  ditulis ke sana.
  - **WAKTU LAMPAU DITOLAK, karena Meta menerimanya lalu MENJEPITNYA ke jam sekarang** — juga
    dibuktikan (200, lalu dibaca ulang sebagai jam pembuatan). Jadwal yang diketik orang lalu hilang
    tanpa satu pun pesan adalah kegagalan yang sebentuk dengan enum plugin yang dijawab 200 berisi
    nilai lama; di sini akibatnya campaign yang dikira terjadwal justru tayang begitu dinyalakan.
  - **Zonanya WIB dan ditulis EKSPLISIT (`+07:00`).** Kelima belas ad account armada berzona
    Asia/Jakarta (diperiksa 12 Sep 2026) dan itu juga zona operasi dashboard ini — tapi yang mengetik
    bisa duduk di zona lain, dan `datetime-local` tidak membawa zona sama sekali.
  - **Tanggal yang tidak ada DIGULIRKAN diam-diam oleh JS**, bukan ditolak: `new Date("2026-02-30")`
    menjawab 2 Maret. Yang menangkapnya perjalanan bolak-balik — tanggal hasil urai dibaca kembali
    dalam WIB dan harus sama persis dengan yang diketik — bukan `Invalid Date`, yang hanya muncul
    untuk BULAN di luar 1–12.
  - **Yang kosong tidak mengirim field-nya sama sekali**, dan batasnya setahun: jadwal yang lebih
    jauh hampir selalu tahun yang salah ketik, dan campaign yang mulai tayang 2036 tidak berbunyi
    sebagai kesalahan di mana pun — ia cuma tidak pernah jalan.
- **JUMLAH AD SET adalah panjang daftar variasi, bukan angka tersendiri** (`resizeVariants`). Satu
  variasi = satu ad set + satu iklan, dan itu dibaca dari armada: kelima iklan campaign "5 Adset"
  berjudul dan berbody BERBEDA (diperiksa 12 Sep 2026), jadi ia uji teks dengan targeting yang sama
  persis. Kotak angkanya menyetel panjang daftarnya langsung — dua angka yang harus sepakat ("5 ad
  set" vs 3 teks yang terisi) adalah keadaan yang tidak bisa dijawab tanpa mengarang teks.
  - **Yang menyusut membuang baris dari BELAKANG**, termasuk yang sudah terisi — sama dengan tombol X
    di tiap barisnya, dan barisnya memang hilang dari layar saat itu juga.
  - **Angka yang tidak terbaca tidak mengubah apa pun** (kotak yang sedang dikosongkan orang untuk
    mengetik ulang): dijepit ke 1, satu ketukan backspace menghapus empat variasi yang sudah diketik.
- **Semuanya lahir PAUSED, tanpa pilihan.** Campaign yang menyala dari sebuah form berarti uang
  keluar sebelum ada yang melihat hasilnya di layar.
- **Tidak satu pun alamat Meta dipercaya dari request**: `act_…` dibaca dari
  `adAccounts/{accountId}`, link iklan wajib salah satu Campaign URL yang tersimpan di baris
  subdomain itu (`assertLinkOfSubDomain` — KEANGGOTAAN, bukan pencocokan alias yang diulang;
  `campaignUrlPairs` di sisi UI yang menyaringnya ke kodenya), `page_id` wajib ada di `me/accounts`,
  dan `pixel_id` wajib milik akun itu. Keduanya diperiksa SEBELUM satu objek pun lahir: Meta menolak
  keduanya sendiri, tapi penolakannya datang sesudah campaign dan sebagian ad set berdiri.
- **ALAMAT dan PARAMETER iklan adalah dua kotak, dan cuma yang kedua bisa diketik.** Meta memisahkan
  keduanya juga (`link_urls[].website_url` vs `url_tags`), dan yang perlu disesuaikan orang cuma
  penandanya — sub id, penanda kreatif — sementara alamatnya datang dari cermin gating dan satu huruf
  yang meleset di sana mengirim trafik berbayar ke nama yang tidak menjawab. Digabung dalam satu
  kotak, mengubah satu penanda berarti mengetik ulang seluruh link.
  - **Yang diadu server cuma ALAMATNYA** (`assertLinkOfSubDomain` membandingkan sisi sebelum `?`):
    dialog mengirim link penuh dari baris subdomain, parameternya menyusul terpisah, dan yang
    memotongnya SATU tempat. Dipotong di browser juga, pemotongnya jadi dua dan yang lebih longgar
    menang tanpa berbunyi.
  - **Bentuk parameternya diperiksa sebagai pasangan `kunci=nilai`, dan link penuh DITOLAK lebih
    dulu** (`parseUrlTags`): "https://x/y?bit" adalah kunci yang sah dan "[race]" nilainya, jadi link
    yang tertempel ke kotak ini lolos pemeriksaan pasangan — lalu diterima Meta apa adanya dan
    menghasilkan alamat yang tidak pernah dipasang siapa pun. "?" yang ikut tersalin dibuang, bukan
    ditolak: ia tempelan yang tidak mengubah maksud orangnya.
  - **Dikosongkan berarti iklannya lahir TANPA `url_tags`** — dan itu pilihan yang sah sekaligus
    berbahaya: Keitaro kehilangan penanda `[race]` dan kunjungannya tidak tercatat. Ringkasan sebelum
    Buat menyebutnya "(tanpa parameter)" alih-alih menggambar baris kosong.
- **Nama wajib membawa kode subdomain TUJUAN** (`createNameVerdict`), dan itu lebih keras daripada
  `campaignNameVerdict` tahap 1 yang cuma menanyakan konfirmasi: di sini link-nya kita yang tulis,
  jadi kode yang menunjuk subdomain lain pasti salah. Harus unik di ad account itu juga
  (`assertNamesFree` + nama job yang masih berjalan) — sync melebur campaign per nama.
- **Job di `dashboard/campaignCreateJobs`, node sendiri dengan penyapu BERSAMA**
  ([`functions/campaign-jobs.mjs`](functions/campaign-jobs.mjs): `sweepJobsAt`, `noteJob`,
  `JobConflict`). Bentuk barisnya berbeda dari job salinan, cara keduanya menggantung tidak — dan
  aturan menggantung yang ditulis dua kali berarti salah satunya berhenti menyapu job-nya sendiri
  suatu hari. `requested` ditulis sebelum Meta disentuh, pembuatannya berjalan di latar sesudah route
  menjawab, tiap ad set/creative/iklan dicatat begitu lahir.
- **Job `partial` bisa DILANJUTKAN** (tombol Lanjutkan di tab Pekerjaan,
  `POST /fleet/create-jobs/:jobId/resume`), dari rencana UTUH yang disimpan di job-nya (`plan`, teks
  JSON) — bukan dengan mengisi ulang form. `resumeCreatePlan` yang memutuskan: hanya variasi tanpa
  iklan, langkah yang sudah punya ID (ad set, creative) DILEWATI, dan variasi yang gagal dengan hasil
  TIDAK PASTI tidak disentuh (ad set-nya bisa saja sudah lahir tanpa ID di job). Jadwal mulai yang
  sudah lewat ditolak — Meta akan menjepitnya ke jam sekarang. Job yang lahir sebelum `plan`
  disimpan tidak bisa dilanjutkan (tombolnya tidak digambar). Job SALINAN tidak punya jalan ini:
  catatannya cuma hitungan, bukan ad set mana yang tersalin.
- **Yang lahir sebagian tetap `partial` berikut ID-nya, TIDAK dihapus otomatis.** Membersihkan
  sendiri berarti menghapus objek Meta atas keputusan yang tidak diminta siapa pun. Satu variasi yang
  ditolak tidak menghentikan sisanya; campaign yang gagal menghentikan seluruhnya (tidak ada tempat
  bagi ad set untuk lahir).
- **Panel "Salinan" jadi panel "Pekerjaan"**, memuat kedua jenis job dengan kolom Jenis: pertanyaan
  yang dibawa orang ke halaman ini cuma "apa yang sedang berjalan", dan jawaban yang dipecah dua
  daftar menuntut dua tempat dilihat. Yang lahir dihitung dari IKLAN (`adId`), bukan ad set — ad set
  yang berdiri tanpa iklan adalah persis keadaan yang ditinggalkan app Development Mode.
- **GAMBAR MILIK TIAP IKLAN, bukan satu daftar untuk seluruh campaign.** Tiap variasi membawa
  `images`-nya sendiri dan `creativePayload` membaca `variant.images`; satu daftar bersama membuat
  kelima ad set memakai carousel yang sama persis, dan yang paling menentukan hasil sebuah iklan
  justru gambarnya — lima ad set bergambar identik tidak bisa mengabarkan gambar mana yang bekerja.
  - **Kekurangannya disebut per NOMOR iklan** ("Gambar iklan 2: pilih 2 sampai 10 gambar"): satu
    kalimat tanpa nomor untuk form sepuluh iklan tidak memberi tahu iklan mana yang kurang.
  - **Yang dibandingkan saat menolak variasi kembar tetap TEKSNYA saja.** Dua iklan berteks sama yang
    bergambar berbeda adalah justru uji yang masuk akal.
  - **Daftar tingkat-campaign masih DITERIMA server, dan itu disengaja** (`fallbackImages`): server
    naik lebih dulu daripada hosting, dan tanpanya tiap tab yang sedang terbuka menjawab 422 selama
    jeda di antaranya. `tools/meta-create-probe.mjs` ikut memakainya.
  - **Baris job menyebut GABUNGANNYA tanpa kembar** (`plan.images`), bukan sepuluh angka — dan
    batas `.validate`-nya karena itu 100, bukan 10.
- **Unggahnya per IKLAN dan **multipart**, bukan `bytes=<base64>`: nama field-lah yang jadi nama
  berkas di pustaka Meta (dibuktikan 12 Sep 2026), dan pustaka yang seluruh barisnya bernama "bytes"
  tidak bisa dipilih orang. Yang berhasil diunggah langsung terpilih DI IKLAN yang tombolnya ditekan;
  satu `<input type=file>` untuk sepuluh tombol, dan yang menentukan tujuannya tombol terakhir yang
  ditekan (`uploadInto`) — sepuluh input tersembunyi adalah sepuluh tempat yang harus dijaga sendiri.
  Batas 8 MB diperiksa server; **nginx di depannya butuh `client_max_body_size 8m`** — bawaannya
  1 MB, dan yang ditolak di sana menjawab HTML 413 yang tidak menyebut apa pun tentang gambar.
- **Ganti ad account MELEPAS gambar yang sudah dipilih tiap iklan.** Pustaka gambar milik ad account,
  jadi hash dari akun lain ditolak Meta — dan penolakannya datang sesudah seluruh form diisi.
- **PRESET NEGARA disimpan PER ADVERTISER** (`dashboard/countryPresets`, `countryPresetEntry` +
  `countryPresetsFor`). Tiap orang menamai wilayahnya sendiri ("MEA", "LATAM"), jadi satu daftar
  bersama berarti sepuluh nama yang artinya cuma diketahui pembuatnya. Advertiser-nya PEMILIK ad
  account yang dipilih — kosakata yang sama dengan penyaring subdomain di dialog yang sama, jadi tidak
  ada pertanyaan kedua tentang "advertiser yang mana", dan akun tanpa User Pemilik tidak menawarkan
  preset apa pun.
  - **BUKAN di bawah `users`**, walau ia milik seseorang: node itu dilanggan tiap muat halaman setiap
    akun, dan preset yang menumpang di sana akan diunduh SEMUA ORANG untuk dialog yang cuma bisa
    dibuka superadmin. Node sendiri di bawah `dashboard`, dilanggan bersama kedua node job halaman
    Campaign.
  - **Nama yang sudah dipakai advertiser itu DITOLAK** di dialognya: dua preset bernama sama di satu
    dropdown tidak bisa dibedakan pemakainya, dan yang salah pilih baru terbaca sebagai negara yang
    tidak diminta.
  - **Arsip, bukan hapus** (`deletedAt`), dan penyaringnya di `countryPresetsFor` — langganannya satu
    node nilai (`subscribeValue`), bukan `subscribeResource` yang menyaringnya sendiri.
  - Butuh `npm run deploy:rules`.
- **Negara dipilih, bukan diketik** ([`CountryPicker`](src/components/campaigns/CountryPicker.jsx)),
  dan pemilih yang SAMA dipakai dialog Ubah ad set — dua pemilih untuk satu arti berarti yang satu
  menerima kode yang ditolak yang lain suatu hari. Nilainya tetap teks ("SA, TR"), jadi
  `createCampaignPayload` dan `adSetEditState` tidak ikut berubah; yang hilang adalah kelas kesalahan
  yang tidak berbunyi sama sekali — "SE" alih-alih "SA" adalah negara yang sah, cuma bukan yang
  dimaksud, dan bendera + nama di tiap barisnya yang menghapusnya. Daftarnya
  ([`src/lib/adCountries.js`](src/lib/adCountries.js)) adalah 56 negara yang BENAR-BENAR ditargetkan
  928 ad set armada (12 Sep 2026), bukan 280 kode yang dijawab `Intl.DisplayNames` — di antaranya
  negara yang sudah tidak ada dan kode semu yang semuanya ditolak Meta. Yang belum pernah dipakai
  tetap bisa ditambahkan lewat kotak pencariannya (`extraCountryCode`), jadi wilayah baru tidak
  menuntut deploy lebih dulu.
- **Subdomain yang ditawarkan disaring ke PIC ad account yang dipilih** (`subDomains.pic` diadu
  dengan `adAccounts.userOwner` — satu kosakata, nama advertiser yang sama). Yang dijawabnya
  pertanyaan yang dibawa orang ke dialog ini: campaign ini lahir di akun SIAPA, dan subdomain yang
  dia pegang yang mana. Dari 73 baris armada, yang tersisa 12–17 per akun (12 Sep 2026) — daftar
  penuh untuk memilih satu subdomain sendiri adalah cara kode subdomain orang lain terpasang di
  iklan yang uangnya keluar dari akun orang ini.
  - **Akun tanpa User Pemilik TIDAK menyaring apa pun.** "Kosong" bukan nama seorang advertiser, dan
    daftar yang menyusut jadi nol untuk kolom yang belum diisi adalah dialog yang tidak bisa dipakai
    tanpa satu pun keterangan; yang memperbaikinya kolom User Pemilik di /ad-accounts.
  - **Penyaring TAMPILAN, bukan aturan — server tidak menolak subdomain milik orang lain.** PIC
    sebuah subdomain berpindah, dan 16 dari 73 baris belum punya PIC sama sekali: dijadikan
    penolakan, keenam belas baris itu tidak bisa dituju dari satu pun akun yang pemiliknya terisi.
  - **Yang menyebut penyaringnya adalah PLACEHOLDER-nya** ("Pilih subdomain Godek..."), bukan
    paragraf di bawah kotaknya; jumlah yang disembunyikan ikut di ikon keterangannya. Berpindah akun
    MELEPAS subdomain yang tidak lagi ditawarkan berikut kode, link, dan nama campaign-nya —
    dibiarkan, form mengirim subdomain milik orang lain yang tidak tergambar di mana pun.
- **Yang dikirim dialog ini adalah KUNCI RTDB baris, dan `store.adAccounts`/`store.subDomains` itu
  ARRAY** — `snapshotToArray` menaruh kuncinya di `id`, bukan menjadikannya kunci peta. Dibaca dengan
  `Object.entries` (bentuk yang wajar untuk node RTDB), "kunci" yang keluar adalah NOMOR URUT barisnya:
  server membaca `adAccounts/0`, tidak menemukannya, dan menjawab 404 "Ad account itu tidak ada di
  /ad-accounts" untuk SETIAP akun yang dipilih — kegagalan yang terbaca seperti data yang hilang,
  padahal barisnya ada dan yang salah alamatnya. `rowsOf` di
  [`src/lib/campaignCreate.js`](src/lib/campaignCreate.js) menerima kedua bentuk (sepola `toArray` di
  campaignRows.js), dan yang menentukan tetap `id` baris itu sendiri.
- **Usulan nama cuma kode + nomor urut berikutnya** (`nextCampaignName`, dibaca dari nama campaign
  yang sudah ada di armada). Wilayah dan nama pendek Halaman tidak diusulkan: usulan yang memuat
  tempelan seperti "{WILAYAH}" akan terkirim apa adanya ke Meta pada hari seseorang lupa
  menggantinya.
- Butuh `npm run deploy:rules` (node job baru), nginx, server kontrol, dan hosting.

## Gating Keitaro: `gated` yang memutuskan, bukan `applicable`

Satu campaign Keitaro mengirim trafik ke tiga tempat — Landing (pengunjung asli), Bot Protection
(bot), dan Flow 3 (tidak memenuhi syarat). Gating mengarahkan ketiganya ke gate kita, yang mencatat
kunjungan lalu meneruskan pengunjung ke tujuan yang sama seperti sebelumnya. Halaman
`/vi-control` (alamat lamanya, `/gating`, masih dikenali dan dialihkan ke sana), API-nya
[vi-control](https://go.rabbitracing.live:8443/openapi).

- **Halaman ini superadmin saja, dan itu satu-satunya tempat superadmin berbeda dari admin.**
  `SUPERADMIN_PAGES` di [`src/config/access.js`](src/config/access.js) dan `.validate` pada
  `dashboard/gating/commands/$id/state` di `database.rules.json` adalah cerminan satu sama lain:
  perintah baru (`state: "pending"`) hanya boleh dibuat superadmin, sementara `applied`/`failed`
  boleh ditulis admin — karena yang menuliskannya adalah SYNC_USER.
- **`gated` dari `/campaigns` yang menentukan arah tombol, bukan `applicable` dari pratinjau.**
  Pratinjau untuk campaign yang SUDAH di-gate tetap menjawab `applicable: true`, dengan
  `destinations` yang menunjuk ke URL gate itu sendiri — gate kedua akan memasang gate di depan
  gate, dan tidak ada apa pun di sisi vi-control yang menghentikannya. `guardReason` di
  [`functions/sync-gating.mjs`](functions/sync-gating.mjs) membaca ulang `gated` sedetik sebelum
  menulis, karena yang dilihat orang di layar adalah cermin beberapa menit lalu.
- **`gated: null` bukan `false`.** Stream campaign itu gagal dibaca; tombolnya mati berikut
  alasannya, bukan digambar seolah campaign-nya siap di-gate.
- **Tiga status jawaban gate/ungate, dan HTTP-nya selalu 200.** `ok` berhasil & terverifikasi;
  `aborted` ditolak dan tidak ada yang ditulis sama sekali (sistemnya sedang melindungi — jangan
  di-retry membabi buta, warnanya kuning bukan merah); `problem` **tersimpan tapi verifikasinya
  gagal** — itu yang paling gawat, karena routing-nya sudah berubah tanpa terbukti benar, dan
  digabung dengan "gagal" ia akan terbaca sebagai "tidak jadi". `reload.ok: false` bukan kegagalan.
- **API key tidak boleh sampai ke browser, dan itu alasan antrean di sini lebih keras daripada di
  saklar campaign.** Key vi-control mengubah tujuan trafik iklan yang hidup; bahkan kalau DRS
  dilonggarkan dan callable bisa dipanggil, key-nya tetap tinggal di sisi server. Bentuk perintah
  ditulis dua kali dan harus sama persis — `gateCommandEntry` di
  [`functions/gating-core.js`](functions/gating-core.js) dan
  [`src/lib/gating.js`](src/lib/gating.js), persis seperti `campaignCommandEntry`.
- **Terapkan antrean dulu, baru segarkan cermin — KEBALIKAN dari saklar campaign Meta.** Di sana
  bacaan status jalan lebih dulu karena Meta butuh waktu menampakkan perubahan. Di sini vi-control
  membaca ulang dan memverifikasi sebelum menjawab, jadi daftar yang dibaca sesudahnya sudah memuat
  perubahannya.
- **Kunci RTDB berawalan huruf (`c57`, bukan `57`).** ID campaign Keitaro angka mulai dari 1, dan
  RTDB mengembalikan node berkunci angka berurutan sebagai array berlubang.
- **`startedAt` dari `/gate-runs` UTC dan bentuknya bukan ISO** (`2026-08-17 05:24:31.293338+00`).
  Disimpan apa adanya, `formatDateTime` membacanya sebagai jam lokal dan seluruh riwayat meleset
  tujuh jam. `toIsoUtc()` yang menormalkannya saat dicerminkan.

- **Jalur cepatnya server sendiri, bukan Cloud Function.** `server/` (Bun + Elysia) memegang API
  key dan menjalankan gate/ungate saat tombolnya ditekan; cron di dalamnya menggantikan
  `scheduledGating`. Antrean RTDB tetap jadi cadangan otomatis — halaman jatuh ke sana sendiri saat
  server tak terjangkau, jadi server yang mati memperlambat gating, tidak mematikannya. Endpoint
  interaktifnya memanggil `applyOneGateCommand`, yang memakai `guardReason` dan `gateCommandUpdate`
  yang **sama** dengan penerap cron: menekan tombol tidak boleh menghasilkan keputusan berbeda dari
  menunggu.
- **Catatan yang sering salah diingat: DRS tidak memblokir fungsi terjadwal.** Yang diblokir adalah
  grant `allUsers`, yaitu jalur browser → Cloud Function. `scheduledGating` selalu bekerja. Yang
  diperbaiki `server/` bukan fungsi yang mati, melainkan latensi dua menit yang lahir dari harus
  lewat antrean.
- **Penyegaran cermin juga menulis kolom Campaign URL di `/sub-domains`**
  (`subDomainCampaignUrls` di [`functions/gating-core.js`](functions/gating-core.js)). Link yang
  dipasang di iklan (`campaignUrl`, `https://rabbitracing.live/{alias}?bit=[race]`) dicermin apa
  adanya dari `/campaigns` — TIDAK disusun dari alias-nya sendiri, karena bentuk itu milik
  vi-control dan salinan kedua akan tetap menghasilkan URL yang tampak benar pada hari domain
  gate-nya berganti.
  - **Ditulis ke baris subdomain, bukan dihitung di browser**, dan itu soal izin: cermin gating
    cuma dilanggan superadmin (isinya nama campaign berikut landing dan decoy URL-nya), sementara
    yang perlu melihat link-nya adalah advertiser yang memasangnya. Dihitung di browser, kolomnya
    kosong untuk semua orang kecuali satu. Karena itu ia juga TIDAK punya kotak isian di form —
    yang diketik akan jadi salinan kedua yang berbeda dari sumbernya begitu sebuah alias berganti.
  - **Join-nya lewat NAMA campaign** (`subDomainOfCampaign`): tujuannya ditulis orang di ujung
    namanya sendiri — "ALDI T2 (WL) QbDw TRAFF (complaints.bispdailyupdates.pk)". Yang membuat
    pembacaan itu bisa dipercaya bukan bentuk namanya melainkan SYARATNYA: sebuah kandidat hanya
    menang kalau ia benar-benar ada di `subDomains`, dan yang tidak terdaftar tidak pernah jadi
    tebakan. Dibaca dari BELAKANG, karena nama yang menyebut hostname lain di tengahnya tidak boleh
    mengalahkan tujuannya. TLD yang hilang ("(coverage.designingaround)") dicocokkan sebagai
    awalan, dan hanya kalau tepat SATU subdomain terdaftar yang cocok — lebih dari satu berarti
    namanya tidak menyebut satu pun dengan pasti.
  - **KODE campaign jadi cadangan, bukan pengganti** (`buildCodeIndex`, indeks yang sama yang
    memetakan spend Meta). Diadu pada 89 campaign yang ada (3 Sep 2026): nama menjawab 70, kode
    51, dan keduanya **tidak pernah berselisih** — jadi ini bukan pilihan antara dua kebenaran,
    melainkan satu yang menjangkau lebih jauh dengan satu lagi menambal sisanya. Yang hanya
    terjawab kode cuma satu: "(fitnes.stylefemale)", salah ketik "fitness".
  - **Yang tidak terjawab keduanya tetap kosong, dan sebabnya ada di luar dashboard**: nama yang
    tidak menyebut tujuan sama sekali ("(SUB)", "(FREE)", "(nama sub)"), dan subdomain yang memang
    belum terdaftar di `/sub-domains` (subsidy/kissan/students/health.bispdailyupdates.pk,
    furniture.dekadeko, bowlsharp.com). Yang kedua keadaan yang sama yang membuat spend-nya tak
    terpetakan, diperbaiki di tempat yang sama.
  - **Yang tidak punya campaign DIKOSONGKAN, bukan dilewati**: link yang bertahan setelah
    campaign-nya dihapus di Keitaro adalah link mati yang mengaku hidup. Yang nilainya tidak
    berubah tidak ikut ditulis — penyegaran sepuluh menitan yang menulis ulang 78 baris subdomain
    membangunkan tiap browser yang sedang membukanya, untuk nilai yang sama.
  - **Yang DIGAMBAR di kolomnya adalah satu link per KODE, bukan seluruh isi selnya**
    (`campaignUrlForCodes` di [`src/lib/campaignUrl.js`](src/lib/campaignUrl.js), lewat `derive`
    seperti `adAccountRows`). Satu subdomain menaungi beberapa campaign, jadi selnya bisa memuat
    lima link sementara yang dicari orang cuma milik kode yang ia pasang di iklannya — dan alias
    Keitaro MEMUAT kodenya di dalam dirinya sendiri ("2W7J" di dalam
    `https://rabbitracing.live/2jvm2W7J?bit=[race]`). Dicocokkan sebagai POTONGAN alias, sengaja
    berbeda dari `parseCampaignCodes` yang mencocokkan kode sebagai token utuh: yang dibaca di sana
    nama campaign yang diketik orang, di mana kode empat huruf akan cocok dengan kata mana pun
    secara kebetulan. Yang TIDAK cocok satu pun dibiarkan utuh — baris yang kolom Kode Campaign-nya
    masih kosong tetap punya link yang dipasang di iklan, dan menyembunyikannya mengosongkan kolom
    justru untuk baris yang paling perlu dilengkapi. Yang tersimpan di RTDB tetap daftar penuhnya:
    menuliskan hasil saringan ke sana berarti link sebuah campaign hilang dari database sampai
    kodenya sempat didaftarkan.
  - **Tombol salin per link, dan hanya di kolom ini.** Link lain di dashboard ini untuk DIBUKA;
    yang ini untuk dipasang di iklan — ia harus berpindah utuh, sementara teksnya digambar
    terpotong ellipsis dan yang menyalinnya dengan menyorot layar kehilangan ujungnya tanpa satu
    pun tanda. Yang berhasil cuma berganti ikon sebentar ("Tersalin"), bukan toast: menyalin
    beberapa baris berturut-turut akan menumpuk toast di layar. Yang GAGAL tetap bersuara — diam di
    sana berarti isi papan klip yang lama yang mendarat di iklannya.

Selengkapnya: [docs/gating.md](docs/gating.md).

## Plugin situs: "tersimpan" tidak berarti "berubah"

Tiap subdomain menjalankan WordPress dengan plugin RabbitROI, dan sejak versi **0.4.7** plugin itu
membuka Management API sendiri. Halaman `/plugin` memakainya untuk mengelola armada dari satu
tempat: landing page, pengaturan iklan, header/footer, dan behaviour.

- **Plugin mengabaikan nilai enum yang tidak sah lalu menjawab 200 + `success: true` berisi nilai
  LAMA.** Itu tertulis di dokumen API-nya sendiri, dan itulah kegagalan paling berbahaya di seluruh
  fitur ini: satu salah ketik menghasilkan "Tersimpan." di layar untuk pengaturan yang tidak berubah
  sama sekali, di halaman yang mengatur iklan. Dua lapis yang menjaganya — `normalizeField`
  (menolak sebelum menyentuh jaringan) dan `unappliedFields` (membandingkan yang dikirim dengan yang
  dijawab situs) di [`functions/plugin-core.js`](functions/plugin-core.js). Hasilnya bertiga status:
  `ok`, `unapplied`, `failed`. Persis seperti `ok`/`aborted`/`problem` di gating, meleburnya
  menghapus satu-satunya hal yang menentukan tindakan berikutnya.
- **POST plugin bersifat partial, dan hanya SELISIHNYA yang boleh dikirim.** `changedValues` di
  [`src/lib/plugin.js`](src/lib/plugin.js) membandingkan form sekarang dengan keadaan saat form
  dibuka. Mengirim seluruh form berarti menulis ulang tiap field dengan nilai yang dibaca beberapa
  menit lalu — dan perubahan orang lain di sela-sela hilang tanpa jejak. Kedua sisi perbandingan
  lewat `toFormValues` dulu, supaya `3` dari satu endpoint dan `"3"` dari endpoint lain tidak
  terbaca sebagai perubahan.
- **Hostname datang dari `subDomains`, TIDAK PERNAH dari request.** Enroll token dibagi ke seluruh
  armada plugin — dititipkan lewat request, satu panggilan sudah cukup untuk menyerahkan kunci yang
  membuka setiap situs kita kepada pemegang host itu. Alasan yang sama menahan `:group`, yang
  disambung mentah jadi segmen alamat: ia harus salah satu dari `PLUGIN_GROUPS`, atau endpoint mana
  pun di plugin bisa dituju — termasuk AutoPost yang sengaja tidak didokumentasikan.
- **Dua node RTDB, dan pemisahannya bukan kerapian.** `pluginSites` (status, dilanggan halaman) dan
  `pluginKeys` (api_key, tidak pernah dilanggan satu pun kode di `src/`). Izin baca RTDB menurun;
  digabung, tiap superadmin yang membuka halaman ini mengunduh seluruh kunci armada ke browsernya
  hanya untuk melihat kolom "Versi". Aturannya **admin**, bukan superadmin — SYNC_USER yang
  menulisnya adalah admin, dan aturan superadmin di sana akan menolak penulisnya sendiri.
- **Kunci sengaja TIDAK dienkripsi.** `POST /manage/reset` — satu-satunya cara meng-enroll ulang —
  membutuhkan kunci LAMA. Rahasia enkripsi yang hilang berarti tiap situs terkunci di
  `already_enrolled` selamanya, dan jalan keluarnya masuk ke WordPress tiap situs satu per satu.
- **Enroll menulis kunci DULU, status sesudahnya; reset membuang kunci hanya setelah situs menjawab
  berhasil.** Dibalik, yang tertinggal adalah situs enrolled tanpa kunci tersimpan — dan itu tidak
  bisa diperbaiki dari dashboard sama sekali. Kalau tulisan kuncinya sendiri yang gagal (aturan
  belum di-deploy, SYNC_USER kehilangan role), `enrollOne` **membatalkan enrollment-nya** memakai
  kunci yang masih ada di memori: setelah baris itu lewat, kesempatan membatalkan hilang selamanya.
- **Halaman ini SUPERADMIN dan tidak punya antrean RTDB sebagai cadangan** — satu-satunya fitur
  begitu. Gating jatuh ke antrean saat server kontrol mati; di sini tidak ada yang bisa diantrekan,
  dan situsnya sendiri tidak menjawab browser (tidak ada header CORS untuk origin dashboard).
  Akibatnya yang menegakkan izin bukan `database.rules.json` melainkan gerbang `requireSuperAdmin`
  di [`server/plugin.js`](server/plugin.js); `SUPERADMIN_PAGES` cuma menyembunyikan menunya.
- **Skema field ditulis SEKALI** (`PLUGIN_SCHEMA`, dikirim lewat `GET /plugin/schema`) — pengecualian
  yang disengaja dari pola `campaignCommandEntry`. Yang di sana selusin baris; yang di sini empat
  puluh field dengan enum dan batasnya, dan yang bergeser tidak berbunyi sebagai kesalahan: form
  akan menawarkan enum yang DITERIMA server tapi diabaikan diam-diam oleh plugin.
- **CMP membalik aturan pertama di atas, dan Keamanan di bawahnya ikut.** Grup `cmp` (sakelar
  `cmp_enabled` + textarea `cmp_code`) MENOLAK nilai yang tidak sah dengan `save_failed` (400)
  alih-alih mengabaikannya — dan yang ditolak adalah SELURUH permintaan: tidak satu field pun
  tertulis, termasuk yang sah di body yang sama. Jadi di tab ini "Tersimpan." benar-benar berarti
  tersimpan. Yang TIDAK ikut berubah karenanya `normalizeField`: penolakan situs sampai ke layar
  sebagai kalimat plugin yang menyebut nama kolom, penolakan di sini menyebut label yang sedang
  dibaca orang di formnya.
  - **Fieldnya DUA, dan yang ketiga menjatuhkan yang lain.** `cmp_referrer_policy` kunci
    penyimpanan internal plugin, bukan parameter API — ikut terkirim, ia menolak permintaan yang
    seluruh isinya sah. Ia tidak ada di `CMP_FIELDS`, dan yang menahannya `toPluginPayload` yang
    cuma meneruskan field terdaftar: penjagaan yang sama yang membuang field asing di grup mana
    pun, cuma di sini akibat lolosnya jauh lebih besar daripada satu nilai yang diabaikan.
  - **`cmp_enabled` bertipe `boolean`, BUKAN `bool01`.** Di grup yang menolak, `0` sebagai angka
    adalah nilai tidak sah — dan yang dibaca orang adalah kegagalan menyimpan untuk sakelar yang
    baru saja ia matikan.
  - **Kotak kode yang DIKOSONGKAN tetap terkirim sebagai string kosong**, bukan dibuang seperti
    enum/int kosong: mengosongkan kode CMP adalah tindakan yang disengaja, dan field yang tidak
    terkirim membuat kode lama bertahan di situs sementara layar menunjukkan kotak kosong.
- **Keamanan (`/manage/security`) menolak dengan cara yang sama, dan DUA fieldnya berubah bentuk di
  jalan.** Grup `security` memegang lima kontrol yang di layar plugin berdiri di LUAR blok behaviour:
  Perilaku Test Mode, VI Gate Beacon, Fake Resume Video, Acak Posisi Video Player, dan Ukuran Slot
  Iklan (GPT). Aturan CMP berlaku utuh — `save_failed` (400) menjatuhkan SELURUH permintaan, nama
  field yang tidak dikenal ikut ditolak begitu, dan `toPluginPayload` yang menahannya.
  - **`video_randpos_interval` DIKIRIM sudah berbentuk `"lo-hi"`, walau `"20"` sah.** Situs
    membacakannya kembali sebagai rentang apa pun yang dikirim: `"20"` tersimpan dan dilaporkan
    `"20-20"`. Dikirim apa adanya, `unappliedFields` membandingkan `"20"` dengan `"20-20"`, tidak
    cocok, lalu melaporkan field yang justru tersimpan DENGAN BENAR sebagai "nilainya ditolak
    diam-diam di sana" — peringatan yang menyuruh orang mengulang sesuatu yang sudah berhasil, di
    satu-satunya penjaga yang halaman ini punya untuk kegagalan yang sungguhan. Tipe `range` yang
    menormalkannya; `"0"` → `"0-0"` berarti mati, maks 60 detik per sisi, dan batas bawah yang
    melebihi batas atas ditolak SEBELUM jaringan.
  - **`gpt_sizes` KOSONG adalah nilai, bukan ketiadaan** — `""` berarti "pakai daftar yang tertulis
    di kode iklan situs", jadi ia dikirim sebagai string kosong alih-alih dijatuhkan seperti
    enum/int kosong. Aturan yang sama persis dengan `cmp_code`. Yang dikirim juga DINORMALKAN (huruf
    `x` dikecilkan, spasi dibuang): `"320X480"` yang dijawab `"320x480"` akan terbaca sebagai nilai
    yang ditolak. Bentuknya `LEBARxTINGGI` dipisah koma (atau `fluid`), maks 20 ukuran, tiap sisi
    20-2000 px — diperiksa di sini karena satu salah ketik di antara dua puluh menjatuhkan field
    lain yang sah di body yang sama.
  - **SEMBUNYIKAN FORM LOGIN TIDAK PUNYA PERMUKAAN API SAMA SEKALI**, dan ketiadaannya disengaja di
    sisi plugin: satu slug yang salah ketik lalu didorong ke seluruh armada mencabut pintu masuk
    wp-admin di tiap host sekaligus, dan tidak ada satu pun endpoint yang bisa mengembalikannya.
    `behaviour_*` juga TIDAK di sini — ia tetap lewat `/manage/behaviour`, karena dua endpoint yang
    menulis kunci yang sama dengan dua aturan validasi berbeda adalah cara tercepat membuat armada
    tidak konsisten.
  - **Fake Resume butuh VI Gate Beacon, dan situs TIDAK mengeluh kalau tidak.** Keduanya sah sebagai
    keadaan tersimpan, jadi resume yang menyala dengan beacon mati tersimpan rapi dan tidak pernah
    berjalan sedetik pun di halaman. Ia `notice` di seksinya — tempat yang sama dengan "butuh Simpan
    Log aktif" di Behaviour, dan alasan yang sama: ketergantungan yang tidak bisa dibaca dari satu
    pun field di layar itu. Seksi Test Mode membawa `notice`-nya sendiri untuk jebakan sebaliknya:
    `respect_behaviour` adalah pilihan yang benar untuk MENGUJI dan salah untuk dibiarkan, karena
    tiap kunjungan test lalu ikut terakumulasi di hitungan behaviour situs itu.
  - **DUA KOLOM, berbeda dari CMP dan Behaviour yang `columns: 1`.** Keduanya satu kolom karena
    isinya satu daftar panjang yang tiap fieldnya butuh baris keterangan sendiri; yang di sini empat
    kontrol yang saling lepas, masing-masing sudah punya fieldset-nya, dan isinya empat saklar plus
    tiga angka pendek. Satu kolom berarti semuanya berderet setinggi dua layar dengan separuh lebar
    tiap baris kosong. Yang melebar penuh cuma `video_randpos_enabled` (saklar induk atas tiga field
    di bawahnya, sepola `behaviour_detection`) dan `gpt_sizes` (yang membedakan satu daftar dua
    puluh ukuran dari daftar lain ada di EKORNYA).
  - Tidak butuh `npm run deploy:rules`: tidak ada satu pun node RTDB baru. Yang perlu di-deploy
    ulang server kontrol (skemanya dikirim dari sana) dan hosting.

### Saklar: satu bentuk, dan yang TIDAK ikut berpindah

[`src/components/ui/Switch.jsx`](src/components/ui/Switch.jsx) adalah satu-satunya bentuk on/off di
dashboard ini. Ia menggantikan kotak centang di tiap tempat yang menyatakan KEADAAN — fitur menyala
atau mati, pengaturan berlaku atau tidak.

- **Rupanya DIBAGI dengan saklar campaign lewat selektor yang sama** di
  [`src/styles.css`](src/styles.css) (`.campaign-switch, .switch-track`), bukan disalin: dua saklar
  yang berbeda beberapa piksel di satu dashboard terbaca sebagai dua kontrol yang berbeda artinya.
  Yang di `/users/{uid}` tetap `<button>` karena ia membawa keadaan yang tidak dimiliki saklar biasa
  — "perintah sudah ditulis, belum sampai ke Meta" yang berkedip — dan itu perbedaan PERILAKU, bukan
  perbedaan rupa.
- **Kotak centang aslinya tidak dibuang melainkan ditumpuk tembus pandang di atas relnya.** Yang
  menerima klik, spasi, dan fokus keyboard tetap `<input>` sungguhan, jadi `<label>` yang
  membungkusnya bekerja tanpa satu baris JS pun dan teks di sebelahnya ikut bisa ditekan. Digambar
  sebagai `<div>` ber-`onClick`, ketiganya harus ditulis ulang satu per satu — dan yang terlewat
  cuma ketahuan oleh orang yang memakai keyboard.
- **YANG TIDAK IKUT BERPINDAH: kotak centang yang MEMILIH.** Pilih-semua dan pilih-baris di tabel
  armada `/plugin`, daftar tujuan terapkan-massal, dan `checkbox-option` (memilih beberapa nilai
  dari satu daftar). Di sana centang berarti "yang ini ikut tindakan berikutnya", bukan "yang ini
  menyala" — dan satu kolom tabel berisi saklar terbaca seolah tiap baris punya setelan sendiri yang
  tersimpan di suatu tempat.
- **TANPA kotak pembungkus** (`.plugin-switch` kehilangan batas dan latarnya). Saklar sudah
  menggambarkan dirinya sendiri sebagai kontrol; dibungkus kotak setinggi 38px seperti kotak isian
  di sebelahnya, ia terbaca sebagai isian yang kebetulan berisi saklar — dan enam saklar berturut-
  turut di grup "Perilaku slot" jadi enam kotak yang bagian dalamnya hampir seluruhnya udara.
  Pembungkusnya TETAP ADA dan tingginya tetap 38px, semata supaya saklar sejajar dengan kotak isian
  yang berdampingan dengannya di grid dua kolom.

### Keterangan field: ikon, bukan baris teks

Keterangan tiap field di form plugin pindah dari baris teks di bawah kotaknya ke ikon **info** di
sebelah namanya — `ColumnHint icon="info"`, komponen yang sama dengan ikon "?" di kepala kolom.
**Kalimat pembuka tiap SEKSI ikut ke sana**, di sebelah legendanya.

- **Sebabnya jumlahnya.** Satu form memuat sampai tiga puluh field dan hampir tiap fieldnya punya
  kalimatnya sendiri; digambar semua sekaligus, yang terbaca bukan keterangannya melainkan dinding
  teks yang memisahkan tiap kotak dari kotak berikutnya sejauh dua baris.
- **Ikonnya BEDA dari yang di kepala kolom, dan itu disengaja.** Dua pertanyaan yang berbeda — "apa
  arti kolom ini" (rumus, "?") dan "apa yang boleh saya isi di sini" (info) — dan satu ikon untuk
  keduanya membuat yang kedua terbaca seperti kolom yang butuh dijelaskan. Yang TIDAK ikut
  bercabang adalah kotaknya: satu bentuk, satu posisi, satu cara menutupnya, satu lapis token.
- **Yang TETAP digambar sebagai teks adalah yang BERUBAH-UBAH**: hitungan kata kunci, umur bacaan,
  jumlah field yang akan dikirim. Itu bukan definisi field melainkan keadaan sekarang, dan keadaan
  yang harus di-hover dulu untuk dibaca sama saja dengan tidak ditampilkan.
- **`optionHelp` pada radio tidak ikut pindah.** Keterangan tiap pilihan justru bagian yang
  MENENTUKAN pilihannya — disembunyikan, yang tersisa tiga nama yang tidak bisa dibedakan.
- **Kalimat pembuka seksi (`sections[].description`) ikut ke ikon, `notice` TIDAK.** Yang pertama
  DEFINISI — tidak berubah dari satu pembacaan ke pembacaan lain, jadi ia memenuhi syarat yang sama
  dengan `help`; digambar sebagai paragraf, tab berseksi empat berarti empat blok teks yang
  memisahkan tiap kelompok isian sejauh dua baris. Yang kedua PERINGATAN atas ketergantungan yang
  tidak terlihat dari field mana pun — tanpa Simpan Log seluruh blok Behaviour diam, tanpa VI Gate
  Beacon Fake Resume tersimpan rapi dan tidak pernah berjalan — dan peringatan yang harus di-hover
  dulu untuk dibaca adalah peringatan yang tidak dibaca siapa pun. Aturan yang sama yang menahan
  `optionHelp` di atas.
- **Ikonnya ikut ukuran LEGENDANYA (12px), bukan ukuran label field (13px).** Di teks yang
  di-uppercase dan berjarak huruf, ikon yang lebih besar daripada hurufnya sendiri terbaca sebagai
  tombol yang menempel pada judul, bukan sebagai keterangan judul itu.

### AutoPost: alamatnya di luar `/manage/`, dan amplop gagalnya lain

Tab **AutoPost** menyuruh situs menulis artikel dari sebuah kata kunci — padanan REST dari halaman
`page=rabbitroi-auto-post` di wp-admin. Kuncinya SAMA (`X-RabbitROI-Key`, dari enroll yang sama),
tapi tidak satu pun lapisan lain boleh dipakai ulang begitu saja. Logikanya di
[`functions/autopost-core.js`](functions/autopost-core.js), jaringannya di
[`functions/autopost-api.mjs`](functions/autopost-api.mjs), sisi UI-nya di
[`src/lib/autopost.js`](src/lib/autopost.js).

- **DUA hal yang membuatnya modul sendiri, dan keduanya diam kalau dipaksa lewat jalur plugin.**
  Pertama, `pluginBaseUrl` menyambung `/wp-json/rabbitroi/v1/manage`; AutoPost tinggal di
  `/wp-json/rabbitroi/v1/autopost`. Lewat yang pertama, tiap permintaan menjawab `rest_no_route`
  (404) — kegagalan yang terbaca persis seperti situs yang belum memasang plugin versi baru. Kedua,
  amplop gagalnya `{ success: false, message, logs }` — pesannya di AKAR, tanpa `error.code` sama
  sekali; `unwrapPlugin` membaca `body.error?.message`, menemukan `undefined`, dan mengganti sebab
  yang benar-benar berguna ("Error Gemini: API key not valid") dengan "Plugin menjawab tanpa kode".
  Untuk kegagalan AI itu satu-satunya keterangan yang ada, jadi `logs` ikut dibawa ke dalam error.
  Yang TIDAK berbeda dipakai ulang apa adanya: `PluginError` (supaya `pluginFailureStatus` tetap
  memetakan kegagalan situs jadi 502 dan bukan 401 milik kita), `pluginHostname`, dan
  `normalizeField` berikut seluruh tipenya.
- **`rest_no_route` punya kalimatnya sendiri.** Ia satu-satunya kode di sini yang TIDAK berarti ada
  yang salah dengan kunci maupun situsnya, melainkan bahwa pluginnya belum punya AutoPost. Dilebur
  dengan `invalid_key`, orang akan menekan Reset — yang membuang kunci yang masih sah — untuk situs
  yang cuma perlu diperbarui.
- **TIDAK masuk `PLUGIN_GROUPS`, dan punya route-nya sendiri.** Daftar itu daftar putih untuk
  `:group`, yang disambung mentah jadi segmen DI DALAM `/manage/` — menambahkannya ke sana
  menghasilkan alamat yang salah sambil membuka kembali jalan yang daftar itu ada untuk menutupnya.
  Skemanya digabung di route `/plugin/schema` dan bukan di dalam `PLUGIN_SCHEMA` sendiri:
  `autopost-core.js` mengimpor `plugin-core.js`, jadi arah sebaliknya menutup lingkaran impor.
- **SELURUH field dikirim, bukan selisihnya — kebalikan dari lima tab pengaturan.** Sebabnya bisa
  disebut: POST-nya tidak partial dan tidak ada apa pun di situs yang dibaca lebih dulu, jadi field
  yang tidak dikirim jatuh ke bawaan REST alih-alih ke nilai lama. Mengirim hanya yang berubah
  berarti apa yang tergambar di layar berhenti sama dengan apa yang berangkat. Karena itu juga enum
  di tab ini bertanda `required`: kotak "(tidak diubah)" hanya benar untuk POST yang partial.
- **Bawaan form adalah kolom "Default REST" di Lampiran E.2, dengan SATU penyimpangan yang
  disengaja.** Bawaan REST berbeda dari bawaan layar wp-admin di TIGA tempat; dua mengikuti REST
  (`penjadwalan` → `1_hours`, `generate_image` → `false`), satu mengikuti layar plugin
  (`tag_otomatis` → **`true`**, walau REST menjawab `false` kalau tidak dikirim).
  **Yang membedakan kedua sakelar itu HARGA menyalakannya, bukan selera.** `generate_image` menambah
  satu tahap tersendiri ke tiap job — `featured_image` di 75%, yang men-scrape Bing dan bisa gagal
  sendiri — jadi menyalakannya untuk seluruh armada adalah keputusan yang harus diambil orang, bukan
  yang diwarisi dari kotak yang tidak ia sentuh. `tag_otomatis` tidak menambah panggilan apa pun:
  tag datang bersama jawaban AI yang sama, dan artikel tanpa tag adalah kerugian yang baru terbaca
  berminggu-minggu kemudian di halaman arsip yang tidak punya satu pun jalan masuk.
  Nilainya TIDAK menentukan apa pun (seluruh field selalu dikirim), dan justru itu yang membuat
  penyimpangan ini boleh ada: ia menggeser sakelar yang TERLIHAT, bukan perilaku yang tersembunyi.
  Yang tidak boleh adalah menyimpang tanpa menuliskannya — satu-satunya cara memeriksa daftar ini
  adalah mengadunya dengan dokumen, dan tes `autopost-core.test.mjs` menyebut tiap nilainya supaya
  penyimpangan BARU tidak bisa lolos diam-diam.
- **DUA field sengaja TIDAK ada di skema.** `ai_key` kredensial — di skema, ia ikut tiap jalur yang
  menyimpan nilai form (cache antar-tab, "terapkan ke situs lain", riwayat alamat) tanpa satu pun
  keputusan yang menyebutkannya. `keyword` bukan setelan melainkan ISI permintaan; digambar sebagai
  field skema, ia akan ikut "terapkan ke situs lain" seolah ia sebuah pengaturan yang menempel di
  situs — padahal menyalinnya ke sepuluh situs berarti menulis sepuluh artikel, bukan menyeragamkan
  sepuluh pengaturan.
- **Kunci AI di BODY, tidak pernah di alamat, dan di `localStorage` hanya kalau diminta.** Alamat
  masuk ke log akses server, riwayat browser, dan header `Referer` — tiga tempat yang tidak satu pun
  dijaga sekeras body request. RTDB juga tidak: `pluginKeys` memuat kunci yang KITA terbitkan,
  sementara yang ini ditagihkan per panggilan kepada pemiliknya. `server/.env` juga tidak: satu
  kunci untuk seluruh armada berarti satu tagihan yang tidak bisa dipisahkan per orang. Yang tersisa
  `localStorage` perangkat itu, dengan kotak centang yang bawaannya MATI — menyimpan kredensial
  diam-diam adalah keputusan yang dibuat atas nama orang lain.
- **Satu request = satu kata kunci = satu artikel.** Tidak ada endpoint batch, jadi `submitAutopost`
  yang mengulanginya dengan pool `AUTOPOST_CONCURRENCY` (5) — jauh lebih kecil daripada
  `PLUGIN_CONCURRENCY` dan bukan karena permintaannya berat: `POST /autopost` menjawab 202 dalam
  sepersekian detik lalu meninggalkan satu proses PHP hidup sampai artikelnya selesai. Yang dibatasi
  bukan lalu lintas kita melainkan berapa penulis artikel yang berjalan bersamaan di satu shared
  hosting, dan yang jatuh kalau kelewatan bukan job-nya melainkan situsnya — untuk pengunjung yang
  sedang datang dari iklan berbayar.
  - **Payload seluruh daftar disusun DI DEPAN.** Setelan yang salah ditolak dengan nol artikel
    terlanjur dibuat, bukan setelah tiga puluh di antaranya sudah berjalan.
  - **Satu kata kunci yang ditolak tidak menjatuhkan sisanya**, dan alasannya lebih keras daripada
    di terapkan-massal: job yang sudah lahir TIDAK BISA DITARIK KEMBALI. Mengulang batch dari awal
    karena satu baris gagal menghasilkan artikel ganda untuk separuh daftar — AutoPost memang tidak
    punya dedup sama sekali.
  - **Duplikat dibuang sebelum dikirim, dan pemecahnya per BARIS saja** (`autopostKeywords`,
    dicerminkan di `src/lib/autopost.js` sepola `campaignCommandEntry`). Sengaja berbeda dari
    `mediaList`, yang memecah per koma juga: kata kunci long-tail memuat koma ("seo plugin, gratis
    atau berbayar"), dan yang dipecah di sana jadi dua potongan kalimat yang tidak berarti apa-apa
    sendirian.
  - **Cermin status ditulis SEKALI di akhir**, bukan per kata kunci: `pluginSites` dilanggan
    halaman, dan lima puluh tulisan berturut-turut membangunkan tiap browser yang membukanya lima
    puluh kali untuk satu tindakan. Sebagian gagal TIDAK menandai situsnya merah — kegagalan per
    kata kunci sudah berdiri di tabelnya sendiri, dan lencana merah karena satu kuota AI habis
    mengirim orang memeriksa WordPress yang sehat.
  - **Yang job-nya LAHIR dibuang dari kotak isian; yang ditolak tetap berdiri**
    (`dropPostedKeywords` + `postedKeywords` di [`src/lib/autopost.js`](src/lib/autopost.js)). Itu
    yang menjadikan "perbaiki lalu kirim lagi" satu tindakan alih-alih mengetik ulang — dan yang
    menahannya jadi berbahaya: AutoPost tidak punya dedup, jadi menekan Kirim untuk daftar yang
    isinya tidak berubah menghasilkan artikel KEDUA untuk tiap kata kunci yang sudah berhasil.
    Sebelum ini, satu-satunya yang mencegahnya adalah ingatan orang tentang baris mana saja yang
    tadi gagal.
    - **MEMBUANG yang berhasil, bukan MENGGANTI isinya dengan daftar yang gagal**, dan bedanya baru
      terlihat pada satu keadaan yang benar-benar terjadi: pengiriman lima puluh kata kunci
      berlangsung beberapa detik, dan yang diketik orang ke kotak itu selama menunggu akan lenyap
      kalau isinya ditimpa. Lewat updater `setKeywordText(current => ...)`, bukan dari daftar yang
      tertangkap saat tombolnya ditekan.
    - **Dicocokkan tanpa memandang kapitalisasi**, sepola `autopostKeywords`: dua baris yang cuma
      berbeda huruf besar-kecil dikirim sebagai SATU job, jadi keduanya ikut hilang begitu job itu
      lahir. Yang tertinggal kalau tidak adalah baris yang tampak belum terkirim untuk artikel yang
      sudah jadi.
    - **Cabang `catch` TIDAK menyentuh kotak isian sama sekali.** Yang sampai ke sana ditolak
      SEBELUM satu job pun dikirim (setelan tidak sah, kunci situs hilang, jaringan putus) — itu
      seluruh gunanya payload disusun di depan — jadi membuang apa pun di sana berarti menghapus
      kata kunci yang tidak pernah terkirim ke mana-mana.
    - **Nasib daftarnya DISEBUT di toast** (`submitMessage`) dan di peringatan atas tabel job. Kotak
      isian berubah sendiri sesudah tombolnya ditekan, dan perubahan yang tidak diumumkan pada kotak
      yang baru saja diisi orang terbaca seperti isinya hilang.
- **Job dibaca saat dibuka, TIDAK PERNAH dicerminkan** — sepola panel ad set dan tab DNS Record,
  ditambah satu yang khusus: masa simpannya di sisi plugin cuma 24 jam, jadi mencerminkannya berarti
  dashboard menyimpan riwayat yang sumbernya sudah tidak ada untuk dibandingkan.
  - **`GET /autopost/jobs` TIDAK lewat `withMirror`, satu-satunya pembacaan plugin yang begitu.** Ia
    di-poll tiap beberapa detik; lewat cermin, satu tab yang dibiarkan terbuka menulis ke
    `pluginSites` setiap tiga detik — ke node yang DILANGGAN halaman itu sendiri, jadi tiap tulisan
    menggambar ulang seluruh tabel armada di tiap browser yang membukanya.
  - **Polling BERHENTI SENDIRI** begitu tidak ada job berjalan, dan jedanya melebar 3 → 15 detik.
    Tahap terpanjang menunggu jawaban AI sampai dua menit tanpa satu pun perubahan yang terbaca.
    Job yang mati tanpa kabar tetap berakhir — plugin memindahkannya ke `stalled` sendiri setelah
    `stale_seconds` — jadi polling ini punya ujung walau tidak ada satu pun job yang selesai dengan
    benar.
  - **Log ditarik saat barisnya DIBUKA**, tidak ikut daftarnya: `/jobs` tanpa `include_logs`
    mengganti `logs` dengan `log_count`, dan satu job yang berjalan lima menit menumpuk puluhan
    baris.
  - **`stalled` TIDAK dilebur ke "Gagal".** Keduanya `status: "failed"` di sisi plugin tapi menuntut
    tindakan yang berbeda: gagal biasa punya sebab yang tertulis dan bisa diperbaiki (kunci AI,
    kuota, kategori), sementara `stalled` berarti proses PHP-nya dibunuh server — tidak ada yang
    salah dengan permintaannya, dan yang perlu dilakukan cuma mengirimnya lagi. Dilebur, orang akan
    memeriksa kunci AI yang tidak pernah bermasalah.
  - **Yang DITOLAK sebelum jadi job berdiri terpisah** dari daftar job: job yang lahir punya
    `job_id` dan bisa dipantau, yang ditolak tidak ada di sisi situs sama sekali — dicampur, satu
    daftar akan memuat baris yang tidak akan pernah berubah statusnya.
- **`requested` dan `total` dibawa KEDUANYA dari pembuatan kata kunci.** AI kerap mengembalikan
  lebih sedikit dari yang diminta, dan daftar 13 baris untuk 20 yang diminta tampak lengkap tanpa
  kedua angka itu berdampingan. Hasilnya DITAMBAHKAN ke daftar yang sudah ada, bukan menimpanya:
  tiap panggilan ditagihkan, dan daftar yang ditimpa berarti hasil yang sudah dibayar hilang karena
  seseorang menekan tombolnya sekali lagi dengan kata dasar yang lain. Batas tunggunya sendiri (90
  detik, bukan 20): memutus koneksi berarti membayar panggilan AI yang hasilnya dibuang, lalu orang
  yang melihat kegagalannya menekannya lagi dan membayarnya dua kali.
- **Form Kata Kunci berdiri PALING ATAS**, dan kunci AI ikut di dalamnya. Yang di atas menentukan
  BERAPA artikel yang lahir; seluruh fieldset di bawahnya cuma menentukan bentuk tiap artikelnya.
  Kuncinya di sana karena ia yang pertama diisi — pembuatan kata kunci sudah membutuhkannya, sebelum
  satu setelan artikel pun disentuh.
- **DUA kolom: yang sedang disusun di kiri, yang sudah terkirim di kanan.** Bertumpuk, daftar job
  berdiri di bawah form setinggi dua layar — dan yang paling perlu dilihat setelah menekan Kirim
  justru ada di luar layar, jadi satu-satunya cara mengetahui job-nya benar-benar lahir adalah
  menggulir turun tiap kali. Kolom kanan mengambil SISANYA dan bukan lebar tetap seperti panel
  Kalender: isinya tabel berkolom lima, dan lebar tetap 320px menjadikannya gulungan mendatar yang
  tidak menampilkan satu kolom pun secara utuh. Di bawah 1180px keduanya kembali bertumpuk — batas
  yang sama dengan Kalender.
  - **Tombol Segarkan BERPUTAR untuk pembacaan yang diminta orang, dan DIAM untuk putaran
    polling.** Panel ini membaca situs WordPress lewat server kontrol — sedetik lebih di shared
    hosting — dan tombol yang cuma jadi abu-abu tidak bisa dibedakan dari tombol yang memang tidak
    boleh ditekan. Tapi indikator yang menyala tiap tiga detik selama ada job berjalan berhenti
    berarti "sedang membaca sekarang"; putaran latar sudah punya penjelasnya sendiri di kalimat
    "Daftar ini menyegarkan dirinya...". `.icon-spin` yang sama dengan indikator sync di topbar,
    jadi ia berhenti sendiri di bawah `prefers-reduced-motion`.
  - **Lebar tiap kolom tabel job DIBATASI (`table-layout: fixed`).** Keterangan di bawah pil
    "Berhenti" tidak punya satu pun titik potong, jadi tanpa batas itu ia melebarkan kolom Status
    sampai 400px dan mendorong kolom **Hasil** — satu-satunya yang memuat tautan ke artikelnya —
    keluar layar. Yang terdorong keluar bukan kolom yang bisa diabaikan melainkan yang jadi alasan
    tabel ini ada.
- **Bawaan form diisi SAAT SKEMANYA DATANG, bukan saat komponennya lahir.** Skema diambil sekali per
  sesi lewat `GET /plugin/schema`, jadi pada render pertama ia masih `null` — dan nilai awal yang
  dihitung di situ menghasilkan form KOSONG yang tidak pernah terisi sesudahnya. Yang terlihat cuma
  kotak kosong; yang benar-benar terjadi adalah `bahasa: ""` dan `gaya_bahasa: ""` ikut terkirim ke
  AI, karena form mengirim seluruh fieldnya dan bawaan di sisi server hanya berlaku untuk field yang
  TIDAK ADA di body. Karena itu juga cache antar-tab tidak menitipkan nilai yang masih `null`:
  dibaca komponen berikutnya sebagai "sudah ada isinya", ia menahan pengisi bawaannya sendiri.
- Tidak butuh `npm run deploy:rules`: tidak ada satu pun node RTDB baru. Yang perlu di-deploy ulang
  server kontrol (skemanya dikirim dari sana) dan hosting.

### Tab AdX: pilih subdomain, unit iklannya dibaca dari Ad Manager

Tab **AdX** di `/plugin` (`/plugin/adx`; tab lainnya **Daftar Plugin** dan **AdSense**, alamat lama
`/plugin/inject-kode` dialihkan ke sini). TIDAK ADA kotak
untuk menempel kode Ad Manager, unit iklan, maupun div id: admin memilih subdomain, lalu yang tampil
adalah akun GAM-nya (network code, properti) dan slot iklan network itu. Logikanya di
[`functions/gpt-inject-core.js`](functions/gpt-inject-core.js), I/O-nya `gptNetworksFor`,
`previewGptSite`, dan `injectGptOne` di [`functions/sync-plugin.mjs`](functions/sync-plugin.mjs),
route-nya `/plugin/gpt/networks`, `/plugin/gpt/preview`, dan `/plugin/bulk/gpt-inject` di
[`server/plugin.js`](server/plugin.js).

- **Subdomain → akun GAM lewat DOMAIN** (`gamAccountForSite`): `gamAccounts.name` = `parentDomain`,
  cadangannya akhiran hostname — hanya kalau tepat satu akun cocok. Subdomain tanpa akun GAM (mis.
  dekadeko.com) disebut dan tidak ikut, dan TIDAK ditandai bermasalah di cermin status plugin: yang
  kurang data dashboard, bukan WordPress-nya.
- **Unit iklannya DIBACA dari Ad Manager API (`adUnits`), tidak dirakit.** Kode `ca-pub-…-tag` BUKAN
  Publisher ID akun: designingaround.com ber-properti `ca-pub-8660742543707970` sementara unit Ad
  Exchange-nya `ca-pub-9198385730397674-tag` (14 Sep 2026). `gptUnitChoices` membuang unit akar, wadah
  properti (`hasChildren`), in-app (`ca-mb-app-…`), Offerwall, dan yang tidak ACTIVE; bawaannya unit
  Ad Exchange Display. Ketujuh network punya tepat satu; masseffectstore.com punya empat unit
  tambahan (header, incontent_ads, bottom_anchor, interstitial) yang bisa dipilih.
- **Path unit TANPA level properti**: API mencatat unit Ad Exchange di bawah `ca-pub-ANGKA`, tapi tag
  yang di-generate Ad Manager berbunyi `/23352267851/ca-pub-9198385730397674-tag` — wadah `ca-pub-ANGKA`
  dilewati. **Belum diadu dengan layar Generate tags untuk unit buatan sendiri** (`/NETWORK/header`);
  periksa sekali sebelum dipakai massal.
- **Request tidak pernah membawa path unit maupun div id.** Yang dibawanya `adUnitCodes`
  (`{ networkCode: adUnitCode }`), dan server mencari kodenya di daftar Ad Manager sebelum menyusun apa
  pun (`pickGptUnit`, 422 kalau tidak ada). Unit di-cache per NETWORK per permintaan — tiga puluh
  subdomain satu network adalah satu panggilan `adUnits`.
- **Div id BERSTEMPEL WAKTU, SATU STEMPEL PER SUBDOMAIN** (`div-gpt-ad-{epoch milidetik}-N`, mis.
  `div-gpt-ad-1789368958539-0`), persis bentuk Generate tags — atas permintaan pemilik repo,
  menggantikan awalan tetap per network. Stempel satu-untuk-semua sempat dipakai sehari dan dibuang:
  tujuannya justru tiap situs punya tagnya sendiri. `gptStampClock` membagikannya berurutan dan SELALU
  naik, jadi situs yang disusun di milidetik yang sama tetap berbeda. Dibuat server SAAT PRATINJAU dan
  dikirim balik saat inject (`options.divStamps` = `{ subdomainId: stempel }`, digit saja — disambung
  ke string JavaScript di header); yang tidak dikirim dibuatkan baru. **Harga yang diketahui**: dulu
  inject ulang menulis div id yang sama dengan body lama, sehingga situs yang gagal di antara tulisan
  header dan kode iklan tetap tayang; sekarang slotnya kosong sampai inject diulang.
- **Pratinjau memuat SELURUH subdomain tujuan** (`previewGptSites`), satu baris ringkas per situs —
  nama, `div-gpt-ad-{stempel}-0…N`, dan path unit — dengan kode lengkapnya di balik collapse (yang
  pertama terbuka, "Buka semua/Tutup semua" di atasnya). Pemilih "pratinjau untuk subdomain" dibuang:
  dengan stempel per situs tidak ada satu kode yang mewakili yang lain. Kegagalan per situs jadi baris
  merah dan MENGUNCI tombol Inject; pratinjau basi begitu pilihan ATAU daftar subdomainnya berubah.
- **Pengurai dan penyusunnya SATU, di server.** Pratinjau disusun `/gpt/preview` untuk seluruh
  subdomain terpilih. Tombol Inject mati begitu pilihan
  berbeda dari pratinjau (`gptSpecKey` memuat ukuran, slot, dan unit per network).
- **Header situs DIBACA dulu, blok GPT-nya saja yang diganti** (`mergeGptHeader`): header memuat CMP
  dan analytics. Blok yang ditulis TANPA penanda komentar — bentuknya persis tag Ad Manager — dan
  inject berikutnya menemukan blok GPT (loader gpt.js + `<script>` berisi `defineSlot`, entah dari
  inject sebelumnya atau tempelan tangan) lewat pola, lalu membuangnya UTUH (`replaced`, potongannya
  disebut di hasil); tanpa GPT sama sekali ditaruh di ujung (`appended`). Penanda komentar yang
  sempat ditulis versi pertama (14 Sep 2026) dibuang sendiri saat inject berikutnya
  (`LEGACY_MARKERS`).
- **Kode iklan 1…N ditimpa body baru; sesudahnya dikosongkan HANYA kalau isinya `googletag.display`.**
  AdSense `<ins>` tidak disentuh. "Jumlah slot iklan" SELALU disetel = N, tanpa saklar — jumlah slot yang dipilih adalah jumlah slot
  iklannya. Maks
  **5 slot** — plugin punya lima kotak kode iklan.
- **Header ditulis LEBIH DULU**, dan yang setengah jadi disebut di pesan barisnya.
- **"Periksa dulu" (`dryRun`) membaca tiap situs dan melaporkan rencananya tanpa satu POST pun.**
- **Template ukuran: empat bawaan di kode** ([`src/lib/gptInject.js`](src/lib/gptInject.js)), **"Ukuran
  unit terpilih"** (dari `adUnitSizes` Ad Manager, hanya kalau pilihannya satu network), **plus yang
  disimpan orang di `dashboard/gptSizeTemplates`** (superadmin, arsip bukan hapus, nama unik). **"Ukuran kustom" bisa DIPILIH** (mengosongkan daftar
  ukuran untuk disusun dari nol) dan kotak "Simpan sebagai template" tampil HANYA saat dropdown berbunyi
  "Ukuran kustom" — daftar yang sama dengan template atau ukuran unit tidak punya apa pun yang baru. Template tersimpan yang disunting
  bisa **diperbarui** ukurannya (`gptTemplateSizesUpdate`, nama tetap); bawaan tidak. Yang
  menolak ukuran tidak sah cuma server (`parseGptSizes`).
- **Pemilih subdomainnya react-select multi dengan perilaku bawaannya** — tanpa checkbox, yang sudah
  dipilih jadi chip dan hilang dari daftar. Dipakai `unstyled` + `classNamePrefix="rs"`, jadi seluruh
  rupanya di `src/styles.css` lewat token — gaya inline bawaannya ber-hex dan tidak ikut tema gelap.
  Tab ini dimuat **lazy**: react-select + emotion ~36 kB gzip yang tanpa pemisahan itu ikut diunduh
  setiap akun untuk tab superadmin.
- **Ukuran ditulis literal di `defineSlot`, TIDAK lewat `window.__rbtSizes`.**
- Butuh `npm run deploy:rules` (node template), deploy ulang server kontrol, dan hosting.

#### Tab AdSense: kodenya DITEMPEL, karena slotnya tidak bisa dibuat lewat API

Tab ketiga `/plugin` (`/plugin/adsense`) — TAB SENDIRI, bukan mode di tab AdX: alurnya berbeda dari
akarnya (disusun vs ditempel), dan yang dibawa orang ke sana sudah menyebut jenisnya. Logikanya di
[`functions/adsense-inject-core.js`](functions/adsense-inject-core.js), I/O-nya `checkAdsenseSite` dan
`injectAdsenseOne` di [`functions/sync-plugin.mjs`](functions/sync-plugin.mjs), form-nya
[`src/components/plugin/AdsenseInject.jsx`](src/components/plugin/AdsenseInject.jsx).

- **`adunits.create` TERTUTUP untuk kita, dan itu sudah diperiksa** (14 Sep 2026): "can be called only
  by a restricted set of projects, which are usually owned by AdSense for Platforms publishers", dan
  kredensial kita ber-scope `adsense.readonly`. Yang terbuka `adunits.list` dan `getAdcode` — keduanya
  menjawab 200 untuk ketiga akun yang dicoba. Jadi unit barunya lahir di halaman AdSense, dan yang
  diisi superadmin adalah KODE UTUH per kotak.
- **Header TIDAK disentuh** — keputusan pemilik repo: yang ditulis cuma Kode iklan 1…N +
  `jumlah_iklan` = N. Kode AdSense membawa loader-nya sendiri; blok GPT yang tertinggal di header
  tidak dibersihkan mode ini.
- **Pengurainya DAFTAR PUTIH, di server saja**: loader `adsbygoogle.js`, tepat satu
  `<ins class="adsbygoogle">` berslot, dan `push({})`. Script lain ditolak — kode ini ditulis mentah ke
  halaman bertrafik berbayar. Auto ads (tanpa `data-ad-slot`) ditolak dengan namanya; satu subdomain =
  satu `data-ad-client`; kotak kosong di TENGAH ditolak (Jumlah slot = N akan menggambar slot kosong).
- **Slot DICOCOKKAN dengan ad unit akun itu**, dan dua jawabannya tidak setara. Akun yang TERBACA dan
  tidak memuat slotnya → ditolak 422: satu digit yang meleset tersimpan rapi di WordPress dan
  menghasilkan kotak iklan kosong tanpa satu error pun. Akun yang TIDAK terbaca (publisher tidak ada di
  /adsense-accounts maupun /gam-accounts, atau kredensialnya tanpa scope AdSense) → tidak ditolak,
  berbunyi "belum terverifikasi" berikut sebabnya: yang kurang data dashboard, bukan kodenya.
- **Subdomain yang ditawarkan hanya yang akun AdSense-nya terdaftar di /adsense-accounts**
  (`adsenseSitesFor`, `GET /plugin/adsense/sites`), dicocokkan lewat daftar SITUS tiap akun di AdSense
  API — bukan `googleCredential` (nama config yang kebetulan berbunyi seperti domain) dan bukan
  `parentDomain` yang diketik. Host yang sama dengan situs akun atau berakhiran `.{situs}` milik akun
  itu; situs terpanjang menang. Akun yang gagal dibaca DISEBUT di form, bukan dijatuhkan diam-diam —
  tanpa itu seluruh subdomainnya hilang dari pilihan dan terbaca seperti tidak punya AdSense. Per 14 Sep
  2026 kesembilan akun terbaca dan menaungi seluruh 114 subdomain aktif.
- **Kode per SUBDOMAIN, bukan satu kode untuk seluruh pilihan** — unit AdSense dibuat per subdomain
  ("petcins 1", "cathealth-2"). "Salin ke semua subdomain" untuk yang berbagi unit.
- **Disimpan di `dashboard/adsenseSlots/{subdomainId}`** (admin — SYNC_USER Setup Sub ikut menulisnya; ditulis browser sesudah inject
  yang BERHASIL, bukan sesudah Periksa), dan form mengisi dirinya dari sana. Kodenya tidak bisa dibaca
  balik dari mana pun selain WordPress situs itu satu per satu.
- Butuh `npm run deploy:rules` (node `adsenseSlots`), deploy ulang server kontrol, dan hosting.

#### Tab Cek Situs: lima pemeriksaan, dibaca langsung dari situs

Tab keempat `/plugin` (`/plugin/cek`). Pilih **Domain** (seluruh subdomainnya ikut) atau beberapa
**Subdomain** (`?mode=`, `?domain=`, `?cek=`), lalu tiap situs dibaca dan dinilai: kode iklan, CMP,
mode tampilan iklan, network ID AdX, landing page, behaviour. Penilaiannya di
[`functions/plugin-audit-core.js`](functions/plugin-audit-core.js), I/O-nya `auditOne`/`auditSites`
di [`functions/sync-plugin.mjs`](functions/sync-plugin.mjs), route `POST /plugin/audit`, tabnya
[`src/components/plugin/SiteAudit.jsx`](src/components/plugin/SiteAudit.jsx).

- **Tidak menulis apa pun ke situs**, dan hasilnya TIDAK tinggal di alamat: bacaan langsung yang
  dikembalikan dari alamat adalah keadaan kemarin yang mengaku sekarang.
- **Penilaiannya tidak dicerminkan ke `src/`** — halaman cuma menggambar status yang diputuskan server.
- **Grup yang gagal dibaca = `error` ("Tidak terbaca") berikut sebabnya, bukan `fail`**, dan tidak
  menjatuhkan situsnya: plugin versi lama tanpa endpoint CMP tetap punya kode iklan yang bisa dinilai.
  Situs yang SELURUH bacaannya gagal jadi baris gagal dan tercatat di cermin status.
- **Kode iklan dinilai di kotak 1…N (N = Jumlah slot iklan)**, bukan jumlah kotak berisi: kotak sesudah
  N tidak pernah digambar. Untuk GPT, div yang di-`display` tapi tidak di-`defineSlot` = gagal.
- **Network ID hanya untuk tag GPT** (`na` untuk AdSense), dibaca dari `defineSlot` di header DAN kotak
  kode iklan, diadu dengan `networkCode` akun GAM lewat `gamAccountForSite` yang sama dengan tab AdX.
  Akun GAM yang tidak ditemukan `warn` (data dashboard), bukan `fail`.
- **Tidak ada kolom Hasil / vonis tunggal per situs** — lima pemeriksaan diperbaiki di lima tempat, dan
  satu label "perlu dicek" cuma mengulang warna sel tanpa menyebut yang mana. Keadaan yang membuat
  kolom lain kosong ("Belum terhubung", "Tidak terbaca") berdiri di bawah nama subdomain.
- **Warna badge**: Kode Iklan yang lolos diwarnai JENISNYA (AdX biru, AdSense ungu — bukan hijau,
  yang sudah berarti "lolos" di kolom sebelahnya); CMP On hijau, Off kuning (`auditBadgeTone`).
- **CMP On TIDAK menuntut Kode CMP terisi** — aturan itu sempat menandai seluruh 16 subdomain
  sheetz.us yang sehat. CMP Off dan Behaviour Off = `warn`; Behaviour On tanpa Simpan Log aktif, atau
  redirect tanpa URL, juga `warn`. "Nonaktifkan" memuat "aktif", jadi Simpan Log dicocokkan di AWAL kata.
- **Mode Tampilan dibaca dari `ads-settings.mode_tampilan`**, enumnya dari `ADS_FIELDS` yang sama dengan
  tab Pengaturan Iklan. Ketiga mode sah, jadi badgenya NETRAL (bukan hijau); yang `warn` cuma kosong
  atau nilai di luar enum.
- **Dikirim per gelombang 10 subdomain** (`AUDIT_BATCH`, route maks 20): tiap situs lima bacaan, dan
  satu domain besar dalam satu request melewati batas tunggu nginx. Tabelnya terisi bertahap.
- **Mode Domain hanya menggambar subdomain yang terhubung ke plugin** — yang belum terhubung (mis.
  domain induk "sheetz.us" sendiri) tidak punya apa pun untuk dicek. Jumlahnya tetap disebut di
  ringkasan ("n belum terhubung tidak ditampilkan"), supaya tabel yang lebih pendek dari /sub-domains
  punya penjelasan. Mode Subdomain tetap menggambar apa yang dipilih, terhubung atau tidak.
- Tidak butuh `npm run deploy:rules`. Yang perlu di-deploy ulang server kontrol dan hosting.

#### Tab Setup Situs + landing dari preset: onboarding sub baru

Tab **Setup Situs** di halaman satu situs `/plugin?situs=…&tab=setup` — urutan onboarding dokumen
API plugin: **Lisensi** (`/manage/license`), **Setting Sub** (`/manage/deployment`), **Halaman
Legal** (`/manage/legal-pages`). Tab Setup Sub di /plugin menautkan ke sini untuk baris yang
selesai. Klien di [`functions/plugin-api.mjs`](functions/plugin-api.mjs), pembungkus di
`sync-plugin.mjs`, aturan murni (`deploymentTasks`, `legalPageList`, `deploymentOutcome`,
`legalOutcome`, `landingLink`) di [`functions/plugin-core.js`](functions/plugin-core.js), tabnya
[`src/components/plugin/SiteSetup.jsx`](src/components/plugin/SiteSetup.jsx).

- **Setting Sub dan Halaman Legal jalan DI LATAR** (sampai 10 menit; nginx memutus di 60 detik).
  Statusnya di `subDomains/{id}/siteTasks/{deployment|legal}` — BUKAN di `pluginSites`, yang ditulis
  ulang utuh oleh `pluginSiteRow` dan akan menghapusnya. Tidak ada node baru, tidak butuh
  `deploy:rules`.
- **Hasil 200 bisa sebagian gagal** — `state` dibaca dari hitungan per task/halaman
  (`done`/`partial`/`failed`), bukan dari status HTTP.
- **Setting Sub destruktif**: task daftar putih, kosong ditolak di server JUGA, dan dialog
  konfirmasinya menyebut tiap task. `dropin` tidak dicentang bawaan (sepola "all" di plugin).
- **Kunci AI & license key hanya lewat body ke situs**, tidak ditulis ke RTDB (dijaga tes).
- **Menu (task `menus`) bagian SENDIRI, bukan centang di Setting Sub** (`POST /plugin/sites/:id/menus`,
  status di `siteTasks/menus`): ia tidak destruktif, di luar "all", dan harus PALING AKHIR — isinya
  dirakit dari kategori ber-post dan Page publish, jadi sebelum halaman legal + AutoPost ia sukses
  dengan menu berisi Home saja. Yang digambar sebagai "jadi" adalah `menus.ok` dari GET deployment,
  bukan `ok` task-nya.
- **Landing "Buat dari preset"** (`/manage/landing/create`) dan tombol **Tautan** per landing
  menampilkan URL, parameter (`parameter_key=parameter_value`, diacak situs), dan tautan lengkap
  `url?kunci=nilai` — masing-masing bisa disalin. Tanpa retry: tanpa slug, retry = landing kembar.
- **Preset tidak mengisi URL cloaking dan menulis jeda video 0-0**, jadi `createSiteLanding`
  menyusulkan update partial: satu URL ACAK dari tab **URL Cloaking** (`/plugin/cloaking`,
  `dashboard/cloakingUrls`) + `timer_auto_pause_video` = `PRESET_VIDEO_PAUSE` (15-30). Yang gagal
  di sana tidak melempar (landing-nya sudah lahir) — dialog tautan menyebutnya. Isi awal:
  `npm run seed:cloaking-urls` (idempotent, `--dry`).

Selengkapnya: [docs/plugin.md](docs/plugin.md).

## DNS Cloudflare: dibaca saat dibuka, tidak pernah dicerminkan

Tab **DNS Record** (`/dns-records`, di bawah Domains) memuat zona Cloudflare tiap domain berikut
record DNS-nya — dibaca, ditambah, disunting, dan dihapus dari dashboard. Aturan apa yang boleh
ditulis ada di [`functions/cloudflare-core.js`](functions/cloudflare-core.js), panggilan API-nya di
[`functions/cloudflare.js`](functions/cloudflare.js), route-nya di
[`server/cloudflare.js`](server/cloudflare.js), dan aturan tampilannya di
[`src/lib/cloudflareDns.js`](src/lib/cloudflareDns.js).

- **SUPERADMIN saja, dan ia tab yang LEBIH KETAT daripada induknya** — /domains terbaca tiap akun
  yang login. Yang dilarang aturan tab adalah arah sebaliknya; preseden yang sama ada di "Calon
  Penerima" di /notifications, yang juga membawa `key` sendiri supaya alamat yang diketik tangan
  tidak membukanya untuk siapa saja. Yang membuatnya tidak mengulangi masalah Whitelist Top-Up di
  bawah Ad Accounts (induk yang tersisa satu tab, yaitu bukan tab sama sekali): /domains sudah punya
  Sub Domains, jadi yang bukan superadmin tetap melihat dua tab.
  Kenapa superadmin dan bukan admin: satu record A yang dihapus membuat sebuah subdomain berhenti
  menjawab pada detik itu juga, dan trafik iklan yang sedang berjalan ke sana mendarat di nama yang
  tidak ada — tidak ada satu pun sistem di jalurnya yang menolak, karena DNS memang kerjanya begitu.
- **Token Cloudflare tinggal di server, dan alasannya lebih keras daripada di vi-control**: key
  vi-control mengubah tujuan trafik satu sistem, token ini menentukan ke mana SETIAP domain kita
  menunjuk. Tidak ada satu pun pemanggil `functions/cloudflare.js` di `src/`. `CLOUDFLARE_API_TOKEN`
  + `CLOUDFLARE_ACCOUNT_ID` di `.env` server; kosong = hanya tab ini yang mati (503 ber-`code`
  `no_token`, dan halamannya menyebutkan apa yang kurang), sepola `PLUGIN_ENROLL_TOKEN`.
- **TIDAK ADA CERMIN RTDB dan tidak ada antrean cadangan.** Yang kedua sepola `/plugin` (token
  tinggal di server, dan Cloudflare tidak mengirim header CORS untuk origin dashboard); yang pertama
  sepola panel ad set — yang dicari orang di layar ini adalah keadaan DNS pada detik ini, dan cermin
  sejam lalu justru jawaban yang salah. Konsekuensinya diketahui: tanpa server kontrol tab ini tidak
  bisa dibuka sama sekali, dan yang digambar adalah sebabnya, bukan tabel kosong yang terbaca
  seperti zona tanpa record. Umur bacaannya DISEBUTKAN di atas tabel, dan penyegaran yang GAGAL
  tidak mengosongkan daftar yang sudah tergambar.
- **Zona dibaca ULANG dari Cloudflare tiap operasi, tidak pernah dipercaya dari request**
  (`zoneOf`). Dua hal yang dijaganya sekaligus: KEPEMILIKAN — tanpa itu endpoint ini jadi editor DNS
  untuk zona mana pun yang bisa disentuh token kita, cukup dengan mengoper id zona milik akun lain,
  prinsip yang sama dengan `campaignRowOf` — dan NAMA zonanya, yang dipakai melengkapi nama record.
  Zona di luar akun menjawab **404**, dan record-nya tidak pernah disentuh.
- **Nama record dilengkapi di SATU tempat** (`dnsRecordName`), dan itu bukan kerapian: yang diketik
  orang hampir selalu bagian depannya saja ("care"), sementara yang disalin dari kolom di sebelahnya
  adalah nama penuh — dan tanpa penormalan, yang kedua menjadi `care.petcins.com.petcins.com`, yang
  DITERIMA Cloudflare dan tidak menjawab apa pun. "@" berarti akar zona.
- **Proxy MEMAKSA TTL Auto, dan itu aturan Cloudflare bukan pilihan kita.** Dikirim bersama TTL
  lain, permintaannya ditolak seluruhnya — dan yang dibaca orang adalah kegagalan menyimpan untuk
  kotak TTL yang bahkan tidak ia sentuh. **TTL `1` berarti "Auto", bukan satu detik**, dan itu
  seluruh alasan `ttlLabel` ada: digambar apa adanya, kolomnya mengabarkan satu detik kepada
  pembacanya — angka yang akan dikejar sebagai kesalahan yang tidak ada. Di form ia kotak KOSONG,
  bukan angka 1, karena "1" mengundang orang menggantinya jadi 60.
- **Kotak Proxy TIDAK DIGAMBAR untuk tipe yang tidak bisa diproxy, bukan digambar lalu dimatikan.**
  Kotak mati terbaca sebagai izin yang kurang; yang benar adalah proxy memang tidak punya arti untuk
  record yang jawabannya bukan alamat tujuan HTTP — `proxied: true` pada TXT ditolak Cloudflare, dan
  pada MX ia MENGHANCURKAN surat masuk domain itu tanpa satu pun pesan kesalahan. Nilai sisa dari
  tipe sebelumnya DIPADAMKAN di sisi server alih-alih ditolak: menolaknya berarti pesan kesalahan
  tentang kotak yang tidak ada di layar.
- **Tipe record DAFTAR PUTIH, bukan daftar hitam** (`DNS_TYPES`, enam tipe). Cloudflare mengenal dua
  puluhan, dan daftar hitam yang meleset membuka tipe yang bentuk `content`-nya tidak diperiksa satu
  pun aturan — yang lalu ditolak Cloudflare dengan pesan yang cuma menyebut nomor kode.
  **CNAME ke alamat IP ditolak berikut jalan keluarnya** ("pakai record A"): ia kesalahan paling
  tenang di DNS — diterima sebagai teks oleh sebagian editor, dan tidak pernah menjawab apa pun.
- **Yang dicerminkan ke `src/` cuma TIGA konstanta** — daftar tipe, tipe yang bisa diproxy, dan
  batas TTL — karena form harus menggambar pilihannya sebelum ada satu permintaan pun dikirim.
  Dijaga `src/lib/cloudflareDns.test.mjs`, yang membaca berkas seberangnya, persis pola
  `campaignCommandEntry`. Yang TIDAK dicerminkan adalah pemeriksaan isinya (bentuk IPv4, hostname,
  rentang TTL): salinan kedua dari aturan yang MENOLAK sesuatu akan berselisih suatu hari, dan yang
  lebih longgar menang tanpa berbunyi. Form mengirim lalu menggambar penolakan server apa adanya.
- **Sunting memakai PUT, bukan PATCH — kebalikan yang disengaja dari POST partial di `/plugin`.**
  PATCH menambal field yang disebutkan saja, jadi kotak yang DIKOSONGKAN orang (komentar, priority)
  tidak akan pernah benar-benar terhapus: nilai lamanya bertahan di Cloudflare sementara layar
  menunjukkan kotak kosong. Bedanya dengan /plugin ada pada apa yang dibaca form — di sana form
  dibuka atas keadaan yang bisa berubah di sela-sela oleh orang lain, sehingga hanya SELISIHNYA yang
  boleh dikirim; di sini satu record adalah satu baris utuh yang baru saja dibaca ulang.
- **Hapus lewat POST `/delete`, bukan `DELETE`.** CORS server kontrol mengizinkan `GET` dan `POST`
  saja, dan daftar itu berlaku untuk SETIAP endpoint di sana — melebarkannya demi satu route berarti
  mengubah aturan yang menjaga gate/ungate dan saklar campaign juga. `/delete` sebagai segmen di
  ujung dan bukan POST ke alamat record itu sendiri: alamat itu sudah berarti "sunting", dan dua
  arti untuk satu alamat yang dibedakan isi body-nya adalah cara sebuah penyuntingan yang body-nya
  gagal terurai menghapus record yang sedang disunting.
- **`success: false` dengan HTTP 200 dibaca sebagai GAGAL.** Bentuk yang benar-benar dipakai
  Cloudflare, dan kegagalan diam yang sebentuk dengan plugin yang menjawab 200 berisi nilai lama:
  dibaca dari status HTTP-nya saja, layar berbunyi "Tersimpan." untuk record yang tidak pernah
  berubah. **Yang salah di sisi ORANG jadi 422, yang salah di sisi KITA jadi 502**
  (`cloudflareFailureStatus`) — token yang ditolak tidak bisa dikerjakan siapa pun di layar itu,
  jadi ia tidak boleh menyamar sebagai kesalahan pengisian.
- **Sesudah berhasil, panelnya DIBACA ULANG — bukan ditambal di layar**, sepola saklar ad set.
  Cloudflare menormalkan sendiri apa yang disimpannya (nama dilengkapi, TTL dipaksa Auto saat proxy
  menyala), jadi menambal baris dengan nilai yang DIKIRIM berarti layar menyebut sesuatu yang
  berbeda dari yang benar-benar tersimpan.
- **Zona yang belum punya baris di /domains tetap TAMPIL, ditandai** — bukan disaring. Yang
  menentukan sebuah zona bisa disunting dari sini adalah Cloudflare, bukan ada tidaknya barisnya di
  dashboard; daftar yang membuangnya menyembunyikan domain yang DNS-nya hidup dari satu-satunya
  layar yang bisa memperbaikinya. `domainUrl` diketik orang, jadi penjodohannya lewat `hostOf`
  (membuang skema, `www.`, dan garis miring) — tanpa itu, "https://petcins.com" berbunyi "belum
  terdaftar" untuk domain yang jelas-jelas ada di tab sebelah.
- **SATU-SATUNYA kesimpulan yang ditarik halaman ini adalah subdomain terdaftar yang tidak punya
  record pengarah**, dan ia MENYERAH begitu zona itu punya wildcard. Subdomain tanpa record A/AAAA/
  CNAME tidak bisa dijangkau siapa pun — trafik iklannya mendarat di nama yang tidak menjawab — dan
  itu tidak berbunyi sebagai apa pun di dashboard, cuma sebagai earning nol. Tapi satu `*.domain`
  menjawab tiap nama yang tidak punya record sendiri, jadi daftar itu akan menuduh subdomain yang
  justru sedang bekerja: sepola `earningKnown`, yang tidak bisa dipastikan tidak dinilai.
- **Menghapus record punya dialog konfirmasi yang MENYEBUTKAN nama dan isinya**, dan menyebutkan
  secara khusus kalau namanya terdaftar di /sub-domains. Konfirmasi yang cuma bertanya "yakin?"
  tidak memberi kesempatan siapa pun menyadari bahwa yang tersorot barusan adalah baris di
  sebelahnya.
- **Zona yang token-nya hanya bisa membaca digambar TANPA tombol tulis**, dibaca dari `permissions`
  yang dikirim Cloudflare per zona — sepola kolom "Izin" di /google-api-configs, dan alasan yang
  sama: tombol yang pasti ditolak lebih buruk daripada tombol yang tidak ada. `permissions` yang
  tidak dikirim sama sekali dianggap boleh menulis; yang salah di situ bukan izinnya melainkan
  bentuk jawabannya, dan menyembunyikan tombol karenanya membuat halaman tampak hanya-baca untuk
  token yang sebenarnya penuh.
- Tidak butuh `npm run deploy:rules`: tidak ada satu pun node RTDB yang ditulis fitur ini.

## Setup Sub: satu tombol dari baris /sub-domains sampai plugin ter-enroll

Tab **Setup Sub** (`/plugin/setup-sub`, di bawah Plugin — superadmin sama persis dengan induknya; alamat lama `/setup-sub` dialihkan) memasang subdomain yang sudah
terdaftar ke server CloudPanel: A record Cloudflare → site PHP 8.3 + WordPress → SSL Let's Encrypt →
plugin RabbitROI + enroll. Route-nya [`server/setup-sub.js`](server/setup-sub.js), sisi CloudPanel
[`server/cloudpanel/rabbitroi-setup-sub.sh`](server/cloudpanel/rabbitroi-setup-sub.sh).

- **Run harian lewat KUNCI, tanpa password.** Server kontrol SSH dengan kunci yang DIKUNCI ke satu
  perintah (`authorized_keys` `restrict,command=` → `rabbitroi-setup-sub-ssh`), dan sudoers cuma
  mengizinkan satu skrip. Argumennya dua (host, email admin) dan diperiksa pola di KEDUA sisi.
- **Server baru di-bootstrap OTOMATIS dengan login bersama** (`bootstrapServer`,
  `SETUP_SUB_ROOT_USER`/`SETUP_SUB_ROOT_PASSWORD` — di armada ini `rabbitroi` + password, ber-sudo):
  seluruh server berbagi user dan password yang sama. Begitu kunci ditolak (ssh exit 255 +
  "Permission denied"), server kontrol login lewat `SSH_ASKPASS`, naik ke root lewat `sudo -S`
  (password di baris pertama stdin, tidak pernah di argumen proses — `bootstrapCommand`), menulis
  ketiga skrip `cloudpanel/` lewat `bash -s`,
  menjalankan `bootstrap.sh`, lalu mengulang run-nya lewat kunci. **Harga yang diketahui**: password
  armada tinggal di `.env` server kontrol (kutip tunggal: nilainya memuat `$#`), dan dikirim ke IP apex zona Cloudflare mana pun
  yang belum menerima kunci — zona yang apex-nya menunjuk hosting pihak ketiga ikut menerimanya.
  Kosong = server baru disiapkan manual (`bootstrap-remote.sh <IP>`).
- **Skrip di server diperbarui SENDIRI lewat sidiknya, bukan dikirim untuk dijalankan.** Tiap run
  membawa sha256 `rabbitroi-setup-sub.sh` versi server kontrol (`setupScriptSha`, argumen ketiga);
  skrip yang berbeda menjawab `OUTDATED` (exit 3) sebelum menyentuh apa pun, dan server kontrol
  menjalankan ulang bootstrap lalu mengulang run-nya. Kuncinya tetap cuma bisa menjalankan skrip
  yang TERPASANG — kalau kodenya ikut stdin, kunci itu jadi root untuk kode apa pun. Yang diadu
  cuma skrip setup; ubahan di pembungkus ssh atau `bootstrap.sh` saja tidak memicu pemasangan ulang.
- **Hostname dari `subDomains/{id}`, tidak pernah dari request** — sepola enroll plugin.
- **Bulk = satu ANTREAN BERURUTAN di server** (`POST /setup-sub/bulk`, maks 50; route satuan
  lewat antrean yang sama). Tiap run memanggil clpctl, reload nginx, dan Let's Encrypt di satu mesin
  yang melayani trafik berbayar — paralel berarti reload serentak. Yang menunggu berstatus `queued`
  ("Antre"); id yang tidak ada / masih jalan DISEBUT (`skipped`) tanpa menjatuhkan sisanya. Pilihan
  di UI tinggal di alamat (`?sub=a,b`). Antrean hidup di memori proses: restart server kontrol
  membuang yang belum jalan, dan barisnya jatuh basi sesudah `STALE_MS` sehingga bisa dikirim ulang.
- **Berjalan di latar; kemajuannya di `subDomains/{id}/setup`** (`state`: running/done/partial/
  failed), node yang sudah dilanggan — tidak ada node RTDB baru, tidak butuh `deploy:rules`.
- **Sesudah enroll, langkah situs ikut dari tombol yang sama** (opsional, per langkah): Setting Sub
  → Halaman Legal → AutoPost → Menu — urutan onboarding plugin: `trash` harus sebelum halaman dan
  artikel lahir, menu harus sesudah keduanya. Jalan di antrean KEDUA (`siteQueue`), dan baru MULAI
  sesudah antrean CloudPanel KOSONG (`cloudPending`, step "Menunggu server"): `clpctl site:add:php`
  untuk sub berikutnya me-reload PHP-FPM di server yang sama, dan request yang sedang berjalan
  terputus jadi 502 "tanpa JSON" — 23 Sep 2026 tiga sub gagal di Halaman Legal persis selama sub
  sesudahnya dibuat. Harganya: bulk mengisi situs sesudah seluruh sub dibuat; menu menunggu job
  AutoPost yang DIKIRIM run itu selesai (maks 45 menit, sisanya disebut dan jadi `partial`), lalu
  jadi-tidaknya dibaca dari `menus.ok` GET deployment. Hasil tiap langkah juga ditulis ke
  `siteTasks/{kind}`, jadi tab Setup Situs menggambar keadaan yang sama. AutoPost PER SUB (menyala bawaan): hanya kata
  kunci dasar + total + bahasa — kata kuncinya dibuat `/autopost/keywords` di situs itu SESUDAH plugin
  terpasang, lalu langsung dikirim jadi artikel. Tidak ada daftar manual maupun tombol Generate di
  form: generator plugin butuh situs yang sudah hidup, dan sub yang di-setup belum punya. Teks
  satu-per-baris tetap diterima server dari bundle lama. Generator membawa `bahasa` per sub (dipilih lewat
  `SelectField`, 22 bahasa; di plugin field-nya teks bebas, jadi bahasa baru cukup ditambah ke daftar). Setelan artikel (`AUTOPOST_FIELDS`, seluruh field
  dokumen) satu untuk seluruh sub, diisi bawaan saat skemanya datang, dikirim sebagai `autopostValues`
  dan diperiksa `toAutopostPayload` DI DEPAN — yang salah 422 sebelum Setting Sub membuang isi situs. Kunci AI DUA — `legalAiKey` dan `autopostAiKey`, tiap
  kotaknya di grup langkahnya sendiri, karena keduanya bisa ditagihkan ke akun AI berbeda (localStorage
  juga terpisah: `rabbitroi.legal.aiKey` / `rabbitroi.autopost.aiKey`). Hanya lewat body; langkah yang
  kuncinya kosong 422. `aiKey` tunggal masih diterima sebagai cadangan untuk bundle lama.
  Setting Sub, Halaman Legal, dan Menu MENYALA bawaan (AutoPost tidak — kata kuncinya per sub);
  Setting Sub tetap dikonfirmasi dialog karena destruktif.
- **"Kode Iklan" menggantikan "Atur Header & Footer"** di Pengaturan domain, dan tanpa satu field pun:
  ia memanggil `injectGptOne` yang SAMA dengan tab AdX (unit bawaan dari Ad Manager akun GAM
  domainnya, template "Semua ukuran Ad Manager" + 3 slot dikirim dari `BUILT_IN_GPT_TEMPLATES`, div id
  berstempel per sub). Header/footer tidak diketik rata satu domain karena tag GPT-nya milik tiap sub.
  **AdX atau AdSense diputuskan SERVER lewat `gamAccountsForSite`** (pencocokan yang sama dengan tab
  AdX): domain punya akun GAM → AdX; tidak → AdSense lewat `injectAdsenseOne` dari kode yang DITEMPEL
  per sub (`adsenseCodes`, Kode iklan 1…N — slot AdSense tidak bisa dibuat lewat API). Form cuma
  menggambar kotak tempelnya untuk sub tanpa akun GAM (`hasGamAccount`, cerminan tampilan saja).
  AdSense tanpa kode = dilewati + `partial`. **Kode yang BERHASIL tertulis disimpan server ke
  `dashboard/adsenseSlots/{id}`** (bentuk yang sama dengan `saveAdsenseSlots`), jadi tab AdSense
  terisi kode sub ini; karena penulisnya SYNC_USER, `.write` node itu dilonggarkan ke admin — sepola
  `pluginSites` (butuh `npm run deploy:rules`). Gagal apa pun di langkah ini dicatat dan TIDAK
  menghentikan langkah lain.
  **"Landing page dari preset"** memanggil `createSiteLanding` yang sama dengan "Buat dari preset",
  SESUDAH artikel AutoPost (preset mengisi URL artikel situs) dan menu; tautannya di
  `setup.landingLink`. Keduanya menyala bawaan.
  **"Campaign Keitaro + gate"** (menyala bawaan, hanya bersama landing) memanggil `keitaroSiteCreator`
  di [`server/keitaro.js`](server/keitaro.js) — fungsi yang SAMA dengan tombol di dialog Tautan
  landing — dengan tautan landing tadi: landing Keitaro → salinan campaign template → kode ke
  `campaignCodes` → gate vi-control. Namanya `{PIC} T2 (WL) {kode} ({host})`, PIC huruf besar dari
  `subDomains.pic` (`keitaroNamePrefix`); sub tanpa PIC ditolak sebelum Keitaro disentuh (`partial`).
  Gagal atau gate bukan `ok` = `partial`, dan yang sudah lahir disebut; tidak diulang otomatis.
- **Judul situs = label paling kiri, huruf pertama kapital** (`${LABELS[0]^}`) — itu yang digambar
  `wp-block-site-title`. Situs lama yang judulnya masih domain penuh atau label huruf kecil ikut
  dibetulkan run berikutnya; judul pilihan orang tidak disentuh.
- **Permalink diset `/%postname%/` kalau masih Plain** — tanpa itu `/wp-json/` menjawab halaman depan (HTML 200) dan enroll gagal "tanpa JSON".
- **Idempotent**: tiap langkah skrip memeriksa hasilnya sudah ada. SSL yang gagal (DNS belum
  menjalar) = `partial`, dan menekan tombol yang sama mengulangnya.
- **A record hanya DIBUAT, tidak pernah diubah**: nama yang sudah punya A/AAAA/CNAME ke tempat lain
  disebut di keterangan dan dibiarkan — mengarahkan ulang nama hidup adalah urusan tab DNS Record.
- **Plugin DISALIN dari situs lain di server yang sama** (versi tertinggi); server yang belum
  punya satu pun memasang `rabbitroi.zip` dari rilis TERBARU repo privat
  `budiisiregar/RabbitRacing-Plugin` — zip rilis, bukan arsip kode (repo-nya butuh `composer
  install`). **Token GitHub HANYA di server kontrol** (`PLUGIN_GITHUB_TOKEN`): zip-nya diunduh di
  sana (dicermin per asset id, `pluginZipFetcher`) lalu dikirim lewat STDIN SSH yang sama. Server
  CloudPanel berbagi root dengan puluhan situs, jadi token di sana berarti satu server bobol membuka
  seluruh source plugin. Skripnya selalu menghabiskan stdin dan menghapus zip-nya di EXIT.
  Sesudahnya plugin memperbarui diri lewat /plugin.
- **Login admin WordPress situs BARU seragam** (`SETUP_SUB_WP_ADMIN_USER`/`_PASSWORD`), dikirim
  sebagai DUA BARIS PERTAMA stdin di depan zip (`wpAdminHeader`) — bukan argumen, yang terbaca di
  daftar proses dan log sudo. Kosong = `rabbitroi` + acak. Situs yang sudah terpasang tidak disentuh.
- **Kredensial WordPress tidak pernah sampai ke dashboard** — `/root/rabbitroi-sites/{domain}.txt`
  di server CloudPanel (root, 600). RTDB `subDomains` terbaca tiap akun yang login.
- **Server = IP A record DOMAIN INDUK, tanpa daftar server** (`pickServer`): satu domain tinggal di
  satu server, dan user/password-nya sama di semua server, jadi IP-nya cukup. Bukan mayoritas record
  zona — sisa record ke server lain ikut menariknya. Apex tanpa A record DITOLAK, bukan ditebak.
  `SETUP_SUB_SERVERS` (daftar nama=user@ip) sudah tidak dibaca; `setup.server` berisi IP-nya.
- Env server kontrol: `SETUP_SUB_SSH_USER` (bawaan `rabbitroi`), `SETUP_SUB_SSH_KEY` — SATU kunci
  untuk semua server (di bawah `/opt/rabbitroi-control`, bukan `/root`: unitnya `ProtectHome=true`;
  `known_hosts` dan `askpass.sh` di sebelahnya), `SETUP_SUB_ROOT_USER`/`SETUP_SUB_ROOT_PASSWORD`
  (bootstrap), `PLUGIN_GITHUB_TOKEN` (PAT fine-grained, Contents read-only, satu repo), dan
  `CLOUDFLARE_API_TOKEN` — tanpanya server tujuan tidak bisa dibaca sama sekali. Server tujuan
  wajib sudah ber-CloudPanel (clpctl, WP-CLI, PHP 8.3); `bootstrap.sh` menolak yang belum.

## CORS server kontrol: daftar izin, dan wildcard yang harus tetap terbaca

Origin yang boleh memanggil `server/` datang dari `ALLOWED_ORIGINS`, diurai
[`server/origins.js`](server/origins.js). Bukan `origin: true` (yang berarti `*`): endpoint di sana
mengubah trafik iklan yang hidup, dan meski tiap request tetap butuh ID token superadmin, CORS yang
terbuka berarti halaman mana pun bisa mencoba memakai token yang sedang aktif di browser.

- **Entri boleh berpola `https://*.contoh.com`, dan `*` HANYA jadi label paling kiri.** Wildcard di
  tengah (`https://a.*.com`) tidak ditawarkan bukan karena sulit melainkan karena ia tidak punya
  arti yang bisa dibaca sekali lihat — dan yang harus bisa dibaca sekali lihat dari daftar izin
  justru siapa saja yang masuk.
- **Polanya DIJANGKARKAN di kedua ujung, dan titiknya di-escape.** Tanpa `^...$`,
  `https://*.contoh.com` cocok dengan `https://a.contoh.com.penyerang.id`; tanpa escape, ia cocok
  dengan `https://a.contohXcom`. Keduanya domain yang bisa didaftarkan siapa saja hari ini, dan
  keduanya tidak berbunyi sebagai apa pun — yang salah baru terlihat pada hari ada yang memakainya.
- **APEX TIDAK IKUT**, sepola sertifikat wildcard: `https://*.contoh.com` tidak menerima
  `https://contoh.com`. Kalau ia juga boleh, ia ditulis sebagai entri tersendiri — menebaknya
  berarti daftar izin memuat satu nama yang tidak tertulis di mana pun. Sebaliknya, KEDALAMANNYA
  ikut (`a.b.contoh.com`): "semua subdomain" memang berarti sampai ke dalam.
- **Skema ikut dicocokkan.** `https://*.contoh.com` tidak menerima `http://` — origin yang sama
  lewat HTTP adalah halaman yang isinya bisa disisipi siapa pun di jalur jaringannya.
- **Wildcard yang menyisakan SATU label MELEMPAR saat start** (`https://*.live` = seluruh TLD).
  Bentuk itu lahir dari satu label yang terhapus saat menyunting, bukan dari niat — dan dibiarkan
  lolos ia jadi CORS terbuka yang tertulis seperti CORS tertutup: log start tetap mencetak satu
  baris yang tampak wajar, dan tidak ada satu pun permintaan yang gagal untuk mengabarkannya. Yang
  diperiksa cuma entri berbentuk wildcard; entri string biasa tidak disentuh, jadi tidak ada
  konfigurasi yang sudah jalan hari ini yang bisa mulai menolak naik karenanya.
- **Tujuan mendarat sesudah consent Google TIDAK boleh diambil dari `ORIGINS[0]` lagi.** Sejak
  daftar ini boleh memuat pola, entri pertama bisa berupa wildcard — dan yang mendarat sesudah OAuth
  diarahkan ke `https://*.contoh.com`, alamat yang tidak pernah ada. `landingOrigin` yang memilih
  alamat sungguhan pertama; kegagalannya kalau tidak akan jauh dari sebabnya, karena yang berubah
  satu koma di `ALLOWED_ORIGINS` sementara yang rusak login Google.
- **nginx sengaja TIDAK menulis header CORS.** Dua lapis yang sama-sama menulis
  `Access-Control-Allow-Origin` menghasilkan header ganda, dan browser menolak keduanya. Elysia satu-
  satunya yang menulisnya, jadi `ALLOWED_ORIGINS` benar-benar satu tempat.
- **Daftarnya ENV, bukan kode**, dan kedua instansi punya daftarnya sendiri (`.env`, `.env.jon`).
  Bawaan di `index.js` cuma berlaku kalau env-nya tidak diisi sama sekali — mengubah bawaan tanpa
  mengubah env berarti tidak mengubah apa pun di produksi.

## OTP: secret tersimpan, kode tidak

`/otp` adalah daftar akun yang 2FA-nya dipegang bersama — nama, secret, dan kode enam angkanya di
kolom tabel yang berganti sendiri. Menambah lewat halaman terpisah `/otp/new` (tombol "Tambah"),
sepola dengan `/targets/new`.

- **Superadmin di kedua lapis, dan di sini itu benar-benar ditegakkan.** `SUPERADMIN_PAGES`
  menyembunyikan menu dan halamannya; `.read`/`.write` pada `otpSecrets` di `database.rules.json`
  yang menolak sisanya — satu-satunya node dengan `.read` sekeras itu. Berbeda dari `/plugin` (yang
  dijaga gerbang server) dan gating (yang dijaga `.validate` pada perintah), di sini yang dijaga
  adalah ISI node-nya: secret TOTP adalah setengah dari kunci sebuah akun, dan izin baca RTDB
  menurun — disimpan di bawah `users` atau `adAccounts`, ia ikut terbaca semua yang boleh membaca
  koleksi itu. Aturan barunya perlu `npm run deploy:rules`.
- **Yang tersimpan hanya secret-nya; kodenya tidak pernah.** Kode dihitung di browser tiap langkah
  waktu dan tidak melewati server mana pun. Kode yang ikut tersimpan adalah kode yang masih terbaca
  lama setelah ia kedaluwarsa.
- **Tidak dienkripsi**, sepola dengan `pluginKeys` dan `passwordAkun`: yang menjaganya aturan
  database, bukan sandi kedua yang hilang bersama orang yang menyimpannya.
- **Bentuknya tidak dipilih orang: 6 digit, 30 detik, SHA-1.** Google Authenticator dan Meta
  sama-sama TOTP baku, dan Google Authenticator bahkan MENGABAIKAN parameter lain di URI. Form
  tambah hanya meminta nama dan secret; digits/period/algorithm diambil dari URI `otpauth://` kalau
  URI-nya menyebut lain (dan barisnya menyebutkan itu di layar), dari `DEFAULT_OTP` untuk sisanya.
- **Yang murni dihitung tinggal di [`src/lib/otp.js`](src/lib/otp.js).** Secret dari layar
  authenticator datang berkelompok empat, dan otplib menolaknya mentah-mentah — `normalizeSecret`
  yang membereskannya, dan `parseOtpInput` juga menerima URI `otpauth://` utuh berikut
  digits/period/algorithm-nya (HOTP ditolak dengan sebabnya, bukan dihitung sebagai TOTP).
- **Guardrail otplib diturunkan ke 10 byte** (`createGuardrails({ MIN_SECRET_BYTES: 10 })`). Bawaan
  v13 adalah 16 byte sesuai anjuran RFC 4226, sementara secret yang benar-benar diberikan Google dan
  Meta adalah 16 KARAKTER Base32 = 10 byte. Tanpa penurunan itu, halaman ini gagal justru untuk akun
  yang paling sering dibuka.
- **Waktunya UTC, bukan zona operasi** — satu-satunya pengecualian dari aturan `zonedDateKey` di
  seluruh repo ini. TOTP dihitung dari epoch, dan itulah yang membuat kodenya sama dengan kode di
  ponsel.
- **Satu jam untuk seluruh tabel**, bukan satu interval per baris: semua baris berganti bersamaan,
  dan kodenya dihitung ulang saat langkah waktunya berganti — bukan tiap detak.
- **Dimuat lazy di `main.jsx`**, alasan yang sama dengan Overview: otplib + @noble/hashes +
  @scure/base adalah 13 kB gzip yang tidak dipakai satu baris pun di luar halaman ini. Form
  tambahnya chunk terpisah yang tidak memuat otplib sama sekali.

## Laba Rugi: satu rantai, dan dua potongan yang tarifnya per pemilik

`/profit-loss` mengikuti rantai Cash Flow Statement yang selama ini dihitung di spreadsheet
(referensinya di `ProfitLoss/`), bukan rumus yang lebih pendek. Baris sidebar-nya bernama
**Accounting** — ia menaungi lima tab lain (Cash Flow, Invalid Traffic, Cost Ad Exchange,
Expenses, Whitelist Top-Up) — sementara halaman dan tab pertamanya tetap bernama **Laba Rugi**,
karena yang dibuka di sana adalah laporan itu sendiri dan bukan seluruh isi grupnya.

```
Laba kotor       = Pendapatan − (Belanja iklan + Pajak iklan)
Net profit       = Laba kotor − Potongan Company − Invalid Traffic − Potongan pencairan
                   − Pengeluaran operasional
Net income owner = Net profit − Bonus advertiser
```

- **Totalnya dari `dashboard/weeklyFinancials`; rinciannya dari `dashboard/roiReports`.** Yang
  pertama berskala usaha (tiap network, tiap ad account, tanpa syarat pemetaan campaign); yang
  kedua satu-satunya yang tahu uangnya milik domain dan orang yang mana. Dua potongan di rantai itu
  bertarif **per pemilik** dan karena itu tidak bisa dihitung dari total: Company Ad Exchange dari
  `companyPercents` (20% di satu domain, 10% di domain lain), bonus dari `users.bonusPercent`
  (10–15%, dasarnya net profit orang itu sendiri).
- **Selisih keduanya tidak disembunyikan.** `coverageGap` = pendapatan yang tidak punya baris ROI;
  ia tidak ikut dipotong maupun dibonuskan, dan halamannya menyebutkan itu alih-alih diam-diam
  memotong nol.
  - **UNTUK APRIL–JULI 2026 ANGKA ITU TIDAK BERARTI APA YANG DIKATAKANNYA.** `weeklyFinancials`
    bulan-bulan itu DIISI DARI SPREADSHEET (lihat `migrate:weekly-financials` di bawah), jadi yang
    dibandingkan bukan API dengan API melainkan angka KETIKAN dengan `roiReports`. Juli 2026
    berbunyi `coverageGap` Rp 713.982, dan diadu ke API produksi (5 Sep 2026) seluruh situs
    berearning yang tidak punya baris di `subDomains` cuma berjumlah **Rp 7** — jadi tidak ada
    subdomain yang hilang; yang berbeda adalah angka yang diketik orang. Mengejarnya di
    /sub-domains tidak akan menemukan apa pun.
  - **Sisi BELANJA-nya bahkan bisa MINUS**, dan itu tanda paling terang bahwa pembandingnya bukan
    API: Juli 2026 menaruh Rp 140.319.979 belanja di baris ROI atas total usaha Rp 139.251.408 —
    yang terpetakan melebihi totalnya sendiri sebesar Rp 1,07 juta, keadaan yang mustahil kalau
    keduanya lahir dari sumber yang sama.
  - **Bulan yang `weeklyFinancials`-nya benar-benar dari sync cocok sampai NOL RUPIAH**, dan itu
    yang membuktikan aritmetikanya sendiri tidak salah: Agustus 2026 berbunyi Rp 92.770.617 di
    kedua sisi — padahal `syncFinancials` menjumlahkan belanja harian per AD ACCOUNT
    (`fetchDailySpend`) sementara baris ROI menjumlahkan insight per CAMPAIGN yang dipetakan lewat
    kodenya. Dua endpoint Meta yang berbeda, satu angka.
  - **Selisih belanja di bulan yang dari sync ADALAH coverage gap yang sungguhan**: campaign yang
    kodenya belum terdaftar di `subDomains.campaignCodes`. September 2026 berbunyi −Rp 1.576.575
    karena itu, dan yang memperbaikinya `migrate:campaign-codes` — bukan tebakan tentang situs
    yang hilang.
- **Potongan Company kena pendapatan Ad Exchange saja (AdX + Ad Server), BUKAN AdSense.** Pada
  Juli, memotong seluruh earning stylefemale.com dengan 10% menghasilkan Rp102.038 lebih banyak
  daripada yang benar-benar dipotong — persis 10% dari pendapatan AdSense-nya. Baris yang tidak
  membawa rincian sumber jatuh ke earning penuh.
- **Tarif yang kosong bukan 0%.** Hari yang belum punya tarif Company tidak dipotong dan
  earning-nya dilaporkan sebagai `earningWithoutPercent`; user tanpa `bonusPercent` tidak
  dibonuskan tapi dasarnya tetap dihitung, supaya tarifnya bisa diisi belakangan tanpa menghitung
  ulang apa pun.
- **Dasar bonus memuat porsi pengeluaran operasional SEJAK JULI 2026, dan tidak sebelum itu**
  (`OPEX_BONUS_FROM_MONTH` di [`src/lib/operatingExpense.js`](src/lib/operatingExpense.js)). Sampai
  Juni, bonus dihitung dari net profit SEBELUM pengeluaran operasional: sewa server bukan milik
  advertiser mana pun. Blok JULY di sheet "Rekap % Advertiser" mengubahnya — ia membagi Biaya
  Operasional ke tiap advertiser menurut porsi earning masing-masing (NUR Rp 9.980.663 dari
  Rp 19.280.000 = 51,77%, persis porsi earning-nya) lalu menghitung bonus dari sisanya — dan
  selisihnya bukan pembulatan: Net Income Owner Juli 2026 berbunyi Rp 199.862.251 di sheet melawan
  Rp 197.819.711 di dashboard, dan Rp 2,04 juta itu hampir seluruhnya lahir dari aturan ini.
  - **Yang lama TIDAK ditulis ulang.** April–Juni sudah dibayarkan atas dasar tanpa pengeluaran
    operasional, dan blok bulan-bulan itu di sheet yang sama masih memakai aturan lama. Aturan baru
    yang dibaca mundur menggeser bonus bulan yang uangnya sudah pindah ke rekening orang, tanpa
    satu baris pun yang disunting — pelajaran yang sama yang menjadikan `companyPercents`
    bertanggal. Batasnya BULAN BARIS BIAYANYA, bukan periode yang sedang dibuka: rentang Jun–Jul
    membebankan biaya Juli saja.
  - **Yang tidak berubah adalah posisinya di RANTAI TOTAL.** Ia tetap satu baris "Pengeluaran
    operasional" yang dikurangkan penuh sebelum Net profit; pembagiannya ke PIC cuma menentukan
    bonus siapa yang berkurang — persis perlakuan invalid traffic dan potongan pencairan.
    Dikurangkan dari `netProfit` DAN dari dasar bonus, uang yang sama terhitung dua kali.
  - **SATU kantong, dibagi menurut porsi earning, TANPA domain.** Sewa server dan lisensi Keitaro
    tidak dimiliki domain mana pun, jadi tidak ada kolom yang bisa dipakai mencocokkan — dan
    `adxCosts`, yang PUNYA domain, sengaja ikut aturan yang sama: keduanya berdiri di satu baris
    rantai, dan dua pembagi untuk satu baris berarti dua sisa-yang-tidak-terbagi untuk satu angka.
    Konsekuensinya diketahui: advertiser lain ikut menanggung sebagian biaya link sebuah domain.
  - Dasar yang minus tidak menghasilkan bonus negatif — tidak ada bonus dari kerugian.
  - **Selisih yang TERSISA terhadap sheet Juli tinggal Rp 383.917**, dan keduanya sudah punya
    namanya: potongan Company yang tidak kena AdSense (Rp 170.230) dan pembagian earning per PIC
    yang sedikit berbeda karena `coverageGap`. Keduanya aturan yang disengaja, bukan selisih yang
    belum ditemukan.
- **Potongan pencairan: yang HILANG antara yang dibayar Google dan yang mendarat di rekening.**
  Rantai ini menghitung pendapatan dari apa yang DILAPORKAN Google dan dulu berhenti di situ. Untuk
  domain yang dibayar ke rekening lokal itu memang cukup. Untuk psaonlineappointment.com — dibayar
  lewat bank Pakistan, kena pajak pemerintah 10%, fee perantara 5%, lalu dikonversi dua kali — yang
  mendarat **17,5% lebih kecil**: Rp 7.036.271 pada Juli 2026 saja, Rp 14,4 juta sepanjang
  Mei–Juli. Tanpa baris ini seluruh uang itu dilaporkan sebagai laba yang tidak pernah ada, dan
  bonus advertiser dihitung dari dasar yang memuatnya. Sheet acuannya "CALC.PAK", yang menyebutnya
  "Potongan Akun Pakistan"; angkanya dari kolom "Penurunan Earning" di sheet "Note Pencairan".
  - **TIDAK ADA angka baru yang diketik dan tidak ada koleksi baru**: `Real Masuk − Saldo Akhir`
    pada baris `payouts` yang sama, yaitu jumlah dua kolom yang sudah diketik orang di tab
    Pencairan (`payoutCostRows` di [`src/lib/payouts.js`](src/lib/payouts.js)). Kolom ketiga untuk
    selisih yang bisa dihitung dari keduanya adalah angka yang berbeda dari sumbernya suatu hari.
  - **BESARNYA tetap TIDAK ditanyakan dari negara, dan itu tidak berubah sejak kolom Negara ada.**
    Yang ditanyakan aturan ini **berapa yang hilang di jalan**, dan ia menemukan domainnya sendiri:
    yang dibayar ke bank lokal kehilangan nol dan tidak dipotong apa pun, sementara rantai asing
    kedua ikut terpotong pada hari pencairannya dicatat — tanpa satu baris kode pun berubah. Negara
    domain memutuskan sesuatu yang lain, satu tingkat di dalam: apakah rantai Pencairan punya
    langkah **Pajak Negara** sebelum fee perantara. Ia menggeser PEMISAHAN di dalam baris, bukan
    totalnya, jadi `payoutCostRows` membaca angka yang sama persis seperti sebelumnya.
    **Yang sudah tidak berlaku adalah alasan lamanya** ("tidak ada satu pun tempat di dashboard ini
    yang tahu sebuah akun ada di negara mana"), dan yang membuatnya tidak berlaku bukan API
    melainkan kolom yang diisi orang: `reportTimeZone` dan `saldoCurrency` masih menjawab SETELAN
    AKUN dan bukan negara pemiliknya — tiga akun Pakistan tetap berbunyi `Asia/Jakarta` — dan tidak
    ada satu pun endpoint AdSense v2 maupun Ad Manager v1 yang menyebut negara. Yang lama, kolom
    `negara` teks bebas di `gamAccounts`, memang tidak bisa dipakai: ia KOSONG justru untuk
    psaonlineappointment.com sementara theglobesimregistration.ph tertulis "Indonesia".
  - **Hanya baris yang Real Masuk-nya BENAR-BENAR diketik.** `payoutRows` menjatuhkan Real Masuk
    yang kosong ke angka turunan (Earning Final), dan memungut fee atas angka turunan berarti
    memotong laba dengan biaya yang belum tentu terjadi. Bulan berjalan belum punya baris pencairan
    sama sekali; potongannya menyusul bersama barisnya, sepola dengan invalid traffic dan
    `accountCloses` — dan seperti keduanya ia BULANAN, jadi ia ikut hanya kalau rentangnya menutup
    bulan itu penuh (`wholeMonthsIn`, `partialMonths`).
  - **Dibagi ke PIC dengan pembagi yang sama seperti invalid traffic, lewat modul yang sama**
    (`spreadByEarning` di [`src/lib/earningByAccountType.js`](src/lib/earningByAccountType.js) —
    pembagi invalid traffic sekarang jadi pembungkusnya). Bedanya satu: **TANPA saringan jenis
    akun.** Yang dibayarkan Google ke rekening adalah satu wire untuk seluruh pendapatan domain
    itu, dan tidak ada apa pun di dalamnya yang memisahkan Ad Exchange dari AdSense. Sisanya yang
    tidak punya ember dikembalikan sebagai `payoutCostUnspread` dan DISEBUTKAN, alasan yang sama
    dengan `invalidTrafficUnspread`. Menambahkannya sebagai penyalin KETIGA dari pembagi itu adalah
    cara yang sama persis untuk mengulangi selisih April 2026.
  - **Letaknya SEBELUM dasar bonus**, berdampingan dengan invalid traffic dan bukan dengan
    pengeluaran operasional — sepola dengan sheet acuannya. Ia clawback atas pendapatan yang
    dihasilkan advertiser itu sendiri, jadi ia memang mengurangi bonusnya; sewa server tidak.
  - **Kolomnya ikut ke Cash Flow dan Laba per Domain**, dan berdiri sebagai item Cash Out di
    kartu — yang di kartu NOMINAL PENUH, yang di tabel yang berhasil dibagi.
  - **Namanya "Potongan Pencairan" DI KETIGA TAB, dan tidak menyebut negara mana pun.** Dua hal
    yang dijaga sekaligus. Pertama, satu angka dengan tiga nama tidak dikenali sebagai satu angka
    oleh yang mengadu ketiga tab — dan mengadu ketiganya adalah satu-satunya cara memeriksanya;
    `profitLoss ≡ cashFlow` menjaga ANGKANYA sama, tidak ada apa pun yang menjaga namanya. Kedua,
    "Biaya Pencairan Khusus akun Pakistan" pernah berdiri di Laba per Domain dan itu mengunci
    instansi hari ini ke aturan yang justru menolak tahu negara: `payoutCostRows` menanyakan
    berapa yang hilang di jalan, bukan negaranya, jadi rantai asing kedua ikut terpotong sendiri —
    dan labelnya berbohong pada hari itu tanpa satu baris kode berubah dan tanpa satu tes pun bisa
    menangkapnya. Yang menerangkan siapa yang dipungut adalah `ColumnHint` di kepala kolomnya.
    **"Potongan", bukan "Biaya"**: yang kedua sudah berarti ongkos menjalankan usaha (Biaya
    Operasional, Biaya Approval), sementara yang ini clawback yang mengurangi dasar bonus —
    keluarga yang sama dengan Potongan Company dan Invalid Traffic, sesuai letaknya di rantai.
    Aturan yang sama dengan Invalid Traffic di kartu yang sama.
  - **Fee yang terhitung DUA KALI sudah dibetulkan** (`migrations/fix-payout-fee-double-count.mjs`,
    `npm run migrate:payout-fee`). Ketiga baris psaonlineappointment.com diseed dengan
    `feePercent: 5` DAN `potonganKonversi` berisi SELURUH kehilangan bulan itu, jadi fee-nya
    dikurangkan dua kali: Saldo Akhir Juli berbunyi Rp 31.066.169 untuk pencairan yang benar-benar
    mendarat Rp 33.071.561. Selama tidak ada satu pun halaman yang MEMBACA kolom itu, salahnya
    tidak terlihat; sejak potongan pencairan masuk rantai laba, Rp 2 juta yang tidak pernah hilang
    ikut mengurangi bonus advertiser. Baris Mei salah di tempat lain — `realMasuk`-nya diketik
    "Diterima Bank Emran" (Rp 4.882.513) alih-alih "Tanda Terima Pembayaran Google"
    (Rp 5.380.512). Angka Binance dipakai sebagai CHECKSUM: selisih di atas Rp 1 menghentikan run.
    **Batas yang diketahui dan diterima**: Emran memungut 5% dari jumlah SETELAH pajak Pakistan,
    bukan dari yang dibayarkan Google, dan skema `payouts` tidak punya cara mengungkapkan pembagi
    selain Real Masuk. Yang dijaga adalah kedua TOTAL-nya (Saldo Akhir mendarat di angka Binance,
    kehilangannya sebesar Penurunan Earning); pemisahan Fee/Konversi di dalamnya meleset Rp 209
    ribu, dan yang dibaca rantai laba adalah jumlahnya.
- **Invalid traffic diinput orang, per domain per bulan per JENIS AKUN** (`invalidTraffic`,
  halaman `/invalid-traffic`, Keuangan). Koleksi sendiri dan bukan kolom di `domains`: nilainya
  berganti tiap bulan, dan kolom yang ditimpa tiap bulan akan mengubah laba bulan-bulan lampau.
  Untuk bonus, nominalnya dibagi ke PIC menurut porsi earning tiap orang di domain itu — per
  (domain, JENIS AKUN), pembagi yang sama persis dengan Cash Flow. Angkanya dibaca lewat
  `invalidTrafficTotal` dan bulannya lewat `invalidTrafficMonth`, dua fungsi yang sama dengan
  halamannya sendiri; `nominal` mentah adalah kolom turunan, dan baris yang punya Check tapi belum
  sempat menuliskannya berbunyi Rp 0 di sini dan angka penuh di tab sebelahnya.
- **Fee top-up whitelist TIDAK dikurangkan**, mengikuti rantai referensi — ia tampil sebagai
  catatan, bersama nominalnya (yang memang sudah terhitung penuh di Belanja Iklan). Konsekuensinya
  diketahui: halaman ini melaporkan laba versi rantai itu, bukan saldo kas.
- **April–Juli 2026 di `weeklyFinancials` DIISI DARI SPREADSHEET**
  (`migrations/backfill-weekly-financials.mjs`, `npm run migrate:weekly-financials`). Node itu baru
  mulai terisi 6 Juli — dashboard ini memang baru dibuat sekitar bulan itu — jadi April, Mei, dan
  Juni tidak punya satu titik pun, dan yang tersisa sebagai pendapatan bulan-bulan itu cuma
  `accountCloses`. Juni 2026 karena itu berbunyi pendapatan Rp 3,25 juta dan Net Income Owner
  **minus Rp 90,4 juta**, untuk bulan yang menurut `roiReports` menghasilkan Rp 304,9 juta. Juli pun
  ikut ditulis ulang, bukan cuma ditambal lima harinya: 26 titik yang tersimpan berjumlah Rp 414,0
  juta sementara `roiReports` hari-hari yang sama berjumlah Rp 455,4 juta — yang paling awal ditulis
  dengan `grossRevenue: 0`.
  - **Yang ditulis adalah total spreadsheet DIKURANGI `accountCloses`**, karena rantainya
    menjumlahkan keduanya (`revenue = Σ grossRevenue + closedEarning`). Hasil pengurangannya bukan
    tebakan: spreadsheet menghitungnya sendiri di dua blok lain, dan keduanya cocok sampai rupiah
    terakhir (Mei Rp 69.588.073 dan Rp 15.908.688; Juni Rp 304.827.693 dan Rp 53.470.632).
  - **Hanya TOTAL BULANANNYA yang nyata; bentuk hariannya diturunkan** dari porsi harian
    `roiReports`, dan RATA untuk April yang tidak punya satu baris ROI pun. Titiknya membawa
    `source: "spreadsheet"` — tanpa itu tidak ada yang bisa membedakannya dari titik yang ditulis
    sync.
  - **AKIBATNYA BERTAHAN, dan itu yang paling mudah lupa**: sejak migrasi ini, baris **Pendapatan**
    dan **Total belanja iklan** di Laba Rugi April–Juli ADALAH angka spreadsheet. Mengadu kedua
    baris itu dengan sheet-nya akan selalu cocok persis, dan kecocokan itu bukan bukti apa-apa —
    ia satu angka yang diadu dengan dirinya sendiri. Yang benar-benar berdiri sendiri untuk
    bulan-bulan itu cuma yang dihitung dari `roiReports`: Potongan Company, bonus advertiser,
    invalid traffic, dan potongan pencairan. Di situlah selisih yang tersisa terhadap sheet
    berada, dan di situ pula ia harus dicari.
  - **Belanja `accountCloses` MEI sempat diturunkan** dari Rp 21.082.102 ke Rp 6.852.236 dalam
    migrasi yang sama, dan itu MEMBETULKAN HITUNGAN GANDA DARI UJUNG YANG SALAH. Yang ditemukannya
    benar: `roiReports` Mei mencatat Rp 30.138.554, jadi bersama angka ketikannya Cash Flow Mei
    berjumlah Rp 51,2 juta untuk bulan yang membelanjakan Rp 36.990.790. Yang keliru adalah
    kesimpulannya — bahwa angka ketikan orang yang berlebih. `migrations/fix-may-spend-attribution.mjs`
    (`npm run migrate:may-spend`) yang membalikkannya, dan bukti yang membalikkannya ada tiga:
    **empat subdomain** membelanjakan Rp 21.794.184 sepanjang Mei dengan earning Rp 0 — nol yang
    dilaporkan GAM, bukan `""` — lalu keempatnya MULAI berearning dalam dua minggu pertama Juni
    (care & petnutrition.petcins.com 4 Jun, gifts.masseffectstore.com 8 Jun,
    tracking.psaonlineappointment.com 12 Jun); baris Mei-nya **ditulis backfill 2 Sep 2026**, yaitu
    dengan pendaftaran kode HARI INI, dan kode yang dibawanya (pBRw, 9brW, kBCD, kYfc) adalah kode
    yang di cermin Keitaro sekarang menunjuk keempat subdomain itu; dan yang benar-benar berearning
    Mei adalah xiaomi sendiri, Rp 78.890.471 — dashboard versi lama menyuruhnya menghasilkan itu
    dari belanja Rp 6,85 juta (ROI 1052%) sementara Rp 21,79 juta terbakar tanpa hasil di tempat
    lain. **Kode campaign yang berpindah tujuan tidak meninggalkan jejak di mana pun**, dan itu
    yang membuat backfill riwayat spend selalu berbahaya: yang dibacanya bukan tujuan campaign pada
    bulan itu melainkan tujuannya hari ini.
  - **Yang dikosongkan ditulis `""` + `metaMissing: "unmapped"`, bukan Rp 0.** Yang diketahui bukan
    "subdomain ini tidak membelanjakan apa pun pada Mei" melainkan "tidak ada campaign yang menunjuk
    ke sini bulan itu"; nol di sana menghasilkan ROI −100% yang tidak bisa dibedakan dari subdomain
    yang beriklan tanpa hasil. **EARNING tidak disentuh sama sekali** di kedua migrasi — pendapatan
    xiaomi memang tidak ada di `roiReports` mana pun.
  - **Belanja yang TERPETAKAN Mei karena itu tinggal Rp 8.344.370** atas belanja usaha
    Rp 36.990.790, dan selisihnya `coverageGap` sisi belanja: sebagian besar berjalan di LINCAH 1240,
    ad account yang token Meta kita tidak punya izin membacanya, jadi campaign-nya tidak pernah masuk
    `roiReports`. Yang DILARANG adalah menambal selisih itu dengan membagi rata sisanya ke baris mana
    pun — tidak ada satu pun bukti tentang subdomain mana yang menerimanya, dan angka yang dikarang
    di baris harian akan dibaca sebagai hasil pengukuran selamanya.
  - `seed:account-closes` idempotent lewat kunci turunan, dan sesudah pembalikan ini menjalankannya
    lagi menulis angka yang SAMA. Begitu juga `migrate:weekly-financials`: dengan belanja terpetakan
    Mei tinggal Rp 8,3 juta, `min(21.082.102, 36.990.790 − 8.344.370)` tidak menurunkan apa pun lagi.
- **`accountCloses` IKUT ke rantai ini**, dengan aturan pengaman yang sama persis dengan
  `foldAccountCloses` di Cash Flow: baris ROI selalu menang, jadi subdomain yang bulan itu punya
  laporan mengabaikan angka ketikannya. Akun yang ditutup Google berhenti menjawab `reports:run`,
  jadi pendapatannya tidak ada di `weeklyFinancials` MAUPUN di `roiReports` — dan yang paling gawat
  bukan Pendapatan Mei 2026 yang berbunyi Rp 66 juta untuk bulan yang membayar Rp 145 juta,
  melainkan `coverageGap` yang tetap NOL karena kedua sisi kehilangan uang yang SAMA. Halaman ini
  lalu diam tentang selisih yang tidak bisa ditemukan siapa pun. Yang diketik adalah "Ad Spend +
  Ad Tax" sebagai satu angka, jadi ia masuk ke baris **Belanja iklan** dan bukan dipecah tebakan ke
  baris Pajak: yang wajib dijaga di rantai ini adalah Total belanja = Belanja + Pajak. Bagian yang
  diketik itu DISEBUTKAN di bawah tabel berikut panel rinciannya sendiri — angka ketikan yang
  berdiri tanpa tanda di antara angka sync adalah dua hal berbeda yang mengaku satu.
- **TIDAK ADA satu aturan pun yang dihitung ulang di `profitLoss.js`.** `domainIndex`,
  `sourceSplit`, `companyPercentIndex`, `invalidTrafficTotal`, dan `invalidTrafficMonth` semuanya
  DIIMPOR — modul yang sama dengan Cash Flow, Pencairan, Invalid Traffic, dan Target. Berkas ini
  dulu menulis ulang keempatnya, dan keempat salinannya sudah berbeda perilaku dari aslinya:
  `nominal` mentah alih-alih jumlah Check, bulan dari `date` alih-alih dari kolom `month`,
  `hasBreakdown` yang tidak memeriksa `adsenseRevenue` (sehingga baris AdSense murni tanpa kolom
  `adxRevenue` dipotong Company atas SELURUH earning-nya), dan pembagian invalid traffic yang
  mengabaikan Jenis Akun.
- **Bulan PEMBANDING ikut diperiksa kelengkapannya, bukan cuma bulan yang dibuka.** Seluruh kolom
  Selisih dan tiap persen di kartu dihitung terhadapnya; membuka Mei 2026 mengadu bulan itu dengan
  April yang `roiReports`-nya belum mulai, dan yang tergambar bukan "April belum terisi" melainkan
  pertumbuhan tiga digit.
- **Warna tiap angka menandai ARAH uangnya**, di baris rantai maupun panel rincian, lewat satu peta
  `MONEY_KEY` — `in` → `earning` (hijau), `out` → `cashOut` (merah, angkanya tetap digambar positif),
  `net` → `profit` (mengikuti TANDANYA). Tanpa itu sebelas angka berderet hijau, dan yang membedakan
  pendapatan dari potongan cuma label di kolom kiri — di halaman yang seluruh gunanya adalah membaca
  kolom itu menurun.
  **Arahnya dibaca dari `flow`, BUKAN dari `kind`**, dan keduanya memang tidak sejalan: "Total
  belanja iklan" adalah subtotal yang uangnya keluar, sementara "Laba kotor" adalah subtotal yang
  boleh minus. `kind` tinggal untuk tingkat barisnya di tabel (tebal huruf, garis pemisah).
  **Yang `net` tidak boleh ikut merah selamanya**: laba kotor, net profit, dan net income owner
  adalah satu-satunya tempat di halaman ini di mana merah benar-benar berarti RUGI, dan menandainya
  merah sebagai "kelompok keluar" menghapus arti itu.
  Panel rincian bawaannya `out` — lima dari enam memang potongan atau biaya — dan yang masuk cuma
  Pendapatan Akun Ditutup, yang menyebutkannya sendiri lewat `flow="in"`. Di catatan top-up,
  nominalnya hijau dan fee-nya merah: yang pertama masuk ke akun iklan (Cash Flow menghitungnya
  sebagai Cash Inflow), yang kedua keluar ke rekening perantara — dua arah dalam satu kalimat, dan
  warnanya satu-satunya yang membedakannya.

### Periode Accounting: pemilih SATU BULAN, bukan rentang harian

Laba Rugi, Cash Flow, dan Laba per Domain memakai
[`MonthRangePicker`](src/components/ui/MonthRangePicker.jsx) — satu-satunya tempat di dashboard ini
yang TIDAK memakai `DateRangePicker`.

- **Sebabnya bukan selera melainkan `wholeMonthsIn`.** Tiga sumber di rantai grup ini berdiri per
  BULAN dan tidak bisa dibelah per hari — nominal invalid traffic, earning akun yang ditutup, dan
  potongan pencairan — dan ketiganya hanya ikut kalau rentangnya menutup bulannya PENUH. Dengan
  pemilih harian, rentang yang meleset SEHARI menjatuhkan ketiganya sekaligus: labanya naik belasan
  juta, dan satu-satunya tanda di layar adalah satu kalimat kecil di bawah tabel. Pemilih ini tidak
  bisa menghasilkan batas seperti itu sama sekali — tiap pilihannya menutup bulannya
  (`monthSpanRange` di [`src/lib/monthRangeUtil.js`](src/lib/monthRangeUtil.js), dijaga tes yang
  mengadunya dengan `wholeMonthsIn` sendiri).
- **Bawaannya ikut berubah: bulan PENUH, bukan `monthRange`** — yang itu memotong bulan berjalan di
  hari ini supaya sama dengan preset "Bulan ini", dan justru itu yang membuat halaman terbuka pada
  rentang yang tidak menutup bulannya. Bulan berjalan memang belum lengkap, dan yang mengabarkannya
  adalah keterangan "n dari m hari" — bukan batas rentang yang diam-diam menjatuhkan tiga sumber.
- **Yang bisa dipilih SATU bulan, bukan rentang beberapa bulan.** Itu satuan yang dipakai orang di
  grup ini — tarif Company, pencairan, invalid traffic, dan target semuanya berdiri per bulan — dan
  bawaan ketiga halaman memang sudah satu bulan penuh sejak awal. Beberapa bulan sekaligus
  MENJUMLAHKAN angka yang justru dibandingkan orang satu sama lain — dan kolom Selisih lalu mengadu
  tiga bulan dengan tiga bulan sebelumnya, bukan bulan dengan bulan.
  Preset "3 bulan terakhir" dan "Tahun berjalan" ikut hilang bersamanya — preset yang tidak bisa
  dihasilkan petak di sebelahnya adalah dua aturan berbeda di satu dialog.
- **Alamatnya TETAP `?periode=` berbentuk `from..to`**, jadi tautan yang sudah beredar tidak mati
  dan ketiga tab tetap berbicara satu kosakata periode. Rentang lama — beberapa bulan maupun
  potongan hari — tetap DIPAKAI apa adanya dan tombolnya berbunyi "Jun – Agu 2026" atau "Agu 2026
  (sebagian)": yang menolak menggambarkannya akan tampil kosong di atas tabel yang justru berisi,
  dan yang membulatkannya jadi "Agu 2026" berbohong tentang apa yang sedang disaring. Yang tersorot
  di petak bulan untuk rentang seperti itu adalah bulan TERAKHIRNYA, yaitu yang akan terpilih kalau
  orangnya menekan Perbarui tanpa mengubah apa pun.
- **Menumpang seluruh kerangka `.daterange-*`** — trigger, scrim, popover, kaki, tombol — dan yang
  berbeda cuma isi kanannya: 12 petak bulan menggantikan dua kalender hari. Kelas kedua, bukan
  daftar nilai kedua.
- **Cost Ad Exchange TIDAK ikut**, walau ia tab di grup yang sama: isinya catatan KEJADIAN
  bertanggal (satu baris per penyambungan), bukan rantai bulanan, dan di sana rentang bebas memang
  gunanya.

### Cash Flow Management: rantai yang sama, dipecah per subdomain

Tab **Cash Flow** (`/cash-flow`, tepat sesudah Laba Rugi di bawah Accounting) menjawab pertanyaan
yang tidak dijawab rantai di sebelahnya: **dari mana angka itu datang, dan siapa yang
menghasilkannya.** Satu baris per BULAN per ADVERTISER per JENIS AKUN per SUBDOMAIN. Aturannya di
[`src/lib/cashFlow.js`](src/lib/cashFlow.js).

```
Earning Bruto    = Earning − (Ad Spend + Ad Tax)
Net Profit       = Earning Bruto − Potongan Company − Invalid Traffic − Potongan Pencairan
Bonus            = Bonus % × (Net Profit − Biaya Operasional)
Net Income Owner = Net Profit − Bonus advertiser
```

- **TIDAK ADA satu pun angka yang diketik, dan tidak ada koleksi baru.** Spreadsheet acuannya
  meminta Earning dan Ad Spend diinput tangan per subdomain per bulan; keduanya sudah ada di
  `roiReports` — satu baris per hari per subdomain, lengkap dengan PIC dan rincian sumber
  earning-nya. Sisanya dari halaman yang sudah ada: tarif dari `companyPercents` (tab Potongan
  Company), nominal dari `invalidTraffic` (tab Invalid Traffic), tarif bonus dari `users`
  (halaman Team). Angka yang diketik ulang adalah angka yang berbeda dari sumbernya suatu hari,
  tanpa satu pun tanda di layar.
- **Tidak satu aturan pun dihitung ulang di modul ini.** `sourceSplit` (yang memecah earning ke Ad
  Exchange/AdSense dan membagi belanjanya sebanding — dipakai Invalid Traffic dan Target juga),
  `domainIndex`, `companyPercentIndex`, `invalidTrafficTotal`, dan `roiPercent` semuanya diimpor.
  `sourceSplit` dan `invalidTrafficMonth` DIEKSPOR untuk halaman ini; disalin, satu subdomain akan
  berbunyi dua angka berbeda di dua tab yang bersebelahan di kepala halaman yang sama.
- **Potongan Company dihitung PER HARI lalu dijumlahkan**, bukan tarif sebulan dikalikan earning
  sebulan — konsekuensi wajib dari tarif yang bertanggal. Karena itu kolom Company % bisa berbunyi
  "10% → 20%", sepola dengan `companyBreakdown` di Laba Rugi: satu angka di sana harus memilih
  salah satu tarifnya, dan yang mana pun yang dipilih ia berbohong untuk separuh bulan.
- **Invalid traffic dibagi menurut porsi EARNING**, karena barisnya berdiri per (bulan, domain,
  jenis akun) — satu tingkat di atas tabel ini. Itu pembagi yang sama yang dipakai `splitByOwner`
  untuk membagi invalid traffic ke PIC. Baris LAMA tanpa jenis akun dibagi ke KEDUA sisi domain
  itu, sepola dengan `bucketOf`. Porsinya digambar di sel yang sama dengan nominalnya dan bukan
  sebagai kolom sendiri: ia satu-satunya angka di spreadsheet acuan yang cuma menerangkan angka di
  sebelahnya, dan satu kolom lagi di tabel selebar ini cuma mendorong angka ke luar layar.
- **Kolom Biaya Operasional berdiri DI LUAR Net Profit, dan itu bukan kelalaian.** Ia porsi biaya
  bulan ini menurut porsi earning baris itu (sejak Juli 2026; Rp 0 sebelumnya), dan yang
  disentuhnya cuma dasar bonus. Dimasukkan ke Net Profit, porsi milik domain yang ditutup
  dikurangkan DUA KALI dari Net Income Owner di kartu: "Akun Close Cut" menjumlahkan `netProfit`
  domain-domain itu, sementara Biaya Operasional sudah berdiri sebagai item Cash Out tersendiri di
  kartu yang sama. Ia jadi KOLOM dan bukan catatan di bawah tabel karena tanpanya
  kolom Bonus tidak bisa dihitung ulang dari satu kolom pun yang terlihat — dan kolom yang cuma
  bisa dipercaya adalah kolom yang akan diadu orang dengan spreadsheet-nya sendiri.
- **Dasar bonus adalah net profit SEBULAN milik orang itu, bukan baris per baris** — dasar yang
  sama dengan Laba Rugi, jadi kolom Bonus di sini berjumlah persis sebesar baris "Bonus advertiser"
  di sana. Baris yang rugi di tengah bulan yang untung TETAP mengurangi bonusnya (bonusnya minus,
  dan itu memang arti "bonus dari net profit"); yang tidak boleh cuma bulan yang SELURUHNYA rugi
  berbalik jadi tagihan ke advertiser — di sana bonusnya nol, dan barisnya menyebutkan sebabnya
  alih-alih menampilkan tarif yang tidak menghasilkan apa-apa. Spreadsheet acuannya tidak punya
  penjagaan itu.
- **Kolom yang TIDAK ikut dari spreadsheet acuan**, dan sebabnya masing-masing: "Update Data"
  (tidak ada yang mengetik baris ini, jadi tidak ada yang bisa distempel), "Penurunan Earning"
  (kosong di seluruh 76 baris acuan), blok "Invalid Traffict" KEDUA (angkanya sama persis dengan
  yang pertama di tiap baris), "Ket" (teks bebas yang tidak punya tempat di baris turunan), ketiga
  kolom "Checking" (yang diperiksanya bonus% + owner% = 100%, benar menurut konstruksi di sini),
  kolom persen di sebelah Net Income Owner (selalu 100 − Bonus %, dan dua kolom yang selalu bisa
  dibaca dari satu sama lain cuma mendorong angka keluar layar), dan kolom MONTH — yang
  menyebutkan bulannya adalah pemilih di kepala halaman, sepola dengan Target dan Cost Ad Exchange.
- **Kepala halaman memuat TIGA kelompok arus kas** (`cashFlowSummary`), dan **KOSAKATANYA diambil
  dari sheet "Dashboard" (DASHBOARD DATA CENTER)** — itu nama yang dipakai tim saat mengadu angka:
  Cash Inflow (Total TopUp Saldo Meta Ads, Pendapatan Kotor Google), Cash Outflow (Total Spending,
  Total Potongan Company, Total Invalid Traffic, Total % Advertiser, Potongan Pencairan, Total Biaya
  Beban (Expense), Biaya Approval, Total Akun Close), dan Cash Available (Saldo Iklan Meta Ads, Laba
  Kotor Google, Pendapatan Bersih Google). **Tiap item menyebut SUMBERNYA di bawah namanya** — dua API, tiga halaman input, beberapa rumus. Nama kartunya diambil dari sheet supaya
  bisa diadu; yang menentukan ke mana orang PERGI saat sebuah angka terasa aneh adalah sumbernya.
  - **BENTUKNYA tetap tiga panel berdaftar.** Sempat dijadikan grid kartu satu-metrik-satu-kotak
    seperti tata letak sheet-nya, dan itu dibatalkan: yang diminta dari sheet adalah kosakata dan
    rantainya, bukan tata letaknya.
  - **"Total % Advertiser" adalah RUPIAH, bukan persen** — ia bonus advertiser, dan keterangan
    sumbernya yang mengatakannya. Namanya tetap dari sheet karena itu yang dicari orang saat
    membandingkan kedua layar; ini pengecualian yang disengaja dari alasan yang menolak "% Advertiser"
    sebagai nama TAB (di sana tidak ada keterangan sumber yang bisa menerangkannya).
  - **"Total Akun Close" = jumlah kolom Saldo Close di tab Pencairan**, definisi yang sama dengan
    sheet (SUMIFS kolom K 'DatMas | Laporan Pencairan'). Mei 2026 berbunyi Rp 70.514.530 di
    keduanya. Ia MENGGANTIKAN `accountCloseCut` (Gross Profit domain yang ditutup), yang menjawab
    pertanyaan yang mirip tapi bukan yang ini — dan yang tidak pernah cocok dengan sheet yang diadu
    orang dengannya. Yang hangus adalah SALDO-nya: earning dikurangi Company dan Invalid Traffic,
    ditambah sisa bulan sebelumnya; belanja iklan tidak dikurangkan, karena yang hangus bukan
    labanya.
    - **Itu menuntut `payoutRows` MEMBACA `accountCloses`**, dan tanpa itu seluruh rantai pencairan
      sebuah domain yang ditutup berdiri kosong: akun yang ditutup berhenti menjawab `reports:run`,
      jadi pendapatannya tidak ada di `roiReports` mana pun — ia cuma ada sebagai angka ketikan di
      tab Akun Ditutup. Sebelum ini, kolom yang seluruh gunanya adalah menyebutkan berapa saldo yang
      HANGUS justru kosong persis untuk satu-satunya baris yang menghanguskan sesuatu, dan itemnya
      berbunyi Rp 0 untuk saldo yang sebenarnya Rp 70.514.530. Baris ROI tetap MENANG atas baris
      ketikan, aturan yang sama dengan `foldAccountCloses`.
    - **Baris yang TIDAK ditutup menghanguskan Rp 0, walau earning-nya belum diketahui.** Tidak ada
      yang hangus dari akun yang masih hidup. Yang menjawab "" cuma baris yang DITUTUP dan
      earning-nya belum ada — di situ ada saldo yang hangus dan besarnya memang belum bisa dihitung,
      dan satu baris begitu MENGOSONGKAN seluruh itemnya.
  - **"Pendapatan Kotor Google" dan "Total Spending" BERSKALA USAHA, bukan jumlah baris ROI di
    tabel bawahnya** — seluruh akun GAM/AdSense dan seluruh ad account, tanpa syarat pemetaan
    campaign. Itu yang dijawab sheet, dan itu juga baris Pendapatan dan Total belanja iklan di Laba
    Rugi: angkanya DIOPER dari `buildProfitLoss` yang sama (`business` di `cashFlowSummary`), bukan
    dihitung ulang, jadi kedua tab tidak bisa menyebut dua angka untuk uang yang sama. Mei 2026
    berbunyi Rp 36.990.790 — sama persis dengan sheet, dan Rp 7,5 juta lebih besar daripada belanja
    yang punya baris ROI.
    **Konsekuensinya diketahui**: kartu ini jadi LEBIH BESAR daripada baris Total di tabel di
    bawahnya, dan selisihnya `coverageGap` — sebagian besar berjalan di ad account yang token Meta
    kita tidak punya izin membacanya. Rantai Cash Available ikut berskala usaha, dan begitu juga
    belanja di Saldo Iklan Meta Ads: dua angka bertetangga di satu kartu yang berselisih tanpa sebab
    yang terbaca lebih buruk daripada satu angka yang kurang presisi.
  - **YANG MASIH BERSELISIH DENGAN SHEET, dan buktinya per baris.** Diadu dengan sheet
    'DatMas | Lap.Arus Pendapatan (C' Mei 2026 baris per baris (5 Sep 2026):
    - **Potongan Company** Rp 25.005.290 lawan Rp 25.224.436. Sheet memotong satu baris **AdSense**
      (Aca/Adsense, kolom L = Rp 258.250) — potongan Company hanya kena Ad Exchange di dashboard
      ini, dan itu aturan yang lahir dari selisih yang benar-benar ditagihkan (lihat
      `seed-company-percents`). Sisa selisihnya tersebar sebagai pembulatan per baris.
    - **Invalid Traffic** Rp 782.180 lawan Rp 759.056 di kolom M sheet — dan selisihnya PERSIS
      Rp 23.124, yaitu `invalidTrafficUnspread`: nominal masseffectstore.com Adsense Mei, sisi
      bisnis yang bulan itu tidak menghasilkan apa-apa sehingga tidak ada baris yang bisa
      menanggungnya. Sheet menjumlahkan yang sudah TERBAGI, jadi nominal seperti itu hilang dari
      totalnya — persis bug yang koleksi `invalidTrafficUnspread` ada untuk mencegahnya. Kartu ini
      menjumlahkan nominal PENUH, sama dengan baris Invalid traffic di Laba Rugi.
    - **% Advertiser** ikut berselisih karena keduanya masuk dasar bonus.
    Menyamakan ketiganya berarti memotong pendapatan AdSense yang tidak pernah ditagihkan dan
    menjatuhkan nominal yang tidak punya ember — dua hal yang menjadikan dashboard ini salah demi
    cocok dengan sheet.
  - **Cash Available TIDAK punya baris Total**: ia rantai BERJENJANG, bukan daftar yang bisa
    dijumlahkan. Menjumlahkan Laba Kotor Google dengan Pendapatan Bersih Google berarti menghitung
    uang yang sama beberapa kali. Tiap barisnya bisa dihitung ulang dari baris di atasnya ditambah
    satu item di kelompok sebelah kiri.
  - **"Pendapatan Bersih Google" BERHENTI sebelum Akun Close, Approval, dan Potongan Pencairan** —
    ia Laba Kotor dikurangi Company, Invalid Traffic, % Advertiser, dan Biaya Beban, persis rumus
    sheet-nya. Ketiga sisanya tetap berdiri utuh di kelompok Cash Outflow.
  - **Baris kepala (Cash Inflow / Cash Outflow / Result) MENJUMLAHKAN kelompok yang berdiri persis
    di bawahnya**, dan itu syarat yang mengikat: angka kepala yang tidak bisa dihitung ulang dari
    kelompoknya sendiri tidak bisa diadu dengan apa pun, termasuk dengan dirinya sendiri. Sheet
    acuannya justru begitu — Cash Inflow-nya cuma pendapatan Google sementara kolomnya memuat
    top-up juga — dan di sini sengaja tidak diikuti.
  - **"Net Income Owner" TIDAK ada di kartu ini.** Ia dibuang setelah sempat berdiri di Cash
    Available: pada bulan yang Potongan Pencairan, Biaya Approval, dan Akun Close-nya belum ada
    datanya, ia berbunyi SAMA PERSIS dengan Pendapatan Bersih Google — dua angka bernama berbeda
    yang tidak bisa dibedakan pembacanya. Yang menjawab laba tetap Laba Rugi, dan Result di kepala
    kartu ini sudah menyebutkan sisa arus kasnya. Sheet acuannya juga tidak punya baris itu di
    kolom ini.
  - **"Saldo Iklan Meta Ads" SALDO BERJALAN, sengaja berbeda dari sheet**, yang menghitung TopUp −
    Spending bulan berjalan lalu menambahkan catatan "jika minus berarti ada sisa saldo di bulan
    sebelumnya". Catatan itu mengakui bahwa angkanya tidak menjawab pertanyaannya.
  - **Potongan yang belum diinput DILEWATI sebagai nol di Cash Available**, bukan mengosongkan
    seluruh rantainya — aturan yang sama dengan `netIncomeOwner` sejak awal. Invalid traffic belum
    diinput sejak Agustus dan baris pengeluaran tidak selalu ada; mengosongkan Laba Kotor karena
    salah satunya belum ada berarti kelompok itu kosong hampir sepanjang tahun. Yang MENGOSONGKAN
    seluruhnya cuma earning yang tidak diketahui — seluruh rantai ini lahir darinya.
  - **KERUGIAN BANNED, ROI OVERALL, TOTAL ASSETS AKUN, dan NET PROFIT dari sheet TIDAK ikut.**
    Dua yang pertama sempat dibuat lalu dibuang: "Kerugian Banned" dijepit ke nol ke atas sehingga
    ia berbunyi Rp 0 selama usahanya untung, dan ROI sudah berdiri sebagai kolom di tabel tepat di
    bawah kartunya. Dua yang terakhir bergantung pada "Total Assets Akun" Rp 218.520.000 yang
    "diambil dari nilai rata-rata" di sheet Akun Adsense; di dashboard, jumlah kolom Harga Beli
    ketujuh akun GAM cuma Rp 85.920.000 dan kedelapan akun AdSense kosong, jadi angkanya tidak bisa
    direproduksi. Mengetiknya sekali di Settings akan cocok hari ini lalu basi diam-diam.
  - **"Total Potongan Company" BUKAN dari API Google**, walau angkanya lahir dari pendapatan Google:
    tarifnya diketik orang di tab Potongan Company. Label yang menyebut API akan mengirim orang
    mencari sumber yang tidak ada pada hari angkanya terasa aneh.
  - **"Total Spending" adalah belanja Meta BERIKUT pajak iklannya**, satu angka — itu yang
    benar-benar keluar dari kantong, dan pembagi yang sama dengan kolom ROI di tabel di bawahnya.
    Ad Tax tidak berdiri sebagai item sendiri.
### Akun yang ditutup Google: satu-satunya earning yang diketik

Tab **Akun Ditutup** (`/account-closes`, di bawah Accounting) memegang earning bulanan subdomain
yang akun Google-nya sudah ditutup. Aturannya di
[`src/lib/accountClose.js`](src/lib/accountClose.js), dilipat ke tabel Cash Flow oleh
`foldAccountCloses` di [`src/lib/cashFlow.js`](src/lib/cashFlow.js).

- **Ia melanggar aturan pokok repo ini, dan cuma di sini.** Angka yang diketik ulang adalah angka
  yang berbeda dari sumbernya suatu hari — kecuali kalau SUMBERNYA SUDAH TIDAK ADA. Akun GAM
  xiaomidriversdownload.com (network 23350141053) ditutup Google pada Mei 2026: `reports:run` tidak
  menjawab lagi untuk network itu, subdomainnya tidak pernah terdaftar di /sub-domains, dan
  `roiReports` tidak memuat satu baris pun atas namanya — bulan apa pun. Tanpa koleksi ini,
  Earning Google Mei berbunyi Rp 66 juta untuk bulan yang membayar Rp 145 juta, dan tidak ada apa
  pun di layar yang menyebut ke mana Rp 79 juta itu pergi.
- **BARIS ROI SELALU MENANG**, dan itu yang menahannya jadi pintu belakang untuk mengarang earning:
  subdomain + bulan yang punya baris ROI mengabaikan ketikannya tanpa suara. Kebalikan dari
  `earningManual` di Invalid Traffic, dan sengaja — yang di sana ada karena laporannya BELUM
  lengkap, yang di sini karena laporannya TIDAK AKAN PERNAH ada. Domain yang masih hidup dan
  subdomainnya belum terdaftar diperbaiki di /sub-domains.
- **Enam isian, sisanya aturan yang sudah ada**: Bulan, PIC, Jenis Akun, Sub Domain, Earning, dan
  Ad Spend + Ad Tax — persis kolom "(Input)" spreadsheet acuannya. Domain induk (`domainIndex`),
  Company (tarif bertanggal, Ad Exchange saja), Invalid Traffic (dibagi dari `invalidTraffic`
  menurut porsi earning), Net Profit, dan Bonus (`users.bonusPercent` milik PIC baris itu)
  semuanya diturunkan. Ketujuh belas baris April–Juni 2026 direproduksi **persis sampai rupiah
  terakhir**, termasuk pembagian invalid traffic April (usb 43%, tools 7%, firmware 51% dari
  Rp 60.317) yang di spreadsheet juga "(Auto)".
- **Dilipat ke ember yang SAMA dengan baris ROI**, bukan dihitung di cabang sendiri. Di situlah
  seluruh gagasannya: begitu angkanya masuk, tarif bertanggal, pembagian invalid traffic, dasar
  bonus per PIC, dan "Akun Close Cut" bekerja dengan aturan yang sudah ada — dan barisnya berdiri
  di tabel Cash Flow berdampingan dengan yang lain, bukan sebagai catatan kaki di kartu.
  Dua yang berbeda dari baris ROI, dan keduanya wajar untuk baris bulanan: `sourceSplit` TIDAK
  dipakai (baris ini MENYEBUTKAN jenis akunnya; dibelah, empat baris AdSense April akan berbunyi
  kena potongan Company yang tidak pernah ditagihkan), dan `days` diisi 1.
- **Tarif Company dicari pada TANGGAL 1**, dan itu batas yang harus disebut: baris bulanan tidak
  bisa membelah sebulan yang tarifnya berganti di tengah jalan, berbeda dari baris ROI harian.
  April–Juni 2026 tarifnya tetap sepanjang tiap bulan (10%, 10%, 15%), jadi hasilnya persis.
- **Kuncinya (bulan, subdomain, jenis akun, PIC) — keempatnya**, sama dengan kunci ember
  `addBucket`. flash.xiaomidriversdownload.com April berdiri DUA kali, Aca Rp 902.639 dan Nurjaman
  Rp 5.036.731; tanpa PIC di kunci, yang kedua menimpa yang pertama diam-diam — jumlah baris yang
  dicetak tetap 17, yang tersimpan 16, dan selisihnya cuma terbaca sebagai porsi invalid traffic
  yang meleset di lima baris LAIN.
- **Halamannya TANPA `derive`.** Seluruh kolom turunannya sudah digambar tab Cash Flow, dari baris
  yang sama; diturunkan di sini juga, satu subdomain berbunyi dua kali di dua tab bersebelahan dan
  yang kedua akan berbeda suatu hari. **Penyaring Bulan tidak menuntutnya berubah**: `month` di sini
  bukan kolom turunan melainkan isian wajib berbentuk `YYYY-MM` — yang disaring adalah field yang
  memang sudah tersimpan.
- **TANPA pemilih rentang tanggal, dan yang menggantikannya penyaring Bulan** (`?f_month=`) di
  samping PIC dan Jenis Akun — alasan yang sama persis dengan Invalid Traffic dan Pencairan: filter
  rentang tanggal bawaannya bulan berjalan, dan satu baris di sini adalah satu BULAN yang sudah
  lewat. Kuncinya tetap "2026-05" (itu yang dicocokkan dan yang ditulis ke alamat), labelnya
  "Mei 2026" lewat `formatMonth`; terbaru dulu, sama dengan urutan bawaan tabelnya.
- **Riwayat April–Juni 2026 lahir dari satu seed** (`migrations/seed-account-closes.mjs`,
  `npm run seed:account-closes`, butuh `npm run deploy:rules` lebih dulu). Kolom "(Auto)"
  spreadsheet dipakai sebagai CHECKSUM dan bukan sebagai nilai — Company, pembagian invalid
  traffic, dan bonus semuanya diadu dengan turunan dashboard, dan selisih di atas Rp 1
  menghentikan run.
- **April IKUT ditulis walau bukan bulan penutupan** (`payouts` April berstatus "Sudah Cair").
  Konsekuensinya diketahui: `roiReports` baru dimulai Mei, jadi kartu April sekarang menyebut
  Rp 39,2 juta yang SELURUHNYA milik satu domain — bukan pendapatan seluruh usaha bulan itu.
  Sebelumnya ia berbunyi "-", yang lebih jujur tentang cakupannya tapi membuang data yang ada.

  - **"Akun Close Cut" = Gross Profit domain yang ditandai "Account Close" di `payouts`** — laba
    domain itu SEBELUM bonus advertiser (`netProfit` di baris tabel, kolom "Gross Profit Advertiser"
    di Laba per Domain). Domain yang akunnya ditutup Google tidak menyumbang apa pun ke kantong
    pemilik — pendapatannya tidak akan pernah cair — jadi sumbangannya dikeluarkan dari arus kas
    bulan itu. Spreadsheet acuannya melakukannya kolom demi kolom (`=$D$8-$M$24` untuk earning, dan
    seterusnya untuk Ad Spend, Company, Invalid Traffic); yang tersisa dari keempatnya adalah
    selisih SATU angka, karena `(E−S−C−I) − (Ec−Sc−Cc−Ic)` persis sama dengan Gross Profit semua
    dikurangi Gross Profit yang ditutup. Jadi satu item Cash Out menghasilkan angka yang sama dengan
    mengurangkan keempat kolomnya satu per satu, dan kelima item lain di kartu tetap menyebut jumlah
    SEBENARNYA bulan itu — termasuk domain yang ditutup.
    - **Kolom KELIMA — bonus advertiser — SENGAJA berhenti di sini.** Bonus domain yang ditutup
      tetap berdiri utuh di item "Bonus Advertiser" dan tidak dikreditkan balik, jadi Net Income
      Owner di kartu ini lebih kecil sebesar bonus itu daripada kalau yang dipotong Net Income
      Owner (Mei 2026: Rp 6.288.256, dan potongannya Rp 49.432.428 alih-alih Rp 43.144.172). Bonus
      atas laba yang tidak pernah cair tetap dibayarkan ke advertiser, jadi ia memang uang yang
      keluar; yang dijawab item ini adalah LABA domainnya, bukan sisa setelah bagi hasil.
    - **Karena itu ia BUKAN angka yang sama dengan keterangan domain tutup di Laba per Domain**,
      yang menyebut `netIncomeOwner` — baris terakhir rantai halaman itu, yaitu yang benar-benar
      hilang dari kantong pemilik. Dua pertanyaan yang berbeda, dan selisihnya persis bonus domain
      itu. Yang MENYATUKAN keduanya tetap `isAccountClose`: siapa yang ditutup dibaca dari satu
      tempat, cuma besarannya yang berbeda.
    Ini MENGGANTIKAN `saldoClose`, yang menjawab pertanyaan yang mirip tapi bukan yang ini: ia
    earning − company − IVT + saldo bulan lalu, **tanpa belanja iklan**, jadi ia tidak pernah bisa
    mengeluarkan sumbangan domain itu dari rantai kartu ini secara utuh. Yang menandai sebuah domain
    tutup tetap `payouts` — di situlah orang menuliskannya.
  - **Tiga jawaban, dan ketiganya berbeda artinya.** `""` untuk bulan yang belum punya satu pun
    baris pencairan, ATAU domain yang ditandai tutup tapi tidak punya satu pun baris ROI bulan itu;
    `0` kalau baris pencairannya ADA dan tidak satu pun ditutup (nol yang sah, sebuah pernyataan);
    angka untuk sisanya. Aturan lama menjawab **Rp 0 untuk Mei 2026** — lima domain yang TIDAK
    ditutup menyumbang `saldoClose` nol masing-masing, sementara satu-satunya yang benar-benar
    ditutup (xiaomidriversdownload.com) menyumbang `""` dan dilewati. Nol yang lahir dari
    penjumlahan seperti itu tidak bisa dibedakan dari bulan yang memang tidak menutup akun apa pun.
    Satu domain yang tidak bisa dihitung mengosongkan seluruh itemnya, bukan cuma bagiannya: yang
    tersisa kalau tidak adalah angka yang tampak lengkap dan diam-diam kurang satu domain.
  - **Kartunya SENGAJA tidak ikut penyaring di kepala halaman.** Empat dari sembilan itemnya tidak
    punya pemilik sama sekali (biaya operasional, biaya approval, akun yang ditutup, sebagian
    top-up), jadi memilih satu advertiser akan menyempitkan lima item dan membiarkan empat lainnya
    utuh — kartu yang setengahnya tersaring tidak bisa dijumlahkan pembacanya. Yang ikut menyempit
    tetap baris Total di tabel.
  - **Bulan tanpa satu pun baris ROI mengosongkan keempat item yang lahir darinya** (Earning,
    Spending, Company Cut, Bonus), bukan menuliskannya Rp 0. April 2026 punya top-up dan biaya tapi
    `roiReports` baru dimulai Mei, dan "Earning Google Rp 0" di sana adalah klaim bahwa bulan itu
    tidak menghasilkan apa-apa. Yang membedakannya dari nol yang sah adalah ADA tidaknya barisnya,
    bukan besar totalnya — dua baris Cost Ad Exchange Juli yang keduanya "Garansi Delink" berbunyi
    Rp 0, dan nol itu benar. **Berapa item yang kosong DISEBUTKAN di bawah totalnya**; totalnya
    sendiri menjumlahkan yang ada, karena `"" + 100` bukan 101 melainkan teks `"0100"`.
  - **"TopUp WL" adalah kolom TOTAL baris top-up — nominal BERIKUT fee perantaranya.** Keduanya
    keluar dari kantong pada hari yang sama, untuk setoran yang sama; nominal saja melaporkan
    Cash Inflow Juli 2026 sebesar Rp 131.000.000 untuk uang yang benar-benar berpindah sebesar
    Rp 137.550.000, dan Rp 6,5 juta itu tidak muncul sebagai apa pun di kartu mana pun. Sengaja
    BERBEDA dari Laba Rugi, yang menampilkan fee sebagai catatan dan tidak mengurangkannya
    (`topupFee`): yang di sana mengikuti rantai spreadsheet acuannya, yang di sini arus kas.
  - **"Sisa Saldo Ad Accounts" adalah SALDO BERJALAN, bukan selisih bulan itu saja** — Σ top-up
    dikurangi Σ belanja sejak baris paling awal, sampai dengan bulan yang dibuka. Setoran tidak
    habis pada bulan ia disetor: Juli 2026 membelanjakan Rp 140,3 juta atas top-up Rp 137,5 juta
    karena sisa Juni masih ada di akunnya, dan dihitung per bulan angkanya berbunyi −Rp 2,7 juta
    untuk akun yang sebenarnya masih berisi Rp 26 juta. Selisih tiap bulannya tetap persis dua item
    yang berdiri di kartu ini (TopUp WL − Spending), jadi saldo bulan ini masih bisa diadu dengan
    saldo bulan lalu tanpa membuka apa pun. Belanjanya disaring dengan aturan yang SAMA dengan item
    Spending di atasnya — dua angka bertetangga di satu kartu yang berselisih tanpa sebab yang
    terbaca lebih buruk daripada satu angka yang kurang presisi. Ia BUKAN `adAccounts.balance`,
    yang adalah sisa batas pengeluaran Meta dan bukan uang. Dua konsekuensi yang diketahui: top-up
    hanya untuk akun whitelist sementara belanja mencakup seluruh ad account — diakumulasi, selisih
    itu ikut menumpuk alih-alih hilang — dan akumulasinya mulai dari data yang ADA (`whitelistTopup`
    April 2026, `roiReports` Mei), jadi saldo yang sudah berdiri sebelum itu tidak terhitung.
  - **"Net Income Owner" = Earning Google − SELURUH item Cash Out**, dan **TopUp TIDAK ikut
    ditambahkan** walau ia berdiri di Cash Inflow: setoran ke akun iklan bukan pendapatan — ia
    berpindah jadi saldo lalu keluar lagi sebagai Spending, yang sudah berdiri utuh di Cash Out.
    Ikut ditambahkan, uang yang sama terhitung dua kali dan laba bulan itu naik sebesar setoran
    yang belum tentu terpakai. Aturan yang sama dengan `topupFee` di profitLoss.js. Kosong kalau
    earning-nya tidak diketahui; Cash Out yang belum lengkap TIDAK mengosongkannya — kartu di
    sebelahnya sudah menyebutkan berapa item yang belum punya datanya.
  - **Karena nama itu dipakai di sini, TABELNYA kehilangan kolom "Net Income Owner".** Definisinya
    berbeda (yang di kartu memuat biaya operasional dan approval, yang tidak dimiliki subdomain
    mana pun), dan dua angka bernama sama di satu halaman akan diadu pembacanya dan tidak akan
    pernah cocok. Yang per baris tidak hilang: ia Net Profit dikurangi Bonus, dua kolom yang
    berdiri persis di sebelahnya.
  - **TIGA `moneyKey` untuk tiga arah, dan warnanya berbeda**: `earning` (masuk, hijau), `cashOut`
    (keluar, merah — nilainya tetap digambar positif, lewat `outflowKeys` di renderCell), dan
    `profit` untuk Cash Available, yang satu-satunya boleh minus dan karena itu warnanya mengikuti
    TANDANYA, bukan kelompoknya. Satu peta (`MONEY_KEY`, kembaran yang di ProfitLoss.jsx) dipakai
    baris kepala maupun ketiga kelompok di bawahnya, dan arahnya dibaca dari `flow` — bukan ditebak
    dari posisi kolomnya. `cashOut` boleh ikut `outflowKeys` justru karena alasan yang
    MENAHAN Ad Tax dan Total Spend di luar sana: di kartu ini uang masuk dan uang keluar berdiri di
    dua kelompok berbeda dan memang harus dibedakan — warnanya menandai KELOMPOKNYA, bukan menilai
    satu angka lebih buruk daripada tetangganya.
  - **Ketiga kartu SETINGGI SATU SAMA LAIN** (`.cash-group` flex kolom, daftar itemnya `flex: 1`
    dengan `align-content: start`). Bukan kerapian: baris Total ketiganya berdiri sejajar di garis
    yang sama, dan tiga angka yang sejajar bisa diadu tanpa mata berpindah tinggi. `align-content:
    start` yang menahan itemnya tetap rapat di atas — tanpa itu, dua item Cash Inflow berdiri
    berjauhan di tengah kartu setinggi delapan item. Di bawah 980px ketiganya menumpuk satu per
    baris — TIDAK berpasangan seperti kartu ringkasan lain, karena tiga itu ganjil dan yang
    tertinggal di baris kedua justru Cash Available. Baris kepala memakai `grid-template-columns`
    yang SAMA, jadi tiap angkanya berdiri tepat di atas kelompok yang menjumlahkannya.
- **Riwayat top-up April–Juli 2026 lahir dari satu seed** (`migrations/seed-whitelist-topup.mjs`,
  `npm run seed:whitelist-topup`, 120 baris). `whitelistTopup` di RTDB baru dimulai 3 Agustus, jadi
  tanpanya kartu TopUp WL berbunyi Rp 0 untuk empat bulan pertama — dan kolom Total Topup di
  /proyeksi-budget tidak punya pembagi sama sekali.
  - **Idempotent lewat KUNCI TURUNAN** (`2026-05-12__TBZ-1236__2`), bukan push key: tanggal + akun
    TIDAK unik — 12 Mei memuat dua top-up TBZ 1236 senilai Rp 500.000 masing-masing, dan keduanya
    nyata. Push key baru tiap kali menggandakan setoran yang sama, dan itu tidak terlihat sampai
    totalnya diadu dengan rekening.
  - **Kolom Total dipakai sebagai CHECKSUM** (nominal + fee), dan selisih di baris mana pun
    MENGHENTIKAN run — sepola dengan seed Potongan Company dan Invalid Traffic.
  - **PIC dari `adAccounts.userOwner`, bukan dari kolom Keterangan**, walau keterangannya menyebut
    nama ("NUR", "ACA", "FIRMAN IBNU"). Aturan yang sama dengan `migrate:topup-pic`. Delapan akun
    belum terdaftar di /ad-accounts (TBZ 0975/0987/0988/1054/1234/1238, WL Personal ACA/NUR) — 14
    baris, Rp 18 juta — dan ditulis TANPA pic; nama tebakan lebih buruk daripada sel kosong, karena
    porsi dana orang lain ikut bergeser karenanya.

- **Baris Total menjumlahkan yang SEDANG TAMPIL**, dan ROI-nya dihitung dari jumlah uangnya lewat
  `cashFlowTotals` yang sama — bukan rata-rata kolom persen, yang memberi bobot sama kepada
  subdomain yang membelanjakan Rp 50.000 dan yang membelanjakan Rp 12 juta. Total yang tidak ikut
  menyempit saat sebuah nama dipilih akan diadu dengan kolom di atasnya dan tidak pernah cocok.
- **Ia TAB, bukan barisnya sendiri di sidebar**: bacaannya satu dengan induknya, periodenya
  sama-sama rentang tanggal lewat `DateRangePicker` yang sama, dan izinnya sama persis
  (KEUANGAN_PAGES). Itu kebalikan dari `/proyeksi-budget`, yang berdiri sendiri karena izinnya
  lebih ketat — superadmin saja. Bentuk periodenya sudah bukan pembeda sejak keduanya memakai pemilih yang
  sama; yang tersisa sebagai alasan cuma izinnya, dan itu memang cukup.
  Berdiri tepat sesudah Laba Rugi dan sebelum kelima tab input: ia satu-satunya tab lain di grup
  ini yang isinya laporan.
- **KOLOM COMPANY DAN BONUS DI SINI SAMA PERSIS DENGAN BARISNYA DI LABA RUGI**, dan itu dijaga
  `profitLoss ≡ cashFlow` di `src/lib/profitLoss.test.mjs` — bukan oleh kalimat di dokumen ini.
  Keduanya sempat berselisih di dua tempat sekaligus, dan keduanya gagal tanpa suara: `accountCloses`
  yang cuma dibaca salah satunya, dan pembagian invalid traffic yang di sini per (domain, JENIS
  AKUN) sementara di sana per domain saja. Embernya sekarang sama bentuknya di kedua modul; yang
  berbeda cuma tingkatnya (di sini per subdomain, di sana per PIC), dan pembagian sebanding
  menjumlah sama di kedua tingkat itu.
- **Selisih yang TERSISA sudah punya namanya sendiri**: pendapatan di Laba Rugi datang dari
  `weeklyFinancials` (berskala usaha, tanpa syarat pemetaan campaign), sementara halaman ini —
  seperti Kalender dan tab Grafik pada lingkup "Yang terpetakan" — hanya memuat yang punya baris
  ROI. Itu `coverageGap`, dan Laba Rugi sudah menyebutkannya di layarnya sendiri.

### Laba per Domain: rantai yang sama, pada TINGKAT DOMAIN

Tab **Laba per Domain** (`/domain-profit`, tepat sesudah Cash Flow di bawah Accounting) menjawab
rantai yang sama pada tingkat ketiga: Laba Rugi untuk seluruh usaha, Cash Flow per subdomain, dan
yang ini **per domain** — disaring per advertiser. Aturannya di
[`src/lib/domainProfit.js`](src/lib/domainProfit.js), sheet acuannya "% Advertiser" — nama itu
sengaja TIDAK jadi label tab: yang dibaca orang di kepala halaman adalah LABANYA, sementara
persentase cuma cara membaginya. Tab bernama persen berdiri di antara delapan tab yang semuanya
menyebut isinya, dan tidak satu pun dari kedelapan itu bisa dipakai menebak apa isi yang ini.

- **Tingkat domain punya halamannya sendiri karena di situlah uangnya dibagi.** Kesepakatan
  Potongan Company berdiri per domain (`companyPercents`) dan pencairan rekening juga (`payouts`),
  jadi itu tingkat yang dipakai orang saat menagih. Di tab Cash Flow satu domain berdiri di lima
  baris yang harus dijumlahkan sendiri di kepala pembacanya.
- **BARISNYA DATANG DARI `buildCashFlow`, bukan dihitung ulang** — dan penjumlahnya `cashFlowTotals`
  yang sama. Itu yang membuat satu domain tidak bisa berbunyi dua angka berbeda di dua tab
  bersebelahan; dijaga `domainProfit.test.mjs`, yang mengadu totalnya dengan tab sebelahnya.
  Konsekuensi yang ikut gratis: ROI baris domain dihitung dari JUMLAH uangnya, bukan dari
  rata-rata ROI subdomainnya — rata-rata memberi bobot sama kepada yang membelanjakan Rp 50.000
  dan yang membelanjakan Rp 12 juta.
- **Bonus DIJUMLAHKAN dari baris, tidak dihitung dari agregat domain.** Dasarnya net profit SEBULAN
  milik tiap PIC (`withBonus`), dan sebuah domain bisa dipegang dua orang bertarif berbeda —
  dihitung dari agregat, salah satu tarif akan menang untuk uang yang bukan miliknya. Karena itu
  kolom Bonus % bisa berbunyi "10% → 15%", sepola dengan kolom Company %.
- **Net Income Owner di sini DIKURANGI Biaya Operasional**, mengikuti sheet "Rekap % Advertiser"
  (blok Juli–Agustus 2026: Earning − Company − IVT − Spend − Potongan Pencairan − Biaya Operasional
  = Net Profit, lalu − Bonus). Porsinya per baris dari `buildCashFlow` (porsi earning, Rp 0 sebelum
  Juli 2026), dan rantainya jadi sama dengan Laba Rugi. Gross Profit Advertiser (`netProfit`) TIDAK
  ikut berubah — ia tetap sama dengan kolom Net Profit di Cash Flow.
- **Penyaring advertiser bekerja SEBELUM pengelompokan.** Memilih seorang advertiser berarti
  "domain ini menghasilkan berapa dari tangan dia", bukan "domain yang kebetulan dipegangnya,
  seluruh isinya". Pilihan dropdown-nya diambil sebelum penyaringnya dipakai — kalau tidak, memilih
  satu nama menghapus semua nama lain dari daftarnya dan tidak ada jalan kembali selain
  mengosongkan alamat.
- **Domain yang ditandai "Account Close" di `payouts` pindah ke tabelnya sendiri, TIDAK dibuang.**
  Pendapatannya tidak akan pernah cair, jadi menjumlahkannya dengan yang lain menghasilkan Net
  Income Owner yang tidak mendarat di rekening siapa pun — pemisahan yang sama dengan blok
  "Accounts Close" di spreadsheet acuannya. Yang memutuskan tetap `isAccountClose` di
  [`src/lib/payouts.js`](src/lib/payouts.js), satu baris yang dibaca dari dua tempat: halaman ini
  dan "Akun Close Cut" di kartu Cash Flow. Ditulis dua kali, satu halaman akan memisahkan domain
  yang halaman sebelahnya masih menjumlahkan.
  **Karena itu totalnya LEBIH KECIL daripada Laba Rugi dan Cash Flow**, dan halaman ini
  menyebutkannya di bawah rantai berikut nominalnya — angka yang diam-diam berbeda dari tab
  sebelahnya adalah persis yang membuat orang berhenti mempercayai keduanya.
- **Kolomnya memakai kosakata dashboard, bukan kosakata sheet.** "Gross Profit" di sana adalah
  `netProfit` di sini dan "Gross Income Owner" adalah `netIncomeOwner`; rantainya identik, cuma
  namanya yang berbeda. Yang dipakai adalah nama yang sudah dipakai dua tab di sebelahnya —
  termasuk **Potongan Pencairan**, yang sempat berdiri di sini sebagai "Biaya Pencairan Khusus akun
  Pakistan" (lihat aturan namanya di rantai Laba Rugi di atas).
  **Yang masih menyimpang tinggal satu: kolom `netProfit` berjudul "Gross Profit Advertiser".**
  Keluhan yang melahirkannya benar — ia masih di ATAS bonus advertiser, jadi ia menjanjikan angka
  terakhir untuk kolom yang bukan — tapi keluhan itu berlaku SAMA PERSIS untuk kolom Net Profit di
  Cash Flow, jadi mengganti namanya di satu tab saja cuma memindahkan kebingungannya. Yang benar:
  ganti di ketiganya, atau pindahkan keterangannya ke `ColumnHint` seperti Potongan Pencairan.

### Negara domain: ditandai orang, dan ia MEMUTUSKAN pajak pencairan

Kolom **Negara** di `/domains` menandai rantai pembayaran sebuah domain. Kosakatanya di
[`src/lib/countries.js`](src/lib/countries.js).

- **Di DOMAIN, bukan di akun.** Yang punya rekening memang akunnya, tapi yang punya baris pencairan
  adalah domain — `payouts` berdiri per (bulan, domain), dan begitu juga Laba per Domain. Ditandai
  di akun, tiap pembacaan harus lewat pemetaan domain→akun yang tidak selalu ada (baris AdSense
  menyebut nama AKUN, bukan domain), dan yang tidak terpetakan kehilangan langkah pajaknya tanpa
  satu tanda pun di layar. Kolom `negara` teks bebas di `gamAccounts` dibiarkan berdiri apa adanya;
  tidak ada satu baris kode pun yang membacanya.
- **Pilihan berkode ISO, bukan kotak teks** — sepola dengan Jenis Akun di Invalid Traffic dan
  Keterangan di Pencairan: kolom yang MEMUTUSKAN sesuatu tidak boleh diketik. "PK", "Pakistan", dan
  "pakistan" adalah tiga negara berbeda bagi kolom bebas, dan kolom `negara` lama sudah
  membuktikannya: KOSONG justru untuk psaonlineappointment.com, satu-satunya baris yang rantai
  asingnya berjalan, sementara theglobesimregistration.ph tertulis "Indonesia".
- **Pilihan KOSONG berdiri paling depan, dan itu bukan kerapian.** `getInitialFieldValue` di
  ResourceForm mengambil pilihan PERTAMA sebagai nilai awal select yang tidak punya `default`;
  tanpa baris kosong di puncak, tiap domain baru lahir bertanda Indonesia — negara yang tidak
  pernah dipilih siapa pun, di kolom yang menentukan pajak pencairannya. "Belum ditandai", bukan
  "Indonesia (bawaan)": menebak negara yang paling sering benar menghasilkan baris yang tidak bisa
  dibedakan dari baris yang benar-benar diperiksa orang.
- **Daftarnya SENGAJA pendek, bukan seluruh ISO 3166.** `<select>` berisi 249 baris berhenti bisa
  dibaca, sementara yang benar-benar dipakai armada ini bisa dihitung jari. Menambah negara adalah
  satu baris di `COUNTRIES` — benderanya ikut sendiri, karena ia diminta dari kode ISO-nya.
- **TIDAK ADA API YANG MENJAWAB NEGARA, dan itu sudah diperiksa.** `Account` di AdSense v2 membawa
  `displayName`/`timeZone`/`state`; `Network` di Ad Manager v1 membawa `currencyCode`/`timeZone`.
  `reportTimeZone` dan `saldoCurrency` yang ditulis sync menjawab SETELAN AKUN, bukan negara
  pemiliknya — tiga akun Pakistan berbunyi `Asia/Jakarta` — dan negara registrant di RDAP/WHOIS
  hampir selalu diredaksi. Yang bisa dibaca sendiri cuma **akhiran domain**, dan itu dipakai sebagai
  `fallback` (usulan yang mengisi kotak kosong saat baris BARU dibuat) dan bukan `compute`: ia tidak
  bisa menjawab semuanya — psaonlineappointment.com berakhiran `.com` sementara rantainya Pakistan
  — dan tebakan yang menang atas ketikan orang akan menimpa negara yang benar tiap kali baris lama
  disunting. ccTLD yang dijual bebas ke seluruh dunia (`.co`, `.io`, `.ai`, …) tidak pernah jadi
  tebakan; `.uk` diterjemahkan ke `GB`, satu-satunya tempat akhiran dan kode ISO tidak sama.
- **Benderanya GAMBAR dari flagcdn.com, bukan emoji.** Bendera emoji adalah dua huruf penanda
  wilayah yang digabung font, dan Segoe UI Emoji tidak memuat satu pun — di Windows yang muncul
  justru "PK" telanjang, dan Windows adalah mesin yang membuka dashboard ini. Gambarnya
  `onError`-nya menyembunyikan diri, bukan menampilkan ikon rusak: yang menerangkan sel itu NAMA
  negaranya di sebelah kanan, jadi jaringan yang tidak bisa menjangkau flagcdn kehilangan hiasan,
  bukan informasi. Diberi batas tipis karena beberapa bendera berujung putih (Indonesia, Jepang)
  dan tanpa batas ia luruh ke dalam latar terang.
- Tidak butuh `npm run deploy:rules`: `domains` dan `payouts` tidak punya `.validate`.

### Laporan Pencairan Rekening: rantai yang sama, DILANJUTKAN sampai rekening

Tab **Pencairan** (`/payouts`, tepat sesudah Cash Flow di bawah Accounting) menjawab pertanyaan
yang berhenti di ujung Laba Rugi: **berapa dari laba itu yang benar-benar mendarat di rekening,
dan apa saja yang mencegatnya di jalan.** Satu baris per BULAN per DOMAIN. Aturannya di
[`src/lib/payouts.js`](src/lib/payouts.js), koleksinya `payouts`.

```
Earning Final = Earning Google − Potongan Company − Invalid Traffic + Saldo Sebelumnya
Saldo Close   = Earning Final, kalau statusnya "Account Close"; selain itu Rp 0
Real Masuk    = Earning Final − Saldo Close, KECUALI kalau angka notifikasi Google diketik
Sunat Google  = Real Masuk − (Earning Final − Saldo Close)
Pajak Negara  = Pajak % × Real Masuk
Nominal Fee   = Fee % × (Real Masuk − Pajak Negara)
Saldo Akhir   = Real Masuk − Pajak Negara − Nominal Fee − Potongan Konversi
```

- **KETIGA angka di kepala rantai tidak diketik siapa pun.** Spreadsheet acuannya meminta Earning
  Google, Company Ad Exchange, dan Invalid Traffic diketik ulang per domain per bulan; ketiganya
  sudah ada — `roiReports` lewat `domainIndex` + `sourceSplit`, tarif dari `companyPercents`, dan
  nominal dari `invalidTraffic`. Tidak satu aturan pun dihitung ulang di modul ini: keempat
  fungsinya diimpor dari modul yang sudah dipakai Laba Rugi, Cash Flow, Invalid Traffic, dan Target
  — disalin, satu domain akan berbunyi dua angka berbeda di dua tab yang bersebelahan di kepala
  halaman yang sama.
- **Potongan Company dicari PER HARI dan kena Ad Exchange saja**, aturan yang sama dengan Laba Rugi
  dan Cash Flow — karena itu kolom Company % bisa berbunyi "10% → 20%". Yang dijumlahkan di kolom
  Earning Google tetap KEDUA sumber: yang dibayarkan Google ke rekening adalah seluruh pendapatan
  domain itu, bukan sebagiannya.
- **Invalid traffic menjumlahkan KEDUA jenis akun**, dan Rp 0 di sana benar untuk bulan yang belum
  pernah dicek: ia jumlah dari himpunan kosong, jawaban yang sama dengan `buildProfitLoss`. Yang
  kosong ("-") justru Earning Google — bulan + domain tanpa satu pun baris ROI berearning, di mana
  Rp 0 adalah klaim bahwa domainnya tidak menghasilkan apa-apa dan seluruh rantai di bawahnya lahir
  dari klaim itu.
- **SATU KOLOM YANG DI SPREADSHEET (Auto) DAN DI SINI BOLEH DIKETIK: Real Masuk Rekening.** Ia
  angka dari notifikasi pembayaran Google — yang juga dikutip di kolom Kode PIP — dan pada 12 dari
  20 baris acuan ia TIDAK sama dengan Earning Final: Google membayar menurut angkanya sendiri, dan
  selisihnya sampai Rp 2,6 juta pada satu baris. Sebuah kolom bernama "Real Masuk Rekening" yang
  diturunkan dari pembukuan kita sendiri akan berbeda dari mutasi rekening yang jadi buktinya, dan
  tidak ada apa pun di layar yang bisa menjelaskan selisihnya.
  Jadi arahnya dibalik: yang diketik adalah angka yang benar-benar mendarat, dan yang DITURUNKAN
  adalah selisihnya — kolom **Sunat Google**, yang persis menjawab "berapa yang disunat Google
  bulan ini". Sepola dengan `earningManual` di Invalid Traffic, ketikan orang MENANG dan yang
  kosong jatuh ke angka turunannya; bedanya di sini ketikan itu tidak butuh kolom "Sumber"
  tersendiri, karena Sunat Google yang KOSONG (bukan Rp 0) sudah mengatakan bahwa belum ada angka
  notifikasi yang diadu dengan pembukuan.
- **"Account Close" MEMUTUSKAN sesuatu, jadi Keterangan adalah pilihan dan bukan kotak teks.**
  Akun yang ditutup Google menghanguskan seluruh Earning Final-nya ke kolom Saldo Close, dan Real
  Masuk maupun Saldo Akhir-nya nol. Satu huruf meleset menghasilkan baris yang mengaku masih akan
  cair. Ketiga nilainya berlencana; "Account Close" MERAH dan bukan abu-abu — saldonya hangus,
  bukan baris lampau yang sudah selesai.
- **Fee rekening perantara dihitung dari yang BENAR-BENAR masuk, bukan dari Earning Final.**
  Rp 244.126 pada baris Mei psaonlineappointment.com adalah 5% dari Rp 4.882.513, bukan dari
  Rp 5.094.461. Tarif yang kosong bukan 0%, sepola dengan tarif Company dan bonus.
- **Pajak pemerintah memungut DULUAN, dan itu seluruh gunanya berdiri sebagai langkah sendiri.**
  Perantara memungut dari SISA setelah pajak, bukan dari yang dibayarkan Google — dan sampai kolom
  ini ada, skema `payouts` tidak punya cara mengungkapkan pembagi selain Real Masuk.
  `fix-payout-fee-double-count.mjs` sudah menyebutkan batas itu di badannya sendiri: fee Juli 2026
  yang sebenarnya Rp 1.796.441 terpaksa ditulis Rp 2.005.392, dan pajaknya disembunyikan di dalam
  Potongan Konversi. Dengan langkahnya berdiri sendiri, fee-nya jadi Rp 1.804.852 — ralatnya turun
  dari Rp 209.951 ke Rp 8.411, dan yang dibaca rantai laba (kedua TOTAL-nya) tetap eksak.
  - **Tarifnya DIKETIK di baris ini, bukan dibaca dari negara domain saat dirender.** Itu pelajaran
    `companyPercents`: tarif yang dibaca dari konstanta menghitung ulang seluruh bulan lampau pada
    hari angkanya diubah — bulan yang uangnya sudah dibayarkan bergeser sendiri tanpa satu baris pun
    disunting. Negara domain cuma mengisi kotaknya saat baris BARU dibuat (`PAYOUT_TAX_PERCENT` di
    [`src/lib/countries.js`](src/lib/countries.js)), lewat `fallback` — jadi ketikan orang menang.
  - **Tarif KOSONG bukan 0%, dan itu yang membuat baris lama tidak bergeser sedikit pun.** Tanpa
    tarif, pembagi fee kembali Real Masuk dan Saldo Akhir sama persis dengan rumus sebelum kolom
    ini ada. Baris psaonlineappointment.com yang sudah tersimpan dipecah sekali oleh
    `migrations/seed-payout-gov-tax.mjs` (`npm run seed:payout-gov-tax`, idempotent, ber-`--dry`),
    yang menurunkan `potonganKonversi` sebagai SISA supaya Saldo Akhir tetap mendarat di angka
    Binance — selisih di atas Rp 1 menghentikan run, sepola dengan seed Potongan Company. Ia
    menuntut `migrate:payout-fee` sudah jalan lebih dulu: memecah pajak di atas Real Masuk yang
    masih salah menghasilkan tiga pungutan yang semuanya rapi dan semuanya salah.
  - **MEI 2026 TIDAK IKUT TERPECAH, dan barisnya dilewati alih-alih dipaksakan.** Ia kehilangan
    13,39% sementara Juni dan Juli kehilangan 18,18% dan 17,54%: rantai 10% + 5% menuntut
    Rp 780.174 dari pencairan yang seluruhnya cuma kehilangan Rp 720.512, jadi Potongan Konversi
    turunannya minus. Yang tersisa dari mutasinya menyebut dua langkah yang tidak bulat —
    Rp 5.380.512 dari Google, Rp 4.882.513 mendarat di bank Emran (−9,26%), Rp 4.660.000 sampai ke
    Binance (−4,56%) — dan skema `payouts` yang bertarif persen tidak bisa mengungkapkannya persis.
    Menurunkan tarifnya sampai muat adalah presisi yang dikarang; memaksakan Potongan Konversi
    minus lebih buruk lagi, karena ia MENAMBAH Saldo Akhir lewat pintu belakang dan `payoutCostRows`
    lalu melaporkan potongan yang lebih kecil daripada yang benar-benar hilang. Yang dilewati tidak
    kehilangan apa-apa: totalnya sudah benar sejak `migrate:payout-fee`, dan yang tidak terpecah
    cuma pemisahan di dalamnya — persis keadaan sebelum kolom pajak ada.
    **Satu baris yang tidak muat DILEWATI, bukan menjatuhkan seluruh run**, karena bulan lain yang
    justru muat tidak boleh ikut tertahan olehnya. Yang tetap fatal cuma kesalahan sungguhan: baris
    yang tidak ada, dan Real Masuk yang tidak cocok dengan sheet.
  - **Konversi digambar sebagai persen bruto di keluaran script**, dan itu yang membuat hasilnya
    bisa DIPERIKSA lintas bulan: ketiganya lewat rantai yang sama, jadi persennya harus berdekatan
    (Juni 3,68%, Juli 3,04%). Yang menyimpang jauh berarti tarifnya salah dibaca, dan itu tidak
    berbunyi sebagai kesalahan di mana pun.
  - **Judul kolom Potongan Konversi tidak lagi menyebut "Gov Tax".** Pajaknya sudah punya kolomnya
    sendiri dua langkah di kiri, dan nama yang menjanjikan isi yang sudah pindah adalah cara satu
    angka diketik dua kali oleh yang membacanya.
  - **Agustus 2026 ditulis `npm run seed:payout-pakistan`** (idempotent, `--dry`): tiga baris
    Meezan bank (psaonlineappointment.com, bispdailyupdates.pk, theglobesimregistration.ph) dari
    sheet "Note Pencairan", potongan Rp 9.426.006. Sebelumnya `/payouts` Agustus tidak memuat
    ketiganya, jadi Potongan Pencairan berbunyi Rp 0 dan bonus advertiser kelebihan ±Rp 1 juta.
    **Pajaknya 5%, bukan 10% seperti Juli** — itu yang dipungut menurut sheet. Totalnya dijaga
    (Saldo Akhir = angka Binance); pemisahan pajak/fee/konversi meleset sedikit karena dashboard
    memungut pajak dari Real Masuk, sheet dari "Diterima Emran".
- **Kolom Kode PIP adalah KUTIPAN, dan itu yang menjebak `renderCell`.** Ia memuat sebuah nominal
  di tengah kalimatnya ("... sebesar Rp 38.690.091. GG104I25R0"), dan `isRupiahText` dulu cukup
  menemukan "Rp" diikuti angka di mana pun dalam teks — lalu `parseRupiah` menyisir SELURUH
  kalimatnya jadi digit dan mengelem nomor rekening, nominalnya, dan kode PIP-nya jadi satu angka:
  **Rp 1.738.690.091.104.250**. Sekarang polanya dijangkarkan ujung ke ujung: sebuah sel adalah
  uang kalau SELURUH nilainya uang, dan yang cuma menyebutnya adalah kalimat. Itu memperbaiki
  kolom keterangan mana pun yang memuat nominal (catatan Expenses, Reminder), bukan cuma yang ini;
  `sortTableItems` sudah memakai disiplin yang sama sejak awal, dan karena itu urutannya tidak
  pernah ikut salah. Dijaga `src/lib/renderCell.test.mjs`, yang membaca polanya dari berkas
  seberangnya.
- **Diturunkan saat DIRENDER, tidak satu pun ditulis ke RTDB** — dan di sini tanpa pengecualian
  seperti `nominal` di Invalid Traffic, karena tidak ada satu halaman pun yang membaca baris ini.
  Yang tersimpan cuma yang tidak ada di laporan mana pun: saldo sisa bulan lalu, angka notifikasi,
  fee, potongan konversi, rekening tujuan, kode PIP, dan statusnya.
- **TANPA pemilih rentang tanggal**, sepola dengan Invalid Traffic dan karena alasan yang sama:
  bawaannya bulan berjalan, dan satu baris di sini adalah satu BULAN yang sudah lewat — dibiarkan,
  halaman ini terbuka kosong justru bagi orang yang datang mencatat pencairan bulan kemarin. Yang
  menggantikannya **penyaring Bulan** (`?f_month=`, sepola Invalid Traffic) di samping Status dan
  Domain, plus kolom Bulan yang bisa diurut.
  - **Bulannya dibaca dari baris yang SUDAH diturunkan `payoutRows`**, jadi kuncinya selalu
    "2026-07" walau yang tersimpan di baris itu cuma `date` — `monthOf` yang menormalkannya, satu
    tempat yang sama dengan yang mencocokkan baris ini ke earning dan invalid traffic bulan itu.
    Dibaca dari field mentahnya, baris yang ditulis lewat jalur lain akan berdiri sebagai pilihan
    kedua yang berbunyi sama.
- **Izinnya sama persis dengan induknya** (admin + Keuangan lewat `KEUANGAN_RESOURCES`), dan isinya
  menuntutnya sendiri: nomor rekening berikut nama pemiliknya, di samping seluruh pendapatan tiap
  domain.
- **Riwayat April–Juli 2026 lahir dari satu seed** (`migrations/seed-payouts.mjs`,
  `npm run seed:payouts`, butuh `npm run deploy:rules` lebih dulu — node `payouts` baru), yang
  menulis input-nya saja. Kolom Saldo Akhir spreadsheet dipakai sebagai CHECKSUM dan bukan sebagai
  nilai; **LIMA baris memang tidak akan pernah cocok**, dan sebabnya disebutkan alih-alih dipilih
  diam-diam: tiga baris (Mei & Juni designingaround.com, Juli petcins.com) mengurangkan Sunat
  Google DUA KALI di sana — sekali lewat Real Masuk yang memang sudah dipotong Google, sekali lagi
  di kolom Saldo Akhir — sementara dua baris psaonlineappointment.com menghitungnya dari Earning
  Final, dan yang Juli malah tidak mengurangkan potongan konversinya sama sekali walau baris Juni
  yang sama mengurangkannya. Tiga baris psaonlineappointment.com memakai tiga rumus berbeda di
  spreadsheet itu. Yang KEENAM tidak cocok berarti salah ketik, dan script menyebutkannya.
- **Satu lagi yang sengaja tidak direproduksi**, dan sudah disebut di `seed-company-percents`:
  baris Mei psaonlineappointment.com dipotong 5% atas pendapatan AdSense-nya di spreadsheet
  (Rp 258.250). Potongan Company kena pendapatan Ad Exchange saja, jadi kolomnya berbunyi Rp 0 dan
  Earning Final-nya lebih besar sebesar angka itu.

### Tarif Bonus: bertanggal, sepola Potongan Company

Tab **Tarif Bonus** (`/bonus-percents`, di bawah Accounting) memegang tarif bonus advertiser per
orang berikut BULAN mulai berlakunya. Aturannya di [`src/lib/bonusPercent.js`](src/lib/bonusPercent.js),
yang memakai pencari tarif `companyPercentIndex` dan kolom turunan `companyPercentRows` yang sama
(keduanya menerima nama field kuncinya).

- **Alasannya sama persis dengan Potongan Company**: `users.bonusPercent` satu nilai per orang, jadi
  menaikkan tarif hari ini menghitung ulang bonus seluruh bulan lampau — termasuk yang sudah dibayar.
- **Satuannya BULAN** (`effectiveFrom` selalu tanggal 1): dasar bonus adalah net profit SEBULAN.
- **`users.bonusPercent` jadi tarif SEBELUM baris bertanggal pertama orang itu**, dan karena itu
  fitur ini tidak butuh migrasi: orang tanpa satu baris pun dihitung persis seperti sebelumnya.
  Kolomnya keluar dari form Team (menyuntingnya di sana justru mengulang bug-nya) dan berbunyi
  "% Bonus awal" di tabel. Baris bertarif KOSONG berarti berhenti dapat bonus, bukan kembali ke
  tarif lama.
- **Laba Rugi dan Cash Flow memakai tarif bulan TERAKHIR rentangnya** (`period.to`). Dasar bonus
  dijumlah per PIC seluruh rentang di kedua modul, jadi rentang lama beberapa bulan memakai satu
  tarif — dan kedua halaman tetap berjumlah sama (dijaga `profitLoss ≡ cashFlow`).
- Butuh `npm run deploy:rules` (node `bonusPercents`) dan hosting.

### Potongan Company: tarif punya TANGGAL berlaku, dan halamannya sendiri

Tab **Potongan Company** (`/company-percents`, di bawah Accounting) memegang tarif bagi hasil Ad
Exchange per domain. Ia dulu satu kolom di `domains` — satu nilai per domain, ditimpa tiap kali
berubah. Aturannya di [`src/lib/companyPercent.js`](src/lib/companyPercent.js).

- **Yang dibayar kolom lama itu bukan kerapian melainkan RIWAYAT.** Tarif yang naik dari 10% ke 20%
  bulan ini menghitung ulang SELURUH bulan lampau dengan tarif hari ini: laba Juni yang sudah
  dilaporkan berubah sendiri tanpa satu pun baris yang disunting, dan yang melihatnya cuma orang
  yang kebetulan membuka bulan lama. Alasan yang sama persis yang menjadikan `invalidTraffic` dan
  `adxCosts` koleksi sendiri.
- **Satuannya TANGGAL, bukan bulan.** Sebuah domain di-relink ke company lain di tengah bulan
  (lihat `adxCosts`: 21 Mei, 11 Juni), dan tarif barunya berlaku sejak hari itu. Konsekuensinya
  mengikat: yang memakai tarif ini WAJIB menghitung per baris ROI HARIAN. `splitByOwner` memang
  begitu — dan `companyBreakdown` karena itu membawa `percents` (himpunan tarif yang benar-benar
  dipakai bulan itu, digambar "10% → 20%"), bukan satu angka yang harus memilih salah satunya.
- **Hari SEBELUM baris tarif paling awal sebuah domain tidak jatuh ke baris itu.** Kalau seseorang
  mengisi tarif baru berlaku 1 Okt hari ini, seluruh riwayat sebelumnya tidak boleh ikut terpotong
  dengan tarif yang belum pernah berlaku — itu persis keadaan yang koleksi ini ada untuk
  mencegahnya. Yang tidak punya tarif masuk `earningWithoutPercent`, bukan dianggap bebas potongan.
- **Tarif KOSONG di sebuah baris berarti "sejak tanggal ini tarifnya tidak diketahui"**, bukan
  "tarif sebelumnya masih berlaku". Barisnya tetap masuk indeks; itulah gunanya.
- **"Berlaku s/d" dan "Status" DITURUNKAN, tidak disimpan.** Yang pertama sehari sebelum tarif
  berikutnya di domain yang sama — disimpan, ia harus ditulis ulang ke baris LAMA tiap kali baris
  baru dibuat, dan baris lama yang terlewat akan mengaku berlaku selamanya. Statusnya berganti
  sendiri saat tanggalnya lewat, tanpa ada yang menyentuh apa pun.
- **Empat status, dan "Berakhir" sengaja TIDAK merah**: tarif yang sudah digantikan masih dipakai
  untuk bulan-bulan lampau — seluruh alasan koleksi ini ada — jadi ia bukan baris mati yang boleh
  dihapus. Yang menuntut tindakan cuma **Ditimpa**: tarif yang tidak pernah berlaku sehari pun
  karena baris berikutnya bertanggal sama atau lebih awal, hampir selalu salah ketik tanggal.
- **`domains` tinggal untuk NAMANYA saja.** `splitByOwner` memisahkan `domainInfo` (label + daftar
  akhiran untuk subdomain yang belum terdaftar) dari tarifnya; digabung, domain yang belum punya
  baris tarif akan hilang dari pencocokan akhiran juga, dan earning-nya lenyap dari laporan alih-alih
  cuma tidak terpotong.
- **Izinnya LEBIH ketat daripada tempat asalnya** — Keuangan, sementara kolom % Company di /domains
  terbaca setiap akun yang login. Itu perbaikan, bukan efek samping: tarif bagi hasil adalah isi
  kesepakatan, dan satu-satunya yang perlu membacanya adalah yang menghitung labanya. Ia juga
  syarat tab: tab tidak boleh lebih terbuka daripada induknya.
- **Riwayat tarif April–Juli 2026 lahir dari SATU seed** (`migrations/seed-company-percents.mjs`,
  `npm run seed:company-percents`) — dan itu yang dijalankan, BUKAN `migrate:company-percent`. Yang
  itu memindahkan satu nilai per domain dari kolom lama dan memberinya tanggal 2020; seed ini
  membawa tarif yang benar-benar berlaku tiap bulan, jadi ia lebih baik di tiap barisnya.
  `--drop-legacy` membuang baris 2020 kalau migrasinya terlanjur jalan.
  - **Yang diamati per BULAN, yang ditulis per PERUBAHAN**: 76 baris pengamatan jadi 10 baris tarif
    di 6 domain (xiaomidriversdownload.com 10% sejak April lalu 15% sejak Juni; designingaround.com
    74% → 54% → 20%). Baris yang mengulang tarif yang sama cuma memenuhi kolom "Berlaku s/d" dengan
    rentang sebulan-sebulan yang tidak menandai apa pun.
  - **Kolom Potongan di spreadsheet dipakai sebagai CHECKSUM, bukan sebagai nilai** — ia turunan di
    sana juga (tarif × earning). Selisih di atas Rp 1 MENGHENTIKAN run: tarif yang salah dibaca
    tidak boleh tersimpan diam-diam, karena ia lalu memotong bulan-bulan lampau tanpa ada yang
    memeriksanya lagi. Begitu juga satu bulan + domain yang membawa dua tarif berbeda.
  - **Tanggalnya tanggal 1, dan itu satu-satunya jawaban yang datanya ada**: spreadsheet menyebut
    BULAN. Tarif yang ternyata berganti di tengah bulan disunting di halamannya — koleksi ini
    bertanggal supaya presisi itu bisa ditambahkan belakangan.
  - **Satu baris AdSense membawa tarif** (Mei, marriage.psaonlineappointment.com, 5% = Rp 258.250),
    dan dashboard TIDAK akan mereproduksinya: potongan ini kena pendapatan Ad Exchange saja. Tarifnya
    tetap dicatat sebagai tarif domain itu; yang disebutkan seed adalah selisihnya, bukan
    diam-diam dipilih salah satu.
- **Tarif yang HILANG diturunkan dari kolom Rasio di Cost Ad Exchange**
  (`migrations/seed-company-percents-from-adx.mjs`, `npm run seed:company-from-adx`). Rasionya
  ("92/8", turunan/induk) sudah tercatat di dashboard sejak lama dan tidak pernah dipindahkan ke
  koleksi ini; akibatnya per 4 Sep 2026 Rp 47,4 juta pendapatan Ad Exchange Agustus
  (theglobesimregistration.ph + bispdailyupdates.pk) lewat tanpa potongan, sementara tiga domain
  lain masih dipotong 20% padahal kontraknya turun ke 8% sejak 23 Agustus. Pemetaan angka kedua →
  Company % terbukti oleh enam baris yang sudah ada, yang cocok persis pada tanggal yang sama.
  **Hanya yang MENGUBAH tarif yang ditulis**, dan `--since` bawaannya 1 Agu 2026: riwayat April–Juli
  sudah diseed dari kolom Potongan spreadsheet — tarif yang BENAR-BENAR ditagihkan, yang tidak selalu
  sama dengan rasio kontraknya (designingaround.com berkontrak 80/20 sepanjang Mei–Juni tapi dipotong
  74% lalu 54%).
- **Migrasi dari kolom lama memberi tanggal 01 Jan 2020** (`migrations/migrate-company-percent.mjs`,
  `npm run migrate:company-percent`), dan itu bukan angka asal: kolom lama tidak punya tanggal, jadi
  Laba Rugi memakainya untuk tiap bulan yang pernah dibuka. Diberi tanggal hari ini, bulan-bulan
  lampau mendadak kehilangan potongannya. Kolom lamanya dibiarkan sampai diminta
  (`--drop-domain-field`): sesudah migrasi tidak ada satu baris kode pun yang membacanya, tapi ia
  satu-satunya cara mengadu hasil migrasi dengan keadaan sebelumnya.

### Invalid Traffic: empat isian, sisanya diturunkan dari baris ROI

Tab **Invalid Traffic** dulu satu baris = domain + bulan + satu nominal. Bentuk yang benar-benar
dipakai orang punya empat isian dan enam kolom turunan, dan enam itu selama ini diketik ulang dari
spreadsheet. Aturannya di [`src/lib/invalidTraffic.js`](src/lib/invalidTraffic.js).

Yang DIISI: **Bulan**, **Jenis Akun**, **Domain**, dan **Check 1–3**. Yang dihitung:

```
Total Invalid Traffic = Check 1 + Check 2 + Check 3          (disimpan sebagai `nominal`)
Total IVT %           = Total Invalid Traffic / Earning x 100
Net Profit            = Earning - (Ad Spend + Ad Tax) - Total Invalid Traffic
```

- **Earning dan Ad Spend BISA DIKETIK, dan ketikan orang MENANG** (`earningManual`,
  `totalSpendingManual`). Tidak semua bulan punya baris ROI: yang lebih tua daripada sync ini,
  network yang metriknya ditolak, subdomain yang belum terdaftar — semuanya menghasilkan kolom
  kosong yang tidak bisa diperbaiki dari mana pun.
  **Menang, bukan cuma mengisi yang kosong**: sebuah bulan bisa punya baris ROI untuk tiga hari
  saja, dan angka tiga hari di kolom Earning sebuah bulan penuh salah tanpa kelihatan salah —
  persis keadaan yang membuat orang mengetik angkanya sendiri. Kalau ketikan itu bisa dikalahkan
  sync yang datang belakangan, ia hilang pada hari sync berhasil sebagian. Yang mengembalikan angka
  sync adalah MENGOSONGKAN kotaknya; nol yang diketik tetap nol.
- **Karena ia menang, ia wajib terbaca: kolom Sumber** (`dataSource`) — "API", "Manual", "Manual
  (earning)", "Manual (spend)". Disebut per SISI karena keduanya gagal sendiri-sendiri: laporan GAM
  yang tidak ada tidak mengatakan apa pun tentang belanja Meta bulan itu. Kosong untuk baris yang
  kedua sisinya tidak ada — "API" di sana akan terbaca sebagai laporan yang menjawab nol. Kuning,
  bukan merah: angka ketikan bukan kesalahan, ia satu-satunya angka yang ada.
- **Net Profit butuh KEDUA sisi.** Baris yang earning-nya diketik tapi belanjanya belum
  menghasilkan kosong — bukan laba yang dihitung dari belanja nol yang dikarang. Persentase invalid
  traffic tetap muncul; ia cuma butuh earning.
- **Angka manual TIDAK mengalir ke Laba Rugi.** Pendapatan dan belanja di sana dari
  `weeklyFinancials` — berskala usaha, tanpa syarat pemetaan campaign — dan angka yang diketik di
  sini akan jadi pendapatan kedua untuk uang yang sama. Yang mengalir ke sana dari halaman ini
  cuma jumlah Check-nya.
- **`nominal` adalah SATU-SATUNYA angka turunan yang benar-benar disimpan** — bukan karena ada yang
  membacanya (Laba Rugi, Cash Flow, dan Pencairan semuanya lewat `invalidTrafficTotal`, yang
  menghitungnya sendiri dari Check-nya), melainkan karena ia kolom tabel: yang diurut dan dijumlah
  ResourceList adalah field yang tersimpan. Sisanya diturunkan saat DIRENDER (`derive` di resource, dipanggil sekali lewat
  `useMemo` di `main.jsx`), alasan yang sama dengan kolom Status Sync di Ad Accounts: yang ditulis
  benar pada detik ia ditulis dan basi sesudahnya, dan sync berikutnya menggeser earning bulan
  berjalan tanpa menyentuh baris ini.
- **Jenis Akun MEMUTUSKAN bagian earning mana yang dijumlahkan**, jadi ia `select` dan bukan kotak
  teks: `adxRevenue + adServerRevenue` untuk **Ad-Exchanger**, `adsenseRevenue` untuk **Adsense**.
  Satu huruf meleset tidak berbunyi sebagai kesalahan di mana pun — ia menghasilkan baris yang
  seluruh kolom otomatisnya kosong.
- **Belanjanya dibagi menurut porsi earning DI DALAM tiap baris ROI, bukan di tingkat domain.** Meta
  tidak tahu apa-apa tentang GAM maupun AdSense: satu campaign membelanjakan uang ke satu subdomain,
  dan subdomain itulah yang punya sumber pendapatannya. Untuk baris yang seluruh pendapatannya satu
  sumber (hampir semuanya) porsinya 1 dan 0. Dibagi sebanding di tingkat DOMAIN, angkanya meleset
  ratusan ribu — April 2026: xiaomidriversdownload.com berbunyi Rp 3,5 juta untuk baris AdSense yang
  belanjanya Rp 2.805.642.
- **Pembagi nominalnya SATU, dipakai Laba Rugi dan Cash Flow** (`spreadInvalidTraffic` di
  [`src/lib/invalidTraffic.js`](src/lib/invalidTraffic.js)). Sampai 4 Sep 2026 aturannya ditulis dua
  kali, satu di tiap modul, dan keduanya sama-sama menjatuhkan nominal yang tidak punya ember —
  tertutupi di Laba Rugi karena kolomnya dijumlah terpisah, tidak tertutupi di Cash Flow: April 2026
  berbunyi Rp 242.992 di satu halaman dan Rp 218.842 di halaman sebelahnya, untuk uang yang sama.
  **Yang tidak punya ember DIKEMBALIKAN sebagai `invalidTrafficUnspread`, bukan dijatuhkan dan bukan
  dipindahkan.** Sebuah domain bisa dicek untuk sisi bisnis yang bulan itu tidak menghasilkan apa-apa
  (designingaround.com Adsense April, masseffectstore.com Adsense Mei), dan memindahkannya ke jenis
  akun lain di domain yang sama sudah ditolak sejak awal — clawback atas pendapatan AdSense yang
  dibebankan ke ember Ad Exchange mengurangi dasar bonus advertiser yang tidak ada hubungannya
  dengan uang itu. Yang dijaga bukan rapinya total melainkan SIAPA yang menanggung; yang diperbaiki
  cuma bahwa sisanya sekarang disebutkan di bawah tabel Cash Flow dan Laba per Domain. Kartu Cash
  Flow tidak berubah: ia sudah menjumlahkan nominal PENUH sejak awal.
- **Potongan Company TIDAK ikut halaman ini** — tidak sebagai kolom maupun di dalam Net Profit.
  Tarifnya punya TANGGAL berlaku, jadi sebulan bisa memuat dua tarif; halaman ini menghitung dari
  agregat SEBULAN dan tidak punya cara membelahnya. Mengalikan earning sebulan dengan salah satu
  tarifnya akan menyebut potongan yang berbeda dari yang benar-benar dikurangkan Laba Rugi — dua
  angka untuk uang yang sama, di dua halaman bertetangga.
  **Konsekuensinya diketahui dan diterima**: kolom Net Profit di sini lebih besar daripada laba
  sesungguhnya untuk baris Ad-Exchanger, dan tidak sama dengan Net Profit di spreadsheet acuan. Yang
  dijawab halaman ini adalah "berapa persen pendapatan bulan ini yang hangus"; yang menjawab laba
  adalah Laba Rugi.
- **Bulan + domain yang tidak punya satu pun baris ROI berearning menghasilkan `""`, bukan Rp 0.**
  Yang MEMBEDAKANNYA dari nol yang sah: begitu ada satu baris ROI, KEDUA ember (Adsense dan
  Ad-Exchanger) dibuat — jadi domain yang bulan itu memang tidak punya pendapatan AdSense berbunyi
  Rp 0, dan hanya bulan yang belum tersentuh sync sama sekali yang berbunyi "-".
- **Baris ROI yang earning-nya tidak diketahui dilewati BERIKUT belanjanya.** Tanpa earning tidak
  ada yang bisa menentukan sumbernya, dan belanja yang dijatuhkan ke sembarang kolom menghasilkan
  Net Profit yang salah di dua baris sekaligus.
- **Baris LAMA tidak kehilangan angkanya.** Tanpa Jenis Akun, kedua sumber dijumlahkan (baris itu
  memang berarti "invalid traffic domain ini bulan itu"); tanpa satu pun Check terisi, `nominal`
  yang sudah tersimpan itulah yang dipakai — membuka form untuk mengubah keterangan tidak boleh
  mengosongkan nominalnya. Bulannya dibaca dari `date` untuk baris yang ditulis sebelum kolom
  `month` ada.
- **Yang tersimpan tetap `date` berbentuk `YYYY-MM-01`**, dihitung dari kotak Bulan dan digambar
  readOnly. `buildProfitLoss`, `profitLossMonths`, dan filter periode semuanya membaca `date`, dan
  bulan yang disimpan sebagai "2026-04" telanjang diurai `new Date()` sebagai tengah malam UTC — di
  zona negatif ia mundur ke Maret.
- **Satu-satunya halaman keuangan TANPA pemilih rentang tanggal.** Bawaannya bulan berjalan, dan
  satu baris di sini adalah satu BULAN yang sudah lewat: dibiarkan, halaman ini terbuka kosong
  justru bagi orang yang datang menginput hasil pengecekan bulan kemarin.
- **Kolom "No" bernomor KRONOLOGIS, dihitung dari daftar penuh sebelum disaring.** Urutan kunci push
  RTDB (urutan dimasukkan) menaruh baris April yang baru diinput hari ini di antara baris Juli; dan
  nomor yang dihitung setelah penyaringan berubah angkanya tiap kali seseorang mengetik di kotak
  pencarian — itu hitungan baris, bukan nomor.
- **Riwayat April–Juli 2026 lahir dari SATU seed** (`migrations/seed-invalid-traffic.mjs`,
  `npm run seed:invalid-traffic`), yang menulis empat isian itu saja — bukan kolom turunannya, yang
  akan beku di nilai hari migrasi sementara tetangganya bergerak mengikuti sync. Kolom Total di
  spreadsheet dipakai sebagai CHECKSUM dan bukan sebagai nilai: ia turunan di sana juga, dan satu
  baris (Juni, designingaround.com, Ad-Exchanger) memang tidak cocok — Check 2 tidak ikut terjumlah,
  jadi totalnya Rp 2.516 untuk Check yang berjumlah Rp 3.851. Yang ditulis jumlah Check-nya, dan
  selisihnya disebutkan di layar alih-alih dipilih diam-diam.
- **Baris bentuk LAMA di bulan + domain yang sama menghentikan seed itu.** Ia tidak punya jenis
  akun, jadi identitasnya tidak akan pernah sama dengan baris baru mana pun — ia lolos pemeriksaan
  kembar lalu berdiri berdampingan dengan dua penggantinya, dan Laba Rugi menjumlahkan `nominal`
  seluruh baris bulan itu. `--replace-legacy` yang menghapusnya; menghapus data harus diminta, bukan
  efek samping dari menjalankan sebuah seed.
- **`isMonthLike` di `formatDate.js` yang membuat kolom Bulan berbunyi "Apr 2026".** Bentuk
  `2026-04` tidak cocok dengan `DATE_LIKE` (yang menuntut tanggalnya), jadi tanpa pemeriksaan
  tersendiri ia jatuh ke sel apa adanya — satu-satunya nilai bertanggal di seluruh layar yang tidak
  berbunyi seperti tetangganya. Diperiksa dari BENTUKNYA, jadi kolom bulan di tabel mana pun ikut
  tanpa perlu didaftarkan.

### Cost Ad Exchange: catatan kejadian, dan sengaja di luar rantai

Tab **Cost Ad Exchange** (`/adx-costs`, di bawah Laba Rugi) mencatat biaya menyambungkan sebuah
domain ke Ad Exchange lewat sebuah company — Marktube Group, Holuron LLC, Monumetric, dua puluh
baris sejak April 2026. Koleksi `adxCosts`, admin + Keuangan, sepola dengan `invalidTraffic`.

- **Satu baris per PENYAMBUNGAN, bukan per domain.** designingaround.com disambungkan empat kali
  dalam empat bulan ke empat company berbeda, dan Holuron LLC menyambungkan tiga domain di hari
  yang sama. Yang membedakan barisnya adalah tanggal + company-nya; sebuah kolom di `domains` yang
  ditimpa tiap penyambungan menghapus biaya yang sudah dibayar sebelumnya — alasan yang sama persis
  yang menjadikan `invalidTraffic` koleksi sendiri.
- **MASUK rantai Laba Rugi lewat baris Pengeluaran operasional, bersama `expenses` — dan
  diperlakukan SAMA PERSIS dengan sewa server, termasuk cara membaginya.** Sampai Juni 2026 baris
  ini dikurangkan sesudah dasar bonus dihitung; sejak Juli 2026 ia ikut dibagi ke tiap advertiser
  menurut porsi earning dan mengurangi dasarnya (lihat aturan bonus di Laba Rugi). Yang dibagi
  adalah SATU kantong tanpa domain, jadi biaya menyambungkan sebuah domain ikut ditanggung
  advertiser lain — harga yang dibayar supaya satu baris rantai punya satu pembagi, bukan dua.
- **Satu baris di rantai, SATU panel rincian — dan kolom Sumber yang menggantikan pemisahannya.**
  `expenseCosts` dan `adxCosts` tetap disimpan terpisah (keduanya berjumlah persis sebesar baris
  Pengeluaran operasional), tapi `operatingExpenseBreakdown` menyatukan barisnya dan mengurutkannya
  dari yang terbesar: itu pertanyaan yang dibawa orang ke panel ini, dan dua panel terpisah
  menjawabnya cuma di dalam masing-masing kelompok. Yang dijaga pemisahannya dulu tidak hilang, ia
  pindah jadi kolom — sebuah baris yang naik dua juta tetap harus menyebutkan ke halaman mana orang
  pergi memperbaikinya, dan "Sewa server" tepat di atas "petcins.com" tanpa kolom itu tidak memberi
  tahu apa pun. Kolomnya juga yang membuat dua baris bernama sama dari dua halaman berbeda tetap
  terbaca sebagai dua baris, jadi `key` React-nya membawa sumbernya dan bukan cuma labelnya.
  Rinciannya per DOMAIN, bukan per company: yang ditanyakan orang saat baris ini naik adalah domain
  mana yang baru disambungkan.
- **Filter periodenya `DateRangePicker`, pemilih yang sama dengan seluruh dashboard** — tabel ROI
  Realtime, Grafik, Spending, Activity Logs. Dipakai Laba Rugi DAN Cash Flow, jadi dua tab yang
  bersebelahan di kepala halaman yang sama berbicara satu kosakata periode. Menggantikan
  `<input type="month">` bawaan browser, yang bentuknya lain di tiap sistem operasi dan berdiri
  tepat di sebelah tombol filter yang gayanya milik dashboard ini. Alamatnya `?periode=`, lewat
  `useUrlRange`.
- **Dua sumber di rantai ini berdiri per BULAN dan tidak bisa dibelah per hari**: nominal invalid
  traffic (tiga hasil pengecekan, satu lump sum) dan earning akun yang ditutup. Keduanya ikut HANYA
  kalau rentangnya menutup bulan itu penuh (`wholeMonthsIn` di
  [`src/lib/dateRange.js`](src/lib/dateRange.js)), dan bulan yang ketinggalan DISEBUTKAN di layar
  (`partialMonths`). Ketiga jawaban yang mungkin tidak setara: dibagi rata per hari adalah presisi
  yang dikarang; ikut kalau bersinggungan membuat rentang 7 hari menanggung invalid traffic sebulan
  penuh, dan net profit-nya minus karena rentangnya bukan karena usahanya; ikut kalau bulannya utuh
  tidak pernah salah tempat, asal yang tidak ikut disebutkan. Preset "Bulan lalu" menutup bulannya
  persis, jadi pemakaian yang paling sering tetap memuat keduanya. Aturan yang sama berlaku di Cash
  Flow, berikut "Akun Close Cut"-nya — yang menandai domain tutup adalah baris `payouts`, dan itu
  bulanan juga.
- **Periode pembandingnya BULAN KALENDER PENUH sebelumnya** (`previousMonthSpanRange` di
  [`src/lib/monthRangeUtil.js`](src/lib/monthRangeUtil.js)): Agustus diadu dengan 1–31 Juli. Ia
  MENGGANTIKAN `previousRange`, yang menggeser rentangnya sepanjang jumlah HARI-nya — aturan yang
  benar untuk periode bebas dan salah di sini karena dua hal. Pertama, hasilnya hampir tidak pernah
  menutup bulan: Maret mundur ke 29 Jan–28 Feb, dan `wholeMonthsIn` menjatuhkan invalid traffic,
  earning akun yang ditutup, DAN potongan pencairan dari sisi PEMBANDINGNYA saja — jadi tiap kolom
  Selisih mengadu bulan yang lengkap dengan bulan yang tiga sumbernya hilang, dan labanya selalu
  terbaca naik. Kedua, sejak pemilihnya cuma bisa memilih satu bulan, "sepanjang yang sama" tidak
  lagi menjawab pertanyaan siapa pun: yang dibandingkan orang di sini bulan dengan bulan. Rentang
  beberapa bulan dari alamat lama mundur sebanyak itu juga (Jun–Agu melawan Mar–Mei). `previousRange`
  sudah tidak dipakai satu halaman pun dan dibuang berikut tesnya.
- **Bawaannya BULAN PENUH terbaru yang punya data**, lewat `monthRange` — bukan "hari ini". Pada
  tanggal 1 bulan berjalan masih kosong, dan halaman yang membuka diri dalam keadaan kosong terbaca
  seperti rusak. `monthRange` memotong bulan BERJALAN di hari ini, jadi bawaan untuk bulan yang
  sedang berjalan sama persis dengan preset "Bulan ini".
- **Baris yang tanggalnya tidak terbaca DIBUANG** (`rowsInRange`), kebalikan dari `filterByDateField`
  yang meloloskannya. Di sana ia satu baris tabel yang hilang dari pandangan; di sini ia uang yang
  ikut dijumlah ke periode ini DAN ke periode pembandingnya sekaligus.
- **Panel rinciannya TIGA kolom tetap**, bukan `auto-fit`. Yang lama memberi 3, 4, atau 5 kolom
  tergantung lebar layar, jadi panel yang sama berdiri di baris berbeda dari satu monitor ke monitor
  lain — dan urutan panel di sini MENGIKUTI rantai labanya (Pendapatan dulu, potongan sesudahnya),
  yang cuma terbaca kalau jumlah kolomnya tetap. Dua kolom di bawah 1180px, satu di bawah 760px.
  `minmax(0, 1fr)` dan bukan `1fr`: tabel di dalamnya punya lebar minimum sendiri, dan tanpa itu satu
  panel berkolom lebar mendorong tetangganya keluar layar.
- **Laba Rugi TIDAK punya kartu ringkasan.** Keempatnya (Pendapatan, Total Belanja Iklan, Potongan +
  Pengeluaran, Net Income Owner) mengulang angka yang berdiri persis di bawahnya, di tabel yang
  seluruh gunanya adalah dibaca menurun — dan yang ketiga malah melebur tiga baris rantai jadi satu
  jumlah yang tidak ada namanya di rantai itu. Marjin ikut pindah ke keterangan panelnya: ia satu-
  satunya angka di kartu yang tidak bisa dibaca ulang dari kolom di bawahnya.
- **Yang dijumlah hanya kolom rupiah.** Kolom US$ di baris yang sama adalah nilai yang sama dalam
  mata uang lain, bukan biaya kedua.
- **Biaya yang sudah ditulis sebagai baris `expenses` tidak boleh ditulis lagi di sini**, karena
  keduanya sekarang dijumlahkan ke baris yang sama.
- **Biaya rupiah adalah yang BENAR-BENAR dibayar hari itu, bukan hasil kali kurs.** US$ 70 tercatat
  Rp 1.238.073 di April dan Rp 1.250.000 di Juni; yang dikonversi ulang belakangan tidak akan pernah
  cocok dengan mutasi rekening yang jadi buktinya. Kedua kolom berdiri berdampingan, dan hanya yang
  rupiah yang dijumlah di bawah tabel — ringkasan ResourceList selalu diformat Rp, jadi US$ 685 di
  sana akan berbunyi "Rp 685".
- **Baris "Garansi Delink" tidak membawa field biaya sama sekali** — penyambungan ulang yang tidak
  ditagih karena link sebelumnya putus. Kosong, bukan 0: nol adalah klaim bahwa biayanya benar-benar
  nol rupiah, dan lima dari dua puluh baris jatuh ke sana.
- **Kolom BULAN dari spreadsheet asalnya tidak ikut.** Ia turunan penuh dari tanggal, yang sudah
  dirender "21 Apr 2026". Dua kolom yang selalu bisa dibaca dari satu sama lain cuma mendorong angka
  biaya ke luar layar — alasan yang sama yang membuang kolom "Sync Meta" di Ad Accounts.
- **Sengaja TANPA `dateFilterField`, sepola dengan Reminder.** Filter rentang tanggal default ke
  bulan berjalan, dan di sini itu menyembunyikan justru yang dicari orang: sambungan yang dibayar
  April masih sambungan yang hidup hari ini.
- **Kode Jaringan dan Alamat Email terisi sendiri lewat `fallback`, bukan `compute`.** Keduanya
  hampir selalu milik akun GAM domain itu — tapi tidak selalu, dan baris lama harus tetap menyebut
  akun yang dipakai waktu itu. `compute` digambar readOnly dan menang atas ketikan orang, jadi ia
  akan menimpanya tiap kali baris lama disunting. Email dibaca dari `gamAccounts`, yang
  ADMIN_ONLY — untuk Keuangan kotaknya tetap kosong dan diketik.
- **Approval, Setup ADX, dan Setup Sub berlencana BERTIGA atau tidak sama sekali.** Ketiganya
  bersebelahan di tabel yang sama, dan satu kolom status berlencana di antara dua yang tidak akan
  terbaca seolah dua sisanya cuma catatan.
- Riwayat spreadsheet-nya diisi sekali oleh `functions/migrations/seed-adx-costs.mjs`
  (`npm run seed:adx-costs`, `--dry` untuk melihat dulu), yang butuh `npm run deploy:rules` jalan
  lebih dulu. Idempotent lewat tanggal + domain + company.

## Proyeksi Budget: satu angka diketik, terbagi sebanding dengan ROI

`/proyeksi-budget` menjawab pertanyaan yang tidak dijawab satu pun tabel ROI: **dana besok dibagi
berapa ke masing-masing advertiser.** Superadmin mengetik satu angka — dana per hari untuk seluruh tim —
dan tabelnya membaginya sebanding dengan ROI tiap orang. Aturannya di
[`src/lib/spendingPlan.js`](src/lib/spendingPlan.js), halamannya
[`src/components/Spending.jsx`](src/components/Spending.jsx).

- **Alamat lamanya `/spending` tetap dikenali dan dialihkan**, sepola dengan `/gating` →
  `/vi-control` (`PAGES_MOVED` di `main.jsx`, `replace` bukan push). Alamat yang mati menghasilkan
  halaman "tidak ditemukan" yang tidak memberi tahu ke mana halamannya pindah. `kind`/`key`-nya
  tetap `"spending"`: keduanya menamai gerbang izin (`SUPERADMIN_PAGES`) yang tidak ikut berganti
  nama.
- **Kolom ROI-nya hijau tebal**, lewat `roiCellClass` di [`src/lib/adTax.js`](src/lib/adTax.js) —
  satu tempat yang juga dipakai kolom ROI di Cash Flow dan Laba per Domain. Ditulis per halaman,
  salah satunya akan lupa MERAHNYA, dan ROI −80% yang digambar hijau tebal adalah kabar buruk yang
  menyamar sebagai kabar baik. ROI yang KOSONG ("-", di bawah lantai `MIN_ROI_SPEND`) tidak diwarnai
  sama sekali: hijau di sana adalah klaim bahwa ada angka bagus untuk dibaca.
- **ROI di sini BUKAN ROI di halaman lain, dan itu disengaja.** `earning ÷ pembagi × 100`
  (Rp 18 juta atas belanja Rp 2 juta = 900%), mengikuti spreadsheet yang jadi acuan halaman ini —
  sementara seluruh dashboard memakai `(earning − belanja) ÷ belanja` lewat `roiPercent`, yang
  untuk angka yang sama menjawab 800%. Selisihnya tepat 100 poin. Bentuk "berapa kali modal itu
  kembali" dipilih karena ia yang dipakai MEMUTUSKAN: ia tidak pernah kurang dari nol, sementara
  selisih laba bisa negatif — dan bobot minus dalam pembagian proporsional membalik tanda porsi
  setiap orang lain di daftar.
  Ada **dua kolom ROI**, pembaginya yang berbeda: **ROI Advertiser** memakai belanja (spend + ad
  tax), **ROI Owner** memakai total top-up orang itu di periode yang sama dari data
  `whitelistTopup` — dicocokkan lewat **kolom PIC yang tersimpan di baris top-up itu sendiri**
  (diisi otomatis dari `adAccounts.userOwner` saat barisnya ditulis), dan hanya baris yang PIC-nya
  kosong yang jatuh ke pemetaan `namaKode` = `adAccounts.name` -> `adAccounts.userOwner` saat
  dihitung.
  Dana berikutnya dibagi sebanding dengan **ROI Owner**, bukan ROI Advertiser: yang dibagi di
  halaman ini uang pemilik — setoran berikutnya — jadi yang menentukan porsi adalah berapa kali
  setoran orang itu kembali, bukan seberapa hemat ia membelanjakan yang sudah diterimanya. Dua
  konsekuensinya diketahui dan diterima: porsi ikut bergerak mengikuti jadwal setor (top-up bisa
  tertinggal dari belanja — disetor sekali, dibelanjakan beberapa hari), dan yang belum menerima
  setoran sama sekali di periode itu TIDAK berbobot — bukan berbobot nol — sehingga dananya jatuh
  utuh ke baris yang tersisa dengan sebabnya tertulis di bawah namanya (`RowNote`). Konsekuensi
  yang ketiga: kolom ROI Advertiser tidak akan pernah sama dengan kolom ROI di Overview untuk uang
  yang sama.
  **Karena itu `formatReturn` di halaman ini TIDAK memakai tanda "+"** seperti `formatRoiPercent`.
  Tanda itu di sana menandai laba DI ATAS biaya, jadi 0% berarti impas; di sini 100% yang berarti
  impas, dan "+300%" akan dibaca sebagai untung tiga kali lipat padahal artinya untung dua kali.
- **PIC top-up TERSIMPAN di barisnya, dan DIPILIH LEBIH DULU daripada akunnya.** Form Whitelist
  Top-Up memilih **PIC** dulu (pilihannya `adAccounts.userOwner`, tanpa kembar), lalu **Nama /
  Kode** menyempit ke akun milik PIC itu (`optionsWhere` + `afterChange` di ResourceForm). Yang
  dicari orang saat mencatat setoran adalah "untuk siapa", dan daftar seluruh armada adalah cara
  akun orang lain tertulis di baris ini. Invarian lamanya tetap: karena akunnya disaring ke
  pemiliknya, PIC yang tersimpan sama dengan `userOwner` akun yang dipilih — tidak ada nama yang
  diketik bebas, dan "nurjaman wl2" tidak akan pernah cocok dengan `pic` di baris ROI. Mengganti PIC
  MELEPAS akun yang bukan miliknya; memilih akun tanpa PIC mengisi PIC dari pemilik akun itu
  (`topupPic`). PIC kosong menawarkan seluruh akun, termasuk yang belum punya User Pemilik.
  Yang dibekukan tetap KAPAN ia dicatat: pemetaan yang dibaca ulang saat menghitung cuma tahu
  pemilik akun HARI INI, jadi akun whitelist yang berpindah tangan memindahkan seluruh setoran
  bulan lalu ke penerimanya.
  **Konsekuensinya diketahui**: PIC tidak lagi dihitung ulang saat baris lama disunting (dulu
  `compute`); baris yang akunnya sudah berpindah tangan tetap menyebut PIC lamanya sampai orang
  memilih ulang.
  Baris yang ditulis SEBELUM kolom ini ada diisi sekali oleh
  `functions/migrations/backfill-whitelist-topup-pic.mjs` (`npm run migrate:topup-pic`), yang
  membekukan pemilik akun saat itu dan MELEWATI akun yang belum punya User Pemilik — nama tebakan
  lebih buruk daripada sel kosong, karena porsi dana orang lain ikut bergeser karenanya.
- **Kolom Keterangan TIDAK lagi dibaca sebagai PIC** (dulu tebakan terakhir setelah pemetaan akun
  gagal): ia teks bebas berisi catatan orang, dan satu keterangan yang kebetulan menyebut sebuah
  nama memindahkan setoran orang lain ke baris itu — tanpa tanda apa pun selain porsi yang aneh.
  PIC yang **kosong** tetap jatuh ke pemetaan `namaKode` -> `adAccounts.userOwner`: itu keadaan
  setiap baris yang ditulis sebelum kolomnya ada, dan `(tanpa PIC)` untuk seluruh riwayat adalah
  harga yang tidak perlu dibayar.
- **TIDAK ADA satu pun angka yang ditulis ke RTDB dari tabel kalkulator.** Dana yang diketik tinggal di
  alamat halaman (`?dana=`), jadi menutup tab membuangnya dan menyalin alamatnya membawa serta
  proyeksinya utuh. Yang tinggal di database cuma yang datang dari sync (baris ROI), dan data setoran
  top-up yang dikelola terpusat di halaman **Whitelist Top-Up** (`/whitelist-topup`).
  **Versi pertama menyimpan budget/hari tiap orang di `users.budgetPerDay`, dan akibatnya terlihat
  seketika**: satu tombol "bagi rata" menulis Rp 333.333 ke baris SETIAP orang di tim — angka yang
  lahir dari satu percobaan proyeksi, lalu berdiri di profil mereka sebagai fakta, terbaca setiap
  akun yang login (`users` ber-`.read: auth != null`) dan ikut terbawa ke tiap laporan yang
  membacanya. `functions/migrations/drop-user-budget-per-day.mjs` yang membersihkannya.
- **Kolomnya**: Advertiser, Spending, Total Earning, Total Topup, ROI Owner, ROI Advertiser,
  Porsi, Next Budget, Sisa Saldo, Perlu Transfer. Kolom "Dana Spending"/"Sisa Dana"/"Budget per
  hari" pernah ada dan dibuang bersama seluruh gagasan dana-yang-disediakan: ia menuntut angka yang
  tidak datang dari API mana pun, dan satu-satunya tempat menyimpannya adalah baris orang.
- **Porsi menjawab "berapa bagiannya", Perlu Transfer menjawab "berapa yang dikirim" — dan
  pertanyaan kedua itulah yang dibawa orang ke halaman ini.** `Perlu Transfer = max(0, Next Budget
  − Sisa Saldo)`: advertiser yang di akunnya masih ada Rp 3 juta tidak perlu menerima porsinya
  utuh, karena uang itu menumpuk sebagai modal menganggur — dan modal menganggur MENEKAN ROI
  Owner-nya di periode berikutnya, sehingga ia mendapat porsi lebih kecil karena uang yang tidak
  pernah ia minta. Karena itu kolom terakhir inilah yang ditebalkan, bukan Next Budget.
  - **Saldo TIDAK ikut jadi pembagi ROI Owner, dan porsi tidak bergeser sedikit pun karenanya.**
    Dikurangkan dari sana, pembaginya berubah jadi "modal yang benar-benar terpakai" — yang hampir
    sama dengan belanja — dan kedua kolom ROI saling mendekat sampai tidak ada bedanya lagi. Uang
    yang disetor tapi menganggur memang menekan ROI Owner, dan itu bukan cacat perhitungan: dari
    sudut pemilik, modal yang tidak bekerja adalah hasil yang buruk juga.
  - **Jumlah kolom Perlu Transfer SENGAJA lebih kecil daripada dana yang diketik**, dan selisihnya
    punya nama: uang yang sudah ada di akun. Yang wajib sama persis dengan kotak isian tetap kolom
    Next Budget di sebelahnya — itu yang diadu orang dengan angka yang baru saja diketiknya.
  - **`adAccounts.balance` bukan saldo uang melainkan sisa batas pengeluaran** (`remaining`, lihat
    `metaUpdate` di [`functions/sync-core.js`](functions/sync-core.js)). Untuk akun whitelist yang
    batasnya dinaikkan tiap top-up keduanya bergerak bersamaan; akun yang spend cap-nya pernah
    diatur tangan tidak, dan di situ kolomnya melaporkan lebih banyak daripada uang yang tersisa.
  - **Akun yang sync-nya dimatikan (disuspend Meta) tidak ikut dijumlah.** Saldonya beku di angka
    terakhir sebelum suspend, dan uang di akun yang tidak bisa membelanjakan apa pun bukan uang
    yang mengurangi transfer berikutnya.
  - **Saldo yang tidak diketahui bukan nol, dan transfernya PENUH** — dengan sebabnya tertulis di
    bawah nama (`RowNote`). Dua arah salahnya tidak setara: mengirim terlalu banyak menumpuk modal,
    mengirim terlalu sedikit menghentikan iklan di tengah hari.
  - **Angkanya keadaan HARI INI, bukan akhir periode**, dan itu benar justru karena pertanyaannya
    ke depan. Yang dilarang adalah memasukkannya ke kolom mana pun yang dijumlah bersama periode
    terpilih.
- **Kolom Spending, Earning, Topup, dan kedua ROI terisi sejak halaman dibuka**; yang menunggu angka
  yang diketik cuma Porsi dan Next Budget. Halaman yang seluruh kolomnya kosong sebelum satu angka
  diketik terbaca sebagai rusak, bukan sebagai kalkulator yang menunggu.
- **Hari BERJALAN dibuang seluruhnya.** Laporan hari ini memuat setengah hari earning di atas
  belanja yang masih naik sampai tengah malam — dan tidak sama rata: advertiser yang laporan GAM-nya
  datang lebih lambat terlihat lebih buruk daripada rekannya, dan dana berpindah karena jam, bukan
  karena hasil. Konsekuensinya diterima: rentang yang HANYA memuat hari berjalan menghasilkan tabel
  kosong.
- **Hari operasi dihitung dari baris yang ADA, bukan dari panjang rentang yang dipilih**, sepola
  dengan `expectedDays` di Laba Rugi. Yang libur separuh periode disebutkan di bawah namanya
  ("aktif 3 dari 10 hari"), supaya yang baru mulai bisa dibedakan dari yang buruk.
- **Lantai belanja `MIN_ROI_SPEND` berlaku di sini juga, dan di sini taruhannya lebih besar.** Di
  tabel ROI, pembagi Rp 43 cuma menghasilkan angka enam digit yang salah baca; di sini ia menyedot
  hampir seluruh dana berikutnya ke baris yang paling tidak berarti di tabel.
- **Baris yang earning ATAU belanjanya tidak diketahui tidak berbobot — bukan berbobot nol.**
  Laporan GAM yang gagal datang tanpa earning, dan menghukum advertiser atas kegagalan sync adalah
  cara tercepat membuat tabel ini berhenti dipercaya. Dananya jatuh utuh ke baris yang tersisa.
- **`(tanpa PIC)` tidak pernah berbobot.** Uangnya nyata dan ikut total, tapi tidak ada orang yang
  bisa menerimanya; diberi jatah, ia menyerap porsi yang tidak bisa diserahkan ke siapa pun dan
  jumlah kolom Next Budget berhenti sama dengan dana yang benar-benar dibagikan.
- **Kolom Next Budget berjumlah PERSIS sebesar dana yang diketik**, lewat pembulatan sisa terbesar.
  Kolom yang meleset beberapa rupiah dari angka yang baru saja diketik orang akan diadu dengan angka
  itu pada detik pertama, dan selisih sekecil apa pun sudah cukup membuat seluruh tabelnya tidak
  dipercaya.
- **Yang dibuang dari kolom Total Topup cuma hari partial TERBARU, bukan semua hari yang punya
  baris partial** — aturan yang sama dengan `filterRunningDay`, dan bug yang sama kalau dilanggar.
  Baris harian yang sempat ditulis sebagai hari berjalan lalu tidak pernah ditulis ulang
  (subdomainnya tidak muncul lagi di laporan berikutnya) membeku bertanda `partial: true`
  selamanya, jadi hampir tiap hari di RTDB punya satu-dua baris begitu. Dibaca sebagai "hari
  berjalan", seluruh top-up sepuluh hari terakhir ikut terbuang: kolom Total Topup berbunyi Rp 0
  untuk periode yang di halaman Whitelist Top-Up jelas ada isinya, dan karena porsi dibagi menurut
  ROI Owner, tidak ada satu baris pun yang kebagian dana.

- **Sumbernya `roiReports` (baris harian), bukan `roiSnapshots`** — alasan yang sama dengan grafik
  dan Kalender: baris snapshot kumulatif sejak tengah malam, dan yang menjumlahkannya per periode
  melipatgandakan pendapatan hari yang sama.
- **TIDAK ADA satu pun kalimat prosa** — tidak di kepala halaman, tidak di kepala panel, tidak di
  bawah tabel. Lebih jauh daripada panel "Laporan ROI Realtime" di Overview, yang masih menyimpan
  catatan bersyarat. **Yang TIDAK dilarang aturan ini adalah rumus sebuah kolom** — Porsi, Next
  Budget, Sisa Saldo, dan Perlu Transfer membawa ikon "?" di kepalanya (`ColumnHint`), dan
  keterangannya muncul di kotak kecil saat disentuh kursor. Yang dijelaskannya bukan
  keadaan sebuah BARIS (itu tetap urusan kolom dan `RowNote`) melainkan DEFINISI kolomnya, yang
  tidak berubah dari baris ke baris — jadi tempatnya di kepala kolom, sekali, dan hanya untuk yang
  memintanya, dan isinya RUMUSNYA saja ("Porsi × Budget berikutnya") — bukan paragraf yang
  dipindahkan ke dalam kotak. Enam kolom memakainya: kedua ROI, Porsi, Next Budget, Sisa Saldo, dan
  Perlu Transfer. Rumus yang menyebut kolom lain menyebutnya dengan NAMA KOLOMNYA ("Total Earning ÷
  Total Topup"), supaya bisa dicek sendiri baris per baris — dan itu sekaligus batasnya: yang
  pembaginya tidak berdiri sebagai kolom mana pun (porsi dibagi menurut jumlah bobot semua baris,
  sementara baris Total menghitung ROI-nya sendiri dari jumlah uang lewat `totalsOf`) tidak bisa
  dirumuskan sesingkat itu tanpa menyebut angka yang tidak ada di layar. Kotaknya `position: fixed` dengan koordinat yang diukur saat kursor
  masuk, bukan kotak absolut di dalam `<th>`: tabelnya menggulir mendatar di dalam `.table-wrap`
  yang `overflow-x: auto`, dan apa pun yang digambar di dalamnya terpotong tepi kotak itu — persis
  di kolom-kolom terakhir, yaitu yang punya ikonnya. `title` bawaan browser sempat dipakai dan
  tidak cukup: munculnya bertunda sedetik, gayanya milik OS, dan di sebagian mesin ia tidak muncul
  sama sekali. Yang menggantikannya adalah tabelnya sendiri: periodenya disebut kepala panel,
  kolom tanpa pembagi menggambar "-" (bukan Rp 0), dan sebab sebuah baris tidak kebagian dana
  tertulis di bawah namanya (`RowNote`). **Sebuah keadaan yang cuma bisa dijelaskan paragraf di
  bawah tabel adalah tanda KOLOMNYA yang kurang, bukan tanda paragrafnya yang kurang.**
- **SUPERADMIN saja — admin dan Keuangan pun ditolak.** Yang membuka Laba Rugi adalah laporan atas
  bulan yang sudah lewat, dan Keuangan memang harus membacanya untuk bekerja; yang di sini rencana
  ke depan atas ORANG — berapa dana yang akan diberikan kepada tiap advertiser, berdampingan dengan
  hasil tiap rekannya. Sebuah pembagian yang belum diputuskan dan sudah terbaca seluruh tim bukan
  lagi bahan keputusan. `SUPERADMIN_PAGES` di [`src/config/access.js`](src/config/access.js), bukan
  `KEUANGAN_PAGES`.
  **Dan tidak seperti tiga penghuni lain daftar itu, halaman ini tidak punya lapis kedua sama
  sekali**: ia tidak menulis apa pun ke RTDB, tidak memanggil server kontrol, dan tidak membaca satu
  pun node yang tertutup. Jadi `SUPERADMIN_PAGES` plus `key` di `resolveRoute` benar-benar
  satu-satunya penjaganya, persis seperti `otp`, dan yang dijaga adalah PEMBAGIANNYA — bukan
  bahannya, yang tetap bisa dihitung ulang siapa pun yang boleh membaca baris ROI.
- **Barisnya sendiri di sidebar, bukan tab di bawah Laba Rugi.** Periodenya berbeda BENTUK — bulan
  kalender vs rentang bebas — jadi satu kepala halaman harus memuat dua pemilih periode yang tidak
  pernah berlaku bersamaan. Dan izinnya lebih KETAT daripada induknya, kebalikan dari syarat sebuah
  tab: Keuangan akan melihat kepala halaman dengan tab yang tidak bisa ia buka. Tetap di grup
  Keuangan walau superadmin saja, sepola dengan `/plugin` di grup Aset — grup menamai isi halaman,
  bukan siapa yang boleh membukanya.

## Target: satu domain, dua baris tiap bulan

`/targets` mengikuti bentuk yang benar-benar dipakai orang di spreadsheet: **satu baris per domain
per bulan per JENIS AKUN** (Adsense dan Ad-Exchanger), bukan satu angka per domain per bulan.
Aturannya di [`src/lib/targets.js`](src/lib/targets.js).

Yang DIISI: **Status Terkini**, **Target**, **Kendala**, **Catatan**. Yang dihitung:

```
Payout Sebelumnya = Tercapai bulan sebelumnya, domain + jenis yang sama
Tercapai          = earning baris ROI bulan itu, bagian jenis akun ini
Sisa Target       = Tercapai - Target                 (negatif = masih kurang)
```

- **Dipecah per jenis karena keduanya dikejar terpisah.** designingaround.com menargetkan Rp 50 juta
  dari Ad Exchange dan Rp 10 juta dari AdSense; satu angka gabungan tidak bisa mengatakan yang mana
  yang meleset — dan pada Agustus 2026 yang meleset memang cuma salah satunya di hampir tiap domain.
- **Embernya SAMA dengan Invalid Traffic** ([`src/lib/earningByAccountType.js`](src/lib/earningByAccountType.js)):
  `adxRevenue + adServerRevenue` untuk Ad-Exchanger, `adsenseRevenue` untuk Adsense, dengan
  pemetaan subdomain→domain yang sama (`parentDomain` dulu, lalu pencocokan akhiran). Modul itu
  lahir dari pemindahan, bukan penyalinan: dua halaman bersebelahan yang menghitung earning satu
  domain dengan dua aturan akan menyebut dua angka untuk bulan yang sama, dan tidak ada apa pun di
  layar yang bisa menjelaskan selisihnya.
- **Ketiga kolom turunan DITURUNKAN saat dirender, tidak disimpan** — alasan yang sama dengan kolom
  turunan Invalid Traffic. Payout Sebelumnya ikut, justru karena ia angka bulan LALU: disimpan, ia
  jadi salinan kedua dari kolom Tercapai di baris sebelahnya, dan dua angka untuk uang yang sama
  akan berbeda suatu hari.
- **Bulan + domain tanpa satu pun baris ROI mengosongkan Tercapai DAN Sisa Target.** Rp 0 di kolom
  Tercapai adalah klaim bahwa domainnya tidak menghasilkan apa-apa, dan "-Rp 10.000.000" yang lahir
  darinya adalah vonis atas bulan yang laporannya cuma belum datang. Yang MEMBEDAKANNYA dari nol
  yang sah sama persis dengan Invalid Traffic: begitu ada satu baris ROI, kedua ember dibuat, jadi
  domain yang bulan itu memang tidak punya pendapatan AdSense berbunyi Rp 0.
- **Target yang belum pernah diisi KOSONG, bukan Rp 0.** Nol adalah pernyataan ("bulan ini domain
  ini memang tidak ditargetkan"), dan itu pernyataan yang cuma boleh dibuat orang — sepola dengan
  tarif Company yang kosong di /domains.
- **Status Terkini itu pilihan, bukan kotak teks.** Ia tidak diturunkan dari data mana pun ("Review"
  datang dari email Google, "Limit" dari Ads Manager), tapi status yang diketik bebas berakhir
  sebagai enam ejaan untuk satu keadaan — dan kolom yang begitu tidak bisa disaring maupun dihitung.
  Lencananya menumpang `badgeToneByValue` yang sudah mengenal "review", "limit", dan "ready".
- **Sisa Target dirender dengan kunci `profit`, bukan `earning`**: ia satu-satunya kolom di tabel
  ini yang boleh minus, dan minus di sini adalah kabar yang menuntut tindakan.
- **Kolom BULAN dari spreadsheet tidak ikut** — yang menyebutkan bulannya adalah pemilih di kepala
  halaman (`?bulan=`), sekali untuk seluruh tabel. Alasan yang sama yang membuang kolom Bulan di
  Cost Ad Exchange. Bulan-bulan lain tidak hilang: nama domain membuka panel Riwayat untuk domain +
  jenis itu, dan kolom Payout Sebelumnya sudah membawa serta angka bulan lalu.
- **Dua penyaring di sebelah pemilih bulan: Jenis Akun (`?jenis=`) dan Domain (`?domain=`).** Satu
  bulan berisi dua baris per domain, jadi armada sepuluh domain sudah berarti dua puluh baris —
  sementara yang dicari orang hampir selalu satu domain atau satu sisi bisnisnya. Kosong = semua,
  jadi alamat yang belum disaring tetap bersih. Pilihan domainnya diambil dari baris yang
  BENAR-BENAR bisa muncul di tabel, bukan dari `store.domains` langsung: pada hari keduanya berbeda,
  yang ditawarkan dropdown itu adalah domain yang tidak akan pernah punya baris untuk dipilih. Nilai
  yang menyaring tapi tidak ada di daftar pilihan (domain yang dihapus, `?jenis=` yang diketik
  tangan) tetap digambar sebagai pilihan — tanpa itu, select-nya tampil kosong di atas tabel yang
  juga kosong, dan satu-satunya keterangan tentang apa yang sedang menyaring hilang persis saat ia
  paling dibutuhkan.
- **Bentuk LAMA node ini adalah satu ANGKA telanjang di `domainTargets/{id}/{YYYY-MM}`**, dan ia
  jatuh utuh ke Ad-Exchanger — aturan yang sama dengan baris ROI tanpa rincian sumber, dan alasan
  yang sama. Dijatuhkan ke keduanya, satu target terhitung dua kali.
  **Yang ditulis ke RTDB adalah node BULAN utuh** (`targetMonthUpdate` → `writeTarget`), bukan satu
  jenisnya saja: menulis langsung ke `{YYYY-MM}/adsense` di atas sebuah angka telanjang membuat RTDB
  mengganti angka itu dengan objek, dan target Ad-Exchanger yang sudah diketik orang lenyap karena
  seseorang mengisi baris di sebelahnya. Baris yang keempat isiannya dikosongkan DIHAPUS; bulan yang
  habis jadi `null`.
- **Alamat sunting membawa tiga hal** — `/targets/{domainId}/{YYYY-MM}/{slug}/edit`. Slug jenis akun
  (`adsense`, `ad-exchanger`) dipakai dua-duanya sebagai kunci RTDB dan sebagai segmen alamat: dua
  kosakata yang harus sepakat adalah cara sebuah baris tersimpan di alamat yang tidak pernah dibaca
  formnya. Alamat bentuk lama (tanpa jenis) sengaja jatuh ke "tidak ditemukan" — menebak salah satu
  dari dua baris berarti Simpan menulis ke baris yang tidak diminta siapa pun.
- **Form "Tambah" memuat ulang isiannya saat domain/bulan/jenis berganti.** Dihitung sekali saat
  form dibuka, memilih baris yang sudah punya target menampilkan kotak kosong — dan Simpan menghapus
  status, kendala, dan catatan yang sudah diketik orang tanpa pernah menampilkannya.
- **Riwayat Juli–Agustus 2026 lahir dari satu seed** (`migrations/seed-targets.mjs`,
  `npm run seed:targets`), yang menulis empat isian itu saja. Konsekuensi yang diketahui dan
  diterima: Payout Sebelumnya baris Juli adalah realisasi JUNI, jadi ia hanya muncul kalau
  `roiReports` Juni masih ada — yang tidak terjangkau berbunyi "-", bukan angka spreadsheet-nya.
  Domain yang belum terdaftar di /domains DILEWATI berikut sebutannya: baris target tinggal di bawah
  id domainnya, dan menebak id berarti target sebuah domain tersimpan di bawah domain lain.

## Pengingat: satu definisi "jatuh tempo", tiga tempat menampilkannya

Reminder yang jatuh tempo muncul di badge topbar, panel Overview, dan chat Telegram — dan ketiganya
harus menyebut baris yang sama. "Jatuh tempo" berarti belum berstatus Selesai **dan**
`dueDate <= hari ini + REMINDER_LEAD_DAYS` (2 hari).

Aturannya ditulis dua kali karena frontend dan `functions/` adalah dua paket yang tidak bisa saling
impor — [`src/lib/reminders.js`](src/lib/reminders.js) dan
[`functions/reminders-core.js`](functions/reminders-core.js), persis seperti `campaignCommandEntry`.
**Beda sedikit, badge menyala untuk baris yang tidak pernah dikirim ke Telegram.** Satu-satunya
perbedaan yang disengaja: sisi functions memakai `zonedDateKey` (zona operasi), karena fungsi
terjadwal jalan di UTC.

- **Reminder dibaca semua akun yang login, ditulis admin + keuangan.** Pengingat perpanjangan domain
  yang cuma terlihat Keuangan tidak menahan siapa pun selain Keuangan. `canReadResource` melewatkan
  `reminders`, `canWrite` tidak (`KEUANGAN_WRITE_RESOURCES` di [`src/config/access.js`](src/config/access.js)),
  dan tombol "tandai selesai" mengikuti yang kedua — bukan yang pertama.
- **Token bot adalah secret Cloud Functions; chat tujuannya tidak.** `TELEGRAM_BOT_TOKEN` di secret,
  penerimanya di RTDB (`users/{id}/notificationTopics` + `notificationGroups`, lihat Notification
  Center). Siapa yang menerima berubah karena orang masuk/keluar tim, dan itu tidak boleh butuh
  deploy — sementara token bot di `settings` (yang dibaca semua akun) berarti siapa pun bisa
  mengirim pesan atas nama bot itu.
- **Kiriman dijaga per hari lewat `dashboard/reminderNotices`, bukan per reminder.** Yang terlewat
  justru perlu diulang tiap pagi; yang tidak boleh cuma run yang sama mengirim daftar yang sama dua
  kali. Penandanya ditulis hanya kalau ada chat yang benar-benar menerima.

### Yang berulang DIMAJUKAN, bukan diselesaikan

Sewa server tiap bulan, perpanjangan domain tiap tahun, setoran tiap minggu — yang diingatkan orang
hampir semuanya berulang. Field `repeat` (Harian/Mingguan/Bulanan/Tahunan) dengan kelipatan
`repeatEvery` ("tiap 2 minggu"), dan `completionUpdate` di
[`src/lib/reminders.js`](src/lib/reminders.js) yang memutuskan apa yang ditulis saat tombol centang
ditekan.

- **Satu baris per komitmen, bukan satu baris per kejadian.** Baris berulang tidak berstatus
  Selesai; `dueDate`-nya maju dan statusnya kembali "Belum". Alasannya daftar itu sendiri: halaman
  ini sengaja tanpa filter tanggal, jadi baris yang menumpuk tidak punya tempat sembunyi — satu
  pengingat harian akan menulis 365 baris setahun ke daftar yang dibaca seluruh tim. Yang hilang
  karenanya diakui: tidak ada riwayat per kejadian. Yang menggantikannya `activityLogs` plus
  `lastCompletedAt` + `lastCompletedDueDate` di barisnya — yang kedua perlu karena yang pertama
  saja tidak bisa membedakan "tagihan Agustus dibayar telat" dari "tagihan September dibayar awal".
- **Digeser dari `dueDate`, bukan dari hari ini.** Sewa yang jatuh tempo tanggal 1 dan baru dibayar
  tanggal 20 tetap jatuh tempo tanggal 1 bulan depan; dihitung dari hari pembayaran, tanggalnya
  merayap maju tiap bulan sampai tidak ada hubungannya lagi dengan tagihan aslinya.
- **Tapi digeser BERULANG sampai benar-benar lewat hari ini.** Pengingat bulanan yang terlambat
  setengah tahun menghasilkan tanggal yang masih di masa lalu kalau digeser sekali — dan baris yang
  baru ditandai langsung menyala lagi di badge, yang terbaca sebagai tombolnya tidak bekerja.
- **Tanggal 31 dijepit ke akhir bulan tujuan.** `new Date(2026, 0, 31)` ditambah sebulan adalah 31
  Februari, yang digulirkan JavaScript diam-diam jadi 3 Maret — dan tagihan tanggal 31 berpindah ke
  awal bulan lalu tinggal di sana selamanya (31 Jan → 3 Mar → 3 Apr). Yang benar 28/29 Feb, lalu
  kembali ke 31 Mar.
- **Bentuk tanggalnya diperiksa sebelum digeser.** `shiftDateKey("bukan tanggal", 1)` mengembalikan
  `"NaN-NaN-NaN"` — teks yang lolos tiap perbandingan tanggal (huruf "N" lebih besar dari angka mana
  pun) dan tertulis apa adanya ke `dueDate`. Baris itu lalu hilang dari badge selamanya tanpa ada
  yang mengabarkan kenapa.
- **Satuan yang tidak dikenali dibaca sebagai TIDAK berulang**, bukan ditebak. Baris lama tanpa
  field ini dan nilai sampah dari impor jatuh ke sana: pengingat yang diam lebih baik daripada
  jatuh tempo yang melompat ke tempat yang tidak diminta siapa pun.
- **Jendela antisipasi dijepit ke jarak pengulangannya** (`leadDaysOf`). `REMINDER_LEAD_DAYS`
  menjawab "beri tahu beberapa hari sebelumnya", dan untuk yang berulang lebih sering dari jendela
  itu antisipasi tidak berarti apa-apa: pengingat harian yang baru ditandai jatuh tempo lagi besok,
  besok masih di dalam jendela dua hari, dan badge-nya TIDAK PERNAH padam — yang terbaca orang
  bukan "ada tugas harian" melainkan tombol yang tidak bekerja. Harian tiap hari mendapat 0,
  harian tiap 3 hari kembali ke 2, mingguan ke atas tidak berubah sama sekali.
- **Yang dicerminkan ke `functions/` adalah `dueReminders` DAN `leadDaysOf`** — keduanya menentukan
  baris mana yang jatuh tempo, dan beda sedikit berarti Telegram mengirim pengingat harian tiap pagi
  untuk baris yang di dashboard sudah padam. Yang TIDAK dicerminkan `completionUpdate`: memajukan
  baris adalah tindakan orang di browser, dan sisi functions tidak pernah menulis ke `reminders`.

### Pembayaran yang dicentang menulis barisnya sendiri di Expenses

Yang digabung dari Reminder dan Expenses bukan halamannya melainkan pengetikannya: sewa server
jatuh tempo, dicentang di badge, lalu orang yang sama mengetik ulang nominal dan tanggalnya di
`/expenses` supaya ikut terhitung sebagai pengeluaran operasional di Laba Rugi.
`expenseFromReminder` di [`src/lib/reminders.js`](src/lib/reminders.js) yang menurunkan barisnya,
dan `completeReminder` yang menuliskannya lewat `createResourceAt`.

- **Menunya TIDAK digabung, dan itu bukan kelalaian.** `expenses` hanya bisa dibaca admin +
  keuangan, `reminders` dibaca semua akun yang login — Reminder sebagai tab di bawah Expenses
  berarti induknya tersembunyi bagi mayoritas tim dan tab-nya tidak punya jalan sama sekali
  (dijaga `navigation.test.mjs`). Reminder juga sempat jadi tab dan dikembalikan jadi barisnya
  sendiri; alasannya masih berlaku.
- **Hanya tipe Pembayaran yang bernominal.** `type` yang selama ini cuma label sekarang
  MEMUTUSKAN sesuatu, jadi pilihannya tinggal di `TYPE_OPTIONS` dan bukan diketik ulang di
  `resources.js`. Nominal kosong tidak menghasilkan baris: pengeluaran Rp 0 di Laba Rugi terbaca
  sebagai biaya yang benar-benar nol, bukan sebagai nominal yang belum diisi.
- **`date` baris expense adalah HARI PEMBAYARAN, bukan `dueDate`.** Expenses arus kas, dan Laba
  Rugi menjumlahkan per bulan dari field itu — tagihan 1 Agustus yang baru dibayar 20 Agustus
  adalah pengeluaran Agustus. Periode yang dipenuhinya tidak hilang: disebut di Keterangan dan
  disimpan mentah di `reminderDueDate`.
- **ID-nya turunan, bukan push key**: `{reminderId}__{dueDate}`. Klik ganda, retry setelah jaringan
  putus, dan baris berulang yang dimajukan lalu dikembalikan menulis ke alamat yang sama. Push key
  baru tiap kali menggandakan pengeluaran yang sama di Laba Rugi, dan itu tidak terlihat sampai
  totalnya diadu dengan rekening.
- **Expense ditulis DULU, baris reminder-nya sesudahnya** — kebalikan dari urutan yang tampak
  wajar. Dibalik, tulisan expense yang gagal meninggalkan baris berulang yang sudah dimajukan:
  klik kedua memajukannya satu periode LAGI dan mencatat pengeluaran untuk jatuh tempo yang salah.
  Dengan urutan ini, yang tertinggal dari kegagalan di tengah cuma baris expense ber-ID turunan,
  yang ditimpa klik berikutnya.
- **Barisnya diminta SEBELUM `completionUpdate`**, karena sesudah itu `dueDate` di baris sudah
  jatuh tempo berikutnya — dan pengeluaran akan tercatat untuk periode yang belum dibayar siapa pun.
- **Bawaannya mencatat, dan yang tidak ingin dicatat melepas centangnya.** Kotak yang harus
  dicentang dulu tiap kali akan berhenti dicentang, dan yang hilang dari Laba Rugi justru
  pengeluaran yang paling rutin. Kotaknya hanya digambar untuk baris yang `expenseFromReminder`-nya
  benar-benar menghasilkan sesuatu — kotak tercentang yang tidak menulis apa pun adalah janji yang
  tidak ditepati — dan toast-nya menyebutkan baris expense yang ikut lahir.

Selengkapnya: [docs/telegram-reminders.md](docs/telegram-reminders.md).

## Notifikasi: satu daftar tujuan per TOPIK, bukan satu daftar untuk semuanya

`/notifications` (sidebar **Notifikasi**) yang menjawab "siapa menerima apa". Ia menggantikan
`/settings?tab=telegram` — satu kotak teks berisi semua chat id — dan tab itu sudah tidak ada;
alamat lamanya dialihkan di `main.jsx`, sepola dengan `/gating` → `/vi-control`.

Yang salah dengan kotak itu bukan bentuknya melainkan akibatnya: tiap id di dalamnya menerima
segalanya, dan berhenti menerima satu jenis pesan hanya bisa dengan berhenti menerima semuanya.
Notifikasi yang tidak bisa disaring akan dibisukan orang — dan yang ikut terbisukan adalah yang
benar-benar penting.

- **Empat tab, semuanya route sungguhan** — `/notifications` (Orang), `/notifications/topik`,
  `/notifications/calon` (Calon Penerima), `/notifications/peringatan`. Induknya **Orang** dan bukan
  Topik: yang membuka halaman ini paling sering adalah PIC yang mencari barisnya sendiri, bukan admin
  yang mencari setelan. Tiga di antaranya ber-`key` sama karena izin bacanya memang sama — yang
  membedakan admin bukan tab mana yang terbuka melainkan apa yang bisa ditekan di dalamnya.
- **Calon Penerima satu-satunya tab yang tertutup, dan `key`-nya sendiri (`telegramInbox`,
  ADMIN_ONLY_RESOURCES) yang menutupnya.** Yang ditampilkannya bukan setelan kita melainkan nama
  profil dan @username orang luar yang menyapa bot publik kita, dan tombolnya membuat penerima baru.
  Dibiarkan ber-`key` "notifications" seperti tab lain, alamat yang diketik tangan membukanya bagi
  siapa saja — dan yang menyambut mereka bukan penolakan melainkan daftar kosong, karena langganan
  RTDB node itu memang cuma untuk admin.
- **Lencana angka di kepala tab Calon Penerima, dan hari ini itu SATU-SATUNYA lencana tab di seluruh
  dashboard** (`badges` di [`PageTabs`](src/components/ui/PageTabs.jsx), dihitung `tabBadgesOf` di
  `main.jsx`). Yang berhak punya lencana cuma tab yang isinya ANTREAN — sesuatu yang menunggu
  dikerjakan dan habis begitu dikerjakan. Tab yang isinya daftar (Orang, Topik) tidak boleh: angka
  yang tidak pernah berubah jadi nol berhenti dibaca dalam sehari, dan yang ikut berhenti dibaca
  adalah lencana di sebelahnya yang benar-benar menuntut tindakan. **Nol tidak digambar** — bukan
  digambar sebagai "0".
- **Grup TIDAK punya tab sendiri** (sempat punya, dibuang): pertanyaan yang dibawa orang ke halaman
  ini cuma satu — "siapa saja yang dikirimi" — dan jawabannya yang dipecah dua daftar menuntut orang
  membuka dua tempat untuk tahu kenapa sebuah pesan tidak sampai. Baris grup berdiri di daftar Orang,
  dibedakan lencana Jenis yang dibaca dari TANDA chat id-nya (Telegram memberi grup id negatif, chat
  pribadi positif) — bukan dari kolom yang harus diisi orang.
- **Penerima diubah di HALAMAN SENDIRI** (`/notifications/orang/{id}/edit` untuk anggota tim,
  `/notifications/kontak/new` dan `/kontak/{id}/edit` untuk yang bukan), bukan lewat saklar di dalam
  tabel.
  Tabel yang bisa ditekan langsung memang lebih pendek satu klik, tapi ia menulis ke database tiap
  kali kursor tergelincir satu baris — dan di daftar setinggi seluruh tim, baris yang salah
  tersentuh tidak meninggalkan tanda apa pun di layar. Tab **Topik** tetap diubah di tabelnya, dan
  itu bukan kelalaian: yang di sana setelan, bukan baris — jumlahnya tidak bertambah karena tindakan
  siapa pun, sepola dengan tab Ad Tax di Settings.
- **Chat ID juga TIDAK diketik di form Team**, dan itu perbaikan bug — bukan fitur yang hilang.
  Kolomnya tetap di tabel Team; yang mengubahnya cuma halaman ini, yang memeriksa bentuknya sebelum
  menulis dan menyimpan kotak yang dikosongkan sebagai `null`. Form Team tidak melakukan keduanya:
  ia mengisi tiap kotak kosong dengan STRING KOSONG lalu mengirim seluruh field sekaligus, dan
  `.validate` pada `users/$uid/telegramChatId` menolak `""` — yang ditolak bukan field itu saja
  melainkan seluruh tulisannya. **Admin dan superadmin sama-sama tidak bisa menyunting anggota tim
  yang belum punya chat id, dan tidak bisa membuat anggota baru sama sekali**; yang terbaca di layar
  cuma "Perubahan gagal disimpan. Coba lagi." untuk sesuatu yang tidak akan pernah berhasil dicoba
  lagi. Yang dibuang adalah pintu keduanya, bukan pemeriksaannya yang disalin ke sana: dua tempat
  yang menulis satu field dengan dua aturan akan berselisih suatu hari, dan yang kalah adalah yang
  lebih longgar. Dijaga `src/config/resources.test.mjs`, yang membaca `database.rules.json` dan
  menolak field form Team apa pun yang punya `.write`/`.validate` sendiri di bawah `users/$uid` —
  jadi `notificationTopics` dan `campaignCommands` ikut terjaga tanpa disebut namanya.
- **Tidak ada `/notifications/orang/new`.** Baris ANGGOTA TIM lahir di halaman Team bersama akun
  loginnya; "tambah" di sini akan membuat baris kedua untuk orang yang sama. Yang bukan anggota tim
  — pemilik, akuntan, teknisi — lewat Tambah Penerima, dan itu justru gunanya: membuatkan akun login
  berikut role hanya supaya seseorang bisa menerima satu pesan Telegram adalah harga yang jauh lebih
  besar daripada satu baris di `notificationGroups`.
- **Chat yang menyapa bot terdeteksi sendiri; yang diketik orang cuma satu klik.** Cron semenit di
  `server/` menjalankan [`syncTelegramInbox`](functions/sync-telegram-inbox.mjs), yang membaca pesan
  masuk bot dan menuliskan tiap chat ke `dashboard/telegramInbox/chats`. Tab **Calon Penerima**
  menampilkannya berikut tombol Aktifkan. Yang dihapus bukan form Tambah Penerima melainkan
  langkah menyalin chat id dari terminal — satu-satunya langkah di dashboard ini yang salah ketiknya
  tidak mengeluh di mana pun: id yang meleset satu digit tetap berbentuk angka, lolos
  `groupComplaint`, tersimpan rapi, dan gagal diam-diam tiap kali dikirimi.
  - **Terdeteksi bukan berarti aktif, dan klik itu tidak boleh dihapus.** `@rabbitroi_bot` bot
    PUBLIK — siapa pun yang tahu namanya bisa mengirim `/start`. `contactAlertScope` membaca `pic`
    kosong sebagai "semua", jadi penerima yang lahir aktif sendiri menerima peringatan ROI SELURUH
    armada: nama subdomain, spend, dan earning tiap orang. Kebocoran yang bentuknya persis seperti
    fitur yang bekerja.
  - **"Sudah jadi penerima" DIHITUNG, tidak disimpan sebagai kolom.** Kolom status akan benar pada
    detik ia ditulis dan basi sesudahnya — penerima yang dihapus meninggalkan baris yang selamanya
    mengaku terdaftar. Yang disimpan cuma `dismissedAt` (tombol Abaikan), karena itu keputusan orang
    dan bukan turunan dari keadaan lain. Penerima yang DIARSIPKAN tetap dihitung terdaftar:
    mengeluarkan orang adalah tindakan sengaja, dan daftar ini tidak boleh menawarkannya kembali.
  - **Siklusnya MENGKONSUMSI update** (`offset` maju, Telegram menghapus yang lewat) — tanpa itu,
    satu chat yang mengirim 100 pesan menutupi `/start` semua orang lain sampai antreannya
    kedaluwarsa. Akibatnya `getUpdates` telanjang tidak melihat apa pun lagi, jadi
    `npm run telegram:chat-id` sekarang membaca node RTDB itu. Urutan tulisnya **baris → offset →
    sapaan**: offset yang maju duluan berarti chat-nya hilang selamanya bersama update yang sudah
    dihapus Telegram.
  - **Yang disimpan cuma identitas chat, bukan isi pesannya** — `dashboard` terbaca setiap akun yang
    login, dan orang yang mengetik sesuatu ke bot tidak sedang menerbitkannya ke seluruh tim.
  - Kuncinya berawalan huruf (`c1847784116`, `cn1002223334445`), alasan yang sama dengan `c57` di
    antrean gating. Butuh `TELEGRAM_BOT_TOKEN` di `server/.env`; kosong, hanya pendeteksiannya yang
    mati.
- **PERINGATAN ROI DISARING PER PIC, dua topik lain tidak.** Admin menerima seluruh armada; sisanya
  menerima baris yang `pic`-nya dirinya sendiri (`userAlertScope`/`scopedAlerts`, dicerminkan di
  kedua sisi). Alasannya bukan teknis: pengingat jatuh tempo dan kegagalan sync berlaku untuk seluruh
  usaha, sementara peringatan ROI berlaku untuk SATU subdomain — dan yang bisa menindaklanjutinya
  cuma yang memegangnya. Konsekuensinya: satu pesan per penerima (bukan satu daftar untuk semua),
  yang lingkupnya kosong dilewati tanpa pesan, baris tanpa `pic` cuma sampai ke yang berlingkup
  penuh, dan penanda harian ditulis per baris yang BENAR-BENAR terkirim. Penerima non-tim menerima
  semuanya kecuali kotak "Lingkup Peringatan ROI" di formnya diisi.
- **Tiga topik hari ini** (`reminders`, `roiAlerts`, `syncIssues`), ditulis DUA KALI dan harus sama
  persis: [`src/lib/notifications.js`](src/lib/notifications.js) (menghitung kolom "Penerima" di
  layar) dan [`functions/notifications-core.js`](functions/notifications-core.js) (yang benar-benar
  mengirim) — persis seperti `campaignCommandEntry` dan `dueReminders`. Dijaga tes yang membaca
  berkas seberangnya. Kunci topik itulah yang tersimpan di `users/{id}/notificationTopics`: salah
  ketik berarti saklar yang ditekan orang tidak pernah dibaca pengirim mana pun.
- **`syncIssues` membaca `dashboard/syncIssues` APA ADANYA** — daftar yang sama dengan ikon
  peringatan di topbar, bukan daftar kedua. Ikon hanya menyala untuk yang sedang membuka dashboard;
  laporan GAM yang gagal pukul 02:00 berarti earning belasan subdomain kosong sampai ada yang
  kebetulan membuka tab. Dua daftar untuk satu keadaan akan berbeda isinya suatu hari, dan yang di
  layar berbeda dari yang di chat adalah cara tercepat membuat orang tidak mempercayai keduanya.
- **Saklar orang mengalahkan siaran per role, DUA ARAH.** `true` ikut walau role-nya tidak
  disiarkan; `false` tidak ikut walau disiarkan; belum disentuh ikut kalau role-nya disiarkan. Itu
  yang membuat "kirim ke semua keuangan" bisa dipakai tanpa menyandera siapa pun.
- **Satu saklar, dua tangan.** Yang ditekan admin dan yang ditekan orangnya sendiri adalah node yang
  SAMA (`users/{id}/notificationTopics`). Dua kolom terpisah ("ditugaskan" vs "diminta") menuntut
  aturan siapa-menang, dan tiap aturan begitu punya sisi di mana orang menekan saklar lalu tidak
  terjadi apa-apa. Siapa yang menekan terakhir tercatat di `activityLogs`.
- **Halamannya terbuka untuk SEMUA role, dan itu intinya** — saklar "saya mau menerima apa" tidak
  berarti apa-apa kalau yang bisa membukanya cuma admin. `canManageNotifications` (admin) menjaga
  bagian yang menyangkut orang lain saja; yang menegakkan sisi pribadinya adalah aturan
  `users/$uid/notificationTopics` dan `users/$uid/telegramChatId` di `database.rules.json`,
  dicocokkan lewat EMAIL — alasan yang sama persis dengan `campaignCommands` (`/users` dikunci
  push key).
- **Saklar induk tiap topik bawaannya NYALA**, kebalikan dari `DEFAULT_ALERTS.enabled`. Yang
  menentukan ada tidaknya kiriman adalah daftar penerima, dan daftar kosong tidak mengirim ke mana
  pun; bawaan mati cuma akan menghentikan pengingat yang selama ini jalan, diam-diam, pada hari
  fitur ini di-deploy.
- **Yang tanpa chat id dan yang sudah diarsipkan dilewati diam-diam.** Belum mengisi chat id bukan
  kegagalan (halamannya sudah menyebutkannya di kolomnya sendiri); dan notifikasi yang tetap
  mengalir ke mantan anggota tim adalah bocoran yang tidak terlihat di layar mana pun.
- **Tujuan boleh orang di luar tim.** Tab Grup menerima id grup/channel (diawali minus) MAUPUN chat
  pribadi (tidak) — pemilik, akuntan, teknisi yang dipanggil saat sync tumbang tidak perlu dibuatkan
  akun dashboard berikut role-nya hanya supaya bisa menerima satu pesan. Kolom Jenis membacanya dari
  tanda id-nya sendiri, bukan dari kolom yang harus diisi orang.
- **`settings/telegram/chatIds` tidak dibaca satu baris kode pun lagi**, dan tidak ada pemindahan
  otomatis: id lamanya didaftarkan ulang lewat Tambah Penerima. Node lamanya dibiarkan berdiri apa
  adanya — yang dihapus tidak bisa dibaca kembali oleh siapa pun yang perlu tahu chat mana saja yang
  dulu menerima.
- **Peringatan ROI punya SATU saklar: kolom Aktif di tab Topik.** Tab Peringatan ROI cuma memuat
  angkanya, dan `runAlerts` MENIMPA `settings/alerts.enabled` yang tersimpan dengan nilai topik itu —
  baris lama membawa `false` dari zaman form yang punya kotak "Nyalakan peringatan", dan membacanya
  berarti saklar yang sudah tidak ada di layar mana pun tetap menahan seluruh fitur.
- **Deploy-nya menyebut `npm run deploy:rules`** berikut `scheduledSync` dan `scheduledReminders`.
  Tanpa aturan barunya, saklar yang ditekan orang non-admin ditolak database dan halamannya tampak
  seperti tombol yang tidak bekerja.

Selengkapnya: [docs/notifications.md](docs/notifications.md).

## Peringatan ROI: yang tidak diketahui tidak pernah dinilai

Sync sudah jalan tiap jam dan sudah tahu ROI tiap subdomain; yang belum ada adalah arah keluarnya.
`settings/alerts` menyimpan ambangnya (tab **Peringatan ROI** di `/notifications` — pindah dari
Settings, karena "berapa ambangnya" dan "siapa yang dikabari" adalah satu pertanyaan), dan tahap
"Peringatan ROI"
di `scheduledSync` menilai baris hari berjalan lalu mengirim yang melewatinya ke penerima topik
"Peringatan ROI" di Notification Center — bukan lagi ke satu daftar chat untuk semua notifikasi.
Aturannya di [`functions/alerts-core.js`](functions/alerts-core.js), I/O-nya di `runAlerts` (scheduled-sync.js).

- **Baris yang earning atau spend-nya TIDAK DIKETAHUI dilewati — bukan dinilai buruk.** Ini seluruh
  alasan fitur ini bisa dipercaya. Laporan GAM yang gagal datang membuat sebuah baris tampak persis
  seperti subdomain yang beriklan tanpa hasil, dan peringatan yang meleburnya akan berbunyi tiap
  kali GAM lambat. Notifikasi yang sering salah dibisukan orang, dan yang ikut terbisukan adalah
  pengingat jatuh tempo dari bot yang sama. `gamStale` (angka dari sync sebelumnya di hari yang
  sama) TETAP dinilai: angkanya nyata, cuma belum diperbarui.
- **ROI tidak dihitung ulang di sini.** `roiReportUpdate` sudah menuliskannya ke baris, dan hanya
  saat earning benar-benar diketahui. Satu rumus ROI, dan modul ini membacanya — bukan menyalinnya.
- **`minSpend` bukan hiasan.** Tanpa lantai belanja, tiap campaign yang baru menyala (spend
  Rp 5.000, earning belum masuk) memenuhi syarat "ROI di bawah −50%".
- **Sumbernya `roiReports` hari berjalan, bukan `roiSnapshots`.** Baris harian ditimpa tiap sync,
  jadi ia ADALAH keadaan sekarang — satu baris per subdomain. Snapshot memuat beberapa baris per
  subdomain per hari, dan menilai semuanya berarti satu subdomain berbunyi berkali-kali untuk satu
  keadaan. Harinya dibaca dari `partial` di baris, bukan dari jam server.
- **Sekali sehari per aturan per subdomain**, lewat `dashboard/alertNotices` — bentuk dan alasan
  yang sama persis dengan `dashboard/reminderNotices`, termasuk penyapuan penanda milik subdomain
  yang sudah pulih. Penanda ditulis hanya kalau ada chat yang benar-benar menerima.
- **Bawaannya MATI (`enabled: false`), dan itu bagian dari kontraknya.** Fitur yang mulai mengirim
  begitu di-deploy, dengan ambang yang belum pernah dilihat siapa pun, berbunyi puluhan kali di jam
  pertamanya.
- **Ambang bawaannya ditulis dua kali** — `DEFAULT_ALERTS` di `functions/alerts-core.js` dan
  [`src/lib/alerts.js`](src/lib/alerts.js) — persis seperti `campaignCommandEntry`. Yang TIDAK
  disalin adalah aturan penilaiannya: tidak ada satu pun tempat di layar yang menampilkan "baris ini
  sedang melewati ambang", jadi salinan kedua adalah salinan yang tidak akan pernah ikut diperbarui.
- **Kosong bukan nol.** `Number("")` adalah `0` dan `0` itu finite, jadi kotak ambang yang
  dikosongkan orang lolos sebagai ambang nol — dan ambang nol membuat seluruh armada memenuhi
  syarat sekaligus. `alertSettings()` memeriksa kosong SEBELUM `Number()`.
- **Tahapnya sesudah tahap ROI**, karena yang dinilai adalah baris yang baru saja ditulis tahap itu.
  Sebagai `stage()` biasa: Telegram yang tumbang tidak menjatuhkan run yang datanya sudah tersimpan,
  dan hasilnya ikut tercatat di log run halaman Settings.
- **Deploy-nya menyebut `scheduledSync`**, dan fungsi itu sekarang butuh secret `TELEGRAM_BOT_TOKEN`
  — bot yang sama dengan `scheduledReminders`, bukan bot kedua.

## Activity Logs: dicatat di perangkat, IP dicap server

`/activity-logs` (superadmin) memuat jejak tiap orang — login, halaman yang dibuka, tombol yang
ditekan, operasi data — berikut IP, kota, dan perangkatnya. Browser mencatat ke `localStorage` lalu
mengirim tiap **5 menit** (juga saat jaringan kembali, saat tab ditinggalkan, dan saat logout).

- **IP, kota, dan User-Agent dicap SERVER dan tidak pernah dibaca dari body.** Sebuah halaman tidak
  tahu alamat publiknya sendiri; yang mengaku tahu sedang mengutip pihak ketiga atau mengarangnya,
  dan kota diturunkan dari IP itu. Karena itu jalurnya `POST /activity-logs` di server kontrol dan
  bukan penulisan langsung — log yang tiap barisnya bisa dikarang oleh orang yang dicatatnya
  bukan log audit. Konsekuensinya diterima: **tidak ada antrean cadangan**; yang
  menggantikannya adalah penyangga di localStorage, jadi server yang mati menunda, tidak menghapus.
- **Jejak tinggal di SQLite di VPS, bukan lagi RTDB** (`server/activity-db.js`, `bun:sqlite`). Node
  `activityLogs` adalah yang paling cepat tumbuh di seluruh database — tiap klik tiap orang — dan
  menyeret database yang dibaca halaman lain. Karena browser tak bisa lagi membaca RTDB, halaman
  memintanya lewat `GET /activity-logs?start=&end=` (gerbang `requireSuperAdmin`), bukan berlangganan;
  realtime memang hilang, tapi ini tampilan historis. Baris lama disalin sekali oleh
  `migrate-activity-logs-to-sqlite.mjs` (butuh akun superadmin — `.read` RTDB bukan admin).
- **`id` dibuat browser dan jadi `PRIMARY KEY` baris** (`INSERT OR REPLACE`). Batch yang sampai tapi
  jawabannya hilang di jaringan, lalu dikirim ulang, menimpa baris yang sama — bukan menggandakannya.
  Yang sudah terkirim dibuang dari penyangga lewat ID-nya, bukan lewat `slice(jumlah)`: sela antara
  kiriman dan jawabannya bisa diisi klik baru.
- **Login yang GAGAL tidak punya token, dan justru itu yang paling perlu tercatat.** Barisnya
  menunggu di perangkat itu dan menumpang sesi berikutnya yang berhasil; server mencap
  `reportedByUid` di samping `actorUid`, supaya baris titipan tidak bisa menyamar sebagai baris yang
  dikirim pemiliknya sendiri.
- **Empat seam, dan tidak satu pun bisa dibuang.** Klik lewat SATU pendengar di `document` fase
  **capture** (di fase bubble, yang hilang justru tombol di dalam dialog konfirmasi, yang
  memanggil `stopPropagation`); operasi data lewat `firebaseRepository` — bukan `useFirebaseStore`,
  yang menangkap error-nya sendiri sehingga gagal dan berhasil bentuknya sama dari luar; panggilan
  server kontrol lewat pengamat di `controlApi` — gate/ungate, saklar campaign, dan seluruh
  `/plugin` tidak menyentuh RTDB dari browser sama sekali; auth di `useFirebaseAuth`.
- **Rahasia diredaksi SEBELUM menyentuh penyangga** (`sanitizeDetail`): yang tidak pernah ditulis ke
  localStorage juga tidak bisa terbaca dari sana. Nama field-nya tetap tampil — "password diubah"
  memang harus terbaca; yang tidak boleh cuma isinya. Yang dicatat dari sebuah update adalah NAMA
  field yang disentuh, bukan nilainya: nilainya ada di barisnya sendiri, dan menyalinnya ke sini
  berarti node jejak menyimpan salinan kedua dari data yang izin bacanya diatur di tempat lain.
- **Kunjungan halaman dicatat lewat PATH saja, tanpa query.** Filter dan pencarian tinggal di query
  alamat, jadi query yang ikut tercatat berarti satu baris jejak per HURUF yang diketik.
- **Baca superadmin, kirim siapa saja — asimetri yang disengaja, kini ditegakkan di server.** `GET`
  (baca halaman) lewat `requireSuperAdmin`, `POST` (kirim jejak) lewat `requireUser`: setiap akun yang
  login boleh mengirim, karena log yang cuma menerima kiriman superadmin tidak mencatat orang yang
  aktivitasnya ingin dilihat. Ini persis asimetri `.read` superadmin / `.write` admin yang dulu di
  `database.rules.json`, sekarang di `server/activity.js`. Sisi baca superadmin karena isinya ke mana
  dan kapan tiap orang bergerak — sepola dengan `otpSecrets`.
- **Halamannya meminta per rentang tanggal, bukan seluruh tabel.** Node ini satu-satunya yang tumbuh
  mengikuti jumlah klik; `useActivityLogs` memanggil `GET /activity-logs` dengan rentang terpilih dan
  server menjawab `ORDER BY at DESC LIMIT 3000`. Yang terpotong DISEBUTKAN di layar — tabel yang
  diam-diam kehilangan baris tertua terbaca sebagai "tidak ada aktivitas pagi itu". Margin ±sehari
  untuk selisih UTC↔WIB dihitung browser dan dikirim sebagai `start`/`end`.
- **Masa simpan 90 hari** (`ACTIVITY_LOG_DAYS`), dibuang cron `ACTIVITY_CRON` (03:00) lewat satu
  `DELETE` melalui indeks `at`. Satu kuartal karena itu satuan yang benar-benar dipakai saat
  menelusuri ke belakang, dan yang jatuh di luar jendela tidak hilang sebagian melainkan hilang
  seluruhnya — tanpa satu pun tanda yang membedakannya dari "memang tidak ada aktivitas". Yang
  membayar perpanjangannya adalah DISK VPS, bukan Firebase: jejak ini tinggal di SQLite lokal sejak
  pindah dari RTDB, jadi tiga kali masa simpan berarti tiga kali ukuran file dan NOL tambahan biaya
  download RTDB. Batas 3.000 baris per bacaan tidak ikut berubah — yang bertambah adalah rentang
  yang BISA diminta, bukan jumlah baris satu bacaan.
- **`at` (jam perangkat) dan `receivedAt` (jam server) berdampingan.** Yang menjelaskan urutan aneh
  di tabel justru selisih keduanya; menimpa `at` menghapus satu-satunya petunjuk itu.

### Estimasi biaya Firebase: yang dihitung MUAT APLIKASI, bukan kunjungan halaman

Panel kedua di `/activity-logs`, di bawah tabel jejak — [`src/lib/firebaseCost.js`](src/lib/firebaseCost.js).
Sampai ia ada, satu-satunya jawaban atas "berapa yang kita bayar ke Firebase, dan karena siapa"
adalah tagihan Google yang datang sebulan kemudian sebagai SATU angka, tanpa menyebut orang maupun
halaman.

```
muat aplikasi  = jejak yang jaraknya > 30 menit dari sebelumnya, ATAU baris `auth`
unduhan/muat   = Σ ukuran node yang dilanggan ROLE itu (+ node berat, kalau route-nya membukanya)
biaya          = unduhan ÷ 1 GiB × $1
```

- **BERPINDAH HALAMAN TIDAK MENGUNDUH APA PUN.** Langganan store dipasang sekali saat aplikasi mount
  dan hidup sampai sesinya selesai; sepuluh halaman berturut-turut dibaca dari cache yang sama. Yang
  membayar ulang cuma login, refresh, dan tab baru. Dikalikan per kunjungan halaman, angkanya
  berkali lipat dari tagihan yang benar-benar datang — dan yang membacanya mengejar penghematan yang
  tidak ada.
- **Batas sesi DITAKSIR dari jeda 30 menit**, karena baris jejak tidak membawa penanda sesi: ia lahir
  dari klik dan kunjungan halaman, bukan dari boot aplikasi. Baris `auth` selalu membuka sesi baru
  berapa pun jedanya.
- **Daftar node per role DIIMPOR dari `sessionNodes`**
  ([`src/lib/storeSubscriptions.js`](src/lib/storeSubscriptions.js)) — modul yang sama yang dipakai
  `useFirebaseStore` merakit langganannya, dan itu sebabnya daftarnya pindah ke berkas sendiri:
  pembacanya jadi dua. Disalin, ia akan tetap menyebut lima node gating pada hari `/vi-control`
  dilepas, dan estimasinya meleset ke arah yang MENENANGKAN tanpa satu pun tanda.
- **Dua node terberat menyusul menurut ROUTE, bukan menurut role.** `roiSnapshots` dan `userReports`
  ikut hanya kalau sesi itu benar-benar membuka halaman yang membacanya, dibaca lewat `resolveRoute`
  + `needsRoiSnapshots`/`needsUserReports` — bukan dengan mencocokkan potongan alamat sendiri, yang
  akan jadi pengurai kedua yang berselisih pada hari sebuah tab ditambahkan. Diikutkan ke tiap sesi,
  estimasinya naik hampir 5 MB per sesi untuk yang justru sudah dihemat `heavyData.js`.
- **Ukuran node DIUKUR runtime dari store** ([`src/hooks/useNodeSizes.js`](src/hooks/useNodeSizes.js)),
  bukan diketik dan bukan diukur di server. Yang diketik benar pada hari ia diketik dan basi
  diam-diam sesudahnya; yang diukur di server berarti alat pengukur biaya mengunduh node terberat
  sekali sehari dan MENAMBAH biaya yang sedang diukurnya. Yang diukur di sini adalah data yang sudah
  terlanjur diunduh sesi itu — gratis. Sekali saat panel dibuka, tombol "Ukur ulang node" untuk yang
  memintanya: `JSON.stringify` atas tiga puluh node di tiap pembaruan langganan membekukan halaman
  tiap kali sync menulis satu baris.
- **Yang belum terukur TIDAK dinilai nol.** Nol di sana adalah klaim bahwa sebuah node tidak berisi
  apa-apa, dan yang paling mungkin belum terukur justru dua node terberat — keduanya baru dilanggan
  kalau sesi yang mengukur kebetulan membuka halaman yang membacanya. Ia tidak ikut dijumlah dan
  namanya DISEBUTKAN berikut cara mengukurnya. Yang sudah terukur diingat per perangkat di
  `localStorage` berikut tanggal pengukurannya.
- **ANGKANYA LANTAI, dan mengatakannya adalah syarat ia boleh berdiri sama sekali.** Tiga yang tidak
  terhitung, disebut TERPISAH karena diperbaiki di tempat yang berbeda: delta yang diterima tab yang
  dibiarkan terbuka tiap kali sync menulis (besarnya tidak ada di jejak mana pun), sesi yang ditutup
  sebelum jejaknya sempat berangkat, dan baris yang terpotong batas 3.000 satu bacaan.
- **Dolar, bukan rupiah — satu-satunya angka uang di dashboard ini yang begitu.** Yang ditagihkan
  Google memang USD, dan tidak ada satu pun sumber kurs di sisi UI (`convertRowsToIdr` tinggal di
  sisi sync). Kurs yang dikarang di browser menghasilkan rupiah yang tidak akan pernah cocok dengan
  invoice yang jadi pembandingnya. Empat desimal, karena "$0" untuk unduhan 200 MB tidak mengatakan
  apa-apa.
- **SENGAJA tidak ikut penyaring di kepala panel jejak**, sepola kartu Cash Flow — dan di sini
  alasannya lebih keras: batas sesi ditaksir dari jeda antar-baris, jadi penyaring kategori yang
  membuang kunjungan halaman memotong satu sesi jadi tiga dan MELIPATGANDAKAN estimasinya. Yang
  tetap berlaku cuma rentang tanggalnya.
- **Rata-rata harian dibagi hari yang ADA jejaknya**, bukan panjang rentang — sepola `dayCount` di
  Proyeksi Budget.
- Berdiri DI BAWAH tabel jejak: yang dicari orang saat membuka halaman ini adalah jejaknya, dan panel
  turunan yang mendorong tabelnya keluar layar pertama menukar pertanyaan yang sering dengan
  pertanyaan yang sesekali.

Selengkapnya: [docs/activity-logs.md](docs/activity-logs.md).

## Menu: satu baris sidebar, sisanya tab di halamannya

[`src/config/navigation.js`](src/config/navigation.js) memuat SEMUA halaman; yang membedakan cuma
`parent`. Item tanpa `parent` jadi baris sidebar, item dengan `parent` jadi tab di kepala halaman
induknya ([`PageTabs`](src/components/ui/PageTabs.jsx), dirender sekali di `DashboardShell`).

- **Tab di sini bukan panel yang berganti isi, melainkan route sungguhan.** `/sub-domains` tetap
  `/sub-domains`, lengkap dengan `/new`, `/{id}/edit`, dan filternya di query. Alasan yang sama
  dengan filter yang tinggal di alamat: keadaan yang tidak ada di alamat tidak bisa dikembalikan,
  dan tautan yang sudah beredar tidak boleh mati karena menunya dirapikan.
- **Yang boleh jadi tab hanya yang satu bacaan dengan induknya**, dan izinnya tidak boleh lebih
  longgar dari induknya — induk yang tersembunyi berarti tab-nya tidak punya jalan sama sekali
  (dijaga test di `navigation.test.mjs`). Hari ini: Cash Flow, Laba per Domain, Pencairan, Akun Ditutup, Invalid Traffic,
  Cost Ad Exchange, Potongan Company, Tarif Bonus, Expenses & Whitelist Top-Up → **Accounting** (`/profit-loss`), Sub
  Domains → Domains, Google API → Settings, Pekerjaan → Campaign (`/campaigns/pekerjaan`), AdX, AdSense & Cek
  Situs → Plugin (`/plugin/adx`, `/plugin/adsense`, `/plugin/cek`).
  **Tab boleh lebih KETAT daripada induknya**, dan Whitelist Top-Up pernah jadi contohnya: ia admin
  + Keuangan di bawah Ad Accounts yang terbuka untuk semua yang login, jadi advertiser membuka
  halaman yang sama tanpa satu tab pun (satu tab bukan pilihan, ia cuma judul kedua). Sekarang
  kesembilan tab Accounting berizin sama persis dengan induknya — yang boleh membuka Laba Rugi melihat
  semuanya, yang tidak boleh tidak melihat satu pun — dan yang dilarang tetap arah sebaliknya.
  Baris sidebar **Ad Accounts** tidak lagi berbunyi "Ad Accounts & WL": label induk menyebut isi
  tab-nya, dan halaman yang tidak lagi memuat WL tidak boleh menyebutnya.
- **Overview dipecah jadi tab-nya sendiri, dan itu satu-satunya tab yang bukan halaman lain.**
  `/dashboard` (Ringkasan: kartu + saldo advertiser), `/dashboard/grafik` (tiga grafik total + dua
  grafik per subdomain), `/dashboard/roi` (Laporan ROI Realtime). Enam panel dengan pemilih periode
  masing-masing dalam satu gulungan berarti yang dibuka orang tiap pagi ada di paling bawah. Tetap
  route sungguhan: filter tiap tab tinggal di alamat tab-nya sendiri, dan karena perpindahan halaman
  tidak membawa query, periode grafik (`?periode=`) dan periode tabel ROI (`?roi=`) memang tidak
  pernah bertemu.
- **Tab Grafik punya SATU filter untuk keempat grafiknya** (periode, advertiser, domain, subdomain).
  Dua grafik total membaca baris harian, dua grafik per subdomain membaca baris per sync — sumber
  yang berbeda, periode yang sama. Empat pemilih periode berarti empat angka yang berdampingan di
  satu layar tanpa bisa diadu, dan yang berdampingan selalu dibaca sebagai perbandingan. Domain
  induk tidak ada di baris ROI: `subDomainOwnerIndex` (dari `subDomains.parentDomain`, dengan
  pencocokan akhiran untuk yang belum terdaftar, sama seperti Laba Rugi) yang menyediakannya.
- **Grafik membaca baris ROI saja, TANPA saklar Lingkup** (dibuang 24 Sep 2026). Saklar itu
  memilih antara total usaha (`weeklyFinancials`) dan yang terpetakan ke subdomain (`roiReports`);
  dua angka yang sama-sama benar untuk bulan yang sama terbukti cuma membingungkan, dan yang dipakai
  tim untuk mengadu adalah sheet — yang cara hitungnya sama dengan baris ROI (Agustus 2026: sheet
  Rp 417,23 jt, baris ROI Rp 417,87 jt, total usaha Rp 418,18 jt). Jadi Grafik, Kalender, dan tabel
  ROI menyebut angka yang sama, dan filter kepemilikan bekerja di keempat grafik tanpa pengecualian.
  - **Total usaha tinggal di Laba Rugi**, dan selisihnya terhadap baris ROI disebut lencana "di luar
    cakupan" di kepala Kalender (`monthCoverage` di [`src/lib/chartScope.js`](src/lib/chartScope.js),
    ambang 1%). Sebabnya selalu subdomain yang belum terdaftar, campaign yang belum dipetakan, atau
    nama situs GAM/AdSense yang tidak cocok dengan `subDomains.name` — perbaikannya di /sub-domains.
  - `?lingkup=` dari tautan lama diabaikan begitu saja.
- **Notifikasi barisnya sendiri di sidebar, DAN punya empat tabnya sendiri.** Barisnya sendiri
  dengan alasan yang sama seperti Reminder, plus satu yang khusus: ia satu-satunya halaman di grup
  Admin yang dibuka SEMUA role — tiap orang mengatur saklarnya sendiri di sana — jadi
  menyembunyikannya di balik Settings berarti menyembunyikannya justru dari mayoritas yang
  membutuhkannya. Yang berpindah justru sebaliknya: tab **Peringatan** ikut ke sini dari Settings,
  karena ambang dan penerimanya adalah satu pertanyaan yang selama ini dijawab di dua halaman.
- **Reminder sempat jadi tab dan dikembalikan jadi barisnya sendiri.** Halaman yang dicari orang
  justru saat ia teringat ada tagihan; yang dicari dengan cara begitu harus terbaca dari sidebar,
  bukan ditebak ada di balik baris lain. Menghemat satu baris tidak sepadan dengan itu.
- **Panel tidak mengulang judul halamannya.** "Daftar OTP" tepat di bawah PageHeader "OTP" cuma
  mendorong tabelnya turun; yang boleh berdiri di `panel-header` adalah judul yang MEMBEDAKAN satu
  panel dari panel lain di halaman yang sama, atau keterangan yang berubah (hitungan baris, periode
  yang dipilih) — bukan kalimat kedua untuk hal yang sama.
- **GAM dan AdSense tidak digabung**, walau paling terlihat mirip. Koleksi, halaman, dan cabang
  `dashboard/syncIssues/{gamAccounts,adsenseAccounts}` bernama sama supaya ikon peringatan sync
  menunjuk halaman yang benar; satu halaman bertab memutus lapis tengah itu. Yang membedakan
  keduanya di layar adalah ikonnya.
- **Satu ikon per baris, tidak boleh kembar.** Di rail 48px label disembunyikan dan ikon adalah
  satu-satunya pembeda; ikon `Database` adalah fallback, bukan pilihan.
- **`nav` menggulir sendiri (`overflow-y: auto`).** `.sidebar` `overflow: hidden`, jadi daftar yang
  lebih tinggi dari layar hilang tanpa cara mencapainya — bukan sesak, benar-benar tidak bisa
  diklik. Jumlah menu akan bertambah lagi, tinggi layar orang tidak.

## Akun tamu (`guest`): tiga laporan, dua pertanyaan izin

Role `guest` cuma boleh MEMBUKA Laba Rugi, Cash Flow, dan Laba per Domain (`GUEST_PAGES` di
[`src/config/access.js`](src/config/access.js)) — tanpa Overview, tanpa tab input Accounting, dan
tanpa satu pun isi sisi kiri topbar (status sync, isu sync, pengingat). Semua halaman lain
dialihkan (`replace`) ke `/profit-loss`.

- **"Boleh dibuka" dan "boleh dilanggan" dua fungsi**: `canOpenPage` (sidebar, tab, gerbang di App)
  dan `canReadResource` (langganan store). Untuk tamu keduanya berbeda: ketiga halaman itu
  menjumlahkan `expenses`, `companyPercents`, `invalidTraffic`, `payouts`, … — dipersempit ke tiga
  kunci halaman, laporannya berbunyi laba tanpa potongan. Untuk role lain keduanya sama persis.
- **`.read` tujuh node Accounting menyebut `guest`, `.write`-nya tidak.** Dijaga
  `functions/roles.test.mjs`, yang membaca daftar nodenya dari aturan itu sendiri.
- **Konsekuensinya diketahui**: izin baca RTDB menurun per node, jadi tamu yang memakai SDK langsung
  bisa membaca `payouts` (nomor rekening) dan `expenses`, plus tiap node `auth != null`. Yang dijaga
  role ini MENU dan HALAMANNYA, bukan isi database-nya.
- **Role tambahan menambah hak** (`isGuestOnly`): "guest,keuangan" adalah keuangan.
- **Tamu tidak disiarkan notifikasi** (`BROADCAST_ROLES`), cerminan `.validate` pada
  `settings/notifications/$topic/roles`.
- **Akunnya dibuat `npm run role:create -- <email> <password> guest`**, bukan lewat Team — yang
  kedua ikut menulis baris `users`, dan tamu lalu berdiri di daftar Team dan penerima notifikasi.
  Urutannya WAJIB: `deploy:rules` + hosting dulu. Frontend lama tidak mengenal `guest` dan
  menormalkannya jadi `user` — seluruh dashboard level user terbuka — dan aturan lama menolak
  role-nya (`role:create` lalu menghapus akunnya lagi).

## Ad account yang dimatikan: dilewati, tapi belanjanya TIDAK hilang

Akun ber-`syncDisabled` (izin Meta dicabut, disuspend) atau terarsip dilewati tiap sync — dan itu
benar. Yang dulu salah adalah akibatnya pada rentang yang DITULIS ULANG: sync ROI menimpa beberapa
hari terakhir, `sync-financials` tiga puluh hari, `migrate:roi-spend` sebulan lebih, dan tiap hari
yang ditulis sesudah akunnya mati kehilangan belanja akun itu. Baris ROI-nya berbunyi
`metaMissing: "unmapped"` untuk campaign yang ada dan uang yang sudah keluar, tanpa satu pun isu
sync. Audit 17 Sep 2026: LINCAH 1240 (16–25 Agu) dan TBZ 1235/1268/0881 (5–12 Sep) kehilangan
Rp 7,28 juta dari 39 baris ROI, dan `weeklyFinancials` kehilangan belanja kelima akun itu di hampir
tiap hari 9 Agu–12 Sep.

- **Belanjanya dibaca dari `userReports/{id}.campaignHistory`**, yang ditulis saat akunnya masih
  terbaca dari `fetchCampaignSpend` per hari — panggilan yang SAMA dengan spend baris ROI, bukan
  `dailySpend` (rekaman "spend hari ini" bertanggal jam run). Aturannya `unreadableActIds` +
  `unreadableSpendRows` di [`functions/sync-core.js`](functions/sync-core.js), I/O-nya
  [`functions/unreadable-spend.mjs`](functions/unreadable-spend.mjs), dipakai sync ROI,
  `sync-financials`, dan `migrate:roi-spend`. Hari sesudah akunnya berhenti terbaca tidak punya
  riwayat, dan memang tidak ada angka yang bisa diklaim untuknya.
- **Dibuktikan sampai rupiah**: `weeklyFinancials` + riwayat akun nonaktif sama persis dengan
  belanja terpetakan `roiReports` untuk 9–15 dan 18 Agu.
- **`metaComplete` TIDAK dijatuhkan karena akun yang dimatikan** — itu bukan kegagalan run ini.
  Yang menjatuhkannya cuma riwayat yang GAGAL dibaca.
- **Bacaannya dibatasi rentang** (`readFrom` per user, kunci riwayat berawalan tanggal), dan dimuat
  SEKALI per run untuk rentang terlebar (`syncSubdomains` mengopernya ke `syncFinancials`).
- Yang lama dipulihkan dua script idempotent ber-`--dry`: `npm run migrate:spend-from-history`
  (baris ROI; penjaganya total riwayat SELURUH akun, karena campaign yang diganti namanya tidak
  dikenali lewat `campaigns`) dan `npm run migrate:financials-spend -- --since= --until=` (hari
  `weeklyFinancials` di luar jendela sync; sisi belanja saja, titik spreadsheet dilewati).
- **Akun GAM/AdSense yang dimatikan punya masalah yang sama di sisi EARNING**, dan jawabannya
  sepola: `sync-financials` menambahkan earning baris ROI subdomain milik domain yang SELURUH akun
  earning-nya dimatikan (`unreadableEarningDomains` + `unreadableEarningByDate` di sync-core.js,
  I/O-nya `loadUnreadableEarning`). Sehari sesudah petcins.com dimatikan (23 Sep 2026), 25–31 Agu
  kehilangan Rp 16,2 juta dan Pendapatan Laba Rugi Agustus jatuh ke Rp 401 juta.
  - **Per DOMAIN, karena baris ROI tidak mencatat akun asalnya.** Domain dihitung mati hanya kalau
    akun GAM bernama domain itu DAN akun AdSense ber-publisher sama semuanya dimatikan — satu yang
    masih hidup sudah melaporkan domain itu, dan menambahkannya berarti earning terhitung dua kali.
  - Akun AdSense berdiri sendiri (tanpa kembaran GAM) belum ikut: domainnya cuma diketahui lewat
    API-nya, yang justru tidak ditanya lagi.
  - Hari di luar jendela 30 hari tidak ditulis ulang, jadi tidak perlu dipulihkan; yang di dalamnya
    pulih sendiri pada run berikutnya.
- **Akun yang GAGAL dibaca sesaat tidak boleh menimpa jendela itu juga** (`financialWrite`): satu
  akun earning yang gagal berarti `grossRevenue` tidak ditulis run ini, satu ad account yang gagal
  berarti sisi belanjanya tidak ditulis — angka tersimpan dibiarkan berdiri. 24 Sep 2026 laporan GAM
  stylefemale.com menjawab HTML sekali, dan Pendapatan Agustus jatuh dari Rp 402 juta ke Rp 372 juta.
  Jumlah tanpa satu akun bukan angka yang benar melainkan angka yang kurang.

## Kegagalan sync harus terlihat

Satu laporan API yang gagal tidak menjatuhkan run, tapi juga tidak boleh diam. Tiap modul sync
menulis daftar isunya ke `dashboard/syncIssues/{cabang}` (ditimpa utuh tiap run, termasuk saat
kosong), dan ikon peringatan di topbar membacanya.

Sejak Notification Center, daftar yang sama itu juga PUNYA ARAH KELUAR: topik "Kegagalan sync"
mengirimkannya ke Telegram, sekali sehari per (cabang + target). Yang dikirim adalah node yang sama
persis — bukan daftar kedua yang dikumpulkan sendiri.

- **Yang golongannya SISI PENYEDIA tidak berangkat ke Telegram** (`notifiableAlerts` di
  [`functions/notifications-core.js`](functions/notifications-core.js)). Retry sudah mengurusnya —
  1→5 menit, maks 5× — dan sebagian besar 5xx/timeout/429 pulih di percobaan kedua, beberapa menit
  sebelum penerimanya sempat membuka ponsel. Yang tersisa dari notifikasinya cuma pesan merah untuk
  sesuatu yang tidak boleh dikerjakan siapa pun, disusul pesan hijau yang mencabutnya; notifikasi
  yang terbukti tidak menuntut apa-apa berhenti dibaca, dan yang ikut berhenti dibaca adalah baris
  **sisi kita** di sebelahnya. **Belum bisa dipastikan** TETAP dikirim, alasan yang sama dengan
  keberadaan golongan ketiga itu sendiri.
  - **Yang disaring cuma JALAN KELUARNYA.** `dashboard/syncIssues` tetap ditulis utuh, ikon
    peringatan di topbar tetap menyala, dan panelnya tetap memuat barisnya — layar memang tempat
    yang benar untuk keadaan yang tidak menuntut tindakan. Karena itu aturan ini TIDAK dicerminkan
    ke `src/lib/syncIssueCause.js`: yang harus sama di kedua sisi adalah PENGGOLONGANNYA, sedangkan
    "golongan mana yang dikirimkan" milik pengirim.
  - **`recoveredNotices` tetap dibacakan daftar PENUH.** Isu yang tadi pagi gagal dengan 401 lalu
    sore ini gagal dengan 503 masih gagal; dibacakan hasil saringan, ia berbunyi "pulih" hanya
    karena golongannya berpindah ke yang tidak dikirimkan.
  - **Jumlah yang disaring DISEBUTKAN di ringkasan run** (`syncIssueSummary`). Tanpa itu, run yang
    menemukan enam hosting tumbang menulis "tidak ada kegagalan baru" ke log Settings — kalimat
    yang persis sama dengan run yang memang tidak menemukan apa-apa.
  - Konsekuensinya diketahui dan diterima: gangguan penyedia yang bertahan SEHARIAN tidak
    mengabarkan dirinya ke chat mana pun, dan yang mengetahuinya cuma yang membuka dashboard.

- **Pesannya dikelompokkan per ASAL MASALAH, bukan per cabang sync** (`issueCause` di
  [`functions/notifications-core.js`](functions/notifications-core.js)). Yang membaca chat itu bukan
  yang menulis kodenya, dan ia memutuskan satu hal: perlu dikerjakan sekarang atau tidak. "GAM POST
  /v1/networks/2094/reports:run -> 401: Invalid Credentials" benar dan sekaligus tidak menjawab itu.
  Tiga golongan — **sisi kita** (izin/setelan; tidak akan pulih sendiri), **sisi penyedia** (5xx,
  429, timeout, balasan non-JSON; dicoba ulang otomatis), dan **belum bisa dipastikan**. Yang ketiga
  bukan basa-basi: menebak "ini sisi mereka" untuk pesan yang tidak dikenali membuat orang MENUNGGU
  sesuatu yang tidak akan pernah pulih sendiri — sepola dengan `earningKnown`. Status HTTP dibaca
  dari bentuk yang benar-benar ditulis pelempar errornya (`-> 503:`, `(HTTP 502)`), bukan dari angka
  tiga digit di mana pun dalam teks: `act_5031` juga tiga digit.
- **Panel isu sync di topbar memakai penggolongan yang SAMA**, dan karena itu aturannya dicerminkan
  ke [`src/lib/syncIssueCause.js`](src/lib/syncIssueCause.js) — persis pola `campaignCommandEntry`,
  dijaga tes yang membaca berkas seberangnya. Sebelum ini panelnya menampilkan pesan API apa adanya,
  dan itu yang membuat aturan ini sengaja TIDAK dicerminkan: salinan kedua yang tidak dipakai siapa
  pun adalah salinan yang tidak akan pernah ikut diperbarui. Sekarang kebalikannya yang berlaku —
  layar dan chat yang menyebut golongan berbeda untuk isu yang sama ("dicoba ulang otomatis" di satu
  sisi, "perlu login ulang" di sisi lain) membuat orang mempercayai yang lebih menenangkan, dan akun
  yang izinnya mati dibiarkan mati berhari-hari. Yang TIDAK ikut dicerminkan adalah penyusun
  pesannya (`syncIssueMessage`): bentuk chat dan bentuk panel memang berbeda.
- **Pesan API-nya disembunyikan, bukan dibuang** — di balik "Detail teknis" di tiap baris panel.
  Yang membukanya memutuskan satu hal, dan URL laporan GAM tidak menjawabnya; yang memperbaikinya
  nanti tetap butuh kalimat persisnya. Kecuali untuk golongan **belum bisa dipastikan**, yang tidak
  punya kalimat manusianya sama sekali: di situ pesan aslinya adalah satu-satunya keterangan yang
  ada, dan menutupnya berarti barisnya tidak mengatakan apa-apa.
- **Tanggal di kalimat "Akibat" diformat saat DIRENDER** (`formatDatesInText`). Kalimatnya disusun
  sisi sync, yang tidak punya pemformat tanggal dashboard ini dan tidak boleh punya salinannya —
  tanpa itu, "2026-08-25 s/d 2026-08-28" adalah satu-satunya tanggal di seluruh layar yang tidak
  berbunyi "25 Agu 2026".
- **Yang PULIH ikut dikabarkan** (`recoveredNotices` + `syncRecoveryMessage`). Kabar gagal tanpa
  kabar pulih membuat penerimanya menyimpan kecemasan yang tidak punya ujung: pesan terakhir yang ia
  baca berbunyi "earning enam subdomain kosong", dan satu-satunya cara mengetahui itu sudah beres
  adalah membuka dashboard — persis langkah yang notifikasi ini ada untuk menghapusnya. Hanya untuk
  yang PERNAH dikabarkan gagal; pemulihan atas sesuatu yang tidak pernah diberitahukan cuma pesan
  tambahan. Penandanya menumpang `dashboard/syncIssueNotices` yang sama — bentuknya jadi
  `{ day, state, label, target }`, penanda lama berbentuk teks tetap dibaca sebagai `failed` —
  dan `label`/`target` ikut disimpan karena baris yang pulih SUDAH TIDAK ADA LAGI di daftar isu.
  Batasnya **dua pesan per target per hari**, satu gagal satu pulih: akun yang berkedip tiap jam
  kalau tidak akan mengirim dua puluh empat pesan sehari.

**Yang diulang adalah BAGIAN yang gagal, berjarak dan terbatas — bukan run penuh sampai berhasil.**
Antreannya di `dashboard/syncRetries/{cabang}`, satu bentuk untuk semuanya
(`retrySeed`/`dueRetries`/`retryOutcome` di [`functions/sync-core.js`](functions/sync-core.js)):
jeda 1→5 menit, berhenti setelah `MAX_SYNC_RETRIES` (5). Akun GAM/AdSense/Meta dijalankan
`scheduledSyncRetry` (tiap menit, meresync lewat arg `only`); situs plugin dijalankan
`retryPluginIssues` di [`functions/sync-plugin.mjs`](functions/sync-plugin.mjs) lewat cron semenit
di `server/`.

- **Cabangnya bernama SAMA dengan cabang `syncIssues`** (`gamAccounts`, `plugin`, …). Itu yang
  membuat tiap kelompok isu di dialog menemukan antreannya sendiri tanpa peta nama di antara
  keduanya — dan peta nama adalah cara satu cabang baru diam-diam kehilangan indikatornya.
- **Sampai berhasil bukan pilihan.** "Error establishing a database connection" tidak berubah karena
  ditanya lagi tiga detik kemudian; yang berubah cuma beban di hosting yang sedang tumbang — dan
  sebagian besar armada tinggal di hosting yang sama. Sesudah percobaan terakhir, yang mencoba lagi
  adalah sync penuh berikutnya: kegagalan yang bertahan sejam butuh orang, bukan retry.
- **Benihnya ditulis mengganti seluruh cabang tiap run penuh**, seperti `syncIssuesUpdate`: yang
  sudah pulih tidak boleh tertinggal sebagai retry hantu.
- **`running: true` (`retryRunning`) ditulis SEBELUM target pertama dihubungi** — itulah yang
  menyalakan indikator di topbar (ikonnya berganti jadi `RefreshCw` yang berputar) dan yang menahan
  siklus semenit berikutnya masuk ke percobaan yang sama. `retryOutcome` sengaja TIDAK menyalinnya
  ke percobaan berikutnya. Kalimat statusnya satu tempat,
  [`src/lib/syncRetry.js`](src/lib/syncRetry.js), supaya ikon dan dialog tidak bercerita beda.
- **Retry akun tidak menyentuh `syncIssues`; retry plugin mencoret yang PULIH.** Bukan selera: retry
  akun meresync dengan `only` dan tidak pernah menghitung ulang daftar isunya, jadi mencoret di sana
  berarti menebak. Retry plugin menghubungi persis situs yang jadi baris itu, dan jawabannya bukti
  langsung — daftar yang masih menyebut situs yang sudah hidup membuat orang mengejar masalah yang
  sudah tidak ada.

### Jalankan ulang satu tahap dari Settings

Tiap tahap di log run (Settings → Logs) punya tombol **Jalankan ulang** untuk admin, lewat
`POST /sync-runs/stages` di server kontrol. Yang dijalankan adalah `runFullSync` yang SAMA dengan
`only: [tahap]` — rencananya disusun `syncPlan`, satu daftar yang juga dipakai `syncStageNames`
untuk memvalidasi nama, jadi tidak ada daftar tahap kedua.

- **Tercatat di log yang sama**, ringkasannya berawalan "Manual (email)". Badge "Syncing..." di
  topbar menyala selama ia jalan, tapi run satu tahap TIDAK menimpa `lastOk`/`lastSummary`/jadwal
  berikutnya di `syncStatus` — "berhasil" milik satu tahap akan mengaku mewakili seluruh sync.
- **Ditolak 409 selama run lain berjalan**, di proses server (`syncStage.busy`) atau menurut
  `syncStatus.running` yang umurnya < 15 menit — di instansi 1 run penuhnya milik Cloud Functions,
  proses yang tidak berbagi penjaga dengan server. Run penuh server (instansi 2) dilewati selama
  satu tahap berjalan (`after`).
- Butuh deploy ulang server kontrol dan hosting.

## Perintah

```
npm test          # test frontend (node --test)
npm run build     # build vite
npx biome check --write .
cd functions && npm test
cd server && bun test    # paket Bun, bukan npm — CI menjalankan keempatnya
```

## Commit

**Pesan commit TIDAK memuat trailer `Co-Authored-By: Claude ...`, dan tidak ada pengecualian.**
Riwayat repo ini atas nama penulis manusianya; trailer itu melekat permanen di riwayat dan
mengumumkan sesuatu yang tidak diminta pemiliknya. Berlaku juga untuk `git commit --amend` dan
untuk body PR — tidak ada footer "Generated with Claude Code" kecuali diminta.
