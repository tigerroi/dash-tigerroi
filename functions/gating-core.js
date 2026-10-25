import { buildCodeIndex, normalizeName, parseCampaignCodes } from "./sync-core.js";

// Logika murni sisi server untuk gating campaign Keitaro: bentuk baris yang disimpan di RTDB,
// antrean perintah, dan aturan kapan cermin perlu disegarkan.
//
// Dipisah dari sync-gating.mjs (yang memanggil API dan menulis ke database) supaya semuanya bisa
// diuji tanpa jaringan — sama seperti sync-core.js terhadap modul syncnya.

// Semua yang berhubungan dengan gating tinggal di satu cabang, bukan tersebar di beberapa node
// `dashboard/*`: kelimanya ditulis oleh run yang sama dan hanya berarti kalau dibaca bersama —
// baris campaign tanpa stempel `mirroredAt` di sebelahnya tidak bisa dibedakan dari baris basi.
export const GATING_PATH = "dashboard/gating";

export const GATE_ACTIONS = ["gate", "ungate"];

// Perintah yang menggantung lebih lama dari ini tidak jadi dieksekusi. Alasannya sama dengan
// saklar campaign: mengubah tujuan trafik iklan atas keputusan setengah jam lalu berarti bertindak
// tanpa ada yang memutuskannya sekarang — dan di sini yang berubah adalah ke mana pengunjung
// dikirim, bukan sekadar apakah campaign menyala.
const COMMAND_TTL_MS = Number(process.env.GATE_COMMAND_TTL_MS || 30 * 60_000);

// Perintah yang sudah selesai disimpan sebentar supaya hasilnya sempat terbaca di layar.
const COMMAND_KEEP_MS = Number(process.env.GATE_COMMAND_KEEP_MS || 6 * 3_600_000);

// Jarak minimum antar penyegaran cermin. Dokumentasi vi-control menyarankan cache kalau mau
// polling: /campaigns membaca stream tiap campaign satu per satu di sisi Keitaro. Penerap perintah
// tetap jalan tiap dua menit — yang dijarangkan hanya pembacaan daftar saat tidak ada yang terjadi.
const MIRROR_INTERVAL_MS = Number(process.env.GATE_MIRROR_INTERVAL_MS || 10 * 60_000);

// Riwayat yang diambil tiap penyegaran. API belum punya paging, dan 50 sudah lebih panjang dari
// yang dibaca siapa pun dalam satu duduk.
export const GATE_RUNS_LIMIT = Number(process.env.GATE_RUNS_LIMIT || 50);

const ERROR_MAX = 480;

/**
 * Kunci RTDB untuk satu campaign: "c57", bukan "57".
 *
 * ID campaign Keitaro adalah angka mulai dari 1, dan RTDB mengembalikan node berkunci angka
 * berurutan sebagai ARRAY berlubang — 57 baris jadi array 58 elemen yang isinya kebanyakan null,
 * dan setiap pembaca harus tahu itu. Awalan huruf memaksanya tetap objek.
 */
export function gateKey(campaignId) {
  return `c${String(campaignId).trim()}`;
}

export function campaignIdFromKey(key) {
  return String(key || "").replace(/^c/, "");
}

/**
 * Stempel waktu UTC vi-control → ISO yang dikenali formatDateTime.
 *
 * `startedAt` datang sebagai "2026-08-17 05:24:31.293338+00": spasi alih-alih "T", enam digit
 * pecahan detik, dan offset dua digit. Disimpan apa adanya, formatDate akan mencocokkannya dengan
 * pola ISO-nya, membaca "05:24" sebagai jam LOKAL, dan menampilkan pukul 05:24 untuk sesuatu yang
 * terjadi pukul 12:24 WIB — tujuh jam meleset, tanpa satu pun tanda di layar.
 */
export function toIsoUtc(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const normalized = text.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00");
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : "";
}

/**
 * Satu baris campaign untuk cermin di RTDB.
 *
 * `gated` sengaja dibiarkan bertiga nilai. `null` berarti stream campaign itu gagal dibaca — itu
 * TIDAK DIKETAHUI, bukan "belum di-gate". Dipetakan jadi false, halaman akan menawarkan tombol
 * Gate untuk campaign yang mungkin sudah di-gate, dan menekannya memasang gate di depan gate.
 */
