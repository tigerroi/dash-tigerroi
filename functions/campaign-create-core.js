import {
  metaOutcomeUncertain,
  normalizeCountries,
  parseBudget,
  RuleError,
} from "./campaign-manage-core.js";
import { matchCode, normalizeName } from "./sync-core.js";

/**
 * Aturan "Buat campaign" (/campaigns → tombol Buat). Murni — tidak ada jaringan dan tidak ada RTDB.
 *
 * Yang diputuskan di sini: bentuk apa yang lahir di Meta. Ia BUKAN form Ads Manager kedua melainkan
 * satu pola — pola yang benar-benar dipakai armada, dibaca dari 196 campaign / 552 ad set / ~460
 * iklan pada 12 Sep 2026 (lihat spec). Tiap kombinasi objective lain menyeret field lain di
 * belakangnya (`promoted_object` berbentuk lain, `destination_type`, `bid_amount`), dan form yang
 * menawarkan semuanya adalah Ads Manager setengah jadi yang satu-satunya keterangannya adalah
 * penolakan Meta.
 *
 * Yang dipilih orang cuma yang benar-benar berbeda antar-campaign: akun, tujuan, anggaran, negara,
 * umur, Halaman, pixel, gambar, CTA, dan teksnya.
 */

// --- Pola armada ------------------------------------------------------------------------------

export const CAMPAIGN_OBJECTIVE = "OUTCOME_LEADS";
export const BUYING_TYPE = "AUCTION";
export const BID_STRATEGY = "LOWEST_COST_WITHOUT_CAP";
export const OPTIMIZATION_GOAL = "OFFSITE_CONVERSIONS";
export const BILLING_EVENT = "IMPRESSIONS";
export const PIXEL_EVENT = "CONTENT_VIEW";
export const AD_FORMAT = "CAROUSEL_IMAGE";

// Ketiganya yang dipakai armada hari ini (WATCH_MORE 290, LEARN_MORE 123, SEE_DETAILS 47). Daftar
// yang lebih panjang berarti menawarkan CTA yang belum pernah diadu dengan objective ini —
// penolakannya baru terbaca sesudah seluruh form diisi.
export const CTA_TYPES = ["WATCH_MORE", "LEARN_MORE", "SEE_DETAILS"];

// Carousel menuntut minimal dua gambar, dan itu bentuk yang terbukti (416 dari ~460 iklan armada).
export const MIN_IMAGES = 2;
export const MAX_IMAGES = 10;
// Satu variasi = satu ad set berisi satu iklan. Armada memakai 1, 5, dan 10.
export const MAX_VARIANTS = 10;
const MAX_NAME = 400;
const MAX_TITLE = 255;
const MAX_BODY = 2000;
const MAX_URL_TAGS = 200;
// Setahun. Jadwal yang lebih jauh hampir selalu tahun yang salah ketik, dan campaign yang mulai
// tayang 2036 tidak berbunyi sebagai kesalahan di mana pun — ia cuma tidak pernah jalan.
const MAX_SCHEDULE_MS = 366 * 24 * 60 * 60 * 1000;

/**
 * Penempatan bawaan armada, disalin apa adanya dari ad set yang sedang berjalan.
 *
 * Facebook saja, mobile saja, dengan Advantage audience menyala — bukan karena itu selalu benar,
 * melainkan karena itu yang sedang dipakai, dan campaign baru yang diam-diam berpenempatan lain
 * menghasilkan angka yang tidak bisa diadu dengan campaign di sebelahnya.
 */
const PLACEMENT = {
  publisher_platforms: ["facebook"],
  facebook_positions: [
    "feed",
    "search",
    "facebook_reels",
    "facebook_reels_overlay",
    "profile_feed",
    "notification",
  ],
  device_platforms: ["mobile"],
  targeting_automation: { advantage_audience: 1 },
  brand_safety_content_filter_levels: ["FACEBOOK_RELAXED"],
  geo_location_types: ["frequently_in", "home", "recent"],
};

