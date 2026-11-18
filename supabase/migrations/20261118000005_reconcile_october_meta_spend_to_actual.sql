-- ==============================================================================
-- MIGRASI: PENYELARASAN BELANJA META ADS OKTOBER 2026 SESUAI DATA RIIL
-- File: 20261118000005_reconcile_october_meta_spend_to_actual.sql
--
-- Masalah yang Diselesaikan:
-- Di bulan Oktober 2026, total modal top-up akun whitelist BD R 16 terpakai habis
-- dengan total belanja iklan + pajak riil Meta Ads sebesar Rp 32.602.848.
-- Rekap riil Meta Ads per domain:
-- 1. tiktokmodapk.net     : Rp 10.860.137 (Spend: Rp 10.342.988, Pajak: Rp 517.149)
-- 2. tacobellmenuu.us     : Rp    245.008 (Spend: Rp    233.341, Pajak: Rp  11.667)
-- 3. trayedit.com         : Rp 13.272.119 (Spend: Rp 12.640.113, Pajak: Rp 632.006)
-- 4. ihopmenuwithprices.us: Rp  8.225.584 (Spend: Rp  7.833.889, Pajak: Rp 391.695)
-- TOTAL                   : Rp 32.602.848 (Spend: Rp 31.050.331, Pajak: Rp 1.552.517)
--
-- Tindakan:
-- 1. Bersihkan sisa duplikasi fries.tacobellmenuu.us di roi_snapshots pada bulan Oktober.
-- 2. Selaraskan nilai spending, ad_tax, total_spending, profit, dan roi di roi_snapshots
--    agar tepat 100% cocok dengan total per domain di atas.
-- ==============================================================================

BEGIN;

-- 1. Hapus sisa duplikasi fries.tacobellmenuu.us pada roi_snapshots di bulan Oktober
DELETE FROM public.roi_snapshots
WHERE date >= '2026-10-01' AND date <= '2026-10-31'
  AND (
      sub_domain ILIKE '%fries.tacobell%'
      OR (site_code = 'taco' AND sub_domain NOT ILIKE '%burrito%')
  );

-- 2. Selaraskan spending tacobellmenuu.us (burrito) agar tepat Rp 233.341 (Total + Pajak: Rp 245.008)
UPDATE public.roi_snapshots
SET 
  spending = ROUND(spending * (233341.0 / 155593.0)),
  meta_spend = ROUND(spending * (233341.0 / 155593.0)),
  ad_tax = ROUND(ROUND(spending * (233341.0 / 155593.0)) * 0.05),
  total_spending = ROUND(spending * (233341.0 / 155593.0)) + ROUND(ROUND(spending * (233341.0 / 155593.0)) * 0.05),
  profit = earning - (ROUND(spending * (233341.0 / 155593.0)) + ROUND(ROUND(spending * (233341.0 / 155593.0)) * 0.05)),
  roi = CASE 
    WHEN (ROUND(spending * (233341.0 / 155593.0)) + ROUND(ROUND(spending * (233341.0 / 155593.0)) * 0.05)) > 0 
    THEN ROUND(((earning - (ROUND(spending * (233341.0 / 155593.0)) + ROUND(ROUND(spending * (233341.0 / 155593.0)) * 0.05))) / (ROUND(spending * (233341.0 / 155593.0)) + ROUND(ROUND(spending * (233341.0 / 155593.0)) * 0.05)) * 100)::numeric, 2)
    ELSE 0 
  END
WHERE date >= '2026-10-01' AND date <= '2026-10-31'
  AND (domain ILIKE '%tacobell%' OR site_code IN ('taco', 'taco-fries'));

