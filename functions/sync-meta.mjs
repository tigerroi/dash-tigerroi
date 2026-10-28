import { pathToFileURL } from "node:url";
import { endBefore, get, orderByKey, query, ref, update } from "firebase/database";
import { connect } from "./db.mjs";
import { fetchCampaignResultGoals, fetchCampaignSettings, fetchCampaignSpend } from "./meta.js";
import { asStore } from "./store.mjs";
import {
  accountKeys,
  accountKeysByOwner,
  advertiserSpendRows,
  balanceSnapshotEntry,
  buildCodeIndex,
  campaignHistoryEntries,
  campaignHistoryPruneBefore,
  campaignHistoryWindow,
  campaignRowBelongsTo,
  campaignStatusLabel,
  campaignStatusRefresh,
  costPerResult,
  dailySpendEntries,
  dailySpendPruneBefore,
  dashboardStatsFrom,
  excessSnapshotKeys,
  expiredCampaignHistoryKeys,
  expiredDailySpendKeys,
  latestSnapshotFor,
  matchCode,
  metaUpdate,
  missingCampaignExpired,
  missingCampaignRow,
  normalizeName,
  permanentAccountError,
  SYNC_ISSUES_PATH,
  syncIssuesUpdate,
  userReportsPath,
} from "./sync-core.js";

// CLI/cron Meta sync (client SDK). Buttons on the dashboard use the Cloud Function instead;
// this stays as an offline/cron fallback.
//
//   export META_ACCESS_TOKEN=...
//   node sync-meta.mjs                 # all ad accounts
//   node sync-meta.mjs <id1> <id2>     # only these adAccounts ids

export async function syncAdAccounts(db, token, only = []) {
  const accounts = (await get(ref(db, "adAccounts"))).val() || {};
  let ok = 0;
  // Which account failed and why — Meta's messages are the actionable part (a missing
  // ads_read grant reads very differently from a bad token), so pass them to the caller.
  const errors = [];
  // Akun yang gagal dengan izin dicabut/tidak diberikan — kandidat auto-disable. Baru ditulis
  // SESUDAH loop, dan hanya kalau `ok > 0`: kalau tidak ada satu pun akun yang berhasil, yang
  // bermasalah tokennya (semua akun akan berbunyi sama), bukan tiap akun satu per satu.
  const permanentlyFailed = [];
  for (const [id, account] of Object.entries(accounts)) {
    if (account?.deletedAt || account?.syncDisabled || !account?.actId) continue;
    if (only.length && !only.includes(id)) continue;
    try {
      await update(ref(db, `adAccounts/${id}`), await metaUpdate(account, token));
      console.log(`OK   ${account.name || id}`);
      ok++;
    } catch (error) {
      console.error(`FAIL ${account.name || id}: ${error.message}`);
      errors.push({ id, name: account.name || account.actId || id, message: error.message });
      if (permanentAccountError(error.message)) {
        permanentlyFailed.push({
          id,
          name: account.name || account.actId || id,
          message: error.message,
        });
      }
    }
  }
  if (ok > 0) {
    for (const acct of permanentlyFailed) {
      await update(ref(db, `adAccounts/${acct.id}`), {
        syncDisabled: "Nonaktif",
        syncDisabledReason: acct.message,
        syncDisabledAt: new Date().toISOString(),
      });
      console.warn(`AUTO-DISABLE ${acct.name}: izin Meta dicabut, sync akun ini dimatikan.`);
    }
  }
  console.log(`Done. ${ok} ok, ${errors.length} failed.`);
  // Alasan yang sama dengan syncAccounts: run sebagian tidak boleh menghapus isu akun lain.
  if (!only.length) {
    await asStore(db).replace(
      `${SYNC_ISSUES_PATH}/metaAccounts`,
      syncIssuesUpdate(
        "Akun Meta Ads",
        errors.map((error) => ({
          source: "Sync akun Meta",
          target: error.name,
          message: error.message,
          impact: "Saldo dan pengeluaran hari ini untuk akun ini tidak diperbarui.",
        })),
      ),
    );
  }
  return { ok, fail: errors.length, errors };
}

function toArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) : Object.values(value);
}

