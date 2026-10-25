# Manajemen plugin RabbitROI

Tiap subdomain menjalankan WordPress dengan plugin RabbitROI. Sejak versi **0.4.7** plugin itu
membuka Management API sendiri, dan halaman `/plugin` memakainya untuk mengelola armada dari satu
tempat: landing page, pengaturan iklan, header/footer, dan behaviour.

Referensi API-nya: `management-api-usage.md` (dari sisi plugin).

## Yang membuat halaman ini berbeda dari semua halaman lain

**Sebagian besar yang ditampilkannya tidak ada di RTDB.** Pengaturan landing/iklan/behaviour tinggal
di database WordPress masing-masing situs, dan dibaca lewat server kontrol setiap kali sebuah situs
dibuka. Yang ada di RTDB cuma cermin status (`pluginSites`).

Dua akibatnya, dan keduanya terlihat di layar:

| | Halaman lain | `/plugin` |
|---|---|---|
| Data berubah sendiri | ya, langganan realtime RTDB | **tidak** — tiap tab memuat saat dibuka |
| Server kontrol mati | gating & saklar campaign jatuh ke antrean RTDB | **tidak ada cadangan** |

Tidak adanya cadangan bukan kelalaian. Enroll token dan `api_key` tiap situs tinggal di server, dan
situsnya sendiri tidak akan menjawab browser — endpoint plugin tidak mengirim header CORS untuk
origin dashboard, jadi `fetch` dari halaman ditolak sebelum sampai ke PHP-nya. Karena itu halaman
memeriksa `CONTROL_API_ENABLED` dan **mengatakan** kalau server belum dikonfigurasi, alih-alih
menggambar tombol yang pasti gagal.

## Dua kredensial, dan keduanya tinggal di server

| | Header | Dipakai | Tinggal di |
|---|---|---|---|
| **Enroll token** | `X-RabbitROI-Enroll` | hanya `POST /manage/enroll` | `PLUGIN_ENROLL_TOKEN` di `server/.env` |
| **api_key** | `X-RabbitROI-Key` | semua endpoint lain | `pluginKeys/{subdomainId}` di RTDB |

Enroll token **dibagi ke seluruh armada** — ditanam saat build plugin. Satu token itu meng-enroll
setiap situs kita, jadi ia lebih berbahaya daripada API key vi-control (yang setidaknya cuma satu
sistem). Ia tidak boleh ada di `.env` root: file itu dibaca Vite, dan satu salah ketik prefiks
`VITE_` mengirimnya ke bundle yang dibaca setiap pengunjung dashboard.

`api_key` **unik per situs** dan lahir saat enroll — situs tidak akan menampilkannya lagi. Bocornya
kunci satu situs tidak memengaruhi situs lain.

### Kenapa api_key tidak dienkripsi

`POST /manage/reset` — satu-satunya cara meng-enroll ulang sebuah situs — **membutuhkan kunci
lama**. Dienkripsi dengan rahasia di sisi server, hilangnya rahasia itu berarti setiap situs
terkunci di `already_enrolled` selamanya, dan jalan keluarnya cuma masuk ke WordPress tiap situs
satu per satu. Kunci ini adalah satu-satunya jalan pulang, jadi ia disimpan sebagai teks yang bisa
dibaca — dijaga aturan database, bukan sandi yang bisa ikut hilang.

### Kenapa dua node RTDB dan bukan satu

```
pluginSites/{subdomainId}   status: enrolled, versi, php/wp, lastSeenAt, error   <- dilanggan halaman
pluginKeys/{subdomainId}    apiKey                                                <- tidak pernah dilanggan
```

Izin baca RTDB **menurun**: satu `.read` di induk memberi seluruh anak, dan aturan yang lebih dalam
tidak bisa menariknya kembali. Digabung jadi satu node, tiap superadmin yang membuka halaman ini
akan mengunduh seluruh `api_key` armada ke browsernya hanya untuk melihat kolom "Versi".

Yang **tidak** dijaga pemisahan ini: aturan keduanya sama (`admin|superadmin`), jadi seseorang yang
mengetik path-nya sendiri tetap bisa membacanya. Yang dihapus adalah keharusan, bukan kemungkinan.
Aturannya admin dan bukan superadmin karena **SYNC_USER — yang menulisnya — adalah admin**; aturan
superadmin di sana akan menolak penulisnya sendiri.

## Siapa yang boleh

**Superadmin saja**, halaman kedua setelah `/vi-control` yang begitu. Alasannya sejenis tapi tidak sama:
tombol di sini menulis kode iklan dan aturan behaviour ke situs yang sedang menerima trafik
berbayar. **Kode iklan yang salah tidak menghasilkan error di mana pun** — ia menghasilkan
pendapatan nol, dan baru terbaca di laporan GAM keesokan harinya.

Yang menegakkan **bukan** aturan database, dan ini beda penting dari gating: halaman ini tidak
menulis antrean apa pun ke RTDB, jadi tidak ada `.validate` yang bisa menahannya. Yang menegakkan
adalah gerbang `requireSuperAdmin` di [`server/plugin.js`](../server/plugin.js).
`SUPERADMIN_PAGES` di [`src/config/access.js`](../src/config/access.js) hanya menyembunyikan menunya.

## Hostname datang dari `subDomains`, tidak pernah dari request

Request hanya membawa ID push-key RTDB (`/plugin/sites/:id/...`); hostname-nya dibaca dari
`subDomains/{id}.name`. Ini gerbang yang menahan enroll token dari terkirim ke host sembarangan —
host yang tidak terdaftar di dashboard tidak punya cara masuk sama sekali.

Bentuknya tetap diperiksa keras di `pluginBaseUrl` walau sudah datang dari RTDB, karena
`subDomains.name` diisi manusia lewat form dan pernah berisi URL lengkap, spasi, dan `https://` di
depannya.

Alasan yang sama menahan `:group`: nilainya disambung mentah jadi segmen alamat di API plugin, jadi
ia harus salah satu dari `PLUGIN_GROUPS`. Dibiarkan bebas, siapa pun yang lolos gerbang superadmin
bisa mengarahkannya ke endpoint plugin mana pun — termasuk AutoPost, yang sengaja tidak
didokumentasikan.

## "Tersimpan" tidak berarti "berubah"