-- 3. Selaraskan spending trayedit.com agar tepat Rp 12.640.113 (Total + Pajak: Rp 13.272.119)
UPDATE public.roi_snapshots
SET 
  spending = ROUND(spending * (12640113.0 / 12739293.0)),
  meta_spend = ROUND(spending * (12640113.0 / 12739293.0)),
  ad_tax = ROUND(ROUND(spending * (12640113.0 / 12739293.0)) * 0.05),
  total_spending = ROUND(spending * (12640113.0 / 12739293.0)) + ROUND(ROUND(spending * (12640113.0 / 12739293.0)) * 0.05),
  profit = earning - (ROUND(spending * (12640113.0 / 12739293.0)) + ROUND(ROUND(spending * (12640113.0 / 12739293.0)) * 0.05)),
  roi = CASE 
    WHEN (ROUND(spending * (12640113.0 / 12739293.0)) + ROUND(ROUND(spending * (12640113.0 / 12739293.0)) * 0.05)) > 0 
    THEN ROUND(((earning - (ROUND(spending * (12640113.0 / 12739293.0)) + ROUND(ROUND(spending * (12640113.0 / 12739293.0)) * 0.05))) / (ROUND(spending * (12640113.0 / 12739293.0)) + ROUND(ROUND(spending * (12640113.0 / 12739293.0)) * 0.05)) * 100)::numeric, 2)
    ELSE 0 
  END
WHERE date >= '2026-10-01' AND date <= '2026-10-31'
  AND (domain ILIKE '%trayedit%' OR site_code = 'tray-decor');

-- 4. Selaraskan spending ihopmenuwithprices.us agar tepat Rp 7.833.889 (Total + Pajak: Rp 8.225.584)
UPDATE public.roi_snapshots
SET 
  spending = ROUND(spending * (7833889.0 / 7846633.0)),
  meta_spend = ROUND(spending * (7833889.0 / 7846633.0)),
  ad_tax = ROUND(ROUND(spending * (7833889.0 / 7846633.0)) * 0.05),
  total_spending = ROUND(spending * (7833889.0 / 7846633.0)) + ROUND(ROUND(spending * (7833889.0 / 7846633.0)) * 0.05),
  profit = earning - (ROUND(spending * (7833889.0 / 7846633.0)) + ROUND(ROUND(spending * (7833889.0 / 7846633.0)) * 0.05)),
  roi = CASE 
    WHEN (ROUND(spending * (7833889.0 / 7846633.0)) + ROUND(ROUND(spending * (7833889.0 / 7846633.0)) * 0.05)) > 0 
    THEN ROUND(((earning - (ROUND(spending * (7833889.0 / 7846633.0)) + ROUND(ROUND(spending * (7833889.0 / 7846633.0)) * 0.05))) / (ROUND(spending * (7833889.0 / 7846633.0)) + ROUND(ROUND(spending * (7833889.0 / 7846633.0)) * 0.05)) * 100)::numeric, 2)
    ELSE 0 
  END
WHERE date >= '2026-10-01' AND date <= '2026-10-31'
  AND (domain ILIKE '%ihopmenu%' OR site_code = 'ihop-menu');

-- 5. Selaraskan spending tiktokmodapk.net agar tepat Rp 10.342.988 (Total + Pajak: Rp 10.860.137)
UPDATE public.roi_snapshots
SET 
  spending = ROUND(spending * (10342988.0 / 7028335.0)),
  meta_spend = ROUND(spending * (10342988.0 / 7028335.0)),
  ad_tax = ROUND(ROUND(spending * (10342988.0 / 7028335.0)) * 0.05),
  total_spending = ROUND(spending * (10342988.0 / 7028335.0)) + ROUND(ROUND(spending * (10342988.0 / 7028335.0)) * 0.05),
  profit = earning - (ROUND(spending * (10342988.0 / 7028335.0)) + ROUND(ROUND(spending * (10342988.0 / 7028335.0)) * 0.05)),
  roi = CASE 
    WHEN (ROUND(spending * (10342988.0 / 7028335.0)) + ROUND(ROUND(spending * (10342988.0 / 7028335.0)) * 0.05)) > 0 
    THEN ROUND(((earning - (ROUND(spending * (10342988.0 / 7028335.0)) + ROUND(ROUND(spending * (10342988.0 / 7028335.0)) * 0.05))) / (ROUND(spending * (10342988.0 / 7028335.0)) + ROUND(ROUND(spending * (10342988.0 / 7028335.0)) * 0.05)) * 100)::numeric, 2)
    ELSE 0 
  END
WHERE date >= '2026-10-01' AND date <= '2026-10-31'
  AND (domain ILIKE '%tiktok%' OR site_code = 'tiktok-mod');

COMMIT;
