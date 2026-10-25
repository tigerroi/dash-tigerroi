import { Save } from "lucide-react";
import { useMemo, useState } from "react";
import { notifyError } from "../lib/notify";
import { Field } from "./ui/Field";
import { PageHeader } from "./ui/PageHeader";

// `only` narrows the form to a list of field names — the shape an advertiser gets on a subdomain,
// where the database grants them one child path and would reject a write carrying anything else.
export function ResourceForm({
  config,
  item,
  onSubmit,
  onCancel,
  store = {},
  siblings = [],
  only,
}) {
  const [submitting, setSubmitting] = useState(false);
  // createOnly fields (a new team member's password) have nothing to show when editing —
  // the value was never stored and cannot be changed from here.
  const fields = useMemo(
    () =>
      config.fields
        .filter((field) => !field.createOnly || !item)
        .filter((field) => !only || only.includes(field.name))
        .map((field) => resolveFieldOptions(field, store, item?.[field.name])),
    [config.fields, store, item, only],
  );
  const [values, setValues] = useState(() => {
    const initialValues = {};
    fields.forEach((field) => {
      const stored = item && field.load ? field.load(item) : item?.[field.name];
      initialValues[field.name] = stored || getInitialFieldValue(field);
    });
    return initialValues;
  });
  // Auto fields (mis. Fee/Total di Whitelist Top-Up) tidak disimpan di state — dihitung ulang dari
  // nilai lain tiap render, dalam urutan fields supaya yang bergantung (Total← Fee) melihat hasil
  // terbaru. Nilai inilah yang ditampilkan sekaligus dikirim saat submit.
  //
  // `store` ikut diberikan karena sebagian turunan tidak ada di form ini: PIC di Whitelist Top-Up
  // adalah pemilik akun yang dipilih di baris itu, dan pemiliknya tinggal di koleksi Ad Accounts.
  //
  // `fallback` adalah bentuk KETIGA di samping `default` dan `compute`, dan ketiganya dibutuhkan
  // karena Kode Jaringan dan Alamat Email di Cost Ad Exchange tidak muat di dua yang lama.
  // `default` dibaca sekali saat form dibuka — terlalu awal, belum ada Domain untuk diturunkan
  // darinya. `compute` menang atas pilihan orang dan digambar readOnly — dipakai di sana, baris
  // lama yang domainnya sudah pindah network akan tertimpa kode akun HARI INI begitu ia disunting,
  // padahal yang benar adalah kode yang dipakai waktu penyambungannya dibayar.
  //
  // Batasnya dua, dan keduanya menentukan: hanya saat MEMBUAT baris (`!item`), dan hanya kalau
  // nilainya masih kosong. Yang pertama menghapus satu-satunya cara ia bisa mengisi kembali kotak
  // yang sengaja dikosongkan orang di baris lama; yang kedua membuat ketikan orang selalu menang
  // atas tebakan.
  const displayValues = useMemo(() => {
    const next = { ...values };
    for (const field of fields) {
      if (field.compute) {
        next[field.name] = field.compute(next, store);
        continue;
      }

      if (field.fallback && !item && !next[field.name]) {
        next[field.name] = field.fallback(next, store);
      }
    }
    return next;
  }, [values, fields, store, item]);

  const submit = async (event) => {
    event.preventDefault();
    // `load`/`save`: kotak yang digambar dalam bentuk lain dari yang tersimpan (nama subdomain
    // pendek vs hostname penuh). Diterapkan SEBELUM pemeriksaan unik, yang membandingkan bentuk
    // tersimpan.
    const saved = { ...displayValues };
    for (const field of fields) {
      if (field.save) saved[field.name] = field.save(saved, item);
    }
    // Nilai yang harus unik di seluruh daftar (mis. nama subdomain): baris kembar bernama sama
    // hanya memecah spend satu subdomain ke dua baris. Baris yang sedang diedit dikecualikan.
    if (config.uniqueField) {
      const key = config.uniqueField;
      const value = String(saved[key] ?? "").trim();
      const clash = siblings.find(
        (row) =>
          row.id !== item?.id &&
          String(row[key] ?? "")
            .trim()
            .toLowerCase() === value.toLowerCase(),
      );
      if (value && clash) {
        notifyError(new Error("duplicate"), `${config.singular} "${value}" sudah ada.`);
        return;
      }
    }

    setSubmitting(true);
    try {
      await onSubmit(saved);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page-stack">
      <PageHeader
        title={`${item ? "Edit" : "Tambah"} ${config.singular}`}
        description={config.description}
      />
      <form className="panel form-panel" onSubmit={submit}>
        <div className="form-grid">
          {fields.map((field) => (
            <Field
              key={field.name}
              {...field}
              options={visibleOptions(field, displayValues)}
              readOnly={Boolean(field.compute)}
              value={displayValues[field.name]}
              onChange={(value) => {
                const next = { ...values, [field.name]: value };
                setValues(field.afterChange ? field.afterChange(next, store) : next);
              }}
            />
          ))}
        </div>
        <div className="form-actions">
          <button className="ghost-button" type="button" onClick={onCancel} disabled={submitting}>
            Batal
          </button>
          <button className="primary-button" type="submit" disabled={submitting}>
            <Save size={16} />
            {submitting ? "Menyimpan..." : "Simpan"}
          </button>
        </div>
      </form>
    </div>
  );
}

function resolveFieldOptions(field, store, currentValue) {
  const saved = String(currentValue ?? "").trim();

  if (!field.optionsFrom) {
    // Alasan yang sama persis dengan blok di bawah, dan sempat tidak berlaku di sini: sebuah
    // daftar pilihan yang DIKETIK di resources.js juga bisa berubah. Kolom Status akun berganti
    // kosakata dari Active/Inactive/Limit/Lepas Limit ke empat keadaan yang dilaporkan Google, dan
    // baris yang belum sempat dicek sync masih membawa nilai lamanya. Tanpa ini, membuka form akun
    // itu untuk mengubah nomor rekening menampilkan Status sebagai kotak kosong — lalu Simpan
    // menuliskan pilihan pertama diam-diam, ke kolom yang menentukan apakah akunnya masih hidup.
    if (field.type !== "select" || !saved) return field;
    const options = field.options || [];
    const known = options.some((option) =>
      typeof option === "string" ? option === saved : option?.value === saved,
    );
    return known ? field : { ...field, options: [saved, ...options] };
  }

  const sourceItems = store[field.optionsFrom] || [];
  const seen = new Set();
  const options = sourceItems
    .map((item) => {
      // Jatuh ke `item.id` HANYA kalau field tidak menyebut kolom nilainya. Yang menyebutnya
      // (`userOwner`, `name`, `domainUrl`) dicocokkan lewat kolom itu di seluruh dashboard, jadi
      // push key untuk baris yang kolomnya kosong adalah pilihan yang tidak cocok dengan apa pun —
      // akun tanpa User Pemilik muncul sebagai PIC bernama "-OaB3x...".
      const value = String((field.optionValue ? item[field.optionValue] : item.id) ?? "").trim();
      const label = item[field.optionLabel] || value;

      // Kembar dibuang: kolom yang bukan kunci (User Pemilik) berulang di tiap akun miliknya, dan
      // lima "Aca" di satu daftar tidak bisa dibedakan pemakainya.
      if (!value || seen.has(value)) return null;
      seen.add(value);
      return { value, label, source: item };
    })
    .filter(Boolean);

  // Nilai yang sudah tersimpan tapi sumbernya sudah tidak ada (akun iklan yang dihapus, PIC yang
  // sudah keluar) tetap ditawarkan sebagai pilihan. Tanpa ini <select> menampilkannya sebagai
  // kosong, dan baris lama yang hanya diedit nominalnya akan tertahan validasi "wajib diisi" —
  // atau tersimpan dengan nama yang hilang diam-diam.
  if (saved && !options.some((option) => option.value === saved)) {
    options.unshift({ value: saved, label: saved });
  }

  return {
    ...field,
    options,
  };
}

/**
 * Opsi yang bergantung pada nilai field LAIN (`optionsWhere`) — Nama / Kode yang menyempit ke akun
 * milik PIC terpilih. Disaring saat dirender, bukan di `resolveFieldOptions`, karena yang itu
 * dihitung sekali per store dan tidak melihat isian form. Opsi tanpa `source` (nilai tersimpan yang
 * sumbernya sudah hilang) tidak pernah disaring: ia satu-satunya cara baris lama tetap terbaca.
 */
function visibleOptions(field, values) {
  if (!field.optionsWhere || !field.options) return field.options;
  return field.options.filter(
    (option) => !option.source || field.optionsWhere(option.source, values),
  );
}

function getInitialFieldValue(field) {
  if (field.default) {
    // Boleh berupa fungsi supaya nilai yang bergantung waktu (tanggal hari ini) dibaca saat form
    // dibuka, bukan saat modul dimuat — tab yang dibiarkan menginap semalaman tidak akan
    // menawarkan tanggal kemarin sebagai "hari ini".
    return typeof field.default === "function" ? field.default() : field.default;
  }

  if (field.type !== "select" || field.optionsFrom) {
    return "";
  }

  const [firstOption] = field.options || [];
  return typeof firstOption === "string" ? firstOption : firstOption?.value || "";
}