/**
 * Pull each ad account's campaigns into its owner's `users/{id}.campaigns[]`, which is where
 * `buildCampaignMap` looks when attributing Meta spend to a subdomain. Without this the list is
 * empty and every campaign reports as unmapped, so ROI can never be computed.
 *
 * The `subDomain` on each campaign is derived from the Keitaro code in its name against the codes
 * registered on each subdomain (`subDomains/{id}.campaignCodes`), so registering one code maps
 * every campaign carrying it at once. A mapping someone picked by hand carries `subDomainSource:
 * "manual"` and is never re-derived — including a deliberate blank, which would otherwise be
 * refilled by the code on the next sync.
 *
 * Rows for campaigns Meta no longer returns are kept: a fetch that failed, or a campaign paused
 * for a day, must not silently erase the mapping that makes ROI work. Dua yang tidak ikut
 * bertahan, keduanya karena bertahan berarti berbohong (lihat sync-core.js):
 *
 *   - baris milik ad account yang sudah bukan milik user ini — akun berpindah pemilik atau
 *     dihapus, dan campaign-nya ikut pindah bersamanya;
 *   - baris yang akunnya BERHASIL dibaca run ini tapi campaign-nya tidak ikut kembali — itu
 *     campaign yang diarsipkan atau dihapus di Meta, dan statusnya berhenti membeku di "Aktif".
 *
 * Sync ini juga satu-satunya penulis `userReports/{id}.dailySpend`, `.balanceSnapshots`, dan
 * `.campaignHistory` — riwayat yang dibaca tiga panel di Profile User. `adAccounts/{id}` hanya
 * menyimpan angka terakhir dan ditimpa tiap sync, jadi tanpa yang ditulis di sini tidak ada
 * rekaman saldo tadi berapa.
 *
 * Ketiganya tinggal di POHON SENDIRI, bukan di bawah `users/{id}` (lihat `USER_REPORTS_PATH`):
 * `users` dilanggan browser setiap akun pada setiap muat halaman, sementara riwayat ini cuma
 * dibaca layar yang benar-benar menggambarnya.
 */