export function gateCampaignRow(campaign) {
  const id = String(campaign?.id ?? "").trim();
  if (!id) return null;
  return {
    campaignId: id,
    name: String(campaign?.name || "").slice(0, 300),
    alias: String(campaign?.alias || ""),
    state: String(campaign?.state || ""),
    gated: campaign?.gated === true ? true : campaign?.gated === false ? false : null,
    // Link yang dipasang di iklan — `https://rabbitracing.live/{alias}?bit=[race]`. Dicermin apa
    // adanya dan TIDAK disusun dari alias-nya sendiri: bentuk itu milik vi-control, dan salinan
    // kedua akan tetap menghasilkan URL yang tampak benar pada hari domain gate-nya berganti.
    campaignUrl: String(campaign?.campaignUrl || ""),
    landingUrl: String(campaign?.landingUrl || ""),
    decoyUrl: String(campaign?.decoyUrl || ""),
  };
}

/**
 * Hostname yang berdiri di dalam sebuah teks. Dipakai untuk membaca tujuan dari NAMA campaign:
 * "ALDI T2 (WL) QbDw TRAFF (complaints.bispdailyupdates.pk)".
 */
const HOSTNAME = /[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)+/g;

/**
 * Subdomain yang dituju sebuah campaign -> KUNCI RTDB barisnya, atau "".
 *
 * Nama campaign yang menentukan, dan itu memang yang diketik orang saat membuatnya. Yang membuat
 * pembacaan itu bisa dipercaya bukan bentuk namanya melainkan syaratnya: sebuah kandidat hanya
 * menang kalau ia BENAR-BENAR ADA di `subDomains`. Yang tidak terdaftar tidak pernah jadi tebakan
 * — ia jatuh ke kandidat berikutnya, lalu ke kode campaign, lalu ke "".
 *
 * Dibaca dari BELAKANG: tujuan ditulis di ujung nama, dan nama yang kebetulan menyebut hostname
 * lain di tengahnya tidak boleh mengalahkannya.
 *
 * Bentuk yang benar-benar beredar hari ini dan kenapa masing-masing tetap terbaca:
 *   "(cosplay.masseffectstore.com(Visint))"  kurung yang tidak ditutup — hostname-nya utuh
 *   "(seniorpet.petcins.com) BLACKLIST"      catatan sesudah kurung — tidak ikut terbaca
 *   "(coverage.designingaround)"             TLD-nya hilang — dicocokkan sebagai AWALAN, dan hanya
 *                                            kalau tepat SATU subdomain terdaftar yang cocok
 *   "(SUB)", "(FREE)", "(nama sub)"          bukan hostname sama sekali — tidak menghasilkan apa pun
 *
 * KODE CAMPAIGN jadi cadangan, bukan pengganti (`buildCodeIndex`, indeks yang sama yang memetakan
 * spend Meta). Diadu pada 89 campaign yang ada (3 Sep 2026): nama menjawab 70, kode 51, dan
 * keduanya TIDAK PERNAH berselisih. Satu campaign hanya terjawab kode — "(fitnes.stylefemale)",
 * salah ketik "fitness" — dan itu persis gunanya cadangan ini.
 */
export function subDomainOfCampaign(campaignName, keyByHost, byCode) {
  const found = normalizeName(campaignName).match(HOSTNAME) || [];
  for (let i = found.length - 1; i >= 0; i--) {
    const candidate = found[i];
    if (keyByHost.has(candidate)) return keyByHost.get(candidate);
    // TLD yang hilang. Lebih dari satu yang cocok berarti namanya tidak menyebut satu subdomain
    // pun dengan pasti; memilih salah satunya berarti link sebuah campaign mendarat di baris yang
    // salah, dan tidak ada apa pun di layar yang bisa menunjukkannya.
    const partial = [...keyByHost.keys()].filter((host) => host.startsWith(`${candidate}.`));
    if (partial.length === 1) return keyByHost.get(partial[0]);
  }

  for (const token of parseCampaignCodes(campaignName)) {
    const owner = byCode.get(token);
    if (owner) return keyByHost.get(normalizeName(owner)) || "";
  }
  return "";
}

