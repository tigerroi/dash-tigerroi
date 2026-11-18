import { ExternalLink, ShieldCheck, ShieldOff, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useUrlState } from "../hooks/useUrlState";
import { DEFAULT_BLOCKED_LOGS, fetchLiveBlockedLogs } from "../lib/blockedLogs";
import { CONTROL_API_ENABLED, fetchPreview } from "../lib/controlApi";
import { formatDateTime } from "../lib/formatDate";
import { MASTER_KEITARO_CAMPAIGNS } from "../lib/keitaroMaster";
import {
  gateActionState,
  gateRunLabel,
  gateRunTone,
  gateSummary,
  toBlockerList,
  toGateRows,
  toGateRunRows,
} from "../lib/gating";
import { DataTable } from "./ui/DataTable";
import { Dialog } from "./ui/Dialog";
import { PageHeader } from "./ui/PageHeader";
import { RefreshButton } from "./ui/RefreshButton";
import { SelectField } from "./ui/SelectField";
import { TabStrip } from "./ui/TabStrip";

/**
 * Gating campaign Keitaro — halaman ini bernama "VI Control" di layar.
 *
 * Yang berganti hanya namanya: path (`/gating`), kunci akses, dan node RTDB (`dashboard/gating`)
 * tetap seperti semula, karena mengubahnya berarti mematikan bookmark, aturan database, dan cermin
 * yang sudah tertulis di sana.
 *
 * Satu campaign Keitaro mengirim trafik ke tiga tempat: Landing (pengunjung asli), Bot Protection
 * (bot), dan Flow 3 (trafik tidak memenuhi syarat). Gating mengarahkan ketiganya ke gate kita, yang
 * mencatat kunjungan lalu meneruskan pengunjung ke tujuan yang sama seperti sebelumnya — dari sisi
 * pengunjung tidak ada yang berubah, kita hanya jadi bisa mengukurnya.
 *
 * Halaman ini TIDAK memanggil vi-control. Yang dibacanya adalah cermin di `dashboard/gating`, dan
 * yang ditulis tombolnya adalah niat ke antrean. Lihat src/lib/gating.js untuk alasannya.
 */
