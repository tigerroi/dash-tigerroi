import { monthKey } from "./dateRange.js";
import {
  ACCOUNT_TYPES,
  accountTypeOf,
  bucketOf,
  earningBuckets,
  normalize,
  spreadByEarning,
} from "./earningByAccountType.js";
import { hasAmount, round } from "./numbers.js";
import { toAmount } from "./toAmount.js";

/**
 * Invalid traffic per domain per BULAN per JENIS AKUN — dan angka di sekitarnya, yang tidak
 * diketik siapa pun.
 *
 * Yang diketik orang cuma empat hal: bulannya, jenis akunnya, domainnya, dan tiga hasil
 * pengecekan. Sisanya — Earning, Ad Spend + Ad Tax, Net Profit, dan persentase invalid traffic
 * terhadap earning — DITURUNKAN dari baris ROI bulan itu. Sebelumnya keempatnya diketik ulang dari
 * spreadsheet, dan angka yang diketik ulang adalah angka yang berbeda dari sumbernya suatu hari,
 * tanpa satu pun tanda di layar.
 *
 * POTONGAN COMPANY TIDAK IKUT, tidak sebagai kolom maupun di dalam Net Profit — dan itu keputusan,
 * bukan kelalaian. Tarifnya sekarang punya TANGGAL berlaku (`companyPercents`, tab Potongan
 * Company), jadi sebulan bisa memuat dua tarif; halaman ini menghitung dari agregat SEBULAN dan
 * tidak punya cara membelahnya. Mengalikan earning sebulan dengan salah satu tarifnya akan
 * menyebut potongan yang berbeda dari yang benar-benar dikurangkan Laba Rugi — dua angka untuk uang
 * yang sama, di dua halaman bertetangga.
 *
 * Konsekuensinya diketahui dan diterima: kolom Net Profit di sini LEBIH BESAR daripada laba
 * sesungguhnya untuk baris Ad-Exchanger, dan tidak sama dengan kolom Net Profit di spreadsheet
 * acuan. Yang dijawab halaman ini adalah "berapa persen pendapatan bulan ini yang hangus jadi
 * invalid traffic"; yang menjawab laba adalah Laba Rugi.
 *
 * TAPI KEDUANYA BISA DIKETIK, dan ketikan orang MENANG. Tidak semua bulan punya baris ROI: yang
 * lebih tua daripada sync ini, network yang laporannya ditolak, subdomain yang belum terdaftar —
 * semuanya menghasilkan kolom kosong yang tidak bisa diperbaiki dari mana pun. `earningManual` dan
 * `totalSpendingManual` mengisinya.
 *
 * Kenapa MENANG dan bukan cuma mengisi yang kosong: sebuah bulan bisa punya baris ROI untuk tiga
 * hari saja, dan angka tiga hari yang berdiri di kolom "Earning" sebuah bulan penuh adalah angka
 * yang salah tanpa kelihatan salah — persis keadaan yang membuat orang mengetik angkanya sendiri.
 * Kalau ketikan itu bisa dikalahkan sync yang datang belakangan, ia akan hilang pada hari sync
 * berhasil sebagian. Yang mengembalikan angka sync adalah mengosongkan kotaknya, dan itu tindakan
 * yang disengaja.
 *
 * Dan karena ia menang, ia WAJIB terbaca: kolom **Sumber** (`dataSource`) menyebut baris mana yang
 * angkanya diketik orang. Angka ketikan yang berdiri tanpa tanda di antara angka sync adalah dua
 * hal berbeda yang mengaku satu.
 *
 * Yang TIDAK ikut: Laba Rugi. Pendapatan dan belanja di sana datang dari `weeklyFinancials` —
 * berskala usaha, tanpa syarat pemetaan campaign — dan angka yang diketik di sini akan jadi
 * pendapatan kedua untuk uang yang sama. Yang mengalir ke sana dari halaman ini cuma jumlah
 * Check-nya, lewat `invalidTrafficTotal` yang sama dengan tabel di halaman ini sendiri.
 *
 * Diturunkan saat DIRENDER, tidak ditulis ke RTDB — alasan yang sama dengan kolom Status Sync di
 * Ad Accounts: yang ditulis akan benar pada detik ia ditulis dan basi sesudahnya, dan sync
 * berikutnya menggeser earning bulan berjalan tanpa menyentuh baris ini. Satu-satunya angka yang
 * BENAR-BENAR tersimpan adalah `nominal` (jumlah ketiga Check) — bukan karena ada halaman yang
 * membacanya (Laba Rugi, Cash Flow, dan Pencairan semuanya memanggil `invalidTrafficTotal`),
 * melainkan karena ia kolom tabel: yang bisa diurut dan dijumlah ResourceList adalah field yang
 * tersimpan.
 */

