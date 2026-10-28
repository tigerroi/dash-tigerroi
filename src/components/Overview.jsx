import { Activity, BadgeDollarSign, FileUp, Globe2, TriangleAlert, Users } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { canReadResource } from "../config/access";
import { useFillViewport } from "../hooks/useFillViewport";
import { useUrlRange, useUrlState } from "../hooks/useUrlState";
import { adTaxRateOf, withAdTax } from "../lib/adTax";
import { advertiserRoiSeries } from "../lib/advertiserRoiSeries";
import { lowBalanceAdvertisers } from "../lib/alerts";
import { buildCalendarMonth, dayDetail } from "../lib/calendarReport";
import { cellText } from "../lib/cellText";
import { monthCoverage } from "../lib/chartScope";
import { buildCountryBreakdown } from "../lib/countryBreakdown";
import {
  currentMonthRange,
  filterByDateWindow,
  isRunningRow,
  monthKeyOf,
  monthKeysOf,
  monthLabelOf,
  monthRange,
  runningDayKey,
  shiftMonthKey,
  todayRange,
} from "../lib/dateRange";
import { formatDate, formatMonth } from "../lib/formatDate";
import { buildFounderRoi } from "../lib/founderRoi";
import { hourlyFinancials } from "../lib/hourlyFinancials";
import { renderCell } from "../lib/renderCell";
import { realtimeRoiRows } from "../lib/roiRealtime";
import { filterRowsByOwner, ownerChoices, subDomainOwnerIndex } from "../lib/subDomainOwners";
import { subDomainRoiSeries } from "../lib/subDomainRoiSeries";
import { countryRoiSources } from "../lib/userReports";
import { KeitaroCsvImportDialog } from "./campaigns/KeitaroCsvImportDialog";
import { FillRate } from "./FillRate";
import { ScheduledLaunches } from "./ScheduledLaunches";
import { DataTable } from "./ui/DataTable";
import { DateRangePicker } from "./ui/DateRangePicker";
import { EmptyMessage } from "./ui/EmptyMessage";
import { FilterDialog } from "./ui/FilterDialog";
import { LineChart } from "./ui/LineChart";
import { OwnerFilterFields } from "./ui/OwnerFilterFields";
import { PageHeader } from "./ui/PageHeader";
import { RealtimeRoiTable } from "./ui/RealtimeRoiTable";
import { CalendarDayPanel, ReportCalendar } from "./ui/ReportCalendar";
import { RoiCurveChart } from "./ui/RoiCurveChart";
import {
  SubDomainRoiCurveChart,
  SubDomainRoiSpendChart,
  SubDomainRoiTable,
} from "./ui/SubDomainRoiCharts";
import { moneyColumn, roiColumn } from "./ui/tableColumns";

function LinkButton({ to, navigate, children, className = "" }) {
  return (
    <button className={className} type="button" onClick={() => navigate(to)}>
      {children}
    </button>
  );
}

