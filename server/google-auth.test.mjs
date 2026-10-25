import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { googleAuthRoutes } from "./google-auth.js";

// HARUS "localhost": pengurai URL cepat Elysia gagal mengambil path dari host satu label dan
// menjawab 404 untuk route yang sebenarnya terdaftar.
const URL_BASE = "http://localhost";
const PUBLIC_URL = "https://dashboard-api.adsgo.live";
const APP_URL = "https://rabbitroi-89973.web.app";
const GAM = "https://www.googleapis.com/auth/admanager";
const ADSENSE = "https://www.googleapis.com/auth/adsense.readonly";

function fakeStore(data = {}) {
  const state = structuredClone(data);
  const at = (path) => path.split("/").reduce((node, key) => node?.[key], state);
  const put = (path, value) => {
    const parts = path.split("/");
    const last = parts.pop();
    let node = state;
    for (const part of parts) node = node[part] ??= {};
    if (value === null || value === undefined) delete node[last];
    else node[last] = value;
  };
  return {
    state,
    read: async (path) => at(path) ?? null,
    update: async (path, values) => {
      for (const [key, value] of Object.entries(values)) put(`${path}/${key}`, value);
    },
    replace: async (path, value) => put(path, value),
  };
}

const CONFIGS = {
  k1: { name: "petcins.com", clientId: "id-1", clientSecret: "rahasia-1" },
  k2: { name: "belum lengkap" },
};

function build({
  store = fakeStore({ googleApiConfigs: structuredClone(CONFIGS) }),
  publicUrl = PUBLIC_URL,
  // Suntikan sepola dengan gating/campaigns/plugin: verifikasi ID token sungguhan mengambil kunci
  // publik Google lalu membaca /roles — dua hal yang tidak boleh dibutuhkan sebuah unit test.
  authorize = async () => ({ uid: "u1", email: "dev@rabbitracing.live", role: "admin" }),
  exchange = async () => ({ refresh_token: "token-baru", scope: `${GAM} ${ADSENSE}` }),
} = {}) {
  const app = new Elysia().use(
    googleAuthRoutes({ db: {}, store, publicUrl, appUrl: APP_URL, authorize, exchange }),
  );
  return { app, store };
}

const post = (app, path) =>
  app.handle(new Request(`${URL_BASE}${path}`, { method: "POST", headers: { authorization: "Bearer t" } }));
const get = (app, path) => app.handle(new Request(`${URL_BASE}${path}`));

// Jalankan consent sampai punya state yang sah, lalu kembalikan state-nya — dipakai hampir tiap tes
// callback di bawah, karena state yang tidak lahir dari langkah pertama memang harus ditolak.
async function consentState(app, configId = "k1") {
  const res = await post(app, `/google/configs/${configId}/consent`);
  const { url } = await res.json();
  return new URL(url).searchParams.get("state");
}

describe("langkah 1 — URL consent", () => {
  it("meminta kedua scope, memaksa refresh token, dan menawarkan pemilihan akun", async () => {
    const { app } = build();
    const { url } = await (await post(app, "/google/configs/k1/consent")).json();
    const params = new URL(url).searchParams;

    expect(params.get("scope")).toContain(GAM);
    expect(params.get("scope")).toContain(ADSENSE);
    expect(params.get("access_type")).toBe("offline");
    // Tanpa `select_account`, browser yang sudah login satu akun Google memakainya diam-diam dan
    // kredensial untuk network baru tersimpan atas nama akun lama.
    expect(params.get("prompt")).toBe("select_account consent");
    expect(params.get("redirect_uri")).toBe(`${PUBLIC_URL}/google/callback`);
  });

  it("menyimpan state sekali pakai di record kredensialnya, bukan di memori proses", async () => {
    const { app, store } = build();
    const state = await consentState(app);
    expect(store.state.googleApiConfigs.k1.authState.secret).toBe(state.split(".")[1]);
  });

  it("503 berikut sebabnya kalau alamat publik server belum di-set", async () => {
    const { app } = build({ publicUrl: "" });
    const res = await post(app, "/google/configs/k1/consent");
    expect(res.status).toBe(503);
    expect((await res.json()).error).toContain("CONTROL_PUBLIC_URL");
  });

  it("404 untuk kredensial yang tidak ada, 422 untuk yang client secret-nya kosong", async () => {
    const { app } = build();
    expect((await post(app, "/google/configs/tidakada/consent")).status).toBe(404);
    expect((await post(app, "/google/configs/k2/consent")).status).toBe(422);
  });

  it("bukan admin ditolak, dan tidak ada state yang tertulis", async () => {
    const { app, store } = build({
      authorize: async () => {
        const error = new Error("Hanya admin yang boleh menghubungkan kredensial Google.");
        error.status = 403;
        // Bentuk yang sama dengan AuthError; yang diperiksa di sini adalah tidak ada tulisan yang
        // lolos ke record, bukan kode HTTP-nya (itu tugas auth.js).
        throw Object.assign(error, { name: "AuthError" });
      },
    });
    await post(app, "/google/configs/k1/consent");
    expect(store.state.googleApiConfigs.k1.authState).toBeUndefined();
  });
});

