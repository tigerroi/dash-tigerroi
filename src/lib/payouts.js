import { accountCloseEntries, accountCloseKey, accountCloseMonth } from "./accountClose.js";
import { companyPercentIndex } from "./companyPercent.js";
import { monthKey } from "./dateRange.js";
import { ADSENSE, domainIndex, normalize, sourceSplit } from "./earningByAccountType.js";
import { invalidTrafficMonth, invalidTrafficTotal } from "./invalidTraffic.js";
import { hasAmount, round, toPercent } from "./numbers.js";
import { toAmount } from "./toAmount.js";

/**
 * Laporan Pencairan Rekening: satu baris per (BULAN, DOMAIN) — dari pendapatan yang dilaporkan
 * Google sampai angka yang benar-benar mendarat di rekening.
 *
 *   Earning Final = Earning Google − Potongan Company − Invalid Traffic + Saldo Sebelumnya
 *   Saldo Close   = Earning Final, kalau akunnya ditutup Google; selain itu Rp 0
 *   Real Masuk    = Earning Final − Saldo Close, KECUALI kalau angka notifikasinya diketik
 *   Sunat Google  = Real Masuk − (Earning Final − Saldo Close)
 *   Pajak Negara  = Pajak % × Real Masuk
 *   Nominal Fee   = Fee % × (Real Masuk − Pajak Negara)
 *   Saldo Akhir   = Real Masuk − Pajak Negara − Nominal Fee − Potongan Konversi
 *
 * PAJAK NEGARA MEMUNGUT DULUAN, DAN ITU SELURUH GUNANYA BERDIRI SEBAGAI LANGKAH SENDIRI. Fee
 * perantara dihitung dari SISA setelah pajak, bukan dari yang dibayarkan Google — dan sampai
 * kolom ini ada, skema `payouts` tidak punya cara mengungkapkan pembagi selain Real Masuk, jadi
 * pajaknya terpaksa disembunyikan di dalam Potongan Konversi dan fee-nya meleset Rp 209 ribu pada
 * satu baris (lihat `migrations/fix-payout-fee-double-count.mjs`). Tarifnya diketik di baris ini,
 * bukan dibaca dari negara domain saat DIRENDER: itu pelajaran `companyPercents` — tarif yang
 * dibaca dari konstanta menghitung ulang seluruh bulan lampau pada hari angkanya diubah. Yang
 * diberikan negara domain cuma BAWAAN kotaknya saat baris baru dibuat (`PAYOUT_TAX_PERCENT` di
 * src/lib/countries.js). Tarif KOSONG bukan 0%, dan rantainya lalu identik dengan sebelum kolom
 * ini ada — jadi baris lama tidak bergeser sedikit pun.
 *
 * KETIGA ANGKA DI KEPALA RANTAI TIDAK DIKETIK SIAPA PUN. Spreadsheet acuannya meminta Earning
 * Google, Company Ad Exchange, dan Invalid Traffic diketik ulang per domain per bulan; ketiganya
 * sudah ada di dashboard ini, dan angka yang diketik ulang adalah angka yang berbeda dari sumbernya
 * suatu hari — tanpa satu pun tanda di layar:
 *
 *   `roiReports`         earning harian per subdomain berikut rincian sumbernya
 *   `domainIndex`        subdomain -> domain induk (parentDomain, lalu pencocokan akhiran)
 *   `sourceSplit`        bagian Ad Exchange sebuah baris — yang kena potongan Company
 *   `companyPercentIndex` tarif Company yang berlaku pada TANGGAL baris itu
 *   `invalidTrafficTotal` jumlah Check 1-3 sebuah baris Invalid Traffic
 *
 * Tidak satu aturan pun dihitung ulang di sini; semuanya diimpor dari modul yang sudah dipakai Laba
 * Rugi, Cash Flow, Invalid Traffic, dan Target. Disalin, satu domain akan berbunyi dua angka
 * berbeda di dua tab yang bersebelahan di kepala halaman yang sama.
 *
 * Diturunkan saat DIRENDER, tidak ditulis ke RTDB — alasan yang sama dengan kolom turunan Invalid
 * Traffic dan Target: sync berikutnya menggeser earning bulan berjalan, dan angka yang tersimpan
 * akan benar pada detik ia ditulis lalu basi sesudahnya. Tidak ada satu pun halaman lain yang
 * membaca baris ini, jadi tidak ada pengecualian seperti `nominal` di Invalid Traffic.
 *
 * SATU KOLOM YANG DI SPREADSHEET (Auto) DAN DI SINI BOLEH DIKETIK: Real Masuk Rekening. Ia angka
 * dari notifikasi pembayaran Google — yang juga dikutip di kolom Kode PIP — dan pada 12 dari 20
 * baris acuan ia TIDAK sama dengan Earning Final: Google membayar menurut angkanya sendiri, dan
 * selisihnya sampai Rp 2,6 juta pada satu baris. Sebuah kolom bernama "Real Masuk Rekening" yang
 * diturunkan dari pembukuan kita sendiri akan berbeda dari mutasi rekening yang jadi buktinya, dan
 * tidak ada apa pun di layar yang bisa menjelaskan selisihnya.
 *
 * Karena itu ia dibalik: yang diketik adalah angka yang benar-benar mendarat, dan yang DITURUNKAN
 * adalah selisihnya — kolom Sunat Google, yang persis menjawab "berapa yang disunat Google bulan
 * ini". Sepola dengan `earningManual` di Invalid Traffic, ketikan orang MENANG dan yang kosong
 * jatuh ke angka turunannya; bedanya di sini ketikan itu tidak butuh kolom "Sumber" tersendiri,
 * karena Sunat Google yang kosong (bukan Rp 0) sudah mengatakan bahwa belum ada angka notifikasi
 * yang diadu dengan pembukuan.
 */

