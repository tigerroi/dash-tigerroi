import { Server, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useUrlState } from "../hooks/useUrlState";
import { ADSENSE_MAX_SLOTS, filledCodes } from "../lib/adsenseInject";
import {
  AUTOPOST_BASE_MAX,
  AUTOPOST_MAX_KEYWORDS,
  readStoredAiKey,
  writeStoredAiKey,
} from "../lib/autopost";
import { navigateTo } from "../lib/browserLocation";
import { hostOf } from "../lib/cloudflareDns";
import { CONTROL_API_ENABLED, fetchPluginSchema, setupSubMany } from "../lib/controlApi";
import { formatDateTime } from "../lib/formatDate";
import { BUILT_IN_GPT_TEMPLATES } from "../lib/gptInject";
import { notifyError, notifySuccess, notifyWarning } from "../lib/notify";
import { isSetupWarning, setupDetailLines } from "../lib/setupSub";
import { PluginGroupFields } from "./plugin/PluginGroupFields";
import { PAGES, TASKS } from "./plugin/SiteSetup";
import { BusyIcon } from "./ui/BusyIcon";
import { DataTable } from "./ui/DataTable";
import { Dialog } from "./ui/Dialog";
import { EmptyMessage } from "./ui/EmptyMessage";
import { PageHeader } from "./ui/PageHeader";
import { RowCheckbox } from "./ui/RowCheckbox";
import { SelectField, toSelectOptions } from "./ui/SelectField";
import { Switch } from "./ui/Switch";

const STATE = {
  queued: ["Antre", "neutral"],
  running: ["Berjalan", "info"],
  done: ["Selesai", "success"],
  partial: ["Sebagian", "warning"],
  failed: ["Gagal", "danger"],
};

const STEP = {
  queued: "Menunggu",
  dns: "DNS Cloudflare",
  install: "Site + WordPress + SSL",
  ssl: "SSL",
  plugin: "Enroll plugin",
  "server-wait": "Menunggu server",
  license: "Lisensi",
  behaviour: "Behaviour",
  cmp: "CMP",
  "header-footer": "Header & Footer",
  security: "Keamanan",
  deployment: "Setting Sub",
  legal: "Halaman legal",
  autopost: "AutoPost",
  "autopost-wait": "Menunggu artikel",
  menus: "Menu",
  adcode: "Kode iklan",
  landing: "Landing page",
  keitaro: "Campaign Keitaro",
  done: "-",
};

// Bawaan Setting Sub untuk host BARU. `dropin` tidak dicentang (sepola "all" di plugin); `menus` bukan
// task di sini melainkan langkah terakhir tersendiri, sesudah AutoPost.
const DEFAULT_TASKS = ["trash", "permalink", "plugins", "theme"];

// Pilihan bahasa kata kunci. Field-nya teks bebas di plugin (diteruskan apa adanya ke AI); daftar ini
// cuma yang ditawarkan — bahasa lain ditambahkan di sini.
const KEYWORD_LANGUAGES = [
  "English",
  "Indonesian",
  "Spanish",
  "Portuguese",
  "French",
  "German",
  "Italian",
  "Dutch",
  "Arabic",
  "Turkish",
  "Urdu",
  "Hindi",
  "Bengali",
  "Vietnamese",
  "Thai",
  "Malay",
  "Filipino",
  "Japanese",
  "Korean",
  "Chinese",
  "Russian",
  "Polish",
];
const LANGUAGE_OPTIONS = toSelectOptions(KEYWORD_LANGUAGES);
const NEW_POST = { base: "", total: 20, bahasa: "English" };

/**
 * Grup pengaturan yang SAMA untuk seluruh sub satu domain dan memang diketik manual (di luar lisensi).
 * `ads-settings` dan `header-footer` sengaja TIDAK ikut: kode iklan + header GPT-nya milik tiap
 * subdomain sendiri (div id berstempel per situs, unit dari Ad Manager), dan dipasang saklar
 * "Kode Iklan" di bawah — penyusun yang sama dengan tab AdX di /plugin. Diketik rata satu domain,
 * tiap sub akan menayangkan tag yang sama.
 *
 * `"adcode"` bukan grup plugin melainkan tempat saklar Kode Iklan digambar di antara grup-grup ini.
 */