Ini penjaga terpenting di seluruh fitur, dan ia ada karena API-nya memang bekerja begitu:

> Nilai enum yang tidak valid akan **diabaikan** (field tetap memakai nilai lama).
> — Lampiran C, `management-api-usage.md`

...dengan HTTP **200** dan amplop `success: true`. Tanpa penjaga, satu salah ketik menghasilkan
"Tersimpan." di layar untuk pengaturan yang tidak berubah sama sekali, dan satu-satunya cara
mengetahuinya adalah membuka situsnya dan melihat iklannya sendiri.

Dua lapis:

1. **Sebelum jaringan** — `normalizeField` menolak enum, URL, dan angka di luar batas. Jawabannya
   422 dengan kalimat yang menyebut field dan pilihan yang sah.
2. **Setelah jaringan** — `unappliedFields` membandingkan yang dikirim dengan yang dijawab situs.
   Yang tidak cocok dilaporkan sebagai `unapplied`, dan halaman menampilkannya sebagai peringatan
   **kuning**, bukan sukses hijau.

Perbandingannya sengaja longgar: situs menjawab dari kolom database, jadi `3` kembali sebagai `"3"`
dan `true` sebagai `"1"`. Perbandingan ketat akan menandai tiap field sebagai gagal, dan peringatan
yang selalu menyala tidak menyampaikan apa pun.

**Dua grup tidak bekerja begitu** — CMP dan Keamanan menolak dengan `save_failed` (400) alih-alih
mengabaikan, jadi di sana `unapplied` praktis tidak pernah muncul dan "Tersimpan." benar-benar
berarti tersimpan. Yang tetap harus dijaga di sana justru sebaliknya: nilai yang BENTUKNYA berubah
di jalan (`video_randpos_interval`, yang dikirim `"20"` lalu dibacakan `"20-20"`) akan dilaporkan
lapis kedua sebagai kegagalan yang tidak pernah terjadi. Lihat seksi Keamanan di bawah.

Karena itu hasil terapkan-massal punya **tiga** status, bukan dua:

| | Artinya | Yang harus dilakukan |
|---|---|---|
| `ok` | tersimpan dan berubah | — |
| `unapplied` | situs menerima permintaannya lalu mengabaikan nilainya | perbaiki nilainya; mengulang tidak mengubah apa pun |
| `failed` | belum berubah sama sekali | coba lagi |

Dilebur ke `ok`, yang `unapplied` hilang. Dilebur ke `failed`, ia mengundang pengulangan yang tidak
akan pernah berhasil. Ini pola yang sama dengan `ok`/`aborted`/`problem` di gating.

## CMP: grup pertama yang MENOLAK, bukan mengabaikan

Tab **CMP** mengatur dialog consent Google di tiap situs: satu sakelar (`cmp_enabled`) dan satu
textarea kode (`cmp_code`). Dua field, dan itu seluruh grupnya.

Ia membalik kenyataan yang menjadi dasar seluruh halaman ini. Di Iklan, Header & Footer, dan
Behaviour, nilai yang tidak sah **diabaikan** dan situs tetap menjawab 200 berisi nilai lama —
itulah yang membuat `unappliedFields` harus ada. Di sini nilai yang tidak sah **ditolak** dengan
`save_failed` (400), dan yang ditolak
adalah **seluruh permintaan**: tidak ada satu field pun yang tertulis, termasuk field lain yang ikut
di body yang sama. Jadi di tab ini "Tersimpan." benar-benar berarti tersimpan, dan gagal benar-benar
berarti tidak ada yang berubah — tidak ada keadaan setengah jadi di antaranya.

Yang **tidak** berubah karenanya adalah `normalizeField`: ia tetap memvalidasi sebelum menyentuh
jaringan. Penolakan dari situs sampai ke layar sebagai kalimat plugin yang menyebut nama kolom,
sementara penolakan di sini menyebut label yang sedang dibaca orang di formnya.

**Fieldnya cuma dua, dan yang ketiga berbahaya.** `cmp_referrer_policy` adalah kunci penyimpanan
internal plugin, bukan parameter API — POST yang membawanya ditolak `save_failed` dan menjatuhkan
simpanan yang sah bersamanya. Ia tidak ada di `CMP_FIELDS`, dan `toPluginPayload` hanya meneruskan
field yang terdaftar: penjagaan yang sama yang membuang field asing di grup mana pun, cuma di sini
akibat lolosnya jauh lebih besar daripada satu nilai yang diabaikan.

`cmp_enabled` sengaja bertipe `boolean` dan bukan `bool01`. Keduanya tidak bisa disamakan: `0`
sebagai angka adalah nilai yang tidak sah di grup yang menolaknya, dan yang dibaca orang adalah
kegagalan menyimpan untuk sakelar yang baru saja ia matikan. `"true"`/`"1"`/`1` dan
`"false"`/`"0"`/`0` semuanya diterima dari form dan selalu keluar sebagai boolean sungguhan.

Kotak kode yang **dikosongkan** orang tetap terkirim sebagai string kosong, bukan dibuang seperti
enum atau angka kosong: mengosongkan kode CMP adalah tindakan yang disengaja, dan field yang tidak
terkirim membuat kode lama bertahan di situs sementara layar menunjukkan kotak kosong.

Dialog consent-nya sendiri hanya muncul di wilayah yang mewajibkannya dan hanya pada halaman yang
benar-benar **dirender** — pengalihan (302) tidak punya dokumen, jadi tidak tersentuh. Itu artinya
sakelar yang menyala di situs yang isinya cuma redirect tidak akan pernah terlihat berubah oleh
siapa pun yang mengeceknya dari Indonesia.

## Keamanan: lima kontrol, dan dua yang berubah bentuk di jalan

Tab **Keamanan** (`GET/POST /manage/security`) memegang lima kontrol yang di layar plugin berada di
**luar** blok behaviour: Perilaku Test Mode, VI Gate Beacon, Fake Resume Video saat Klik Iklan, Acak
Posisi Video Player, dan Ukuran Slot Iklan (GPT).

Ia grup **kedua yang menolak** alih-alih mengabaikan — aturan CMP di atas berlaku utuh di sini:
nilai yang tidak sah dijawab `save_failed` (400), dan yang ditolak adalah seluruh permintaan.
Nama field yang tidak dikenal ikut ditolak begitu, jadi satu salah ketik menjatuhkan simpanan yang
sah bersamanya. Yang menahannya tetap `toPluginPayload`, yang cuma meneruskan field terdaftar.

