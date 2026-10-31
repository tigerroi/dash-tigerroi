-- ==============================================================================
-- Migrasi: Perbaikan Skema Modul Accounting & Sinkronisasi Tarif Bonus
-- Versi: 20261031000027_fix_accounting_tables_and_bonus_percents.sql
-- ==============================================================================

-- 1. TABEL TARIF BONUS (bonus_percents): Tambahkan kolom "user" & trigger sinkronisasi
ALTER TABLE public.bonus_percents ADD COLUMN IF NOT EXISTS "user" TEXT;

UPDATE public.bonus_percents 
SET "user" = user_name 
WHERE "user" IS NULL AND user_name IS NOT NULL;

UPDATE public.bonus_percents 
SET user_name = "user" 
WHERE user_name IS NULL AND "user" IS NOT NULL;

CREATE OR REPLACE FUNCTION public.sync_bonus_percents_user()
RETURNS TRIGGER AS $$
BEGIN
    NEW.user_name := COALESCE(NEW."user", NEW.user_name);
    NEW."user" := COALESCE(NEW."user", NEW.user_name);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_bonus_percents_user ON public.bonus_percents;
CREATE TRIGGER trg_sync_bonus_percents_user
BEFORE INSERT OR UPDATE ON public.bonus_percents
FOR EACH ROW EXECUTE FUNCTION public.sync_bonus_percents_user();

-- 2. TABEL BIAYA AD EXCHANGE (adx_costs): Tambahkan kolom yang dibutuhkan form
ALTER TABLE public.adx_costs ADD COLUMN IF NOT EXISTS ratio TEXT;
ALTER TABLE public.adx_costs ADD COLUMN IF NOT EXISTS cost_usd NUMERIC;
ALTER TABLE public.adx_costs ADD COLUMN IF NOT EXISTS nominal NUMERIC;
ALTER TABLE public.adx_costs ADD COLUMN IF NOT EXISTS approval_status TEXT DEFAULT 'Approve';
ALTER TABLE public.adx_costs ADD COLUMN IF NOT EXISTS setup_adx TEXT DEFAULT 'Belum';
ALTER TABLE public.adx_costs ADD COLUMN IF NOT EXISTS setup_sub TEXT DEFAULT 'Belum';
ALTER TABLE public.adx_costs ADD COLUMN IF NOT EXISTS network_code TEXT;
ALTER TABLE public.adx_costs ADD COLUMN IF NOT EXISTS email TEXT;

-- Sinkronisasi awal nominal dari amount jika ada
UPDATE public.adx_costs SET nominal = amount WHERE nominal IS NULL AND amount IS NOT NULL;
UPDATE public.adx_costs SET amount = nominal WHERE amount IS NULL AND nominal IS NOT NULL;
UPDATE public.adx_costs SET cost_usd = cost WHERE cost_usd IS NULL AND cost IS NOT NULL;
UPDATE public.adx_costs SET cost = cost_usd WHERE cost IS NULL AND cost_usd IS NOT NULL;

-- 3. TABEL INVALID TRAFFIC (invalid_traffic): Tambahkan kolom yang dibutuhkan form
ALTER TABLE public.invalid_traffic ADD COLUMN IF NOT EXISTS date DATE;
ALTER TABLE public.invalid_traffic ADD COLUMN IF NOT EXISTS earning_manual NUMERIC;
ALTER TABLE public.invalid_traffic ADD COLUMN IF NOT EXISTS total_spending_manual NUMERIC;
ALTER TABLE public.invalid_traffic ADD COLUMN IF NOT EXISTS check1 NUMERIC DEFAULT 0;
ALTER TABLE public.invalid_traffic ADD COLUMN IF NOT EXISTS check2 NUMERIC DEFAULT 0;
ALTER TABLE public.invalid_traffic ADD COLUMN IF NOT EXISTS check3 NUMERIC DEFAULT 0;
ALTER TABLE public.invalid_traffic ADD COLUMN IF NOT EXISTS nominal NUMERIC DEFAULT 0;

