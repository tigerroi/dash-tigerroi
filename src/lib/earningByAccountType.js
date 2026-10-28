import { monthKey } from "./dateRange.js";
import { hasAmount, round } from "./numbers.js";
import { toAmount } from "./toAmount.js";

/**
 * Earning dan belanja baris ROI, dijumlahkan per (BULAN, DOMAIN INDUK, JENIS AKUN).
 *
 * Berdiri di modulnya sendiri karena dua halaman memakainya dan keduanya tidak saling mengimpor:
 * Invalid Traffic (yang mengadu nominal pengecekan dengan earning bulan itu) dan Target (yang
 * mengadu target dengan realisasinya). Disalin, satu domain akan berbunyi Rp 48.550.508 di satu
 * halaman dan angka lain di halaman sebelahnya untuk bulan yang sama — dua angka yang mengaku hal
 * yang sama, dan tidak ada apa pun di layar yang bisa menjelaskan selisihnya.
 */

export const ADSENSE = "Adsense";
export const AD_EXCHANGE = "Ad-Exchanger";

// Dua pilihan, bukan kotak teks. Nilainya MEMUTUSKAN bagian earning mana yang dijumlahkan —
// "adsense" atau "AdSense " yang diketik meleset satu huruf tidak berbunyi sebagai kesalahan di
// mana pun; ia menghasilkan baris yang seluruh kolom otomatisnya kosong.
export const ACCOUNT_TYPES = [ADSENSE, AD_EXCHANGE];

/**
 * Baris ROI, dijumlahkan per (bulan, domain induk, jenis akun).
 *
 * Jenis akun sebuah baris ROI tidak ditulis di baris itu — yang ada cuma rincian earning per sumber
 * permintaan. Jadi ia DITURUNKAN dari rinciannya: `adxRevenue + adServerRevenue` adalah permintaan
 * Ad Manager (Ad-Exchanger), `adsenseRevenue` adalah AdSense. Itu bukan tebakan: subdomain yang
 * dimonetisasi lewat AdSense datang dari API AdSense dan pendapatannya seluruhnya di kolom AdSense
 * dengan adx/adServer nol (lihat `accountProvider` di functions/sync-core.js).
 *
 * BELANJANYA dibagi menurut porsi earning di dalam baris itu sendiri. Meta tidak tahu apa-apa
 * tentang GAM maupun AdSense — satu campaign membelanjakan uang ke satu subdomain, dan subdomain
 * itulah yang punya sumber pendapatannya. Untuk baris yang seluruh pendapatannya satu sumber
 * (hampir semuanya) porsinya 1 dan 0; yang bercampur (network GAM yang juga melaporkan
 * AdSense-in-GAM) dibagi sebanding, karena tidak ada pembagi lain yang datanya ada.
 *
 * Baris yang earning-nya TIDAK DIKETAHUI dilewati seluruhnya — belanjanya juga. Tanpa earning
 * tidak ada yang bisa menentukan sumbernya, dan belanja yang dijatuhkan ke sembarang kolom
 * menghasilkan Net Profit yang salah di dua baris sekaligus.
 */
export function earningBuckets(store) {
  const domainOf = domainIndex(store);
  const buckets = new Map();

  for (const row of store?.roiReports || []) {
    if (!hasAmount(row?.earning)) continue;
    const month = monthKey(row?.date);
    if (!/^\d{4}-\d{2}$/.test(month)) continue;
    const domain = domainOf(row?.subDomain);
    if (!domain) continue;

    const earning = toAmount(row.earning);
    const spend = hasAmount(row?.totalSpending) ? toAmount(row.totalSpending) : 0;
    const split = sourceSplit(row, earning);

    // KEDUA ember dibuat, walau salah satunya nol. Ember yang tidak dibuat berarti "tidak
    // diketahui" ("-" di layar), dan domain yang bulan itu memang tidak punya pendapatan AdSense
    // sama sekali BUKAN domain yang pendapatan AdSense-nya gagal dibaca — yang benar Rp 0.
    add(buckets, month, domain, AD_EXCHANGE, split.adx, spend * split.adxShare);
    add(buckets, month, domain, ADSENSE, split.adsense, spend * split.adsenseShare);
  }

  return buckets;
}