export function Overview({ store, navigate, tab, role, viewer }) {
  // Bulan berjalan, dihitung saat komponen dipasang — bukan konstanta modul. Tab yang dibiarkan
  // terbuka melewati pergantian bulan tidak boleh membuka bulan kemarin sambil menamainya
  // "Bulan Ini".
  //
  // Disimpan sebagai {from,to} di alamat (bentuk yang sama dengan seluruh dashboard) dan dibaca
  // sebagai {start,end} di sini — grafiknya sudah memakai nama itu sejak awal.
  const [chartRange, setChartRange] = useUrlRange("periode", currentMonthRange);
  const dateRange = useMemo(
    () => ({ start: chartRange.from, end: chartRange.to }),
    [chartRange.from, chartRange.to],
  );
  const setDateRange = useCallback(
    ({ start, end }) => setChartRange({ from: start, to: end }),
    [setChartRange],
  );
  const [keitaroOpen, setKeitaroOpen] = useState(false);
  // Baris ROI hari berjalan disimpan per SYNC (dashboard/roiSnapshots/{tanggal}T{jam}__{subdomainId}),
  // jadi tabelnya memuat tiap sync hari ini dan bukan cuma keadaan terakhir; hari-hari sebelumnya
  // datang dari baris harian (dashboard/roiReports), satu baris per hari. Defaultnya hari berjalan —
  // keadaan sekarang, yang memang jadi alasan orang membuka halaman ini. Angkanya belum selesai, dan
  // itu tidak diserahkan ke ingatan: roiNote di bawah menyebut kenapa, berikut pilihan "Yesterday"
  // untuk angka final.
  // Default "Hari Ini" ({from,to} sehari), lewat DateRangePicker yang sama dengan seluruh dashboard.
  const [roiRange, setRoiRange] = useUrlRange("roi", todayRange);
  const dashboardStats = store.dashboardStats || {};
  const weeklyFinancials = store.weeklyFinancials || [];
  const advertiserSpend = store.advertiserSpend || [];
  const lowBalance = lowBalanceAdvertisers(advertiserSpend, store.alertSettings);
  const roiReports = store.roiReports || [];
  const roiSnapshots = store.roiSnapshots || [];
  // Tarif ad tax dari halaman Settings. Dipakai hanya untuk baris yang belum membawa pajaknya
  // sendiri — baris riwayat tetap memakai tarif yang berlaku saat ia ditulis.
  const adTaxRate = adTaxRateOf(store.roiSettings);
  // Per Advertiser / Per Subdomain: weeklyFinancials adalah total bisnis tanpa dimensi ini, jadi
  // saat salah satu dipilih grafik diturunkan dari roiReports (yang membawa pic + subDomain per
  // baris harian). "Semua" di keduanya = grafik total apa adanya.
  const [advertiser, setAdvertiser] = useUrlState("advertiser", "");
  const [subDomain, setSubDomain] = useUrlState("subdomain", "");
  // Domain induk tidak ada di baris ROI — yang tahu cuma `subDomains.parentDomain`. Indeksnya
  // dipakai kedua sisi: menyaring baris harian (dua grafik total) dan baris per sync (dua grafik
  // per subdomain), supaya "Domain: rabbit.com" berarti hal yang sama di keempat grafik.
  const [domain, setDomain] = useUrlState("domain", "");
  const subDomainOwners = useMemo(
    () => subDomainOwnerIndex(store.subDomains, store.domains),
    [store.subDomains, store.domains],
  );
  // Isi ketiga dropdown — aturannya di `ownerChoices` (lib/subDomainOwners.js), satu tempat untuk
  // semua tab Overview. Lewat indeks pemilik yang sama dengan penyaring isi grafik, jadi tidak ada
  // nama di dropdown yang tidak punya satu baris pun di belakangnya.
  const choices = useMemo(
    () => ownerChoices(roiReports, subDomainOwners, { advertiser, domain }),
    [roiReports, subDomainOwners, advertiser, domain],
  );
  const advertiserOptions = choices.advertisers;
  const domainOptions = choices.domains;
  const subDomainOptions = choices.subDomains;
  // Ganti PIC melepas domain yang bukan miliknya. Dibiarkan, filter domain lama tetap menyaring
  // tanpa terlihat di dropdown yang tidak lagi menawarkannya — tabel kosong tanpa sebab.
  const changeAdvertiser = useCallback(
    (next) => {
      setAdvertiser(next);
      if (
        domain &&
        !ownerChoices(roiReports, subDomainOwners, { advertiser: next }).domains.includes(domain)
      ) {
        setDomain("");
      }
    },
    [roiReports, subDomainOwners, setAdvertiser, setDomain, domain],
  );
  // Dua grafik total membaca baris ROI (`roiReports`) — sumber yang sama dengan Kalender, tabel ROI,
  // dan sheet acuan tim, jadi keempatnya menyebut angka yang sama untuk bulan yang sama. Saklar
  // Lingkup (total usaha dari `weeklyFinancials` vs yang terpetakan) dibuang 24 Sep 2026: dua angka
  // yang sama-sama benar untuk bulan yang sama cuma membingungkan. Total usaha tetap dibaca Laba
  // Rugi, dan selisihnya disebut lencana "di luar cakupan" di Kalender.
  const filteredFinancials = useMemo(
    () =>
      aggregateRoiFinancials(roiReports, {
        advertiser,
        subDomain,
        domain,
        owners: subDomainOwners,
        start: dateRange.start,
        end: dateRange.end,
        rate: adTaxRate,
      }),
    [
      advertiser,
      subDomain,
      domain,
      subDomainOwners,
      roiReports,
      adTaxRate,
      dateRange.end,
      dateRange.start,
    ],
  );
  // Bulan yang punya data, dari kedua sumbernya sekaligus. Sejak pemilih bulan dibuang dari dialog
  // (satu periode, satu kontrol: pemilih rentang), daftar ini tinggal dipakai untuk MENGENALI bahwa
  // rentang yang dipilih kebetulan persis sebuah bulan.
  const chartMonths = useMemo(
    () => monthKeysOf([...weeklyFinancials, ...roiReports]),
    [weeklyFinancials, roiReports],
  );
  // Bulan mana yang sedang tampil, dibaca dari rentangnya sendiri — bukan disimpan sebagai state
  // kedua. Yang memakainya cuma ringkasan filter ("Agu 2026" lebih pendek daripada dua tanggal
  // penuh) dan hitungan filter aktif; rentang yang bukan sebuah bulan tidak perlu diperlakukan
  // khusus, ia hanya tidak cocok dengan satu pun di antaranya.
  const selectedMonth = useMemo(() => {
    const found = chartMonths.find((key) => {
      const { from, to } = monthRange(key);
      return from === dateRange.start && to === dateRange.end;
    });
    return found || "";
  }, [chartMonths, dateRange.start, dateRange.end]);
  // Berapa filter yang menyimpang dari default. Angka inilah yang dibawa lencana pada ikon filter:
  // begitu kontrolnya disembunyikan, satu-satunya hal yang mencegah orang salah baca adalah tanda
  // bahwa ada sesuatu yang sedang menyaring.
  // Rentang yang bukan bulan berjalan ikut terhitung menyimpang, termasuk rentang yang tidak cocok
  // dengan bulan mana pun: keduanya sama-sama bukan periode default.

  const chartFilterCount =
    (selectedMonth !== monthKeyOf(new Date()) ? 1 : 0) +
    (advertiser ? 1 : 0) +
    (domain ? 1 : 0) +
    (subDomain ? 1 : 0);
  // Keadaan filter sebagai kalimat, karena kontrolnya sudah tidak terlihat. Periode selalu
  // disebut — sebuah grafik tanpa periode yang jelas tidak bisa dibandingkan dengan apa pun.
  const chartSummary = useMemo(() => {
    const periode = selectedMonth
      ? monthLabelOf(selectedMonth, formatMonth(selectedMonth))
      : `${formatDate(dateRange.start)} – ${formatDate(dateRange.end)}`;
    const owners = [advertiser, domain, subDomain].filter(Boolean);
    return `${periode} · ${owners.length ? owners.join(" · ") : "Semua subdomain"}`;
  }, [selectedMonth, dateRange.start, dateRange.end, advertiser, domain, subDomain]);
  // Kembali ke bulan berjalan dan seluruh bisnis — keadaan yang sama dengan halaman yang baru
  // dibuka, bukan "kosongkan semuanya" yang akan menyisakan grafik tanpa periode.
  const resetChartFilters = () => {
    const { from, to } = currentMonthRange();
    setDateRange({ start: from, end: to });
    setAdvertiser("");
    setDomain("");
    setSubDomain("");
  };
  // Isi tabel realtime: snapshot per sync, plus baris harian untuk hari-hari yang snapshotnya sudah
  // lewat masa simpan. Grafik di atas TETAP membaca `roiReports` — baris snapshot kumulatif sejak
  // tengah malam, jadi menjumlahkannya per hari akan melipatgandakan pendapatan.
  const realtimeRows = useMemo(
    () => realtimeRoiRows(roiSnapshots, roiReports),
    [roiSnapshots, roiReports],
  );
  // Filter PIC/domain/subdomain tabel ROI memakai parameter yang SAMA dengan tab Grafik dan
  // Kalender (`?advertiser=`, `?domain=`, `?subdomain=`) lewat OwnerFilterFields: ketiganya tab
  // berbeda, jadi hanya satu yang tergambar sekaligus, dan aturan "domain/PIC mengosongkan
  // subdomain" tinggal di satu komponen.
  const filteredRoiReports = useMemo(
    () =>
      filterRowsByOwner(filterByDateWindow(realtimeRows, roiRange), subDomainOwners, {
        advertiser,
        domain,
        subDomain,
      }),
    [realtimeRows, roiRange, subDomainOwners, advertiser, domain, subDomain],
  );
  // Dua grafik detail per subdomain (tab Grafik). Sumbernya baris realtime yang sama dengan tabel
  // di tab sebelahnya — satu baris per sync — dengan periodenya sendiri, karena tab yang berbeda
  // adalah alamat yang berbeda dan query halaman tidak ikut berpindah.
  // Dua grafik per subdomain membaca baris per SYNC (roiSnapshots + roiReports lewat
  // `realtimeRows`), bukan baris harian seperti dua grafik di atasnya — tapi PERIODE dan filternya
  // sama persis, dari satu tempat. Empat grafik dengan empat pemilih periode berarti empat angka
  // yang tidak bisa diadu satu sama lain di layar yang sama.
  const subChartRows = useMemo(
    () =>
      filterRowsByOwner(filterByDateWindow(realtimeRows, chartRange), subDomainOwners, {
        advertiser,
        domain,
        subDomain,
      }),
    [realtimeRows, chartRange, subDomainOwners, advertiser, domain, subDomain],
  );
  const subDomainSeries = useMemo(() => {
    const result = subDomainRoiSeries(subChartRows, adTaxRate);
    // Kolom Advertiser di tabel perbandingan: PIC ditambal dari `subDomains.pic` untuk baris yang
    // ditulis sebelum subdomainnya diberi PIC — sama dengan filter Advertiser.
    const bars = result.bars.map((bar) => ({
      ...bar,
      advertiser: subDomainOwners.picOf(bar.name, bar.pic),
    }));
    return { ...result, bars };
  }, [subChartRows, adTaxRate, subDomainOwners]);
  // Kurva ROI per advertiser: satu titik per HARI, dari baris harian `roiReports` — bukan baris per
  // sync, yang kumulatif sejak tengah malam dan tidak boleh dijumlahkan per hari. Periode dan filter
  // pemiliknya sama dengan grafik lain di tab ini. Bawaannya semua advertiser menyala — jumlahnya
  // segelintir, berbeda dari subdomain yang puluhan.
  const advertiserSeries = useMemo(
    () =>
      advertiserRoiSeries(
        filterRowsByOwner(filterByDateWindow(roiReports, chartRange), subDomainOwners, {
          advertiser,
          domain,
          subDomain,
        }),
        adTaxRate,
        subDomainOwners.picOf,
      ),
    [roiReports, chartRange, subDomainOwners, advertiser, domain, subDomain, adTaxRate],
  );
  const [advertiserParam, setAdvertiserParam] = useUrlState("advertiserGrafik", "");
  const selectedAdvertisers = useMemo(() => {
    if (advertiserParam === "none") return [];
    const names = advertiserSeries.series.map((item) => item.name);
    if (!advertiserParam) return names;
    return advertiserParam.split(",").filter((name) => names.includes(name));
  }, [advertiserParam, advertiserSeries]);
  const toggleAdvertiserSeries = useCallback(
    (name) => {
      const next = selectedAdvertisers.includes(name)
        ? selectedAdvertisers.filter((item) => item !== name)
        : [...selectedAdvertisers, name];
      setAdvertiserParam(next.length ? next.join(",") : "none");
    },
    [selectedAdvertisers, setAdvertiserParam],
  );
  // "Hari Ini" dipilih → dua grafik teratas (Pendapatan/Pengeluaran/Profit dan Kurva ROI) beralih
  // dari satu titik harian ke titik PER SYNC, sama granularitasnya dengan dua grafik per subdomain
  // di bawahnya. Sumbernya baris per sync yang sama (`subChartRows`), bukan `weeklyFinancials` yang
  // tak punya jam — konsekuensinya angka hari ini datang dari subdomain yang terpetakan campaign,
  // bukan total usaha; itu satu-satunya sumber yang membawa jam.
  // ponytail: deteksi "hari ini" lewat kecocokan {from,to}, bukan preset id — todayRange sudah jadi
  // sumber default pemilihnya.
  const today = todayRange();
  const isHourlyFinancials = chartRange.from === today.from && chartRange.to === today.to;
  const hourlyFinancialsData = useMemo(
    () => hourlyFinancials(subChartRows, adTaxRate),
    [subChartRows, adTaxRate],
  );
  const financialsData = isHourlyFinancials ? hourlyFinancialsData : filteredFinancials;
  // Subdomain yang tampil, di alamat seperti filter lain. Tiga bentuk, dan ketiganya harus bisa
  // dibedakan: parameter yang TIDAK ADA berarti bawaan, daftar nama berarti pilihan orang, dan
  // "none" berarti semuanya dimatikan — yang tanpa sentinel akan terbaca sebagai bawaan, dan chip
  // terakhir yang dimatikan menyalakan kembali kurva yang baru saja dibuang orang.
  //
  // Bawaannya bergantung pada filter di kepala tab, dan itu inti aturannya:
  //
  //   tanpa filter pemilik  KOSONG — armada penuh dalam satu grafik adalah puluhan kurva yang
  //                         saling menimpa, dan warnanya mulai berulang setelah keenam belas.
  //                         Yang dibuka orang tanpa memilih apa-apa lebih baik meminta satu chip
  //                         daripada menggambar sesuatu yang tidak bisa dibaca.
  //   dengan filter         SEMUA yang lolos filter itu — jumlahnya sudah dibatasi advertiser atau
  //                         domain yang dipilih, dan meminta orang memilih dua kali untuk
  //                         penyempitan yang sama adalah pekerjaan yang tidak menghasilkan apa-apa.
  //
  // Bawaannya sempat delapan pembelanja terbesar, dan itu salah dengan cara yang lebih buruk dari
  // keduanya: chip menyala untuk delapan nama tanpa satu pun tanda bahwa ada yang tidak digambar,
  // jadi grafik yang dibaca sebagai "seluruh armada" sebenarnya memuat sebagian.
  const [subDomainParam, setSubDomainParam] = useUrlState("subdomainGrafik", "");
  const selectedSubDomains = useMemo(() => {
    if (subDomainParam === "none") return [];
    const names = subDomainSeries.series.map((item) => item.name);
    if (!subDomainParam) return advertiser || domain || subDomain ? names : [];

    // Disaring ke yang benar-benar ada di periode ini: nama yang tinggal di alamat sejak periode
    // lain bukan pilihan, ia chip yang tidak digambar di mana pun.
    return subDomainParam.split(",").filter((name) => names.includes(name));
  }, [subDomainParam, subDomainSeries, advertiser, domain, subDomain]);
  const toggleSubDomainSeries = useCallback(
    (name) => {
      const next = selectedSubDomains.includes(name)
        ? selectedSubDomains.filter((item) => item !== name)
        : [...selectedSubDomains, name];

      setSubDomainParam(next.length ? next.join(",") : "none");
    },
    [selectedSubDomains, setSubDomainParam],
  );
  // Rincian negara per baris ROI. Tinggalnya di userReports/{id}.countryRoi — kepemilikannya lewat
  // PIC subdomain, itu juga yang dibaca panel "ROI per Negara" di Profile User — jadi di sini
  // seluruh user dikumpulkan sekali, lalu tiap baris tabel menjodohkan dirinya lewat hari +
  // subdomain.
  //
  // `store.userReports` cuma terisi di tab yang benar-benar memakainya (`needsUserReports`), dan
  // tab inilah salah satunya. Pada render pertama ia masih kosong dan lencana negaranya menyusul —
  // perilaku yang sama dengan tabelnya sendiri, yang sumbernya `roiSnapshots`.
  const countryBreakdown = useMemo(
    () => buildCountryBreakdown(countryRoiSources(store.users, store.userReports), adTaxRate),
    [store.users, store.userReports, adTaxRate],
  );
  // ═══ Tab Kalender ═══
  //
  // Bulan yang dibuka dan tanggal yang dipilih tinggal di ALAMAT, seperti filter lain di dashboard
  // ini: kalender yang kembali ke bulan berjalan setelah Back adalah keadaan yang tidak bisa
  // dikembalikan, dan tautan "lihat 12 Agustus" yang dikirim ke orang lain harus membuka 12
  // Agustus.
  const [calendarMonth, setCalendarMonth] = useUrlState("bulan", monthKeyOf(new Date()));
  const [calendarDay, setCalendarDay] = useUrlState("tanggal", "");
  // Penyempit kepemilikannya adalah state yang SAMA dengan tab Grafik (`advertiser`, `domain`,
  // `subdomain` di alamat), bukan tiga nama parameter kedua. Keduanya tab yang berbeda, jadi hanya
  // satu yang pernah tergambar sekaligus — dan perpindahan halaman tidak membawa query, jadi
  // membuka Kalender dari Grafik tetap mulai tanpa saringan. Nama kedua untuk konsep yang sama cuma
  // menghasilkan dua "advertiser" yang harus dijaga tetap seragam tanpa satu pun yang menuntutnya.
  const calendarRows = useMemo(
    () => filterRowsByOwner(roiReports, subDomainOwners, { advertiser, domain, subDomain }),
    [roiReports, subDomainOwners, advertiser, domain, subDomain],
  );
  const calendarFilterCount = (advertiser ? 1 : 0) + (domain ? 1 : 0) + (subDomain ? 1 : 0);
  // "Hari ini" untuk kalender adalah hari OPERASI yang sedang berjalan, dibaca dari baris bertanda
  // `partial` — bukan tanggal di jam browser. Browser yang zonanya bukan WIB menandai petak yang
  // berbeda dari yang ditandai sisi sync, dan yang ikut bergeser bersamanya adalah batas "potensi"
  // (yang lampau tidak menggambarnya) dan hari yang tidak boleh jadi sampel median.
  //
  // Dibaca dari roiReports yang BELUM disaring: hari yang sedang berjalan adalah keadaan usaha,
  // bukan turunan dari filter — memilih satu advertiser yang kebetulan tidak punya baris hari ini
  // tidak boleh memindahkan petak "hari ini" ke kemarin.
  const operationDay = useMemo(() => runningDayKey(roiReports), [roiReports]);
  // Keadaan filter sebagai teks, alasan yang sama persis dengan tab Grafik: kontrolnya terlipat ke
  // dalam dialog, dan kalender satu advertiser yang tidak menyebut advertiser siapa akan dibaca
  // sebagai kalender seluruh bisnis. Periodenya tidak ikut disebut — bulannya sudah berdiri sebagai
  // judul di sebelah kiri baris yang sama.
  const calendarScope = useMemo(() => {
    const scope = [advertiser, domain, subDomain].filter(Boolean);
    return scope.length ? scope.join(" · ") : "Seluruh bisnis";
  }, [advertiser, domain, subDomain]);
  const calendar = useMemo(
    () =>
      buildCalendarMonth({
        monthKey: calendarMonth,
        roiReports: calendarRows,
        // Reminder TIDAK ikut disaring, dan itu bukan kelalaian: sewa server dan perpanjangan
        // domain tidak dimiliki advertiser mana pun, jadi tidak ada aturan kepemilikan yang bisa
        // menyaringnya. Menyembunyikannya saat sebuah nama dipilih berarti tagihan yang jatuh tempo
        // hilang dari layar orang yang kebetulan sedang menyaring.
        reminders: store.reminders,
        rate: adTaxRate,
        today: operationDay,
      }),
    [calendarMonth, calendarRows, store.reminders, adTaxRate, operationDay],
  );
  // Yang terbuka saat halaman baru dibuka adalah HARI INI, dan itu bukan kenyamanan: panel yang
  // kosong sampai ada yang diklik membuat separuh isi tab ini tidak pernah ditemukan orang yang
  // mengira kalender cuma bisa dilihat.
  //
  // Dibaca dari petak yang benar-benar digambar bulan ini, bukan dari kunci di alamat begitu saja:
  // berpindah bulan meninggalkan tanggal milik bulan lain di query, dan panel yang menampilkan
  // hari yang tidak ada di layar tidak bisa ditutup oleh siapa pun.
  const calendarCell = useMemo(() => {
    const chosen = calendarDay && calendar.days.find((day) => day.key === calendarDay);
    return chosen || calendar.days.find((day) => day.isToday && day.inMonth) || null;
  }, [calendar.days, calendarDay]);
  const calendarDetail = useMemo(
    () =>
      calendarCell
        ? dayDetail(calendarRows, calendarCell.key, adTaxRate, subDomainOwners)
        : { subDomains: [], advertisers: [] },
    [calendarCell, calendarRows, adTaxRate, subDomainOwners],
  );
  // Berapa pendapatan bulan ini yang TIDAK punya baris ROI — selisih Kalender terhadap grafik
  // "Total usaha", sebagai angka alih-alih sebagai hafalan. Sebabnya selalu sama (subdomain belum
  // terdaftar, campaign belum dipetakan, nama situs di laporan GAM/AdSense tidak cocok), dan begitu
  // selisihnya nol kedua tab menyebut angka yang sama tanpa satu baris kode pun berubah.
  //
  // Hanya saat tidak ada filter kepemilikan: total usaha tidak tahu uangnya milik siapa, jadi
  // mengurangkannya dengan kalender satu advertiser menghasilkan "selisih" yang seluruhnya milik
  // orang lain.
  const calendarCoverage = useMemo(
    () =>
      calendarFilterCount === 0
        ? monthCoverage(weeklyFinancials, calendarMonth, calendar.totals.earning)
        : null,
    [weeklyFinancials, calendarMonth, calendar.totals.earning, calendarFilterCount],
  );
  const calendarExpenses = useMemo(
    () =>
      calendarCell
        ? (store.expenses || []).filter((item) => cellText(item?.date) === calendarCell.key)
        : [],
    [store.expenses, calendarCell],
  );

  // Tab yang sedang terbuka, dari route-nya. Bawaannya "ringkasan" — /dashboard tanpa apa-apa di
  // belakangnya adalah alamat yang sudah jadi bookmark semua orang.
  const activeTab = tab || "ringkasan";
  // Tinggi kalender diukur, bukan dihitung — lihat useFillViewport. `null` di tab lain dan di layar
  // sempit, dan di situ tidak ada `style` yang dipasang sama sekali.
  const [calendarLayoutRef, calendarHeight] = useFillViewport(activeTab === "kalender");
  const stats = [
    {
      label: "Total Users",
      value: store.users.length,
      tone: "blue",
      icon: Users,
    },
    {
      label: "Active Domains",
      value: store.domains.filter((item) => item.status === "Active").length,
      tone: "green",
      icon: Globe2,
    },
    {
      label: "Active Sub-Domains",
      value: store.subDomains.filter((item) => item.status === "Active").length,
      tone: "purple",
      icon: Globe2,
    },
    {
      label: "Managed Campaigns",
      value: dashboardStats.managedCampaigns || "-",
      tone: "orange",
      icon: Activity,
    },
  ];

  return (
    <div className="page-stack">
      <PageHeader
        title="Overview"
        description="Ringkasan performa monitoring ROI, diperbarui tiap sync."
      />

      {/* Tab-nya route sungguhan (lihat config/navigation.js): yang berganti di sini cuma bagian
          mana yang dirender, dan filter tiap panel tetap tinggal di alamatnya masing-masing. */}
      {activeTab === "ringkasan" && (
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
            <div className="panel-header">
              <div>
                <h2>Saldo & Pengeluaran Advertiser</h2>
                <p>
                  <BadgeDollarSign size={14} /> Total Keseluruhan Spend:{" "}
                  <strong className="danger">
                    {renderCell(dashboardStats.totalSpend, "spending")}
                  </strong>
                </p>
              </div>
            </div>
            {/* Ambang yang sama dengan peringatan Telegram (tab Peringatan ROI di /notifications). */}
            {lowBalance.length > 0 && (
              <p className="notice-alert">
                <TriangleAlert size={15} />
                <span>
                  Saldo Meta menipis:{" "}
                  {lowBalance.map((item, index) => (
                    <span key={item.userId || item.id || item.pic}>
                      {index > 0 && ", "}
                      <strong>{item.pic}</strong> {renderCell(item.balance, "balance")}
                    </span>
                  ))}
                  . Top-up sebelum iklannya berhenti.
                </span>
              </p>
            )}
            <DataTable
              columns={[
                ["pic", "PIC / User"],
                ["balance", "Sisa Saldo"],
                ["spendToday", "Pengeluaran Hari Ini"],
              ]}
              items={advertiserSpend}
              paginate
              extraAction={(item) => (
                <LinkButton
                  className="ghost-button"
                  to={`/users/${item.userId || item.id}`}
                  navigate={navigate}
                >
                  Detail
                </LinkButton>
              )}
            />
          </section>

          {/* Top-up whitelist hanya dilanggan admin + Keuangan. Digambar untuk role lain, kolom TU
              berbunyi Rp 0 di tiap baris dan ROI Founder kosong — nol yang lahir dari izin baca. */}
          {canReadResource(role, "whitelistTopup") && <FounderRoiPanel store={store} />}
        </>
      )}

      {activeTab === "grafik" && (
        <>
          {/* SATU filter untuk seluruh tab ini. Empat grafik dengan pemilihnya masing-masing berarti
          empat periode yang bisa berselisih — dan dua grafik yang berdampingan di layar yang sama
          akan dibaca sebagai perbandingan, apa pun periodenya. Ringkasannya berdiri di sini karena
          kontrolnya terlipat ke dalam dialog: grafik satu advertiser yang tidak menyebut advertiser
          siapa akan dibaca sebagai grafik seluruh bisnis. */}
          <section className="panel chart-filter-bar">
            <div className="panel-header">
              <div>
                <h2>Filter grafik</h2>
                <p>{chartSummary}</p>
              </div>
              <FilterDialog
                activeCount={chartFilterCount}
                description="Berlaku untuk SELURUH grafik di tab ini — yang total maupun yang per subdomain."
                onReset={resetChartFilters}
                title="Filter grafik"
              >
                {/* Paling atas, dan satu-satunya pemilih periode. Pintasan bulan yang dulu berdiri
                di sini menulis ke kotak yang sama persis — dua kontrol untuk satu keadaan, dan yang
                satu selalu bisa menampilkan "Rentang khusus" untuk periode yang justru sedang
                dipilih orang. Periode juga yang paling dulu ditentukan orang saat membaca grafik,
                jadi ia berdiri sebelum ketiga penyempit di bawahnya.

                Bukan <label>: isinya tombol pemilih, bukan input, jadi label tak punya kontrol
                untuk diasosiasikan. Pemilih yang sama dengan seluruh dashboard, menulis ke
                {start, end} yang dibaca keempat grafik. */}
                <div className="filter-dialog-field">
                  <span>Rentang tanggal</span>
                  <DateRangePicker
                    label="Rentang tanggal grafik"
                    onChange={(range) => setDateRange({ start: range.from, end: range.to })}
                    value={{ from: dateRange.start, to: dateRange.end }}
                  />
                </div>
                <OwnerFilterFields
                  advertiser={advertiser}
                  advertiserOptions={advertiserOptions}
                  domain={domain}
                  domainOptions={domainOptions}
                  onAdvertiser={changeAdvertiser}
                  onDomain={setDomain}
                  onSubDomain={setSubDomain}
                  subDomain={subDomain}
                  subDomainOptions={subDomainOptions}
                />
              </FilterDialog>
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <div>
                <h2>Pendapatan vs Pengeluaran vs Profit</h2>
              </div>
            </div>
            {financialsData.length > 0 ? (
              <LineChart data={financialsData} hourly={isHourlyFinancials} />
            ) : (
              <EmptyMessage>Tidak ada data grafik pada range tanggal ini.</EmptyMessage>
            )}
          </section>

          {/* Kurva ROI (Netto) dari data yang sama dengan grafik di atas — filter periode/advertiser/
          subdomain-nya ikut yang di sana, jadi tidak ada pemilih periode kedua yang bisa berselisih. */}
          <section className="panel">
            <div className="panel-header">
              <div>
                <h2>Kurva ROI (%)</h2>
              </div>
            </div>
            {financialsData.length > 0 ? (
              <RoiCurveChart data={financialsData} hourly={isHourlyFinancials} />
            ) : (
              <EmptyMessage>Tidak ada data grafik pada range tanggal ini.</EmptyMessage>
            )}
          </section>

          {/* Dua grafik detail per subdomain, di bawah Kurva ROI total. Yang di atas menjawab
          "bagaimana bisnisnya hari ini"; dua ini menjawab "subdomain mana yang menariknya ke sana"
          — kurva yang sama, dipecah per subdomain, lalu perbandingan ROI terhadap uang yang
          dibelanjakan untuk mendapatkannya.

          Periode dan filternya ikut yang di atas — sumbernya baris per SYNC, bukan baris harian,
          jadi rentang lebih dari sehari membuat sumbu waktunya ikut menyebut tanggal. */}
          {/* Kurva ROI per Advertiser, di antara kurva total dan kurva per subdomain: tingkat tengah
          dari pertanyaan yang sama — siapa yang menarik angka total ke sana, sebelum turun ke
          subdomain mana. Satu titik per hari dari baris harian; periodenya sama dengan grafik lain. */}
          <section className="panel">
            <div className="panel-header">
              <div>
                <h2>Kurva ROI per Advertiser</h2>
              </div>
            </div>
            {advertiserSeries.series.length > 0 ? (
              <SubDomainRoiCurveChart
                chipLabel="Pilih advertiser:"
                emptyMessage="Belum ada advertiser yang dipilih — nyalakan chip di atas."
                onToggle={toggleAdvertiserSeries}
                points={advertiserSeries.points}
                selected={selectedAdvertisers}
                series={advertiserSeries.series}
              />
            ) : (
              <EmptyMessage>
                {chartFilterCount > 0
                  ? "Tidak ada advertiser yang cocok dengan filter ini pada periode tersebut."
                  : "Belum ada baris ROI per advertiser pada periode ini."}
              </EmptyMessage>
            )}
          </section>

          <section className="panel">
            <div className="panel-header">
              <div>
                <h2>Kurva ROI per Subdomain</h2>
              </div>
            </div>
            {subDomainSeries.series.length > 0 ? (
              <SubDomainRoiCurveChart
                onToggle={toggleSubDomainSeries}
                points={subDomainSeries.points}
                selected={selectedSubDomains}
                series={subDomainSeries.series}
              />
            ) : (
              <EmptyMessage>
                {chartFilterCount > 0
                  ? "Tidak ada subdomain yang cocok dengan filter ini pada periode tersebut."
                  : "Belum ada baris ROI per subdomain pada periode ini."}
              </EmptyMessage>
            )}
          </section>

          <section className="panel">
            <div className="panel-header">
              <div>
                {/* Jam bacaannya disebut di judul: batangnya bukan angka sepanjang periode, melainkan
                keadaan pada sync terakhir tiap subdomain — dan baris snapshot kumulatif sejak
                tengah malam, jadi "pukul 15:06" adalah seluruh hari sampai pukul itu. */}
                <h2>
                  ROI vs Total Spend
                  {subDomainSeries.latestStamp
                    ? ` (pukul ${subDomainSeries.latestStamp.slice(11)})`
                    : ""}{" "}
                  — perbandingan antar subdomain
                </h2>
              </div>
            </div>
            {subDomainSeries.bars.length > 0 ? (
              <>
                <SubDomainRoiSpendChart
                  bars={subDomainSeries.bars}
                  selected={selectedSubDomains}
                  series={subDomainSeries.series}
                />
                {/* Tabel di bawah grafiknya: peringkat lengkap ROI antar subdomain, tak bergantung
                    chip yang dipilih. Angka yang sama dengan batang (sync terakhir tiap subdomain). */}
                <SubDomainRoiTable bars={subDomainSeries.bars} />
              </>
            ) : (
              <EmptyMessage>
                {chartFilterCount > 0
                  ? "Tidak ada subdomain yang cocok dengan filter ini pada periode tersebut."
                  : "Belum ada baris ROI per subdomain pada periode ini."}
              </EmptyMessage>
            )}
          </section>
        </>
      )}

      {activeTab === "kalender" && (
        // Kalender di kiri, rincian hari terpilih di kanan. Di bawah kalender (tempatnya semula)
        // panel itu mendorong petak-petak keluar dari layar pertama — begitu sebuah tanggal diklik,
        // yang tidak terlihat lagi justru tanggal-tanggal lainnya. Di layar sempit keduanya kembali
        // bertumpuk; yang di atas tetap kalendernya.
        <div
          className={`calendar-layout${calendarHeight ? " is-locked" : ""}`}
          ref={calendarLayoutRef}
          // Berakhir tepat di dasar layar, jadi seluruh tanggal terlihat tanpa menggulir halaman
          // dan yang menggulir adalah panel kanannya sendiri. `undefined` di layar sempit —
          // keduanya bertumpuk di sana, dan tinggi terkunci pada kolom yang bertumpuk berarti
          // panel kanan setinggi 300px di bawah kalender yang penuh.
          style={calendarHeight ? { height: calendarHeight } : undefined}
        >
          <section className="panel calendar-panel">
            <ReportCalendar
              coverage={calendarCoverage}
              days={calendar.days}
              filter={
                <FilterDialog
                  activeCount={calendarFilterCount}
                  description="Menyaring petak kalender DAN panel rincian di bawahnya. Periodenya dipilih lewat panah bulan di sebelah kiri, bukan di sini."
                  onReset={() => {
                    setAdvertiser("");
                    setDomain("");
                    setSubDomain("");
                  }}
                  title="Filter kalender"
                >
                  <OwnerFilterFields
                    advertiser={advertiser}
                    advertiserOptions={advertiserOptions}
                    domain={domain}
                    domainOptions={domainOptions}
                    onAdvertiser={changeAdvertiser}
                    onDomain={setDomain}
                    onSubDomain={setSubDomain}
                    subDomain={subDomain}
                    subDomainOptions={subDomainOptions}
                  />
                </FilterDialog>
              }
              monthKey={calendarMonth}
              onMonthChange={(step) => setCalendarMonth(shiftMonthKey(calendarMonth, step))}
              onSelect={setCalendarDay}
              scope={calendarScope}
              selected={calendarCell?.key || ""}
              totals={calendar.totals}
            />
          </section>

          {calendarCell && (
            <CalendarDayPanel
              canReadExpenses={canReadResource(role, "expenses")}
              cell={calendarCell}
              detail={calendarDetail}
              expenses={calendarExpenses}
            />
          )}
        </div>
      )}

      {activeTab === "terjadwal" && <ScheduledLaunches store={store} viewer={viewer} />}

      {activeTab === "rasio-penayangan" && <FillRate store={store} />}

      {activeTab === "roi" && (
        <section className="panel">
          <div className="panel-header">
            <div>
              {/* Tanpa paragraf keterangan. Yang dulu berdiri di sini — jam sync terakhir, "angkanya
                belum selesai", rumus ad tax — berganti bunyi tiap kali filternya diganti, dan
                keadaan yang disebutnya sudah terbaca dari layar: kolom Date dan Time tiap baris,
                dan pilihan periode di sebelah kanan. */}
              <h2>Laporan ROI Realtime</h2>
            </div>
            <div className="header-actions">
              <button
                className="secondary-button"
                onClick={() => setKeitaroOpen(true)}
                title="Unggah berkas CSV laporan tracker Keitaro"
                type="button"
              >
                <FileUp size={15} /> Import CSV Keitaro
              </button>
              <DateRangePicker
                align="right"
                label="Filter periode Laporan ROI Realtime"
                onChange={setRoiRange}
                value={roiRange}
              />
              <FilterDialog
                activeCount={(advertiser ? 1 : 0) + (domain ? 1 : 0) + (subDomain ? 1 : 0)}
                description="Menyaring baris Laporan ROI Realtime. Periodenya dipilih lewat pemilih tanggal di sebelahnya."
                onReset={() => {
                  setAdvertiser("");
                  setDomain("");
                  setSubDomain("");
                }}
                title="Filter Laporan ROI"
              >
                <OwnerFilterFields
                  advertiser={advertiser}
                  advertiserLabel="PIC"
                  advertiserOptions={advertiserOptions}
                  domain={domain}
                  domainOptions={domainOptions}
                  onAdvertiser={changeAdvertiser}
                  onDomain={setDomain}
                  onSubDomain={setSubDomain}
                  subDomain={subDomain}
                  subDomainOptions={subDomainOptions}
                />
              </FilterDialog>
            </div>
          </div>
          <RealtimeRoiTable
            countryBreakdown={countryBreakdown}
            items={filteredRoiReports}
            picOf={subDomainOwners.picOf}
            rate={adTaxRate}
          />
        </section>
      )}
      {keitaroOpen && (
        <KeitaroCsvImportDialog
          isOpen={true}
          onClose={() => setKeitaroOpen(false)}
          onImportSuccess={() => {
            setKeitaroOpen(false);
          }}
        />
      )}
    </div>
  );
}

