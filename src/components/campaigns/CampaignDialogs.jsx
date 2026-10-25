import { TriangleAlert } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import {
  adSetEditState,
  budgetChangeNote,
  copyDefaultName,
  countryLabel,
  runEach,
} from "../../lib/campaignFleet";
import {
  copyCampaignNow,
  fetchAdSetEdit,
  fetchCampaignEdit,
  updateAdSetNow,
  updateCampaignNow,
} from "../../lib/controlApi";
import { notifySuccess } from "../../lib/notify";
import { renderCell } from "../../lib/renderCell";
import { Dialog } from "../ui/Dialog";
import { LabeledControl } from "../ui/LabeledControl";
import { SelectField, toSelectOptions } from "../ui/SelectField";
import { CountryPicker } from "./CountryPicker";

const MAX_COPIES = 5;

// Rupa dialog halaman Campaign: `Dialog` yang sama dengan kelas lebarnya sendiri.
export function DialogShell(props) {
  return <Dialog className="confirm-dialog campaign-dialog" {...props} />;
}

export function Alert({ children }) {
  return (
    <p className="plugin-alert">
      <TriangleAlert size={15} />
      <span>{children}</span>
    </p>
  );
}

/**
 * Kirim satu tulisan. Penolakan server tetap di DALAM dialog (bukan toast yang hilang sendiri), dan
 * jawaban 409 ber-`needsConfirm` berubah jadi pertanyaan — subdomain yang ditanyakan adalah yang
 * diputuskan server, bukan tebakan dari kalimat error.
 */
export function useSubmit(onDone) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmSubDomain, setConfirmSubDomain] = useState("");
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const run = async (task) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await task();
      if (!alive.current) return; // Dialog sudah ditutup saat task selesai.
      onDone();
    } catch (err) {
      if (!alive.current) return; // Dialog sudah ditutup saat error terjadi.
      if (err?.body?.needsConfirm) {
        setConfirmSubDomain(err.body.subDomain || "");
      } else {
        setConfirmSubDomain("");
        setError(err.message);
      }
      setBusy(false);
    }
  };
  return { busy, error, confirmSubDomain, setConfirmSubDomain, run };
}

function MappingConfirm({ subDomain, busy, action, onBack, onConfirm }) {
  return (
    <div className="campaign-review">
      <p>
        Nama ini memetakan belanja campaign ke <strong>{subDomain}</strong>. Link iklan tidak ikut
        berubah — pastikan iklannya memang mengarah ke sana.
      </p>
      <div className="confirm-actions">
        <button className="ghost-button" disabled={busy} onClick={onBack} type="button">
          Kembali
        </button>
        <button className="primary-button" disabled={busy} onClick={onConfirm} type="button">
          {busy ? "Mengirim..." : action}
        </button>
      </div>
    </div>
  );
}

function ChangeReview({ lines, busy, error, onBack, onConfirm }) {
  return (
    <div className="campaign-review">
      <ul>
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p>Perubahan besar pada anggaran atau targeting mengulang fase pembelajaran Meta.</p>
      {error && <Alert>{error}</Alert>}
      <div className="confirm-actions">
        <button className="ghost-button" disabled={busy} onClick={onBack} type="button">
          Kembali
        </button>
        <button className="primary-button" disabled={busy} onClick={onConfirm} type="button">
          {busy ? "Menyimpan..." : "Ya, simpan"}
        </button>
      </div>
    </div>
  );
}

// Nilai segar dari Meta saat dialog dibuka — bukan cermin RTDB.
function useFresh(load, deps) {
  const [state, setState] = useState({ loading: true, error: "", data: null });
  useEffect(() => {
    let alive = true;
    load()
      .then((data) => alive && setState({ loading: false, error: "", data }))
      .catch((error) => alive && setState({ loading: false, error: error.message, data: null }));
    return () => {
      alive = false;
    };
    // biome-ignore lint/correctness/useExhaustiveDependencies: `load` dibentuk ulang tiap render; yang menentukan pembacaan ulang adalah `deps`.
  }, deps);
  return state;
}

