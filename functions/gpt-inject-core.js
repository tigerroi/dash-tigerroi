// Inject kode iklan Google Ad Manager (GPT) ke plugin RabbitROI — logika murninya.
//
// Satu tag yang di-generate Ad Manager terdiri dari dua bagian yang tinggal di DUA grup pengaturan
// plugin yang berbeda:
//
//   Document Header  -> `header-footer.header_code`   (gpt.js + satu `defineSlot` per slot)
//   Document Body    -> `ads-settings.kode_iklan_N`    (satu `<div>` + `display` per slot)
//
// Keduanya harus menyebut div id yang SAMA. Body yang memanggil `display('…-2')` untuk slot yang
// tidak pernah didefinisikan header tidak berbunyi sebagai kesalahan di mana pun — slotnya cuma
// kosong, dan yang terbaca besok adalah pendapatan nol. Karena itu keduanya DISUSUN dari satu spec
// di satu tempat — dan unit iklannya dibaca dari Ad Manager per subdomain, bukan diketik orang.
//
// Dipisah dari sync-plugin.mjs (yang memanggil situs) supaya bisa diuji tanpa satu pun WordPress,
// dan dipakai server kontrol untuk pratinjau DAN untuk menulis — yang dilihat orang di layar adalah
// persis yang berangkat ke situs.

import { PluginError } from "./plugin-core.js";

// Plugin punya lima kotak kode iklan (`kode_iklan_1`…`kode_iklan_5`), jadi satu inject paling banyak
// lima slot. Lebih dari itu, slot keenam didefinisikan header tanpa satu pun tempat untuk tampil.
export const GPT_MAX_SLOTS = 5;
export const GPT_BODY_FIELDS = Array.from(
  { length: GPT_MAX_SLOTS },
  (_, i) => `kode_iklan_${i + 1}`,
);

// Ad Manager menawarkan 35 ukuran untuk satu unit; 60 memberi ruang tanpa membuka kotak tanpa batas.
export const GPT_MAX_SIZES = 60;
const GPT_MAX_SIDE = 4000;

export const GPT_LOADER = `<script async src="https://securepubads.g.doubleclick.net/tag/js/gpt.js" crossorigin="anonymous"></script>`;

/**
 * Penanda komentar yang DULU ditulis inject di sekeliling blok GPT (14 Sep 2026, dibuang hari yang
 * sama atas permintaan pemilik repo). Blok yang ditulis sekarang TANPA penanda — bentuknya persis tag
 * Ad Manager — dan inject berikutnya menemukannya lewat pola yang sama dengan tag tempelan tangan.
 * Konstanta ini tinggal hanya untuk MEMBUANG penanda yang terlanjur tersimpan di header situs.
 */
const LEGACY_MARKERS = [
  "<!-- RabbitROI GPT: mulai (dikelola dashboard, jangan disunting) -->",
  "<!-- RabbitROI GPT: selesai -->",
];

// --- Unit iklan & akun GAM tiap situs -----------------------------------------------------------

/**
 * Argumen ukuran GPT → daftar "LEBARxTINGGI"/"fluid".
 *
 * Tiga bentuk yang sah di GPT, dan Ad Manager memakai ketiganya tergantung jumlah ukurannya:
 * `[[300, 250], [728, 90]]`, `[300, 250]` (satu ukuran), dan `'fluid'`.
 */
