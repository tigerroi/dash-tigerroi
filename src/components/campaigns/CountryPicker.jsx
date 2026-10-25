import { Plus, X } from "lucide-react";
import { useMemo, useState } from "react";
import {
  adCountryOptions,
  countryCodesOf,
  countryText,
  extraCountryCode,
  filterCountryOptions,
} from "../../lib/adCountries";
import { flagUrl } from "../../lib/countries";

/**
 * Pemilih negara targeting: chip yang sudah dipilih di atas, daftar bercentang di bawahnya.
 *
 * NILAINYA TETAP TEKS ("SA, TR"), bukan array — itu bentuk yang sudah dibaca `createCampaignPayload`
 * dan `adSetEditState`, dan mengubahnya berarti dua aturan perbandingan targeting ikut ditulis ulang
 * untuk keuntungan yang nol. Yang berubah cuma caranya diisi.
 *
 * Kotak teks bebas sebelumnya menerima apa pun: satu salah ketik ("SAA", "Saudi") baru berbunyi
 * sebagai penolakan Meta sesudah seluruh form dikirim, dan kode dua huruf yang salah ("SE" alih-alih
 * "SA") tidak berbunyi sama sekali — ia negara yang sah, cuma bukan yang dimaksud. Bendera dan nama
 * di tiap barisnya yang menghapus kelas kesalahan itu.
 *
 * Dipakai DUA dialog (Buat campaign dan Ubah ad set) lewat komponen yang sama: dua pemilih untuk satu
 * arti berarti yang satu akan menerima kode yang ditolak yang lain suatu hari.
 */
export function CountryPicker({ id, value, onChange, disabled = false }) {
  const [query, setQuery] = useState("");
  const selected = useMemo(() => countryCodesOf(value), [value]);
  // Yang sudah terpilih tapi di luar daftar tetap punya barisnya sendiri — kalau tidak, ia cuma
  // berdiri sebagai chip tanpa cara mematikannya dari daftar.
  const options = useMemo(() => adCountryOptions(selected), [selected]);
  const visible = useMemo(() => filterCountryOptions(options, query), [options, query]);
  const extra = extraCountryCode(query);

  const apply = (codes) => onChange(countryText(codes));
  const toggle = (code) =>
    apply(selected.includes(code) ? selected.filter((item) => item !== code) : [...selected, code]);

  return (
    <div className="country-picker">
      {selected.length > 0 && (
        <div className="country-chips">
          {selected.map((code) => (
            <span className="country-chip" key={code}>
              <Flag code={code} />
              {code}
              <button
                aria-label={`Hapus ${code}`}
                disabled={disabled}
                onClick={() => toggle(code)}
                type="button"
              >
                <X size={12} />
              </button>
            </span>
          ))}
          <button
            className="country-clear"
            disabled={disabled}
            onClick={() => apply([])}
            type="button"
          >
            Kosongkan
          </button>
        </div>
      )}
      <input
        className="control"
        disabled={disabled}
        id={id}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Cari negara atau kode (SA, Arab Saudi)..."
        type="search"
        value={query}
      />
      <div className="country-options">
        {extra && (
          <button
            className="country-option country-option-extra"
            disabled={disabled}
            onClick={() => {
              toggle(extra);
              setQuery("");
            }}
            type="button"
          >
            <Plus size={13} />
            <Flag code={extra} />
            Tambah {extra}
          </button>
        )}
        {visible.length === 0 && !extra && (
          <p className="adset-note">
            Tidak ada negara yang cocok. Kode dua huruf ISO bisa ditambahkan langsung.
          </p>
        )}
        {visible.map((item) => {
          const picked = selected.includes(item.code);
          return (
            <button
              aria-pressed={picked}
              className={`country-option${picked ? " is-picked" : ""}`}
              disabled={disabled}
              key={item.code}
              onClick={() => toggle(item.code)}
              type="button"
            >
              <Flag code={item.code} />
              <span className="country-option-name">{item.name}</span>
              <span className="country-option-code">{item.code}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Bendera sebagai GAMBAR, sepola kolom Negara di /domains: emoji bendera tidak ada di font Windows,
 * dan yang muncul di sana justru dua huruf penanda wilayahnya. `onError` menyembunyikan gambarnya —
 * yang menerangkan barisnya adalah nama negaranya, jadi jaringan tanpa flagcdn kehilangan hiasan.
 */
function Flag({ code }) {
  const src = flagUrl(code);
  if (!src) return null;
  return (
    <img
      alt=""
      height={11}
      loading="lazy"
      onError={(event) => {
        event.currentTarget.hidden = true;
      }}
      src={src}
      srcSet={`${src} 1x, ${flagUrl(code, 40)} 2x`}
      width={17}
    />
  );
}
