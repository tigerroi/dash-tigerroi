import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { AuthError, bearerToken } from "./auth.js";
import { gatingRoutes } from "./gating.js";

// Store RTDB tiruan — bentuk yang sama dengan clientStore/adminStore di functions/store.mjs.
function fakeStore(data = {}) {
  const state = structuredClone(data);
  const at = (path) => path.split("/").reduce((node, key) => node?.[key], state);
  const write = (path, value) => {
    const parts = path.split("/");
    const last = parts.pop();
    let node = state;
    for (const part of parts) node = node[part] ??= {};
    if (value === null) delete node[last];
    else node[last] = value;
  };
  return {
    state,
    read: async (path) => at(path) ?? null,
    update: async (path, values) => {
      for (const [key, value] of Object.entries(values)) write(`${path}/${key}`, value);
    },
    replace: async (path, value) => write(path, value),
  };
}

const SUPERADMIN = async () => ({ uid: "u1", email: "dev@rabbitracing.live", role: "superadmin" });

function build({ authorize = SUPERADMIN, store = fakeStore() } = {}) {
  return new Elysia().use(gatingRoutes({ db: {}, apiKey: "key", store, authorize }));
}

const auth = { headers: { authorization: "Bearer t" } };

// HARUS "localhost", bukan host satu label seperti "http://x/...". Pengurai URL cepat milik Elysia
// gagal mengambil path dari host tanpa titik dan menjawab 404 untuk route yang sebenarnya terdaftar
// — kegagalan yang terbaca seperti route-nya tidak ada.
const url = (path) => `http://localhost${path}`;

describe("bearerToken", () => {
  it("tidak peka huruf besar-kecil, seperti yang diminta RFC 6750", () => {
    expect(bearerToken("Bearer abc")).toBe("abc");
    expect(bearerToken("bearer abc")).toBe("abc");
    expect(bearerToken("BEARER   abc  ")).toBe("abc");
  });

  it("skema lain dan header kosong tidak menghasilkan token", () => {
    // "" harus jatuh ke penolakan auth, bukan lolos sebagai token kosong.
    expect(bearerToken("Basic abc")).toBe("");
    expect(bearerToken("")).toBe("");
    expect(bearerToken(undefined)).toBe("");
  });
});

describe("gerbang auth", () => {
  it("tanpa token: 401 di setiap route", async () => {
    const app = build({
      authorize: async (token) => {
        if (!token) throw new AuthError("Token tidak dikirim.");
        return SUPERADMIN();
      },
    });

    for (const path of ["/gating/campaigns", "/gating/campaigns/36/preview"]) {
      const res = await app.handle(new Request(`http://localhost${path}`));
      expect(res.status).toBe(401);
    }
    const post = await app.handle(
      new Request("http://localhost/gating/campaigns/36/gate", { method: "POST" }),
    );
    expect(post.status).toBe(401);
  });

  it("token sah tapi bukan superadmin: 403, bukan 401", async () => {
    // Dijawab 401, browser akan mencoba menyegarkan token selamanya untuk penolakan yang tidak akan
    // pernah berubah karenanya.
    const app = build({
      authorize: async () => {
        throw new AuthError("Hanya superadmin yang boleh menjalankan gating.", 403);
      },
    });
    const res = await app.handle(new Request("http://localhost/gating/campaigns", auth));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/superadmin/);
  });

  it("pemeriksaan izin yang GAGAL bukan penolakan: 503", async () => {
    // RTDB tak terjangkau bukan berarti haknya dicabut, dan pesannya tidak boleh berbunyi begitu.
    const app = build({
      authorize: async () => {
        throw new Error("RTDB tak terjangkau");
      },
    });
    const res = await app.handle(new Request("http://localhost/gating/campaigns", auth));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/tidak bisa diperiksa/);
  });
});

describe("validasi parameter", () => {
  it("id campaign bukan angka: 422, tanpa menyentuh Keitaro", async () => {
    globalThis.fetch = async () => {
      throw new Error("tidak boleh dipanggil");
    };
    const app = build();
    const res = await app.handle(new Request("http://localhost/gating/campaigns/abc/preview", auth));
    expect(res.status).toBe(422);
  });
});

