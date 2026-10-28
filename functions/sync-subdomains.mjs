import { pathToFileURL } from "node:url";
import { connect } from "./db.mjs";
import { loadUsdRates } from "./fx.mjs";
import {
  fetchCampaignResultGoals,
  fetchCampaignSpend,
  fetchCampaignSpendByCountry,
} from "./meta.js";
import { collectSiteApprovals, fetchSiteApprovals, siteApprovalUpdates } from "./site-approval.js";
import { asStore } from "./store.mjs";
import {
  adsenseCountryDimensions,
  adTaxRate,
  buildCampaignResolver,
  collectCountryEarning,
  collectCountrySpend,
  convertRowsToIdr,
  countryDimensions,
  countryRoiByUser,
  dateDimension,
  earningAccounts,
  earningRowsByDimensions,
  expiredRoiReportKeys,
  expiredRoiSnapshotKeys,
  financialWindow,
  futureRoiReportKeys,
  gamRowsByDay,
  leftoverRunningIds,
  metaRowsByDay,
  normalizeName,
  previousRoiReport,
  previousRoiSnapshot,
  ROI_SNAPSHOTS_PATH,
  reportPeriod,
  resolveCurrencies,
  roiReportKey,
  roiReportPruneBefore,
  roiReportUpdate,
  roiReportWindowStart,
  roiSnapshotKey,
  roiSnapshotPruneBefore,
  roiSnapshotWindowStart,
  SYNC_ISSUES_PATH,
  subdomainUpdate,
  supersededRoiReportKeys,
  syncIssuesUpdate,
  userReportsPath,
  zonedClock,
} from "./sync-core.js";
import { syncFinancials } from "./sync-financials.mjs";
import { loadUnreadableSpend } from "./unreadable-spend.mjs";

