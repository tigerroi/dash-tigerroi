import { ChevronLeft, ChevronRight } from "lucide-react";
import { PAGE_SIZE_OPTIONS } from "../../hooks/useTablePagination";
import { SelectField, toSelectOptions } from "./SelectField";

/**
 * Kontrol paging di bawah sebuah tabel.
 *
 * Tidak digambar sama sekali kalau isinya cuma satu halaman: tabel enam baris tidak butuh tombol
 * "Berikutnya" yang selalu mati, dan menambah satu baris kontrol di bawah tiap panel justru
 * memperpanjang halaman yang sedang kita coba perpendek.
 */
export function TablePagination({
  page,
  totalPages,
  pageSize,
  onPageChange,
  onPageSizeChange,
  rangeStart,
  rangeEnd,
  total,
  label = "data",
  // ResourceList sudah punya keduanya di toolbar atas, berpasangan dengan kotak pencarian.
  // Mengulangnya di bawah tabel berarti dua pemilih yang mengatur hal yang sama.
  showPageSize = true,
  showRange = true,
}) {
  if (totalPages <= 1) {
    return null;
  }

  return (
    <div className="pagination">
      {showPageSize && (
        <SelectField
          ariaLabel="Jumlah baris per halaman"
          className="page-size-control"
          onChange={(next) => onPageSizeChange(Number(next))}
          options={toSelectOptions(PAGE_SIZE_OPTIONS, (option) => `${option} baris`)}
          value={pageSize}
        />
      )}
      {showRange && (
        <span className="pagination-range">
          {rangeStart}-{rangeEnd} dari {total} {label}
        </span>
      )}
      {/* Ikon dan teks berdampingan: di layar sempit teksnya yang disembunyikan, panahnya tetap
          menyisakan tombol yang bisa ditekan. Label aria dipasang supaya tombol tanpa teks itu
          tetap punya nama. */}
      <button
        className="ghost-button pagination-step"
        disabled={page === 1}
        onClick={() => onPageChange(page - 1)}
        type="button"
        aria-label="Halaman sebelumnya"
      >
        <ChevronLeft size={16} />
        <span className="pagination-step-label">Sebelumnya</span>
      </button>
      <span className="pagination-page">
        Halaman {page} dari {totalPages}
      </span>
      <button
        className="ghost-button pagination-step"
        disabled={page === totalPages}
        onClick={() => onPageChange(page + 1)}
        type="button"
        aria-label="Halaman berikutnya"
      >
        <span className="pagination-step-label">Berikutnya</span>
        <ChevronRight size={16} />
      </button>
    </div>
  );
}
