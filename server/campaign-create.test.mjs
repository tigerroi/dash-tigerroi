import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";

// meta.js membaca jeda antarpanggilannya SAAT DIIMPOR; tanpa ini tiap tes menunggu 400 ms per objek
// yang lahir. Karena itu impornya dinamis, sesudah env-nya diset.
process.env.META_MIN_INTERVAL_MS = "0";
const { AuthError } = await import("./auth.js");
const { campaignCreateRoutes } = await import("./campaign-create.js");

// HARUS "localhost" — lihat campaigns.test.mjs.
const URL_BASE = "http://localhost";

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

const LINK = "https://rabbitracing.live/ZLgYTvH1?bit=[race]";
const IMAGES = ["655f6c906d879542426cda089148081c", "d16335b38b494ba385d99443ecb3701f"];
const OTHER_IMAGES = ["aa11bb22cc33dd44ee55ff6600778899", "1122334455667788990011223344556f"];

const DATA = {
  subDomains: {
    s1: { name: "puppy.petcins.com", campaignCodes: "TvH1", campaignUrl: LINK },
    s2: { name: "dog.petcins.com", campaignCodes: "5rx7" },
  },
  adAccounts: {
    k1: { actId: "act_1", name: "BD - R42" },
    k2: { actId: "act_2", name: "Lincah 1241", syncDisabled: "disuspend Meta" },
    k3: { actId: "act_3", name: "Dihapus", deletedAt: "2026-09-01T00:00:00.000Z" },
  },
};

const SUPER = { role: "superadmin", email: "super@r.live", uid: "s1" };

const BODY = {
  accountId: "k1",
  subDomainId: "s1",
  link: LINK,
  name: "TvH1-01 Pros MEA Carrou SM 01",
  dailyBudget: 20000,
  countries: ["SA", "TR"],
  pageId: "1273663929164175",
  pixelId: "1810179687086885",
  images: IMAGES,
  cta: "WATCH_MORE",
  variants: [
    { title: "Judul A", body: "Body A", images: IMAGES },
    { title: "Judul B", body: "Body B", images: OTHER_IMAGES },
  ],
};

function build({ authorize, metaToken = "token", data = DATA } = {}) {
  const store = fakeStore(data);
  const synced = [];
  const runs = [];
  const app = new Elysia().use(
    campaignCreateRoutes({
      db: {},
      store,
      metaToken,
      enqueueSync: (id) => synced.push(id),
      // Tes MENUNGGU pembuatan di latar lewat `runs`; di produksi ia berjalan tanpa ditunggu.
      runInBackground: (task) => runs.push(task()),
      authorize: authorize || (async () => SUPER),
    }),
  );
  return { app, store, synced, runs };
}

function send(app, path, payload) {
  const init =
    payload === undefined
      ? { headers: { authorization: "Bearer t" } }
      : {
          method: "POST",
          headers: { authorization: "Bearer t", "content-type": "application/json" },
          body: JSON.stringify(payload),
        };
  return app.handle(new Request(`${URL_BASE}${path}`, init));
}

function metaStub(routes, onCall = () => {}) {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    const u = new URL(String(url));
    const key = `${options?.method || "GET"} ${u.pathname.replace(/^\/v25\.0/, "")}`;
    const body = options?.body instanceof URLSearchParams ? Object.fromEntries(options.body) : null;
    calls.push({ key, params: u.searchParams, body });
    onCall(key);
    const handler = routes[key];
    if (!handler) throw new Error(`panggilan tak terduga: ${key}`);
    const [payload, ok = true] = handler;
    return Response.json(payload, { status: ok ? 200 : 400 });
  };
  return calls;
}

const ASSETS = {
  "GET /me/accounts": [
    { data: [{ id: "1273663929164175", name: "Sonet Media 01", tasks: ["ADVERTISE", "MANAGE"] }] },
  ],
  "GET /act_1/adspixels": [{ data: [{ id: "1810179687086885", name: "BD - R42" }] }],
  "GET /act_1/adimages": [{ data: [{ hash: IMAGES[0], name: "1.png", status: "ACTIVE" }] }],
};

const CREATE = {
  ...ASSETS,
  "GET /act_1/campaigns": [{ data: [{ id: "1", name: "Campaign lain" }] }],
  "POST /act_1/campaigns": [{ id: "900" }],
  "POST /act_1/adsets": [{ id: "901" }],
  "POST /act_1/adcreatives": [{ id: "902" }],
  "POST /act_1/ads": [{ id: "903" }],
};

const jobsOf = (store) => store.state.dashboard?.campaignCreateJobs || {};

