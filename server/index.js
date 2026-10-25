import { cors } from "@elysiajs/cors";
import { cron } from "@elysiajs/cron";
import { Elysia } from "elysia";
import { applyCampaignCommands } from "../functions/campaign-commands.mjs";
import { sweepCopyJobs } from "../functions/campaign-copy-jobs.mjs";
import { sweepCreateJobs } from "../functions/campaign-create-jobs.mjs";
import { connect } from "../functions/db.mjs";
import { clientStore } from "../functions/store.mjs";
import { syncFillRate } from "../functions/sync-fill-rate.mjs";
import { syncGating } from "../functions/sync-gating.mjs";
import { refreshCampaignStatuses, syncCampaigns } from "../functions/sync-meta.mjs";
import { retryPluginIssues, syncPlugin } from "../functions/sync-plugin.mjs";
import { runFullSync, runSyncRetries, syncStageNames } from "../functions/sync-run.mjs";
import { syncTelegramInbox } from "../functions/sync-telegram-inbox.mjs";
import { warmCache } from "../functions/warm-cache.js";
import { createAccountSyncQueue } from "./account-sync-queue.js";
import { activityRoutes, pruneActivityLogs } from "./activity.js";
import { openActivityDb } from "./activity-db.js";
import { campaignCreateRoutes } from "./campaign-create.js";
import { createLock } from "./campaign-lock.js";
import { campaignManageRoutes } from "./campaign-manage.js";
import { campaignRoutes } from "./campaigns.js";
import { cloudflareRoutes } from "./cloudflare.js";
import { discoverRoutes } from "./discover.js";
import { controlErrorResponse } from "./errors.js";
import { gatingRoutes } from "./gating.js";
import { googleAuthRoutes } from "./google-auth.js";
import { keitaroRoutes, keitaroSiteCreator } from "./keitaro.js";
import { corsOrigins, landingOrigin, parseOrigins } from "./origins.js";
import { pluginRoutes } from "./plugin.js";
import { scheduledLaunchRoutes } from "./scheduled-launches.js";
import { setupSubRoutes } from "./setup-sub.js";
import { drainSyncRuns, syncRunsRoutes } from "./sync-runs.js";
import { openSyncRunsDb } from "./sync-runs-db.js";

/**
 * Server kontrol RabbitROI — Bun + Elysia.
 *
 * Menggantikan Cloud Function `scheduledGating`. Dua hal yang dibawanya, dan keduanya tidak bisa
 * didapat dari fungsi terjadwal:
 *
 *   1. Gate/ungate SEKETIKA. Di bawah DRS, browser tidak bisa memanggil Cloud Function sama sekali,
 *      jadi satu-satunya jalur adalah antrean RTDB — dan itu berarti menunggu sampai dua menit
 *      untuk melihat hasil satu klik pada trafik yang sedang berjalan.
 *   2. Pratinjau SEGAR. Lewat antrean, dialog konfirmasi hanya bisa menampilkan pratinjau yang
 *      diambil cron sampai sepuluh menit lalu.
 *
 * Cron di dalam proses ini menggantikan Cloud Scheduler: siklus yang dijalankannya persis fungsi
 * yang sama (`syncGating`), jadi antrean RTDB tetap bekerja sebagai jalur cadangan kalau server ini
 * mati atau tidak terjangkau dari browser.
 *
 * CATATAN soal DRS: yang diblokir DRS adalah grant `allUsers`, yaitu jalur BROWSER -> Cloud
 * Function. `scheduledGating` sendiri tidak pernah diblokir — ia dipanggil Cloud Scheduler dengan
 * service account internal. Jadi server ini bukan menambal sesuatu yang mati, melainkan menghapus
 * latensi dua menit yang lahir dari harus lewat antrean.
 */

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || "0.0.0.0";
const API_KEY = process.env.VI_CONTROL_API_KEY;
// System User token Business Manager. Kalau kosong, sisi campaign dilewati seluruhnya dan gating
// tetap jalan — dua fitur yang tidak ada hubungannya tidak boleh saling menjatuhkan.
const META_TOKEN = process.env.META_ACCESS_TOKEN || "";
/**
 * Enroll token plugin RabbitROI — dibagi ke SELURUH armada, ditanam saat build plugin.
 *
 * Kalau kosong, hanya `enroll` yang mati; membaca dan mengubah pengaturan situs yang SUDAH enroll
 * tetap jalan, karena itu memakai api_key masing-masing situs yang tersimpan di RTDB. Jadi tidak ada
 * `process.exit` di sini — berbeda dari VI_CONTROL_API_KEY, yang tanpanya tidak ada satu pun
 * endpoint gating yang berarti.
 */
const ENROLL_TOKEN = process.env.PLUGIN_ENROLL_TOKEN || "";

/**
 * Token API Cloudflare — dipakai tab DNS Record di halaman Domains.
 *
 * KOSONG = hanya tab itu yang mati (menjawab 503 berikut sebabnya, dan halamannya mengatakan apa
 * yang kurang); tidak ada satu pun fitur lain yang bergantung padanya. Jadi tidak ada
 * `process.exit` untuk yang satu ini — sepola META_ACCESS_TOKEN dan PLUGIN_ENROLL_TOKEN, dan
 * BERBEDA dari VI_CONTROL_API_KEY, yang tanpanya tidak ada satu pun endpoint gating yang berarti.
 *
 * Ia token dengan kuasa terbesar di berkas ini: ia menentukan ke mana setiap domain kita menunjuk.
 * Tempatnya di .env server dan tidak pernah di bundle frontend — lihat server/cloudflare.js.
 */
