-- ==============================================================================
-- MIGRASI 22: TAMBAH KOLOM COUNTRY DAN AD APPROVAL PADA TABEL DOMAINS
-- Versi: 20261029000022_add_country_and_audit_to_domains.sql
-- Keterangan: Menambahkan kolom country (Negara rantai pembayaran), ad_approval,
--             dan ad_approval_at pada tabel domains agar form Edit Domain
--             dapat menyimpan data negara tanpa error skema.
-- ==============================================================================

ALTER TABLE public.domains ADD COLUMN IF NOT EXISTS country TEXT DEFAULT '';
ALTER TABLE public.domains ADD COLUMN IF NOT EXISTS ad_approval TEXT DEFAULT 'Approved';
ALTER TABLE public.domains ADD COLUMN IF NOT EXISTS ad_approval_at TIMESTAMPTZ;
