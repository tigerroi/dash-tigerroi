import { getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { Eye, EyeOff } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { useTablePagination } from "../../hooks/useTablePagination";
import {
  defaultRowId,
  EMPTY_SORT,
  headerRows,
  leafColumns,
  nextSort,
  normalizeColumns,
  sortRows,
} from "../../lib/dataTable";
import { isSecretKey, renderCell } from "../../lib/renderCell";
import { ColumnHint } from "./ColumnHint";
import { TablePagination } from "./TablePagination";

/**
 * SATU-SATUNYA tabel data di dashboard ini, dibangun di atas TanStack Table (headless).
 *
 * TanStack cuma memegang model kolom dan barisnya — kepala berkelompok, baris yang bisa dibuka,
 * pilihan baris. Markupnya tetap `.data-table` milik styles.css, jadi tidak ada satu pun warna
 * yang datang dari library dan tema gelap ikut tanpa disentuh. Urutan dan paging juga TIDAK
 * diserahkan ke TanStack: keduanya sudah punya aturannya sendiri (`sortTableItems`,
 * `useTablePagination`), lihat `src/lib/dataTable.js`.
 *
 * Bentuk kolom: `[key, label]` atau definisi kolom TanStack — lihat `normalizeColumns`.
 *
 * `paginate` sengaja opt-in. ResourceList sudah memotong sendiri (paging-nya menyatu dengan kotak
 * pencarian di toolbar) dan mengirim baris yang sudah terpotong ke sini — memaging ulang di dalam
 * akan menampilkan dua deret tombol halaman yang saling melawan.
 */
export function DataTable({
  columns,
  items,
  extraAction,
  dense = false,
  paginate = false,
  pageSize: defaultPageSize = 10,
  paginationLabel,
  // Urutan boleh dipegang pemanggil. ResourceList memotong halaman SEBELUM mengirim barisnya ke
  // sini, jadi mengurutkan di dalam hanya akan mengurutkan 25 baris yang kebetulan sedang tampil
  // — klik "Date" di sana dulu mengurutkan halaman itu saja, bukan daftarnya.
  sort: controlledSort,
  onSortChange,
  // Urutan saat tabel pertama digambar (tetap bisa diubah lewat kepala kolom, dan klik ketiga
  // kembali ke urutan asli barisnya — bukan ke urutan ini).
  defaultSort = EMPTY_SORT,
  // Nilai yang, saat berubah, mengembalikan paging ke halaman 1: filter yang menyempitkan daftar
  // dari 12 halaman ke 2 tidak boleh meninggalkan orang di halaman 7 yang dijepit ke halaman 2.
  pageResetKey,
  className = "",
  // Kelas dasar tabelnya. Hampir selalu `.data-table`; tabel ROI realtime membawa rupanya sendiri
  // (`.master-roi-table`: kepala kelompok berwarna, lebar 2100px) dan tidak boleh ditimpa padding
  // dan latar `.data-table` — varian RUPA, bukan komponen kedua.
  baseClassName = "data-table",
  wrapClassName = "",
  emptyText = "Tidak ada data.",
  getRowId = defaultRowId,
  rowClassName,
  // Baris yang bisa dibuka: `renderExpanded(item)` menggambar isinya di baris selebar tabel.
  // `expanded`/`onExpandedChange` (id baris → true) boleh dipegang pemanggil, supaya baris yang
  // terbuka bisa tinggal di alamat.
  renderExpanded,
  canExpand,
  expandedRowClassName = "data-table-expanded",
  expanded: controlledExpanded,
  onExpandedChange,
  // Pilihan baris (`{ [rowId]: true }`), untuk tabel yang barisnya MEMILIH ikut tindakan
  // berikutnya. Kotak centangnya digambar pemanggil lewat `row.getToggleSelectedHandler()`.
  rowSelection,
  onRowSelectionChange,
  canSelect,
  // Baris tambahan di bawah badan tabel (baris Total), digambar dari `footer` tiap kolom.
  showFooter,
}) {
  const [internalSort, setInternalSort] = useState(defaultSort);
  const [internalExpanded, setInternalExpanded] = useState({});
  const [visibleSecrets, setVisibleSecrets] = useState(() => new Set());
  const sort = controlledSort || internalSort;
  const expanded = controlledExpanded || internalExpanded;

  const columnDefs = useMemo(() => {
    const normalized = normalizeColumns(columns);

    if (!extraAction) {
      return normalized;
    }

    return [
      ...normalized,
      {
        id: "__actions",
        header: "Actions",
        enableSorting: false,
        cell: ({ row }) => extraAction(row.original),
        meta: { align: "right", ownCell: true },
      },
    ];
  }, [columns, extraAction]);

  // Saat dikendalikan dari luar, barisnya sudah terurut sebelum sampai ke sini.
  const sortedItems = useMemo(
    () => (controlledSort ? items || [] : sortRows(items, sort, columnDefs)),
    [controlledSort, items, sort, columnDefs],
  );
  const pagination = useTablePagination(sortedItems, defaultPageSize);
  // Disetel SAAT render, bukan lewat efek: halaman yang basi tidak boleh sempat tergambar sekali.
  const [lastResetKey, setLastResetKey] = useState(pageResetKey);
  if (lastResetKey !== pageResetKey) {
    setLastResetKey(pageResetKey);
    pagination.setPage(1);
  }

  const table = useReactTable({
    data: sortedItems,
    columns: columnDefs,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (item, index) => getRowId(item, index),
    manualSorting: true,
    manualPagination: true,
    state: {
      expanded,
      ...(rowSelection ? { rowSelection } : {}),
    },
    getRowCanExpand: (row) =>
      Boolean(renderExpanded) && (canExpand ? canExpand(row.original) : true),
    onExpandedChange: (updater) => {
      const next = typeof updater === "function" ? updater(expanded) : updater;
      (onExpandedChange || setInternalExpanded)(next);
    },
    enableRowSelection: canSelect
      ? (row) => canSelect(row.original)
      : Boolean(onRowSelectionChange),
    onRowSelectionChange: (updater) => {
      if (!onRowSelectionChange) {
        return;
      }
      onRowSelectionChange(typeof updater === "function" ? updater(rowSelection || {}) : updater);
    },
  });

  const handleSort = (key) => {
    const next = nextSort(sort, key);

    if (onSortChange) {
      onSortChange(next);
      return;
    }
    setInternalSort(next);
  };

  const toggleSecret = (id) => {
    setVisibleSecrets((current) => {
      const next = new Set(current);

      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }

      return next;
    });
  };

  const allRows = table.getRowModel().rows;
  const rows = paginate
    ? allRows.slice(pagination.rangeStart ? pagination.rangeStart - 1 : 0, pagination.rangeEnd)
    : allRows;
  const leafCount = table.getVisibleLeafColumns().length;
  const hasFooter =
    showFooter ?? leafColumns(columnDefs).some((column) => column.footer !== undefined);
  const tableClass = [baseClassName, dense ? "dense" : "", className].filter(Boolean).join(" ");

  return (
    <>
      <div className={["table-wrap", wrapClassName].filter(Boolean).join(" ")}>
        <table className={tableClass}>
          <thead>
            {headerRows(table.getHeaderGroups()).map((cells, rowIndex) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: baris kepala tidak punya identitas lain selain posisinya
              <tr key={rowIndex}>
                {cells.map(({ header, rowSpan }) => (
                  <HeaderCell
                    header={header}
                    key={header.id}
                    onSort={handleSort}
                    rowSpan={rowSpan}
                    sort={sort}
                  />
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={leafCount} className="empty">
                  {emptyText}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <Fragment key={row.id}>
                  <tr
                    className={
                      [
                        row.getIsExpanded() ? "is-expanded" : "",
                        row.getIsSelected() ? "is-selected" : "",
                        rowClassName?.(row.original) || "",
                      ]
                        .filter(Boolean)
                        .join(" ") || undefined
                    }
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td
                        className={cellClassName(cell.column.columnDef, row.original)}
                        key={cell.id}
                      >
                        <CellContent
                          cell={cell}
                          onToggleSecret={toggleSecret}
                          visibleSecrets={visibleSecrets}
                        />
                      </td>
                    ))}
                  </tr>
                  {row.getIsExpanded() && (
                    <tr className={expandedRowClassName}>
                      <td colSpan={leafCount}>{renderExpanded(row.original)}</td>
                    </tr>
                  )}
                </Fragment>
              ))
            )}
          </tbody>
          {hasFooter && rows.length > 0 && (
            <tfoot>
              {/* Grup footer PERTAMA adalah tingkat kolom daun: TanStack membalik urutan header
                  group untuk footer, jadi kepala kelompok META ADS/EARNING tidak ikut jadi baris. */}
              <tr className="data-table-total">
                {(table.getFooterGroups()[0]?.headers || []).map((header) => (
                  <td
                    className={
                      [
                        alignClass(header.column.columnDef),
                        header.column.columnDef.meta?.footerClassName,
                      ]
                        .filter(Boolean)
                        .join(" ") || undefined
                    }
                    key={header.id}
                  >
                    {renderPart(header.column.columnDef.footer, header.getContext())}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {paginate && (
        <TablePagination
          label={paginationLabel}
          page={pagination.page}
          totalPages={pagination.totalPages}
          pageSize={pagination.pageSize}
          onPageChange={pagination.setPage}
          onPageSizeChange={pagination.setPageSize}
          rangeStart={pagination.rangeStart}
          rangeEnd={pagination.rangeEnd}
          total={pagination.total}
        />
      )}
    </>
  );
}

function HeaderCell({ header, rowSpan, sort, onSort }) {
  const column = header.column;
  const def = column.columnDef;
  const meta = def.meta || {};
  const isGroup = header.subHeaders?.length > 0 && !header.isPlaceholder;
  const label = renderPart(def.header, header.getContext());
  const sortable = !isGroup && def.enableSorting !== false && Boolean(def.header);
  const className = [alignClass(def), meta.headerClassName].filter(Boolean).join(" ") || undefined;

  let content = label;

  if (sortable) {
    const text = typeof def.header === "string" ? def.header : column.id;
    const button = (
      <button
        aria-label={`Urutkan ${text}`}
        className="table-sort-button"
        onClick={() => onSort(column.id)}
        type="button"
      >
        <span>{label}</span>
        <SortIndicator active={sort.key === column.id} direction={sort.direction} />
      </button>
    );
    content = meta.hint ? (
      <span className="sort-with-hint">
        {button}
        <ColumnHint text={meta.hint} />
      </span>
    ) : (
      button
    );
  } else if (meta.hint) {
    content = (
      <>
        {label}
        <ColumnHint text={meta.hint} />
      </>
    );
  }

  return (
    <th
      className={className}
      colSpan={header.colSpan > 1 ? header.colSpan : undefined}
      rowSpan={rowSpan > 1 ? rowSpan : undefined}
    >
      {content}
    </th>
  );
}

function CellContent({ cell, visibleSecrets, onToggleSecret }) {
  const def = cell.column.columnDef;
  const renderKey = def.meta?.renderKey;

  // Kolom bentuk lama `[key, label]`: `renderCell` yang memutuskan rupanya dari NAMA kolomnya.
  if (renderKey !== undefined) {
    const value = cell.getValue();

    if (isSecretKey(renderKey)) {
      const id = cell.id;
      return (
        <SecretCell
          id={id}
          onToggle={onToggleSecret}
          value={value}
          visible={visibleSecrets.has(id)}
        />
      );
    }

    return renderCell(value, renderKey);
  }

  if (!def.meta?.ownCell) {
    return renderCell(cell.getValue(), cell.column.id);
  }

  return renderPart(def.cell, cell.getContext());
}

/**
 * `header`/`cell`/`footer` kolom DIPANGGIL sebagai fungsi biasa, bukan lewat `flexRender` TanStack.
 *
 * `flexRender` menjadikan fungsinya TIPE KOMPONEN (`createElement(cell, props)`), dan definisi kolom
 * di dashboard ini ditulis inline — fungsi baru tiap render. Bagi React tipe baru berarti komponen
 * lain: seluruh isi sel DIPASANG ULANG tiap render. Yang hilang karenanya tidak berbunyi sebagai
 * error apa pun: secret OTP yang baru dibuka tertutup lagi di detak berikutnya, pemilih subdomain
 * kehilangan menunya, tombol "Meng-enroll..." kembali jadi "Enroll" di tengah permintaan.
 *
 * Konsekuensinya mengikat pemanggil: fungsi `cell` TIDAK BOLEH memanggil hook. Keadaan milik sel
 * ditaruh di komponen bernama yang dikembalikannya (`<OtpSecret>`, `<SiteActions>`) — tipe yang
 * stabil, jadi keadaannya bertahan.
 */
function renderPart(part, context) {
  return typeof part === "function" ? part(context) : (part ?? null);
}

function alignClass(def) {
  const align = def.meta?.align;
  return align === "right" || align === "center" ? align : "";
}

function cellClassName(def, item) {
  const extra =
    typeof def.meta?.className === "function" ? def.meta.className(item) : def.meta?.className;
  return [alignClass(def), extra].filter(Boolean).join(" ") || undefined;
}

function SecretCell({ id, value, visible, onToggle }) {
  const Icon = visible ? EyeOff : Eye;
  const text = value || "-";

  return (
    <span className="secret-cell">
      <span className={visible ? "" : "secret"}>{visible ? text : "********"}</span>
      <button
        aria-label={visible ? "Sembunyikan password" : "Lihat password"}
        className="secret-toggle-button"
        onClick={() => onToggle(id)}
        type="button"
      >
        <Icon size={15} />
      </button>
    </span>
  );
}

function SortIndicator({ active, direction }) {
  if (!active || !direction) {
    return <span className="sort-indicator">↕</span>;
  }

  return <span className="sort-indicator active">{direction === "asc" ? "↑" : "↓"}</span>;
}
