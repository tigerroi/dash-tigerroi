# Sync otomatis tiap jam

`functions/scheduled-sync.js` menjalankan rantai sync lengkap pada jadwal, sebagai **scheduled
Cloud Function**. Tidak butuh backend sendiri, tidak butuh mesin yang menyala terus.

## Kenapa ini lolos DRS padahal callable tidak

DRS memblokir grant IAM `allUsers` — dan itulah yang dibutuhkan sebuah function agar bisa dipanggil
dari browser. Fungsi terjadwal tidak lewat jalan itu: yang memanggilnya **Cloud Scheduler**, dengan
token OIDC milik service agent-nya sendiri, bukan `allUsers`.

**Tapi ada satu syarat yang tetap menyentuh IAM.** Saat deploy, Firebase memberi `roles/run.invoker`
kepada service agent Cloud Scheduler
(`service-<nomor-project>@gcp-sa-cloudscheduler.iam.gserviceaccount.com`). Kalau grant itu ditolak,
deploy berhenti dengan:

```
Unable to set the invoker for the IAM policy on the following functions:
        scheduledSync(asia-southeast1)
```

Dua sebab yang mungkin, dan keduanya perlu dibedakan sebelum diperbaiki:

1. **Akun yang mendeploy tidak punya `roles/functions.admin`** (`functions.developer` tidak boleh
   mengubah kebijakan IAM). Ini yang paling sering, dan perbaikannya menaikkan role akun itu — atau
   memberikan bindingnya sekali secara manual:

   ```bash
   gcloud run services add-iam-policy-binding scheduledsync \
     --region asia-southeast1 --project rabbitroi-89973 \
     --member "serviceAccount:service-<nomor-project>@gcp-sa-cloudscheduler.iam.gserviceaccount.com" \
     --role roles/run.invoker
   ```

   Lewat Console: **Cloud Run → scheduledsync → Security → Permissions**. Nomor project ada di
   **Project settings**.

2. **Org policy `iam.allowedPolicyMemberDomains` (DRS) menolak domain service agent itu.** Kalau
   begitu, tidak ada role setinggi apa pun yang bisa menembusnya — grant-nya sendiri yang dilarang,
   dan jalur Cloud Scheduler tertutup untuk project ini. Pakai alternatif di bagian terakhir dokumen
   ini (cron yang menjalankan CLI), yang tidak butuh IAM binding sama sekali.

**Membedakannya:** picu job-nya dari Cloud Scheduler Console, lalu lihat `firebase functions:log`.
Kalau fungsinya jalan, binding-nya sudah ada dan pesan deploy tadi tidak fatal. Kalau Cloud
Scheduler mencatat hasil `PERMISSION_DENIED`/403 dan log fungsinya tetap kosong, binding-nya
memang tidak pernah terpasang.

Fungsinya sendiri tetap ter-deploy dan `ACTIVE` meski langkah IAM ini gagal — pembuatan function
selesai lebih dulu, jadi kegagalan di sini tidak membatalkan kode yang sudah naik.

## Logikanya tidak diduplikasi

Fungsi ini memanggil modul yang sama persis dengan yang dijalankan CLI:

```
scheduledSync
  → connect()                    client SDK, login sebagai SYNC_USER
  → syncAccounts()               sync-gam.mjs      — GAM per akun adsense
  → syncAdAccounts()             sync-meta.mjs     — saldo & spend hari ini
  → syncCampaigns()              sync-meta.mjs     — campaign, dailySpend, balanceSnapshots
  → syncSubdomains()             sync-subdomains.mjs — ROI subdomain, ROI negara, grafik finansial
```

Hasil sync otomatis dan sync manual karena itu tidak akan pernah berbeda karena jalurnya berbeda.

Tiap tahap dibungkus sendiri-sendiri: token Meta yang mati tidak menjatuhkan laporan GAM. Yang
gagal ditulis ke Cloud Logging beserta alasannya — itu satu-satunya tempat kegagalan sync jam tiga
pagi bisa dilihat, karena tidak ada toast yang dibaca siapa pun.

## Deploy

Butuh Blaze plan (function memanggil API di luar Google) dan tiga secret:

