import {
  activeCopyJob,
  activeJobNames,
  adsToRepair,
  assertNamesFree,
  COPY_JOBS_PATH,
  copyJobEntry,
  copyOutcome,
  copyPlan,
  copyShortfall,
  interimCopySuffix,
  metaOutcomeUncertain,
  newCopyJobId,
  uncertainCopyError,
} from "./campaign-manage-core.js";
import { adPayload } from "./campaign-create-core.js";
import { clip, JobConflict, noteJob, sweepJobsAt } from "./campaign-jobs.mjs";
import {
  copyAdSetInto,
  copyCampaignShell,
  createAd,
  fetchAdSetAdNames,
  fetchAdSets,
  fetchCampaignAds,
  fetchCampaignSettings,
  updateCampaign,
} from "./meta.js";

/**
 * Job salinan campaign, BERTAHAP: campaign tanpa isi (bernama sementara) → langsung ganti nama →
 * tiap ad set ke dalamnya.
 *
 * Dua langkah dengan dua kontrak. `startCopyJob` memeriksa dan mencatat — ia boleh melempar, dan
 * route menjawabkan lemparannya. `runCopyJob` menyalin di latar sesudah route menjawab, dan TIDAK
 * PERNAH melempar: tiap kegagalannya jadi status job yang dibaca halaman. Job ditulis `requested`
 * SEBELUM Meta disentuh, dan tidak ada satu pun salinan yang diulang otomatis — yang sudah lahir
 * tidak bisa ditarik kembali.
 */


/**
 * Nama baru belum dipakai campaign mana pun di ad account itu (lihat `assertNamesFree`).
 *
 * Daftar yang diadu adalah bacaan yang SAMA dengan yang dileburkan sync (`fetchCampaignSettings`),
 * ditambah nama job salinan akun itu yang masih berjalan. Bacaan yang gagal melempar — dijawab 502
 * oleh route, bukan diloloskan diam-diam.
 */
export async function assertCampaignNamesFree(
  store,
  token,
  { account, names, exceptCampaignId = "", jobs },
) {
  const known = jobs ?? ((await store.read(COPY_JOBS_PATH)) || {});
  const settings = await fetchCampaignSettings(account.actId, token);
  assertNamesFree(names, [...settings, ...activeJobNames(known, account.id)], {
    exceptCampaignId,
  });
}

export async function startCopyJob(
  store,
  token,
  { userId, row, account, names, requestedBy = "", now = new Date() },
) {
  const jobs = (await store.read(COPY_JOBS_PATH)) || {};
  if (activeCopyJob(jobs, row.campaignId)) throw new JobConflict(
      "Salinan campaign ini masih berjalan — tunggu sampai selesai sebelum menyalin lagi.",
    );
  await assertCampaignNamesFree(store, token, { account, names, jobs });
  const adSets = await fetchAdSets(row.campaignId, token);
  const ads = await fetchCampaignAds(row.campaignId, token);
  const plan = copyPlan(adSets, ads);
  const jobId = newCopyJobId(now);
  await store.update(COPY_JOBS_PATH, {
    [jobId]: copyJobEntry({ source: row, userId, account, names, plan, requestedBy, now }),
  });
  return { jobId, plan };
}

async function renameCopy(campaignId, token, name) {
  try {
    await updateCampaign(campaignId, token, { name });
    return "";
  } catch (error) {
    // Ganti nama yang gagal tidak menggagalkan salinan: ia sudah lahir dengan nama sementara yang
    // unik, dan namanya bisa dibetulkan lewat fitur edit. Salinannya jadi `partial`.
    return clip(error.message);
  }
}

/**
 * Iklan yang tidak ikut tersalin, dibuatkan sendiri dengan creative iklan SUMBER.
 *
 * Deep copy Meta membuat creative BARU lewat app kita, dan app yang masih Development Mode menolak
 * tiap creative dengan `(#100-1885183)` — diam-diam, tanpa satu pun error di jawaban salinannya.
 * Menunjuk creative yang sudah ada tidak melahirkan creative apa pun, jadi penolakan itu tidak
 * berlaku; yang tersisa cuma izin beriklan di Halaman creative itu, dan ITU yang disebutkan kalau
 * masih gagal (dibuktikan ke produksi 12 Sep 2026, lihat lampiran spec).
 *
 * Konsekuensi yang diketahui dan diterima: iklan hasil pemulihan BERBAGI creative dengan iklan
 * sumbernya, jadi mengubah teks atau gambarnya di Ads Manager mengubah keduanya. Itu harga yang
 * dibayar untuk salinan yang punya iklan sama sekali — dan sesudah app-nya Live, deep copy melahirkan
 * creative-nya sendiri lagi dan fungsi ini tidak menemukan apa pun untuk dipulihkan.
 */
async function repairCopiedAds(token, { account, set, adSetId, copied }) {
  const adRows = set.adRows || [];
  if (copied >= adRows.length) return { born: 0, error: "" };
  let names = [];
  if (copied > 0) {
    // Yang sebagian tersalin tidak mengabarkan iklan yang MANA; namanya dibaca supaya yang sudah
    // berdiri tidak dibuatkan kembarannya.
    try {
      names = await fetchAdSetAdNames(adSetId, token);
    } catch (error) {
      return { born: 0, error: clip(`${set.name || set.id}: ${error.message}`) };
    }
  }
  let born = 0;
  let failure = "";
  for (const ad of adsToRepair(adRows, names)) {
    try {
      await createAd(
        account.actId,
        token,
        adPayload({ name: ad.name, adSetId, creativeId: ad.creativeId, status: ad.status }),
      );
      born++;
    } catch (error) {
      // Satu iklan yang ditolak tidak menghentikan sisanya — tapi sebab PERTAMA-nya disimpan utuh:
      // iklan berikutnya di ad set yang sama hampir selalu ditolak karena hal yang sama, dan
      // kalimat terakhir yang menang akan menyembunyikan yang pertama tanpa menambah apa pun.
      failure ||= clip(
        `${set.name || set.id}: iklan "${ad.name}" tidak bisa dibuatkan ulang${ad.pageId ? ` (Halaman ${ad.pageId})` : ""} — ${error.message}`,
      );
    }
  }
  return { born, error: failure };
}