### Yang sengaja tidak punya permukaan API

**Sembunyikan Form Login** (`hidden_login_form`, `url_login`, `aksi_login`) tidak ada di skema, dan
itu keputusan sisi plugin yang diikuti apa adanya: satu slug yang salah ketik lalu didorong ke
seluruh armada mencabut pintu masuk wp-admin di tiap host sekaligus, dan tidak ada satu pun endpoint
yang bisa mengembalikannya — yang tersisa cuma masuk ke hosting tiap situs satu per satu.
Mengirimnya dijawab `save_failed`.

**`behaviour_*` juga tidak di sini.** Ia tetap lewat `/manage/behaviour`, dan pemisahan itu bukan
kerapian: dua endpoint yang menulis kunci yang sama dengan dua aturan validasi yang berbeda akan
membuat armada tidak konsisten, dan selisihnya cuma terbaca dengan membuka dua tab lalu mengadu
angkanya.

### `video_randpos_interval`: satu angka dikirim sebagai rentang

Situs membacakan field ini kembali dalam bentuk `"lo-hi"` **apa pun yang dikirim** — `"20"`
tersimpan dan dilaporkan `"20-20"`. Itu bentuk yang memang dipakai halaman, jadi nilai tersimpan ==
nilai efektif.

Yang jadi masalah kalau dikirim apa adanya bukan penyimpanannya melainkan **penjaganya**:
`unappliedFields` membandingkan yang dikirim dengan yang dijawab, menemukan `"20"` ≠ `"20-20"`, dan
melaporkan field yang justru tersimpan **dengan benar** sebagai "nilainya ditolak diam-diam di
sana". Peringatan itu menyuruh orang mengulang sesuatu yang sudah berhasil — di satu-satunya
penjaga yang halaman ini punya untuk kegagalan yang sungguhan, dan peringatan yang terbukti salah
berhenti dibaca.

Jadi `normalizeField` mengirimnya sudah berbentuk `"lo-hi"` (tipe `range`). `"0"` → `"0-0"` berarti
mati, maksimal 60 detik per sisi, dan batas bawah yang melebihi batas atas ditolak di sini alih-alih
diserahkan ke situs — di grup yang menolak, satu nilai begitu menjatuhkan field lain yang sah di
body yang sama.

### `gpt_sizes`: kosong adalah nilai, bukan ketiadaan

`""` berarti "pakai daftar yang tertulis di kode iklan situs", jadi ia dikirim sebagai string kosong
alih-alih dijatuhkan ke `null` seperti enum dan angka kosong — aturan yang sama persis dengan
`cmp_code`: field yang tidak terkirim membuat daftar lama bertahan di situs sementara layar
menunjukkan kotak kosong.

Bentuknya `LEBARxTINGGI` dipisah koma (atau `fluid`), maksimal 20 ukuran, tiap sisi 20–2000 px —
diperiksa di sini, bukan diserahkan ke situs, dengan alasan yang sama seperti di atas. Yang dikirim
juga **dinormalkan** (huruf `x` dikecilkan, spasi dibuang): `unappliedFields` membandingkannya
dengan jawaban situs, dan `"320X480"` yang dijawab `"320x480"` akan terbaca sebagai nilai yang
ditolak.

Field ini hanya berlaku kalau kode iklan situs sudah ditulis memakai `window.__rbtSizes`. Itu
ketergantungan yang tidak terlihat dari fieldnya sendiri, jadi ia disebut di keterangan seksinya —
di balik ikon **info** pada legendanya, sepola keterangan tiap field.

### Fake Resume butuh beacon, dan endpoint-nya tidak mengeluh

`video_adclick_resume: true` dengan `vi_gate_enabled: false` **tidak berjalan di halaman**, tapi
keduanya sah sebagai keadaan tersimpan sehingga situs menerimanya tanpa berkata apa-apa. Yang
tersimpan lalu tampak menyala dan tidak pernah berlaku sedetik pun. Karena itu ia berdiri sebagai
`notice` di seksinya — tempat yang sama dengan "butuh Simpan Log aktif" di Behaviour, dan alasan
yang sama: ketergantungan yang tidak bisa dibaca dari satu pun field di layar itu.

Seksi **Perilaku Test Mode** juga membawa `notice`, untuk jebakan yang bentuknya berbeda: pilihan
yang benar untuk menguji adalah pilihan yang salah untuk dibiarkan. Dengan `respect_behaviour`,
tiap kunjungan test ikut terakumulasi di hitungan behaviour situs itu — dan yang mengingatkan orang
mengembalikannya ke `bypass` cuma ingatannya sendiri.

### Kalimat pembuka di balik ikon, peringatan tetap terbaca

`sections[].description` digambar sebagai ikon **info** di sebelah legenda seksinya, bukan sebagai
paragraf di bawahnya. Tab ini punya empat seksi: sebagai paragraf, keempatnya jadi empat blok teks
yang memisahkan tiap kelompok isian dari kelompok berikutnya sejauh dua baris — dan yang terbaca
bukan keterangannya melainkan dindingnya. Ia DEFINISI, tidak berubah dari satu pembacaan ke
pembacaan lain, jadi ia memenuhi syarat yang sama dengan `help` tiap field: sekali, di kepala, dan
hanya untuk yang memintanya.

`notice` **tidak** ikut pindah. Yang disebutnya ketergantungan yang tidak terlihat dari field mana
pun di layar itu, dan yang gagalnya diam: tanpa VI Gate Beacon, Fake Resume tersimpan rapi dan tidak
pernah berjalan sedetik pun. Peringatan yang harus di-hover dulu untuk dibaca adalah peringatan yang
tidak dibaca siapa pun — aturan yang sama yang menahan `optionHelp` pada radio tetap sebagai teks.

### Dua kolom, berbeda dari CMP dan Behaviour

Keduanya `columns: 1` karena isinya satu daftar panjang yang tiap fieldnya butuh baris keterangan
sendiri. Keamanan bukan itu: empat kontrol yang saling lepas, masing-masing sudah punya
fieldset-nya sendiri, dan isinya empat saklar plus tiga angka pendek. Satu kolom di sini berarti
semuanya berderet ke bawah setinggi dua layar dengan separuh lebar tiap baris kosong.

