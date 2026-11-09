-- ==============================================================================
-- MIGRASI 25: NORMALISASI WAKTU SNAPSHOT KE JAM GENAP (HH:00)
-- File: 20261104000002_normalize_roi_snapshots_hourly_time.sql
-- Keterangan: Mengubah format waktu snapshot menjadi jam pas (:00) dari 00:00 s/d 23:00
--             agar riwayat Laporan ROI Realtime urut dan konsisten jam demi jam.
-- ==============================================================================

UPDATE public.roi_snapshots
SET time = SUBSTRING(time FROM 1 FOR 2) || ':00'
WHERE time ~ '^[0-2][0-9]:[0-9]{2}$'
  AND time NOT LIKE '%:00';

