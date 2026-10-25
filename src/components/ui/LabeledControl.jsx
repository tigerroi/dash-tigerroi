import { ColumnHint } from "./ColumnHint";

/**
 * Label + ikon keterangan di atas kontrol MILIK PEMANGGIL (SelectField, CountryPicker, input biasa).
 *
 * Bedanya dengan `Field`: `Field` menggambar kontrolnya sendiri dari `type`, dan dipakai form
 * ResourceForm. Yang ini cuma kepalanya — untuk form yang kontrolnya tidak bisa diturunkan dari
 * satu `type`. Sebelum komponen ini ada, kepalanya ditulis dua kali (`Field` di CampaignDialogs,
 * `DnsField` di DnsRecords) dengan dua ikon keterangan yang berbeda untuk satu maksud yang sama.
 *
 * Labelnya `<label htmlFor>` dan BUKAN pembungkus, justru karena ikon keterangannya sebuah tombol:
 * di dalam `<label>`, satu klik pada ikon itu ikut diteruskan ke kontrol yang dibungkusnya — dan
 * pada kotak Proxy di form DNS itu berarti menekan ikonnya MENYALAKAN proxy-nya. Karena itu `id`
 * wajib, dan kontrolnya harus membawa id yang sama.
 *
 * Keterangannya DEFINISI field, jadi ikonnya `info` — "apa yang boleh saya isi di sini", bukan "?"
 * milik kepala kolom. Rupa lewat `className`/`labelClassName`: `.dns-field` menyamakan tinggi label
 * supaya pasangan kotak di grid dua kolom tetap sejajar.
 */
export function LabeledControl({
  id,
  label,
  hint,
  wide = false,
  className = "labeled-control",
  labelClassName = "labeled-control-label",
  children,
}) {
  return (
    <div className={wide ? `${className} wide` : className}>
      <span className={labelClassName}>
        <label htmlFor={id}>{label}</label>
        {hint && <ColumnHint icon="info" text={hint} />}
      </span>
      {children}
    </div>
  );
}
