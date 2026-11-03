-- ==============================================================================
-- MIGRASI: KANONISASI SUBDOMAIN PADA TABEL ROI_SNAPSHOTS DAN DAILY_STATS
-- File: 20261103000002_canonicalize_subdomains_in_snapshots.sql
-- Keterangan: Mengubah seluruh slug subdomain singkat (contoh 'decor', 'materials',
--             'careers', dll) menjadi nama domain lengkap resmi (FQDN)
--             agar tidak terjadi duplikasi data antara slug dan FQDN.
-- ==============================================================================

BEGIN;

-- 1. Kanonisasi pada tabel roi_snapshots
UPDATE public.roi_snapshots SET sub_domain = 'menu.ihopmenuwithprices.us' WHERE sub_domain = 'menu';
UPDATE public.roi_snapshots SET sub_domain = 'deals.ihopmenuwithprices.us' WHERE sub_domain = 'deals';
UPDATE public.roi_snapshots SET sub_domain = 'keto.ihopmenuwithprices.us' WHERE sub_domain = 'keto';
UPDATE public.roi_snapshots SET sub_domain = 'hacks.ihopmenuwithprices.us' WHERE sub_domain = 'hacks';
UPDATE public.roi_snapshots SET sub_domain = 'news.ihopmenuwithprices.us' WHERE sub_domain = 'news';

UPDATE public.roi_snapshots SET sub_domain = 'cantina.tacobellmenuu.us' WHERE sub_domain = 'cantina';
UPDATE public.roi_snapshots SET sub_domain = 'burrito.tacobellmenuu.us' WHERE sub_domain = 'burrito';
UPDATE public.roi_snapshots SET sub_domain = 'fries.tacobellmenuu.us' WHERE sub_domain = 'fries';

UPDATE public.roi_snapshots SET sub_domain = 'insurance.tiktokmodapk.net' WHERE sub_domain = 'insurance';
UPDATE public.roi_snapshots SET sub_domain = 'careers.tiktokmodapk.net' WHERE sub_domain = 'careers';
UPDATE public.roi_snapshots SET sub_domain = 'rewards.tiktokmodapk.net' WHERE sub_domain = 'rewards';
UPDATE public.roi_snapshots SET sub_domain = 'mod.tiktokmodapk.net' WHERE sub_domain = 'mod';

UPDATE public.roi_snapshots SET sub_domain = 'decor.trayedit.com' WHERE sub_domain = 'decor';
UPDATE public.roi_snapshots SET sub_domain = 'materials.trayedit.com' WHERE sub_domain = 'materials';
UPDATE public.roi_snapshots SET sub_domain = 'cabinets.trayedit.com' WHERE sub_domain = 'cabinets';
UPDATE public.roi_snapshots SET sub_domain = 'guides.trayedit.com' WHERE sub_domain = 'guides';
UPDATE public.roi_snapshots SET sub_domain = 'styling.trayedit.com' WHERE sub_domain = 'styling';

-- 2. Update pic yang masih kosong/strip pada roi_snapshots yang sudah dikanonisasi
UPDATE public.roi_snapshots s
SET pic = sub.pic
FROM public.subdomains sub
WHERE s.sub_domain = sub.name
  AND (s.pic = '' OR s.pic = '-' OR s.pic IS NULL)
  AND sub.pic IS NOT NULL AND sub.pic != '' AND sub.pic != '-';

COMMIT;

