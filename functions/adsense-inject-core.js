// Inject kode iklan AdSense ke plugin RabbitROI — logika murninya.
//
// BERBEDA dari GPT (gpt-inject-core.js), dan perbedaannya bukan pilihan: tag Ad Manager bisa
// DISUSUN dari network code dan unit yang dibaca API, sementara slot AdSense (`data-ad-slot`) hanya
// lahir dari tombol "Buat unit iklan" di halaman AdSense. `accounts.adclients.adunits.create` ada di
// API v2, tapi "can be called only by a restricted set of projects, which are usually owned by
// AdSense for Platforms publishers" — dan kredensial kita memang cuma ber-scope `adsense.readonly`.
// Karena itu yang diisi superadmin adalah KODE UTUH yang disalin dari halaman AdSense, satu per kotak.
//
// Yang ditulis cuma `ads-settings.kode_iklan_N` + `jumlah_iklan`. Header situs TIDAK disentuh: kode
// AdSense membawa loader-nya sendiri, dan `adsbygoogle.js` yang dimuat lima kali di satu halaman
// cuma diunduh sekali oleh browser.
//
// Dipisah dari sync-plugin.mjs supaya bisa diuji tanpa satu pun WordPress maupun panggilan Google.

import { GPT_BODY_FIELDS, GPT_MAX_SLOTS } from "./gpt-inject-core.js";
import { PluginError } from "./plugin-core.js";

// Plugin punya lima kotak kode iklan — batas yang sama dengan GPT, dari tempat yang sama.
export const ADSENSE_MAX_SLOTS = GPT_MAX_SLOTS;

// Kode unit AdSense yang di-generate halaman AdSense ~450 karakter; 6000 memberi ruang untuk komentar
// dan atribut tambahan tanpa membuka kotak tanpa batas.
export const ADSENSE_CODE_MAX = 6000;

