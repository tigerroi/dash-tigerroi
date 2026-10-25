import { ChevronDown, ChevronRight } from "lucide-react";

/**
 * Tombol chevron buka/tutup rincian sebuah baris (ad set di dalam campaign). Keadaannya dipegang
 * pemanggil — biasanya di alamat (`?adset=`, `?campaign=`), bukan di TanStack.
 *
 * Nama barisnya wajib ada di `label`: sepuluh tombol berlabel "Lihat" berturut-turut tidak bisa
 * dibedakan pembaca layar. Baris yang tidak bisa dibuka digambar mati berikut sebabnya di `title`,
 * bukan tombol yang gagal setelah diklik.
 */
export function ExpandToggle({ open, label, onToggle, disabled = false, title }) {
  const Icon = open ? ChevronDown : ChevronRight;
  return (
    <button
      aria-expanded={open}
      aria-label={`${open ? "Tutup" : "Lihat"} ${label}`}
      className="expand-toggle"
      disabled={disabled}
      onClick={onToggle}
      title={title}
      type="button"
    >
      <Icon size={14} />
    </button>
  );
}
