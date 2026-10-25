-- ==============================================================================
-- Migrasi Skema Tabel Sinkronisasi Meta & Daily Stats TigerROI
-- Versi: 20261025000001_create_jobs_meta_schema.sql
-- ==============================================================================

-- 1. TABEL SITES (Pemetaan site_code TigerROI)
CREATE TABLE IF NOT EXISTS public.sites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site_code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    domain TEXT,
    campaign_pattern TEXT, -- Kode / pola regex / keyword nama campaign Meta (misal: "pBRw", "ihop")
    pic TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sites_site_code ON public.sites(site_code);

-- Mengisi awal sites dari subdomains yang sudah ada jika ada
INSERT INTO public.sites (site_code, name, domain, campaign_pattern, pic, is_active)
SELECT 
    site_code, 
    name, 
    parent_domain, 
    campaign_codes, 
    pic, 
    CASE WHEN status = 'Active' THEN true ELSE false END
FROM public.subdomains
ON CONFLICT (site_code) DO NOTHING;

-- 2. TABEL META_ACCOUNTS (Mendukung banyak ad account / portfolio)
CREATE TABLE IF NOT EXISTS public.meta_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id TEXT NOT NULL UNIQUE, -- Contoh: act_123456789
    name TEXT NOT NULL,
    access_token TEXT, -- Token khusus akun jika berbeda (jika NULL pakai default META_ACCESS_TOKEN dari secrets)
    currency TEXT NOT NULL DEFAULT 'IDR',
    balance NUMERIC(15, 2) DEFAULT 0,
    spend_cap NUMERIC(15, 2) DEFAULT 0,
    amount_spent NUMERIC(15, 2) DEFAULT 0,
    spend_today NUMERIC(15, 2) DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    last_synced_at TIMESTAMPTZ,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_meta_accounts_act ON public.meta_accounts(account_id);

-- Sinkronisasi awal dari ad_accounts lama jika ada
INSERT INTO public.meta_accounts (account_id, name, currency, balance, spend_cap, amount_spent, is_active)
SELECT 
    account_id, 
    name, 
    currency, 
    balance, 
    spend_cap, 
    amount_spent, 
    CASE WHEN status = 'ACTIVE' THEN true ELSE false END
FROM public.ad_accounts
ON CONFLICT (account_id) DO NOTHING;

-- 3. TABEL DAILY_STATS (Penyimpanan gabungan harian dengan kunci unik: date + site_code + source)
CREATE TABLE IF NOT EXISTS public.daily_stats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    date DATE NOT NULL,
    site_code TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'meta', -- 'meta', 'gam', 'adsense', 'keitaro'
    spend NUMERIC(15, 2) NOT NULL DEFAULT 0,
    revenue NUMERIC(15, 2) NOT NULL DEFAULT 0,
    profit NUMERIC(15, 2) GENERATED ALWAYS AS (revenue - spend) STORED,
    roi_percent NUMERIC(8, 2) DEFAULT 0,
    impressions INTEGER NOT NULL DEFAULT 0,
    clicks INTEGER NOT NULL DEFAULT 0,
    cpc NUMERIC(10, 4) DEFAULT 0,
    campaign_count INTEGER DEFAULT 0,
    meta_account_id TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_daily_stats UNIQUE (date, site_code, source)
);

CREATE INDEX IF NOT EXISTS idx_daily_stats_lookup ON public.daily_stats(date, site_code, source);

-- ==============================================================================
-- 4. ROW LEVEL SECURITY (RLS) & POLICIES
-- ==============================================================================

ALTER TABLE public.sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_stats ENABLE ROW LEVEL SECURITY;

-- Policy sites
DROP POLICY IF EXISTS "sites_select_authenticated" ON public.sites;
CREATE POLICY "sites_select_authenticated" ON public.sites
    FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "sites_service_role_all" ON public.sites;
CREATE POLICY "sites_service_role_all" ON public.sites
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Policy meta_accounts (Hanya admin & service_role yang dapat melihat detail akun iklan)
DROP POLICY IF EXISTS "meta_accounts_select_admin" ON public.meta_accounts;
CREATE POLICY "meta_accounts_select_admin" ON public.meta_accounts
    FOR SELECT TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "meta_accounts_service_role_all" ON public.meta_accounts;
CREATE POLICY "meta_accounts_service_role_all" ON public.meta_accounts
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Policy daily_stats (Dapat dibaca oleh semua pengguna terautentikasi)
DROP POLICY IF EXISTS "daily_stats_select_authenticated" ON public.daily_stats;
CREATE POLICY "daily_stats_select_authenticated" ON public.daily_stats
    FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "daily_stats_service_role_all" ON public.daily_stats;
CREATE POLICY "daily_stats_service_role_all" ON public.daily_stats
    FOR ALL TO service_role USING (true) WITH CHECK (true);
