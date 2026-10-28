import assert from "node:assert";

const {
  GPT_BODY_FIELDS,
  GPT_LOADER,
  buildGptTags,
  mergeGptHeader,
  gamAccountForSite,
  gptDivPrefix,
  gptStampClock,
  normalizeGptDivStamp,
  normalizeGptDivStamps,
  gptUnitChoices,
  normalizeGptOptions,
  normalizeGptSpec,
  parseGptSizes,
  pickGptUnit,
  planGptBodies,
} = await import("./gpt-inject-core.js");
const { PluginError } = await import("./plugin-core.js");

// --- Contoh nyata dari Ad Manager (14 Sep 2026) ------------------------------------------------

const AD_MANAGER_SIZES =
  "[[300, 100], [168, 42], [728, 90], [750, 200], [216, 54], [336, 280], [768, 1024], [1024, 768], [120, 20], [300, 250], [234, 60], [120, 600], [168, 28], [240, 400], [300, 75], [120, 240], [320, 100], [300, 50], [120, 90], [88, 31], [160, 600], [320, 480], [250, 250], [320, 50], [750, 100], [970, 90], [180, 150], [120, 30], [300, 600], [200, 200], [216, 36], [125, 125], [250, 360], [468, 60], [750, 300]]";

const HEADER_1 = `<script async src="https://securepubads.g.doubleclick.net/tag/js/gpt.js" crossorigin="anonymous"></script>
<script>
  window.googletag = window.googletag || {cmd: []};
  googletag.cmd.push(function() {
    googletag.defineSlot('/23352267851/ca-pub-9198385730397674-tag', ${AD_MANAGER_SIZES}, 'div-gpt-ad-1789368958539-0').addService(googletag.pubads());
    googletag.enableServices();
  });
</script>`;

const BODY_1 = `<!-- /23352267851/ca-pub-9198385730397674-tag -->
<div id='div-gpt-ad-1789368958539-0' style='min-width: 88px; min-height: 20px;'>
  <script>
    googletag.cmd.push(function() { googletag.display('div-gpt-ad-1789368958539-0'); });
  </script>
</div>`;

// Hasil "Generate 3x" di adxdev.adsgo.live untuk header di atas — acuan bentuknya.
const HEADER_3_BODY = [0, 1, 2]
  .map(
    (i) =>
      `    googletag.defineSlot('/23352267851/ca-pub-9198385730397674-tag', ${AD_MANAGER_SIZES}, 'div-gpt-ad-1789368958539-${i}').addService(googletag.pubads());`,
  )
  .join("\n");

// Ukuran unit, bukan hasil urai tempelan: tab ini tidak lagi menerima kode tempelan.
const parsed = {
  adUnitPath: "/23352267851/ca-pub-9198385730397674-tag",
  divPrefix: "div-gpt-ad-1789368958539",
  sizes: parseGptSizes(AD_MANAGER_SIZES).join(","),
};
assert.equal(parsed.sizes.split(",").length, 35);

const spec = normalizeGptSpec({ ...parsed, slots: 3 });
const tags = buildGptTags(spec);

// Header yang ditulis = header Ad Manager 3 slot, TANPA penanda komentar. Tidak satu karakter pun
// berbeda — yang mengadunya dengan layar Generate tags di Ad Manager harus melihat tag yang sama.
assert.equal(
  tags.header,
  `${GPT_LOADER}
<script>
  window.googletag = window.googletag || {cmd: []};
  googletag.cmd.push(function() {
${HEADER_3_BODY}
    googletag.enableServices();
  });
</script>`,
);

// Body 1 sama persis dengan yang di-generate Ad Manager, termasuk min-width/min-height 88x20 —
// sisi terkecil di antara 35 ukurannya ([88, 31] dan [120, 20]).
assert.equal(tags.bodies.length, 3);
assert.equal(tags.bodies[0], BODY_1);
assert.equal(tags.bodies[2], BODY_1.replaceAll("-0'", "-2'"));

// --- Akun GAM & unit iklan (bentuk jawaban Ad Manager API v1, dibaca 14 Sep 2026) ---------------