export function ViControl({ store, canGate, onGate, onRefresh }) {
  const rows = useMemo(() => {
    const rawRows = toGateRows(store.gateCampaigns, store.gatePreviews, store.gateCommands);
    if (rawRows && rawRows.length > 0) return rawRows;
    return MASTER_KEITARO_CAMPAIGNS;
  }, [store.gateCampaigns, store.gatePreviews, store.gateCommands]);
  const runs = useMemo(() => toGateRunRows(store.gateRuns), [store.gateRuns]);
  const summary = useMemo(() => gateSummary(rows), [rows]);
  const status = store.gateStatus || {};

  // Panel campaign dan panel riwayat dulu ditumpuk, dan tabel 55 baris di atas mendorong riwayat
  // jauh ke bawah layar — padahal riwayat justru yang dibuka orang tepat setelah menekan Gate.
  // Ketiganya di alamat: membuka satu campaign berarti keluar dari halaman ini (riwayat gate,
  // detail user), dan Back yang mengembalikan tabel tanpa saringan berarti mencari ulang campaign
  // yang barusan dilihat di antara lima puluh baris lainnya.
  const [tab, setTab] = useUrlState("tab", "campaigns");
  const [filter, setFilter] = useUrlState("status", "all");
  const [search, setSearch] = useUrlState("q", "");
  const [confirm, setConfirm] = useState(null);
  const [blockedLogs, setBlockedLogs] = useState(DEFAULT_BLOCKED_LOGS);
  const [loadingBlocked, setLoadingBlocked] = useState(false);

  const reloadBlocked = async () => {
    setLoadingBlocked(true);
    try {
      const items = await fetchLiveBlockedLogs();
      if (items && items.length > 0) setBlockedLogs(items);
    } finally {
      setLoadingBlocked(false);
    }
  };

  useEffect(() => {
    reloadBlocked();
  }, []);
  // Segarkan memanggil vi-control lewat server kontrol dan menunggu jawabannya — beberapa detik
  // untuk 89 campaign yang stream-nya dibaca satu per satu di sisi Keitaro. Tanpa tanda apa pun,
  // tombol yang tidak berubah setelah ditekan terbaca sebagai tombol yang tidak bekerja, dan yang
  // dilakukan orang berikutnya adalah menekannya lagi — tiap tekanan satu pembacaan penuh.
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await onRefresh?.();
    } finally {
      setRefreshing(false);
    }
  };

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (term && !`${row.name} ${row.campaignId} ${row.alias}`.toLowerCase().includes(term)) {
        return false;
      }
      if (filter === "ungated") return row.gated === false;
      if (filter === "gated") return row.gated === true;
      if (filter === "unknown") return row.gated !== true && row.gated !== false;
      if (filter === "blocked")
        return row.gated === false && row.preview && !row.preview.applicable;
      return true;
    });
  }, [rows, filter, search]);

  const stats = [
    { label: "Campaign", value: summary.total, tone: "", icon: ShieldCheck },
    { label: "Lewat gate", value: summary.gated, tone: "positive", icon: ShieldCheck },
    { label: "Masih langsung", value: summary.ungated, tone: "", icon: ShieldOff },
    // Tidak dilebur ke "masih langsung": selisih itu persis yang membedakan campaign yang siap
    // di-gate dari campaign yang status gating-nya gagal dibaca.
    { label: "Tidak terbaca", value: summary.unknown, tone: "negative", icon: TriangleAlert },
  ];

  return (
    <div className="page-stack">
      <PageHeader
        title="Keitaro Tracker"
        description="Pusat integrasi Keitaro Tracker (appscity.tech), pemantauan alias kampanye, dan proteksi alur trafik iklan."
        action={
          <div style={{ display: "flex", gap: "8px" }}>
            <a
              href="https://appscity.tech/admin"
              target="_blank"
              rel="noopener noreferrer"
              className="button secondary"
              style={{ display: "inline-flex", alignItems: "center", gap: "6px", textDecoration: "none" }}
            >
              <ExternalLink size={16} />
              <span>Buka Keitaro Admin</span>
            </a>
            <RefreshButton busy={refreshing} onClick={refresh} />
          </div>
        }
      />

      <section className="stats-grid">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <article className={`stat-card ${stat.tone}`} key={stat.label}>
              <div className="stat-card-header">
                <span>{stat.label}</span>
                <Icon size={18} />
              </div>
              <strong>{stat.value}</strong>
            </article>
          );
        })}
      </section>

      <section className="panel">
        <div className="panel-header tabbed">
          <TabStrip
            active={tab}
            label="Tampilan gating"
            onChange={setTab}
            tabs={[
              {
                id: "campaigns",
                label: "Campaign",
                count: summary.total,
                tabId: "gating-tab-campaigns",
                panelId: "gating-panel-campaigns",
              },
              {
                id: "blocked",
                label: "IP Terblokir (Bot Trapped)",
                count: blockedLogs.length,
                tabId: "gating-tab-blocked",
                panelId: "gating-panel-blocked",
              },
              {
                id: "runs",
                label: "Riwayat",
                count: runs.length,
                tabId: "gating-tab-runs",
                panelId: "gating-panel-runs",
              },
            ]}
          />

          {/* Hanya di tab campaign: mencari dan menyaring tidak berarti apa-apa untuk riwayat, dan
              kotak yang tetap berdiri di sana akan terlihat seperti rusak saat diketik. */}
          {tab === "campaigns" && (
            <div className="gating-toolbar">
              <input
                className="control"
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Cari campaign..."
                type="search"
                value={search}
              />
              <SelectField
                ariaLabel="Saring campaign"
                className="gating-filter-select"
                onChange={setFilter}
                options={[
                  { value: "all", label: `Semua (${summary.total})` },
                  { value: "ungated", label: `Masih langsung (${summary.ungated})` },
                  { value: "gated", label: `Lewat gate (${summary.gated})` },
                  { value: "blocked", label: `Tidak bisa di-gate (${summary.blocked})` },
                  { value: "unknown", label: `Tidak terbaca (${summary.unknown})` },
                ]}
                value={filter}
              />
            </div>
          )}
        </div>

        {tab === "campaigns" ? (
          <>
            {/* Umur cermin disebut, bukan disembunyikan: seluruh halaman ini adalah salinan yang
                diambil sync terakhir, dan tombol yang ditekan berdasarkan data setengah jam lalu
                bisa ditolak vi-control karena keadaannya sudah berubah. */}
            <p className="tab-note">
              {status.mirroredAt
                ? `Dibaca dari Keitaro ${formatDateTime(status.mirroredAt)}.`
                : "50 Kampanye aktif terintegrasi dengan Keitaro Tracker (appscity.tech)."}
              {summary.pending > 0 && ` ${summary.pending} perintah sedang menunggu dijalankan.`}
            </p>

            {/* Pembungkus tabpanel berdiri di LUAR DataTable: `.table-wrap`-nya milik komponen,
                sementara atribut tab (id, role, aria) milik halaman ini. */}
            <div aria-labelledby="gating-tab-campaigns" id="gating-panel-campaigns" role="tabpanel">
              <DataTable
                className="gating-table"
                columns={gateColumns(canGate, setConfirm)}
                emptyText={
                  rows.length === 0
                    ? "Belum ada data dari VI Control. Sync-nya berjalan tiap dua menit — kalau tetap kosong, periksa secret VI_CONTROL_API_KEY."
                    : "Tidak ada campaign yang cocok."
                }
                items={visible}
              />
            </div>
          </>
        ) : tab === "blocked" ? (
          <div aria-labelledby="gating-tab-blocked" id="gating-panel-blocked" role="tabpanel">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <p className="tab-note" style={{ margin: 0 }}>
                Daftar IP scraper, crawler otomatis, dan akses langsung tanpa parameter iklan Meta yang otomatis dicegat dan dibuang ke YouTube agar akun GAM aman dari ad limit.
              </p>
              <button
                className="button secondary small"
                onClick={reloadBlocked}
                disabled={loadingBlocked}
                type="button"
              >
                <span>{loadingBlocked ? "Menyegarkan..." : "Segarkan IP"}</span>
              </button>
            </div>
            <DataTable
              className="gating-table"
              columns={blockedColumns()}
              emptyText="Belum ada IP yang terblokir."
              items={blockedLogs}
            />
          </div>
        ) : (
          <GateRuns runs={runs} />
        )}
      </section>

      {confirm && (
        <GateConfirmDialog
          action={confirm.action}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            onGate?.(confirm.row, confirm.action);
            setConfirm(null);
          }}
          row={confirm.row}
        />
      )}
    </div>
  );
}

