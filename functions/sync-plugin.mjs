// Operasi plugin RabbitROI yang menyentuh RTDB: menyelesaikan alamat situs, menyimpan kunci,
// mencerminkan status, dan menjalankan satu perintah ke banyak situs sekaligus.
//
// Modul INI yang dipanggil server kontrol dan siklus ping — bukan `plugin-api.mjs` langsung. Yang
// dijaga di sini adalah dua hal yang tidak boleh diputuskan di sisi route:
//
//   1. Hostname datang dari `subDomains`, TIDAK PERNAH dari request.
//   2. Tiap jawaban — berhasil maupun gagal — menulis cerminnya, jadi tidak ada tombol yang
//      menghasilkan perubahan yang tidak terbaca di halaman.

import {
  PLUGIN_ISSUES_BRANCH,
  PLUGIN_KEYS_PATH,
  PLUGIN_SITES_PATH,
  PluginError,
  bulkRow,
  bulkSummary,
  deploymentOutcome,
  deploymentTasks,
  landingLink,
  landingRows,
  legalOutcome,
  legalPageList,
  pluginKeyEntry,
  pluginPingIds,
  pluginSiteRow,
  toPluginPayload,
  unappliedFields,
  normalizeVersion,
  pluginUpdateRow,
  updateOutcome,
  updatePayload,
} from "./plugin-core.js";
import {
  buildGptTags,
  gamAccountForSite,
  gptDivPrefix,
  gptUnitChoices,
  gptStampClock,
  normalizeGptDivStamps,
  mergeGptHeader,
  normalizeGptOptions,
  normalizeGptSpec,
  pickGptUnit,
  planGptBodies,
} from "./gpt-inject-core.js";
import { listAdUnits } from "./gam.js";
import { auditSite } from "./plugin-audit-core.js";
import {
  adsenseSizeLabel,
  normalizeAdsenseCodes,
  planAdsenseBodies,
  verifyAdsenseSlots,
} from "./adsense-inject-core.js";
import {
  accountResourceName,
  listAdUnits as listAdsenseUnits,
  listSites as listAdsenseSites,
} from "./adsense.js";
import {
  createLandingPreset,
  enrollSite,
  generateLegalPages,
  listLandings,
  readDeployment,
  readLegalPages,
  readLicense,
  runDeployment,
  writeLicense,
  pingSite,
  readConfig,
  readLanding,
  resetSite,
  saveLanding,
  writeConfig,
  updateSite,
} from "./plugin-api.mjs";
import {
  AUTOPOST_MAX_KEYWORDS,
  autopostKeywords,
  jobList,
  jobRow,
  keywordResult,
  submitRow,
  submitSummary,
  toAutopostPayload,
  toKeywordPayload,
} from "./autopost-core.js";
import {
  generateKeywords,
  listAutopostJobs,
  readAutopostJob,
  submitAutopostJob,
} from "./autopost-api.mjs";
import {
  SYNC_ISSUES_PATH,
  SYNC_RETRY_PATH,
  accountToken,
  dueRetries,
  retryOutcome,
  retryRunning,
  retrySeed,
  syncIssuesUpdate,
} from "./sync-core.js";

/**
 * Berapa situs yang dihubungi bersamaan saat menerapkan ke banyak situs.
 *
 * Bukan tanpa batas: 200 subdomain dikirimi request serentak akan menghabiskan soket proses ini dan
 * — lebih penting — sebagian besar armada tinggal di shared hosting yang sama, jadi yang kita
 * banjiri adalah server kita sendiri. Bukan pula satu per satu: 200 situs × 3 detik = sepuluh menit
 * dengan seseorang menatap layar.
 */
const CONCURRENCY = Math.max(1, Number(process.env.PLUGIN_CONCURRENCY || 6));

// --- Alamat & kunci -------------------------------------------------------------------------------

/**
 * ID subdomain → baris subdomainnya. Melempar kalau tidak ada.
 *
 * Ini gerbang yang membuat enroll token tidak bisa diarahkan ke host sembarangan. Request hanya
 * membawa ID push-key RTDB; hostname-nya dibaca dari baris itu, jadi host yang tidak terdaftar di
 * `subDomains` tidak punya cara masuk ke sini sama sekali.
 */
export async function resolveSite(store, subdomainId) {
  const id = String(subdomainId || "").trim();
  if (!id) throw new PluginError("ID subdomain tidak dikirim.");

  const row = await store.read(`subDomains/${id}`);
  if (!row) throw new PluginError("Subdomain ini tidak ada di dashboard.");
  if (!row.name) throw new PluginError("Baris subdomain ini tidak punya nama host.");
  return {
    id,
    name: String(row.name),
    pic: String(row.pic || ""),
    status: String(row.status || ""),
    // Dibaca inject kode Ad Manager untuk menemukan akun GAM subdomain ini.
    parentDomain: String(row.parentDomain || ""),
  };
}

async function siteKey(store, subdomainId) {
  const entry = await store.read(`${PLUGIN_KEYS_PATH}/${subdomainId}`);
  const key = String(entry?.apiKey || "").trim();
  if (!key) {
    throw new PluginError(
      "Situs ini belum pernah enroll dari dashboard — tidak ada kunci yang bisa dipakai.",
      { code: "no_key" },
    );
  }
  return key;
}

// --- Cermin status ---------------------------------------------------------------------------------

async function writeSiteRow(store, site, patch, now = new Date()) {
  const previous = await store.read(`${PLUGIN_SITES_PATH}/${site.id}`);
  const row = pluginSiteRow(site, patch, previous, now);
  await store.replace(`${PLUGIN_SITES_PATH}/${site.id}`, row);
  return row;
}

// Jawaban berhasil menghapus kegagalan terakhir. Dibiarkan, halaman akan menampilkan situs yang
// baru saja menjawab dengan lencana merah dari kegagalan kemarin.
function okPatch(extra = {}, now = new Date()) {
  return { ...extra, lastSeenAt: now.toISOString(), error: "", errorCode: "", errorAt: "" };
}

function errorPatch(error, now = new Date()) {
  return {
    error: String(error?.message || error || "Gagal tanpa keterangan."),
    errorCode: String(error?.code || ""),
    errorAt: now.toISOString(),
  };
}

/**
 * Jalankan satu operasi terhadap satu situs, dan catat hasilnya di cermin apa pun yang terjadi.
 *
 * Semua operasi di bawah lewat sini, termasuk yang hanya MEMBACA. Membaca pengaturan membuktikan
 * situsnya hidup sama kuatnya dengan ping — dan situs yang baru saja dibuka konfigurasinya tapi
 * tertulis "belum pernah dihubungi" akan membuat orang menekan ping untuk sesuatu yang sudah jelas.
 */
async function withMirror(store, site, run, patchOf = () => ({})) {
  const now = new Date();
  try {
    const result = await run();
    await writeSiteRow(store, site, okPatch(patchOf(result), now), now);
    return result;
  } catch (error) {
    await writeSiteRow(store, site, errorPatch(error, now), now);
    throw error;
  }
}

// --- Enroll & lepas --------------------------------------------------------------------------------

/**
 * Enroll satu situs dan simpan kuncinya.
 *
 * Kunci ditulis SEBELUM baris statusnya. Proses yang mati di antara keduanya meninggalkan situs
 * yang enrolled dengan kunci tersimpan tapi status "belum" — itu bisa diperbaiki dengan ping. Urutan
 * sebaliknya meninggalkan situs yang enrolled TANPA kunci tersimpan, dan itu tidak bisa diperbaiki
 * sama sekali dari dashboard: enroll ulang ditolak `already_enrolled`, dan reset butuh kunci yang
 * tidak pernah sempat disimpan.
 */
