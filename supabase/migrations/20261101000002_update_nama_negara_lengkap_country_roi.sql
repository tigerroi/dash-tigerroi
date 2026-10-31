-- ==============================================================================
-- Migrasi Penyelarasan Nama Negara Lengkap di Tabel country_roi
-- Memperbarui baris lama yang masih menyimpan kode singkatan ISO 2-huruf
-- menjadi nama negara lengkap (misal 'Serbia', 'Romania', 'Bulgaria')
-- sesuai dengan standar pelaporan Google Ad Manager (GAM).
-- ==============================================================================

BEGIN;

UPDATE public.country_roi SET country_name = 'Serbia' WHERE country_code = 'RS' AND (country_name = 'RS' OR country_name IS NULL);
UPDATE public.country_roi SET country_name = 'Romania' WHERE country_code = 'RO' AND (country_name = 'RO' OR country_name IS NULL);
UPDATE public.country_roi SET country_name = 'Bulgaria' WHERE country_code = 'BG' AND (country_name = 'BG' OR country_name IS NULL);
UPDATE public.country_roi SET country_name = 'Slovakia' WHERE country_code = 'SK' AND (country_name = 'SK' OR country_name IS NULL);
UPDATE public.country_roi SET country_name = 'Hungary' WHERE country_code = 'HU' AND (country_name = 'HU' OR country_name IS NULL);
UPDATE public.country_roi SET country_name = 'France' WHERE country_code = 'FR' AND (country_name = 'FR' OR country_name IS NULL);
UPDATE public.country_roi SET country_name = 'Italy' WHERE country_code = 'IT' AND (country_name = 'IT' OR country_name IS NULL);
UPDATE public.country_roi SET country_name = 'Poland' WHERE country_code = 'PL' AND (country_name = 'PL' OR country_name IS NULL);
UPDATE public.country_roi SET country_name = 'Portugal' WHERE country_code = 'PT' AND (country_name = 'PT' OR country_name IS NULL);
UPDATE public.country_roi SET country_name = 'Spain' WHERE country_code = 'ES' AND (country_name = 'ES' OR country_name IS NULL);
UPDATE public.country_roi SET country_name = 'Lithuania' WHERE country_code = 'LT' AND (country_name = 'LT' OR country_name IS NULL);
UPDATE public.country_roi SET country_name = 'Latvia' WHERE country_code = 'LV' AND (country_name = 'LV' OR country_name IS NULL);
UPDATE public.country_roi SET country_name = 'Malta' WHERE country_code = 'MT' AND (country_name = 'MT' OR country_name IS NULL);
UPDATE public.country_roi SET country_name = 'Greece' WHERE country_code = 'GR' AND (country_name = 'GR' OR country_name IS NULL);
UPDATE public.country_roi SET country_name = 'Germany' WHERE country_code = 'DE' AND (country_name = 'DE' OR country_name IS NULL);
UPDATE public.country_roi SET country_name = 'Czechia' WHERE country_code = 'CZ' AND (country_name = 'CZ' OR country_name IS NULL);
UPDATE public.country_roi SET country_name = 'Croatia' WHERE country_code = 'HR' AND (country_name = 'HR' OR country_name IS NULL);
UPDATE public.country_roi SET country_name = 'Denmark' WHERE country_code = 'DK' AND (country_name = 'DK' OR country_name IS NULL);
UPDATE public.country_roi SET country_name = 'Belgium' WHERE country_code = 'BE' AND (country_name = 'BE' OR country_name IS NULL);
UPDATE public.country_roi SET country_name = 'Estonia' WHERE country_code = 'EE' AND (country_name = 'EE' OR country_name IS NULL);
UPDATE public.country_roi SET country_name = 'United States' WHERE country_code = 'US' AND (country_name = 'US' OR country_name IS NULL);
UPDATE public.country_roi SET country_name = 'United Kingdom' WHERE country_code = 'GB' AND (country_name = 'GB' OR country_name IS NULL);
UPDATE public.country_roi SET country_name = 'Netherlands' WHERE country_code = 'NL' AND (country_name = 'NL' OR country_name IS NULL);
UPDATE public.country_roi SET country_name = 'Austria' WHERE country_code = 'AT' AND (country_name = 'AT' OR country_name IS NULL);
UPDATE public.country_roi SET country_name = 'Sweden' WHERE country_code = 'SE' AND (country_name = 'SE' OR country_name IS NULL);
UPDATE public.country_roi SET country_name = 'Norway' WHERE country_code = 'NO' AND (country_name = 'NO' OR country_name IS NULL);
UPDATE public.country_roi SET country_name = 'Finland' WHERE country_code = 'FI' AND (country_name = 'FI' OR country_name IS NULL);
UPDATE public.country_roi SET country_name = 'Ireland' WHERE country_code = 'IE' AND (country_name = 'IE' OR country_name IS NULL);
UPDATE public.country_roi SET country_name = 'Switzerland' WHERE country_code = 'CH' AND (country_name = 'CH' OR country_name IS NULL);

COMMIT;
