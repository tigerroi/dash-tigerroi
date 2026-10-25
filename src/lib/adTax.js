import { hasAmount, round } from "./numbers.js";
import { toAmount } from "./toAmount.js";

// Ad tax: pajak iklan yang ditagih di atas Meta spend, dan pembagi setiap ROI di dashboard ini.
//
//   Spending       = Meta Spend
//   Ad Tax         = Spending × tarif
//   Total Spending = Spending + Ad Tax
//   ROI%           = (Earning − Total Spending) / Total Spending × 100
//
// Yang keluar dari kantong advertiser adalah spend berikut pajaknya, jadi ROI yang dibagi spend
// telanjang selalu terbaca lebih untung daripada keadaan sebenarnya — makin besar spend-nya,
// makin jauh selisihnya.
//
// Tarifnya diatur admin di halaman Settings (`settings/roi.adTaxPercent`, dalam persen karena itu
// yang diketik orang). Kembar dengan `adTaxRate()` di functions/sync-core.js: sisi sync menulis
// angkanya ke tiap baris, sisi ini menghitungnya untuk baris yang belum membawanya.
export const DEFAULT_AD_TAX_PERCENT = 5;

// Lantai belanja sebelum sebuah ROI berarti apa-apa, dalam rupiah. Lihat `roiPercent`.
export const MIN_ROI_SPEND = 1000;

export function adTaxRateOf(settings) {
  // Field yang dikosongkan bukan tarif 0 — `Number("")` adalah 0, dan menerimanya berarti satu
  // form yang tidak sengaja dikosongkan menghapus pajaknya dari seluruh dashboard tanpa suara.
  const stored = settings?.adTaxPercent;

  if (stored === "" || stored === null || stored === undefined) {
    return DEFAULT_AD_TAX_PERCENT / 100;
  }

  const percent = Number(stored);

  return Number.isFinite(percent) && percent >= 0 ? percent / 100 : DEFAULT_AD_TAX_PERCENT / 100;
}

/**
 * Kolom uang sebuah baris ROI: spending, ad tax, total spending, earning, dan ROI-nya.
 *
 * Angka yang sudah dibawa baris dipakai apa adanya, dan hanya yang tidak ada yang dihitung di
 * sini. Baris kemarin memuat pajak dengan tarif yang berlaku kemarin; menghitung ulang semuanya
 * dengan tarif hari ini akan menulis ulang riwayat tiap kali seseorang mengubah satu angka di
 * Settings. Yang perlu dihitung adalah baris yang ditulis sebelum ad tax ada — tanpa itu satu
 * tabel memuat dua formula tanpa ada yang bisa membedakannya.
 */
export function withAdTax(row, rate) {
  // Spend yang tidak diketahui bukan nol, sama seperti earning. Baris subdomain yang tidak
  // punya campaign Meta sama sekali (dogtraining.petcins.com: earning GAM tanpa iklan Meta)
  // datang tanpa `spending`, dan membacanya sebagai 0 menulis tiga angka yang berbohong
  // sekaligus: "Rp 0" di Spending/Ad Tax/Total Spend — tak terbedakan dari campaign yang
  // hari itu tidak membelanjakan apa pun — dan "ROI 0,00%" untuk subdomain yang seluruh
  // earning-nya keuntungan. `totalSpending` ikut dianggap sumber: baris lama membawanya
  // tanpa `spending`.
  const spendingKnown = hasAmount(row?.spending ?? row?.metaAds) || hasAmount(row?.totalSpending);
  const earningKnown = hasAmount(row?.earning ?? row?.adsense);
  const spending = toAmount(row?.spending ?? row?.metaAds);
  const earning = toAmount(row?.earning ?? row?.adsense);
  const adTax = hasAmount(row?.adTax) ? toAmount(row.adTax) : round(spending * rate);
  const totalSpending = hasAmount(row?.totalSpending)
    ? toAmount(row.totalSpending)
    : round(spending + adTax);
  // Baris yang laporan GAM-nya gagal tidak membawa earning sama sekali. Dibaca sebagai 0, ia
  // akan menulis "ROI -100%" untuk subdomain yang sebenarnya untung — persis seperti subdomain
  // yang beriklan tanpa hasil, dan tidak ada di layar yang bisa membedakan keduanya. Jadi ketiga
  // kolom turunannya dikosongkan, dan pemanggil yang perlu tahu bisa membaca `earningKnown`.
  //
  // Diputuskan di sini, bukan di tiap tabel: Overview, ROI subdomain di Profile User, dan ROI per
  // Negara membaca uang yang sama, dan tiga salinan aturan ini akan berbeda pada tabel ketiga.
  const known = earningKnown && spendingKnown;

  return {
    spendingKnown,
    spending: spendingKnown ? spending : "",
    adTax: spendingKnown ? adTax : "",
    totalSpending: spendingKnown ? totalSpending : "",
    earningKnown,
    earning: earningKnown ? earning : "",
    // Profit dan ROI perlu KEDUA sisinya. Tanpa spend, "earning dikurangi nol" adalah klaim
    // bahwa subdomain ini tidak mengeluarkan biaya — bukan yang kita tahu; yang kita tahu
    // hanyalah tidak ada spend yang teratribusi ke sana.
    profit: known ? round(earning - totalSpending) : "",
    // Spend yang lebih kecil dari `MIN_ROI_SPEND` — termasuk nol — tidak menghasilkan ROI sama
    // sekali (""), bukan 0%. Lihat `roiPercent`: pembagi sebesar Rp 43 menghasilkan persentase
    // enam angka yang berdiri di kolom yang sama dengan ROI hari-hari yang belanjanya jutaan.
    roi: known ? roiPercent(earning, totalSpending) : "",
  };
}

