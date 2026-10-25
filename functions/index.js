import { initializeApp } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";
// Named import, bukan default: build ESM firebase-functions v7 tidak lagi punya default export di
// subpath /v1, jadi `import functionsV1 from ...` gagal dimuat saat container start.
import { defineSecret } from "firebase-functions/params";
import { region } from "firebase-functions/v1";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { ADS_NOT_SERVING } from "./account-status.js";
import { listAccounts } from "./adsense.js";
import { applyOneCampaignCommand } from "./campaign-commands.mjs";
import { dashboardUrl } from "./dashboard-url.js";
import {
  assertDiscoverable,
  collectHosts,
  planDomains,
  planSubdomains,
  summarize,
  summarizeNetworks,
} from "./discover-core.js";
import { listNetworks } from "./gam.js";
import { accessTokenFrom, consentUrlFor, exchangeCode } from "./oauth.mjs";
import { isAdmin } from "./roles.mjs";
import { adminStore } from "./store.mjs";
import {
  adsenseAccountName,
  CAMPAIGN_STATUSES,
  campaignCommandEntry,
  campaignEntries,
  earningAccounts,
} from "./sync-core.js";

// Pengingat jatuh tempo ke Telegram. Terjadwal sendiri (sekali sehari, bukan tiap jam) dan memakai
// admin SDK yang sudah diinisialisasi di bawah — jadi ia tidak menumpang secret SYNC_USER.
export { scheduledReminders } from "./scheduled-reminders.mjs";
// Sync terjadwal. Dipisah ke modulnya sendiri karena ia memakai jalur yang berbeda dari callable
// di file ini: client SDK dan modul CLI yang sama, bukan admin SDK.
//
// `scheduledCampaignCommands` dan `scheduledGating` TIDAK lagi diekspor — keduanya dijalankan
// server/ (Bun + Elysia) sekarang, dan sudah dihapus dari Firebase. Menambahkannya kembali ke baris
// ini akan menghidupkannya lagi di deploy berikutnya, berdampingan dengan yang di server.
export { scheduledSync, scheduledSyncRetry } from "./scheduled-sync.js";

initializeApp();
const db = getDatabase();

const REGION = "asia-southeast1";
const META_TOKEN = defineSecret("META_ACCESS_TOKEN");

// Siapa yang boleh memanggil callable. Default `private` karena project ini di bawah Domain
// Restricted Sharing: firebase-tools mencoba memberi invoker `allUsers` untuk tiap callable, org
// policy menolaknya, dan SELURUH `firebase deploy --only functions` berakhir dengan error — padahal
// fungsinya sendiri sudah terpasang. `private` membuat deploy tidak meminta grant itu sama sekali.
//
// Konsekuensinya callable ini memang tidak bisa dipanggil dari browser, yang persis keadaan
// sekarang: frontend memakai antrean RTDB (VITE_FUNCTIONS_ENABLED=false), dan callable hanya jalur
// cepat opsional. Begitu DRS dilonggarkan, set CALLABLE_INVOKER=public lalu deploy ulang — bersamaan
// dengan VITE_FUNCTIONS_ENABLED=true di sisi frontend.
const CALLABLE_INVOKER = process.env.CALLABLE_INVOKER || "private";

// ---------------------------------------------------------------------------
// OAuth for /google-api-configs "Login/Reconnect" (stable URL -> gen1 onRequest).
//   https://asia-southeast1-rabbitroi-89973.cloudfunctions.net/oauth
// ---------------------------------------------------------------------------
const SELF_URL = `https://${REGION}-${process.env.GCLOUD_PROJECT}.cloudfunctions.net/oauth`;
const APP_URL = process.env.APP_URL || `${dashboardUrl()}/google-api-configs`;

async function loadConfig(id) {
  const cfg = (await db.ref(`googleApiConfigs/${id}`).get()).val();
  if (!cfg?.clientId || !cfg?.clientSecret) {
    throw new Error("Client ID / Client Secret belum diisi pada credential ini.");
  }
  return cfg;
}

export const oauth = region(REGION).https.onRequest(async (req, res) => {
  const { code, state, configId, error } = req.query;
  try {
    if (error) return res.redirect(`${APP_URL}?oauth=denied`);
    if (!code) {
      if (!configId) return res.status(400).send("configId wajib.");
      const cfg = await loadConfig(configId);
      return res.redirect(consentUrlFor(cfg, SELF_URL, String(configId)));
    }
    if (!state) return res.status(400).send("state (configId) hilang.");
    const cfg = await loadConfig(state);
    const tokens = await exchangeCode(cfg, SELF_URL, code);
    const update = { status: "Connected", lastAuthActionAt: new Date().toISOString() };
    if (tokens.refresh_token) update.refreshToken = tokens.refresh_token;
    await db.ref(`googleApiConfigs/${state}`).update(update);
    return res.redirect(`${APP_URL}?oauth=connected`);
  } catch (e) {
    console.error("oauth error:", e);
    return res.redirect(`${APP_URL}?oauth=error&msg=${encodeURIComponent(e.message)}`);
  }
});

