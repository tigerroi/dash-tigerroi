import { accountCloseMonth } from "./accountClose.js";
import { buildCashFlow, cashFlowTotals } from "./cashFlow.js";
import { partialMonthsIn } from "./dateRange.js";
import { normalize } from "./earningByAccountType.js";
import { invalidTrafficMonth } from "./invalidTraffic.js";
import { isAccountClose, payoutRows } from "./payouts.js";

/**
 * Laba per Domain — rantai Laba Rugi yang sama, dikelompokkan per DOMAIN dan disaring per
 * advertiser. Sheet acuannya bernama "% Advertiser".
 *
 *   Net Profit       = Earning − (Ad Spend + Ad Tax) − Potongan Company − Invalid Traffic
 *                      − Potongan Pencairan
 *   Net Income Owner = Net Profit − Biaya Operasional − Bonus advertiser
 *
 * **Biaya Operasional** tetap di luar Net Profit (alasannya di `baseRow` di cashFlow.js), tapi di
 * halaman ini ia DIKURANGKAN dari Net Income Owner — rantai sheet "Rekap % Advertiser" sejak Juli
 * 2026, dan rantai yang sama dengan Laba Rugi. Porsinya per baris sudah dihitung `buildCashFlow`
 * (porsi earning, Rp 0 sebelum Juli 2026 — lihat operatingExpense.js); yang dilakukan di sini cuma
 * mengurangkannya. Di tab Cash Flow tidak, karena di sana tidak ada kolom Net Income Owner per baris
 * dan kartunya sudah memuat Biaya Operasional sebagai item tersendiri.
 *
 * Sheet acuannya ("% Advertiser") adalah kalkulator: pilih bulan, pilih advertiser, lalu ia
 * menampilkan rantai itu untuk pilihan tersebut berikut tabel per domain penyusunnya. Yang
 * dijawabnya berbeda dari kedua tab di sebelahnya, dan bedanya cuma TINGKAT: Laba Rugi menjawab
 * "bulan ini menghasilkan berapa" untuk seluruh usaha, Cash Flow menjawabnya per subdomain, dan
 * yang ini per domain — tingkat yang dipakai orang saat menagih bagi hasil, karena kesepakatan
 * Company dan pencairan rekening keduanya berdiri per domain.
 *
 * ═══ TIDAK SATU ATURAN PUN DIHITUNG ULANG DI SINI ═══
 *
 * Barisnya DATANG dari `buildCashFlow` — modul yang sama dengan tab Cash Flow, yang sendirinya
 * mengimpor `sourceSplit`, `domainIndex`, `companyPercentIndex`, `invalidTrafficTotal`, dan
 * `roiPercent`. Yang dikerjakan berkas ini cuma menjumlahkan baris-baris itu per domain, dan
 * penjumlahnya pun `cashFlowTotals` yang sama. Jadi satu domain tidak bisa berbunyi dua angka
 * berbeda di dua tab yang bersebelahan di kepala halaman yang sama — bukan karena keduanya
 * kebetulan sepakat hari ini, melainkan karena keduanya satu perhitungan.
 *
 * Itu juga yang menjaga kolom Bonus: dasar bonus adalah net profit SEBULAN milik tiap PIC (lihat
 * `withBonus` di cashFlow.js), jadi ia tidak bisa dihitung dari agregat per domain — sebuah domain
 * bisa dipegang dua orang bertarif berbeda. Yang benar adalah menjumlahkan bonus yang sudah
 * dihitung per baris, dan itulah yang terjadi di sini.
 *
 * ═══ DOMAIN YANG DITUTUP BERDIRI DI TABELNYA SENDIRI ═══
 *
 * Sheet acuannya memisahkan blok "Accounts Close", dan pemisahan itu bukan kerapian: pendapatan
 * domain yang akunnya ditutup Google tidak akan pernah cair, jadi menjumlahkannya dengan yang lain
 * menghasilkan Net Income Owner yang tidak akan pernah mendarat di rekening siapa pun. Yang
 * menandai sebuah domain tutup tetap `payouts` — di situlah orang menuliskannya — lewat
 * `isAccountClose` yang sama dengan "Akun Close Cut" di kartu Cash Flow.
 *
 * Baris ROI-nya TETAP ada dan tetap lengkap; yang berubah cuma tabel mana yang memuatnya. Dibuang,
 * halaman ini akan menyebut angka yang lebih kecil daripada Laba Rugi tanpa satu pun keterangan
 * tentang selisihnya.
 */
