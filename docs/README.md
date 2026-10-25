# Dokumentasi RabbitROI

Aturan yang mengikat kode ada di [`CLAUDE.md`](../CLAUDE.md) — satu format tanggal, satu rumus ROI,
kenapa satu baris ROI tidak boleh memuat dua hari. Yang di sini menjelaskan sistem di belakangnya.

| Dokumen | Isi | Baca kalau |
| --- | --- | --- |
| [database-schema.md](database-schema.md) | tiap node RTDB, field per field, beserta siapa yang menulisnya | menambah field, membaca angka yang bentuknya tidak jelas |
| [scheduled-sync.md](scheduled-sync.md) | `scheduledSync`: rantai sync tiap jam, deploy, dan cara memantaunya | sync tidak jalan, atau mau mengubah jadwalnya |
| [adsense-gam-integration.md](adsense-gam-integration.md) | OAuth GAM, laporan earning, impor domain/subdomain dari ad unit | angka AdSense kosong atau tidak cocok |
| [meta-ads-integration.md](meta-ads-integration.md) | Graph API, System User token, saldo dan belanja per ad account | saldo Meta tidak terisi, atau token perlu dirotasi |
| [notifications.md](notifications.md) | Notification Center: topik, siapa menerima apa, siaran per role, grup | notifikasi tidak sampai ke orang yang benar, atau mau menambah topik |
| [telegram-reminders.md](telegram-reminders.md) | pengingat jatuh tempo: badge untuk semua role, kiriman harian ke Telegram, setup token & chat id | pengingat tidak sampai, atau mau menambah tujuan chat |
| [roles-and-access.md](roles-and-access.md) | peran, aturan database, dan cara membuat admin pertama | seseorang tidak bisa menulis, atau semua orang terkunci |
| [gating.md](gating.md) | gating campaign Keitaro lewat vi-control: siapa yang boleh, tiga status jawaban, dan yang paling mudah salah | tombol Gate mati, sebuah gating ditolak, atau statusnya "perlu dicek" |
| [activity-logs.md](activity-logs.md) | jejak aktivitas tiap orang: kenapa IP dan kota hanya bisa dicap server, penyangga 5 menit di browser, dan kenapa halamannya superadmin | jejak tidak bertambah, sebuah kejadian tidak tercatat, atau mau menambah yang dicatat |
| [plugin.md](plugin.md) | Management API plugin RabbitROI di tiap subdomain: dua kredensial, kenapa "tersimpan" tidak berarti "berubah", dan terapkan massal | halaman /plugin menolak sebuah situs, sebuah pengaturan tidak jadi berubah, atau enroll ditolak |
| [daftar-api-dan-link-eksternal.md](daftar-api-dan-link-eksternal.md) | daftar lengkap seluruh API pihak ketiga, endpoint URL eksternal, izin, dan file pengelolanya | menyiapkan kredensial, setup server baru, atau migrasi domain production |

Modul sync dan CLI-nya sendiri dijelaskan di [../functions/README.md](../functions/README.md), dan
server kontrol (Bun + Elysia — gating, saklar campaign, dan plugin) di
[../server/README.md](../server/README.md).

## arsip/

Desain dan rencana implementasi fitur yang sudah jadi. Disimpan sebagai catatan keputusan, **bukan
rujukan yang dijaga tetap benar** — sebagiannya sudah didahului kode (mis. rencana Target Earning
menyebut node `subDomainTargets`, yang saat dibangun menjadi `domainTargets`). Kalau isinya
bertentangan dengan `database-schema.md`, yang benar `database-schema.md`.
