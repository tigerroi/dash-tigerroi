import { accountKeys, campaignRowBelongsTo, matchCode, normalizeName } from "./sync-core.js";

/**
 * Aturan halaman Campaign (/campaigns): duplikasi dan edit campaign Meta.
 *
 * Murni — tidak ada jaringan dan tidak ada RTDB di sini. I/O Meta tinggal di meta.js, orkestrasi
 * job di campaign-copy-jobs.mjs, route di server/campaign-manage.js. Keputusan yang tinggal di
 * dalam pemanggil API tidak bisa diuji tanpa menghubungi Meta.
 */

// Ditolak ATURAN kita, sebelum menyentuh Meta.
export class RuleError extends Error {
  constructor(message) {
    super(message);
    this.status = 422;
  }
}

// Nama yang memetakan belanja ke subdomain yang belum pernah dilihat orangnya di layar.
export class ConfirmRequired extends Error {
  constructor(subDomain) {
    super(`Nama ini memetakan belanjanya ke ${subDomain}. Konfirmasi dulu sebelum menyimpan.`);
    this.status = 409;
    this.needsConfirm = true;
    this.subDomain = subDomain;
  }
}

export const MAX_COPIES = 5;
// Batas salinan LANGSUNG Meta berlaku per panggilan, dan tiap ad set disalin dengan panggilannya
// sendiri — jadi batasnya per ad set, bukan per campaign. Jalur asinkron yang bisa lebih dari itu
// tertutup untuk app ini (lihat lampiran spec).
export const MAX_ADS_PER_AD_SET = 3;
export const MAX_AD_SETS = 50;
const COPYABLE = new Set(["ACTIVE", "PAUSED"]);

/**
 * Ad set yang akan disalin, berikut jumlah iklan yang seharusnya ikut.
 *
 * Hanya yang saklarnya ACTIVE/PAUSED: yang diarsipkan atau dihapus tidak dijalankan siapa pun.
 * Jumlah iklannya dipakai dua kali — menolak ad set di atas 3 iklan SEBELUM menyentuh Meta, dan
 * sesudahnya membandingkan dengan iklan yang benar-benar lahir (deep copy melewatkan iklan diam-diam
 * kalau izin Halaman kurang).
 *
 * `adRows` membawa nama, creative, Halaman, dan saklar tiap iklan sumber — bahan `adsToRepair`. Ia
 * TIDAK ikut tersimpan di node job (yang ditulis cuma `adSetCount`/`adCount`, lihat `copyJobEntry`):
 * ia hidup selama satu job berjalan saja, dan menuliskannya berarti menyalin daftar iklan Meta ke
 * RTDB untuk sesuatu yang sudah selesai begitu job-nya selesai.
 */
export function copyPlan(adSets, ads) {
  const copyable = (adSets || []).filter((set) =>
    COPYABLE.has(String(set?.status || "").toUpperCase()),
  );
  if (!copyable.length) throw new RuleError("Campaign ini tidak punya ad set yang bisa disalin.");
  if (copyable.length > MAX_AD_SETS) {
    throw new RuleError(
      `Campaign ini memuat ${copyable.length} ad set; paling banyak ${MAX_AD_SETS} ad set sekali salin.`,
    );
  }
  const adsBySet = new Map();
  for (const ad of ads || []) {
    if (!COPYABLE.has(String(ad?.status || "").toUpperCase())) continue;
    const key = String(ad.adSetId || "");
    if (!adsBySet.has(key)) adsBySet.set(key, []);
    adsBySet.get(key).push({
      name: String(ad.name || ""),
      creativeId: String(ad.creativeId || ""),
      pageId: String(ad.pageId || ""),
      // Statusnya dibawa supaya iklan yang dipulihkan lahir dengan saklar yang sama dengan sumbernya,
      // sepola `INHERITED_FROM_SOURCE` yang dipakai salinan ad set-nya.
      status: COPYABLE.has(String(ad.status).toUpperCase()) ? String(ad.status) : "PAUSED",
    });
  }
  const planned = copyable.map((set) => {
    const adRows = adsBySet.get(String(set.id)) || [];
    return { id: String(set.id), name: set.name || "", ads: adRows.length, adRows };
  });
  const tooBig = planned.filter((set) => set.ads > MAX_ADS_PER_AD_SET);
  if (tooBig.length) {
    const names = tooBig.slice(0, 3).map((set) => set.name || set.id);
    const more = tooBig.length > 3 ? ` dan ${tooBig.length - 3} lainnya` : "";
    throw new RuleError(
      `Ad set ${names.join(", ")}${more} berisi lebih dari ${MAX_ADS_PER_AD_SET} iklan; Meta hanya bisa menyalin paling banyak ${MAX_ADS_PER_AD_SET} iklan per ad set sekali salin.`,
    );
  }
  return { adSets: planned, adCount: planned.reduce((sum, set) => sum + set.ads, 0) };
}

