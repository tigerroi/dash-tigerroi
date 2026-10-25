import { defineSecret } from "firebase-functions/params";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { dashboardUrl } from "./dashboard-url.js";
import { connect } from "./db.mjs";
import { runFullSync, runSyncRetries } from "./sync-run.mjs";

/**
 * Sync terjadwal — jalur otomatis yang tidak butuh backend sendiri.
 *
 * DRS memblokir grant `allUsers`, dan itulah yang membuat callable di index.js tidak bisa dipanggil
 * dari browser. Fungsi terjadwal tidak lewat jalan itu: yang memanggilnya Cloud Scheduler dengan
 * token service account milik project ini sendiri, principal internal yang tidak disentuh DRS.
 *
 * Logikanya tidak diduplikasi. Fungsi ini memanggil modul yang sama persis dengan yang dijalankan
 * CLI (`sync-gam.mjs`, `sync-meta.mjs`, `sync-subdomains.mjs`) lewat client SDK
 * yang login sebagai SYNC_USER — jadi hasil sync otomatis dan sync manual tidak akan pernah berbeda
 * karena jalurnya berbeda.
 *
 * Hasil tiap run ditulis ke `dashboard/syncStatus` (hitung mundur di topbar) dan
 * `dashboard/syncRuns` (tabel log di halaman Settings). Tanpa itu tidak ada satu pun tempat di mana
 * sync yang gagal jam tiga pagi bisa terlihat.
 */

const REGION = "asia-southeast1";
const META_TOKEN = defineSecret("META_ACCESS_TOKEN");
const SYNC_USER_EMAIL = defineSecret("SYNC_USER_EMAIL");
const SYNC_USER_PASSWORD = defineSecret("SYNC_USER_PASSWORD");
// Dipakai tahap "Peringatan ROI". Secret yang SAMA dengan scheduled-reminders.mjs — satu bot,
// dua pengirim; token bot yang berbeda per fitur berarti dua bot yang harus di-invite ke tiap
// grup, untuk dua pesan yang dibaca orang yang sama.
const TELEGRAM_BOT_TOKEN = defineSecret("TELEGRAM_BOT_TOKEN");

// Dibaca saat deploy (Firebase memuat modul ini untuk menemukan fungsinya), bukan saat jalan —
// mengubah jadwalnya berarti deploy ulang.
//
// CRON JAM DINDING, BUKAN "every 60 minutes". Bentuk interval App Engine menghitung 60 menit dari
// run sebelumnya SELESAI, dan Cloud Scheduler memulai hitungan itu dari nol tiap kali job-nya
// diperbarui — yaitu tiap deploy. Jadi tiap deploy membuang satu siklus: run yang ditunggu jam
// 15:55 baru jalan jam 16:50, dan topbar (yang menghitung sendiri dari run terakhir, karena tidak
// ada yang memberitahunya job-nya di-reset) menulis "Jadwal terlewat" selama sisa jam itu. Terbaca
// di log: tiap lubang 68-98 menit di `dashboard/syncRuns` berdampingan dengan deploy. Ia juga
// melar — 60 menit dari selesai berarti jam mulainya mundur sepanjang durasi run tiap jam.
//
// "5 * * * *" jatuh di menit ke-5 tiap jam menurut TIMEZONE, tidak melar, dan deploy tidak
// menggesernya. `nextRunAfter` di sync-core.js membaca bentuk ini maupun bentuk interval.
const SCHEDULE = process.env.SYNC_SCHEDULE || "5 * * * *";
const TIMEZONE = process.env.SYNC_TIMEZONE || "Asia/Jakarta";

// Alamat dashboard untuk tautan di pesan Telegram (lihat `syncMessageUrls` di sync-run.mjs).
// Dari `dashboardUrl` (domain per project), BUKAN dari env `APP_URL` — nama itu di index.js sudah
// berarti alamat halaman /google-api-configs.
const DASHBOARD_URL = dashboardUrl();

// Satu koneksi client SDK per instance. `connect()` memanggil initializeApp(), yang hanya boleh
// jalan sekali per proses — instance yang masih hangat akan memanggil fungsi ini lagi.
//
// Promise yang gagal dibuang, bukan disimpan: menyimpannya berarti satu kegagalan login (secret
// salah, jaringan putus sesaat) menempel di instance itu dan membuat setiap run berikutnya gagal
// dengan error lama yang sama, meski sebabnya sudah diperbaiki.
let dbPromise;
function syncDb() {
  if (!dbPromise) {
    dbPromise = connect().catch((error) => {
      dbPromise = undefined;
      throw error;
    });
  }
  return dbPromise;
}

// Cukup untuk mengenali nilainya, tidak cukup untuk membocorkannya — dan spasi/newline di ujung
// ikut terlihat sebagai selisih panjang, yang justru penyebab paling sering waktu secret di-set
// lewat pipe alih-alih prompt.
function maskEmail(value) {
  const text = String(value ?? "");
  if (!text) return "(kosong)";
  const [name, domain] = text.split("@");
  const head = name.slice(0, 1);
  return domain ? `${head}${"*".repeat(Math.max(1, name.length - 1))}@${domain}` : `${head}***`;
}