// Tiga keadaan sebuah pencairan, dan ketiganya berarti tindakan yang berbeda: yang sudah masuk
// rekening, yang masih ditunggu, dan yang tidak akan pernah datang karena akunnya ditutup Google.
// Pilihan, bukan kotak teks: nilainya MEMUTUSKAN Saldo Close, dan satu huruf meleset menghasilkan
// baris yang mengaku masih akan cair.
export const ACCOUNT_CLOSE = "Account Close";
export const PAYOUT_STATUSES = ["Sudah Cair", "Pending Payment", ACCOUNT_CLOSE];

/**
 * Apakah sebuah baris pencairan menandai akun yang DITUTUP Google.
 *
 * Satu baris karena ia dibaca dari dua tempat yang tidak saling kenal — "Akun Close Cut" di kartu
 * Cash Flow (`accountCloseCut`) dan pemisahan tabel di halaman % Advertiser — dan keduanya harus
 * menyebut himpunan domain yang sama. Ditulis dua kali, satu halaman akan memisahkan sebuah domain
 * yang halaman sebelahnya masih menjumlahkan, dan selisihnya persis sebesar domain itu.
 */
export function isAccountClose(row) {
  return String(row?.status ?? "").trim() === ACCOUNT_CLOSE;
}

/**
 * Baris tabel Pencairan Rekening, lengkap dengan kolom turunannya.
 *
 * `items` adalah isi koleksi `payouts`; `store` menyediakan `roiReports` (satu-satunya tempat
 * earning punya nama subdomainnya), `subDomains`/`domains` (domain induk), `companyPercents` (tarif
 * bertanggal), dan `invalidTraffic` (nominal per domain per bulan).
 */
export function payoutRows(items = [], store = {}) {
  const rows = Array.isArray(items) ? items : [];
  const earnings = earningByDomainMonth(store);
  const traffic = invalidTrafficByDomainMonth(store);

  return rows.map((row) => derive(row, earnings, traffic));
}

// --- satu baris -------------------------------------------------------------------------------

