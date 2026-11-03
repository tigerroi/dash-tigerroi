-- ==============================================================================
-- MIGRASI: BERSIHKAN PROTOKOL HTTPS/HTTP DAN HAPUS DOMAIN INTERNAL TIGERROI
-- Versi: 20261103000001_clean_domain_urls_remove_protocol.sql
-- Keterangan: Memastikan nama domain pada tabel public.domains dan public.subdomains
--             tersimpan bersih sebagai nama host murni (contoh: cmhhealths.com),
--             tanpa protokol https:// atau http://, serta menghapus domain
--             infrastruktur internal (tigerroi.com & asset.tigerroi.com).
-- ==============================================================================

BEGIN;

-- 1. Hapus domain infrastruktur internal tigerroi.com dari tabel domain & subdomain
DELETE FROM public.subdomains WHERE name ILIKE '%tigerroi.com%' OR parent_domain ILIKE '%tigerroi.com%';
DELETE FROM public.domains WHERE domain_url ILIKE '%tigerroi.com%';

-- 2. Bersihkan domain_url pada tabel public.domains
UPDATE public.domains
SET domain_url = lower(regexp_replace(regexp_replace(domain_url, '^https?://', '', 'i'), '/+$', ''))
WHERE domain_url ~* '^https?://';

-- 3. Bersihkan parent_domain pada tabel public.subdomains
UPDATE public.subdomains
SET parent_domain = lower(regexp_replace(regexp_replace(parent_domain, '^https?://', '', 'i'), '/+$', ''))
WHERE parent_domain ~* '^https?://';

COMMIT;
