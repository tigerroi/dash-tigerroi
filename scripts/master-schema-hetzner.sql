-- ==============================================================================
-- MASTER SKEMA LENGKAP TIGERROI UNTUK SUPABASE SELF-HOSTED HETZNER
-- ==============================================================================



-- >>> FILE: 20261025000000_init_tigerroi_schema.sql <<<
-- ==============================================================================
-- Migrasi Awal Skema Database TigerROI (Supabase PostgreSQL + RLS)
-- Versi: 20261025000000_init_tigerroi_schema.sql
-- ==============================================================================

-- 1. Ekstensi UUID dan Kriptografi
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ==============================================================================
-- 2. TABEL PROFIL PENGGUNA (profiles)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    username TEXT UNIQUE,
    email TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user', -- superadmin, admin, user, advertiser, keuangan, guest
    telegram_chat_id TEXT,
    notification_topics JSONB DEFAULT '{"reminders": true, "roiAlerts": true, "syncIssues": true}'::jsonb,
    total_balance NUMERIC(15, 2) DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ==============================================================================
-- 3. TABEL DOMAIN UTAMA (domains)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.domains (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    domain_url TEXT NOT NULL UNIQUE,
    network_code TEXT, -- GAM MCM Network Code
    user_owner TEXT,
    status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Inactive')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ==============================================================================
-- 4. TABEL SUBDOMAIN (subdomains)
-- ==============================================================================
-- Kunci penggabungan data: site_code (ihop-menu, tray-decor, taco-fries, tiktok-mod)
CREATE TABLE IF NOT EXISTS public.subdomains (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    site_code TEXT NOT NULL,
    parent_domain_id UUID REFERENCES public.domains(id) ON DELETE SET NULL,
    parent_domain TEXT,
    pic TEXT,
    pic_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    campaign_codes TEXT, -- Kode link Keitaro tracker (misal: "pBRw, TvH1")
    status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Inactive')),
    cpc NUMERIC(10, 4) DEFAULT 0,
    ecpm NUMERIC(10, 4) DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subdomains_site_code ON public.subdomains(site_code);
CREATE INDEX IF NOT EXISTS idx_subdomains_pic_user ON public.subdomains(pic_user_id);

-- ==============================================================================
-- 5. TABEL AKUN IKLAN META (ad_accounts)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.ad_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id TEXT NOT NULL UNIQUE, -- format: act_123456789
    name TEXT NOT NULL,
    user_owner TEXT,
    pic_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    currency TEXT NOT NULL DEFAULT 'IDR',
    balance NUMERIC(15, 2) DEFAULT 0,
    spend_cap NUMERIC(15, 2) DEFAULT 0,
    amount_spent NUMERIC(15, 2) DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ==============================================================================
-- 6. TABEL AKUN ADSENSE (adsense_accounts)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.adsense_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    publisher_id TEXT NOT NULL UNIQUE, -- format: pub-123456789
    name TEXT NOT NULL,
    google_credential TEXT,
    status TEXT NOT NULL DEFAULT 'Active',
    balance NUMERIC(15, 2) DEFAULT 0,
    last_sync TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ==============================================================================
-- 7. TABEL KREDENSIAL GOOGLE OAUTH (google_api_configs)
-- Rahasia Admin: Client Secret & Refresh Token untuk GAM & AdSense
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.google_api_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    client_id TEXT NOT NULL,
    client_secret TEXT NOT NULL,
    refresh_token TEXT,
    status TEXT NOT NULL DEFAULT 'Connected',
    last_auth_action_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ==============================================================================
-- 8. TABEL SPEND HARIAN META (meta_daily_spend)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.meta_daily_spend (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    date DATE NOT NULL,
    site_code TEXT NOT NULL,
    account_id TEXT NOT NULL,
    campaign_id TEXT NOT NULL,
    campaign_name TEXT,
    spend NUMERIC(15, 2) NOT NULL DEFAULT 0,
    impressions INTEGER NOT NULL DEFAULT 0,
    clicks INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_meta_daily_spend UNIQUE (date, account_id, campaign_id)
);

CREATE INDEX IF NOT EXISTS idx_meta_spend_date_site ON public.meta_daily_spend(date, site_code);

-- ==============================================================================
-- 9. TABEL REVENUE HARIAN GAM & ADSENSE (gam_daily_revenue)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.gam_daily_revenue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    date DATE NOT NULL,
    site_code TEXT NOT NULL,
    ad_unit_name TEXT NOT NULL,
    adx_revenue NUMERIC(15, 2) NOT NULL DEFAULT 0,
    adsense_revenue NUMERIC(15, 2) NOT NULL DEFAULT 0,
    impressions INTEGER NOT NULL DEFAULT 0,
    clicks INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_gam_daily_revenue UNIQUE (date, site_code, ad_unit_name)
);

CREATE INDEX IF NOT EXISTS idx_gam_revenue_date_site ON public.gam_daily_revenue(date, site_code);

-- ==============================================================================
-- 10. TABEL LAPORAN ROI HARIAN (daily_roi_reports)
-- Snapshot gabungan harian per site_code
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.daily_roi_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    date DATE NOT NULL,
    site_code TEXT NOT NULL,
    sub_domain TEXT,
    pic TEXT,
    meta_spend NUMERIC(15, 2) NOT NULL DEFAULT 0,
    gam_revenue NUMERIC(15, 2) NOT NULL DEFAULT 0,
    adsense_revenue NUMERIC(15, 2) NOT NULL DEFAULT 0,
    total_revenue NUMERIC(15, 2) GENERATED ALWAYS AS (gam_revenue + adsense_revenue) STORED,
    profit NUMERIC(15, 2) GENERATED ALWAYS AS ((gam_revenue + adsense_revenue) - meta_spend) STORED,
    roi_percent NUMERIC(8, 2) DEFAULT 0,
    clicks INTEGER NOT NULL DEFAULT 0,
    cpc NUMERIC(10, 2) DEFAULT 0,
    impressions INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_daily_roi_site UNIQUE (date, site_code)
);

CREATE INDEX IF NOT EXISTS idx_roi_reports_date ON public.daily_roi_reports(date);
CREATE INDEX IF NOT EXISTS idx_roi_reports_site_code ON public.daily_roi_reports(site_code);

-- ==============================================================================
-- 11. VIEW LAPORAN ROI AGREGAT (view_daily_roi)
-- Menghitung: profit = revenue - spend per site_code per hari secara realtime
-- ==============================================================================
DROP VIEW IF EXISTS public.view_daily_financials CASCADE;
DROP VIEW IF EXISTS public.view_daily_roi CASCADE;
CREATE OR REPLACE VIEW public.view_daily_roi AS
WITH combined_dates AS (
    SELECT DISTINCT date, site_code FROM public.meta_daily_spend
    UNION
    SELECT DISTINCT date, site_code FROM public.gam_daily_revenue
),
aggregated_spend AS (
    SELECT 
        date,
        site_code,
        COALESCE(SUM(spend), 0) AS total_spend,
        COALESCE(SUM(impressions), 0) AS total_impressions,
        COALESCE(SUM(clicks), 0) AS total_clicks
    FROM public.meta_daily_spend
    GROUP BY date, site_code
),
aggregated_rev AS (
    SELECT 
        date,
        site_code,
        COALESCE(SUM(adx_revenue), 0) AS total_adx,
        COALESCE(SUM(adsense_revenue), 0) AS total_adsense,
        COALESCE(SUM(adx_revenue + adsense_revenue), 0) AS total_rev
    FROM public.gam_daily_revenue
    GROUP BY date, site_code
)
SELECT 
    c.date,
    c.site_code,
    COALESCE(s.name, c.site_code) AS sub_domain,
    COALESCE(s.pic, 'Tanpa PIC') AS pic,
    COALESCE(sp.total_spend, 0) AS meta_spend,
    COALESCE(rv.total_adx, 0) AS adx_revenue,
    COALESCE(rv.total_adsense, 0) AS adsense_revenue,
    COALESCE(rv.total_rev, 0) AS total_revenue,
    COALESCE(rv.total_rev, 0) - COALESCE(sp.total_spend, 0) AS profit,
    CASE 
        WHEN COALESCE(sp.total_spend, 0) > 0 THEN 
            ROUND(((COALESCE(rv.total_rev, 0) - COALESCE(sp.total_spend, 0)) / sp.total_spend * 100)::numeric, 2)
        ELSE 0 
    END AS roi_percent,
    COALESCE(sp.total_clicks, 0) AS clicks,
    COALESCE(sp.total_impressions, 0) AS impressions,
    CASE 
        WHEN COALESCE(sp.total_clicks, 0) > 0 THEN 
            ROUND((COALESCE(sp.total_spend, 0) / sp.total_clicks)::numeric, 2)
        ELSE 0 
    END AS cpc
FROM combined_dates c
LEFT JOIN aggregated_spend sp ON sp.date = c.date AND sp.site_code = c.site_code
LEFT JOIN aggregated_rev rv ON rv.date = c.date AND rv.site_code = c.site_code
LEFT JOIN public.subdomains s ON s.site_code = c.site_code;

-- ==============================================================================
-- 12. TABEL BREAKDOWN NEGARA (country_roi)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.country_roi (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    date DATE NOT NULL,
    sub_domain TEXT NOT NULL,
    country_code TEXT NOT NULL,
    country_name TEXT,
    spend NUMERIC(15, 2) NOT NULL DEFAULT 0,
    impressions INTEGER NOT NULL DEFAULT 0,
    clicks INTEGER NOT NULL DEFAULT 0,
    cpc NUMERIC(10, 2) DEFAULT 0,
    earning NUMERIC(15, 2) NOT NULL DEFAULT 0,
    profit NUMERIC(15, 2) NOT NULL DEFAULT 0,
    roi NUMERIC(8, 2) DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_country_roi UNIQUE (date, sub_domain, country_code)
);

CREATE INDEX IF NOT EXISTS idx_country_roi_date ON public.country_roi(date);

-- ==============================================================================
-- 13. TABEL EXPENSES & WHITELIST TOPUP (Keuangan / Admin)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.expenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    date DATE NOT NULL,
    category TEXT NOT NULL,
    description TEXT,
    amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
    pic TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.whitelist_topup (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    date DATE NOT NULL,
    account_code TEXT NOT NULL,
    amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
    fee NUMERIC(15, 2) NOT NULL DEFAULT 0,
    total NUMERIC(15, 2) NOT NULL DEFAULT 0,
    pic TEXT,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ==============================================================================
-- 14. TABEL REMINDERS (Pengingat Tagihan Domain/Server)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.reminders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    due_date DATE NOT NULL,
    amount NUMERIC(15, 2) DEFAULT 0,
    category TEXT DEFAULT 'domain', -- domain, hosting, tools
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed')),
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ==============================================================================
-- 15. TABEL PLUGIN WORDPRESS (plugin_sites & plugin_keys)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.plugin_sites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subdomain_id UUID REFERENCES public.subdomains(id) ON DELETE CASCADE,
    site_host TEXT NOT NULL UNIQUE,
    enrolled BOOLEAN NOT NULL DEFAULT false,
    plugin_version TEXT,
    php_version TEXT,
    wp_version TEXT,
    last_ping_at TIMESTAMPTZ,
    last_error TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- KUNCI RAHASIA: Tidak ada policy SELECT untuk authenticated user!
CREATE TABLE IF NOT EXISTS public.plugin_keys (
    subdomain_id UUID PRIMARY KEY REFERENCES public.subdomains(id) ON DELETE CASCADE,
    api_key TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ==============================================================================
-- 16. TABEL LOG SINKRONISASI CRON (sync_runs)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.sync_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_name TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed')),
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    rows_synced INTEGER DEFAULT 0,
    error_message TEXT,
    details JSONB
);

CREATE INDEX IF NOT EXISTS idx_sync_runs_started ON public.sync_runs(started_at DESC);

-- ==============================================================================
-- 17. TRIGGER OTOMATIS: AUTO INSERT PROFILES SAAT USER DAFTAR DI AUTH.USERS
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
    INSERT INTO public.profiles (id, email, name, role)
    VALUES (
        new.id,
        new.email,
        COALESCE(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
        COALESCE(new.raw_user_meta_data->>'role', 'user')
    )
    ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email;
    RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ==============================================================================
-- 18. FUNGSI PEMERIKSA ROLE (HELPER FUNCTIONS UNTUK RLS)
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.get_current_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.profiles 
        WHERE id = auth.uid() 
        AND (role LIKE '%admin%' OR role LIKE '%superadmin%')
    );
$$;

CREATE OR REPLACE FUNCTION public.is_keuangan()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.profiles 
        WHERE id = auth.uid() 
        AND (role LIKE '%keuangan%' OR role LIKE '%admin%' OR role LIKE '%superadmin%')
    );
$$;

-- ==============================================================================
-- 19. AKTIFKAN ROW LEVEL SECURITY (RLS) DI SELURUH TABEL
-- ==============================================================================
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subdomains ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.adsense_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_api_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_daily_spend ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gam_daily_revenue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_roi_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.country_roi ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whitelist_topup ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plugin_sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plugin_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_runs ENABLE ROW LEVEL SECURITY;

-- ==============================================================================
-- 20. DEFINISI POLICIES RLS (ROLE-BASED EXPLICIT POLICIES)
-- ==============================================================================

-- A. PROFILES
CREATE POLICY "profiles_select_auth" ON public.profiles
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "profiles_update_self" ON public.profiles
    FOR UPDATE TO authenticated 
    USING (id = auth.uid() OR public.is_admin())
    WITH CHECK (
        public.is_admin() OR 
        (id = auth.uid() AND role = (SELECT role FROM public.profiles WHERE id = auth.uid()))
    );

CREATE POLICY "profiles_admin_all" ON public.profiles
    FOR ALL TO authenticated USING (public.is_admin());

-- B. DOMAINS
CREATE POLICY "domains_select_auth" ON public.domains
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "domains_admin_all" ON public.domains
    FOR ALL TO authenticated USING (public.is_admin());

-- C. SUBDOMAINS
CREATE POLICY "subdomains_select_auth" ON public.subdomains
    FOR SELECT TO authenticated 
    USING (public.is_admin() OR pic_user_id = auth.uid() OR public.is_keuangan());

CREATE POLICY "subdomains_admin_all" ON public.subdomains
    FOR ALL TO authenticated USING (public.is_admin());

-- D. AD_ACCOUNTS
CREATE POLICY "ad_accounts_select_auth" ON public.ad_accounts
    FOR SELECT TO authenticated 
    USING (public.is_admin() OR pic_user_id = auth.uid() OR public.is_keuangan());

CREATE POLICY "ad_accounts_admin_all" ON public.ad_accounts
    FOR ALL TO authenticated USING (public.is_admin());

-- E. ADSENSE_ACCOUNTS (Hanya Keuangan & Admin)
CREATE POLICY "adsense_accounts_keuangan_select" ON public.adsense_accounts
    FOR SELECT TO authenticated USING (public.is_keuangan());

CREATE POLICY "adsense_accounts_admin_all" ON public.adsense_accounts
    FOR ALL TO authenticated USING (public.is_admin());

-- F. GOOGLE_API_CONFIGS (Sangat Rahasia: Hanya Admin/Superadmin)
CREATE POLICY "google_configs_admin_all" ON public.google_api_configs
    FOR ALL TO authenticated USING (public.is_admin());

-- G. META_DAILY_SPEND, GAM_DAILY_REVENUE, DAILY_ROI_REPORTS, COUNTRY_ROI
CREATE POLICY "meta_spend_select" ON public.meta_daily_spend
    FOR SELECT TO authenticated USING (true);
CREATE POLICY "meta_spend_admin" ON public.meta_daily_spend
    FOR ALL TO authenticated USING (public.is_admin());

CREATE POLICY "gam_rev_select" ON public.gam_daily_revenue
    FOR SELECT TO authenticated USING (true);
CREATE POLICY "gam_rev_admin" ON public.gam_daily_revenue
    FOR ALL TO authenticated USING (public.is_admin());

CREATE POLICY "roi_reports_select" ON public.daily_roi_reports
    FOR SELECT TO authenticated USING (true);
CREATE POLICY "roi_reports_admin" ON public.daily_roi_reports
    FOR ALL TO authenticated USING (public.is_admin());

CREATE POLICY "country_roi_select" ON public.country_roi
    FOR SELECT TO authenticated USING (true);
CREATE POLICY "country_roi_admin" ON public.country_roi
    FOR ALL TO authenticated USING (public.is_admin());

-- H. EXPENSES & WHITELIST_TOPUP (Keuangan & Admin)
CREATE POLICY "expenses_keuangan_all" ON public.expenses
    FOR ALL TO authenticated USING (public.is_keuangan());

CREATE POLICY "whitelist_keuangan_all" ON public.whitelist_topup
    FOR ALL TO authenticated USING (public.is_keuangan());

-- I. REMINDERS (Semua baca, Keuangan & Admin tulis)
CREATE POLICY "reminders_select_auth" ON public.reminders
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "reminders_keuangan_write" ON public.reminders
    FOR INSERT TO authenticated WITH CHECK (public.is_keuangan());
CREATE POLICY "reminders_keuangan_update" ON public.reminders
    FOR UPDATE TO authenticated USING (public.is_keuangan());
CREATE POLICY "reminders_keuangan_delete" ON public.reminders
    FOR DELETE TO authenticated USING (public.is_keuangan());

-- J. PLUGIN_SITES
CREATE POLICY "plugin_sites_select_auth" ON public.plugin_sites
    FOR SELECT TO authenticated USING (true);
CREATE POLICY "plugin_sites_admin_all" ON public.plugin_sites
    FOR ALL TO authenticated USING (public.is_admin());

-- K. PLUGIN_KEYS (DIBLOKIR UNTUK SEMUA USER BIASA! HANYA SERVICE_ROLE)
-- Catatan: Tanpa policy untuk authenticated/anon, seluruh query client akan ditolak (0 rows).
-- Hanya service_role key dari server/jobs backend yang bisa mengakses tabel ini.

-- L. SYNC_RUNS
CREATE POLICY "sync_runs_select_auth" ON public.sync_runs
    FOR SELECT TO authenticated USING (true);
CREATE POLICY "sync_runs_admin_all" ON public.sync_runs
    FOR ALL TO authenticated USING (public.is_admin());



-- >>> FILE: 20261025000001_create_jobs_meta_schema.sql <<<
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



-- >>> FILE: 20261025000002_create_roi_views_and_rls.sql <<<
-- ==============================================================================
-- Migrasi Skema View Laporan ROI Terpadu & Pengetatan RLS Sesuai Peran
-- Versi: 20261025000002_create_roi_views_and_rls.sql
-- ==============================================================================

-- 1. VIEW LAPORAN ROI HARIAN TERPADU (view_daily_roi)
-- Menyatukan data pendapatan GAM / AdSense dengan biaya iklan Meta / Tracker
-- Mengonversi dan menghitung profit dalam USD dan IDR secara realtime
DROP VIEW IF EXISTS public.view_daily_financials CASCADE;
DROP VIEW IF EXISTS public.view_daily_roi CASCADE;
CREATE OR REPLACE VIEW public.view_daily_roi 
WITH (security_invoker = true) AS
WITH site_dates AS (
    SELECT DISTINCT date, site_code FROM public.daily_stats
),
aggregated_rev AS (
    SELECT 
        date,
        site_code,
        COALESCE(SUM(revenue), 0) AS gam_revenue_usd,
        COALESCE(SUM(impressions), 0) AS gam_impressions,
        COALESCE(SUM(clicks), 0) AS gam_clicks
    FROM public.daily_stats
    WHERE source IN ('gam', 'adsense')
    GROUP BY date, site_code
),
aggregated_spend AS (
    SELECT 
        date,
        site_code,
        COALESCE(SUM(spend), 0) AS total_spend_usd,
        COALESCE(SUM(clicks), 0) AS ad_clicks,
        COALESCE(SUM(impressions), 0) AS ad_impressions,
        MAX(source) AS primary_spend_source
    FROM public.daily_stats
    WHERE source IN ('meta', 'keitaro')
    GROUP BY date, site_code
),
tracker_stats AS (
    SELECT 
        date,
        site_code,
        COALESCE(SUM(revenue), 0) AS tracker_revenue_usd,
        COALESCE(SUM(clicks), 0) AS tracker_clicks
    FROM public.daily_stats
    WHERE source = 'keitaro'
    GROUP BY date, site_code
)
SELECT 
    sd.date,
    sd.site_code,
    COALESCE(s.name, sd.site_code) AS site_name,
    COALESCE(s.domain, '-') AS domain,
    COALESCE(s.pic, 'Tanpa PIC') AS pic,
    
    -- Metrik USD
    COALESCE(sp.total_spend_usd, 0) AS spend_usd,
    -- Jika GAM ada pakai GAM, fallback ke pendapatan tracker jika GAM belum tercatat
    CASE 
        WHEN COALESCE(rv.gam_revenue_usd, 0) > 0 THEN rv.gam_revenue_usd
        ELSE COALESCE(ts.tracker_revenue_usd, 0)
    END AS revenue_usd,
    (CASE 
        WHEN COALESCE(rv.gam_revenue_usd, 0) > 0 THEN rv.gam_revenue_usd
        ELSE COALESCE(ts.tracker_revenue_usd, 0)
    END) - COALESCE(sp.total_spend_usd, 0) AS profit_usd,

    -- Metrik IDR (Estimasi standar kurs Rp 18.000 / USD jika tanpa tabel kurs dinamis)
    ROUND(COALESCE(sp.total_spend_usd, 0) * 18000, 0) AS spend_idr,
    ROUND((CASE 
        WHEN COALESCE(rv.gam_revenue_usd, 0) > 0 THEN rv.gam_revenue_usd
        ELSE COALESCE(ts.tracker_revenue_usd, 0)
    END) * 18000, 0) AS revenue_idr,
    ROUND(((CASE 
        WHEN COALESCE(rv.gam_revenue_usd, 0) > 0 THEN rv.gam_revenue_usd
        ELSE COALESCE(ts.tracker_revenue_usd, 0)
    END) - COALESCE(sp.total_spend_usd, 0)) * 18000, 0) AS profit_idr,

    -- Persentase ROI
    CASE 
        WHEN COALESCE(sp.total_spend_usd, 0) > 0 THEN 
            ROUND(((((CASE 
                WHEN COALESCE(rv.gam_revenue_usd, 0) > 0 THEN rv.gam_revenue_usd
                ELSE COALESCE(ts.tracker_revenue_usd, 0)
            END) - COALESCE(sp.total_spend_usd, 0)) / sp.total_spend_usd) * 100)::numeric, 2)
        ELSE 0 
    END AS roi_percent,

    -- Metrik Volume
    COALESCE(sp.ad_clicks, ts.tracker_clicks, 0) AS clicks,
    COALESCE(sp.ad_impressions, rv.gam_impressions, 0) AS impressions,
    CASE 
        WHEN COALESCE(sp.ad_clicks, 0) > 0 THEN 
            ROUND((COALESCE(sp.total_spend_usd, 0) / sp.ad_clicks)::numeric, 4)
        ELSE 0 
    END AS cpc_usd,

    -- Indikator Status & Rekonsiliasi Data
    CASE 
        WHEN COALESCE(rv.gam_revenue_usd, 0) > 0 AND COALESCE(sp.total_spend_usd, 0) > 0 THEN 'lengkap'
        WHEN COALESCE(rv.gam_revenue_usd, 0) > 0 AND COALESCE(sp.total_spend_usd, 0) = 0 THEN 'hilang_spend'
        WHEN COALESCE(rv.gam_revenue_usd, 0) = 0 AND COALESCE(sp.total_spend_usd, 0) > 0 THEN 'hilang_revenue_gam'
        ELSE 'hanya_tracker'
    END AS data_status

FROM site_dates sd
LEFT JOIN public.sites s ON s.site_code = sd.site_code
LEFT JOIN aggregated_rev rv ON rv.date = sd.date AND rv.site_code = sd.site_code
LEFT JOIN aggregated_spend sp ON sp.date = sd.date AND sp.site_code = sd.site_code
LEFT JOIN tracker_stats ts ON ts.date = sd.date AND ts.site_code = sd.site_code;

-- ==============================================================================
-- 2. PENGETATAN ROW LEVEL SECURITY (RLS) SESUAI PERAN
-- Superadmin, Admin, dan Keuangan dapat melihat seluruh data ROI.
-- Peran Advertiser/User hanya dapat membaca data situs yang ditugaskan kepada mereka.
-- ==============================================================================

DROP POLICY IF EXISTS "daily_stats_role_select" ON public.daily_stats;
DROP POLICY IF EXISTS "daily_stats_select_authenticated" ON public.daily_stats;

CREATE POLICY "daily_stats_role_select" ON public.daily_stats
    FOR SELECT TO authenticated
    USING (
        public.is_admin() 
        OR public.is_keuangan()
        OR EXISTS (
            SELECT 1 FROM public.sites s
            JOIN public.profiles p ON p.id = auth.uid()
            WHERE s.site_code = daily_stats.site_code
            AND (s.pic = p.name OR s.pic = p.email OR s.pic ILIKE '%' || p.name || '%')
        )
    );



-- >>> FILE: 20261025000003_seed_domains_and_subdomains.sql <<<
-- ==============================================================================
-- SEED DATA 4 DOMAIN INDUK & 17 SUBDOMAIN RESMI TIGERROI
-- ==============================================================================

-- 1. Insert 4 Domain Induk ke public.domains
INSERT INTO public.domains (domain_url, network_code, user_owner, status)
VALUES
    ('https://ihopmenuwithprices.us', '23340206616', 'Mas Def', 'Active'),
    ('https://tacobellmenuu.us', '23380486168', 'Mas Def', 'Active'),
    ('https://tiktokmodapk.net', '23367555867', 'Mas Def', 'Active'),
    ('https://trayedit.com', '23344333667', 'Mas Def', 'Active')
