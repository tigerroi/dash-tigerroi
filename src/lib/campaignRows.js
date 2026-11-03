import { firstValue } from "./firstValue.js";

/**
 * Baris campaign dari `users/{id}.campaigns` — dibaca profil user DAN halaman Campaign.
 *
 * Pindah dari UserDetail.jsx begitu pembacanya jadi dua: dua salinan penormal baris yang sama akan
 * menyebut dua status berbeda untuk satu campaign di dua halaman bertetangga.
 */

function toArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === "object")
    return Object.entries(value).map(([id, item]) => ({ id, ...item }));
  return [];
}

export function normalizeCampaignRows(items) {
  return toArray(items).map((item) => ({
    id: item.id || item.campaign,
    campaign: item.campaign,
    account: item.account || item.adAccount || item.actName || "-",
    subDomain: item.subDomain || "",
    campaignCode: item.campaignCode || "",
    subDomainSource: item.subDomainSource || "",
    pic: item.pic || "",
    owner: item.owner || "",
    // ID campaign di Meta — alamat yang dipakai saklar on/off. Baris lama (dan baris yang
    // diturunkan dari laporan ROI, yang tidak punya sisi Meta) datang tanpa ini, dan tombolnya
    // mati dengan alasannya alih-alih menembakkan perintah yang pasti gagal.
    campaignId: String(item.campaignId || ""),
    status: item.status || "",
    // Posisi saklar apa adanya dari Meta (`status`). Label di kolom Status diturunkan dari field
    // yang sama plus `startTime`, tapi diturunkannya di sisi sync — bukan di sini.
    configuredStatus: item.configuredStatus || "",
    // Jadwal mulai tayang, apa adanya dari Meta. Yang memutuskan label "Terjadwal" adalah sisi
    // sync (`campaignStatusLabel`); yang dibaca di sini cuma tanggalnya, untuk disebut di bawah
    // pilnya.
    startTime: item.startTime || "",
    // Campaign-nya sudah tidak dikembalikan Meta (diarsipkan/dihapus). Beda dari status yang
    // belum terbaca: yang ini tidak akan terbaca lagi, dan saklarnya tidak punya lawan bicara.
    metaMissing: Boolean(item.metaMissing),
    statusAppliedAt: item.statusAppliedAt || "",
    result: firstValue(item.result),
    // Event apa yang dihitung sebagai hasil (ditulis sisi sync dari tujuan optimasi ad set-nya).
    // Tanpa ini, "2.449" tidak bisa dibedakan dari 2.449 lead.
    resultType: item.resultType || "",
    costPerResult: firstValue(item.costPerResult, item.cpc),
    dailyBudget: firstValue(item.dailyBudget),
    spendToday: firstValue(item.spendToday),
    spendDate: firstValue(item.spendDate, item.date),
  }));
}

// Kenapa campaign ini menunjuk ke tempatnya. Tanpa ini baris yang dipetakan otomatis tidak bisa
// dibedakan dari yang diatur tangan, padahal keduanya berperilaku beda pada sync berikutnya —
// yang manual saja yang selamat dari perubahan kode subdomainnya.
export function describeMappingSource(item) {
  if (item.subDomainSource === "manual") return "Dipetakan manual";
  const hasSub = item.subDomain && item.subDomain !== "unmapped" && item.subDomain !== "-";
  if (hasSub && item.campaignCode) return `Otomatis dari kode ${item.campaignCode}`;
  if (hasSub) return "Otomatis dari kode";
  return item.campaignCode
    ? `Kode ${item.campaignCode} belum terdaftar di subdomain manapun`
    : "Belum dipetakan — daftarkan kodenya di halaman Sub Domains";
}

/**
 * Seluruh campaign armada untuk halaman Campaign, dari `store.users` yang sudah dilanggan.
 * Mendukung pencocokan otomatis realtime dari daftar `store.subDomains`.
 *
 * `id` membawa pemiliknya: satu campaign bisa tertinggal di dua profil selama ad account-nya
 * berpindah tangan, dan dua baris ber-key sama saling menimpa di React. Perintah saklar ikut di
 * barisnya karena ia tinggal di profil pemilik, bukan di campaign.
 */
export function fleetCampaignRows(users, subDomains = []) {
  // Index kode campaign -> info subdomain dari subDomains
  const codeMap = new Map();
  for (const sub of Array.isArray(subDomains) ? subDomains : []) {
    if (!sub || sub.status === "Archived" || sub.status === "Inactive") continue;
    const rawCodes = sub.campaignCodes || sub.campaign_codes || "";
    const codes = String(rawCodes)
      .split(/[^A-Za-z0-9]+/)
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean);
    for (const code of codes) {
      if (!codeMap.has(code)) {
        codeMap.set(code, {
          subDomain: sub.name || sub.subdomain || "",
          siteCode: sub.siteCode || sub.site_code || "",
          pic: sub.pic || "",
          domain: sub.parentDomain || sub.domain || "",
        });
      }
    }
  }

  const rows = [];
  for (const user of Array.isArray(users) ? users : []) {
    if (!user || user.deletedAt) continue;
    const commands =
      user.campaignCommands && typeof user.campaignCommands === "object"
        ? user.campaignCommands
        : {};
    for (const row of normalizeCampaignRows(user.campaigns)) {
      let subDomain = row.subDomain;
      let pic = row.pic || row.owner;
      let campaignCode = row.campaignCode;

      if (!campaignCode && row.campaign) {
        campaignCode = String(row.campaign).trim().split(/[\s_-]+/)[0] || "";
      }

      const codeKey = String(campaignCode || "").trim().toLowerCase();
      const mapped = codeKey ? codeMap.get(codeKey) : null;
      if (mapped) {
        if (!subDomain || subDomain === "unmapped" || subDomain === "-") {
          subDomain = mapped.subDomain;
        }
        if (!pic || pic === "-" || pic === "Belum ada PIC") {
          pic = mapped.pic;
        }
      }

      const isUnmappedSub = !subDomain || subDomain === "unmapped" || subDomain === "-";
      const finalSubDomain = isUnmappedSub ? "" : subDomain;
      const finalOwner = (pic && pic !== "-" && pic !== "Belum ada PIC")
        ? pic
        : (user.name || user.email || "-");

      rows.push({
        ...row,
        subDomain: finalSubDomain,
        campaignCode: campaignCode || row.campaignCode || "",
        pic: pic || row.pic || "",
        id: `${user.id}__${row.campaignId || row.id}`,
        userId: user.id,
        owner: finalOwner,
        command: commands[row.campaignId] || null,
      });
    }
  }
  return rows;
}
