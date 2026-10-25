import {
  CopyPlus,
  FileSearch,
  Loader2,
  RefreshCw,
  RotateCcw,
  Send,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { adsenseCodesKey, adsenseDraftOf, filledCodes, slotIdOf } from "../../lib/adsenseInject";
import {
  CONTROL_API_ENABLED,
  checkAdsenseCodes,
  fetchAdsenseSites,
  injectAdsenseSites,
} from "../../lib/controlApi";
import { notifyError, notifySuccess, notifyWarning } from "../../lib/notify";
import { bulkMessage } from "../../lib/plugin";
import { BusyIcon } from "../ui/BusyIcon";
import { ColumnHint } from "../ui/ColumnHint";
import { DataTable } from "../ui/DataTable";
import { Dialog } from "../ui/Dialog";
import { EmptyMessage } from "../ui/EmptyMessage";
import { SelectField } from "../ui/SelectField";
import { resultStatusColumns, SiteSelect } from "./GptInject";

/**
 * Tab AdSense di /plugin — kode unit ditempel, bukan disusun.
 *
 * Slot AdSense (`data-ad-slot`) hanya lahir dari halaman AdSense; API-nya bisa membaca unit, tidak
 * bisa membuatnya untuk akun kita. Jadi yang diisi superadmin adalah kode utuh per kotak, PER
 * SUBDOMAIN (unit AdSense biasanya dibuat per subdomain: "petcins 1", "cathealth-2"):
 *
 *   1. Pilih subdomain — HANYA yang akun AdSense-nya terdaftar di /adsense-accounts, dicocokkan lewat
 *      daftar Situs tiap akun di AdSense API. Form tiap subdomain terisi dari kode terakhirnya.
 *   2. Tempel kode unit ke Kode iklan 1…N — "Salin ke semua" untuk subdomain yang berbagi unit.
 *   3. Periksa kode: server mengurainya dan mencocokkan slotnya dengan ad unit akun AdSense itu.
 *   4. Periksa dulu (baca situs tanpa menulis), lalu Inject. Yang berhasil disimpan per subdomain.
 *
 * Header situs TIDAK disentuh: yang ditulis cuma Kode iklan 1…N dan Jumlah slot iklan.
 */
export function AdsenseInject({ rows, canManage, saved, onSaveSlots }) {
  const [selected, setSelected] = useState(() => new Set());
  const [activeId, setActiveId] = useState("");
  const [drafts, setDrafts] = useState({});
  const [checks, setChecks] = useState({});
  const [busy, setBusy] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [results, setResults] = useState(null);

  const disabled = !CONTROL_API_ENABLED || !canManage;

  /**
   * Peta subdomain → akun AdSense, dibaca sekali saat tab dibuka. Kegagalan DISIMPAN sebagai jawaban
   * (bukan cuma di-toast), supaya spinner berhenti dan tombol Coba lagi muncul — pelajaran yang sama
   * dengan pencarian akun GAM di tab AdX.
   */
  const [adsenseSites, setAdsenseSites] = useState(null);
  const [sitesRound, setSitesRound] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `sitesRound` adalah pemicu "Coba lagi" — nilainya sengaja tidak dibaca.
  useEffect(() => {
    if (!CONTROL_API_ENABLED) return undefined;
    let alive = true;
    setAdsenseSites(null);
    fetchAdsenseSites()
      .then((data) => alive && setAdsenseSites({ error: "", ...data }))
      .catch((error) => {
        if (!alive) return;
        setAdsenseSites({ error: error.message, accounts: [], sites: {} });
        notifyError(error, "Daftar situs akun AdSense gagal dibaca.");
      });
    return () => {
      alive = false;
    };
  }, [sitesRound]);

  const accountErrors = (adsenseSites?.accounts || []).filter((account) => account.error);
  // Yang ditawarkan: terhubung ke plugin DAN akun AdSense-nya terdaftar.
  const siteAccounts = adsenseSites?.sites;
  const enrolled = useMemo(
    () => rows.filter((row) => row.enrolled && siteAccounts?.[row.id]),
    [rows, siteAccounts],
  );
  const hiddenCount = rows.filter((row) => row.enrolled && !siteAccounts?.[row.id]).length;
  const nameOf = (id) => enrolled.find((row) => row.id === id)?.name || id;
  const ids = enrolled.map((row) => row.id).filter((id) => selected.has(id));
  const active = ids.includes(activeId) ? activeId : ids[0] || "";

  // Draf yang belum disentuh jatuh ke kode tersimpan — tanpa menyalinnya ke state, supaya baris
  // tersimpan yang baru datang dari langganan tetap terbaca.
  const draftOf = (id) => drafts[id] || adsenseDraftOf(saved?.[id]);
  const draft = active ? draftOf(active) : adsenseDraftOf(null);

  const setBox = (index, value) =>
    setDrafts((current) => {
      const next = [...(current[active] || adsenseDraftOf(saved?.[active]))];
      next[index] = value;
      return { ...current, [active]: next };
    });

  // Hasil "Periksa kode" yang masih berlaku: untuk kode yang SAMA dengan yang tergambar.
  const checkOf = (id) => {
    const entry = checks[id];
    return entry && entry.key === adsenseCodesKey(draftOf(id)) ? entry : null;
  };

  const withCodes = ids.filter((id) => filledCodes(draftOf(id)).length > 0);
  const targets = withCodes.filter((id) => checkOf(id)?.result);
  const unchecked = withCodes.filter((id) => !checkOf(id));
  const failedChecks = withCodes.filter((id) => checkOf(id)?.error);

  const checkAll = async () => {
    setBusy("check");
    const entries = await Promise.all(
      withCodes.map(async (id) => {
        const codes = filledCodes(draftOf(id));
        const key = adsenseCodesKey(codes);
        try {
          return [id, { key, result: await checkAdsenseCodes(id, codes), error: "" }];
        } catch (error) {
          return [id, { key, result: null, error: error.message }];
        }
      }),
    );
    setChecks((current) => ({ ...current, ...Object.fromEntries(entries) }));
    const failed = entries.filter(([, entry]) => entry.error).length;
    failed
      ? notifyWarning(
          `${failed} dari ${entries.length} subdomain kodenya ditolak — sebabnya di panel kanan.`,
        )
      : notifySuccess(`Kode ${entries.length} subdomain lolos pemeriksaan.`);
    setBusy("");
  };

  const copyToAll = () => {
    const source = [...draft];
    setDrafts((current) => ({
      ...current,
      ...Object.fromEntries(ids.map((id) => [id, [...source]])),
    }));
    notifySuccess(`Kode ${nameOf(active)} disalin ke ${ids.length - 1} subdomain lain.`);
  };

  const run = async (dryRun) => {
    setBusy(dryRun ? "dry" : "inject");
    const items = targets.map((id) => ({ siteId: id, codes: filledCodes(draftOf(id)) }));
    try {
      const res = await injectAdsenseSites(items, { dryRun });
      if (dryRun) {
        res.summary.failed
          ? notifyWarning(`${res.summary.failed} dari ${res.summary.total} situs gagal dibaca.`)
          : notifySuccess(`Rencana ${res.summary.total} situs terbaca — belum ada yang ditulis.`);
      } else {
        const { tone, message } = bulkMessage(res.summary, "Kode AdSense");
        tone === "success" ? notifySuccess(message) : notifyWarning(message, res.summary);
        // Yang tertulis di situs disimpan sebagai kode subdomain itu; yang gagal tidak.
        const written = res.results.filter((row) => row.status !== "failed");
        await Promise.all(
          written.map((row) =>
            onSaveSlots?.(
              row.subdomainId,
              row.name,
              items.find((item) => item.siteId === row.subdomainId)?.codes || [],
            ),
          ),
        );
      }
      setResults({
        title: dryRun ? "Periksa inject AdSense" : "Inject kode AdSense",
        dryRun,
        ...res,
      });
      setConfirming(false);
    } catch (error) {
      notifyError(error, dryRun ? "Pemeriksaan gagal dijalankan." : "Inject gagal dijalankan.");
    } finally {
      setBusy("");
    }
  };

  const activeCheck = active ? checkOf(active) : null;
  const ready = !disabled && busy === "" && targets.length > 0;
  const siteOptions = ids.map((id) => {
    const count = filledCodes(draftOf(id)).length;
    const entry = checkOf(id);
    const state = entry?.error ? "ditolak" : entry ? "lolos" : count ? "belum diperiksa" : "kosong";
    return { value: id, label: `${nameOf(id)} — ${count} kode, ${state}` };
  });

  return (
    <section className="panel">
      <div className="gpt-inject-layout">
        <div className="gpt-inject-form">
          <fieldset className="plugin-fieldset">
            <legend>
              1. Pilih subdomain
              <ColumnHint
                icon="info"
                text="Hanya subdomain yang terhubung ke plugin DAN terdaftar di daftar Situs salah satu akun di /adsense-accounts (dibaca dari AdSense API)."
              />
            </legend>
            {adsenseSites?.error ? (
              <div className="plugin-load-error">
                <p className="plugin-alert plugin-alert-inline">
                  <TriangleAlert size={15} />
                  <span>Daftar situs akun AdSense gagal dibaca: {adsenseSites.error}</span>
                </p>
                <button
                  className="ghost-button"
                  onClick={() => setSitesRound((round) => round + 1)}
                  type="button"
                >
                  <RefreshCw size={15} />
                  <span>Coba lagi</span>
                </button>
              </div>
            ) : CONTROL_API_ENABLED && !adsenseSites ? (
              <p aria-live="polite" className="gpt-loading">
                <Loader2 className="icon-spin" size={15} />
                <span>Membaca daftar situs akun AdSense...</span>
              </p>
            ) : enrolled.length === 0 ? (
              <p className="muted-line">
                Tidak ada subdomain terhubung yang terdaftar di akun AdSense mana pun.
              </p>
            ) : (
              <>
                <SiteSelect
                  disabled={disabled}
                  enrolled={enrolled}
                  loading={false}
                  onChange={setSelected}
                  selected={selected}
                />
                {hiddenCount > 0 && (
                  <small className="muted-line">
                    {hiddenCount} subdomain terhubung tidak ditampilkan — tidak terdaftar di akun
                    AdSense.
                  </small>
                )}
              </>
            )}
            {accountErrors.length > 0 && (
              <p className="plugin-alert plugin-alert-inline">
                <TriangleAlert size={15} />
                <span>
                  {accountErrors.length} akun AdSense gagal dibaca, subdomainnya tidak ikut tampil:{" "}
                  {accountErrors
                    .map((account) => `${account.accountName} (${account.error})`)
                    .join("; ")}
                </span>
              </p>
            )}
          </fieldset>

          <fieldset className="plugin-fieldset">
            <legend>
              2. Kode unit iklan
              <ColumnHint
                icon="info"
                text="Salin dari AdSense → Iklan → Menurut unit iklan → ikon Dapatkan kode, satu unit per kotak. Kotak 1…N ditulis ke Kode iklan 1…N dan Jumlah slot iklan jadi N. Header situs tidak disentuh."
              />
            </legend>
            {!active ? (
              <p className="muted-line">
                Pilih subdomain dulu — kotak kode iklannya muncul di sini.
              </p>
            ) : (
              <>
                {ids.length > 1 && (
                  <div className="field plugin-field-wide">
                    <label htmlFor="adsense-site">Subdomain yang sedang diisi</label>
                    <SelectField
                      inputId="adsense-site"
                      onChange={setActiveId}
                      options={siteOptions}
                      searchable
                      value={active}
                    />
                  </div>
                )}
                <div className="form-grid">
                  {draft.map((code, index) => {
                    const slot = slotIdOf(code);
                    return (
                      // biome-ignore lint/suspicious/noArrayIndexKey: kotak ke-N adalah Kode iklan N — posisinya adalah identitasnya.
                      <div className="field plugin-field-wide" key={index}>
                        <label htmlFor={`adsense-code-${index}`}>
                          Kode iklan {index + 1}
                          {slot && <span className="plugin-field-unit">(slot {slot})</span>}
                        </label>
                        <textarea
                          className="control plugin-textarea adsense-code-box"
                          disabled={disabled}
                          id={`adsense-code-${index}`}
                          onChange={(event) => setBox(index, event.target.value)}
                          placeholder={
                            index === 0
                              ? '<script async src="https://pagead2.googlesyndication.com/…"></script>\n<ins class="adsbygoogle" … data-ad-slot="…"></ins>'
                              : ""
                          }
                          rows={index < filledCodes(draft).length || index === 0 ? 5 : 2}
                          spellCheck={false}
                          value={code}
                        />
                      </div>
                    );
                  })}
                </div>
                <div className="plugin-actions-buttons gpt-inject-step-actions">
                  {saved?.[active] && drafts[active] && (
                    <button
                      className="ghost-button"
                      disabled={disabled || busy !== ""}
                      onClick={() =>
                        setDrafts((current) => {
                          const { [active]: _, ...rest } = current;
                          return rest;
                        })
                      }
                      title="Kembalikan kotak ke kode yang terakhir di-inject ke subdomain ini"
                      type="button"
                    >
                      <RotateCcw size={15} />
                      <span>Kode tersimpan</span>
                    </button>
                  )}
                  {ids.length > 1 && (
                    <button
                      className="ghost-button"
                      disabled={disabled || busy !== "" || !filledCodes(draft).length}
                      onClick={copyToAll}
                      type="button"
                    >
                      <CopyPlus size={15} />
                      <span>Salin ke semua subdomain</span>
                    </button>
                  )}
                  <button
                    className="primary-button"
                    disabled={disabled || busy !== "" || !withCodes.length}
                    onClick={checkAll}
                    type="button"
                  >
                    <BusyIcon busy={busy === "check"} icon={ShieldCheck} />
                    <span>
                      {busy === "check"
                        ? `Memeriksa ${withCodes.length} subdomain...`
                        : withCodes.length > 1
                          ? `Periksa kode (${withCodes.length})`
                          : "Periksa kode"}
                    </span>
                  </button>
                </div>
              </>
            )}
          </fieldset>
        </div>

        <div className="gpt-inject-output">
          {busy === "check" && !activeCheck ? (
            <p aria-live="polite" className="gpt-loading">
              <Loader2 className="icon-spin" size={15} />
              <span>Mencocokkan slot dengan ad unit akun AdSense...</span>
            </p>
          ) : !activeCheck ? (
            <EmptyMessage>
              Tempel kode unit dari AdSense, lalu tekan Periksa kode — akun, nama unit, dan
              ukurannya muncul di sini.
            </EmptyMessage>
          ) : activeCheck.error ? (
            <p className="plugin-alert">
              <TriangleAlert size={15} />
              <span>
                {nameOf(active)}: {activeCheck.error}
              </span>
            </p>
          ) : (
            <CheckResult result={activeCheck.result} />
          )}
        </div>
      </div>

      <div className="plugin-actions gpt-inject-footer">
        <span className="muted-line">
          {targets.length
            ? `${targets.length} subdomain siap ditulis.`
            : "Tempel dan periksa kode subdomain terpilih dulu."}
          {unchecked.length > 0 && ` ${unchecked.length} belum diperiksa.`}
          {failedChecks.length > 0 && ` ${failedChecks.length} ditolak dan tidak ikut.`}
        </span>
        <div className="plugin-actions-buttons">
          <button
            className="ghost-button"
            disabled={!ready}
            onClick={() => run(true)}
            title="Membaca kode iklan tiap situs lalu melaporkan apa yang akan diganti — tanpa menulis apa pun."
            type="button"
          >
            <BusyIcon busy={busy === "dry"} icon={FileSearch} />
            <span>{busy === "dry" ? `Memeriksa ${targets.length} situs...` : "Periksa dulu"}</span>
          </button>
          <button
            className="danger-button"
            disabled={!ready}
            onClick={() => setConfirming(true)}
            type="button"
          >
            <BusyIcon busy={busy === "inject"} icon={Send} />
            <span>Inject ke {targets.length} situs</span>
          </button>
        </div>
      </div>

      {confirming && (
        <ConfirmAdsense
          busy={busy === "inject"}
          checks={targets.map((id) => checkOf(id).result)}
          onCancel={() => setConfirming(false)}
          onConfirm={() => run(false)}
        />
      )}

      {results && <AdsenseResults onClose={() => setResults(null)} {...results} />}
    </section>
  );
}

// Akun, lalu tiap kotak: slot, nama unit, ukuran. Yang belum terverifikasi dan domain yang tidak ada
// di Situs akun disebut di atas daftarnya — keduanya tidak menolak, tapi keduanya bisa berarti nol.
function CheckResult({ result }) {
  return (
    <div className="gpt-networks">
      {!result.verified && (
        <p className="plugin-alert plugin-alert-inline">
          <TriangleAlert size={15} />
          <span>Slot belum terverifikasi: {result.slots.find((row) => row.note)?.note}</span>
        </p>
      )}
      {result.siteNote && (
        <p className="plugin-alert plugin-alert-inline">
          <TriangleAlert size={15} />
          <span>{result.siteNote}</span>
        </p>
      )}
      <div className="gpt-network">
        <dl className="gpt-network-meta">
          <div>
            <dt>Subdomain</dt>
            <dd>{result.name}</dd>
          </div>
          <div>
            <dt>Publisher</dt>
            <dd>{result.client}</dd>
          </div>
          <div>
            <dt>Akun AdSense</dt>
            <dd>{result.accountName || "-"}</dd>
          </div>
          <div>
            <dt>Slot</dt>
            <dd>{result.slots.length}</dd>
          </div>
        </dl>
        <ul className="plugin-diff-list">
          {result.slots.map((row, index) => (
            <li key={row.slot}>
              <span>Kode iklan {index + 1}</span>
              <code>
                {[row.slot, row.displayName, row.size].filter(Boolean).join(" · ")}
                {row.verified && row.note ? ` — ${row.note}` : ""}
              </code>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function ConfirmAdsense({ checks, busy, onCancel, onConfirm }) {
  return (
    <Dialog
      className="confirm-dialog plugin-dialog"
      busy={busy}
      onClose={onCancel}
      subtitle={<>{checks.length} situs terpilih.</>}
      title="Inject kode AdSense"
    >
      <p className="plugin-alert">
        <TriangleAlert size={15} />
        <span>
          Ini menulis ke situs yang sedang menerima trafik iklan berbayar, sekarang juga. Kode iklan
          yang salah tidak menghasilkan error di mana pun — ia menghasilkan pendapatan nol. Pakai
          Periksa dulu kalau belum.
        </span>
      </p>

      <ul className="plugin-diff-list">
        <li>
          <span>Header code</span>
          <code>tidak disentuh</code>
        </li>
        <li>
          <span>Kode iklan 1–N</span>
          <code>ditimpa kode yang ditempel</code>
        </li>
        <li>
          <span>Kode iklan sesudahnya</span>
          <code>dikosongkan hanya kalau isinya kode AdSense/GPT</code>
        </li>
        <li>
          <span>Jumlah slot iklan</span>
          <code>N (jumlah kode per situs)</code>
        </li>
      </ul>

      <div className="plugin-target-list">
        {checks.map((row) => (
          <div className="plugin-target-row" key={row.name}>
            <span>{row.name}</span>
            <span className="muted-line">
              {row.slots.length} slot · {row.client}
              {row.verified ? "" : " · belum terverifikasi"}
            </span>
          </div>
        ))}
      </div>

      <div className="confirm-actions">
        <button className="ghost-button" disabled={busy} onClick={onCancel} type="button">
          Batal
        </button>
        <button className="danger-button" disabled={busy} onClick={onConfirm} type="button">
          <BusyIcon busy={busy} icon={Send} />
          <span>
            {busy ? `Menulis ke ${checks.length} situs...` : `Inject ke ${checks.length} situs`}
          </span>
        </button>
      </div>
    </Dialog>
  );
}

function AdsenseResults({ title, dryRun, results, summary, onClose }) {
  const resultColumns = [
    ...resultStatusColumns(dryRun),
    {
      id: "slots",
      header: "Slot",
      cell: ({ row }) => <NoteLines lines={row.original.detail?.slots || []} />,
    },
    {
      id: "note",
      header: "Keterangan",
      cell: ({ row }) => row.original.error || <NoteLines lines={resultNotes(row.original)} />,
    },
  ];

  return (
    <Dialog
      className="confirm-dialog plugin-dialog gpt-results-dialog"
      onClose={onClose}
      subtitle={
        dryRun
          ? `${summary.total - summary.failed} situs terbaca, ${summary.failed} gagal — belum ada yang ditulis.`
          : `${summary.ok} berhasil, ${summary.unapplied} tidak berubah, ${summary.failed} gagal dari ${summary.total} situs.`
      }
      title={title}
    >
      <DataTable
        columns={resultColumns}
        dense
        getRowId={(row) => String(row.subdomainId)}
        items={results}
      />

      <div className="confirm-actions">
        <button className="primary-button" onClick={onClose} type="button">
          Tutup
        </button>
      </div>
    </Dialog>
  );
}

function resultNotes(row) {
  const detail = row.detail || {};
  return [
    ...(row.unapplied?.length ? [`Ditolak diam-diam: ${row.unapplied.join(", ")}`] : []),
    ...(detail.notes || []),
    ...(detail.replaced?.length ? [`Ditimpa: ${detail.replaced.join(", ")}`] : []),
    ...(detail.cleared?.length ? [`Dikosongkan: ${detail.cleared.join(", ")}`] : []),
    ...(detail.previousSlotCount !== undefined && detail.previousSlotCount !== ""
      ? [`Jumlah slot sebelumnya: ${detail.previousSlotCount}`]
      : []),
  ];
}

function NoteLines({ lines }) {
  if (!lines.length) return "-";
  return (
    <div className="gpt-result-note">
      {lines.map((line) => (
        <small className="muted-line" key={line}>
          {line}
        </small>
      ))}
    </div>
  );
}