export function CopyCampaignDialog({ row, onClose }) {
  const ids = useId();
  const [name, setName] = useState(copyDefaultName(row));
  const [count, setCount] = useState(1);
  const submit = useSubmit(onClose);

  const send = (confirmSubDomain) =>
    submit.run(async () => {
      await copyCampaignNow(row.userId, row.campaignId, { name, count, confirmSubDomain });
      notifySuccess("Salinan sedang dibuat di latar — hasilnya diumumkan begitu selesai.");
    });

  return (
    <DialogShell
      busy={submit.busy}
      onClose={onClose}
      subtitle={row.campaign}
      title="Duplikasi campaign"
    >
      {submit.confirmSubDomain ? (
        <MappingConfirm
          action="Ya, salin"
          busy={submit.busy}
          onBack={() => submit.setConfirmSubDomain("")}
          onConfirm={() => send(submit.confirmSubDomain)}
          subDomain={submit.confirmSubDomain}
        />
      ) : (
        <form
          className="campaign-form"
          onSubmit={(event) => {
            event.preventDefault();
            send();
          }}
        >
          <LabeledControl
            hint="Wajib membawa kode Keitaro subdomain yang sama dengan campaign sumber — kode itulah yang memetakan belanjanya — dan tidak boleh sama dengan nama campaign lain di ad account ini."
            id={`${ids}-name`}
            label="Nama salinan"
          >
            <input
              className="control"
              disabled={submit.busy}
              id={`${ids}-name`}
              maxLength={400}
              onChange={(event) => setName(event.target.value)}
              value={name}
            />
          </LabeledControl>
          <LabeledControl
            hint="Lebih dari satu salinan diberi akhiran #1, #2, dan seterusnya."
            id={`${ids}-count`}
            label="Jumlah salinan"
          >
            <SelectField
              disabled={submit.busy}
              id={`${ids}-count`}
              onChange={(next) => setCount(Number(next))}
              options={toSelectOptions(Array.from({ length: MAX_COPIES }, (_, index) => index + 1))}
              value={count}
            />
          </LabeledControl>
          <p className="adset-note">
            Campaign disalin dulu, lalu tiap ad set berikut iklannya. Salinan lahir mati (PAUSED):
            ubah anggaran dan targetingnya dulu, lalu nyalakan lewat saklar.
          </p>
          <p className="adset-note">
            Iklan hanya ikut tersalin kalau app Meta pemegang token sudah App Mode: Live dan System
            User punya izin Create ads di Halaman Facebook iklannya; yang tidak ikut disebut di
            panel Pekerjaan.
          </p>
          {submit.error && <Alert>{submit.error}</Alert>}
          <div className="confirm-actions">
            <button className="ghost-button" disabled={submit.busy} onClick={onClose} type="button">
              Batal
            </button>
            <button className="primary-button" disabled={submit.busy || !name.trim()} type="submit">
              {submit.busy ? "Menyalin..." : "Salin"}
            </button>
          </div>
        </form>
      )}
    </DialogShell>
  );
}