// Tiga pengecekan, karena begitulah angkanya datang: satu domain dicek beberapa kali dalam sebulan
// dan tiap pengecekan punya nominalnya sendiri. Dijumlahkan jadi `nominal` untuk kolom tabelnya —
// yang dibaca halaman lain adalah `invalidTrafficTotal`, yang menjumlahkannya sendiri.
const CHECK_FIELDS = ["check1", "check2", "check3"];

/**
 * Total invalid traffic satu baris = jumlah ketiga Check.
 *
 * Baris LAMA diinput sebagai satu `nominal` tanpa rincian Check, dan tidak boleh kehilangan
 * angkanya begitu seseorang membuka formnya untuk mengubah keterangannya: tanpa satu pun Check
 * yang terisi, `nominal` yang sudah tersimpan itulah yang dipakai. Yang mengganti angka lama itu
 * adalah mengisi Check-nya — tindakan yang disengaja, bukan efek samping dari membuka form.
 */
export function invalidTrafficTotal(row = {}) {
  const filled = CHECK_FIELDS.filter((field) => hasAmount(row?.[field]));
  if (filled.length === 0) return toAmount(row?.nominal);
  return round(filled.reduce((total, field) => total + toAmount(row[field]), 0));
}

/**
 * Membagikan nominal invalid traffic ke ember-ember penyusunnya, menurut PORSI EARNING.
 *
 * SATU pembagi untuk dua halaman. Laba Rugi membaginya ke PIC dan Cash Flow ke subdomain, tapi
 * aturannya sama persis — dan sampai 4 Sep 2026 aturan itu ditulis dua kali, satu di tiap modul.
 * Keduanya lalu sama-sama menjatuhkan nominal yang tidak punya ember, dan Laba Rugi menutupinya
 * karena kolom Invalid Traffic-nya dijumlah terpisah (bukan dari pembagian ini): April 2026
 * berbunyi Rp 242.992 di sana dan Rp 218.842 di Cash Flow, untuk uang yang sama.
 *
 * `entries` adalah ember yang sudah berisi earning, `domainKeyOf` menyebutkan nama domainnya
 * (kedua modul menamai field-nya berbeda), dan `onShare` dipanggil untuk tiap ember yang menerima
 * bagian — di situlah Cash Flow mencatat kolam pembaginya, yang tidak dipakai Laba Rugi.
 *
 * ═══ YANG TIDAK PUNYA EMBER DIKEMBALIKAN, BUKAN DIJATUHKAN — DAN BUKAN DIPINDAHKAN ═══
 *
 * Pengecekan berdiri per (domain, JENIS AKUN), dan sebuah domain bisa dicek untuk sisi bisnis yang
 * bulan itu tidak menghasilkan apa-apa: designingaround.com Adsense April (Rp 24.150),
 * masseffectstore.com Adsense Mei (Rp 23.124). Tidak ada pembagi, jadi tidak ada yang bisa
 * menerimanya.
 *
 * MEMINDAHKANNYA ke jenis akun lain di domain yang sama SUDAH DITOLAK, dan penolakan itu tetap
 * berlaku: clawback atas pendapatan AdSense yang dibebankan ke ember Ad Exchange mengurangi dasar
 * bonus advertiser yang tidak ada hubungannya dengan uang itu. Yang dijaga di sini bukan rapinya
 * total melainkan SIAPA yang menanggung.
 *
 * Yang salah selama ini cuma satu: nominalnya hilang tanpa suara. Sekarang ia DIKEMBALIKAN sebagai
 * `unspread`, dan halaman menyebutkannya — kartu Cash Flow di kepala halaman yang sama sudah
 * menjumlahkan nominal PENUH (`sum(trafficRows, invalidTrafficTotal)`), jadi tanpa keterangan itu
 * satu halaman memuat dua angka Invalid Traffic yang berbeda tanpa apa pun yang menjelaskannya.
 */