ON CONFLICT (domain_url) DO UPDATE
SET network_code = EXCLUDED.network_code, status = 'Active', updated_at = now();

-- 2. Insert 17 Subdomain Resmi ke public.subdomains
-- Hubungkan parent_domain_id ke ID domains terkait
INSERT INTO public.subdomains (name, site_code, parent_domain, parent_domain_id, campaign_codes, pic, status)
SELECT 
    sub.name,
    sub.site_code,
    d.domain_url,
    d.id,
    sub.campaign_codes,
    'Mas Def',
    'Active'
FROM (
    VALUES
        -- IHOP (ihop-menu / pBRw)
        ('menu.ihopmenuwithprices.us', 'ihop-menu', 'https://ihopmenuwithprices.us', 'pBRw'),
        ('deals.ihopmenuwithprices.us', 'ihop-menu', 'https://ihopmenuwithprices.us', 'pBRw'),
        ('keto.ihopmenuwithprices.us', 'ihop-menu', 'https://ihopmenuwithprices.us', 'pBRw'),
        ('hacks.ihopmenuwithprices.us', 'ihop-menu', 'https://ihopmenuwithprices.us', 'pBRw'),
        ('news.ihopmenuwithprices.us', 'ihop-menu', 'https://ihopmenuwithprices.us', 'pBRw'),

        -- Taco Bell (taco-fries / taco)
        ('cantina.tacobellmenuu.us', 'taco-fries', 'https://tacobellmenuu.us', 'taco'),
        ('burrito.tacobellmenuu.us', 'taco-fries', 'https://tacobellmenuu.us', 'taco'),
        ('fries.tacobellmenuu.us', 'taco-fries', 'https://tacobellmenuu.us', 'taco'),

        -- TikTok Mod (tiktok-mod / tiktok)
        ('insurance.tiktokmodapk.net', 'tiktok-mod', 'https://tiktokmodapk.net', 'tiktok'),
        ('careers.tiktokmodapk.net', 'tiktok-mod', 'https://tiktokmodapk.net', 'tiktok'),
        ('rewards.tiktokmodapk.net', 'tiktok-mod', 'https://tiktokmodapk.net', 'tiktok'),
        ('mod.tiktokmodapk.net', 'tiktok-mod', 'https://tiktokmodapk.net', 'tiktok'),

        -- Tray Edit (tray-decor / TvH1)
        ('decor.trayedit.com', 'tray-decor', 'https://trayedit.com', 'TvH1'),
        ('materials.trayedit.com', 'tray-decor', 'https://trayedit.com', 'TvH1'),
        ('cabinets.trayedit.com', 'tray-decor', 'https://trayedit.com', 'TvH1'),
        ('guides.trayedit.com', 'tray-decor', 'https://trayedit.com', 'TvH1'),
        ('styling.trayedit.com', 'tray-decor', 'https://trayedit.com', 'TvH1')
) AS sub(name, site_code, parent_domain_url, campaign_codes)
JOIN public.domains d ON d.domain_url = sub.parent_domain_url
ON CONFLICT (name) DO UPDATE
SET site_code = EXCLUDED.site_code,
    parent_domain = EXCLUDED.parent_domain,
    parent_domain_id = EXCLUDED.parent_domain_id,
    campaign_codes = EXCLUDED.campaign_codes,
    status = 'Active',
    updated_at = now();



-- >>> FILE: 20261025000004_fix_rls_and_seed_data.sql <<<
-- ==============================================================================
-- FIX RLS READ-ONLY & SEED 4 DOMAIN + 17 SUBDOMAIN
-- ==============================================================================

-- 1. Berikan izin SELECT publik (Anon & Authenticated) untuk tabel Domain & Subdomain (Read-Only)
DROP POLICY IF EXISTS "domains_select_auth" ON public.domains;
DROP POLICY IF EXISTS "domains_select_all" ON public.domains;
CREATE POLICY "domains_select_all" ON public.domains
    FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS "subdomains_select_auth" ON public.subdomains;
DROP POLICY IF EXISTS "subdomains_select_all" ON public.subdomains;
CREATE POLICY "subdomains_select_all" ON public.subdomains
    FOR SELECT TO public USING (true);

-- 2. Bersihkan dan Masukkan 4 Domain Induk
INSERT INTO public.domains (domain_url, network_code, user_owner, status)
VALUES
    ('https://ihopmenuwithprices.us', '23340206616', 'Mas Def', 'Active'),
    ('https://tacobellmenuu.us', '23380486168', 'Mas Def', 'Active'),
    ('https://tiktokmodapk.net', '23367555867', 'Mas Def', 'Active'),
    ('https://trayedit.com', '23344333667', 'Mas Def', 'Active')
ON CONFLICT (domain_url) DO UPDATE
SET network_code = EXCLUDED.network_code, status = 'Active', updated_at = now();

-- 3. Masukkan 17 Subdomain Resmi
INSERT INTO public.subdomains (name, site_code, parent_domain, parent_domain_id, campaign_codes, pic, status)
SELECT 
    sub.name,
    sub.site_code,
    d.domain_url,
    d.id,
    sub.campaign_codes,
    'Mas Def',
    'Active'
FROM (
    VALUES
        -- IHOP (ihop-menu / pBRw)
        ('menu.ihopmenuwithprices.us', 'ihop-menu', 'https://ihopmenuwithprices.us', 'pBRw'),
        ('deals.ihopmenuwithprices.us', 'ihop-menu', 'https://ihopmenuwithprices.us', 'pBRw'),
        ('keto.ihopmenuwithprices.us', 'ihop-menu', 'https://ihopmenuwithprices.us', 'pBRw'),
        ('hacks.ihopmenuwithprices.us', 'ihop-menu', 'https://ihopmenuwithprices.us', 'pBRw'),
        ('news.ihopmenuwithprices.us', 'ihop-menu', 'https://ihopmenuwithprices.us', 'pBRw'),

        -- Taco Bell (taco-fries / taco)
        ('cantina.tacobellmenuu.us', 'taco-fries', 'https://tacobellmenuu.us', 'taco'),
        ('burrito.tacobellmenuu.us', 'taco-fries', 'https://tacobellmenuu.us', 'taco'),
        ('fries.tacobellmenuu.us', 'taco-fries', 'https://tacobellmenuu.us', 'taco'),

        -- TikTok Mod (tiktok-mod / tiktok)
        ('insurance.tiktokmodapk.net', 'tiktok-mod', 'https://tiktokmodapk.net', 'tiktok'),
        ('careers.tiktokmodapk.net', 'tiktok-mod', 'https://tiktokmodapk.net', 'tiktok'),
        ('rewards.tiktokmodapk.net', 'tiktok-mod', 'https://tiktokmodapk.net', 'tiktok'),
        ('mod.tiktokmodapk.net', 'tiktok-mod', 'https://tiktokmodapk.net', 'tiktok'),

        -- Tray Edit (tray-decor / TvH1)
        ('decor.trayedit.com', 'tray-decor', 'https://trayedit.com', 'TvH1'),
        ('materials.trayedit.com', 'tray-decor', 'https://trayedit.com', 'TvH1'),
        ('cabinets.trayedit.com', 'tray-decor', 'https://trayedit.com', 'TvH1'),
        ('guides.trayedit.com', 'tray-decor', 'https://trayedit.com', 'TvH1'),
        ('styling.trayedit.com', 'tray-decor', 'https://trayedit.com', 'TvH1')
) AS sub(name, site_code, parent_domain_url, campaign_codes)
JOIN public.domains d ON d.domain_url = sub.parent_domain_url
ON CONFLICT (name) DO UPDATE
SET site_code = EXCLUDED.site_code,
    parent_domain = EXCLUDED.parent_domain,
    parent_domain_id = EXCLUDED.parent_domain_id,
    campaign_codes = EXCLUDED.campaign_codes,
    status = 'Active',
    updated_at = now();



-- >>> FILE: 20261025000005_create_gam_accounts.sql <<<
-- ==============================================================================
-- TABEL AKUN GOOGLE AD MANAGER (gam_accounts) & SEED 4 NETWORK UTAMA
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.gam_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    network_code TEXT NOT NULL UNIQUE,
    publisher_id TEXT,
    status TEXT NOT NULL DEFAULT 'Ready',
    status_auto TEXT,
    status_detail TEXT,
    sync_status TEXT DEFAULT 'ok',
    sync_earning TEXT DEFAULT 'Rp 0',
    last_sync_report_date TEXT,
    email_akun TEXT,
    password_akun TEXT,
    harga_beli TEXT,
    total_payout TEXT,
    kode_customer TEXT,
    nomor_hp TEXT,
    email_pemulihan TEXT,
    negara TEXT DEFAULT 'Indonesia',
    registrar_domain TEXT,
    exp_domain TEXT,
    email_domain TEXT,
    password_domain TEXT,
    server TEXT,
    username_wp TEXT,
    password_wp TEXT,
    saldo_adsense NUMERIC(15, 2) DEFAULT 0,
    saldo_ad_exchange NUMERIC(15, 2) DEFAULT 0,
    saldo NUMERIC(15, 2) DEFAULT 0,
    saldo_currency TEXT DEFAULT 'IDR',
    saldo_shared TEXT,
    saldo_detail TEXT,
    nama_rekening TEXT,
    no_rekening TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.gam_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gam_accounts_select_all" ON public.gam_accounts;
CREATE POLICY "gam_accounts_select_all" ON public.gam_accounts
    FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS "gam_accounts_admin_all" ON public.gam_accounts;
CREATE POLICY "gam_accounts_admin_all" ON public.gam_accounts
    FOR ALL TO authenticated USING (public.is_admin());

-- Seed 4 Network GAM Utama
INSERT INTO public.gam_accounts (name, network_code, status, sync_status)
VALUES
    ('ihopmenuwithprices.us', '23340206616', 'Ready', 'ok'),
    ('tacobellmenuu.us', '23380486168', 'Ready', 'ok'),
    ('tiktokmodapk.net', '23367555867', 'Ready', 'ok'),
    ('trayedit.com', '23344333667', 'Ready', 'ok')
ON CONFLICT (network_code) DO UPDATE
SET name = EXCLUDED.name, status = EXCLUDED.status, sync_status = 'ok', updated_at = now();



-- >>> FILE: 20261026000006_allow_daily_stats_import_rls.sql <<<
-- ==============================================================================
-- Migrasi: Izinkan Pengguna Terautentikasi / Admin Menyimpan Data Impor ke daily_stats
-- Versi: 20261026000006_allow_daily_stats_import_rls.sql
-- ==============================================================================

-- Berikan izin INSERT, UPDATE, dan DELETE pada daily_stats untuk pengguna terautentikasi (admin/superadmin)
DROP POLICY IF EXISTS "daily_stats_authenticated_manage" ON public.daily_stats;
DROP POLICY IF EXISTS "daily_stats_admin_manage" ON public.daily_stats;

CREATE POLICY "daily_stats_authenticated_manage" ON public.daily_stats
    FOR ALL TO authenticated
    USING (true)
    WITH CHECK (true);



-- >>> FILE: 20261026000007_update_exact_fx_rates_view_daily_roi.sql <<<
-- ==============================================================================
-- Migrasi Kurs Presisi: 1 USD = Rp 18.155,28 | 1 INR = Rp 190,87
-- Versi: 20261026000007_update_exact_fx_rates_view_daily_roi.sql
-- ==============================================================================

DROP VIEW IF EXISTS public.view_daily_roi CASCADE;

DROP VIEW IF EXISTS public.view_daily_financials CASCADE;
DROP VIEW IF EXISTS public.view_daily_roi CASCADE;
CREATE OR REPLACE VIEW public.view_daily_roi 
WITH (security_invoker = true) AS
WITH site_dates AS (
    SELECT DISTINCT date, site_code FROM public.daily_stats
),
aggregated_rev AS (
    SELECT 
        date,
        site_code,
        COALESCE(SUM(revenue), 0) AS gam_revenue,
        COALESCE(SUM(impressions), 0) AS gam_impressions,
        COALESCE(SUM(clicks), 0) AS gam_clicks
    FROM public.daily_stats
    WHERE source IN ('gam', 'adsense')
    GROUP BY date, site_code
),
aggregated_spend AS (
    SELECT 
        date,
        site_code,
        COALESCE(SUM(spend), 0) AS total_spend_idr,
        COALESCE(SUM(clicks), 0) AS ad_clicks,
        COALESCE(SUM(impressions), 0) AS ad_impressions
    FROM public.daily_stats
    WHERE source IN ('meta', 'keitaro')
    GROUP BY date, site_code
),
tracker_stats AS (
    SELECT 
        date,
        site_code,
        COALESCE(SUM(revenue), 0) AS tracker_revenue,
        COALESCE(SUM(clicks), 0) AS tracker_clicks
    FROM public.daily_stats
    WHERE source = 'keitaro'
    GROUP BY date, site_code
),
calculated_base AS (
    SELECT 
        (sd.date || '_' || sd.site_code) AS id,
        sd.date,
        '23:59' AS time,
        sd.site_code,
        COALESCE(s.name, sd.site_code) AS site_name,
        COALESCE(s.name, sd.site_code) AS sub_domain,
        COALESCE(s.site_code, '-') AS campaign,
        COALESCE(s.domain, '-') AS domain,
        COALESCE(s.pic, 'Mas Def') AS pic,
        COALESCE(sp.total_spend_idr, 0) AS spend_idr,
        
        -- Nilai pendapatan mentah (USD untuk Trayedit/TikTok/IHOP, INR untuk Tacobell)
        CASE 
            WHEN COALESCE(rv.gam_revenue, 0) > 0 THEN rv.gam_revenue 
            ELSE COALESCE(ts.tracker_revenue, 0) 
        END AS raw_revenue,
        
        -- Kurs resmi masdef
        CASE 
            WHEN sd.site_code = 'taco-fries' THEN 190.87
            ELSE 18155.28
        END AS fx_rate,
        
        CASE 
            WHEN sd.site_code = 'taco-fries' THEN 'INR'
            ELSE 'USD'
        END AS currency_code,
        
        COALESCE(sp.ad_clicks, ts.tracker_clicks, 0) AS clicks,
        COALESCE(sp.ad_impressions, rv.gam_impressions, 0) AS impressions
    FROM site_dates sd
    LEFT JOIN public.sites s ON s.site_code = sd.site_code
    LEFT JOIN aggregated_rev rv ON rv.date = sd.date AND rv.site_code = sd.site_code
    LEFT JOIN aggregated_spend sp ON sp.date = sd.date AND sp.site_code = sd.site_code
    LEFT JOIN tracker_stats ts ON ts.date = sd.date AND ts.site_code = sd.site_code
)
SELECT 
    b.id,
    b.date,
    b.time,
    b.site_code,
    b.site_name,
    b.sub_domain,
    b.campaign,
    b.domain,
    b.pic,
    
    -- Belanja Iklan Meta (IDR)
    b.spend_idr AS spending,
    b.spend_idr AS meta_spend,
    b.spend_idr AS meta_ads,
    0 AS ad_tax,
    b.spend_idr AS total_spending,
    
    -- Pendapatan Bersih Dikonversi Presisi ke IDR
    ROUND(b.raw_revenue * b.fx_rate) AS earning,
    ROUND(b.raw_revenue * b.fx_rate) AS gam_revenue,
    
    -- Profit Bersih (IDR)
    (ROUND(b.raw_revenue * b.fx_rate) - b.spend_idr) AS profit,
    
    -- ROI Presisi (%)
    CASE 
        WHEN b.spend_idr > 0 THEN 
            ROUND((((ROUND(b.raw_revenue * b.fx_rate) - b.spend_idr) / b.spend_idr) * 100)::numeric, 2)
        ELSE 0 
    END AS roi,
    
    b.clicks,
    b.impressions,
    CASE 
        WHEN b.clicks > 0 THEN 
            ROUND((b.spend_idr / b.clicks)::numeric, 4)
        ELSE 0 
    END AS cpc,
    
    b.currency_code AS currency,
    b.fx_rate AS fx_rate
FROM calculated_base b;



-- >>> FILE: 20261028000008_fix_subdomains_join_in_view_daily_roi.sql <<<
-- ==============================================================================
-- Migrasi Pemetaan Subdomain & Domain Induk pada view_daily_roi
-- Versi: 20261028000008_fix_subdomains_join_in_view_daily_roi.sql
-- ==============================================================================

DROP VIEW IF EXISTS public.view_daily_roi CASCADE;

DROP VIEW IF EXISTS public.view_daily_financials CASCADE;
DROP VIEW IF EXISTS public.view_daily_roi CASCADE;
CREATE OR REPLACE VIEW public.view_daily_roi 
WITH (security_invoker = true) AS
WITH site_dates AS (
    SELECT DISTINCT date, site_code FROM public.daily_stats
),
aggregated_rev AS (
    SELECT 
        date,
        site_code,
        COALESCE(SUM(revenue), 0) AS gam_revenue,
        COALESCE(SUM(impressions), 0) AS gam_impressions,
        COALESCE(SUM(clicks), 0) AS gam_clicks
    FROM public.daily_stats
    WHERE source IN ('gam', 'adsense')
    GROUP BY date, site_code
),
aggregated_spend AS (
    SELECT 
        date,
        site_code,
        COALESCE(SUM(spend), 0) AS total_spend_idr,
        COALESCE(SUM(clicks), 0) AS ad_clicks,
        COALESCE(SUM(impressions), 0) AS ad_impressions
    FROM public.daily_stats
    WHERE source IN ('meta', 'keitaro')
    GROUP BY date, site_code
),
tracker_stats AS (
    SELECT 
        date,
        site_code,
        COALESCE(SUM(revenue), 0) AS tracker_revenue,
        COALESCE(SUM(clicks), 0) AS tracker_clicks
    FROM public.daily_stats
    WHERE source = 'keitaro'
    GROUP BY date, site_code
),
subdomain_map AS (
    SELECT DISTINCT ON (site_code) 
        site_code, 
        name, 
        parent_domain, 
        pic 
    FROM public.subdomains 
    ORDER BY site_code, created_at ASC
),
calculated_base AS (
    SELECT 
        (sd.date || '_' || sd.site_code) AS id,
        sd.date,
        '23:59' AS time,
        sd.site_code,
        COALESCE(s.name, sd.site_code) AS site_name,
        COALESCE(s.name, sd.site_code) AS sub_domain,
        COALESCE(sd.site_code, '-') AS campaign,
        COALESCE(s.parent_domain, '-') AS domain,
        COALESCE(s.pic, 'Mas Def') AS pic,
        COALESCE(sp.total_spend_idr, 0) AS spend_idr,
        
        -- Nilai pendapatan mentah (USD untuk Trayedit/TikTok/IHOP, INR untuk Tacobell)
        CASE 
            WHEN COALESCE(rv.gam_revenue, 0) > 0 THEN rv.gam_revenue 
            ELSE COALESCE(ts.tracker_revenue, 0) 
        END AS raw_revenue,
        
        -- Kurs resmi masdef
        CASE 
            WHEN sd.site_code = 'taco-fries' THEN 190.87
            ELSE 18155.28
        END AS fx_rate,
        
        CASE 
            WHEN sd.site_code = 'taco-fries' THEN 'INR'
            ELSE 'USD'
        END AS currency_code,
        
        COALESCE(sp.ad_clicks, ts.tracker_clicks, 0) AS clicks,
        COALESCE(sp.ad_impressions, rv.gam_impressions, 0) AS impressions
    FROM site_dates sd
    LEFT JOIN subdomain_map s ON s.site_code = sd.site_code
    LEFT JOIN aggregated_rev rv ON rv.date = sd.date AND rv.site_code = sd.site_code
    LEFT JOIN aggregated_spend sp ON sp.date = sd.date AND sp.site_code = sd.site_code
    LEFT JOIN tracker_stats ts ON ts.date = sd.date AND ts.site_code = sd.site_code
)
SELECT 
    b.id,
    b.date,
    b.time,
    b.site_code,
    b.site_name,
    b.sub_domain,
    b.campaign,
    b.domain,
    b.pic,
    
    -- Belanja Iklan Meta (IDR)
    b.spend_idr AS spending,
    b.spend_idr AS meta_spend,
    b.spend_idr AS meta_ads,
    0 AS ad_tax,
    b.spend_idr AS total_spending,
    
    -- Pendapatan Bersih Dikonversi Presisi ke IDR
    ROUND(b.raw_revenue * b.fx_rate) AS earning,
    ROUND(b.raw_revenue * b.fx_rate) AS gam_revenue,
    
    -- Profit Bersih (IDR)
    (ROUND(b.raw_revenue * b.fx_rate) - b.spend_idr) AS profit,
    
    -- ROI Presisi (%)
    CASE 
        WHEN b.spend_idr > 0 THEN 
            ROUND((((ROUND(b.raw_revenue * b.fx_rate) - b.spend_idr) / b.spend_idr) * 100)::numeric, 2)
        ELSE 0 
    END AS roi,
    
    b.clicks,
    b.impressions,
    CASE 
        WHEN b.clicks > 0 THEN 
            ROUND((b.spend_idr / b.clicks)::numeric, 4)
        ELSE 0 
    END AS cpc,
    
    b.currency_code AS currency,
    b.fx_rate AS fx_rate
FROM calculated_base b;



-- >>> FILE: 20261028000009_create_view_daily_financials_supabase.sql <<<
-- ==============================================================================
-- Migrasi View Agregasi Finansial Harian Murni Supabase (PostgreSQL)
-- Versi: 20261028000009_create_view_daily_financials_supabase.sql
-- ==============================================================================

DROP VIEW IF EXISTS public.view_daily_financials CASCADE;

DROP VIEW IF EXISTS public.view_daily_financials CASCADE;
CREATE OR REPLACE VIEW public.view_daily_financials
WITH (security_invoker = true) AS
SELECT 
    v.date,
    COALESCE(SUM(v.earning), 0) AS gross_revenue,
    COALESCE(SUM(v.spending), 0) AS total_spend,
    COALESCE(SUM(v.ad_tax), 0) AS ad_tax,
    COALESCE(SUM(v.total_spending), 0) AS total_spending,
    COALESCE(SUM(v.profit), 0) AS net_profit
FROM public.view_daily_roi v
GROUP BY v.date
ORDER BY v.date DESC;



-- >>> FILE: 20261028000010_populate_subdomains_parent_domain.sql <<<
-- ==============================================================================
-- PENGISIAN KOLOM parent_domain PADA TABEL public.subdomains
-- Versi: 20261028000010_populate_subdomains_parent_domain.sql
-- ==============================================================================

-- 1. Isi parent_domain dari tabel public.domains lewat relasi parent_domain_id
UPDATE public.subdomains s
SET parent_domain = d.domain_url
FROM public.domains d
WHERE s.parent_domain_id = d.id;

-- 2. Pastikan fallback mapping berdasarkan site_code resmi jika parent_domain_id belum terpasang
UPDATE public.subdomains
SET parent_domain = 'https://ihopmenuwithprices.us'
WHERE site_code = 'ihop-menu' AND (parent_domain IS NULL OR parent_domain = '');

UPDATE public.subdomains
SET parent_domain = 'https://tacobellmenuu.us'
WHERE site_code = 'taco-fries' AND (parent_domain IS NULL OR parent_domain = '');

UPDATE public.subdomains
SET parent_domain = 'https://tiktokmodapk.net'
WHERE site_code = 'tiktok-mod' AND (parent_domain IS NULL OR parent_domain = '');

UPDATE public.subdomains
SET parent_domain = 'https://trayedit.com'
WHERE site_code = 'tray-decor' AND (parent_domain IS NULL OR parent_domain = '');



-- >>> FILE: 20261028000011_clear_stale_meta_access_token.sql <<<
-- ==============================================================================
-- BERSIHKAN TOKEN KADALUARSA PADA TABEL meta_accounts
-- Versi: 20261028000011_clear_stale_meta_access_token.sql
-- ==============================================================================

-- Kosongkan kolom access_token di meta_accounts agar selalu menggunakan
-- META_ACCESS_TOKEN resmi yang tersimpan aman di GitHub Secrets (environment)
UPDATE public.meta_accounts
SET access_token = NULL;



-- >>> FILE: 20261028000012_add_campaigns_to_profiles.sql <<<
-- ==============================================================================
-- TAMBAH KOLOM campaigns PADA TABEL public.profiles
-- Versi: 20261028000012_add_campaigns_to_profiles.sql
-- ==============================================================================

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS campaigns JSONB DEFAULT '[]'::jsonb;



-- >>> FILE: 20261028000013_update_subdomains_pic_mapping.sql <<<
-- ==============================================================================
-- UPDATE PIC ADVERTISER PADA 17 SUBDOMAIN RESMI TIGERROI
-- Versi: 20261028000013_update_subdomains_pic_mapping.sql
-- ==============================================================================

-- 1. Update nama PIC pada tiap subdomain
UPDATE public.subdomains SET pic = 'Mul' WHERE name IN ('careers', 'careers.tiktokmodapk.net');
UPDATE public.subdomains SET pic = 'Sul' WHERE name IN ('insurance', 'insurance.tiktokmodapk.net');
UPDATE public.subdomains SET pic = 'Nur' WHERE name IN ('rewards', 'rewards.tiktokmodapk.net');
UPDATE public.subdomains SET pic = 'Man' WHERE name IN ('mod', 'mod.tiktokmodapk.net');
UPDATE public.subdomains SET pic = NULL WHERE name IN ('cantina', 'cantina.tacobellmenuu.us');
UPDATE public.subdomains SET pic = 'Sul' WHERE name IN ('burrito', 'burrito.tacobellmenuu.us');
UPDATE public.subdomains SET pic = NULL WHERE name IN ('fries', 'fries.tacobellmenuu.us');
UPDATE public.subdomains SET pic = 'Nur' WHERE name IN ('decor', 'decor.trayedit.com');
UPDATE public.subdomains SET pic = 'Man' WHERE name IN ('materials', 'materials.trayedit.com');
UPDATE public.subdomains SET pic = 'Sul' WHERE name IN ('cabinets', 'cabinets.trayedit.com');
UPDATE public.subdomains SET pic = 'Mul' WHERE name IN ('guides', 'guides.trayedit.com');
UPDATE public.subdomains SET pic = NULL WHERE name IN ('styling', 'styling.trayedit.com');
UPDATE public.subdomains SET pic = 'Sul' WHERE name IN ('menu', 'menu.ihopmenuwithprices.us');
UPDATE public.subdomains SET pic = 'Mul' WHERE name IN ('deals', 'deals.ihopmenuwithprices.us');
UPDATE public.subdomains SET pic = 'Man' WHERE name IN ('keto', 'keto.ihopmenuwithprices.us');
UPDATE public.subdomains SET pic = 'Nur' WHERE name IN ('hacks', 'hacks.ihopmenuwithprices.us');
UPDATE public.subdomains SET pic = NULL WHERE name IN ('news', 'news.ihopmenuwithprices.us');