const GAM = {
  a1: {
    name: "designingaround.com",
    networkCode: 23352267851,
    publisherId: "ca-pub-8660742543707970",
  },
  a2: { name: "petcins.com", networkCode: 23355628943 },
  a3: { name: "", networkCode: 23342108020 },
  a4: { name: "lama.com", networkCode: 1, deletedAt: "2026-01-01" },
};
assert.equal(
  gamAccountForSite(
    { name: "credit.designingaround.com", parentDomain: "designingaround.com" },
    GAM,
  ).id,
  "a1",
);
// Tanpa parentDomain: akhiran hostname, satu akun yang cocok.
assert.equal(gamAccountForSite({ name: "care.petcins.com" }, GAM).id, "a2");
assert.throws(
  () => gamAccountForSite({ name: "furniture.dekadeko.com", parentDomain: "dekadeko.com" }, GAM),
  PluginError,
);
assert.throws(() => gamAccountForSite({ name: "x.lama.com" }, GAM), PluginError);
assert.throws(
  () =>
    gamAccountForSite(
      { name: "a.petcins.com" },
      { ...GAM, b: { name: "petcins.com", networkCode: 9 } },
    ),
  PluginError,
);

const PROPERTY = {
  parentAdUnit: "networks/23352267851/adUnits/23351267854",
  adUnitCode: "ca-pub-8660742543707970",
};
const UNITS = [
  { adUnitCode: "23352267851", hasChildren: true, status: "ACTIVE" },
  { adUnitCode: "ca-pub-8660742543707970", hasChildren: true, status: "ACTIVE" },
  {
    adUnitCode: "ca-pub-9198385730397674-tag",
    displayName: "Ad Exchange Display",
    status: "ACTIVE",
    parentPath: [PROPERTY],
    adUnitSizes: [
      { size: { width: 88, height: 31, sizeType: "PIXEL" }, environmentType: "BROWSER" },
      { size: { width: 300, height: 250, sizeType: "PIXEL" }, environmentType: "BROWSER" },
    ],
  },
  { adUnitCode: "ca-mb-app-pub-9198385730397674-tag", status: "ACTIVE", parentPath: [PROPERTY] },
  { adUnitCode: "Offerwall-Ad-Unit-32627a301cc6e598", status: "ACTIVE", parentPath: [PROPERTY] },
  { adUnitCode: "header", displayName: "header", status: "ACTIVE", parentPath: [PROPERTY] },
  { adUnitCode: "pola1", status: "ARCHIVED", parentPath: [PROPERTY] },
];
const choices = gptUnitChoices(23352267851, UNITS);
assert.deepEqual(
  choices.map((unit) => unit.adUnitCode),
  ["ca-pub-9198385730397674-tag", "header"],
);
// Path persis tag Ad Manager: tanpa level properti ca-pub-8660742543707970.
assert.equal(choices[0].path, "/23352267851/ca-pub-9198385730397674-tag");
assert.equal(choices[0].sizes, "88x31,300x250");
assert.equal(choices[1].path, "/23352267851/header");

assert.equal(pickGptUnit(23352267851, choices).adUnitCode, "ca-pub-9198385730397674-tag");
assert.equal(pickGptUnit(23352267851, choices, "header").path, "/23352267851/header");
assert.throws(() => pickGptUnit(23352267851, choices, "punya-network-lain"), PluginError);
assert.throws(() => pickGptUnit(1, choices.slice(1)), PluginError);
assert.equal(gptDivPrefix("1789368958539"), "div-gpt-ad-1789368958539");
assert.equal(normalizeGptDivStamp("", 1789368958539.7), "1789368958539");
assert.match(gptDivPrefix(""), /^div-gpt-ad-\d{13}$/);
assert.throws(() => normalizeGptDivStamp("123'); alert(1"), PluginError);
assert.throws(() => normalizeGptDivStamp("12345"), PluginError);
// Satu stempel per subdomain: jam yang sama tetap menghasilkan angka berbeda dan selalu naik.
const clock = gptStampClock(() => 1789368958539);
assert.deepEqual([clock(), clock(), clock()], ["1789368958539", "1789368958540", "1789368958541"]);
assert.deepEqual(normalizeGptDivStamps({ a: "1789368958539", b: "", c: undefined }), {
  a: "1789368958539",
});
assert.throws(() => normalizeGptDivStamps({ a: "1'); alert(1" }), PluginError);

// --- Ukuran -------------------------------------------------------------------------------------

assert.deepEqual(parseGptSizes("300x250, 728X90\n320×50 fluid"), [
  "300x250",
  "728x90",
  "320x50",
  "fluid",
]);
assert.deepEqual(parseGptSizes("[[300, 250], [728, 90]]"), ["300x250", "728x90"]);
assert.deepEqual(parseGptSizes("300x250,300x250"), ["300x250"]);
for (const bad of ["", "300x", "300-250", "0x250", "5000x10"]) {
  assert.throws(() => parseGptSizes(bad), PluginError, `seharusnya ditolak: ${bad}`);
}

// --- Spec ---------------------------------------------------------------------------------------

