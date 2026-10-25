import { withAdTax } from "./adTax.js";
import { cellText } from "./cellText.js";

// Deret ROI per subdomain untuk dua grafik detail di Overview: kurva ROI tiap subdomain sepanjang
// hari, dan perbandingan ROI vs Total Spend pada sync terakhir.
//
// Sumbernya baris realtime yang sama dengan tabel "Laporan ROI Realtime" (`realtimeRoiRows`) —
// satu baris per SYNC per subdomain, kumulatif sejak tengah malam. Kumulatif itu justru yang
// dicari di sini: kurvanya membaca "ROI subdomain ini sampai pukul sekian", bukan ROI satu jam.
// Karena itu tidak ada satu pun penjumlahan lintas baris di file ini.
//
// Baris yang ROI-nya TIDAK diketahui dilewati, bukan digambar sebagai 0: `withAdTax` mengosongkan
// ROI saat earning atau spend-nya tidak ada, dan titik 0 pada kurva adalah klaim bahwa subdomain
// itu impas — tak terbedakan dari subdomain yang benar-benar impas.

// Kunci deret untuk recharts. Nama subdomain TIDAK boleh dipakai sebagai `dataKey`: titik di
// dalamnya dibaca recharts sebagai jalur objek, jadi "trends.rabbit.com" akan dicari sebagai
// point.trends.rabbit.com dan seluruh kurvanya kosong.
const seriesKey = (index) => `s${index}`;

// Nama pendek untuk chip dan sumbu: subdomain dibedakan oleh label paling kirinya, dan delapan
// nama panjang berdampingan tidak muat di satu baris legenda.
function shortSubDomainLabel(name) {
  const [first = ""] = String(name || "").split(".");
  return first || String(name || "");
}

function stampOf(row) {
  return `${String(row?.date || "").slice(0, 10)} ${String(row?.time || "")}`.trim();
}

/**
 * @param rows baris realtime (snapshot + harian), urutan bebas
 * @param rate tarif ad tax dari Settings, untuk baris yang belum membawa pajaknya sendiri
 */
export function subDomainRoiSeries(rows, rate) {
  const list = Array.isArray(rows) ? rows : [];
  // Satu entri per subdomain, dengan titik-titiknya. Map, bukan objek: nama subdomain adalah data
  // dari luar, dan `__proto__` sebagai kunci objek biasa bukan kunci sama sekali.
  const bySubDomain = new Map();

  for (const row of list) {
    const name = cellText(row?.subDomain);
    if (!name) continue;

    const money = withAdTax(row, rate);
    if (money.roi === "") continue;

    const stamp = stampOf(row);
    const entry = bySubDomain.get(name) || { name, points: new Map() };
    // Satu titik per stempel waktu. Dua baris dengan stempel sama untuk satu subdomain adalah
    // sync yang menulis dua kali; yang belakangan yang berlaku.
    entry.points.set(stamp, {
      stamp,
      date: String(row?.date || "").slice(0, 10),
      time: String(row?.time || ""),
      roi: money.roi,
      totalSpend: money.totalSpending,
      earning: money.earning,
      // Ikut dibawa karena tabel di bawah grafiknya mengurut dengannya. Baris yang sampai di sini
      // sudah lolos `money.roi === ""`, jadi earning dan belanjanya sama-sama diketahui dan
      // profitnya selalu angka — bukan `""` yang akan terurut sebagai teks.
      profit: money.profit,
      // PIC mentah baris itu; pemanggil menambalnya lewat `picOf` untuk kolom Advertiser.
      pic: cellText(row?.pic),
    });
    bySubDomain.set(name, entry);
  }

  const names = [...bySubDomain.keys()].sort((a, b) => a.localeCompare(b));
  const series = names.map((name, index) => ({
    key: seriesKey(index),
    name,
    label: shortSubDomainLabel(name),
  }));

  const stamps = [
    ...new Set(names.flatMap((name) => [...bySubDomain.get(name).points.keys()])),
  ].sort();
  // Sumbu X memuat jam saja selama seluruh titiknya jatuh di hari yang sama — itu bacaan yang
  // dicari orang saat periodenya "Hari Ini". Begitu rentangnya lebih dari sehari, tanggalnya ikut
  // disebut: "14:07" dua kali dalam satu sumbu adalah dua hari yang tidak bisa dibedakan.
  const days = new Set(stamps.map((stamp) => stamp.slice(0, 10)));
  const points = stamps.map((stamp) => {
    const point = {
      stamp,
      date: stamp.slice(0, 10),
      time: stamp.slice(11),
      multiDay: days.size > 1,
    };

    for (const item of series) {
      const found = bySubDomain.get(item.name).points.get(stamp);
      // `null`, bukan 0 dan bukan dibiarkan hilang: subdomain yang belum punya baris pada sync itu
      // memutus garisnya di sana, alih-alih menariknya turun ke sumbu.
      point[item.key] = found ? found.roi : null;
      point[`${item.key}__spend`] = found ? found.totalSpend : null;
      point[`${item.key}__earning`] = found ? found.earning : null;
    }

    return point;
  });

  // Batang perbandingan: titik TERAKHIR tiap subdomain, bukan titik pada stempel terakhir tabel.
  // Subdomain yang sync-nya tertinggal satu putaran tidak boleh hilang dari perbandingan; kapan
  // angkanya dibaca disebut per batang lewat `time`.
  const bars = series
    .map((item) => {
      const entryPoints = [...bySubDomain.get(item.name).points.values()].sort((a, b) =>
        a.stamp.localeCompare(b.stamp),
      );
      const last = entryPoints[entryPoints.length - 1];

      return last ? { ...item, ...last } : null;
    })
    .filter(Boolean);

  return {
    series,
    points,
    bars,
    latestStamp: stamps[stamps.length - 1] || "",
    multiDay: days.size > 1,
  };
}
