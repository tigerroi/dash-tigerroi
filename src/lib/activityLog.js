/**
 * Jejak aktivitas — bentuk barisnya, penyaring rahasianya, dan penyangga di localStorage.
 *
 * Yang murni dihitung tinggal di sini (sepola dengan `src/lib/otp.js`): pembuat baris, redaksi,
 * dan antrean. Yang menyentuh DOM dan jam dinding tinggal di `src/hooks/useActivityLogger.js`,
 * yang menyentuh jaringan di `src/lib/controlApi.js`.
 *
 * TIGA HAL YANG MENENTUKAN SELURUH RANCANGAN INI:
 *
 * 1. **IP tidak bisa datang dari browser.** Sebuah halaman tidak tahu alamat publiknya sendiri;
 *    yang mengaku tahu sebenarnya mengutip layanan pihak ketiga — atau mengarangnya. Karena itu
 *    baris ini dikirim lewat server kontrol, yang MENCAP `ip` dan `userAgent` dari request-nya
 *    sendiri, dan bukan ditulis langsung ke RTDB dari browser. Log audit yang alamatnya bisa
 *    diketik pemiliknya sendiri bukan log audit.
 *
 * 2. **`id` dibuat di browser, dan itu yang membuat kiriman ulang aman.** Server memakainya apa
 *    adanya sebagai kunci RTDB, jadi batch yang sebenarnya sampai tapi jawabannya hilang di
 *    jaringan — lalu dikirim lagi lima menit kemudian — menimpa baris yang sama alih-alih
 *    menggandakannya. Tanpa ini, satu jaringan yang buruk menghasilkan riwayat yang menyebut satu
 *    klik sebagai lima klik.
 *
 * 3. **Login yang GAGAL tidak punya token, dan justru itu yang paling perlu tercatat.** Ia tetap
 *    ditulis ke penyangga dan berangkat menumpang sesi berikutnya yang berhasil login di perangkat
 *    yang sama. Server mencap siapa yang benar-benar mengirimnya (`reportedByUid`), jadi baris yang
 *    dititipkan tidak bisa menyamar sebagai baris yang dikirim pemiliknya sendiri.
 */

// Satu penyangga per perangkat. Versinya ikut di nama: bentuk baris yang berubah tidak boleh
// membuat baris lama gagal diurai selamanya — cukup ganti "v1" dan yang lama ditinggalkan.
export const ACTIVITY_BUFFER_KEY = "rabbitroi.activityLog.v1";

// Lima menit, sesuai permintaan. Yang menentukan kapan kiriman berangkat tetap ada tiga: jadwal
// ini, kembalinya jaringan (`online`), dan tab yang ditinggalkan (`pagehide`).
export const ACTIVITY_FLUSH_MS = 5 * 60 * 1000;

// Batas satu kiriman. Penyangga yang menumpuk seminggu karena server mati tidak boleh berangkat
// sebagai satu request 4 MB yang pasti ditolak — ia berangkat sepotong demi sepotong, dan potongan
// yang berhasil dibuang dari penyangga sebelum potongan berikutnya dicoba.
export const ACTIVITY_BATCH = 100;

/**
 * Batas isi penyangga. Tercapai, yang dibuang adalah yang TERTUA.
 *
 * Pilihannya cuma dua saat penyangga penuh: berhenti mencatat yang baru, atau membuang yang lama.
 * Yang pertama berarti perangkat yang lama offline berhenti mencatat justru pada jam-jam yang
 * paling ingin dibaca orang sesudahnya.
 */
export const ACTIVITY_MAX_BUFFER = 500;

// Kategori — dipakai penyaring di halaman, dan menentukan apa yang boleh dibaca dari satu baris.
export const ACTIVITY_CATEGORIES = {
  auth: "Autentikasi",
  navigation: "Kunjungan halaman",
  interaction: "Klik tombol",
  operation: "Operasi data",
};

/**
 * Nama field yang isinya TIDAK BOLEH ikut tercatat, dicocokkan longgar.
 *
 * Halaman ini mencatat operasi data, dan operasi data di dashboard ini membawa password akun,
 * secret TOTP, api_key plugin, dan refresh token Google. Sebuah log yang menyalinnya berarti
 * memindahkan rahasia yang dijaga `otpSecrets` (superadmin) dan `pluginKeys` ke sebuah node yang
 * dibaca setiap admin — dan izin baca RTDB menurun, jadi tidak ada aturan yang bisa menariknya
 * kembali sesudahnya.
 *
 * Disaring di SINI, sebelum menyentuh penyangga, bukan di server: yang tidak pernah ditulis ke
 * localStorage juga tidak bisa terbaca dari localStorage.
 */
const SECRET_KEY = /pass|secret|token|api_?key|refresh|credential|otp|rekening|private/i;

// Nilai yang panjang dipotong, bukan ditolak: yang berguna dari sebuah nilai di log audit adalah
// bahwa ia berubah dan kira-kira jadi apa, bukan isinya utuh.
const MAX_TEXT = 200;

