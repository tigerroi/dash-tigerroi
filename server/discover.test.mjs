import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { AuthError } from "./auth.js";
import { DISCOVER_KINDS, DISCOVER_RUNS_PATH, discoverRoutes } from "./discover.js";

// Store RTDB tiruan — bentuk yang sama dengan clientStore/adminStore di functions/store.mjs.
function fakeStore() {
  const state = {};
  return {
    state,
    read: async (path) => state[path] ?? null,
    replace: async (path, value) => {
      state[path] = value;
    },
    update: async () => {},
  };
}

// Hasil impor tidak lagi ada di badan jawaban HTTP: server menjawab 202 lalu menulis hasilnya ke
// RTDB. Yang ditunggu test karena itu bukan `await post(...)` melainkan barisnya.
async function runFinished(store, kind, tries = 50) {
  const path = `${DISCOVER_RUNS_PATH}/${kind}`;
  for (let i = 0; i < tries; i++) {
    const run = store.state[path];
    if (run && run.state !== "running") return run;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`impor ${kind} tidak pernah selesai`);
}

// Runner tiruan: yang diuji di sini gerbang, pemetaan jenis, dan penjaga tumpang-tindih — bukan
// impornya sendiri, yang punya testnya di functions/ dan butuh API Google untuk berarti.
function fakeRunners(impl) {
  return Object.fromEntries(DISCOVER_KINDS.map((kind) => [kind, (db, actor) => impl(kind, actor)]));
}

const ADMIN = async () => ({ uid: "u1", email: "admin@rabbitracing.live", role: "admin" });

function build({ authorize = ADMIN, runners, store = fakeStore() } = {}) {
  return { app: new Elysia().use(discoverRoutes({ db: {}, store, authorize, runners })), store };
}

const url = (path) => `http://localhost${path}`;
const post = (app, path) =>
  app.handle(
    new Request(url(path), { method: "POST", headers: { authorization: "Bearer t" } }),
  );

describe("gerbang izin", () => {
  it("bukan admin: 403, dan tidak ada impor yang jalan", async () => {
    let ran = 0;
    const { app, store } = build({
      authorize: async () => {
        throw new AuthError("Hanya admin.", 403);
      },
      runners: fakeRunners(() => {
        ran++;
        return {};
      }),
    });
    const res = await post(app, "/discover/domains");
    expect(res.status).toBe(403);
    expect(ran).toBe(0);
    // Baris "running" pun tidak ditulis: sebuah impor yang ditolak tidak boleh terlihat berjalan.
    expect(store.state[`${DISCOVER_RUNS_PATH}/domains`]).toBeUndefined();
  });

  it("izin tidak bisa diperiksa (RTDB mati): 503, bukan 401", async () => {
    // 401 akan menyuruh browser login ulang untuk masalah yang tidak ada hubungannya dengan token.
    const { app } = build({
      authorize: async () => {
        throw new Error("RTDB tak terjangkau");
      },
      runners: fakeRunners(() => ({})),
    });
    expect((await post(app, "/discover/domains")).status).toBe(503);
  });
});

describe("pemetaan jenis", () => {
  it("keempat kunci resource dashboard dikenali, dan menjalankan impornya masing-masing", async () => {
    const seen = [];
    const { app, store } = build({ runners: fakeRunners((kind) => ({ created: 1, kind: `run:${kind}` })) });
    for (const kind of ["gamAccounts", "adsenseAccounts", "domains", "subDomains"]) {
      const res = await post(app, `/discover/${kind}`);
      expect(res.status).toBe(202);
      expect((await res.json()).state).toBe("running");
      seen.push((await runFinished(store, kind)).kind);
    }
    // `kind` di baris hasil datang dari route, bukan dari runner: halaman memakainya untuk
    // memastikan yang selesai memang impor yang tombolnya ditekan.
    expect(seen).toEqual(["gamAccounts", "adsenseAccounts", "domains", "subDomains"]);
  });

  it("kunci yang tidak dikenal ditolak 422, tanpa menyentuh Google", async () => {
    let ran = 0;
    const { app } = build({
      runners: fakeRunners(() => {
        ran++;
        return {};
      }),
    });
    // Salah huruf besar-kecil termasuk: "subdomains" bukan "subDomains".
    expect((await post(app, "/discover/subdomains")).status).toBe(422);
    expect((await post(app, "/discover/users")).status).toBe(422);
    expect(ran).toBe(0);
  });
});

