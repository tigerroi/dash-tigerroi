-- ==============================================================================
-- MIGRASI PENDAFTARAN LENGKAP 9 DOMAIN & 45 SUBDOMAIN ARBITRASE TIGERROI
-- Sesuai data resmi Keitaro Campaign Tracker dari Mas Def (Tanpa protokol https://)
-- ==============================================================================

-- 1. Bersihkan parent_domain di subdomains terlebih dahulu jika ada sisa https://
UPDATE public.subdomains
SET parent_domain = lower(regexp_replace(regexp_replace(parent_domain, '^https?://', '', 'i'), '/+$', ''))
WHERE parent_domain ~* '^https?://';

-- 2. Pastikan seluruh 10 Domain Induk terdaftar murni tanpa https:// di public.domains
INSERT INTO public.domains (domain_url, network_code, user_owner, status)
VALUES
    ('ihopmenuwithprices.us', '23340206616', 'Mas Def', 'Active'),
    ('tacobellmenuu.us', '23380486168', 'Mas Def', 'Active'),
    ('trayedit.com', '23344333667', 'Mas Def', 'Active'),
    ('tiktokmodapk.net', '23367555867', 'Mas Def', 'Active'),
    ('foodsfact.org', '21869641910', 'Mas Def', 'Active'),
    ('cmhhealths.com', '23340206616', 'Mas Def', 'Active'),
    ('uniqueinfo24.com', '23340206616', 'Mas Def', 'Active'),
    ('velocitytv.com.pk', '23340206616', 'Mas Def', 'Active'),
    ('workmoney24.com', '23340206616', 'Mas Def', 'Active'),
    ('ziperto.org', '23340206616', 'Mas Def', 'Active')
ON CONFLICT (domain_url) DO UPDATE
SET status = 'Active', updated_at = now();

-- 3. Daftarkan seluruh 45 Subdomain Resmi beserta Kode Campaign Keitaro (4-karakter)
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
        ('dosage.cmhhealths.com', '7KL2', 'cmhhealths.com', '7KL2'),
        ('weightloss.cmhhealths.com', 'BZP2', 'cmhhealths.com', 'BZP2'),
        ('diabetes.cmhhealths.com', 'J69X', 'cmhhealths.com', 'J69X'),
        ('sideeffects.cmhhealths.com', 'JS43', 'cmhhealths.com', 'JS43'),
        ('injections.cmhhealths.com', 'TDJ6', 'cmhhealths.com', 'TDJ6'),
        ('fitness.cmhhealths.com', 'YNXM', 'cmhhealths.com', 'YNXM'),

        -- 2. foodsfact.org
        ('insurance.foodsfact.org', '4SVN', 'foodsfact.org', '4SVN'),
        ('eat.foodsfact.org', 'DWDM', 'foodsfact.org', 'DWDM'),
        ('guides.foodsfact.org', 'TG1D', 'foodsfact.org', 'TG1D'),
        ('finance.foodsfact.org', 'TX5X', 'foodsfact.org', 'TX5X'),
        ('property.foodsfact.org', 'WMYN', 'foodsfact.org', 'WMYN'),

        -- 3. ihopmenuwithprices.us
        ('deals.ihopmenuwithprices.us', '6Q2G', 'ihopmenuwithprices.us', '6Q2G'),
        ('news.ihopmenuwithprices.us', 'PXZ2', 'ihopmenuwithprices.us', 'PXZ2'),
        ('hacks.ihopmenuwithprices.us', 'TFWG', 'ihopmenuwithprices.us', 'TFWG'),
        ('menu.ihopmenuwithprices.us', 'WYJ7', 'ihopmenuwithprices.us', 'WYJ7'),
        ('keto.ihopmenuwithprices.us', 'XVDV', 'ihopmenuwithprices.us', 'XVDV'),

        -- 4. tacobellmenuu.us
        ('news.tacobellmenuu.us', 'Cb3K', 'tacobellmenuu.us', 'Cb3K'),
        ('finance.tacobellmenuu.us', 'DFNQ', 'tacobellmenuu.us', 'DFNQ'),
        ('burrito.tacobellmenuu.us', 'RWLB', 'tacobellmenuu.us', 'RWLB'),
        ('cantina.tacobellmenuu.us', 'ZPMH', 'tacobellmenuu.us', 'ZPMH'),
        ('fries.tacobellmenuu.us', 'ZVGM', 'tacobellmenuu.us', 'ZVGM'),

        -- 5. trayedit.com
        ('guides.trayedit.com', '2yVL', 'trayedit.com', '2yVL'),
        ('decor.trayedit.com', '4QcP', 'trayedit.com', '4QcP'),
        ('styling.trayedit.com', '43TW', 'trayedit.com', '43TW'),
        ('materials.trayedit.com', 'BWDv', 'trayedit.com', 'BWDv'),
        ('cabinets.trayedit.com', 'ZGFR', 'trayedit.com', 'ZGFR'),

        -- 6. uniqueinfo24.com
        ('insurance.uniqueinfo24.com', '245R', 'uniqueinfo24.com', '245R'),
        ('travel.uniqueinfo24.com', 'G9SQ', 'uniqueinfo24.com', 'G9SQ'),
        ('health.uniqueinfo24.com', 'N1BD', 'uniqueinfo24.com', 'N1BD'),
        ('loan.uniqueinfo24.com', 'SBS6', 'uniqueinfo24.com', 'SBS6'),
        ('finance.uniqueinfo24.com', 'WNJC', 'uniqueinfo24.com', 'WNJC'),

        -- 7. velocitytv.com.pk
        ('insurance.velocitytv.com.pk', '2DB4', 'velocitytv.com.pk', '2DB4'),
        ('finance.velocitytv.com.pk', 'N4D6', 'velocitytv.com.pk', 'N4D6'),
        ('news.velocitytv.com.pk', 'WRGB', 'velocitytv.com.pk', 'WRGB'),
        ('dollar.velocitytv.com.pk', 'XCGM', 'velocitytv.com.pk', 'XCGM'),

        -- 8. workmoney24.com
        ('skills.workmoney24.com', '4R2M', 'workmoney24.com', '4R2M'),
        ('freelance.workmoney24.com', 'DQN2', 'workmoney24.com', 'DQN2'),
        ('passiveincome.workmoney24.com', 'FGCD', 'workmoney24.com', 'FGCD'),
        ('affiliate.workmoney24.com', 'KVD1', 'workmoney24.com', 'KVD1'),
        ('wfh.workmoney24.com', 'X8PJ', 'workmoney24.com', 'X8PJ'),

        -- 9. ziperto.org
        ('family.ziperto.org', '2FGP', 'ziperto.org', '2FGP'),
        ('guides.ziperto.org', '4C9L', 'ziperto.org', '4C9L'),
        ('hard.ziperto.org', 'PSHM', 'ziperto.org', 'PSHM'),
        ('subs.ziperto.org', 'RYLV', 'ziperto.org', 'RYLV'),
        ('gaming.ziperto.org', 'T7PV', 'ziperto.org', 'T7PV')
) AS sub(name, site_code, parent_domain_url, campaign_codes)
JOIN public.domains d ON d.domain_url = sub.parent_domain_url
ON CONFLICT (name) DO UPDATE
SET site_code = EXCLUDED.site_code,
    parent_domain = EXCLUDED.parent_domain,
    parent_domain_id = EXCLUDED.parent_domain_id,
    campaign_codes = EXCLUDED.campaign_codes,
    status = 'Active',
    updated_at = now();

-- 4. Hubungkan ulang foreign key parent_domain_id ke domain bersih
UPDATE public.subdomains s
SET parent_domain_id = d.id
FROM public.domains d
WHERE d.domain_url = s.parent_domain;

-- 5. Bersihkan baris duplikat yang berawalan https:// di public.domains
DELETE FROM public.domains WHERE domain_url ~* '^https?://';

-- 6. Pastikan semua status Active
UPDATE public.domains SET status = 'Active' WHERE status != 'Active';
UPDATE public.subdomains SET status = 'Active' WHERE status != 'Active';