export const CREATE_JOBS_PATH = "dashboard/campaignCreateJobs";

// --- Isian yang diperiksa SEBELUM Meta disentuh ------------------------------------------------

/**
 * Nama campaign harus membawa kode subdomain TUJUAN.
 *
 * Berbeda dari `campaignNameVerdict` di tahap 1, yang menanyakan konfirmasi kalau namanya memetakan
 * ke subdomain yang belum terlihat orangnya: di sana link iklannya sudah ada dan tidak bisa diubah,
 * jadi yang bisa dilakukan cuma bertanya. Di sini LINK-nya kita yang tulis, jadi nama yang membawa
 * kode lain pasti salah — ia akan mengirim belanjanya ke subdomain yang tidak pernah diiklankan.
 *
 * `matchCode` yang SAMA dengan sync: aturan yang berbeda berarti dialog menyetujui nama yang oleh
 * sync dipetakan ke tempat lain.
 */
export function createNameVerdict(name, subDomain, byCode) {
  const trimmed = String(name || "").trim();
  if (!trimmed) throw new RuleError("Nama campaign wajib diisi.");
  if (trimmed.length > MAX_NAME)
    throw new RuleError(`Nama campaign terlalu panjang (maks ${MAX_NAME} karakter).`);
  const { subDomain: mapped, code } = matchCode(trimmed, byCode);
  if (!mapped) {
    throw new RuleError(
      code
        ? `Kode "${code}" di nama belum terdaftar di subdomain mana pun — belanjanya tidak akan masuk ROI siapa pun.`
        : "Nama campaign tidak membawa kode Keitaro yang terdaftar — belanjanya tidak akan masuk ROI siapa pun.",
    );
  }
  if (normalizeName(mapped) !== normalizeName(subDomain)) {
    throw new RuleError(
      `Kode ${code} di nama milik ${mapped}, sedangkan iklannya akan mengarah ke ${subDomain}. Belanjanya akan tercatat di subdomain yang salah.`,
    );
  }
  return { name: trimmed, code, subDomain: mapped };
}

/**
 * Link iklan harus salah satu link yang BENAR-BENAR tersimpan di baris subdomain itu.
 *
 * Bukan pencocokan alias yang diulang di sini: yang menyaring link ke kodenya adalah
 * `campaignUrlForCodes` di sisi UI, dan menyalin aturannya ke server berarti dua aturan yang akan
 * berselisih suatu hari. Yang diperiksa server cuma KEANGGOTAAN — link yang tidak ada di baris itu
 * ditolak — dan itu penjagaan yang lebih keras daripada mencocokkan ulang: apa pun yang dikirim
 * dari browser tidak bisa mengarahkan iklan ke tempat yang tidak tertulis di `subDomains`.
 */
