/**
 * Chat yang menyapa bot, jadi calon penerima — sisi yang MENCATAT.
 *
 * Sebelum berkas ini, satu-satunya cara menambah penerima non-tim adalah: orangnya kirim /start,
 * lalu seseorang membuka terminal, menjalankan `npm run telegram:chat-id`, menyalin angka 10 digit
 * dari layar, dan mengetiknya kembali di form Tambah Penerima. Empat langkah yang tiga di antaranya
 * bukan pekerjaan siapa pun, dan yang ketiga — menyalin angka dengan tangan — adalah satu-satunya
 * langkah di seluruh dashboard yang salah ketiknya TIDAK MENGELUH di mana pun: chat id yang meleset
 * satu digit tersimpan rapi, lolos `groupComplaint`, dan gagal diam-diam tiap kali dikirimi.
 *
 * Yang menggantikannya: siklus di `sync-telegram-inbox.mjs` membaca pesan masuk bot dan menuliskan
 * tiap chat ke `dashboard/telegramInbox/chats`. Halaman Notification Center menampilkannya sebagai
 * baris di tab "Calon Penerima", dan admin menekan Aktifkan.
 *
 * ═══ TERDETEKSI BUKAN BERARTI AKTIF ═══
 *
 * @rabbitroi_bot adalah bot PUBLIK — siapa pun yang tahu namanya bisa mengirim /start, dan tidak
 * ada satu pun cara memberi tahu Telegram bahwa hanya orang tertentu yang boleh. Jadi yang
 * dikerjakan berkas ini berhenti tepat sebelum garis itu: ia mencatat, ia TIDAK mendaftarkan.
 *
 * Baris yang lahir di sini tidak menerima apa pun sampai ada admin yang menekan Aktifkan — dan
 * itulah satu klik yang tidak boleh dihapus. `contactAlertScope` mengembalikan `{all: true}` untuk
 * kontak yang `pic`-nya kosong, jadi penerima yang lahir aktif tanpa PIC menerima peringatan ROI
 * SELURUH armada: nama subdomain, spend, dan earning setiap orang. Kebocoran yang bentuknya persis
 * seperti fitur yang bekerja.
 */

export const TELEGRAM_INBOX_PATH = "dashboard/telegramInbox";

/**
 * Kunci RTDB sebuah chat. Berawalan huruf, dan itu bukan gaya — alasan yang sama persis dengan
 * `c57` di antrean gating: RTDB mengembalikan node berkunci ANGKA sebagai array berlubang, dan
 * sebuah id Telegram 10 digit sebagai kunci akan menghasilkan array sepanjang 1,8 miliar entri
 * di sisi klien.
 *
 * Minus jadi `n` karena kunci RTDB tidak boleh memuat karakter yang menyerupai path; `-` sendiri
 * sah, tapi kunci push RTDB juga diawali `-` dan dua bentuk yang tak bisa dibedakan di node yang
 * sama adalah kebingungan yang tidak perlu dilahirkan.
 */
export function inboxChatKey(chatId) {
  return `c${chatIdOf(chatId).replace("-", "n")}`;
}

export function chatIdOf(value) {
  return String(value ?? "").trim();
}

/**
 * Chat id yang SUDAH jadi penerima — dari kedua sumber sekaligus, `users` dan `notificationGroups`.
 *
 * CERMINAN `registeredChatIds` di src/lib/telegramInbox.js. Yang di sana memutuskan baris mana yang
 * tampil di tab "Calon Penerima" di layar; yang di sini memutuskan sapaan mana yang dijawab bot
 * dengan "menunggu admin" dan mana dengan "sudah terdaftar". Beda sedikit, bot menyuruh orang yang
 * sudah menerima notifikasi tiap hari untuk menunggu diaktifkan.
 *
 * Baris yang DIARSIPKAN tetap dihitung terdaftar, dan itu disengaja. Mengarsipkan penerima adalah
 * tindakan sengaja; menghitungnya sebagai "belum terdaftar" berarti daftar calon penerima
 * menawarkan kembali orang yang baru saja dikeluarkan, tiap kali ia menyapa botnya lagi.
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

/**
 * Baris baru untuk sebuah chat yang belum pernah terlihat.
 *
 * Yang TIDAK disimpan: isi pesannya. Yang dicatat cuma identitas chat — sepola dengan
 * `sanitizeDetail` di jejak aktivitas, dengan alasan yang sama: `dashboard` terbaca setiap akun
 * yang login, dan sebuah orang yang mengetik nomor rekeningnya ke bot tidak sedang menerbitkannya
 * ke seluruh tim.
 *
 * `username` kosong bukan kelalaian — sebagian akun Telegram memang tidak punya, dan grup tidak
 * pernah punya. Yang dipakai mencocokkan tetap `chatId`; username cuma supaya baris di layar bisa
 * dikenali orang yang harus memutuskan mengaktifkannya.
 */
