import { listSites as listAdsenseSites } from "./adsense.js";
import { hostnameFrom } from "./discover-core.js";
import { listSites as listGamSites } from "./gam.js";
import { accountProvider, accountToken, adsenseAccountName, normalizeName } from "./sync-core.js";

// Status persetujuan sebuah SITUS di sisi Google, dari kedua API.
//
// Ini jawaban langsung untuk pertanyaan yang selama ini ditebak dari angka: "kenapa domain ini
// earning-nya nol". Situs yang belum atau tidak disetujui memang tidak akan pernah menghasilkan,
// dan sampai sekarang keadaan itu tidak bisa dibedakan dari domain sehat yang sedang sepi.
//
// DIPASANG DI DOMAIN, BUKAN SUBDOMAIN — dan itu bukan pilihan, melainkan yang dilaporkan Google.
// Diperiksa ke API produksi (20 Agu 2026): tiap network GAM mengembalikan TEPAT SATU situs, yaitu
// domain induknya; dan di AdSense subdomain memang terdaftar satu per satu, tapi `state`-nya
// kosong untuk semuanya kecuali satu — lagi-lagi domain induknya. Google mereview situs di level
// domain; subdomain menumpang persetujuan induknya.
//
// Karena itu kolomnya duduk di /domains. Menaruhnya di /sub-domains berarti 34 baris kosong dan
// satu baris terisi per domain, yang terbaca sebagai "subdomain ini bermasalah" padahal yang
// terjadi cuma Google tidak mereview per subdomain.

// Nilai enum -> kata yang dipakai konsol masing-masing. Sengaja TIDAK disatukan jadi satu
// kosakata: "Disetujui" adalah kata Ad Manager dan "Siap" adalah kata AdSense, dan domain yang
// dimonetisasi lewat AdSense yang ditulis "Disetujui" akan mengirim orang mencari layar
// persetujuan yang tidak ada di akunnya.
const LABELS = {
  gam: {
    APPROVED: "Disetujui",
    DISAPPROVED: "Ditolak",
    REQUIRES_REVIEW: "Perlu Review",
    DRAFT: "Draft",
    UNCHECKED: "Belum Dicek",
  },
  adsense: {
    READY: "Siap",
    REQUIRES_REVIEW: "Perlu Review",
    GETTING_READY: "Disiapkan",
    NEEDS_ATTENTION: "Perlu Tindakan",
  },
};

/**
 * Label satu situs, atau "" kalau API-nya tidak menyebut status apa pun.
 *
 * Nilai yang TIDAK ada di peta dikembalikan apa adanya, bukan dibuang: enum kedua API ini bisa
 * bertambah (dan nama enumnya sudah berbeda antar tipe network), dan status baru yang hilang
 * diam-diam persis sama tampilannya dengan situs yang belum pernah direview.
 */
export function siteApprovalLabel(provider, site) {
  const raw = String((provider === "adsense" ? site?.state : site?.approvalStatus) || "").trim();
  // AdSense mengosongkan `state` untuk tiap subdomain — bukan status yang buruk, melainkan tidak
  // ada status sama sekali. Dikosongkan juga di sini supaya kolomnya "-", bukan tebakan.
  if (!raw || raw.endsWith("_UNSPECIFIED")) return "";
  return LABELS[provider]?.[raw] || raw;
}

/**
 * Daftar situs satu akun sebagai `[{ host, approval, approvedAt }]`, dari API mana pun sumbernya.
 *
 * Bentuknya disamakan untuk kedua provider, alasan yang sama dengan `earningRowsByDimensions`:
 * yang bercabang cuma pemilihan API, dan hilirnya tidak pernah tahu laporan itu datang dari mana.
 */
export async function fetchSiteApprovals(account, configs) {
  const provider = accountProvider(account);
  const token = await accountToken(account, configs);
  const sites =
    provider === "adsense"
      ? await listAdsenseSites(adsenseAccountName(account), token)
      : await listGamSites(String(account?.networkCode || ""), token);

  const out = [];
  for (const site of sites || []) {
    const host = hostnameFrom(site?.url || site?.domain);
    if (!host) continue;
    const approval = siteApprovalLabel(provider, site);
    if (!approval) continue;
    out.push({
      host,
      approval,
      // Kapan statusnya terakhir berubah. Hanya GAM yang memberikannya; "Disetujui sejak kapan"
      // adalah yang membedakan domain yang baru lolos review dari yang sudah setahun jalan.
      approvedAt: site?.approvalStatusUpdateTime || "",
    });
  }
  return out;
}

/**
 * Serap hasil `fetchSiteApprovals` ke dalam `target`: `host -> { approval, approvedAt }`.
 *
 * Host yang sudah punya status dari akun sebelumnya TIDAK ditimpa: satu domain bisa terdaftar di
 * lebih dari satu akun (network GAM-nya sendiri dan akun AdSense yang memonetisasi subdomainnya),
 * dan yang pertama menjawab adalah yang akunnya lebih dulu di daftar — bukan yang paling buruk
 * beritanya. Menimpanya berarti kolom yang berubah-ubah tiap kali urutan akun berubah.
 */
export function collectSiteApprovals(sites, target) {
  for (const site of sites || []) {
    const host = normalizeName(site?.host);
    if (!host || target.has(host)) continue;
    target.set(host, { approval: site.approval, approvedAt: site.approvedAt || "" });
  }
  return target;
}

/**
 * Perubahan yang perlu ditulis ke tiap record domain: `[[id, { adApproval, adApprovalAt }]]`.
 *
 * `complete` menandai apakah SELURUH akun berhasil dibaca run ini. Kalau tidak, domain yang tidak
 * muncul di daftar mana pun dilewati sama sekali — persis aturan campaign yang hilang di
 * sync-meta: "tidak dikembalikan" hanya berarti sesuatu kalau memang diminta dan dijawab. Satu
 * akun yang gagal dibaca tidak mengabarkan apa pun tentang situs di dalamnya.
 *
 * Kalau semuanya berhasil dan domainnya tetap tidak muncul, statusnya DIKOSONGKAN, bukan diisi
 * "tidak terdaftar": domain bisa saja dimonetisasi lewat akun yang belum dihubungkan ke dashboard,
 * dan status basi dari minggu lalu lebih menyesatkan daripada sel kosong.
 */
export function siteApprovalUpdates(domains, byHost, complete) {
  const updates = [];
  for (const [id, domain] of Object.entries(domains || {})) {
    if (!domain || domain.deletedAt) continue;
    const host = normalizeName(domain.domainUrl);
    if (!host) continue;
    const found = byHost.get(host);
    if (!found) {
      if (!complete) continue;
      if (!domain.adApproval) continue;
      updates.push([id, { adApproval: null, adApprovalAt: null }]);
      continue;
    }
    if (domain.adApproval === found.approval && (domain.adApprovalAt || "") === found.approvedAt) {
      continue;
    }
    updates.push([id, { adApproval: found.approval, adApprovalAt: found.approvedAt || null }]);
  }
  return updates;
}
