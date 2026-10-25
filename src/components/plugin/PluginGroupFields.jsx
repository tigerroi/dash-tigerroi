import { TriangleAlert } from "lucide-react";
import { groupFields } from "../../lib/plugin";
import { ColumnHint } from "../ui/ColumnHint";
import { SelectField, toSelectOptions } from "../ui/SelectField";
import { Switch } from "../ui/Switch";

/**
 * Form satu grup pengaturan plugin, digambar dari SKEMA (`GET /plugin/schema`).
 *
 * Dipindah dari Plugin.jsx begitu fitur kedua membutuhkannya (tab Setup Sub di /domains mengisi grup
 * `behaviour` sekali untuk seluruh sub baru sebuah domain) — sepola aturan katalog UI. Menyalinnya
 * berarti dua daftar field yang berselisih suatu hari, dan yang berselisih adalah enum yang diterima
 * satu form dan ditolak yang lain.
 *
 * `onChange(name, value)` untuk kedua jalur: field-nya sendiri dan pasangan satuannya. `changed`
 * opsional (peta field yang diubah) — hanya ConfigEditor yang memakainya untuk menandai apa yang
 * akan dikirim; Setup Sub mengirim seluruh field, jadi tidak ada yang perlu ditandai.
 */
export function PluginGroupFields({
  fields,
  sections,
  values,
  onChange,
  readOnly,
  oneColumn,
  changed,
}) {
  return groupFields(fields).map((section) => {
    const meta = sections?.[section.name];
    return (
      <fieldset className="plugin-fieldset" key={section.name}>
        {/* Kalimat pembuka seksi tinggal DI BALIK IKON, sepola keterangan tiap field di bawahnya.
            Digambar sebagai paragraf, empat seksi berarti empat blok teks yang memisahkan tiap
            kelompok isian dari kelompok berikutnya sejauh dua baris — dan yang terbaca bukan
            keterangannya melainkan dindingnya. Ia DEFINISI, tidak berubah dari satu pembacaan ke
            pembacaan lain, jadi ia memenuhi syarat yang sama dengan `help`. */}
        <legend>
          {section.name}
          {meta?.description && <ColumnHint icon="info" text={meta.description} />}
        </legend>

        {/* `notice` TIDAK ikut ke ikon: yang disebutnya ketergantungan yang tidak terlihat dari
            field mana pun di layar ini — tanpa Simpan Log seluruh blok Behaviour diam tanpa satu
            pun tanda kesalahan. Peringatan yang harus di-hover dulu untuk dibaca tidak dibaca
            siapa pun. */}
        {meta?.notice && (
          <p className="plugin-alert plugin-alert-inline">
            <TriangleAlert size={15} />
            <span>{meta.notice}</span>
          </p>
        )}

        <div className={oneColumn ? "form-grid plugin-form-single" : "form-grid"}>
          {section.fields
            // Field yang digambar pasangannya (satuan durasi) tidak berdiri sendiri.
            .filter((field) => !field.renderedBy)
            .map((field) => (
              <FieldInput
                changed={changed ? Object.hasOwn(changed, field.name) : false}
                field={field}
                fields={fields}
                key={field.name}
                onChange={(next) => onChange(field.name, next)}
                onChangeField={onChange}
                readOnly={readOnly}
                value={values?.[field.name]}
                values={values}
              />
            ))}
        </div>
      </fieldset>
    );
  });
}

