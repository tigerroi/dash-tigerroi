import { ArrowLeft, Mail, MessageSquare, UserRound } from "lucide-react";
import { useMemo } from "react";
import { canToggleCampaign, isSuperAdmin } from "../config/access";
import { useUrlRange, useUrlState } from "../hooks/useUrlState";
import { adTaxRateOf, earningAccountType, formatRoiPercent, withAdTax } from "../lib/adTax";
import { toCommandMap } from "../lib/campaignCommands";
import { describeMappingSource, normalizeCampaignRows } from "../lib/campaignRows";
import { getCampaignTone } from "../lib/campaignTone";
import { buildCountryBreakdown } from "../lib/countryBreakdown";
import { formatCtrPercent, normalizeCountryRoiRow, summarizeCountryRoi } from "../lib/countryRoi";
import {
  filterByDateField,
  filterByDateWindow,
  filterRunningDay,
  todayRange,
} from "../lib/dateRange";
import { firstValue } from "../lib/firstValue";
import { formatDate } from "../lib/formatDate";
import { resultLabel } from "../lib/metaResults";
import { MoneyByCurrency, renderCell } from "../lib/renderCell";
import { realtimeRoiRows } from "../lib/roiRealtime";
import { sortTableItems } from "../lib/sortTableItems";
import { subDomainOwnerIndex } from "../lib/subDomainOwners";
import { toAmount } from "../lib/toAmount";
import { countryRoiSources, userReportBranch } from "../lib/userReports";
import { assignedSubDomains, rowsForSubDomains, subDomainNameKeys } from "../lib/userSubDomains";
import { CampaignAdSets } from "./CampaignAdSets";
import { CampaignStatusCell } from "./campaigns/CampaignStatusCell";
import { DataTable } from "./ui/DataTable";
import { DateRangePicker } from "./ui/DateRangePicker";
import { EmptyMessage } from "./ui/EmptyMessage";
import { ExpandToggle } from "./ui/ExpandToggle";
import { PageHeader } from "./ui/PageHeader";
import { RealtimeRoiTable } from "./ui/RealtimeRoiTable";
import { SelectField, toSelectOptions } from "./ui/SelectField";
import { moneyColumn } from "./ui/tableColumns";

