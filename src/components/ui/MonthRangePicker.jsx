import { CalendarRange, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { monthKeyOf } from "../../lib/dateRange";
import { formatMonth } from "../../lib/formatDate";
import {
  isWholeMonthSpan,
  monthKeysAround,
  monthSpanOf,
  monthSpanRange,
} from "../../lib/monthRangeUtil";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

/**
 * Label tombolnya. Yang dipilih di sini selalu SATU bulan ("Agu 2026"); bentuk "Jun – Agu 2026"
 * tetap digambar karena rentang beberapa bulan masih bisa datang dari alamat lama.
 *
 * Rentang yang BUKAN bulan penuh disebut apa adanya, bukan dibulatkan jadi nama bulan: sebuah
 * alamat lama berbentuk "1–20 Agustus" masih dipakai menghitung, dan tombol yang berbunyi "Agu
 * 2026" untuk periode itu adalah satu-satunya keterangan di layar tentang apa yang sedang disaring
 * — dan ia berbohong.
 */
function describeMonthRange(range) {
  const span = monthSpanOf(range);
  if (!isWholeMonthSpan(range)) return `${formatMonth(span.from)} (sebagian)`;
  return span.from === span.to
    ? formatMonth(span.from)
    : `${formatMonth(span.from)} – ${formatMonth(span.to)}`;
}

/**
 * Pemilih SATU BULAN untuk halaman Accounting.
 *
 * KENAPA BUKAN `DateRangePicker` yang dipakai seluruh dashboard. Seluruh rantai di grup ini
 * bertumpu pada tiga sumber yang berdiri per BULAN dan tidak bisa dibelah per hari — nominal
 * invalid traffic, earning akun yang ditutup, dan potongan pencairan — dan ketiganya hanya ikut
 * kalau rentangnya menutup bulannya PENUH (`wholeMonthsIn`). Dengan pemilih harian, rentang yang
 * meleset sehari menjatuhkan ketiganya sekaligus: labanya naik belasan juta, dan satu-satunya
 * tanda di layar adalah satu kalimat kecil di bawah tabel. Pemilih ini tidak bisa menghasilkan
 * batas seperti itu sama sekali — setiap pilihannya menutup bulannya.
 *
 * SATU bulan, bukan rentang beberapa bulan: itu satuan yang dipakai orang di grup ini — tarif
 * Company, pencairan, invalid traffic, dan target semuanya berdiri per bulan — dan bawaan ketiga
 * halaman memang sudah satu bulan penuh sejak awal. Beberapa bulan sekaligus MENJUMLAHKAN angka
 * yang justru dibandingkan orang satu sama lain, dan kolom Selisih di layar kehilangan artinya:
 * pembandingnya jadi periode sepanjang itu juga, bukan bulan sebelumnya.
 *
 * Alamatnya TETAP `?periode=` dengan bentuk `from..to` yang sama, jadi tautan yang sudah beredar
 * tidak mati dan ketiga tab tetap berbicara satu kosakata periode. Rentang lama — beberapa bulan
 * maupun potongan hari — tetap DIPAKAI apa adanya dan disebutkan oleh label tombolnya; yang
 * menolak menggambarkannya akan tampil kosong di atas tabel yang justru berisi. Yang tersorot di
 * petak bulan untuk rentang seperti itu adalah bulan TERAKHIRNYA, yaitu bulan yang akan dipilih
 * kalau orangnya menekan Perbarui tanpa mengubah apa pun.
 */
export function MonthRangePicker({ value, onChange, label = "Periode bulanan" }) {
  const [open, setOpen] = useState(false);
  const now = useMemo(() => new Date(), []);
  const thisMonth = monthKeyOf(now);
  const span = monthSpanOf(value);

  const [draft, setDraft] = useState(span.to);
  const [year, setYear] = useState(Number(span.to.slice(0, 4)));

  // Saat dibuka, draft dan tahun yang tampak disetel ulang dari nilai TERKINI — bukan dari draft
  // yang ditinggalkan sesi sebelumnya, yang mungkin sudah dibatalkan.
  useEffect(() => {
    if (!open) return;
    const current = monthSpanOf(value);
    setDraft(current.to);
    setYear(Number(current.to.slice(0, 4)));
  }, [open, value]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Preset yang menjangkau beberapa bulan ("3 bulan terakhir", "Tahun berjalan") ikut hilang
  // bersama pemilihan rentangnya: sebuah preset yang tidak bisa dihasilkan petak di sebelahnya
  // adalah dua aturan berbeda di satu dialog.
  const presets = [
    { label: "Bulan ini", month: thisMonth },
    { label: "Bulan lalu", month: shift(thisMonth, -1) },
  ];

  const commit = () => {
    onChange(monthSpanRange(draft, draft));
    setOpen(false);
  };

  return (
    <>
      <button
        aria-expanded={open}
        aria-label={label}
        className="daterange-trigger"
        onClick={() => setOpen((v) => !v)}
        type="button"
      >
        <CalendarRange size={15} />
        <span>{describeMonthRange(value)}</span>
        <ChevronRight className="daterange-trigger-caret" size={14} />
      </button>

      {open &&
        createPortal(
          <div className="modal-backdrop" role="presentation">
            {/* Klik di luar menutup — tombol tersendiri di belakang dialog, bukan onClick di atas
                <div> backdrop yang tidak bisa dijangkau keyboard. */}
            <button
              aria-label="Tutup"
              className="daterange-scrim"
              onClick={() => setOpen(false)}
              type="button"
            />
            <div aria-label={label} className="daterange-pop monthrange-pop" role="dialog">
              <div className="daterange-body">
                <ul className="daterange-presets">
                  {presets.map((preset) => (
                    <li key={preset.label}>
                      <button
                        className={`daterange-preset${draft === preset.month ? " is-active" : ""}`}
                        onClick={() => {
                          setDraft(preset.month);
                          setYear(Number(preset.month.slice(0, 4)));
                        }}
                        type="button"
                      >
                        <span className="daterange-radio" />
                        {preset.label}
                      </button>
                    </li>
                  ))}
                </ul>

                <div className="daterange-cal-area">
                  <div className="daterange-cal-head">
                    <button
                      aria-label="Tahun sebelumnya"
                      className="daterange-nav"
                      onClick={() => setYear((y) => y - 1)}
                      type="button"
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <strong>{year}</strong>
                    <button
                      aria-label="Tahun berikutnya"
                      className="daterange-nav"
                      onClick={() => setYear((y) => y + 1)}
                      type="button"
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>

                  <div className="monthrange-grid">
                    {monthKeysAround(year).map((key, index) => {
                      const classes = ["monthrange-cell"];
                      if (key === draft) classes.push("is-selected");
                      if (key === thisMonth) classes.push("is-today");
                      return (
                        <button
                          aria-pressed={key === draft}
                          className={classes.join(" ")}
                          key={key}
                          onClick={() => setDraft(key)}
                          type="button"
                        >
                          {MONTHS[index]}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="daterange-foot">
                <div className="daterange-actions">
                  <button className="ghost-button" onClick={() => setOpen(false)} type="button">
                    Batal
                  </button>
                  <button
                    className="primary-button"
                    disabled={!draft}
                    onClick={commit}
                    type="button"
                  >
                    Perbarui
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

function shift(key, delta) {
  const [year, month] = key.split("-").map(Number);
  const date = new Date(year, month - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}
