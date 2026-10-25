import { useMemo } from "react";
import { formatRoiPercent } from "../../lib/adTax";
import { formatDate } from "../../lib/formatDate";
import { MoneyByCurrency, renderCell } from "../../lib/renderCell";
import {
  earningSourceLabel,
  normalizeRealtimeRoiRow,
  realtimeRoiColumnTone,
} from "../../lib/roiRealtime";
import { CountryBreakdownBadge } from "./CountryBreakdownBadge";
import { DataTable } from "./DataTable";
import { MergedCampaignsBadge } from "./MergedCampaignsBadge";
import { MetaSpendNote } from "./MetaSpendNote";

/**
 * Tabel ROI per sync — SATU komponen untuk kedua panel yang menggambarnya:
 * "Laporan ROI Realtime" di Overview dan "Report Master Realtime ROI Khusus Anda" di
 * /users/{uid}. Barisnya sudah disaring pemanggilnya (Overview: seluruh armada; profil user:
 * subdomain yang dipegang orang itu), dan yang sama di keduanya adalah KOLOMNYA.
 *
 * Ditulis dua kali, keduanya berselisih tanpa berbunyi sebagai kesalahan apa pun: sampai berkas
 * ini ada, tabel di profil user kehilangan Fluk. Spend/Earn/ROI, Profit, rincian Negara, dan
 * META BAL. — enam kolom, plus kepala kelompok berwarna yang membedakan sisi Meta dari sisi
 * earning. Yang membacanya tidak punya cara tahu bahwa kolomnya ADA di halaman sebelah.
 */
export function RealtimeRoiTable({ items, rate, countryBreakdown, picOf }) {
  // `picOf` (opsional) menambal PIC baris yang ditulis sebelum subdomainnya diberi PIC, lewat
  // indeks pemilik yang sama dengan filter PIC — kolom dan filter tidak boleh menyebut dua nama.
  const rows = useMemo(
    () =>
      items.map((item) => {
        const row = normalizeRealtimeRoiRow(item, rate, countryBreakdown);
        return { ...row, pic: picOf ? picOf(row.subDomain, item.pic) : item.pic || "" };
      }),
    [items, rate, countryBreakdown, picOf],
  );
  // Judul kelompok kolom earning dibaca dari `source` barisnya sendiri, bukan ditulis tetap.
  // Sebelumnya ia selalu berbunyi "ADSENSE" padahal seluruh angkanya datang dari laporan Google
  // Ad Manager — dan tidak semua subdomain dimonetisasi lewat AdSense, jadi satu tabel yang
  // mengaku AdSense untuk semuanya menamai salah sumber uang yang sedang dibaca orang.
  const earningSource = useMemo(() => earningSourceLabel(rows), [rows]);
  const columns = useMemo(() => realtimeRoiColumns(earningSource), [earningSource]);

  return (
    <DataTable
      baseClassName="master-roi-table"
      columns={columns}
      getRowId={(item, index) =>
        String(item.id || `${item.campaign}-${item.subDomain}-${item.time}-${index}`)
      }
      items={rows}
      paginate
      paginationLabel="baris"
      wrapClassName="master-roi-table-wrap"
    />
  );
}

/**
 * Kolom tabel. Yang MEMBENTANG dua baris kepala (No, Date, Time, PIC, Campaign, Profit, Sub-Domain,
 * Negara) tidak bisa diurutkan, sama seperti sebelum tabel ini pindah ke DataTable; yang bisa
 * diurutkan adalah kolom di bawah kepala kelompok.
 */