// Sync ROI subdomain — satu implementasi untuk semua jalur (CLI, cron, dan
// callable di index.js). Yang membedakan pemanggilnya cuma SDK-nya, dan itu diurus `asStore`.
//
// Mengisi subDomains {revenueToday, ecpm, cpc} dari laporan GAM per site (dicocokkan ke
// subDomains.name), mengatribusikan spend Meta lewat pemetaan campaign -> subdomain, dan menulis
// dashboard/roiReports berkunci tanggal + subdomain.
//
// HARI YANG DILAPORKAN: hari yang sudah selesai (kemarin, Asia/Jakarta) DAN hari berjalan (hari
// ini), keduanya sama untuk GAM dan Meta. Yang dulu salah bukan menampilkan hari ini, melainkan
// mencampurnya: earning kemarin dipasangkan dengan spend `date_preset=today` di satu baris
// bertanggal hari ini. Sekarang tiap baris meminta satu hari yang sama ke kedua API, dan baris hari
// berjalan ditandai `partial: true` supaya tidak pernah dibaca sebagai angka final.
//
//   node sync-subdomains.mjs
export async function syncSubdomains(dbOrStore, { metaToken = "", dimension } = {}) {
  const store = asStore(dbOrStore);
  // "SITE" — the same dimension discovery imports subdomains from, so the names line up. Ad unit
  // names only carry hostnames when the network was set up that way; on an Ad Exchange network
  // they are "Ad Exchange Display" and nothing ever matches. Override per network if needed.
  const dim = dimension || process.env.GAM_SUBDOMAIN_DIMENSION || "SITE";
  const configs = (await store.read("googleApiConfigs")) || {};
  // Earning satu subdomain bisa datang dari network GAM atau dari akun AdSense berdiri sendiri —
  // yang membedakan hanya API yang ditanya, dan `earningRowsByDimensions` yang memilihnya.
  // Baris ROI-nya sendiri tidak boleh peduli: subdomain yang pindah monetisasi tidak berubah
  // artinya.
  const accounts = earningAccounts(
    (await store.read("gamAccounts")) || {},
    (await store.read("adsenseAccounts")) || {},
  );
  const adAccounts = (await store.read("adAccounts")) || {};
  const users = (await store.read("users")) || {};
  const subs = (await store.read("subDomains")) || {};
  // Tarif ad tax datang dari halaman Settings, dibaca sekali untuk seluruh run: satu tarif untuk
  // baris subdomain dan baris negara, jadi keduanya tidak pernah melaporkan ROI yang berbeda
  // untuk uang yang sama.
  const rate = adTaxRate(await store.read("settings/roi"));
  const now = new Date();
  // Dihitung sekali, dipakai semua permintaan: run yang melewati tengah malam tidak boleh
  // meminta hari yang berbeda ke network kelima daripada ke network pertama.
  const period = reportPeriod(now);

  const idByName = new Map();
  for (const [id, s] of Object.entries(subs)) {
    if (!s?.deletedAt && s?.name) idByName.set(normalizeName(s.name), id);
  }

  // Kegagalan yang tidak menjatuhkan run, tapi juga tidak boleh diam-diam. Dikumpulkan di sini,
  // ditulis ke dashboard/syncIssues di akhir, dan itulah yang dibaca ikon alert di topbar.
  const issues = [];

  // Kurs USD->IDR harian: earning GAM datang dalam mata uang network-nya, dan sebagian network
  // menagih dalam USD. Semua dinormalkan ke IDR sebelum dijumlah/dibagi. Gagal total tanpa
  // cadangan -> angka USD dibiarkan (tidak dikali), tapi isunya berbunyi keras di topbar.
  let rates = null;
  try {
    const fx = await loadUsdRates(store);
    rates = fx.rates;
    if (fx.stale) {
      issues.push({
        source: "Kurs FX",
        target: "open.er-api.com",
        message: fx.error || "kurs terbaru gagal diambil",
        impact: `Konversi USD->IDR memakai kurs tersimpan (${fx.asOf || "?"}), bukan kurs hari ini.`,
      });
    }
  } catch (e) {
    issues.push({
      source: "Kurs FX",
      target: "open.er-api.com",
      message: e.message,
      impact:
        "Earning network USD tidak dikonversi ke IDR — ROI dan totalnya salah sampai kurs tersedia.",
    });
  }
  // Mata uang tiap akun earning (network GAM lewat listNetworks, AdSense default IDR).
  const currencyById = await resolveCurrencies(accounts, configs);

  // --- Satu ember angka per hari yang dilaporkan -------------------------------------------------
  //
  // Laporan diminta sekali untuk seluruh rentang, lalu dipecah per hari ke ember-ember ini. Yang
  // dijaga di sini adalah aturan yang paling mudah dilanggar: angka satu hari tidak boleh bocor ke
  // hari lain, karena baris ROI-nya membagi earning hari itu dengan spend hari itu.
  const byDay = new Map();
  const dayBucket = (day) => {
    let bucket = byDay.get(day);
    if (!bucket) {
      bucket = {
        totals: new Map(), // subDomainId -> {earning, impressions, clicks}
        earningByCountry: new Map(), // subDomainId -> kunci negara -> {country, earning}
        spendBySub: new Map(), // subDomainId -> spend
        resultsBySub: new Map(), // subDomainId -> hasil (untuk CPR)
        campaignsBySub: new Map(), // subDomainId -> [{name, spend}] (rincian "Campaign digabung")
        spendByCountry: new Map(), // subDomainId -> kunci negara -> spend
        // Laporan earning yang gagal. Selama ini kegagalannya hanya `console.error` lalu
        // `continue`, dan barisnya tetap ditulis dengan earning 0 — kegagalan API yang menyamar
        // jadi "ROI -100%".
        gamComplete: true,
      };
      byDay.set(day, bucket);
    }
    return bucket;
  };
  // Tiap hari dalam rentang punya embernya sejak awal: hari yang tidak muncul di laporan mana pun
  // tetap harus melewati pemangkasan baris di bawah, bukan lolos karena embernya tidak ada.
  for (const day of period.keys) dayBucket(day);
  const knownDay = (day) => byDay.has(day);

  const unmatchedGam = new Set();
  const unmatchedCampaigns = new Set();
  const countryErrors = [];

  // --- Status persetujuan situs di sisi Google ---
  //
  // Dua daftar situs yang murah (bukan laporan: tidak ada create/run/poll), dan jawabannya
  // menjelaskan hal yang selama ini ditebak dari angka — domain yang belum atau tidak disetujui
  // memang tidak akan menghasilkan apa pun, dan itu tidak bisa dibedakan dari domain sehat yang
  // sedang sepi. Ditempelkan ke /domains, bukan /sub-domains: Google mereview di level domain
  // (lihat site-approval.js).
  const domains = (await store.read("domains")) || {};
  const approvalByHost = new Map();
  let approvalsComplete = true;
  for (const { account, provider, label } of accounts) {
    try {
      collectSiteApprovals(await fetchSiteApprovals(account, configs), approvalByHost);
    } catch (e) {
      console.error(`site list failed for ${label}: ${e.message}`);
      // Satu akun yang gagal dibaca tidak mengabarkan apa pun tentang situs di dalamnya, jadi
      // run ini kehilangan hak menyimpulkan "tidak terdaftar" untuk domain mana pun.
      approvalsComplete = false;
      issues.push({
        source: provider === "adsense" ? "Daftar situs AdSense" : "Daftar situs GAM",
        target: label,
        message: e.message,
        impact: "Kolom Persetujuan Google di halaman Domains tidak diperbarui dari akun ini.",
        credential: account.googleCredential || "",
      });
    }
  }
  let approvals = 0;
  for (const [id, update] of siteApprovalUpdates(domains, approvalByHost, approvalsComplete)) {
    await store.update(`domains/${id}`, update);
    approvals++;
  }

  // --- GAM earning per subdomain, per hari ---
  //
  // DATE sebagai dimensi pertama: satu laporan untuk seluruh rentang, dipecah per hari lewat
  // `gamRowsByDay`. Satu laporan per hari akan berarti create/run/poll/delete dua kali per network,
  // dan run penuh sudah menghabiskan menit dari batas 9 menit Cloud Functions.
  //
  // Laporan seluruh akun diminta BERSAMAAN, lalu diproses berurutan seperti sebelumnya. Satu per
  // satu, ~16 laporan yang masing-masing di-poll beberapa detik memakan ~2,5 menit, dan run penuh
  // melewati batas 540 detik Cloud Functions (23 Sep 2026): run yang dibunuh tidak menulis log
  // maupun `running: false`, jadi topbar menggantung di "Syncing... ROI" sampai run berikutnya.
  const countryDimsOf = (provider) =>
    provider === "adsense" ? adsenseCountryDimensions() : countryDimensions();
  const settled = (promise) =>
    promise.then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
  const unwrap = (result) => {
    if (result.error) throw result.error;
    return result.value;
  };
  const reports = await Promise.all(
    accounts.map(({ account, provider }) => {
      const countryDims = countryDimsOf(provider);
      return Promise.all([
        settled(earningRowsByDimensions(account, configs, [dateDimension(), dim], period.gamRange)),
        countryDims.length
          ? settled(
              earningRowsByDimensions(
                account,
                configs,
                [dateDimension(), dim, ...countryDims],
                period.gamRange,
              ),
            )
          : null,
      ]);
    }),
  );
  for (const [index, { id: accountId, account, provider, label }] of accounts.entries()) {
    const [siteReport, countryReport] = reports[index];
    // Mata uang network ini; baris laporannya dikonversi ke IDR tepat setelah diambil, sebelum
    // apa pun menjumlah atau membaginya.
    const currency = currencyById.get(accountId) || "IDR";
    let rows;
    try {
      rows = convertRowsToIdr(unwrap(siteReport), currency, rates);
    } catch (e) {
      console.error(`subdomain report failed for ${label}: ${e.message}`);
      // Laporannya menanggung seluruh rentang, jadi kegagalannya juga: tidak ada satu hari pun di
      // rentang ini yang earning-nya diketahui dari network ini.
      for (const day of period.keys) dayBucket(day).gamComplete = false;
      issues.push({
        source: provider === "adsense" ? "Laporan earning AdSense" : "Laporan earning GAM",
        target: label,
        message: e.message,
        credential: account.googleCredential || "",
        impact: `Earning ${period.since} s/d ${period.until} untuk subdomain di network ini tidak diperbarui — kolom Earning/ROI-nya "-", bukan 0.`,
      });
      continue;
    }
    for (const [day, dayRows] of gamRowsByDay(rows)) {
      if (!knownDay(day)) continue;
      const bucket = dayBucket(day);
      for (const row of dayRows) {
        const id = idByName.get(normalizeName(row.key));
        if (!id) {
          if (row.key) unmatchedGam.add(row.key);
          continue;
        }
        // Rincian per sumber ikut dijumlahkan, bukan cuma totalnya: satu subdomain bisa
        // muncul di beberapa baris laporan (beberapa site/ad unit), dan kolom "GAM" serta
        // "AdSense" di tabel ROI harus menjumlahkan hal yang sama dengan kolom Earning.
        const cur = bucket.totals.get(id) || {
          earning: 0,
          impressions: 0,
          clicks: 0,
          adx: 0,
          adsense: 0,
          adServer: 0,
        };
        cur.earning += row.earning;
        cur.impressions += row.impressions;
        cur.clicks += row.clicks;
        cur.adx += row.adx || 0;
        cur.adsense += row.adsense || 0;
        cur.adServer += row.adServer || 0;
        // Mata uang asli + kurs (satu network per subdomain, jadi konsisten) untuk tampilan UI.
        cur.currency = row.currency;
        cur.fxRate = row.fxRate;
        bucket.totals.set(id, cur);
      }
    }

    // Laporan kedua, tanggal × site × negara. Dimensinya bisa saja ditolak network tertentu, dan
    // itu tidak boleh menjatuhkan ROI subdomain yang angkanya sudah di tangan — kegagalannya
    // dilaporkan terpisah, seperti status/anggaran campaign di sync Meta. AdSense menolak site ×
    // negara ala GAM, jadi dimensinya lebih sedikit; daftar kosong = laporan dimatikan untuk
    // provider itu (lihat adsenseCountryDimensions) dan block ini dilewati tanpa jadi isu.
    if (!countryReport) continue;
    try {
      const countryRows = convertRowsToIdr(unwrap(countryReport), currency, rates);
      for (const [day, dayRows] of gamRowsByDay(countryRows)) {
        if (!knownDay(day)) continue;
        for (const site of collectCountryEarning(
          dayRows,
          idByName,
          dayBucket(day).earningByCountry,
        )) {
          unmatchedGam.add(site);
        }
      }
    } catch (e) {
      console.error(`country report failed for ${label}: ${e.message}`);
      countryErrors.push({ name: label, message: e.message });
      issues.push({
        source: provider === "adsense" ? "Laporan negara AdSense" : "Laporan negara GAM",
        target: label,
        message: e.message,
        impact: "Tabel ROI per Negara di Profile User tidak punya sisi earning untuk network ini.",
        credential: account.googleCredential || "",
      });
    }
  }

  // --- Meta spend per subdomain, per hari ---
  // Several campaigns routinely land on the same subdomain, so spend accumulates per subdomain
  // instead of overwriting: the last campaign read must not become the subdomain's whole spend.
  const { resolve, conflicts } = buildCampaignResolver(users, subs);
  // Apakah sisi Meta run ini utuh. Baris tanpa spend punya dua arti yang berlawanan — "subdomain
  // ini tidak diiklankan" dan "spend-nya tidak sempat diambil" — dan hanya run ini yang tahu yang
  // mana. Satu akun yang gagal sudah cukup: campaign subdomain mana pun bisa tinggal di sana.
  let metaComplete = Boolean(metaToken);
  const addSpendRows = (rows) => {
    for (const [day, dayRows] of metaRowsByDay(rows)) {
      if (!knownDay(day)) continue;
      const bucket = dayBucket(day);
      for (const { name, spend, results } of dayRows) {
        const { subDomain } = resolve(name);
        const id = subDomain && idByName.get(normalizeName(subDomain));
        if (!id) {
          if (name) unmatchedCampaigns.add(name);
          continue;
        }
        bucket.spendBySub.set(id, (bucket.spendBySub.get(id) || 0) + spend);
        bucket.resultsBySub.set(id, (bucket.resultsBySub.get(id) || 0) + (results || 0));
        bucket.campaignsBySub.set(id, [...(bucket.campaignsBySub.get(id) || []), { name, spend }]);
      }
    }
  };
  // Riwayat belanja akun yang tidak terbaca lagi, dimuat SEKALI untuk rentang terlebar yang
  // dibutuhkan run ini: baris ROI di bawah dan grafik usaha di `syncFinancials` (tiga puluh hari).
  // Lihat `unreadableSpendRows` untuk kenapa tanpanya hari-hari yang ditulis ulang kehilangan
  // belanja akun yang sudah dimatikan.
  const financeWindow = financialWindow(undefined, now);
  let unreadableRows = null;
  let restoredSpend = 0;
  if (metaToken) {
    try {
      unreadableRows = await loadUnreadableSpend(store, {
        adAccounts,
        users,
        since: financeWindow.since < period.since ? financeWindow.since : period.since,
        until: financeWindow.until > period.until ? financeWindow.until : period.until,
      });
      const inPeriod = unreadableRows.filter(
        (row) => row.date >= period.since && row.date <= period.until,
      );
      addSpendRows(inPeriod);
      restoredSpend = inPeriod.length;
    } catch (e) {
      console.error(`unreadable account history failed: ${e.message}`);
      // Tanpa riwayatnya, belanja akun yang dimatikan tidak diketahui run ini — dan itu persis
      // keadaan yang `metaComplete: false` ada untuk mengatakannya.
      metaComplete = false;
      issues.push({
        source: "Riwayat spend akun nonaktif",
        target: "userReports/*/campaignHistory",
        message: e.message,
        impact: `Spend ${period.since} s/d ${period.until} dari ad account yang sync-nya dimatikan tidak diketahui — kolom Spending subdomainnya "-", bukan 0.`,
      });
    }
  }
  if (metaToken) {
    for (const acct of Object.values(adAccounts)) {
      if (acct?.deletedAt || acct?.syncDisabled || !acct?.actId) continue;
      const label = acct.name || acct.actId;
      // Tujuan optimasi ad set: yang menentukan apa yang dihitung sebagai "hasil", dan karena itu
      // kolom CPR baris ROI. Dibaca di sini juga supaya angkanya sama dengan tabel Kampanye di
      // /users/{uid} — dua halaman yang menampilkan hasil campaign yang sama tidak boleh memakai
      // dua definisi. Gagalnya tidak menjatuhkan spend-nya: hasil jatuh ke daftar cadangan.
      let goals = null;
      try {
        goals = await fetchCampaignResultGoals(acct.actId, metaToken);
      } catch (e) {
        console.error(`adset goals failed for ${acct.actId}: ${e.message}`);
      }
      let rows;
      try {
        rows = await fetchCampaignSpend(acct.actId, metaToken, period, goals);
      } catch (e) {
        console.error(`campaign spend failed for ${acct.actId}: ${e.message}`);
        metaComplete = false;
        issues.push({
          source: "Spend campaign Meta",
          target: label,
          message: e.message,
          impact: `Spend ${period.since} s/d ${period.until} dari akun ini tidak masuk ROI subdomain mana pun.`,
        });
        continue;
      }
      addSpendRows(rows);

      // Rincian negara diminta terpisah: satu campaign muncul sekali per negara di sini, jadi
      // angkanya tidak bisa dipakai untuk spend subdomain di atas tanpa menjumlahkannya lagi.
      try {
        const countryRows = await fetchCampaignSpendByCountry(acct.actId, metaToken, period);
        for (const [day, dayRows] of metaRowsByDay(countryRows)) {
          if (!knownDay(day)) continue;
          for (const name of collectCountrySpend(
            dayRows,
            resolve,
            idByName,
            dayBucket(day).spendByCountry,
          )) {
            unmatchedCampaigns.add(name);
          }
        }
      } catch (e) {
        console.error(`country spend failed for ${acct.actId}: ${e.message}`);
        countryErrors.push({ name: label, message: e.message });
        issues.push({
          source: "Spend negara Meta",
          target: label,
          message: e.message,
          impact: "Tabel ROI per Negara tidak punya sisi spend untuk akun ini.",
        });
      }
    }
  } else {
    issues.push({
      source: "Spend campaign Meta",
      target: "META_ACCESS_TOKEN",
      message: "Token Meta kosong, seluruh sisi spend dilewati.",
      impact: "Kolom Spending, Ad Tax, dan ROI di Overview tidak terisi sama sekali.",
    });
  }

  // --- Write subDomains + Overview roiReports (keyed by report day + subdomain id) ---
  //
  // JENDELA, bukan seluruh node. `dashboard/roiReports` tumbuh selamanya (Laba Rugi membaca
  // bulan-bulan lampau, jadi ia memang tidak dipangkas), sementara yang dipakai di bawah cuma baris
  // hari-hari run ini plus beberapa hari sebelumnya sebagai pembanding "Fluk.". Lihat
  // `roiReportWindowStart` untuk apa yang hilang di luar jendela — deltanya, bukan uangnya.
  const previousRows =
    (await store.readFrom("dashboard/roiReports", roiReportWindowStart(period))) || {};
  // Snapshot run-run sebelumnya: dipakai sebagai pembanding "Fluk." (selisih sejak sync terakhir)
  // dan sebagai earning bawaan kalau laporan GAM run ini gagal. Hari berjalan saja — itu satu-
  // satunya hari yang `previousRoiSnapshot` pernah cocokkan.
  const previousSnapshots =
    (await store.readFrom(ROI_SNAPSHOTS_PATH, roiSnapshotWindowStart(period))) || {};
  const balanceByPic = new Map();
  for (const account of Object.values(adAccounts)) {
    if (account?.deletedAt || !account?.userOwner) continue;
    const key = normalizeName(account.userOwner);
    balanceByPic.set(key, (balanceByPic.get(key) || 0) + Number(account.balance || 0));
  }

  const allIds = new Set();
  // Kunci baris sisa hari berjalan yang subdomainnya sudah tidak ada: `{kunci: false}`.
  const orphanPartials = {};
  let updated = 0;
  let missing = 0;
  let snapshots = 0;
  const snapshotWrites = {};
  // Urut dari hari paling awal: kolom "Fluk." tiap baris membaca baris hari sebelumnya, dan baris
  // itu harus sudah ada di `previousRows` bentuk yang benar sebelum hari berikutnya ditulis.
  for (const day of period.keys) {
    const bucket = dayBucket(day);
    const partial = Boolean(period.running) && day === period.running;
    const ids = new Set([...bucket.totals.keys(), ...bucket.spendBySub.keys()]);
    // Sisa hari berjalan: subdomain yang sempat ditulis saat hari ini masih berjalan tapi tidak
    // muncul di laporan final-nya. Ditulis ulang dari laporan yang sama dengan baris lain hari itu,
    // supaya tanda `partial`-nya lepas dan angka setengah harinya tidak berdiri sebagai angka final.
    // Yang subdomainnya sudah dihapus tidak punya `sub` untuk ditulis ulang — tandanya saja yang
    // dilepas, di bawah.
    const leftover = new Set();
    if (!partial) {
      for (const id of leftoverRunningIds(previousRows, day)) {
        if (ids.has(id)) continue;
        if (subs[id]) {
          leftover.add(id);
          ids.add(id);
        } else {
          orphanPartials[roiReportKey(id, day)] = false;
        }
      }
    }
    // Subdomain yang earning-nya tidak diketahui hari ini: tidak ada di laporan, DAN ada laporan
    // yang gagal. Kalau semua laporan berhasil, tidak muncul berarti benar-benar nol.
    bucket.unknownEarning = new Set();
    for (const id of ids) {
      allIds.add(id);
      const metrics =
        bucket.totals.get(id) ||
        (bucket.gamComplete
          ? { earning: 0, impressions: 0, clicks: 0, adx: 0, adsense: 0, adServer: 0 }
          : null);
      if (!metrics) {
        bucket.unknownEarning.add(id);
        missing++;
      }
      const spend = bucket.spendBySub.has(id) ? bucket.spendBySub.get(id) : undefined;
      const sub = subs[id];
      const key = roiReportKey(id, day);
      const report = roiReportUpdate(sub, metrics, spend, {
        now,
        day,
        partial,
        previous: previousRoiReport(previousRows, id, day),
        existing: previousRows[key],
        adTaxRate: rate,
        metaComplete,
        results: bucket.resultsBySub.get(id) || 0,
        campaigns: bucket.campaignsBySub.get(id),
        metaBalance: balanceByPic.get(normalizeName(sub?.pic)),
      });
      // Kolom Spending/CPR/ROI (Today) di tabel /sub-domains dibaca dari baris subdomain, bukan
      // roiReports — ambil dari `report` yang sama supaya uangnya satu rumus. null saat spend tak
      // teratribusi: update() menggabung, jadi tanpa penghapusan angka kemarin akan menempel.
      //
      // Hanya hari SELESAI yang mengisinya: kolom itu tidak punya tempat untuk menyebut hari mana
      // yang sedang ditampilkan, dan angka setengah hari di tabel tanpa tanggal adalah persis
      // kekeliruan yang membuat orang membandingkannya dengan laporan AdSense penuh.
      //
      // Sisa hari berjalan tidak ikut: ia tidak ada di laporan final, dan baris subdomainnya milik
      // hari selesai TERAKHIR — yang ditulis dari laporan, bukan dari ketiadaannya di hari lebih awal.
      if (!partial && !leftover.has(id)) {
        await store.update(`subDomains/${id}`, {
          ...subdomainUpdate(metrics),
          spending: report.spending ?? null,
          cpr: report.cpr ?? null,
          roi: report.roi ?? null,
        });
      }
      // Berkunci tanggal data + subdomain: sync berkali-kali sehari memperbarui baris hari itu, dan
      // hari-hari sebelumnya tinggal sebagai riwayat yang bisa disaring di tabel.
      await store.update(`dashboard/roiReports/${key}`, report);
      // Baris yang baru ditulis jadi pembanding "Fluk." hari berikutnya dalam run yang sama.
      previousRows[key] = report;
      updated++;

      // Satu baris lagi ke `dashboard/roiSnapshots`, berkunci tanggal + JAM: baris harian di atas
      // ditimpa tiap sync, snapshot ini tidak — itu yang membuat tabel "Laporan ROI Realtime"
      // memuat satu baris per sync dan bukan satu baris per hari.
      //
      // HANYA HARI BERJALAN. Hari yang sudah selesai tidak berubah lagi di antara dua sync, jadi
      // snapshot-nya akan jadi 24 salinan baris yang sama tiap hari; dan hari-hari backfill
      // (GAM_RANGE_DAYS) sudah lewat sama sekali — "jam sync" tidak berarti apa-apa untuk keduanya.
      // Angka finalnya tetap tinggal di `dashboard/roiReports`, satu baris per hari.
      if (partial) {
        // Pembanding "Fluk." baris snapshot adalah snapshot SEBELUMNYA di hari yang sama — selisih
        // sejak sync terakhir, bukan selisih terhadap kemarin seperti baris harian. Itu juga yang
        // dipakai sebagai earning bawaan waktu laporan GAM run ini gagal.
        const before = previousRoiSnapshot(previousSnapshots, id, day);
        const snapshotKey = roiSnapshotKey(id, day, now);
        const snapshot = roiReportUpdate(sub, metrics, spend, {
          now,
          day,
          partial,
          previous: before,
          existing: before,
          adTaxRate: rate,
          metaComplete,
          results: bucket.resultsBySub.get(id) || 0,
          campaigns: bucket.campaignsBySub.get(id),
          metaBalance: balanceByPic.get(normalizeName(sub?.pic)),
        });
        // Dikumpulkan, tidak ditulis satu per satu: seluruh snapshot satu run adalah satu keadaan
        // pada satu jam, dan menulisnya sekali membuat tabel tidak pernah memuat separuh sync.
        snapshotWrites[snapshotKey] = snapshot;
        previousSnapshots[snapshotKey] = snapshot;
        snapshots++;
      }
    }
  }

  // Riwayat yang lewat masa simpan, dan baris bentuk lama yang sudah digantikan baris bertanggal
  // hari ini — dibiarkan, yang lama akan tampil selamanya sebagai baris kedua untuk subdomain yang
  // sama, bertanggal hari terakhir ia ditulis dan tidak pernah diperbarui lagi.
  const removals = {};
  // Yang perlu dibuang ada di LUAR jendela di atas, jadi ia diminta terpisah — dan permintaannya
  // berbatas juga: normalnya ia menjawab kosong, dan itu memang yang diharapkan tiap jam.
  const stale = (await store.readBefore("dashboard/roiReports", roiReportPruneBefore(now))) || {};
  for (const key of expiredRoiReportKeys(stale, now)) removals[key] = null;
  for (const key of supersededRoiReportKeys(stale, allIds)) removals[key] = null;
  // Baris bertanggal setelah hari terakhir yang dilaporkan run ini: sisa run yang zonanya keliru,
  // dan baris hari berjalan yang tertinggal setelah SYNC_INCLUDE_TODAY dimatikan.
  for (const key of futureRoiReportKeys(previousRows, period.until)) removals[key] = null;
  if (Object.keys(removals).length) await store.update("dashboard/roiReports", removals);
  for (const [key, value] of Object.entries(orphanPartials)) {
    if (removals[key] === null) continue;
    await store.update(`dashboard/roiReports/${key}`, { partial: value });
  }

  // Snapshot run ini, plus yang lewat masa simpannya sendiri (ROI_SNAPSHOT_DAYS, default 3 hari) —
  // satu tulisan untuk keduanya. Masa simpannya jauh lebih pendek dari riwayat harian: satu hari
  // menulis satu baris per sync per subdomain, dan seluruh pohonnya ikut diunduh browser tiap
  // dashboard dibuka.
  const staleSnapshots =
    (await store.readBefore(ROI_SNAPSHOTS_PATH, roiSnapshotPruneBefore(now))) || {};
  for (const key of expiredRoiSnapshotKeys(staleSnapshots, now)) snapshotWrites[key] = null;
  if (Object.keys(snapshotWrites).length) await store.update(ROI_SNAPSHOTS_PATH, snapshotWrites);

  // --- ROI per negara ke userReports/{id}.countryRoi (panel "ROI per Negara" di Profile User) ---
  //
  // POHONNYA SENDIRI, bukan di bawah `users/{id}` (lihat `USER_REPORTS_PATH`), dan di sini itu
  // yang paling terasa: node ini 745 KB dan DITULIS ULANG UTUH tiap run, jadi selama ia tinggal
  // di `users` tiap tab yang dibiarkan terbuka menerima 745 KB delta per jam — untuk panel yang
  // cuma digambar di `/users/{id}`.
  //
  // `countryRoi` ditulis utuh, bukan digabung per kunci: isinya seluruhnya turunan run ini, jadi
  // menggabung akan meninggalkan negara yang kemarin ada dan hari ini sudah tidak dibelanjakan
  // lagi — baris basi yang tampak seperti data hari ini.
  //
  // Yang tidak punya baris sama sekali tidak disentuh: laporan negara yang gagal (dimensinya
  // ditolak, token Meta kosong) akan tampak persis seperti "tidak ada negara", dan menghapus
  // isinya karena itu berarti kegagalan sync mengosongkan panel orang.
  //
  // Kedua hari ditulis dalam satu objek — kuncinya bertanggal, jadi hari berjalan tidak menimpa
  // angka final kemarin, dan filter periode di panelnya punya lebih dari satu hari untuk disaring.
  const countryRowsByUser = new Map();
  const countryUnowned = new Set();
  for (const day of period.keys) {
    const bucket = dayBucket(day);
    const { entries, unowned } = countryRoiByUser(
      subs,
      users,
      bucket.earningByCountry,
      bucket.spendByCountry,
      {
        now,
        day,
        rate,
        unknownEarning: bucket.unknownEarning || new Set(),
        partial: Boolean(period.running) && day === period.running,
      },
    );
    for (const [userId, rows] of entries) {
      countryRowsByUser.set(userId, { ...(countryRowsByUser.get(userId) || {}), ...rows });
    }
    for (const name of unowned) countryUnowned.add(name);
  }
  let countryRows = 0;
  for (const [userId, rows] of countryRowsByUser) {
    await store.update(userReportsPath(userId), {
      countryRoi: rows,
      updatedAt: now.toISOString(),
      updatedBy: "sync-subdomains",
    });
    countryRows += Object.keys(rows).length;
  }

  // The Overview chart is a business-level total pulled straight from both APIs' history, not a
  // roll-up of the attributed rows above: spend that no campaign maps to a subdomain is still
  // spend, and gating the chart on that map is what made it plot zero while /ad-accounts showed
  // money going out.
  const financials = await syncFinancials(store, metaToken, { unreadableRows });

  // Ditulis walau kosong — cabang yang tidak pernah dibersihkan membuat ikon alert menyala
  // selamanya setelah satu kegagalan yang sudah pulih.
  await store.replace(`${SYNC_ISSUES_PATH}/roi`, syncIssuesUpdate("ROI subdomain", issues, now));

  const gam = [...unmatchedGam];
  const camp = [...unmatchedCampaigns];
  const unowned = [...countryUnowned];
  const summary =
    `${updated} baris ROI untuk ${period.keys.length} hari (${period.since} s/d ${period.until}).` +
    (period.running ? ` ${period.running} masih berjalan (partial).` : "") +
    (snapshots ? ` ${snapshots} snapshot realtime (jam ${zonedClock(now)}).` : "") +
    (missing ? ` ${missing} baris tanpa earning (laporan GAM gagal), tidak ditulis 0.` : "") +
    ` ${countryRows} baris ROI negara ke ${countryRowsByUser.size} user.` +
    (gam.length
      ? ` ${gam.length} nama GAM tak cocok: ${gam.slice(0, 3).join(", ")}${gam.length > 3 ? "…" : ""}.`
      : "") +
    (restoredSpend ? ` ${restoredSpend} baris spend dari riwayat ad account nonaktif.` : "") +
    (camp.length
      ? ` ${camp.length} campaign tak terpetakan: ${camp.slice(0, 3).join(", ")}${camp.length > 3 ? "…" : ""}.`
      : "") +
    (unowned.length
      ? ` ${unowned.length} subdomain tanpa PIC, ROI negaranya tidak punya halaman: ${unowned.slice(0, 3).join(", ")}.`
      : "") +
    (approvals ? ` ${approvals} domain diperbarui status persetujuan Google-nya.` : "") +
    (countryErrors.length
      ? ` Laporan negara gagal untuk ${countryErrors.length} akun: ${countryErrors[0].message}`
      : "") +
    (conflicts.length
      ? ` ${conflicts.length} kode campaign dipakai lebih dari satu subdomain: ${conflicts
          .map((c) => c.code)
          .slice(0, 3)
          .join(", ")}.`
      : "");
  return {
    reportDate: period.key,
    runningDate: period.running,
    reportDays: period.keys,
    updated,
    snapshots,
    missingEarning: missing,
    countryRows,
    countryUsers: countryRowsByUser.size,
    countryUnowned: unowned,
    countryErrors,
    siteApprovals: approvals,
    unmatchedGam: gam,
    unmatchedCampaigns: camp,
    codeConflicts: conflicts,
    issues,
    financials,
    summary: `${summary} ${financials.summary}`,
  };
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
  const res = await syncSubdomains(db, { metaToken: process.env.META_ACCESS_TOKEN });
  console.log(res.summary);
  for (const issue of res.issues)
    console.error(`  ! ${issue.source} — ${issue.target}: ${issue.message}`);
  process.exit(0);
}
