import { CircleQuestionMark, Info } from "lucide-react";
import { useState } from "react";

// Lebar maksimum kotak keterangan, disalin dari `.column-hint-box` di styles.css. Dipakai untuk
// menahan kotaknya di dalam layar; satu-satunya angka yang memang harus ada di kedua tempat, karena
// yang memposisikan kotak fixed adalah JS dan yang menggambarnya CSS.
const HINT_WIDTH = 280;

/**
 * Ikon "?" di kepala kolom: rumusnya muncul saat disentuh kursor.
 *
 * Ini bukan pengecualian dari aturan "tanpa satu pun kalimat prosa" di halaman ini, melainkan
 * bentuk yang sama dengan `MetaSpendNote`: yang dijelaskan bukan KEADAAN sebuah baris (itu tetap
 * urusan kolom dan `RowNote`) melainkan DEFINISI kolomnya — dan definisi tidak berubah dari baris
 * ke baris, jadi tempatnya di kepala kolom, sekali, dan hanya untuk yang memintanya.
 *
 * Kotaknya `position: fixed` dan koordinatnya diukur saat kursor masuk, BUKAN kotak absolut di
 * dalam `<th>`: tabel ini menggulir mendatar di dalam `.table-wrap` yang `overflow-x: auto`, dan
 * apa pun yang digambar di dalamnya terpotong tepi kotak itu — persis di kolom-kolom terakhir,
 * yaitu yang punya ikon ini. `title` bawaan browser sempat dipakai dan tidak cukup: munculnya
 * bertunda sedetik, gayanya milik OS, dan di sebagian mesin ia tidak muncul sama sekali.
 *
 * Tombol, bukan `<span>`: keterangannya harus bisa dicapai lewat keyboard (Tab lalu baca), dan di
 * layar sentuh yang tidak punya "hover" sama sekali, ketukanlah yang membukanya. Ketukan itu
 * MEMBUKA, tidak menutup-kalau-sudah-terbuka: layar sentuh mengirim `mouseenter` lebih dulu, jadi
 * saklar buka-tutup akan menutup kotak yang baru saja dibuka ketukan yang sama — dan yang terlihat
 * orang adalah ikon yang tidak melakukan apa-apa. Yang menutupnya `blur` (menyentuh tempat lain).
 *
 * `icon="info"` untuk keterangan sebuah FIELD (form plugin), "?" untuk rumus sebuah KOLOM. Dua
 * pertanyaan yang berbeda — "apa arti kolom ini" dan "apa yang boleh saya isi di sini" — dan satu
 * ikon untuk keduanya membuat yang kedua terbaca seperti kolom yang butuh dijelaskan. Yang TIDAK
 * ikut bercabang adalah kotaknya: satu bentuk, satu posisi, satu cara menutupnya.
 */
export function ColumnHint({ text, icon = "question" }) {
  const Icon = icon === "info" ? Info : CircleQuestionMark;
  const [box, setBox] = useState(null);

  const show = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const half = HINT_WIDTH / 2;
    // Ditahan di dalam layar: ikon ini duduk di kolom paling kanan tabel, dan kotak yang berpusat
    // tepat di atasnya akan menggantung separuh di luar jendela.
    const center = Math.min(
      Math.max(rect.left + rect.width / 2, half + 8),
      window.innerWidth - half - 8,
    );
    setBox({ top: rect.bottom + 8, left: center });
  };

  const hide = () => setBox(null);

  return (
    <span className="column-hint">
      <button
        aria-label={text}
        className="column-hint-button"
        onBlur={hide}
        onClick={show}
        onFocus={show}
        onMouseEnter={show}
        onMouseLeave={hide}
        type="button"
      >
        <Icon aria-hidden="true" size={13} />
      </button>
      {box && (
        <span className="column-hint-box" role="tooltip" style={{ left: box.left, top: box.top }}>
          {text}
        </span>
      )}
    </span>
  );
}
