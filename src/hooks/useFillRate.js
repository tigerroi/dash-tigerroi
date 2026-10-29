import { useEffect, useState } from "react";
import { supabase } from "../config/supabase";

/**
 * Hook Rasio Penayangan menggunakan klien Supabase dengan polling sederhana.
 * Mengambil data performa tayangan dan permintaan Ad Exchange dari daily_stats
 * dan memetakan ke hierarki tree { [date]: { [siteKey]: { [hXX]: { req, imp } } } }.
 */
export function useFillRate({ from, to }) {
  const [data, setData] = useState({ loading: true, error: "", tree: {} });
  const [status, setStatus] = useState(null);

  useEffect(() => {
    let isMounted = true;
    setData((prev) => ({ ...prev, loading: true }));

    const fetchFillRate = async () => {
      try {
        // 1. Ambil data subdomains dan domains untuk pemetaan hostname resmi
        const [{ data: subdomains }, { data: domains }] = await Promise.all([
          supabase.from("subdomains").select("id, name, site_code, domain_id, pic"),
          supabase.from("domains").select("id, domain_url, network_code"),
        ]);

        const domainMap = new Map();
        for (const d of domains || []) {
          const rawUrl = String(d.domain_url || "")
            .trim()
            .toLowerCase()
            .replace(/^https?:\/\//, "")
            .replace(/\/.*$/, "");
          domainMap.set(d.id, rawUrl);
        }

        // Peta (site_code + "__" + subdomain) -> hostname penuh (contoh: careers.tiktokmodapk.net)
        const hostMap = new Map();
        for (const sub of subdomains || []) {
          const parent = domainMap.get(sub.domain_id) || "";
          const subName = String(sub.name || "").trim().toLowerCase();
          const host = parent ? `${subName}.${parent}` : subName;
          hostMap.set(`${sub.site_code}__${subName}`, host);
        }

        // 2. Query data GAM dari tabel daily_stats
        let query = supabase
          .from("daily_stats")
          .select("date, site_code, subdomain, impressions, clicks, metadata")
          .eq("source", "gam");

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

        // 3. Susun tree { [date]: { [siteKey]: { h00: { req, imp } } } }
        // siteKey: hostname dengan tanda titik diganti koma sesuai decodeSiteKey di fillRate.js
        const tree = {};
        for (const row of rows || []) {
          const d = row.date;
          const subName = String(row.subdomain || "").trim().toLowerCase();
          const rawHost =
            row.metadata?.full_host ||
            hostMap.get(`${row.site_code}__${subName}`) ||
            (subName ? `${subName}.${row.site_code}` : row.site_code);

          const sKey = rawHost.replace(/\./g, ",");
          if (!tree[d]) tree[d] = {};
          if (!tree[d][sKey]) tree[d][sKey] = {};

          const hourly = row.metadata?.hourly;
          if (hourly && Object.keys(hourly).length > 0) {
            for (const [hour, counts] of Object.entries(hourly)) {
              const hKey = `h${String(hour).padStart(2, "0")}`;
              tree[d][sKey][hKey] = {
                req: Number(counts?.req) || 0,
                imp: Number(counts?.imp) || 0,
                partial: false,
              };
            }
          } else {
            // Fallback jika baris belum memiliki rincian hourly (misal data historis)
            const req = Number(row.metadata?.requests) || Number(row.impressions) || 0;
            const imp = Number(row.impressions) || 0;
            tree[d][sKey]["h12"] = {
              req,
              imp,
              partial: false,
            };
          }
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
          .eq("job_name", "sync-gam")
          .order("started_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (isMounted && latestSync) {
          setStatus({
            lastRunAt: latestSync.finished_at || latestSync.started_at,
            status: latestSync.status,
            networks: {
              gam: {
                name: "Google Ad Manager",
                ok:
                  latestSync.status === "success" ||
                  latestSync.status === "completed" ||
                  latestSync.status === "ok",
              },
            },
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
