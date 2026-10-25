import { shiftMonthKey } from "./dateRange.js";
import {
  ACCOUNT_TYPES,
  accountTypeOf,
  bucketOf,
  earningBuckets,
  normalize,
} from "./earningByAccountType.js";
import { firstValue } from "./firstValue.js";
import { hasAmount, round } from "./numbers.js";
import { toAmount } from "./toAmount.js";

/**
 * Target earning per DOMAIN per BULAN per JENIS AKUN — dan angka di sekitarnya, yang tidak diketik
 * siapa pun.
 *
 * Satu domain punya DUA baris tiap bulan, Adsense dan Ad-Exchanger, karena keduanya dikejar
 * terpisah: designingaround.com boleh menargetkan Rp 50 juta dari Ad Exchange dan Rp 10 juta dari
 * AdSense, dan satu angka gabungan tidak bisa mengatakan yang mana yang meleset. Itu pembagian
 * yang sama persis dengan Invalid Traffic, lewat ember yang sama (`earningByAccountType.js`) —
 * disalin, satu domain akan berbunyi dua angka berbeda untuk bulan yang sama di dua halaman
 * bersebelahan.
 *
 * Yang DIISI orang cuma empat: Status Terkini, Target, Kendala, dan Catatan. Yang DIHITUNG:
 *
 *   Payout Sebelumnya = Tercapai bulan sebelumnya, domain + jenis yang sama
 *   Tercapai          = earning baris ROI bulan itu, bagian jenis akun ini
 *   Sisa Target       = Tercapai - Target        (negatif = masih kurang)
 *
 * Diturunkan saat DIRENDER dan tidak ditulis ke RTDB, alasan yang sama dengan kolom turunan di
 * Invalid Traffic: yang ditulis benar pada detik ia ditulis dan basi sesudahnya, dan sync
 * berikutnya menggeser earning bulan berjalan tanpa menyentuh baris ini. Payout Sebelumnya ikut
 * diturunkan justru karena ia angka bulan LALU: disimpan, ia jadi salinan kedua dari kolom
 * Tercapai di baris sebelahnya, dan dua angka untuk uang yang sama akan berbeda suatu hari.
 */

// Keadaan sebuah domain di mata orang yang mengejar targetnya, dan itu bukan turunan dari data mana
// pun: "Review" datang dari email Google, "Limit" dari Ads Manager, "Akun Disable Sementara" dari
// pemberitahuan yang cuma dibaca orangnya. Karena itu ia diisi tangan — tapi lewat pilihan, bukan
// kotak teks: status yang diketik bebas berakhir sebagai enam ejaan untuk satu keadaan ("Limit",
// "limit ", "Iklan Limit"), dan kolom yang begitu tidak bisa disaring maupun dihitung.
export const STATUS_OPTIONS = [
  "Running Iklan",
  "Ready",
  "Review",
  "Limit",
  "Limit Iklan Belum Tayang",
  "Akun Disable Sementara",
];

// Slug jenis akun, dipakai DUA-DUANYA sebagai kunci RTDB dan sebagai segmen alamat form
// (`/targets/{domainId}/{YYYY-MM}/{slug}/edit`). Satu kosakata untuk keduanya: dua peta nama yang
// harus sepakat adalah cara sebuah baris tersimpan di alamat yang tidak pernah dibaca formnya.
// Titik tidak boleh ada di kunci RTDB — slug ini tidak punya titik, berbeda dari nama domainnya.
export const ACCOUNT_TYPE_SLUGS = { Adsense: "adsense", "Ad-Exchanger": "ad-exchanger" };

export function accountTypeSlug(type) {
  return ACCOUNT_TYPE_SLUGS[accountTypeOf(type)] || "";
}

export function accountTypeOfSlug(slug) {
  const found = Object.entries(ACCOUNT_TYPE_SLUGS).find(([, value]) => value === slug);
  return found ? found[0] : "";
}

// Field yang benar-benar diketik orang. Berdiri sebagai daftar karena tiga tempat memakainya —
// form, penulis RTDB, dan pemeriksa "baris ini kosong, hapus saja" — dan satu nama yang meleset di
// salah satunya menghasilkan isian yang tersimpan tapi tidak pernah tampil lagi.
const TARGET_FIELDS = ["status", "target", "kendala", "catatan"];

/**
 * Isi satu bulan sebuah domain, dinormalkan jadi `{ [slug]: { status, target, kendala, catatan } }`.
 *
 * BENTUK LAMA node ini adalah satu ANGKA telanjang di `domainTargets/{id}/{YYYY-MM}` — target
 * domain itu tanpa pemisahan jenis akun. Ia jatuh utuh ke Ad-Exchanger, aturan yang sama dengan
 * baris ROI tanpa rincian sumber (`sourceSplit`) dan alasan yang sama: seluruh pendapatan kelima
 * network hari ini adalah Ad Exchange. Dijatuhkan ke keduanya, satu target akan terhitung dua kali;
 * dibuang, angka yang sudah diketik orang hilang tanpa satu pun tanda di layar.
 */
export function targetMonthRecord(targets, domainId, month) {
  const stored = targets?.[domainId]?.[month];
  const record = {};

  if (stored && typeof stored === "object") {
    for (const [slug, values] of Object.entries(stored)) {
      if (values && typeof values === "object") record[slug] = { ...values };
    }
    return record;
  }

  if (hasAmount(stored)) {
    record[ACCOUNT_TYPE_SLUGS["Ad-Exchanger"]] = { target: toAmount(stored) };
  }
  return record;
}

