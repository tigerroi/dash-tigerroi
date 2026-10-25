import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { mayToggleCampaign } from "./auth.js";
import { campaignRoutes } from "./campaigns.js";

// HARUS "localhost": pengurai URL cepat Elysia gagal mengambil path dari host satu label dan
// menjawab 404 untuk route yang sebenarnya terdaftar.
const URL_BASE = "http://localhost";

function fakeStore(data = {}) {
  const state = structuredClone(data);
  const at = (path) => path.split("/").reduce((node, key) => node?.[key], state);
  return {
    state,
    read: async (path) => at(path) ?? null,
    update: async (path, values) => {
      for (const [key, value] of Object.entries(values)) {
        const parts = `${path}/${key}`.split("/");
        const last = parts.pop();
        let node = state;
        for (const part of parts) node = node[part] ??= {};
        if (value === null) delete node[last];
        else node[last] = value;
      }
    },
    replace: async () => {},
  };
}

const USERS = {
  u_nur: {
    email: "nur@rabbitracing.live",
    name: "Nurjaman",
    campaigns: [{ campaignId: "120210", campaign: "nPJL-06", adAccount: "act_1" }],
  },
  u_aldi: {
    email: "aldi@rabbitracing.live",
    campaigns: [{ campaignId: "999999", campaign: "aldi-01" }],
  },
};

function build(actor, store = fakeStore({ users: structuredClone(USERS) })) {
  const app = new Elysia().use(
    campaignRoutes({
      db: {},
      store,
      metaToken: "token",
      // Suntikan yang sama polanya dengan gating: verifikasi ID token sungguhan mengambil kunci
      // publik Google lalu membaca /roles — dua hal yang tidak boleh dibutuhkan sebuah unit test.
      authorize: async () => actor,
    }),
  );
  return { app, store };
}

function toggle(app, campaignId, userId, status = "PAUSED") {
  return app.handle(
    new Request(`${URL_BASE}/campaigns/${campaignId}/status`, {
      method: "POST",
      headers: { authorization: "Bearer t", "content-type": "application/json" },
      body: JSON.stringify({ userId, status }),
    }),
  );
}

describe("mayToggleCampaign", () => {
  it("admin boleh untuk siapa saja", () => {
    expect(mayToggleCampaign({ role: "admin", email: "x@y.z" }, { email: "nur@r.live" })).toBe(true);
    expect(mayToggleCampaign({ role: "superadmin", email: "x@y.z" }, { email: "n@r.live" })).toBe(true);
  });

  it("selain admin, hanya pemilik barisnya sendiri — dicocokkan lewat email", () => {
    const owner = { email: "nur@rabbitracing.live" };
    expect(mayToggleCampaign({ role: "user", email: "nur@rabbitracing.live" }, owner)).toBe(true);
    // Beda huruf besar-kecil tetap orang yang sama.
    expect(mayToggleCampaign({ role: "user", email: "NUR@Rabbitracing.LIVE" }, owner)).toBe(true);
    expect(mayToggleCampaign({ role: "user", email: "aldi@rabbitracing.live" }, owner)).toBe(false);
  });

  it("email kosong tidak pernah cocok", () => {
    // Kalau tidak, satu baris user yang emailnya kosong bisa disentuh akun mana pun yang emailnya
    // juga tidak terbaca — dan /users dikunci push-key, jadi email adalah satu-satunya talinya.
    expect(mayToggleCampaign({ role: "user", email: "" }, { email: "" })).toBe(false);
    expect(mayToggleCampaign({ role: "user", email: "a@b.c" }, {})).toBe(false);
  });
});