/**
 * Campaign URL tiap subdomain, sebagai update untuk node `subDomains`.
 *
 * KENAPA DITULIS KE BARIS SUBDOMAIN, bukan dihitung di browser. Cermin gating hanya dilanggan
 * superadmin (`gatingSubscriptions` di useFirebaseStore) — isinya nama campaign berikut landing
 * dan decoy URL-nya — sementara yang perlu melihat link-nya adalah advertiser yang memasangnya di
 * iklan. Dihitung di browser, kolomnya kosong untuk semua orang kecuali satu.
 *
 * Yang tidak punya campaign DIKOSONGKAN (`null`), bukan dilewati: link yang bertahan setelah
 * campaign-nya dihapus di Keitaro adalah link mati yang mengaku hidup.
 */
export function subDomainCampaignUrls(campaigns, subDomains) {
  const rows = Object.entries(subDomains || {}).filter(
    ([, sub]) => sub && !sub.deletedAt && sub.name,
  );
  const keyByHost = new Map(rows.map(([key, sub]) => [normalizeName(sub.name), key]));
  const { byCode } = buildCodeIndex(subDomains);

  const urls = new Map();
  for (const campaign of campaigns || []) {
    const url = String(campaign?.campaignUrl || "").trim();
    if (!url) continue;
    const key = subDomainOfCampaign(campaign?.name, keyByHost, byCode);
    if (!key) continue;
    const list = urls.get(key) || [];
    // Satu subdomain menaungi beberapa campaign, dan tiap link dipasang di iklan yang berbeda.
    // Yang disimpan semuanya; yang kembar (dua campaign, satu link) cukup sekali.
    if (!list.includes(url)) list.push(url);
    urls.set(key, list);
  }

  const update = {};
  for (const [key, sub] of rows) {
    const next = (urls.get(key) || []).join(", ");
    if (String(sub.campaignUrl || "") === next) continue;
    update[`${key}/campaignUrl`] = next || null;
  }
  return update;
}

export function gateCampaignsMap(campaigns) {
  const rows = {};
  for (const campaign of campaigns || []) {
    const row = gateCampaignRow(campaign);
    if (row) rows[gateKey(row.campaignId)] = row;
  }
  return rows;
}

// Campaign yang pratinjaunya perlu diambil: yang belum di-gate, dan hanya itu. Yang sudah di-gate
// tidak punya tombol Gate untuk dijelaskan, dan Ungate tidak punya pratinjau; yang `gated: null`
// dilewati karena kita belum tahu ia sebelah mana.
export function previewTargets(campaigns) {
  return (campaigns || []).filter((campaign) => campaign?.gated === false).map((c) => String(c.id));
}

/**
 * Pratinjau → baris RTDB. Diratakan, bukan disimpan utuh: `plan` membawa id stream dan objek
 * bersarang yang tidak satu pun ditampilkan, dan node yang diikuti realtime oleh tiap browser yang
 * membuka halaman ini sebaiknya sekecil mungkin.
 */
export function gatePreviewRow(campaignId, preview, now = new Date()) {
  const plan = preview?.plan || {};
  const current = plan.current || {};
  const willSet = preview?.willSet || {};
  const blockers = (plan.blockers || []).map((b) => String(b)).filter(Boolean);

  return {
    campaignId: String(campaignId),
    campaignName: String(plan.campaignName || "").slice(0, 300),
    applicable: plan.applicable === true,
    // RTDB membuang array kosong sama sekali, jadi daftar yang boleh kosong disimpan sebagai objek
    // berkunci urutan — persis alasan `items` di syncIssuesUpdate berbentuk begitu.
    blockers: Object.fromEntries(blockers.map((b, i) => [`i${i}`, b])),
    blockerCount: blockers.length,
    alreadyGated: plan.alreadyGated === true,
    landingName: String(plan.landingName || ""),
    currentLandingUrl: String(current.landingUrl || ""),
    currentBotProtectionUrl: String(current.botProtectionUrl || ""),
    currentFlow3Url: String(current.flow3Url || ""),
    // Hanya ada kalau site-nya sudah pernah dibuat. Untuk site baru, key-nya baru lahir saat
    // gating — vi-control sengaja mengosongkannya daripada menebak, dan halaman mengatakan begitu
    // alih-alih menampilkan tiga sel kosong yang terbaca seperti data hilang.
    willSetLandingUrl: String(willSet.landingUrl || ""),
    willSetBotProtectionUrl: String(willSet.botProtectionUrl || ""),
    willSetFlow3Url: String(willSet.flow3Url || ""),
    siteStatus: String(preview?.site?.status || ""),
    checkedAt: now.toISOString(),
  };
}