-- 2. Sambungkan pic_user_id dari tabel public.profiles bila profil pengguna ditemukan
UPDATE public.subdomains s
SET pic_user_id = p.id
FROM public.profiles p
WHERE (
    (s.pic = 'Mul' AND (p.name ILIKE '%Mul%' OR p.email ILIKE '%amul%')) OR
    (s.pic = 'Sul' AND (p.name ILIKE '%Sul%' OR p.email ILIKE '%sul%')) OR
    (s.pic = 'Nur' AND (p.name ILIKE '%Nur%' OR p.email ILIKE '%nur%')) OR
    (s.pic = 'Man' AND (p.name ILIKE '%Man%' OR p.email ILIKE '%man%'))
);



-- >>> FILE: 20261028000014_fix_superadmin_not_pic_and_update_subdomains.sql <<<
-- ==============================================================================
-- MIGRASI 14: PERBAIKI PEMETAAN PIC 17 SUBDOMAIN & HAPUS MAS DEF DARI PIC OPERASIONAL
-- Versi: 20261028000014_fix_superadmin_not_pic_and_update_subdomains.sql
-- Keterangan: Masdef adalah Superadmin, tidak memegang domain maupun subdomain operasional.
--             Subdomain tanpa nama berarti BELUM ADA YANG PEGANG (NULL).
-- ==============================================================================

-- 1. Kosongkan user_owner pada tabel domains (Masdef bukan PIC domain operasional)
UPDATE public.domains SET user_owner = NULL;

-- 2. Update PIC resmi untuk 17 Subdomain
-- Mul (3 subdomain)
UPDATE public.subdomains SET pic = 'Mul' WHERE name IN ('careers', 'careers.tiktokmodapk.net');
UPDATE public.subdomains SET pic = 'Mul' WHERE name IN ('guides', 'guides.trayedit.com');
UPDATE public.subdomains SET pic = 'Mul' WHERE name IN ('deals', 'deals.ihopmenuwithprices.us');

-- Sul / Sulfin (4 subdomain)
UPDATE public.subdomains SET pic = 'Sul' WHERE name IN ('insurance', 'insurance.tiktokmodapk.net');
UPDATE public.subdomains SET pic = 'Sul' WHERE name IN ('burrito', 'burrito.tacobellmenuu.us');
UPDATE public.subdomains SET pic = 'Sul' WHERE name IN ('cabinets', 'cabinets.trayedit.com');
UPDATE public.subdomains SET pic = 'Sul' WHERE name IN ('menu', 'menu.ihopmenuwithprices.us');

-- Nur (3 subdomain)
UPDATE public.subdomains SET pic = 'Nur' WHERE name IN ('rewards', 'rewards.tiktokmodapk.net');
UPDATE public.subdomains SET pic = 'Nur' WHERE name IN ('decor', 'decor.trayedit.com');
UPDATE public.subdomains SET pic = 'Nur' WHERE name IN ('hacks', 'hacks.ihopmenuwithprices.us');

-- Man (3 subdomain)
UPDATE public.subdomains SET pic = 'Man' WHERE name IN ('mod', 'mod.tiktokmodapk.net');
UPDATE public.subdomains SET pic = 'Man' WHERE name IN ('materials', 'materials.trayedit.com');
UPDATE public.subdomains SET pic = 'Man' WHERE name IN ('keto', 'keto.ihopmenuwithprices.us');

-- Belum ada yang pegang (4 subdomain: NULL)
UPDATE public.subdomains SET pic = NULL, pic_user_id = NULL WHERE name IN ('cantina', 'cantina.tacobellmenuu.us');
UPDATE public.subdomains SET pic = NULL, pic_user_id = NULL WHERE name IN ('fries', 'fries.tacobellmenuu.us');
UPDATE public.subdomains SET pic = NULL, pic_user_id = NULL WHERE name IN ('styling', 'styling.trayedit.com');
UPDATE public.subdomains SET pic = NULL, pic_user_id = NULL WHERE name IN ('news', 'news.ihopmenuwithprices.us');

-- 3. Sambungkan pic_user_id dari tabel public.profiles untuk PIC yang terdaftar
UPDATE public.subdomains s
SET pic_user_id = p.id
FROM public.profiles p
WHERE (
    (s.pic = 'Mul' AND (p.name ILIKE '%Mul%' OR p.email ILIKE '%amul%')) OR
    (s.pic = 'Sul' AND (p.name ILIKE '%Sul%' OR p.email ILIKE '%sul%')) OR
    (s.pic = 'Nur' AND (p.name ILIKE '%Nur%' OR p.email ILIKE '%nur%')) OR
    (s.pic = 'Man' AND (p.name ILIKE '%Man%' OR p.email ILIKE '%man%'))
);

-- 4. Perbarui view_daily_roi agar membaca dari daily_stats dan TIDAK PERNAH meng-fallback PIC ke 'Mas Def'
DROP VIEW IF EXISTS public.view_daily_roi CASCADE;

DROP VIEW IF EXISTS public.view_daily_financials CASCADE;
DROP VIEW IF EXISTS public.view_daily_roi CASCADE;
CREATE OR REPLACE VIEW public.view_daily_roi 
WITH (security_invoker = true) AS
WITH site_dates AS (
    SELECT DISTINCT date, site_code FROM public.daily_stats
),
aggregated_rev AS (
    SELECT 
        date,
        site_code,
        COALESCE(SUM(revenue), 0) AS gam_revenue,
        COALESCE(SUM(impressions), 0) AS gam_impressions,
        COALESCE(SUM(clicks), 0) AS gam_clicks
    FROM public.daily_stats
    WHERE source IN ('gam', 'adsense')
    GROUP BY date, site_code
),
aggregated_spend AS (
    SELECT 
        date,
        site_code,
        COALESCE(SUM(spend), 0) AS total_spend_idr,
        COALESCE(SUM(clicks), 0) AS ad_clicks,
        COALESCE(SUM(impressions), 0) AS ad_impressions
    FROM public.daily_stats
    WHERE source IN ('meta', 'keitaro')
    GROUP BY date, site_code
),
tracker_stats AS (
    SELECT 
        date,
        site_code,
        COALESCE(SUM(revenue), 0) AS tracker_revenue,
        COALESCE(SUM(clicks), 0) AS tracker_clicks
    FROM public.daily_stats
    WHERE source = 'keitaro'
    GROUP BY date, site_code
),
subdomain_map AS (
    SELECT DISTINCT ON (site_code) 
        site_code, 
        name, 
        parent_domain, 
        pic 
    FROM public.subdomains 
    ORDER BY site_code, created_at ASC
),
calculated_base AS (
    SELECT 
        (sd.date || '_' || sd.site_code) AS id,
        sd.date,
        '23:59' AS time,
        sd.site_code,
        COALESCE(s.name, sd.site_code) AS site_name,
        COALESCE(s.name, sd.site_code) AS sub_domain,
        COALESCE(sd.site_code, '-') AS campaign,
        COALESCE(s.parent_domain, '-') AS domain,
        COALESCE(s.pic, '-') AS pic,
        COALESCE(sp.total_spend_idr, 0) AS spend_idr,
        
        -- Nilai pendapatan mentah (USD untuk Trayedit/TikTok/IHOP, INR untuk Tacobell)
        CASE 
            WHEN COALESCE(rv.gam_revenue, 0) > 0 THEN rv.gam_revenue 
            ELSE COALESCE(ts.tracker_revenue, 0) 
        END AS raw_revenue,
        
        -- Kurs resmi masdef
        CASE 
            WHEN sd.site_code = 'taco-fries' THEN 190.87
            ELSE 18155.28
        END AS fx_rate,
        
        CASE 
            WHEN sd.site_code = 'taco-fries' THEN 'INR'
            ELSE 'USD'
        END AS currency_code,
        
        COALESCE(sp.ad_clicks, ts.tracker_clicks, 0) AS clicks,
        COALESCE(sp.ad_impressions, rv.gam_impressions, 0) AS impressions
    FROM site_dates sd
    LEFT JOIN subdomain_map s ON s.site_code = sd.site_code
    LEFT JOIN aggregated_rev rv ON rv.date = sd.date AND rv.site_code = sd.site_code
    LEFT JOIN aggregated_spend sp ON sp.date = sd.date AND sp.site_code = sd.site_code
    LEFT JOIN tracker_stats ts ON ts.date = sd.date AND ts.site_code = sd.site_code
)
SELECT 
    b.id,
    b.date,
    b.time,
    b.site_code,
    b.site_name,
    b.sub_domain,
    b.campaign,
    b.domain,
    b.pic,
    
    -- Belanja Iklan Meta (IDR)
    b.spend_idr AS spending,
    b.spend_idr AS meta_spend,
    b.spend_idr AS meta_ads,
    0 AS ad_tax,
    b.spend_idr AS total_spending,
    
    -- Pendapatan Bersih Dikonversi Presisi ke IDR
    ROUND(b.raw_revenue * b.fx_rate) AS earning,
    ROUND(b.raw_revenue * b.fx_rate) AS gam_revenue,
    
    -- Profit Bersih (IDR)
    (ROUND(b.raw_revenue * b.fx_rate) - b.spend_idr) AS profit,
    
    -- ROI Presisi (%)
    CASE 
        WHEN b.spend_idr > 0 THEN 
            ROUND((((ROUND(b.raw_revenue * b.fx_rate) - b.spend_idr) / b.spend_idr) * 100)::numeric, 2)
        ELSE 0 
    END AS roi,
    
    b.clicks,
    b.impressions,
    CASE 
        WHEN b.clicks > 0 THEN 
            ROUND((b.spend_idr / b.clicks)::numeric, 4)
        ELSE 0 
    END AS cpc,
    
    b.currency_code AS currency,
    b.fx_rate AS fx_rate
FROM calculated_base b;



-- >>> FILE: 20261028000015_create_accounting_tables.sql <<<
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



-- >>> FILE: 20261028000016_create_all_manual_entry_tables.sql <<<
-- ==============================================================================
-- MIGRASI 16: BUAT SELURUH TABEL UNTUK INPUT/TAMBAH DATA MANUAL DI DASHBOARD
-- Versi: 20261028000016_create_all_manual_entry_tables.sql
-- Keterangan: Memastikan semua form Tambah / Add data manual memiliki tabel fisik
--             di Supabase dengan RLS dan hak akses yang benar.
-- ==============================================================================