export function assertLinkOfSubDomain(row, link) {
  const wanted = String(link || "").trim();
  if (!/^https:\/\/\S+$/i.test(wanted))
    throw new RuleError("Link iklan harus URL https yang lengkap.");
  const known = String(row?.campaignUrl || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  // Diadu pada ALAMATNYA saja, tanpa query: sejak parameter iklan dipisah jadi kotak sendiri, yang
  // dikirim dialog adalah alias telanjang — sementara yang tersimpan di baris subdomain adalah link
  // penuh berikut `?bit=[race]` miliknya. Dicocokkan utuh, tiap pilihan yang sah ditolak. Yang
  // dijaga tidak berubah: TUJUANnya tetap wajib salah satu yang tertulis di `subDomains`.
  const found = known.find((url) => splitLink(url).websiteUrl === splitLink(wanted).websiteUrl);
  if (!found) {
    throw new RuleError(
      known.length
        ? "Link itu bukan salah satu Campaign URL subdomain ini — muat ulang halaman, lalu pilih lagi."
        : "Subdomain ini belum punya Campaign URL — cermin gating belum menemukan campaign Keitaro yang mengarah ke sana.",
    );
  }
  return splitLink(found).websiteUrl;
}

/**
 * Parameter URL iklan (`url_tags` di Meta), dipisah dari alamatnya dan BOLEH diketik.
 *
 * Dipisah karena Meta memisahkannya juga — `link_urls[].website_url` memuat alias telanjang,
 * `url_tags` memuat query-nya — dan karena yang perlu disesuaikan orang cuma bagian ini: alamatnya
 * datang dari cermin gating dan tidak boleh dikarang, penandanya kadang perlu ditambahi (sub id,
 * penanda kreatif). Digabung dalam satu kotak, mengubah satu penanda berarti mengetik ulang seluruh
 * link — dan satu huruf yang meleset di sisi ALAMATNYA mengirim trafik ke tempat yang tidak ada.
 *
 * Bentuknya diperiksa sebagai pasangan `kunci=nilai` dipisah `&`, bukan cuma panjangnya: link penuh
 * yang tertempel ke kotak ini (atau "?" yang ikut tersalin) diterima Meta apa adanya dan menghasilkan
 * URL yang tidak pernah dipasang siapa pun — kegagalan yang cuma terbaca sebagai trafik yang tidak
 * tercatat Keitaro.
 */
export function parseUrlTags(value) {
  const text = String(value ?? "")
    .trim()
    .replace(/^\?+/, "");
  if (!text) return "";
  if (text.length > MAX_URL_TAGS)
    throw new RuleError(`Parameter URL terlalu panjang (maks ${MAX_URL_TAGS} karakter).`);
  // Link penuh yang tertempel ke kotak ini LOLOS pemeriksaan pasangan di bawah — "https://x/y?bit"
  // adalah kunci yang sah dan "[race]" nilainya — jadi bentuk URL-nya ditolak lebih dulu. Yang lahir
  // dari lolosnya bukan error melainkan alamat iklan yang tidak pernah dipasang siapa pun.
  if (/:\/\/|\?/.test(text)) {
    throw new RuleError(
      "Parameter URL memuat alamat, bukan cuma penandanya — yang di sini hanya bagian sesudah tanda ?.",
    );
  }
  const parts = text.split("&");
  if (parts.some((part) => !/^[^=&\s]+=[^&\s]*$/.test(part))) {
    throw new RuleError(
      'Parameter URL harus berbentuk pasangan seperti "bit=[race]", dipisah "&", tanpa spasi dan tanpa "?" di depan.',
    );
  }
  return text;
}

/** Alamat + parameter kembali jadi satu link — bentuk yang disimpan di baris job dan dibaca panel. */
export function joinLink(link, urlTags) {
  const tags = String(urlTags || "");
  return tags ? `${link}?${tags}` : String(link);
}

/**
 * Alias Keitaro dan penandanya dipisah, karena Meta memisahkannya juga.
 *
 * `link_urls[].website_url` memuat alias telanjang dan `url_tags` memuat query-nya — itu bentuk
 * yang dipakai SELURUH iklan armada (`bit=[race]`). Dikirim bergabung, tandanya ikut jadi bagian
 * alias dan Keitaro menerima tautan yang tidak pernah dipasang siapa pun.
 */
export function splitLink(link) {
  const at = String(link).indexOf("?");
  return at === -1
    ? { websiteUrl: String(link), urlTags: "" }
    : { websiteUrl: String(link).slice(0, at), urlTags: String(link).slice(at + 1) };
}

/**
 * Kapan ad set mulai tayang — DITULIS DI AD SET, tidak pernah di campaign.
 *
 * Dibuktikan ke produksi 12 Sep 2026, dua-duanya: `start_time` pada `POST /act_…/campaigns` DITERIMA
 * (200) lalu DIABAIKAN — campaign-nya dibaca ulang dengan `start_time` = jam pembuatannya — sementara
 * di ad set ia tersimpan persis. Yang mengisi `start_time` campaign adalah Meta sendiri, dari ad set
 * yang PALING AWAL (dua ad set 20 dan 25 Sep menghasilkan campaign 20 Sep). Jadi kolom Status di
 * tabel armada berbunyi "Terjadwal" berikut tanggalnya tanpa satu field pun ditulis ke sana.
 *
 * TANGGAL LAMPAU DITOLAK DI SINI, karena Meta menerimanya (200) lalu menjepitnya ke JAM SEKARANG —
 * juga dibuktikan. Yang diketik orang lalu hilang tanpa satu pun pesan adalah kegagalan yang sama
 * dengan enum plugin yang dijawab 200 berisi nilai lama; di sini akibatnya campaign yang dikira
 * terjadwal justru mulai tayang begitu dinyalakan.
 *
 * Zonanya WIB dan ditulis EKSPLISIT (`+07:00`). Kelima belas ad account armada berzona Asia/Jakarta
 * (diperiksa 12 Sep 2026), dan itu juga zona operasi dashboard ini — tapi yang mengetik bisa duduk di
 * zona lain, dan `datetime-local` tidak membawa zona sama sekali. Tanpa offset, satu jam yang sama
 * berarti dua jam berbeda di dua laptop.
 */
export function parseStartTime(value, { now = new Date() } = {}) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const found = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!found) {
    throw new RuleError("Mulai tayang harus berbentuk tanggal (YYYY-MM-DD), boleh berikut jamnya.");
  }
  const [, year, month, day, hour = "00", minute = "00"] = found;
  const stamp = `${year}-${month}-${day}T${hour}:${minute}:00+07:00`;
  const at = new Date(stamp);
  // Tanggal yang tidak ada DIGULIRKAN diam-diam oleh JS, bukan ditolak: "2026-02-30" jadi 2 Maret,
  // dan yang dijadwalkan bergeser dua hari tanpa satu pun tanda. Yang menangkapnya perjalanan bolak-
  // balik — tanggal hasil urai dibaca kembali dalam WIB dan harus sama persis dengan yang diketik.
  const back = Number.isNaN(at.getTime())
    ? ""
    : new Date(at.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
  if (back !== `${year}-${month}-${day}`) {
    throw new RuleError(`Tanggal "${text}" tidak ada di kalender.`);
  }
  if (at.getTime() <= now.getTime()) {
    throw new RuleError(
      "Waktu mulai tayang sudah lewat — Meta akan menayangkannya seketika, bukan pada jam itu. Pilih waktu yang belum lewat, atau kosongkan supaya mulai begitu campaign dinyalakan.",
    );
  }
  if (at.getTime() - now.getTime() > MAX_SCHEDULE_MS) {
    throw new RuleError("Mulai tayang lebih dari setahun dari sekarang — periksa lagi tahunnya.");
  }
  return stamp;
}

