-- ==============================================================================
-- MIGRASI: BERSIHKAN PROTOKOL HTTPS/HTTP DARI DOMAIN DAN SUBDOMAIN
-- Versi: 20261103000001_clean_domain_urls_remove_protocol.sql
-- Keterangan: Memastikan nama domain pada tabel public.domains dan public.subdomains
--             tersimpan bersih sebagai nama host murni (contoh: tigerroi.com),
--             tanpa protokol https:// atau http://.
-- ==============================================================================

BEGIN;

-- 1. Bersihkan domain_url pada tabel public.domains
UPDATE public.domains
SET domain_url = lower(regexp_replace(regexp_replace(domain_url, '^https?://', '', 'i'), '/+$', ''))
WHERE domain_url ~* '^https?://';

-- 2. Bersihkan parent_domain pada tabel public.subdomains
UPDATE public.subdomains
SET parent_domain = lower(regexp_replace(regexp_replace(parent_domain, '^https?://', '', 'i'), '/+$', ''))
WHERE parent_domain ~* '^https?://';

COMMIT;
