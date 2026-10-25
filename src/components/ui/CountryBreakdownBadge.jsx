import { Fragment } from "react";
import { formatRoiPercent } from "../../lib/adTax";
import { summarizeCountryRoi } from "../../lib/countryRoi";
import { renderCell } from "../../lib/renderCell";
import { CellPopover } from "./CellPopover";

// Kolom "Negara" pada tabel ROI Overview: satu baris ROI adalah satu subdomain pada satu hari, dan
// uangnya datang dari beberapa negara sekaligus. Negara dengan spend terbesar disebut di selnya,
// sisanya di panel — ROI subdomain yang sehat rutin menyembunyikan satu negara yang rugi besar,
// dan itu tidak akan pernah terbaca dari kolom ROI yang menjumlahkan semuanya.
//
// Sumbernya laporan GAM `SITE × COUNTRY_CODE × COUNTRY_NAME` yang dijodohkan dengan spend Meta
// `breakdowns=country` — sama persis dengan panel "ROI per Negara" di Profile User.
export function CountryBreakdownBadge({ rows, subDomain }) {
  if (rows.length === 0) {
    // "-" saja tidak bisa dibedakan dari "negaranya memang tidak ada", dan ketiga sebabnya bisa
    // diperbaiki orang yang sedang menatap barisnya — jadi ketiganya disebut, bukan didiamkan.
    return (
      <span
        className="muted-cell"
        title={
          "Belum ada rincian negara untuk baris ini. Rincian negara hanya ditulis Sync ROI untuk hari data terakhir (hari-hari sebelumnya tidak menyimpannya), hanya untuk subdomain yang punya PIC, dan hanya kalau laporan negara GAM diterima network-nya — kegagalannya ada di ikon peringatan pada topbar."
        }
      >
        -
      </span>
    );
  }

  const summary = summarizeCountryRoi(rows);
  const [top] = rows;

  return (
    <>
      <strong title={top.countryLabel}>{top.countryLabel}</strong>
      <CellPopover
        badgeClassName="country-breakdown-badge"
        label={`${rows.length} negara`}
        panelClassName="country-breakdown-panel"
        width={356}
      >
        <strong>
          {rows.length} negara → {subDomain}
        </strong>
        <span className="country-breakdown-grid">
          <span className="head">Negara</span>
          <span className="head num">Total Spend</span>
          <span className="head num">Earning</span>
          <span className="head num">ROI</span>
          {rows.map((row) => (
            <Fragment key={row.id}>
              <span className="name" title={row.countryLabel}>
                {row.countryLabel}
              </span>
              <span className="num">{renderCell(row.totalSpending, "totalSpending")}</span>
              {/* Earning yang tidak diketahui bukan nol: laporan GAM yang gagal datang tanpa
                  earning, dan 0 di sini akan tampil sebagai "ROI −100%" untuk negara yang
                  sebenarnya menghasilkan. */}
              <span className="num">
                {row.earningKnown ? renderCell(row.earning, "earning") : "-"}
              </span>
              <span className="num">{formatRoiPercent(row.roi)}</span>
            </Fragment>
          ))}
          <span className="name total">Total</span>
          <span className="num total">{renderCell(summary.totalSpending, "totalSpending")}</span>
          <span className="num total">{renderCell(summary.earning, "earning")}</span>
          <span className="num total">{formatRoiPercent(summary.roi)}</span>
        </span>
        {summary.unknown ? (
          <em>
            {summary.unknown} negara belum ada earning-nya — totalnya kurang dari yang sebenarnya.
          </em>
        ) : null}
      </CellPopover>
    </>
  );
}
