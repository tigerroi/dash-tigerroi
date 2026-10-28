-- ==============================================================================
-- BERSIHKAN TOKEN KADALUARSA PADA TABEL meta_accounts
-- Versi: 20261028000011_clear_stale_meta_access_token.sql
-- ==============================================================================

-- Kosongkan kolom access_token di meta_accounts agar selalu menggunakan
-- META_ACCESS_TOKEN resmi yang tersimpan aman di GitHub Secrets (environment)
UPDATE public.meta_accounts
SET access_token = NULL;
