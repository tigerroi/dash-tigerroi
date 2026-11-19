-- Migrasi Pembaruan Zona Waktu Resmi Google Ad Manager foodsfact.org menjadi America/Denver
-- Versi: 20261119000002_set_foodsfact_timezone_america_denver.sql
-- Keterangan: Menyelaraskan zona waktu jaringan GAM foodsfact.org (network 21869641910)
--             ke America/Denver (Mountain Time, MST/MDT) sehingga perhitungan cut-off harian
--             antara spending Meta Ads dan earning GAM tidak menghasilkan ROI minus karena beda tanggal.

UPDATE public.gam_accounts
SET report_time_zone = 'America/Denver',
    updated_at = NOW()
WHERE network_code = '21869641910'
   OR name ILIKE '%foodsfact%';
