import { ShieldCheck, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useUrlState } from "../../hooks/useUrlState";
import { auditPluginSites, CONTROL_API_ENABLED } from "../../lib/controlApi";
import { notifySuccess, notifyWarning } from "../../lib/notify";
import {
  AUDIT_BATCH,
  AUDIT_CHECKS,
  auditBadgeTone,
  auditDomains,
  auditSummary,
  chunk,
  parseIdList,
  sitesOfDomain,
} from "../../lib/pluginAudit";
import { BusyIcon } from "../ui/BusyIcon";
import { DataTable } from "../ui/DataTable";
import { SelectField } from "../ui/SelectField";
import { TabStrip } from "../ui/TabStrip";
import { SiteSelect } from "./GptInject";

const MODES = [
  { id: "domain", label: "Domain", tabId: "audit-mode-domain", panelId: "audit-target" },
  { id: "subdomain", label: "Subdomain", tabId: "audit-mode-subdomain", panelId: "audit-target" },
];

/**
 * Tab Cek Situs di /plugin — membaca plugin tiap subdomain dan menilai kode iklan, CMP, network code
 * AdX, landing page, dan behaviour-nya. Tidak menulis apa pun ke situs.
 *
 * Pilihannya dua: satu DOMAIN (seluruh subdomainnya ikut) atau beberapa SUBDOMAIN. Keduanya tinggal
 * di alamat (`?mode=`, `?domain=`, `?cek=`), jadi tautan "cek domain X" bisa dibagikan. Hasilnya TIDAK:
 * ia bacaan langsung dari situs, dan hasil yang dikembalikan dari alamat adalah keadaan kemarin yang
 * mengaku sekarang.
 *
 * Mode Domain HANYA menggambar subdomain yang terhubung ke plugin — yang belum terhubung tidak punya
 * apa pun untuk dicek, dan barisnya cuma memenuhi tabel (mis. domain induk "sheetz.us" sendiri).
 * Jumlahnya tetap disebut di ringkasan, supaya tabel yang lebih pendek dari daftar /sub-domains
 * punya penjelasan. Mode Subdomain tetap menggambar apa yang dipilih orang, terhubung atau tidak.
 */
