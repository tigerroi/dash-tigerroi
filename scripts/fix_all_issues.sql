-- ==============================================================================
-- TIGERROI - PERBAIKAN UNIFIKASI 5 ADVERTISER RESMI & DATA RELASI DOMAIN
-- Jalankan query ini di SQL Editor Supabase Studio Hetzner (http://<IP_HETZNER>:3000)
-- ==============================================================================

SET session_replication_role = 'replica'; -- Matikan foreign key sementara

-- 1. Sinkronkan parent_domain_id di subdomains ke ID domain yang benar-benar ada di tabel domains
UPDATE public.subdomains s
SET parent_domain_id = d.id
FROM public.domains d
WHERE s.parent_domain = d.domain_url
   OR s.name LIKE '%.' || d.domain_url;

-- 2. Satukan nama PIC di subdomains HANYA ke 5 nama resmi:
UPDATE public.subdomains SET pic = 'Sullivan' WHERE pic ILIKE 'Sul%' OR pic ILIKE 'Sullivan%' OR pic ILIKE 'Zulfan%' OR pic ILIKE 'Sulfin%';
UPDATE public.subdomains SET pic = 'Moskov' WHERE pic ILIKE 'Mul%' OR pic ILIKE 'Amul%' OR pic ILIKE 'Moskov%' OR pic ILIKE 'Mulyana%';
UPDATE public.subdomains SET pic = 'Austin' WHERE pic ILIKE 'Man%' OR pic ILIKE 'Austin%' OR pic ILIKE '%Suparman%' OR pic ILIKE 'Ade%';
UPDATE public.subdomains SET pic = 'New York City' WHERE pic ILIKE 'Nur%' OR pic ILIKE 'New York City%' OR pic ILIKE 'Nurjaman%';
UPDATE public.subdomains SET pic = 'Crissthoper' WHERE pic ILIKE 'Cris%' OR pic ILIKE 'Crissthoper%';

-- 3. Satukan nama PIC di tabel account_closes (jika ada data lama):
UPDATE public.account_closes SET pic = 'Sullivan' WHERE pic ILIKE 'Sul%' OR pic ILIKE 'Sullivan%' OR pic ILIKE 'Zulfan%' OR pic ILIKE 'Sulfin%';
UPDATE public.account_closes SET pic = 'Moskov' WHERE pic ILIKE 'Mul%' OR pic ILIKE 'Amul%' OR pic ILIKE 'Moskov%' OR pic ILIKE 'Mulyana%';
UPDATE public.account_closes SET pic = 'Austin' WHERE pic ILIKE 'Man%' OR pic ILIKE 'Austin%' OR pic ILIKE '%Suparman%' OR pic ILIKE 'Ade%';
UPDATE public.account_closes SET pic = 'New York City' WHERE pic ILIKE 'Nur%' OR pic ILIKE 'New York City%' OR pic ILIKE 'Nurjaman%';
UPDATE public.account_closes SET pic = 'Crissthoper' WHERE pic ILIKE 'Cris%' OR pic ILIKE 'Crissthoper%';

-- 3b. Satukan nama PIC di tabel roi_snapshots:
UPDATE public.roi_snapshots SET pic = 'Sullivan' WHERE pic ILIKE 'Sul%' OR pic ILIKE 'Sullivan%' OR pic ILIKE 'Zulfan%' OR pic ILIKE 'Sulfin%';
UPDATE public.roi_snapshots SET pic = 'Moskov' WHERE pic ILIKE 'Mul%' OR pic ILIKE 'Amul%' OR pic ILIKE 'Moskov%' OR pic ILIKE 'Mulyana%';
UPDATE public.roi_snapshots SET pic = 'Austin' WHERE pic ILIKE 'Man%' OR pic ILIKE 'Austin%' OR pic ILIKE '%Suparman%' OR pic ILIKE 'Ade%';
UPDATE public.roi_snapshots SET pic = 'New York City' WHERE pic ILIKE 'Nur%' OR pic ILIKE 'New York City%' OR pic ILIKE 'Nurjaman%';
UPDATE public.roi_snapshots SET pic = 'Crissthoper' WHERE pic ILIKE 'Cris%' OR pic ILIKE 'Crissthoper%';

-- 4. Hubungkan pic_user_id di subdomains ke ID profil yang sesuai
UPDATE public.subdomains s
SET pic_user_id = p.id
FROM public.profiles p
WHERE s.pic = p.name;

-- 5. Bersihkan tabel bonus_percents dari nama singkatan lama
DELETE FROM public.bonus_percents 
WHERE user_name IN ('Sul', 'Mul', 'Man', 'Nur', 'Cris')
   OR "user" IN ('Sul', 'Mul', 'Man', 'Nur', 'Cris');

-- Pastikan hanya 5 nama resmi ini yang memiliki tarif bonus aktif
DELETE FROM public.bonus_percents WHERE user_name IN ('Sullivan', 'Moskov', 'Austin', 'New York City', 'Crissthoper');

INSERT INTO public.bonus_percents (user_name, "user", percent, month, effective_from, status)
VALUES
  ('Sullivan', 'Sullivan', 15, '2026-10', '2026-10-01', 'Active'),
  ('Moskov', 'Moskov', 15, '2026-10', '2026-10-01', 'Active'),
  ('Austin', 'Austin', 15, '2026-10', '2026-10-01', 'Active'),
  ('New York City', 'New York City', 15, '2026-10', '2026-10-01', 'Active'),
  ('Crissthoper', 'Crissthoper', 15, '2026-11', '2026-11-01', 'Active');

-- 6. Pastikan nama di tabel profiles seragam 100%
UPDATE public.profiles SET name = 'Sullivan', username = 'Sullivan' WHERE email = 'sul@tigerroi.com';
UPDATE public.profiles SET name = 'Moskov', username = 'Moskov' WHERE email = 'amul@tigerroi.com';
UPDATE public.profiles SET name = 'Austin', username = 'Austin' WHERE email = 'man@tigerroi.com';
UPDATE public.profiles SET name = 'New York City', username = 'New York City' WHERE email = 'nurjaman@tigerroi.com';
UPDATE public.profiles SET name = 'Crissthoper', username = 'Crissthoper' WHERE email = 'cris@tigerroi.com';

SET session_replication_role = 'origin'; -- Nyalakan kembali foreign key

