import { hasRole, isAdmin } from "../config/access.js";

/**
 * Siapa menerima notifikasi apa — aturannya, satu tempat.
 *
 * Sebelum berkas ini, tujuan seluruh notifikasi adalah SATU kotak teks di `/settings?tab=telegram`
 * berisi beberapa chat id dipisah koma. Konsekuensinya: tiap orang di daftar itu menerima segalanya
 * — Aca menerima peringatan ROI subdomain yang bukan miliknya, Nur menerima pengingat tagihan yang
 * bukan urusannya — dan satu-satunya cara berhenti menerima adalah meminta admin menghapus id-nya,
 * yang juga menghentikan yang memang ingin dia terima. Notifikasi yang tidak bisa disaring akan
 * dibisukan orang, dan yang ikut terbisukan adalah yang benar-benar penting.
 *
 * Cerminan `functions/notifications-core.js` — dua tempat, satu aturan, persis seperti
 * `campaignCommandEntry` dan `dueReminders`. Yang di sana yang benar-benar mengirim; yang di sini
 * menghitung ulang untuk kolom "Penerima" di halaman Notification Center. BEDA SEDIKIT, halaman
 * menjanjikan orang yang tidak pernah dikirimi — dan itu kebohongan yang tidak akan pernah
 * ketahuan sampai ada yang bertanya kenapa dia tidak menerima apa-apa.
 *
 * ═══ DUA SAKLAR, BUKAN TIGA ═══
 *
 * Tiap topik punya satu saklar global (`settings/notifications/{topik}/enabled`) dan satu daftar
 * penerima. Yang menentukan seseorang menerima atau tidak HANYA `users/{id}/notificationTopics` —
 * saklar yang sama persis, dipegang admin maupun orangnya sendiri. Dua kolom terpisah ("ditugaskan
 * admin" vs "diminta sendiri") akan menuntut aturan siapa-menang, dan tiap aturan begitu punya sisi
 * yang membuat orang menekan saklar lalu tidak terjadi apa-apa. Satu saklar, dua tangan; yang
 * menekan terakhir tercatat di Activity Logs.
 */

/**
 * Topik yang bisa dilanggan. Menambah satu berarti: satu baris di sini, satu baris yang sama di
 * `functions/notifications-core.js`, dan satu pengirim yang benar-benar memanggilnya.
 *
 * TIDAK ada topik yang dibatasi role di daftar ini, dan itu keputusan: ketiganya sudah terbaca
 * seluruh akun yang login di dashboard (badge reminder, tabel ROI, ikon isu sync di topbar), jadi
 * "hanya admin yang boleh berlangganan" akan jadi pagar yang menjaga sesuatu yang pintunya memang
 * terbuka — dan aturan database tidak bisa menegakkannya per topik (izin tulis RTDB menurun: sebuah
 * `.write` di bawah tidak bisa menarik kembali `.write` yang sudah diberikan di atasnya).
 */
export const NOTIFICATION_TOPICS = [
  {
    key: "reminders",
    label: "Pengingat jatuh tempo",
    description:
      "Tagihan dan pengingat yang jatuh tempo hari ini atau 2 hari lagi. Sekali sehari, 08:00 WIB.",
  },
  {
    key: "roiAlerts",
    label: "Peringatan ROI",
    description:
      "Subdomain yang melewati ambang di Settings — belanja tanpa earning, ROI anjlok, saldo Meta " +
      "menipis. Sekali sehari per subdomain, dari sync tiap jam.",
  },
  {
    key: "syncIssues",
    label: "Kegagalan sync",
    description:
      "Laporan GAM/AdSense/Meta atau situs plugin yang gagal diambil — baris yang datanya kosong " +
      "di dashboard. Sekali sehari per kegagalan.",
  },
];

export const TOPIC_KEYS = NOTIFICATION_TOPICS.map((topic) => topic.key);