export function SiteAudit({ rows, domains, canManage }) {
  const [mode, setMode] = useUrlState("mode", "domain");
  const [domain, setDomain] = useUrlState("domain", "");
  const [picked, setPicked] = useUrlState("cek", "");
  const [results, setResults] = useState({});
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  const domainOptions = useMemo(
    () => auditDomains(domains, rows).map((name) => ({ value: name, label: name })),
    [domains, rows],
  );
  const pickedIds = useMemo(() => parseIdList(picked), [picked]);

  const domainSites = useMemo(() => sitesOfDomain(rows, domain), [rows, domain]);
  const targets = useMemo(() => {
    if (mode === "subdomain") {
      const byId = new Map(rows.map((row) => [row.id, row]));
      return pickedIds.map((id) => byId.get(id)).filter(Boolean);
    }
    return domainSites.filter((row) => row.enrolled);
  }, [mode, rows, domainSites, pickedIds]);
  const hiddenCount = mode === "domain" ? domainSites.length - targets.length : 0;

  const entries = targets.map((row) => ({
    id: row.id,
    name: row.name,
    enrolled: row.enrolled,
    result: results[row.id] || null,
  }));
  const enrolledIds = targets.filter((row) => row.enrolled).map((row) => row.id);
  const summary = auditSummary(entries);
  const disabled = !CONTROL_API_ENABLED || !canManage;

  const runAudit = async () => {
    setRunning(true);
    setProgress(0);
    // Hasil lama sasaran ini dibuang dulu: baris yang masih menggambar hasil kemarin di samping baris
    // yang baru saja dibaca tidak bisa dibedakan satu sama lain.
    setResults((current) => {
      const next = { ...current };
      for (const id of enrolledIds) delete next[id];
      return next;
    });

    const collected = [];
    for (const ids of chunk(enrolledIds, AUDIT_BATCH)) {
      if (!alive.current) return;
      let rowsOfBatch;
      try {
        rowsOfBatch = (await auditPluginSites(ids)).results;
      } catch (error) {
        // Satu gelombang yang gagal (server putus, sesi habis) tidak menghentikan sisanya — dan
        // barisnya berbunyi sebabnya, bukan kosong seolah belum dicek.
        rowsOfBatch = ids.map((id) => ({
          subdomainId: id,
          status: "failed",
          error: error.message,
        }));
      }
      if (!alive.current) return;
      collected.push(...rowsOfBatch);
      setResults((current) => ({
        ...current,
        ...Object.fromEntries(rowsOfBatch.map((row) => [row.subdomainId, row])),
      }));
      setProgress(collected.length);
    }
    setRunning(false);

    const done = auditSummary(collected.map((result) => ({ enrolled: true, result })));
    const message = `${done.checked} dicek: ${done.clean} tanpa masalah, ${done.withProblems} bermasalah${done.unreachable ? `, ${done.unreachable} tidak terbaca` : ""}.`;
    done.withProblems || done.unreachable ? notifyWarning(message) : notifySuccess(message);
  };

  const columns = useMemo(() => auditColumns(), []);

  return (
    <section className="panel">
      <div className="site-audit-controls">
        <TabStrip
          active={mode}
          label="Cek berdasarkan"
          onChange={(next) => setMode(next)}
          tabs={MODES}
        />
        <div className="site-audit-target" id="audit-target" role="tabpanel">
          {mode === "domain" ? (
            <SelectField
              ariaLabel="Domain"
              clearable
              disabled={running}
              noOptionsMessage="Tidak ada domain yang cocok."
              onChange={(value) => setDomain(value || "")}
              options={domainOptions}
              placeholder="Pilih domain..."
              searchable
              value={domain}
            />
          ) : (
            <SiteSelect
              disabled={running}
              enrolled={rows}
              loading={false}
              onChange={(ids) => setPicked([...ids].join(","))}
              selected={new Set(pickedIds)}
            />
          )}
          <button
            className="primary-button"
            disabled={disabled || running || enrolledIds.length === 0}
            onClick={runAudit}
            type="button"
          >
            <BusyIcon busy={running} icon={ShieldCheck} />
            <span>
              {running
                ? `Mengecek ${progress}/${enrolledIds.length}...`
                : enrolledIds.length
                  ? `Cek ${enrolledIds.length} subdomain`
                  : "Cek"}
            </span>
          </button>
        </div>
      </div>

      {targets.length > 0 && (
        <p className="muted-line site-audit-summary">
          {targets.length} subdomain
          {summary.notEnrolled > 0 && ` · ${summary.notEnrolled} belum terhubung ke plugin`}
          {hiddenCount > 0 && ` · ${hiddenCount} belum terhubung tidak ditampilkan`}
          {summary.checked > 0 &&
            ` · ${summary.clean} tanpa masalah, ${summary.withProblems} bermasalah`}
          {summary.unreachable > 0 && ` · ${summary.unreachable} tidak terbaca`}
        </p>
      )}
      {mode === "domain" && domain && domainSites.length > 0 && targets.length === 0 && (
        <p className="plugin-alert plugin-alert-inline">
          <TriangleAlert size={15} />
          <span>
            Tidak satu pun subdomain domain ini terhubung ke plugin — enroll dulu di Daftar Plugin.
          </span>
        </p>
      )}

      <DataTable
        columns={columns}
        dense
        emptyText={
          mode === "domain"
            ? domain
              ? "Tidak ada subdomain terdaftar untuk domain ini di /sub-domains."
              : "Pilih domain — seluruh subdomainnya ikut dicek."
            : "Pilih satu atau beberapa subdomain untuk dicek."
        }
        items={entries}
      />
    </section>
  );
}

function auditColumns() {
  return [
    {
      id: "name",
      header: "Subdomain",
      accessorFn: (entry) => entry.name,
      cell: ({ row }) => <SiteCell entry={row.original} />,
    },
    ...AUDIT_CHECKS.map((item) => ({
      id: item.key,
      header: item.label,
      meta: { hint: item.hint },
      accessorFn: (entry) => entry.result?.detail?.checks?.[item.key]?.label || "",
      cell: ({ row }) => (
        <CheckCell checkKey={item.key} result={row.original.result?.detail?.checks?.[item.key]} />
      ),
    })),
  ];
}

/**
 * Nama situs, dan di bawahnya keadaan yang membuat kolom lain kosong. Tanpa kolom Hasil, di sinilah
 * "Belum terhubung" dan "Tidak terbaca" harus berdiri — lima sel "-" tanpa sebab terbaca seperti
 * situs yang belum sempat dicek.
 */
function SiteCell({ entry }) {
  const state = !entry.enrolled
    ? { tone: "neutral", label: "Belum terhubung", note: "" }
    : entry.result?.status === "failed"
      ? { tone: "danger", label: "Tidak terbaca", note: entry.result.error }
      : null;
  return (
    <div className="site-audit-cell">
      <span>{entry.name}</span>
      {state && <span className={`badge ${state.tone}`}>{state.label}</span>}
      {state?.note && <small className="muted-line">{state.note}</small>}
    </div>
  );
}

function CheckCell({ checkKey, result }) {
  if (!result) return "-";
  return (
    <div className="site-audit-cell">
      <span className={`badge ${auditBadgeTone(checkKey, result)}`}>{result.label}</span>
      {result.detail && <small className="muted-line">{result.detail}</small>}
    </div>
  );
}
