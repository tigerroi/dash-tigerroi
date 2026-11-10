import { cellText } from "./cellText.js";
import { canonicalSubDomain } from "./userSubDomains.js";

// Pemilik sebuah baris ROI: advertiser (PIC) dan domain induknya. Baris ROI membawa nama subdomain
// dan PIC-nya sendiri, tapi TIDAK membawa domain induk — yang tahu itu `subDomains.parentDomain`.
//
// Dipakai dua grafik per subdomain di Overview untuk menyaring; aturan pencocokannya sengaja sama
// dengan `splitByOwner` di src/lib/profitLoss.js, termasuk jatuh ke pencocokan akhiran untuk
// subdomain yang belum terdaftar — kalau tidak, situs yang baru dipasang menghilang dari filter
// domain tanpa satu pun tanda di layar.

const normalize = (value) => cellText(value).toLowerCase();

const clean = (value) => cellText(value);

const cleanDomain = (value) =>
  clean(value)
    .toLowerCase()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .trim();

export function subDomainOwnerIndex(subDomains, domains) {
  const byName = new Map();
  for (const sub of subDomains || []) {
    const rawKey = normalize(sub?.name || sub?.subdomain || sub?.sub_domain);
    if (!rawKey) continue;
    const parent = cleanDomain(sub?.parentDomain || sub?.parent_domain || sub?.domain);
    const pic = clean(sub?.pic || sub?.user_name || sub?.advertiser);

    // Simpan key slug biasa (contoh "careers")
    byName.set(rawKey, { domain: parent, pic, name: clean(sub?.name) });

    // Jika belum ada domain di key-nya dan parent diketahui, daftarkan juga hostname lengkapnya (contoh "careers.tiktokmodapk.net")
    if (parent && !rawKey.includes(".")) {
      byName.set(`${rawKey}.${parent}`, { domain: parent, pic, name: clean(sub?.name) });
    }
    // Jika key berupa hostname lengkap (FQDN), daftarkan juga slug singkatnya (contoh "careers")
    if (rawKey.includes(".")) {
      const slug = rawKey.split(".")[0];
      if (slug && !byName.has(slug)) {
        byName.set(slug, { domain: parent, pic, name: clean(sub?.name) });
      }
    }

    // Daftarkan setiap kode campaign (contoh "7KL2", "TvH1") agar pencarian berdasarkan kode campaign langsung menemukan domain dan PIC-nya
    const rawCodes = sub?.campaignCodes || sub?.campaign_codes || "";
    const codes = String(rawCodes)
      .split(/[^A-Za-z0-9]+/)
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean);
    for (const code of codes) {
      if (!byName.has(code)) {
        byName.set(code, { domain: parent, pic, name: clean(sub?.name) });
      }
    }
  }

  const knownDomains = (domains || [])
    .map((item) => cleanDomain(item?.domainUrl || item?.name || item?.domain))
    .filter(Boolean);

  /** Domain induk sebuah subdomain, "" kalau tidak ada yang tahu. */
  function domainOf(name) {
    const key = cleanDomain(name);
    if (!key) return "";

    const registered = byName.get(key)?.domain || byName.get(key.split(".")[0])?.domain;
    if (registered) return registered;

    return (
      knownDomains.find((domain) => {
        const suffix = domain.toLowerCase();
        return key === suffix || key.endsWith(`.${suffix}`);
      }) || ""
    );
  }

  /**
   * Nama FQDN lengkap sebuah subdomain (contoh: "careers" + domain induk "tiktokmodapk.net" -> "careers.tiktokmodapk.net").
   */
  function fullOf(name) {
    const raw = clean(name).trim();
    if (!raw) return "";
    const domain = domainOf(raw);
    if (!domain) return raw;
    const lower = raw.toLowerCase();
    const lowerDomain = domain.toLowerCase();
    if (lower === lowerDomain || lower.endsWith(`.${lowerDomain}`)) return raw;
    return `${raw}.${domain}`;
  }

  /**
   * PIC sebuah baris. Yang di BARIS lebih dulu: itu yang dipakai sisi sync saat menulis baris
   * dan yang tampil di kolom tabel; `subDomains.pic` cuma menambal baris yang tidak membawanya.
   */
  function picOf(name, rowPic) {
    const key = cleanDomain(name);
    return (
      clean(rowPic) ||
      byName.get(key)?.pic ||
      byName.get(key.split(".")[0])?.pic ||
      ""
    );
  }

  return {
    domainOf,
    fullOf,
    picOf,
  };
}

