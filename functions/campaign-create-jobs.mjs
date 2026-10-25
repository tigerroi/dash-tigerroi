import {
  activeCreateJob,
  adPayload,
  adSetPayload,
  campaignPayload,
  CREATE_JOBS_PATH,
  createJobEntry,
  createOutcome,
  creativePayload,
  pendingCreateNames,
  resumeCreatePlan,
} from "./campaign-create-core.js";
import { clip, JobConflict, noteJob, sweepJobsAt } from "./campaign-jobs.mjs";
import { assertNamesFree, metaOutcomeUncertain, newCopyJobId } from "./campaign-manage-core.js";
import {
  createAd,
  createAdCreative,
  createAdSet,
  createCampaign,
  fetchCampaignSettings,
  META_MINOR_UNIT,
} from "./meta.js";

/**
 * Job "Buat campaign": satu campaign, lalu satu ad set + satu creative + satu iklan per variasi.
 *
 * Kontraknya sama persis dengan job salinan (campaign-copy-jobs.mjs), dan sengaja: `startCreateJob`
 * memeriksa dan mencatat — ia boleh melempar, dan route menjawabkan lemparannya — sementara
 * `runCreateJob` berjalan di latar sesudah route menjawab dan TIDAK PERNAH melempar, karena tidak
 * ada siapa pun lagi yang menunggu jawabannya; tiap kegagalannya jadi status job yang dibaca
 * halaman.
 *
 * Tidak satu pun panggilannya diulang otomatis: objek yang terlanjur lahir tidak bisa ditarik
 * kembali, dan kode 1/2 bisa datang sesudah Meta membuatnya (`metaOutcomeUncertain`).
 */

/**
 * Nama campaign baru belum dipakai siapa pun di ad account itu.
 *
 * Bacaan yang SAMA dengan yang dileburkan sync (`fetchCampaignSettings`), ditambah nama job buat
 * akun itu yang masih berjalan — yang kedua belum ada di Meta, dan tanpa itu dua job yang menuju
 * nama yang sama baru ketahuan bentrok sesudah keduanya lahir.
 */
export async function assertCreateNameFree(store, token, { account, name, jobs }) {
  const known = jobs ?? ((await store.read(CREATE_JOBS_PATH)) || {});
  const settings = await fetchCampaignSettings(account.actId, token);
  assertNamesFree([name], [...settings, ...pendingCreateNames(known, account.id)]);
}

export async function startCreateJob(
  store,
  token,
  { plan, account, requestedBy = "", now = new Date() },
) {
  const jobs = (await store.read(CREATE_JOBS_PATH)) || {};
  if (activeCreateJob(jobs, account.id, plan.name)) {
    throw new JobConflict(
      "Campaign dengan nama itu sedang dibuat — tunggu sampai selesai sebelum mengulanginya.",
    );
  }
  await assertCreateNameFree(store, token, { account, name: plan.name, jobs });
  const jobId = newCopyJobId(now);
  await store.update(CREATE_JOBS_PATH, {
    [jobId]: createJobEntry({ plan, account, requestedBy, now }),
  });
  return { jobId };
}

/**
 * Satu variasi: ad set → creative → iklan.
 *
 * Ketiganya dicatat begitu lahir, bukan cuma di tulisan akhir — proses yang mati di tengah tidak
 * boleh meninggalkan objek yang sudah berdiri di Meta tanpa ID di job-nya. Yang gagal di langkah
 * mana pun mengembalikan barisnya berikut sebab dan ID yang SUDAH sempat lahir, supaya yang
 * membereskannya tahu apa yang harus dihapus.
 */
async function createVariant(
  store,
  token,
  { jobPath, jobId, index, plan, name, variant, log, start = {} },
) {
  // `start` membawa ID yang SUDAH lahir saat pekerjaan ini dilanjutkan: langkah yang punya ID-nya
  // dilewati, jadi tidak ada ad set, creative, atau iklan yang lahir dua kali.
  const row = {
    name,
    adSetId: start.adSetId || "",
    creativeId: start.creativeId || "",
    adId: start.adId || "",
    error: "",
  };
  const record = async () => {
    await noteJob(
      store,
      jobPath,
      { [`adSets/${index}`]: { ...row }, updatedAt: new Date().toISOString() },
      log,
      `variasi ${index + 1} job ${jobId}`,
    );
  };
  try {
    if (!row.adSetId) {
      row.adSetId = await createAdSet(
        plan.actId,
        token,
        adSetPayload(plan, { name, campaignId: plan.campaignId }),
      );
      await record();
    }
    if (!row.creativeId) {
      row.creativeId = await createAdCreative(
        plan.actId,
        token,
        creativePayload(plan, { name, variant }),
      );
      await record();
    }
    row.adId = await createAd(
      plan.actId,
      token,
      adPayload({ name, adSetId: row.adSetId, creativeId: row.creativeId }),
    );
  } catch (error) {
    row.error = clip(`${name}: ${error.message}`);
  }
  await record();
  return row;
}

