import { pathToFileURL } from "node:url";
import { get, push, ref, update } from "firebase/database";
import { ADS_NOT_SERVING } from "./account-status.js";
import { listAccounts } from "./adsense.js";
import { connect } from "./db.mjs";
import { loadUsdRates } from "./fx.mjs";
import { preconditionError, summarizeNetworks } from "./discover-core.js";
import { accessTokenFrom } from "./oauth.mjs";
import { asStore } from "./store.mjs";
import {
  adsenseAccountName,
  earningUpdate,
  SYNC_ISSUES_PATH,
  syncIssuesUpdate,
} from "./sync-core.js";
// Penerap status kredensial: modul yang SAMA dengan sync GAM. Aturan "kredensial ini masih hidup
// atau tidak" tidak boleh punya dua salinan — satu kredensial memegang network GAM dan akun
// AdSense sekaligus, dan dua aturan yang bergeser berarti dua modul memperebutkan satu kolom.
import { applyCredentialHealth } from "./sync-credentials.mjs";

// CLI/cron sync untuk akun AdSense berdiri sendiri — kembarannya sync-gam.mjs, API-nya berbeda.
//
//   node sync-adsense.mjs                 # semua akun
//   node sync-adsense.mjs <id1> <id2>     # hanya id ini
//
// KENAPA TERPISAH DARI SYNC GAM. Bukan karena kodenya beda banyak (keduanya memanggil
// `earningUpdate` yang sama), melainkan karena kegagalannya harus bisa dibedakan: satu network
// GAM yang tokennya mati dan satu akun AdSense yang laporannya ditolak adalah dua masalah dengan
// dua perbaikan, dan satu cabang syncIssues untuk keduanya membuat ikon peringatan di topbar
// menunjuk halaman yang salah.

export async function syncAdsenseAccounts(db, only = []) {
  const accounts = (await get(ref(db, "adsenseAccounts"))).val() || {};
  const configs = (await get(ref(db, "googleApiConfigs"))).val() || {};
  const rates = await balanceRates(db);
  let ok = 0;
  const errors = [];
  // Sama seperti sync GAM: yang berhasil ikut dicatat, karena itu yang membatalkan penurunan
  // status kredensialnya.
  const outcomes = [];
  // Seluruh akun diminta BERSAMAAN, hasilnya dicatat berurutan: satu per satu, tahap ini saja
  // memakan 1-1,5 menit dari batas 540 detik run penuh (lihat laporan paralel di sync-subdomains.mjs).
  //
  // Akun yang belum punya Publisher ID belum terhubung ke mana-mana. Itu bukan kegagalan sync,
  // jadi tidak ikut jadi isu — record barunya memang masih kosong sampai diisi.
  const eligible = Object.entries(accounts).filter(
    ([id, account]) =>
      account &&
      !account.deletedAt &&
      !account.syncDisabled &&
      adsenseAccountName(account) &&
      (!only.length || only.includes(id)),
  );
  const results = await Promise.all(
    eligible.map(async ([id, account]) => {
      try {
        await update(ref(db, `adsenseAccounts/${id}`), await earningUpdate(account, configs, { rates }));
        return { id, account };
      } catch (error) {
        return { id, account, error };
      }
    }),
  );
  for (const { id, account, error } of results) {
    const credential = account.googleCredential || "";
    if (!error) {
      console.log(`OK   ${account.name || id}`);
      outcomes.push({ credential, ok: true });
      ok++;
      continue;
    }
    console.error(`FAIL ${account.name || id}: ${error.message}`);
    outcomes.push({ credential, ok: false, message: error.message });
    errors.push({
      id,
      name: account.name || account.publisherId || id,
      message: error.message,
      credential,
    });
  }
  console.log(`Done. ${ok} ok, ${errors.length} failed.`);
  // Sama seperti sync GAM: hanya run penuh yang menulis daftar isu. Run untuk satu-dua akun tidak
  // tahu apa-apa tentang akun lain, dan menimpa cabangnya berarti menghapus kegagalan yang belum
  // diperbaiki.
  if (!only.length) {
    await asStore(db).replace(
      `${SYNC_ISSUES_PATH}/adsenseAccounts`,
      syncIssuesUpdate(
        "Akun AdSense",
        errors.map((error) => ({
          source: "Sync akun AdSense",
          target: error.name,
          message: error.message,
          impact: "Kolom earning di halaman AdSense untuk akun ini tidak diperbarui.",
          credential: error.credential,
        })),
      ),
    );
    await applyCredentialHealth(db, configs, outcomes);
  }
  return { ok, fail: errors.length, errors };
}

