# Fitur yang Ditunda (Deferred Features)

Dokumen ini mencatat modul dan fitur lama yang **sengaja dinonaktifkan dan ditunda**, tidak dipindahkan ke stack target (Supabase Free + Cloudflare Pages + GitHub Actions), dan tidak boleh diaktifkan tanpa persetujuan eksplisit dari **masdef**.

---

## 1. Fitur Notifikasi Telegram

### Status
**NONAKTIF TOTAL (DEFERRED)**.

### Alasan Penundaan
Sesuai arahan arsitektur:
1. Tidak ada server background permanen (VPS terpisah) dan tidak menggunakan Firebase Cloud Functions.
2. Tidak membuat variabel environment `TELEGRAM_*` baik di `.env`, Supabase, maupun GitHub Actions Secrets.
3. Fokus utama sistem adalah keakuratan agregasi ROI arbitrase (Meta Ads + Google Ad Manager) di Supabase.

### Berkas yang Terkait dan Dibiarkan Nonaktif
- `functions/telegram.mjs`: Modul client pengiriman pesan bot Telegram via Telegram Bot API.
- `functions/notifications-core.js`: Logika evaluasi rule notifikasi, trigger spending limit, target ROI, dan format pesan.
- `functions/telegram-inbox-core.js`: Logika parsing pesan masuk dari command Telegram inbox.
- `functions/sync-telegram-inbox.mjs`: Skrip polling pesan masuk via webhook / getUpdates Telegram.
- `functions/tools/telegram-chat-id.mjs`: Tool CLI untuk mendapatkan ID chat Telegram.
- `src/lib/notifications.js` & `src/lib/telegramInbox.js`: Helper client-side notifikasi.
- `src/components/NotificationCenter.jsx`, `NotificationContactForm.jsx`, `NotificationPersonForm.jsx`: Komponen antarmuka pengguna di dashboard.

---

## 2. Fitur Vi-Control / Cloaking / Gating

### Status
**NONAKTIF TOTAL (DEFERRED & USUL HAPUS)**.

### Alasan Penundaan
1. Melanggar prinsip integritas data dan kebijakan jaringan iklan (Meta / Google Ad Manager).
2. Membedakan pengalaman pengunjung berdasarkan deteksi bot / reviewer iklan berisiko tinggi terhadap penalti akun iklan.

### Berkas yang Terkait dan Dibiarkan Nonaktif
- `functions/keitaro-gate.js`
- `server/gating.js`
- `src/components/ViControl.jsx`
- Endpoint dan referensi `/vi-control` di seluruh modul dashboard.

---

## 3. Server Background Monolitik (`server/`)

### Status
**DITUNDA SEBAGIAN BESAR (DEFERRED)**.

### Alasan Penundaan
Dashboard berjalan secara serverless (frontend statis di Cloudflare Pages yang mengakses Supabase langsung via Row Level Security/RLS menggunakan Anon Key). Seluruh job sinkronisasi dipindahkan ke skrip mandiri terjadwal di GitHub Actions. Modul di dalam folder `server/` hanya dipindahkan jika benar-benar esensial dan tidak dapat digantikan oleh Supabase RLS.
