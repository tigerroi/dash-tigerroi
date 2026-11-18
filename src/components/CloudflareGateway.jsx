import { Globe, Server, CheckCircle2, RefreshCw, ShieldAlert } from "lucide-react";
import { useState, useEffect, useMemo } from "react";
import { PageHeader } from "./ui/PageHeader";
import { DataTable } from "./ui/DataTable";
import { CopyButton } from "./ui/CopyButton";
import { DEFAULT_BLOCKED_LOGS, fetchLiveBlockedLogs } from "../lib/blockedLogs";

// Daftar 12 Domain yang terdaftar di Akun Cloudflare Masdef
const CLOUDFLARE_DOMAINS = [
  { id: "1", name: "tigerroi.com", status: "Active", visitors: "507.04k", type: "Gateway & Dashboard" },
  { id: "2", name: "ihopmenuwithprices.us", status: "Active", visitors: "182", type: "WordPress Iklan (5 Subdomain)" },
  { id: "3", name: "tacobellmenuu.us", status: "Active", visitors: "68", type: "WordPress Iklan (3 Subdomain)" },
  { id: "4", name: "tiktokmodapk.net", status: "Active", visitors: "78", type: "WordPress Iklan (4 Subdomain)" },
  { id: "5", name: "trayedit.com", status: "Active", visitors: "0", type: "WordPress Iklan (5 Subdomain)" },
  { id: "6", name: "velocitytv.com.pk", status: "Active", visitors: "161", type: "Domain Arbitrase" },
  { id: "7", name: "cmhhealths.com", status: "Active", visitors: "0", type: "Domain Tambahan" },
  { id: "8", name: "uniqueinfo24.com", status: "Active", visitors: "0", type: "Domain Tambahan" },
  { id: "9", name: "workmoney24.com", status: "Active", visitors: "0", type: "Domain Tambahan" },
  { id: "10", name: "ziperto.org", status: "Active", visitors: "0", type: "Domain Tambahan" },
  { id: "11", name: "ballkantoday.com", status: "Invalid NS", visitors: "-", type: "Domain Pending" },
  { id: "12", name: "gazetaminuti.com", status: "Invalid NS", visitors: "-", type: "Domain Pending" },
];

// Rute Slug Populer Siap Pasang di Iklan Meta
const GATEWAY_SLUGS = [
  { id: "s1", slug: "eat", targetDomain: "eat.foodsfact.org", keitaro: "8f9fdwdM", cat: "FoodsFact" },
  { id: "s2", slug: "guides", targetDomain: "guides.foodsfact.org", keitaro: "CLHNtg1D", cat: "FoodsFact" },
  { id: "s3", slug: "property", targetDomain: "property.foodsfact.org", keitaro: "6Sp9wmYn", cat: "FoodsFact" },
  { id: "s4", slug: "finance", targetDomain: "finance.foodsfact.org", keitaro: "3bRStX5X", cat: "FoodsFact" },
  { id: "s5", slug: "insurance-food", targetDomain: "insurance.foodsfact.org", keitaro: "s6c34SVN", cat: "FoodsFact" },
  { id: "s6", slug: "tiktok-mod", targetDomain: "tiktokmodapk.net", keitaro: "dnR9Ts9S", cat: "TikTok Mod" },
  { id: "s7", slug: "insurance", targetDomain: "insurance.tiktokmodapk.net", keitaro: "k3wbXNZp", cat: "TikTok Mod" },
  { id: "s8", slug: "taco-fries", targetDomain: "tacobellmenuu.us", keitaro: "WMP6ZVgM", cat: "Taco Bell" },
  { id: "s9", slug: "fries", targetDomain: "fries.tacobellmenuu.us", keitaro: "WMP6ZVgM", cat: "Taco Bell" },
  { id: "s10", slug: "cantina", targetDomain: "cantina.tacobellmenuu.us", keitaro: "76LxZPMh", cat: "Taco Bell" },
  { id: "s11", slug: "tray-decor", targetDomain: "trayedit.com", keitaro: "rWbj4QcP", cat: "Tray Decor" },
  { id: "s12", slug: "decor", targetDomain: "decor.trayedit.com", keitaro: "rWbj4QcP", cat: "Tray Decor" },
  { id: "s13", slug: "ihop-menu", targetDomain: "ihopmenuwithprices.us", keitaro: "tJWYJ7", cat: "IHOP Menu" },
  { id: "s14", slug: "menu", targetDomain: "menu.ihopmenuwithprices.us", keitaro: "tJWYJ7", cat: "IHOP Menu" },
  { id: "s15", slug: "deals", targetDomain: "deals.ihopmenuwithprices.us", keitaro: "t66q2g", cat: "IHOP Menu" },
];

