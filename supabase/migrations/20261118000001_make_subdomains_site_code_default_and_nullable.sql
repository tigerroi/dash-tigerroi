-- ==============================================================================
-- MIGRASI: BUAT SITE_CODE DI TABEL SUBDOMAINS MEMILIKI DEFAULT VALUE
-- File: 20261118000001_make_subdomains_site_code_default_and_nullable.sql
--
-- Tujuan:
-- Menghindari error NOT NULL constraint saat menambahkan subdomain baru dari UI dashboard.
-- Jika site_code kosong, trigger Postgres otomatis mengisinya dari campaign_codes atau slug nama.
-- ==============================================================================

ALTER TABLE public.subdomains ALTER COLUMN site_code DROP NOT NULL;
ALTER TABLE public.subdomains ALTER COLUMN site_code SET DEFAULT '';

CREATE OR REPLACE FUNCTION public.set_default_subdomain_site_code()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.site_code IS NULL OR trim(NEW.site_code) = '' THEN
        IF NEW.campaign_codes IS NOT NULL AND trim(NEW.campaign_codes) <> '' THEN
            NEW.site_code := trim(split_part(NEW.campaign_codes, ',', 1));
        ELSE
            NEW.site_code := split_part(NEW.name, '.', 1);
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_subdomains_site_code ON public.subdomains;
CREATE TRIGGER trg_set_subdomains_site_code
BEFORE INSERT OR UPDATE ON public.subdomains
FOR EACH ROW
EXECUTE FUNCTION public.set_default_subdomain_site_code();
