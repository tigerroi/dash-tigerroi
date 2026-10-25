import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { openActivityDb } from "./activity-db.js";
import { activityRoutes, clientIp, deviceOf, geoOf } from "./activity.js";
import { AuthError } from "./auth.js";

// HARUS "localhost": pengurai URL cepat Elysia gagal mengambil path dari host satu label dan
// menjawab 404 untuk route yang sebenarnya terdaftar.
const URL_BASE = "http://localhost";

function build(
  actor = { uid: "u1", email: "admin@rabbit.id", role: "admin" },
  activityDb = openActivityDb(":memory:"),
) {
  const app = new Elysia().use(
    activityRoutes({
      db: {},
      activityDb,
      authorize: async () => actor,
      authorizeRead: async () => actor,
    }),
  );
  return { app, activityDb };
}

function post(app, events, headers = {}) {
  return app.handle(
    new Request(`${URL_BASE}/activity-logs`, {
      method: "POST",
      headers: {
        authorization: "Bearer t",
        "content-type": "application/json",
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        ...headers,
      },
      body: JSON.stringify({ events }),
    }),
  );
}

function event(overrides = {}) {
  return {
    id: "0d1e2f3a-4b5c-6d7e-8f90-a1b2c3d4e5f6",
    at: "2026-08-19T09:00:00.000Z",
    category: "operation",
    action: "update",
    ...overrides,
  };
}

function find(activityDb, id) {
  return activityDb.queryRange({}).find((row) => row.id === id);
}

describe("clientIp", () => {
  it("mengambil entri yang ditulis proxy TERDEKAT, bukan yang paling kiri", () => {
    // Yang paling kiri ditulis KLIEN. Diambil dari sana, siapa pun bisa mengirim
    // `X-Forwarded-For: 1.2.3.4` dan mengganti alamatnya sendiri di seluruh log.
    expect(clientIp({ "x-forwarded-for": "1.2.3.4, 114.125.1.1" }, "10.0.0.1", 1)).toBe(
      "114.125.1.1",
    );
  });

  it("tanpa proxy tepercaya, yang dipakai adalah alamat peer", () => {
    expect(clientIp({ "x-forwarded-for": "1.2.3.4" }, "114.125.1.1", 0)).toBe("114.125.1.1");
  });

  it("Cloudflare menang atas X-Forwarded-For", () => {
    expect(
      clientIp({ "cf-connecting-ip": "114.125.1.1", "x-forwarded-for": "1.2.3.4" }, "", 1),
    ).toBe("114.125.1.1");
  });

  it("membuka bentuk IPv4 terpetakan IPv6", () => {
    // "::ffff:…" tidak dikenali satu pun basis data geolokasi.
    expect(clientIp({}, "::ffff:114.125.1.1", 0)).toBe("114.125.1.1");
  });
});

describe("geoOf", () => {
  it("menemukan kota dari alamat yang dikenali", () => {
    expect(geoOf("114.125.1.1").city).toBe("Medan");
  });

  it("yang tidak dikenali tetap kosong, bukan ditebak", () => {
    // Alamat privat, VPN, dan rentang CDN memang tidak punya kota. Sebuah "Jakarta" yang dikarang
    // akan dibaca sebagai fakta oleh orang yang menelusuri akses mencurigakan.
    expect(geoOf("192.168.1.1")).toEqual({ city: "", region: "", country: "" });
    expect(geoOf("")).toEqual({ city: "", region: "", country: "" });
  });
});

describe("deviceOf", () => {
  it("meringkas User-Agent jadi nama yang terbaca", () => {
    const parsed = deviceOf(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    );
    expect(parsed.browser).toBe("Chrome 131");
    expect(parsed.os).toStartWith("macOS");
  });

  it("User-Agent kosong tidak melempar", () => {
    expect(deviceOf("")).toEqual({ browser: "", os: "", device: "" });
  });
});

