import { accountCloseEntries, accountCloseKey, accountCloseMonth } from "./accountClose.js";
import { MIN_ROI_SPEND, roiPercent } from "./adTax.js";
import { bonusPercentIndex } from "./bonusPercent.js";
import { companyPercentIndex } from "./companyPercent.js";
import { dateKeyOf, monthKey, partialMonthsIn, rowsInRange, wholeMonthsIn } from "./dateRange.js";
import {
  AD_EXCHANGE,
  ADSENSE,
  domainIndex,
  normalize,
  sourceSplit,
  spreadByEarning,
} from "./earningByAccountType.js";
import {
  invalidTrafficMonth,
  invalidTrafficTotal,
  spreadInvalidTraffic,
} from "./invalidTraffic.js";
import { hasAmount, round, sumBy } from "./numbers.js";
import { bonusOperatingExpense, expenseTotal, spreadOperatingExpense } from "./operatingExpense.js";
import { payoutCostRows, payoutRows } from "./payouts.js";
import { toAmount } from "./toAmount.js";

/**
 * Cash Flow Management: rantai Laba Rugi yang DIPECAH sampai ke baris penyusunnya — satu baris per
 * (BULAN, ADVERTISER, JENIS AKUN, SUBDOMAIN).
 *
 *   Earning Bruto    = Earning − (Ad Spend + Ad Tax)
 *   Net Profit       = Earning Bruto − Potongan Company − Invalid Traffic − Potongan Pencairan
 *   Bonus            = Bonus % × (Net Profit − Biaya Operasional)
 *   Net Income Owner = Net Profit − Bonus advertiser
 *
 * Halaman `/profit-loss` menjawab "bulan ini menghasilkan berapa" dengan satu kolom angka; halaman
 * ini menjawab "dari mana angka itu datang, dan siapa yang menghasilkannya". Keduanya rantai yang
 * SAMA — itu sebabnya modul ini tidak menghitung ulang satu aturan pun, melainkan memakai yang
 * sudah ada:
 *
 *   `sourceSplit`          memecah earning ke Ad Exchange/AdSense DAN membagi belanjanya sebanding
 *                          (earningByAccountType.js — dipakai Invalid Traffic dan Target juga)
 *   `domainIndex`          subdomain -> domain induk, lewat `parentDomain` lalu akhiran
 *   `companyPercentIndex`  tarif Company yang berlaku pada TANGGAL baris itu
 *   `invalidTrafficTotal`  jumlah Check 1-3 sebuah baris invalid traffic
 *   `roiPercent`           ROI berikut lantai belanjanya (MIN_ROI_SPEND)
 *   `bonusPercents`        tarif bonus tiap advertiser, bertanggal (`users.bonusPercent` sebelumnya)
 *
 * TIDAK ADA satu pun angka yang diketik ulang, dan tidak ada koleksi baru. Spreadsheet acuannya
 * meminta Earning dan Ad Spend diinput tangan per subdomain per bulan; di sini keduanya sudah ada
 * di `roiReports` — satu baris per hari per subdomain, lengkap dengan PIC dan rincian sumber
 * earning-nya. Angka yang diketik ulang adalah angka yang berbeda dari sumbernya suatu hari, tanpa
 * satu pun tanda di layar.
 *
 * Diturunkan saat DIRENDER, tidak ditulis ke RTDB — alasan yang sama dengan kolom turunan Invalid
 * Traffic dan Target: sync berikutnya menggeser earning bulan berjalan, dan angka yang tersimpan
 * akan benar pada detik ia ditulis lalu basi sesudahnya.
 *
 * TIGA HAL YANG SENGAJA BERBEDA DARI SPREADSHEET ACUAN, dan ketiganya mengikuti aturan yang sudah
 * berlaku di dashboard ini:
 *
 *   Potongan Company tidak kena AdSense. Spreadsheet-nya memotong satu baris AdSense (Mei,
 *     marriage.psaonlineappointment.com, 5%); potongan ini kena pendapatan Ad Exchange saja, dan
 *     `migrations/seed-company-percents.mjs` sudah menyebut baris itu sebagai yang tidak akan
 *     direproduksi.
 *   Tarifnya dicari PER HARI, bukan sekali per bulan. Domain yang di-relink di tengah bulan punya
 *     dua tarif, dan mengalikan earning sebulan dengan salah satunya memindahkan ratusan ribu
 *     rupiah tanpa satu pun tanda di layar. Karena itu kolom Company % bisa berbunyi "10% → 20%".
 *   Kolom yang tidak ikut: "Update Data" (baris ini tidak diketik siapa pun, jadi tidak ada yang
 *     bisa distempel), "Penurunan Earning" (kosong di seluruh 76 baris acuan), blok "Invalid
 *     Traffict" KEDUA (angkanya sama persis dengan yang pertama di tiap baris), "Ket" (teks bebas
 *     yang tidak punya tempat di baris turunan), ketiga kolom "Checking" (yang diperiksanya adalah
 *     bonus% + owner% = 100%, dan di sini identitas itu benar menurut konstruksi), dan kolom MONTH
 *     — yang menyebutkan bulannya adalah pemilih di kepala halaman, sekali untuk seluruh tabel,
 *     sepola dengan Target dan Cost Ad Exchange.
 */

/**
 * Baris + total satu bulan.
 *
 * `store` menyediakan semuanya: `roiReports` (earning, belanja, PIC per hari per subdomain),
 * `subDomains`/`domains` (domain induk), `companyPercents` (tarif bertanggal), `invalidTraffic`
 * (nominal per domain per bulan per jenis), dan `users` (tarif bonus).
 */
