import { useMemo } from "react";
import { useUrlRange } from "../hooks/useUrlState";
import { monthKeyOf } from "../lib/dateRange";
import { formatMonth } from "../lib/formatDate";
import { monthSpanRange, previousMonthSpanRange } from "../lib/monthRangeUtil";
import { buildProfitLoss, deltaOf, profitLossLines, profitLossMonths } from "../lib/profitLoss";
import { formatRupiah, renderCell } from "../lib/renderCell";
import { DataTable } from "./ui/DataTable";
import { describeDateRange } from "./ui/DateRangePicker";
import { MonthRangePicker } from "./ui/MonthRangePicker";
import { PageHeader } from "./ui/PageHeader";
import { moneyColumn } from "./ui/tableColumns";

export function ProfitLoss({ store }) {
  const financials = store.weeklyFinancials || [];
  const expenses = store.expenses || [];
  const whitelistTopup = store.whitelistTopup || [];
  const invalidTraffic = store.invalidTraffic || [];
  // Biaya penyambungan Ad Exchange, halaman Cost Ad Exchange. Menyatu dengan `expenses` di baris
  // Pengeluaran operasional — lihat buildProfitLoss.
  const adxCosts = store.adxCosts || [];
  // Rincian pemilik: baris ROI tahu earning dan belanja tiap subdomain, `subDomains` tahu domain
  // induk dan PIC-nya, `companyPercents` menyimpan tarif potongan Company berikut tanggal
  // berlakunya, `users` tarif bonus. Semuanya hanya dipakai untuk dua potongan yang tarifnya bukan
  // milik seluruh usaha — totalnya tetap dari weeklyFinancials.
  //
  // `domains` tinggal untuk NAMANYA saja sejak tarif pindah ke koleksinya sendiri: ia yang
  // memberi label baris rincian, dan pencocokan akhirannya sekarang dikerjakan `domainIndex`.
  const roiReports = store.roiReports || [];
  // Earning bulanan subdomain yang akun Google-nya sudah ditutup — satu-satunya angka earning yang
  // diketik orang, dan satu-satunya yang tidak ada di API mana pun. Tab Akun Ditutup.
  const accountCloses = store.accountCloses || [];
  const subDomains = store.subDomains || [];
  const domains = store.domains || [];
  const companyPercents = store.companyPercents || [];
  const bonusPercents = store.bonusPercents || [];
  const users = store.users || [];
  // Baris pencairan — sumber Potongan pencairan di rantai. Yang dibaca darinya cuma Real Masuk dan
  // Saldo Akhir, dua kolom yang sudah diketik di tab Pencairan; tidak ada angka baru di sini.
  const payouts = store.payouts || [];

  // Bulan terbaru yang punya data, bukan selalu bulan berjalan: pada tanggal 1 bulan berjalan
  // masih kosong, dan halaman yang membuka diri dalam keadaan kosong terbaca seperti rusak.
  const months = useMemo(
    () =>
      profitLossMonths({
        financials,
        expenses,
        whitelistTopup,
        invalidTraffic,
        adxCosts,
        accountCloses,
      }),
    [financials, expenses, whitelistTopup, invalidTraffic, adxCosts, accountCloses],
  );
  // Bawaannya BULAN PENUH terbaru yang punya data — bukan "hari ini", dan bukan "sampai hari ini".
  // Dua sebabnya: pada tanggal 1 bulan berjalan masih kosong dan halaman yang membuka diri dalam
  // keadaan kosong terbaca seperti rusak, dan bulan penuh adalah satu-satunya bentuk rentang yang
  // memuat nominal invalid traffic serta earning akun tertutup bulan itu (lihat `wholeMonthsIn`).
  //
  // `monthKeyOf` (waktu lokal), bukan `toISOString().slice(0, 7)` yang menjawab menurut UTC — antara
  // 00:00-07:00 WIB tanggal 1, yang terakhir menyebut bulan lalu.
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

  // Satu objek sumber, dipakai bulan ini dan bulan pembanding. Dimemo sendiri supaya kedua
  // `buildProfitLoss` di bawahnya tidak dihitung ulang tiap render — ia menyisir seluruh baris ROI
  // bulan itu, dan halaman ini punya kotak bulan yang berubah tiap ketikan.
  const sources = useMemo(
    () => ({
      financials,
      expenses,
      whitelistTopup,
      invalidTraffic,
      adxCosts,
      roiReports,
      accountCloses,
      payouts,
      subDomains,
      domains,
      companyPercents,
      bonusPercents,
      users,
    }),
    [
      financials,
      expenses,
      whitelistTopup,
      invalidTraffic,
      adxCosts,
      roiReports,
      accountCloses,
      payouts,
      subDomains,
      domains,
      companyPercents,
      bonusPercents,
      users,
    ],
  );
  const report = useMemo(() => buildProfitLoss({ ...sources, range }), [sources, range]);
  // Periode pembanding: bulan kalender PENUH sebelumnya — Agustus melawan 1–31 Juli, bukan 31 hari
  // terakhir yang berakhir 31 Juli. Yang terakhir tidak menutup bulan mana pun, jadi `wholeMonthsIn`
  // menjatuhkan invalid traffic, akun ditutup, dan potongan pencairan dari sisi pembandingnya saja.
  const compared = useMemo(() => previousMonthSpanRange(range), [range]);
  const before = useMemo(
    () => buildProfitLoss({ ...sources, range: compared }),
    [sources, compared],
  );

  const lines = profitLossLines(report);
  // Satu label untuk periode pembanding, dipakai kepala panel, kepala kolom, dan dua catatan di
  // bawah tabel. Rentang tanpa batas ("Semua tanggal") tidak punya periode sebelumnya.
  const comparedLabel = compared.from
    ? describeDateRange(compared.from, compared.to)
    : "periode sebelumnya";
  const incomplete = report.daysExpected > 0 && report.daysWithData < report.daysExpected;
  // Bulan PEMBANDING juga, dan sebabnya bukan kerapian: seluruh kolom Selisih dihitung
  // terhadapnya. Membuka Mei 2026 mengadu bulan itu dengan April yang `roiReports`-nya belum
  // mulai, dan yang tergambar bukan "April belum terisi" melainkan pertumbuhan tiga digit.
  const beforeIncomplete =
    before.daysExpected > 0 && before.daysWithData < before.daysExpected && before.daysWithData > 0;
  const beforeEmpty = before.daysExpected > 0 && before.daysWithData === 0;
  // Pendapatan yang tidak punya baris ROI: potongan Company dan bonus tidak menyentuhnya sama
  // sekali. Ambangnya 1% supaya pembulatan dan satu-dua baris yang laporannya gagal tidak
  // menyalakan peringatan tiap hari.
  const uncovered = report.revenue > 0 && Math.abs(report.coverageGap) > report.revenue * 0.01;

  return (
    <div className="page-stack">
      <PageHeader
        title="Laba Rugi"
        description="Rekap bulanan mengikuti rantai Cash Flow Statement."
        action={
          <div className="header-actions">
            {/* Pemilih BULANAN, bukan `DateRangePicker` yang dipakai halaman lain — lihat
                MonthRangePicker. Seluruh rantai di grup ini bertumpu pada tiga sumber yang berdiri
                per BULAN (invalid traffic, akun ditutup, potongan pencairan), dan ketiganya hanya
                ikut kalau rentangnya menutup bulannya penuh. Pemilih harian bisa menghasilkan batas
                yang menjatuhkan ketiganya sekaligus; yang ini tidak bisa. */}
            <MonthRangePicker label="Filter periode Laba Rugi" onChange={setRange} value={range} />
          </div>
        }
      />

      {incomplete && (
        <p className="notice-line">
          Baru terisi {report.daysWithData} dari {report.daysExpected} hari. Angkanya belum utuh —
          bukan berarti turun.
        </p>
      )}

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>{describeDateRange(range.from, range.to)}</h2>
            {/* Marjin dulu menumpang label kartu "Net Income Owner"; tanpa tempat ini ia hilang
                dari halaman sama sekali, dan ia satu-satunya angka di sini yang tidak bisa
                dihitung ulang sekilas dari kolom di bawahnya. */}
            <p>
              Dibandingkan dengan {comparedLabel}.
              {report.margin === null ? "" : ` Marjin ${report.margin}%.`}
            </p>
          </div>
        </div>

        {/* Laporan, bukan daftar: urutan barisnya ADALAH rantai labanya, jadi tidak satu kolom pun
            bisa diurutkan — "Net profit" yang naik ke atas "Pendapatan" berhenti bisa dibaca
            menurun. */}
        <DataTable
          className="pl-table"
          columns={[
            { accessorKey: "label", header: "Baris", enableSorting: false },
            {
              id: "value",
              header: describeDateRange(range.from, range.to),
              enableSorting: false,
              cell: ({ row }) => renderCell(row.original.value, MONEY_KEY[row.original.flow]),
              meta: { align: "right" },
            },
            {
              // Dibaca langsung dari laporan bulan lalu, bukan dari daftar barisnya: tiap kunci di
              // rantai ini ADALAH nama field laporan, dan peta perantara cuma satu tempat lagi yang
              // bisa ketinggalan saat sebuah baris ditambahkan.
              id: "before",
              header: comparedLabel,
              enableSorting: false,
              cell: ({ row }) => renderCell(before[row.original.key], MONEY_KEY[row.original.flow]),
              meta: { align: "right" },
            },
            {
              id: "delta",
              header: "Selisih",
              enableSorting: false,
              cell: ({ row }) => (
                <Delta
                  {...deltaOf(row.original.value, before[row.original.key])}
                  higherIsBetter={row.original.kind === "in" || row.original.kind === "total"}
                />
              ),
              meta: { align: "right" },
            },
          ]}
          getRowId={(line) => line.key}
          items={lines}
          rowClassName={(line) => `pl-row pl-${line.kind}`}
        />

        {beforeEmpty && (
          <p className="notice-line">
            {comparedLabel} belum punya data sama sekali, jadi kolom Selisih di atas membandingkan
            dengan nol — bukan penurunan maupun pertumbuhan.
          </p>
        )}

        {beforeIncomplete && (
          <p className="notice-line">
            {comparedLabel} baru terisi {before.daysWithData} dari {before.daysExpected} hari, jadi
            kolom Selisih membandingkan dengan periode yang belum utuh.
          </p>
        )}

        {/* Nominal invalid traffic dan earning akun tertutup berdiri per BULAN dan tidak bisa
            dibelah per hari, jadi bulan yang cuma terpotong sebagian tidak ikut. Disebutkan, karena
            potongan yang diam-diam hilang terbaca sebagai laba yang lebih besar — dan pilih preset
            "Bulan lalu" adalah perbaikannya, bukan sesuatu yang harus ditebak. */}
        {report.partialMonths.length > 0 && (
          <p className="notice-line">
            Invalid traffic dan pendapatan akun tertutup{" "}
            {report.partialMonths.map(formatMonth).join(", ")} belum ikut — rentangnya tidak menutup
            bulan itu penuh. Keduanya diinput per bulan dan tidak bisa dibagi per hari.
          </p>
        )}

        {/* Satu-satunya angka di rantai ini yang diketik orang. Ia sudah ikut dijumlah di baris
            Pendapatan dan Belanja iklan, dan karena itulah ia wajib disebutkan: angka ketikan yang
            berdiri tanpa tanda di antara angka sync adalah dua hal berbeda yang mengaku satu. */}
        {report.accountCloseEarning > 0 && (
          <p className="notice-line">
            Termasuk {renderCell(report.accountCloseEarning, "earning")} pendapatan dan{" "}
            {renderCell(report.accountCloseSpending, "cashOut")} belanja dari akun yang sudah
            ditutup Google — diketik di tab Akun Ditutup, karena API-nya tidak menjawab lagi.
          </p>
        )}

        {uncovered && (
          <p className="notice-line">
            {renderCell(Math.abs(report.coverageGap), "earning")} pendapatan tidak punya baris ROI,
            jadi tidak dipotong Company maupun dihitungi bonus. Perbaikannya di /sub-domains.
          </p>
        )}

        {report.earningWithoutPercent > 0 && (
          <p className="notice-line">
            {renderCell(report.earningWithoutPercent, "earning")} earning Ad Exchange dari hari yang
            belum punya tarif Company — tidak dipotong. Isi tarifnya di tab Potongan Company.
          </p>
        )}

        {/* Nominalnya sudah terhitung penuh di Belanja Iklan, dan fee-nya memang tidak
            dikurangkan di rantai ini — lihat `topupFee` di lib/profitLoss.js. */}
        <p className="notice-line">
          {/* Nominalnya MASUK ke akun iklan (Cash Flow menghitungnya sebagai Cash In Flow), fee-nya
              keluar ke rekening perantara — dua arah yang berbeda dalam satu kalimat, dan warnanya
              satu-satunya yang membedakannya. */}
          Top-up whitelist {renderCell(report.topupNominal, "earning")} (fee{" "}
          {renderCell(report.topupFees, "cashOut")}) tidak masuk rantai di atas.
        </p>
      </section>

      <section className="pl-breakdowns">
        {/* Berdiri paling depan karena ia menyentuh KEPALA rantai (Pendapatan), bukan salah satu
            potongannya — dan karena ia satu-satunya yang angkanya diketik orang. */}
        <Breakdown
          title="Pendapatan Akun Ditutup"
          description="Per subdomain, diketik di tab Akun Ditutup."
          flow="in"
          rows={report.accountCloseBreakdown}
          total={report.accountCloseEarning}
        />
        <Breakdown
          title="Potongan Company Ad Exchange"
          description="Per domain."
          rows={report.companyBreakdown}
          total={report.companyDeduction}
          metaLabel="Tarif"
          metaOf={(row) => percentRange(row.percents)}
        />
        <Breakdown
          title="Bonus Advertiser"
          description={bonusBasisNote(report)}
          rows={report.bonusBreakdown}
          total={report.advertiserBonus}
          metaLabel="Tarif"
          metaOf={(row) => (row.percent === null ? "belum diisi" : `${row.percent}%`)}
        />
        <Breakdown
          title="Invalid Traffic"
          description="Per domain."
          rows={report.invalidTrafficBreakdown}
          total={report.invalidTraffic}
        />
        {/*
          Rinciannya per DOMAIN karena di situlah pencairan berdiri — satu wire per domain per
          bulan — dan barisnya menunjuk persis ke satu baris di tab Pencairan yang bisa diadu
          dengan mutasi rekeningnya. Kolom Bulan ikut walau halaman ini sudah punya periodenya
          sendiri: potongan ini BULANAN, jadi rentang yang menutup dua bulan penuh memuat dua baris
          untuk domain yang sama, dan dua angka bernama sama tanpa bulan di sebelahnya tidak bisa
          dibedakan pembacanya.
        */}
        <Breakdown
          title="Potongan Pencairan"
          description="Per domain — fee rekening perantara, konversi mata uang, dan pajak negara asal."
          rows={report.payoutCostBreakdown}
          total={report.payoutCost}
          metaLabel="Bulan"
          metaOf={(row) => formatMonth(row.month)}
        />
        {/*
          Satu panel untuk kedua penyusunnya, terurut dari yang terbesar — itu pertanyaan yang
          dibawa orang ke sini, dan dua panel terpisah menjawabnya cuma di dalam masing-masing
          kelompok. Kolom Sumber yang menggantikan pemisahannya: sebuah baris yang naik dua juta
          tetap harus menyebutkan ke halaman mana orang pergi memperbaikinya.
        */}
        <Breakdown
          title="Pengeluaran Operasional"
          description="Per nama item (Expenses) dan per domain (Cost Ad Exchange)."
          rows={report.operatingExpenseBreakdown}
          total={report.operatingExpenses}
          metaLabel="Sumber"
          metaOf={(row) => row.source}
        />
        <Breakdown
          title="Fee Top-Up Whitelist"
          description="Catatan — tidak dikurangkan dari laba."
          rows={report.topupBreakdown}
          total={report.topupFees}
        />
      </section>
    </div>
  );
}

