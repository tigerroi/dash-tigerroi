import {
  addLeaves,
  changedLeaves,
  FILL_RATE_PATH,
  FILL_RATE_STATUS_PATH,
  fillRateLeaves,
  fillRateWindow,
  flattenFillRate,
  networkStatusKey,
} from "./fill-rate-core.js";
import { runNetworkHourlyFillRate } from "./gam.js";
import { asStore } from "./store.mjs";
import {
  accountToken,
  displayStamp,
  earningAccounts,
  SYNC_ISSUES_PATH,
  syncIssuesUpdate,
} from "./sync-core.js";

const defaultFetch = (account, range, token) =>
  runNetworkHourlyFillRate(String(account.networkCode), range, token);

/**
 * Satu run tab Rasio Penayangan: satu laporan per network GAM (kemarin + hari ini), lalu HANYA
 * daun yang berubah ditulis. Dijalankan cron server kontrol tiap 10 menit — terpisah dari sync
 * penuh, supaya jam yang baru diterbitkan GAM tidak menunggu tahap ROI/Meta.
 *
 * Tidak ada antrean retry: run berikutnya sepuluh menit lagi sudah jadi retry-nya. Tidak ada yang
 * DIHAPUS, termasuk data network yang gagal run ini.
 */
export async function syncFillRate(
  dbOrStore,
  { now = new Date(), fetchHourly = defaultFetch, tokenOf = accountToken } = {},
) {
  const store = asStore(dbOrStore);
  const [gamAccounts, configs] = await Promise.all([
    store.read("gamAccounts"),
    store.read("googleApiConfigs"),
  ]);
  const accounts = earningAccounts(gamAccounts, null).filter((entry) => entry.provider === "gam");
  const window = fillRateWindow(now);

  // Satu tukar token per kredensial per run. Promise yang GAGAL ikut tersimpan: seluruh akun
  // berkredensial itu memang gagal untuk alasan yang sama.
  const tokens = new Map();
  const tokenFor = (account) => {
    const key = account.googleCredential || "";
    if (!tokens.has(key)) tokens.set(key, tokenOf(account, configs));
    return tokens.get(key);
  };

  const results = await Promise.all(
    accounts.map(async ({ account, label }) => {
      try {
        const token = await tokenFor(account);
        return { account, label, rows: await fetchHourly(account, window.range, token) };
      } catch (error) {
        return { account, label, error };
      }
    }),
  );

  const next = {};
  const networks = {};
  const issues = [];
  for (const { account, label, rows, error } of results) {
    const code = String(account.networkCode);
    if (error) {
      networks[networkStatusKey(code)] = { name: label, ok: false, message: error.message };
      issues.push({
        source: "Rasio Penayangan",
        target: label,
        message: error.message,
        impact: "Grafik Rasio Penayangan network ini berhenti di tarikan terakhir yang berhasil.",
        credential: account.googleCredential || "",
      });
      continue;
    }
    const domain = String(account.name || "")
      .trim()
      .toLowerCase();
    const { leaves, lastSlot } = fillRateLeaves(rows, { domain, code });
    addLeaves(next, leaves);
    networks[networkStatusKey(code)] = { name: label, ok: true, lastSlot };
  }

  const previous = flattenFillRate(await store.readFrom(FILL_RATE_PATH, window.from));
  const writes = changedLeaves(previous, next);
  const written = Object.keys(writes).length;
  if (written) await store.update(FILL_RATE_PATH, writes);

  // Stempel WIB tanpa zona (`displayStamp`), sesuai aturan stempel sync.
  await store.replace(FILL_RATE_STATUS_PATH, { lastRunAt: displayStamp(now), networks });
  await store.replace(
    `${SYNC_ISSUES_PATH}/fillRate`,
    syncIssuesUpdate("Rasio Penayangan", issues, now),
  );
  return { networks: accounts.length, failed: issues.length, written };
}