export function buildCashFlow(store = {}, range = {}) {
  const period = { from: dateKeyOf(range?.from), to: dateKeyOf(range?.to) };
  // Dua sumber di rantai ini berdiri per BULAN dan tidak bisa dibelah per hari: nominal invalid
  // traffic dan earning akun yang ditutup. Keduanya ikut hanya kalau rentangnya MENUTUP bulan itu
  // penuh — aturan yang sama dengan Laba Rugi, lewat `wholeMonthsIn` yang sama.
  const months = wholeMonthsIn(period);
  const buckets = collectBuckets(store, period, months);
  // Nominal yang tidak bisa dibagikan ke satu ember pun: domain yang bulan itu dicek tapi tidak
  // menghasilkan sepeser pun. Ia tetap dikurangkan di Laba Rugi, jadi menyembunyikannya di sini
  // berarti dua halaman bertetangga menyebut angka berbeda untuk uang yang sama.
  const { unspread } = spreadTrafficInto(buckets, store, months);
  // Potongan pencairan — fee rekening perantara + konversi + pajak negara asal — dibagi ke ember
  // yang menghasilkan uangnya, dengan pembagi yang SAMA. Sepola dengan invalid traffic di atasnya,
  // dan wajib lewat modul yang sama: dua pembagi untuk uang yang sama sudah pernah membuat halaman
  // ini dan Laba Rugi menyebut dua angka berbeda untuk April 2026.
  const { unspread: payoutUnspread } = spreadPayoutCostInto(buckets, store, months);
  // Porsi pengeluaran operasional tiap baris — sejak Juli 2026 saja, dan lewat modul yang sama
  // yang dipakai Laba Rugi. Ia TIDAK masuk kolom Net Profit (yang di sana tetap berhenti di
  // potongan pencairan); yang disentuhnya cuma dasar bonus, dan kolomnya sendiri yang membuat itu
  // terbaca alih-alih harus dipercaya.
  const { unspread: opexUnspread } = spreadOperatingExpenseInto(buckets, store, period);

  // Rantainya sampai Net Profit dulu, bonusnya belakangan: tarif bonus dikalikan dengan dasar
  // SEBULAN milik orang itu, jadi ia tidak bisa dihitung sebelum seluruh barisnya ada.
  const base = [...buckets.values()].map(baseRow);

  // Tarif bulan TERAKHIR rentangnya, sama persis dengan `buildProfitLoss` — lihat catatannya di sana.
  const percentAt = bonusPercentIndex(store?.bonusPercents, store?.users);
  const bonusOf = (picKey) => percentAt(picKey, period.to);
  // Dasar bonus tiap advertiser: JUMLAH net profit seluruh barisnya bulan itu, bukan baris per
  // baris. Itu yang dipakai `splitByOwner` di profitLoss.js, dan yang membuat kolom Bonus di sini
  // berjumlah persis sebesar baris "Bonus advertiser" di Laba Rugi.
  //
  // Bedanya cuma satu, dan itu satu-satunya alasan agregat ini dihitung sama sekali: TIDAK ADA
  // BONUS DARI KERUGIAN. Spreadsheet acuannya mengalikan tarif dengan net profit tiap baris apa
  // adanya, jadi baris yang rugi menghasilkan bonus NEGATIF — advertiser membayar balik ke owner.
  // Selama bulan orang itu secara keseluruhan untung kedua cara menjawab sama (tarif × jumlah =
  // jumlah tarif × masing-masing), jadi baris minus di tengah bulan yang untung TETAP mengurangi
  // bonusnya; yang berbeda cuma bulan yang seluruhnya rugi, dan di sana Laba Rugi menjawab nol.
  const bonusBase = new Map();
  for (const row of base) {
    bonusBase.set(row.picKey, round((bonusBase.get(row.picKey) || 0) + bonusBaseOf(row)));
  }

  const rows = base
    .map((row) => withBonus(row, bonusOf, bonusBase))
    .sort(
      (a, b) =>
        a.pic.localeCompare(b.pic) ||
        a.domain.localeCompare(b.domain) ||
        a.accountType.localeCompare(b.accountType) ||
        b.earning - a.earning,
    );

  return {
    range: period,
    months,
    rows,
    totals: {
      ...cashFlowTotals(rows),
      invalidTrafficUnspread: unspread,
      payoutCostUnspread: payoutUnspread,
      // Biaya operasional bulan ini yang tidak punya satu ember pun untuk dibagi: bulan yang punya
      // tagihan tapi belum punya satu baris ROI. Disebutkan, sepola dengan dua di atasnya.
      operatingExpenseUnspread: opexUnspread,
    },
  };
}

/**
 * Tiga kelompok arus kas sebulan: yang masuk, yang keluar, dan yang tersisa.
 *
 * Berdiri TERPISAH dari `buildCashFlow` dan sengaja TIDAK ikut penyaring tabel. Empat dari
 * sembilan itemnya tidak punya pemilik sama sekali — biaya operasional, biaya approval, akun yang
 * ditutup Google, dan sebagian top-up — jadi memilih satu advertiser akan menyempitkan lima item
 * dan membiarkan empat lainnya utuh. Kartu yang setengahnya tersaring adalah kartu yang tidak bisa
 * dijumlahkan pembacanya, dan tidak ada apa pun di layar yang bisa menjelaskan selisihnya. Yang
 * ikut menyempit tetap baris Total di tabel.
 *
 * `totals` dioper dari `buildCashFlow` bulan yang sama supaya baris ROI tidak disisir dua kali.
 *
 * KOSONG BUKAN NOL, dan di sini itu bukan kehalusan: `invalidTraffic` belum diinput sejak Agustus
 * dan `payouts` berhenti di Juli. Rp 0 di kedua baris itu adalah klaim bahwa bulan ini bersih dari
 * invalid traffic dan tidak ada akun yang ditutup — dua pernyataan yang cuma boleh dibuat orang
 * yang sudah memeriksanya. Yang membedakannya: ADA tidaknya baris, bukan besar nominalnya. Dua
 * baris Cost Ad Exchange Juli yang keduanya "Garansi Delink" (tidak ditagih) berbunyi Rp 0, dan
 * nol itu benar.
 */
