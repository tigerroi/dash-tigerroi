# Pengingat jatuh tempo ke Telegram

Reminder yang jatuh tempo tampil di tiga tempat, dan ketiganya membaca daftar yang sama:

| Tempat | Siapa yang melihat | Kapan |
| --- | --- | --- |
| Badge di topbar | **semua akun yang login** | selama ada yang jatuh tempo/terlewat |
| Panel "Pengingat Jatuh Tempo" di Overview | **semua akun yang login** | sama dengan badge |
| Chat Telegram | penerima topik "Pengingat jatuh tempo" di /notifications | sekali sehari, 08:00 WIB |

"Jatuh tempo" berarti: **belum berstatus Selesai**, dan tanggalnya sudah lewat atau tinggal
`REMINDER_LEAD_DAYS` (2) hari lagi. Aturannya ditulis dua kali —
[`src/lib/reminders.js`](../src/lib/reminders.js) untuk badge dan panel,
[`functions/reminders-core.js`](../functions/reminders-core.js) untuk Telegram — karena frontend
dan functions adalah dua paket yang tidak bisa saling impor. Yang satu berubah, yang lain harus
ikut; kalau tidak, badge menyala untuk baris yang tidak pernah dikirim.

## Melihat vs mengubah

Reminder **dibaca siapa pun yang login** (`.read: "auth != null"`), dan **ditulis admin +
keuangan**. Pengingat perpanjangan domain yang cuma terlihat Keuangan tidak menahan siapa pun
selain Keuangan — sementara nominal tagihannya bukan rahasia yang setara isi `expenses`, yang tetap
tertutup. Di UI: `canReadResource` melewatkan `reminders` untuk semua role, `canWrite` tidak
([`src/config/access.js`](../src/config/access.js)), jadi tombol ✓ "tandai selesai" di dialog badge
hanya digambar untuk yang berhak.

## Yang dikirim, dan kenapa tidak dua kali

`scheduledReminders` ([`functions/scheduled-reminders.mjs`](../functions/scheduled-reminders.mjs))
jalan tiap 08:00 WIB, membaca `reminders`, dan mengirim satu pesan berisi semua yang jatuh tempo ke
tiap chat tujuan.

Tanggal kiriman terakhir per reminder disimpan di `dashboard/reminderNotices/{id}`:

- **Sekali sehari, bukan sekali seumur reminder.** Tagihan yang terlewat justru yang paling perlu
  diulang, dan pengingat yang cuma berbunyi di H-2 akan tenggelam di chat pada hari H.
- **Bukan tiap run.** Run yang gagal di tengah diulang Cloud Scheduler; tanpa penanda ini, satu
  gangguan jaringan berarti tim menerima daftar yang sama beberapa kali.
- Penanda ditulis **hanya kalau ada chat yang benar-benar menerima**. Kalau semua gagal, daftarnya
  tetap "belum dikabarkan" dan run berikutnya mencobanya lagi.
- Penanda milik reminder yang selesai/dihapus disapu di run yang sama — kalau tidak, reminder
  tahunan akan membawa penanda basi tahun depan.

Pesannya `parse_mode: HTML`, dan judul/keterangan yang diketik orang di-escape. Bukan Markdown:
satu `_` di "invoice_agustus" membuat Telegram menolak seluruh pesan dengan 400, dan pesan yang
ditolak diam-diam adalah pengingat yang tidak pernah sampai.

## Setup

**1. Token bot** — dari [@BotFather](https://t.me/BotFather). Bot yang dipakai sekarang:
`@rabbitroi_bot`.

```bash
cd functions
firebase functions:secrets:set TELEGRAM_BOT_TOKEN --project rabbitroi-89973
firebase deploy --only functions:scheduledReminders --project rabbitroi-89973
```

Token juga ditaruh di `functions/.env.sync` (di-gitignore) supaya CLI di langkah 2 bisa jalan.
**Jangan** menyimpannya di RTDB: `settings` terbaca setiap akun yang login, dan token bot yang
terbaca semua orang berarti siapa pun bisa mengirim pesan atas nama bot itu.

**2. Chat id** — Telegram tidak punya cara menemukannya selain dari pesan masuk: id sebuah chat
baru terbit setelah ada yang menyapa botnya.

```
Chat pribadi : buka botnya di Telegram, kirim /start
Grup         : masukkan bot ke grup, kirim satu pesan di sana
```

lalu:

```bash
cd functions
npm run telegram:chat-id                    # daftar chat + id-nya
npm run telegram:chat-id -- --test 12345    # kirim pesan uji ke satu chat
```

getUpdates hanya menyimpan update ~24 jam dan tidak bekerja bila bot dipasangi webhook — kalau
daftarnya kosong padahal sudah /start, itu sebabnya.

**3. Pilih penerimanya di dashboard** — halaman **Notifikasi** (`/notifications`), topik "Pengingat
jatuh tempo". Bukan lagi satu kotak berisi semua chat id di Settings: tiap orang punya saklarnya
sendiri, grup punya barisnya sendiri, dan sebuah role bisa disiarkan sekaligus. Diubah tanpa deploy —
siapa yang menerima berubah karena orang masuk/keluar tim. Selengkapnya:
[notifications.md](notifications.md).

Tanpa penerima = tidak ada yang dikirim, dan run-nya mencatat itu di log alih-alih diam.

## Memantau

```bash
firebase functions:log --only scheduledReminders --project rabbitroi-89973
gcloud scheduler jobs run firebase-schedule-scheduledReminders-asia-southeast1 \
  --location asia-southeast1 --project rabbitroi-89973
```

Jadwalnya dibaca saat deploy (`REMINDER_SCHEDULE`, default `0 8 * * *`, zona `SYNC_TIMEZONE`) —
mengubahnya berarti deploy ulang. Hari "hari ini" dihitung dengan `zonedDateKey` (Asia/Jakarta),
bukan jam UTC tempat fungsinya jalan; tanpa itu kiriman pukul 08:00 WIB akan memakai tanggal
kemarin.