function textField(value, { label, max }) {
  const text = String(value ?? "").trim();
  if (!text) throw new RuleError(`${label} wajib diisi.`);
  if (text.length > max) throw new RuleError(`${label} terlalu panjang (maks ${max} karakter).`);
  return text;
}

/**
 * Tiap variasi = satu ad set berisi satu iklan, dan GAMBARNYA MILIK IKLAN ITU.
 *
 * Gambar dulu satu daftar untuk seluruh campaign — kelima iklannya memakai carousel yang sama persis,
 * dan yang diuji cuma teksnya. Itu membuang separuh gunanya: yang paling menentukan hasil sebuah
 * iklan adalah gambarnya, dan lima ad set bergambar identik tidak bisa mengabarkan gambar mana yang
 * bekerja.
 *
 * `fallbackImages` adalah daftar tingkat-campaign dari request LAMA (browser yang bundelnya belum
 * ikut ter-deploy, dan `tools/meta-create-probe.mjs`). Ia dipakai hanya kalau variasinya sendiri
 * tidak membawa gambar: server di-deploy sebelum hosting, dan tanpa ini tiap tab yang sedang terbuka
 * menjawab 422 "Pilih 2 sampai 10 gambar" selama jeda di antaranya.
 */
export function parseVariants(variants, { fallbackImages = [] } = {}) {
  const list = Array.isArray(variants) ? variants : [];
  if (!list.length) throw new RuleError("Isi minimal satu variasi judul + body.");
  if (list.length > MAX_VARIANTS)
    throw new RuleError(`Paling banyak ${MAX_VARIANTS} variasi sekali buat.`);
  const seen = new Map();
  return list.map((variant, index) => {
    const title = textField(variant?.title, {
      label: `Judul variasi ${index + 1}`,
      max: MAX_TITLE,
    });
    const body = textField(variant?.body, { label: `Body variasi ${index + 1}`, max: MAX_BODY });
    const images = parseImages(
      Array.isArray(variant?.images) && variant.images.length ? variant.images : fallbackImages,
      { label: `Gambar iklan ${index + 1}` },
    );
    const key = `${title}\n${body}`.toLowerCase();
    // Dua variasi yang sama persis menghasilkan dua ad set yang tidak bisa dibedakan hasilnya —
    // dan yang membuatnya hampir selalu tempelan yang terlewat, bukan niat. Yang dibandingkan cuma
    // TEKSNYA: dua iklan berteks sama yang bergambar berbeda adalah justru uji yang masuk akal.
    if (seen.has(key)) {
      throw new RuleError(
        `Variasi ${index + 1} sama persis dengan variasi ${seen.get(key) + 1} — ubah judul atau body-nya.`,
      );
    }
    seen.set(key, index);
    return { title, body, images };
  });
}

