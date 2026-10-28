import http from "node:http";
import { get, ref, update } from "firebase/database";
import { connect } from "../db.mjs";
import { consentUrlFor, exchangeCode, REDIRECT } from "../oauth.mjs";
import { syncAccounts } from "../sync-gam.mjs";

// One-time OAuth consent for a googleApiConfigs credential. Opens a consent URL,
// catches the redirect on localhost, exchanges the code for a refresh token, and
// stores it back on the record. Run once per credential:
//
//   npm run authorize -- "GAM Sandi Primary"

const name = process.argv.slice(2).join(" ").trim();
if (!name) {
  console.error('Usage: npm run authorize -- "<nama googleApiConfig>"');
  process.exit(1);
}

const db = await connect();
const configs = (await get(ref(db, "googleApiConfigs"))).val() || {};
const found = Object.entries(configs).find(([, c]) => c?.name === name);
if (!found) {
  console.error(
    `googleApiConfig "${name}" tidak ditemukan. Tambahkan dulu di /google-api-configs/new.`,
  );
  process.exit(1);
}
const [id, cfg] = found;
if (!cfg.clientId || !cfg.clientSecret) {
  console.error(`clientId/clientSecret kosong pada "${name}".`);
  process.exit(1);
}

console.log(
  `\nBuka URL ini di browser, login dengan akun Google pemilik GAM, lalu setujui:\n\n${consentUrlFor(cfg)}\n`,
);

const port = Number(new URL(REDIRECT).port);
const code = await new Promise((resolve, reject) => {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, REDIRECT);
    const c = url.searchParams.get("code");
    const err = url.searchParams.get("error");
    if (err) {
      res.end(`Gagal: ${err}`);
      server.close();
      reject(new Error(err));
    } else if (c) {
      res.end("Berhasil. Kembali ke terminal.");
      server.close();
      resolve(c);
    } else {
      res.end("Menunggu authorization code...");
    }
  });
  server.listen(port, () => console.log(`Menunggu redirect di ${REDIRECT} ...`));
});

const tokens = await exchangeCode(cfg, REDIRECT, code);
if (!tokens.refresh_token) {
  console.error(
    "Google tidak mengembalikan refresh_token. Cabut akses app di https://myaccount.google.com/permissions lalu ulangi.",
  );
  process.exit(1);
}

await update(ref(db, `googleApiConfigs/${id}`), {
  refreshToken: tokens.refresh_token,
  status: "Connected",
  lastAuthActionAt: new Date().toISOString(),
});
console.log(`\n✔ refreshToken tersimpan untuk "${name}". Menjalankan sync awal...\n`);
const { fail } = await syncAccounts(db);
process.exit(fail ? 1 : 0);
