-- ==============================================================================
-- Migrasi: Perbaikan Pemetaan pic_user_id pada 17 Subdomain
-- Versi: 20261101000004_perbaiki_pemetaan_pic_user_subdomains.sql
-- Keterangan:
-- Sebelumnya pada migrasi lama terdapat ketidaksengajaan pencocokan wildcard '%Man%'
-- yang menyebabkan 'Nurjaman' ikut terhubung ke subdomain milik Man / Ade Suparman
-- (mod, materials, keto) sehingga Nurjaman tampak memegang 6 subdomain di profilnya.
-- Migrasi ini menyelaraskan pic dan pic_user_id secara tepat sesuai kepemilikan riil:
-- - Nurjaman: 3 sub (rewards, decor, hacks)
-- - Ade Suparman (Man): 3 sub (mod, materials, keto)
-- - Mulyana (Mul): 3 sub (careers, guides, deals)
-- - Zulfan (Sul): 4 sub (insurance, burrito, cabinets, menu)
-- - Belum Ditugaskan: 4 sub (cantina, fries, styling, news)
-- ==============================================================================

BEGIN;

-- 1. Reset pic_user_id terlebih dahulu
UPDATE public.subdomains SET pic_user_id = NULL;

-- 2. Nurjaman (3 subdomain)
UPDATE public.subdomains
SET pic = 'Nurjaman',
    pic_user_id = (SELECT id FROM public.profiles WHERE email ILIKE '%nurjaman%' OR name ILIKE '%nurjaman%' LIMIT 1)
WHERE name IN ('rewards', 'rewards.tiktokmodapk.net', 'decor', 'decor.trayedit.com', 'hacks', 'hacks.ihopmenuwithprices.us');

-- 3. Ade Suparman / Man (3 subdomain)
UPDATE public.subdomains
SET pic = 'Man',
    pic_user_id = (SELECT id FROM public.profiles WHERE (email ILIKE '%man@tigerroi%' OR name ILIKE '%ade suparman%') AND email NOT ILIKE '%nurjaman%' LIMIT 1)
WHERE name IN ('mod', 'mod.tiktokmodapk.net', 'materials', 'materials.trayedit.com', 'keto', 'keto.ihopmenuwithprices.us');

-- 4. Mulyana / Mul (3 subdomain)
UPDATE public.subdomains
SET pic = 'Mul',
    pic_user_id = (SELECT id FROM public.profiles WHERE email ILIKE '%amul%' OR name ILIKE '%mulyana%' LIMIT 1)
WHERE name IN ('careers', 'careers.tiktokmodapk.net', 'guides', 'guides.trayedit.com', 'deals', 'deals.ihopmenuwithprices.us');

-- 5. Zulfan / Sul (4 subdomain)
UPDATE public.subdomains
SET pic = 'Sul',
    pic_user_id = (SELECT id FROM public.profiles WHERE email ILIKE '%sul%' OR email ILIKE '%zulfan%' OR name ILIKE '%zulfan%' LIMIT 1)
WHERE name IN ('insurance', 'insurance.tiktokmodapk.net', 'burrito', 'burrito.tacobellmenuu.us', 'cabinets', 'cabinets.trayedit.com', 'menu', 'menu.ihopmenuwithprices.us');

-- 6. Unassigned / Belum ada yang pegang (4 subdomain)
UPDATE public.subdomains
SET pic = NULL,
    pic_user_id = NULL
WHERE name IN ('cantina', 'cantina.tacobellmenuu.us', 'fries', 'fries.tacobellmenuu.us', 'styling', 'styling.trayedit.com', 'news', 'news.ihopmenuwithprices.us');

-- 7. Trigger otomatis: Saat pic diubah di form UI, sinkronkan pic_user_id ke profil yang benar
CREATE OR REPLACE FUNCTION public.sync_subdomain_pic_user_id()
RETURNS TRIGGER AS $$
DECLARE
    v_clean_pic TEXT;
    v_target_user_id UUID;
BEGIN
    v_clean_pic := LOWER(TRIM(COALESCE(NEW.pic, '')));
    
    IF v_clean_pic = '' OR v_clean_pic = '-' THEN
        NEW.pic_user_id := NULL;
        RETURN NEW;
    END IF;

    -- Cari user id yang paling cocok berdasarkan nama, username, atau email
    SELECT id INTO v_target_user_id
    FROM public.profiles
    WHERE LOWER(TRIM(name)) = v_clean_pic
       OR LOWER(TRIM(username)) = v_clean_pic
       OR LOWER(TRIM(email)) = v_clean_pic
       OR (v_clean_pic IN ('nur', 'nurjaman') AND (LOWER(name) ILIKE '%nurjaman%' OR LOWER(email) ILIKE '%nurjaman%'))
       OR (v_clean_pic IN ('man', 'ade', 'ade suparman') AND (LOWER(name) ILIKE '%suparman%' OR LOWER(email) ILIKE '%man@tigerroi%'))
       OR (v_clean_pic IN ('mul', 'mulyana') AND (LOWER(name) ILIKE '%mulyana%' OR LOWER(email) ILIKE '%amul%'))
       OR (v_clean_pic IN ('sul', 'zulfan', 'sulfin') AND (LOWER(name) ILIKE '%zulfan%' OR LOWER(email) ILIKE '%sul%'))
    ORDER BY CASE 
        WHEN LOWER(TRIM(name)) = v_clean_pic THEN 1
        WHEN LOWER(TRIM(username)) = v_clean_pic THEN 2
        ELSE 3
    END
    LIMIT 1;

    NEW.pic_user_id := v_target_user_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_sync_subdomain_pic_user_id ON public.subdomains;
CREATE TRIGGER trg_sync_subdomain_pic_user_id
BEFORE INSERT OR UPDATE OF pic ON public.subdomains
FOR EACH ROW
EXECUTE FUNCTION public.sync_subdomain_pic_user_id();

COMMIT;