function founderColumns(totals) {
  return [
    {
      accessorKey: "name",
      header: "Nama Advertiser",
      footer: "Total",
      cell: ({ getValue }) => <strong>{getValue()}</strong>,
    },
    moneyColumn("topup", "Total TopUp (TU)", "nominal", { total: totals.topup }),
    moneyColumn("totalSpending", "Total Spending + Tax (ST)", "spending", {
      total: totals.totalSpending,
    }),
    moneyColumn("balance", "Sisa Saldo (SS)", "nominal", {
      hint: "Sisa batas pengeluaran Meta hari ini",
      total: totals.balance,
    }),
    moneyColumn("earning", "Total Earning (ER)", "earning", { total: totals.earning }),
    moneyColumn("profitAdvertiser", "Profit Advertiser", "profit", {
      hint: "ER − ST",
      total: totals.profitAdvertiser,
    }),
    moneyColumn("profitFounder", "Profit Founder", "profit", {
      hint: "ER − TU",
      total: totals.profitFounder,
    }),
    roiColumn("roiAdvertiser", "ROI Overall Advertiser", {
      hint: "(ER − ST) ÷ ST × 100%",
      total: totals.roiAdvertiser,
    }),
    roiColumn("roiFounder", "ROI Overall Founder", {
      hint: "(ER − TU) ÷ TU × 100%",
      total: totals.roiFounder,
    }),
  ];
}