export function copyNames(name, count) {
  const base = String(name || "").trim();
  if (!base) throw new RuleError("Nama salinan wajib diisi.");
  if (base.length > 400) throw new RuleError("Nama salinan terlalu panjang (maks 400 karakter).");
  const total = Number(count);
  if (!Number.isInteger(total) || total < 1 || total > MAX_COPIES) {
    throw new RuleError(`Jumlah salinan 1 sampai ${MAX_COPIES}.`);
  }
  return total === 1
    ? [base]
    : Array.from({ length: total }, (_, index) => `${base} #${index + 1}`);
}

/**
 * Boleh-tidaknya sebuah nama campaign, dari kode Keitaro di dalamnya.
 *
 * Nama itulah pemetaannya: `matchCode` yang sama dengan sync memutuskan subdomain mana yang
 * menerima belanjanya. Link iklan TIDAK ikut berubah (creative tidak bisa diubah link-nya), jadi
 * campaign yang sudah terpetakan lewat kode tidak boleh diberi kode subdomain lain.
 */
export function campaignNameVerdict(row, name, byCode) {
  const { subDomain, code } = matchCode(name, byCode);
  if (!subDomain) {
    throw new RuleError(
      code
        ? `Kode "${code}" di nama belum terdaftar di subdomain mana pun — belanjanya tidak akan masuk ROI siapa pun.`
        : "Nama campaign tidak membawa kode Keitaro yang terdaftar — belanjanya tidak akan masuk ROI siapa pun.",
    );
  }
  const mapped = row?.subDomainSource === "code" ? normalizeName(row?.subDomain) : "";
  if (mapped && normalizeName(subDomain) !== mapped) {
    throw new RuleError(
      `Kode ${code} milik ${subDomain}, sedangkan iklan campaign ini mengarah ke ${row.subDomain}. Link iklan tidak ikut berubah, jadi belanjanya akan tercatat di subdomain yang salah.`,
    );
  }
  return { subDomain, code, needsConfirm: !mapped };
}

/**
 * Nama yang sudah dipakai campaign lain di ad account yang sama ditolak.
 *
 * Sync melebur campaign Meta per NAMA (`normalizeName`, di `mergeCampaignSources`), jadi dua campaign
 * bernama sama di satu akun jadi SATU baris tabel yang membawa `campaignId` milik yang kebetulan
 * didaftar Meta terakhir — salinannya hilang dari /campaigns, atau saklar baris sumbernya diam-diam
 * menyalakan salinan. `taken` adalah `{ id, name }` dari daftar campaign akun itu (bacaan yang sama
 * dengan sync) ditambah nama job salinan yang masih berjalan; `exceptCampaignId` mengecualikan
 * campaign yang sedang diganti namanya, supaya namanya sendiri tidak dihitung bentrok.
 */
export function assertNamesFree(names, taken, { exceptCampaignId = "" } = {}) {
  const used = new Map();
  for (const item of taken || []) {
    if (exceptCampaignId && String(item?.id || "") === String(exceptCampaignId)) continue;
    const key = normalizeName(item?.name);
    if (key && !used.has(key)) used.set(key, item.name);
  }
  const own = new Set();
  for (const name of names || []) {
    const key = normalizeName(name);
    if (used.has(key) || own.has(key)) {
      throw new RuleError(
        `Nama "${String(name).trim()}" sudah dipakai campaign lain di ad account ini — sync akan melebur keduanya jadi satu baris.`,
      );
    }
    own.add(key);
  }
}

export function assertConfirmed(verdict, confirmSubDomain) {
  if (
    verdict.needsConfirm &&
    normalizeName(confirmSubDomain) !== normalizeName(verdict.subDomain)
  ) {
    throw new ConfirmRequired(verdict.subDomain);
  }
}