export async function syncCampaigns(db, token, only = []) {
  const accounts = (await get(ref(db, "adAccounts"))).val() || {};
  const users = (await get(ref(db, "users"))).val() || {};
  const subDomains = (await get(ref(db, "subDomains"))).val() || {};
  const { byCode, conflicts } = buildCodeIndex(subDomains);
  // Nama campaign -> { subDomain, code }. Dipakai baris tabel Kampanye maupun riwayat spend per-hari,
  // supaya keduanya menyebut subdomain dan Kode Keitaro yang sama.
  const resolve = (name) => matchCode(name, byCode);
  // Satu stempel waktu untuk seluruh run: kunci snapshot diawali stempel itu, dan snapshot dari
  // sync yang sama harus berkumpul di satu titik waktu, bukan berpencar per akun.
  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  const userIdByName = new Map();
  for (const [id, user] of Object.entries(users)) {
    if (user && !user.deletedAt && user.name) userIdByName.set(normalizeName(user.name), id);
  }

  // Kepemilikan dibaca dari SELURUH adAccounts, bukan dari akun yang disync run ini: run yang
  // dibatasi ke satu akun tidak boleh menyimpulkan bahwa akun lain sudah bukan milik user itu.
  const keysByUser = accountKeysByOwner(accounts, userIdByName);

  const rowsByUser = new Map(); // userId -> campaign rows built this run
  const historyByUser = new Map(); // userId -> { dailySpend, snapshots } untuk run ini

  /**
   * Bacaan ke pohon riwayat, dengan sebabnya kalau ditolak.
   *
   * `userReports` node BARU: sebelum `npm run deploy:rules` jalan, RTDB menolak tiap bacaan ke sana
   * dan yang tercatat di log run cuma "Permission denied" — kalimat yang di repo ini jauh lebih
   * sering berarti SYNC_USER kehilangan role admin, jadi yang dicari orang adalah hal yang salah.
   * Tetap MELEMPAR: sync yang diam-diam menganggap riwayatnya kosong akan menulis baris yang tidak
   * bisa dibaca siapa pun, lalu memangkas dari daftar kosong dan berhenti membuang yang lama.
   */
  const readReports = async (path, boundedBy = null) => {
    try {
      const node = boundedBy
        ? query(ref(db, path), orderByKey(), endBefore(boundedBy))
        : ref(db, path);
      return (await get(node)).val() || {};
    } catch (error) {
      throw new Error(
        `${path} tidak terbaca: ${error.message} — kalau ini "Permission denied", jalankan ` +
          "`npm run deploy:rules` dulu: `userReports` node baru dan belum disebut database.rules.json.",
      );
    }
  };

  /**
   * Snapshot saldo milik satu user, dari pohon riwayatnya sendiri.
   *
   * Dibaca UTUH — `latestSnapshotFor` mencari yang terakhir dan `excessSnapshotKeys` menghitung
   * kelebihannya, dan keduanya butuh seluruh daftar. Itu tidak mahal karena `snapshotKeep()`
   * membatasinya di 60 baris per user (~11 KB); dua riwayat lain yang memang tumbuh diminta
   * berbatas di bawah.
   *
   * Di-cache per run: satu user memegang belasan ad account, dan membacanya di dalam loop akun
   * berarti belasan unduhan untuk node yang sama.
   */
  const snapshotsByUser = new Map();
  const snapshotsOf = async (userId) => {
    if (!snapshotsByUser.has(userId)) {
      snapshotsByUser.set(userId, await readReports(`${userReportsPath(userId)}/balanceSnapshots`));
    }
    return snapshotsByUser.get(userId);
  };

  // Kunci yang SUDAH lewat cutoff pemangkasan, diminta ke server alih-alih disaring sesudah
  // seluruh riwayat diunduh — sepola `readBefore` di store.mjs. Normalnya menjawab kosong.
  const staleBefore = (path, endKey) => readReports(path, endKey);
  // userId -> kunci ad account yang laporan campaign-nya benar-benar terbaca run ini. Hanya baris
  // milik akun di daftar ini yang boleh dinilai "sudah tidak ada di Meta"; akun yang gagal dibaca
  // tidak mengabarkan apa pun tentang campaign-nya.
  const scannedByUser = new Map();
  const errors = [];
  // Status/anggaran gagal diambil sendiri-sendiri: spend-nya sudah di tangan, jadi ini dilaporkan
  // terpisah dan tidak dihitung sebagai akun yang gagal disync.
  const settingsErrors = [];
  const unowned = [];
  for (const [accountId, account] of Object.entries(accounts)) {
    // `syncDisabled` — akun yang sengaja dimatikan (mis. disuspend Meta): dilewati tanpa
    // menyentuh jaringan, tapi TIDAK dibuang seperti `deletedAt`. Barisnya tetap milik pemilik
    // di `accountKeysByOwner` (yang tidak melewati `syncDisabled`), jadi campaign lamanya
    // membeku apa adanya, bukan tersapu jadi "foreign" atau "hilang dari Meta".
    if (account?.deletedAt || account?.syncDisabled || !account?.actId) continue;
    if (only.length && !only.includes(accountId)) continue;
    const ownerId = account.userOwner && userIdByName.get(normalizeName(account.userOwner));
    if (!ownerId) {
      unowned.push(account.name || account.actId);
      continue;
    }
    // Tujuan optimasi tiap ad set — itulah yang menentukan apa yang dihitung Ads Manager sebagai
    // "Hasil". Diambil sebelum insights supaya barisnya langsung membawa angka yang benar.
    //
    // Gagalnya tidak mematikan akun ini: tanpa peta tujuan, hasil jatuh ke daftar cadangan
    // (META_RESULT_ACTIONS) — angka yang lebih kasar, tapi kolomnya tetap terisi.
    let goals = null;
    try {
      goals = await fetchCampaignResultGoals(account.actId, token);
    } catch (error) {
      settingsErrors.push({
        id: accountId,
        name: account.name || account.actId,
        message: `tujuan optimasi ad set gagal diambil, kolom Hasil memakai daftar cadangan: ${error.message}`,
      });
    }
    let campaigns;
    try {
      campaigns = await fetchCampaignSpend(account.actId, token, undefined, goals);
    } catch (error) {
      errors.push({ id: accountId, name: account.name || account.actId, message: error.message });
      continue;
    }
    // Status dan anggaran harian tidak ada di insights. Kegagalannya tidak mematikan akun ini:
    // dua kolom kosong jauh lebih baik daripada campaign yang hilang seluruhnya dari tabel.
    let settings = [];
    try {
      settings = await fetchCampaignSettings(account.actId, token);
      // Daftar campaign-nya utuh: apa yang TIDAK ada di dalamnya boleh dibaca sebagai
      // "tidak ada lagi di Meta". Kalau panggilan ini gagal, akun ini tidak masuk daftar dan
      // baris-barisnya dibiarkan apa adanya.
      const scanned = scannedByUser.get(ownerId) || new Set();
      for (const key of accountKeys(account)) scanned.add(key);
      scannedByUser.set(ownerId, scanned);
    } catch (error) {
      settingsErrors.push({
        id: accountId,
        name: account.name || account.actId,
        message: error.message,
      });
    }

    const rows = rowsByUser.get(ownerId) || [];
    for (const { key, name, spend, setting } of mergeCampaignSources(campaigns, settings)) {
      const match = matchCode(name, byCode);
      rows.push({
        id: `${accountId}:${key}`,
        // ID campaign di Meta. Beda dari `id` di atas — yang itu kunci baris tabel, yang ini
        // alamat yang dipakai saklar on/off untuk menyebut campaign mana ke Meta. Baris tanpa
        // ID (nama yang hanya muncul di laporan lama) tidak bisa dinyalakan dari dashboard, dan
        // UI menonaktifkan tombolnya alih-alih menembakkan perintah yang pasti gagal.
        campaignId: settingOrSpendId(setting, spend),
        campaign: name,
        account: account.name || account.actId,
        actName: account.name || "",
        adAccount: account.actId,
        subDomain: match.subDomain,
        campaignCode: match.code,
        // Hasil = jumlah event yang DIOPTIMASI ad set campaign ini (lihat resultActionTypes di
        // meta.js), bukan tebakan dari daftar prioritas tetap. "kBCD-06 Pros Turki" dulu terbaca
        // 4.908 hasil @ Rp 19,46 — itu klik tautan — sementara Ads Manager menampilkan 2.449 @
        // Rp 39,01, yaitu ViewContent, event yang memang dioptimasi sepuluh ad set-nya.
        result: spend?.results ?? 0,
        // Event apa yang dihitung. Disimpan supaya kolom "Hasil" bisa menyebut isinya apa —
        // "2.449" tanpa keterangan tidak bisa dibedakan dari 2.449 lead.
        resultType: spend?.resultType || "",
        // Biaya per hasil versi META (`cost_per_action_type`), yang persis tertera di Ads Manager.
        // Dihitung sendiri (spend / hasil) hanya kalau Meta tidak mengirimkannya.
        costPerResult: spend?.costPerResult ?? costPerResult(spend?.spend, spend?.results),
        dailyBudget: setting?.dailyBudget ?? "",
        spendToday: spend?.spend ?? 0,
        spendDate: today,
        status: campaignStatusLabel(setting?.status, setting?.startTime, now),
        // Posisi saklarnya sendiri (ACTIVE/PAUSED). Label di atas diturunkan dari field yang SAMA
        // — ketiga nilainya sepakat dengan saklar — jadi yang membedakan keduanya tinggal
        // `startTime`: saklar On yang jadwalnya belum sampai berbunyi "Terjadwal", bukan "Aktif".
        configuredStatus: setting?.status || "",
        // Kapan campaign ini mulai tayang, apa adanya dari Meta. Yang membacanya kolom Status di
        // /users/{uid}, untuk menyebut tanggalnya di bawah pil "Terjadwal".
        startTime: setting?.startTime || "",
      });
    }
    rowsByUser.set(ownerId, rows);

    const history = historyByUser.get(ownerId) || {
      dailySpend: {},
      snapshots: {},
      campaignHistory: {},
    };
    for (const [key, row] of dailySpendEntries(accountId, account, campaigns, now)) {
      history.dailySpend[key] = row;
    }
    const [snapshotKey, snapshot] = balanceSnapshotEntry(
      accountId,
      account,
      latestSnapshotFor(await snapshotsOf(ownerId), accountId),
      now,
    );
    history.snapshots[snapshotKey] = snapshot;

    // Riwayat spend per-hari untuk tabel "Riwayat Spend Campaign": panggilan Meta TERPISAH dengan
    // rentang jendela terakhir (`time_increment=1` → satu baris per campaign per hari). Sengaja
    // tidak menumpang `campaigns` (hari ini) supaya dailySpend/snapshot tidak ikut berubah bentuk.
    // Gagalnya tidak mematikan akun ini — spend hari ini sudah tercatat di atas.
    try {
      const dayRows = await fetchCampaignSpend(
        account.actId,
        token,
        recentRange(now, campaignHistoryWindow()),
        goals,
      );
      for (const [key, row] of campaignHistoryEntries(accountId, account, dayRows, resolve, now)) {
        history.campaignHistory[key] = row;
      }
    } catch (error) {
      settingsErrors.push({
        id: accountId,
        name: account.name || account.actId,
        message: `riwayat spend campaign per-hari tidak terbaca: ${error.message}`,
      });
    }

    historyByUser.set(ownerId, history);
  }

  let updated = 0;
  let total = 0;
  let mappedByCode = 0;
  let spendRows = 0;
  let snapshotRows = 0;
  let campaignHistoryRows = 0;
  // Baris lama yang dibuang, dipisah karena sebabnya berbeda dan yang satu perlu diperiksa orang:
  // `foreign` berarti ad account-nya berpindah pemilik, `gone` berarti campaign-nya hilang dari
  // Meta dan sudah lewat masa simpannya.
  let foreignRows = 0;
  let goneRows = 0;
  const unmapped = [];
  for (const [userId, rows] of rowsByUser) {
    const existing = toArray(users[userId]?.campaigns);
    const ownedKeys = keysByUser.get(userId) || new Set();
    const scanned = scannedByUser.get(userId) || new Set();
    // Baris lama dicari lewat ID Meta dulu, baru namanya. Nama boleh berubah dan campaign yang
    // diganti namanya adalah campaign yang sama: dicocokkan lewat nama saja, pemetaan manualnya
    // hilang dan baris lamanya tinggal sebagai kembaran yang tidak pernah lagi diperbarui.
    const mapped = new Map();
    const mappedById = new Map();
    for (const row of existing) {
      if (!row?.campaign) continue;
      mapped.set(normalizeName(row.campaign), row);
      if (row.campaignId) mappedById.set(String(row.campaignId), row);
    }
    const fresh = rows.map((row) => {
      const previous =
        (row.campaignId && mappedById.get(String(row.campaignId))) ||
        mapped.get(normalizeName(row.campaign));
      // Rows saved before codes existed carry a subDomain and no source; the only way one could
      // have been set back then was by hand, so honour it as manual rather than overwriting it.
      const wasManual =
        previous?.subDomainSource === "manual" ||
        (previous?.subDomain && !previous.subDomainSource);
      if (wasManual) {
        return { ...row, subDomain: previous.subDomain || "", subDomainSource: "manual" };
      }
      if (row.subDomain) mappedByCode++;
      else unmapped.push(row.campaign);
      // `row` selalu segar dari Meta, jadi tanda `metaMissing` baris sebelumnya tidak ikut
      // terbawa — campaign yang dikeluarkan lagi dari arsip kembali sebagai baris biasa.
      return { ...row, subDomainSource: row.subDomain ? "code" : "" };
    });
    const seen = new Set(fresh.map((row) => normalizeName(row.campaign)));
    // ID-nya juga, dengan alasan yang sama: baris lama sebuah campaign yang diganti namanya sudah
    // digantikan oleh baris barunya, dan menahannya berarti satu campaign berdiri dua kali —
    // yang lama membeku selamanya karena namanya tidak akan pernah kembali dari Meta.
    const seenIds = new Set(fresh.map((row) => String(row.campaignId || "")).filter(Boolean));
    const kept = [];
    for (const row of existing) {
      if (!row?.campaign || seen.has(normalizeName(row.campaign))) continue;
      if (row.campaignId && seenIds.has(String(row.campaignId))) continue;
      // Ad account-nya sudah bukan milik user ini. Barisnya bukan data lama melainkan data orang
      // lain — 107 baris TBZ 1247 yang tinggal di profil Nurjaman setelah akunnya pindah ke
      // Lightman, lengkap dengan spend dan status hari terakhir akun itu masih miliknya.
      if (!campaignRowBelongsTo(row, ownedKeys)) {
        foreignRows++;
        continue;
      }
      // Akunnya terbaca run ini dan campaign-nya tidak ikut kembali: diarsipkan atau dihapus.
      // Ditandai dulu, bukan langsung dibuang — spend hari terakhirnya masih dibaca, dan yang
      // menghilang tanpa jejak tidak bisa dibedakan dari yang tidak pernah ada.
      const row2 = campaignRowBelongsTo(row, scanned) ? missingCampaignRow(row, now) : row;
      if (missingCampaignExpired(row2, now)) {
        goneRows++;
        continue;
      }
      kept.push(row2);
    }
    const merged = [...fresh, ...kept];
    const payload = {
      campaigns: merged,
      updatedAt: now.toISOString(),
      updatedBy: "sync-meta",
    };

    // Riwayat ditulis ke POHONNYA SENDIRI, dan lewat jalur bertitik-miring bukan sebagai objek
    // utuh: menulis ulang seluruh `dailySpend` akan menghapus hari-hari sebelumnya, yang justru
    // isi panelnya.
    const reportsPath = userReportsPath(userId);
    const reports = {};
    const history = historyByUser.get(userId) || {
      dailySpend: {},
      snapshots: {},
      campaignHistory: {},
    };
    for (const [key, row] of Object.entries(history.dailySpend)) {
      reports[`dailySpend/${key}`] = row;
      spendRows++;
    }
    for (const [key, row] of Object.entries(history.snapshots)) {
      reports[`balanceSnapshots/${key}`] = row;
      snapshotRows++;
    }
    for (const [key, row] of Object.entries(history.campaignHistory)) {
      reports[`campaignHistory/${key}`] = row;
      campaignHistoryRows++;
    }
    // Yang dipangkas diminta BERBATAS: dua riwayat ini tumbuh sampai masa simpannya (30 dan 90
    // hari), dan mengunduhnya utuh tiap jam demi daftar yang normalnya kosong adalah persis biaya
    // yang pemisahan pohon ini ada untuk menghapusnya.
    const staleSpend = await staleBefore(`${reportsPath}/dailySpend`, dailySpendPruneBefore(now));
    for (const key of expiredDailySpendKeys(staleSpend, now)) {
      if (!(key in history.dailySpend)) reports[`dailySpend/${key}`] = null;
    }
    const allSnapshots = { ...(await snapshotsOf(userId)), ...history.snapshots };
    for (const key of excessSnapshotKeys(allSnapshots)) {
      if (!(key in history.snapshots)) reports[`balanceSnapshots/${key}`] = null;
    }
    const staleHistory = await staleBefore(
      `${reportsPath}/campaignHistory`,
      campaignHistoryPruneBefore(now),
    );
    for (const key of expiredCampaignHistoryKeys(staleHistory, now)) {
      if (!(key in history.campaignHistory)) reports[`campaignHistory/${key}`] = null;
    }

    // Baris campaign dulu, riwayat sesudahnya: yang pertama adalah pemetaan campaign -> subdomain
    // yang membuat ROI bekerja, yang kedua isi panel. Run yang mati di antaranya kehilangan
    // riwayat satu jam, bukan pemetaannya.
    await update(ref(db, `users/${userId}`), payload);
    if (Object.keys(reports).length) await update(ref(db, reportsPath), reports);
    updated++;
    total += merged.length;
  }

  // The two Overview panels that read Meta data. Nothing wrote them before, so they showed
  // "Tidak ada data" no matter how often the sync ran.
  const freshAccounts = (await get(ref(db, "adAccounts"))).val() || {};
  const freshUsers = (await get(ref(db, "users"))).val() || {};
  for (const [userId, row] of advertiserSpendRows(freshUsers, freshAccounts)) {
    await update(ref(db, `dashboard/advertiserSpend/${userId}`), row);
  }
  await update(ref(db, "dashboard/stats"), dashboardStatsFrom(freshUsers, freshAccounts));

  return {
    updated,
    campaigns: total,
    mappedByCode,
    unmapped,
    codeConflicts: conflicts,
    unowned,
    errors,
    spendRows,
    snapshotRows,
    campaignHistoryRows,
    settingsErrors,
    foreignRows,
    goneRows,
  };
}

