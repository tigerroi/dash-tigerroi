import { get, ref } from "firebase/database";
import { connect } from "../db.mjs";
import { listAccounts } from "../adsense.js";
import { listAdUnits, listNetworks, listSites } from "../gam.js";
import { accessTokenFrom } from "../oauth.mjs";

// Read-only health check for every Google credential, before importing anything.
// Answers the three questions an empty import raises, in order: is the credential still good,
// can it see any GAM network, and does that network expose a site list to import from.
// Writes nothing — safe to run against production whenever a credential misbehaves.
//
//   cd functions
//   npm run gam:check

const db = await connect();
const configs = (await get(ref(db, "googleApiConfigs"))).val() || {};
// Kedua koleksi: satu record yang menunjuk kredensial yang tidak ada akan gagal sync dengan cara
// yang sama, halaman GAM maupun halaman AdSense.
const gamAccounts = (await get(ref(db, "gamAccounts"))).val() || {};
const adsenseAccounts = (await get(ref(db, "adsenseAccounts"))).val() || {};
const accounts = { ...gamAccounts, ...adsenseAccounts };
const known = new Set(
  Object.values(accounts)
    .filter((a) => a && !a.deletedAt)
    .map((a) => String(a.networkCode || ""))
    .filter(Boolean),
);

const entries = Object.values(configs).filter((c) => c && !c.deletedAt);
if (entries.length === 0) {
  console.error("Belum ada credential di /google-api-configs.");
  process.exit(1);
}

console.log(`${entries.length} credential terdaftar. ${known.size} networkCode sudah ada di /adsense-accounts.\n`);