async function copyOne(store, token, { jobPath, jobId, index, row, name, plan, progress, log, account }) {
  let campaignId;
  try {
    ({ campaignId } = await copyCampaignShell(row.campaignId, token, {
      suffix: interimCopySuffix(jobId, index),
    }));
  } catch (error) {
    // Kode 1/2, jaringan putus, atau halaman HTML: Meta bisa saja sudah membuat salinannya.
    return metaOutcomeUncertain(error.message)
      ? { name, campaignId: "", error: clip(uncertainCopyError(error.message)), uncertain: true }
      : { name, campaignId: "", error: clip(error.message) };
  }
  const copy = {
    name,
    campaignId,
    adSets: 0,
    adSetsExpected: plan.adSets.length,
    ads: 0,
    adsExpected: plan.adCount,
    error: "",
    renameError: "",
  };
  // Ganti nama SEBELUM ad set disalin, supaya nama sementaranya hidup sesingkat mungkin.
  copy.renameError = await renameCopy(campaignId, token, name);
  // Dicatat begitu ia ada, bukan cuma di tulisan akhir: proses yang mati di tengah ad set tidak
  // boleh meninggalkan salinan yang sudah lahir tanpa ID di job-nya.
  await noteJob(
    store,
    jobPath,
    { [`copies/${index}`]: { ...copy }, updatedAt: new Date().toISOString() },
    log,
    `salinan ${campaignId} job ${jobId}`,
  );
  let adSetError = "";
  for (const set of plan.adSets) {
    try {
      const { adSetId, adIds } = await copyAdSetInto(set.id, token, { campaignId });
      copy.adSets++;
      // Dipotong per ad set: iklan lebih di satu ad set tidak menutupi yang hilang di ad set lain.
      const copied = Math.min(adIds.length, set.ads);
      copy.ads += copied;
      const repair = await repairCopiedAds(token, { account, set, adSetId, copied });
      copy.ads += repair.born;
      adSetError ||= repair.error;
    } catch (error) {
      // Satu ad set yang ditolak tidak menghentikan sisanya: yang lain bisa saja memakai Halaman yang
      // izinnya sudah benar.
      adSetError ||= clip(`${set.name || set.id}: ${error.message}`);
    }
    progress.done++;
    await noteJob(
      store,
      jobPath,
      { progress: { ...progress }, updatedAt: new Date().toISOString() },
      log,
      `progres job ${jobId}`,
    );
  }
  copy.error = adSetError || copyShortfall(copy);
  return copy;
}

export async function runCopyJob(
  store,
  token,
  { jobId, row, account, names, plan, enqueueSync = () => {}, log = console },
) {
  const jobPath = `${COPY_JOBS_PATH}/${jobId}`;
  const copies = [];
  try {
    const progress = { done: 0, total: names.length * plan.adSets.length };
    const startedAt = new Date().toISOString();
    await store.update(jobPath, { state: "running", startedAt, updatedAt: startedAt, progress });
    for (const [index, name] of names.entries()) {
      // Sesudah satu campaign gagal (atau tidak pasti) disalin, sisanya tidak dicoba: penolakan yang
      // sama akan berulang, dan yang kebetulan lolos menghasilkan salinan yang tidak diharapkan.
      if (copies.some((copy) => !copy.campaignId)) {
        copies.push({ name, campaignId: "", error: "Tidak dicoba karena salinan sebelumnya gagal." });
        continue;
      }
      copies.push(
        await copyOne(store, token, {
          jobPath,
          jobId,
          index,
          row,
          name,
          plan,
          progress,
          log,
          account,
        }),
      );
    }
  } catch (error) {
    // Hanya tulisan `running` yang bisa sampai ke sini (panggilan Meta dan tulisan progres ditangkap
    // di dalam `copyOne`), jadi belum ada satu salinan pun yang lahir.
    copies.push({ name: "", campaignId: "", error: clip(error.message) });
  }

  const outcome = copyOutcome(copies);
  const at = new Date().toISOString();
  try {
    await store.update(jobPath, {
      state: outcome.state,
      copies,
      error: clip(outcome.error),
      updatedAt: at,
      finishedAt: at,
    });
  } catch (error) {
    // Job tertinggal `running` dan disapu jadi `unknown` — kalimatnya menyuruh memeriksa Ads Manager.
    log.error(`[campaign] job salinan ${jobId} gagal dicatat: ${error.message}`);
  }
  // Yang tidak pasti ikut disync: kalau salinannya ternyata lahir, ia muncul di tabel dengan nama
  // sementaranya yang unik.
  if (copies.some((copy) => copy.campaignId || copy.uncertain)) enqueueSync(account.id);
  return { jobId, state: outcome.state, copies, error: outcome.error };
}

export async function sweepCopyJobs(store, options) {
  return sweepJobsAt(store, COPY_JOBS_PATH, options);
}
