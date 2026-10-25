Konteks proyek

TigerROI (dulu RabbitROI) adalah dashboard ROI arbitrase iklan: biaya iklan dari Meta Ads, pendapatan dari Google Ad Manager/AdSense, dihitung profit per situs/subdomain. Kode ini HASIL COPY dari pihak lain, jadi TIDAK BOLEH dipercaya sebelum diaudit.

Stack asli: React+Vite (src/), server Node.js (server/), Firebase Cloud Functions (functions/), Firebase Realtime DB + Auth. Stack target (SEMUA GRATIS, tanpa VPS baru): frontend React+Vite di Cloudflare Pages, Supabase Free (Postgres + Auth), job sinkronisasi berupa skrip Node yang dijalankan terjadwal oleh GitHub Actions (repositori PRIVAT). TIDAK memakai Cloud Functions dan TIDAK memakai Firebase. Server Node server/ DITUNDA: dashboard baca-saja membaca Supabase langsung dari frontend dengan RLS. Hanya pindahkan bagian server/ yang benar-benar dibutuhkan, dan catat alasannya.

Peta infrastruktur
tigerroi.com: DNS di Cloudflare, hosting di Domainesia (server lisensi plugin saja, aplikasi Laravel).
WordPress iklan: 4 domain + 17 subdomain, server Hetzner (CloudPanel), DNS di Cloudflare. Domain: ihopmenuwithprices.us, tacobellmenuu.us, tiktokmodapk.net, trayedit.com.
Keitaro self-hosted: https://appscity.tech/admin, server Hetzner TERPISAH dari WordPress. Paket Advanced: ada Click API, TIDAK ada Admin API (kemungkinan). Perlakukan integrasi Admin API sebagai opsional dengan fallback impor CSV.
Gateway: Cloudflare Worker go.tigerroi.com/<slug> (folder tigerroi-gateway/), meneruskan klik ke Keitaro dengan parameter utuh. Perlakuan sama untuk semua pengunjung.
Dashboard TigerROI: frontend di Cloudflare Pages (dash.tigerroi.com), data di Supabase Free, job sinkronisasi di GitHub Actions. Tidak dipasang di Domainesia, dan tidak butuh VPS baru. Server Hetzner (WordPress dan Keitaro) TIDAK dipakai untuk menjalankan dashboard atau job.
Kode situs (kunci penggabungan data)

Satu kode per situs (contoh ihop-menu, tray-decor, taco-fries, tiktok-mod) harus SAMA di: nama campaign Keitaro, parameter site/sub_id di URL iklan, ad unit GAM, dan kolom site_code di database. Jangan membuat skema penamaan lain.

Aturan wajib
Kerjakan SATU fase per sesi. Berhenti di akhir fase dan laporkan. Jangan lanjut sendiri.
Jangan meminta, menulis, atau mencetak nilai rahasia asli (API key, token, password, service_role key). Hanya isi .env.example dengan placeholder. Saya sendiri yang mengisi .env.
.env dan semua file rahasia wajib ada di .gitignore. Jangan pernah commit rahasia.
Kunci Supabase service_role HANYA boleh dipakai di server/jobs. Frontend hanya boleh memakai anon key. Jika ada kode yang melanggar ini, hentikan dan laporkan.
Semua tabel Supabase wajib mengaktifkan Row Level Security (RLS) dengan policy eksplisit. Tidak boleh ada tabel publik tanpa RLS.
Jangan ubah nama internal "rabbitroi" (endpoint, nama plugin, path) kecuali saya minta.
Jangan aktifkan, perbaiki, atau mengembangkan fitur gating/cloaking: functions/keitaro-gate.js, server/gating.js, src/components/ViControl.jsx, dan semua referensi Vi-Control. Biarkan nonaktif. Laporkan di audit dan usulkan penghapusannya, tapi jangan hapus tanpa persetujuan saya.
Jangan menambah kode yang membedakan perlakuan pengunjung berdasarkan deteksi crawler/reviewer iklan.
Sebelum mengubah file, jelaskan apa yang diubah dan kenapa. Ubah seminimal mungkin. Bekerja di git branch terpisah per fase.
Setiap fase ditutup dengan: daftar file yang diubah, cara mengetes, dan apa yang harus saya lakukan manual.
Jika menemukan kode mencurigakan (eval, base64/atob, request ke domain asing, pengecekan lisensi, pengiriman data ke luar), STOP dan laporkan. Jangan diperbaiki diam-diam.
Semua rahasia (token Meta, kunci service_role, refresh token Google, token Telegram/Cloudflare) hanya boleh berada di GitHub Secrets / variabel environment, tidak pernah di file repo. Repositori WAJIB privat, dan Fase 0 (audit) harus selesai di komputer lokal SEBELUM push pertama.
Supabase Free melakukan pause proyek setelah 7 hari tanpa aktivitas. Setiap job sinkronisasi harus menulis ke sync_runs dan menjalankan satu query ringan, serta jangan mengandalkan pg_cron di dalam Supabase untuk membangunkan proyek.
Detail API dan produk (Supabase, Meta, Google Ad Manager, Keitaro, Cloudflare) sering berubah. Periksa dokumentasi resmi terbaru sebelum menulis kode yang bergantung padanya, dan sebutkan sumbernya di laporan.