export function inboxEntry(chat, at) {
  return {
    chatId: chatIdOf(chat?.id),
    type: String(chat?.type || ""),
    title: String(chat?.title || ""),
    username: String(chat?.username || ""),
    firstSeenAt: at,
    lastSeenAt: at,
  };
}

/**
 * Yang diperbarui untuk chat yang SUDAH punya baris.
 *
 * `firstSeenAt` dan `dismissedAt` tidak ikut, dan itu seluruh gunanya fungsi ini berdiri sendiri:
 * sapaan berikutnya dari chat yang sudah diabaikan admin tidak boleh mengembalikannya ke daftar
 * calon penerima. Tombol Abaikan yang bisa dibatalkan oleh orang yang diabaikan bukan tombol.
 */
export function inboxSeenUpdate(chat, at) {
  return {
    type: String(chat?.type || ""),
    title: String(chat?.title || ""),
    username: String(chat?.username || ""),
    lastSeenAt: at,
  };
}

/**
 * Offset berikutnya untuk `getUpdates` — `update_id` tertinggi + 1.
 *
 * Ini yang membuat siklus semenit tidak membaca ulang pesan yang sama sampai tua: Telegram
 * MENGHAPUS update yang sudah dikonfirmasi lewat offset. Konsekuensinya diketahui dan diterima —
 * `getUpdates` telanjang (yang dipakai `tools/telegram-chat-id.mjs` dulu) tidak akan melihat apa
 * pun lagi begitu siklus ini jalan, jadi tool itu sekarang membaca node RTDB ini.
 *
 * Tanpa offset, kegagalannya justru lebih buruk dan tidak terlihat: Telegram menyimpan update ~24
 * jam dan mengembalikan yang TERTUA lebih dulu, maksimal 100 per panggilan. Satu orang yang
 * mengirim 100 pesan ke bot akan menutupi /start semua orang lain sampai antreannya kedaluwarsa
 * sendiri.
 */
export function nextOffset(updates, current = 0) {
  let offset = Number(current) || 0;
  for (const update of updates || []) {
    const id = Number(update?.update_id);
    if (Number.isFinite(id) && id + 1 > offset) offset = id + 1;
  }
  return offset;
}

/**
 * Balasan bot saat sebuah chat pertama kali tercatat.
 *
 * Sekali per chat, dan hanya saat barisnya BARU DIBUAT — bukan tiap pesan. Sebelum ini, orang yang
 * mengirim /start mendapat kesenyapan total dan harus menebak apakah botnya bekerja; yang paling
 * sering terjadi berikutnya adalah ia mengirim /start lagi tiga kali.
 *
 * Dua bunyi, dan bedanya penting: chat yang SUDAH jadi penerima (didaftarkan tangan sebelum fitur
 * ini ada) tidak boleh disuruh menunggu diaktifkan admin — ia sudah menerima notifikasi tiap hari,
 * dan kalimat itu akan terbaca sebagai fitur yang rusak.
 */
export function greetingMessage(chat, { registered = false } = {}) {
  const name = escapeHtml(chat?.title || chat?.username || "");
  const hello = name ? `Halo, <b>${name}</b>.` : "Halo.";

  if (registered) {
    return `👋 ${hello}\n\nChat ini sudah terdaftar sebagai penerima notifikasi RabbitROI. Untuk mengubah notifikasi yang kamu terima, hubungi admin.`;
  }
  return (
    `👋 ${hello}\n\nChat ini sudah tercatat di RabbitROI dan menunggu diaktifkan admin. ` +
    "Kamu belum menerima notifikasi apa pun sampai itu dilakukan."
  );
}

// Nama Telegram diketik orang dan boleh memuat apa saja. Satu `<` di dalamnya membuat Telegram
// menolak SELURUH pesan dengan 400 — alasan yang sama persis dengan `escapeHtml` di
// notifications-core.js, dan di sini sumbernya bahkan lebih liar: nama profil orang asing.
function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
