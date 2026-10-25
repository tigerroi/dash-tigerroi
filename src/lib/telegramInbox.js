import { groupEntry, TOPIC_KEYS } from "./notifications.js";

/**
 * Chat yang menyapa bot, jadi calon penerima — sisi yang MENAMPILKAN.
 *
 * Yang digantikannya adalah satu-satunya langkah manual yang tersisa di Notification Center:
 * orangnya kirim /start, seseorang membuka terminal untuk menjalankan `npm run telegram:chat-id`,
 * menyalin angka 10 digit dari layar, dan mengetiknya kembali di form Tambah Penerima. Yang ketiga
 * itu satu-satunya langkah di dashboard ini yang salah ketiknya tidak mengeluh di mana pun — chat
 * id yang meleset satu digit lolos `groupComplaint` (bentuknya tetap angka), tersimpan rapi, dan
 * gagal diam-diam tiap kali dikirimi.
 *
 * Yang mencatat adalah `functions/sync-telegram-inbox.mjs` lewat cron di server; berkas ini cuma
 * membaca `dashboard/telegramInbox/chats` dan menjawab satu pertanyaan: baris mana yang layak
 * ditawarkan sebagai penerima baru.
 *
 * ═══ TERDETEKSI BUKAN BERARTI AKTIF ═══
 *
 * @rabbitroi_bot bot PUBLIK, dan tidak ada cara memberi tahu Telegram bahwa cuma orang tertentu
 * yang boleh menyapanya. Jadi baris di sini berhenti sebagai TAWARAN: ia tidak menerima apa pun
 * sampai admin menekan Aktifkan. Satu klik itu tidak boleh dihapus — `contactAlertScope`
 * mengembalikan `{all: true}` untuk kontak tanpa `pic`, jadi penerima yang lahir aktif sendiri
 * menerima peringatan ROI SELURUH armada: nama subdomain, spend, dan earning tiap orang.
 */

// CERMINAN `inboxChatKey` di functions/telegram-inbox-core.js. Berawalan huruf karena RTDB
// mengembalikan node berkunci angka sebagai array berlubang — alasan yang sama dengan `c57` di
// antrean gating. Beda sedikit, tombol Abaikan menulis ke kunci yang tidak dibaca pencatat mana pun.
export function inboxChatKey(chatId) {
  return `c${chatIdOf(chatId).replace("-", "n")}`;
}

export function chatIdOf(value) {
  return String(value ?? "").trim();
}

/**
 * Chat id yang SUDAH jadi penerima, dari kedua sumber sekaligus.
 *
 * CERMINAN `registeredChatIds` di functions/telegram-inbox-core.js. Yang di sana memilih bunyi
 * sapaan bot; yang di sini memutuskan baris mana yang hilang dari daftar tawaran.
 *
 * Baris yang DIARSIPKAN tetap dihitung terdaftar. Mengarsipkan penerima adalah tindakan sengaja,
 * dan menghitungnya sebagai "belum terdaftar" berarti daftar ini menawarkan kembali orang yang baru
 * saja dikeluarkan — tiap kali ia menyapa botnya lagi.
 */
export function registeredChatIds({ users = [], groups = [] } = {}) {
  const ids = new Set();
  for (const row of users || []) {
    const id = chatIdOf(row?.telegramChatId);
    if (id) ids.add(id);
  }
  for (const row of groups || []) {
    const id = chatIdOf(row?.chatId);
    if (id) ids.add(id);
  }
  return ids;
}

// Node RTDB {kunci: baris} jadi array berisi kuncinya — sepola dengan `rowsOf` di
// functions/notifications-core.js. Kuncinya ikut karena itulah alamat yang ditulis tombol Abaikan.
export function inboxRows(value) {
  return Object.entries(value || {}).map(([key, row]) => ({ ...row, key }));
}

/**
 * Baris yang layak ditawarkan: sudah menyapa bot, belum jadi penerima, belum diabaikan.
 *
 * Yang TIDAK disimpan sebagai status di baris adalah "sudah jadi penerima" — ia DIHITUNG tiap kali,
 * dari daftar penerima yang sedang berlaku. Sebuah kolom status di sini akan benar pada detik ia
 * ditulis dan basi sesudahnya: penerima yang dihapus meninggalkan baris inbox yang selamanya
 * mengaku "sudah terdaftar", dan tidak ada satu pun layar yang bisa membetulkannya.
 *
 * `dismissedAt` beda dan memang disimpan: ia keputusan orang, bukan turunan dari keadaan lain.
 *
 * Terbaru di atas — yang baru saja menekan Start adalah yang sedang ditunggu seseorang.
 */
export function pendingChats(inbox, { users = [], groups = [] } = {}) {
  const registered = registeredChatIds({ users, groups });

  return inboxRows(inbox)
    .filter((row) => !row.dismissedAt && !registered.has(chatIdOf(row.chatId)))
    .sort((a, b) => String(b.lastSeenAt || "").localeCompare(String(a.lastSeenAt || "")));
}

/**
 * Baris penerima dari sebuah chat yang terdeteksi — bentuk yang ditulis tombol Aktifkan.
 *
 * Lewat `groupEntry`, tidak dirakit sendiri: bentuk baris `notificationGroups` sudah punya satu
 * tempat tinggal, dan salinan kedua di sini akan lolos aturan database tapi kehilangan field yang
 * ditambahkan belakangan di sana.
 *
 * KETIGA topik menyala dan `pic` kosong (= seluruh armada) — itu yang diminta, dan itu sebabnya
 * aktivasi tetap satu tindakan sengaja alih-alih terjadi sendiri. Keduanya bisa dipersempit
 * sesudahnya di halaman Ubah Penerima.
 */
export function detectedContactEntry(chat) {
  return groupEntry({
    label: chat?.title || chat?.username || chatIdOf(chat?.chatId),
    chatId: chatIdOf(chat?.chatId),
    topics: Object.fromEntries(TOPIC_KEYS.map((key) => [key, true])),
    pic: "",
  });
}

// Yang ditulis tombol Abaikan. Baris tetap berdiri — dihapus, ia lahir lagi utuh pada sapaan
// berikutnya, dan daftar tawaran akan menawarkan chat yang sama berulang kali selamanya.
export function dismissUpdate(actor, at = new Date().toISOString()) {
  return { dismissedAt: at, dismissedBy: String(actor || "system") };
}
