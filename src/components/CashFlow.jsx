import { Coins, TrendingDown, Wallet } from "lucide-react";
import { useMemo } from "react";
import { useUrlRange, useUrlState } from "../hooks/useUrlState";
import { buildCashFlow, cashFlowMonths, cashFlowSummary, cashFlowTotals } from "../lib/cashFlow";
import { monthKeyOf } from "../lib/dateRange";
import { ACCOUNT_TYPES } from "../lib/earningByAccountType";
import { formatMonth } from "../lib/formatDate";
import { monthSpanRange } from "../lib/monthRangeUtil";
import { buildProfitLoss } from "../lib/profitLoss";
import { renderCell } from "../lib/renderCell";
import { DataTable } from "./ui/DataTable";
import { describeDateRange } from "./ui/DateRangePicker";
import { MonthRangePicker } from "./ui/MonthRangePicker";
import { PageHeader } from "./ui/PageHeader";
import { SelectField, toSelectOptions } from "./ui/SelectField";
import { formatPercent, moneyColumn, roiColumn } from "./ui/tableColumns";

/**
 * Cash Flow Management — rantai Laba Rugi, dipecah sampai ke baris penyusunnya.
 *
 * Satu baris per (advertiser, jenis akun, subdomain) di bulan yang dipilih. Aturannya di
 * [`src/lib/cashFlow.js`](../lib/cashFlow.js); yang di sini cuma pemilih bulan, tiga penyaring,
 * dan tabelnya.
 *
 * Tabelnya TIDAK punya kolom "Net Income Owner" lagi: nama itu sekarang dipakai kartu Cash
 * Available di atasnya, dengan definisi yang berbeda (earning dikurangi SELURUH item Cash Out,
 * termasuk biaya operasional dan approval yang tidak dimiliki subdomain mana pun). Dua angka
 * bernama sama di satu halaman akan diadu pembacanya dan tidak akan pernah cocok. Yang per baris
 * tidak hilang — ia Net Profit dikurangi Bonus, dua kolom yang berdiri persis di sebelahnya.
 *
 * TIDAK ADA satu pun angka yang diketik di halaman ini, dan tidak ada koleksi baru di RTDB —
 * semuanya sudah ada di halaman lain: `roiReports` (earning, belanja, PIC), `companyPercents`
 * (tab Potongan Company), `invalidTraffic` (tab Invalid Traffic), dan tab Tarif Bonus (`bonusPercents`)
 * (Accounting). Yang diperbaiki di sini diperbaiki di sana.
 */
