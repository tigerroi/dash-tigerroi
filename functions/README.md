# functions/

Dua hal tinggal di sini: **Cloud Functions** yang ter-deploy ke Firebase, dan **modul sync** yang
menarik angka dari GAM dan Meta. Modulnya sengaja tidak tahu ia sedang dipanggil dari mana — cron,
CLI, atau callable — supaya rumus ROI hanya punya satu salinan.

## Susunan

| Path | Isi |
| --- | --- |
| `index.js` | entry Cloud Functions: `oauth` (redirect login) dan tiga callable `importGam*` |
| `scheduled-sync.js` | `scheduledSync` — rantai sync lengkap tiap jam, satu-satunya jalur otomatis |
| `scheduled-reminders.mjs` | `scheduledReminders` — pengingat jatuh tempo ke Telegram, 08:00 WIB |
| `reminders-core.js`, `telegram.mjs` | daftar yang jatuh tempo + klien Bot API (fetch, tanpa SDK) |
| `sync-*.mjs`, `discover-sites.mjs` | runner: bisa diimpor sebagai modul, bisa dijalankan sebagai CLI |
| `sync-core.js`, `gam.js`, `meta.js`, `discover-core.js` | logika murni — di sinilah tesnya |
| `db.mjs`, `store.mjs`, `oauth.mjs`, `roles.mjs` | akses data dan auth, dipakai semua jalur |
| `tools/` | skrip sekali-pakai lewat terminal: authorize, cek koneksi, atur role |
| `migrations/` | migrasi data satu kali. Idempoten, tapi baca headernya sebelum menjalankan |
| `*.test.mjs` | `npm test` (`node --test`), tanpa framework |

`tools/` dan `migrations/` tidak pernah diimpor modul lain — hanya dipanggil npm script. Itu
sebabnya keduanya boleh pindah folder tanpa menyentuh apa pun yang ter-deploy.

## Menjalankan

Semua skrip membaca `.env.sync` (gitignored) dari folder ini, jadi jalankan dari `functions/`:

```bash
npm run sync                 # GAM per akun adsense
npm run sync:meta            # saldo + belanja Meta
npm run sync:roi             # ROI subdomain, ROI negara, grafik finansial
npm run discover:domains     # atau discover:subdomains — impor situs dari ad unit GAM
npm run import:networks      # impor akun adsense dari network GAM
npm run authorize -- "<nama googleApiConfig>"
npm run gam:check / meta:check
npm run telegram:chat-id     # id chat tujuan pengingat (kirim /start ke botnya dulu)
npm run role:list / role:whoami / role:bootstrap / role:set
npm test
```

## Deploy

```bash
firebase deploy --only functions:scheduledSync --project rabbitroi-89973
firebase deploy --only functions:scheduledReminders --project rabbitroi-89973
```

Sebut nama fungsinya. `npm run deploy` di folder ini memakai `--only functions` polos, yang ikut
mendeploy callable `importGam*` — dan callable itu diblokir Domain Restricted Sharing, jadi langkah
IAM-nya bisa gagal dan menggagalkan seluruh deploy. Alasan lengkapnya di
[../docs/scheduled-sync.md](../docs/scheduled-sync.md), termasuk kenapa fungsi terjadwal lolos DRS
padahal callable tidak.
