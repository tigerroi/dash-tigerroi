import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { scheduledLaunchRoutes } from "./scheduled-launches.js";

const URL_BASE = "http://localhost";

function build({ fetchAdSets, clock, readDnsRecords } = {}) {
  const store = {
    read: async (path) =>
      path === "subDomains"
        ? { s1: { name: "care.petcins.com" }, s2: { name: "baru.petcins.com" } }
        : path === "adAccounts"
        ? {
            a1: { actId: "act_1", name: "TBZ 1247", userOwner: "Godek" },
            a2: { actId: "act_2", name: "TBZ 1236", userOwner: "Aca" },
            a3: { actId: "act_3", name: "Mati", syncDisabled: "Nonaktif" },
          }
        : null,
  };
  const calls = [];
  const app = new Elysia().use(
    scheduledLaunchRoutes({
      db: {},
      store,
      metaToken: "token",
      authorize: async () => ({ uid: "u1" }),
      clock: clock || (() => new Date("2026-09-17T05:00:00Z")),
      readDnsRecords,
      fetchAdSets: async (actId) => {
        calls.push(actId);
        return fetchAdSets(actId);
      },
    }),
  );
  return { app, calls };
}

const get = (app, query = "") =>
  app.handle(
    new Request(`${URL_BASE}/scheduled-launches${query}`, {
      headers: { authorization: "Bearer t" },
    }),
  );

const future = (id) => ({
  id,
  name: `Adset ${id}`,
  status: "ACTIVE",
  startTime: "2026-09-18T09:00:00+0700",
  campaignId: "9",
  campaign: "RNPX",
  campaignStatus: "ACTIVE",
  campaignStartTime: "2026-09-18T09:00:00+0700",
});

describe("GET /scheduled-launches", () => {
  it("menggabungkan seluruh akun aktif, dan akun yang gagal DISEBUT", async () => {
    const { app, calls } = build({
      fetchAdSets: async (actId) => {
        if (actId === "act_2") throw new Error("Meta act_2 -> (#200)");
        return [future("11")];
      },
    });
    const res = await get(app);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(calls).toEqual(["act_1", "act_2"]);
    expect(body.rows.map((row) => [row.adSetId, row.pic])).toEqual([["11", "Godek"]]);
    expect(body.failedAccounts).toEqual([
      { id: "a2", name: "TBZ 1236", message: "Meta act_2 -> (#200)" },
    ]);
    expect(body.accountCount).toBe(2);
  });

  it("menyertakan server tiap subdomain; Cloudflare yang gagal tidak menjatuhkan jadwal", async () => {
    const ok = build({
      fetchAdSets: async () => [future("11")],
      readDnsRecords: async () => [{ type: "A", name: "care.petcins.com", content: "1.2.3.4" }],
    });
    const body = await (await get(ok.app)).json();
    expect(body.servers).toEqual({ "care.petcins.com": "1.2.3.4" });
    expect(body.serverError).toBe("");

    const down = build({
      fetchAdSets: async () => [future("11")],
      readDnsRecords: async () => {
        throw new Error("Cloudflare 503");
      },
    });
    const res = await get(down.app);
    expect(res.status).toBe(200);
    const failed = await res.json();
    expect(failed.servers).toBe(null);
    expect(failed.serverError).toBe("Cloudflare 503");
    expect(failed.rows.length).toBe(2);
  });

  it("menjawab dari cermin dua menit, dan Segarkan tidak lebih sering dari 30 detik", async () => {
    let t = Date.parse("2026-09-17T05:00:00Z");
    const { app, calls } = build({
      fetchAdSets: async () => [future("11")],
      clock: () => new Date(t),
    });
    await get(app);
    await get(app);
    expect(calls.length).toBe(2); // satu putaran, dua akun
    t += 10_000;
    await get(app, "?refresh=1");
    expect(calls.length).toBe(2);
    t += 30_000;
    await get(app, "?refresh=1");
    expect(calls.length).toBe(4);
    t += 2 * 60_000;
    await get(app);
    expect(calls.length).toBe(6);
  });
});

describe("POST /scheduled-launches/adsets/:adSetId/start", () => {
  function shiftApp({ actor, adSet }) {
    const writes = [];
    const store = {
      read: async (path) =>
        path === "adAccounts"
          ? { a1: { actId: "act_1", name: "TBZ 1247", userOwner: "Godek" } }
          : { u1: { name: "Godek", email: "godek@x.id" } },
    };
    const app = new Elysia().use(
      scheduledLaunchRoutes({
        db: {},
        store,
        metaToken: "token",
        authorize: async () => actor,
        clock: () => new Date("2026-09-17T05:00:00Z"),
        fetchAdSets: async () => [],
        readAdSet: async (id) => ({
          id,
          accountId: "1",
          startTime: "2026-09-18T09:00:00+0700",
          endTime: "",
          ...adSet,
        }),
        writeAdSet: async (id, _token, changes) => writes.push([id, changes]),
      }),
    );
    const post = (startTime) =>
      app.handle(
        new Request(`${URL_BASE}/scheduled-launches/adsets/55/start`, {
          method: "POST",
          headers: { authorization: "Bearer t", "content-type": "application/json" },
          body: JSON.stringify({ startTime }),
        }),
      );
    return { post, writes };
  }

  it("pemilik ad account boleh menggeser, jamnya WIB eksplisit", async () => {
    const { post, writes } = shiftApp({ actor: { email: "GODEK@x.id", role: "user" } });
    const res = await post("2026-09-18T09:30");
    expect(res.status).toBe(200);
    expect(writes).toEqual([["55", { startTime: "2026-09-18T09:30:00+07:00" }]]);
  });

  it("bukan admin dan bukan pemilik ditolak 403, tanpa menulis", async () => {
    const { post, writes } = shiftApp({ actor: { email: "aca@x.id", role: "user" } });
    expect((await post("2026-09-18T09:30")).status).toBe(403);
    expect(writes).toEqual([]);
  });

  it("ad set di luar armada 404, jam lampau 422", async () => {
    const admin = { email: "a@x.id", role: "admin" };
    expect((await shiftApp({ actor: admin, adSet: { accountId: "9" } }).post("2026-09-18T09:30")).status).toBe(404);
    expect((await shiftApp({ actor: admin }).post("2026-09-17T11:00")).status).toBe(422);
  });
});
