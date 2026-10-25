// Cek situs — menilai isi plugin satu subdomain tanpa menulis apa pun. Logika murninya.
//
// Lima pemeriksaan, masing-masing dari grup pengaturan yang sudah dibaca `sync-plugin.mjs`:
//
//   adCode    — Kode iklan 1…N terisi sesuai Jumlah slot iklan (ads-settings, + header untuk GPT)
//   cmp       — CMP On/Off (cmp)
//   network   — network code di tag GPT situs = network code akun GAM-nya di /gam-accounts
//   landing   — ada landing page yang aktif (daftar landing)
//   behaviour — deteksi pengunjung berulang On/Off (behaviour, + Simpan Log di ads-settings)
//
// Dipisah dari I/O-nya supaya bisa diuji tanpa satu pun WordPress — sepola gpt-inject-core.js.

import { adBoxKind } from "./adsense-inject-core.js";
import { GPT_BODY_FIELDS } from "./gpt-inject-core.js";
import { ADS_FIELDS } from "./plugin-core.js";

// Status tiap pemeriksaan: `ok`, `warn`, `fail`, `na`, `error`. `error` BUKAN `fail`: grupnya tidak
// terbaca (plugin versi lama tanpa endpoint itu, situs yang menolak sesaat), jadi tidak ada yang
// dinilai — sepola earning yang tidak diketahui yang tidak pernah dinilai nol. Dilebur ke `fail`,
// "CMP gagal" untuk situs yang cuma belum punya endpoint CMP mengirim orang memeriksa pengaturan
// yang benar.

function truthy(value) {
  if (value === true || value === 1) return true;
  return ["1", "true", "on", "yes"].includes(
    String(value ?? "")
      .trim()
      .toLowerCase(),
  );
}

function check(status, label, detail = "") {
  return { status, label, detail };
}

// --- Kode iklan -------------------------------------------------------------------------------------

const DEFINE_SLOT =
  /googletag\s*\.\s*defineSlot\s*\(\s*['"]\/(\d+)(?:\/[^'"]*)?['"][\s\S]*?,\s*['"]([^'"]+)['"]\s*\)/g;
const DISPLAY = /googletag\s*\.\s*display\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

/**
 * Tag GPT dari header + kotak kode iklan → network code dan div id yang didefinisikan/ditampilkan.
 *
 * `defineSlot` dicari di KEDUANYA: inject dashboard menaruhnya di header, tapi tag yang dulu ditempel
 * tangan kerap utuh di satu kotak kode iklan — dan yang dinilai adalah apa yang benar-benar dimuat
 * halaman, bukan di mana dashboard biasanya menaruhnya.
 */
export function gptTagsOf(headerCode, boxes) {
  const sources = [String(headerCode ?? ""), ...(boxes || []).map((box) => String(box ?? ""))];
  const networks = new Set();
  const defined = new Set();
  const displayed = [];
  for (const text of sources) {
    for (const match of text.matchAll(DEFINE_SLOT)) {
      networks.add(match[1]);
      defined.add(match[2]);
    }
  }
  (boxes || []).forEach((box) => {
    for (const match of String(box ?? "").matchAll(DISPLAY)) displayed.push(match[1]);
  });
  return { networks: [...networks], defined: [...defined], displayed };
}

/**
 * Kode iklan: yang ditampilkan situs adalah kotak 1…N dengan N = Jumlah slot iklan — kotak sesudah N
 * tidak pernah digambar walau berisi. Karena itu yang dinilai kotak DI DALAM N, bukan jumlah kotak
 * yang kebetulan terisi.
 */
export function auditAdCode(ads, headerFooter) {
  if (!ads) return { ...check("error", "Tidak terbaca"), type: "" };

  const boxes = GPT_BODY_FIELDS.map((field) => String(ads[field] ?? ""));
  const count = Math.max(0, Math.min(GPT_BODY_FIELDS.length, Number(ads.jumlah_iklan) || 0));
  const shown = boxes.slice(0, count);
  const kinds = shown.map(adBoxKind);
  const filledOutside = boxes.slice(count).filter((box) => box.trim()).length;
  const known = kinds.filter((kind) => kind !== "kosong");
  const types = [...new Set(known.map((kind) => (kind === "GPT" ? "AdX" : kind)))];
  const type = types.length > 1 ? "Campuran" : types[0] || "";

  if (count === 0) {
    return {
      ...check(
        "fail",
        "Tidak ada",
        filledOutside
          ? `Jumlah slot iklan 0 — ${filledOutside} kotak berisi kode tapi tidak ditampilkan.`
          : "Jumlah slot iklan 0 dan tidak ada kode iklan.",
      ),
      type: "",
    };
  }

  const empty = kinds.flatMap((kind, index) => (kind === "kosong" ? [index + 1] : []));
  if (empty.length === count) {
    return { ...check("fail", "Kosong", `${count} slot, semua kotaknya kosong.`), type: "" };
  }

  const summary = `${count} slot: ${kinds.join(", ")}`;
  if (empty.length) {
    return {
      ...check(
        "warn",
        `${count - empty.length}/${count} terisi`,
        `${summary} — kotak ${empty.join(", ")} kosong digambar sebagai slot kosong.`,
      ),
      type,
    };
  }

  // GPT yang menampilkan div yang tidak pernah didefinisikan tidak berbunyi sebagai kesalahan di mana
  // pun — slotnya cuma kosong, dan yang terbaca besok adalah pendapatan nol.
  if (kinds.includes("GPT")) {
    const tags = gptTagsOf(headerFooter?.header_code, boxes);
    const orphan = tags.displayed.filter((id) => !tags.defined.includes(id));
    if (headerFooter && orphan.length) {
      return {
        ...check(
          "fail",
          "Div tidak cocok",
          `${summary} — div ${orphan.join(", ")} ditampilkan tapi tidak didefinisikan di header.`,
        ),
        type,
      };
    }
  }

  return { ...check("ok", type || "Terisi", summary), type };
}