export function CloudflareGateway() {
  const [workerStatus, setWorkerStatus] = useState("checking");
  const [search, setSearch] = useState("");
  const [blockedIps, setBlockedIps] = useState(DEFAULT_BLOCKED_LOGS);
  const [loadingBlocked, setLoadingBlocked] = useState(false);

  const workerUrl = "https://visint-gating.tiger-roiunlimited.workers.dev";

  const checkWorker = async () => {
    setWorkerStatus("checking");
    try {
      const res = await fetch(`${workerUrl}/health`, { mode: "cors" });
      if (res.ok) {
        setWorkerStatus("online");
      } else {
        setWorkerStatus("offline");
      }
    } catch {
      setWorkerStatus("ready");
    }
  };

  const fetchBlocked = async () => {
    setLoadingBlocked(true);
    try {
      const items = await fetchLiveBlockedLogs(workerUrl);
      if (items && items.length > 0) setBlockedIps(items);
    } finally {
      setLoadingBlocked(false);
    }
  };

  useEffect(() => {
    checkWorker();
    fetchBlocked();
  }, []);

  const filteredSlugs = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return GATEWAY_SLUGS;
    return GATEWAY_SLUGS.filter(
      (item) =>
        item.slug.toLowerCase().includes(q) ||
        item.targetDomain.toLowerCase().includes(q) ||
        item.cat.toLowerCase().includes(q)
    );
  }, [search]);

  const slugColumns = [
    {
      accessorKey: "cat",
      header: "Kategori",
      cell: ({ getValue }) => <strong>{getValue()}</strong>,
    },
    {
      accessorKey: "slug",
      header: "Slug Gateway",
      cell: ({ getValue }) => <code>/{getValue()}</code>,
    },
    {
      accessorKey: "targetDomain",
      header: "Target WordPress",
    },
    {
      accessorKey: "keitaro",
      header: "Alias Keitaro",
      cell: ({ getValue }) => <span className="badge">{getValue()}</span>,
    },
    {
      id: "action",
      header: "URL Siap Pasang Iklan",
      cell: ({ row }) => (
        <CopyButton
          text={`${workerUrl}/${row.original.slug}`}
          label="Salin Link"
          showLabel
          className="button small secondary"
        />
      ),
    },
  ];

  const blockedColumns = [
    {
      accessorKey: "time",
      header: "Waktu",
      cell: ({ getValue }) => <small className="muted-line">{getValue()}</small>,
    },
    {
      accessorKey: "ip",
      header: "Alamat IP",
      cell: ({ row }) => (
        <span style={{ fontFamily: "monospace", fontWeight: 600 }}>
          {row.original.ip}
        </span>
      ),
    },
    {
      accessorKey: "country",
      header: "Negara",
      cell: ({ getValue }) => <span className="badge">{getValue()}</span>,
    },
    {
      accessorKey: "slug",
      header: "Target Slug",
      cell: ({ getValue }) => <code>{getValue()}</code>,
    },
    {
      accessorKey: "reason",
      header: "Alasan Blokir",
      cell: ({ getValue }) => <span className="badge negative">{getValue()}</span>,
    },
    {
      accessorKey: "action",
      header: "Tindakan Keamanan",
      cell: ({ row }) => (
        <a
          href={row.original.youtube}
          target="_blank"
          rel="noreferrer"
          className="button small ghost"
          style={{ textDecoration: "none" }}
        >
          <span>{row.original.action}</span>
        </a>
      ),
    },
  ];

  const domainColumns = [
    {
      accessorKey: "name",
      header: "Nama Domain",
      cell: ({ getValue }) => <strong>{getValue()}</strong>,
    },
    {
      accessorKey: "status",
      header: "Status DNS",
      cell: ({ getValue }) => (
        <span className={`badge ${getValue() === "Active" ? "positive" : "negative"}`}>
          {getValue()}
        </span>
      ),
    },
    {
      accessorKey: "type",
      header: "Tipe / Peran",
    },
    {
      accessorKey: "visitors",
      header: "Pengunjung Unik",
      meta: { align: "right" },
    },
  ];

  return (
    <div className="page-stack">
      <PageHeader
        title="Cloudflare Gateway Monitor"
        description="Pantau status Cloudflare Worker (visint-gating), 12 domain aktif, dan generator link iklan arbitrase."
        action={
          <button className="button secondary" onClick={checkWorker}>
            <RefreshCw size={16} className={workerStatus === "checking" ? "spin" : ""} />
            <span>Cek Status Worker</span>
          </button>
        }
      />

      {/* Kartu Status Worker Cloudflare */}
      <section className="stats-grid">
        <article className={`stat-card ${workerStatus === "offline" ? "negative" : "positive"}`}>
          <div className="stat-card-header">
            <span>Status Worker Cloudflare</span>
            <Server size={18} />
          </div>
          <strong>
            {workerStatus === "checking"
              ? "Memeriksa..."
              : workerStatus === "online"
              ? "ONLINE (Aktif)"
              : "READY (Siap Pakai)"}
          </strong>
          <small className="muted-line">visint-gating.tiger-roiunlimited.workers.dev</small>
        </article>

        <article className="stat-card">
          <div className="stat-card-header">
            <span>Total Domain Cloudflare</span>
            <Globe size={18} />
          </div>
          <strong>12 Domain</strong>
          <small className="muted-line">10 Active, 2 Nameserver Pending</small>
        </article>

        <article className="stat-card positive">
          <div className="stat-card-header">
            <span>Paket Cloudflare</span>
            <CheckCircle2 size={18} />
          </div>
          <strong>Workers Paid ($5)</strong>
          <small className="muted-line">Kapasitas 10 Juta Request / Bulan</small>
        </article>
      </section>

      {/* Log IP Terblokir & Dilempar ke YouTube */}
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Log IP Terblokir & Dilempar ke YouTube (Live Bot Traps)</h2>
            <p className="notice-line">
              Daftar IP scraper, crawler otomatis, dan akses non-iklan yang otomatis dicegat Cloudflare Worker dan langsung dibuang ke YouTube agar GAM aman.
            </p>
          </div>
          <button className="button secondary" onClick={fetchBlocked} disabled={loadingBlocked}>
            <RefreshCw size={14} className={loadingBlocked ? "spin" : ""} />
            <span>Segarkan Log IP</span>
          </button>
        </div>

        <DataTable columns={blockedColumns} items={blockedIps} />
      </section>

      {/* Rute Link Iklan Siap Pakai */}
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Link Iklan Meta (Smart Gateway Slugs)</h2>
            <p className="notice-line">
              Gunakan URL ini di form URL Website iklan Meta Ads masdef. Pengunjung akan difilter bot-nya lalu diteruskan ke Keitaro dan WordPress tujuan.
            </p>
          </div>
          <input
            type="search"
            className="control"
            placeholder="Cari slug atau domain..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ maxWidth: 280 }}
          />
        </div>

        <DataTable columns={slugColumns} items={filteredSlugs} />
      </section>

      {/* Tabel 12 Domain Cloudflare */}
      <section className="panel">
        <div className="panel-header">
          <h2>Daftar 12 Domain di Akun Cloudflare Masdef</h2>
        </div>
        <DataTable columns={domainColumns} items={CLOUDFLARE_DOMAINS} />
      </section>
    </div>
  );
}
