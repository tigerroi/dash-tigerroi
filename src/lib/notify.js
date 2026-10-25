import toast from "react-hot-toast";

// Every message the user sees goes through here.
//
// The split: the toast says what happened and what to do about it, in plain language — no
// Firebase codes, no Graph API error numbers, no "PERMISSION_DENIED". The raw error goes to the
// browser console, which is where whoever is debugging will look anyway.

const LOG_PREFIX = "[RabbitROI]";

// Firebase error codes -> what the person in front of the screen should read.
const CODE_MESSAGES = {
  "auth/invalid-credential": "Email atau password salah. Coba lagi.",
  "auth/user-not-found": "Email atau password salah. Coba lagi.",
  "auth/wrong-password": "Email atau password salah. Coba lagi.",
  "auth/invalid-email": "Format email belum benar.",
  "auth/missing-password": "Password belum diisi.",
  "auth/weak-password": "Password terlalu pendek. Pakai minimal 6 karakter.",
  "auth/email-already-in-use": "Email ini sudah dipakai akun lain.",
  "auth/too-many-requests": "Terlalu banyak percobaan. Tunggu beberapa menit lalu coba lagi.",
  "auth/network-request-failed": "Koneksi internet terputus. Periksa jaringan lalu coba lagi.",
  "auth/popup-closed-by-user": "Proses login dibatalkan.",
  "auth/configuration-not-found": "Login sedang tidak tersedia. Hubungi admin.",
  "auth/operation-not-allowed": "Login sedang tidak tersedia. Hubungi admin.",
  "database/permission-denied": "Kamu tidak punya akses ke data ini. Hubungi admin.",
  PERMISSION_DENIED: "Kamu tidak punya akses ke data ini. Hubungi admin.",
  "database/unavailable": "Layanan sedang tidak bisa dihubungi. Coba lagi beberapa saat lagi.",
};

// Free-text errors that reach us from the sync backend, Meta, and Google. Matched in order, so
// keep the specific ones above the general ones.
const TEXT_MESSAGES = [
  [/hanya admin/i, "Hanya admin yang boleh menjalankan aksi ini."],
  [/login dulu|harus login/i, "Kamu harus login dulu."],
  [/tidak diizinkan/i, "Akun kamu tidak diizinkan menjalankan aksi ini."],
  [/belum bisa dicek otomatis/i, "Data ini belum bisa dicek otomatis."],
  // Meta pakai "(#200)" untuk blokir app maupun izin akun yang kurang, jadi blokirnya dicek dulu.
  [
    /api access blocked|app(lication)? (has been )?(blocked|disabled|restricted)/i,
    "Aplikasi Meta sedang diblokir. Hubungi admin.",
  ],
  [
    /unsupported get request|does not exist|cannot be loaded|\(#803\)/i,
    "Ad account ini tidak ditemukan. Periksa Act ID-nya.",
  ],
  [
    /ad account.*(disabled|closed|unsettled)|account has been disabled|\(#100-33\)/i,
    "Akun iklan ini dinonaktifkan Meta.",
  ],
  [
    /ads_read|ads_management|\(#200[-)]/i,
    "Akun iklan ini belum memberi izin. Minta pemilik akun menyetujui permintaan akses.",
  ],
  [
    /invalid_grant|unauthorized_client|refresh token/i,
    "Koneksi akun Google terputus. Hubungkan ulang lewat tombol Login di halaman Google API.",
  ],
  [
    /oauthexception|session has expired|access token|\(#190\)/i,
    "Koneksi ke Meta sudah tidak berlaku. Hubungi admin untuk memperbaruinya.",
  ],
  [/META_ACCESS_TOKEN|belum di-set|belum diatur/i, "Koneksi ke Meta belum diatur. Hubungi admin."],
  // Pagar milik server sendiri (429/409), bukan milik Meta — teksnya sudah ramah, tinggal
  // dilewatkan apa adanya supaya angka detiknya tidak hilang.
  [/masih berjalan/i, "Sync sebelumnya masih berjalan. Tunggu sampai selesai."],
  [
    /quota|rate limit|too many requests|terlalu banyak permintaan|\(#17\)|\(#4\)/i,
    "Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.",
  ],
  [
    /permission|forbidden|unauthorized|403/i,
    "Kamu tidak punya akses untuk aksi ini. Hubungi admin.",
  ],
  [
    /failed to fetch|networkerror|fetch failed|econnrefused|enotfound|timeout/i,
    "Tidak bisa terhubung ke server. Periksa koneksi lalu coba lagi.",
  ],
  [
    /token tidak valid|kadaluarsa|expired/i,
    "Sesi kamu sudah berakhir. Login ulang lalu coba lagi.",
  ],
];

// Plain-language version of one error, or `fallback` when we don't recognise it.
//
// `overrides` menang atas CODE_MESSAGES karena satu kode Firebase bisa berarti dua hal yang
// berbeda di dua layar: "auth/invalid-credential" pada form login berarti email ATAU passwordnya
// salah, sedangkan pada form ganti password tidak ada email yang diketik — yang salah cuma
// password lamanya, dan menyuruh orang memeriksa emailnya mengirimnya mencari di tempat kosong.
export function friendlyError(
  error,
  fallback = "Ada yang gagal. Coba lagi sebentar lagi.",
  overrides,
) {
  const code = error?.code || extractCode(error?.message);
  if (code && overrides?.[code]) return overrides[code];
  if (code && CODE_MESSAGES[code]) return CODE_MESSAGES[code];
  if (code?.startsWith("auth/")) return "Login gagal. Periksa email dan password kamu.";

  return friendlyText(error?.message) || fallback;
}

// Same, for a bare message string (what the sync backend reports per account).
function friendlyText(message) {
  if (!message) return "";
  for (const [pattern, text] of TEXT_MESSAGES) {
    if (pattern.test(message)) return text;
  }
  return "";
}

export function notifySuccess(message) {
  toast.success(message);
}

// context: what the user was doing, used both as the fallback toast and the console label.
export function notifyError(error, context, overrides) {
  console.error(`${LOG_PREFIX} ${context}`, error);
  toast.error(friendlyError(error, context, overrides));
}

export function notifyWarning(message, detail) {
  if (detail !== undefined) console.warn(`${LOG_PREFIX} ${message}`, detail);
  toast.error(message, { duration: 8000 });
}

function extractCode(message = "") {
  const match = message.match(/\((auth\/[^)]+|database\/[^)]+)\)/);
  return match?.[1];
}
