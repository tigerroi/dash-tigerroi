import { useMemo } from "react";
import { useUrlRange, useUrlState } from "../hooks/useUrlState";
import { cashFlowMonths } from "../lib/cashFlow";
import { monthKeyOf } from "../lib/dateRange";
import { buildDomainProfit } from "../lib/domainProfit";
import { formatMonth } from "../lib/formatDate";
import { monthSpanRange } from "../lib/monthRangeUtil";
import { renderCell } from "../lib/renderCell";
import { DataTable } from "./ui/DataTable";
import { describeDateRange } from "./ui/DateRangePicker";
import { MonthRangePicker } from "./ui/MonthRangePicker";
import { PageHeader } from "./ui/PageHeader";
import { SelectField, toSelectOptions } from "./ui/SelectField";
import { moneyColumn, roiColumn } from "./ui/tableColumns";

/**
 * Laba per Domain — rantai Laba Rugi per DOMAIN, disaring per advertiser.
 *
 * Sheet acuannya bernama "% Advertiser".
 *
 * Aturannya di [`src/lib/domainProfit.js`](../lib/domainProfit.js); yang di sini cuma
 * pemilih bulan, satu penyaring, rantainya, dan dua tabel. Tidak satu angka pun dihitung di berkas
 * ini — barisnya datang dari `buildCashFlow` yang sama dengan tab Cash Flow.
 *
 * KENAPA TINGKAT DOMAIN PUNYA HALAMANNYA SENDIRI. Kesepakatan Potongan Company berdiri per domain
 * (`companyPercents`), dan pencairan rekening juga (`payouts`) — jadi itulah tingkat yang dipakai
 * orang saat menagih dan membagi. Tab Cash Flow menjawabnya per subdomain, yang berarti satu domain
 * berdiri di lima baris yang harus dijumlahkan sendiri di kepala pembacanya; Laba Rugi menjawabnya
 * untuk seluruh usaha sekaligus.
 */