function sizesFromLiteral(literal) {
  const text = String(literal || "");
  const out = [];
  const token = /\[\s*(\d+)\s*,\s*(\d+)\s*\]|['"]fluid['"]/g;
  let match = token.exec(text);
  while (match) {
    out.push(match[1] ? `${Number(match[1])}x${Number(match[2])}` : "fluid");
    match = token.exec(text);
  }
  return out;
}

function hostOf(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
}

// Kegagalan di bawah SENGAJA tanpa `code`: `pluginFailureStatus` membaca kode sebagai "situs/penyedia
// yang menjawab" (502), sementara akun GAM yang belum terdaftar dan unit yang tidak ada di network
// adalah keadaan data dashboard — diperbaiki di /gam-accounts atau di pilihan form (422).

/**
 * Subdomain → akun GAM yang memonetisasinya, atau lempar.
 *
 * Dicocokkan lewat DOMAIN: `gamAccounts.name` adalah domain induk ("designingaround.com"), dan
 * subdomain menyebut induknya di `parentDomain`. Yang belum mengisi `parentDomain` jatuh ke
 * pencocokan akhiran hostname — tapi hanya kalau tepat SATU akun cocok. Dua akun untuk satu domain
 * berarti unit iklan milik salah satunya tertulis di situs milik yang lain, dan pendapatannya masuk
 * ke network yang salah tanpa satu pun tanda di dashboard.
 */
/**
 * Akun GAM yang cocok untuk sebuah situs — lewat domain induk dulu, lalu akhiran hostname. Kosong =
 * domainnya tidak punya akun GAM; itu juga yang dipakai Setup Sub untuk memilih AdSense alih-alih AdX.
 */
export function gamAccountsForSite(site, gamAccounts) {
  const rows = Object.entries(gamAccounts || {})
    .map(([id, row]) => ({ id, ...row }))
    .filter((row) => row && !row.deletedAt && row.networkCode && hostOf(row.name));
  const parent = hostOf(site?.parentDomain);
  const host = hostOf(site?.name);

  const byParent = parent ? rows.filter((row) => hostOf(row.name) === parent) : [];
  return byParent.length
    ? byParent
    : rows.filter((row) => host === hostOf(row.name) || host.endsWith(`.${hostOf(row.name)}`));
}

export function gamAccountForSite(site, gamAccounts) {
  const matches = gamAccountsForSite(site, gamAccounts);
  const parent = hostOf(site?.parentDomain);
  const host = hostOf(site?.name);
  if (matches.length === 1) return matches[0];
  if (!matches.length) {
    throw new PluginError(
      `Tidak ada akun GAM untuk ${parent || host} di /gam-accounts — unit iklannya tidak bisa dibaca.`,
    );
  }
  throw new PluginError(
    `${matches.length} akun GAM bernama ${hostOf(matches[0].name)} — tidak jelas unit iklan milik yang mana.`,
  );
}

/**
 * Daftar unit iklan network (Ad Manager API v1) → unit yang bisa dipasang sebagai slot display.
 *
 * Yang DIBUANG, masing-masing dengan sebab: unit akar (kodenya = network code), unit wadah properti
 * (`hasChildren`, mis. `ca-pub-8660742543707970` — ia menaungi unit lain, bukan slot), unit in-app
 * (`ca-mb-app-pub-…-tag`, untuk aplikasi seluler, bukan halaman web), Offerwall, dan yang tidak
 * ACTIVE. Yang tersisa di ketujuh network armada: satu unit Ad Exchange Display per network, plus
 * unit buatan sendiri di sebagian kecilnya (masseffectstore.com: header, incontent_ads, bottom_anchor,
 * interstitial — dibaca 14 Sep 2026).
 *
 * PATH-NYA TANPA LEVEL PROPERTI. API mencatat `ca-pub-9198385730397674-tag` di bawah
 * `ca-pub-8660742543707970`, tapi tag yang di-generate Ad Manager untuk unit itu berbunyi
 * `/23352267851/ca-pub-9198385730397674-tag` — jadi wadah properti (`ca-pub-ANGKA`) dilewati dari
 * path, dan level lain di antaranya tetap disebut.
 *
 * Ukurannya ikut dibaca (`adUnitSizes`, BROWSER saja): itu daftar yang benar-benar diterima unit itu,
 * dan jadi pilihan template "Ukuran unit ini" di form.
 */
export function gptUnitChoices(networkCode, units) {
  const code = String(networkCode ?? "").trim();
  return (units || [])
    .filter((unit) => {
      const unitCode = String(unit?.adUnitCode || "");
      return (
        unit?.status === "ACTIVE" &&
        !unit.hasChildren &&
        unitCode &&
        unitCode !== code &&
        !/^ca-mb-app-pub-/.test(unitCode) &&
        !/^Offerwall-Ad-Unit-/i.test(unitCode)
      );
    })
    .map((unit) => {
      const parents = (unit.parentPath || [])
        .map((parent) => String(parent?.adUnitCode || ""))
        .filter(
          (parentCode) => parentCode && parentCode !== code && !/^ca-pub-\d+$/.test(parentCode),
        );
      const sizes = (unit.adUnitSizes || [])
        .filter((item) => !item.environmentType || item.environmentType === "BROWSER")
        .map((item) =>
          item.size?.sizeType === "FLUID" ? "fluid" : `${item.size?.width}x${item.size?.height}`,
        )
        .filter((size) => size === "fluid" || /^\d+x\d+$/.test(size));
      return {
        adUnitCode: unit.adUnitCode,
        displayName: String(unit.displayName || unit.adUnitCode),
        path: `/${[code, ...parents, unit.adUnitCode].join("/")}`,
        sizes: [...new Set(sizes)].join(","),
        adExchange: /^ca-pub-\d+-tag$/.test(unit.adUnitCode),
      };
    })
    .sort(
      (a, b) =>
        Number(b.adExchange) - Number(a.adExchange) || a.adUnitCode.localeCompare(b.adUnitCode),
    );
}

/**
 * Unit yang dipilih admin → unit itu, atau lempar. Kosong berarti unit Ad Exchange Display network.
 *
 * Kodenya DICARI di daftar yang dibaca dari Ad Manager, tidak dipercaya dari request: kode unit
 * disambung ke dalam string JavaScript di header situs, dan unit yang tidak ada di network itu cuma
 * menghasilkan permintaan iklan yang tidak pernah diisi.
 */
export function pickGptUnit(networkCode, choices, adUnitCode = "") {
  const wanted = String(adUnitCode ?? "").trim();
  if (wanted) {
    const found = (choices || []).find((unit) => unit.adUnitCode === wanted);
    if (found) return found;
    throw new PluginError(
      `Unit iklan "${wanted}" tidak ada (atau tidak aktif) di network ${networkCode}.`,
    );
  }
  const adx = (choices || []).filter((unit) => unit.adExchange);
  if (adx.length === 1) return adx[0];
  throw new PluginError(
    adx.length
      ? `Network ${networkCode} punya ${adx.length} unit Ad Exchange Display — pilih salah satunya.`
      : `Network ${networkCode} tidak punya unit Ad Exchange Display yang aktif — pilih unit iklannya.`,
  );
}

/**
 * Stempel div id → stempel yang sah, atau lempar. Kosong berarti "buat baru sekarang" (`now`).
 *
 * Bentuknya meniru "Generate tags" Ad Manager: `div-gpt-ad-{epoch milidetik}-N` (1789368958539),
 * atas permintaan pemilik repo — menggantikan awalan tetap per network (`div-gpt-ad-{networkCode}`).
 * **Tiap SUBDOMAIN punya stempelnya sendiri** (itu tujuannya: satu tag Generate per situs), dibuat
 * server saat pratinjau (`gptStampClock`) dan dikirim balik saat inject (`options.divStamps`), jadi
 * yang ditulis sama persis dengan yang tergambar.
 *
 * Harga yang diketahui: dulu inject ulang menulis div id yang SAMA dengan body lama, jadi situs yang
 * gagal di antara tulisan header dan kode iklan tetap tayang. Sekarang situs setengah jadi seperti itu
 * memanggil div id yang tidak lagi didefinisikan header — slotnya kosong sampai inject diulang, dan
 * pesan barisnya menyebutnya ("situs ini setengah jadi").
 *
 * Digit saja: nilainya disambung ke dalam string JavaScript di header situs.
 */
export function normalizeGptDivStamp(stamp, now = Date.now()) {
  const text = String(stamp ?? "").trim();
  if (!text) return String(Math.trunc(now));
  if (!/^\d{10,16}$/.test(text)) {
    throw new PluginError(`Stempel div "${text}" tidak sah — tekan Generate kode lagi.`);
  }
  return text;
}

/**
 * `{ subdomainId: stempel }` dari request → peta yang sah, atau lempar. Diperiksa SEKALI di depan,
 * bukan tiga puluh kali sebagai tiga puluh baris gagal yang menyebut kalimat yang sama.
 */
export function normalizeGptDivStamps(input) {
  const out = {};
  for (const [id, stamp] of Object.entries(input && typeof input === "object" ? input : {})) {
    if (String(stamp ?? "").trim()) out[id] = normalizeGptDivStamp(stamp);
  }
  return out;
}

/**
 * Pembuat stempel untuk satu permintaan: epoch milidetik yang SELALU naik. Situs yang disusun di
 * milidetik yang sama tetap mendapat stempel berbeda — tanpa itu tiga subdomain yang dikerjakan
 * bersamaan akan berbagi satu angka, persis yang ingin dihindari.
 */
export function gptStampClock(now = () => Date.now()) {
  let last = 0;
  return () => {
    last = Math.max(Math.trunc(now()), last + 1);
    return String(last);
  };
}

export function gptDivPrefix(stamp) {
  return `div-gpt-ad-${normalizeGptDivStamp(stamp)}`;
}

// --- Spec ---------------------------------------------------------------------------------------

/**
 * Teks ukuran → daftar ukuran yang sah, atau lempar.
 *
 * Menerima "300x250, 728x90" (bentuk template) DAN literal GPT yang tersalin dari header
 * ("[[300, 250], [728, 90]]") — orang yang sedang menguji ukuran akan menempel yang mana saja yang
 * ada di papan klipnya. Yang kembar dibuang: GPT menerimanya, tapi daftar 35 ukuran yang memuat dua
 * 300x250 tidak bisa lagi dibandingkan dengan template lain dengan mata.
 */
export function parseGptSizes(input) {
  const text = Array.isArray(input) ? input.join(",") : String(input ?? "");
  const literal = text.includes("[") ? sizesFromLiteral(text) : null;
  const tokens = (
    literal ||
    text
      .split(/[\s,;]+/)
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
  ).map((item) => item.replace(/\s+/g, "").toLowerCase());

  if (!tokens.length) throw new PluginError("Daftar ukuran slot kosong.");

  const sizes = [];
  for (const token of tokens) {
    if (token === "fluid") {
      if (!sizes.includes("fluid")) sizes.push("fluid");
      continue;
    }
    const match = token.match(/^(\d+)[x×](\d+)$/);
    if (!match) {
      throw new PluginError(
        `"${token}" bukan ukuran slot yang sah — tulis LEBARxTINGGI (mis. 300x250) atau fluid.`,
      );
    }
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (width < 1 || height < 1 || width > GPT_MAX_SIDE || height > GPT_MAX_SIDE) {
      throw new PluginError(`"${token}" di luar batas 1-${GPT_MAX_SIDE} px per sisi.`);
    }
    const size = `${width}x${height}`;
    if (!sizes.includes(size)) sizes.push(size);
  }

  if (sizes.length > GPT_MAX_SIZES) {
    throw new PluginError(`Maksimal ${GPT_MAX_SIZES} ukuran — yang ditulis ${sizes.length}.`);
  }
  return sizes;
}

/**
 * Pilihan dari form (ukuran, jumlah slot) → pilihan yang sah, atau lempar.
 *
 * Ini SATU-SATUNYA yang dikirim browser. Unit iklan dan awalan div tidak pernah datang dari request —
 * keduanya diturunkan per situs dari akun GAM-nya (`gamAccountForSite`, `adExchangeUnitPath`), jadi
 * tidak ada kotak yang bisa diisi unit milik network lain.
 */
export function normalizeGptOptions(input) {
  const slots = Number(input?.slots);
  if (!Number.isInteger(slots) || slots < 1 || slots > GPT_MAX_SLOTS) {
    throw new PluginError(
      `Jumlah slot harus 1 sampai ${GPT_MAX_SLOTS} — plugin punya lima kotak kode iklan.`,
    );
  }
  return {
    sizes: parseGptSizes(input?.sizes),
    slots,
  };
}

/**
 * Pilihan + unit iklan situs → spec lengkap yang boleh disusun jadi kode, atau lempar.
 *
 * Unit iklan dan div id disambung ke dalam string JavaScript di halaman yang menerima trafik
 * berbayar, jadi karakternya tetap DAFTAR PUTIH walau keduanya datang dari Ad Manager: satu tanda
 * kutip yang lolos menutup string-nya lebih awal dan seluruh `<script>` header jadi galat sintaks —
 * yang ikut mati bukan cuma slot kita melainkan setiap kode lain di blok itu.
 */
export function normalizeGptSpec(input) {
  const adUnitPath = String(input?.adUnitPath ?? "").trim();
  if (!/^\/\d{1,20}(\/[A-Za-z0-9_.\-*!:()]{1,100}){1,10}$/.test(adUnitPath)) {
    throw new PluginError(`Unit iklan "${adUnitPath}" tidak berbentuk /KODE_JARINGAN/kode-unit.`);
  }
  const divPrefix = String(input?.divPrefix ?? "").trim();
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,80}$/.test(divPrefix)) {
    throw new PluginError(`Awalan div "${divPrefix}" tidak sah.`);
  }
  return { adUnitPath, divPrefix, ...normalizeGptOptions(input) };
}