/**
 * Bentuk baru seluruh bulan itu setelah satu jenis akun disunting.
 *
 * Yang dikembalikan adalah node BULAN utuh, bukan satu jenisnya saja, dan itu yang menjaga bentuk
 * lama: menulis langsung ke `{YYYY-MM}/adsense` di atas sebuah angka telanjang membuat RTDB
 * mengganti angka itu dengan sebuah objek — target Ad-Exchanger yang sudah diketik orang lenyap
 * karena seseorang mengisi baris di sebelahnya. `null` berarti bulan itu benar-benar kosong dan
 * node-nya dihapus, bukan disimpan sebagai objek kosong yang terbaca sebagai baris yang ada.
 */
export function targetMonthUpdate(targets, domainId, month, slug, values) {
  const record = targetMonthRecord(targets, domainId, month);
  const entry = {};

  for (const field of TARGET_FIELDS) {
    const value = values?.[field];
    if (field === "target") {
      if (hasAmount(value)) entry.target = toAmount(value);
      continue;
    }
    const text = String(value ?? "").trim();
    if (text) entry[field] = text;
  }

  if (Object.keys(entry).length === 0) {
    delete record[slug];
  } else {
    record[slug] = entry;
  }

  return Object.keys(record).length === 0 ? null : record;
}

/**
 * Baris tabel Target untuk satu bulan: tiap domain dikali kedua jenis akun.
 *
 * KEDUANYA selalu digambar, walau salah satunya belum pernah diisi — daftar yang cuma memuat baris
 * yang sudah punya target adalah daftar yang tidak pernah mengingatkan siapa pun bahwa sebuah
 * domain belum ditargetkan sama sekali.
 */
export function buildTargetRows(store, month) {
  const buckets = earningBuckets(store);
  const previous = shiftMonthKey(month, -1);
  const targets = store?.domainTargets || {};
  const rows = [];

  for (const domain of store?.domains || []) {
    const name = firstValue(domain.domainUrl);
    const key = normalize(domain.domainUrl);
    const record = targetMonthRecord(targets, domain.id, month);

    for (const accountType of ACCOUNT_TYPES) {
      const slug = ACCOUNT_TYPE_SLUGS[accountType];
      const values = record[slug] || {};
      rows.push({
        id: `${domain.id}|${slug}`,
        domainId: domain.id,
        domain: name,
        accountType,
        slug,
        status: String(values.status ?? "").trim(),
        kendala: String(values.kendala ?? "").trim(),
        catatan: String(values.catatan ?? "").trim(),
        // Target yang belum pernah diisi KOSONG, bukan Rp 0: nol adalah pernyataan ("bulan ini
        // domain ini memang tidak ditargetkan"), dan itu pernyataan yang cuma boleh dibuat orang.
        target: hasAmount(values.target) ? toAmount(values.target) : "",
        previousPayout: realizedOf(buckets, previous, key, accountType),
        ...achievementOf(buckets, month, key, accountType, values.target),
      });
    }
  }

  return rows.sort(
    (a, b) =>
      a.domain.localeCompare(b.domain) ||
      ACCOUNT_TYPES.indexOf(a.accountType) - ACCOUNT_TYPES.indexOf(b.accountType),
  );
}

/**
 * Riwayat satu domain + jenis akun: tiap bulan yang punya target ATAU realisasi, terbaru dulu.
 *
 * Bulan yang cuma punya realisasi ikut, dan itu bukan kelengkapan: bulan yang menghasilkan uang
 * tanpa pernah ditargetkan adalah persis bulan yang perlu dilihat orang saat ia menyusun target
 * berikutnya.
 */
export function targetHistoryRows(store, domainId, accountType) {
  const domain = (store?.domains || []).find((row) => row.id === domainId);
  if (!domain) return [];

  const buckets = earningBuckets(store);
  const key = normalize(domain.domainUrl);
  const slug = accountTypeSlug(accountType);
  const byMonth = store?.domainTargets?.[domainId] || {};

  const months = new Set(Object.keys(byMonth).filter((month) => /^\d{4}-\d{2}$/.test(month)));
  for (const bucketKey of buckets.keys()) {
    const [month, bucketDomain, type] = bucketKey.split("|");
    if (bucketDomain === key && type === accountType) months.add(month);
  }

  return [...months]
    .sort()
    .reverse()
    .map((month) => {
      const values = targetMonthRecord(store?.domainTargets, domainId, month)[slug] || {};
      return {
        month,
        status: String(values.status ?? "").trim(),
        target: hasAmount(values.target) ? toAmount(values.target) : "",
        previousPayout: realizedOf(buckets, shiftMonthKey(month, -1), key, accountType),
        ...achievementOf(buckets, month, key, accountType, values.target),
      };
    });
}

/**
 * Tercapai dan Sisa Target satu baris.
 *
 * TIDAK DIKETAHUI BUKAN NOL, dan di sini itu menentukan dua kolom sekaligus. Bulan + domain yang
 * tidak punya satu pun baris ROI berearning mengembalikan "" — Rp 0 di kolom Tercapai adalah klaim
 * bahwa domainnya tidak menghasilkan apa-apa, dan Sisa Target yang lahir darinya ("-Rp 10.000.000")
 * adalah vonis atas bulan yang laporannya cuma belum datang. Begitu ada SATU baris ROI, kedua ember
 * dibuat: domain yang bulan itu memang tidak punya pendapatan AdSense berbunyi Rp 0, dan nol itu
 * benar.
 */
function achievementOf(buckets, month, domainKey, accountType, target) {
  const realized = realizedOf(buckets, month, domainKey, accountType);
  if (realized === "") return { realized: "", remaining: "" };
  return { realized, remaining: round(realized - toAmount(target)) };
}

function realizedOf(buckets, month, domainKey, accountType) {
  const bucket = bucketOf(buckets, month, domainKey, accountType);
  return bucket ? round(bucket.earning) : "";
}