const CLOUDFLARE_TOKEN = process.env.CLOUDFLARE_API_TOKEN || "";
/**
 * Akun Cloudflare yang zonanya boleh dibuka dari dashboard.
 *
 * MENYARING, bukan sekadar melengkapi: sebuah token bisa punya akses ke beberapa akun, dan daftar
 * zona tanpa saringan ini akan memuat domain milik orang lain di layar yang tombolnya menghapus
 * record DNS. Kosong = tidak disaring, dan itu keadaan yang sebaiknya tidak dipakai.
 */
const CLOUDFLARE_ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID || "";

// Pola cron @elysiajs/cron: enam bidang, dengan DETIK di depan. "0 */2 * * * *" = tiap dua menit,
// sama dengan jadwal `scheduledGating` yang digantikannya. Ditulis lima bidang, detiknya jadi menit
// dan siklusnya jalan enam puluh kali lebih sering dari yang dimaksud.
const CRON_PATTERN = process.env.GATING_CRON || "0 */2 * * * *";

// Jadwal saklar campaign, menggantikan `scheduledCampaignCommands`. Digeser 30 detik dari gating
// supaya dua siklus yang sama-sama memanggil API luar tidak selalu berangkat pada detik yang sama.
const CAMPAIGN_CRON = process.env.CAMPAIGN_CRON || "30 */2 * * * *";
/**
 * Ping armada plugin. Jauh lebih jarang dari dua jadwal di atas, dan itu disengaja.
 *
 * Yang dijaga jadwal ini bukan keadaan yang berubah cepat — sebuah situs WordPress tidak mati lalu
 * hidup lagi dalam dua menit — melainkan satu hal yang tidak akan diketahui siapa pun sampai
 * terlambat: enrollment yang hilang di sisi situs (plugin dipasang ulang, database di-restore).
 * Sejak itu terjadi, tidak ada satu pun tombol di halaman /plugin yang bekerja untuk situs itu.
 *
 * Tiap siklus menghubungi SETIAP situs yang enroll. Dipasang tiap dua menit seperti yang lain, satu
 * armada 200 situs berarti 144.000 request sehari ke server kita sendiri.
 */
const PLUGIN_CRON = process.env.PLUGIN_CRON || "0 0,30 * * * *";

/**
 * Percobaan ulang untuk situs yang TIDAK menjawab di sweep terakhir. Tiap menit, dan itu tidak
 * bertabrakan dengan alasan sweep penuh dipasang setengah jam sekali.
 *
 * Yang disapu jadwal ini bukan armada, melainkan daftar isu — hampir selalu kosong, dan saat kosong
 * biayanya satu bacaan RTDB. Jaraknya sendiri tidak ditentukan di sini melainkan di `retryPlan`
 * (1, 5, 15, 30 menit): siklus ini cuma menanyakan "sudah jatuh tempo?" cukup sering supaya
 * jadwal semenit benar-benar berarti semenit.
 */
const PLUGIN_RETRY_CRON = process.env.PLUGIN_RETRY_CRON || "0 * * * * *";

/**
 * Pembuangan jejak aktivitas yang lewat masa simpan. Sekali sehari, dini hari.
 *
 * Paling jarang dari semua jadwal di sini, dan itu bukan karena ia paling tidak penting: yang
 * dikerjakannya adalah menghapus baris berumur 30 hari, dan sebuah baris yang dibuang jam 03:00
 * alih-alih jam 02:00 tidak berbeda bagi siapa pun. Yang berbeda adalah biayanya — tiap siklus
 * menjalankan query terurut pada node yang paling cepat tumbuh di seluruh database.
 */
const ACTIVITY_CRON = process.env.ACTIVITY_CRON || "0 0 3 * * *";

/**
 * Token bot Telegram — dipakai membaca siapa yang menyapa bot, untuk panel "Menyapa bot" di
 * Notification Center. Bot yang SAMA dengan `scheduledReminders`, bukan bot kedua.
 *
 * KOSONG = hanya pendeteksian yang mati; menambah penerima lewat form Tambah Penerima tetap jalan,
 * dan seluruh notifikasi tetap dikirim Cloud Function seperti biasa (token itu tinggal di secret
 * Cloud Functions, tidak di sini). Jadi tidak ada `process.exit` untuk yang satu ini — sepola dengan
 * META_ACCESS_TOKEN dan PLUGIN_ENROLL_TOKEN.
 */
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";

/**
 * Tiap menit, dan di sinilah seluruh gunanya siklus ini.
 *
 * Yang ditentukan jadwal ini adalah berapa lama seseorang menatap layar setelah menekan Start.
 * Dititipkan ke `scheduledSync` (sejam sekali) atau `scheduledReminders` (sehari sekali), orang
 * yang baru saja menyapa bot harus diberi tahu untuk "menunggu sebentar" — dan sebentar itu bisa
 * berarti besok pagi.
 *
 * Biayanya saat kosong — dan kosong adalah keadaan normalnya — satu bacaan RTDB dan satu panggilan
 * Telegram. Digeser ke detik ke-15 supaya tidak berangkat bersamaan dengan percobaan ulang plugin
 * yang juga jalan tiap menit.
 */
