import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import {
  bootstrapCommand,
  bootstrapScript,
  bootstrapServer,
  keyRejected,
  pickServer,
  pluginZipFetcher,
  scriptOutdated,
  setupScriptSha,
  wpAdminHeader,
  setupSubRoutes,
} from "./setup-sub.js";

// Store RTDB tiruan — `update` MENGGABUNG, karena writeSetup menambahkan patch ke baris `setup`
// yang sama dan test membaca keadaan akhirnya dari sana.
function fakeStore() {
  const state = {};
  return {
    state,
    read: async (path) => state[path] ?? null,
    replace: async (path, value) => {
      state[path] = value;
    },
    update: async (path, patch) => {
      state[path] = { ...(state[path] || {}), ...patch };
    },
  };
}

// Sub yang sudah ter-enroll (apiKey ada), jadi run() melewati enroll dan `enrolled` jadi true —
// itulah yang membedakan "partial" dari "failed" saat lisensi/behaviour gagal sesudahnya.
function seed(store, id = "s1") {
  store.state[`subDomains/${id}`] = { name: "care.petcins.com", parentDomain: "petcins.com" };
  store.state[`pluginKeys/${id}/apiKey`] = "k";
  return id;
}

const SUPERADMIN = async () => ({ uid: "u1", email: "boss@rabbitracing.live", role: "superadmin" });
const okInstall = async () => ({ ssl: "ok", plugin: "0.4.7", installedWordpress: false });

function build({
  store = fakeStore(),
  runRemote = okInstall,
  applyLicense,
  applyConfig,
  ...siteSteps
} = {}) {
  const app = new Elysia().use(
    setupSubRoutes({
      db: {},
      store,
      sshKey: "",
      cloudflareToken: "",
      resolveDns: async () => ({ ip: "1.2.3.4", note: "" }), // tanpa jaringan.
      cloudflareAccount: "",
      enrollToken: "tok",
      authorize: SUPERADMIN,
      runRemote,
      applyLicense,
      applyConfig,
      postPollMs: 1,
      ...siteSteps,
    }),
  );
  return { app, store };
}

