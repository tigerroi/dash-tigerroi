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