export function parseImages(images, { label = "Gambar" } = {}) {
  const list = (Array.isArray(images) ? images : [])
    .map((hash) =>
      String(hash || "")
        .trim()
        .toLowerCase(),
    )
    .filter(Boolean);
  const unique = [...new Set(list)];
  if (unique.length !== list.length)
    throw new RuleError(`${label}: ada gambar yang dipilih dua kali.`);
  if (unique.length < MIN_IMAGES || unique.length > MAX_IMAGES) {
    throw new RuleError(`${label}: pilih ${MIN_IMAGES} sampai ${MAX_IMAGES} gambar.`);
  }
  if (unique.some((hash) => !/^[a-f0-9]{8,64}$/.test(hash)))
    throw new RuleError(`${label}: hash gambar tidak berbentuk hash Meta.`);
  return unique;
}

export function parseCta(cta) {
  const value = String(cta || "")
    .trim()
    .toUpperCase();
  if (!CTA_TYPES.includes(value))
    throw new RuleError(`Tombol ajakan harus salah satu dari: ${CTA_TYPES.join(", ")}.`);
  return value;
}

function parseAge(value, label, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const age = Number(value);
  if (!Number.isInteger(age) || age < 18 || age > 65)
    throw new RuleError(`${label} harus 18 sampai 65.`);
  return age;
}

/**
 * Nama ad set (dan iklan di dalamnya) per variasi.
 *
 * MENYIMPANG dari kebiasaan armada, dan itu disengaja: di sana kelima ad set bernama persis sama
 * dengan campaign-nya, dan di panel ad set kita lima baris bernama sama tidak bisa dibedakan satu
 * sama lain — padahal panel itu dibuka justru untuk mencari ad set MANA yang membakar anggaran.
 */
export function variantNames(campaignName, count) {
  return count === 1
    ? [campaignName]
    : Array.from({ length: count }, (_, index) => `${campaignName} #${index + 1}`);
}

/**
 * Seluruh isian dialog, diperiksa sekali, jadi rencana yang tinggal dijalankan.
 *
 * Dipanggil SEBELUM satu panggilan Meta pun: isian yang ditolak berarti nol objek terlanjur lahir,
 * alasan yang sama dengan payload AutoPost yang disusun di depan.
 */