const bulk = (app, body) =>
  app.handle(
    new Request("http://localhost/setup-sub/bulk", {
      method: "POST",
      headers: { authorization: "Bearer t", "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

async function finished(store, id, tries = 100) {
  for (let i = 0; i < tries; i++) {
    const setup = store.state[`subDomains/${id}/setup`];
    if (setup && !["running", "queued"].includes(setup.state)) return setup;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("setup tidak pernah selesai");
}

describe("setup-sub run(): partial vs failed", () => {
  it("gagal SEBELUM enroll (install) -> failed", async () => {
    const store = fakeStore();
    const id = seed(store);
    const { app } = build({
      store,
      runRemote: async () => {
        throw new Error("WordPress gagal dipasang");
      },
    });
    await bulk(app, { ids: [id] });
    const setup = await finished(store, id);
    expect(setup.state).toBe("failed");
  });

  it("grup pengaturan gagal SESUDAH enroll -> partial (situs + plugin sudah hidup)", async () => {
    const store = fakeStore();
    const id = seed(store);
    const { app } = build({
      store,
      applyConfig: async () => {
        throw new Error("situs menolak");
      },
    });
    await bulk(app, { ids: [id], config: { behaviour: { behaviour_detection: true } } });
    const setup = await finished(store, id);
    expect(setup.state).toBe("partial");
  });

  it("lisensi + beberapa grup diterapkan, id + grup diteruskan apa adanya -> done", async () => {
    const store = fakeStore();
    const id = seed(store);
    const calls = { license: null, config: [] };
    const { app } = build({
      store,
      applyLicense: async (subId, key) => {
        calls.license = { subId, key };
        return { active: true };
      },
      applyConfig: async (subId, group, values) => {
        calls.config.push({ subId, group, values });
        return { unapplied: [] };
      },
    });
    await bulk(app, {
      ids: [id],
      licenseKey: "RBT0-1111-2222-3333",
      config: { behaviour: { behaviour_detection: true }, cmp: { cmp_enabled: true } },
    });
    const setup = await finished(store, id);
    expect(setup.state).toBe("done");
    expect(calls.license).toEqual({ subId: id, key: "RBT0-1111-2222-3333" });
    expect(calls.config).toEqual([
      { subId: id, group: "behaviour", values: { behaviour_detection: true } },
      { subId: id, group: "cmp", values: { cmp_enabled: true } },
    ]);
  });

  it("lisensi PER SUB: tiap sub menerima key-nya sendiri, yang tanpa key dilewati", async () => {
    const store = fakeStore();
    const a = seed(store, "a");
    const b = seed(store, "b");
    const c = seed(store, "c");
    const got = {};
    const { app } = build({
      store,
      applyLicense: async (subId, key) => {
        got[subId] = key;
        return { active: true };
      },
    });
    await bulk(app, { ids: [a, b, c], licenses: { a: " RBT0-AAAA ", b: "RBT0-BBBB" } });
    for (const id of [a, b, c]) expect((await finished(store, id)).state).toBe("done");
    expect(got).toEqual({ a: "RBT0-AAAA", b: "RBT0-BBBB" });
  });

  it("licenseKey tunggal (bundle lama) tetap berlaku sebagai cadangan", async () => {
    const store = fakeStore();
    const id = seed(store);
    let key = "";
    const { app } = build({
      store,
      applyLicense: async (_subId, k) => {
        key = k;
        return { active: true };
      },
    });
    await bulk(app, { ids: [id], licenseKey: "RBT0-OLD" });
    await finished(store, id);
    expect(key).toBe("RBT0-OLD");
  });

  it("grup tidak dikenal -> 422, tidak ada yang diantre", async () => {
    const store = fakeStore();
    const id = seed(store);
    const { app } = build({ store });
    const res = await bulk(app, { ids: [id], config: { "ads-settings": {}, bogus: { x: 1 } } });
    expect(res.status).toBe(422);
    expect(store.state[`subDomains/${id}/setup`]).toBeUndefined();
  });

  it("tanpa lisensi/grup: keduanya tidak dipanggil, tetap done", async () => {
    const store = fakeStore();
    const id = seed(store);
    let touched = 0;
    const { app } = build({
      store,
      applyLicense: async () => {
        touched++;
        return { active: true };
      },
      applyConfig: async () => {
        touched++;
        return { unapplied: [] };
      },
    });
    await bulk(app, { ids: [id] });
    const setup = await finished(store, id);
    expect(setup.state).toBe("done");
    expect(touched).toBe(0);
  });
});

describe("server tujuan", () => {
  const zone = [
    // Sisa record ke server lain (sub uji lama) tidak boleh menarik pilihannya.
    { type: "A", name: "a.designingaround.com", content: "88.99.216.50" },
    { type: "A", name: "designingaround.com", content: "195.201.56.95" },
  ];

  it("IP apex domain induk, tanpa daftar server", () => {
    expect(pickServer(zone, "designingaround.com")).toBe("195.201.56.95");
  });

  it("apex tanpa A record -> ditolak, bukan ditebak", () => {
    expect(() => pickServer(zone.slice(0, 1), "designingaround.com")).toThrow("belum punya");
  });
});

describe("bootstrap server baru", () => {
  it("kunci ditolak = exit 255 + Permission denied; kegagalan skrip bukan", () => {
    expect(keyRejected({ code: 255, stderr: "rabbitroi@1.2.3.4: Permission denied (publickey)." })).toBe(true);
    expect(keyRejected({ code: 1, stderr: "ERROR Permission denied" })).toBe(false);
  });

  it("skrip menulis tiap berkas lalu menjalankan bootstrap.sh dengan kunci publik", () => {
    const script = bootstrapScript({ "a.sh": "echo a\n", "bootstrap.sh": "echo b" }, "ssh-ed25519 AAAA rabbit-control");
    expect(script).toContain("cat > /tmp/rabbitroi-bootstrap/a.sh <<'RABBITROI_EOF'\necho a\nRABBITROI_EOF");
    expect(script.trim().endsWith("bash /tmp/rabbitroi-bootstrap/bootstrap.sh 'ssh-ed25519 AAAA rabbit-control'")).toBe(true);
    expect(() => bootstrapScript({}, "ssh-rsa AAAA'; rm -rf /")).toThrow("tidak sah");
    expect(bootstrapScript({}, "ssh-ed25519 AAAA rabbit-control setup-sub")).toContain("setup-sub'");
    expect(() => bootstrapScript({}, "ssh-ed25519 AAAA x'; rm -rf /")).toThrow("tidak sah");
  });

  it("skrip lama menjawab OUTDATED (exit 3) -> dipasang ulang; kegagalan lain bukan", () => {
    expect(scriptOutdated({ code: 3, stdout: "OUTDATED abc\n" })).toBe(true);
    expect(scriptOutdated({ code: 1, stdout: "OUTDATED abc" })).toBe(false);
    expect(scriptOutdated({ code: 3, stdout: "" })).toBe(false);
  });

  it("sidik = sha256 berkas sebagaimana ditulis heredoc (satu \\n di ujung)", () => {
    expect(setupScriptSha("a\n")).toBe(setupScriptSha("a"));
    expect(setupScriptSha()).toMatch(/^[0-9a-f]{64}$/);
  });

  it("login non-root naik lewat sudo -S, password di baris pertama stdin", () => {
    expect(bootstrapCommand("root", "pw", "S")).toEqual({ command: "bash -s", input: "S" });
    const run = bootstrapCommand("rabbitroi", "pw", "S");
    expect(run.command).toBe("sudo -S -p '' bash -s");
    expect(run.input).toBe("pw\nS");
  });

  it("tanpa password -> sebabnya disebut, tanpa satu koneksi pun", async () => {
    let calls = 0;
    await expect(
      bootstrapServer({ ip: "1.2.3.4", user: "root", password: "", sshKey: "/k", exec: async () => calls++ }),
    ).rejects.toThrow("SETUP_SUB_ROOT_PASSWORD");
    expect(calls).toBe(0);
  });
});

describe("login admin WordPress lewat stdin", () => {
  it("dua baris di depan zip; kosong = bawaan skrip", () => {
    expect(String(wpAdminHeader({ user: "admin", password: "p@ss $#" }))).toBe("admin\np@ss $#\n");
    expect(String(wpAdminHeader())).toBe("\n\n");
    expect(String(wpAdminHeader({ password: "tanpa-user" }))).toBe("\n\n");
  });

  it("user aneh atau password berbaris baru ditolak sebelum SSH", () => {
    expect(() => wpAdminHeader({ user: "ad min" })).toThrow("tidak sah");
    expect(() => wpAdminHeader({ user: "admin", password: "a\nb" })).toThrow("baris baru");
  });
});

describe("pluginZipFetcher", () => {
  it("tanpa token = null, tanpa satu panggilan pun", async () => {
    let calls = 0;
    const get = pluginZipFetcher("", async () => calls++);
    expect(await get()).toBeNull();
    expect(calls).toBe(0);
  });

  it("zip diunduh ulang HANYA saat asset rilisnya berganti", async () => {
    let assetId = 1;
    const downloads = [];
    const fake = async (url) => {
      if (url.endsWith("/releases/latest"))
        return Response.json({ assets: [{ id: assetId, name: "rabbitroi.zip", url: `a/${assetId}` }] });
      downloads.push(url);
      return new Response(`zip-${url}`);
    };
    const get = pluginZipFetcher("t", fake);
    expect(String(await get())).toBe("zip-a/1");
    await get();
    assetId = 2;
    expect(String(await get())).toBe("zip-a/2");
    expect(downloads).toEqual(["a/1", "a/2"]);
  });

  it("rilis tanpa rabbitroi.zip melempar, bukan mengirim zip kosong", async () => {
    const get = pluginZipFetcher("t", async () => Response.json({ assets: [] }));
    await expect(get()).rejects.toThrow("tidak memuat rabbitroi.zip");
  });
});

describe("setup-sub: langkah situs sesudah enroll", () => {
  const done = (detail) => ({ state: "done", detail });

  it("urutan Setting Sub -> legal -> AutoPost -> tunggu job -> menu, kunci AI tidak ke RTDB", async () => {
    const store = fakeStore();
    const id = seed(store);
    const calls = [];
    let polls = 0;
    const { app } = build({
      store,
      runDeploy: async (_id, tasks) => {
        calls.push(`deploy:${tasks.join(",")}`);
        return done("ok");
      },
      runLegal: async (_id, key, pages) => {
        calls.push(`legal:${key}:${pages.length}`);
        return done("5 dibuat");
      },
      submitPosts: async (_id, key, keywords) => {
        calls.push(`posts:${key}:${keywords.join("|")}`);
        return {
          results: keywords.map((k, i) => ({ keyword: k, jobId: `j${i}` })),
          summary: { total: keywords.length, ok: keywords.length, failed: 0 },
        };
      },
      listPosts: async () => {
        polls++;
        calls.push("poll");
        const status = polls < 2 ? "running" : "done";
        return { jobs: [{ jobId: "j0", status }, { jobId: "j1", status: "done" }] };
      },
      readDeploy: async () => ({ menus: { ok: true } }),
    });
    const res = await bulk(app, {
      ids: [id],
      deployment: ["trash", "theme"],
      legal: true,
      autopost: { [id]: "a\nb\nA" },
      menus: true,
      legalAiKey: "AIzaSy-0123456789abcdef",
      autopostAiKey: "sk-ant-9876543210fedcba",
    });
    expect(res.status).toBe(200);
    const setup = await finished(store, id);
    expect(setup.state).toBe("done");
    expect(calls).toEqual([
      "deploy:trash,theme",
      "legal:AIzaSy-0123456789abcdef:0",
      "posts:sk-ant-9876543210fedcba:a|b",
      "poll",
      "poll",
      "deploy:menus",
    ]);
    expect(JSON.stringify(store.state)).not.toContain("AIzaSy");
    expect(JSON.stringify(store.state)).not.toContain("sk-ant");
    expect(store.state[`subDomains/${id}/siteTasks/menus`].state).toBe("done");
  });

  it("langkah situs menunggu antrean CloudPanel kosong — site:add me-reload PHP-FPM dan memutus request (502)", async () => {
    const store = fakeStore();
    seed(store, "s1");
    seed(store, "s2");
    store.state["subDomains/s2"] = { name: "kisan.petcins.com", parentDomain: "petcins.com" };
    const calls = [];
    const { app } = build({
      store,
      runRemote: async (host) => {
        if (host === "kisan.petcins.com") await new Promise((resolve) => setTimeout(resolve, 30));
        calls.push(`install-selesai:${host}`);
        return okInstall();
      },
      runLegal: async (id) => {
        calls.push(`legal:${id}`);
        return done("ok");
      },
    });
    await bulk(app, { ids: ["s1", "s2"], legal: true, legalAiKey: "AIzaSy-0123456789abcdef" });
    await finished(store, "s1");
    await finished(store, "s2");
    expect(calls).toEqual([
      "install-selesai:care.petcins.com",
      "install-selesai:kisan.petcins.com",
      "legal:s1",
      "legal:s2",
    ]);
  });

  it("menu yang tidak jadi menurut GET deployment -> partial", async () => {
    const store = fakeStore();
    const id = seed(store);
    const { app } = build({
      store,
      runDeploy: async () => done("ok"),
      readDeploy: async () => ({ menus: { ok: false, info: "Home saja" } }),
    });
    await bulk(app, { ids: [id], menus: true });
    const setup = await finished(store, id);
    expect(setup.state).toBe("partial");
    expect(setup.detail).toContain("Home saja");
  });

  it("generator: kata dasar + jumlah -> kata kunci dibuat AI lalu dikirim", async () => {
    const store = fakeStore();
    const id = seed(store);
    const calls = [];
    const { app } = build({
      store,
      generatePosts: async (_id, key, spec) => {
        calls.push(`gen:${key}:${spec.base}:${spec.total}:${spec.bahasa}`);
        return { keywords: ["kucing sehat", "makanan kucing"] };
      },
      submitPosts: async (_id, _key, keywords, values) => {
        calls.push(`posts:${keywords.join("|")}:${values.kategori}`);
        return {
          results: keywords.map((k) => ({ keyword: k, jobId: "" })),
          summary: { total: keywords.length, ok: keywords.length, failed: 0 },
        };
      },
    });
    const res = await bulk(app, {
      ids: [id],
      autopost: { [id]: { base: "kucing", total: 3, bahasa: "Indonesian" } },
      autopostAiKey: "sk-ant-9876543210fedcba",
      autopostValues: { kategori: "Kucing" },
    });
    expect(res.status).toBe(200);
    const setup = await finished(store, id);
    expect(setup.state).toBe("done");
    expect(calls).toEqual([
      "gen:sk-ant-9876543210fedcba:kucing:3:Indonesian",
      "posts:kucing sehat|makanan kucing:Kucing",
    ]);
    expect(setup.detail).toContain("2 dari 3 dibuat");
  });

  it("kata kunci yang ditolak situs DISEBUT berikut sebabnya, bukan cuma hitungannya", async () => {
    const store = fakeStore();
    const id = seed(store);
    const { app } = build({
      store,
      submitPosts: async () => ({
        results: [
          { keyword: "a", jobId: "j0", status: "ok", error: "" },
          { keyword: "b", jobId: "", status: "failed", error: "Situs menjawab HTTP 503 tanpa JSON." },
        ],
        summary: { total: 2, ok: 1, failed: 1 },
      }),
    });
    await bulk(app, {
      ids: [id],
      autopost: { [id]: "a\nb" },
      autopostAiKey: "sk-ant-9876543210fedcba",
    });
    const setup = await finished(store, id);
    expect(setup.state).toBe("partial");
    expect(setup.detail).toContain('Ditolak: "b" (Situs menjawab HTTP 503 tanpa JSON.)');
  });

  it("lebih dari 15 artikel terkirim = selesai, walau ada kata kunci yang ditolak", async () => {
    const store = fakeStore();
    const id = seed(store);
    const submitWith = (ok) => async () => ({
      results: [
        ...Array.from({ length: ok }, (_, i) => ({ keyword: `k${i}`, jobId: `j${i}`, status: "ok", error: "" })),
        { keyword: "x", jobId: "", status: "failed", error: "HTTP 503" },
      ],
      summary: { total: ok + 1, ok, failed: 1 },
    });
    const body = { ids: [id], autopost: { [id]: "a" }, autopostAiKey: "sk-ant-9876543210fedcba" };

    await bulk(build({ store, submitPosts: submitWith(16) }).app, body);
    let setup = await finished(store, id);
    expect(setup.state).toBe("done");
    expect(setup.detail).toContain('Ditolak: "x" (HTTP 503)');

    await bulk(build({ store, submitPosts: submitWith(15) }).app, body);
    setup = await finished(store, id);
    expect(setup.state).toBe("partial");
  });

  it("setelan artikel yang tidak sah ditolak 422 sebelum diantre", async () => {
    const store = fakeStore();
    const id = seed(store);
    const { app } = build({ store });
    const res = await bulk(app, {
      ids: [id],
      autopost: { [id]: "kata" },
      autopostAiKey: "sk-ant-9876543210fedcba",
      autopostValues: { status_artikel: "terbang" },
    });
    expect(res.status).toBe(422);
    expect(store.state[`subDomains/${id}/setup`]).toBeUndefined();
  });

  it("kode iklan + landing: kode iklan gagal tidak menghentikan landing, landing sesudah menu", async () => {
    const store = fakeStore();
    const id = seed(store);
    const calls = [];
    const { app } = build({
      store,
      adNetworkOf: async () => "adx",
      injectAdCode: async (_id, options) => {
        calls.push(`adcode:${options.slots}`);
        throw new Error("Unit iklan tidak ditemukan di Ad Manager");
      },
      runDeploy: async (_id, tasks) => {
        calls.push(`deploy:${tasks.join(",")}`);
        return { state: "done", detail: "ok" };
      },
      readDeploy: async () => ({ menus: { ok: true } }),
      createLanding: async () => {
        calls.push("landing");
        return { link: "https://care.petcins.com/lp?k=v" };
      },
    });
    await bulk(app, {
      ids: [id],
      adCode: { sizes: "300x250,336x280", slots: 3 },
      menus: true,
      landing: true,
    });
    const setup = await finished(store, id);
    expect(calls).toEqual(["adcode:3", "deploy:menus", "landing"]);
    expect(setup.state).toBe("partial");
    expect(setup.detail).toContain("Unit iklan tidak ditemukan");
    expect(setup.landingLink).toBe("https://care.petcins.com/lp?k=v");
  });

  it("domain tanpa akun GAM -> kode AdSense sub itu yang dipasang; tanpa kode -> dilewati", async () => {
    const store = fakeStore();
    const a = seed(store, "a");
    const b = seed(store, "b");
    const calls = [];
    const { app } = build({
      store,
      adNetworkOf: async () => "adsense",
      injectAdCode: async () => {
        calls.push("adx");
        return { unapplied: [], detail: {} };
      },
      injectAdsense: async (id, codes) => {
        calls.push(`adsense:${id}:${codes.length}`);
        return { unapplied: [], detail: { slots: codes, verified: true } };
      },
      saveAdsenseCodes: async (id, codes) => {
        calls.push(`save:${id}:${codes.length}`);
      },
    });
    await bulk(app, {
      ids: [a, b],
      adCode: { sizes: "300x250", slots: 3 },
      adsenseCodes: { [a]: ["<ins a1>", "<ins a2>"] },
    });
    const setupA = await finished(store, a);
    const setupB = await finished(store, b);
    expect(calls).toEqual(["adsense:a:2", "save:a:2"]);
    expect(setupA.state).toBe("done");
    expect(setupA.detail).toContain("AdSense: 2 slot");
    expect(setupB.state).toBe("partial");
    expect(setupB.detail).toContain("kode AdSense-nya tidak diisi");
  });

  it("landing SENDIRIAN tetap dijalankan", async () => {
    const store = fakeStore();
    const id = seed(store);
    const { app } = build({ store, createLanding: async () => ({ link: "https://x/lp?a=b" }) });
    await bulk(app, { ids: [id], landing: true });
    const setup = await finished(store, id);
    expect(setup.landingLink).toBe("https://x/lp?a=b");
  });

  it("keitaro jalan sesudah landing dengan tautannya; gate gagal = partial; tanpa landing diabaikan", async () => {
    const store = fakeStore();
    const a = seed(store, "a");
    const b = seed(store, "b");
    const calls = [];
    const { app } = build({
      store,
      createLanding: async (id) => ({ link: `https://care.petcins.com/lp-${id}?k=v` }),
      createKeitaro: async (id, { url }) => {
        calls.push(`${id}:${url}`);
        return {
          campaign: { id: 9, name: "ACA T2 (WL) 1mRH (care.petcins.com)" },
          gate: { status: "problem", error: "verifikasi gagal" },
        };
      },
    });
    await bulk(app, { ids: [a], landing: true, keitaro: true });
    const setup = await finished(store, a);
    expect(calls).toEqual(["a:https://care.petcins.com/lp-a?k=v"]);
    expect(setup.state).toBe("partial");
    expect(setup.detail).toContain("ACA T2 (WL) 1mRH (care.petcins.com) (#9), gate problem");

    await bulk(app, { ids: [b], keitaro: true, menus: true });
    await finished(store, b);
    expect(calls).toHaveLength(1);
  });

  it("keitaro yang gagal di tengah menyebut yang sudah lahir", async () => {
    const store = fakeStore();
    const id = seed(store);
    const failure = Object.assign(new Error("Keitaro PUT /streams/3 -> 500"), {
      created: { campaign: { id: 9, name: "ACA T2 (WL) 1mRH (care.petcins.com)" } },
    });
    const { app } = build({
      store,
      createLanding: async () => ({ link: "https://care.petcins.com/lp?k=v" }),
      createKeitaro: async () => {
        throw failure;
      },
    });
    await bulk(app, { ids: [id], landing: true, keitaro: true });
    const setup = await finished(store, id);
    expect(setup.state).toBe("partial");
    expect(setup.detail).toContain("Keitaro gagal: Keitaro PUT /streams/3 -> 500");
    expect(setup.detail).toContain("Sudah lahir: ACA T2 (WL) 1mRH (care.petcins.com) (#9)");
  });

  it("kode iklan dengan ukuran tidak sah ditolak 422 sebelum diantre", async () => {
    const store = fakeStore();
    const id = seed(store);
    const { app } = build({ store });
    const bad = await bulk(app, { ids: [id], adCode: { sizes: "bukan-ukuran", slots: 2 } });
    expect(bad.status).toBe(422);
    expect(store.state[`subDomains/${id}/setup`]).toBeUndefined();
  });

  it("kunci legal saja tidak membuka AutoPost -> 422", async () => {
    const store = fakeStore();
    const id = seed(store);
    const { app } = build({ store });
    const res = await bulk(app, {
      ids: [id],
      legal: true,
      legalAiKey: "AIzaSy-0123456789abcdef",
      autopost: { [id]: "kata" },
    });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain("AutoPost");
  });

  it("legal/AutoPost tanpa kunci AI ditolak 422 sebelum diantre", async () => {
    const store = fakeStore();
    const id = seed(store);
    const { app } = build({ store });
    const res = await bulk(app, { ids: [id], autopost: { [id]: "kata" } });
    expect(res.status).toBe(422);
    expect(store.state[`subDomains/${id}/setup`]).toBeUndefined();
  });
});
