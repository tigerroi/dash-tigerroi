-- ==============================================================================
-- TIGERROI: POPULASI DATA DAILY_STATS DARI ROI_SNAPSHOTS
-- File: scripts/populate_daily_stats_from_snapshots.sql
--
-- Tujuan:
-- Mengisi tabel public.daily_stats dari snapshot jam closing terakhir tiap hari di tabel roi_snapshots.
-- Dengan adanya data resmi harian di daily_stats:
-- 1. view_daily_roi terisi penuh per tanggal, per subdomain, dan per PIC.
-- 2. view_daily_financials terisi agregat harian resmi.
-- 3. Di menu Accounting (Laba Rugi):
--    - Nilai Pendapatan dan Belanja Bulan Lalu (Oktober & November) langsung rapi dan valid.
--    - Peringatan "pendapatan tidak punya baris ROI" HILANG seketika.
--    - Potongan Company Ad Exchange dan Bonus Advertiser langsung terhitung presisi.
-- ==============================================================================

BEGIN;

-- 1. Bersihkan tabel daily_stats agar tidak terjadi duplikasi data
TRUNCATE TABLE public.daily_stats;

-- 2. Masukkan baris Belanja Meta Ads dari snapshot jam terakhir tiap hari per site dan subdomain
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

-- 3. Masukkan baris Pendapatan GAM dari snapshot jam terakhir tiap hari per site dan subdomain
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

-- Verifikasi hasil populasi
SELECT 
  date,
  COUNT(*) AS total_rows,
  SUM(spend) AS total_spend,
  SUM(revenue) AS total_revenue
FROM public.daily_stats
GROUP BY date
ORDER BY date DESC
LIMIT 15;
