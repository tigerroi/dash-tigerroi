import { useState } from "react";

// Badge kecil di dalam sel tabel yang membuka rinciannya saat hover, fokus keyboard, atau tap.
//
// Panelnya position: fixed dan dikoordinatkan dari getBoundingClientRect. Tabel ROI punya scroll
// sendiri (max-height + overflow), jadi panel yang absolute di dalam sel akan terpotong tepi tabel
// justru pada baris yang paling perlu dibaca — yang paling bawah.
//
// Dipakai badge "Campaign digabung" dan rincian negara. Keduanya duduk di tabel yang sama dan
// punya persoalan pemosisian yang sama; dua salinan logika ini akan berbeda pada tabel ketiga.
export function CellPopover({
  label,
  badgeClassName = "",
  panelClassName = "",
  width = 292,
  children,
}) {
  const [anchor, setAnchor] = useState(null);

  const open = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    // Menempel persis di bawah badge, tanpa jarak: panel ini anak DOM dari wrapper, jadi selama
    // kursor tidak melewati celah kosong di antaranya, daftar yang panjang masih bisa di-scroll.
    // Kiri dijepit ke lebar layar supaya kolom paling kanan tidak membuka panel di luar viewport.
    setAnchor({
      left: Math.min(rect.left, Math.max(8, window.innerWidth - width - 8)),
      top: rect.bottom,
    });
  };
  const close = () => setAnchor(null);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: pembungkus non-interaktif ini sengaja ikut memantau hover supaya panel tetap terbuka saat kursor masuk ke dalamnya; tombol di dalamnya yang memegang peran interaktif dan jalur keyboardnya.
    <span className="cell-popover" onMouseEnter={open} onMouseLeave={close}>
      <button
        aria-expanded={Boolean(anchor)}
        className={`cell-popover-badge ${badgeClassName}`.trim()}
        onBlur={close}
        onFocus={open}
        type="button"
      >
        {label}
      </button>
      {anchor ? (
        <span
          className={`cell-popover-panel ${panelClassName}`.trim()}
          style={{ left: anchor.left, top: anchor.top, width }}
        >
          {children}
        </span>
      ) : null}
    </span>
  );
}
