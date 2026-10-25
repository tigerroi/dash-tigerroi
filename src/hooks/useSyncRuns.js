import { useEffect, useState } from "react";
import { fetchSyncRuns } from "../lib/controlApi";

/**
 * Baca log "Sync Otomatis" untuk halaman Settings.
 *
 * Sejak log pindah dari RTDB ke SQLite server, halaman tidak lagi berlangganan lewat store: ia
 * memintanya sekali saat dibuka. Tidak realtime, dan itu cukup — ini riwayat, dan "sedang sync
 * sekarang" tetap ditunjukkan hitung mundur di topbar (yang masih membaca syncStatus dari RTDB).
 */
export function useSyncRuns(refreshKey) {
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `refreshKey` (= `syncStatus.running`) adalah pemicunya — log diminta ulang begitu sebuah run mulai dan selesai.
  useEffect(() => {
    let active = true;
    fetchSyncRuns()
      .then((body) => {
        if (!active) return;
        setRuns(body?.runs || []);
        setLoading(false);
      })
      .catch((fetchError) => {
        if (!active) return;
        setError(fetchError);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [refreshKey]);

  return { runs, loading, error };
}
