import { Elysia, status, t } from "elysia";
import {
  assertCampaignNamesFree,
  runCopyJob,
  startCopyJob,
} from "../functions/campaign-copy-jobs.mjs";
import { JobConflict } from "../functions/campaign-jobs.mjs";
import {
  accountOfCampaignRow,
  assertConfirmed,
  budgetState,
  ConfirmRequired,
  campaignNameVerdict,
  copyNames,
  mergeTargeting,
  metaFailureStatus,
  parseBudget,
  RuleError,
  targetingState,
} from "../functions/campaign-manage-core.js";
import {
  fetchAdSetForEdit,
  fetchCampaignForEdit,
  updateAdSet,
  updateCampaign,
} from "../functions/meta.js";
import { buildCodeIndex } from "../functions/sync-core.js";
import { AuthError, bearerToken, requireSuperAdmin } from "./auth.js";
import { campaignRowOf } from "./campaign-rows.js";

/**
 * Halaman Campaign (/campaigns): salin dan ubah campaign Meta. SUPERADMIN saja.
 *
 * Yang menegakkan izinnya gerbang di sini, bukan aturan database: anggaran, nama, dan targeting
 * tidak menulis satu pun baris RTDB. Campaign dicari di profil pemiliknya (`campaignRowOf`) dan ad
 * set dibuktikan milik campaign itu dengan membacanya ulang dari Meta — tanpa keduanya, route ini
 * jadi editor Meta untuk objek mana pun di Business Manager.
 *
 * Salinan dijalankan DI LATAR sesudah route menjawab: satu salinan bisa berarti puluhan panggilan
 * (campaign, lalu tiap ad set), dan progresnya sudah ditulis ke node job yang dilanggan halaman.
 */
const USER_ID = t.String({ minLength: 1, maxLength: 128 });
const CAMPAIGN_PARAMS = t.Object({ campaignId: t.String({ pattern: "^[0-9]+$" }) });
const ADSET_PARAMS = t.Object({
  campaignId: t.String({ pattern: "^[0-9]+$" }),
  adSetId: t.String({ pattern: "^[0-9]+$" }),
});
const BUDGET = t.Optional(t.Union([t.Number(), t.String({ maxLength: 20 })]));
const CONFIRM = t.Optional(t.String({ maxLength: 300 }));

// `runCopyJob` tidak pernah melempar — tapi penolakan yang lolos dari tugas yang tidak ditunggu
// siapa pun menjatuhkan seluruh proses Bun, jadi yang melempar suatu hari tetap tertangkap di sini.
export const detached = (task, log = console) => {
  Promise.resolve()
    .then(task)
    .catch((error) => log.error(`[campaign] tugas latar melempar: ${error?.message || error}`));
};

