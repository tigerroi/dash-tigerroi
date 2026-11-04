// Subdomain milik seorang user — dan baris ROI mana yang ikut dengannya.
//
// Kepemilikan tinggal di record subdomain (`subDomains.pic`), satu tempat. Kolom `pic` di baris
// ROI BUKAN kepemilikan: ia stempel PIC pada saat baris itu ditulis, dan tidak pernah ditulis
// ulang. Begitu sebuah subdomain berpindah tangan, ratusan baris lamanya tetap menyebut nama PIC
// yang dulu — pada 17 Agu 2026 delapan subdomain milik Lightman membawa 600+ baris ber-`pic`
// "Nurjaman WL 2", nama yang bukan user mana pun lagi. Halaman /users/{uid} yang menyaring lewat
// `pic` karena itu memperlihatkan riwayat yang bolong, dan filter sub-domain-nya berisi daftar
// yang tidak sama dengan subdomain yang dipegang user itu.
//
// Jadi yang menentukan baris ini milik siapa adalah NAMA SUBDOMAIN-nya, dicocokkan ke daftar
// subdomain yang dipegang user sekarang. Nama subdomain ada di baris sejak awal; PIC-nya bisa
// berganti kapan saja tanpa satu pun baris lama ikut berubah.

// Nilai sel bisa datang sebagai teks, array (hasil impor), atau `{ value }`. Ketiganya
// dibandingkan sebagai nama yang sama.
function nameKey(value) {
  const raw = Array.isArray(value) ? value[0] : (value?.value ?? value);
  return String(raw ?? "")
    .trim()
    .toLowerCase();
}

/**
 * Subdomain yang dipegang user ini. Kepemilikan dicocokkan longgar di kedua sisi karena record
 * subdomain menyimpan PIC-nya dengan nama kolom yang berbeda-beda tergantung umur datanya, dan
 * yang tersimpan bisa nama, username, email, atau id user-nya.
 */
export function assignedSubDomains(user, subDomains) {
  const userKeys = [user?.id, user?.name, user?.username, user?.email].map(nameKey).filter(Boolean);
  if (userKeys.length === 0) return [];

  // Alias pemetaan nama singkatan PIC ke identitas user
  const checkPicMatch = (picVal) => {
    const p = nameKey(picVal);
    if (!p) return false;
    if (userKeys.includes(p)) return true;

    // Pencocokan singkatan 3 huruf umum tim (Nur, Mul, Sul, Man)
    for (const uk of userKeys) {
      if (uk.length >= 3 && p.length >= 3) {
        if (uk.startsWith(p) || p.startsWith(uk)) return true;
      }
      // Khusus Zulfan / Sulaiman
      if ((p === "sul" && uk.includes("zulfan")) || (uk === "sul" && p.includes("zulfan"))) return true;
      // Khusus Mas Def / Man / Ade Suparman
      if (
        (p === "man" && (uk.includes("def") || uk.includes("mas") || uk.includes("suparman"))) ||
        (uk === "man" && (p.includes("def") || p.includes("mas") || p.includes("suparman")))
      )
        return true;
      // Khusus Nurjaman / Lightman
      if ((p === "nur" && uk.includes("lightman")) || (p === "lightman" && uk.startsWith("nur"))) return true;
    }
    return false;
  };

  return (Array.isArray(subDomains) ? subDomains : []).filter((item) => {
    if (!item || item.deletedAt) return false;

    // Prioritaskan nama PIC eksplisit jika terisi di baris subdomain
    const hasExplicitPic = Boolean(item.pic || item.user || item.userOwner);
    if (hasExplicitPic) {
      return [item.pic, item.user, item.userOwner, item.userId, item.ownerId]
        .filter(Boolean)
        .some(checkPicMatch);
    }

    // Fallback jika field teks pic kosong: gunakan picUserId atau pic_user_id
    if (item.picUserId && (item.picUserId === user.id || item.picUserId === user.name)) return true;
    if (item.pic_user_id && (item.pic_user_id === user.id || item.pic_user_id === user.name)) return true;

    return false;
  });
}

/** Kunci pembanding nama subdomain, untuk dipakai berulang kali tanpa menormalkan lagi tiap baris. */
export function subDomainNameKeys(subDomains) {
  const keys = new Set();
  for (const item of Array.isArray(subDomains) ? subDomains : []) {
    const rawKey = nameKey(item?.name ?? item);
    if (rawKey) {
      keys.add(rawKey);
      if (rawKey.includes(".")) {
        const slug = rawKey.split(".")[0].trim().toLowerCase();
        if (slug) keys.add(slug);
      }
    }
  }
  return keys;
}