export function cashFlowSummary(store = {}, range = {}, report = {}, business = null) {
  // Bulan TANPA satu pun baris ROI tidak menghasilkan Rp 0 di keempat item yang lahir darinya —
  // April 2026 punya top-up dan biaya tapi `roiReports` baru dimulai Mei, dan "Earning Google
  // Rp 0" di sana adalah klaim bahwa bulan itu tidak menghasilkan apa-apa. Yang membedakannya dari
  // nol yang sah adalah ADA tidaknya barisnya, bukan besar totalnya.
  const totals = (report?.rows?.length ?? 0) > 0 ? report.totals || {} : {};
  const period = { from: dateKeyOf(range?.from), to: dateKeyOf(range?.to) };
  // Bulan yang tertutup PENUH — dioper dari `buildCashFlow` supaya kartu dan tabel di bawahnya tidak
  // pernah memakai daftar bulan yang berbeda.
  const months = new Set(report?.months || wholeMonthsIn(period));
  const topupRows = rowsInRange(store?.whitelistTopup, period);
  const expenseRows = rowsInRange(store?.expenses, period);
  const adxRows = rowsInRange(store?.adxCosts, period);
  const trafficRows = (store?.invalidTraffic || []).filter((row) =>
    months.has(invalidTrafficMonth(row)),
  );
  // Baris pencairan bulan-bulan itu — dari `payoutRows`, modul yang sama dengan halaman Laporan
  // Pencairan Rekening, karena di situlah sebuah domain ditandai "Account Close". Berdiri per BULAN
  // juga, jadi ia mengikuti aturan yang sama: hanya bulan yang tertutup penuh.
  const payouts = payoutRows(store?.payouts, store).filter((row) => months.has(row.month));

  const topup = topupRows.length ? sumBy(topupRows, topupAmount) : "";
  const expenses = expenseRows.length ? sumBy(expenseRows, expenseTotal) : "";
  const approval = adxRows.length ? sumBy(adxRows, (row) => toAmount(row.nominal)) : "";
  const traffic = trafficRows.length ? sumBy(trafficRows, invalidTrafficTotal) : "";
  // TOTAL AKUN CLOSE = jumlah kolom Saldo Close di tab Pencairan — saldo yang HANGUS karena
  // akunnya ditutup Google, dan definisi yang sama dengan sheet "Dashboard" (SUMIFS kolom K
  // 'DatMas | Laporan Pencairan'). Mei 2026 berbunyi Rp 70.514.530 di keduanya.
  const accountClose = saldoCloseTotal(payouts);
  /**
   * Pendapatan dan belanja BERSKALA USAHA, dioper dari `buildProfitLoss` untuk rentang yang sama.
   *
   * Tidak dihitung ulang di sini, dan itu bukan kehematan: rantai keduanya panjang — titik harian
   * `weeklyFinancials`, ditambah earning akun yang sudah ditutup Google yang tidak ada di sana,
   * dikurangi baris yang bulannya tidak tertutup penuh. Disalin, tab ini dan Laba Rugi akan
   * menyebut dua angka untuk uang yang sama dan tidak ada apa pun di layar yang bisa menerangkan
   * selisihnya.
   *
   * Tanpa `business` (pemanggil lama, dan tes yang cuma menguji sisi lain kartu ini) keduanya jatuh
   * ke jumlah baris ROI — lebih kecil, tapi tidak pernah karangan.
   */
  const businessRevenue = hasAmount(business?.revenue) ? business.revenue : (totals.earning ?? "");
  const businessSpend = hasAmount(business?.totalAdSpend)
    ? business.totalAdSpend
    : (totals.totalSpending ?? "");
  // Potongan pencairan bulan-bulan itu, NOMINAL PENUH — bukan yang berhasil dibagi ke ember.
  // Aturan yang sama dengan Invalid Traffic di kartu ini: yang keluar dari kantong keluar utuh,
  // dan pembagiannya ke advertiser cuma menentukan bonus siapa yang berkurang.
  const payoutCostList = payoutCostRows(store).filter((row) => months.has(row.month));
  const payoutCost = payoutCostList.length ? sumBy(payoutCostList, (row) => row.cost) : "";

  const inflow = [
    {
      key: "topup",
      label: "Total TopUp Saldo Meta Ads",
      source: "Total TopUp semua akun WL — input manual (nominal + fee)",
      value: topup,
    },
    {
      key: "earning",
      label: "Pendapatan Kotor Google",
      // BERSKALA USAHA — seluruh akun GAM/AdSense, tanpa syarat pemetaan campaign — bukan jumlah
      // baris ROI di tabel bawah. Itu yang dijawab sheet "Dashboard", dan itu juga baris Pendapatan
      // di Laba Rugi: angkanya datang dari `buildProfitLoss` yang SAMA, bukan dihitung ulang di
      // sini, jadi kedua tab tidak bisa menyebut dua angka untuk uang yang sama.
      source: "Pendapatan dari semua akun — API Google",
      value: businessRevenue,
    },
  ];

  const outflow = [
    {
      key: "spending",
      label: "Total Spending",
      // Spend Meta berikut pajak iklannya, satu angka — itu yang benar-benar keluar dari kantong.
      // BERSKALA USAHA, sepasang dengan Pendapatan Kotor Google di atasnya: seluruh ad account,
      // tanpa syarat pemetaan campaign. Karena itu ia LEBIH BESAR daripada baris Total di tabel
      // bawah, yang cuma memuat campaign yang kodenya terdaftar — selisihnya `coverageGap`, dan
      // Laba Rugi sudah menyebutkannya di layarnya sendiri.
      source: "API Meta Ads + pajak iklan",
      value: businessSpend,
    },
    {
      key: "company",
      label: "Total Potongan Company",
      // BUKAN dari API Google, walau angkanya lahir dari pendapatan Google: tarifnya diketik orang
      // di tab Potongan Company. Label yang menyebut API akan mengirim orang mencari sumber yang
      // tidak ada pada hari angkanya terasa aneh.
      source: "Input manual (tarif) × earning Ad Exchange",
      value: totals.company ?? "",
    },
    { key: "traffic", label: "Total Invalid Traffic", source: "Input manual", value: traffic },
    {
      key: "bonus",
      // Nama dari sheet, yang menyebutnya "TOTAL % Advertiser". Ia RUPIAH, bukan persen — dan yang
      // menjelaskannya adalah keterangan sumbernya, karena kosakata sheet itulah yang dipakai tim
      // saat mengadu angka.
      label: "Total % Advertiser",
      source: "Bonus advertiser — rumus",
      value: totals.bonus ?? "",
    },
    {
      key: "payoutCost",
      label: "Potongan Pencairan",
      // Fee rekening perantara + potongan konversi + pajak negara asal — dua kolom yang diketik di
      // tab Pencairan, di baris domain yang sama. Yang menjawabnya bukan API mana pun: Google
      // melaporkan apa yang ia BAYARKAN, dan yang hilang sesudahnya cuma terbaca di mutasi rekening.
      source: "Real Masuk − Saldo Akhir di tab Pencairan",
      value: payoutCost,
    },
    {
      key: "expenses",
      label: "Total Biaya Beban (Expense)",
      source: "Input manual",
      value: expenses,
    },
    { key: "approval", label: "Biaya Approval", source: "Input manual", value: approval },
    {
      key: "accountClose",
      label: "Total Akun Close",
      source: "Jumlah Saldo Close di tab Pencairan",
      value: accountClose,
    },
  ];

  // Yang tidak diketahui DILEWATI, bukan ditambahkan: `"" + 100` bukan 101 melainkan teks "0100".
  const inflowTotal = totalOf(inflow);
  const outflowTotal = totalOf(outflow);

  const balance = runningBalance(store, period, business);

  /**
   * KOLOM HASIL — rantai berjenjang, mengikuti kolom H sheet "Dashboard" (DASHBOARD DATA CENTER).
   *
   * Tiap barisnya bisa dihitung ulang dari kolom di sebelah kirinya, dan itu syaratnya: kartu yang
   * memuat angka yang tidak bisa diturunkan dari apa pun yang terlihat akan diadu pembacanya
   * dengan spreadsheet-nya sendiri dan tidak pernah cocok.
   *
   * YANG TIDAK DIKETAHUI DILEWATI SEBAGAI NOL DI SINI, bukan mengosongkan seluruh rantai — aturan
   * yang sama dengan `netIncomeOwner` sejak awal. Invalid traffic belum diinput sejak Agustus dan
   * baris pengeluaran tidak selalu ada; mengosongkan Laba Kotor karena salah satunya belum ada
   * berarti kartu ini kosong hampir sepanjang tahun. Yang mengabarkan bahwa ia belum utuh adalah
   * hitungan item kosong di kaki kolom sebelah, bukan garis kosong di sini.
   */
  const known = (value) => (hasAmount(value) ? toAmount(value) : 0);
  // Bulan tanpa satu pun baris ROI: seluruh rantai ini lahir dari earning, dan earning yang tidak
  // diketahui bukan nol.
  const hasEarning = hasAmount(businessRevenue);

  const grossGoogle = hasEarning ? round(businessRevenue - known(businessSpend)) : "";
  // Sheet: LABA KOTOR GOOGLE − Company − Invalid Traffic − % Advertiser − Biaya Beban. Berhenti
  // SEBELUM akun yang ditutup, potongan pencairan, dan biaya approval — ketiganya baru masuk di
  // Net Income Owner, dan urutan itulah yang membuat kedua angka bisa dibedakan pembacanya.
  const netGoogle =
    grossGoogle === ""
      ? ""
      : round(
          grossGoogle -
            known(totals.company) -
            known(traffic) -
            known(totals.bonus) -
            known(expenses),
        );
  const result = [
    {
      key: "balance",
      label: "Saldo Iklan Meta Ads",
      // SALDO BERJALAN, bukan selisih bulan itu saja — sengaja BERBEDA dari sheet, yang menghitung
      // TopUp − Spending bulan berjalan lalu menambahkan catatan "jika minus berarti ada sisa saldo
      // di bulan sebelumnya". Catatan itu mengakui bahwa angkanya tidak menjawab pertanyaannya:
      // Juli 2026 membelanjakan Rp 140,3 juta atas top-up Rp 137,5 juta karena sisa Juni masih ada
      // di akunnya, dan versi sebulan berbunyi −Rp 2,7 juta untuk akun yang berisi Rp 26 juta.
      source: "Sisa bulan lalu + TopUp WL − Spending",
      value: balance,
    },
    {
      key: "grossGoogle",
      label: "Laba Kotor Google",
      source: "Pendapatan Kotor Google − Spending",
      value: grossGoogle,
    },
    {
      key: "netGoogle",
      label: "Pendapatan Bersih Google",
      source: "Laba Kotor − Invalid Traffic − % Advertiser − Biaya Beban − Company",
      value: netGoogle,
    },
  ];

  /**
   * KEPALA KARTU — Cash Inflow, Cash Outflow, dan selisihnya, sepola baris 4-6 sheet "Dashboard".
   *
   * Ketiganya MENJUMLAHKAN KOLOM YANG BERDIRI DI BAWAHNYA, jadi pembacanya bisa memeriksanya
   * sendiri. Sheet menghitung Cash Inflow dari pendapatan Google saja sementara kolomnya memuat
   * top-up juga; angka kepala yang tidak sama dengan jumlah kolom di bawahnya adalah kartu yang
   * tidak bisa diadu dengan apa pun, termasuk dirinya sendiri.
   */
  const headline = [
    { key: "inflow", label: "Cash Inflow", value: inflowTotal, flow: "in" },
    { key: "outflow", label: "Cash Outflow", value: outflowTotal, flow: "out" },
    {
      key: "statement",
      label: "Result",
      value: round(inflowTotal - outflowTotal),
      flow: "net",
    },
  ];

  return {
    inflow,
    inflowTotal,
    outflow,
    outflowTotal,
    // Berapa item yang belum punya datanya sama sekali. Totalnya tetap dijumlah dari yang ada —
    // yang mengabarkan bahwa ia belum utuh adalah angka ini, bukan Rp 0 di salah satu barisnya.
    inflowUnknown: inflow.filter((item) => item.value === "").length,
    outflowUnknown: outflow.filter((item) => item.value === "").length,
    headline,
    result,
    resultUnknown: result.filter((item) => item.value === "").length,
    // Bulan yang punya baris bulanan tapi rentangnya tidak menutupnya penuh, jadi Invalid Traffic
    // dan Akun Close Cut-nya tidak ikut. Disebutkan di layar, sepola dengan Laba Rugi.
    partialMonths: partialMonthsIn(period, [
      { rows: store?.invalidTraffic, monthOf: invalidTrafficMonth },
      { rows: store?.accountCloses, monthOf: accountCloseMonth },
      { rows: store?.payouts, monthOf: (row) => payoutMonthOf(row) },
    ]),
  };
}