// Jenis akun sebuah baris ROI, diturunkan dari sumber earning-nya — bukan field yang diinput.
// GAM = AdX + Ad Server (Ad-Exchange), AdSense-in-GAM = Adsense Display. Baris yang seluruh
// earning-nya AdSense (adx+adServer nol) adalah akun AdSense; sisanya yang membawa earning
// diperlakukan Ad-Exchange — mengikuti adExchangeEarning: baris tanpa rincian sumber murni Ad
// Exchange. Baris tanpa earning sama sekali tak diketahui ("") dan tampil sebagai "-", bukan ditebak.
export function earningAccountType(row) {
  const adExchange = toAmount(row?.adxRevenue) + toAmount(row?.adServerRevenue);
  const adsense = toAmount(row?.adsenseRevenue);
  if (adsense > 0 && adExchange === 0) return "Adsense Display";
  if (adExchange > 0) return "Ad-Exchange";
  return toAmount(row?.earning ?? row?.adsense) > 0 ? "Ad-Exchange" : "";
}

/**
 * ROI sebuah baris, dengan LANTAI BELANJA.
 *
 * Di bawah `MIN_ROI_SPEND`, persentasenya bukan cuma tidak berguna melainkan menyesatkan: pembagi
 * yang mendekati nol meledakkan hasilnya. 3 Agu 2026 berbunyi **+355.456,11%** untuk hari yang
 * membelanjakan Rp 43 — angka yang berdiri di kolom yang sama dengan +412% milik hari yang
 * membelanjakan jutaan, dan yang paling besar di layar justru yang paling tidak berarti. Di grafik
 * ia lebih buruk lagi: satu titik seperti itu menekan seluruh kurva bulan lain jadi garis datar.
 *
 * Spend NOL juga jatuh ke sini, dan itu MENGGANTIKAN aturan lama yang menjawab 0%. "ROI 0%" untuk
 * subdomain yang menghasilkan Rp 826 tanpa belanja sepeser pun adalah pernyataan yang salah, bukan
 * penjagaan terhadap Infinity: yang benar bukan nol melainkan "tidak ada ROI untuk dihitung".
 *
 * Yang TIDAK ikut dikosongkan adalah `profit` — earning dikurangi belanja tetap uang yang nyata,
 * berapa pun kecilnya pembagi.
 */
export function roiPercent(earning, totalSpending) {
  return toAmount(totalSpending) >= MIN_ROI_SPEND
    ? round(((earning - totalSpending) / totalSpending) * 100)
    : "";
}

export function formatRoiPercent(value) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }

  const numeric = typeof value === "number" ? value : Number(String(value).replace(/[^\d.-]/g, ""));

  if (!Number.isFinite(numeric)) {
    return "-";
  }

  return `${numeric > 0 ? "+" : ""}${numeric.toFixed(2)}%`;
}

/**
 * Kelas kolom ROI: hijau tebal, merah kalau minus.
 *
 * Satu tempat untuk tiap tabel yang punya kolom ROI (Cash Flow, Laba per Domain, Proyeksi Budget),
 * sepola dengan `.master-roi-cell` di tabel Overview yang sudah lebih dulu memakai warna yang sama.
 * Ditulis per halaman, salah satunya akan lupa MERAHNYA — dan ROI −80% yang digambar hijau tebal
 * adalah kabar buruk yang menyamar sebagai kabar baik.
 *
 * Yang KOSONG ("-", yaitu di bawah lantai belanja `MIN_ROI_SPEND`) tidak diwarnai sama sekali:
 * hijau di sana adalah klaim bahwa ada ROI yang bagus untuk dibaca.
 */
export function roiCellClass(value) {
  if (value === null || value === undefined || value === "") return "";

  const numeric = typeof value === "number" ? value : Number(String(value).replace(/[^\d.-]/g, ""));
  if (!Number.isFinite(numeric)) return "";

  return numeric < 0 ? "roi-cell money-negative" : "roi-cell";
}

export function formatAdTaxPercent(rate) {
  const percent = rate * 100;
  return `${Number(percent.toFixed(2))}%`;
}

// Rincian sumber earning satu baris: GAM = permintaan Ad Manager sendiri (Ad Exchange + direct-sold
// Ad Server), AdSense = AdSense-in-GAM ("Adsense Display"). Keduanya dijumlahkan persis menjadi
// kolom Earning di sebelahnya, jadi tidak ada uang yang jatuh di antara dua kolom.
//
// Satu tempat untuk kedua tabel yang memecahnya — ROI di Overview dan "Report Master Realtime ROI"
// di /users/{uid}. Dua rumus berarti satu tabel diam-diam berhenti menghitung salah satu sumber.
export function earningSources(row) {
  return {
    gam: sumRevenue(row?.adxRevenue, row?.adServerRevenue),
    adsense: sumRevenue(row?.adsenseRevenue),
  };
}

// Jumlah beberapa sumber earning, dan "" kalau tidak satu pun di antaranya diketahui. Baris sebelum
// sync memecah earning per sumber tidak membawa field-nya sama sekali — nol di sana adalah klaim
// bahwa sumbernya tidak menghasilkan apa-apa, padahal yang benar adalah kami tidak tahu.
function sumRevenue(...values) {
  const known = values.filter((value) => value !== null && value !== undefined && value !== "");
  if (!known.length) return "";
  return known.reduce((total, value) => total + toAmount(value), 0);
}
