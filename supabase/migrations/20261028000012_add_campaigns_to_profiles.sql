-- ==============================================================================
-- TAMBAH KOLOM campaigns PADA TABEL public.profiles
-- Versi: 20261028000012_add_campaigns_to_profiles.sql
-- ==============================================================================

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS campaigns JSONB DEFAULT '[]'::jsonb;