export function buildDomainProfit(store = {}, range = {}, filters = {}) {
  const report = buildCashFlow(store, range);
  const pic = String(filters?.pic ?? "").trim();

  // Disaring SEBELUM dikelompokkan: memilih seorang advertiser berarti "domain ini menghasilkan
  // berapa dari tangan dia", bukan "domain yang kebetulan dipegangnya, seluruh isinya".
  const rows = (pic ? report.rows.filter((row) => row.pic === pic) : report.rows).map((row) => ({
    ...row,
    netIncomeOwner: row.netIncomeOwner - row.operatingExpense,
  }));

  const closed = closedDomainsIn(store, report.months);
  const open = [];
  const shut = [];
  for (const row of groupByDomain(rows)) {
    (closed.has(normalize(row.domain)) ? shut : open).push(row);
  }

  return {
    range: report.range,
    months: report.months,
    // Nominal invalid traffic dan earning akun tertutup berdiri per BULAN dan tidak bisa dibelah
    // per hari, jadi bulan yang cuma terpotong sebagian tidak ikut ke dalam angka mana pun di
    // halaman ini — sepola dengan Laba Rugi, dan disebutkan dengan alasan yang sama: potongan yang
    // diam-diam hilang terbaca sebagai laba yang lebih besar.
    partialMonths: partialMonthsIn(report.range, [
      { rows: store?.invalidTraffic, monthOf: invalidTrafficMonth },
      { rows: store?.accountCloses, monthOf: accountCloseMonth },
    ]),
    pic,
    // Terurut dari penyumbang terbesar: pertanyaan yang dibawa orang ke halaman ini adalah domain
    // mana yang menghasilkan, dan urutan abjad menjawabnya hanya secara kebetulan.
    rows: open,
    // Nominal invalid traffic yang tidak punya ember untuk dibagi — dioper apa adanya dari
    // `buildCashFlow`. Ia milik BULAN, bukan milik baris mana pun, jadi ia tidak ikut menyempit
    // saat seorang advertiser dipilih; yang menyebutkannya adalah keterangan di bawah tabel.
    totals: {
      ...cashFlowTotals(open),
      invalidTrafficUnspread: report.totals.invalidTrafficUnspread,
    },
    closedRows: shut,
    closedTotals: cashFlowTotals(shut),
    // Pilihan dropdown diambil dari baris yang BENAR-BENAR ada di bulan itu — sebelum penyaring
    // advertiser dipakai, kalau tidak memilih satu nama akan menghapus semua nama lain dari
    // daftarnya dan tidak ada jalan kembali selain mengosongkan alamat.
    picOptions: unique(report.rows.map((row) => row.pic)),
  };
}

/**
 * Satu baris per domain, dari baris-baris (advertiser, jenis akun, subdomain) penyusunnya.
 *
 * Uangnya dijumlah `cashFlowTotals` — penjumlah yang sama dengan baris Total di tab Cash Flow, dan
 * itu yang membuat ROI baris ini dihitung dari JUMLAH uangnya alih-alih dari rata-rata kolom
 * persen. Rata-rata persen memberi bobot yang sama kepada subdomain yang membelanjakan Rp 50.000
 * dan yang membelanjakan Rp 12 juta.
 */
function groupByDomain(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = normalize(row.domain);
    if (!groups.has(key)) groups.set(key, { domain: row.domain, items: [] });
    groups.get(key).items.push(row);
  }

  return [...groups.values()]
    .map(({ domain, items }) => ({
      id: normalize(domain),
      domain,
      ...cashFlowTotals(items),
      // Siapa saja yang menghasilkannya. Domain yang dipegang dua orang adalah keadaan yang biasa
      // di sini, dan tanpa kolom ini baris seperti itu tidak bisa dibedakan dari milik satu orang —
      // padahal bonusnya lahir dari dua tarif yang berbeda.
      pics: unique(items.map((row) => row.pic)),
      accountTypes: unique(items.map((row) => row.accountType)),
      subDomains: unique(items.map((row) => row.subDomain)).length,
      // Himpunan tarif yang benar-benar dipakai, sepola dengan kolom Company % di Cash Flow: sebulan
      // bisa memuat dua tarif, dan satu angka harus memilih salah satunya — yang mana pun yang
      // dipilih, ia berbohong untuk separuh bulan.
      companyPercents: unique(items.flatMap((row) => row.companyPercents)).sort((a, b) => a - b),
      bonusPercents: unique(items.map((row) => row.bonusPercent).filter((p) => p !== null)).sort(
        (a, b) => a - b,
      ),
      // Bonus yang DITAHAN karena bulan orang itu rugi total — dibedakan dari bonus yang kebetulan
      // nol, supaya barisnya menyebutkan sebabnya alih-alih menampilkan tarif yang tidak
      // menghasilkan apa-apa. Sepola dengan `bonusHeld` di cashFlow.js.
      bonusHeld: items.some((row) => row.bonusHeld),
    }))
    .sort((a, b) => b.earning - a.earning || a.domain.localeCompare(b.domain));
}

/**
 * Domain yang ditandai "Account Close" di `payouts` pada bulan-bulan itu, sebagai nama yang sudah
 * dinormalkan.
 *
 * Lewat `payoutRows`, bukan dari `store.payouts` mentah: kolom `month` sebuah baris pencairan bisa
 * datang dari field `month` maupun diturunkan dari `date`, dan `domain`-nya dinormalkan di sana.
 * Membacanya sendiri di sini berarti satu bulan yang ditulis dalam bentuk lain diam-diam tidak
 * terbaca sebagai bulan yang sedang dibuka.
 */
function closedDomainsIn(store, months) {
  const wanted = new Set(months);
  const closed = new Set();
  for (const row of payoutRows(store?.payouts, store)) {
    if (wanted.has(row.month) && isAccountClose(row)) closed.add(normalize(row.domain));
  }
  return closed;
}

function unique(values) {
  return [...new Set(values.filter((value) => value !== "" && value !== undefined))];
}
