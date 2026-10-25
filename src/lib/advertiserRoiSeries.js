import { roiPercent, withAdTax } from "./adTax.js";
import { cellText } from "./cellText.js";

// Deret ROI per ADVERTISER untuk tab Grafik di Overview — satu titik per HARI per advertiser.
//
// Sumbernya `roiReports` (baris harian, satu per hari per subdomain), BUKAN baris per sync: baris
// snapshot kumulatif sejak tengah malam, dan yang menjumlahkannya per hari melipatgandakan
// pendapatan. Baris harian boleh dijumlahkan lintas subdomain apa adanya.
//
// Sisi yang tidak diketahui dilewati, sepola `aggregateRoiFinancials`: earning yang gagal datang
// tidak menyumbang nol. Yang dipakai `earningKnown`/`spendingKnown`, BUKAN `roi !== ""` — ROI kosong
// juga untuk subdomain di bawah lantai belanja, padahal uangnya nyata dan harus ikut total
// pemiliknya. ROI-nya dihitung ulang dari jumlah uang lewat `roiPercent` (lantai yang sama), bukan
// dirata-rata dari ROI subdomain.
//
// Bentuk titiknya sama dengan `subDomainRoiSeries` (`stamp`, `multiDay`, `{key}__spend`), supaya
// komponen kurvanya satu.

export const NO_PIC_LABEL = "(tanpa PIC)";

const seriesKey = (index) => `a${index}`;

/**
 * @param rows baris harian roiReports yang sudah disaring periode + pemilik
 * @param rate tarif ad tax
 * @param picOf (namaSubdomain, picBaris) -> nama advertiser; lihat `subDomainOwnerIndex`
 */
export function advertiserRoiSeries(rows, rate, picOf = (_, pic) => cellText(pic)) {
  // advertiser -> tanggal -> total
  const byAdvertiser = new Map();

  for (const row of Array.isArray(rows) ? rows : []) {
    const name = cellText(row?.subDomain);
    const date = String(row?.date || "").slice(0, 10);
    if (!name || !date) continue;

    const money = withAdTax(row, rate);
    if (!money.earningKnown && !money.spendingKnown) continue;

    const advertiser = picOf(name, row?.pic) || NO_PIC_LABEL;
    const days = byAdvertiser.get(advertiser) || new Map();
    const total = days.get(date) || { earning: 0, spend: 0, earningSeen: false, spendSeen: false };
    if (money.earningKnown) {
      total.earning += money.earning;
      total.earningSeen = true;
    }
    // Ditambahkan apa adanya, "" akan mengubah totalnya jadi teks ("0" + 100 = "0100").
    if (money.spendingKnown) {
      total.spend += money.totalSpending;
      total.spendSeen = true;
    }
    days.set(date, total);
    byAdvertiser.set(advertiser, days);
  }

  const names = [...byAdvertiser.keys()].sort((a, b) => {
    // "(tanpa PIC)" di ujung: ia bukan nama orang, dan berdiri di antara nama-nama akan dibaca
    // sebagai salah satunya.
    if (a === NO_PIC_LABEL) return 1;
    if (b === NO_PIC_LABEL) return -1;
    return a.localeCompare(b);
  });
  const series = names.map((name, index) => ({ key: seriesKey(index), name, label: name }));

  const dates = [...new Set(names.flatMap((name) => [...byAdvertiser.get(name).keys()]))].sort();
  const points = dates.map((date) => {
    // `multiDay: true` dan `time` kosong: sumbu dan tooltip lalu menyebut tanggalnya saja.
    const point = { stamp: date, date, time: "", multiDay: true };

    for (const item of series) {
      const total = byAdvertiser.get(item.name).get(date);
      const roi =
        total?.earningSeen && total.spendSeen ? roiPercent(total.earning, total.spend) : "";
      // `null`, bukan 0: hari tanpa ROI sah memutus garisnya, bukan menariknya ke sumbu.
      point[item.key] = roi === "" ? null : roi;
      point[`${item.key}__spend`] = roi === "" ? null : total.spend;
      point[`${item.key}__earning`] = roi === "" ? null : total.earning;
    }

    return point;
  });

  // Advertiser yang tidak pernah punya ROI sah sepanjang periode tidak digambar sebagai chip yang
  // menyala tanpa garis.
  const drawn = series.filter((item) => points.some((point) => point[item.key] !== null));

  return { series: drawn, points };
}
