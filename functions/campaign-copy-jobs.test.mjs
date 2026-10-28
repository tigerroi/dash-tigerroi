import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// meta.js membaca jedanya saat diimpor.
process.env.META_MIN_INTERVAL_MS = "0";
const { runCopyJob, startCopyJob, sweepCopyJobs } = await import("./campaign-copy-jobs.mjs");
const { JobConflict } = await import("./campaign-jobs.mjs");
const { RuleError } = await import("./campaign-manage-core.js");

function fakeStore(data = {}) {
  const state = structuredClone(data);
  const at = (path) => path.split("/").reduce((node, key) => node?.[key], state);
  return {
    state,
    read: async (path) => structuredClone(at(path) ?? null),
    update: async (path, values) => {
      for (const [key, value] of Object.entries(values)) {
        const parts = `${path}/${key}`.split("/");
        const last = parts.pop();
        let node = state;
        for (const part of parts) node = node[part] ??= {};
        if (value === null) delete node[last];
        else node[last] = structuredClone(value);
      }
    },
  };
}

// `[body, ok?, status?]`; body string = balasan mentah (mis. halaman HTML dari edge).
const reply = (body, ok = true, status = ok ? 200 : 400) => ({
  ok,
  status,
  text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
});
const ROW = { campaignId: "120210", campaign: "TvH1-06 Pros" };
const ACCOUNT = { id: "k1", actId: "act_1" };
const jobsOf = (store) => store.state.dashboard?.campaignCopyJobs || {};

// Kunci rute: "METHOD /path" tanpa versi. Nilai: fungsi (url) => [body, ok?].
function metaStub(overrides = {}) {
  const calls = [];
  const routes = {
    "GET /act_1/campaigns": () => [
      {
        data: [
          { id: "120210", name: "TvH1-06 Pros" },
          { id: "120300", name: "TvH1-08 Pros" },
        ],
      },
    ],
    "GET /120210/adsets": () => [
      {
        data: [
          { id: "s1", name: "Adset 1", status: "ACTIVE" },
          { id: "s2", name: "Adset 2", status: "PAUSED" },
        ],
      },
    ],
    "GET /120210/ads": () => [
      {
        data: [
          {
            id: "a1",
            name: "Iklan 1",
            adset_id: "s1",
            status: "ACTIVE",
            creative: { id: "cr1", object_story_spec: { page_id: "p1" } },
          },
          {
            id: "a2",
            name: "Iklan 2",
            adset_id: "s2",
            status: "PAUSED",
            creative: { id: "cr2", object_story_spec: { page_id: "p2" } },
          },
        ],
      },
    ],
    "POST /120210/copies": () => [{ copied_campaign_id: "900" }],
    "POST /s1/copies": () => [
      { copied_adset_id: "901", ad_object_ids: [{ ad_object_type: "ad", copied_id: "911" }] },
    ],
    "POST /s2/copies": () => [
      { copied_adset_id: "902", ad_object_ids: [{ ad_object_type: "ad", copied_id: "912" }] },
    ],
    "POST /900": () => [{ success: true }],
    // Iklan yang dibuatkan ulang dari creative sumbernya (pemulihan salinan).
    "POST /act_1/ads": () => [{ id: "ad_baru" }],
    ...overrides,
  };
  globalThis.fetch = async (url, options) => {
    const u = new URL(String(url));
    const key = `${options?.method || "GET"} ${u.pathname.replace(/^\/v25\.0/, "")}`;
    // Pembuatan objek mengirim parameternya di BODY (`graphPostForm`), bukan di URL: tanpa
    // membacanya, tes tidak bisa membuktikan creative mana yang dipakai iklan pemulihan.
    const sent = options?.body instanceof URLSearchParams ? options.body : new URLSearchParams();
    calls.push({ key, params: u.searchParams, body: sent });
    const route = routes[key];
    if (!route) throw new Error(`panggilan tak terduga: ${key}`);
    const [body, ok = true, status] = route(u);
    return reply(body, ok, status);
  };
  return calls;
}

