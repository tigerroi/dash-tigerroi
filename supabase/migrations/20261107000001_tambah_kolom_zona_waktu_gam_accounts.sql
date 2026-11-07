-- ==============================================================================
-- Migrasi: Penambahan Kolom Zona Waktu dan Waktu Terakhir Sinkronisasi pada Akun GAM
-- ==============================================================================

ALTER TABLE public.gam_accounts ADD COLUMN IF NOT EXISTS report_time_zone TEXT;
ALTER TABLE public.gam_accounts ADD COLUMN IF NOT EXISTS last_sync_time TEXT;

-- Perbarui zona waktu resmi masing-masing network Google Ad Manager sesuai setelan akun
UPDATE public.gam_accounts SET report_time_zone = 'GMT+1' WHERE name ILIKE '%cmhhealths%' OR network_code = '23350466753';
UPDATE public.gam_accounts SET report_time_zone = 'GMT+6' WHERE name ILIKE '%trayedit%' OR network_code = '23344333667';
UPDATE public.gam_accounts SET report_time_zone = 'GMT+5' WHERE name ILIKE '%tiktokmod%' OR network_code = '23367555867';
UPDATE public.gam_accounts SET report_time_zone = 'GMT+5' WHERE name ILIKE '%tacobell%' OR network_code = '23380486168';
UPDATE public.gam_accounts SET report_time_zone = 'GMT-3' WHERE name ILIKE '%ihop%' OR network_code = '23340206616';
UPDATE public.gam_accounts SET report_time_zone = 'GMT+6' WHERE name ILIKE '%uniqueinfo%' OR network_code = '23342288590';
