import { shiftDateKey, zonedDateKey } from "./sync-core.js";

/**
 * Isi notifikasi pengingat: siapa yang jatuh tempo, dan bunyi pesannya.
 *
 * Cerminan `src/lib/reminders.js` — dua tempat, satu aturan, seperti `campaignCommandEntry`.
 * Frontend tidak bisa mengimpor modul di folder ini (paket dan deploy-nya terpisah), jadi kalau
 * REMINDER_LEAD_DAYS di sini berbeda dengan yang di sana, badge di topbar akan menyala untuk
 * baris yang tidak pernah dikirim ke Telegram — dan sebaliknya. Yang satu berubah, yang lain
 * ikut.
 *
 * Bedanya cuma satu dan disengaja: "hari ini" di sini adalah hari menurut zona operasi
 * (`zonedDateKey`, Asia/Jakarta), bukan zona browser. Fungsi terjadwal jalan di UTC — tanpa itu,
 * kiriman pukul 08:00 WIB akan memakai tanggal kemarin.
 */

export const REMINDER_LEAD_DAYS = 2;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

// Node RTDB {id: baris} jadi array berisi id-nya. Baris tanpa dueDate dibuang di sini supaya
// pembanding teks di bawah tidak pernah bertemu undefined.
//
// Yang punya `deletedAt` juga dibuang: menghapus di dashboard adalah soft delete (`deleteResource`
// menandai barisnya, tidak mencabutnya), dan sisi UI menyaringnya di `snapshotToArray` — jauh
// sebelum `dueReminders` melihatnya. Tanpa saringan yang sama di sini, badge topbar padam
// sementara Telegram terus mengirim reminder yang sudah dihapus, tiap pagi, selamanya.
export function reminderRows(value) {
  return Object.entries(value || {})
    .map(([id, row]) => ({ ...row, id }))
    .filter((row) => row?.dueDate && !row.deletedAt);
}

// Sama persis dengan dueReminders di sisi UI: belum selesai, dan jatuh temponya sudah lewat atau
// tinggal REMINDER_LEAD_DAYS hari lagi. Tanggal ISO dibandingkan sebagai teks.
export function dueReminders(rows, today = zonedDateKey()) {
  return (Array.isArray(rows) ? rows : [])
    .filter(
      (row) =>
        row?.status !== "Selesai" &&
        row?.dueDate &&
        row.dueDate <= shiftDateKey(today, leadDaysOf(row)),
    )
    .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
}

/**
 * Jendela antisipasi untuk SATU baris, dalam hari.
 *
 * `REMINDER_LEAD_DAYS` menjawab "beri tahu saya beberapa hari sebelumnya". Untuk pengingat yang
 * berulang LEBIH SERING daripada jendela itu, antisipasi tidak berarti apa-apa: pengingat harian
 * yang baru ditandai selesai jatuh tempo lagi besok, besok masih di dalam jendela dua hari, dan
 * badge-nya tidak pernah padam. Yang terbaca orang bukan "ada tugas harian" melainkan "tombol
 * centangnya tidak bekerja" — dan badge yang selalu menyala berhenti memberi tahu apa pun.
 *
 * Jadi jendelanya dijepit ke satu hari lebih pendek dari jaraknya sendiri: harian tiap hari
 * mendapat 0 (tampil pada harinya, bukan sehari sebelumnya), harian tiap 3 hari kembali ke 2,
 * mingguan ke atas tidak berubah sama sekali.
 *
 * CERMINAN `leadDaysOf` di src/lib/reminders.js, seperti `dueReminders` di atasnya. Yang TIDAK
 * ikut dicerminkan tetap `completionUpdate` — memajukan baris adalah tindakan orang di browser,
 * dan sisi ini tidak pernah menulis ke `reminders`.
 */
export function leadDaysOf(row) {
  const days = repeatIntervalDays(row);
  return days ? Math.min(REMINDER_LEAD_DAYS, days - 1) : REMINDER_LEAD_DAYS;
}

function repeatIntervalDays(row) {
  const unit = String(row?.repeat || "")
    .trim()
    .toLowerCase();
  if (!["harian", "mingguan", "bulanan", "tahunan"].includes(unit)) return 0;

  const step = Math.max(1, Math.round(Number(row?.repeatEvery) || 1));
  if (unit === "harian") return step;
  if (unit === "mingguan") return step * 7;
  return unit === "bulanan" ? step * 28 : step * 365;
}