async function started(store, calls, names = ["TvH1-07 Pros"]) {
  const { jobId, plan } = await startCopyJob(store, "tok", {
    userId: "u_nur",
    row: ROW,
    account: ACCOUNT,
    names,
    requestedBy: "super@r.live",
  });
  return { jobId, plan, calls };
}

test("start: job requested ditulis sebelum satu pun tulisan ke Meta", async () => {
  const store = fakeStore();
  const calls = metaStub();
  const { jobId, plan } = await started(store, calls);
  assert.equal(
    calls.some((call) => call.key.startsWith("POST")),
    false,
    "start tidak menulis ke Meta",
  );
  assert.deepEqual(
    plan.adSets.map((set) => set.id),
    ["s1", "s2"],
  );
  const job = jobsOf(store)[jobId];
  assert.equal(job.state, "requested");
  assert.equal(job.adSetCount, 2);
  assert.equal(job.adCount, 2);
});

test("start: salinan yang masih berjalan untuk sumber yang sama ditolak tanpa menyentuh Meta", async () => {
  const store = fakeStore({
    dashboard: { campaignCopyJobs: { jold: { sourceCampaignId: "120210", state: "running" } } },
  });
  const calls = metaStub();
  await assert.rejects(() => started(store, calls), JobConflict);
  assert.equal(calls.length, 0);
});

test("start: ad set di atas 3 iklan ditolak dan tidak ada job yang ditulis", async () => {
  const store = fakeStore();
  metaStub({
    "GET /120210/ads": () => [
      {
        data: Array.from({ length: 4 }, (_, i) => ({
          id: `a${i}`,
          adset_id: "s1",
          status: "ACTIVE",
        })),
      },
    ],
  });
  await assert.rejects(() => started(store, []), RuleError);
  assert.deepEqual(jobsOf(store), {});
});

test("start: nama yang sudah dipakai campaign lain di akun itu ditolak sebelum job ditulis", async () => {
  const store = fakeStore();
  const calls = metaStub();
  // Nama sumbernya sendiri: sync akan melebur sumber dan salinannya jadi satu baris.
  await assert.rejects(
    () => started(store, calls, ["tvh1-06 pros "]),
    /Nama "tvh1-06 pros" sudah dipakai campaign lain.*melebur/,
  );
  await assert.rejects(
    () => started(store, calls, ["TvH1-07 Pros #1", "TvH1-08 Pros"]),
    /"TvH1-08 Pros"/,
  );
  assert.deepEqual(jobsOf(store), {});
  assert.equal(
    calls.some((call) => call.key.startsWith("POST")),
    false,
  );
  assert.equal(
    calls.some((call) => call.key === "GET /120210/adsets"),
    false,
    "diperiksa sebelum rencana salin",
  );
});

test("start: nama yang akan lahir dari job lain yang masih berjalan di akun itu ikut dihitung", async () => {
  const jobs = {
    jother: {
      sourceCampaignId: "120300",
      accountId: "k1",
      state: "running",
      names: ["TvH1-07 Pros"],
    },
    jdone: { sourceCampaignId: "120300", accountId: "k1", state: "done", names: ["TvH1-09 Pros"] },
    jelse: { sourceCampaignId: "5", accountId: "k2", state: "running", names: ["TvH1-10 Pros"] },
  };
  const store = fakeStore({ dashboard: { campaignCopyJobs: jobs } });
  const calls = metaStub();
  await assert.rejects(() => started(store, calls, ["TvH1-07 Pros"]), RuleError);
  await started(store, calls, ["TvH1-09 Pros"]);
  await started(fakeStore({ dashboard: { campaignCopyJobs: jobs } }), calls, ["TvH1-10 Pros"]);
});

