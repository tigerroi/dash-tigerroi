# Gating campaign Keitaro

Satu campaign Keitaro mengirim trafik ke tiga tempat:

| Tujuan | Untuk siapa |
|---|---|
| Landing | pengunjung asli |
| Bot Protection | bot |
| Flow 3 | trafik tidak memenuhi syarat |

Bot Protection dan Flow 3 sama-sama menuju **decoy** (biasanya link YouTube).

**Gating** = mengarahkan ketiganya ke gate kita. Gate mencatat kunjungan lalu meneruskan pengunjung
ke tujuan yang sama seperti sebelumnya. Dari sisi pengunjung tidak ada yang berubah — kita hanya
jadi bisa mengukurnya.

## Siapa yang boleh

**Superadmin saja.** Ini satu-satunya tempat di dashboard di mana superadmin benar-benar berbeda
dari admin, dan bedanya disengaja: salah menekan di halaman ini tidak menghasilkan angka yang keliru
di sebuah tabel — ia mengalihkan trafik iklan sungguhan yang sedang membakar anggaran.

Ditegakkan di dua tempat yang harus tetap sama:

- `SUPERADMIN_PAGES` di [`src/config/access.js`](../src/config/access.js) — menyembunyikan menu,
  halaman, dan tombolnya;
- `.validate` pada `dashboard/gating/commands/$id/state` di
  [`database.rules.json`](../database.rules.json) — **ini yang sebenarnya menegakkan**. Perintah
  baru (`state: "pending"`) hanya boleh ditulis superadmin; `applied`/`failed` boleh ditulis admin,
  karena yang menuliskannya adalah SYNC_USER.

Membacanya tidak ikut terkunci: `dashboard` dibaca setiap akun yang login, dan izin baca RTDB
menurun — cabang di bawahnya tidak bisa menariknya kembali. Yang menahan di sisi UI adalah
langganannya (`gatingSubscriptions` di `useFirebaseStore`, hanya untuk superadmin), dan yang ada di
sana bukan rahasia: nama campaign dan URL tujuan, yang sudah terbaca semua orang lewat
`users/{id}.campaigns`.

## Jalurnya

```
Halaman /vi-control              server kontrol (server/)             vi-control API
  [Gate] ──── POST /gating/campaigns/57/gate ─────► applyOneGateCommand ──┐
                                                                          │
                    ── kalau server tak terjangkau, jatuh ke antrean ──   │
                                                                          │
                   dashboard/gating/commands                              │
             ────► c57: { action, state: pending } ──► cron tiap 2 menit ─┤
                                                       (di server yang    │
                                                        sama, BUKAN       │
                                                        Cloud Function)   │
  tabel ◄──── cermin RTDB ◄──── dashboard/gating/{campaigns,previews,runs,status} ◄─┘
```

Tombolnya memanggil **server kontrol**, bukan vi-control langsung — dan bukan pula Cloud Function.
Tiga hal yang menentukan bentuk ini:

1. **API key vi-control bisa mengubah tujuan trafik iklan yang sedang berjalan.** Ditaruh di bundle
   supaya browser bisa memanggil API-nya sendiri, ia terbaca siapa pun yang membuka devtools. Jadi
   bahkan kalau DRS dilonggarkan besok, key-nya tetap tinggal di sisi server.
2. DRS memblokir `allUsers` di project ini, jadi browser tidak bisa memanggil Cloud Function sama
   sekali (lihat [`src/config/features.js`](../src/config/features.js)). Yang menerima panggilan
   browser adalah server sendiri di `VITE_CONTROL_API_URL`, yang memeriksa ID token Firebase-nya.
3. Antrean RTDB **tidak dibuang**, ia jadi jalur cadangan: server yang mati atau tak terjangkau
   membuat halaman jatuh ke sana sendiri, dan cron di dalam server yang sama yang mengurasnya.
   `scheduledGating` sudah dihapus — lihat [`server/README.md`](../server/README.md).

Bentuk perintahnya ditulis dua kali dan harus sama persis — `gateCommandEntry` di
[`functions/gating-core.js`](../functions/gating-core.js) dan
[`src/lib/gating.js`](../src/lib/gating.js). Beda sedikit, perintahnya lolos aturan database tapi
tidak pernah dieksekusi siapa pun.

## Yang paling mudah salah

### `gated`, bukan `applicable`

Pratinjau untuk campaign yang **sudah** di-gate tetap menjawab `applicable: true`, dengan
`destinations` yang menunjuk ke URL gate itu sendiri. Menggating-nya lagi memasang gate di depan
gate, dan tidak ada apa pun di sisi vi-control yang menghentikannya.