function derive(row, earnings, traffic) {
  const month = monthOf(row);
  const domain = normalize(row?.domain);
  const key = `${month}|${domain}`;
  const bucket = earnings.get(key) || null;

  // Bulan + domain tanpa satu pun baris ROI berearning menghasilkan "" — bukan Rp 0. Nol di kolom
  // Earning Google adalah klaim bahwa domainnya tidak menghasilkan apa-apa bulan itu, dan seluruh
  // rantai di bawahnya lahir dari klaim itu: Earning Final minus, lalu Saldo Akhir minus, untuk
  // bulan yang laporannya cuma belum sampai.
  const earning = bucket ? round(bucket.earning) : "";
  const company = bucket ? round(bucket.company) : "";
  // Yang ini justru Rp 0 kalau tidak ada barisnya, dan itu bukan ketidakkonsistenan: ia JUMLAH
  // baris pengecekan, dan jumlah dari himpunan kosong adalah nol. Domain yang bulan itu belum
  // pernah dicek memang tidak kehilangan apa-apa — itu jawaban yang sama dengan `buildProfitLoss`,
  // yang menjumlahkan `nominal` seluruh baris yang ada.
  const invalidTraffic = round(traffic.get(key) || 0);
  const saldoSebelumnya = toAmount(row?.saldoSebelumnya);

  const earningFinal =
    earning === "" ? "" : round(earning - company - invalidTraffic + saldoSebelumnya);

  // Akun yang ditutup Google: seluruh saldo yang belum sempat cair hangus, dan yang mendarat di
  // rekening nol. Dua dari dua puluh baris acuan berdiri di keadaan ini.
  const closed = String(row?.status ?? "").trim() === ACCOUNT_CLOSE;
  // Baris yang TIDAK ditutup menghanguskan nol, dan nol itu benar walau earning-nya belum
  // diketahui — tidak ada yang hangus dari akun yang masih hidup. Hanya baris yang DITUTUP dan
  // earning-nya tidak diketahui yang menjawab "": di situ ada saldo yang hangus, dan besarnya
  // memang belum bisa dihitung.
  const saldoClose = closed ? earningFinal : 0;
  const expected = earningFinal === "" ? "" : round(earningFinal - saldoClose);

  // Angka notifikasi pembayaran, kalau sudah diketik; kalau belum, yang seharusnya datang. Yang
  // membedakan keduanya di layar adalah kolom Sunat Google — kosong selama belum ada yang diadu.
  const typed = hasAmount(row?.realMasuk) ? toAmount(row.realMasuk) : null;
  const realMasuk = typed ?? expected;
  const sunatGoogle = typed === null || expected === "" ? "" : round(typed - expected);

  // Pajak pemerintah negara asal, untuk domain yang dibayar lewat bank asing. Ia memungut DULUAN
  // dan itulah seluruh gunanya berdiri sebagai langkah tersendiri: fee perantara dihitung dari
  // SISANYA, bukan dari yang dibayarkan Google. Baris tanpa tarif (kosong, bukan 0%) menghasilkan
  // rantai yang identik dengan sebelum kolom ini ada — pajak nol, pembagi fee tetap Real Masuk.
  const govTaxPercent = toPercent(row?.govTaxPercent);
  const govTaxNominal =
    govTaxPercent === null || realMasuk === "" ? "" : round((realMasuk * govTaxPercent) / 100);
  const afterTax = realMasuk === "" ? "" : round(realMasuk - (govTaxNominal || 0));

  const feePercent = toPercent(row?.feePercent);
  const feeNominal =
    feePercent === null || afterTax === "" ? "" : round((afterTax * feePercent) / 100);
  const potonganKonversi = toAmount(row?.potonganKonversi);
  const saldoAkhir = afterTax === "" ? "" : round(afterTax - (feeNominal || 0) - potonganKonversi);

  return {
    ...row,
    month,
    earning,
    company,
    companyPercent: percentLabel(bucket),
    // Earning Ad Exchange yang harinya belum punya tarif Company sama sekali. Dibawa sebagai angka
    // (bukan cuma jadi label) karena halaman menggambarnya sebagai keterangan di bawah nama domain:
    // Company Rp 0 yang berdiri sendiri terbaca sebagai "domain ini bebas potongan", sementara yang
    // sebenarnya terjadi adalah tarifnya belum diisi di tab Potongan Company.
    earningWithoutPercent: bucket ? round(bucket.earningWithoutPercent) : 0,
    invalidTraffic,
    saldoSebelumnya,
    earningFinal,
    govTaxPercent: govTaxPercent === null ? "" : `${govTaxPercent}%`,
    govTaxNominal,
    feePercent: feePercent === null ? "" : `${feePercent}%`,
    feeNominal,
    sunatGoogle,
    saldoClose,
    potonganKonversi,
    saldoAkhir,
    realMasuk,
  };
}

