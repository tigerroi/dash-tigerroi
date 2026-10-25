import { CircleAlert, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { formatDateTime } from "../../lib/formatDate";
import { syncProgress } from "../../lib/syncProgress";

// Sync tidak lagi dipicu tombol — ia jalan sendiri pada jadwalnya (functions/sync-run.mjs, dijadwalkan
// Cloud Function scheduledSync atau cron server kontrol untuk instansi tanpa Cloud Functions).
// Yang menggantikan tombolnya adalah ini: satu tempat yang mengatakan sync sedang jalan, atau
// berapa lama lagi. Tanpa itu, halaman yang datanya tidak berubah tidak bisa dibedakan dari sync
// yang mati.
//
// Tujuh keadaan, dan tidak satu pun berpura-pura tahu lebih dari yang diketahui:
//   running                -> "Syncing..."
//   running tapi kelamaan  -> "Sync tergantung" (run-nya kena timeout: statusnya tidak pernah
//                             ditutup, jadi "Syncing..." akan menyala selamanya)
//   ada nextRunAt          -> hitung mundur
//   baru lewat            -> "Sync sebentar lagi" (Scheduler membulatkan ke menit dan boleh
//                             terlambat sedikit — lewat 1-2 menit belum berarti apa-apa)
//   lewat > 6 menit       -> "Jadwal terlewat Xm" — jadwalnya ADA, run-nya yang tidak terjadi
//                             (function gagal start sebelum sempat menulis status, Scheduler error,
//                             deploy yang mendarat persis di menit tembakannya)
//   nextRunAt tidak terbaca-> "Jadwal tidak terbaca" (bentuk cron yang tidak bisa dihitung)
//   belum pernah           -> "Sync otomatis belum berjalan"
//
// "Menunggu jadwal" dulu dipakai untuk tiga keadaan terakhir sekaligus, dan itu terbaca seperti
// "belum ada jadwalnya" — padahal jadwalnya ada dan justru sedang terlewat.
const STALL_MS = 12 * 60 * 1000;

// Cloud Scheduler membulatkan waktu tembaknya ke menit dan boleh terlambat sedikit. Lewat beberapa
// menit karena itu belum tentu masalah — yang perlu diberitahukan adalah yang lewat cukup lama
// untuk berarti run-nya memang tidak terjadi.
//
// Jadwalnya sendiri cron jam dinding ("5 * * * *"), bukan interval: bentuk interval dihitung ulang
// dari nol tiap job-nya diperbarui, jadi tiap deploy membuang satu siklus dan panel ini menulis
// "terlewat" sepanjang sisa jam itu — jadwalnya sehat, tembakannya saja yang digeser tanpa ada
// yang memberi tahu sisi UI.
const LATE_GRACE_MS = 6 * 60 * 1000;

export function SyncStatus({ status }) {
  const nextRunAt = status?.nextRunAt ? Date.parse(status.nextRunAt) : Number.NaN;
  const startedAt = status?.startedAt ? Date.parse(status.startedAt) : Number.NaN;
  const running = Boolean(status?.running);
  const [now, setNow] = useState(() => Date.now());

  // Jam berdetik hanya saat ada yang dihitung — kecuali saat run berjalan, karena batas "terlalu
  // lama" juga perlu dihitung. Menit sudah cukup untuk keduanya kalau tidak sedang menghitung
  // mundur, tapi satu interval sederhana lebih murah daripada dua aturan.
  useEffect(() => {
    if (!running && !Number.isFinite(nextRunAt)) {
      return undefined;
    }

    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running, nextRunAt]);

  if (!status?.lastRunAt && !running) {
    return (
      <span className="sync-status muted" title="Belum ada run yang tercatat.">
        <RefreshCw size={15} />
        Sync otomatis belum berjalan
      </span>
    );
  }

  if (running) {
    // Run yang kena timeout dibunuh di tengah jalan, jadi `running` tidak pernah dikembalikan ke
    // false. Tanpa batas ini topbar akan menulis "Syncing..." sampai run berikutnya berhasil.
    const stalled = Number.isFinite(startedAt) && now - startedAt > STALL_MS;

    if (stalled) {
      return (
        <span
          className="sync-status failed"
          title={`Dimulai ${formatDateTime(status.startedAt)} dan belum ditutup. Biasanya berarti run-nya kena batas waktu (9 menit) sebelum sempat mencatat hasilnya.`}
        >
          <CircleAlert size={15} />
          Sync tergantung
          <em>{formatCountdown(now - startedAt)} tanpa kabar</em>
        </span>
      );
    }

    // Air yang naik: lebarnya tahap yang sudah selesai, riaknya berjalan kiri->kanan. Ikon yang
    // berputar cuma mengatakan "masih hidup"; run penuh butuh beberapa menit, dan tanpa satu pun
    // angka yang bergerak, badge yang sama di menit ketujuh tidak bisa dibedakan dari run yang
    // menggantung. Ukurannya inline karena ia turunan DATA (tahap ke berapa), bukan nilai tema —
    // pola yang sama dengan jeda animasi kartu di panel Kalender.
    const progress = syncProgress(status);

    return (
      <span
        className="sync-status running"
        title={
          progress
            ? `Dimulai ${formatDateTime(status.startedAt)}. Tahap ${Math.min(progress.done + 1, progress.total)} dari ${progress.total}${progress.stage ? `: ${progress.stage}` : ""}.`
            : `Dimulai ${formatDateTime(status.startedAt)}.`
        }
      >
        {progress ? (
          <span
            className="sync-water"
            style={{ width: `${progress.percent}%` }}
            aria-hidden="true"
          />
        ) : null}
        <RefreshCw size={15} className="icon-spin" />
        <span className="sync-label">Syncing...</span>
        {progress ? (
          <em>
            {progress.done}/{progress.total}
          </em>
        ) : null}
      </span>
    );
  }

  const remaining = nextRunAt - now;
  // Kegagalan run terakhir ikut terlihat di sini, bukan hanya di halaman Settings: hitung mundur
  // yang tetap tenang setelah sync gagal adalah kabar yang menyesatkan.
  const failed = status.lastOk === false;
  const due = Number.isFinite(nextRunAt) && remaining <= 0;
  const late = due && -remaining > LATE_GRACE_MS;
  let label = "Jadwal tidak terbaca";
  if (Number.isFinite(nextRunAt) && remaining > 0) {
    label = `Sync berikutnya ${formatCountdown(remaining)}`;
  } else if (late) {
    label = `Jadwal terlewat ${formatCountdown(-remaining)}`;
  } else if (due) {
    label = "Sync sebentar lagi";
  }

  return (
    <span
      className={`sync-status ${failed ? "failed" : ""} ${late && !failed ? "late" : ""}`}
      title={
        late
          ? `Seharusnya jalan ${formatDateTime(status.nextRunAt)} (${status.schedule || "jadwal tidak diketahui"}) tapi belum ada hasilnya. Periksa log sync (Cloud Function scheduledSync, atau log server kontrol untuk instansi tanpa Cloud Functions): run yang gagal login atau gagal menulis status berhenti sebelum sempat meninggalkan jejak di sini.`
          : `${status.lastSummary || "Run terakhir selesai."} (${formatDateTime(status.lastRunAt)})`
      }
    >
      {failed || late ? <CircleAlert size={15} /> : <RefreshCw size={15} />}
      {label}
      {failed && <em>run terakhir gagal</em>}
    </span>
  );
}

function formatCountdown(ms) {
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;

  if (minutes >= 60) {
    return `${Math.floor(minutes / 60)}j ${String(minutes % 60).padStart(2, "0")}m`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
