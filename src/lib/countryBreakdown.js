// Ekstensi ditulis penuh supaya modul ini bisa dijalankan node --test apa adanya (lihat
// countryBreakdown.test.mjs); Vite menerima keduanya.
import { normalizeCountryRoiRow } from "./countryRoi.js";
import { toAmount } from "./toAmount.js";
import { canonicalSubDomain } from "./userSubDomains.js";

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
  const name = String(canonicalSubDomain(subDomain) || "")
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

      // Daftarkan juga versi slug jika item membawa domain
      const rawSub = String(item?.subDomain || "");
      if (rawSub.includes(".")) {
        const slug = rawSub.split(".")[0].trim().toLowerCase();
        const slugKey = countryBreakdownKey(item?.date, slug);
        if (slugKey && !index.has(slugKey)) {
          index.set(slugKey, rows);
        }
      }
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

/**
 * Membangun peta breakdown negara langsung dari baris tabel Supabase `country_roi`.
 * Mendukung sinkronisasi proporsional revenue GAM jika data negara belum terdistribusi.
 */
export function buildCountryBreakdownFromRows(countryRoiRows, rate, roiReports = []) {
  const index = new Map();

  // Peta total revenue GAM dari roiReports
  const gamRevMap = new Map();
  for (const r of Array.isArray(roiReports) ? roiReports : []) {
    const d = String(r.date || "").slice(0, 10);
    const sub = String(r.subDomain || r.siteCode || "").trim().toLowerCase();
    const rev = Number(r.earning || r.gamRevenue || r.revenue || 0);
    if (sub && rev > 0) {
      gamRevMap.set(`${d}__${sub}`, rev);
      if (sub.includes(".")) {
        gamRevMap.set(`${d}__${sub.split(".")[0]}`, rev);
      }
    }
  }

  // Pra-hitung total per key (date + subdomain)
  const groupStats = new Map();
  for (const item of Array.isArray(countryRoiRows) ? countryRoiRows : []) {
    const subDomain = item.sub_domain || item.subDomain;
    const key = countryBreakdownKey(item.date, subDomain);
    if (!key) continue;
    if (!groupStats.has(key)) {
      groupStats.set(key, { clicks: 0, impressions: 0, spending: 0, earning: 0 });
    }
    const gs = groupStats.get(key);
    gs.clicks += Number(item.clicks || 0);
    gs.impressions += Number(item.impressions || 0);
    gs.spending += Number(item.spend ?? item.spending ?? 0);
    gs.earning += Number(item.earning || 0);
  }

  for (const item of Array.isArray(countryRoiRows) ? countryRoiRows : []) {
    const subDomain = item.sub_domain || item.subDomain;
    const key = countryBreakdownKey(item.date, subDomain);
    if (!key) continue;

    const rows = index.get(key) || [];
    const spending = Number(item.spend ?? item.spending ?? 0);
    const adTax = spending * (rate || 0.05);
    const totalSpending = spending + adTax;
    let earning = Number(item.earning || 0);
    const clicks =
      item.clicks !== null && item.clicks !== undefined ? Number(item.clicks) : null;
    const impressions =
      item.impressions !== null && item.impressions !== undefined
        ? Number(item.impressions)
        : null;

    const dStr = String(item.date || "").slice(0, 10);
    const rawSub = String(subDomain || "").trim().toLowerCase();
    const slug = rawSub.includes(".") ? rawSub.split(".")[0] : rawSub;
    const gamRev = gamRevMap.get(`${dStr}__${rawSub}`) || gamRevMap.get(`${dStr}__${slug}`) || 0;
    const gs = groupStats.get(key) || { clicks: 0, impressions: 0, spending: 0, earning: 0 };

    if (earning <= 0.01 && gamRev > 0) {
      const share =
        gs.clicks > 0
          ? (clicks || 0) / gs.clicks
          : gs.impressions > 0
            ? (impressions || 0) / gs.impressions
            : gs.spending > 0
              ? spending / gs.spending
              : 0;
      earning = Math.round(share * gamRev * 100) / 100;
    }

    const code = String(item.country_code || item.countryCode || "").toUpperCase();
    const name = item.country_name || item.countryName || item.country || code;
    const profit = earning - totalSpending;
    const roi = (item.roi !== undefined && item.roi !== null && earning === Number(item.earning || 0)) ? Number(item.roi) : totalSpending > 0 ? Math.round(((earning - totalSpending) / totalSpending) * 100 * 100) / 100 : 0;

    rows.push({
      id: item.id || `${key}__${code}`,
      country: name,
      isoCode: code,
      countryLabel: `${name}${code ? ` (${code})` : ""}`,
      spending,
      adTax,
      totalSpending,
      earning,
      earningKnown: item.earningKnown !== false,
      impressions,
      clicks,
      cpc:
        clicks && clicks > 0
          ? spending > 0
            ? spending / clicks
            : earning / clicks
          : Number(item.cpc || 0),
      roi,
    });
    index.set(key, rows);

    // Daftarkan juga kunci slug pendek jika subDomain membawa nama domain (contoh: "insurance.tiktokmodapk.net" -> "insurance")
    if (rawSub.includes(".")) {
      const slugKey = countryBreakdownKey(item.date, slug);
      if (slugKey) {
        index.set(slugKey, rows);
      }
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
  if (!index || !item) return [];
  const primary = index.get(countryBreakdownKey(item?.date, item?.subDomain));
  if (primary && primary.length > 0) return primary;

  const rawSub = String(item?.subDomain || "").trim().toLowerCase();
  const rawDay = String(item?.date || "").slice(0, 10);
  if (!rawDay || !rawSub) return [];

  // Jika item.subDomain membawa domain (contoh: "insurance.tiktokmodapk.net" -> "insurance")
  const slug = rawSub.split(".")[0];
  const bySlug = index.get(`${rawDay}__${slug}`);
  if (bySlug && bySlug.length > 0) return bySlug;

  // Jika di index tersimpan FQDN dan item.subDomain adalah slug pendek
  for (const [key, rows] of index.entries()) {
    if (key.startsWith(`${rawDay}__${slug}.`)) {
      return rows;
    }
  }

  return [];
}

// Pasangan `[kunci, baris]`. RTDB mengirim `countryRoi` sebagai object berkunci
// `subdomain__negara`; array hanya muncul kalau kuncinya kebetulan berupa angka berurutan.
function toRows(value) {
  if (!value) return [];
  return Object.entries(value).filter(([, row]) => row);
}
