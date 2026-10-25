import { useCallback, useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  LineChart as RechartsLineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useChartPalette } from "../hooks/useChartPalette";
import { useFillRate } from "../hooks/useFillRate";
import { useUrlRange, useUrlState } from "../hooks/useUrlState";
import { seriesColor } from "../lib/chartTheme";
import {
  boundedRange,
  dashedSplit,
  fillRateOwners,
  fillRateRows,
  fillRateSeries,
  formatRate,
  siteTotals,
  slotLabel,
  wibTodayRange,
} from "../lib/fillRate";
import { formatDateTime } from "../lib/formatDate";
import { filterRowsByOwner, ownerChoices, subDomainOwnerIndex } from "../lib/subDomainOwners";
import { DataTable } from "./ui/DataTable";
import { DateRangePicker } from "./ui/DateRangePicker";
import { EmptyMessage } from "./ui/EmptyMessage";
import { FilterDialog } from "./ui/FilterDialog";
import { OwnerFilterFields } from "./ui/OwnerFilterFields";

const count = (value) => Number(value || 0).toLocaleString("id-ID");
const REQ_LABEL = "Total permintaan Ad Exchange";
const IMP_LABEL = "Tayangan Iklan Ad Exchange";
const RATE_LABEL = "Rasio penayangan Ad Exchange";
const MARGIN = { top: 18, right: 24, bottom: 10, left: 12 };

const TABLE_COLUMNS = [
  {
    accessorKey: "subDomain",
    header: "Situs",
    cell: ({ row }) => (
      <>
        {row.original.subDomain}
        {row.original.unregistered && (
          <small className="cell-note muted">belum terdaftar di Sub Domains</small>
        )}
      </>
    ),
  },
  ["pic", "PIC"],
  {
    accessorKey: "req",
    header: REQ_LABEL,
    cell: ({ getValue }) => count(getValue()),
    meta: { align: "right" },
  },
  {
    accessorKey: "imp",
    header: IMP_LABEL,
    cell: ({ getValue }) => count(getValue()),
    meta: { align: "right" },
  },
  {
    accessorKey: "rate",
    header: RATE_LABEL,
    cell: ({ getValue }) => formatRate(getValue()),
    meta: { align: "right" },
  },
];
const REQ_FIRST = { key: "req", direction: "desc" };

/**
 * Tab "Rasio Penayangan" di Overview: Total permintaan, Tayangan, dan Rasio penayangan Ad Exchange
 * per jam WIB — nama kolom yang sama persis dengan Laporan interaktif Ad Manager, supaya bisa diadu
 * langsung. Bukan "Total rasio pengisian": `AD_REQUESTS` ditolak GAM bersama dimensi HOUR.
 */
