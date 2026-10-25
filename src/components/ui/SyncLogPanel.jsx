import { useMemo, useState } from "react";
import { useTablePagination } from "../../hooks/useTablePagination";
import { formatDateTime } from "../../lib/formatDate";
import { TablePagination } from "./TablePagination";

// Log tiap run sync otomatis. Sync ini jalan tanpa ada yang menonton — tidak ada toast, tidak ada
// tombol yang berhenti berputar — jadi ini satu-satunya tempat kegagalan jam tiga pagi bisa
// terlihat, lengkap dengan tahap mana yang gagal dan alasannya.
//
// Baris yang gagal terbuka sendiri. Yang berhasil bisa dibuka kalau memang mau dilihat rinciannya;
// memaksa semuanya terbuka membuat yang penting tenggelam di antara yang normal.
//
// `onRunStage` (admin, server kontrol) menambah tombol "Jalankan ulang" di tiap tahap: laporan yang
// gagal pukul 02:00 tidak perlu menunggu sejam penuh. Mati selama sebuah run berjalan.
export function SyncLogPanel({ runs, status, loading = false, error = null, onRunStage }) {
  const rows = useMemo(() => toRows(runs), [runs]);
  const pagination = useTablePagination(rows, 10);
  const failed = rows.filter((row) => !row.ok).length;

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>Log Sync Otomatis</h2>
          <p>
            {loading
              ? "Memuat..."
              : rows.length === 0
                ? "Belum ada run yang tercatat. Baris pertama muncul setelah sync terjadwal jalan."
                : `${rows.length} run tersimpan${failed ? `, ${failed} di antaranya gagal` : ", semuanya berhasil"}.`}
          </p>
        </div>
        {status?.schedule && <span className="badge neutral">Jadwal: {status.schedule}</span>}
      </div>

      {error && (
        <p className="notice-alert">
          Log gagal dibaca: {error.message}. Log kini tersimpan di server kontrol — pastikan ia
          terjangkau dan Anda login sebagai admin.
        </p>
      )}

      {rows.length > 0 && (
        <>
          <div className="sync-log-stack">
            {pagination.visibleItems.map((run) => (
              <SyncRunRow
                busy={Boolean(status?.running)}
                key={run.id}
                onRunStage={onRunStage}
                run={run}
              />
            ))}
          </div>
          <TablePagination
            {...pagination}
            onPageChange={pagination.setPage}
            onPageSizeChange={pagination.setPageSize}
            label="run"
          />
        </>
      )}
    </section>
  );
}

function SyncRunRow({ run, onRunStage, busy }) {
  const [open, setOpen] = useState(!run.ok);

  return (
    <article className={`sync-log-run ${run.ok ? "ok" : "failed"}`}>
      <button className="sync-log-head" onClick={() => setOpen((value) => !value)} type="button">
        <span className={`badge ${run.ok ? "success" : "danger"}`}>
          {run.ok ? "Berhasil" : "Gagal"}
        </span>
        <strong>{run.startedLabel}</strong>
        <small>{run.durationSec}s</small>
        <span className="sync-log-summary">{run.summary}</span>
        <span className="sync-log-toggle">{open ? "−" : "+"}</span>
      </button>

      {open && (
        <div className="sync-log-stages">
          {run.stages.length === 0 ? (
            <span className="muted-line">Tidak ada tahap yang tercatat.</span>
          ) : (
            run.stages.map((stage) => (
              <div className={`sync-log-stage ${stage.ok ? "" : "failed"}`} key={stage.name}>
                <span className={`badge ${stage.ok ? "success" : "danger"}`}>
                  {stage.ok ? "ok" : "gagal"}
                </span>
                <strong>{stage.name}</strong>
                {/* Alasan kegagalan ditampilkan apa adanya, tanpa diterjemahkan jadi kalimat
                    ramah: yang membaca halaman ini sedang mencari sebabnya, dan pesan asli Meta
                    atau GAM adalah satu-satunya petunjuk yang tersisa. */}
                <span>{stage.detail || "-"}</span>
                {onRunStage && (
                  <button
                    className="ghost-button"
                    disabled={busy}
                    onClick={() => onRunStage(stage.name)}
                    title={busy ? "Sync sedang berjalan." : `Jalankan tahap ${stage.name} sekarang`}
                    type="button"
                  >
                    Jalankan ulang
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </article>
  );
}

// Server mengembalikan array run (dulu RTDB objek berkunci stempel waktu — bentuk objek masih
// diterima demi aman). Diurutkan menurun supaya run terbaru di atas — yang dicari orang saat membuka
// halaman ini adalah yang barusan, bukan yang paling lama.
function toRows(runs) {
  const items = Array.isArray(runs)
    ? runs
    : Object.entries(runs || {}).map(([id, run]) => ({ id, ...run }));

  return items
    .filter(Boolean)
    .map((run) => ({
      id: run.id || run.startedAt,
      ok: run.ok !== false,
      durationSec: Number(run.durationSec || 0),
      summary: run.summary || "",
      startedAt: run.startedAt || "",
      startedLabel: formatDateTime(run.startedAt),
      stages: Array.isArray(run.stages) ? run.stages : Object.values(run.stages || {}),
    }))
    .sort((left, right) => String(right.startedAt).localeCompare(String(left.startedAt)));
}
