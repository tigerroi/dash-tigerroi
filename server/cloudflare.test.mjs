import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { AuthError } from "./auth.js";
import { cloudflareRoutes } from "./cloudflare.js";

/**
 * Cloudflare tiruan — dipasang sebagai `globalThis.fetch`, karena `functions/cloudflare.js` memakai
 * `fetch` global dan tidak menerima klien yang bisa dioper.
 *
 * Bentuk jawabannya sengaja sama persis dengan yang asli, termasuk `result_info`: yang diuji di
 * sini termasuk pengambilan SELURUH halaman, dan tiruan yang tidak berhalaman tidak akan pernah
 * menangkap daftar yang berhenti di halaman pertama.
 */
function fakeCloudflare(handler) {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const path = String(url).replace("https://api.cloudflare.com/client/v4", "");
    calls.push({
      path,
      method: options.method || "GET",
      body: options.body ? JSON.parse(options.body) : null,
      auth: options.headers?.Authorization || "",
    });
    const result = await handler(path, options, calls.length);
    return new Response(JSON.stringify(result.body), { status: result.status || 200 });
  };
  return calls;
}

const ZONES = {
  success: true,
  result: [
    { id: "a".repeat(32), name: "petcins.com", status: "active", permissions: ["#dns_records:edit"] },
  ],
  result_info: { page: 1, total_pages: 1 },
};

const SUPERADMIN = async () => ({ uid: "u1", email: "dev@rabbitracing.live", role: "superadmin" });

function build({ authorize = SUPERADMIN, apiKey = "cfat_test", accountId = "acc1" } = {}) {
  return new Elysia().use(cloudflareRoutes({ db: {}, apiKey, accountId, authorize }));
}

// HARUS "localhost": pengurai URL cepat milik Elysia gagal mengambil path dari host tanpa titik dan
// menjawab 404 untuk route yang sebenarnya terdaftar.
const url = (path) => `http://localhost${path}`;
const auth = { headers: { authorization: "Bearer t" } };
const ZONE = "a".repeat(32);
const RECORD = "b".repeat(32);

describe("gerbang superadmin", () => {
  it("menolak yang bukan superadmin dengan 403 di setiap route", async () => {
    const app = build({
      authorize: async () => {
        throw new AuthError("Hanya superadmin.", 403);
      },
    });

    // Body-nya SAH di tiap POST, supaya yang menolak benar-benar gerbangnya dan bukan validator
    // bentuk — sebuah tes yang lewat karena body-nya kosong tidak menguji izin sama sekali.
    const valid = JSON.stringify({ type: "A", name: "care", content: "1.1.1.1" });
    for (const [method, path, body] of [
      ["GET", "/cloudflare/zones"],
      ["GET", `/cloudflare/zones/${ZONE}/dns`],
      ["POST", `/cloudflare/zones/${ZONE}/dns`, valid],
      ["POST", `/cloudflare/zones/${ZONE}/dns/${RECORD}`, valid],
      ["POST", `/cloudflare/zones/${ZONE}/dns/${RECORD}/delete`],
    ]) {
      const res = await app.handle(
        new Request(url(path), {
          method,
          headers: { ...auth.headers, "content-type": "application/json" },
          body,
        }),
      );
      expect(res.status).toBe(403);
    }
  });

  it("pemeriksaan izin yang GAGAL jadi 503, bukan 401", async () => {
    // Dijawab 401, orang akan mengira haknya dicabut dan login ulang berkali-kali untuk masalah
    // yang tidak ada hubungannya dengan dia.
    const app = build({
      authorize: async () => {
        throw new Error("RTDB tak terjangkau");
      },
    });
    const res = await app.handle(new Request(url("/cloudflare/zones"), auth));
    expect(res.status).toBe(503);
  });
});

