-- ==============================================================================
-- MIGRASI 14: PERBAIKI PEMETAAN PIC 17 SUBDOMAIN & HAPUS MAS DEF DARI PIC OPERASIONAL
-- Versi: 20261028000014_fix_superadmin_not_pic_and_update_subdomains.sql
-- Keterangan: Masdef adalah Superadmin, tidak memegang domain maupun subdomain operasional.
--             Subdomain tanpa nama berarti BELUM ADA YANG PEGANG (NULL).
-- ==============================================================================

-- 1. Kosongkan user_owner pada tabel domains (Masdef bukan PIC domain operasional)
UPDATE public.domains SET user_owner = NULL;

-- 2. Update PIC resmi untuk 17 Subdomain
-- Mul (3 subdomain)
UPDATE public.subdomains SET pic = 'Mul' WHERE name IN ('careers', 'careers.tiktokmodapk.net');
UPDATE public.subdomains SET pic = 'Mul' WHERE name IN ('guides', 'guides.trayedit.com');
UPDATE public.subdomains SET pic = 'Mul' WHERE name IN ('deals', 'deals.ihopmenuwithprices.us');

-- Sul / Sulfin (4 subdomain)
UPDATE public.subdomains SET pic = 'Sul' WHERE name IN ('insurance', 'insurance.tiktokmodapk.net');
UPDATE public.subdomains SET pic = 'Sul' WHERE name IN ('burrito', 'burrito.tacobellmenuu.us');
UPDATE public.subdomains SET pic = 'Sul' WHERE name IN ('cabinets', 'cabinets.trayedit.com');
UPDATE public.subdomains SET pic = 'Sul' WHERE name IN ('menu', 'menu.ihopmenuwithprices.us');

-- Nur (3 subdomain)
UPDATE public.subdomains SET pic = 'Nur' WHERE name IN ('rewards', 'rewards.tiktokmodapk.net');
UPDATE public.subdomains SET pic = 'Nur' WHERE name IN ('decor', 'decor.trayedit.com');
UPDATE public.subdomains SET pic = 'Nur' WHERE name IN ('hacks', 'hacks.ihopmenuwithprices.us');

-- Man (3 subdomain)
UPDATE public.subdomains SET pic = 'Man' WHERE name IN ('mod', 'mod.tiktokmodapk.net');
UPDATE public.subdomains SET pic = 'Man' WHERE name IN ('materials', 'materials.trayedit.com');
UPDATE public.subdomains SET pic = 'Man' WHERE name IN ('keto', 'keto.ihopmenuwithprices.us');

-- Belum ada yang pegang (4 subdomain: NULL)
UPDATE public.subdomains SET pic = NULL, pic_user_id = NULL WHERE name IN ('cantina', 'cantina.tacobellmenuu.us');
UPDATE public.subdomains SET pic = NULL, pic_user_id = NULL WHERE name IN ('fries', 'fries.tacobellmenuu.us');
UPDATE public.subdomains SET pic = NULL, pic_user_id = NULL WHERE name IN ('styling', 'styling.trayedit.com');
UPDATE public.subdomains SET pic = NULL, pic_user_id = NULL WHERE name IN ('news', 'news.ihopmenuwithprices.us');

-- 3. Sambungkan pic_user_id dari tabel public.profiles untuk PIC yang terdaftar
UPDATE public.subdomains s
SET pic_user_id = p.id
FROM public.profiles p
WHERE (
    (s.pic = 'Mul' AND (p.name ILIKE '%Mul%' OR p.email ILIKE '%amul%')) OR
    (s.pic = 'Sul' AND (p.name ILIKE '%Sul%' OR p.email ILIKE '%sul%')) OR
    (s.pic = 'Nur' AND (p.name ILIKE '%Nur%' OR p.email ILIKE '%nur%')) OR
    (s.pic = 'Man' AND (p.name ILIKE '%Man%' OR p.email ILIKE '%man%'))
);

-- 4. Perbarui view_daily_roi agar membaca dari daily_stats dan TIDAK PERNAH meng-fallback PIC ke 'Mas Def'
DROP VIEW IF EXISTS public.view_daily_roi CASCADE;

CREATE OR REPLACE VIEW public.view_daily_roi 
WITH (security_invoker = true) AS
WITH site_dates AS (
    SELECT DISTINCT date, site_code FROM public.daily_stats
),
aggregated_rev AS (
    SELECT 
        date,
        site_code,
        COALESCE(SUM(revenue), 0) AS gam_revenue,
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
        COALESCE(SUM(spend), 0) AS total_spend_idr,
        COALESCE(SUM(clicks), 0) AS ad_clicks,
        COALESCE(SUM(impressions), 0) AS ad_impressions
    FROM public.daily_stats
    WHERE source IN ('meta', 'keitaro')
    GROUP BY date, site_code
),
tracker_stats AS (
    SELECT 
        date,
        site_code,
        COALESCE(SUM(revenue), 0) AS tracker_revenue,
        COALESCE(SUM(clicks), 0) AS tracker_clicks
    FROM public.daily_stats
    WHERE source = 'keitaro'
    GROUP BY date, site_code
),
subdomain_map AS (
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
        (sd.date || '_' || sd.site_code) AS id,
        sd.date,
        '23:59' AS time,
        sd.site_code,
        COALESCE(s.name, sd.site_code) AS site_name,
        COALESCE(s.name, sd.site_code) AS sub_domain,
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
    LEFT JOIN subdomain_map s ON s.site_code = sd.site_code
    LEFT JOIN aggregated_rev rv ON rv.date = sd.date AND rv.site_code = sd.site_code
    LEFT JOIN aggregated_spend sp ON sp.date = sd.date AND sp.site_code = sd.site_code
    LEFT JOIN tracker_stats ts ON ts.date = sd.date AND ts.site_code = sd.site_code
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
