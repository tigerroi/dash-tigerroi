// Ekstensi ditulis penuh supaya modul ini bisa dijalankan node --test apa adanya (lihat
// countryRoi.test.mjs); Vite menerima keduanya.
import { roiPercent, withAdTax } from "./adTax.js";
import { round } from "./numbers.js";
import { toAmount } from "./toAmount.js";

// Baris tabel "ROI per Negara": GAM (earning) di satu sisi, Meta Ads (spending) di sisi lain,
// dengan ad tax di antaranya. Formulanya sendiri tinggal di adTax.js — dipakai tabel ini dan
// tabel ROI subdomain, dan dua tabel yang menghitung uang yang sama tidak boleh punya dua rumus.

export function normalizeCountryRoiRow(item, rate) {
  return {
    ...item,
    countryLabel: `${item?.country || "-"}${item?.isoCode ? ` (${item.isoCode})` : ""}`,
    ...withAdTax(item, rate),
  };
}

// CTR sebagai persen. Bukan `formatRoiPercent`: yang itu menempelkan "+" di depan angka positif,
// dan CTR selalu positif — "+20,00%" terbaca sebagai kenaikan, bukan sebagai besaran.
export function formatCtrPercent(value) {
  if (!isNumber(value)) return "-";
  return `${Number(value).toFixed(2)}%`;
}

// Ringkasan satu subdomain. ROI-nya dihitung dari totalnya, bukan dirata-ratakan dari ROI tiap
// negara: negara dengan spend Rp 10.000 dan negara dengan spend Rp 10 tidak sama beratnya, dan
// merata-ratakan persentasenya membuat yang kecil menenggelamkan yang besar.
//
// Alasan yang sama berlaku untuk CPC dan eCPM-nya, dan di sana taruhannya lebih besar: negara
// dengan 5 klik dan negara dengan 50.000 klik akan sama beratnya kalau CPC-nya dirata-ratakan,
// padahal yang kedua itulah CPC subdomain ini.
export function summarizeCountryRoi(rows) {
  const totals = { spending: 0, adTax: 0, totalSpending: 0, earning: 0 };
  // Negara yang earning-nya tidak diketahui (laporan GAM gagal) ikut dihitung nol di total —
  // tidak ada angka lain yang bisa dipakai. Jumlahnya dibawa keluar supaya ringkasannya bisa
  // mengatakan totalnya belum utuh, alih-alih menampilkan angka kurang sebagai angka penuh.
  let unknown = 0;
  // Impresi dan klik dijumlahkan hanya dari baris yang benar-benar membawanya. Baris yang tidak
  // membawa metriknya tidak boleh ikut jadi nol di pembagi: eCPM sesubdomain yang dibagi impresi
  // separuh armada adalah angka yang tidak menggambarkan apa pun.
  let impressions = null;
  let clicks = null;

  for (const row of rows || []) {
    totals.spending += toAmount(row?.spending);
    totals.adTax += toAmount(row?.adTax);
    totals.totalSpending += toAmount(row?.totalSpending);
    totals.earning += toAmount(row?.earning);
    if (row && row.earningKnown === false) unknown++;
    if (isNumber(row?.impressions)) impressions = (impressions || 0) + Number(row.impressions);
    if (isNumber(row?.clicks)) clicks = (clicks || 0) + Number(row.clicks);
  }

  return {
    ...totals,
    unknown,
    impressions,
    clicks,
    // Pembagi nol -> 0 (angkanya memang nol); pembagi yang tidak dilaporkan -> null, dan panelnya
    // menampilkan "-". Sepola dengan countryTraffic di sisi sync.
    ctr: impressions ? round((Number(clicks || 0) / impressions) * 100) : nullOrZero(impressions),
    cpc: clicks ? round(totals.earning / clicks) : nullOrZero(clicks),
    ecpm: impressions ? round((totals.earning / impressions) * 1000) : nullOrZero(impressions),
    // Lantai belanja yang sama dengan seluruh dashboard (`roiPercent`): negara yang menghabiskan
    // Rp 43 tidak melaporkan ROI enam angka, dan negara tanpa belanja sama sekali tidak melaporkan
    // "0%" untuk earning yang seluruhnya keuntungan.
    roi: roiPercent(totals.earning, totals.totalSpending),
  };
}

function nullOrZero(divisor) {
  return divisor === 0 ? 0 : null;
}

function isNumber(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}
