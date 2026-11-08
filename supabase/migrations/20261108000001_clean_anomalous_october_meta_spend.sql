-- ==============================================================================
-- MIGRASI: PEMBERSIHAN DATA ANOMALI SPEND META & SUBDOMAIN NOVEMBER DI OKTOBER 2026
-- File: 20261108000001_clean_anomalous_october_meta_spend.sql
--
-- Masalah yang Diselesaikan:
-- 1. Pada tanggal 8 & 9 Oktober 2026, terdapat baris `source = 'meta'` di tabel
--    `daily_stats` dengan total spend Rp 37.029.128 yang terbentuk akibat tarikan
--    agregasi multi-hari Meta yang jatuh ke tanggal start.
-- 2. Hal ini menyebabkan total spending bulan Oktober di Cash Flow & Laba Rugi
--    melonjak 2x lipat menjadi Rp 76.199.030 (aslinya Rp 39.169.902).
-- 3. Domain dan subdomain yang baru berjalan di bulan November (cmhhealths.com
--    dan uniqueinfo24.com) ikut terbawa ke bulan Oktober.
-- ==============================================================================

BEGIN;

-- 1. Hapus baris anomali spend Meta pada tanggal 8 dan 9 Oktober 2026
DELETE FROM public.daily_stats
WHERE source = 'meta'
  AND date IN ('2026-10-08', '2026-10-09');

-- 2. Hapus seluruh baris domain/subdomain November (cmhhealths & uniqueinfo24) di bulan Oktober
DELETE FROM public.daily_stats
WHERE date < '2026-11-01'
  AND (
      site_code ILIKE '%cmh%' 
      OR site_code ILIKE '%unique%'
      OR subdomain ILIKE '%cmhhealths%'
      OR subdomain ILIKE '%uniqueinfo24%'
  );

-- 3. Hapus breakdown negara country_roi untuk domain November di bulan Oktober
DELETE FROM public.country_roi
WHERE date < '2026-11-01'
  AND (
      sub_domain ILIKE '%cmhhealths%'
      OR sub_domain ILIKE '%uniqueinfo24%'
  );

COMMIT;