const TELEGRAM_CRON = process.env.TELEGRAM_CRON || "15 * * * * *";

// Pindahkan titipan log sync dari RTDB ke SQLite. Tiap dua menit sudah cukup: GET /sync-runs
// menggabung RTDB yang belum ter-drain, jadi frekuensi ini cuma menentukan seberapa cepat RTDB
// kosong lagi, bukan apakah run terbaru tampil.
const SYNC_RUNS_CRON = process.env.SYNC_RUNS_CRON || "45 */2 * * * *";

/**
 * Penyapu job salinan campaign dari halaman /campaigns: yang menggantung jadi `unknown`, yang lebih
 * dari 7 hari dibuang. Tidak ada yang dipantau di Meta — penyalinan berjalan di dalam proses ini
 * sesudah route menjawab — jadi lima menit sekali cukup. Biayanya satu unduhan penuh
 * `dashboard/campaignCopyJobs` tiap siklus: node itu TIDAK ada di `WARM_PATHS`, jadi bacaannya tidak
 * dijawab cache penghangat. Node-nya kecil: job dibuang sesudah 7 hari.
 */
const CAMPAIGN_JOBS_CRON = process.env.CAMPAIGN_JOBS_CRON || "20 */5 * * * *";

/**
 * Tab Rasio Penayangan: satu laporan per network GAM tiap sepuluh menit. GAM menerbitkan jam baru
 * sekitar satu jam sesudahnya, jadi yang ditentukan jadwal ini adalah berapa lama jam yang sudah
 * terbit menunggu sebelum sampai ke layar — bukan seberapa segar angkanya. Detik ke-5 supaya tidak
 * berangkat bersamaan dengan siklus semenit lain (0, 15, 30).
 */
const FILL_RATE_CRON = process.env.FILL_RATE_CRON || "5 */10 * * * *";

/**
 * Sync penuh (GAM, AdSense, Meta, ROI, peringatan) — HANYA untuk instansi yang tidak punya Cloud
 * Functions. Kosong = mati, dan itu bawaan yang benar untuk instansi 1: di sana `scheduledSync`
 * sudah jalan tiap jam, dan dua penjadwal untuk satu database berarti dua run yang menembakkan kuota
 * GAM/Meta yang sama lalu saling menimpa `dashboard/syncStatus`.
 *
 * Bentuknya cron LIMA bidang, sama dengan `SYNC_SCHEDULE` Cloud Function — bukan enam bidang seperti
 * cron lain di berkas ini. Nilai yang sama ditulis ke `dashboard/syncStatus.schedule`, dan dari
 * situ topbar menghitung jadwal berikutnya lewat `nextRunAfter`, yang cuma membaca lima bidang;
 * detik ke-0 ditambahkan di sini untuk @elysiajs/cron.
 */
const SYNC_SCHEDULE = String(process.env.SYNC_SCHEDULE || "").trim();
const SYNC_CRON = SYNC_SCHEDULE ? `0 ${SYNC_SCHEDULE}` : "";
// Retry akun yang gagal, sepola `scheduledSyncRetry`. Detik ke-30 supaya tidak berangkat bersamaan
// dengan percobaan ulang plugin (detik 0) dan inbox Telegram (detik 15).
const SYNC_RETRY_CRON = process.env.SYNC_RETRY_CRON || "30 * * * * *";

/**
 * Alamat PUBLIK server ini — dipakai membentuk redirect OAuth Google, dan tidak bisa disimpulkan
 * dari dalam container: yang diketahui proses ini cuma port yang didengarkannya, bukan nama host di
 * depan proxy-nya. Kosong, hanya tombol Login di /google-api-configs yang mati (menjawab 503 berikut
 * sebabnya); tidak ada fitur lain yang bergantung padanya.
 *
 * Nilainya harus SAMA PERSIS dengan yang didaftarkan sebagai Authorized redirect URI di tiap OAuth
 * client Google — Google mencocokkannya karakter demi karakter, termasuk ada tidaknya garis miring
 * di ujung.
 */
const PUBLIC_URL = process.env.CONTROL_PUBLIC_URL || "";
const TIMEZONE = process.env.SYNC_TIMEZONE || "Asia/Jakarta";

/**
 * Origin yang boleh memanggil. Bukan `origin: true` (yang berarti `*`): endpoint ini mengubah
 * trafik iklan yang hidup, dan meski tiap request tetap butuh ID token superadmin, membuka CORS ke
 * seluruh dunia berarti halaman mana pun bisa mencoba memakai token yang sedang aktif di browser.
 *
 * Entri boleh berpola `https://*.contoh.com` (lihat origins.js) — `*` sebagai label paling kiri,
 * dan seluruh kedalaman di bawahnya ikut. Apex-nya TIDAK ikut: kalau ia juga boleh, ia ditulis
 * sebagai entri tersendiri, supaya tiap nama yang diizinkan benar-benar tertulis di daftarnya.
 */
