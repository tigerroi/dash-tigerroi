-- ==============================================================================
-- MIGRASI: PEMBERSIHAN DATA ANOMALI SPEND META OKTOBER 2026
-- File: 20261111000001_clean_anomalous_october_news_and_taco_fries.sql
--
-- Masalah yang Diselesaikan:
-- 1. Subdomain news.ihopmenuwithprices.us baru berjalan di bulan November 2026.
--    Namun pada backfill Oktober, campaign IHOP lama salah terpetakan dan mencatat
--    spend Meta sebesar Rp 7.846.633 (+ Tax 5% = Rp 8.238.965) di tanggal 20-26 Okt.
-- 2. Subdomain fries.tacobellmenuu.us menduplikasi spend Meta dari burrito.tacobellmenuu.us
--    sebesar Rp 307.109 (+ Tax 5% = Rp 322.464) di tanggal 10, 12, 13, 14 Okt.
--
-- Hasil:
-- Total spending + TAX Oktober 2026 kembali akurat mendekati target Rp 32.550.000.
-- ==============================================================================

BEGIN;

-- 1. Hapus anomali spend Meta news.ihopmenuwithprices.us di Oktober 2026
DELETE FROM public.daily_stats
WHERE subdomain = 'news.ihopmenuwithprices.us'
  AND source = 'meta'
  AND date >= '2026-10-01'
  AND date <= '2026-10-31';

-- 2. Hapus duplikasi spend Meta fries.tacobellmenuu.us di Oktober 2026
DELETE FROM public.daily_stats
WHERE subdomain = 'fries.tacobellmenuu.us'
  AND source = 'meta'
  AND date >= '2026-10-01'
  AND date <= '2026-10-31';

COMMIT;