// --- bahan dari halaman lain -------------------------------------------------------------------

/**
 * Earning dan potongan Company, dijumlahkan per (bulan, domain induk).
 *
 * Kenapa disisir per baris HARIAN dan bukan sekali per bulan: tarif Company punya tanggal berlaku,
 * jadi potongannya harus dihitung pada hari yang tarifnya berlaku lalu dijumlahkan — persis
 * `splitByOwner` di profitLoss.js dan `collectBuckets` di cashFlow.js. Sebuah domain yang di-relink
 * ke company lain di tengah bulan punya dua tarif, dan mengalikan earning sebulan dengan salah
 * satunya memindahkan ratusan ribu rupiah tanpa satu pun tanda di layar.
 *
 * POTONGAN COMPANY KENA PENDAPATAN AD EXCHANGE SAJA (AdX + Ad Server), bukan AdSense — aturan yang
 * sama dengan Laba Rugi dan Cash Flow. Yang dijumlahkan di kolom Earning tetap KEDUANYA: yang
 * dibayarkan Google ke rekening adalah seluruh pendapatan domain itu, bukan sebagiannya.
 */
function earningByDomainMonth(store) {
  const domainOf = domainIndex(store);
  const rates = companyPercentIndex(store?.companyPercents);
  const buckets = new Map();

  // Subdomain yang bulan itu PUNYA baris ROI — baris ketikan `accountCloses` untuk salah satunya
  // diabaikan tanpa suara, aturan yang sama dengan `foldAccountCloses` di cashFlow.js.
  const reported = new Set();

  const add = (month, domain, earning, adx, date) => {
    const percent = rates.percentAt(domain, date);
    const key = `${month}|${domain}`;
    const entry = buckets.get(key) || {
      earning: 0,
      company: 0,
      earningWithoutPercent: 0,
      percents: new Set(),
    };
    entry.earning += earning;
    if (percent === null) entry.earningWithoutPercent += adx;
    else {
      entry.company += (adx * percent) / 100;
      entry.percents.add(percent);
    }
    buckets.set(key, entry);
  };

  for (const row of store?.roiReports || []) {
    // Earning yang tidak diketahui dilewati, bukan dibaca sebagai nol: laporan GAM yang gagal
    // datang tidak mengatakan bahwa domainnya tidak menghasilkan apa-apa hari itu.
    if (!hasAmount(row?.earning)) continue;
    const month = monthKey(row?.date);
    if (!/^\d{4}-\d{2}$/.test(month)) continue;
    reported.add(`${month}|${accountCloseKey(row?.subDomain)}`);
    const domain = domainOf(row?.subDomain);
    if (!domain) continue;

    const earning = toAmount(row.earning);
    add(month, domain, earning, sourceSplit(row, earning).adx, row?.date);
  }

  /**
   * EARNING AKUN YANG SUDAH DITUTUP GOOGLE ikut, dan tanpa ini seluruh rantai pencairan sebuah
   * domain yang ditutup berdiri KOSONG.
   *
   * Akun yang ditutup berhenti menjawab `reports:run`, jadi pendapatannya tidak ada di `roiReports`
   * mana pun — ia cuma ada sebagai angka ketikan di tab Akun Ditutup. Tanpa dibaca di sini,
   * `earningFinal` baris pencairannya "" dan **Saldo Close-nya ikut ""**: kolom yang seluruh
   * gunanya adalah menyebutkan berapa saldo yang HANGUS justru kosong persis untuk satu-satunya
   * baris yang menghanguskan sesuatu. Mei 2026 berbunyi Rp 0 untuk saldo yang sebenarnya
   * Rp 70.514.530.
   *
   * Baris bulanan MENYEBUTKAN jenis akunnya, jadi `sourceSplit` tidak dipakai — bagian Ad Exchange
   * sebuah baris Adsense adalah nol, dan membelahnya akan menagihkan potongan Company yang tidak
   * pernah ditagihkan. Sepola dengan `splitByOwner` di profitLoss.js.
   */
  for (const month of accountCloseMonths(store?.accountCloses)) {
    for (const row of accountCloseEntries(store?.accountCloses, month)) {
      if (reported.has(`${month}|${accountCloseKey(row.subDomain)}`)) continue;
      const domain = domainOf(row.subDomain);
      if (!domain) continue;
      const adx = row.accountType === ADSENSE ? 0 : row.earning;
      add(month, domain, row.earning, adx, row.date);
    }
  }

  return buckets;
}

