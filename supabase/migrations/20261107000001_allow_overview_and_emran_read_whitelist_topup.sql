-- ==============================================================================
-- Migrasi: Izinkan seluruh user terautentikasi membaca data whitelist_topup
-- Supaya angka Total TopUp (TU) dan ROI Founder tampil sama persis dengan Superadmin.
-- Hak tulis (INSERT, UPDATE, DELETE) tetap dibatasi HANYA Keuangan & Admin.
-- ==============================================================================

BEGIN;

-- 1. Helper function untuk memeriksa apakah user saat ini adalah role overview atau akun Emran
CREATE OR REPLACE FUNCTION public.is_overview()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.profiles 
        WHERE id = auth.uid() 
        AND (
            role LIKE '%overview%' 
            OR email ILIKE '%emraankhattak%' 
            OR email ILIKE '%emran%' 
            OR username ILIKE '%emran%'
        )
    );
$$;

-- 2. Perbarui policy SELECT pada public.whitelist_topup (izinkan semua authenticated user membaca data topup)
DROP POLICY IF EXISTS "whitelist_topup_select" ON public.whitelist_topup;
DROP POLICY IF EXISTS "whitelist_keuangan_all" ON public.whitelist_topup;

CREATE POLICY "whitelist_topup_select" ON public.whitelist_topup
    FOR SELECT TO authenticated
    USING (true);

-- 3. Pastikan hak tulis (INSERT, UPDATE, DELETE) tetap eksklusif Keuangan & Admin
DROP POLICY IF EXISTS "whitelist_topup_insert" ON public.whitelist_topup;
CREATE POLICY "whitelist_topup_insert" ON public.whitelist_topup
    FOR INSERT TO authenticated
    WITH CHECK (public.is_keuangan() OR public.is_admin());

DROP POLICY IF EXISTS "whitelist_topup_update" ON public.whitelist_topup;
CREATE POLICY "whitelist_topup_update" ON public.whitelist_topup
    FOR UPDATE TO authenticated
    USING (public.is_keuangan() OR public.is_admin())
    WITH CHECK (public.is_keuangan() OR public.is_admin());

DROP POLICY IF EXISTS "whitelist_topup_delete" ON public.whitelist_topup;
CREATE POLICY "whitelist_topup_delete" ON public.whitelist_topup
    FOR DELETE TO authenticated
    USING (public.is_keuangan() OR public.is_admin());

-- 4. Pastikan user Emran memiliki role 'overview' pada profiles
UPDATE public.profiles
SET role = 'overview'
WHERE email ILIKE '%emraankhattak%' OR username ILIKE '%emran%';

COMMIT;
