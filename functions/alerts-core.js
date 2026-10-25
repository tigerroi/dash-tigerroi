import { rtdbKey, zonedDateKey } from "./sync-core.js";

/**
 * Peringatan ROI ke Telegram — aturan, penilaian, dan bunyi pesannya.
 *
 * Dashboard ini tahu ROI sebuah subdomain ambruk pukul 09:00 dan tidak memberi tahu siapa pun:
 * satu-satunya cara mengetahuinya adalah membuka `/dashboard/roi`. Modul ini yang membalik arahnya
 * — sync yang sudah jalan tiap jam menilai baris yang baru saja ditulisnya, dan yang melewati
 * ambang dikirim ke chat yang sama dengan pengingat jatuh tempo.
 *
 * SEMUANYA MENUMPANG YANG SUDAH ADA, dan itu disengaja: `sendTelegramMessage` (telegram.mjs),
 * jadwal `scheduledSync`, dan pola penanda harian `dashboard/reminderNotices`. Yang benar-benar baru
 * cuma berkas ini dan satu node setelan.
 *
 * Ke mana ia dikirim BUKAN urusan berkas ini: penerimanya adalah topik "roiAlerts" di Notification
 * Center (`topicRecipients` di notifications-core.js), bukan lagi satu daftar chat untuk semua
 * notifikasi. Yang di sini tetap cuma menilai dan menyusun kalimatnya.
 *
 * ═══ ATURAN YANG PALING PENTING DI SELURUH BERKAS INI ═══
 *
 * Baris yang earning atau spend-nya TIDAK DIKETAHUI tidak pernah dinilai — tidak sebagai baik,
 * tidak sebagai buruk. Ia dilewati.
 *
 * Repo ini sudah membedakan "tidak tahu" dari "nol" dengan susah payah: `""` bukan `0` di
 * `withAdTax`, `gamMissing`/`gamStale` di baris ROI, `metaMissing` yang menyebutkan SEBAB kolom
 * Meta kosong. Laporan GAM yang gagal datang membuat sebuah subdomain tampak "ROI -100%", dan
 * peringatan yang meleburnya akan berbunyi tiap kali GAM sedang lambat. Sekali itu terjadi
 * beberapa kali, orang berhenti membaca notifikasinya — dan fitur ini mati tanpa ada yang
 * mematikannya.
 *
 * ROI-nya juga TIDAK dihitung ulang di sini. `roiReportUpdate` sudah menuliskannya ke baris, dan
 * hanya saat earning benar-benar diketahui; menghitungnya lagi berarti rumus ROI kedua di repo
 * yang seluruh dokumentasinya bersandar pada rumus itu cuma ada satu.
 */

// Ambang bawaan — dipakai kalau `settings/alerts` belum pernah disimpan siapa pun.
//
// `minSpend` bukan hiasan dan bukan selera: tanpa lantai belanja, tiap campaign yang baru menyala
// (spend Rp 5.000, earning belum masuk) memenuhi syarat "ROI di bawah -50%". Peringatan yang
// berbunyi untuk keadaan normal adalah peringatan yang diabaikan.
export const DEFAULT_ALERTS = {
  enabled: false,
  minSpend: 100_000,
  roiThreshold: -50,
  balanceThreshold: 100_000,
  spendNoEarning: true,
  lowRoi: true,
  lowBalance: true,
};

// Setelan dari RTDB, dinormalkan. Angka yang tersimpan sebagai teks (kotak <input type="number">
// mengirim teks) diterima apa adanya; yang tidak terbaca sebagai angka jatuh ke bawaannya, bukan
// ke 0 — ambang 0 yang lahir dari salah ketik akan membuat SELURUH armada memenuhi syarat.
export function alertSettings(value) {
  const raw = value || {};
  const number = (key) => {
    // Kosong diperiksa SEBELUM Number(), karena `Number("")` adalah 0 dan 0 itu finite — kotak
    // yang dikosongkan orang akan lolos sebagai ambang nol, dan ambang nol membuat seluruh armada
    // memenuhi syarat sekaligus. Ini bukan kasus hipotetis: tesnya menangkapnya di percobaan
    // pertama.
    const value = raw[key];
    if (value === "" || value === null || value === undefined) return DEFAULT_ALERTS[key];
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : DEFAULT_ALERTS[key];
  };
  const flag = (key) =>
    raw[key] === undefined || raw[key] === null ? DEFAULT_ALERTS[key] : raw[key] === true;

  return {
    enabled: raw.enabled === true,
    minSpend: Math.max(0, number("minSpend")),
    roiThreshold: number("roiThreshold"),
    balanceThreshold: Math.max(0, number("balanceThreshold")),
    spendNoEarning: flag("spendNoEarning"),
    lowRoi: flag("lowRoi"),
    lowBalance: flag("lowBalance"),
  };
}