/**
 * Setelan satu topik, dinormalkan.
 *
 * `enabled` bawaannya NYALA — kebalikan dari `DEFAULT_ALERTS.enabled`, dan bedanya penting. Ambang
 * peringatan ROI bawaannya mati karena menyalakannya berarti mengirim pesan yang belum pernah
 * dilihat siapa pun. Di sini saklarnya bukan penentu apa-apa: yang menentukan ada tidaknya kiriman
 * adalah daftar penerima, dan daftar yang kosong tidak mengirim ke mana pun. Bawaan mati cuma akan
 * membuat pengingat yang selama ini jalan berhenti diam-diam pada hari fitur ini di-deploy.
 */
export function topicSettings(settings, topic) {
  const raw = settings?.[topic] || {};
  return {
    enabled: raw.enabled !== false,
    roles: parseRoleList(raw.roles),
  };
}

// Role tujuan siaran satu topik, disimpan sebagai teks gabungan koma — bentuk yang sama dengan
// `users.role` dan `roles/{uid}`, supaya yang membacanya tidak perlu tahu ini daftar yang berbeda.
export function parseRoleList(value) {
  return String(value || "")
    .toLowerCase()
    .split(",")
    .map((role) => role.trim())
    .filter(Boolean);
}

export function joinRoleList(roles) {
  return (roles || []).filter(Boolean).join(",");
}

/**
 * Daftar chat yang menerima satu topik: orang (dari `users`) dan grup (dari `notificationGroups`).
 *
 * Tiga hal yang menentukan seseorang ikut, dan urutannya menjawab pertanyaan yang berbeda:
 *
 *   1. `notificationTopics[topik] === true`  -> ikut, titik. Ini saklar di halaman Notification
 *      Center, ditekan admin atau orangnya sendiri.
 *   2. `notificationTopics[topik] === false` -> TIDAK ikut, walau role-nya disiarkan. Inilah yang
 *      membuat siaran per role bisa dipakai tanpa menyandera orang: "semua keuangan" tetap berarti
 *      semua keuangan, dan yang satu orang itu tetap bisa membisukan dirinya sendiri.
 *   3. belum pernah disentuh (undefined) -> ikut kalau role-nya ada di siaran topik itu.
 *
 * Yang TIDAK punya `telegramChatId` dilewati diam-diam, bukan dijadikan keluhan: belum pernah
 * mengisi chat id bukan kegagalan, dan halaman Notification Center sudah menyebutkannya di kolomnya
 * sendiri — di sisi pengirim ia cuma akan jadi baris log yang tidak bisa diperbaiki siapa pun dari
 * sana. Baris yang sudah diarsipkan (`deletedAt`) juga dilewati: mengarsipkan orang mencabut
 * aksesnya ke dashboard, dan notifikasi yang tetap mengalir ke mantan anggota tim adalah bocoran
 * yang tidak terlihat di layar mana pun.
 *
 * Hasilnya di-dedupe per chat id — satu orang yang kebetulan memakai chat id yang sama dengan
 * sebuah grup, atau ikut lewat role SEKALIGUS lewat saklarnya sendiri, tetap menerima satu pesan.
 */
export function topicRecipients(topic, { users = [], groups = [], settings = {} } = {}) {
  const config = topicSettings(settings, topic);
  if (!config.enabled) return [];

  const byChat = new Map();
  const add = (entry) => {
    if (!entry.chatId || byChat.has(entry.chatId)) return;
    byChat.set(entry.chatId, entry);
  };

  for (const user of users || []) {
    if (!user || user.deletedAt) continue;
    const chatId = chatIdOf(user.telegramChatId);
    if (!chatId) continue;

    const choice = user.notificationTopics?.[topic];
    if (choice === false) continue;
    const byRole = config.roles.some((role) => hasRole(user.role, role));
    if (choice !== true && !byRole) continue;

    add({
      chatId,
      kind: "user",
      id: user.id,
      label: user.name || user.username || user.email || chatId,
      via: choice === true ? "saklar" : "role",
      scope: userAlertScope(user),
    });
  }

  for (const group of groups || []) {
    if (!group || group.deletedAt || group.enabled === false) continue;
    if (group.topics?.[topic] !== true) continue;
    const chatId = chatIdOf(group.chatId);
    if (!chatId) continue;

    add({
      chatId,
      kind: "contact",
      id: group.id,
      label: group.label || group.name || chatId,
      via: "saklar",
      scope: contactAlertScope(group),
    });
  }

  return [...byChat.values()];
}