export async function enrollOne(store, subdomainId, enrollToken, actor) {
  const site = await resolveSite(store, subdomainId);
  const now = new Date();

  let data;
  try {
    data = await enrollSite(site.name, enrollToken);
  } catch (error) {
    await writeSiteRow(store, site, errorPatch(error, now), now);
    throw error;
  }

  /**
   * Kunci gagal disimpan = enrollment harus DIBATALKAN, bukan dibiarkan.
   *
   * Situsnya sudah enrolled pada titik ini — `enroll` sekali seumur hidup, dan kuncinya tidak akan
   * pernah ditampilkan lagi. Kalau tulisan ke RTDB gagal (aturan `pluginKeys` belum di-deploy,
   * SYNC_USER kehilangan role, database tak terjangkau), yang tertinggal adalah situs enrolled yang
   * kuncinya hilang selamanya: enroll ulang dijawab `already_enrolled`, dan reset butuh kunci yang
   * tidak pernah sempat disimpan. Satu-satunya jalan keluar jadi masuk ke WordPress situs itu.
   *
   * Di sini kuncinya masih ada di memori, jadi masih bisa dipakai membatalkan. Setelah baris ini
   * lewat, kesempatan itu hilang.
   */
  try {
    await store.replace(`${PLUGIN_KEYS_PATH}/${site.id}`, pluginKeyEntry(data.api_key, actor, now));
  } catch (error) {
    let rolledBack = false;
    try {
      await resetSite(site.name, data.api_key);
      rolledBack = true;
    } catch {
      // Pembatalannya sendiri gagal — situs itu sekarang benar-benar terkunci, dan itu harus
      // terbaca sebagai kalimat yang menyebut apa yang perlu dilakukan orang, bukan sebagai
      // kegagalan menulis database yang terdengar seperti bisa dicoba lagi.
    }

    await writeSiteRow(store, site, errorPatch(error, now), now);
    throw new PluginError(
      rolledBack
        ? `Kunci ${site.name} gagal disimpan (${error.message}). Enrollment sudah dibatalkan di situsnya, jadi aman dicoba lagi setelah sebabnya dibetulkan.`
        : `Kunci ${site.name} gagal disimpan (${error.message}) DAN enrollment tidak bisa dibatalkan. Situs ini sekarang terkunci: reset harus dilakukan dari WordPress-nya sendiri sebelum bisa di-enroll lagi.`,
      { code: rolledBack ? "key_store_failed" : "orphaned" },
    );
  }

  return writeSiteRow(
    store,
    site,
    okPatch(
      {
        enrolled: true,
        siteId: data.site_id || site.name,
        version: data.version || "",
        enrolledAt: now.toISOString(),
        enrolledBy: String(actor || "dashboard"),
      },
      now,
    ),
    now,
  );
}

/**
 * Lepas enrollment supaya situs bisa di-enroll ulang (rotasi kunci).
 *
 * Kunci dibuang HANYA kalau situsnya benar-benar menjawab berhasil. Dibuang lebih dulu lalu
 * reset-nya gagal, situs tetap enrolled di sisi sana dan kunci satu-satunya sudah hilang dari sisi
 * kita — situs itu tidak akan pernah bisa dikelola dari dashboard lagi.
 */
export async function resetOne(store, subdomainId) {
  const site = await resolveSite(store, subdomainId);
  const apiKey = await siteKey(store, subdomainId);

  await withMirror(store, site, () => resetSite(site.name, apiKey));

  await store.replace(`${PLUGIN_KEYS_PATH}/${site.id}`, null);
  return writeSiteRow(store, site, { enrolled: false, siteId: "", enrolledAt: "", enrolledBy: "" });
}

export async function pingOne(store, subdomainId) {
  const site = await resolveSite(store, subdomainId);
  const apiKey = await siteKey(store, subdomainId);

  return withMirror(
    store,
    site,
    () => pingSite(site.name, apiKey),
    (data) => ({
      enrolled: true,
      siteId: data.site_id || "",
      version: data.version || "",
      php: data.php || "",
      wp: data.wp || "",
      homeUrl: data.home_url || "",
    }),
  );
}

// --- Pengaturan -------------------------------------------------------------------------------------

export async function readGroup(store, subdomainId, group) {
  const site = await resolveSite(store, subdomainId);
  const apiKey = await siteKey(store, subdomainId);
  return withMirror(store, site, () => readConfig(site.name, apiKey, group));
}

/**
 * Tulis sebagian pengaturan, lalu PERIKSA apakah yang tertulis benar-benar berubah.
 *
 * Pemeriksaan itu bukan kehati-hatian berlebih: plugin mengabaikan nilai enum yang tidak sah dan
 * tetap menjawab 200 berisi nilai lama. Tanpa `unappliedFields`, satu-satunya cara mengetahui
 * pengaturan iklan tidak jadi berubah adalah membuka situsnya dan melihat iklannya sendiri.
 */
export async function writeGroup(store, subdomainId, group, values) {
  const site = await resolveSite(store, subdomainId);
  const apiKey = await siteKey(store, subdomainId);
  const payload = toPluginPayload(group, values);

  const data = await withMirror(store, site, () => writeConfig(site.name, apiKey, group, payload));
  return { data, unapplied: unappliedFields(payload, data) };
}

// --- Landing -----------------------------------------------------------------------------------------

export async function listSiteLandings(store, subdomainId) {
  const site = await resolveSite(store, subdomainId);
  const apiKey = await siteKey(store, subdomainId);
  const data = await withMirror(store, site, () => listLandings(site.name, apiKey));
  return landingRows(data?.landings);
}

export async function readSiteLanding(store, subdomainId, landingId) {
  const site = await resolveSite(store, subdomainId);
  const apiKey = await siteKey(store, subdomainId);
  return withMirror(store, site, () => readLanding(site.name, apiKey, landingId));
}

/**
 * Landing dari preset "Buat LP Baru", dikembalikan bersama tautan + parameternya.
 *
 * `slug` opsional; kalau kosong situs mengacaknya. Tidak ada retry: tanpa slug eksplisit, retry
 * sesudah timeout bisa melahirkan DUA landing.
 */
export async function createSiteLanding(store, subdomainId, { slug = "" } = {}, random = Math.random) {
  const site = await resolveSite(store, subdomainId);
  const apiKey = await siteKey(store, subdomainId);
  const clean = String(slug || "").trim();
  const data = await withMirror(store, site, () =>
    createLandingPreset(site.name, apiKey, clean ? { slug: clean } : {}),
  );
  const link = landingLink(site.name, { ...(data?.landing || {}), id: data?.id }, data?.url);

  // Preset situs tidak mengisi URL cloaking dan menulis jeda video 0-0, jadi keduanya disusulkan
  // lewat update partial. Yang gagal di sini TIDAK menjatuhkan hasilnya: landing-nya sudah lahir,
  // dan melempar berarti orang menekan tombolnya lagi dan mendapat landing kedua.
  if (!link.id) return link;
  const cloakingUrl = pickCloakingUrl(await store.read(CLOAKING_URLS_PATH), random);
  const patch = {
    timer_auto_pause_video: PRESET_VIDEO_PAUSE,
    ...(cloakingUrl ? { cloaking_url: cloakingUrl } : {}),
  };
  try {
    const saved = await saveLanding(site.name, apiKey, { id: Number(link.id), ...patch });
    let unapplied = unappliedFields(patch, saved?.landing || {});
    // Jawaban POST bisa membawa baris LAMA (object cache Redis yang baru dipasang Setting Sub —
    // prices.sheetz.us 25 Sep 2026: kedua field tersimpan, jawabannya menyebut nilai preset).
    // Dibaca ulang sebelum divonis, supaya landing yang benar tidak menandai sub "Sebagian".
    if (unapplied.length) {
      unapplied = unappliedFields(patch, (await readLanding(site.name, apiKey, link.id)) || {});
    }
    return {
      ...link,
      cloakingUrl,
      videoPause: PRESET_VIDEO_PAUSE,
      ...(unapplied.length ? { presetError: `Tidak diterapkan situs: ${unapplied.join(", ")}` } : {}),
    };
  } catch (error) {
    return { ...link, presetError: error.message };
  }
}

