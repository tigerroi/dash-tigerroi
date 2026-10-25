import { get, orderByKey, query, ref, startAt, update } from "firebase/database";
import {
  alertMessage,
  alertNoticeUpdate,
  alertSummary,
  alertsToSend,
  evaluateAlerts,
  runningRows,
} from "./alerts-core.js";
import { applyCampaignCommands } from "./campaign-commands.mjs";
import {
  noticesToSend,
  notifiableAlerts,
  recoveredNotices,
  rowsOf,
  scopedAlerts,
  syncIssueAlerts,
  syncIssueMessage,
  syncIssueSummary,
  noticeUpdate as syncNoticeUpdate,
  syncRecoveryMessage,
  topicRecipients,
  topicSettings,
} from "./notifications-core.js";
import { syncAdsenseAccounts } from "./sync-adsense.mjs";
import {
  dueRetries,
  excessSyncRunKeys,
  retryOutcome,
  retrySeed,
  SYNC_ISSUES_PATH,
  SYNC_RETRY_PATH,
  shiftDateKey,
  syncRunEntry,
  syncRunKey,
  syncStatusUpdate,
  zonedDateKey,
} from "./sync-core.js";
import { syncAccounts } from "./sync-gam.mjs";
import { syncAdAccounts, syncCampaigns } from "./sync-meta.mjs";
import { syncSubdomains } from "./sync-subdomains.mjs";
import { deliverToChats } from "./telegram.mjs";
import { SYNC_WARM_PATHS, warmCache } from "./warm-cache.js";

/**
 * Satu run sync penuh dan satu putaran retry — TANPA penjadwalnya.
 *
 * Dipindah dari scheduled-sync.js supaya DUA penjadwal memanggil badan yang sama: Cloud Function
 * `scheduledSync` (instansi 1) dan cron server kontrol (`SYNC_SCHEDULE`, instansi 2 — project
 * rabbitroi-dwiki tidak punya Cloud Functions sama sekali, dan sampai modul ini ada `roiReports`-nya
 * cuma terisi kalau seseorang menjalankan CLI dengan tangan). Disalin ke server alih-alih dipindah,
 * dua run di dua tempat akan menulis `dashboard/syncStatus` dengan dua aturan yang berbeda suatu
 * hari, dan topbar tidak punya cara tahu yang mana yang sedang ia baca.
 *
 * Tidak mengimpor `firebase-functions`: yang memegang secret, zona jadwal, dan batas satu run pada
 * satu waktu adalah penjadwalnya, dan semuanya masuk lewat argumen.
 */

/**
 * Chat penerima satu topik notifikasi, dibaca dari RTDB.
 *
 * Tiga node sekaligus, dan ketiganya memang harus dibaca bersama: orang (`users`), grup
 * (`notificationGroups`), dan siaran per role (`settings/notifications`). Yang memutuskan
 * `topicRecipients` di notifications-core.js — cerminan src/lib/notifications.js, satu aturan yang
 * dipakai halaman Notification Center untuk menghitung kolom "Penerima".
 *
 * Dipanggil per topik dan bukan sekali untuk semua: dua tahap di bawah berjalan berjauhan, dan
 * daftar yang dibaca di awal run sepanjang beberapa menit adalah daftar yang bisa saja sudah
 * berubah — orang yang baru saja membisukan sebuah topik tetap menerimanya sekali lagi.
 */
async function topicRecipientList(db, topic) {
  const [usersSnap, groupsSnap, settingsSnap] = await Promise.all([
    get(ref(db, "users")),
    get(ref(db, "notificationGroups")),
    get(ref(db, "settings/notifications")),
  ]);

  return topicRecipients(topic, {
    users: rowsOf(usersSnap.val()),
    groups: rowsOf(groupsSnap.val()),
    settings: settingsSnap.val(),
  });
}
// Satu tahap gagal tidak boleh menjatuhkan tahap berikutnya: token Meta yang mati tidak ada
// hubungannya dengan laporan GAM, dan menghentikan seluruh run karenanya berarti kehilangan
// data yang sebenarnya masih bisa diambil.
async function stage(name, run, stages) {
  try {
    stages.push({ name, ok: true, detail: (await run()) || "ok" });
  } catch (error) {
    console.error(`[sync] ${name} gagal: ${error.message}`);
    stages.push({ name, ok: false, detail: error.message });
  }
}

