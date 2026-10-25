// Antrean percobaan ulang (`dashboard/syncRetries`) dalam bentuk yang bisa dibaca layar.
//
// Aturannya sendiri — berapa kali dan seberapa jarang — tinggal di `functions/sync-core.js`
// (`dueRetries`, `retryOutcome`, `MAX_SYNC_RETRIES`); yang ada di sini cuma penerjemahnya jadi satu
// kalimat. Dipisah dari komponennya supaya kalimat di ikon topbar dan kalimat di dalam dialog tidak
// pernah berbeda — dua tempat yang bercerita tentang percobaan yang sama.
//
// Cabangnya bernama sama dengan cabang `syncIssues` (`gamAccounts`, `plugin`, …), jadi tiap
// kelompok isu di dialog bisa menemukan antreannya sendiri tanpa peta nama di antara keduanya.

const MAX_TARGETS_SHOWN = 3;
const MAX_ATTEMPTS = 5;

export function retryEntries(branch) {
  return Object.entries(branch || {})
    .filter(([, entry]) => entry)
    .map(([id, entry]) => ({
      id,
      name: String(entry.name || id),
      attempts: Math.max(0, Number(entry.attempts) || 0),
      nextAt: String(entry.nextAt || ""),
      running: Boolean(entry.running),
    }));
}

/**
 * `null` kalau cabang ini tidak punya antrean sama sekali — dan tidak adanya antrean harus terbaca
 * sebagai TIDAK ADA KALIMAT, bukan sebagai "tidak akan dicoba lagi": sync penuh berikutnya tetap
 * mencoba semuanya, dan janji yang salah di sini membuat orang menunggu sesuatu yang tidak datang.
 */
export function retryStatus(branch, now = new Date()) {
  const entries = retryEntries(branch);
  if (!entries.length) return null;

  const running = entries.some((entry) => entry.running);
  // Yang ditampilkan adalah percobaan TERDEKAT: sebuah cabang bisa memuat lima situs dengan jadwal
  // yang berbeda-beda, dan yang ditunggu orang di depan layar adalah yang paling dulu jalan.
  const soonest = entries
    .filter((entry) => entry.nextAt)
    .sort((left, right) => left.nextAt.localeCompare(right.nextAt))[0];
  const attempts = Math.min(...entries.map((entry) => entry.attempts));

  return {
    running,
    label: running
      ? `Mencoba lagi sekarang — percobaan ${attemptLabel(attempts)}`
      : `Percobaan ${attemptLabel(attempts)} ${untilLabel(soonest?.nextAt, now)}`,
    targets: targetLabel(entries),
  };
}

// "2 dari 5". `attempts` adalah jumlah yang SUDAH dijalankan, jadi yang berikutnya adalah +1.
function attemptLabel(attempts) {
  return `${Math.min(attempts + 1, MAX_ATTEMPTS)} dari ${MAX_ATTEMPTS}`;
}

/**
 * "dalam 4 menit" / "sebentar lagi".
 *
 * Sisa waktu, bukan jam dinding: yang ditanyakan orang di sini adalah "perlu menunggu?", dan
 * "12:03" memaksa mereka mengurangkannya sendiri dari jam yang harus dicari lebih dulu di layar.
 * Jadwal yang sudah lewat (siklusnya sedang tersendat) berbunyi "sebentar lagi" alih-alih angka
 * negatif — yang menjalankannya berdenyut tiap menit, jadi selisih sekecil itu memang tidak berarti.
 */
function untilLabel(nextAt, now) {
  const ms = new Date(nextAt || 0).getTime() - now.getTime();
  if (!Number.isFinite(ms) || ms <= 30000) return "sebentar lagi";
  const minutes = Math.round(ms / 60000);
  return minutes < 1 ? "kurang dari semenit lagi" : `dalam ${minutes} menit`;
}

// Nama yang sedang diantre. Dipotong, karena sebuah kelompok bisa memuat sepuluh baris sementara
// kalimat statusnya yang justru harus tetap terbaca utuh.
function targetLabel(entries) {
  const names = entries.map((entry) => entry.name);
  return names.length > MAX_TARGETS_SHOWN
    ? `${names.slice(0, MAX_TARGETS_SHOWN).join(", ")} +${names.length - MAX_TARGETS_SHOWN} lagi`
    : names.join(", ");
}

// Ada percobaan yang sedang BERJALAN di cabang mana pun — dibaca ikon topbar, supaya indikatornya
// berputar tanpa perlu membuka dialognya lebih dulu.
export function anyRetryRunning(retries) {
  return Object.values(retries || {}).some((branch) =>
    retryEntries(branch).some((entry) => entry.running),
  );
}