// Callable dipanggil dari tombol dashboard. Yang tersisa hanya impor dan OAuth: sync sendiri
// tidak pernah dipicu dari browser — ia jalan di `scheduledSync` dan di CLI `functions/`.
function requireAuth(req) {
  if (!req.auth) throw new HttpsError("unauthenticated", "Login dulu.");
}

/**
 * Nyalakan/matikan satu campaign, seketika.
 *
 * Jalur cepat untuk saklar di /users/{uid}, dan hanya bisa dipakai kalau DRS project ini sudah
 * dilonggarkan (lihat src/config/features.js). Kalau tidak, browser menulis perintah yang sama
 * langsung ke RTDB dan `scheduledCampaignCommands` yang menerapkannya — bentuk perintahnya sama
 * persis (`campaignCommandEntry`), jadi dua jalur ini tidak bisa berbeda hasilnya.
 *
 * Perintahnya tetap ditulis ke RTDB dulu, baru dieksekusi. Kalau panggilan Meta gagal atau
 * containernya mati di tengah, yang tersisa adalah baris `pending`/`failed` yang terlihat di tabel
 * dan bisa disapu penerap terjadwal — bukan klik yang lenyap tanpa jejak.
 */
export const setCampaignStatus = onCall(
  { region: REGION, timeoutSeconds: 60, secrets: [META_TOKEN], invoker: CALLABLE_INVOKER },
  async (req) => {
    requireAuth(req);
    const { userId, campaignId, status } = req.data || {};
    if (!CAMPAIGN_STATUSES.includes(status)) {
      throw new HttpsError("invalid-argument", `Status campaign tidak dikenal: ${status}`);
    }

    const user = (await db.ref(`users/${userId}`).get()).val();
    if (!user) throw new HttpsError("not-found", "User tidak ditemukan.");
    await assertMayToggle(req, user);

    // Dicari di baris user itu sendiri, bukan dipercaya dari request: tanpa ini siapa pun yang
    // boleh menyentuh satu user bisa mengoper ID campaign milik akun iklan mana pun di Business
    // Manager, dan Meta akan menurutinya.
    const row = campaignEntries(user.campaigns).find(
      ([, item]) => String(item?.campaignId || "") === String(campaignId),
    )?.[1];
    if (!row) {
      throw new HttpsError("not-found", "Campaign ini bukan milik user tersebut.");
    }

    const actor = req.auth.token?.email || req.auth.uid;
    const command = campaignCommandEntry(row, status, actor);
    await db.ref(`users/${userId}/campaignCommands/${command.campaignId}`).set(command);

    const token = META_TOKEN.value();
    if (!token) {
      throw new HttpsError("failed-precondition", "META_ACCESS_TOKEN belum di-set.");
    }

    try {
      await applyOneCampaignCommand(adminStore(db), token, userId, command.campaignId);
    } catch (error) {
      throw new HttpsError("internal", error.message);
    }
    return { campaignId: command.campaignId, status, campaign: row.campaign || "" };
  },
);

// Admin, atau orang yang campaign-nya sendiri. Cerminan aturan `users/$uid/campaignCommands` di
// database.rules.json — dicocokkan lewat email karena /users dikunci push-key, bukan uid, jadi
// tidak ada cara lain menghubungkan sebuah baris user dengan akun yang sedang login.
async function assertMayToggle(req, user) {
  // Lewat isAdmin(), bukan regex sendiri: salinan kelima aturan role di sini adalah yang tidak
  // ikut berubah waktu daftar role bertambah, dan bentuk kegagalannya "permission-denied" untuk
  // akun yang justru paling berhak.
  const role = String((await db.ref(`roles/${req.auth.uid}`).get()).val() || "");
  if (isAdmin(role)) return;

  const email = String(req.auth.token?.email || "").toLowerCase();
  if (email && email === String(user.email || "").toLowerCase()) return;

  throw new HttpsError(
    "permission-denied",
    "Hanya admin atau pemilik campaign yang boleh mengubah statusnya.",
  );
}