/**
 * Warna sebuah angka menandai ARAH uangnya, bukan besarnya — satu peta untuk seluruh halaman ini,
 * dipakai baris rantai maupun panel rincian.
 *
 * `cashOut` menggambar angkanya tetap POSITIF dan hanya warnanya yang berubah (lihat `outflowKeys`
 * di renderCell), jadi baris biaya tidak mendadak berbunyi minus — yang ditandai merah di sini
 * adalah kelompoknya, bukan penilaian bahwa satu angka lebih buruk daripada tetangganya.
 *
 * `net` memakai `profit`, dan itu satu-satunya yang warnanya mengikuti TANDA: laba kotor, net
 * profit, dan net income owner boleh minus, dan minus di sana adalah kabar yang menuntut tindakan.
 * Menandainya merah selamanya (seolah kelompok "keluar") akan menghapus satu-satunya tempat di
 * halaman ini di mana merah benar-benar berarti rugi.
 */
const MONEY_KEY = { in: "earning", out: "cashOut", net: "profit" };

/**
 * Tarif Potongan Company sebuah domain di bulan itu — bisa lebih dari satu sejak tarifnya punya
 * tanggal berlaku. Ditulis sebagai rentang ("10% → 20%") dan bukan dipilih salah satu: domain yang
 * di-relink di tengah bulan memang dipotong dua tarif, dan satu angka di kolom ini akan berbohong
 * untuk separuh bulannya.
 */
