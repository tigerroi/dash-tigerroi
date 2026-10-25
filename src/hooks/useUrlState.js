import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import { locationSearch, navigateTo, subscribeLocation } from "../lib/browserLocation";
import {
  decodeRange,
  encodeRange,
  readParam,
  readRecord,
  recordPatch,
  writeParams,
} from "../lib/urlState";

/**
 * `useState` untuk keadaan yang harus bertahan di alamat: pencarian, filter, periode, tab.
 *
 * Dipakai persis seperti `useState` — `const [q, setQ] = useUrlState("q", "")` — tapi yang
 * menyimpan nilainya adalah query, jadi Back, refresh, dan tautan yang disalin menghasilkan tabel
 * yang sama. Nilai yang sama dengan `fallback` tidak ditulis sama sekali; alamat halaman yang belum
 * disaring tetap bersih.
 *
 * Bawaannya `replace`: mengetik di kotak pencarian tidak boleh menumpuk satu entri riwayat per
 * huruf. Yang benar-benar membuka sesuatu (situs di /plugin) menyebut `{ history: "push" }` sendiri
 * — itulah yang membuat Back mengembalikan orang ke daftar yang masih tersaring, bukan keluar dari
 * halaman.
 */
function useUrlSearch() {
  // Snapshot server ("") ada karena useSyncExternalStore memintanya; halaman ini tidak pernah
  // dirender di server.
  return useSyncExternalStore(subscribeLocation, locationSearch, () => "");
}

function commit(patch, history) {
  navigateTo(window.location.pathname + writeParams(window.location.search, patch), {
    replace: history !== "push",
  });
}

export function useUrlState(key, fallback = "", { history = "replace" } = {}) {
  const search = useUrlSearch();
  const value = readParam(search, key, fallback);

  const setValue = useCallback(
    (next, options = {}) => {
      // Dibaca ulang dari alamat, bukan dari `value` yang tertutup closure: dua filter di halaman
      // yang sama bisa berubah dalam satu putaran render, dan yang kedua akan menulis di atas
      // alamat yang sudah basi.
      const current = readParam(locationSearch(), key, fallback);
      const resolved = typeof next === "function" ? next(current) : next;
      commit({ [key]: resolved === fallback ? "" : resolved }, options.history || history);
    },
    [key, fallback, history],
  );

  return [value, setValue];
}

/**
 * Rentang tanggal `{ from, to }`, satu parameter.
 *
 * `fallback` boleh berupa fungsi (mis. `currentMonthRange`) dan dipanggil sekali saja — dihitung
 * ulang tiap render, ia menghasilkan objek baru tiap kali, dan tiap `useMemo` yang bergantung pada
 * rentang ini (penyaring, penjumlah, tabel) ikut dihitung ulang selamanya.
 */
export function useUrlRange(key, fallback) {
  const search = useUrlSearch();
  const fallbackRef = useRef(null);
  if (fallbackRef.current === null) {
    fallbackRef.current = typeof fallback === "function" ? fallback() : fallback;
  }
  const base = fallbackRef.current;

  const raw = readParam(search, key, "");
  // Identitas objeknya ikut nilai teksnya, bukan tiap render — alasan yang sama dengan di atas.
  const value = useMemo(() => decodeRange(raw, base), [raw, base]);

  const setValue = useCallback(
    (next, options = {}) => {
      const current = decodeRange(readParam(locationSearch(), key, ""), base);
      const resolved = typeof next === "function" ? next(current) : next;
      commit({ [key]: encodeRange(resolved, base) }, options.history || "replace");
    },
    [key, base],
  );

  return [value, setValue];
}

/**
 * Peta filter `{ field: value }` untuk halaman yang jumlah filternya ditentukan konfigurasi
 * (ResourceList). Tiap field dapat parameternya sendiri berawalan `prefix`.
 */
export function useUrlRecord(prefix, fields) {
  const search = useUrlSearch();
  // `fields` datang dari konfigurasi resource dan identitasnya bisa berganti tiap render; yang
  // dijadikan dependensi adalah isinya.
  const fieldKey = fields.join("|");
  const list = useMemo(() => (fieldKey ? fieldKey.split("|") : []), [fieldKey]);
  const values = useMemo(() => readRecord(search, prefix, list), [search, prefix, list]);

  const setValues = useCallback(
    (next, options = {}) => {
      const current = readRecord(locationSearch(), prefix, list);
      const resolved = typeof next === "function" ? next(current) : next;
      commit(recordPatch(prefix, list, resolved), options.history || "replace");
    },
    [prefix, list],
  );

  return [values, setValues];
}
