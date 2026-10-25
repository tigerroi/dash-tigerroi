import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { datePresets, matchDatePreset, parseDateLike, toDateKey } from "../../lib/dateRange";
import { formatDate } from "../../lib/formatDate";

const WEEKDAYS = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

// Label tombol: nama preset kalau rentangnya persis salah satunya ("Hari Ini", "7 hari terakhir"),
// kalau tidak tanggalnya sendiri. Tak pernah "undefined–undefined" — kosong berarti "Semua tanggal".
export function describeDateRange(from, to, now = new Date()) {
  const preset = matchDatePreset(from, to, now);
  if (preset) return preset.label;
  if (from && to) {
    return from === to ? formatDate(from) : `${formatDate(from)} – ${formatDate(to)}`;
  }
  if (from) return `Sejak ${formatDate(from)}`;
  return `Sampai ${formatDate(to)}`;
}

function monthMatrix(year, month) {
  const first = new Date(year, month, 1);
  const lead = first.getDay(); // 0 = Minggu, mengikuti urutan kolom
  const days = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(toDateKey(new Date(year, month, d)));
  return cells;
}

function shiftMonth(view, delta) {
  const date = new Date(view.year, view.month + delta, 1);
  return { year: date.getFullYear(), month: date.getMonth() };
}

/**
 * Pemilih rentang tanggal ala Ads Manager: daftar preset di kiri, dua bulan kalender di kanan.
 *
 * Dikendalikan dari luar lewat `value={{ from, to }}` (ISO `YYYY-MM-DD`, kosong = tak berbatas) dan
 * `onChange`. Perubahan ditahan sebagai draft sampai tombol "Perbarui" ditekan — sama seperti dialog
 * aslinya, supaya menggeser kalender tidak memuat ulang tabel di setiap klik. "Batal" membuang draft.
 */