function percentRange(percents) {
  const list = percents || [];
  if (list.length === 0) return "belum diisi";
  if (list.length === 1) return `${list[0]}%`;
  return `${list[0]}% → ${list[list.length - 1]}%`;
}

// Naik belum tentu kabar baik: pendapatan yang naik dan belanja yang naik bergerak ke arah yang
// sama di layar tapi ke arah berlawanan di kantong. `higherIsBetter` yang memutuskan warnanya,
// jadi kolom biaya tidak pernah hijau hanya karena angkanya bertambah.
function Delta({ delta, percent, higherIsBetter = false, withLabel = false }) {
  if (!delta) {
    return <span className="delta delta-flat">{withLabel ? "sama dengan bulan lalu" : "-"}</span>;
  }

  const good = delta > 0 === higherIsBetter;
  const sign = delta > 0 ? "+" : "−";
  const amount = Math.abs(delta).toLocaleString("id-ID", { maximumFractionDigits: 0 });

  return (
    <span className={`delta ${good ? "delta-good" : "delta-bad"}`}>
      {sign}Rp {amount}
      {percent === null ? "" : ` (${sign}${Math.abs(percent).toFixed(0)}%)`}
      {withLabel ? " vs bulan lalu" : ""}
    </span>
  );
}

/**
 * Keterangan panel Bonus Advertiser: dasar bonusnya apa, dan berapa yang dipotong dari sana.
 *
 * Ia BERBEDA dari bulan ke bulan, dan itu justru yang menuntut kalimat ini ada. Sejak Juli 2026
 * pengeluaran operasional dibagi ke tiap advertiser menurut porsi earning dan ikut mengurangi
 * dasarnya; bulan-bulan sebelumnya tidak, dan bonusnya sudah dibayarkan atas dasar itu. Dua bulan
 * bertetangga yang memakai dua aturan tanpa satu tanda pun di layar adalah persis keadaan yang
 * membuat orang menghitung ulang sendiri di spreadsheet.
 */