// Bulan sebuah baris pencairan, sepola dengan `invalidTrafficMonth` dan `accountCloseMonth`.
function payoutMonthOf(row) {
  const month = String(row?.month ?? "").trim();
  return /^\d{4}-\d{2}$/.test(month) ? month : monthKey(row?.date);
}

/**
 * Melipat baris `accountCloses` — earning bulanan yang DIKETIK — ke ember yang sama dengan baris
 * ROI, supaya sisa modul ini tidak pernah tahu bedanya.
 *
 * Di situlah letak seluruh gagasannya: sebuah subdomain yang akun Google-nya sudah ditutup tidak
 * butuh cabang perhitungan sendiri, cuma butuh angkanya masuk. Begitu masuk, tarif Company
 * bertanggal, pembagian invalid traffic, dasar bonus per PIC, dan "Akun Close Cut" semuanya
 * bekerja dengan aturan yang sudah ada — dan tabel Cash Flow menampilkan barisnya berdampingan
 * dengan yang lain, bukan sebagai catatan kaki di kartu.
 *
 * DUA HAL YANG MEMBEDAKANNYA DARI BARIS ROI, dan keduanya wajar untuk baris yang diketik per bulan:
 *
 *   `sourceSplit` TIDAK dipakai. Baris ROI membawa rincian `adxRevenue`/`adsenseRevenue` dan
 *     dibelah darinya; baris ini MENYEBUTKAN jenis akunnya, jadi seluruh earning-nya jatuh ke satu
 *     ember. Dibelah dengan `sourceSplit`, baris tanpa rincian akan jatuh utuh ke Ad Exchange —
 *     dan empat baris AdSense April berbunyi kena potongan Company yang tidak pernah ditagihkan.
 *   `days` DIISI 1. Ia menghitung hari yang punya laporan, dan sebulan yang diketik sebagai satu
 *     angka memang satu catatan — bukan tiga puluh. Yang membacanya cuma keterangan "aktif n dari
 *     m hari" di halaman Spending, yang tidak membaca ember ini sama sekali.
 *
 * BARIS ROI SELALU MENANG. Subdomain yang bulan itu punya laporan mengabaikan baris ketikannya
 * tanpa suara — kebalikan dari `earningManual` di Invalid Traffic, dan sengaja: yang di sana ada
 * karena laporannya BELUM lengkap, yang di sini ada karena laporannya TIDAK AKAN PERNAH ada.
 * Begitu laporannya ternyata datang, ia yang benar.
 */
