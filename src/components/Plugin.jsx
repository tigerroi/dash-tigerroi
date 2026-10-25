import {
  ArrowLeft,
  ArrowUpCircle,
  ChevronDown,
  ChevronRight,
  Link2,
  Plug,
  PlugZap,
  RefreshCw,
  Send,
  Sparkles,
  TriangleAlert,
  Unplug,
} from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useUrlState } from "../hooks/useUrlState";
import {
  AUTOPOST_MAX_KEYWORDS,
  autopostFormValues,
  autopostKeywords,
  dropPostedKeywords,
  jobLabel,
  jobTone,
  nextPollDelay,
  postedKeywords,
  readStoredAiKey,
  runningJobs,
  submitMessage,
  writeStoredAiKey,
} from "../lib/autopost";
import {
  CONTROL_API_ENABLED,
  createPluginLandingPreset,
  enrollPluginSite,
  enrollPluginSites,
  fetchPluginAutopostJob,
  fetchPluginAutopostJobs,
  fetchPluginConfig,
  fetchPluginLanding,
  fetchPluginLandingLink,
  fetchPluginLandings,
  fetchPluginSchema,
  generatePluginKeywords,
  pingPluginSite,
  resetPluginSite,
  savePluginConfig,
  savePluginConfigMany,
  savePluginLanding,
  submitPluginAutopost,
  updatePluginSites,
} from "../lib/controlApi";
import { formatDateTime } from "../lib/formatDate";
import { notifyError, notifySuccess, notifyWarning } from "../lib/notify";
import {
  bulkLabel,
  bulkMessage,
  bulkTone,
  changedValues,
  groupFields,
  hasChanges,
  pluginSiteState,
  pluginSummary,
  shouldForgetOpenSite,
  toFormValue,
  toFormValues,
  toPluginRows,
  unappliedMessage,
} from "../lib/plugin";
import { ColumnHint } from "./ui/ColumnHint";
import { DataTable } from "./ui/DataTable";
import { Dialog } from "./ui/Dialog";
import { EmptyMessage } from "./ui/EmptyMessage";
import { PageHeader } from "./ui/PageHeader";
import { RefreshButton } from "./ui/RefreshButton";
import { RowCheckbox } from "./ui/RowCheckbox";
import { SelectField } from "./ui/SelectField";
import { Switch } from "./ui/Switch";
import { TabStrip } from "./ui/TabStrip";

/**
 * Dimuat lazy, sepola Overview dan OTP: tab yang cuma bisa dibuka superadmin tidak perlu ikut bundle
 * utama yang diunduh SETIAP akun tiap muat halaman. (react-select sendiri sudah di bundle utama sejak
 * SelectField menggantikan seluruh `<select>` bawaan.)
 */
const GptInject = lazy(() =>
  import("./plugin/GptInject").then((module) => ({ default: module.GptInject })),
);
const AdsenseInject = lazy(() =>
  import("./plugin/AdsenseInject").then((module) => ({ default: module.AdsenseInject })),
);

import { CloakingUrls } from "./plugin/CloakingUrls";
import { FieldInput, PluginGroupFields } from "./plugin/PluginGroupFields";
import { LandingLinkDialog, SiteSetup } from "./plugin/SiteSetup";

const SiteAudit = lazy(() =>
  import("./plugin/SiteAudit").then((module) => ({ default: module.SiteAudit })),
);

/**
 * Manajemen plugin RabbitROI di tiap situs WordPress (plugin >= 0.4.7).
 *
 * Halaman ini BERBEDA dari semua halaman lain di dashboard dalam satu hal yang menentukan seluruh
 * bentuknya: yang ditampilkannya sebagian besar TIDAK ADA di RTDB. Pengaturan landing, iklan,
 * header/footer, behaviour, CMP, dan keamanan tinggal di database WordPress masing-masing situs, dan
 * dibaca lewat
 * server kontrol setiap kali sebuah situs dibuka. Yang di RTDB cuma cermin status (`pluginSites`).
 *
 * Akibatnya dua, dan keduanya terlihat di kode di bawah:
 *
 *   1. **Tidak ada langganan realtime untuk isinya.** Tiap tab memuat sendiri saat dibuka, dan
 *      punya keadaan memuat/gagalnya sendiri. Tidak ada yang bisa "ikut berubah" seperti tabel ROI.
 *   2. **Tidak ada jalur cadangan.** Gating jatuh ke antrean RTDB saat server mati; di sini tidak
 *      ada yang bisa diantrekan — enroll token dan api_key tiap situs tinggal di server, dan
 *      situsnya sendiri tidak akan menjawab browser (tidak ada header CORS untuk origin dashboard).
 *      Server yang belum dikonfigurasi berarti halaman ini mengatakan begitu, bukan menggambar
 *      tombol yang pasti gagal.
 *
 * Karena tidak satu pun aksi di sini menulis ke RTDB dari browser, seluruh panggilannya lewat
 * `controlApi` langsung — bukan lewat `useFirebaseStore` seperti gating dan saklar campaign, yang
 * ada di sana justru karena keduanya menulis antrean RTDB.
 */
export function Plugin({
  store,
  canManage,
  loading,
  tab = "daftar",
  onSaveGptTemplate,
  onRemoveGptTemplate,
  onUpdateGptTemplate,
  onSaveAdsenseSlots,
  onAddCloakingUrls,
  onRemoveCloakingUrl,
}) {
  const rows = useMemo(
    () => toPluginRows(store.subDomains, store.pluginSites),
    [store.subDomains, store.pluginSites],
  );
  const summary = useMemo(() => pluginSummary(rows), [rows]);

  // Skema field diambil sekali per sesi: isinya statis, dan yang mengubahnya adalah deploy server.
  // Satu-satunya definisi field yang ada — server memvalidasi dengan yang sama persis.
  const [schema, setSchema] = useState(null);
  const [schemaError, setSchemaError] = useState("");

  useEffect(() => {
    if (!CONTROL_API_ENABLED) return undefined;
    let alive = true;
    fetchPluginSchema()
      .then((data) => alive && setSchema(data))
      .catch((error) => alive && setSchemaError(error.message));
    return () => {
      alive = false;
    };
  }, []);

  // Situs yang sedang dibuka ikut ke alamat, dan dengan `push` — itulah yang membuat Back kembali
  // ke daftar yang masih tersaring alih-alih keluar dari halaman. Tombol "Semua situs" di bawah
  // menutupnya dengan `replace`, supaya membuka lalu menutup satu situs tidak menumpuk riwayat.
  const [openId, setOpenId] = useUrlState("situs", "", { history: "push" });
  // Dibaca di sini hanya untuk dibersihkan saat situsnya ditutup; yang memakainya SiteManager,
  // lewat hook yang sama dan parameter yang sama.
  const [, setTab] = useUrlState("tab", "landing");
  const openRow = rows.find((row) => row.id === openId) || null;

  /**
   * Situs yang sedang dibuka bisa hilang dari daftar (baris subdomainnya dihapus admin lain).
   * Tanpa penjaga ini, halaman berhenti di panel kosong tanpa jalan kembali.
   *
   * `loading` WAJIB diperiksa duluan, dan ini bukan kehati-hatian berlebih — tanpanya penjaga ini
   * membatalkan seluruh gunanya `?situs=` di alamat. Saat halaman dimuat ulang, langganan RTDB
   * belum mengirim apa pun, jadi `rows` masih kosong sementara `openId` sudah terbaca dari alamat.
   * Penjaga yang jalan pada saat itu menyimpulkan situsnya sudah dihapus, menghapus `?situs=`, dan
   * melempar orang kembali ke daftar — persis keadaan yang mau dihindari dengan menaruh situs yang
   * terbuka di alamat. `?tab=` yang tertinggal di belakangnya membuat seolah tab-nya yang rusak.
   *
   * "Belum datang" dan "memang tidak ada" tidak bisa dibedakan dari `rows` yang kosong saja; yang
   * bisa membedakannya cuma keadaan muat langganannya sendiri.
   */
  useEffect(() => {
    if (tab !== "daftar") return;
    if (shouldForgetOpenSite(openId, rows, loading)) setOpenId("", { history: "replace" });
  }, [openId, rows, setOpenId, loading, tab]);

  /**
   * Tab AdX dan AdSense: inject kode iklan ke banyak situs. Tidak memakai skema maupun `?situs=` —
   * yang ditulisnya field tetap (Header code dan/atau Kode iklan 1–5), dan pengurai + penyusunnya
   * tinggal di server. Kepala halaman dan peringatan server kontrol tetap digambar: tanpa server tidak
   * ada satu pun tombol di kedua tab itu yang bisa jalan, sama persis dengan tab daftar.
   */
  /**
   * Tab Cek Situs: membaca plugin tiap subdomain (domain utuh atau pilihan subdomain) dan menilai kode
   * iklan, CMP, network code AdX, landing page, dan behaviour-nya. Tidak menulis ke situs mana pun.
   */
  if (tab === "cloaking") {
    return (
      <div className="page-stack">
        <PageHeader
          title="URL Cloaking"
          description="Daftar URL cloaking untuk landing yang dibuat lewat Buat dari preset."
        />
        <CloakingUrls
          canManage={canManage}
          items={store.cloakingUrls}
          onAdd={onAddCloakingUrls}
          onRemove={onRemoveCloakingUrl}
        />
      </div>
    );
  }

  if (tab === "cek") {
    return (
      <div className="page-stack">
        <PageHeader
          title="Cek Situs"
          description="Pilih satu domain (seluruh subdomainnya ikut) atau beberapa subdomain, lalu cek kode iklan, CMP, network ID AdX, landing page, dan behaviour plugin-nya. Tidak ada yang ditulis ke situs."
        />
        {!CONTROL_API_ENABLED && (
          <p className="plugin-alert">
            <TriangleAlert size={15} />
            <span>
              Server kontrol belum dikonfigurasi (<code>VITE_CONTROL_API_URL</code>). Situs dibaca
              lewat server itu — tanpanya tab ini tidak bisa dipakai.
            </span>
          </p>
        )}
        <Suspense fallback={<EmptyMessage panel>Memuat pemeriksa...</EmptyMessage>}>
          <SiteAudit canManage={canManage} domains={store.domains} rows={rows} />
        </Suspense>
      </div>
    );
  }

  if (tab === "adx" || tab === "adsense") {
    const adsense = tab === "adsense";
    return (
      <div className="page-stack">
        <PageHeader
          title={adsense ? "AdSense" : "AdX"}
          description={
            adsense
              ? "Tempel kode unit dari halaman AdSense per subdomain, periksa slotnya ke akun AdSense, lalu tulis ke Kode iklan beberapa subdomain sekaligus. Header situs tidak disentuh."
              : "Pilih subdomain, lihat network code, properti, dan slot iklannya dari Ad Manager, uji ukuran lewat template, lalu tulis header dan kode iklannya ke beberapa subdomain sekaligus."
          }
        />
        {!CONTROL_API_ENABLED && (
          <p className="plugin-alert">
            <TriangleAlert size={15} />
            <span>
              Server kontrol belum dikonfigurasi (<code>VITE_CONTROL_API_URL</code>). Kode disusun
              dan ditulis lewat server itu — tanpanya tab ini tidak bisa dipakai.
            </span>
          </p>
        )}
        <Suspense fallback={<EmptyMessage panel>Memuat generator...</EmptyMessage>}>
          {adsense ? (
            <AdsenseInject
              canManage={canManage}
              onSaveSlots={onSaveAdsenseSlots}
              rows={rows}
              saved={store.adsenseSlots}
            />
          ) : (
            <GptInject
              canManage={canManage}
              onRemoveTemplate={onRemoveGptTemplate}
              onSaveTemplate={onSaveGptTemplate}
              onUpdateTemplate={onUpdateGptTemplate}
              rows={rows}
              templates={store.gptSizeTemplates}
            />
          )}
        </Suspense>
      </div>
    );
  }

  return (
    <div className="page-stack">
      <PageHeader
        title="Plugin"
        description="Kelola landing page, pengaturan iklan, header/footer, behaviour, CMP, dan keamanan plugin RabbitROI di tiap subdomain."
        action={
          openRow ? (
            <button
              className="ghost-button"
              onClick={() => {
                setOpenId("", { history: "replace" });
                setTab("", { history: "replace" });
              }}
              type="button"
            >
              <ArrowLeft size={15} />
              <span>Semua situs</span>
            </button>
          ) : null
        }
      />

      {/* Disebut sekali di atas halaman, bukan diulang di tiap tombol: tanpa server kontrol tidak
          ada satu pun aksi di halaman ini yang bisa jalan, dan itu satu keadaan — bukan dua puluh
          tombol yang masing-masing gagal sendiri-sendiri. */}
      {!CONTROL_API_ENABLED && (
        <p className="plugin-alert">
          <TriangleAlert size={15} />
          <span>
            Server kontrol belum dikonfigurasi (<code>VITE_CONTROL_API_URL</code>). Halaman ini
            tidak punya jalur lain ke situs — enroll token dan kunci tiap situs tinggal di server,
            dan situsnya sendiri tidak menjawab permintaan dari browser.
          </span>
        </p>
      )}

      {schemaError && (
        <p className="plugin-alert">
          <TriangleAlert size={15} />
          <span>Skema pengaturan gagal diambil dari server: {schemaError}</span>
        </p>
      )}

      {loading && openId && !openRow ? (
        // Alamatnya menunjuk satu situs dan daftarnya belum datang. Menggambar daftar armada di
        // sini adalah kedipan yang terbaca persis seperti "refresh melempar saya kembali".
        <EmptyMessage panel>Memuat situs...</EmptyMessage>
      ) : openRow ? (
        <SiteManager
          canManage={canManage}
          row={openRow}
          rows={rows}
          schema={schema}
          tasks={store.subDomains?.find((sub) => sub.id === openRow.id)?.siteTasks}
        />
      ) : (
        <SiteList
          canManage={canManage}
          onOpen={setOpenId}
          rows={rows}
          schema={schema}
          summary={summary}
        />
      )}
    </div>
  );
}