/** Pilihan yang tersedia untuk dua dropdown, dari baris yang sedang berada dalam periode. */
export function ownerFilterOptions(rows, owners) {
  const advertisers = new Set();
  const domains = new Set();

  for (const row of rows || []) {
    const name = cellText(row?.subDomain || row?.sub_domain || row?.subdomain || row?.site_code);
    if (!name) continue;

    const pic = owners.picOf(name, row?.pic);
    if (pic) advertisers.add(pic);

    const domain = owners.domainOf(name);
    if (domain) domains.add(domain);
  }

  return {
    advertisers: [...advertisers].sort((a, b) => a.localeCompare(b)),
    domains: [...domains].sort((a, b) => a.localeCompare(b)),
  };
}

/**
 * Baris yang lolos ketiga filter. Yang kosong berarti "semua" — bukan "yang pemiliknya tidak
 * diketahui": baris tanpa PIC tetap ikut selama advertisernya tidak dipilih, dan menghilang begitu
 * satu nama dipilih, karena ia bukan milik nama itu.
 */
export function filterRowsByOwner(
  rows,
  owners,
  { advertiser = "", domain = "", subDomain = "" } = {},
) {
  if (!advertiser && !domain && !subDomain) return rows || [];

  const targetSub = canonicalSubDomain(subDomain) || subDomain;

  return (rows || []).filter((row) => {
    const rawName = cellText(row?.subDomain || row?.sub_domain || row?.subdomain || row?.site_code);
    const name = canonicalSubDomain(rawName) || rawName;

    if (targetSub && name !== targetSub && rawName !== subDomain) return false;
    if (
      advertiser &&
      owners.picOf(name, row?.pic) !== advertiser &&
      owners.picOf(rawName, row?.pic) !== advertiser
    )
      return false;
    if (
      domain &&
      owners.domainOf(name) !== domain &&
      owners.domainOf(rawName) !== domain
    )
      return false;

    return true;
  });
}

// Nama subdomain yang ada di sekumpulan baris, urut dan tanpa kembar. Lewat `cellText`, bukan
// `firstValue`: yang terakhir menjatuhkan baris tanpa subdomain ke "-", dan "-" di dropdown adalah
// pilihan yang tidak menyaring apa pun kecuali dirinya sendiri.
export function subDomainNames(rows) {
  const names = new Set();
  for (const row of rows || []) {
    const rawName = cellText(row?.subDomain || row?.sub_domain || row?.subdomain || row?.site_code);
    if (!rawName) continue;
    const name = canonicalSubDomain(rawName) || rawName;
    names.add(name);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

/**
 * Isi ketiga dropdown kepemilikan, dengan ATURAN yang dulu cuma tinggal di Overview:
 * - advertiser dari SELURUH baris (memilih satu tidak boleh menghapus nama lain dari daftarnya);
 * - domain milik advertiser yang dipilih saja (domain tanpa satu baris milik orang itu = pilihan
 *   yang hasilnya pasti kosong);
 * - subdomain milik advertiser DAN domain yang dipilih.
 * Semuanya lewat `filterRowsByOwner` — fungsi yang sama dengan yang menyaring isi grafik.
 */
export function ownerChoices(rows, owners, { advertiser = "", domain = "" } = {}) {
  const all = ownerFilterOptions(rows, owners);
  const domains = advertiser
    ? ownerFilterOptions(filterRowsByOwner(rows, owners, { advertiser }), owners).domains
    : all.domains;
  return {
    advertisers: all.advertisers,
    domains,
    subDomains: subDomainNames(filterRowsByOwner(rows, owners, { advertiser, domain })),
  };
}