/**
 * Progres tahap untuk badge "Syncing..." di topbar: tahap ke berapa dari berapa, dan yang mana.
 *
 * Kegagalan tulisnya DITELAN, berbeda dari tulisan status pertama yang dilempar ulang. Yang di
 * sana menentukan run ini terlihat jalan atau tidak; yang di sini cuma memperhalus badge yang
 * sudah menyala — dan run yang laporannya sudah setengah tersimpan tidak boleh dijatuhkan oleh
 * satu tulisan hiasan.
 *
 * Tidak perlu dibersihkan di akhir: tulisan penutup mengganti `dashboard/syncStatus` seutuhnya.
 */
async function reportProgress(db, progress) {
  try {
    await update(ref(db, "dashboard/syncStatus"), { progress });
  } catch (error) {
    console.warn(`[sync] progres tahap tidak tersimpan: ${error.message}`);
  }
}

// Tanam benih retry untuk akun yang gagal di satu cabang. Mengganti seluruh cabang: akun yang pulih
// di run penuh ini tidak boleh tertinggal, dan `{branch: null}` menghapus cabang yang kini bersih.
async function seedRetries(db, branch, errors, now) {
  const map = retrySeed(errors, now);
  await update(ref(db, SYNC_RETRY_PATH), { [branch]: Object.keys(map).length ? map : null });
}

/**
 * Nilai baris ROI hari berjalan, kirim yang melewati ambang.
 *
 * Seluruh keputusannya ada di `alerts-core.js` — yang di sini cuma I/O: baca, kirim, tandai.
 * Itu yang membuat aturannya bisa dites tanpa RTDB maupun Telegram.
 *
 * Diam-diam berhenti kalau topiknya dimatikan, tokennya belum di-set, atau tidak ada penerimanya.
 * Ketiganya keadaan yang sah untuk project yang belum memakai fitur ini, dan sebuah tahap yang
 * berbunyi "gagal" tiap jam untuk fitur yang memang tidak dipakai akan membuat orang berhenti
 * membaca log run.
 *
 * ═══ SAKLARNYA SATU, DAN ITU SAKLAR TOPIKNYA ═══
 *
 * `settings/alerts` menyimpan ANGKANYA saja sekarang; on/off-nya dibaca dari
 * `settings/notifications/roiAlerts.enabled` — kolom Aktif di tab Topik. Sebelumnya ada dua saklar
 * untuk satu pesan (topiknya, dan "Nyalakan peringatan" di form ambang), dan bentuk itu adalah yang
 * paling sering dibaca sebagai "fiturnya rusak": yang satu dinyalakan, yang lain tetap diam, dan
 * tidak ada apa pun di layar yang menyebutkan bahwa masih ada yang kedua.
 *
 * `enabled` yang tersimpan di `settings/alerts` sengaja DITIMPA di sini, bukan dibaca: baris lama
 * membawa `false` dari zaman form itu, dan membacanya berarti saklar yang sudah tidak ada di layar
 * mana pun tetap menahan seluruh fitur.
 */
