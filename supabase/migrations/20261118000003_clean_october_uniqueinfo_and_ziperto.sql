-- ==============================================================================
-- MIGRASI: PEMBERSIHAN DATA ANOMALI SPEND OKTOBER 2026
-- (UNIQUEINFO24.COM & ZIPERTO.ORG)
-- File: 20261118000003_clean_october_uniqueinfo_and_ziperto.sql
--
-- Masalah:
-- Domain uniqueinfo24.com dan ziperto.org baru aktif di bulan November 2026,
-- namun memiliki sisa tarikan spend Meta Ads di bulan Oktober 2026:
-- - uniqueinfo24.com: Spending Rp 3.164.285 (Earning Rp 0)
-- - ziperto.org: Spending Rp 1.554.088 (Earning Rp 0)
-- Hal ini menyebabkan kedua domain muncul di laporan bulan Oktober dengan ROI -100%.
-- ==============================================================================

BEGIN;

-- 1. Hapus dari public.daily_stats untuk tanggal sebelum 1 November 2026
DELETE FROM public.daily_stats
WHERE date < '2026-11-01'
  AND (
      site_code ILIKE '%unique%'
      OR site_code ILIKE '%ziperto%'
      OR subdomain ILIKE '%uniqueinfo24%'
      OR subdomain ILIKE '%ziperto%'
  );

-- 2. Hapus dari public.roi_snapshots untuk tanggal sebelum 1 November 2026
DELETE FROM public.roi_snapshots
WHERE date < '2026-11-01'
  AND (
      site_code ILIKE '%unique%'
      OR site_code ILIKE '%ziperto%'
      OR sub_domain ILIKE '%uniqueinfo24%'
      OR sub_domain ILIKE '%ziperto%'
      OR domain ILIKE '%uniqueinfo24%'
      OR domain ILIKE '%ziperto%'
  );

-- 3. Hapus dari public.country_roi untuk tanggal sebelum 1 November 2026
DELETE FROM public.country_roi
WHERE date < '2026-11-01'
  AND (
      sub_domain ILIKE '%uniqueinfo24%'
      OR sub_domain ILIKE '%ziperto%'
  );

COMMIT;
