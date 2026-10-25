import { lazy, Suspense, useEffect, useMemo } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "react-hot-toast";
import { CashFlow } from "./components/CashFlow";
import { DomainProfit } from "./components/DomainProfit";
import { EmptyPage } from "./components/EmptyPage";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { LoginPage } from "./components/LoginPage";
import { DashboardShell } from "./components/layout/DashboardShell";
import { NotificationCenter, ownUserRow } from "./components/NotificationCenter";
import { NotificationContactForm } from "./components/NotificationContactForm";
import { NotificationPersonForm } from "./components/NotificationPersonForm";
import { Plugin } from "./components/Plugin";
import { ProfitLoss } from "./components/ProfitLoss";
import { ResourceForm } from "./components/ResourceForm";
import { ResourceList } from "./components/ResourceList";
import { SettingsPage } from "./components/SettingsPage";
import { Spending } from "./components/Spending";
import { TargetForm } from "./components/TargetForm";
import { Targets } from "./components/Targets";
import { UserDetail } from "./components/UserDetail";
import { EmptyMessage } from "./components/ui/EmptyMessage";
import { ViControl } from "./components/ViControl";
import {
  accessDeniedReason,
  canEditCampaignCodes,
  canEditSettings,
  canGateCampaign,
  canManageNotifications,
  canManagePlugin,
  canOpenPage,
  canWrite,
  canWriteTargets,
  homePath,
  isGuestOnly,
} from "./config/access";
import { resources } from "./config/resources";
import { useActivityLogger } from "./hooks/useActivityLogger";
import { useFirebaseAuth } from "./hooks/useFirebaseAuth";
import { useFirebaseStore } from "./hooks/useFirebaseStore";
import { useRouter } from "./hooks/useRouter";
import { runningJobCount } from "./lib/campaignFleet";
import { CONTROL_API_ENABLED, startGoogleAuth } from "./lib/controlApi";
import { googleAuthReturn } from "./lib/googleAuthReturn";
import { notifyError, notifySuccess, notifyWarning } from "./lib/notify";
import { pendingChats } from "./lib/telegramInbox";
import { initTheme } from "./lib/theme";
import { resolveRoute } from "./routes/resolveRoute";
import "./styles.css";

// Overview satu-satunya pemakai recharts, dan recharts sendirian 113 kB gzip — lebih besar dari
// seluruh kode aplikasi ini. Dimuat eager, ia ikut terunduh oleh orang yang baru melihat form
// login; dimuat malas, ia baru diambil saat dashboardnya benar-benar dibuka. Muatan awal turun
// dari ~294 kB gzip jadi ~182 kB.
//
// Sengaja TIDAK ditambahkan ke manualChunks di vite.config.js: menamainya di sana membuat Rollup
// menaikkannya jadi chunk awal, lengkap dengan modulepreload di index.html — persis yang mau
// dihindari. Biarkan ia ikut chunk async ini.
//
// Halaman lain tetap eager: semuanya bersama-sama hanya 40 kB gzip, dan memecahnya jadi enam
// chunk hanya menambah antrean permintaan tanpa mengurangi apa pun yang berarti.
const Overview = lazy(() =>
  import("./components/Overview").then((module) => ({ default: module.Overview })),
);

// Alasan yang sama dengan Overview, dan satu-satunya halaman lain yang memenuhinya: otplib beserta
// @noble/hashes dan @scure/base yang dibawanya adalah 13 kB gzip yang tidak dipakai satu baris pun
// di luar halaman ini — dan halaman ini superadmin saja. Dimuat eager, ia ikut terunduh oleh setiap
// orang yang membuka form login untuk fitur yang tidak akan pernah muncul di menunya.
const OtpPage = lazy(() =>
  import("./components/OtpPage").then((module) => ({ default: module.OtpPage })),
);

// Form tambahnya dipisah dari tabelnya, jadi ia chunk sendiri — dan chunk itu TIDAK memuat otplib
// sama sekali: yang menghitung kode cuma tabelnya.
const OtpForm = lazy(() =>
  import("./components/OtpForm").then((module) => ({ default: module.OtpForm })),
);