describe("token belum di-set", () => {
  it("menjawab 503 berikut sebabnya, bukan 500", async () => {
    // Servernya hidup, fiturnya yang belum dikonfigurasi — dan halaman membaca ini untuk
    // mengatakan apa yang kurang.
    const app = build({ apiKey: "" });
    const res = await app.handle(new Request(url("/cloudflare/zones"), auth));
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("no_token");
  });
});

describe("daftar zona", () => {
  it("menyaring dengan account.id dan mengambil SELURUH halaman", async () => {
    const calls = fakeCloudflare((path) => {
      const page = Number(/page=(\d+)/.exec(path)?.[1] || 1);
      return {
        body: {
          success: true,
          result: [
            { id: String(page).repeat(32).slice(0, 32), name: `z${page}.com`, permissions: [] },
          ],
          result_info: { page, total_pages: 2 },
        },
      };
    });

    const res = await build().handle(new Request(url("/cloudflare/zones"), auth));
    const body = await res.json();

    expect(res.status).toBe(200);
    // Halaman kedua IKUT: daftar yang berhenti di halaman pertama menyembunyikan zona, dan yang
    // hilang tidak berbunyi sebagai apa pun.
    expect(body.length).toBe(2);
    expect(calls[0].path).toContain("account.id=acc1");
    expect(calls[0].auth).toBe("Bearer cfat_test");
  });
});

describe("kepemilikan zona", () => {
  it("zona di luar akun ditolak 404 — TANPA menyentuh record-nya", async () => {
    // Tanpa pemeriksaan ini, endpoint ini jadi editor DNS untuk zona mana pun yang bisa disentuh
    // token kita, cukup dengan mengoper id zona milik akun lain.
    const calls = fakeCloudflare(() => ({ body: ZONES }));
    const asing = "c".repeat(32);

    const res = await build().handle(new Request(url(`/cloudflare/zones/${asing}/dns`), auth));

    expect(res.status).toBe(404);
    expect(calls.some((call) => call.path.includes("dns_records"))).toBe(false);
  });

  it("id yang bukan 32 hex ditolak validator, tidak pernah disambung jadi alamat API", async () => {
    const calls = fakeCloudflare(() => ({ body: ZONES }));
    const res = await build().handle(
      new Request(url("/cloudflare/zones/..%2Fmemberships/dns"), auth),
    );
    expect(res.status).toBe(422);
    expect(calls.length).toBe(0);
  });
});

describe("baca record", () => {
  it("mengembalikan zona berikut record-nya, dipetakan bukan dioper mentah", async () => {
    fakeCloudflare((path) => {
      if (path.startsWith("/zones?")) return { body: ZONES };
      return {
        body: {
          success: true,
          result: [
            {
              id: RECORD,
              type: "A",
              name: "care.petcins.com",
              content: "95.216.102.108",
              ttl: 1,
              proxied: false,
              proxiable: true,
              meta: { rahasia: "milik Cloudflare" },
              tags: [],
            },
          ],
          result_info: { page: 1, total_pages: 1 },
        },
      };
    });

    const res = await build().handle(new Request(url(`/cloudflare/zones/${ZONE}/dns`), auth));
    const body = await res.json();

    expect(body.zone.name).toBe("petcins.com");
    expect(body.records[0].content).toBe("95.216.102.108");
    // Bentuk internal API pihak ketiga tidak boleh jadi kontrak halaman ini.
    expect(body.records[0].meta).toBeUndefined();
  });
});

