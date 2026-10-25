import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// meta.js membaca jedanya saat diimpor.
process.env.META_MIN_INTERVAL_MS = "0";
const { runCreateJob, startCreateJob, startResumeCreateJob, sweepCreateJobs } = await import(
  "./campaign-create-jobs.mjs",
);
const { createPlan } = await import("./campaign-create-core.js");
const { JobConflict } = await import("./campaign-jobs.mjs");
const { RuleError } = await import("./campaign-manage-core.js");
const { buildCodeIndex } = await import("./sync-core.js");

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

const reply = (body, ok = true, status = ok ? 200 : 400) => ({
  ok,
  status,
  text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
});

function metaStub(overrides = {}) {
  const calls = [];
  const routes = {
    "GET /act_1/campaigns": () => [{ data: [{ id: "1", name: "Campaign lain" }] }],
    "POST /act_1/campaigns": () => [{ id: "900" }],
    "POST /act_1/adsets": () => [{ id: "901" }],
    "POST /act_1/adcreatives": () => [{ id: "902" }],
    "POST /act_1/ads": () => [{ id: "903" }],
    ...overrides,
  };
  globalThis.fetch = async (url, options) => {
    const u = new URL(String(url));
    const key = `${options?.method || "GET"} ${u.pathname.replace(/^\/v25\.0/, "")}`;
    const body =
      options?.body instanceof URLSearchParams ? Object.fromEntries(options.body) : null;
    calls.push({ key, body, params: u.searchParams });
    const route = routes[key];
    if (!route) throw new Error(`panggilan tak terduga: ${key}`);
    const [payload, ok = true, status] = route(u, body);
    return reply(payload, ok, status);
  };
  return calls;
}

const { byCode } = buildCodeIndex({ a: { name: "puppy.petcins.com", campaignCodes: "TvH1" } });
const ACCOUNT = { id: "k1", actId: "act_1", name: "BD - R42" };
const jobsOf = (store) => store.state.dashboard?.campaignCreateJobs || {};

const plan = (over = {}) =>
  createPlan({
    name: "TvH1-01 Pros MEA",
    subDomain: "puppy.petcins.com",
    link: "https://rabbitracing.live/ZLgYTvH1?bit=[race]",
    dailyBudget: 20000,
    countries: ["SA"],
    pageId: "1273663929164175",
    pixelId: "18101796",
    images: ["655f6c906d879542426cda089148081c", "d16335b38b494ba385d99443ecb3701f"],
    cta: "WATCH_MORE",
    variants: [
      { title: "Judul A", body: "Body A" },
      { title: "Judul B", body: "Body B" },
    ],
    byCode,
    ...over,
  });

const start = (store) =>
  startCreateJob(store, "tok", { plan: plan(), account: ACCOUNT, requestedBy: "super@r.live" });

test("start: job requested ditulis sebelum satu pun tulisan ke Meta", async () => {
  const store = fakeStore();
  const calls = metaStub();
  const { jobId } = await start(store);
  assert.equal(
    calls.some((call) => call.key.startsWith("POST")),
    false,
    "start tidak boleh menulis ke Meta",
  );
  const job = jobsOf(store)[jobId];
  assert.equal(job.state, "requested");
  assert.equal(job.variants, 2);
  assert.equal(job.subDomain, "puppy.petcins.com");
});

test("start: nama yang sudah dipakai campaign lain di akun itu ditolak", async () => {
  const store = fakeStore();
  metaStub({
    "GET /act_1/campaigns": () => [{ data: [{ id: "1", name: "tvh1-01 PROS mea" }] }],
  });
  await assert.rejects(() => start(store), RuleError);
  assert.deepEqual(jobsOf(store), {}, "tidak ada job yang ditulis");
});

test("start: job yang masih berjalan untuk nama yang sama ditolak tanpa menyentuh Meta", async () => {
  const store = fakeStore({
    dashboard: {
      campaignCreateJobs: { j0: { state: "running", accountId: "k1", name: "TvH1-01 Pros MEA" } },
    },
  });
  const calls = metaStub();
  await assert.rejects(() => start(store), JobConflict);
  assert.equal(calls.length, 0);
});