describe("gerbang", () => {
  it("bukan superadmin: 403 dengan kalimat halaman ini, Meta tidak disentuh", async () => {
    const calls = metaStub({});
    const { app } = build({
      authorize: async () => {
        throw new AuthError("Hanya superadmin yang boleh menjalankan gating.", 403);
      },
    });
    const res = await send(app, "/fleet/campaigns", BODY);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Hanya superadmin yang boleh membuat campaign.");
    expect(calls.length).toBe(0);
  });

  it("tanpa META_ACCESS_TOKEN: 503", async () => {
    metaStub({});
    const { app } = build({ metaToken: "" });
    const res = await send(app, "/fleet/campaigns", BODY);
    expect(res.status).toBe(503);
  });
});

describe("ad account", () => {
  it("yang tidak ada di /ad-accounts: 404, dan act_ dari request tidak pernah dipercaya", async () => {
    const calls = metaStub(CREATE);
    const { app } = build();
    const res = await send(app, "/fleet/campaigns", { ...BODY, accountId: "act_1" });
    expect(res.status).toBe(404);
    expect(calls.length).toBe(0);
  });

  it("yang dihapus: 404; yang sync-nya dimatikan: 422 berikut sebabnya", async () => {
    metaStub(CREATE);
    const { app } = build();
    expect((await send(app, "/fleet/campaigns", { ...BODY, accountId: "k3" })).status).toBe(404);
    const res = await send(app, "/fleet/campaigns", { ...BODY, accountId: "k2" });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/disuspend Meta/);
  });
});

describe("bahan yang tidak dipercaya dari request", () => {
  it("link yang tidak tertulis di baris subdomain itu: 422 sebelum Meta disentuh", async () => {
    const calls = metaStub(CREATE);
    const { app } = build();
    const res = await send(app, "/fleet/campaigns", {
      ...BODY,
      link: "https://rabbitracing.live/palsu?bit=[race]",
    });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/bukan salah satu Campaign URL/);
    expect(calls.length).toBe(0);
  });

  it("nama yang kodenya milik subdomain lain: 422", async () => {
    metaStub(CREATE);
    const { app } = build();
    const res = await send(app, "/fleet/campaigns", { ...BODY, name: "5rx7-01 Pros" });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/milik dog\.petcins\.com/);
  });

  it("Halaman yang tidak dipegang System User: 422, dan nol objek lahir", async () => {
    const calls = metaStub(CREATE);
    const { app } = build();
    const res = await send(app, "/fleet/campaigns", { ...BODY, pageId: "999" });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/tidak dipegang System User/);
    expect(calls.filter((call) => call.key.startsWith("POST")).length).toBe(0);
  });

  it("pixel yang bukan milik ad account itu: 422", async () => {
    metaStub(CREATE);
    const { app } = build();
    const res = await send(app, "/fleet/campaigns", { ...BODY, pixelId: "123" });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/bukan milik ad account/);
  });
});

describe("link iklan dan parameternya dipisah", () => {
  const creativeOf = (calls) =>
    JSON.parse(calls.find((call) => call.key === "POST /act_1/adcreatives").body.asset_feed_spec);

  it("alamatnya jadi website_url, parameternya jadi url_tags — dan alamatnya tidak membawa query", async () => {
    const calls = metaStub(CREATE);
    const { app, runs } = build();
    const res = await send(app, "/fleet/campaigns", { ...BODY, urlTags: "bit=[race]&sub1=fb" });
    expect(res.status).toBe(200);
    await Promise.all(runs);
    expect(creativeOf(calls).link_urls).toEqual([
      { website_url: "https://rabbitracing.live/ZLgYTvH1" },
    ]);
    const creative = calls.find((call) => call.key === "POST /act_1/adcreatives").body;
    expect(creative.url_tags).toBe("bit=[race]&sub1=fb");
  });

  it("parameter yang dikosongkan: iklannya lahir tanpa url_tags sama sekali", async () => {
    const calls = metaStub(CREATE);
    const { app, runs } = build();
    // Alamat telanjang, bentuk yang benar-benar dikirim dialog sejak kotaknya dipisah.
    const res = await send(app, "/fleet/campaigns", {
      ...BODY,
      link: "https://rabbitracing.live/ZLgYTvH1",
      urlTags: "",
    });
    expect(res.status).toBe(200);
    await Promise.all(runs);
    const creative = calls.find((call) => call.key === "POST /act_1/adcreatives").body;
    expect(creative.url_tags).toBeUndefined();
  });

  it("link yang tertempel ke kotak parameter: 422 sebelum Meta disentuh", async () => {
    const calls = metaStub(CREATE);
    const { app } = build();
    const res = await send(app, "/fleet/campaigns", { ...BODY, urlTags: "https://x/y?bit=[race]" });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/memuat alamat/);
    expect(calls.length).toBe(0);
  });
});

