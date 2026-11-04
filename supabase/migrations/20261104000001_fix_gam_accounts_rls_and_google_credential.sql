-- ==============================================================================
-- Migrasi: Perbaikan RLS gam_accounts, domains, subdomains & Kolom google_credential
-- Versi: 20261104000001_fix_gam_accounts_rls_and_google_credential.sql
-- ==============================================================================

-- 1. Tambahkan kolom google_credential jika belum ada
ALTER TABLE public.gam_accounts ADD COLUMN IF NOT EXISTS google_credential TEXT;

-- 2. Pastikan RLS tetap aktif namun memiliki policy eksplisit untuk operasi CRUD pada gam_accounts
ALTER TABLE public.gam_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gam_accounts_select_all" ON public.gam_accounts;
DROP POLICY IF EXISTS "gam_accounts_admin_all" ON public.gam_accounts;
DROP POLICY IF EXISTS "gam_accounts_manage_all" ON public.gam_accounts;
DROP POLICY IF EXISTS "gam_accounts_all_auth" ON public.gam_accounts;

CREATE POLICY "gam_accounts_select_all" ON public.gam_accounts
    FOR SELECT TO public USING (true);

CREATE POLICY "gam_accounts_manage_all" ON public.gam_accounts
    FOR ALL TO public USING (true) WITH CHECK (true);

-- 3. Selaraskan RLS pada domains & subdomains agar penambahan dari dashboard selalu lancar
ALTER TABLE public.domains ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "domains_select_all" ON public.domains;
DROP POLICY IF EXISTS "domains_manage_all" ON public.domains;
CREATE POLICY "domains_select_all" ON public.domains
    FOR SELECT TO public USING (true);
CREATE POLICY "domains_manage_all" ON public.domains
    FOR ALL TO public USING (true) WITH CHECK (true);

ALTER TABLE public.subdomains ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "subdomains_select_all" ON public.subdomains;
DROP POLICY IF EXISTS "subdomains_manage_all" ON public.subdomains;
CREATE POLICY "subdomains_select_all" ON public.subdomains
    FOR SELECT TO public USING (true);
CREATE POLICY "subdomains_manage_all" ON public.subdomains
    FOR ALL TO public USING (true) WITH CHECK (true);