/**
 * ═══ LINGKUP PERINGATAN ROI: TIAP PIC MENERIMA SUBDOMAINNYA SENDIRI ═══
 *
 * Peringatan ROI berbeda dari dua topik lain, dan bedanya bukan teknis melainkan soal siapa yang
 * bisa berbuat apa. Pengingat jatuh tempo dan kegagalan sync berlaku untuk seluruh usaha — semua
 * penerimanya membaca daftar yang sama. Peringatan ROI berlaku untuk SATU subdomain, dan yang bisa
 * menindaklanjutinya cuma orang yang memegangnya: mematikan campaign, membetulkan kode iklan,
 * menaikkan budget. Dikirim utuh ke semua orang, tiap advertiser membaca dua puluh baris untuk
 * menemukan satu barisnya — dan pesan yang harus disaring sendiri tiap pagi adalah pesan yang
 * berhenti dibuka.
 *
 * Jadi: admin (dan superadmin) menerima seluruh armada, sisanya menerima subdomain yang PIC-nya
 * dirinya sendiri. Baris ROI membawa `pic`-nya sendiri (ditulis sync dari `subDomains.pic`), dan
 * itulah yang dicocokkan.
 *
 * Yang TIDAK punya identitas PIC sama sekali — chat non-tim, grup — menerima semuanya kecuali
 * `pic`-nya diisi di formnya. Sebuah grup memang tidak mewakili satu orang; menyaringnya jadi
 * kosong akan membuat chat tim berhenti menerima apa pun tanpa ada yang memintanya.
 */
export function userAlertScope(user) {
  // Admin lewat `isAdmin` (bukan daftar role yang disalin ke sini) supaya ia ikut berubah bersama
  // seluruh dashboard kalau daftar itu bergeser — cerminan `ADMIN_ROLES` cuma boleh ada satu.
  if (isAdmin(user?.role)) return { all: true };

  // Nama, username, DAN email: `subDomains.pic` diketik orang dan bentuknya berbeda-beda menurut
  // umur datanya — persis alasan `assignedSubDomains` mencocokkan longgar di kedua sisi.
  const picKeys = [user?.name, user?.username, user?.email].map(picKey).filter(Boolean);
  return { all: false, picKeys, label: user?.name || user?.username || user?.email || "" };
}

export function contactAlertScope(contact) {
  const pic = String(contact?.pic || "").trim();
  return pic ? { all: false, picKeys: [picKey(pic)], label: pic } : { all: true };
}

/**
 * Baris peringatan yang boleh dibaca satu penerima.
 *
 * Lingkup yang TIDAK diketahui dibaca sebagai "semua", bukan "tidak satu pun": penerima yang
 * lingkupnya belum terhitung (bentuk baris baru, data lama) lebih baik menerima kelebihan daripada
 * diam-diam berhenti menerima peringatan yang justru dibuat untuk dibaca cepat.
 *
 * Yang lingkupnya ada tapi KOSONG beda lagi dan memang tidak menerima apa-apa: itu orang yang bukan
 * admin dan tidak memegang subdomain mana pun. Halaman sunting menyebutkannya, supaya "saya tidak
 * pernah dikirimi apa-apa" punya jawabannya di layar.
 */
export function scopedAlerts(alerts, scope) {
  if (!scope || scope.all !== false) return alerts || [];

  const keys = new Set((scope.picKeys || []).filter(Boolean));
  if (keys.size === 0) return [];

  return (alerts || []).filter((alert) => keys.has(picKey(alert?.pic)));
}

