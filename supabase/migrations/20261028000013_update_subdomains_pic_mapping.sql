-- ==============================================================================
-- UPDATE PIC ADVERTISER PADA 17 SUBDOMAIN RESMI TIGERROI
-- Versi: 20261028000013_update_subdomains_pic_mapping.sql
-- ==============================================================================

-- 1. Update nama PIC pada tiap subdomain
UPDATE public.subdomains SET pic = 'Mul' WHERE name IN ('careers', 'careers.tiktokmodapk.net');
UPDATE public.subdomains SET pic = 'Sul' WHERE name IN ('insurance', 'insurance.tiktokmodapk.net');
UPDATE public.subdomains SET pic = 'Nur' WHERE name IN ('rewards', 'rewards.tiktokmodapk.net');
UPDATE public.subdomains SET pic = 'Man' WHERE name IN ('mod', 'mod.tiktokmodapk.net');
UPDATE public.subdomains SET pic = NULL WHERE name IN ('cantina', 'cantina.tacobellmenuu.us');
UPDATE public.subdomains SET pic = 'Sul' WHERE name IN ('burrito', 'burrito.tacobellmenuu.us');
UPDATE public.subdomains SET pic = NULL WHERE name IN ('fries', 'fries.tacobellmenuu.us');
UPDATE public.subdomains SET pic = 'Nur' WHERE name IN ('decor', 'decor.trayedit.com');
UPDATE public.subdomains SET pic = 'Man' WHERE name IN ('materials', 'materials.trayedit.com');
UPDATE public.subdomains SET pic = 'Sul' WHERE name IN ('cabinets', 'cabinets.trayedit.com');
UPDATE public.subdomains SET pic = 'Mul' WHERE name IN ('guides', 'guides.trayedit.com');
UPDATE public.subdomains SET pic = NULL WHERE name IN ('styling', 'styling.trayedit.com');
UPDATE public.subdomains SET pic = 'Sul' WHERE name IN ('menu', 'menu.ihopmenuwithprices.us');
UPDATE public.subdomains SET pic = 'Mul' WHERE name IN ('deals', 'deals.ihopmenuwithprices.us');
UPDATE public.subdomains SET pic = 'Man' WHERE name IN ('keto', 'keto.ihopmenuwithprices.us');
UPDATE public.subdomains SET pic = 'Nur' WHERE name IN ('hacks', 'hacks.ihopmenuwithprices.us');
UPDATE public.subdomains SET pic = NULL WHERE name IN ('news', 'news.ihopmenuwithprices.us');

-- 2. Sambungkan pic_user_id dari tabel public.profiles bila profil pengguna ditemukan
UPDATE public.subdomains s
SET pic_user_id = p.id
FROM public.profiles p
WHERE (
    (s.pic = 'Mul' AND (p.name ILIKE '%Mul%' OR p.email ILIKE '%amul%')) OR
    (s.pic = 'Sul' AND (p.name ILIKE '%Sul%' OR p.email ILIKE '%sul%')) OR
    (s.pic = 'Nur' AND (p.name ILIKE '%Nur%' OR p.email ILIKE '%nur%')) OR
    (s.pic = 'Man' AND (p.name ILIKE '%Man%' OR p.email ILIKE '%man%'))
);
