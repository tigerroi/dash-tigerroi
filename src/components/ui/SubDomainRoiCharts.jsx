import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart as RechartsLineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useChartPalette } from "../../hooks/useChartPalette";
import { formatRoiPercent } from "../../lib/adTax";
import { seriesColor } from "../../lib/chartTheme";
import { formatDayMonth } from "../../lib/formatDate";
import { compactRupiah } from "../../lib/money";
import { DataTable } from "./DataTable";
import { EmptyMessage } from "./EmptyMessage";

// Dua grafik detail per subdomain di Overview. Keduanya membaca deret yang sama
// (`subDomainRoiSeries`) dan memakai chip pilihan yang sama, jadi warna sebuah subdomain di kurva
// adalah warna batangnya di grafik perbandingan — satu warna, satu subdomain, di seluruh panel.
//
// Warna diambil per POSISI deret (`series[].key` = s0, s1, …), bukan per nama: nama subdomain
// berubah-ubah, dan warna yang di-hash dari nama menghasilkan dua kurva berdempet yang tidak bisa
// dibedakan.
//
// Enam belas, karena bawaannya menggambar SELURUH subdomain yang lolos filter — bukan delapan
// teratas. Armada yang lebih besar dari itu tetap mengulang dari awal; yang membedakan dua kurva
// sewarna adalah tooltip (yang menyebut namanya, urut ROI) dan chip-nya, bukan warnanya. Yang
// benar-benar menyempitkan grafik adalah filter di kepala tab.
//
// Enam belasnya sendiri tinggal sebagai token `--chart-series-*` di styles.css, bukan sebagai
// daftar di sini: paletnya berganti bersama tema perangkat, dan warna chip (HTML) harus tetap sama
// dengan warna kurvanya (SVG) — lihat src/lib/chartTheme.js.

const formatPercent = (value) => `${value > 0 ? "+" : ""}${Number(value).toFixed(1)}%`;
const formatRupiah = (value) =>
  `Rp ${Math.abs(Number(value) || 0).toLocaleString("id-ID", { maximumFractionDigits: 0 })}`;
// Profit satu-satunya kolom uang di tabel ini yang boleh minus, dan `formatRupiah` membuang
// tandanya (Math.abs) karena warna yang membedakan untung dari rugi. Di sana warna saja tidak
// cukup: "Rp 4jt" merah dan "Rp 4jt" hijau terbaca sama begitu disalin ke laporan.
const formatSignedRupiah = (value) => `${Number(value) < 0 ? "−" : ""}${formatRupiah(value)}`;

// Label sumbu waktu. Tanggalnya ikut disebut hanya saat rentangnya lebih dari sehari — lihat
// `subDomainRoiSeries`.
function stampLabel(point) {
  if (!point) return "";

  return point.multiDay ? `${formatDayMonth(point.date)} ${point.time}`.trim() : point.time;
}

