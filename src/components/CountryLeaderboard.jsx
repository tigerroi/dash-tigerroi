import {
  Award,
  CircleAlert,
  Filter,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import React, { useMemo, useState } from "react";
import { formatRoiPercent } from "../lib/adTax";
import { buildCountryLeaderboard } from "../lib/countryLeaderboard";
import { renderCell } from "../lib/renderCell";
import { DataTable } from "./ui/DataTable";
import { DateRangePicker } from "./ui/DateRangePicker";

// Filter rentang tanggal default 14 hari terakhir
function default14DaysRange() {
  const end = new Date();
  const start = new Date(Date.now() - 13 * 24 * 60 * 60 * 1000);
  return {
    from: start.toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10),
  };
}

export function CountryLeaderboard({ countryRoi = [], adTaxRate = 0 }) {
  const [dateRange, setDateRange] = useState(default14DaysRange);
  const [minSpendThreshold, setMinSpendThreshold] = useState(100000);
  const [filterThresholdActive, setFilterThresholdActive] = useState(true);

  const threshold = filterThresholdActive ? minSpendThreshold : 0;

  const { items, hiddenCount, highlights } = useMemo(() => {
    return buildCountryLeaderboard(countryRoi, {
      adTaxRate,
      minSpendThreshold: threshold,
      dateWindow: dateRange,
    });
  }, [countryRoi, adTaxRate, threshold, dateRange]);

  const { best, lowest, fastestRising, steepestFalling } = highlights;

  return (
    <div className="country-leaderboard-page">
      <div className="panel-header" style={{ marginBottom: "1.25rem" }}>
        <div>
          <h2 style={{ fontSize: "1.35rem", fontWeight: 700, margin: 0 }}>ROI per Negara</h2>
          <p className="muted-line" style={{ marginTop: "0.25rem", fontSize: "0.85rem" }}>
            Periode {dateRange.from} s/d {dateRange.to}, agregasi spend Meta Ads dan revenue GAM.
          </p>
        </div>
        <div className="header-actions" style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <DateRangePicker
            align="right"
            label="Rentang Waktu"
            value={dateRange}
            onChange={setDateRange}
          />
          <button
            type="button"
            className={`ghost-button ${!filterThresholdActive ? "active" : ""}`}
            onClick={() => setFilterThresholdActive((prev) => !prev)}
            title={filterThresholdActive ? "Tampilkan seluruh negara tanpa filter batas spend" : "Sembunyikan spend kecil"}
            style={{ display: "flex", alignItems: "center", gap: "0.35rem", padding: "0.45rem 0.75rem" }}
          >
            <Filter size={14} />
            <span>{filterThresholdActive ? "Filter: >= Rp 100k" : "Semua Negara"}</span>
          </button>
        </div>
      </div>

      {/* ═══ 4 Kartu Sorotan di Atas ═══ */}
      <div className="country-highlights-grid" style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
        gap: "1rem",
        marginBottom: "1.5rem"
      }}>
        {/* Kartu 1: Paling Unggul */}
        <div className="stat-card" style={{ padding: "1.1rem", borderRadius: "8px", border: "1px solid var(--border-color, #27272a)", background: "var(--card-bg, #121215)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", color: "#a1a1aa", fontSize: "0.8rem", marginBottom: "0.5rem" }}>
            <span>Paling unggul</span>
            <Award size={16} color="#10b981" />
          </div>
          {best ? (
            <>
              <div style={{ fontSize: "0.95rem", fontWeight: 600, display: "flex", alignItems: "center", gap: "0.4rem" }}>
                <span>{best.flag}</span>
                <span>{best.country}</span>
              </div>
              <div style={{ fontSize: "1.4rem", fontWeight: 700, color: "#10b981", margin: "0.25rem 0" }}>
                +{best.roi.toFixed(2)}%
              </div>
              <div style={{ fontSize: "0.8rem", color: "#a1a1aa" }}>
                Profit <strong style={{ color: "#10b981" }}>{renderCell(best.profit, "earning")}</strong> · untung {best.daysRatio} hari
              </div>
            </>
          ) : (
            <div style={{ color: "#71717a", fontSize: "0.85rem" }}>Belum ada data</div>
          )}
        </div>

        {/* Kartu 2: ROI Terendah */}
        <div className="stat-card" style={{ padding: "1.1rem", borderRadius: "8px", border: "1px solid var(--border-color, #27272a)", background: "var(--card-bg, #121215)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", color: "#a1a1aa", fontSize: "0.8rem", marginBottom: "0.5rem" }}>
            <span>ROI terendah</span>
            <TrendingDown size={16} color="#ef4444" />
          </div>
          {lowest ? (
            <>
              <div style={{ fontSize: "0.95rem", fontWeight: 600, display: "flex", alignItems: "center", gap: "0.4rem" }}>
                <span>{lowest.flag}</span>
                <span>{lowest.country}</span>
              </div>
              <div style={{ fontSize: "1.4rem", fontWeight: 700, color: lowest.roi >= 0 ? "#10b981" : "#ef4444", margin: "0.25rem 0" }}>
                {lowest.roi >= 0 ? "+" : ""}{lowest.roi.toFixed(2)}%
              </div>
              <div style={{ fontSize: "0.8rem", color: "#a1a1aa" }}>
                {lowest.profit >= 0 ? "Tidak ada yang rugi · profit " : "Rugi "}
                <strong style={{ color: lowest.profit >= 0 ? "#10b981" : "#ef4444" }}>{renderCell(Math.abs(lowest.profit), "earning")}</strong>
              </div>
            </>
          ) : (
            <div style={{ color: "#71717a", fontSize: "0.85rem" }}>Belum ada data</div>
          )}
        </div>

        {/* Kartu 3: Sedang Naik (3 hari terakhir) */}
        <div className="stat-card" style={{ padding: "1.1rem", borderRadius: "8px", border: "1px solid var(--border-color, #27272a)", background: "var(--card-bg, #121215)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", color: "#a1a1aa", fontSize: "0.8rem", marginBottom: "0.5rem" }}>
            <span>Sedang naik · 3 hari terakhir</span>
            <TrendingUp size={16} color="#10b981" />
          </div>
          {fastestRising ? (
            <>
              <div style={{ fontSize: "0.95rem", fontWeight: 600, display: "flex", alignItems: "center", gap: "0.4rem" }}>
                <span>{fastestRising.flag}</span>
                <span>{fastestRising.country}</span>
              </div>
              <div style={{ fontSize: "1.4rem", fontWeight: 700, color: "#10b981", margin: "0.25rem 0" }}>
                +{fastestRising.delta.toFixed(1)} poin
              </div>
              <div style={{ fontSize: "0.8rem", color: "#a1a1aa" }}>
                ROI +{fastestRising.roi3Hari.toFixed(2)}% (periode +{fastestRising.roi.toFixed(2)}%)
              </div>
            </>
          ) : (
            <div style={{ color: "#71717a", fontSize: "0.85rem" }}>Belum ada data</div>
          )}
        </div>

        {/* Kartu 4: Sedang Turun (3 hari terakhir) */}
        <div className="stat-card" style={{ padding: "1.1rem", borderRadius: "8px", border: "1px solid var(--border-color, #27272a)", background: "var(--card-bg, #121215)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", color: "#a1a1aa", fontSize: "0.8rem", marginBottom: "0.5rem" }}>
            <span>Sedang turun · 3 hari terakhir</span>
            <TrendingDown size={16} color="#ef4444" />
          </div>
          {steepestFalling ? (
            <>
              <div style={{ fontSize: "0.95rem", fontWeight: 600, display: "flex", alignItems: "center", gap: "0.4rem" }}>
                <span>{steepestFalling.flag}</span>
                <span>{steepestFalling.country}</span>
              </div>
              <div style={{ fontSize: "1.4rem", fontWeight: 700, color: steepestFalling.delta >= 0 ? "#10b981" : "#ef4444", margin: "0.25rem 0" }}>
                {steepestFalling.delta.toFixed(1)} poin
              </div>
              <div style={{ fontSize: "0.8rem", color: "#a1a1aa" }}>
                ROI {steepestFalling.roi3Hari >= 0 ? "+" : ""}{steepestFalling.roi3Hari.toFixed(2)}% (periode +{steepestFalling.roi.toFixed(2)}%)
              </div>
            </>
          ) : (
            <div style={{ color: "#71717a", fontSize: "0.85rem" }}>Belum ada data</div>
          )}
        </div>
      </div>

      {/* ═══ Tabel Klasemen Negara ═══ */}
      <section className="panel" style={{ border: "1px solid var(--border-color, #27272a)", borderRadius: "8px", padding: "1.25rem", background: "var(--panel-bg, #121215)" }}>
        <div style={{ marginBottom: "1rem" }}>
          <h3 style={{ fontSize: "1.1rem", fontWeight: 700, margin: "0 0 0.25rem 0" }}>Klasemen negara</h3>
          {filterThresholdActive && hiddenCount > 0 && (
            <p className="muted-line" style={{ margin: 0, fontSize: "0.8rem", color: "#71717a" }}>
              {hiddenCount} negara dengan Total Spend di bawah Rp 100.000 disembunyikan.
            </p>
          )}
        </div>

        <DataTable
          columns={[
            {
              id: "country",
              header: "Negara",
              cell: ({ row }) => (
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", whiteSpace: "nowrap" }}>
                  <span style={{ fontSize: "1.2rem" }}>{row.original.flag}</span>
                  <strong style={{ fontWeight: 600 }}>{row.original.country}</strong>
                </div>
              ),
            },
            {
              id: "totalSpend",
              header: "Total Spend",
              meta: { align: "right" },
              cell: ({ row }) => (
                <span style={{ color: "#10b981", fontWeight: 600 }}>
                  {renderCell(row.original.totalSpend, "totalSpending")}
                </span>
              ),
            },
            {
              id: "earning",
              header: "Earning",
              meta: { align: "right" },
              cell: ({ row }) => (
                <span style={{ color: "#10b981", fontWeight: 600 }}>
                  {renderCell(row.original.earning, "earning")}
                </span>
              ),
            },
            {
              id: "profit",
              header: "Profit",
              meta: { align: "right" },
              cell: ({ row }) => {
                const p = row.original.profit;
                const isPos = p >= 0;
                return (
                  <span style={{ color: isPos ? "#10b981" : "#ef4444", fontWeight: 600 }}>
                    {renderCell(p, "earning")}
                  </span>
                );
              },
            },
            {
              id: "roi",
              header: "ROI",
              meta: { align: "right" },
              cell: ({ row }) => {
                const r = row.original.roi;
                const isPos = r >= 0;
                return (
                  <span style={{ color: isPos ? "#10b981" : "#ef4444", fontWeight: 600 }}>
                    {isPos ? "+" : ""}{r.toFixed(2)}%
                  </span>
                );
              },
            },
            {
              id: "roi3Hari",
              header: "ROI 3 hari",
              meta: { align: "right" },
              cell: ({ row }) => {
                const r = row.original.roi3Hari;
                const isPos = r >= 0;
                return (
                  <span style={{ color: isPos ? "#10b981" : "#ef4444", fontWeight: 600 }}>
                    {isPos ? "+" : ""}{r.toFixed(2)}%
                  </span>
                );
              },
            },
            {
              id: "delta",
              header: "Δ",
              meta: { align: "right" },
              cell: ({ row }) => {
                const d = row.original.delta;
                const isPos = d >= 0;
                return (
                  <span style={{ color: isPos ? "#10b981" : "#ef4444", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: "0.2rem" }}>
                    {isPos ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                    {isPos ? "+" : ""}{d.toFixed(1)} poin
                  </span>
                );
              },
            },
            {
              id: "daysRatio",
              header: "Hari untung",
              meta: { align: "center" },
              cell: ({ row }) => (
                <span style={{ color: "#a1a1aa", fontSize: "0.85rem" }}>
                  {row.original.daysRatio}
                </span>
              ),
            },
            {
              id: "cpc",
              header: "CPC",
              meta: { align: "right" },
              cell: ({ row }) => (
                <span style={{ color: "#10b981" }}>
                  {renderCell(Math.round(row.original.cpc), "earning")}
                </span>
              ),
            },
            {
              id: "ecpm",
              header: "eCPM",
              meta: { align: "right" },
              cell: ({ row }) => (
                <span style={{ color: "#10b981" }}>
                  {renderCell(Math.round(row.original.ecpm), "earning")}
                </span>
              ),
            },
            {
              id: "recommendation",
              header: "Rekomendasi",
              meta: { align: "center" },
              cell: ({ row }) => {
                const tone = row.original.recommendationTone;
                const rec = row.original.recommendation;
                let bg = "rgba(16, 185, 129, 0.15)";
                let color = "#10b981";
                let border = "1px solid rgba(16, 185, 129, 0.3)";

                if (tone === "danger") {
                  bg = "rgba(239, 68, 68, 0.15)";
                  color = "#ef4444";
                  border = "1px solid rgba(239, 68, 68, 0.3)";
                } else if (tone === "neutral") {
                  bg = "rgba(161, 161, 170, 0.15)";
                  color = "#d4d4d8";
                  border = "1px solid rgba(161, 161, 170, 0.3)";
                }

                return (
                  <span
                    style={{
                      display: "inline-block",
                      padding: "0.2rem 0.6rem",
                      borderRadius: "9999px",
                      fontSize: "0.75rem",
                      fontWeight: 600,
                      background: bg,
                      color: color,
                      border: border,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {rec}
                  </span>
                );
              },
            },
          ]}
          items={items}
          paginate
          pageSize={25}
          paginationLabel="negara"
        />
      </section>
    </div>
  );
}
