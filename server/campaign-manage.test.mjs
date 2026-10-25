import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { AuthError } from "./auth.js";
import { campaignManageRoutes, detached } from "./campaign-manage.js";

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

const DATA = {
  users: {
    u_nur: {
      email: "nur@rabbitracing.live",
      name: "Nurjaman",
      campaigns: [
        { campaignId: "120210", campaign: "TvH1-06 Pros", adAccount: "act_1", subDomain: "puppy.petcins.com", subDomainSource: "code" },
        { campaignId: "120211", campaign: "Tanpa kode", adAccount: "act_1" },
      ],
    },
  },
  subDomains: {
    s1: { name: "puppy.petcins.com", campaignCodes: "TvH1" },
    s2: { name: "dog.petcins.com", campaignCodes: "5rx7" },
  },
  adAccounts: { k1: { actId: "act_1", name: "TBZ 1247" } },
};

const SUPER = { role: "superadmin", email: "super@r.live", uid: "s1" };

function build({ authorize, metaToken = "token", data = DATA } = {}) {
  const store = fakeStore(data);
  const synced = [];
  const runs = [];
  const app = new Elysia().use(
    campaignManageRoutes({
      db: {},
      store,
      metaToken,
      enqueueSync: (id) => synced.push(id),
      // Tes MENUNGGU penyalinan di latar lewat `runs`; di produksi ia berjalan tanpa ditunggu.
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

// Kunci rute: "METHOD /path-tanpa-versi". Nilai: [body, ok?].
function metaStub(routes) {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    const u = new URL(String(url));
    const key = `${options?.method || "GET"} ${u.pathname.replace(/^\/v25\.0/, "")}`;
    calls.push({ key, params: u.searchParams });
    const handler = routes[key];
    if (!handler) throw new Error(`panggilan tak terduga: ${key}`);
    const [body, ok = true] = handler;
    return Response.json(body, { status: ok ? 200 : 400 });
  };
  return calls;
}

// Daftar campaign ad account act_1 — bacaan yang sama dengan yang dileburkan sync per nama.
const SETTINGS = {
  "GET /act_1/campaigns": [
    {
      data: [
        { id: "120210", name: "TvH1-06 Pros" },
        { id: "120211", name: "Tanpa kode" },
        { id: "120300", name: "TvH1-08 Pros" },
      ],
    },
  ],
};

// Sumber 120210: satu ad set, satu iklan.
const COPY_ROUTES = {
  ...SETTINGS,
  "GET /120210/adsets": [{ data: [{ id: "555", name: "Adset 1", status: "ACTIVE" }] }],
  "GET /120210/ads": [{ data: [{ id: "a1", adset_id: "555", status: "ACTIVE" }] }],
  "POST /120210/copies": [{ copied_campaign_id: "900" }],
  "POST /555/copies": [{ copied_adset_id: "901", ad_object_ids: [{ ad_object_type: "ad", copied_id: "911" }] }],
  "POST /900": [{ success: true }],
};

describe("gerbang /fleet", () => {
  it("bukan superadmin: 403 dengan kalimat halaman ini, Meta tidak disentuh", async () => {
    const calls = metaStub({});
    const { app } = build({
      authorize: async () => {
        throw new AuthError("Hanya superadmin yang boleh menjalankan gating.", 403);
      },
    });
    const res = await send(app, "/fleet/campaigns/120210/copies", { userId: "u_nur", name: "TvH1-07", count: 1 });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Hanya superadmin yang boleh mengelola campaign.");
    expect(calls.length).toBe(0);
  });

  it("tanpa META_ACCESS_TOKEN: 503", async () => {
    metaStub({});
    const { app } = build({ metaToken: "" });
    expect((await send(app, "/fleet/campaigns/120210?userId=u_nur")).status).toBe(503);
  });

  it("campaign yang bukan milik profil itu: 404, Meta tidak disentuh", async () => {
    const calls = metaStub({});
    const { app } = build();
    const res = await send(app, "/fleet/campaigns/999/copies", { userId: "u_nur", name: "TvH1-07", count: 1 });
    expect(res.status).toBe(404);
    expect(calls.length).toBe(0);
  });
});

describe("POST /fleet/campaigns/:id/copies", () => {
  it("menjawab running seketika, lalu menyalin bertahap di latar", async () => {
    const calls = metaStub(COPY_ROUTES);
    const { app, store, synced, runs } = build();
    const res = await send(app, "/fleet/campaigns/120210/copies", { userId: "u_nur", name: "TvH1-07 Pros", count: 1 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ state: "running", adSets: 1, ads: 1 });
    expect(store.state.dashboard.campaignCopyJobs[body.jobId].requestedBy).toBe("super@r.live");
    await Promise.all(runs);
    expect(store.state.dashboard.campaignCopyJobs[body.jobId].state).toBe("done");
    expect(calls.find((call) => call.key === "POST /555/copies").params.get("campaign_id")).toBe("900");
    expect(calls.find((call) => call.key === "POST /900").params.get("name")).toBe("TvH1-07 Pros");
    expect(synced).toEqual(["k1"]);
  });

  it("nama yang sudah dipakai campaign lain di akun itu: 422 berikut namanya, tanpa job dan tanpa tulisan", async () => {
    const calls = metaStub(COPY_ROUTES);
    const { app, store } = build();
    const res = await send(app, "/fleet/campaigns/120210/copies", { userId: "u_nur", name: "TvH1-06 Pros", count: 1 });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe(
      'Nama "TvH1-06 Pros" sudah dipakai campaign lain di ad account ini — sync akan melebur keduanya jadi satu baris.',
    );
    expect(store.state.dashboard).toBeUndefined();
    expect(calls.some((call) => call.key.startsWith("POST"))).toBe(false);
  });

  it("tiap nama salinan diperiksa, termasuk yang berakhiran #n", async () => {
    metaStub({
      ...COPY_ROUTES,
      "GET /act_1/campaigns": [{ data: [{ id: "120210", name: "TvH1-06 Pros" }, { id: "7", name: "TvH1-07 Pros #2" }] }],
    });
    const { app } = build();
    const res = await send(app, "/fleet/campaigns/120210/copies", { userId: "u_nur", name: "TvH1-07 Pros", count: 3 });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain('"TvH1-07 Pros #2"');
  });

  it("daftar campaign akun gagal dibaca: 502, bukan diloloskan", async () => {
    const calls = metaStub({ ...COPY_ROUTES, "GET /act_1/campaigns": [{ error: { message: "Invalid OAuth access token", code: 190 } }, false] });
    const { app, store } = build();
    const res = await send(app, "/fleet/campaigns/120210/copies", { userId: "u_nur", name: "TvH1-07 Pros", count: 1 });
    expect(res.status).toBe(502);
    expect(store.state.dashboard).toBeUndefined();
    expect(calls.some((call) => call.key.startsWith("POST"))).toBe(false);
  });

  it("dua permintaan bersamaan untuk sumber yang sama: tepat satu yang jalan", async () => {
    const calls = metaStub(COPY_ROUTES);
    const { app, store, runs } = build();
    const payload = { userId: "u_nur", name: "TvH1-07 Pros", count: 1 };
    const [first, second] = await Promise.all([
      send(app, "/fleet/campaigns/120210/copies", payload),
      send(app, "/fleet/campaigns/120210/copies", payload),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    const conflict = [first, second].find((res) => res.status === 409);
    expect((await conflict.json()).error).toContain("masih berjalan");
    await Promise.all(runs);
    expect(Object.keys(store.state.dashboard.campaignCopyJobs).length).toBe(1);
    expect(calls.filter((call) => call.key === "POST /120210/copies").length).toBe(1);
  });

  it("penjaga dilepas sesudah salinan selesai, dan sesudah start gagal", async () => {
    metaStub({ ...COPY_ROUTES, "GET /120210/adsets": [{ error: { message: "Invalid OAuth access token", code: 190 } }, false] });
    const { app, runs } = build();
    const payload = { userId: "u_nur", name: "TvH1-07 Pros", count: 1 };
    expect((await send(app, "/fleet/campaigns/120210/copies", payload)).status).toBe(502);
    metaStub(COPY_ROUTES);
    expect((await send(app, "/fleet/campaigns/120210/copies", payload)).status).toBe(200);
    await Promise.all(runs);
    // Salinan pertama selesai: yang berikutnya boleh jalan (nama lain, karena daftar Meta di stub
    // tidak ikut bertambah).
    expect((await send(app, "/fleet/campaigns/120210/copies", { ...payload, name: "TvH1-07 Pros 2" })).status).toBe(200);
    await Promise.all(runs);
  }, 20_000);

  it("kode milik subdomain lain: 422, Meta tidak disentuh", async () => {
    const calls = metaStub(COPY_ROUTES);
    const { app } = build();
    const res = await send(app, "/fleet/campaigns/120210/copies", { userId: "u_nur", name: "5rx7-01 Pros", count: 1 });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain("dog.petcins.com");
    expect(calls.length).toBe(0);
  });

  it("campaign belum terpetakan: 409 minta konfirmasi, lalu jalan dengan konfirmasi", async () => {
    metaStub({
      ...SETTINGS,
      "GET /120211/adsets": [{ data: [{ id: "556", name: "Adset X", status: "PAUSED" }] }],
      "GET /120211/ads": [{ data: [] }],
      "POST /120211/copies": [{ copied_campaign_id: "905" }],
      "POST /556/copies": [{ copied_adset_id: "906", ad_object_ids: [] }],
      "POST /905": [{ success: true }],
    });
    const { app, runs } = build();
    const first = await send(app, "/fleet/campaigns/120211/copies", { userId: "u_nur", name: "5rx7-01 Pros", count: 1 });
    expect(first.status).toBe(409);
    expect(await first.json()).toMatchObject({ needsConfirm: true, subDomain: "dog.petcins.com" });
    const second = await send(app, "/fleet/campaigns/120211/copies", {
      userId: "u_nur",
      name: "5rx7-01 Pros",
      count: 1,
      confirmSubDomain: "dog.petcins.com",
    });
    expect(second.status).toBe(200);
    await Promise.all(runs);
  });

  it("salinan yang masih berjalan: 409 tanpa needsConfirm", async () => {
    metaStub(COPY_ROUTES);
    const { app } = build({
      data: { ...DATA, dashboard: { campaignCopyJobs: { jold: { sourceCampaignId: "120210", state: "running" } } } },
    });
    const res = await send(app, "/fleet/campaigns/120210/copies", { userId: "u_nur", name: "TvH1-07", count: 1 });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("masih berjalan");
    expect(body.needsConfirm).toBeUndefined();
  });

  it("ad set di atas 3 iklan: 422 sebelum job ditulis", async () => {
    const calls = metaStub({
      ...COPY_ROUTES,
      "GET /120210/ads": [{ data: Array.from({ length: 4 }, (_, i) => ({ id: `a${i}`, adset_id: "555", status: "ACTIVE" })) }],
    });
    const { app, store } = build();
    const res = await send(app, "/fleet/campaigns/120210/copies", { userId: "u_nur", name: "TvH1-07", count: 1 });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain("lebih dari 3 iklan");
    expect(store.state.dashboard).toBeUndefined();
    expect(calls.some((call) => call.key.startsWith("POST"))).toBe(false);
  });

  it("daftar ad set gagal dibaca: 502, tanpa job", async () => {
    metaStub({ ...SETTINGS, "GET /120210/adsets": [{ error: { message: "Invalid OAuth access token", code: 190 } }, false] });
    const { app, store } = build();
    const res = await send(app, "/fleet/campaigns/120210/copies", { userId: "u_nur", name: "TvH1-07", count: 1 });
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain("120210/adsets");
    expect(store.state.dashboard).toBeUndefined();
  });

  it("jumlah salinan di luar 1–5 ditolak validator", async () => {
    metaStub({});
    const { app } = build();
    const res = await send(app, "/fleet/campaigns/120210/copies", { userId: "u_nur", name: "TvH1-07", count: 9 });
    expect(res.status).toBe(422);
  });
});

describe("tugas latar", () => {
  it("penolakan dari tugas yang tidak ditunggu tertangkap dan dicatat, bukan menjatuhkan proses", async () => {
    const logged = [];
    const log = { error: (text) => logged.push(text) };
    detached(() => Promise.reject(new Error("rusak")), log);
    detached(() => {
      throw new Error("sinkron");
    }, log);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(logged.sort()).toEqual(["[campaign] tugas latar melempar: rusak", "[campaign] tugas latar melempar: sinkron"]);
  });
});

describe("ubah campaign", () => {
  it("GET: nilai segar dari Meta berikut boleh-tidaknya anggaran diubah", async () => {
    metaStub({ "GET /120210": [{ id: "120210", name: "TvH1-06 Pros", status: "ACTIVE", daily_budget: "50000" }] });
    const { app } = build();
    const body = await (await send(app, "/fleet/campaigns/120210?userId=u_nur")).json();
    expect(body.campaign.dailyBudget).toBe(50000);
    expect(body.campaign.budget).toEqual({ editable: true, reason: "" });
    expect(body.mapping).toEqual({ subDomain: "puppy.petcins.com", source: "code", code: "" });
  });

  it("ganti nama ke kode subdomain yang sama: ditulis, akun masuk antrean sync", async () => {
    const calls = metaStub({ ...SETTINGS, "POST /120210": [{ success: true }] });
    const { app, synced } = build();
    const res = await send(app, "/fleet/campaigns/120210", { userId: "u_nur", name: "TvH1-07 Pros" });
    expect(res.status).toBe(200);
    expect(calls.map((call) => call.key)).toEqual(["GET /act_1/campaigns", "POST /120210"]);
    expect(calls[1].params.get("name")).toBe("TvH1-07 Pros");
    expect(synced).toEqual(["k1"]);
  });

  it("ganti nama ke nama campaign lain di akun itu: 422, tidak ditulis", async () => {
    const calls = metaStub({ ...SETTINGS, "POST /120210": [{ success: true }] });
    const { app, synced } = build();
    const res = await send(app, "/fleet/campaigns/120210", { userId: "u_nur", name: "tvh1-08 pros" });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain('Nama "tvh1-08 pros" sudah dipakai campaign lain');
    expect(calls.some((call) => call.key.startsWith("POST"))).toBe(false);
    expect(synced).toEqual([]);
  });

  it("nama campaign itu sendiri di Meta bukan bentrok", async () => {
    // Diganti namanya di Ads Manager; baris tabel belum ikut.
    metaStub({
      "GET /act_1/campaigns": [{ data: [{ id: "120210", name: "TvH1-06 Pros Baru" }] }],
      "POST /120210": [{ success: true }],
    });
    const { app } = build();
    expect((await send(app, "/fleet/campaigns/120210", { userId: "u_nur", name: "TvH1-06 Pros Baru" })).status).toBe(200);
  });

  it("nama yang sama dengan baris tabel tetap diperiksa: baris itu bisa basi", async () => {
    // Diganti namanya di Ads Manager, lalu campaign lain memakai nama lamanya. Baris tabel masih
    // menyebut nama lama, jadi "tidak berubah" menurut baris justru bentrok menurut Meta.
    const calls = metaStub({
      "GET /act_1/campaigns": [
        {
          data: [
            { id: "120210", name: "TvH1-06 Pros Baru" },
            { id: "120300", name: "TvH1-06 Pros" },
          ],
        },
      ],
      "POST /120210": [{ success: true }],
    });
    const { app } = build();
    const res = await send(app, "/fleet/campaigns/120210", { userId: "u_nur", name: " tvh1-06 PROS " });
    expect(res.status).toBe(422);
    expect(calls.some((call) => call.key.startsWith("POST"))).toBe(false);
  });

  it("daftar campaign akun gagal dibaca saat ganti nama: 502, tidak ditulis", async () => {
    const calls = metaStub({ "GET /act_1/campaigns": [{ error: { message: "Invalid OAuth access token", code: 190 } }, false] });
    const { app } = build();
    const res = await send(app, "/fleet/campaigns/120210", { userId: "u_nur", name: "TvH1-07 Pros" });
    expect(res.status).toBe(502);
    expect(calls.some((call) => call.key.startsWith("POST"))).toBe(false);
  });

  it("ganti nama ke kode subdomain lain: 422", async () => {
    const calls = metaStub({});
    const { app } = build();
    expect((await send(app, "/fleet/campaigns/120210", { userId: "u_nur", name: "5rx7-02 Pros" })).status).toBe(422);
    expect(calls.length).toBe(0);
  });

  it("anggaran untuk campaign ABO: 422 sebelum menulis", async () => {
    const calls = metaStub({ "GET /120210": [{ id: "120210", name: "TvH1-06 Pros", status: "ACTIVE" }] });
    const { app } = build();
    const res = await send(app, "/fleet/campaigns/120210", { userId: "u_nur", dailyBudget: 75000 });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain("dipegang ad set");
    expect(calls.some((call) => call.key.startsWith("POST"))).toBe(false);
  });

  it("anggaran di bawah minimum Meta: 422 dengan kalimat Meta", async () => {
    metaStub({
      "GET /120210": [{ id: "120210", daily_budget: "50000" }],
      "POST /120210": [{ error: { message: "Budget too low", code: 100, error_subcode: 1885272 } }, false],
    });
    const { app } = build();
    const res = await send(app, "/fleet/campaigns/120210", { userId: "u_nur", dailyBudget: 100 });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain("Budget too low");
  });

  it("tanpa perubahan: 422", async () => {
    metaStub({});
    const { app } = build();
    const res = await send(app, "/fleet/campaigns/120210", { userId: "u_nur" });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain("Tidak ada yang diubah");
  });
});

describe("ubah ad set", () => {
  const ADSET = {
    id: "555",
    name: "Adset 1",
    campaign_id: "120210",
    status: "ACTIVE",
    targeting: { age_min: 18, age_max: 65, geo_locations: { countries: ["TR"] }, flexible_spec: [{ interests: [{ id: "1" }] }] },
  };

  it("ad set milik campaign lain: 404, tidak ada yang ditulis", async () => {
    const calls = metaStub({ "GET /555": [{ ...ADSET, campaign_id: "999" }] });
    const { app } = build();
    expect((await send(app, "/fleet/campaigns/120210/adsets/555", { userId: "u_nur", name: "X" })).status).toBe(404);
    expect(calls.some((call) => call.key.startsWith("POST"))).toBe(false);
  });

  it("GET: targeting diringkas, anggaran CBO tidak bisa diubah di ad set", async () => {
    metaStub({ "GET /555": [ADSET] });
    const { app } = build();
    const body = await (await send(app, "/fleet/campaigns/120210/adsets/555?userId=u_nur")).json();
    expect(body.adSet.targeting).toEqual({ editable: true, reason: "", countries: ["TR"], ageMin: 18, ageMax: 65 });
    expect(body.adSet.budget.reason).toContain("dipegang campaign");
  });

  it("negara diganti, isi targeting lain dikirim utuh", async () => {
    const calls = metaStub({ "GET /555": [ADSET], "POST /555": [{ success: true }] });
    const { app } = build();
    const res = await send(app, "/fleet/campaigns/120210/adsets/555", { userId: "u_nur", countries: ["tr", "mx"] });
    expect(res.status).toBe(200);
    const sent = JSON.parse(calls.find((call) => call.key === "POST /555").params.get("targeting"));
    expect(sent.geo_locations.countries).toEqual(["TR", "MX"]);
    expect(sent.flexible_spec).toEqual([{ interests: [{ id: "1" }] }]);
  });

  it("lokasi berkota: 422, tidak ada yang ditulis", async () => {
    const withCities = { ...ADSET, targeting: { ...ADSET.targeting, geo_locations: { countries: ["TR"], cities: [{ key: "1" }] } } };
    const calls = metaStub({ "GET /555": [withCities] });
    const { app } = build();
    expect((await send(app, "/fleet/campaigns/120210/adsets/555", { userId: "u_nur", ageMin: 21 })).status).toBe(422);
    expect(calls.some((call) => call.key.startsWith("POST"))).toBe(false);
  });
});
