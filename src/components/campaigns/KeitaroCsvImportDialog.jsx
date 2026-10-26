import { AlertCircle, CheckCircle2, FileUp, Loader2, UploadCloud, X } from "lucide-react";
import { useEffect, useState } from "react";
import { supabase } from "../../config/supabase";
import { processKeitaroCsv } from "../../lib/keitaroCsvParser";
import { notifyError, notifySuccess } from "../../lib/notify";
import { Dialog } from "../ui/Dialog";
import { SelectField } from "../ui/SelectField";

export function KeitaroCsvImportDialog({ isOpen, onClose, onImportSuccess }) {
  const [file, setFile] = useState(null);
  const [parsing, setParsing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [sites, setSites] = useState([]);
  const [parseResult, setParseResult] = useState(null);
  const [dragOver, setDragOver] = useState(false);

  // Ambil daftar situs dari Supabase untuk pencocokan site_code
  useEffect(() => {
    if (!isOpen) {
      setFile(null);
      setParseResult(null);
      return;
    }

    let isMounted = true;
    async function loadSites() {
      try {
        const { data, error } = await supabase
          .from("sites")
          .select("site_code, name, domain, campaign_pattern, is_active");
        if (!error && data && isMounted) {
          setSites(data);
        }
      } catch (err) {
        console.error("Gagal memuat tabel sites:", err);
      }
    }
    loadSites();
    return () => {
      isMounted = false;
    };
  }, [isOpen]);

  const [rawText, setRawText] = useState("");
  const [targetSite, setTargetSite] = useState("");
  const [targetDate, setTargetDate] = useState(() =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date()),
  );

  const fallbackSites = [
    { site_code: "ihop-menu", name: "IHOP Menu (ihopmenuwithprices.us)" },
    { site_code: "taco-fries", name: "Taco Bell Menu (tacobellmenuu.us)" },
    { site_code: "tiktok-mod", name: "TikTok Mod APK (tiktokmodapk.net)" },
    { site_code: "tray-decor", name: "Tray Edit (trayedit.com)" },
  ];

  const effectiveSites = sites.length > 0 ? sites : fallbackSites;

  // Re-parse saat file, targetSite, atau targetDate berubah
  const reparseCsv = (text, siteCode, dateStr) => {
    if (!text) return;
    setParsing(true);
    try {
      const result = processKeitaroCsv(text, effectiveSites, {
        defaultSiteCode: siteCode || undefined,
        defaultDate: dateStr || undefined,
      });
      setParseResult(result);
    } catch (err) {
      notifyError(`Gagal membaca berkas: ${err.message}`);
    } finally {
      setParsing(false);
    }
  };

  const handleFileChange = (selectedFile) => {
    if (!selectedFile) return;
    if (!selectedFile.name.endsWith(".csv") && !selectedFile.name.endsWith(".txt")) {
      notifyError("Format file harus berupa .csv");
      return;
    }

    setFile(selectedFile);
    setParsing(true);
    setParseResult(null);

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result;
      if (typeof text === "string") {
        setRawText(text);
        reparseCsv(text, targetSite, targetDate);
      }
    };
    reader.onerror = () => {
      notifyError("Gagal membaca berkas CSV");
      setParsing(false);
    };
    reader.readAsText(selectedFile);
  };

  const handleSaveToDatabase = async () => {
    if (!parseResult || !parseResult.dailyStats || parseResult.dailyStats.length === 0) {
      notifyError("Tidak ada baris valid yang dapat diimpor.");
      return;
    }

    setUploading(true);
    try {
      const { error } = await supabase
        .from("daily_stats")
        .upsert(parseResult.dailyStats, { onConflict: "date,site_code,source" });

      if (error) {
        throw new Error(error.message);
      }

      notifySuccess(
        `Berhasil mengimpor ${parseResult.dailyStats.length} baris data laporan Keitaro ke daily_stats!`
      );

      if (onImportSuccess) {
        onImportSuccess(parseResult.dailyStats);
      }
      onClose();
    } catch (err) {
      notifyError(`Gagal menyimpan: ${err.message}`);
    } finally {
      setUploading(false);
    }
  };

  if (!isOpen) return null;

  const summary = parseResult?.summary;

  return (
    <Dialog
      title="Impor CSV Laporan Keitaro"
      subtitle="Unggah berkas laporan klik dan performa tracker Keitaro ke TigerROI"
      className="confirm-dialog campaign-dialog keitaro-import-dialog"
      onClose={onClose}
      busy={uploading}
    >
      <div className="dialog-body" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {/* Drop zone */}
        <div
          className={`keitaro-dropzone ${dragOver ? "dragover" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (e.dataTransfer.files?.[0]) {
              handleFileChange(e.dataTransfer.files[0]);
            }
          }}
          onClick={() => document.getElementById("keitaro-csv-input")?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              document.getElementById("keitaro-csv-input")?.click();
            }
          }}
          role="button"
          tabIndex={0}
        >
          <input
            id="keitaro-csv-input"
            type="file"
            accept=".csv,.txt"
            style={{ display: "none" }}
            onChange={(e) => e.target.files?.[0] && handleFileChange(e.target.files[0])}
          />
          <FileUp size={36} style={{ margin: "0 auto 10px", color: "var(--muted-foreground)" }} />
          <p style={{ margin: "0 0 6px", fontWeight: 600, fontSize: "14px" }}>
            {file ? file.name : "Klik atau seret file CSV laporan Keitaro ke sini"}
          </p>
          <p style={{ margin: 0, fontSize: "12px", color: "var(--muted-foreground)" }}>
            Mendukung pemisah koma (,), titik koma (;), atau tab.
          </p>
        </div>

        {/* Opsi Penyesuaian Tanggal dan Situs Target */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", padding: "12px", background: "var(--muted)", borderRadius: "8px", border: "1px solid var(--border)" }}>
          <div>
            <label style={{ display: "block", fontWeight: 600, fontSize: "12px", marginBottom: "4px" }}>
              Tanggal Laporan (Opsi / Fallback):
            </label>
            <input
              type="date"
              style={{ width: "100%", padding: "7px 10px", borderRadius: "6px", border: "1px solid var(--border)", background: "var(--card)", color: "inherit", fontSize: "12px" }}
              value={targetDate}
              onChange={(e) => {
                setTargetDate(e.target.value);
                if (rawText) reparseCsv(rawText, targetSite, e.target.value);
              }}
            />
            <span style={{ fontSize: "10px", color: "var(--muted-foreground)" }}>
              Dipakai jika CSV tidak ada kolom tanggal (bawaan: hari ini).
            </span>
          </div>

          <div>
            <label style={{ display: "block", fontWeight: 600, fontSize: "12px", marginBottom: "4px" }}>
              Situs Target (Opsi / Fallback):
            </label>
            <SelectField
              id="keitaro-target-site"
              value={targetSite}
              onChange={(val) => {
                setTargetSite(val);
                if (rawText) reparseCsv(rawText, val, targetDate);
              }}
              options={[
                { value: "", label: "Otomatis dari CSV (Kolom Campaign / Sub ID)" },
                ...effectiveSites.map((s) => ({
                  value: s.site_code,
                  label: `${s.name || s.site_code} (${s.site_code})`,
                })),
              ]}
            />
            <span style={{ fontSize: "10px", color: "var(--muted-foreground)" }}>
              Pilih jika CSV ringkasan/global tanpa nama kampanye.
            </span>
          </div>
        </div>

        {parsing && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", padding: "16px", color: "#3b82f6" }}>
            <Loader2 className="animate-spin" size={18} />
            <span style={{ fontSize: "13px" }}>Memproses dan memvalidasi file CSV...</span>
          </div>
        )}

        {/* Hasil Analisis */}
        {parseResult && (
          <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            {parseResult.error && (
              <div style={{ padding: "10px 14px", background: "rgba(239, 68, 68, 0.1)", border: "1px solid rgba(239, 68, 68, 0.3)", borderRadius: "6px", color: "#ef4444", fontSize: "13px", display: "flex", alignItems: "center", gap: "8px" }}>
                <AlertCircle size={18} style={{ flexShrink: 0 }} />
                <span>{parseResult.error}</span>
              </div>
            )}

            {summary && (
              <div className="keitaro-stats-grid">
                <div className="keitaro-stat-card">
                  <div className="keitaro-stat-label">Baris Valid</div>
                  <div className="keitaro-stat-val" style={{ color: "#22c55e" }}>
                    {summary.validAggregatedRows} hari-situs
                  </div>
                </div>
                <div className="keitaro-stat-card">
                  <div className="keitaro-stat-label">Total Klik</div>
                  <div className="keitaro-stat-val">
                    {summary.totalClicks.toLocaleString()}
                  </div>
                </div>
                <div className="keitaro-stat-card">
                  <div className="keitaro-stat-label">Total Biaya (Spend)</div>
                  <div className="keitaro-stat-val" style={{ color: "#ef4444" }}>
                    ${summary.totalSpend.toFixed(2)}
                  </div>
                </div>
                <div className="keitaro-stat-card">
                  <div className="keitaro-stat-label">Total Pendapatan</div>
                  <div className="keitaro-stat-val" style={{ color: "#3b82f6" }}>
                    ${summary.totalRevenue.toFixed(2)}
                  </div>
                </div>
              </div>
            )}

            {/* Peringatan baris tidak cocok */}
            {parseResult.unmatched?.length > 0 && (
              <div style={{ padding: "10px 14px", background: "rgba(245, 158, 11, 0.1)", border: "1px solid rgba(245, 158, 11, 0.3)", borderRadius: "6px", color: "#f59e0b", fontSize: "12px" }}>
                <p style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: "6px", margin: "0 0 6px" }}>
                  <AlertCircle size={14} />
                  {parseResult.unmatched.length} baris tidak dapat dicocokkan ke site_code:
                </p>
                <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "11px", lineHeight: "1.5" }}>
                  {parseResult.unmatched.slice(0, 5).map((u, i) => (
                    <li key={i}>
                      Baris {u.rowNumber}: {u.candidates.join(" | ")}
                    </li>
                  ))}
                  {parseResult.unmatched.length > 5 && (
                    <li>... dan {parseResult.unmatched.length - 5} baris lainnya</li>
                  )}
                </ul>
              </div>
            )}

            {/* Pratinjau Tabel Menggunakan Semantic Table */}
            {parseResult.dailyStats?.length > 0 && (
              <div>
                <h3 style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase", color: "var(--muted-foreground)", margin: "0 0 8px" }}>
                  Pratinjau Data (Sumber: 'keitaro'):
                </h3>
                <div className="keitaro-table-scroll">
                  <table className="keitaro-table">
                    <thead>
                      <tr>
                        <th>Tanggal</th>
                        <th>Site Code</th>
                        <th style={{ textAlign: "right" }}>Klik</th>
                        <th style={{ textAlign: "right" }}>Spend</th>
                        <th style={{ textAlign: "right" }}>Revenue</th>
                        <th style={{ textAlign: "right" }}>ROI</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parseResult.dailyStats.slice(0, 15).map((row, idx) => (
                        <tr key={idx}>
                          <td style={{ fontFamily: "monospace" }}>{row.date}</td>
                          <td style={{ fontWeight: 600, color: "#3b82f6" }}>{row.site_code}</td>
                          <td style={{ textAlign: "right" }}>{row.clicks.toLocaleString()}</td>
                          <td style={{ textAlign: "right", color: "#ef4444" }}>${row.spend.toFixed(2)}</td>
                          <td style={{ textAlign: "right", color: "#22c55e" }}>${row.revenue.toFixed(2)}</td>
                          <td style={{ textAlign: "right", fontWeight: 600 }}>{row.roi_percent}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {parseResult.dailyStats.length > 15 && (
                  <p style={{ fontSize: "11px", color: "var(--muted-foreground)", marginTop: "4px", textAlign: "right" }}>
                    Menampilkan 15 dari {parseResult.dailyStats.length} baris agregasi
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="confirm-actions" style={{ marginTop: "16px", borderTop: "1px solid var(--border)", paddingTop: "12px" }}>
        <button
          type="button"
          className="secondary-button"
          onClick={onClose}
          disabled={uploading}
        >
          Batal
        </button>
        <button
          type="button"
          className="primary-button"
          onClick={handleSaveToDatabase}
          disabled={uploading || !parseResult?.dailyStats?.length}
        >
          {uploading ? (
            <>
              <Loader2 className="animate-spin" size={15} /> Menyimpan...
            </>
          ) : (
            <>
              <CheckCircle2 size={15} /> Simpan ke Database ({parseResult?.dailyStats?.length || 0})
            </>
          )}
        </button>
      </div>
    </Dialog>
  );
}