test("run: campaign lalu ad set + creative + iklan per variasi, semuanya PAUSED", async () => {
  const store = fakeStore();
  const calls = metaStub({
    "POST /act_1/adsets": () => [{ id: `set${calls.filter((c) => c.key.endsWith("adsets")).length}` }],
  });
  const synced = [];
  const { jobId } = await start(store);
  const out = await runCreateJob(store, "tok", {
    jobId,
    plan: plan(),
    account: ACCOUNT,
    enqueueSync: (id) => synced.push(id),
  });
  assert.equal(out.state, "done");
  assert.equal(out.campaignId, "900");
  assert.equal(out.adSets.length, 2);
  assert.deepEqual(synced, ["k1"], "akunnya masuk antrean sync supaya barisnya muncul di tabel");

  const created = calls.filter((call) => call.key.startsWith("POST"));
  assert.deepEqual(
    created.map((call) => call.key),
    [
      "POST /act_1/campaigns",
      "POST /act_1/adsets",
      "POST /act_1/adcreatives",
      "POST /act_1/ads",
      "POST /act_1/adsets",
      "POST /act_1/adcreatives",
      "POST /act_1/ads",
    ],
  );
  // Parameternya di BADAN, bukan di query string: asset_feed_spec + targeting tidak muat di URL.
  assert.equal(created[0].params.get("name"), null);
  assert.equal(created[0].body.status, "PAUSED");
  assert.equal(created[1].body.campaign_id, "900");
  assert.equal(created[1].body.name, "TvH1-01 Pros MEA #1");
  assert.equal(JSON.parse(created[2].body.asset_feed_spec).titles[0].text, "Judul A");
  assert.equal(created[3].body.status, "PAUSED");

  const job = jobsOf(store)[jobId];
  assert.equal(job.state, "done");
  assert.equal(job.campaignId, "900");
  assert.equal(job.progress.done, 2);
});

test("run: campaign yang ditolak Meta tidak melahirkan satu pun ad set", async () => {
  const store = fakeStore();
  const calls = metaStub({
    "POST /act_1/campaigns": () => [
      { error: { message: "Invalid parameter", code: 100, error_subcode: 1885183 } },
      false,
    ],
  });
  const { jobId } = await start(store);
  const out = await runCreateJob(store, "tok", { jobId, plan: plan(), account: ACCOUNT });
  assert.equal(out.state, "failed");
  assert.equal(calls.filter((call) => call.key.endsWith("adsets")).length, 0);
  // Sebab App Mode diterjemahkan, bukan diteruskan sebagai kalimat Meta yang tidak menunjuk siapa pun.
  assert.match(jobsOf(store)[jobId].error, /Development Mode/);
});

test("run: creative yang ditolak menyisakan ad set yang sudah lahir, dan job jadi partial", async () => {
  const store = fakeStore();
  metaStub({
    "POST /act_1/adcreatives": () => [
      { error: { message: "Invalid parameter", code: 100, error_subcode: 1885183 } },
      false,
    ],
  });
  const { jobId } = await start(store);
  const out = await runCreateJob(store, "tok", { jobId, plan: plan(), account: ACCOUNT });
  assert.equal(out.state, "partial");
  // Yang sudah lahir DISEBUTKAN — bukan dihapus diam-diam, dan bukan hilang dari catatan.
  assert.equal(out.adSets[0].adSetId, "901");
  assert.equal(out.adSets[0].adId, "");
  assert.match(out.error, /0 dari 2 iklan lahir; campaign 900 berdiri PAUSED/);
  assert.match(jobsOf(store)[jobId].adSets[0].error, /Development Mode/);
});

test("run: kegagalan yang hasilnya TIDAK PASTI jadi unknown, bukan failed", async () => {
  const store = fakeStore();
  metaStub({
    "POST /act_1/campaigns": () => ["<!DOCTYPE html><html>502</html>", false, 502],
  });
  const { jobId } = await start(store);
  const out = await runCreateJob(store, "tok", { jobId, plan: plan(), account: ACCOUNT });
  assert.equal(out.state, "unknown");
  assert.match(jobsOf(store)[jobId].error, /balasan non-JSON/);
});