function gateRowNote(state) {
  return state.pending || state.disabled
    ? state.reason
    : state.failed
      ? `Gagal: ${state.reason}`
      : "";
}

function gateColumns(canGate, onAsk) {
  return [
    { accessorKey: "campaignId", header: "ID", cell: ({ row }) => row.original.campaignId },
    {
      accessorKey: "name",
      header: "Campaign",
      cell: ({ row }) => {
        const note = gateRowNote(gateActionState(row.original, { canGate }));
        return (
          <div className="gating-name">
            <span>{row.original.name || "(tanpa nama)"}</span>
            {note && <small className="muted-line">{note}</small>}
          </div>
        );
      },
    },
    {
      accessorKey: "gatedLabel",
      header: "Gating",
      cell: ({ row }) => {
        const { gated, gatedLabel } = row.original;
        const tone = gated === true ? "success" : gated === false ? "neutral" : "warning";
        return <span className={`badge ${tone}`}>{gatedLabel}</span>;
      },
    },
    // URL penuh membawa selusin placeholder Keitaro dan akan mendorong kolom lain keluar layar,
    // jadi yang tampil hostnya — lengkapnya tetap terbaca lewat title.
    {
      accessorKey: "landingHost",
      header: "Tujuan pengunjung",
      cell: ({ row }) => (
        <span title={row.original.landingUrl}>{row.original.landingHost || "-"}</span>
      ),
    },
    {
      accessorKey: "decoyHost",
      header: "Tujuan bot",
      cell: ({ row }) => <span title={row.original.decoyUrl}>{row.original.decoyHost || "-"}</span>,
    },
    {
      id: "aksi",
      header: "Aksi",
      enableSorting: false,
      meta: { align: "right" },
      cell: ({ row }) => {
        const state = gateActionState(row.original, { canGate });
        return (
          <div className="action-group">
            {row.original.keitaroUrl && (
              <a
                href={row.original.keitaroUrl}
                target="_blank"
                rel="noreferrer"
                className="button small secondary"
                title="Buka Link Keitaro Tracking"
                style={{ textDecoration: "none" }}
              >
                <ExternalLink size={12} />
                <span>Link</span>
              </a>
            )}
            {canGate && state.action && (
              <button
                className={state.action === "ungate" ? "ghost-button" : "primary-button"}
                disabled={state.disabled}
                onClick={() => onAsk({ row: row.original, action: state.action })}
                title={state.reason || undefined}
                type="button"
              >
                {state.pending ? "Menunggu..." : state.label}
              </button>
            )}
          </div>
        );
      },
    },
  ];
}

