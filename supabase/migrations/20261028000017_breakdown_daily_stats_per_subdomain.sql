-- ==============================================================================
-- MIGRASI 17: PECAH DATA DAILY_STATS DAN VIEW_DAILY_ROI PER SUBDOMAIN RESMI
-- Versi: 20261028000017_breakdown_daily_stats_per_subdomain.sql
-- Keterangan: Memecah pendapatan GAM dan belanja Meta per subdomain
--             sehingga Mul (Amul), Sul, Nur, dan Man masing-masing memiliki
--             perhitungan ROI Founder yang presisi dan adil.
-- ==============================================================================

-- 1. Tambahkan kolom subdomain pada tabel daily_stats
ALTER TABLE public.daily_stats ADD COLUMN IF NOT EXISTS subdomain TEXT DEFAULT '';

-- 2. Perbarui constraint unik agar mendukung per (date, site_code, subdomain, source)
ALTER TABLE public.daily_stats DROP CONSTRAINT IF EXISTS uq_daily_stats;
ALTER TABLE public.daily_stats DROP CONSTRAINT IF EXISTS uq_daily_stats_subdomain;
ALTER TABLE public.daily_stats ADD CONSTRAINT uq_daily_stats_subdomain UNIQUE (date, site_code, subdomain, source);

CREATE INDEX IF NOT EXISTS idx_daily_stats_subdomain ON public.daily_stats(date, site_code, subdomain, source);

-- 3. Perbarui view_daily_roi agar membaca per subdomain dan menghubungkan ke PIC yang tepat
DROP VIEW IF EXISTS public.view_daily_roi CASCADE;

CREATE OR REPLACE VIEW public.view_daily_roi 
WITH (security_invoker = true) AS
WITH site_dates AS (
    SELECT DISTINCT date, site_code, COALESCE(subdomain, '') AS subdomain 
    FROM public.daily_stats
),
aggregated_rev AS (
    SELECT 
        date,
        site_code,
        COALESCE(subdomain, '') AS subdomain,
        COALESCE(SUM(revenue), 0) AS gam_revenue,
        COALESCE(SUM(impressions), 0) AS gam_impressions,
        COALESCE(SUM(clicks), 0) AS gam_clicks
    FROM public.daily_stats
    WHERE source IN ('gam', 'adsense')
    GROUP BY date, site_code, subdomain
),
aggregated_spend AS (
    SELECT 
        date,
        site_code,
        COALESCE(subdomain, '') AS subdomain,
        COALESCE(SUM(spend), 0) AS total_spend_idr,
        COALESCE(SUM(clicks), 0) AS ad_clicks,
        COALESCE(SUM(impressions), 0) AS ad_impressions
    FROM public.daily_stats
    WHERE source IN ('meta', 'keitaro')
    GROUP BY date, site_code, subdomain
),
tracker_stats AS (
    SELECT 
        date,
        site_code,
        COALESCE(subdomain, '') AS subdomain,
        COALESCE(SUM(revenue), 0) AS tracker_revenue,
        COALESCE(SUM(clicks), 0) AS tracker_clicks
    FROM public.daily_stats
    WHERE source = 'keitaro'
    GROUP BY date, site_code, subdomain
),
calculated_base AS (
    SELECT 
        (sd.date || '_' || sd.site_code || '_' || NULLIF(sd.subdomain, '')) AS id,
        sd.date,
        '23:59' AS time,
        sd.site_code,
        COALESCE(NULLIF(sd.subdomain, ''), s.name, sd.site_code) AS site_name,
        COALESCE(NULLIF(sd.subdomain, ''), s.name, sd.site_code) AS sub_domain,
        COALESCE(sd.site_code, '-') AS campaign,
        COALESCE(s.parent_domain, '-') AS domain,
        COALESCE(s.pic, '-') AS pic,
        COALESCE(sp.total_spend_idr, 0) AS spend_idr,
        
        -- Nilai pendapatan mentah (USD untuk Trayedit/TikTok/IHOP, INR untuk Tacobell)
        CASE 
            WHEN COALESCE(rv.gam_revenue, 0) > 0 THEN rv.gam_revenue 
            ELSE COALESCE(ts.tracker_revenue, 0) 
        END AS raw_revenue,
        
        -- Kurs resmi masdef
        CASE 
            WHEN sd.site_code = 'taco-fries' THEN 190.87
            ELSE 18155.28
        END AS fx_rate,
        
        CASE 
            WHEN sd.site_code = 'taco-fries' THEN 'INR'
            ELSE 'USD'
        END AS currency_code,
        
        COALESCE(sp.ad_clicks, ts.tracker_clicks, 0) AS clicks,
        COALESCE(sp.ad_impressions, rv.gam_impressions, 0) AS impressions
    FROM site_dates sd
    LEFT JOIN public.subdomains s ON (
        (sd.subdomain <> '' AND (s.name = sd.subdomain OR s.name ILIKE '%' || sd.subdomain || '%'))
        OR
        (sd.subdomain = '' AND s.site_code = sd.site_code)
    )
    LEFT JOIN aggregated_rev rv ON rv.date = sd.date AND rv.site_code = sd.site_code AND rv.subdomain = sd.subdomain
    LEFT JOIN aggregated_spend sp ON sp.date = sd.date AND sp.site_code = sd.site_code AND sp.subdomain = sd.subdomain
    LEFT JOIN tracker_stats ts ON ts.date = sd.date AND ts.site_code = sd.site_code AND ts.subdomain = sd.subdomain
)
SELECT 
    b.id,
    b.date,
    b.time,
    b.site_code,
    b.site_name,
    b.sub_domain,
    b.campaign,
    b.domain,
    b.pic,
    
    -- Belanja Iklan Meta (IDR)
    b.spend_idr AS spending,
    b.spend_idr AS meta_spend,
    b.spend_idr AS meta_ads,
    0 AS ad_tax,
    b.spend_idr AS total_spending,
    
    -- Pendapatan Bersih Dikonversi Presisi ke IDR
    ROUND(b.raw_revenue * b.fx_rate) AS earning,
    ROUND(b.raw_revenue * b.fx_rate) AS gam_revenue,
    
    -- Profit Bersih (IDR)
    (ROUND(b.raw_revenue * b.fx_rate) - b.spend_idr) AS profit,
    
    -- ROI Presisi (%)
    CASE 
        WHEN b.spend_idr > 0 THEN 
            ROUND((((ROUND(b.raw_revenue * b.fx_rate) - b.spend_idr) / b.spend_idr) * 100)::numeric, 2)
        ELSE 0 
    END AS roi,
    
    b.clicks,
    b.impressions,
    CASE 
        WHEN b.clicks > 0 THEN 
            ROUND((b.spend_idr / b.clicks)::numeric, 4)
        ELSE 0 
    END AS cpc,
    
    b.currency_code AS currency,
    b.fx_rate AS fx_rate
FROM calculated_base b;