// Alasan ketiga yang memenuhi syarat lazy, dan yang paling jelas dari semuanya: halaman ini
// superadmin saja DAN memasang langganan RTDB-nya sendiri. Dimuat eager, kode pembaca jejak ikut
// terunduh oleh setiap advertiser yang membuka form login untuk menu yang tidak akan pernah ada di
// sidebar mereka.
//
// Yang MENCATAT jejak tidak ikut lazy dan tidak boleh: `useActivityLogger` di bawah dipasang untuk
// setiap sesi, dan sebuah pencatat yang baru hidup setelah halamannya dibuka cuma mencatat orang
// yang membuka halaman itu.
const ActivityLogs = lazy(() =>
  import("./components/ActivityLogs").then((module) => ({ default: module.ActivityLogs })),
);

// Dimuat lazy dengan alasan yang sama seperti Activity Logs dan OTP: tab superadmin yang dibuka
// sesekali, dan tidak satu baris pun di luarnya mengimpor modul ini.
const DnsRecords = lazy(() =>
  import("./components/DnsRecords").then((module) => ({ default: module.DnsRecords })),
);

const SetupSub = lazy(() =>
  import("./components/SetupSub").then((module) => ({ default: module.SetupSub })),
);

// Dimuat lazy, alasan yang sama dengan DnsRecords: halaman superadmin yang dibuka sesekali.
const CampaignFleet = lazy(() =>
  import("./components/campaigns/CampaignFleet").then((module) => ({
    default: module.CampaignFleet,
  })),
);

