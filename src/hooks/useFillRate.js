import { useEffect, useState } from "react";
import { supabase } from "../config/supabase";

/**
 * Hook Rasio Penayangan menggunakan klien Supabase dengan polling sederhana.
 */
export function useFillRate({ from, to }) {
  const [data, setData] = useState({ loading: true, error: "", tree: {} });
  const [status, setStatus] = useState(null);

  useEffect(() => {
    let isMounted = true;
    setData((prev) => ({ ...prev, loading: true }));

    const fetchFillRate = async () => {
      try {
        // Query data revenue GAM berdasarkan rentang tanggal
        let query = supabase
          .from("gam_daily_revenue")
          .select("date, site_code, ad_unit_name, impressions, clicks");

        if (from) {
          query = query.gte("date", from);
        }
        if (to) {
          query = query.lte("date", to);
        }

        const { data: rows, error } = await query;

        if (error) {
          if (isMounted) setData((prev) => ({ ...prev, loading: false, error: error.message }));
          return;
        }

        // Susun tree { [date]: { [siteKey]: { h00: { req, imp } } } }
        const tree = {};
        for (const row of rows || []) {
          const d = row.date;
          const s = (row.site_code || "unknown").replace(/\./g, ",");
          if (!tree[d]) tree[d] = {};
          if (!tree[d][s]) tree[d][s] = {};
          tree[d][s]["h00"] = {
            req: row.impressions || 0,
            imp: row.impressions || 0,
            partial: false,
          };
        }

        if (isMounted) {
          setData({ loading: false, error: "", tree });
        }
      } catch (err) {
        if (isMounted) {
          setData((prev) => ({ ...prev, loading: false, error: err.message }));
        }
      }
    };

    fetchFillRate();
    const intervalId = setInterval(fetchFillRate, 60000); // Polling setiap 60 detik

    return () => {
      isMounted = false;
      clearInterval(intervalId);
    };
  }, [from, to]);

  useEffect(() => {
    let isMounted = true;
    const fetchStatus = async () => {
      try {
        const { data: latestSync } = await supabase
          .from("sync_runs")
          .select("started_at, finished_at, status")
          .order("started_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (isMounted && latestSync) {
          setStatus({
            lastRun: latestSync.finished_at || latestSync.started_at,
            status: latestSync.status,
          });
        }
      } catch {
        // Abaikan error status background
      }
    };

    fetchStatus();
    const intervalId = setInterval(fetchStatus, 60000);

    return () => {
      isMounted = false;
      clearInterval(intervalId);
    };
  }, []);

  return { ...data, status };
}
