-- ==============================================================================
-- Migrasi Perluasan Presisi Kolom Numerik Tabel country_roi
-- Mencegah terjadinya error 'numeric field overflow' pada saat ROI melonjak tinggi
-- (misalnya negara dengan spend mendekati nol namun memiliki pendapatan GAM).
-- ==============================================================================

BEGIN;

-- Perluas presisi kolom roi dan cpc dari NUMERIC(8,2) menjadi NUMERIC(15,2)
ALTER TABLE public.country_roi
  ALTER COLUMN roi TYPE NUMERIC(15, 2),
  ALTER COLUMN cpc TYPE NUMERIC(15, 2);

COMMIT;
