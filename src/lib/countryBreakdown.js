// Ekstensi ditulis penuh supaya modul ini bisa dijalankan node --test apa adanya (lihat
// countryBreakdown.test.mjs); Vite menerima keduanya.
import { normalizeCountryRoiRow } from "./countryRoi.js";
import { toAmount } from "./toAmount.js";

// Rincian negara untuk tabel ROI di Overview.
//
// Sisi sync menulis baris negara ke `users/{id}.countryRoi` — di situlah panel "ROI per Negara" di
// Profile User membacanya — sementara tabel Overview membaca `dashboard/roiReports`. Keduanya
// berasal dari run yang sama dan berkunci hal yang sama (hari data + subdomain), jadi yang perlu
// dilakukan di sini hanya menjodohkannya kembali, bukan menghitung ulang uangnya.
//
// Uangnya tetap lewat normalizeCountryRoiRow → withAdTax: kolom Total Spend pada rincian ini
// harus persis angka yang dibaca orang di panel Profile User, dan dua salinan rumus akan berbeda.

function countryBreakdownKey(date, subDomain) {
  const day = String(date || "").slice(0, 10);
  const name = String(subDomain || "")
    .trim()
    .toLowerCase();
  return day && name ? `${day}__${name}` : "";
}

/**
 * Peta `hari__subdomain -> baris negara`, dikumpulkan dari seluruh user.
 *
 * Kepemilikan baris negara lewat PIC subdomain, jadi satu subdomain hanya pernah muncul pada satu
 * user — tapi barisnya tetap dikumpulkan, bukan ditimpa: PIC yang baru saja berpindah meninggalkan
 * baris hari itu di dua user sampai sync berikutnya, dan menimpa akan menyembunyikan separuh
 * negaranya tanpa ada tanda di layar.
 *
 * Diurutkan menurut total spending: negara yang paling banyak menghabiskan uang adalah yang
 * pertama dicari orang saat membuka rinciannya.
 */
export function buildCountryBreakdown(users, rate) {
  const index = new Map();

  for (const user of Array.isArray(users) ? users : []) {
    for (const [id, item] of toRows(user?.countryRoi)) {
      const key = countryBreakdownKey(item?.date, item?.subDomain);
      if (!key) continue;
      const rows = index.get(key) || [];
      // `id` dibawa ikut karena baris negara tidak punya id sendiri, dan nama negara saja tidak
      // cukup unik untuk dipakai React sebagai key: dua user yang sempat memegang subdomain yang
      // sama bisa membawa negara yang sama, dan key kembar menghilangkan salah satu barisnya.
      rows.push({
        id: `${user?.id || user?.name || "user"}__${id}`,
        ...normalizeCountryRoiRow(item, rate),
      });
      index.set(key, rows);
    }
  }

  for (const rows of index.values()) {
    rows.sort(
      (a, b) =>
        toAmount(b.totalSpending) - toAmount(a.totalSpending) ||
        toAmount(b.earning) - toAmount(a.earning),
    );
  }

  return index;
}

// Baris negara milik satu baris ROI. Selalu array — baris hari lama tidak punya rincian negara
// (`countryRoi` ditulis utuh tiap run, jadi isinya hanya hari data terakhir), dan pemanggilnya
// tidak perlu membedakan "tidak ada kuncinya" dari "kuncinya kosong".
export function countriesOf(index, item) {
  return index?.get(countryBreakdownKey(item?.date, item?.subDomain)) || [];
}

// Pasangan `[kunci, baris]`. RTDB mengirim `countryRoi` sebagai object berkunci
// `subdomain__negara`; array hanya muncul kalau kuncinya kebetulan berupa angka berurutan.
function toRows(value) {
  if (!value) return [];
  return Object.entries(value).filter(([, row]) => row);
}
