import { pathToFileURL } from "node:url";
import { connect } from "./db.mjs";
import { loadUsdRates } from "./fx.mjs";
import { fetchDailySpend } from "./meta.js";
import { asStore } from "./store.mjs";
import {
  adTaxRate,
  convertRowsToIdr,
  dateKeyFrom,
  earningAccounts,
  earningRowsByDimension,
  financialWindow,
  financialWrite,
  mergeFinancialSeries,
  resolveCurrencies,
  SYNC_ISSUES_PATH,
  syncIssuesUpdate,
} from "./sync-core.js";
import { loadUnreadableEarning, loadUnreadableSpend } from "./unreadable-spend.mjs";

// The Overview "Pendapatan vs Pengeluaran" chart: revenue per day from every earning account
// (GAM networks and standalone AdSense alike), spend per day from Meta, merged on the date. Both APIs keep history, so this backfills the whole window on every
// run rather than appending one point per sync — which is what made the chart's date-range
// filter useless when the series only ever held today.
//
//   node --env-file-if-exists=.env.sync sync-financials.mjs

/**
 * Note on scope: this is the **business-level** total, so spend is every ad account's spend,
 * not just the part attributable to a subdomain. The per-subdomain ROI table needs the
 * campaign -> subdomain map; this chart does not, and gating it on that map is what made it
 * plot a flat zero line while /ad-accounts plainly showed money going out.
 */
