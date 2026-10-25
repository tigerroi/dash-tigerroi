import assert from "node:assert";

// meta.js reads its knobs at import time, so set them before importing. Throttling is off here;
// meta-throttle.test.mjs is where the pacing and retries are exercised.
process.env.META_MINOR_UNIT = "100";
process.env.META_MIN_INTERVAL_MS = "0";
const {
  copyAdSetInto,
  copyCampaignShell,
  costPerResultFrom,
  fetchAccount,
  fetchAdSetForEdit,
  fetchAdSetInsights,
  fetchAdSets,
  fetchCampaignAds,
  fetchCampaignForEdit,
  fetchCampaignResultGoals,
  fetchCampaignSettings,
  fetchCampaignSpend,
  resultActionTypes,
  resultActionUsed,
  resultCostAliases,
  resultsFromActions,
  setAdSetStatus,
  setCampaignStatus,
  updateAdSet,
  updateCampaign,
} = await import("./meta.js");

// Stub fetch: account fields call + insights call.
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes("/insights")) {
    return { ok: true, text: async () => JSON.stringify({ data: [{ spend: "12.34" }] }) };
  }
  return {
    ok: true,
    text: async () => JSON.stringify({
      balance: "5000",
      amount_spent: "75157200",
      spend_cap: "107500000",
      currency: "IDR",
      account_status: 1,
    }),
  };
};

const r = await fetchAccount("123456", "tok");
// Sisa saldo = batas - terpakai, angka yang sama dengan kartu "Batas pengeluaran akun" di Meta.
// Field `balance` Meta adalah tagihan berjalan dan tidak boleh mengisi kolom itu.
assert.equal(r.remaining, 323428, "1.075.000 - 751.572");
assert.equal(r.spendCap, 1075000, "107500000 minor / 100");
assert.equal(r.amountSpent, 751572, "75157200 / 100");
assert.equal(r.amountDue, 50, "5000 minor / 100");
assert.equal(r.spendToday, 12.34, "insights spend is major units, not divided");
assert.equal(r.currency, "IDR");

// Akun tanpa batas pengeluaran: tidak ada angka sisa, dan 0 - terpakai tidak boleh bocor sebagai
// sisa saldo minus.
globalThis.fetch = async (url) =>
  String(url).includes("/insights")
    ? { ok: true, text: async () => JSON.stringify({ data: [] }) }
    : { ok: true, text: async () => JSON.stringify({ balance: "0", amount_spent: "12300", spend_cap: "0" }) };
const uncapped = await fetchAccount("act_9", "tok");
assert.equal(uncapped.remaining, "", "tanpa spend_cap tidak ada sisa saldo, bukan angka minus");

// No delivery today -> empty insights -> spendToday 0, no throw.
globalThis.fetch = async (url) =>
  String(url).includes("/insights")
    ? { ok: true, text: async () => JSON.stringify({ data: [] }) }
    : { ok: true, text: async () => JSON.stringify({ balance: "0", amount_spent: "0" }) };
const z = await fetchAccount("act_123", "tok");
assert.equal(z.spendToday, 0);
assert.equal(z.amountDue, 0);

