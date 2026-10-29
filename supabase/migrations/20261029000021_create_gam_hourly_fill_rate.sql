-- ==============================================================================
-- MIGRASI 21: TABEL DATA RASIO PENAYANGAN AD EXCHANGE PER JAM (GAM HOURLY FILL RATE)
-- Versi: 20261029000021_create_gam_hourly_fill_rate.sql
-- Keterangan: Menyimpan data total permintaan (req) dan tayangan (imp) per jam
--             dari Google Ad Manager untuk grafik & tabel Rasio Penayangan.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.gam_hourly_fill_rate (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    date DATE NOT NULL,
    hour TEXT NOT NULL,           -- '00' s/d '23'
    site_key TEXT NOT NULL,       -- hostname misal careers.tiktokmodapk.net atau format kode
    requests INTEGER NOT NULL DEFAULT 0,
    impressions INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_gam_hourly_fill_rate UNIQUE (date, hour, site_key)
);

CREATE INDEX IF NOT EXISTS idx_gam_hourly_lookup 
ON public.gam_hourly_fill_rate(date, site_key);

-- Aktifkan Row Level Security (RLS) sesuai aturan wajib
ALTER TABLE public.gam_hourly_fill_rate ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gam_hourly_fill_rate_select" ON public.gam_hourly_fill_rate
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "gam_hourly_fill_rate_admin" ON public.gam_hourly_fill_rate
    FOR ALL TO authenticated USING (public.is_admin());

