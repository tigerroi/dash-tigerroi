import {
  Award,
  CircleAlert,
  Filter,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import React, { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart as RechartsLineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useChartPalette } from "../hooks/useChartPalette";
import { formatRoiPercent } from "../lib/adTax";
import { seriesColor } from "../lib/chartTheme";
import { flagUrl } from "../lib/countries";
import {
  buildBudgetCutPriorities,
  buildCountryDailyHeatmap,
  buildCountryLeaderboard,
  buildCountryRoiCurves,
  formatIndonesianDayDate,
} from "../lib/countryLeaderboard";
import { formatDayMonth } from "../lib/formatDate";
import { compactRupiah } from "../lib/money";
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

/**
 * Komponen Bendera Negara menggunakan gambar flagcdn.com.
 * Mengatasi masalah keterbatasan sistem Windows di mana font Segoe UI Emoji
 * tidak merender bendera negara dan hanya menampilkan dua huruf penanda wilayah.
 */
export function CountryFlag({ code, size = "sm" }) {
  const clean = String(code || "").trim().toUpperCase();
  const src = flagUrl(clean, 20);
  const src2x = flagUrl(clean, 40);

  if (!src) return <span style={{ fontSize: size === "lg" ? "1.2rem" : "1rem" }}>🌐</span>;

  const width = size === "lg" ? 22 : 18;
  const height = size === "lg" ? 15 : 12;

  return (
    <img
      alt={clean}
      src={src}
      srcSet={`${src} 1x, ${src2x} 2x`}
      width={width}
      height={height}
      loading="lazy"
      style={{
        display: "inline-block",
        verticalAlign: "middle",
        borderRadius: "2px",
        objectFit: "cover",
        boxShadow: "0 0 1px rgba(0, 0, 0, 0.4)",
      }}
      onError={(event) => {
        event.currentTarget.style.display = "none";
      }}
    />
  );
}

export function CountryLeaderboard({ countryRoi = [], adTaxRate = 0, subDomains = [], users = [] }) {
  const [dateRange, setDateRange] = useState(default14DaysRange);
  const [minSpendThreshold, setMinSpendThreshold] = useState(100000);
  const [filterThresholdActive, setFilterThresholdActive] = useState(true);
  const [showAllHeatmap, setShowAllHeatmap] = useState(false);
  const [selectedCurveCountries, setSelectedCurveCountries] = useState([]);
  const [hoveredCell, setHoveredCell] = useState(null);

  const chart = useChartPalette();
  const threshold = filterThresholdActive ? minSpendThreshold : 0;

  // 1. Data Klasemen Utama & 4 Kartu Sorotan
  const { items, allItems, hiddenCount, highlights } = useMemo(() => {
    return buildCountryLeaderboard(countryRoi, {
      adTaxRate,
      minSpendThreshold: threshold,
      dateWindow: dateRange,
    });
  }, [countryRoi, adTaxRate, threshold, dateRange]);

  const { best, lowest, fastestRising, steepestFalling } = highlights;

  // 2. Data Heatmap ROI Harian
  const heatmapData = useMemo(() => {
    return buildCountryDailyHeatmap(countryRoi, {
      adTaxRate,
      dateWindow: dateRange,
    });
  }, [countryRoi, adTaxRate, dateRange]);

  const visibleHeatmapCountries = useMemo(() => {
    if (showAllHeatmap) return heatmapData.countryRows;
    return heatmapData.countryRows.slice(0, 15);
  }, [heatmapData.countryRows, showAllHeatmap]);

  // 3. Data Kurva ROI Harian
  const curveData = useMemo(() => {
    return buildCountryRoiCurves(countryRoi, {
      adTaxRate,
      dateWindow: dateRange,
    });
  }, [countryRoi, adTaxRate, dateRange]);

  // Inisialisasi negara terpilih di kurva jika belum ada (default 5 negara teratas)
  const activeCurveCountries = useMemo(() => {
    if (selectedCurveCountries.length > 0) {
      return selectedCurveCountries;
    }
    return curveData.series.slice(0, 5).map((s) => s.code);
  }, [selectedCurveCountries, curveData.series]);

  const toggleCurveCountry = (code) => {
    setSelectedCurveCountries((prev) => {
      const current = prev.length > 0 ? prev : curveData.series.slice(0, 5).map((s) => s.code);
      if (current.includes(code)) {
        if (current.length === 1) return current; // Minimal 1 negara aktif
        return current.filter((c) => c !== code);
      }
      return [...current, code];
    });
  };

  // 4. Data Prioritas Penurunan Anggaran 3 Hari Terakhir
  const budgetCutPriorities = useMemo(() => {
    return buildBudgetCutPriorities(countryRoi, {
      subDomains,
      adTaxRate,
      recentDays: 3,
    });
  }, [countryRoi, subDomains, adTaxRate]);

  // Kolom DataTable Klasemen Negara
  const leaderboardColumns = useMemo(
    () => [
      {
        accessorKey: "country",
        header: "Negara",
        cell: ({ row }) => (
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <CountryFlag code={row.original.countryCode} />
            <span style={{ fontWeight: 600 }}>{row.original.country}</span>
          </div>
        ),
      },
      {
        accessorKey: "totalSpend",
        header: "Total Spend",
        cell: ({ getValue }) => renderCell(getValue(), "spend"),
      },
      {
        accessorKey: "earning",
        header: "Earning",
        cell: ({ getValue }) => renderCell(getValue(), "earning"),
      },
      {
        accessorKey: "profit",
        header: "Profit",
        cell: ({ getValue }) => {
          const val = getValue();
          const color = val > 0 ? "#10b981" : val < 0 ? "#ef4444" : "#a1a1aa";
          return (
            <span style={{ color, fontWeight: 600 }}>
              {val < 0 ? "-" : ""}Rp {Math.abs(val).toLocaleString("id-ID", { maximumFractionDigits: 0 })}
            </span>
          );
        },
      },
      {
        accessorKey: "roi",
        header: "ROI",
        cell: ({ getValue }) => {
          const val = getValue();
          const color = val > 0 ? "#10b981" : val < 0 ? "#ef4444" : "#a1a1aa";
          return <span style={{ color, fontWeight: 600 }}>{formatRoiPercent(val)}</span>;
        },
      },
      {
        accessorKey: "roi3Hari",
        header: "ROI 3 hari",
        cell: ({ getValue }) => {
          const val = getValue();
          const color = val > 0 ? "#10b981" : val < 0 ? "#ef4444" : "#a1a1aa";
          return <span style={{ color, fontWeight: 600 }}>{formatRoiPercent(val)}</span>;
        },
      },
      {
        accessorKey: "delta",
        header: "Δ",
        cell: ({ getValue }) => {
          const val = getValue();
          const isUp = val >= 0;
          const color = isUp ? "#10b981" : "#ef4444";
          const sign = isUp ? "+" : "";
          return (
            <span style={{ color, fontWeight: 500 }}>
              {sign}{val.toFixed(1)} poin
            </span>
          );
        },
      },
      {
        accessorKey: "daysRatio",
        header: "Hari untung",
        cell: ({ getValue }) => <span style={{ color: "#a1a1aa" }}>{getValue()}</span>,
      },
      {
        accessorKey: "cpc",
        header: "CPC",
        cell: ({ getValue }) => (
          <span style={{ color: "#a1a1aa" }}>
            Rp {Math.round(getValue()).toLocaleString("id-ID")}
          </span>
        ),
      },
      {
        accessorKey: "ecpm",
        header: "eCPM",
        cell: ({ getValue }) => (
          <span style={{ color: "#a1a1aa" }}>
            Rp {Math.round(getValue()).toLocaleString("id-ID")}
          </span>
        ),
      },
      {
        accessorKey: "recommendation",
        header: "Rekomendasi",
        cell: ({ row }) => {
          const rec = row.original.recommendation;
          const tone = row.original.recommendationTone;
          let bg = "rgba(113, 113, 122, 0.15)";
          let color = "#a1a1aa";
          if (tone === "success") {
            bg = "rgba(16, 185, 129, 0.15)";
            color = "#10b981";
          } else if (tone === "danger") {
            bg = "rgba(239, 68, 68, 0.15)";
            color = "#ef4444";
          }
          return (
            <span
              style={{
                display: "inline-block",
                padding: "0.2rem 0.55rem",
                borderRadius: "4px",
                fontSize: "0.75rem",
                fontWeight: 600,
                background: bg,
                color,
              }}
            >
              {rec}
            </span>
          );
        },
      },
    ],
    []
  );

  // Kolom DataTable Prioritas Penurunan Anggaran
  const budgetCutColumns = useMemo(
    () => [
      {
        accessorKey: "country",
        header: "Negara",
        cell: ({ row }) => (
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <CountryFlag code={row.original.countryCode} />
            <span>{row.original.country}</span>
          </div>
        ),
      },
      {
        accessorKey: "subDomain",
        header: "Subdomain",
        cell: ({ getValue }) => <code style={{ fontSize: "0.85rem", color: "#e4e4e7" }}>{getValue()}</code>,
      },
      {
        accessorKey: "pic",
        header: "PIC",
        cell: ({ getValue }) => <span style={{ color: "#a1a1aa" }}>{getValue()}</span>,
      },
      {
        accessorKey: "totalSpend",
        header: "Total Spend",
        cell: ({ getValue }) => renderCell(getValue(), "spend"),
      },
      {
        accessorKey: "earning",
        header: "Earning",
        cell: ({ getValue }) => renderCell(getValue(), "earning"),
      },
      {
        accessorKey: "profit",
        header: "Profit",
        cell: ({ getValue }) => (
          <span style={{ color: "#ef4444", fontWeight: 600 }}>
            -Rp {Math.abs(getValue()).toLocaleString("id-ID", { maximumFractionDigits: 0 })}
          </span>
        ),
      },
      {
        accessorKey: "roi",
        header: "ROI",
        cell: ({ getValue }) => (
          <span style={{ color: "#ef4444", fontWeight: 600 }}>
            {formatRoiPercent(getValue())}
          </span>
        ),
      },
      {
        accessorKey: "consecutiveLossDays",
        header: "Rugi beruntun",
        cell: ({ getValue }) => (
          <span
            style={{
              padding: "0.2rem 0.5rem",
              borderRadius: "4px",
              fontSize: "0.75rem",
              fontWeight: 600,
              background: "rgba(239, 68, 68, 0.15)",
              color: "#f87171",
            }}
          >
            {getValue()} hari
          </span>
        ),
      },
    ],
    []
  );

  // Helper warna sel heatmap
  const getCellStyles = (category, isPartial) => {
    let background = "rgba(39, 39, 42, 0.4)";
    let border = "1px solid rgba(63, 63, 70, 0.3)";
    let color = "#71717a";

    switch (category) {
      case "high-profit":
        background = "#065f46";
        border = "1px solid #10b981";
        color = "#d1fae5";
        break;
      case "medium-profit":
        background = "#047857";
        border = "1px solid #059669";
        color = "#a7f3d0";
        break;
      case "low-profit":
        background = "#064e3b";
        border = "1px solid #047857";
        color = "#6ee7b7";
        break;
      case "light-loss":
        background = "#7f1d1d";
        border = "1px solid #b91c1c";
        color = "#fee2e2";
        break;
      case "medium-loss":
        background = "#991b1b";
        border = "1px solid #dc2626";
        color = "#fecaca";
        break;
      case "severe-loss":
        background = "#450a0a";
        border = "1px solid #7f1d1d";
        color = "#fca5a5";
        break;
      case "none":
      default:
        background = "rgba(24, 24, 27, 0.5)";
        border = "1px solid rgba(39, 39, 42, 0.5)";
        color = "#52525b";
        break;
    }

    if (isPartial) {
      border = "1px dashed #38bdf8";
    }

    return { background, border, color };
  };

  return (
    <div className="country-leaderboard-page" style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
      {/* ═══ 1. HEADER ═══ */}
      <div className="panel-header" style={{ marginBottom: "-0.5rem" }}>
        <div>
          <h2 style={{ fontSize: "1.35rem", fontWeight: 700, margin: 0 }}>ROI per Negara</h2>
          <p className="muted-line" style={{ marginTop: "0.25rem", fontSize: "0.85rem", color: "#a1a1aa" }}>
            Hari selesai {dateRange.from} – {dateRange.to} · {heatmapData.lastDate} berjalan, hanya di heatmap & kurva
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
            title={filterThresholdActive ? "Tampilkan seluruh negara tanpa batas spend" : "Sembunyikan spend kecil"}
            style={{ display: "flex", alignItems: "center", gap: "0.35rem", padding: "0.45rem 0.75rem" }}
          >
            <Filter size={14} />
            <span>{filterThresholdActive ? "Filter: >= Rp 100k" : "Semua Negara"}</span>
          </button>
        </div>
      </div>

      {/* ═══ 2. 4 KARTU SOROTAN DI ATAS ═══ */}
      <div
        className="country-highlights-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))",
          gap: "1rem",
        }}
      >
        {/* Kartu 1: Paling Unggul */}
        <div className="stat-card" style={{ padding: "1.1rem", borderRadius: "8px", border: "1px solid var(--border-color, #27272a)", background: "var(--card-bg, #121215)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", color: "#a1a1aa", fontSize: "0.8rem", marginBottom: "0.5rem" }}>
            <span>Paling unggul</span>
            <Award size={16} color="#10b981" />
          </div>
          {best ? (
            <>
              <div style={{ fontSize: "0.95rem", fontWeight: 600, display: "flex", alignItems: "center", gap: "0.45rem" }}>
                <CountryFlag code={best.countryCode} size="lg" />
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
              <div style={{ fontSize: "0.95rem", fontWeight: 600, display: "flex", alignItems: "center", gap: "0.45rem" }}>
                <CountryFlag code={lowest.countryCode} size="lg" />
                <span>{lowest.country}</span>
              </div>
              <div style={{ fontSize: "1.4rem", fontWeight: 700, color: lowest.roi >= 0 ? "#10b981" : "#ef4444", margin: "0.25rem 0" }}>
                {lowest.roi >= 0 ? "+" : ""}{lowest.roi.toFixed(2)}%
              </div>
              <div style={{ fontSize: "0.8rem", color: "#a1a1aa" }}>
                {lowest.profit >= 0 ? (
                  <>Tidak ada yang rugi · profit <strong style={{ color: "#10b981" }}>{renderCell(lowest.profit, "earning")}</strong></>
                ) : (
                  <>Rugi <strong style={{ color: "#ef4444" }}>{renderCell(lowest.profit, "earning")}</strong> · untung {lowest.daysRatio} hari</>
                )}
              </div>
            </>
          ) : (
            <div style={{ color: "#71717a", fontSize: "0.85rem" }}>Belum ada data</div>
          )}
        </div>

        {/* Kartu 3: Sedang Naik 3 Hari Terakhir */}
        <div className="stat-card" style={{ padding: "1.1rem", borderRadius: "8px", border: "1px solid var(--border-color, #27272a)", background: "var(--card-bg, #121215)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", color: "#a1a1aa", fontSize: "0.8rem", marginBottom: "0.5rem" }}>
            <span>Sedang naik · 3 hari terakhir</span>
            <TrendingUp size={16} color="#10b981" />
          </div>
          {fastestRising ? (
            <>
              <div style={{ fontSize: "0.95rem", fontWeight: 600, display: "flex", alignItems: "center", gap: "0.45rem" }}>
                <CountryFlag code={fastestRising.countryCode} size="lg" />
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

        {/* Kartu 4: Sedang Turun 3 Hari Terakhir */}
        <div className="stat-card" style={{ padding: "1.1rem", borderRadius: "8px", border: "1px solid var(--border-color, #27272a)", background: "var(--card-bg, #121215)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", color: "#a1a1aa", fontSize: "0.8rem", marginBottom: "0.5rem" }}>
            <span>Sedang turun · 3 hari terakhir</span>
            <TrendingDown size={16} color="#ef4444" />
          </div>
          {steepestFalling ? (
            <>
              <div style={{ fontSize: "0.95rem", fontWeight: 600, display: "flex", alignItems: "center", gap: "0.45rem" }}>
                <CountryFlag code={steepestFalling.countryCode} size="lg" />
                <span>{steepestFalling.country}</span>
              </div>
              <div style={{ fontSize: "1.4rem", fontWeight: 700, color: "#ef4444", margin: "0.25rem 0" }}>
                {steepestFalling.delta.toFixed(1)} poin
              </div>
              <div style={{ fontSize: "0.8rem", color: "#a1a1aa" }}>
                ROI +{steepestFalling.roi3Hari.toFixed(2)}% (periode +{steepestFalling.roi.toFixed(2)}%)
              </div>
            </>
          ) : (
            <div style={{ color: "#71717a", fontSize: "0.85rem" }}>Belum ada data</div>
          )}
        </div>
      </div>

      {/* ═══ 3. TABEL KLASEMEN NEGARA ═══ */}
      <div className="country-leaderboard-section">
        <div style={{ marginBottom: "0.75rem" }}>
          <h3 style={{ fontSize: "1.15rem", fontWeight: 700, margin: 0 }}>Klasemen negara</h3>
          {filterThresholdActive && hiddenCount > 0 && (
            <p className="muted-line" style={{ marginTop: "0.2rem", fontSize: "0.8rem", color: "#71717a" }}>
              {hiddenCount} negara dengan Total Spend di bawah Rp 100.000 disembunyikan.
            </p>
          )}
        </div>
        <DataTable columns={leaderboardColumns} data={items} />
      </div>

      {/* ═══ 4. HEATMAP ROI HARIAN ═══ */}
      <div
        className="country-heatmap-section"
        style={{
          background: "var(--card-bg, #121215)",
          border: "1px solid var(--border-color, #27272a)",
          borderRadius: "8px",
          padding: "1.25rem",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1rem" }}>
          <div>
            <h3 style={{ fontSize: "1.15rem", fontWeight: 700, margin: 0 }}>Heatmap ROI harian</h3>
            <p style={{ marginTop: "0.25rem", fontSize: "0.85rem", color: "#a1a1aa" }}>
              Warna = ROI hari itu; sentuh sel untuk rincian subdomain.
            </p>
          </div>
          {heatmapData.countryRows.length > 15 && (
            <button
              type="button"
              className="ghost-button"
              onClick={() => setShowAllHeatmap((prev) => !prev)}
              style={{ fontSize: "0.8rem", padding: "0.35rem 0.65rem" }}
            >
              {showAllHeatmap ? "Tampilkan ringkas" : `Tampilkan semua (${heatmapData.countryRows.length})`}
            </button>
          )}
        </div>

        {/* Tabel Heatmap Grid dengan Horizontal Scroll */}
        <div style={{ overflowX: "auto", position: "relative", marginBottom: "1rem" }}>
          <div
            role="table"
            style={{
              display: "table",
              width: "100%",
              borderSpacing: "3px",
              fontSize: "0.75rem",
              textAlign: "center",
            }}
          >
            {/* Header Tanggal */}
            <div role="rowgroup" style={{ display: "table-header-group" }}>
              <div role="row" style={{ display: "table-row" }}>
                <div
                  role="columnheader"
                  style={{
                    display: "table-cell",
                    position: "sticky",
                    left: 0,
                    zIndex: 2,
                    background: "var(--card-bg, #121215)",
                    textAlign: "left",
                    padding: "0.4rem 0.6rem",
                    color: "#a1a1aa",
                    fontWeight: 600,
                    minWidth: "150px",
                  }}
                >
                  Negara
                </div>
                {heatmapData.dates.map((d) => (
                  <div
                    key={d}
                    role="columnheader"
                    style={{
                      display: "table-cell",
                      padding: "0.4rem 0.3rem",
                      color: "#a1a1aa",
                      fontWeight: 500,
                      minWidth: "62px",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {formatIndonesianDayDate(d)}
                  </div>
                ))}
              </div>
            </div>

            <div role="rowgroup" style={{ display: "table-row-group" }}>
              {/* Baris Total */}
              <div role="row" style={{ display: "table-row" }}>
                <div
                  role="cell"
                  style={{
                    display: "table-cell",
                    position: "sticky",
                    left: 0,
                    zIndex: 2,
                    background: "var(--card-bg, #121215)",
                    textAlign: "left",
                    padding: "0.45rem 0.6rem",
                    fontWeight: 700,
                    color: "#e4e4e7",
                  }}
                >
                  Total
                </div>
                {heatmapData.dates.map((d) => {
                  const day = heatmapData.totalRow.days[d];
                  const styles = getCellStyles(day?.category, day?.isPartial);
                  const text = day && day.spend >= 1000 ? `${day.roi > 0 ? "+" : ""}${Math.round(day.roi)}%` : "-";
                  return (
                    <div
                      key={d}
                      role="cell"
                      onMouseEnter={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        setHoveredCell({
                          x: rect.left,
                          y: rect.bottom + 4,
                          title: `Total · ${formatIndonesianDayDate(d)}`,
                          spend: day?.spend || 0,
                          earning: day?.earning || 0,
                          profit: day?.profit || 0,
                          roi: day?.roi,
                          subdomains: [],
                        });
                      }}
                      onMouseLeave={() => setHoveredCell(null)}
                      style={{
                        display: "table-cell",
                        padding: "0.4rem 0.2rem",
                        borderRadius: "4px",
                        cursor: "pointer",
                        fontWeight: 700,
                        ...styles,
                      }}
                    >
                      {text}
                    </div>
                  );
                })}
              </div>

              {/* Baris Tiap Negara */}
              {visibleHeatmapCountries.map((c) => (
                <div role="row" key={c.countryCode} style={{ display: "table-row" }}>
                  <div
                    role="cell"
                    style={{
                      display: "table-cell",
                      position: "sticky",
                      left: 0,
                      zIndex: 2,
                      background: "var(--card-bg, #121215)",
                      textAlign: "left",
                      padding: "0.45rem 0.6rem",
                      fontWeight: 500,
                      color: "#e4e4e7",
                      whiteSpace: "nowrap",
                    }}
                  >
                    <span style={{ marginRight: "0.45rem", display: "inline-flex", verticalAlign: "middle" }}>
                      <CountryFlag code={c.countryCode} />
                    </span>
                    <span>{c.countryName}</span>
                  </div>
                  {heatmapData.dates.map((d) => {
                    const day = c.days[d];
                    const styles = getCellStyles(day?.category, day?.isPartial);
                    const text = day && day.spend >= 1000 ? `${day.roi > 0 ? "+" : ""}${Math.round(day.roi)}%` : "-";
                    return (
                      <div
                        key={d}
                        role="cell"
                        onMouseEnter={(e) => {
                          const rect = e.currentTarget.getBoundingClientRect();
                          setHoveredCell({
                            x: rect.left,
                            y: rect.bottom + 4,
                            countryCode: c.countryCode,
                            title: `${c.countryName} · ${formatIndonesianDayDate(d)}`,
                            spend: day?.spend || 0,
                            earning: day?.earning || 0,
                            profit: day?.profit || 0,
                            roi: day?.roi,
                            subdomains: day?.subdomains || [],
                          });
                        }}
                        onMouseLeave={() => setHoveredCell(null)}
                        style={{
                          display: "table-cell",
                          padding: "0.4rem 0.2rem",
                          borderRadius: "4px",
                          cursor: "pointer",
                          fontWeight: 600,
                          ...styles,
                        }}
                      >
                        {text}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Popover Hover Sel Heatmap */}
        {hoveredCell && (
          <div
            style={{
              position: "fixed",
              top: Math.min(hoveredCell.y, window.innerHeight - 200),
              left: Math.min(hoveredCell.x, window.innerWidth - 260),
              zIndex: 9999,
              background: "#18181b",
              border: "1px solid #3f3f46",
              borderRadius: "6px",
              padding: "0.75rem",
              boxShadow: "0 10px 25px rgba(0,0,0,0.5)",
              fontSize: "0.75rem",
              minWidth: "220px",
              pointerEvents: "none",
            }}
          >
            <div style={{ fontWeight: 700, borderBottom: "1px solid #27272a", paddingBottom: "0.35rem", marginBottom: "0.45rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
              {hoveredCell.countryCode && <CountryFlag code={hoveredCell.countryCode} />}
              <span>{hoveredCell.title}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.2rem" }}>
              <span style={{ color: "#a1a1aa" }}>Spend:</span>
              <span>Rp {Math.round(hoveredCell.spend).toLocaleString("id-ID")}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.2rem" }}>
              <span style={{ color: "#a1a1aa" }}>Earning:</span>
              <span>Rp {Math.round(hoveredCell.earning).toLocaleString("id-ID")}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.2rem" }}>
              <span style={{ color: "#a1a1aa" }}>Profit:</span>
              <span style={{ color: hoveredCell.profit >= 0 ? "#10b981" : "#ef4444", fontWeight: 600 }}>
                {hoveredCell.profit < 0 ? "-" : ""}Rp {Math.abs(Math.round(hoveredCell.profit)).toLocaleString("id-ID")}
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.4rem" }}>
              <span style={{ color: "#a1a1aa" }}>ROI:</span>
              <span style={{ color: (hoveredCell.roi || 0) >= 0 ? "#10b981" : "#ef4444", fontWeight: 700 }}>
                {hoveredCell.roi !== null && hoveredCell.roi !== undefined ? formatRoiPercent(hoveredCell.roi) : "-"}
              </span>
            </div>
            {hoveredCell.subdomains.length > 0 && (
              <div style={{ borderTop: "1px solid #27272a", paddingTop: "0.35rem", marginTop: "0.35rem" }}>
                <div style={{ fontSize: "0.7rem", color: "#a1a1aa", marginBottom: "0.25rem" }}>Rincian Subdomain:</div>
                {hoveredCell.subdomains.slice(0, 4).map((s) => (
                  <div key={s.name} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.7rem", marginBottom: "0.15rem" }}>
                    <span style={{ maxWidth: "130px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
                    <span style={{ color: s.profit >= 0 ? "#10b981" : "#ef4444" }}>{formatRoiPercent(s.roi)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Legend Heatmap Bar */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "0.75rem",
            alignItems: "center",
            fontSize: "0.75rem",
            color: "#a1a1aa",
            borderTop: "1px solid var(--border-color, #27272a)",
            paddingTop: "0.75rem",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
            <span style={{ width: "14px", height: "14px", borderRadius: "3px", background: "#450a0a", border: "1px solid #7f1d1d" }} />
            <span>&lt; -60%</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
            <span style={{ width: "14px", height: "14px", borderRadius: "3px", background: "#991b1b", border: "1px solid #dc2626" }} />
            <span>-60 s/d -30%</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
            <span style={{ width: "14px", height: "14px", borderRadius: "3px", background: "#7f1d1d", border: "1px solid #b91c1c" }} />
            <span>-30 s/d 0%</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
            <span style={{ width: "14px", height: "14px", borderRadius: "3px", background: "#064e3b", border: "1px solid #047857" }} />
            <span>0 s/d 30%</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
            <span style={{ width: "14px", height: "14px", borderRadius: "3px", background: "#047857", border: "1px solid #059669" }} />
            <span>30 s/d 100%</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
            <span style={{ width: "14px", height: "14px", borderRadius: "3px", background: "#065f46", border: "1px solid #10b981" }} />
            <span>≥ 100%</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
            <span style={{ width: "14px", height: "14px", borderRadius: "3px", background: "rgba(24, 24, 27, 0.5)", border: "1px solid rgba(39, 39, 42, 0.5)" }} />
            <span>tanpa ROI (belanja &lt; Rp 1.000)</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
            <span style={{ width: "14px", height: "14px", borderRadius: "3px", border: "1px dashed #38bdf8" }} />
            <span>hari berjalan</span>
          </div>
        </div>
      </div>

      {/* ═══ 5. KURVA ROI HARIAN PER NEGARA ═══ */}
      <div
        className="country-curve-section"
        style={{
          background: "var(--card-bg, #121215)",
          border: "1px solid var(--border-color, #27272a)",
          borderRadius: "8px",
          padding: "1.25rem",
        }}
      >
        <div style={{ marginBottom: "1rem" }}>
          <h3 style={{ fontSize: "1.15rem", fontWeight: 700, margin: 0 }}>Kurva ROI harian per negara</h3>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.65rem" }}>
            <span style={{ fontSize: "0.8rem", color: "#a1a1aa" }}>Pilih negara:</span>
            {curveData.series.map((item, index) => {
              const active = activeCurveCountries.includes(item.code);
              const color = seriesColor(chart, index);
              return (
                <button
                  key={item.code}
                  type="button"
                  onClick={() => toggleCurveCountry(item.code)}
                  style={{
                    padding: "0.25rem 0.65rem",
                    borderRadius: "16px",
                    fontSize: "0.75rem",
                    fontWeight: 600,
                    cursor: "pointer",
                    border: active ? `1.5px solid ${color}` : "1px solid #27272a",
                    background: active ? `${color}22` : "transparent",
                    color: active ? color : "#71717a",
                    transition: "all 0.15s ease",
                  }}
                >
                  {item.name}
                </button>
              );
            })}
          </div>
        </div>

        {/* Recharts Multi-Line Chart */}
        <div style={{ width: "100%", height: 300, marginTop: "1rem" }}>
          <ResponsiveContainer width="100%" height="100%">
            <RechartsLineChart data={curveData.points} margin={{ top: 15, right: 20, bottom: 10, left: 10 }}>
              <CartesianGrid stroke={chart.grid} strokeDasharray="4 4" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={formatDayMonth}
                axisLine={false}
                tickLine={false}
                tick={{ fill: chart.axis, fontSize: 11 }}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tickFormatter={(val) => `${val > 0 ? "+" : ""}${val.toFixed(0)}%`}
                tick={{ fill: chart.axis, fontSize: 11 }}
                width={65}
              />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  const pt = payload[0]?.payload;
                  const rows = activeCurveCountries
                    .map((code) => {
                      const s = curveData.series.find((x) => x.code === code);
                      const sIndex = curveData.series.indexOf(s);
                      const color = seriesColor(chart, sIndex);
                      const roi = pt ? pt[`roi_${code}`] : null;
                      const spend = pt ? pt[`roi_${code}__spend`] : 0;
                      return { s, color, roi, spend };
                    })
                    .filter((r) => r.roi !== null && r.roi !== undefined)
                    .sort((a, b) => Number(b.roi) - Number(a.roi));

                  return (
                    <div
                      style={{
                        background: "#18181b",
                        border: "1px solid #3f3f46",
                        borderRadius: "6px",
                        padding: "0.65rem 0.85rem",
                        boxShadow: "0 10px 25px rgba(0,0,0,0.5)",
                        fontSize: "0.75rem",
                      }}
                    >
                      <div style={{ fontWeight: 700, color: "#e4e4e7", marginBottom: "0.35rem" }}>
                        {formatIndonesianDayDate(label)}
                      </div>
                      {rows.map((r) => (
                        <div key={r.s.code} style={{ color: r.color, marginBottom: "0.2rem", fontWeight: 600 }}>
                          {r.s.name}: {r.roi > 0 ? "+" : ""}{r.roi.toFixed(1)}% · Rp {Math.round(r.spend).toLocaleString("id-ID")}
                        </div>
                      ))}
                    </div>
                  );
                }}
                cursor={{ stroke: chart.axis, strokeDasharray: "4 4" }}
              />
              {activeCurveCountries.map((code) => {
                const s = curveData.series.find((x) => x.code === code);
                const sIndex = curveData.series.indexOf(s);
                const color = seriesColor(chart, sIndex);
                return (
                  <Line
                    key={code}
                    type="monotone"
                    dataKey={`roi_${code}`}
                    name={s?.name || code}
                    stroke={color}
                    strokeWidth={2.5}
                    dot={{ r: 2.5, fill: chart.dotFill, stroke: color, strokeWidth: 1.5 }}
                    activeDot={{ r: 5, fill: chart.dotFill, stroke: color, strokeWidth: 2 }}
                    connectNulls={true}
                  />
                );
              })}
            </RechartsLineChart>
          </ResponsiveContainer>
        </div>

        {/* Legend Kurva */}
        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginTop: "0.75rem", fontSize: "0.75rem", color: "#a1a1aa" }}>
          {activeCurveCountries.map((code) => {
            const s = curveData.series.find((x) => x.code === code);
            const sIndex = curveData.series.indexOf(s);
            const color = seriesColor(chart, sIndex);
            return (
              <span key={code} style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
                <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: color }} />
                <span>{s?.name || code}</span>
              </span>
            );
          })}
        </div>
      </div>

      {/* ═══ 6. PRIORITAS PENURUNAN ANGGARAN - 3 HARI TERAKHIR ═══ */}
      <div className="budget-cut-priorities-section">
        <div style={{ marginBottom: "0.75rem" }}>
          <h3 style={{ fontSize: "1.15rem", fontWeight: 700, margin: 0 }}>
            Prioritas penurunan anggaran - 3 hari terakhir
          </h3>
          <p className="muted-line" style={{ marginTop: "0.2rem", fontSize: "0.8rem", color: "#71717a" }}>
            Pasangan negara x subdomain yang rugi, rugi terbesar dulu.
          </p>
        </div>
        {budgetCutPriorities.length > 0 ? (
          <DataTable columns={budgetCutColumns} data={budgetCutPriorities} />
        ) : (
          <div
            style={{
              padding: "1.5rem",
              borderRadius: "8px",
              background: "var(--card-bg, #121215)",
              border: "1px solid var(--border-color, #27272a)",
              textAlign: "center",
              color: "#10b981",
              fontSize: "0.85rem",
            }}
          >
            🎉 Tidak ada pasangan negara x subdomain yang mengalami kerugian pada 3 hari terakhir!
          </div>
        )}
      </div>
    </div>
  );
}