Dua field digambar melebar penuh: `video_randpos_enabled` karena ia saklar induk atas tiga field di
bawahnya (sepola `behaviour_detection` — di separuh baris ia berdiri berdampingan dengan angka yang
justru diaturnya), dan `gpt_sizes` karena yang membedakan satu daftar dua puluh ukuran dari daftar
lain ada di ekornya.

## POST bersifat partial — dan itu yang menjaga perubahan orang lain

Semua `POST` plugin hanya mengubah field yang dikirim. Halaman memanfaatkannya: `changedValues`
membandingkan form sekarang dengan keadaan saat form dibuka, dan **hanya selisihnya** yang dikirim.

Mengirim seluruh form berarti menulis ulang tiap field dengan nilai yang dibaca beberapa menit lalu
— dan di halaman yang mengelola armada, itu berarti perubahan orang lain di sela-sela hilang tanpa
jejak. Karena itu kedua sisi perbandingan lewat `toFormValues` dulu: angka yang datang sebagai `3`
dari satu endpoint dan `"3"` dari endpoint lain tidak boleh terbaca sebagai perubahan.

Field yang diubah ditandai titik hijau di formnya, dan jumlahnya disebut di atas tombol Simpan.

## Skema field ditulis sekali

`PLUGIN_SCHEMA` di [`functions/plugin-core.js`](../functions/plugin-core.js) adalah **satu-satunya**
definisi — dipakai server untuk memvalidasi dan dikirim ke browser lewat `GET /plugin/schema` untuk
menggambar form.

Ini pengecualian yang disengaja dari pola `campaignCommandEntry` dan `reminders-core.js`, yang
memang ditulis dua kali karena frontend dan `functions/` tidak bisa saling impor. Di sana yang
diduplikasi selusin baris; di sini empat puluh field dengan enum, batas, dan label masing-masing —
dan yang bergeser tidak akan berbunyi sebagai kesalahan: form akan menawarkan enum yang ditolak
server, atau lebih buruk, enum yang **diterima** server tapi diabaikan diam-diam oleh plugin.

Field landing sengaja **bukan** seluruh Lampiran A. Sebagian besarnya tidak menyebutkan nilai yang
sah di mana pun (`protect_elementor`, `referrer_option`, `auto_refresh_option`), dan kotak kosong
untuk field yang isinya tidak diketahui mengundang seseorang menulis tebakan ke situs hidup. Yang
tidak ada di skema aman sepenuhnya — POST-nya partial, jadi ia tidak pernah ikut terkirim.

## Alur enroll, dan urutan yang tidak boleh dibalik

```
POST /plugin/sites/:id/enroll
  -> enrollSite(host, ENROLL_TOKEN)
  -> tulis pluginKeys/{id}      <- DULU
  -> tulis pluginSites/{id}     <- SESUDAHNYA
```

Proses yang mati di antara keduanya meninggalkan situs yang enrolled dengan kunci tersimpan tapi
status "belum" — itu diperbaiki satu ping. Urutan sebaliknya meninggalkan situs yang enrolled
**tanpa** kunci tersimpan, dan itu tidak bisa diperbaiki dari dashboard sama sekali: enroll ulang
ditolak `already_enrolled`, dan reset butuh kunci yang tidak pernah sempat disimpan.

Reset kebalikannya: kunci dibuang **hanya setelah** situs menjawab berhasil.

## Keadaan yang tidak boleh dilebur

| Keadaan | Tanda | Tombol | Kenapa dipisah |
|---|---|---|---|
| Belum | tidak ada baris cermin, atau `enrolled: false` | Enroll | — |
| Terhubung | `enrolled`, tidak ada error | Kelola, Ping, Reset | — |
| Bermasalah | `enrolled`, error terakhir gagal | Kelola tetap hidup | situsnya bisa saja sudah hidup lagi |
| **Kunci ditolak** | `errorCode: invalid_key` | tidak ada yang membantu | **jalan buntu** |
| **Terkunci** | `errorCode: already_enrolled`, belum enroll di sisi kita | tidak ada | reset harus dari WordPress-nya |

Dua yang terakhir adalah jalan buntu dari sisi dashboard: kunci kita tidak dikenali situs itu, dan
reset — satu-satunya jalan ke enroll ulang — justru membutuhkan kunci yang sudah tidak berlaku.
Digambar seperti kegagalan biasa, orang akan menekan tombol yang sama berkali-kali untuk sesuatu
yang tidak akan pernah berhasil dari sini.

`enrolled` juga **bertahan** lewat kegagalan berikutnya, dan tidak pernah disimpulkan dari
ada-tidaknya `version`. Situs yang enroll-nya berhasil tapi ping berikutnya gagal akan digambar
"belum enroll" kalau disimpulkan — dan tombol Enroll yang muncul untuknya akan dijawab
`already_enrolled`, yang jalan keluarnya reset, yang membuang kunci yang masih sah.

## AutoPost: menyuruh situs menulis artikel

Tab **AutoPost** di `/plugin` adalah padanan REST dari halaman `page=rabbitroi-auto-post` di
wp-admin tiap situs. Ia berbeda dari lima tab di sebelahnya dalam satu hal yang menentukan seluruh
bentuknya: **tidak ada apa pun di situs yang dibacanya lebih dulu**. Lima tab lain membuka diri
dengan memanggil situsnya, menampilkan keadaan yang tersimpan di sana, dan mengirim SELISIHNYA; di
sini tidak ada yang tersimpan — tiap pengiriman adalah permintaan baru yang berdiri sendiri.

### Alamatnya di luar `/manage/`

```
https://<situs>/wp-json/rabbitroi/v1/manage/<grup>    <- lima tab pengaturan
https://<situs>/wp-json/rabbitroi/v1/autopost         <- AutoPost
```

Kunci yang dipakai **sama persis** (`X-RabbitROI-Key`, dari enroll yang sama), tapi path-nya bukan
turunan dari yang pertama. Disambung lewat `pluginBaseUrl`, tiap permintaan menjawab
`rest_no_route` (404) — dan kegagalan itu terbaca persis seperti situs yang belum memasang plugin
versi baru. Karena itu `autopostBaseUrl` ada di
[`functions/autopost-core.js`](../functions/autopost-core.js), dan `pluginHostname` dipakai bersama:
dua penormal hostname berarti satu di antaranya suatu hari menerima host yang ditolak yang lain.

