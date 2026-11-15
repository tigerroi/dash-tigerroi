import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  Megaphone,
  RefreshCw,
  ShieldAlert,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { copyJobRows } from "../../lib/campaignFleet";

/**
 * Lonceng pemberitahuan di topbar (samping pilihan bahasa).
 * Menampilkan kabar keterbaruan tentang:
 * 1. Limit penayangan iklan aplikasi / domain (GAM, AdSense)
 * 2. Status pekerjaan penambahan / duplikasi campaign Meta Ads
 * 3. Status dan isu sinkronisasi data sistem (GAM, Meta, Keitaro)
 */
export function NotificationBell({ store = {}, syncIssues = {}, syncRuns = {}, navigate }) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("all"); // 'all' | 'limit' | 'campaign' | 'sync'
  const popoverRef = useRef(null);
  const triggerRef = useRef(null);

  // Menutup dropdown saat klik di luar area popover
  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(event.target) &&
        triggerRef.current &&
        !triggerRef.current.contains(event.target)
      ) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [open]);

  // 1. Kumpulkan Notifikasi Limit Akun / Google
  const limitNotifications = useMemo(() => {
    const list = [];
    const gamAccounts = Array.isArray(store.gamAccounts) ? store.gamAccounts : [];

    for (const acc of gamAccounts) {
      const isLimit =
        acc.accountStatus === "Limit Iklan" ||
        acc.googleStatus === "Limit Iklan" ||
        (acc.statusNote && acc.statusNote.toLowerCase().includes("dibatasi"));

      if (isLimit) {
        list.push({
          id: `limit-${acc.networkCode || acc.domain}`,
          type: "limit",
          level: "danger",
          title: `${acc.domain || "Akun GAM"} Dibatasi`,
          networkCode: acc.networkCode,
          domain: acc.domain,
          badge: "Limit Iklan",
          message:
            acc.statusNote ||
            "Penayangan iklan di produk Anda saat ini dibatasi karena evaluasi kebijakan Google.",
          time: acc.lastSyncAt ? new Date(acc.lastSyncAt).toLocaleString("id-ID") : "Terbaru",
          actionLabel: "Lihat di GAM",
          targetPath: "/gam-accounts",
        });
      } else if (
        acc.accountStatus === "Ready" &&
        acc.googleStatus === "Ready" &&
        (acc.domain === "ihopmenuwithprices.us" || acc.domain === "uniqueinfo24.com")
      ) {
        // Info kabar baik untuk akun yang baru saja lepas limit
        list.push({
          id: `ready-${acc.networkCode || acc.domain}`,
          type: "limit",
          level: "success",
          title: `${acc.domain} Lepas Limit`,
          networkCode: acc.networkCode,
          domain: acc.domain,
          badge: "Ready",
          message: "Tidak ada masalah saat ini. Pembatasan penayangan iklan telah dicabut oleh Google.",
          time: acc.lastSyncAt ? new Date(acc.lastSyncAt).toLocaleString("id-ID") : "Terbaru",
          actionLabel: "Lihat di GAM",
          targetPath: "/gam-accounts",
        });
      }
    }

    return list;
  }, [store.gamAccounts]);

  // 2. Kumpulkan Notifikasi Pekerjaan Campaign (Create & Copy Jobs)
  const campaignNotifications = useMemo(() => {
    const list = [];
    const copyJobs = copyJobRows(store.campaignCopyJobs);

    for (const job of copyJobs.slice(0, 10)) {
      const isRunning = job.state === "requested" || job.state === "running";
      const isFailed = job.state === "failed";
      const isPartial = job.state === "partial";

      list.push({
        id: `campaign-copy-${job.id}`,
        type: "campaign",
        level: isFailed ? "danger" : isPartial ? "warning" : isRunning ? "info" : "success",
        title: `Duplikasi: ${job.sourceName || "Campaign"}`,
        badge: job.label || "Salin Campaign",
        message: job.error
          ? `Gagal: ${job.error}`
          : isRunning
          ? `Sedang memproses ${job.count} campaign...`
          : `Berhasil menduplikasi ${job.born || job.count} campaign.`,
        time: job.requestedAt ? new Date(job.requestedAt).toLocaleString("id-ID") : "Baru saja",
        actionLabel: "Lihat Pekerjaan",
        targetPath: "/campaigns/pekerjaan",
      });
    }

    // Periksa juga pekerjaan penambahan campaign create
    const createJobsObj = store.campaignCreateJobs;
    if (createJobsObj && typeof createJobsObj === "object") {
      const createEntries = Object.entries(createJobsObj).slice(0, 5);
      for (const [jobId, job] of createEntries) {
        const isRunning = job?.state === "requested" || job?.state === "running";
        const isFailed = job?.state === "failed";

        list.push({
          id: `campaign-create-${jobId}`,
          type: "campaign",
          level: isFailed ? "danger" : isRunning ? "info" : "success",
          title: `Penambahan Campaign: ${job?.name || "Campaign Baru"}`,
          badge: isRunning ? "Membuat" : isFailed ? "Gagal" : "Selesai",
          message: job?.error
            ? `Kendala: ${job.error}`
            : `Proses penambahan campaign ke akun iklan ${job?.accountName || ""}.`,
          time: job?.requestedAt ? new Date(job.requestedAt).toLocaleString("id-ID") : "Baru saja",
          actionLabel: "Lihat Pekerjaan",
          targetPath: "/campaigns/pekerjaan",
        });
      }
    }

    return list;
  }, [store.campaignCopyJobs, store.campaignCreateJobs]);

  // 3. Kumpulkan Notifikasi Masalah & Status Sinkronisasi
  const syncNotifications = useMemo(() => {
    const list = [];

    // Isu dari syncIssues
    if (syncIssues && typeof syncIssues === "object") {
      for (const [provider, issues] of Object.entries(syncIssues)) {
        if (!issues) continue;
        const issueList = Array.isArray(issues) ? issues : Object.values(issues);
        for (const item of issueList) {
          if (!item) continue;
          list.push({
            id: `sync-issue-${provider}-${item.id || item.networkCode || Math.random()}`,
            type: "sync",
            level: "danger",
            title: `Kendala Sync ${String(provider).toUpperCase()}`,
            badge: "Sync Gagal",
            message: item.message || item.error || `Terjadi kegagalan sinkronisasi pada ${provider}.`,
            time: item.timestamp ? new Date(item.timestamp).toLocaleString("id-ID") : "Terbaru",
            actionLabel: "Cek Akun",
            targetPath: provider.includes("gam") ? "/gam-accounts" : "/settings",
          });
        }
      }
    }

    // Status syncRuns jika ada
    if (syncRuns && typeof syncRuns === "object") {
      const runs = Object.entries(syncRuns).slice(0, 5);
      for (const [runName, runData] of runs) {
        if (!runData) continue;
        const isFailed = runData.status === "failed" || runData.error;
        list.push({
          id: `sync-run-${runName}`,
          type: "sync",
          level: isFailed ? "danger" : "info",
          title: `Sync ${runName}`,
          badge: isFailed ? "Gagal" : "Sync Berjalan",
          message: runData.error
            ? `Pesan error: ${runData.error}`
            : `Sinkronisasi terakhir diperbarui dengan status: ${runData.status || "selesai"}.`,
          time: runData.finishedAt
            ? new Date(runData.finishedAt).toLocaleString("id-ID")
            : runData.startedAt
            ? new Date(runData.startedAt).toLocaleString("id-ID")
            : "Terbaru",
          actionLabel: "Lihat GAM",
          targetPath: "/gam-accounts",
        });
      }
    }

    return list;
  }, [syncIssues, syncRuns]);

  // Gabungkan semua notifikasi
  const allNotifications = useMemo(() => {
    return [...limitNotifications, ...campaignNotifications, ...syncNotifications];
  }, [limitNotifications, campaignNotifications, syncNotifications]);

  // Filter notifikasi sesuai tab aktif
  const displayedNotifications = useMemo(() => {
    if (activeTab === "limit") return limitNotifications;
    if (activeTab === "campaign") return campaignNotifications;
    if (activeTab === "sync") return syncNotifications;
    return allNotifications;
  }, [activeTab, allNotifications, limitNotifications, campaignNotifications, syncNotifications]);

  // Hitung jumlah masalah kritis/aktif (limit iklan + sync error + campaign berjalan/gagal)
  const alertCount = useMemo(() => {
    const limits = limitNotifications.filter((n) => n.level === "danger").length;
    const syncErrors = syncNotifications.filter((n) => n.level === "danger").length;
    const campaignActive = campaignNotifications.filter(
      (n) => n.level === "danger" || n.level === "info",
    ).length;
    return limits + syncErrors + campaignActive;
  }, [limitNotifications, syncNotifications, campaignNotifications]);

  const hasCritical =
    limitNotifications.some((n) => n.level === "danger") ||
    syncNotifications.some((n) => n.level === "danger");

  const handleAction = (path) => {
    if (navigate && path) {
      navigate(path);
      setOpen(false);
    }
  };

  return (
    <div className="notification-bell-container" style={{ position: "relative", display: "inline-block" }}>
      {/* Tombol Lonceng */}
      <button
        ref={triggerRef}
        type="button"
        className={`topbar-bell-button ${hasCritical ? "has-alert" : ""}`}
        onClick={() => setOpen((prev) => !prev)}
        aria-label="Pemberitahuan sistem"
        title={alertCount > 0 ? `${alertCount} pemberitahuan baru terkait limit, campaign, atau sync` : "Pemberitahuan"}
        style={{
          position: "relative",
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: "8px",
          width: "30px",
          height: "30px",
          display: "inline-grid",
          placeItems: "center",
          cursor: "pointer",
          color: hasCritical ? "var(--destructive, #ef4444)" : "var(--foreground)",
          transition: "all 0.2s ease",
        }}
      >
        <Bell size={15} />
        {alertCount > 0 && (
          <span
            className="bell-badge"
            style={{
              position: "absolute",
              top: "-5px",
              right: "-5px",
              background: hasCritical ? "var(--destructive, #ef4444)" : "var(--info-fill, #3b82f6)",
              color: "#ffffff",
              fontSize: "10px",
              fontWeight: 700,
              minWidth: "16px",
              height: "16px",
              padding: "0 3px",
              borderRadius: "8px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 2px 4px rgba(0,0,0,0.3)",
              animation: hasCritical ? "pulse 2s infinite" : "none",
            }}
          >
            {alertCount > 99 ? "99+" : alertCount}
          </span>
        )}
      </button>

      {/* Dropdown Popover */}
      {open && (
        <div
          ref={popoverRef}
          className="notification-dropdown-panel"
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            width: "380px",
            maxWidth: "90vw",
            maxHeight: "520px",
            backgroundColor: "var(--card, #18181b)",
            border: "1px solid var(--border, #27272a)",
            borderRadius: "12px",
            boxShadow: "0 12px 28px rgba(0, 0, 0, 0.45)",
            zIndex: 1050,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            animation: "fadeIn 0.15s ease-out",
          }}
        >
          {/* Header Popover */}
          <div
            style={{
              padding: "14px 16px 10px",
              borderBottom: "1px solid var(--border, #27272a)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div>
              <div style={{ fontWeight: 600, fontSize: "15px", display: "flex", alignItems: "center", gap: "6px" }}>
                <span>Pemberitahuan Sistem</span>
                {alertCount > 0 && (
                  <span
                    style={{
                      background: hasCritical ? "var(--danger-bg, rgba(239, 68, 68, 0.15))" : "rgba(59, 130, 246, 0.15)",
                      color: hasCritical ? "var(--destructive, #ef4444)" : "#3b82f6",
                      padding: "1px 7px",
                      borderRadius: "10px",
                      fontSize: "12px",
                      fontWeight: 700,
                    }}
                  >
                    {alertCount} aktif
                  </span>
                )}
              </div>
              <div style={{ fontSize: "12px", color: "var(--muted-foreground, #a1a1aa)", marginTop: "2px" }}>
                Keterbaruan limit iklan, campaign & sinkronisasi
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              style={{
                background: "transparent",
                border: "none",
                color: "var(--muted-foreground, #a1a1aa)",
                cursor: "pointer",
                padding: "4px",
                borderRadius: "4px",
                display: "flex",
                alignItems: "center",
              }}
              aria-label="Tutup notifikasi"
            >
              <X size={16} />
            </button>
          </div>

          {/* Sub-Tabs Penyaring */}
          <div
            style={{
              display: "flex",
              padding: "8px 12px",
              gap: "6px",
              borderBottom: "1px solid var(--border, #27272a)",
              background: "var(--surface-subtle, rgba(0,0,0,0.1))",
              overflowX: "auto",
            }}
          >
            {[
              { id: "all", label: "Semua", count: allNotifications.length },
              { id: "limit", label: "Limit & Kebijakan", count: limitNotifications.length },
              { id: "campaign", label: "Campaign", count: campaignNotifications.length },
              { id: "sync", label: "Sinkronisasi", count: syncNotifications.length },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                style={{
                  background: activeTab === tab.id ? "var(--primary, #3b82f6)" : "transparent",
                  color: activeTab === tab.id ? "var(--primary-foreground, #ffffff)" : "var(--foreground, #e4e4e7)",
                  border: "none",
                  padding: "4px 10px",
                  borderRadius: "6px",
                  fontSize: "12px",
                  fontWeight: activeTab === tab.id ? 600 : 400,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  transition: "background 0.15s ease",
                }}
              >
                {tab.label} {tab.count > 0 && `(${tab.count})`}
              </button>
            ))}
          </div>

          {/* List Item Notifikasi */}
          <div
            style={{
              overflowY: "auto",
              padding: "8px 12px",
              display: "flex",
              flexDirection: "column",
              gap: "8px",
              flex: 1,
            }}
          >
            {displayedNotifications.length === 0 ? (
              <div
                style={{
                  padding: "36px 16px",
                  textAlign: "center",
                  color: "var(--muted-foreground, #a1a1aa)",
                  fontSize: "13px",
                }}
              >
                <CheckCircle2 size={32} style={{ margin: "0 auto 8px", color: "var(--success, #10b981)" }} />
                <div>Tidak ada pemberitahuan pada kategori ini.</div>
                <div style={{ fontSize: "11px", marginTop: "4px" }}>Semua sistem berjalan normal.</div>
              </div>
            ) : (
              displayedNotifications.map((item) => {
                const isDanger = item.level === "danger";
                const isSuccess = item.level === "success";
                const isWarning = item.level === "warning";

                const icon =
                  item.type === "limit" ? (
                    isDanger ? (
                      <ShieldAlert size={18} color="var(--destructive, #ef4444)" />
                    ) : (
                      <CheckCircle2 size={18} color="var(--success, #10b981)" />
                    )
                  ) : item.type === "campaign" ? (
                    <Megaphone size={18} color={isDanger ? "var(--destructive, #ef4444)" : "var(--info-fill, #3b82f6)"} />
                  ) : isDanger ? (
                    <AlertTriangle size={18} color="var(--destructive, #ef4444)" />
                  ) : (
                    <RefreshCw size={18} color="var(--info-fill, #3b82f6)" />
                  );

                const borderColor = isDanger
                  ? "var(--destructive, #ef4444)"
                  : "var(--border, #27272a)";

                const badgeBg = isDanger
                  ? "var(--danger-bg, rgba(239, 68, 68, 0.15))"
                  : isSuccess
                  ? "rgba(16, 185, 129, 0.15)"
                  : isWarning
                  ? "rgba(245, 158, 11, 0.15)"
                  : "rgba(59, 130, 246, 0.15)";

                const badgeColor = isDanger
                  ? "var(--destructive, #ef4444)"
                  : isSuccess
                  ? "var(--success, #10b981)"
                  : isWarning
                  ? "#f59e0b"
                  : "var(--info-fill, #3b82f6)";

                return (
                  <div
                    key={item.id}
                    style={{
                      padding: "10px 12px",
                      borderRadius: "8px",
                      border: `1px solid ${borderColor}`,
                      background: "var(--surface-subtle, rgba(255, 255, 255, 0.03))",
                      display: "flex",
                      flexDirection: "column",
                      gap: "6px",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        {icon}
                        <span style={{ fontWeight: 600, fontSize: "13px", color: "var(--foreground, #f4f4f5)" }}>
                          {item.title}
                        </span>
                      </div>
                      <span
                        style={{
                          fontSize: "11px",
                          fontWeight: 600,
                          padding: "2px 6px",
                          borderRadius: "4px",
                          background: badgeBg,
                          color: badgeColor,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {item.badge}
                      </span>
                    </div>

                    <div style={{ fontSize: "12px", color: "var(--muted-foreground, #a1a1aa)", lineHeight: 1.4 }}>
                      {item.message}
                    </div>

                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "2px" }}>
                      <span style={{ fontSize: "11px", color: "var(--muted-foreground, #71717a)" }}>{item.time}</span>
                      {item.targetPath && (
                        <button
                          type="button"
                          onClick={() => handleAction(item.targetPath)}
                          style={{
                            background: "transparent",
                            border: "none",
                            color: "var(--info-fill, #3b82f6)",
                            fontSize: "11px",
                            fontWeight: 600,
                            display: "flex",
                            alignItems: "center",
                            gap: "3px",
                            cursor: "pointer",
                            padding: "2px 4px",
                          }}
                        >
                          <span>{item.actionLabel}</span>
                          <ChevronRight size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer Popover */}
          <div
            style={{
              padding: "10px 16px",
              borderTop: "1px solid var(--border, #27272a)",
              background: "var(--surface-subtle, rgba(0,0,0,0.15))",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              fontSize: "12px",
            }}
          >
            <span style={{ color: "var(--muted-foreground, #71717a)" }}>Sync otomatis per 30 menit</span>
            <button
              type="button"
              onClick={() => handleAction("/gam-accounts")}
              style={{
                background: "transparent",
                border: "none",
                color: "var(--foreground, #e4e4e7)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "4px",
                fontSize: "11px",
                fontWeight: 500,
              }}
            >
              <span>Status GAM</span>
              <ExternalLink size={12} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