export function createPlan({
  name,
  subDomain,
  link,
  dailyBudget,
  countries,
  ageMin,
  ageMax,
  pageId,
  pixelId,
  images,
  cta,
  variants,
  startTime,
  byCode,
  now = new Date(),
}) {
  const verdict = createNameVerdict(name, subDomain, byCode);
  const parsedVariants = parseVariants(variants, { fallbackImages: images });
  const min = parseAge(ageMin, "Umur minimum", 18);
  const max = parseAge(ageMax, "Umur maksimum", 65);
  if (min > max) throw new RuleError("Umur minimum tidak boleh lebih besar dari umur maksimum.");
  return {
    name: verdict.name,
    code: verdict.code,
    subDomain: verdict.subDomain,
    link: String(link),
    dailyBudget: parseBudget(dailyBudget),
    countries: normalizeCountries(countries),
    ageMin: min,
    ageMax: max,
    pageId: String(pageId || "").trim(),
    pixelId: String(pixelId || "").trim(),
    // Gabungan gambar seluruh iklan, TANPA kembar. Ia tidak dipakai satu payload Meta pun — yang
    // dibaca creative adalah `variant.images` — dan ada semata untuk baris job ("n gambar"): tanpa
    // itu, panel Pekerjaan harus menyebut sepuluh angka untuk satu campaign.
    images: [...new Set(parsedVariants.flatMap((variant) => variant.images))],
    cta: parseCta(cta),
    variants: parsedVariants,
    startTime: parseStartTime(startTime, { now }),
    names: variantNames(verdict.name, parsedVariants.length),
  };
}

// --- Payload Graph -----------------------------------------------------------------------------
//
// Nilai objek DI-JSON-kan di sini, bukan di meta.js: yang di sana cuma mengirimkannya, dan bentuk
// inilah yang diuji.

export function campaignPayload(plan, minorUnit = 1) {
  return {
    name: plan.name,
    objective: CAMPAIGN_OBJECTIVE,
    buying_type: BUYING_TYPE,
    bid_strategy: BID_STRATEGY,
    daily_budget: String(Math.round(plan.dailyBudget * minorUnit)),
    special_ad_categories: JSON.stringify([]),
    // Lahir mati, tanpa pilihan: campaign yang menyala dari sebuah form berarti uang keluar sebelum
    // ada yang melihat hasilnya di layar. Dinyalakan lewat saklar yang sudah ada di tabel.
    status: "PAUSED",
  };
}

export function targetingSpec(plan) {
  return {
    geo_locations: { countries: plan.countries, location_types: PLACEMENT.geo_location_types },
    age_min: plan.ageMin,
    age_max: plan.ageMax,
    publisher_platforms: PLACEMENT.publisher_platforms,
    facebook_positions: PLACEMENT.facebook_positions,
    device_platforms: PLACEMENT.device_platforms,
    targeting_automation: PLACEMENT.targeting_automation,
    brand_safety_content_filter_levels: PLACEMENT.brand_safety_content_filter_levels,
  };
}

export function adSetPayload(plan, { name, campaignId }) {
  const payload = {
    name,
    campaign_id: String(campaignId),
    optimization_goal: OPTIMIZATION_GOAL,
    billing_event: BILLING_EVENT,
    promoted_object: JSON.stringify({
      pixel_id: plan.pixelId,
      custom_event_type: PIXEL_EVENT,
    }),
    targeting: JSON.stringify(targetingSpec(plan)),
    // Anggaran dipegang campaign (CBO) — ad set tidak membawa satu pun angka anggaran.
    is_dynamic_creative: "true",
    status: "PAUSED",
  };
  // Jadwal tinggal DI SINI saja; di campaign ia diabaikan diam-diam (lihat `parseStartTime`). Yang
  // kosong tidak dikirim sama sekali: ad set tanpa `start_time` mulai begitu ia dinyalakan, dan
  // mengirim jam sekarang berarti menuliskan jadwal yang artinya sama dengan tidak ada jadwal.
  if (plan.startTime) payload.start_time = plan.startTime;
  return payload;
}

