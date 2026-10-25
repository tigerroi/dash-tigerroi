import { rtdbKey, zonedDateKey } from "./sync-core.js";

/**
 * Siapa menerima notifikasi apa — sisi yang benar-benar mengirim.
 *
 * CERMINAN `src/lib/notifications.js`, persis seperti `dueReminders` dan `campaignCommandEntry`:
 * frontend dan folder ini adalah dua paket yang tidak bisa saling impor. Yang di sana menghitung
 * kolom "Penerima" di halaman Notification Center; yang di sini memutuskan pesan itu berangkat ke
 * mana. Beda sedikit, halaman menampilkan daftar penerima yang tidak pernah dikirimi apa pun.
 *
 * Yang menggantikan `settings/telegram/chatIds` (satu kotak teks berisi semua id, semua orang
 * menerima segalanya). Tiga sumber penerima sekarang, dan semuanya dibaca di sini:
 *
 *   users/{id}.telegramChatId + .notificationTopics  -> orang, saklar per topik
 *   notificationGroups/{id}                           -> grup Telegram dan chat lain
 *   settings/notifications/{topik}.roles              -> siaran per role
 */

// Cerminan NOTIFICATION_TOPICS di src/lib/notifications.js — kuncinya harus sama persis, karena
// kunci itulah yang tersimpan di `users/{id}/notificationTopics`. Label dipakai di pesan dan log.
export const NOTIFICATION_TOPICS = [
  { key: "reminders", label: "Pengingat jatuh tempo" },
  { key: "roiAlerts", label: "Peringatan ROI" },
  { key: "syncIssues", label: "Kegagalan sync" },
];

export const TOPIC_KEYS = NOTIFICATION_TOPICS.map((topic) => topic.key);

// Node RTDB {id: baris} jadi array berisi id-nya — sepola dengan `reminderRows`. Dipakai untuk
// `users` maupun `notificationGroups`, jadi penyaringan `deletedAt` tinggal di `topicRecipients`
// (di sana ia bagian dari aturan, bukan bentuk data).
export function rowsOf(value) {
  return Object.entries(value || {}).map(([id, row]) => ({ ...row, id }));
}

// Bawaannya NYALA. Lihat catatan panjangnya di src/lib/notifications.js: yang menentukan ada
// tidaknya kiriman adalah daftar penerima, dan bawaan mati cuma akan membuat pengingat yang selama
// ini jalan berhenti diam-diam pada hari fitur ini di-deploy.
export function topicSettings(settings, topic) {
  const raw = settings?.[topic] || {};
  return { enabled: raw.enabled !== false, roles: parseRoleList(raw.roles) };
}

export function parseRoleList(value) {
  return String(value || "")
    .toLowerCase()
    .split(",")
    .map((role) => role.trim())
    .filter(Boolean);
}

// Cerminan `hasRole` di src/config/access.js. Disalin dan bukan diimpor, alasan yang sama dengan
// seluruh berkas ini — dan bentuknya sengaja dibiarkan sesederhana ini: role tersimpan sebagai teks
// gabungan koma ("user,keuangan"), jadi `includes` telanjang akan menjawab benar untuk "superadmin"
// ketika yang dicari "admin".
function hasRole(role, target) {
  return parseRoleList(role).includes(target);
}

// Cerminan `ADMIN_ROLES` di src/config/access.js. Dipakai untuk satu hal saja: menentukan siapa yang
// menerima peringatan ROI SELURUH armada, bukan subdomainnya sendiri (lihat `userAlertScope`).
function isAdminRole(role) {
  return hasRole(role, "admin") || hasRole(role, "superadmin");
}