// Rentang jendela terakhir untuk Meta `time_range`: `days` hari sampai hari ini, inklusif. Batasnya
// tanggal UTC — sengaja dilebihkan sedikit lewat jendela, jadi selisih zona akun tidak melubanginya.
export function recentRange(now = new Date(), days = 3) {
  const until = now.toISOString().slice(0, 10);
  const since = new Date(now.getTime() - (Math.max(1, days) - 1) * 86_400_000)
    .toISOString()
    .slice(0, 10);
  return { since, until };
}

/**
 * Penyegaran status campaign — satu bacaan `fetchCampaignSettings` per ad account, tanpa insights.
 *
 * Sync campaign penuh jalan tiap jam karena mahal: insights, tujuan ad set, riwayat saldo. Status
 * bukan bagian yang mahal, dan campaign yang dimatikan orang langsung lewat Ads Manager tidak
 * boleh berdiri "Aktif" di dashboard selama sisa jam itu. Fungsi ini dijalankan cron di dalam
 * server kontrol (`server/index.js`) tiap dua menit — jadwal yang sama dengan saklar, dan tepat
 * SEBELUM saklar itu diterapkan supaya perintah yang baru dieksekusi tidak langsung tertimpa bacaan
 * Meta yang lebih tua darinya.
 *
 * Yang ditulis hanya kolom yang berubah, lewat jalur bertitik-miring per baris: fungsi ini
 * berjalan di jadwal yang berbeda dari sync penuh, dan menulis ulang seluruh array `campaigns`
 * berarti membuang hasil sync yang kebetulan mendarat di antara baca dan tulis.
 */
