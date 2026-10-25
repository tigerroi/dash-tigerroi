/**
 * Progres tahap sebuah run sync, dibaca badge "Syncing..." di topbar.
 *
 * Sisi sync menulis `dashboard/syncStatus.progress` = `{ done, total, stage }` tiap kali sebuah
 * tahap dimulai (lihat `reportProgress` di `functions/scheduled-sync.js`). Di sini ia cuma
 * dibersihkan dan dijadikan persen — tidak ada satu pun tebakan tentang berapa lama tahap
 * berikutnya, karena tidak ada yang tahu: laporan GAM di-poll sampai semenit per network dan run
 * yang sama bisa 40 detik atau 6 menit.
 *
 * **Yang tidak diketahui bukan nol**, aturan yang sama dengan earning di baris ROI. Run yang
 * ditembakkan versi sync sebelum fitur ini ada tidak membawa `progress` sama sekali, dan air
 * setinggi 0% untuk run yang sudah setengah jalan adalah kabar yang salah — bukan kabar yang
 * belum lengkap. Karena itu jawabannya `null`, dan badge menggambar dirinya seperti dulu.
 */
export function syncProgress(status) {
  const progress = status?.progress;
  const total = Number(progress?.total);
  const done = Number(progress?.done);

  if (!Number.isFinite(total) || total <= 0) return null;
  if (!Number.isFinite(done) || done < 0) return null;

  // Dijepit, bukan dipercaya: `done` yang melewati `total` (bentuk lama, atau run yang tahapnya
  // bertambah di tengah jalan) menghasilkan air yang melewati tepi badge-nya sendiri.
  const reached = Math.min(done, total);

  return {
    done: reached,
    total,
    // Dibulatkan ke bawah supaya 7 dari 8 tahap tidak berbunyi 100% untuk run yang masih meminta
    // laporan terakhirnya.
    percent: Math.floor((reached / total) * 100),
    stage: typeof progress.stage === "string" ? progress.stage : "",
  };
}