**AutoPost TIDAK ditambahkan ke `PLUGIN_GROUPS`.** Daftar itu adalah daftar putih untuk `:group`,
yang disambung mentah jadi segmen alamat DI DALAM `/manage/` — menambahkannya ke sana menghasilkan
alamat yang salah sambil membuka kembali jalan yang daftar itu ada untuk menutupnya. AutoPost punya
route-nya sendiri.

### Amplop gagalnya berbeda, dan itu yang paling mudah terlewat

| | Bentuk gagal |
|---|---|
| Manajemen | `{ success: false, error: { code, message } }` |
| AutoPost | `{ success: false, message, logs }` — di **akar**, tanpa `error.code` |
| Izin WordPress | `{ code, message, data: { status } }` — sama di keduanya |

`unwrapPlugin` membaca `body.error?.message` dan menemukan `undefined`, jadi sebab yang benar-benar
berguna — "Error Gemini: API key not valid", "kuota habis" — diganti kalimat umum "Plugin menjawab
tanpa kode". Itu satu-satunya keterangan yang ada untuk kegagalan AI, jadi `unwrapAutopost`
membacanya sendiri, **berikut `logs`-nya**.

`rest_no_route` punya kalimatnya sendiri: ia satu-satunya kode di sini yang tidak berarti ada yang
salah dengan kunci maupun situsnya, melainkan bahwa pluginnya belum punya AutoPost. Dilebur dengan
`invalid_key`, orang akan menekan Reset — yang membuang kunci yang masih sah — untuk situs yang cuma
perlu diperbarui.

### Kunci AI: tinggal di perangkat, kalau diminta

Kunci AI diketik di form, dikirim di **body** (tidak pernah di alamat: alamat masuk ke log akses
server, riwayat browser, dan header `Referer`), dan **tidak ada di skema field** — supaya ia tidak
ikut jalur mana pun yang menyimpan nilai form (cache antar-tab, "terapkan ke situs lain", riwayat
alamat).

Tiga tempat yang sengaja TIDAK dipakai:

| | Kenapa tidak |
|---|---|
| RTDB | `pluginKeys` memuat kunci yang **kita** terbitkan. Kunci AI ditagihkan per panggilan kepada pemiliknya; di sana ia terbaca tiap admin yang mengetik path-nya |
| Alamat halaman | `useUrlState` menulis ke query, dan query masuk ke riwayat browser dan ke tiap tautan yang di-share |
| `server/.env` | satu kunci untuk seluruh armada berarti satu tagihan yang tidak bisa dipisahkan per orang, dan mengubahnya menuntut deploy |

Yang tersisa: `localStorage` perangkat itu sendiri, **dan hanya kalau orangnya mencentang "Ingat di
browser ini"**. Bawaannya tidak diingat — menyimpan kredensial diam-diam adalah keputusan yang
dibuat atas nama orang lain.

### Seluruh field dikirim, bukan selisihnya

Kebalikan dari lima tab pengaturan, dan itu bukan kelalaian: POST-nya tidak partial dan tidak ada
apa pun di situs yang dibaca lebih dulu, jadi field yang **tidak** dikirim jatuh ke bawaan REST
alih-alih ke nilai lama. Mengirim hanya yang berubah berarti apa yang tergambar di layar berhenti
sama dengan apa yang berangkat.

Karena itu juga enum di tab ini bertanda `required`: kotak "(tidak diubah)" hanya benar untuk grup
yang POST-nya partial.

**Bawaan formnya kolom "Default REST" di Lampiran E.2, dengan SATU penyimpangan.** Bawaan REST
berbeda dari bawaan layar wp-admin di tiga tempat; dua mengikuti REST, satu mengikuti layar plugin:

| | Layar `page=rabbitroi-auto-post` | Default REST | Yang dipakai di sini |
|---|---|---|---|
| `penjadwalan` | `5_minutes` | `1_hours` | **`1_hours`** (REST) |
| `generate_image` | menyala | `false` | **`false`** (REST) |
| `tag_otomatis` | menyala | `false` | **`true`** (layar plugin) |

Yang membedakan kedua sakelar itu adalah **harga menyalakannya**, bukan selera. `generate_image`
menambah satu tahap tersendiri ke tiap job — `featured_image` di 75%, yang men-scrape Bing dan bisa
gagal sendiri tanpa menjatuhkan artikelnya — jadi menyalakannya untuk seluruh armada adalah
keputusan yang harus diambil orang, bukan yang diwarisi dari kotak yang tidak ia sentuh.
`tag_otomatis` tidak menambah panggilan apa pun: tag datang bersama jawaban AI yang sama, dan
artikel tanpa tag adalah kerugian yang baru terbaca berminggu-minggu kemudian di halaman arsip yang
tidak punya satu pun jalan masuk.

Nilainya sendiri tidak menentukan apa pun — seluruh field selalu dikirim, jadi yang tergambar di
layar adalah yang berangkat — dan justru itu yang membuat penyimpangan di atas boleh ada: ia
menggeser sakelar yang TERLIHAT, bukan perilaku yang tersembunyi. Yang tidak boleh adalah menyimpang
tanpa menuliskannya, karena satu-satunya cara memeriksa daftar ini adalah mengadunya dengan dokumen.

### Satu request = satu kata kunci = satu artikel

Tidak ada endpoint batch di sisi plugin, jadi yang mengulanginya adalah `submitAutopost` di
[`functions/sync-plugin.mjs`](../functions/sync-plugin.mjs) — pool `AUTOPOST_CONCURRENCY` (5).
Angka itu jauh lebih kecil daripada `PLUGIN_CONCURRENCY` dan bukan karena permintaannya berat:
`POST /autopost` menjawab **202 dalam sepersekian detik** lalu meninggalkan satu proses PHP hidup
sampai artikelnya selesai. Yang dibatasi bukan lalu lintas kita melainkan berapa penulis artikel
yang berjalan bersamaan di satu shared hosting — dan yang jatuh kalau kelewatan bukan job-nya
melainkan situsnya, untuk pengunjung yang sedang datang dari iklan berbayar. `AUTOPOST_MAX_KEYWORDS`
(50) menahan satu tempelan berisi seribu baris.

