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