export function creativePayload(plan, { name, variant }) {
  const { websiteUrl, urlTags } = splitLink(plan.link);
  const assetFeedSpec = {
    // Gambar IKLAN INI, bukan gambar campaign: tiap ad set punya carousel-nya sendiri.
    images: variant.images.map((hash) => ({ hash })),
    titles: [{ text: variant.title }],
    bodies: [{ text: variant.body }],
    // Armada mengirim deskripsi kosong; dihilangkan sama sekali, Meta mengisi sendiri dari Halaman.
    descriptions: [{ text: "" }],
    link_urls: [{ website_url: websiteUrl }],
    call_to_action_types: [plan.cta],
    ad_formats: [AD_FORMAT],
  };
  const payload = {
    name,
    // Halaman tinggal di `object_story_spec`, TIDAK di asset_feed_spec: yang kedua memuat bahan
    // kreatifnya, yang pertama menyebut siapa yang beriklan.
    object_story_spec: JSON.stringify({ page_id: plan.pageId }),
    asset_feed_spec: JSON.stringify(assetFeedSpec),
  };
  if (urlTags) payload.url_tags = urlTags;
  return payload;
}

/**
 * Satu iklan, menunjuk creative yang sudah ada.
 *
 * Dipakai DUA jalur: campaign yang dibuat dari nol (creative-nya baru lahir sedetik sebelumnya) dan
 * PEMULIHAN iklan salinan, yang menunjuk creative iklan sumber apa adanya. Karena itu statusnya bisa
 * dioper: yang lahir dari nol selalu PAUSED (uang tidak boleh keluar dari sebuah form), sementara
 * yang dipulihkan mengikuti saklar iklan sumbernya — sepola `INHERITED_FROM_SOURCE` di salinan ad
 * set-nya. Dipaksa PAUSED, ia jadi satu-satunya iklan mati di dalam ad set yang menyala, yaitu persis
 * keadaan "ad set aktif tapi Rp 0" yang panel ad set ada untuk menerangkannya.
 */
export function adPayload({ name, adSetId, creativeId, status = "PAUSED" }) {
  return {
    name,
    adset_id: String(adSetId),
    creative: JSON.stringify({ creative_id: String(creativeId) }),
    status: status === "ACTIVE" ? "ACTIVE" : "PAUSED",
  };
}

// --- Job ---------------------------------------------------------------------------------------

const ACTIVE = new Set(["requested", "running"]);

export function createJobEntry({ plan, account, requestedBy, now = new Date() }) {
  const at = now.toISOString();
  return {
    accountId: String(account.id),
    actId: String(account.actId || ""),
    accountName: String(account.name || ""),
    name: plan.name,
    subDomain: plan.subDomain,
    code: plan.code,
    link: plan.link,
    pageId: plan.pageId,
    pixelId: plan.pixelId,
    variants: plan.names.length,
    images: plan.images.length,
    // Rencana UTUH yang sudah lolos pemeriksaan, supaya job `partial` bisa DILANJUTKAN tanpa mengisi
    // ulang formnya (`resumeCreatePlan`). Teks JSON, bukan pohon: ia cuma dibaca balik utuh oleh
    // server, dan pohon berarti aturan database untuk tiap field-nya.
    plan: JSON.stringify(plan),
    state: "requested",
    requestedBy: String(requestedBy || ""),
    requestedAt: at,
    updatedAt: at,
  };
}

// Satu nama campaign, satu job: dua job yang menuju nama yang sama akan melahirkan dua campaign
// bernama sama, dan sync melebur keduanya jadi satu baris (lihat `assertNamesFree`).
export function activeCreateJob(jobs, accountId, name) {
  const key = normalizeName(name);
  const found = Object.entries(jobs || {}).find(
    ([, job]) =>
      ACTIVE.has(job?.state) &&
      String(job?.accountId) === String(accountId) &&
      normalizeName(job?.name) === key,
  );
  return found ? found[0] : "";
}

