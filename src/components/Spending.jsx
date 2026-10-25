import { Coins, Scale, TrendingUp, Wallet } from "lucide-react";
import { useMemo } from "react";
import { useUrlRange, useUrlState } from "../hooks/useUrlState";
import { adTaxRateOf, MIN_ROI_SPEND } from "../lib/adTax";
import { digitsOnly, formatAmountInput } from "../lib/amountInput";
import { datePresets } from "../lib/dateRange";
import { formatDate } from "../lib/formatDate";
import { renderCell } from "../lib/renderCell";
import { buildSpendingPlan } from "../lib/spendingPlan";
import { DataTable } from "./ui/DataTable";
import { DateRangePicker } from "./ui/DateRangePicker";
import { PageHeader } from "./ui/PageHeader";
import { moneyColumn, roiColumn } from "./ui/tableColumns";

// Periode bawaan: tujuh hari terakhir. Diambil dari `datePresets` lewat ID-nya dan bukan disalin
// sebagai dua tanggal kedua — pemilihnya menyorot preset yang cocok PERSIS, dan bawaan yang
// dihitung sendiri akan membuka halaman ini dengan label "rentang khusus" untuk periode yang justru
// jadi bawaannya.
//
// Tujuh dan bukan tiga puluh: dana dibagi ulang menurut hasil terbaru, dan sebulan penuh mencampur
// campaign yang sudah dimatikan dua minggu lalu ke dalam keputusan hari ini. Hari berjalan tetap
// dibuang oleh `buildSpendingPlan`, jadi yang benar-benar terhitung adalah enam hari yang sudah
// selesai — dan kepala panel menyebutkan hari mana saja itu.
const defaultRange = () => {
  const preset = datePresets().find((item) => item.id === "last7");
  return { from: preset.from, to: preset.to };
};

/**
 * Proyeksi belanja berikutnya per advertiser. Aturannya di
 * [`src/lib/spendingPlan.js`](../lib/spendingPlan.js); yang di sini cuma pemilih periode, kotak
 * dana, dan tabelnya.
 *
 * TANPA satu pun kalimat prosa — tidak di kepala halaman, tidak di kepala panel, dan tidak di bawah
 * tabel. Sepola dengan panel "Laporan ROI Realtime" di Overview, tapi lebih jauh: di sana masih ada
 * catatan yang muncul bersyarat, di sini tidak ada sama sekali.
 *
 * Yang menggantikannya adalah tabelnya sendiri, dan itu syarat yang harus dijaga saat menambah
 * kolom nanti: periodenya disebut kepala panel, kolom yang tidak punya pembagi menggambar "-"
 * (bukan Rp 0 — lihat spendingPlan.js), kotak Budget berikutnya yang belum diisi menggambar "-"
 * di tiap barisnya, dan sebab sebuah baris tidak kebagian dana tertulis di bawah namanya sendiri
 * (`RowNote`). Sebuah keadaan yang cuma bisa dijelaskan paragraf di bawah tabel adalah tanda
 * kolomnya yang kurang, bukan tanda paragrafnya yang kurang.
 *
 * Kolom terakhirnya Perlu Transfer, bukan Next Budget, dan itu yang diberi penekanan
 * (`spending-next`): Next Budget menjawab "berapa bagian orang ini", Perlu Transfer menjawab
 * "berapa yang saya kirim sekarang" — dan yang dibawa orang ke halaman ini adalah pertanyaan
 * kedua. Jumlah kolom itu sengaja lebih kecil daripada dana yang diketik; yang wajib sama persis
 * dengan kotak isian tetap kolom Next Budget di sebelahnya.
 */