/**
 * Baris hari yang sedang berjalan, dari `dashboard/roiReports`.
 *
 * Baris harian ditimpa tiap sync, jadi baris hari berjalan ADALAH keadaan sekarang — persis yang
 * ingin dinilai. `roiSnapshots` sengaja tidak dipakai walau ia yang menyimpan tiap sync: isinya
 * beberapa baris per subdomain per hari, dan menilai semuanya berarti satu subdomain memicu
 * peringatan yang sama berkali-kali dalam satu hari.
 *
 * Harinya dibaca dari BARIS (`partial`), bukan dari jam server: run yang jalan pukul 00:03 WIB
 * menulis baris tanggal kemarin sampai laporan hari baru tersedia, dan hari menurut jam server
 * akan menghasilkan daftar kosong justru pada jam yang paling sepi pengawasan.
 */
export function runningRows(reports) {
  const rows = Object.values(reports || {}).filter((row) => row && row.partial === true);
  if (rows.length === 0) return [];

  const latest = rows.reduce((max, row) => (row.date > max ? row.date : max), "");
  return rows.filter((row) => row.date === latest);
}

// Apakah baris ini membawa angkanya sendiri. Cerminan `earningKnown`/`spendingKnown` di
// `src/lib/adTax.js` — dua tempat, satu aturan, seperti `campaignCommandEntry`. Bedanya di sini
// baris sudah berbentuk RTDB apa adanya, jadi yang diperiksa fieldnya langsung.
function earningKnown(row) {
  return typeof row?.earning === "number" && !row?.gamMissing;
}

function spendingKnown(row) {
  return typeof row?.spending === "number" && !row?.metaMissing;
}

/**
 * Nilai satu kumpulan baris terhadap setelannya. Hasilnya daftar peringatan, bukan pesan —
 * yang memutuskan bunyinya `alertMessage`, dan yang memutuskan mana yang jadi dikirim
 * `alertsToSend`. Tiga langkah terpisah supaya masing-masing bisa dites tanpa dua lainnya.
 *
 * `id` adalah kunci penanda harian: satu aturan pada satu subdomain berbunyi sekali sehari.
 * Subdomain dipakai sebagai identitasnya (bukan kunci baris), karena kunci baris memuat tanggal —
 * dan penanda yang ikut berganti tiap hari tidak menahan apa pun.
 */
export function evaluateAlerts(rows, settings) {
  const config = alertSettings(settings);
  if (!config.enabled) return [];

  const alerts = [];
  for (const row of rows || []) {
    const subDomain = row?.subDomain || row?.campaign || "";
    if (!subDomain) continue;
    // Nama subdomain adalah hostname (gifts.masseffectstore.com) dan jadi kunci
    // `dashboard/alertNotices`; base.subDomain tetap nama asli untuk pesan.
    const idKey = rtdbKey(subDomain);

    const spend = spendingKnown(row) ? row.spending : null;
    const totalSpending = typeof row?.totalSpending === "number" ? row.totalSpending : spend;
    const base = { subDomain, pic: row?.pic || "", date: row?.date || "", time: row?.time || "" };

    // Belanja jalan, hasilnya nol. Ini yang paling mahal per jam diamnya — biasanya kode iklan
    // yang salah pasang atau situs yang tumbang — dan satu-satunya yang tidak butuh ROI untuk
    // dikenali. `earning === 0` yang DIKETAHUI, bukan earning yang tidak ada: yang kedua adalah
    // laporan yang gagal, dan itu isu sync, bukan isu iklan.
    if (
      config.spendNoEarning &&
      spend !== null &&
      spend >= config.minSpend &&
      earningKnown(row) &&
      row.earning === 0
    ) {
      alerts.push({
        ...base,
        id: `spendNoEarning__${idKey}`,
        rule: "spendNoEarning",
        spend: totalSpending,
        earning: 0,
        roi: null,
      });
      // Satu baris tidak perlu dua peringatan: ROI-nya sudah pasti -100%, dan aturan di bawah
      // akan mengatakan hal yang sama dengan kalimat yang lebih lemah.
      continue;
    }

    if (
      config.lowRoi &&
      spend !== null &&
      spend >= config.minSpend &&
      earningKnown(row) &&
      typeof row.roi === "number" &&
      row.roi <= config.roiThreshold
    ) {
      alerts.push({
        ...base,
        id: `lowRoi__${idKey}`,
        rule: "lowRoi",
        spend: totalSpending,
        earning: row.earning,
        roi: row.roi,
      });
    }

    // Saldo Meta menipis. Berdiri sendiri dari dua aturan di atas — tidak butuh minimum belanja,
    // tidak butuh earning, dan justru berbunyi untuk campaign yang sedang SEHAT: yang berhenti
    // tengah malam karena saldonya habis adalah yang sedang menghasilkan.
    if (
      config.lowBalance &&
      typeof row?.metaBalance === "number" &&
      row.metaBalance <= config.balanceThreshold
    ) {
      alerts.push({
        ...base,
        id: `lowBalance__${idKey}`,
        rule: "lowBalance",
        balance: row.metaBalance,
      });
    }
  }

  // Yang paling merugikan di atas: ROI terburuk dulu, lalu saldo tertipis. Pesan Telegram yang
  // dibaca sambil berjalan jarang terbaca sampai baris terakhir.
  return alerts.sort((a, b) => ruleWeight(a) - ruleWeight(b) || (a.roi ?? 0) - (b.roi ?? 0));
}