test("start: daftar campaign akun gagal dibaca — melempar, bukan diloloskan", async () => {
  const store = fakeStore();
  metaStub({
    "GET /act_1/campaigns": () => [
      { error: { message: "Invalid OAuth access token", code: 190 } },
      false,
    ],
  });
  await assert.rejects(
    () => started(store, []),
    (error) => !(error instanceof RuleError) && /act_1\/campaigns.*#190/.test(error.message),
  );
  assert.deepEqual(jobsOf(store), {});
});

test("run: campaign kosong bernama sementara, langsung ganti nama, lalu tiap ad set — hasilnya done", async () => {
  const store = fakeStore();
  const calls = metaStub();
  const { jobId, plan } = await started(store, calls);
  const synced = [];
  const result = await runCopyJob(store, "tok", {
    jobId,
    row: ROW,
    account: ACCOUNT,
    names: ["TvH1-07 Pros"],
    plan,
    enqueueSync: (id) => synced.push(id),
  });
  assert.equal(result.state, "done");
  const posts = calls.filter((call) => call.key.startsWith("POST")).map((call) => call.key);
  assert.deepEqual(posts, [
    "POST /120210/copies",
    "POST /900",
    "POST /s1/copies",
    "POST /s2/copies",
  ]);
  const shell = calls.find((call) => call.key === "POST /120210/copies").params;
  assert.equal(shell.get("deep_copy"), "false");
  assert.deepEqual(JSON.parse(shell.get("rename_options")), {
    rename_strategy: "ONLY_TOP_LEVEL_RENAME",
    rename_suffix: ` (salinan ${jobId}-1)`,
  });
  assert.equal(
    calls.find((call) => call.key === "POST /s1/copies").params.get("campaign_id"),
    "900",
  );
  assert.equal(calls.find((call) => call.key === "POST /900").params.get("name"), "TvH1-07 Pros");
  const job = jobsOf(store)[jobId];
  assert.equal(job.state, "done");
  assert.deepEqual(job.progress, { done: 2, total: 2 });
  assert.deepEqual(job.copies[0], {
    name: "TvH1-07 Pros",
    campaignId: "900",
    adSets: 2,
    adSetsExpected: 2,
    ads: 2,
    adsExpected: 2,
    error: "",
    renameError: "",
  });
  assert.deepEqual(synced, ["k1"]);
});

test("run: iklan yang dilewati Meta dibuatkan ulang dari creative iklan SUMBERNYA", async () => {
  const store = fakeStore();
  const calls = metaStub({
    "POST /s2/copies": () => [{ copied_adset_id: "902", ad_object_ids: [] }],
  });
  const { jobId, plan } = await started(store, calls);
  const synced = [];
  const result = await runCopyJob(store, "tok", {
    jobId,
    row: ROW,
    account: ACCOUNT,
    names: ["A"],
    plan,
    enqueueSync: (id) => synced.push(id),
  });
  // Deep copy melewatkan iklannya (app Development Mode menolak tiap creative baru), tapi salinannya
  // tetap utuh: iklannya dibuatkan sendiri dengan creative yang sudah ada.
  assert.equal(result.state, "done");
  assert.equal(jobsOf(store)[jobId].copies[0].ads, 2);
  const made = calls.filter((call) => call.key === "POST /act_1/ads");
  assert.equal(made.length, 1, "cuma ad set yang kehilangan iklannya yang dipulihkan");
  assert.deepEqual(JSON.parse(made[0].body.get("creative")), { creative_id: "cr2" });
  assert.equal(made[0].body.get("adset_id"), "902", "lahir di ad set SALINAN, bukan di sumbernya");
  assert.equal(made[0].body.get("name"), "Iklan 2");
  // Saklarnya mengikuti iklan sumber (`INHERITED_FROM_SOURCE`), bukan dipaksa PAUSED: satu iklan mati
  // di dalam ad set yang menyala adalah "ad set aktif tapi Rp 0" yang tidak menyebut sebabnya.
  assert.equal(made[0].body.get("status"), "PAUSED");
  // Salinan yang kosong tidak perlu ditanyai nama iklannya — tidak ada yang bisa kembar.
  assert.equal(
    calls.some((call) => call.key === "GET /902/ads"),
    false,
  );
  assert.deepEqual(synced, ["k1"], "salinannya tetap ada, jadi akunnya tetap disync");
});