export async function refreshCampaignStatuses(db, token, only = [], now = new Date()) {
  const accounts = (await get(ref(db, "adAccounts"))).val() || {};
  const users = (await get(ref(db, "users"))).val() || {};

  const userIdByName = new Map();
  for (const [id, user] of Object.entries(users)) {
    if (user && !user.deletedAt && user.name) userIdByName.set(normalizeName(user.name), id);
  }

  // userId -> { live: Map(campaignId -> setting), scanned: Set(kunci ad account) }
  const byUser = new Map();
  const errors = [];
  for (const [accountId, account] of Object.entries(accounts)) {
    if (account?.deletedAt || account?.syncDisabled || !account?.actId) continue;
    if (only.length && !only.includes(accountId)) continue;
    const ownerId = account.userOwner && userIdByName.get(normalizeName(account.userOwner));
    if (!ownerId) continue;
    let settings;
    try {
      settings = await fetchCampaignSettings(account.actId, token);
    } catch (error) {
      errors.push({ id: accountId, name: account.name || account.actId, message: error.message });
      continue;
    }
    const entry = byUser.get(ownerId) || { live: new Map(), scanned: new Set() };
    for (const setting of settings) {
      if (setting.id) entry.live.set(setting.id, setting);
    }
    for (const key of accountKeys(account)) entry.scanned.add(key);
    byUser.set(ownerId, entry);
  }

  let changed = 0;
  let touchedUsers = 0;
  for (const [userId, { live, scanned }] of byUser) {
    const payload = campaignStatusRefresh(users[userId], live, scanned, now);
    const fields = Object.keys(payload).length;
    if (!fields) continue;
    await update(ref(db, `users/${userId}`), payload);
    changed += fields;
    touchedUsers++;
  }

  return { users: touchedUsers, fields: changed, errors };
}

