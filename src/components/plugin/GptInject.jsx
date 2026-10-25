import {
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  FileSearch,
  Loader2,
  RefreshCw,
  Save,
  Send,
  Sparkles,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  CONTROL_API_ENABLED,
  fetchGptNetworks,
  injectGptSites,
  previewGptInject,
} from "../../lib/controlApi";
import {
  BUILT_IN_GPT_TEMPLATES,
  chosenUnits,
  GPT_MAX_SLOTS,
  gptSpecKey,
  gptTemplatesOf,
  headerModeLabel,
  matchingTemplate,
  sizeTokens,
} from "../../lib/gptInject";
import { notifyError, notifySuccess, notifyWarning } from "../../lib/notify";
import { bulkLabel, bulkMessage, bulkTone } from "../../lib/plugin";
import { BusyIcon } from "../ui/BusyIcon";
import { ColumnHint } from "../ui/ColumnHint";
import { CopyButton } from "../ui/CopyButton";
import { DataTable } from "../ui/DataTable";
import { Dialog } from "../ui/Dialog";
import { EmptyMessage } from "../ui/EmptyMessage";
import { SelectField } from "../ui/SelectField";

const SLOT_OPTIONS = Array.from({ length: GPT_MAX_SLOTS }, (_, index) => ({
  value: index + 1,
  label: `${index + 1} slot`,
}));

/**
 * Tab AdX — satu tag Ad Manager per network, ditulis ke banyak subdomain sekaligus.
 *
 * TIDAK ADA kotak untuk kode Ad Manager, unit iklan, maupun div id. Alurnya dimulai dari subdomain:
 *
 *   1. Pilih subdomain. Server membaca akun GAM-nya (/gam-accounts), lalu network code, properti,
 *      dan unit iklan network itu langsung dari Ad Manager API.
 *   2. Tiap network menampilkan slot iklan yang tersedia; bawaannya unit Ad Exchange Display
 *      (`ca-pub-…-tag`). Kode `ca-pub` di unit itu BUKAN Publisher ID akun — itu sebabnya ia dibaca,
 *      bukan dirakit.
 *   3. Pilih jumlah slot dan template ukuran, lalu Generate — pratinjau disusun server, penyusun
 *      yang sama dengan yang menulis.
 *   4. Periksa dulu (membaca situs tanpa menulis), lalu Inject.
 *
 * Tombol Inject membaca pilihan PRATINJAUNYA dan mati begitu form berbeda darinya: orang yang
 * mengubah jumlah slot sesudah Generate akan menulis kode yang tidak pernah ia lihat.
 */