const SETUP_GROUPS = ["behaviour", "cmp", "security"];
const DOMAIN_ITEMS = ["behaviour", "cmp", "adcode", "security"];
// Bawaan tab AdX: template "Semua ukuran Ad Manager" + 3 slot; unitnya dipilih server dari Ad Manager.
const AD_CODE = { sizes: BUILT_IN_GPT_TEMPLATES[0].sizes, slots: 3 };

/**
 * Apakah domain sub ini punya akun GAM (→ AdX) atau tidak (→ AdSense, kodenya ditempel). Hanya untuk
 * MENGGAMBAR form: yang memutuskan tetap server (`gamAccountsForSite`), dengan aturan yang sama —
 * domain induk dulu, lalu akhiran hostname.
 */
function hasGamAccount(row, gamAccounts) {
  const accounts = (Array.isArray(gamAccounts) ? gamAccounts : Object.values(gamAccounts || {}))
    .filter((a) => a && !a.deletedAt && a.networkCode && hostOf(a.name))
    .map((a) => hostOf(a.name));
  const parent = hostOf(row.parentDomain);
  const host = hostOf(row.name);
  if (parent && accounts.includes(parent)) return true;
  return accounts.some((name) => host === name || host.endsWith(`.${name}`));
}

/**
 * Tab "Setup Sub" di halaman Domains — pasang subdomain yang sudah terdaftar di /sub-domains ke
 * server CloudPanel: A record Cloudflare, site PHP 8.3 + WordPress, SSL Let's Encrypt, dan plugin
 * RabbitROI yang langsung di-enroll. Lisensi + grup pengaturan (behaviour, CMP, header/footer,
 * keamanan) ikut diterapkan sesudah enroll, jadi sub baru tidak perlu dibuka satu per satu di
 * halaman /plugin.
 *
 * Semuanya SAMA untuk seluruh sub satu domain, jadi kotaknya baru terbuka begitu semua sub terpilih
 * berasal dari SATU domain induk — pilihan yang mencampur dua domain tidak punya satu lisensi/
 * pengaturan yang benar untuk keduanya.
 *
 * SUPERADMIN, sepola DNS Record: yang menegakkannya gerbang di server/setup-sub.js. Kemajuannya
 * dibaca dari baris subdomain itu sendiri (`setup`), jadi menutup tab tidak menghentikan apa pun
 * dan tiap superadmin yang membuka halaman ini melihat keadaan yang sama.
 */
