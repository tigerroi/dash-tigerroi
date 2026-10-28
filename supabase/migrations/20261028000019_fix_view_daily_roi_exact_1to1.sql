
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
        '23:59' AS time,
        sd.site_code,
        COALESCE(NULLIF(sd.subdomain, ''), sm.name, sim.name, sd.site_code) AS site_name,
        COALESCE(NULLIF(sd.subdomain, ''), sm.name, sim.name, sd.site_code) AS sub_domain,
        COALESCE(sd.site_code, '-') AS campaign,
        COALESCE(sm.parent_domain, sim.parent_domain, '-') AS domain,
        COALESCE(sm.pic, sim.pic, '-') AS pic,
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
    LEFT JOIN subdomain_map sm ON sm.name = sd.subdomain
    LEFT JOIN site_map sim ON sim.site_code = sd.site_code AND sd.subdomain = ''
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

GRANT SELECT ON public.view_daily_roi TO anon, authenticated, service_role;

DROP VIEW IF EXISTS public.view_daily_financials CASCADE;

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
