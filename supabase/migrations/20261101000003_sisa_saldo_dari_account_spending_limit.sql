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
