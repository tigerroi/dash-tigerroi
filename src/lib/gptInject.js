// Tab AdX di /plugin — sisi UI-nya.
//
// Yang MENGURAI kode Ad Manager dan MENYUSUN tag-nya tinggal di server kontrol
// (functions/gpt-inject-core.js), bukan di sini: pratinjau yang disusun browser bisa berbeda dari
// kode yang ditulis server suatu hari, dan yang berbeda baru terbaca sebagai slot kosong di situs
// yang sedang menerima trafik berbayar. Modul ini cuma memegang yang dibutuhkan layar sebelum satu
// permintaan pun dikirim: template ukuran, jumlah slot yang bisa dipilih, dan label hasil.

// Cerminan GPT_MAX_SLOTS di functions/gpt-inject-core.js — plugin punya lima kotak kode iklan.
// Dijaga gptInject.test.mjs, yang membaca berkas seberangnya.
export const GPT_MAX_SLOTS = 5;

/**
 * Template ukuran BAWAAN — yang tidak bisa dihapus siapa pun.
 *
 * Yang pertama adalah daftar yang di-generate Ad Manager untuk unit `ca-pub-…-tag` (35 ukuran, 14 Sep
 * 2026): titik awal setiap pengujian, dan satu-satunya yang pasti diterima unitnya. Sisanya
 * penyempitan yang paling sering diuji — tiap template menjawab satu pertanyaan ("apakah ukuran kecil
 * menurunkan eCPM?"), jadi daftarnya pendek dan bernama menurut pertanyaan itu.
 */
export const BUILT_IN_GPT_TEMPLATES = [
  {
    id: "builtin-ad-manager",
    name: "Semua ukuran Ad Manager",
    sizes:
      "300x100,168x42,728x90,750x200,216x54,336x280,768x1024,1024x768,120x20,300x250,234x60,120x600,168x28,240x400,300x75,120x240,320x100,300x50,120x90,88x31,160x600,320x480,250x250,320x50,750x100,970x90,180x150,120x30,300x600,200x200,216x36,125x125,250x360,468x60,750x300",
  },
  {
    id: "builtin-mobile",
    name: "Mobile",
    sizes: "320x50,300x50,320x100,300x100,300x250,336x280,320x480,300x600",
  },
  {
    id: "builtin-iab",
    name: "Display standar (IAB)",
    sizes: "300x250,336x280,728x90,970x90,468x60,160x600,300x600,320x50",
  },
  {
    id: "builtin-rectangle",
    name: "Rectangle saja",
    sizes: "300x250,336x280",
  },
];

