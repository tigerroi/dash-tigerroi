// Logika murni di balik `DataTable` (src/components/ui/DataTable.jsx), dipisah dari JSX-nya supaya
// bisa dites dengan `node --test`. TanStack Table yang memegang model kolom dan barisnya; yang
// ditulis di sini adalah aturan yang MILIK dashboard ini dan tidak boleh diserahkan ke bawaan
// library: siklus klik urutan, sel kosong yang selalu di bawah, dan bentuk kolom lama `[key, label]`.

import { sortTableItems } from "./sortTableItems.js";

export const EMPTY_SORT = { key: "", direction: "" };

/**
 * Menerima dua bentuk kolom, dan keduanya boleh bercampur dalam satu daftar:
 *
 * - `[key, label]` — bentuk lama, dipakai `resources.js` dan pemanggil sederhana. Selnya digambar
 *   `renderCell(value, key)`, dan label kosong berarti kolom itu tidak bisa diurutkan.
 * - definisi kolom TanStack (`{ id | accessorKey | accessorFn, header, cell, footer, columns, meta }`).
 *   `meta` yang dikenali DataTable: `align` ("right" | "center"), `hint` (rumus di `ColumnHint`),
 *   `headerClassName`, `className` (teks atau fungsi baris → teks), `footerClassName`, dan `sortValue` (baris → nilai
 *   yang diurutkan, kalau yang digambar bukan nilai yang pantas diurutkan).
 *
 * Bentuk lama tidak dihapus: ada puluhan resource yang kolomnya memang cuma field + judul, dan
 * menuliskannya sebagai objek hanya menambah baris tanpa menambah arti.
 */
export function normalizeColumns(columns) {
  return (Array.isArray(columns) ? columns : []).map(normalizeColumn);
}

function normalizeColumn(column, index) {
  if (Array.isArray(column)) {
    const [key, label] = column;

    return {
      id: key || label || `column-${index}`,
      // `accessorFn`, bukan `accessorKey`: TanStack membaca kunci bertitik sebagai path bersarang,
      // sementara `renderCell` dan `sortTableItems` membacanya sebagai satu nama field.
      accessorFn: (item) => item?.[key],
      header: label || "",
      enableSorting: Boolean(label),
      meta: { renderKey: key },
    };
  }

  const id =
    column.id ||
    column.accessorKey ||
    (typeof column.header === "string" && column.header) ||
    `column-${index}`;
  // `ownCell` dicatat SEKARANG, sebelum TanStack menggabungkan kolom dengan `defaultColumn`-nya:
  // sesudah itu `columnDef.cell` selalu terisi (bawaan: nilai mentah jadi teks), dan kolom tanpa
  // `cell` kehilangan `renderCell` — "1200000" alih-alih "Rp 1.200.000", tanpa satu pun error.
  const normalized = {
    ...column,
    id,
    meta: { ...column.meta, ownCell: column.cell !== undefined },
  };

  if (Array.isArray(column.columns)) {
    // Kolom KELOMPOK (kepala di atas beberapa kolom) tidak diurutkan sendiri; yang diurutkan anaknya.
    normalized.columns = column.columns.map(normalizeColumn);
    normalized.enableSorting = false;
  } else if (column.enableSorting === undefined) {
    normalized.enableSorting = Boolean(column.header) && hasSortableValue(column);
  }

  return normalized;
}

function hasSortableValue(column) {
  return Boolean(column.accessorKey || column.accessorFn || column.meta?.sortValue);
}

// Klik pertama naik, klik kedua turun, klik ketiga kembali ke urutan aslinya — ditulis sendiri,
// bukan bawaan TanStack yang memulai kolom angka dari "turun" dan menebak jenis kolomnya.
export function nextSort(current, key) {
  if (current?.key !== key) {
    return { key, direction: "asc" };
  }

  return current.direction === "asc" ? { key, direction: "desc" } : EMPTY_SORT;
}

/** Semua kolom daun (yang benar-benar punya sel), dalam urutan tampil. */
export function leafColumns(columns) {
  return columns.flatMap((column) =>
    Array.isArray(column.columns) ? leafColumns(column.columns) : [column],
  );
}

/**
 * Mengurutkan baris lewat `sortTableItems`, dengan nilai yang dibaca dari definisi kolomnya.
 * Urutannya SENGAJA tidak diserahkan ke `getSortedRowModel` TanStack: aturan "sel kosong selalu
 * di bawah, di kedua arah" dan pembacaan "Rp 1.200.000"/"12,5%" sebagai angka sudah punya satu
 * tempat, dan pengurut kedua akan berselisih dengannya di kolom yang paling sering diklik.
 */
export function sortRows(items, sort, columns) {
  if (!sort?.key || !sort.direction) {
    return Array.isArray(items) ? items : [];
  }

  const column = leafColumns(columns).find((candidate) => candidate.id === sort.key);

  return sortTableItems(items, sort, (item) => columnValue(column, item, sort.key));
}

function columnValue(column, item, fallbackKey) {
  if (column?.meta?.sortValue) {
    return column.meta.sortValue(item);
  }

  if (column?.accessorFn) {
    return column.accessorFn(item);
  }

  return item?.[column?.accessorKey ?? fallbackKey];
}

/**
 * Menyusun sel kepala tabel dari header group TanStack, dengan `rowSpan` untuk kolom yang tidak
 * punya kelompok.
 *
 * TanStack mengisi baris kepala atas dengan header PLACEHOLDER untuk kolom yang tidak berkelompok,
 * dan menaruh judul aslinya di baris paling bawah. Digambar apa adanya, kolom "Date" di tabel ROI
 * berdiri sebagai sel kosong di atas dan judul di bawah — dua sel untuk satu kolom, dan garis
 * kepala kelompok META ADS/EARNING kehilangan satu-satunya yang membedakannya dari judul kolom.
 * Yang digambar di sini: placeholder teratas MEMBAWA judulnya dan membentang ke bawah, sisanya
 * dilewati.
 *
 * Hasilnya: satu larik per baris kepala, tiap selnya `{ header, rowSpan }` — `header` adalah header
 * yang judulnya digambar (header daun untuk sel yang membentang).
 */
export function headerRows(headerGroups) {
  const depth = headerGroups.length;
  const spanned = new Set();
  const leafHeaderOf = new Map();

  for (const header of headerGroups[depth - 1]?.headers || []) {
    leafHeaderOf.set(header.column.id, header);
  }

  return headerGroups.map((group, rowIndex) =>
    group.headers.flatMap((header) => {
      const columnId = header.column.id;

      if (spanned.has(columnId)) {
        return [];
      }

      if (header.isPlaceholder) {
        spanned.add(columnId);
        return [
          {
            header: leafHeaderOf.get(columnId) || header,
            rowSpan: depth - rowIndex,
          },
        ];
      }

      return [{ header, rowSpan: 1 }];
    }),
  );
}

export function defaultRowId(item, index) {
  return String(item?.id ?? item?.no ?? index);
}