// Rentang Waktu Jeda Video (detik) untuk landing dari preset.
export const PRESET_VIDEO_PAUSE = "15-30";

// Cerminan `cloakingUrls` di src/config/firebasePaths.js.
export const CLOAKING_URLS_PATH = "dashboard/cloakingUrls";

// Satu URL acak dari node daftar (baris terarsip dilewati); kosong kalau daftarnya kosong.
export function pickCloakingUrl(node, random = Math.random) {
  const urls = Object.values(node || {})
    .filter((row) => row && !row.deletedAt)
    .map((row) => String(row.url ?? "").trim())
    .filter(Boolean);
  return urls.length ? urls[Math.floor(random() * urls.length)] : "";
}

// Tautan + parameter landing yang sudah ada (daftar landing tidak membawa kolom parameter).
export async function siteLandingLink(store, subdomainId, landingId) {
  const site = await resolveSite(store, subdomainId);
  const apiKey = await siteKey(store, subdomainId);
  const landing = await withMirror(store, site, () => readLanding(site.name, apiKey, landingId));
  return landingLink(site.name, landing);
}

export async function siteLicense(store, subdomainId) {
  const site = await resolveSite(store, subdomainId);
  const apiKey = await siteKey(store, subdomainId);
  return withMirror(store, site, () => readLicense(site.name, apiKey));
}

export async function setSiteLicense(store, subdomainId, licenseKey, force = false) {
  const key = String(licenseKey || "").trim();
  if (!key) throw new PluginError("License key wajib diisi.");
  const site = await resolveSite(store, subdomainId);
  const apiKey = await siteKey(store, subdomainId);
  return withMirror(store, site, () =>
    writeLicense(site.name, apiKey, { license_key: key, ...(force ? { force: true } : {}) }),
  );
}

export async function siteDeployment(store, subdomainId) {
  const site = await resolveSite(store, subdomainId);
  const apiKey = await siteKey(store, subdomainId);
  return withMirror(store, site, () => readDeployment(site.name, apiKey));
}

// Lambat (sampai 10 menit) — dipanggil server kontrol DI LATAR, bukan menunggu request browser.
export async function runSiteDeployment(store, subdomainId, tasks) {
  const list = deploymentTasks(tasks);
  const site = await resolveSite(store, subdomainId);
  const apiKey = await siteKey(store, subdomainId);
  const data = await withMirror(store, site, () => runDeployment(site.name, apiKey, list));
  return { tasks: list, ...deploymentOutcome(data) };
}

export async function siteLegalPages(store, subdomainId) {
  const site = await resolveSite(store, subdomainId);
  const apiKey = await siteKey(store, subdomainId);
  return withMirror(store, site, () => readLegalPages(site.name, apiKey));
}

// Kunci AI hanya lewat body ke situs; tidak disimpan di mana pun di sisi kita.
export async function runSiteLegalPages(store, subdomainId, aiKey, pages) {
  const key = String(aiKey || "").trim();
  if (!key) throw new PluginError("Kunci AI wajib diisi.");
  const list = legalPageList(pages);
  const site = await resolveSite(store, subdomainId);
  const apiKey = await siteKey(store, subdomainId);
  const data = await withMirror(store, site, () =>
    generateLegalPages(site.name, apiKey, { ai_key: key, ...(list.length ? { pages: list } : {}) }),
  );
  return { pagesRequested: list, ...legalOutcome(data) };
}

export async function saveSiteLanding(store, subdomainId, values) {
  const site = await resolveSite(store, subdomainId);
  const apiKey = await siteKey(store, subdomainId);
  const payload = toPluginPayload("landing", values);

  // `id` bukan field yang bisa diedit orang, jadi ia tidak ada di skema — tapi ia yang menentukan
  // create atau update, dan tanpa disambungkan di sini setiap simpan akan membuat landing BARU.
  const id = String(values?.id ?? "").trim();
  if (id) payload.id = Number(id);
  if (!id && !payload.slug) {
    throw new PluginError("Landing baru wajib punya slug.");
  }

  const data = await withMirror(store, site, () => saveLanding(site.name, apiKey, payload));
  const landing = data?.landing || {};
  return {
    id: String(data?.id ?? landing.id ?? ""),
    landing,
    // `id` dikeluarkan dari perbandingan: ia dikirim sebagai angka dan dikembalikan sebagai apa pun
    // yang dipakai kolom situsnya, dan ia bukan sesuatu yang "gagal diterapkan".
    unapplied: unappliedFields({ ...payload, id: undefined }, landing).filter((key) => key !== "id"),
  };
}

// --- AutoPost -------------------------------------------------------------------------------------

/**
 * Berapa kata kunci dikirim BERSAMAAN ke satu situs.
 *
 * Sengaja jauh lebih kecil daripada `CONCURRENCY` di atas, dan bukan karena permintaannya berat:
 * `POST /autopost` menjawab 202 dalam sepersekian detik lalu meninggalkan satu proses PHP hidup
 * sampai artikelnya selesai. Yang dibatasi angka ini bukan lalu lintas kita melainkan berapa
 * penulis artikel yang berjalan bersamaan di SATU shared hosting — dan dokumen API-nya sendiri
 * menyarankan 5-10. Lebih dari itu, yang jatuh bukan job-nya melainkan situsnya, untuk
 * pengunjung yang sedang datang dari iklan berbayar.
 */
const AUTOPOST_CONCURRENCY = Math.max(1, Number(process.env.AUTOPOST_CONCURRENCY || 5));

/**
 * Buat kata kunci long-tail lewat AI di situsnya.
 *
 * Lewat `withMirror`: ia satu tindakan yang disengaja, dan jawabannya membuktikan situsnya hidup
 * sama kuatnya dengan ping.
 */
export async function autopostGenerateKeywords(store, subdomainId, aiKey, values) {
  const site = await resolveSite(store, subdomainId);
  const apiKey = await siteKey(store, subdomainId);
  const payload = toKeywordPayload(aiKey, values);

  const data = await withMirror(store, site, () => generateKeywords(site.name, apiKey, payload));
  return keywordResult(data);
}

/**
 * Kirim N kata kunci sebagai N job, dan kembalikan hasil PER KATA KUNCI.
 *
 * SELALU berhasil sebagai satu permintaan HTTP — sepola dengan `applyToSites`, dan dengan alasan
 * yang sama diperkeras: satu kata kunci yang ditolak (kuota AI habis di tengah daftar) tidak boleh
 * menjatuhkan sisanya, karena yang sudah terkirim TIDAK BISA DITARIK KEMBALI. Job yang sudah lahir
 * akan tetap menulis artikelnya; batch yang berhenti di tengah lalu diulang dari awal menghasilkan
 * artikel ganda untuk separuh daftar, dan AutoPost memang tidak punya dedup apa pun.
 *
 * Cermin statusnya ditulis SEKALI di akhir, bukan per kata kunci: `pluginSites` dilanggan halaman,
 * dan lima puluh tulisan berturut-turut membangunkan tiap browser yang sedang membukanya lima
 * puluh kali untuk satu tindakan.
 */
