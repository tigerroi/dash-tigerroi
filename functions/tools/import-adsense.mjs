import { connect } from "../db.mjs";
import { discoverAdsenseAccounts } from "../sync-adsense.mjs";

// CLI fallback for the /adsense-accounts "Impor dari Google" button (importAdsenseAccounts).
// Creates one adsenseAccounts record per AdSense publisher each connected googleApiConfigs
// credential can see, and prints what each credential could see — which is the answer to
// "why did nothing appear".
//
// Ini jalur untuk domain yang Ad Manager-nya BELUM disetujui Google: akunnya tidak akan pernah
// muncul di `npm run import:networks`, karena di sisi GAM ia memang tidak ada.
//
//   npm run import:adsense

const db = await connect();
const res = await discoverAdsenseAccounts(db, "import-cli");

for (const c of res.perCredential) {
  console.log(`\nKredensial "${c.credential}" — ${c.networks} akun AdSense terlihat.`);
  for (const title of c.added) console.log(`  + ${title} — dibuat.`);
  for (const title of c.duplicates) console.log(`  - ${title} — sudah ada, lewati.`);
  if (c.networks === 0) {
    console.log("    Akun Google ini tidak punya akun AdSense yang bisa dibaca API.");
  }
}
for (const e of res.errors) console.error(`\nKredensial "${e.name}" gagal dibaca: ${e.message}`);

console.log(`\n${res.summary}`);
process.exit(res.errors.length ? 1 : 0);
