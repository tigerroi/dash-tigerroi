-- Migrasi Normalisasi Penamaan Subdomain di Tabel country_roi
-- Menyelaraskan seluruh slug pendek menjadi nama domain lengkap (FQDN) resmi
-- agar data teragregasi utuh dalam satu subdomain resmi dan tidak terpecah dua.

BEGIN;

-- 1. Tray Edit (trayedit.com)
UPDATE public.country_roi SET sub_domain = 'cabinets.trayedit.com' WHERE sub_domain = 'cabinets';
UPDATE public.country_roi SET sub_domain = 'decor.trayedit.com' WHERE sub_domain = 'decor';
UPDATE public.country_roi SET sub_domain = 'materials.trayedit.com' WHERE sub_domain = 'materials';
UPDATE public.country_roi SET sub_domain = 'guides.trayedit.com' WHERE sub_domain = 'guides';
UPDATE public.country_roi SET sub_domain = 'styling.trayedit.com' WHERE sub_domain = 'styling';

-- 2. TikTok Mod APK (tiktokmodapk.net)
UPDATE public.country_roi SET sub_domain = 'insurance.tiktokmodapk.net' WHERE sub_domain = 'insurance';
UPDATE public.country_roi SET sub_domain = 'careers.tiktokmodapk.net' WHERE sub_domain = 'careers';
UPDATE public.country_roi SET sub_domain = 'rewards.tiktokmodapk.net' WHERE sub_domain = 'rewards';
UPDATE public.country_roi SET sub_domain = 'mod.tiktokmodapk.net' WHERE sub_domain = 'mod';

-- 3. Taco Bell (tacobellmenuu.us)
UPDATE public.country_roi SET sub_domain = 'cantina.tacobellmenuu.us' WHERE sub_domain = 'cantina';
UPDATE public.country_roi SET sub_domain = 'burrito.tacobellmenuu.us' WHERE sub_domain = 'burrito';
UPDATE public.country_roi SET sub_domain = 'fries.tacobellmenuu.us' WHERE sub_domain = 'fries';

-- 4. IHOP (ihopmenuwithprices.us)
UPDATE public.country_roi SET sub_domain = 'menu.ihopmenuwithprices.us' WHERE sub_domain = 'menu';
UPDATE public.country_roi SET sub_domain = 'deals.ihopmenuwithprices.us' WHERE sub_domain = 'deals';
UPDATE public.country_roi SET sub_domain = 'keto.ihopmenuwithprices.us' WHERE sub_domain = 'keto';
UPDATE public.country_roi SET sub_domain = 'hacks.ihopmenuwithprices.us' WHERE sub_domain = 'hacks';
UPDATE public.country_roi SET sub_domain = 'news.ihopmenuwithprices.us' WHERE sub_domain = 'news';

COMMIT;
