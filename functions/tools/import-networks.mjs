import { connect } from "../db.mjs";
import { discoverNetworks } from "../sync-gam.mjs";

// CLI fallback for the /gam-accounts "Impor dari Google" button (importGamNetworks).
// Creates one gamAccounts record per new GAM networkCode reachable by each connected
// googleApiConfigs credential, and prints what each credential could see — which is the
// answer to "why did nothing appear".
//
//   npm run import:networks

const db = await connect();
const res = await discoverNetworks(db, "import-cli");

for (const c of res.perCredential) {
  console.log(`\nKredensial "${c.credential}" — ${c.networks} network terlihat di GAM.`);
  for (const title of c.added) console.log(`  + ${title} — dibuat.`);
  for (const title of c.duplicates) console.log(`  - ${title} — sudah ada, lewati.`);
  if (c.networks === 0) {
    console.log("    Akun Google ini tidak punya akses ke network GAM mana pun.");
  }
}
for (const e of res.errors) console.error(`\nKredensial "${e.name}" gagal dibaca: ${e.message}`);

console.log(`\n${res.summary}`);
process.exit(res.errors.length ? 1 : 0);
