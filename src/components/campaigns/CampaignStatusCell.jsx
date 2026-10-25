import { campaignToggleState } from "../../lib/campaignCommands";
import { getCampaignTone } from "../../lib/campaignTone";
import { formatDateTime } from "../../lib/formatDate";

/**
 * Kolom Status: saklar on/off di sebelah label statusnya. Dipakai profil user DAN halaman Campaign.
 *
 * Ketiga labelnya sepakat dengan saklar — saklar On berbunyi "Aktif" atau "Terjadwal", saklar Off
 * berbunyi "Tidak aktif" — jadi yang ditambahkan pil di sebelah saklar tinggal satu hal, dan itu
 * hal yang tidak bisa ditunjukkan saklar dua posisi: campaign yang menyala tapi tayangnya belum
 * mulai. Keduanya tetap dibaca dari field yang berbeda (`configuredStatus` vs `status` yang ditulis
 * sisi sync), dan saklar tidak pernah membaca labelnya — lihat `campaignToggleState`.
 */
export function CampaignStatusCell({ item, command, canToggle, onToggle }) {
  const label = item.status || "Tidak diketahui";

  // Yang tidak berhak menekan tidak diberi tombol mati sama sekali, melainkan kolom Status seperti
  // sebelum fitur ini ada.
  if (!canToggle || !onToggle) {
    return <span className={`campaign-delivery-badge ${getCampaignTone(label)}`}>{label}</span>;
  }

  const state = campaignToggleState(item, command, { canToggle: true });
  const note = describeCampaignStatus(item, state);

  return (
    <div className="campaign-status-cell">
      <button
        aria-checked={state.on}
        aria-label={`${state.on ? "Matikan" : "Nyalakan"} campaign ${item.campaign}`}
        className={`campaign-switch${state.on ? " on" : ""}${state.pending ? " pending" : ""}`}
        disabled={state.disabled}
        onClick={() => onToggle?.(item, !state.on)}
        role="switch"
        title={state.reason || label}
        type="button"
      >
        <span className="campaign-switch-knob" />
      </button>
      <div className="campaign-status-text">
        <span className={`campaign-delivery-badge ${getCampaignTone(label)}`}>{label}</span>
        {note && <small className="muted-line">{note}</small>}
      </div>
    </div>
  );
}

function describeCampaignStatus(item, state) {
  if (state.pending || state.disabled) return state.reason;
  if (state.failed) return `Gagal: ${state.reason}`;
  // Label di sebelahnya berasal dari perintah tadi, bukan dari laporan Meta. Sampai sync berikutnya
  // membacanya ulang, keadaan yang sebenarnya bisa berbeda.
  if (item.statusAppliedAt) {
    return `Diubah dari sini ${formatDateTime(item.statusAppliedAt)}, status akhir menyusul saat sync.`;
  }
  // Pil "Terjadwal" yang tidak menyebut KAPAN cuma memindahkan pertanyaannya ke Ads Manager.
  if (item.status === "Terjadwal" && item.startTime) {
    return `Mulai tayang ${formatDateTime(item.startTime)}.`;
  }
  return "";
}
