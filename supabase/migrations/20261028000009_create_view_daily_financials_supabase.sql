-- ==============================================================================
-- Migrasi View Agregasi Finansial Harian Murni Supabase (PostgreSQL)
-- Versi: 20261028000009_create_view_daily_financials_supabase.sql
-- ==============================================================================

DROP VIEW IF EXISTS public.view_daily_financials CASCADE;

CREATE OR REPLACE VIEW public.view_daily_financials
WITH (security_invoker = true) AS
SELECT 
    v.date,
    COALESCE(SUM(v.earning), 0) AS gross_revenue,
    COALESCE(SUM(v.spending), 0) AS total_spend,
    COALESCE(SUM(v.ad_tax), 0) AS ad_tax,
    COALESCE(SUM(v.total_spending), 0) AS total_spending,
    COALESCE(SUM(v.profit), 0) AS net_profit
FROM public.view_daily_roi v
GROUP BY v.date
ORDER BY v.date DESC;