export async function submitAutopost(store, subdomainId, aiKey, keywords, values) {
  const site = await resolveSite(store, subdomainId);
  const apiKey = await siteKey(store, subdomainId);

  const list = autopostKeywords(keywords);
  if (!list.length) throw new PluginError("Tidak ada kata kunci yang dikirim.");
  if (list.length > AUTOPOST_MAX_KEYWORDS) {
    throw new PluginError(
      `${list.length} kata kunci sekaligus terlalu banyak untuk satu situs — maksimal ${AUTOPOST_MAX_KEYWORDS} per pengiriman.`,
    );
  }

  // Payload disusun DI DEPAN untuk seluruh daftar, sebelum satu job pun dikirim. Setelan yang salah
  // (status di luar enum, ID penulis bukan angka) harus ditolak dengan nol artikel terlanjur
  // dibuat, bukan setelah tiga puluh di antaranya sudah berjalan.
  const payloads = list.map((keyword) => toAutopostPayload(keyword, aiKey, values));

  const results = new Array(payloads.length);
  let cursor = 0;

  async function worker() {
    while (cursor < payloads.length) {
      const index = cursor++;
      const payload = payloads[index];
      try {
        const data = await submitAutopostJob(site.name, apiKey, payload);
        results[index] = submitRow(payload.keyword, { jobId: data?.job_id });
      } catch (error) {
        results[index] = submitRow(payload.keyword, {
          error: error?.message || "Gagal tanpa keterangan.",
        });
      }
    }
  }

  const now = new Date();
  try {
    await Promise.all(
      Array.from({ length: Math.min(AUTOPOST_CONCURRENCY, payloads.length) }, worker),
    );
  } catch (error) {
    await writeSiteRow(store, site, errorPatch(error, now), now);
    throw error;
  }

  // Satu situs yang menolak SELURUH daftar adalah situs yang bermasalah, dan cerminnya harus
  // mengatakan itu. Sebagian gagal bukan: kegagalan per kata kunci sudah berdiri di tabelnya
  // sendiri, dan menandai situsnya merah karena satu kuota AI habis mengirim orang memeriksa
  // WordPress yang sehat.
  const summary = submitSummary(results);
  const patch =
    summary.ok === 0
      ? errorPatch(new Error(results[0]?.error || "Semua kata kunci ditolak situs."), now)
      : okPatch({}, now);
  await writeSiteRow(store, site, patch, now);

  return { results, summary };
}

/**
 * Daftar job satu situs.
 *
 * TIDAK lewat `withMirror`, dan itu satu-satunya pembacaan di modul ini yang begitu. Endpoint ini
 * di-poll tiap beberapa detik selama ada job berjalan; lewat cermin, satu tab yang dibiarkan
 * terbuka menulis ke `pluginSites` setiap tiga detik — node yang DILANGGAN halaman itu sendiri,
 * jadi tiap tulisan menggambar ulang seluruh tabel armada di tiap browser yang sedang membukanya.
 * Yang dibuktikannya pun tidak ada: kalau situsnya mati, yang gagal adalah polling-nya sendiri dan
 * itu sudah terbaca di panel job.
 */
export async function listAutopost(store, subdomainId, query) {
  const site = await resolveSite(store, subdomainId);
  const apiKey = await siteKey(store, subdomainId);
  return jobList(await listAutopostJobs(site.name, apiKey, query));
}

// Satu job berikut lognya — dipanggil saat sebuah baris dibuka, bukan saat polling. Lognya bertambah
// progresif dan itu satu-satunya keterangan tentang kenapa sebuah job gagal.
export async function readAutopost(store, subdomainId, jobId) {
  const site = await resolveSite(store, subdomainId);
  const apiKey = await siteKey(store, subdomainId);
  return jobRow(await readAutopostJob(site.name, apiKey, jobId));
}

// --- Terapkan ke banyak situs -------------------------------------------------------------------------

/**
 * Jalankan `run(site)` untuk tiap subdomain, `CONCURRENCY` sekaligus, dan kembalikan hasil PER SITUS.
 *
 * Satu situs yang gagal TIDAK menghentikan sisanya, dan itu inti dari halaman ini: kegagalan yang
 * menjatuhkan seluruh batch akan meninggalkan armada dalam keadaan setengah berubah tanpa satu pun
 * catatan tentang bagian mana yang sudah — dan orang yang mengulanginya akan menulis ulang situs
 * yang sudah benar sambil tetap melewatkan yang gagal.
 */
export async function applyToSites(store, subdomainIds, run) {
  const ids = [...new Set((subdomainIds || []).map((id) => String(id || "").trim()).filter(Boolean))];
  const results = new Array(ids.length);
  let cursor = 0;

  async function worker() {
    while (cursor < ids.length) {
      const index = cursor++;
      const id = ids[index];
      let site = { id, name: "" };
      try {
        site = await resolveSite(store, id);
        const outcome = await run(site);
        const unapplied = outcome?.unapplied || [];
        results[index] = bulkRow(site, {
          // "Tersimpan tapi tidak berubah" berdiri sendiri, bukan dilebur ke berhasil maupun gagal.
          // Dilebur ke berhasil ia hilang sama sekali; dilebur ke gagal ia mengundang percobaan
          // ulang yang tidak akan mengubah apa pun.
          status: unapplied.length ? "unapplied" : "ok",
          unapplied,
          detail: outcome?.detail || null,
        });
      } catch (error) {
        results[index] = bulkRow(site, {
          status: "failed",
          error: error?.message || "Gagal tanpa keterangan.",
        });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ids.length) }, worker));
  return { results, summary: bulkSummary(results) };
}

export function enrollMany(store, subdomainIds, enrollToken, actor) {
  return applyToSites(store, subdomainIds, (site) =>
    enrollOne(store, site.id, enrollToken, actor).then(() => ({})),
  );
}

export function writeGroupMany(store, subdomainIds, group, values) {
  return applyToSites(store, subdomainIds, (site) => writeGroup(store, site.id, group, values));
}

// --- Cek situs ------------------------------------------------------------------------------------------

/**
 * Baca satu situs dan nilai kode iklan, CMP, network code, landing page, dan behaviour-nya. Tidak
 * menulis apa pun ke situs.
 *
 * Kelima bacaan jalan BERSAMAAN untuk satu situs, tapi yang membatasi beban tiap hosting tetap
 * `CONCURRENCY` di `applyToSites` — dan halamannya mengirim subdomain per gelombang kecil, supaya satu
 * domain berisi tiga puluh subdomain tidak menunggu satu request yang melewati batas tunggu nginx.
 *
 * Grup yang gagal dibaca TIDAK menjatuhkan situsnya: plugin versi lama tanpa endpoint CMP tetap punya
 * kode iklan yang bisa dinilai. Yang menjatuhkan cuma kalau SELURUH bacaan gagal — di situ situsnya
 * yang tidak menjawab, dan cerminnya harus mencatat itu.
 */