describe("POST /campaigns/:id/status", () => {
  it("pemilik boleh mematikan campaignnya sendiri, dan Meta benar-benar dipanggil", async () => {
    let called = "";
    globalThis.fetch = async (url, options) => {
      called = `${options?.method || "GET"} ${url}`;
      return Response.json({ success: true });
    };
    const { app, store } = build({ role: "user", email: "nur@rabbitracing.live", uid: "n1" });
    const res = await toggle(app, "120210", "u_nur");
    expect(res.status).toBe(200);
    expect((await res.json()).applied).toBe(true);
    expect(called).toContain("120210");
    // Perintahnya tercatat sebagai applied — jejak siapa mematikan apa, kapan.
    expect(store.state.users.u_nur.campaignCommands["120210"].state).toBe("applied");
  });

  it("orang lain: 403, dan Meta tidak disentuh", async () => {
    let touched = false;
    globalThis.fetch = async () => {
      touched = true;
      return Response.json({});
    };
    const { app } = build({ role: "user", email: "aldi@rabbitracing.live", uid: "a1" });
    const res = await toggle(app, "120210", "u_nur");
    expect(res.status).toBe(403);
    expect(touched).toBe(false);
  });

  /**
   * Penjaga paling penting di file ini.
   *
   * Tanpa pencarian campaign di baris user itu sendiri, siapa pun yang boleh menyentuh SATU user
   * bisa mengoper ID campaign milik ad account mana pun di Business Manager — dan Meta akan
   * menurutinya, karena token System User punya akses ke semuanya.
   */
  it("campaign milik user lain tidak bisa diselundupkan lewat userId sendiri", async () => {
    let touched = false;
    globalThis.fetch = async () => {
      touched = true;
      return Response.json({});
    };
    const { app } = build({ role: "user", email: "aldi@rabbitracing.live", uid: "a1" });
    // Aldi memakai userId-NYA SENDIRI (yang ia berhak sentuh), tapi ID campaign milik Nurjaman.
    const res = await toggle(app, "120210", "u_aldi");
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/bukan milik user tersebut/);
    expect(touched).toBe(false);
  });

  it("status di luar ACTIVE/PAUSED ditolak sebelum apa pun terjadi", async () => {
    globalThis.fetch = async () => {
      throw new Error("tidak boleh dipanggil");
    };
    const { app } = build({ role: "admin", email: "a@b.c", uid: "x" });
    const res = await toggle(app, "120210", "u_nur", "HAPUS");
    expect(res.status).toBe(422);
  });

  it("user yang tidak ada / diarsipkan: 404", async () => {
    const { app } = build({ role: "admin", email: "a@b.c", uid: "x" });
    expect((await toggle(app, "120210", "u_hantu")).status).toBe(404);

    const archived = fakeStore({ users: { u_x: { email: "x@y.z", deletedAt: "2026-08-01" } } });
    const built = build({ role: "admin", email: "a@b.c", uid: "x" }, archived);
    expect((await toggle(built.app, "1", "u_x")).status).toBe(404);
  });

  it("Meta menolak: 502, dan perintahnya ditandai failed berikut sebabnya", async () => {
    globalThis.fetch = async () =>
      Response.json({ error: { message: "Invalid OAuth access token", code: 190 } }, { status: 400 });
    const { app, store } = build({ role: "admin", email: "a@b.c", uid: "x" });
    const res = await toggle(app, "120210", "u_nur");
    expect(res.status).toBe(502);
    expect(store.state.users.u_nur.campaignCommands["120210"].state).toBe("failed");
    expect(store.state.users.u_nur.campaignCommands["120210"].error).toBeTruthy();
  });

  it("tanpa META_ACCESS_TOKEN: 503, bukan diam-diam gagal", async () => {
    const app = new Elysia().use(
      campaignRoutes({
        db: {},
        store: fakeStore({ users: structuredClone(USERS) }),
        metaToken: "",
        authorize: async () => ({ role: "admin", email: "a@b.c", uid: "x" }),
      }),
    );
    const res = await toggle(app, "120210", "u_nur");
    expect(res.status).toBe(503);
  });
});