// --- Network ID -------------------------------------------------------------------------------------

/**
 * Network code di tag GPT situs vs akun GAM subdomain itu.
 *
 * Tidak berlaku (`na`) untuk situs yang kode iklannya bukan GPT: AdSense `<ins>` tidak membawa network
 * code sama sekali, dan "cocok" di sana adalah klaim tentang sesuatu yang tidak ada.
 *
 * `gam` adalah `{ networkCode }` atau `{ error }` dari `gamAccountForSite`. Akun yang tidak ditemukan
 * `warn`, bukan `fail`: yang kurang data dashboard (/gam-accounts), bukan situsnya.
 */
export function auditNetwork(ads, headerFooter, gam) {
  if (!ads) return check("error", "Tidak terbaca", "Pengaturan iklan tidak terbaca.");
  const boxes = GPT_BODY_FIELDS.map((field) => String(ads[field] ?? ""));
  const usesGpt =
    boxes.some((box) => adBoxKind(box) === "GPT") ||
    /googletag\s*\.\s*defineSlot\s*\(/.test(String(headerFooter?.header_code ?? ""));
  if (!usesGpt) return check("na", "Bukan AdX", "Kode iklan situs ini bukan tag GPT Ad Manager.");
  if (!headerFooter) {
    return check(
      "error",
      "Tidak terbaca",
      "Header situs tidak terbaca — tag GPT-nya tinggal di sana.",
    );
  }

  const { networks } = gptTagsOf(headerFooter.header_code, boxes);
  if (!networks.length) {
    return check(
      "fail",
      "Tanpa defineSlot",
      "Kode iklan memanggil GPT tapi tidak ada defineSlot yang menyebut network code.",
    );
  }

  const plugin = networks.join(", ");
  const expected = String(gam?.networkCode ?? "").trim();
  const accountName = String(gam?.accountName || "").trim() || "akun GAM";
  if (!expected) {
    return check(
      "warn",
      plugin,
      `Akun GAM subdomain ini tidak bisa ditentukan: ${gam?.error || "tidak ada di /gam-accounts."}`,
    );
  }
  const wrong = networks.filter((code) => code !== expected);
  if (wrong.length) {
    return check(
      "fail",
      "Tidak sama",
      `Plugin: ${plugin} · Ad Manager (${accountName}): ${expected}`,
    );
  }
  return check("ok", expected, `Sama dengan ${accountName} di /gam-accounts.`);
}

// --- CMP --------------------------------------------------------------------------------------------

/**
 * CMP On/Off, tanpa syarat Kode CMP. Kotak kode yang kosong BUKAN masalah: di armada ini CMP yang
 * menyala memakai consent bawaan plugin, dan aturan "On tapi kode kosong" pernah menandai seluruh 16
 * subdomain sheetz.us yang sehat (17 Sep 2026) — tanda yang selalu menyala berhenti dibaca.
 */
export function auditCmp(cmp) {
  if (!cmp) return check("error", "Tidak terbaca");
  if (!truthy(cmp.cmp_enabled)) {
    return check(
      "warn",
      "Off",
      "CMP mati — dialog consent tidak muncul di wilayah yang mewajibkannya.",
    );
  }
  return check("ok", "On");
}

// --- Landing page -----------------------------------------------------------------------------------

// `landings` adalah keluaran `landingRows` ({ id, slug, title, active }).
export function auditLanding(landings) {
  if (!Array.isArray(landings)) return { ...check("error", "Tidak terbaca"), slugs: [] };
  const active = landings.filter((row) => row.active);
  const slugs = active.map((row) => row.slug || row.title || `#${row.id}`);
  if (!landings.length) return { ...check("fail", "Tidak ada", "Belum ada landing page."), slugs };
  if (!active.length) {
    return {
      ...check("warn", "Nonaktif", `${landings.length} landing page, tidak satu pun aktif.`),
      slugs,
    };
  }
  return {
    ...check(
      "ok",
      `${active.length} aktif`,
      `${active.length} dari ${landings.length} aktif: ${slugs.join(", ")}`,
    ),
    slugs,
  };
}

// --- Behaviour --------------------------------------------------------------------------------------

const ACTION_LABELS = {
  hide_ads: "sembunyikan iklan",
  cover_ads: "tutup iklan",
  redirect: "redirect",
};

/**
 * Behaviour On/Off. Yang On tetap bisa `warn`, karena dua ketergantungannya tidak terlihat dari field
 * behaviour sendiri: tanpa Simpan Log kunjungan IP tidak pernah tercatat (seluruh blok diam), dan aksi
 * redirect tanpa URL tidak mengarahkan ke mana pun.
 */
export function auditBehaviour(behaviour, ads) {
  if (!behaviour) return check("error", "Tidak terbaca");
  const delay = truthy(behaviour.behaviour_delay_enabled)
    ? `delay ${behaviour.behaviour_delay_seconds || "?"} dtk`
    : "";
  if (!truthy(behaviour.behaviour_detection)) {
    return check(
      "warn",
      "Off",
      ["Deteksi pengunjung berulang mati", delay].filter(Boolean).join(" · "),
    );
  }

  const action = String(behaviour.behaviour_action || "");
  const parts = [
    `aksi: ${ACTION_LABELS[action] || action || "-"}`,
    `lolos ${behaviour.behaviour_lolos ?? "-"}`,
    `batas ${behaviour.behaviour_batas ?? "-"}`,
    delay,
  ].filter(Boolean);
  const detail = parts.join(" · ");

  // "Aktifkan" — dicocokkan di AWAL kata, karena "Nonaktifkan" juga memuat "aktif".
  if (ads && !/^\s*aktif/i.test(String(ads.simpan_log ?? ""))) {
    return check("warn", "On", `${detail} — Simpan Log tidak aktif, kunjungan IP tidak tercatat.`);
  }
  if (action === "redirect" && !String(behaviour.behaviour_redirect_url ?? "").trim()) {
    return check("warn", "On", `${detail} — URL Redirect kosong.`);
  }
  return check("ok", "On", detail);
}

// --- Mode tampilan ---------------------------------------------------------------------------------

/**
 * Mode tampilan iklan (Acak/Berurutan/Stacked). Tidak ada nilai yang "benar" — ketiganya sah — jadi
 * yang dinilai cuma apakah situs menyebut salah satunya. Enumnya dibaca dari skema yang SAMA dengan
 * tab Pengaturan Iklan, bukan disalin.
 */
export function auditDisplayMode(ads) {
  if (!ads) return check("error", "Tidak terbaca");
  const value = String(ads.mode_tampilan ?? "").trim();
  const options = ADS_FIELDS.find((field) => field.name === "mode_tampilan")?.options || [];
  if (!value) return check("warn", "Belum diatur");
  if (!options.includes(value))
    return check("warn", value, `Bukan salah satu dari ${options.join(", ")}.`);
  return check("ok", value);
}

// --- Satu situs -------------------------------------------------------------------------------------

/**
 * Isi grup yang terbaca (atau `null` untuk yang gagal) → kelima pemeriksaan + ringkasannya.
 *
 * `errors` menyebut sebab grup yang tidak terbaca, supaya sel "Tidak terbaca" punya keterangan.
 */
export function auditSite({ ads, headerFooter, cmp, behaviour, landings, gam, errors = {} }) {
  const adCode = auditAdCode(ads, headerFooter);
  const withError = (result, ...groups) => {
    if (result.status !== "error") return result;
    const reason = groups.map((group) => errors[group]).find(Boolean);
    return reason ? { ...result, detail: reason } : result;
  };

  const checks = {
    adCode: withError(adCode, "ads-settings"),
    cmp: withError(auditCmp(cmp), "cmp"),
    displayMode: withError(auditDisplayMode(ads), "ads-settings"),
    network: withError(auditNetwork(ads, headerFooter, gam), "ads-settings", "header-footer"),
    landing: withError(auditLanding(landings), "landing"),
    behaviour: withError(auditBehaviour(behaviour, ads), "behaviour"),
  };

  // Tidak ada vonis tunggal per situs: lima pemeriksaan itu diperbaiki di lima tempat berbeda, dan
  // satu label "perlu dicek" di sebelahnya cuma mengulang warna sel-sel itu tanpa menyebut yang mana.
  const problems = Object.values(checks).filter((item) =>
    ["fail", "warn", "error"].includes(item.status),
  ).length;

  return { checks, problems, adType: adCode.type || "" };
}
