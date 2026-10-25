import { X } from "lucide-react";
import { useEffect, useId } from "react";
import { createPortal } from "react-dom";

/**
 * Satu-satunya dialog modal di dashboard ini. Isi dialognya milik pemanggil; yang ditulis sekali di
 * sini adalah bagian yang dulu disalin tujuh belas kali dan sudah mulai berbeda antar-salinan:
 * portal, backdrop, peran ARIA, kepala dengan tombol Tutup, dan Escape.
 *
 * - **Lewat portal ke `<body>`.** `.topbar` memakai backdrop-filter dan beberapa panel punya
 *   transform; keduanya membuat induknya jadi containing block untuk `position: fixed`, jadi
 *   backdrop `inset: 0` akan berhenti di tepi induknya alih-alih menutupi layar.
 * - **Escape menutup, KECUALI selama `busy`.** Dialog yang sedang menulis ke Meta atau ke tiga puluh
 *   situs tidak boleh hilang dari layar sebelum hasilnya datang — tombol Tutup ikut dimatikan
 *   dengan alasan yang sama. Salinan lama yang ditulis tangan sebagian lupa Escape sama sekali.
 * - **Tanpa `onClose` tidak ada tombol Tutup maupun Escape**: dialog yang cuma bisa diselesaikan
 *   lewat tombol di dalamnya.
 * - **Rupanya lewat `className`/`headClassName`**, bukan komponen kedua: `confirm-dialog`
 *   (bawaan, berpadding, isinya bebas), `sync-issues-dialog` dan `filter-dialog` (kepala/badan/kaki
 *   bergaris, isinya menggulir).
 */
export function Dialog({
  title,
  subtitle,
  onClose,
  busy = false,
  className = "confirm-dialog",
  headClassName = "dialog-head",
  children,
}) {
  const titleId = useId();

  useEffect(() => {
    if (!onClose) return undefined;
    // `defaultPrevented`: Escape yang sudah dipakai kontrol di dalam dialog (react-select menutup
    // menunya) tidak boleh ikut menutup dialognya — form "Buat campaign" yang setengah terisi
    // hilang karena orang cuma menutup dropdown.
    const onKey = (event) => {
      if (event.key === "Escape" && !event.defaultPrevented && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  return createPortal(
    <div className="modal-backdrop" role="presentation">
      <div
        aria-labelledby={title ? titleId : undefined}
        aria-modal="true"
        className={className}
        role="dialog"
      >
        {title && (
          <header className={headClassName}>
            <div>
              <h2 id={titleId}>{title}</h2>
              {subtitle && <p>{subtitle}</p>}
            </div>
            {onClose && (
              <button
                aria-label="Tutup"
                className="ghost-button icon-button"
                disabled={busy}
                onClick={onClose}
                type="button"
              >
                <X size={16} />
              </button>
            )}
          </header>
        )}
        {children}
      </div>
    </div>,
    document.body,
  );
}