function foldAccountCloses(buckets, store, months, { domainOf, rates, reported }) {
  for (const row of months.flatMap((month) => accountCloseEntries(store?.accountCloses, month))) {
    if (reported.has(accountCloseKey(row.subDomain))) continue;

    const domain = domainOf(row.subDomain);
    const percent = rates.percentAt(domain, row.date);
    const isAdx = row.accountType === AD_EXCHANGE;

    addBucket(
      buckets,
      {
        month: row.date.slice(0, 7),
        pic: row.pic,
        subDomain: row.subDomain,
        domain,
        accountType: row.accountType,
      },
      (entry) => {
        entry.earning += row.earning;
        entry.spending += row.spending;
        // AdSense TIDAK dipotong Company, aturan yang sama dengan baris ROI di atas.
        if (isAdx) {
          if (percent === null) entry.earningWithoutPercent += row.earning;
          else {
            entry.company += (row.earning * percent) / 100;
            entry.percents.add(percent);
          }
        }
        entry.days += 1;
      },
    );
  }
}

/**
 * Satu setoran top-up: kolom **Total**, yaitu nominalnya BERIKUT fee perantaranya.
 *
 * Yang dijawab kartu ini adalah arus kas, dan yang keluar dari kantong pemilik adalah keduanya —
 * fee dibayar ke rekening perantara pada hari yang sama, untuk setoran yang sama. Nominal saja
 * melaporkan Cash Inflow Juli 2026 sebesar Rp 131.000.000 untuk uang yang benar-benar berpindah
 * sebesar Rp 137.550.000; Rp 6,5 juta itu tidak muncul sebagai apa pun di kartu mana pun.
 *
 * Ini BERBEDA dari Laba Rugi, dan bedanya disengaja: di sana fee top-up tampil sebagai catatan dan
 * tidak dikurangkan, mengikuti rantai spreadsheet acuannya (`topupFee` di profitLoss.js).
 *
 * `total` adalah field turunan yang ditulis form Whitelist Top-Up (nominal + fee) dan ada di
 * seluruh 270 barisnya hari ini. Yang tidak membawanya dihitung dari kedua bagiannya — bukan
 * dijatuhkan ke nominal saja, yang akan diam-diam menghapus fee-nya.
 */
function topupAmount(row) {
  return hasAmount(row?.total)
    ? toAmount(row.total)
    : toAmount(row?.nominal) + toAmount(row?.feeTopup);
}

/**
 * Sisa saldo ad account: SALDO BERJALAN, bukan selisih bulan itu saja.
 *
 * Setoran tidak habis pada bulan ia disetor. Juli 2026 membelanjakan Rp 140.319.979 atas top-up
 * Rp 137.550.000 — bukan karena ada uang yang muncul entah dari mana, melainkan karena sisa Juni
 * masih ada di akunnya. Dihitung per bulan, angkanya berbunyi −Rp 2.769.979: sebuah saldo minus
 * untuk akun yang sebenarnya masih berisi Rp 26 juta, dan tidak ada apa pun di layar yang bisa
 * menjelaskannya.
 *
 * Jadi keduanya diakumulasi sejak baris paling awal yang ada: Σ top-up − Σ belanja, sampai dengan
 * bulan yang sedang dibuka. Selisih tiap bulannya tetap persis dua item yang berdiri di kartu ini
 * (TopUp WL − Spending), jadi saldo bulan ini masih bisa diadu dengan saldo bulan lalu tanpa
 * membuka apa pun.
 *
 * Belanjanya disaring dengan aturan yang SAMA PERSIS dengan item Spending di atasnya
 * (`collectBuckets`: earning dan belanja sama-sama diketahui) — kalau tidak, dua angka yang
 * bertetangga di satu kartu akan berselisih tanpa sebab yang terbaca. Hari ini kedua saringan itu
 * menjawab sama di tiap bulan; yang menjaganya tetap sama adalah aturannya, bukan kebetulan itu.
 *
 * DUA HAL YANG DIKETAHUI DAN DITERIMA. Pertama, top-up hanya untuk akun whitelist sementara
 * belanja mencakup seluruh ad account — akumulasi membuat selisih itu ikut menumpuk, bukan
 * menghilang. Kedua, akumulasinya mulai dari data yang ADA: `whitelistTopup` dimulai April 2026
 * dan `roiReports` baru Mei, jadi saldo apa pun yang sudah berdiri di akun sebelum April tidak
 * terhitung di sini.
 *
 * Butuh KEDUA sisinya, sepola dengan versi per bulannya: tanpa satu pun baris top-up, "nol
 * dikurangi belanja" adalah klaim bahwa seluruh belanja keluar dari saldo yang tidak pernah
 * disetor.
 */
