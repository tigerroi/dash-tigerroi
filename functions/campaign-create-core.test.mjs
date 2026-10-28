import assert from "node:assert/strict";
import test from "node:test";
import {
  activeCreateJob,
  adPayload,
  adSetPayload,
  assertLinkOfSubDomain,
  campaignPayload,
  createJobEntry,
  createNameVerdict,
  createOutcome,
  createPlan,
  creativePayload,
  joinLink,
  MAX_VARIANTS,
  parseCta,
  parseImages,
  parseStartTime,
  parseUrlTags,
  parseVariants,
  pendingCreateNames,
  splitLink,
  targetingSpec,
  variantNames,
} from "./campaign-create-core.js";
import { RuleError } from "./campaign-manage-core.js";
import { buildCodeIndex } from "./sync-core.js";

const { byCode } = buildCodeIndex({
  a: { name: "puppy.petcins.com", campaignCodes: "TvH1" },
  b: { name: "dog.petcins.com", campaignCodes: "5rx7" },
});

const LINK = "https://rabbitracing.live/ZLgYTvH1?bit=[race]";
const IMAGES = ["655f6c906d879542426cda089148081c", "d16335b38b494ba385d99443ecb3701f"];
const OTHER_IMAGES = ["aa11bb22cc33dd44ee55ff6600778899", "1122334455667788990011223344556f"];
// Tiap variasi membawa gambarnya SENDIRI: satu ad set, satu iklan, satu carousel.
const VARIANTS = [
  { title: "Watch Movies in HD", body: "HD streaming made simple.", images: IMAGES },
  { title: "Start Streaming Today", body: "Watch what you want.", images: OTHER_IMAGES },
];

const PLAN_INPUT = {
  name: "TvH1-01 Pros MEA Carrou SM 01 2 Adset",
  subDomain: "puppy.petcins.com",
  link: LINK,
  dailyBudget: 20000,
  countries: ["sa", "TR"],
  ageMin: 18,
  ageMax: 65,
  pageId: "1273663929164175",
  pixelId: "1810179687086885",
  images: IMAGES,
  cta: "WATCH_MORE",
  variants: VARIANTS,
  byCode,
};

const plan = () => createPlan(PLAN_INPUT);

test("nama wajib membawa kode subdomain TUJUAN, bukan kode mana pun", () => {
  assert.equal(createNameVerdict("TvH1-01 Pros", "puppy.petcins.com", byCode).code, "tvh1");
  // Kode terdaftar, tapi milik subdomain lain: link-nya kita yang tulis, jadi ini pasti salah.
  assert.throws(
    () => createNameVerdict("5rx7-01 Pros", "puppy.petcins.com", byCode),
    /milik dog\.petcins\.com.*mengarah ke puppy\.petcins\.com/,
  );
  assert.throws(() => createNameVerdict("Pros MEA 01", "puppy.petcins.com", byCode), RuleError);
  assert.throws(
    () => createNameVerdict("zzzz-01 Pros", "puppy.petcins.com", byCode),
    /belum terdaftar/,
  );
});

test("link harus salah satu Campaign URL yang tersimpan di baris subdomain itu", () => {
  const row = { campaignUrl: `${LINK}, https://rabbitracing.live/aa5rx7?bit=[race]` };
  // Yang dikembalikan ALAMATNYA saja: parameternya punya kotak sendiri di dialog, dan yang disimpan
  // di baris subdomain adalah link penuh berikut penandanya.
  assert.equal(assertLinkOfSubDomain(row, LINK), "https://rabbitracing.live/ZLgYTvH1");
  // Alamat telanjang (yang benar-benar dikirim dialog) diterima, dan begitu juga penanda yang lain:
  // yang diadu cuma tujuannya.
  assert.equal(
    assertLinkOfSubDomain(row, "https://rabbitracing.live/ZLgYTvH1"),
    "https://rabbitracing.live/ZLgYTvH1",
  );
  assert.equal(
    assertLinkOfSubDomain(row, "https://rabbitracing.live/ZLgYTvH1?bit=[race]&sub=1"),
    "https://rabbitracing.live/ZLgYTvH1",
  );
  // Link yang tidak tertulis di barisnya tidak pernah dipercaya, walau bentuknya meyakinkan.
  assert.throws(
    () => assertLinkOfSubDomain(row, "https://rabbitracing.live/palsu?bit=[race]"),
    /bukan salah satu Campaign URL/,
  );
  assert.throws(() => assertLinkOfSubDomain({}, LINK), /belum punya Campaign URL/);
  assert.throws(() => assertLinkOfSubDomain(row, "rabbitracing.live/x"), /URL https/);
});