export function DomainProfit({ store }) {
  // Bulan terbaru yang punya baris ROI, bukan selalu bulan berjalan: pada tanggal 1 bulan berjalan
  // baru punya satu hari, dan halaman yang membuka diri hampir kosong terbaca seperti rusak.
  // Alasan yang sama dengan Laba Rugi dan Cash Flow, lewat `cashFlowMonths` yang sama.
  const months = useMemo(() => cashFlowMonths(store), [store]);
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
  const [pic, setPic] = useUrlState("advertiser", "");

  const report = useMemo(() => buildDomainProfit(store, range, { pic }), [store, range, pic]);

  // Rantai yang digambar panel pertama. `key` tiap baris ADALAH nama field totalnya, jadi menambah
  // satu baris di rantai tidak menuntut peta perantara yang bisa ketinggalan. Sepola dengan
  // `lines` di ProfitLoss.jsx.
  //
  // LABELNYA kosakata halaman ini, `key`-nya tetap nama field `buildCashFlow` — dua hal yang
  // memang tidak harus sama. Mengganti `key`-nya berarti mengganti nama field di cashFlow.js
  // juga, dan dua tab bersebelahan lalu menyebut satu angka dengan dua nama field.
  //
  // TAPI LABELNYA SENDIRI SAMA DENGAN TAB SEBELAHNYA, dan itu bukan kelalaian: barisnya datang
  // dari `buildCashFlow` yang sama, jadi kolom ini menyebut angka yang sama persis dengan kolom
  // di tab Cash Flow. Satu angka dengan dua nama tidak akan dikenali sebagai satu angka oleh yang
  // mengadu kedua tab — dan mengadu keduanya adalah satu-satunya cara memeriksa halaman ini.
  //
  // "Potongan", bukan "Biaya": di dashboard ini "Biaya" sudah berarti ongkos menjalankan usaha
  // (Biaya Operasional, Biaya Approval), sementara yang ini clawback atas pendapatan yang
  // dihasilkan advertiser itu sendiri — berdampingan dengan Potongan Company dan Invalid Traffic,
  // dan seperti keduanya ia mengurangi dasar bonus; sewa server tidak.
  //
  // DAN LABELNYA TIDAK MENYEBUT NEGARA. Yang dipungut memang cuma rantai rekening asing — hari
  // ini Pakistan — tapi `payoutCostRows` tidak menanyakan negara sama sekali (lihat
  // lib/payouts.js): ia menanyakan berapa yang hilang di jalan, dan menemukan domainnya sendiri.
  // Nama yang menyebut instansi hari ini akan jadi salah pada hari rantai asing kedua dicatat —
  // tanpa satu baris kode berubah, dan tanpa satu tes pun bisa menangkapnya. Yang menerangkan
  // siapa yang kena adalah ColumnHint di kepala kolomnya, yang tetap benar saat itu terjadi.
  const chain = [
    { key: "earning", label: "Pendapatan", flow: "in" },
    { key: "totalSpending", label: "Belanja iklan + pajak", flow: "out" },
    { key: "company", label: "Potongan Company Ad Exchange", flow: "out" },
    { key: "invalidTraffic", label: "Invalid Traffic", flow: "out" },
    { key: "payoutCost", label: "Potongan Pencairan", flow: "out" },
    { key: "netProfit", label: "Gross Profit Advertiser", flow: "net" },
    // Porsi biaya operasional menurut earning (sejak Juli 2026), mengikuti sheet "Rekap %
    // Advertiser": ia mengurangi Net Income Owner di bawahnya, sama dengan Laba Rugi.
    { key: "operatingExpense", label: "Biaya Operasional", flow: "out" },
    { key: "bonus", label: "Bonus advertiser", flow: "out" },
    { key: "netIncomeOwner", label: "Net Income Owner", flow: "net" },
  ];

  const scope = pic || "semua advertiser";

  return (
    <div className="page-stack">
      <PageHeader
        title="Laba per Domain"
        description="Rantai Laba Rugi per domain, dan bagian tiap advertiser di dalamnya."
        action={
          <div className="header-actions">
            {/* Pemilih BULANAN, bukan `DateRangePicker` yang dipakai halaman lain — lihat
                MonthRangePicker. Seluruh rantai di grup ini bertumpu pada tiga sumber yang berdiri
                per BULAN (invalid traffic, akun ditutup, potongan pencairan), dan ketiganya hanya
                ikut kalau rentangnya menutup bulannya penuh. Pemilih harian bisa menghasilkan batas
                yang menjatuhkan ketiganya sekaligus; yang ini tidak bisa. */}
            <MonthRangePicker
              label="Filter periode Laba per Domain"
              onChange={setRange}
              value={range}
            />
            {/* Nilai yang menyaring tapi tidak ada di daftar pilihan (advertiser yang bulan ini
                tidak punya baris, alamat yang diketik tangan) tetap digambar: tanpa itu select-nya
                tampil kosong di atas tabel yang juga kosong, dan satu-satunya keterangan tentang
                apa yang sedang menyaring hilang persis saat ia paling dibutuhkan. */}
            <SelectField
              ariaLabel="Saring menurut advertiser"
              className="compact-control"
              value={pic}
              onChange={setPic}
              options={[
                { value: "", label: "Semua advertiser" },
                ...toSelectOptions(withCurrent(report.picOptions, pic)),
              ]}
            />
          </div>
        }
      />

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>{describeDateRange(range.from, range.to)}</h2>
            <p>
              {report.rows.length} domain, {scope}.
            </p>
          </div>
        </div>

        {/* Rantai laba: urutan barisnya ADALAH rantainya, jadi tidak ada kolom yang diurutkan. */}
        <DataTable
          className="pl-table"
          columns={[
            { accessorKey: "label", header: "Baris", enableSorting: false },
            {
              id: "value",
              header: "Nilai",
              enableSorting: false,
              cell: ({ row }) =>
                renderCell(report.totals[row.original.key], MONEY_KEY[row.original.flow]),
              meta: { align: "right" },
            },
          ]}
          getRowId={(line) => line.key}
          items={chain}
          rowClassName={(line) => `pl-row pl-${line.flow}`}
        />

        {/* Domain yang ditutup dikeluarkan dari rantai di atas, dan itu WAJIB disebutkan: angkanya
            akan diadu dengan Laba Rugi dan Cash Flow, yang keduanya masih memuatnya. Nilainya
            Net Income Owner — baris terakhir rantai di atas, yaitu yang benar-benar tidak akan
            mendarat di rekening.

            SENGAJA BUKAN angka yang sama dengan item "Akun Close Cut" di kartu Cash Flow, yang
            sejak 5 Sep 2026 memotong Gross Profit (laba SEBELUM bonus). Keduanya menjawab
            pertanyaan yang berbeda: yang di sana "berapa laba domain ini yang dikeluarkan dari
            rantai bulan itu", yang di sini "berapa yang hilang dari kantong pemilik" — dan bonus
            advertiser atas laba yang tidak pernah cair tetap dibayarkan, jadi ia mengurangi yang
            kedua dan tidak mengurangi yang pertama. Selisih keduanya PERSIS bonus domain itu
            (Mei 2026: Rp 6.288.256). */}
        {report.closedRows.length > 0 && (
          <p className="notice-line">
            {report.closedRows.map((row) => row.domain).join(", ")} ditandai Account Close di
            Pencairan, jadi tidak ikut rantai di atas —{" "}
            {renderCell(report.closedTotals.netIncomeOwner, "profit")} yang tidak akan cair. Laba
            Rugi dan Cash Flow masih menjumlahkannya.
          </p>
        )}

        {/* Sepola dengan Cash Flow: nominal yang tidak punya ember untuk dibagi disebutkan alih-alih
            hilang. Ia milik bulan, bukan baris, jadi ia tidak ikut menyempit saat seorang advertiser
            dipilih. */}
        {report.totals.invalidTrafficUnspread > 0 && (
          <p className="notice-line">
            {renderCell(report.totals.invalidTrafficUnspread, "nominal")} invalid traffic tidak ikut
            rantai di atas — domain dan jenis akunnya tidak punya earning bulan ini, jadi tidak ada
            baris yang bisa menanggungnya.
          </p>
        )}

        {report.partialMonths.length > 0 && (
          <p className="notice-line">
            Invalid traffic dan pendapatan akun tertutup{" "}
            {report.partialMonths.map(formatMonth).join(", ")} belum ikut — rentangnya tidak menutup
            bulan itu penuh. Keduanya diinput per bulan dan tidak bisa dibagi per hari.
          </p>
        )}
      </section>

      <DomainTable
        title="Per domain"
        description={`Terurut dari penyumbang terbesar, ${scope}.`}
        rows={report.rows}
        totals={report.totals}
        empty={
          pic
            ? "Advertiser ini tidak punya baris pada periode itu."
            : "Tidak ada baris ROI pada periode ini."
        }
      />

      {/* Tabelnya sendiri, bukan baris bertanda di tabel yang sama: pendapatan domain yang akunnya
          ditutup Google tidak akan pernah cair, dan menjumlahkannya bersama yang lain menghasilkan
          Net Income Owner yang tidak mendarat di rekening siapa pun. Sepola dengan blok "Accounts
          Close" di spreadsheet acuannya. */}
      {report.closedRows.length > 0 && (
        <DomainTable
          title="Akun ditutup"
          description="Ditandai Account Close di Pencairan — tidak ikut rantai di atas."
          rows={report.closedRows}
          totals={report.closedTotals}
          empty=""
        />
      )}
    </div>
  );
}

