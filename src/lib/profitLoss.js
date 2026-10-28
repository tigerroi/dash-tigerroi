import { accountCloseEntries, accountCloseKey, accountCloseMonth } from "./accountClose.js";
import { bonusPercentIndex } from "./bonusPercent.js";
import { companyPercentIndex } from "./companyPercent.js";
import {
  dateKeyOf,
  daysInclusive,
  monthKey,
  partialMonthsIn,
  rowsInRange,
  toDateKey,
  wholeMonthsIn,
} from "./dateRange.js";
import {
  AD_EXCHANGE,
  cleanDomain,
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
import { ensure, hasAmount, round, sumBy } from "./numbers.js";
import { bonusOperatingExpense, expenseTotal, spreadOperatingExpense } from "./operatingExpense.js";
import { payoutCostMonth, payoutCostRows } from "./payouts.js";
import { toAmount } from "./toAmount.js";

/**
 * Laba rugi bulanan, mengikuti rantai Cash Flow Statement yang selama ini dihitung di spreadsheet:
 *
 *   Laba kotor        = Pendapatan − (Belanja iklan + Pajak iklan)
 *   Net profit        = Laba kotor − Potongan Company − Invalid Traffic − Potongan pencairan
 *                       − Pengeluaran operasional
 *   Net income owner  = Net profit − Bonus advertiser
 *
 * **Pengeluaran operasional memuat DUA sumber**: baris `expenses` dan biaya penyambungan Ad
 * Exchange (`adxCosts`, halaman Cost Ad Exchange). Keduanya berdiri di satu baris dan bukan dua,
 * dan letaknya di rantai itu TIDAK sama sepanjang waktu: sampai Juni 2026 ia dikurangkan sesudah
 * dasar bonus advertiser dihitung, sejak Juli 2026 ia dibagi ke tiap advertiser menurut porsi
 * earning dan ikut mengurangi dasarnya. Batas dan alasannya di
 * [`operatingExpense.js`](./operatingExpense.js) — satu tempat, dibaca halaman ini dan Cash Flow.
 *
 * Yang tidak berubah adalah posisinya di RANTAI TOTAL: ia tetap satu baris "Pengeluaran
 * operasional" yang dikurangkan penuh sebelum Net profit, dan pembagiannya ke PIC hanya menentukan
 * bonus siapa yang berkurang — persis perlakuan invalid traffic dan potongan pencairan.
 *
 * **Pendapatan dan belanja iklan dibaca dari `dashboard/weeklyFinancials`, bukan dari
 * `dashboard/roiReports`.** Keduanya tampak bisa dijumlahkan, tapi hanya yang pertama yang
 * berskala bisnis: baris ROI hanya memuat subdomain yang terdaftar di `subDomains`, jadi
 * menjumlahkannya akan melewatkan situs GAM yang belum didaftarkan sekaligus belanja campaign yang
 * belum terpetakan — dua kebocoran ke arah berlawanan yang saling menyamarkan. `syncFinancials`
 * menulis total tiap network dan tiap ad account, tanpa syarat pemetaan itu — dan **kedua sumber
 * earning** (GAM maupun AdSense berdiri sendiri) masuk ke angka yang sama.
 *
 * **Tapi dua potongan di rantai itu TIDAK punya angka tingkat usaha**, dan di situlah `roiReports`
 * tetap dipakai — bukan sebagai sumber total, melainkan sebagai satu-satunya tempat yang tahu
 * uangnya milik domain dan orang yang mana:
 *
 *   Potongan Company  tarifnya per domain (20% di satu domain, 10% di domain lain), jadi ia harus
 *                     dihitung dari earning PER DOMAIN dan dijumlahkan.
 *   Bonus advertiser  tarifnya per orang dan dasarnya net profit orang itu sendiri, jadi ia harus
 *                     dihitung dari earning dan belanja PER PIC.
 *
 * Selisih antara total `weeklyFinancials` dan jumlah baris ROI bulan itu tidak disembunyikan: ia
 * tersimpan sebagai `coverageGap` dan disebutkan di layar. Kedua potongan di atas hanya menyentuh
 * bagian yang punya rinciannya, dan angka yang tidak punya rincian tidak boleh diam-diam dianggap
 * nol potongan.
 *
 * ═══ SATU SUMBER YANG TIDAK PUNYA API SAMA SEKALI ═══
 *
 * **`accountCloses` ikut ke rantai ini**, dan ia satu-satunya earning yang diketik orang di
 * seluruh dashboard (lihat accountClose.js). Akun yang ditutup Google berhenti menjawab
 * `reports:run`, jadi pendapatannya tidak ada di `weeklyFinancials` MAUPUN di `roiReports`:
 * dilewati, Pendapatan Mei 2026 berbunyi Rp 66 juta untuk bulan yang membayar Rp 145 juta, dan
 * yang lebih buruk — `coverageGap` tetap NOL, karena kedua sisi sama-sama kehilangan uang yang
 * sama. Halaman ini lalu diam tentang selisih yang tidak bisa ditemukan siapa pun.
 *
 * Aturan pengamannya sama persis dengan `foldAccountCloses` di cashFlow.js: **baris ROI selalu
 * menang**, jadi subdomain yang bulan itu punya laporan mengabaikan angka ketikannya. Tanpa itu,
 * koleksi ini jadi pintu belakang untuk mengarang pendapatan.
 *
 * Yang diketik adalah "Ad Spend + Ad Tax" sebagai SATU angka — formnya memang meminta begitu, dan
 * akun yang sudah ditutup tidak punya lagi laporan yang bisa memecahnya. Angka itu masuk ke baris
 * **Belanja iklan**, bukan dipecah tebakan ke baris Pajak: yang penting di rantai ini adalah Total
 * belanja iklan tetap sama dengan Belanja + Pajak, dan kolom yang dibagi dua dengan tarif hari ini
 * akan mengubah laba bulan lampau tiap kali seseorang menyentuh Settings.
 *
 * ═══ TIDAK ADA SATU ATURAN PUN YANG DIHITUNG ULANG DI SINI ═══
 *
 * `domainIndex`, `sourceSplit`, `companyPercentIndex`, `invalidTrafficTotal`, dan
 * `invalidTrafficMonth` semuanya DIIMPOR — modul yang sama dengan Cash Flow, Pencairan, Invalid
 * Traffic, dan Target. Ketiga halaman itu bertetangga di kepala halaman yang sama, dan salinan
 * kedua sebuah aturan berarti satu domain berbunyi dua angka berbeda di dua tab yang bersebelahan.
 * Sebelum ini berkas ini menulis ulang keempatnya, dan keempat salinannya sudah berbeda perilaku:
 * `nominal` mentah alih-alih jumlah Check, bulan dari `date` alih-alih dari kolom `month`,
 * `hasBreakdown` yang tidak memeriksa `adsenseRevenue`, dan pembagian invalid traffic yang
 * mengabaikan Jenis Akun.
 *
 * Titik lama di weeklyFinancials tidak pernah dibuang (yang dipangkas hanya titik bertanggal
 * setelah jendela sync), jadi bulan-bulan sebelumnya tetap bisa dibuka selama sync sudah berjalan
 * saat itu.
 */

// --- satu baris, satu angka -------------------------------------------------------------------

/**
 * Fee satu baris top-up whitelist — dan **hanya** fee-nya.
 *
 * Nominal top-up bukan biaya: ia berpindah jadi saldo iklan lalu keluar lagi sebagai belanja
 * Meta, yang sudah dihitung penuh di baris Belanja Iklan. Menjumlahkannya sebagai biaya berarti
 * uang yang sama dihitung dua kali.
 *
 * Fee-nya sendiri **tidak ikut dikurangkan** dari laba, mengikuti rantai spreadsheet: ia
 * ditampilkan sebagai catatan supaya angka di halaman ini bisa diadu satu-satu dengan laporan yang
 * dipegang keuangan. Uang yang benar-benar keluar tetap keluar — yang dilaporkan halaman ini
 * adalah laba versi rantai itu, bukan saldo kas.
 */
export function topupFee(row) {
  if (hasAmount(row?.feeTopup)) return toAmount(row.feeTopup);
  // Baris lama tanpa kolom fee: total = nominal + fee, jadi fee-nya bisa diturunkan tanpa perlu
  // tahu tarif yang berlaku saat itu.
  if (hasAmount(row?.total)) return round(toAmount(row.total) - toAmount(row.nominal));
  return 0;
}

// --- laporan satu bulan -----------------------------------------------------------------------

export function buildProfitLoss({
  financials = [],
  expenses = [],
  whitelistTopup = [],
  invalidTraffic = [],
  adxCosts = [],
  companyPercents = [],
  bonusPercents = [],
  roiReports = [],
  accountCloses = [],
  payouts = [],
  subDomains = [],
  domains = [],
  users = [],
  range,
  now = new Date(),
}) {
  const period = { from: dateKeyOf(range?.from), to: dateKeyOf(range?.to) };
  const bonusPercentAt = bonusPercentIndex(bonusPercents, users);
  const points = rowsInRange(financials, period);
  const expenseRows = rowsInRange(expenses, period);
  const topupRows = rowsInRange(whitelistTopup, period);
  const adxRows = rowsInRange(adxCosts, period);

  // Dua sumber di rantai ini berdiri per BULAN, bukan per hari: nominal invalid traffic dan earning
  // akun yang ditutup. Keduanya ikut hanya kalau rentangnya MENUTUP bulan itu penuh — lihat
  // `wholeMonthsIn`. Yang ketinggalan disebutkan di layar lewat `partialMonths`.
  const months = wholeMonthsIn(period);
  const monthSet = new Set(months);
  // Bulan sebuah baris invalid traffic dibaca dari kolom `month`-nya dulu — `invalidTrafficMonth`,
  // fungsi yang sama dengan halamannya sendiri, Cash Flow, dan Pencairan. Disaring dari `date`
  // saja, baris yang ditulis lewat jalur lain hilang dari halaman ini dan hanya dari halaman ini.
  const trafficRows = (Array.isArray(invalidTraffic) ? invalidTraffic : []).filter((row) =>
    monthSet.has(invalidTrafficMonth(row)),
  );

  // Potongan pencairan bulan-bulan itu: fee rekening perantara + konversi mata uang + pajak negara
  // asal, dari baris `payouts` yang sudah diketik orang. Berdiri per BULAN seperti dua sumber di
  // atas, jadi ia disaring dengan `months` yang sama.
  const payoutCosts = payoutCostRows({
    payouts,
    roiReports,
    subDomains,
    domains,
    companyPercents,
    invalidTraffic,
  }).filter((row) => monthSet.has(row.month));

  // Bagian pengeluaran operasional periode ini yang ikut mengurangi dasar bonus — biaya
  // bertanggal Juli 2026 ke atas saja. Dihitung SEBELUM `splitByOwner` karena di situlah ia
  // dibagi ke PIC; yang di rantai total tetap `operatingExpenses` penuh di bawah.
  const bonusOpex = bonusOperatingExpense({ expenseRows, adxRows });

  const split = splitByOwner({
    // Disaring rentang lebih dulu, seperti sumber lain di atas. Tanpa ini rinciannya adalah SELURUH
    // riwayat ROI yang ada di RTDB — angka yang sama persis untuk tiap periode yang dibuka, dan
    // satu-satunya tanda bahwa ada yang salah adalah membuka dua periode berturut-turut.
    roiRows: rowsInRange(roiReports, period),
    accountCloses,
    months,
    subDomains,
    domains,
    companyPercents,
    // Tarif bonus bulan TERAKHIR rentangnya — untuk satu bulan, bulan itu sendiri. Dasar bonus di
    // sini dijumlah seluruh rentang per PIC, jadi rentang lama beberapa bulan memakai satu tarif;
    // Cash Flow memakai tanggal yang sama supaya kedua halaman tetap berjumlah sama.
    bonusPercentAt: (name) => bonusPercentAt(name, period.to),
    users,
    trafficRows,
    payoutCosts,
    bonusOpex,
  });

  // Pendapatan usaha, DITAMBAH earning akun yang sudah ditutup Google — yang tidak ada di
  // `weeklyFinancials` karena API-nya tidak menjawab lagi. Lihat catatan di kepala berkas.
  const revenue = round(sumBy(points, (row) => toAmount(row.grossRevenue)) + split.closedEarning);
  const adSpend = round(sumBy(points, (row) => toAmount(row.totalSpend)) + split.closedSpending);
  // Pajak yang benar-benar tercatat di tiap hari, bukan hasil mengalikan total dengan tarif hari
  // ini: tiap titik membawa pajak dengan tarif yang berlaku saat ia ditulis, dan menghitung ulang
  // seluruh bulan dengan tarif terbaru akan mengubah laba bulan-bulan lampau tiap kali seseorang
  // menyentuh Settings.
  // Titik paling lama (6–9 Juli di RTDB) ditulis sebelum kolom `adTax` dan `totalSpending` ada,
  // dan hanya membawa `totalSpend`. Tanpa cabang ketiga, `totalSpending − totalSpend` pada titik
  // seperti itu adalah `0 − spend`: baris Pajak Iklan Juli terbaca −Rp166.840, dan Belanja + Pajak
  // tidak lagi berjumlah Total Belanja — dua baris yang saling bertetangga dan tidak bisa
  // dijumlahkan pembacanya. Pajaknya memang tidak diketahui untuk hari-hari itu, dan yang tidak
  // diketahui menambah nol, bukan mengurangi seluruh belanja hari itu.
  const adTax = sumBy(points, (row) => {
    if (hasAmount(row.adTax)) return toAmount(row.adTax);
    if (!hasAmount(row.totalSpending)) return 0;
    return toAmount(row.totalSpending) - toAmount(row.totalSpend);
  });
  const totalAdSpend = round(
    sumBy(points, (row) =>
      hasAmount(row.totalSpending) ? toAmount(row.totalSpending) : toAmount(row.totalSpend),
    ) + split.closedSpending,
  );
  const grossProfit = round(revenue - totalAdSpend);

  // Dua sumber, satu baris. `adxCostTotal` disimpan terpisah supaya rinciannya bisa disebut di
  // layar dan diadu dengan halaman Cost Ad Exchange — yang dijumlah jadi satu hanya ANGKANYA di
  // rantai, bukan asal-usulnya.
  //
  // Hanya kolom rupiah yang dijumlah. Kolom US$ di baris yang sama adalah nilai yang sama dalam
  // mata uang lain, bukan biaya kedua — menjumlahkan keduanya berarti tiap penyambungan dihitung
  // dua kali, sekali besar dan sekali kecil.
  const expenseCosts = sumBy(expenseRows, expenseTotal);
  const adxCostTotal = sumBy(adxRows, (row) => toAmount(row.nominal));
  const operatingExpenses = round(expenseCosts + adxCostTotal);
  const topupFees = sumBy(topupRows, topupFee);
  // Jumlah Check 1–3, lewat fungsi yang sama dengan halaman Invalid Traffic. `nominal` mentah
  // adalah kolom turunan yang ditulis form; baris yang punya Check tapi belum sempat menuliskannya
  // berbunyi Rp 0 di sini dan angka penuh di tab sebelahnya.
  const invalidTrafficSum = sumBy(trafficRows, invalidTrafficTotal);

  const payoutCost = round(payoutCosts.reduce((total, row) => total + row.cost, 0));

  const netProfit = round(
    grossProfit - split.companyDeduction - invalidTrafficSum - payoutCost - operatingExpenses,
  );
  const netIncomeOwner = round(netProfit - split.advertiserBonus);

  return {
    range: period,
    revenue,
    adSpend,
    adTax,
    totalAdSpend,
    grossProfit,
    companyDeduction: split.companyDeduction,
    invalidTraffic: invalidTrafficSum,
    payoutCost,
    // Rinciannya per DOMAIN, terbesar dulu — pertanyaan yang dibawa orang ke panel ini adalah
    // domain mana yang uangnya paling banyak hilang di jalan, dan jawabannya menunjuk ke satu
    // baris di tab Pencairan yang bisa diadu dengan mutasi rekeningnya.
    payoutCostBreakdown: payoutCosts
      .map((row) => ({ label: row.label, total: row.cost, month: row.month }))
      .sort((a, b) => b.total - a.total),
    operatingExpenses,
    // Kedua penyusun Pengeluaran operasional, dipisah untuk layar saja — rantainya sudah memakai
    // jumlahnya. Tanpa keduanya, satu baris yang naik dua juta tidak bisa ditelusuri ke halaman
    // mana pun tanpa membuka dua tab dan menghitung selisihnya sendiri.
    expenseCosts,
    adxCosts: adxCostTotal,
    netProfit,
    advertiserBonus: split.advertiserBonus,
    // Berapa dari Pengeluaran operasional di atas yang ikut mengurangi dasar bonus advertiser.
    // Kosongnya bukan kebetulan: untuk periode sebelum Juli 2026 ia Rp 0, dan halaman menyebutkan
    // itu alih-alih membiarkan dua bulan bertetangga memakai dua aturan tanpa tanda apa pun.
    bonusOperatingExpense: split.bonusOperatingExpense,
    netIncomeOwner,
    // Marjin tanpa pendapatan tidak terdefinisi, bukan 0 — bulan tanpa pendapatan sama sekali
    // tidak "bermarjin nol", ia belum punya penyebut.
    margin: revenue > 0 ? round((netIncomeOwner / revenue) * 100) : null,
    // Berapa hari bulan itu yang benar-benar punya angka, dan berapa yang seharusnya ada. Sebuah
    // bulan yang setengah terisi terbaca persis seperti bulan yang buruk kalau selisih ini tidak
    // pernah disebut.
    daysWithData: points.length,
    daysExpected: expectedDays(period, now),
    // Bulan yang PUNYA baris bulanan (invalid traffic / akun ditutup) tapi tidak tertutup penuh oleh
    // rentangnya, jadi angkanya tidak ikut. Disebutkan di layar: potongan yang diam-diam hilang
    // terbaca sebagai laba yang lebih besar, dan tidak ada apa pun yang bisa menjelaskannya.
    partialMonths: partialMonthsIn(period, [
      { rows: invalidTraffic, monthOf: invalidTrafficMonth },
      { rows: accountCloses, monthOf: accountCloseMonth },
      { rows: payouts, monthOf: payoutCostMonth },
    ]),
    // Fee top-up TIDAK dikurangkan (lihat topupFee) — keduanya disimpan untuk ditampilkan sebagai
    // catatan, bukan untuk masuk rantai laba.
    topupFees,
    topupNominal: sumBy(topupRows, (row) => toAmount(row.nominal)),
    // Bagian Pendapatan dan Belanja yang DIKETIK orang, bukan datang dari API mana pun. Wajib
    // terbaca justru karena ia sudah masuk ke rantai di atasnya: angka ketikan yang berdiri tanpa
    // tanda di antara angka sync adalah dua hal berbeda yang mengaku satu.
    accountCloseEarning: split.closedEarning,
    accountCloseSpending: split.closedSpending,
    accountCloseBreakdown: split.closedBreakdown,
    // Sejauh mana potongan Company dan bonus punya dasar. Bukan hiasan: keduanya dihitung dari
    // baris ROI, dan pendapatan yang tidak punya baris ROI tidak ikut dipotong.
    coveredEarning: split.coveredEarning,
    coverageGap: round(revenue - split.coveredEarning),
    earningWithoutPercent: split.earningWithoutPercent,
    expenseBreakdown: groupBy(expenseRows, (row) => row.itemName, expenseTotal),
    // Per DOMAIN, bukan per company: yang ditanyakan orang saat melihat baris ini naik adalah
    // "domain mana yang baru disambungkan", dan satu domain bisa disambungkan ke beberapa company
    // dalam satu bulan (designingaround.com, Mei 2026).
    adxCostBreakdown: groupBy(
      adxRows,
      (row) => row.domain,
      (row) => toAmount(row.nominal),
    ),
    /**
     * Kedua penyusun Pengeluaran operasional dalam SATU daftar, terurut dari yang terbesar —
     * karena itulah pertanyaan yang dibawa orang ke panel ini: "yang paling besar bulan ini apa".
     * Dua panel terpisah menjawabnya cuma di dalam masing-masing kelompok, dan yang membandingkan
     * keduanya harus melakukannya sendiri.
     *
     * Yang dijaga pemisahannya dulu tidak hilang, ia pindah jadi KOLOM: sebuah baris yang naik dua
     * juta harus menyebutkan ke halaman mana orang pergi memperbaikinya, dan "Sewa server" tepat di
     * atas "petcins.com" tanpa kolom itu tidak memberi tahu apa pun. Kolomnya juga yang membuat dua
     * baris bernama sama dari dua halaman berbeda tetap terbaca sebagai dua baris — karena itu
     * `key`-nya membawa sumbernya, bukan cuma labelnya.
     */
    operatingExpenseBreakdown: [
      ...groupBy(expenseRows, (row) => row.itemName, expenseTotal).map((row) => ({
        ...row,
        source: "Expenses",
        key: `expenses|${row.label}`,
      })),
      ...groupBy(
        adxRows,
        (row) => row.domain,
        (row) => toAmount(row.nominal),
      ).map((row) => ({ ...row, source: "Cost Ad Exchange", key: `adx|${row.label}` })),
    ].sort((a, b) => b.total - a.total),
    topupBreakdown: groupBy(topupRows, (row) => row.namaKode, topupFee),
    invalidTrafficBreakdown: groupBy(trafficRows, (row) => row.domain, invalidTrafficTotal),
    companyBreakdown: split.companyBreakdown,
    bonusBreakdown: split.bonusBreakdown,
  };
}

/**
 * Dua potongan yang tarifnya bukan milik seluruh usaha, melainkan milik satu domain atau satu
 * orang. Dihitung dari `dashboard/roiReports` — satu baris per hari per subdomain — karena itulah
 * satu-satunya tempat earning dan belanja punya nama pemiliknya, ditambah `accountCloses` untuk
 * subdomain yang laporannya tidak akan pernah datang lagi.
 *
 * ═══ EMBERNYA (domain, jenis akun, PIC) — KETIGANYA ═══
 *
 * Ketiganya, karena ketiganya memutuskan sesuatu yang berbeda: **domain** memilih tarif Company,
 * **jenis akun** memilih baris invalid traffic mana yang boleh membebaninya, dan **PIC** memilih
 * tarif bonus. Sebelum ini embernya cuma (domain, PIC), dan jenis akun diabaikan saat membagi
 * invalid traffic — sehingga nominal yang bertanda "Adsense" ikut membebani sisi Ad Exchange
 * domain itu, dan kolom Bonus di sini berbeda beberapa rupiah dari kolom yang sama di tab Cash
 * Flow untuk uang yang sama. Bentuk ember ini sekarang sama dengan `collectBuckets` di cashFlow.js;
 * yang berbeda cuma tingkatnya (di sana per subdomain, di sini per PIC), dan pembagian sebanding
 * menjumlah sama di kedua tingkat itu.
 *
 * Yang tidak diketahui tidak dikarang jadi nol:
 *
 *   hari tanpa tarif Company       earning Ad Exchange hari itu tidak dipotong, dan jumlahnya
 *                                  dilaporkan sebagai `earningWithoutPercent` supaya kelihatan
 *                                  tarifnya belum diisi — bukan supaya terbaca sebagai domain yang
 *                                  bebas potongan. Sejak tarif punya tanggal berlaku, ini juga
 *                                  keadaan hari-hari SEBELUM baris tarif paling awal sebuah domain.
 *   user tanpa `bonusPercent`      tidak dihitungi bonus (mis. yang bukan advertiser), tapi tetap
 *                                  muncul di rinciannya dengan tarif kosong.
 *
 * Dasar bonus seseorang adalah earning-nya dikurangi belanja, potongan Company, invalid traffic,
 * potongan pencairan, DAN porsi pengeluaran operasionalnya — yang terakhir hanya untuk biaya
 * bertanggal Juli 2026 ke atas (`OPEX_BONUS_FROM_MONTH`). Ketiga potongan terakhir dibagi ke ember
 * dengan pembagi yang sama, porsi earning, lewat modul masing-masing yang juga dipakai Cash Flow.
 */
function splitByOwner({
  roiRows,
  accountCloses,
  months,
  subDomains,
  domains,
  companyPercents,
  bonusPercentAt = () => null,
  users,
  trafficRows,
  payoutCosts,
  bonusOpex = 0,
}) {
  // Subdomain -> domain induk: `parentDomain` dulu, lalu pencocokan AKHIRAN terhadap domain yang
  // dikenal. Diimpor, bukan ditulis ulang — tanpa cabang kedua itu, situs yang belum didaftarkan di
  // /sub-domains kehilangan potongan Company-nya diam-diam.
  const domainOf = domainIndex({ domains, subDomains });

  // Label saja. Dulu peta ini merangkap daftar akhiran untuk `domainSuffixOf`; sejak pencocokannya
  // pindah ke `domainIndex`, yang tersisa cuma ejaan asli domainnya untuk kolom Nama.
  const domainLabel = new Map();
  for (const domain of domains || []) {
    const raw = normalize(domain?.domainUrl);
    const clean = cleanDomain(domain?.domainUrl);
    if (raw) domainLabel.set(raw, clean || domain.domainUrl);
    if (clean) domainLabel.set(clean, clean);
  }

  // Tarif dicari PER BARIS ROI HARIAN, bukan sekali per domain: sebuah domain yang di-relink 21 Mei
  // punya dua tarif di bulan yang sama, dan mengalikan earning sebulan dengan salah satunya
  // memindahkan ratusan ribu rupiah ke baris paling bawah tanpa satu pun tanda di layar.
  const rates = companyPercentIndex(companyPercents);

  const subPic = new Map();
  for (const sub of subDomains || []) {
    const key = normalize(sub?.name);
    if (key) subPic.set(key, sub.pic || "");
  }

  const bonusByUser = new Map();
  for (const user of users || []) {
    const key = normalize(user?.name);
    if (!key) continue;
    bonusByUser.set(key, { label: user.name });
  }

  const buckets = new Map();
  // Subdomain yang bulan ini PUNYA baris ROI. Baris ketikan untuk salah satunya diabaikan — lihat
  // catatan `accountCloses` di kepala berkas.
  const reported = new Set();
  let coveredEarning = 0;
  let earningWithoutPercent = 0;

  const add = ({ domainKey, accountType, picKey, picLabel, domainFallback }, apply) => {
    const key = `${domainKey}|${accountType}|${picKey}`;
    let entry = buckets.get(key);
    if (!entry) {
      entry = {
        domainKey,
        accountType,
        picKey,
        domainLabel: domainLabel.get(domainKey) || domainFallback || "(tanpa domain)",
        picLabel,
        earning: 0,
        spend: 0,
        company: 0,
        percents: new Set(),
        invalidTraffic: 0,
        payoutCost: 0,
        operatingExpense: 0,
      };
      buckets.set(key, entry);
    }
    apply(entry);
  };

  for (const row of roiRows || []) {
    // `earning` kosong berarti laporan GAM baris itu gagal datang, bukan nol rupiah — barisnya
    // dilewati, dan selisihnya muncul sendiri sebagai coverageGap.
    if (!hasAmount(row?.earning)) continue;
    const earning = toAmount(row.earning);
    const spend = hasAmount(row?.totalSpending) ? toAmount(row.totalSpending) : 0;
    const subKey = normalize(row.subDomain);
    reported.add(accountCloseKey(row.subDomain));

    const domainKey = domainOf(row.subDomain);
    const picKey = normalize(row.pic || subPic.get(subKey));
    // Satu kunci ember untuk PIC, dipakai di SELURUH peta di bawah. Sebelumnya dua peta memakai
    // kunci berbeda untuk ember yang sama ("(tanpa pic)" vs string kosongnya), jadi pembagian
    // invalid traffic untuk baris tanpa PIC mencari ember yang tidak pernah ada — jatahnya hilang
    // diam-diam alih-alih mengurangi dasar bonus ember itu.
    const picBucket = picKey || "(tanpa pic)";
    const picLabel = bonusByUser.get(picKey)?.label || row.pic || "(tanpa PIC)";
    const target = {
      domainKey,
      picKey: picBucket,
      picLabel,
      domainFallback: row.subDomain,
      accountType: AD_EXCHANGE,
    };

    // Earning dipecah ke dua sumbernya berikut PORSI belanja yang jatuh ke masing-masing, lewat
    // `sourceSplit` — fungsi yang sama dengan Cash Flow, Pencairan, Invalid Traffic, dan Target.
    // Berkas ini dulu punya salinannya sendiri (`adExchangeEarning`) yang tidak memeriksa
    // `adsenseRevenue`, jadi baris AdSense murni yang `adxRevenue`-nya absen — bukan nol — dipotong
    // Company atas SELURUH earning-nya di sini dan atas nol di halaman sebelahnya.
    const split = sourceSplit(row, earning);
    const percent = rates.percentAt(domainKey, row.date);

    coveredEarning += earning;
    if (percent === null) earningWithoutPercent += split.adx;

    add(target, (entry) => {
      entry.earning += split.adx;
      entry.spend += spend * split.adxShare;
      if (percent !== null) {
        entry.company += (split.adx * percent) / 100;
        entry.percents.add(percent);
      }
    });

    // AdSense TIDAK dipotong Company — pendapatannya tidak lewat Ad Exchange sama sekali. Pada
    // Juli, memotong seluruh earning stylefemale.com dengan 10% menghasilkan Rp102.038 lebih banyak
    // daripada yang benar-benar dipotong.
    add({ ...target, accountType: "Adsense" }, (entry) => {
      entry.earning += split.adsense;
      entry.spend += spend * split.adsenseShare;
    });
  }

  // Earning akun yang sudah ditutup Google. Baris ROI selalu menang: subdomain yang bulan ini punya
  // laporan mengabaikan angka ketikannya tanpa suara.
  let closedEarning = 0;
  let closedSpending = 0;
  const closedBreakdown = [];
  for (const row of months.flatMap((key) => accountCloseEntries(accountCloses, key))) {
    if (reported.has(accountCloseKey(row.subDomain))) continue;

    const domainKey = domainOf(row.subDomain);
    const picKey = normalize(row.pic);
    const percent = rates.percentAt(domainKey, row.date);
    const isAdx = row.accountType === AD_EXCHANGE;

    closedEarning += row.earning;
    closedSpending += row.spending;
    closedBreakdown.push({ label: row.subDomain, total: round(row.earning) });
    coveredEarning += row.earning;
    if (isAdx && percent === null) earningWithoutPercent += row.earning;

    add(
      {
        domainKey,
        accountType: row.accountType,
        picKey: picKey || "(tanpa pic)",
        picLabel: bonusByUser.get(picKey)?.label || row.pic || "(tanpa PIC)",
        domainFallback: row.subDomain,
      },
      (entry) => {
        entry.earning += row.earning;
        entry.spend += row.spending;
        // Baris bulanan MENYEBUTKAN jenis akunnya, jadi seluruh earning-nya jatuh ke satu ember —
        // `sourceSplit` tidak dipakai. Dibelah, baris AdSense tanpa rincian akan jatuh utuh ke Ad
        // Exchange dan berbunyi kena potongan Company yang tidak pernah ditagihkan.
        if (isAdx && percent !== null) {
          entry.company += (row.earning * percent) / 100;
          entry.percents.add(percent);
        }
      },
    );
  }

  // Aturannya diimpor, bukan ditulis di sini — modul yang sama dengan Cash Flow. Sisanya yang
  // tidak punya ember TIDAK dipakai halaman ini: kolom Invalid Traffic-nya dijumlah langsung dari
  // baris pengecekannya (`invalidTrafficSum`), jadi uangnya sudah utuh di rantai. Yang butuh
  // angkanya adalah Cash Flow, yang tidak punya penjumlah kedua itu.
  spreadInvalidTraffic([...buckets.values()], trafficRows, {
    domainKeyOf: (entry) => entry.domainKey,
  });

  // Potongan pencairan, dibagi dengan pembagi yang SAMA — `spreadByEarning`, modul yang sama yang
  // membagi invalid traffic di atas. Bedanya cuma satu: TANPA saringan jenis akun. Yang dibayarkan
  // Google ke rekening adalah satu wire untuk seluruh pendapatan domain itu, dan tidak ada apa pun
  // di dalamnya yang memisahkan Ad Exchange dari AdSense — fee perantara dan pajak negara asal
  // kena keduanya sekaligus.
  //
  // Sisanya yang tidak punya ember tidak dipakai halaman ini, alasan yang sama dengan invalid
  // traffic di atasnya: baris rantainya menjumlahkan `payoutCosts` langsung, jadi uangnya sudah
  // utuh. Yang berubah cuma dasar bonus, dan dasar bonus memang hanya boleh berkurang untuk orang
  // yang benar-benar menghasilkan uang itu.
  spreadByEarning([...buckets.values()], payoutCosts || [], {
    domainKeyOf: (entry) => entry.domainKey,
    domainOf: (row) => row.domain,
    amountOf: (row) => row.cost,
    onShare: (entry, share) => {
      entry.payoutCost += share;
    },
  });

  // Porsi pengeluaran operasional tiap ember — pembagi yang sama (porsi earning), TANPA domain:
  // sewa server dan lisensi Keitaro tidak dimiliki domain mana pun. Nol untuk periode yang seluruh
  // biayanya bertanggal sebelum Juli 2026, jadi bulan-bulan yang sudah dibayarkan tidak bergeser
  // sepeser pun. Sisanya yang tidak punya ember tidak dipakai di sini, alasan yang sama dengan dua
  // pembagian di atasnya: baris rantainya menjumlahkan `operatingExpenses` penuh.
  spreadOperatingExpense([...buckets.values()], bonusOpex, {
    onShare: (entry, share) => {
      entry.operatingExpense += share;
    },
  });

  const byDomain = new Map();
  const byPic = new Map();
  for (const entry of buckets.values()) {
    const domain = ensure(byDomain, entry.domainKey || "(tanpa domain)", () => ({
      label: entry.domainLabel,
      // Tarif yang BENAR-BENAR dipakai bulan itu, sebagai himpunan — bukan satu angka. Sejak tarif
      // punya tanggal berlaku, sebulan bisa memuat dua tarif, dan satu angka di kolom "Tarif" harus
      // memilih salah satunya: yang mana pun yang dipilih, ia berbohong untuk separuh bulan itu.
      percents: new Set(),
      earning: 0,
      base: 0,
      company: 0,
    }));
    domain.earning += entry.earning;
    // Dasar potongannya: bagian Ad Exchange saja, yang belum tentu sama dengan earning-nya.
    if (entry.accountType === AD_EXCHANGE) domain.base += entry.earning;
    domain.company += entry.company;
    for (const percent of entry.percents) domain.percents.add(percent);

    const pic = ensure(byPic, entry.picKey, () => ({
      label: entry.picLabel,
      percent: bonusPercentAt(entry.picKey),
      earning: 0,
      spend: 0,
      company: 0,
      invalidTraffic: 0,
      payoutCost: 0,
      operatingExpense: 0,
    }));
    pic.earning += entry.earning;
    pic.spend += entry.spend;
    pic.company += entry.company;
    pic.invalidTraffic += entry.invalidTraffic;
    pic.payoutCost += entry.payoutCost;
    pic.operatingExpense += entry.operatingExpense;
  }

  const companyBreakdown = [...byDomain.values()]
    .map((entry) => ({
      label: entry.label,
      // Terurut menaik, jadi "10% → 20%" di layar terbaca sebagai kenaikan yang memang terjadi.
      // Kosong berarti tidak satu pun hari bulan itu punya tarif — yaitu "belum diisi".
      percents: [...entry.percents].sort((a, b) => a - b),
      earning: round(entry.earning),
      base: round(entry.base),
      total: round(entry.company),
    }))
    .sort((a, b) => b.total - a.total || b.earning - a.earning);

  const bonusBreakdown = [...byPic.values()]
    .map((entry) => {
      // Porsi pengeluaran operasional ikut mengurangi dasar sejak Juli 2026, dan Rp 0 sebelum itu
      // — lihat `OPEX_BONUS_FROM_MONTH`. Ia dikurangkan DI SINI dan bukan dari `netProfit` di
      // rantai: yang di rantai sudah menguranginya penuh, dan menguranginya dua kali akan
      // melaporkan laba yang lebih kecil daripada uang yang benar-benar keluar.
      const base = round(
        entry.earning -
          entry.spend -
          entry.company -
          entry.invalidTraffic -
          entry.payoutCost -
          entry.operatingExpense,
      );
      return {
        label: entry.label,
        percent: entry.percent,
        base,
        // Porsi pengeluaran operasional yang sudah dikurangkan dari dasar di atas. Disebut per
        // baris supaya dasar bonus seseorang bisa diadu dengan kolom-kolom Cash Flow-nya sendiri:
        // tanpa angka ini, satu-satunya yang bisa dilakukan pembaca adalah mempercayainya.
        operatingExpense: round(entry.operatingExpense),
        // Tidak ada bonus dari kerugian: dasar yang minus dikalikan tarif akan menghasilkan bonus
        // negatif, yang di rantai laba berarti advertiser membayar balik ke owner.
        total: entry.percent === null || base <= 0 ? 0 : round((base * entry.percent) / 100),
      };
    })
    .sort((a, b) => b.total - a.total || b.base - a.base);

  return {
    companyDeduction: round(companyBreakdown.reduce((total, row) => total + row.total, 0)),
    advertiserBonus: round(bonusBreakdown.reduce((total, row) => total + row.total, 0)),
    // Bagian pengeluaran operasional yang benar-benar mengurangi dasar bonus. Dioper ke laporan
    // supaya panel Bonus Advertiser bisa menyebutkannya: sebuah dasar yang mengecil tanpa satu pun
    // baris yang berubah adalah persis keadaan yang membuat orang berhenti mempercayai kolomnya.
    bonusOperatingExpense: round(bonusOpex),
    coveredEarning: round(coveredEarning),
    earningWithoutPercent: round(earningWithoutPercent),
    closedEarning: round(closedEarning),
    closedSpending: round(closedSpending),
    closedBreakdown: closedBreakdown.sort((a, b) => b.total - a.total),
    companyBreakdown,
    bonusBreakdown,
  };
}

/**
 * Nominal invalid traffic, dibagi ke ember penyusunnya menurut PORSI EARNING — pembagi yang sama
 * dengan `spreadInvalidTraffic` di cashFlow.js, dan satu-satunya pembagi yang datanya ada.
 *
 * **Jenis akun ikut menyaring.** Baris `invalidTraffic` berdiri per (bulan, domain, jenis akun)
 * karena begitulah pengecekannya dilakukan; nominal yang bertanda "Adsense" tidak boleh membebani
 * sisi Ad Exchange domain yang sama. Baris LAMA tanpa jenis akun dibagi ke SEMUA ember domain itu,
 * sepola dengan `bucketOf`: tanpa jenis, barisnya memang berarti "invalid traffic domain ini bulan
 * itu".
 *
 * Domain yang tidak punya satu pun ember tetap dikurangkan dari laba (totalnya utuh di baris
 * Invalid traffic), hanya tidak mengurangi bonus siapa pun.
 */
/**
 * Baris laporan dalam urutan bacanya, supaya tabelnya tidak perlu tahu rumus apa pun.
 *
 * Tiap baris membawa DUA penanda, dan keduanya menjawab pertanyaan yang berbeda:
 *
 *   `kind`  tingkatnya di tabel — yang menentukan tebal huruf dan garis pemisahnya
 *           (`pl-subtotal`, `pl-total`).
 *   `flow`  ARAH uangnya — yang menentukan warnanya: `in` masuk, `out` keluar, `net` selisih yang
 *           boleh minus dan karena itu warnanya mengikuti TANDANYA, bukan kelompoknya.
 *
 * Dipisah karena keduanya tidak sejalan: "Total belanja iklan" adalah subtotal yang uangnya KELUAR,
 * sementara "Laba kotor" adalah subtotal yang bisa minus. Dibaca dari `kind` saja, keduanya
 * berwarna sama — dan sebelas angka yang berderet hijau membuat kolom yang seluruh gunanya dibaca
 * menurun tidak mengatakan apa pun tentang arah uangnya.
 */
export function profitLossLines(report) {
  return [
    // "GAM" saja sudah tidak benar sejak `syncFinancials` menjumlahkan kedua sumber earning, dan
    // angka ini sekarang juga memuat akun yang ditutup — yang menyebutkan rinciannya adalah
    // catatan di bawah tabel, bukan nama barisnya.
    { key: "revenue", label: "Pendapatan", value: report.revenue, kind: "in", flow: "in" },
    { key: "adSpend", label: "Belanja iklan", value: report.adSpend, kind: "out", flow: "out" },
    { key: "adTax", label: "Pajak iklan", value: report.adTax, kind: "out", flow: "out" },
    {
      key: "totalAdSpend",
      label: "Total belanja iklan",
      value: report.totalAdSpend,
      kind: "subtotal",
      flow: "out",
    },
    {
      key: "grossProfit",
      label: "Laba kotor",
      value: report.grossProfit,
      kind: "subtotal",
      flow: "net",
    },
    {
      key: "companyDeduction",
      label: "Potongan Company Ad Exchange",
      value: report.companyDeduction,
      kind: "out",
      flow: "out",
    },
    {
      key: "invalidTraffic",
      label: "Invalid traffic",
      value: report.invalidTraffic,
      kind: "out",
      flow: "out",
    },
    {
      key: "payoutCost",
      label: "Potongan pencairan",
      value: report.payoutCost,
      kind: "out",
      flow: "out",
    },
    {
      key: "operatingExpenses",
      label: "Pengeluaran operasional",
      value: report.operatingExpenses,
      kind: "out",
      flow: "out",
    },
    {
      key: "netProfit",
      label: "Net profit",
      value: report.netProfit,
      kind: "subtotal",
      flow: "net",
    },
    {
      key: "advertiserBonus",
      label: "Bonus advertiser",
      value: report.advertiserBonus,
      kind: "out",
      flow: "out",
    },
    {
      key: "netIncomeOwner",
      label: "Net income owner",
      value: report.netIncomeOwner,
      kind: "total",
      flow: "net",
    },
  ];
}

/**
 * Selisih terhadap bulan pembanding.
 *
 * `percent` null kalau pembandingnya nol: pertumbuhan dari nol tidak punya angka persen yang
 * benar, dan menuliskannya sebagai "+100%" atau "∞%" hanya memindahkan kebingungan ke pembaca.
 */
export function deltaOf(current, previous) {
  const from = Number(previous) || 0;
  const to = Number(current) || 0;
  const delta = round(to - from);
  return { delta, percent: from === 0 ? null : round((delta / Math.abs(from)) * 100) };
}

// Bulan yang punya data di salah satu sumbernya, terbaru dulu.
export function profitLossMonths({
  financials = [],
  expenses = [],
  whitelistTopup = [],
  invalidTraffic = [],
  adxCosts = [],
  accountCloses = [],
}) {
  const months = new Set();
  for (const rows of [financials, expenses, whitelistTopup, adxCosts]) {
    for (const row of rows || []) {
      const key = monthKey(row?.date);
      if (/^\d{4}-\d{2}$/.test(key)) months.add(key);
    }
  }
  // Keduanya punya kolom `month` sendiri, dan itu yang menang atas `date` — fungsi yang sama
  // dengan halamannya masing-masing.
  for (const row of invalidTraffic || []) {
    const key = invalidTrafficMonth(row);
    if (/^\d{4}-\d{2}$/.test(key)) months.add(key);
  }
  for (const row of accountCloses || []) {
    const key = accountCloseMonth(row);
    if (/^\d{4}-\d{2}$/.test(key)) months.add(key);
  }
  return [...months].sort().reverse();
}

// --- bantuan ----------------------------------------------------------------------------------

function groupBy(rows, labelOf, amountOf) {
  const totals = new Map();
  for (const row of rows) {
    const label = String(labelOf(row) || "").trim() || "(tanpa nama)";
    totals.set(label, (totals.get(label) || 0) + (Number(amountOf(row)) || 0));
  }
  return [...totals]
    .map(([label, total]) => ({ label, total: round(total) }))
    .sort((a, b) => b.total - a.total);
}

/**
 * Berapa hari dalam rentang itu yang seharusnya sudah punya angka.
 *
 * Berhenti di **kemarin**: sync melaporkan hari yang sudah selesai, jadi hari ini memang belum boleh
 * punya titik dan menghitungnya sebagai hari yang hilang akan menyalakan peringatan "data belum
 * lengkap" setiap hari sepanjang bulan.
 *
 * Rentang tanpa batas awal tidak bisa dihitung panjangnya — jawabannya 0, yaitu "jangan bandingkan":
 * "Semua tanggal" memang tidak punya jumlah hari yang seharusnya terisi.
 */
function expectedDays({ from, to }, now) {
  if (!from) return 0;

  const yesterday = toDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const last = to && to < yesterday ? to : yesterday;
  return daysInclusive(from, last);
}