/** Chip pemilih subdomain, dipakai kedua grafik. */
function SubDomainChips({ series, selected, onToggle, chipLabel = "Pilih subdomain:" }) {
  const chart = useChartPalette();

  return (
    <div className="subdomain-chips">
      <span className="subdomain-chips-label">{chipLabel}</span>
      {series.map((item, index) => {
        const active = selected.includes(item.name);
        const color = seriesColor(chart, index);

        return (
          <button
            aria-pressed={active}
            className={active ? "subdomain-chip active" : "subdomain-chip"}
            key={item.name}
            onClick={() => onToggle(item.name)}
            style={active ? { borderColor: color, color } : undefined}
            title={item.name}
            type="button"
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

// `chipLabel` + `emptyMessage` membuat kurva yang sama dipakai "Kurva ROI per Advertiser": bentuk
// titiknya identik (`advertiserRoiSeries`), dan dua komponen grafik untuk satu bentuk data adalah
// dua tooltip yang akan berselisih suatu hari.
export function SubDomainRoiCurveChart({
  series,
  points,
  selected,
  onToggle,
  chipLabel,
  emptyMessage = "Belum ada subdomain yang dipilih — nyalakan chip di atas, atau pilih satu advertiser di filter grafik untuk menggambar seluruh subdomain miliknya.",
}) {
  const chart = useChartPalette();
  const visible = series.filter((item) => selected.includes(item.name));
  const colorOf = (item) => seriesColor(chart, series.indexOf(item));

  return (
    <div className="line-chart-card">
      <SubDomainChips
        chipLabel={chipLabel}
        onToggle={onToggle}
        selected={selected}
        series={series}
      />

      {visible.length === 0 ? (
        <EmptyMessage>{emptyMessage}</EmptyMessage>
      ) : (
        <>
          <div className="line-chart-wrap">
            <ResponsiveContainer width="100%" height={280}>
              <RechartsLineChart
                data={points}
                margin={{ top: 18, right: 24, bottom: 10, left: 12 }}
              >
                <CartesianGrid stroke={chart.grid} strokeDasharray="4 4" vertical={false} />
                <XAxis
                  axisLine={false}
                  dataKey="stamp"
                  tick={{ fill: chart.axis, fontSize: 12 }}
                  tickFormatter={(stamp) =>
                    stampLabel(points.find((point) => point.stamp === stamp))
                  }
                  tickLine={false}
                />
                <YAxis
                  axisLine={false}
                  tick={{ fill: chart.axis, fontSize: 12 }}
                  tickFormatter={(value) => `${value > 0 ? "+" : ""}${value.toFixed(0)}%`}
                  tickLine={false}
                  width={64}
                />
                <Tooltip
                  content={<CurveTooltip series={visible} colorOf={colorOf} />}
                  cursor={{ stroke: chart.axis, strokeDasharray: "4 4" }}
                />
                {visible.map((item) => (
                  <Line
                    activeDot={{
                      r: 5,
                      fill: chart.dotFill,
                      stroke: chart.dotStroke,
                      strokeWidth: 2,
                    }}
                    connectNulls={false}
                    dataKey={item.key}
                    dot={{ r: 2.5, fill: chart.dotFill, stroke: chart.dotStroke, strokeWidth: 1.5 }}
                    key={item.key}
                    name={item.label}
                    stroke={colorOf(item)}
                    strokeWidth={2.5}
                    type="monotone"
                  />
                ))}
              </RechartsLineChart>
            </ResponsiveContainer>
          </div>

          <div className="chart-legend">
            {visible.map((item) => (
              <span key={item.key} title={item.name}>
                <i className="legend-dot" style={{ background: colorOf(item) }} /> {item.label}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function CurveTooltip({ active, payload, series, colorOf }) {
  if (!active || !payload?.length) {
    return null;
  }

  const point = payload[0].payload;
  const rows = series
    .map((item) => ({ item, roi: point[item.key], spend: point[`${item.key}__spend`] }))
    .filter((row) => row.roi !== null && row.roi !== undefined && row.roi !== "")
    .sort((a, b) => Number(b.roi) - Number(a.roi));

  return (
    <div className="recharts-tooltip-card">
      <strong>{stampLabel(point)}</strong>
      {rows.map((row) => (
        <span key={row.item.key} style={{ color: colorOf(row.item) }}>
          {/* Spend ikut disebut: ROI yang meledak selalu bisa dibaca sebagai penyebut yang
              nyaris nol, bukan angka yang berdiri sendiri — sama alasannya dengan tooltip
              Kurva ROI di atasnya. */}
          {row.item.label}: {formatPercent(row.roi)} · {formatRupiah(row.spend)}
        </span>
      ))}
    </div>
  );
}

export function SubDomainRoiSpendChart({ bars, series, selected }) {
  const chart = useChartPalette();
  const colorByName = new Map(series.map((item, index) => [item.name, seriesColor(chart, index)]));
  const visible = bars.filter((item) => selected.includes(item.name));

  if (visible.length === 0) {
    return (
      <EmptyMessage>
        Belum ada subdomain yang dipilih — nyalakan chip di grafik di atas, atau pilih satu
        advertiser di filter grafik.
      </EmptyMessage>
    );
  }

  return (
    <div className="line-chart-card">
      <div className="line-chart-wrap">
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={visible} margin={{ top: 18, right: 12, bottom: 10, left: 12 }}>
            <CartesianGrid stroke={chart.grid} strokeDasharray="4 4" vertical={false} />
            <XAxis
              axisLine={false}
              dataKey="label"
              tick={{ fill: chart.axis, fontSize: 12 }}
              tickLine={false}
            />
            {/* Dua sumbu, karena dua satuan: persen di kiri, rupiah di kanan. Satu sumbu untuk
                keduanya akan menggambar batang spend setinggi ROI-nya — dua angka yang tidak
                pernah sebanding. */}
            <YAxis
              axisLine={false}
              tick={{ fill: chart.axis, fontSize: 12 }}
              tickFormatter={(value) => `${value > 0 ? "+" : ""}${value.toFixed(0)}%`}
              tickLine={false}
              width={64}
              yAxisId="roi"
            />
            <YAxis
              axisLine={false}
              orientation="right"
              tick={{ fill: chart.axis, fontSize: 12 }}
              tickFormatter={compactRupiah}
              tickLine={false}
              width={80}
              yAxisId="spend"
            />
            <Tooltip
              content={<SpendTooltip colorByName={colorByName} />}
              cursor={{ fill: chart.barCursor }}
            />
            <Bar dataKey="roi" name="ROI" radius={[4, 4, 0, 0]} yAxisId="roi">
              {visible.map((item) => (
                <Cell fill={colorByName.get(item.name)} key={item.name} />
              ))}
            </Bar>
            {/* Batang kedua memakai warna subdomain yang sama, diredupkan: yang dibandingkan mata
                adalah dua batang berdampingan milik SATU subdomain, dan warna kedua yang berdiri
                sendiri akan terbaca sebagai subdomain lain. */}
            <Bar dataKey="totalSpend" name="Total Spend" radius={[4, 4, 0, 0]} yAxisId="spend">
              {visible.map((item) => (
                <Cell fill={colorByName.get(item.name)} fillOpacity={0.42} key={item.name} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="chart-legend">
        <span>
          <i className="legend-dot" style={{ background: chart.axis }} /> Batang penuh: ROI (%)
        </span>
        <span>
          <i className="legend-dot" style={{ background: chart.axis, opacity: 0.42 }} /> Batang
          redup: Total Spend (Rp, sumbu kanan)
        </span>
      </div>
    </div>
  );
}

// Kolom bisa diurutkan, sepola dengan tabel lain (klik: naik → turun → urutan awal). Nilai mentahnya
// angka, jadi `sortTableItems` (lewat DataTable) mengurutnya numerik — bukan sebagai teks "Rp 1.000".
const moneyToneClass = (value) => (Number(value) < 0 ? "money-negative" : "money-positive");

const ROI_TABLE_COLUMNS = [
  // Nama PENUH, bukan `label` yang dipakai chip dan sumbu grafik. Yang dipendekkan di sana
  // dipendekkan karena delapan nama panjang tidak muat berdampingan di satu baris legenda; di
  // tabel, kolomnya berdiri sendiri dan yang hilang justru pembedanya — "coverage" dan "fitnes"
  // milik dua domain berbeda berdiri sebagai dua baris yang tidak menyebutkan domainnya. Kunci
  // urutnya ikut berpindah: kolom yang menggambar satu nilai dan mengurut dengan nilai lain
  // menghasilkan urutan yang tidak bisa dibaca dari layar.
  {
    accessorKey: "name",
    header: "Sub-Domain",
    cell: ({ getValue }) => <strong>{getValue()}</strong>,
  },
  // PIC lewat `picOf` (baris dulu, `subDomains.pic` sebagai tambalan) — aturan yang sama dengan
  // filter Advertiser di kepala tab, jadi baris yang lolos filter itu selalu menyebut nama yang sama.
  {
    accessorKey: "advertiser",
    header: "Advertiser",
    cell: ({ getValue }) => getValue() || "-",
  },
  {
    accessorKey: "totalSpend",
    header: "Total Spend",
    cell: ({ getValue }) => formatRupiah(getValue()),
  },
  {
    accessorKey: "earning",
    header: "Pendapatan",
    cell: ({ getValue }) => formatRupiah(getValue()),
  },
  {
    accessorKey: "profit",
    header: "Profit",
    cell: ({ getValue }) => formatSignedRupiah(getValue()),
    meta: { className: (item) => moneyToneClass(item.profit) },
  },
  {
    accessorKey: "roi",
    header: "ROI",
    cell: ({ getValue }) => <strong>{formatRoiPercent(getValue())}</strong>,
    meta: { className: (item) => moneyToneClass(item.roi) },
  },
];

const PROFIT_FIRST = { key: "profit", direction: "desc" };

// Tabel perbandingan antar subdomain: angka batang yang sama (`bars` — sync terakhir tiap subdomain).
// Melengkapi grafik batang di atasnya, yang butuh chip dipilih; tabel ini selalu memuat seluruh
// subdomain yang lolos filter tab pada periode itu, diurutkan profit tertinggi dulu sampai kolom
// lain diklik — bukan ROI: persentase teratas hampir selalu milik subdomain yang belanjanya paling
// kecil, sementara yang dicari orang di kepala tabel adalah yang paling banyak menghasilkan uang.
export function SubDomainRoiTable({ bars }) {
  if (!bars?.length) return null;

  return (
    <div style={{ marginTop: "1.5rem" }}>
      <DataTable
        columns={ROI_TABLE_COLUMNS}
        defaultSort={PROFIT_FIRST}
        getRowId={(item) => String(item.name)}
        items={bars}
      />
    </div>
  );
}

function SpendTooltip({ active, payload, colorByName }) {
  if (!active || !payload?.length) {
    return null;
  }

  const row = payload[0].payload;

  return (
    <div className="recharts-tooltip-card">
      <strong style={{ color: colorByName.get(row.name) }}>{row.name}</strong>
      <span className="chart-tooltip-roi">ROI: {formatPercent(row.roi)}</span>
      <span className="chart-tooltip-spend">
        Total Spend (+ ad tax): {formatRupiah(row.totalSpend)}
      </span>
      <span className="chart-tooltip-revenue">Earning: {formatRupiah(row.earning)}</span>
    </div>
  );
}
