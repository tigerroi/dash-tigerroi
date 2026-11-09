import { roiPercent, withAdTax } from "./adTax.js";
import { filterByDateWindow, isRunningRow, runningDayKey } from "./dateRange.js";
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
    // Mode Whitelist Account: satukan metrik per akun ads WL (BD Q 07, BD R 16, dsb.)
    const rawAccounts = Array.isArray(adAccounts) ? adAccounts.filter((a) => !a.syncDisabled) : [];
    const accounts = rawAccounts.length > 0 ? [...rawAccounts] : [{ id: "wl", name: "BD R 16" }];

    // Urutkan akun berdasarkan nama (misal BD Q 07 dulu, lalu BD R 16)
    accounts.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));

    // Petakan campaign subdomain ke akun iklan berdasarkan users armada
    const accountBySubdomain = new Map();
    for (const u of Array.isArray(users) ? users : []) {
      for (const c of Array.isArray(u?.campaigns) ? u.campaigns : []) {
        const sub = String(c?.subDomain || c?.subdomain || "").trim().toLowerCase();
        const accName = String(c?.account || c?.adAccount || "").trim();
        if (sub && accName) {
          accountBySubdomain.set(sub, accName);
          const slug = sub.split(".")[0];
          if (slug) accountBySubdomain.set(slug, accName);
        }
      }
    }

    // Ambil topup dalam rentang
    const topupList = Array.isArray(whitelistTopup)
      ? whitelistTopup
      : Object.values(whitelistTopup || {});
    const topupsInRange = filterByDateWindow(topupList, range);

    // Ambil reports dalam rentang
    const reportList = Array.isArray(roiReports) ? roiReports : Object.values(roiReports || {});
    const runningDay = runningDayKey(reportList);
    const reportsInRange = filterByDateWindow(reportList, range).filter(
      (row) => !isRunningRow(row, runningDay),
    );

    // Jika hanya ada 1 akun: tetapkan seluruh total ke 1 akun tersebut (kompatibilitas historis)
    if (accounts.length === 1) {
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

      const cap = Number(primaryAccount.spendCap ?? primaryAccount.spend_cap ?? 0);
      const spent = Number(primaryAccount.amountSpent ?? primaryAccount.amount_spent ?? 0);
      let totalBalance =
        cap > 0 ? Math.max(0, Math.round((cap - spent) * 100) / 100) : Number(primaryAccount.balance || 0);
      if (totalBalance === 0 && plan.totals.balance) totalBalance = plan.totals.balance;

      let totalTopup = 0;
      for (const t of topupsInRange) {
        totalTopup += toAmount(t?.nominal ?? t?.amount ?? t?.topup ?? 0);
      }
      if (totalTopup === 0 && plan.totals.topup) totalTopup = plan.totals.topup;

      const earnVal = toAmount(plan.totals.earning);
      const spendVal = toAmount(plan.totals.totalSpending);
      const topupVal = toAmount(totalTopup);

      let roiFounder = "";
      if (
        plan.totals.earning !== "" &&
        plan.totals.earning !== null &&
        plan.totals.earning !== undefined
      ) {
        if (topupVal >= 1000) {
          roiFounder = round(((earnVal - topupVal) / topupVal) * 100);
        } else if (spendVal >= 1000) {
          roiFounder = round(((earnVal - spendVal) / spendVal) * 100);
        }
      }

      const accountRow = {
        key: String(primaryAccount.id || primaryAccount.name || "bd_r_16")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "_"),
        name: accountName,
        topup: topupVal,
        totalSpending: spendVal,
        balance: totalBalance,
        earning: earnVal,
        profitAdvertiser:
          plan.totals.earning === "" || plan.totals.totalSpending === ""
            ? ""
            : round(earnVal - spendVal),
        profitFounder: plan.totals.earning === "" ? "" : round(earnVal - topupVal),
        roiAdvertiser:
          plan.totals.earning === "" || plan.totals.totalSpending === ""
            ? ""
            : roiPercent(plan.totals.earning, plan.totals.totalSpending),
        roiFounder,
      };

      return {
        rows: [accountRow],
        firstDay: plan.firstDay,
        lastDay: plan.lastDay,
        totals: accountRow,
      };
    }

    // Jika ada lebih dari 1 akun (misal BD Q 07 dan BD R 16):
    const accountBuckets = new Map();
    for (const acc of accounts) {
      const accKey = String(acc.id || acc.name)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_");
      const cap = Number(acc.spendCap ?? acc.spend_cap ?? 0);
      const spent = Number(acc.amountSpent ?? acc.amount_spent ?? 0);
      const balance =
        cap > 0 ? Math.max(0, Math.round((cap - spent) * 100) / 100) : Number(acc.balance || 0);

      accountBuckets.set(accKey, {
        key: accKey,
        name: acc.name || "Akun Ads",
        account: acc,
        balance,
        topup: 0,
        spending: 0,
        totalSpending: 0,
        earning: 0,
        hasEarning: false,
        hasSpending: false,
      });
    }

    // Fungsi penolong mencocokkan nama akun
    const matchAccount = (rawStr) => {
      const s = String(rawStr || "")
        .trim()
        .toLowerCase();
      if (!s) return null;
      for (const [key, b] of accountBuckets.entries()) {
        const nameLower = b.name.toLowerCase();
        const actId = String(b.account?.actId || b.account?.act_id || "").toLowerCase();
        if (s.includes(nameLower)) return key;
        if (actId && s.includes(actId.replace("act_", ""))) return key;
        const compactName = nameLower.replace(/\s+/g, "");
        const compactS = s.replace(/\s+/g, "");
        if (compactS.includes(compactName)) return key;
      }
      return null;
    };

    // Cari akun default terdahulu (BD R 16) untuk baris historis yang belum menyebut nama akun
    const defaultAccKey =
      [...accountBuckets.keys()].find((k) => k.includes("r_16") || k.includes("r16")) ||
      [...accountBuckets.keys()][0];

    // Distribusikan Top-Up
    for (const t of topupsInRange) {
      const rawAcc =
        t?.namaKode ||
        t?.nama_kode ||
        t?.namaAkun ||
        t?.account_code ||
        t?.name ||
        t?.nama ||
        t?.account ||
        "";
      const matchedKey = matchAccount(rawAcc) || defaultAccKey;
      const bucket = accountBuckets.get(matchedKey);
      if (bucket) {
        bucket.topup += toAmount(t?.nominal ?? t?.amount ?? t?.topup ?? 0);
      }
    }

    // Distribusikan Spending & Earning
    for (const r of reportsInRange) {
      const sub = String(r.subDomain || r.sub_domain || r.subdomain || r.site_code || "")
        .trim()
        .toLowerCase();
      const rawAcc =
        r.account ||
        r.adAccount ||
        accountBySubdomain.get(sub) ||
        accountBySubdomain.get(sub.split(".")[0]) ||
        "";
      const matchedKey = matchAccount(rawAcc) || defaultAccKey;
      const bucket = accountBuckets.get(matchedKey);
      if (bucket) {
        const money = withAdTax(r, rate);
        if (money.earningKnown) {
          bucket.earning += toAmount(money.earning);
          bucket.hasEarning = true;
        }
        if (money.spendingKnown) {
          bucket.spending += toAmount(money.spending);
          bucket.totalSpending += toAmount(money.totalSpending);
          bucket.hasSpending = true;
        }
      }
    }

    // Bentuk baris-baris akun
    const rows = [];
    let totTopup = 0;
    let totSpending = 0;
    let totEarning = 0;
    let totBalance = 0;

    for (const b of accountBuckets.values()) {
      const earnVal = b.hasEarning ? b.earning : b.hasSpending ? 0 : "";
      const spendVal = b.hasSpending ? b.totalSpending : 0;
      const topupVal = b.topup;

      totTopup += topupVal;
      totSpending += spendVal;
      if (b.hasEarning) totEarning += b.earning;
      totBalance += b.balance;

      let roiFounder = "";
      if (earnVal !== "" && earnVal !== null && earnVal !== undefined) {
        if (topupVal >= 1000) {
          roiFounder = round(((earnVal - topupVal) / topupVal) * 100);
        } else if (spendVal >= 1000) {
          roiFounder = round(((earnVal - spendVal) / spendVal) * 100);
        }
      }

      rows.push({
        key: b.key,
        name: b.name,
        topup: topupVal,
        totalSpending: spendVal,
        balance: b.balance,
        earning: earnVal,
        profitAdvertiser: earnVal === "" || spendVal === "" ? "" : round(earnVal - spendVal),
        profitFounder: earnVal === "" ? "" : round(earnVal - topupVal),
        roiAdvertiser: earnVal === "" || spendVal === "" ? "" : roiPercent(earnVal, spendVal),
        roiFounder,
      });
    }

    // Hitung Totals
    let totRoiFounder = "";
    if (totTopup >= 1000) {
      totRoiFounder = round(((totEarning - totTopup) / totTopup) * 100);
    } else if (totSpending >= 1000) {
      totRoiFounder = round(((totEarning - totSpending) / totSpending) * 100);
    }

    const totalsRow = {
      key: "total",
      name: "Total",
      topup: totTopup,
      totalSpending: totSpending,
      balance: totBalance,
      earning: totEarning,
      profitAdvertiser: round(totEarning - totSpending),
      profitFounder: round(totEarning - totTopup),
      roiAdvertiser: roiPercent(totEarning, totSpending),
      roiFounder: totRoiFounder,
    };

    return {
      rows,
      firstDay: plan.firstDay,
      lastDay: plan.lastDay,
      totals: totalsRow,
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
