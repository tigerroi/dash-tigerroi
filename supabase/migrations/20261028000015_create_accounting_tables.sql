-- ==============================================================================
-- MIGRASI 15: BUAT TABEL-TABEL PENDUKUNG MODUL ACCOUNTING
-- Versi: 20261028000015_create_accounting_tables.sql
-- Keterangan: Menyediakan tabel untuk Potongan Company, Tarif Bonus,
--             Invalid Traffic, Cost Ad Exchange, Pencairan, dan Akun Ditutup.
-- ==============================================================================

-- 1. TABEL POTONGAN COMPANY (company_percents)
CREATE TABLE IF NOT EXISTS public.company_percents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    domain TEXT NOT NULL,
    percent NUMERIC,
    effective_from DATE NOT NULL,
    company_name TEXT,
    note TEXT,
    status TEXT NOT NULL DEFAULT 'Active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.company_percents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "company_percents_all_auth" ON public.company_percents
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "company_percents_anon_select" ON public.company_percents
    FOR SELECT TO anon USING (true);

-- 2. TABEL TARIF BONUS ADVERTISER (bonus_percents)
CREATE TABLE IF NOT EXISTS public.bonus_percents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_name TEXT,
    user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    percent NUMERIC,
    month TEXT,
    effective_from DATE NOT NULL,
    note TEXT,
    status TEXT NOT NULL DEFAULT 'Active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.bonus_percents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bonus_percents_all_auth" ON public.bonus_percents
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "bonus_percents_anon_select" ON public.bonus_percents
    FOR SELECT TO anon USING (true);

-- 3. TABEL INVALID TRAFFIC (invalid_traffic)
CREATE TABLE IF NOT EXISTS public.invalid_traffic (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    domain TEXT NOT NULL,
    month TEXT NOT NULL,
    account_type TEXT,
    data_source TEXT,
    amount NUMERIC,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.invalid_traffic ENABLE ROW LEVEL SECURITY;
CREATE POLICY "invalid_traffic_all_auth" ON public.invalid_traffic
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "invalid_traffic_anon_select" ON public.invalid_traffic
    FOR SELECT TO anon USING (true);

-- 4. TABEL BIAYA AD EXCHANGE (adx_costs)
CREATE TABLE IF NOT EXISTS public.adx_costs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    domain TEXT NOT NULL,
    date DATE NOT NULL,
    company_name TEXT,
    cost NUMERIC,
    amount NUMERIC,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.adx_costs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "adx_costs_all_auth" ON public.adx_costs
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "adx_costs_anon_select" ON public.adx_costs
    FOR SELECT TO anon USING (true);

-- 5. TABEL PENCAIRAN (payouts)
CREATE TABLE IF NOT EXISTS public.payouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    domain TEXT,
    month TEXT,
    amount NUMERIC,
    status TEXT,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.payouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payouts_all_auth" ON public.payouts
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "payouts_anon_select" ON public.payouts
    FOR SELECT TO anon USING (true);

-- 6. TABEL AKUN DITUTUP (account_closes)
CREATE TABLE IF NOT EXISTS public.account_closes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id TEXT,
    account_name TEXT,
    closed_at DATE,
    reason TEXT,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.account_closes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "account_closes_all_auth" ON public.account_closes
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "account_closes_anon_select" ON public.account_closes
    FOR SELECT TO anon USING (true);