// Ad account pemilik sebuah baris campaign, lewat kunci yang sama dengan sync. Baris tanpa identitas
// akun sama sekali tidak dicocokkan: `campaignRowBelongsTo` meloloskannya, dan di sini itu berarti
// akun PERTAMA yang kebetulan ada.
export function accountOfCampaignRow(accounts, row) {
  if (!row?.adAccount && !row?.account && !row?.actName) return null;
  for (const [id, account] of Object.entries(accounts || {})) {
    if (!account || account.deletedAt || !account.actId) continue;
    // Kunci RTDB menang atas field `id` yang kebetulan tersimpan di barisnya.
    if (campaignRowBelongsTo(row, new Set(accountKeys(account)))) return { ...account, id };
  }
  return null;
}

// --- Job salinan -----------------------------------------------------------------------------

export const COPY_JOBS_PATH = "dashboard/campaignCopyJobs";
const REQUESTED_TIMEOUT_MS = 10 * 60_000;
// Salin bertahap berjalan di latar: lima salinan × lima puluh ad set pada jeda 400 ms antarpanggilan
// sudah sekitar dua menit. Tiga puluh menit berarti prosesnya memang mati, bukan lambat.
const RUNNING_TIMEOUT_MS = 30 * 60_000;
const COPY_JOB_KEEP_MS = 7 * 86_400_000;
const ACTIVE = new Set(["requested", "running"]);

// Berawalan huruf, sepola `c57` di antrean gating: RTDB membaca kunci angka berurutan sebagai array.
export function newCopyJobId(now = new Date(), random = Math.random) {
  const suffix = Math.floor(random() * 36 ** 4)
    .toString(36)
    .padStart(4, "0");
  return `j${now.getTime().toString(36)}${suffix}`;
}

export function copyJobEntry({
  source,
  userId,
  account,
  names,
  plan,
  requestedBy,
  now = new Date(),
}) {
  const at = now.toISOString();
  return {
    sourceCampaignId: String(source.campaignId),
    sourceName: String(source.campaign || ""),
    userId: String(userId),
    accountId: String(account.id),
    actId: String(account.actId || ""),
    count: names.length,
    names,
    adSetCount: plan.adSets.length,
    adCount: plan.adCount,
    state: "requested",
    requestedBy: String(requestedBy || ""),
    requestedAt: at,
    updatedAt: at,
  };
}

export function activeCopyJob(jobs, campaignId) {
  const found = Object.entries(jobs || {}).find(
    ([, job]) => String(job?.sourceCampaignId) === String(campaignId) && ACTIVE.has(job?.state),
  );
  return found ? found[0] : "";
}

// Nama yang AKAN lahir dari job salinan akun ini yang masih berjalan: belum ada di daftar Meta, dan
// dua job yang sama-sama menuju satu nama baru baru ketahuan bentrok sesudah keduanya lahir.
export function activeJobNames(jobs, accountId) {
  return Object.values(jobs || {})
    .filter((job) => ACTIVE.has(job?.state) && String(job?.accountId) === String(accountId))
    .flatMap((job) =>
      (Array.isArray(job.names) ? job.names : Object.values(job.names || {})).map((name) => ({
        id: "",
        name,
      })),
    );
}

// Akhiran nama SEMENTARA salinan, unik per job dan per salinan. Campaign tanpa isi lahir dengan nama
// sumber + akhiran ini, lalu langsung diganti namanya: tanpa akhiran ia lahir KEMBAR dengan
// sumbernya, dan sync melebur keduanya jadi satu baris selama ganti namanya belum (atau tidak) jadi.
export function interimCopySuffix(jobId, index) {
  return ` (salinan ${jobId}-${index + 1})`;
}

/**
 * Apakah kegagalan salin campaign bisa terjadi SESUDAH Meta sempat membuatnya.
 *
 * Membaca bentuk pesan yang ditulis meta.js: `(#1)`/`(#2)` (galat umum/sementara Meta), balasan
 * non-JSON (halaman HTML dari edge di depan Graph), HTTP 5xx tanpa badan error, jaringan putus atau
 * waktu habis (tanpa awalan "Meta ..." sama sekali), dan jawaban sukses yang tidak membawa ID
 * salinan. Penolakan berkode lain (`#100`, `#10`, `#200`, …) PASTI tidak membuat apa pun.
 */
