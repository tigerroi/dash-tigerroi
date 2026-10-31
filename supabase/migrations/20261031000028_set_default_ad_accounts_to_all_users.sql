-- ==============================================================================
-- MIGRASI 28: SET DEFAULT USER_OWNER PADA AD_ACCOUNTS KE 'Semua User'
-- Versi: 20261031000028_set_default_ad_accounts_to_all_users.sql
-- Keterangan: Akun Meta Ads digunakan bersama oleh seluruh tim (1 untuk semua).
--             Akun iklan yang belum memiliki pemilik disetel ke 'Semua User'.
-- ==============================================================================

-- 1. Perbarui akun iklan yang belum memiliki user_owner agar menjadi 'Semua User'
UPDATE public.ad_accounts
SET user_owner = 'Semua User'
WHERE user_owner IS NULL 
   OR TRIM(user_owner) = '' 
   OR TRIM(user_owner) = 'Tanpa pemilik (opsional)';

-- 2. Jadikan 'Semua User' sebagai nilai bawaan (default) pada kolom user_owner
ALTER TABLE public.ad_accounts 
ALTER COLUMN user_owner SET DEFAULT 'Semua User';