test("parameter URL: pasangan kunci=nilai, tanpa ? dan tanpa spasi", () => {
  assert.equal(parseUrlTags(" bit=[race] "), "bit=[race]");
  // "?" yang ikut tersalin dibuang alih-alih ditolak: ia tempelan yang tidak mengubah maksud orangnya.
  assert.equal(parseUrlTags("?bit=[race]&sub1=fb"), "bit=[race]&sub1=fb");
  assert.equal(parseUrlTags(""), "", "dikosongkan berarti iklannya tanpa url_tags");
  assert.equal(parseUrlTags(undefined), "");
  // Link penuh yang tertempel ke kotak parameter diterima Meta apa adanya dan menghasilkan URL yang
  // tidak pernah dipasang siapa pun — jadi bentuknya ditolak di sini.
  assert.throws(() => parseUrlTags("https://rabbitracing.live/x?bit=[race]"), /memuat alamat/);
  assert.throws(() => parseUrlTags("bit [race]"), /pasangan seperti/);
  assert.throws(() => parseUrlTags("bit"), /pasangan seperti/);
  assert.throws(() => parseUrlTags("a=1".repeat(100)), /terlalu panjang/);
});

test("alamat dan parameter kembali jadi satu link untuk baris job", () => {
  assert.equal(joinLink("https://x/y", "bit=[race]"), "https://x/y?bit=[race]");
  assert.equal(joinLink("https://x/y", ""), "https://x/y");
});

test("alias dan penandanya dipisah — url_tags tidak boleh ikut jadi bagian alias", () => {
  assert.deepEqual(splitLink(LINK), {
    websiteUrl: "https://rabbitracing.live/ZLgYTvH1",
    urlTags: "bit=[race]",
  });
  assert.deepEqual(splitLink("https://rabbitracing.live/ZLgYTvH1"), {
    websiteUrl: "https://rabbitracing.live/ZLgYTvH1",
    urlTags: "",
  });
});

test("jadwal: ditulis WIB, yang lampau ditolak, yang kosong berarti tanpa jadwal", () => {
  const now = new Date("2026-09-12T08:00:00Z"); // 15:00 WIB
  assert.equal(parseStartTime("2026-09-20T01:59", { now }), "2026-09-20T01:59:00+07:00");
  // Tanggal saja jatuh ke tengah malam WIB.
  assert.equal(parseStartTime("2026-09-20", { now }), "2026-09-20T00:00:00+07:00");
  assert.equal(parseStartTime("", { now }), "");
  assert.equal(parseStartTime(undefined, { now }), "");
  // Meta MENERIMA waktu lampau (200) lalu menjepitnya ke jam sekarang — jadwal yang diketik orang
  // hilang tanpa satu pun pesan, dan itu yang ditolak di sini.
  assert.throws(() => parseStartTime("2026-09-12T14:00", { now }), /sudah lewat/);
  assert.throws(() => parseStartTime("2026-09-01", { now }), /sudah lewat/);
  // Tahun yang salah ketik tidak berbunyi sebagai kesalahan di mana pun — campaign-nya cuma tidak
  // pernah jalan.
  assert.throws(() => parseStartTime("2036-01-01", { now }), /lebih dari setahun/);
  assert.throws(() => parseStartTime("20 Sep 2026", { now }), /berbentuk tanggal/);
  // Tanggal yang tidak ada digulirkan diam-diam oleh JS (2026-11-31 jadi 1 Desember), jadi yang
  // menangkapnya perjalanan bolak-balik, bukan Invalid Date.
  assert.throws(() => parseStartTime("2026-11-31", { now }), /tidak ada di kalender/);
  assert.throws(() => parseStartTime("2026-13-01", { now }), /tidak ada di kalender/);
});

