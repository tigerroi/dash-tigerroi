import { Pencil } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { adSetAgeNote, adSetCache, adSetCacheKey } from "../lib/adSetCache";
import {
  adSetBudgetNote,
  adSetStatusNote,
  adSetSummary,
  adSetTargetingNote,
  adSetToggleState,
} from "../lib/adSets";
import { getCampaignTone } from "../lib/campaignTone";
import { CONTROL_API_ENABLED, fetchCampaignAdSets, setAdSetStatusNow } from "../lib/controlApi";
import { formatCtrPercent } from "../lib/countryRoi";
import { resultLabel } from "../lib/metaResults";
import { notifyError, notifySuccess } from "../lib/notify";
import { renderCell } from "../lib/renderCell";
import { DataTable } from "./ui/DataTable";
import { RefreshButton } from "./ui/RefreshButton";

/**
 * Isi satu campaign: ad set-nya, statusnya, dan angkanya hari ini.
 *
 * Dibaca LANGSUNG dari Meta saat barisnya dibuka, bukan dari `store` — dan itu satu-satunya panel
 * di halaman ini yang begitu. Sebabnya ukuran: satu ad account memuat ratusan ad set (960 di TBZ
 * 1247), jadi mencerminkannya ke RTDB tiap jam berarti belasan ribu baris ditulis ulang untuk
 * panel yang dibuka sesekali. Yang dicari orang di sini justru keadaan pada detik ini; cermin
 * sejam lalu adalah jawaban yang salah untuk pertanyaan "kenapa campaign ini tidak keluar uang".
 *
 * Yang MENAHAN pembacaan berulang adalah cermin dua menit di dalam tab ini sendiri
 * (`adSetCache`) — bukan RTDB, dan bukan localStorage. Umurnya disebutkan di kepala panel, dan
 * tombol Segarkan melewatinya.
 *
 * Konsekuensinya diketahui dan diterima: TANPA server kontrol panel ini tidak bisa dibuka sama
 * sekali — tidak ada antrean yang bisa menggantikannya, sepola /plugin. Yang digambar di sana
 * adalah sebabnya, bukan tabel kosong yang terbaca seperti campaign tanpa ad set.
 */
