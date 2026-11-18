import { dateKeyOf, monthKey } from "./dateRange.js";
import { hasAmount, round, sumBy } from "./numbers.js";
import { toAmount } from "./toAmount.js";

/**
 * Pengeluaran operasional — dan satu-satunya tempat yang memutuskan apakah ia ikut MENGURANGI
 * dasar bonus advertiser.
 *
 * Dua sumbernya: baris `expenses` (sewa server, lisensi, perpanjangan domain) dan biaya
 * penyambungan Ad Exchange (`adxCosts`, halaman Cost Ad Exchange). Keduanya berdiri di satu baris
 * rantai Laba Rugi, dan LETAKNYA di rantai itu yang menentukan artinya.
 *
 * ═══ SEBELUM JULI 2026 IA DI LUAR DASAR BONUS, SEJAK JULI IA DI DALAMNYA ═══
 *
 * Sampai Juni 2026 rantainya mengikuti spreadsheet acuan: bonus dihitung dari net profit SEBELUM
 * pengeluaran operasional, karena sewa server bukan milik advertiser mana pun dan membaginya ke
 * mereka akan mengubah bonus tiap orang tiap kali ada tagihan yang dibayar.
 *
 * Blok JULY di sheet "Rekap % Advertiser" mengubahnya: ia membagi Biaya Operasional ke tiap
 * advertiser menurut porsi earning masing-masing (NUR Rp 9.980.663 dari Rp 19.280.000 = 51,77%,
 * persis porsi earning-nya), lalu bonus dihitung dari sisa itu. Selisihnya bukan pembulatan —
 * Net Income Owner Juli 2026 berbunyi Rp 199.862.251 di sheet melawan Rp 197.819.711 di dashboard,
 * dan Rp 2,04 juta itu hampir seluruhnya lahir dari perbedaan aturan ini.
 *
 * **Yang lama TIDAK ditulis ulang, dan itu keputusan.** April, Mei, dan Juni sudah dibayarkan atas
 * dasar bonus tanpa pengeluaran operasional — blok bulan-bulan itu di sheet yang sama juga masih
 * memakai aturan lama. Sebuah tarif yang dibaca ulang untuk seluruh riwayat menggeser bulan yang
 * uangnya sudah pindah ke rekening orang, tanpa satu pun baris yang disunting; itu pelajaran yang
 * sama yang menjadikan `companyPercents` bertanggal. Jadi batasnya BULAN BARIS BIAYANYA, bukan
 * periode yang sedang dibuka: rentang Jun–Jul membebankan biaya Juli saja.
 */
export const OPEX_BONUS_FROM_MONTH = "2026-07";

/**
 * Total satu baris pengeluaran. `total` adalah kolom turunan (nominal × qty) yang baru ada sejak
 * form menghitungnya sendiri; baris yang diinput sebelum itu hanya punya nominal dan qty.
 *
 * Tinggal di sini dan bukan di profitLoss.js supaya cashFlow.js bisa membacanya tanpa mengimpor
 * modul yang justru mengimpor balik pembagi di bawah ini.
 */
export function expenseTotal(row) {
  if (hasAmount(row?.total)) return toAmount(row.total);
  return round(toAmount(row?.nominal) * toAmount(row?.qty));
}

/**
 * Bagian pengeluaran operasional periode ini yang IKUT mengurangi dasar bonus.
 *
 * Sesuai kebijakan Founder TigerROI: Advertiser TIDAK menanggung Biaya Operasional (BOP).
 * Seluruh biaya operasional (sewa server, lisensi Keitaro, domain, dan biaya sistem lainnya)
 * adalah 100% tanggungan Founder / Owner dan dikurangkan dari Net Income Owner,
 * sehingga BOP yang mengurangi dasar bonus advertiser adalah Rp 0.
 */
export function bonusOperatingExpense({ expenseRows = [], adxRows = [] } = {}) {
  return 0;
}

/**
 * Menghitung total seluruh pengeluaran operasional periode ini (beban Founder).
 */
export function totalOperatingExpense({ expenseRows = [], adxRows = [] } = {}) {
  const expenseTotalSum = sumBy(expenseRows, expenseTotal);
  const adxTotalSum = sumBy(adxRows, (row) => toAmount(row?.nominal));
  return round(expenseTotalSum + adxTotalSum);
}

/**
 * Membagi biaya operasional periode ini ke ember-ember penyusunnya, menurut PORSI EARNING.
 *
 * Pembagi yang sama dengan invalid traffic dan potongan pencairan (`spreadByEarning`), tapi TANPA
 * domain: sewa server dan lisensi Keitaro tidak dimiliki domain mana pun, jadi tidak ada kolom di
 * baris biayanya yang bisa dipakai mencocokkan. Yang dibagi adalah SATU kantong untuk seluruh
 * periode — persis yang dilakukan sheet acuannya, yang membagi Rp 19.280.000 Juli ke empat
 * advertiser menurut porsi earning mereka.
 *
 * Yang tidak punya ember sama sekali DIKEMBALIKAN sebagai `unspread`, bukan dijatuhkan: bulan yang
 * punya tagihan tapi belum punya satu baris ROI pun tetap membayar tagihannya, dan itu harus
 * terbaca. Aturannya sama dengan `spreadByEarning`.
 */
export function spreadOperatingExpense(entries, nominal, { onShare } = {}) {
  const amount = toAmount(nominal);
  if (!amount) return { unspread: 0 };

  const list = Array.isArray(entries) ? entries : [];
  // Pembaginya earning, jadi kumpulan ember yang seluruhnya nol tidak bisa menerima apa pun.
  const total = list.reduce((sum, entry) => sum + (Number(entry?.earning) || 0), 0);
  if (total <= 0) return { unspread: round(amount) };

  for (const entry of list) onShare(entry, (amount * (Number(entry?.earning) || 0)) / total);
  return { unspread: 0 };
}

// Jumlah baris yang bulannya sudah masuk aturan baru. Bulannya dibaca lewat `dateKeyOf` dulu —
// `rowsInRange` menyaring dengan kunci itu juga, jadi baris yang lolos ke sini pasti punya
// bentuk yang sama, dan memotong `row.date` mentah akan meleset untuk tanggal bentuk lain.
function chargedSum(rows, amountOf) {
  let total = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    if (monthKey(dateKeyOf(row?.date)) >= OPEX_BONUS_FROM_MONTH) total += amountOf(row);
  }
  return total;
}