const ORIGINS = parseOrigins(
  process.env.ALLOWED_ORIGINS,
  [
    // Entri PERTAMA adalah tujuan mendarat sesudah consent Google (`landingOrigin`), kecuali
    // DASHBOARD_URL diisi. Isi ALLOWED_ORIGINS di server/.env dengan domain dashboard Anda.
    // Contoh: https://your-dashboard.example.com,https://dashboard-tigerroi.web.app,http://localhost:5173
    "http://localhost:5173",
  ].join(","),
);

// Dihitung SEKALI di sini, bukan di dalam handler: entri wildcard yang bentuknya salah MELEMPAR,
// dan yang melempar saat request pertama datang adalah kegagalan yang muncul berjam-jam setelah
// sebabnya — sesudah orang yang menyunting env-nya pulang.
const CORS_ORIGINS = corsOrigins(ORIGINS);

if (!API_KEY) {
  console.error("[gating] VI_CONTROL_API_KEY belum di-set. Server berhenti.");
  process.exit(1);
}

// Login sekali saat start, bukan per request. Kalau gagal, server TIDAK jalan: satu proses yang
// menjawab 503 untuk tiap request lebih membingungkan daripada satu yang tidak pernah naik.
const db = await connect();
const store = clientStore(db);
// Landing + campaign Keitaro untuk subdomain baru, lalu gate vi-control. Satu fungsi untuk dialog
// Tautan landing (/plugin) dan langkah Setup Sub. KEITARO_API_KEY kosong = hanya ini yang 503.
const createKeitaroForSite = keitaroSiteCreator({
  store,
  apiKey: process.env.KEITARO_API_KEY || "",
  viControlKey: API_KEY,
  templateId: Number(process.env.KEITARO_TEMPLATE_CAMPAIGN_ID || 1),
});

/**
 * Langganan penghangat cache — dipasang SEBELUM cron pertama berjalan, dan tidak pernah dicabut.
 *
 * Tanpa ini tiap `get()` di siklus cron adalah unduhan penuh dari RTDB: `users` sendiri 3,2 MB dan
 * dibaca dua kali tiap dua menit, yaitu ~140 GB sebulan untuk node yang isinya nyaris tidak berubah.
 * Dengan langganan aktif, `get()` dijawab dari cache lokal dan yang lewat kabel cuma deltanya.
 * Lihat functions/warm-cache.js untuk alasan lengkapnya.
 */
warmCache(db, {
  onError: (path, error) =>
    console.error(
      `[cache] langganan penghangat "${path}" gagal: ${error.message} — bacaan node ini kembali menghubungi server tiap siklus.`,
    ),
});

// Jejak aktivitas pindah dari RTDB ke SQLite lokal: node itu paling cepat tumbuh dan dulu menyeret
// database yang dibaca halaman lain. File-nya harus di volume yang bertahan lewat redeploy —
// ACTIVITY_DB_PATH menunjuk ke sana (lihat Dockerfile).
const activityDb = openActivityDb();

// Log "Sync Otomatis" juga pindah ke SQLite (tabel lain, file yang sama). Cloud Function scheduledSync
// tetap menulis dashboard/syncRuns di RTDB sebagai titipan sesaat; drain di bawah memindahkannya ke
// sini lalu menghapusnya dari RTDB — jalur kritis sync tidak tersentuh.
const syncRunsDb = openSyncRunsDb();
console.log("[gating] tersambung ke RTDB sebagai SYNC_USER.");

/**
 * Satu run per siklus: run yang masih jalan saat jadwal berikutnya tiba membuat putaran itu DILEWATI,
 * bukan diantrekan — penjaga yang dulu dipegang `maxInstances/concurrency: 1` milik Cloud Functions.
 * Kegagalan dicatat dan tidak pernah melempar: satu siklus yang gagal tidak boleh menjatuhkan proses,
 * dan siklus berikutnya datang sendiri.
 *
 * `after` = siklus lain yang harus selesai dulu. Percobaan ulang dilewati selama sweep penuhnya
 * berjalan (bukan sebaliknya): sweep menanam daftar isu yang baru, dan percobaan atas daftar lama
 * sudah tidak berarti. `quiet` untuk siklus yang memang sering bertabrakan — satu baris log per
 * menit menenggelamkan log yang lain.
 */
function skipWhileRunning(label, task, { after = [], quiet = false } = {}) {
  const cycle = async (source) => {
    if (cycle.running || after.some((other) => other.running)) {
      if (!quiet) console.warn(`[${label}] ${source} dilewati: siklus sebelumnya masih jalan.`);
      return;
    }
    cycle.running = true;
    try {
      await task(source);
    } catch (error) {
      console.error(`[${label}] ${source} gagal: ${error.message}`);
    } finally {
      cycle.running = false;
    }
  };
  cycle.running = false;
  return cycle;
}

// Dua run yang tumpang-tindih berarti dua proses menembakkan gate yang sama.
const runCycle = skipWhileRunning("gating", async (source) => {
  const res = await syncGating(store, API_KEY);
  if (res.pending || res.cleaned) {
    console.log(
      `[gating] ${source}: ${res.applied} diterapkan, ${res.failed} gagal, dari ${res.pending} antrean.`,
    );
  }
  if (res.mirror) {
    console.log(
      `[gating] ${source}: cermin ${res.mirror.campaigns} campaign, ${res.mirror.previews} pratinjau, ${res.mirror.runs} riwayat.`,
    );
  }
});