// Satu baris tabel Kampanye per campaign, dari dua sumber yang tidak selalu memuat nama yang sama:
// insights hanya memuat campaign yang tayang hari ini, sedangkan daftar campaign memuat yang
// sedang jeda juga. Digabung, bukan diiris — campaign yang hari ini belum membelanjakan apa pun
// tetap perlu tampil (dengan spend 0), dan campaign yang baru saja dihapus tetap perlu terhitung
// spend-nya hari ini.
//
// Yang sudah diarsipkan dilewati kecuali masih ada spend hari ini; kalau tidak, tabelnya akan
// terisi sisa campaign bertahun-tahun yang tidak lagi diurus siapa pun.
const ARCHIVED_STATUS = new Set(["ARCHIVED", "DELETED"]);

// ID campaign dari sumber mana pun yang punya: daftar campaign selalu membawanya, insights
// membawanya untuk campaign yang sudah dihapus dari daftar tapi masih punya spend hari ini.
function settingOrSpendId(setting, spend) {
  return String(setting?.id || spend?.id || "");
}

function mergeCampaignSources(campaigns, settings) {
  const merged = new Map();
  for (const setting of settings) {
    if (!setting?.name) continue;
    if (ARCHIVED_STATUS.has(String(setting.effectiveStatus).toUpperCase())) continue;
    merged.set(normalizeName(setting.name), { key: "", name: setting.name, setting });
  }
  for (const spend of campaigns) {
    if (!spend?.name) continue;
    const key = normalizeName(spend.name);
    const current = merged.get(key);
    if (current) current.spend = spend;
    else merged.set(key, { key: "", name: spend.name, spend });
  }
  for (const [key, entry] of merged) entry.key = key;
  return [...merged.values()];
}