export function CashFlow({ store }) {
  // Bulan terbaru yang punya baris ROI, bukan selalu bulan berjalan: pada tanggal 1 bulan berjalan
  // baru punya satu hari, dan halaman yang membuka diri hampir kosong terbaca seperti rusak.
  // Alasan yang sama dengan Laba Rugi.
  const months = useMemo(() => cashFlowMonths(store), [store]);
  // `monthKeyOf` (waktu lokal), bukan `toISOString().slice(0, 7)` yang menjawab menurut UTC:
  // antara 00:00-07:00 WIB tanggal 1, yang terakhir menyebut bulan lalu. Bawaannya bulan itu sebagai
  // RENTANG — pemilihnya `DateRangePicker` yang sama dengan seluruh dashboard.
  // Bulan PENUH, lewat `monthSpanRange` — bukan `monthRange`, yang memotong bulan berjalan di hari
  // ini. Bawaan yang terpotong berarti halaman ini terbuka pada rentang yang TIDAK menutup bulannya,
  // dan nominal invalid traffic, akun ditutup, serta potongan pencairan bulan itu tidak ikut sampai
  // ada yang mengubah periodenya. Bulan berjalan memang belum lengkap, dan yang mengabarkannya
  // adalah keterangan "n dari m hari" — bukan batas rentang yang diam-diam menjatuhkan tiga sumber.
  const fallback = useMemo(() => {
    const key = months[0] || monthKeyOf(new Date());
    return monthSpanRange(key, key);
  }, [months]);
  const [range, setRange] = useUrlRange("periode", fallback);

  // Ketiga penyaring tinggal di ALAMAT, sepola dengan Target: satu bulan berisi puluhan baris, dan
  // yang dicari orang hampir selalu satu advertiser atau satu domain. Kosong = semua, jadi alamat
  // yang belum disaring tetap bersih.
  const [pic, setPic] = useUrlState("advertiser", "");
  const [accountType, setAccountType] = useUrlState("jenis", "");
  const [domain, setDomain] = useUrlState("domain", "");

  const report = useMemo(() => buildCashFlow(store, range), [store, range]);
  const rows = useMemo(
    () =>
      report.rows.filter(
        (row) =>
          (!pic || row.pic === pic) &&
          (!accountType || row.accountType === accountType) &&
          (!domain || row.domain === domain),
      ),
    [report, pic, accountType, domain],
  );

  // Pilihan diambil dari baris yang BENAR-BENAR ada di bulan itu, bukan dari `store.users` dan
  // `store.domains` langsung: yang ditawarkan dropdown harus punya baris untuk dipilih, kalau tidak
  // memilihnya menghasilkan tabel kosong tanpa sebab yang terbaca.
  const picOptions = useMemo(() => unique(report.rows.map((row) => row.pic)), [report]);
  const domainOptions = useMemo(() => unique(report.rows.map((row) => row.domain)), [report]);

  const filtered = Boolean(pic || accountType || domain);
  // Total baris yang SEDANG TAMPIL, bukan total bulan itu: baris Total yang tidak ikut menyempit
  // saat sebuah nama dipilih akan diadu dengan kolom di atasnya dan tidak pernah cocok.
  const totals = useMemo(
    () => (filtered ? cashFlowTotals(rows) : report.totals),
    [filtered, rows, report],
  );

  // Dimemo sendiri: `payoutRows` di dalamnya menyisir seluruh `roiReports` sekali lagi untuk
  // menurunkan Saldo Close, dan halaman ini punya tiga <select> yang berubah tiap klik.
  /**
   * Pendapatan dan belanja BERSKALA USAHA — dari `buildProfitLoss`, fungsi yang SAMA yang menggambar
   * rantai Laba Rugi di tab sebelahnya.
   *
   * Dua item di kartu ini menjawab pertanyaan berskala usaha ("berapa uang yang masuk dan keluar"),
   * bukan pertanyaan berskala pemetaan ("uang ini dari mana") yang dijawab tabel di bawahnya —
   * itulah yang dijawab sheet "Dashboard", dan itu juga yang membuat kartunya bisa diadu dengan
   * baris Pendapatan dan Total belanja iklan di Laba Rugi. Dihitung ulang di sini, keduanya akan
   * berbeda suatu hari dan tidak ada apa pun di layar yang bisa menerangkan selisihnya.
   *
   * `spendUpTo` untuk Saldo Iklan Meta Ads, yang saldo BERJALAN: ia menjumlahkan sejak baris paling
   * awal, jadi ia butuh rentang yang dibuka dari awal data — bukan rentang yang sedang dipilih.
   */
  const business = useMemo(() => {
    const sources = {
      financials: store.weeklyFinancials || [],
      expenses: store.expenses || [],
      whitelistTopup: store.whitelistTopup || [],
      invalidTraffic: store.invalidTraffic || [],
      adxCosts: store.adxCosts || [],
      roiReports: store.roiReports || [],
      accountCloses: store.accountCloses || [],
      payouts: store.payouts || [],
      subDomains: store.subDomains || [],
      domains: store.domains || [],
      companyPercents: store.companyPercents || [],
      bonusPercents: store.bonusPercents || [],
      users: store.users || [],
    };
    const period = buildProfitLoss({ ...sources, range });
    const sinceStart = buildProfitLoss({ ...sources, range: { from: "2000-01-01", to: range.to } });
    return {
      revenue: period.revenue,
      totalAdSpend: period.totalAdSpend,
      spendUpTo: sinceStart.totalAdSpend,
    };
  }, [store, range]);

  const summary = useMemo(
    () => cashFlowSummary(store, range, report, business),
    [store, range, report, business],
  );

  return (
    <div className="page-stack">
      <PageHeader
        title="Cash Flow Management"
        description="Rantai Laba Rugi per subdomain, diturunkan dari baris ROI."
        action={
          <div className="header-actions">
            {/* Pemilih BULANAN, bukan `DateRangePicker` yang dipakai halaman lain — lihat
                MonthRangePicker. Seluruh rantai di grup ini bertumpu pada tiga sumber yang berdiri
                per BULAN (invalid traffic, akun ditutup, potongan pencairan), dan ketiganya hanya
                ikut kalau rentangnya menutup bulannya penuh. Pemilih harian bisa menghasilkan batas
                yang menjatuhkan ketiganya sekaligus; yang ini tidak bisa. */}
            <MonthRangePicker label="Filter periode Cash Flow" onChange={setRange} value={range} />
            <SelectField
              ariaLabel="Saring menurut advertiser"
              className="compact-control"
              value={pic}
              onChange={setPic}
              options={[
                { value: "", label: "Semua advertiser" },
                ...toSelectOptions(withCurrent(picOptions, pic)),
              ]}
            />
            <SelectField
              ariaLabel="Saring menurut jenis akun"
              className="compact-control"
              value={accountType}
              onChange={setAccountType}
              options={[
                { value: "", label: "Semua jenis" },
                ...toSelectOptions(withCurrent(ACCOUNT_TYPES, accountType)),
              ]}
            />
            <SelectField
              ariaLabel="Saring menurut domain"
              className="compact-control"
              value={domain}
              onChange={setDomain}
              options={[
                { value: "", label: "Semua domain" },
                ...toSelectOptions(withCurrent(domainOptions, domain)),
              ]}
            />
          </div>
        }
      />

      {/* Ringkasan arus kas SELURUH BULAN — sengaja tidak ikut penyaring di kepala halaman;
          alasannya di `cashFlowSummary`. Yang ikut menyempit tetap baris Total di tabel.

          Isinya mengikuti sheet "Dashboard" (DASHBOARD DATA CENTER) berikut nama-nama kartunya;
          BENTUKNYA tetap tiga panel berdaftar. Sempat dicoba sebagai grid kartu satu-metrik-satu-
          kotak seperti sheet-nya, dan itu dibatalkan: yang diminta dari sheet adalah kosakata dan
          rantainya, bukan tata letaknya. */}
      <section className="cashflow-headline">
        {summary.headline.map((item) => (
          <article className={`cashflow-headline-card ${item.flow}`} key={item.key}>
            <span>{item.label}</span>
            {/* Arahnya dari `flow`, bukan dari posisinya: Result satu-satunya yang boleh minus, dan
                di situ merah benar-benar berarti rugi. Peta yang sama dengan `MONEY_KEY` di
                ProfitLoss.jsx. */}
            <strong>{renderCell(item.value, MONEY_KEY[item.flow])}</strong>
          </article>
        ))}
      </section>

      <section className="cashflow-groups">
        <CashGroup
          title="Cash Inflow"
          icon={Wallet}
          tone="green"
          items={summary.inflow}
          unknown={summary.inflowUnknown}
        />
        <CashGroup
          title="Cash Outflow"
          icon={TrendingDown}
          tone="orange"
          items={summary.outflow}
          unknown={summary.outflowUnknown}
          /* Angkanya digambar positif tapi berwarna keluar — lihat `outflowKeys` di renderCell.
             Yang ditandai warnanya adalah ARAH uangnya, bukan penilaian atas satu angka. */
          moneyKey="cashOut"
        />
        <CashGroup
          title="Cash Available"
          icon={Coins}
          tone="purple"
          items={summary.result}
          unknown={summary.resultUnknown}
          moneyKey="profit"
        />
      </section>

      {/* Nominal invalid traffic dan penandaan "Account Close" berdiri per BULAN dan tidak bisa
          dibelah per hari, jadi bulan yang cuma terpotong sebagian tidak ikut ke kartu di atas.
          Disebutkan, karena potongan yang diam-diam hilang terbaca sebagai arus kas yang lebih baik
          — dan preset "Bulan lalu" adalah perbaikannya, bukan sesuatu yang harus ditebak. Sepola
          dengan catatan yang sama di Laba Rugi. */}
      {summary.partialMonths.length > 0 && (
        <p className="notice-line">
          Invalid Traffic dan Akun Close Cut {summary.partialMonths.map(formatMonth).join(", ")}{" "}
          belum ikut — rentangnya tidak menutup bulan itu penuh. Keduanya diinput per bulan dan
          tidak bisa dibagi per hari.
        </p>
      )}

      <section className="panel">
        <div className="panel-header">
          <div>
            {/* Keterangan yang BERUBAH, bukan judul kedua untuk halaman yang sudah punya judul:
                tanpa ini tidak ada satu pun angka di tabel yang menyebutkan bulannya sendiri. */}
            <h2>
              {describeDateRange(range.from, range.to)} · {rows.length} baris
              {filtered ? ` dari ${report.rows.length}` : ""}
            </h2>
          </div>
        </div>

        <DataTable
          columns={cashFlowColumns(totals)}
          emptyText={
            filtered
              ? "Tidak ada baris yang cocok dengan filter."
              : "Tidak ada baris ROI pada bulan ini."
          }
          items={rows}
        />

        {/* Nominal yang tidak punya ember untuk dibagi: domain + jenis akun yang bulan itu dicek
            tapi tidak menghasilkan sepeser pun. Ia TIDAK dipindahkan ke jenis akun lain di domain
            yang sama — clawback atas pendapatan AdSense yang dibebankan ke ember Ad Exchange
            mengurangi dasar bonus orang yang tidak ada hubungannya dengan uang itu.
            Disebutkan karena kartu di kepala halaman ini menjumlahkan nominal PENUH: tanpa
            kalimat ini, satu halaman memuat dua angka Invalid Traffic yang berbeda. */}
        {report.totals.invalidTrafficUnspread > 0 && (
          <p className="notice-line">
            {renderCell(report.totals.invalidTrafficUnspread, "nominal")} invalid traffic tidak ikut
            kolom di atas — domain dan jenis akunnya tidak punya earning bulan ini, jadi tidak ada
            baris yang bisa menanggungnya. Kartu Invalid Traffic dan Laba Rugi tetap
            menjumlahkannya.
          </p>
        )}
        {/* Alasan yang sama persis dengan sisa invalid traffic di atasnya: sebuah domain bisa
            mencairkan uang bulan yang subdomainnya tidak punya earning di `roiReports` sama
            sekali, dan porsi yang tidak bisa dibebankan ke siapa pun TIDAK dipindahkan ke domain
            lain. Kartu Potongan Pencairan dan Laba Rugi tetap menjumlahkannya penuh. */}
        {report.totals.payoutCostUnspread > 0 && (
          <p className="notice-line">
            {renderCell(report.totals.payoutCostUnspread, "nominal")} potongan pencairan tidak ikut
            kolom di atas — domainnya tidak punya earning bulan ini, jadi tidak ada baris yang bisa
            menanggungnya. Kartu Potongan Pencairan dan Laba Rugi tetap menjumlahkannya.
          </p>
        )}
        {/* Bulan yang punya tagihan tapi belum punya satu baris ROI pun: tidak ada earning yang
            bisa jadi pembagi, jadi tidak ada dasar bonus yang berkurang. Alasan yang sama dengan
            dua sisa di atasnya — tagihannya tetap keluar dari kantong, dan yang tidak ikut cuma
            pembagiannya. */}
        {report.totals.operatingExpenseUnspread > 0 && (
          <p className="notice-line">
            {renderCell(report.totals.operatingExpenseUnspread, "nominal")} biaya operasional tidak
            ikut kolom di atas — bulan ini belum punya baris ROI yang bisa jadi pembaginya. Kartu
            Biaya Operasional dan Laba Rugi tetap menjumlahkannya.
          </p>
        )}
      </section>
    </div>
  );
}