export async function runCreateJob(
  store,
  token,
  { jobId, plan, account, resume = null, enqueueSync = () => {}, log = console },
) {
  const jobPath = `${CREATE_JOBS_PATH}/${jobId}`;
  // Dilanjutkan (`resumeCreatePlan`): campaign-nya sudah ada, dan variasi yang sudah beriklan atau
  // gagal dengan hasil tidak pasti dibiarkan apa adanya.
  let campaignId = resume?.campaignId || "";
  let campaignError = "";
  let uncertain = false;
  const adSets = [];
  try {
    const startedAt = new Date().toISOString();
    await store.update(jobPath, {
      state: "running",
      startedAt,
      updatedAt: startedAt,
      progress: { done: 0, total: plan.names.length },
    });
    try {
      campaignId ||= await createCampaign(
        account.actId,
        token,
        campaignPayload(plan, META_MINOR_UNIT),
      );
    } catch (error) {
      // Kode 1/2, jaringan putus, atau balasan non-JSON: Meta bisa saja sudah membuat campaign-nya,
      // dan "gagal" di sana membuat orang mengirim form yang sama sekali lagi.
      uncertain = metaOutcomeUncertain(error.message);
      campaignError = clip(error.message);
    }
    if (campaignId && !resume) {
      await noteJob(
        store,
        jobPath,
        { campaignId, updatedAt: new Date().toISOString() },
        log,
        `campaign ${campaignId} job ${jobId}`,
      );
    }
    if (campaignId) {
      // `plan` diperkaya dengan alamat yang baru lahir, supaya payload ad set tidak perlu menebaknya.
      const full = { ...plan, campaignId, actId: account.actId };
      for (const [index, name] of plan.names.entries()) {
        const start = resume?.adSets?.[index];
        const keep = start && (start.adId || metaOutcomeUncertain(start.error));
        adSets.push(
          keep
            ? { name, adSetId: "", creativeId: "", adId: "", error: "", ...start }
            : await createVariant(store, token, {
                jobPath,
                jobId,
                index,
                plan: full,
                name,
                variant: plan.variants[index],
                log,
                start,
              }),
        );
        await noteJob(
          store,
          jobPath,
          {
            progress: { done: index + 1, total: plan.names.length },
            updatedAt: new Date().toISOString(),
          },
          log,
          `progres job ${jobId}`,
        );
      }
    }
  } catch (error) {
    // Hanya tulisan `running` yang bisa sampai ke sini — panggilan Meta ditangkap di dalam.
    campaignError ||= clip(error.message);
  }

  const outcome = createOutcome({ campaignId, campaignError, uncertain, adSets });
  const at = new Date().toISOString();
  try {
    await store.update(jobPath, {
      state: outcome.state,
      campaignId,
      adSets,
      error: clip(outcome.error),
      updatedAt: at,
      finishedAt: at,
    });
  } catch (error) {
    // Job tertinggal `running` dan disapu jadi `unknown` — kalimatnya menyuruh memeriksa Ads Manager.
    log.error(`[campaign] job buat ${jobId} gagal dicatat: ${error.message}`);
  }
  // Yang tidak pasti ikut disync: kalau campaign-nya ternyata lahir, ia muncul di tabel dengan
  // namanya sendiri alih-alih hilang sampai sync per jam berikutnya.
  if (campaignId || uncertain) enqueueSync(account.id);
  return { jobId, state: outcome.state, campaignId, adSets, error: outcome.error };
}

/**
 * Lanjutkan job `partial`: periksa (boleh melempar, route menjawabkannya), lalu tandai `requested`
 * — sepola `startCreateJob`. Yang menjalankannya tetap `runCreateJob`, dengan `resume`.
 */
export async function startResumeCreateJob(store, jobId, { now = new Date() } = {}) {
  const job = await store.read(`${CREATE_JOBS_PATH}/${jobId}`);
  if (!job) throw new JobConflict("Pekerjaan itu sudah tidak ada.");
  const resume = resumeCreatePlan(job, now);
  const at = now.toISOString();
  await store.update(`${CREATE_JOBS_PATH}/${jobId}`, {
    state: "requested",
    error: "",
    updatedAt: at,
  });
  return { job, resume };
}

export async function sweepCreateJobs(store, options) {
  return sweepJobsAt(store, CREATE_JOBS_PATH, options);
}