test("run: pemulihan yang ditolak izin Halaman menyebut Halamannya, bukan App Mode", async () => {
  const store = fakeStore();
  const calls = metaStub({
    "POST /s2/copies": () => [{ copied_adset_id: "902", ad_object_ids: [] }],
    "POST /act_1/ads": () => [
      { error: { message: "Invalid parameter", code: 100, error_subcode: 1885499 } },
      false,
    ],
  });
  const { jobId, plan } = await started(store, calls);
  const result = await runCopyJob(store, "tok", {
    jobId,
    row: ROW,
    account: ACCOUNT,
    names: ["A"],
    plan,
  });
  assert.equal(result.state, "partial");
  const { error } = jobsOf(store)[jobId].copies[0];
  assert.match(error, /Iklan 2.*Halaman p2/, "menyebut iklan dan Halaman yang harus diberi izin");
  assert.match(error, /akses Iklan \(Create ads\)/);
  assert.doesNotMatch(error, /App Mode/, "penyebabnya bukan lagi mode app");
});

test("run: salinan yang melahirkan SEBAGIAN iklannya tidak dibuatkan kembarannya", async () => {
  const store = fakeStore();
  const calls = metaStub({
    // Ad set sumber s1 punya satu iklan dan salinannya melahirkannya; s2 tidak melahirkan apa pun.
    "GET /120210/adsets": () => [{ data: [{ id: "s1", name: "Adset 1", status: "ACTIVE" }] }],
    "GET /120210/ads": () => [
      {
        data: [
          { id: "a1", name: "Iklan 1", adset_id: "s1", status: "ACTIVE", creative: { id: "cr1" } },
          { id: "a2", name: "Iklan 2", adset_id: "s1", status: "ACTIVE", creative: { id: "cr2" } },
        ],
      },
    ],
    "POST /s1/copies": () => [
      { copied_adset_id: "901", ad_object_ids: [{ ad_object_type: "ad", copied_id: "911" }] },
    ],
    "GET /901/ads": () => [{ data: [{ id: "911", name: "Iklan 1" }] }],
  });
  const { jobId, plan } = await started(store, calls);
  const result = await runCopyJob(store, "tok", {
    jobId,
    row: ROW,
    account: ACCOUNT,
    names: ["A"],
    plan,
  });
  assert.equal(result.state, "done");
  const made = calls.filter((call) => call.key === "POST /act_1/ads");
  assert.equal(made.length, 1, "yang sudah berdiri tidak dibuat ulang");
  assert.deepEqual(JSON.parse(made[0].body.get("creative")), { creative_id: "cr2" });
});

test("run: iklan lebih di satu ad set tidak menutupi iklan yang hilang di ad set lain", async () => {
  const store = fakeStore();
  const calls = metaStub({
    "POST /s1/copies": () => [
      {
        copied_adset_id: "901",
        ad_object_ids: [
          { ad_object_type: "ad", copied_id: "911" },
          { ad_object_type: "ad", copied_id: "913" },
        ],
      },
    ],
    "POST /s2/copies": () => [{ copied_adset_id: "902", ad_object_ids: [] }],
  });
  const { jobId, plan } = await started(store, calls);
  const result = await runCopyJob(store, "tok", {
    jobId,
    row: ROW,
    account: ACCOUNT,
    names: ["A"],
    plan,
  });
  // s1 melahirkan dua iklan untuk satu iklan sumber; kelebihan itu TIDAK dihitung sebagai iklan s2,
  // jadi s2 tetap dipulihkan sendiri.
  assert.equal(result.state, "done");
  assert.equal(jobsOf(store)[jobId].copies[0].ads, 2);
  const made = calls.filter((call) => call.key === "POST /act_1/ads");
  assert.deepEqual(
    made.map((call) => call.body.get("adset_id")),
    ["902"],
  );
});