export function metaOutcomeUncertain(message) {
  const text = String(message || "");
  if (/balasan non-JSON/.test(text)) return true;
  const code = /\(#(\d+)(?:-\d+)?\)/.exec(text);
  if (code) return code[1] === "1" || code[1] === "2";
  if (/-> HTTP 5\d\d\b/.test(text)) return true;
  if (/tidak mengembalikan ID/.test(text)) return true;
  return /fetch failed|abort|timed? ?out|socket|ECONN|ETIMEDOUT|EPIPE|Unable to connect|network/i.test(
    text,
  );
}

const UNKNOWN_ERROR =
  "Server tidak tahu apakah salinannya sudah lahir — periksa Ads Manager sebelum menyalin lagi.";

export function uncertainCopyError(message) {
  return `Hasil salinan tidak pasti (${String(message || "").slice(0, 800)}) — salinannya mungkin sudah lahir; jangan menyalin lagi sebelum periksa Ads Manager.`;
}

// Sebab sebuah salinan yang LAHIR tidak utuh. Deep copy melewatkan iklan TANPA SATU PUN ERROR, dan
// sebabnya dua — keduanya dibuktikan ke produksi (lihat lampiran spec): app Meta yang masih
// Development Mode (12 Sep 2026, menutup SELURUH armada sekaligus) dan System User yang tidak punya
// izin Create ads di Halaman creative-nya (11 Sep 2026, per Halaman). Keduanya disebut karena
// keduanya diperbaiki di tempat yang berbeda, dan yang menyebut satu saja mengirim orang ke
// Business Manager untuk sesuatu yang tinggal di dashboard app.
//
// `ads` dihitung PER AD SET, dipotong di jumlah iklan sumbernya (`runCopyJob`): kelebihan di satu
// ad set tidak boleh menutupi iklan yang hilang di ad set lain.
export function copyShortfall(copy) {
  if (!copy?.campaignId) return "";
  const missingAdSets = (copy.adSetsExpected || 0) - (copy.adSets || 0);
  if (missingAdSets > 0)
    return `${missingAdSets} dari ${copy.adSetsExpected} ad set gagal disalin.`;
  const missingAds = (copy.adsExpected || 0) - (copy.ads || 0);
  if (missingAds > 0) {
    // Kalimat terakhir, dan cuma dipakai kalau pemulihannya sendiri tidak menyisakan pesan Meta:
    // sejak iklan yang tidak tersalin dibuatkan ulang dari creative sumbernya, sebab yang sebenarnya
    // hampir selalu sudah berdiri di `error` ad set-nya berikut Halaman yang harus diberi izin.
    return `${missingAds} dari ${copy.adsExpected} iklan tidak ikut tersalin, dan membuatkannya ulang dari creative iklan sumber juga tidak berhasil — periksa izin beriklan System User di Halaman iklan itu.`;
  }
  return "";
}

/**
 * Iklan sumber yang belum berdiri di ad set salinan — yang harus dibuatkan sendiri.
 *
 * Ada karena deep copy Meta MELEWATKAN iklan diam-diam: ia membuat creative BARU lewat app kita, dan
 * app yang masih Development Mode ditolak `(#100-1885183)` untuk tiap creative. Dibuatkan sendiri
 * dengan creative iklan SUMBER, tidak ada creative baru yang lahir sama sekali — penolakan itu tidak
 * pernah berlaku (dibuktikan 12 Sep 2026: penolakannya berpindah ke izin Halaman).
 *
 * Dicocokkan lewat NAMA, bukan lewat jumlah: salinan yang melahirkan sebagian iklannya tidak
 * mengabarkan yang MANA, dan membuat sebanyak selisihnya menghasilkan iklan kembar di ad set yang
 * sudah punya isinya. Nama yang kosong di sisi sumber tidak pernah dipulihkan — ia tidak bisa
 * dibedakan dari iklan mana pun di salinan.
 */
export function adsToRepair(adRows, copiedNames) {
  const taken = new Map();
  for (const name of copiedNames || []) {
    const key = normalizeName(name);
    taken.set(key, (taken.get(key) || 0) + 1);
  }
  const wanted = [];
  for (const row of adRows || []) {
    if (!row?.creativeId || !row?.name) continue;
    const key = normalizeName(row.name);
    if (taken.get(key)) {
      taken.set(key, taken.get(key) - 1);
      continue;
    }
    wanted.push(row);
  }
  return wanted;
}

/**
 * Yang salah dengan SATU salinan, sebagai kalimat — kosong kalau ia lahir utuh.
 *
 * Diturunkan dari catatannya sendiri, bukan dari `error` yang kebetulan diisi pemanggilnya: iklan
 * yang kurang dan ganti nama yang gagal sama-sama membuat salinan tidak utuh. Nama yang gagal diganti
 * meninggalkan nama SEMENTARA berakhiran unik — tabelnya tidak rusak, tapi orangnya harus tahu.
 */
export function copyProblem(copy) {
  if (!copy?.campaignId) return copy?.error || "Meta tidak membuat salinan.";
  const rename = copy.renameError
    ? `Salinan ${copy.campaignId} masih bernama sementara — ganti nama ke "${copy.name}" gagal (${copy.renameError}); ubah lewat tombol Ubah.`
    : "";
  return [copy.error || copyShortfall(copy), rename].filter(Boolean).join(" ");
}

export function copyOutcome(copies) {
  // Salinan yang hasilnya tidak pasti menentukan status job: "gagal" di sana membuat orang menyalin
  // lagi, dan salinan yang ternyata sudah lahir tidak bisa ditarik kembali.
  const uncertain = copies.find((copy) => copy?.uncertain);
  if (uncertain) return { state: "unknown", error: uncertain.error || UNKNOWN_ERROR };
  const born = copies.filter((copy) => copy?.campaignId).length;
  if (!born) {
    return {
      state: "failed",
      error: copies.find((copy) => copy?.error)?.error || "Meta tidak membuat salinan.",
    };
  }
  const problem = copies.map(copyProblem).find(Boolean);
  return problem ? { state: "partial", error: problem } : { state: "done", error: "" };
}

/**
 * Job yang menggantung → `unknown`, BUKAN `failed`.
 *
 * Server tidak tahu apakah salinannya sudah lahir: proses yang mati sesudah Meta menjawab tetapi
 * sebelum hasilnya ditulis meninggalkan job `requested`. Menyebutnya gagal membuat orang menyalin
 * lagi — dan salinan yang sudah lahir tidak bisa ditarik kembali.
 *
 * `running` diukur dari AKTIVITAS TERAKHIR (`updatedAt`, ditulis tiap ad set), bukan dari mulainya:
 * job besar yang masih bergerak bukan job yang mati.
 */
export function stalledJobPatch(job, now = new Date()) {
  const since =
    job?.state === "running" ? job.updatedAt || job.startedAt || job.requestedAt : job?.requestedAt;
  const age = now.getTime() - Date.parse(since || "");
  const limit =
    job?.state === "requested"
      ? REQUESTED_TIMEOUT_MS
      : job?.state === "running"
        ? RUNNING_TIMEOUT_MS
        : null;
  if (limit === null || !(age > limit)) return null;
  const at = now.toISOString();
  return {
    state: "unknown",
    error: UNKNOWN_ERROR,
    updatedAt: at,
    finishedAt: at,
  };
}

// Yang masih berjalan tidak dibuang: ia harus lebih dulu jadi `unknown` lewat `stalledJobPatch`.
export function expiredCopyJobIds(jobs, now = new Date()) {
  return Object.entries(jobs || {})
    .filter(([, job]) => !ACTIVE.has(job?.state))
    .filter(([, job]) => now.getTime() - Date.parse(job?.requestedAt || "") > COPY_JOB_KEEP_MS)
    .map(([id]) => id);
}

// --- Anggaran --------------------------------------------------------------------------------

// Hanya anggaran HARIAN, di tingkat yang memegangnya. Tingkat yang salah tidak diberi kotak isian:
// Meta menolaknya, dan penolakan untuk kotak yang tidak seharusnya ada tidak menerangkan apa pun.
export function budgetState(level, item) {
  if (item?.lifetimeBudget) {
    return {
      editable: false,
      reason: "Memakai anggaran seumur hidup (lifetime) — ubah di Ads Manager.",
    };
  }
  if (item?.dailyBudget === null || item?.dailyBudget === undefined) {
    return {
      editable: false,
      reason:
        level === "campaign"
          ? "Anggaran dipegang ad set (ABO)."
          : "Anggaran dipegang campaign (CBO).",
    };
  }
  return { editable: true, reason: "" };
}

export function parseBudget(value) {
  const amount = Number(value);
  if (
    value === "" ||
    value === null ||
    value === undefined ||
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    throw new RuleError("Anggaran harian harus angka lebih dari nol.");
  }
  return amount;
}

// --- Targeting -------------------------------------------------------------------------------

const GEO_EDITABLE_KEYS = new Set(["countries", "location_types"]);

function hasValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return Boolean(value);
}