function picKey(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

// Grup dan channel Telegram ber-id NEGATIF, chat pribadi positif — itu jaminan Telegram, bukan
// tebakan. Dipakai untuk lencana Jenis di daftar penerima — grup dan orang berdiri di daftar yang
// sama, jadi tidak ada kolom "jenis" yang harus diisi orang (dan diisi keliru).
export function isGroupChat(chatId) {
  return chatIdOf(chatId).startsWith("-");
}

// Chat id apa adanya, dirapikan. Angka (RTDB menyimpan "123456789" sebagai number kalau pernah
// ditulis sebagai angka) ikut diterima — Telegram menerima keduanya, dan sebuah id yang hilang
// karena tersimpan dengan tipe yang berbeda adalah kegagalan yang tidak meninggalkan jejak apa pun.
export function chatIdOf(value) {
  return String(value ?? "").trim();
}

/**
 * Saklar satu topik untuk satu orang, siap ditulis ke `users/{id}/notificationTopics`.
 *
 * Yang dikembalikan node UTUH, bukan satu field: `set` menggantikan seluruh isinya, jadi topik yang
 * sudah tidak ada di `TOPIC_KEYS` (dihapus dari registry) ikut hilang alih-alih menetap selamanya
 * sebagai saklar yang tidak dibaca siapa pun. `false` DISIMPAN, tidak dibuang — ia bukan "belum
 * memilih", melainkan "jangan kirimi saya", dan keduanya berbeda begitu siaran per role menyala.
 */
export function topicChoiceUpdate(current, topic, value) {
  const next = {};
  for (const key of TOPIC_KEYS) {
    const choice = key === topic ? value : current?.[key];
    if (choice === true || choice === false) next[key] = choice;
  }
  return next;
}

// Bentuk baris grup untuk `notificationGroups`. Chat id disimpan sebagai teks: id grup Telegram
// negatif dan panjang (-1002223334445), dan yang tersimpan sebagai number kehilangan bentuk yang
// diketik orang saat ia mencocokkannya kembali dengan Telegram.
export function groupEntry({ label, chatId, topics, pic }) {
  return {
    label: String(label || "").trim(),
    chatId: chatIdOf(chatId),
    topics: Object.fromEntries(TOPIC_KEYS.map((key) => [key, topics?.[key] === true])),
    // Kosong = seluruh armada. Disimpan sebagai teks (nama PIC apa adanya) dan bukan id user:
    // yang dicocokkan adalah `pic` di baris ROI, yang juga teks — sebuah id di sini akan menuntut
    // pencarian balik ke `users` di sisi Cloud Function untuk menjawab pertanyaan yang sama.
    pic: String(pic || "").trim(),
    enabled: true,
  };
}

/**
 * Keluhan yang membuat sebuah baris chat tidak layak disimpan, atau "" kalau tidak ada.
 *
 * Chat id diperiksa bentuknya, bukan cuma kosong/tidak: id Telegram selalu bilangan bulat — negatif
 * untuk grup dan channel, positif untuk chat pribadi, dan KEDUANYA sah di sini (tidak semua yang
 * perlu dikabari punya baris di Team). Sebuah "@namagrup" yang diketik orang akan tersimpan rapi,
 * tidak mengeluh di mana pun, dan gagal diam-diam tiap kali dikirimi — kegagalannya cuma ada di log
 * Cloud Function yang tidak dibuka siapa pun.
 */
export function groupComplaint(entry, siblings = []) {
  if (!entry.label) return "Nama belum diisi.";
  if (!entry.chatId) return "Chat ID belum diisi.";
  if (!/^-?\d+$/.test(entry.chatId)) {
    return "Chat ID harus berupa angka (grup diawali tanda minus, chat pribadi tidak).";
  }
  if (siblings.some((row) => chatIdOf(row.chatId) === entry.chatId)) {
    return "Chat ID ini sudah terdaftar.";
  }
  return "";
}