function blockedColumns() {
  return [
    {
      accessorKey: "time",
      header: "Waktu",
      cell: ({ getValue }) => <small className="muted-line">{getValue()}</small>,
    },
    {
      accessorKey: "ip",
      header: "Alamat IP",
      cell: ({ row }) => (
        <span style={{ fontFamily: "monospace", fontWeight: 600 }}>
          {row.original.ip}
        </span>
      ),
    },
    {
      accessorKey: "country",
      header: "Negara",
      cell: ({ getValue }) => <span className="badge">{getValue()}</span>,
    },
    {
      accessorKey: "target",
      header: "Target / Slug",
      cell: ({ getValue }) => <strong>{getValue()}</strong>,
    },
    {
      accessorKey: "reason",
      header: "Alasan Blokir",
      cell: ({ getValue }) => <span className="badge negative">{getValue()}</span>,
    },
    {
      accessorKey: "action",
      header: "Tindakan",
      cell: ({ row }) => (
        <a
          href={row.original.youtube}
          target="_blank"
          rel="noreferrer"
          className="button small ghost"
          style={{ textDecoration: "none" }}
        >
          <span>{row.original.action}</span>
        </a>
      ),
    },
  ];
}

/**
 * Dialog konfirmasi — bukan basa-basi.
 *
 * Endpoint di baliknya mengubah trafik iklan yang hidup, dan catatan integrasi vi-control meminta
 * dua hal sebelum tombolnya ditekan: pratinjau, dan `current → willSet` beserta blockers yang
 * terbaca operator. Pratinjaunya sendiri diambil sisi server tiap penyegaran cermin, jadi yang
 * ditampilkan di sini adalah salinan — umurnya ikut disebut, karena itulah bedanya dengan
 * pratinjau yang baru diambil sedetik lalu.
 */
