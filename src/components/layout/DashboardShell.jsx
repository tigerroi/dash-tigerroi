import {
  BadgeDollarSign,
  BarChart3,
  Bell,
  Database,
  Globe2,
  LayoutDashboard,
  LogOut,
  Megaphone,
  PanelLeft,
  PanelLeftClose,
  PiggyBank,
  Puzzle,
  Route,
  Scale,
  ScrollText,
  Server,
  Settings,
  ShieldCheck,
  Smartphone,
  Target,
  Users,
  Wallet,
} from "lucide-react";
import { Fragment, useState } from "react";
import { canOpenPage, canReadResource, homePath, isGuestOnly } from "../../config/access";
import { activeNavPath, sidebarItems } from "../../config/navigation";
import { PageTabs } from "../ui/PageTabs";
import { ReminderAlert } from "../ui/ReminderAlert";
import { SyncIssuesAlert } from "../ui/SyncIssuesAlert";
import { SyncStatus } from "../ui/SyncStatus";
import { ThemeToggle } from "../ui/ThemeToggle";

// Satu ikon per baris sidebar, dan tidak boleh ada yang kembar. Saat rail menyempit ke 48px,
// label disembunyikan dan ikon inilah SATU-SATUNYA yang membedakan satu halaman dari halaman lain
// — sebelum ini lima baris jatuh ke `Database` (fallback) dan GAM/AdSense memakai ikon yang sama,
// jadi tujuh dari sembilan belas baris tidak bisa dibedakan sama sekali dalam mode itu.
//
// Yang jadi tab tidak perlu masuk sini: tab dikenali dari namanya, bukan ikonnya.
const navIcons = {
  dashboard: LayoutDashboard,
  profitLoss: Scale,
  spending: PiggyBank,
  expenses: Wallet,
  targets: Target,
  adAccounts: Smartphone,
  campaigns: Megaphone,
  gamAccounts: BarChart3,
  adsenseAccounts: BadgeDollarSign,
  domains: Globe2,
  subDomains: Server,
  gating: Route,
  plugin: Puzzle,
  users: Users,
  otp: ShieldCheck,
  activityLogs: ScrollText,
  notifications: Bell,
  settings: Settings,
};

