import {
  CartesianGrid,
  Line,
  LineChart as RechartsLineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useChartPalette } from "../../hooks/useChartPalette";
import { formatDate, formatDayMonth } from "../../lib/formatDate";
import { getNetPercentage } from "./LineChart";

// Netto = ROI: sama rumus, sama sumber (grossRevenue vs totalSpend yang sudah termasuk ad tax) dengan
// kartu "Pendapatan vs Pengeluaran". Diambil dari sana supaya tidak ada rumus ROI kedua.
// Null-safe, sepola dengan LineChart: titik yang belanjanya di bawah lantai (`MIN_ROI_SPEND`)
// tidak punya ROI, dan kurvanya memutus di situ alih-alih melompat ke angka enam digit.
const formatPercent = (value) =>
  Number.isFinite(value) ? `${value > 0 ? "+" : ""}${value.toFixed(1)}%` : "-";
const formatRupiah = (value) =>
  `Rp ${Math.abs(value).toLocaleString("id-ID", { maximumFractionDigits: 0 })}`;

// Titik hari berjalan digambar putus-putus, persis LineChart: ROI paruh-hari yang belum selesai tidak
// boleh terbaca sebagai kurva yang jatuh.
function withRoiSeries(data) {
  const firstPartial = data.findIndex((item) => item?.partial === true);

  return data.map((item, index) => {
    const partial = item?.partial === true;
    const isJoint = firstPartial > 0 && index === firstPartial - 1;
    const dashed = partial || isJoint;
    const roi = getNetPercentage(item.grossRevenue, item.totalSpend);

    return {
      ...item,
      roi,
      roiSolid: partial ? null : roi,
      roiDashed: dashed ? roi : null,
    };
  });
}

// Sumbu waktu "Hari Ini": titik per sync, labelnya jam saja.
const formatStampTime = (stamp) => String(stamp).slice(11);

export function RoiCurveChart({ data, hourly = false }) {
  const chart = useChartPalette();
  const chartData = withRoiSeries(data);
  const hasPartial = data.some((item) => item?.partial === true);

  return (
    <div className="line-chart-card">
      <div className="line-chart-wrap">
        <ResponsiveContainer width="100%" height={240}>
          <RechartsLineChart data={chartData} margin={{ top: 18, right: 24, bottom: 10, left: 12 }}>
            <CartesianGrid stroke={chart.grid} strokeDasharray="4 4" vertical={false} />
            <XAxis
              dataKey={hourly ? "stamp" : "date"}
              tickFormatter={hourly ? formatStampTime : formatDayMonth}
              axisLine={false}
              tickLine={false}
              tick={{ fill: chart.axis, fontSize: 12 }}
            />
            <YAxis
              axisLine={false}
              tickFormatter={(value) => `${value.toFixed(0)}%`}
              tickLine={false}
              tick={{ fill: chart.axis, fontSize: 12 }}
              width={56}
            />
            <Tooltip
              content={<RoiTooltip hourly={hourly} />}
              cursor={{ stroke: chart.axis, strokeDasharray: "4 4" }}
            />
            <Line
              activeDot={{ r: 6, fill: chart.dotFill, stroke: chart.dotStroke, strokeWidth: 3 }}
              dataKey="roiSolid"
              dot={{ r: 3, fill: chart.dotFill, stroke: chart.dotStroke, strokeWidth: 2 }}
              name="ROI"
              stroke={chart.roi}
              strokeWidth={3}
              type="monotone"
            />
            {/* Ruas hari berjalan — connectNulls mati, sama alasannya dengan LineChart. */}
            <Line
              activeDot={{ r: 6, fill: chart.dotFill, stroke: chart.dotStroke, strokeWidth: 3 }}
              dataKey="roiDashed"
              dot={{ r: 3, fill: chart.dotFill, stroke: chart.dotStroke, strokeWidth: 2 }}
              legendType="none"
              name="ROI (hari berjalan)"
              stroke={chart.roi}
              strokeDasharray="5 4"
              strokeWidth={3}
              type="monotone"
            />
          </RechartsLineChart>
        </ResponsiveContainer>
      </div>

      <div className="chart-legend">
        <span>
          <i className="legend-dot roi" /> ROI (Netto)
        </span>
        {hasPartial && (
          <span className="legend-running">
            <i className="legend-dash" /> Hari berjalan — belum selesai
          </span>
        )}
      </div>
    </div>
  );
}

function RoiTooltip({ active, payload, label, hourly = false }) {
  if (!active || !payload?.length) {
    return null;
  }

  const row = payload[0].payload;

  return (
    <div className="recharts-tooltip-card">
      <strong>{hourly ? formatStampTime(label) : formatDate(label)}</strong>
      {row.partial && <span className="chart-tooltip-running">Hari berjalan, belum selesai</span>}
      {/* GAM masuk & spend ikut tampil: ROI yang meledak (mis. spend Rp 41, GAM Rp 153rb → 355.000%)
          langsung terbaca sebagai penyebut yang nyaris nol, bukan angka yang berdiri sendiri. */}
      <span className="chart-tooltip-revenue">GAM masuk: {formatRupiah(row.grossRevenue)}</span>
      <span className="chart-tooltip-spend">
        Pengeluaran (+ ad tax): {formatRupiah(row.totalSpend)}
      </span>
      <span className="chart-tooltip-roi">ROI: {formatPercent(row.roi)}</span>
    </div>
  );
}