export function Spending({ store }) {
  const roiReports = store.roiReports || [];
  const whitelistTopup = store.whitelistTopup || [];
  const adAccounts = store.adAccounts || [];
  const users = store.users || [];
  const rate = adTaxRateOf(store.roiSettings);

  const [range, setRange] = useUrlRange("periode", defaultRange);
  // Dana yang akan dibagi, di ALAMAT dan tidak pernah di RTDB — halaman ini kalkulator proyeksi,
  // dan yang boleh tinggal di database cuma yang datang dari API. Di alamat dan bukan `useState`
  // dengan alasan yang sama seperti tiap filter di dashboard ini, plus satu yang khusus: ia yang
  // membuat sebuah proyeksi bisa DIKIRIMKAN sebagai tautan, lengkap dengan angka penyusunnya.
  //
  // Kosong = belum ada yang dibagi. Kolom uang dan kedua ROI tetap terisi sejak halaman dibuka;
  // yang menunggu angka ini cuma Porsi dan Next Budget.
  const [budgetInput, setBudgetInput] = useUrlState("dana", "");
  const nextBudget = Number(digitsOnly(budgetInput));

  const plan = useMemo(
    () =>
      buildSpendingPlan({
        roiReports,
        whitelistTopup,
        adAccounts,
        users,
        range,
        nextBudget,
        rate,
      }),
    [roiReports, whitelistTopup, adAccounts, users, range, nextBudget, rate],
  );

  return (
    <div className="page-stack">
      <PageHeader
        title="Proyeksi Budget"
        action={
          <div className="header-actions">
            <DateRangePicker
              align="right"
              label="Periode riwayat"
              onChange={setRange}
              value={range}
            />
          </div>
        }
      />

      <section className="stats-grid">
        <StatCard
          label="Spending"
          value={plan.totals.totalSpending}
          icon={TrendingUp}
          tone="orange"
        />
        <StatCard label="Total Earning" value={plan.totals.earning} icon={Coins} tone="green" />
        <StatCard label="Total Topup" value={plan.totals.topup} icon={Wallet} tone="blue" />
        <StatCard
          label="ROI Owner"
          value={formatReturn(plan.totals.roiOwner)}
          icon={Scale}
          tone="purple"
          text
        />
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            {/* Periode yang BENAR-BENAR terhitung, bukan rentang yang dipilih: hari berjalan dibuang
                dan hari tanpa baris tidak pernah ada, jadi keduanya rutin berbeda. Ini keterangan
                yang berubah, bukan deskripsi — tanpanya tidak ada satu pun angka di tabel yang tahu
                periodenya. */}
            <h2>
              {plan.dayCount
                ? `${plan.dayCount} hari operasi · ${formatDate(plan.firstDay)} – ${formatDate(plan.lastDay)}`
                : "Belum ada hari yang selesai di rentang ini"}
            </h2>
          </div>
          <div className="header-actions spending-budget">
            <label htmlFor="spending-next-budget">Budget berikutnya</label>
            <input
              className="control compact-control"
              id="spending-next-budget"
              inputMode="numeric"
              onChange={(event) => setBudgetInput(digitsOnly(event.target.value))}
              placeholder="0"
              value={budgetInput === "" ? "" : formatAmountInput(budgetInput)}
            />
          </div>
        </div>

        <DataTable
          className="spending-table"
          columns={spendingColumns(plan)}
          emptyText="Tidak ada baris ROI yang sudah selesai pada periode ini."
          getRowId={(row) => row.key}
          items={plan.rows}
        />
      </section>
    </div>
  );
}

/**
 * Kolom kalkulator. Kedua ROI memakai `formatReturn` (tanpa "+", lihat di bawah) tapi warna yang
 * SAMA dengan kolom ROI di halaman lain, lewat `roiColumn`.
 */
function spendingColumns(plan) {
  const { totals } = plan;

  return [
    {
      accessorKey: "name",
      header: "Advertiser",
      footer: "Total",
      cell: ({ row }) => (
        <>
          <strong>{row.original.name}</strong>
          <RowNote plan={plan} row={row.original} />
        </>
      ),
    },
    moneyColumn("totalSpending", "Spending", "spending", { total: totals.totalSpending }),
    moneyColumn("earning", "Total Earning", "earning", { total: totals.earning }),
    moneyColumn("topup", "Total Topup", "nominal", { total: totals.topup }),
    roiColumn("roiOwner", "ROI Owner", {
      format: formatReturn,
      hint: "Total Earning ÷ Total Topup × 100%",
      total: totals.roiOwner,
    }),
    roiColumn("roiAdvertiser", "ROI Advertiser", {
      format: formatReturn,
      hint: "Total Earning ÷ Spending × 100%",
      total: totals.roiAdvertiser,
    }),
    {
      accessorKey: "share",
      header: "Porsi",
      cell: ({ getValue }) => <Share value={getValue()} />,
      footer: plan.allocated ? "100%" : "-",
      meta: { align: "right", hint: "Total Earning ÷ Total Topup × 100%" },
    },
    moneyColumn("nextBudget", "Next Budget", "spending", {
      hint: "Porsi × Budget berikutnya",
      total: totals.nextBudget,
    }),
    moneyColumn("balance", "Sisa Saldo", "nominal", {
      hint: "Sisa batas pengeluaran Meta (remaining)",
      total: totals.balance,
    }),
    {
      ...moneyColumn("transfer", "Perlu Transfer", "spending", {
        hint: "Next Budget − Sisa Saldo",
        total: totals.transfer,
      }),
      meta: {
        align: "right",
        hint: "Next Budget − Sisa Saldo",
        className: "spending-next",
        footerClassName: "spending-next",
      },
    },
  ];
}