/**
 * Nominal invalid traffic per (bulan, domain) — KEDUA jenis akun dijumlahkan.
 *
 * DIEKSPOR karena `accountCloseRows` memakainya juga: baris akun yang ditutup TIDAK mengetik
 * ulang invalid traffic-nya (ia sudah diinput di tabnya sendiri), dan indeks kedua di sana akan
 * menyebut angka yang berbeda untuk domain yang sama suatu hari.
 *
 * Baris `invalidTraffic` berdiri per (bulan, domain, jenis akun) karena begitulah pengecekannya
 * dilakukan; yang dibayarkan Google ke rekening tidak dipisah begitu. Angkanya dibaca lewat
 * `invalidTrafficTotal` yang sama dengan halamannya sendiri, jadi baris lama yang cuma punya
 * `nominal` tanpa rincian Check tetap terhitung.
 */
function invalidTrafficByDomainMonth(store) {
  const totals = new Map();

  for (const row of store?.invalidTraffic || []) {
    const month = invalidTrafficMonth(row);
    const domain = normalize(row?.domain);
    if (!month || !domain) continue;
    const key = `${month}|${domain}`;
    totals.set(key, (totals.get(key) || 0) + invalidTrafficTotal(row));
  }

  return totals;
}

// --- bantuan ----------------------------------------------------------------------------------

/**
 * Tarif Company yang benar-benar dipakai bulan itu — bukan satu angka.
 *
 * Sepola dengan `companyBreakdown` di profitLoss.js dan kolom Company % di Cash Flow: sebulan bisa
 * memuat dua tarif, dan satu angka di kolom ini harus memilih salah satunya — yang mana pun yang
 * dipilih, ia berbohong untuk separuh bulan.
 */
function percentLabel(bucket) {
  if (!bucket) return "";
  const percents = [...bucket.percents].sort((a, b) => a - b);
  if (percents.length === 0) return "";
  if (percents.length === 1) return `${percents[0]}%`;
  return `${percents[0]}% → ${percents[percents.length - 1]}%`;
}

/**
 * Bulan sebuah baris pencairan: dari `month` ("2026-04") kalau bentuknya sah, dari `date` untuk
 * baris yang ditulis lewat jalur lain. Sama persis dengan `monthOf` di invalidTraffic.js — dua
 * pembaca bulan yang berbeda berarti baris yang di layar berbunyi Juni dicocokkan dengan earning
 * bulan yang lain.
 */
function monthOf(row) {
  const month = String(row?.month ?? "").trim();
  if (/^\d{4}-\d{2}$/.test(month)) return month;
  const key = monthKey(row?.date);
  return /^\d{4}-\d{2}$/.test(key) ? key : "";
}