function upperList(value) {
  return (Array.isArray(value) ? value : [])
    .map((code) =>
      String(code || "")
        .trim()
        .toUpperCase(),
    )
    .filter(Boolean);
}

/**
 * Bisa-tidaknya negara dan umur sebuah ad set diubah dari sini.
 *
 * Hanya kalau lokasinya NEGARA SAJA. Ad set yang juga menargetkan wilayah, kota, atau radius
 * menyimpan lokasi yang terikat ke negaranya — mengganti negaranya berisiko bentrok dengan kota
 * yang tersisa, dan yang membetulkannya adalah Ads Manager, bukan kotak isian di sini.
 */
export function targetingState(targeting) {
  if (!targeting || typeof targeting !== "object") {
    return {
      editable: false,
      reason: "Targeting ad set ini tidak terbaca.",
      countries: [],
      ageMin: null,
      ageMax: null,
    };
  }
  const geo = targeting.geo_locations || {};
  const base = {
    countries: upperList(geo.countries),
    ageMin: Number(targeting.age_min) || null,
    ageMax: Number(targeting.age_max) || null,
  };
  const other = Object.keys(geo).filter((key) => !GEO_EDITABLE_KEYS.has(key) && hasValue(geo[key]));
  if (other.length) {
    return {
      ...base,
      editable: false,
      reason: `Lokasi memakai ${other.join(", ")} — ubah di Ads Manager.`,
    };
  }
  if (!base.countries.length) {
    return {
      ...base,
      editable: false,
      reason: "Ad set ini tidak menargetkan negara — ubah di Ads Manager.",
    };
  }
  return { ...base, editable: true, reason: "" };
}