/**
 * Keterangan di bawah nama — hanya yang mengubah cara barisnya dibaca.
 *
 * Yang libur setengah periode tetap dibebani seluruh hari operasi (itu inti ROI Founder), dan tanpa
 * keterangan ini angkanya terbaca sebagai advertiser yang buruk alih-alih advertiser yang baru
 * mulai. Yang tidak punya baris sama sekali disebut lebih dulu: modal yang menganggur penuh adalah
 * temuan, bukan baris kosong.
 */
function RowNote({ plan, row }) {
  if (row.rows === 0) {
    return <small className="muted-line">tidak ada baris ROI pada periode ini</small>;
  }
  // Sejak porsi dibagi menurut ROI Owner, baris tanpa setoran tidak berbobot sama sekali — dan
  // tanpa keterangan ini, kolom Porsi yang kosong terbaca sebagai perhitungan yang gagal, bukan
  // sebagai advertiser yang memang belum menerima top-up di periode itu.
  if (row.earning !== "" && row.topup < MIN_ROI_SPEND) {
    return <small className="muted-line">tidak ada top-up pada periode ini</small>;
  }
  if (row.activeDays < plan.dayCount) {
    return (
      <small className="muted-line">
        aktif {row.activeDays} dari {plan.dayCount} hari
      </small>
    );
  }
  if (row.earningUnknown > 0) {
    return <small className="muted-line">{row.earningUnknown} baris tanpa earning</small>;
  }
  // Hanya saat ada dana yang dibagi: sebelum itu kolom Perlu Transfer memang kosong untuk semua
  // baris, dan keterangan yang menjelaskan sel kosong yang belum menjanjikan apa-apa cuma menambah
  // baris kedua di bawah setiap nama.
  if (row.nextBudget !== "" && !row.balanceKnown) {
    return <small className="muted-line">sisa saldo tidak diketahui — transfer penuh</small>;
  }
  return null;
}

/**
 * Porsi sebagai angka DAN sebagai batang.
 *
 * Batangnya setinggi tiga piksel, sepola dengan proporsi belanja di panel Kalender: yang perlu
 * presisi sudah tertulis di sebelahnya, dan yang dicari mata saat membandingkan belasan baris
 * adalah bentuknya.
 */
function Share({ value }) {
  if (value === "" || value === null || value === undefined) return "-";

  return (
    <span className="spending-share">
      <span className="spending-share-value">{value.toFixed(1)}%</span>
      <span className="spending-share-bar">
        <span style={{ width: `${Math.min(100, value)}%` }} />
      </span>
    </span>
  );
}

/**
 * ROI halaman ini: berapa kali modal kembali sebagai pendapatan.
 *
 * Tanpa tanda "+", berbeda dari `formatRoiPercent` yang dipakai kolom ROI di halaman lain. Tanda
 * itu di sana menandai laba DI ATAS biaya, jadi 0% berarti impas dan minus berarti rugi; di sini
 * 100% yang berarti impas, dan sebuah "+300%" akan dibaca sebagai untung tiga kali lipat padahal
 * artinya untung dua kali.
 */
function formatReturn(value) {
  if (value === null || value === undefined || value === "") return "-";
  return `${Number(value).toFixed(2)}%`;
}

function StatCard({ label, value, icon: Icon, tone, text = false }) {
  return (
    <article className={`stat-card ${tone}`}>
      <div className="stat-card-header">
        <span>{label}</span>
        <Icon size={18} />
      </div>
      <strong>{text ? value : renderCell(value, "earning")}</strong>
    </article>
  );
}
