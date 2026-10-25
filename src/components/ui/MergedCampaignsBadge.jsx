import { renderCell } from "../../lib/renderCell";
import { CellPopover } from "./CellPopover";

// Satu baris tabel ROI adalah satu subdomain, dan spend beberapa campaign Meta menumpuk di sana —
// itu yang diakui badge "Campaign digabung" tanpa pernah menyebut campaign mana. Hover (atau fokus
// keyboard, atau tap) membuka rinciannya.
//
// Dipakai tabel ROI Overview dan tabel "Report Master Realtime ROI" di Profile User. Keduanya
// membaca baris yang sama dari dashboard/roiReports, jadi keduanya punya rincian yang sama untuk
// ditampilkan — di Profile User badge-nya dulu cuma label statis yang tidak menyebut apa-apa.
export function MergedCampaignsBadge({ campaigns, spend, subDomain }) {
  const total = campaigns.reduce((sum, entry) => sum + Number(entry.spend || 0), 0);

  return (
    <CellPopover
      badgeClassName="merged-campaigns-badge"
      label={`Campaign digabung${campaigns.length ? ` (${campaigns.length})` : ""}`}
    >
      {campaigns.length > 0 ? (
        <>
          <strong>
            {campaigns.length} campaign → {subDomain}
          </strong>
          {campaigns.map((entry) => (
            <span className="cell-popover-row" key={entry.name}>
              <span title={entry.name}>{entry.name}</span>
              {renderCell(entry.spend, "spending")}
            </span>
          ))}
          <span className="cell-popover-row total">
            <span>Total</span>
            {renderCell(total, "spending")}
          </span>
        </>
      ) : (
        <em>
          {/* Spend yang tidak diketahui datang sebagai "" dari withAdTax; "-" adalah bentuk
              yang sama dari baris lama. Nol BUKAN salah satunya: campaign yang hari itu tidak
              membelanjakan apa pun tetap campaign yang terpetakan. */}
          {spend === "" || spend === "-" || spend === null || spend === undefined
            ? "Belum ada campaign Meta yang terpetakan ke subdomain ini, jadi Spending dan ROI-nya kosong. Daftarkan Kode Campaign-nya lewat /sub-domains → Edit."
            : "Baris ini ditulis sync versi lama yang belum menyimpan rincian campaign. Jalankan sync subdomain sekali lagi."}
        </em>
      )}
    </CellPopover>
  );
}