describe("hasil dan kegagalan", () => {
  it("202 datang SEBELUM impornya selesai — itulah gunanya", async () => {
    // Cloudflare memutus request yang belum menjawab dalam 100 detik, dan impor domain memakan
    // ~53 detik. Jawaban yang menunggu hasil adalah jawaban yang kadang tidak pernah sampai.
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const { app, store } = build({ runners: fakeRunners(async () => (await gate) && { created: 3 }) });

    const res = await post(app, "/discover/domains");
    expect(res.status).toBe(202);
    expect(store.state[`${DISCOVER_RUNS_PATH}/domains`].state).toBe("running");

    release(true);
    const run = await runFinished(store, "domains");
    expect(run.state).toBe("done");
    expect(run.created).toBe(3);
    // `startedAt` sama dengan yang dijawab HTTP: halaman memakainya untuk membedakan hasil klik
    // barusan dari hasil impor kemarin yang masih tersimpan di node yang sama.
    expect(run.startedAt).toBe((await res.json()).startedAt);
  });

  it("email penekan tombol yang jadi actor, bukan 'import'", async () => {
    let actor = "";
    const { app, store } = build({
      runners: fakeRunners((_kind, who) => {
        actor = who;
        return { created: 0 };
      }),
    });
    await post(app, "/discover/domains");
    await runFinished(store, "domains");
    expect(actor).toBe("admin@rabbitracing.live");
  });

  it("prasyarat yang belum terpenuhi ditandai, supaya halaman tidak menyuruh mencoba lagi", async () => {
    const { app, store } = build({
      runners: fakeRunners(() => {
        const error = new Error("Belum ada Google credential yang terhubung.");
        error.precondition = true;
        throw error;
      }),
    });
    await post(app, "/discover/domains");
    const run = await runFinished(store, "domains");
    expect(run.state).toBe("failed");
    expect(run.precondition).toBe(true);
    expect(run.error).toContain("credential");
  });

  it("laporan Google yang gagal: baris failed berikut sebabnya", async () => {
    const { app, store } = build({
      runners: fakeRunners(() => {
        throw new Error("GAM 403: report job ditolak");
      }),
    });
    await post(app, "/discover/domains");
    const run = await runFinished(store, "domains");
    expect(run.state).toBe("failed");
    expect(run.precondition).toBe(false);
    expect(run.error).toContain("report job ditolak");
  });

  it("field kosong tidak menggagalkan penulisan hasilnya", async () => {
    // RTDB menolak `undefined` di mana pun di dalam objek, dan satu field yang tidak terisi akan
    // menggagalkan penulisan SELURUH hasil — impor yang berhasil lalu tidak mengabarkan apa pun.
    const { app, store } = build({
      runners: fakeRunners(() => ({ created: 1, summary: undefined, skipped: [] })),
    });
    await post(app, "/discover/domains");
    const run = await runFinished(store, "domains");
    expect(run.state).toBe("done");
    expect("summary" in run).toBe(false);
  });
});

describe("penjaga tumpang-tindih", () => {
  it("impor kedua ditolak 409 selama yang pertama jalan, lalu boleh lagi sesudahnya", async () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const { app, store } = build({ runners: fakeRunners(async () => (await gate) && { created: 0 }) });

    await post(app, "/discover/domains");
    // Dua klik pada tombol yang sama membuat dua baris untuk domain yang sama: keduanya membaca
    // daftar "yang sudah ada" sebelum yang lain menulis.
    const second = await post(app, "/discover/subDomains");
    expect(second.status).toBe(409);
    expect((await second.json()).error).toContain("domains");

    release(true);
    await runFinished(store, "domains");
    // Kuncinya dilepas di `finally`, jadi impor berikutnya tidak ikut tertahan selamanya.
    expect((await post(app, "/discover/subDomains")).status).toBe(202);
  });

  it("kunci dilepas juga saat impornya gagal", async () => {
    let calls = 0;
    const { app, store } = build({
      runners: fakeRunners(() => {
        calls++;
        throw new Error("gagal");
      }),
    });
    await post(app, "/discover/domains");
    await runFinished(store, "domains");
    await post(app, "/discover/domains");
    await runFinished(store, "domains");
    expect(calls).toBe(2);
  });
});
