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
  if (item.subDomain && item.campaignCode) return `Otomatis dari kode ${item.campaignCode}`;
  if (item.subDomain) return "Otomatis dari kode";
  return item.campaignCode
    ? `Kode ${item.campaignCode} belum terdaftar di subdomain manapun`
    : "Belum dipetakan — daftarkan kodenya di halaman Sub Domains";
}

/**
 * Seluruh campaign armada untuk halaman Campaign, dari `store.users` yang sudah dilanggan.
 *
 * `id` membawa pemiliknya: satu campaign bisa tertinggal di dua profil selama ad account-nya
 * berpindah tangan, dan dua baris ber-key sama saling menimpa di React. Perintah saklar ikut di
 * barisnya karena ia tinggal di profil pemilik, bukan di campaign.
 */
export function fleetCampaignRows(users) {
  const rows = [];
  for (const user of Array.isArray(users) ? users : []) {
    if (!user || user.deletedAt) continue;
    const commands =
      user.campaignCommands && typeof user.campaignCommands === "object"
        ? user.campaignCommands
        : {};
    for (const row of normalizeCampaignRows(user.campaigns)) {
      rows.push({
        ...row,
        id: `${user.id}__${row.campaignId || row.id}`,
        userId: user.id,
        owner: user.name || user.email || "-",
        command: commands[row.campaignId] || null,
      });
    }
  }
  return rows;
}