/**
 * Kolom tabel Cash Flow. Baris Total menjumlahkan yang SEDANG TAMPIL (`totals` dari pemanggil),
 * dan dirender dengan aturan yang sama persis dengan selnya — lewat `moneyColumn`/`roiColumn`.
 */
function cashFlowColumns(totals) {
  return [
    { accessorKey: "pic", header: "Advertiser", footer: "Total" },
    { accessorKey: "accountType", header: "Jenis" },
    {
      accessorKey: "subDomain",
      header: "Sub Domain",
      cell: ({ row }) => (
        <>
          {row.original.subDomain}
          <RowNote row={row.original} />
        </>
      ),
    },
    { accessorKey: "domain", header: "Domain" },
    moneyColumn("earning", "Earning", "earning", { total: totals.earning }),
    moneyColumn("totalSpending", "Ad Spend + Ad Tax", "totalSpending", {
      total: totals.totalSpending,
    }),
    // `profit`, bukan `earning`: bruto boleh minus, dan minus di sini adalah kabar yang menuntut
    // tindakan.
    moneyColumn("grossProfit", "Earning Bruto", "profit", {
      hint: "Earning − Total Spend",
      total: totals.grossProfit,
    }),
    roiColumn("roi", "ROI %", {
      hint: "(Earning − Total Spend) ÷ Total Spend × 100%, dengan Total Spend = Ad Spend + Ad Tax",
      total: totals.roi,
    }),
    {
      id: "companyPercent",
      header: "Company %",
      cell: ({ row }) => percentRange(row.original),
      footer: "-",
      meta: {
        align: "right",
        hint: "Tarif Potongan Company Ad Exchange yang berlaku pada hari-hari bulan ini. Tidak berlaku untuk baris Adsense.",
        // Diurutkan menurut tarif TERAKHIR bulan itu; Adsense tidak punya tarif sama sekali.
        sortValue: (item) =>
          item.accountType === "Ad-Exchanger" ? item.companyPercents?.at(-1) : undefined,
      },
    },
    moneyColumn("company", "Company", "nominal", {
      hint: "Company % × Earning, dihitung per hari lalu dijumlahkan",
      total: totals.company,
    }),
    {
      accessorKey: "invalidTraffic",
      header: "Invalid Traffic",
      cell: ({ row }) => <InvalidTraffic row={row.original} />,
      footer: () => renderCell(totals.invalidTraffic, "nominal"),
      meta: {
        align: "right",
        hint: "Invalid traffic domain ini bulan ini, dibagi menurut porsi Earning tiap subdomain",
      },
    },
    moneyColumn("payoutCost", "Potongan Pencairan", "nominal", {
      hint: "Fee rekening perantara + konversi mata uang + pajak negara asal (Real Masuk − Saldo Akhir di tab Pencairan), dibagi menurut porsi Earning tiap subdomain",
      total: totals.payoutCost,
    }),
    moneyColumn("netProfit", "Net Profit", "profit", {
      hint: "Earning Bruto − Company − Invalid Traffic − Potongan Pencairan",
      total: totals.netProfit,
    }),
    roiColumn("netRoi", "Net ROI %", {
      hint: "Net Profit ÷ Total Spend × 100%",
      total: totals.netRoi,
    }),
    moneyColumn("operatingExpense", "Biaya Operasional", "nominal", {
      hint: "Porsi biaya operasional bulan ini (sewa server, lisensi, Cost Ad Exchange) menurut porsi Earning baris ini. Mengurangi dasar bonus, TIDAK masuk Net Profit. Rp 0 untuk biaya bertanggal sebelum Juli 2026.",
      total: totals.operatingExpense,
    }),
    {
      accessorKey: "bonusPercent",
      header: "Bonus %",
      cell: ({ getValue }) => formatPercent(getValue()),
      footer: "-",
      meta: { align: "right", hint: "Tarif bonus advertiser, dari halaman Team" },
    },
    moneyColumn("bonus", "Bonus", "nominal", {
      hint: "Bonus % × (Net Profit − Biaya Operasional)",
      total: totals.bonus,
    }),
  ];
}

