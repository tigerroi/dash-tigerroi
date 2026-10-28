import { asStore } from "./store.mjs";
import { chatsFromUpdates, getTelegramUpdates, sendTelegramMessage } from "./telegram.mjs";
import {
  greetingMessage,
  inboxChatKey,
  inboxEntry,
  inboxSeenUpdate,
  nextOffset,
  registeredChatIds,
  TELEGRAM_INBOX_PATH,
} from "./telegram-inbox-core.js";

/**
 * Satu siklus: baca pesan masuk bot, catat tiap chat yang menyapanya.
 *
 * Dijalankan cron di `server/` (bukan Cloud Function) karena yang ditentukan di sini adalah berapa
 * lama seseorang menunggu setelah menekan Start. `scheduledSync` jalan sejam sekali dan
 * `scheduledReminders` sehari sekali; keduanya berarti orang yang baru saja menyapa bot menatap
 * layar yang tidak terjadi apa-apa. Server sudah memegang RTDB dan sudah punya jadwal semenit.
 *
 * KOSONG ADALAH KEADAAN NORMALNYA. Hampir tiap siklus tidak menemukan satu update pun, dan saat itu
 * biayanya satu bacaan RTDB plus satu panggilan Telegram — sengaja dibuat seringan itu, karena yang
 * dijaga jadwal ini justru kejadian yang jarang.
 */
export async function syncTelegramInbox(dbOrStore, token, { at = new Date().toISOString() } = {}) {
  // Tanpa token, siklus ini DIAM — bukan melempar. Server yang belum diberi TELEGRAM_BOT_TOKEN
  // tetap harus menjalankan gating dan saklar campaign; dua fitur yang tidak berhubungan tidak
  // boleh saling menjatuhkan (alasan yang sama dengan META_ACCESS_TOKEN yang kosong).
  if (!token) return { skipped: true, seen: 0, added: 0, greeted: 0 };

  const store = asStore(dbOrStore);
  const offset = Number(await store.read(`${TELEGRAM_INBOX_PATH}/offset`)) || 0;
  const updates = await getTelegramUpdates(token, { offset });
  if (updates.length === 0) return { skipped: false, seen: 0, added: 0, greeted: 0 };

  const chats = chatsFromUpdates(updates);
  const known = (await store.read(`${TELEGRAM_INBOX_PATH}/chats`)) || {};

  const writes = {};
  const fresh = [];
  for (const chat of chats) {
    const key = inboxChatKey(chat.id);
    if (known[key]) {
      // Field demi field, bukan seluruh baris: `firstSeenAt` dan `dismissedAt` harus selamat.
      // Menimpa barisnya utuh berarti sapaan berikutnya dari chat yang sudah diabaikan admin
      // mengembalikannya ke daftar calon penerima — tombol Abaikan yang bisa dibatalkan oleh orang
      // yang diabaikan bukan tombol.
      for (const [field, value] of Object.entries(inboxSeenUpdate(chat, at))) {
        writes[`${key}/${field}`] = value;
      }
    } else {
      writes[key] = inboxEntry(chat, at);
      fresh.push(chat);
    }
  }

  /**
   * BARIS DULU, OFFSET SESUDAHNYA, SAPAAN PALING AKHIR — dan urutannya menentukan apa yang
   * tertinggal dari siklus yang mati di tengah.
   *
   * Offset yang maju duluan berarti update-nya sudah dihapus Telegram sementara barisnya belum
   * ditulis: chat itu hilang selamanya, dan orangnya menunggu aktivasi yang tidak akan pernah ada
   * di daftar siapa pun. Dengan urutan ini, yang tertinggal cuma offset yang belum maju — siklus
   * berikutnya membaca update yang sama, menemukan barisnya sudah ada, dan tidak menulis apa-apa.
   *
   * Sapaan paling akhir karena ia satu-satunya yang tidak boleh diulang. Dikirim sebelum barisnya
   * tersimpan, tulisan yang gagal berarti tiap siklus menyapa orang yang sama lagi.
   */
  if (Object.keys(writes).length > 0) await store.update(`${TELEGRAM_INBOX_PATH}/chats`, writes);
  await store.update(TELEGRAM_INBOX_PATH, { offset: nextOffset(updates, offset) });

  let greeted = 0;
  if (fresh.length > 0) {
    // Dibaca hanya kalau ada chat yang benar-benar baru, dan hanya untuk memilih BUNYI sapaannya —
    // bukan untuk memutuskan siapa menerima apa. Chat yang sudah didaftarkan tangan sebelum fitur
    // ini ada tidak boleh disuruh menunggu diaktifkan admin.
    const registered = registeredChatIds({
      users: Object.values((await store.read("users")) || {}),
      groups: Object.values((await store.read("notificationGroups")) || {}),
    });

    for (const chat of fresh) {
      try {
        await sendTelegramMessage(
          token,
          chat.id,
          greetingMessage(chat, { registered: registered.has(String(chat.id)) }),
        );
        greeted += 1;
      } catch (error) {
        // Sapaan yang gagal TIDAK diulang: barisnya sudah tercatat, dan itu bagian yang berarti.
        // Yang hilang cuma basa-basi; yang tidak boleh hilang adalah chat-nya sendiri.
        console.error(`[telegram-inbox] sapaan ke ${chat.id} gagal: ${error.message}`);
      }
    }
  }

  return { skipped: false, seen: chats.length, added: fresh.length, greeted };
}
