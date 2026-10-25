import { SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { Dialog } from "./Dialog";

/**
 * Kontrol filter sebuah panel, dilipat ke dalam dialog di balik satu ikon.
 *
 * Dipakai saat kontrolnya sudah terlalu banyak untuk berdiri di header — lima kontrol berjejer
 * membuat judul panelnya terdesak dan pada layar sempit mereka membungkus jadi dua baris yang
 * mendorong tabel di bawahnya.
 *
 * Harganya nyata dan harus dibayar di sini: filter yang tersembunyi adalah filter yang bisa aktif
 * tanpa ada yang tahu, dan orang akan membaca grafik satu advertiser sebagai grafik seluruh bisnis.
 * Karena itu `activeCount` wajib — ikonnya membawa lencana angka selama ada filter yang menyimpang
 * dari default, dan pemanggilnya tetap menuliskan ringkasannya sebagai teks di dekat judul panel.
 */
export function FilterDialog({
  title,
  description = "",
  activeCount = 0,
  label = "Filter",
  onReset,
  children,
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        aria-expanded={open}
        className={`filter-trigger ${activeCount > 0 ? "is-active" : ""}`.trim()}
        onClick={() => setOpen(true)}
        title={
          activeCount > 0
            ? `${activeCount} filter sedang aktif. Klik untuk mengubahnya.`
            : "Atur filter panel ini"
        }
        type="button"
      >
        <SlidersHorizontal size={15} />
        <span>{label}</span>
        {activeCount > 0 && <span className="filter-trigger-count">{activeCount}</span>}
      </button>

      {open && (
        <Dialog
          className="filter-dialog"
          headClassName="filter-dialog-head"
          onClose={() => setOpen(false)}
          subtitle={description}
          title={title}
        >
          <div className="filter-dialog-body">{children}</div>

          <footer className="filter-dialog-foot">
            {/* Reset hanya muncul kalau memang ada yang bisa direset. Tombol yang selalu ada tapi
                sering tidak melakukan apa-apa mengajari orang untuk tidak memercayainya. */}
            {onReset && activeCount > 0 ? (
              <button className="ghost-button" onClick={onReset} type="button">
                Reset filter
              </button>
            ) : (
              <span />
            )}
            {/* "Selesai", bukan "Terapkan": kontrol di dalamnya menulis langsung ke grafik, jadi
                tidak ada apa pun yang menunggu dikonfirmasi. Tombol bernama "Terapkan" akan
                menjanjikan sesuatu yang sudah terjadi sejak tadi. */}
            <button className="primary-button" onClick={() => setOpen(false)} type="button">
              Selesai
            </button>
          </footer>
        </Dialog>
      )}
    </>
  );
}