// Import GAM accounts from the networks each connected credential can access.
// Creates one gamAccounts record per new networkCode (skips ones already present).
export const importGamNetworks = onCall({ region: REGION, timeoutSeconds: 300 }, async (req) => {
  requireAuth(req);
  const configs = (await db.ref("googleApiConfigs").get()).val() || {};
  const existing = (await db.ref("gamAccounts").get()).val() || {};
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
    throw new HttpsError("failed-precondition", "Belum ada Google credential yang terhubung.");
  }

  let created = 0;
  const actor = req.auth.token?.email || "import";
  const perCredential = [];
  const errors = [];
  for (const cfg of connected) {
    const label = cfg.name || "(kredensial tanpa nama)";
    let nets;
    try {
      nets = await listNetworks(await accessTokenFrom(cfg));
    } catch (e) {
      // One broken credential must not hide what the others can see.
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
      await db.ref("gamAccounts").push({
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
});

// Import standalone AdSense accounts each connected credential can access.
// Creates one adsenseAccounts record per new publisher id (skips ones already present).
//
// Terpisah dari importGamNetworks karena daftarnya datang dari API yang berbeda — dan karena
// akun yang Ad Manager-nya belum disetujui Google justru HANYA muncul di sini.
export const importAdsenseAccounts = onCall(
  { region: REGION, timeoutSeconds: 300 },
  async (req) => {
    requireAuth(req);
    const configs = (await db.ref("googleApiConfigs").get()).val() || {};
    const existing = (await db.ref("adsenseAccounts").get()).val() || {};
    const seen = new Set(
      Object.values(existing)
        .filter((a) => a && !a.deletedAt)
        .map((a) => adsenseAccountName(a))
        .filter(Boolean),
    );

    const connected = Object.values(configs).filter((c) => c?.refreshToken);
    if (connected.length === 0) {
      throw new HttpsError("failed-precondition", "Belum ada Google credential yang terhubung.");
    }

    let created = 0;
    const actor = req.auth.token?.email || "import";
    const perCredential = [];
    const errors = [];
    for (const cfg of connected) {
      const label = cfg.name || "(kredensial tanpa nama)";
      let accounts;
      try {
        accounts = await listAccounts(await accessTokenFrom(cfg));
      } catch (e) {
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
        await db.ref("adsenseAccounts").push({
          name: acc.displayName || publisherId,
          provider: "adsense",
          accountName: resource,
          publisherId,
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
  },
);

// ---------------------------------------------------------------------------
// "Impor dari Google" for /domains and /sub-domains — sites come from the ad units each GAM
// network exposes, so no spreadsheet is involved. Logic lives in discover-core.js; these two
// only read, write, and translate errors.
// ---------------------------------------------------------------------------
async function discoverHosts() {
  const configs = (await db.ref("googleApiConfigs").get()).val() || {};
  const accounts = earningAccounts(
    (await db.ref("gamAccounts").get()).val() || {},
    (await db.ref("adsenseAccounts").get()).val() || {},
  );
  try {
    assertDiscoverable(accounts, configs);
  } catch (e) {
    throw new HttpsError("failed-precondition", e.message);
  }
  return collectHosts(accounts, configs, process.env.GAM_DISCOVER_DIMENSION);
}

// Same record shape the dashboard's own form writes, so imported rows look like hand-made ones.
async function pushAll(node, records, actor) {
  for (const values of records) {
    const target = db.ref(node).push();
    const now = new Date().toISOString();
    await target.set({
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

export const importGamDomains = onCall({ region: REGION, timeoutSeconds: 540 }, async (req) => {
  requireAuth(req);
  const { hosts, skipped, errors, sources } = await discoverHosts();
  const existing = (await db.ref("domains").get()).val() || {};
  const records = planDomains(hosts, existing);
  const created = await pushAll("domains", records, req.auth.token?.email || "import");
  return {
    created,
    found: hosts.size,
    skipped,
    errors,
    sources,
    summary: summarize("domain", created, { skipped, errors }),
  };
});

export const importGamSubdomains = onCall({ region: REGION, timeoutSeconds: 540 }, async (req) => {
  requireAuth(req);
  const { hosts, skipped, errors, sources } = await discoverHosts();
  const existingSubs = (await db.ref("subDomains").get()).val() || {};
  const existingDomains = (await db.ref("domains").get()).val() || {};
  const { records, orphans } = planSubdomains(hosts, existingSubs, existingDomains);
  const created = await pushAll("subDomains", records, req.auth.token?.email || "import");
  const extra = orphans
    ? `${orphans} belum punya domain induk — impor di halaman Domains dulu, lalu ulangi.`
    : "";
  return {
    created,
    found: hosts.size,
    orphans,
    skipped,
    errors,
    sources,
    summary: summarize("subdomain", created, { skipped, errors, extra }),
  };
});
