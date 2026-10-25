import { earningSources, withAdTax } from "./adTax.js";
import { countriesOf } from "./countryBreakdown.js";
import { firstValue } from "./firstValue.js";
import { toCampaignList } from "./toCampaignList.js";

// Baris tabel ROI per sync: "Laporan ROI Realtime" di Overview, dan "Report Master Realtime ROI"
// di /users/{uid} (yang sama, disaring ke subdomain yang dipegang user itu — lihat
// src/lib/userSubDomains.js).
//
// Dua sumber, karena satu baris ROI ditulis ke dua tempat dengan alasan yang berbeda:
//
//   dashboard/roiSnapshots  satu baris per SYNC (tanggal + jam + subdomain), ditulis untuk hari
//                           berjalan saja dan disimpan beberapa hari. Inilah isi tabel ini.
//                           Di /users/{uid} baris ini disaring lewat nama subdomainnya.
//   dashboard/roiReports    satu baris per HARI per subdomain, ditimpa tiap sync, disimpan 90 hari.
//                           Ia yang dijumlahkan grafik dan Targets — dan ia yang mengisi tabel ini
//                           untuk hari-hari yang snapshotnya sudah lewat masa simpan.
//
// Baris snapshot KUMULATIF sejak tengah malam: laporan GAM dan Meta selalu untuk hari penuh, bukan
// untuk satu jam. Menjumlahkan baris-baris satu hari di tabel ini karena itu melaporkan pendapatan
// berkali lipat — yang per jam hanya kolom "Fluk.", selisih terhadap sync sebelumnya. Yang
// menjumlahkan uang (grafik Overview, Targets, kartu ringkasan subdomain di /users/{uid}) karena
// itu membaca baris HARIAN, bukan hasil fungsi ini.

// Satu hari untuk satu subdomain. Kunci penjodohan snapshot ke baris harian yang digantikannya.
function dayScopeOf(row) {
  return `${String(row?.date || "").slice(0, 10)}__${firstValue(row?.subDomain) || ""}`;
}

// Hari + jam sebagai satu teks yang bisa diurutkan. Baris harian tidak punya jam yang berarti
// (jam sync terakhir hari itu), tapi ia tidak pernah berbagi hari dengan snapshot di sini.
function stampOf(row) {
  return `${String(row?.date || "").slice(0, 10)} ${String(row?.time || "")}`;
}

/**
 * Snapshot per sync, ditambah baris harian untuk hari-hari yang tidak punya snapshot.
 *
 * Baris harian hari yang SAMA dengan snapshot dibuang, bukan ditampilkan berdampingan: keduanya
 * angka yang sama untuk hari yang sama — baris harian adalah salinan sync terakhir — dan dua baris
 * kembar di satu tabel terbaca sebagai dua kejadian.
 *
 * Urut terbaru dulu, karena tabelnya dibaca sebagai catatan berjalan: yang dicari orang saat
 * membukanya adalah sync barusan, bukan sync pertama tiga hari lalu.
 */
export function realtimeRoiRows(snapshots, dailyRows) {
  const snaps = Array.isArray(snapshots) ? snapshots : [];
  const daily = Array.isArray(dailyRows) ? dailyRows : [];
  const covered = new Set(snaps.map(dayScopeOf));
  const rows = [...snaps, ...daily.filter((row) => !covered.has(dayScopeOf(row)))];

  return rows.sort((a, b) => stampOf(b).localeCompare(stampOf(a)));
}

/**
 * Satu baris tabel ROI realtime, apa adanya untuk dirender.
 *
 * SATU tempat untuk KEDUA tabel yang menggambarnya — "Laporan ROI Realtime" di Overview dan
 * "Report Master Realtime ROI Khusus Anda" di /users/{uid}. Keduanya dulu punya penormal sendiri,
 * dan keduanya sudah berbeda isinya: yang di profil user kehilangan Fluk. Spend/Earn/ROI, Profit,
 * rincian negara, dan META BAL. — enam kolom yang tidak berbunyi sebagai kesalahan di mana pun,
 * cuma sebagai tabel yang lebih pendek daripada tabel yang namanya menjanjikan hal yang sama.
 *
 * `date` sengaja dibiarkan ISO. Diformat di sini, kolom Date akan diurutkan sebagai teks —
 * "01 Sep" jatuh sebelum "09 Agu". Bentuk bacanya dipasang saat dirender.
 */