test("sweep: job menggantung jadi unknown, yang lewat 7 hari dibuang", async () => {
  const now = new Date("2026-09-12T10:00:00.000Z");
  const store = fakeStore({
    dashboard: {
      campaignCreateJobs: {
        jhang: { state: "requested", requestedAt: "2026-09-12T09:00:00.000Z" },
        jold: { state: "done", requestedAt: "2026-09-01T09:00:00.000Z" },
        jnew: { state: "done", requestedAt: "2026-09-12T09:00:00.000Z" },
      },
    },
  });
  assert.deepEqual(await sweepCreateJobs(store, { now }), { changed: 2 });
  assert.equal(jobsOf(store).jhang.state, "unknown");
  assert.match(jobsOf(store).jhang.error, /periksa Ads Manager/);
  assert.equal(jobsOf(store).jold, undefined);
  assert.equal(jobsOf(store).jnew.state, "done");
});

test("setiap field job yang ditulis disebut aturan database", async () => {
  const { rules } = JSON.parse(
    await readFile(new URL("../database.rules.json", import.meta.url), "utf8"),
  );
  const jobRule = rules.dashboard.campaignCreateJobs.$jobId;
  assert.match(jobRule[".validate"], /j\[0-9a-z\]\{5,20\}/);
  // Kosakata state-nya sama dengan yang ditulis kode — beda sedikit, tulisannya ditolak database dan
  // job-nya membeku di status sebelumnya tanpa satu pun pesan di layar.
  for (const state of ["requested", "running", "done", "partial", "failed", "unknown"]) {
    assert.ok(jobRule.state[".validate"].includes(state), `state ${state} tidak disebut aturan`);
  }

  const store = fakeStore();
  metaStub({
    ...{ "GET /act_1/campaigns": () => [{ data: [] }] },
    "POST /act_1/campaigns": () => [{ id: "900" }],
    "POST /act_1/adsets": () => [{ id: "901" }],
    "POST /act_1/adcreatives": () => [
      { error: { message: "Invalid parameter", code: 100, error_subcode: 1885183 } },
      false,
    ],
  });
  const { jobId } = await start(store);
  await runCreateJob(store, "tok", { jobId, plan: plan(), account: ACCOUNT });
  const job = jobsOf(store)[jobId];
  for (const key of Object.keys(job)) assert.ok(jobRule[key], `${key} tidak disebut aturan database`);
  for (const key of Object.keys(job.progress))
    assert.ok(jobRule.progress[key], `progress/${key} tidak disebut`);
  for (const row of job.adSets) {
    for (const key of Object.keys(row))
      assert.ok(jobRule.adSets.$i[key], `adSets/${key} tidak disebut`);
  }
});

test("lanjutkan: yang partial dibuat dari rencana tersimpan, tanpa campaign atau ad set kembar", async () => {
  const store = fakeStore();
  metaStub({
    "POST /act_1/adcreatives": () => [
      { error: { message: "Invalid parameter", code: 100, error_subcode: 1885183 } },
      false,
    ],
  });
  const { jobId } = await start(store);
  await runCreateJob(store, "tok", { jobId, plan: plan(), account: ACCOUNT });
  assert.equal(jobsOf(store)[jobId].state, "partial");

  // Sebabnya sudah dibereskan di Meta; yang tersisa cuma creative + iklan tiap variasi.
  const calls = metaStub();
  const { resume } = await startResumeCreateJob(store, jobId);
  assert.equal(jobsOf(store)[jobId].state, "requested");
  const out = await runCreateJob(store, "tok", { jobId, plan: resume.plan, account: ACCOUNT, resume });
  assert.equal(out.state, "done");
  assert.equal(out.campaignId, "900");
  assert.deepEqual(
    calls.filter((call) => call.key.startsWith("POST")).map((call) => call.key),
    ["POST /act_1/adcreatives", "POST /act_1/ads", "POST /act_1/adcreatives", "POST /act_1/ads"],
  );
  assert.equal(out.adSets[0].adSetId, "901", "ad set yang sudah lahir dipakai, bukan dibuat lagi");
});

test("lanjutkan: ditolak untuk job yang tidak partial, dan untuk job lama tanpa rencana", async () => {
  const store = fakeStore({
    dashboard: {
      campaignCreateJobs: {
        jdone1: { state: "done", campaignId: "9", plan: "{}" },
        jold01: { state: "partial", campaignId: "9", adSets: [{ name: "a", error: "x" }] },
      },
    },
  });
  await assert.rejects(() => startResumeCreateJob(store, "jdone1"), /SEBAGIAN/);
  await assert.rejects(() => startResumeCreateJob(store, "jold01"), /rencananya tidak tersimpan/);
});