export const scheduledSync = onSchedule(
  {
    schedule: SCHEDULE,
    timeZone: TIMEZONE,
    region: REGION,
    // Laporan GAM itu job asinkron yang di-poll sampai 60 detik per network, jadi run penuh bisa
    // memakan menit. 9 menit adalah batas maksimum yang diizinkan.
    timeoutSeconds: 540,
    // 512MiB sudah terlampaui (23 Sep 2026: "Memory limit of 512 MiB exceeded with 523 MiB used"
    // di tahap ROI) — instance dibunuh tanpa log run dan `running: true` menggantung di topbar.
    // ponytail: batas dinaikkan, sumber lonjakan di tahap ROI belum ditemukan (lokal 178-648 MB).
    memory: "1GiB",
    // Satu run pada satu waktu. Butuh keduanya: `maxInstances` saja tidak cukup karena Cloud
    // Functions gen2 default-nya melayani 80 request bersamaan DALAM satu instance — run yang
    // lebih lambat dari jadwalnya akan bertemu run berikutnya di instance yang sama, dua proses
    // menembakkan kuota API yang sama untuk hasil yang sama.
    maxInstances: 1,
    concurrency: 1,
    // Tidak diulang otomatis. Sync ini idempoten tapi mahal di kuota, dan run berikutnya tinggal
    // satu jam lagi — mengulang kegagalan lebih berisiko daripada melewatkannya.
    retryCount: 0,
    secrets: [META_TOKEN, SYNC_USER_EMAIL, SYNC_USER_PASSWORD, TELEGRAM_BOT_TOKEN],
  },
  async () => {
    // Dua langkah pertama ini terjadi sebelum ada apa pun yang bisa dicatat: kalau login atau
    // tulisan pertama gagal, tidak ada baris log dan tidak ada status — panel di dashboard akan
    // terus menulis "belum berjalan" tanpa satu pun petunjuk kenapa. Jadi keduanya diberi pesan
    // yang menyebut apa yang harus diperiksa, lalu dilempar ulang supaya run-nya tercatat gagal
    // di Cloud Logging.
    let db;
    try {
      db = await syncDb();
    } catch (error) {
      // Email-nya ikut disebut (disamarkan): `auth/invalid-credential` berarti sama saja untuk
      // email yang salah dan password yang salah, dan tanpa tahu nilai mana yang sampai ke sini
      // tidak ada cara membedakan "secret-nya keliru" dari "secret-nya terpotong newline".
      console.error(
        `[scheduledSync] login SYNC_USER gagal sebagai ${maskEmail(process.env.SYNC_USER_EMAIL)}: ` +
          `${error.message} — periksa secret SYNC_USER_EMAIL & SYNC_USER_PASSWORD, lalu deploy ulang ` +
          "supaya versi secret yang baru terpakai.",
      );
      throw error;
    }

    // Badan run-nya di sync-run.mjs — dipakai juga cron server kontrol (instansi 2), jadi kedua
    // penjadwal menulis status dan log dengan aturan yang sama persis.
    await runFullSync(db, {
      metaToken: META_TOKEN.value(),
      telegramToken: TELEGRAM_BOT_TOKEN.value(),
      schedule: SCHEDULE,
      timeZone: TIMEZONE,
      appUrl: DASHBOARD_URL,
    });
  },
);

/**
 * Retry akun yang gagal — jalan tiap menit. Loopnya di sini dan bukan `sleep()` di dalam
 * scheduledSync karena jeda yang bertambah (1..5 menit) × maks 5 kali = 15 menit, jauh melewati
 * batas 9 menit Cloud Functions. Badannya `runSyncRetries` di sync-run.mjs.
 */
export const scheduledSyncRetry = onSchedule(
  {
    schedule: "* * * * *",
    timeZone: TIMEZONE,
    region: REGION,
    // Paling banyak beberapa akun per cabang, tanpa polling laporan panjang: cukup pendek.
    timeoutSeconds: 120,
    memory: "256MiB",
    maxInstances: 1,
    concurrency: 1,
    retryCount: 0,
    secrets: [META_TOKEN, SYNC_USER_EMAIL, SYNC_USER_PASSWORD],
  },
  async () => {
    await runSyncRetries(await syncDb(), { metaToken: META_TOKEN.value() });
  },
);

/* --- scheduledCampaignCommands & scheduledGating: DIPINDAH, bukan dihapus ------------------------
 *
 * Keduanya sekarang dijalankan `server/` (Bun + Elysia) — lihat server/README.md. Alasannya bukan
 * karena fungsi terjadwal bermasalah (DRS tidak pernah memblokirnya), melainkan karena keduanya
 * memaksa tunggu: browser tidak bisa memanggil Cloud Function di bawah DRS, jadi tombol Gate dan
 * saklar campaign hanya bisa menulis niat ke antrean RTDB lalu menunggu siklus dua menitan. Server
 * itu memegang API key-nya dan menjalankan keduanya saat tombolnya ditekan.
 *
 * DEFINISINYA DIHAPUS DARI SINI, DAN ITU DISENGAJA. Dibiarkan berdiri sementara fungsinya sudah
 * dihapus dari Firebase, `firebase deploy --only functions` berikutnya akan MENGHIDUPKANNYA KEMBALI
 * — dua penguras antrean yang sama berjalan berdampingan, masing-masing memanggil Meta dan Keitaro
 * untuk jawaban yang sama, tanpa ada yang menyadarinya sampai tagihan API-nya aneh.
 *
 * Logikanya sendiri tidak ikut hilang: ia tinggal di `campaign-commands.mjs` dan `sync-gating.mjs`,
 * yang dipanggil server maupun CLI. Tahap "Saklar campaign" di `scheduledSync` di atas juga masih
 * ada, dan itu sengaja — ia jaring pengaman sejam sekali kalau server-nya mati.
 */