export function CampaignAdSets({ userId, campaignId, canToggle = false, onEdit }) {
  const cacheKey = adSetCacheKey(userId, campaignId);
  // Cermin dibaca saat komponen ini LAHIR, bukan di dalam efek: efek jalan setelah frame pertama
  // tergambar, jadi baris yang sudah pernah dibuka akan berkedip "Membaca ad set dari Meta…" untuk
  // angka yang sebenarnya sudah ada di tangan.
  const [state, setState] = useState(() => cachedState(cacheKey));
  const [refreshing, setRefreshing] = useState(false);
  // ID ad set yang perintahnya sedang di jalan. Satu saja: dua saklar yang ditekan bersamaan di
  // campaign yang sama akan saling menimpa hasil pembacaan ulangnya.
  const [pendingId, setPendingId] = useState("");
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (!CONTROL_API_ENABLED) return undefined;
    // Sudah digambar dari cermin oleh initializer di atas.
    if (adSetCache.peek(cacheKey)) return undefined;

    setState({ loading: true, error: "", data: null, at: 0 });
    adSetCache
      .read(cacheKey, () => fetchCampaignAdSets(userId, campaignId))
      .then((hit) => {
        if (alive.current) setState({ loading: false, error: "", data: hit.data, at: hit.at });
      })
      .catch((error) => {
        if (alive.current) setState({ loading: false, error: error.message, data: null, at: 0 });
      });

    return undefined;
  }, [cacheKey, userId, campaignId]);

  /**
   * Nyalakan/matikan satu ad set, lalu baca ulang.
   *
   * Dibaca ulang alih-alih ditambal di layar, dan itu bukan kehati-hatian berlebih: label statusnya
   * diputuskan sisi server (`mergeAdSetRows`), dan menambalnya di sini berarti menyalin keputusan
   * itu ke browser — dua tempat yang memutuskan hal yang sama akan berselisih suatu hari. Cerminnya
   * dibuang lebih dulu supaya pembacaan itu benar-benar ke Meta.
   */
  const toggle = async (row, next) => {
    setPendingId(row.id);
    try {
      await setAdSetStatusNow(userId, campaignId, row.id, next ? "ACTIVE" : "PAUSED");
      notifySuccess(next ? `${row.name} dinyalakan.` : `${row.name} dimatikan.`);
      adSetCache.invalidate(cacheKey);
      const hit = await adSetCache.read(cacheKey, () => fetchCampaignAdSets(userId, campaignId), {
        force: true,
      });
      if (alive.current) setState({ loading: false, error: "", data: hit.data, at: hit.at });
    } catch (error) {
      // Toast, bukan baris merah di panel: yang gagal adalah satu tindakan, bukan isi panelnya —
      // dan angka di bawahnya tetap benar.
      notifyError(error, `Status ${row.name} gagal diubah.`);
    } finally {
      if (alive.current) setPendingId("");
    }
  };

  const refresh = () => {
    setRefreshing(true);
    adSetCache
      .read(cacheKey, () => fetchCampaignAdSets(userId, campaignId), { force: true })
      .then((hit) => {
        if (alive.current) setState({ loading: false, error: "", data: hit.data, at: hit.at });
      })
      .catch((error) => {
        // Angka lama TETAP digambar: yang gagal adalah penyegarannya, dan mengosongkan panel
        // karenanya membuang angka yang masih bisa dibaca. Umur di kepala panel yang menyebutkan
        // seberapa basi ia sekarang.
        if (alive.current) setState((current) => ({ ...current, error: error.message }));
      })
      .finally(() => {
        if (alive.current) setRefreshing(false);
      });
  };

  // Jam untuk KETERANGAN UMUR saja, dan cuma saat ada angka yang umurnya perlu disebut. Sepola
  // `useTick` di SyncIssuesAlert.jsx: 30 detik, bukan sedetik — kalimatnya berubah per menit, dan
  // yang lebih rapat cuma merender ulang tabel untuk teks yang sama.
  const now = useTick(Boolean(state.data));
  const ageMs = state.at ? now - state.at : 0;

  if (!CONTROL_API_ENABLED) {
    return (
      <p className="adset-note">
        Server kontrol belum dikonfigurasi, jadi ad set tidak bisa dibaca dari sini.
      </p>
    );
  }

  if (state.loading) {
    return <p className="adset-note">Membaca ad set dari Meta…</p>;
  }

  if (state.error && !state.data) {
    return <p className="adset-note danger">Gagal membaca ad set: {state.error}</p>;
  }

  const rows = state.data?.adSets || [];
  const summary = adSetSummary(rows);

  const columns = [
    {
      accessorKey: "name",
      header: "Ad set",
      cell: ({ row }) => (
        <>
          <strong title={row.original.name}>{row.original.name}</strong>
          {/* Sasarannya dan tujuan optimasinya: dua hal yang membedakan ad set satu dari ad set
              lain di campaign yang sama, dan tidak ada di tingkat campaign. */}
          <small className="muted-line">
            {[adSetTargetingNote(row.original), row.original.optimizationGoal]
              .filter(Boolean)
              .join(" · ") || "-"}
          </small>
        </>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => (
        <AdSetStatusCell
          onToggle={toggle}
          pending={pendingId === row.original.id}
          canToggle={canToggle}
          row={row.original}
        />
      ),
    },
    {
      accessorKey: "dailyBudget",
      header: "Anggaran",
      cell: ({ row }) => (
        <>
          {renderCell(row.original.dailyBudget, "dailyBudget")}
          <small className="muted-line">{adSetBudgetNote(row.original)}</small>
        </>
      ),
      meta: { align: "right" },
    },
    {
      accessorKey: "spend",
      header: "Spend",
      cell: ({ row }) => renderCell(row.original.spend, "spend"),
      meta: { align: "right" },
    },
    {
      accessorKey: "results",
      header: "Hasil",
      cell: ({ row }) => (
        <>
          {formatCount(row.original.results)}
          {row.original.resultType ? (
            <em className="cell-note muted">{resultLabel(row.original.resultType)}</em>
          ) : null}
        </>
      ),
      meta: { align: "center" },
    },
    {
      accessorKey: "costPerResult",
      header: "Biaya/hasil",
      cell: ({ row }) => renderCell(row.original.costPerResult, "costPerResult"),
      meta: { align: "right" },
    },
    {
      accessorKey: "impressions",
      header: "Impresi",
      cell: ({ row }) => formatCount(row.original.impressions),
      meta: { align: "right" },
    },
    {
      accessorKey: "clicks",
      header: "Klik",
      cell: ({ row }) => formatCount(row.original.clicks),
      meta: { align: "right" },
    },
    {
      accessorKey: "ctr",
      header: "CTR",
      cell: ({ row }) => formatCtrPercent(row.original.ctr),
      meta: { align: "right" },
    },
    // Hanya di halaman Campaign (superadmin). Profil user tidak mengoper `onEdit`, jadi kolomnya
    // tidak ada di sana sama sekali.
    ...(onEdit
      ? [
          {
            id: "actions",
            header: "Aksi",
            enableSorting: false,
            cell: ({ row }) => (
              <button
                className="ghost-button adset-edit"
                onClick={() => onEdit(row.original)}
                type="button"
              >
                <Pencil size={13} />
                Ubah
              </button>
            ),
            meta: { align: "right" },
          },
        ]
      : []),
  ];

  return (
    <div className="adset-panel">
      <div className="adset-panel-head">
        <strong>Ad set</strong>
        <span>
          {rows.length ? (
            <>
              {summary.total} ad set · {summary.active} saklar On
              {/* "Yang aktif 5, tiga tayang dan dua tidak" — pertanyaan yang dibawa orang ke panel
                  ini, dijawab tanpa harus membaca kesepuluh pilnya satu per satu. */}
              {summary.notDelivering > 0 && (
                <span className="adset-warning"> · {summary.notDelivering} tidak ditayangkan</span>
              )}
              {/* Belanjanya cuma disebut kalau ADA angkanya: "· Rp 0 hari ini" untuk laporan yang
                  gagal adalah dua kebohongan dalam satu baris. */}
              {summary.spend === "" ? null : <> · {renderCell(summary.spend, "spend")} hari ini</>}
            </>
          ) : (
            "Campaign ini tidak punya ad set di Meta."
          )}
        </span>
        {/* Umurnya disebut justru KARENA ada cerminnya: angka yang digambar dari pembacaan dua menit
            lalu tidak bisa dibedakan dari yang baru saja diambil, dan panel ini menjanjikan keadaan
            sekarang. */}
        <small className="adset-age">Dibaca {adSetAgeNote(ageMs)}</small>
        <RefreshButton
          busy={refreshing}
          className="adset-refresh"
          onClick={refresh}
          size={12}
          title="Baca ulang ke Meta, tanpa menunggu cermin dua menitnya kedaluwarsa"
        />
      </div>

      {/* Penyegaran yang gagal, sementara angka di bawahnya masih dari pembacaan sebelumnya. */}
      {state.error && <p className="adset-note danger">Gagal menyegarkan: {state.error}</p>}

      {/* Daftar ad set-nya sudah di tangan; yang gagal cuma angkanya. Disebutkan alih-alih
          digambar Rp 0 — nol di sana tak terbedakan dari ad set yang memang tidak tayang. */}
      {state.data?.metricsKnown === false && (
        <p className="adset-note danger">
          Angka hari ini tidak terbaca: {state.data.metricsError || "laporan Meta gagal diambil"}
        </p>
      )}

      {rows.length > 0 && <DataTable className="adset-table" columns={columns} items={rows} />}
    </div>
  );
}

