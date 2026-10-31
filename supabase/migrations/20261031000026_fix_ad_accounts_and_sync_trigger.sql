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