- **Payload seluruh daftar disusun DI DEPAN**, sebelum satu job pun dikirim. Setelan yang salah
  ditolak dengan nol artikel terlanjur dibuat, bukan setelah tiga puluh di antaranya sudah berjalan.
- **Satu kata kunci yang ditolak tidak menjatuhkan sisanya**, dan di sini alasannya lebih keras
  daripada di terapkan-massal: job yang sudah lahir **tidak bisa ditarik kembali**. Mengulang batch
  dari awal karena satu baris gagal menghasilkan artikel ganda untuk separuh daftar — AutoPost
  memang tidak punya dedup sama sekali.
- **Duplikat dibuang sebelum dikirim** (`autopostKeywords`, dicerminkan di
  [`src/lib/autopost.js`](../src/lib/autopost.js)). Dipisah per **baris saja**, tidak per koma —
  sengaja berbeda dari `mediaList`: kata kunci long-tail memuat koma, dan yang dipecah di sana jadi
  dua potongan kalimat yang tidak berarti apa-apa sendirian.
- **Cermin status ditulis SEKALI di akhir**, bukan per kata kunci: `pluginSites` dilanggan halaman,
  dan lima puluh tulisan berturut-turut membangunkan tiap browser yang membukanya lima puluh kali
  untuk satu tindakan. Sebagian gagal **tidak** menandai situsnya merah — kegagalan per kata kunci
  sudah berdiri di tabelnya sendiri, dan lencana merah karena satu kuota AI habis mengirim orang
  memeriksa WordPress yang sehat.

### Bentuknya: dua kolom, saklar, dan keterangan di balik ikon

- **Kiri yang sedang disusun, kanan yang sudah terkirim.** Bertumpuk, daftar job berdiri di bawah
  form setinggi dua layar — dan yang paling perlu dilihat setelah menekan Kirim justru ada di luar
  layar. Kolom kanan mengambil sisanya (bukan lebar tetap seperti panel Kalender: isinya tabel
  berkolom lima). Di bawah 1180px keduanya bertumpuk.
- **Kotak centang jadi saklar** — `<Switch>`, satu bentuk untuk seluruh dashboard, rupanya dibagi
  dengan saklar campaign lewat selektor CSS yang sama. Yang TIDAK ikut berpindah adalah centang yang
  MEMILIH baris atau nilai; lihat CLAUDE.md.
- **Keterangan tiap field di balik ikon info**, bukan baris teks di bawah kotaknya: satu form memuat
  sampai tiga puluh field, dan keterangan yang digambar semua sekaligus jadi dinding teks yang
  memisahkan tiap kotak dari kotak berikutnya sejauh dua baris. Yang tetap teks adalah yang
  BERUBAH-UBAH — hitungan kata kunci, umur bacaan.
- **Bawaan form diisi saat SKEMANYA datang, bukan saat komponennya lahir.** Skema datang dari
  `GET /plugin/schema` sesudah render pertama; dihitung di situ, form lahir kosong dan tidak pernah
  terisi — dan yang terkirim ke AI adalah `bahasa: ""`, karena bawaan sisi server hanya berlaku
  untuk field yang tidak ada di body.

### Sesudah Kirim: yang berhasil dibuang, yang ditolak tinggal

Kotak "Daftar kata kunci" berubah sendiri begitu jawabannya datang — kata kunci yang job-nya lahir
dihapus, yang ditolak dibiarkan berdiri. Yang tersisa jadi daftar untuk dikirim ulang: perbaiki
sebabnya (kuota AI, kategori) lalu tekan Kirim lagi, tanpa mengetik ulang dan — yang lebih penting —
tanpa harus MENGINGAT baris mana saja yang tadi gagal.

Itu bukan kenyamanan melainkan penjagaan: **AutoPost tidak punya dedup**, jadi menekan Kirim untuk
daftar yang isinya tidak berubah menghasilkan artikel kedua untuk tiap kata kunci yang sudah
berhasil.

- **Membuang yang berhasil, bukan mengganti isinya dengan daftar yang gagal.** Pengiriman lima puluh
  kata kunci berlangsung beberapa detik, dan yang diketik orang ke kotak itu selama menunggu akan
  lenyap kalau isinya ditimpa.
- **Dua baris yang cuma berbeda kapitalisasi ikut hilang bersama job-nya** — keduanya memang dikirim
  sebagai satu job.
- **Pengiriman yang GAGAL SEBAGAI SATU PERMINTAAN tidak membuang apa pun.** Yang sampai ke sana
  ditolak sebelum satu job pun dibuat, jadi tidak ada yang boleh hilang dari daftar.
- **Perubahannya diumumkan** di toast dan di peringatan atas tabel job; kotak yang berubah sendiri
  tanpa keterangan terbaca seperti isinya hilang.

### Job: dibaca saat dibuka, tidak pernah dicerminkan

Sepola dengan panel ad set dan tab DNS Record — yang dicari orang adalah keadaan pada detik ini, dan
cermin sejam lalu justru jawaban yang salah. Ditambah satu yang khusus: **masa simpan job di sisi
plugin cuma 24 jam**, jadi mencerminkannya berarti dashboard menyimpan riwayat yang sumbernya sudah
tidak ada untuk dibandingkan.

- **`GET /autopost/jobs` TIDAK lewat `withMirror`** — satu-satunya pembacaan plugin yang begitu. Ia
  di-poll tiap beberapa detik; lewat cermin, satu tab yang dibiarkan terbuka menulis ke
  `pluginSites` setiap tiga detik, ke node yang dilanggan halaman itu sendiri.
- **Polling berhenti sendiri** begitu tidak ada job berjalan (`nextPollDelay`), dan jedanya melebar
  3 → 15 detik. Tahap terpanjang menunggu jawaban AI sampai dua menit tanpa satu pun perubahan yang
  terbaca, dan bertanya empat puluh kali selama itu adalah empat puluh permintaan ke shared hosting
  yang sedang menulis artikel. Job yang mati tanpa kabar tetap berakhir — plugin memindahkannya ke
  `stalled` sendiri setelah `stale_seconds` — jadi polling ini punya ujung walau tidak ada satu pun
  job yang selesai dengan benar.