// Nama PIC yang tersedia untuk kotak "Lingkup Peringatan ROI" di form penerima non-tim. Dari
// `subDomains.pic` dan bukan dari `users.name`: yang dicocokkan saat mengirim adalah `pic` di baris
// ROI, jadi nama yang ditawarkan harus nama yang benar-benar dipakai armada — termasuk PIC yang
// belum (atau tidak lagi) punya baris user.
function picOptions(subDomains) {
  const names = new Set();
  for (const row of subDomains || []) {
    const pic = String(row?.pic || "").trim();
    if (pic) names.add(pic);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

/**
 * Lencana angka di kepala tab — hari ini SATU, dan daftar ini sengaja pelit.
 *
 * Yang berhak punya lencana cuma tab yang isinya ANTREAN: sesuatu yang menunggu dikerjakan dan
 * habis begitu dikerjakan. Calon Penerima memenuhi itu — tiap barisnya adalah orang yang sudah
 * menekan Start dan belum menerima apa pun sampai ada admin yang menekan Aktifkan, dan sejak panel
 * itu jadi tab, angka ini satu-satunya yang mengabarkannya tanpa tab-nya dibuka dulu.
 *
 * Yang TIDAK boleh ikut ke sini adalah tab yang isinya daftar (Orang, Topik, Laporan ROI): angka
 * yang tidak pernah berubah jadi nol berhenti dibaca dalam sehari, dan yang ikut berhenti dibaca
 * adalah lencana di sebelahnya yang benar-benar menuntut tindakan.
 *
 * Non-admin tidak pernah melihatnya, dan itu terjadi dua kali: tab-nya sendiri tertutup
 * (`key: "telegramInbox"`), dan `store.telegramInbox` memang cuma dilanggan untuk admin — jadi
 * angkanya nol, dan nol tidak digambar.
 */
function tabBadgesOf(store) {
  return {
    "/notifications/calon": pendingChats(store.telegramInbox, {
      users: store.users,
      groups: store.notificationGroups,
    }).length,
    // Job yang sedang berjalan MEMENUHI syarat lencana tab: ia antrean, bukan daftar — habis sendiri
    // begitu pekerjaannya selesai, jadi angkanya benar-benar kembali ke nol. Itu juga yang
    // menggantikan panel Pekerjaan yang dulu berdiri di atas tabel: tanpa lencana, berpindah tab
    // adalah satu-satunya cara mengetahui ada yang sedang dikerjakan.
    "/campaigns/pekerjaan": runningJobCount(store.campaignCopyJobs, store.campaignCreateJobs),
  };
}

// Tab Settings yang pindah, dan ke mana. Keduanya menjawab pertanyaan yang sama dengan halaman
// Notification Center — "siapa dikabari apa, dan kapan" — dan tab yang tertinggal di Settings hanya
// akan jadi tempat kedua yang lupa ikut diperbarui.
const SETTINGS_TABS_MOVED = {
  telegram: "/notifications",
  peringatan: "/notifications/peringatan",
};

// Halaman yang alamatnya berganti, dan ke mana. Keduanya tetap DIKENALI resolveRoute — bookmark dan
// tautan lama tidak boleh berakhir di halaman "tidak ditemukan" — dan yang di sini cuma menulis
// ulang alamatnya ke yang kanonik, supaya sidebar menandai menunya (`path.startsWith`) dan alamat
// yang disalin dari bilah alamat adalah alamat yang sekarang.
const PAGES_MOVED = {
  "/gating": "/vi-control",
  "/spending": "/proyeksi-budget",
  "/plugin/inject-kode": "/plugin/adx",
  "/setup-sub": "/plugin/setup-sub",
};

// OAuth endpoint (fallback jika server kontrol belum aktif). Diambil dari env.
const OAUTH_FN_URL = import.meta.env.VITE_OAUTH_FN_URL || "";

/**
 * Tombol Login/Reconnect di /google-api-configs — consent Google untuk satu kredensial.
 *
 * Server kontrol DULU, Cloud Function belakangan, dan urutannya bukan selera: yang kedua adalah
 * jalur browser → Cloud Function, yang di bawah DRS tidak pernah bisa dipanggil sama sekali. Itu
 * sebabnya tombol ini selama ini disembunyikan dan satu-satunya cara consent adalah
 * `cd functions && npm run authorize` di laptop yang punya repo ini.
 *
 * Yang berangkat dari sini cuma permintaan URL-nya; `state` sekali pakai yang menjaga callback
 * ditulis server ke record kredensialnya sebelum menjawab. Sesudah itu halaman ini ditinggalkan
 * menuju accounts.google.com, dan hasilnya kembali sebagai `?googleAuth=` (lihat efek di App).
 */
async function startGoogleConsent(item) {
  if (!CONTROL_API_ENABLED) {
    if (!OAUTH_FN_URL) {
      notifyWarning("Alamat server kontrol atau VITE_OAUTH_FN_URL belum dikonfigurasi.");
      return;
    }
    window.location.href = `${OAUTH_FN_URL}?configId=${item.id}`;
    return;
  }
  try {
    const { url } = await startGoogleAuth(item.id);
    window.location.href = url;
  } catch (error) {
    notifyError(error, `Tidak bisa memulai login Google untuk ${item.name || "kredensial ini"}`);
  }
}

function App() {
  const { path, navigate } = useRouter();
  const auth = useFirebaseAuth(navigate);
  // Route dihitung SEBELUM store, karena store memakainya untuk memutuskan langganan berat mana yang
  // perlu dipasang (`needsRoiSnapshots`). Keduanya cuma konstanta di antara pemanggilan hook, jadi
  // urutan hook-nya sendiri tidak berubah.
  //
  // Sesi yang masih hidup tidak pernah melihat form login. Tanpa ini, orang yang sudah login
  // membuka alamat root — pintu masuk default hosting, karena semua alamat diarahkan ke
  // index.html — akan disambut LoginPage tanpa jalan keluar selain mengetik /dashboard sendiri.
  //
  // "/" ikut dialihkan supaya alamatnya kanonik: sidebar menandai menu aktif dengan
  // path.startsWith(item.path), dan "/" tidak cocok dengan satu pun menu.
  //
  // Rutenya sudah dialihkan di sini, bukan hanya di efek di bawah, supaya tidak ada satu frame
  // pun yang sempat menampilkan halaman "tidak ditemukan" sebelum efeknya jalan.
  //
  // Tamu murni (lihat GUEST_PAGES) ikut dialihkan dari halaman mana pun yang tidak boleh ia buka —
  // termasuk /dashboard, tujuan bawaan login. Yang ia terima kalau tidak adalah "Akses ditolak" di
  // halaman pertama sesudah login, untuk akun yang memang dibuat cuma untuk tiga laporan.
  const role = auth.user?.role;
  const home = homePath(role);
  const requested = resolveRoute(path, resources);
  const redirectHome =
    Boolean(auth.user) &&
    (path === "/login" ||
      path === "/" ||
      (isGuestOnly(role) && Boolean(requested.key) && !canOpenPage(role, requested.key)));
  const route = redirectHome ? resolveRoute(home, resources) : requested;
  const dataStore = useFirebaseStore(navigate, resources, auth.user, Boolean(auth.user), route);
  /**
   * Pencatat jejak aktivitas — dipasang untuk SETIAP sesi, bukan hanya yang boleh membaca /activity-logs.
   *
   * Di sini, di App, dan bukan di dalam halaman jejaknya: yang dicatat adalah aktivitas seluruh
   * tim, dan sebuah pencatat yang hidup di halaman itu cuma akan mencatat superadmin yang sedang
   * membuka halaman itu.
   *
   * `path` dioper apa adanya (tanpa query) — lihat catatan di `logPageView`: filter dan pencarian
   * tinggal di query alamat, jadi query yang ikut tercatat berarti satu baris jejak per HURUF yang
   * diketik di kotak pencarian.
   */
  useActivityLogger(auth.user, path);
  const readOnly = !canWrite(role, route.key);
  // The fields a non-admin may still write on an existing row — campaignCodes on a subdomain, and
  // nothing else anywhere. Null means the normal all-or-nothing form.
  const restrictedFields =
    readOnly && route.id && canEditCampaignCodes(role)
      ? resources[route.key]?.advertiserFields
      : null;
  // Typing the URL by hand must not get further than the sidebar does. Firebase would refuse
  // anyway; this just replaces a stack of permission-denied toasts with one explanation.
  const forbidden =
    Boolean(route.key) &&
    (!canOpenPage(role, route.key) || (route.kind === "form" && readOnly && !restrictedFields));
  // `replace`, bukan push: alamat yang dialihkan tetap tinggal di riwayat kalau di-push, dan Back
  // memantul ke sini lagi — untuk tamu, tanpa henti.
  useEffect(() => {
    if (redirectHome) {
      navigate(home, { replace: true });
    }
  }, [redirectHome, home, navigate]);

  /**
   * Baris daftar sebuah resource, berikut kolom yang DITURUNKAN saat dirender dan bukan disimpan
   * di RTDB: label "Nonaktif" di Status Sync milik ad account yang saklarnya dimatikan, dan
   * seluruh kolom otomatis Invalid Traffic (earning, belanja, net profit). Yang ikut ditulis ke
   * database akan benar pada detik ia ditulis dan basi sesudahnya — dan yang menuliskannya adalah
   * halaman yang sedang dibaca orang.
   *
   * Satu properti resource, bukan cabang `route.key ===` per halaman: cabang begitu tidak pernah
   * kelihatan sebagai keputusan begitu ia bertambah satu.
   *
   * Lewat useMemo, dan itu bukan kerapian: `invalidTrafficRows` menyisir SELURUH `roiReports`
   * (puluhan ribu baris) tiap kali dipanggil, dan dipanggil di dalam JSX ia menyisirnya ulang tiap
   * kali ada satu huruf diketik di kotak pencarian.
   */
  const listItems = useMemo(() => {
    const config = resources[route.key];
    const rows = dataStore.store[route.key];
    return config?.derive ? config.derive(rows, dataStore.store) : rows;
  }, [route.key, dataStore.store]);

  /**
   * Hasil consent Google, yang datang lewat ALAMAT dan bukan lewat promise.
   *
   * Alurnya meninggalkan aplikasi ini menuju accounts.google.com dan kembali sebagai redirect, jadi
   * tidak ada satu pun handler yang bertahan untuk membawa hasilnya — yang tersisa cuma query.
   *
   * Query-nya dihapus dengan `replace`, dan itu bukan kerapian: dibiarkan, satu kali Back akan
   * memunculkan toast yang sama untuk consent yang sudah selesai berjam-jam lalu.
   */
  useEffect(() => {
    const result = googleAuthReturn(window.location.search);
    if (!result) return;
    if (result.kind === "success") notifySuccess(result.message);
    else if (result.kind === "warning") notifyWarning(result.message, result.detail);
    else notifyError(new Error(result.detail || ""), result.message);
    navigate(window.location.pathname, { replace: true });
  }, [navigate]);

  /**
   * Dua tab Settings yang sudah tidak ada isinya, karena keduanya pindah ke Notification Center:
   * `?tab=telegram` (tujuan notifikasi) dan `?tab=peringatan` (ambang peringatan ROI). Alamat
   * keduanya beredar sebagai bookmark dan tertulis di beberapa catatan, jadi dialihkan alih-alih
   * dibiarkan membuka halaman Settings dengan tab yang tidak dikenali siapa pun.
   *
   * `replace`, sepola dengan pengalihan /gating: dengan push, alamat lamanya tetap tinggal di
   * riwayat dan tombol Back memantul ke sini lagi tanpa henti.
   */
  useEffect(() => {
    if (path !== "/settings") return;

    const tab = new URLSearchParams(window.location.search).get("tab");
    const moved = SETTINGS_TABS_MOVED[tab];
    if (moved) navigate(moved, { replace: true });
  }, [path, navigate]);

  // Halaman yang alamatnya berganti (PAGES_MOVED). resolveRoute masih mengenali alamat lamanya —
  // bookmark dan tautan lama tidak boleh berakhir di halaman "tidak ditemukan" — dan yang di sini
  // cuma menulis ulang alamatnya ke yang kanonik, supaya sidebar menandai menunya
  // (`path.startsWith`) dan alamat yang disalin dari bilah alamat adalah alamat yang sekarang.
  //
  // `replace`, bukan push: dengan push, alamat lamanya tetap tinggal di riwayat dan tombol Back
  // memantul ke sini lagi tanpa henti.
  useEffect(() => {
    const moved = PAGES_MOVED[path];
    if (moved) {
      // Query-nya ikut dibawa: alamat lama yang beredar bisa saja sudah membawa filter, dan
      // pengalihan yang membuangnya menghasilkan halaman yang berbeda dari yang ditautkan.
      navigate(`${moved}${window.location.search}`, { replace: true });
    }
  }, [path, navigate]);

  if (auth.authLoading) {
    return <div className="boot-screen">Loading TigerROI...</div>;
  }

  if (!auth.user) {
    return (
      <>
        <LoginPage
          onLogin={auth.login}
          onLoginAsDemo={auth.loginAsDemo}
          loading={auth.authLoading}
        />
        <AppToaster />
      </>
    );
  }

  return (
    <>
      <DashboardShell
        path={path}
        navigate={navigate}
        user={auth.user}
        onLogout={auth.logout}
        syncStatus={dataStore.store.syncStatus}
        syncIssues={dataStore.store.syncIssues}
        syncRetries={dataStore.store.syncRetries}
        syncRuns={dataStore.store.syncRuns}
        reminders={dataStore.store.reminders}
        canCompleteReminder={canWrite(role, "reminders")}
        canRecordReminderExpense={canWrite(role, "expenses")}
        onCompleteReminder={dataStore.completeReminder}
        tabBadges={tabBadgesOf(dataStore.store)}
      >
        <ErrorBoundary resetKey={path}>
          <Suspense fallback={<EmptyMessage panel>Memuat halaman...</EmptyMessage>}>
            {forbidden && (
              <EmptyPage
                navigate={navigate}
                home={home}
                title="Akses ditolak"
                description={accessDeniedReason(route.key, role)}
              />
            )}
            {!forbidden && route.kind === "dashboard" && (
              <Overview
                store={dataStore.store}
                navigate={navigate}
                tab={route.tab}
                role={role}
                viewer={auth.user}
              />
            )}
            {!forbidden && route.kind === "settings" && (
              <SettingsPage
                settings={dataStore.store.roiSettings}
                onSave={dataStore.saveRoiSettings}
                readOnly={!canEditSettings(role)}
                syncStatus={dataStore.store.syncStatus}
                onChangePassword={auth.changePassword}
              />
            )}
            {/* Terbuka untuk SEMUA role — satu-satunya halaman di grup Admin yang begitu. Yang
                membatasi cuma `canManage`: setelan topik, siaran per role, dan daftar grup adalah
                milik bersama, sementara saklar "saya mau menerima apa" milik tiap orang sendiri.
                Yang benar-benar menegakkannya aturan `users/$uid/notificationTopics` dan
                `notificationGroups` di database.rules.json, bukan prop ini. */}
            {!forbidden && route.kind === "notifications" && (
              <NotificationCenter
                store={dataStore.store}
                viewer={auth.user}
                canManage={canManageNotifications(role)}
                tab={route.tab}
                navigate={navigate}
                /* Ambang peringatan ROI ikut ke sini bersama tab-nya: yang menjawab "berapa
                   ambangnya" dan yang menjawab "siapa yang dikabari" sekarang satu halaman. */
                alerts={dataStore.store.alertSettings}
                onSaveAlerts={dataStore.saveAlertSettings}
                onSaveSettings={dataStore.saveNotificationSettings}
                /* Tab "Calon Penerima": chat yang terdeteksi menyapa bot jadi penerima dengan satu
                   klik, tanpa ada chat id yang disalin tangan dari terminal. */
                onActivateChat={dataStore.activateDetectedChat}
                onDismissChat={dataStore.dismissDetectedChat}
              />
            )}
            {/* Baris orang lain hanya bisa diubah admin, dan itu diperiksa DUA kali: di sini
                (supaya alamat yang diketik tangan tidak membuka baris orang lain) dan oleh aturan
                `users/$uid/notificationTopics` di database.rules.json, yang benar-benar menolak
                tulisannya. Yang di sini menggantikan toast permission-denied dengan satu kalimat. */}
            {!forbidden && route.kind === "notificationPersonForm" && (
              <NotificationPersonForm
                row={(dataStore.store.users || []).find((entry) => entry.id === route.id)}
                canManage={canManageNotifications(role)}
                isOwn={ownUserRow(dataStore.store.users, auth.user)?.id === route.id}
                /* `!== false`, bukan nilainya apa adanya: sebelum langganan pertama dipasang kunci
                   ini belum ada di peta sama sekali, dan `undefined` yang dibaca sebagai "sudah
                   selesai" mengembalikan kedipan "tidak ditemukan" yang persis mau ditutup. */
                loading={dataStore.loadingMap?.users !== false}
                settings={dataStore.store.notificationSettings}
                subDomains={dataStore.store.subDomains}
                navigate={navigate}
                onSaveTopics={dataStore.saveNotificationTopics}
                onSaveChatId={dataStore.saveTelegramChatId}
              />
            )}
            {!forbidden && route.kind === "notificationContactForm" && (
              <NotificationContactForm
                group={(dataStore.store.notificationGroups || []).find(
                  (entry) => entry.id === route.id,
                )}
                groups={dataStore.store.notificationGroups}
                groupId={route.id}
                canManage={canManageNotifications(role)}
                loading={dataStore.loadingMap?.notificationGroups !== false}
                /* Nama PIC yang benar-benar dipakai armada, bukan daftar user: yang dicocokkan saat
                   mengirim adalah `pic` di baris ROI, dan itu turunan `subDomains.pic`. */
                pics={picOptions(dataStore.store.subDomains)}
                navigate={navigate}
                onSave={dataStore.saveNotificationGroup}
                onRemove={dataStore.removeNotificationGroup}
              />
            )}
            {!forbidden && route.kind === "profitLoss" && <ProfitLoss store={dataStore.store} />}
            {/* Rantai yang sama dengan Laba Rugi, dipecah per subdomain. Admin + Keuangan lewat
                KEUANGAN_PAGES, dan `forbidden` di atas yang menegakkannya — tidak ada prop izin
                kedua karena halaman ini tidak menulis apa pun: seluruh angkanya diturunkan dari
                node yang sudah punya halamannya masing-masing. */}
            {!forbidden && route.kind === "cashFlow" && <CashFlow store={dataStore.store} />}
            {/* Rantai yang sama, dikelompokkan per domain. Izin dan alasannya identik dengan Cash
                Flow di atas: KEUANGAN_PAGES, ditegakkan `forbidden`, tanpa prop izin kedua karena
                halaman ini tidak menulis apa pun. */}
            {!forbidden && route.kind === "domainProfit" && (
              <DomainProfit store={dataStore.store} />
            )}
            {/* Superadmin saja, dan `forbidden` di atas yang menegakkannya lewat canReadResource.
                Berbeda dari gating dan plugin, di sini itu benar-benar SATU-SATUNYA penjaganya:
                halaman ini tidak membaca satu pun node yang tertutup dan tidak memanggil server
                mana pun, jadi tidak ada aturan database maupun gerbang server di belakangnya
                (lihat SUPERADMIN_PAGES di config/access.js). Tidak ada prop izin kedua — yang
                diketik orang di halaman ini cuma dana proyeksi, dan itu tinggal di alamat. */}
            {!forbidden && route.kind === "spending" && <Spending store={dataStore.store} />}
            {/* Superadmin saja, dan `forbidden` di atas yang menegakkannya lewat canReadResource —
                `canGate` di bawah cuma menentukan tombolnya digambar atau tidak. Yang benar-benar
                menahan tetap aturan `dashboard/gating/commands` di database.rules.json. */}
            {!forbidden && route.kind === "gating" && (
              <ViControl
                store={dataStore.store}
                canGate={canGateCampaign(role)}
                onGate={dataStore.setCampaignGate}
                onRefresh={dataStore.refreshGating}
              />
            )}
            {/* Superadmin saja, dan `forbidden` di atas yang menegakkannya lewat canReadResource —
                `canManage` di bawah cuma menentukan tombolnya digambar atau tidak. Yang benar-benar
                menahan adalah gerbang superadmin di server/plugin.js: berbeda dari gating, halaman
                ini tidak menulis apa pun ke RTDB, jadi tidak ada aturan database yang menjaganya. */}
            {!forbidden && route.kind === "plugin" && (
              <Plugin
                store={dataStore.store}
                canManage={canManagePlugin(role)}
                onAddCloakingUrls={dataStore.addCloakingUrls}
                onRemoveCloakingUrl={dataStore.removeCloakingUrl}
                onRemoveGptTemplate={dataStore.removeGptTemplate}
                onSaveAdsenseSlots={dataStore.saveAdsenseSlots}
                onSaveGptTemplate={dataStore.saveGptTemplate}
                onUpdateGptTemplate={dataStore.updateGptTemplate}
                tab={route.tab}
                /* `!== false`, bukan nilai apa adanya: sebelum langganan pertama dipasang, kunci
                   ini belum ada di peta sama sekali — dan `undefined` yang dibaca sebagai "sudah
                   selesai" mengembalikan bug yang persis mau ditutup. */
                loading={dataStore.loadingMap?.subDomains !== false}
              />
            )}
            {/* Superadmin saja, sepola /plugin: `forbidden` di atas menyaring tab dan halamannya,
                dan yang benar-benar menahan adalah gerbang superadmin di server/cloudflare.js —
                halaman ini tidak menulis apa pun ke RTDB, jadi tidak ada aturan database yang bisa
                ikut menjaganya. `store` dioper untuk MENJODOHKAN saja (zona -> baris /domains,
                record -> baris /sub-domains); sumber recordnya tetap Cloudflare. */}
            {!forbidden && route.kind === "dnsRecords" && <DnsRecords store={dataStore.store} />}
            {!forbidden && route.kind === "setupSub" && <SetupSub store={dataStore.store} />}
            {/* Superadmin saja — `forbidden` di atas yang menegakkannya lewat canReadResource, dan
                gerbang superadmin di server/campaign-manage.js yang benar-benar menahan tulisannya.
                Saklarnya memakai jalur yang sama dengan profil user (`setCampaignStatus`). */}
            {!forbidden && route.kind === "campaigns" && (
              <CampaignFleet
                navigate={navigate}
                onRemovePreset={dataStore.removeCountryPreset}
                onSavePreset={dataStore.saveCountryPreset}
                onToggleCampaign={(row, active) =>
                  dataStore.setCampaignStatus(row.userId, row, active)
                }
                store={dataStore.store}
                tab={route.tab}
              />
            )}
            {/* Superadmin saja — `forbidden` di atas yang menegakkannya lewat canReadResource,
                dan di sini itu benar-benar satu-satunya penjaganya: halaman ini tidak membaca dan
                tidak menulis satu pun node RTDB, jadi tidak ada aturan database di belakangnya. */}
            {!forbidden && route.kind === "otp" && (
              <OtpPage
                items={dataStore.store.otpSecrets}
                onAdd={() => navigate("/otp/new")}
                onDelete={dataStore.removeOtpSecret}
              />
            )}
            {/* Superadmin saja — `forbidden` di atas yang menegakkannya lewat canReadResource, dan
                `.read` pada `activityLogs` di database.rules.json yang benar-benar menolak sisanya.
                Halaman ini murni membaca: tidak ada satu pun tombol di dalamnya yang mengubah data,
                jadi tidak ada prop izin kedua yang perlu dioper. */}
            {!forbidden && route.kind === "activityLogs" && (
              <ActivityLogs store={dataStore.store} />
            )}
            {!forbidden && route.kind === "otpForm" && (
              <OtpForm onSave={dataStore.saveOtpSecret} onCancel={() => navigate("/otp")} />
            )}
            {!forbidden && route.kind === "targets" && (
              <Targets
                store={dataStore.store}
                navigate={navigate}
                readOnly={!canWriteTargets(role)}
              />
            )}
            {!forbidden &&
              route.kind === "targetForm" &&
              (canWriteTargets(role) ? (
                <TargetForm
                  store={dataStore.store}
                  domainId={route.domainId}
                  month={route.month}
                  slug={route.slug}
                  onSave={async (domainId, month, slug, values) => {
                    await dataStore.saveTarget(domainId, month, slug, values);
                    navigate("/targets");
                  }}
                  onCancel={() => navigate("/targets")}
                />
              ) : (
                <EmptyPage
                  navigate={navigate}
                  title="Akses ditolak"
                  description="Halaman ini hanya untuk admin dan keuangan."
                />
              ))}
            {!forbidden && route.kind === "list" && (
              <ResourceList
                config={resources[route.key]}
                readOnly={readOnly}
                items={listItems}
                loading={dataStore.loadingMap?.[route.key]}
                onAdd={() => navigate(`${resources[route.key].path}/new`)}
                onView={(id) => navigate(`${resources[route.key].path}/${id}`)}
                onEdit={(id) => navigate(`${resources[route.key].path}/${id}/edit`)}
                onDelete={(id) => dataStore.remove(route.key, id)}
                onAuthAction={startGoogleConsent}
                onImport={(rows) => dataStore.importItems(route.key, rows)}
                onDiscover={() => dataStore.discoverNetworks(route.key)}
                canEdit={
                  !readOnly ||
                  (canEditCampaignCodes(role) && Boolean(resources[route.key].advertiserFields))
                }
              />
            )}
            {!forbidden && route.kind === "form" && (
              <ResourceForm
                config={resources[route.key]}
                item={dataStore.store[route.key].find((entry) => entry.id === route.id)}
                store={dataStore.store}
                siblings={dataStore.store[route.key]}
                only={restrictedFields}
                onCancel={() => navigate(resources[route.key].path)}
                onSubmit={(values) => {
                  // The restricted save writes the named fields alone. `update` would send
                  // id/updatedAt/updatedBy too, which live under the admin-only parent and would
                  // take the whole write down with them.
                  if (restrictedFields) {
                    return dataStore.updateFields(route.key, route.id, values);
                  }

                  return route.id
                    ? dataStore.update(route.key, route.id, values)
                    : dataStore.create(route.key, values);
                }}
              />
            )}
            {!forbidden &&
              route.kind === "detail" &&
              (route.key === "users" ? (
                <UserDetail
                  userId={route.id}
                  store={dataStore.store}
                  navigate={navigate}
                  readOnly={readOnly}
                  onMapCampaign={(campaignId, subDomain) =>
                    dataStore.setCampaignSubdomain(route.id, campaignId, subDomain)
                  }
                  // Saklar on/off campaign tidak ikut `readOnly` halaman ini: yang boleh menekannya
                  // adalah admin ATAU pemilik campaign-nya sendiri, dan yang kedua bukan admin.
                  // Identitas penonton dioper apa adanya; UserDetail yang mencocokkannya dengan
                  // profil yang sedang dibuka (canToggleCampaign).
                  viewer={auth.user}
                  onSetCampaignStatus={(campaign, active) =>
                    dataStore.setCampaignStatus(route.id, campaign, active)
                  }
                />
              ) : (
                <EmptyPage navigate={navigate} />
              ))}
            {route.kind === "missing" && <EmptyPage navigate={navigate} home={home} />}
          </Suspense>
        </ErrorBoundary>
      </DashboardShell>
      <AppToaster />
    </>
  );
}

// Toast digaya lewat token, bukan hex. react-hot-toast menulis `style` inline ke elemennya, dan
// `var(--token)` di sana bekerja seperti di stylesheet mana pun — jadi warnanya ikut tema perangkat
// tanpa komponen ini perlu tahu tema apa yang sedang berlaku. (Grafik tidak bisa begitu: warnanya
// berakhir sebagai atribut SVG, yang tidak memahami var(). Lihat src/lib/chartTheme.js.)
function AppToaster() {
  return (
    <Toaster
      position="top-right"
      toastOptions={{
        duration: 3200,
        style: {
          border: "1px solid var(--toast-border)",
          background: "var(--toast-bg)",
          color: "var(--toast-foreground)",
        },
        success: {
          iconTheme: {
            primary: "var(--toast-success)",
            secondary: "var(--toast-bg)",
          },
        },
        error: {
          iconTheme: {
            primary: "var(--toast-error)",
            secondary: "var(--toast-bg)",
          },
        },
      }}
    />
  );
}

// Atribut temanya sudah dipasang skrip boot di index.html sebelum halaman dicat. Yang ditambahkan
// di sini adalah dua hal yang tidak bisa dilakukan sebelum stylesheet ada dan sebelum halaman
// hidup: warna bilah alamat (dibaca dari --background) dan pelanggan setelan perangkat, untuk
// orang yang belum pernah menekan tombolnya.
initTheme();

createRoot(document.getElementById("root")).render(
  <ErrorBoundary fullScreen>
    <App />
  </ErrorBoundary>,
);
