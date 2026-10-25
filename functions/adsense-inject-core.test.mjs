import assert from "node:assert";

const {
  ADSENSE_MAX_SLOTS,
  adBoxKind,
  adsenseSizeLabel,
  normalizeAdsenseCodes,
  parseAdsenseCode,
  planAdsenseBodies,
  verifyAdsenseSlots,
} = await import("./adsense-inject-core.js");
const { GPT_MAX_SLOTS } = await import("./gpt-inject-core.js");
const { PluginError } = await import("./plugin-core.js");

// --- Contoh nyata dari getAdcode AdSense API (14 Sep 2026, unit "petcins 1") ---------------------

const RESPONSIVE = `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-2520327538603736" crossorigin="anonymous"></script>
<!-- petcins 1 -->
<ins class="adsbygoogle"
     style="display:block"
     data-ad-client="ca-pub-2520327538603736"
     data-ad-slot="3445630456"
     data-ad-format="auto"
     data-full-width-responsive="true"></ins>
<script>
(adsbygoogle = window.adsbygoogle || []).push({});
</script>`;

const FIXED = `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-2520327538603736" crossorigin="anonymous"></script>
<ins class="adsbygoogle"
     style="display:inline-block;width:300px;height:600px"
     data-ad-client="ca-pub-2520327538603736"
     data-ad-slot="2172584371"></ins>
<script>
     (adsbygoogle = window.adsbygoogle || []).push({});
</script>`;

const rejects = (fn, pattern) =>
  assert.throws(fn, (error) => error instanceof PluginError && pattern.test(error.message));

assert.equal(ADSENSE_MAX_SLOTS, GPT_MAX_SLOTS);

// Kode dari halaman AdSense diurai apa adanya, termasuk CRLF dari papan klip Windows.
assert.deepEqual(parseAdsenseCode(`  ${RESPONSIVE.replace(/\n/g, "\r\n")}\n`), {
  client: "ca-pub-2520327538603736",
  slot: "3445630456",
  code: RESPONSIVE,
});
assert.equal(parseAdsenseCode(FIXED).slot, "2172584371");
// Tanpa loader pun sah — kotak lain di halaman yang sama sudah memuatnya.
assert.equal(parseAdsenseCode(FIXED.split("\n").slice(1).join("\n")).slot, "2172584371");