export function spreadInvalidTraffic(entries, rows, { domainKeyOf, onShare } = {}) {
  return spreadByEarning(entries, rows, {
    domainKeyOf,
    amountOf: invalidTrafficTotal,
    // Baris LAMA tanpa jenis akun dibagi ke KEDUA sisi domainnya: tanpa jenis, barisnya memang
    // berarti "invalid traffic domain ini bulan itu".
    matches: (row, entry) => {
      const type = accountTypeOf(row?.accountType);
      return !type || entry.accountType === type;
    },
    onShare: (entry, share, nominal) => {
      entry.invalidTraffic += share;
      onShare?.(entry, nominal);
    },
  });
}

/**
 * Baris tabel Invalid Traffic, lengkap dengan kolom turunannya.
 *
 * `items` adalah isi koleksi `invalidTraffic`; `store` menyediakan `roiReports` (satu-satunya
 * tempat earning dan belanja punya nama subdomainnya) dan `subDomains` (yang memetakannya ke
 * domain induk).
 */
export function invalidTrafficRows(items = [], store = {}) {
  const buckets = earningBuckets(store);
  const rows = Array.isArray(items) ? items : [];

  // Nomor urut KRONOLOGIS, bukan urutan kunci push RTDB (yaitu urutan dimasukkan): baris April yang
  // baru diinput hari ini akan bernomor paling besar, berdiri di antara baris Juli. Nomornya
  // dihitung dari daftar penuh sebelum disaring dan diurutkan halaman — kolom "No" yang berubah
  // angkanya tiap kali seseorang mengetik di kotak pencarian bukan nomor, melainkan hitungan baris.
  const order = new Map(
    [...rows]
      .map((row, index) => ({ row, index, sortKey: sortKeyOf(row) }))
      .sort((a, b) => a.sortKey.localeCompare(b.sortKey) || a.index - b.index)
      .map(({ row }, position) => [row, position + 1]),
  );

  return rows.map((row) => {
    const month = monthOf(row);
    const domain = normalize(row?.domain);
    const type = accountTypeOf(row?.accountType);
    const bucket = bucketOf(buckets, month, domain, type);
    const nominal = invalidTrafficTotal(row);
    // Ketikan orang dulu, baris ROI sesudahnya — lihat catatan di kepala berkas. `null` (bukan 0)
    // untuk yang tidak ada di keduanya: Rp 0 di kolom Earning adalah klaim bahwa domainnya tidak
    // menghasilkan apa-apa. Bucket yang ADA dengan isi nol tetap Rp 0, dan nol itu benar.
    const typedEarning = hasAmount(row?.earningManual) ? toAmount(row.earningManual) : null;
    const typedSpending = hasAmount(row?.totalSpendingManual)
      ? toAmount(row.totalSpendingManual)
      : null;
    const earning = typedEarning ?? (bucket ? round(bucket.earning) : null);
    const spending = typedSpending ?? (bucket ? round(bucket.spend) : null);

    return {
      ...row,
      no: order.get(row) || 0,
      month,
      accountType: row?.accountType || "",
      nominal,
      earning: earning ?? "",
      totalSpending: spending ?? "",
      netProfit: netProfitOf(earning, spending, nominal),
      trafficPercent: trafficPercentOf(earning, nominal),
      dataSource: dataSourceOf(typedEarning, typedSpending, earning, spending),
    };
  });
}