describe("gambar milik tiap IKLAN", () => {
  const specOf = (calls, at) =>
    JSON.parse(calls.filter((call) => call.key === "POST /act_1/adcreatives")[at].body.asset_feed_spec);

  it("tiap creative membawa carousel-nya sendiri", async () => {
    const calls = metaStub(CREATE);
    const { app, store, runs } = build();
    const res = await send(app, "/fleet/campaigns", BODY);
    expect(res.status).toBe(200);
    await Promise.all(runs);
    const first = specOf(calls, 0).images.map((image) => image.hash);
    const second = specOf(calls, 1).images.map((image) => image.hash);
    expect(first).toEqual(IMAGES);
    expect(second).toEqual(OTHER_IMAGES);
    // Baris job menyebut GABUNGANNYA tanpa kembar — panel Pekerjaan cuma punya satu angka.
    expect(jobsOf(store)[(await res.json()).jobId].images).toBe(4);
  });

  it("iklan yang gambarnya kurang ditolak berikut NOMOR iklannya", async () => {
    const calls = metaStub(CREATE);
    const { app } = build();
    const res = await send(app, "/fleet/campaigns", {
      ...BODY,
      images: undefined,
      variants: [BODY.variants[0], { title: "Judul B", body: "Body B", images: [IMAGES[0]] }],
    });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/Gambar iklan 2: pilih 2 sampai 10/);
    expect(calls.length).toBe(0);
  });

  it("bundel browser lama: gambar tingkat campaign masih diterima", async () => {
    const calls = metaStub(CREATE);
    const { app, runs } = build();
    const res = await send(app, "/fleet/campaigns", {
      ...BODY,
      images: IMAGES,
      variants: [
        { title: "Judul A", body: "Body A" },
        { title: "Judul B", body: "Body B" },
      ],
    });
    expect(res.status).toBe(200);
    await Promise.all(runs);
    expect(specOf(calls, 0).images.map((image) => image.hash)).toEqual(IMAGES);
    expect(specOf(calls, 1).images.map((image) => image.hash)).toEqual(IMAGES);
  });
});

describe("jadwal mulai tayang", () => {
  it("ditulis di tiap AD SET, tidak pernah di campaign", async () => {
    const calls = metaStub(CREATE);
    const { app, runs } = build();
    // Jauh di depan supaya tesnya tidak kedaluwarsa sendiri.
    const when = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const res = await send(app, "/fleet/campaigns", { ...BODY, startTime: `${when}T01:59` });
    expect(res.status).toBe(200);
    await Promise.all(runs);
    const adSets = calls.filter((call) => call.key === "POST /act_1/adsets");
    expect(adSets.length).toBe(2);
    for (const call of adSets) expect(call.body.start_time).toBe(`${when}T01:59:00+07:00`);
    // Meta MENERIMA start_time di campaign lalu mengabaikannya (dibuktikan 12 Sep 2026), dan
    // mengisinya sendiri dari ad set paling awal — jadi ia tidak dikirim sama sekali.
    const campaign = calls.find((call) => call.key === "POST /act_1/campaigns");
    expect(campaign.body.start_time).toBeUndefined();
  });

  it("tanpa jadwal: field-nya tidak dikirim sama sekali", async () => {
    const calls = metaStub(CREATE);
    const { app, runs } = build();
    expect((await send(app, "/fleet/campaigns", BODY)).status).toBe(200);
    await Promise.all(runs);
    const adSet = calls.find((call) => call.key === "POST /act_1/adsets");
    expect(adSet.body.start_time).toBeUndefined();
  });

  it("waktu yang sudah lewat: 422 sebelum Meta disentuh", async () => {
    const calls = metaStub(CREATE);
    const { app } = build();
    const res = await send(app, "/fleet/campaigns", { ...BODY, startTime: "2020-01-01T01:59" });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/sudah lewat/);
    expect(calls.length).toBe(0);
  });
});

