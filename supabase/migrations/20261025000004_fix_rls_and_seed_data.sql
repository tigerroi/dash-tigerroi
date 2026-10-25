-- ==============================================================================
-- FIX RLS READ-ONLY & SEED 4 DOMAIN + 17 SUBDOMAIN
-- ==============================================================================

-- 1. Berikan izin SELECT publik (Anon & Authenticated) untuk tabel Domain & Subdomain (Read-Only)
DROP POLICY IF EXISTS "domains_select_auth" ON public.domains;
DROP POLICY IF EXISTS "domains_select_all" ON public.domains;
CREATE POLICY "domains_select_all" ON public.domains
    FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS "subdomains_select_auth" ON public.subdomains;
DROP POLICY IF EXISTS "subdomains_select_all" ON public.subdomains;
CREATE POLICY "subdomains_select_all" ON public.subdomains
    FOR SELECT TO public USING (true);

-- 2. Bersihkan dan Masukkan 4 Domain Induk
INSERT INTO public.domains (domain_url, network_code, user_owner, status)
VALUES
    ('https://ihopmenuwithprices.us', '23340206616', 'Mas Def', 'Active'),
    ('https://tacobellmenuu.us', '23380486168', 'Mas Def', 'Active'),
    ('https://tiktokmodapk.net', '23367555867', 'Mas Def', 'Active'),
    ('https://trayedit.com', '23344333667', 'Mas Def', 'Active')
ON CONFLICT (domain_url) DO UPDATE
SET network_code = EXCLUDED.network_code, status = 'Active', updated_at = now();

-- 3. Masukkan 17 Subdomain Resmi
INSERT INTO public.subdomains (name, site_code, parent_domain, parent_domain_id, campaign_codes, pic, status)
SELECT 
    sub.name,
    sub.site_code,
    d.domain_url,
    d.id,
    sub.campaign_codes,
    'Mas Def',
    'Active'
FROM (
    VALUES
        -- IHOP (ihop-menu / pBRw)
        ('menu.ihopmenuwithprices.us', 'ihop-menu', 'https://ihopmenuwithprices.us', 'pBRw'),
        ('deals.ihopmenuwithprices.us', 'ihop-menu', 'https://ihopmenuwithprices.us', 'pBRw'),
        ('keto.ihopmenuwithprices.us', 'ihop-menu', 'https://ihopmenuwithprices.us', 'pBRw'),
        ('hacks.ihopmenuwithprices.us', 'ihop-menu', 'https://ihopmenuwithprices.us', 'pBRw'),
        ('news.ihopmenuwithprices.us', 'ihop-menu', 'https://ihopmenuwithprices.us', 'pBRw'),

        -- Taco Bell (taco-fries / taco)
        ('cantina.tacobellmenuu.us', 'taco-fries', 'https://tacobellmenuu.us', 'taco'),
        ('burrito.tacobellmenuu.us', 'taco-fries', 'https://tacobellmenuu.us', 'taco'),
        ('fries.tacobellmenuu.us', 'taco-fries', 'https://tacobellmenuu.us', 'taco'),

        -- TikTok Mod (tiktok-mod / tiktok)
        ('insurance.tiktokmodapk.net', 'tiktok-mod', 'https://tiktokmodapk.net', 'tiktok'),
        ('careers.tiktokmodapk.net', 'tiktok-mod', 'https://tiktokmodapk.net', 'tiktok'),
        ('rewards.tiktokmodapk.net', 'tiktok-mod', 'https://tiktokmodapk.net', 'tiktok'),
        ('mod.tiktokmodapk.net', 'tiktok-mod', 'https://tiktokmodapk.net', 'tiktok'),

        -- Tray Edit (tray-decor / TvH1)
        ('decor.trayedit.com', 'tray-decor', 'https://trayedit.com', 'TvH1'),
        ('materials.trayedit.com', 'tray-decor', 'https://trayedit.com', 'TvH1'),
        ('cabinets.trayedit.com', 'tray-decor', 'https://trayedit.com', 'TvH1'),
        ('guides.trayedit.com', 'tray-decor', 'https://trayedit.com', 'TvH1'),
        ('styling.trayedit.com', 'tray-decor', 'https://trayedit.com', 'TvH1')
) AS sub(name, site_code, parent_domain_url, campaign_codes)
JOIN public.domains d ON d.domain_url = sub.parent_domain_url
ON CONFLICT (name) DO UPDATE
SET site_code = EXCLUDED.site_code,
    parent_domain = EXCLUDED.parent_domain,
    parent_domain_id = EXCLUDED.parent_domain_id,
    campaign_codes = EXCLUDED.campaign_codes,
    status = 'Active',
    updated_at = now();