export function EditCampaignDialog({ row, onClose }) {
  const ids = useId();
  const fresh = useFresh(
    () => fetchCampaignEdit(row.userId, row.campaignId),
    [row.userId, row.campaignId],
  );
  const campaign = fresh.data?.campaign;
  const [name, setName] = useState(null);
  const [budget, setBudget] = useState(null);
  const [review, setReview] = useState(false);
  const submit = useSubmit(onClose);

  // Kotak diisi dari bacaan segar sampai orangnya mengetik (`null` = belum disentuh).
  const nameValue = name ?? campaign?.name ?? "";
  const budgetValue = budget ?? campaign?.dailyBudget ?? "";

  const changes = {};
  if (campaign && nameValue.trim() && nameValue.trim() !== campaign.name)
    changes.name = nameValue.trim();
  if (campaign?.budget.editable && String(budgetValue) !== String(campaign.dailyBudget)) {
    changes.dailyBudget = Number(budgetValue);
  }
  const changed = Object.keys(changes).length > 0;

  const send = (confirmSubDomain) =>
    submit.run(async () => {
      await updateCampaignNow(row.userId, row.campaignId, { ...changes, confirmSubDomain });
      notifySuccess(
        changes.name
          ? "Tersimpan di Meta. Nama baru tampil di tabel sesudah sync akun ini."
          : "Anggaran tersimpan di Meta.",
      );
    });

  let body;
  if (fresh.loading) {
    body = <p className="adset-note">Membaca campaign dari Meta…</p>;
  } else if (fresh.error) {
    body = <Alert>{fresh.error}</Alert>;
  } else if (submit.confirmSubDomain) {
    body = (
      <MappingConfirm
        action="Ya, simpan"
        busy={submit.busy}
        onBack={() => submit.setConfirmSubDomain("")}
        onConfirm={() => send(submit.confirmSubDomain)}
        subDomain={submit.confirmSubDomain}
      />
    );
  } else if (review) {
    body = (
      <ChangeReview
        busy={submit.busy}
        error={submit.error}
        lines={[`Anggaran harian: ${budgetChangeNote(campaign.dailyBudget, changes.dailyBudget)}`]}
        onBack={() => setReview(false)}
        onConfirm={() => send()}
      />
    );
  } else {
    body = (
      <form
        className="campaign-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!changed) return;
          if (changes.dailyBudget !== undefined) setReview(true);
          else send();
        }}
      >
        <LabeledControl
          hint="Nama campaign adalah pemetaannya: kode Keitaro pertama di nama menentukan subdomain yang menerima belanjanya."
          id={`${ids}-name`}
          label="Nama campaign"
        >
          <input
            className="control"
            disabled={submit.busy}
            id={`${ids}-name`}
            maxLength={400}
            onChange={(event) => setName(event.target.value)}
            value={nameValue}
          />
        </LabeledControl>
        <LabeledControl id={`${ids}-budget`} label="Anggaran harian">
          {campaign.budget.editable ? (
            <input
              className="control"
              disabled={submit.busy}
              id={`${ids}-budget`}
              min="1"
              onChange={(event) => setBudget(event.target.value)}
              type="number"
              value={budgetValue}
            />
          ) : (
            <p className="adset-note">{campaign.budget.reason}</p>
          )}
        </LabeledControl>
        {submit.error && <Alert>{submit.error}</Alert>}
        <div className="confirm-actions">
          <button className="ghost-button" disabled={submit.busy} onClick={onClose} type="button">
            Batal
          </button>
          <button className="primary-button" disabled={submit.busy || !changed} type="submit">
            {submit.busy ? "Menyimpan..." : "Simpan"}
          </button>
        </div>
      </form>
    );
  }

  return (
    <DialogShell busy={submit.busy} onClose={onClose} subtitle={row.campaign} title="Ubah campaign">
      {body}
    </DialogShell>
  );
}

/**
 * Anggaran harian yang SAMA untuk beberapa campaign sekaligus.
 *
 * Yang anggarannya dipegang ad set atau lifetime (`dailyBudget === "-"` di tabel) tidak dikirim sama
 * sekali dan DISEBUT jumlahnya — server tetap menolaknya sendiri (`budgetState`) untuk baris yang
 * cerminnya basi. Hasilnya dilaporkan lewat `onDone`, bukan toast per campaign.
 */
export function BulkBudgetDialog({ rows, onClose, onDone }) {
  const ids = useId();
  const [budget, setBudget] = useState("");
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const targets = rows.filter((row) => row.dailyBudget !== "-");
  const skipped = rows.length - targets.length;
  const amount = Number(budget);
  const valid = budget !== "" && Number.isFinite(amount) && amount > 0;

  const send = async () => {
    setBusy(true);
    const result = await runEach(targets, (row) =>
      updateCampaignNow(row.userId, row.campaignId, { dailyBudget: amount }),
    );
    onDone(result);
  };

  return (
    <DialogShell
      busy={busy}
      onClose={onClose}
      subtitle={`${rows.length} campaign dipilih`}
      title="Ubah anggaran harian"
    >
      {review ? (
        <ChangeReview
          busy={busy}
          lines={[
            `Anggaran harian ${targets.length} campaign → ${renderCell(amount, "dailyBudget")}`,
            ...(skipped ? [`${skipped} dilewati: anggarannya di ad set atau lifetime`] : []),
          ]}
          onBack={() => setReview(false)}
          onConfirm={send}
        />
      ) : (
        <form
          className="campaign-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid && targets.length) setReview(true);
          }}
        >
          <LabeledControl id={`${ids}-budget`} label="Anggaran harian baru (Rp)">
            <input
              className="control"
              id={`${ids}-budget`}
              min="1"
              onChange={(event) => setBudget(event.target.value)}
              type="number"
              value={budget}
            />
          </LabeledControl>
          {skipped > 0 && (
            <p className="adset-note">
              {skipped} dari {rows.length} tidak bisa diubah dari sini: anggarannya dipegang ad set
              atau lifetime.
            </p>
          )}
          <div className="confirm-actions">
            <button className="ghost-button" onClick={onClose} type="button">
              Batal
            </button>
            <button className="primary-button" disabled={!valid || !targets.length} type="submit">
              Lanjut
            </button>
          </div>
        </form>
      )}
    </DialogShell>
  );
}