/**
 * Daftar chat yang menerima satu topik. Aturannya dijelaskan lengkap di `src/lib/notifications.js`;
 * ringkasnya: saklar orang (true/false) mengalahkan siaran per role, yang tanpa chat id dilewati,
 * yang diarsipkan dilewati, dan hasilnya di-dedupe per chat id.
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
    if (choice !== true && !config.roles.some((role) => hasRole(user.role, role))) continue;

    add({
      chatId,
      kind: "user",
      label: user.name || user.email || chatId,
      scope: userAlertScope(user),
    });
  }

  for (const group of groups || []) {
    if (!group || group.deletedAt || group.enabled === false) continue;
    if (group.topics?.[topic] !== true) continue;
    add({
      chatId: chatIdOf(group.chatId),
      kind: "contact",
      label: group.label || group.chatId,
      scope: contactAlertScope(group),
    });
  }

  return [...byChat.values()];
}

export function chatIdOf(value) {
  return String(value ?? "").trim();
}

/**
 * ═══ LINGKUP PERINGATAN ROI: TIAP PIC MENERIMA SUBDOMAINNYA SENDIRI ═══
 *
 * CERMINAN `userAlertScope`/`contactAlertScope`/`scopedAlerts` di src/lib/notifications.js —
 * penjelasan lengkapnya di sana. Ringkasnya: admin menerima seluruh armada, sisanya menerima baris
 * yang `pic`-nya dirinya sendiri, dan chat non-tim menerima semuanya kecuali `pic`-nya diisi.
 *
 * Berlaku HANYA untuk topik `roiAlerts`, dan itu bukan kelalaian: pengingat jatuh tempo dan
 * kegagalan sync berlaku untuk seluruh usaha — semua penerimanya memang membaca daftar yang sama.
 * Peringatan ROI berlaku untuk satu subdomain, dan yang bisa menindaklanjutinya cuma yang
 * memegangnya.
 */
export function userAlertScope(user) {
  if (isAdminRole(user?.role)) return { all: true };

  const picKeys = [user?.name, user?.username, user?.email].map(picKey).filter(Boolean);
  return { all: false, picKeys, label: user?.name || user?.username || user?.email || "" };
}

export function contactAlertScope(contact) {
  const pic = String(contact?.pic || "").trim();
  return pic ? { all: false, picKeys: [picKey(pic)], label: pic } : { all: true };
}

// Lingkup yang TIDAK diketahui dibaca sebagai "semua", bukan "tidak satu pun" — penerima yang
// lingkupnya belum terhitung lebih baik menerima kelebihan daripada diam-diam berhenti menerima.
// Yang lingkupnya ada tapi kosong memang tidak menerima apa pun: itu orang yang bukan admin dan
// tidak memegang subdomain mana pun.
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

// --- Kegagalan sync sebagai notifikasi ----------------------------------------------------------
//
// `dashboard/syncIssues` sudah ada dan sudah dibaca ikon peringatan di topbar — tapi ikon hanya
// menyala untuk orang yang sedang membuka dashboard. Laporan GAM yang gagal pada run pukul 02:00
// berarti earning belasan subdomain kosong sampai ada yang kebetulan membuka tab dan menyadari
// ikonnya. Topik ini yang membalik arahnya, memakai daftar isu yang sama persis — bukan daftar
// kedua yang bisa berbeda isinya dari yang dilihat orang di layar.

/**
 * Isu dari seluruh cabang `dashboard/syncIssues` jadi daftar datar.
 *
 * `id` adalah kunci penanda harian: cabang + target. Pesannya TIDAK ikut jadi kunci — satu network
 * yang gagal dengan tiga pesan error berbeda dalam sehari (timeout, lalu 500, lalu timeout lagi)
 * adalah satu kegagalan yang sama bagi orang yang harus memperbaikinya, dan tiga notifikasi
 * untuknya adalah cara tercepat membuat chat ini dibisukan.
 */
