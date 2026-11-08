-- ==============================================================================
-- MIGRASI: PERBAIKI KALKULASI AD TAX (5%) PADA VIEW_DAILY_ROI & VIEW_DAILY_FINANCIALS
-- File: 20261108000002_fix_ad_tax_in_view_daily_roi.sql
-- Keterangan: Sebelumnya ad_tax di-hardcode 0, sehingga kolom Ad Tax di Laporan ROI
--             bernilai Rp 0 dan Total Spend tidak mencakup pajak iklan 5%.
-- ==============================================================================

DROP VIEW IF EXISTS public.view_daily_financials CASCADE;
DROP VIEW IF EXISTS public.view_daily_roi CASCADE;

CREATE OR REPLACE VIEW public.view_daily_roi 
WITH (security_invoker = true) AS
WITH site_dates AS (
    SELECT 
        date, 
        site_code, 
        COALESCE(subdomain, '') AS subdomain,
        MAX(updated_at) AS last_updated_at
    FROM public.daily_stats
    WHERE COALESCE(subdomain, '') <> '' 
       OR NOT EXISTS (
           SELECT 1 FROM public.daily_stats s2 
           WHERE s2.date = daily_stats.date 
             AND s2.site_code = daily_stats.site_code 
             AND COALESCE(s2.subdomain, '') <> ''
       )
    GROUP BY date, site_code, COALESCE(subdomain, '')
),
aggregated_rev AS (
    SELECT 
        date,
        site_code,
        COALESCE(subdomain, '') AS subdomain,
        -- Utamakan GAM / AdSense, fallback ke Keitaro HANYA jika GAM tidak ada
        COALESCE(SUM(CASE WHEN source IN ('gam', 'adsense') THEN revenue ELSE 0 END), 0) AS gam_revenue,
        COALESCE(SUM(CASE WHEN source = 'keitaro' THEN revenue ELSE 0 END), 0) AS tracker_revenue,
        COALESCE(SUM(impressions), 0) AS impressions,
        COALESCE(SUM(clicks), 0) AS clicks
    FROM public.daily_stats
    GROUP BY date, site_code, COALESCE(subdomain, '')
),
aggregated_spend AS (
    SELECT 
        date,
        site_code,
        COALESCE(subdomain, '') AS subdomain,
        -- Utamakan Meta Ads, fallback ke Keitaro HANYA jika Meta tidak ada (JANGAN DI-SUM KEDUANYA!)
        COALESCE(SUM(CASE WHEN source = 'meta' THEN spend ELSE 0 END), 0) AS meta_spend,
        COALESCE(SUM(CASE WHEN source = 'keitaro' THEN spend ELSE 0 END), 0) AS tracker_spend,
        COALESCE(SUM(CASE WHEN source = 'meta' THEN clicks ELSE clicks END), 0) AS ad_clicks,
        COALESCE(SUM(CASE WHEN source = 'meta' THEN impressions ELSE impressions END), 0) AS ad_impressions
    FROM public.daily_stats
    GROUP BY date, site_code, COALESCE(subdomain, '')
),
subdomain_map AS (
    SELECT DISTINCT ON (name) 
        site_code, 
        name, 
        parent_domain, 
        pic 
    FROM public.subdomains 
    ORDER BY name, created_at ASC
),
site_map AS (
    SELECT DISTINCT ON (site_code) 
        site_code, 
        name, 
        parent_domain, 
        pic 
    FROM public.subdomains 
    ORDER BY site_code, created_at ASC
),
calculated_base AS (
    SELECT 
        (sd.date || '_' || sd.site_code || '_' || NULLIF(sd.subdomain, '')) AS id,
        sd.date,
        TO_CHAR(COALESCE(sd.last_updated_at, now()) AT TIME ZONE 'Asia/Jakarta', 'HH24:MI') AS time,
        COALESCE(sd.last_updated_at, now()) AS updated_at,
        sd.site_code,
        COALESCE(NULLIF(sd.subdomain, ''), sm.name, sim.name, sd.site_code) AS site_name,
        COALESCE(NULLIF(sd.subdomain, ''), sm.name, sim.name, sd.site_code) AS sub_domain,
        COALESCE(sd.site_code, '-') AS campaign,
        COALESCE(sm.parent_domain, sim.parent_domain, '-') AS domain,
        COALESCE(sm.pic, sim.pic, '-') AS pic,
        
        -- BELANJA: Utamakan Meta Ads. Jangan pernah menjumlahkan Meta + Keitaro (mencegah 2x lipat)!
        CASE 
            WHEN COALESCE(sp.meta_spend, 0) > 0 THEN sp.meta_spend 
            ELSE COALESCE(sp.tracker_spend, 0) 
        END AS spend_idr,
        
        -- PENDAPATAN: Utamakan GAM/AdSense. Jangan pernah menjumlahkan GAM + Keitaro (mencegah 2x lipat)!
        CASE 
            WHEN COALESCE(rv.gam_revenue, 0) > 0 THEN rv.gam_revenue 
            ELSE COALESCE(rv.tracker_revenue, 0) 
        END AS raw_revenue,
        
        1.0 AS fx_rate,
        'IDR' AS currency_code,
        
        COALESCE(sp.ad_clicks, rv.clicks, 0) AS clicks,
        COALESCE(sp.ad_impressions, rv.impressions, 0) AS impressions
    FROM site_dates sd
    LEFT JOIN subdomain_map sm ON sm.name = sd.subdomain
    LEFT JOIN site_map sim ON sim.site_code = sd.site_code AND sd.subdomain = ''
    LEFT JOIN aggregated_rev rv ON rv.date = sd.date AND rv.site_code = sd.site_code AND rv.subdomain = sd.subdomain
    LEFT JOIN aggregated_spend sp ON sp.date = sd.date AND sp.site_code = sd.site_code AND sp.subdomain = sd.subdomain
)
SELECT 
    b.id,
    b.date,
    b.time,
    b.updated_at,
    b.site_code,
    b.site_name,
    b.sub_domain,
    b.campaign,
    b.domain,
    b.pic,
    
    -- Belanja Iklan Meta (IDR) & Pajak Iklan 5%
    b.spend_idr AS spending,
    b.spend_idr AS meta_spend,
    b.spend_idr AS meta_ads,
    ROUND(b.spend_idr * 0.05) AS ad_tax,
    (b.spend_idr + ROUND(b.spend_idr * 0.05)) AS total_spending,
    (b.spend_idr + ROUND(b.spend_idr * 0.05)) AS total_spend,
    
    -- Pendapatan (IDR)
    ROUND(b.raw_revenue) AS earning,
    b.raw_revenue AS revenue,
    b.raw_revenue AS gross_revenue,
    b.raw_revenue AS gam_revenue,
    b.raw_revenue AS gam_ads,
    0 AS adsense_ads,
    
    -- Laba & ROI (dihitung bersih setelah Total Spending = Belanja + Pajak Iklan)
    (b.raw_revenue - (b.spend_idr + ROUND(b.spend_idr * 0.05))) AS profit,
    (b.raw_revenue - (b.spend_idr + ROUND(b.spend_idr * 0.05))) AS net_profit,
    CASE 
        WHEN (b.spend_idr + ROUND(b.spend_idr * 0.05)) > 0 
        THEN ROUND((((b.raw_revenue - (b.spend_idr + ROUND(b.spend_idr * 0.05))) / (b.spend_idr + ROUND(b.spend_idr * 0.05))) * 100)::numeric, 2)
        ELSE 0 
    END AS roi,
    
    -- Metrik Traffic
    b.clicks,
    b.impressions,
    CASE 
        WHEN b.clicks > 0 THEN ROUND((b.spend_idr / b.clicks)::numeric, 2)
        ELSE 0 
    END AS cpc,
    CASE 
        WHEN b.impressions > 0 THEN ROUND(((b.raw_revenue / b.impressions) * 1000)::numeric, 2)
        ELSE 0 
    END AS cpm,
    CASE 
        WHEN b.impressions > 0 THEN ROUND(((b.raw_revenue / b.impressions) * 1000)::numeric, 2)
        ELSE 0 
    END AS page_rpm,
    CASE 
        WHEN b.clicks > 0 THEN ROUND((b.spend_idr / b.clicks)::numeric, 2)
        ELSE 0 
    END AS cpr,
    
    'IDR' AS currency,
    1.0 AS fx_rate,
    'GAM' AS source
FROM calculated_base b;

GRANT SELECT ON public.view_daily_roi TO anon, authenticated, service_role;

-- ------------------------------------------------------------------------------
-- VIEW_DAILY_FINANCIALS UNTUK GRAFIK KEUANGAN HARIAN
-- ------------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.view_daily_financials 
WITH (security_invoker = true) AS
SELECT 
    v.date,
    COALESCE(SUM(v.earning), 0) AS gross_revenue,
    COALESCE(SUM(v.spending), 0) AS total_spend,
    COALESCE(SUM(v.ad_tax), 0) AS ad_tax,
    COALESCE(SUM(v.total_spending), 0) AS total_spending,
    COALESCE(SUM(v.profit), 0) AS net_profit
FROM public.view_daily_roi v
GROUP BY v.date
ORDER BY v.date DESC;

GRANT SELECT ON public.view_daily_financials TO anon, authenticated, service_role;