- **Log ditarik saat barisnya DIBUKA**, tidak ikut daftarnya. `/jobs` tanpa `include_logs` mengganti
  `logs` dengan `log_count`; satu job yang berjalan lima menit menumpuk puluhan baris, dan
  menariknya ulang tiap tiga detik untuk dua puluh job memindahkan ratusan kilobyte demi satu kolom
  persentase yang bergerak.
- **`stalled` tidak dilebur ke "Gagal".** Keduanya `status: "failed"` di sisi plugin tapi menuntut
  tindakan yang berbeda: gagal biasa punya sebab yang tertulis dan bisa diperbaiki (kunci AI,
  kuota, kategori), sementara `stalled` berarti proses PHP-nya dibunuh server — tidak ada yang salah
  dengan permintaannya, dan yang perlu dilakukan cuma mengirimnya lagi. Dilebur, orang akan
  memeriksa kunci AI yang tidak pernah bermasalah.
- **`source` dibedakan.** Job dari dashboard (`rest`) dan dari wp-admin situs (`admin`) berbagi
  penyimpanan yang sama, jadi tanpa penanda ini panel akan terbaca seolah dashboard membuat job yang
  tidak pernah dikirimnya.
- **Yang ditolak sebelum jadi job berdiri TERPISAH** dari daftar job. Job yang lahir punya `job_id`
  dan bisa dipantau; yang ditolak tidak ada di sisi situs sama sekali — dicampur, satu daftar akan
  memuat baris yang tidak akan pernah berubah statusnya.

### Kata kunci: `requested` dan `total` dibawa keduanya

`POST /autopost/keywords` **sinkron** (5–20 detik, batas tunggunya sendiri 90 detik — memutus
koneksi berarti membayar panggilan AI yang hasilnya dibuang, lalu orang yang melihat kegagalannya
menekannya lagi dan membayarnya dua kali). AI kerap mengembalikan **lebih sedikit** dari yang
diminta, dan daftar 13 baris untuk 20 yang diminta tampak lengkap — jadi selisihnya disebutkan di
layar alih-alih disembunyikan, dan hasilnya **ditambahkan** ke daftar yang sudah ada, bukan
menimpanya: tiap panggilan ditagihkan, dan daftar yang ditimpa berarti hasil yang sudah dibayar
hilang karena seseorang menekan tombolnya sekali lagi.

## Siklus ping

Cron `PLUGIN_CRON` (bawaan tiap 30 menit) mem-ping tiap situs yang enroll dan menulis yang tidak
menjawab ke `dashboard/syncIssues/plugin` — ikon peringatan di topbar membacanya.

Jauh lebih jarang dari gating (dua menit) dengan sengaja: yang dijaganya bukan keadaan yang berubah
cepat — sebuah situs WordPress tidak mati lalu hidup lagi dalam dua menit — melainkan **enrollment
yang hilang di sisi situs**. Sejak itu terjadi, tidak ada satu pun tombol di halaman ini yang
bekerja untuk situs itu, dan tidak ada yang menyadarinya sampai seseorang mencoba mengubah
pengaturan.

Yang belum enroll dilewati diam-diam, alasan yang sama dengan `earningAccounts` melewati akun tanpa
alamat API: belum pernah dihubungkan bukan kegagalan, dan menjadikannya isu akan mengisi daftar
dengan baris yang tidak bisa diperbaiki siapa pun.

## Endpoint server kontrol

Semua butuh `Authorization: Bearer <Firebase ID token>` dan role **superadmin**.

| | |
|---|---|
| `GET /plugin/schema` | definisi field — satu-satunya, dipakai server & browser |
| `POST /plugin/sites/:id/enroll` | enroll satu situs, simpan kuncinya |
| `POST /plugin/sites/:id/reset` | lepas enrollment (rotasi kunci) |
| `POST /plugin/sites/:id/ping` | POST walau membaca — ia menulis cermin status |
| `GET/POST /plugin/sites/:id/config/:group` | `ads-settings` / `header-footer` / `behaviour` / `cmp` / `security` |
| `GET /plugin/sites/:id/landings` | daftar landing |
| `GET /plugin/sites/:id/landings/:landingId` | satu landing, baris penuh |
| `POST /plugin/sites/:id/landings` | create (tanpa `id`) atau update (dengan `id`) |
| `POST /plugin/sites/:id/autopost/keywords` | body `{ aiKey, values }` — sinkron, 90 dtk |
| `POST /plugin/sites/:id/autopost` | body `{ aiKey, keywords[], values }` — SELALU 200, hasil per kata kunci |
| `GET /plugin/sites/:id/autopost/jobs` | daftar job; **tidak menyentuh cermin RTDB** |
| `GET /plugin/sites/:id/autopost/job/:jobId` | satu job berikut lognya |
| `POST /plugin/bulk/enroll` | body `{ siteIds }` |
| `POST /plugin/bulk/config/:group` | body `{ siteIds, values }` |
| `POST /plugin/sync` | satu siklus ping atas permintaan |

Kegagalan **di situs** selalu keluar sebagai **502** berikut field `code`, tidak pernah sebagai
kode aslinya. `invalid_key` (401 dari WordPress) yang diteruskan apa adanya akan dibaca browser
sebagai "token Firebase-mu kedaluwarsa", dan orangnya disuruh login ulang untuk situs yang kuncinya
bermasalah. **422** disisakan untuk yang ditolak sebelum menyentuh jaringan — itu yang bisa
diperbaiki orangnya sendiri di form yang sedang terbuka.

Endpoint massal **selalu 200**, hasilnya per situs. Satu situs yang gagal tidak menghentikan
sisanya: kegagalan yang menjatuhkan seluruh batch meninggalkan armada setengah berubah tanpa catatan
bagian mana yang sudah, dan yang mengulanginya akan menulis ulang situs yang sudah benar sambil
tetap melewatkan yang gagal.

## Memasang

**Aturan database dulu, sebelum ada yang menekan Enroll.** `pluginSites` dan `pluginKeys` adalah
node baru: sebelum aturannya di-deploy, tulisan ke sana ditolak default-deny. Enroll akan
menghubungi situsnya (yang berhasil, dan enrollment itu sekali seumur hidup) lalu gagal menyimpan
kuncinya. `enrollOne` membatalkan enrollment-nya sendiri kalau itu terjadi — tapi pembatalan itu
juga bisa gagal, dan yang tertinggal adalah situs yang cuma bisa dipulihkan dari WordPress-nya.

