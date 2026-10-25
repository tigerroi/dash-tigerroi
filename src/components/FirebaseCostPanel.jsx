import { Database, Download, HardDrive, RefreshCw, TriangleAlert, Users } from "lucide-react";
import { useMemo } from "react";
import { firebasePaths } from "../config/firebasePaths";
import { useNodeSizes } from "../hooks/useNodeSizes";
import { filterByDateField } from "../lib/dateRange";
import {
  estimateFirebaseCost,
  formatBytes,
  formatUsd,
  RTDB_PRICE_PER_GB,
  SESSION_GAP_MS,
} from "../lib/firebaseCost";
import { formatDateTime } from "../lib/formatDate";
import { DataTable } from "./ui/DataTable";

/**
 * "Estimasi biaya Firebase" — panel kedua di /activity-logs.
 *
 * Yang dijawabnya: berapa yang benar-benar diunduh dari RTDB oleh orang-orang ini, dan berapa
 * dolarnya. Sampai panel ini ada, satu-satunya jawabannya adalah tagihan Google yang datang sebulan
 * kemudian sebagai SATU angka — tanpa menyebut siapa, role apa, atau halaman mana.
 *
 * Ia berdiri DI BAWAH tabel jejak dan bukan di atasnya: yang dicari orang saat membuka halaman ini
 * adalah jejaknya, dan panel turunan yang mendorong tabelnya keluar layar pertama menukar
 * pertanyaan yang sering dengan pertanyaan yang sesekali.
 *
 * SENGAJA TIDAK IKUT PENYARING di kepala panel jejak, sepola dengan kartu Cash Flow — dan di sini
 * alasannya lebih keras daripada sekadar "kartu yang setengahnya tersaring tidak bisa dijumlahkan":
 * batas sesi ditaksir dari JEDA antar-baris, jadi penyaring kategori yang membuang kunjungan
 * halaman akan memotong satu sesi jadi tiga dan melipatgandakan estimasinya. Yang tetap berlaku
 * cuma rentang tanggalnya.
 */
export function FirebaseCostPanel({ rows, range, store, truncated }) {
  const { sizes, measured, measure } = useNodeSizes(store);

  const estimate = useMemo(
    () => estimateFirebaseCost({ rows: filterByDateField(rows, "at", range), sizes }),
    [rows, range, sizes],
  );

  // Node yang dilanggan sesi mana pun tapi belum pernah terukur di perangkat ini. Hampir selalu
  // kedua node berat: keduanya baru dilanggan kalau route-nya membutuhkannya.
  const unknown = estimate.unknownNodes;

  const nodeRows = useMemo(
    () =>
      Object.entries(measured)
        .map(([key, entry]) => ({ key, ...entry }))
        .sort((a, b) => b.bytes - a.bytes),
    [measured],
  );

  const columns = useMemo(() => actorColumns(estimate), [estimate]);

  return (
    <div className="panel">
      <div className="panel-header">
        <div>
          {/* Keterangan yang BERUBAH, bukan judul kedua: yang menerangkan seluruh angka di bawah
              adalah berapa sesi dan berapa hari yang benar-benar terhitung — dan keduanya rutin
              berbeda dari panjang rentang yang dipilih. */}
          <h2>Estimasi biaya Firebase</h2>
          <p>
            {estimate.sessions
              ? `${estimate.sessions} muat aplikasi · ${estimate.dayCount} hari yang ada jejaknya · $${RTDB_PRICE_PER_GB}/GB unduhan RTDB`
              : "Belum ada jejak pada rentang ini"}
          </p>
        </div>
        <button className="ghost-button" onClick={measure} type="button">
          <RefreshCw size={14} />
          Ukur ulang node
        </button>
      </div>

      {/* Ini LANTAI, dan mengatakannya adalah syarat angkanya boleh berdiri sama sekali. Ketiga
          sebabnya diperbaiki di tempat yang berbeda, jadi ketiganya disebut terpisah alih-alih
          dilebur jadi "estimasi kasar". */}
      <p className="notice-note">
        <TriangleAlert size={15} />
        <span>
          Angka di bawah adalah <strong>batas bawah</strong>. Yang belum terhitung: delta yang
          diterima tab yang dibiarkan terbuka tiap kali sync menulis (besarnya tidak ada di jejak
          mana pun), sesi yang ditutup sebelum jejaknya sempat berangkat, dan{" "}
          {truncated
            ? "kejadian yang terpotong batas satu bacaan pada rentang ini"
            : "kejadian yang belum dikirim dari perangkat orangnya"}
          . Berpindah halaman di dalam dashboard <strong>tidak</strong> mengunduh ulang apa pun —
          yang dihitung adalah muat aplikasi (login, refresh, tab baru), ditaksir dari jeda{" "}
          {SESSION_GAP_MS / 60000} menit antar-jejak.
        </span>
      </p>

      {unknown.length > 0 && (
        <p className="notice-alert">
          <TriangleAlert size={15} />
          <span>
            {unknown.length} node belum pernah terukur di perangkat ini dan{" "}
            <strong>tidak ikut dijumlah</strong>:{" "}
            {unknown.map((node, index) => (
              <span key={node}>
                {index > 0 && ", "}
                <code>{node}</code>
              </span>
            ))}
            . Node berat baru dilanggan saat halaman yang membacanya dibuka — buka tab Grafik dan
            sebuah profil user sekali di sesi ini, lalu tekan "Ukur ulang node".
          </span>
        </p>
      )}

      <section className="stats-grid">
        <article className="stat-card blue">
          <div className="stat-card-header">
            <span>Unduhan periode ini</span>
            <Download size={18} />
          </div>
          <strong>{formatBytes(estimate.bytes)}</strong>
        </article>
        <article className="stat-card purple">
          <div className="stat-card-header">
            <span>Rata-rata per hari</span>
            <HardDrive size={18} />
          </div>
          <strong>{formatBytes(estimate.bytesPerDay)}</strong>
        </article>
        <article className="stat-card orange">
          <div className="stat-card-header">
            <span>Estimasi per bulan</span>
            <Database size={18} />
          </div>
          <strong>{formatUsd(estimate.costPerMonth)}</strong>
        </article>
        <article className="stat-card green">
          <div className="stat-card-header">
            <span>Muat aplikasi</span>
            <Users size={18} />
          </div>
          <strong>{estimate.sessions}</strong>
        </article>
      </section>

      <DataTable
        columns={columns}
        dense
        emptyText="Tidak ada jejak pada rentang ini."
        getRowId={(row) => row.actor}
        items={estimate.rows}
      />

      {/* Ukuran tiap node ditutup di balik <details>: yang dicari orang di panel ini adalah
          biayanya, dan tiga puluh baris ukuran di antara tabel dan kesimpulannya cuma mendorong
          keduanya berjauhan. Yang membukanya adalah yang bertanya "kenapa angkanya sebesar itu". */}
      <details className="detail-block">
        <summary>Ukuran node yang terukur ({nodeRows.length})</summary>
        <DataTable
          columns={NODE_COLUMNS}
          dense
          emptyText="Belum ada node yang terukur di perangkat ini."
          getRowId={(node) => node.key}
          items={nodeRows}
        />
      </details>
    </div>
  );
}

