-- ==============================================================================
-- EKSPOR RIWAYAT LAPORAN ROI REALTIME (JAM 01:00 S/D 21:00) DARI SUPABASE CLOUD LAMA
-- Petunjuk:
-- 1. Buka SQL Editor di SUPABASE CLOUD LAMA (https://supabase.com/dashboard)
-- 2. Jalankan query di bawah ini.
-- 3. Copy seluruh baris hasil kolom `sql_insert` (atau klik Download CSV/Copy).
-- 4. Buka SQL Editor di SUPABASE HETZNER BARU (http://<IP_HETZNER>:3000), paste dan RUN!
-- ==============================================================================

SELECT 
    'INSERT INTO public.roi_snapshots SELECT * FROM json_populate_record(NULL::public.roi_snapshots, ' || 
    quote_literal(row_to_json(t)::text) || 
    '::json) ON CONFLICT (id) DO NOTHING;' AS sql_insert
FROM public.roi_snapshots t
WHERE date >= '2026-11-01'
ORDER BY date ASC, time ASC;