function ruleWeight(alert) {
  if (alert.rule === "spendNoEarning") return 0;
  if (alert.rule === "lowRoi") return 1;
  return 2;
}

/**
 * Yang belum dikabarkan HARI INI. `notices` adalah `dashboard/alertNotices` — {id: "YYYY-MM-DD"}.
 *
 * Sekali sehari per aturan per subdomain, persis seperti `remindersToSend`. Kenapa tidak tiap
 * sync: ROI yang buruk pukul 09:00 masih buruk pukul 10:00, dan dua puluh empat pesan untuk satu
 * keadaan yang sama adalah cara tercepat membuat orang membisukan chatnya. Kenapa tidak sekali
 * saja: keadaan yang bertahan sampai besok memang perlu disebut lagi — hari baru, keputusan baru.
 */
export function alertsToSend(alerts, notices, today = zonedDateKey()) {
  const sent = notices || {};
  return (alerts || []).filter((alert) => sent[alert.id] !== today);
}

/**
 * Penanda untuk `dashboard/alertNotices`, sekaligus penyapu — sepola dengan `noticeUpdate` di
 * reminders-core.js.
 *
 * Penanda milik subdomain yang sudah PULIH dihapus (`null`), dan itu bukan kerapian: tanpa itu
 * node ini tumbuh mengikuti jumlah subdomain yang pernah bermasalah, dan subdomain yang ambruk
 * lagi dua minggu kemudian akan membawa penanda basi yang membuatnya terlihat "sudah dikabarkan".
 */
export function alertNoticeUpdate(sentAlerts, notices, today = zonedDateKey()) {
  const update = {};
  const live = new Set();
  for (const alert of sentAlerts) {
    update[alert.id] = today;
    live.add(alert.id);
  }
  for (const id of Object.keys(notices || {})) {
    if (!live.has(id) && notices[id] !== today) update[id] = null;
  }
  return update;
}

/**
 * Pesan Telegram, parse_mode HTML — alasan yang sama dengan `reminderMessage`: nama subdomain dan
 * PIC diketik orang, dan satu `_` di Markdown membuat Telegram menolak seluruh pesan dengan 400.
 * Pesan yang ditolak diam-diam adalah peringatan yang tidak pernah sampai.
 */
export function alertMessage(alerts, settings, appUrl) {
  const config = alertSettings(settings);
  const stamp = alerts[0]?.date || "";
  const clock = alerts[0]?.time ? ` ${alerts[0].time}` : "";
  const lines = [`⚠️ <b>Peringatan ROI</b> — ${formatDateKey(stamp)}${clock}`, ""];

  for (const alert of alerts) {
    lines.push(`• ${alertLine(alert)}`);
  }

  // Ambangnya ikut disebut, dan itu menjawab pertanyaan pertama yang muncul di kepala penerima:
  // "kenapa yang ini berbunyi dan yang kemarin tidak". Tanpa itu, satu-satunya cara mengetahuinya
  // adalah membuka halaman Settings.
  lines.push(
    "",
    `<i>Ambang: ROI ≤ ${config.roiThreshold}% di atas belanja ${formatRupiah(config.minSpend)}, ` +
      `saldo ≤ ${formatRupiah(config.balanceThreshold)}.</i>`,
  );

  if (appUrl) lines.push("", `Lihat: ${escapeHtml(appUrl)}`);
  return lines.join("\n");
}

function alertLine(alert) {
  const who = alert.pic ? ` (${escapeHtml(alert.pic)})` : "";
  const name = `<b>${escapeHtml(alert.subDomain)}</b>${who}`;

  if (alert.rule === "spendNoEarning") {
    return `${name} — belanja ${formatRupiah(alert.spend)}, earning masih Rp 0`;
  }
  if (alert.rule === "lowRoi") {
    return `${name} — ROI ${formatPercent(alert.roi)}, belanja ${formatRupiah(alert.spend)}, earning ${formatRupiah(alert.earning)}`;
  }
  return `${name} — saldo Meta tinggal ${formatRupiah(alert.balance)}`;
}

// Ringkasan satu baris untuk log run, dipakai `scheduledSync` sebagai detail tahapnya.
export function alertSummary(alerts, delivered, chats) {
  if (alerts.length === 0) return "tidak ada yang melewati ambang";
  return `${alerts.length} peringatan ke ${delivered}/${chats} chat`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

// "09 Agu 2026" — format yang sama dengan seluruh dashboard dan dengan pesan pengingat. Disalin
// dari reminders-core.js dan bukan diimpor: keduanya modul yang berdiri sendiri, dan satu impor
// silang antar dua fitur yang tidak berhubungan adalah tali yang akan ditarik orang berikutnya.
export function formatDateKey(key) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(key || ""));
  if (!match) return String(key || "");
  const [, year, month, day] = match;
  return `${day} ${MONTHS[Number(month) - 1] || month} ${year}`;
}

function formatRupiah(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `Rp ${Math.round(number).toLocaleString("id-ID")}` : "-";
}

function formatPercent(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toFixed(2)}%` : "-";
}

function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