/**
 * Satu penjaga untuk dua penulis `users/{id}/campaigns`: siklus campaign dua menitan dan sync akun
 * sesudah campaign diubah dari halaman /campaigns. Siklus cron MELEWATI putarannya kalau sibuk
 * (`tryRun`); antrean sync MENUNGGU (`run`) — perubahan yang baru dibuat orang tidak boleh
 * dibuang karena kebetulan berbarengan dengan penyegaran status.
 */
const campaignLock = createLock();

const accountSync = createAccountSyncQueue({
  lock: campaignLock,
  run: async (ids) => {
    const res = await syncCampaigns(db, META_TOKEN, ids);
    console.log(
      `[campaign] sync akun ${ids.join(", ")}: ${res.campaigns} campaign di ${res.updated} user.`,
    );
  },
});

async function runCampaignCycle(source) {
  if (!META_TOKEN) return;
  const started = campaignLock.tryRun(async () => {
    /**
     * SEBELUM penerap antrean, dan urutan ini KEBALIKAN dari gating.
     *
     * Di gating, vi-control membaca ulang dan memverifikasi sebelum menjawab, jadi cermin disegarkan
     * SESUDAH. Di sini Meta butuh waktu menampakkan perubahan: bacaan status yang datang setelah
     * penerap akan menimpa perintah yang baru diterapkan dengan keadaan lamanya, dan tombol yang
     * baru ditekan melompat balik ke posisi semula di layar.
     */
    try {
      const res = await refreshCampaignStatuses(db, META_TOKEN);
      if (res.fields) {
        console.log(`[campaign] status disegarkan: ${res.fields} kolom di ${res.users} user.`);
      }
      for (const error of res.errors) {
        console.error(`[campaign] status ${error.name} gagal dibaca: ${error.message}`);
      }
    } catch (error) {
      // Antrean tetap jalan: yang gagal cuma pembacaan status, dan perintah yang sudah ditulis orang
      // tidak ada hubungannya dengan itu.
      console.error(`[campaign] penyegaran status gagal: ${error.message}`);
    }

    const res = await applyCampaignCommands(store, META_TOKEN);
    if (res.pending || res.cleaned) {
      console.log(
        `[campaign] ${source}: ${res.applied} diterapkan, ${res.failed} gagal, dari ${res.pending} antrean.`,
      );
    }
  });
  if (!started) {
    console.warn(`[campaign] ${source} dilewati: siklus atau sync akun sebelumnya masih jalan.`);
    return;
  }
  try {
    await started;
  } catch (error) {
    console.error(`[campaign] ${source} gagal: ${error.message}`);
  }
}

// Dua node job, satu penyapu: bentuk barisnya berbeda, cara keduanya menggantung tidak. Yang satu
// gagal tidak menahan yang lain — job buat yang menggantung tetap harus jadi `unknown` walau RTDB
// menolak tulisan ke node salinan.
async function runCopyJobsSweep(source) {
  for (const [label, sweep] of [
    ["salinan", sweepCopyJobs],
    ["buat", sweepCreateJobs],
  ]) {
    try {
      const res = await sweep(store);
      if (res.changed) console.log(`[campaign] ${source}: ${res.changed} job ${label} disapu.`);
    } catch (error) {
      console.error(`[campaign] penyapu job ${label} ${source} gagal: ${error.message}`);
    }
  }
}

// Penjaga sendiri, terpisah dari gating: siklus ping yang menyapu 200 situs tidak boleh menahan
// gate/ungate yang sedang ditunggu orang di layar.
const runPluginCycle = skipWhileRunning("plugin", async (source) => {
  const res = await syncPlugin(store);
  if (res.checked) {
    console.log(`[plugin] ${source}: ${res.checked} situs dicek, ${res.failed} tidak menjawab.`);
  }
});

// Percobaan ulang punya penjaganya sendiri: satu penjaga untuk dua siklus berarti sweep yang panjang
// menelan seluruh jadwal percobaan yang justru sedang ditunggu orang di layar.
const runPluginRetryCycle = skipWhileRunning(
  "plugin-retry",
  async (source) => {
    const res = await retryPluginIssues(store);
    if (!res.skipped) {
      console.log(
        `[plugin] ${source}: percobaan ulang ${res.retried} situs — ${res.recovered} pulih, ${res.failed} masih gagal.`,
      );
    }
  },
  { after: [runPluginCycle], quiet: true },
);

// Pembuangan jejak lama. Node yang tidak menyusut jauh lebih ringan akibatnya daripada proses yang
// mati: penerima jejaknya sendiri tidak bergantung pada siklus ini sama sekali.
const runActivityPrune = skipWhileRunning("activity", async (source) => {
  const res = pruneActivityLogs(activityDb);
  if (res.removed) console.log(`[activity] ${source}: ${res.removed} baris lama dibuang.`);
});

/**
 * Pesan masuk bot Telegram -> daftar calon penerima. Penjaganya bukan sekadar kerapian: siklus ini
 * MENGKONSUMSI update (offset maju, Telegram menghapus yang lewat), jadi dua siklus bersamaan bisa
 * saling mencuri batch dan menyapa orang yang sudah disapa. Telegram yang tumbang tidak memajukan
 * offset — batch yang sama dibaca ulang utuh semenit lagi.
 */