describe("langkah 2 — callback", () => {
  it("consent penuh: token tersimpan, statusnya Connected, izinnya tercatat", async () => {
    const { app, store } = build();
    const state = await consentState(app);

    const res = await get(app, `/google/callback?code=c&state=${encodeURIComponent(state)}`);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("googleAuth=ok");

    const saved = store.state.googleApiConfigs.k1;
    expect(saved.refreshToken).toBe("token-baru");
    expect(saved.status).toBe("Connected");
    expect(saved.scopeSummary).toBe("Ad Manager + AdSense");
  });

  /**
   * Kegagalan yang melahirkan fitur ini. Google menjawab consent yang scope-nya kurang seperti
   * consent yang berhasil; ditulis polos, yang muncul di layar adalah "Connected" untuk kredensial
   * yang tetap tidak bisa membaca AdSense.
   */
  it("scope kurang tidak pernah berbunyi 'ok'", async () => {
    const { app, store } = build({
      exchange: async () => ({ refresh_token: "token-baru", scope: GAM }),
    });
    const state = await consentState(app);

    const res = await get(app, `/google/callback?code=c&state=${encodeURIComponent(state)}`);
    expect(res.headers.get("location")).toContain("googleAuth=partial");
    expect(store.state.googleApiConfigs.k1.status).not.toBe("Connected");
    expect(store.state.googleApiConfigs.k1.authMessage).toContain("AdSense");
  });

  it("tanpa refresh token, record tidak disentuh sama sekali", async () => {
    const { app, store } = build({ exchange: async () => ({ scope: `${GAM} ${ADSENSE}` }) });
    const state = await consentState(app);

    const res = await get(app, `/google/callback?code=c&state=${encodeURIComponent(state)}`);
    expect(res.headers.get("location")).toContain("googleAuth=failed");
    expect(store.state.googleApiConfigs.k1.refreshToken).toBeUndefined();
    expect(store.state.googleApiConfigs.k1.status).toBeUndefined();
  });

  it("state hanya berlaku sekali", async () => {
    const { app } = build();
    const state = await consentState(app);
    await get(app, `/google/callback?code=c&state=${encodeURIComponent(state)}`);

    const kedua = await get(app, `/google/callback?code=c&state=${encodeURIComponent(state)}`);
    expect(kedua.headers.get("location")).toContain("googleAuth=failed");
  });

  it("state karangan tidak bisa memasang kredensial Google siapa pun ke record", async () => {
    const { app, store } = build();
    const res = await get(app, "/google/callback?code=c&state=k1.tebakan");
    expect(res.headers.get("location")).toContain("googleAuth=failed");
    expect(store.state.googleApiConfigs.k1.refreshToken).toBeUndefined();
  });

  it("state dibuang sebelum code ditukar, jadi penukaran yang gagal tidak menyisakan tautan hidup", async () => {
    const { app, store } = build({
      exchange: async () => {
        throw new Error("invalid_grant");
      },
    });
    const state = await consentState(app);

    const res = await get(app, `/google/callback?code=c&state=${encodeURIComponent(state)}`);
    expect(res.headers.get("location")).toContain("googleAuth=failed");
    expect(store.state.googleApiConfigs.k1.authState).toBeUndefined();
  });

  it("orang yang membatalkan di layar Google bukan kegagalan sistem", async () => {
    const { app } = build();
    const res = await get(app, "/google/callback?error=access_denied&state=k1.apa");
    expect(res.headers.get("location")).toContain("googleAuth=denied");
  });

  it("selalu kembali ke halaman kredensial di origin dashboard, tidak pernah ke alamat dari request", async () => {
    const { app } = build();
    const state = await consentState(app);
    const res = await get(app, `/google/callback?code=c&state=${encodeURIComponent(state)}`);
    expect(res.headers.get("location")).toStartWith(`${APP_URL}/google-api-configs?`);
  });
});