/**
 * Nominal invalid traffic berikut PORSI baris ini terhadap nominal domainnya.
 *
 * Porsinya di sel yang sama, bukan kolom sendiri: ia satu-satunya angka di spreadsheet acuan yang
 * cuma menerangkan angka di sebelahnya, dan kolom ke-17 di tabel selebar ini mendorong Net Income
 * Owner keluar layar. Kosong (bukan 0%) untuk baris yang domainnya belum pernah dicek — nol di
 * sana adalah klaim bahwa subdomain ini bersih.
 */
function InvalidTraffic({ row }) {
  return (
    <>
      {renderCell(row.invalidTraffic, "nominal")}
      {row.invalidTrafficShare === "" ? null : (
        <small className="muted-line">{row.invalidTrafficShare.toFixed(0)}% dari domain</small>
      )}
    </>
  );
}

/**
 * Keterangan di bawah nama subdomain — hanya yang mengubah cara barisnya dibaca.
 *
 * Ketiganya adalah keadaan yang membuat sebuah angka di baris itu bukan yang tampaknya, dan
 * masing-masing diperbaiki di halaman yang berbeda: belanja yang belum masuk di sisi sync, tarif
 * Company di tab Potongan Company, dan tarif bonus di halaman Team.
 */
function RowNote({ row }) {
  if (row.daysWithoutSpend > 0) {
    // Seluruh harinya tanpa belanja disebut apa adanya: "1 dari 1 hari" adalah cara berbelit untuk
    // mengatakan bahwa kolom Ad Spend baris ini bukan Rp 0 melainkan tidak diketahui — dan Rp 0
    // yang dibaca sebagai belanja nyata membuat ROI-nya tampak tak terhingga.
    return (
      <small className="muted-line">
        {row.daysWithoutSpend === row.days
          ? "belanja tidak diketahui"
          : `${row.daysWithoutSpend} dari ${row.days} hari tanpa belanja`}
      </small>
    );
  }
  if (row.earningWithoutPercent > 0) {
    return (
      <small className="muted-line">
        {renderCell(row.earningWithoutPercent, "earning")} belum bertarif Company
      </small>
    );
  }
  // Dibedakan dari bonus yang kebetulan nol: tanpa keterangan ini, kolom Bonus yang kosong di
  // sebelah tarif 15% terbaca sebagai perhitungan yang gagal.
  if (row.bonusHeld) {
    return <small className="muted-line">bulan ini rugi — tidak ada bonus</small>;
  }
  return null;
}