/**
 * ROI Founder per advertiser untuk satu rentang tanggal — aturannya di lib/founderRoi.js.
 *
 * Rentangnya di alamat (`?founder=`), lewat DateRangePicker yang sama dengan tab Grafik dan
 * Laporan ROI; bawaannya "Bulan ini" (tanggal 1 sampai hari ini), sama dengan tab Grafik. Nama parameternya sendiri,
 * bukan `periode`: parameter itu sudah milik tab Grafik, dan satu nama untuk dua pemilih di dua
 * tab berarti memilih bulan di sini ikut menggeser grafik saat orang berpindah tab lewat tautan.
 */
function FounderRoiPanel({ store }) {
  const [range, setRange] = useUrlRange("founder", currentMonthRange);
  const roiReports = store.roiReports;
  const whitelistTopup = store.whitelistTopup;
  const adAccounts = store.adAccounts;
  const users = store.users;
  const rate = adTaxRateOf(store.roiSettings);
  const report = useMemo(
    () =>
      buildFounderRoi({
        roiReports: roiReports || [],
        whitelistTopup: whitelistTopup || [],
        adAccounts: adAccounts || [],
        users: users || [],
        range,
        rate,
      }),
    [roiReports, whitelistTopup, adAccounts, users, range, rate],
  );
  const { totals } = report;
  // Urutan bawaan adalah Profit Founder tertinggi (dari buildFounderRoi); klik kolom mengurutkan
  // lewat DataTable, dan baris Total tidak ikut.
  const columns = useMemo(() => founderColumns(totals), [totals]);

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>ROI Founder</h2>
          <p>
            {report.firstDay
              ? `${formatDate(report.firstDay)} – ${formatDate(report.lastDay)}`
              : "Belum ada hari yang selesai di rentang ini"}
          </p>
        </div>
        <div className="header-actions">
          <DateRangePicker
            align="right"
            label="Filter periode ROI Founder"
            onChange={setRange}
            value={range}
          />
        </div>
      </div>
      <DataTable
        columns={columns}
        emptyText="Tidak ada baris ROI maupun top-up pada periode ini."
        getRowId={(row) => row.key}
        items={report.rows}
      />
    </section>
  );
}