// Dijalankan langsung sebagai CLI, atau diimpor sebagai modul?
//
// `file://${process.argv[1]}` benar di POSIX dan TIDAK PERNAH benar di Windows: argv[1] di sana
// berbentuk `D:\...\sync.mjs`, jadi ruas kanan jadi `file://D:\...` sementara `import.meta.url`
// berbunyi `file:///D:/...`. Yang terjadi bukan error melainkan DIAM — blok di bawah dilewati,
// tidak ada yang dikerjakan, dan prosesnya keluar dengan kode 0. Persis bentuk kegagalan yang
// paling mahal: `npm run sync:roi` tampak berhasil dan databasenya tidak berubah sedikit pun.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) {
    console.error("Set META_ACCESS_TOKEN (System User token dari Business Manager).");
    process.exit(1);
  }
  const db = await connect();
  const { fail } = await syncAdAccounts(db, token, process.argv.slice(2));
  const camp = await syncCampaigns(db, token, process.argv.slice(2));
  console.log(
    `Campaigns: ${camp.campaigns} baris ke ${camp.updated} user. ${camp.mappedByCode} dipetakan lewat kode.`,
  );
  console.log(
    `Riwayat saldo: ${camp.spendRows} baris daily spend, ${camp.snapshotRows} snapshot saldo.`,
  );
  console.log(`Riwayat spend campaign: ${camp.campaignHistoryRows} baris per-hari.`);
  if (camp.foreignRows) {
    console.warn(
      `${camp.foreignRows} baris dibuang karena ad account-nya sudah bukan milik user itu ` +
        "(akun berpindah pemilik atau dihapus di /ad-accounts).",
    );
  }
  if (camp.goneRows) {
    console.log(`${camp.goneRows} baris campaign yang sudah lama hilang dari Meta dibuang.`);
  }
  for (const e of camp.settingsErrors) {
    console.warn(`Status/anggaran campaign ${e.name} tidak terbaca: ${e.message}`);
  }
  if (camp.unmapped.length) {
    console.warn(
      `Campaign tanpa kode terdaftar (isi "Kode Campaign" di subdomain tujuan): ${camp.unmapped.join(", ")}`,
    );
  }
  for (const c of camp.codeConflicts) {
    console.warn(`Kode "${c.code}" diklaim ${c.kept} dan ${c.ignored}; ${c.ignored} diabaikan.`);
  }
  if (camp.unowned.length) {
    console.warn(
      `Ad account tanpa User Pemilik (campaign-nya dilewati): ${camp.unowned.join(", ")}`,
    );
  }
  for (const e of camp.errors) console.error(`Campaign ${e.name}: ${e.message}`);
  process.exit(fail ? 1 : 0);
}
