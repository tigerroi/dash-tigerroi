import { useEffect } from "react";
import { ACTIVITY_FLUSH_MS } from "../lib/activityLog";
import {
  flushActivity,
  logActivity,
  logPageView,
  setActivityActor,
  startActivityFlush,
} from "../lib/activityRecorder";

/**
 * Pemasang jejak aktivitas. Satu pemakai: `App` di main.jsx.
 *
 * Tiga hal yang dipasangnya, dan ketiganya sengaja tinggal di SATU tempat alih-alih disebar ke
 * komponen yang dicatatnya:
 *
 *   1. Identitas sesi — dipasang ke pencatat begitu `user` berubah.
 *   2. Kunjungan halaman — dari `path` milik router, jadi ia ikut alamat dan bukan ikut komponen
 *      yang kebetulan dirender.
 *   3. Klik — SATU pendengar di `document`, bukan `onClick` di lima puluh tombol.
 *
 * Yang ketiga adalah alasan halaman ini bisa berjanji "semua aktivitas" tanpa berbohong. Dipasang
 * per komponen, yang tercatat bukan "semua klik" melainkan "klik di tombol yang sempat diingat
 * orang untuk dipasangi" — dan tombol yang ditambahkan bulan depan akan hilang dari log tanpa satu
 * pun tanda bahwa ia hilang.
 */
export function useActivityLogger(user, path) {
  useEffect(() => {
    setActivityActor(user);
    // Login yang baru berhasil membawa token: baris yang menunggu di penyangga — termasuk percobaan
    // login yang GAGAL sebelum ini — berangkat sekarang, bukan lima menit lagi.
    if (user) flushActivity();
  }, [user]);

  useEffect(() => startActivityFlush(ACTIVITY_FLUSH_MS), []);

  useEffect(() => {
    if (path) logPageView(path);
  }, [path]);

  useEffect(() => {
    /**
     * Fase CAPTURE, bukan bubble.
     *
     * Sebagian handler di dashboard ini memanggil `stopPropagation` (dialog konfirmasi, popover
     * sel tabel). Di fase bubble, klik itu tidak pernah sampai ke `document` — dan yang hilang
     * dari log justru tombol di dalam dialog konfirmasi, yaitu tempat keputusan yang paling ingin
     * ditelusuri orang sesudahnya.
     */
    const onClick = (event) => {
      const element = event.target?.closest?.(
        "button, a[href], [role='button'], summary, input[type='submit']",
      );
      if (!element) return;
      if (element.disabled) return;

      logActivity({
        category: "interaction",
        action: "click",
        page: window.location.pathname,
        label: interactiveLabel(element),
        // Bukan `element.className` mentah: yang berguna dari sebuah kelas adalah PERANNYA
        // ("danger-button" = tombol yang menghapus sesuatu), bukan daftar utility class.
        target: roleOf(element),
      });
    };

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  useEffect(() => {
    // Tab yang ditutup atau ditinggalkan. `pagehide` dan bukan `beforeunload`: yang kedua tidak
    // pernah menyala di Safari iOS, dan justru di ponsel tab dibiarkan lalu dibuang sistem tanpa
    // pernah kembali. Kiriman yang tidak sempat selesai tidak menghilangkan apa pun — penyangga
    // baru dikosongkan setelah server menjawab.
    const flush = () => flushActivity();
    const onHidden = () => {
      if (document.visibilityState === "hidden") flush();
    };

    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onHidden);
    // Jaringan yang baru kembali. Ini yang membuat "kalau ada internet" bekerja sebagai janji dan
    // bukan sebagai kebetulan lima menitan.
    window.addEventListener("online", flush);

    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("online", flush);
    };
  }, []);
}

/**
 * Nama sebuah tombol seperti yang DIBACA orang di layar.
 *
 * `aria-label` didahulukan karena tombol ikon — hapus, salin, tampilkan secret — tidak punya teks
 * sama sekali; tanpa itu, seluruh kolom Label di halaman jejak akan berisi baris kosong untuk
 * tombol-tombol yang justru paling perlu tercatat.
 */
function interactiveLabel(element) {
  const aria = element.getAttribute?.("aria-label");
  if (aria) return aria.trim().slice(0, 120);
  const title = element.getAttribute?.("title");
  const text = String(element.textContent || "")
    .replace(/\s+/g, " ")
    .trim();
  return (text || title || "").slice(0, 120);
}

// Kelas yang menyebutkan PERAN tombolnya. Yang tidak dikenali dilaporkan sebagai nama tag-nya —
// lebih jujur daripada memaksanya masuk salah satu kategori di atas.
export function roleOf(element) {
  const className = String(element.className || "");
  if (className.includes("danger-button")) return "danger-button";
  if (className.includes("primary-button")) return "primary-button";
  if (className.includes("ghost-button")) return "ghost-button";
  return String(element.tagName || "").toLowerCase();
}
