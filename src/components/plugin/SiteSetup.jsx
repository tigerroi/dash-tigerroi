import { KeyRound, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { readStoredAiKey, writeStoredAiKey } from "../../lib/autopost";
import {
  createKeitaroCampaign,
  fetchPluginDeployment,
  fetchPluginLegalPages,
  fetchPluginLicense,
  runPluginDeployment,
  runPluginLegalPages,
  runPluginMenus,
  savePluginLicense,
} from "../../lib/controlApi";
import { formatDateTime } from "../../lib/formatDate";
import { notifyError, notifySuccess, notifyWarning } from "../../lib/notify";
import { BusyIcon } from "../ui/BusyIcon";
import { CopyButton } from "../ui/CopyButton";
import { Dialog } from "../ui/Dialog";
import { RefreshButton } from "../ui/RefreshButton";
import { RowCheckbox } from "../ui/RowCheckbox";
import { Switch } from "../ui/Switch";

// Sama dengan DEPLOYMENT_TASKS / LEGAL_PAGES di functions/plugin-core.js; server menolak sisanya.
// Dipakai juga tab Setup Sub, yang menjalankan keduanya sesudah enroll.
export const TASKS = [
  { id: "trash", label: "Trash konten", help: "Pindahkan SEMUA Posts & Pages ke Trash" },
  { id: "permalink", label: "Permalink", help: "Set ke /%postname%/" },
  {
    id: "plugins",
    label: "Plugin",
    help: "HAPUS semua plugin lain, pasang W3TC + Easy TOC + Redis",
  },
  { id: "theme", label: "Tema", help: "Pasang & aktifkan Jannah + opsinya" },
  { id: "dropin", label: "Drop-in cache", help: "Pasang ulang object-cache.php saja" },
];
/**
 * Task yang dicentang bawaan: hanya yang dilaporkan situs masih pending, dengan dua pengaman.
 *
 * - `plugins` pending karena drop-in-nya saja yang hilang → `dropin`. Menjalankan `plugins` di
 *   situ MENGHAPUS seluruh plugin situs demi menyalin satu file (peringatan dokumen API-nya).
 * - `trash` hanya dicentang kalau isinya sebanyak WordPress yang baru dipasang. care.petcins.com
 *   (situs hidup) melaporkan "25 item belum di-trash" — dicentang bawaan, satu klik membuang
 *   seluruh artikelnya.
 */
// ponytail: ambang 3 = "Hello world" + "Sample Page" + satu cadangan; situs baru yang diisi lebih
// dulu harus dicentang tangan.
const FRESH_ITEMS = 3;
export function defaultDeploymentTasks(status) {
  const tasks = status?.tasks || {};
  const plugins = tasks.plugins || {};
  return (status?.pending || [])
    .map((task) =>
      task === "plugins" && plugins.w3tc && plugins.eztoc && plugins.redis && !plugins.dropin
        ? "dropin"
        : task,
    )
    .filter((task) => task !== "trash" || Number(tasks.trash?.count) <= FRESH_ITEMS);
}

export const PAGES = [
  "Privacy Policy",
  "Disclaimer",
  "Terms & Conditions",
  "Contact Us",
  "About Us",
];

const STATE = {
  running: ["Berjalan", "info"],
  done: ["Selesai", "success"],
  partial: ["Sebagian", "warning"],
  failed: ["Gagal", "danger"],
};

/**
 * Tab "Setup Situs" — onboarding host baru lewat Management API plugin, urutan yang dianjurkan
 * dokumennya: lisensi → Setting Sub (Deployment Tools) → halaman legal.
 *
 * Setting Sub dan halaman legal berjalan DI LATAR di server kontrol (bisa beberapa menit, lebih lama
 * dari batas tunggu nginx); hasilnya dibaca dari `subDomains/{id}/siteTasks`, yang sudah dilanggan.
 */
export function SiteSetup({ row, tasks, canManage }) {
  return (
    <div aria-labelledby="plugin-tab-setup" id="plugin-panel-setup" role="tabpanel">
      <LicenseSection canManage={canManage} row={row} />
      <DeploymentSection canManage={canManage} row={row} task={tasks?.deployment} />
      <LegalSection canManage={canManage} row={row} task={tasks?.legal} />
      <MenuSection canManage={canManage} row={row} task={tasks?.menus} />
    </div>
  );
}

function useSiteRead(read, id) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      setData(await read(id));
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setBusy(false);
    }
  }, [read, id]);
  useEffect(() => {
    load();
  }, [load]);
  return { data, error, busy, load };
}

