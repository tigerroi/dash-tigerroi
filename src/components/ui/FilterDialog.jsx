import { SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { Dialog } from "./Dialog";
import { useLanguage } from "../../context/LanguageContext";

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
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);

  const displayTitle = t(title, title);
  const displayDescription = description ? t(description, description) : "";
  const displayLabel = t(label, label);

  return (
    <>
      <button
        aria-expanded={open}
        className={`filter-trigger ${activeCount > 0 ? "is-active" : ""}`.trim()}
        onClick={() => setOpen(true)}
        title={
          activeCount > 0
            ? `${activeCount} ${t("filter sedang aktif. klik untuk mengubahnya.", "filter sedang aktif. Klik untuk mengubahnya.")}`
            : t("atur filter panel ini", "Atur filter panel ini")
        }
        type="button"
      >
        <SlidersHorizontal size={15} />
        <span>{displayLabel}</span>
        {activeCount > 0 && <span className="filter-trigger-count">{activeCount}</span>}
      </button>

      {open && (
        <Dialog
          className="filter-dialog"
          headClassName="filter-dialog-head"
          onClose={() => setOpen(false)}
          subtitle={displayDescription}
          title={displayTitle}
        >
          <div className="filter-dialog-body">{children}</div>

          <footer className="filter-dialog-foot">
            {/* Reset hanya muncul kalau memang ada yang bisa direset. Tombol yang selalu ada tapi
                sering tidak melakukan apa-apa mengajari orang untuk tidak memercayainya. */}
            {onReset && activeCount > 0 ? (
              <button className="ghost-button" onClick={onReset} type="button">
                {t("reset filter", "Reset filter")}
              </button>
            ) : (
              <span />
            )}
            {/* "Selesai", bukan "Terapkan": kontrol di dalamnya menulis langsung ke grafik, jadi
                tidak ada apa pun yang menunggu dikonfirmasi. Tombol bernama "Terapkan" akan
                menjanjikan sesuatu yang sudah terjadi sejak tadi. */}
            <button className="primary-button" onClick={() => setOpen(false)} type="button">
              {t("selesai", "Selesai")}
            </button>
          </footer>
        </Dialog>
      )}
    </>
  );
}