export function normalizeCountries(list) {
  const items = (Array.isArray(list) ? list : String(list || "").split(/[\s,]+/))
    .map((code) =>
      String(code || "")
        .trim()
        .toUpperCase(),
    )
    .filter(Boolean);
  const invalid = items.filter((code) => !/^[A-Z]{2}$/.test(code));
  if (invalid.length)
    throw new RuleError(`Kode negara harus dua huruf ISO: ${invalid.join(", ")}.`);
  const unique = [...new Set(items)];
  if (!unique.length) throw new RuleError("Pilih minimal satu negara.");
  return unique;
}

function parseAge(value, label) {
  const age = Number(value);
  if (!Number.isInteger(age) || age < 18 || age > 65)
    throw new RuleError(`${label} harus 18 sampai 65.`);
  return age;
}

// Targeting BARU dari yang lama: cuma negara dan umur yang diganti, sisanya dikirim utuh. Aman untuk
// Meta yang mengganti seluruh targeting maupun yang menambal.
export function mergeTargeting(targeting, { countries, ageMin, ageMax } = {}) {
  const state = targetingState(targeting);
  if (!state.editable) throw new RuleError(state.reason);
  const next = structuredClone(targeting);
  if (countries !== undefined) {
    next.geo_locations = { ...next.geo_locations, countries: normalizeCountries(countries) };
  }
  const min = ageMin !== undefined ? parseAge(ageMin, "Umur minimum") : Number(next.age_min) || 18;
  const max = ageMax !== undefined ? parseAge(ageMax, "Umur maksimum") : Number(next.age_max) || 65;
  if (min > max) throw new RuleError("Umur minimum tidak boleh lebih besar dari umur maksimum.");
  if (ageMin !== undefined) next.age_min = min;
  if (ageMax !== undefined) next.age_max = max;
  return next;
}

/**
 * Penolakan Meta: salah isian (422) atau salah di sisi kita/Meta (502).
 *
 * Kode 100 adalah parameter yang ditolak — anggaran di bawah minimum, umur tidak sah — kecuali
 * subkode 33, yang di jawaban tulis berarti izin token yang kurang. Token, izin, dan Meta yang
 * tumbang tidak bisa diperbaiki siapa pun di dialog itu, jadi tidak boleh menyamar sebagai
 * kesalahan pengisian.
 */
export function metaFailureStatus(message) {
  const match = /\(#(\d+)(?:-(\d+))?\)/.exec(String(message || ""));
  if (!match) return 502;
  return match[1] === "100" && match[2] !== "33" ? 422 : 502;
}