// --- Menyusun kode ------------------------------------------------------------------------------

function sizeLiteral(sizes) {
  return `[${sizes
    .map((size) => {
      if (size === "fluid") return "'fluid'";
      const [width, height] = size.split("x");
      return `[${width}, ${height}]`;
    })
    .join(", ")}]`;
}

// Ad Manager menulis min-width/min-height sebagai sisi TERKECIL di antara ukurannya, dan itu yang
// ditiru — wadah yang lebih besar dari iklan terkecilnya menyisakan ruang kosong di sekitar iklan itu.
function minBox(sizes) {
  const numeric = sizes
    .filter((size) => size !== "fluid")
    .map((size) => size.split("x").map(Number));
  if (!numeric.length) return null;
  return {
    width: Math.min(...numeric.map(([width]) => width)),
    height: Math.min(...numeric.map(([, height]) => height)),
  };
}

export function gptDivId(spec, index) {
  return `${spec.divPrefix}-${index}`;
}

/**
 * Spec → kode yang ditulis, berbentuk PERSIS seperti yang di-generate Ad Manager.
 *
 * Bentuk yang sama bukan kerapian: orang yang membuka header situs lalu mengadunya dengan layar
 * "Generate tags" di Ad Manager harus bisa melihat bahwa keduanya tag yang sama. Yang ditambahkan
 * cuma penanda blok di header.
 */
