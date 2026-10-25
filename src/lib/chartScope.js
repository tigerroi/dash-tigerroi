import { round } from "./numbers.js";
import { toAmount } from "./toAmount.js";

/**
 * Grafik Overview, Kalender, dan tabel ROI semuanya membaca baris ROI (`dashboard/roiReports`) —
 * pendapatan yang tahu subdomain dan PIC-nya, cara hitung yang sama dengan sheet acuan tim. Saklar
 * Lingkup yang dulu bisa memindahkan grafik ke total usaha (`weeklyFinancials`) dibuang 24 Sep 2026:
 * dua angka yang sama-sama benar untuk bulan yang sama cuma membingungkan pembacanya. Total usaha
 * tinggal dibaca Laba Rugi, dan selisih keduanya disebut lewat `monthCoverage` di bawah.
 */

/**
 * Selisih cakupan sebulan: pendapatan usaha dikurangi pendapatan yang punya baris ROI.
 *
 * Ini angka yang membuat perbedaan Kalender vs Pendapatan Laba Rugi bisa DIKEJAR alih-alih dihafal. Sebabnya
 * selalu sama — subdomain yang belum terdaftar, campaign yang belum dipetakan, atau situs di
 * laporan GAM/AdSense yang namanya tidak cocok dengan `subDomains.name` — dan begitu selisihnya
 * nol, kedua tab menyebut angka yang sama tanpa satu baris kode pun berubah.
 *
 * `null` (tidak digambar) untuk tiga keadaan yang sama-sama bukan kabar:
 *   - bulan yang tidak dijangkau `weeklyFinancials` sama sekali (riwayat harian jauh lebih panjang
 *     daripada jendela isian ulang grafik) — nol di sana berarti "tidak ada yang membacanya",
 *     bukan "tidak ada uang";
 *   - earning kalender yang tidak diketahui, karena tidak ada yang bisa dikurangkan darinya;
 *   - selisih di bawah 1% dari pendapatan usaha, ambang yang sama dengan catatan `coverageGap` di
 *     Laba Rugi: pembulatan dua desimal di kedua sisi selalu menyisakan beberapa rupiah, dan
 *     peringatan yang menyala untuk itu berhenti dibaca sebelum sempat berguna.
 */
export function monthCoverage(points, monthKey, coveredEarning) {
  if (!monthKey) return null;
  if (coveredEarning === "" || coveredEarning === null || coveredEarning === undefined) return null;

  let business = 0;
  let found = false;
  for (const item of Array.isArray(points) ? points : []) {
    const date = String(item?.date || item?.periodDate || "");
    if (!date.startsWith(monthKey)) continue;
    business += toAmount(item?.grossRevenue);
    found = true;
  }
  if (!found) return null;

  const gap = round(business - toAmount(coveredEarning));
  if (!(gap > business * 0.01)) return null;

  return { business: round(business), gap };
}