// --- Daftar situs ---------------------------------------------------------------------------------

function SiteList({ rows, summary, canManage, onOpen, schema }) {
  // Di alamat, bukan di komponen ini: daftar ini dibuang begitu satu situs dibuka, dan pencarian
  // yang ikut terbuang berarti "Semua situs" mengembalikan seluruh armada — bukan hasil pencarian
  // yang sedang dikerjakan orang.
  const [search, setSearch] = useUrlState("q", "");
  const [filter, setFilter] = useUrlState("status", "all");
  const [selected, setSelected] = useState(() => new Set());
  const [busy, setBusy] = useState("");
  const [bulk, setBulk] = useState(null);
  const [versionFor, setVersionFor] = useState(null);
  const [results, setResults] = useState(null);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (term && !`${row.name} ${row.pic} ${row.parentDomain}`.toLowerCase().includes(term)) {
        return false;
      }
      if (filter === "enrolled") return row.enrolled;
      if (filter === "pending") return !row.enrolled;
      if (filter === "failing") return Boolean(row.error);
      return true;
    });
  }, [rows, search, filter]);

  const toggle = (id) =>
    setSelected((current) => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  // "Pilih semua" bekerja pada yang TERLIHAT, bukan pada seluruh armada. Satu centang yang diam-diam
  // memilih 200 situs di balik filter adalah cara sebuah perubahan mendarat di situs yang tidak
  // pernah dilihat orang yang menekannya.
  const allVisibleSelected = visible.length > 0 && visible.every((row) => selected.has(row.id));
  const toggleAll = () =>
    setSelected((current) => {
      const next = new Set(current);
      for (const row of visible) {
        allVisibleSelected ? next.delete(row.id) : next.add(row.id);
      }
      return next;
    });

  const selectedRows = rows.filter((row) => selected.has(row.id));
  const selectedPending = selectedRows.filter((row) => !row.enrolled);
  const selectedEnrolled = selectedRows.filter((row) => row.enrolled);

  const runBulkEnroll = async () => {
    setBusy("enroll");
    try {
      const res = await enrollPluginSites(selectedPending.map((row) => row.id));
      setResults({ title: "Enroll massal", rows: res.results, summary: res.summary });
      const { tone, message } = bulkMessage(res.summary, "Enroll");
      tone === "success" ? notifySuccess(message) : notifyWarning(message, res.summary);
      setSelected(new Set());
    } catch (error) {
      notifyError(error, "Enroll massal gagal dijalankan.");
    } finally {
      setBusy("");
    }
  };

  // Kotak centang di sini MEMILIH situs untuk tindakan berikutnya, bukan menyatakan keadaan — jadi
  // ia tetap kotak centang, bukan Switch. Pilihannya dipegang `selected` di komponen ini (bukan
  // `rowSelection` TanStack), karena "pilih semua" bekerja pada yang TERLIHAT, lihat `toggleAll`.
  const siteColumns = [
    {
      id: "select",
      enableSorting: false,
      header: () =>
        canManage && (
          <RowCheckbox
            label="Pilih semua yang terlihat"
            checked={allVisibleSelected}
            onChange={toggleAll}
          />
        ),
      cell: ({ row }) =>
        canManage && (
          <RowCheckbox
            label={`Pilih ${row.original.name}`}
            checked={selected.has(row.original.id)}
            onChange={() => toggle(row.original.id)}
          />
        ),
      meta: { className: "plugin-check", headerClassName: "plugin-check" },
    },
    {
      accessorKey: "name",
      header: "Subdomain",
      cell: ({ row }) => {
        const state = pluginSiteState(row.original, {
          canManage,
          serverReady: CONTROL_API_ENABLED,
        });
        return (
          <div className="plugin-name">
            <span>{row.original.name}</span>
            {/* Sebabnya di bawah namanya, bukan disembunyikan di title: yang perlu dibaca orang saat
                membuka halaman ini adalah situs mana yang berhenti menjawab dan kenapa. */}
            {state.reason && <small className="muted-line">{state.reason}</small>}
          </div>
        );
      },
    },
    { accessorKey: "pic", header: "PIC", cell: ({ row }) => row.original.pic || "-" },
    {
      id: "plugin",
      header: "Plugin",
      cell: ({ row }) => {
        const state = pluginSiteState(row.original, {
          canManage,
          serverReady: CONTROL_API_ENABLED,
        });
        return <span className={`badge ${state.tone}`}>{state.label}</span>;
      },
      meta: {
        sortValue: (row) =>
          pluginSiteState(row, { canManage, serverReady: CONTROL_API_ENABLED }).label,
      },
    },
    { accessorKey: "version", header: "Versi", cell: ({ row }) => row.original.version || "-" },
    {
      accessorKey: "lastSeenAt",
      header: "Terakhir menjawab",
      cell: ({ row }) => (row.original.lastSeenAt ? formatDateTime(row.original.lastSeenAt) : "-"),
    },
    {
      id: "actions",
      header: "Aksi",
      enableSorting: false,
      cell: ({ row }) => <SiteActions canManage={canManage} onOpen={onOpen} row={row.original} />,
      meta: { align: "right" },
    },
  ];

  const stats = [
    { label: "Subdomain", value: summary.total, tone: "", icon: Plug },
    { label: "Terhubung", value: summary.enrolled, tone: "green", icon: PlugZap },
    { label: "Belum enroll", value: summary.pending, tone: "", icon: Unplug },
    // Dihitung terpisah dari "belum enroll": selisih itu yang membedakan armada yang belum dipasang
    // dari armada yang dipasang lalu berhenti menjawab.
    { label: "Bermasalah", value: summary.failing, tone: "orange", icon: TriangleAlert },
  ];

  return (
    <>
      <section className="stats-grid">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <article className={`stat-card ${stat.tone}`} key={stat.label}>
              <div className="stat-card-header">
                <span>{stat.label}</span>
                <Icon size={18} />
              </div>
              <strong>{stat.value}</strong>
            </article>
          );
        })}
      </section>

      <section className="panel">
        <div className="panel-header tabbed">
          <div>
            <h2>Situs</h2>
            <p>Centang beberapa situs untuk enroll atau menerapkan pengaturan sekaligus.</p>
          </div>
          <div className="gating-toolbar">
            <input
              className="control"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Cari subdomain atau PIC..."
              type="search"
              value={search}
            />
            <SelectField
              ariaLabel="Saring situs"
              className="gating-filter-select"
              onChange={setFilter}
              options={[
                { value: "all", label: `Semua (${summary.total})` },
                { value: "enrolled", label: `Terhubung (${summary.enrolled})` },
                { value: "pending", label: `Belum enroll (${summary.pending})` },
                { value: "failing", label: `Bermasalah (${summary.failing})` },
              ]}
              value={filter}
            />
          </div>
        </div>

        {canManage && selected.size > 0 && (
          <div className="plugin-bulkbar">
            <span>
              {selected.size} situs dipilih
              {selectedPending.length > 0 && ` (${selectedPending.length} belum enroll)`}
            </span>
            <div className="plugin-bulkbar-actions">
              <button
                className="ghost-button"
                disabled={busy !== "" || selectedPending.length === 0}
                onClick={runBulkEnroll}
                title={
                  selectedPending.length === 0
                    ? "Semua yang dipilih sudah enroll."
                    : `Enroll ${selectedPending.length} situs`
                }
                type="button"
              >
                <Link2 size={15} />
                <span>{busy === "enroll" ? "Meng-enroll..." : "Enroll terpilih"}</span>
              </button>
              {/* Ganti versi berdiri di samping Enroll dan bukan di dialog pengaturan: yang
                  diubahnya bukan salah satu grup pengaturan, melainkan plugin itu sendiri. */}
              <button
                className="ghost-button"
                disabled={selectedEnrolled.length === 0}
                onClick={() => setVersionFor(selectedEnrolled)}
                title={
                  selectedEnrolled.length === 0
                    ? "Belum ada situs terhubung yang dipilih."
                    : `Ganti versi plugin di ${selectedEnrolled.length} situs`
                }
                type="button"
              >
                <ArrowUpCircle size={15} />
                <span>Ganti Versi</span>
              </button>
              <button
                className="primary-button"
                disabled={!schema || selectedEnrolled.length === 0}
                onClick={() => setBulk({ rows: selectedEnrolled })}
                title={
                  selectedEnrolled.length === 0
                    ? "Belum ada situs terhubung yang dipilih."
                    : undefined
                }
                type="button"
              >
                <Send size={15} />
                <span>Terapkan pengaturan...</span>
              </button>
              <button className="ghost-button" onClick={() => setSelected(new Set())} type="button">
                Batal pilih
              </button>
            </div>
          </div>
        )}

        <DataTable
          className="plugin-table"
          columns={siteColumns}
          emptyText={
            rows.length === 0
              ? "Belum ada subdomain yang punya nama host. Tambahkan di halaman Sub Domains dulu."
              : "Tidak ada situs yang cocok."
          }
          getRowId={(row) => String(row.id)}
          items={visible}
        />
      </section>

      {bulk && schema && (
        <BulkApplyDialog
          onClose={() => setBulk(null)}
          onDone={(payload) => {
            setResults(payload);
            setBulk(null);
            setSelected(new Set());
          }}
          rows={bulk.rows}
          schema={schema}
        />
      )}

      {versionFor && (
        <VersionDialog
          onClose={() => setVersionFor(null)}
          onDone={(payload) => {
            setResults(payload);
            setVersionFor(null);
            setSelected(new Set());
          }}
          rows={versionFor}
        />
      )}

      {results && <BulkResultDialog onClose={() => setResults(null)} {...results} />}
    </>
  );
}

