-- ==============================================================================
-- MIGRASI: PENAMBAHAN KOLOM CTR GOVERNOR KE TABEL SUBDOMAINS
-- File: 20261111000003_add_ctr_governor_to_subdomains.sql
--
-- Tujuan:
-- Menyimpan metrik CTR GAM hari ini dan status governor ('safe' atau 'emergency')
-- di tabel subdomains sehingga plugin WordPress bisa membaca status secara instan
-- menggunakan anon key dengan performa tinggi.
-- ==============================================================================

ALTER TABLE public.subdomains 
ADD COLUMN IF NOT EXISTS ctr_today numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS ctr_status text DEFAULT 'safe';