/**
 * Satu baris riwayat.
 *
 * `plan` dan `beforeState` DIBUANG. Keduanya objek JSON besar (beforeState adalah bahan rollback
 * di sisi vi-control), tidak satu pun ditampilkan di daftar, dan lima puluh salinannya akan ikut
 * terunduh oleh tiap browser yang membuka halaman ini — riwayat lengkapnya tetap ada di
 * /gate-runs kalau suatu saat benar-benar dibutuhkan.
 */
export function gateRunRow(run) {
  const id = String(run?.id || "").trim();
  if (!id) return null;
  const verification = run?.verification || null;

  return {
    id,
    startedAt: toIsoUtc(run?.startedAt),
    campaignId: String(run?.campaignId || ""),
    campaignName: String(run?.campaignName || "").slice(0, 300),
    action: String(run?.action || ""),
    status: String(run?.status || ""),
    siteId: String(run?.siteId || ""),
    error: trimError(run?.error, ""),
    durationMs: Number(run?.durationMs || 0),
    // Bukti verifikasi diringkas jadi satu boolean plus lokasinya. Bentuk aslinya berbeda antara
    // gate (passRedirectsToSite/decoyLeavesGate) dan ungate (decoy/restoredTo), dan tabel yang
    // harus tahu bedanya akan menampilkan kolom kosong untuk setengah barisnya.
    verified: verificationOk(run?.action, verification),
    passLocation: String(verification?.passLocation || verification?.restoredTo || ""),
    decoyLocation: String(verification?.decoyLocation || verification?.decoy || ""),
    // routing-nya benar, tapi ada baris uji yang tertinggal di data vi-control dan perlu dihapus
    // manual. Bukan kegagalan, tapi juga bukan sesuatu yang boleh hilang diam-diam.
    cleanupComplete: verification?.cleanupComplete !== false,
  };
}

// "" (bukan false) untuk run yang memang tidak punya verifikasi — yang ditolak sebelum menulis
// apa pun. False di sana akan terbaca sebagai "diverifikasi dan hasilnya buruk".
function verificationOk(action, verification) {
  if (!verification) return "";
  if (action === "ungate") {
    return Boolean(verification.restoredTo || verification.decoy);
  }
  return (
    verification.landingReadBack === true &&
    verification.passRedirectsToSite === true &&
    verification.decoyLeavesGate === true
  );
}

export function gateRunsMap(runs) {
  const rows = {};
  for (const run of runs || []) {
    const row = gateRunRow(run);
    if (row) rows[row.id] = row;
  }
  return rows;
}

// --- Antrean perintah --------------------------------------------------------------------------
//
// Tombolnya tidak memanggil vi-control. Ia menulis NIAT ke `dashboard/gating/commands/{key}`, dan
// yang memanggil API adalah penerap di sync-gating.mjs. Alasannya sama dengan saklar campaign: DRS
// memblokir `allUsers`, jadi browser tidak bisa memanggil Cloud Function sama sekali — dan di sini
// ada alasan kedua yang lebih keras, yaitu API key-nya tidak boleh sampai ke browser.
//
// Bentuk di bawah harus sama persis dengan `gateCommandEntry` di src/lib/gating.js.

