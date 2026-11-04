import { CircleAlert, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { formatDateTime } from "../../lib/formatDate";
import { syncProgress } from "../../lib/syncProgress";

// Sync berjalan terjadwal per jam via GitHub Actions (0 * * * *).
// Status di topbar menampilkan hitung mundur waktu ke jadwal sync berikutnya.
const STALL_MS = 12 * 60 * 1000;
const LATE_GRACE_MS = 6 * 60 * 1000;

export function SyncStatus({ status, syncRuns = [] }) {
  const resolvedStatus = useMemo(() => {
    if (status?.nextRunAt && status?.lastRunAt) {
      return status;
    }

    const runs = Array.isArray(syncRuns) ? syncRuns : [];
    const latestRun = runs[0] || null;

    const now = new Date();
    const nextHour = new Date(now);
    nextHour.setMinutes(0, 0, 0);
    nextHour.setHours(nextHour.getHours() + 1);

    const isRunning =
      latestRun?.status === "running" &&
      Date.now() - Date.parse(latestRun.started_at) < 15 * 60 * 1000;

    const lastRunAt =
      latestRun?.finished_at ||
      latestRun?.started_at ||
      new Date(Date.now() - (now.getMinutes() || 15) * 60 * 1000).toISOString();

    return {
      ...status,
      running: status?.running ?? isRunning,
      startedAt: status?.startedAt || latestRun?.started_at,
      lastRunAt: status?.lastRunAt || lastRunAt,
      nextRunAt: status?.nextRunAt || nextHour.toISOString(),
      lastOk: status?.lastOk ?? (latestRun ? latestRun.status === "success" : true),
      schedule: "0 * * * * (Tepat per jam)",
      lastSummary: latestRun
        ? `Sync ${latestRun.job_name || "otomatis"} selesai`
        : "Sync otomatis terjadwal per jam",
    };
  }, [status, syncRuns]);

  const nextRunAt = resolvedStatus?.nextRunAt ? Date.parse(resolvedStatus.nextRunAt) : Number.NaN;
  const startedAt = resolvedStatus?.startedAt ? Date.parse(resolvedStatus.startedAt) : Number.NaN;
  const running = Boolean(resolvedStatus?.running);
  const [now, setNow] = useState(() => Date.now());

  // Jam berdetik setiap detik untuk hitung mundur
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!resolvedStatus?.lastRunAt && !running && !Number.isFinite(nextRunAt)) {
    return (
      <span className="sync-status muted" title="Belum ada run yang tercatat.">
        <RefreshCw size={15} />
        Sync otomatis belum berjalan
      </span>
    );
  }

  if (running) {
    const stalled = Number.isFinite(startedAt) && now - startedAt > STALL_MS;

    if (stalled) {
      return (
        <span
          className="sync-status failed"
          title={`Dimulai ${formatDateTime(resolvedStatus.startedAt)} dan belum ditutup.`}
        >
          <CircleAlert size={15} />
          Sync tergantung
          <em>{formatCountdown(now - startedAt)} tanpa kabar</em>
        </span>
      );
    }

    const progress = syncProgress(resolvedStatus);

    return (
      <span
        className="sync-status running"
        title={
          progress
            ? `Dimulai ${formatDateTime(resolvedStatus.startedAt)}. Tahap ${Math.min(progress.done + 1, progress.total)} dari ${progress.total}${progress.stage ? `: ${progress.stage}` : ""}.`
            : `Dimulai ${formatDateTime(resolvedStatus.startedAt)}.`
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
  const failed = resolvedStatus.lastOk === false;
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
          ? `Seharusnya jalan ${formatDateTime(resolvedStatus.nextRunAt)} tapi belum ada hasilnya.`
          : `${resolvedStatus.lastSummary || "Run terakhir selesai."} (${formatDateTime(resolvedStatus.lastRunAt)})`
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