export function campaignManageRoutes({
  db,
  store,
  metaToken,
  enqueueSync = () => {},
  runInBackground = detached,
  authorize,
}) {
  const check = authorize || ((token) => requireSuperAdmin(db, token));
  // Campaign sumber yang sedang disalin oleh proses ini (lihat route salin).
  const copying = new Set();

  const failure = (error) => {
    if (error instanceof ConfirmRequired) {
      return status(409, { error: error.message, needsConfirm: true, subDomain: error.subDomain });
    }
    if (error instanceof RuleError || error instanceof JobConflict) {
      return status(error.status, { error: error.message });
    }
    return status(metaFailureStatus(error?.message), {
      error: error?.message || "Meta tidak menjawab.",
    });
  };

  const owned = async (userId, campaignId) => {
    if (!metaToken)
      return { stop: status(503, { error: "META_ACCESS_TOKEN belum di-set di server." }) };
    const { row, notFound } = await campaignRowOf(store, userId, campaignId);
    return notFound ? { stop: notFound } : { row };
  };

  const codeIndex = async () => buildCodeIndex((await store.read("subDomains")) || {}).byCode;
  const accountOf = async (row) =>
    accountOfCampaignRow((await store.read("adAccounts")) || {}, row);

  const ownedAdSet = async (campaignId, adSetId) => {
    const adSet = await fetchAdSetForEdit(adSetId, metaToken);
    return adSet.campaignId === String(campaignId)
      ? { adSet }
      : { stop: status(404, { error: "Ad set ini bukan milik campaign tersebut." }) };
  };

  return new Elysia({ prefix: "/fleet" })
    .macro({
      superadmin: {
        async resolve({ headers }) {
          try {
            return { actor: await check(bearerToken(headers.authorization)) };
          } catch (error) {
            if (error instanceof AuthError) {
              return status(error.status, {
                error:
                  error.status === 403
                    ? "Hanya superadmin yang boleh mengelola campaign."
                    : error.message,
              });
            }
            return status(503, { error: `Izin tidak bisa diperiksa sekarang: ${error.message}` });
          }
        },
      },
    })

    .post(
      "/campaigns/:campaignId/copies",
      async ({ params, body, actor }) => {
        const { row, stop } = await owned(body.userId, params.campaignId);
        if (stop) return stop;
        try {
          const names = copyNames(body.name, body.count);
          assertConfirmed(
            campaignNameVerdict(row, names[0], await codeIndex()),
            body.confirmSubDomain,
          );
          const account = await accountOf(row);
          if (!account)
            throw new RuleError("Ad account campaign ini tidak terdaftar di /ad-accounts.");
          // Penjaga di dalam proses, dipegang dari SEBELUM pemeriksaan job aktif sampai penyalinan
          // selesai: dua klik yang datang bersamaan sama-sama membaca daftar job sebelum yang lain
          // sempat menulis, dan pemeriksaan RTDB saja meloloskan keduanya.
          const source = String(row.campaignId);
          if (copying.has(source))
            throw new JobConflict(
              "Salinan campaign ini masih berjalan — tunggu sampai selesai sebelum menyalin lagi.",
            );
          copying.add(source);
          let handedOff = false;
          try {
            // Nama yang sudah dipakai di akun itu ditolak di dalam `startCopyJob`, sebelum tulisan.
            const { jobId, plan } = await startCopyJob(store, metaToken, {
              userId: body.userId,
              row,
              account,
              names,
              requestedBy: actor.email || actor.uid,
            });
            runInBackground(() =>
              runCopyJob(store, metaToken, {
                jobId,
                row,
                account,
                names,
                plan,
                enqueueSync,
              }).finally(() => copying.delete(source)),
            );
            handedOff = true;
            return { jobId, state: "running", adSets: plan.adSets.length, ads: plan.adCount };
          } finally {
            if (!handedOff) copying.delete(source);
          }
        } catch (error) {
          return failure(error);
        }
      },
      {
        superadmin: true,
        params: CAMPAIGN_PARAMS,
        body: t.Object({
          userId: USER_ID,
          name: t.String({ minLength: 1, maxLength: 400 }),
          count: t.Integer({ minimum: 1, maximum: 5 }),
          confirmSubDomain: CONFIRM,
        }),
      },
    )

    .get(
      "/campaigns/:campaignId",
      async ({ params, query }) => {
        const { row, stop } = await owned(query.userId, params.campaignId);
        if (stop) return stop;
        try {
          const campaign = await fetchCampaignForEdit(params.campaignId, metaToken);
          return {
            campaign: { ...campaign, budget: budgetState("campaign", campaign) },
            mapping: {
              subDomain: row.subDomain || "",
              source: row.subDomainSource || "",
              code: row.campaignCode || "",
            },
          };
        } catch (error) {
          return failure(error);
        }
      },
      { superadmin: true, params: CAMPAIGN_PARAMS, query: t.Object({ userId: USER_ID }) },
    )

    .post(
      "/campaigns/:campaignId",
      async ({ params, body }) => {
        const { row, stop } = await owned(body.userId, params.campaignId);
        if (stop) return stop;
        try {
          const changes = {};
          if (body.name !== undefined) {
            const name = body.name.trim();
            assertConfirmed(
              campaignNameVerdict(row, name, await codeIndex()),
              body.confirmSubDomain,
            );
            changes.name = name;
          }
          if (body.dailyBudget !== undefined) {
            const budget = budgetState(
              "campaign",
              await fetchCampaignForEdit(params.campaignId, metaToken),
            );
            if (!budget.editable) throw new RuleError(budget.reason);
            changes.dailyBudget = parseBudget(body.dailyBudget);
          }
          if (!Object.keys(changes).length) throw new RuleError("Tidak ada yang diubah.");
          // Nama yang sama dengan campaign lain di akun itu dilebur sync jadi satu baris. Diperiksa
          // TIAP kali nama dikirim, termasuk yang tampak "tidak berubah": pembandingnya nama di baris
          // tabel, yang basi persis saat campaign baru diganti nama di Ads Manager — dan kembali ke
          // nama lama itu justru bisa menabrak campaign lain yang sudah memakainya. Nama campaign ini
          // sendiri di Meta tidak dihitung bentrok (`exceptCampaignId`).
          const account = changes.name !== undefined ? await accountOf(row) : null;
          if (changes.name !== undefined) {
            if (!account)
              throw new RuleError("Ad account campaign ini tidak terdaftar di /ad-accounts.");
            await assertCampaignNamesFree(store, metaToken, {
              account,
              names: [changes.name],
              exceptCampaignId: params.campaignId,
            });
          }
          await updateCampaign(params.campaignId, metaToken, changes);
          // Penyegaran dua menitan tidak membaca nama, padahal nama itulah pemetaannya.
          if (changes.name && account) enqueueSync(account.id);
          return { campaignId: params.campaignId, applied: true, changed: Object.keys(changes) };
        } catch (error) {
          return failure(error);
        }
      },
      {
        superadmin: true,
        params: CAMPAIGN_PARAMS,
        body: t.Object({
          userId: USER_ID,
          name: t.Optional(t.String({ minLength: 1, maxLength: 400 })),
          dailyBudget: BUDGET,
          confirmSubDomain: CONFIRM,
        }),
      },
    )

    .get(
      "/campaigns/:campaignId/adsets/:adSetId",
      async ({ params, query }) => {
        const { stop } = await owned(query.userId, params.campaignId);
        if (stop) return stop;
        try {
          const found = await ownedAdSet(params.campaignId, params.adSetId);
          if (found.stop) return found.stop;
          // Targeting mentah TIDAK dikirim ke browser: yang digambar form cuma negara dan umur, dan
          // yang ditulis kembali disusun server dari bacaan segar, bukan dari salinan di layar.
          const { targeting, ...adSet } = found.adSet;
          return {
            adSet: {
              ...adSet,
              budget: budgetState("adset", adSet),
              targeting: targetingState(targeting),
            },
          };
        } catch (error) {
          return failure(error);
        }
      },
      { superadmin: true, params: ADSET_PARAMS, query: t.Object({ userId: USER_ID }) },
    )

    .post(
      "/campaigns/:campaignId/adsets/:adSetId",
      async ({ params, body }) => {
        const { stop } = await owned(body.userId, params.campaignId);
        if (stop) return stop;
        try {
          const found = await ownedAdSet(params.campaignId, params.adSetId);
          if (found.stop) return found.stop;
          const current = found.adSet;
          const changes = {};
          if (body.name !== undefined) {
            const name = body.name.trim();
            if (!name) throw new RuleError("Nama ad set wajib diisi.");
            changes.name = name;
          }
          if (body.dailyBudget !== undefined) {
            const budget = budgetState("adset", current);
            if (!budget.editable) throw new RuleError(budget.reason);
            changes.dailyBudget = parseBudget(body.dailyBudget);
          }
          if (
            body.countries !== undefined ||
            body.ageMin !== undefined ||
            body.ageMax !== undefined
          ) {
            changes.targeting = mergeTargeting(current.targeting, {
              countries: body.countries,
              ageMin: body.ageMin,
              ageMax: body.ageMax,
            });
          }
          if (!Object.keys(changes).length) throw new RuleError("Tidak ada yang diubah.");
          await updateAdSet(current.id, metaToken, changes);
          return {
            campaignId: params.campaignId,
            adSetId: current.id,
            applied: true,
            changed: Object.keys(changes),
          };
        } catch (error) {
          return failure(error);
        }
      },
      {
        superadmin: true,
        params: ADSET_PARAMS,
        body: t.Object({
          userId: USER_ID,
          name: t.Optional(t.String({ maxLength: 400 })),
          dailyBudget: BUDGET,
          countries: t.Optional(t.Array(t.String({ maxLength: 8 }), { maxItems: 250 })),
          ageMin: t.Optional(t.Number()),
          ageMax: t.Optional(t.Number()),
        }),
      },
    );
}
