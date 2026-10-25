import { pathToFileURL } from "node:url";
import { get, push, ref, update } from "firebase/database";
import { ADS_NOT_SERVING } from "./account-status.js";
import { connect } from "./db.mjs";
import { loadUsdRates } from "./fx.mjs";
import { preconditionError, summarizeNetworks } from "./discover-core.js";
import { listNetworks } from "./gam.js";
import { accessTokenFrom } from "./oauth.mjs";
import { asStore } from "./store.mjs";
import { earningUpdate, SYNC_ISSUES_PATH, syncIssuesUpdate } from "./sync-core.js";
import { applyCredentialHealth } from "./sync-credentials.mjs";

// CLI/cron GAM sync (client SDK). Buttons on the dashboard use the Cloud Function instead;
// this stays as an offline/cron fallback and is reused by tools/authorize.mjs.
//
//   node sync-gam.mjs                 # all accounts
//   node sync-gam.mjs <id1> <id2>     # only these account ids
//
// Akun AdSense berdiri sendiri punya modulnya sendiri (sync-adsense.mjs): API-nya lain, dan
// cabang syncIssues-nya juga lain supaya "GAM gagal" tidak pernah terbaca sebagai "AdSense gagal".

export async function syncAccounts(db, only = []) {
  const accounts = (await get(ref(db, "gamAccounts"))).val() || {};
  const configs = (await get(ref(db, "googleApiConfigs"))).val() || {};
  const rates = await balanceRates(db);
  let ok = 0;
  // Same shape as syncAdAccounts: the caller shows these reasons instead of a bare count.
  const errors = [];
  // Hasil per akun berikut kredensial yang dipakainya — bahan `credentialHealthUpdates`. Yang
  // BERHASIL ikut dicatat, dan justru itu bagian yang menentukan: satu akun yang tersync
  // membuktikan tokennya masih hidup, sehingga kegagalan di sebelahnya bukan soal kredensial.
  const outcomes = [];
  // Seluruh akun diminta BERSAMAAN, hasilnya dicatat berurutan: satu per satu, tahap ini saja
  // memakan 1-1,5 menit dari batas 540 detik run penuh (lihat laporan paralel di sync-subdomains.mjs).
  const eligible = Object.entries(accounts).filter(
    ([id, account]) =>
      account &&
      !account.deletedAt &&
      !account.syncDisabled &&
      account.networkCode &&
      (!only.length || only.includes(id)),
  );
  const results = await Promise.all(
    eligible.map(async ([id, account]) => {
      try {
        await update(ref(db, `gamAccounts/${id}`), await earningUpdate(account, configs, { rates }));
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
      name: account.name || account.networkCode || id,
      message: error.message,
      credential,
    });
  }
  console.log(`Done. ${ok} ok, ${errors.length} failed.`);
  // Hanya run penuh yang menulis daftar isu: run untuk satu-dua akun tidak tahu apa-apa tentang
  // akun lain, dan menimpa cabangnya berarti menghapus kegagalan yang belum diperbaiki.
  if (!only.length) {
    await asStore(db).replace(
      `${SYNC_ISSUES_PATH}/gamAccounts`,
      syncIssuesUpdate(
        "Akun AdSense/GAM",
        errors.map((error) => ({
          source: "Sync akun GAM",
          target: error.name,
          message: error.message,
          impact: "Kolom earning di halaman GAM untuk akun ini tidak diperbarui.",
          credential: error.credential,
        })),
      ),
    );
    await applyCredentialHealth(db, configs, outcomes);
  }
  return { ok, fail: errors.length, errors };
}


// Import GAM accounts from the networks each connected credential can access. Creates
// one gamAccounts record per new networkCode (skips ones already present). Mirrors the
// importGamNetworks Cloud Function using the client SDK.
//
// Returns a per-credential breakdown, not just a count: "nothing was added" has two very
// different causes — Google returned no network at all (credential or GAM access problem), or
// it returned networks that are all already in the list — and a bare 0 tells them apart for
// nobody. This is what the toast and the CLI both report back.
export async function discoverNetworks(db, actor = "import") {
  const configs = (await get(ref(db, "googleApiConfigs"))).val() || {};
  const existing = (await get(ref(db, "gamAccounts"))).val() || {};
  const seen = new Set(
    Object.values(existing)
      // Skip archived accounts: a soft-deleted one is hidden from the table, so blocking its
      // re-import here strands the network — it can never come back to the list.
      .filter((a) => a && !a.deletedAt)
      .map((a) => String(a.networkCode || ""))
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
    let nets;
    try {
      nets = await listNetworks(await accessTokenFrom(cfg));
    } catch (e) {
      // One broken credential must not hide what the others can see, which is exactly what
      // happens when this throws out of the loop.
      errors.push({ name: label, message: e.message });
      continue;
    }
    const added = [];
    const duplicates = [];
    for (const net of nets) {
      const code = String(net.networkCode || "");
      if (!code) continue;
      const title = `${net.displayName || code} (${code})`;
      if (seen.has(code)) {
        duplicates.push(title);
        continue;
      }
      const now = new Date().toISOString();
      await push(ref(db, "gamAccounts"), {
        name: net.displayName || code,
        provider: "gam",
        networkCode: code,
        publisherId: net.propertyCode || "",
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
      seen.add(code);
      added.push(title);
      created++;
    }
    perCredential.push({ credential: label, networks: nets.length, added, duplicates });
  }
  return {
    created,
    perCredential,
    errors,
    summary: summarizeNetworks(created, perCredential, errors),
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
  const { fail } = await syncAccounts(db, process.argv.slice(2));
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