/**
 * Ember sebuah baris. Jenis akun yang KOSONG menjumlahkan keduanya, dan itu bukan bawaan yang
 * dipilih sembarangan: baris yang diinput sebelum kolom Jenis Akun ada memang berarti "domain ini
 * bulan itu", tanpa pemisahan sumber. Menjatuhkannya ke Ad Exchange akan mengadu satu nominal
 * dengan sebagian earning-nya saja, dan persentasenya membesar tanpa sebab.
 */
export function bucketOf(buckets, month, domain, type) {
  if (!month || !domain) return null;
  if (type) return buckets.get(`${month}|${domain}|${type}`) || null;

  const both = ACCOUNT_TYPES.map((each) => buckets.get(`${month}|${domain}|${each}`)).filter(
    Boolean,
  );
  if (both.length === 0) return null;
  return both.reduce(
    (total, entry) => ({
      earning: total.earning + entry.earning,
      spend: total.spend + entry.spend,
    }),
    { earning: 0, spend: 0 },
  );
}

// Nilai kolom Jenis Akun sebuah baris, dinormalkan ke salah satu ACCOUNT_TYPES — atau "" untuk
// baris yang tidak menyebutkannya.
export function accountTypeOf(value) {
  const text = String(value ?? "").trim();
  return ACCOUNT_TYPES.find((type) => type.toLowerCase() === text.toLowerCase()) || "";
}

/**
 * Earning satu baris ROI, dipecah ke dua sumbernya berikut PORSI belanja yang jatuh ke
 * masing-masing. Diekspor karena `cashFlow.js` memakai aturan yang sama persis di tingkat
 * SUBDOMAIN — disalin, satu subdomain akan berbunyi dua angka berbeda di dua halaman yang
 * bertetangga di kepala tab yang sama.
 */
export function sourceSplit(row, earning) {
  const hasBreakdown =
    hasAmount(row?.adxRevenue) || hasAmount(row?.adServerRevenue) || hasAmount(row?.adsenseRevenue);

  // Baris yang ditulis SEBELUM earning dipecah per sumber permintaan jatuh utuh ke Ad Exchange —
  // aturan yang sama dengan `adExchangeEarning` di profitLoss.js, dan alasan yang sama: seluruh
  // pendapatan kelima network hari ini adalah Ad Exchange, jadi itu jawaban yang benar untuk
  // hampir semua baris tanpa rincian.
  if (!hasBreakdown) return { adx: earning, adsense: 0, adxShare: 1, adsenseShare: 0 };

  const adx = round(toAmount(row.adxRevenue) + toAmount(row.adServerRevenue));
  const adsense = toAmount(row.adsenseRevenue);
  const total = adx + adsense;
  if (total <= 0) return { adx, adsense, adxShare: 1, adsenseShare: 0 };
  return { adx, adsense, adxShare: adx / total, adsenseShare: adsense / total };
}

function add(buckets, month, domain, type, earning, spend) {
  const key = `${month}|${domain}|${type}`;
  const entry = buckets.get(key) || { earning: 0, spend: 0 };
  entry.earning += Number(earning) || 0;
  entry.spend += Number(spend) || 0;
  buckets.set(key, entry);
}

/**
 * Nama subdomain -> domain induknya. Dari `subDomains.parentDomain` dulu, lalu pencocokan AKHIRAN
 * terhadap domain yang dikenal — persis `domainSuffixOf` di profitLoss.js. Tanpa cabang kedua itu,
 * situs yang belum didaftarkan di /sub-domains kehilangan earning-nya diam-diam, dan yang terlihat
 * di layar cuma persentase invalid traffic yang terlalu besar (atau target yang tidak pernah
 * tercapai).
 */
export function cleanDomain(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
}

