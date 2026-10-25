import { useEffect, useState } from "react";
import { readChartPalette } from "../lib/chartTheme";
import { subscribeTheme } from "../lib/theme";

// Satu pembacaan untuk SELURUH grafik, bukan satu per komponen.
//
// Temanya berlaku sedokumen: kalau temanya berpindah, semua grafik berpindah bersamaan. Satu
// pelanggan yang membaca ulang `getComputedStyle` per grafik berarti empat panel Overview memaksa
// layout dihitung ulang empat kali untuk satu perubahan yang sama.
//
// Yang didengarkan adalah tema (src/lib/theme.js), BUKAN `matchMedia` langsung: sejak ada tombol di
// topbar, setelan perangkat bukan lagi satu-satunya yang memindahkan tema — dan grafik yang cuma
// mendengar perangkat akan tetap hijau-terang di halaman yang sudah gelap sampai ada yang memuat
// ulang halamannya.
const listeners = new Set();
let palette = null;
let started = false;

function currentPalette() {
  if (palette === null) {
    palette = readChartPalette(globalThis.document?.documentElement);
  }
  return palette;
}

function subscribe(listener) {
  listeners.add(listener);
  if (!started) {
    started = true;
    subscribeTheme(() => {
      // Dibaca ulang SETELAH atribut tema terpasang — `subscribeTheme` memanggil pelanggannya
      // sesudah itu, jadi token yang terbaca di sini sudah token tema yang baru.
      palette = readChartPalette(globalThis.document?.documentElement);
      for (const notify of listeners) notify(palette);
    });
  }
  return () => listeners.delete(listener);
}

export function useChartPalette() {
  const [value, setValue] = useState(currentPalette);
  useEffect(() => subscribe(setValue), []);
  return value;
}
