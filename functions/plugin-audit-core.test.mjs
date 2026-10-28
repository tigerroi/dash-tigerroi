import assert from "node:assert";

const {
  auditAdCode,
  auditDisplayMode,
  auditBehaviour,
  auditCmp,
  auditLanding,
  auditNetwork,
  auditSite,
  gptTagsOf,
} = await import("./plugin-audit-core.js");

// --- Tag nyata dari inject dashboard (bentuk buildGptTags) ------------------------------------------

const HEADER = `<script async src="https://securepubads.g.doubleclick.net/tag/js/gpt.js" crossorigin="anonymous"></script>
<script>
  window.googletag = window.googletag || {cmd: []};
  googletag.cmd.push(function() {
    googletag.defineSlot('/23352267851/ca-pub-9198385730397674-tag', [[300, 250], 'fluid'], 'div-gpt-ad-1789368958539-0').addService(googletag.pubads());
    googletag.defineSlot('/23352267851/ca-pub-9198385730397674-tag', [[300, 250]], 'div-gpt-ad-1789368958539-1').addService(googletag.pubads());
    googletag.enableServices();
  });
</script>`;
const body = (index) => `<!-- /23352267851/ca-pub-9198385730397674-tag -->
<div id='div-gpt-ad-1789368958539-${index}'>
  <script>
    googletag.cmd.push(function() { googletag.display('div-gpt-ad-1789368958539-${index}'); });
  </script>
</div>`;
const ADSENSE = `<ins class="adsbygoogle" data-ad-client="ca-pub-1" data-ad-slot="2"></ins>`;

const gptAds = {
  jumlah_iklan: 2,
  kode_iklan_1: body(0),
  kode_iklan_2: body(1),
  simpan_log: "Aktifkan",
  mode_tampilan: "Acak",
};
const gam = { networkCode: "23352267851", accountName: "designingaround.com" };

// gptTagsOf: network + div yang didefinisikan, termasuk ukuran 'fluid' di tengah argumen.
const tags = gptTagsOf(HEADER, [body(0), body(1)]);
assert.deepEqual(tags.networks, ["23352267851"]);
assert.deepEqual(tags.defined, ["div-gpt-ad-1789368958539-0", "div-gpt-ad-1789368958539-1"]);
assert.deepEqual(tags.displayed, tags.defined);

// --- Kode iklan -------------------------------------------------------------------------------------

assert.equal(auditAdCode(gptAds, { header_code: HEADER }).status, "ok");
assert.equal(auditAdCode(gptAds, { header_code: HEADER }).type, "AdX");
assert.equal(auditAdCode({ jumlah_iklan: 1, kode_iklan_1: ADSENSE }, {}).type, "AdSense");

// Kotak sesudah N tidak ditampilkan — N = 0 tetap "tidak ada" walau kotaknya berisi.
const zero = auditAdCode({ jumlah_iklan: 0, kode_iklan_1: ADSENSE }, {});
assert.equal(zero.status, "fail");
assert.match(zero.detail, /1 kotak berisi kode/);

assert.equal(auditAdCode({ jumlah_iklan: 2 }, {}).status, "fail");
assert.equal(auditAdCode({ jumlah_iklan: 2, kode_iklan_1: ADSENSE }, {}).status, "warn");

// Div yang ditampilkan tapi tidak didefinisikan header.
const orphan = auditAdCode(
  { ...gptAds, kode_iklan_2: body(1).replaceAll("-1'", "-9'") },
  { header_code: HEADER },
);
assert.equal(orphan.status, "fail");
assert.match(orphan.detail, /div-gpt-ad-1789368958539-9/);

assert.equal(auditAdCode(null, null).status, "error");

// --- Network ID -------------------------------------------------------------------------------------

