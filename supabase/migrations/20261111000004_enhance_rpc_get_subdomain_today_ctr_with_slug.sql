-- ==============================================================================
-- MIGRASI: HYBRID RPC GET_SUBDOMAIN_TODAY_CTR (DUAL-MODE)
-- File: 20261111000004_enhance_rpc_get_subdomain_today_ctr_with_slug.sql
--
-- Tujuan:
-- Mendukung 2 metode sekaligus (Hybrid Dual-Mode):
-- 1. Mode Lama: Subdomain Fisik Asli (contoh: fries.tacobellmenuu.us, news.ihopmenuwithprices.us)
--    Tetap diprioritaskan pertama kali jika host memang subdomain fisik.
-- 2. Mode Baru: Domain Tunggal dengan Sub-Path / Slug (contoh: velocitytv.com.pk/careers)
--    Jika host adalah domain induk, sistem otomatis mencocokkan CTR berdasarkan Slug Landing Page.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.get_subdomain_today_ctr(
    target_subdomain text,
    target_slug text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    today_date date;
    tot_imp bigint := 0;
    tot_clk bigint := 0;
    ctr_val numeric := 0;
    matched_target text := target_subdomain;
    clean_slug text := lower(trim(coalesce(target_slug, '')));
    clean_sub text := lower(trim(coalesce(target_subdomain, '')));
    is_root_domain boolean := false;
BEGIN
    -- Tanggal hari ini zona waktu Jakarta (WIB / UTC+7)
    today_date := (now() AT TIME ZONE 'Asia/Jakarta')::date;

    -- Deteksi apakah target_subdomain adalah domain induk (root domain)
    -- Contoh root domain: velocitytv.com.pk, tacobellmenuu.us, ihopmenuwithprices.us
    -- Contoh subdomain fisik: fries.tacobellmenuu.us, news.ihopmenuwithprices.us
    IF EXISTS (SELECT 1 FROM public.domains WHERE lower(domain_url) = clean_sub) THEN
        is_root_domain := true;
    END IF;

    -- JALUR 1 (Untuk Subdomain Fisik Lama):
    -- Jika host BUKAN root domain (misal "fries.tacobellmenuu.us"), utamakan cari data host subdomain dulu
    IF NOT is_root_domain THEN
        SELECT COALESCE(SUM(impressions), 0), COALESCE(SUM(clicks), 0)
        INTO tot_imp, tot_clk
        FROM public.daily_stats
        WHERE lower(subdomain) = clean_sub
          AND source = 'gam'
          AND date = today_date;

        IF tot_imp > 0 THEN
            matched_target := clean_sub;
        END IF;
    END IF;

    -- JALUR 2 (Untuk Mode Slug Baru pada Domain Induk):
    -- Jika tot_imp masih 0 dan ada target_slug (misal "careers", "news", "insurance" di velocitytv.com.pk):
    IF tot_imp = 0 AND clean_slug <> '' THEN
        SELECT COALESCE(SUM(impressions), 0), COALESCE(SUM(clicks), 0)
        INTO tot_imp, tot_clk
        FROM public.daily_stats
        WHERE (
            lower(subdomain) = clean_slug || '.' || clean_sub
            OR lower(subdomain) = clean_slug
            OR lower(site_code) = clean_slug
            OR lower(site_code) LIKE '%-' || clean_slug
            OR lower(subdomain) LIKE clean_slug || '.%'
        )
        AND source = 'gam'
        AND date = today_date;

        IF tot_imp > 0 THEN
            matched_target := clean_slug || '.' || clean_sub;
        END IF;
    END IF;

    -- JALUR 3 (Fallback Terakhir ke domain induk jika jalur 1 & 2 tidak ada data):
    IF tot_imp = 0 THEN
        SELECT COALESCE(SUM(impressions), 0), COALESCE(SUM(clicks), 0)
        INTO tot_imp, tot_clk
        FROM public.daily_stats
        WHERE lower(subdomain) = clean_sub
          AND source = 'gam'
          AND date = today_date;
    END IF;

    -- Hitung persentase CTR
    IF tot_imp > 0 THEN
        ctr_val := ROUND((tot_clk::numeric / tot_imp::numeric) * 100, 2);
    ELSE
        ctr_val := 0;
    END IF;

    RETURN jsonb_build_object(
        'subdomain', matched_target,
        'slug', clean_slug,
        'date', today_date,
        'impressions', tot_imp,
        'clicks', tot_clk,
        'ctr_percent', ctr_val
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_subdomain_today_ctr(text, text) TO anon, authenticated;