/**
 * Potongan pencairan per (BULAN, DOMAIN): berapa uang yang HILANG antara yang dibayarkan Google
 * dan yang benar-benar mendarat di rekening kita.
 *
 *   Potongan pencairan = Real Masuk Rekening − Saldo Akhir
 *
 * yaitu fee rekening perantara ditambah potongan konversi mata uang dan pajak negara asal — dua
 * kolom yang SUDAH diketik orang di tab Pencairan, di baris yang sama. TIDAK ADA angka baru yang
 * diketik dan tidak ada koleksi baru: yang mencatat sebuah pencairan sudah menuliskan keduanya,
 * dan kolom ketiga untuk selisih yang bisa dihitung dari keduanya adalah angka yang berbeda dari
 * sumbernya suatu hari.
 *
 * KENAPA INI HARUS MASUK RANTAI LABA. Laba Rugi menghitung pendapatan dari apa yang DILAPORKAN
 * Google, dan berhenti di situ. Untuk domain yang dibayar ke rekening lokal itu memang cukup:
 * yang dilaporkan dan yang mendarat sama besar. Untuk psaonlineappointment.com — yang dibayar
 * lewat bank Pakistan, kena pajak pemerintah 10%, fee perantara 5%, lalu dikonversi dua kali —
 * yang mendarat 17,5% LEBIH KECIL: Rp 7.036.271 pada Juli 2026 saja, Rp 14,4 juta sepanjang
 * Mei–Juli. Tanpa baris ini, seluruh uang itu dilaporkan sebagai laba yang tidak pernah ada, dan
 * bonus advertiser dihitung dari dasar yang mengandungnya.
 *
 * DAN INI BUKAN ATURAN "AKUN PAKISTAN". Tidak ada satu pun tempat di dashboard ini yang tahu
 * sebuah akun ada di negara mana — kolom `negara` di `gamAccounts` diketik orang dan justru KOSONG
 * untuk psaonlineappointment.com, sementara `reportTimeZone` dan `saldoCurrency` menjawab setelan
 * akun dan bukan negara pemiliknya. Aturannya karena itu tidak menanyakan negara sama sekali: ia
 * menanyakan berapa yang hilang di jalan, dan menemukan domainnya sendiri. Domain yang dibayar
 * langsung ke bank lokal kehilangan nol dan tidak dipotong apa pun; rantai asing kedua yang muncul
 * tahun depan ikut terpotong pada hari pencairannya dicatat, tanpa satu baris kode pun berubah.
 *
 * HANYA BARIS YANG REAL MASUK-NYA BENAR-BENAR DIKETIK. `payoutRows` menjatuhkan Real Masuk yang
 * kosong ke angka TURUNAN (Earning Final), dan memungut fee atas angka turunan berarti memotong
 * laba dengan biaya yang belum tentu terjadi — untuk pencairan yang belum mendarat, "berapa yang
 * hilang di jalan" memang belum punya jawaban. Yang tidak diketahui tidak dipotong, bukan dipotong
 * nol: bulan berjalan tidak punya baris pencairan sama sekali, dan potongannya menyusul bersama
 * barisnya, sepola dengan invalid traffic dan `accountCloses`.
 */
export function payoutCostRows(store = {}) {
  const items = Array.isArray(store?.payouts) ? store.payouts : [];
  const derived = payoutRows(items, store);
  const costs = [];

  for (const [index, row] of derived.entries()) {
    // Diperiksa pada baris ASLINYA, bukan pada yang sudah diturunkan: `payoutRows` menimpa
    // `realMasuk` dengan angka turunannya begitu kotaknya kosong, jadi baris yang belum mendarat
    // tidak bisa lagi dibedakan dari yang sudah mendarat setelah lewat sana.
    if (!hasAmount(items[index]?.realMasuk)) continue;
    if (!row?.month || row.saldoAkhir === "") continue;

    const cost = round(toAmount(row.realMasuk) - toAmount(row.saldoAkhir));
    // Nol dilewati diam-diam — rekening lokal, tidak ada yang hilang di jalan. Minus tidak bisa
    // lahir dari rantainya sendiri (fee dan potongan konversi keduanya tidak negatif), dan yang
    // diketik minus akan MENAMBAH laba lewat pintu belakang.
    if (cost <= 0) continue;
    costs.push({ month: row.month, domain: normalize(row.domain), cost, label: row.domain });
  }

  return costs;
}

/**
 * Bulan sebuah baris potongan pencairan — dibaca lewat `monthOf` yang sama dengan tabel Pencairan,
 * dan DIEKSPOR karena `partialMonthsIn` di Laba Rugi dan Cash Flow memerlukannya: potongan ini
 * berdiri per BULAN, jadi ia hanya ikut kalau rentangnya menutup bulan itu penuh — aturan yang
 * sama persis dengan invalid traffic dan earning akun yang ditutup. Rentang tujuh hari yang
 * menanggung potongan pencairan sebulan penuh menghasilkan laba minus karena rentangnya, bukan
 * karena usahanya.
 */
export function payoutCostMonth(row) {
  return monthOf(row);
}

// Bulan-bulan yang punya baris `accountCloses`. Diturunkan dari barisnya sendiri, bukan dari rentang
// yang sedang dibuka: `earningByDomainMonth` mengisi SELURUH riwayat sekali, dan yang menyaring
// periodenya adalah pemanggilnya.
function accountCloseMonths(rows) {
  const months = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    const month = accountCloseMonth(row);
    if (month) months.add(month);
  }
  return months;
}
