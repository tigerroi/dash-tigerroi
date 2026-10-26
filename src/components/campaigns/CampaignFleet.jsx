import { Copy, FileUp, Pencil, Plus, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useUrlState } from "../../hooks/useUrlState";
import { adSetCache, adSetCacheKey } from "../../lib/adSetCache";
import {
  bulkResultMessage,
  campaignJobNote,
  campaignJobRows,
  filterFleetRows,
  finishedJobToasts,
  fleetFilterOptions,
  jobStateMap,
  runEach,
  runningCopyFor,
  sortFleetRows,
  UNMAPPED_FILTER,
} from "../../lib/campaignFleet";
import { describeMappingSource, fleetCampaignRows } from "../../lib/campaignRows";
import {
  CONTROL_API_ENABLED,
  resumeCreateJobNow,
  setCampaignStatusNow,
} from "../../lib/controlApi";
import { formatDateTime } from "../../lib/formatDate";
import { notifySuccess, notifyWarning } from "../../lib/notify";
import { renderCell } from "../../lib/renderCell";
import { CampaignAdSets } from "../CampaignAdSets";
import { DataTable } from "../ui/DataTable";
import { EmptyMessage } from "../ui/EmptyMessage";
import { ExpandToggle } from "../ui/ExpandToggle";
import { PageHeader } from "../ui/PageHeader";
import { RowCheckbox } from "../ui/RowCheckbox";
import { SelectField, toSelectOptions } from "../ui/SelectField";
import {
  BulkBudgetDialog,
  CopyCampaignDialog,
  EditAdSetDialog,
  EditCampaignDialog,
} from "./CampaignDialogs";
import { CampaignStatusCell } from "./CampaignStatusCell";
import { CreateCampaignDialog } from "./CreateCampaignDialog";
import { KeitaroCsvImportDialog } from "./KeitaroCsvImportDialog";

/**
 * Halaman Campaign — campaign seluruh armada, disalin dan diubah dari satu tempat. SUPERADMIN.
 *
 * Tabelnya dari `campaigns` di bawah tiap `users/{uid}` yang sudah dilanggan store, jadi tidak ada
 * unduhan baru.
 * Tulisannya lewat server kontrol (server/campaign-manage.js); tanpa server itu tombolnya tidak
 * digambar, sepola /plugin, dan tabel serta panel Salinan tetap terbaca dari database.
 *
 * Sub Domain di sini HANYA BACA: pemetaan manual tetap diubah di profil user, supaya tidak ada dua
 * tempat yang menulis field yang sama.
 */
