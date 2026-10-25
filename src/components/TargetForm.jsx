import { Save } from "lucide-react";
import { useMemo, useState } from "react";
import { monthKeyOf } from "../lib/dateRange";
import { ACCOUNT_TYPES } from "../lib/earningByAccountType";
import { firstValue } from "../lib/firstValue";
import { formatMonth } from "../lib/formatDate";
import {
  ACCOUNT_TYPE_SLUGS,
  accountTypeOfSlug,
  STATUS_OPTIONS,
  targetMonthRecord,
} from "../lib/targets";
import { Field } from "./ui/Field";
import { PageHeader } from "./ui/PageHeader";

// Target bukan resource push-keyed biasa (disimpan di domainTargets/{id}/{YYYY-MM}/{jenis}), jadi
// form ini tidak lewat ResourceForm. New: pilih domain + bulan + jenis akun. Edit: ketiganya
// dikunci dari URL, hanya isiannya yang diubah.
//
// Yang diminta form ini cuma yang benar-benar diketik orang. Payout Sebelumnya, Tercapai, dan Sisa
// Target sengaja TIDAK ada di sini: ketiganya diturunkan dari baris ROI tiap kali tabelnya
// digambar, dan sebuah kotak isian untuk angka yang akan ditimpa sync berikutnya cuma menawarkan
// pekerjaan yang hasilnya dibuang.
export function TargetForm({ store, domainId, month, slug, onSave, onCancel }) {
  const editing = Boolean(domainId);
  const domains = store.domains || [];
  const targets = store.domainTargets || {};
  // Waktu lokal, dan dihitung di sini alih-alih sebagai konstanta modul — alasan yang sama dengan
  // Targets.jsx: `toISOString` menjawab menurut UTC, dan konstanta modul membeku di bulan saat
  // berkasnya dimuat.
  const currentMonth = monthKeyOf(new Date());

  const [id, setId] = useState(domainId || "");
  const [m, setM] = useState(month || currentMonth);
  const [accountType, setAccountType] = useState(accountTypeOfSlug(slug) || ACCOUNT_TYPES[0]);

  const existing = targetMonthRecord(targets, id, m)[ACCOUNT_TYPE_SLUGS[accountType]] || {};
  const [values, setValues] = useState(() => formValues(existing));
  const [submitting, setSubmitting] = useState(false);

  // Isian dimuat ulang begitu domain/bulan/jenis di form "Tambah" berganti. Tanpa ini, isiannya
  // dihitung SEKALI saat form dibuka: memilih baris yang sudah punya target menampilkan kotak
  // kosong, dan Simpan menghapus status, kendala, dan catatan yang sudah diketik orang tanpa
  // pernah menampilkannya. Pola resmi React untuk "state yang menyesuaikan diri saat prop
  // berubah" — bukan useEffect, yang menggambar satu kali dengan nilai yang salah dulu.
  const identity = `${id}|${m}|${accountType}`;
  const [loadedIdentity, setLoadedIdentity] = useState(identity);
  if (loadedIdentity !== identity) {
    setLoadedIdentity(identity);
    setValues(formValues(existing));
  }

  const domainOptions = useMemo(
    () =>
      domains
        .map((domain) => ({ value: domain.id, label: firstValue(domain.domainUrl) }))
        .filter((option) => option.value && option.label),
    [domains],
  );
  const domainName = firstValue(domains.find((domain) => domain.id === id)?.domainUrl) || id;
  const setField = (field) => (value) => setValues((current) => ({ ...current, [field]: value }));

  const submit = async (event) => {
    event.preventDefault();
    if (!id || !m || !accountType) {
      return;
    }
    setSubmitting(true);
    try {
      await onSave(id, m, ACCOUNT_TYPE_SLUGS[accountType], values);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page-stack">
      <PageHeader
        title={editing ? "Edit Target" : "Tambah Target"}
        description="Target earning bulanan per domain dan jenis akun."
      />
      <form className="panel form-panel" onSubmit={submit}>
        <div className="form-grid">
          {editing ? (
            <Field label="Domain" value={domainName} readOnly onChange={() => {}} />
          ) : (
            <Field
              label="Domain"
              type="select"
              value={id}
              options={domainOptions}
              required
              onChange={setId}
            />
          )}
          {editing ? (
            /* Hanya tampilan — nilai yang disimpan tetap "2026-08". */
            <Field label="Bulan" value={formatMonth(m)} readOnly onChange={() => {}} />
          ) : (
            <Field label="Bulan" type="month" value={m} required onChange={setM} />
          )}
          {editing ? (
            <Field label="Jenis" value={accountType} readOnly onChange={() => {}} />
          ) : (
            /* Dua pilihan, bukan kotak teks — alasan yang sama dengan kolom Jenis Akun di Invalid
               Traffic: nilainya MEMUTUSKAN bagian earning mana yang dijumlahkan jadi Tercapai. */
            <Field
              label="Jenis"
              type="select"
              value={accountType}
              options={ACCOUNT_TYPES}
              required
              onChange={setAccountType}
            />
          )}
          <Field
            label="Status Terkini"
            type="select"
            value={values.status}
            options={STATUS_OPTIONS}
            emptyLabel="Belum diisi"
            onChange={setField("status")}
          />
          <Field
            label="Target Earning (Rp)"
            type="currency"
            value={values.target}
            placeholder="Kosongkan kalau bulan ini belum ditargetkan"
            onChange={setField("target")}
          />
          <Field
            label="Kendala"
            value={values.kendala}
            placeholder="mis. IKLAN LIMIT"
            onChange={setField("kendala")}
          />
          <Field
            label="Catatan"
            value={values.catatan}
            placeholder="mis. FOKUS ADX"
            onChange={setField("catatan")}
          />
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

function formValues(existing = {}) {
  return {
    status: existing.status || "",
    target:
      existing.target === undefined || existing.target === null ? "" : String(existing.target),
    kendala: existing.kendala || "",
    catatan: existing.catatan || "",
  };
}