export async function syncFinancials(dbOrStore, metaToken = "", { unreadableRows = null } = {}) {
  const store = asStore(dbOrStore);
  const window = financialWindow();
  // Tarif yang sama dengan baris ROI, dibaca sekali per run: grafik dan tabel tidak boleh
  // melaporkan pengeluaran yang berbeda untuk hari yang sama.
  const rate = adTaxRate(await store.read("settings/roi"));
  const configs = (await store.read("googleApiConfigs")) || {};
  const adAccounts = (await store.read("adAccounts")) || {};
  // Kedua sumber earning masuk ke garis yang sama: grafik ini adalah pendapatan usaha, bukan
  // pendapatan Ad Manager. Akun AdSense yang tidak ikut terjumlah akan terbaca sebagai hari yang
  // pendapatannya turun, bukan sebagai sumber yang tidak dibaca.
  const gamAccounts = (await store.read("gamAccounts")) || {};
  const adsenseAccounts = (await store.read("adsenseAccounts")) || {};
  const accounts = earningAccounts(gamAccounts, adsenseAccounts);

  const issues = [];
  // Kurs USD->IDR: earning per network dinormalkan ke IDR sebelum dijumlah, kalau tidak grafik
  // menambahkan USD ke IDR jadi satu angka. Kurs dibaca dari cadangan RTDB saat API gagal.
  let rates = null;
  try {
    rates = (await loadUsdRates(store)).rates;
  } catch (error) {
    issues.push({
      source: "Kurs FX",
      target: "open.er-api.com",
      message: error.message,
      impact: "Pendapatan network USD tidak dikonversi ke IDR pada grafik Overview.",
    });
  }
  const currencyById = await resolveCurrencies(accounts, configs);

  const revenueByDate = new Map();
  const errors = [];
  // Sisi yang gagal dibaca sebagian tidak menimpa angka tersimpan — lihat `financialWrite`.
  let revenueComplete = true;
  let spendComplete = Boolean(metaToken);
  for (const { id: accountId, account, provider, label } of accounts) {
    const currency = currencyById.get(accountId) || "IDR";
    try {
      const rows = convertRowsToIdr(
        await earningRowsByDimension(account, configs, "DATE", window.gamRange),
        currency,
        rates,
      );
      for (const row of rows) {
        const date = dateKeyFrom(row.key);
        if (!date) continue;
        revenueByDate.set(date, (revenueByDate.get(date) || 0) + row.earning);
      }
    } catch (error) {
      revenueComplete = false;
      errors.push({ name: label, message: error.message });
      issues.push({
        source: provider === "adsense" ? "Riwayat pendapatan AdSense" : "Riwayat pendapatan GAM",
        target: label,
        message: error.message,
        impact: `Pendapatan ${window.since} s/d ${window.until} tidak ditulis ulang run ini — angka tersimpan dibiarkan.`,
        credential: account.googleCredential || "",
      });
    }
  }

  // Akun earning yang dimatikan dilewati loop di atas, dan tiga puluh hari yang ditulis ulang
  // kehilangan earning-nya — termasuk hari saat akun itu masih menayangkan iklan. Yang tersisa
  // darinya baris ROI subdomainnya; lihat `unreadableEarningDomains`.
  let restoredEarningDays = 0;
  try {
    const restored = await loadUnreadableEarning(store, {
      gamAccounts,
      adsenseAccounts,
      since: window.since,
      until: window.until,
    });
    for (const [date, earning] of restored) {
      revenueByDate.set(date, (revenueByDate.get(date) || 0) + earning);
    }
    restoredEarningDays = restored.size;
  } catch (error) {
    revenueComplete = false;
    errors.push({ name: "Earning akun nonaktif", message: error.message });
    issues.push({
      source: "Earning akun nonaktif",
      target: "dashboard/roiReports",
      message: error.message,
      impact:
        "Garis Pendapatan pada grafik Overview kehilangan akun GAM/AdSense yang sync-nya dimatikan.",
    });
  }

  const spendByDate = new Map();
  if (metaToken) {
    for (const account of Object.values(adAccounts)) {
      if (account?.deletedAt || account?.syncDisabled || !account?.actId) continue;
      try {
        const rows = await fetchDailySpend(account.actId, metaToken, window.since, window.until);
        for (const row of rows) {
          const date = dateKeyFrom(row.date);
          if (!date) continue;
          spendByDate.set(date, (spendByDate.get(date) || 0) + row.spend);
        }
      } catch (error) {
        const name = account.name || account.actId;
        spendComplete = false;
        errors.push({ name, message: error.message });
        issues.push({
          source: "Riwayat spend Meta",
          target: name,
          message: error.message,
          impact: "Pengeluaran tidak ditulis ulang run ini — angka tersimpan dibiarkan.",
        });
      }
    }
  }

  // Akun yang sync-nya dimatikan dilewati loop di atas, dan tiga puluh hari yang ditulis ulang tiap
  // run lalu kehilangan belanjanya — termasuk hari-hari saat akun itu masih terbaca dan uangnya
  // benar-benar keluar. Yang tersisa darinya adalah riwayat campaign-nya (`unreadableSpendRows`).
  // `syncSubdomains` sudah memuatnya untuk rentang ini; yang dipanggil sendiri memuatnya di sini.
  let restoredDays = 0;
  if (metaToken) {
    try {
      const rows =
        unreadableRows ||
        (await loadUnreadableSpend(store, {
          adAccounts,
          users: (await store.read("users")) || {},
          since: window.since,
          until: window.until,
        }));
      const days = new Set();
      for (const row of rows) {
        if (row.date < window.since || row.date > window.until) continue;
        spendByDate.set(row.date, (spendByDate.get(row.date) || 0) + row.spend);
        days.add(row.date);
      }
      restoredDays = days.size;
    } catch (error) {
      spendComplete = false;
      errors.push({ name: "Riwayat spend akun nonaktif", message: error.message });
      issues.push({
        source: "Riwayat spend akun nonaktif",
        target: "userReports/*/campaignHistory",
        message: error.message,
        impact:
          "Garis Pengeluaran pada grafik Overview kehilangan ad account yang sync-nya dimatikan.",
      });
    }
  }

  if (!metaToken) {
    issues.push({
      source: "Riwayat spend Meta",
      target: "META_ACCESS_TOKEN",
      message: "Token Meta kosong.",
      impact: "Grafik Overview hanya punya garis Pendapatan; Pengeluaran datar di nol.",
    });
  }

  const series = mergeFinancialSeries(revenueByDate, spendByDate, rate, window.running);
  for (const point of series) {
    await store.update(
      `dashboard/weeklyFinancials/${point.date}`,
      financialWrite(point, { revenueComplete, spendComplete }),
    );
  }

  // Drop points dated after the window — sekarang hanya tanggal masa depan, karena `window.until`
  // sudah mencakup hari berjalan. Titik hari berjalan sendiri ditulis dengan `partial: true` dan
  // digambar putus-putus: yang tidak boleh terjadi bukan menampilkannya, melainkan memasangkan
  // revenue kemarin dengan spend hari ini dalam satu titik. Titik lama dibiarkan: itu riwayat
  // nyata, dan jendelanya hanya sejauh mana isian ulang menjangkau ke belakang.
  const existing = (await store.read("dashboard/weeklyFinancials")) || {};
  let pruned = 0;
  for (const key of Object.keys(existing)) {
    if (key > window.until) {
      await store.update("dashboard/weeklyFinancials", { [key]: null });
      pruned++;
    }
  }

  await store.replace(
    `${SYNC_ISSUES_PATH}/financials`,
    syncIssuesUpdate("Grafik Overview", issues),
  );

  const summary =
    `${series.length} hari terisi (${window.since} s/d ${window.until}).` +
    (window.running ? ` Titik ${window.running} masih berjalan (partial).` : "") +
    (pruned ? ` ${pruned} titik bertanggal masa depan dibuang.` : "") +
    (restoredDays ? ` ${restoredDays} hari memuat spend dari riwayat ad account nonaktif.` : "") +
    (restoredEarningDays
      ? ` ${restoredEarningDays} hari memuat earning dari baris ROI akun GAM/AdSense nonaktif.`
      : "") +
    (metaToken ? "" : " META_ACCESS_TOKEN kosong, garis pengeluaran tidak diisi.") +
    (errors.length ? ` ${errors.length} sumber gagal dibaca.` : "") +
    (revenueComplete ? "" : " Pendapatan tidak ditulis ulang (ada akun yang gagal dibaca).") +
    (spendComplete || !metaToken
      ? ""
      : " Pengeluaran tidak ditulis ulang (ada ad account yang gagal dibaca).");
  return { days: series.length, pruned, window, errors, issues, summary };
}

// Dijalankan langsung sebagai CLI, atau diimpor sebagai modul?
//
// `file://${process.argv[1]}` benar di POSIX dan TIDAK PERNAH benar di Windows: argv[1] di sana
// berbentuk `D:\...\sync.mjs`, jadi ruas kanan jadi `file://D:\...` sementara `import.meta.url`
// berbunyi `file:///D:/...`. Yang terjadi bukan error melainkan DIAM — blok di bawah dilewati,
// tidak ada yang dikerjakan, dan prosesnya keluar dengan kode 0. Persis bentuk kegagalan yang
// paling mahal: `npm run sync:roi` tampak berhasil dan databasenya tidak berubah sedikit pun.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const db = await connect();
  const res = await syncFinancials(db, process.env.META_ACCESS_TOKEN);
  console.log(res.summary);
  for (const e of res.errors) console.error(`  ${e.name}: ${e.message}`);
  process.exit(res.errors.length ? 1 : 0);
}