// Tanda kutip di unit iklan atau div id menutup string JavaScript lebih awal dan mematikan seluruh
// <script> header — termasuk kode lain di blok itu.
for (const bad of [
  { ...parsed, adUnitPath: "/1/a'); alert(1); ('" },
  { ...parsed, adUnitPath: "ca-pub-1/tag" },
  { ...parsed, divPrefix: "div'x" },
  { ...parsed, divPrefix: "1abc" },
  { ...parsed, slots: 0 },
  { ...parsed, slots: 6 },
  { ...parsed, slots: 2.5 },
]) {
  assert.throws(() => normalizeGptSpec(bad), PluginError, JSON.stringify(bad));
}

// Awalan yang berakhiran angka TIDAK dipotong — itu bentuk awalan Ad Manager sendiri.
assert.equal(normalizeGptSpec({ ...parsed, slots: 1 }).divPrefix, "div-gpt-ad-1789368958539");
assert.equal(normalizeGptOptions({ sizes: "300x250", slots: "2" }).slots, 2);
// Pilihan dari browser tidak membawa unit iklan maupun div id sama sekali.
assert.deepEqual(
  Object.keys(normalizeGptOptions({ sizes: "300x250", slots: 1, adUnitPath: "/1/x" })).sort(),
  ["sizes", "slots"],
);

// Hanya fluid: tidak ada sisi terkecil, jadi tidak ada style yang dikarang.
const fluid = buildGptTags(normalizeGptSpec({ ...parsed, sizes: "fluid", slots: 1 }));
assert.doesNotMatch(fluid.bodies[0], /style=/);
assert.match(fluid.header, /\['fluid'\], 'div-gpt-ad-1789368958539-0'/);

// --- Menggabungkan header -----------------------------------------------------------------------

const OTHER = `<script>/* analytics */</script>`;

// Belum ada GPT: ditaruh di ujung, isi lain tidak disentuh.
const appended = mergeGptHeader(OTHER, tags.header);
assert.equal(appended.mode, "appended");
assert.equal(appended.code, `${OTHER}\n${tags.header}`);
assert.equal(mergeGptHeader("", tags.header).code, tags.header);

// Tag yang dulu ditempel tangan: diganti di tempatnya, yang lain tetap.
const manual = mergeGptHeader(`${OTHER}\n${HEADER_1}\n<meta name="x">`, tags.header);
assert.equal(manual.mode, "replaced");
assert.equal(manual.code, `${OTHER}\n${tags.header}\n<meta name="x">`);
assert.equal(manual.removed.length, 2);

// Inject kedua: blok sebelumnya ditemukan lewat pola dan diganti, bukan ditambah blok kedua.
const smaller = buildGptTags(normalizeGptSpec({ ...parsed, sizes: "300x250", slots: 1 }));
const second = mergeGptHeader(manual.code, smaller.header);
assert.equal(second.mode, "replaced");
assert.equal(second.code, `${OTHER}\n${smaller.header}\n<meta name="x">`);
assert.equal(second.code.split("securepubads").length - 1, 1);
assert.doesNotMatch(tags.header, /RabbitROI GPT/);

// Header yang terlanjur memuat penanda lama: penandanya dibuang, bloknya diganti.
const legacy = `${OTHER}\n<!-- RabbitROI GPT: mulai (dikelola dashboard, jangan disunting) -->\n${HEADER_1}\n<!-- RabbitROI GPT: selesai -->\n<meta name="x">`;
const cleaned = mergeGptHeader(legacy, smaller.header);
assert.equal(cleaned.code, `${OTHER}\n${smaller.header}\n<meta name="x">`);

// --- Kode iklan ---------------------------------------------------------------------------------

const ads = {
  kode_iklan_1: "lama",
  kode_iklan_3:
    "<script>googletag.cmd.push(function() { googletag.display('div-lama-2'); });</script>",
  kode_iklan_4: '<ins class="adsbygoogle"></ins>',
  jumlah_iklan: 4,
};
const plan = planGptBodies(ads, normalizeGptSpec({ ...parsed, slots: 2 }), tags.bodies);
assert.deepEqual(Object.keys(plan.values).sort(), [
  "jumlah_iklan",
  "kode_iklan_1",
  "kode_iklan_2",
  "kode_iklan_3",
]);
assert.equal(plan.values.kode_iklan_1, tags.bodies[0]);
assert.equal(plan.values.kode_iklan_3, "");
assert.deepEqual(plan.cleared, ["kode_iklan_3"]);
assert.equal(plan.values.jumlah_iklan, 2);
assert.equal(plan.previousSlotCount, 4);
// AdSense di kotak 4 bukan milik tag ini — tidak disentuh.
assert.equal(Object.hasOwn(plan.values, "kode_iklan_4"), false);
assert.equal(GPT_BODY_FIELDS.length, 5);

console.log("gpt-inject-core: ok");
