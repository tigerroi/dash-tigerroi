// Chat yang sudah menyapa bot, dan (opsional) kirim satu pesan uji.
//
// SEJAK tab "Calon Penerima" ada di /notifications, tool ini bukan lagi jalur utama: chat yang
// menyapa bot muncul sendiri di halaman itu, lengkap dengan tombol Aktifkan, dan tidak ada satu
// angka pun yang perlu disalin dengan tangan. Yang tersisa di sini adalah pembacaan dari terminal
// — berguna saat halamannya belum bisa dibuka atau saat memastikan sebuah chat benar-benar tercatat.
//
//   cd functions && npm run telegram:chat-id
//   npm run telegram:chat-id -- --test 123456789   # kirim pesan uji ke satu chat
//
// Sumbernya RTDB (`dashboard/telegramInbox/chats`), BUKAN lagi getUpdates telanjang — siklus di
// server mengkonsumsi update (offset maju, Telegram menghapus yang sudah lewat), jadi pembacaan
// langsung akan hampir selalu kosong selama server itu jalan. getUpdates tetap dicoba sebagai
// cadangan untuk keadaan sebaliknya: server belum di-deploy, jadi belum ada yang mencatat apa pun.
//
// Butuh TELEGRAM_BOT_TOKEN + SYNC_USER_EMAIL/PASSWORD di functions/.env.sync.

import { connect } from "../db.mjs";
import { clientStore } from "../store.mjs";
import { registeredChatIds, TELEGRAM_INBOX_PATH } from "../telegram-inbox-core.js";
import { chatsFromUpdates, getTelegramUpdates, sendTelegramMessage } from "../telegram.mjs";

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("Set TELEGRAM_BOT_TOKEN dulu (functions/.env.sync), token dari @BotFather.");
  process.exit(1);
}

const testFlag = process.argv.indexOf("--test");
if (testFlag !== -1) {
  const chatId = process.argv[testFlag + 1];
  if (!chatId) {
    console.error("Pakai: npm run telegram:chat-id -- --test <chatId>");
    process.exit(1);
  }
  await sendTelegramMessage(token, chatId, "🔔 <b>Tes RabbitROI</b> — pengingat akan dikirim ke sini.");
  console.log(`Pesan uji terkirim ke ${chatId}.`);
  process.exit(0);
}

const store = clientStore(await connect());
const [inbox, users, groups] = await Promise.all([
  store.read(`${TELEGRAM_INBOX_PATH}/chats`),
  store.read("users"),
  store.read("notificationGroups"),
]);

const registered = registeredChatIds({
  users: Object.values(users || {}),
  groups: Object.values(groups || {}),
});

const rows = Object.values(inbox || {}).map((row) => ({
  ...row,
  status: registered.has(String(row.chatId))
    ? "penerima"
    : row.dismissedAt
      ? "diabaikan"
      : "menunggu",
}));

// Cadangan: server belum jalan, jadi belum ada yang mencatat. Dibaca TANPA offset, jadi ia tidak
// mengkonsumsi apa pun dan tidak mengganggu siklus server kalau ternyata ia sedang jalan.
if (rows.length === 0) {
  const chats = chatsFromUpdates(await getTelegramUpdates(token).catch(() => []));
  for (const chat of chats) {
    rows.push({
      chatId: chat.id,
      title: chat.title,
      username: chat.username,
      status: registered.has(chat.id) ? "penerima" : "belum tercatat",
    });
  }
}

if (rows.length === 0) {
  // Bukan error: bot yang belum pernah disapa memang tidak punya chat. Yang salah kalau pesan ini
  // muncul adalah langkah pertamanya, bukan tokennya.
  console.log(
    "Belum ada chat yang menyapa bot ini.\n" +
      "  Chat pribadi : buka botnya di Telegram, kirim /start\n" +
      "  Grup         : masukkan bot ke grup, kirim satu pesan di sana\n" +
      "Lalu jalankan perintah ini lagi.",
  );
  process.exit(0);
}

console.log("Chat yang pernah menyapa bot:\n");
for (const row of rows.sort((a, b) => a.status.localeCompare(b.status))) {
  const handle = row.username ? `@${row.username}` : "-";
  console.log(`  ${row.chatId}\t${row.status}\t${handle}\t${row.title || "(tanpa nama)"}`);
}
console.log(
  '\nYang berstatus "menunggu" diaktifkan di /notifications — tab "Calon Penerima", tombol Aktifkan.',
);
process.exit(0);