const LOADER_SRC =
  /^https:\/\/pagead2\.googlesyndication\.com\/pagead\/js\/adsbygoogle\.js(\?[^"'\s<>]*)?$/;
const PUSH_SCRIPT =
  /^\(\s*adsbygoogle\s*=\s*window\.adsbygoogle\s*\|\|\s*\[\]\s*\)\s*\.push\(\s*\{\s*\}\s*\)\s*;?$/;

function attr(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i"));
  return match ? (match[2] ?? match[3] ?? "").trim() : "";
}

/**
 * Satu kode yang ditempel → { client, slot, code }, atau lempar.
 *
 * Yang DITERIMA hanya bentuk yang di-generate halaman AdSense untuk satu unit: loader
 * `adsbygoogle.js`, satu `<ins class="adsbygoogle">`, dan `(adsbygoogle = window.adsbygoogle || []).push({})`.
 * Daftar putih, bukan daftar hitam, dan dua alasannya sama-sama berbunyi diam kalau dilanggar:
 *
 *   - Kotak yang tertempel kode lain (tag GPT dari tab sebelah, Auto ads tanpa `<ins>`, potongan
 *     yang terpotong di tengah) tetap tersimpan rapi di WordPress dan tidak menampilkan apa pun.
 *   - Kode ini ditulis mentah ke halaman yang menerima trafik iklan berbayar. `<script>` apa pun
 *     yang lolos di sini berjalan di tiap kunjungan.
 *
 * Satu kotak = SATU slot: dua `<ins>` di satu kotak berarti "Jumlah slot iklan" tidak lagi sama
 * dengan slot yang benar-benar tampil. `client` di loader (kalau ada) wajib sama dengan
 * `data-ad-client` — kode yang dirakit dari dua akun berbeda adalah salah tempel, bukan variasi.
 */
export function parseAdsenseCode(input, index = 0) {
  const label = `Kode iklan ${index + 1}`;
  const code = String(input ?? "")
    .replace(/\r\n?/g, "\n")
    .trim();
  if (!code) throw new PluginError(`${label} kosong — tempel kode unit dari halaman AdSense.`);
  if (code.length > ADSENSE_CODE_MAX) {
    throw new PluginError(`${label} terlalu panjang (maks ${ADSENSE_CODE_MAX} karakter).`);
  }

  const ins = [...code.matchAll(/<ins\b[^>]*>/gi)].map((match) => match[0]);
  const adsIns = ins.filter((tag) => /\badsbygoogle\b/.test(attr(tag, "class")));
  if (!adsIns.length) {
    throw new PluginError(
      `${label} bukan kode unit AdSense — tidak ada <ins class="adsbygoogle">. Salin dari AdSense → Iklan → Menurut unit iklan → Dapatkan kode.`,
    );
  }
  if (ins.length > 1) {
    throw new PluginError(
      `${label} memuat ${ins.length} <ins> — satu kotak hanya untuk satu unit iklan.`,
    );
  }

  const tag = adsIns[0];
  const client = attr(tag, "data-ad-client");
  const slot = attr(tag, "data-ad-slot");
  if (!/^ca-pub-\d{10,20}$/.test(client)) {
    throw new PluginError(`${label}: data-ad-client "${client}" tidak berbentuk ca-pub-ANGKA.`);
  }
  if (!/^\d{5,20}$/.test(slot)) {
    throw new PluginError(
      slot
        ? `${label}: data-ad-slot "${slot}" bukan ID slot yang sah.`
        : `${label} tidak punya data-ad-slot — itu kode Auto ads, bukan kode unit iklan.`,
    );
  }

  for (const match of code.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const src = attr(`<x ${match[1]}>`, "src");
    if (src) {
      if (!LOADER_SRC.test(src)) {
        throw new PluginError(`${label} memuat script dari luar AdSense (${src}) — ditolak.`);
      }
      const loaderClient = src.match(/[?&]client=([^&]+)/)?.[1] || "";
      if (loaderClient && decodeURIComponent(loaderClient) !== client) {
        throw new PluginError(
          `${label}: loader menyebut ${decodeURIComponent(loaderClient)} sementara unitnya ${client} — salin ulang kodenya utuh.`,
        );
      }
      continue;
    }
    if (!PUSH_SCRIPT.test(match[2].trim())) {
      throw new PluginError(
        `${label} memuat script selain (adsbygoogle = window.adsbygoogle || []).push({}) — ditolak.`,
      );
    }
  }
  // `<script` yang tidak tertutup lolos dari pola di atas — dan justru yang itu merusak halaman.
  const opened = (code.match(/<script\b/gi) || []).length;
  const closed = (code.match(/<\/script\s*>/gi) || []).length;
  if (opened !== closed) {
    throw new PluginError(`${label} terpotong — ada <script> yang tidak ditutup.`);
  }
  if (!/\.push\(\s*\{\s*\}\s*\)/.test(code)) {
    throw new PluginError(
      `${label} tidak memuat (adsbygoogle = window.adsbygoogle || []).push({}) — tanpa itu unitnya tidak pernah meminta iklan.`,
    );
  }

  return { client, slot, code };
}

/**
 * Daftar kode dari form → daftar yang sah, atau lempar.
 *
 * Kotak yang dikirim adalah Kode iklan 1…N BERURUTAN: kotak kosong di tengah ditolak, karena
 * "Jumlah slot iklan = N" akan menggambar slot yang isinya kosong. Kotak kosong di EKOR dibuang —
 * itu cuma form yang belum dipakai semua kotaknya.
 *
 * Semua kotak wajib dari SATU akun AdSense (`data-ad-client` yang sama): satu subdomain yang
 * menayangkan dua publisher berbeda hampir selalu salah tempel dari akun sebelah.
 */
export function normalizeAdsenseCodes(input) {
  const raw = (Array.isArray(input) ? input : []).map((item) => String(item ?? ""));
  while (raw.length && !raw[raw.length - 1].trim()) raw.pop();
  if (!raw.length) throw new PluginError("Tempel minimal satu kode unit AdSense.");
  if (raw.length > ADSENSE_MAX_SLOTS) {
    throw new PluginError(
      `Maksimal ${ADSENSE_MAX_SLOTS} kode — plugin punya lima kotak kode iklan.`,
    );
  }
  const slots = raw.map((code, index) => parseAdsenseCode(code, index));

  const clients = [...new Set(slots.map((item) => item.client))];
  if (clients.length > 1) {
    throw new PluginError(
      `Kode yang ditempel berasal dari ${clients.length} akun AdSense (${clients.join(", ")}) — satu subdomain, satu akun.`,
    );
  }
  const seen = new Set();
  for (const [index, item] of slots.entries()) {
    if (seen.has(item.slot)) {
      throw new PluginError(
        `Kode iklan ${index + 1} memakai slot ${item.slot} yang sudah dipakai kotak sebelumnya.`,
      );
    }
    seen.add(item.slot);
  }
  return slots;
}

/**
 * Hasil pengecekan slot terhadap daftar ad unit akun itu (AdSense API `adunits.list`).
 *
 * `units` null berarti akunnya TIDAK BISA DIBACA (tidak terdaftar di /adsense-accounts, atau
 * kredensialnya ditolak): slotnya tidak bisa dipastikan, dan itu dilaporkan sebagai `verified:
 * false` berikut sebabnya — bukan ditolak, karena yang kurang data dashboard, bukan kodenya.
 *
 * Kalau akunnya TERBACA, slot yang tidak ada di sana DITOLAK: salah satu digit yang meleset tetap
 * tersimpan di WordPress dan menghasilkan kotak iklan kosong tanpa satu error pun.
 */
export function verifyAdsenseSlots(slots, units, reason = "") {
  if (!Array.isArray(units)) {
    return slots.map((item) => ({
      client: item.client,
      slot: item.slot,
      verified: false,
      displayName: "",
      size: "",
      state: "",
      note: reason || "Akun AdSense ini tidak bisa dibaca — slot tidak diperiksa.",
    }));
  }
  const byId = new Map(
    units.map((unit) => [
      String(unit?.name || "")
        .split("/")
        .pop(),
      unit,
    ]),
  );
  return slots.map((item, index) => {
    const unit = byId.get(item.slot);
    if (!unit) {
      throw new PluginError(
        `Kode iklan ${index + 1}: slot ${item.slot} tidak ada di akun AdSense ${item.client.replace(/^ca-/, "")} — periksa lagi kodenya.`,
      );
    }
    const state = String(unit.state || "");
    return {
      client: item.client,
      slot: item.slot,
      verified: true,
      displayName: String(unit.displayName || ""),
      size: String(unit.contentAdsSettings?.size || ""),
      state,
      // ARCHIVED masih menayangkan iklan menurut dokumen API, jadi tidak ditolak — cuma disebut.
      note: state && state !== "ACTIVE" ? `Unit berstatus ${state} di AdSense.` : "",
    };
  });
}

// Ukuran AdSense "1x3" adalah penanda unit responsif, bukan sebuah ukuran.
export function adsenseSizeLabel(size) {
  const text = String(size || "");
  if (!text) return "";
  return text === "1x3" ? "responsif" : text;
}

// Jenis isi sebuah kotak kode iklan — untuk laporan "Periksa dulu", bukan untuk memutuskan apa pun.
export function adBoxKind(value) {
  const text = String(value ?? "");
  if (!text.trim()) return "kosong";
  if (/\badsbygoogle\b/.test(text)) return "AdSense";
  if (/googletag\s*\.\s*display\s*\(/.test(text)) return "GPT";
  return "lain";
}

/**
 * Isi `ads-settings` situs + kode baru → field yang dikirim.
 *
 * Kotak 1…N ditimpa kode yang ditempel, `jumlah_iklan` SELALU = N (alasan yang sama dengan GPT).
 * Kotak SESUDAH N dikosongkan HANYA kalau isinya kode iklan yang kita kenali (AdSense atau GPT) —
 * dengan jumlah slot yang turun, kode itu tidak lagi tampil dan cuma menunggu dikira masih aktif.
 * Isi lain (banner, HTML tangan) dibiarkan: tidak ada yang meminta menghapusnya.
 */
export function planAdsenseBodies(adsSettings, slots) {
  const current = adsSettings && typeof adsSettings === "object" ? adsSettings : {};
  const values = {};
  const replaced = [];
  const cleared = [];

  GPT_BODY_FIELDS.forEach((field, index) => {
    if (index < slots.length) {
      values[field] = slots[index].code;
      replaced.push(`${field}: ${adBoxKind(current[field])}`);
      return;
    }
    const kind = adBoxKind(current[field]);
    if (kind === "AdSense" || kind === "GPT") {
      values[field] = "";
      cleared.push(field);
    }
  });
  values.jumlah_iklan = slots.length;

  return { values, replaced, cleared, previousSlotCount: current.jumlah_iklan ?? "" };
}