test("run: ganti nama yang gagal membuat salinan partial, ad set tetap disalin", async () => {
  const store = fakeStore();
  const calls = metaStub({
    "POST /900": () => [{ error: { message: "Invalid name", code: 100 } }, false],
  });
  const { jobId, plan } = await started(store, calls);
  const synced = [];
  const result = await runCopyJob(store, "tok", {
    jobId,
    row: ROW,
    account: ACCOUNT,
    names: ["TvH1-07 Pros"],
    plan,
    enqueueSync: (id) => synced.push(id),
  });
  assert.equal(result.state, "partial");
  assert.ok(
    calls.some((call) => call.key === "POST /s2/copies"),
    "ad set tetap disalin sesudah ganti nama gagal",
  );
  const job = jobsOf(store)[jobId];
  assert.match(job.copies[0].renameError, /Invalid name/);
  assert.equal(job.copies[0].adSets, 2);
  assert.match(job.error, /masih bernama sementara.*"TvH1-07 Pros".*Invalid name/);
  assert.deepEqual(synced, ["k1"]);
});

test("run: salinan dicatat di job begitu lahir, sebelum ad set pertama disalin", async () => {
  const store = fakeStore();
  let recorded;
  const calls = metaStub({
    "POST /s1/copies": () => {
      recorded = structuredClone(Object.values(jobsOf(store))[0].copies?.[0]);
      return [
        { copied_adset_id: "901", ad_object_ids: [{ ad_object_type: "ad", copied_id: "911" }] },
      ];
    },
  });
  const { jobId, plan } = await started(store, calls);
  await runCopyJob(store, "tok", {
    jobId,
    row: ROW,
    account: ACCOUNT,
    names: ["TvH1-07 Pros"],
    plan,
  });
  assert.equal(recorded?.campaignId, "900");
  assert.equal(recorded?.name, "TvH1-07 Pros");
  assert.equal(recorded?.adSetsExpected, 2);
  assert.equal(recorded?.adsExpected, 2);
});

test("run: tulisan progres yang gagal tidak menghilangkan salinan yang sudah lahir", async () => {
  const store = fakeStore();
  const calls = metaStub();
  const { jobId, plan } = await started(store, calls);
  const update = store.update;
  store.update = async (path, values) => {
    if (values.progress && !values.state) throw new Error("PERMISSION_DENIED");
    return update(path, values);
  };
  const errors = [];
  const result = await runCopyJob(store, "tok", {
    jobId,
    row: ROW,
    account: ACCOUNT,
    names: ["TvH1-07 Pros"],
    plan,
    log: { error: (text) => errors.push(text) },
  });
  assert.equal(result.state, "done");
  assert.equal(jobsOf(store)[jobId].copies[0].campaignId, "900");
  assert.equal(errors.length, 2, "tiap tulisan progres yang gagal dicatat");
});