const runTelegramInboxCycle = skipWhileRunning(
  "telegram",
  async (source) => {
    if (!TELEGRAM_TOKEN) return;
    const res = await syncTelegramInbox(store, TELEGRAM_TOKEN);
    // Diam saat tidak ada apa-apa — hampir tiap menit sepanjang hari.
    if (res.added || res.seen) {
      console.log(
        `[telegram] ${source}: ${res.seen} chat menyapa, ${res.added} baru, ${res.greeted} disapa balik.`,
      );
    }
  },
  { quiet: true },
);

// Penjaganya sendiri: laporan GAM di-poll sampai semenit per network, dan satu run lambat tidak
// boleh menahan siklus lain maupun menumpuk run kedua di atasnya.
const runFillRateCycle = skipWhileRunning(
  "fill-rate",
  async (source) => {
    const res = await syncFillRate(store);
    if (res.failed || res.written) {
      console.log(
        `[fill-rate] ${source}: ${res.networks} network, ${res.failed} gagal, ${res.written} jam ditulis.`,
      );
    }
  },
  { quiet: true },
);

/**
 * Satu tahap sync yang diminta dari Settings. Opsinya sama dengan `runSyncCycle` — yang berbeda
 * cuma `only` — dan penjaganya berbagi dengan run penuh ke dua arah: tahap tidak berangkat selama
 * run penuh jalan (dicek route), dan run penuh dilewati selama tahap jalan (`after`).
 */
const syncOptions = () => ({
  metaToken: META_TOKEN,
  telegramToken: TELEGRAM_TOKEN,
  timeZone: TIMEZONE,
  appUrl: process.env.DASHBOARD_URL || landingOrigin(ORIGINS),
  campaignLock: (task) => campaignLock.run(task),
});
const syncStage = {
  running: false,
  names: () => syncStageNames({ metaToken: META_TOKEN }),
  busy: () => syncStage.running || runSyncCycle.running,
  start(stage, actor) {
    syncStage.running = true;
    runFullSync(db, { ...syncOptions(), only: [stage], trigger: actor })
      .catch((error) => console.error(`[sync] tahap ${stage} gagal dijalankan: ${error.message}`))
      .finally(() => {
        syncStage.running = false;
      });
  },
};

/**
 * Satu run sync penuh pada satu waktu. Run berikutnya sejam lagi, dan dua run berturut-turut untuk
 * data yang sama cuma membayar kuota dua kali. Retry tidak jalan selama run penuh berjalan: run
 * penuh menanam ulang seluruh benihnya di akhir, dan retry yang menulis di tengahnya menulis ke
 * cabang yang sebentar lagi diganti.
 */
const runSyncCycle = skipWhileRunning(
  "sync",
  () => runFullSync(db, { ...syncOptions(), schedule: SYNC_SCHEDULE }),
  { after: [syncStage] },
);

const runSyncRetryCycle = skipWhileRunning(
  "syncRetry",
  () => runSyncRetries(db, { metaToken: META_TOKEN }),
  { after: [runSyncCycle], quiet: true },
);

// Drain log sync RTDB -> SQLite. Idempoten (upsert dulu, hapus belakangan), tapi penjaganya tetap
// dipasang supaya dua drain tidak sama-sama menghapus dari RTDB.
const runSyncRunsDrain = skipWhileRunning(
  "sync-runs",
  async (source) => {
    const res = await drainSyncRuns({ store, syncRunsDb });
    if (res.drained) console.log(`[sync-runs] ${source}: ${res.drained} baris dipindah ke SQLite.`);
  },
  { quiet: true },
);

// Jadwal seluruh siklus di atas. `catch: true`: kegagalan yang lolos dari `run` tidak boleh
// menghentikan jadwalnya. Sync dan retry-nya hanya didaftarkan kalau SYNC_SCHEDULE di-set — instansi
// yang sync-nya milik Cloud Functions tidak memasang cron itu sama sekali.
const CRON_JOBS = [
  ["gating", CRON_PATTERN, runCycle],
  ["campaign", CAMPAIGN_CRON, runCampaignCycle],
  ["plugin", PLUGIN_CRON, runPluginCycle],
  ["plugin-retry", PLUGIN_RETRY_CRON, runPluginRetryCycle],
  ["activity", ACTIVITY_CRON, runActivityPrune],
  ["sync-runs", SYNC_RUNS_CRON, runSyncRunsDrain],
  ["telegram-inbox", TELEGRAM_CRON, runTelegramInboxCycle],
  ["campaign-copy-jobs", CAMPAIGN_JOBS_CRON, runCopyJobsSweep],
  ["fill-rate", FILL_RATE_CRON, runFillRateCycle],
  ...(SYNC_CRON
    ? [
        ["sync", SYNC_CRON, runSyncCycle],
        ["sync-retry", SYNC_RETRY_CRON, runSyncRetryCycle],
      ]
    : []),
];

const cronJobs = CRON_JOBS.reduce(
  (plugin, [name, pattern, run]) =>
    plugin.use(cron({ name, pattern, timezone: TIMEZONE, catch: true, run: () => run("cron") })),
  new Elysia({ name: "cron-jobs" }),
);