async function runAlerts(db, token, { timeZone, alertUrl }) {
  const [settingsSnap, notifSnap] = await Promise.all([
    get(ref(db, "settings/alerts")),
    get(ref(db, "settings/notifications")),
  ]);

  // Saklar topiknya diperiksa SEBELUM baris ROI diminta, bukan sesudah. Dibaca bersama-sama
  // seperti dulu, run yang topiknya dimatikan tetap membayar unduhan baris ROI-nya setiap jam
  // untuk kemudian membuangnya tanpa dibaca satu baris pun.
  if (!topicSettings(notifSnap.val(), "roiAlerts").enabled) {
    return 'topik "Peringatan ROI" dimatikan';
  }

  const settings = { ...(settingsSnap.val() || {}), enabled: true };

  /**
   * DUA HARI TERAKHIR, bukan seluruh `dashboard/roiReports`.
   *
   * Yang dinilai cuma baris hari BERJALAN (`runningRows` memilih tanggal partial terbaru),
   * sementara node itu tumbuh selamanya — 2.598 baris / 1,85 MB per 8 Sep 2026, bertambah ~14 KB
   * tiap hari — dan diunduh utuh tiap jam untuk memakai 25 baris. Kuncinya `YYYY-MM-DD__id`, jadi
   * urutan kunci ADALAH urutan tanggal dan jendelanya bisa diminta ke server: 17 KB, dan tetap 17 KB
   * tahun depan. Jendela yang sama dipakai `syncSubdomains` (`roiReportWindowStart`).
   *
   * Kemarin ikut sebagai penyangga, bukan karena dibutuhkan: tahap ROI berjalan tepat sebelum ini
   * dan selalu menulis baris hari berjalan, jadi hari ini pasti ada. Yang berubah cuma satu sudut
   * yang memang sudah keliru — dengan `SYNC_INCLUDE_TODAY=0` tidak ada baris partial hari ini sama
   * sekali, dan yang lama lalu memperingatkan atas baris partial BEKU dari berminggu-minggu lalu
   * (ada 17 tanggal seperti itu di produksi) seolah itu keadaan sekarang.
   */
  const since = shiftDateKey(zonedDateKey(new Date(), timeZone), -1);
  const reports = (
    await get(query(ref(db, "dashboard/roiReports"), orderByKey(), startAt(since)))
  ).val();
  const alerts = evaluateAlerts(runningRows(reports), settings);

  const noticesSnap = await get(ref(db, "dashboard/alertNotices"));
  const notices = noticesSnap.val() || {};
  const today = zonedDateKey(new Date(), timeZone);
  const pending = alertsToSend(alerts, notices, today);

  if (pending.length === 0) {
    // Penanda milik subdomain yang sudah pulih tetap disapu meski tidak ada yang dikirim — kalau
    // tidak, node ini hanya menyusut di jam yang kebetulan ada peringatan.
    const sweep = alertNoticeUpdate([], notices, today);
    if (Object.keys(sweep).length) await update(ref(db, "dashboard/alertNotices"), sweep);
    return alertSummary(alerts, 0, 0);
  }

  if (!token) return `${pending.length} melewati ambang, TELEGRAM_BOT_TOKEN belum di-set`;

  const recipients = await topicRecipientList(db, "roiAlerts");
  if (recipients.length === 0) {
    return `${pending.length} melewati ambang, belum ada penerima di Notification Center`;
  }

  /**
   * SATU PESAN PER PENERIMA, isinya menyesuaikan lingkupnya — bukan satu daftar yang sama untuk
   * semua chat seperti dua topik lainnya.
   *
   * Admin menerima seluruh armada; tiap PIC menerima subdomain yang dipegangnya sendiri
   * (`scopedAlerts`, cerminan src/lib/notifications.js). Dikirim utuh ke semua orang, tiap
   * advertiser membaca dua puluh baris untuk menemukan satu barisnya — dan pesan yang harus disaring
   * sendiri tiap pagi adalah pesan yang berhenti dibuka.
   *
   * Yang lingkupnya kosong dilewati TANPA pesan, bukan dikirimi pesan kosong: "0 peringatan" tiap
   * jam adalah cara tercepat membuat orang membisukan chatnya.
   */
  const deliveries = [];
  for (const entry of recipients) {
    const rows = scopedAlerts(pending, entry.scope);
    if (rows.length) deliveries.push({ entry, rows });
  }
  if (deliveries.length === 0) {
    return `${pending.length} melewati ambang, tidak ada penerima yang memegang subdomainnya`;
  }

  let delivered = 0;
  // Yang benar-benar sampai — dikumpulkan per BARIS, bukan per pesan: sebuah peringatan yang cuma
  // masuk ke pesan yang gagal terkirim harus tetap "belum dikabarkan" supaya run berikutnya
  // mencobanya lagi, walau pesan penerima lain di run yang sama berhasil.
  const sent = new Map();
  for (const { entry, rows } of deliveries) {
    const ok = await deliverToChats(
      token,
      [entry.chatId],
      alertMessage(rows, settings, alertUrl),
      {
        label: "sync/roiAlerts",
      },
    );
    if (!ok) continue;

    delivered += 1;
    for (const row of rows) sent.set(row.id, row);
  }

  if (sent.size > 0) {
    const marks = alertNoticeUpdate([...sent.values()], notices, today);
    await update(ref(db, "dashboard/alertNotices"), marks);
  }

  return alertSummary([...sent.values()], delivered, deliveries.length);
}