UPDATE public.invalid_traffic SET nominal = amount WHERE (nominal IS NULL OR nominal = 0) AND amount IS NOT NULL;
UPDATE public.invalid_traffic SET amount = nominal WHERE amount IS NULL AND nominal IS NOT NULL;

-- 4. TABEL PENCAIRAN (payouts) & AKUN DITUTUP (account_closes)
ALTER TABLE public.payouts ADD COLUMN IF NOT EXISTS date DATE;
ALTER TABLE public.payouts ADD COLUMN IF NOT EXISTS nominal_pencairan NUMERIC;
ALTER TABLE public.payouts ADD COLUMN IF NOT EXISTS fee_nominal NUMERIC;
ALTER TABLE public.payouts ADD COLUMN IF NOT EXISTS real_masuk NUMERIC;
ALTER TABLE public.payouts ADD COLUMN IF NOT EXISTS bank TEXT;
ALTER TABLE public.payouts ADD COLUMN IF NOT EXISTS nama_rekening TEXT;
ALTER TABLE public.payouts ADD COLUMN IF NOT EXISTS no_rekening TEXT;
ALTER TABLE public.payouts ADD COLUMN IF NOT EXISTS kode_pip TEXT;

ALTER TABLE public.account_closes ADD COLUMN IF NOT EXISTS month TEXT;
ALTER TABLE public.account_closes ADD COLUMN IF NOT EXISTS date DATE;
ALTER TABLE public.account_closes ADD COLUMN IF NOT EXISTS pic TEXT;
ALTER TABLE public.account_closes ADD COLUMN IF NOT EXISTS account_type TEXT;
ALTER TABLE public.account_closes ADD COLUMN IF NOT EXISTS sub_domain TEXT;
ALTER TABLE public.account_closes ADD COLUMN IF NOT EXISTS earning NUMERIC;
ALTER TABLE public.account_closes ADD COLUMN IF NOT EXISTS total_spending NUMERIC;

-- 5. PASTIKAN ROW LEVEL SECURITY (RLS) POLICIES AKTIF DENGAN ATURAN EKSPLISIT
ALTER TABLE public.bonus_percents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.adx_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invalid_traffic ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_closes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bonus_percents_all_auth" ON public.bonus_percents;
DROP POLICY IF EXISTS "bonus_percents_anon_select" ON public.bonus_percents;
DROP POLICY IF EXISTS "bonus_percents_public_all" ON public.bonus_percents;
CREATE POLICY "bonus_percents_public_all" ON public.bonus_percents
    FOR ALL TO public USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "adx_costs_all_auth" ON public.adx_costs;
DROP POLICY IF EXISTS "adx_costs_anon_select" ON public.adx_costs;
DROP POLICY IF EXISTS "adx_costs_public_all" ON public.adx_costs;
CREATE POLICY "adx_costs_public_all" ON public.adx_costs
    FOR ALL TO public USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "invalid_traffic_all_auth" ON public.invalid_traffic;
DROP POLICY IF EXISTS "invalid_traffic_anon_select" ON public.invalid_traffic;
DROP POLICY IF EXISTS "invalid_traffic_public_all" ON public.invalid_traffic;
CREATE POLICY "invalid_traffic_public_all" ON public.invalid_traffic
    FOR ALL TO public USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "payouts_all_auth" ON public.payouts;
DROP POLICY IF EXISTS "payouts_anon_select" ON public.payouts;
DROP POLICY IF EXISTS "payouts_public_all" ON public.payouts;
CREATE POLICY "payouts_public_all" ON public.payouts
    FOR ALL TO public USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "account_closes_all_auth" ON public.account_closes;
DROP POLICY IF EXISTS "account_closes_anon_select" ON public.account_closes;
DROP POLICY IF EXISTS "account_closes_public_all" ON public.account_closes;
CREATE POLICY "account_closes_public_all" ON public.account_closes
    FOR ALL TO public USING (true) WITH CHECK (true);