assert.equal(auditNetwork(gptAds, { header_code: HEADER }, gam).status, "ok");
assert.match(
  auditNetwork(gptAds, { header_code: HEADER }, { ...gam, accountName: "sheetz.us " }).detail,
  /sheetz\.us di/,
);
const mismatch = auditNetwork(gptAds, { header_code: HEADER }, { ...gam, networkCode: "999" });
assert.equal(mismatch.status, "fail");
assert.match(mismatch.detail, /Plugin: 23352267851/);
assert.equal(
  auditNetwork(gptAds, { header_code: HEADER }, { error: "Tidak ada akun" }).status,
  "warn",
);
assert.equal(
  auditNetwork({ jumlah_iklan: 1, kode_iklan_1: ADSENSE }, { header_code: "" }, gam).status,
  "na",
);
assert.equal(auditNetwork(gptAds, { header_code: "" }, gam).status, "fail");
// Tag utuh yang ditempel di kotak kode iklan tetap terbaca.
assert.equal(
  auditNetwork({ jumlah_iklan: 1, kode_iklan_1: `${HEADER}\n${body(0)}` }, { header_code: "" }, gam)
    .status,
  "ok",
);

// --- Mode tampilan ---
assert.deepEqual(auditDisplayMode({ mode_tampilan: "Stacked" }), {
  status: "ok",
  label: "Stacked",
  detail: "",
});
assert.equal(auditDisplayMode({}).status, "warn");
assert.equal(auditDisplayMode({ mode_tampilan: "Acakk" }).status, "warn");
assert.equal(auditDisplayMode(null).status, "error");

// --- CMP --------------------------------------------------------------------------------------------

assert.deepEqual(
  [
    auditCmp({ cmp_enabled: true, cmp_code: "<script></script>" }).label,
    auditCmp({ cmp_enabled: false }).label,
  ],
  ["On", "Off"],
);
// Kode CMP kosong bukan masalah.
assert.equal(auditCmp({ cmp_enabled: "1", cmp_code: "" }).status, "ok");
assert.equal(auditCmp(null).status, "error");

// --- Landing ----------------------------------------------------------------------------------------

assert.equal(auditLanding([]).status, "fail");
assert.equal(auditLanding([{ id: "1", slug: "a", active: false }]).status, "warn");
const landing = auditLanding([
  { id: "1", slug: "a", active: true },
  { id: "2", slug: "b", active: false },
]);
assert.equal(landing.status, "ok");
assert.equal(landing.label, "1 aktif");
assert.equal(auditLanding(null).status, "error");

// --- Behaviour --------------------------------------------------------------------------------------

const on = {
  behaviour_detection: true,
  behaviour_action: "hide_ads",
  behaviour_lolos: 1,
  behaviour_batas: 3,
};
assert.equal(auditBehaviour(on, gptAds).status, "ok");
assert.equal(auditBehaviour({ behaviour_detection: false }, gptAds).label, "Off");
// "Nonaktifkan" memuat "aktif" — tetap dibaca sebagai log mati.
assert.equal(auditBehaviour(on, { simpan_log: "Nonaktifkan" }).status, "warn");
assert.equal(auditBehaviour({ ...on, behaviour_action: "redirect" }, gptAds).status, "warn");

// --- Satu situs -------------------------------------------------------------------------------------

const site = auditSite({
  ads: gptAds,
  headerFooter: { header_code: HEADER },
  cmp: { cmp_enabled: true, cmp_code: "x" },
  behaviour: on,
  landings: [{ id: "1", slug: "a", active: true }],
  gam,
});
assert.equal(site.problems, 0);
assert.equal(site.adType, "AdX");

// Grup yang tidak terbaca = error berikut sebabnya, bukan fail; grup lain tetap dinilai.
const partial = auditSite({
  ads: gptAds,
  headerFooter: { header_code: HEADER },
  cmp: null,
  behaviour: on,
  landings: [{ id: "1", slug: "a", active: true }],
  gam,
  errors: { cmp: "rest_no_route" },
});
assert.equal(partial.checks.cmp.status, "error");
assert.equal(partial.checks.cmp.detail, "rest_no_route");
assert.equal(partial.checks.adCode.status, "ok");
assert.equal(partial.problems, 1);

console.log("plugin-audit-core tests ok");