/**
 * Yang belum dikabarkan HARI INI. `notices` adalah `dashboard/reminderNotices` — {id: "YYYY-MM-DD"}
 * tanggal kiriman terakhir.
 *
 * Kenapa per hari dan bukan sekali seumur reminder: tagihan yang terlewat justru yang paling perlu
 * diulang, dan pengingat yang cuma berbunyi sekali di H-2 akan tenggelam di chat pada hari H.
 * Kenapa tidak tiap run: jadwalnya sehari sekali, tapi run yang gagal di tengah (Telegram timeout)
 * akan diulang Cloud Scheduler — tanpa penanda ini, satu gangguan jaringan berarti tim menerima
 * daftar yang sama tiga kali.
 */
export function remindersToSend(rows, notices, today = zonedDateKey()) {
  const sent = notices || {};
  return dueReminders(rows, today).filter((row) => sent[row.id] !== today);
}

/**
 * Penanda kiriman untuk `dashboard/reminderNotices`, sekaligus penyapu.
 *
 * Yang dihapus (`null`): penanda milik reminder yang sudah selesai, dihapus, atau jatuh temponya
 * masih jauh. Kalau tidak, node ini tumbuh selamanya — dan reminder tahunan yang jatuh tempo lagi
 * tahun depan akan membawa penanda basi yang membuatnya terlihat "sudah dikabarkan".
 */
export function noticeUpdate(sentRows, notices, today = zonedDateKey()) {
  const update = {};
  const live = new Set();
  for (const row of sentRows) {
    update[row.id] = today;
    live.add(row.id);
  }
  for (const id of Object.keys(notices || {})) {
    if (!live.has(id) && notices[id] !== today) update[id] = null;
  }
  return update;
}

/**
 * Pesan Telegram, parse_mode HTML.
 *
 * HTML dan bukan Markdown karena judul reminder diketik orang: satu tanda `_` di "invoice_agustus"
 * membuat Telegram menolak seluruh pesan dengan 400, dan pesan yang ditolak diam-diam adalah
 * pengingat yang tidak pernah sampai. Di HTML cukup tiga karakter yang di-escape.
 */
export function reminderMessage(rows, today = zonedDateKey(), appUrl) {
  const lines = [`🔔 <b>Pengingat jatuh tempo</b> — ${formatDateKey(today)}`, ""];

  for (const row of rows) {
    const parts = [`<b>${escapeHtml(row.title || "(tanpa judul)")}</b>`];
    parts.push(`${formatDateKey(row.dueDate)} (${dueLabel(row.dueDate, today)})`);
    if (row.nominal) parts.push(formatRupiah(row.nominal));
    if (row.type) parts.push(escapeHtml(row.type));
    lines.push(`• ${parts.join(" — ")}`);
    if (row.note) lines.push(`  <i>${escapeHtml(row.note)}</i>`);
  }

  if (appUrl) {
    lines.push("", `Tandai selesai: ${escapeHtml(appUrl)}`);
  }
  return lines.join("\n");
}

// "terlewat 3 hari" mendesak dengan cara yang tidak bisa dilakukan tanggal saja — pembaca tidak
// harus menghitung sendiri dari tanggal hari ini yang ada di baris pertama pesan.
export function dueLabel(dueDate, today) {
  const days = dayDiff(dueDate, today);
  if (days < 0) return `terlewat ${Math.abs(days)} hari`;
  if (days === 0) return "hari ini";
  if (days === 1) return "besok";
  return `${days} hari lagi`;
}

// Selisih hari antar dua kunci "YYYY-MM-DD", dihitung di tengah hari UTC (alasan yang sama dengan
// shiftDateKey: DST/zona tidak boleh membuatnya meleset satu hari).
function dayDiff(dueDate, today) {
  const a = Date.parse(`${dueDate}T12:00:00Z`);
  const b = Date.parse(`${today}T12:00:00Z`);
  return Math.round((a - b) / 86_400_000);
}

// "09 Agu 2026" — format tanggal yang sama dengan seluruh dashboard (src/lib/formatDate.js).
// Pesan Telegram dibaca orang yang sama dengan yang membaca tabelnya; dua bentuk tanggal untuk
// satu baris yang sama adalah cara membuat orang mengira itu dua hal.
export function formatDateKey(key) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(key || ""));
  if (!match) return String(key || "");
  const [, year, month, day] = match;
  return `${day} ${MONTHS[Number(month) - 1] || month} ${year}`;
}

function formatRupiah(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `Rp ${Math.round(number).toLocaleString("id-ID")}` : "";
}

function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
