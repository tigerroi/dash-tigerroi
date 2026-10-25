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
