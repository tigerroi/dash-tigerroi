import { DownloadCloud, FileSpreadsheet, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { FUNCTIONS_ENABLED } from "../config/features";
import { PAGE_SIZE_OPTIONS, useTablePagination } from "../hooks/useTablePagination";
import { useUrlRange, useUrlRecord, useUrlState } from "../hooks/useUrlState";
import { CONTROL_API_ENABLED } from "../lib/controlApi";
import { currentMonthRange, filterByDateField } from "../lib/dateRange";
import { parseImportFile } from "../lib/importParser";
import { sortTableItems } from "../lib/sortTableItems";
import { toAmount } from "../lib/toAmount";
import { DataTable } from "./ui/DataTable";
import { DateRangePicker } from "./ui/DateRangePicker";
import { Dialog } from "./ui/Dialog";
import { PageHeader } from "./ui/PageHeader";
import { SelectField, toSelectOptions } from "./ui/SelectField";
import { TablePagination } from "./ui/TablePagination";

export function ResourceList({
  config,
  items,
  loading = false,
  // Non-admins get a read-only view: the rules reject their writes, so don't offer them.
  readOnly = false,
  onAdd,
  onView,
  onEdit,
  onDelete,
  onAuthAction,
  onImport,
  onDiscover,
  // Whether to offer Edit, which is not always `!readOnly`: an advertiser gets a read-only list
  // but still opens a subdomain's form to write the one field they own.
  canEdit = !readOnly,
}) {
  const filters = config.filters || [];
  // Pencarian dan filter tinggal di alamat, bukan di komponen ini: daftar yang sudah disaring harus
  // masih tersaring setelah orang membuka satu barisnya lalu menekan Back. Lihat `useUrlState`.
  const [query, setQuery] = useUrlState("q", "");
  const [filterValues, setFilterValues] = useUrlRecord(
    "f_",
    filters.map((filter) => filter.field),
  );
  const [importing, setImporting] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  // RTDB mengembalikan baris menurut urutan kunci push — urutan dimasukkan, jadi yang paling lama
  // selalu di halaman pertama. Untuk daftar yang terus bertambah tiap hari (Expenses, Whitelist
  // Top-Up) itu berarti yang baru saja diinput justru paling jauh dari mata. `defaultSort` di
  // konfigurasi resource yang menentukan urutan awalnya; header tabel tetap bisa mengubahnya.
  const [sort, setSort] = useState(() => config.defaultSort || { key: "", direction: "" });
  // Halaman keuangan (Expenses, Whitelist Top-Up) menumpuk baris tiap hari, dan yang dicari orang
  // saat membukanya hampir selalu pengeluaran bulan berjalan — bukan seluruh riwayat sejak awal.
  // Karena itu defaultnya bulan ini; mengosongkan kedua kotak tanggal mengembalikan semuanya.
  const [dateRange, setDateRange] = useUrlRange("tanggal", currentMonthRange);
  const fileInputRef = useRef(null);
  const dateFilterField = config.dateFilterField || "";
  const summaryFields = config.summaryFields || [];
  const filterOptions = useMemo(() => {
    const options = {};
    for (const filter of filters) {
      const values = [...new Set(items.map((item) => item[filter.field]).filter(Boolean))].sort();
      options[filter.field] = filter.descending ? values.reverse() : values;
    }
    return options;
  }, [items, filters]);
  const filtered = useMemo(() => {
    const needle = query.toLowerCase();
    const withinRange = dateFilterField
      ? filterByDateField(items, dateFilterField, dateRange)
      : items;

    return withinRange.filter((item) => {
      if (!Object.values(item).join(" ").toLowerCase().includes(needle)) {
        return false;
      }

      return filters.every((filter) => {
        const value = filterValues[filter.field];
        return !value || String(item[filter.field] ?? "") === value;
      });
    });
  }, [items, query, filters, filterValues, dateFilterField, dateRange]);
  // Dijumlahkan dari `filtered`, bukan dari baris yang sedang tampil: yang ingin diketahui adalah
  // total pengeluaran satu bulan, bukan total 25 baris pertamanya.
  const summary = useMemo(
    () =>
      summaryFields.map((field) => ({
        ...field,
        value: filtered.reduce((sum, item) => sum + toAmount(item[field.field]), 0),
      })),
    [filtered, summaryFields],
  );
  // Diurutkan sebelum dipotong per halaman. Kalau dibalik, "urut menurut Date" hanya berlaku bagi
  // 25 baris yang kebetulan sedang tampil.
  const sorted = useMemo(() => sortTableItems(filtered, sort), [filtered, sort]);
  // Paging yang sama dengan tabel-tabel lain; di sini saja pilihan baris/halaman ikut di toolbar
  // atas, karena berpasangan dengan kotak pencarian yang menentukan isi daftarnya.
  const pagination = useTablePagination(sorted, 25);

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file || !onImport) {
      return;
    }

    setImporting(true);
    try {
      const parsedRows = await parseImportFile(file, config);
      if (parsedRows.length > 0) {
        await onImport(parsedRows);
      }
    } finally {
      setImporting(false);
      event.target.value = "";
    }
  };

  const handleDiscover = async () => {
    setDiscovering(true);
    try {
      await onDiscover();
    } finally {
      setDiscovering(false);
    }
  };

  // Everything below hits the same GAM credential. Running two at once just races them.
  const busy = discovering;

  const handleConfirmDelete = async () => {
    if (!pendingDelete) {
      return;
    }

    setDeleting(true);
    try {
      await onDelete(pendingDelete.id);
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  };

  const deleteLabel =
    pendingDelete?.name ||
    pendingDelete?.domainUrl ||
    pendingDelete?.email ||
    pendingDelete?.username ||
    pendingDelete?.id;

  return (
    <div className="page-stack">
      <PageHeader
        title={config.title}
        description={config.description}
        action={
          <div className="header-actions">
            {!readOnly && config.importLabel && (
              <>
                <input
                  ref={fileInputRef}
                  className="hidden-input"
                  type="file"
                  accept={config.importAccept || ".xlsx,.xls,.csv"}
                  onChange={handleFileChange}
                />
                <button
                  className="ghost-button success"
                  onClick={handleImportClick}
                  type="button"
                  disabled={importing}
                >
                  <FileSpreadsheet size={16} />
                  {importing ? "Mengimpor..." : config.importLabel}
                </button>
              </>
            )}
            {/*
              Server kontrol menjalankan impor yang sama dengan CLI tanpa lewat `allUsers`, jadi
              tombol ini hidup di bawah DRS. `FUNCTIONS_ENABLED` tetap dibaca supaya jalur callable
              lama tidak hilang kalau DRS dilonggarkan — persis seperti tombol Login di bawah.
            */}
            {!readOnly &&
              (CONTROL_API_ENABLED || FUNCTIONS_ENABLED) &&
              config.discoverLabel &&
              onDiscover && (
                <button
                  className="ghost-button"
                  onClick={handleDiscover}
                  type="button"
                  disabled={busy}
                >
                  {/* A spinning download arrow reads as a stuck download, not as progress. */}
                  {discovering ? (
                    <Loader2 size={16} className="icon-spin" />
                  ) : (
                    <DownloadCloud size={16} />
                  )}
                  {discovering ? "Mengambil dari Google..." : config.discoverLabel}
                </button>
              )}
            {!readOnly && (
              <button className="primary-button" onClick={onAdd} type="button">
                <Plus size={16} />
                Tambah
              </button>
            )}
          </div>
        }
      />
      <section className="panel">
        <div className="toolbar">
          <div className="toolbar-filters">
            <input
              className="control search"
              placeholder={config.searchPlaceholder || "Cari data..."}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                pagination.setPage(1);
              }}
            />
            {dateFilterField && (
              <DateRangePicker
                label={`Rentang tanggal ${config.singular || "data"}`}
                onChange={(range) => {
                  setDateRange(range);
                  pagination.setPage(1);
                }}
                value={dateRange}
              />
            )}
          </div>
          <div className="table-tools">
            {filters.map((filter) => (
              <SelectField
                key={filter.field}
                ariaLabel={filter.label}
                className="compact-control"
                value={filterValues[filter.field] || ""}
                onChange={(value) => {
                  setFilterValues((current) => ({ ...current, [filter.field]: value }));
                  pagination.setPage(1);
                }}
                options={[
                  { value: "", label: filter.label },
                  ...toSelectOptions(filterOptions[filter.field], filter.formatOption),
                ]}
              />
            ))}
            <SelectField
              ariaLabel="Jumlah baris per halaman"
              className="page-size-control"
              value={pagination.pageSize}
              onChange={(next) => pagination.setPageSize(Number(next))}
              options={toSelectOptions(PAGE_SIZE_OPTIONS, (option) => `${option} baris`)}
            />
            <span>
              {loading
                ? "Menyinkronkan..."
                : `${pagination.rangeStart}-${pagination.rangeEnd} dari ${pagination.total} data`}
            </span>
          </div>
        </div>
        <DataTable
          columns={config.columns}
          items={pagination.visibleItems}
          sort={sort}
          onSortChange={setSort}
          extraAction={(item) => (
            <div className="action-group">
              {/*
                Dua jalur, dan yang kedua yang hidup hari ini: server kontrol menjalankan consent
                Google tanpa lewat `allUsers`, jadi DRS tidak menyentuhnya. `FUNCTIONS_ENABLED`
                tetap dibaca supaya jalur Cloud Function lama tidak mati begitu saja kalau DRS
                dilonggarkan.
              */}
              {!readOnly &&
                (CONTROL_API_ENABLED || FUNCTIONS_ENABLED) &&
                config.authActionField &&
                onAuthAction && (
                  <button
                    className="ghost-button success"
                    onClick={() => onAuthAction(item)}
                    type="button"
                  >
                    {item[config.authActionField] === "Connected" ? "Reconnect" : "Login"}
                  </button>
                )}
              {config.detailLabel && onView && (
                <button className="ghost-button" onClick={() => onView(item.id)} type="button">
                  {config.detailLabel}
                </button>
              )}
              {canEdit && (
                <button className="ghost-button" onClick={() => onEdit(item.id)} type="button">
                  <Pencil size={14} />
                  Edit
                </button>
              )}
              {!readOnly && (
                <button
                  className="danger-button"
                  onClick={() => setPendingDelete(item)}
                  type="button"
                >
                  <Trash2 size={14} />
                  Arsipkan
                </button>
              )}
            </div>
          )}
        />
        {/* Ringkasan dan paging berbagi satu baris. Ringkasan digambar di luar TablePagination
            karena komponen itu menghilang saat isinya cuma satu halaman — dan total sebulan justru
            paling sering dibaca saat datanya sedikit. */}
        <div className="table-footer">
          {summary.length > 0 && (
            <div className="table-summary">
              {summary.map((entry) => (
                <span className="summary-item" key={entry.field}>
                  {entry.label}
                  <strong>{formatRupiah(entry.value)}</strong>
                </span>
              ))}
            </div>
          )}
          <TablePagination
            {...pagination}
            onPageChange={pagination.setPage}
            onPageSizeChange={pagination.setPageSize}
            showPageSize={false}
            showRange={false}
          />
        </div>
      </section>
      {pendingDelete && (
        <Dialog
          busy={deleting}
          onClose={() => setPendingDelete(null)}
          subtitle={`Data "${deleteLabel}" akan dipindahkan ke arsip dan tidak tampil lagi di console.`}
          title="Arsipkan data?"
        >
          <div className="confirm-actions">
            <button
              className="ghost-button"
              disabled={deleting}
              onClick={() => setPendingDelete(null)}
              type="button"
            >
              Batal
            </button>
            <button
              className="danger-button"
              disabled={deleting}
              onClick={handleConfirmDelete}
              type="button"
            >
              <Trash2 size={14} />
              {deleting ? "Mengarsipkan..." : "Arsipkan"}
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function formatRupiah(value) {
  return `Rp ${Math.round(value).toLocaleString("id-ID")}`;
}
