import { describe, expect, it } from "bun:test";
import { Elysia, t } from "elysia";
import { controlErrorResponse } from "./errors.js";

// HARUS "localhost": pengurai URL cepat Elysia gagal mengambil path dari host satu label dan
// menjawab 404 untuk route yang sebenarnya terdaftar.
const URL_BASE = "http://localhost";

// Route tiruan dengan skema yang SAMA BENTUKNYA dengan POST /campaigns/:id/status. Yang diuji di
// sini bukan route-nya melainkan `error.type` yang dikirim Elysia — kalau versi Elysia berikutnya
// menamainya lain, kalimat body diam-diam kembali menyebut id campaign.
const app = new Elysia()
  .onError({ as: "global" }, ({ code, error, set }) => {
    const { status, body } = controlErrorResponse(code, error);
    set.status = status;
    return body;
  })
  .post("/campaigns/:campaignId/status", () => ({ ok: true }), {
    params: t.Object({ campaignId: t.String({ pattern: "^[0-9]+$" }) }),
    body: t.Object({
      userId: t.String({ minLength: 1 }),
      status: t.Union([t.Literal("ACTIVE"), t.Literal("PAUSED")]),
    }),
  });

const post = (path, body) =>
  app.handle(
    new Request(`${URL_BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

describe("kalimat error server kontrol", () => {
  it("body yang salah menyebut BODY, bukan id campaign", async () => {
    const res = await post("/campaigns/123/status", {});
    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain("Body tidak valid");
  });

  it("status di luar ACTIVE/PAUSED juga menyebut body", async () => {
    const res = await post("/campaigns/123/status", { userId: "u1", status: "MATI" });
    expect((await res.json()).error).toContain("Body tidak valid");
  });

  it("id campaign bukan angka tetap menyebut id campaign", async () => {
    const res = await post("/campaigns/abc/status", { userId: "u1", status: "PAUSED" });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain("id campaign harus angka");
  });

  it("endpoint tak dikenal 404, dan yang tak terduga 500 + ditandai untuk dicatat", () => {
    expect(controlErrorResponse("NOT_FOUND").status).toBe(404);
    const unknown = controlErrorResponse("UNKNOWN", new Error("x"));
    expect(unknown.status).toBe(500);
    expect(unknown.log).toBe(true);
  });
});