export function EditAdSetDialog({ row, adSet, onClose, onSaved }) {
  const ids = useId();
  const fresh = useFresh(
    () => fetchAdSetEdit(row.userId, row.campaignId, adSet.id),
    [row.userId, row.campaignId, adSet.id],
  );
  const current = fresh.data?.adSet;
  const targeting = current?.targeting;
  const [name, setName] = useState(null);
  const [budget, setBudget] = useState(null);
  const [countriesText, setCountriesText] = useState(null);
  const [ageMin, setAgeMin] = useState(null);
  const [ageMax, setAgeMax] = useState(null);
  const [review, setReview] = useState(false);
  const submit = useSubmit(() => {
    onSaved?.();
    onClose();
  });

  // Kotak diisi dari bacaan segar sampai orangnya mengetik (`null` = belum disentuh).
  const { values, countries, changes, lines, changed } = adSetEditState(current, {
    name,
    budget,
    countries: countriesText,
    ageMin,
    ageMax,
  });

  const send = () =>
    submit.run(async () => {
      await updateAdSetNow(row.userId, row.campaignId, adSet.id, changes);
      notifySuccess("Ad set tersimpan di Meta.");
    });

  let body;
  if (fresh.loading) {
    body = <p className="adset-note">Membaca ad set dari Meta…</p>;
  } else if (fresh.error) {
    body = <Alert>{fresh.error}</Alert>;
  } else if (review) {
    body = (
      <ChangeReview
        busy={submit.busy}
        error={submit.error}
        lines={lines}
        onBack={() => setReview(false)}
        onConfirm={send}
      />
    );
  } else {
    body = (
      <form
        className="campaign-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!changed) return;
          if (lines.length) setReview(true);
          else send();
        }}
      >
        <LabeledControl id={`${ids}-name`} label="Nama ad set">
          <input
            className="control"
            disabled={submit.busy}
            id={`${ids}-name`}
            maxLength={400}
            onChange={(event) => setName(event.target.value)}
            value={values.name}
          />
        </LabeledControl>
        <LabeledControl id={`${ids}-budget`} label="Anggaran harian">
          {current.budget.editable ? (
            <input
              className="control"
              disabled={submit.busy}
              id={`${ids}-budget`}
              min="1"
              onChange={(event) => setBudget(event.target.value)}
              type="number"
              value={values.budget}
            />
          ) : (
            <p className="adset-note">{current.budget.reason}</p>
          )}
        </LabeledControl>
        {targeting.editable ? (
          <>
            <LabeledControl
              hint="Kode ISO dua huruf, dipisah koma. Minat, penempatan, dan pengecualian tidak berubah."
              id={`${ids}-countries`}
              label="Negara"
            >
              <CountryPicker
                disabled={submit.busy}
                id={`${ids}-countries`}
                onChange={setCountriesText}
                value={values.countries}
              />
              <small className="muted-line">
                {countries.map(countryLabel).join(", ") || "Belum ada negara."}
              </small>
            </LabeledControl>
            <div className="campaign-field-row">
              <LabeledControl id={`${ids}-age-min`} label="Umur minimum">
                <input
                  className="control"
                  disabled={submit.busy}
                  id={`${ids}-age-min`}
                  max="65"
                  min="18"
                  onChange={(event) => setAgeMin(event.target.value)}
                  type="number"
                  value={values.ageMin}
                />
              </LabeledControl>
              <LabeledControl id={`${ids}-age-max`} label="Umur maksimum">
                <input
                  className="control"
                  disabled={submit.busy}
                  id={`${ids}-age-max`}
                  max="65"
                  min="18"
                  onChange={(event) => setAgeMax(event.target.value)}
                  type="number"
                  value={values.ageMax}
                />
              </LabeledControl>
            </div>
          </>
        ) : (
          <p className="adset-note">{targeting.reason}</p>
        )}
        {submit.error && <Alert>{submit.error}</Alert>}
        <div className="confirm-actions">
          <button className="ghost-button" disabled={submit.busy} onClick={onClose} type="button">
            Batal
          </button>
          <button className="primary-button" disabled={submit.busy || !changed} type="submit">
            {submit.busy ? "Menyimpan..." : "Simpan"}
          </button>
        </div>
      </form>
    );
  }

  return (
    <DialogShell busy={submit.busy} onClose={onClose} subtitle={adSet.name} title="Ubah ad set">
      {body}
    </DialogShell>
  );
}
