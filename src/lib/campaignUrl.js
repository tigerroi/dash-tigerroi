/**
 * Campaign URL sebuah subdomain, disaring ke kode campaign yang benar-benar terdaftar di barisnya.
 *
 * `subDomainCampaignUrls` (functions/gating-core.js) menulis SELURUH link campaign yang namanya
 * mengarah ke subdomain itu, dipisah koma — satu subdomain memang menaungi beberapa campaign, dan
 * sebagian di antaranya bukan milik kode yang dipasang orang di iklannya. Yang dicari di halaman
 * ini adalah link milik KODE-nya, dan alias Keitaro memuat kode itu di dalam dirinya sendiri:
 * "2W7J" ada di dalam https://rabbitracing.live/2jvm2W7J?bit=[race].
 *
 * Jadi jumlah link yang digambar mengikuti jumlah KODE, bukan jumlah campaign: satu link per kode,
 * berurutan seperti kodenya diketik. Kode yang tidak punya link tidak menggambar apa pun — link
 * milik kode lain yang berdiri di tempatnya adalah link yang akan disalin ke iklan yang salah.
 *
 * Dicocokkan sebagai POTONGAN di dalam alias, sengaja berbeda dari `parseCampaignCodes` di sisi
 * sync yang mencocokkan kode sebagai token utuh. Yang dibaca di sana NAMA campaign yang diketik
 * orang — kode empat huruf akan cocok dengan kata mana pun secara kebetulan — sementara yang dibaca
 * di sini alias yang memang menyisipkan kodenya tanpa pemisah apa pun.
 *
 * Yang tidak cocok satu pun DIBIARKAN UTUH, bukan dikosongkan: baris yang kolom Kode Campaign-nya
 * masih kosong, dan campaign yang aliasnya tidak memuat kodenya, tetap punya link yang dipasang di
 * iklan. Menyembunyikannya berarti kolom ini kosong justru untuk baris yang paling perlu dilihat,
 * dan tidak ada apa pun di layar yang menyebutkan kenapa.
 */
export function campaignUrlForCodes(campaignUrl, campaignCodes) {
  const pairs = campaignUrlPairs(campaignUrl, campaignCodes);
  return pairs.length ? pairs.map((pair) => pair.url).join(", ") : campaignUrl;
}

/**
 * Pasangan kode → link, satu link per kode — bahan mentah dari aturan di atas.
 *
 * Dipakai dialog "Buat campaign" di /campaigns, yang harus menawarkan KODE-nya (untuk nama campaign)
 * berikut link yang akan dipasang di iklan. Dipisah dari `campaignUrlForCodes` alih-alih
 * mencocokkan ulang di sana: satu aturan pencocokan, dua pembaca — yang kedua akan berselisih suatu
 * hari, dan yang berselisih di sini adalah link yang dipasang di iklan berbayar.
 */
export function campaignUrlPairs(campaignUrl, campaignCodes) {
  const urls = splitUrls(campaignUrl);
  if (!urls.length) return [];

  const pairs = [];
  // Kodenya dikembalikan APA ADANYA seperti diketik orang ("tbxW"), sementara pencocokannya tetap
  // huruf kecil: yang dipakai dialog Buat campaign sebagai awalan nama adalah tulisan aslinya, dan
  // nama campaign armada memang memuat kodenya dengan kapitalisasi itu.
  for (const code of parseCodesRaw(campaignCodes)) {
    const lower = code.toLowerCase();
    const match = urls.find(
      (url) => url.toLowerCase().includes(lower) && !pairs.some((pair) => pair.url === url),
    );
    if (match) pairs.push({ code, url: match });
  }
  return pairs;
}

// Satu baris subdomain, dengan kolom Campaign URL yang sudah disaring ke kodenya. Diturunkan saat
// DIRENDER dan tidak ditulis ke RTDB: yang tersimpan di sana adalah seluruh link milik subdomain
// itu (`subDomainCampaignUrls`), dan yang ini cuma cara membacanya.
export function subDomainRows(items = []) {
  return items.map((row) => {
    const next = campaignUrlForCodes(row?.campaignUrl, row?.campaignCodes);
    return next === row?.campaignUrl ? row : { ...row, campaignUrl: next };
  });
}

function splitUrls(value) {
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

// "pBRw, TvH1" / "pBRw TvH1" / satu per baris -> ["pBRw", "TvH1"]. Bentuk yang sama dengan
// `parseCampaignCodes` di functions/sync-core.js — yang diketik orang di kotak yang sama — hanya
// kapitalisasinya dibiarkan, dan yang mencocokkan yang mengecilkannya sendiri.
function parseCodesRaw(value) {
  if (Array.isArray(value)) return value.flatMap((entry) => parseCodesRaw(entry));
  return String(value ?? "")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
}
