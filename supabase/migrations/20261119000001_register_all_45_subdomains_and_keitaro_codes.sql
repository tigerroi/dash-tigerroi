-- ==============================================================================
-- MIGRASI PENDAFTARAN LENGKAP 9 DOMAIN & 45 SUBDOMAIN ARBITRASE TIGERROI
-- Sesuai data resmi Keitaro Campaign Tracker dari Mas Def
-- ==============================================================================

-- 1. Pastikan seluruh 9 Domain Induk terdaftar di public.domains
INSERT INTO public.domains (domain_url, network_code, user_owner, status)
VALUES
    ('https://ihopmenuwithprices.us', '23340206616', 'Mas Def', 'Active'),
    ('https://tacobellmenuu.us', '23380486168', 'Mas Def', 'Active'),
    ('https://trayedit.com', '23344333667', 'Mas Def', 'Active'),
    ('https://tiktokmodapk.net', '23367555867', 'Mas Def', 'Active'),
    ('https://foodsfact.org', '21869641910', 'Mas Def', 'Active'),
    ('https://cmhhealths.com', '23340206616', 'Mas Def', 'Active'),
    ('https://uniqueinfo24.com', '23340206616', 'Mas Def', 'Active'),
    ('https://velocitytv.com.pk', '23340206616', 'Mas Def', 'Active'),
    ('https://workmoney24.com', '23340206616', 'Mas Def', 'Active'),
    ('https://ziperto.org', '23340206616', 'Mas Def', 'Active')
ON CONFLICT (domain_url) DO UPDATE
SET status = 'Active', updated_at = now();

-- 2. Daftarkan seluruh 45 Subdomain Resmi beserta Kode Campaign Keitaro (4-karakter)
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
        -- 1. cmhhealths.com
        ('dosage.cmhhealths.com', '7KL2', 'https://cmhhealths.com', '7KL2'),
        ('weightloss.cmhhealths.com', 'BZP2', 'https://cmhhealths.com', 'BZP2'),
        ('diabetes.cmhhealths.com', 'J69X', 'https://cmhhealths.com', 'J69X'),
        ('sideeffects.cmhhealths.com', 'JS43', 'https://cmhhealths.com', 'JS43'),
        ('injections.cmhhealths.com', 'TDJ6', 'https://cmhhealths.com', 'TDJ6'),
        ('fitness.cmhhealths.com', 'YNXM', 'https://cmhhealths.com', 'YNXM'),

        -- 2. foodsfact.org
        ('insurance.foodsfact.org', '4SVN', 'https://foodsfact.org', '4SVN'),
        ('eat.foodsfact.org', 'DWDM', 'https://foodsfact.org', 'DWDM'),
        ('guides.foodsfact.org', 'TG1D', 'https://foodsfact.org', 'TG1D'),
        ('finance.foodsfact.org', 'TX5X', 'https://foodsfact.org', 'TX5X'),
        ('property.foodsfact.org', 'WMYN', 'https://foodsfact.org', 'WMYN'),

        -- 3. ihopmenuwithprices.us
        ('deals.ihopmenuwithprices.us', '6Q2G', 'https://ihopmenuwithprices.us', '6Q2G'),
        ('news.ihopmenuwithprices.us', 'PXZ2', 'https://ihopmenuwithprices.us', 'PXZ2'),
        ('hacks.ihopmenuwithprices.us', 'TFWG', 'https://ihopmenuwithprices.us', 'TFWG'),
        ('menu.ihopmenuwithprices.us', 'WYJ7', 'https://ihopmenuwithprices.us', 'WYJ7'),
        ('keto.ihopmenuwithprices.us', 'XVDV', 'https://ihopmenuwithprices.us', 'XVDV'),

        -- 4. tacobellmenuu.us
        ('news.tacobellmenuu.us', 'Cb3K', 'https://tacobellmenuu.us', 'Cb3K'),
        ('finance.tacobellmenuu.us', 'DFNQ', 'https://tacobellmenuu.us', 'DFNQ'),
        ('burrito.tacobellmenuu.us', 'RWLB', 'https://tacobellmenuu.us', 'RWLB'),
        ('cantina.tacobellmenuu.us', 'ZPMH', 'https://tacobellmenuu.us', 'ZPMH'),
        ('fries.tacobellmenuu.us', 'ZVGM', 'https://tacobellmenuu.us', 'ZVGM'),

        -- 5. trayedit.com
        ('guides.trayedit.com', '2yVL', 'https://trayedit.com', '2yVL'),
        ('decor.trayedit.com', '4QcP', 'https://trayedit.com', '4QcP'),
        ('styling.trayedit.com', '43TW', 'https://trayedit.com', '43TW'),
        ('materials.trayedit.com', 'BWDv', 'https://trayedit.com', 'BWDv'),
        ('cabinets.trayedit.com', 'ZGFR', 'https://trayedit.com', 'ZGFR'),

        -- 6. uniqueinfo24.com
        ('insurance.uniqueinfo24.com', '245R', 'https://uniqueinfo24.com', '245R'),
        ('travel.uniqueinfo24.com', 'G9SQ', 'https://uniqueinfo24.com', 'G9SQ'),
        ('health.uniqueinfo24.com', 'N1BD', 'https://uniqueinfo24.com', 'N1BD'),
        ('loan.uniqueinfo24.com', 'SBS6', 'https://uniqueinfo24.com', 'SBS6'),
        ('finance.uniqueinfo24.com', 'WNJC', 'https://uniqueinfo24.com', 'WNJC'),

        -- 7. velocitytv.com.pk
        ('insurance.velocitytv.com.pk', '2DB4', 'https://velocitytv.com.pk', '2DB4'),
        ('finance.velocitytv.com.pk', 'N4D6', 'https://velocitytv.com.pk', 'N4D6'),
        ('news.velocitytv.com.pk', 'WRGB', 'https://velocitytv.com.pk', 'WRGB'),
        ('dollar.velocitytv.com.pk', 'XCGM', 'https://velocitytv.com.pk', 'XCGM'),

        -- 8. workmoney24.com
        ('skills.workmoney24.com', '4R2M', 'https://workmoney24.com', '4R2M'),
        ('freelance.workmoney24.com', 'DQN2', 'https://workmoney24.com', 'DQN2'),
        ('passiveincome.workmoney24.com', 'FGCD', 'https://workmoney24.com', 'FGCD'),
        ('affiliate.workmoney24.com', 'KVD1', 'https://workmoney24.com', 'KVD1'),
        ('wfh.workmoney24.com', 'X8PJ', 'https://workmoney24.com', 'X8PJ'),

        -- 9. ziperto.org
        ('family.ziperto.org', '2FGP', 'https://ziperto.org', '2FGP'),
        ('guides.ziperto.org', '4C9L', 'https://ziperto.org', '4C9L'),
        ('hard.ziperto.org', 'PSHM', 'https://ziperto.org', 'PSHM'),
        ('subs.ziperto.org', 'RYLV', 'https://ziperto.org', 'RYLV'),
        ('gaming.ziperto.org', 'T7PV', 'https://ziperto.org', 'T7PV')
) AS sub(name, site_code, parent_domain_url, campaign_codes)
JOIN public.domains d ON d.domain_url = sub.parent_domain_url
ON CONFLICT (name) DO UPDATE
SET site_code = EXCLUDED.site_code,
    parent_domain = EXCLUDED.parent_domain,
    parent_domain_id = EXCLUDED.parent_domain_id,
    campaign_codes = EXCLUDED.campaign_codes,
    status = 'Active',
    updated_at = now();