describe("POST /activity-logs", () => {
  it("mencap IP, kota, dan perangkat dari yang DIAMATI server", async () => {
    const { app, activityDb } = build();
    const res = await post(app, [event()], { "x-forwarded-for": "114.125.1.1" });
    expect(res.status).toBe(200);

    const row = find(activityDb, "0d1e2f3a-4b5c-6d7e-8f90-a1b2c3d4e5f6");
    expect(row.ip).toBe("114.125.1.1");
    expect(row.city).toBe("Medan");
    expect(row.browser).toBe("Chrome 131");
  });

  it("mengabaikan ip/kota yang dikirim browser", async () => {
    // Inti dari kenapa jalur ini lewat server sama sekali: baris yang alamatnya bisa diketik
    // pemiliknya sendiri bukan baris audit.
    const { app, activityDb } = build();
    await post(app, [event({ ip: "8.8.8.8", city: "Tokyo" })], {
      "x-forwarded-for": "114.125.1.1",
    });

    const row = find(activityDb, "0d1e2f3a-4b5c-6d7e-8f90-a1b2c3d4e5f6");
    expect(row.ip).toBe("114.125.1.1");
    expect(row.city).toBe("Medan");
  });

  it("mencap pengirim di samping aktor, supaya baris titipan terbedakan", async () => {
    // Login yang GAGAL tidak punya token; barisnya menumpang sesi berikutnya di perangkat yang
    // sama. Tanpa cap ini, siapa pun bisa menaruh kejadian atas nama orang lain di riwayat hanya
    // dengan menyunting localStorage-nya.
    const { app, activityDb } = build({ uid: "u2", email: "orang@rabbit.id", role: "user" });
    await post(app, [event({ category: "auth", action: "login_failed", actorEmail: "bos@rabbit.id" })]);

    const row = find(activityDb, "0d1e2f3a-4b5c-6d7e-8f90-a1b2c3d4e5f6");
    expect(row.actorEmail).toBe("bos@rabbit.id");
    expect(row.reportedByEmail).toBe("orang@rabbit.id");
  });

  it("menyimpan jam browser DAN jam server berdampingan", async () => {
    const { app, activityDb } = build();
    await post(app, [event()]);

    const row = find(activityDb, "0d1e2f3a-4b5c-6d7e-8f90-a1b2c3d4e5f6");
    // Jam perangkat boleh meleset berjam-jam, dan yang menjelaskan urutan aneh di tabel justru
    // selisih keduanya. Menimpa `at` akan menghapus satu-satunya petunjuk itu.
    expect(row.at).toBe("2026-08-19T09:00:00.000Z");
    expect(row.receivedAt).not.toBe(row.at);
  });

  it("id yang bisa menulis ke cabang lain ditolak", async () => {
    const { app } = build();
    const res = await post(app, [event({ id: "a/b/c" })]);
    expect(res.status).toBe(422);
  });

  it("kategori di luar daftar ditolak", async () => {
    const { app } = build();
    expect((await post(app, [event({ category: "ngawur" })])).status).toBe(422);
  });

  it("batch di atas 100 ditolak utuh", async () => {
    const { app } = build();
    const many = Array.from({ length: 101 }, (_, i) =>
      event({ id: `0d1e2f3a-4b5c-6d7e-8f90-a1b2c3d4e${String(i).padStart(3, "0")}` }),
    );
    expect((await post(app, many)).status).toBe(422);
  });

  it("id yang sama ditulis ulang ke baris yang sama, bukan digandakan", async () => {
    // Batch yang sampai tapi jawabannya hilang di jaringan dikirim lagi lima menit kemudian.
    const { app, activityDb } = build();
    await post(app, [event()]);
    await post(app, [event()]);
    expect(activityDb.queryRange({})).toHaveLength(1);
  });

  it("penyimpanan yang menolak menulis dijawab 502, supaya browser menyimpan batch-nya", async () => {
    const activityDb = openActivityDb(":memory:");
    activityDb.insertRows = () => {
      throw new Error("disk full");
    };
    const { app } = build(undefined, activityDb);
    expect((await post(app, [event()])).status).toBe(502);
  });
});

describe("GET /activity-logs", () => {
  it("mengembalikan baris dalam rentang, terbaru dulu", async () => {
    const { app, activityDb } = build();
    activityDb.insertRows([
      { id: "a".repeat(12), at: "2026-08-18T10:00:00.000Z", category: "auth", action: "login" },
      { id: "b".repeat(12), at: "2026-08-19T10:00:00.000Z", category: "auth", action: "login" },
    ]);
    const res = await app.handle(
      new Request(`${URL_BASE}/activity-logs?start=2026-08-19T00&end=2026-08-19T99`, {
        headers: { authorization: "Bearer t" },
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].id).toBe("b".repeat(12));
    expect(body.truncated).toBe(false);
  });

  it("ditolak untuk yang bukan superadmin", async () => {
    const app = new Elysia().use(
      activityRoutes({
        db: {},
        activityDb: openActivityDb(":memory:"),
        authorizeRead: async () => {
          throw new AuthError("Khusus superadmin.", 403);
        },
      }),
    );
    const res = await app.handle(
      new Request(`${URL_BASE}/activity-logs`, { headers: { authorization: "Bearer t" } }),
    );
    expect(res.status).toBe(403);
  });
});