function runningBalance(store, { to }, business) {
  // Diakumulasi SAMPAI DENGAN hari terakhir rentangnya. Batas awalnya sengaja diabaikan: yang
  // dijawab kolom ini adalah "berapa yang masih ada di akun pada akhir periode ini", dan saldo tidak
  // lahir pada tanggal orang membuka laporannya.
  if (!to) return "";

  let topup = 0;
  let topupRows = 0;
  for (const row of store?.whitelistTopup || []) {
    const key = dateKeyOf(row?.date);
    if (!key || key > to) continue;
    topup += topupAmount(row);
    topupRows += 1;
  }

  // Belanjanya disaring dengan aturan yang SAMA dengan item Total Spending di atasnya — sekarang
  // berskala USAHA, dari titik harian `weeklyFinancials`. Dua angka bertetangga di satu kartu yang
  // berselisih tanpa sebab yang terbaca lebih buruk daripada satu angka yang kurang presisi, dan di
  // sini yang lebih presisi justru yang berskala usaha: yang keluar dari akun iklan adalah SELURUH
  // belanjanya, bukan cuma campaign yang kodenya sudah terdaftar.
  //
  // `business.spendUpTo` menghitungnya sekali di pemanggil, dari sumber yang sama dengan Laba Rugi.
  // Tanpa itu (pemanggil lama) ia jatuh ke jumlah baris ROI, sepola dengan `businessSpend`.
  let spending = 0;
  let spendingRows = 0;
  if (hasAmount(business?.spendUpTo)) {
    spending = toAmount(business.spendUpTo);
    spendingRows = 1;
  } else {
    for (const row of store?.roiReports || []) {
      const key = dateKeyOf(row?.date);
      if (!key || key > to) continue;
      if (!hasAmount(row?.earning) || !hasAmount(row?.totalSpending)) continue;
      spending += toAmount(row.totalSpending);
      spendingRows += 1;
    }
  }

  return topupRows && spendingRows ? round(topup - spending) : "";
}

/**
 * Jumlah Saldo Close baris-baris pencairan itu.
 *
 * KOSONG BUKAN NOL, dan pembedaannya sama dengan `accountCloseCut` sebelumnya: bulan yang belum
 * punya satu pun baris pencairan belum pernah menyatakan apa-apa tentang akun yang ditutup, dan
 * Rp 0 di sana tidak bisa dibedakan dari bulan yang memang tidak menutup akun apa pun. Satu baris
 * yang Saldo Close-nya tidak bisa dihitung mengosongkan SELURUH itemnya, bukan cuma bagiannya:
 * yang tersisa kalau tidak adalah angka yang tampak lengkap dan diam-diam kurang satu domain.
 */
function saldoCloseTotal(rows) {
  if (!rows.length) return "";
  let total = 0;
  for (const row of rows) {
    if (!hasAmount(row?.saldoClose)) return "";
    total += toAmount(row.saldoClose);
  }
  return round(total);
}

function totalOf(items) {
  return round(items.reduce((total, item) => total + (Number(item.value) || 0), 0));
}

// --- pengumpulan ------------------------------------------------------------------------------

/**
 * Baris ROI HARIAN bulan itu, dijumlahkan per (advertiser, jenis akun, subdomain).
 *
 * Kenapa harian dan bukan sekali per bulan: tarif Company punya tanggal berlaku, jadi potongannya
 * harus dihitung pada hari yang tarifnya berlaku lalu dijumlahkan — persis `splitByOwner` di
 * profitLoss.js.
 *
 * Baris tanpa earning DILEWATI BERIKUT BELANJANYA, aturan yang sama dengan `earningBuckets`: tanpa
 * earning tidak ada yang bisa menentukan sumbernya, dan belanja yang dijatuhkan ke sembarang jenis
 * menghasilkan Net Profit yang salah di dua baris sekaligus.
 */
function collectBuckets(store, period, months) {
  const domainOf = domainIndex(store);
  const rates = companyPercentIndex(store?.companyPercents);
  const picOf = subDomainPicIndex(store?.subDomains);
  const buckets = new Map();
  // Subdomain yang bulan ini PUNYA laporan. Baris ketikan untuk salah satunya diabaikan — lihat
  // `foldAccountCloses`.
  const reported = new Set();

  for (const row of rowsInRange(store?.roiReports, period)) {
    if (!hasAmount(row?.earning)) continue;

    const subDomain = String(row?.subDomain || "").trim();
    if (!subDomain) continue;
    reported.add(accountCloseKey(subDomain));

    const earning = toAmount(row.earning);
    // Belanja yang tidak diketahui menambah NOL, dan barisnya dihitung: yang mengabarkannya bukan
    // angka nol di kolom belanja (yang tidak bisa dibedakan dari hari yang memang tidak beriklan)
    // melainkan keterangan di bawah nama subdomainnya.
    const spendKnown = hasAmount(row?.totalSpending);
    const spend = spendKnown ? toAmount(row.totalSpending) : 0;
    const split = sourceSplit(row, earning);
    const domain = domainOf(subDomain);
    const pic = String(row?.pic || picOf(subDomain) || "").trim();
    // Tarif dicari sekali per baris HARIAN, lalu dipakai kedua ember di bawahnya — yang kena cuma
    // ember Ad Exchange, tapi tanggalnya sama.
    const percent = rates.percentAt(domain, row?.date);

    const month = monthKey(row?.date);
    addBucket(buckets, { month, pic, subDomain, domain, accountType: AD_EXCHANGE }, (entry) => {
      entry.earning += split.adx;
      entry.spending += spend * split.adxShare;
      if (percent === null) entry.earningWithoutPercent += split.adx;
      else {
        entry.company += (split.adx * percent) / 100;
        entry.percents.add(percent);
      }
      if (!spendKnown) entry.daysWithoutSpend += 1;
      entry.days += 1;
    });

    // AdSense TIDAK dipotong Company — lihat catatan di kepala berkas. Nol di kolom itu adalah
    // jawaban yang benar, bukan tarif yang belum diisi.
    addBucket(buckets, { month, pic, subDomain, domain, accountType: ADSENSE }, (entry) => {
      entry.earning += split.adsense;
      entry.spending += spend * split.adsenseShare;
      if (!spendKnown) entry.daysWithoutSpend += 1;
      entry.days += 1;
    });
  }

  foldAccountCloses(buckets, store, months, { domainOf, rates, reported });

  // Ember yang benar-benar kosong dibuang. `earningBuckets` justru MEMBUAT keduanya walau salah
  // satunya nol, dan di sana itu benar: yang ditanyakan halaman Invalid Traffic adalah "berapa
  // pendapatan AdSense domain ini bulan itu", dan Rp 0 adalah jawaban yang berbeda dari "-". Di
  // sini pertanyaannya lain — satu baris adalah satu subdomain yang menghasilkan uang — dan ember
  // nol menggandakan seluruh tabel dengan baris yang tidak menyebut apa pun.
  for (const [key, entry] of buckets) {
    if (entry.earning === 0 && entry.spending === 0) buckets.delete(key);
  }

  return buckets;
}