export function normalizeRealtimeRoiRow(item, rate, countryBreakdown) {
  // Kolom uangnya dari satu tempat yang sama dengan tabel ROI per Negara — dua tabel yang
  // menghitung uang yang sama tidak boleh punya dua rumus. Termasuk aturan "earning yang tidak
  // diketahui bukan nol": kolom Earning/ROI/Profit datang kosong dari sini, dan `earningKnown`
  // yang memberi tahu barisnya kenapa.
  const money = withAdTax(item, rate);
  const sources = earningSources(item);

  return {
    ...item,
    campaign: firstValue(item.campaign),
    metaSpend: money.spending,
    adTax: money.adTax,
    totalSpending: money.totalSpending,
    // Kenapa kolom META ADS-nya kosong. `spendingKnown` yang menentukan ADA/TIDAK-nya catatan,
    // `metaMissing` (ditulis sisi sync) yang menentukan bunyinya — bukan disimpulkan dari sel
    // yang kosong: "belum terpetakan" dan "gagal diambil" menuntut tindakan yang berbeda.
    spendingKnown: money.spendingKnown,
    metaMissing: item.metaMissing,
    profit: money.profit,
    roi: money.roi,
    flukSpend: firstValue(item.flukSpend, item.fluctuationSpend, item.spendFluctuation),
    gamRevenue: money.earning,
    earningKnown: money.earningKnown,
    // GAM = permintaan Ad Manager sendiri (Ad Exchange + direct-sold Ad Server); AdSense =
    // AdSense-in-GAM. Keduanya dijumlahkan persis menjadi kolom Total di sebelahnya, jadi tidak
    // ada uang yang jatuh di antara dua kolom.
    gamAds: sources.gam,
    adsenseAds: sources.adsense,
    // Mata uang asli network + kurs, supaya kolom earning menampilkan USD (patokan advertiser di
    // GAM) dengan IDR hasil konversi saat di-hover.
    currency: item.currency,
    fxRate: item.fxRate,
    flukEarn: firstValue(item.flukEarn, item.fluctuationEarn, item.earningFluctuation),
    subDomain: firstValue(item.subDomain),
    flukRoi: firstValue(item.flukRoi, item.roiFluctuation),
    clicks: firstValue(item.clicks),
    cpc: firstValue(item.cpc),
    // Satu kunci untuk kolom eCPM, dibaca dari dua nama yang pernah ditulis sisi sync. Dua tabel
    // yang memakai kunci berbeda (`pageRpm` di sini, `ecpm` di sana) berarti pengurutan kolomnya
    // membaca field yang tidak ada di salah satunya, dan kolomnya diam saja saat diklik.
    pageRpm: firstValue(item.pageRpm, item.ecpm),
    cpr: firstValue(item.cpr),
    metaBalance: firstValue(item.metaBalance, item.balance),
    campaigns: toCampaignList(item.campaigns),
    // Dijodohkan dari `item` yang mentah — tanggal ISO dan nama subdomain apa adanya, dua hal yang
    // dipakai sisi sync sebagai kunci saat menulis barisnya.
    countries: countriesOf(countryBreakdown, item),
  };
}

// Nama sumber earning untuk judul kelompok kolom, dari `source` baris yang sedang tampil.
// Baris yang tidak membawanya dihitung sebagai GAM — itulah satu-satunya laporan yang pernah
// mengisi kolom ini, dan "ADSENSE" yang dulu tertulis tetap di sana adalah nama yang salah untuk
// subdomain yang dimonetisasi lewat Google Ad Manager.
export function earningSourceLabel(rows) {
  const sources = [
    ...new Set((rows || []).map((row) => String(row?.source || "GAM").toUpperCase())),
  ];
  return sources.length ? sources.sort().join(" / ") : "GAM";
}

// Nada warna kolom: sisi Meta (merah), sisi earning (oranye), ROI (biru), fluktuasi (hijau).
export function realtimeRoiColumnTone(key) {
  if (["metaSpend", "adTax", "totalSpending", "cpr", "metaBalance"].includes(key)) {
    return "meta";
  }

  // Clicks/CPC/eCPM datang dari laporan earning-nya, bukan Meta — CPC di sini adalah earning per
  // klik.
  if (["gamAds", "adsenseAds", "gamRevenue", "clicks", "cpc", "pageRpm"].includes(key)) {
    return "gam";
  }

  if (["roi", "flukRoi"].includes(key)) {
    return "roi";
  }

  if (["flukSpend", "flukEarn"].includes(key)) {
    return "positive";
  }

  return "";
}