export async function auditOne(store, subdomainId, ctx) {
  const site = await resolveSite(store, subdomainId);
  const apiKey = await siteKey(store, subdomainId);
  const groups = ["ads-settings", "header-footer", "cmp", "behaviour"];

  const settled = await withMirror(store, site, async () => {
    const results = await Promise.allSettled([
      ...groups.map((group) => readConfig(site.name, apiKey, group)),
      listLandings(site.name, apiKey),
    ]);
    if (results.every((result) => result.status === "rejected")) throw results[0].reason;
    return results;
  });

  const errors = {};
  const valueOf = (index, name) => {
    const result = settled[index];
    if (result.status === "fulfilled") return result.value || {};
    errors[name] = result.reason?.message || "Gagal dibaca.";
    return null;
  };
  const [ads, headerFooter, cmp, behaviour] = groups.map((group, index) => valueOf(index, group));
  const landingData = valueOf(groups.length, "landing");

  let gam;
  try {
    const account = gamAccountForSite(site, ctx.gamAccounts);
    gam = { networkCode: String(account.networkCode), accountName: String(account.name || "") };
  } catch (error) {
    gam = { error: error.message };
  }

  return auditSite({
    ads,
    headerFooter,
    cmp,
    behaviour,
    landings: landingData ? landingRows(landingData.landings) : null,
    gam,
    errors,
  });
}

export async function auditSites(store, subdomainIds) {
  const ctx = { gamAccounts: (await store.read("gamAccounts")) || {} };
  return applyToSites(store, subdomainIds, async (site) => ({
    detail: await auditOne(store, site.id, ctx),
  }));
}

// --- Inject kode iklan Ad Manager -------------------------------------------------------------------

/**
 * Bahan yang dibaca SEKALI per permintaan dan dibagi seluruh situsnya: akun GAM, kredensial, dan
 * daftar unit iklan per network.
 *
 * Unit iklan di-cache per NETWORK, bukan per situs: tiga puluh subdomain designingaround.com adalah
 * satu network, dan tiga puluh panggilan `adUnits` untuk daftar yang sama berarti tiga puluh token
 * refresh dan tiga puluh permintaan ke Ad Manager dalam satu tombol. Yang di-cache PROMISE-nya, jadi
 * situs yang dikerjakan bersamaan ikut menunggu panggilan yang sama.
 */
async function gptContext(store) {
  const [gamAccounts, configs] = await Promise.all([
    store.read("gamAccounts"),
    store.read("googleApiConfigs"),
  ]);
  return {
    gamAccounts: gamAccounts || {},
    configs: configs || {},
    units: new Map(),
    // Stempel div per SUBDOMAIN, selalu naik di dalam satu permintaan.
    nextStamp: gptStampClock(),
  };
}

function networkUnits(ctx, account) {
  const code = String(account.networkCode);
  if (!ctx.units.has(code)) {
    ctx.units.set(
      code,
      (async () => {
        try {
          const token = await accountToken(account, ctx.configs);
          return gptUnitChoices(code, await listAdUnits(code, token));
        } catch (error) {
          // Kegagalan Ad Manager bukan kegagalan situs: dilempar sebagai PluginError supaya route
          // menjawab dengan kalimatnya, bukan 500 yang menuduh server kontrol.
          throw error instanceof PluginError
            ? error
            : new PluginError(`Unit iklan network ${code} gagal dibaca dari Ad Manager: ${error.message}`, {
                code: "gam_units_failed",
              });
        }
      })(),
    );
  }
  return ctx.units.get(code);
}

/**
 * Subdomain yang dipilih → akun GAM-nya, network, properti, dan unit iklan yang bisa dipasang.
 *
 * Ini langkah PERTAMA di tab AdX: admin memilih subdomain dan yang tampil adalah
 * apa yang Ad Manager katakan tentangnya — bukan kotak isian. Hasilnya per situs DAN per network,
 * karena unit iklan milik network, sementara kegagalan (subdomain tanpa akun GAM) milik situsnya.
 * Tidak ada yang ditulis, dan situs WordPress-nya tidak dihubungi.
 */
export async function gptNetworksFor(store, subdomainIds) {
  const ctx = await gptContext(store);
  const ids = [...new Set((subdomainIds || []).map((id) => String(id || "").trim()).filter(Boolean))];
  const networks = new Map();

  const sites = await Promise.all(
    ids.map(async (id) => {
      try {
        const site = await resolveSite(store, id);
        const account = gamAccountForSite(site, ctx.gamAccounts);
        const code = String(account.networkCode);
        if (!networks.has(code)) {
          networks.set(code, {
            networkCode: code,
            accountId: account.id,
            accountName: String(account.name || "").trim(),
            publisherId: String(account.publisherId || ""),
          });
        }
        return { subdomainId: id, name: site.name, networkCode: code, error: "" };
      } catch (error) {
        return { subdomainId: id, name: "", networkCode: "", error: error.message };
      }
    }),
  );

  const list = await Promise.all(
    [...networks.values()].map(async (network) => {
      const account = ctx.gamAccounts[network.accountId];
      try {
        const units = await networkUnits(ctx, { ...account, id: network.accountId });
        return { ...network, units, error: "" };
      } catch (error) {
        return { ...network, units: [], error: error.message };
      }
    }),
  );

  return { sites, networks: list };
}

// Satu situs → spec lengkapnya (unit iklan dari Ad Manager, awalan div dari stempel situs itu).
async function gptSiteSpec(store, ctx, subdomainId, options, adUnitCodes = {}, divStamp = "") {
  const site = await resolveSite(store, subdomainId);
  const account = gamAccountForSite(site, ctx.gamAccounts);
  const code = String(account.networkCode);
  const unit = pickGptUnit(code, await networkUnits(ctx, account), adUnitCodes?.[code]);
  const spec = normalizeGptSpec({
    ...options,
    adUnitPath: unit.path,
    divPrefix: gptDivPrefix(divStamp || ctx.nextStamp()),
  });
  return { site, account, unit, spec };
}

/**
 * Pratinjau kode untuk SELURUH subdomain terpilih — penyusun yang sama dengan yang menulis, tanpa
 * menghubungi WordPress.
 *
 * Seluruhnya, bukan satu situs contoh: tiap subdomain punya stempel div SENDIRI, jadi tidak ada lagi
 * satu kode yang mewakili pilihan lain. Stempelnya dibagikan berurutan SEBELUM situs dikerjakan
 * bersamaan, supaya urutannya mengikuti daftar pilihan. Kegagalan per situs (tanpa akun GAM) jadi
 * baris `error`, bukan menjatuhkan seluruh pratinjau.
 */
export async function previewGptSites(store, subdomainIds, options, adUnitCodes = {}) {
  normalizeGptOptions(options);
  const ctx = await gptContext(store);
  const ids = [...new Set((subdomainIds || []).map((id) => String(id || "").trim()).filter(Boolean))];
  const stamps = ids.map(() => ctx.nextStamp());
  const sites = await Promise.all(
    ids.map(async (id, index) => {
      try {
        const { site, account, unit, spec } = await gptSiteSpec(store, ctx, id, options, adUnitCodes, stamps[index]);
        return {
          subdomainId: id,
          name: site.name,
          networkCode: String(account.networkCode),
          adUnitPath: unit.path,
          divStamp: stamps[index],
          error: "",
          ...buildGptTags(spec),
        };
      } catch (error) {
        return { subdomainId: id, name: "", error: error.message };
      }
    }),
  );
  return { sites };
}