for (const [label, route] of [
  ["kode 1", () => [{ error: { message: "An unknown error occurred", code: 1 } }, false, 500]],
  [
    "kode 2",
    () => [{ error: { message: "Service temporarily unavailable", code: 2 } }, false, 503],
  ],
  ["halaman HTML", () => ["<!DOCTYPE html><html><body>502 Bad Gateway</body></html>", false, 502]],
  ["HTTP 5xx tanpa badan", () => ["", false, 504]],
  [
    "jaringan putus",
    () => {
      throw new TypeError("fetch failed");
    },
  ],
]) {
  test(`run: salin campaign yang hasilnya tidak pasti (${label}) → unknown, bukan failed`, async () => {
    const store = fakeStore();
    const calls = metaStub({ "POST /120210/copies": route });
    const { jobId, plan } = await started(store, calls, ["A #1", "A #2"]);
    const synced = [];
    const result = await runCopyJob(store, "tok", {
      jobId,
      row: ROW,
      account: ACCOUNT,
      names: ["A #1", "A #2"],
      plan,
      enqueueSync: (id) => synced.push(id),
    });
    assert.equal(result.state, "unknown");
    const job = jobsOf(store)[jobId];
    assert.equal(job.copies[0].uncertain, true);
    assert.match(job.copies[0].error, /periksa Ads Manager\.$/);
    assert.match(job.error, /periksa Ads Manager\.$/);
    assert.equal(
      calls.filter((call) => call.key === "POST /120210/copies").length,
      1,
      "tidak dicoba lagi",
    );
    assert.deepEqual(synced, ["k1"], "kalau ternyata lahir, sync memunculkannya");
  });
}

test("run: ad set yang ditolak Meta tidak menghentikan ad set lain", async () => {
  const store = fakeStore();
  const calls = metaStub({
    "POST /s1/copies": () => [
      { error: { message: "Application does not have permission for this action", code: 10 } },
      false,
    ],
  });
  const { jobId, plan } = await started(store, calls);
  const result = await runCopyJob(store, "tok", {
    jobId,
    row: ROW,
    account: ACCOUNT,
    names: ["A"],
    plan,
  });
  assert.equal(result.state, "partial");
  assert.ok(
    calls.some((call) => call.key === "POST /s2/copies"),
    "ad set berikutnya tetap dicoba",
  );
  assert.match(jobsOf(store)[jobId].copies[0].error, /^Adset 1: /);
});

test("run: campaign yang gagal disalin menghentikan salinan berikutnya, tanpa sync", async () => {
  const store = fakeStore();
  const calls = metaStub({
    "POST /120210/copies": () => [{ error: { message: "Invalid parameter", code: 100 } }, false],
  });
  const { jobId, plan } = await started(store, calls, ["A #1", "A #2"]);
  const synced = [];
  const result = await runCopyJob(store, "tok", {
    jobId,
    row: ROW,
    account: ACCOUNT,
    names: ["A #1", "A #2"],
    plan,
    enqueueSync: (id) => synced.push(id),
  });
  assert.equal(result.state, "failed");
  assert.equal(
    calls.filter((call) => call.key === "POST /120210/copies").length,
    1,
    "tidak diulang untuk salinan kedua",
  );
  assert.equal(
    jobsOf(store)[jobId].copies[1].error,
    "Tidak dicoba karena salinan sebelumnya gagal.",
  );
  assert.deepEqual(synced, []);
});

test("sweep: yang menggantung jadi unknown, yang lama dibuang", async () => {
  const now = new Date("2026-09-11T10:00:00Z");
  const store = fakeStore({
    dashboard: {
      campaignCopyJobs: {
        jreq: { state: "requested", requestedAt: "2026-09-11T09:45:00.000Z" },
        jrun: {
          state: "running",
          requestedAt: "2026-09-11T09:00:00.000Z",
          startedAt: "2026-09-11T09:00:05.000Z",
        },
        jnew: {
          state: "running",
          requestedAt: "2026-09-11T09:55:00.000Z",
          startedAt: "2026-09-11T09:55:00.000Z",
        },
        // Mulai 50 menit lalu tapi masih bergerak: bukan job yang mati.
        jbig: {
          state: "running",
          requestedAt: "2026-09-11T09:10:00.000Z",
          startedAt: "2026-09-11T09:10:00.000Z",
          updatedAt: "2026-09-11T09:58:00.000Z",
        },
        jold: { state: "done", requestedAt: "2026-09-01T00:00:00.000Z" },
      },
    },
  });
  await sweepCopyJobs(store, { now });
  const jobs = jobsOf(store);
  assert.equal(jobs.jreq.state, "unknown");
  assert.equal(jobs.jrun.state, "unknown");
  assert.equal(jobs.jnew.state, "running");
  assert.equal(jobs.jbig.state, "running");
  assert.equal(jobs.jold, undefined);
});

