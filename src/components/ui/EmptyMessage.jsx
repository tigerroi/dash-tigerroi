/**
 * Kotak "belum ada isinya" / "sedang memuat" bergaris putus-putus. Sebelum ini ada 21 tempat yang
 * menulis kelasnya sendiri di atas tiga tag berbeda (`<p>`, `<div>`, `<section>`), dan Overview
 * punya salinan lokalnya sendiri.
 *
 * Kalimatnya harus menyebut SEBABNYA atau JALAN KELUARNYA, bukan cuma "kosong": daftar yang kosong
 * karena datanya sudah dibuang, karena filternya, dan karena memang belum ada apa-apa menuntut
 * tindakan yang berbeda. Untuk tabel, pakai `emptyText` di `DataTable` — bukan komponen ini.
 *
 * `panel` untuk yang berdiri sendiri sebagai panel (bukan di dalam panel lain).
 */
export function EmptyMessage({ panel = false, children }) {
  return (
    <div className={panel ? "panel empty-panel-message" : "empty-panel-message"}>{children}</div>
  );
}
