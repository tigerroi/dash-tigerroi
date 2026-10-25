import { useCallback, useLayoutEffect, useState } from "react";

// Jarak yang disisakan di bawah elemen: padding bawah `.content` (20px). Satu-satunya angka di
// sini, dan ia yang paling kecil kemungkinannya bergeser — yang di ATAS elemen (topbar, tab, judul
// halaman) justru yang sering berubah, dan itu yang diukur alih-alih dijumlahkan.
const BOTTOM_GAP = 20;

// Di bawah tinggi ini, mengisi layar berarti memberi elemennya ruang yang lebih sempit daripada
// isinya sendiri. Lewat sini, biarkan halaman menggulir seperti biasa.
const MIN_HEIGHT = 320;

/**
 * Tinggi yang membuat sebuah elemen berakhir tepat di dasar layar.
 *
 * Dipakai tab Kalender, satu-satunya halaman yang tidak boleh menggulir sebagai halaman: kalender
 * yang digulir untuk melihat minggu terakhir menaikkan panel rincian di sebelahnya, dan angka yang
 * sedang dibaca kehilangan tanggal yang menjelaskannya.
 *
 * DIUKUR, bukan dihitung. `calc(100dvh - 168px)` menuntut daftar tinggi segala yang berdiri di
 * atasnya — topbar, tab halaman, judul, jaraknya — dan daftar itu akan meleset pada hari seseorang
 * menambah satu baris di antaranya. Yang meleset tidak berbunyi sebagai kesalahan apa pun: yang
 * terlihat cuma kalender yang sedikit terpotong, atau ruang kosong yang tidak ada yang tahu asalnya.
 *
 * Jarak dari puncak DOKUMEN (`rect.top + scrollY`), bukan dari puncak viewport: yang kedua bergeser
 * mengikuti gulungan, dan pengukuran yang dilakukan saat halaman sedang tergulir akan menghasilkan
 * tinggi yang terlalu besar — yang justru membuat halamannya menggulir lagi, lalu tumbuh lagi pada
 * pengukuran berikutnya.
 *
 * Mengembalikan `null` saat tidak berlaku (tab lain, layar sempit, jendela yang terlalu pendek);
 * pemanggilnya tidak memasang `style` apa pun di situ, dan elemennya kembali setinggi isinya.
 */
export function useFillViewport(enabled) {
  const [node, setNode] = useState(null);
  const [height, setHeight] = useState(null);
  // Callback ref, bukan `useRef`: yang menjadikannya dependensi efek harus berupa state, kalau
  // tidak pengukuran pertama jalan sebelum elemennya terpasang dan tidak pernah diulang.
  const ref = useCallback((element) => setNode(element), []);

  useLayoutEffect(() => {
    if (!enabled || !node) {
      setHeight(null);
      return undefined;
    }

    const measure = () => {
      // Berlaku hanya saat elemennya benar-benar BERKOLOM DUA. Titik putusnya dibaca dari hasil
      // CSS-nya sendiri, bukan disalin sebagai angka kedua di sini: satu `@media` yang digeser
      // suatu hari akan meninggalkan tinggi terkunci pada layout yang sudah bertumpuk — dan yang
      // terjadi adalah panel kanan setinggi 300px di bawah kalender yang penuh.
      const columns = window.getComputedStyle(node).gridTemplateColumns.split(" ").length;
      if (columns < 2) {
        setHeight(null);
        return;
      }

      const top = node.getBoundingClientRect().top + window.scrollY;
      const available = window.innerHeight - top - BOTTOM_GAP;
      setHeight(available >= MIN_HEIGHT ? available : null);
    };

    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [enabled, node]);

  return [ref, height];
}