export function GptInject({
  rows,
  canManage,
  templates,
  onSaveTemplate,
  onUpdateTemplate,
  onRemoveTemplate,
}) {
  const [selected, setSelected] = useState(() => new Set());
  const [lookup, setLookup] = useState(null);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [picked, setPicked] = useState({});
  const [options, setOptions] = useState({
    sizes: BUILT_IN_GPT_TEMPLATES[0].sizes,
    slots: 3,
  });
  const [templateName, setTemplateName] = useState("");
  // Template tersimpan yang terakhir dipilih — supaya daftar ukurannya yang disunting bisa DIPERBARUI
  // ke template itu, bukan cuma disimpan sebagai template baru.
  const [baseTemplateId, setBaseTemplateId] = useState("");
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [results, setResults] = useState(null);

  const disabled = !CONTROL_API_ENABLED || !canManage;

  // Hanya yang terhubung: situs yang belum enroll tidak punya kunci plugin.
  const enrolled = useMemo(() => rows.filter((row) => row.enrolled), [rows]);
  const selectionKey = [...selected].sort().join(",");

  /**
   * Akun GAM + unit iklan dibaca SENDIRI begitu pilihan berubah, dengan jeda: mencentang lima
   * subdomain berturut-turut tidak boleh jadi lima panggilan Ad Manager. Jawaban yang datang untuk
   * pilihan yang sudah berganti dibuang — yang tergambar harus selalu milik centang yang terlihat.
   */
  const [lookupRound, setLookupRound] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `lookupRound` adalah pemicu "Coba lagi" — nilainya sengaja tidak dibaca.
  useEffect(() => {
    // Status muat DITURUNKAN di sini juga, bukan cuma saat permintaan selesai: permintaan yang
    // dibatalkan (pilihan dikosongkan atau berganti di tengah jalan) tidak pernah sampai ke `finally`
    // miliknya, dan spinner yang dinyalakannya berputar selamanya.
    setLookupBusy(false);
    if (!CONTROL_API_ENABLED || !selectionKey) {
      setLookup(null);
      return undefined;
    }
    let alive = true;
    const timer = setTimeout(async () => {
      setLookupBusy(true);
      try {
        const data = await fetchGptNetworks(selectionKey.split(","));
        if (alive) setLookup({ key: selectionKey, error: "", ...data });
      } catch (error) {
        /**
         * Kegagalan DISIMPAN sebagai jawaban untuk pilihan ini, bukan cuma di-toast. Tanpa itu `fresh`
         * tetap kosong, dan layar yang membaca "belum ada jawaban" sebagai "sedang membaca" memutar
         * spinner selamanya untuk permintaan yang sudah lama gagal.
         */
        if (alive) {
          setLookup({ key: selectionKey, error: error.message, sites: [], networks: [] });
          notifyError(error, "Akun GAM subdomain terpilih gagal dibaca.");
        }
      } finally {
        if (alive) setLookupBusy(false);
      }
    }, 600);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [selectionKey, lookupRound]);

  const fresh = lookup?.key === selectionKey ? lookup : null;
  const networks = fresh?.networks || [];
  const nameOf = (id) => enrolled.find((row) => row.id === id)?.name || id;
  const siteErrors = (fresh?.sites || []).filter((site) => site.error);
  // Yang dikirim: subdomain yang akun GAM-nya ketemu DAN network-nya punya unit terpilih.
  const units = chosenUnits(networks, picked);
  const targets = (fresh?.sites || []).filter(
    (site) => !site.error && units[site.networkCode] !== undefined,
  );

  const list = useMemo(() => gptTemplatesOf(templates), [templates]);
  const current = matchingTemplate(list, options.sizes);
  const sizeCount = sizeTokens(options.sizes).length;
  const key = gptSpecKey(options, units);
  // Pratinjau memuat SELURUH subdomain tujuan, jadi yang membuatnya basi juga pilihan subdomainnya.
  const targetsKey = targets
    .map((site) => site.subdomainId)
    .sort()
    .join(",");
  const stale = Boolean(preview) && (preview.key !== key || preview.targetsKey !== targetsKey);

  // Ukuran yang benar-benar diterima unit terpilih, ditawarkan sebagai template — hanya kalau
  // pilihannya satu network: dua network dengan daftar berbeda tidak punya satu "ukuran unit ini".
  const unitSizes =
    networks.length === 1
      ? networks[0].units.find((unit) => unit.adUnitCode === units[networks[0].networkCode])
          ?.sizes || ""
      : "";
  // "Ukuran kustom" berdiri sebagai opsi yang TERGAMBAR, bukan placeholder: ia jawaban yang sah atas
  // "template mana yang sedang dipakai" — daftar ukurannya disunting tangan — dan dropdown yang tampil
  // kosong untuk keadaan itu terbaca seperti pilihan yang hilang.
  const onUnitSizes =
    Boolean(unitSizes) && sizeTokens(unitSizes).join(",") === sizeTokens(options.sizes).join(",");

  // Dropdown sedang berbunyi "Ukuran kustom": daftarnya bukan template mana pun dan bukan ukuran unit.
  const customSizes = !current && !onUnitSizes;
  const baseTemplate = list.find((item) => item.id === baseTemplateId && !item.builtIn) || null;
  const editedBase = Boolean(baseTemplate) && current?.id !== baseTemplate.id && sizeCount > 0;

  const templateOptions = [
    // Bisa DIPILIH: mengosongkan daftar ukuran dan memindahkan kursor ke sana, untuk menyusun template
    // sendiri dari nol. Juga label yang tergambar saat daftarnya disunting tangan.
    { value: "", label: "Ukuran kustom" },
    ...(unitSizes
      ? [{ value: "unit", label: `Ukuran unit terpilih (${sizeTokens(unitSizes).length})` }]
      : []),
    ...list.map((item) => ({
      value: item.id,
      label: `${item.name} (${sizeTokens(item.sizes).length})${item.builtIn ? "" : " — tersimpan"}`,
    })),
  ];

  const set = (patch) => setOptions((value) => ({ ...value, ...patch }));

  const generate = async () => {
    setBusy("preview");
    try {
      const data = await previewGptInject(
        targets.map((site) => site.subdomainId),
        options,
        units,
      );
      setPreview({ sites: data.sites || [], key, targetsKey });
    } catch (error) {
      notifyError(error, "Kode gagal disusun.");
    } finally {
      setBusy("");
    }
  };

  const saveTemplate = async () => {
    setBusy("template");
    try {
      const saved = await onSaveTemplate?.({ name: templateName, sizes: options.sizes }, list);
      if (saved) {
        setTemplateName("");
        setBaseTemplateId(saved.id);
      }
    } finally {
      setBusy("");
    }
  };

  const updateTemplate = async () => {
    setBusy("template-update");
    try {
      await onUpdateTemplate?.(baseTemplate, options.sizes);
    } finally {
      setBusy("");
    }
  };

  const removeTemplate = async (id) => {
    setBusy("template-remove");
    try {
      await onRemoveTemplate?.(id);
    } finally {
      setBusy("");
    }
  };

  const run = async (dryRun) => {
    setBusy(dryRun ? "dry" : "inject");
    try {
      // Stempel div PER SUBDOMAIN dari pratinjau ikut dikirim: yang ditulis harus div id yang tergambar.
      const divStamps = Object.fromEntries(
        preview.sites
          .filter((site) => site.divStamp)
          .map((site) => [site.subdomainId, site.divStamp]),
      );
      const res = await injectGptSites(
        targets.map((site) => site.subdomainId),
        { ...options, divStamps },
        units,
        { dryRun },
      );
      if (dryRun) {
        res.summary.failed
          ? notifyWarning(`${res.summary.failed} dari ${res.summary.total} situs gagal dibaca.`)
          : notifySuccess(`Rencana ${res.summary.total} situs terbaca — belum ada yang ditulis.`);
      } else {
        const { tone, message } = bulkMessage(res.summary, "Kode Ad Manager");
        tone === "success" ? notifySuccess(message) : notifyWarning(message, res.summary);
      }
      setResults({ title: dryRun ? "Periksa inject" : "Inject kode Ad Manager", dryRun, ...res });
      setConfirming(false);
    } catch (error) {
      notifyError(error, dryRun ? "Pemeriksaan gagal dijalankan." : "Inject gagal dijalankan.");
    } finally {
      setBusy("");
    }
  };

  const previewErrors = (preview?.sites || []).filter((site) => site.error).length;
  const ready =
    !disabled &&
    busy === "" &&
    Boolean(preview) &&
    !stale &&
    previewErrors === 0 &&
    targets.length > 0;

  return (
    <section className="panel">
      <div className="gpt-inject-layout">
        <div className="gpt-inject-form">
          <fieldset className="plugin-fieldset">
            <legend>1. Pilih subdomain</legend>
            {enrolled.length === 0 ? (
              <p className="muted-line">
                Belum ada situs yang terhubung. Enroll dulu di tab Daftar Plugin.
              </p>
            ) : (
              <SiteSelect
                disabled={disabled}
                loading={lookupBusy}
                enrolled={enrolled}
                onChange={setSelected}
                selected={selected}
              />
            )}
          </fieldset>

          <fieldset className="plugin-fieldset">
            <legend>
              2. Network & slot iklan
              <ColumnHint
                icon="info"
                text="Dibaca dari akun GAM di /gam-accounts yang domainnya sama dengan subdomain terpilih, lalu daftar unit iklan network itu dari Ad Manager API. Bawaannya unit Ad Exchange Display (ca-pub-…-tag)."
              />
            </legend>
            {!selected.size ? (
              <p className="muted-line">
                Pilih subdomain dulu — network code, properti, dan slot iklannya muncul di sini.
              </p>
            ) : fresh?.error && !lookupBusy ? (
              <div className="plugin-load-error">
                <p className="plugin-alert plugin-alert-inline">
                  <TriangleAlert size={15} />
                  <span>Akun GAM dan unit iklan gagal dibaca: {fresh.error}</span>
                </p>
                <button
                  className="ghost-button"
                  onClick={() => setLookupRound((round) => round + 1)}
                  type="button"
                >
                  <RefreshCw size={15} />
                  <span>Coba lagi</span>
                </button>
              </div>
            ) : lookupBusy || !fresh ? (
              <p aria-live="polite" className="gpt-loading">
                <Loader2 className="icon-spin" size={15} />
                <span>Membaca akun GAM dan unit iklan dari Ad Manager...</span>
              </p>
            ) : (
              <div className="gpt-networks">
                {siteErrors.length > 0 && (
                  <p className="plugin-alert plugin-alert-inline">
                    <TriangleAlert size={15} />
                    <span>
                      {siteErrors.length} subdomain tidak ikut:{" "}
                      {siteErrors
                        .map((site) => `${nameOf(site.subdomainId)} (${site.error})`)
                        .join("; ")}
                    </span>
                  </p>
                )}
                {networks.map((network) => (
                  <NetworkCard
                    disabled={disabled}
                    key={network.networkCode}
                    members={fresh.sites.filter(
                      (site) => site.networkCode === network.networkCode && !site.error,
                    )}
                    network={network}
                    onPick={(code) =>
                      setPicked((value) => ({ ...value, [network.networkCode]: code }))
                    }
                    selectedUnit={units[network.networkCode]}
                  />
                ))}
              </div>
            )}
          </fieldset>

          <fieldset className="plugin-fieldset">
            <legend>3. Slot & ukuran</legend>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="gpt-slots">
                  Jumlah slot
                  <ColumnHint
                    icon="info"
                    text={`Satu slot = satu defineSlot di header + satu kotak Kode iklan. Plugin punya ${GPT_MAX_SLOTS} kotak, jadi maksimal ${GPT_MAX_SLOTS}.`}
                  />
                </label>
                <SelectField
                  disabled={disabled}
                  inputId="gpt-slots"
                  onChange={(next) => set({ slots: next })}
                  options={SLOT_OPTIONS}
                  value={options.slots}
                />
              </div>
              <div className="field">
                <label htmlFor="gpt-template">
                  Template ukuran
                  <ColumnHint
                    icon="info"
                    text="Memilih template mengganti daftar ukuran di bawahnya. Menyunting daftarnya membuat pilihan ini berbunyi Ukuran kustom — simpan sebagai template baru untuk dipakai lagi."
                  />
                </label>
                <div className="gpt-template-row">
                  <SelectField
                    className="gpt-template-select"
                    disabled={disabled}
                    inputId="gpt-template"
                    onChange={(next) => {
                      if (next === "unit") set({ sizes: unitSizes });
                      const template = list.find((item) => item.id === next);
                      if (template) {
                        set({ sizes: template.sizes });
                        setBaseTemplateId(template.id);
                      }
                      // Hanya kalau sebelumnya template yang terpilih: memilih "Ukuran kustom" saat
                      // daftarnya sudah kustom tidak boleh menghapus suntingan orang.
                      if (next === "" && (current || onUnitSizes)) {
                        set({ sizes: "" });
                        setBaseTemplateId("");
                        document.getElementById("gpt-sizes")?.focus();
                      }
                    }}
                    options={templateOptions}
                    value={current?.id || (onUnitSizes ? "unit" : "")}
                  />
                  {current && !current.builtIn && (
                    <button
                      aria-label={`Hapus template ${current.name}`}
                      className="ghost-button icon-button"
                      disabled={disabled || busy !== ""}
                      onClick={() => removeTemplate(current.id)}
                      title="Hapus template ini"
                      type="button"
                    >
                      <BusyIcon busy={busy === "template-remove"} icon={Trash2} />
                    </button>
                  )}
                </div>
              </div>
              <div className="field plugin-field-wide">
                <label htmlFor="gpt-sizes">
                  Ukuran slot
                  <span className="plugin-field-unit">({sizeCount} ukuran)</span>
                </label>
                <textarea
                  className="control plugin-textarea"
                  disabled={disabled}
                  id="gpt-sizes"
                  onChange={(event) => set({ sizes: event.target.value })}
                  placeholder="300x250, 336x280, 728x90, fluid"
                  rows={3}
                  value={options.sizes}
                />
              </div>
              {/* Simpan sebagai template hanya saat dropdown berbunyi "Ukuran kustom" — daftar yang sama
                  dengan template atau ukuran unit tidak punya apa pun yang baru untuk disimpan. */}
              {customSizes && (
                <div className="field plugin-field-wide">
                  <label htmlFor="gpt-template-name">
                    Simpan sebagai template
                    <ColumnHint
                      icon="info"
                      text="Beri nama daftar ukuran di atas supaya bisa dipilih lagi dari Template ukuran. Tersimpan untuk seluruh superadmin."
                    />
                  </label>
                  <div className="gpt-template-row">
                    <input
                      className="control"
                      disabled={disabled}
                      id="gpt-template-name"
                      maxLength={60}
                      onChange={(event) => setTemplateName(event.target.value)}
                      placeholder="Nama template, mis. Uji mobile kecil"
                      value={templateName}
                    />
                    <button
                      className="ghost-button"
                      disabled={disabled || busy !== "" || !templateName.trim() || sizeCount === 0}
                      onClick={saveTemplate}
                      type="button"
                    >
                      <BusyIcon busy={busy === "template"} icon={Save} />
                      <span>{busy === "template" ? "Menyimpan..." : "Simpan template"}</span>
                    </button>
                  </div>
                  {sizeCount === 0 && <small className="muted-line">Isi daftar ukuran dulu.</small>}
                  {editedBase && (
                    <div className="gpt-template-row">
                      <small className="muted-line">
                        Daftar ini hasil suntingan template "{baseTemplate.name}".
                      </small>
                      <button
                        className="ghost-button"
                        disabled={disabled || busy !== ""}
                        onClick={updateTemplate}
                        type="button"
                      >
                        <BusyIcon busy={busy === "template-update"} icon={Save} />
                        <span>
                          {busy === "template-update"
                            ? "Memperbarui..."
                            : `Perbarui "${baseTemplate.name}"`}
                        </span>
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="plugin-actions-buttons gpt-inject-step-actions">
              <button
                className="primary-button"
                disabled={disabled || busy !== "" || !targets.length}
                onClick={generate}
                type="button"
              >
                <BusyIcon busy={busy === "preview"} icon={Sparkles} />
                <span>{busy === "preview" ? "Menyusun..." : "Generate kode"}</span>
              </button>
            </div>
          </fieldset>
        </div>

        <div className="gpt-inject-output">
          {!preview && busy !== "preview" && (
            <EmptyMessage>
              Pilih subdomain, slot, dan ukuran, lalu tekan Generate kode — kode tiap subdomain,
              masing-masing dengan div id sendiri, muncul di sini.
            </EmptyMessage>
          )}

          {busy === "preview" && !preview && (
            <p aria-live="polite" className="gpt-loading">
              <Loader2 className="icon-spin" size={15} />
              <span>Menyusun kode di server kontrol...</span>
            </p>
          )}

          {preview && (
            <div className={busy === "preview" ? "gpt-preview is-busy" : "gpt-preview"}>
              {stale && (
                <p className="plugin-alert">
                  <TriangleAlert size={15} />
                  <span>
                    Pilihan sudah berubah sejak kode ini disusun. Tekan Generate kode lagi sebelum
                    meng-inject.
                  </span>
                </p>
              )}
              <PreviewList sites={preview.sites} />
            </div>
          )}
        </div>
      </div>

      <div className="plugin-actions gpt-inject-footer">
        <span className="muted-line">
          {targets.length
            ? `${targets.length} subdomain di ${Object.keys(units).length} network akan ditulis.`
            : "Pilih subdomain yang punya akun GAM dan unit iklan dulu."}
        </span>
        <div className="plugin-actions-buttons">
          <button
            className="ghost-button"
            disabled={!ready}
            onClick={() => run(true)}
            title="Membaca header dan kode iklan tiap situs lalu melaporkan apa yang akan diganti — tanpa menulis apa pun."
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
        <ConfirmInject
          busy={busy === "inject"}
          networks={networks}
          onCancel={() => setConfirming(false)}
          onConfirm={() => run(false)}
          options={options}
          targets={targets}
          units={units}
        />
      )}

      {results && <InjectResults onClose={() => setResults(null)} {...results} />}
    </section>
  );
}

/**
 * Pemilih subdomain — react-select multi, perilaku bawaannya apa adanya: subdomain yang sudah
 * dipilih pindah jadi chip di kotaknya dan hilang dari daftar, jadi daftar yang tersisa selalu yang
 * belum dipilih.
 *
 * Bukan daftar checkbox yang selalu terbuka (armada ini ratusan subdomain, dan daftar setinggi itu
 * mendorong kartu network keluar layar), bukan pula `<select multiple>` bawaan browser yang menuntut
 * Ctrl/Cmd+klik.
 *
 * Lewat `SelectField`, pembungkus react-select bersama — rupanya dari src/styles.css lewat token tema.
 */
export function SiteSelect({ enrolled, selected, onChange, disabled, loading }) {
  const options = useMemo(
    () => enrolled.map((row) => ({ value: row.id, label: row.name })),
    [enrolled],
  );

  return (
    <SelectField
      disabled={disabled}
      isMulti
      // Spinner bawaan react-select di kotaknya sendiri selama akun GAM subdomain terpilih dibaca —
      // tepat di tempat yang baru saja diklik orang. Pilihan tetap bisa diubah selama itu.
      loading={loading}
      noOptionsMessage="Tidak ada subdomain yang cocok."
      onChange={(ids) => onChange(new Set(ids))}
      options={options}
      placeholder="Pilih subdomain..."
      searchable
      value={[...selected]}
    />
  );
}

/**
 * Satu network: identitasnya (network code, properti, akun GAM) di atas, slot iklannya di bawah.
 * Subdomain dari dua network dipasangi dua unit berbeda, dan yang dipilih harus terbaca per kartu.
 */
function NetworkCard({ network, members, selectedUnit, onPick, disabled }) {
  return (
    <div className="gpt-network">
      <dl className="gpt-network-meta">
        <div>
          <dt>Network Code</dt>
          <dd>{network.networkCode}</dd>
        </div>
        <div>
          <dt>Properti</dt>
          <dd>{network.publisherId || "-"}</dd>
        </div>
        <div>
          <dt>Akun GAM</dt>
          <dd>{network.accountName}</dd>
        </div>
        <div>
          <dt>Subdomain</dt>
          <dd>{members.length}</dd>
        </div>
      </dl>
      {network.error ? (
        <p className="plugin-alert plugin-alert-inline">
          <TriangleAlert size={15} />
          <span>{network.error}</span>
        </p>
      ) : network.units.length === 0 ? (
        <p className="muted-line">Network ini tidak punya unit iklan display yang aktif.</p>
      ) : (
        <div className="plugin-radio-group" role="radiogroup">
          <small className="muted-line">
            {network.units.length} slot iklan tersedia di network ini
          </small>
          {network.units.map((unit) => (
            <label className="plugin-radio" key={unit.adUnitCode}>
              <input
                checked={selectedUnit === unit.adUnitCode}
                disabled={disabled}
                name={`gpt-unit-${network.networkCode}`}
                onChange={() => onPick(unit.adUnitCode)}
                type="radio"
              />
              <span>
                <strong>{unit.displayName}</strong>
                <small className="muted-line">
                  {unit.path}
                  {unit.sizes ? ` · ${sizeTokens(unit.sizes).length} ukuran` : ""}
                </small>
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Pratinjau per subdomain — satu baris ringkas tiap situs, kodenya di balik collapse.
 *
 * Tiap subdomain punya div id sendiri, jadi yang harus terbaca SEKILAS adalah pembedanya: nama situs,
 * unit iklan, dan `div-gpt-ad-{stempel}`. Kode lengkapnya (header + body 1…N) cuma dibuka untuk yang
 * dicari — digambar semua, tiga puluh situs × enam blok kode adalah dinding yang tidak dibaca siapa
 * pun. Yang pertama terbuka supaya bentuk kodenya langsung terlihat.
 */
function PreviewList({ sites }) {
  const [open, setOpen] = useState(() => new Set(sites[0] ? [sites[0].subdomainId] : []));
  const ok = sites.filter((site) => !site.error);
  const failed = sites.length - ok.length;
  const networkCount = new Set(ok.map((site) => site.networkCode)).size;
  const slots = ok[0]?.bodies?.length || 0;
  const allOpen = ok.length > 0 && ok.every((site) => open.has(site.subdomainId));

  const toggle = (id) =>
    setOpen((current) => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  return (
    <div className="gpt-preview-list">
      <div className="gpt-preview-summary">
        <span>
          <strong>{ok.length} subdomain</strong>
          <small className="muted-line">
            {" "}
            · {networkCount} network · {slots} slot · div id unik per subdomain
            {failed ? ` · ${failed} gagal` : ""}
          </small>
        </span>
        {ok.length > 1 && (
          <button
            className="ghost-button gpt-preview-all"
            onClick={() =>
              setOpen(allOpen ? new Set() : new Set(ok.map((site) => site.subdomainId)))
            }
            type="button"
          >
            {allOpen ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />}
            <span>{allOpen ? "Tutup semua" : "Buka semua"}</span>
          </button>
        )}
      </div>

      {sites.map((site) => {
        if (site.error) {
          return (
            <div className="gpt-preview-item is-error" key={site.subdomainId}>
              <p className="plugin-alert plugin-alert-inline">
                <TriangleAlert size={15} />
                <span>
                  {site.name || site.subdomainId}: {site.error}
                </span>
              </p>
            </div>
          );
        }
        const expanded = open.has(site.subdomainId);
        const lastSlot = site.bodies.length - 1;
        return (
          <div
            className={expanded ? "gpt-preview-item is-open" : "gpt-preview-item"}
            key={site.subdomainId}
          >
            <button
              aria-expanded={expanded}
              className="gpt-preview-toggle"
              onClick={() => toggle(site.subdomainId)}
              type="button"
            >
              <ChevronDown className="gpt-preview-chevron" size={15} />
              <span className="gpt-preview-name">{site.name}</span>
              <code className="gpt-preview-div">
                div-gpt-ad-{site.divStamp}-0{lastSlot > 0 ? `…${lastSlot}` : ""}
              </code>
              <small className="muted-line gpt-preview-unit">{site.adUnitPath}</small>
            </button>
            {expanded && (
              <div className="gpt-preview-body">
                <CodeBlock
                  code={site.header}
                  note="→ Header & Footer → Header code"
                  title="Header"
                />
                {site.bodies.map((body, index) => (
                  <CodeBlock
                    code={body}
                    key={body}
                    note={`→ Iklan → Kode iklan ${index + 1}`}
                    title={`Body ${index + 1}`}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// "Tersalin" sebentar lalu kembali, sepola tombol salin Campaign URL — toast untuk tindakan sekecil
// ini menumpuk di layar orang yang menyalin empat blok berturut-turut. Yang GAGAL tetap bersuara.
function CodeBlock({ title, note, code }) {
  return (
    <div className="gpt-code">
      <div className="gpt-code-head">
        <span>
          <strong>{title}</strong>
          <small className="muted-line"> {note}</small>
        </span>
        <CopyButton label={`Salin ${title}`} text={code} />
      </div>
      <pre>{code}</pre>
    </div>
  );
}

/**
 * Konfirmasi sebelum menulis. Menyebut apa yang BERUBAH di tiap situs, bukan cuma jumlahnya — ini
 * satu-satunya layar antara satu tombol dan kode iklan seluruh pilihan.
 */
function ConfirmInject({ options, networks, units, targets, busy, onCancel, onConfirm }) {
  return (
    <Dialog
      className="confirm-dialog plugin-dialog"
      busy={busy}
      onClose={onCancel}
      subtitle={<>{targets.length} situs terpilih.</>}
      title="Inject kode Ad Manager"
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
        {networks
          .filter((network) => units[network.networkCode])
          .map((network) => (
            <li key={network.networkCode}>
              <span>Unit {network.accountName}</span>
              <code>
                {network.units.find((unit) => unit.adUnitCode === units[network.networkCode])?.path}
              </code>
            </li>
          ))}
        <li>
          <span>Header code</span>
          <code>blok GPT diganti — {options.slots} slot</code>
        </li>
        <li>
          <span>Kode iklan 1–{options.slots}</span>
          <code>ditimpa body baru</code>
        </li>
        <li>
          <span>Kode iklan sesudahnya</span>
          <code>dikosongkan hanya kalau isinya GPT lama</code>
        </li>
        <li>
          <span>Div id</span>
          <code>unik per subdomain, sesuai pratinjau</code>
        </li>
        <li>
          <span>Jumlah slot iklan</span>
          <code>{options.slots}</code>
        </li>
        <li>
          <span>Ukuran</span>
          <code>{sizeTokens(options.sizes).join(", ")}</code>
        </li>
      </ul>

      <div className="plugin-target-list">
        {targets.map((row) => (
          <div className="plugin-target-row" key={row.subdomainId}>
            <span>{row.name}</span>
            <span className="muted-line">{row.networkCode}</span>
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
            {busy ? `Menulis ke ${targets.length} situs...` : `Inject ke ${targets.length} situs`}
          </span>
        </button>
      </div>
    </Dialog>
  );
}

/**
 * Hasil per situs — untuk pemeriksaan maupun inject, dengan kolom yang sama.
 *
 * Kolom Header menyebut CARA blok GPT digabung, karena itu yang menentukan apakah ada kode orang
 * lain yang ikut hilang: "Tag tempelan diganti" berarti script lama yang memuat defineSlot dibuang
 * utuh, dan potongannya disebut di Keterangan.
 */
function InjectResults({ title, dryRun, results, summary, onClose }) {
  const resultColumns = [
    ...resultStatusColumns(dryRun),
    {
      id: "headerMode",
      header: "Header",
      cell: ({ row }) => {
        const mode = row.original.detail ? headerModeLabel(row.original.detail.headerMode) : null;
        return mode ? <span className={`badge ${mode.tone}`}>{mode.label}</span> : "-";
      },
    },
    {
      id: "note",
      header: "Keterangan",
      cell: ({ row }) => <ResultNote row={row.original} />,
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

/**
 * Kolom Situs + Hasil, dipakai bersama tabel hasil tab AdSense. Hasil pemeriksaan (`dryRun`)
 * berbunyi "Siap" untuk situs yang terbaca — belum ada yang ditulis, jadi "Berhasil" berbohong.
 */
export function resultStatusColumns(dryRun) {
  const statusOf = (row) => (dryRun && row.status !== "failed" ? "ok" : row.status);
  const labelOf = (row) => {
    const status = statusOf(row);
    return dryRun && status === "ok" ? "Siap" : bulkLabel(status);
  };

  return [
    {
      id: "name",
      header: "Situs",
      accessorFn: (row) => row.name || row.subdomainId,
      cell: ({ getValue }) => getValue(),
    },
    {
      id: "status",
      header: "Hasil",
      accessorFn: labelOf,
      cell: ({ row }) => (
        <span className={`badge ${bulkTone(statusOf(row.original))}`}>{labelOf(row.original)}</span>
      ),
    },
  ];
}

function ResultNote({ row }) {
  if (row.error) return row.error;
  const detail = row.detail || {};
  const lines = [];
  if (detail.adUnitPath) lines.push(`Unit: ${detail.adUnitPath}`);
  if (detail.divPrefix) lines.push(`Div id: ${detail.divPrefix}-…`);
  if (row.unapplied?.length) lines.push(`Ditolak diam-diam: ${row.unapplied.join(", ")}`);
  if (detail.removed?.length) lines.push(`Dibuang: ${detail.removed.join(" | ")}`);
  if (detail.cleared?.length) lines.push(`Dikosongkan: ${detail.cleared.join(", ")}`);
  if (detail.previousSlotCount !== undefined && detail.previousSlotCount !== "") {
    lines.push(`Jumlah slot sebelumnya: ${detail.previousSlotCount}`);
  }
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