function Alert({ children }) {
  return (
    <p className="plugin-alert">
      <TriangleAlert size={15} />
      <span>{children}</span>
    </p>
  );
}

function TaskStatus({ task }) {
  if (!task?.state) return null;
  const [label, tone] = STATE[task.state] || ["-", "neutral"];
  return (
    <p className="muted-line">
      <span className={`badge ${tone}`}>{label}</span> {task.detail || ""}{" "}
      {task.updatedAt && `(${formatDateTime(task.updatedAt)}${task.by ? `, ${task.by}` : ""})`}
    </p>
  );
}

function LicenseSection({ row, canManage }) {
  const { data, error, busy, load } = useSiteRead(fetchPluginLicense, row.id);
  const [licenseKey, setLicenseKey] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const result = await savePluginLicense(row.id, licenseKey.trim());
      if (result.active) notifySuccess(result.message || `Lisensi ${row.name} aktif.`);
      else
        notifyWarning(
          result.message || `Lisensi tersimpan tapi statusnya ${result.license_status}.`,
        );
      setLicenseKey("");
      load();
    } catch (saveError) {
      notifyError(saveError, `Lisensi ${row.name} gagal dipasang.`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <fieldset className="plugin-fieldset">
      <legend>Lisensi</legend>
      <div className="plugin-actions">
        <span className="muted-line">
          {busy
            ? "Membaca lisensi..."
            : data
              ? data.license_set
                ? `${data.license_key} — ${data.active ? "aktif" : data.license_status || "tidak aktif"}${data.expiry_date ? `, s/d ${data.expiry_date}` : ""}`
                : "Belum ada license key di situs ini."
              : ""}
        </span>
        <RefreshButton busy={busy} onClick={load} />
      </div>
      {error && <Alert>{error}</Alert>}
      {canManage && (
        <div className="plugin-actions">
          <input
            aria-label="License key"
            className="control"
            onChange={(event) => setLicenseKey(event.target.value)}
            placeholder="RBT0-XXXX-XXXX-XXXX"
            value={licenseKey}
          />
          <button
            className="primary-button"
            disabled={!licenseKey.trim() || saving}
            onClick={save}
            type="button"
          >
            <BusyIcon busy={saving} icon={KeyRound} size={15} />
            <span>Pasang lisensi</span>
          </button>
        </div>
      )}
    </fieldset>
  );
}