export function SetupSub({ store }) {
  // Beberapa id dipisah koma di alamat (`?sub=a,b`), sepola filter lain di dashboard ini.
  const [subParam, setSubParam] = useUrlState("sub", "", { history: "replace" });
  const siteIds = subParam ? subParam.split(",").filter(Boolean) : [];
  const [starting, setStarting] = useState(false);
  const [licenses, setLicenses] = useState({}); // id sub -> license key (tiap sub punya sendiri)
  const [openGroups, setOpenGroups] = useState({}); // grup pengaturan yang dibuka: nama -> bool
  const [config, setConfig] = useState({}); // nama grup -> { field: value }
  const [schema, setSchema] = useState(null);
  // Langkah situs sesudah enroll: Setting Sub -> halaman legal -> AutoPost -> menu.
  // Bawaannya menyala untuk yang dipakai tiap sub baru; AutoPost tidak, karena kata kuncinya per sub.
  // Setting Sub tetap lewat dialog konfirmasi sebelum berangkat.
  const [siteOn, setSiteOn] = useState({
    adCode: true,
    deployment: true,
    legal: true,
    autopost: true,
    menus: true,
    landing: true,
    keitaro: true,
  });
  const [tasks, setTasks] = useState(DEFAULT_TASKS);
  const [pages, setPages] = useState(PAGES);
  // id sub -> { base, total, bahasa }. Kata kuncinya dibuat AI di situs itu SESUDAH plugin terpasang
  // (generator plugin butuh situsnya hidup), lalu langsung dikirim ke AutoPost.
  const [posts, setPosts] = useState({});
  // id sub -> kotak Kode iklan 1…N (AdSense), hanya untuk sub yang domainnya tanpa akun GAM.
  const [adsense, setAdsense] = useState({});
  // Setelan artikel AutoPost (seluruh field dokumen), sama untuk seluruh sub. Diisi bawaan SAAT
  // skemanya datang — sebelum itu null, dan form kosong yang dikirim berarti `bahasa: ""` ke AI.
  const [articleValues, setArticleValues] = useState(null);
  const [articleOpen, setArticleOpen] = useState(false);
  // Kunci AI per langkah — halaman legal dan AutoPost bisa memakai akun AI yang berbeda.
  const [legalKey, setLegalKey] = useState(() => readStoredAiKey("legal"));
  const [postKey, setPostKey] = useState(() => readStoredAiKey("autopost"));
  const [rememberLegal, setRememberLegal] = useState(() => Boolean(readStoredAiKey("legal")));
  const [rememberPost, setRememberPost] = useState(() => Boolean(readStoredAiKey("autopost")));
  const [confirming, setConfirming] = useState(false);
  const subDomains = store?.subDomains || [];

  // Skema pengaturan dari server (grup yang sama dengan halaman /plugin). Diambil sekali; tanpa
  // server kontrol tab ini memang tidak bisa jalan.
  useEffect(() => {
    if (!CONTROL_API_ENABLED) return;
    fetchPluginSchema()
      .then(setSchema)
      .catch(() => setSchema(null));
  }, []);

  useEffect(() => {
    if (schema?.autopost && !articleValues) setArticleValues({ ...schema.autopost.defaults });
  }, [schema, articleValues]);

  const rows = useMemo(
    () =>
      subDomains
        .filter((row) => row?.setup?.state)
        .sort((a, b) =>
          String(b.setup.updatedAt || "").localeCompare(String(a.setup.updatedAt || "")),
        ),
    [subDomains],
  );

  // Domain induk yang berbeda di antara sub terpilih. Lisensi + pengaturan cuma boleh diisi kalau
  // semuanya satu domain.
  const domains = useMemo(() => {
    const byId = new Map(subDomains.map((row) => [row.id, row]));
    return [...new Set(siteIds.map((id) => byId.get(id)?.parentDomain).filter(Boolean))];
  }, [siteIds, subDomains]);
  const oneDomain = domains.length === 1;

  // Begitu satu sub dipilih, pilihannya menyempit ke domain induk yang sama — lisensi + pengaturan
  // berlaku se-domain, jadi sub domain lain memang tidak boleh ikut di satu antrean ini. Pilihan yang
  // SUDAH campur (alamat lama `?sub=`) tidak disaring, supaya chip-nya tetap tergambar dan bisa dilepas.
  const options = useMemo(
    () =>
      subDomains
        .filter(
          (row) =>
            row?.name &&
            // Yang sudah terpilih selalu ikut: SelectField cuma menggambar chip yang ada di daftar.
            (!oneDomain || row.parentDomain === domains[0] || siteIds.includes(row.id)),
        )
        .sort((a, b) => String(a.name).localeCompare(String(b.name)))
        .map((row) => ({ value: row.id, label: row.name })),
    [subDomains, oneDomain, domains, siteIds],
  );

  // Urutan kotak lisensi = urutan chip yang dipilih.
  const selectedRows = useMemo(() => {
    const byId = new Map(subDomains.map((row) => [row.id, row]));
    return siteIds.map((id) => byId.get(id)).filter(Boolean);
  }, [siteIds, subDomains]);

  // License key yang diketik untuk dua sub atau lebih — hampir pasti salah tempel, dan sub kedua
  // akan gagal aktivasi. Tombol Setup dikunci sampai dibetulkan.
  const duplicateKeys = useMemo(() => {
    const seen = new Map();
    for (const id of siteIds) {
      const key = String(licenses[id] || "").trim();
      if (key) seen.set(key, (seen.get(key) || 0) + 1);
    }
    return [...seen].filter(([, count]) => count > 1).map(([key]) => key);
  }, [siteIds, licenses]);

  const postOf = (id) => ({ ...NEW_POST, ...posts[id] });
  const setPost = (id, patch) =>
    setPosts((current) => ({ ...current, [id]: { ...NEW_POST, ...current[id], ...patch } }));
  const postPayload = (id) => {
    const { base, total, bahasa } = postOf(id);
    return base.trim() ? { base: base.trim(), total, bahasa } : null;
  };
  const postCount = siteOn.autopost ? siteIds.filter((id) => postPayload(id)).length : 0;
  const legalOn = Boolean(siteOn.legal && pages.length);
  const aiMissing =
    (legalOn && legalKey.trim().length < 16) || (postCount > 0 && postKey.trim().length < 16);
  const deploymentOn = Boolean(siteOn.deployment && tasks.length);
  const toggleIn = (setList, value) =>
    setList((list) => (list.includes(value) ? list.filter((x) => x !== value) : [...list, value]));

  const setField = (group, name, value) =>
    setConfig((current) => ({ ...current, [group]: { ...(current[group] || {}), [name]: value } }));

  async function start() {
    setStarting(true);
    try {
      // Hanya grup yang DIBUKA dan benar-benar terisi yang dikirim; controlApi membuang yang kosong.
      const activeConfig = Object.fromEntries(
        SETUP_GROUPS.filter((g) => openGroups[g] && Object.keys(config[g] || {}).length).map(
          (g) => [g, config[g]],
        ),
      );
      // Lisensi per sub berlaku apa pun domainnya; grup pengaturan hanya untuk satu domain.
      const site = {
        ...(deploymentOn ? { deployment: tasks } : {}),
        ...(legalOn ? { legal: true, legalPages: pages, legalAiKey: legalKey.trim() } : {}),
        ...(postCount
          ? {
              autopost: Object.fromEntries(
                siteIds.filter((id) => postPayload(id)).map((id) => [id, postPayload(id)]),
              ),
              autopostAiKey: postKey.trim(),
              ...(articleValues ? { autopostValues: articleValues } : {}),
            }
          : {}),
        ...(siteOn.menus ? { menus: true } : {}),
        ...(siteOn.landing ? { landing: true, ...(siteOn.keitaro ? { keitaro: true } : {}) } : {}),
        // Kode iklan tinggal di Pengaturan domain, yang cuma tergambar untuk sub satu domain.
        ...(oneDomain && siteOn.adCode
          ? {
              adCode: AD_CODE,
              adsenseCodes: Object.fromEntries(
                siteIds
                  .map((id) => [id, filledCodes(adsense[id])])
                  .filter(([, codes]) => codes.length),
              ),
            }
          : {}),
      };
      if (legalOn) writeStoredAiKey(rememberLegal ? legalKey.trim() : "", "legal");
      if (postCount) writeStoredAiKey(rememberPost ? postKey.trim() : "", "autopost");
      const settings = { licenses, config: oneDomain ? activeConfig : null, site };
      const { queued, skipped } = await setupSubMany(siteIds, settings);
      const note = `${queued.length} subdomain masuk antrean (dikerjakan satu per satu).`;
      if (skipped.length) {
        notifyWarning(`${note} Dilewati: ${skipped.map((row) => row.host || row.id).join(", ")}.`);
      } else {
        notifySuccess(note);
      }
      setSubParam("");
      setLicenses({});
      setConfig({});
      setOpenGroups({});
      setPosts({});
      setAdsense({});
      setConfirming(false);
    } catch (error) {
      notifyError(error);
    } finally {
      setStarting(false);
    }
  }

  const header = (
    <PageHeader
      title="Setup Sub"
      description="Pasang subdomain ke server CloudPanel: DNS, WordPress, SSL, plugin RabbitROI, lisensi & pengaturan, lalu Setting Sub, halaman legal, AutoPost, dan menu — sekali klik untuk sub satu domain."
    />
  );

  if (!CONTROL_API_ENABLED) {
    return (
      <div className="page-stack">
        {header}
        <section className="panel">
          <EmptyMessage>
            Server kontrol belum dikonfigurasi (<code>VITE_CONTROL_API_URL</code>), jadi setup tidak
            bisa dijalankan dari sini.
          </EmptyMessage>
        </section>
      </div>
    );
  }

  return (
    <div className="page-stack">
      {header}
      <section className="panel">
        <div className="panel-header">
          <div className="dns-toolbar">
            <SelectField
              ariaLabel="Subdomain"
              className="dns-zone-select"
              isMulti
              onChange={(ids) => setSubParam((ids || []).join(","))}
              options={options}
              placeholder="Pilih subdomain..."
              value={siteIds}
            />
          </div>
          <button
            className="primary-button"
            disabled={!siteIds.length || starting || duplicateKeys.length > 0 || aiMissing}
            // Setting Sub destruktif (trash konten, hapus plugin lain): dikonfirmasi dulu.
            onClick={deploymentOn ? () => setConfirming(true) : start}
            type="button"
          >
            <BusyIcon busy={starting} icon={Server} size={15} />
            <span>{siteIds.length > 1 ? `Setup ${siteIds.length} subdomain` : "Setup"}</span>
          </button>
        </div>

        {siteIds.length > 0 && (
          <fieldset className="plugin-fieldset">
            <legend>Lisensi per subdomain</legend>
            {/* Satu kotak per sub terpilih: tiap situs butuh license key-nya sendiri. Kosong =
                lisensinya dilewati untuk sub itu. */}
            <div className="form-grid">
              {selectedRows.map((row) => (
                <div className="field" key={row.id}>
                  <label htmlFor={`setup-license-${row.id}`}>{row.name}</label>
                  <input
                    className="control"
                    id={`setup-license-${row.id}`}
                    onChange={(event) =>
                      setLicenses((current) => ({ ...current, [row.id]: event.target.value }))
                    }
                    placeholder="RBT0-XXXX-XXXX-XXXX (opsional)"
                    value={licenses[row.id] || ""}
                  />
                </div>
              ))}
            </div>
            {duplicateKeys.length > 0 && (
              <p className="plugin-alert plugin-alert-inline">
                <TriangleAlert size={15} />
                <span>
                  License key yang sama dipakai lebih dari satu sub: {duplicateKeys.join(", ")}.
                  Tiap sub butuh lisensinya sendiri.
                </span>
              </p>
            )}
          </fieldset>
        )}

        {siteIds.length > 0 &&
          (oneDomain ? (
            <fieldset className="plugin-fieldset setup-sub-settings">
              <legend>Pengaturan domain · {domains[0]}</legend>
              {schema ? (
                DOMAIN_ITEMS.filter((group) => group === "adcode" || schema[group]).map((group) =>
                  group === "adcode" ? (
                    <div className="setup-sub-group" key={group}>
                      <Switch
                        checked={Boolean(siteOn.adCode)}
                        hint="Domain dengan akun GAM: AdX, sama dengan tab AdX di halaman Plugin (unit dari Ad Manager, template Semua ukuran Ad Manager, 3 slot). Domain tanpa akun GAM: AdSense, dari kode yang ditempel per subdomain — sama dengan tab AdSense."
                        label="Kode Iklan"
                        onChange={(on) => setSiteOn((c) => ({ ...c, adCode: on }))}
                      />
                      {siteOn.adCode && (
                        <div className="setup-sub-posts">
                          {selectedRows.map((row) =>
                            hasGamAccount(row, store?.gamAccounts) ? (
                              <div className="setup-sub-adcode" key={row.id}>
                                <span className="setup-sub-post-name">{row.name}</span>
                                <span className="badge info">AdX · akun GAM ditemukan</span>
                              </div>
                            ) : (
                              <AdsenseBoxes
                                codes={adsense[row.id] || [""]}
                                key={row.id}
                                name={row.name}
                                onChange={(codes) =>
                                  setAdsense((current) => ({ ...current, [row.id]: codes }))
                                }
                              />
                            ),
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="setup-sub-group" key={group}>
                      <Switch
                        checked={Boolean(openGroups[group])}
                        label={`Atur ${schema[group].title}`}
                        onChange={(on) => setOpenGroups((current) => ({ ...current, [group]: on }))}
                      />
                      {openGroups[group] && (
                        <PluginGroupFields
                          fields={schema[group].fields}
                          oneColumn={schema[group].columns === 1}
                          onChange={(name, next) => setField(group, name, next)}
                          readOnly={false}
                          sections={schema[group].sections}
                          values={config[group]}
                        />
                      )}
                    </div>
                  ),
                )
              ) : (
                <p className="muted-line">Memuat skema pengaturan dari server...</p>
              )}
            </fieldset>
          ) : (
            <p className="plugin-alert plugin-alert-inline">
              <TriangleAlert size={15} />
              <span>
                Sub terpilih dari {domains.length} domain berbeda. Pilih sub dari satu domain saja
                untuk mengisi pengaturannya; lisensi per sub dan setup tetap jalan tanpa itu.
              </span>
            </p>
          ))}

        {siteIds.length > 0 && (
          <fieldset className="plugin-fieldset">
            <legend>Setup situs sesudah plugin</legend>
            <div className="setup-sub-group">
              <Switch
                checked={Boolean(siteOn.deployment)}
                label="Setting Sub (hanya untuk host baru)"
                onChange={(on) => setSiteOn((c) => ({ ...c, deployment: on }))}
              />
              {siteOn.deployment && (
                <div className="plugin-actions-buttons">
                  {TASKS.map((item) => (
                    // biome-ignore lint/a11y/noLabelWithoutControl: RowCheckbox merender <input> di dalam label ini.
                    <label className="checkbox-option" key={item.id} title={item.help}>
                      <RowCheckbox
                        checked={tasks.includes(item.id)}
                        label={item.label}
                        onChange={() => toggleIn(setTasks, item.id)}
                      />
                      {item.label}
                    </label>
                  ))}
                </div>
              )}
            </div>
            <div className="setup-sub-group">
              <Switch
                checked={Boolean(siteOn.legal)}
                label="Halaman legal (Privacy Policy dkk)"
                onChange={(on) => setSiteOn((c) => ({ ...c, legal: on }))}
              />
              {siteOn.legal && (
                <div className="plugin-actions-buttons">
                  {PAGES.map((title) => (
                    // biome-ignore lint/a11y/noLabelWithoutControl: RowCheckbox merender <input> di dalam label ini.
                    <label className="checkbox-option" key={title}>
                      <RowCheckbox
                        checked={pages.includes(title)}
                        label={title}
                        onChange={() => toggleIn(setPages, title)}
                      />
                      {title}
                    </label>
                  ))}
                </div>
              )}
              {siteOn.legal && (
                <AiKeyField
                  id="setup-legal-key"
                  label="Kunci AI Privacy Policy Generator"
                  onChange={setLegalKey}
                  onRemember={setRememberLegal}
                  remember={rememberLegal}
                  value={legalKey}
                />
              )}
            </div>
            <div className="setup-sub-group">
              <Switch
                checked={Boolean(siteOn.autopost)}
                label="AutoPost (kata kunci dibuat AI sesudah plugin terpasang, lalu langsung jadi artikel)"
                onChange={(on) => setSiteOn((c) => ({ ...c, autopost: on }))}
              />
              {siteOn.autopost && (
                <AiKeyField
                  id="setup-autopost-key"
                  label="Kunci AI AutoPost"
                  onChange={setPostKey}
                  onRemember={setRememberPost}
                  remember={rememberPost}
                  value={postKey}
                />
              )}
              {siteOn.autopost && (
                <div className="setup-sub-posts">
                  {selectedRows.map((row) => {
                    const post = postOf(row.id);
                    return (
                      <div className="setup-sub-post" key={row.id}>
                        <span className="setup-sub-post-name">{row.name}</span>
                        <div className="setup-sub-post-generator">
                          <div className="field">
                            <label htmlFor={`setup-base-${row.id}`}>Kata kunci dasar</label>
                            <input
                              className="control"
                              id={`setup-base-${row.id}`}
                              maxLength={AUTOPOST_BASE_MAX}
                              onChange={(event) => setPost(row.id, { base: event.target.value })}
                              placeholder="mis. cat health"
                              value={post.base}
                            />
                          </div>
                          <div className="field">
                            <label htmlFor={`setup-total-${row.id}`}>Total</label>
                            <input
                              className="control"
                              id={`setup-total-${row.id}`}
                              max={AUTOPOST_MAX_KEYWORDS}
                              min={1}
                              onChange={(event) => {
                                // Angka yang tidak terbaca (kotak sedang dikosongkan) tidak mengubah apa pun.
                                const total = Number(event.target.value);
                                if (Number.isInteger(total) && total >= 1) {
                                  setPost(row.id, {
                                    total: Math.min(total, AUTOPOST_MAX_KEYWORDS),
                                  });
                                }
                              }}
                              type="number"
                              value={post.total}
                            />
                          </div>
                          <div className="field">
                            <label htmlFor={`setup-lang-${row.id}`}>Bahasa</label>
                            <SelectField
                              id={`setup-lang-${row.id}`}
                              onChange={(next) => setPost(row.id, { bahasa: next || "English" })}
                              options={LANGUAGE_OPTIONS}
                              value={post.bahasa}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {siteOn.autopost && schema?.autopost && articleValues && (
                <div className="setup-sub-article">
                  <Switch
                    checked={articleOpen}
                    label="Atur setelan artikel (bahasa, gaya, kategori, status, gambar...)"
                    onChange={setArticleOpen}
                  />
                  {articleOpen && (
                    <PluginGroupFields
                      fields={schema.autopost.fields}
                      onChange={(name, next) =>
                        setArticleValues((current) => ({ ...current, [name]: next }))
                      }
                      readOnly={false}
                      sections={schema.autopost.sections}
                      values={articleValues}
                    />
                  )}
                </div>
              )}
            </div>
            <div className="setup-sub-group">
              <Switch
                checked={Boolean(siteOn.menus)}
                label="Menu header & footer (paling akhir)"
                onChange={(on) => setSiteOn((c) => ({ ...c, menus: on }))}
              />
            </div>
            <div className="setup-sub-group">
              <Switch
                checked={Boolean(siteOn.landing)}
                hint="Sama dengan Buat dari preset di halaman Plugin: slug & parameter acak, URL cloaking acak, jeda video 15-30 detik. Dibuat sesudah artikel AutoPost, karena preset mengisi URL artikel situs."
                label="Landing page dari preset"
                onChange={(on) => setSiteOn((c) => ({ ...c, landing: on }))}
              />
              {siteOn.landing && (
                <Switch
                  checked={Boolean(siteOn.keitaro)}
                  hint="Sama dengan tombol Buat campaign Keitaro + gate di dialog Tautan landing: landing Keitaro + salinan campaign template, lalu gate vi-control. Nama campaign diawali PIC subdomainnya, mis. ACA T2 (WL) 1mRH (sub.domain.com); sub tanpa PIC dilewati."
                  label="Campaign Keitaro + gate dari tautan landing"
                  onChange={(on) => setSiteOn((c) => ({ ...c, keitaro: on }))}
                />
              )}
            </div>
          </fieldset>
        )}

        {confirming && (
          <Dialog
            busy={starting}
            className="confirm-dialog plugin-dialog"
            onClose={() => setConfirming(false)}
            subtitle={selectedRows.map((row) => row.name).join(", ")}
            title="Jalankan Setting Sub?"
          >
            <p className="plugin-alert plugin-alert-inline">
              <TriangleAlert size={15} />
              <span>
                Hanya untuk host yang BARU dipasang. Tidak ada backup dan tidak bisa dibatalkan.
              </span>
            </p>
            <ul className="plugin-diff-list">
              {TASKS.filter((item) => tasks.includes(item.id)).map((item) => (
                <li key={item.id}>
                  <strong>{item.label}</strong> — {item.help}
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

        <DataTable
          columns={[
            { accessorKey: "name", header: "Sub Domain" },
            {
              id: "state",
              header: "Status",
              cell: ({ row }) => {
                const [label, tone] = STATE[row.original.setup.state] || ["-", "neutral"];
                return <span className={`badge ${tone}`}>{label}</span>;
              },
            },
            {
              id: "step",
              header: "Langkah",
              cell: ({ row }) => STEP[row.original.setup.step] || row.original.setup.step || "-",
            },
            {
              id: "detail",
              header: "Keterangan",
              cell: ({ row }) => (
                <SetupDetail state={row.original.setup.state} text={row.original.setup.detail} />
              ),
            },
            {
              id: "at",
              header: "Diperbarui",
              cell: ({ row }) => formatDateTime(row.original.setup.updatedAt),
            },
            { id: "by", header: "Oleh", cell: ({ row }) => row.original.setup.by || "-" },
            {
              // Langkah berikutnya untuk sub baru: Setting Sub, halaman legal, landing.
              id: "next",
              header: "",
              enableSorting: false,
              cell: ({ row }) =>
                row.original.setup.state === "done" && (
                  <button
                    className="ghost-button"
                    onClick={() =>
                      navigateTo(`/plugin?situs=${encodeURIComponent(row.original.id)}&tab=setup`)
                    }
                    type="button"
                  >
                    Setup Situs
                  </button>
                ),
              meta: { align: "right" },
            },
          ]}
          emptyText="Belum ada subdomain yang pernah di-setup dari sini."
          items={rows}
        />
      </section>
    </div>
  );
}

// Keterangan run memuat satu kalimat per langkah; kalimat pertama tampil, sisanya di balik dropdown.
// Run yang tidak "done" menandai kalimat langkah yang bermasalah dengan kuning.
function SetupDetail({ text, state }) {
  const lines = setupDetailLines(text);
  if (!lines.length) return "-";
  const warn = (line) => state !== "done" && isSetupWarning(line);
  const tone = (line) => (warn(line) ? "setup-sub-warn" : undefined);
  if (lines.length === 1) return <span className={tone(lines[0])}>{lines[0]}</span>;
  const [first, ...rest] = lines;
  const hidden = rest.filter(warn).length;
  return (
    <details className="setup-sub-detail">
      <summary>
        <span className={tone(first)}>{first}</span>{" "}
        <span className="setup-sub-detail-more">+{rest.length} lagi</span>
        {hidden > 0 && <span className="setup-sub-warn"> · {hidden} bermasalah</span>}
      </summary>
      {rest.map((line, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: urutan kalimat memang identitasnya.
        <p className={tone(line)} key={index}>
          {line}
        </p>
      ))}
    </details>
  );
}

// Kunci AI satu langkah. Hanya lewat body ke situs; "Ingat" menyimpannya di perangkat ini saja.
function AiKeyField({ id, label, value, onChange, remember, onRemember }) {
  return (
    <div className="setup-sub-ai">
      <div className="field">
        <label htmlFor={id}>{label}</label>
        <input
          autoComplete="off"
          className="control"
          id={id}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Gemini, OpenAI, Claude, Groq, Qwen"
          type="password"
          value={value}
        />
      </div>
      <Switch
        checked={remember}
        hint="Disimpan di perangkat ini saja — tidak pernah masuk database dashboard maupun alamat halaman."
        label="Ingat di browser ini"
        onChange={onRemember}
      />
    </div>
  );
}

/**
 * Kotak tempel kode AdSense satu sub: Kode iklan 1…N (satu `<ins>` per kotak, sama dengan tab
 * AdSense). Slot AdSense tidak bisa dibuat lewat API, jadi kodenya dibuat di halaman AdSense lalu
 * ditempel di sini. Kosong = kode iklan sub ini dilewati.
 */
function AdsenseBoxes({ name, codes, onChange }) {
  const set = (index, value) => onChange(codes.map((code, i) => (i === index ? value : code)));
  return (
    <div className="setup-sub-post">
      <span className="setup-sub-post-name">
        {name} <span className="badge neutral">AdSense · tanpa akun GAM</span>
      </span>
      {codes.map((code, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: kotak ke-N memang identitasnya (Kode iklan N).
        <div className="field" key={index}>
          <label htmlFor={`setup-adsense-${name}-${index}`}>Kode iklan {index + 1}</label>
          <textarea
            className="control"
            id={`setup-adsense-${name}-${index}`}
            onChange={(event) => set(index, event.target.value)}
            placeholder='<script async src="…adsbygoogle.js?client=ca-pub-…"></script> <ins class="adsbygoogle" … data-ad-slot="…"></ins> <script>(adsbygoogle = window.adsbygoogle || []).push({});</script>'
            rows={3}
            value={code}
          />
        </div>
      ))}
      <div className="plugin-actions-buttons">
        {codes.length < ADSENSE_MAX_SLOTS && (
          <button className="ghost-button" onClick={() => onChange([...codes, ""])} type="button">
            Tambah kotak
          </button>
        )}
        {codes.length > 1 && (
          <button
            className="ghost-button"
            onClick={() => onChange(codes.slice(0, -1))}
            type="button"
          >
            Hapus kotak terakhir
          </button>
        )}
      </div>
    </div>
  );
}