-- 1. TABEL TARGET BULANAN DOMAIN (domain_targets)
CREATE TABLE IF NOT EXISTS public.domain_targets (
    id TEXT PRIMARY KEY, -- Format: domainId_YYYY-MM
    domain_id TEXT NOT NULL,
    month TEXT NOT NULL,
    target_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.domain_targets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "domain_targets_all_auth" ON public.domain_targets
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "domain_targets_anon_select" ON public.domain_targets
    FOR SELECT TO anon USING (true);

-- 2. TABEL GRUP / KONTAK NOTIFIKASI TELEGRAM (notification_groups)
CREATE TABLE IF NOT EXISTS public.notification_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    chat_id TEXT NOT NULL,
    type TEXT DEFAULT 'group',
    status TEXT NOT NULL DEFAULT 'Active',
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.notification_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notification_groups_all_auth" ON public.notification_groups
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "notification_groups_anon_select" ON public.notification_groups
    FOR SELECT TO anon USING (true);

-- 3. TABEL RAHASIA OTP 2FA (otp_secrets)
CREATE TABLE IF NOT EXISTS public.otp_secrets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    secret TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.otp_secrets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "otp_secrets_all_auth" ON public.otp_secrets
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "otp_secrets_anon_select" ON public.otp_secrets
    FOR SELECT TO anon USING (true);

-- 4. TABEL PRESET NEGARA KAMPANYE (country_presets)
CREATE TABLE IF NOT EXISTS public.country_presets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    countries JSONB NOT NULL DEFAULT '[]'::jsonb,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.country_presets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "country_presets_all_auth" ON public.country_presets
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "country_presets_anon_select" ON public.country_presets
    FOR SELECT TO anon USING (true);

-- 5. TABEL TEMPLATE UKURAN GPT IKLAN (gpt_size_templates)
CREATE TABLE IF NOT EXISTS public.gpt_size_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    sizes JSONB NOT NULL DEFAULT '[]'::jsonb,
    width INTEGER,
    height INTEGER,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.gpt_size_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "gpt_size_templates_all_auth" ON public.gpt_size_templates
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "gpt_size_templates_anon_select" ON public.gpt_size_templates
    FOR SELECT TO anon USING (true);

-- 6. TABEL SLOT KODE ADSENSE (adsense_slots)
CREATE TABLE IF NOT EXISTS public.adsense_slots (
    id TEXT PRIMARY KEY, -- Subdomain ID
    name TEXT,
    codes JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.adsense_slots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "adsense_slots_all_auth" ON public.adsense_slots
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "adsense_slots_anon_select" ON public.adsense_slots
    FOR SELECT TO anon USING (true);

-- 7. TABEL CLOAKING URLS (cloaking_urls)
CREATE TABLE IF NOT EXISTS public.cloaking_urls (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    url TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.cloaking_urls ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cloaking_urls_all_auth" ON public.cloaking_urls
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "cloaking_urls_anon_select" ON public.cloaking_urls
    FOR SELECT TO anon USING (true);

-- 8. TABEL INBOX TELEGRAM (telegram_inbox)
CREATE TABLE IF NOT EXISTS public.telegram_inbox (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL,
    from_name TEXT,
    message TEXT,
    dismissed BOOLEAN NOT NULL DEFAULT false,
    dismissed_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.telegram_inbox ENABLE ROW LEVEL SECURITY;
CREATE POLICY "telegram_inbox_all_auth" ON public.telegram_inbox
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "telegram_inbox_anon_select" ON public.telegram_inbox
    FOR SELECT TO anon USING (true);

-- 9. TABEL PENGATURAN UMUM APLIKASI (app_settings)
-- Digunakan untuk roi_settings, alert_settings, notification_settings
CREATE TABLE IF NOT EXISTS public.app_settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "app_settings_all_auth" ON public.app_settings
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "app_settings_anon_select" ON public.app_settings
    FOR SELECT TO anon USING (true);



-- >>> FILE: 20261028000017_breakdown_daily_stats_per_subdomain.sql <<<
-- ==============================================================================
-- MIGRASI 17: PECAH DATA DAILY_STATS DAN VIEW_DAILY_ROI PER SUBDOMAIN RESMI
-- Versi: 20261028000017_breakdown_daily_stats_per_subdomain.sql
-- Keterangan: Memecah pendapatan GAM dan belanja Meta per subdomain
--             sehingga Mul (Amul), Sul, Nur, dan Man masing-masing memiliki
--             perhitungan ROI Founder yang presisi dan adil.
-- ==============================================================================

-- 1. Tambahkan kolom subdomain pada tabel daily_stats
ALTER TABLE public.daily_stats ADD COLUMN IF NOT EXISTS subdomain TEXT DEFAULT '';

-- 2. Perbarui constraint unik agar mendukung per (date, site_code, subdomain, source)
ALTER TABLE public.daily_stats DROP CONSTRAINT IF EXISTS uq_daily_stats;
ALTER TABLE public.daily_stats DROP CONSTRAINT IF EXISTS uq_daily_stats_subdomain;
ALTER TABLE public.daily_stats ADD CONSTRAINT uq_daily_stats_subdomain UNIQUE (date, site_code, subdomain, source);

CREATE INDEX IF NOT EXISTS idx_daily_stats_subdomain ON public.daily_stats(date, site_code, subdomain, source);

-- 3. Perbarui view_daily_roi agar membaca per subdomain dan menghubungkan ke PIC yang tepat
DROP VIEW IF EXISTS public.view_daily_roi CASCADE;

DROP VIEW IF EXISTS public.view_daily_financials CASCADE;
DROP VIEW IF EXISTS public.view_daily_roi CASCADE;
CREATE OR REPLACE VIEW public.view_daily_roi 
WITH (security_invoker = true) AS
WITH site_dates AS (
    SELECT DISTINCT date, site_code, COALESCE(subdomain, '') AS subdomain 
    FROM public.daily_stats
),
aggregated_rev AS (
    SELECT 
        date,
        site_code,
        COALESCE(subdomain, '') AS subdomain,
        COALESCE(SUM(revenue), 0) AS gam_revenue,
        COALESCE(SUM(impressions), 0) AS gam_impressions,
        COALESCE(SUM(clicks), 0) AS gam_clicks
    FROM public.daily_stats
    WHERE source IN ('gam', 'adsense')
    GROUP BY date, site_code, subdomain
),
aggregated_spend AS (
    SELECT 
        date,
        site_code,
        COALESCE(subdomain, '') AS subdomain,
        COALESCE(SUM(spend), 0) AS total_spend_idr,
        COALESCE(SUM(clicks), 0) AS ad_clicks,
        COALESCE(SUM(impressions), 0) AS ad_impressions
    FROM public.daily_stats
    WHERE source IN ('meta', 'keitaro')
    GROUP BY date, site_code, subdomain
),
tracker_stats AS (
    SELECT 
        date,
        site_code,
        COALESCE(subdomain, '') AS subdomain,
        COALESCE(SUM(revenue), 0) AS tracker_revenue,
        COALESCE(SUM(clicks), 0) AS tracker_clicks
    FROM public.daily_stats
    WHERE source = 'keitaro'
    GROUP BY date, site_code, subdomain
),
calculated_base AS (
    SELECT 
        (sd.date || '_' || sd.site_code || '_' || NULLIF(sd.subdomain, '')) AS id,
        sd.date,
        '23:59' AS time,
        sd.site_code,
        COALESCE(NULLIF(sd.subdomain, ''), s.name, sd.site_code) AS site_name,
        COALESCE(NULLIF(sd.subdomain, ''), s.name, sd.site_code) AS sub_domain,
        COALESCE(sd.site_code, '-') AS campaign,
        COALESCE(s.parent_domain, '-') AS domain,
        COALESCE(s.pic, '-') AS pic,
        COALESCE(sp.total_spend_idr, 0) AS spend_idr,
        
        -- Nilai pendapatan mentah (USD untuk Trayedit/TikTok/IHOP, INR untuk Tacobell)
        CASE 
            WHEN COALESCE(rv.gam_revenue, 0) > 0 THEN rv.gam_revenue 
            ELSE COALESCE(ts.tracker_revenue, 0) 
        END AS raw_revenue,
        
        -- Kurs resmi masdef
        CASE 
            WHEN sd.site_code = 'taco-fries' THEN 190.87
            ELSE 18155.28
        END AS fx_rate,
        
        CASE 
            WHEN sd.site_code = 'taco-fries' THEN 'INR'
            ELSE 'USD'
        END AS currency_code,
        
        COALESCE(sp.ad_clicks, ts.tracker_clicks, 0) AS clicks,
        COALESCE(sp.ad_impressions, rv.gam_impressions, 0) AS impressions
    FROM site_dates sd
    LEFT JOIN public.subdomains s ON (
        (sd.subdomain <> '' AND (s.name = sd.subdomain OR s.name ILIKE '%' || sd.subdomain || '%'))
        OR
        (sd.subdomain = '' AND s.site_code = sd.site_code)
    )
    LEFT JOIN aggregated_rev rv ON rv.date = sd.date AND rv.site_code = sd.site_code AND rv.subdomain = sd.subdomain
    LEFT JOIN aggregated_spend sp ON sp.date = sd.date AND sp.site_code = sd.site_code AND sp.subdomain = sd.subdomain
    LEFT JOIN tracker_stats ts ON ts.date = sd.date AND ts.site_code = sd.site_code AND ts.subdomain = sd.subdomain
)
SELECT 
    b.id,
    b.date,
    b.time,
    b.site_code,
    b.site_name,
    b.sub_domain,
    b.campaign,
    b.domain,
    b.pic,
    
    -- Belanja Iklan Meta (IDR)
    b.spend_idr AS spending,
    b.spend_idr AS meta_spend,
    b.spend_idr AS meta_ads,
    0 AS ad_tax,
    b.spend_idr AS total_spending,
    
    -- Pendapatan Bersih Dikonversi Presisi ke IDR
    ROUND(b.raw_revenue * b.fx_rate) AS earning,
    ROUND(b.raw_revenue * b.fx_rate) AS gam_revenue,
    
    -- Profit Bersih (IDR)
    (ROUND(b.raw_revenue * b.fx_rate) - b.spend_idr) AS profit,
    
    -- ROI Presisi (%)
    CASE 
        WHEN b.spend_idr > 0 THEN 
            ROUND((((ROUND(b.raw_revenue * b.fx_rate) - b.spend_idr) / b.spend_idr) * 100)::numeric, 2)
        ELSE 0 
    END AS roi,
    
    b.clicks,
    b.impressions,
    CASE 
        WHEN b.clicks > 0 THEN 
            ROUND((b.spend_idr / b.clicks)::numeric, 4)
        ELSE 0 
    END AS cpc,
    
    b.currency_code AS currency,
    b.fx_rate AS fx_rate
FROM calculated_base b;



-- >>> FILE: 20261028000018_recreate_view_daily_financials.sql <<<
-- ==============================================================================
-- MIGRASI 18: MEMBUAT ULANG VIEW VIEW_DAILY_FINANCIALS DI SUPABASE
-- Versi: 20261028000018_recreate_view_daily_financials.sql
-- Keterangan: Dibuat ulang karena view_daily_roi sebelumnya di-DROP CASCADE.
--             Menyajikan ringkasan agregasi harian untuk grafik & Overview TigerROI.
-- ==============================================================================

DROP VIEW IF EXISTS public.view_daily_financials CASCADE;

DROP VIEW IF EXISTS public.view_daily_financials CASCADE;
CREATE OR REPLACE VIEW public.view_daily_financials
WITH (security_invoker = true) AS
SELECT 
    v.date,
    COALESCE(SUM(v.earning), 0) AS gross_revenue,
    COALESCE(SUM(v.spending), 0) AS total_spend,
    COALESCE(SUM(v.ad_tax), 0) AS ad_tax,
    COALESCE(SUM(v.total_spending), 0) AS total_spending,
    COALESCE(SUM(v.profit), 0) AS net_profit
FROM public.view_daily_roi v
GROUP BY v.date
ORDER BY v.date DESC;

-- Izin akses SELECT untuk anon dan authenticated
GRANT SELECT ON public.view_daily_financials TO anon, authenticated, service_role;



-- >>> FILE: 20261028000019_fix_view_daily_roi_exact_1to1.sql <<<

DROP VIEW IF EXISTS public.view_daily_roi CASCADE;

DROP VIEW IF EXISTS public.view_daily_financials CASCADE;
DROP VIEW IF EXISTS public.view_daily_roi CASCADE;
CREATE OR REPLACE VIEW public.view_daily_roi 
WITH (security_invoker = true) AS
WITH site_dates AS (
    SELECT DISTINCT date, site_code, COALESCE(subdomain, '') AS subdomain 
    FROM public.daily_stats
),
aggregated_rev AS (
    SELECT 
        date,
        site_code,
        COALESCE(subdomain, '') AS subdomain,
        COALESCE(SUM(revenue), 0) AS gam_revenue,
        COALESCE(SUM(impressions), 0) AS gam_impressions,
        COALESCE(SUM(clicks), 0) AS gam_clicks
    FROM public.daily_stats
    WHERE source IN ('gam', 'adsense')
    GROUP BY date, site_code, subdomain
),
aggregated_spend AS (
    SELECT 
        date,
        site_code,
        COALESCE(subdomain, '') AS subdomain,
        COALESCE(SUM(spend), 0) AS total_spend_idr,
        COALESCE(SUM(clicks), 0) AS ad_clicks,
        COALESCE(SUM(impressions), 0) AS ad_impressions
    FROM public.daily_stats
    WHERE source IN ('meta', 'keitaro')
    GROUP BY date, site_code, subdomain
),
tracker_stats AS (
    SELECT 
        date,
        site_code,
        COALESCE(subdomain, '') AS subdomain,
        COALESCE(SUM(revenue), 0) AS tracker_revenue,
        COALESCE(SUM(clicks), 0) AS tracker_clicks
    FROM public.daily_stats
    WHERE source = 'keitaro'
    GROUP BY date, site_code, subdomain
),
subdomain_map AS (
    SELECT DISTINCT ON (name)
        site_code,
        name,
        parent_domain,
        pic
    FROM public.subdomains
    ORDER BY name, created_at ASC
),
site_map AS (
    SELECT DISTINCT ON (site_code)
        site_code,
        name,
        parent_domain,
        pic
    FROM public.subdomains
    ORDER BY site_code, created_at ASC
),
calculated_base AS (
    SELECT 
        (sd.date || '_' || sd.site_code || '_' || NULLIF(sd.subdomain, '')) AS id,
        sd.date,
        '23:59' AS time,
        sd.site_code,
        COALESCE(NULLIF(sd.subdomain, ''), sm.name, sim.name, sd.site_code) AS site_name,
        COALESCE(NULLIF(sd.subdomain, ''), sm.name, sim.name, sd.site_code) AS sub_domain,
        COALESCE(sd.site_code, '-') AS campaign,
        COALESCE(sm.parent_domain, sim.parent_domain, '-') AS domain,
        COALESCE(sm.pic, sim.pic, '-') AS pic,
        COALESCE(sp.total_spend_idr, 0) AS spend_idr,
        
        -- Nilai pendapatan mentah (USD untuk Trayedit/TikTok/IHOP, INR untuk Tacobell)
        CASE 
            WHEN COALESCE(rv.gam_revenue, 0) > 0 THEN rv.gam_revenue 
            ELSE COALESCE(ts.tracker_revenue, 0) 
        END AS raw_revenue,
        
        -- Kurs resmi masdef
        CASE 
            WHEN sd.site_code = 'taco-fries' THEN 190.87
            ELSE 18155.28
        END AS fx_rate,
        
        CASE 
            WHEN sd.site_code = 'taco-fries' THEN 'INR'
            ELSE 'USD'
        END AS currency_code,
        
        COALESCE(sp.ad_clicks, ts.tracker_clicks, 0) AS clicks,
        COALESCE(sp.ad_impressions, rv.gam_impressions, 0) AS impressions
    FROM site_dates sd
    LEFT JOIN subdomain_map sm ON sm.name = sd.subdomain
    LEFT JOIN site_map sim ON sim.site_code = sd.site_code AND sd.subdomain = ''
    LEFT JOIN aggregated_rev rv ON rv.date = sd.date AND rv.site_code = sd.site_code AND rv.subdomain = sd.subdomain
    LEFT JOIN aggregated_spend sp ON sp.date = sd.date AND sp.site_code = sd.site_code AND sp.subdomain = sd.subdomain
    LEFT JOIN tracker_stats ts ON ts.date = sd.date AND ts.site_code = sd.site_code AND ts.subdomain = sd.subdomain
)
SELECT 
    b.id,
    b.date,
    b.time,
    b.site_code,
    b.site_name,
    b.sub_domain,
    b.campaign,
    b.domain,
    b.pic,
    
    -- Belanja Iklan Meta (IDR)
    b.spend_idr AS spending,
    b.spend_idr AS meta_spend,
    b.spend_idr AS meta_ads,
    0 AS ad_tax,
    b.spend_idr AS total_spending,
    
    -- Pendapatan Bersih Dikonversi Presisi ke IDR
    ROUND(b.raw_revenue * b.fx_rate) AS earning,
    ROUND(b.raw_revenue * b.fx_rate) AS gam_revenue,
    
    -- Profit Bersih (IDR)
    (ROUND(b.raw_revenue * b.fx_rate) - b.spend_idr) AS profit,
    
    -- ROI Presisi (%)
    CASE 
        WHEN b.spend_idr > 0 THEN 
            ROUND((((ROUND(b.raw_revenue * b.fx_rate) - b.spend_idr) / b.spend_idr) * 100)::numeric, 2)
        ELSE 0 
    END AS roi,
    
    b.clicks,
    b.impressions,
    CASE 
        WHEN b.clicks > 0 THEN 
            ROUND((b.spend_idr / b.clicks)::numeric, 4)
        ELSE 0 
    END AS cpc,
    
    b.currency_code AS currency,
    b.fx_rate AS fx_rate
FROM calculated_base b;

GRANT SELECT ON public.view_daily_roi TO anon, authenticated, service_role;

DROP VIEW IF EXISTS public.view_daily_financials CASCADE;

DROP VIEW IF EXISTS public.view_daily_financials CASCADE;
CREATE OR REPLACE VIEW public.view_daily_financials
WITH (security_invoker = true) AS
SELECT 
    v.date,
    COALESCE(SUM(v.earning), 0) AS gross_revenue,
    COALESCE(SUM(v.spending), 0) AS total_spend,
    COALESCE(SUM(v.ad_tax), 0) AS ad_tax,
    COALESCE(SUM(v.total_spending), 0) AS total_spending,
    COALESCE(SUM(v.profit), 0) AS net_profit
FROM public.view_daily_roi v
GROUP BY v.date
ORDER BY v.date DESC;

GRANT SELECT ON public.view_daily_financials TO anon, authenticated, service_role;



-- >>> FILE: 20261028000020_switch_gam_to_direct_idr.sql <<<
-- ==============================================================================
-- MIGRASI 20: DUKUNGAN PENDAPATAN LANGSUNG MATA UANG IDR DARI GOOGLE AD MANAGER
-- Versi: 20261028000020_switch_gam_to_direct_idr.sql
-- Keterangan: Pendapatan GAM kini ditarik langsung dalam mata uang IDR murni
--             menggunakan parameter currencyCode: 'IDR' dari GAM API.
--             Tidak lagi menggunakan perkalian kurs manual/statis.
-- ==============================================================================

DROP VIEW IF EXISTS public.view_daily_roi CASCADE;

DROP VIEW IF EXISTS public.view_daily_financials CASCADE;
DROP VIEW IF EXISTS public.view_daily_roi CASCADE;
CREATE OR REPLACE VIEW public.view_daily_roi 
WITH (security_invoker = true) AS
WITH site_dates AS (
    SELECT DISTINCT date, site_code, COALESCE(subdomain, '') AS subdomain 
    FROM public.daily_stats
),
aggregated_rev AS (
    SELECT 
        date,
        site_code,
        COALESCE(subdomain, '') AS subdomain,
        COALESCE(SUM(revenue), 0) AS gam_revenue,
        COALESCE(SUM(impressions), 0) AS gam_impressions,
        COALESCE(SUM(clicks), 0) AS gam_clicks
    FROM public.daily_stats
    WHERE source IN ('gam', 'adsense')
    GROUP BY date, site_code, subdomain
),
aggregated_spend AS (
    SELECT 
        date,
        site_code,
        COALESCE(subdomain, '') AS subdomain,
        COALESCE(SUM(spend), 0) AS total_spend_idr,
        COALESCE(SUM(clicks), 0) AS ad_clicks,
        COALESCE(SUM(impressions), 0) AS ad_impressions
    FROM public.daily_stats
    WHERE source IN ('meta', 'keitaro')
    GROUP BY date, site_code, subdomain
),
tracker_stats AS (
    SELECT 
        date,
        site_code,
        COALESCE(subdomain, '') AS subdomain,
        COALESCE(SUM(revenue), 0) AS tracker_revenue,
        COALESCE(SUM(clicks), 0) AS tracker_clicks
    FROM public.daily_stats
    WHERE source = 'keitaro'
    GROUP BY date, site_code, subdomain
),
subdomain_map AS (
    SELECT DISTINCT ON (name) 
        site_code, 
        name, 
        parent_domain, 
        pic 
    FROM public.subdomains 
    ORDER BY name, created_at ASC
),
site_map AS (
    SELECT DISTINCT ON (site_code) 
        site_code, 
        name, 
        parent_domain, 
        pic 
    FROM public.subdomains 
    ORDER BY site_code, created_at ASC
),
calculated_base AS (
    SELECT 
        (sd.date || '_' || sd.site_code || '_' || NULLIF(sd.subdomain, '')) AS id,
        sd.date,
        '23:59' AS time,
        sd.site_code,
        COALESCE(NULLIF(sd.subdomain, ''), sm.name, sim.name, sd.site_code) AS site_name,
        COALESCE(NULLIF(sd.subdomain, ''), sm.name, sim.name, sd.site_code) AS sub_domain,
        COALESCE(sd.site_code, '-') AS campaign,
        COALESCE(sm.parent_domain, sim.parent_domain, '-') AS domain,
        COALESCE(sm.pic, sim.pic, '-') AS pic,
        COALESCE(sp.total_spend_idr, 0) AS spend_idr,
        
        -- Nilai pendapatan mentah (sudah IDR murni resmi dari GAM)
        CASE 
            WHEN COALESCE(rv.gam_revenue, 0) > 0 THEN rv.gam_revenue 
            ELSE COALESCE(ts.tracker_revenue, 0) 
        END AS raw_revenue,
        
        -- Kurs adalah 1.0 karena seluruh data sudah dalam IDR murni
        1.0 AS fx_rate,
        'IDR' AS currency_code,
        
        COALESCE(sp.ad_clicks, ts.tracker_clicks, 0) AS clicks,
        COALESCE(sp.ad_impressions, rv.gam_impressions, 0) AS impressions
    FROM site_dates sd
    LEFT JOIN subdomain_map sm ON sm.name = sd.subdomain
    LEFT JOIN site_map sim ON sim.site_code = sd.site_code AND sd.subdomain = ''
    LEFT JOIN aggregated_rev rv ON rv.date = sd.date AND rv.site_code = sd.site_code AND rv.subdomain = sd.subdomain
    LEFT JOIN aggregated_spend sp ON sp.date = sd.date AND sp.site_code = sd.site_code AND sp.subdomain = sd.subdomain
    LEFT JOIN tracker_stats ts ON ts.date = sd.date AND ts.site_code = sd.site_code AND ts.subdomain = sd.subdomain
)
SELECT 
    b.id,
    b.date,
    b.time,
    b.site_code,
    b.site_name,
    b.sub_domain,
    b.campaign,
    b.domain,
    b.pic,
    
    -- Belanja Iklan Meta (IDR)
    b.spend_idr AS spending,
    b.spend_idr AS meta_spend,
    b.spend_idr AS meta_ads,
    0 AS ad_tax,
    b.spend_idr AS total_spending,
    
    -- Pendapatan Bersih IDR Murni Langsung dari GAM
    ROUND(b.raw_revenue) AS earning,
    ROUND(b.raw_revenue) AS gam_revenue,
    
    -- Profit Bersih Nyata (Earning IDR - Spend IDR)
    (ROUND(b.raw_revenue) - b.spend_idr) AS profit,
    
    -- ROI Presisi (%)
    CASE 
        WHEN b.spend_idr > 0 THEN 
            ROUND((((ROUND(b.raw_revenue) - b.spend_idr) / b.spend_idr) * 100)::numeric, 2)
        ELSE 0 
    END AS roi,
    
    b.clicks,
    b.impressions,
    CASE 
        WHEN b.clicks > 0 THEN 
            ROUND((b.spend_idr / b.clicks)::numeric, 4)
        ELSE 0 
    END AS cpc,
    
    b.currency_code AS currency,
    b.fx_rate AS fx_rate
FROM calculated_base b;

GRANT SELECT ON public.view_daily_roi TO anon, authenticated, service_role;

DROP VIEW IF EXISTS public.view_daily_financials CASCADE;

DROP VIEW IF EXISTS public.view_daily_financials CASCADE;
CREATE OR REPLACE VIEW public.view_daily_financials
WITH (security_invoker = true) AS
SELECT 
    v.date,
    COALESCE(SUM(v.earning), 0) AS gross_revenue,
    COALESCE(SUM(v.spending), 0) AS total_spend,
    COALESCE(SUM(v.ad_tax), 0) AS ad_tax,
    COALESCE(SUM(v.total_spending), 0) AS total_spending,
    COALESCE(SUM(v.profit), 0) AS net_profit
FROM public.view_daily_roi v
GROUP BY v.date
ORDER BY v.date DESC;

GRANT SELECT ON public.view_daily_financials TO anon, authenticated, service_role;



-- >>> FILE: 20261029000021_create_gam_hourly_fill_rate.sql <<<
-- ==============================================================================
-- MIGRASI 21: TABEL DATA RASIO PENAYANGAN AD EXCHANGE PER JAM (GAM HOURLY FILL RATE)
-- Versi: 20261029000021_create_gam_hourly_fill_rate.sql
-- Keterangan: Menyimpan data total permintaan (req) dan tayangan (imp) per jam
--             dari Google Ad Manager untuk grafik & tabel Rasio Penayangan.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.gam_hourly_fill_rate (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    date DATE NOT NULL,
    hour TEXT NOT NULL,           -- '00' s/d '23'
    site_key TEXT NOT NULL,       -- hostname misal careers.tiktokmodapk.net atau format kode
    requests INTEGER NOT NULL DEFAULT 0,
    impressions INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_gam_hourly_fill_rate UNIQUE (date, hour, site_key)
);

CREATE INDEX IF NOT EXISTS idx_gam_hourly_lookup 
ON public.gam_hourly_fill_rate(date, site_key);

-- Aktifkan Row Level Security (RLS) sesuai aturan wajib
ALTER TABLE public.gam_hourly_fill_rate ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gam_hourly_fill_rate_select" ON public.gam_hourly_fill_rate
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "gam_hourly_fill_rate_admin" ON public.gam_hourly_fill_rate
    FOR ALL TO authenticated USING (public.is_admin());




-- >>> FILE: 20261029000022_add_country_and_audit_to_domains.sql <<<
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



-- >>> FILE: 20261029000023_update_view_daily_roi_sync_time.sql <<<
-- ==============================================================================
-- MIGRASI 23: WAKTU UPDATE VIEW_DAILY_ROI SESUAI SINKRONISASI GITHUB ACTIONS (WIB)
-- Versi: 20261029000023_update_view_daily_roi_sync_time.sql
-- Keterangan: Mengganti kolom 'time' yang sebelumnya di-hardcode '23:59' agar
--             menggunakan waktu aktual sinkronisasi terakhir (updated_at)
--             dari daily_stats dalam zona waktu Asia/Jakarta (WIB).
-- ==============================================================================

DROP VIEW IF EXISTS public.view_daily_financials CASCADE;
DROP VIEW IF EXISTS public.view_daily_roi CASCADE;

DROP VIEW IF EXISTS public.view_daily_financials CASCADE;
DROP VIEW IF EXISTS public.view_daily_roi CASCADE;
CREATE OR REPLACE VIEW public.view_daily_roi 
WITH (security_invoker = true) AS
WITH site_dates AS (
    SELECT 
        date, 
        site_code, 
        COALESCE(subdomain, '') AS subdomain,
        MAX(updated_at) AS last_updated_at
    FROM public.daily_stats
    GROUP BY date, site_code, COALESCE(subdomain, '')
),
aggregated_rev AS (
    SELECT 
        date,
        site_code,
        COALESCE(subdomain, '') AS subdomain,
        COALESCE(SUM(revenue), 0) AS gam_revenue,
        COALESCE(SUM(impressions), 0) AS gam_impressions,
        COALESCE(SUM(clicks), 0) AS gam_clicks
    FROM public.daily_stats
    WHERE source IN ('gam', 'adsense')
    GROUP BY date, site_code, subdomain
),
aggregated_spend AS (
    SELECT 
        date,
        site_code,
        COALESCE(subdomain, '') AS subdomain,
        COALESCE(SUM(spend), 0) AS total_spend_idr,
        COALESCE(SUM(clicks), 0) AS ad_clicks,
        COALESCE(SUM(impressions), 0) AS ad_impressions
    FROM public.daily_stats
    WHERE source IN ('meta', 'keitaro')
    GROUP BY date, site_code, subdomain
),
tracker_stats AS (
    SELECT 
        date,
        site_code,
        COALESCE(subdomain, '') AS subdomain,
        COALESCE(SUM(revenue), 0) AS tracker_revenue,
        COALESCE(SUM(clicks), 0) AS tracker_clicks
    FROM public.daily_stats
    WHERE source = 'keitaro'
    GROUP BY date, site_code, subdomain
),
subdomain_map AS (
    SELECT DISTINCT ON (name) 
        site_code, 
        name, 
        parent_domain, 
        pic 
    FROM public.subdomains 
    ORDER BY name, created_at ASC
),
site_map AS (
    SELECT DISTINCT ON (site_code) 
        site_code, 
        name, 
        parent_domain, 
        pic 
    FROM public.subdomains 
    ORDER BY site_code, created_at ASC
),
calculated_base AS (
    SELECT 
        (sd.date || '_' || sd.site_code || '_' || NULLIF(sd.subdomain, '')) AS id,
        sd.date,
        TO_CHAR(COALESCE(sd.last_updated_at, now()) AT TIME ZONE 'Asia/Jakarta', 'HH24:MI') AS time,
        COALESCE(sd.last_updated_at, now()) AS updated_at,
        sd.site_code,
        COALESCE(NULLIF(sd.subdomain, ''), sm.name, sim.name, sd.site_code) AS site_name,
        COALESCE(NULLIF(sd.subdomain, ''), sm.name, sim.name, sd.site_code) AS sub_domain,
        COALESCE(sd.site_code, '-') AS campaign,
        COALESCE(sm.parent_domain, sim.parent_domain, '-') AS domain,
        COALESCE(sm.pic, sim.pic, '-') AS pic,
        COALESCE(sp.total_spend_idr, 0) AS spend_idr,
        
        -- Nilai pendapatan mentah (sudah IDR murni resmi dari GAM)
        CASE 
            WHEN COALESCE(rv.gam_revenue, 0) > 0 THEN rv.gam_revenue 
            ELSE COALESCE(ts.tracker_revenue, 0) 
        END AS raw_revenue,
        
        -- Kurs adalah 1.0 karena seluruh data sudah dalam IDR murni
        1.0 AS fx_rate,
        'IDR' AS currency_code,
        
        COALESCE(sp.ad_clicks, ts.tracker_clicks, 0) AS clicks,
        COALESCE(sp.ad_impressions, rv.gam_impressions, 0) AS impressions
    FROM site_dates sd
    LEFT JOIN subdomain_map sm ON sm.name = sd.subdomain
    LEFT JOIN site_map sim ON sim.site_code = sd.site_code AND sd.subdomain = ''
    LEFT JOIN aggregated_rev rv ON rv.date = sd.date AND rv.site_code = sd.site_code AND rv.subdomain = sd.subdomain
    LEFT JOIN aggregated_spend sp ON sp.date = sd.date AND sp.site_code = sd.site_code AND sp.subdomain = sd.subdomain
    LEFT JOIN tracker_stats ts ON ts.date = sd.date AND ts.site_code = sd.site_code AND ts.subdomain = sd.subdomain
)
SELECT 
    b.id,
    b.date,
    b.time,
    b.updated_at,
    b.site_code,
    b.site_name,
    b.sub_domain,
    b.campaign,
    b.domain,
    b.pic,
    
    -- Belanja Iklan Meta (IDR)
    b.spend_idr AS spending,
    b.spend_idr AS meta_spend,
    b.spend_idr AS meta_ads,
    0 AS ad_tax,
    b.spend_idr AS total_spending,
    
    -- Pendapatan Bersih IDR Murni Langsung dari GAM
    ROUND(b.raw_revenue) AS earning,
    ROUND(b.raw_revenue) AS gam_revenue,
    
    -- Profit Bersih Nyata (Earning IDR - Spend IDR)
    (ROUND(b.raw_revenue) - b.spend_idr) AS profit,
    
    -- ROI Presisi (%)
    CASE 
        WHEN b.spend_idr > 0 THEN 
            ROUND((((ROUND(b.raw_revenue) - b.spend_idr) / b.spend_idr) * 100)::numeric, 2)
        ELSE 0 
    END AS roi,
    
    b.clicks,
    b.impressions,
    CASE 
        WHEN b.clicks > 0 THEN 
            ROUND((b.spend_idr / b.clicks)::numeric, 4)
        ELSE 0 
    END AS cpc,
    
    b.currency_code AS currency,
    b.fx_rate AS fx_rate
FROM calculated_base b;

GRANT SELECT ON public.view_daily_roi TO anon, authenticated, service_role;

DROP VIEW IF EXISTS public.view_daily_financials CASCADE;
CREATE OR REPLACE VIEW public.view_daily_financials
WITH (security_invoker = true) AS
SELECT 
    v.date,
    COALESCE(SUM(v.earning), 0) AS gross_revenue,
    COALESCE(SUM(v.spending), 0) AS total_spend,
    COALESCE(SUM(v.ad_tax), 0) AS ad_tax,
    COALESCE(SUM(v.total_spending), 0) AS total_spending,
    COALESCE(SUM(v.profit), 0) AS net_profit
FROM public.view_daily_roi v
GROUP BY v.date
ORDER BY v.date DESC;

GRANT SELECT ON public.view_daily_financials TO anon, authenticated, service_role;



-- >>> FILE: 20261029000024_create_roi_snapshots.sql <<<
-- ==============================================================================
-- MIGRASI 24: TABEL ROI_SNAPSHOTS UNTUK RIWAYAT SINKRONISASI REALTIME
-- Versi: 20261029000024_create_roi_snapshots.sql
-- Keterangan: Menyimpan riwayat snapshot performa ROI per waktu eksekusi sync
--             GitHub Actions (WIB). Tidak menimpa jam-jam sebelumnya sehingga
--             pengguna dapat melihat jejak performa dari 00:00 hingga 23:59.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.roi_snapshots (
    id TEXT PRIMARY KEY,
    date DATE NOT NULL,
    time TEXT NOT NULL,
    site_code TEXT NOT NULL,
    sub_domain TEXT NOT NULL DEFAULT '',
    campaign TEXT NOT NULL DEFAULT '',
    domain TEXT NOT NULL DEFAULT '',
    pic TEXT NOT NULL DEFAULT '',
    
    spending NUMERIC(15, 2) NOT NULL DEFAULT 0,
    meta_spend NUMERIC(15, 2) NOT NULL DEFAULT 0,
    ad_tax NUMERIC(15, 2) NOT NULL DEFAULT 0,
    total_spending NUMERIC(15, 2) NOT NULL DEFAULT 0,
    
    earning NUMERIC(15, 2) NOT NULL DEFAULT 0,
    gam_revenue NUMERIC(15, 2) NOT NULL DEFAULT 0,
    adsense_revenue NUMERIC(15, 2) NOT NULL DEFAULT 0,
    
    profit NUMERIC(15, 2) NOT NULL DEFAULT 0,
    roi NUMERIC(8, 2) NOT NULL DEFAULT 0,
    
    clicks INTEGER NOT NULL DEFAULT 0,
    impressions INTEGER NOT NULL DEFAULT 0,
    cpc NUMERIC(10, 4) NOT NULL DEFAULT 0,
    
    currency TEXT NOT NULL DEFAULT 'IDR',
    fx_rate NUMERIC(10, 4) NOT NULL DEFAULT 1.0,
    
    fluk_spend NUMERIC(15, 2) DEFAULT 0,
    fluk_earn NUMERIC(15, 2) DEFAULT 0,
    fluk_roi NUMERIC(8, 2) DEFAULT 0,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indeks pencarian cepat dan pengurutan waktu
CREATE INDEX IF NOT EXISTS idx_roi_snapshots_date_time 
ON public.roi_snapshots(date DESC, time DESC);

CREATE INDEX IF NOT EXISTS idx_roi_snapshots_subdomain 
ON public.roi_snapshots(date, sub_domain);

-- Aktifkan Row Level Security (RLS)
ALTER TABLE public.roi_snapshots ENABLE ROW LEVEL SECURITY;

-- Kebijakan akses (RLS Policies):
CREATE POLICY "roi_snapshots_select" ON public.roi_snapshots
    FOR SELECT TO anon, authenticated
    USING (true);

CREATE POLICY "roi_snapshots_service_role" ON public.roi_snapshots
    FOR ALL TO service_role
    USING (true)
    WITH CHECK (true);

GRANT SELECT ON public.roi_snapshots TO anon, authenticated;
GRANT ALL ON public.roi_snapshots TO service_role;



-- >>> FILE: 20261030000025_allow_public_select_country_roi.sql <<<
-- ==============================================================================
-- MIGRASI 25: IZINKAN BACA PUBLIK TABEL BREAKDOWN NEGARA (country_roi)
-- ==============================================================================
-- Agar frontend TigerROI yang menggunakan anon key dapat membaca rincian
-- breakdown negara di tab Laporan ROI Realtime dan Profile User.

DROP POLICY IF EXISTS "country_roi_select" ON public.country_roi;

CREATE POLICY "country_roi_select" ON public.country_roi
    FOR SELECT TO public USING (true);




-- >>> FILE: 20261031000001_normalisasi_subdomain_country_roi_fqdn.sql <<<
-- Migrasi Normalisasi Penamaan Subdomain di Tabel country_roi
-- Menyelaraskan seluruh slug pendek menjadi nama domain lengkap (FQDN) resmi
-- agar data teragregasi utuh dalam satu subdomain resmi dan tidak terpecah dua.

BEGIN;

-- 1. Tray Edit (trayedit.com)
UPDATE public.country_roi SET sub_domain = 'cabinets.trayedit.com' WHERE sub_domain = 'cabinets';
UPDATE public.country_roi SET sub_domain = 'decor.trayedit.com' WHERE sub_domain = 'decor';
UPDATE public.country_roi SET sub_domain = 'materials.trayedit.com' WHERE sub_domain = 'materials';
UPDATE public.country_roi SET sub_domain = 'guides.trayedit.com' WHERE sub_domain = 'guides';
UPDATE public.country_roi SET sub_domain = 'styling.trayedit.com' WHERE sub_domain = 'styling';

-- 2. TikTok Mod APK (tiktokmodapk.net)
UPDATE public.country_roi SET sub_domain = 'insurance.tiktokmodapk.net' WHERE sub_domain = 'insurance';
UPDATE public.country_roi SET sub_domain = 'careers.tiktokmodapk.net' WHERE sub_domain = 'careers';
UPDATE public.country_roi SET sub_domain = 'rewards.tiktokmodapk.net' WHERE sub_domain = 'rewards';
UPDATE public.country_roi SET sub_domain = 'mod.tiktokmodapk.net' WHERE sub_domain = 'mod';

-- 3. Taco Bell (tacobellmenuu.us)
UPDATE public.country_roi SET sub_domain = 'cantina.tacobellmenuu.us' WHERE sub_domain = 'cantina';
UPDATE public.country_roi SET sub_domain = 'burrito.tacobellmenuu.us' WHERE sub_domain = 'burrito';
UPDATE public.country_roi SET sub_domain = 'fries.tacobellmenuu.us' WHERE sub_domain = 'fries';

-- 4. IHOP (ihopmenuwithprices.us)
UPDATE public.country_roi SET sub_domain = 'menu.ihopmenuwithprices.us' WHERE sub_domain = 'menu';
UPDATE public.country_roi SET sub_domain = 'deals.ihopmenuwithprices.us' WHERE sub_domain = 'deals';
UPDATE public.country_roi SET sub_domain = 'keto.ihopmenuwithprices.us' WHERE sub_domain = 'keto';
UPDATE public.country_roi SET sub_domain = 'hacks.ihopmenuwithprices.us' WHERE sub_domain = 'hacks';
UPDATE public.country_roi SET sub_domain = 'news.ihopmenuwithprices.us' WHERE sub_domain = 'news';

COMMIT;



-- >>> FILE: 20261031000002_tambah_rpc_admin_set_user_password.sql <<<
-- ==============================================================================
-- Migrasi RPC Ganti Password User Khusus Superadmin (TigerROI)
-- Fungsi aman (SECURITY DEFINER) untuk memungkinkan Superadmin mengganti
-- password anggota tim langsung dari antarmuka dashboard TigerROI.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.admin_set_user_password(target_user_id uuid, new_password text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  caller_role text;
  caller_email text;
BEGIN
  -- 1. Verifikasi bahwa sesi pemanggil aktif
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Akses ditolak: Anda harus login terlebih dahulu.';
  END IF;

  -- 2. Ambil role dan email pemanggil dari tabel profiles & auth.users
  SELECT role INTO caller_role
  FROM public.profiles
  WHERE id = auth.uid();

  SELECT email INTO caller_email
  FROM auth.users
  WHERE id = auth.uid();

  -- 3. Pastikan hanya Superadmin yang memiliki izin eksekusi
  IF (caller_role IS NULL OR caller_role NOT ILIKE '%superadmin%')
     AND (caller_email IS NULL OR caller_email NOT ILIKE '%superadmin%') THEN
    RAISE EXCEPTION 'Akses ditolak: Hanya Superadmin yang diizinkan mengubah password anggota tim.';
  END IF;

  -- 4. Validasi panjang password baru
  IF new_password IS NULL OR length(trim(new_password)) < 6 THEN
    RAISE EXCEPTION 'Password baru minimal harus 6 karakter.';
  END IF;

  -- 5. Perbarui password terenkripsi di tabel auth.users
  UPDATE auth.users
  SET encrypted_password = crypt(trim(new_password), gen_salt('bf')),
      updated_at = now()
  WHERE id = target_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pengguna dengan ID tersebut tidak ditemukan di sistem autentikasi.';
  END IF;

  RETURN jsonb_build_object('success', true, 'message', 'Password pengguna berhasil diperbarui.');
END;
$$;

-- Berikan izin eksekusi kepada pengguna yang telah terautentikasi (pemeriksaan superadmin dilakukan di dalam fungsi)
GRANT EXECUTE ON FUNCTION public.admin_set_user_password(uuid, text) TO authenticated;



-- >>> FILE: 20261031000003_selaraskan_tabel_expenses_dan_whitelist_topup.sql <<<
-- ==============================================================================
-- Migrasi Penyelarasan Kolom dan Policy RLS Tabel expenses dan whitelist_topup
-- Menambahkan kolom yang sesuai dengan kebutuhan form input dashboard accounting
-- serta memastikan hak akses (RLS Policy) eksplisit untuk operasi CRUD.
-- ==============================================================================

BEGIN;

-- 1. Penyelarasan Struktur Kolom Tabel expenses
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS item_name TEXT,
  ADD COLUMN IF NOT EXISTS qty NUMERIC DEFAULT 1,
  ADD COLUMN IF NOT EXISTS nominal NUMERIC(15, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total NUMERIC(15, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS note TEXT;

-- Jadikan category dan amount nullable agar tidak memicu not-null constraint error jika form hanya mengisi item_name / total
ALTER TABLE public.expenses
  ALTER COLUMN category DROP NOT NULL,
  ALTER COLUMN amount DROP NOT NULL;

-- 2. Penyelarasan Struktur Kolom Tabel whitelist_topup
ALTER TABLE public.whitelist_topup
  ADD COLUMN IF NOT EXISTS nama_kode TEXT,
  ADD COLUMN IF NOT EXISTS nominal NUMERIC(15, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fee_topup NUMERIC(15, 2) DEFAULT 0;

ALTER TABLE public.whitelist_topup
  ALTER COLUMN account_code DROP NOT NULL;

-- 3. Policy RLS Lengkap untuk public.expenses (Keuangan & Admin)
DROP POLICY IF EXISTS "expenses_keuangan_all" ON public.expenses;
DROP POLICY IF EXISTS "expenses_select" ON public.expenses;
DROP POLICY IF EXISTS "expenses_insert" ON public.expenses;
DROP POLICY IF EXISTS "expenses_update" ON public.expenses;
DROP POLICY IF EXISTS "expenses_delete" ON public.expenses;

CREATE POLICY "expenses_select" ON public.expenses
  FOR SELECT TO authenticated
  USING (public.is_keuangan() OR public.is_admin());

CREATE POLICY "expenses_insert" ON public.expenses
  FOR INSERT TO authenticated
  WITH CHECK (public.is_keuangan() OR public.is_admin());

CREATE POLICY "expenses_update" ON public.expenses
  FOR UPDATE TO authenticated
  USING (public.is_keuangan() OR public.is_admin())
  WITH CHECK (public.is_keuangan() OR public.is_admin());

CREATE POLICY "expenses_delete" ON public.expenses
  FOR DELETE TO authenticated
  USING (public.is_keuangan() OR public.is_admin());

-- 4. Policy RLS Lengkap untuk public.whitelist_topup (Keuangan & Admin)
DROP POLICY IF EXISTS "whitelist_keuangan_all" ON public.whitelist_topup;
DROP POLICY IF EXISTS "whitelist_topup_select" ON public.whitelist_topup;
DROP POLICY IF EXISTS "whitelist_topup_insert" ON public.whitelist_topup;
DROP POLICY IF EXISTS "whitelist_topup_update" ON public.whitelist_topup;
DROP POLICY IF EXISTS "whitelist_topup_delete" ON public.whitelist_topup;

CREATE POLICY "whitelist_topup_select" ON public.whitelist_topup
  FOR SELECT TO authenticated
  USING (public.is_keuangan() OR public.is_admin());

CREATE POLICY "whitelist_topup_insert" ON public.whitelist_topup
  FOR INSERT TO authenticated
  WITH CHECK (public.is_keuangan() OR public.is_admin());

CREATE POLICY "whitelist_topup_update" ON public.whitelist_topup
  FOR UPDATE TO authenticated
  USING (public.is_keuangan() OR public.is_admin())
  WITH CHECK (public.is_keuangan() OR public.is_admin());

CREATE POLICY "whitelist_topup_delete" ON public.whitelist_topup
  FOR DELETE TO authenticated
  USING (public.is_keuangan() OR public.is_admin());

COMMIT;



-- >>> FILE: 20261031000026_fix_ad_accounts_and_sync_trigger.sql <<<
-- ==============================================================================
-- Migrasi: Perbaikan Tabel ad_accounts & Sinkronisasi Otomatis ke meta_accounts
-- Versi: 20261031000026_fix_ad_accounts_and_sync_trigger.sql
-- ==============================================================================

-- 1. Pastikan kolom pendukung ada di public.ad_accounts
ALTER TABLE public.ad_accounts ADD COLUMN IF NOT EXISTS act_id TEXT;
ALTER TABLE public.ad_accounts ADD COLUMN IF NOT EXISTS spend_today NUMERIC(15, 2) DEFAULT 0;
ALTER TABLE public.ad_accounts ADD COLUMN IF NOT EXISTS sync_disabled BOOLEAN DEFAULT false;

-- Sinkronisasi nilai awal act_id dari account_id jika masih kosong
UPDATE public.ad_accounts 
SET act_id = account_id 
WHERE act_id IS NULL AND account_id IS NOT NULL;

-- 2. Pastikan kolom spend_today ada di public.meta_accounts
ALTER TABLE public.meta_accounts ADD COLUMN IF NOT EXISTS spend_today NUMERIC(15, 2) DEFAULT 0;

-- 3. PERBAIKAN ROW LEVEL SECURITY (RLS) POLICIES
-- Pastikan RLS tetap aktif namun memiliki policy eksplisit untuk operasi CRUD
ALTER TABLE public.ad_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_accounts ENABLE ROW LEVEL SECURITY;

-- Kebijakan untuk public.ad_accounts
DROP POLICY IF EXISTS "ad_accounts_select_auth" ON public.ad_accounts;
DROP POLICY IF EXISTS "ad_accounts_admin_all" ON public.ad_accounts;
DROP POLICY IF EXISTS "ad_accounts_all_auth" ON public.ad_accounts;
DROP POLICY IF EXISTS "ad_accounts_select_all" ON public.ad_accounts;
DROP POLICY IF EXISTS "ad_accounts_manage_all" ON public.ad_accounts;

CREATE POLICY "ad_accounts_select_all" ON public.ad_accounts
    FOR SELECT TO public USING (true);

CREATE POLICY "ad_accounts_manage_all" ON public.ad_accounts
    FOR ALL TO public USING (true) WITH CHECK (true);

-- Kebijakan untuk public.meta_accounts
DROP POLICY IF EXISTS "meta_accounts_select_admin" ON public.meta_accounts;
DROP POLICY IF EXISTS "meta_accounts_service_role_all" ON public.meta_accounts;
DROP POLICY IF EXISTS "meta_accounts_select_all" ON public.meta_accounts;
DROP POLICY IF EXISTS "meta_accounts_manage_all" ON public.meta_accounts;

CREATE POLICY "meta_accounts_select_all" ON public.meta_accounts
    FOR SELECT TO public USING (true);

CREATE POLICY "meta_accounts_manage_all" ON public.meta_accounts
    FOR ALL TO public USING (true) WITH CHECK (true);

-- 4. FUNGSI & TRIGGER: SINKRONISASI OTOMATIS DARI ad_accounts KE meta_accounts
CREATE OR REPLACE FUNCTION public.sync_ad_account_to_meta_accounts()
RETURNS TRIGGER AS $$
DECLARE
    v_act_id TEXT;
BEGIN
    IF TG_OP = 'DELETE' THEN
        DELETE FROM public.meta_accounts 
        WHERE account_id = OLD.account_id OR account_id = OLD.act_id;
        RETURN OLD;
    ELSE
        -- Normalisasi ID Meta (pastikan diawali act_)
        v_act_id := COALESCE(NEW.account_id, NEW.act_id);
        IF v_act_id IS NOT NULL AND NOT (v_act_id LIKE 'act_%') THEN
            v_act_id := 'act_' || v_act_id;
        END IF;

        NEW.account_id := v_act_id;
        NEW.act_id := v_act_id;

        INSERT INTO public.meta_accounts (
            account_id,
            name,
            currency,
            balance,
            spend_cap,
            amount_spent,
            spend_today,
            is_active,
            updated_at
        )
        VALUES (
            v_act_id,
            NEW.name,
            COALESCE(NEW.currency, 'IDR'),
            COALESCE(NEW.balance, 0),
            COALESCE(NEW.spend_cap, 0),
            COALESCE(NEW.amount_spent, 0),
            COALESCE(NEW.spend_today, 0),
            (COALESCE(NEW.status, 'ACTIVE') = 'ACTIVE' AND NOT COALESCE(NEW.sync_disabled, false)),
            now()
        )
        ON CONFLICT (account_id) DO UPDATE SET
            name = EXCLUDED.name,
            currency = EXCLUDED.currency,
            is_active = EXCLUDED.is_active,
            updated_at = now();

        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_sync_ad_accounts_to_meta ON public.ad_accounts;
CREATE TRIGGER trg_sync_ad_accounts_to_meta
BEFORE INSERT OR UPDATE OR DELETE ON public.ad_accounts
FOR EACH ROW EXECUTE FUNCTION public.sync_ad_account_to_meta_accounts();

-- 5. Masukkan data yang sudah ada di ad_accounts ke meta_accounts jika belum ada
INSERT INTO public.meta_accounts (account_id, name, currency, balance, spend_cap, amount_spent, is_active)
SELECT 
    account_id, 
    name, 
    COALESCE(currency, 'IDR'), 
    COALESCE(balance, 0), 
    COALESCE(spend_cap, 0), 
    COALESCE(amount_spent, 0), 
    CASE WHEN status = 'ACTIVE' AND COALESCE(sync_disabled, false) = false THEN true ELSE false END
FROM public.ad_accounts
WHERE account_id IS NOT NULL
ON CONFLICT (account_id) DO UPDATE SET
    name = EXCLUDED.name,
    is_active = EXCLUDED.is_active;




-- >>> FILE: 20261031000027_fix_accounting_tables_and_bonus_percents.sql <<<
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




-- >>> FILE: 20261031000028_set_default_ad_accounts_to_all_users.sql <<<
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




-- >>> FILE: 20261101000001_perluas_presisi_numeric_country_roi.sql <<<
-- ==============================================================================
-- Migrasi Perluasan Presisi Kolom Numerik Tabel country_roi
-- Mencegah terjadinya error 'numeric field overflow' pada saat ROI melonjak tinggi
-- (misalnya negara dengan spend mendekati nol namun memiliki pendapatan GAM).
-- ==============================================================================

BEGIN;

-- Perluas presisi kolom roi dan cpc dari NUMERIC(8,2) menjadi NUMERIC(15,2)
ALTER TABLE public.country_roi
  ALTER COLUMN roi TYPE NUMERIC(15, 2),
  ALTER COLUMN cpc TYPE NUMERIC(15, 2);

COMMIT;



-- >>> FILE: 20261101000002_update_nama_negara_lengkap_country_roi.sql <<<
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



-- >>> FILE: 20261101000003_sisa_saldo_dari_account_spending_limit.sql <<<
-- ==============================================================================
-- Migrasi: Penyelarasan Sisa Saldo Meta Ads Mengikuti Account Spending Limit
-- Versi: 20261101000003_sisa_saldo_dari_account_spending_limit.sql
-- Keterangan:
-- Pada Meta Ads, kolom 'balance' API adalah tagihan berjalan (amount due / invoice),
-- sedangkan 'Sisa Saldo' sesungguhnya yang dilihat operator di kartu 'Batas Pengeluaran Akun'
-- adalah sisa batas pengeluaran: (spend_cap - amount_spent).
-- Migrasi ini memperbarui saldo agar mencerminkan sisa batas pengeluaran tersebut.
-- ==============================================================================

BEGIN;

-- 1. Perbarui nilai saldo di tabel ad_accounts berdasarkan sisa Account Spending Limit
UPDATE public.ad_accounts
SET balance = CASE
  WHEN COALESCE(spend_cap, 0) > 0 THEN GREATEST(0, spend_cap - COALESCE(amount_spent, 0))
  ELSE 0
END;

-- 2. Perbarui nilai saldo di tabel meta_accounts berdasarkan sisa Account Spending Limit
UPDATE public.meta_accounts
SET balance = CASE
  WHEN COALESCE(spend_cap, 0) > 0 THEN GREATEST(0, spend_cap - COALESCE(amount_spent, 0))
  ELSE 0
END;

-- 3. Perbarui fungsi trigger sync_ad_accounts_to_meta agar otomatis menghitung sisa batas
CREATE OR REPLACE FUNCTION public.sync_ad_accounts_to_meta()
RETURNS TRIGGER AS $$
DECLARE
    v_act_id TEXT;
    v_balance NUMERIC;
BEGIN
    IF TG_OP = 'DELETE' THEN
        DELETE FROM public.meta_accounts 
        WHERE account_id = COALESCE(OLD.account_id, OLD.act_id);
        RETURN OLD;
    ELSE
        v_act_id := COALESCE(NEW.account_id, NEW.act_id);
        IF v_act_id IS NOT NULL AND NOT (v_act_id LIKE 'act_%') THEN
            v_act_id := 'act_' || v_act_id;
        END IF;

        NEW.account_id := v_act_id;
        NEW.act_id := v_act_id;

        -- Jika ada batas pengeluaran (spend_cap > 0), sisa saldo adalah spend_cap - amount_spent
        v_balance := CASE
            WHEN COALESCE(NEW.spend_cap, 0) > 0 THEN GREATEST(0, NEW.spend_cap - COALESCE(NEW.amount_spent, 0))
            ELSE COALESCE(NEW.balance, 0)
        END;
        NEW.balance := v_balance;

        INSERT INTO public.meta_accounts (
            account_id,
            name,
            currency,
            balance,
            spend_cap,
            amount_spent,
            spend_today,
            is_active,
            updated_at
        )
        VALUES (
            v_act_id,
            NEW.name,
            COALESCE(NEW.currency, 'IDR'),
            v_balance,
            COALESCE(NEW.spend_cap, 0),
            COALESCE(NEW.amount_spent, 0),
            COALESCE(NEW.spend_today, 0),
            (COALESCE(NEW.status, 'ACTIVE') = 'ACTIVE' AND NOT COALESCE(NEW.sync_disabled, false)),
            now()
        )
        ON CONFLICT (account_id) DO UPDATE SET
            name = EXCLUDED.name,
            currency = EXCLUDED.currency,
            balance = EXCLUDED.balance,
            spend_cap = EXCLUDED.spend_cap,
            amount_spent = EXCLUDED.amount_spent,
            is_active = EXCLUDED.is_active,
            updated_at = now();

        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMIT;



-- >>> FILE: 20261101000004_perbaiki_pemetaan_pic_user_subdomains.sql <<<
-- ==============================================================================
-- Migrasi: Perbaikan Pemetaan pic_user_id pada 17 Subdomain
-- Versi: 20261101000004_perbaiki_pemetaan_pic_user_subdomains.sql
-- Keterangan:
-- Sebelumnya pada migrasi lama terdapat ketidaksengajaan pencocokan wildcard '%Man%'
-- yang menyebabkan 'Nurjaman' ikut terhubung ke subdomain milik Man / Ade Suparman
-- (mod, materials, keto) sehingga Nurjaman tampak memegang 6 subdomain di profilnya.
-- Migrasi ini menyelaraskan pic dan pic_user_id secara tepat sesuai kepemilikan riil:
-- - Nurjaman: 3 sub (rewards, decor, hacks)
-- - Ade Suparman (Man): 3 sub (mod, materials, keto)
-- - Mulyana (Mul): 3 sub (careers, guides, deals)
-- - Zulfan (Sul): 4 sub (insurance, burrito, cabinets, menu)
-- - Belum Ditugaskan: 4 sub (cantina, fries, styling, news)
-- ==============================================================================

BEGIN;

-- 1. Reset pic_user_id terlebih dahulu
UPDATE public.subdomains SET pic_user_id = NULL;

-- 2. Nurjaman (3 subdomain)
UPDATE public.subdomains
SET pic = 'Nurjaman',
    pic_user_id = (SELECT id FROM public.profiles WHERE email ILIKE '%nurjaman%' OR name ILIKE '%nurjaman%' LIMIT 1)
WHERE name IN ('rewards', 'rewards.tiktokmodapk.net', 'decor', 'decor.trayedit.com', 'hacks', 'hacks.ihopmenuwithprices.us');

-- 3. Ade Suparman / Man (3 subdomain)
UPDATE public.subdomains
SET pic = 'Man',
    pic_user_id = (SELECT id FROM public.profiles WHERE (email ILIKE '%man@tigerroi%' OR name ILIKE '%ade suparman%') AND email NOT ILIKE '%nurjaman%' LIMIT 1)
WHERE name IN ('mod', 'mod.tiktokmodapk.net', 'materials', 'materials.trayedit.com', 'keto', 'keto.ihopmenuwithprices.us');

-- 4. Mulyana / Mul (3 subdomain)
UPDATE public.subdomains
SET pic = 'Mul',
    pic_user_id = (SELECT id FROM public.profiles WHERE email ILIKE '%amul%' OR name ILIKE '%mulyana%' LIMIT 1)
WHERE name IN ('careers', 'careers.tiktokmodapk.net', 'guides', 'guides.trayedit.com', 'deals', 'deals.ihopmenuwithprices.us');

-- 5. Zulfan / Sul (4 subdomain)
UPDATE public.subdomains
SET pic = 'Sul',
    pic_user_id = (SELECT id FROM public.profiles WHERE email ILIKE '%sul%' OR email ILIKE '%zulfan%' OR name ILIKE '%zulfan%' LIMIT 1)
WHERE name IN ('insurance', 'insurance.tiktokmodapk.net', 'burrito', 'burrito.tacobellmenuu.us', 'cabinets', 'cabinets.trayedit.com', 'menu', 'menu.ihopmenuwithprices.us');

-- 6. Unassigned / Belum ada yang pegang (4 subdomain)
UPDATE public.subdomains
SET pic = NULL,
    pic_user_id = NULL
WHERE name IN ('cantina', 'cantina.tacobellmenuu.us', 'fries', 'fries.tacobellmenuu.us', 'styling', 'styling.trayedit.com', 'news', 'news.ihopmenuwithprices.us');

-- 7. Trigger otomatis: Saat pic diubah di form UI, sinkronkan pic_user_id ke profil yang benar
CREATE OR REPLACE FUNCTION public.sync_subdomain_pic_user_id()
RETURNS TRIGGER AS $$
DECLARE
    v_clean_pic TEXT;
    v_target_user_id UUID;
BEGIN
    v_clean_pic := LOWER(TRIM(COALESCE(NEW.pic, '')));
    
    IF v_clean_pic = '' OR v_clean_pic = '-' THEN
        NEW.pic_user_id := NULL;
        RETURN NEW;
    END IF;

    -- Cari user id yang paling cocok berdasarkan nama, username, atau email
    SELECT id INTO v_target_user_id
    FROM public.profiles
    WHERE LOWER(TRIM(name)) = v_clean_pic
       OR LOWER(TRIM(username)) = v_clean_pic
       OR LOWER(TRIM(email)) = v_clean_pic
       OR (v_clean_pic IN ('nur', 'nurjaman') AND (LOWER(name) ILIKE '%nurjaman%' OR LOWER(email) ILIKE '%nurjaman%'))
       OR (v_clean_pic IN ('man', 'ade', 'ade suparman') AND (LOWER(name) ILIKE '%suparman%' OR LOWER(email) ILIKE '%man@tigerroi%'))
       OR (v_clean_pic IN ('mul', 'mulyana') AND (LOWER(name) ILIKE '%mulyana%' OR LOWER(email) ILIKE '%amul%'))
       OR (v_clean_pic IN ('sul', 'zulfan', 'sulfin') AND (LOWER(name) ILIKE '%zulfan%' OR LOWER(email) ILIKE '%sul%'))
    ORDER BY CASE 
        WHEN LOWER(TRIM(name)) = v_clean_pic THEN 1
        WHEN LOWER(TRIM(username)) = v_clean_pic THEN 2
        ELSE 3
    END
    LIMIT 1;

    NEW.pic_user_id := v_target_user_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_sync_subdomain_pic_user_id ON public.subdomains;
CREATE TRIGGER trg_sync_subdomain_pic_user_id
BEFORE INSERT OR UPDATE OF pic ON public.subdomains
FOR EACH ROW
EXECUTE FUNCTION public.sync_subdomain_pic_user_id();

COMMIT;



-- >>> FILE: 20261101000005_perbaiki_angka_meledak_country_roi.sql <<<
-- ==============================================================================
-- MIGRASI 35: NORMALISASI ANGKA EARNING, PROFIT, DAN ROI DI TABEL COUNTRY_ROI
-- Versi: 20261101000005_perbaiki_angka_meledak_country_roi.sql
-- Keterangan: Membagi kembali nilai earning yang terlanjur terkalikan ganda
--             dengan kurs USD (18.155,28) karena data GAM aslinya sudah IDR murni.
-- ==============================================================================

BEGIN;

UPDATE public.country_roi
SET 
    earning = ROUND(earning / 18155.28, 2),
    profit = ROUND((earning / 18155.28) - (spend * 1.05), 2),
    roi = CASE 
        WHEN spend > 0 THEN ROUND(((((earning / 18155.28) - (spend * 1.05)) / (spend * 1.05)) * 100)::numeric, 2)
        ELSE 0 
    END
WHERE earning > 10000000; -- Hanya baris yang terlanjur membengkak di atas 10 juta rupiah per negara

COMMIT;




-- >>> FILE: 20261103000001_clean_domain_urls_remove_protocol.sql <<<
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



-- >>> FILE: 20261103000002_canonicalize_subdomains_in_snapshots.sql <<<
-- ==============================================================================
-- MIGRASI: KANONISASI SUBDOMAIN PADA TABEL ROI_SNAPSHOTS DAN DAILY_STATS
-- File: 20261103000002_canonicalize_subdomains_in_snapshots.sql
-- Keterangan: Mengubah seluruh slug subdomain singkat (contoh 'decor', 'materials',
--             'careers', dll) menjadi nama domain lengkap resmi (FQDN)
--             agar tidak terjadi duplikasi data antara slug dan FQDN.
-- ==============================================================================

BEGIN;

-- 1. Kanonisasi pada tabel roi_snapshots
UPDATE public.roi_snapshots SET sub_domain = 'menu.ihopmenuwithprices.us' WHERE sub_domain = 'menu';
UPDATE public.roi_snapshots SET sub_domain = 'deals.ihopmenuwithprices.us' WHERE sub_domain = 'deals';
UPDATE public.roi_snapshots SET sub_domain = 'keto.ihopmenuwithprices.us' WHERE sub_domain = 'keto';
UPDATE public.roi_snapshots SET sub_domain = 'hacks.ihopmenuwithprices.us' WHERE sub_domain = 'hacks';
UPDATE public.roi_snapshots SET sub_domain = 'news.ihopmenuwithprices.us' WHERE sub_domain = 'news';

UPDATE public.roi_snapshots SET sub_domain = 'cantina.tacobellmenuu.us' WHERE sub_domain = 'cantina';
UPDATE public.roi_snapshots SET sub_domain = 'burrito.tacobellmenuu.us' WHERE sub_domain = 'burrito';
UPDATE public.roi_snapshots SET sub_domain = 'fries.tacobellmenuu.us' WHERE sub_domain = 'fries';

UPDATE public.roi_snapshots SET sub_domain = 'insurance.tiktokmodapk.net' WHERE sub_domain = 'insurance';
UPDATE public.roi_snapshots SET sub_domain = 'careers.tiktokmodapk.net' WHERE sub_domain = 'careers';
UPDATE public.roi_snapshots SET sub_domain = 'rewards.tiktokmodapk.net' WHERE sub_domain = 'rewards';
UPDATE public.roi_snapshots SET sub_domain = 'mod.tiktokmodapk.net' WHERE sub_domain = 'mod';

UPDATE public.roi_snapshots SET sub_domain = 'decor.trayedit.com' WHERE sub_domain = 'decor';
UPDATE public.roi_snapshots SET sub_domain = 'materials.trayedit.com' WHERE sub_domain = 'materials';
UPDATE public.roi_snapshots SET sub_domain = 'cabinets.trayedit.com' WHERE sub_domain = 'cabinets';
UPDATE public.roi_snapshots SET sub_domain = 'guides.trayedit.com' WHERE sub_domain = 'guides';
UPDATE public.roi_snapshots SET sub_domain = 'styling.trayedit.com' WHERE sub_domain = 'styling';

-- 2. Update pic yang masih kosong/strip pada roi_snapshots yang sudah dikanonisasi
UPDATE public.roi_snapshots s
SET pic = sub.pic
FROM public.subdomains sub
WHERE s.sub_domain = sub.name
  AND (s.pic = '' OR s.pic = '-' OR s.pic IS NULL)
  AND sub.pic IS NOT NULL AND sub.pic != '' AND sub.pic != '-';

COMMIT;




-- >>> FILE: 20261103000003_fix_double_revenue_and_spend_view_daily_roi.sql <<<
-- ==============================================================================
-- MIGRASI 24: PERBAIKI PENDAPATAN & PENGELUARAN 2X LIPAT PADA VIEW_DAILY_ROI
-- File: 20261103000003_fix_double_revenue_and_spend_view_daily_roi.sql
-- Masalah: Pada tabel daily_stats terdapat baris lama tingkat site (subdomain = '')
--          DAN baris pecahan per subdomain (subdomain = 'decor', 'materials', dll).
--          Akibatnya view_daily_roi menarik kedua baris tersebut dan menjumlahkannya,
--          sehingga pendapatan dan pengeluaran membengkak 2x lipat.
-- Solusi: Filter site_dates agar HANYA mengambil baris pecahan per subdomain.
--         Baris subdomain = '' hanya diambil jika pada tanggal & site_code tersebut
--         belum ada data pecahan subdomain (fallback transparan).
-- ==============================================================================

DROP VIEW IF EXISTS public.view_daily_financials CASCADE;
DROP VIEW IF EXISTS public.view_daily_roi CASCADE;

DROP VIEW IF EXISTS public.view_daily_financials CASCADE;
DROP VIEW IF EXISTS public.view_daily_roi CASCADE;
CREATE OR REPLACE VIEW public.view_daily_roi 
WITH (security_invoker = true) AS
WITH site_dates AS (
    SELECT 
        date, 
        site_code, 
        COALESCE(subdomain, '') AS subdomain,
        MAX(updated_at) AS last_updated_at
    FROM public.daily_stats
    -- Hindari double-count: jika tanggal & site_code sudah memiliki rincian subdomain,
    -- jangan ambil baris agregat site induk (subdomain = '')
    WHERE COALESCE(subdomain, '') <> '' 
       OR NOT EXISTS (
           SELECT 1 FROM public.daily_stats s2 
           WHERE s2.date = daily_stats.date 
             AND s2.site_code = daily_stats.site_code 
             AND COALESCE(s2.subdomain, '') <> ''
       )
    GROUP BY date, site_code, COALESCE(subdomain, '')
),
aggregated_rev AS (
    SELECT 
        date,
        site_code,
        COALESCE(subdomain, '') AS subdomain,
        COALESCE(SUM(revenue), 0) AS gam_revenue,
        COALESCE(SUM(impressions), 0) AS gam_impressions,
        COALESCE(SUM(clicks), 0) AS gam_clicks
    FROM public.daily_stats
    WHERE source IN ('gam', 'adsense')
    GROUP BY date, site_code, subdomain
),
aggregated_spend AS (
    SELECT 
        date,
        site_code,
        COALESCE(subdomain, '') AS subdomain,
        COALESCE(SUM(spend), 0) AS total_spend_idr,
        COALESCE(SUM(clicks), 0) AS ad_clicks,
        COALESCE(SUM(impressions), 0) AS ad_impressions
    FROM public.daily_stats
    WHERE source IN ('meta', 'keitaro')
    GROUP BY date, site_code, subdomain
),
tracker_stats AS (
    SELECT 
        date,
        site_code,
        COALESCE(subdomain, '') AS subdomain,
        COALESCE(SUM(revenue), 0) AS tracker_revenue,
        COALESCE(SUM(clicks), 0) AS tracker_clicks
    FROM public.daily_stats
    WHERE source = 'keitaro'
    GROUP BY date, site_code, subdomain
),
subdomain_map AS (
    SELECT DISTINCT ON (name) 
        site_code, 
        name, 
        parent_domain, 
        pic 
    FROM public.subdomains 
    ORDER BY name, created_at ASC
),
site_map AS (
    SELECT DISTINCT ON (site_code) 
        site_code, 
        name, 
        parent_domain, 
        pic 
    FROM public.subdomains 
    ORDER BY site_code, created_at ASC
),
calculated_base AS (
    SELECT 
        (sd.date || '_' || sd.site_code || '_' || NULLIF(sd.subdomain, '')) AS id,
        sd.date,
        TO_CHAR(COALESCE(sd.last_updated_at, now()) AT TIME ZONE 'Asia/Jakarta', 'HH24:MI') AS time,
        COALESCE(sd.last_updated_at, now()) AS updated_at,
        sd.site_code,
        COALESCE(NULLIF(sd.subdomain, ''), sm.name, sim.name, sd.site_code) AS site_name,
        COALESCE(NULLIF(sd.subdomain, ''), sm.name, sim.name, sd.site_code) AS sub_domain,
        COALESCE(sd.site_code, '-') AS campaign,
        COALESCE(sm.parent_domain, sim.parent_domain, '-') AS domain,
        COALESCE(sm.pic, sim.pic, '-') AS pic,
        COALESCE(sp.total_spend_idr, 0) AS spend_idr,
        
        -- Nilai pendapatan mentah (sudah IDR murni resmi dari GAM)
        CASE 
            WHEN COALESCE(rv.gam_revenue, 0) > 0 THEN rv.gam_revenue 
            ELSE COALESCE(ts.tracker_revenue, 0) 
        END AS raw_revenue,
        
        -- Kurs adalah 1.0 karena seluruh data sudah dalam IDR murni
        1.0 AS fx_rate,
        'IDR' AS currency_code,
        
        COALESCE(sp.ad_clicks, ts.tracker_clicks, 0) AS clicks,
        COALESCE(sp.ad_impressions, rv.gam_impressions, 0) AS impressions
    FROM site_dates sd
    LEFT JOIN subdomain_map sm ON sm.name = sd.subdomain
    LEFT JOIN site_map sim ON sim.site_code = sd.site_code AND sd.subdomain = ''
    LEFT JOIN aggregated_rev rv ON rv.date = sd.date AND rv.site_code = sd.site_code AND rv.subdomain = sd.subdomain
    LEFT JOIN aggregated_spend sp ON sp.date = sd.date AND sp.site_code = sd.site_code AND sp.subdomain = sd.subdomain
    LEFT JOIN tracker_stats ts ON ts.date = sd.date AND ts.site_code = sd.site_code AND ts.subdomain = sd.subdomain
)
SELECT 
    b.id,
    b.date,
    b.time,
    b.updated_at,
    b.site_code,
    b.site_name,
    b.sub_domain,
    b.campaign,
    b.domain,
    b.pic,
    
    -- Belanja Iklan Meta (IDR)
    b.spend_idr AS spending,
    b.spend_idr AS meta_spend,
    b.spend_idr AS meta_ads,
    0 AS ad_tax,
    b.spend_idr AS total_spending,
    
    -- Pendapatan Bersih IDR Murni Langsung dari GAM
    ROUND(b.raw_revenue) AS earning,
    ROUND(b.raw_revenue) AS gam_revenue,
    
    -- Profit Bersih Nyata (Earning IDR - Spend IDR)
    (ROUND(b.raw_revenue) - b.spend_idr) AS profit,
    
    -- ROI Presisi (%)
    CASE 
        WHEN b.spend_idr > 0 THEN 
            ROUND((((ROUND(b.raw_revenue) - b.spend_idr) / b.spend_idr) * 100)::numeric, 2)
        ELSE 0 
    END AS roi,
    
    b.clicks,
    b.impressions,
    CASE 
        WHEN b.clicks > 0 THEN 
            ROUND((b.spend_idr / b.clicks)::numeric, 4)
        ELSE 0 
    END AS cpc,
    
    b.currency_code AS currency,
    b.fx_rate AS fx_rate
FROM calculated_base b;

GRANT SELECT ON public.view_daily_roi TO anon, authenticated, service_role;

-- Recreate view_daily_financials
DROP VIEW IF EXISTS public.view_daily_financials CASCADE;
CREATE OR REPLACE VIEW public.view_daily_financials
WITH (security_invoker = true) AS
SELECT 
    v.date,
    COALESCE(SUM(v.earning), 0) AS gross_revenue,
    COALESCE(SUM(v.spending), 0) AS total_spend,
    COALESCE(SUM(v.ad_tax), 0) AS ad_tax,
    COALESCE(SUM(v.total_spending), 0) AS total_spending,
    COALESCE(SUM(v.profit), 0) AS net_profit
FROM public.view_daily_roi v
GROUP BY v.date;

GRANT SELECT ON public.view_daily_financials TO anon, authenticated, service_role;




-- >>> FILE: 20261103000004_canonicalize_daily_stats_and_fix_double_spend_revenue.sql <<<
-- ==============================================================================
-- MIGRASI: NORMALISASI SUBDOMAIN DAILY_STATS & HILANGKAN DUPLIKASI SPEND/REVENUE
-- File: 20261103000004_canonicalize_daily_stats_and_fix_double_spend_revenue.sql
-- Masalah yang Diselesaikan:
-- 1. Tabel daily_stats menyimpan subdomain dalam bentuk slug ('careers', 'decor', dll)
--    DAN bentuk FQDN ('careers.tiktokmodapk.net', 'decor.trayedit.com'). Ini membuat
--    view_daily_roi menganggap keduanya entitas berbeda sehingga data terhitung 2x lipat.
-- 2. Pada view_daily_roi, spend di-SUM dari sumber 'meta' dan 'keitaro' secara bersamaan,
--    sehingga spend menjadi Rp 62.000.570 (tepat 2x lipat dari aslinya ~Rp 31.000.000).
-- 3. Di tabel daily_stats terdapat baris sisa lama dengan subdomain kosong ('') yang
--    membawa total angka site induk, padahal sudah ada rincian per subdomain.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. HAPUS BARIS AGREGAT LAMA TINGKAT SITE (subdomain = '') PADA DAILY_STATS
--    JIKA PADA TANGGAL & SITE TERSEBUT SUDAH ADA RINCIAN PECAHAN PER SUBDOMAIN
-- ------------------------------------------------------------------------------
DELETE FROM public.daily_stats d1
WHERE COALESCE(d1.subdomain, '') = ''
  AND EXISTS (
      SELECT 1 FROM public.daily_stats d2
      WHERE d2.date = d1.date
        AND d2.site_code = d1.site_code
        AND d2.source = d1.source
        AND COALESCE(d2.subdomain, '') <> ''
  );

-- ------------------------------------------------------------------------------
-- 2. KANONISASI & MERGE SUBDOMAIN SLUG KE FQDN PADA DAILY_STATS
-- ------------------------------------------------------------------------------

-- 2a. Update nilai pada baris target FQDN jika ada data yang lebih tinggi pada baris slug
UPDATE public.daily_stats target
SET 
    spend = GREATEST(target.spend, src.spend),
    revenue = GREATEST(target.revenue, src.revenue),
    clicks = GREATEST(target.clicks, src.clicks),
    impressions = GREATEST(target.impressions, src.impressions),
    updated_at = now()
FROM public.daily_stats src
JOIN (
    VALUES
        ('menu', 'menu.ihopmenuwithprices.us'),
        ('deals', 'deals.ihopmenuwithprices.us'),
        ('keto', 'keto.ihopmenuwithprices.us'),
        ('hacks', 'hacks.ihopmenuwithprices.us'),
        ('news', 'news.ihopmenuwithprices.us'),
        ('cantina', 'cantina.tacobellmenuu.us'),
        ('burrito', 'burrito.tacobellmenuu.us'),
        ('fries', 'fries.tacobellmenuu.us'),
        ('insurance', 'insurance.tiktokmodapk.net'),
        ('careers', 'careers.tiktokmodapk.net'),
        ('rewards', 'rewards.tiktokmodapk.net'),
        ('mod', 'mod.tiktokmodapk.net'),
        ('decor', 'decor.trayedit.com'),
        ('materials', 'materials.trayedit.com'),
        ('cabinets', 'cabinets.trayedit.com'),
        ('guides', 'guides.trayedit.com'),
        ('styling', 'styling.trayedit.com')
) AS map(slug, fqdn) ON src.subdomain = map.slug
WHERE target.date = src.date
  AND target.site_code = src.site_code
  AND target.source = src.source
  AND target.subdomain = map.fqdn;

-- 2b. Hapus baris slug yang target FQDN-nya sudah ada
DELETE FROM public.daily_stats src
USING (
    VALUES
        ('menu', 'menu.ihopmenuwithprices.us'),
        ('deals', 'deals.ihopmenuwithprices.us'),
        ('keto', 'keto.ihopmenuwithprices.us'),
        ('hacks', 'hacks.ihopmenuwithprices.us'),
        ('news', 'news.ihopmenuwithprices.us'),
        ('cantina', 'cantina.tacobellmenuu.us'),
        ('burrito', 'burrito.tacobellmenuu.us'),
        ('fries', 'fries.tacobellmenuu.us'),
        ('insurance', 'insurance.tiktokmodapk.net'),
        ('careers', 'careers.tiktokmodapk.net'),
        ('rewards', 'rewards.tiktokmodapk.net'),
        ('mod', 'mod.tiktokmodapk.net'),
        ('decor', 'decor.trayedit.com'),
        ('materials', 'materials.trayedit.com'),
        ('cabinets', 'cabinets.trayedit.com'),
        ('guides', 'guides.trayedit.com'),
        ('styling', 'styling.trayedit.com')
) AS map(slug, fqdn), public.daily_stats target
WHERE src.subdomain = map.slug
  AND target.date = src.date
  AND target.site_code = src.site_code
  AND target.source = src.source
  AND target.subdomain = map.fqdn;

-- 2c. Ubah nama slug yang tersisa ke nama domain lengkap (FQDN) resmi
UPDATE public.daily_stats src
SET subdomain = map.fqdn,
    updated_at = now()
FROM (
    VALUES
        ('menu', 'menu.ihopmenuwithprices.us'),
        ('deals', 'deals.ihopmenuwithprices.us'),
        ('keto', 'keto.ihopmenuwithprices.us'),
        ('hacks', 'hacks.ihopmenuwithprices.us'),
        ('news', 'news.ihopmenuwithprices.us'),
        ('cantina', 'cantina.tacobellmenuu.us'),
        ('burrito', 'burrito.tacobellmenuu.us'),
        ('fries', 'fries.tacobellmenuu.us'),
        ('insurance', 'insurance.tiktokmodapk.net'),
        ('careers', 'careers.tiktokmodapk.net'),
        ('rewards', 'rewards.tiktokmodapk.net'),
        ('mod', 'mod.tiktokmodapk.net'),
        ('decor', 'decor.trayedit.com'),
        ('materials', 'materials.trayedit.com'),
        ('cabinets', 'cabinets.trayedit.com'),
        ('guides', 'guides.trayedit.com'),
        ('styling', 'styling.trayedit.com')
) AS map(slug, fqdn)
WHERE src.subdomain = map.slug;

-- ------------------------------------------------------------------------------
-- 3. KANONISASI SUBDOMAIN PADA TABEL ROI_SNAPSHOTS
-- ------------------------------------------------------------------------------
UPDATE public.roi_snapshots s
SET sub_domain = map.fqdn
FROM (
    VALUES
        ('menu', 'menu.ihopmenuwithprices.us'),
        ('deals', 'deals.ihopmenuwithprices.us'),
        ('keto', 'keto.ihopmenuwithprices.us'),
        ('hacks', 'hacks.ihopmenuwithprices.us'),
        ('news', 'news.ihopmenuwithprices.us'),
        ('cantina', 'cantina.tacobellmenuu.us'),
        ('burrito', 'burrito.tacobellmenuu.us'),
        ('fries', 'fries.tacobellmenuu.us'),
        ('insurance', 'insurance.tiktokmodapk.net'),
        ('careers', 'careers.tiktokmodapk.net'),
        ('rewards', 'rewards.tiktokmodapk.net'),
        ('mod', 'mod.tiktokmodapk.net'),
        ('decor', 'decor.trayedit.com'),
        ('materials', 'materials.trayedit.com'),
        ('cabinets', 'cabinets.trayedit.com'),
        ('guides', 'guides.trayedit.com'),
        ('styling', 'styling.trayedit.com')
) AS map(slug, fqdn)
WHERE s.sub_domain = map.slug;

UPDATE public.roi_snapshots s
SET pic = sub.pic
FROM public.subdomains sub
WHERE s.sub_domain = sub.name
  AND (s.pic = '' OR s.pic = '-' OR s.pic IS NULL)
  AND sub.pic IS NOT NULL AND sub.pic != '' AND sub.pic != '-';

COMMIT;

-- ------------------------------------------------------------------------------
-- 4. BUAT ULANG VIEW_DAILY_ROI & VIEW_DAILY_FINANCIALS
--    DENGAN LOGIKA PRIORITAS SUMBER ANTI-DOUBLE-COUNT
-- ------------------------------------------------------------------------------
DROP VIEW IF EXISTS public.view_daily_financials CASCADE;
DROP VIEW IF EXISTS public.view_daily_roi CASCADE;

DROP VIEW IF EXISTS public.view_daily_financials CASCADE;
DROP VIEW IF EXISTS public.view_daily_roi CASCADE;
CREATE OR REPLACE VIEW public.view_daily_roi 
WITH (security_invoker = true) AS
WITH site_dates AS (
    SELECT 
        date, 
        site_code, 
        COALESCE(subdomain, '') AS subdomain,
        MAX(updated_at) AS last_updated_at
    FROM public.daily_stats
    WHERE COALESCE(subdomain, '') <> '' 
       OR NOT EXISTS (
           SELECT 1 FROM public.daily_stats s2 
           WHERE s2.date = daily_stats.date 
             AND s2.site_code = daily_stats.site_code 
             AND COALESCE(s2.subdomain, '') <> ''
       )
    GROUP BY date, site_code, COALESCE(subdomain, '')
),
aggregated_rev AS (
    SELECT 
        date,
        site_code,
        COALESCE(subdomain, '') AS subdomain,
        -- Utamakan GAM / AdSense, fallback ke Keitaro HANYA jika GAM tidak ada
        COALESCE(SUM(CASE WHEN source IN ('gam', 'adsense') THEN revenue ELSE 0 END), 0) AS gam_revenue,
        COALESCE(SUM(CASE WHEN source = 'keitaro' THEN revenue ELSE 0 END), 0) AS tracker_revenue,
        COALESCE(SUM(impressions), 0) AS impressions,
        COALESCE(SUM(clicks), 0) AS clicks
    FROM public.daily_stats
    GROUP BY date, site_code, COALESCE(subdomain, '')
),
aggregated_spend AS (
    SELECT 
        date,
        site_code,
        COALESCE(subdomain, '') AS subdomain,
        -- Utamakan Meta Ads, fallback ke Keitaro HANYA jika Meta tidak ada (JANGAN DI-SUM KEDUANYA!)
        COALESCE(SUM(CASE WHEN source = 'meta' THEN spend ELSE 0 END), 0) AS meta_spend,
        COALESCE(SUM(CASE WHEN source = 'keitaro' THEN spend ELSE 0 END), 0) AS tracker_spend,
        COALESCE(SUM(CASE WHEN source = 'meta' THEN clicks ELSE clicks END), 0) AS ad_clicks,
        COALESCE(SUM(CASE WHEN source = 'meta' THEN impressions ELSE impressions END), 0) AS ad_impressions
    FROM public.daily_stats
    GROUP BY date, site_code, COALESCE(subdomain, '')
),
subdomain_map AS (
    SELECT DISTINCT ON (name) 
        site_code, 
        name, 
        parent_domain, 
        pic 
    FROM public.subdomains 
    ORDER BY name, created_at ASC
),
site_map AS (
    SELECT DISTINCT ON (site_code) 
        site_code, 
        name, 
        parent_domain, 
        pic 
    FROM public.subdomains 
    ORDER BY site_code, created_at ASC
),
calculated_base AS (
    SELECT 
        (sd.date || '_' || sd.site_code || '_' || NULLIF(sd.subdomain, '')) AS id,
        sd.date,
        TO_CHAR(COALESCE(sd.last_updated_at, now()) AT TIME ZONE 'Asia/Jakarta', 'HH24:MI') AS time,
        COALESCE(sd.last_updated_at, now()) AS updated_at,
        sd.site_code,
        COALESCE(NULLIF(sd.subdomain, ''), sm.name, sim.name, sd.site_code) AS site_name,
        COALESCE(NULLIF(sd.subdomain, ''), sm.name, sim.name, sd.site_code) AS sub_domain,
        COALESCE(sd.site_code, '-') AS campaign,
        COALESCE(sm.parent_domain, sim.parent_domain, '-') AS domain,
        COALESCE(sm.pic, sim.pic, '-') AS pic,
        
        -- BELANJA: Utamakan Meta Ads. Jangan pernah menjumlahkan Meta + Keitaro (mencegah 2x lipat)!
        CASE 
            WHEN COALESCE(sp.meta_spend, 0) > 0 THEN sp.meta_spend 
            ELSE COALESCE(sp.tracker_spend, 0) 
        END AS spend_idr,
        
        -- PENDAPATAN: Utamakan GAM/AdSense. Jangan pernah menjumlahkan GAM + Keitaro (mencegah 2x lipat)!
        CASE 
            WHEN COALESCE(rv.gam_revenue, 0) > 0 THEN rv.gam_revenue 
            ELSE COALESCE(rv.tracker_revenue, 0) 
        END AS raw_revenue,
        
        1.0 AS fx_rate,
        'IDR' AS currency_code,
        
        COALESCE(sp.ad_clicks, rv.clicks, 0) AS clicks,
        COALESCE(sp.ad_impressions, rv.impressions, 0) AS impressions
    FROM site_dates sd
    LEFT JOIN subdomain_map sm ON sm.name = sd.subdomain
    LEFT JOIN site_map sim ON sim.site_code = sd.site_code AND sd.subdomain = ''
    LEFT JOIN aggregated_rev rv ON rv.date = sd.date AND rv.site_code = sd.site_code AND rv.subdomain = sd.subdomain
    LEFT JOIN aggregated_spend sp ON sp.date = sd.date AND sp.site_code = sd.site_code AND sp.subdomain = sd.subdomain
)
SELECT 
    b.id,
    b.date,
    b.time,
    b.updated_at,
    b.site_code,
    b.site_name,
    b.sub_domain,
    b.campaign,
    b.domain,
    b.pic,
    
    -- Belanja Iklan Meta (IDR)
    b.spend_idr AS spending,
    b.spend_idr AS meta_spend,
    b.spend_idr AS meta_ads,
    0 AS ad_tax,
    b.spend_idr AS total_spending,
    
    -- Pendapatan (IDR)
    ROUND(b.raw_revenue) AS earning,
    b.raw_revenue AS revenue,
    b.raw_revenue AS gross_revenue,
    b.raw_revenue AS gam_revenue,
    b.raw_revenue AS gam_ads,
    0 AS adsense_ads,
    
    -- Laba & ROI
    (b.raw_revenue - b.spend_idr) AS profit,
    (b.raw_revenue - b.spend_idr) AS net_profit,
    CASE 
        WHEN b.spend_idr > 0 THEN ROUND((((b.raw_revenue - b.spend_idr) / b.spend_idr) * 100)::numeric, 2)
        ELSE 0 
    END AS roi,
    
    -- Metrik Traffic
    b.clicks,
    b.impressions,
    CASE 
        WHEN b.clicks > 0 THEN ROUND((b.spend_idr / b.clicks)::numeric, 2)
        ELSE 0 
    END AS cpc,
    CASE 
        WHEN b.impressions > 0 THEN ROUND(((b.raw_revenue / b.impressions) * 1000)::numeric, 2)
        ELSE 0 
    END AS cpm,
    CASE 
        WHEN b.impressions > 0 THEN ROUND(((b.raw_revenue / b.impressions) * 1000)::numeric, 2)
        ELSE 0 
    END AS page_rpm,
    CASE 
        WHEN b.clicks > 0 THEN ROUND((b.spend_idr / b.clicks)::numeric, 2)
        ELSE 0 
    END AS cpr,
    
    'IDR' AS currency,
    1.0 AS fx_rate,
    'GAM' AS source
FROM calculated_base b;

GRANT SELECT ON public.view_daily_roi TO anon, authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 5. VIEW_DAILY_FINANCIALS UNTUK GRAFIK KEUANGAN HARIAN
-- ------------------------------------------------------------------------------
DROP VIEW IF EXISTS public.view_daily_financials CASCADE;
CREATE OR REPLACE VIEW public.view_daily_financials 
WITH (security_invoker = true) AS
SELECT 
    v.date,
    COALESCE(SUM(v.earning), 0) AS gross_revenue,
    COALESCE(SUM(v.spending), 0) AS total_spend,
    COALESCE(SUM(v.ad_tax), 0) AS ad_tax,
    COALESCE(SUM(v.total_spending), 0) AS total_spending,
    COALESCE(SUM(v.profit), 0) AS net_profit
FROM public.view_daily_roi v
GROUP BY v.date
ORDER BY v.date DESC;

GRANT SELECT ON public.view_daily_financials TO anon, authenticated, service_role;




-- >>> FILE: 20261103000005_fix_earning_column_in_view_daily_roi.sql <<<
-- ==============================================================================
-- MIGRASI CEPAT: TAMBAHKAN KOLOM EARNING PADA VIEW_DAILY_ROI & TOTAL_SPEND PADA VIEW_DAILY_FINANCIALS
-- File: 20261103000005_fix_earning_column_in_view_daily_roi.sql
-- ==============================================================================

DROP VIEW IF EXISTS public.view_daily_financials CASCADE;
DROP VIEW IF EXISTS public.view_daily_roi CASCADE;

DROP VIEW IF EXISTS public.view_daily_financials CASCADE;
DROP VIEW IF EXISTS public.view_daily_roi CASCADE;
CREATE OR REPLACE VIEW public.view_daily_roi 
WITH (security_invoker = true) AS
WITH site_dates AS (
    SELECT 
        date, 
        site_code, 
        COALESCE(subdomain, '') AS subdomain,
        MAX(updated_at) AS last_updated_at
    FROM public.daily_stats
    WHERE COALESCE(subdomain, '') <> '' 
       OR NOT EXISTS (
           SELECT 1 FROM public.daily_stats s2 
           WHERE s2.date = daily_stats.date 
             AND s2.site_code = daily_stats.site_code 
             AND COALESCE(s2.subdomain, '') <> ''
       )
    GROUP BY date, site_code, COALESCE(subdomain, '')
),
aggregated_rev AS (
    SELECT 
        date,
        site_code,
        COALESCE(subdomain, '') AS subdomain,
        -- Utamakan GAM / AdSense, fallback ke Keitaro HANYA jika GAM tidak ada
        COALESCE(SUM(CASE WHEN source IN ('gam', 'adsense') THEN revenue ELSE 0 END), 0) AS gam_revenue,
        COALESCE(SUM(CASE WHEN source = 'keitaro' THEN revenue ELSE 0 END), 0) AS tracker_revenue,
        COALESCE(SUM(impressions), 0) AS impressions,
        COALESCE(SUM(clicks), 0) AS clicks
    FROM public.daily_stats
    GROUP BY date, site_code, COALESCE(subdomain, '')
),
aggregated_spend AS (
    SELECT 
        date,
        site_code,
        COALESCE(subdomain, '') AS subdomain,
        -- Utamakan Meta Ads, fallback ke Keitaro HANYA jika Meta tidak ada (JANGAN DI-SUM KEDUANYA!)
        COALESCE(SUM(CASE WHEN source = 'meta' THEN spend ELSE 0 END), 0) AS meta_spend,
        COALESCE(SUM(CASE WHEN source = 'keitaro' THEN spend ELSE 0 END), 0) AS tracker_spend,
        COALESCE(SUM(CASE WHEN source = 'meta' THEN clicks ELSE clicks END), 0) AS ad_clicks,
        COALESCE(SUM(CASE WHEN source = 'meta' THEN impressions ELSE impressions END), 0) AS ad_impressions
    FROM public.daily_stats
    GROUP BY date, site_code, COALESCE(subdomain, '')
),
subdomain_map AS (
    SELECT DISTINCT ON (name) 
        site_code, 
        name, 
        parent_domain, 
        pic 
    FROM public.subdomains 
    ORDER BY name, created_at ASC
),
site_map AS (
    SELECT DISTINCT ON (site_code) 
        site_code, 
        name, 
        parent_domain, 
        pic 
    FROM public.subdomains 
    ORDER BY site_code, created_at ASC
),
calculated_base AS (
    SELECT 
        (sd.date || '_' || sd.site_code || '_' || NULLIF(sd.subdomain, '')) AS id,
        sd.date,
        TO_CHAR(COALESCE(sd.last_updated_at, now()) AT TIME ZONE 'Asia/Jakarta', 'HH24:MI') AS time,
        COALESCE(sd.last_updated_at, now()) AS updated_at,
        sd.site_code,
        COALESCE(NULLIF(sd.subdomain, ''), sm.name, sim.name, sd.site_code) AS site_name,
        COALESCE(NULLIF(sd.subdomain, ''), sm.name, sim.name, sd.site_code) AS sub_domain,
        COALESCE(sd.site_code, '-') AS campaign,
        COALESCE(sm.parent_domain, sim.parent_domain, '-') AS domain,
        COALESCE(sm.pic, sim.pic, '-') AS pic,
        
        -- BELANJA: Utamakan Meta Ads. Jangan pernah menjumlahkan Meta + Keitaro (mencegah 2x lipat)!
        CASE 
            WHEN COALESCE(sp.meta_spend, 0) > 0 THEN sp.meta_spend 
            ELSE COALESCE(sp.tracker_spend, 0) 
        END AS spend_idr,
        
        -- PENDAPATAN: Utamakan GAM/AdSense. Jangan pernah menjumlahkan GAM + Keitaro (mencegah 2x lipat)!
        CASE 
            WHEN COALESCE(rv.gam_revenue, 0) > 0 THEN rv.gam_revenue 
            ELSE COALESCE(rv.tracker_revenue, 0) 
        END AS raw_revenue,
        
        1.0 AS fx_rate,
        'IDR' AS currency_code,
        
        COALESCE(sp.ad_clicks, rv.clicks, 0) AS clicks,
        COALESCE(sp.ad_impressions, rv.impressions, 0) AS impressions
    FROM site_dates sd
    LEFT JOIN subdomain_map sm ON sm.name = sd.subdomain
    LEFT JOIN site_map sim ON sim.site_code = sd.site_code AND sd.subdomain = ''
    LEFT JOIN aggregated_rev rv ON rv.date = sd.date AND rv.site_code = sd.site_code AND rv.subdomain = sd.subdomain
    LEFT JOIN aggregated_spend sp ON sp.date = sd.date AND sp.site_code = sd.site_code AND sp.subdomain = sd.subdomain
)
SELECT 
    b.id,
    b.date,
    b.time,
    b.updated_at,
    b.site_code,
    b.site_name,
    b.sub_domain,
    b.campaign,
    b.domain,
    b.pic,
    
    -- Belanja Iklan Meta (IDR)
    b.spend_idr AS spending,
    b.spend_idr AS meta_spend,
    b.spend_idr AS meta_ads,
    0 AS ad_tax,
    b.spend_idr AS total_spending,
    
    -- Pendapatan (IDR)
    ROUND(b.raw_revenue) AS earning,
    b.raw_revenue AS revenue,
    b.raw_revenue AS gross_revenue,
    b.raw_revenue AS gam_revenue,
    b.raw_revenue AS gam_ads,
    0 AS adsense_ads,
    
    -- Laba & ROI
    (b.raw_revenue - b.spend_idr) AS profit,
    (b.raw_revenue - b.spend_idr) AS net_profit,
    CASE 
        WHEN b.spend_idr > 0 THEN ROUND((((b.raw_revenue - b.spend_idr) / b.spend_idr) * 100)::numeric, 2)
        ELSE 0 
    END AS roi,
    
    -- Metrik Traffic
    b.clicks,
    b.impressions,
    CASE 
        WHEN b.clicks > 0 THEN ROUND((b.spend_idr / b.clicks)::numeric, 2)
        ELSE 0 
    END AS cpc,
    CASE 
        WHEN b.impressions > 0 THEN ROUND(((b.raw_revenue / b.impressions) * 1000)::numeric, 2)
        ELSE 0 
    END AS cpm,
    CASE 
        WHEN b.impressions > 0 THEN ROUND(((b.raw_revenue / b.impressions) * 1000)::numeric, 2)
        ELSE 0 
    END AS page_rpm,
    CASE 
        WHEN b.clicks > 0 THEN ROUND((b.spend_idr / b.clicks)::numeric, 2)
        ELSE 0 
    END AS cpr,
    
    'IDR' AS currency,
    1.0 AS fx_rate,
    'GAM' AS source
FROM calculated_base b;

GRANT SELECT ON public.view_daily_roi TO anon, authenticated, service_role;

-- ------------------------------------------------------------------------------
-- VIEW_DAILY_FINANCIALS UNTUK GRAFIK KEUANGAN HARIAN
-- ------------------------------------------------------------------------------
DROP VIEW IF EXISTS public.view_daily_financials CASCADE;
CREATE OR REPLACE VIEW public.view_daily_financials 
WITH (security_invoker = true) AS
SELECT 
    v.date,
    COALESCE(SUM(v.earning), 0) AS gross_revenue,
    COALESCE(SUM(v.spending), 0) AS total_spend,
    COALESCE(SUM(v.ad_tax), 0) AS ad_tax,
    COALESCE(SUM(v.total_spending), 0) AS total_spending,
    COALESCE(SUM(v.profit), 0) AS net_profit
FROM public.view_daily_roi v
GROUP BY v.date
ORDER BY v.date DESC;

GRANT SELECT ON public.view_daily_financials TO anon, authenticated, service_role;




-- >>> FILE: 20261104000001_fix_gam_accounts_rls_and_google_credential.sql <<<
-- ==============================================================================
-- Migrasi: Perbaikan RLS gam_accounts, domains, subdomains & Kolom google_credential
-- Versi: 20261104000001_fix_gam_accounts_rls_and_google_credential.sql
-- ==============================================================================

-- 1. Tambahkan kolom google_credential jika belum ada
ALTER TABLE public.gam_accounts ADD COLUMN IF NOT EXISTS google_credential TEXT;

-- 2. Pastikan RLS tetap aktif namun memiliki policy eksplisit untuk operasi CRUD pada gam_accounts
ALTER TABLE public.gam_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gam_accounts_select_all" ON public.gam_accounts;
DROP POLICY IF EXISTS "gam_accounts_admin_all" ON public.gam_accounts;
DROP POLICY IF EXISTS "gam_accounts_manage_all" ON public.gam_accounts;
DROP POLICY IF EXISTS "gam_accounts_all_auth" ON public.gam_accounts;

CREATE POLICY "gam_accounts_select_all" ON public.gam_accounts
    FOR SELECT TO public USING (true);

CREATE POLICY "gam_accounts_manage_all" ON public.gam_accounts
    FOR ALL TO public USING (true) WITH CHECK (true);

-- 3. Selaraskan RLS pada domains & subdomains agar penambahan dari dashboard selalu lancar
ALTER TABLE public.domains ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "domains_select_all" ON public.domains;
DROP POLICY IF EXISTS "domains_manage_all" ON public.domains;
CREATE POLICY "domains_select_all" ON public.domains
    FOR SELECT TO public USING (true);
CREATE POLICY "domains_manage_all" ON public.domains
    FOR ALL TO public USING (true) WITH CHECK (true);

ALTER TABLE public.subdomains ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "subdomains_select_all" ON public.subdomains;
DROP POLICY IF EXISTS "subdomains_manage_all" ON public.subdomains;
CREATE POLICY "subdomains_select_all" ON public.subdomains
    FOR SELECT TO public USING (true);
CREATE POLICY "subdomains_manage_all" ON public.subdomains
    FOR ALL TO public USING (true) WITH CHECK (true);



-- >>> FILE: 20261104000002_normalize_roi_snapshots_hourly_time.sql <<<
-- ==============================================================================
-- MIGRASI 25: NORMALISASI WAKTU SNAPSHOT KE JAM GENAP (HH:00)
-- File: 20261104000002_normalize_roi_snapshots_hourly_time.sql
-- Keterangan: Mengubah format waktu snapshot menjadi jam pas (:00) dari 00:00 s/d 23:00
--             agar riwayat Laporan ROI Realtime urut dan konsisten jam demi jam.
-- ==============================================================================

UPDATE public.roi_snapshots
SET time = SUBSTRING(time FROM 1 FOR 2) || ':00'
WHERE time ~ '^[0-2][0-9]:[0-9]{2}$'
  AND time NOT LIKE '%:00';




-- >>> FILE: 20261105000001_sync_renamed_advertisers_and_trigger.sql <<<
-- ==============================================================================
-- Migrasi: Sinkronkan Pergantian Nama Advertiser & Buat Trigger Otomatis
-- ==============================================================================

-- 1. Sinkronkan data saat ini
UPDATE subdomains SET pic = 'Austin' WHERE pic = 'Ade Suparman';
UPDATE subdomains SET pic = 'Moskov' WHERE pic = 'Mulyana';
UPDATE subdomains SET pic = 'Sullivan' WHERE pic = 'Zulfan';
UPDATE subdomains SET pic = 'New York City' WHERE pic = 'Nurjaman';
UPDATE subdomains SET pic = 'Crissthoper' WHERE pic = 'Cris';

UPDATE bonus_percents SET user_name = 'Austin', "user" = 'Austin' WHERE user_name = 'Ade Suparman' OR "user" = 'Ade Suparman';
UPDATE bonus_percents SET user_name = 'Moskov', "user" = 'Moskov' WHERE user_name = 'Mulyana' OR "user" = 'Mulyana';
UPDATE bonus_percents SET user_name = 'Sullivan', "user" = 'Sullivan' WHERE user_name = 'Zulfan' OR "user" = 'Zulfan';
UPDATE bonus_percents SET user_name = 'New York City', "user" = 'New York City' WHERE user_name = 'Nurjaman' OR "user" = 'Nurjaman';
UPDATE bonus_percents SET user_name = 'Crissthoper', "user" = 'Crissthoper' WHERE user_name = 'Cris' OR "user" = 'Cris';

UPDATE ad_accounts 
SET user_owner = REPLACE(
  REPLACE(
    REPLACE(
      REPLACE(
        REPLACE(user_owner, 'Ade Suparman', 'Austin'),
        'Cris', 'Crissthoper'
      ),
      'Zulfan', 'Sullivan'
    ),
    'Mulyana', 'Moskov'
  ),
  'Nurjaman', 'New York City'
)
WHERE user_owner IS NOT NULL;

-- 2. Buat fungsi trigger untuk cascade update nama PIC otomatis di masa mendatang
CREATE OR REPLACE FUNCTION handle_profile_name_change()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name AND OLD.name IS NOT NULL AND NEW.name IS NOT NULL THEN
    -- Update PIC di tabel subdomains
    UPDATE subdomains
    SET pic = NEW.name
    WHERE pic = OLD.name;

    -- Update nama di tabel bonus_percents
    UPDATE bonus_percents
    SET user_name = NEW.name, "user" = NEW.name
    WHERE user_name = OLD.name OR "user" = OLD.name;

    -- Update nama di ad_accounts.user_owner
    UPDATE ad_accounts
    SET user_owner = REPLACE(user_owner, OLD.name, NEW.name)
    WHERE user_owner LIKE '%' || OLD.name || '%';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Pasang trigger ke tabel profiles
DROP TRIGGER IF EXISTS tr_profile_name_change ON profiles;
CREATE TRIGGER tr_profile_name_change
AFTER UPDATE OF name ON profiles
FOR EACH ROW
EXECUTE FUNCTION handle_profile_name_change();




-- >>> FILE: 20261107000001_allow_overview_and_emran_read_whitelist_topup.sql <<<
-- ==============================================================================
-- Migrasi: Izinkan seluruh user terautentikasi membaca data whitelist_topup
-- Supaya angka Total TopUp (TU) dan ROI Founder tampil sama persis dengan Superadmin.
-- Hak tulis (INSERT, UPDATE, DELETE) tetap dibatasi HANYA Keuangan & Admin.
-- ==============================================================================

BEGIN;

-- 1. Helper function untuk memeriksa apakah user saat ini adalah role overview atau akun Emran
CREATE OR REPLACE FUNCTION public.is_overview()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.profiles 
        WHERE id = auth.uid() 
        AND (
            role LIKE '%overview%' 
            OR email ILIKE '%emraankhattak%' 
            OR email ILIKE '%emran%' 
            OR username ILIKE '%emran%'
        )
    );
$$;

-- 2. Perbarui policy SELECT pada public.whitelist_topup (izinkan semua authenticated user membaca data topup)
DROP POLICY IF EXISTS "whitelist_topup_select" ON public.whitelist_topup;
DROP POLICY IF EXISTS "whitelist_keuangan_all" ON public.whitelist_topup;

CREATE POLICY "whitelist_topup_select" ON public.whitelist_topup
    FOR SELECT TO authenticated
    USING (true);

-- 3. Pastikan hak tulis (INSERT, UPDATE, DELETE) tetap eksklusif Keuangan & Admin
DROP POLICY IF EXISTS "whitelist_topup_insert" ON public.whitelist_topup;
CREATE POLICY "whitelist_topup_insert" ON public.whitelist_topup
    FOR INSERT TO authenticated
    WITH CHECK (public.is_keuangan() OR public.is_admin());

DROP POLICY IF EXISTS "whitelist_topup_update" ON public.whitelist_topup;
CREATE POLICY "whitelist_topup_update" ON public.whitelist_topup
    FOR UPDATE TO authenticated
    USING (public.is_keuangan() OR public.is_admin())
    WITH CHECK (public.is_keuangan() OR public.is_admin());

DROP POLICY IF EXISTS "whitelist_topup_delete" ON public.whitelist_topup;
CREATE POLICY "whitelist_topup_delete" ON public.whitelist_topup
    FOR DELETE TO authenticated
    USING (public.is_keuangan() OR public.is_admin());

-- 4. Pastikan user Emran memiliki role 'overview' pada profiles
UPDATE public.profiles
SET role = 'overview'
WHERE email ILIKE '%emraankhattak%' OR username ILIKE '%emran%';

COMMIT;



-- >>> FILE: 20261107000001_tambah_kolom_zona_waktu_gam_accounts.sql <<<
-- ==============================================================================
-- Migrasi: Penambahan Kolom Zona Waktu dan Waktu Terakhir Sinkronisasi pada Akun GAM
-- ==============================================================================

ALTER TABLE public.gam_accounts ADD COLUMN IF NOT EXISTS report_time_zone TEXT;
ALTER TABLE public.gam_accounts ADD COLUMN IF NOT EXISTS last_sync_time TEXT;

-- Perbarui zona waktu resmi masing-masing network Google Ad Manager sesuai setelan akun
UPDATE public.gam_accounts SET report_time_zone = 'GMT+1' WHERE name ILIKE '%cmhhealths%' OR network_code = '23350466753';
UPDATE public.gam_accounts SET report_time_zone = 'GMT+6' WHERE name ILIKE '%trayedit%' OR network_code = '23344333667';
UPDATE public.gam_accounts SET report_time_zone = 'GMT+5' WHERE name ILIKE '%tiktokmod%' OR network_code = '23367555867';
UPDATE public.gam_accounts SET report_time_zone = 'GMT+5' WHERE name ILIKE '%tacobell%' OR network_code = '23380486168';
UPDATE public.gam_accounts SET report_time_zone = 'GMT-3' WHERE name ILIKE '%ihop%' OR network_code = '23340206616';
UPDATE public.gam_accounts SET report_time_zone = 'GMT+6' WHERE name ILIKE '%uniqueinfo%' OR network_code = '23342288590';



-- >>> FILE: 20261108000001_clean_anomalous_october_meta_spend.sql <<<
-- ==============================================================================
-- MIGRASI: PEMBERSIHAN DATA ANOMALI SPEND META & SUBDOMAIN NOVEMBER DI OKTOBER 2026
-- File: 20261108000001_clean_anomalous_october_meta_spend.sql
--
-- Masalah yang Diselesaikan:
-- 1. Pada tanggal 8 & 9 Oktober 2026, terdapat baris `source = 'meta'` di tabel
--    `daily_stats` dengan total spend Rp 37.029.128 yang terbentuk akibat tarikan
--    agregasi multi-hari Meta yang jatuh ke tanggal start.
-- 2. Hal ini menyebabkan total spending bulan Oktober di Cash Flow & Laba Rugi
--    melonjak 2x lipat menjadi Rp 76.199.030 (aslinya Rp 39.169.902).
-- 3. Domain dan subdomain yang baru berjalan di bulan November (cmhhealths.com
--    dan uniqueinfo24.com) ikut terbawa ke bulan Oktober.
-- ==============================================================================

BEGIN;

-- 1. Hapus baris anomali spend Meta pada tanggal 8 dan 9 Oktober 2026
DELETE FROM public.daily_stats
WHERE source = 'meta'
  AND date IN ('2026-10-08', '2026-10-09');

-- 2. Hapus seluruh baris domain/subdomain November (cmhhealths & uniqueinfo24) di bulan Oktober
DELETE FROM public.daily_stats
WHERE date < '2026-11-01'
  AND (
      site_code ILIKE '%cmh%' 
      OR site_code ILIKE '%unique%'
      OR subdomain ILIKE '%cmhhealths%'
      OR subdomain ILIKE '%uniqueinfo24%'
  );

-- 3. Hapus breakdown negara country_roi untuk domain November di bulan Oktober
DELETE FROM public.country_roi
WHERE date < '2026-11-01'
  AND (
      sub_domain ILIKE '%cmhhealths%'
      OR sub_domain ILIKE '%uniqueinfo24%'
  );

COMMIT;



-- >>> FILE: 20261108000002_fix_ad_tax_in_view_daily_roi.sql <<<
-- ==============================================================================
-- MIGRASI: PERBAIKI KALKULASI AD TAX (5%) PADA VIEW_DAILY_ROI & VIEW_DAILY_FINANCIALS
-- File: 20261108000002_fix_ad_tax_in_view_daily_roi.sql
-- Keterangan: Sebelumnya ad_tax di-hardcode 0, sehingga kolom Ad Tax di Laporan ROI
--             bernilai Rp 0 dan Total Spend tidak mencakup pajak iklan 5%.
-- ==============================================================================

DROP VIEW IF EXISTS public.view_daily_financials CASCADE;
DROP VIEW IF EXISTS public.view_daily_roi CASCADE;

DROP VIEW IF EXISTS public.view_daily_financials CASCADE;
DROP VIEW IF EXISTS public.view_daily_roi CASCADE;
CREATE OR REPLACE VIEW public.view_daily_roi 
WITH (security_invoker = true) AS
WITH site_dates AS (
    SELECT 
        date, 
        site_code, 
        COALESCE(subdomain, '') AS subdomain,
        MAX(updated_at) AS last_updated_at
    FROM public.daily_stats 
    WHERE COALESCE(subdomain, '') <> '' 
       OR NOT EXISTS (
           SELECT 1 FROM public.daily_stats s2 
           WHERE s2.date = daily_stats.date 
             AND s2.site_code = daily_stats.site_code 
             AND COALESCE(s2.subdomain, '') <> ''
       )
    GROUP BY date, site_code, COALESCE(subdomain, '')
),
aggregated_rev AS (
    SELECT 
        date,
        site_code,
        COALESCE(subdomain, '') AS subdomain,
        -- Utamakan GAM / AdSense, fallback ke Keitaro HANYA jika GAM tidak ada
        COALESCE(SUM(CASE WHEN source IN ('gam', 'adsense') THEN revenue ELSE 0 END), 0) AS gam_revenue,
        COALESCE(SUM(CASE WHEN source = 'keitaro' THEN revenue ELSE 0 END), 0) AS tracker_revenue,
        COALESCE(SUM(impressions), 0) AS impressions,
        COALESCE(SUM(clicks), 0) AS clicks
    FROM public.daily_stats
    GROUP BY date, site_code, COALESCE(subdomain, '')
),
aggregated_spend AS (
    SELECT 
        date,
        site_code,
        COALESCE(subdomain, '') AS subdomain,
        -- Utamakan Meta Ads, fallback ke Keitaro HANYA jika Meta tidak ada (JANGAN DI-SUM KEDUANYA!)
        COALESCE(SUM(CASE WHEN source = 'meta' THEN spend ELSE 0 END), 0) AS meta_spend,
        COALESCE(SUM(CASE WHEN source = 'keitaro' THEN spend ELSE 0 END), 0) AS tracker_spend,
        COALESCE(SUM(CASE WHEN source = 'meta' THEN clicks ELSE clicks END), 0) AS ad_clicks,
        COALESCE(SUM(CASE WHEN source = 'meta' THEN impressions ELSE impressions END), 0) AS ad_impressions
    FROM public.daily_stats
    GROUP BY date, site_code, COALESCE(subdomain, '')
),
subdomain_map AS (
    SELECT DISTINCT ON (name) 
        site_code, 
        name, 
        parent_domain, 
        pic 
    FROM public.subdomains 
    ORDER BY name, created_at ASC
),
site_map AS (
    SELECT DISTINCT ON (site_code) 
        site_code, 
        name, 
        parent_domain, 
        pic 
    FROM public.subdomains 
    ORDER BY site_code, created_at ASC
),
calculated_base AS (
    SELECT 
        (sd.date || '_' || sd.site_code || '_' || NULLIF(sd.subdomain, '')) AS id,
        sd.date,
        TO_CHAR(COALESCE(sd.last_updated_at, now()) AT TIME ZONE 'Asia/Jakarta', 'HH24:MI') AS time,
        COALESCE(sd.last_updated_at, now()) AS updated_at,
        sd.site_code,
        COALESCE(NULLIF(sd.subdomain, ''), sm.name, sim.name, sd.site_code) AS site_name,
        COALESCE(NULLIF(sd.subdomain, ''), sm.name, sim.name, sd.site_code) AS sub_domain,
        COALESCE(sd.site_code, '-') AS campaign,
        COALESCE(sm.parent_domain, sim.parent_domain, '-') AS domain,
        COALESCE(sm.pic, sim.pic, '-') AS pic,
        
        -- BELANJA: Utamakan Meta Ads. Jangan pernah menjumlahkan Meta + Keitaro (mencegah 2x lipat)!
        CASE 
            WHEN COALESCE(sp.meta_spend, 0) > 0 THEN sp.meta_spend 
            ELSE COALESCE(sp.tracker_spend, 0) 
        END AS spend_idr,
        
        -- PENDAPATAN: Utamakan GAM/AdSense. Jangan pernah menjumlahkan GAM + Keitaro (mencegah 2x lipat)!
        CASE 
            WHEN COALESCE(rv.gam_revenue, 0) > 0 THEN rv.gam_revenue 
            ELSE COALESCE(rv.tracker_revenue, 0) 
        END AS raw_revenue,
        
        1.0 AS fx_rate,
        'IDR' AS currency_code,
        
        COALESCE(sp.ad_clicks, rv.clicks, 0) AS clicks,
        COALESCE(sp.ad_impressions, rv.impressions, 0) AS impressions
    FROM site_dates sd
    LEFT JOIN subdomain_map sm ON sm.name = sd.subdomain
    LEFT JOIN site_map sim ON sim.site_code = sd.site_code AND sd.subdomain = ''
    LEFT JOIN aggregated_rev rv ON rv.date = sd.date AND rv.site_code = sd.site_code AND rv.subdomain = sd.subdomain
    LEFT JOIN aggregated_spend sp ON sp.date = sd.date AND sp.site_code = sd.site_code AND sp.subdomain = sd.subdomain
)
SELECT 
    b.id,
    b.date,
    b.time,
    b.updated_at,
    b.site_code,
    b.site_name,
    b.sub_domain,
    b.campaign,
    b.domain,
    b.pic,
    
    -- Belanja Iklan Meta (IDR) & Pajak Iklan 5%
    b.spend_idr AS spending,
    b.spend_idr AS meta_spend,
    b.spend_idr AS meta_ads,
    ROUND(b.spend_idr * 0.05) AS ad_tax,
    (b.spend_idr + ROUND(b.spend_idr * 0.05)) AS total_spending,
    (b.spend_idr + ROUND(b.spend_idr * 0.05)) AS total_spend,
    
    -- Pendapatan (IDR)
    ROUND(b.raw_revenue) AS earning,
    b.raw_revenue AS revenue,
    b.raw_revenue AS gross_revenue,
    b.raw_revenue AS gam_revenue,
    b.raw_revenue AS gam_ads,
    0 AS adsense_ads,
    
    -- Laba & ROI (dihitung bersih setelah Total Spending = Belanja + Pajak Iklan)
    (b.raw_revenue - (b.spend_idr + ROUND(b.spend_idr * 0.05))) AS profit,
    (b.raw_revenue - (b.spend_idr + ROUND(b.spend_idr * 0.05))) AS net_profit,
    CASE 
        WHEN (b.spend_idr + ROUND(b.spend_idr * 0.05)) > 0 
        THEN ROUND((((b.raw_revenue - (b.spend_idr + ROUND(b.spend_idr * 0.05))) / (b.spend_idr + ROUND(b.spend_idr * 0.05))) * 100)::numeric, 2)
        ELSE 0 
    END AS roi,
    
    -- Metrik Traffic
    b.clicks,
    b.impressions,
    CASE 
        WHEN b.clicks > 0 THEN ROUND((b.spend_idr / b.clicks)::numeric, 2)
        ELSE 0 
    END AS cpc,
    CASE 
        WHEN b.impressions > 0 THEN ROUND(((b.raw_revenue / b.impressions) * 1000)::numeric, 2)
        ELSE 0 
    END AS cpm,
    CASE 
        WHEN b.impressions > 0 THEN ROUND(((b.raw_revenue / b.impressions) * 1000)::numeric, 2)
        ELSE 0 
    END AS page_rpm,
    CASE 
        WHEN b.clicks > 0 THEN ROUND((b.spend_idr / b.clicks)::numeric, 2)
        ELSE 0 
    END AS cpr,
    
    'IDR' AS currency,
    1.0 AS fx_rate,
    'GAM' AS source
FROM calculated_base b;

GRANT SELECT ON public.view_daily_roi TO anon, authenticated, service_role;

-- ------------------------------------------------------------------------------
-- VIEW_DAILY_FINANCIALS UNTUK GRAFIK KEUANGAN HARIAN
-- ------------------------------------------------------------------------------
DROP VIEW IF EXISTS public.view_daily_financials CASCADE;
CREATE OR REPLACE VIEW public.view_daily_financials 
WITH (security_invoker = true) AS
SELECT 
    v.date,
    COALESCE(SUM(v.earning), 0) AS gross_revenue,
    COALESCE(SUM(v.spending), 0) AS total_spend,
    COALESCE(SUM(v.ad_tax), 0) AS ad_tax,
    COALESCE(SUM(v.total_spending), 0) AS total_spending,
    COALESCE(SUM(v.profit), 0) AS net_profit
FROM public.view_daily_roi v
GROUP BY v.date
ORDER BY v.date DESC;

GRANT SELECT ON public.view_daily_financials TO anon, authenticated, service_role;




-- >>> FILE: 20261109000001_separate_gam_and_meta_metrics_in_view_daily_roi.sql <<<
-- ==============================================================================
-- MIGRASI: PEMISAHAN METRIK GAM (CTR, CPC, eCPM) & META ADS (CLICKS, CPR) PADA VIEW_DAILY_ROI
-- File: 20261109000001_separate_gam_and_meta_metrics_in_view_daily_roi.sql
-- Keterangan:
-- 1. META ADS: Clicks adalah kolom hasil Meta Ads (meta_clicks), CPR adalah Biaya Per Hasil (Total Spend / Meta Clicks).
-- 2. GAM: CPC adalah Pendapatan per klik GAM (gam_revenue / gam_clicks), eCPM/RPM adalah (gam_revenue / gam_impressions * 1000).
-- 3. Menambahkan kolom CTR yang ditarik dari GAM ((gam_clicks / gam_impressions) * 100).
-- ==============================================================================

-- 1. Tambahkan kolom metrik eksplisit pada tabel roi_snapshots
ALTER TABLE public.roi_snapshots 
ADD COLUMN IF NOT EXISTS ctr NUMERIC(8, 2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS meta_clicks INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS gam_clicks INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS gam_impressions INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS cpr NUMERIC(10, 2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS ecpm NUMERIC(10, 2) DEFAULT 0;

-- 2. Update view_daily_roi
DROP VIEW IF EXISTS public.view_daily_financials CASCADE;
DROP VIEW IF EXISTS public.view_daily_roi CASCADE;

DROP VIEW IF EXISTS public.view_daily_financials CASCADE;
DROP VIEW IF EXISTS public.view_daily_roi CASCADE;
CREATE OR REPLACE VIEW public.view_daily_roi 
WITH (security_invoker = true) AS
WITH site_dates AS (
    SELECT 
        date, 
        site_code, 
        COALESCE(subdomain, '') AS subdomain,
        MAX(updated_at) AS last_updated_at
    FROM public.daily_stats 
    WHERE COALESCE(subdomain, '') <> '' 
       OR NOT EXISTS (
           SELECT 1 FROM public.daily_stats s2 
           WHERE s2.date = daily_stats.date 
             AND s2.site_code = daily_stats.site_code 
             AND COALESCE(s2.subdomain, '') <> ''
       )
    GROUP BY date, site_code, COALESCE(subdomain, '')
),
aggregated_rev AS (
    SELECT 
        date,
        site_code,
        COALESCE(subdomain, '') AS subdomain,
        -- Pendapatan GAM
        COALESCE(SUM(CASE WHEN source IN ('gam', 'adsense') THEN revenue ELSE 0 END), 0) AS gam_revenue,
        COALESCE(SUM(CASE WHEN source = 'keitaro' THEN revenue ELSE 0 END), 0) AS tracker_revenue,
        -- Hanya hitung impresi & klik dari sumber GAM/AdSense agar tidak tercampur klik Meta/Keitaro
        COALESCE(SUM(CASE WHEN source IN ('gam', 'adsense') THEN impressions ELSE 0 END), 0) AS gam_impressions,
        COALESCE(SUM(CASE WHEN source IN ('gam', 'adsense') THEN clicks ELSE 0 END), 0) AS gam_clicks
    FROM public.daily_stats
    GROUP BY date, site_code, COALESCE(subdomain, '')
),
aggregated_spend AS (
    SELECT 
        date,
        site_code,
        COALESCE(subdomain, '') AS subdomain,
        -- Belanja Meta Ads
        COALESCE(SUM(CASE WHEN source = 'meta' THEN spend ELSE 0 END), 0) AS meta_spend,
        COALESCE(SUM(CASE WHEN source = 'keitaro' THEN spend ELSE 0 END), 0) AS tracker_spend,
        -- Hasil klik / actions dari Meta Ads
        COALESCE(SUM(CASE WHEN source = 'meta' THEN clicks ELSE 0 END), 0) AS meta_clicks,
        COALESCE(SUM(CASE WHEN source = 'meta' THEN impressions ELSE 0 END), 0) AS meta_impressions
    FROM public.daily_stats
    GROUP BY date, site_code, COALESCE(subdomain, '')
),
subdomain_map AS (
    SELECT DISTINCT ON (name) 
        site_code, 
        name, 
        parent_domain, 
        pic 
    FROM public.subdomains 
    ORDER BY name, created_at ASC
),
site_map AS (
    SELECT DISTINCT ON (site_code) 
        site_code, 
        name, 
        parent_domain, 
        pic 
    FROM public.subdomains 
    ORDER BY site_code, created_at ASC
),
calculated_base AS (
    SELECT 
        (sd.date || '_' || sd.site_code || '_' || NULLIF(sd.subdomain, '')) AS id,
        sd.date,
        TO_CHAR(COALESCE(sd.last_updated_at, now()) AT TIME ZONE 'Asia/Jakarta', 'HH24:MI') AS time,
        COALESCE(sd.last_updated_at, now()) AS updated_at,
        sd.site_code,
        COALESCE(NULLIF(sd.subdomain, ''), sm.name, sim.name, sd.site_code) AS site_name,
        COALESCE(NULLIF(sd.subdomain, ''), sm.name, sim.name, sd.site_code) AS sub_domain,
        COALESCE(sd.site_code, '-') AS campaign,
        COALESCE(sm.parent_domain, sim.parent_domain, '-') AS domain,
        COALESCE(sm.pic, sim.pic, '-') AS pic,
        
        -- BELANJA: Utamakan Meta Ads
        CASE 
            WHEN COALESCE(sp.meta_spend, 0) > 0 THEN sp.meta_spend 
            ELSE COALESCE(sp.tracker_spend, 0) 
        END AS spend_idr,
        
        -- PENDAPATAN: Utamakan GAM/AdSense
        CASE 
            WHEN COALESCE(rv.gam_revenue, 0) > 0 THEN rv.gam_revenue 
            ELSE COALESCE(rv.tracker_revenue, 0) 
        END AS raw_revenue,
        
        1.0 AS fx_rate,
        'IDR' AS currency_code,
        
        -- Metrik Meta Ads:
        COALESCE(sp.meta_clicks, 0) AS meta_clicks,
        COALESCE(sp.meta_impressions, 0) AS meta_impressions,
        
        -- Metrik GAM:
        COALESCE(rv.gam_clicks, 0) AS gam_clicks,
        COALESCE(rv.gam_impressions, 0) AS gam_impressions
    FROM site_dates sd
    LEFT JOIN subdomain_map sm ON sm.name = sd.subdomain
    LEFT JOIN site_map sim ON sim.site_code = sd.site_code AND sd.subdomain = ''
    LEFT JOIN aggregated_rev rv ON rv.date = sd.date AND rv.site_code = sd.site_code AND rv.subdomain = sd.subdomain
    LEFT JOIN aggregated_spend sp ON sp.date = sd.date AND sp.site_code = sd.site_code AND sp.subdomain = sd.subdomain
)
SELECT 
    b.id,
    b.date,
    b.time,
    b.updated_at,
    b.site_code,
    b.site_name,
    b.sub_domain,
    b.campaign,
    b.domain,
    b.pic,
    
    -- Belanja Iklan Meta (IDR) & Pajak Iklan 5%
    b.spend_idr AS spending,
    b.spend_idr AS meta_spend,
    b.spend_idr AS meta_ads,
    ROUND(b.spend_idr * 0.05) AS ad_tax,
    (b.spend_idr + ROUND(b.spend_idr * 0.05)) AS total_spending,
    (b.spend_idr + ROUND(b.spend_idr * 0.05)) AS total_spend,
    
    -- Pendapatan (IDR)
    ROUND(b.raw_revenue) AS earning,
    b.raw_revenue AS revenue,
    b.raw_revenue AS gross_revenue,
    b.raw_revenue AS gam_revenue,
    b.raw_revenue AS gam_ads,
    0 AS adsense_ads,
    
    -- Laba & ROI (dihitung bersih setelah Total Spending = Belanja + Pajak Iklan)
    (b.raw_revenue - (b.spend_idr + ROUND(b.spend_idr * 0.05))) AS profit,
    (b.raw_revenue - (b.spend_idr + ROUND(b.spend_idr * 0.05))) AS net_profit,
    CASE 
        WHEN (b.spend_idr + ROUND(b.spend_idr * 0.05)) > 0 
        THEN ROUND((((b.raw_revenue - (b.spend_idr + ROUND(b.spend_idr * 0.05))) / (b.spend_idr + ROUND(b.spend_idr * 0.05))) * 100)::numeric, 2)
        ELSE 0 
    END AS roi,
    
    -- Metrik GAM (Google Ad Manager)
    b.gam_clicks,
    b.gam_impressions AS impressions,
    b.gam_impressions,
    CASE 
        WHEN b.gam_impressions > 0 
        THEN ROUND(((b.gam_clicks::numeric / b.gam_impressions::numeric) * 100), 2)
        ELSE 0 
    END AS ctr,
    CASE 
        WHEN b.gam_clicks > 0 
        THEN ROUND((b.raw_revenue / b.gam_clicks)::numeric, 2)
        ELSE 0 
    END AS cpc,
    CASE 
        WHEN b.gam_impressions > 0 
        THEN ROUND(((b.raw_revenue / b.gam_impressions) * 1000)::numeric, 2)
        ELSE 0 
    END AS page_rpm,
    CASE 
        WHEN b.gam_impressions > 0 
        THEN ROUND(((b.raw_revenue / b.gam_impressions) * 1000)::numeric, 2)
        ELSE 0 
    END AS ecpm,
    
    -- Metrik Meta Ads (Clicks = Kolom hasil Meta Ads, CPR = Biaya per hasil)
    b.meta_clicks AS clicks,
    b.meta_clicks,
    CASE 
        WHEN b.meta_clicks > 0 
        THEN ROUND(((b.spend_idr + ROUND(b.spend_idr * 0.05)) / b.meta_clicks)::numeric, 2)
        ELSE 0 
    END AS cpr,
    
    'IDR' AS currency,
    1.0 AS fx_rate,
    'GAM' AS source
FROM calculated_base b;

GRANT SELECT ON public.view_daily_roi TO anon, authenticated, service_role;

-- ------------------------------------------------------------------------------
-- VIEW_DAILY_FINANCIALS UNTUK GRAFIK KEUANGAN HARIAN
-- ------------------------------------------------------------------------------
DROP VIEW IF EXISTS public.view_daily_financials CASCADE;
CREATE OR REPLACE VIEW public.view_daily_financials 
WITH (security_invoker = true) AS
SELECT 
    v.date,
    COALESCE(SUM(v.earning), 0) AS gross_revenue,
    COALESCE(SUM(v.earning), 0) AS revenue,
    COALESCE(SUM(v.spending), 0) AS ad_spend,
    COALESCE(SUM(v.spending), 0) AS meta_spend,
    COALESCE(SUM(v.ad_tax), 0) AS ad_tax,
    COALESCE(SUM(v.total_spending), 0) AS total_spending,
    COALESCE(SUM(v.profit), 0) AS net_revenue,
    COALESCE(SUM(v.profit), 0) AS profit,
    CASE 
        WHEN COALESCE(SUM(v.total_spending), 0) > 0 
        THEN ROUND((((COALESCE(SUM(v.earning), 0) - COALESCE(SUM(v.total_spending), 0)) / COALESCE(SUM(v.total_spending), 0)) * 100)::numeric, 2)
        ELSE 0 
    END AS roi,
    COALESCE(SUM(v.clicks), 0) AS clicks,
    COALESCE(SUM(v.impressions), 0) AS impressions,
    'IDR' AS currency,
    1.0 AS fx_rate
FROM public.view_daily_roi v
GROUP BY v.date;

GRANT SELECT ON public.view_daily_financials TO anon, authenticated, service_role;




-- >>> FILE: 20261111000001_clean_anomalous_october_news_and_taco_fries.sql <<<
-- ==============================================================================
-- MIGRASI: PEMBERSIHAN DATA ANOMALI SPEND META OKTOBER 2026
-- File: 20261111000001_clean_anomalous_october_news_and_taco_fries.sql
--
-- Masalah yang Diselesaikan:
-- 1. Subdomain news.ihopmenuwithprices.us baru berjalan di bulan November 2026.
--    Namun pada backfill Oktober, campaign IHOP lama salah terpetakan dan mencatat
--    spend Meta sebesar Rp 7.846.633 (+ Tax 5% = Rp 8.238.965) di tanggal 20-26 Okt.
-- 2. Subdomain fries.tacobellmenuu.us menduplikasi spend Meta dari burrito.tacobellmenuu.us
--    sebesar Rp 307.109 (+ Tax 5% = Rp 322.464) di tanggal 10, 12, 13, 14 Okt.
--
-- Hasil:
-- Total spending + TAX Oktober 2026 kembali akurat mendekati target Rp 32.550.000.
-- ==============================================================================

BEGIN;

-- 1. Hapus anomali spend Meta news.ihopmenuwithprices.us di Oktober 2026
DELETE FROM public.daily_stats
WHERE subdomain = 'news.ihopmenuwithprices.us'
  AND source = 'meta'
  AND date >= '2026-10-01'
  AND date <= '2026-10-31';

-- 2. Hapus duplikasi spend Meta fries.tacobellmenuu.us di Oktober 2026
DELETE FROM public.daily_stats
WHERE subdomain = 'fries.tacobellmenuu.us'
  AND source = 'meta'
  AND date >= '2026-10-01'
  AND date <= '2026-10-31';

COMMIT;




-- >>> FILE: 20261111000002_create_rpc_get_subdomain_today_ctr.sql <<<
-- ==============================================================================
-- MIGRASI: RPC GET_SUBDOMAIN_TODAY_CTR UNTUK AUTO SAFE CTR GOVERNOR
-- File: 20261111000002_create_rpc_get_subdomain_today_ctr.sql
--
-- Tujuan:
-- Menyediakan endpoint read-only yang sangat aman untuk plugin WordPress TigerROI
-- agar bisa membaca CTR Google Ad Manager (GAM) hari ini per subdomain.
-- Fungsi ini HANYA mengembalikan impressions, clicks, dan ctr_percent (TIDAK membuka
-- data finansial seperti revenue, spend, atau profit ke publik/anon).
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.get_subdomain_today_ctr(target_subdomain text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    today_date date;
    tot_imp bigint := 0;
    tot_clk bigint := 0;
    ctr_val numeric := 0;
BEGIN
    -- Tanggal hari ini zona waktu Jakarta (WIB / UTC+7)
    today_date := (now() AT TIME ZONE 'Asia/Jakarta')::date;

    SELECT COALESCE(SUM(impressions), 0), COALESCE(SUM(clicks), 0)
    INTO tot_imp, tot_clk
    FROM public.daily_stats
    WHERE subdomain = target_subdomain
      AND source = 'gam'
      AND date = today_date;

    IF tot_imp > 0 THEN
        ctr_val := ROUND((tot_clk::numeric / tot_imp::numeric) * 100, 2);
    ELSE
        ctr_val := 0;
    END IF;

    RETURN jsonb_build_object(
        'subdomain', target_subdomain,
        'date', today_date,
        'impressions', tot_imp,
        'clicks', tot_clk,
        'ctr_percent', ctr_val
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_subdomain_today_ctr(text) TO anon, authenticated;




-- >>> FILE: 20261111000003_add_ctr_governor_to_subdomains.sql <<<
-- ==============================================================================
-- MIGRASI: PENAMBAHAN KOLOM CTR GOVERNOR KE TABEL SUBDOMAINS
-- File: 20261111000003_add_ctr_governor_to_subdomains.sql
--
-- Tujuan:
-- Menyimpan metrik CTR GAM hari ini dan status governor ('safe' atau 'emergency')
-- di tabel subdomains sehingga plugin WordPress bisa membaca status secara instan
-- menggunakan anon key dengan performa tinggi.
-- ==============================================================================

ALTER TABLE public.subdomains 
ADD COLUMN IF NOT EXISTS ctr_today numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS ctr_status text DEFAULT 'safe';




-- >>> FILE: 20261111000004_enhance_rpc_get_subdomain_today_ctr_with_slug.sql <<<
-- ==============================================================================
-- MIGRASI: HYBRID RPC GET_SUBDOMAIN_TODAY_CTR (DUAL-MODE)
-- File: 20261111000004_enhance_rpc_get_subdomain_today_ctr_with_slug.sql
--
-- Tujuan:
-- Mendukung 2 metode sekaligus (Hybrid Dual-Mode):
-- 1. Mode Lama: Subdomain Fisik Asli (contoh: fries.tacobellmenuu.us, news.ihopmenuwithprices.us)
--    Tetap diprioritaskan pertama kali jika host memang subdomain fisik.
-- 2. Mode Baru: Domain Tunggal dengan Sub-Path / Slug (contoh: velocitytv.com.pk/careers)
--    Jika host adalah domain induk, sistem otomatis mencocokkan CTR berdasarkan Slug Landing Page.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.get_subdomain_today_ctr(
    target_subdomain text,
    target_slug text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    today_date date;
    tot_imp bigint := 0;
    tot_clk bigint := 0;
    ctr_val numeric := 0;
    matched_target text := target_subdomain;
    clean_slug text := lower(trim(coalesce(target_slug, '')));
    clean_sub text := lower(trim(coalesce(target_subdomain, '')));
    is_root_domain boolean := false;
BEGIN
    -- Tanggal hari ini zona waktu Jakarta (WIB / UTC+7)
    today_date := (now() AT TIME ZONE 'Asia/Jakarta')::date;

    -- Deteksi apakah target_subdomain adalah domain induk (root domain)
    -- Contoh root domain: velocitytv.com.pk, tacobellmenuu.us, ihopmenuwithprices.us
    -- Contoh subdomain fisik: fries.tacobellmenuu.us, news.ihopmenuwithprices.us
    IF EXISTS (SELECT 1 FROM public.domains WHERE lower(domain_url) = clean_sub) THEN
        is_root_domain := true;
    END IF;

    -- JALUR 1 (Untuk Subdomain Fisik Lama):
    -- Jika host BUKAN root domain (misal "fries.tacobellmenuu.us"), utamakan cari data host subdomain dulu
    IF NOT is_root_domain THEN
        SELECT COALESCE(SUM(impressions), 0), COALESCE(SUM(clicks), 0)
        INTO tot_imp, tot_clk
        FROM public.daily_stats
        WHERE lower(subdomain) = clean_sub
          AND source = 'gam'
          AND date = today_date;

        IF tot_imp > 0 THEN
            matched_target := clean_sub;
        END IF;
    END IF;

    -- JALUR 2 (Untuk Mode Slug Baru pada Domain Induk):
    -- Jika tot_imp masih 0 dan ada target_slug (misal "careers", "news", "insurance" di velocitytv.com.pk):
    IF tot_imp = 0 AND clean_slug <> '' THEN
        SELECT COALESCE(SUM(impressions), 0), COALESCE(SUM(clicks), 0)
        INTO tot_imp, tot_clk
        FROM public.daily_stats
        WHERE (
            lower(subdomain) = clean_slug || '.' || clean_sub
            OR lower(subdomain) = clean_slug
            OR lower(site_code) = clean_slug
            OR lower(site_code) LIKE '%-' || clean_slug
            OR lower(subdomain) LIKE clean_slug || '.%'
        )
        AND source = 'gam'
        AND date = today_date;

        IF tot_imp > 0 THEN
            matched_target := clean_slug || '.' || clean_sub;
        END IF;
    END IF;

    -- JALUR 3 (Fallback Terakhir ke domain induk jika jalur 1 & 2 tidak ada data):
    IF tot_imp = 0 THEN
        SELECT COALESCE(SUM(impressions), 0), COALESCE(SUM(clicks), 0)
        INTO tot_imp, tot_clk
        FROM public.daily_stats
        WHERE lower(subdomain) = clean_sub
          AND source = 'gam'
          AND date = today_date;
    END IF;

    -- Hitung persentase CTR
    IF tot_imp > 0 THEN
        ctr_val := ROUND((tot_clk::numeric / tot_imp::numeric) * 100, 2);
    ELSE
        ctr_val := 0;
    END IF;

    RETURN jsonb_build_object(
        'subdomain', matched_target,
        'slug', clean_slug,
        'date', today_date,
        'impressions', tot_imp,
        'clicks', tot_clk,
        'ctr_percent', ctr_val
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_subdomain_today_ctr(text, text) TO anon, authenticated;