/**
 * Warna sebuah angka menandai ARAH uangnya, bukan besarnya — peta yang sama dengan ProfitLoss.jsx.
 *
 * `net` memakai `profit`, dan itu satu-satunya yang warnanya mengikuti TANDA: net profit dan net
 * income owner boleh minus, dan minus di sana adalah kabar yang menuntut tindakan.
 */
const MONEY_KEY = { in: "earning", out: "cashOut", net: "profit" };

function DomainTable({ title, description, rows, totals, empty }) {
  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </div>

      <DataTable columns={domainColumns(totals)} emptyText={empty} items={rows} />
    </section>
  );
}

function domainColumns(totals) {
  return [
    {
      accessorKey: "domain",
      header: "Domain",
      footer: "Total",
      cell: ({ row }) => (
        <>
          {row.original.domain}
          <small className="muted-line">
            {row.original.subDomains} subdomain · {row.original.accountTypes.join(", ")}
          </small>
        </>
      ),
    },
    {
      // Nama-namanya, bukan hitungannya: yang dicari orang di kolom ini adalah SIAPA, dan
      // "2 advertiser" menuntut satu klik lagi untuk menjawabnya.
      id: "pics",
      header: "Advertiser",
      accessorFn: (row) => row.pics.join(", "),
    },
    moneyColumn("earning", "Earning", "earning", { total: totals.earning }),
    moneyColumn("totalSpending", "Ad Spend + Ad Tax", "totalSpending", {
      total: totals.totalSpending,
    }),
    // ROI baris Total dihitung dari JUMLAH uangnya oleh `cashFlowTotals`, bukan dirata-ratakan dari
    // kolom di atasnya.
    roiColumn("roi", "ROI", { total: totals.roi }),
    {
      id: "companyPercents",
      header: "Company %",
      cell: ({ row }) => percentSet(row.original.companyPercents),
      footer: "-",
      meta: { align: "right", sortValue: (row) => row.companyPercents?.at(-1) },
    },
    moneyColumn("company", "Company", "nominal", { total: totals.company }),
    moneyColumn("invalidTraffic", "Invalid Traffic", "nominal", { total: totals.invalidTraffic }),
    // Yang menerangkan SIAPA yang kena tinggal di hint, bukan di nama kolomnya: aturannya tidak
    // menanyakan negara, jadi nama yang menyebut satu negara akan jadi salah tanpa satu baris kode
    // pun berubah.
    moneyColumn("payoutCost", "Potongan Pencairan", "nominal", {
      hint: "Fee rekening perantara + konversi mata uang + pajak negara asal (Real Masuk − Saldo Akhir di tab Pencairan), per domain. Hanya domain yang dibayar lewat rantai rekening asing; yang dibayar ke bank lokal kehilangan nol dan tidak dipotong apa pun.",
      total: totals.payoutCost,
    }),
    moneyColumn("netProfit", "Gross Profit Advertiser", "profit", { total: totals.netProfit }),
    roiColumn("netRoi", "Net ROI", { total: totals.netRoi }),
    moneyColumn("operatingExpense", "Biaya Operasional", "nominal", {
      total: totals.operatingExpense,
    }),
    {
      id: "bonusPercents",
      header: "Bonus %",
      cell: ({ row }) => (
        <>
          {percentSet(row.original.bonusPercents)}
          {row.original.bonusHeld && <small className="muted-line">bulan ini rugi</small>}
        </>
      ),
      footer: "-",
      meta: { align: "right", sortValue: (row) => row.bonusPercents?.at(-1) },
    },
    moneyColumn("bonus", "Bonus", "nominal", { total: totals.bonus }),
    moneyColumn("netIncomeOwner", "Net Income Owner", "profit", { total: totals.netIncomeOwner }),
  ];
}

/**
 * Himpunan tarif yang benar-benar dipakai, ditulis "10% → 20%" dan bukan dipilih salah satu.
 *
 * Sebulan bisa memuat dua tarif Company (tarifnya bertanggal) dan sebuah domain bisa dipegang dua
 * advertiser bertarif bonus berbeda — satu angka di kolom ini harus memilih salah satunya, dan yang
 * mana pun yang dipilih ia berbohong untuk sebagian barisnya. Kosong digambar "-", bukan "0%": nol
 * adalah tarif yang benar-benar nol, dan itu pernyataan yang berbeda dari tarif yang belum diisi.
 */
function percentSet(percents) {
  if (!percents?.length) return "-";
  return percents.map((percent) => `${percent}%`).join(" → ");
}

// Nilai yang sedang menyaring tapi tidak ada di daftar pilihan tetap digambar sebagai pilihan.
function withCurrent(options, current) {
  return current && !options.includes(current) ? [...options, current] : options;
}
