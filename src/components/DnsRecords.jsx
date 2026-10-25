import { Cloud, CloudOff, Globe, Pencil, Plus, Trash2, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { useUrlState } from "../hooks/useUrlState";
import {
  DNS_TYPES,
  isProxiable,
  missingSubDomains,
  needsPriority,
  recordSummary,
  TTL_MAX,
  TTL_MIN,
  toRecordForm,
  toRecordPayload,
  toRecordRows,
  toZoneRows,
  ttlLabel,
  zoneServer,
} from "../lib/cloudflareDns";
import {
  CONTROL_API_ENABLED,
  createDnsRecordNow,
  deleteDnsRecordNow,
  fetchDnsRecords,
  fetchDnsZones,
  updateDnsRecordNow,
} from "../lib/controlApi";
import { formatDateTime } from "../lib/formatDate";
import { notifyError, notifySuccess } from "../lib/notify";
import { DataTable } from "./ui/DataTable";
import { Dialog } from "./ui/Dialog";
import { EmptyMessage } from "./ui/EmptyMessage";
import { LabeledControl } from "./ui/LabeledControl";
import { PageHeader } from "./ui/PageHeader";
import { RefreshButton } from "./ui/RefreshButton";
import { SelectField, toSelectOptions } from "./ui/SelectField";
import { Switch } from "./ui/Switch";

/**
 * Tab "DNS Record" di halaman Domains — zona Cloudflare tiap domain, berikut record-nya.
 *
 * SUPERADMIN SAJA, dan itu ditegakkan di dua tempat: `SUPERADMIN_PAGES` menyembunyikan tab dan
 * halamannya, dan gerbang `requireSuperAdmin` di `server/cloudflare.js` yang menolak sisanya. Yang
 * kedua yang benar-benar menjaganya — tidak ada satu pun baris RTDB yang ditulis halaman ini, jadi
 * tidak ada `.validate` database yang bisa ikut menjaga. Pola yang sama persis dengan /plugin.
 *
 * Ia tab yang LEBIH KETAT daripada induknya (Domains terbaca tiap akun yang login), dan itu
 * dibolehkan — yang dilarang arah sebaliknya. Preseden yang sama: tab "Calon Penerima" di
 * /notifications. Yang membuatnya tidak menghasilkan halaman bertab-satu untuk role lain: /domains
 * sudah punya tab Sub Domains, jadi yang bukan superadmin tetap melihat dua tab.
 *
 * TIDAK ADA CERMIN RTDB. Yang dicari orang di sini adalah keadaan DNS pada detik ini, dan cermin
 * sejam lalu justru jawaban yang salah — sepola panel ad set. Konsekuensinya diketahui dan
 * diterima: tanpa server kontrol, halaman ini tidak bisa dibuka sama sekali, dan yang digambar
 * adalah sebabnya — bukan tabel kosong yang terbaca seperti zona tanpa record.
 */
export function DnsRecords({ store }) {
  // Zona terpilih tinggal di ALAMAT, bukan useState: yang membuka satu zona lalu menekan Back
  // (atau menyalin alamatnya ke rekan) harus mendarat di zona yang sama. `replace` karena ia
  // membuka isi DI DALAM halaman yang sama — `push` mengubah Back jadi tombol "ganti zona".
  const [zoneId, setZoneId] = useUrlState("zona", "", { history: "replace" });
  const [search, setSearch] = useUrlState("q", "");

  const [zones, setZones] = useState(null);
  const [zonesError, setZonesError] = useState("");
  const [data, setData] = useState(null);
  const [recordsError, setRecordsError] = useState("");
  const [loading, setLoading] = useState(false);
  const [readAt, setReadAt] = useState("");
  const [editing, setEditing] = useState(null);
  const [removing, setRemoving] = useState(null);

  const zoneRows = useMemo(() => toZoneRows(zones, store?.domains), [zones, store?.domains]);
  // Zona yang dipilih dicari di daftar yang BENAR-BENAR ada. Alamat yang menyebut zona yang sudah
  // dihapus dari Cloudflare tidak boleh menggantung di layar sebagai panel kosong tanpa sebab.
  const zone = zoneRows.find((row) => row.id === zoneId) || null;

  const loadZones = useCallback(async () => {
    setZonesError("");
    try {
      setZones(await fetchDnsZones());
    } catch (error) {
      setZones([]);
      setZonesError(error.message);
    }
  }, []);

  const loadRecords = useCallback(async (id) => {
    if (!id) {
      setData(null);
      setRecordsError("");
      return;
    }
    setLoading(true);
    setRecordsError("");
    try {
      const body = await fetchDnsRecords(id);
      setData(body);
      setReadAt(new Date().toISOString());
    } catch (error) {
      // Yang GAGAL tidak mengosongkan panel kalau sudah ada isinya — sepola panel ad set: angka
      // lama tetap digambar dengan sebab dan umurnya di atasnya, karena daftar yang hilang saat
      // penyegaran gagal menghapus satu-satunya salinan yang ada di layar.
      setRecordsError(error.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadZones();
  }, [loadZones]);

  useEffect(() => {
    // Ganti zona berarti panel yang lama tidak berlaku lagi: dikosongkan lebih dulu supaya record
    // zona sebelumnya tidak sempat terbaca sebagai milik zona yang baru dipilih.
    setData(null);
    setReadAt("");
    loadRecords(zoneId);
  }, [zoneId, loadRecords]);

  const rows = useMemo(
    () => toRecordRows(data?.records, data?.zone?.name, store?.subDomains),
    [data, store?.subDomains],
  );

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((row) =>
      `${row.name} ${row.type} ${row.content} ${row.comment}`.toLowerCase().includes(term),
    );
  }, [rows, search]);

  const summary = useMemo(() => recordSummary(rows), [rows]);
  const missing = useMemo(
    () => missingSubDomains(data?.records, data?.zone?.name, store?.subDomains),
    [data, store?.subDomains],
  );

  const afterWrite = async (message) => {
    setEditing(null);
    setRemoving(null);
    notifySuccess(message);
    // DIBACA ULANG, bukan ditambal di layar. Cloudflare menormalkan sendiri apa yang disimpannya
    // (nama dilengkapi, TTL dipaksa Auto saat proxy menyala), jadi menambal baris dengan nilai yang
    // dikirim berarti layar menyebut sesuatu yang berbeda dari yang benar-benar tersimpan.
    await loadRecords(zoneId);
  };

  if (!CONTROL_API_ENABLED) {
    return (
      <div className="page-stack">
        <PageHeader title="DNS Record" description="Record DNS Cloudflare tiap domain." />
        <section className="panel">
          <EmptyMessage>
            Server kontrol belum dikonfigurasi (<code>VITE_CONTROL_API_URL</code>), jadi halaman ini
            tidak bisa membaca Cloudflare. Token Cloudflare tinggal di server dan tidak pernah ada
            di browser, jadi tidak ada jalur lain yang bisa dipakai dari sini.
          </EmptyMessage>
        </section>
      </div>
    );
  }

  return (
    <div className="page-stack">
      <PageHeader
        title="DNS Record"
        description="Record DNS Cloudflare tiap domain — dibaca langsung, tidak dicermin."
        action={
          <RefreshButton busy={loading} disabled={!zoneId} onClick={() => loadRecords(zoneId)} />
        }
      />

      {zonesError && (
        <p className="plugin-alert">
          <TriangleAlert size={15} />
          <span>{zonesError}</span>
        </p>
      )}

      <section className="panel">
        <div className="panel-header">
          <div className="dns-toolbar">
            <SelectField
              ariaLabel="Domain"
              className="dns-zone-select"
              onChange={setZoneId}
              options={[
                { value: "", label: "Pilih domain..." },
                ...zoneRows.map((row) => ({
                  value: row.id,
                  label: `${row.name}${row.registered ? "" : " (belum terdaftar di Domains)"}`,
                })),
              ]}
              value={zoneId}
            />

            {zoneId && (
              <input
                aria-label="Cari record"
                className="control"
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Cari nama, isi, atau komentar..."
                type="search"
                value={search}
              />
            )}
          </div>

          {zone?.editable && (
            <button
              className="primary-button"
              onClick={() => setEditing({ mode: "create", form: toRecordForm(null, zone.name) })}
              type="button"
            >
              <Plus size={15} />
              <span>Tambah record</span>
            </button>
          )}
        </div>

        {!zoneId ? (
          <EmptyMessage>Pilih domain untuk melihat record DNS-nya.</EmptyMessage>
        ) : (
          <>
            {/* Umur bacaan DISEBUTKAN. Halaman ini menjanjikan keadaan sekarang, dan daftar yang
                digambar tanpa satu pun tanda umur tidak bisa dibedakan dari yang baru diambil —
                terutama setelah penyegaran yang gagal, saat yang tergambar justru bacaan lama. */}
            <p className="tab-note">
              {readAt ? `Dibaca dari Cloudflare ${formatDateTime(readAt)}.` : "Membaca..."}
              {zone && !zone.editable && " Token ini hanya bisa MEMBACA zona ini."}
              {zone?.paused && " Cloudflare sedang dijeda untuk zona ini."}
            </p>

            {recordsError && (
              <p className="plugin-alert">
                <TriangleAlert size={15} />
                <span>{recordsError}</span>
              </p>
            )}

            {rows.length > 0 && (
              <section className="stats-grid dns-stats">
                <article className="stat-card">
                  <div className="stat-card-header">
                    <span>Record</span>
                    <Globe size={18} />
                  </div>
                  <strong>{summary.total}</strong>
                </article>
                <article className="stat-card">
                  <div className="stat-card-header">
                    <span>Lewat proxy</span>
                    {summary.proxied > 0 ? <Cloud size={18} /> : <CloudOff size={18} />}
                  </div>
                  <strong>{summary.proxied}</strong>
                </article>
                <article className="stat-card">
                  <div className="stat-card-header">
                    <span>Subdomain terdaftar</span>
                    <Globe size={18} />
                  </div>
                  <strong>{summary.subDomains}</strong>
                </article>
              </section>
            )}

            {/* Satu-satunya kesimpulan yang ditarik halaman ini, dan ia menyerah sendiri saat ada
                wildcard — lihat `missingSubDomains`. */}
            {missing.names.length > 0 && (
              <p className="plugin-alert">
                <TriangleAlert size={15} />
                <span>
                  {missing.names.length} subdomain terdaftar di /sub-domains tidak punya record A,
                  AAAA, atau CNAME di zona ini, jadi namanya tidak menjawab apa pun:{" "}
                  {missing.names.join(", ")}.
                </span>
              </p>
            )}

            <DataTable
              className="dns-table"
              columns={[
                {
                  accessorKey: "type",
                  header: "Tipe",
                  cell: ({ getValue }) => <span className="badge">{getValue()}</span>,
                },
                {
                  accessorKey: "shortName",
                  header: "Nama",
                  cell: ({ row }) => (
                    <>
                      <span className="dns-name">{row.original.shortName}</span>
                      {row.original.subDomain && (
                        <span className="muted-line">terdaftar di /sub-domains</span>
                      )}
                    </>
                  ),
                },
                {
                  accessorKey: "content",
                  header: "Isi",
                  cell: ({ row }) => (
                    <>
                      <span className="dns-content">{row.original.content}</span>
                      {row.original.priority !== null && (
                        <span className="muted-line">priority {row.original.priority}</span>
                      )}
                    </>
                  ),
                },
                {
                  accessorKey: "ttl",
                  header: "TTL",
                  cell: ({ getValue }) => ttlLabel(getValue()),
                },
                {
                  accessorKey: "proxied",
                  header: "Proxy",
                  cell: ({ getValue }) =>
                    getValue() ? (
                      <span className="badge success">Proxy</span>
                    ) : (
                      <span className="muted-line">Langsung</span>
                    ),
                  // Boolean diurutkan sebagai teks "Proxy"/"Langsung" — `true`/`false` mentah
                  // tidak punya urutan yang dibaca `sortTableItems`.
                  meta: { sortValue: (row) => (row.proxied ? "Proxy" : "Langsung") },
                },
                {
                  accessorKey: "comment",
                  header: "Komentar",
                  cell: ({ getValue }) => getValue() || <span className="muted-line">-</span>,
                },
                {
                  id: "actions",
                  header: "Aksi",
                  enableSorting: false,
                  cell: ({ row }) =>
                    zone?.editable ? (
                      <div className="dns-actions">
                        <button
                          aria-label={`Sunting ${row.original.shortName}`}
                          className="ghost-button icon-button"
                          onClick={() =>
                            setEditing({
                              mode: "edit",
                              form: toRecordForm(row.original, data?.zone?.name),
                            })
                          }
                          type="button"
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          aria-label={`Hapus ${row.original.shortName}`}
                          className="ghost-button icon-button"
                          onClick={() => setRemoving(row.original)}
                          type="button"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    ) : (
                      <span className="muted-line">Hanya baca</span>
                    ),
                  meta: { align: "right" },
                },
              ]}
              emptyText={
                loading
                  ? "Membaca record dari Cloudflare..."
                  : rows.length === 0
                    ? "Zona ini belum punya record DNS."
                    : "Tidak ada record yang cocok dengan pencarian."
              }
              items={visible}
            />
          </>
        )}
      </section>

      {editing && zone && (
        <RecordDialog
          mode={editing.mode}
          initial={editing.form}
          zoneName={zone.name}
          server={zoneServer(data?.records, data?.zone?.name)}
          onClose={() => setEditing(null)}
          onSave={async (payload) => {
            if (editing.mode === "create") {
              await createDnsRecordNow(zone.id, payload);
              await afterWrite("Record DNS ditambahkan.");
            } else {
              await updateDnsRecordNow(zone.id, editing.form.id, payload);
              await afterWrite("Record DNS disimpan.");
            }
          }}
        />
      )}

      {removing && zone && (
        <DeleteDialog
          record={removing}
          zoneName={zone.name}
          onClose={() => setRemoving(null)}
          onDelete={async () => {
            await deleteDnsRecordNow(zone.id, removing.id);
            await afterWrite("Record DNS dihapus.");
          }}
        />
      )}
    </div>
  );
}

/**

/**
 * Form tambah/sunting satu record.
 *
 * TIDAK memeriksa isi kotaknya sendiri (bentuk IPv4, hostname, batas TTL) — itu tinggal di
 * `normalizeDnsInput` di sisi server, satu tempat. Yang digambar di sini adalah penolakan yang
 * dikembalikannya, apa adanya: aturan penolakan yang ditulis dua kali akan berselisih suatu hari,
 * dan yang lebih longgar menang tanpa berbunyi sebagai apa pun.
 *
 * KETERANGAN TIAP KOTAK TINGGAL DI IKON, bukan sebagai kalimat di bawahnya, dan itu yang membuat
 * barisnya rata: kalimat sepanjang dua baris di satu kotak dan tidak ada di kotak sebelahnya
 * membuat pasangan yang sebenarnya sejajar berdiri di ketinggian yang berbeda — dan yang dibaca
 * orang tiap kali membuka form ini adalah keterangan yang sudah ia hafal. Kotaknya menumpang
 * `ColumnHint` yang sama dengan kepala kolom Proyeksi Budget; tooltip kedua berarti dua kotak
 * berbeda bentuk untuk satu maksud yang sama.
 */
function RecordDialog({ mode, initial, zoneName, server, onClose, onSave }) {
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const ids = useId();

  const set = (name, value) => setForm((prev) => ({ ...prev, [name]: value }));
  const proxied = isProxiable(form.type) && form.proxied;

  /**
   * Apa yang berdiri di sebelah kanan TTL — dan tidak pernah ada dua-duanya.
   *
   * MX tidak bisa diproxy dan CNAME tidak punya priority, jadi keduanya saling meniadakan menurut
   * tipe. Yang tersisa TXT dan NS, yang tidak punya keduanya: di sana TTL mengambil satu baris
   * penuh alih-alih meninggalkan setengah baris kosong di sebelahnya — barisnya jadi selalu satu
   * pasangan utuh atau satu kotak penuh, tidak pernah setengah.
   */
  const beside = needsPriority(form.type) ? "priority" : isProxiable(form.type) ? "proxied" : "";

  const submit = async (event) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      await onSave(toRecordPayload(form, server));
    } catch (err) {
      // Dialognya TIDAK ditutup saat gagal: yang diketik orang harus tetap di layar untuk
      // diperbaiki, dan pesan Cloudflare hampir selalu menyebut kotak mana yang salah.
      setError(err.message);
      setSaving(false);
    }
  };

  // Nama penuh yang BENAR-BENAR akan tersimpan, dihitung dari yang sedang diketik. Ia keterangan
  // yang berubah, jadi ia tinggal di tooltip dan bukan di label: yang ingin tahu membukanya sekali,
  // yang sudah hafal tidak perlu melihatnya tiap kali.
  const typed = form.name.trim();
  const fullName = !typed || typed === "@" ? zoneName : `${typed}.${zoneName}`;

  return (
    <Dialog
      className="confirm-dialog dns-dialog"
      busy={saving}
      onClose={onClose}
      subtitle={zoneName}
      title={mode === "create" ? "Tambah record DNS" : "Sunting record DNS"}
    >
      <form className="dns-form" onSubmit={submit}>
        <LabeledControl
          className="dns-field"
          labelClassName="dns-label"
          id={`${ids}-type`}
          label="Tipe"
        >
          <SelectField
            disabled={saving}
            id={`${ids}-type`}
            onChange={(type) => set("type", type)}
            options={toSelectOptions(DNS_TYPES)}
            value={form.type}
          />
        </LabeledControl>

        <LabeledControl
          className="dns-field"
          labelClassName="dns-label"
          hint={`Ditulis pendek. Server melengkapinya jadi ${fullName}.`}
          id={`${ids}-name`}
          label="Nama"
        >
          <input
            className="control"
            disabled={saving}
            id={`${ids}-name`}
            onChange={(event) => set("name", event.target.value)}
            placeholder="sub  (atau @ untuk domain utama)"
            value={form.name}
          />
        </LabeledControl>

        <LabeledControl
          className="dns-field"
          labelClassName="dns-label"
          hint={
            form.type === "A" && server
              ? `Kosong = ${server}, server ${zoneName} (A record domain utamanya).`
              : undefined
          }
          id={`${ids}-content`}
          label="Isi"
          wide
        >
          <input
            className="control"
            disabled={saving}
            id={`${ids}-content`}
            onChange={(event) => set("content", event.target.value)}
            placeholder={form.type === "A" ? server || "192.0.2.1" : ""}
            value={form.content}
          />
        </LabeledControl>

        <LabeledControl
          className="dns-field"
          labelClassName="dns-label"
          hint={
            proxied
              ? "Dipaksa Auto selama proxy menyala — TTL record yang diproxy milik Cloudflare."
              : `Kosong = Auto. Selain itu ${TTL_MIN}-${TTL_MAX} detik.`
          }
          id={`${ids}-ttl`}
          label="TTL"
          wide={!beside}
        >
          <input
            className="control"
            disabled={saving || proxied}
            id={`${ids}-ttl`}
            max={TTL_MAX}
            min={TTL_MIN}
            onChange={(event) => set("ttl", event.target.value)}
            placeholder="Auto"
            type="number"
            value={proxied ? "" : form.ttl}
          />
        </LabeledControl>

        {beside === "priority" && (
          <LabeledControl
            className="dns-field"
            labelClassName="dns-label"
            id={`${ids}-priority`}
            label="Priority"
          >
            <input
              className="control"
              disabled={saving}
              id={`${ids}-priority`}
              onChange={(event) => set("priority", event.target.value)}
              type="number"
              value={form.priority}
            />
          </LabeledControl>
        )}

        {/* Kotaknya TIDAK digambar untuk tipe yang tidak bisa diproxy — bukan digambar lalu
            dimatikan. Kotak mati terbaca sebagai izin yang kurang; yang benar adalah proxy tidak
            punya arti untuk record yang jawabannya bukan alamat tujuan HTTP. */}
        {beside === "proxied" && (
          <LabeledControl
            className="dns-field"
            labelClassName="dns-label"
            hint="Pengunjung menerima IP Cloudflare, bukan IP server ini."
            id={`${ids}-proxied`}
            label="Proxy"
          >
            <Switch
              checked={Boolean(form.proxied)}
              className="dns-toggle"
              disabled={saving}
              id={`${ids}-proxied`}
              label="Lewat proxy Cloudflare"
              onChange={(next) => set("proxied", next)}
            />
          </LabeledControl>
        )}

        <LabeledControl
          className="dns-field"
          labelClassName="dns-label"
          id={`${ids}-comment`}
          label="Komentar"
          wide
        >
          <input
            className="control"
            disabled={saving}
            id={`${ids}-comment`}
            onChange={(event) => set("comment", event.target.value)}
            value={form.comment}
          />
        </LabeledControl>

        {error && (
          <p className="plugin-alert wide">
            <TriangleAlert size={15} />
            <span>{error}</span>
          </p>
        )}

        <div className="confirm-actions wide">
          <button className="ghost-button" disabled={saving} onClick={onClose} type="button">
            Batal
          </button>
          <button className="primary-button" disabled={saving} type="submit">
            {saving ? "Menyimpan..." : "Simpan"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/**
 * Konfirmasi hapus.
 *
 * Ia berdiri sendiri dan tidak dilebur ke tombolnya karena akibatnya seketika dan tidak bisa
 * dibatalkan: sebuah record A yang hilang membuat subdomainnya berhenti menjawab pada detik itu
 * juga, dan trafik iklan yang sedang berjalan mendarat di nama yang tidak ada. Dialognya
 * MENYEBUTKAN nama dan isi record-nya — konfirmasi yang cuma bertanya "yakin?" tidak memberi
 * kesempatan siapa pun menyadari bahwa yang tersorot barusan adalah baris di sebelahnya.
 */
function DeleteDialog({ record, zoneName, onClose, onDelete }) {
  const [running, setRunning] = useState(false);

  const run = async () => {
    if (running) return;
    setRunning(true);
    try {
      await onDelete();
    } catch (error) {
      notifyError(error, "Record gagal dihapus.");
      setRunning(false);
    }
  };

  return (
    <Dialog busy={running} onClose={onClose} title="Hapus record DNS?">
      <p>
        <strong>
          {record.type} {record.name}
        </strong>{" "}
        &rarr; {record.content}
      </p>
      <p className="plugin-alert">
        <TriangleAlert size={15} />
        <span>
          {record.subDomain
            ? `${record.name} terdaftar sebagai subdomain di dashboard ini. Menghapus record-nya membuat namanya berhenti menjawab seketika, dan trafik iklan yang sedang berjalan ke sana ikut berhenti.`
            : `Namanya berhenti menjawab seketika di ${zoneName}. Tidak ada cara membatalkannya selain membuat record-nya lagi.`}
        </span>
      </p>
      <div className="confirm-actions">
        <button className="ghost-button" disabled={running} onClick={onClose} type="button">
          Batal
        </button>
        <button className="danger-button" disabled={running} onClick={run} type="button">
          {running ? "Menghapus..." : "Hapus record"}
        </button>
      </div>
    </Dialog>
  );
}