export function UserDetail({
  userId,
  store,
  navigate,
  readOnly = false,
  onMapCampaign,
  onSetCampaignStatus,
  viewer,
}) {
  const firebaseUser = store.users.find((item) => item.id === userId);
  const profile = firebaseUser ? buildProfileFromStore(firebaseUser, store) : {};
  const subDomainOwners = useMemo(
    () => subDomainOwnerIndex(store.subDomains, store.domains),
    [store.subDomains, store.domains],
  );
  const initials = getInitials(profile.name);
  // Hari berjalan, sama dengan tabel ROI di Overview: yang dicari saat membuka halaman ini adalah
  // keadaan sekarang. Pemilih periode di tiap panel yang menyebutkan hari mana yang sedang tampil.
  // Default "Hari Ini" ({from,to} sehari), digerakkan DateRangePicker yang sama dengan tabel lain.
  //
  // Keempatnya di alamat: halaman ini dibuka dari daftar user dan ditinggalkan ke halaman lain
  // (campaign, subdomain), dan periode serta subdomain yang sedang diperiksa harus masih terpilih
  // saat orang menekan Back. Lihat `useUrlState`.
  const [countryRoiRange, setCountryRoiRange] = useUrlRange("negara", todayRange);
  const [masterRoiRange, setMasterRoiRange] = useUrlRange("master", todayRange);
  const [masterRoiSub, setMasterRoiSub] = useUrlState("masterSub", "");
  const [selectedSubDomain, setSelectedSubDomain] = useUrlState("subdomain", "");
  // Tarif ad tax dari halaman Settings, untuk baris yang belum membawa pajaknya sendiri.
  const adTaxRate = adTaxRateOf(store.roiSettings);
  // Saklar campaign berdiri di luar `readOnly` halaman ini: halaman /users tertutup untuk ditulis
  // selain admin, tapi campaign miliknya sendiri justru yang harus bisa ia matikan. Cerminan
  // aturan `users/$uid/campaignCommands` di database.rules.json.
  const canToggle = canToggleCampaign(viewer?.role, profile.email, viewer?.email);
  const campaignCommands = toCommandMap(profile.campaignCommands);
  const filteredCountryRoi = useMemo(
    () => filterByDateWindow(toArray(profile.countryRoi), countryRoiRange),
    [profile.countryRoi, countryRoiRange],
  );
  // Baris harian milik user ini — satu baris per hari per subdomain. Ia yang boleh DIJUMLAHKAN,
  // dan kartu ringkasan di bawah memang menjumlahkannya.
  const masterRoiDaily = useMemo(
    () => toArray(profile.masterRoiReports),
    [profile.masterRoiReports],
  );
  // Baris siapa: subdomain yang DIPEGANG user ini sekarang, bukan kolom `pic` di barisnya. `pic`
  // baris adalah stempel saat baris ditulis dan tidak pernah diperbarui — subdomain yang berpindah
  // tangan meninggalkan ratusan baris ber-PIC lama. Lihat src/lib/userSubDomains.js.
  const ownedSubDomainKeys = useMemo(
    () => subDomainNameKeys(toArray(profile.subDomains)),
    [profile.subDomains],
  );
  // Isi tabelnya sendiri: snapshot per sync (dashboard/roiSnapshots, disaring ke subdomain user
  // ini), plus baris harian untuk hari-hari yang snapshotnya sudah lewat masa simpan — persis
  // tabel ROI di Overview. Panel ini memang bernama "Realtime"; sampai sekarang isinya justru satu
  // baris per hari, yaitu keadaan sync terakhir hari itu saja.
  const masterRoiRows = useMemo(
    () =>
      realtimeRoiRows(
        rowsForSubDomains(toArray(store.roiSnapshots), ownedSubDomainKeys),
        masterRoiDaily,
      ),
    [store.roiSnapshots, ownedSubDomainKeys, masterRoiDaily],
  );
  const filteredMasterRoi = useMemo(
    () => filterByDateWindow(masterRoiRows, masterRoiRange),
    [masterRoiRows, masterRoiRange],
  );
  // Pilihan subdomain adalah subdomain yang DIPEGANG user ini, bukan yang kebetulan punya baris di
  // rentang yang tersimpan. Daftar yang diturunkan dari baris menghilangkan subdomain yang belum
  // menghasilkan apa-apa — persis subdomain yang paling perlu dicek — dan membuat isi pemilihnya
  // berubah-ubah mengikuti masa simpan snapshot. Subdomain tanpa baris memberi tabel kosong, dan
  // itu jawaban yang benar: barisnya memang belum ada.
  const masterSubOptions = useMemo(() => {
    const names = new Set();
    for (const sub of toArray(profile.subDomains)) {
      const name = firstValue(sub?.name);
      if (name && name !== "-") names.add(name);
    }
    return [...names].sort();
  }, [profile.subDomains]);
  const shownMasterRoi = useMemo(
    () => (masterRoiSub ? rowsForSubDomains(filteredMasterRoi, [masterRoiSub]) : filteredMasterRoi),
    [filteredMasterRoi, masterRoiSub],
  );
  // Revenue (Today) di tabel Sub Domain Assigned = hari BERJALAN, bukan hari lengkap terakhir:
  // advertiser berpatokan pada GAM yang menampilkannya real-time. Diambil dari baris ROI hari
  // berjalan (snapshot per sync), dipetakan per subdomain — bukan `subDomains.revenueToday`, yang
  // sengaja hanya diisi hari yang sudah selesai. Subdomain tanpa baris hari ini jatuh ke record-nya.
  const todayRevenueBySub = useMemo(() => {
    const map = new Map();
    for (const row of filterRunningDay(masterRoiRows)) {
      const name = firstValue(row.subDomain);
      if (name && !map.has(name)) map.set(name, row);
    }
    return map;
  }, [masterRoiRows]);
  const subDomainItems = useMemo(
    () =>
      toArray(profile.subDomains).map((sub) => {
        const today = todayRevenueBySub.get(sub.name);
        if (!today) return sub;
        return {
          ...sub,
          accountType: earningAccountType(today),
          revenueToday: today.earning,
          currency: today.currency,
          fxRate: today.fxRate,
          cpc: firstValue(today.cpc, sub.cpc),
          ecpm: firstValue(today.ecpm, today.pageRpm, sub.ecpm),
        };
      }),
    [profile.subDomains, todayRevenueBySub],
  );
  // Ringkasan per subdomain dihitung dari baris HARIAN, bukan dari isi tabel di atasnya. Baris
  // snapshot kumulatif sejak tengah malam, jadi menjumlahkan enam belas sync hari ini akan
  // melaporkan pendapatan enam belas kali lipat.
  const filteredMasterRoiDaily = useMemo(
    () => filterByDateWindow(masterRoiDaily, masterRoiRange),
    [masterRoiDaily, masterRoiRange],
  );
  // Diturunkan dari baris yang SEDANG TAMPIL, bukan seluruh riwayat. Sebelumnya kartunya
  // menjumlahkan semua hari yang tersimpan sambil berjudul "ROI Hari Ini" — pada 9 Agu 2026 itu
  // berarti Rp12,9 juta untuk hari yang sebenarnya Rp4,6 juta.
  const subDomainSummaries = useMemo(
    () => buildSubDomainSummaries(toArray(profile.subDomains), filteredMasterRoiDaily, adTaxRate),
    [filteredMasterRoiDaily, profile.subDomains, adTaxRate],
  );
  // Tanggal yang benar-benar sedang tampil, dibaca dari barisnya sendiri — sama seperti Overview.
  const masterRoiDate = useMemo(() => {
    const dates = new Set(filteredMasterRoi.map((item) => String(item?.date || "").slice(0, 10)));
    dates.delete("");
    return dates.size === 1 ? formatDate([...dates][0]) : "";
  }, [filteredMasterRoi]);
  const activeSubDomainSummary = subDomainSummaries.find(
    (item) => item.subDomain === selectedSubDomain,
  );
  const countryRoiGroups = useMemo(
    () => groupBySubDomain(filteredCountryRoi, adTaxRate),
    [filteredCountryRoi, adTaxRate],
  );
  // Rincian negara tiap baris tabel realtime — kolom Negara, sama dengan tabel ROI di Overview.
  // Dikumpulkan dari SELURUH user, bukan cuma dari profil yang sedang dibuka: baris negara
  // dimiliki lewat PIC subdomain, jadi subdomain yang baru berpindah tangan masih meninggalkan
  // baris hari itu di user sebelumnya — dan lencana yang membaca satu user saja akan kosong
  // persis pada baris yang paling baru berubah. `store.userReports` memang sudah dilanggan di
  // route ini (`needsUserReports` di lib/heavyData.js), jadi tidak ada unduhan tambahan.
  const countryBreakdown = useMemo(
    () => buildCountryBreakdown(countryRoiSources(store.users, store.userReports), adTaxRate),
    [store.users, store.userReports, adTaxRate],
  );

  return (
    <div className="page-stack user-detail-page">
      <PageHeader
        title="Profile User"
        description="Detail informasi pengguna dan aset yang terhubung."
        action={
          <div className="header-actions">
            <button className="ghost-button" onClick={() => navigate("/users")} type="button">
              <ArrowLeft size={16} />
              Kembali
            </button>
          </div>
        }
      />

      <section className="profile-panel">
        <div className="profile-cover" />
        <div className="profile-content">
          <div className="profile-identity">
            <div className="profile-avatar">{initials}</div>
            <span className="badge purple">{profile.role || "-"}</span>
          </div>

          <div className="profile-title">
            <h2>{profile.name || "User tidak ditemukan"}</h2>
            <p>@ {profile.username || "-"}</p>
          </div>

          <div className="profile-metrics">
            <ProfileMetric
              label="Total Saldo (Semua Act)"
              value={profile.totalBalance}
              tone="success"
            />
            <ProfileMetric icon={Mail} label="Email" value={profile.email || "-"} />
            <ProfileMetric
              icon={MessageSquare}
              label="Telegram ID"
              value={profile.telegramChatId || "-"}
            />
            <ProfileMetric
              icon={UserRound}
              label="Bergabung Pada"
              value={profile.joinedAt || "-"}
            />
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Sub Domain Assigned</h2>
            {/* Kolom Revenue/CPC/eCPM = hari berjalan (real-time), diisi dari baris ROI hari ini —
                advertiser berpatokan pada GAM yang juga menampilkannya real-time. Angkanya setengah
                hari dan naik tiap sync. Subdomain yang belum punya baris hari ini menampilkan angka
                sync terakhirnya. */}
            <p>Daftar sub domain beserta performa Google Ad Manager hari ini (real-time).</p>
          </div>
        </div>
        <SubDomainAssignedTable
          items={subDomainItems}
          onSelect={(item) => setSelectedSubDomain(item.name)}
        />
        {activeSubDomainSummary && (
          <SubDomainSummaryCard item={activeSubDomainSummary} periodLabel={masterRoiDate} />
        )}
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Daftar Ad Account (Act) & Saldo</h2>
            <p>Saldo dan spend terbaru untuk akun iklan milik user ini.</p>
          </div>
        </div>
        <DataTable
          columns={[
            ["name", "Nama Akun Ads"],
            ["actId", "ACT ID Meta"],
            ["balance", "Sisa Saldo"],
            ["spendCap", "Batas Pengeluaran"],
            ["spendToday", "Pengeluaran Hari Ini"],
            ["syncStatus", "Status Sync"],
          ]}
          // Akun yang saklar Sync Meta-nya dimatikan berhenti disync, jadi "Status Sync" harus
          // menyebutnya Nonaktif — bukan "Synced" yang membeku dari sync terakhirnya.
          items={toArray(profile.adAccounts).map((account) =>
            account.syncDisabled ? { ...account, syncStatus: "Nonaktif" } : account,
          )}
          paginate
        />
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Manajemen Kampanye (Campaign)</h2>
            <p>
              Daftar campaign aktif untuk akun iklan milik {profile.name || "user"}.
              {canToggle
                ? " Saklar di kolom Status menyalakan dan mematikannya langsung di Meta."
                : ""}
            </p>
          </div>
        </div>
        <CampaignManagementTable
          userId={userId}
          items={normalizeCampaignRows(profile.campaigns)}
          // Every subdomain, not just this user's: Sync ROI matches the mapping by name across
          // the whole list, and a freshly imported subdomain has no PIC yet — scoping the
          // options to the user would make it unmappable until someone assigns one.
          subDomains={store.subDomains}
          readOnly={readOnly}
          onMapCampaign={onMapCampaign}
          commands={campaignCommands}
          canToggle={canToggle}
          onToggleCampaign={onSetCampaignStatus}
          viewer={viewer}
        />
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Riwayat Spend Campaign</h2>
            {/* Beda dari Manajemen Kampanye di atas yang menampilkan keadaan sekarang, ini riwayat
                per-hari (masa simpan 90 hari) — di sinilah filter rentang tanggal & Kode Keitaro
                punya banyak hari untuk dikerjakan. */}
            <p>
              Spend & hasil tiap campaign per hari. Diisi Sync Meta; masa simpan 90 hari terakhir.
            </p>
          </div>
        </div>
        <CampaignHistoryTable items={profile.campaignHistory} />
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Rekap Riwayat Saldo Berkurang (Daily Spend)</h2>
            <p>Catatan pengurangan saldo harian dari akun iklan user.</p>
          </div>
        </div>
        <DataTable
          columns={[
            ["date", "Tanggal"],
            ["account", "Ad Account"],
            ["campaign", "Campaign"],
            ["amount", "Saldo Berkurang"],
            ["note", "Catatan"],
          ]}
          items={toArray(profile.dailySpend)}
          paginate
        />
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Riwayat Snapshot Saldo (Log Per-Sync)</h2>
            <p>Rekaman saldo terakhir setiap proses sync dijalankan.</p>
          </div>
        </div>
        <DataTable
          columns={[
            ["syncedAt", "Waktu Sync"],
            ["account", "Ad Account"],
            ["balance", "Saldo Snapshot"],
            ["dailyReduction", "Pengurangan Hari Ini"],
            ["source", "Sumber"],
            ["note", "Catatan"],
          ]}
          items={toArray(profile.balanceSnapshots)}
          paginate
        />
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            {/* Tanpa keterangan prosa, sama dengan panel ROI di Overview: periodenya disebut
                pemilih di sebelah kanan judul, dan umur tiap baris oleh kolom Date + Time-nya
                sendiri. */}
            <h2>Report Master Realtime ROI Khusus Anda</h2>
          </div>
          {/* Hari berjalan diisi snapshot per sync, hari-hari sebelumnya satu baris per hari —
              jadi filter ini punya riwayat untuk dikerjakan. Dulu node-nya berkunci id subdomain
              dan ditimpa tiap sync: filter apa pun di atas data satu hari cuma bisa menghasilkan
              "semua tampil" atau "kosong". */}
          <div className="header-actions">
            <SelectField
              ariaLabel="Filter sub-domain Report Master ROI"
              className="compact-control"
              value={masterRoiSub}
              onChange={setMasterRoiSub}
              options={[
                { value: "", label: "Semua Sub-Domain" },
                ...toSelectOptions(masterSubOptions, subDomainOwners.fullOf),
              ]}
            />
            <DateRangePicker
              align="right"
              label="Filter periode Report Master ROI"
              onChange={setMasterRoiRange}
              value={masterRoiRange}
            />
          </div>
        </div>
        <RealtimeRoiTable
          countryBreakdown={countryBreakdown}
          formatSubDomain={subDomainOwners.fullOf}
          items={shownMasterRoi}
          rate={adTaxRate}
        />
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>ROI per Negara - Khusus {profile.name || "User"}</h2>
          </div>
          <div className="header-actions country-roi-header-actions">
            <DateRangePicker
              align="right"
              label="Filter ROI per Negara"
              onChange={setCountryRoiRange}
              value={countryRoiRange}
            />
          </div>
        </div>
        <CountryRoiGroups groups={countryRoiGroups} />
      </section>
    </div>
  );
}