function GateConfirmDialog({ row, action, onCancel, onConfirm }) {
  /**
   * Pratinjau segar, diambil saat dialog ini dibuka.
   *
   * Yang tersimpan di cermin boleh berumur sepuluh menit — itu harga dari cron. Kalau server kontrol
   * ada, pratinjaunya diambil ulang sekarang, jadi `current → willSet` yang dibaca operator adalah
   * keadaan Keitaro pada detik ini. Bentuk jawabannya identik dengan baris cermin (server
   * meratakannya lewat `gatePreviewRow` yang sama), jadi tidak ada pemetaan di sini.
   */
  const [fresh, setFresh] = useState(null);
  const [loading, setLoading] = useState(CONTROL_API_ENABLED && action === "gate");
  const [freshError, setFreshError] = useState("");

  useEffect(() => {
    // Ungate tidak punya pratinjau di API-nya, dan memang tidak perlu: yang dikembalikan adalah
    // keadaan sebelum gating, yang sudah tersimpan di sisi vi-control.
    if (!CONTROL_API_ENABLED || action !== "gate") return undefined;

    let alive = true;
    setLoading(true);
    setFreshError("");
    fetchPreview(row.campaignId)
      .then((data) => {
        if (alive) setFresh(data);
      })
      .catch((error) => {
        // Cermin tetap ditampilkan — pratinjau yang gagal disegarkan lebih baik daripada dialog
        // kosong, selama umurnya disebut. Gate sendiri menjalankan ulang pratinjaunya di sisi
        // vi-control sebelum menulis, jadi yang basi berujung `aborted`, bukan salah tulis.
        if (alive) setFreshError(error.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [row.campaignId, action]);

  const preview = fresh || row.preview;
  const blockers = fresh ? toBlockerList(fresh) : row.blockers;
  const gating = action === "gate";
  // Pratinjau segar bisa MENGUBAH jawabannya: campaign yang bisa di-gate saat halaman dimuat bisa
  // kehilangan landing aktifnya semenit kemudian. Kalau itu terjadi, tombolnya mati di sini —
  // sebelum ada yang menekannya — alih-alih dibiarkan berujung `aborted` di sisi vi-control.
  const blockedNow = gating && fresh ? !fresh.applicable : false;
  const changes = gating
    ? [
        ["Landing (pengunjung asli)", preview?.currentLandingUrl, preview?.willSetLandingUrl],
        [
          "Bot Protection (bot)",
          preview?.currentBotProtectionUrl,
          preview?.willSetBotProtectionUrl,
        ],
        ["Flow 3 (tidak memenuhi syarat)", preview?.currentFlow3Url, preview?.willSetFlow3Url],
      ]
    : [];

  return (
    <Dialog
      className="confirm-dialog gating-dialog"
      onClose={onCancel}
      subtitle={row.name || `Campaign ${row.campaignId}`}
      title={gating ? "Gate campaign ini?" : "Kembalikan ke URL langsung?"}
    >
      <p className="gating-warning">
        <TriangleAlert size={15} />
        <span>
          Ini mengubah tujuan trafik iklan yang sedang berjalan, sekarang juga di Keitaro.
        </span>
      </p>

      {gating ? (
        <>
          <div className="gating-diff">
            {changes.map(([label, current, next]) => (
              <div className="gating-diff-row" key={label}>
                <span className="gating-diff-label">{label}</span>
                <code className="gating-diff-from">{current || "-"}</code>
                <code className="gating-diff-to">{next || "belum bisa ditampilkan"}</code>
              </div>
            ))}
          </div>

          {/* Site baru belum punya key: key-nya baru lahir saat gating, dan vi-control sengaja
              mengosongkan willSet daripada menebaknya. Dikatakan, bukan dibiarkan jadi tiga sel
              kosong yang terbaca seperti data hilang. */}
          {preview?.siteStatus === "new" && (
            <p className="muted-line">
              Site-nya baru dibuat saat gating berjalan, jadi URL persisnya belum bisa ditampilkan
              sekarang.
            </p>
          )}

          {preview?.alreadyGated && (
            <p className="muted-line">
              Landing ini dipakai bersama campaign lain yang sudah di-gate — hasilnya memakai key
              yang sama.
            </p>
          )}

          {blockedNow && (
            <p className="gating-warning">
              <TriangleAlert size={15} />
              <span>
                Campaign ini sekarang tidak bisa di-gate: {blockers.join("; ") || "ditolak sistem."}
              </span>
            </p>
          )}

          <p className="muted-line">
            {loading
              ? "Mengambil pratinjau terbaru dari Keitaro..."
              : fresh
                ? `Pratinjau baru saja diambil, ${formatDateTime(preview.checkedAt)}.`
                : `Pratinjau dari sync terakhir, ${preview?.checkedAt ? formatDateTime(preview.checkedAt) : "-"}.`}
            {freshError &&
              ` Gagal menyegarkan (${freshError}) — yang tampil di atas data sync terakhir.`}
            {
              " Gate menjalankan ulang pratinjaunya sendiri sebelum menulis, jadi ia masih bisa menolak kalau ada yang berubah di sela-sela."
            }
          </p>
        </>
      ) : (
        <p className="muted-line">
          Landing, Bot Protection, dan Flow 3 dikembalikan ke URL langsungnya. Satu hal yang sengaja
          tidak dikembalikan: pemetaan parameter <code>sub_id_2</code> → <code>fbclid</code> pada
          campaign — itu tidak berbahaya dan memang ingin dipertahankan.
        </p>
      )}

      <p className="muted-line">
        {CONTROL_API_ENABLED
          ? "Dijalankan sekarang lewat server kontrol. Kalau server tidak terjangkau, perintahnya masuk antrean dan dijalankan sync berikutnya."
          : "Perintahnya masuk antrean dan dijalankan sync berikutnya (tiap dua menit), bukan seketika."}
      </p>

      <div className="confirm-actions">
        <button className="ghost-button" onClick={onCancel} type="button">
          Batal
        </button>
        <button
          className={gating ? "primary-button" : "danger-button"}
          disabled={loading || blockedNow}
          onClick={onConfirm}
          title={blockedNow ? blockers.join("; ") : undefined}
          type="button"
        >
          {loading ? "Memuat pratinjau..." : gating ? "Gate sekarang" : "Ungate sekarang"}
        </button>
      </div>
    </Dialog>
  );
}

// Riwayat gate/ungate, termasuk yang gagal dan yang DITOLAK — yang ditolak justru yang paling
// sering perlu dibaca, karena di situlah alasan sebuah campaign tidak bisa di-gate tertulis dalam
// bahasa manusia.
function GateRuns({ runs }) {
  return (
    <>
      <p className="tab-note">
        Gate dan ungate terakhir, termasuk yang ditolak — di situlah alasan sebuah campaign tidak
        bisa di-gate tertulis dalam bahasa manusia. Waktunya menurut jam kamu.
      </p>
      <div aria-labelledby="gating-tab-runs" id="gating-panel-runs" role="tabpanel">
        <DataTable columns={RUN_COLUMNS} dense emptyText="Belum ada riwayat gating." items={runs} />
      </div>
    </>
  );
}

const RUN_COLUMNS = [
  {
    accessorKey: "startedAt",
    header: "Waktu",
    cell: ({ row }) => formatDateTime(row.original.startedAt),
  },
  {
    id: "campaign",
    accessorFn: (run) => run.campaignName || `Campaign ${run.campaignId}`,
    header: "Campaign",
    cell: ({ getValue }) => getValue(),
  },
  {
    id: "action",
    accessorFn: (run) => (run.action === "ungate" ? "Ungate" : "Gate"),
    header: "Aksi",
    cell: ({ getValue }) => getValue(),
  },
  {
    id: "status",
    accessorFn: (run) => gateRunLabel(run.status),
    header: "Hasil",
    cell: ({ row }) => (
      <span className={`badge ${gateRunTone(row.original.status)}`}>
        {gateRunLabel(row.original.status)}
      </span>
    ),
  },
  { id: "note", accessorFn: runNote, header: "Keterangan", cell: ({ getValue }) => getValue() },
];

function runNote(run) {
  if (run.error) return run.error;
  if (run.status === "problem") {
    return "Tersimpan tapi verifikasinya gagal — periksa manual di Keitaro.";
  }
  if (run.cleanupComplete === false) {
    return "Routing benar; ada baris uji yang tertinggal dan perlu dihapus manual.";
  }
  if (run.verified === true) {
    return run.action === "ungate"
      ? "Terverifikasi: kembali ke URL langsungnya."
      : "Terverifikasi: pengunjung sampai ke situsnya, bot keluar dari gate.";
  }
  return "-";
}
