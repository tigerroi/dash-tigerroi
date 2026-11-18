-- Migrasi penambahan kolom-kolom tabel payouts agar mendukung form pencairan lengkap
ALTER TABLE public.payouts ADD COLUMN IF NOT EXISTS date DATE;
ALTER TABLE public.payouts ADD COLUMN IF NOT EXISTS saldo_sebelumnya NUMERIC;
ALTER TABLE public.payouts ADD COLUMN IF NOT EXISTS real_masuk NUMERIC;
ALTER TABLE public.payouts ADD COLUMN IF NOT EXISTS gov_tax_percent NUMERIC;
ALTER TABLE public.payouts ADD COLUMN IF NOT EXISTS fee_percent NUMERIC;
ALTER TABLE public.payouts ADD COLUMN IF NOT EXISTS potongan_konversi NUMERIC;
ALTER TABLE public.payouts ADD COLUMN IF NOT EXISTS bank TEXT;
ALTER TABLE public.payouts ADD COLUMN IF NOT EXISTS nama_rekening TEXT;
ALTER TABLE public.payouts ADD COLUMN IF NOT EXISTS no_rekening TEXT;
ALTER TABLE public.payouts ADD COLUMN IF NOT EXISTS kode_pip TEXT;
ALTER TABLE public.payouts ADD COLUMN IF NOT EXISTS nominal_pencairan NUMERIC;
ALTER TABLE public.payouts ADD COLUMN IF NOT EXISTS fee_nominal NUMERIC;