/**
 * Kabarkan bagian sync yang gagal — dan yang PULIH — dari daftar yang SAMA dengan ikon peringatan
 * di topbar.
 *
 * `dashboard/syncIssues` sudah ditulis tiap modul sync sejak lama, dan sudah punya pembacanya di
 * layar. Yang belum ada adalah arah keluarnya: ikon hanya menyala untuk orang yang sedang membuka
 * dashboard, jadi laporan GAM yang gagal pada run pukul 02:00 berarti earning belasan subdomain
 * kosong sampai ada yang kebetulan membuka tab pagi harinya.
 *
 * Membaca node itu apa adanya dan bukan mengumpulkan kegagalan sendiri: dua daftar untuk satu
 * keadaan akan berbeda isinya suatu hari, dan yang di layar dengan yang di chat berbeda adalah cara
 * tercepat membuat orang tidak mempercayai keduanya.
 *
 * Yang BERANGKAT dari daftar itu bukan semuanya: golongan `provider` (5xx, timeout, 429, balasan
 * non-JSON) disaring `notifiableAlerts`, karena retry sudah mengurusnya sendiri dan sebagian besar
 * pulih sebelum penerimanya sempat membuka ponsel. Itu penyempitan pada JALAN KELUARNYA, bukan pada
 * daftarnya — layar tetap menampilkan semuanya.
 *
 * Sekali sehari per (cabang + target), `dashboard/syncIssueNotices` — bentuk dan alasan yang sama
 * dengan `alertNotices` dan `reminderNotices`. Tanpa itu, satu hosting yang tumbang seharian
 * mengirim dua puluh empat pesan yang isinya sama persis. Kabar pulih menumpang penanda yang sama
 * dan ikut kena batas itu: maksimal dua pesan per target per hari, satu gagal satu pulih. Akun yang
 * berkedip tiap jam kalau tidak akan mengirim dua puluh empat pesan sehari, dan chat yang begitu
 * dibisukan orang bersama pengingat jatuh tempo yang datang dari bot yang sama.
 */
async function runSyncIssueNotices(db, token, { timeZone, syncIssueUrl }) {
  const [issuesSnap, noticesSnap] = await Promise.all([
    get(ref(db, SYNC_ISSUES_PATH)),
    get(ref(db, "dashboard/syncIssueNotices")),
  ]);

  const notices = noticesSnap.val() || {};
  const today = zonedDateKey(new Date(), timeZone);
  const alerts = syncIssueAlerts(issuesSnap.val());
  // Yang golongannya `provider` berhenti di sini: retry sudah mengurusnya, dan pesan merah yang
  // dicabut sendiri beberapa menit kemudian adalah cara chat ini dibisukan orang. Penjelasan
  // lengkapnya di `notifiableAlerts`. Yang disaring cuma jalan keluarnya — daftar isunya sendiri
  // tetap utuh di `dashboard/syncIssues` dan tetap menyalakan ikon di topbar.
  const notifiable = notifiableAlerts(alerts);
  const muted = alerts.length - notifiable.length;
  const pending = noticesToSend(notifiable, notices, today);
  // Yang PERNAH dikabarkan gagal hari ini dan sekarang sudah tidak ada lagi di daftar isu. Dihitung
  // di sini, bukan di tahap sync yang memperbaikinya: satu-satunya yang tahu sebuah kegagalan sudah
  // pernah diberitahukan ke chat adalah node penanda ini.
  // Dari daftar PENUH, bukan dari `notifiable`: isu yang tadi pagi gagal dengan 401 lalu sore ini
  // gagal dengan 503 masih gagal, dan mengabarkannya "pulih" hanya karena golongannya berpindah ke
  // yang tidak dikirimkan adalah kabar baik yang tidak benar.
  const recovered = recoveredNotices(alerts, notices, today);

  if (pending.length === 0 && recovered.length === 0) {
    // Penanda milik isu yang sudah pulih tetap disapu meski tidak ada yang dikirim — kalau tidak,
    // node ini hanya menyusut di run yang kebetulan menemukan kegagalan baru.
    const sweep = syncNoticeUpdate([], [], notices, today);
    if (Object.keys(sweep).length) await update(ref(db, "dashboard/syncIssueNotices"), sweep);
    return syncIssueSummary(pending, 0, 0, 0, muted);
  }

  if (!token) return `${pending.length} kegagalan, TELEGRAM_BOT_TOKEN belum di-set`;

  const chatIds = (await topicRecipientList(db, "syncIssues")).map((entry) => entry.chatId);
  if (chatIds.length === 0) return syncIssueSummary(pending, 0, 0, 0, muted);

  // Dua pesan terpisah dan bukan satu pesan berisi keduanya: yang merah menuntut tindakan, yang
  // hijau justru mencabut tuntutan itu, dan digabung yang terbaca cuma warna paling atas.
  let delivered = 0;
  if (pending.length > 0) {
    delivered = await deliverToChats(token, chatIds, syncIssueMessage(pending, syncIssueUrl), {
      label: "sync/syncIssues",
    });
  }

  let recoveryDelivered = 0;
  if (recovered.length > 0) {
    // "Masih ada N bagian yang gagal" menyuruh orang melihat PESAN SEBELUMNYA, jadi yang dihitung
    // hanya yang benar-benar pernah berangkat ke chat — gangguan penyedia yang disaring tidak punya
    // pesan untuk dilihat, dan menghitungnya di sini mengirim orang mencari kabar yang tidak ada.
    const text = syncRecoveryMessage(recovered, notifiable.length, syncIssueUrl);
    recoveryDelivered = await deliverToChats(token, chatIds, text, {
      label: "sync/syncRecovered",
    });
  }

  // Ditandai hanya yang benar-benar diterima seseorang — sepola dengan dua pengirim lainnya. Yang
  // gagal terkirim TIDAK ditandai, jadi run berikutnya mencobanya lagi; itu berlaku terpisah untuk
  // kabar gagal dan kabar pulih, karena keduanya berangkat sebagai pesan sendiri-sendiri.
  const marks = syncNoticeUpdate(
    delivered > 0 ? pending : [],
    recoveryDelivered > 0 ? recovered : [],
    notices,
    today,
  );
  if (Object.keys(marks).length) await update(ref(db, "dashboard/syncIssueNotices"), marks);

  return syncIssueSummary(
    pending,
    delivered,
    chatIds.length,
    recoveryDelivered > 0 ? recovered.length : 0,
    muted,
  );
}