export function FillRate({ store }) {
  const chart = useChartPalette();
  const [range, setRange] = useUrlRange("periode", wibTodayRange);
  const span = boundedRange(range);
  const { loading, error, tree, status } = useFillRate(span);
  const [advertiser, setAdvertiser] = useUrlState("advertiser", "");
  const [domain, setDomain] = useUrlState("domain", "");
  const [subDomain, setSubDomain] = useUrlState("subdomain", "");

  const owners = useMemo(
    () => fillRateOwners(subDomainOwnerIndex(store.subDomains, store.domains)),
    [store.subDomains, store.domains],
  );
  const rows = useMemo(() => fillRateRows(tree), [tree]);
  const choices = useMemo(
    () => ownerChoices(rows, owners, { advertiser, domain }),
    [rows, owners, advertiser, domain],
  );
  const changeAdvertiser = useCallback(
    (next) => {
      setAdvertiser(next);
      if (domain && !ownerChoices(rows, owners, { advertiser: next }).domains.includes(domain)) {
        setDomain("");
      }
    },
    [rows, owners, domain, setAdvertiser, setDomain],
  );
  const visible = useMemo(
    () => filterRowsByOwner(rows, owners, { advertiser, domain, subDomain }),
    [rows, owners, advertiser, domain, subDomain],
  );
  const level = domain || subDomain ? "subDomain" : "domain";
  const { series, points } = useMemo(
    () => fillRateSeries(visible, owners, level),
    [visible, owners, level],
  );
  const registered = useMemo(
    () =>
      new Set(
        (store.subDomains || [])
          .map((sub) =>
            String(sub?.name || "")
              .trim()
              .toLowerCase(),
          )
          .filter(Boolean),
      ),
    [store.subDomains],
  );
  const sites = useMemo(
    () => siteTotals(visible, owners, registered),
    [visible, owners, registered],
  );

  const multiDay = span.from !== span.to;
  const label = (point) => slotLabel(point, multiDay);
  const rateKeys = series.map((item) => `${item.id}Rate`);
  const rateData = dashedSplit(points, [...rateKeys, "totalRate"]).map((point) => ({
    ...point,
    label: label(point),
  }));
  const hasPartial = points.some((point) => point.partial);
  const filterCount = (advertiser ? 1 : 0) + (domain ? 1 : 0) + (subDomain ? 1 : 0);

  return (
    <>
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Rasio Penayangan Ad Exchange per Jam</h2>
            <StatusLine status={status} />
          </div>
          <div className="header-actions">
            <DateRangePicker
              align="right"
              label="Periode Rasio Penayangan"
              onChange={setRange}
              // ponytail: yang digambar rentang TERJEPIT, bukan "Semua tanggal" — yang diunduh
              // memang cuma 31 hari (boundedRange), dan label yang menjanjikan lebih berbohong.
              value={span}
            />
            <FilterDialog
              activeCount={filterCount}
              description="Menyaring ketiga grafik dan tabel di tab ini."
              onReset={() => {
                setAdvertiser("");
                setDomain("");
                setSubDomain("");
              }}
              title="Filter Rasio Penayangan"
            >
              <OwnerFilterFields
                advertiser={advertiser}
                advertiserOptions={choices.advertisers}
                domain={domain}
                domainOptions={choices.domains}
                onAdvertiser={changeAdvertiser}
                onDomain={setDomain}
                onSubDomain={setSubDomain}
                subDomain={subDomain}
                subDomainOptions={choices.subDomains}
              />
            </FilterDialog>
          </div>
        </div>
        {error ? (
          <EmptyMessage>Gagal membaca data: {error}</EmptyMessage>
        ) : loading ? (
          <EmptyMessage>Memuat...</EmptyMessage>
        ) : points.length === 0 ? (
          <EmptyMessage>Belum ada data pada periode ini.</EmptyMessage>
        ) : (
          <div className="line-chart-card">
            <h3>{RATE_LABEL}</h3>
            <div className="line-chart-wrap">
              <ResponsiveContainer width="100%" height={260}>
                <RechartsLineChart data={rateData} margin={MARGIN}>
                  <CartesianGrid stroke={chart.grid} strokeDasharray="4 4" vertical={false} />
                  <XAxis
                    dataKey="label"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: chart.axis, fontSize: 12 }}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: chart.axis, fontSize: 12 }}
                    tickFormatter={(v) => `${v.toFixed(0)}%`}
                    width={48}
                  />
                  <Tooltip
                    content={<SlotTooltip series={series} />}
                    cursor={{ stroke: chart.axis, strokeDasharray: "4 4" }}
                  />
                  {series.flatMap((item, index) => [
                    <Line
                      key={`${item.id}s`}
                      dataKey={`${item.id}RateSolid`}
                      name={item.label}
                      stroke={seriesColor(chart, index)}
                      strokeWidth={2}
                      dot={false}
                      type="monotone"
                      isAnimationActive={false}
                    />,
                    <Line
                      key={`${item.id}d`}
                      dataKey={`${item.id}RateDashed`}
                      legendType="none"
                      name={`${item.label} (belum lengkap)`}
                      stroke={seriesColor(chart, index)}
                      strokeDasharray="5 4"
                      strokeWidth={2}
                      dot={false}
                      type="monotone"
                      isAnimationActive={false}
                    />,
                  ])}
                </RechartsLineChart>
              </ResponsiveContainer>
            </div>
            <SeriesLegend chart={chart} series={series} hasPartial={hasPartial} />

            <h3>{REQ_LABEL}</h3>
            <div className="line-chart-wrap">
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={rateData} margin={MARGIN}>
                  <CartesianGrid stroke={chart.grid} strokeDasharray="4 4" vertical={false} />
                  <XAxis
                    dataKey="label"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: chart.axis, fontSize: 12 }}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: chart.axis, fontSize: 12 }}
                    tickFormatter={count}
                    width={72}
                  />
                  <Tooltip
                    content={<SlotTooltip series={series} />}
                    cursor={{ fill: chart.barCursor }}
                  />
                  {series.map((item, index) => (
                    <Bar
                      key={item.id}
                      dataKey={`${item.id}Req`}
                      name={item.label}
                      stackId="req"
                      fill={seriesColor(chart, index)}
                      isAnimationActive={false}
                    >
                      {rateData.map((point) => (
                        <Cell key={point.slot} fillOpacity={point.partial ? 0.35 : 1} />
                      ))}
                    </Bar>
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>

            <h3>
              Gabungan: {REQ_LABEL} vs {RATE_LABEL}
            </h3>
            <div className="line-chart-wrap">
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={rateData} margin={MARGIN}>
                  <CartesianGrid stroke={chart.grid} strokeDasharray="4 4" vertical={false} />
                  <XAxis
                    dataKey="label"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: chart.axis, fontSize: 12 }}
                  />
                  <YAxis
                    yAxisId="req"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: chart.axis, fontSize: 12 }}
                    tickFormatter={count}
                    width={72}
                  />
                  <YAxis
                    yAxisId="rate"
                    orientation="right"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: chart.axis, fontSize: 12 }}
                    tickFormatter={(v) => `${v.toFixed(0)}%`}
                    width={48}
                  />
                  <Tooltip
                    content={<SlotTooltip series={[]} />}
                    cursor={{ fill: chart.barCursor }}
                  />
                  <Bar
                    yAxisId="req"
                    dataKey="totalReq"
                    name={REQ_LABEL}
                    fill={seriesColor(chart, 0)}
                    isAnimationActive={false}
                  >
                    {rateData.map((point) => (
                      <Cell key={point.slot} fillOpacity={point.partial ? 0.35 : 0.8} />
                    ))}
                  </Bar>
                  <Line
                    yAxisId="rate"
                    dataKey="totalRateSolid"
                    name={RATE_LABEL}
                    stroke={chart.roi}
                    strokeWidth={3}
                    dot={false}
                    type="monotone"
                    isAnimationActive={false}
                  />
                  <Line
                    yAxisId="rate"
                    dataKey="totalRateDashed"
                    legendType="none"
                    stroke={chart.roi}
                    strokeDasharray="5 4"
                    strokeWidth={3}
                    dot={false}
                    type="monotone"
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="chart-legend">
              <span>
                <i className="legend-dot" style={{ background: seriesColor(chart, 0) }} />{" "}
                {REQ_LABEL} (kiri)
              </span>
              <span>
                <i className="legend-dot roi" /> {RATE_LABEL} (kanan)
              </span>
              {hasPartial && (
                <span className="legend-running">
                  <i className="legend-dash" /> Jam terakhir — belum lengkap
                </span>
              )}
            </div>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Per situs</h2>
          </div>
        </div>
        <DataTable
          columns={TABLE_COLUMNS}
          defaultSort={REQ_FIRST}
          emptyText="Belum ada data pada periode ini."
          getRowId={(item) => item.subDomain}
          items={sites}
        />
      </section>
    </>
  );
}