/**
 * Tulis tag GPT ke satu situs: blok header di `header-footer`, body-nya di `ads-settings`.
 *
 * BACA DULU, baru tulis — dua alasan yang masing-masing sudah cukup. Header situs memuat kode lain
 * (CMP, analytics) yang tidak boleh ikut tertimpa, jadi yang dikirim adalah isi lama dengan blok
 * GPT-nya diganti (`mergeGptHeader`); dan kotak kode iklan sesudah slot terakhir cuma dikosongkan
 * kalau isinya GPT milik tag lama (`planGptBodies`), yang tidak bisa diketahui tanpa membacanya.
 *
 * Unit iklan diselesaikan SEBELUM `withMirror`: subdomain tanpa akun GAM bukan situs yang mati, dan
 * menandainya bermasalah di cermin status mengirim orang memeriksa WordPress yang sehat.
 *
 * `dryRun` berhenti sesudah membaca. Header ditulis LEBIH DULU: pemakaian yang paling sering —
 * menguji ukuran dengan unit dan awalan div yang sama — hanya aman ke arah ini, karena body lama
 * memanggil div id yang sama. Yang setengah jadi disebut di pesannya, bukan dilebur ke "gagal".
 */
export async function injectGptOne(store, subdomainId, options, config = {}) {
  const { dryRun = false, adUnitCodes = {}, divStamp = "" } = config;
  const ctx = config.ctx || (await gptContext(store));
  const { site, unit, spec } = await gptSiteSpec(store, ctx, subdomainId, options, adUnitCodes, divStamp);
  const tags = buildGptTags(spec);
  const apiKey = await siteKey(store, site.id);

  return withMirror(store, site, async () => {
    const [headerFooter, adsSettings] = await Promise.all([
      readConfig(site.name, apiKey, "header-footer"),
      readConfig(site.name, apiKey, "ads-settings"),
    ]);
    const merged = mergeGptHeader(headerFooter?.header_code, tags.header);
    const plan = planGptBodies(adsSettings, spec, tags.bodies);
    const detail = {
      dryRun,
      adUnitPath: unit.path,
      divPrefix: spec.divPrefix,
      headerMode: merged.mode,
      removed: merged.removed,
      cleared: plan.cleared,
      previousSlotCount: plan.previousSlotCount,
    };
    if (dryRun) return { unapplied: [], detail };

    const headerPayload = toPluginPayload("header-footer", { header_code: merged.code });
    const headerData = await writeConfig(site.name, apiKey, "header-footer", headerPayload);

    const adsPayload = toPluginPayload("ads-settings", plan.values);
    let adsData;
    try {
      adsData = await writeConfig(site.name, apiKey, "ads-settings", adsPayload);
    } catch (error) {
      throw new PluginError(
        `Header GPT SUDAH tertulis, tapi kode iklan gagal disimpan — situs ini setengah jadi: ${error.message}`,
        { code: error.code || "", status: error.status || 0 },
      );
    }

    return {
      unapplied: [
        ...unappliedFields(headerPayload, headerData),
        ...unappliedFields(adsPayload, adsData),
      ],
      detail,
    };
  });
}

export async function injectGptMany(store, subdomainIds, options, { dryRun = false, adUnitCodes = {} } = {}) {
  // Pilihan yang tidak sah ditolak SEKALI di depan, bukan tiga puluh kali sebagai tiga puluh baris
  // "gagal" yang semuanya menyebut kalimat yang sama.
  normalizeGptOptions(options);
  // Stempel per subdomain dari pratinjau. Yang tidak dikirim dibuatkan baru (tetap unik per situs).
  const stamps = normalizeGptDivStamps(options?.divStamps);
  const ctx = await gptContext(store);
  return applyToSites(store, subdomainIds, (site) =>
    injectGptOne(store, site.id, options, { dryRun, adUnitCodes, ctx, divStamp: stamps[site.id] }),
  );
}

// --- Inject kode iklan AdSense ----------------------------------------------------------------------

/**
 * Bahan yang dibaca SEKALI per permintaan: kedua koleksi akun, kredensial, dan per PUBLISHER daftar
 * ad unit + situsnya. Di-cache per publisher, bukan per subdomain — dua puluh subdomain petcins.com
 * adalah satu akun AdSense.
 */
async function adsenseContext(store) {
  const [adsenseAccounts, gamAccounts, configs] = await Promise.all([
    store.read("adsenseAccounts"),
    store.read("gamAccounts"),
    store.read("googleApiConfigs"),
  ]);
  return {
    adsenseAccounts: adsenseAccounts || {},
    gamAccounts: gamAccounts || {},
    configs: configs || {},
    publishers: new Map(),
  };
}

/**
 * Publisher `ca-pub-…` → { units, sites, accountName, reason }.
 *
 * Kandidat kredensialnya dicari di KEDUA koleksi: akun AdSense yang Publisher ID-nya itu, lalu network
 * GAM yang propertinya itu (akun pub yang sama — lihat kolom Status di CLAUDE.md). Kandidat pertama
 * yang berhasil membaca menang; kredensial GAM lama yang belum consent `adsense.readonly` gagal dan
 * dilewati. `units: null` berarti tidak satu pun bisa membaca — dilaporkan, tidak dilempar.
 */
function publisherUnits(ctx, client) {
  const account = accountResourceName(client);
  if (!ctx.publishers.has(account)) {
    ctx.publishers.set(
      account,
      (async () => {
        const candidates = [
          ...Object.values(ctx.adsenseAccounts),
          ...Object.values(ctx.gamAccounts),
        ].filter(
          (row) =>
            row &&
            !row.deletedAt &&
            accountResourceName(row.accountName || row.publisherId || "") === account,
        );
        if (!candidates.length) {
          return {
            units: null,
            sites: null,
            accountName: "",
            reason: `Publisher ${account.split("/").pop()} tidak terdaftar di /adsense-accounts maupun /gam-accounts — slot tidak diperiksa.`,
          };
        }
        const failures = [];
        for (const row of candidates) {
          try {
            const token = await accountToken(row, ctx.configs);
            const units = await listAdsenseUnits(account, token);
            // Situs akun itu cuma untuk catatan: gagal membacanya tidak membatalkan pengecekan slot.
            const sites = await listAdsenseSites(account, token).catch(() => null);
            return { units, sites, accountName: String(row.name || ""), reason: "" };
          } catch (error) {
            failures.push(error.message);
          }
        }
        return {
          units: null,
          sites: null,
          accountName: String(candidates[0].name || ""),
          reason: `Ad unit akun AdSense gagal dibaca — slot tidak diperiksa: ${failures[0]}`,
        };
      })(),
    );
  }
  return ctx.publishers.get(account);
}

// Domain situs → apakah terdaftar di Situs akun AdSense itu (domain induk menaungi subdomainnya).
function siteNoteFor(site, publisher, client) {
  if (!Array.isArray(publisher.sites)) return "";
  const host = String(site.name).toLowerCase();
  const listed = publisher.sites.some((row) => {
    const domain = String(row.domain || row.url || "")
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/\/.*$/, "");
    return domain && (host === domain || host.endsWith(`.${domain}`));
  });
  return listed
    ? ""
    : `${site.name} tidak ada di daftar Situs akun ${client.replace(/^ca-/, "")} — iklan tidak tayang di domain yang belum disetujui AdSense.`;
}

async function adsensePlan(store, ctx, subdomainId, codes) {
  const site = await resolveSite(store, subdomainId);
  const slots = normalizeAdsenseCodes(codes);
  const client = slots[0].client;
  const publisher = await publisherUnits(ctx, client);
  const checked = verifyAdsenseSlots(slots, publisher.units, publisher.reason).map((row) => ({
    ...row,
    size: adsenseSizeLabel(row.size),
  }));
  return {
    site,
    slots,
    check: {
      name: site.name,
      client,
      accountName: publisher.accountName,
      verified: checked.every((row) => row.verified),
      slots: checked,
      siteNote: siteNoteFor(site, publisher, client),
    },
  };
}

