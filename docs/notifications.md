# Notification Center

Satu halaman (`/notifications`, sidebar **Notifikasi**) yang menjawab satu pertanyaan: **siapa
menerima notifikasi apa** — dan sejak ambang peringatan ROI ikut pindah ke sini, **kapan** juga.

| Tab | Alamat | Isi |
|---|---|---|
| Orang | `/notifications` | semua penerima: anggota tim, orang luar, dan grup |
| Topik | `/notifications/topik` | saklar induk tiap topik, siaran per role, jumlah penerima |
| Peringatan ROI | `/notifications/peringatan` | ambang yang menentukan ROI mana yang berbunyi |

Tab-nya **route sungguhan**, sepola dengan Overview (lihat CLAUDE.md): tombol Back, tautan yang
dibagikan, dan halaman tambah/sunting di bawahnya bekerja seperti halaman lain. Induknya "Orang"
karena yang paling sering membukanya adalah PIC yang mencari barisnya sendiri.

Grup **tidak punya tab sendiri**: pertanyaan yang dibawa orang ke halaman ini cuma satu ("siapa saja
yang dikirimi"), dan jawabannya yang dipecah dua daftar menuntut orang membuka dua tempat untuk tahu
kenapa sebuah pesan tidak sampai. Baris grup berdiri di daftar yang sama, dibedakan lencana **Jenis**
yang dibaca dari tanda chat id-nya sendiri — Telegram memberi grup dan channel id negatif, chat
pribadi positif.

Yang diubah lewat **halaman sendiri**, bukan saklar di dalam tabel:

```text
/notifications/orang/{id}/edit     chat id + topik satu ANGGOTA TIM (admin, atau orangnya sendiri)
/notifications/kontak/new          tambah penerima non-tim: orang luar atau grup   (admin)
/notifications/kontak/{id}/edit    ubah / hapus penerima non-tim                   (admin)
```

Tabel yang saklarnya bisa ditekan langsung memang lebih pendek satu klik, tapi ia menulis ke
database tiap kali kursor tergelincir satu baris — dan di daftar setinggi seluruh tim, baris yang
salah tersentuh tidak meninggalkan tanda apa pun di layar. Tab **Topik** tetap diubah di tabelnya:
yang di sana setelan, bukan baris. Tidak ada `/notifications/orang/new` — baris ANGGOTA TIM lahir di
halaman Team bersama akun loginnya; yang bukan anggota tim lewat `/notifications/kontak/new`.

Sebelumnya jawabannya satu kotak teks di `/settings?tab=telegram` berisi semua chat id dipisah koma.
Yang salah dengan kotak itu bukan bentuknya melainkan akibatnya: tiap id di dalamnya menerima
segalanya — pengingat tagihan, peringatan ROI subdomain orang lain — dan satu-satunya cara berhenti
menerima satu jenis pesan adalah dihapus dari daftar, yang menghentikan jenis yang lain juga.
Notifikasi yang tidak bisa disaring akan dibisukan orang, dan yang ikut terbisukan adalah yang
benar-benar penting.

Tab itu **sudah tidak ada**. Dua alamat lama dialihkan (`replace`, di `main.jsx`):

```text
/settings?tab=telegram    -> /notifications
/settings?tab=peringatan  -> /notifications/peringatan
```

Ambang peringatan ROI ikut pindah karena ia menjawab setengah dari satu pertanyaan: Settings
menjawab "berapa ambangnya", halaman ini menjawab "siapa yang dikabari", dan yang benar-benar
ditanyakan orang adalah keduanya sekaligus. Selama keduanya berjauhan, ambang yang menyala tanpa
penerima (dan sebaliknya) adalah keadaan yang tidak terlihat di layar mana pun. Aturan penilaiannya
tidak ikut pindah — ia tetap di [`functions/alerts-core.js`](../functions/alerts-core.js).

## Topik

| Kunci | Judul | Pengirim | Irama |
|---|---|---|---|
| `reminders` | Pengingat jatuh tempo | `scheduledReminders` | sekali sehari, 08:00 WIB |
| `roiAlerts` | Peringatan ROI | tahap "Peringatan ROI" di `scheduledSync` | sekali sehari per subdomain |
| `syncIssues` | Kegagalan sync | tahap "Notifikasi kegagalan sync" di `scheduledSync` | sekali sehari per (cabang + target) |

Menambah topik = satu baris di [`src/lib/notifications.js`](../src/lib/notifications.js), satu baris
yang **sama** di [`functions/notifications-core.js`](../functions/notifications-core.js), satu
pengirim yang memanggilnya, dan satu kunci lagi di regex `database.rules.json`. Kunci topik itulah
yang tersimpan di `users/{id}/notificationTopics` — salah ketik berarti saklar yang ditekan orang
tidak pernah dibaca pengirim mana pun.

`syncIssues` membaca `dashboard/syncIssues` **apa adanya** — daftar yang sama persis dengan ikon
peringatan di topbar, bukan daftar kedua. Ikon itu hanya menyala untuk orang yang sedang membuka
dashboard; laporan GAM yang gagal pada run pukul 02:00 berarti earning belasan subdomain kosong
sampai ada yang kebetulan membuka tab.

### Asal masalah, dan kabar pulih

Pesannya dikelompokkan per **asal masalah**, bukan per cabang sync (`issueCause` di
[`functions/notifications-core.js`](../functions/notifications-core.js)):

| Golongan | Dikenali dari | Yang dibaca penerimanya |
|---|---|---|
| Perlu diperiksa orang | `401`/`403`, `Invalid Credentials`, `#190`, `#200`, `#100-33`, scope/izin kurang, setelan belum diisi | sisi kita — tidak akan pulih sendiri |
| Gangguan di sisi penyedia | `5xx`, `429`, timeout, `fetch failed`, balasan non-JSON, `database connection` | sisi mereka — dicoba ulang otomatis |
| Belum bisa dipastikan | sisanya | perlu dilihat orang |

Golongan ketiga bukan basa-basi: menebak "ini sisi mereka" untuk pesan yang tidak dikenali membuat
orang **menunggu** sesuatu yang tidak akan pernah pulih sendiri. Sepola dengan `earningKnown` — yang
tidak diketahui disebut apa adanya. Status HTTP dibaca dari bentuk yang benar-benar ditulis pelempar
errornya (`-> 503:`, `(HTTP 502)`), bukan dari angka tiga digit di mana pun dalam teks: `act_5031`
juga tiga digit, dan salah bacanya bukan pesan yang aneh melainkan pesan yang percaya diri menyebut
golongan yang salah.

Aturan penggolongan ini **dicerminkan** ke [`src/lib/syncIssueCause.js`](../src/lib/syncIssueCause.js),
sepola dengan `dueReminders` dan `campaignCommandEntry`, karena panel isu sync di topbar memakai
penggolongan yang sama — judul golongan, keterangannya, dan kalimat manusia per baris, dengan pesan
API-nya di balik "Detail teknis". Selama panel itu masih menampilkan pesan API apa adanya, aturan ini
sengaja tidak dicerminkan (salinan kedua yang tidak dipakai siapa pun tidak akan pernah ikut
diperbarui); sejak ia menampilkannya, yang berbahaya justru kebalikannya — layar dan chat yang
menyebut golongan berbeda untuk isu yang sama, dan yang dipercaya orang adalah yang lebih
menenangkan. Dijaga `src/lib/syncIssueCause.test.mjs`, yang membandingkan teks aturannya dengan
berkas di seberang. Yang **tidak** ikut dicerminkan adalah penyusun pesannya (`syncIssueMessage`):
bentuk chat dan bentuk panel memang berbeda, dan yang harus sama cuma penggolongannya.

**Yang pulih ikut dikabarkan** (`recoveredNotices` + `syncRecoveryMessage`). Kabar gagal tanpa kabar
pulih membuat penerimanya menyimpan kecemasan yang tidak punya ujung: pesan terakhir yang ia baca
berbunyi "earning enam subdomain kosong", dan satu-satunya cara mengetahui itu sudah beres adalah
membuka dashboard — persis langkah yang notifikasi ini ada untuk menghapusnya. Hanya untuk yang
**pernah dikabarkan gagal**; pemulihan atas sesuatu yang tidak pernah diberitahukan cuma pesan
tambahan.

Penandanya menumpang `dashboard/syncIssueNotices` yang sama, yang bentuknya berubah dari teks tanggal
jadi `{ day, state, label, target }` (penanda lama tetap dibaca sebagai `failed`). `label`/`target`
ikut disimpan karena baris yang pulih **sudah tidak ada lagi** di daftar isu — pesan yang cuma bisa
menyebut `gamAccounts__Massequality` menyuruh orang menerjemahkan kunci database sendiri.
Batasnya **dua pesan per target per hari**: satu gagal, satu pulih. Akun yang berkedip tiap jam kalau
tidak akan mengirim dua puluh empat pesan sehari, dan chat yang begitu dibisukan orang bersama
pengingat jatuh tempo yang datang dari bot yang sama.

## Siapa yang menerima

Tiga sumber, dan ketiganya digabung `topicRecipients`:

```text
users/{id}.telegramChatId + .notificationTopics   -> orang, saklar per topik
notificationGroups/{id}.topics                    -> grup Telegram / chat lain
settings/notifications/{topik}.roles              -> siaran per role
```

Urutan keputusannya untuk satu orang:

1. `notificationTopics[topik] === true` → ikut, titik.
2. `notificationTopics[topik] === false` → **tidak** ikut, walau role-nya disiarkan.
3. belum pernah disentuh → ikut kalau role-nya ada di siaran topik itu.

Itu yang membuat siaran per role bisa dipakai tanpa menyandera siapa pun: "semua keuangan" tetap
berarti semua keuangan, dan satu orang di dalamnya tetap bisa membisukan dirinya sendiri.

- **Satu saklar, dua tangan.** Saklar yang ditekan admin dan yang ditekan orangnya sendiri adalah
  saklar yang SAMA (`users/{id}/notificationTopics`). Dua kolom terpisah ("ditugaskan admin" vs
  "diminta sendiri") akan menuntut aturan siapa-menang, dan tiap aturan begitu punya sisi di mana
  seseorang menekan saklar lalu tidak terjadi apa-apa. Siapa yang menekan terakhir tercatat di
  Activity Logs.
- **Yang belum punya `telegramChatId` dilewati diam-diam.** Belum pernah mengisi chat id bukan
  kegagalan, dan halamannya sudah menyebutkannya di kolomnya sendiri.
- **Baris yang diarsipkan (`deletedAt`) dilewati.** Mengarsipkan orang mencabut aksesnya ke
  dashboard; notifikasi yang tetap mengalir ke mantan anggota tim adalah bocoran yang tidak terlihat
  di layar mana pun.
- **Hasilnya di-dedupe per chat id** — ikut lewat role sekaligus lewat saklarnya sendiri, atau grup
  yang chat id-nya sama dengan seseorang, tetap satu pesan.
- **Peringatan ROI DISARING per PIC; dua topik lain tidak.** Admin dan superadmin menerima seluruh
  armada; sisanya menerima baris yang `pic`-nya dirinya sendiri (dicocokkan longgar ke nama,
  username, dan email — `subDomains.pic` diketik orang dan bentuknya berbeda-beda menurut umur
  datanya). Alasannya bukan teknis: pengingat jatuh tempo dan kegagalan sync berlaku untuk seluruh
  usaha, sementara peringatan ROI berlaku untuk SATU subdomain dan yang bisa menindaklanjutinya cuma
  orang yang memegangnya. Dikirim utuh ke semua orang, tiap advertiser membaca dua puluh baris untuk
  menemukan satu barisnya — dan pesan yang harus disaring sendiri tiap pagi adalah pesan yang
  berhenti dibuka.
  - Satu pesan per penerima, isinya menyesuaikan lingkupnya. Yang lingkupnya kosong dilewati **tanpa
    pesan**, bukan dikirimi pesan kosong.
  - Baris ROI **tanpa `pic`** hanya sampai ke penerima berlingkup penuh: tidak ada yang mengklaimnya.
  - Penanda harian ditulis per BARIS yang benar-benar terkirim — peringatan yang cuma masuk ke pesan
    yang gagal tetap "belum dikabarkan" walau pesan penerima lain di run yang sama berhasil.
- **Peringatan ROI punya SATU saklar, dan itu saklar topiknya.** Kolom Aktif di tab Topik adalah
  on/off-nya; tab Peringatan ROI cuma memuat angkanya (`settings/alerts`). `runAlerts` menimpa
  `settings/alerts.enabled` yang tersimpan dengan nilai topik itu — baris lama membawa `false` dari
  zaman form yang punya kotak "Nyalakan peringatan", dan membacanya berarti saklar yang sudah tidak
  ada di layar mana pun tetap menahan seluruh fitur. Yang menahannya supaya tidak berbunyi puluhan
  kali pada jam pertama setelah deploy adalah daftar penerimanya, sama seperti dua topik lain.
- **Saklar induk tiap topik bawaannya NYALA** — kebalikan dari ambang peringatan ROI
  (`DEFAULT_ALERTS.enabled: false`). Yang menentukan ada tidaknya kiriman adalah daftar penerima,
  dan daftar kosong tidak mengirim ke mana pun; bawaan mati cuma akan menghentikan pengingat yang
  selama ini jalan, diam-diam, pada hari fitur ini di-deploy.

## Izin

| Bagian | Siapa | Ditegakkan oleh |
|---|---|---|
| Membuka halaman | semua akun yang login | — (tidak ada `key` di daftar terbatas) |
| Saklar & chat id **sendiri** | orangnya sendiri, dan admin | `users/$uid/notificationTopics`, `users/$uid/telegramChatId` (cocok lewat email) |
| Saklar orang lain | admin | aturan yang sama |
| Setelan topik, siaran role, ambang ROI | admin | `settings` (`.write` admin) |
| Grup | admin | `notificationGroups` (`.read` semua, `.write` admin) |

Pencocokan lewat **email** dan bukan uid karena `/users` dikunci push key — persis alasan yang sama
dengan `users/$uid/campaignCommands` (lihat [roles-and-access.md](roles-and-access.md)).

Chat id grup dibaca semua akun yang login dan itu disengaja: kolom "Penerima" yang menyembunyikan
grup akan menjawab "tidak ada" untuk topik yang sebenarnya sedang mengalir ke chat tim. Chat id
tidak membuka apa pun tanpa token botnya, yang tinggal di secret Cloud Functions.

## Penerima di luar tim, dan chat lama

Tidak semua yang perlu dikabari punya baris di Team: pemilik, akuntan, teknisi yang dipanggil saat
sync tumbang. **Tambah Penerima** di tab Orang menerima keduanya — chat pribadi (`6374611345`)
maupun grup/channel (`-1002223334445`) — jadi orang luar bisa jadi tujuan tanpa harus dibuatkan akun
dashboard berikut role-nya. Lencana **Jenis** dibaca dari tanda id-nya sendiri, bukan dari kolom yang
harus diisi orang.

Baris non-tim punya satu kotak yang tidak dimiliki anggota tim: **Lingkup Peringatan ROI**. Ia tidak
punya role dan tidak memegang subdomain, jadi tidak ada yang bisa disimpulkan sendiri — kosong
berarti seluruh armada, dan diisi nama PIC berarti subdomain milik orang itu saja.

Chat id peninggalan `settings/telegram/chatIds` **tidak dibaca satu baris kode pun lagi** — tidak
oleh frontend, tidak oleh `functions/`. Tidak ada pemindahan otomatis: buka Firebase Console
(`settings/telegram/chatIds`), lalu daftarkan ulang tiap id lewat **Tambah Penerima**. Node lamanya
dibiarkan berdiri apa adanya: yang dihapus tidak bisa dibaca kembali oleh siapa pun yang perlu tahu
chat mana saja yang dulu menerima.

Cara mengetahui satu id itu milik siapa (butuh token bot):

```bash
curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getChat?chat_id=6374611345"
```

## Calon Penerima: chat terdeteksi sendiri, aktivasi satu klik

Telegram tidak punya cara menemukan chat id selain dari pesan masuk: id sebuah chat baru terbit
setelah ada yang menyapa botnya. Yang berubah bukan kenyataan itu, melainkan siapa yang harus
mengerjakannya.

Dulu: orangnya kirim `/start`, seseorang membuka terminal untuk `npm run telegram:chat-id`, menyalin
angka 10 digit dari layar, dan mengetiknya kembali di **Tambah Penerima**. Langkah ketiga itu
satu-satunya di seluruh dashboard yang salah ketiknya **tidak mengeluh di mana pun** — chat id yang
meleset satu digit tetap berbentuk angka, lolos `groupComplaint`, tersimpan rapi, dan gagal
diam-diam tiap kali dikirimi.

Sekarang: orangnya kirim `/start`, dan dalam semenit barisnya berdiri di tab **Calon Penerima**
(`/notifications/calon`), lengkap dengan tombol **Aktifkan**. Tidak ada angka yang disalin.

Ia berdiri sebagai TAB dan bukan panel di atas daftar Orang — sempat begitu — karena isinya antrean:
kosong hampir sepanjang waktu, dan habis begitu dikerjakan. Panel kosong tepat di atas tabel yang
justru dicari orang cuma mendorong tabel itu turun tiap kali halaman dibuka. Yang menggantikan
sinyal "ada yang menunggu" adalah **lencana angka** di kepala tab-nya; tanpa lencana itu, pemindahan
ini menukar panel yang mengganggu dengan antrean yang tidak pernah dilihat siapa pun. Batas yang
tersisa: lencananya baru terbaca setelah halaman Notifikasi dibuka, bukan dari sidebar.

Tab ini **admin saja**, dan satu-satunya di halaman ini yang begitu — `key: "telegramInbox"`, yang
duduk di `ADMIN_ONLY_RESOURCES`. Yang dijaga bukan setelan kita melainkan identitas orang luar: nama
profil dan @username setiap orang yang pernah menyapa bot publik kita, termasuk yang salah alamat.

| | |
|---|---|
| Yang membaca pesan masuk | `syncTelegramInbox` ([`functions/sync-telegram-inbox.mjs`](../functions/sync-telegram-inbox.mjs)), cron di `server/`, tiap menit |
| Yang disimpan | `dashboard/telegramInbox/chats/{cNNN}` — id, jenis, nama, username. **Bukan** isi pesannya |
| Yang menampilkan | tab Calon Penerima, `pendingChats` di [`src/lib/telegramInbox.js`](../src/lib/telegramInbox.js) |
| Aturannya | [`functions/telegram-inbox-core.js`](../functions/telegram-inbox-core.js) + cerminannya di `src/lib/telegramInbox.js` |

### Terdeteksi bukan berarti aktif

`@rabbitroi_bot` adalah bot **publik**: siapa pun yang tahu namanya bisa mengirim `/start`, dan tidak
ada cara memberi tahu Telegram bahwa hanya orang tertentu yang boleh. Karena itu baris yang lahir di
sini berhenti sebagai **tawaran** — ia tidak menerima apa pun sampai ada admin yang menekan Aktifkan.

Klik itu tidak boleh dihapus. `contactAlertScope` membaca `pic` kosong sebagai "semua", jadi penerima
yang lahir aktif sendiri menerima peringatan ROI **seluruh armada**: nama subdomain, spend, dan
earning tiap orang — kebocoran yang bentuknya persis seperti fitur yang bekerja.

Aktifkan menulis baris `notificationGroups` biasa dengan **ketiga topik menyala** dan lingkup penuh;
persempit lewat **Kelola** sesudahnya. **Abaikan** menandai `dismissedAt` — barisnya tetap berdiri,
karena yang dihapus akan lahir lagi utuh pada sapaan berikutnya.

### Yang tidak disimpan sebagai status

"Sudah jadi penerima" **dihitung** tiap kali dari daftar penerima yang sedang berlaku, bukan ditulis
sebagai kolom. Sebuah kolom status akan benar pada detik ia ditulis dan basi sesudahnya — penerima
yang dihapus meninggalkan baris inbox yang selamanya mengaku "sudah terdaftar". Penerima yang
**diarsipkan** tetap dihitung terdaftar: mengeluarkan orang adalah tindakan sengaja, dan daftar ini
tidak boleh menawarkannya kembali tiap kali ia menyapa botnya lagi.

### Bot membalas sekali

Chat yang baru tercatat menerima satu balasan — "menunggu diaktifkan admin", atau "sudah terdaftar"
kalau chat id-nya memang sudah jadi penerima (didaftarkan tangan sebelum fitur ini ada). Sebelumnya
yang mengirim `/start` mendapat kesenyapan total dan harus menebak apakah botnya bekerja; yang paling
sering terjadi berikutnya adalah ia mengirim `/start` tiga kali lagi.

Barisnya ditulis **dulu**, sapaannya sesudahnya: dibalik, tulisan yang gagal berarti tiap siklus
menyapa orang yang sama lagi.

### Offset: siklus ini mengkonsumsi

`getUpdates` dipanggil dengan `offset`, dan Telegram **menghapus** update di bawahnya. Itu disengaja
— tanpanya, satu chat yang mengirim 100 pesan menutupi `/start` semua orang lain sampai antreannya
kedaluwarsa sendiri (Telegram mengembalikan yang tertua lebih dulu, maksimal 100 per panggilan).

Konsekuensinya: **`getUpdates` telanjang dari terminal tidak akan melihat apa pun lagi** selama server
jalan. `npm run telegram:chat-id` karena itu sekarang membaca node RTDB di atas, bukan Telegram:

```bash
cd functions
npm run telegram:chat-id                    # chat + status (penerima / menunggu / diabaikan)
npm run telegram:chat-id -- --test 12345    # kirim pesan uji ke satu chat
```

Urutan tulisnya: baris → offset → sapaan. Offset yang maju duluan berarti update-nya sudah dihapus
Telegram sementara barisnya belum ditulis — chat itu hilang selamanya, dan orangnya menunggu
aktivasi yang tidak ada di daftar siapa pun.

### Menambah manual tetap ada

**Tambah Penerima** tidak dihapus. Ia yang dipakai untuk chat yang chat id-nya sudah diketahui dari
tempat lain, dan untuk grup yang botnya sudah lama di dalamnya (bot yang dimasukkan sebelum fitur ini
ada tidak akan pernah memicu `my_chat_member` lagi).

## Deploy

```bash
npm run deploy:rules                                   # aturan users/$uid/*, notificationGroups, settings, dashboard/telegramInbox
firebase deploy --only functions:scheduledSync,functions:scheduledReminders
```

Aturan barunya **wajib** ikut ter-deploy: tanpa itu, saklar yang ditekan orang non-admin ditolak
database, dan halamannya akan tampak seperti tombol yang tidak bekerja. Sejak tab Calon Penerima ada,
aturan `dashboard/telegramInbox` ikut di dalamnya — tanpa itu, siklus server tidak bisa menulis satu
baris pun dan panelnya kosong selamanya.

Tab Calon Penerima juga butuh **`TELEGRAM_BOT_TOKEN` di `server/.env`** — bot yang sama dengan
pengingat, bukan bot kedua. Kosong, hanya pendeteksian yang mati: notifikasi tetap terkirim (token
pengirimnya tinggal di Secret Manager Cloud Functions) dan penerima tetap bisa ditambah lewat Tambah
Penerima.