function realtimeRoiColumns(earningSource) {
  const fixed = (column) => ({ ...column, enableSorting: false });
  const sub = (column) => ({
    ...column,
    meta: {
      ...column.meta,
      headerClassName: `master-sub-head ${realtimeRoiColumnTone(column.accessorKey)}`,
    },
  });
  const money = (key, header, renderKey, className) =>
    sub({
      accessorKey: key,
      header,
      cell: ({ getValue }) => renderCell(getValue(), renderKey),
      meta: { className: `master-money-cell ${className}` },
    });
  const moneyByCurrency = (key, header, extra) =>
    sub({
      accessorKey: key,
      header,
      cell: ({ row }) => (
        <>
          <MoneyByCurrency
            value={row.original[key]}
            currency={row.original.currency}
            fxRate={row.original.fxRate}
          />
          {extra?.(row.original)}
        </>
      ),
      meta: { className: "master-money-cell gam" },
    });

  return [
    fixed({
      // Nomor urut tampilan, bukan field DB: nomor yang tersimpan akan melawan pengurutan kolom —
      // klik "ROI" dan urutannya jadi 3, 1, 7. `row.index` adalah posisi di daftar yang SUDAH
      // diurutkan, jadi halaman 3 tidak mulai dari 1 lagi.
      id: "no",
      header: "# NO",
      cell: ({ row }) => row.index + 1,
      meta: { headerClassName: "master-sticky-head", className: "center muted-cell" },
    }),
    fixed({
      accessorKey: "date",
      header: "Date",
      cell: ({ getValue }) => formatDate(getValue()),
      meta: { className: "muted-cell" },
    }),
    // Jam sync-nya, dan tidak ada label kedua di bawahnya. "Berjalan"/"Final" dulu membedakan satu
    // baris hari ini dari baris hari-hari sebelumnya; sejak tabel ini menulis satu baris tiap sync,
    // hampir seluruh isinya berlabel "Berjalan" — sebuah kata yang muncul di tiap baris tidak
    // membedakan apa pun.
    fixed({
      accessorKey: "time",
      header: "Time",
      cell: ({ getValue }) => <strong>{getValue()}</strong>,
      meta: { headerClassName: "master-time-head", className: "master-time-cell" },
    }),
    fixed({ accessorKey: "pic", header: "PIC", cell: ({ getValue }) => getValue() || "-" }),
    fixed({
      accessorKey: "campaign",
      header: "Campaign",
      cell: ({ row }) => (
        <>
          <strong>{row.original.campaign}</strong>
          <MergedCampaignsBadge
            campaigns={row.original.campaigns}
            spend={row.original.metaSpend}
            subDomain={row.original.subDomain}
          />
        </>
      ),
      meta: { className: "master-campaign-cell" },
    }),
    {
      id: "metaAds",
      header: "META ADS",
      meta: { headerClassName: "master-meta-group" },
      columns: [
        // Kolom META ADS kosong punya dua sebab yang sangat berbeda: tidak ada campaign Meta yang
        // mengarah ke subdomain ini (dogtraining.petcins.com — earning GAM tanpa iklan Meta), atau
        // spend-nya gagal diambil sync terakhir. Yang pertama bukan kegagalan; keduanya dulu
        // tampil sama: "Rp 0".
        sub({
          accessorKey: "metaSpend",
          header: "Spending",
          cell: ({ row }) => (
            <>
              {renderCell(row.original.metaSpend, "metaAds")}
              {!row.original.spendingKnown && <MetaSpendNote reason={row.original.metaMissing} />}
            </>
          ),
          meta: { className: "master-money-cell meta" },
        }),
        money("adTax", "Ad Tax", "adTax", "meta"),
        money("totalSpending", "Total Spend", "totalSpending", "meta"),
        money("flukSpend", "Fluk. Spend.", "metaAds", "positive"),
      ],
    },
    {
      // Empat kolom: dua sumber, totalnya, dan fluktuasinya. Judulnya tidak lagi menyebut satu
      // sumber untuk semua baris — itu yang dulu membuat pendapatan Ad Exchange dibaca sebagai
      // pendapatan AdSense.
      id: "earningGroup",
      header: "EARNING",
      meta: { headerClassName: "master-gam-group" },
      columns: [
        // Rincian sumber baris ini. "-" untuk baris yang ditulis sync versi lama: angkanya tidak
        // dipecah waktu itu, dan membaginya sekarang berarti mengarang dari mana uangnya datang.
        moneyByCurrency("gamAds", "GAM"),
        moneyByCurrency("adsenseAds", "AdSense"),
        // "Total", bukan "Earning": kolomnya berdiri di bawah judul kelompok EARNING, tepat di
        // sebelah dua kolom sumbernya (GAM + AdSense) yang dijumlahkannya.
        moneyByCurrency("gamRevenue", "Total", (item) => (
          <>
            {!item.earningKnown && (
              <em
                className="cell-note"
                title="Laporan earning (Google Ad Manager) untuk network ini gagal pada sync terakhir. Rinciannya ada di ikon peringatan pada topbar."
              >
                laporan gagal
              </em>
            )}
            {item.earningKnown && item.gamStale && (
              <em
                className="cell-note"
                title="Angka ini dari sync sebelumnya di hari yang sama — laporan earning (Google Ad Manager) pada sync terakhir gagal."
              >
                belum diperbarui
              </em>
            )}
          </>
        )),
        money("flukEarn", "Fluk. Earn.", "adsense", "positive"),
      ],
    },
    {
      id: "roiGroup",
      header: "ROI (%)",
      meta: { headerClassName: "master-roi-group" },
      columns: [
        sub({
          accessorKey: "roi",
          header: "ROI",
          cell: ({ getValue }) => formatRoiPercent(getValue()),
          meta: {
            className: (item) => `master-roi-cell${item.roi < 0 ? " money-negative" : ""}`,
          },
        }),
        sub({
          accessorKey: "flukRoi",
          header: "Fluk. ROI",
          cell: ({ getValue }) => formatRoiPercent(getValue()),
          meta: {
            className: (item) =>
              `master-roi-fluk-cell${Number(item.flukRoi) < 0 ? " money-negative" : ""}`,
          },
        }),
      ],
    },
    fixed({
      accessorKey: "profit",
      header: "Profit",
      cell: ({ getValue }) => renderCell(getValue(), "profit"),
      meta: { headerClassName: "master-profit-head", className: "master-money-cell positive" },
    }),
    fixed({
      accessorKey: "subDomain",
      header: "Sub-Domain",
      cell: ({ getValue }) => getValue(),
      meta: { headerClassName: "master-domain-head", className: "master-domain-cell" },
    }),
    // Di sebelah Sub-Domain, bukan di dalam kelompok earning: earning-nya memang dari GAM, tapi
    // kolom ini juga membawa spend Meta negara itu — ia rincian barisnya, bukan satu metrik earning
    // lagi.
    fixed({
      id: "negara",
      header: "Negara",
      cell: ({ row }) => (
        <CountryBreakdownBadge rows={row.original.countries} subDomain={row.original.subDomain} />
      ),
      meta: { headerClassName: "master-country-head", className: "master-country-cell" },
    }),
    {
      // Clicks, CPC, dan eCPM ketiganya dihitung dari laporan earning-nya (CPC = earning ÷ klik),
      // jadi keduanya yang pertama dulu berdiri di bawah judul "META M." yang salah — dan CPR, yang
      // memang biaya Meta per hasil, berdiri di bawah "ADS M.".
      id: "earningMetrics",
      header: `${earningSource} M.`,
      meta: { headerClassName: "master-gam-group" },
      columns: [
        sub({
          accessorKey: "clicks",
          header: "Clicks",
          cell: ({ getValue }) => getValue(),
          meta: { className: "center" },
        }),
        money("cpc", "CPC", "cpc", "gam"),
        // Kunci `pageRpm` di kedua tabel — yang membaca kunci barisnya adalah PENGURUTAN kolom.
        money("pageRpm", "eCPM", "ecpm", "gam"),
      ],
    },
    {
      id: "metaMetrics",
      header: "META M.",
      meta: { headerClassName: "master-meta-metrics-group" },
      columns: [
        money("cpr", "CPR", "cpr", "meta"),
        money("metaBalance", "META BAL.", "balance", "meta"),
      ],
    },
  ];
}
