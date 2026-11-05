import { CircleAlert, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { formatDateTime } from "../../lib/formatDate";
import { syncProgress } from "../../lib/syncProgress";

// Sync berjalan terjadwal per jam via GitHub Actions (0 * * * *).
// Status di topbar menampilkan hitung mundur waktu ke jadwal sync berikutnya.
const STALL_MS = 5 * 60 * 1000;
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

    const latestStartedAt = latestRun?.startedAt || latestRun?.started_at;
    const latestFinishedAt = latestRun?.finishedAt || latestRun?.finished_at;
    const startedMs = latestStartedAt ? Date.parse(latestStartedAt) : Number.NaN;

    const isRunning =
      latestRun?.status === "running" &&
      Number.isFinite(startedMs) &&
      Date.now() - startedMs < 5 * 60 * 1000;

    const lastRunAt =
      latestFinishedAt ||
      latestStartedAt ||
      new Date(Date.now() - (now.getMinutes() || 15) * 60 * 1000).toISOString();

    // Kumpulkan status run terbaru untuk setiap job (sync-meta, sync-gam, sync-country-roi, sync-keitaro)
    // Catatan: Kunci di frontend bisa camelCase (jobName) atau snake_case (job_name) dari database
    const latestByJob = new Map();
    for (const r of runs) {
      const job = r?.jobName || r?.job_name;
      if (job && !latestByJob.has(job)) {
        latestByJob.set(job, r);
      }
    }

    // Modul inti TigerROI adalah Meta Ads (sync-meta) dan GAM (sync-gam)
    const coreJobs = ["sync-meta", "sync-gam"];
    const coreRuns = coreJobs.map((j) => latestByJob.get(j)).filter(Boolean);

    let isLastOk = true;
    if (coreRuns.length > 0) {
      // Jika setidaknya salah satu modul utama sukses dan tidak semua modul utama gagal, anggap sinkronisasi berhasil
      const hasCoreSuccess = coreRuns.some((r) => r.status === "success");
      const hasAllCoreFailed = coreRuns.every((r) => r.status === "failed");
      isLastOk = hasCoreSuccess || !hasAllCoreFailed;
    } else {
      // Ambil run terakhir yang sudah selesai (bukan status running)
      const finishedRun = runs.find((r) => r.status === "success" || r.status === "failed");
      if (finishedRun) {
        isLastOk = finishedRun.status === "success";
      } else if (latestRun) {
        isLastOk = latestRun.status !== "failed";
      }
    }

    const jobDisplayName = latestRun?.jobName || latestRun?.job_name || "otomatis";

    return {
      ...status,
      running: status?.running ?? isRunning,
      startedAt: status?.startedAt || latestStartedAt,
      lastRunAt: status?.lastRunAt || lastRunAt,
      nextRunAt: status?.nextRunAt || nextHour.toISOString(),
      lastOk: status?.lastOk ?? isLastOk,
      schedule: "0 * * * * (Tepat per jam)",
      lastSummary: latestRun
        ? `Sync ${jobDisplayName} selesai`
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
    label = `Sync berikutnya dalam ${formatCountdown(remaining)}`;
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

  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}
