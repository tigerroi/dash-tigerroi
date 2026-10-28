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
