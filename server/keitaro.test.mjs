import { describe, expect, it } from "bun:test";
import { KeitaroFailure, keitaroSiteCreator } from "./keitaro.js";

const store = (sub) => ({ read: async () => sub, update: async () => {} });
const url = "https://care.petcins.com/lp?k=v";

describe("keitaroSiteCreator — ditolak sebelum Keitaro disentuh", () => {
  it("PIC kosong dan awalan kosong = 422", async () => {
    const create = keitaroSiteCreator({ store: store({ name: "care.petcins.com" }), apiKey: "k" });
    const error = await create("s1", { url }).catch((e) => e);
    expect(error).toBeInstanceOf(KeitaroFailure);
    expect(error.status).toBe(422);
    expect(error.message).toContain("PIC care.petcins.com kosong");
  });

  it("URL di host lain = 422, tanpa key = 503", async () => {
    const sub = { name: "care.petcins.com", pic: "Aca" };
    const create = keitaroSiteCreator({ store: store(sub), apiKey: "k" });
    expect((await create("s1", { url: "https://x.com/lp" }).catch((e) => e)).status).toBe(422);
    const noKey = keitaroSiteCreator({ store: store(sub), apiKey: "" });
    expect((await noKey("s1", { url }).catch((e) => e)).code).toBe("no_token");
  });
});