/**
 * Nominal invalid traffic bulan-bulan itu, dibagi ke ember penyusunnya.
 *
 * Aturannya DIIMPOR dari `invalidTraffic.js` — modul yang sama yang dipakai Laba Rugi. Sampai
 * 4 Sep 2026 keduanya menulisnya sendiri-sendiri, dan keduanya sama-sama menjatuhkan nominal yang
 * tidak punya ember; yang di sana tertutupi karena kolomnya dijumlah terpisah, yang di sini tidak.
 *
 * Yang tinggal di berkas ini cuma dua hal yang memang miliknya: penyaringan bulan (baris invalid
 * traffic berdiri per bulan, dan hanya bulan yang tertutup PENUH oleh rentangnya yang ikut), dan
 * `invalidTrafficPool` — kolam pembagi yang dipakai kolom "n% dari domain" di tabelnya, yang tidak
 * punya padanan di Laba Rugi.
 */
function spreadTrafficInto(buckets, store, months) {
  const covered = new Set(months);
  const rows = (store?.invalidTraffic || []).filter((row) => covered.has(invalidTrafficMonth(row)));

  return spreadInvalidTraffic([...buckets.values()], rows, {
    domainKeyOf: (entry) => entry.domain,
    // Nominal yang ember ini IKUT dibagi. Porsinya tidak bisa dijumlahkan begitu saja: satu domain
    // bisa punya beberapa baris pengecekan dalam sebulan, dan porsi yang sama ditambahkan dua kali
    // berbunyi 86% untuk baris yang menerima 43% dari keduanya.
    onShare: (entry, nominal) => {
      entry.invalidTrafficPool += nominal;
    },
  });
}

/**
 * Potongan pencairan bulan-bulan itu, dibagi ke ember penyusunnya.
 *
 * Bahannya `payoutCostRows` — Real Masuk dikurangi Saldo Akhir pada baris `payouts`, yaitu fee
 * rekening perantara ditambah potongan konversi dan pajak negara asal. TANPA saringan jenis akun,
 * berbeda dari invalid traffic: yang dibayarkan Google ke rekening adalah satu wire untuk seluruh
 * pendapatan domain itu.
 */
function spreadPayoutCostInto(buckets, store, months) {
  const covered = new Set(months);
  const rows = payoutCostRows(store).filter((row) => covered.has(row.month));

  return spreadByEarning([...buckets.values()], rows, {
    domainKeyOf: (entry) => entry.domain,
    domainOf: (row) => row.domain,
    amountOf: (row) => row.cost,
    onShare: (entry, share) => {
      entry.payoutCost += share;
    },
  });
}

/**
 * Porsi pengeluaran operasional tiap ember — sewa server, lisensi, dan biaya penyambungan Ad
 * Exchange, sejak Juli 2026.
 *
 * Disaring per RENTANG dan bukan per bulan penuh seperti dua pembagi di atasnya: baris `expenses`
 * dan `adxCosts` bertanggal HARIAN, jadi rentang yang memotong sebuah bulan memang hanya memuat
 * tagihan yang jatuh di dalamnya. Yang perlu bulan utuh cuma sumber yang memang berdiri per bulan.
 *
 * Aturan batasnya sendiri tidak ditulis di sini melainkan di `bonusOperatingExpense` — modul yang
 * sama yang dibaca Laba Rugi, karena kolom Bonus di tabel ini harus berjumlah persis sebesar baris
 * "Bonus advertiser" di sana.
 */
function spreadOperatingExpenseInto(buckets, store, period) {
  const nominal = bonusOperatingExpense({
    expenseRows: rowsInRange(store?.expenses, period),
    adxRows: rowsInRange(store?.adxCosts, period),
  });

  return spreadOperatingExpense([...buckets.values()], nominal, {
    onShare: (entry, share) => {
      entry.operatingExpense += share;
    },
  });
}

// --- satu baris -------------------------------------------------------------------------------

function baseRow(entry) {
  const earning = round(entry.earning);
  const spending = round(entry.spending);
  const company = round(entry.company);
  const invalidTraffic = round(entry.invalidTraffic);
  const payoutCost = round(entry.payoutCost);
  const grossProfit = round(earning - spending);
  const netProfit = round(grossProfit - company - invalidTraffic - payoutCost);

  return {
    id: entry.key,
    picKey: entry.picKey,
    pic: entry.pic || "(tanpa PIC)",
    accountType: entry.accountType,
    subDomain: entry.subDomain,
    domain: entry.domain || "(tanpa domain)",
    earning,
    totalSpending: spending,
    grossProfit,
    roi: roiPercent(earning, spending),
    // Himpunan tarif yang BENAR-BENAR dipakai bulan itu, bukan satu angka: sebulan bisa memuat dua
    // tarif, dan satu angka di kolom ini harus memilih salah satunya — yang mana pun yang dipilih,
    // ia berbohong untuk separuh bulan. Sepola dengan `companyBreakdown` di profitLoss.js.
    companyPercents: [...entry.percents].sort((a, b) => a - b),
    company,
    // Earning Ad Exchange yang harinya belum punya tarif sama sekali: tidak dipotong, dan itu harus
    // terbaca sebagai "tarifnya belum diisi" dan bukan sebagai "domain ini bebas potongan".
    earningWithoutPercent: round(entry.earningWithoutPercent),
    invalidTraffic,
    invalidTrafficShare: shareOf(entry),
    payoutCost,
    netProfit,
    netRoi: returnPercent(netProfit, spending),
    /**
     * Porsi biaya operasional baris ini — bukan bagian dari Net Profit di atasnya.
     *
     * Ia SENGAJA berdiri di luar rantai kolom itu: "Akun Close Cut" di kartu menjumlahkan
     * `netProfit` domain yang ditutup, sementara Biaya Operasional sudah berdiri sebagai item
     * Cash Out tersendiri di kartu yang sama. Dimasukkan ke Net Profit, porsi milik domain yang
     * ditutup dikurangkan DUA KALI dari Net Income Owner di kartu itu, dan selisihnya tidak
     * menunjuk ke satu kolom pun yang bisa diperiksa orang.
     *
     * Yang disentuhnya cuma dasar bonus, dan kolomnya di layar yang membuat itu terbaca.
     */
    operatingExpense: round(entry.operatingExpense),
    days: entry.days,
    daysWithoutSpend: entry.daysWithoutSpend,
  };
}