// Umur data: halaman yang menjanjikan realtime harus menyebut kapan terakhir ditarik.
function StatusLine({ status }) {
  if (!status?.lastRunAt) return <p>Belum pernah ditarik.</p>;
  const networks = Object.values(status.networks || {});
  const failed = networks.filter((item) => !item.ok).map((item) => item.name);
  const last = networks
    .map((item) => item.lastSlot || "")
    .sort()
    .at(-1);
  return (
    <p>
      Ditarik {formatDateTime(status.lastRunAt)} WIB
      {last ? ` · jam terakhir ${last.slice(11)}:00 (belum lengkap)` : ""}
      {failed.length ? ` · gagal ditarik: ${failed.join(", ")}` : ""}
    </p>
  );
}

function SeriesLegend({ chart, series, hasPartial }) {
  return (
    <div className="chart-legend">
      {series.map((item, index) => (
        <span key={item.id}>
          <i className="legend-dot" style={{ background: seriesColor(chart, index) }} />{" "}
          {item.label}
        </span>
      ))}
      {hasPartial && (
        <span className="legend-running">
          <i className="legend-dash" /> Jam terakhir — belum lengkap
        </span>
      )}
    </div>
  );
}

function SlotTooltip({ active, payload, series }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  const lines = series.length ? series.filter((item) => point[`${item.id}Req`] > 0) : [];
  return (
    <div className="recharts-tooltip-card">
      <strong>{point.label}</strong>
      {point.partial && <span className="chart-tooltip-running">Jam terakhir, belum lengkap</span>}
      <span>
        Total: {count(point.totalReq)} permintaan · {count(point.totalImp)} tayangan ·{" "}
        {formatRate(point.totalRate)}
      </span>
      {lines.map((item) => (
        <span key={item.id}>
          {item.label}: {count(point[`${item.id}Req`])} · {count(point[`${item.id}Imp`])} ·{" "}
          {formatRate(point[`${item.id}Rate`])}
        </span>
      ))}
    </div>
  );
}
