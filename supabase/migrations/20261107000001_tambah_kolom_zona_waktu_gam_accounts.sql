-- ==============================================================================
-- Migrasi: Penambahan Kolom Zona Waktu dan Waktu Terakhir Sinkronisasi pada Akun GAM
-- ==============================================================================

ALTER TABLE public.gam_accounts ADD COLUMN IF NOT EXISTS report_time_zone TEXT;
ALTER TABLE public.gam_accounts ADD COLUMN IF NOT EXISTS last_sync_time TEXT;

-- Perbarui zona waktu awal untuk akun Google Ad Manager utama
UPDATE public.gam_accounts SET report_time_zone = 'America/New_York' WHERE name = 'trayedit.com' OR network_code = '23344333667';
UPDATE public.gam_accounts SET report_time_zone = 'America/New_York' WHERE name = 'tiktokmodapk.net' OR network_code = '23367555867';
UPDATE public.gam_accounts SET report_time_zone = 'Asia/Kolkata' WHERE name = 'tacobellmenuu.us' OR network_code = '23380486168';
UPDATE public.gam_accounts SET report_time_zone = 'America/New_York' WHERE name = 'ihopmenuwithprices.us' OR network_code = '23340206616';
UPDATE public.gam_accounts SET report_time_zone = 'America/New_York' WHERE name = 'cmhhealths.com' OR network_code = '23350466753';
UPDATE public.gam_accounts SET report_time_zone = 'America/New_York' WHERE name = 'uniqueinfo24.com' OR network_code = '23342288590';