// Grafik per advertiser/subdomain diturunkan dari roiReports: satu titik per hari, revenue &
// spend dijumlahkan dari baris yang cocok. roiReport.date sudah yyyy-mm-dd.
//
// "Pengeluaran" di sini adalah TOTAL SPENDING (Meta spend + ad tax), sama dengan kolom Total Spend
// di tabel ROI dan dengan kolom AD SPEND+AD TAX di rekap advertiser. Dulu ia memakai spend
// telanjang, jadi memfilter satu subdomain memberi dua angka berbeda untuk hari yang sama —
// trends.stylefemale.com 9 Agu: grafik 138.136 / Netto 437,86%, tabel 145.043 / ROI 412,25%.
function aggregateRoiFinancials(
  reports,
  { advertiser, subDomain, domain, owners, start, end, rate },
) {
  const byDate = new Map();
  // Penyaring kepemilikan yang SAMA dengan Kalender, dua grafik per subdomain, dan daftar pilihan
  // di dropdown-nya — bukan pembacaan `item.pic` mentah seperti dulu. Sisi sync menulis
  // `pic: sub?.pic || ""`, jadi baris yang ditulis SEBELUM subdomainnya diberi PIC tersimpan
  // dengan pic kosong selamanya; `picOf` menambalnya dari `subDomains.pic`, dan yang membaca
  // barisnya mentah tidak. Akibatnya dua grafik teratas menjatuhkan baris yang tetap dihitung
  // Kalender dan dua grafik di bawahnya — dengan filter yang sama, di layar yang sama.
  const rows = filterRowsByOwner(reports, owners, { advertiser, domain, subDomain });
  // Hari berjalan dibaca dari baris yang BELUM disaring, sepola Kalender: memilih advertiser yang
  // tidak punya baris hari ini tidak boleh memindahkan "hari berjalan" ke tanda lama yang tertinggal.
  const runningDay = runningDayKey(reports);
  for (const item of rows) {
    const date = item.date;
    if (!date || date < start || date > end) {
      continue;
    }

    const money = withAdTax(item, rate);
    const current = byDate.get(date) || { grossRevenue: 0, totalSpend: 0, partial: false };
    // Satu baris hari berjalan sudah cukup membuat titik hari itu belum selesai: sisanya bisa saja
    // final, tapi totalnya tetap angka yang masih akan naik. Tanda `partial` yang tertinggal di hari
    // yang sudah lewat tidak dihitung (`isRunningRow`).
    if (isRunningRow(item, runningDay)) current.partial = true;
    // Earning yang tidak diketahui dilewati, bukan dihitung nol: hari yang laporannya gagal akan
    // tampak sebagai jurang di garis pendapatan padahal uangnya ada.
    if (money.earningKnown) current.grossRevenue += money.earning;
    // Sama untuk spend: subdomain tanpa campaign Meta tidak menyumbang "0" ke garis pengeluaran.
    // Ditambahkan apa adanya, "" akan mengubah totalnya jadi teks ("0" + 100 = "0100").
    if (money.spendingKnown) current.totalSpend += money.totalSpending;
    byDate.set(date, current);
  }

  return [...byDate.keys()].sort().map((date) => ({ date, ...byDate.get(date) }));
}