test("jadwal tinggal di AD SET, tidak pernah di campaign", () => {
  const now = new Date("2026-09-12T08:00:00Z");
  const plan = createPlan({ ...PLAN_INPUT, startTime: "2026-09-20T01:59", now });
  assert.equal(plan.startTime, "2026-09-20T01:59:00+07:00");
  assert.equal(
    adSetPayload(plan, { name: "A", campaignId: "9" }).start_time,
    "2026-09-20T01:59:00+07:00",
  );
  // Dibuktikan ke produksi: `start_time` di campaign diterima 200 lalu diabaikan — campaign-nya
  // dibaca ulang dengan jam pembuatannya. Meta mengisinya sendiri dari ad set paling awal.
  assert.equal(campaignPayload(plan, 1).start_time, undefined);
  // Tanpa jadwal, field-nya tidak dikirim sama sekali: mengirim jam sekarang berarti menuliskan
  // jadwal yang artinya sama dengan tidak ada jadwal.
  const bare = createPlan({ ...PLAN_INPUT, now });
  assert.equal(bare.startTime, "");
  assert.equal(adSetPayload(bare, { name: "A", campaignId: "9" }).start_time, undefined);
});

test("variasi: wajib ada, terbatas, dan tidak boleh kembar persis", () => {
  const parsed = parseVariants(VARIANTS);
  assert.equal(parsed.length, 2);
  // Gambar tiap iklan berdiri sendiri — itu seluruh gunanya satu variasi = satu ad set.
  assert.deepEqual(parsed[0].images, IMAGES);
  assert.deepEqual(parsed[1].images, OTHER_IMAGES);
  assert.throws(() => parseVariants([]), /minimal satu variasi/);
  const many = Array.from({ length: MAX_VARIANTS + 1 }, (_, i) => ({
    title: `t${i}`,
    body: "b",
    images: IMAGES,
  }));
  assert.throws(() => parseVariants(many), /Paling banyak 10 variasi/);
  assert.throws(
    () => parseVariants([{ title: "", body: "b", images: IMAGES }]),
    /Judul variasi 1 wajib diisi/,
  );
  assert.throws(
    () => parseVariants([VARIANTS[0], { ...VARIANTS[0] }]),
    /Variasi 2 sama persis dengan variasi 1/,
  );
  // Teks yang sama dengan GAMBAR berbeda justru uji yang masuk akal, jadi ia tidak ditolak.
  assert.equal(parseVariants([VARIANTS[0], { ...VARIANTS[0], title: "Lain" }]).length, 2);
  // Iklan yang belum dipilih gambarnya disebut NOMORNYA: "pilih 2 sampai 10 gambar" untuk form
  // sepuluh iklan tidak memberi tahu iklan mana yang kurang.
  assert.throws(
    () => parseVariants([{ ...VARIANTS[0], images: [IMAGES[0]] }]),
    /Gambar iklan 1: pilih 2 sampai 10 gambar/,
  );
  // Request lama (bundel browser yang belum ikut ter-deploy) mengirim gambar di tingkat campaign.
  assert.deepEqual(
    parseVariants([{ title: "a", body: "b" }], { fallbackImages: IMAGES })[0].images,
    IMAGES,
  );
});

