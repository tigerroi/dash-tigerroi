-- ==============================================================================
-- MIGRASI 35: NORMALISASI ANGKA EARNING, PROFIT, DAN ROI DI TABEL COUNTRY_ROI
-- Versi: 20261101000005_perbaiki_angka_meledak_country_roi.sql
-- Keterangan: Membagi kembali nilai earning yang terlanjur terkalikan ganda
--             dengan kurs USD (18.155,28) karena data GAM aslinya sudah IDR murni.
-- ==============================================================================

BEGIN;

UPDATE public.country_roi
SET 
    earning = ROUND(earning / 18155.28, 2),
    profit = ROUND((earning / 18155.28) - (spend * 1.05), 2),
    roi = CASE 
        WHEN spend > 0 THEN ROUND(((((earning / 18155.28) - (spend * 1.05)) / (spend * 1.05)) * 100)::numeric, 2)
        ELSE 0 
    END
WHERE earning > 10000000; -- Hanya baris yang terlanjur membengkak di atas 10 juta rupiah per negara

COMMIT;