describe("GET /campaigns/:id/adsets", () => {
  // Jawaban Meta yang benar-benar datang untuk campaign CBO (7 Sep 2026) — dua panggilan, dan
  // urutannya yang membedakan keduanya di stub ini.
  function metaStub({ insightsFails = false, adsFails = false } = {}) {
    const calls = [];
    globalThis.fetch = async (url) => {
      const u = String(url);
      calls.push(u);
      if (u.includes("/ads?") || u.includes("/ads&") || /\/ads(\?|$)/.test(u.split("?")[0] + (u.includes("?") ? "?" : ""))) {
        // Iklan di dalam campaign — bentuk RNPX-01: satu ad set beriklan ACTIVE, satu lagi
        // beriklan DISAPPROVED.
        if (adsFails) return Response.json({ error: { message: "(#100) tidak bisa dibaca" } }, { status: 400 });
        return Response.json({
          data: [
            { id: "ad1", adset_id: "a1", status: "ACTIVE", effective_status: "ACTIVE" },
            { id: "ad2", adset_id: "a2", status: "ACTIVE", effective_status: "DISAPPROVED" },
          ],
        });
      }
      if (u.includes("/insights")) {
        if (insightsFails) {
          return Response.json({ error: { message: "(#4) Application request limit reached" } }, { status: 400 });
        }
        return Response.json({ data: [{ adset_id: "a1", spend: "69419", impressions: "7057" }] });
      }
      return Response.json({
        data: [
          {
            id: "a1",
            name: "MECIL Adset 4",
            status: "ACTIVE",
            effective_status: "CAMPAIGN_PAUSED",
            optimization_goal: "OFFSITE_CONVERSIONS",
            promoted_object: { custom_event_type: "CONTENT_VIEW" },
          },
          { id: "a2", name: "Adset 2", status: "PAUSED" },
        ],
      });
    };
    return calls;
  }

  const ask = (app, campaignId, userId) =>
    app.handle(
      new Request(`${URL_BASE}/campaigns/${campaignId}/adsets?userId=${userId}`, {
        headers: { authorization: "Bearer t" },
      }),
    );

  it("dibaca siapa pun yang login, bukan cuma pemiliknya", async () => {
    // Sengaja BUKAN `mayToggleCampaign`: baris campaign induknya sudah terbaca setiap akun yang
    // login (`users` ber-.read "auth != null"), jadi gerbang yang lebih ketat di sini cuma menutup
    // panel di halaman yang tabelnya sendiri terbuka.
    metaStub();
    const { app } = build({ role: "user", email: "aldi@rabbitracing.live", uid: "a1" });
    const res = await ask(app, "120210", "u_nur");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.adSets.length).toBe(2);
    // Terurut spend dulu, dan ad set yang saklarnya On sementara campaign-nya mati ditandai.
    expect(body.adSets[0].id).toBe("a1");
    expect(body.adSets[0].spend).toBe(69419);
    expect(body.adSets[0].pausedByCampaign).toBe(true);
    // Yang tidak tayang: 0 yang nyata (laporannya berhasil), bukan kosong.
    expect(body.adSets[1].spend).toBe(0);
    expect(body.metricsKnown).toBe(true);
  });

  /**
   * Penjaga yang sama dengan endpoint saklar, dan alasannya sama persis: tanpa pencarian baris di
   * profil yang dituju, endpoint ini jadi pembaca Meta untuk campaign mana pun di Business Manager
   * — cukup mengoper ID milik ad account orang lain.
   */
  it("campaign yang bukan milik user itu: 404, dan Meta tidak disentuh", async () => {
    let touched = false;
    globalThis.fetch = async () => {
      touched = true;
      return Response.json({});
    };
    const { app } = build({ role: "admin", email: "x@y.z", uid: "x1" });
    const res = await ask(app, "999999", "u_nur");
    expect(res.status).toBe(404);
    expect(touched).toBe(false);
  });

  it("angka yang gagal tidak menjatuhkan panelnya — daftarnya tetap dijawab, kosong bukan nol", async () => {
    metaStub({ insightsFails: true });
    const { app } = build({ role: "admin", email: "x@y.z", uid: "x1" });
    const res = await ask(app, "120210", "u_nur");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.metricsKnown).toBe(false);
    expect(body.metricsError).toContain("Application request limit");
    // Tanpa angka, urutan spend tidak berarti apa-apa dan yang tersisa cuma namanya — jadi
    // barisnya dicari lewat ID, bukan lewat posisi.
    const row = body.adSets.find((item) => item.id === "a1");
    // Nol di sini tak terbedakan dari ad set yang memang tidak tayang hari ini.
    expect(row.spend).toBe("");
    // Setelan dan statusnya tetap terbaca — itu setengah dari yang dicari orang.
    expect(row.status).toBe("Aktif");
  });

  it("daftar ad set yang gagal: 502, bukan panel kosong", async () => {
    globalThis.fetch = async () =>
      Response.json({ error: { message: "Invalid OAuth access token" } }, { status: 401 });
    const { app } = build({ role: "admin", email: "x@y.z", uid: "x1" });
    const res = await ask(app, "120210", "u_nur");
    expect(res.status).toBe(502);
  });

  it("ad set yang seluruh iklannya ditolak berbunyi tidak ditayangkan", async () => {
    // Bentuk RNPX-01 (act_3100918953544891, 7 Sep 2026): dua ad set sama-sama ACTIVE dan efektif
    // ACTIVE juga, yang membedakan cuma iklan di dalamnya — dan tidak ada satu pun field DI AD SET
    // yang menyebutkannya.
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.includes("/insights")) return Response.json({ data: [] });
      if (u.includes("/ads?")) {
        return Response.json({
          data: [
            { id: "ad1", adset_id: "tayang", status: "ACTIVE", effective_status: "ACTIVE" },
            { id: "ad2", adset_id: "ditolak", status: "ACTIVE", effective_status: "DISAPPROVED" },
          ],
        });
      }
      return Response.json({
        data: [
          { id: "tayang", name: "tayang", status: "ACTIVE", effective_status: "ACTIVE" },
          { id: "ditolak", name: "ditolak", status: "ACTIVE", effective_status: "ACTIVE" },
        ],
      });
    };
    const { app } = build({ role: "admin", email: "x@y.z", uid: "x1" });
    const body = await (await ask(app, "120210", "u_nur")).json();
    const byId = Object.fromEntries(body.adSets.map((row) => [row.id, row]));
    expect(byId.tayang.status).toBe("Aktif");
    expect(byId.ditolak.status).toBe("Tidak ditayangkan");
    expect(byId.ditolak.ads).toEqual({ total: 1, deliverable: 0, blockers: { DISAPPROVED: 1 } });
    expect(body.adsKnown).toBe(true);
  });

  it("daftar iklan yang gagal tidak memvonis siapa pun", async () => {
    // Yang tidak diketahui tidak dinilai — panel tidak boleh menyebut "tidak ditayangkan" untuk ad
    // set yang daftar iklannya memang gagal dibaca.
    metaStub({ adsFails: true });
    const { app } = build({ role: "admin", email: "x@y.z", uid: "x1" });
    const body = await (await ask(app, "120210", "u_nur")).json();
    expect(body.adsKnown).toBe(false);
    for (const row of body.adSets) {
      expect(row.notDelivering).toBe(false);
      expect(row.ads).toBe(null);
    }
    // Angkanya tetap terbaca: kegagalan daftar iklan tidak menular ke kolom uang.
    expect(body.metricsKnown).toBe(true);
  });
});

