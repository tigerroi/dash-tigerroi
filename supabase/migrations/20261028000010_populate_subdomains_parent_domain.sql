-- ==============================================================================
-- PENGISIAN KOLOM parent_domain PADA TABEL public.subdomains
-- Versi: 20261028000010_populate_subdomains_parent_domain.sql
-- ==============================================================================

-- 1. Isi parent_domain dari tabel public.domains lewat relasi parent_domain_id
UPDATE public.subdomains s
SET parent_domain = d.domain_url
FROM public.domains d
WHERE s.parent_domain_id = d.id;

-- 2. Pastikan fallback mapping berdasarkan site_code resmi jika parent_domain_id belum terpasang
UPDATE public.subdomains
SET parent_domain = 'https://ihopmenuwithprices.us'
WHERE site_code = 'ihop-menu' AND (parent_domain IS NULL OR parent_domain = '');

UPDATE public.subdomains
SET parent_domain = 'https://tacobellmenuu.us'
WHERE site_code = 'taco-fries' AND (parent_domain IS NULL OR parent_domain = '');

UPDATE public.subdomains
SET parent_domain = 'https://tiktokmodapk.net'
WHERE site_code = 'tiktok-mod' AND (parent_domain IS NULL OR parent_domain = '');

UPDATE public.subdomains
SET parent_domain = 'https://trayedit.com'
WHERE site_code = 'tray-decor' AND (parent_domain IS NULL OR parent_domain = '');