function SiteActions({ row, canManage, onOpen }) {
  const state = pluginSiteState(row, { canManage, serverReady: CONTROL_API_ENABLED });
  const [busy, setBusy] = useState("");

  const act = async (kind, run, done) => {
    setBusy(kind);
    try {
      await run();
      notifySuccess(done);
    } catch (error) {
      notifyError(error, `${kind} ${row.name} gagal.`);
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="plugin-row-actions">
      {state.canEnroll && (
        <button
          className="primary-button"
          disabled={busy !== ""}
          onClick={() =>
            act("Enroll", () => enrollPluginSite(row.id), `${row.name} berhasil di-enroll.`)
          }
          type="button"
        >
          {busy === "Enroll" ? "Meng-enroll..." : "Enroll"}
        </button>
      )}
      {state.canManage && (
        <button className="primary-button" onClick={() => onOpen(row.id)} type="button">
          Kelola
        </button>
      )}
      {state.canPing && (
        <button
          className="ghost-button"
          disabled={busy !== ""}
          onClick={() => act("Ping", () => pingPluginSite(row.id), `${row.name} menjawab.`)}
          type="button"
        >
          {busy === "Ping" ? "..." : "Ping"}
        </button>
      )}
    </div>
  );
}

// --- Satu situs ------------------------------------------------------------------------------------

const TABS = [
  // Onboarding host baru: lisensi, Setting Sub (Deployment Tools), halaman legal.
  { id: "setup", label: "Setup Situs" },
  { id: "landing", label: "Landing Page" },
  { id: "ads-settings", label: "Iklan" },
  { id: "header-footer", label: "Header & Footer" },
  { id: "behaviour", label: "Behaviour" },
  { id: "cmp", label: "CMP" },
  { id: "security", label: "Keamanan" },
  { id: "autopost", label: "AutoPost" },
];

function SiteManager({ row, rows, schema, canManage, tasks }) {
  const [tab, setTab] = useUrlState("tab", "landing");
  const [busy, setBusy] = useState("");
  /**
   * Isi tiap tab, disimpan selama situsnya masih terbuka.
   *
   * Tanpa ini, berpindah tab memanggil situs WordPress-nya lagi — dan situs itu tinggal di shared
   * hosting yang jawabannya bisa sedetik lebih. Bolak-balik Iklan → Behaviour → Iklan jadi tiga
   * panggilan untuk data yang sama, dan yang paling merugikan: SUNTINGAN YANG BELUM DISIMPAN
   * hilang tiap kali orang melirik tab sebelah.
   *
   * Yang disimpan bukan cuma jawaban situsnya, melainkan `values` (yang sedang diketik) DAN
   * `original` (pembanding yang menentukan field mana yang benar-benar berubah) berdampingan.
   * Menyimpan salah satunya saja membuat selisihnya salah begitu tab dibuka ulang — dan selisih
   * itulah satu-satunya yang dikirim ke situs.
   *
   * `useRef`, bukan `useState`: isinya tidak pernah menggambar ulang apa pun sendiri. Yang
   * menggambar adalah komponen tabnya, yang membaca cache ini sekali saat lahir.
   */
  const cache = useRef(new Map());
  const state = pluginSiteState(row, { canManage, serverReady: CONTROL_API_ENABLED });

  const reset = async () => {
    setBusy("reset");
    try {
      await resetPluginSite(row.id);
      notifySuccess(`Enrollment ${row.name} dilepas. Situs bisa di-enroll ulang.`);
    } catch (error) {
      notifyError(error, `Reset ${row.name} gagal.`);
    } finally {
      setBusy("");
    }
  };

  return (
    <section className="panel">
      <div className="panel-header tabbed">
        <TabStrip
          active={tab}
          label={`Pengaturan ${row.name}`}
          onChange={setTab}
          tabs={TABS.map((item) => ({
            ...item,
            tabId: `plugin-tab-${item.id}`,
            panelId: `plugin-panel-${item.id}`,
          }))}
        />
        <div className="gating-toolbar">
          <span className={`badge ${state.tone}`}>{state.label}</span>
          {state.canReset && (
            <button
              className="danger-button"
              disabled={busy !== ""}
              onClick={reset}
              // Reset bukan "hapus situs": ia melepas enrollment supaya kuncinya bisa dirotasi. Yang
              // perlu diketahui sebelum menekannya adalah bahwa kunci lama akan dibuang, dan enroll
              // ulang harus dilakukan sesudahnya.
              title="Lepas enrollment supaya kuncinya bisa dirotasi. Setelah ini situs harus di-enroll ulang."
              type="button"
            >
              {busy === "reset" ? "Melepas..." : "Reset enrollment"}
            </button>
          )}
        </div>
      </div>

      <p className="tab-note">
        {row.name}
        {row.version && ` — plugin ${row.version}`}
        {row.wp && `, WordPress ${row.wp}`}
        {row.php && `, PHP ${row.php}`}.{" "}
        {row.lastSeenAt
          ? `Terakhir menjawab ${formatDateTime(row.lastSeenAt)}.`
          : "Belum pernah menjawab."}
        {/* Pengaturan di bawah dibaca SAAT tab dibuka, bukan dilanggan realtime — dan itu perlu
            disebut, karena setiap halaman lain di dashboard ini memang berubah sendiri. */}
        {
          " Pengaturan di bawah dibaca dari situs sekali lalu disimpan selama halaman ini terbuka — pindah tab tidak memanggil situsnya lagi. Pakai Muat ulang untuk membaca keadaan terbarunya."
        }
      </p>

      {tab === "setup" ? (
        <SiteSetup canManage={canManage} row={row} tasks={tasks} />
      ) : tab === "landing" ? (
        <LandingManager cache={cache} canManage={canManage} row={row} schema={schema} />
      ) : tab === "autopost" ? (
        /* Bukan `ConfigEditor`: yang di sana membaca keadaan situs lalu mengirim SELISIHNYA, dan
           tidak satu pun dari dua sifat itu berlaku di sini — AutoPost tidak menyimpan pengaturan
           apa pun untuk dibaca, dan tiap pengiriman berdiri sendiri. */
        <AutoPostManager cache={cache} canManage={canManage} row={row} schema={schema} />
      ) : (
        <ConfigEditor
          cache={cache}
          canManage={canManage}
          group={tab}
          /* `key` tetap ada: tiap tab lahir sebagai komponennya sendiri, dan keadaan awalnya
             dibaca dari cache di atas. Dibuang, satu komponen dipakai ulang lintas tab dan form
             yang sudah diketik separuh untuk Iklan akan tampil sebagai isi Behaviour. */
          key={`${row.id}-${tab}`}
          row={row}
          rows={rows}
          schema={schema}
        />
      )}
    </section>
  );
}

/**
 * Satu grup pengaturan (Iklan / Header & Footer / Behaviour / CMP / Keamanan).
 *
 * `key` di pemanggilnya memuat id situs DAN nama tabnya, jadi berpindah tab atau berpindah situs
 * membuang komponen ini beserta seluruh keadaannya. Tanpa itu, form yang sudah diketik separuh
 * untuk satu situs akan tampil sebagai isi situs berikutnya — dan tombol Simpan-nya akan menulis
 * angka situs sebelumnya ke sana.
 */
function ConfigEditor({ row, rows, group, schema, canManage, cache }) {
  const fields = schema?.[group]?.fields || [];
  const title = schema?.[group]?.title || group;
  // Behaviour digambar satu kolom, meniru layar plugin — hampir tiap fieldnya punya baris
  // keterangan sendiri, dan dua kolom membuat keterangan itu berdampingan dengan field lain.
  const oneColumn = schema?.[group]?.columns === 1;
  const cacheKey = `${row.id}:${group}`;
  // Dibaca SEKALI saat komponen ini lahir. Sesudahnya yang berlaku adalah state di bawah — cache
  // hanya titipan antar-tab, bukan sumber kebenaran kedua yang bisa menyimpang darinya.
  const saved = cache?.current.get(cacheKey) || null;

  const [values, setValues] = useState(saved?.values ?? null);
  // Keadaan saat form dibuka, disimpan terpisah. Ini pembanding yang menentukan field mana yang
  // benar-benar diubah orang — dan POST plugin bersifat partial, jadi selisih itulah yang dikirim.
  const [original, setOriginal] = useState(saved?.original ?? null);
  const [readAt, setReadAt] = useState(saved?.readAt ?? "");
  const [loading, setLoading] = useState(!saved);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [bulk, setBulk] = useState(null);
  const [results, setResults] = useState(null);

  /**
   * `force` membedakan "buka tab" dari "muat ulang".
   *
   * Yang pertama tidak boleh menyentuh situs kalau isinya sudah ada — itu seluruh gunanya cache.
   * Yang kedua HARUS, dan ia perlu ada: begitu isinya bisa berumur, satu-satunya cara membaca
   * keadaan situs sekarang adalah tombol yang benar-benar memanggilnya lagi.
   */
  const load = useCallback(
    async (force = false) => {
      // Grup yang tidak ada di skema tidak bisa dibaca, dan `loading` WAJIB ikut turun di sini.
      // Dibiarkan menyala, tab-nya berhenti selamanya di "Membaca ... dari <situs>" — kalimat yang
      // menuduh situs WordPress yang sebenarnya tidak pernah dihubungi. Yang menerangkan sebabnya
      // penjaga di bagian render; yang ini cuma menahan spinner-nya.
      if (!fields.length) {
        setLoading(false);
        return;
      }
      if (!force && cache?.current.has(cacheKey)) return;

      setLoading(true);
      setError("");
      try {
        const data = await fetchPluginConfig(row.id, group);
        const form = toFormValues(fields, data);
        const stamp = new Date().toISOString();
        setValues(form);
        setOriginal(form);
        setReadAt(stamp);
      } catch (loadError) {
        setError(loadError.message);
      } finally {
        setLoading(false);
      }
    },
    [row.id, group, fields, cache, cacheKey],
  );

  useEffect(() => {
    load();
  }, [load]);

  // Tiap perubahan dititipkan ke cache, termasuk yang belum disimpan. Itu yang membuat suntikan
  // separuh jadi jalan bertahan saat orang melirik tab sebelah lalu kembali.
  useEffect(() => {
    if (!cache || !values || !original) return;
    cache.current.set(cacheKey, { values, original, readAt });
  }, [cache, cacheKey, values, original, readAt]);

  const changed = values && original ? changedValues(fields, values, original) : {};
  const dirty = values && original ? hasChanges(fields, values, original) : false;

  const save = async () => {
    setSaving(true);
    try {
      const res = await savePluginConfig(row.id, group, changed);
      const warning = unappliedMessage(res.unapplied, fields);
      // Bukan notifySuccess kalau ada yang tidak berubah: situsnya menjawab 200 dan amplop
      // `success: true` untuk nilai yang diabaikannya diam-diam, dan "Tersimpan." di sini akan jadi
      // satu-satunya hal yang dibaca orang sebelum menutup halaman.
      if (warning) notifyWarning(warning, res.unapplied);
      else notifySuccess(`${title} ${row.name} tersimpan.`);

      // Dibaca ulang dari jawaban situs, bukan dari apa yang diketik: yang ditolak diam-diam akan
      // kembali ke nilai lamanya di layar, jadi form tidak berbohong tentang keadaan situs.
      const form = toFormValues(fields, res.data);
      setValues(form);
      setOriginal(form);
    } catch (saveError) {
      notifyError(saveError, `${title} ${row.name} gagal disimpan.`);
    } finally {
      setSaving(false);
    }
  };

  if (!schema) return <EmptyMessage>Memuat skema pengaturan...</EmptyMessage>;

  /**
   * Skema sudah datang, tapi TIDAK memuat grup ini.
   *
   * Satu-satunya sebabnya: `PLUGIN_SCHEMA` di repo sudah punya grupnya, server kontrol yang
   * menjawab `GET /plugin/schema` belum — tab lahir dari daftar di browser, skemanya dari server,
   * dan keduanya berpindah ke produksi lewat deploy yang berbeda. Jendela itu akan terbuka lagi
   * tiap kali grup baru ditambahkan.
   *
   * Disebut sebagai keadaan tersendiri karena tak satu pun kalimat lain di layar ini benar untuk
   * situasi tersebut: situsnya tidak pernah dihubungi, jadi "gagal membaca dari <situs>" menuduh
   * WordPress yang sehat — dan tombol "Coba lagi" akan diklik berkali-kali untuk sesuatu yang cuma
   * bisa diperbaiki dengan deploy.
   */
  if (!fields.length) {
    return (
      <p className="plugin-alert">
        <TriangleAlert size={15} />
        <span>
          Server kontrol belum mengenal grup <code>{group}</code> — skema yang dikirimnya cuma
          memuat {Object.keys(schema).join(", ")}. Tab ini baru bisa dibuka setelah server kontrol
          di-deploy ulang; situsnya sendiri tidak sedang bermasalah.
        </span>
      </p>
    );
  }

  if (loading)
    return (
      <EmptyMessage>
        Membaca {title} dari {row.name}...
      </EmptyMessage>
    );

  if (error) {
    return (
      <div className="plugin-load-error">
        <p className="plugin-alert">
          <TriangleAlert size={15} />
          <span>{error}</span>
        </p>
        <button className="ghost-button" onClick={() => load(true)} type="button">
          <RefreshCw size={15} />
          <span>Coba lagi</span>
        </button>
      </div>
    );
  }

  return (
    <div aria-labelledby={`plugin-tab-${group}`} id={`plugin-panel-${group}`} role="tabpanel">
      <PluginGroupFields
        changed={changed}
        fields={fields}
        oneColumn={oneColumn}
        onChange={(name, next) => setValues((current) => ({ ...current, [name]: next }))}
        readOnly={!canManage}
        sections={schema?.[group]?.sections}
        values={values}
      />

      {canManage && (
        <div className="plugin-actions">
          {/* Jumlah field yang akan dikirim disebut, bukan disembunyikan. Ini satu-satunya tempat
              yang mengatakan bahwa simpan di sini TIDAK menulis seluruh form ke situs. */}
          <span className="muted-line">
            {dirty
              ? `${Object.keys(changed).length} field diubah — hanya itu yang dikirim ke situs.`
              : "Belum ada yang diubah."}
            {/* Umurnya disebut karena isinya tidak lagi dibaca tiap tab dibuka. Tanpa ini, cache
                berubah dari penghemat panggilan jadi cara menyembunyikan perubahan yang dibuat
                orang lain di situs yang sama. */}
            {readAt && ` Dibaca dari situs ${formatDateTime(readAt)}.`}
          </span>
          <div className="plugin-actions-buttons">
            <button
              className="ghost-button"
              disabled={loading}
              onClick={() => load(true)}
              title="Baca ulang pengaturan ini dari situsnya. Yang belum disimpan akan hilang."
              type="button"
            >
              <RefreshCw size={15} />
              <span>Muat ulang</span>
            </button>
            <button
              className="ghost-button"
              disabled={!dirty}
              onClick={() => setBulk(changed)}
              title={
                dirty
                  ? "Kirim perubahan yang sama ke beberapa situs sekaligus."
                  : "Ubah dulu sesuatu di form ini."
              }
              type="button"
            >
              <Send size={15} />
              <span>Terapkan ke situs lain...</span>
            </button>
            <button
              className="primary-button"
              disabled={!dirty || saving}
              onClick={save}
              type="button"
            >
              {saving ? "Menyimpan..." : "Simpan"}
            </button>
          </div>
        </div>
      )}

      {bulk && (
        <BulkApplyDialog
          // Situs yang sedang dibuka dikeluarkan dari daftar tujuan: perubahannya diterapkan lewat
          // tombol Simpan di sebelahnya, dan menawarkannya dua kali mengundang satu situs ditulis
          // dua kali dalam satu tindakan.
          rows={rows.filter((item) => item.enrolled && item.id !== row.id)}
          onClose={() => setBulk(null)}
          onDone={(payload) => {
            setResults(payload);
            setBulk(null);
          }}
          preset={{ group, values: bulk }}
          schema={schema}
        />
      )}

      {results && <BulkResultDialog onClose={() => setResults(null)} {...results} />}
    </div>
  );
}

// --- Satu kotak isian ------------------------------------------------------------------------------

/**
 * Digambar dari skema, bukan dari daftar yang ditulis ulang di sini.
 *
 * Kalau tipenya tidak dikenal, yang keluar adalah kotak teks biasa — bukan kotak yang hilang.
 * Server yang menambah field baru di skema langsung tampil di sini tanpa deploy frontend; field yang
 * tidak muncul sama sekali adalah cara sebuah pengaturan jadi tidak bisa diubah siapa pun tanpa ada
 * yang menyadarinya.
 */
// --- AutoPost ------------------------------------------------------------------------------------

/**
 * Suruh plugin menulis artikel dari sebuah kata kunci, lalu pantau job-nya.
 *
 * Tab ini BERBEDA dari empat tab pengaturan di sebelahnya dalam hal yang menentukan seluruh
 * bentuknya: tidak ada apa pun di situs yang dibacanya lebih dulu. Empat tab lain membuka diri
 * dengan memanggil situsnya, menampilkan keadaan yang tersimpan di sana, dan mengirim SELISIHNYA;
 * di sini tidak ada yang tersimpan — tiap pengiriman adalah permintaan baru yang berdiri sendiri,
 * dan yang tergambar saat tab dibuka adalah bawaan yang meniru layar `page=rabbitroi-auto-post`.
 *
 * Akibatnya tiga, dan semuanya terlihat di bawah:
 *
 *   1. **Tidak ada tombol "Muat ulang"** untuk formnya — tidak ada yang bisa dimuat ulang. Yang
 *      punya tombol segarkan cuma daftar job.
 *   2. **Tidak ada "terapkan ke situs lain".** Setelan di sini bukan sesuatu yang menempel di
 *      situs; menyalinnya ke sepuluh situs berarti menulis sepuluh artikel, bukan menyeragamkan
 *      sepuluh pengaturan — tindakan yang sama sekali berbeda dan tidak boleh memakai tombol yang
 *      sama.
 *   3. **Seluruh field dikirim, bukan yang berubah saja.** Dua bawaan REST berbeda dari yang
 *      tergambar (`generate_image`, `tag_otomatis` — keduanya `false` kalau tidak dikirim, keduanya
 *      menyala di form ini), jadi mengirim selisihnya berarti sakelar yang menyala menghasilkan
 *      artikel tanpa gambar dan tidak ada yang membedakan itu dari gagalnya scrape.
 */
function AutoPostManager({ row, schema, canManage, cache }) {
  const article = schema?.autopost || null;
  const keywordGroup = schema?.["autopost-keywords"] || null;

  const cacheKey = `${row.id}:autopost`;
  const saved = cache?.current.get(cacheKey) || null;

  /**
   * Kunci AI TIDAK ikut cache antar-tab dan TIDAK ikut alamat — ia dibaca dari localStorage
   * perangkat ini, dan hanya kalau orangnya pernah meminta diingat. Lihat catatan panjang di
   * src/lib/autopost.js.
   */
  const [aiKey, setAiKey] = useState(() => readStoredAiKey());
  const [remember, setRemember] = useState(() => readStoredAiKey() !== "");

  /**
   * Bawaan form diisi SAAT SKEMANYA DATANG, bukan saat komponen ini lahir.
   *
   * Skema diambil sekali per sesi lewat `GET /plugin/schema`, jadi pada render pertama ia masih
   * `null` — dan nilai awal yang dihitung di situ menghasilkan form KOSONG yang tidak pernah terisi
   * sesudahnya. Yang terlihat cuma kotak kosong; yang benar-benar terjadi adalah `bahasa: ""` dan
   * `gaya_bahasa: ""` ikut terkirim ke AI, karena form mengirim seluruh fieldnya dan bawaan di sisi
   * server hanya berlaku untuk field yang TIDAK ADA di body.
   */
  const [values, setValues] = useState(saved?.values ?? null);
  const [keywordValues, setKeywordValues] = useState(saved?.keywordValues ?? null);

  useEffect(() => {
    if (article) setValues((current) => current ?? autopostFormValues(article, toFormValue));
  }, [article]);

  useEffect(() => {
    if (keywordGroup) {
      setKeywordValues((current) => current ?? autopostFormValues(keywordGroup, toFormValue));
    }
  }, [keywordGroup]);
  // Daftar yang BENAR-BENAR dikirim, satu per baris. Dipegang sebagai teks dan bukan lewat skema:
  // ia bukan setelan melainkan isi permintaan, dan `list` di skema memecah per koma juga — yang
  // membelah kata kunci long-tail yang memang memuat koma jadi dua potongan tak berarti.
  const [keywordText, setKeywordText] = useState(() => saved?.keywordText ?? "");

  const [generating, setGenerating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [generated, setGenerated] = useState(saved?.generated ?? null);
  // Ikut cache: daftar kata kunci yang DITOLAK tidak tercatat di mana pun selain di sini — job-nya
  // tidak pernah lahir, jadi ia tidak akan muncul di daftar job berapa kali pun disegarkan.
  const [submitted, setSubmitted] = useState(saved?.submitted ?? null);

  const [jobs, setJobs] = useState(null);
  const [jobsError, setJobsError] = useState("");
  const [jobsAt, setJobsAt] = useState("");
  const [openJob, setOpenJob] = useState("");
  const [jobsBusy, setJobsBusy] = useState(true);
  /**
   * Putaran polling — SATU penggerak, dan ia sengaja bukan turunan dari `jobs`.
   *
   * Putaran yang GAGAL tidak mengubah `jobs` sama sekali (daftar lama sengaja dibiarkan berdiri),
   * jadi siklus yang digantungkan padanya berhenti selamanya begitu satu permintaan meleset — tanpa
   * satu pun tanda di layar selain daftar yang membeku. Angkanya juga yang melebarkan jedanya.
   */
  const [poll, setPoll] = useState(0);

  const keywords = useMemo(() => autopostKeywords(keywordText), [keywordText]);

  // Sepola dengan ConfigEditor: yang sedang diketik dititipkan supaya melirik tab sebelah tidak
  // membuang daftar kata kunci yang baru saja dibuat AI — panggilan yang memang ditagihkan.
  useEffect(() => {
    // Yang belum terisi tidak dititipkan: cache berisi `null` akan dibaca komponen berikutnya
    // sebagai "sudah ada nilainya" dan menahan efek pengisi bawaan di atas.
    if (!values || !keywordValues) return;
    cache?.current.set(cacheKey, { values, keywordValues, keywordText, generated, submitted });
  }, [cache, cacheKey, values, keywordValues, keywordText, generated, submitted]);

  /**
   * `quiet` membedakan pembacaan yang DIMINTA ORANG dari putaran polling.
   *
   * Tanpa itu, spinner di tombol Segarkan berkedip tiap tiga detik selama ada job berjalan — dan
   * indikator yang menyala terus-menerus berhenti berarti "sedang membaca sekarang". Yang perlu
   * dilihat orang adalah jawaban atas tombol yang baru saja ia tekan; putaran latar sudah punya
   * penjelasnya sendiri di kalimat "Daftar ini menyegarkan dirinya...".
   */
  const loadJobs = useCallback(
    async ({ quiet = false } = {}) => {
      if (!quiet) setJobsBusy(true);
      try {
        const data = await fetchPluginAutopostJobs(row.id, { limit: "50" });
        setJobs(data);
        setJobsAt(new Date().toISOString());
        setJobsError("");
        return data;
      } catch (error) {
        // Daftar yang sudah tergambar TIDAK dikosongkan — sepola dengan panel ad set dan DNS. Satu
        // polling yang gagal di tengah bukan alasan menghapus job yang jelas-jelas sedang berjalan;
        // yang berubah cuma umur bacaannya, dan itu disebutkan di atas tabel.
        setJobsError(error.message);
        return null;
      } finally {
        if (!quiet) setJobsBusy(false);
      }
    },
    [row.id],
  );

  // Muat pertama (putaran nol) lalu tiap putaran polling. Yang pertama bersuara — halaman baru
  // dibuka dan belum ada apa pun di layar; sisanya diam.
  useEffect(() => {
    loadJobs({ quiet: poll > 0 });
  }, [loadJobs, poll]);

  /**
   * Polling — BERHENTI SENDIRI begitu tidak ada job berjalan.
   *
   * Itu syaratnya boleh ada sama sekali: tab yang dibiarkan terbuka semalaman tidak boleh terus
   * memanggil situsnya sampai pagi. Job yang mati tanpa kabar tetap berakhir — plugin
   * memindahkannya ke `stalled` sendiri setelah `stale_seconds` — jadi siklus ini punya ujung walau
   * tidak ada satu pun job yang selesai dengan benar.
   *
   * Jedanya melebar mengikuti `poll` (lihat `nextPollDelay`): tahap terpanjang menunggu jawaban AI
   * sampai dua menit tanpa satu pun perubahan yang terbaca, dan bertanya empat puluh kali selama
   * itu adalah empat puluh permintaan ke shared hosting yang sedang menulis artikel.
   */
  useEffect(() => {
    const delay = nextPollDelay(jobs?.jobs, poll);
    if (!delay) return undefined;
    const timer = setTimeout(() => setPoll((round) => round + 1), delay);
    return () => clearTimeout(timer);
  }, [jobs, poll]);

  // Dinolkan tiap kali daftarnya ditanyakan atas permintaan orang — tombol Segarkan dan pengiriman
  // baru. Tanpa itu, job yang baru saja dikirim menunggu jeda lima belas detik yang lahir dari
  // menit-menit sebelumnya, dan tombolnya terbaca seperti tidak melakukan apa-apa.
  const refreshJobs = useCallback(() => {
    setPoll(0);
    return loadJobs();
  }, [loadJobs]);

  const rememberKey = (next, checked) => {
    setRemember(checked);
    writeStoredAiKey(checked ? next : "");
  };

  const generate = async () => {
    setGenerating(true);
    try {
      const result = await generatePluginKeywords(row.id, aiKey, keywordValues);
      setGenerated(result);
      /**
       * DITAMBAHKAN ke daftar yang sudah ada, bukan menimpanya.
       *
       * Membuat kata kunci adalah panggilan AI yang ditagihkan tiap kali; daftar yang ditimpa
       * berarti hasil panggilan sebelumnya — yang sudah dibayar — hilang karena seseorang menekan
       * tombolnya sekali lagi dengan kata dasar yang lain. `autopostKeywords` yang membuang
       * duplikatnya, jadi menekan tombol yang sama dua kali tidak menggandakan apa pun.
       */
      const merged = autopostKeywords([...keywords, ...result.keywords]);
      setKeywordText(merged.join("\n"));

      // Bukan notifySuccess kalau yang datang lebih sedikit dari yang diminta. AI kerap
      // mengembalikan kurang, dan daftar 13 baris untuk 20 yang diminta tampak lengkap — selisihnya
      // tidak berbunyi sebagai apa pun kecuali disebutkan di sini.
      if (result.requested && result.total < result.requested) {
        notifyWarning(
          `AI mengembalikan ${result.total} kata kunci dari ${result.requested} yang diminta.`,
        );
      } else {
        notifySuccess(`${result.total} kata kunci dibuat.`);
      }
    } catch (error) {
      notifyError(error, "Pembuatan kata kunci gagal.");
    } finally {
      setGenerating(false);
    }
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      const result = await submitPluginAutopost(row.id, aiKey, keywords, values);
      setSubmitted(result);

      /**
       * Yang job-nya lahir DIBUANG dari kotak isian; yang ditolak tetap berdiri.
       *
       * Itu yang membuat "perbaiki lalu kirim lagi" jadi satu tindakan alih-alih mengetik ulang —
       * dan yang menahannya jadi berbahaya: AutoPost tidak punya dedup, jadi menekan Kirim untuk
       * daftar yang isinya tidak berubah menghasilkan artikel KEDUA untuk tiap kata kunci yang
       * sudah berhasil. Sebelum ini, satu-satunya yang mencegahnya adalah ingatan orang tentang
       * baris mana saja yang tadi gagal.
       *
       * Lewat updater, bukan dari `keywords` yang tertangkap saat tombolnya ditekan: pengiriman
       * lima puluh kata kunci berlangsung beberapa detik, dan yang diketik orang ke kotak itu
       * selama menunggu tidak boleh ikut terhapus.
       */
      setKeywordText((current) => dropPostedKeywords(current, postedKeywords(result.results)));

      const { tone, message } = submitMessage(result.summary, row.name);
      if (tone === "success") notifySuccess(message);
      else if (tone === "warning") notifyWarning(message);
      else notifyError(new Error(message), "");
      // Job-nya sudah lahir di sisi situs, jadi daftarnya dibaca ulang seketika — tanpa itu, yang
      // baru saja dikirim baru muncul di putaran polling berikutnya dan tombolnya terbaca seperti
      // tidak melakukan apa-apa.
      await refreshJobs();
    } catch (error) {
      // Kotak isian TIDAK disentuh di sini, dan itu bukan kelalaian: yang sampai ke cabang ini
      // ditolak SEBELUM satu job pun dikirim (setelan yang tidak sah, kunci situs yang hilang,
      // jaringan yang putus) — `submitAutopost` menyusun payload seluruh daftar di depan justru
      // supaya tidak ada artikel yang terlanjur dibuat. Membuang apa pun dari daftar di sini berarti
      // menghapus kata kunci yang tidak pernah terkirim ke mana-mana.
      notifyError(error, `Pengiriman ke ${row.name} gagal.`);
    } finally {
      setSubmitting(false);
    }
  };

  if (!schema) return <EmptyMessage>Memuat skema pengaturan...</EmptyMessage>;

  /**
   * Skema sudah datang tapi tidak memuat AutoPost — server kontrol belum di-deploy ulang.
   *
   * Disebut sebagai keadaan tersendiri dengan alasan yang sama persis seperti di `ConfigEditor`:
   * situsnya tidak pernah dihubungi, jadi kalimat apa pun yang menyebut situs akan menuduh
   * WordPress yang sehat.
   */
  if (!article || !keywordGroup) {
    return (
      <p className="plugin-alert">
        <TriangleAlert size={15} />
        <span>
          Server kontrol belum mengenal AutoPost — skema yang dikirimnya cuma memuat{" "}
          {Object.keys(schema).join(", ")}. Tab ini baru bisa dipakai setelah server kontrol
          di-deploy ulang; situsnya sendiri tidak sedang bermasalah.
        </span>
      </p>
    );
  }

  const tooMany = keywords.length > AUTOPOST_MAX_KEYWORDS;
  const ready = canManage && aiKey.trim() !== "" && keywords.length > 0 && !tooMany;

  return (
    <div
      aria-labelledby="plugin-tab-autopost"
      className="autopost-layout"
      id="plugin-panel-autopost"
      role="tabpanel"
    >
      {/* DUA kolom: yang disusun di kiri, yang sudah terkirim di kanan.
          Bertumpuk, daftar job berdiri di bawah form setinggi dua layar — dan yang paling perlu
          dilihat setelah menekan Kirim justru ada di luar layar, jadi satu-satunya cara mengetahui
          job-nya benar-benar lahir adalah menggulir turun tiap kali. Berdampingan, tombol Kirim
          dan baris job pertamanya tergambar bersamaan. Di bawah 1180px keduanya kembali bertumpuk
          — batas yang sama dengan Kalender, dan alasan yang sama: dua kolom di layar sempit
          menyisakan tabel selebar empat kata. */}
      <div className="autopost-form">
        {/* Kata Kunci berdiri PALING ATAS: ia yang menentukan berapa artikel yang lahir, sementara
            seluruh fieldset di bawahnya cuma menentukan bentuk tiap artikelnya. Kunci AI ikut di
            sini dan bukan di fieldset sendiri karena ia yang pertama diisi — pembuatan kata kunci
            sudah membutuhkannya, sebelum satu setelan artikel pun disentuh. */}
        <fieldset className="plugin-fieldset">
          <legend>Kata Kunci</legend>

          <div className="form-grid plugin-form-single">
            <div className="field plugin-field-wide">
              <label htmlFor="autopost-ai-key">
                Kunci API AI
                <ColumnHint
                  icon="info"
                  text="Dipakai untuk membuat kata kunci DAN menulis artikelnya. Providernya dibaca dari awalan kunci itu sendiri: sk-ant- Claude, gsk_ Groq, sk-proj- OpenAI, sk- lainnya Qwen, tanpa awalan yang cocok Gemini."
                />
              </label>
              <input
                autoComplete="off"
                className="control"
                disabled={!canManage}
                id="autopost-ai-key"
                onChange={(event) => {
                  setAiKey(event.target.value);
                  if (remember) writeStoredAiKey(event.target.value);
                }}
                placeholder="AIzaSy... / sk-ant-... / gsk_... / sk-proj-..."
                // `password`: kunci ini ditagihkan per panggilan kepada pemiliknya, dan tab ini
                // dibuka di layar yang sering dibagikan lewat screen sharing.
                type="password"
                value={aiKey}
              />
              <Switch
                checked={remember}
                className="plugin-remember"
                disabled={!canManage}
                hint="Disimpan di perangkat ini saja — tidak pernah masuk database dashboard maupun alamat halaman."
                label="Ingat di browser ini"
                onChange={(next) => rememberKey(aiKey, next)}
              />
            </div>

            {keywordGroup.fields.map((field) => (
              <FieldInput
                changed={false}
                field={field}
                fields={keywordGroup.fields}
                key={field.name}
                onChange={(next) =>
                  setKeywordValues((current) => ({ ...current, [field.name]: next }))
                }
                onChangeField={(name, next) =>
                  setKeywordValues((current) => ({ ...current, [name]: next }))
                }
                readOnly={!canManage}
                value={keywordValues?.[field.name]}
                values={keywordValues}
              />
            ))}

            {canManage && (
              <div className="field plugin-field-wide">
                <button
                  className="ghost-button"
                  disabled={
                    generating ||
                    !aiKey.trim() ||
                    // `?.` bukan hiasan: `keywordValues` sengaja `null` sampai skemanya datang dari
                    // server (lihat catatan pengisi bawaan di atas), dan tombol ini digambar pada
                    // render pertama — sebelum itu.
                    !String(keywordValues?.base_keyword || "").trim()
                  }
                  onClick={generate}
                  title="Satu panggilan AI, 5–20 detik. Hasilnya ditambahkan ke daftar di bawah."
                  type="button"
                >
                  <Sparkles size={15} />
                  <span>{generating ? "Membuat kata kunci..." : "Buat kata kunci"}</span>
                </button>
              </div>
            )}

            <div className="field plugin-field-wide">
              <label htmlFor="autopost-keywords">
                Daftar kata kunci
                <span className="plugin-field-unit">(satu per baris)</span>
                <ColumnHint
                  icon="info"
                  text="Tiap baris jadi satu job dan satu artikel. Duplikat dibuang tanpa memandang kapitalisasi — AutoPost sendiri tidak punya dedup, jadi kata kunci yang sama dikirim dua kali menghasilkan dua artikel."
                />
              </label>
              <textarea
                className="control plugin-textarea"
                disabled={!canManage}
                id="autopost-keywords"
                onChange={(event) => setKeywordText(event.target.value)}
                rows={8}
                value={keywordText}
              />
              <small className="muted-line plugin-field-help">
                {/* Jumlahnya disebut karena tiap barisnya jadi satu artikel — dan AutoPost TIDAK punya
                  dedup: kata kunci yang sama dikirim dua kali menghasilkan dua artikel. Yang
                  dihitung di sini sudah dibuang duplikatnya, jadi angka ini yang benar-benar akan
                  dikirim, bukan jumlah baris di kotaknya. */}
                {keywords.length
                  ? `${keywords.length} kata kunci — sebanyak itu artikel yang akan ditulis, satu job masing-masing.`
                  : "Belum ada kata kunci. Ketik sendiri, atau buat lewat tombol di atas."}
                {generated?.requested && generated.requested !== generated.total
                  ? ` Pembuatan terakhir: ${generated.total} dari ${generated.requested} yang diminta.`
                  : ""}
              </small>
              {tooMany && (
                <p className="plugin-alert plugin-alert-inline">
                  <TriangleAlert size={15} />
                  <span>
                    {keywords.length} kata kunci sekaligus terlalu banyak untuk satu situs —
                    maksimal {AUTOPOST_MAX_KEYWORDS} per pengiriman. Tiap job adalah satu proses PHP
                    yang hidup sampai artikelnya selesai; kirim sisanya setelah gelombang ini beres.
                  </span>
                </p>
              )}
            </div>
          </div>
        </fieldset>

        {groupFields(article.fields).map((section) => (
          <fieldset className="plugin-fieldset" key={section.name}>
            <legend>{section.name}</legend>
            <div className="form-grid">
              {section.fields.map((field) => (
                <FieldInput
                  changed={false}
                  field={field}
                  fields={article.fields}
                  key={field.name}
                  onChange={(next) => setValues((current) => ({ ...current, [field.name]: next }))}
                  onChangeField={(name, next) =>
                    setValues((current) => ({ ...current, [name]: next }))
                  }
                  readOnly={!canManage}
                  value={values?.[field.name]}
                  values={values}
                />
              ))}
            </div>
          </fieldset>
        ))}

        {canManage && (
          <div className="plugin-actions">
            <span className="muted-line">
              {/* Yang dijanjikan tombolnya disebut apa adanya: situs MENERIMA permintaan, artikelnya
                menyusul. Jawaban 202 datang sebelum satu kata pun ditulis, dan "3 artikel dibuat"
                akan diadu orang dengan daftar postingnya beberapa detik kemudian. */}
              {keywords.length
                ? `${keywords.length} job akan dibuat di ${row.name}. Situs menjawab begitu permintaannya diterima — artikelnya ditulis di latar dan bisa beberapa menit.`
                : "Isi daftar kata kunci dulu."}
            </span>
            <div className="plugin-actions-buttons">
              <button
                className="primary-button"
                disabled={!ready || submitting}
                onClick={submit}
                type="button"
              >
                <Send size={15} />
                <span>
                  {submitting ? "Mengirim..." : `Kirim ${keywords.length || ""} kata kunci`.trim()}
                </span>
              </button>
            </div>
          </div>
        )}

        {/* Yang DITOLAK sebelum jadi job berdiri terpisah dari daftar job di bawahnya, dan itu bukan
          kerapian: job yang lahir punya `job_id` dan bisa dipantau, sementara yang ditolak tidak
          ada di sisi situs sama sekali — dicampur, satu daftar akan memuat baris yang tidak akan
          pernah berubah statusnya. */}
        {submitted?.results?.some((item) => item.status === "failed") && (
          <div className="plugin-alert">
            <TriangleAlert size={15} />
            <span>
              {submitted.summary.failed} kata kunci ditolak situs dan tidak menjadi job. Semuanya
              masih berdiri di daftar di atas — perbaiki sebabnya lalu tekan Kirim lagi; yang sudah
              berhasil sudah dibuang dari sana, jadi tidak ada yang terkirim dua kali.{" "}
              {submitted.results
                .filter((item) => item.status === "failed")
                .map((item) => `"${item.keyword}" (${item.error})`)
                .join("; ")}
            </span>
          </div>
        )}
      </div>

      <AutoPostJobs
        busy={jobsBusy}
        error={jobsError}
        onOpen={setOpenJob}
        onRefresh={refreshJobs}
        openJob={openJob}
        readAt={jobsAt}
        row={row}
        state={jobs}
      />
    </div>
  );
}

/**
 * Daftar job satu situs.
 *
 * TIDAK dicerminkan ke RTDB — sepola dengan panel ad set dan tab DNS Record, dan dengan alasan yang
 * sama: yang dicari orang di sini adalah keadaan pada detik ini, dan cermin sejam lalu justru
 * jawaban yang salah. Ditambah satu yang khusus di sini: masa simpan job di sisi plugin cuma 24
 * jam, jadi mencerminkannya berarti dashboard menyimpan riwayat yang sumbernya sudah tidak ada
 * untuk dibandingkan.
 */
function AutoPostJobs({ state, error, readAt, row, openJob, onOpen, onRefresh, busy }) {
  const jobs = state?.jobs || [];
  const running = runningJobs(jobs);
  // Urutan baris adalah urutan situs (job terbaru dulu), dan daftarnya dibaca ulang tiap beberapa
  // detik selama ada yang berjalan — jadi kepala kolomnya tidak mengurutkan apa pun.
  const jobColumns = [
    {
      id: "keyword",
      header: "Kata Kunci",
      enableSorting: false,
      cell: ({ row: tableRow }) => {
        const job = tableRow.original;
        const open = openJob === job.jobId;
        return (
          <>
            <button
              className="plugin-job-open"
              onClick={() => onOpen(open ? "" : job.jobId)}
              type="button"
            >
              {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <span>{job.keyword || "(tanpa kata kunci)"}</span>
            </button>
            {/* `source` membedakan job yang dikirim dari sini (`rest`) dari yang dijalankan operator
                lewat wp-admin (`admin`). Keduanya berbagi penyimpanan yang sama, jadi tanpa penanda
                ini panel akan terbaca seolah dashboard membuat job yang tidak pernah dikirimnya. */}
            {job.source === "admin" && <span className="badge neutral">wp-admin</span>}
          </>
        );
      },
    },
    {
      id: "status",
      header: "Status",
      enableSorting: false,
      cell: ({ row: tableRow }) => {
        const job = tableRow.original;
        return (
          <>
            <span className={`badge ${jobTone(job)}`}>{jobLabel(job)}</span>
            {/* "Berhenti" punya kalimatnya sendiri: prosesnya dibunuh server, bukan permintaannya
                yang salah — dan yang perlu dilakukan cuma mengirimnya lagi. */}
            {job.stalled && (
              <small className="muted-line">
                Prosesnya berhenti tanpa kabar di sisi situs — kirim ulang kata kuncinya.
              </small>
            )}
          </>
        );
      },
    },
    {
      id: "stage",
      header: "Tahap",
      enableSorting: false,
      cell: ({ row: tableRow }) => (
        <div className="plugin-job-stage">
          <span>{tableRow.original.stageLabel || tableRow.original.stage || "-"}</span>
          <span className="muted-line">{tableRow.original.progress}%</span>
        </div>
      ),
    },
    {
      id: "createdAt",
      header: "Dibuat",
      enableSorting: false,
      cell: ({ row: tableRow }) =>
        tableRow.original.createdAt
          ? formatDateTime(new Date(tableRow.original.createdAt * 1000).toISOString())
          : "-",
    },
    {
      id: "result",
      header: "Hasil",
      enableSorting: false,
      cell: ({ row: tableRow }) => {
        const job = tableRow.original;
        if (job.permalink) {
          // Tautan ke artikel yang benar-benar jadi. `rel` lengkap karena tujuannya situs lain
          // yang kontennya baru saja ditulis AI.
          return (
            <a href={job.permalink} rel="noreferrer noopener" target="_blank">
              <Link2 size={14} />
              <span>Lihat artikel</span>
            </a>
          );
        }
        if (job.status === "failed") {
          return <span className="muted-line">{job.finalMessage || job.message || "Gagal."}</span>;
        }
        // Job yang masih berjalan belum punya hasil, dan `message`-nya pada tahap ini SELALU
        // sama dengan `stage_label` yang sudah berdiri di kolom Tahap — digambar di sini, satu
        // kalimat yang sama muncul dua kali dalam satu baris dan kolom Hasil berhenti berarti
        // "hasilnya".
        return <span className="muted-line">-</span>;
      },
    },
  ];

  return (
    <section className="plugin-jobs">
      <div className="panel-header">
        <div>
          <h3>Job AutoPost</h3>
          <p className="muted-line">
            {state
              ? `${jobs.length} job terbaru di ${row.name} — ${state.summary.running} berjalan, ${state.summary.done} selesai, ${state.summary.failed} gagal.`
              : `Membaca job dari ${row.name}...`}
            {/* Masa simpannya disebut karena panel ini bukan arsip: baris job dihapus cron di situs
                setelah 24 jam, dan daftar yang memendek sendiri tanpa keterangan terbaca seperti
                job yang hilang. */}
            {" Job disimpan 24 jam di situsnya, lalu dihapus."}
            {readAt && ` Dibaca ${formatDateTime(readAt)}.`}
            {running > 0 && " Daftar ini menyegarkan dirinya selama masih ada yang berjalan."}
          </p>
        </div>
        {/* Ikonnya BERPUTAR selama pembacaan berjalan, bukan cuma tombolnya dimatikan. Panel ini
            membaca situs WordPress lewat server kontrol — sedetik lebih di shared hosting — dan
            tombol yang cuma jadi abu-abu tidak bisa dibedakan dari tombol yang memang tidak boleh
            ditekan. `.icon-spin` yang sama dengan indikator sync di topbar; ia berhenti sendiri di
            bawah `prefers-reduced-motion`. */}
        <RefreshButton busy={busy} onClick={onRefresh} />
      </div>

      {error && (
        <p className="plugin-alert">
          <TriangleAlert size={15} />
          <span>{error}</span>
        </p>
      )}

      {/* Selama bacaan PERTAMA belum datang, tabelnya tidak digambar sama sekali — bukan digambar
          sebagai kepala tabel di atas badan kosong, yang terbaca persis seperti "tidak ada job".
          Yang menerangkan keadaannya kalimat di kepala panel plus spinner di tombolnya. Bacaan
          BERIKUTNYA tidak mengosongkan apa pun: daftar lama tetap berdiri sampai ada penggantinya. */}
      {!state ? null : !jobs.length ? (
        <EmptyMessage>
          Belum ada job dalam 24 jam terakhir — termasuk yang dijalankan lewat wp-admin situs itu.
        </EmptyMessage>
      ) : (
        <DataTable
          className="plugin-job-table"
          columns={jobColumns}
          // Baris yang dibuka menggambar lognya tanpa kelas `data-table-expanded`: padding dan
          // latarnya milik `.plugin-job-logs` di dalamnya.
          expanded={openJob ? { [openJob]: true } : {}}
          expandedRowClassName=""
          getRowId={(job) => String(job.jobId)}
          items={jobs}
          renderExpanded={(job) => <AutoPostJobLogs job={job} row={row} />}
        />
      )}
    </section>
  );
}

function AutoPostJobLogs({ job, row }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  /**
   * Log dibaca SAAT barisnya dibuka (komponen ini baru dipasang saat itu), bukan ikut daftarnya.
   *
   * `/jobs` tanpa `include_logs` mengganti `logs` dengan `log_count`, dan itu yang dipakai polling:
   * satu job yang berjalan lima menit menumpuk puluhan baris, dan menariknya ulang tiap tiga detik
   * untuk dua puluh job memindahkan ratusan kilobyte demi satu kolom persentase yang bergerak.
   *
   * `job.updatedAt` ada di daftar dependensi dengan SENGAJA walau badan efek ini tidak membacanya:
   * ia detak job-nya — naik tiap tahap dan tiap baris log baru — jadi ia yang memicu penarikan
   * ulang. Dibuang, baris yang dibuka selagi job-nya berjalan membeku di log saat ia pertama kali
   * dibuka, persis pada job yang paling perlu dibaca lognya.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: `job.updatedAt` adalah pemicunya, bukan bacaannya
  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchPluginAutopostJob(row.id, job.jobId)
      .then((data) => alive && setDetail(data))
      .catch((readError) => alive && setError(readError.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [row.id, job.jobId, job.updatedAt]);

  const logs = detail?.logs?.length ? detail.logs : job.logs;

  return (
    <div className="plugin-job-logs">
      {loading && !logs.length ? (
        <p className="muted-line">Membaca log job...</p>
      ) : error ? (
        <p className="plugin-alert plugin-alert-inline">
          <TriangleAlert size={15} />
          <span>{error}</span>
        </p>
      ) : logs.length ? (
        <ol>
          {logs.map((line, index) => (
            // Log adalah daftar berurut yang barisnya boleh berulang persis (percobaan
            // ulang menulis kalimat yang sama), jadi kuncinya posisi — bukan isinya.
            // biome-ignore lint/suspicious/noArrayIndexKey: barisnya bisa identik
            <li key={index}>{line}</li>
          ))}
        </ol>
      ) : (
        <p className="muted-line">Job ini belum menulis satu baris log pun.</p>
      )}
    </div>
  );
}

// --- Landing page ------------------------------------------------------------------------------------

/**
 * Daftar landing satu situs, dan form untuk membuat/mengubahnya.
 *
 * Field yang ditawarkan bukan seluruh Lampiran A — lihat `LANDING_FIELDS` di
 * functions/plugin-core.js untuk alasannya. Yang tidak ada di form tetap seperti semula di situs,
 * karena POST-nya partial.
 */
function LandingManager({ row, schema, canManage, cache }) {
  const fields = schema?.landing?.fields || [];
  // Sepola dengan ConfigEditor: daftar landing ikut disimpan supaya pindah tab tidak memanggil
  // situsnya lagi. Kuncinya dibedakan dari kunci tab pengaturan supaya keduanya tidak saling timpa.
  const cacheKey = `${row.id}:landing`;
  const saved = cache?.current.get(cacheKey) || null;

  const [list, setList] = useState(saved?.list ?? []);
  const [loading, setLoading] = useState(!saved);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null);
  const [link, setLink] = useState(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(
    async (force = false) => {
      if (!force && cache?.current.has(cacheKey)) return;

      setLoading(true);
      setError("");
      try {
        const rows = await fetchPluginLandings(row.id);
        setList(rows);
        cache?.current.set(cacheKey, { list: rows });
      } catch (loadError) {
        setError(loadError.message);
      } finally {
        setLoading(false);
      }
    },
    [row.id, cache, cacheKey],
  );

  useEffect(() => {
    load();
  }, [load]);

  const open = async (landingId) => {
    // Daftar hanya membawa lima kolom; form butuh baris penuh, dan itu permintaan terpisah di
    // API-nya. Diisi dari baris daftar saja, setiap simpan akan mengirim field kosong untuk
    // sesuatu yang sebenarnya ada isinya di situs.
    try {
      const data = await fetchPluginLanding(row.id, landingId);
      setEditing(toFormValues(fields, data));
      setEditing((current) => ({ ...current, id: String(landingId) }));
    } catch (openError) {
      notifyError(openError, `Landing ${landingId} gagal dibuka.`);
    }
  };

  // Preset "Buat LP Baru": slug + parameter diacak situs, tautannya langsung ditampilkan.
  const createPreset = async () => {
    setCreating(true);
    try {
      setLink(await createPluginLandingPreset(row.id));
      load(true);
    } catch (createError) {
      notifyError(createError, `Landing di ${row.name} gagal dibuat.`);
    } finally {
      setCreating(false);
    }
  };

  const openLink = async (landingId) => {
    try {
      setLink(await fetchPluginLandingLink(row.id, landingId));
    } catch (linkError) {
      notifyError(linkError, `Tautan landing ${landingId} gagal dibaca.`);
    }
  };

  if (!schema) return <EmptyMessage>Memuat skema pengaturan...</EmptyMessage>;

  if (editing) {
    return (
      <LandingForm
        fields={fields}
        onCancel={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          // Paksa: yang baru saja berubah ada di situs, bukan di salinan yang kita pegang.
          load(true);
        }}
        row={row}
        values={editing}
      />
    );
  }

  return (
    <div aria-labelledby="plugin-tab-landing" id="plugin-panel-landing" role="tabpanel">
      <div className="plugin-actions">
        <span className="muted-line">
          {loading ? "Membaca daftar landing..." : `${list.length} landing di ${row.name}.`}
        </span>
        <div className="plugin-actions-buttons">
          <button className="ghost-button" onClick={() => load(true)} type="button">
            <RefreshCw size={15} />
            <span>Muat ulang</span>
          </button>
          {canManage && (
            <button
              className="primary-button"
              disabled={creating}
              onClick={createPreset}
              title="Preset halaman Buat LP Baru: slug & parameter acak, 120 video, 30 gambar, 100 URL artikel."
              type="button"
            >
              {creating ? "Membuat..." : "Buat dari preset"}
            </button>
          )}
          {canManage && (
            <button
              className="ghost-button"
              onClick={() => setEditing(toFormValues(fields, {}))}
              type="button"
            >
              Landing manual
            </button>
          )}
        </div>
      </div>

      {error && (
        <p className="plugin-alert">
          <TriangleAlert size={15} />
          <span>{error}</span>
        </p>
      )}

      <DataTable
        columns={[
          { accessorKey: "id", header: "ID", cell: ({ row: tableRow }) => tableRow.original.id },
          {
            accessorKey: "slug",
            header: "Slug",
            cell: ({ row: tableRow }) => tableRow.original.slug || "-",
          },
          {
            accessorKey: "title",
            header: "Judul",
            cell: ({ row: tableRow }) => tableRow.original.title || "-",
          },
          {
            accessorKey: "templateFile",
            header: "Template",
            cell: ({ row: tableRow }) => tableRow.original.templateFile || "-",
          },
          {
            id: "active",
            header: "Status",
            cell: ({ row: tableRow }) => (
              <span className={`badge ${tableRow.original.active ? "success" : "neutral"}`}>
                {tableRow.original.active ? "Aktif" : "Nonaktif"}
              </span>
            ),
            meta: { sortValue: (landing) => (landing.active ? "Aktif" : "Nonaktif") },
          },
          {
            id: "actions",
            header: "Aksi",
            enableSorting: false,
            cell: ({ row: tableRow }) => (
              <span className="plugin-actions-buttons">
                <button
                  className="ghost-button"
                  onClick={() => openLink(tableRow.original.id)}
                  type="button"
                >
                  <Link2 size={14} />
                  <span>Tautan</span>
                </button>
                <button
                  className="ghost-button"
                  onClick={() => open(tableRow.original.id)}
                  type="button"
                >
                  {canManage ? "Ubah" : "Lihat"}
                </button>
              </span>
            ),
            meta: { align: "right" },
          },
        ]}
        dense
        emptyText={loading ? "Memuat..." : "Belum ada landing di situs ini."}
        getRowId={(landing) => String(landing.id)}
        items={list}
      />
      {link && <LandingLinkDialog link={link} onClose={() => setLink(null)} subdomainId={row.id} />}
    </div>
  );
}

function LandingForm({ row, fields, values, onCancel, onSaved }) {
  const [form, setForm] = useState(values);
  const [saving, setSaving] = useState(false);
  const isNew = !form.id;
  // Landing BARU mengirim seluruh form; yang lama hanya selisihnya. Bedanya bukan gaya: create
  // tanpa slug ditolak situs, sementara update yang mengirim seluruh form akan menimpa field yang
  // tidak disentuh siapa pun dengan nilai yang dibaca beberapa menit lalu.
  const changed = isNew ? form : changedValues(fields, form, values);
  const dirty = isNew ? Boolean(form.slug) : Object.keys(changed).length > 0;

  const save = async () => {
    setSaving(true);
    try {
      const res = await savePluginLanding(row.id, {
        ...changed,
        ...(isNew ? {} : { id: form.id }),
      });
      const warning = unappliedMessage(res.unapplied, fields);
      if (warning) notifyWarning(warning, res.unapplied);
      else notifySuccess(isNew ? `Landing ${res.id} dibuat.` : `Landing ${res.id} tersimpan.`);
      onSaved();
    } catch (error) {
      notifyError(error, `Landing di ${row.name} gagal disimpan.`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="plugin-actions">
        <span className="muted-line">
          {isNew ? `Landing baru di ${row.name}. Slug wajib diisi.` : `Landing #${form.id}`}
        </span>
        <div className="plugin-actions-buttons">
          <button className="ghost-button" onClick={onCancel} type="button">
            Kembali
          </button>
          <button
            className="primary-button"
            disabled={!dirty || saving}
            onClick={save}
            type="button"
          >
            {saving ? "Menyimpan..." : isNew ? "Buat landing" : "Simpan"}
          </button>
        </div>
      </div>

      {groupFields(fields).map((section) => (
        <fieldset className="plugin-fieldset" key={section.name}>
          <legend>{section.name}</legend>
          <div className="form-grid">
            {section.fields.map((field) => (
              <FieldInput
                changed={Object.hasOwn(isNew ? {} : changed, field.name)}
                field={field}
                key={field.name}
                onChange={(next) => setForm((current) => ({ ...current, [field.name]: next }))}
                value={form[field.name]}
              />
            ))}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

/**
 * Dialog ganti versi plugin.
 *
 * Aksi paling merusak di halaman ini, dan dialognya dibentuk untuk itu. Yang diganti bukan sebuah
 * pengaturan melainkan PLUGIN-nya sendiri, di situs yang sedang menerima trafik berbayar — dan
 * sebuah pemasangan yang gagal separuh jalan bisa meninggalkan situs tanpa plugin yang bekerja.
 *
 * Kosong berarti rilis stabil terbaru. Itu ditawarkan sebagai pilihan yang berdiri sendiri, bukan
 * sebagai kotak yang dibiarkan kosong: "kosong" terbaca seperti belum diisi, dan menekan tombol
 * dalam keadaan itu terasa seperti kecelakaan alih-alih pilihan.
 */
function VersionDialog({ rows, onClose, onDone }) {
  const [mode, setMode] = useState("latest");
  const [version, setVersion] = useState("");
  const [running, setRunning] = useState(false);

  const wanted = mode === "latest" ? "" : version.trim();
  // Diperiksa di sini juga, bukan cuma di server: kesalahan ketik yang bisa dibetulkan di kotak
  // yang sedang terbuka tidak perlu perjalanan bolak-balik ke tiga puluh situs untuk ketahuan.
  const versionOk = mode === "latest" || /^v?\d+\.\d+(\.\d+)?$/.test(wanted);

  const run = async () => {
    setRunning(true);
    try {
      const res = await updatePluginSites(
        rows.map((row) => row.id),
        wanted,
      );
      const label = wanted ? `Versi ${wanted}` : "Versi terbaru";
      const { tone, message } = bulkMessage(res.summary, label);
      if (tone === "success") notifySuccess(message);
      else notifyWarning(message, res.summary);
      onDone({ title: `${label} — ganti versi`, rows: res.results, summary: res.summary });
    } catch (error) {
      notifyError(error, "Ganti versi gagal dijalankan.");
      setRunning(false);
    }
  };

  return (
    <Dialog
      className="confirm-dialog plugin-dialog"
      busy={running}
      onClose={onClose}
      subtitle={<>{rows.length} situs terpilih.</>}
      title="Ganti versi plugin"
    >
      <p className="plugin-alert">
        <TriangleAlert size={15} />
        <span>
          Ini mengganti plugin di situs yang sedang menerima trafik iklan berbayar. Pemasangan
          memakan waktu dan bisa gagal separuh jalan — jalankan pada beberapa situs dulu, jangan
          seluruh armada sekaligus.
        </span>
      </p>

      <div className="plugin-radio-group">
        <label className="plugin-radio">
          <input
            checked={mode === "latest"}
            disabled={running}
            name="plugin-version-mode"
            onChange={() => setMode("latest")}
            type="radio"
          />
          <span>
            <strong>Rilis stabil terbaru</strong>
            <small className="muted-line">
              Tiap situs mengambil rilis terbaru yang tersedia untuknya.
            </small>
          </span>
        </label>

        <label className="plugin-radio">
          <input
            checked={mode === "pinned"}
            disabled={running}
            name="plugin-version-mode"
            onChange={() => setMode("pinned")}
            type="radio"
          />
          <span>
            <strong>Versi tertentu</strong>
            <small className="muted-line">
              Dipakai untuk menyamakan armada, atau kembali ke versi sebelumnya.
            </small>
            <input
              aria-label="Nomor versi"
              className="control plugin-version-input"
              disabled={running || mode !== "pinned"}
              onChange={(event) => setVersion(event.target.value)}
              onFocus={() => setMode("pinned")}
              placeholder="0.4.8"
              type="text"
              value={version}
            />
            {mode === "pinned" && wanted && !versionOk && (
              <small className="plugin-version-error">
                Bentuknya harus angka versi, mis. 0.4.8.
              </small>
            )}
          </span>
        </label>
      </div>

      <div className="plugin-target-list">
        {rows.map((row) => (
          <div className="plugin-target-row" key={row.id}>
            <span>{row.name}</span>
            <span className="muted-line">{row.version || "-"}</span>
          </div>
        ))}
      </div>

      <div className="confirm-actions">
        <button className="ghost-button" disabled={running} onClick={onClose} type="button">
          Batal
        </button>
        <button
          className="danger-button"
          disabled={running || !versionOk}
          onClick={run}
          type="button"
        >
          {running ? `Memasang di ${rows.length} situs...` : `Pasang di ${rows.length} situs`}
        </button>
      </div>
    </Dialog>
  );
}

// --- Terapkan ke banyak situs ---------------------------------------------------------------------------

/**
 * Dialog pemilih situs tujuan.
 *
 * Dua jalan masuk, dan bentuknya berbeda:
 *
 *   `preset` ada  — dari tombol "Terapkan ke situs lain" di dalam form. Grup dan nilainya sudah
 *                   ditentukan; yang tersisa memilih tujuannya.
 *   `preset` null — dari bilah pilihan di daftar situs. Tujuannya sudah dipilih; yang tersisa
 *                   memilih grup pengaturan mana yang mau disalin, dan dari situs mana.
 *
 * Yang kedua sengaja TIDAK ditawarkan di rilis ini: menyalin pengaturan tanpa melihat nilainya
 * lebih dulu berarti menulis ke armada berdasarkan tebakan. Jadi dialognya mengarahkan orang ke
 * jalan pertama alih-alih menyediakan jalan yang tidak bisa ditinjau.
 */
function BulkApplyDialog({ rows, schema, preset, onClose, onDone }) {
  const [selected, setSelected] = useState(() => new Set(preset ? [] : rows.map((row) => row.id)));
  const [running, setRunning] = useState(false);

  const fields = preset ? schema?.[preset.group]?.fields || [] : [];
  const title = preset ? schema?.[preset.group]?.title || preset.group : "";
  const targets = rows.filter((row) => selected.has(row.id));
  // Lencana "bermasalah" tidak bisa digambar di dalam opsi react-select, jadi ia ikut jadi teks label
  // — tanpa itu situs yang sedang tidak menjawab tidak bisa dibedakan saat dipilih.
  const bulkTargetOptions = useMemo(
    () =>
      rows.map((row) => ({
        value: row.id,
        label: row.error ? `${row.name} (bermasalah)` : row.name,
      })),
    [rows],
  );

  const run = async () => {
    setRunning(true);
    try {
      const res = await savePluginConfigMany(
        targets.map((row) => row.id),
        preset.group,
        preset.values,
      );
      const { tone, message } = bulkMessage(res.summary, title);
      if (tone === "success") notifySuccess(message);
      else notifyWarning(message, res.summary);
      onDone({ title: `${title} — terapkan massal`, rows: res.results, summary: res.summary });
    } catch (error) {
      notifyError(error, "Terapkan massal gagal dijalankan.");
      setRunning(false);
    }
  };

  if (!preset) {
    return (
      <Dialog onClose={onClose} title="Terapkan pengaturan ke situs terpilih">
        <p>
          Buka salah satu situs lewat tombol <strong>Kelola</strong>, ubah pengaturannya, lalu pakai{" "}
          <strong>Terapkan ke situs lain</strong> di form itu. Menyalin pengaturan tanpa melihat
          nilainya lebih dulu berarti menulis ke {rows.length} situs berdasarkan tebakan.
        </p>
        <div className="confirm-actions">
          <button className="primary-button" onClick={onClose} type="button">
            Mengerti
          </button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      className="confirm-dialog plugin-dialog"
      busy={running}
      onClose={onClose}
      subtitle={
        <>{Object.keys(preset.values).length} field akan dikirim ke tiap situs yang dipilih.</>
      }
      title={<>Terapkan {title} ke situs lain</>}
    >
      <p className="plugin-alert">
        <TriangleAlert size={15} />
        <span>
          Ini menulis ke situs yang sedang menerima trafik iklan berbayar, sekarang juga. Kode iklan
          yang salah tidak menghasilkan error di mana pun — ia menghasilkan pendapatan nol.
        </span>
      </p>

      {/* Apa yang akan dikirim disebut per field, bukan cuma jumlahnya: ini satu-satunya layar
          antara satu tombol dan seluruh armada. */}
      <ul className="plugin-diff-list">
        {Object.entries(preset.values).map(([name, value]) => {
          const field = fields.find((item) => item.name === name);
          return (
            <li key={name}>
              <span>{field?.label || name}</span>
              <code>{formatPreview(value)}</code>
            </li>
          );
        })}
      </ul>

      {/* Tujuan dipilih lewat react-select multi yang bisa dicari, bukan daftar kotak centang:
          armadanya ratusan subdomain, dan yang dicari orang hampir selalu beberapa nama yang
          sudah ia ketahui. Yang dipilih jadi chip dan hilang dari daftar, sepola pemilih
          subdomain di tab AdX. */}
      {rows.length === 0 ? (
        <p className="muted-line">Tidak ada situs lain yang terhubung.</p>
      ) : (
        <div className="field">
          <label htmlFor="plugin-bulk-targets">Situs tujuan</label>
          <SelectField
            disabled={running}
            inputId="plugin-bulk-targets"
            isMulti
            noOptionsMessage="Tidak ada situs yang cocok."
            onChange={(ids) => setSelected(new Set(ids))}
            options={bulkTargetOptions}
            placeholder="Cari dan pilih situs..."
            searchable
            value={[...selected]}
          />
        </div>
      )}

      <div className="confirm-actions">
        <button className="ghost-button" disabled={running} onClick={onClose} type="button">
          Batal
        </button>
        <button
          className="danger-button"
          disabled={running || targets.length === 0}
          onClick={run}
          type="button"
        >
          {running
            ? `Menerapkan ke ${targets.length} situs...`
            : `Terapkan ke ${targets.length} situs`}
        </button>
      </div>
    </Dialog>
  );
}

// Nilai panjang (kode iklan, HTML kustom) dipotong: dialog ini harus tetap bisa dibaca dalam satu
// layar, dan yang perlu dikenali orang adalah field mana yang berubah, bukan isinya kata per kata.
function formatPreview(value) {
  if (value === true) return "Aktif";
  if (value === false) return "Nonaktif";
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "(kosong)";
  return text.length > 70 ? `${text.slice(0, 69)}…` : text;
}

/**
 * Hasil per situs setelah terapkan massal.
 *
 * Tiga status, dan ketiganya menuntut tindakan berbeda — persis alasan `gateResultMessage` menjaga
 * `aborted` tidak lebur dengan `problem`:
 *
 *   Berhasil       — selesai.
 *   Tidak berubah  — situs menerima permintaannya lalu MENGABAIKAN nilainya. Mengulanginya tidak
 *                    akan mengubah apa pun; yang perlu diperbaiki adalah nilainya.
 *   Gagal          — belum berubah sama sekali, dan layak dicoba lagi.
 */
function BulkResultDialog({ title, rows, summary, onClose }) {
  return (
    <Dialog
      className="confirm-dialog plugin-dialog"
      onClose={onClose}
      subtitle={
        <>
          {summary.ok} berhasil, {summary.unapplied} tidak berubah, {summary.failed} gagal dari{" "}
          {summary.total} situs.
        </>
      }
      title={title}
    >
      <DataTable
        columns={[
          {
            id: "name",
            header: "Situs",
            accessorFn: (result) => result.name || result.subdomainId,
            cell: ({ row: tableRow }) => tableRow.original.name || tableRow.original.subdomainId,
          },
          {
            id: "status",
            header: "Hasil",
            accessorFn: (result) => bulkLabel(result.status),
            cell: ({ row: tableRow }) => (
              <span className={`badge ${bulkTone(tableRow.original.status)}`}>
                {bulkLabel(tableRow.original.status)}
              </span>
            ),
          },
          {
            id: "detail",
            header: "Keterangan",
            enableSorting: false,
            cell: ({ row: tableRow }) =>
              tableRow.original.error ||
              (tableRow.original.unapplied?.length
                ? `Ditolak diam-diam: ${tableRow.original.unapplied.join(", ")}`
                : "-"),
          },
        ]}
        dense
        getRowId={(result) => String(result.subdomainId)}
        items={rows}
      />

      <div className="confirm-actions">
        <button className="primary-button" onClick={onClose} type="button">
          Tutup
        </button>
      </div>
    </Dialog>
  );
}