describe("buat campaign", () => {
  it("job ditulis dulu, route menjawab, campaign + ad set + iklan lahir di latar", async () => {
    let jobsAtFirstWrite = -1;
    const { app, store, synced, runs } = build();
    const calls = metaStub(CREATE, (key) => {
      if (key === "POST /act_1/campaigns") jobsAtFirstWrite = Object.keys(jobsOf(store)).length;
    });
    const res = await send(app, "/fleet/campaigns", BODY);
    expect(res.status).toBe(200);
    const answer = await res.json();
    expect(answer.state).toBe("running");
    expect(answer.adSets).toBe(2);

    await Promise.all(runs);
    // Job sudah tercatat pada detik campaign pertama ditulis ke Meta: proses yang mati sesudahnya
    // meninggalkan jejak, bukan campaign yang tidak ada di catatan mana pun.
    expect(jobsAtFirstWrite).toBe(1);
    const job = jobsOf(store)[answer.jobId];
    expect(job.state).toBe("done");
    expect(job.campaignId).toBe("900");
    expect(job.adSets.length).toBe(2);
    expect(synced).toEqual(["k1"]);
    expect(calls.filter((call) => call.key === "POST /act_1/ads").length).toBe(2);
  });

  it("dua permintaan bersamaan untuk nama yang sama: yang kedua 409", async () => {
    metaStub(CREATE);
    const { app, runs } = build();
    const [first, second] = await Promise.all([
      send(app, "/fleet/campaigns", BODY),
      send(app, "/fleet/campaigns", BODY),
    ]);
    const codes = [first.status, second.status].sort();
    expect(codes).toEqual([200, 409]);
    // Ditunggu di sini: tugas latar yang masih berjalan akan menitipkan panggilannya ke tes berikutnya.
    await Promise.all(runs);
  });

  it("nama yang sudah dipakai campaign lain di akun itu: 422, nol objek lahir", async () => {
    const calls = metaStub({
      ...CREATE,
      "GET /act_1/campaigns": [{ data: [{ id: "1", name: "tvh1-01 pros MEA carrou SM 01" }] }],
    });
    const { app, store } = build();
    const res = await send(app, "/fleet/campaigns", BODY);
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/sudah dipakai campaign lain/);
    expect(jobsOf(store)).toEqual({});
    expect(calls.filter((call) => call.key.startsWith("POST")).length).toBe(0);
  });

  it("creative yang ditolak mode pengembangan: job partial, sebabnya menyebut App Mode", async () => {
    metaStub({
      ...CREATE,
      "POST /act_1/adcreatives": [
        { error: { message: "Invalid parameter", code: 100, error_subcode: 1885183 } },
        false,
      ],
    });
    const { app, store, runs } = build();
    const res = await send(app, "/fleet/campaigns", BODY);
    const { jobId } = await res.json();
    await Promise.all(runs);
    const job = jobsOf(store)[jobId];
    expect(job.state).toBe("partial");
    expect(job.error).toMatch(/0 dari 2 iklan lahir; campaign 900 berdiri PAUSED/);
    expect(job.adSets[0].error).toMatch(/Development Mode/);
  });
});

describe("bahan form", () => {
  it("assets: pixel, Halaman yang bisa beriklan, pustaka gambar, dan batasnya", async () => {
    metaStub({
      ...ASSETS,
      "GET /me/accounts": [
        {
          data: [
            { id: "1273663929164175", name: "Sonet Media 01", tasks: ["ADVERTISE"] },
            { id: "999", name: "Tanpa izin iklan", tasks: ["ANALYZE"] },
          ],
        },
      ],
    });
    const { app } = build();
    const res = await send(app, "/fleet/accounts/k1/assets");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pixels[0].id).toBe("1810179687086885");
    expect(body.pages.map((page) => page.id)).toEqual(["1273663929164175"]);
    expect(body.images[0].hash).toBe(IMAGES[0]);
    expect(body.limits.minImages).toBe(2);
    expect(body.limits.ctaTypes).toContain("WATCH_MORE");
  });

  it("unggah gambar: nama berkas ikut ke Meta, dan hash-nya dikembalikan", async () => {
    const calls = metaStub({
      "POST /act_1/adimages": [{ images: { "hero.png": { hash: IMAGES[1], name: "hero.png" } } }],
    });
    const { app } = build();
    const form = new FormData();
    form.set("file", new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }), "hero.png");
    const res = await app.handle(
      new Request(`${URL_BASE}/fleet/accounts/k1/images`, {
        method: "POST",
        headers: { authorization: "Bearer t" },
        body: form,
      }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).image.hash).toBe(IMAGES[1]);
    expect(calls[0].key).toBe("POST /act_1/adimages");
  });

  it("unggah jenis berkas yang bukan gambar: 422 tanpa menyentuh Meta", async () => {
    const calls = metaStub({});
    const { app } = build();
    const form = new FormData();
    form.set("file", new Blob([new Uint8Array([1])], { type: "application/pdf" }), "x.pdf");
    const res = await app.handle(
      new Request(`${URL_BASE}/fleet/accounts/k1/images`, {
        method: "POST",
        headers: { authorization: "Bearer t" },
        body: form,
      }),
    );
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/tidak didukung/);
    expect(calls.length).toBe(0);
  });
});
