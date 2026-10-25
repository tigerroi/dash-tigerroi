import {
  Area,
  CartesianGrid,
  Line,
  LineChart as RechartsLineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useChartPalette } from "../../hooks/useChartPalette";
import { MIN_ROI_SPEND } from "../../lib/adTax";
import { formatDate, formatDayMonth } from "../../lib/formatDate";

const formatShortRupiah = (value) => {
  if (value >= 1_000_000) {
    return `Rp ${(value / 1_000_000).toFixed(0)}jt`;
  }

  return `Rp ${(value / 1_000).toFixed(0)}rb`;
};

const formatRupiah = (value) =>
  `Rp ${Math.abs(value).toLocaleString("id-ID", { maximumFractionDigits: 0 })}`;
// Profit adalah satu-satunya angka di kartu ini yang bisa negatif, dan `formatRupiah` membuang
// tandanya (Math.abs) supaya warna yang membedakan untung dari rugi. Untuk profit warna saja tidak
// cukup: "Rp 4jt" merah dan "Rp 4jt" hijau adalah dua angka yang terbaca sama saat dibacakan atau
// disalin ke laporan.
const formatSignedRupiah = (value) => `${value < 0 ? "−" : ""}${formatRupiah(value)}`;
// Null-safe: titik yang belanjanya di bawah lantai tidak punya ROI untuk ditulis.
const formatPercent = (value) =>
  Number.isFinite(value) ? `${value > 0 ? "+" : ""}${value.toFixed(1)}%` : "-";

/**
 * ROI sebuah titik grafik. Lantai belanjanya SAMA dengan `roiPercent` di lib/adTax.js — yang
 * dibedakan cuma bentuk "tidak ada nilainya": `null`, bukan `""`, karena inilah yang diberikan ke
 * Recharts dan `null` yang membuatnya memutus garis alih-alih menggambar NaN di sumbu nol.
 *
 * Tanpa lantai itu, satu hari yang membelanjakan Rp 43 menjadi titik +355.456% — dan seluruh kurva
 * bulan lainnya tertekan jadi garis datar di dasar grafik oleh satu titik yang tidak berarti apa
 * pun.
 */
export function getNetPercentage(revenue, spend) {
  if (!(spend >= MIN_ROI_SPEND)) {
    return null;
  }

  return ((revenue - spend) / spend) * 100;
}

/**
 * Titik hari berjalan digambar putus-putus, bukan disembunyikan dan bukan disamakan.
 *
 * Sync menulis titik hari ini (`partial: true`) supaya grafiknya tidak berhenti di kemarin, tapi
 * revenue GAM-nya belum dikonsolidasi dan spend-nya masih naik sampai tengah malam. Sebuah garis
 * utuh yang berakhir di titik itu terbaca sebagai margin yang jatuh — persis kesimpulan yang salah.
 *
 * Caranya dua deret per garis: yang bersambung berhenti di titik final terakhir, yang putus-putus
 * mulai dari titik final terakhir itu (supaya garisnya menyambung, bukan mengambang) lalu meneruskan
 * ke titik-titik yang belum selesai. Angka aslinya tetap utuh di barisnya untuk tooltip dan total.
 */
function withPartialSeries(data) {
  const firstPartial = data.findIndex((item) => item?.partial === true);

  return data.map((item, index) => {
    const partial = item?.partial === true;
    // Titik final terakhir sebelum hari berjalan ikut deret putus-putus sebagai titik sambungnya.
    const isJoint = firstPartial > 0 && index === firstPartial - 1;
    const dashed = partial || isJoint;

    // Selisih dua garis di atasnya, bukan angka ketiga dari sumber lain: `totalSpend` di sini
    // sudah termasuk ad tax (lihat `chartPoint`), jadi profit ini sama persis dengan kolom Profit
    // di tabel ROI.
    const profit = item.grossRevenue - item.totalSpend;

    return {
      ...item,
      netPercentage: getNetPercentage(item.grossRevenue, item.totalSpend),
      profit,
      revenueSolid: partial ? null : item.grossRevenue,
      spendSolid: partial ? null : item.totalSpend,
      profitSolid: partial ? null : profit,
      revenueDashed: dashed ? item.grossRevenue : null,
      spendDashed: dashed ? item.totalSpend : null,
      profitDashed: dashed ? profit : null,
    };
  });
}

// Sumbu waktu "Hari Ini": tiap titik satu sync, labelnya jam saja ("15:06").
const formatStampTime = (stamp) => String(stamp).slice(11);