test("gambar: 2 sampai 10, tanpa kembar, dan berbentuk hash Meta", () => {
  assert.deepEqual(parseImages(IMAGES), IMAGES);
  assert.throws(() => parseImages([IMAGES[0]]), /pilih 2 sampai 10 gambar/);
  assert.throws(() => parseImages([IMAGES[0], IMAGES[0]]), /dipilih dua kali/);
  assert.throws(() => parseImages([IMAGES[0], "bukan hash!"]), /tidak berbentuk hash Meta/);
  // Labelnya bisa menyebut iklan yang mana.
  assert.throws(() => parseImages([], { label: "Gambar iklan 3" }), /^.*Gambar iklan 3: pilih/);
});

test("CTA cuma yang dipakai armada", () => {
  assert.equal(parseCta("watch_more"), "WATCH_MORE");
  assert.throws(() => parseCta("SHOP_NOW"), /WATCH_MORE, LEARN_MORE, SEE_DETAILS/);
});

test("nama ad set diberi akhiran saat variasinya lebih dari satu", () => {
  assert.deepEqual(variantNames("TvH1-01", 1), ["TvH1-01"]);
  assert.deepEqual(variantNames("TvH1-01", 2), ["TvH1-01 #1", "TvH1-01 #2"]);
});

test("umur terbalik ditolak sebelum Meta disentuh", () => {
  assert.throws(
    () => createPlan({ ...{ ...planArgs(), ageMin: 50, ageMax: 30 } }),
    /Umur minimum tidak boleh lebih besar/,
  );
});

function planArgs() {
  return {
    name: "TvH1-01 Pros",
    subDomain: "puppy.petcins.com",
    link: LINK,
    dailyBudget: 20000,
    countries: ["ID"],
    pageId: "1",
    pixelId: "2",
    images: IMAGES,
    cta: "WATCH_MORE",
    variants: VARIANTS,
    byCode,
  };
}

test("payload campaign: CBO, PAUSED, dan satuan terkecil mata uang akun", () => {
  const payload = campaignPayload(plan(), 1);
  assert.equal(payload.objective, "OUTCOME_LEADS");
  assert.equal(payload.daily_budget, "20000");
  assert.equal(payload.status, "PAUSED");
  assert.equal(payload.bid_strategy, "LOWEST_COST_WITHOUT_CAP");
  assert.equal(JSON.parse(payload.special_ad_categories).length, 0);
  // Mata uang bersen: angka yang sama harus dikali seratus, bukan dikirim apa adanya.
  assert.equal(campaignPayload(plan(), 100).daily_budget, "2000000");
});

test("payload ad set: pixel, dynamic creative, PAUSED, dan TANPA anggaran (CBO)", () => {
  const payload = adSetPayload(plan(), { name: "TvH1-01 #1", campaignId: "120" });
  assert.equal(payload.campaign_id, "120");
  assert.equal(payload.optimization_goal, "OFFSITE_CONVERSIONS");
  assert.equal(payload.is_dynamic_creative, "true");
  assert.equal(payload.status, "PAUSED");
  assert.deepEqual(JSON.parse(payload.promoted_object), {
    pixel_id: "1810179687086885",
    custom_event_type: "CONTENT_VIEW",
  });
  assert.equal(payload.daily_budget, undefined);
  assert.equal(payload.lifetime_budget, undefined);
});

test("targeting: negara dinormalkan, umur ikut, penempatan bawaan armada", () => {
  const targeting = targetingSpec(plan());
  assert.deepEqual(targeting.geo_locations.countries, ["SA", "TR"]);
  assert.equal(targeting.age_min, 18);
  assert.deepEqual(targeting.publisher_platforms, ["facebook"]);
  assert.deepEqual(targeting.device_platforms, ["mobile"]);
  assert.equal(targeting.targeting_automation.advantage_audience, 1);
});

