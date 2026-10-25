/**
 * Pencarian, filter, dan rentang tanggal tinggal di QUERY, bukan hanya di `useState` komponennya.
 *
 * Alasannya satu: keadaan yang tidak ada di alamat tidak bisa dikembalikan. Admin yang mencari
 * "masse" di /plugin lalu membuka satu situs kehilangan pencariannya begitu ia menekan Back atau
 * "Semua situs" — komponen daftarnya dibuang beserta `useState`-nya, dan yang kembali adalah
 * seluruh armada. Ditulis ke query, alamat yang sama menghasilkan tabel yang sama: Back bekerja,
 * refresh bekerja, dan tautannya bisa dikirim ke orang lain.
 *
 * Yang di sini murni teks — tidak menyentuh `window` sama sekali, supaya bisa diuji sendiri.
 * Yang menyambungkannya ke bilah alamat adalah `src/hooks/useUrlState.js`.
 */

// Rentang tanggal jadi SATU parameter (`?tanggal=2026-08-01..2026-08-19`), bukan dua. Dengan dua
// parameter, rentang yang kedua sisinya kosong ("semua tanggal") tidak bisa dibedakan dari rentang
// yang belum pernah disentuh — dan keduanya berarti hal yang berbeda: yang pertama pilihan orang,
// yang kedua bawaan halaman (mis. bulan berjalan di Expenses).
const RANGE_SEPARATOR = "..";

export function readParam(search, key, fallback = "") {
  const value = new URLSearchParams(search).get(key);
  return value === null ? fallback : value;
}

/**
 * Query baru dari query sekarang plus perubahannya. Nilai kosong (`""`, `null`, `undefined`)
 * MENGHAPUS parameternya, bukan menulis `?q=` — alamat yang penuh parameter kosong tidak bisa
 * dibaca orang, dan "kembali ke bawaan" memang berarti tidak menyebut apa-apa.
 *
 * Parameter yang tidak disebut di `patch` dibiarkan apa adanya: satu halaman punya beberapa filter,
 * dan mengganti pencarian tidak boleh membuang pilihan periode di sebelahnya.
 */
export function writeParams(search, patch) {
  const params = new URLSearchParams(search);
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined || value === "") {
      params.delete(key);
    } else {
      params.set(key, String(value));
    }
  }

  const query = params.toString();
  return query ? `?${query}` : "";
}

export function encodeRange(range, fallback) {
  const from = range?.from || "";
  const to = range?.to || "";
  if (from === (fallback?.from || "") && to === (fallback?.to || "")) {
    return "";
  }

  return `${from}${RANGE_SEPARATOR}${to}`;
}

export function decodeRange(value, fallback = { from: "", to: "" }) {
  if (!value) {
    return fallback;
  }

  const [from = "", to = ""] = value.split(RANGE_SEPARATOR);
  return { from, to };
}

/**
 * Filter dropdown di ResourceList jumlahnya ditentukan konfigurasi tiap resource, jadi tiap field
 * dapat parameternya sendiri berawalan `f_` — bukan satu parameter berisi seluruh peta. Satu
 * parameter gabungan berarti nilai yang mengandung pemisahnya (nama domain, nama campaign) memecah
 * dirinya sendiri jadi dua filter.
 */
export function readRecord(search, prefix, fields) {
  const params = new URLSearchParams(search);
  const values = {};
  for (const field of fields) {
    const value = params.get(prefix + field);
    if (value) {
      values[field] = value;
    }
  }

  return values;
}

export function recordPatch(prefix, fields, values) {
  const patch = {};
  for (const field of fields) {
    patch[prefix + field] = values?.[field] ?? "";
  }

  return patch;
}
