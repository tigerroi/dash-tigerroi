import { useCallback, useEffect, useState } from "react";
import { measureNode } from "../lib/firebaseCost";
import { HEAVY_NODES } from "../lib/storeSubscriptions";

/**
 * Ukuran tiap node RTDB, DIUKUR dari isi store sesi ini.
 *
 * Alternatifnya sudah ditolak dua kali dan sebabnya sama: sebuah daftar angka yang diketik
 * ("users 3,12 MB") benar pada hari ia diketik dan basi diam-diam sesudahnya — persis pola "angka
 * ketikan" yang ditolak di seluruh repo ini — sementara mengukurnya di sisi server berarti alat
 * pengukur biaya mengunduh node terberat sekali sehari dan MENAMBAH biaya yang sedang diukurnya.
 * Di sini yang diukur adalah data yang SUDAH terlanjur diunduh sesi ini; ia gratis.
 *
 * DIUKUR SEKALI SAAT PANEL DIBUKA, bukan tiap store berubah. `JSON.stringify` atas tiga puluh node
 * yang totalnya megabyte-an di setiap pembaruan langganan akan membekukan halaman tiap kali sync
 * menulis satu baris. Tombol "Ukur ulang" untuk yang memintanya.
 *
 * YANG TIDAK BISA DIUKUR SESI INI TIDAK DINILAI NOL. Dua node terberat (`roiSnapshots`,
 * `userReports`) baru dilanggan kalau route-nya membutuhkannya (lib/heavyData.js), jadi sesi yang
 * cuma membuka /activity-logs tidak memilikinya sama sekali — dan nol di sana adalah klaim bahwa
 * node terberat di database ini tidak berisi apa-apa. Ia dikembalikan sebagai "belum terukur", dan
 * panelnya menyebutkannya.
 */

// Versinya ikut di nama, sepola `ACTIVITY_BUFFER_KEY`: bentuk yang berubah tidak boleh membuat
// nilai lama gagal diurai selamanya.
const NODE_SIZES_KEY = "rabbitroi.nodeSizes.v1";

function readStored(storage) {
  try {
    const raw = storage?.getItem(NODE_SIZES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out = {};
    for (const [key, entry] of Object.entries(parsed)) {
      if (Number.isFinite(entry?.bytes)) out[key] = { bytes: entry.bytes, at: entry.at || "" };
    }
    return out;
  } catch {
    // Isi yang rusak dibuang diam-diam: mengukur biaya tidak boleh jadi alasan halaman jatuh.
    return {};
  }
}

function writeStored(storage, value) {
  try {
    storage?.setItem(NODE_SIZES_KEY, JSON.stringify(value));
  } catch {
    // localStorage penuh atau ditolak (mode privat). Pengukuran sesi ini tetap dipakai; yang hilang
    // cuma ingatannya untuk sesi berikutnya.
  }
}

/**
 * Node berat yang KOSONG berarti belum dilanggan, bukan benar-benar kosong.
 *
 * Untuk node lain, kosong adalah jawaban yang sah — `syncRetries` memang `{}` hampir sepanjang
 * hari, dan menolak mengukurnya berarti melaporkannya sebagai lubang selamanya.
 */
function isUnmeasured(key, bytes) {
  if (!Number.isFinite(bytes)) return true;
  return HEAVY_NODES.includes(key) && bytes <= 2;
}

export function useNodeSizes(store, storage = typeof window === "undefined" ? null : localStorage) {
  const [state, setState] = useState(() => ({ sizes: {}, measured: {} }));

  const measure = useCallback(() => {
    const stored = readStored(storage);
    const at = new Date().toISOString();
    const next = { ...stored };
    for (const [key, value] of Object.entries(store || {})) {
      const bytes = measureNode(value);
      if (isUnmeasured(key, bytes)) continue;
      next[key] = { bytes, at };
    }
    writeStored(storage, next);
    const sizes = {};
    for (const [key, entry] of Object.entries(next)) sizes[key] = entry.bytes;
    setState({ sizes, measured: next });
  }, [store, storage]);

  // Sekali saat panel mount. `measure` sengaja TIDAK jadi dependensi: ia berubah tiap kali store
  // berubah, dan efek yang ikut berjalan ulang karenanya persis pengukuran tiap render yang
  // dihindari di atas.
  // biome-ignore lint/correctness/useExhaustiveDependencies: sekali saat mount, lihat catatan di atas
  useEffect(() => {
    measure();
  }, []);

  return { ...state, measure };
}
