import { withAdTax } from "./adTax.js";

// Total bisnis per SYNC untuk hari berjalan — dipakai dua grafik teratas tab Grafik (Pendapatan vs
// Pengeluaran vs Profit, Kurva ROI) saat periodenya "Hari Ini". Satu titik per stempel waktu, bukan
// per hari: yang dicari orang di grafik hari ini adalah bagaimana angkanya bergerak sepanjang hari,
// sama seperti dua grafik per subdomain di bawahnya.
//
// Tiap baris snapshot KUMULATIF sejak tengah malam (lihat roiRealtime.js), jadi penjumlahannya hanya
// LINTAS SUBDOMAIN pada stempel yang sama (dua subdomain berbeda, sync yang sama) — tidak pernah
// lintas stempel. "Total hari ini" adalah titik TERAKHIR, bukan jumlah seluruh titik; itu ditangani
// LineChart, yang membaca last point saat hourly.
//
// Earning/spend yang tidak diketahui dilewati, bukan dihitung nol — aturan yang sama dengan
// aggregateRoiFinancials di Overview.
export function hourlyFinancials(rows, rate) {
  const byStamp = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const date = String(row?.date || "").slice(0, 10);
    const time = String(row?.time || "");
    const stamp = `${date} ${time}`.trim();
    if (!stamp) continue;

    const money = withAdTax(row, rate);
    const point = byStamp.get(stamp) || { stamp, date, time, grossRevenue: 0, totalSpend: 0 };
    if (money.earningKnown) point.grossRevenue += money.earning;
    if (money.spendingKnown) point.totalSpend += money.totalSpending;
    byStamp.set(stamp, point);
  }

  return [...byStamp.values()].sort((a, b) => a.stamp.localeCompare(b.stamp));
}
