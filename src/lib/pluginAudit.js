import { hostOf } from "./cloudflareDns.js";

/**
 * Tab "Cek Situs" di /plugin — aturan pemilihan dan tampilan. Penilaiannya sendiri tinggal di server
 * (`functions/plugin-audit-core.js`) dan TIDAK dicerminkan ke sini: yang dibaca halaman ini adalah
 * status yang sudah diputuskan server, jadi salinan kedua dari aturan penilaiannya tidak dipakai siapa
 * pun dan tidak akan pernah ikut diperbarui.
 */

// Berapa subdomain per request. Tiap situs lima bacaan; per gelombang kecil supaya satu domain berisi
// tiga puluh subdomain tidak menunggu satu request yang melewati batas tunggu nginx, dan tabelnya
// terisi bertahap alih-alih kosong sampai seluruhnya selesai. Di bawah `maxItems` route-nya (20).
export const AUDIT_BATCH = 10;

export const AUDIT_CHECKS = [
  {
    key: "adCode",
    label: "Kode Iklan",
    hint: "Kode iklan 1…N terisi sesuai Jumlah slot iklan; untuk tag GPT, div yang ditampilkan harus didefinisikan di header.",
  },
  {
    key: "displayMode",
    label: "Mode Tampilan",
    hint: "Mode tampilan iklan di tab Pengaturan Iklan plugin (Acak, Berurutan, Stacked).",
  },
  {
    key: "cmp",
    label: "CMP",
    hint: "Aktifkan CMP di tab CMP plugin. Off dihitung peringatan.",
  },
  {
    key: "network",
    label: "Network ID",
    hint: "Network code di defineSlot situs vs Kode Jaringan akun GAM subdomain itu di /gam-accounts. Hanya untuk kode iklan AdX (GPT).",
  },
  { key: "landing", label: "LP", hint: "Jumlah landing page yang aktif di plugin." },
  {
    key: "behaviour",
    label: "Behaviour",
    hint: "Deteksi pengunjung berulang On/Off. On tanpa Simpan Log aktif, atau aksi redirect tanpa URL, dihitung peringatan.",
  },
];

const TONES = { ok: "success", warn: "warning", fail: "danger", error: "danger", na: "neutral" };

// Jenis kode iklan punya warnanya sendiri, dan hijau TIDAK dipakai untuknya: hijau sudah berarti
// "lolos" di kolom-kolom sebelahnya, dan AdX yang hijau di samping AdSense yang hijau tidak bisa
// dibedakan sekilas.
const AD_TYPE_TONES = { AdX: "info", AdSense: "purple", Campuran: "warning", lain: "neutral" };

/**
 * Warna badge satu pemeriksaan. Dua kolom menyimpang dari "warna = status":
 *
 *   Kode Iklan — yang lolos diwarnai menurut JENISNYA (AdX biru, AdSense ungu); yang kosong atau
 *                bermasalah tetap memakai warna statusnya.
 *   CMP        — On hijau, Off kuning: yang dicari orang di kolom ini justru posisinya.
 */
export function auditBadgeTone(key, result) {
  if (!result) return "neutral";
  if (key === "adCode" && result.status === "ok") return AD_TYPE_TONES[result.type] || "neutral";
  // Ketiga mode sah; hijau di sini akan terbaca seolah satu mode lebih benar dari yang lain.
  if (key === "displayMode" && result.status === "ok") return "neutral";
  return TONES[result.status] || "neutral";
}

/**
 * Domain yang bisa dipilih: dari /domains DAN dari `parentDomain` baris subdomain. Keduanya, karena
 * subdomain yang domain induknya belum terdaftar di /domains tetap punya plugin yang perlu dicek —
 * daftar yang cuma membaca /domains menyembunyikannya dari satu-satunya pemilih di tab ini.
 */
export function auditDomains(domains, rows) {
  const names = new Set();
  for (const row of domains || []) {
    const host = hostOf(row?.domainUrl);
    if (host && !row?.deletedAt) names.add(host);
  }
  for (const row of rows || []) {
    const host = hostOf(row?.parentDomain);
    if (host) names.add(host);
  }
  return [...names].sort((left, right) => left.localeCompare(right));
}

/**
 * Subdomain milik satu domain. `parentDomain` yang terisi MENENTUKAN — dua domain bisa saling
 * berakhiran ("a.com" dan "shop.a.com" yang terdaftar sebagai domain sendiri), dan baris yang sudah
 * menyebut induknya tidak boleh ikut ke domain lain karena kebetulan akhirannya cocok. Yang belum
 * mengisinya jatuh ke pencocokan akhiran hostname.
 */
export function sitesOfDomain(rows, domain) {
  const target = hostOf(domain);
  if (!target) return [];
  return (rows || []).filter((row) => {
    const parent = hostOf(row.parentDomain);
    if (parent) return parent === target;
    const host = hostOf(row.name);
    return host === target || host.endsWith(`.${target}`);
  });
}

// `?cek=id1,id2` ↔ daftar id.
export function parseIdList(text) {
  return [
    ...new Set(
      String(text || "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  ];
}

export function chunk(list, size) {
  const out = [];
  for (let index = 0; index < list.length; index += size) out.push(list.slice(index, index + size));
  return out;
}

/**
 * Ringkasan hasil untuk kepala tabel dan toast. Yang belum terhubung ke plugin dan yang gagal dibaca
 * DISEBUT terpisah dari yang punya pemeriksaan bermasalah: yang pertama diperbaiki dengan Enroll, yang
 * kedua di situsnya, yang ketiga di pengaturan plugin — tiga tindakan berbeda.
 */
export function auditSummary(entries) {
  const list = entries || [];
  const done = list.filter((entry) => entry.result?.detail);
  return {
    total: list.length,
    checked: done.length,
    clean: done.filter((entry) => !entry.result.detail.problems).length,
    withProblems: done.filter((entry) => entry.result.detail.problems > 0).length,
    unreachable: list.filter((entry) => entry.result?.status === "failed").length,
    notEnrolled: list.filter((entry) => !entry.enrolled).length,
  };
}