/**
 * Tautan di pesan Telegram, diturunkan dari alamat dashboard. Peringatan ROI menunjuk tab tabel ROI
 * (yang dicari penerimanya adalah baris yang disebutkan), kegagalan sync menunjuk log run di
 * Settings (yang dicari adalah tahap mana yang jatuh).
 */
export function syncMessageUrls(appUrl) {
  const base = String(appUrl || "").replace(/\/+$/, "");
  return {
    alertUrl: base ? `${base}/dashboard/roi` : "",
    syncIssueUrl: base ? `${base}/settings?tab=logs` : "",
  };
}

/**
 * Tahap-tahap satu run, berurutan — disusun tanpa menjalankan apa pun. Dipisah dari `runFullSync`
 * supaya satu tahap bisa dijalankan sendiri (`only`) dan namanya bisa diperiksa lebih dulu
 * (`syncStageNames`) dengan daftar yang SAMA, bukan daftar kedua yang ditulis tangan.
 */
function syncPlan(
  db,
  {
    metaToken = "",
    telegramToken = "",
    timeZone = "Asia/Jakarta",
    appUrl = "",
    campaignLock = (task) => task(),
    startedAt = new Date(),
  } = {},
) {
  const { alertUrl, syncIssueUrl } = syncMessageUrls(appUrl);
  // Urutannya sama dengan yang dijalankan orang lewat tombol: saldo dan campaign Meta dulu
  // (di situlah pemetaan campaign -> subdomain ditulis), baru ROI yang membacanya.
  //
  // Didaftar dulu, dijalankan sesudahnya — bukan delapan pemanggilan berurutan seperti dulu.
  // Yang membuat badge "Syncing..." bisa menyebut "3/8" adalah `plan.length`, dan angka itu
  // tidak boleh datang dari daftar KEDUA yang ditulis tangan: daftar begitu meleset pada hari
  // seseorang menambah satu tahap, dan yang terlihat di layar cuma air yang selalu berhenti
  // sebelum tepi kanan. Jumlahnya memang berbeda antar-run (sisi Meta dilewati kalau tokennya
  // kosong), dan itu benar — yang dihitung adalah tahap yang akan benar-benar dijalankan.
  const plan = [
    [
      "GAM accounts",
      async () => {
        const res = await syncAccounts(db);
        await seedRetries(db, "gamAccounts", res.errors, startedAt);
        return `${res.ok} ok, ${res.fail} gagal`;
      },
    ],
    // Tahap sendiri, bukan digabung ke atas: ringkasan run adalah tempat pertama orang melihat
    // apa yang gagal, dan "5 ok, 1 gagal" yang mencampur dua API tidak menyebut halaman mana
    // yang harus dibuka.
    [
      "AdSense accounts",
      async () => {
        const res = await syncAdsenseAccounts(db);
        await seedRetries(db, "adsenseAccounts", res.errors, startedAt);
        return `${res.ok} ok, ${res.fail} gagal`;
      },
    ],
  ];

  if (metaToken) {
    plan.push(
      [
        "Meta accounts",
        async () => {
          const res = await syncAdAccounts(db, metaToken);
          await seedRetries(db, "metaAccounts", res.errors, startedAt);
          return `${res.ok} ok, ${res.fail} gagal`;
        },
      ],
      [
        "Meta campaigns",
        async () => {
          const res = await campaignLock(() => syncCampaigns(db, metaToken));
          return `${res.campaigns} campaign ke ${res.updated} user`;
        },
      ],
      // Sesudah sync campaign, bukan sebelum: sync menimpa `configuredStatus` tiap baris dengan
      // keadaan Meta apa adanya, jadi perintah yang diterapkan lebih dulu akan langsung tertimpa
      // status lamanya dan tombolnya melompat balik di layar.
      [
        "Saklar campaign",
        async () => {
          const res = await campaignLock(() => applyCampaignCommands(db, metaToken));
          return res.pending === 0
            ? "tidak ada antrean"
            : `${res.applied} diterapkan, ${res.failed} gagal`;
        },
      ],
    );
  } else {
    // Baris catatan, bukan tahap: `run` yang kosong menandainya. Ia tetap berdiri di URUTAN ini
    // supaya ringkasan run terbaca seperti sebelumnya, tapi tidak ikut memperbesar penyebut
    // progres — tahap yang selesai seketika membuat air melompat sebelum ada satu pun laporan
    // yang benar-benar diminta.
    plan.push([
      "Meta accounts",
      null,
      "META_ACCESS_TOKEN belum di-set, seluruh sisi Meta dilewati.",
    ]);
  }

  plan.push(
    ["ROI", async () => (await syncSubdomains(db, { metaToken })).summary],
    // SESUDAH tahap ROI, dan itu satu-satunya urutan yang benar: yang dinilai adalah baris yang
    // baru saja ditulis tahap di atas. Dijalankan sebelumnya, ia menilai keadaan satu jam lalu
    // dan mengirim peringatan untuk masalah yang mungkin sudah selesai.
    //
    // Sebagai tahap `stage()` biasa, bukan try/catch sendiri: Telegram yang tumbang tidak boleh
    // menjatuhkan run yang datanya sudah tersimpan, dan hasilnya ikut tercatat di log run yang
    // dibaca orang di halaman Settings — sama seperti tahap lain.
    ["Peringatan ROI", () => runAlerts(db, telegramToken, { timeZone, alertUrl })],
    // PALING AKHIR, dan itu satu-satunya urutan yang benar: yang dibacanya adalah daftar isu
    // yang baru saja ditulis seluruh tahap di atas. Dijalankan lebih awal, ia mengabarkan
    // kegagalan run SEBELUMNYA — termasuk yang sudah pulih di run ini.
    ["Notifikasi kegagalan sync", () => runSyncIssueNotices(db, telegramToken, { timeZone, syncIssueUrl })],
  );

  return plan;
}

