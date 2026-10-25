import Select from "react-select";

// Di atas dialog (40) dan tooltip kolom (60); nilainya sama dengan `.rs__menu-portal` di styles.css,
// yang mengurus font-size/weight-nya. Konstanta, jadi tidak dibuat ulang tiap render.
const MENU_PORTAL_STYLES = { menuPortal: (base) => ({ ...base, zIndex: 70 }) };

/**
 * Satu-satunya bentuk select option di dashboard ini — react-select, dengan rupa yang diatur
 * src/styles.css (`.rs__*`). Tidak ada lagi `<select>` bawaan browser di `src/components`.
 *
 * `unstyled` + `classNamePrefix="rs"` bukan selera: gaya inline bawaan react-select ber-hex dan tidak
 * ikut tema gelap, dan `styles.theme.test.mjs` hanya bisa menjaga warna yang tinggal di stylesheet.
 * Dibungkus di sini supaya tiap pemakai tidak mengulang kedua prop itu — yang lupa salah satunya
 * menggambar kotak putih di tema gelap tanpa satu pun error.
 *
 * Nilainya PRIMITIF (`value` = string/angka, atau array-nya kalau `isMulti`), bukan objek opsi
 * react-select: pemanggil menyimpan id, dan mencari ulang objek opsinya di tiap render adalah
 * pekerjaan yang cukup ditulis sekali di sini. `onChange` pun menerima primitif — nilai opsi apa
 * adanya, jadi opsi berangka tetap mengirim angka.
 *
 * Dicocokkan lewat TEKS-nya, persis `<select>` bawaan yang digantikannya: "3" dari satu endpoint dan
 * 3 dari endpoint lain harus memilih opsi yang sama, dan `null`/`undefined` memilih opsi kosong ("")
 * kalau ada — tanpa itu kotaknya tampil kosong untuk nilai yang jelas-jelas tersimpan.
 *
 * Menunya DIPORTAL ke `document.body` (`position: fixed`): select berdiri di dalam `.table-wrap`
 * yang `overflow-x: auto` dan di dalam dialog, dan menu yang digambar di dalam keduanya terpotong
 * tepi kotaknya — persis di baris terbawah tabel, yaitu yang paling sering dibuka.
 *
 * z-index portal-nya lewat prop `styles`, BUKAN `.rs__menu-portal` di stylesheet: react-select selalu
 * menyuntik `zIndex: 1` sebagai kelas emotion pada wadah portal (`menuPortalCSS`, satu-satunya CSS-nya
 * yang tidak ikut `unstyled`), dan kelas itu menang atas selektor kelas biasa. Efeknya tak terlihat di
 * mana-mana KECUALI di dalam dialog: menu z-index 1 jatuh di belakang `.modal-backdrop` (z-index 40),
 * jadi opsinya tergambar tapi tertutup backdrop — persis di dialog filter grafik/kalender.
 *
 * Harganya diketahui: react-select + emotion (~32 kB gzip) ikut bundle utama, karena Field,
 * ResourceList, dan TablePagination dipakai hampir tiap halaman.
 */
export function SelectField({
  options,
  value,
  onChange,
  isMulti = false,
  id,
  inputId,
  placeholder = "Pilih...",
  noOptionsMessage = "Tidak ada pilihan yang cocok.",
  disabled = false,
  loading = false,
  clearable = false,
  searchable,
  required = false,
  ariaLabel,
  className = "",
}) {
  const list = options || [];
  const keyOf = (item) => (item == null ? "" : String(item));
  const selected = isMulti
    ? list.filter((option) => (value || []).map(keyOf).includes(keyOf(option.value)))
    : list.find((option) => keyOf(option.value) === keyOf(value)) || null;

  return (
    <Select
      aria-label={ariaLabel}
      className={`rs-container ${className}`.trim()}
      classNamePrefix="rs"
      inputId={inputId || id}
      isClearable={clearable}
      isDisabled={disabled}
      isLoading={loading}
      isMulti={isMulti}
      // Daftar pendek (jumlah slot) tidak butuh kotak ketik; bawaannya dicari hanya kalau pilihannya
      // lebih dari sepuluh.
      isSearchable={searchable ?? list.length > 10}
      menuPlacement="auto"
      menuPortalTarget={typeof document === "undefined" ? null : document.body}
      menuPosition="fixed"
      noOptionsMessage={() => noOptionsMessage}
      onChange={(next) =>
        onChange(isMulti ? (next || []).map((option) => option.value) : next ? next.value : null)
      }
      options={list}
      placeholder={placeholder}
      required={required}
      styles={MENU_PORTAL_STYLES}
      unstyled
      value={selected}
    />
  );
}

/** Daftar teks/angka → opsi SelectField yang label dan nilainya sama. */
export function toSelectOptions(values, format) {
  return (values || []).map((item) => ({
    value: item,
    label: format ? format(item) : String(item),
  }));
}
