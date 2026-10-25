import { roiPercent } from "./adTax.js";
import { round } from "./numbers.js";
import { buildSpendingPlan, NO_PIC } from "./spendingPlan.js";
import { toAmount } from "./toAmount.js";

/**
 * Tabel "ROI Founder" di Overview → Ringkasan: satu baris per advertiser untuk satu rentang tanggal.
 *
 * ```
 * Profit Advertiser      = ER − ST                  ST = spend + ad tax
 * Profit Founder         = ER − TU                  TU = total top-up whitelist
 * ROI Overall Advertiser = (ER − ST) ÷ ST × 100
 * ROI Overall Founder    = (ER − TU) ÷ TU × 100
 * ```
 *
 * Diurutkan menurut Profit Founder tertinggi. Profit TIDAK ikut lantai `MIN_ROI_SPEND` seperti
 * ROI-nya: earning dikurangi modal tetap uang yang nyata berapa pun kecil pembaginya, jadi
 * advertiser tanpa top-up berprofit founder sebesar earning-nya sendiri.
 *
 * Angka uangnya TIDAK dihitung ulang di sini: top-up per PIC, belanja, earning, dan sisa saldo
 * dibaca dari `buildSpendingPlan` — modul yang sama dengan Proyeksi Budget, termasuk aturan PIC
 * top-up (kolom PIC tersimpan dulu, pemetaan akun sebagai cadangan) dan pembuangan hari berjalan.
 * Disalin, satu advertiser akan berbunyi dua top-up berbeda di dua halaman.
 *
 * Yang berbeda cuma RUMUS ROI-nya, dan itu disengaja: di sini bentuknya `roiPercent` milik seluruh
 * dashboard (laba ÷ modal, 0% = impas), bukan "earning ÷ pembagi" milik Proyeksi Budget. Lantainya
 * sama — pembagi di bawah `MIN_ROI_SPEND` tidak punya ROI (`""`), bukan 0%.
 *
 * Sisa saldo adalah keadaan HARI INI (`adAccounts.balance`), bukan akhir bulan yang dipilih: tidak
 * ada riwayat saldo per advertiser yang bisa dibaca untuk bulan lampau.
 */
export function buildFounderRoi({
  roiReports = [],
  whitelistTopup = [],
  adAccounts = [],
  users = [],
  range = {},
  rate = 0,
} = {}) {
  const plan = buildSpendingPlan({ roiReports, whitelistTopup, adAccounts, users, range, rate });

  const rows = plan.rows.map((row) => withRoi(row, row.key));
  rows.sort(byFounderProfit);

  return {
    rows,
    firstDay: plan.firstDay,
    lastDay: plan.lastDay,
    totals: withRoi(plan.totals, ""),
  };
}

function withRoi(source, key) {
  const earning = source.earning;
  const totalSpending = source.totalSpending;
  const topup = source.topup;
  return {
    key,
    name: source.name,
    topup,
    totalSpending,
    balance: source.balance,
    earning,
    profitAdvertiser: earning === "" || totalSpending === "" ? "" : round(earning - totalSpending),
    profitFounder: earning === "" ? "" : round(earning - toAmount(topup)),
    // Earning yang tidak diketahui tidak menghasilkan ROI apa pun: `"" - x` adalah −x, dan itu
    // akan terbaca sebagai rugi total.
    roiAdvertiser: earning === "" || totalSpending === "" ? "" : roiPercent(earning, totalSpending),
    roiFounder: earning === "" ? "" : roiPercent(earning, topup),
  };
}

// Profit Founder tertinggi dulu. Yang profitnya tidak diketahui (earning kosong) di bawah, dan
// "(tanpa PIC)" paling bawah — tidak ada orang yang bisa diurutkan di sana.
function byFounderProfit(a, b) {
  const rank = (row) => (row.key === NO_PIC ? 2 : row.profitFounder === "" ? 1 : 0);
  const diff = rank(a) - rank(b);
  if (diff) return diff;
  if (a.profitFounder !== "" && b.profitFounder !== "" && a.profitFounder !== b.profitFounder) {
    return b.profitFounder - a.profitFounder;
  }
  return String(a.name).localeCompare(String(b.name));
}