export function buildGptTags(spec) {
  const sizes = sizeLiteral(spec.sizes);
  const defines = Array.from(
    { length: spec.slots },
    (_, index) =>
      `    googletag.defineSlot('${spec.adUnitPath}', ${sizes}, '${gptDivId(spec, index)}').addService(googletag.pubads());`,
  );

  const header = [
    GPT_LOADER,
    "<script>",
    "  window.googletag = window.googletag || {cmd: []};",
    "  googletag.cmd.push(function() {",
    ...defines,
    "    googletag.enableServices();",
    "  });",
    "</script>",
  ].join("\n");

  const box = minBox(spec.sizes);
  const style = box ? ` style='min-width: ${box.width}px; min-height: ${box.height}px;'` : "";
  const bodies = Array.from({ length: spec.slots }, (_, index) => {
    const id = gptDivId(spec, index);
    return [
      `<!-- ${spec.adUnitPath} -->`,
      `<div id='${id}'${style}>`,
      "  <script>",
      `    googletag.cmd.push(function() { googletag.display('${id}'); });`,
      "  </script>",
      "</div>",
    ].join("\n");
  });

  return { header, bodies };
}

// --- Menggabungkan dengan isi situs ---------------------------------------------------------------

const LOADER_TAG =
  /<script\b[^>]*\bsrc\s*=\s*["'][^"']*securepubads\.g\.doubleclick\.net\/tag\/js\/gpt\.js[^"']*["'][^>]*>\s*<\/script>/gi;
const INLINE_SCRIPT = /<script\b(?![^>]*\bsrc\s*=)[^>]*>[\s\S]*?<\/script>/gi;

function spansOf(pattern, text, keep = () => true) {
  return [...text.matchAll(pattern)]
    .filter((match) => keep(match[0]))
    .map((match) => ({ start: match.index, end: match.index + match[0].length }));
}

function snippet(text) {
  const flat = String(text).replace(/\s+/g, " ").trim();
  return flat.length > 160 ? `${flat.slice(0, 159)}…` : flat;
}

/**
 * `header_code` situs + blok baru → isi baru, berikut CARA penggabungannya.
 *
 *   replaced  — tag GPT ditemukan (loader gpt.js dan/atau `<script>` yang memuat `defineSlot`) —
 *               blok inject sebelumnya maupun tag yang dulu ditempel tangan — dibuang, dan blok baru
 *               berdiri di posisi yang pertama. `removed` menyebut apa saja yang dibuang: script yang
 *               memuat `defineSlot` diganti UTUH, jadi `setTargeting` yang pernah ditulis orang di
 *               dalamnya ikut hilang.
 *   appended  — tidak ada GPT sama sekali; blok ditaruh di ujung, isi lain tidak disentuh.
 *
 * Penanda komentar lama (`LEGACY_MARKERS`) dibuang lebih dulu berikut barisnya, supaya header yang
 * pernah di-inject versi bertanda tidak menyimpan komentar yatim di sekeliling blok barunya.
 */
export function mergeGptHeader(existing, block) {
  let text = String(existing ?? "");
  for (const marker of LEGACY_MARKERS) {
    text = text.split(`${marker}\n`).join("").split(marker).join("");
  }

  const spans = [
    ...spansOf(LOADER_TAG, text),
    ...spansOf(INLINE_SCRIPT, text, (tag) => /googletag\s*\.\s*defineSlot\s*\(/.test(tag)),
  ].sort((a, b) => a.start - b.start);

  if (!spans.length) {
    const head = text.trimEnd();
    return { code: head ? `${head}\n${block}` : block, mode: "appended", removed: [] };
  }

  let code = text.slice(0, spans[0].start) + block;
  for (let i = 0; i < spans.length; i++) {
    const gapEnd = spans[i + 1]?.start ?? text.length;
    const gap = text.slice(spans[i].end, gapEnd);
    // Celah yang cuma spasi di ANTARA dua potongan yang dibuang ikut dibuang; sisanya isi orang lain.
    code += spans[i + 1] && !gap.trim() ? "" : gap;
  }

  return {
    code,
    mode: "replaced",
    removed: spans.map((span) => snippet(text.slice(span.start, span.end))),
  };
}

/**
 * Isi `ads-settings` situs → field yang dikirim untuk kode iklannya.
 *
 * Kotak 1…N ditimpa body baru. Kotak SESUDAH N dikosongkan HANYA kalau isinya kode GPT
 * (`googletag.display`) — header baru tidak lagi mendefinisikan div lamanya, jadi kode itu mati dan
 * tidak menampilkan apa pun. Isi lain di sana (AdSense `<ins>`, banner) dibiarkan: ia bukan milik
 * tag ini, dan tidak ada yang meminta menghapusnya.
 */
export function planGptBodies(adsSettings, spec, bodies) {
  const current = adsSettings && typeof adsSettings === "object" ? adsSettings : {};
  const values = {};
  const cleared = [];

  GPT_BODY_FIELDS.forEach((field, index) => {
    if (index < spec.slots) {
      values[field] = bodies[index];
      return;
    }
    if (/googletag\s*\.\s*display\s*\(/.test(String(current[field] ?? ""))) {
      values[field] = "";
      cleared.push(field);
    }
  });

  // SELALU disetel, tanpa saklar: jumlah slot yang dipilih admin ADALAH jumlah slot iklannya, dan
  // "Jumlah slot iklan" yang masih menyebut angka lama berarti slot kosong yang tetap digambar, atau
  // slot baru yang tidak pernah digambar.
  values.jumlah_iklan = spec.slots;

  return {
    values,
    cleared,
    previousSlotCount: current.jumlah_iklan ?? "",
  };
}
