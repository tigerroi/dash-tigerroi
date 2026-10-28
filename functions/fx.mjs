// Live daily USD-base FX rates from open.er-api.com (free, no API key, updates once/day).
//
// Kenapa ada sama sekali: earning GAM datang dalam mata uang network-nya, dan sebagian network
// menagih dalam USD sementara seluruh dashboard (spend Meta, saldo, ad tax) dalam IDR. Menjumlah
// atau membagi USD dengan IDR di satu baris ROI menghasilkan "-99,98%" untuk subdomain yang
// sebenarnya untung. Semua uang dinormalkan ke IDR di sisi sync lewat kurs ini; nilai asli + kurs
// ikut disimpan supaya tampilannya bisa tetap menampilkan USD.
//
// ponytail: tier gratis hanya kurs TERBARU (tanpa historis), jadi hari-hari backfill dikonversi
// dengan kurs hari ini, bukan kurs hari itu. Cukup untuk selisih harian; upgrade ke API historis
// hanya kalau akurasi kurs per-tanggal jadi masalah.
const ENDPOINT = "https://open.er-api.com/v6/latest/USD";
const FX_PATH = "dashboard/fxRates";

// Satu fetch per proses: syncSubdomains dan syncFinancials berjalan di proses yang sama dan tidak
// boleh menembak API dua kali untuk kurs yang sama.
let cache = null;
export function resetFxCache() {
  cache = null;
}

export async function fetchUsdRates(fetchImpl = fetch) {
  const res = await fetchImpl(ENDPOINT);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.result !== "success" || !data.rates?.IDR) {
    throw new Error(`FX open.er-api gagal: ${data["error-type"] || res.status}`);
  }
  return { rates: data.rates, asOf: data.time_last_update_utc || new Date().toISOString() };
}

// Kurs terbaru, dengan cadangan: kalau API gagal, pakai kurs terakhir yang tersimpan di RTDB alih-
// alih mengkorupsi angka. Kurs yang berhasil ikut ditulis balik sebagai cadangan run berikutnya.
export async function loadUsdRates(store, { fetchImpl = fetch } = {}) {
  if (cache) return cache;
  try {
    const fresh = await fetchUsdRates(fetchImpl);
    cache = { ...fresh, stale: false };
    if (store) {
      await store.update(FX_PATH, {
        USD: fresh.rates,
        asOf: fresh.asOf,
        source: "open.er-api.com",
      });
    }
  } catch (error) {
    const saved = store ? await store.read(FX_PATH) : null;
    if (!saved?.USD?.IDR) throw error;
    cache = { rates: saved.USD, asOf: saved.asOf || "", stale: true, error: error.message };
  }
  return cache;
}

// IDR per 1 unit `currency`, dari kurs berbasis USD. "IDR" -> 1. Tak dikenal -> null (pemanggil
// TIDAK boleh mengkonversi, biarkan apa adanya daripada mengarang angka).
export function idrPerUnit(rates, currency) {
  const cur = String(currency || "IDR").toUpperCase();
  if (cur === "IDR") return 1;
  const idr = Number(rates?.IDR);
  const base = Number(rates?.[cur]);
  if (!Number.isFinite(idr) || !Number.isFinite(base) || base === 0) return null;
  return idr / base;
}