```bash
cd functions
firebase functions:secrets:set META_ACCESS_TOKEN   --project rabbitroi-89973
firebase functions:secrets:set SYNC_USER_EMAIL     --project rabbitroi-89973
firebase functions:secrets:set SYNC_USER_PASSWORD  --project rabbitroi-89973

firebase deploy --only functions:scheduledSync --project rabbitroi-89973
```

`SYNC_USER_*` adalah user Firebase Auth biasa yang sudah ada — sync menulis lewat aturan database
seperti user lain, bukan lewat service account. Sama dengan yang dipakai CLI.

**Deploy hanya fungsi ini**, jangan `--only functions` polos: itu ikut mendeploy callable yang
diblokir DRS dan bisa gagal di langkah IAM-nya.

Memantau dan menguji:

```bash
firebase functions:log --only scheduledSync --project rabbitroi-89973
gcloud scheduler jobs list --location asia-southeast1 --project rabbitroi-89973
gcloud scheduler jobs run firebase-schedule-scheduledSync-asia-southeast1 \
  --location asia-southeast1 --project rabbitroi-89973
```

Tanpa `gcloud` terpasang, job-nya bisa dipicu dari
[Cloud Scheduler Console](https://console.cloud.google.com/cloudscheduler?project=rabbitroi-89973) —
cari `firebase-schedule-scheduledSync-asia-southeast1`, lalu **Force run**.

**Setelah deploy pertama, jadwalnya belum langsung menembak** — Cloud Scheduler menunggu sampai
titik jadwal berikutnya, jadi bisa sampai satu jam sebelum baris pertama muncul. Perintah
`jobs run` di atas memicunya sekarang tanpa menunggu.

Kalau job-nya sudah jalan tapi dashboard tetap menulis "Sync otomatis belum berjalan", berarti run
gagal sebelum sempat menulis apa pun. Hanya ada dua titik seperti itu, dan keduanya menyebut
sendiri apa yang harus diperiksa di log:

- `login SYNC_USER gagal` — secret `SYNC_USER_EMAIL` / `SYNC_USER_PASSWORD` salah atau usernya
  tidak ada di Firebase Auth.
- `tidak bisa menulis ke dashboard/syncStatus` — SYNC_USER belum punya role `admin` di
  `/roles/{uid}`; aturan `dashboard/.write` memang hanya mengizinkan admin.

Keduanya bisa diperiksa dari laptop tanpa menunggu jadwal berikutnya:

```bash
cd functions && npm run role:whoami
```

Ia login sebagai SYNC_USER dengan kredensial di `.env.sync`, lalu menyebutkan email, uid, dan
role-nya. Gagal login = sebab pertama; login berhasil tapi role bukan `admin` = sebab kedua.

> Perhatikan: `.env.sync` di laptop dan secret yang ter-deploy adalah dua salinan berbeda.
> `role:whoami` yang hijau membuktikan akunnya benar, bukan bahwa nilai yang tersimpan di
> Secret Manager sama persis — nilai yang ter-set lewat pipe (`echo ... |`) mudah membawa
> newline di ujungnya dan membuat password tidak cocok. Set ulang lewat prompt interaktif
> kalau ragu.

**Mengganti secret butuh deploy ulang.** `functions:secrets:set` membuat *versi baru*, sementara
fungsi yang sudah jalan menyematkan versi lama (`"version": "1"` di config-nya). Tanpa deploy
ulang, run berikutnya tetap memakai nilai yang lama:

```bash
cd functions
firebase functions:secrets:set SYNC_USER_EMAIL    --project rabbitroi-89973
firebase functions:secrets:set SYNC_USER_PASSWORD --project rabbitroi-89973
firebase deploy --only functions:scheduledSync    --project rabbitroi-89973
```

## Yang terlihat di dashboard

Sync tidak lagi punya tombol. Yang menggantikannya:

- **Topbar** membaca `dashboard/syncStatus`: "Syncing..." selama run berjalan, hitung mundur ke run
  berikutnya di luar itu, dan penanda merah kalau run terakhir gagal.
- **Halaman Settings → Log Sync Otomatis** membaca `dashboard/syncRuns`: satu baris per run, bisa
  dibuka untuk melihat tiap tahap beserta alasan kegagalannya apa adanya. Baris yang gagal terbuka
  sendiri.

Untuk menjalankan sync di luar jadwal, pakai skrip CLI di `functions/` (`npm run sync`,
`npm run sync:meta`, `npm run sync:roi`) — yang hilang hanya tombolnya di UI.

## Jadwal

Default **tiap 60 menit**, zona waktu Asia/Jakarta. Diubah lewat env saat deploy (dibaca ketika
Firebase memuat modulnya untuk menemukan fungsi, bukan saat jalan — jadi ganti jadwal = deploy
ulang):

```bash
SYNC_SCHEDULE="every 4 hours" firebase deploy --only functions:scheduledSync
SYNC_SCHEDULE="0 */2 * * *"   firebase deploy --only functions:scheduledSync   # cron biasa juga bisa
```

## Berapa yang dipakai tiap jam

Per satu kali run:

| Sisi | Per akun | Isinya |
| --- | --- | --- |
| GAM | **4 report job** per network | totals, per-site, site × negara, per-tanggal |
| Meta | **7 panggilan** per ad account | saldo+insights, campaign spend+settings, spend+negara, daily spend |

Tiap jam berarti 24 × angka di atas per hari. Yang menahannya:

- **Meta**: `functions/meta.js` mengantre semua panggilan Graph — satu request pada satu waktu,
  jarak minimum 400 ms, melambat sendiri saat header `x-app-usage` menyentuh 75%, dan mundur
  dengan jeda menaik kalau tetap kena limit.
- **Overlap**: `maxInstances: 1` **dan** `concurrency: 1`. Keduanya perlu — Cloud Functions gen2
  default-nya melayani 80 request bersamaan di dalam satu instance, jadi membatasi jumlah instance
  saja tidak menghalangi dua run bertemu di instance yang sama.
- **Retry**: dimatikan. Sync ini idempoten tapi mahal di kuota, dan run berikutnya tinggal satu jam
  lagi — mengulang kegagalan lebih berisiko daripada melewatkannya.

## Yang perlu disesuaikan untuk jadwal per jam

- **`BALANCE_SNAPSHOT_KEEP`** (default 60) adalah jumlah *baris*, bukan hari. Tiap run menulis satu
  snapshot per ad account, jadi per jam berarti 60 baris ≈ **2,5 hari** riwayat saja. Set ke `720`
  untuk 30 hari, sejalan dengan `BALANCE_HISTORY_DAYS`.
- **Sisi GAM sekarang punya satu hari yang bergerak.** `reportPeriod()` melaporkan hari yang sudah
  selesai **dan** hari berjalan, jadi tiap run memperbarui angka hari ini di samping mengulang angka
  kemarin yang tidak berubah. Itu yang membuat jadwal per jam ada gunanya di sisi GAM — sebelumnya 23
  dari 24 run mengambil angka yang sama persis. Kalau kuota GAM jadi masalah, `SYNC_INCLUDE_TODAY=0`
  mengembalikannya ke hari selesai saja, dan jadwal 2–4 jam sudah cukup.
- **Jumlah panggilan API tidak berubah** meski harinya jadi dua: rentangnya diminta sekali dengan
  `DATE` sebagai dimensi pertama, lalu dipecah per hari di sisi kita (`gamRowsByDay`).

Yang **tidak** tumbuh tiap run, jadi tidak perlu dikhawatirkan: baris ROI berkunci tanggal+subdomain
(diperbarui, bukan ditambah), `dailySpend` berkunci tanggal+akun+campaign, `countryRoi` ditulis utuh,
dan titik grafik finansial berkunci tanggal. `countryRoi` sekarang berkunci tanggal+subdomain+negara
dan ditulis utuh untuk kedua hari sekaligus, jadi ia tetap tidak tumbuh melewati dua hari.

## Alternatif tanpa Cloud Functions sama sekali

Cron mana pun yang bisa menjalankan Node — GitHub Actions, misalnya — dengan env yang sama:

```bash
cd functions
npm run sync        # GAM
npm run sync:meta   # Meta: saldo, campaign, riwayat saldo
npm run sync:roi    # ROI subdomain + ROI negara + grafik finansial
```
