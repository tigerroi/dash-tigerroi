-- Pembersihan baris pendapatan non-subdomain (unit iklan umum milik pengelola lain)
-- untuk shared network velocitytv.com.pk.
-- Yang menjadi milik TigerROI hanya 4 subdomain resmi: dollar, finance, insurance, dan news.

BEGIN;

-- 1. Hapus baris velocitytv tanpa subdomain resmi di daily_stats (sumber selisih Laba Rugi tanpa baris ROI)
DELETE FROM public.daily_stats
WHERE source IN ('gam', 'adsense')
  AND site_code = 'velocitytv'
  AND (
    COALESCE(subdomain, '') = ''
    OR LOWER(subdomain) IN ('velocitytv', 'velocitytv.com.pk', 'unmapped')
  );

-- 2. Hapus baris unmapped/root velocitytv di country_roi
DELETE FROM public.country_roi
WHERE LOWER(COALESCE(sub_domain, '')) IN ('velocitytv', 'velocitytv.com.pk', 'unmapped');

-- 3. Hapus baris unmapped/root velocitytv di roi_snapshots (jika ada)
DELETE FROM public.roi_snapshots
WHERE site_code = 'velocitytv'
  AND (
    COALESCE(sub_domain, '') = ''
    OR LOWER(sub_domain) IN ('velocitytv', 'velocitytv.com.pk', 'unmapped')
  );

COMMIT;
