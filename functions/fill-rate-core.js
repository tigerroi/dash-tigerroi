import { shiftDateKey, zonedDateKey } from "./sync-core.js";

/**
 * Rasio penayangan Ad Exchange per jam — aturan murni penyimpanannya.
 *
 * Node ini TIDAK PERNAH dipangkas. Yang membuatnya tetap murah dibuka adalah kuncinya: tanggal di
 * tingkat pertama, jadi halaman meminta rentangnya saja (`orderByKey().startAt().endAt()`).
 *
 * KUNCI JAM BERAWALAN HURUF (`h05`, bukan `05`). SDK Firebase membaca kunci berbentuk angka — nol
 * di depan pun diterima — sebagai indeks, dan node jam yang hampir penuh kembali sebagai ARRAY
 * berlubang. Alasan yang sama dengan `c57` di antrean gating dan `n{networkCode}` di status.
 */
export const FILL_RATE_PATH = "dashboard/fillRate";
export const FILL_RATE_STATUS_PATH = "dashboard/fillRateStatus";
export const NET_PREFIX = "_net_";

// Titik jadi koma (bisa dibaca balik di browser: hostname tidak pernah memuat koma); karakter lain
// yang ditolak RTDB jadi garis bawah.
const encode = (value) =>
  String(value)
    .trim()
    .toLowerCase()
    .replace(/\./g, ",")
    .replace(/[#$/[\]]/g, "_");

const isHostname = (site) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(String(site || "").trim());

/**
 * Hostname -> kunci. Yang bukan hostname ("(Not applicable)": permintaan yang tidak bisa dikaitkan
 * ke situs mana pun) masuk ember network berkunci DOMAIN akun GAM-nya, supaya total domain sama
 * dengan total network di layar GAM dan browser bisa menaruhnya di domain yang benar tanpa membaca
 * `gamAccounts` (ADMIN_ONLY).
 */
export function siteKey(site, networkDomain = "", networkCode = "") {
  if (isHostname(site)) return encode(site);
  return `${NET_PREFIX}${encode(networkDomain || networkCode || "unknown")}`;
}

export const networkStatusKey = (code) => `n${code}`;

const slotOf = (row) => `${row.date}T${row.hour}`;

/**
 * Baris satu network -> daun RTDB. Jam TERAKHIR yang dilaporkan network itu bertanda `partial`:
 * permintaan tercatat lebih lambat daripada tayangan, jadi rasio jam itu selalu melonjak palsu
 * (stylefemale jam 11 68,9%, sheetz jam 9 94,8% — 24 Sep 2026). Run berikutnya menimpanya tanpa
 * tanda begitu jam sesudahnya muncul.
 */
export function fillRateLeaves(rows, network = {}) {
  let lastSlot = "";
  for (const row of rows || []) {
    if (slotOf(row) > lastSlot) lastSlot = slotOf(row);
  }
  const leaves = {};
  for (const row of rows || []) {
    const path = `${row.date}/${siteKey(row.site, network.domain, network.code)}/h${row.hour}`;
    const leaf = leaves[path] || { req: 0, imp: 0 };
    leaf.req += Math.round(Number(row.req) || 0);
    leaf.imp += Math.round(Number(row.imp) || 0);
    if (slotOf(row) === lastSlot) leaf.partial = true;
    leaves[path] = leaf;
  }
  return { leaves, lastSlot };
}

// Dua network yang melaporkan hostname yang sama (jarang) dijumlahkan, bukan saling menimpa.
export function addLeaves(target, leaves) {
  for (const [path, leaf] of Object.entries(leaves || {})) {
    const prev = target[path];
    if (!prev) {
      target[path] = { ...leaf };
      continue;
    }
    prev.req += leaf.req;
    prev.imp += leaf.imp;
    if (leaf.partial) prev.partial = true;
  }
  return target;
}

export function flattenFillRate(tree) {
  const out = {};
  for (const [date, sites] of Object.entries(tree || {})) {
    for (const [key, hours] of Object.entries(sites || {})) {
      for (const [hour, leaf] of Object.entries(hours || {})) {
        out[`${date}/${key}/${hour}`] = leaf;
      }
    }
  }
  return out;
}

const sameLeaf = (a, b) =>
  Boolean(a) &&
  Number(a.req) === b.req &&
  Number(a.imp) === b.imp &&
  Boolean(a.partial) === Boolean(b.partial);

/**
 * Hanya daun yang BERUBAH — termasuk yang cuma kehilangan tanda `partial`. Jam yang sudah final
 * tidak ditulis ulang, jadi tab yang terbuka menerima delta beberapa jam terakhir, bukan seluruh
 * hari tiap sepuluh menit. Daun ditulis UTUH (bukan per field), supaya `partial` yang lepas
 * benar-benar hilang dari RTDB. Yang TIDAK ada di `next` tidak pernah dihapus.
 */
export function changedLeaves(previous, next) {
  const out = {};
  for (const [path, leaf] of Object.entries(next || {})) {
    if (!sameLeaf(previous?.[path], leaf)) out[path] = leaf;
  }
  return out;
}

const gamDay = (key) => {
  const [year, month, day] = key.split("-").map(Number);
  return { year, month, day };
};

// Kemarin + hari ini, SATU laporan: jam-jam akhir kemarin baru final lewat tengah malam.
export function fillRateWindow(now = new Date()) {
  const to = zonedDateKey(now);
  const from = shiftDateKey(to, -1);
  return { from, to, range: { startDate: gamDay(from), endDate: gamDay(to) } };
}