describe("gate", () => {
  it("meneruskan status vi-control apa adanya dan menandai perintahnya applied", async () => {
    const store = fakeStore();
    globalThis.fetch = async (url, options) => {
      if (url.endsWith("/campaigns")) {
        return Response.json([{ id: 36, gated: false }]);
      }
      expect(options.method).toBe("POST");
      expect(url).toEndWith("/campaigns/36/gate");
      return Response.json({
        runId: "r1",
        status: "ok",
        reload: { ok: false },
        verification: { cleanupComplete: true },
      });
    };

    const res = await app_gate(store);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.runId).toBe("r1");
    // `reload.ok: false` bukan kegagalan — perubahannya tersimpan, gate-nya saja yang belum
    // menyerapnya. Diteruskan sebagai catatan, bukan diangkat jadi error.
    expect(body.reloadPending).toBe(true);
    expect(store.state.dashboard.gating.commands.c36.state).toBe("applied");
    expect(store.state.dashboard.gating.campaigns.c36.gated).toBe(true);
  });

  it("gate ganda ditolak sebelum apa pun ditulis ke Keitaro", async () => {
    // Penjaga yang paling penting: pratinjau untuk campaign yang SUDAH di-gate tetap menjawab
    // applicable:true, dengan tujuan menunjuk ke URL gate itu sendiri.
    const store = fakeStore();
    let posted = false;
    globalThis.fetch = async (url, options) => {
      if (options?.method === "POST") posted = true;
      return Response.json([{ id: 36, gated: true }]);
    };

    const res = await app_gate(store);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.status).toBe("aborted");
    expect(body.error).toMatch(/sudah lewat gate/);
    expect(posted).toBe(false);
    expect(store.state.dashboard.gating.commands.c36.state).toBe("failed");
  });

  it("`problem` diteruskan sebagai problem, bukan dilebur jadi gagal", async () => {
    // Tersimpan TAPI verifikasinya gagal. Dilebur jadi "gagal", yang membacanya akan mengira tidak
    // ada yang berubah — padahal routing-nya sudah berubah dan tidak terbukti benar.
    const store = fakeStore();
    globalThis.fetch = async (url, options) =>
      options?.method === "POST"
        ? Response.json({ runId: "r7", status: "problem" })
        : Response.json([{ id: 36, gated: false }]);

    const body = await (await app_gate(store)).json();
    expect(body.status).toBe("problem");
    expect(store.state.dashboard.gating.commands.c36.result).toBe("problem");
  });

  it("Keitaro mati: 502, dan perintahnya tetap tercatat untuk cron", async () => {
    const store = fakeStore();
    globalThis.fetch = async () => Response.json({ error: "bad gateway" }, { status: 502 });

    const res = await app_gate(store);
    expect(res.status).toBe(502);
    // Ditulis SEBELUM dieksekusi, jadi proses yang mati di tengah meninggalkan jejak — bukan
    // perubahan routing tanpa catatan.
    expect(store.state.dashboard.gating.commands.c36.state).toBe("pending");
  });

  async function app_gate(store) {
    return build({ store }).handle(
      new Request("http://localhost/gating/campaigns/36/gate", { method: "POST", ...auth }),
    );
  }
});

describe("cache daftar campaign", () => {
  it("dua request berdekatan hanya membaca Keitaro sekali", async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return Response.json([{ id: 1, gated: false }]);
    };
    const app = build();
    await app.handle(new Request("http://localhost/gating/campaigns", auth));
    const second = await app.handle(new Request("http://localhost/gating/campaigns", auth));
    expect(calls).toBe(1);
    expect((await second.json()).cached).toBe(true);
  });

  it("?fresh=1 melewati cache", async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return Response.json([{ id: 1, gated: false }]);
    };
    const app = build();
    await app.handle(new Request("http://localhost/gating/campaigns", auth));
    await app.handle(new Request("http://localhost/gating/campaigns?fresh=1", auth));
    expect(calls).toBe(2);
  });
});

describe("preview", () => {
  it("dikembalikan dalam bentuk yang sama dengan baris cermin RTDB", async () => {
    // Kalau bentuknya berbeda dari `gatePreviewRow`, sisi UI butuh salinan ketiga dari bentuk itu —
    // dan salinan ketiga adalah tempat ketiga yang harus diubah tiap API-nya menambah field.
    globalThis.fetch = async () =>
      Response.json({
        plan: {
          campaignName: "NUR T2",
          applicable: true,
          blockers: [],
          current: { landingUrl: "https://bowlsharp.com/x" },
        },
        site: { status: "existing" },
        willSet: { landingUrl: "https://go.rabbitracing.live?t=abc" },
      });

    const res = await build().handle(new Request("http://localhost/gating/campaigns/36/preview", auth));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.campaignId).toBe("36");
    expect(body.applicable).toBe(true);
    expect(body.currentLandingUrl).toBe("https://bowlsharp.com/x");
    expect(body.willSetLandingUrl).toBe("https://go.rabbitracing.live?t=abc");
    expect(body.siteStatus).toBe("existing");
    // Blocker sebagai objek berkunci urutan, sama seperti di RTDB — bukan array, yang akan dibuang
    // RTDB saat kosong dan membuat kedua sumber berbeda bentuk justru di kasus paling umum.
    expect(body.blockers).toEqual({});
    expect(body.blockerCount).toBe(0);
    expect(typeof body.checkedAt).toBe("string");
  });

  it("Keitaro menolak: 502 dengan pesannya", async () => {
    globalThis.fetch = async () => Response.json({ error: "down" }, { status: 502 });
    const res = await build().handle(new Request("http://localhost/gating/campaigns/36/preview", auth));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/Keitaro/);
  });
});
