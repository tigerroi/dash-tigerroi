/**
 * Kotak centang yang MEMILIH baris untuk tindakan massal — bukan saklar keadaan (itu `Switch`).
 *
 * Satu tempat karena pemakainya dua (armada /plugin dan /campaigns): centang di tabel berarti "yang
 * ini ikut tindakan berikutnya", dan dua tulisan untuk arti yang sama akan berbeda rupa suatu hari.
 */
export function RowCheckbox({ label, checked, disabled, onChange }) {
  return (
    <input
      aria-label={label}
      checked={checked}
      disabled={disabled}
      onChange={onChange}
      type="checkbox"
    />
  );
}
