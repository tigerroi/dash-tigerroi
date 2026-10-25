import { expiredCopyJobIds, stalledJobPatch } from "./campaign-manage-core.js";

/**
 * Yang sama antara job SALIN dan job BUAT campaign.
 *
 * Keduanya punya node sendiri karena bentuk barisnya memang berbeda — satu membawa campaign sumber,
 * satu membawa tujuan iklannya — tapi cara keduanya menggantung, kedaluwarsa, dan mencatat progres
 * persis sama. Ditulis dua kali, salah satunya akan berhenti menyapu job-nya sendiri suatu hari,
 * dan yang terlihat cuma job "Berjalan" yang tidak pernah selesai.
 */

// Satu sumber, satu job; satu nama, satu job. Ditolak 409 — bukan 422: yang menghalangi bukan
// isian orangnya melainkan job yang masih berjalan, dan itu hilang sendiri.
export class JobConflict extends Error {
  constructor(message) {
    super(message || "Pekerjaan ini masih berjalan — tunggu sampai selesai sebelum mengulanginya.");
    this.status = 409;
  }
}

// Pesan Meta bisa panjang; aturan database membatasi 1000 karakter.
export const clip = (text) => String(text || "").slice(0, 1000);

/**
 * Catatan progres: yang gagal ditulis dicatat di log, lalu DILEWATI.
 *
 * Ia cuma kosmetik — yang menentukan hasil job adalah tulisan akhirnya. Dilempar, kegagalan menulis
 * satu angka progres akan menghapus catatan objek yang sudah terlanjur lahir di Meta.
 */
export async function noteJob(store, path, values, log, what) {
  try {
    await store.update(path, values);
  } catch (error) {
    log.error(`[campaign] ${what} gagal dicatat: ${error.message}`);
  }
}

/**
 * Sapu satu node job: yang menggantung jadi `unknown`, yang lebih dari 7 hari dibuang.
 *
 * Menulis HANYA path yang berubah — tulisan akhir sebuah job yang datang bersamaan tidak boleh
 * tertimpa salinan job yang dibaca sweep beberapa saat sebelumnya.
 */
export async function sweepJobsAt(store, path, { now = new Date() } = {}) {
  const jobs = (await store.read(path)) || {};
  const updates = {};
  let changed = 0;
  for (const [jobId, job] of Object.entries(jobs)) {
    const stalled = stalledJobPatch(job, now);
    if (!stalled) continue;
    changed++;
    for (const [key, value] of Object.entries(stalled)) updates[`${jobId}/${key}`] = value;
  }
  for (const jobId of expiredCopyJobIds(jobs, now)) {
    changed++;
    updates[jobId] = null;
  }
  if (changed) await store.update(path, updates);
  return { changed };
}
