-- ==============================================================================
-- MIGRASI: RPC GET_SUBDOMAIN_TODAY_CTR UNTUK AUTO SAFE CTR GOVERNOR
-- File: 20261111000002_create_rpc_get_subdomain_today_ctr.sql
--
-- Tujuan:
-- Menyediakan endpoint read-only yang sangat aman untuk plugin WordPress TigerROI
-- agar bisa membaca CTR Google Ad Manager (GAM) hari ini per subdomain.
-- Fungsi ini HANYA mengembalikan impressions, clicks, dan ctr_percent (TIDAK membuka
-- data finansial seperti revenue, spend, atau profit ke publik/anon).
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.get_subdomain_today_ctr(target_subdomain text)
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
BEGIN
    -- Tanggal hari ini zona waktu Jakarta (WIB / UTC+7)
    today_date := (now() AT TIME ZONE 'Asia/Jakarta')::date;

    SELECT COALESCE(SUM(impressions), 0), COALESCE(SUM(clicks), 0)
    INTO tot_imp, tot_clk
    FROM public.daily_stats
    WHERE subdomain = target_subdomain
      AND source = 'gam'
      AND date = today_date;

    IF tot_imp > 0 THEN
        ctr_val := ROUND((tot_clk::numeric / tot_imp::numeric) * 100, 2);
    ELSE
        ctr_val := 0;
    END IF;

    RETURN jsonb_build_object(
        'subdomain', target_subdomain,
        'date', today_date,
        'impressions', tot_imp,
        'clicks', tot_clk,
        'ctr_percent', ctr_val
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_subdomain_today_ctr(text) TO anon, authenticated;