/**
 * Impor akun AdSense yang bisa dilihat tiap kredensial yang terhubung.
 *
 * Bentuk hasilnya sengaja sama dengan `discoverNetworks` di sync-gam.mjs — termasuk memakai
 * `summarizeNetworks` yang sama — karena tombol dan toast-nya juga sama, dan dua kalimat ringkasan
 * yang berbeda untuk dua tombol yang identik cuma bikin orang mengira salah satunya rusak.
 */
export async function discoverAdsenseAccounts(db, actor = "import") {
  const configs = (await get(ref(db, "googleApiConfigs"))).val() || {};
  const existing = (await get(ref(db, "adsenseAccounts"))).val() || {};
  const seen = new Set(
    Object.values(existing)
      // Akun yang diarsipkan tetap dihitung "sudah ada" — kalau tidak, impor berikutnya
      // membuat duplikatnya dan yang lama tidak pernah bisa kembali ke daftar.
      .filter((a) => a && !a.deletedAt)
      .map((a) => adsenseAccountName(a))
      .filter(Boolean),
  );

  const connected = Object.values(configs).filter((c) => c?.refreshToken);
  if (connected.length === 0) {
    throw preconditionError("Belum ada Google credential yang terhubung.");
  }

  let created = 0;
  const perCredential = [];
  const errors = [];
  for (const cfg of connected) {
    const label = cfg.name || "(kredensial tanpa nama)";
    let accounts;
    try {
      accounts = await listAccounts(await accessTokenFrom(cfg));
    } catch (e) {
      // Satu kredensial rusak tidak boleh menutupi apa yang dilihat kredensial lain — itu persis
      // yang terjadi kalau error ini dilempar keluar dari loop.
      errors.push({ name: label, message: e.message });
      continue;
    }
    const added = [];
    const duplicates = [];
    for (const acc of accounts) {
      const resource = adsenseAccountName({ accountName: acc.name });
      if (!resource) continue;
      const publisherId = resource.replace(/^accounts\//, "");
      const title = `${acc.displayName || publisherId} (${publisherId})`;
      if (seen.has(resource)) {
        duplicates.push(title);
        continue;
      }
      const now = new Date().toISOString();
      await push(ref(db, "adsenseAccounts"), {
        name: acc.displayName || publisherId,
        provider: "adsense",
        accountName: resource,
        publisherId,
        // Zona waktu akun ikut disimpan karena laporan AdSense selalu memakainya dan tidak bisa
        // diminta dalam zona lain. Kalau bukan Asia/Jakarta, "kemarin" versi akun ini bukan
        // "kemarin" versi dashboard — dan itu harus terlihat, bukan ditebak dari selisih angka.
        reportTimeZone: acc.timeZone?.id || "",
        currencyCode: acc.currencyCode || "",
        googleCredential: cfg.name,
        status: ADS_NOT_SERVING,
        // Kembar sejak baris pertamanya: `statusAuto` adalah pembanding yang dipakai
        // `accountStatusPinned`, dan tanpanya status yang diketik orang pada akun yang baru
        // diimpor — keadaan yang paling sering — ditimpa sync pertama yang berhasil.
        statusAuto: ADS_NOT_SERVING,
        statusDetail: "Belum pernah dicek — status diisi sync berikutnya.",
        createdAt: now,
        createdBy: actor,
        updatedAt: now,
      });
      seen.add(resource);
      added.push(title);
      created++;
    }
    perCredential.push({ credential: label, networks: accounts.length, added, duplicates });
  }
  return {
    created,
    perCredential,
    errors,
    summary: summarizeNetworks(created, perCredential, errors, "adsense"),
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
  const { fail } = await syncAdsenseAccounts(db, process.argv.slice(2));
  process.exit(fail ? 1 : 0);
}

/**
 * Kurs USD->IDR untuk kolom Saldo, atau `null` kalau tidak ada satu pun kurs yang bisa dipakai.
 *
 * Sekali per run, bukan per akun: `loadUsdRates` men-cache-nya per proses, tapi yang menembak API
 * kurs di dalam loop akun tetap menembaknya sekali untuk tiap kegagalan. Yang gagal TIDAK
 * menjatuhkan run — akun IDR (mayoritas) tidak butuh kurs sama sekali, dan yang berkurs asing
 * menuliskan sebabnya sendiri di kolom Keterangan Saldo.
 */
async function balanceRates(db) {
  try {
    return (await loadUsdRates(asStore(db))).rates;
  } catch (error) {
    console.error(`FX: kurs tidak bisa diambil (${error.message}); saldo non-IDR dilewati.`);
    return null;
  }
}
