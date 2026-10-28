import { getDatabase } from "firebase-admin/database";
import { defineSecret } from "firebase-functions/params";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { dashboardUrl } from "./dashboard-url.js";
import { rowsOf, topicRecipients } from "./notifications-core.js";
import { noticeUpdate, reminderMessage, reminderRows, remindersToSend } from "./reminders-core.js";
import { zonedDateKey } from "./sync-core.js";
import { deliverToChats } from "./telegram.mjs";

/**
 * Pengingat jatuh tempo ke Telegram.
 *
 * Badge di topbar hanya menyala untuk orang yang sedang membuka dashboard; tagihan yang jatuh
 * tempo hari Sabtu tidak menunggu siapa pun membuka tab. Fungsi ini membaca daftar yang sama
 * persis dengan badge (`remindersToSend` → `dueReminders`, cerminan src/lib/reminders.js) dan
 * mengirimkannya sekali sehari ke chat yang terdaftar.
 *
 * Admin SDK, bukan client SDK seperti scheduled-sync.js: yang di sana memakai modul CLI yang sama
 * dengan `npm run sync:*` sehingga harus login sebagai SYNC_USER, sedangkan di sini tidak ada
 * modul CLI yang dibagi — jadi satu kredensial (dan dua secret) yang tidak perlu dilewati saja.
 *
 * Token bot adalah secret Cloud Functions; chat tujuan TIDAK — ia dipilih di halaman Notification
 * Center dan tinggal di RTDB. Siapa yang menerima pengingat berubah karena orang masuk atau keluar
 * tim, dan itu tidak boleh butuh deploy.
 *
 * Tujuannya BUKAN LAGI satu kotak berisi semua chat id (`settings/telegram/chatIds`, yang berarti
 * setiap orang di daftar itu menerima segalanya) melainkan penerima topik "reminders" —
 * `topicRecipients` di notifications-core.js, cerminan src/lib/notifications.js. Orang yang tidak
 * mau menerima pengingat tagihan mematikan saklarnya sendiri tanpa ikut kehilangan peringatan ROI.
 */

const REGION = "asia-southeast1";
const TELEGRAM_BOT_TOKEN = defineSecret("TELEGRAM_BOT_TOKEN");

// Dibaca saat deploy, sama seperti jadwal sync. Pagi hari kerja WIB: pengingat yang tiba tengah
// malam sudah tertimbun notifikasi lain waktu orang bangun.
const SCHEDULE = process.env.REMINDER_SCHEDULE || "0 8 * * *";
const TIMEZONE = process.env.SYNC_TIMEZONE || "Asia/Jakarta";
// Diturunkan dari project, sama seperti APP_URL di index.js — id project yang ditulis tangan di
// dua file adalah dua tempat yang harus ikut berubah kalau project-nya pindah. Kosong kalau
// runtime-nya tidak menyebutkan project (mis. tes lokal): pesannya tetap terkirim, tanpa tautan.
const APP_URL = dashboardUrl() ? `${dashboardUrl()}/reminders` : "";

export const scheduledReminders = onSchedule(
  {
    schedule: SCHEDULE,
    timeZone: TIMEZONE,
    region: REGION,
    timeoutSeconds: 120,
    maxInstances: 1,
    concurrency: 1,
    // Tidak diulang otomatis. Penanda `reminderNotices` mencegah kiriman ganda, tapi run yang
    // gagal karena token salah tidak akan berhasil di percobaan kedua — dan yang berikutnya
    // tinggal besok pagi.
    retryCount: 0,
    secrets: [TELEGRAM_BOT_TOKEN],
  },
  async () => {
    const token = TELEGRAM_BOT_TOKEN.value();
    if (!token) {
      console.error("[reminders] TELEGRAM_BOT_TOKEN belum di-set — kiriman dilewati.");
      return;
    }

    const db = getDatabase();
    const [remindersSnap, usersSnap, groupsSnap, settingsSnap, noticesSnap] = await Promise.all([
      db.ref("reminders").get(),
      db.ref("users").get(),
      db.ref("notificationGroups").get(),
      db.ref("settings/notifications").get(),
      db.ref("dashboard/reminderNotices").get(),
    ]);

    const recipients = topicRecipients("reminders", {
      users: rowsOf(usersSnap.val()),
      groups: rowsOf(groupsSnap.val()),
      settings: settingsSnap.val(),
    });
    if (recipients.length === 0) {
      console.warn(
        '[reminders] belum ada penerima topik "Pengingat jatuh tempo" — pilih orang atau grup ' +
          "di halaman Notification Center (cara mendapatkan chat id: cd functions && " +
          "npm run telegram:chat-id).",
      );
      return;
    }

    const today = zonedDateKey(new Date(), TIMEZONE);
    const notices = noticesSnap.val() || {};
    const rows = reminderRows(remindersSnap.val());
    const pending = remindersToSend(rows, notices, today);

    if (pending.length === 0) {
      // Penanda basi tetap disapu meski tidak ada yang dikirim — kalau tidak, node ini hanya
      // menyusut di hari yang kebetulan ada kiriman.
      const sweep = noticeUpdate([], notices, today);
      if (Object.keys(sweep).length) await db.ref("dashboard/reminderNotices").update(sweep);
      return;
    }

    const text = reminderMessage(pending, today, APP_URL);
    const delivered = await deliverToChats(
      token,
      recipients.map((entry) => entry.chatId),
      text,
      { label: "reminders" },
    );

    // Penanda ditulis hanya kalau ada yang benar-benar menerima. Kalau seluruh chat gagal, daftar
    // ini harus tetap "belum dikabarkan" supaya run berikutnya mencobanya lagi.
    if (delivered > 0) {
      await db.ref("dashboard/reminderNotices").update(noticeUpdate(pending, notices, today));
    }

    console.log(
      `[reminders] ${pending.length} pengingat ke ${delivered}/${recipients.length} chat (${today}).`,
    );
  },
);
