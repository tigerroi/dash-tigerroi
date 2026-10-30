-- ==============================================================================
-- MIGRASI 25: IZINKAN BACA PUBLIK TABEL BREAKDOWN NEGARA (country_roi)
-- ==============================================================================
-- Agar frontend TigerROI yang menggunakan anon key dapat membaca rincian
-- breakdown negara di tab Laporan ROI Realtime dan Profile User.

DROP POLICY IF EXISTS "country_roi_select" ON public.country_roi;

CREATE POLICY "country_roi_select" ON public.country_roi
    FOR SELECT TO public USING (true);