// Yang ditolak — tiap kalimat menyebut nomor kotaknya.
rejects(() => parseAdsenseCode("", 2), /Kode iklan 3 kosong/);
rejects(
  () => parseAdsenseCode(`<div id='div-gpt-ad-1-0'><script>googletag.cmd.push(function(){});</script></div>`),
  /bukan kode unit AdSense/,
);
rejects(
  () =>
    parseAdsenseCode(
      `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-2520327538603736" crossorigin="anonymous"></script>`,
    ),
  /bukan kode unit AdSense/,
);
rejects(() => parseAdsenseCode(RESPONSIVE.replace(' data-ad-slot="3445630456"', "")), /Auto ads/);
rejects(() => parseAdsenseCode(`${RESPONSIVE}\n${FIXED}`), /2 <ins>/);
rejects(
  () => parseAdsenseCode(RESPONSIVE.replace("client=ca-pub-2520327538603736", "client=ca-pub-1375442959645911")),
  /loader menyebut/,
);
rejects(
  () => parseAdsenseCode(`${RESPONSIVE}\n<script src="https://evil.example/x.js"></script>`),
  /dari luar AdSense/,
);
rejects(() => parseAdsenseCode(`${RESPONSIVE}\n<script>alert(1)</script>`), /script selain/);
rejects(() => parseAdsenseCode(RESPONSIVE.replace(/<\/script>\s*$/, "")), /terpotong|tidak memuat/);
rejects(
  () => parseAdsenseCode(RESPONSIVE.replace(/<script>\n\(adsbygoogle[\s\S]*$/, "")),
  /tidak pernah meminta iklan/,
);

// Daftar kotak: ekor kosong dibuang, tengah kosong ditolak, satu akun, tanpa slot kembar.
assert.equal(normalizeAdsenseCodes([RESPONSIVE, FIXED, "", "  "]).length, 2);
rejects(() => normalizeAdsenseCodes([RESPONSIVE, "", FIXED]), /Kode iklan 2 kosong/);
rejects(() => normalizeAdsenseCodes([]), /minimal satu/);
rejects(() => normalizeAdsenseCodes(["", ""]), /minimal satu/);
rejects(
  () => normalizeAdsenseCodes([RESPONSIVE, FIXED.replaceAll("ca-pub-2520327538603736", "ca-pub-1375442959645911")]),
  /2 akun AdSense/,
);
rejects(() => normalizeAdsenseCodes([RESPONSIVE, RESPONSIVE]), /sudah dipakai/);
rejects(() => normalizeAdsenseCodes(Array(6).fill(RESPONSIVE)), /Maksimal 5/);

// Verifikasi slot terhadap ad unit akun.
const slots = normalizeAdsenseCodes([RESPONSIVE, FIXED]);
const UNITS = [
  {
    name: "accounts/pub-2520327538603736/adclients/ca-pub-2520327538603736/adunits/3445630456",
    displayName: "petcins 1",
    state: "ACTIVE",
    contentAdsSettings: { size: "1x3", type: "DISPLAY" },
  },
  {
    name: "accounts/pub-2520327538603736/adclients/ca-pub-2520327538603736/adunits/2172584371",
    displayName: "cathealth-2",
    state: "ARCHIVED",
    contentAdsSettings: { size: "300x600", type: "DISPLAY" },
  },
];
const verified = verifyAdsenseSlots(slots, UNITS);
assert.deepEqual(
  verified.map((row) => [row.verified, row.displayName, row.size, row.note]),
  [
    [true, "petcins 1", "1x3", ""],
    [true, "cathealth-2", "300x600", "Unit berstatus ARCHIVED di AdSense."],
  ],
);
rejects(() => verifyAdsenseSlots(slots, UNITS.slice(0, 1)), /Kode iklan 2: slot 2172584371 tidak ada/);
// Akun yang tidak terbaca: tidak ditolak, dilaporkan belum terverifikasi berikut sebabnya.
assert.deepEqual(
  verifyAdsenseSlots(slots, null, "kredensial ditolak").map((row) => [row.verified, row.note]),
  [
    [false, "kredensial ditolak"],
    [false, "kredensial ditolak"],
  ],
);
assert.equal(adsenseSizeLabel("1x3"), "responsif");
assert.equal(adsenseSizeLabel("300x600"), "300x600");

// Rencana tulis: 1…N ditimpa, sesudahnya dikosongkan hanya kalau kode iklan yang dikenali.
assert.equal(adBoxKind(""), "kosong");
assert.equal(adBoxKind("<script>googletag.display('x');</script>"), "GPT");
assert.equal(adBoxKind(RESPONSIVE), "AdSense");
assert.equal(adBoxKind("<a href='/'>banner</a>"), "lain");

const plan = planAdsenseBodies(
  {
    kode_iklan_1: "<div id='div-gpt-ad-1-0'><script>googletag.cmd.push(function() { googletag.display('div-gpt-ad-1-0'); });</script></div>",
    kode_iklan_3: RESPONSIVE,
    kode_iklan_4: "<a href='/'>banner</a>",
    kode_iklan_5: "<script>googletag.display('div-gpt-ad-1-4');</script>",
    jumlah_iklan: "5",
  },
  slots,
);
assert.deepEqual(plan.values, {
  kode_iklan_1: RESPONSIVE,
  kode_iklan_2: FIXED,
  kode_iklan_3: "",
  kode_iklan_5: "",
  jumlah_iklan: 2,
});
assert.deepEqual(plan.replaced, ["kode_iklan_1: GPT", "kode_iklan_2: kosong"]);
assert.deepEqual(plan.cleared, ["kode_iklan_3", "kode_iklan_5"]);
assert.equal(plan.previousSlotCount, "5");

console.log("adsense-inject-core tests passed");