function DeploymentSection({ row, task, canManage }) {
  const { data, error, busy, load } = useSiteRead(fetchPluginDeployment, row.id);
  // null = belum disentuh orang → ikut status situs (`defaultDeploymentTasks`).
  const [touched, setPicked] = useState(null);
  const picked = touched ?? defaultDeploymentTasks(data);
  const [confirming, setConfirming] = useState(false);
  const [starting, setStarting] = useState(false);
  const running = task?.state === "running";

  // Selesai berjalan → baca ulang statusnya dari situs.
  useEffect(() => {
    if (task?.state && task.state !== "running") load();
  }, [task?.state, load]);

  const start = async () => {
    setStarting(true);
    try {
      await runPluginDeployment(row.id, picked);
      notifySuccess(`Setting Sub ${row.name} dimulai. Bisa beberapa menit.`);
      setConfirming(false);
    } catch (runError) {
      notifyError(runError, `Setting Sub ${row.name} gagal dimulai.`);
    } finally {
      setStarting(false);
    }
  };

  const toggle = (id) =>
    setPicked(picked.includes(id) ? picked.filter((item) => item !== id) : [...picked, id]);

  return (
    <fieldset className="plugin-fieldset">
      <legend>Setting Sub</legend>
      <div className="plugin-actions">
        <span className="muted-line">
          {busy
            ? "Membaca status..."
            : data
              ? `${data.done}/${data.total} selesai${data.pending?.length ? ` — belum: ${data.pending.join(", ")}` : ""}. Object cache ${data.object_cache ? "aktif" : "tidak aktif"}.`
              : ""}
        </span>
        <RefreshButton busy={busy} onClick={load} />
      </div>
      {error && <Alert>{error}</Alert>}
      <TaskStatus task={task} />
      {task?.results?.length > 0 && (
        <ul className="plugin-diff-list">
          {task.results.map((result) => (
            <li key={result.task}>
              <span className={`badge ${result.ok ? "success" : "danger"}`}>
                {result.ok ? "OK" : "Gagal"}
              </span>{" "}
              {result.label}: {result.details}
            </li>
          ))}
        </ul>
      )}
      {data?.tasks && (
        <ul className="plugin-diff-list">
          {Object.entries(data.tasks).map(([id, item]) => (
            <li key={id}>
              <span className={`badge ${item.ok ? "success" : "neutral"}`}>
                {item.ok ? "Siap" : "Belum"}
              </span>{" "}
              {id}: {item.info}
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        <div className="plugin-actions">
          <div className="plugin-actions-buttons">
            {TASKS.map((item) => (
              // biome-ignore lint/a11y/noLabelWithoutControl: RowCheckbox merender <input> di dalam label ini.
              <label className="checkbox-option" key={item.id} title={item.help}>
                <RowCheckbox
                  checked={picked.includes(item.id)}
                  label={item.label}
                  onChange={() => toggle(item.id)}
                />
                {item.label}
              </label>
            ))}
          </div>
          <button
            className="danger-button"
            disabled={!picked.length || running}
            onClick={() => setConfirming(true)}
            type="button"
          >
            {running ? "Berjalan..." : "Jalankan"}
          </button>
        </div>
      )}
      {confirming && (
        <Dialog
          busy={starting}
          className="confirm-dialog plugin-dialog"
          onClose={() => setConfirming(false)}
          subtitle={row.name}
          title="Jalankan Setting Sub?"
        >
          <Alert>
            Hanya untuk host yang BARU dipasang. Tidak ada backup dan tidak bisa dibatalkan.
          </Alert>
          <ul className="plugin-diff-list">
            {TASKS.filter((item) => picked.includes(item.id)).map((item) => (
              <li key={item.id}>
                <strong>{item.label}</strong> — {item.help}
                {item.id === "trash" && data?.tasks?.trash?.count > 0 && (
                  <strong> ({data.tasks.trash.count} item)</strong>
                )}
              </li>
            ))}
          </ul>
          <div className="confirm-actions">
            <button className="ghost-button" onClick={() => setConfirming(false)} type="button">
              Batal
            </button>
            <button className="danger-button" disabled={starting} onClick={start} type="button">
              {starting ? "Memulai..." : "Ya, jalankan"}
            </button>
          </div>
        </Dialog>
      )}
    </fieldset>
  );
}

function LegalSection({ row, task, canManage }) {
  const { data, error, busy, load } = useSiteRead(fetchPluginLegalPages, row.id);
  const [aiKey, setAiKey] = useState(() => readStoredAiKey("legal"));
  const [remember, setRemember] = useState(() => Boolean(readStoredAiKey("legal")));
  const [picked, setPicked] = useState(null);
  const [starting, setStarting] = useState(false);
  const running = task?.state === "running";
  // Bawaannya halaman yang BELUM ada; yang sudah terbit dilewati situs juga.
  const selected = picked ?? data?.missing ?? PAGES;

  useEffect(() => {
    if (task?.state && task.state !== "running") load();
  }, [task?.state, load]);

  const start = async () => {
    setStarting(true);
    try {
      writeStoredAiKey(remember ? aiKey : "", "legal");
      await runPluginLegalPages(row.id, aiKey.trim(), selected);
      notifySuccess(`Halaman legal ${row.name} sedang dibuat. Bisa beberapa menit.`);
    } catch (runError) {
      notifyError(runError, `Halaman legal ${row.name} gagal dimulai.`);
    } finally {
      setStarting(false);
    }
  };

  const toggle = (title) =>
    setPicked(
      selected.includes(title) ? selected.filter((item) => item !== title) : [...selected, title],
    );

  return (
    <fieldset className="plugin-fieldset">
      <legend>Halaman Legal (Privacy Policy)</legend>
      <div className="plugin-actions">
        <span className="muted-line">
          {busy
            ? "Membaca halaman..."
            : data
              ? data.complete
                ? "Kelima halaman legal sudah terbit."
                : `Belum ada: ${data.missing.join(", ")}.`
              : ""}
        </span>
        <RefreshButton busy={busy} onClick={load} />
      </div>
      {error && <Alert>{error}</Alert>}
      <TaskStatus task={task} />
      {data?.pages && (
        <ul className="plugin-diff-list">
          {data.pages.map((page) => (
            <li key={page.title}>
              <span className={`badge ${page.exists ? "success" : "neutral"}`}>
                {page.exists ? "Terbit" : "Belum"}
              </span>{" "}
              {page.url ? (
                <a href={page.url} rel="noreferrer noopener" target="_blank">
                  {page.title}
                </a>
              ) : (
                page.title
              )}
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        <>
          <div className="plugin-actions">
            <div className="plugin-actions-buttons">
              {PAGES.map((title) => (
                // biome-ignore lint/a11y/noLabelWithoutControl: RowCheckbox merender <input> di dalam label ini.
                <label className="checkbox-option" key={title}>
                  <RowCheckbox
                    checked={selected.includes(title)}
                    label={title}
                    onChange={() => toggle(title)}
                  />
                  {title}
                </label>
              ))}
            </div>
          </div>
          <div className="plugin-actions">
            <input
              aria-label="Kunci AI"
              autoComplete="off"
              className="control"
              onChange={(event) => setAiKey(event.target.value)}
              placeholder="Kunci AI (Gemini, OpenAI, Claude, Groq, Qwen)"
              type="password"
              value={aiKey}
            />
            <Switch
              checked={remember}
              className="plugin-remember"
              hint="Disimpan di perangkat ini saja — tidak pernah masuk database dashboard maupun alamat halaman."
              label="Ingat di browser ini"
              onChange={setRemember}
            />
            <button
              className="primary-button"
              disabled={aiKey.trim().length < 16 || !selected.length || running || starting}
              onClick={start}
              type="button"
            >
              {running ? "Berjalan..." : "Buat halaman"}
            </button>
          </div>
        </>
      )}
    </fieldset>
  );
}

/**
 * Menu Main Nav (Home + 5 kategori terbanyak) dan Footer (Home + seluruh Page publish).
 *
 * `ok: true` dari task-nya TIDAK berarti menunya jadi — konten kosong tetap sukses dengan menu
 * berisi Home saja. Yang menandai jadi-tidaknya `menus.ok` dari GET /manage/deployment, dan itu yang
 * digambar di sini, berikut peringatan kalau halaman legal / artikel belum ada.
 */
function MenuSection({ row, task, canManage }) {
  const { data, error, busy, load } = useSiteRead(fetchPluginDeployment, row.id);
  const [starting, setStarting] = useState(false);
  const running = task?.state === "running";
  const menus = data?.menus;

  useEffect(() => {
    if (task?.state && task.state !== "running") load();
  }, [task?.state, load]);

  const start = async () => {
    setStarting(true);
    try {
      await runPluginMenus(row.id);
      notifySuccess(`Menu ${row.name} sedang disusun.`);
    } catch (runError) {
      notifyError(runError, `Menu ${row.name} gagal dimulai.`);
    } finally {
      setStarting(false);
    }
  };

  const line = (label, menu) =>
    menu && (
      <li key={label}>
        <span className={`badge ${menu.exists && menu.assigned ? "success" : "neutral"}`}>
          {menu.exists ? (menu.assigned ? "Terpasang" : "Belum dipasang") : "Belum dibuat"}
        </span>{" "}
        {label} "{menu.menu}": {menu.items} item
        {menu.location ? ` → ${menu.location}` : ""}
      </li>
    );

  return (
    <fieldset className="plugin-fieldset">
      <legend>Menu</legend>
      <div className="plugin-actions">
        <span className="muted-line">
          {busy
            ? "Membaca menu..."
            : menus
              ? menus.ok
                ? "Menu header dan footer terpasang."
                : menus.info || "Menu belum lengkap."
              : data
                ? "Plugin situs ini belum mengenal task menus — perbarui plugin-nya."
                : ""}
        </span>
        <RefreshButton busy={busy} onClick={load} />
      </div>
      {error && <Alert>{error}</Alert>}
      <TaskStatus task={task} />
      {task?.results?.[0]?.details && <p className="muted-line">{task.results[0].details}</p>}
      {menus && (
        <ul className="plugin-diff-list">
          {line("Header", menus.header)}
          {line("Footer", menus.footer)}
        </ul>
      )}
      {canManage && (
        <div className="plugin-actions">
          <span className="muted-line">Jalankan sesudah halaman legal & artikel terbit.</span>
          <button
            className="primary-button"
            disabled={running || starting}
            onClick={start}
            type="button"
          >
            {running ? "Berjalan..." : "Susun menu"}
          </button>
        </div>
      )}
    </fieldset>
  );
}

/** Tautan landing + parameternya, masing-masing bisa disalin. */
export function LandingLinkDialog({ link, onClose, subdomainId }) {
  const [prefix, setPrefix] = useState("");
  const [busy, setBusy] = useState(false);
  const [keitaro, setKeitaro] = useState(null);

  const createInKeitaro = async () => {
    setBusy(true);
    try {
      const result = await createKeitaroCampaign(subdomainId, link.link, prefix);
      setKeitaro(result);
      const gated = result.gate?.status === "ok";
      (gated ? notifySuccess : notifyWarning)(
        `Campaign ${result.campaign.name} dibuat${gated ? " dan di-gate." : `, gate: ${result.gate?.status || "dilewati"}.`}`,
      );
    } catch (error) {
      notifyError(error, "Campaign Keitaro gagal dibuat.");
    } finally {
      setBusy(false);
    }
  };

  const rows = [
    ["Tautan lengkap", link.link],
    ["URL", link.url],
    ["Parameter", link.parameterKey ? `${link.parameterKey}=${link.parameterValue}` : ""],
    ["Kunci parameter", link.parameterKey],
    ["Nilai parameter", link.parameterValue],
    ["URL cloaking", link.cloakingUrl],
    ["Jeda video (detik)", link.videoPause],
  ].filter(([, value]) => value);

  return (
    <Dialog
      className="confirm-dialog plugin-dialog"
      onClose={onClose}
      subtitle={`Landing #${link.id} — ${link.slug}`}
      title="Tautan landing"
    >
      {link.presetError && (
        <p className="plugin-alert">
          <TriangleAlert size={15} />
          <span>Landing lahir, tapi setelan preset gagal ditulis: {link.presetError}</span>
        </p>
      )}
      <ul className="plugin-diff-list">
        {rows.map(([label, value]) => (
          <li key={label}>
            <strong>{label}</strong>: <code>{value}</code>{" "}
            <CopyButton label={`Salin ${label}`} text={value} />
          </li>
        ))}
      </ul>
      {subdomainId && link.link && (
        <div className="plugin-actions">
          <input
            aria-label="Awalan nama campaign"
            className="control"
            disabled={busy || keitaro}
            onChange={(event) => setPrefix(event.target.value)}
            placeholder="Awalan nama (kosong = PIC T2 (WL))"
            value={prefix}
          />
          <button
            className="primary-button"
            disabled={busy || keitaro}
            onClick={createInKeitaro}
            type="button"
          >
            {busy ? "Membuat..." : "Buat campaign Keitaro + gate"}
          </button>
        </div>
      )}
      {keitaro && (
        <ul className="plugin-diff-list">
          <li>
            <strong>Campaign</strong>: <code>{keitaro.campaign.name}</code> (#{keitaro.campaign.id})
          </li>
          <li>
            <strong>Landing</strong>: #{keitaro.landing.id}
            {keitaro.landing.reused ? " (sudah ada, dipakai ulang)" : ""}
          </li>
          <li>
            <strong>Gate</strong>: {keitaro.gate?.status || "dilewati"}
            {keitaro.gate?.error ? ` — ${keitaro.gate.error}` : ""}
          </li>
        </ul>
      )}
      <div className="confirm-actions">
        <button className="primary-button" onClick={onClose} type="button">
          Tutup
        </button>
      </div>
    </Dialog>
  );
}