/**
 * Kolom Status satu ad set: saklarnya, pilnya, dan sebabnya.
 *
 * Bentuknya sengaja sama dengan `CampaignStatusCell` di campaigns/CampaignStatusCell.jsx — kelas CSS yang sama, arah
 * yang sama, dan penolakan yang berbunyi sama — karena keduanya satu gerakan yang sama di dua
 * tingkat. Yang tidak berhak menekan tidak diberi saklar sama sekali (bukan saklar abu-abu berikut
 * kalimat penolakan di SETIAP baris), aturan yang sama dengan baris campaign.
 */
function AdSetStatusCell({ row, canToggle, pending, onToggle }) {
  const badge = (
    <span className={`campaign-delivery-badge ${getCampaignTone(row.status)}`}>
      {row.status || "Tidak diketahui"}
    </span>
  );
  const note = adSetStatusNote(row);
  const state = adSetToggleState(row, { canToggle, pending });

  if (!canToggle) {
    return (
      <>
        {badge}
        {note && <small className="muted-line">{note}</small>}
      </>
    );
  }

  return (
    <div className="campaign-status-cell">
      <button
        aria-checked={state.on}
        aria-label={`${state.on ? "Matikan" : "Nyalakan"} ad set ${row.name}`}
        className={`campaign-switch${state.on ? " on" : ""}${state.pending ? " pending" : ""}`}
        disabled={state.disabled}
        onClick={() => onToggle?.(row, !state.on)}
        role="switch"
        title={state.reason || row.status}
        type="button"
      >
        <span className="campaign-switch-knob" />
      </button>
      <div className="campaign-status-text">
        {badge}
        {/* Sebab tombolnya mati lebih mendesak daripada sebab ad set-nya tidak tayang: yang kedua
            tetap terbaca setelah yang pertama hilang. */}
        {(state.reason || note) && <small className="muted-line">{state.reason || note}</small>}
      </div>
    </div>
  );
}

// Isi awal panel: dari cermin kalau masih berlaku, kalau tidak "sedang membaca".
function cachedState(cacheKey) {
  const hit = CONTROL_API_ENABLED ? adSetCache.peek(cacheKey) : null;
  return hit
    ? { loading: false, error: "", data: hit.data, at: hit.at }
    : { loading: true, error: "", data: null, at: 0 };
}

function useTick(active) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [active]);

  return now;
}

// Angka cacah (impresi, klik, hasil). Kosong tetap "-", bukan 0: yang kosong di panel ini berarti
// laporannya tidak terbaca sama sekali, dan nol adalah pernyataan tentang iklan yang benar-benar
// tidak menghasilkan apa-apa.
function formatCount(value) {
  if (value === "" || value === null || value === undefined) return "-";
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString("id-ID") : "-";
}