export function gateCommandEntry(campaign, action, actor, now = new Date()) {
  if (!GATE_ACTIONS.includes(action)) {
    throw new Error(`Aksi gating tidak dikenal: ${action}`);
  }
  const campaignId = String(campaign?.campaignId ?? campaign?.id ?? "").trim();
  if (!/^\d+$/.test(campaignId)) {
    throw new Error("Campaign ini tidak punya ID Keitaro yang bisa dipakai.");
  }

  return {
    campaignId,
    // Namanya ikut disimpan supaya pesan gagal dan riwayat bisa menyebut campaign yang mana; "44"
    // tidak berarti apa-apa bagi orang yang membacanya besok pagi.
    campaign: String(campaign?.name || campaign?.campaign || "").slice(0, 300),
    action,
    state: "pending",
    requestedAt: now.toISOString(),
    requestedBy: actor || "dashboard",
    error: null,
  };
}

// Perintah yang menunggu. Yang bentuknya tidak utuh dilewati diam-diam: satu baris rusak tidak
// boleh menahan perintah lain di run yang sama.
export function pendingGateCommands(commands, now = new Date()) {
  const pending = [];
  for (const [key, command] of Object.entries(commands || {})) {
    if (command?.state !== "pending") continue;
    if (!GATE_ACTIONS.includes(command.action)) continue;
    const campaignId = String(command.campaignId || campaignIdFromKey(key));
    if (!/^\d+$/.test(campaignId)) continue;
    pending.push({
      key,
      campaignId,
      campaign: command.campaign || "",
      action: command.action,
      requestedAt: command.requestedAt || "",
      requestedBy: command.requestedBy || "",
      // Yang basi tetap dikembalikan, ditandai — penerapnya yang menuliskan kenapa ia tidak jadi
      // dieksekusi. Dilewati diam-diam, ia menggantung "Menunggu" selamanya di layar.
      expired: isExpired(command.requestedAt, now),
    });
  }
  // Urut permintaan, bukan urut kunci: dua perintah untuk campaign berbeda yang ditekan berurutan
  // sebaiknya dieksekusi dalam urutan yang sama supaya riwayatnya terbaca seperti yang terjadi.
  return pending.sort((a, b) => String(a.requestedAt).localeCompare(String(b.requestedAt)));
}

function isExpired(requestedAt, now) {
  const at = Date.parse(requestedAt || "");
  return Number.isFinite(at) ? now.getTime() - at > COMMAND_TTL_MS : false;
}

/**
 * Payload update (relatif terhadap GATING_PATH) untuk perintah yang sudah dieksekusi.
 *
 * `status` dari vi-control ada tiga dan ketiganya harus sampai ke layar apa adanya:
 *
 *   ok      — berhasil & terverifikasi
 *   aborted — DITOLAK, tidak ada yang ditulis sama sekali. Bukan error kami; sistemnya sedang
 *             melindungi, dan mengulanginya membabi buta tidak akan mengubah apa pun.
 *   problem — tersimpan TAPI verifikasi gagal. Ini yang paling berbahaya kalau digabung dengan
 *             "gagal": routing-nya sudah berubah, dan yang membacanya sebagai "tidak jadi" akan
 *             meninggalkan campaign dalam keadaan yang tidak diperiksa siapa pun.
 */
export function gateCommandUpdate(command, result, now = new Date()) {
  const stamp = now.toISOString();
  const base = `commands/${command.key}`;
  const payload = {};
  const status = result?.status || "";

  payload[`${base}/finishedAt`] = stamp;
  payload[`${base}/result`] = status || null;
  payload[`${base}/runId`] = result?.runId || null;

  if (status === "ok") {
    payload[`${base}/state`] = "applied";
    payload[`${base}/error`] = null;
    // Baris cermin ikut diperbarui di tempat, supaya tabel tidak bertahan menampilkan keadaan lama
    // sampai penyegaran berikutnya. Penyegaran di run yang sama akan menimpanya dengan bacaan
    // sungguhan — ini hanya menutup jeda di antara keduanya.
    payload[`campaigns/${gateKey(command.campaignId)}/gated`] = command.action === "gate";
    return payload;
  }

  payload[`${base}/state`] = "failed";
  payload[`${base}/error`] = trimError(
    result?.error ||
      describeBlockers(result) ||
      `vi-control menjawab "${status || "tanpa status"}".`,
  );
  return payload;
}