// Nama tahap yang bisa dijalankan sendiri dari Settings (tahap catatan tanpa `run` tidak ikut).
export function syncStageNames(options = {}) {
  return syncPlan(null, options)
    .filter(([, run]) => run)
    .map(([name]) => name);
}

/**
 * Satu run penuh. `schedule` (bentuk cron 5 bidang) ikut ditulis ke `dashboard/syncStatus` — dari
 * situ topbar menghitung jadwal berikutnya, jadi ia harus jadwal yang BENAR-BENAR dipakai
 * penjadwalnya.
 *
 * `campaignLock` membungkus dua tahap yang menulis `users/{id}/campaigns`. Di server kontrol tahap
 * itu berbagi proses dengan siklus saklar campaign dua menitan dan sync akun dari halaman
 * /campaigns; tanpa penjaga yang sama, run sejam sekali ini menimpa perintah yang baru diterapkan
 * dengan bacaan Meta yang lebih tua. Cloud Function tidak berbagi proses dengan apa pun, jadi
 * bawaannya langsung menjalankan.
 */
export async function runFullSync(
  db,
  {
    metaToken = "",
    telegramToken = "",
    schedule,
    timeZone = "Asia/Jakarta",
    appUrl = "",
    campaignLock = (task) => task(),
    only = null,
    trigger = "",
  } = {},
) {
  const startedAt = new Date();
  const stages = [];
  // Rencananya disusun SEBELUM status ditulis: tahap yang diminta tapi tidak ada (`only`) ditolak
  // tanpa satu pun jejak "Syncing..." di topbar.
  let plan = syncPlan(db, { metaToken, telegramToken, timeZone, appUrl, campaignLock, startedAt });
  if (only) {
    plan = plan.filter(([name, run]) => run && only.includes(name));
    if (!plan.length) throw new Error(`Tahap sync tidak dikenal: ${only.join(", ")}.`);
  }

  // Ditulis sebelum tahap pertama, bukan sesudah: topbar menampilkan "Syncing..." selama flag
  // ini menyala, dan run yang butuh beberapa menit harus terlihat sedang berjalan sejak awal.
  //
  // `progress: null` membuang sisa run SEBELUMNYA yang tidak sempat menutup dirinya (kena batas
  // waktu 9 menit): badge akan menggambar air setinggi tahap yang selesai di run yang sudah
  // mati, dan yang terbaca orang adalah run baru yang melompat mundur sendiri.
  try {
    await update(ref(db, "dashboard/syncStatus"), {
      running: true,
      startedAt: startedAt.toISOString(),
      // Run satu tahap (`only`) tidak tahu jadwal penjadwalnya — di instansi 1 itu milik Cloud
      // Functions — jadi jadwal yang sudah tersimpan dibiarkan.
      ...(only ? {} : { schedule }),
      progress: null,
    });
  } catch (error) {
    console.error(
      `[sync] tidak bisa menulis ke dashboard/syncStatus: ${error.message} — SYNC_USER harus punya role admin di /roles/{uid} (aturan dashboard/.write).`,
    );
    throw error;
  }

  /**
   * Penghangat cache, hidup PERSIS selama tahap-tahap di bawah berjalan.
   *
   * Empat modul di bawah membaca `users` sampai enam kali tanpa saling tahu, dan tiap bacaan itu satu
   * unduhan penuh 3,1 MB — ~19 MB per run, 24 run sehari, untuk node yang isinya sudah ada di
   * memori proses ini. Dengan satu langganan aktif, `get()` dijawab dari cache lokal dan yang
   * lewat kabel cuma unduhan pertamanya. Lihat warm-cache.js untuk mekanismenya.
   *
   * DICABUT DI `finally`, dan itu bukan kerapian: di luar sebuah request Cloud Functions gen2
   * mencekik CPU instance-nya, jadi langganan yang bertahan sampai run BERIKUTNYA bisa menjawab
   * dari cache yang diam-diam berhenti diperbarui — dan yang dihitung dari cache itu adalah
   * earning dan belanja yang ditulis ke `roiReports`. Satu unduhan penuh per run adalah harga
   * yang dibayar supaya bacaannya tidak pernah basi.
   */
  const stopWarmCache = warmCache(db, {
    paths: SYNC_WARM_PATHS,
    onError: (path, error) =>
      console.error(
        `[sync] langganan penghangat "${path}" gagal: ${error.message} — bacaan node ini kembali menghubungi server tiap kali diminta.`,
      ),
  });

  const total = plan.filter(([, run]) => run).length;
  let done = 0;
  try {
    for (const [name, run, note] of plan) {
      if (!run) {
        stages.push({ name, ok: false, detail: note });
        continue;
      }

      // Ditulis SEBELUM tahapnya jalan, dan yang disebut `done` adalah tahap yang benar-benar
      // sudah selesai — air yang penuh sementara tahap terakhirnya belum mulai adalah janji yang
      // belum ditepati siapa pun. Nama tahap ikut supaya badge yang diam beberapa menit (laporan
      // GAM di-poll sampai semenit per network) tetap bisa menyebut apa yang sedang ditunggu.
      await reportProgress(db, { done, total, stage: name });
      await stage(name, run, stages);
      done += 1;
    }
  } finally {
    stopWarmCache();
  }

  const finishedAt = new Date();
  const entry = syncRunEntry(stages, startedAt, finishedAt);
  // Run satu tahap tercatat di log yang sama, dengan penanda di ringkasannya — tanpa itu ia terbaca
  // seperti run penuh yang cuma menjalankan satu tahap.
  if (only) entry.summary = `Manual${trigger ? ` (${trigger})` : ""}: ${entry.summary}`;

  // Log dan status ditulis dalam satu update: kalau tidak, ada jeda di mana topbar sudah
  // berhenti bilang "Syncing..." sementara barisnya belum muncul di halaman Settings.
  //
  // Run satu tahap TIDAK menimpa ringkasan run terakhir maupun jadwal berikutnya: "lastOk" milik
  // satu tahap akan mengaku mewakili seluruh sync.
  const payload = {
    [`syncRuns/${syncRunKey(startedAt)}`]: entry,
    ...(only
      ? { "syncStatus/running": false, "syncStatus/progress": null }
      : { syncStatus: syncStatusUpdate(entry, schedule, finishedAt) }),
  };
  await update(ref(db, "dashboard"), payload);

  // Menumpuk di node `dashboard` yang diikuti browser tiap halaman dibuka, jadi yang lama
  // dibuang di run yang sama — alasan yang sama dengan riwayat saldo.
  const existing = (await get(ref(db, "dashboard/syncRuns"))).val() || {};
  const removals = {};
  for (const key of excessSyncRunKeys(existing)) removals[key] = null;
  if (Object.keys(removals).length) await update(ref(db, "dashboard/syncRuns"), removals);

  console.log(`[sync] ${entry.durationSec}s — ${entry.summary}`);
  return entry;
}