function SubDomainSummaryCard({ item, periodLabel }) {
  return (
    <article className="subdomain-summary-card single">
      <span>{item.subDomain}</span>
      <div>
        <strong>{item.metaSpend}</strong>
        <small>Meta Spend</small>
      </div>
      <div>
        <strong>
          <MoneyByCurrency value={item.gamRevenue} currency={item.currency} fxRate={item.fxRate} />
        </strong>
        {/* Kalau ada baris yang earning-nya gagal diambil, angka ini kurang dari yang sebenarnya —
            dan itu disebut, bukan dibiarkan tampil sebagai total yang utuh. */}
        {/* "Total Earning", bukan "GAM Revenue": yang dijumlahkan adalah earning seluruh sumber,
            dan subdomain yang dimonetisasi lewat AdSense tidak punya pendapatan GAM sama sekali. */}
        <small>Total Earning{item.unknown ? ` (${item.unknown} baris belum ada)` : ""}</small>
      </div>
      <div>
        <strong className={item.roiValue >= 0 ? "money-positive" : "money-negative"}>
          {formatPercent(item.roiValue)}
        </strong>
        {/* Periodenya disebut. "ROI Hari Ini" pada angka yang menjumlahkan tiga hari adalah label
            yang salah, dan tidak ada cara membacanya dari layar. */}
        <small>ROI {periodLabel || "periode terpilih"}</small>
      </div>
    </article>
  );
}