test("sweep: hanya path yang berubah ditulis — tulisan akhir yang datang bersamaan tidak tertimpa", async () => {
  const now = new Date("2026-09-11T10:00:00Z");
  const store = fakeStore({
    dashboard: {
      campaignCopyJobs: {
        jrun: {
          state: "running",
          sourceCampaignId: "1",
          requestedAt: "2026-09-11T09:00:00.000Z",
          startedAt: "2026-09-11T09:00:05.000Z",
        },
        jold: { state: "done", requestedAt: "2026-09-01T00:00:00.000Z" },
      },
    },
  });
  const read = store.read;
  store.read = async (path) => {
    const snapshot = await read(path);
    // `runCopyJob` menulis salinannya sesudah sweep membaca, sebelum sweep menulis.
    store.state.dashboard.campaignCopyJobs.jrun.copies = [{ name: "A", campaignId: "900" }];
    return snapshot;
  };
  const writes = [];
  const update = store.update;
  store.update = async (path, values) => {
    writes.push(Object.keys(values).sort());
    return update(path, values);
  };
  assert.deepEqual(await sweepCopyJobs(store, { now }), { changed: 2 });
  assert.deepEqual(writes, [
    ["jold", "jrun/error", "jrun/finishedAt", "jrun/state", "jrun/updatedAt"],
  ]);
  const job = jobsOf(store).jrun;
  assert.equal(job.state, "unknown");
  assert.equal(job.copies[0].campaignId, "900", "salinan yang ditulis bersamaan tetap ada");
  assert.equal(jobsOf(store).jold, undefined);
});

test("setiap field job yang ditulis disebut aturan database", async () => {
  const { rules } = JSON.parse(
    await readFile(new URL("../database.rules.json", import.meta.url), "utf8"),
  );
  const jobRule = rules.dashboard.campaignCopyJobs.$jobId;
  assert.match(jobRule[".validate"], /j\[0-9a-z\]\{5,20\}/);

  const check = (job) => {
    for (const key of Object.keys(job))
      assert.ok(jobRule[key], `${key} tidak disebut aturan database`);
    for (const key of Object.keys(job.progress))
      assert.ok(jobRule.progress[key], `progress/${key} tidak disebut`);
    for (const copy of job.copies) {
      for (const key of Object.keys(copy))
        assert.ok(jobRule.copies.$i[key], `copies/${key} tidak disebut`);
    }
  };

  const store = fakeStore();
  const calls = metaStub({
    "POST /s2/copies": () => [{ error: { message: "x", code: 10 } }, false],
  });
  const { jobId, plan } = await started(store, calls);
  await runCopyJob(store, "tok", { jobId, row: ROW, account: ACCOUNT, names: ["A"], plan });
  check(jobsOf(store)[jobId]);

  // Salinan yang hasilnya tidak pasti membawa `uncertain`.
  const unsure = fakeStore();
  const unsureCalls = metaStub({
    "POST /120210/copies": () => [{ error: { message: "x", code: 2 } }, false],
  });
  const second = await started(unsure, unsureCalls, ["A #1", "A #2"]);
  await runCopyJob(unsure, "tok", {
    jobId: second.jobId,
    row: ROW,
    account: ACCOUNT,
    names: ["A #1", "A #2"],
    plan: second.plan,
  });
  const job = jobsOf(unsure)[second.jobId];
  assert.equal(job.copies[0].uncertain, true);
  check(job);
  assert.match(jobRule.copies.$i.uncertain[".validate"], /isBoolean/);
});
