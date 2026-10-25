import { AlertCircle, CheckCircle2, FileUp, Loader2, UploadCloud, X } from "lucide-react";
import { useEffect, useState } from "react";
import { supabase } from "../../config/supabase";
import { processKeitaroCsv } from "../../lib/keitaroCsvParser";
import { notifyError, notifySuccess } from "../../lib/notify";
import { Dialog } from "../ui/Dialog";

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
        const result = processKeitaroCsv(text, sites);
        setParseResult(result);
      }
      setParsing(false);
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
    <Dialog className="confirm-dialog campaign-dialog keitaro-import-dialog" onClose={onClose}>
      <div className="dialog-header flex items-center justify-between border-b pb-3">
        <div className="flex items-center gap-2">
          <UploadCloud className="text-blue-500" size={22} />
          <h2 className="text-lg font-bold">Impor CSV Laporan Keitaro</h2>
        </div>
        <button
          type="button"
          className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          onClick={onClose}
          aria-label="Tutup"
        >
          <X size={20} />
        </button>
      </div>

      <div className="dialog-body py-4 space-y-4">
        {/* Drop zone */}
        <div
          className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
            dragOver
              ? "border-blue-500 bg-blue-50 dark:bg-blue-950/20"
              : "border-gray-300 dark:border-gray-700 hover:border-blue-400"
          }`}
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
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleFileChange(e.target.files[0])}
          />
          <FileUp className="mx-auto mb-2 text-gray-400" size={36} />
          <p className="font-medium text-sm">
            {file ? file.name : "Klik atau seret file CSV laporan Keitaro ke sini"}
          </p>
          <p className="text-xs text-gray-500 mt-1">
            Mendukung pemisah koma (,), titik koma (;), atau tab. Format kolom: Date, Campaign / Sub ID, Clicks, Spend, Revenue.
          </p>
        </div>

        {parsing && (
          <div className="flex items-center justify-center gap-2 py-4 text-blue-600">
            <Loader2 className="animate-spin" size={18} />
            <span className="text-sm">Memproses dan memvalidasi file CSV...</span>
          </div>
        )}

        {/* Hasil Analisis */}
        {parseResult && (
          <div className="space-y-4">
            {parseResult.error && (
              <div className="p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-md flex items-start gap-2 text-red-700 dark:text-red-300 text-sm">
                <AlertCircle size={18} className="shrink-0 mt-0.5" />
                <span>{parseResult.error}</span>
              </div>
            )}

            {summary && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                <div className="p-2.5 rounded bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
                  <div className="text-gray-500">Baris Valid</div>
                  <div className="text-base font-bold text-green-600 dark:text-green-400">
                    {summary.validAggregatedRows} hari-situs
                  </div>
                </div>
                <div className="p-2.5 rounded bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
                  <div className="text-gray-500">Total Klik</div>
                  <div className="text-base font-bold">{summary.totalClicks.toLocaleString()}</div>
                </div>
                <div className="p-2.5 rounded bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
                  <div className="text-gray-500">Total Biaya (Spend)</div>
                  <div className="text-base font-bold text-red-600 dark:text-red-400">
                    ${summary.totalSpend.toFixed(2)}
                  </div>
                </div>
                <div className="p-2.5 rounded bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
                  <div className="text-gray-500">Total Pendapatan</div>
                  <div className="text-base font-bold text-blue-600 dark:text-blue-400">
                    ${summary.totalRevenue.toFixed(2)}
                  </div>
                </div>
              </div>
            )}

            {/* Peringatan baris tidak cocok */}
            {parseResult.unmatched?.length > 0 && (
              <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md text-amber-800 dark:text-amber-200 text-xs">
                <p className="font-semibold flex items-center gap-1.5 mb-1">
                  <AlertCircle size={15} />
                  {parseResult.unmatched.length} baris tidak dapat dicocokkan ke site_code:
                </p>
                <ul className="list-disc list-inside max-h-24 overflow-y-auto space-y-0.5 text-[11px] text-amber-700 dark:text-amber-300">
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

            {/* Pratinjau Tabel Menggunakan Grid Div (Design System) */}
            {parseResult.dailyStats?.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold uppercase text-gray-500 mb-2">
                  Pratinjau Data (Sumber: 'keitaro'):
                </h3>
                <div className="max-h-48 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-md text-xs">
                  <div className="bg-gray-100 dark:bg-gray-800 sticky top-0 grid grid-cols-6 p-2 font-semibold border-b border-gray-200 dark:border-gray-700">
                    <div>Tanggal</div>
                    <div>Site Code</div>
                    <div className="text-right">Klik</div>
                    <div className="text-right">Spend</div>
                    <div className="text-right">Revenue</div>
                    <div className="text-right">ROI</div>
                  </div>
                  <div className="divide-y divide-gray-200 dark:divide-gray-800">
                    {parseResult.dailyStats.slice(0, 10).map((row, idx) => (
                      <div key={idx} className="grid grid-cols-6 p-2 hover:bg-gray-50 dark:hover:bg-gray-800/40">
                        <div className="font-mono">{row.date}</div>
                        <div className="font-semibold text-blue-600 dark:text-blue-400">
                          {row.site_code}
                        </div>
                        <div className="text-right">{row.clicks.toLocaleString()}</div>
                        <div className="text-right text-red-500">${row.spend.toFixed(2)}</div>
                        <div className="text-right text-green-500">${row.revenue.toFixed(2)}</div>
                        <div className="text-right font-medium">{row.roi_percent}%</div>
                      </div>
                    ))}
                  </div>
                </div>
                {parseResult.dailyStats.length > 10 && (
                  <p className="text-[11px] text-gray-400 mt-1 text-right">
                    Menampilkan 10 dari {parseResult.dailyStats.length} baris agregasi
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="dialog-footer flex items-center justify-end gap-2 border-t pt-3">
        <button
          type="button"
          className="px-4 py-2 text-sm rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800"
          onClick={onClose}
          disabled={uploading}
        >
          Batal
        </button>
        <button
          type="button"
          className="px-4 py-2 text-sm rounded bg-blue-600 hover:bg-blue-700 text-white font-medium flex items-center gap-1.5 disabled:opacity-50"
          onClick={handleSaveToDatabase}
          disabled={uploading || !parseResult?.dailyStats?.length}
        >
          {uploading ? (
            <>
              <Loader2 className="animate-spin" size={16} />
              <span>Menyimpan ke Supabase...</span>
            </>
          ) : (
            <>
              <CheckCircle2 size={16} />
              <span>Simpan ke Database ({parseResult?.dailyStats?.length || 0})</span>
            </>
          )}
        </button>
      </div>
    </Dialog>
  );
}
