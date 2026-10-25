import { RefreshCw } from "lucide-react";

/**
 * Tombol "Segarkan" untuk panel yang MEMBACA langsung dari sumbernya (Meta, Cloudflare, situs
 * WordPress, vi-control). Ditulis lima kali sebelum ini, dengan tiga bunyi berbeda untuk keadaan
 * yang sama ("Membaca...", "Menyegarkan...", "Menyegarkan…").
 *
 * Ikonnya BERPUTAR selama `busy`, bukan cuma tombolnya dimatikan: pembacaan lewat server kontrol
 * makan waktu sedetik lebih, dan tombol yang cuma jadi abu-abu tidak bisa dibedakan dari tombol yang
 * memang tidak boleh ditekan. `busy` adalah pembacaan yang DIMINTA orang — putaran polling latar
 * tidak memutarnya, karena indikator yang menyala tiap tiga detik berhenti berarti apa-apa.
 */
export function RefreshButton({
  onClick,
  busy = false,
  disabled = false,
  className = "ghost-button",
  size = 15,
  title,
}) {
  return (
    <button
      className={className}
      disabled={busy || disabled}
      onClick={onClick}
      title={title}
      type="button"
    >
      <RefreshCw className={busy ? "icon-spin" : undefined} size={size} />
      <span>{busy ? "Membaca..." : "Segarkan"}</span>
    </button>
  );
}