/**
 * Satu putaran retry — mencoba ulang HANYA akun yang benihnya ditanam run penuh di
 * `dashboard/syncRetries/{cabang}`.
 *
 * Tiap putaran pendek: baca state, resync akun yang jatuh tempo dengan `only`, catat hasil. Backoff
 * & jatah ada di `retryOutcome`/`dueRetries` (sync-core.js) — di situlah satu-satunya tempat
 * aturannya ditulis.
 *
 * `only` membuat resync tidak menyentuh `syncIssues`: ikon peringatan tetap milik run penuh per jam.
 * Yang diperbaiki retry adalah DATANYA (earning/spend akun itu), bukan alertnya.
 */
export async function runSyncRetries(db, { metaToken = "" } = {}) {
  const now = new Date();
  const state = (await get(ref(db, SYNC_RETRY_PATH))).val() || {};

  // Tiap cabang -> cara meresync satu-dua akunnya. Bentuk hasilnya sama persis
  // ({ errors: [{id,...}] }), jadi hilirnya tidak pernah tahu ini Meta atau GAM.
  const runners = {
    gamAccounts: (ids) => syncAccounts(db, ids),
    adsenseAccounts: (ids) => syncAdsenseAccounts(db, ids),
    metaAccounts: (ids) => (metaToken ? syncAdAccounts(db, metaToken, ids) : null),
  };

  for (const [branch, run] of Object.entries(runners)) {
    const due = dueRetries(state[branch], now);
    if (!due.length) continue;
    const res = await run(due.map((d) => d.id));
    if (!res) continue; // token Meta belum di-set; benihnya menunggu run berikutnya
    const failed = new Set((res.errors || []).map((error) => error.id));
    const failMsg = new Map((res.errors || []).map((error) => [error.id, error.message]));
    const updates = {};
    for (const { id, entry } of due) {
      updates[`${branch}/${id}`] = retryOutcome(entry, failed.has(id), failMsg.get(id), now);
    }
    await update(ref(db, SYNC_RETRY_PATH), updates);
    const recovered = due.length - failed.size;
    console.log(
      `[syncRetry] ${branch}: ${due.length} dicoba, ${recovered} pulih, ${failed.size} masih gagal.`,
    );
  }
}
