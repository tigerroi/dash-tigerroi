-- ==============================================================================
-- Migrasi: Izinkan Pengguna Terautentikasi / Admin Menyimpan Data Impor ke daily_stats
-- Versi: 20261026000006_allow_daily_stats_import_rls.sql
-- ==============================================================================

-- Berikan izin INSERT, UPDATE, dan DELETE pada daily_stats untuk pengguna terautentikasi (admin/superadmin)
DROP POLICY IF EXISTS "daily_stats_authenticated_manage" ON public.daily_stats;
DROP POLICY IF EXISTS "daily_stats_admin_manage" ON public.daily_stats;

CREATE POLICY "daily_stats_authenticated_manage" ON public.daily_stats
    FOR ALL TO authenticated
    USING (true)
    WITH CHECK (true);