/**
 * Tarif Company baris ini — bisa lebih dari satu sejak tarifnya punya tanggal berlaku. Ditulis
 * sebagai rentang ("10% → 20%") dan bukan dipilih salah satu, sepola dengan panel Potongan Company
 * di Laba Rugi: subdomain yang domainnya di-relink di tengah bulan memang dipotong dua tarif.
 *
 * Baris Adsense menggambar "-" dan bukan "belum diisi": potongan ini kena pendapatan Ad Exchange
 * saja, jadi tidak ada tarif yang kurang di sana.
 */
function percentRange({ accountType, companyPercents }) {
  if (accountType !== "Ad-Exchanger") return "-";
  if (companyPercents.length === 0) return "belum diisi";
  if (companyPercents.length === 1) return `${companyPercents[0]}%`;
  return `${companyPercents[0]}% → ${companyPercents[companyPercents.length - 1]}%`;
}

// Tarif bonus lewat `formatPercent` (tableColumns.jsx): kosong bukan 0% — yang pertama berarti
// tarifnya belum diisi di halaman Team, yang kedua berarti orang ini memang tidak dibonuskan.

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

// Nilai yang sedang menyaring tapi tidak ada di daftar pilihan (advertiser yang barisnya hilang
// setelah ganti bulan, `?jenis=` yang diketik tangan) tetap digambar sebagai pilihan. Tanpa ini
// select-nya tampil kosong di atas tabel yang juga kosong, dan satu-satunya keterangan tentang apa
// yang sedang menyaring hilang persis saat ia paling dibutuhkan.
function withCurrent(options, current) {
  return current && !options.includes(current) ? [...options, current] : options;
}

