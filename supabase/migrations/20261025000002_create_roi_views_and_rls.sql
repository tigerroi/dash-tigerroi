-- ==============================================================================
-- Migrasi Skema View Laporan ROI Terpadu & Pengetatan RLS Sesuai Peran
-- Versi: 20261025000002_create_roi_views_and_rls.sql
-- ==============================================================================

-- 1. VIEW LAPORAN ROI HARIAN TERPADU (view_daily_roi)
-- Menyatukan data pendapatan GAM / AdSense dengan biaya iklan Meta / Tracker
-- Mengonversi dan menghitung profit dalam USD dan IDR secara realtime
CREATE OR REPLACE VIEW public.view_daily_roi 
WITH (security_invoker = true) AS
WITH site_dates AS (
    SELECT DISTINCT date, site_code FROM public.daily_stats
),
aggregated_rev AS (
    SELECT 
        date,
        site_code,
        COALESCE(SUM(revenue), 0) AS gam_revenue_usd,
        COALESCE(SUM(impressions), 0) AS gam_impressions,
        COALESCE(SUM(clicks), 0) AS gam_clicks
    FROM public.daily_stats
    WHERE source IN ('gam', 'adsense')
    GROUP BY date, site_code
),
aggregated_spend AS (
    SELECT 
        date,
        site_code,
        COALESCE(SUM(spend), 0) AS total_spend_usd,
        COALESCE(SUM(clicks), 0) AS ad_clicks,
        COALESCE(SUM(impressions), 0) AS ad_impressions,
        MAX(source) AS primary_spend_source
    FROM public.daily_stats
    WHERE source IN ('meta', 'keitaro')
    GROUP BY date, site_code
),
tracker_stats AS (
    SELECT 
        date,
        site_code,
        COALESCE(SUM(revenue), 0) AS tracker_revenue_usd,
        COALESCE(SUM(clicks), 0) AS tracker_clicks
    FROM public.daily_stats
    WHERE source = 'keitaro'
    GROUP BY date, site_code
)
SELECT 
    sd.date,
    sd.site_code,
    COALESCE(s.name, sd.site_code) AS site_name,
    COALESCE(s.domain, '-') AS domain,
    COALESCE(s.pic, 'Tanpa PIC') AS pic,
    
    -- Metrik USD
    COALESCE(sp.total_spend_usd, 0) AS spend_usd,
    -- Jika GAM ada pakai GAM, fallback ke pendapatan tracker jika GAM belum tercatat
    CASE 
        WHEN COALESCE(rv.gam_revenue_usd, 0) > 0 THEN rv.gam_revenue_usd
        ELSE COALESCE(ts.tracker_revenue_usd, 0)
    END AS revenue_usd,
    (CASE 
        WHEN COALESCE(rv.gam_revenue_usd, 0) > 0 THEN rv.gam_revenue_usd
        ELSE COALESCE(ts.tracker_revenue_usd, 0)
    END) - COALESCE(sp.total_spend_usd, 0) AS profit_usd,

    -- Metrik IDR (Estimasi standar kurs Rp 18.000 / USD jika tanpa tabel kurs dinamis)
    ROUND(COALESCE(sp.total_spend_usd, 0) * 18000, 0) AS spend_idr,
    ROUND((CASE 
        WHEN COALESCE(rv.gam_revenue_usd, 0) > 0 THEN rv.gam_revenue_usd
        ELSE COALESCE(ts.tracker_revenue_usd, 0)
    END) * 18000, 0) AS revenue_idr,
    ROUND(((CASE 
        WHEN COALESCE(rv.gam_revenue_usd, 0) > 0 THEN rv.gam_revenue_usd
        ELSE COALESCE(ts.tracker_revenue_usd, 0)
    END) - COALESCE(sp.total_spend_usd, 0)) * 18000, 0) AS profit_idr,

    -- Persentase ROI
    CASE 
        WHEN COALESCE(sp.total_spend_usd, 0) > 0 THEN 
            ROUND(((((CASE 
                WHEN COALESCE(rv.gam_revenue_usd, 0) > 0 THEN rv.gam_revenue_usd
                ELSE COALESCE(ts.tracker_revenue_usd, 0)
            END) - COALESCE(sp.total_spend_usd, 0)) / sp.total_spend_usd) * 100)::numeric, 2)
        ELSE 0 
    END AS roi_percent,

    -- Metrik Volume
    COALESCE(sp.ad_clicks, ts.tracker_clicks, 0) AS clicks,
    COALESCE(sp.ad_impressions, rv.gam_impressions, 0) AS impressions,
    CASE 
        WHEN COALESCE(sp.ad_clicks, 0) > 0 THEN 
            ROUND((COALESCE(sp.total_spend_usd, 0) / sp.ad_clicks)::numeric, 4)
        ELSE 0 
    END AS cpc_usd,

    -- Indikator Status & Rekonsiliasi Data
    CASE 
        WHEN COALESCE(rv.gam_revenue_usd, 0) > 0 AND COALESCE(sp.total_spend_usd, 0) > 0 THEN 'lengkap'
        WHEN COALESCE(rv.gam_revenue_usd, 0) > 0 AND COALESCE(sp.total_spend_usd, 0) = 0 THEN 'hilang_spend'
        WHEN COALESCE(rv.gam_revenue_usd, 0) = 0 AND COALESCE(sp.total_spend_usd, 0) > 0 THEN 'hilang_revenue_gam'
        ELSE 'hanya_tracker'
    END AS data_status

FROM site_dates sd
LEFT JOIN public.sites s ON s.site_code = sd.site_code
LEFT JOIN aggregated_rev rv ON rv.date = sd.date AND rv.site_code = sd.site_code
LEFT JOIN aggregated_spend sp ON sp.date = sd.date AND sp.site_code = sd.site_code
LEFT JOIN tracker_stats ts ON ts.date = sd.date AND ts.site_code = sd.site_code;

-- ==============================================================================
-- 2. PENGETATAN ROW LEVEL SECURITY (RLS) SESUAI PERAN
-- Superadmin, Admin, dan Keuangan dapat melihat seluruh data ROI.
-- Peran Advertiser/User hanya dapat membaca data situs yang ditugaskan kepada mereka.
-- ==============================================================================

DROP POLICY IF EXISTS "daily_stats_role_select" ON public.daily_stats;
DROP POLICY IF EXISTS "daily_stats_select_authenticated" ON public.daily_stats;

CREATE POLICY "daily_stats_role_select" ON public.daily_stats
    FOR SELECT TO authenticated
    USING (
        public.is_admin() 
        OR public.is_keuangan()
        OR EXISTS (
            SELECT 1 FROM public.sites s
            JOIN public.profiles p ON p.id = auth.uid()
            WHERE s.site_code = daily_stats.site_code
            AND (s.pic = p.name OR s.pic = p.email OR s.pic ILIKE '%' || p.name || '%')
        )
    );