// Graph errors carry code and subcode: "(#200)" is both a missing ads_read grant and an app-wide
// block, and the dashboard can only tell them apart if the numbers survive the trip.
globalThis.fetch = async () => ({
  ok: false,
  text: async () => JSON.stringify({
    error: { message: "API access blocked.", type: "OAuthException", code: 200 },
  }),
});
await assert.rejects(
  () => fetchAccount("123456", "tok"),
  /Meta act_123456 -> API access blocked\. \(#200\)$/,
  "app-level block keeps its message and code",
);

globalThis.fetch = async () => ({
  ok: false,
  text: async () => JSON.stringify({
    error: {
      message: "Unsupported get request.",
      code: 100,
      error_subcode: 33,
      error_user_msg: "Object does not exist or you lack permission to view it.",
    },
  }),
});
await assert.rejects(
  () => fetchAccount("123456", "tok"),
  /Unsupported get request\. — Object does not exist.* \(#100-33\)$/,
  "subcode and Meta's own user message both survive",
);

// No error object at all (a gateway 502 with an HTML-ish body) still names the status.
globalThis.fetch = async () => ({ ok: false, status: 502, text: async () => JSON.stringify({}) });
await assert.rejects(() => fetchAccount("123456", "tok"), /Meta act_123456 -> HTTP 502$/);

// Halaman HTML dari edge (Cloudflare/nginx 5xx) alih-alih JSON: JANGAN "Unexpected token '<'".
// Dibungkus jadi pesan yang menyebut status + cuplikan, lalu dilempar apa adanya (sweep syncRetries
// yang mengulang, bukan loop ini).
globalThis.fetch = async () => ({
  ok: false,
  status: 502,
  text: async () => "<!DOCTYPE html><html><body>502 Bad Gateway</body></html>",
});
const htmlError = await fetchAccount("123456", "tok").then(
  () => null,
  (error) => error.message,
);
assert.match(htmlError, /non-JSON \(HTTP 502\)/, "pesan menyebut non-JSON + status, bukan error JS mentah");
assert.doesNotMatch(htmlError, /Unexpected token/, "bukan lagi 'Unexpected token'");

console.log("meta non-JSON response test ok");

// Hasil dipilih menurut prioritas action_type, bukan yang pertama muncul di array.
assert.equal(
  resultsFromActions([
    { action_type: "link_click", value: "80" },
    { action_type: "lead", value: "6" },
  ]),
  6,
  "lead menang atas link_click",
);
assert.equal(resultsFromActions([{ action_type: "post_engagement", value: "9" }]), 0, "bukan hasil");
assert.equal(resultsFromActions(undefined), 0, "campaign tanpa actions sama sekali");

// --- "Hasil" mengikuti tujuan optimasi ad set, bukan daftar prioritas tetap --------------------
//
// Kasus nyatanya: "kBCD-06 Pros Turki" — 10 ad set, OFFSITE_CONVERSIONS/CONTENT_VIEW. Daftar
// prioritas lama jatuh sampai `link_click` dan melaporkan 4.908 hasil @ Rp 19,46; Ads Manager
// menampilkan 2.449 @ Rp 39,01, yaitu ViewContent.
const turkiActions = [
  { action_type: "link_click", value: "4908" },
  { action_type: "landing_page_view", value: "996" },
  { action_type: "offsite_conversion.fb_pixel_view_content", value: "2449" },
  { action_type: "post_engagement", value: "4920" },
];
// Persis bentuk yang dikirim Meta untuk campaign ini: hasilnya bernama
// `offsite_conversion.fb_pixel_view_content` di `actions`, tapi biayanya hanya ada sebagai
// `omni_view_content`/`view_content`. Mencari satu nama saja mengembalikan null.
const turkiCosts = [
  { action_type: "link_click", value: "19.46414" },
  { action_type: "omni_view_content", value: "39.007758" },
  { action_type: "view_content", value: "39.007758" },
];
const contentView = resultActionTypes({
  optimization_goal: "OFFSITE_CONVERSIONS",
  promoted_object: { custom_event_type: "CONTENT_VIEW" },
});
assert.equal(contentView[0], "offsite_conversion.fb_pixel_view_content");
assert.equal(resultsFromActions(turkiActions, contentView), 2449, "ViewContent, bukan klik tautan");
assert.equal(resultActionUsed(turkiActions, contentView), "offsite_conversion.fb_pixel_view_content");
assert.equal(
  costPerResultFrom(turkiCosts, contentView),
  39.007758,
  "biaya per hasil diambil dari Meta lewat nama lain event yang sama",
);
assert.equal(
  costPerResultFrom(turkiCosts, ["offsite_conversion.fb_pixel_view_content"]),
  null,
  "nama persisnya memang tidak ada di cost_per_action_type",
);
// Tanpa peta tujuan, perilaku lamanya tetap: daftar cadangan, yang di sini mendarat di link_click.
assert.equal(resultsFromActions(turkiActions), 4908, "cadangan untuk campaign yang tujuannya gelap");

// Tujuan tanpa custom_event_type dipetakan dari optimization_goal-nya sendiri.
assert.deepEqual(resultActionTypes({ optimization_goal: "LINK_CLICKS" }), ["link_click"]);
assert.equal(resultActionTypes({ optimization_goal: "LANDING_PAGE_VIEWS" })[0], "landing_page_view");
// REACH/IMPRESSIONS tidak punya baris di `actions` — kosong, supaya pemanggilnya jatuh ke cadangan
// alih-alih mengarang angka dari event lain.
assert.deepEqual(resultActionTypes({ optimization_goal: "REACH" }), []);
assert.deepEqual(resultActionTypes({}), [], "ad set tanpa tujuan yang terbaca");
// Event pixel menang atas tujuannya: OFFSITE_CONVERSIONS sendiri tidak menyebut event apa pun.
assert.equal(
  resultActionTypes({
    optimization_goal: "OFFSITE_CONVERSIONS",
    promoted_object: { custom_event_type: "PURCHASE" },
  })[0],
  "offsite_conversion.fb_pixel_purchase",
);
// Custom conversion: kasus nyatanya ad set "VV2-C2 VALUE + lantai ROAS 1.80" (kL5r-01 ProsR18 G11,
// akun BD - S02, 26 Sep 2026). `custom_event_type` cuma "OTHER" — event yang dioptimasi disebut
// lewat `custom_conversion_id`, dan Meta melaporkannya sebagai `offsite_conversion.custom.{id}` di
// `actions` MAUPUN `cost_per_action_type`. Tanpa itu hasilnya jatuh ke cadangan (fb_pixel_purchase
// 3.527) dan biayanya kosong, karena `fb_pixel_purchase` tidak ada di `cost_per_action_type`.
const prosActions = [
  { action_type: "link_click", value: "7678" },
  { action_type: "offsite_conversion.fb_pixel_purchase", value: "3527" },
  { action_type: "offsite_conversion.fb_pixel_custom", value: "7056" },
  { action_type: "offsite_conversion.custom.1063447699853124", value: "3529" },
  { action_type: "offsite_conversion.custom.1926199871684012", value: "774" },
];
const prosCosts = [
  { action_type: "purchase", value: "11.48795" },
  { action_type: "omni_purchase", value: "11.48795" },
  { action_type: "offsite_conversion.custom.1063447699853124", value: "11.48144" },
  { action_type: "offsite_conversion.custom.1926199871684012", value: "52.348837" },
];
const prosGoal = resultActionTypes({
  optimization_goal: "VALUE",
  promoted_object: { custom_event_type: "OTHER", custom_conversion_id: "1063447699853124" },
});
assert.deepEqual(prosGoal, ["offsite_conversion.custom.1063447699853124"]);
assert.equal(resultsFromActions(prosActions, prosGoal), 3529, "custom conversion, bukan purchase");
assert.equal(costPerResultFrom(prosCosts, prosGoal), 11.48144);

// Hasil yang jatuh ke cadangan tetap mencari biayanya lewat nama lain EVENT YANG SAMA: di sini
// `fb_pixel_purchase` cuma ada sebagai `purchase`/`omni_purchase` di cost_per_action_type.
assert.deepEqual(resultCostAliases("offsite_conversion.fb_pixel_purchase", []), [
  "offsite_conversion.fb_pixel_purchase",
  "omni_purchase",
  "purchase",
]);
assert.equal(
  costPerResultFrom(prosCosts, resultCostAliases("offsite_conversion.fb_pixel_purchase", [])),
  11.48795,
);
// Hasil dari tujuan ad set-nya sendiri memakai daftar tujuan itu apa adanya.
assert.deepEqual(resultCostAliases("omni_view_content", contentView), contentView);
// Event yang tidak punya kelompok cuma dicari lewat namanya sendiri — alias event LAIN akan
// mengambil biaya milik event lain.
assert.deepEqual(resultCostAliases("link_click", []), ["link_click"]);
assert.deepEqual(resultCostAliases("", []), []);

assert.equal(costPerResultFrom(turkiCosts, ""), null, "tanpa hasil, tidak ada biaya per hasil");
assert.equal(costPerResultFrom(turkiCosts, []), null);
assert.equal(costPerResultFrom(undefined, "link_click"), null);

// Peta campaignId -> action_type hasilnya, dibaca dari ad set. Tujuan yang paling banyak dipakai
// yang menang: satu kolom tidak bisa memuat dua definisi hasil sekaligus.
globalThis.fetch = async (url) => {
  assert.match(String(url), /adsets/, "ad set, bukan campaign — tujuan optimasi tinggal di sana");
  assert.match(String(url), /optimization_goal/);
  return {
    ok: true,
    text: async () => JSON.stringify({
      data: [
        {
          campaign_id: "1",
          optimization_goal: "OFFSITE_CONVERSIONS",
          promoted_object: { custom_event_type: "CONTENT_VIEW" },
        },
        {
          campaign_id: "1",
          optimization_goal: "OFFSITE_CONVERSIONS",
          promoted_object: { custom_event_type: "CONTENT_VIEW" },
        },
        { campaign_id: "1", optimization_goal: "LINK_CLICKS" },
        { campaign_id: "2", optimization_goal: "LANDING_PAGE_VIEWS" },
        { campaign_id: "3", optimization_goal: "REACH" },
      ],
    }),
  };
};
const goals = await fetchCampaignResultGoals("act_1", "tok");
assert.equal(goals.get("1")[0], "offsite_conversion.fb_pixel_view_content", "dua ad set lawan satu");
assert.equal(goals.get("2")[0], "landing_page_view");
assert.equal(goals.has("3"), false, "tujuan tanpa action tidak masuk peta");

// fetchCampaignSpend membawa hasil di samping spend, supaya CPR bisa dihitung per subdomain.
globalThis.fetch = async (url) => {
  assert.match(
    String(url),
    /fields=campaign_id%2Ccampaign_name%2Cspend%2Cactions%2Ccost_per_action_type/,
    "actions + biaya per hasil ikut diminta, dan campaign_id — alamat saklar on/off",
  );
  return {
    ok: true,
    text: async () => JSON.stringify({
      data: [
        {
          campaign_id: "120210",
          campaign_name: "A",
          spend: "45.5",
          actions: [{ action_type: "lead", value: "2" }],
        },
        { campaign_name: "B", spend: "10" },
      ],
    }),
  };
};
const campaigns = await fetchCampaignSpend("act_1", "tok");
assert.deepEqual(campaigns, [
  {
    date: "",
    id: "120210",
    name: "A",
    spend: 45.5,
    results: 2,
    resultType: "lead",
    // Meta tidak mengirim cost_per_action_type di baris ini; pemanggilnya yang menghitung sendiri.
    costPerResult: null,
  },
  // Baris tanpa campaign_id tetap lewat dengan id kosong: tabelnya butuh spend-nya, dan yang
  // hilang cuma kemampuan menyalakan/mematikannya dari dashboard.
  { date: "", id: "", name: "B", spend: 10, results: 0, resultType: "", costPerResult: null },
]);

// Dengan rentang, insights diminta per hari (`time_increment=1`) dan tiap baris membawa tanggalnya.
// Tanpa itu Meta menjumlahkan hari selesai + hari berjalan menjadi satu angka yang tidak bisa
// dipasangkan dengan hari GAM mana pun — dan baris ROI-nya akan membagi dua hari dengan satu hari.
globalThis.fetch = async (url) => {
  const text = String(url);
  assert.match(text, /time_increment=1/, "rentang selalu dipecah per hari");
  assert.match(text, /time_range=/, "rentangnya yang diminta, bukan date_preset");
  assert.doesNotMatch(text, /date_preset/, "date_preset hanya untuk panel hari ini");
  return {
    ok: true,
    text: async () => JSON.stringify({
      data: [
        { date_start: "2026-08-10", campaign_name: "A", spend: "30" },
        { date_start: "2026-08-11", campaign_name: "A", spend: "12" },
      ],
    }),
  };
};
assert.deepEqual(
  await fetchCampaignSpend("act_1", "tok", { since: "2026-08-10", until: "2026-08-11" }),
  [
    { date: "2026-08-10", id: "", name: "A", spend: 30, results: 0, resultType: "", costPerResult: null },
    { date: "2026-08-11", id: "", name: "A", spend: 12, results: 0, resultType: "", costPerResult: null },
  ],
  "satu baris per hari, bukan satu total rentang",
);

// Halaman berikutnya diikuti. Meta memotong daftar pada `limit` dan menaruh sisanya di
// `paging.next`; tanpa mengikutinya jawabannya adalah data yang kurang TANPA error — tabelnya
// terisi, hanya tidak lengkap. Insights per hari membuat ini nyata: 60 campaign × 8 negara × 2 hari
// sudah melewati 500 baris.
let panggilan = 0;
globalThis.fetch = async (url) => {
  panggilan++;
  const first = !String(url).includes("after=kursor");
  return {
    ok: true,
    text: async () => JSON.stringify({
      data: first
        ? [{ date_start: "2026-08-10", campaign_name: "A", spend: "30" }]
        : [{ date_start: "2026-08-11", campaign_name: "B", spend: "12" }],
      paging: first
        ? { next: "https://graph.facebook.com/v21.0/act_1/insights?after=kursor&access_token=tok" }
        : {},
    }),
  };
};
const berhalaman = await fetchCampaignSpend("act_1", "tok", {
  since: "2026-08-10",
  until: "2026-08-11",
});
assert.equal(panggilan, 2, "halaman kedua diambil, bukan diabaikan");
assert.deepEqual(
  berhalaman.map((r) => r.name),
  ["A", "B"],
  "baris dari semua halaman digabung",
);

console.log("meta.test ok");

// fetchCampaignSettings: `id`, `status`, dan `start_time` ikut diminta — ketiganya milik saklar
// on/off dan labelnya, bukan milik tabel. Tanpa `id` tidak ada alamat untuk menyebut campaign mana
// ke Meta; tanpa `status` yang tersisa cuma `effective_status`, yang ikut menimbang review dan ad
// set yang jeda, jadi tombolnya akan tampak mati untuk campaign yang sebenarnya menyala; dan tanpa
// `start_time` tidak ada satu pun field yang membedakan campaign yang tayang hari ini dari yang
// dijadwalkan pekan depan — keduanya ACTIVE, dan keduanya efektif ACTIVE juga.
globalThis.fetch = async (url) => {
  assert.match(
    String(url),
    /fields=id%2Cname%2Cstatus%2Ceffective_status%2Cstart_time%2Cdaily_budget/,
    "id, status, dan start_time ikut diminta",
  );
  return {
    ok: true,
    text: async () => JSON.stringify({
      data: [
        {
          id: "120210",
          name: "A",
          status: "ACTIVE",
          effective_status: "PENDING_REVIEW",
          start_time: "2026-09-10T00:00:00+0700",
          daily_budget: "5000000",
        },
        { id: "120211", name: "B", status: "PAUSED", effective_status: "PAUSED" },
      ],
    }),
  };
};
assert.deepEqual(await fetchCampaignSettings("act_1", "tok"), [
  // Saklarnya ACTIVE sementara Meta masih mereview: dua keadaan yang berbeda, dan keduanya disimpan.
  {
    id: "120210",
    name: "A",
    status: "ACTIVE",
    effectiveStatus: "PENDING_REVIEW",
    startTime: "2026-09-10T00:00:00+0700",
    dailyBudget: 50000,
  },
  // Anggaran di level ad set: Meta tidak mengirim daily_budget sama sekali, dan null bukan 0.
  // Jadwalnya pun tidak dikirim, dan "" berarti tidak ada jadwal — bukan jadwal yang belum sampai.
  {
    id: "120211",
    name: "B",
    status: "PAUSED",
    effectiveStatus: "PAUSED",
    startTime: "",
    dailyBudget: null,
  },
]);

console.log("meta campaign settings tests ok");

// Penolakan izin TULIS: Meta menyebut tiga sebab sekaligus lalu menempel link dokumentasi umum.
// Yang membacanya di dashboard akan mengejar sebab pertama ("ID-nya tidak ada"), padahal ID itu
// tersimpan justru karena token yang sama baru saja membacanya — yang kurang adalah ads_management.
globalThis.fetch = async () => ({
  ok: false,
  text: async () => JSON.stringify({
    error: {
      message:
        "Unsupported post request. Object with ID '120251003975450007' does not exist, cannot be loaded due to missing permissions, or does not support this operation. Please read the Graph API documentation at https://developers.facebook.com/docs/graph-api",
      code: 100,
      error_subcode: 33,
    },
  }),
});
const writeError = await setCampaignStatus("120251003975450007", "tok", "PAUSED").then(
  () => null,
  (error) => error.message,
);
assert.match(writeError, /ads_management/, "sebab yang benar disebutkan");
assert.doesNotMatch(writeError, /Please read the Graph API/, "kalimat link dibuang");

// Status di luar ACTIVE/PAUSED tidak pernah sampai ke Meta.
await assert.rejects(() => setCampaignStatus("1", "tok", "ARCHIVED"), /tidak dikenal/);
await assert.rejects(() => setCampaignStatus("", "tok", "PAUSED"), /kosong/);

console.log("meta write campaign status tests ok");

// --- Ad set satu campaign ----------------------------------------------------------------------
//
// Jawaban ini disalin dari API produksi (campaign 120249777765470789, 7 Sep 2026): ad set pada
// campaign CBO memang datang TANPA `daily_budget` maupun `lifetime_budget`, dan `targeting` yang
// diminta cuma sepotong. Contoh yang disederhanakan sendiri akan menguji tebakan, bukan Meta.
globalThis.fetch = async (url) => {
  assert.match(String(url), /\/120249777765470789\/adsets/, "diminta ke edge campaign, bukan akun");
  // Tanpa `effective_status`, panel tidak bisa membedakan ad set yang saklarnya On tapi
  // campaign-nya mati dari ad set yang benar-benar tayang — dan keduanya berbunyi "Aktif".
  assert.match(String(url), /effective_status/, "effective_status ikut diminta");
  return {
    ok: true,
    text: async () => JSON.stringify({
      data: [
        {
          id: "120249777765560789",
          name: "MECIL Adset 4",
          status: "ACTIVE",
          effective_status: "CAMPAIGN_PAUSED",
          start_time: "2026-09-05T00:05:00+0700",
          optimization_goal: "OFFSITE_CONVERSIONS",
          billing_event: "IMPRESSIONS",
          promoted_object: { pixel_id: "149", custom_event_type: "CONTENT_VIEW" },
          targeting: { age_min: 18, age_max: 65, geo_locations: { countries: ["mx", "cl"] } },
        },
        { id: "2", name: "ABO", status: "PAUSED", daily_budget: "10000" },
      ],
    }),
  };
};
const adSets = await fetchAdSets("120249777765470789", "tok");
assert.equal(adSets.length, 2);
assert.equal(adSets[0].effectiveStatus, "CAMPAIGN_PAUSED");
assert.equal(adSets[0].customEventType, "CONTENT_VIEW");
// Kode negara dinaikkan hurufnya di satu tempat, supaya panel tidak menggambar "mx" di sebelah "ID".
assert.deepEqual(adSets[0].countries, ["MX", "CL"]);
// CBO: null, bukan 0 — nol adalah klaim bahwa ad set ini dianggarkan nol rupiah.
assert.equal(adSets[0].dailyBudget, null);
assert.equal(adSets[0].lifetimeBudget, null);
// Satuan terkecil, sama dengan `daily_budget` campaign: 10000 / MINOR(100) = 100.
assert.equal(adSets[1].dailyBudget, 100);

await assert.rejects(() => fetchAdSets("", "tok"), /kosong/);

// Insights per ad set. Yang diminta `level=adset`, dan CTR/CPC/CPM diambil dari Meta apa adanya —
// dihitung ulang dari spend/klik, angkanya tidak akan sama dengan yang dibaca orang di Ads Manager.
globalThis.fetch = async (url) => {
  const u = String(url);
  assert.match(u, /level=adset/, "diminta per ad set");
  assert.match(u, /ctr%2Ccpc%2Ccpm/, "CTR/CPC/CPM diminta, bukan dihitung sendiri");
  return {
    ok: true,
    text: async () => JSON.stringify({
      data: [
        {
          adset_id: "120249777765560789",
          spend: "69419",
          impressions: "7057",
          clicks: "4708",
          ctr: "66.713901",
          cpc: "14.744902",
          actions: [
            { action_type: "link_click", value: "4708" },
            { action_type: "offsite_conversion.fb_pixel_view_content", value: "2" },
          ],
          cost_per_action_type: [{ action_type: "omni_view_content", value: "34709.5" }],
        },
        { adset_id: "2", spend: "0" },
      ],
    }),
  };
};
const adSetGoalMap = new Map([
  ["120249777765560789", ["offsite_conversion.fb_pixel_view_content", "omni_view_content"]],
]);
const insights = await fetchAdSetInsights("120249777765470789", "tok", undefined, adSetGoalMap);
// Hasilnya event yang DIOPTIMASI ad set itu (2 konten dilihat), bukan 4.708 klik tautan yang
// kebetulan berdiri lebih dulu di daftar cadangan.
assert.equal(insights[0].results, 2);
assert.equal(insights[0].resultType, "offsite_conversion.fb_pixel_view_content");
// Biayanya ditemukan lewat nama LAIN untuk event yang sama — `cost_per_action_type` tidak selalu
// memakai nama yang dipakai `actions`.
assert.equal(insights[0].costPerResult, 34709.5);
assert.equal(insights[0].ctr, 66.713901);
// Baris tanpa tayangan: Meta tidak mengirim CTR sama sekali, dan "" bukan 0.
assert.equal(insights[1].ctr, "");
assert.equal(insights[1].spend, 0);

console.log("meta ad set tests ok");

// Iklan di dalam campaign — sumber "aktif tapi tidak ditayangkan". Bentuk ini dari API produksi
// (campaign 120257050704180339, 7 Sep 2026): sepuluh iklan untuk sepuluh ad set, dan `status`
// iklannya tetap ACTIVE walau Meta sudah menolaknya — itu sebabnya yang dibaca `effective_status`.
globalThis.fetch = async (url) => {
  const u = String(url);
  assert.match(u, /\/120257050704180339\/ads/, "diminta sekali untuk seluruh campaign");
  assert.match(u, /adset_id/, "adset_id ikut diminta — tanpa itu iklannya tidak punya induk");
  // Creative dan Halamannya ikut diminta: itu bahan pemulihan iklan salinan, dan tanpanya
  // pemulihan butuh satu panggilan lagi per iklan.
  assert.match(u, /creative%7Bid%2Cobject_story_spec%7Bpage_id%7D%7D/, "creative + page_id ikut");
  return {
    ok: true,
    text: async () => JSON.stringify({
      data: [
        {
          id: "a1",
          name: "Iklan 1",
          adset_id: "s1",
          status: "ACTIVE",
          effective_status: "ACTIVE",
          creative: { id: "cr1", object_story_spec: { page_id: "105" } },
        },
        { id: "a2", adset_id: "s2", status: "ACTIVE", effective_status: "DISAPPROVED" },
      ],
    }),
  };
};
assert.deepEqual(await fetchCampaignAds("120257050704180339", "tok"), [
  {
    id: "a1",
    name: "Iklan 1",
    adSetId: "s1",
    creativeId: "cr1",
    pageId: "105",
    status: "ACTIVE",
    effectiveStatus: "ACTIVE",
  },
  // Iklan tanpa creative di jawaban Meta tidak dikarang jadi apa pun — ia cuma tidak bisa dipulihkan.
  {
    id: "a2",
    name: "",
    adSetId: "s2",
    creativeId: "",
    pageId: "",
    status: "ACTIVE",
    effectiveStatus: "DISAPPROVED",
  },
]);
await assert.rejects(() => fetchCampaignAds("", "tok"), /kosong/);

console.log("meta ads tests ok");

// Saklar AD SET. Bentuknya sama dengan saklar campaign — `status` yang ditulis, POST ke ID-nya
// sendiri — dan penolakan izinnya diterjemahkan lewat kalimat yang sama.
let adSetWrite = "";
globalThis.fetch = async (url, options) => {
  adSetWrite = `${options?.method || "GET"} ${url}`;
  return { ok: true, text: async () => JSON.stringify({ success: true }) };
};
assert.deepEqual(await setAdSetStatus("120249777765560789", "tok", "PAUSED"), {
  id: "120249777765560789",
  status: "PAUSED",
});
assert.match(adSetWrite, /^POST /, "menulis, bukan membaca");
assert.match(adSetWrite, /120249777765560789/);
assert.match(adSetWrite, /status=PAUSED/);

// Status di luar ACTIVE/PAUSED tidak pernah sampai ke Meta, dan ID kosong tidak pernah dikirim
// sebagai path telanjang — keduanya aturan yang sama dengan `setCampaignStatus`.
await assert.rejects(() => setAdSetStatus("1", "tok", "ARCHIVED"), /tidak dikenal/);
await assert.rejects(() => setAdSetStatus("", "tok", "PAUSED"), /kosong/);

// Izin yang kurang berbunyi seperti "ID-nya tidak ada"; sebab yang benar disebutkan.
globalThis.fetch = async () => ({
  ok: false,
  text: async () => JSON.stringify({
    error: { message: "Unsupported post request. (#100)", code: 100, error_subcode: 33 },
  }),
});
const adSetWriteError = await setAdSetStatus("1", "tok", "PAUSED").then(
  () => null,
  (error) => error.message,
);
assert.match(adSetWriteError, /ads_management/);

console.log("meta ad set write tests ok");

// Versi dipatok. Tanpa itu Meta menaikkan versi yang kedaluwarsa diam-diam (v21.0 dijawab sebagai
// v26.0 pada 11 Sep 2026), dan perilaku endpoint tulis ikut bergeser tanpa satu baris kode berubah.
let versionUrl = "";
globalThis.fetch = async (url) => {
  versionUrl = String(url);
  return { ok: true, text: async () => JSON.stringify({ data: [] }) };
};
await fetchCampaignAds("120257050704180339", "tok");
assert.match(versionUrl, /^https:\/\/graph\.facebook\.com\/v25\.0\//, "versi API dipatok v25.0");

console.log("meta version test ok");

// --- Salin bertahap ------------------------------------------------------------------------
let shellUrl;
globalThis.fetch = async (url, options) => {
  shellUrl = new URL(String(url));
  assert.equal(options?.method, "POST");
  return { ok: true, text: async () => JSON.stringify({ copied_campaign_id: "900", ad_object_ids: [] }) };
};
assert.deepEqual(await copyCampaignShell("120210", "tok", { suffix: " (salinan j1-1)" }), { campaignId: "900" });
assert.match(shellUrl.pathname, /\/120210\/copies$/);
assert.equal(shellUrl.searchParams.get("deep_copy"), "false", "isinya disalin per ad set, bukan di sini");
assert.equal(shellUrl.searchParams.get("status_option"), "PAUSED", "salinan selalu lahir mati");
// Tidak pernah lahir dengan nama persis sumbernya: sync melebur campaign bernama sama jadi satu baris.
assert.deepEqual(JSON.parse(shellUrl.searchParams.get("rename_options")), {
  rename_strategy: "ONLY_TOP_LEVEL_RENAME",
  rename_suffix: " (salinan j1-1)",
});
await copyCampaignShell("120210", "tok");
assert.equal(JSON.parse(shellUrl.searchParams.get("rename_options")).rename_suffix, " (salinan)", "tanpa akhiran pun tetap tidak kembar");

globalThis.fetch = async () => ({ ok: true, text: async () => JSON.stringify({}) });
await assert.rejects(() => copyCampaignShell("120210", "tok"), /tidak mengembalikan ID campaign salinan/);
await assert.rejects(() => copyCampaignShell("", "tok"), /kosong/);

let adSetUrlCopy;
globalThis.fetch = async (url) => {
  adSetUrlCopy = new URL(String(url));
  return {
    ok: true,
    text: async () => JSON.stringify({
      copied_adset_id: "901",
      ad_object_ids: [
        { ad_object_type: "ad_set", source_id: "555", copied_id: "901" },
        { ad_object_type: "ad", source_id: "777", copied_id: "902" },
      ],
    }),
  };
};
assert.deepEqual(await copyAdSetInto("555", "tok", { campaignId: "900" }), { adSetId: "901", adIds: ["902"] });
assert.match(adSetUrlCopy.pathname, /\/555\/copies$/);
assert.equal(adSetUrlCopy.searchParams.get("campaign_id"), "900");
assert.equal(adSetUrlCopy.searchParams.get("deep_copy"), "true");
assert.equal(
  adSetUrlCopy.searchParams.get("status_option"),
  "INHERITED_FROM_SOURCE",
  "saklar ad set tetap seperti aslinya; campaign salinan yang menahannya",
);

// Deep copy MELEWATKAN iklan tanpa error kalau izin Halaman kurang — `adIds` kosong, bukan dikarang.
globalThis.fetch = async () => ({
  ok: true,
  text: async () => JSON.stringify({ copied_adset_id: "903", ad_object_ids: [{ ad_object_type: "ad_set", copied_id: "903" }] }),
});
assert.deepEqual(await copyAdSetInto("555", "tok", { campaignId: "900" }), { adSetId: "903", adIds: [] });
await assert.rejects(() => copyAdSetInto("555", "tok", { campaignId: "" }), /campaign tujuan kosong/);
await assert.rejects(() => copyAdSetInto("", "tok", { campaignId: "900" }), /kosong/);

console.log("meta staged copy tests ok");

// --- Form edit ---------------------------------------------------------------------------
globalThis.fetch = async (url) => {
  assert.match(String(url), /fields=id%2Cname%2Cstatus%2Cdaily_budget%2Clifetime_budget%2Caccount_id/);
  return {
    ok: true,
    text: async () => JSON.stringify({
      id: "120210", name: "TvH1-06", status: "ACTIVE", daily_budget: "5000000", lifetime_budget: "0", account_id: "123",
    }),
  };
};
assert.deepEqual(await fetchCampaignForEdit("120210", "tok"), {
  id: "120210",
  name: "TvH1-06",
  status: "ACTIVE",
  dailyBudget: 50000,
  // "0" dari Meta berarti "bukan jenis anggaran ini", bukan dianggarkan nol rupiah.
  lifetimeBudget: null,
  accountId: "123",
});

let editCall = "";
globalThis.fetch = async (url, options) => {
  editCall = `${options?.method || "GET"} ${url}`;
  return { ok: true, text: async () => JSON.stringify({ success: true }) };
};
assert.deepEqual(await updateCampaign("120210", "tok", { name: "TvH1-07", dailyBudget: 75000 }), { id: "120210" });
assert.match(editCall, /^POST .*\/120210\?/);
assert.match(editCall, /name=TvH1-07/);
assert.match(editCall, /daily_budget=7500000/, "satuan utuh dikali META_MINOR_UNIT");
await assert.rejects(() => updateCampaign("120210", "tok", {}), /Tidak ada yang diubah/);

globalThis.fetch = async () => ({
  ok: true,
  text: async () => JSON.stringify({
    id: "555", name: "Adset 1", campaign_id: "120210", status: "ACTIVE", daily_budget: "10000",
    targeting: { age_min: 18, geo_locations: { countries: ["TR"] }, flexible_spec: [{ interests: [{ id: "1" }] }] },
  }),
});
const editAdSet = await fetchAdSetForEdit("555", "tok");
assert.equal(editAdSet.campaignId, "120210");
assert.equal(editAdSet.dailyBudget, 100);
assert.equal(editAdSet.lifetimeBudget, null);
assert.deepEqual(editAdSet.targeting.flexible_spec, [{ interests: [{ id: "1" }] }], "targeting utuh, bukan sepotong");

let adSetUrl;
globalThis.fetch = async (url) => {
  adSetUrl = new URL(String(url));
  return { ok: true, text: async () => JSON.stringify({ success: true }) };
};
await updateAdSet("555", "tok", { targeting: { geo_locations: { countries: ["MX"] }, age_min: 21 } });
assert.deepEqual(JSON.parse(adSetUrl.searchParams.get("targeting")), {
  geo_locations: { countries: ["MX"] },
  age_min: 21,
});

console.log("meta edit tests ok");