function newActivityId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Lingkungan tanpa crypto.randomUUID (browser lama, sebagian WebView). Tetap acak dan tetap unik
  // per perangkat — yang dijaga id ini adalah kiriman ulang, bukan rahasia apa pun.
  return `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function text(value, max = MAX_TEXT) {
  const raw = typeof value === "string" ? value : value == null ? "" : String(value);
  return raw.trim().slice(0, max);
}

/**
 * Objek apa pun → satu baris keterangan yang aman dibaca orang lain.
 *
 * Nilai field yang namanya berbau rahasia diganti "•••" — namanya TETAP tampil, dan itu disengaja:
 * "password diubah" adalah kejadian yang justru harus terbaca di log audit. Yang tidak boleh
 * terbaca cuma isinya.
 */
export function sanitizeDetail(detail) {
  if (detail == null) return "";
  if (typeof detail === "string") return text(detail);
  if (typeof detail !== "object") return text(detail);

  const parts = [];
  for (const [key, value] of Object.entries(detail)) {
    if (value === undefined || value === null || value === "") continue;
    if (SECRET_KEY.test(key)) {
      parts.push(`${key}=•••`);
      continue;
    }
    if (typeof value === "object") {
      parts.push(`${key}={…}`);
      continue;
    }
    parts.push(`${key}=${text(value, 60)}`);
  }
  return text(parts.join(" · "));
}

/**
 * Satu baris jejak.
 *
 * `at` adalah jam BROWSER dan boleh salah — jam perangkat orang tidak dijamin benar, dan sebagian
 * memang meleset berjam-jam. Server mencap `receivedAt` miliknya sendiri di sebelahnya, jadi
 * selisih keduanya terlihat alih-alih ditebak dari urutan baris yang aneh.
 *
 * Identitas ikut disalin ke tiap baris (`actorUid`/`actorEmail`/`actorRole`) dan tidak dirujuk
 * lewat id: baris yang dicatat sebelum seseorang dipindah rolenya harus tetap menyebut role yang
 * berlaku SAAT itu. Sebuah rujukan akan menulis ulang sejarah tiap kali dropdown Role diubah.
 */
export function activityEvent({
  category,
  action,
  page = "",
  label = "",
  target = "",
  detail,
  status = "ok",
  actor,
  at = new Date().toISOString(),
  id = newActivityId(),
}) {
  return {
    id,
    at,
    category: ACTIVITY_CATEGORIES[category] ? category : "operation",
    action: text(action, 60),
    page: text(page, 200),
    label: text(label, 120),
    target: text(target, 200),
    detail: sanitizeDetail(detail),
    status: status === "failed" ? "failed" : "ok",
    actorUid: text(actor?.uid, 128),
    actorEmail: text(actor?.email, 200),
    actorRole: text(actor?.role, 60),
  };
}

// --- Penyangga -----------------------------------------------------------------------------
//
// `storage` dioper, tidak diimpor: modul ini diuji dengan `node --test` yang tidak punya
// localStorage sama sekali, dan sebuah `typeof window` di tengah fungsi murni adalah cabang yang
// tidak pernah ikut teruji.

export function readBuffer(storage) {
  try {
    const raw = storage?.getItem(ACTIVITY_BUFFER_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((row) => row && typeof row.id === "string") : [];
  } catch {
    // Isi yang rusak (tab lain menulis setengah, kuota habis di tengah tulisan) dibuang diam-diam.
    // Melempar dari sini berarti sebuah log audit menjatuhkan halaman yang sedang dipakai orang —
    // biaya yang tidak sebanding dengan apa pun yang dicatatnya.
    return [];
  }
}

export function writeBuffer(storage, rows) {
  try {
    storage?.setItem(ACTIVITY_BUFFER_KEY, JSON.stringify(rows.slice(-ACTIVITY_MAX_BUFFER)));
    return true;
  } catch {
    // localStorage penuh atau ditolak (mode privat sebagian browser). Mencatat aktivitas tidak
    // boleh menjadi alasan sebuah tombol berhenti bekerja.
    return false;
  }
}

export function appendBuffer(storage, event) {
  const rows = readBuffer(storage);
  rows.push(event);
  writeBuffer(storage, rows);
  return rows.length;
}

// Yang sudah terkirim dibuang lewat ID-nya, BUKAN lewat `slice(batch.length)`: sela antara kiriman
// berangkat dan jawabannya datang bisa diisi klik baru, dan memotong dari depan sejumlah yang
// terkirim akan membuang baris yang belum pernah dikirim ke mana pun.
export function dropSent(storage, sentIds) {
  const sent = new Set(sentIds);
  const rest = readBuffer(storage).filter((row) => !sent.has(row.id));
  writeBuffer(storage, rest);
  return rest;
}

export function nextBatch(storage, size = ACTIVITY_BATCH) {
  return readBuffer(storage).slice(0, size);
}