export function DateRangePicker({ value, onChange, align = "left", label = "Rentang tanggal" }) {
  const from = value?.from || "";
  const to = value?.to || "";
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ from, to });
  const now = useMemo(() => new Date(), []);
  const presets = useMemo(() => datePresets(now), [now]);

  // Bulan yang tampak di kalender kiri; kanan selalu satu bulan sesudahnya.
  const anchor = parseDateLike(to || from) || now;
  const [view, setView] = useState({ year: anchor.getFullYear(), month: anchor.getMonth() });

  // Saat dibuka, draft & tampilan kalender disetel ulang dari nilai terkini — bukan dari draft yang
  // ditinggalkan sesi sebelumnya (yang mungkin sudah dibatalkan).
  useEffect(() => {
    if (!open) return;
    setDraft({ from, to });
    const base = parseDateLike(to || from) || new Date();
    setView({ year: base.getFullYear(), month: base.getMonth() });
  }, [open, from, to]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const activePreset = matchDatePreset(draft.from, draft.to, now);
  const todayKey = toDateKey(now);

  const pickDay = (key) => {
    setDraft((current) => {
      // Belum ada awalan, atau rentang sudah lengkap → mulai rentang baru dari sini.
      if (!current.from || (current.from && current.to)) {
        return { from: key, to: "" };
      }
      // Sudah ada awalan, ini akhirannya — dibalik kalau diklik sebelum awalannya.
      return key < current.from ? { from: key, to: current.from } : { from: current.from, to: key };
    });
  };

  const inRange = (key) => {
    if (!draft.from) return false;
    const end = draft.to || draft.from;
    const lo = draft.from < end ? draft.from : end;
    const hi = draft.from < end ? end : draft.from;
    return key >= lo && key <= hi;
  };

  const applyPreset = (preset) => {
    setDraft({ from: preset.from, to: preset.to });
    const base = parseDateLike(preset.to || preset.from) || new Date();
    setView({ year: base.getFullYear(), month: base.getMonth() });
  };

  const commit = () => {
    onChange({ from: draft.from, to: draft.to || draft.from });
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
        <CalendarDays size={15} />
        <span>{describeDateRange(from, to, now)}</span>
        <ChevronRight className="daterange-trigger-caret" size={14} />
      </button>

      {open &&
        createPortal(
          <div className="modal-backdrop" role="presentation">
            {/* Klik di luar menutup — sebagai tombol tersendiri di belakang dialog, bukan onClick di
                atas <div> backdrop (yang tak bisa dijangkau keyboard). Escape & "Batal" jalur lain. */}
            <button
              aria-label="Tutup"
              className="daterange-scrim"
              onClick={() => setOpen(false)}
              type="button"
            />
            <div
              aria-label={label}
              aria-modal="true"
              className={`daterange-pop ${align === "right" ? "align-right" : "align-left"}`}
              role="dialog"
            >
              <div className="daterange-body">
                <ul className="daterange-presets">
                  {presets.map((preset) => (
                    <li key={preset.id}>
                      <button
                        className={`daterange-preset${activePreset?.id === preset.id ? " is-active" : ""}`}
                        onClick={() => applyPreset(preset)}
                        type="button"
                      >
                        <span className="daterange-radio" />
                        {preset.label}
                      </button>
                    </li>
                  ))}
                </ul>

                <div className="daterange-cal-area">
                  <div className="daterange-cals">
                    {[0, 1].map((offset) => {
                      const m = shiftMonth(view, offset);
                      return (
                        <div className="daterange-cal" key={offset}>
                          <div className="daterange-cal-head">
                            {offset === 0 ? (
                              <button
                                aria-label="Bulan sebelumnya"
                                className="daterange-nav"
                                onClick={() => setView(shiftMonth(view, -1))}
                                type="button"
                              >
                                <ChevronLeft size={16} />
                              </button>
                            ) : (
                              <span className="daterange-nav-spacer" />
                            )}
                            <strong>
                              {MONTHS[m.month]} {m.year}
                            </strong>
                            {offset === 1 ? (
                              <button
                                aria-label="Bulan berikutnya"
                                className="daterange-nav"
                                onClick={() => setView(shiftMonth(view, 1))}
                                type="button"
                              >
                                <ChevronRight size={16} />
                              </button>
                            ) : (
                              <span className="daterange-nav-spacer" />
                            )}
                          </div>
                          <div className="daterange-grid daterange-weekdays">
                            {WEEKDAYS.map((day) => (
                              <span className="daterange-weekday" key={day}>
                                {day}
                              </span>
                            ))}
                          </div>
                          <div className="daterange-grid">
                            {monthMatrix(m.year, m.month).map((key, index) =>
                              key ? (
                                <button
                                  className={[
                                    "daterange-day",
                                    inRange(key) ? "in-range" : "",
                                    key === draft.from ? "is-start" : "",
                                    key === (draft.to || draft.from) && draft.to ? "is-end" : "",
                                    key === todayKey ? "is-today" : "",
                                  ]
                                    .filter(Boolean)
                                    .join(" ")}
                                  key={key}
                                  onClick={() => pickDay(key)}
                                  type="button"
                                >
                                  {Number(key.slice(8, 10))}
                                </button>
                              ) : (
                                // biome-ignore lint/suspicious/noArrayIndexKey: sel kosong pengisi, tak berpindah
                                <span className="daterange-day empty" key={`e${index}`} />
                              ),
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="daterange-readout">
                    <span className="daterange-field">
                      {draft.from ? formatDate(draft.from) : "—"}
                    </span>
                    <span className="daterange-dash">–</span>
                    <span className="daterange-field">
                      {draft.to || draft.from ? formatDate(draft.to || draft.from) : "—"}
                    </span>
                  </div>

                  <div className="daterange-foot">
                    <small className="daterange-tz">Tanggal ditampilkan dalam Waktu Jakarta</small>
                    <div className="daterange-actions">
                      <button className="ghost-button" onClick={() => setOpen(false)} type="button">
                        Batal
                      </button>
                      <button className="primary-button" onClick={commit} type="button">
                        Perbarui
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