// Nama yang AKAN lahir dari job buat yang masih berjalan — belum ada di daftar campaign Meta, dan
// dua job yang menuju nama yang sama baru ketahuan bentrok sesudah keduanya lahir.
export function pendingCreateNames(jobs, accountId) {
  return Object.values(jobs || {})
    .filter((job) => ACTIVE.has(job?.state) && String(job?.accountId) === String(accountId))
    .map((job) => ({ id: "", name: job.name }));
}

/**
 * Hasil satu job buat, diturunkan dari catatan ad set-nya sendiri.
 *
 * `partial` untuk campaign yang lahir tanpa seluruh iklannya — dan campaign itu TETAP disebutkan
 * ID-nya, bukan dihapus diam-diam: membersihkan sendiri berarti menghapus objek Meta atas keputusan
 * yang tidak diminta siapa pun, dan yang sudah lahir bisa dibereskan orang di Ads Manager.
 */
export function createOutcome({ campaignId, campaignError, uncertain, adSets = [] }) {
  if (!campaignId) {
    return uncertain
      ? {
          state: "unknown",
          error:
            campaignError ||
            "Server tidak tahu apakah campaign-nya sudah lahir — periksa Ads Manager sebelum membuat lagi.",
        }
      : { state: "failed", error: campaignError || "Meta tidak membuat campaign." };
  }
  const born = adSets.filter((row) => row?.adId).length;
  if (born === adSets.length && born > 0) return { state: "done", error: "" };
  const reason = adSets.find((row) => row?.error)?.error || "";
  return {
    state: "partial",
    error: `${born} dari ${adSets.length} iklan lahir; campaign ${campaignId} berdiri PAUSED di Meta.${reason ? ` ${reason}` : ""}`,
  };
}

/**
 * Rencana job `partial` yang boleh dilanjutkan, atau RuleError berikut sebabnya.
 *
 * Yang dilanjutkan cuma variasi yang BELUM punya iklan — dan bukan yang gagal dengan hasil TIDAK
 * PASTI (`metaOutcomeUncertain`): ad set-nya bisa saja sudah lahir di Meta tanpa ID di job ini, dan
 * membuatnya lagi melahirkan kembarannya. Yang begitu tetap berdiri dengan sebabnya.
 *
 * Jadwal mulai yang SUDAH LEWAT ditolak, alasan yang sama dengan `parseStartTime`: Meta menerimanya
 * lalu menjepitnya ke jam sekarang, dan ad set yang lahir belakangan diam-diam berbeda jadwal dari
 * saudaranya.
 */
export function resumeCreatePlan(job, now = new Date()) {
  if (job?.state !== "partial") {
    throw new RuleError("Hanya pekerjaan yang selesai SEBAGIAN yang bisa dilanjutkan.");
  }
  if (!job.campaignId) throw new RuleError("Campaign pekerjaan ini tidak pernah lahir.");
  let plan;
  try {
    plan = JSON.parse(job.plan || "");
  } catch {
    throw new RuleError(
      "Pekerjaan ini dibuat sebelum bisa dilanjutkan — rencananya tidak tersimpan. Buat iklan yang kurang di Ads Manager.",
    );
  }
  if (plan.startTime && Date.parse(plan.startTime) <= now.getTime()) {
    throw new RuleError(
      "Jadwal mulai pekerjaan ini sudah lewat, dan Meta akan menjepit ad set baru ke jam sekarang. Buat iklan yang kurang di Ads Manager.",
    );
  }
  const rows = Array.isArray(job.adSets) ? job.adSets : Object.values(job.adSets || {});
  const adSets = plan.names.map((name, index) => ({ name, ...(rows[index] || {}) }));
  const todo = adSets.filter((row) => !row.adId && !metaOutcomeUncertain(row.error));
  if (!todo.length) {
    throw new RuleError(
      "Tidak ada yang bisa dilanjutkan: variasi yang kurang gagal dengan hasil tidak pasti — periksa Ads Manager.",
    );
  }
  return { plan, campaignId: job.campaignId, adSets };
}