describe("tulis record", () => {
  it("melengkapi nama dari zona yang DIBACA server, bukan dari request", async () => {
    const calls = fakeCloudflare((path) => {
      if (path.startsWith("/zones?")) return { body: ZONES };
      return { body: { success: true, result: { id: RECORD, type: "A", name: "x" } } };
    });

    const res = await build().handle(
      new Request(url(`/cloudflare/zones/${ZONE}/dns`), {
        method: "POST",
        headers: { ...auth.headers, "content-type": "application/json" },
        body: JSON.stringify({ type: "A", name: "care", content: "95.216.102.108" }),
      }),
    );

    expect(res.status).toBe(200);
    const write = calls.find((call) => call.method === "POST");
    expect(write.body.name).toBe("care.petcins.com");
    expect(write.body.ttl).toBe(1);
  });

  it("menyunting memakai PUT, supaya kotak yang dikosongkan benar-benar terhapus", async () => {
    // PATCH menambal field yang disebutkan saja: komentar yang dihapus orang akan bertahan di
    // Cloudflare sementara layar menunjukkan kotak kosong.
    const calls = fakeCloudflare((path) => {
      if (path.startsWith("/zones?")) return { body: ZONES };
      return { body: { success: true, result: { id: RECORD, type: "A", name: "x" } } };
    });

    await build().handle(
      new Request(url(`/cloudflare/zones/${ZONE}/dns/${RECORD}`), {
        method: "POST",
        headers: { ...auth.headers, "content-type": "application/json" },
        body: JSON.stringify({ type: "A", name: "care", content: "1.1.1.1" }),
      }),
    );

    expect(calls.find((call) => call.path.includes(RECORD)).method).toBe("PUT");
  });

  it("isian yang tidak sah jadi 422 dan tidak pernah dikirim ke Cloudflare", async () => {
    const calls = fakeCloudflare((path) => {
      if (path.startsWith("/zones?")) return { body: ZONES };
      return { body: { success: true, result: {} } };
    });

    const res = await build().handle(
      new Request(url(`/cloudflare/zones/${ZONE}/dns`), {
        method: "POST",
        headers: { ...auth.headers, "content-type": "application/json" },
        body: JSON.stringify({ type: "CNAME", name: "care", content: "1.2.3.4" }),
      }),
    );

    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/Pakai record A/);
    expect(calls.some((call) => call.method === "POST")).toBe(false);
  });

  it("`success: false` dengan HTTP 200 tetap dibaca sebagai GAGAL", async () => {
    // Kegagalan diam yang sebentuk dengan plugin yang menjawab 200 berisi nilai lama: dibaca dari
    // status HTTP-nya saja, layar akan berbunyi "Tersimpan." untuk record yang tidak pernah ada.
    fakeCloudflare((path) => {
      if (path.startsWith("/zones?")) return { body: ZONES };
      return {
        status: 200,
        body: { success: false, errors: [{ code: 81057, message: "Record already exists" }] },
      };
    });

    const res = await build().handle(
      new Request(url(`/cloudflare/zones/${ZONE}/dns`), {
        method: "POST",
        headers: { ...auth.headers, "content-type": "application/json" },
        body: JSON.stringify({ type: "A", name: "care", content: "1.1.1.1" }),
      }),
    );

    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe("81057");
  });

  it("token yang ditolak naik jadi 502, bukan menyamar sebagai kesalahan pengisian", async () => {
    fakeCloudflare(() => ({
      status: 403,
      body: { success: false, errors: [{ code: 10000, message: "Authentication error" }] },
    }));

    const res = await build().handle(new Request(url("/cloudflare/zones"), auth));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/CLOUDFLARE_API_TOKEN/);
  });
});

describe("hapus record", () => {
  it("lewat POST /delete, dan memanggil DELETE ke Cloudflare", async () => {
    // POST karena CORS server ini mengizinkan GET dan POST saja; melebarkannya demi satu route
    // berarti mengubah aturan yang menjaga gate/ungate dan saklar campaign juga.
    const calls = fakeCloudflare((path) => {
      if (path.startsWith("/zones?")) return { body: ZONES };
      return { body: { success: true, result: { id: RECORD } } };
    });

    const res = await build().handle(
      new Request(url(`/cloudflare/zones/${ZONE}/dns/${RECORD}/delete`), {
        method: "POST",
        ...auth,
      }),
    );

    expect(res.status).toBe(200);
    expect((await res.json()).deleted).toBe(true);
    expect(calls.find((call) => call.path.includes(RECORD)).method).toBe("DELETE");
  });
});