/**
 * Satu kelompok arus kas: judul, daftar itemnya, lalu totalnya.
 *
 * Tiap item menyebut SUMBERNYA di bawah namanya, dan itu bukan hiasan: nama kartunya diambil dari
 * sheet "Dashboard" — kosakata yang dipakai tim saat mengadu angka — sementara yang menentukan ke
 * mana orang PERGI saat sebuah angka terasa aneh adalah sumbernya. "Total Potongan Company"
 * khususnya: angkanya lahir dari pendapatan Google, tapi tarifnya diketik orang di tab Potongan
 * Company.
 *
 * TIDAK ADA baris Total di kaki kelompok mana pun, dan itu bukan kelalaian. Cash Inflow dan Cash
 * Outflow sudah disebutkan baris kepala di atasnya — total yang diulang di kaki kartu adalah angka
 * yang sama dicetak dua kali, dan pembaca yang mengadu keduanya akan mengira ia sedang mengadu dua
 * hal. Cash Available memang tidak punya total sama sekali: ia rantai BERJENJANG, dan menjumlahkan
 * Laba Kotor Google dengan Pendapatan Bersih Google berarti menghitung uang yang sama beberapa
 * kali.
 *
 * TIGA `moneyKey` UNTUK TIGA ARAH, dan ketiganya berwarna berbeda: `earning` (masuk, hijau),
 * `cashOut` (keluar, merah — nilainya tetap positif, lihat `outflowKeys` di renderCell), dan
 * `profit` untuk Cash Available, yang satu-satunya boleh minus dan karena itu warnanya harus
 * mengikuti TANDANYA, bukan kelompoknya: sisa saldo yang minus adalah kabar yang berbeda dari
 * pengeluaran yang besar.
 */
// Arah uang tiap kelompok. Peta, bukan tebakan dari posisi kolomnya — kembaran `MONEY_KEY` di
// ProfitLoss.jsx. Dipakai baris kepala maupun `CashGroup` di bawahnya.
const MONEY_KEY = { in: "earning", out: "cashOut", net: "profit" };

function CashGroup({ title, icon: Icon, tone, items, unknown = 0, moneyKey = "earning" }) {
  return (
    <article className={`cash-group ${tone}`}>
      <header className="cash-group-header">
        <h2>{title}</h2>
        <Icon aria-hidden="true" size={18} />
      </header>
      <ul className="cash-group-items">
        {items.map((item) => (
          <li key={item.key}>
            <div className="cash-group-label">
              <span>{item.label}</span>
              <small>{item.source}</small>
            </div>
            {/* Kosong digambar "-" oleh renderCell, dan itu yang membedakan "belum diinput" dari
                "memang nol" — lihat catatan di cashFlowSummary. */}
            <strong>{renderCell(item.value, moneyKey)}</strong>
          </li>
        ))}
      </ul>
      {unknown > 0 && (
        <p className="cash-group-note">
          {unknown} item belum punya datanya bulan ini — tidak ikut total.
        </p>
      )}
    </article>
  );
}
