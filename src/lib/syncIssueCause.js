/**
 * Golongan sebuah kegagalan sync, berikut kalimat manusianya — CERMINAN `issueCause` dan tabelnya
 * di `functions/notifications-core.js`, persis seperti `campaignCommandEntry` dan `dueReminders`.
 *
 * Sampai panel isu sync di topbar menampilkannya, aturan ini sengaja TIDAK dicerminkan: salinan
 * kedua yang tidak dipakai siapa pun adalah salinan yang tidak akan pernah ikut diperbarui. Yang
 * mengubah itu adalah panelnya sendiri — sebelum ini ia menampilkan pesan API apa adanya ("GAM POST
 * /networks/23352267851/reports/8298846231:run -> 503"), dan yang membacanya bukan yang menulis
 * kodenya: ia memutuskan SATU hal, perlu dikerjakan sekarang atau tidak, dan tidak ada apa pun di
 * kalimat itu yang menjawabnya. Chat Telegram sudah menjawabnya sejak `issueCause` ada; layar yang
 * menjawab lebih buruk daripada chat untuk keadaan yang sama adalah alasan orang berhenti membuka
 * salah satunya.
 *
 * BEDA SEDIKIT di antara keduanya, dan panel menyebut golongan yang berbeda dari chat untuk isu
 * yang sama — "gangguan sementara, akan pulih sendiri" di layar melawan "perlu login ulang" di
 * ponsel, dan yang dipercaya orang adalah yang lebih menenangkan. Dijaga tes yang membaca berkas
 * seberangnya (`src/lib/syncIssueCause.test.mjs`).
 *
 * Yang TIDAK ikut dicerminkan adalah penyusun pesannya (`syncIssueMessage`): bentuk pesan Telegram
 * dan bentuk panel di layar memang berbeda, dan yang harus sama cuma penggolongannya.
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

// Urutan kelompok: yang menuntut tindakan lebih dulu. Yang berhenti membaca di baris pertama
// harus sudah melewati bagian yang tidak akan pulih sendiri.
export const CAUSE_ORDER = ["action", "provider", "unknown"];

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

// Status HTTP dibaca dari BENTUK yang benar-benar ditulis pelempar errornya (`-> 503:`,
// `(HTTP 502)`), bukan dari angka tiga digit di mana pun dalam teks: `act_5031` juga tiga digit.
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
