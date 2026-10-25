import { useEffect, useMemo, useState } from "react";
import { fetchActivityLogs } from "../lib/controlApi";
import { shiftDateKey } from "../lib/dateRange";

/**
 * Baca jejak aktivitas untuk halaman /activity-logs — SEPOTONG, bukan seluruh tabel.
 *
 * Sejak jejak pindah dari RTDB ke SQLite di server kontrol (node itu paling cepat tumbuh dan dulu
 * menyeret database yang dibaca halaman lain), halaman tidak bisa lagi berlangganan langsung: ia
 * MEMINTA rentang tanggal yang sedang dipilih ke server. Konsekuensinya diketahui dan diterima —
 * tidak ada lagi pembaruan realtime; ini tampilan historis per rentang, jadi satu bacaan saat dibuka
 * dan saat tanggalnya berganti sudah cukup.
 */

// Batas atas satu bacaan — cerminan QUERY_LIMIT di server. Rentang yang isinya lebih dari ini
// dipotong dari yang TERBARU, dan halaman mengatakan bahwa ia dipotong.
export const ACTIVITY_QUERY_LIMIT = 3000;

// Kunci yang kosong/rusak (rentang "semua tanggal") tetap kosong, bukan "NaN-NaN-NaN".
function shiftDay(key, days) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(key || "")) ? shiftDateKey(key, days) : "";
}

export function useActivityLogs({ from, to }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  /**
   * Batas query diberi margin SEHARI di kedua ujung, lalu disaring persis di sisi UI.
   *
   * `at` adalah stempel waktu UTC, sementara rentang yang dipilih orang adalah hari menurut jamnya
   * sendiri (WIB, tujuh jam di depan). Tanpa margin, tujuh jam pertama tiap hari — 00:00 sampai
   * 07:00 WIB, yang di UTC masih tanggal kemarin — hilang dari hasil tanpa jejak.
   */
  const bounds = useMemo(
    () => ({
      start: from ? shiftDay(from, -1) : "",
      end: to ? `${shiftDay(to, 1)}T99` : "",
    }),
    [from, to],
  );

  useEffect(() => {
    // Bacaan yang tanggalnya sudah tidak dipilih lagi tidak boleh menimpa yang baru: request lama
    // yang datang belakangan akan menampilkan rentang yang salah. Dijaga flag, bukan AbortController
    // — request() di controlApi tidak menerima signal, dan mengabaikan jawaban basi sudah cukup.
    let active = true;
    setLoading(true);
    setError(null);

    fetchActivityLogs(bounds)
      .then((body) => {
        if (!active) return;
        setRows(body?.rows || []);
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
  }, [bounds]);

  return { rows, loading, error, truncated: rows.length >= ACTIVITY_QUERY_LIMIT };
}