export function LineChart({ data, hourly = false }) {
  const chart = useChartPalette();
  const chartData = withPartialSeries(data);
  const hasPartial = data.some((item) => item?.partial === true);
  // Titik per jam KUMULATIF sejak tengah malam, jadi "total hari ini" adalah titik TERAKHIR —
  // menjumlahkan seluruh titik akan melipatgandakan pendapatan hari yang sama.
  const last = data[data.length - 1] || {};
  const totalRevenue = hourly
    ? last.grossRevenue || 0
    : data.reduce((sum, item) => sum + item.grossRevenue, 0);
  const totalSpend = hourly
    ? last.totalSpend || 0
    : data.reduce((sum, item) => sum + item.totalSpend, 0);
  const netProfit = totalRevenue - totalSpend;
  const netPercentage = getNetPercentage(totalRevenue, totalSpend);
  // Garis nol hanya digambar kalau ada hari yang rugi. Selama semuanya untung, sumbu Y berhenti di
  // 0 dan garis itu menimpa sumbunya sendiri — satu garis yang tidak menerangkan apa pun.
  const hasLoss = chartData.some((item) => item.profit < 0);

  return (
    <div className="line-chart-card">
      <div className="chart-summary-grid">
        <ChartMetric label="Pendapatan" value={formatRupiah(totalRevenue)} tone="positive" />
        {/* Sudah termasuk ad tax — sama dengan kolom Total Spend di tabel ROI, jadi "Netto" di
            sebelahnya adalah ROI yang sama persis. */}
        <ChartMetric
          label="Pengeluaran (+ ad tax)"
          value={formatRupiah(totalSpend)}
          tone="negative"
        />
        <ChartMetric
          label="Profit"
          value={formatSignedRupiah(netProfit)}
          tone={netProfit >= 0 ? "positive" : "negative"}
        />
        <ChartMetric
          label="Netto"
          value={formatPercent(netPercentage)}
          tone={netProfit >= 0 ? "positive" : "negative"}
        />
      </div>

      <div className="line-chart-wrap">
        <ResponsiveContainer width="100%" height={240}>
          <RechartsLineChart data={chartData} margin={{ top: 18, right: 24, bottom: 10, left: 12 }}>
            <defs>
              <linearGradient id="revenueFill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={chart.revenue} stopOpacity={0.18} />
                <stop offset="100%" stopColor={chart.revenue} stopOpacity={0} />
              </linearGradient>
              <linearGradient id="spendFill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={chart.spend} stopOpacity={0.14} />
                <stop offset="100%" stopColor={chart.spend} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={chart.grid} strokeDasharray="4 4" vertical={false} />
            {/* Diformat dari `date` (ISO), bukan dari `period` yang ditulis backend: satu format
                tanggal untuk seluruh dashboard, dan sumbu tidak boleh jadi pengecualiannya. */}
            <XAxis
              dataKey={hourly ? "stamp" : "date"}
              tickFormatter={hourly ? formatStampTime : formatDayMonth}
              axisLine={false}
              tickLine={false}
              tick={{ fill: chart.axis, fontSize: 12 }}
            />
            <YAxis
              axisLine={false}
              tickFormatter={formatShortRupiah}
              tickLine={false}
              tick={{ fill: chart.axis, fontSize: 12 }}
              width={66}
            />
            <Tooltip
              content={<ChartTooltip hourly={hourly} />}
              cursor={{ stroke: chart.axis, strokeDasharray: "4 4" }}
            />
            {/* Batas untung/rugi. Tanpa ini, garis profit yang menukik ke bawah nol tidak punya
                penanda di mana ruginya dimulai — sumbu Y-nya sudah tidak berhenti di nol. */}
            {hasLoss && <ReferenceLine y={0} stroke={chart.zeroLine} strokeWidth={1} />}
            <Area dataKey="grossRevenue" fill="url(#revenueFill)" stroke="none" type="monotone" />
            <Area dataKey="totalSpend" fill="url(#spendFill)" stroke="none" type="monotone" />
            <Line
              activeDot={{ r: 6, fill: chart.dotFill, stroke: chart.dotStroke, strokeWidth: 3 }}
              dataKey="revenueSolid"
              dot={{ r: 3, fill: chart.dotFill, stroke: chart.dotStroke, strokeWidth: 2 }}
              name="Pendapatan"
              stroke={chart.revenue}
              strokeWidth={3}
              type="monotone"
            />
            <Line
              activeDot={{ r: 6, fill: chart.dotFill, stroke: chart.dotStroke, strokeWidth: 3 }}
              dataKey="spendSolid"
              dot={{ r: 3, fill: chart.dotFill, stroke: chart.dotStroke, strokeWidth: 2 }}
              name="Pengeluaran"
              stroke={chart.spend}
              strokeWidth={3}
              type="monotone"
            />
            {/* Profit tidak diberi Area seperti dua garis di atasnya: area yang isiannya menembus
                garis nol menggelapkan wilayah rugi persis seperti wilayah untung. Yang dibaca dari
                garis ini adalah tandanya, dan isian menghapus tanda itu. */}
            <Line
              activeDot={{ r: 6, fill: chart.dotFill, stroke: chart.dotStroke, strokeWidth: 3 }}
              dataKey="profitSolid"
              dot={{ r: 3, fill: chart.dotFill, stroke: chart.dotStroke, strokeWidth: 2 }}
              name="Profit"
              stroke={chart.profit}
              strokeWidth={3}
              type="monotone"
            />
            {/* Ruas hari berjalan. `connectNulls` dibiarkan mati: kalau tidak, deret ini akan
                menarik garis lurus dari titik pertama ke ruas terakhir dan melintasi seluruh grafik
                dengan garis yang tidak berarti apa pun. */}
            <Line
              activeDot={{ r: 6, fill: chart.dotFill, stroke: chart.dotStroke, strokeWidth: 3 }}
              dataKey="revenueDashed"
              dot={{ r: 3, fill: chart.dotFill, stroke: chart.dotStroke, strokeWidth: 2 }}
              legendType="none"
              name="Pendapatan (hari berjalan)"
              stroke={chart.revenue}
              strokeDasharray="5 4"
              strokeWidth={3}
              type="monotone"
            />
            <Line
              activeDot={{ r: 6, fill: chart.dotFill, stroke: chart.dotStroke, strokeWidth: 3 }}
              dataKey="spendDashed"
              dot={{ r: 3, fill: chart.dotFill, stroke: chart.dotStroke, strokeWidth: 2 }}
              legendType="none"
              name="Pengeluaran (hari berjalan)"
              stroke={chart.spend}
              strokeDasharray="5 4"
              strokeWidth={3}
              type="monotone"
            />
            <Line
              activeDot={{ r: 6, fill: chart.dotFill, stroke: chart.dotStroke, strokeWidth: 3 }}
              dataKey="profitDashed"
              dot={{ r: 3, fill: chart.dotFill, stroke: chart.dotStroke, strokeWidth: 2 }}
              legendType="none"
              name="Profit (hari berjalan)"
              stroke={chart.profit}
              strokeDasharray="5 4"
              strokeWidth={3}
              type="monotone"
            />
          </RechartsLineChart>
        </ResponsiveContainer>
      </div>

      <div className="chart-legend">
        <span>
          <i className="legend-dot revenue" /> Pendapatan
        </span>
        <span>
          <i className="legend-dot spend" /> Pengeluaran
        </span>
        <span>
          <i className="legend-dot profit" /> Profit
        </span>
        {hasPartial && (
          <span className="legend-running">
            <i className="legend-dash" /> Hari berjalan — belum selesai, ikut terhitung di ringkasan
            di atas
          </span>
        )}
      </div>
    </div>
  );
}