test("payload creative: Halaman di object_story_spec, url_tags terpisah dari alias", () => {
  const payload = creativePayload(plan(), { name: "TvH1-01 #1", variant: VARIANTS[0] });
  assert.deepEqual(JSON.parse(payload.object_story_spec), { page_id: "1273663929164175" });
  assert.equal(payload.url_tags, "bit=[race]");
  const feed = JSON.parse(payload.asset_feed_spec);
  assert.deepEqual(feed.link_urls, [{ website_url: "https://rabbitracing.live/ZLgYTvH1" }]);
  assert.deepEqual(
    feed.images,
    IMAGES.map((hash) => ({ hash })),
  );
  assert.deepEqual(feed.titles, [{ text: "Watch Movies in HD" }]);
  assert.deepEqual(feed.ad_formats, ["CAROUSEL_IMAGE"]);
  // Halaman tidak boleh bocor ke bahan kreatifnya.
  assert.equal(feed.page_id, undefined);
});

test("payload iklan menunjuk creative yang sudah lahir, dan lahir PAUSED", () => {
  const payload = adPayload({ name: "x", adSetId: "1", creativeId: "2" });
  assert.equal(payload.adset_id, "1");
  assert.deepEqual(JSON.parse(payload.creative), { creative_id: "2" });
  assert.equal(payload.status, "PAUSED");
});

test("satu nama, satu job: yang kembar ditemukan sebelum campaign kedua lahir", () => {
  const jobs = {
    j1: { state: "running", accountId: "acc", name: "TvH1-01 Pros" },
    j2: { state: "done", accountId: "acc", name: "Lama" },
  };
  assert.equal(activeCreateJob(jobs, "acc", "tvh1-01 pros"), "j1");
  assert.equal(activeCreateJob(jobs, "acc", "Lain"), "");
  assert.equal(activeCreateJob(jobs, "lain", "TvH1-01 Pros"), "");
  // Nama job yang masih berjalan diadu dengan daftar campaign Meta: ia belum ada di sana.
  assert.deepEqual(pendingCreateNames(jobs, "acc"), [{ id: "", name: "TvH1-01 Pros" }]);
});

test("catatan job memuat tujuan iklannya, supaya panel tidak perlu menebak", () => {
  const entry = createJobEntry({
    plan: plan(),
    account: { id: "acc", actId: "act_1", name: "BD - R42" },
    requestedBy: "admin@rabbitracing.live",
    now: new Date("2026-09-12T03:00:00.000Z"),
  });
  assert.equal(entry.state, "requested");
  assert.equal(entry.subDomain, "puppy.petcins.com");
  assert.equal(entry.code, "tvh1");
  assert.equal(entry.variants, 2);
  assert.equal(entry.requestedAt, "2026-09-12T03:00:00.000Z");
});

test("hasil job: campaign yang lahir tanpa seluruh iklannya PARTIAL, dan ID-nya disebutkan", () => {
  assert.deepEqual(createOutcome({ campaignId: "120", adSets: [{ adId: "1" }, { adId: "2" }] }), {
    state: "done",
    error: "",
  });
  const partial = createOutcome({
    campaignId: "120",
    adSets: [{ adId: "1" }, { adId: "", error: "creative ditolak" }],
  });
  assert.equal(partial.state, "partial");
  assert.match(
    partial.error,
    /1 dari 2 iklan lahir; campaign 120 berdiri PAUSED.*creative ditolak/,
  );
  // Campaign yang tidak lahir sama sekali: gagal, bukan partial.
  assert.equal(createOutcome({ campaignId: "", campaignError: "ditolak" }).state, "failed");
  // Yang tidak pasti tidak boleh berbunyi "gagal": campaign-nya mungkin sudah lahir.
  const unknown = createOutcome({ campaignId: "", uncertain: true, campaignError: "" });
  assert.equal(unknown.state, "unknown");
  assert.match(unknown.error, /periksa Ads Manager/);
});