// `aborted` membawa alasannya di plan.blockers, dalam bahasa manusia, dan itulah satu-satunya
// keterangan yang berguna — "aborted" sendiri tidak menyebut apa yang harus diperbaiki.
function describeBlockers(result) {
  const blockers = result?.plan?.blockers;
  return Array.isArray(blockers) && blockers.length ? blockers.join("; ") : "";
}

// Aturan database membatasi `error` pada 500 karakter, dan tulisan yang melanggar .validate DITOLAK
// SELURUHNYA — perintahnya akan tetap "pending" dan dicoba lagi tiap dua menit, selamanya, atas
// kegagalan yang tidak pernah bisa ia catat.
function trimError(message, fallback = "Perintah gagal dijalankan.") {
  const text = String(message || fallback || "");
  if (!text) return "";
  return text.length > ERROR_MAX ? `${text.slice(0, ERROR_MAX - 1)}…` : text;
}

export function expiredGateCommandKeys(commands, now = new Date()) {
  return Object.entries(commands || {})
    .filter(([, command]) => {
      if (command?.state === "pending") return false;
      const at = Date.parse(command?.finishedAt || command?.requestedAt || "");
      return Number.isFinite(at) && now.getTime() - at > COMMAND_KEEP_MS;
    })
    .map(([key]) => key);
}

// --- Status cermin -----------------------------------------------------------------------------

export function gateStatusEntry(campaigns, now = new Date()) {
  const rows = campaigns || [];
  return {
    mirroredAt: now.toISOString(),
    campaigns: rows.length,
    gated: rows.filter((c) => c?.gated === true).length,
    ungated: rows.filter((c) => c?.gated === false).length,
    // Stream yang gagal dibaca. Dihitung terpisah dan bukan dilebur ke `ungated`, karena selisih
    // itu persis yang membedakan "5 campaign siap di-gate" dari "5 campaign tidak terbaca".
    unknown: rows.filter((c) => c?.gated !== true && c?.gated !== false).length,
  };
}

/**
 * Perlukah cermin disegarkan sekarang?
 *
 * Tiga sebab: belum pernah, sudah lewat jaraknya, atau ada yang menekan "Segarkan" di halaman.
 * Yang ketiga ada karena tombol itu tidak bisa memanggil apa pun secara langsung (DRS) — yang bisa
 * ia lakukan hanya menaruh stempel, dan run berikutnya yang membacanya.
 */
export function mirrorDue(status, now = new Date(), lastRefreshRequest = "") {
  const mirroredAt = Date.parse(status?.mirroredAt || "");
  if (!Number.isFinite(mirroredAt)) return true;

  const requestedAt = Date.parse(lastRefreshRequest || status?.refreshRequestedAt || "");
  if (Number.isFinite(requestedAt) && requestedAt > mirroredAt) return true;

  return now.getTime() - mirroredAt >= MIRROR_INTERVAL_MS;
}

// --- Isu sync ----------------------------------------------------------------------------------

export function gateIssue(command, message) {
  return {
    source: command?.action === "ungate" ? "Ungate campaign" : "Gate campaign",
    target: command?.campaign || `Campaign ${command?.campaignId || "?"}`,
    message,
    impact:
      command?.action === "ungate"
        ? "Campaign ini masih lewat gate — perintahnya tidak jadi dijalankan."
        : "Trafik campaign ini masih langsung, belum lewat gate — kunjungannya tidak terukur.",
  };
}

// Verifikasi yang gagal setelah perubahan TERSIMPAN adalah kelas isu tersendiri: tidak ada yang
// bisa diulang, dan yang dibutuhkan bukan percobaan lagi melainkan seseorang yang memeriksanya.
export function gateProblemIssue(command, result) {
  return {
    source: "Verifikasi gating",
    target: command?.campaign || `Campaign ${command?.campaignId || "?"}`,
    message: `Perubahan tersimpan tapi verifikasinya gagal (run ${result?.runId || "?"}).`,
    impact: "Routing campaign ini sudah berubah tanpa terbukti benar — periksa manual di Keitaro.",
  };
}
