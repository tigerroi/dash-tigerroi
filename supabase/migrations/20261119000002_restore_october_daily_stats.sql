-- ==============================================================================
-- TIGERROI: RESTORE DATA BULAN OKTOBER KE DAILY_STATS DARI ROI_SNAPSHOTS
-- File: supabase/migrations/20261119000002_restore_october_daily_stats.sql
--
-- Tujuan:
-- Mengisi data historis bulan Oktober 2026 ke tabel public.daily_stats
-- agar laporan Laba Rugi dan Accounting bulan Oktober tetap utuh, rapi, dan sesuai.
-- HANYA mengisi tanggal Oktober (2026-10-01 s/d 2026-10-31), TIDAK menyentuh November.
-- ==============================================================================

BEGIN;

-- 1. Hapus jika ada sisa baris bulan Oktober di daily_stats agar bersih
DELETE FROM public.daily_stats
WHERE date >= '2026-10-01' AND date < '2026-11-01';

-- 2. Masukkan data Belanja Meta Bulan Oktober dari snapshot jam terakhir
INSERT INTO public.daily_stats (date, site_code, subdomain, source, spend, revenue, clicks, impressions)
WITH latest_snaps AS (
  SELECT DISTINCT ON (s.date, lower(trim(COALESCE(s.sub_domain, ''))))
    s.date,
    COALESCE(cs.site_code, s.site_code) AS site_code,
    lower(trim(COALESCE(s.sub_domain, ''))) AS subdomain,
    s.spending,
    COALESCE(s.meta_clicks, s.clicks, 0) AS clicks,
    COALESCE(s.gam_impressions, s.impressions, 0) AS impressions
  FROM public.roi_snapshots s
  LEFT JOIN (
    SELECT DISTINCT ON (lower(name)) lower(name) AS name, site_code
    FROM public.subdomains
    ORDER BY lower(name), created_at ASC
  ) cs ON lower(trim(COALESCE(s.sub_domain, ''))) = cs.name
  WHERE s.date >= '2026-10-01' AND s.date < '2026-11-01'
    AND lower(trim(COALESCE(s.sub_domain, ''))) <> ''
  ORDER BY s.date, lower(trim(COALESCE(s.sub_domain, ''))), s.time DESC
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

-- 3. Masukkan data Pendapatan GAM Bulan Oktober dari snapshot jam terakhir
INSERT INTO public.daily_stats (date, site_code, subdomain, source, spend, revenue, clicks, impressions)
WITH latest_snaps AS (
  SELECT DISTINCT ON (s.date, lower(trim(COALESCE(s.sub_domain, ''))))
    s.date,
    COALESCE(cs.site_code, s.site_code) AS site_code,
    lower(trim(COALESCE(s.sub_domain, ''))) AS subdomain,
    s.earning,
    COALESCE(s.gam_clicks, s.clicks, 0) AS clicks,
    COALESCE(s.gam_impressions, s.impressions, 0) AS impressions
  FROM public.roi_snapshots s
  LEFT JOIN (
    SELECT DISTINCT ON (lower(name)) lower(name) AS name, site_code
    FROM public.subdomains
    ORDER BY lower(name), created_at ASC
  ) cs ON lower(trim(COALESCE(s.sub_domain, ''))) = cs.name
  WHERE s.date >= '2026-10-01' AND s.date < '2026-11-01'
    AND lower(trim(COALESCE(s.sub_domain, ''))) <> ''
  ORDER BY s.date, lower(trim(COALESCE(s.sub_domain, ''))), s.time DESC
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