let usable = 0;
for (const cfg of entries) {
  const label = cfg.name || "(tanpa nama)";
  console.log(`── ${label}`);
  console.log(`   status tersimpan : ${cfg.status || "-"}`);
  console.log(`   clientId         : ${cfg.clientId ? `${String(cfg.clientId).slice(0, 24)}…` : "KOSONG"}`);
  console.log(`   clientSecret     : ${cfg.clientSecret ? "terisi" : "KOSONG"}`);
  console.log(`   refreshToken     : ${cfg.refreshToken ? "terisi" : "KOSONG — belum pernah consent"}`);

  if (!cfg.clientId || !cfg.clientSecret || !cfg.refreshToken) {
    console.log(`   → Jalankan: npm run authorize "${label}"\n`);
    continue;
  }

  let token;
  try {
    token = await accessTokenFrom(cfg);
    console.log("   access token     : OK");
  } catch (e) {
    // invalid_grant here almost always means the consent screen is still in Testing, where
    // Google expires refresh tokens after 7 days.
    console.log(`   access token     : GAGAL — ${e.message}`);
    console.log(`   → Jalankan ulang: npm run authorize "${label}"`);
    if (/invalid_grant/i.test(e.message)) {
      console.log("     lalu naikkan OAuth consent screen dari Testing ke Internal/Production.");
    }
    console.log("");
    continue;
  }

  // Daftar akun AdSense-nya ikut ditanyakan: domain yang Ad Manager-nya belum disetujui hanya
  // muncul di sini, dan kredensial yang benar untuk domain itu akan terlihat "0 network" —
  // kesimpulan yang salah kalau AdSense-nya tidak pernah ditanya.
  let adsenseSeen = 0;
  try {
    const adsense = await listAccounts(token);
    adsenseSeen = adsense.length;
    console.log(`   akun AdSense     : ${adsense.length}`);
    for (const acc of adsense) {
      const pub = String(acc.name || "").replace(/^accounts\//, "");
      const known = Object.values(adsenseAccounts).some(
        (a) => a && !a.deletedAt && String(a.publisherId || "").replace(/^ca-/, "") === pub,
      );
      console.log(
        `     • ${acc.displayName || pub} (${pub}) — ${known ? "sudah ada" : "BARU"}` +
          ` · zona ${acc.timeZone?.id || "-"} · mata uang ${acc.currencyCode || "-"}`,
      );
    }
  } catch (e) {
    console.log(`   akun AdSense     : GAGAL — ${e.message}`);
    if (/insufficient|scope|permission/i.test(e.message)) {
      console.log('   → Consent ulang supaya scope adsense.readonly ikut: npm run authorize -- "' + label + '"');
    }
  }

  let networks;
  try {
    networks = await listNetworks(token);
  } catch (e) {
    console.log(`   network GAM      : GAGAL — ${e.message}`);
    if (/SERVICE_DISABLED|has not been used/i.test(e.message)) {
      console.log("   → Google Ad Manager API belum di-enable di project OAuth client ini.");
    }
    // Kredensial yang GAM-nya gagal tapi AdSense-nya terbaca tetap kredensial yang bekerja —
    // itu justru bentuk normal untuk domain yang Ad Manager-nya belum disetujui.
    if (adsenseSeen > 0) usable++;
    console.log("");
    continue;
  }

  if (networks.length === 0) {
    if (adsenseSeen > 0) usable++;
    console.log("   network GAM      : 0");
    console.log("   → Akun Google ini tidak punya akses GAM. Kalau memang hanya AdSense, itu wajar —");
    console.log("     lihat baris \"akun AdSense\" di atas. Kalau seharusnya punya, cek di GAM:");
    console.log("     Admin → Access & authorization → Users (daftarkan akunnya, role harus bisa baca report)");
    console.log("     Admin → Global settings → API access (harus ON)\n");
    continue;
  }

  usable++;
  console.log(`   network GAM      : ${networks.length}`);
  for (const net of networks) {
    const code = String(net.networkCode || "");
    const flag = known.has(code) ? "sudah ada" : "BARU";
    console.log(`     • ${net.displayName || code} (${code}) — ${flag}`);
    console.log(`       propertyCode ${net.propertyCode || "-"} · mata uang ${net.currencyCode || "-"}`);

    // What "Impor dari Google" on /domains and /sub-domains would have to work with.
    const counts = [];
    try {
      const sites = await listSites(code, token);
      counts.push(`Sites: ${sites.length}`);
      for (const site of sites.slice(0, 8)) console.log(`         site: ${site.url}`);
      if (sites.length > 8) console.log(`         … +${sites.length - 8} lagi`);
    } catch (e) {
      counts.push(`Sites: gagal (${e.message.slice(0, 80)})`);
    }
    try {
      const units = await listAdUnits(code, token);
      counts.push(`Ad Units: ${units.length}`);
    } catch (e) {
      counts.push(`Ad Units: gagal (${e.message.slice(0, 80)})`);
    }
    console.log(`       ${counts.join(" · ")}`);
  }
  console.log("");
}

// Every adsenseAccount names the credential it syncs with. A name that no longer matches any
// record fails the whole account at sync time, and the record still looks perfectly fine in the
// dashboard — the dropdown shows the stale string, not the fact that nothing answers to it.
const names = new Set(entries.map((c) => c.name).filter(Boolean));
const envFallback = Boolean(process.env.GAM_REFRESH_TOKEN);
const broken = [];
for (const [id, account] of Object.entries(accounts)) {
  if (!account || account.deletedAt) continue;
  const wanted = account.googleCredential;
  if (wanted && !names.has(wanted)) broken.push({ id, account, wanted });
  else if (!wanted && !envFallback) broken.push({ id, account, wanted: "" });
}

if (broken.length) {
  console.log(`\n${broken.length} adsense account menunjuk credential yang tidak ada:`);
  for (const { account, wanted } of broken) {
    const label = account.name || account.networkCode || "(tanpa nama)";
    console.log(
      wanted
        ? `  • ${label} → "Koneksi Google API" = "${wanted}", tidak ada di /google-api-configs`
        : `  • ${label} → "Koneksi Google API" kosong dan GAM_REFRESH_TOKEN juga kosong`,
    );
  }
  console.log(
    `  → Buka /adsense-accounts, edit akun di atas, set "Koneksi Google API" ke salah satu dari: ${[...names].join(", ")}`,
  );
}

console.log(
  `\n${usable > 0 ? `${usable} credential siap dipakai.` : "Tidak ada credential yang bisa dipakai."}`,
);
process.exit(usable > 0 && broken.length === 0 ? 0 : 1);
