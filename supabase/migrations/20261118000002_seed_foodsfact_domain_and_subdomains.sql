-- ==============================================================================
-- SEED DOMAIN DAN 5 SUBDOMAIN RESMI FOODSFACT.ORG (NETWORK 21869641910)
-- File: 20261118000002_seed_foodsfact_domain_and_subdomains.sql
--
-- Domain foodsfact.org adalah shared domain dengan pihak luar.
-- Khusus di TigerROI, HANYA 5 subdomain berikut yang diproses dan ditampilkan:
-- 1. eat.foodsfact.org       (Kode Campaign: DWDM)
-- 2. guides.foodsfact.org    (Kode Campaign: TG1D)
-- 3. property.foodsfact.org  (Kode Campaign: WMYN)
-- 4. finance.foodsfact.org   (Kode Campaign: TX5X)
-- 5. insurance.foodsfact.org (Kode Campaign: 4SVN)
-- ==============================================================================

-- 1. Pastikan domain induk tercatat di public.domains
INSERT INTO public.domains (domain_url, network_code, user_owner, status)
VALUES ('foodsfact.org', '21869641910', 'New York City', 'Active')
ON CONFLICT (domain_url) DO UPDATE
SET network_code = EXCLUDED.network_code,
    status = 'Active',
    updated_at = now();

-- 2. Daftarkan akun GAM di public.gam_accounts
INSERT INTO public.gam_accounts (name, network_code, status, status_auto, report_time_zone)
VALUES ('foodsfact.org', '21869641910', 'Ready', 'Ready', 'America/New_York')
ON CONFLICT (network_code) DO UPDATE
SET name = 'foodsfact.org',
    updated_at = now();

-- 3. Daftarkan 5 subdomain resmi TigerROI
INSERT INTO public.subdomains (name, site_code, parent_domain, campaign_codes, pic, status)
VALUES
    ('eat.foodsfact.org', 'DWDM', 'foodsfact.org', 'DWDM', 'New York City', 'Active'),
    ('guides.foodsfact.org', 'TG1D', 'foodsfact.org', 'TG1D', 'New York City', 'Active'),
    ('property.foodsfact.org', 'WMYN', 'foodsfact.org', 'WMYN', 'New York City', 'Active'),
    ('finance.foodsfact.org', 'TX5X', 'foodsfact.org', 'TX5X', 'New York City', 'Active'),
    ('insurance.foodsfact.org', '4SVN', 'foodsfact.org', '4SVN', 'New York City', 'Active')
ON CONFLICT (name) DO UPDATE
SET site_code = EXCLUDED.site_code,
    parent_domain = EXCLUDED.parent_domain,
    campaign_codes = EXCLUDED.campaign_codes,
    pic = COALESCE(public.subdomains.pic, EXCLUDED.pic),
    status = 'Active',
    updated_at = now();

-- 4. Hubungkan relasi foreign key parent_domain_id ke tabel domains
UPDATE public.subdomains s
SET parent_domain_id = d.id
FROM public.domains d
WHERE (s.parent_domain = d.domain_url OR d.domain_url LIKE '%' || s.parent_domain || '%')
  AND s.parent_domain_id IS NULL;