export function CampaignFleet({
  store,
  navigate,
  onToggleCampaign,
  onSavePreset,
  onRemovePreset,
  tab,
}) {
  // Dua tab, satu komponen — sepola Overview. Yang berganti cuma bagian mana yang dirender; jobs,
  // toast hasilnya, dan dialognya tetap hidup di kedua tab, karena hasil sebuah pekerjaan harus
  // sampai ke orangnya walau ia sedang membaca tabel armada.
  const activeTab = tab === "pekerjaan" ? "pekerjaan" : "daftar";
  const [q, setQ] = useUrlState("q", "");
  const [owner, setOwner] = useUrlState("pemilik", "");
  const [account, setAccount] = useUrlState("akun", "");
  const [subDomain, setSubDomain] = useUrlState("subdomain", "");
  const [status, setStatus] = useUrlState("status", "");
  const [openAdSets, setOpenAdSets] = useUrlState("adset", "");
  const [dialog, setDialog] = useState(null);
  // Naik tiap ad set berhasil diubah: panelnya dipasang ulang dan membaca ke Meta, bukan ditambal.
  const [adSetVersion, setAdSetVersion] = useState(0);

  const rows = useMemo(() => fleetCampaignRows(store.users), [store.users]);
  const options = useMemo(() => fleetFilterOptions(rows), [rows]);
  const visible = useMemo(
    () => sortFleetRows(filterFleetRows(rows, { q, owner, account, subDomain, status })),
    [rows, q, owner, account, subDomain, status],
  );
  // Dua jenis job, satu daftar: pertanyaannya cuma "apa yang sedang berjalan".
  const jobs = useMemo(
    () => campaignJobRows(store.campaignCopyJobs, store.campaignCreateJobs),
    [store.campaignCopyJobs, store.campaignCreateJobs],
  );
  /**
   * Hasil duplikasi (dan pembuatan) diumumkan dari NODE JOB-nya, bukan dari tombolnya.
   *
   * Route menjawab sesudah job ditulis `requested` dan sebelum satu ad set pun disalin, jadi toast di
   * dialognya cuma bisa berbunyi "sedang dikerjakan". Yang tahu hasilnya adalah node yang sudah
   * dilanggan panel di bawah ini — dan `seen` yang membedakan pekerjaan yang baru selesai dari
   * pekerjaan yang sudah selesai sebelum halaman ini dibuka.
   *
   * `notifyWarning`, bukan `notifyError`: yang kedua meluluskan pesannya lewat `friendlyError`, yang
   * menerjemahkan pola Meta jadi kalimat umum — dan kalimat yang menyebut ID Halaman yang harus
   * diberi izin akan tergantikan oleh "Aplikasi Meta sedang diblokir. Hubungi admin."
   */
  const seen = useRef(null);
  useEffect(() => {
    for (const item of finishedJobToasts(seen.current, jobs)) {
      if (item.tone === "success") notifySuccess(item.message);
      else notifyWarning(item.message);
    }
    seen.current = jobStateMap(jobs);
  }, [jobs]);

  // Bahan usulan nomor urut nama campaign baru — nama yang sudah ada di armada.
  const existingNames = useMemo(() => rows.map((row) => row.campaign), [rows]);
  const running = jobs.filter((job) => job.label === "Berjalan").length;
  // Filter yang berubah mengembalikan paging ke halaman 1 (`pageResetKey` di DataTable).
  const filterKey = [q, owner, account, subDomain, status].join("|");

  const onFilter = (setter) => (eventOrValue) => {
    // Kotak cari mengirim event, SelectField mengirim nilainya langsung.
    setter(eventOrValue?.target ? eventOrValue.target.value : eventOrValue);
  };
  const closeDialog = () => setDialog(null);

  // Pilihan untuk tindakan massal. Kotak centang, bukan Switch: ia MEMILIH baris untuk tindakan
  // berikutnya. "Pilih semua" bekerja pada yang TERLIHAT (tersaring), sepola /plugin — satu centang
  // yang diam-diam memilih seluruh armada di balik filter adalah cara anggaran mendarat di campaign
  // yang tidak dimaksud. Baris tanpa alamat Meta tidak bisa dipilih.
  const [selected, setSelected] = useState(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const writableOf = (row) => Boolean(row.campaignId) && !row.metaMissing;
  const selectable = visible.filter(writableOf);
  const selectedRows = selectable.filter((row) => selected.has(row.id));
  const allSelected = selectable.length > 0 && selectedRows.length === selectable.length;
  const toggleSelect = (id) =>
    setSelected((current) => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(selectable.map((row) => row.id)));
  const reportBulk = (verb, result) => {
    const message = bulkResultMessage(verb, result);
    result.failed.length ? notifyWarning(message) : notifySuccess(message);
    setSelected(new Set());
  };

  const bulkStatus = async (active) => {
    const status = active ? "ACTIVE" : "PAUSED";
    // Yang saklarnya sudah di posisi itu tidak dikirim — tulisan yang tidak mengubah apa pun tetap
    // satu panggilan Meta.
    const targets = selectedRows.filter((row) => row.configuredStatus !== status);
    setBulkBusy(true);
    const result = await runEach(targets, async (row) => {
      // Sepola saklar satu campaign: mematikannya mengubah effective_status tiap ad set-nya.
      adSetCache.invalidate(adSetCacheKey(row.userId, row.campaignId));
      await setCampaignStatusNow(row.userId, row.campaignId, status);
    });
    setBulkBusy(false);
    reportBulk(active ? "Dinyalakan" : "Dimatikan", result);
  };

  // Baris yang terbuka tinggal di alamat sebagai `campaignId`; DataTable mengenal baris lewat
  // `id`-nya, jadi petanya diturunkan di sini — sepola Manajemen Kampanye di profil user.
  const expanded = useMemo(() => {
    const open = visible.find((row) => row.campaignId && row.campaignId === openAdSets);
    return open ? { [open.id]: true } : {};
  }, [visible, openAdSets]);

  // Hasilnya diumumkan toast perpindahan status job (`finishedJobToasts`), sama dengan job baru —
  // yang dijawab tombol ini cuma "sudah mulai" atau penolakan server berikut sebabnya.
  const [resuming, setResuming] = useState("");
  const resume = async (job) => {
    setResuming(job.id);
    try {
      await resumeCreateJobNow(job.id);
      notifySuccess(`Melanjutkan ${job.title}.`);
    } catch (error) {
      notifyWarning(error.message);
    } finally {
      setResuming("");
    }
  };

  const jobColumns = [
    {
      accessorKey: "kindLabel",
      header: "Jenis",
      cell: ({ row }) => <span className="badge neutral">{row.original.kindLabel}</span>,
    },
    {
      accessorKey: "title",
      header: "Campaign",
      cell: ({ row }) => (
        <>
          <strong title={row.original.title}>{row.original.title}</strong>
          <small className="muted-line">{row.original.subtitle}</small>
        </>
      ),
    },
    {
      accessorKey: "label",
      header: "Status",
      cell: ({ row }) => {
        const note = campaignJobNote(row.original);
        return (
          <>
            <span className={`badge ${row.original.tone}`}>{row.original.label}</span>
            {note && <small className="muted-line">{note}</small>}
          </>
        );
      },
    },
    {
      accessorKey: "born",
      header: "Lahir",
      cell: ({ row }) => (
        <>
          {row.original.born} dari {row.original.count}
        </>
      ),
      meta: { align: "center" },
    },
    {
      accessorKey: "requestedAt",
      header: "Diminta",
      cell: ({ row }) => (
        <>
          {formatDateTime(row.original.requestedAt)}
          <small className="muted-line">{row.original.requestedBy || "-"}</small>
        </>
      ),
    },
    {
      id: "actions",
      header: "Aksi",
      enableSorting: false,
      cell: ({ row }) => (
        <div className="fleet-actions">
          {CONTROL_API_ENABLED && row.original.resumable && (
            <button
              className="ghost-button adset-edit"
              disabled={resuming === row.original.id}
              onClick={() => resume(row.original)}
              title="Buat ad set dan iklan yang belum lahir, dari isian yang sama"
              type="button"
            >
              {resuming === row.original.id ? "Melanjutkan..." : "Lanjutkan"}
            </button>
          )}
          {row.original.born > 0 && (
            <button
              className="ghost-button adset-edit"
              // Tabelnya sekarang tab LAIN, jadi tombolnya berpindah alamat berikut pencariannya.
              // Menulis `?q=` di alamat tab ini cuma menyaring tabel yang tidak sedang digambar.
              onClick={() =>
                navigate(`/campaigns?q=${encodeURIComponent(row.original.searchName)}`)
              }
              type="button"
            >
              Lihat di tabel
            </button>
          )}
        </div>
      ),
      meta: { align: "right" },
    },
  ];

  const fleetColumns = [
    ...(CONTROL_API_ENABLED
      ? [
          {
            id: "select",
            enableSorting: false,
            header: () => (
              <RowCheckbox
                label="Pilih semua campaign yang terlihat"
                checked={allSelected}
                disabled={!selectable.length}
                onChange={toggleAll}
              />
            ),
            cell: ({ row: { original: row } }) => (
              <RowCheckbox
                label={`Pilih ${row.campaign}`}
                checked={selected.has(row.id)}
                disabled={!writableOf(row)}
                onChange={() => toggleSelect(row.id)}
              />
            ),
            meta: { className: "plugin-check", headerClassName: "plugin-check" },
          },
        ]
      : []),
    {
      accessorKey: "campaign",
      header: "Kampanye",
      cell: ({ row: { original: row } }) => {
        const open = Boolean(row.campaignId) && openAdSets === row.campaignId;
        return (
          <div className="campaign-name-cell">
            <ExpandToggle
              label={`ad set campaign ${row.campaign}`}
              disabled={!row.campaignId}
              onToggle={() => setOpenAdSets(open ? "" : row.campaignId)}
              open={open}
              title={
                row.campaignId
                  ? "Lihat ad set di dalam campaign ini"
                  : "Baris ini tidak punya ID campaign di Meta, jadi ad set-nya tidak bisa diminta."
              }
            />
            <div>
              <strong title={row.campaign}>{row.campaign}</strong>
              <span title={`Akun: ${row.account}`}>
                {row.account} ·{" "}
                <a
                  href={`/users/${row.userId}`}
                  onClick={(event) => {
                    event.preventDefault();
                    navigate(`/users/${row.userId}`);
                  }}
                >
                  {row.owner}
                </a>
              </span>
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: "subDomain",
      header: "Sub Domain",
      cell: ({ row }) => (
        <>
          <span>{row.original.subDomain || "-"}</span>
          <small className="muted-line">{describeMappingSource(row.original)}</small>
        </>
      ),
    },
    {
      // Diurutkan lewat POSISI SAKLAR (`configuredStatus`), bukan label — sama dengan urutan
      // bawaan `sortFleetRows` dan kolom Status di profil user.
      accessorKey: "configuredStatus",
      header: "Status",
      cell: ({ row }) => (
        <CampaignStatusCell
          canToggle
          command={row.original.command}
          item={row.original}
          onToggle={onToggleCampaign}
        />
      ),
    },
    {
      accessorKey: "dailyBudget",
      header: "Anggaran",
      cell: ({ row }) => (
        <>
          <strong>{renderCell(row.original.dailyBudget, "dailyBudget")}</strong>
          <small className="muted-line">
            {row.original.dailyBudget === "-" ? "Di ad set atau lifetime" : "Harian, di campaign"}
          </small>
        </>
      ),
      meta: { align: "right" },
    },
    ...(CONTROL_API_ENABLED
      ? [
          {
            id: "actions",
            header: "Aksi",
            enableSorting: false,
            cell: ({ row: { original: row } }) => {
              const writable = Boolean(row.campaignId) && !row.metaMissing;
              const copying = runningCopyFor(jobs, row.campaignId);
              const blocked = writable ? "" : "Campaign ini tidak punya alamat di Meta.";
              return (
                <div className="fleet-actions">
                  <button
                    className="ghost-button adset-edit"
                    disabled={!writable || copying}
                    onClick={() => setDialog({ type: "copy", row })}
                    title={
                      blocked ||
                      (copying
                        ? "Salinan campaign ini masih berjalan."
                        : "Salin campaign berikut ad set dan iklannya")
                    }
                    type="button"
                  >
                    <Copy size={13} />
                    Duplikasi
                  </button>
                  <button
                    className="ghost-button adset-edit"
                    disabled={!writable}
                    onClick={() => setDialog({ type: "campaign", row })}
                    title={blocked || "Ubah nama atau anggaran harian"}
                    type="button"
                  >
                    <Pencil size={13} />
                    Ubah
                  </button>
                </div>
              );
            },
            meta: { align: "right" },
          },
        ]
      : []),
  ];

  return (
    // `.page-stack` sama dengan tiap halaman lain (ResourceList, Overview, Laba Rugi): yang memberi
    // jarak antara judul dan panel di bawahnya adalah gap grid-nya. Sebagai fragment telanjang,
    // keduanya berdiri tanpa jarak sama sekali — `.content` bukan grid.
    <div className="page-stack">
      <PageHeader
        action={
          <div className="header-actions">
            <button
              className="primary-button"
              onClick={() => setDialog({ type: "keitaroCsv" })}
              title="Unggah berkas CSV laporan performa tracker Keitaro"
              type="button"
            >
              <FileUp size={15} /> Import CSV Keitaro
            </button>
            {CONTROL_API_ENABLED && (
              <button
                className="secondary-button"
                onClick={() => setDialog({ type: "create" })}
                type="button"
              >
                <Plus size={15} /> Buat campaign
              </button>
            )}
          </div>
        }
        description="Buat, salin, dan kelola campaign Meta seluruh armada serta impor tracker Keitaro."
        title="Campaign"
      />

      {!CONTROL_API_ENABLED && (
        <p className="plugin-alert plugin-alert-inline">
          <TriangleAlert size={15} />
          <span>
            Server kontrol belum dikonfigurasi, jadi campaign tidak bisa disalin atau diubah dari
            sini. Tabel armada tetap dibaca dari database.
          </span>
        </p>
      )}

      {activeTab === "pekerjaan" && jobs.length === 0 && (
        // Tab yang kosong tanpa satu kalimat pun terbaca seperti halaman yang gagal memuat. Masa
        // simpannya disebutkan: daftar yang kosong karena job-nya sudah dibuang bukan daftar yang
        // kosong karena tidak ada yang pernah dikerjakan.
        <EmptyMessage panel>
          Belum ada pekerjaan dalam 7 hari terakhir. Duplikasi dan pembuatan campaign muncul di sini
          begitu dimulai, berikut progres dan hasilnya.
        </EmptyMessage>
      )}

      {activeTab === "pekerjaan" && jobs.length > 0 && (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Pekerjaan</h2>
              <p>
                {running} berjalan · {jobs.length} dalam 7 hari terakhir
              </p>
            </div>
          </div>
          <DataTable
            className="fleet-jobs-table"
            columns={jobColumns}
            getRowId={(job) => `${job.kind}-${job.id}`}
            items={jobs}
          />
        </section>
      )}

      {activeTab === "daftar" && (
        <section className="panel">
          <div className="toolbar">
            <div className="toolbar-filters fleet-filters">
              <input
                aria-label="Cari nama atau kode campaign"
                className="control search"
                onChange={onFilter(setQ)}
                placeholder="Cari nama atau kode campaign..."
                value={q}
              />
              <SelectField
                ariaLabel="Filter pemilik"
                className="compact-control"
                onChange={onFilter(setOwner)}
                options={[{ value: "", label: "Semua pemilik" }, ...options.owners]}
                value={owner}
              />
              <SelectField
                ariaLabel="Filter ad account"
                className="compact-control"
                onChange={onFilter(setAccount)}
                options={[
                  { value: "", label: "Semua ad account" },
                  ...toSelectOptions(options.accounts),
                ]}
                value={account}
              />
              <SelectField
                ariaLabel="Filter subdomain"
                className="compact-control"
                onChange={onFilter(setSubDomain)}
                options={[
                  { value: "", label: "Semua subdomain" },
                  { value: UNMAPPED_FILTER, label: "Belum dipetakan" },
                  ...toSelectOptions(options.subDomains),
                ]}
                value={subDomain}
              />
              <SelectField
                ariaLabel="Filter status"
                className="compact-control"
                onChange={onFilter(setStatus)}
                options={[
                  { value: "", label: "Semua status" },
                  ...toSelectOptions(options.statuses),
                ]}
                value={status}
              />
            </div>
          </div>

          {selectedRows.length > 0 && (
            <div className="plugin-bulkbar">
              <span>{selectedRows.length} campaign dipilih</span>
              <div className="plugin-bulkbar-actions">
                <button
                  className="ghost-button"
                  disabled={bulkBusy}
                  onClick={() => bulkStatus(true)}
                  type="button"
                >
                  Nyalakan
                </button>
                <button
                  className="ghost-button"
                  disabled={bulkBusy}
                  onClick={() => bulkStatus(false)}
                  type="button"
                >
                  Matikan
                </button>
                <button
                  className="ghost-button"
                  disabled={bulkBusy}
                  onClick={() => setDialog({ type: "bulkBudget", rows: selectedRows })}
                  type="button"
                >
                  Ubah anggaran
                </button>
                <button
                  className="ghost-button"
                  disabled={bulkBusy}
                  onClick={() => setSelected(new Set())}
                  type="button"
                >
                  Batal pilih
                </button>
              </div>
            </div>
          )}

          <DataTable
            className="campaign-table fleet-table"
            columns={fleetColumns}
            emptyText="Tidak ada campaign yang cocok."
            expanded={expanded}
            expandedRowClassName="adset-detail-row"
            items={visible}
            pageResetKey={filterKey}
            paginate
            paginationLabel="campaign"
            renderExpanded={(row) => (
              <CampaignAdSets
                campaignId={row.campaignId}
                canToggle
                key={`${row.campaignId}-${adSetVersion}`}
                onEdit={
                  CONTROL_API_ENABLED
                    ? (adSet) => setDialog({ type: "adset", row, adSet })
                    : undefined
                }
                userId={row.userId}
              />
            )}
            wrapClassName="campaign-table-wrap"
          />
        </section>
      )}

      {dialog?.type === "create" && (
        <CreateCampaignDialog
          existingNames={existingNames}
          onClose={closeDialog}
          onRemovePreset={onRemovePreset}
          onSavePreset={onSavePreset}
          store={store}
        />
      )}
      {dialog?.type === "copy" && <CopyCampaignDialog onClose={closeDialog} row={dialog.row} />}
      {dialog?.type === "bulkBudget" && (
        <BulkBudgetDialog
          onClose={closeDialog}
          onDone={(result) => {
            closeDialog();
            reportBulk("Anggaran diubah untuk", result);
          }}
          rows={dialog.rows}
        />
      )}
      {dialog?.type === "campaign" && <EditCampaignDialog onClose={closeDialog} row={dialog.row} />}
      {dialog?.type === "adset" && (
        <EditAdSetDialog
          adSet={dialog.adSet}
          onClose={closeDialog}
          onSaved={() => {
            adSetCache.invalidate(adSetCacheKey(dialog.row.userId, dialog.row.campaignId));
            setAdSetVersion((version) => version + 1);
          }}
          row={dialog.row}
        />
      )}
      {dialog?.type === "keitaroCsv" && (
        <KeitaroCsvImportDialog
          isOpen={true}
          onClose={closeDialog}
          onImportSuccess={() => {
            closeDialog();
            notifySuccess("Data laporan Keitaro berhasil disimpan ke database!");
          }}
        />
      )}
    </div>
  );
}
