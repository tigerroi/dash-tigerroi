import {
  ACTIVITY_BATCH,
  ACTIVITY_FLUSH_MS,
  activityEvent,
  appendBuffer,
  dropSent,
  nextBatch,
  readBuffer,
} from "./activityLog.js";
import { CONTROL_API_ENABLED, observeControlRequests, sendActivityLogs } from "./controlApi";
import { localStore } from "./localStore.js";

/**
 * Pencatat jejak aktivitas — satu untuk seluruh aplikasi.
 *
 * Sebuah singleton dan bukan context React, karena yang memanggilnya sebagian besar BUKAN komponen:
 * `useFirebaseStore` mencatat tiap operasi data, `useFirebaseAuth` mencatat login dan logout, dan
 * pendengar klik global mencatat tombol. Lewat context, tiap pemanggil harus diberi prop yang
 * melewati seluruh pohon hanya untuk satu efek samping yang tidak mengubah apa pun di layar.
 *
 * Identitas dipasang sekali saat sesi berubah (`setActivityActor`). Baris yang dicatat SEBELUM
 * identitas dipasang — login yang gagal, halaman login yang dibuka — tetap tercatat tanpa aktor,
 * dan server yang mencap siapa yang kelak mengirimkannya.
 */

let actor = null;
let timer = null;
let flushing = false;

// Kunjungan halaman yang sama berturut-turut tidak dicatat dua kali. Filter dan pencarian tinggal
// di query alamat (lihat `useUrlState`), jadi satu kotak pencarian yang diketik menghasilkan satu
// perubahan alamat PER HURUF — dan tanpa penjaga ini, mengetik "masse" mencatat lima kunjungan ke
// halaman yang tidak pernah ditinggalkan. Itu juga alasan yang dicatat cuma path, bukan query.
let lastPage = "";

export function setActivityActor(next) {
  actor = next ? { uid: next.uid, email: next.email, role: next.role } : null;
}

/**
 * Catat satu kejadian. TIDAK mengirim apa pun — ia menulis ke penyangga dan selesai.
 *
 * Sengaja tanpa `await` di sisi pemanggil dan tanpa satu pun jalur yang bisa melempar: yang
 * memanggilnya adalah tombol Simpan, saklar campaign, dan gate/ungate. Sebuah log yang menggagalkan
 * operasi yang dicatatnya adalah kerusakan yang jauh lebih mahal daripada baris yang hilang.
 */
export function logActivity(input) {
  try {
    const store = localStore();
    if (!store) return;
    appendBuffer(store, activityEvent({ ...input, actor: input.actor || actor }));
  } catch {
    // Sengaja diam.
  }
}

export function logPageView(path) {
  if (!path || path === lastPage) return;
  lastPage = path;
  logActivity({ category: "navigation", action: "page_view", page: path });
}

/**
 * Kirim isi penyangga ke server kontrol.
 *
 * Sepotong demi sepotong (`ACTIVITY_BATCH`), dan potongan yang berhasil dibuang SEBELUM potongan
 * berikutnya berangkat: penyangga yang menumpuk seminggu karena server mati tidak boleh berangkat
 * sebagai satu request raksasa yang pasti ditolak lalu dicoba lagi utuh selamanya.
 *
 * Kegagalan tidak membuang apa pun. Itu inti dari "dicatat dulu di lokal": baris bertahan di
 * perangkat sampai ada yang benar-benar menerimanya.
 */
export async function flushActivity() {
  const store = localStore();
  if (!store || flushing) return { sent: 0 };
  // Tanpa server kontrol tidak ada jalur lain, dan itu disengaja — lihat catatan di
  // `sendActivityLogs`. Penyangga tetap diisi; ia berangkat sendiri begitu servernya ada.
  if (!CONTROL_API_ENABLED) return { sent: 0 };
  // Sesi yang sudah berakhir tidak punya token untuk mengirim apa pun. Barisnya menunggu login
  // berikutnya di perangkat ini.
  if (!actor) return { sent: 0 };
  if (typeof navigator !== "undefined" && navigator.onLine === false) return { sent: 0 };

  flushing = true;
  let sent = 0;
  try {
    for (;;) {
      const batch = nextBatch(store, ACTIVITY_BATCH);
      if (batch.length === 0) break;
      await sendActivityLogs(batch);
      dropSent(
        store,
        batch.map((row) => row.id),
      );
      sent += batch.length;
      if (batch.length < ACTIVITY_BATCH) break;
    }
  } catch {
    // Server mati, jaringan putus, token kedaluwarsa — semuanya berarti hal yang sama di sini:
    // jangan buang apa pun, coba lagi lima menit lagi.
  } finally {
    flushing = false;
  }
  return { sent };
}

export function pendingActivityCount() {
  const store = localStore();
  return store ? readBuffer(store).length : 0;
}

/**
 * Tiap panggilan ke server kontrol jadi satu baris jejak.
 *
 * Dipasang di sini, di modul yang memang sudah menjadi pemakai `controlApi` — bukan di dalam
 * `controlApi` yang mengimpor pencatat, yang akan membuat lingkaran impor.
 *
 * Yang lewat jalur ini justru operasi yang paling perlu tercatat dan paling mudah luput: gate dan
 * ungate campaign Keitaro, saklar on/off campaign Meta, dan penulisan pengaturan iklan ke armada
 * situs WordPress. Tidak satu pun menyentuh RTDB dari browser, jadi pencatat yang cuma mengintip
 * penulisan RTDB akan melewatkan ketiganya sambil tampak lengkap.
 */
observeControlRequests(({ path, method, outcome }) => {
  logActivity({
    category: "operation",
    action: `control:${method.toLowerCase()}`,
    page: typeof window === "undefined" ? "" : window.location.pathname,
    target: path,
    detail: { hasil: outcome },
    status: outcome === "ok" ? "ok" : "failed",
  });
});

// Jadwal lima menitan. Dipasang sekali oleh `useActivityLogger`; pemasangan kedua (React StrictMode
// merender efek dua kali di dev) tidak menghasilkan dua jadwal.
export function startActivityFlush(intervalMs = ACTIVITY_FLUSH_MS) {
  if (timer) return () => {};
  timer = setInterval(flushActivity, intervalMs);
  return () => {
    clearInterval(timer);
    timer = null;
  };
}