export function syncIssueAlerts(issues) {
  const alerts = [];
  for (const [branch, value] of Object.entries(issues || {})) {
    const label = value?.label || branch;
    for (const item of Object.values(value?.items || {})) {
      if (!item) continue;
      const target = String(item.target || "-");
      alerts.push({
        // target adalah nama network/site (hostname berisi titik) — id ini jadi kunci
        // `dashboard/syncIssueNotices`, jadi harus aman untuk RTDB.
        id: `${branch}__${rtdbKey(target)}`,
        branch,
        label,
        source: item.source || label,
        target,
        message: item.message || "",
        impact: item.impact || "",
      });
    }
  }
  return alerts.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * ═══ ASAL MASALAHNYA: SISI KITA, SISI MEREKA, ATAU BELUM BISA DIPASTIKAN ═══
 *
 * Yang membaca chat ini bukan yang menulis kodenya. "GAM POST /v1/networks/2094/reports:run -> 401:
 * Invalid Credentials" adalah kalimat yang benar dan sekaligus tidak menjawab satu-satunya
 * pertanyaan yang dibawa penerimanya: apakah saya harus melakukan sesuatu sekarang, atau ini akan
 * beres sendiri. Dua jawaban itu menuntut tindakan yang berlawanan — yang satu perlu orang membuka
 * halaman Google API dan login ulang, yang satu lagi justru paling baik dibiarkan.
 *
 * Tiga golongan, dan yang ketiga bukan basa-basi: menebak "ini sisi mereka" untuk pesan error yang
 * tidak dikenali membuat orang MENUNGGU sesuatu yang tidak akan pernah pulih sendiri. Sepola dengan
 * `earningKnown` — yang tidak diketahui disebut apa adanya, bukan dibulatkan ke tebakan terdekat.
 *
 * DICERMINKAN ke `src/lib/syncIssueCause.js`, sepola dengan `dueReminders` dan
 * `campaignCommandEntry` — dan itu berubah sejak panel isu sync di topbar ikut menggolongkan
 * isunya. Selama panel itu masih menampilkan pesan API apa adanya, salinan kedua adalah salinan
 * yang tidak akan pernah ikut diperbarui; sejak ia menampilkannya, yang tidak dicerminkan berarti
 * layar dan chat menyebut golongan berbeda untuk isu yang sama — dan yang dipercaya orang adalah
 * yang lebih menenangkan. Dijaga `src/lib/syncIssueCause.test.mjs`, yang membaca berkas ini.
 */
export const ISSUE_CAUSES = {
  action: {
    key: "action",
    heading: "PERLU DIPERIKSA ORANG",
    note:
      "Masalahnya di sisi kita — izin atau setelan akun. Dicoba ulang berapa kali pun hasilnya " +
      "sama sampai ada yang membetulkannya.",
  },
  provider: {
    key: "provider",
    heading: "GANGGUAN DI SISI PENYEDIA",
    note:
      "Server pihak sana yang sedang bermasalah, bukan setelan kita. Dicoba ulang otomatis " +
      "beberapa menit sekali, maks 5×.",
  },
  unknown: {
    key: "unknown",
    heading: "BELUM BISA DIPASTIKAN",
    note: "Pesan errornya tidak menyebut sebab yang dikenali — bagian ini perlu dilihat orang.",
  },
};

// Urutan kelompok di dalam pesan: yang menuntut tindakan lebih dulu. Penerima yang berhenti membaca
// di layar pertama harus sudah melewati bagian yang tidak akan pulih sendiri.
const CAUSE_ORDER = ["action", "provider", "unknown"];

// Maksimal baris per kelompok sebelum sisanya diringkas jadi "+N lainnya".
const MAX_PER_GROUP = 6;

/**
 * Pola → golongan + kalimat manusianya. SATU tabel untuk keduanya: golongan yang ditentukan di satu
 * tempat dan kalimatnya di tempat lain adalah dua daftar yang akan berbeda suatu hari, dan yang
 * berbeda adalah judul "gangguan sementara" di atas kalimat "perlu login ulang".
 *
 * Diperiksa berurutan, jadi yang lebih spesifik ditulis lebih dulu.
 */
const CAUSE_RULES = [
  {
    kind: "action",
    test: /belum di-?set|belum diisi|belum dihubungkan/i,
    say: "Setelan yang dibutuhkan belum diisi di dashboard.",
  },
  {
    kind: "action",
    test: /#190\b|invalid_grant|token .*(kedaluwarsa|expired|invalid)|expired token/i,
    say: "Token aksesnya sudah tidak berlaku — akun ini perlu dihubungkan ulang.",
  },
  {
    kind: "action",
    test: /invalid credentials|unauthorized|authentication|login required/i,
    say: "Akses kita ditolak — kemungkinan besar perlu Login ulang di halaman akunnya.",
  },
  {
    kind: "action",
    test: /#200\b|#100-33|ads_management|ads_read|insufficient|scope|permission|forbidden/i,
    say: "Izin yang dimiliki belum cukup untuk permintaan ini — perlu consent ulang.",
  },
  {
    kind: "provider",
    test: /rate limit|too many|#17\b|#613\b|throttl/i,
    say: "Permintaan kita sedang dibatasi karena terlalu sering — akan dicoba lagi sendiri.",
  },
  {
    kind: "provider",
    test: /timed out|time-?out|tidak menjawab|tidak bisa dihubungi|econnreset|etimedout|enotfound|econnrefused|fetch failed/i,
    say: "Tidak ada jawaban sampai batas waktu — server tujuan sedang lambat atau mati.",
  },
  {
    kind: "provider",
    test: /database connection|non-?json|bukan json|<html|<!doctype/i,
    say: "Yang dibalas bukan data, melainkan halaman error — biasanya hosting sedang bermasalah.",
  },
  {
    kind: "provider",
    test: /currently unavailable|service unavailable|bad gateway|internal (server )?error|backend error/i,
    say: "Servernya membalas error — gangguan di sisi mereka.",
  },
];

// Status HTTP dibaca dari BENTUK yang benar-benar ditulis pelempar errornya (`-> 503:` di gam.js dan
// adsense.js, `(HTTP 502)` di parseGraphBody), bukan dari angka tiga digit di mana pun dalam teks:
// `act_5031` dan `networks/4030` juga tiga digit, dan salah bacanya bukan pesan yang aneh melainkan
// pesan yang PERCAYA DIRI menyebut golongan yang salah.
function statusOf(text) {
  const match = /(?:->|HTTP|status)\s*:?\s*(\d{3})\b/i.exec(text);
  return match ? Number(match[1]) : 0;
}

/**
 * Golongan satu isu berikut kalimat manusianya: `{ key, heading, note, say }`.
 *
 * `say` boleh kosong — itu terjadi untuk yang golongannya tidak bisa dipastikan, dan di situ pesan
 * errornya sendiri yang jadi satu-satunya keterangan. Yang tidak boleh kosong adalah golongannya.
 */
export function issueCause(message) {
  const text = String(message || "");

  for (const rule of CAUSE_RULES) {
    if (rule.test.test(text)) return { ...ISSUE_CAUSES[rule.kind], say: rule.say };
  }

  const status = statusOf(text);
  if (status === 401 || status === 403) {
    return {
      ...ISSUE_CAUSES.action,
      say: `Ditolak dengan HTTP ${status} — izin akunnya bermasalah.`,
    };
  }
  if (status === 429) {
    return { ...ISSUE_CAUSES.provider, say: "Permintaan kita sedang dibatasi (HTTP 429)." };
  }
  if (status >= 500) {
    return {
      ...ISSUE_CAUSES.provider,
      say: `Servernya membalas HTTP ${status} — gangguan di sisi mereka.`,
    };
  }

  return { ...ISSUE_CAUSES.unknown, say: "" };
}

/**
 * ═══ YANG DIURUS SENDIRI OLEH RETRY TIDAK IKUT BERANGKAT KE TELEGRAM ═══
 *
 * Golongan `provider` sudah punya penanganannya sendiri dan penanganan itu BUKAN membaca chat:
 * `retrySeed`/`dueRetries` mengulang bagian yang gagal 1→5 menit sekali sampai `MAX_SYNC_RETRIES`,
 * dan sebagian besar 5xx/timeout/429 pulih di percobaan kedua — beberapa menit sebelum orangnya
 * sempat membuka ponsel. Yang tersisa dari notifikasi itu cuma satu hal: pesan merah untuk sesuatu
 * yang tidak boleh dikerjakan siapa pun, disusul pesan hijau yang mencabutnya. Notifikasi yang
 * terbukti tidak menuntut apa-apa adalah notifikasi yang berhenti dibaca — dan yang ikut berhenti
 * dibaca adalah `action` di sebelahnya, yang justru tidak akan pernah pulih sendiri.
 *
 * Yang DILEWATI di sini cuma jalan keluarnya ke Telegram. Isunya tetap ditulis utuh ke
 * `dashboard/syncIssues`, tetap menyalakan ikon peringatan di topbar, dan tetap punya barisnya
 * sendiri di panel — layar memang tempat yang benar untuk keadaan yang tidak menuntut tindakan.
 * Karena itu penyaringan ini TIDAK dicerminkan ke `src/lib/syncIssueCause.js`: yang harus sama di
 * kedua sisi adalah PENGGOLONGANNYA, sedangkan "golongan mana yang dikirimkan" adalah keputusan
 * milik pengirim.
 *
 * Konsekuensinya diketahui dan diterima: gangguan penyedia yang bertahan seharian — hosting yang
 * benar-benar tumbang, bukan yang berkedip — tidak mengabarkan dirinya ke chat mana pun, dan yang
 * mengetahuinya cuma yang membuka dashboard. Golongan `unknown` sengaja TETAP dikirim: menebaknya
 * sebagai sisi penyedia lalu membisukannya adalah persis cara sebuah kegagalan yang perlu orang
 * lewat tanpa pernah dilihat siapa pun.
 */
export function notifiableAlerts(alerts) {
  return (alerts || []).filter((alert) => issueCause(alert?.message).key !== "provider");
}

/**
 * Yang belum dikabarkan HARI INI — bentuk dan alasan yang sama persis dengan
 * `remindersToSend`/`noticeUpdate` (reminders-core.js) dan `alertsToSend`/`alertNoticeUpdate`
 * (alerts-core.js). Ditulis lagi di sini dan bukan diimpor dari salah satunya: ketiganya fitur yang
 * berdiri sendiri, dan satu impor silang di antaranya adalah tali yang akan ditarik orang
 * berikutnya sampai ketiganya jatuh bersama.
 *
 * Penandanya dibaca lewat `noticeDay`, jadi isu yang tadi pagi dikabarkan gagal lalu dikabarkan
 * PULIH tidak dikabarkan gagal lagi sore ini. Batasnya dua pesan per target per hari — satu gagal,
 * satu pulih — dan yang menahannya di sini: satu akun yang berkedip tiap jam akan mengirim dua
 * puluh empat pesan dalam sehari, dan chat yang begitu dibisukan orang bersama pengingat jatuh
 * tempo yang datang dari bot yang sama.
 */
export function noticesToSend(alerts, notices, today = zonedDateKey()) {
  const sent = notices || {};
  return (alerts || []).filter((alert) => noticeDay(sent[alert.id]) !== today);
}

/**
 * ═══ SYNC PULIH ═══
 *
 * Yang PERNAH dikabarkan gagal dan sekarang tidak ada lagi di daftar isu. Kabar gagal tanpa kabar
 * pulih membuat penerimanya menyimpan kecemasan yang tidak punya ujung: pesan terakhir yang ia baca
 * berbunyi "earning enam subdomain kosong", dan satu-satunya cara mengetahui itu sudah beres adalah
 * membuka dashboard — yaitu persis langkah yang notifikasi ini ada untuk menghapusnya.
 *
 * Hanya untuk yang penandanya `failed`: pemulihan atas sesuatu yang tidak pernah diberitahukan
 * bukan kabar baik, cuma pesan tambahan. Label dan targetnya dibaca dari PENANDA, bukan dari daftar
 * isu — barisnya sudah tidak ada di sana, itulah yang membuatnya pulih.
 */
export function recoveredNotices(alerts, notices, today = zonedDateKey()) {
  const live = new Set((alerts || []).map((alert) => alert.id));
  const out = [];

  for (const [id, entry] of Object.entries(notices || {})) {
    const mark = noticeMark(entry);
    if (mark.state !== "failed" || live.has(id)) continue;
    // Yang penandanya bukan hari ini sudah lewat masanya: kegagalan kemarin yang pulih semalam
    // tidak perlu dikabarkan pagi ini, dan penyapu di `noticeUpdate` yang membuang penandanya.
    if (mark.day !== today) continue;
    out.push({ id, label: mark.label, target: mark.target });
  }

  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Penanda baru untuk `dashboard/syncIssueNotices`, sekaligus penyapunya.
 *
 * Bentuk penandanya berubah dari teks tanggal jadi `{ day, state, label, target }` — `label` dan
 * `target` ikut disimpan karena baris yang PULIH tidak ada lagi di daftar isu, dan pesan pemulihan
 * yang cuma bisa menyebut `gamAccounts__Massequality` menyuruh orang menerjemahkan kunci database
 * sendiri. Penanda lama yang masih berbentuk teks tetap dibaca (`noticeMark`) sebagai `failed`.
 */
export function noticeUpdate(sentAlerts, recovered, notices, today = zonedDateKey()) {
  const update = {};
  const live = new Set();

  for (const alert of sentAlerts || []) {
    update[alert.id] = {
      day: today,
      state: "failed",
      label: alert.label || "",
      target: alert.target || "",
    };
    live.add(alert.id);
  }

  for (const item of recovered || []) {
    const previous = noticeMark(notices?.[item.id]);
    update[item.id] = {
      day: today,
      state: "recovered",
      label: item.label || previous.label,
      target: item.target || previous.target,
    };
    live.add(item.id);
  }

  // Penanda milik isu yang sudah PULIH dihapus: tanpa itu node ini tumbuh mengikuti jumlah akun
  // yang pernah gagal, dan akun yang gagal lagi dua minggu kemudian membawa penanda basi yang
  // membuatnya terlihat "sudah dikabarkan". Yang harinya hari ini dibiarkan berdiri — itulah yang
  // menahan pesan kedua untuk target yang sama.
  for (const [id, entry] of Object.entries(notices || {})) {
    if (!live.has(id) && noticeDay(entry) !== today) update[id] = null;
  }

  return update;
}

// Penanda lama berbentuk teks tanggal; yang baru objek. Dibaca lewat satu pintu supaya hari deploy
// tidak mengirim ulang seluruh kegagalan yang sudah dikabarkan pagi itu.
function noticeMark(entry) {
  if (typeof entry === "string") return { day: entry, state: "failed", label: "", target: "" };
  return {
    day: entry?.day || "",
    state: entry?.state === "recovered" ? "recovered" : "failed",
    label: entry?.label || "",
    target: entry?.target || "",
  };
}

function noticeDay(entry) {
  return noticeMark(entry).day;
}

/**
 * Pesan Telegram, parse_mode HTML — alasan yang sama dengan `reminderMessage` dan `alertMessage`:
 * nama akun dan pesan error datang dari API pihak ketiga, dan satu `<` di dalamnya (balasan HTML
 * dari hosting yang tumbang adalah kegagalan plugin yang paling sering) membuat Telegram menolak
 * seluruh pesan dengan 400.
 *
 * Dikelompokkan per ASAL MASALAH, bukan per cabang sync: yang membaca chat ini memutuskan satu hal
 * — perlu dikerjakan sekarang atau tidak — dan pengelompokan per cabang menuntutnya membaca dua
 * puluh pesan error satu per satu untuk sampai ke sana.
 */
export function syncIssueMessage(alerts, appUrl) {
  const groups = new Map();
  for (const alert of alerts) {
    const cause = issueCause(alert.message);
    if (!groups.has(cause.key)) groups.set(cause.key, { cause, items: [] });
    groups.get(cause.key).items.push({ alert, say: cause.say });
  }

  const lines = [`🛠 <b>Sync gagal</b> — ${alerts.length} bagian tidak terambil`];

  for (const key of CAUSE_ORDER) {
    const group = groups.get(key);
    if (!group) continue;

    lines.push("", `━━ <b>${group.cause.heading}</b> · ${group.items.length} ━━`);
    lines.push(`<i>${group.cause.note}</i>`, "");

    // Satu hosting yang menjatuhkan tiga puluh situs sekaligus melewati batas 4096 karakter, dan
    // Telegram menolak pesan sepanjang itu dengan 400 — yang hilang bukan baris yang kelebihan
    // melainkan seluruh notifikasinya.
    const shown = group.items.slice(0, MAX_PER_GROUP);
    for (const [index, { alert, say }] of shown.entries()) {
      // Baris kosong antar isu, bukan blok rapat: di layar ponsel empat baris tanpa jeda terbaca
      // sebagai satu paragraf, dan yang hilang justru batas antara satu akun dengan akun berikutnya.
      if (index > 0) lines.push("");
      lines.push(`• <b>${escapeHtml(alert.label)}</b> — ${escapeHtml(alert.target)}`);
      if (say) lines.push(`  ${escapeHtml(say)}`);
      // Akibatnya yang paling sering hilang dari sebuah pesan error, dan justru itu yang menentukan
      // apakah ini perlu dikerjakan sekarang atau nanti — "GAM 500" tidak memberi tahu siapa pun
      // bahwa earning enam subdomain hari ini kosong.
      if (alert.impact) lines.push(`  Akibat: ${escapeHtml(alert.impact)}`);
      // Pesan aslinya tetap dibawa, di baris terakhir: yang membaca chat ini kebanyakan bukan yang
      // menulis kodenya, tapi yang memperbaikinya nanti tetap butuh kalimat persisnya.
      if (alert.message) lines.push(`  Detail: <i>${escapeHtml(trim(alert.message))}</i>`);
    }

    const extra = group.items.length - MAX_PER_GROUP;
    if (extra > 0) lines.push(`• <i>+${extra} lainnya — lihat dashboard</i>`);
  }

  if (appUrl) lines.push("", `Lihat: ${escapeHtml(appUrl)}`);
  return lines.join("\n");
}

/**
 * Pesan pemulihan. Sengaja pendek dan tanpa detail teknis: yang perlu diketahui penerimanya cuma
 * bahwa ia tidak perlu mengejar apa pun lagi.
 *
 * Kalau masih ada kegagalan lain yang berdiri, itu DISEBUTKAN. Tanpa baris itu, pesan hijau yang
 * datang sejam setelah pesan merah terbaca sebagai "semuanya sudah beres" — dan yang paling mudah
 * luput justru kegagalan yang masih tersisa.
 */
export function syncRecoveryMessage(recovered, remaining = 0, appUrl) {
  const lines = [`✅ <b>Sync pulih</b> — ${recovered.length} bagian kembali normal`, ""];

  for (const item of recovered) {
    const label = item.label ? `<b>${escapeHtml(item.label)}</b> — ` : "";
    lines.push(`• ${label}${escapeHtml(item.target || item.id)}`);
  }

  lines.push("", "<i>Angka yang sempat kosong sudah terisi dari sync ini.</i>");
  if (remaining > 0) {
    lines.push(`⚠️ <i>Masih ada ${remaining} bagian yang gagal — lihat pesan sebelumnya.</i>`);
  }
  if (appUrl) lines.push("", `Lihat: ${escapeHtml(appUrl)}`);
  return lines.join("\n");
}

// Ringkasan satu baris untuk log run — sepola dengan `alertSummary`.
//
// `muted` (isu golongan penyedia yang tidak dikirimkan) DISEBUTKAN, dan itu bukan hiasan: tanpa
// angka itu, run yang menemukan enam hosting tumbang menulis "tidak ada kegagalan baru" ke log
// halaman Settings — kalimat yang persis sama dengan run yang memang tidak menemukan apa-apa, dan
// satu-satunya jejak bahwa penyaringan ini bekerja (atau menyaring terlalu banyak) hilang.
export function syncIssueSummary(alerts, delivered, chats, recovered = 0, muted = 0) {
  const pulih = recovered > 0 ? `, ${recovered} pulih` : "";
  const lewat = muted > 0 ? `, ${muted} gangguan penyedia tidak dikabarkan` : "";
  if (alerts.length === 0) return `tidak ada kegagalan baru${pulih}${lewat}`;
  if (chats === 0)
    return `${alerts.length} kegagalan, tidak ada penerima topik "Kegagalan sync"${lewat}`;
  return `${alerts.length} kegagalan ke ${delivered}/${chats} chat${pulih}${lewat}`;
}

// Pesan error dari API bisa sepanjang satu halaman HTML. Dipotong di sini, bukan di sisi pengirim:
// Telegram menolak pesan di atas 4096 karakter dengan 400, dan lima isu bertele-tele sudah cukup
// untuk membuat seluruh notifikasi hilang alih-alih terpotong.
function trim(value, max = 200) {
  const text = String(value).replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