export function DashboardShell({
  children,
  canCompleteReminder,
  canRecordReminderExpense,
  navigate,
  onLogout,
  onCompleteReminder,
  path,
  reminders,
  syncIssues,
  syncRetries,
  syncRuns,
  syncStatus,
  tabBadges,
  user,
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [expanded, setExpanded] = useState(true);
  // Baris sidebar yang menyala — induknya kalau yang terbuka salah satu tab, supaya "Domains"
  // tetap aktif saat yang di layar Sub Domains.
  const activeRoot = activeNavPath(path);
  // Menu dan tab menyaring lewat HALAMAN yang boleh dibuka, bukan node yang boleh dibaca — dua hal
  // yang berbeda untuk akun tamu (lihat GUEST_PAGES).
  const canOpen = (key) => canOpenPage(user.role, key);
  // Tamu murni tidak melihat apa pun di sisi kiri topbar — status sync, isu sync, maupun tagihan
  // jatuh tempo. Ketiganya urusan operasional tim, bukan bagian dari laporan yang dibagikan, dan dua
  // yang terakhir menunjuk halaman yang tidak bisa ia buka.
  const guest = isGuestOnly(user.role);

  return (
    <div className={`app-shell ${expanded ? "sidebar-expanded" : "sidebar-collapsed"}`}>
      <aside className={`sidebar ${mobileOpen ? "open" : ""}`}>
        <button
          className="brand"
          type="button"
          onClick={() => navigate(homePath(user.role))}
          aria-label="Go to dashboard"
        >
          <span className="brand-mark">
            <Database size={16} />
          </span>
          <span className="brand-text">[TigerROI-DASHBOARD]</span>
        </button>

        <nav>
          {sidebarItems(canOpen).map((item, index, visible) => {
            const Icon = navIcons[item.key] || Database;
            // Header grup hanya di item pertama grupnya, jadi grup yang seluruh isinya
            // ter-filter oleh akses tidak meninggalkan header yatim.
            const showGroup = index === 0 || visible[index - 1].group !== item.group;

            return (
              <Fragment key={item.path}>
                {showGroup && <div className="nav-group">{item.group}</div>}
                <button
                  className={activeRoot === item.path ? "nav-item active" : "nav-item"}
                  onClick={() => {
                    navigate(item.path);
                    setMobileOpen(false);
                  }}
                  title={item.label}
                  type="button"
                >
                  <Icon size={18} />
                  <span>{item.label}</span>
                </button>
              </Fragment>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <button
            className="collapse-button"
            onClick={() => setExpanded((open) => !open)}
            type="button"
          >
            {expanded ? <PanelLeftClose size={16} /> : <PanelLeft size={16} />}
            <span>Collapse</span>
          </button>
          <button className="logout-button" onClick={onLogout} type="button">
            <LogOut size={16} />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      <div className="main-area">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="menu-button"
              onClick={() => setMobileOpen(true)}
              type="button"
              aria-label="Open navigation"
            >
              <PanelLeft size={16} />
            </button>
            {/* Menggantikan tombol "Sync ROI": sync jalan sendiri tiap jam, jadi yang berguna di
                sini bukan pemicunya melainkan kabar kapan ia jalan lagi. */}
            {!guest && <SyncStatus status={syncStatus} />}
            {/* Muncul hanya kalau ada yang gagal. Hitung mundur yang tenang di sebelahnya tidak
                bisa membedakan sync yang lengkap dari sync yang kehilangan satu network. */}
            {!guest && (
              <SyncIssuesAlert
                issues={syncIssues}
                // Tombol "Buka Google API" di kartu isu kredensial. Diberikan hanya kalau halamannya
                // memang boleh dibuka orang ini — tombol yang berujung "akses ditolak" lebih buruk
                // daripada tidak ada tombol, dan panel ini dibaca semua role.
                onOpenCredentials={
                  canReadResource(user.role, "googleApiConfigs")
                    ? () => navigate("/google-api-configs")
                    : null
                }
                retries={syncRetries}
                runs={syncRuns}
              />
            )}
            {/* Muncul hanya kalau ada reminder jatuh tempo yang belum dibayar — untuk semua
                role, bukan hanya Keuangan. Yang menandai selesai tetap yang berhak menulis. */}
            {!guest && (
              <ReminderAlert
                canComplete={canCompleteReminder}
                canRecordExpense={canRecordReminderExpense}
                navigate={navigate}
                onComplete={onCompleteReminder}
                reminders={reminders}
              />
            )}
          </div>
          <div className="topbar-title">
            <strong>TigerROI Dashboard</strong>
          </div>
          {/* Tombol tema berdampingan dengan lencana akun, dan TIDAK ikut disembunyikan bersamanya
              di layar sempit: nama akun di situ cuma keterangan (yang butuh menggantinya pergi ke
              sidebar), sementara ini kontrol — dan layar sempit adalah tempat orang paling sering
              berpindah antara siang dan malam. */}
          <div className="topbar-right">
            <ThemeToggle />
            <div className="user-pill">
              {user.name} / {user.role}
            </div>
          </div>
        </header>
        <main className="content">
          {/* Menu yang digabung ke satu baris sidebar muncul lagi di sini sebagai tab. Di dalam
              `.content`, bukan di topbar: topbar memuat kabar yang berlaku untuk seluruh dashboard
              (sync, isu, pengingat), sementara ini bagian dari halaman yang sedang dibuka. */}
          <PageTabs badges={tabBadges} canRead={canOpen} navigate={navigate} path={path} />
          {children}
        </main>
      </div>

      {mobileOpen && (
        <button
          className="backdrop"
          onClick={() => setMobileOpen(false)}
          aria-label="Close navigation"
          type="button"
        />
      )}
    </div>
  );
}
