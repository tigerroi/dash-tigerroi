import { ColumnHint } from "./ColumnHint";

/**
 * Saklar on/off — SATU bentuk untuk seluruh dashboard.
 *
 * Menggantikan kotak centang di tiap tempat yang menyatakan KEADAAN: fitur menyala atau mati,
 * pengaturan berlaku atau tidak. Yang TIDAK diganti adalah kotak centang yang memilih BARIS
 * (pilih semua situs, pilih tujuan terapkan-massal) atau memilih beberapa nilai dari satu daftar
 * (`checkbox-option`) — di sana centang berarti "yang ini ikut tindakan berikutnya", bukan "yang
 * ini menyala", dan satu kolom tabel berisi saklar terbaca seolah tiap baris punya setelan sendiri.
 *
 * Rupanya DIBAGI dengan saklar campaign di /users/{uid} lewat selektor yang sama di styles.css
 * (`.campaign-switch, .switch-track`), bukan disalin: dua saklar yang berbeda beberapa piksel di
 * satu dashboard terbaca sebagai dua kontrol yang berbeda artinya. Yang di sana tetap `<button>`
 * karena ia membawa keadaan yang tidak dimiliki saklar biasa — "perintah sudah ditulis, belum
 * sampai ke Meta" yang berkedip — dan itu perbedaan perilaku, bukan perbedaan rupa.
 *
 * Kotak centang aslinya TIDAK dibuang melainkan disembunyikan di atas relnya: yang menerima klik,
 * spasi, dan fokus keyboard adalah `<input>` sungguhan, jadi label yang membungkusnya bekerja
 * tanpa satu baris JS pun — dan teks di sebelah saklar ikut bisa ditekan. Digambar sebagai `<div>`
 * ber-`onClick`, ketiganya harus ditulis ulang satu per satu, dan yang terlewat cuma ketahuan oleh
 * orang yang memakai keyboard.
 */
export function Switch({
  checked,
  onChange,
  disabled = false,
  id,
  label,
  hint,
  title,
  className = "",
  ...rest
}) {
  return (
    <label className={`switch-field ${className}`.trim()} htmlFor={id} title={title}>
      <span className="switch">
        <input
          checked={checked === true}
          className="switch-input"
          disabled={disabled}
          id={id}
          onChange={(event) => onChange?.(event.target.checked, event)}
          type="checkbox"
          {...rest}
        />
        {/* Rel dan bundarannya digambar terpisah dari input dan `aria-hidden`: yang dibacakan
            pembaca layar adalah input di atasnya, dan rel yang ikut terbaca menghasilkan dua
            sebutan untuk satu kontrol. */}
        <span aria-hidden="true" className="switch-track">
          <span className="switch-knob" />
        </span>
      </span>
      {(label || hint) && (
        <span className="switch-text">
          <span>{label}</span>
          {/* Keterangannya lewat ikon, bukan baris teks di bawah label. Saklar dibaca sebagai satu
              baris — nama, lalu posisinya — dan kalimat penjelas yang digambar permanen di bawahnya
              menjadikan tiap saklar setinggi tiga baris; di form yang memuat enam saklar berturut-
              turut, yang terbaca bukan keterangannya melainkan jarak antar-saklar. */}
          {hint && <ColumnHint icon="info" text={hint} />}
        </span>
      )}
    </label>
  );
}