// Tidak ada kolom Actions di sini. Tombol Delete-nya cuma memunculkan window.confirm dan tidak
// pernah menghapus apa pun; subdomain diarsipkan lewat /sub-domains, yang punya alur konfirmasi
// dan izin yang sebenarnya.
function SubDomainAssignedTable({ items, onSelect }) {
  return (
    <DataTable
      columns={[
        {
          accessorKey: "name",
          header: "Sub Domain",
          cell: ({ row }) => (
            <button
              className="table-link-button"
              onClick={() => onSelect(row.original)}
              type="button"
            >
              {row.original.name}
            </button>
          ),
        },
        ["parentDomain", "Domain Induk"],
        ["accountType", "Jenis Akun"],
        ["status", "Status"],
        {
          accessorKey: "revenueToday",
          header: "Revenue (Today)",
          // Network USD tampil dengan simbolnya sendiri; IDR hasil konversi saat di-hover.
          cell: ({ row }) => (
            <MoneyByCurrency
              value={row.original.revenueToday}
              currency={row.original.currency}
              fxRate={row.original.fxRate}
            />
          ),
        },
        ["cpc", "CPC"],
        ["ecpm", "eCPM"],
      ]}
      getRowId={(item, index) => String(item.id || item.name || index)}
      items={items}
      paginate
      paginationLabel="subdomain"
    />
  );
}