function ChartTooltip({ active, payload, label, hourly = false }) {
  if (!active || !payload?.length) {
    return null;
  }

  const row = payload[0].payload;

  return (
    <div className="recharts-tooltip-card">
      {/* Tooltip punya ruang, jadi tahunnya ikut disebut — sumbu yang sempit tidak. Saat "Hari Ini",
          label-nya stempel per sync; yang berarti di situ jamnya, bukan tanggalnya. */}
      <strong>{hourly ? formatStampTime(label) : formatDate(label)}</strong>
      {row.partial && <span className="chart-tooltip-running">Hari berjalan, belum selesai</span>}
      <span className="chart-tooltip-revenue">Pendapatan: {formatRupiah(row.grossRevenue)}</span>
      <span className="chart-tooltip-spend">
        Pengeluaran (+ ad tax): {formatRupiah(row.totalSpend)}
      </span>
      <span className="chart-tooltip-profit">Profit: {formatSignedRupiah(row.profit)}</span>
      {/* Netto tidak punya garis di grafik ini — ia dapat biru karena angka yang sama persis
          digambar sebagai garis biru di panel "Kurva ROI (%)" tepat di bawahnya. */}
      <span className="chart-tooltip-roi">Netto: {formatPercent(row.netPercentage)}</span>
    </div>
  );
}

function ChartMetric({ label, value, tone }) {
  return (
    <div className={`chart-metric ${tone}`}>
      <span>{label}</span>
      <strong className={tone === "positive" ? "money-positive" : "money-negative"}>{value}</strong>
    </div>
  );
}