function bonusBasisNote(report) {
  if (!report.bonusOperatingExpense) {
    return "Per PIC, dari net profit sebelum pengeluaran operasional.";
  }
  return `Per PIC, dari net profit sesudah porsi pengeluaran operasionalnya — ${formatRupiah(report.bonusOperatingExpense)} dibagi menurut porsi earning tiap orang.`;
}

// `metaOf` menambah satu kolom di tengah — tarif potongan/bonus. Tarifnya ikut ditampilkan karena
// dua angka yang sama besar bisa lahir dari earning besar bertarif kecil atau sebaliknya, dan yang
// bisa diperbaiki orang cuma tarifnya.
function Breakdown({
  title,
  description,
  rows,
  total,
  metaLabel = "",
  metaOf = null,
  // Arah uang panelnya. Bawaannya "out" karena lima dari enam panel di halaman ini adalah potongan
  // atau biaya — yang masuk cuma Pendapatan Akun Ditutup, dan ia menyebutkannya sendiri.
  flow = "out",
}) {
  return (
    <div className="panel">
      <div className="panel-header">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </div>
      <DataTable
        className="breakdown-table"
        columns={[
          { accessorKey: "label", header: "Nama", footer: "Total" },
          ...(metaOf
            ? [
                {
                  id: "meta",
                  header: metaLabel,
                  cell: ({ row }) => metaOf(row.original),
                  meta: { align: "right", sortValue: metaOf },
                },
              ]
            : []),
          moneyColumn("total", "Total", MONEY_KEY[flow], { total }),
        ]}
        emptyText="Tidak ada baris pada bulan ini."
        // `key` sendiri untuk baris gabungan: satu item Expenses dan satu domain Cost Ad Exchange
        // bisa bernama sama, dan dua baris berkunci sama membuat React menggambar salah satunya
        // saja.
        getRowId={(row, index) => String(row.key || row.label || index)}
        items={rows}
      />
    </div>
  );
}