// Tabel datar: satu baris per campaign Meta.
//
// Baris ini dulu bisa dibuka dan memperlihatkan "rincian"-nya, tapi tidak ada satu pun sumber data
// yang pernah mengisi detailItems/children — isi yang terbuka selalu campaign yang sama sekali
// lagi, dan kolom Penayangan selalu menulis "1 Aktif / 1 campaign". Yang benar-benar menumpuk
// beberapa campaign adalah satu subdomain, dan itu sudah punya tempatnya sendiri: badge "Campaign
// digabung" di tabel ROI.
//
// Kolom "Sumber" (AdX/AdSense/Meta) ikut hilang: dropdown-nya tidak pernah disimpan, tidak pernah
// dibaca, dan tidak ada data di belakangnya — seluruh tabel ini memang campaign Meta.
function CampaignManagementTable({
  userId,
  items,
  subDomains,
  readOnly = false,
  onMapCampaign,
  commands = {},
  canToggle = false,
  onToggleCampaign,
  viewer,
}) {
  // Tabel ini LIVE (satu baris per campaign, keadaan sekarang), jadi filter tanggal tak berarti —
  // ia ada di "Riwayat Spend Campaign". Yang tinggal di sini cuma penyaring Kode Keitaro, untuk
  // mempersempit daftar campaign yang hidup lewat `campaignCode`.
  const [codeFilter, setCodeFilter] = useUrlState("kode", "");
  // Baris yang sedang dibuka ad set-nya, di ALAMAT dan bukan di `useState`: panel ini memicu satu
  // panggilan ke Meta, dan orang yang membukanya lalu pergi ke halaman subdomain untuk memeriksa
  // sesuatu harus menemukannya masih terbuka saat menekan Back. `replace`, bukan `push` — ia
  // membuka isi di dalam halaman yang sama, jadi Back yang menutupnya satu per satu akan berubah
  // jadi tombol "tutup panel" alih-alih membawa orang kembali dari mana ia datang.
  const [openAdSets, setOpenAdSets] = useUrlState("adset", "");

  // Daftar kode diturunkan dari datanya sendiri, terurut, supaya pilihan yang ditawarkan selalu
  // punya baris untuk ditampilkan — bukan kode yang dikarang yang mengosongkan tabel saat dipilih.
  const codeOptions = useMemo(() => uniqueCampaignCodes(items), [items]);
  // Satu daftar untuk seluruh baris: tiap baris tabel memuat pemilihnya sendiri, dan menyusun ulang
  // daftar yang sama per baris per render cuma membuat tiap select menerima opsi "baru".
  const subDomainOptions = useMemo(
    () => [
      { value: "", label: "Kosongkan Sub Domain" },
      ...toArray(subDomains).map((subDomain) => ({ value: subDomain.name, label: subDomain.name })),
    ],
    [subDomains],
  );

  const filteredItems = useMemo(
    () => (codeFilter ? toArray(items).filter((item) => item.campaignCode === codeFilter) : items),
    [items, codeFilter],
  );

  // Baris yang terbuka tinggal di alamat sebagai `campaignId`; DataTable mengenal baris lewat
  // `id`-nya, jadi petanya diturunkan di sini.
  const expanded = useMemo(() => {
    const open = toArray(filteredItems).find(
      (item) => item.campaignId && item.campaignId === openAdSets,
    );
    return open ? { [open.id]: true } : {};
  }, [filteredItems, openAdSets]);

  // Tabel KONTROL: pemetaan sub-domain, saklar status, dan anggaran. Kolom performa (Hasil, Biaya
  // per hasil, Spend) dulu ada di sini juga tapi kembar dengan "Riwayat Spend Campaign" yang
  // memuatnya per hari — jadi dibaca di sana, bukan sebagai angka hari ini yang berdiri sendiri.
  const columns = [
    {
      accessorKey: "campaign",
      header: "Kampanye",
      cell: ({ row }) => {
        const item = row.original;
        const open = Boolean(item.campaignId) && openAdSets === item.campaignId;
        return (
          <div className="campaign-name-cell">
            {/* Baris tanpa `campaignId` tidak punya alamat di Meta — sama dengan saklar di kolom
                Status, tombolnya dimatikan berikut alasannya, bukan digambar seolah ad set-nya
                bisa dibaca lalu gagal setelah diklik. */}
            <ExpandToggle
              label={`ad set campaign ${item.campaign}`}
              disabled={!item.campaignId}
              onToggle={() => setOpenAdSets(open ? "" : item.campaignId)}
              open={open}
              title={
                item.campaignId
                  ? "Lihat ad set di dalam campaign ini"
                  : "Baris ini tidak punya ID campaign di Meta, jadi ad set-nya tidak bisa diminta."
              }
            />
            <span className={`campaign-status-dot ${getCampaignTone(item.status)}`} />
            <div>
              {/* Nama dipotong elipsis saat kolomnya sempit; judul lengkapnya di title. */}
              <strong title={item.campaign}>{item.campaign}</strong>
              <span title={`Akun: ${item.account}`}>Akun: {item.account}</span>
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: "subDomain",
      header: "Sub Domain",
      cell: ({ row }) => {
        const canEditSubdomain = isSuperAdmin(viewer?.role);
        return (
          <>
            <SelectField
              className="campaign-pill-select indigo"
              // Controlled and persisted. Hanya Superadmin yang boleh mengubah pemetaan sub domain.
              value={row.original.subDomain || ""}
              disabled={!canEditSubdomain || readOnly || !onMapCampaign}
              title={
                !canEditSubdomain
                  ? "Hanya Superadmin yang dapat mengubah pemetaan sub domain kampanye."
                  : undefined
              }
              onChange={(next) => onMapCampaign?.(row.original.id, next)}
              options={subDomainOptions}
              searchable
            />
            <small className="muted-line">{describeMappingSource(row.original)}</small>
          </>
        );
      },
    },
    {
      // Diurutkan lewat POSISI SAKLAR (`configuredStatus`: ACTIVE/PAUSED), bukan label — yang itu
      // memisahkan "Aktif" dari "Terjadwal", dan campaign yang jadwalnya belum sampai akan jatuh ke
      // bawah campaign yang mati. Asc = On (ACTIVE) dulu, lalu Off, lalu yang belum terbaca
      // (kosong) di paling bawah.
      // ponytail: mengabaikan perintah pending 2 menit (saklar sudah On, configuredStatus masih
      // PAUSED sampai sync). Kalau perlu presisi, sort lewat campaignToggleState(...).on.
      accessorKey: "configuredStatus",
      header: "Status",
      cell: ({ row }) => (
        <CampaignStatusCell
          item={row.original}
          command={commands[row.original.campaignId]}
          canToggle={canToggle}
          onToggle={onToggleCampaign}
        />
      ),
    },
    {
      // Kolom Hasil, Biaya per hasil, dan Spend hari ini dibuang — kembar dengan "Riwayat Spend
      // Campaign" yang memuatnya per hari. Yang tinggal cuma Anggaran, satu-satunya angka yang
      // murni setelan campaign (bukan performa harian).
      accessorKey: "dailyBudget",
      header: "Anggaran",
      cell: ({ row }) => (
        <>
          <strong>{renderCell(row.original.dailyBudget, "dailyBudget")}</strong>
          <small className="muted-line">{describeBudget(row.original.dailyBudget)}</small>
        </>
      ),
      meta: { align: "right" },
    },
  ];

  return (
    <>
      <div className="toolbar">
        <div className="toolbar-filters" />
        <div className="table-tools">
          <SelectField
            ariaLabel="Filter Kode Keitaro"
            className="compact-control"
            value={codeFilter}
            onChange={setCodeFilter}
            options={[{ value: "", label: "Semua Kode Keitaro" }, ...toSelectOptions(codeOptions)]}
          />
        </div>
      </div>
      <DataTable
        className="campaign-table"
        columns={columns}
        defaultSort={DEFAULT_CAMPAIGN_SORT}
        expanded={expanded}
        expandedRowClassName="adset-detail-row"
        items={filteredItems}
        pageResetKey={codeFilter}
        paginate
        paginationLabel="campaign"
        // Saklar ad set-nya mengikuti izin yang SAMA dengan saklar campaign di kolom Status — satu
        // aturan (`mayToggleCampaign` di server), bukan dua.
        renderExpanded={(item) => (
          <CampaignAdSets campaignId={item.campaignId} canToggle={canToggle} userId={userId} />
        )}
        wrapClassName="campaign-table-wrap"
      />
    </>
  );
}

// Bawaannya terurut posisi saklar: campaign yang On (`configuredStatus: ACTIVE`) di atas, lalu Off,
// lalu yang posisinya belum terbaca (kosong) di paling bawah. Yang dicari orang saat membuka profil
// adalah campaign yang sedang membelanjakan uang, dan urutan Meta menyebarnya ke seluruh halaman.
const DEFAULT_CAMPAIGN_SORT = { key: "configuredStatus", direction: "asc" };

// Kode Keitaro unik dari sekumpulan baris (campaign atau riwayat), terurut. Dipakai mengisi
// pilihan filter — hanya kode yang benar-benar ada, jadi memilihnya tidak pernah mengosongkan tabel.
function uniqueCampaignCodes(items) {
  const codes = new Set();
  for (const item of toArray(items)) {
    if (item.campaignCode) codes.add(item.campaignCode);
  }
  return [...codes].sort((a, b) => a.localeCompare(b, "id-ID", { numeric: true }));
}

// Riwayat spend campaign per-hari (userReports/{id}.campaignHistory), disaring rentang tanggal (`date`)
// dan Kode Keitaro (`campaignCode`). Berbeda dari Manajemen Kampanye yang live: di sini banyak baris
// per campaign — satu per hari — jadi kedua filter itu benar-benar punya sesuatu untuk dikerjakan.
function CampaignHistoryTable({ items }) {
  // Parameternya berawalan `riwayat`, terpisah dari filter Kode di Manajemen Kampanye: keduanya
  // tampil di halaman yang sama, dan satu nama untuk dua filter berarti menyaring yang satu ikut
  // menyaring yang lain.
  const [dateRange, setDateRange] = useUrlRange("riwayatTanggal", { from: "", to: "" });
  const [codeFilter, setCodeFilter] = useUrlState("riwayatKode", "");

  const codeOptions = useMemo(() => uniqueCampaignCodes(items), [items]);

  const filteredItems = useMemo(() => {
    const byDate = filterByDateField(toArray(items), "date", dateRange);
    return codeFilter ? byDate.filter((item) => item.campaignCode === codeFilter) : byDate;
  }, [items, dateRange, codeFilter]);

  return (
    <>
      <div className="toolbar">
        <div className="toolbar-filters">
          <DateRangePicker
            label="Rentang tanggal riwayat spend"
            onChange={setDateRange}
            value={dateRange}
          />
        </div>
        <div className="table-tools">
          <SelectField
            ariaLabel="Filter Kode Keitaro"
            className="compact-control"
            value={codeFilter}
            onChange={setCodeFilter}
            options={[{ value: "", label: "Semua Kode Keitaro" }, ...toSelectOptions(codeOptions)]}
          />
        </div>
      </div>
      <DataTable
        columns={[
          ["date", "Tanggal"],
          {
            accessorKey: "campaign",
            header: "Campaign",
            cell: ({ row }) => (
              <>
                <strong>{row.original.campaign}</strong>
                <small className="muted-line">Akun: {row.original.account}</small>
              </>
            ),
          },
          ["campaignCode", "Kode"],
          ["subDomain", "Sub Domain"],
          moneyColumn("spend", "Spend"),
          {
            accessorKey: "results",
            header: "Hasil",
            cell: ({ row }) => (
              <>
                {row.original.results}
                {row.original.resultType ? (
                  <em className="cell-note muted">{resultLabel(row.original.resultType)}</em>
                ) : null}
              </>
            ),
            meta: { align: "center" },
          },
          moneyColumn("costPerResult", "Biaya/hasil"),
        ]}
        defaultSort={DEFAULT_HISTORY_SORT}
        // Sama dengan komposisi kunci RTDB-nya (tanggal__akun__campaign), jadi unik per baris.
        getRowId={(item) => `${item.date}-${item.account}-${item.campaignId || item.campaign}`}
        items={filteredItems}
        pageResetKey={`${dateRange.from}..${dateRange.to}|${codeFilter}`}
        paginate
        paginationLabel="riwayat"
      />
    </>
  );
}

const DEFAULT_HISTORY_SORT = { key: "date", direction: "desc" };

// Meta hanya punya anggaran di level campaign kalau anggarannya memang diatur di sana (CBO). Kalau
// dipegang ad set, tidak ada angka campaign-level untuk ditampilkan — kolomnya kosong karena
// begitu, bukan karena campaign-nya tidak dianggarkan.
function describeBudget(dailyBudget) {
  const missing =
    dailyBudget === "" || dailyBudget === "-" || dailyBudget === null || dailyBudget === undefined;
  return missing ? "Tidak diatur di level campaign" : "Total/hari";
}

function CountryRoiGroups({ groups }) {
  // "Tidak ada data" saja tidak bisa dibedakan dari "sync-nya belum pernah jalan", dan itu justru
  // keadaan yang paling sering. Yang mengisi tabel ini hanya Sync ROI, jadi namanya disebut.
  if (groups.length === 0) {
    return (
      <EmptyMessage>
        Belum ada data ROI negara pada periode ini. Tabel ini diisi Sync ROI — jalankan dari topbar
        (atau <code>npm run sync:roi</code>), lalu pastikan subdomain-nya punya PIC.
      </EmptyMessage>
    );
  }

  return (
    <div className="country-roi-stack">
      {groups.map((group) => (
        <details className="country-roi-group" key={group.subDomain} open>
          <summary>
            <span>{group.subDomain}</span>
            <small>
              Total Spend {formatRupiah(group.summary.totalSpending)} (Meta{" "}
              {formatRupiah(group.summary.spending)} + Ad Tax {formatRupiah(group.summary.adTax)}) /
              GAM Revenue {formatRupiah(group.summary.earning)}
              {group.summary.unknown
                ? ` (${group.summary.unknown} negara belum ada earning-nya)`
                : ""}{" "}
              / ROI {formatRoiPercent(group.summary.roi)}
              {/* CPC dan eCPM sesubdomain, sebagai pembanding tiap barisnya: yang dicari di
                  tabel ini adalah negara yang menarik rata-ratanya naik atau turun, dan tanpa
                  rata-ratanya di layar tiap baris harus dibandingkan dengan angka di kepala. */}
              {group.summary.cpc === null ? null : (
                <>
                  {" "}
                  / CPC {formatRupiah(group.summary.cpc)} / eCPM {formatRupiah(group.summary.ecpm)}{" "}
                  / CTR {formatCtrPercent(group.summary.ctr)}
                </>
              )}
            </small>
          </summary>
          <CountryRoiTable items={group.items} />
        </details>
      ))}
    </div>
  );
}

// Tanpa kolom checkbox: baris negara bisa dicentang tapi tidak ada satu pun aksi massal yang
// membacanya, sama seperti kontrol Auto-Block dan tombol Analisis yang dulu di atasnya.
// Bawaannya ROI TERTINGGI, bukan urutan mentahnya. Kunci RTDB baris negara adalah
// `hari__subdomain__KODE ISO`, jadi tabel yang belum disentuh terurut menurut kode negara —
// "United Arab Emirates" di atas "Bangladesh" — dan itu urutan yang tidak menjawab satu pun
// pertanyaan yang membawa orang ke panel ini. Yang dicari selalu negara yang paling
// menguntungkan, dan sekarang ia sudah berdiri di baris pertama tanpa satu klik pun.
//
// Baris tanpa ROI ("" karena belanjanya di bawah `MIN_ROI_SPEND` — tiga per empat tabel, negara
// yang menghasilkan lewat trafik organik tanpa campaign Meta) tetap jatuh ke bawah; itu urusan
// `sortTableItems`, bukan bawaan ini.
const DEFAULT_COUNTRY_SORT = { key: "roi", direction: "desc" };

function CountryRoiTable({ items }) {
  return (
    <DataTable
      className="country-roi-table"
      columns={[
        ["countryLabel", "Negara"],
        ["spending", "Spend (Meta)"],
        ["adTax", "Ad Tax"],
        ["totalSpending", "Total Spend"],
        ["earning", "Earnings (GAM)"],
        // Sisi trafiknya, dari laporan GAM yang sama dengan earning di sebelahnya. Yang paling
        // dicari di antara ketiganya adalah CPC: CTR tiap negara berdempetan, sementara CPC-nya
        // berbeda berkali lipat — itulah yang membuat satu negara menarik eCPM subdomain naik.
        ["impressions", "Impresi"],
        ["clicks", "Klik"],
        {
          // Bukan renderCell: ia akan menulis "20" untuk CTR 20%, dan di antara kolom uang angka
          // telanjang itu terbaca sebagai rupiah.
          accessorKey: "ctr",
          header: "CTR",
          cell: ({ getValue }) => formatCtrPercent(getValue()),
        },
        ["cpc", "CPC"],
        ["ecpm", "eCPM"],
        {
          // Bukan renderCell: ROI di sini persentase, dan renderCell hanya akan menampilkan
          // angkanya tanpa "%" — 138 dan 138% terbaca sangat berbeda.
          accessorKey: "roi",
          header: "ROI %",
          cell: ({ getValue }) => formatRoiPercent(getValue()),
          meta: { className: (item) => (item.roi < 0 ? "money-negative" : "money-positive") },
        },
        ["status", "Status"],
      ]}
      defaultSort={DEFAULT_COUNTRY_SORT}
      getRowId={getCountryRoiId}
      items={items}
      paginate
      paginationLabel="negara"
    />
  );
}

function ProfileMetric({ icon: Icon, label, value, tone }) {
  return (
    <article className={`profile-metric ${tone || ""}`}>
      <div>
        {Icon && <Icon size={16} />}
        <span>{label}</span>
      </div>
      <strong>{value}</strong>
    </article>
  );
}

function buildProfileFromStore(user, store) {
  // Riwayat panel-panel di halaman ini, dari pohonnya sendiri — bukan lagi dari bawah `users/{id}`.
  // Aturan "yang baru menang, yang lama jadi cadangan" tinggal di lib/userReports.js, satu tempat
  // dengan yang dipakai rincian negara di tab "Laporan ROI Realtime".
  //
  // Dilanggan hanya waktu halaman ini terbuka (`needsUserReports`), jadi pada render pertama ia
  // masih kosong dan panelnya berbunyi "Tidak ada data" sekejap — perilaku yang sama dengan panel
  // "Report Master Realtime ROI" di halaman ini juga, yang sumbernya `roiSnapshots`.
  const history = (key) => userReportBranch(user, store.userReports, key);

  const nestedSubDomains = toArray(user.subDomains);
  const assigned = assignedSubDomains(user, toArray(store.subDomains));
  const profileSubDomains = assigned.length > 0 ? assigned : nestedSubDomains;
  // Baris ROI milik user ini = baris subdomain-subdomain itu. Menyaringnya lewat `pic` baris akan
  // memotong riwayat setiap subdomain yang pernah berpindah PIC — lihat src/lib/userSubDomains.js.
  const ownedKeys = subDomainNameKeys(profileSubDomains);
  // Prefer the explicit owner or alias match; fall back to the old name-substring guess
  const userKeys = [user?.id, user?.name, user?.username, user?.email]
    .filter(Boolean)
    .map((k) => String(k).trim().toLowerCase());

  const checkOwnerMatch = (item) => {
    if (!item) return false;
    const owner = String(item.userOwner || item.pic || "").trim().toLowerCase();
    const actUserId = item.picUserId || item.pic_user_id || item.userId;
    if (actUserId && (actUserId === user.id || actUserId === user.name)) return true;
    if (owner && userKeys.includes(owner)) return true;
    for (const uk of userKeys) {
      if (owner.length >= 3 && uk.length >= 3 && (uk.startsWith(owner) || owner.startsWith(uk))) return true;
      if (owner === "sul" && uk.includes("zulfan")) return true;
      if (owner === "man" && (uk.includes("def") || uk.includes("mas"))) return true;
      if (owner === "nur" && uk.includes("lightman")) return true;
    }
    return false;
  };

  const owned = store.adAccounts.filter(checkOwnerMatch);
  const adAccounts =
    owned.length > 0
      ? owned
      : store.adAccounts.filter((item) =>
          userKeys.some((uk) =>
            String(item.name || "")
              .toLowerCase()
              .includes(uk),
          ),
        );
  const profileReports =
    toArray(user.masterRoiReports).length > 0
      ? toArray(user.masterRoiReports)
      : toArray(user.roiReports).length > 0
        ? toArray(user.roiReports)
        : rowsForSubDomains(toArray(store.roiReports), ownedKeys);

  const profileAdAccounts =
    toArray(user.adAccounts).length > 0 ? toArray(user.adAccounts) : adAccounts;

  return {
    ...user,
    joinedAt: formatDate(user.createdAt),
    // Dijumlahkan dari akun-akun itu sendiri. `users/{id}.totalBalance` tidak pernah ditulis oleh
    // apa pun, jadi kartunya selalu "Rp 0" — angka yang salah, bukan angka yang belum ada.
    totalBalance: sumBalances(profileAdAccounts),
    subDomains: profileSubDomains,
    adAccounts: profileAdAccounts,
    roiReports:
      toArray(user.roiReports).length > 0
        ? toArray(user.roiReports)
        : rowsForSubDomains(toArray(store.roiReports), ownedKeys),
    campaigns: buildUserCampaigns(user.campaigns, profileReports),
    // Terbaru di atas. Kunci RTDB-nya diawali tanggal (`2026-08-07__akun__campaign`), jadi
    // urutan bawaannya adalah urutan kunci: hari paling lama duluan, dan hari ini terdorong
    // ke halaman terakhir — persis baris yang dicari orang saat membuka panel ini.
    dailySpend: sortTableItems(toArray(history("dailySpend")), { key: "date", direction: "desc" }),
    // Kunci RTDB berurut naik (sync terlama duluan), jadi tanpa pengurutan snapshot terbaru
    // terdorong ke halaman terakhir. Diurutkan turun lewat `syncedAt` — persis baris yang dicari
    // orang saat membuka panel, sama dengan dailySpend di atasnya.
    balanceSnapshots: sortTableItems(
      normalizeBalanceSnapshots(history("balanceSnapshots"), history("dailySpend")),
      { key: "syncedAt", direction: "desc" },
    ),
    masterRoiReports: normalizeMasterReports(profileReports),
    countryRoi: toArray(history("countryRoi")),
    // Riwayat spend campaign per-hari — kunci RTDB berawalan tanggal, jadi diurutkan turun supaya
    // hari terbaru di atas. Filter rentang tanggal + Kode Keitaro-nya bekerja di tabelnya sendiri.
    campaignHistory: sortTableItems(toArray(history("campaignHistory")), {
      key: "date",
      direction: "desc",
    }),
  };
}

// No positional fallback for `subDomain`: filling it from subDomains[index] showed a mapping that
// was never stored, so the table claimed a campaign was mapped while the sync saw nothing and
// left ROI blank. An unmapped campaign has to look unmapped.
function buildUserCampaigns(campaigns, reports) {
  const campaignItems = toArray(campaigns);

  if (campaignItems.length > 0) {
    return campaignItems;
  }

  return toArray(reports)
    .filter((report) => report.campaign)
    .map((report, index) => ({
      id: report.id || `${report.campaign}-${index}`,
      campaign: report.campaign,
      subDomain: report.subDomain || "",
      source: report.source || report.revenueSource || "",
      status: report.status || "Active",
      result: firstValue(report.earning, report.adsense),
      costPerResult: firstValue(report.cpr, report.cpc),
      dailyBudget: firstValue(report.dailyBudget),
      spendToday: firstValue(report.spending, report.metaAds),
      spendDate: firstValue(report.date),
    }));
}

function normalizeMasterReports(items) {
  return toArray(items).map((item) => ({
    ...item,
    ecpm: firstValue(item.ecpm, item.pageRpm),
    cpr: firstValue(item.cpr),
  }));
}

// Sync menulis `dailyReduction` sendiri. Fallback-nya tetap ada untuk baris lama yang belum
// punya kolom itu — tapi hanya kalau kolomnya memang tidak ada: `snapshot.dailyReduction || …`
// menelan angka 0, dan akun yang hari ini tidak belanja jadi tampak seperti data yang hilang.
function normalizeBalanceSnapshots(snapshots, dailySpend) {
  const dailySpendItems = toArray(dailySpend);

  return toArray(snapshots).map((snapshot) => {
    if (snapshot.dailyReduction !== undefined && snapshot.dailyReduction !== "") {
      return snapshot;
    }

    return {
      ...snapshot,
      dailyReduction: dailySpendItems
        .filter((item) => item.account === snapshot.account)
        .reduce((sum, item) => sum + Math.abs(toAmount(item.amount)), 0),
    };
  });
}

// Ringkasan satu subdomain, dari baris yang sama dengan yang dibaca tabel di atasnya.
//
// ROI-nya dibagi TOTAL SPENDING (spend + ad tax), sama dengan Overview dan ROI per Negara.
// Sebelumnya dibagi spend telanjang, jadi satu subdomain melaporkan dua ROI yang berbeda di dua
// halaman untuk uang yang sama — 355,80% di sini, 334,10% di Overview — dan tidak ada apa pun di
// layar yang bisa menjelaskan selisihnya.
function buildSubDomainSummaries(subDomains, reports, rate) {
  const reportItems = toArray(reports);

  return toArray(subDomains).map((subDomain) => {
    const rows = reportItems.filter((item) => item.subDomain === subDomain.name);
    const totals = { spending: 0, totalSpending: 0, earning: 0 };
    let unknown = 0;
    // Satu subdomain = satu network = satu mata uang, jadi kurs baris mana pun mewakili semuanya.
    let currency = "IDR";
    let fxRate = null;
    for (const row of rows) {
      if (row.currency) currency = row.currency;
      if (typeof row.fxRate === "number") fxRate = row.fxRate;
      const money = withAdTax(row, rate);
      // Spend yang tidak teratribusi dilewati, bukan dijumlahkan sebagai nol — dan kalau
      // ditambahkan apa adanya, "" membuat totalnya jadi teks ("0" + 100 = "0100").
      if (money.spendingKnown) {
        totals.spending += money.spending;
        totals.totalSpending += money.totalSpending;
      }
      // Earning yang tidak diketahui tidak ikut dijumlahkan sebagai nol — itu akan menyeret ROI
      // ringkasannya ke bawah seolah subdomainnya rugi.
      if (money.earningKnown) {
        totals.earning += money.earning;
      } else {
        unknown++;
      }
    }

    // Tanpa baris, jatuh ke angka di record subdomain berikut mata uangnya sendiri.
    if (!rows.length) {
      currency = subDomain.currency || "IDR";
      fxRate = typeof subDomain.fxRate === "number" ? subDomain.fxRate : null;
    }
    return {
      subDomain: subDomain.name,
      metaSpend: formatRupiah(totals.spending),
      // Angka IDR (sudah dikonversi); kartunya menampilkan mata uang aslinya lewat MoneyByCurrency.
      gamRevenue: rows.length ? totals.earning : toAmount(subDomain.revenueToday),
      currency,
      fxRate,
      roiValue: totals.totalSpending
        ? ((totals.earning - totals.totalSpending) / totals.totalSpending) * 100
        : 0,
      unknown,
      hasRows: rows.length > 0,
    };
  });
}

function groupBySubDomain(items, rate) {
  const groups = new Map();

  for (const item of toArray(items)) {
    const key = item.subDomain || "Tanpa Subdomain";
    const current = groups.get(key) || { subDomain: key, items: [] };

    current.items.push(normalizeCountryRoiRow(item, rate));
    groups.set(key, current);
  }

  // Ringkasannya dihitung setelah tiap baris dinormalkan, jadi ad tax dan total spending yang
  // dijumlahkan adalah angka yang sama persis dengan yang dibaca orang di barisnya.
  return [...groups.values()].map((group) => ({
    ...group,
    summary: summarizeCountryRoi(group.items),
  }));
}

function getCountryRoiId(item) {
  return item.id || `${item.subDomain || "country"}-${item.country || item.countryLabel}`;
}

function toArray(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.filter(Boolean);
  }

  if (typeof value === "object") {
    return Object.entries(value).map(([id, item]) => ({
      id,
      ...item,
    }));
  }

  return [];
}

function sumBalances(accounts) {
  const items = toArray(accounts);

  if (items.length === 0) {
    return "-";
  }

  return formatRupiah(items.reduce((sum, item) => sum + toAmount(item.balance), 0));
}

function formatRupiah(value) {
  return `Rp ${Math.abs(value).toLocaleString("id-ID", { maximumFractionDigits: 0 })}`;
}

function formatPercent(value) {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function getInitials(name = "") {
  return (
    name
      .split(" ")
      .filter(Boolean)
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "U"
  );
}
