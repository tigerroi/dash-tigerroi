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