describe("POST /campaigns/:id/adsets/:adSetId/status", () => {
  function stub({ writeFails = false } = {}) {
    const calls = [];
    globalThis.fetch = async (url, options) => {
      const u = String(url);
      calls.push(`${options?.method || "GET"} ${u.split("?")[0]}`);
      if (options?.method === "POST") {
        if (writeFails) {
          return Response.json({ error: { message: "(#100-33) izin kurang" } }, { status: 400 });
        }
        return Response.json({ success: true });
      }
      return Response.json({ data: [{ id: "120249777765560789", name: "Adset 1", status: "ACTIVE" }] });
    };
    return calls;
  }

  const flip = (app, adSetId, userId, status = "PAUSED") =>
    app.handle(
      new Request(`${URL_BASE}/campaigns/120210/adsets/${adSetId}/status`, {
        method: "POST",
        headers: { authorization: "Bearer t", "content-type": "application/json" },
        body: JSON.stringify({ userId, status }),
      }),
    );

  it("pemilik boleh mematikan ad set di campaignnya sendiri", async () => {
    const calls = stub();
    const { app } = build({ role: "user", email: "nur@rabbitracing.live", uid: "n1" });
    const res = await flip(app, "120249777765560789", "u_nur");
    expect(res.status).toBe(200);
    expect((await res.json()).applied).toBe(true);
    // Dibaca dulu (membuktikan ad set-nya milik campaign itu), baru ditulis.
    expect(calls.some((c) => c.startsWith("GET") && c.includes("/adsets"))).toBe(true);
    expect(calls.some((c) => c.startsWith("POST") && c.includes("/120249777765560789"))).toBe(true);
  });

  it("orang lain: 403, dan Meta tidak disentuh sama sekali", async () => {
    const calls = stub();
    const { app } = build({ role: "user", email: "aldi@rabbitracing.live", uid: "a1" });
    expect((await flip(app, "120249777765560789", "u_nur")).status).toBe(403);
    expect(calls.length).toBe(0);
  });

  /**
   * Penjaga paling penting di endpoint ini.
   *
   * `campaignRowOf` cuma membuktikan CAMPAIGN-nya milik orang itu. Tanpa pemeriksaan kedua, ID ad
   * set yang dioper bisa milik ad account mana pun di Business Manager — dan Meta akan menurutinya.
   */
  it("ad set milik campaign lain: 404, dan tidak ada yang ditulis", async () => {
    const calls = stub();
    const { app } = build({ role: "admin", email: "x@y.z", uid: "x1" });
    expect((await flip(app, "999", "u_nur")).status).toBe(404);
    expect(calls.some((c) => c.startsWith("POST"))).toBe(false);
  });

  it("penolakan Meta dijawab 502 berikut sebabnya", async () => {
    stub({ writeFails: true });
    const { app } = build({ role: "admin", email: "x@y.z", uid: "x1" });
    const res = await flip(app, "120249777765560789", "u_nur");
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain("ads_management");
  });

  it("status di luar ACTIVE/PAUSED ditolak sebelum menyentuh apa pun", async () => {
    const calls = stub();
    const { app } = build({ role: "admin", email: "x@y.z", uid: "x1" });
    const res = await flip(app, "120249777765560789", "u_nur", "ARCHIVED");
    expect(res.status).toBe(422);
    expect(calls.length).toBe(0);
  });
});