// Pemecah ringan untuk MENGHITUNG dan menampilkan, bukan untuk menolak. Yang menolak ukuran yang
// tidak sah cuma server (`parseGptSizes`) — salinan kedua dari aturan yang menolak akan berselisih
// suatu hari, dan yang lebih longgar menang tanpa berbunyi.
export function sizeTokens(text) {
  return String(text ?? "")
    .split(/[\s,;]+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Template yang disimpan orang → baris RTDB, atau lempar.
 *
 * Nama wajib unik di antara template yang ADA (bawaan ikut): dua template bernama sama di satu
 * dropdown tidak bisa dibedakan, dan yang salah pilih baru terbaca sebagai ukuran yang tidak diminta
 * — sepola preset negara.
 */
export function gptTemplateEntry({ name, sizes }, existing = []) {
  const label = String(name ?? "").trim();
  const list = sizeTokens(sizes);
  if (!label) throw new Error("Beri nama templatenya dulu, misalnya Mobile kecil.");
  if (label.length > 60) throw new Error("Nama template terlalu panjang (maks 60 karakter).");
  if (!list.length) throw new Error("Template tanpa ukuran tidak bisa disimpan.");
  const taken = (existing || []).some(
    (item) =>
      String(item?.name ?? "")
        .trim()
        .toLowerCase() === label.toLowerCase(),
  );
  if (taken) throw new Error(`Template "${label}" sudah ada — pakai nama lain.`);
  const text = list.join(",");
  if (text.length > 4000) throw new Error("Daftar ukurannya terlalu panjang untuk disimpan.");
  return { name: label, sizes: text };
}

/**
 * Ukuran baru untuk template TERSIMPAN yang sudah ada → teks yang ditulis, atau lempar. Namanya tidak
 * ikut berubah; template bawaan tidak bisa diperbarui (ia tinggal di kode, bukan di RTDB).
 */
export function gptTemplateSizesUpdate(template, sizes) {
  if (!template?.id || template.builtIn) {
    throw new Error("Template bawaan tidak bisa diubah — simpan sebagai template baru.");
  }
  const list = sizeTokens(sizes);
  if (!list.length) throw new Error("Template tanpa ukuran tidak bisa disimpan.");
  const text = list.join(",");
  if (text.length > 4000) throw new Error("Daftar ukurannya terlalu panjang untuk disimpan.");
  return { sizes: text };
}

/**
 * Bawaan lebih dulu, lalu yang disimpan orang (urut nama) — yang diarsipkan tidak ikut.
 *
 * `deletedAt` disaring DI SINI karena langganannya `subscribeValue` (satu node nilai), sepola
 * `countryPresetsFor`.
 */
export function gptTemplatesOf(saved) {
  const rows = Array.isArray(saved) ? saved : Object.values(saved || {});
  const custom = rows
    .filter((row) => row?.id && !row.deletedAt && row.name && row.sizes)
    .map((row) => ({
      id: row.id,
      name: String(row.name),
      sizes: String(row.sizes),
      builtIn: false,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return [...BUILT_IN_GPT_TEMPLATES.map((row) => ({ ...row, builtIn: true })), ...custom];
}

// Template yang isinya persis sama dengan kotak ukuran — untuk menandai dropdown-nya tanpa menyimpan
// "template terpilih" sebagai keadaan kedua yang bisa berselisih dengan kotaknya.
export function matchingTemplate(templates, sizes) {
  const wanted = sizeTokens(sizes).join(",");
  return (templates || []).find((item) => sizeTokens(item.sizes).join(",") === wanted) || null;
}

// Kunci pembanding pilihan (ukuran, slot, unit per network). Pratinjau yang disusun dari pilihan LAIN daripada yang sedang tergambar di
// form tidak boleh ditulis: tombol Inject membaca kunci ini, bukan menebak dari field mana yang disentuh.
// Kode unit per network ikut, karena mengganti unit mengganti path yang ditulis ke header.
export function gptSpecKey(options, adUnitCodes = {}) {
  const units = Object.keys(adUnitCodes || {})
    .sort()
    .map((code) => [code, adUnitCodes[code]]);
  return JSON.stringify([sizeTokens(options?.sizes).join(","), Number(options?.slots) || 0, units]);
}

/**
 * Unit yang terpilih untuk tiap network: yang dipilih admin, atau unit Ad Exchange Display network itu.
 *
 * Bawaannya SAMA dengan server (`pickGptUnit`) — dan yang dikirim tetap pilihan eksplisit ini, supaya
 * pratinjau dan inject menyebut unit yang sama dengan radio yang tergambar, bukan bergantung pada
 * aturan bawaan yang dijalankan dua kali.
 */
export function chosenUnits(networks, picked = {}) {
  const out = {};
  for (const network of networks || []) {
    const units = network.units || [];
    const wanted = picked?.[network.networkCode];
    const unit =
      units.find((item) => item.adUnitCode === wanted) ||
      (units.filter((item) => item.adExchange).length === 1
        ? units.find((item) => item.adExchange)
        : null);
    if (unit) out[network.networkCode] = unit.adUnitCode;
  }
  return out;
}

const HEADER_MODES = {
  // Kuning, bukan hijau: script yang memuat defineSlot diganti UTUH, dan yang pernah ditulis orang di
  // dalamnya (setTargeting) ikut hilang — potongannya disebut di baris hasil.
  replaced: { label: "GPT lama diganti", tone: "warning" },
  appended: { label: "Ditambahkan", tone: "neutral" },
};

export function headerModeLabel(mode) {
  return HEADER_MODES[mode] || { label: mode || "-", tone: "neutral" };
}