function hostOfDomain(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
}

/**
 * Subdomain yang akun AdSense-nya terdaftar di /adsense-accounts — pilihan tab AdSense.
 *
 * Dicocokkan lewat daftar SITUS tiap akun di AdSense API (`accounts.sites`), bukan lewat nama
 * kredensial (`googleCredential` kebetulan berbunyi seperti domain, tapi ia nama config, bukan domain)
 * dan bukan lewat `subDomains.parentDomain` yang diketik orang. Situs akun menyebut domain induk
 * (READY) berikut subdomainnya; host yang sama dengan salah satunya, atau berakhiran `.{domain}`,
 * milik akun itu. Domain TERPANJANG yang cocok menang, supaya subdomain yang didaftarkan sendiri tidak
 * kalah oleh induknya di akun lain.
 *
 * Akun yang gagal dibaca DISEBUT (`accounts[].error`), tidak dijatuhkan diam-diam: tanpa itu seluruh
 * subdomainnya hilang dari pilihan dan terbaca seperti tidak pernah punya AdSense.
 */
export async function adsenseSitesFor(store) {
  const [adsenseAccounts, subDomains, configs] = await Promise.all([
    store.read("adsenseAccounts"),
    store.read("subDomains"),
    store.read("googleApiConfigs"),
  ]);
  const rows = Object.entries(adsenseAccounts || {}).filter(
    ([, row]) => row && !row.deletedAt && accountResourceName(row.accountName || row.publisherId || ""),
  );

  const accounts = await Promise.all(
    rows.map(async ([id, row]) => {
      const account = accountResourceName(row.accountName || row.publisherId);
      const base = { accountId: id, accountName: String(row.name || ""), publisherId: account.split("/").pop() };
      try {
        const token = await accountToken(row, configs || {});
        const domains = (await listAdsenseSites(account, token)).map((site) => hostOfDomain(site.domain || site.url)).filter(Boolean);
        return { ...base, domains, error: "" };
      } catch (error) {
        return { ...base, domains: [], error: error.message };
      }
    }),
  );

  const sites = {};
  for (const [id, row] of Object.entries(subDomains || {})) {
    if (!row || row.deletedAt || !row.name) continue;
    const host = hostOfDomain(row.name);
    let best = null;
    for (const account of accounts) {
      for (const domain of account.domains) {
        if ((host === domain || host.endsWith(`.${domain}`)) && (!best || domain.length > best.domain.length)) {
          best = { domain, account };
        }
      }
    }
    if (best) {
      sites[id] = {
        accountId: best.account.accountId,
        accountName: best.account.accountName,
        publisherId: best.account.publisherId,
      };
    }
  }

  return { accounts: accounts.map(({ domains, ...account }) => ({ ...account, siteCount: domains.length })), sites };
}

/**
 * Periksa kode yang ditempel untuk SATU subdomain — tanpa menghubungi WordPress.
 *
 * Yang dijawab adalah apa yang dilihat superadmin sebelum inject: akun, nama unit, dan ukurannya per
 * kotak. Kode yang tidak sah dan slot yang tidak ada di akun yang terbaca DILEMPAR (422).
 */
export async function checkAdsenseSite(store, subdomainId, codes) {
  const ctx = await adsenseContext(store);
  return (await adsensePlan(store, ctx, subdomainId, codes)).check;
}

/**
 * Tulis kode AdSense ke satu situs: `ads-settings.kode_iklan_1…N` + `jumlah_iklan`. Header TIDAK
 * dibaca maupun ditulis.
 *
 * Kode diperiksa SEBELUM `withMirror`, sepola inject GPT: kode yang salah tempel bukan situs yang
 * bermasalah. `ads-settings` dibaca dulu karena kotak sesudah N cuma dikosongkan kalau isinya kode
 * iklan (`planAdsenseBodies`).
 */
export async function injectAdsenseOne(store, subdomainId, codes, config = {}) {
  const { dryRun = false, ctx = await adsenseContext(store) } = config;
  const { site, slots, check } = await adsensePlan(store, ctx, subdomainId, codes);
  const apiKey = await siteKey(store, site.id);

  return withMirror(store, site, async () => {
    const adsSettings = await readConfig(site.name, apiKey, "ads-settings");
    const plan = planAdsenseBodies(adsSettings, slots);
    const detail = {
      dryRun,
      client: check.client,
      verified: check.verified,
      slots: check.slots.map((row) =>
        [row.slot, row.displayName, row.size].filter(Boolean).join(" · "),
      ),
      notes: [
        ...check.slots.map((row) => row.note).filter(Boolean),
        ...(check.siteNote ? [check.siteNote] : []),
      ].filter((note, index, list) => list.indexOf(note) === index),
      replaced: plan.replaced,
      cleared: plan.cleared,
      previousSlotCount: plan.previousSlotCount,
    };
    if (dryRun) return { unapplied: [], detail };

    const payload = toPluginPayload("ads-settings", plan.values);
    const data = await writeConfig(site.name, apiKey, "ads-settings", payload);
    return { unapplied: unappliedFields(payload, data), detail };
  });
}

/**
 * Banyak situs, masing-masing dengan KODENYA SENDIRI (`items: [{ siteId, codes }]`) — slot AdSense
 * dibuat per subdomain, jadi tidak ada satu kode untuk seluruh pilihan seperti GPT. Kode yang ditolak
 * menggagalkan barisnya saja.
 */
export async function injectAdsenseMany(store, items, { dryRun = false } = {}) {
  const codesById = new Map((items || []).map((item) => [String(item.siteId), item.codes]));
  const ctx = await adsenseContext(store);
  return applyToSites(store, [...codesById.keys()], (site) =>
    injectAdsenseOne(store, site.id, codesById.get(site.id), { dryRun, ctx }),
  );
}

/**
 * Ganti versi plugin di satu situs, lalu perbarui cermin statusnya.
 *
 * Versi yang tersimpan di `pluginSites` HARUS ikut ditulis di sini. Kalau tidak, kolom "Versi" di
 * tabel tetap menampilkan versi lama sampai siklus ping berikutnya (setengah jam) — dan orang yang
 * baru saja menekan tombolnya akan menyimpulkan pembaruannya gagal, lalu menjalankannya lagi.
 */
export async function updateOne(store, subdomainId, version) {
  const site = await resolveSite(store, subdomainId);
  const apiKey = await siteKey(store, subdomainId);
  const requested = normalizeVersion(version);
  const data = await updateSite(site.name, apiKey, updatePayload(version));
  const row = pluginUpdateRow(data, requested);
  const outcome = updateOutcome(row, requested);

  // Ditulis apa pun hasilnya — termasuk `unapplied`. Yang dijawab situs adalah versi yang BENAR-BENAR
  // terpasang di sana sekarang, dan itu kebenaran yang lebih baru daripada apa pun yang kita simpan.
  if (row.version) {
    await writeSiteRow(store, site, { version: row.version }, new Date());
  }

  return { ...row, ...outcome };
}

/**
 * Ganti versi di banyak situs sekaligus.
 *
 * Lewat `applyToSites` seperti enroll dan simpan pengaturan, jadi ia mewarisi dua sifat yang tidak
 * boleh berbeda di sini: batas berapa situs dihubungi bersamaan, dan satu situs yang gagal tidak
 * menjatuhkan sisanya. Yang kedua lebih penting untuk pembaruan daripada di mana pun — batch yang
 * berhenti di tengah meninggalkan armada dengan dua versi plugin yang berbeda tanpa catatan mana
 * yang sudah.
 */