/**
 * Baris ROI (harian maupun snapshot) untuk subdomain-subdomain itu.
 *
 * Daftar kosong menghasilkan tabel kosong, dan itu memang jawabannya: user yang belum memegang
 * subdomain apa pun tidak punya baris ROI. Jatuh kembali ke pencocokan `pic` di keadaan itu akan
 * menghidupkan lagi persis riwayat ber-PIC basi yang fungsi ini ada untuk membuangnya.
 */
export function rowsForSubDomains(rows, nameKeys) {
  const keys = nameKeys instanceof Set ? nameKeys : subDomainNameKeys(nameKeys);
  if (keys.size === 0) return [];

  // Kumpulkan daftar FQDN lengkap (ada titik) dan bare slug yang dimiliki oleh user
  const fqdnKeys = new Set();
  const bareKeys = new Set();
  for (const k of keys) {
    if (k.includes(".")) {
      fqdnKeys.add(k);
    } else {
      bareKeys.add(k);
    }
  }

  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const sub = row?.subDomain || row?.sub_domain || row?.name;
    const nk = nameKey(sub);
    if (!nk) return false;

    // 1. Jika baris membawa FQDN lengkap (misal: 'insurance.uniqueinfo24.com'):
    if (nk.includes(".")) {
      // a. Harus cocok persis dengan FQDN yang dimiliki user
      if (fqdnKeys.has(nk)) return true;

      // b. Jika user TIDAK memiliki FQDN tersebut, tolak jika user memiliki FQDN lain dengan slug yang sama.
      // Contoh: User memegang 'insurance.tiktokmodapk.net' (domain tiktokmodapk.net),
      // maka baris 'insurance.uniqueinfo24.com' (domain uniqueinfo24.com milik PIC lain) DITOLAK.
      const rowSlug = nk.split(".")[0].trim().toLowerCase();
      for (const ownedFqdn of fqdnKeys) {
        if (ownedFqdn.split(".")[0].trim().toLowerCase() === rowSlug) {
          return false;
        }
      }

      // c. Jika user memang hanya didaftarkan bare slug tanpa domain sama sekali
      return bareKeys.has(rowSlug);
    }

    // 2. Jika baris hanya membawa slug pendek tanpa domain (misal baris legacy 'keto' atau 'insurance'):
    // Cocok jika user memiliki FQDN yang berawalan slug ini, atau user memegang bare slug ini
    if (keys.has(nk)) return true;
    for (const ownedFqdn of fqdnKeys) {
      if (ownedFqdn.split(".")[0].trim().toLowerCase() === nk) {
        return true;
      }
    }

    return false;
  });
}

/** Pemetaan resmi 17 subdomain TigerROI ke nama domain lengkap (FQDN) */
export const OFFICIAL_SUBDOMAINS_MAP = {
  menu: "menu.ihopmenuwithprices.us",
  deals: "deals.ihopmenuwithprices.us",
  keto: "keto.ihopmenuwithprices.us",
  hacks: "hacks.ihopmenuwithprices.us",
  news: "news.ihopmenuwithprices.us",
  cantina: "cantina.tacobellmenuu.us",
  burrito: "burrito.tacobellmenuu.us",
  fries: "fries.tacobellmenuu.us",
  insurance: "insurance.tiktokmodapk.net",
  careers: "careers.tiktokmodapk.net",
  rewards: "rewards.tiktokmodapk.net",
  mod: "mod.tiktokmodapk.net",
  decor: "decor.trayedit.com",
  materials: "materials.trayedit.com",
  cabinets: "cabinets.trayedit.com",
  guides: "guides.trayedit.com",
  styling: "styling.trayedit.com",
};

/**
 * Menormalkan nama subdomain ke nama lengkap (FQDN) resmi.
 * Jika menerima slug pendek (misal 'cabinets'), mengembalikan 'cabinets.trayedit.com'.
 */
export function canonicalSubDomain(raw, subDomainsList = []) {
  const clean = String(raw || "").trim().toLowerCase().replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  if (!clean || clean === "unmapped" || clean === "tanpa subdomain") return raw || "";
  if (clean.includes(".")) return clean;

  if (OFFICIAL_SUBDOMAINS_MAP[clean]) {
    return OFFICIAL_SUBDOMAINS_MAP[clean];
  }

  for (const s of Array.isArray(subDomainsList) ? subDomainsList : []) {
    const sName = String(s?.name || "").trim().toLowerCase();
    const sSlug = sName.includes(".") ? sName.split(".")[0].trim() : sName;
    if (sSlug === clean) {
      if (sName.includes(".")) return sName;
      const parent = String(s.parent_domain || s.parentDomain || "").trim().toLowerCase().replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
      if (parent) return `${sSlug}.${parent}`;
    }
  }

  return clean;
}

