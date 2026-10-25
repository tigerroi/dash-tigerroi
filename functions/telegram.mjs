/**
 * Klien Telegram Bot API seadanya — satu endpoint, sendMessage.
 *
 * Tanpa SDK: fetch bawaan Node 22 sudah cukup, dan satu dependensi lagi di folder functions berarti
 * satu hal lagi yang harus ikut ter-deploy untuk satu panggilan HTTP.
 */

const API = "https://api.telegram.org";

/**
 * Kirim satu pesan. Melempar dengan `description` dari Telegram apa adanya — "chat not found" dan
 * "bot was blocked by the user" adalah dua kegagalan yang perbaikannya berbeda, dan keduanya
 * terlihat sama kalau yang dicatat cuma "gagal kirim".
 */
export async function sendTelegramMessage(token, chatId, text, options = {}) {
  const response = await fetch(`${API}/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      // Pengingat bukan berita: pratinjau tautan dashboard hanya menambah tinggi pesan.
      disable_web_page_preview: true,
      ...options,
    }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok === false) {
    throw new Error(
      `Telegram ${response.status}: ${body?.description || response.statusText || "gagal"}`,
    );
  }
  return body.result;
}

/**
 * Kirim satu pesan yang sama ke beberapa chat, dan kembalikan berapa yang benar-benar menerima.
 *
 * Satu chat yang memblokir bot tidak boleh menghalangi chat lain menerima daftar yang sama — itu
 * yang ditulis tiga kali di tiga pengirim yang berbeda sebelum berkas ini memilikinya. Yang
 * dikembalikan jumlah yang berhasil, karena itulah yang menentukan penanda harian ditulis atau
 * tidak: kalau SELURUH chat gagal, daftarnya harus tetap "belum dikabarkan" supaya run berikutnya
 * mencobanya lagi.
 */
export async function deliverToChats(token, chatIds, text, { label = "telegram" } = {}) {
  let delivered = 0;
  for (const chatId of chatIds || []) {
    try {
      await sendTelegramMessage(token, chatId, text);
      delivered += 1;
    } catch (error) {
      console.error(`[${label}] chat ${chatId} gagal: ${error.message}`);
    }
  }
  return delivered;
}

/**
 * Pesan masuk yang dilihat bot. Id sebuah chat baru terbit setelah ada yang menyapa botnya —
 * Telegram tidak punya cara lain untuk mengetahuinya.
 *
 * `offset` MENGKONSUMSI: Telegram menghapus tiap update yang `update_id`-nya di bawahnya, dan itu
 * memang yang diinginkan siklus `syncTelegramInbox` — tanpanya, satu chat yang mengirim 100 pesan
 * menutupi /start semua orang lain sampai antreannya kedaluwarsa sendiri (Telegram mengembalikan
 * yang TERTUA lebih dulu, maksimal 100). Dipanggil tanpa `offset`, fungsi ini tetap membaca tanpa
 * menghapus apa pun.
 *
 * `allowed_updates` dipersempit ke dua jenis yang benar-benar membawa chat baru: `message` (orang
 * mengirim /start) dan `my_chat_member` (bot dimasukkan ke grup). Sisanya — tombol inline, edit
 * pesan, poll — cuma menghabiskan jatah 100 per panggilan.
 */
export async function getTelegramUpdates(token, { offset, limit = 100 } = {}) {
  const params = new URLSearchParams({
    limit: String(limit),
    allowed_updates: JSON.stringify(["message", "my_chat_member"]),
  });
  if (Number.isFinite(Number(offset)) && Number(offset) > 0) params.set("offset", String(offset));

  const response = await fetch(`${API}/bot${token}/getUpdates?${params}`);
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok === false) {
    throw new Error(`Telegram ${response.status}: ${body?.description || response.statusText}`);
  }
  return body.result || [];
}

/**
 * {id, type, title, username} tiap chat di sebuah batch update, tanpa duplikat.
 *
 * Bentuk update Telegram bercabang (message, channel_post, my_chat_member) tapi semuanya membawa
 * `chat` di dalamnya — jadi yang dicari adalah nilai pertama yang punya `chat`, bukan daftar nama
 * cabang yang harus ikut bertambah tiap kali Telegram menambahkan jenis update baru.
 *
 * `username` ikut karena baris di layar harus bisa dikenali orang yang memutuskan mengaktifkannya:
 * nama profil Telegram boleh sama persis untuk dua orang, `@username` tidak.
 */
export function chatsFromUpdates(updates) {
  const seen = new Map();
  for (const update of updates || []) {
    const chat = Object.values(update || {}).find((value) => value?.chat)?.chat;
    if (!chat?.id || seen.has(String(chat.id))) continue;
    const name = chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(" ");
    seen.set(String(chat.id), {
      id: String(chat.id),
      type: chat.type || "",
      title: name || chat.username || "(tanpa nama)",
      username: chat.username || "",
    });
  }
  return [...seen.values()];
}