Jadi yang menentukan arah tombol adalah `gated` dari `GET /campaigns`, dan `guardReason` di
[`functions/sync-gating.mjs`](../functions/sync-gating.mjs) membacanya ulang sedetik sebelum menulis
— yang dilihat orang di layar adalah cermin beberapa menit lalu.

### `gated: null` bukan `false`

Stream campaign itu gagal dibaca di sisi Keitaro. Dipetakan jadi `false`, halaman akan menawarkan
tombol Gate untuk campaign yang mungkin sudah di-gate. Tombolnya mati berikut alasannya.

### Tiga status, dan HTTP-nya selalu 200

| `status` | Arti | Di layar |
|---|---|---|
| `ok` | berhasil & terverifikasi | hijau |
| `aborted` | **ditolak, tidak ada yang ditulis sama sekali** | kuning — sistemnya sedang melindungi, jangan di-retry membabi buta |
| `problem` | **tersimpan tapi verifikasi gagal** | merah — routing sudah berubah tanpa terbukti benar, perlu dicek manusia |

`aborted` dan `problem` yang digabung jadi "gagal" adalah kesalahan yang paling mahal di sini: yang
membaca `problem` sebagai "tidak jadi" akan meninggalkan campaign dalam keadaan yang tidak diperiksa
siapa pun.

`reload.ok: false` **bukan** kegagalan — perubahannya sudah tersimpan, gate hanya belum menyerapnya
dan akan membacanya sendiri saat polling. Dicatat sebagai baris log, tidak diangkat jadi isu.

### Urutannya kebalikan dari saklar campaign Meta

`scheduledCampaignCommands` membaca status Meta **sebelum** menerapkan antrean, karena Meta butuh
waktu menampakkan perubahan dan bacaan yang datang belakangan akan menimpa perintah yang baru
diterapkan. Di sini sebaliknya: vi-control membaca ulang dan memverifikasi hasilnya sebelum
menjawab, jadi daftar yang dibaca **sesudah** gating sudah memuat perubahannya. Terapkan dulu, baru
segarkan.

### Kunci RTDB berawalan huruf

`c57`, bukan `57`. ID campaign Keitaro angka mulai dari 1, dan RTDB mengembalikan node berkunci
angka berurutan sebagai **array berlubang** — 55 baris jadi array 58 elemen yang isinya kebanyakan
`null`.

### `startedAt` UTC dan bentuknya bukan ISO

`2026-08-17 05:24:31.293338+00`: spasi alih-alih `T`, enam digit pecahan detik, offset dua digit.
Disimpan apa adanya, `formatDateTime` mencocokkannya dengan pola ISO, membaca `05:24` sebagai jam
lokal, dan menampilkan pukul 05:24 untuk sesuatu yang terjadi pukul 12:24 WIB. `toIsoUtc()` yang
menormalkannya saat dicerminkan.

## Node RTDB

| Path | Isi | Ditulis |
|---|---|---|
| `dashboard/gating/campaigns/c{id}` | cermin `GET /campaigns` | sync (replace utuh) |
| `dashboard/gating/previews/c{id}` | pratinjau, hanya untuk yang `gated: false` | sync (replace utuh) |
| `dashboard/gating/runs/{uuid}` | 50 riwayat terakhir, tanpa `plan`/`beforeState` | sync (replace utuh) |
| `dashboard/gating/status` | `mirroredAt` + hitungan | sync |
| `dashboard/gating/commands/c{id}` | antrean niat | superadmin (pending), sync (hasil) |
| `dashboard/gating/refreshRequestedAt` | stempel tombol "Segarkan" | superadmin |
| `dashboard/syncIssues/gating` | isu run terakhir (ikon topbar) | sync |

`plan` dan `beforeState` dibuang dari riwayat: dua objek JSON besar per baris, dikalikan lima puluh
baris, diunduh tiap browser yang membuka halaman — dan tidak satu pun ditampilkan.

## Setup

```bash
# Secret produksi
firebase functions:secrets:set VI_CONTROL_API_KEY --project rabbitroi-89973

# Deploy — sebut nama fungsinya, "No changes detected" berbohong
firebase deploy --only functions:scheduledGating --project rabbitroi-89973
firebase deploy --only database --project rabbitroi-89973
```

CLI (butuh `VI_CONTROL_API_KEY` + `SYNC_USER_*` di `functions/.env.sync`):

```bash
cd functions
npm run sync:gating                     # satu siklus penuh: antrean + cermin
node sync-gating.mjs gate 36            # jalan darurat, melewati antrean
node sync-gating.mjs ungate 36
```
