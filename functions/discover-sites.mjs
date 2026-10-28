import { pathToFileURL } from "node:url";
import { get, push, ref, set } from "firebase/database";
import { connect } from "./db.mjs";
import {
  assertDiscoverable,
  collectHosts,
  planDomains,
  planSubdomains,
  summarize,
} from "./discover-core.js";
import { earningAccounts } from "./sync-core.js";

// CLI/backend "Impor dari Google" for /domains and /sub-domains (client SDK) — the DRS-safe
// equivalent of the importGamDomains / importGamSubdomains callables. Everything comes from the
// Google Ad Manager / AdSense API; nothing is read from a spreadsheet.
//
//   node --env-file-if-exists=.env.sync discover-sites.mjs domains
//   node --env-file-if-exists=.env.sync discover-sites.mjs subdomains

async function loadContext(db) {
  const configs = (await get(ref(db, "googleApiConfigs"))).val() || {};
  // Kedua koleksi: situs bisa dikenali lewat network GAM atau lewat akun AdSense, dan domain yang
  // hanya dimonetisasi AdSense tidak akan pernah muncul kalau yang dibaca cuma satu.
  const accounts = earningAccounts(
    (await get(ref(db, "gamAccounts"))).val() || {},
    (await get(ref(db, "adsenseAccounts"))).val() || {},
  );
  assertDiscoverable(accounts, configs);
  return { configs, accounts };
}

// Same record shape the dashboard's own form writes (see firebaseRepository.createResource),
// so an imported row is indistinguishable from a hand-made one once it lands.
async function createAll(db, node, records, actor) {
  for (const values of records) {
    const target = push(ref(db, node));
    const now = new Date().toISOString();
    await set(target, {
      ...values,
      id: target.key,
      createdAt: now,
      createdBy: actor,
      updatedAt: now,
      updatedBy: actor,
    });
  }
  return records.length;
}

export async function discoverDomains(db, actor = "import", dimension) {
  const { configs, accounts } = await loadContext(db);
  const { hosts, skipped, errors, sourceFailures, sources } = await collectHosts(
    accounts,
    configs,
    dimension,
  );
  const existing = (await get(ref(db, "domains"))).val() || {};
  const records = planDomains(hosts, existing);
  const created = await createAll(db, "domains", records, actor);
  return {
    created,
    found: hosts.size,
    skipped,
    errors,
    sourceFailures,
    sources,
    summary: summarize("domain", created, { skipped, errors }),
  };
}

export async function discoverSubdomains(db, actor = "import", dimension) {
  const { configs, accounts } = await loadContext(db);
  const { hosts, skipped, errors, sourceFailures, sources } = await collectHosts(
    accounts,
    configs,
    dimension,
  );
  const existingSubs = (await get(ref(db, "subDomains"))).val() || {};
  const existingDomains = (await get(ref(db, "domains"))).val() || {};
  const { records, orphans } = planSubdomains(hosts, existingSubs, existingDomains);
  const created = await createAll(db, "subDomains", records, actor);
  const extra = orphans
    ? `${orphans} belum punya domain induk — impor di halaman Domains dulu, lalu ulangi.`
    : "";
  return {
    created,
    found: hosts.size,
    orphans,
    skipped,
    errors,
    sourceFailures,
    sources,
    summary: summarize("subdomain", created, { skipped, errors, extra }),
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
  const what = (process.argv[2] || "").toLowerCase();
  if (!["domains", "subdomains"].includes(what)) {
    console.error("Pakai: node discover-sites.mjs domains|subdomains");
    process.exit(1);
  }
  const db = await connect();
  const run = what === "domains" ? discoverDomains : discoverSubdomains;
  const res = await run(db, "discover-cli", process.env.GAM_DISCOVER_DIMENSION);
  console.log(res.summary);
  // Which GAM endpoint actually knew about your sites. Zero across the board is the answer to
  // "why did nothing import"; it says the network has no site list to read, not that we misread it.
  console.log(
    `\nDitemukan ${res.found} hostname — Sites: ${res.sources.sites}, ` +
      `Ad Units: ${res.sources.adUnits}, Report: ${res.sources.report}.`,
  );
  // The skipped names are the diagnosis when nothing imports: they show what GAM actually
  // calls its inventory, which is what decides whether ad units are a usable site list at all.
  if (res.skipped.length) {
    console.log(`\nNama GAM yang dilewati (${res.skipped.length}):`);
    for (const name of res.skipped) console.log(`  - ${name}`);
  }
  for (const e of res.sourceFailures)
    console.warn(`\nSumber tidak terbaca — ${e.name}: ${e.message}`);
  for (const e of res.errors) console.error(`\nGagal membaca ${e.name}: ${e.message}`);
  process.exit(0);
}