/**
 * Kolom tabel per pengguna. Baris Total jadi `footer` kolom: ia berdiri di bawah badan tabel
 * walau barisnya diurutkan ulang, dan hanya tergambar selama ada baris jejak — sama seperti dulu.
 */
function actorColumns(estimate) {
  return [
    {
      accessorKey: "actor",
      header: "Pengguna",
      footer: "Total",
      cell: ({ row }) => (
        <>
          <strong>{row.original.actor}</strong>
          {/* Sesi yang membuka halaman berat disebut di bawah namanya dan bukan jadi kolom sendiri:
              ia menerangkan kenapa "Per muat" orang ini jauh lebih besar daripada rekannya yang
              rolenya sama — pertanyaan yang cuma muncul untuk sebagian baris. */}
          {row.original.heavySessions > 0 && (
            <small className="muted-line">
              {row.original.heavySessions} dari {row.original.sessions} muat membuka halaman berat
              (roiSnapshots / userReports)
            </small>
          )}
        </>
      ),
    },
    {
      accessorKey: "role",
      header: "Role",
      footer: "",
      cell: ({ row }) => row.original.role || "-",
    },
    {
      accessorKey: "sessions",
      header: "Muat aplikasi",
      footer: () => estimate.sessions,
      cell: ({ row }) => row.original.sessions,
      meta: {
        align: "right",
        hint: "Jejak yang jaraknya lebih dari 30 menit dihitung sebagai muat baru",
      },
    },
    {
      accessorKey: "events",
      header: "Kejadian",
      footer: () => estimate.rows.reduce((total, row) => total + row.events, 0),
      cell: ({ row }) => row.original.events,
      meta: { align: "right" },
    },
    {
      accessorKey: "bytesPerSession",
      header: "Per muat",
      footer: () => formatBytes(estimate.sessions ? estimate.bytes / estimate.sessions : 0),
      cell: ({ row }) => formatBytes(row.original.bytesPerSession),
      meta: { align: "right", hint: "Unduhan ÷ Muat aplikasi" },
    },
    {
      accessorKey: "bytes",
      header: "Unduhan",
      footer: () => formatBytes(estimate.bytes),
      cell: ({ row }) => formatBytes(row.original.bytes),
      meta: {
        align: "right",
        hint: "Σ ukuran node yang dilanggan role itu, per muat aplikasi",
      },
    },
    {
      accessorKey: "cost",
      header: "Estimasi biaya",
      footer: () => formatUsd(estimate.cost),
      cell: ({ row }) => formatUsd(row.original.cost),
      meta: { align: "right", hint: `Unduhan ÷ 1 GB × $${RTDB_PRICE_PER_GB}` },
    },
  ];
}

const NODE_COLUMNS = [
  { accessorKey: "key", header: "Node", cell: ({ row }) => row.original.key },
  {
    id: "path",
    accessorFn: (node) => firebasePaths[node.key] || "",
    header: "Path RTDB",
    cell: ({ row }) => <code>{firebasePaths[row.original.key] || "-"}</code>,
  },
  {
    accessorKey: "bytes",
    header: "Ukuran",
    cell: ({ row }) => formatBytes(row.original.bytes),
    meta: { align: "right" },
  },
  {
    accessorKey: "at",
    header: "Diukur",
    cell: ({ row }) => (row.original.at ? formatDateTime(row.original.at) : "-"),
  },
];