// Earning dikurangi belanja dan invalid traffic-nya — TANPA potongan Company; lihat catatan di
// kepala berkas. Butuh KEDUANYA: baris yang earning-nya diketik tapi belanjanya belum menghasilkan
// kosong, bukan laba yang dihitung dari belanja nol yang dikarang.
function netProfitOf(earning, spending, nominal) {
  if (earning === null || spending === null) return "";
  return round(earning - spending - nominal);
}

/**
 * Dari mana kedua angka baris ini datang — dan itu satu-satunya hal yang membedakan angka yang
 * diketik orang dari angka yang datang dari laporan.
 *
 * Disebut per SISI, bukan satu kata untuk keduanya: baris yang earning-nya diketik karena
 * laporannya tidak ada sementara belanjanya benar-benar dari Meta adalah keadaan yang paling
 * sering terjadi, dan "Manual" telanjang di sana mengaku lebih banyak daripada yang sebenarnya
 * diketik.
 *
 * Kosong untuk baris yang KEDUA sisinya tidak ada: tidak ada sumber untuk disebut, dan "API" di
 * sana akan terbaca sebagai laporan yang menjawab nol.
 */
function dataSourceOf(typedEarning, typedSpending, earning, spending) {
  if (typedEarning !== null && typedSpending !== null) return "Manual";
  if (typedEarning !== null) return "Manual (earning)";
  if (typedSpending !== null) return "Manual (spend)";
  if (earning === null && spending === null) return "";
  return "API";
}

/**
 * Invalid traffic sebagai persen dari earning bulan itu — angka yang benar-benar dibaca orang di
 * tabel ini, karena Rp 449.184 tidak berarti apa-apa tanpa tahu ia dipotong dari berapa.
 *
 * Tanpa earning tidak ada pembagi, dan "0,00%" untuk domain yang kehilangan Rp 23.124 dari
 * pendapatan nol adalah pernyataan yang salah — bukan penjagaan terhadap Infinity. Sepola dengan
 * `roiPercent`: yang tidak punya pembagi mengembalikan kosong.
 */
function trafficPercentOf(earning, nominal) {
  if (earning === null || earning <= 0) return "";
  return `${((nominal / earning) * 100).toFixed(2)}%`;
}

// --- bantuan ----------------------------------------------------------------------------------

/**
 * Bulan baris invalid traffic: dari `month` ("2026-04") kalau ada, dari `date` untuk baris yang
 * ditulis sebelum kolom bulannya ada.
 *
 * Diekspor karena `cashFlow.js` membagi nominal baris-baris ini ke subdomain penyusunnya, dan
 * kunci embernya harus bulan yang SAMA dengan yang dibaca halaman ini. Disalin, baris lama yang
 * cuma punya `date` akan terbaca di bulan yang benar pada satu halaman dan hilang di halaman
 * sebelahnya.
 */
export function invalidTrafficMonth(row) {
  return monthOf(row);
}

function monthOf(row) {
  const month = String(row?.month ?? "").trim();
  if (/^\d{4}-\d{2}$/.test(month)) return month;
  const key = monthKey(row?.date);
  return /^\d{4}-\d{2}$/.test(key) ? key : "";
}

// Bulan, lalu domain, lalu jenis akun dalam urutan ACCOUNT_TYPES — bukan urutan abjadnya. Diurut
// abjad, "Ad-Exchanger" berdiri sebelum "Adsense" karena tanda hubung lebih kecil daripada huruf
// mana pun, dan itu urutan yang tidak dipilih siapa pun.
function sortKeyOf(row) {
  const type = accountTypeOf(row?.accountType);
  const rank = type ? ACCOUNT_TYPES.indexOf(type) + 1 : 0;
  return `${monthOf(row)}|${normalize(row?.domain)}|${rank}`;
}
