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
  const safeCampaigns = Array.isArray(campaigns) ? campaigns : [];
  const total = safeCampaigns.reduce((sum, entry) => sum + Number(entry?.spend || 0), 0);

  // Hitung akumulasi belanja per akun Whitelist (jika terdapat beberapa akun iklan)
  const accountSpendMap = new Map();
  for (const entry of safeCampaigns) {
    const acc = String(entry?.account || "").trim();
    if (acc) {
      accountSpendMap.set(acc, (accountSpendMap.get(acc) || 0) + Number(entry?.spend || 0));
    }
  }
  const accountEntries = Array.from(accountSpendMap.entries());

  return (
    <CellPopover
      badgeClassName="merged-campaigns-badge"
      label={`Campaign digabung${safeCampaigns.length ? ` (${safeCampaigns.length})` : ""}`}
    >
      {safeCampaigns.length > 0 ? (
        <>
          <strong>
            {safeCampaigns.length} campaign → {subDomain}
          </strong>

          {/* Jika terdapat lebih dari 1 akun WL yang membiayai subdomain ini */}
          {accountEntries.length > 1 && (
            <div className="cell-popover-account-summary">
              <span className="account-summary-title">Rincian per Akun Whitelist:</span>
              {accountEntries.map(([acc, sp]) => (
                <span className="cell-popover-row account-subtotal" key={acc}>
                  <span>🏷️ {acc}</span>
                  {renderCell(sp, "spending")}
                </span>
              ))}
            </div>
          )}

          {safeCampaigns.map((entry) => (
            <span className="cell-popover-row" key={entry.name}>
              <span title={entry.name}>
                {entry.account && (
                  <span className="account-badge-pill campaign-acc-tag">
                    {entry.account}
                  </span>
                )}
                {entry.name}
              </span>
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
