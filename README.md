# RabbitROI Dashboard

Dashboard operasional RabbitROI Data Center: memantau ROI per subdomain dengan menggabungkan
belanja iklan Meta dan pendapatan Google Ad Manager, plus pengelolaan domain, akun iklan, akun
Adsense, target earning, dan catatan keuangan.

Angka ROI-nya tidak diinput tangan. Sebuah sync terjadwal menarik laporan dari GAM dan Meta tiap
jam, mencocokkan campaign ke subdomain lewat kode Keitaro, lalu menulis hasilnya ke Realtime
Database yang dibaca dashboard secara realtime.

## Jalankan

```bash
cp .env.example .env     # isi kredensial Firebase project kamu
npm install
npm run dev
```

Dashboard butuh Firebase project yang sudah punya Realtime Database dan Authentication
(email/password). Admin pertama tidak bisa dibuat dari dashboard — lihat bagian bootstrap di
[docs/roles-and-access.md](docs/roles-and-access.md).

## Perintah

| Perintah | Kegunaan |
| --- | --- |
| `npm run dev` | server pengembangan Vite |
| `npm test` | tes frontend (`node --test`) |
| `npm run build` | build produksi |
| `npx biome check --write .` | format + lint |
| `npm run deploy:rules` | deploy `database.rules.json` saja |
| `npm run deploy` | build lalu deploy hosting + rules + functions |
| `cd functions && npm test` | tes modul sync dan role |

Keempat yang pertama juga dijalankan otomatis oleh [CI](.github/workflows/ci.yml) pada tiap push.

## Susunan

| Folder | Isi |
| --- | --- |
| `src/` | aplikasi React (Vite). Router sendiri, tanpa react-router |
| `src/config/resources.js` | definisi tiap modul CRUD — kolom, field, filter. Halaman list dan form dibangun dari sini, bukan ditulis satu per satu |
| `src/lib/` | fungsi murni: format tanggal, ROI + ad tax, rentang tanggal, urutan tabel. Di sinilah tesnya |
| `functions/` | Cloud Functions dan modul sync (GAM, Meta, subdomain), plus CLI untuk menjalankan hal yang sama dari terminal. Susunannya di [functions/README.md](functions/README.md) |
| `docs/` | skema database, integrasi GAM/Meta, role dan akses, sync terjadwal. Daftar isinya di [docs/README.md](docs/README.md) |

Aturan lintas halaman yang tidak boleh dilanggar — satu format tanggal, satu rumus ROI, dan kenapa
satu baris ROI tidak boleh memuat dua hari — ada di [CLAUDE.md](CLAUDE.md). Baca itu sebelum menambah
halaman baru.

Rencana produk awal dan pembagian fasenya ada di [PRD.md](PRD.md); sebagian sudah berkembang
melampauinya (mis. modul Whitelist digantikan Whitelist Top-Up).
