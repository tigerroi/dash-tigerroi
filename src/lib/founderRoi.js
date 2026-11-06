import { roiPercent } from "./adTax.js";
import { filterByDateWindow } from "./dateRange.js";
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
  mode = "account", // Default: "account" untuk menampilkan baris akun Whitelist (WL BD R 16) tanpa breakdown per PIC
} = {}) {
  const plan = buildSpendingPlan({ roiReports, whitelistTopup, adAccounts, users, range, rate });

  if (mode === "account") {
    // Mode Whitelist Account: satukan metrik ke akun ads WL, bukan dipecah per PIC
    const accounts = Array.isArray(adAccounts) ? adAccounts.filter((a) => !a.syncDisabled) : [];
    const primaryAccount = accounts[0];
    let accountName =
      primaryAccount?.name || primaryAccount?.accountName || primaryAccount?.nama || "BD R 16";
    if (
      !accountName ||
      accountName.includes(",") ||
      accountName.toLowerCase() === "semua user" ||
      accountName.toLowerCase().includes("superadmin")
    ) {
      accountName = "BD R 16";
    }

    let totalBalance = 0;
    for (const acc of accounts) {
      const cap = Number(acc.spendCap ?? acc.spend_cap ?? 0);
      const spent = Number(acc.amountSpent ?? acc.amount_spent ?? 0);
      const accBalance =
        cap > 0 ? Math.max(0, Math.round((cap - spent) * 100) / 100) : Number(acc.balance || 0);
      totalBalance += accBalance;
    }
    if (totalBalance === 0 && plan.totals.balance) {
      totalBalance = plan.totals.balance;
    }

    // Hitung seluruh topup whitelist di rentang tanggal
    const topupList = Array.isArray(whitelistTopup)
      ? whitelistTopup
      : Object.values(whitelistTopup || {});
    const topupsInRange = filterByDateWindow(topupList, range);
    let totalTopup = 0;
    for (const t of topupsInRange) {
      totalTopup += toAmount(t?.nominal ?? t?.amount ?? t?.topup ?? 0);
    }
    if (totalTopup === 0 && plan.totals.topup) {
      totalTopup = plan.totals.topup;
    }

    const earning = plan.totals.earning;
    const totalSpending = plan.totals.totalSpending;
    const topup = totalTopup;

    const earnVal = toAmount(earning);
    const spendVal = toAmount(totalSpending);
    const topupVal = toAmount(topup);

    let roiFounder = "";
    if (earning !== "" && earning !== null && earning !== undefined) {
      if (topupVal >= 1000) {
        roiFounder = round(((earnVal - topupVal) / topupVal) * 100);
      } else if (spendVal >= 1000) {
        roiFounder = round(((earnVal - spendVal) / spendVal) * 100);
      }
    }

    const accountRow = {
      key: "bd_r_16",
      name: accountName,
      topup: topupVal,
      totalSpending: spendVal,
      balance: totalBalance,
      earning: earnVal,
      profitAdvertiser:
        earning === "" || totalSpending === "" ? "" : round(earnVal - spendVal),
      profitFounder: earning === "" ? "" : round(earnVal - topupVal),
      roiAdvertiser:
        earning === "" || totalSpending === "" ? "" : roiPercent(earning, totalSpending),
      roiFounder,
    };

    return {
      rows: [accountRow],
      firstDay: plan.firstDay,
      lastDay: plan.lastDay,
      totals: accountRow,
    };
  }

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
  let name = source.name;
  if (
    name &&
    (name.includes(",") ||
      name.toLowerCase() === "semua user" ||
      name.toLowerCase().includes("mas def (superadmin), nurjaman") ||
      (name.toLowerCase().includes("superadmin") && name.toLowerCase().includes("nurjaman")))
  ) {
    name = "BD R 16";
  }

  return {
    key,
    name,
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
