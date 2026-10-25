import { monthKey } from "./dateRange.js";
import { ACCOUNT_TYPES, AD_EXCHANGE, normalize } from "./earningByAccountType.js";
import { toAmount } from "./toAmount.js";

/**
 * Earning bulanan subdomain yang akun Google-nya sudah DITUTUP — satu-satunya angka earning yang
 * diketik orang di seluruh dashboard ini.
 *
 * ═══ KENAPA MELANGGAR ATURAN, DAN KENAPA CUMA DI SINI ═══
 *
 * Seluruh dashboard ini berdiri di atas satu kalimat: angka yang diketik ulang adalah angka yang
 * berbeda dari sumbernya suatu hari. Koleksi ini melanggarnya, dan sebabnya bukan kemalasan —
 * SUMBERNYA SUDAH TIDAK ADA. Akun GAM xiaomidriversdownload.com (network 23350141053) ditutup
 * Google pada Mei 2026; `reports:run` tidak akan menjawab lagi untuk network itu, subdomainnya
 * tidak pernah terdaftar di /sub-domains, dan `dashboard/roiReports` tidak memuat SATU baris pun
 * atas namanya — bulan apa pun. Tiga bulan terakhir domain itu cuma ada di spreadsheet.
 *
 * Yang menahan koleksi ini supaya tidak jadi pintu belakang untuk mengarang earning: **baris yang
 * subdomain + bulannya PUNYA baris ROI diabaikan sepenuhnya** — `foldAccountCloses` di cashFlow.js
 * dan `splitByOwner` di profitLoss.js, dua pemanggil yang memakai `reported` yang sama bentuknya.
 * Laporan yang masih bisa datang selalu menang. Domain yang masih hidup dan subdomainnya belum
 * terdaftar diperbaiki di /sub-domains — bukan diketik di sini, karena begitu
 * pendaftarannya beres, angka ketikan itu akan berdiri berdampingan dengan laporannya dan tidak
 * ada apa pun di layar yang bisa menjelaskan selisihnya.
 *
 * ═══ ENAM ISIAN, SISANYA ATURAN YANG SUDAH ADA ═══
 *
 * Diisi: **Bulan, PIC, Jenis Akun, Sub Domain, Earning, Ad Spend + Ad Tax**. Persis kolom
 * "(Input)" di spreadsheet acuannya, dan tidak satu pun kolom "(Auto)"-nya ikut disimpan:
 *
 *   Domain induk    `domainIndex` — pencocokan akhiran, sama dengan seluruh halaman lain
 *   Company         tarif bertanggal dari `companyPercents`, kena Ad Exchange saja
 *   Invalid Traffic dibagi dari `invalidTraffic` menurut porsi earning, lewat `spreadInvalidTraffic`
 *   Net Profit      rantai Cash Flow
 *   Bonus           tarif bonus PIC baris itu (`bonusPercents`), dasar net profit sebulan
 *
 * Ketiganya sudah diadu dengan spreadsheet acuan dan cocok sampai rupiah terakhir — termasuk
 * pembagian invalid traffic April (usb 43%, tools 7%, firmware 51% dari Rp 60.317) yang di sana
 * juga (Auto). Menyimpan kolom turunannya berarti angka yang beku pada hari diketik sementara
 * tetangganya bergerak; menyimpan yang ini berarti satu domain berbunyi dua angka berbeda di dua
 * tab bersebelahan.
 *
 * ═══ SATU HAL YANG TIDAK BISA DILAKUKAN BARIS BULANAN ═══
 *
 * Tarif Company punya TANGGAL berlaku, dan baris ini berdiri per BULAN — jadi ia memakai tarif
 * yang berlaku pada TANGGAL 1. Sebulan yang tarifnya berganti di tengah jalan tidak bisa dibelah
 * dari sini, berbeda dari baris ROI harian yang memang dihitung per hari. Untuk April–Juni 2026
 * tarifnya tetap sepanjang tiap bulan (10%, 10%, 15%), jadi hasilnya persis; kalau suatu hari
 * tidak, yang benar adalah memecah barisnya menurut tarifnya.
 */

/**
 * Baris yang siap dilipat ke `collectBuckets`, dinormalkan dan disaring.
 *
 * Yang dibuang di sini: baris tanpa subdomain, tanpa earning, atau yang bulannya bukan bulan yang
 * diminta. Yang TIDAK disaring di sini adalah tabrakan dengan baris ROI — itu butuh `roiReports`
 * dan dilakukan pemanggilnya, supaya berkas ini tidak menyisir puluhan ribu baris untuk kedua
 * kalinya.
 */
export function accountCloseEntries(items = [], month = "") {
  const rows = [];

  for (const row of Array.isArray(items) ? items : []) {
    if (accountCloseMonth(row) !== month) continue;

    const subDomain = String(row?.subDomain || "").trim();
    if (!subDomain) continue;

    const earning = toAmount(row?.earning);
    if (!earning) continue;

    rows.push({
      subDomain,
      pic: String(row?.pic || "").trim(),
      // Jenis akun MEMUTUSKAN ember mana yang diisi — dan karena itu ia dipilih, bukan diketik.
      // Nilai di luar kosakata jatuh ke Ad Exchange: itu yang dipakai baris ROI tanpa rincian
      // sumber, dan alasannya sama (dijatuhkan ke keduanya, satu earning terhitung dua kali).
      accountType: ACCOUNT_TYPES.includes(row?.accountType) ? row.accountType : AD_EXCHANGE,
      earning,
      // Belanja yang kosong adalah NOL di sini, bukan "tidak diketahui": baris ini diketik orang
      // yang sedang memegang catatannya. Yang tidak diketahui adalah baris yang tidak dibuat.
      spending: toAmount(row?.totalSpending),
      // Tanggal 1 bulan itu — lihat catatan tarif Company di kepala berkas.
      date: `${month}-01`,
    });
  }

  return rows;
}

/**
 * Kunci (bulan, subdomain) yang punya baris ketikan — dipakai pemanggilnya untuk memutuskan mana
 * yang kalah oleh baris ROI. Nama subdomain dinormalkan, sepola dengan `addBucket`.
 */
export function accountCloseKey(subDomain) {
  return normalize(subDomain);
}

/**
 * Bulan sebuah baris: dari `month` ("2026-05") kalau bentuknya sah, dari `date` untuk baris yang
 * ditulis lewat jalur lain. Sama persis dengan `monthOf` di invalidTraffic.js dan payouts.js.
 */
export function accountCloseMonth(row) {
  const month = String(row?.month ?? "").trim();
  if (/^\d{4}-\d{2}$/.test(month)) return month;
  return monthKey(row?.date);
}
