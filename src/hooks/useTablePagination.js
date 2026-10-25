import { useMemo, useState } from "react";

export const PAGE_SIZE_OPTIONS = [10, 25, 50];

/**
 * Paging untuk tabel yang datanya sudah ada di memori.
 *
 * Semua tabel di dashboard ini menerima seluruh isinya sekaligus dari store, jadi yang dibatasi
 * hanya jumlah baris yang digambar — tidak ada permintaan tambahan ke Firebase per halaman.
 *
 * Dipakai SETELAH pengurutan, bukan sebelumnya: memotong dulu baru mengurutkan hanya akan
 * mengurutkan sepuluh baris yang kebetulan ada di halaman itu, dan kolom ROI yang diklik akan
 * memberi jawaban berbeda tiap halaman.
 */
export function useTablePagination(items, defaultPageSize = 10) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultPageSize);
  const rows = Array.isArray(items) ? items : [];
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  // Dijepit, bukan disetel ulang lewat efek: jumlah baris bisa menyusut kapan saja (sync masuk,
  // range tanggal diubah, pencarian diketik), dan halaman 7 dari 3 harus sudah menggambar
  // sesuatu pada render yang sama — bukan sesudah render kedua.
  const activePage = Math.min(page, totalPages);
  const visibleItems = useMemo(
    () => rows.slice((activePage - 1) * pageSize, activePage * pageSize),
    [rows, activePage, pageSize],
  );

  return {
    visibleItems,
    page: activePage,
    setPage,
    pageSize,
    setPageSize: (size) => {
      setPageSize(size);
      // Halaman 4 pada 10/halaman menampilkan baris 31-40; pada 50/halaman baris itu ada di
      // halaman 1, jadi bertahan di halaman 4 akan melompat melewati data yang sedang dibaca.
      setPage(1);
    },
    totalPages,
    total,
    rangeStart: total === 0 ? 0 : (activePage - 1) * pageSize + 1,
    rangeEnd: Math.min(activePage * pageSize, total),
  };
}