/**
 * Dasar bonus sebuah baris: Net Profit dikurangi porsi biaya operasionalnya.
 *
 * Ditulis sebagai fungsi dan bukan diketik di dua tempat karena ia dipakai dua kali — sekali untuk
 * dasar SEBULAN milik tiap PIC (yang memutuskan bonus ditahan atau tidak), sekali untuk bonus
 * baris ini. Kedua tempat yang berselisih berarti kolom Bonus yang tidak berjumlah sebesar
 * dasarnya sendiri.
 */
function bonusBaseOf(row) {
  return round(row.netProfit - row.operatingExpense);
}

function withBonus(row, bonusOf, bonusBase) {
  const bonusPercent = bonusOf(row.picKey);
  const monthBase = bonusBase.get(row.picKey) || 0;
  // Dasar yang minus tidak menghasilkan bonus negatif, dan yang diperiksa adalah dasar SEBULAN
  // milik orang itu — bukan baris ini. Lihat catatan di `buildCashFlow`.
  const held = bonusPercent !== null && monthBase <= 0;
  const bonus = bonusPercent === null || held ? 0 : round((bonusBaseOf(row) * bonusPercent) / 100);

  return {
    ...row,
    bonusPercent,
    // Bonus yang DITAHAN karena bulan orang itu rugi total, dibedakan dari bonus yang kebetulan
    // nol: barisnya menyebutkan sebabnya alih-alih menampilkan tarif yang tidak menghasilkan apa-apa.
    bonusHeld: held,
    bonus,
    netIncomeOwner: round(row.netProfit - bonus),
  };
}

/**
 * Jumlah sekumpulan baris. Diekspor karena halaman memanggilnya lagi untuk baris yang SEDANG
 * TAMPIL: baris Total yang tidak ikut menyempit saat sebuah nama dipilih akan diadu dengan kolom
 * di atasnya dan tidak pernah cocok. Satu penjumlah, bukan dua — yang kedua akan menghitung ROI
 * baris Total dengan lantai belanjanya sendiri.
 */
export function cashFlowTotals(rows) {
  const totals = {
    earning: 0,
    totalSpending: 0,
    grossProfit: 0,
    company: 0,
    invalidTraffic: 0,
    payoutCost: 0,
    netProfit: 0,
    operatingExpense: 0,
    bonus: 0,
    netIncomeOwner: 0,
    earningWithoutPercent: 0,
  };

  for (const row of rows) {
    for (const key of Object.keys(totals)) totals[key] += row[key];
  }
  for (const key of Object.keys(totals)) totals[key] = round(totals[key]);

  // ROI baris Total dihitung dari JUMLAH uangnya, bukan dari rata-rata kolom ROI. Rata-rata
  // persentase memberi bobot yang sama kepada subdomain yang membelanjakan Rp 50.000 dan yang
  // membelanjakan Rp 12 juta.
  totals.roi = roiPercent(totals.earning, totals.totalSpending);
  totals.netRoi = returnPercent(totals.netProfit, totals.totalSpending);
  return totals;
}

// --- bantuan ----------------------------------------------------------------------------------

function addBucket(buckets, { month, pic, subDomain, domain, accountType }, apply) {
  const picKey = normalize(pic);
  const key = `${month}|${picKey}|${normalize(subDomain)}|${accountType}`;
  let entry = buckets.get(key);
  if (!entry) {
    entry = {
      key,
      picKey,
      pic,
      subDomain,
      domain,
      accountType,
      earning: 0,
      spending: 0,
      company: 0,
      percents: new Set(),
      earningWithoutPercent: 0,
      invalidTraffic: 0,
      invalidTrafficPool: 0,
      payoutCost: 0,
      operatingExpense: 0,
      days: 0,
      daysWithoutSpend: 0,
    };
    buckets.set(key, entry);
  }
  apply(entry);
}

/**
 * "Berapa kali lipat" yang dipakai kolom Net ROI: net profit dibagi belanja.
 *
 * Lantainya `MIN_ROI_SPEND`, sama dengan `roiPercent` dan karena alasan yang sama — pembagi Rp 43
 * menghasilkan angka enam digit yang berdiri di kolom yang sama dengan +110% milik baris yang
 * membelanjakan jutaan, dan yang paling besar di layar justru yang paling tidak berarti.
 */
function returnPercent(netProfit, spending) {
  return toAmount(spending) >= MIN_ROI_SPEND ? round((netProfit / spending) * 100) : "";
}

// Porsi invalid traffic sebuah baris terhadap nominal domainnya bulan itu, sebagai persen. Kosong
// (bukan 0%) untuk baris yang tidak ikut dibagi sama sekali: nol di sana adalah klaim bahwa
// subdomain ini bersih, sementara yang sebenarnya terjadi adalah domainnya belum pernah dicek.
function shareOf(entry) {
  if (entry.invalidTrafficPool <= 0) return "";
  return round((entry.invalidTraffic / entry.invalidTrafficPool) * 100);
}

// Nama subdomain -> PIC-nya, sebagai cadangan untuk baris ROI yang tidak membawa `pic` sendiri.
function subDomainPicIndex(subDomains) {
  const map = new Map();
  for (const sub of subDomains || []) {
    const key = normalize(sub?.name);
    if (key) map.set(key, sub?.pic || "");
  }
  return (name) => map.get(normalize(name)) || "";
}

/**
 * Bulan yang punya baris ROI, terbaru dulu — isi pemilih bulan halaman ini.
 *
 * Dari `roiReports` saja, bukan dari kelima sumber seperti `profitLossMonths`: tabel ini tidak
 * punya satu baris pun tanpa baris ROI, jadi bulan yang cuma punya baris invalid traffic akan
 * terbuka kosong.
 */
export function cashFlowMonths(store = {}) {
  const months = new Set();
  for (const row of store?.roiReports || []) {
    const key = monthKey(row?.date);
    if (/^\d{4}-\d{2}$/.test(key)) months.add(key);
  }
  return [...months].sort().reverse();
}