export function domainIndex(store) {
  const known = new Set();
  for (const domain of store?.domains || []) {
    const rawKey = normalize(domain?.domainUrl);
    const cleanKey = cleanDomain(domain?.domainUrl);
    if (rawKey) known.add(rawKey);
    if (cleanKey) known.add(cleanKey);
  }

  const parents = new Map();
  for (const sub of store?.subDomains || []) {
    const parentRaw = normalize(sub?.parentDomain);
    const parentClean = cleanDomain(sub?.parentDomain);
    const resolvedParent = parentClean || parentRaw;
    if (sub?.name) {
      parents.set(normalize(sub.name), resolvedParent);
      parents.set(cleanDomain(sub.name), resolvedParent);
      const prefix = cleanDomain(sub.name).split(".")[0];
      if (prefix) {
        parents.set(normalize(prefix), resolvedParent);
        parents.set(cleanDomain(prefix), resolvedParent);
      }
    }
    if (sub?.siteCode) {
      parents.set(normalize(sub.siteCode), resolvedParent);
      parents.set(cleanDomain(sub.siteCode), resolvedParent);
    }
  }

  return (name) => {
    const host = normalize(name);
    const cleanHost = cleanDomain(name);
    if (!host && !cleanHost) return "";
    const parent = parents.get(host) || parents.get(cleanHost);
    if (parent) return parent;
    for (const key of known) {
      if (
        host === key ||
        host.endsWith(`.${key}`) ||
        cleanHost === key ||
        cleanHost.endsWith(`.${key}`)
      ) {
        return key;
      }
    }
    return "";
  };
}

export function normalize(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

/**
 * Membagi sebuah nominal BULANAN ke ember-ember yang menyusunnya, menurut PORSI EARNING.
 *
 * Dua hal di rantai laba berdiri per (bulan, domain) dan harus dibebankan ke advertiser yang
 * benar-benar menghasilkan uangnya: nominal **invalid traffic** dan **potongan pencairan** (fee
 * rekening + konversi + pajak negara asal). Keduanya clawback atas pendapatan yang sudah dicatat,
 * jadi keduanya dibagi dengan pembagi yang sama — dan pembagi itu ditulis SEKALI di sini.
 *
 * Sampai 4 Sep 2026 pembagi invalid traffic ditulis dua kali, satu di profitLoss.js dan satu di
 * cashFlow.js, dan keduanya sudah berbeda perilaku sebelum ada yang menyadarinya: April 2026
 * berbunyi Rp 242.992 di satu halaman dan Rp 218.842 di halaman sebelahnya, untuk uang yang sama.
 * Menambahkan potongan pencairan sebagai penyalin KETIGA adalah cara yang sama persis untuk
 * mengulanginya.
 *
 * `matches` yang menyaring ember mana yang berhak menerima sebuah baris: invalid traffic menyaring
 * per JENIS AKUN (nominal bertanda "Adsense" tidak boleh membebani sisi Ad Exchange domain yang
 * sama), sementara potongan pencairan tidak — yang dibayarkan Google ke rekening adalah satu wire
 * untuk seluruh pendapatan domain itu, dan tidak ada apa pun di dalamnya yang memisahkan kedua
 * sumbernya.
 *
 * Yang tidak punya ember sama sekali DIKEMBALIKAN sebagai `unspread`, bukan dijatuhkan dan bukan
 * dipindahkan ke ember lain. Sebuah domain bisa punya potongan untuk bulan yang sisi bisnisnya
 * tidak menghasilkan apa-apa; memindahkannya ke ember tetangga mengurangi dasar bonus advertiser
 * yang tidak ada hubungannya dengan uang itu.
 */
export function spreadByEarning(
  entries,
  rows,
  { domainKeyOf, domainOf = (row) => normalize(row?.domain), amountOf, matches, onShare } = {},
) {
  const byDomain = new Map();
  for (const entry of entries) {
    const key = domainKeyOf(entry);
    const list = byDomain.get(key) || [];
    list.push(entry);
    byDomain.set(key, list);
  }

  let unspread = 0;
  for (const row of rows || []) {
    const nominal = amountOf(row);
    if (!nominal) continue;

    const candidates = byDomain.get(domainOf(row)) || [];
    const targets = matches ? candidates.filter((entry) => matches(row, entry)) : candidates;
    // Pembaginya earning, jadi ember yang seluruhnya nol tidak bisa menerima apa pun.
    const total = targets.reduce((sum, entry) => sum + entry.earning, 0);
    if (total <= 0) {
      unspread += nominal;
      continue;
    }

    for (const entry of targets) {
      onShare(entry, (nominal * entry.earning) / total, nominal);
    }
  }

  return { unspread: round(unspread) };
}