export const app = new Elysia()
  .use(
    cors({
      origin: CORS_ORIGINS,
      methods: ["GET", "POST"],
      allowedHeaders: ["Authorization", "Content-Type"],
    }),
  )
  // Tanpa auth, tanpa RTDB, tanpa Keitaro — uptime check harus tetap menjawab justru saat semua itu
  // sedang bermasalah.
  .get("/livez", () => "ok")
  .use(cronJobs)
  /**
   * SEBELUM `.use()`, dan `as: "global"`. Keduanya perlu.
   *
   * Hook Elysia hanya berlaku untuk route yang didaftarkan SESUDAHNYA, dan secara bawaan tidak
   * menembus ke dalam plugin. Dipasang di bawah `.use(gatingRoutes(...))` tanpa scope global,
   * handler ini tidak pernah jalan — dan yang keluar untuk id campaign yang salah adalah dump skema
   * TypeBox mentah berisi struktur internal, bukan satu kalimat yang bisa dibaca orang.
   */
  .onError({ as: "global" }, ({ code, error, set }) => {
    const { status, body, log } = controlErrorResponse(code, error);
    if (log) console.error(`[gating] ${code}: ${error?.message}`);
    set.status = status;
    return body;
  })
  .use(gatingRoutes({ db, apiKey: API_KEY, store }))
  .use(campaignRoutes({ db, store, metaToken: META_TOKEN }))
  // Tab "Terjadwal" di Overview: ad set armada yang akan mulai tayang, berikut PIC-nya — supaya
  // advertiser tidak menjadwalkan di jam yang sama dan menjatuhkan server situsnya. Setiap akun yang
  // login, dibaca saat diminta dengan cermin bersama dua menit.
  .use(
    scheduledLaunchRoutes({
      db,
      store,
      metaToken: META_TOKEN,
      cloudflareToken: CLOUDFLARE_TOKEN,
      cloudflareAccount: CLOUDFLARE_ACCOUNT,
    }),
  )
  /**
   * Halaman Campaign (/campaigns) — salin bertahap dan ubah campaign Meta. SUPERADMIN, gerbangnya di
   * campaign-manage.js. Salinan berjalan di latar proses ini; tiap tulisan yang berhasil memasukkan
   * ad account-nya ke antrean sync, supaya campaign salinan dan nama baru tampil di tabel tanpa
   * menunggu sync per jam.
   */
  .use(campaignManageRoutes({ db, store, metaToken: META_TOKEN, enqueueSync: accountSync.enqueue }))
  /**
   * Tombol Buat di halaman yang sama: satu campaign + N ad set + N iklan, semuanya PAUSED. Berkas
   * sendiri karena yang dijaganya berbeda — bukan kepemilikan campaign yang sudah ada, melainkan
   * bahwa tiap BAHAN campaign baru (ad account, Halaman, pixel, link) memang milik kita.
   */
  .use(campaignCreateRoutes({ db, store, metaToken: META_TOKEN, enqueueSync: accountSync.enqueue }))
  .use(pluginRoutes({ db, store, enrollToken: ENROLL_TOKEN }))
  /**
   * DNS Cloudflare untuk tab DNS Record di /domains. Superadmin, dan TANPA cron.
   *
   * Tidak ada siklus yang perlu dijalankan: record DNS tidak dicerminkan ke RTDB sama sekali, dan
   * yang dicari orang di sana adalah keadaan pada detik ini — cermin sejam lalu justru jawaban yang
   * salah. Sepola panel ad set, dengan alasan yang sama.
   */
  .use(cloudflareRoutes({ db, apiKey: CLOUDFLARE_TOKEN, accountId: CLOUDFLARE_ACCOUNT }))
  .use(keitaroRoutes({ db, store, create: createKeitaroForSite }))
  /**
   * Setup Sub (/setup-sub): site CloudPanel + WordPress + SSL + plugin untuk subdomain baru, lewat
   * SSH ke server CloudPanel dengan kunci yang dikunci ke satu skrip. Kosong = hanya tab itu yang mati.
   * SETUP_SUB_SERVERS = "rabbit-ads=rabbitroi@88.99.216.50,rabbit-ads-2=rabbitroi@94.130.38.76,...";
   * server tiap sub = yang dituju A record domain induknya. Satu kunci (SETUP_SUB_SSH_KEY) untuk semua.
   * PLUGIN_GITHUB_TOKEN = PAT baca repo plugin; zip rilisnya dikirim lewat SSH ke server tanpa plugin.
   */
  .use(
    setupSubRoutes({
      db,
      store,
      sshUser: process.env.SETUP_SUB_SSH_USER || "rabbitroi",
      sshKey: process.env.SETUP_SUB_SSH_KEY || "",
      bootstrapUser: process.env.SETUP_SUB_ROOT_USER || "root",
      bootstrapPassword: process.env.SETUP_SUB_ROOT_PASSWORD || "",
      wpAdmin: {
        user: process.env.SETUP_SUB_WP_ADMIN_USER || "",
        password: process.env.SETUP_SUB_WP_ADMIN_PASSWORD || "",
      },
      pluginToken: process.env.PLUGIN_GITHUB_TOKEN || "",
      cloudflareToken: CLOUDFLARE_TOKEN,
      cloudflareAccount: CLOUDFLARE_ACCOUNT,
      enrollToken: ENROLL_TOKEN,
      createKeitaro: createKeitaroForSite,
    }),
  )
  // "Impor dari Google" untuk /gam-accounts, /adsense-accounts, /domains, dan /sub-domains.
  // Tanpa cron: yang ini hanya jalan saat ada yang menekan tombolnya — sebuah network baru muncul
  // karena ada orang yang menambahkannya, bukan karena waktu berlalu.
  .use(discoverRoutes({ db, store }))
  /**
   * Jejak aktivitas tiap orang. SATU-SATUNYA jalur masuknya, dan bukan demi kerapian: `ip`, kota
   * pemilik IP itu, dan `User-Agent` hanya bisa DIAMATI di sini — browser tidak tahu alamat
   * publiknya sendiri, dan yang ditulisnya tentang dirinya sendiri adalah klaim.
   *
   * Berbeda dari endpoint lain di file ini, yang ini terbuka untuk SETIAP akun yang login, bukan
   * superadmin: yang superadmin adalah halaman yang MEMBACA-nya. Log yang cuma menerima kiriman
   * superadmin tidak mencatat satu pun orang yang aktivitasnya ingin dilihat.
   */
  .use(activityRoutes({ db, activityDb }))
  // Log "Sync Otomatis" untuk halaman Settings — admin. Ditulis Cloud Function ke RTDB, di-drain ke
  // SQLite oleh cron di atas; GET-nya menggabung keduanya.
  .use(syncRunsRoutes({ db, store, syncRunsDb, syncStage }))
  /**
   * Tujuan akhir setelah consent adalah origin dashboard PERTAMA, bukan alamat dari request.
   *
   * Daftar origin yang sama yang menjaga CORS dipakai ulang di sini supaya tidak ada konfigurasi
   * kedua yang bisa bergeser darinya — dan supaya tempat orang mendarat sesudah OAuth tidak pernah
   * bisa ditentukan oleh yang memanggil.
   */
  .use(
    googleAuthRoutes({
      db,
      store,
      publicUrl: PUBLIC_URL,
      appUrl: process.env.DASHBOARD_URL || landingOrigin(ORIGINS),
    }),
  )
  .listen({ port: PORT, hostname: HOST });

