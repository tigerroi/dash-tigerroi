-- ==============================================================================
-- MIGRASI: POPULASI DAILY_STATS DARI ROI_SNAPSHOTS UNTUK OKTOBER 2026
-- File: 20261118000006_populate_october_daily_stats.sql
--
-- Tujuan:
-- Mengisi tabel public.daily_stats dari snapshot jam terakhir tiap hari di bulan Oktober,
-- agar view_daily_roi dan view_daily_financials memiliki data resmi harian bulan Oktober.
-- Hal ini mengatasi kendala limit 1.000 baris PostgREST saat membaca snapshot mentah,
-- sehingga Laba Rugi dan Laba per Domain langsung memuat data yang presisi seketika.
-- ==============================================================================

BEGIN;

-- 1. Bersihkan data lama di daily_stats untuk Oktober 2026
DELETE FROM public.daily_stats
WHERE date >= '2026-10-01' AND date <= '2026-10-31';

-- 2. Masukkan baris spend Meta Ads dari snapshot jam penutup/terakhir tiap hari
INSERT INTO public.daily_stats (date, site_code, subdomain, source, spend, revenue, clicks, impressions)
WITH latest_snaps AS (
  SELECT DISTINCT ON (date, site_code, COALESCE(sub_domain, ''))
    date,
    site_code,
    COALESCE(sub_domain, '') AS subdomain,
    spending,
    earning,
    COALESCE(meta_clicks, clicks, 0) AS clicks,
    COALESCE(gam_impressions, impressions, 0) AS impressions
  FROM public.roi_snapshots
  WHERE date >= '2026-10-01' AND date <= '2026-10-31'
  ORDER BY date, site_code, COALESCE(sub_domain, ''), time DESC
)
SELECT 
  date,
  site_code,
  subdomain,
  'meta' AS source,
  spending AS spend,
  0 AS revenue,
  clicks,
  impressions
FROM latest_snaps
WHERE spending > 0;

-- 3. Masukkan baris revenue GAM dari snapshot jam penutup/terakhir tiap hari
INSERT INTO public.daily_stats (date, site_code, subdomain, source, spend, revenue, clicks, impressions)
WITH latest_snaps AS (
  SELECT DISTINCT ON (date, site_code, COALESCE(sub_domain, ''))
    date,
    site_code,
    COALESCE(sub_domain, '') AS subdomain,
    spending,
    earning,
    COALESCE(gam_clicks, clicks, 0) AS clicks,
    COALESCE(gam_impressions, impressions, 0) AS impressions
  FROM public.roi_snapshots
  WHERE date >= '2026-10-01' AND date <= '2026-10-31'
  ORDER BY date, site_code, COALESCE(sub_domain, ''), time DESC
)
SELECT 
  date,
  site_code,
  subdomain,
  'gam' AS source,
  0 AS spend,
  earning AS revenue,
  clicks,
  impressions
FROM latest_snaps
WHERE earning > 0;

COMMIT;