1. `npm run deploy:rules` — **pertama**.
2. `PLUGIN_ENROLL_TOKEN` di `server/.env` di host, lalu restart server kontrol.
3. Pastikan `GET /plugin/schema` menjawab 401 (bukan 404) — 404 berarti server masih memakai build
   lama dan halaman akan bilang "Skema pengaturan gagal diambil dari server: Endpoint tidak ada."
4. `VITE_CONTROL_API_URL` sudah di-set (dipakai bersama gating), lalu build + deploy hosting —
   nilainya ikut masuk ke bundle saat build.
5. Buka `/plugin` sebagai superadmin, **enroll satu situs sepi dulu**, simpan satu pengaturan, dan
   pastikan ia benar-benar berubah sebelum menjalankan apa pun secara massal.

```bash
curl -s https://dashboard-api.adsgo.live/livez        # server kontrol hidup
cd server && bun test plugin.test.mjs          # tanpa jaringan
cd functions && node --test plugin-core.test.mjs autopost-core.test.mjs
```


## Tab AdX (`/plugin/adx`)

Tab AdX halaman Plugin menulis tag Google Ad Manager ke beberapa subdomain sekaligus, tanpa menempel
kode apa pun. Aturan lengkapnya di CLAUDE.md ("Tab AdX"). Alamat lamanya `/plugin/inject-kode` dialihkan ke sini; ringkasan alurnya:

1. **Pilih subdomain.** Server mencari akun GAM-nya di /gam-accounts (lewat domain induk).
2. **Network & slot iklan** tampil per network: Network Code, Properti (Publisher ID), akun GAM, dan
   daftar unit iklan aktif yang dibaca langsung dari Ad Manager API. Bawaannya unit **Ad Exchange
   Display** (`/NETWORK/ca-pub-…-tag`); unit lain di network yang sama bisa dipilih.
3. **Slot & ukuran**: jumlah slot (1–5) dan template ukuran — bawaan (Semua ukuran Ad Manager, Mobile,
   Display standar, Rectangle), ukuran unit terpilih dari Ad Manager, atau template tersimpan
   (`dashboard/gptSizeTemplates`). **Generate kode** menampilkan pratinjau untuk satu subdomain.
4. **Periksa dulu → Inject.** Periksa dulu membaca header dan kode iklan tiap situs dan melaporkan apa
   yang akan diganti tanpa menulis.

Yang ditulis ke tiap situs:

| Field plugin | Isi |
|---|---|
| Header & Footer → `header_code` | blok GPT persis bentuk tag Ad Manager (tanpa komentar penanda), menggantikan blok GPT lama; isi header lain dipertahankan |
| Iklan → `kode_iklan_1` … `kode_iklan_N` | body slot ke-1 … ke-N (`div-gpt-ad-{stempel waktu}-0` … `-(N-1)`, stempel BERBEDA per subdomain, dari pratinjau) |
| Iklan → `kode_iklan_(N+1)` … `kode_iklan_5` | dikosongkan hanya kalau isinya kode GPT (`googletag.display`) |
| Iklan → `jumlah_iklan` | N, selalu |

Route server kontrol (superadmin): `POST /plugin/gpt/networks` (`{ siteIds }`),
`POST /plugin/gpt/preview` (`{ siteIds, options, adUnitCodes? }` → `{ sites: [{ subdomainId, name, divStamp, adUnitPath, header, bodies, error }] }`), dan `POST /plugin/bulk/gpt-inject`
(`{ siteIds, options, adUnitCodes?, dryRun? }`, selalu 200 dengan hasil per situs dan
`detail.headerMode` = `replaced` | `appended`). `options` = `{ sizes, slots, divStamps? }`.

## Tab AdSense (`/plugin/adsense`)

Kode AdSense **ditempel**, tidak disusun. Slot AdSense (`data-ad-slot`) cuma lahir dari halaman
AdSense: AdSense Management API v2 bisa **membaca** ad unit (`adunits.list`, `getAdcode`), tapi
`adunits.create` hanya untuk project AdSense for Platforms — dan kredensial kita ber-scope
`adsense.readonly`. Diperiksa ke API produksi 14 Sep 2026.

1. **Pilih subdomain** — hanya yang terdaftar di daftar Situs salah satu akun /adsense-accounts
   (`GET /plugin/adsense/sites`). Form tiap subdomain terisi dari kode yang terakhir di-inject ke sana
   (`dashboard/adsenseSlots/{subdomainId}`).
2. **Tempel kode unit** dari AdSense → Iklan → Menurut unit iklan → Dapatkan kode, satu unit per
   kotak. Kode tiap subdomain berdiri sendiri; "Salin ke semua subdomain" untuk yang berbagi unit.
3. **Periksa kode.** Server mengurai tiap kotak dengan daftar putih (loader `adsbygoogle.js`, satu
   `<ins class="adsbygoogle">`, `push({})` — script lain ditolak), lalu mencocokkan slotnya dengan ad
   unit akun AdSense itu. Kredensialnya dicari lewat Publisher ID di /adsense-accounts, lalu
   /gam-accounts. Slot yang tidak ada di akun yang terbaca **ditolak**; akun yang tidak bisa dibaca
   sama sekali **tidak ditolak**, disebut "belum terverifikasi". Domain yang tidak ada di daftar
   Situs akun itu disebut sebagai peringatan.
4. **Periksa dulu → Inject.** Yang berhasil ditulis disimpan sebagai kode subdomain itu.

| Field plugin | Isi |
|---|---|
| Header & Footer → `header_code` | **tidak disentuh** |
| Iklan → `kode_iklan_1` … `kode_iklan_N` | kode yang ditempel, apa adanya |
| Iklan → `kode_iklan_(N+1)` … `kode_iklan_5` | dikosongkan hanya kalau isinya kode AdSense atau GPT |
| Iklan → `jumlah_iklan` | N, selalu |

Route: `POST /plugin/adsense/check` (`{ siteId, codes[] }`) dan `POST /plugin/bulk/adsense-inject`
(`{ items: [{ siteId, codes[] }], dryRun? }`, selalu 200 dengan hasil per situs).