export function updateMany(store, subdomainIds, version) {
  // Divalidasi SEKALI di depan, bukan per situs: versi yang salah ketik harus ditolak sebelum satu
  // situs pun disentuh, bukan setelah tiga puluh di antaranya sudah dipasangi.
  normalizeVersion(version);

  return applyToSites(store, subdomainIds, async (site) => {
    const result = await updateOne(store, site.id, version);
    // `unapplied` diteruskan lewat jalur yang sama dengan pengaturan yang ditolak diam-diam, supaya
    // ringkasannya memakai kosakata yang sama di seluruh halaman.
    return result.status === "unapplied" ? { unapplied: [result.note] } : {};
  });
}

// --- Siklus ping ----------------------------------------------------------------------------------------

/**
 * Ping tiap situs yang sudah enroll, dan tuliskan yang tidak menjawab sebagai isu sync.
 *
 * Yang belum enroll DILEWATI diam-diam — persis alasan `earningAccounts` melewati akun tanpa
 * alamat API: belum pernah dihubungkan bukan kegagalan, dan menjadikannya isu akan mengisi daftar
 * dengan baris yang tidak bisa diperbaiki siapa pun sampai ada yang memutuskan situs itu memang
 * mau dikelola dari sini.
 *
 * Situs yang enroll-nya HILANG di sisi sana (`invalid_key`) justru sebaliknya: itu kegagalan yang
 * paling perlu terlihat, karena tidak ada satu pun tombol di halaman ini yang akan bekerja lagi
 * untuknya dan tidak ada yang akan menyadarinya sampai seseorang mencoba mengubah pengaturan.
 */
export async function syncPlugin(store) {
  const sites = (await store.read(PLUGIN_SITES_PATH)) || {};
  const subDomains = (await store.read("subDomains")) || {};

  const { results } = await applyToSites(
    store,
    pluginPingIds(sites, subDomains),
    (site) => pingOne(store, site.id).then(() => ({})),
  );

  const failed = results.filter((row) => row.status === "failed");
  await writePluginIssues(store, failed);

  // Benih percobaan ulang, DI CABANGNYA SENDIRI dan dengan bentuk yang sama persis dengan retry
  // akun GAM/Meta (`retrySeed`): satu tempat menyimpan "apa yang sedang dicoba lagi", jadi
  // indikator di topbar tidak perlu tahu modul mana yang menuliskannya. Ditulis mengganti seluruh
  // cabang — situs yang pulih di sweep ini tidak boleh tertinggal sebagai retry hantu.
  await seedPluginRetries(store, failed, new Date());

  return { checked: results.length, failed: failed.length };
}

const PLUGIN_RETRY_BRANCH = `${SYNC_RETRY_PATH}/${PLUGIN_ISSUES_BRANCH}`;

function seedPluginRetries(store, failedRows, now) {
  const seed = retrySeed(
    failedRows.map((row) => ({
      id: row.subdomainId,
      name: row.name || row.subdomainId,
      message: row.error,
    })),
    now,
  );
  return store.replace(PLUGIN_RETRY_BRANCH, Object.keys(seed).length ? seed : null);
}

/**
 * Ping ULANG hanya situs yang jatuh tempo, bukan seluruh armada.
 *
 * Dipanggil jauh lebih sering daripada sweep penuh (tiap menit) dan hampir selalu berhenti di satu
 * bacaan RTDB. Backoff dan jatahnya tidak ditentukan di sini melainkan di `dueRetries`/`retryOutcome`
 * — tempat yang sama dengan retry akun GAM/Meta, supaya "berapa kali dan seberapa jarang" tidak
 * punya dua jawaban di satu dashboard.
 *
 * Bedanya dengan retry akun, yang sengaja tidak menyentuh `syncIssues`: di sini situs yang PULIH
 * dicoret dari daftar isu. Retry akun meresync dengan `only` dan tidak pernah menghitung ulang
 * daftar isunya, jadi mencoretnya berarti menebak; di sini yang dihubungi persis situs yang jadi
 * baris itu, dan jawabannya bukti langsung. Daftar yang masih menyebut situs yang sudah hidup akan
 * membuat orang mengejar masalah yang sudah tidak ada.
 */
export async function retryPluginIssues(store, now = new Date()) {
  const branch = (await store.read(PLUGIN_RETRY_BRANCH)) || {};
  const due = dueRetries(branch, now).filter(({ entry }) => !entry.running);
  if (!due.length) return { retried: 0, skipped: true };

  // Ditulis sebelum situs pertama dihubungi: itulah yang menyalakan indikator "sedang mencoba lagi"
  // di layar, dan sekaligus yang menahan siklus semenit berikutnya masuk ke percobaan yang sama.
  await store.update(
    PLUGIN_RETRY_BRANCH,
    Object.fromEntries(due.map(({ id, entry }) => [id, retryRunning(entry, now)])),
  );

  const { results } = await applyToSites(
    store,
    due.map(({ id }) => id),
    (site) => pingOne(store, site.id).then(() => ({})),
  );

  const byId = new Map(results.map((row) => [row.subdomainId, row]));
  const outcomes = {};
  const recovered = [];
  for (const { id, entry } of due) {
    const row = byId.get(id);
    const stillFailed = row ? row.status === "failed" : true;
    if (!stillFailed) recovered.push(id);
    outcomes[id] = retryOutcome(entry, stillFailed, row?.error || entry.message, new Date());
  }

  await store.update(PLUGIN_RETRY_BRANCH, outcomes);
  if (recovered.length) await dropPluginIssues(store, recovered);

  return { retried: due.length, recovered: recovered.length, failed: due.length - recovered.length };
}

function pluginIssue(row) {
  return {
    source: "Plugin situs",
    // `target` adalah nama host, dan itu juga yang dicocokkan saat sebuah situs dicoret dari daftar
    // setelah pulih — id-nya tidak ikut tersimpan di baris isu, dan tidak perlu: satu nama host
    // hanya boleh dimiliki satu baris subDomains.
    target: row.name || row.subdomainId,
    message: row.error,
    impact:
      "Pengaturan landing, iklan, dan behaviour situs ini tidak bisa dibaca atau diubah dari dashboard.",
  };
}

function writePluginIssues(store, failedRows, now = new Date()) {
  return store.replace(
    `${SYNC_ISSUES_PATH}/${PLUGIN_ISSUES_BRANCH}`,
    syncIssuesUpdate("Plugin situs", failedRows.map(pluginIssue), now),
  );
}

// Coret situs yang sudah menjawab dari daftar isu, sisanya dibiarkan apa adanya.
async function dropPluginIssues(store, subdomainIds) {
  const sites = (await store.read(PLUGIN_SITES_PATH)) || {};
  const names = new Set(
    subdomainIds.map((id) => String(sites[id]?.name || id)).filter(Boolean),
  );

  const branch = await store.read(`${SYNC_ISSUES_PATH}/${PLUGIN_ISSUES_BRANCH}`);
  const items = Object.values(branch?.items || {});
  const left = items.filter((item) => !names.has(item.target));
  if (left.length === items.length) return;

  await store.replace(
    `${SYNC_ISSUES_PATH}/${PLUGIN_ISSUES_BRANCH}`,
    // `checkedAt` sengaja tidak diperbarui: yang baru saja diperiksa cuma segelintir situs, dan
    // stempel baru untuk seluruh cabang adalah klaim bahwa armadanya baru disapu.
    syncIssuesUpdate("Plugin situs", left, new Date(branch?.checkedAt || Date.now())),
  );
}