console.log(`[gating] siap di http://${HOST}:${PORT} — cron "${CRON_PATTERN}" (${TIMEZONE})`);
console.log(`[gating] origin yang diizinkan: ${ORIGINS.join(", ")}`);
console.log(
  META_TOKEN
    ? `[campaign] saklar campaign aktif — cron "${CAMPAIGN_CRON}"`
    : "[campaign] META_ACCESS_TOKEN belum di-set — sisi campaign dilewati, gating tetap jalan.",
);
console.log(
  ENROLL_TOKEN
    ? `[plugin] manajemen plugin aktif — ping cron "${PLUGIN_CRON}"`
    : `[plugin] PLUGIN_ENROLL_TOKEN belum di-set — situs baru tidak bisa di-enroll; yang sudah enroll tetap bisa dikelola. Ping cron "${PLUGIN_CRON}".`,
);

console.log(`[plugin] percobaan ulang bagian yang gagal — cron "${PLUGIN_RETRY_CRON}"`);

console.log(
  META_TOKEN
    ? `[campaign] halaman Campaign aktif — penyapu job salinan cron "${CAMPAIGN_JOBS_CRON}"`
    : "[campaign] META_ACCESS_TOKEN belum di-set — halaman Campaign tidak bisa menulis ke Meta.",
);

console.log(
  CLOUDFLARE_TOKEN
    ? `[cloudflare] tab DNS Record aktif${CLOUDFLARE_ACCOUNT ? ` — akun ${CLOUDFLARE_ACCOUNT}` : " — TANPA saringan akun, seluruh zona yang bisa disentuh token ini akan tampil"}`
    : "[cloudflare] CLOUDFLARE_API_TOKEN belum di-set — tab DNS Record tidak bisa dipakai; fitur lain tidak terpengaruh.",
);

console.log(
  SYNC_CRON
    ? `[sync] sync penuh aktif — cron "${SYNC_SCHEDULE}" (${TIMEZONE}), retry "${SYNC_RETRY_CRON}"`
    : "[sync] SYNC_SCHEDULE kosong — sync penuh milik Cloud Function scheduledSync, bukan server ini.",
);

console.log(`[activity] jejak aktivitas aktif — pembuangan cron "${ACTIVITY_CRON}"`);

console.log(
  TELEGRAM_TOKEN
    ? `[telegram] pendeteksian chat aktif — cron "${TELEGRAM_CRON}"`
    : "[telegram] TELEGRAM_BOT_TOKEN belum di-set — chat yang menyapa bot tidak terdeteksi; penerima tetap bisa ditambah manual.",
);

// Satu siklus saat start supaya cermin tidak menunggu tenggat cron pertama sesudah deploy.
runCycle("start");
runCampaignCycle("start");
runPluginCycle("start");
// Ikut jalan saat start: orang yang menyapa bot selagi server di-restart tidak boleh menunggu
// siklus berikutnya, dan batch yang tertinggal di antrean Telegram memang paling tua di sana.
runTelegramInboxCycle("start");
// Pembuangan jejak sengaja TIDAK ikut jalan saat start: server yang di-restart beberapa kali dalam
// satu sesi deploy akan menjalankan query terurut penuh tiap kali, dan tidak ada satu pun yang
// menunggu hasilnya. Siklus dini hari berikutnya cukup.