export function FieldInput({
  field,
  value,
  onChange,
  readOnly,
  changed,
  values,
  onChangeField,
  fields,
}) {
  const id = `plugin-field-${field.name}`;
  const isSwitch = field.type === "bool01" || field.type === "boolean";
  const isRadio = field.type === "radio";
  // `media` ikut textarea: yang benar-benar ada di lapangan adalah 120 URL dalam satu field, dan
  // kotak satu baris menjadikannya tidak bisa dibaca apalagi disunting.
  const isLong =
    field.type === "html" ||
    field.type === "textarea" ||
    field.type === "list" ||
    field.type === "media";
  /**
   * Melebar penuh atau tidak dibaca dari SKEMA, hampir tidak pernah disimpulkan dari tipe.
   *
   * `textarea` dan `list` dulu ikut melebar otomatis, dan itu yang membuat tab Iklan terbaca
   * berantakan: "Daftar ASN" memutus barisnya sendiri dan meninggalkan sel kosong menganga di
   * sebelah "Mode ASN" — dua field yang justru paling enak dibaca berdampingan.
   *
   * Yang tersisa otomatis cuma `html`: satu tag `<ins>` sudah menghabiskan seluruh lebar kotaknya,
   * dan tidak ada susunan yang membuat setengah kolom cukup untuknya.
   */
  const isWide = field.type === "html" || isRadio || field.wide === true;

  // Satuan yang berpasangan dengan angka di sebelahnya (Durasi Blokir Redirect + Bulan). Tetap dua
  // field terpisah di data; yang digabung cuma gambarnya.
  const pair = field.pairWith ? (fields || []).find((item) => item.name === field.pairWith) : null;

  return (
    <div
      className={`field ${isWide ? "plugin-field-wide" : ""} ${changed ? "plugin-changed" : ""}`}
    >
      <label htmlFor={isRadio ? undefined : id}>
        {field.label}
        {/* Satuan ditulis meredup di samping nama, seperti di layar plugin — bagian dari nama
            field, bukan kalimat bantuan yang bisa dilewati mata. */}
        {field.unit && <span className="plugin-field-unit">{field.unit}</span>}
        {/* Keterangan field pindah ke ikon info, bukan lagi baris teks di bawah kotaknya.
            Form ini memuat tiga puluh field dan hampir tiap fieldnya punya kalimatnya sendiri;
            digambar semua sekaligus, yang terbaca bukan keterangannya melainkan dinding teks yang
            memisahkan tiap kotak dari kotak berikutnya sejauh dua baris. Kotaknya `position:
            fixed`, jadi ia tidak terpotong tepi fieldset. */}
        {field.help && <ColumnHint icon="info" text={field.help} />}
        {/* Yang diubah ditandai. Form ini bisa memuat tiga puluh kotak, dan yang menentukan apa yang
            akan dikirim adalah selisihnya — bukan isinya. */}
        {changed && <span className="plugin-changed-dot" title="Diubah, akan dikirim" />}
      </label>

      {isRadio ? (
        <div className="plugin-radio-group" role="radiogroup">
          {(field.options || []).map((option) => (
            <label className="plugin-radio" key={option}>
              <input
                checked={String(value ?? "") === option}
                disabled={readOnly}
                name={field.name}
                onChange={() => onChange(option)}
                type="radio"
                value={option}
              />
              <span>
                <strong>{field.optionLabels?.[option] || option}</strong>
                {field.optionHelp?.[option] && (
                  <small className="muted-line">{field.optionHelp[option]}</small>
                )}
              </span>
            </label>
          ))}
        </div>
      ) : isSwitch ? (
        /* Dibungkus kotak setinggi kontrol lain, bukan saklar telanjang. Di grid dua kolom, kontrol
           setinggi satu baris teks yang berdampingan dengan input setinggi 38px membuat tiap baris
           yang memuat keduanya terlihat jomplang — dan grup "Perilaku slot" di tab Iklan berisi
           enam saklar berturut-turut. */
        <div className="plugin-switch">
          <Switch
            checked={value === true}
            disabled={readOnly}
            id={id}
            label={value === true ? "Aktif" : "Nonaktif"}
            onChange={onChange}
          />
        </div>
      ) : pair ? (
        <div className="plugin-pair">
          <input
            className="control"
            disabled={readOnly}
            id={id}
            inputMode="numeric"
            onChange={(event) => onChange(event.target.value)}
            type="text"
            value={value ?? ""}
          />
          <SelectField
            ariaLabel={pair.label}
            disabled={readOnly}
            onChange={(next) => onChangeField(pair.name, next)}
            options={toSelectOptions(
              pair.options,
              (option) => pair.optionLabels?.[option] || option,
            )}
            value={values?.[pair.name] ?? ""}
          />
        </div>
      ) : field.type === "enum" ? (
        <SelectField
          disabled={readOnly}
          id={id}
          onChange={onChange}
          options={[
            // Kotak kosong hanya untuk grup yang POST-nya PARTIAL, dan di sana kalimatnya benar:
            // enum yang tidak dipilih memang tidak ikut dikirim, jadi nilainya di situs tidak
            // berubah. AutoPost bukan itu — tiap permintaan berdiri sendiri dan seluruh field
            // dikirim, jadi "(tidak diubah)" di sana adalah janji tentang keadaan yang tidak ada:
            // yang tidak dipilih jatuh ke bawaan REST, yang tidak selalu sama dengan yang tergambar
            // di layar. `required` di skema yang membedakannya.
            ...(field.required ? [] : [{ value: "", label: "(tidak diubah)" }]),
            ...toSelectOptions(field.options, (option) => field.optionLabels?.[option] || option),
          ]}
          value={value ?? ""}
        />
      ) : isLong ? (
        <textarea
          className="control plugin-textarea"
          disabled={readOnly}
          id={id}
          onChange={(event) => onChange(event.target.value)}
          rows={field.type === "html" || field.type === "media" ? 8 : 4}
          value={value ?? ""}
        />
      ) : (
        <input
          className="control"
          disabled={readOnly}
          id={id}
          inputMode={field.type === "int" ? "numeric" : undefined}
          onChange={(event) => onChange(event.target.value)}
          type="text"
          value={value ?? ""}
        />
      )}
    </div>
  );
}
