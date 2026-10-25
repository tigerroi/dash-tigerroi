import { Eye, EyeOff } from "lucide-react";
import { useId, useState } from "react";
import { digitsOnly, formatAmountInput } from "../../lib/amountInput";
import { SelectField } from "./SelectField";

export function Field({
  label,
  type = "text",
  value,
  onChange,
  options,
  required,
  placeholder,
  emptyLabel,
  readOnly,
  autoComplete,
}) {
  const id = useId();
  // Kotak password bisa diintip lewat ikon mata: sandi yang salah ketik satu huruf di layar login
  // tidak bisa dibedakan dari akun yang ditolak, dan satu-satunya cara memeriksanya adalah
  // mengetik ulang seluruhnya.
  const [revealed, setRevealed] = useState(false);
  const isPassword = type === "password";
  const normalizedOptions = (options || []).map((option) =>
    typeof option === "string" ? { value: option, label: option } : option,
  );
  // Pilihan kosong BAWAAN hanya digambar kalau daftarnya sendiri belum punya satu.
  //
  // Sebuah select memilih opsi PERTAMA yang nilainya cocok, dan dua opsi bernilai "" berarti
  // yang kedua tidak akan pernah terpilih di layar: "Aktif (ikut sync)" di form Ad Account
  // bernilai "" (kosong = ikut sync), jadi menekannya mengirim "" — nilai yang sudah berlaku —
  // dan React menggambar ulang select-nya pada "Pilih Sync Meta". Yang tersimpan benar sepanjang
  // waktu; yang tidak bisa dilakukan orang adalah MELIHAT pilihannya berdiri di sana, dan itu
  // tidak bisa dibedakan dari saklar yang tidak bekerja.
  const hasEmptyOption = normalizedOptions.some((option) => !option.value);
  // Kotak uang menampilkan "500.000" tapi tetap mengirim "500000" ke form — titiknya hiasan
  // baca, bukan bagian dari nilai yang disimpan.
  const isCurrency = type === "currency";
  const handleChange = (event) => {
    const nextValue =
      type === "number" || isCurrency ? digitsOnly(event.target.value) : event.target.value;

    onChange(nextValue);
  };

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {type === "multiselect" ? (
        <div className="control checkbox-group">
          {normalizedOptions.map((option) => {
            const selected = String(value || "")
              .split(",")
              .map((r) => r.trim())
              .includes(option.value);
            return (
              <label key={option.value} className="checkbox-option">
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => {
                    const current = new Set(
                      String(value || "")
                        .split(",")
                        .map((r) => r.trim())
                        .filter(Boolean),
                    );
                    current.has(option.value)
                      ? current.delete(option.value)
                      : current.add(option.value);
                    // Rejoin in the option order so the stored string is stable.
                    onChange(
                      normalizedOptions
                        .filter((o) => current.has(o.value))
                        .map((o) => o.value)
                        .join(","),
                    );
                  }}
                />
                {option.label}
              </label>
            );
          })}
        </div>
      ) : type === "select" ? (
        <SelectField
          id={id}
          onChange={onChange}
          options={
            hasEmptyOption
              ? normalizedOptions
              : [{ value: "", label: emptyLabel || `Pilih ${label}` }, ...normalizedOptions]
          }
          required={required}
          value={value}
        />
      ) : isPassword ? (
        <div className="password-control">
          <input
            id={id}
            className="control"
            type={revealed ? "text" : "password"}
            value={value}
            required={required}
            placeholder={placeholder}
            readOnly={readOnly}
            autoComplete={autoComplete}
            onChange={handleChange}
          />
          <button
            aria-label={revealed ? "Sembunyikan password" : "Tampilkan password"}
            aria-pressed={revealed}
            className="password-toggle"
            onClick={() => setRevealed((current) => !current)}
            title={revealed ? "Sembunyikan password" : "Tampilkan password"}
            type="button"
          >
            {revealed ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      ) : (
        <input
          id={id}
          className="control"
          type={type === "email" || isCurrency ? "text" : type}
          inputMode={
            type === "email" ? "email" : type === "number" || isCurrency ? "numeric" : undefined
          }
          pattern={type === "number" ? "[0-9]*" : undefined}
          value={isCurrency ? formatAmountInput(value) : value}
          required={required}
          placeholder={placeholder}
          readOnly={readOnly}
          onChange={handleChange}
        />
      )}
    </div>
  );
}
