import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { pluginRoutes } from "./plugin.js";

// HARUS "localhost": pengurai URL cepat Elysia gagal mengambil path dari host satu label dan
// menjawab 404 untuk route yang sebenarnya terdaftar.
const URL_BASE = "http://localhost";

/**
 * Store RTDB tiruan dengan `replace` yang benar-benar mengganti node.
 *
 * Berbeda dari milik campaigns.test.mjs (yang `replace`-nya no-op karena route di sana tidak
 * memakainya): seluruh cermin status plugin ditulis lewat `replace`, jadi no-op akan membuat setiap
 * pemeriksaan di bawah lulus tanpa ada yang benar-benar tersimpan.
 */
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

const SUBDOMAINS = {
  s_satu: { name: "satu.rabbit.live", pic: "Aldi", status: "Active" },
  s_dua: { name: "dua.rabbit.live", pic: "Nur", status: "Active" },
  s_tanpa_nama: { pic: "Nur" },
};

function build({
  store = fakeStore({ subDomains: structuredClone(SUBDOMAINS) }),
  enrollToken = "ENROLL",
} = {}) {
  const app = new Elysia().use(
    pluginRoutes({
      db: {},
      store,
      enrollToken,
      // Suntikan yang sama polanya dengan gating & campaigns: verifikasi ID token sungguhan
      // mengambil kunci publik Google lalu membaca /roles — dua hal yang tidak boleh dibutuhkan
      // sebuah unit test.
      authorize: async () => ({ uid: "u1", email: "dev@rabbitracing.live", role: "superadmin" }),
    }),
  );
  return { app, store };
}

const call = (app, path, body) =>
  app.handle(
    new Request(`${URL_BASE}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { authorization: "Bearer t", "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );

// --- Jaringan tiruan ------------------------------------------------------------------------------

let realFetch;
let calls;
let respond;

beforeEach(() => {
  realFetch = globalThis.fetch;
  calls = [];
  respond = () => ({ success: true, data: {} });
  globalThis.fetch = async (url, init = {}) => {
    calls.push({
      url: String(url),
      method: init.method || "GET",
      headers: init.headers || {},
      // Token OAuth dikirim form-urlencoded, bukan JSON — dicatat apa adanya.
      body: init.body ? (String(init.body).startsWith("{") ? JSON.parse(init.body) : String(init.body)) : null,
    });
    const result = await respond(String(url), init);
    return new Response(JSON.stringify(result.body ?? result), { status: result.status ?? 200 });
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

// --- Alamat situs ------------------------------------------------------------------------------------

describe("hostname datang dari subDomains, bukan dari request", () => {
  /**
   * Gerbang yang paling penting di file ini.
   *
   * Enroll token dibagi ke SELURUH armada plugin. Kalau host bisa dititipkan lewat request, satu
   * panggilan sudah cukup untuk menyerahkan kunci yang membuka setiap situs kita kepada siapa pun
   * yang memegang host itu — dan yang memanggil hanya perlu lolos gerbang superadmin sekali.
   */
  it("enroll menembak host dari baris subdomain", async () => {
    respond = () => ({
      success: true,
      data: { site_id: "satu.rabbit.live", api_key: "K1", version: "0.4.7" },
    });
    const { app } = build();

    const res = await call(app, "/plugin/sites/s_satu/enroll", {});
    expect(res.status).toBe(200);
    expect(calls[0].url).toBe("https://satu.rabbit.live/wp-json/rabbitroi/v1/manage/enroll");
    expect(calls[0].headers["X-RabbitROI-Enroll"]).toBe("ENROLL");
  });

  it("id yang tidak ada di subDomains tidak menghasilkan request sama sekali", async () => {
    const { app } = build();
    const res = await call(app, "/plugin/sites/s_hantu/enroll", {});
    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain("tidak ada di dashboard");
    expect(calls).toHaveLength(0);
  });

  it("baris subdomain tanpa nama host ditolak sebelum menyentuh jaringan", async () => {
    const { app } = build();
    const res = await call(app, "/plugin/sites/s_tanpa_nama/enroll", {});
    expect(res.status).toBe(422);
    expect(calls).toHaveLength(0);
  });

  // Nilai `:id` disambung jadi path RTDB (`subDomains/${id}`). Tanpa pola push-key, "/" di dalamnya
  // akan membaca node yang sama sekali lain.
  it("id berbentuk path ditolak validator", async () => {
    const { app } = build();
    const res = await call(app, "/plugin/sites/a%2Fb/enroll", {});
    expect(res.status).toBe(422);
    expect(calls).toHaveLength(0);
  });
});

// --- Enroll ---------------------------------------------------------------------------------------

describe("enroll", () => {
  it("menyimpan kunci di pluginKeys dan status di pluginSites — kunci TIDAK ikut ke cermin", async () => {
    respond = () => ({
      success: true,
      data: { site_id: "satu.rabbit.live", api_key: "K1", version: "0.4.7" },
    });
    const { app, store } = build();

    await call(app, "/plugin/sites/s_satu/enroll", {});

    expect(store.state.pluginKeys.s_satu.apiKey).toBe("K1");
    expect(store.state.pluginSites.s_satu.enrolled).toBe(true);
    expect(store.state.pluginSites.s_satu.version).toBe("0.4.7");
    // Halaman melanggan `pluginSites`. Kunci yang bocor ke sini akan terunduh ke browser tiap
    // superadmin yang membukanya, hanya untuk melihat kolom "Versi".
    expect(JSON.stringify(store.state.pluginSites)).not.toContain("K1");
  });

  /**
   * `already_enrolled` diteruskan berikut KODENYA, dan tetap 502.
   *
   * Kodenya yang dibaca halaman untuk menawarkan Reset alih-alih mengulang tombol yang sama. Dan
   * 409 asli tidak boleh keluar apa adanya — kode HTTP situs orang lain yang bocor lewat server ini
   * akan dibaca `controlApi` sebagai jawaban tentang kita sendiri.
   */
  it("already_enrolled sampai ke pemanggil berikut kodenya", async () => {
    respond = () => ({
      status: 409,
      body: { success: false, error: { code: "already_enrolled", message: "Situs sudah enroll." } },
    });
    const { app, store } = build();

    const res = await call(app, "/plugin/sites/s_satu/enroll", {});
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.code).toBe("already_enrolled");
    expect(body.error).toContain("Reset dulu");
    // Kegagalannya tercatat di cermin, jadi halaman bisa menyebutkannya tanpa menekan tombol lagi.
    expect(store.state.pluginSites.s_satu.errorCode).toBe("already_enrolled");
    expect(store.state.pluginKeys?.s_satu).toBeUndefined();
  });

  /**
   * Kunci yang gagal disimpan MEMBATALKAN enrollment di situsnya.
   *
   * Situs sudah enrolled saat tulisan RTDB gagal (aturan `pluginKeys` belum di-deploy, SYNC_USER
   * kehilangan role). Dibiarkan, yang tertinggal adalah situs enrolled yang kuncinya hilang
   * selamanya — enroll ulang dijawab `already_enrolled` dan reset butuh kunci yang tidak pernah
   * tersimpan. Kuncinya masih di memori di titik itu, jadi masih bisa dipakai membatalkan.
   */
  it("kunci yang gagal disimpan membatalkan enrollment, bukan meninggalkan situs terkunci", async () => {
    respond = () => ({
      success: true,
      data: { site_id: "satu.rabbit.live", api_key: "K1", version: "0.4.7" },
    });
    const store = fakeStore({ subDomains: structuredClone(SUBDOMAINS) });
    const realReplace = store.replace;
    store.replace = async (path, value) => {
      if (path.startsWith("pluginKeys/")) throw new Error("PERMISSION_DENIED");
      return realReplace(path, value);
    };
    const { app } = build({ store });

    const res = await call(app, "/plugin/sites/s_satu/enroll", {});
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.code).toBe("key_store_failed");
    expect(body.error).toContain("aman dicoba lagi");

    // Yang kedua HARUS reset, memakai kunci yang baru saja diterima — itu yang mengembalikan situs
    // ke keadaan bisa di-enroll lagi.
    expect(calls).toHaveLength(2);
    expect(calls[1].url).toContain("/reset");
    expect(calls[1].headers["X-RabbitROI-Key"]).toBe("K1");
  });

  // Pembatalan yang ikut gagal adalah keadaan yang benar-benar buntu, dan kalimatnya harus
  // mengatakan begitu — bukan terdengar seperti kegagalan menulis yang bisa dicoba lagi.
  it("pembatalan yang gagal dilaporkan sebagai terkunci, bukan sebagai gagal biasa", async () => {
    let first = true;
    respond = () => {
      if (first) {
        first = false;
        return { success: true, data: { site_id: "s", api_key: "K1", version: "0.4.7" } };
      }
      return { status: 500, body: { success: false, error: { code: "", message: "reset mati" } } };
    };
    const store = fakeStore({ subDomains: structuredClone(SUBDOMAINS) });
    const realReplace = store.replace;
    store.replace = async (path, value) => {
      if (path.startsWith("pluginKeys/")) throw new Error("PERMISSION_DENIED");
      return realReplace(path, value);
    };
    const { app } = build({ store });

    const body = await (await call(app, "/plugin/sites/s_satu/enroll", {})).json();
    expect(body.code).toBe("orphaned");
    expect(body.error).toContain("dari WordPress-nya sendiri");
  });

  it("tanpa PLUGIN_ENROLL_TOKEN, enroll ditolak tanpa menyentuh jaringan", async () => {
    const { app } = build({ enrollToken: "" });
    const res = await call(app, "/plugin/sites/s_satu/enroll", {});
    expect(res.status).toBe(422);
    expect(calls).toHaveLength(0);
  });
});

// --- Reset -----------------------------------------------------------------------------------------

describe("reset", () => {
  const enrolled = () =>
    fakeStore({
      subDomains: structuredClone(SUBDOMAINS),
      pluginKeys: { s_satu: { apiKey: "K1" } },
      pluginSites: { s_satu: { subdomainId: "s_satu", name: "satu.rabbit.live", enrolled: true } },
    });

  it("membuang kunci hanya setelah situs menjawab berhasil", async () => {
    respond = () => ({ success: true, data: { message: "Enrollment direset." } });
    const { app, store } = build({ store: enrolled() });

    await call(app, "/plugin/sites/s_satu/reset", {});
    expect(store.state.pluginKeys?.s_satu).toBeUndefined();
    expect(store.state.pluginSites.s_satu.enrolled).toBe(false);
  });

  /**
   * Reset yang gagal MEMPERTAHANKAN kunci.
   *
   * Dibuang lebih dulu, situs tetap enrolled di sisi sana sementara kunci satu-satunya sudah hilang
   * dari sisi kita — dan situs itu tidak akan pernah bisa dikelola dari dashboard lagi, karena
   * enroll ulang dijawab `already_enrolled` dan reset butuh kunci yang sudah dibuang.
   */
  it("reset yang gagal tidak membuang kunci", async () => {
    respond = () => ({
      status: 500,
      body: { success: false, error: { code: "", message: "boom" } },
    });
    const { app, store } = build({ store: enrolled() });

    const res = await call(app, "/plugin/sites/s_satu/reset", {});
    expect(res.status).toBe(502);
    expect(store.state.pluginKeys.s_satu.apiKey).toBe("K1");
    expect(store.state.pluginSites.s_satu.enrolled).toBe(true);
  });

  it("situs yang belum punya kunci tidak bisa direset, dan bilang begitu", async () => {
    const { app } = build();
    const res = await call(app, "/plugin/sites/s_satu/reset", {});
    expect((await res.json()).code).toBe("no_key");
    expect(calls).toHaveLength(0);
  });
});

// --- Pengaturan ----------------------------------------------------------------------------------------

const ENROLLED_TWO = () =>
  fakeStore({
    subDomains: structuredClone(SUBDOMAINS),
    pluginKeys: { s_satu: { apiKey: "K1" }, s_dua: { apiKey: "K2" } },
    pluginSites: {
      s_satu: { subdomainId: "s_satu", name: "satu.rabbit.live", enrolled: true },
      s_dua: { subdomainId: "s_dua", name: "dua.rabbit.live", enrolled: true },
    },
  });

describe("pengaturan", () => {
  it("hanya field yang dikirim yang diteruskan — POST plugin bersifat partial", async () => {
    respond = () => ({ success: true, data: { jumlah_iklan: "4", opacity: "100" } });
    const { app } = build({ store: ENROLLED_TWO() });

    await call(app, "/plugin/sites/s_satu/config/ads-settings", { values: { jumlah_iklan: "4" } });
    expect(calls[0].body).toEqual({ jumlah_iklan: 4 });
    expect(calls[0].headers["X-RabbitROI-Key"]).toBe("K1");
  });

  /**
   * Inti dari penjaga ini: plugin menjawab 200 + success:true untuk enum yang DIABAIKANNYA.
   *
   * Tanpa `unapplied` di jawaban, "Tersimpan." di layar bisa berarti tidak ada satu pun yang
   * tersimpan — dan satu-satunya cara mengetahuinya adalah membuka situsnya sendiri.
   */
  it("field yang dijawab dengan nilai lama dilaporkan sebagai unapplied", async () => {
    respond = () => ({ success: true, data: { jumlah_iklan: "3", mode_tampilan: "Acak" } });
    const { app } = build({ store: ENROLLED_TWO() });

    const res = await call(app, "/plugin/sites/s_satu/config/ads-settings", {
      values: { jumlah_iklan: "4", mode_tampilan: "Acak" },
    });
    expect((await res.json()).unapplied).toEqual(["jumlah_iklan"]);
  });

  it("enum yang salah ditolak sebelum menyentuh situs", async () => {
    const { app } = build({ store: ENROLLED_TWO() });
    const res = await call(app, "/plugin/sites/s_satu/config/behaviour", {
      values: { behaviour_action: "hapus_semua" },
    });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain("bukan pilihan yang sah");
    expect(calls).toHaveLength(0);
  });

  /**
   * `:group` di luar daftar ditolak validator.
   *
   * Nilainya disambung mentah jadi segmen alamat di API plugin. Dibiarkan bebas, siapa pun yang
   * lolos gerbang superadmin bisa mengarahkannya ke endpoint plugin mana pun — termasuk AutoPost,
   * yang sengaja tidak didokumentasikan.
   */
  it("grup di luar daftar ditolak", async () => {
    const { app } = build({ store: ENROLLED_TWO() });
    const res = await call(app, "/plugin/sites/s_satu/config/autopost", { values: { x: 1 } });
    expect(res.status).toBe(422);
    expect(calls).toHaveLength(0);
  });

  it("membaca pengaturan ikut menyegarkan stempel 'terakhir menjawab'", async () => {
    respond = () => ({ success: true, data: { header_code: "<script></script>", footer_code: "" } });
    const { app, store } = build({ store: ENROLLED_TWO() });

    await call(app, "/plugin/sites/s_satu/config/header-footer");
    expect(store.state.pluginSites.s_satu.lastSeenAt).toBeTruthy();
  });
});

// --- Terapkan massal --------------------------------------------------------------------------------------

describe("terapkan ke banyak situs", () => {
  /**
   * SELALU 200, hasilnya per situs, dan satu situs mati tidak menghentikan sisanya.
   *
   * Kegagalan yang menjatuhkan seluruh batch meninggalkan armada setengah berubah tanpa catatan
   * bagian mana yang sudah — dan yang mengulanginya akan menulis ulang situs yang sudah benar
   * sambil tetap melewatkan yang gagal.
   */
  it("satu situs gagal, sisanya tetap jalan", async () => {
    respond = (url) =>
      url.includes("dua.rabbit.live")
        ? {
            status: 500,
            body: { success: false, error: { code: "save_failed", message: "DB penuh" } },
          }
        : { success: true, data: { jumlah_iklan: "4" } };

    const { app } = build({ store: ENROLLED_TWO() });
    const res = await call(app, "/plugin/bulk/config/ads-settings", {
      siteIds: ["s_satu", "s_dua"],
      values: { jumlah_iklan: "4" },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary).toEqual({ total: 2, ok: 1, unapplied: 0, failed: 1 });
    expect(body.results.find((row) => row.subdomainId === "s_dua").error).toContain("DB penuh");
    expect(body.results.find((row) => row.subdomainId === "s_satu").status).toBe("ok");
  });

  // "Tersimpan tapi tidak berubah" berdiri sendiri di ringkasan massal juga: dilebur ke gagal, ia
  // mengundang percobaan ulang yang tidak akan mengubah apa pun.
  it("yang tersimpan tanpa berubah dihitung terpisah dari yang gagal", async () => {
    respond = () => ({ success: true, data: { jumlah_iklan: "9" } });
    const { app } = build({ store: ENROLLED_TWO() });

    const res = await call(app, "/plugin/bulk/config/ads-settings", {
      siteIds: ["s_satu", "s_dua"],
      values: { jumlah_iklan: "4" },
    });
    const body = await res.json();
    expect(body.summary).toEqual({ total: 2, ok: 0, unapplied: 2, failed: 0 });
    expect(body.results[0].unapplied).toEqual(["jumlah_iklan"]);
  });

  it("id kembar dijalankan sekali saja", async () => {
    respond = () => ({ success: true, data: { jumlah_iklan: "4" } });
    const { app } = build({ store: ENROLLED_TWO() });

    const res = await call(app, "/plugin/bulk/config/ads-settings", {
      siteIds: ["s_satu", "s_satu", "s_satu"],
      values: { jumlah_iklan: "4" },
    });
    expect((await res.json()).summary.total).toBe(1);
    expect(calls).toHaveLength(1);
  });
});

// --- Landing ---------------------------------------------------------------------------------------------

describe("landing", () => {
  const enrolled = () =>
    fakeStore({
      subDomains: structuredClone(SUBDOMAINS),
      pluginKeys: { s_satu: { apiKey: "K1" } },
      pluginSites: { s_satu: { subdomainId: "s_satu", name: "satu.rabbit.live", enrolled: true } },
    });

  it("daftar diratakan jadi baris tabel, status jadi boolean", async () => {
    respond = () => ({
      success: true,
      data: { landings: [{ id: 12, slug: "promo-a", title: "Watch", status: "0" }] },
    });
    const { app } = build({ store: enrolled() });

    const rows = await (await call(app, "/plugin/sites/s_satu/landings")).json();
    expect(rows).toEqual([
      { id: "12", slug: "promo-a", title: "Watch", active: false, templateFile: "" },
    ]);
  });

  // Tanpa `id` = create dan slug wajib. Ditolak di sini, bukan dibiarkan situs menjawab
  // `save_failed` setelah satu perjalanan bolak-balik.
  it("landing baru tanpa slug ditolak sebelum menyentuh situs", async () => {
    const { app } = build({ store: enrolled() });
    const res = await call(app, "/plugin/sites/s_satu/landings", {
      values: { title: "Tanpa slug" },
    });
    expect(res.status).toBe(422);
    expect(calls).toHaveLength(0);
  });

  // `id` bukan field yang bisa diedit orang (tidak ada di skema), tapi ia yang menentukan
  // create-atau-update. Tanpa disambungkan, tiap simpan membuat landing BARU.
  it("id disambungkan ke payload supaya simpan jadi update, bukan bikin baru", async () => {
    respond = () => ({ success: true, data: { id: 12, landing: { id: 12, title: "Baru" } } });
    const { app } = build({ store: enrolled() });

    await call(app, "/plugin/sites/s_satu/landings", { values: { id: "12", title: "Baru" } });
    expect(calls[0].body).toEqual({ title: "Baru", id: 12 });
  });
});

// --- AutoPost -------------------------------------------------------------------------------------------

describe("autopost", () => {
  const enrolled = () =>
    fakeStore({
      subDomains: structuredClone(SUBDOMAINS),
      pluginKeys: { s_satu: { apiKey: "K1" } },
      pluginSites: { s_satu: { subdomainId: "s_satu", name: "satu.rabbit.live", enrolled: true } },
    });

  /**
   * Gerbang yang sama dengan enroll, dan taruhannya sama: alamatnya dibangun dari baris subdomain,
   * bukan dari request. Yang berbeda cuma segmennya — `/autopost`, DI LUAR `/manage/`. Disambung
   * lewat alamat manajemen, tiap permintaan menjawab `rest_no_route` (404), dan kegagalan itu
   * terbaca persis seperti situs yang belum memasang plugin versi baru.
   */
  it("menembak namespace autopost, bukan /manage/", async () => {
    respond = () => ({ success: true, data: { job_id: "9f2c1ab73de40571" } });
    const { app } = build({ store: enrolled() });

    const res = await call(app, "/plugin/sites/s_satu/autopost", {
      aiKey: "AIzaSy",
      keywords: ["best seo plugin"],
      values: {},
    });

    expect(res.status).toBe(200);
    expect(calls[0].url).toBe("https://satu.rabbit.live/wp-json/rabbitroi/v1/autopost");
    expect(calls[0].url).not.toContain("/manage/");
    expect(calls[0].headers["X-RabbitROI-Key"]).toBe("K1");
  });

  /**
   * Kunci AI ada di BODY, tidak pernah di alamat.
   *
   * Alamat masuk ke log akses server kontrol, ke riwayat browser, dan ke header `Referer` yang ikut
   * tiap permintaan berikutnya — tiga tempat yang tidak satu pun dijaga sekeras body request, untuk
   * kredensial yang ditagihkan per panggilan kepada pemiliknya.
   */
  it("kunci AI tidak pernah muncul di alamat", async () => {
    respond = () => ({ success: true, data: { job_id: "j1" } });
    const { app } = build({ store: enrolled() });

    await call(app, "/plugin/sites/s_satu/autopost", {
      aiKey: "AIzaSyRAHASIA",
      keywords: ["a"],
      values: {},
    });

    expect(calls[0].url).not.toContain("AIzaSyRAHASIA");
    expect(calls[0].body.ai_key).toBe("AIzaSyRAHASIA");
  });

  /**
   * Satu kata kunci yang ditolak TIDAK menjatuhkan sisanya, dan di sini alasannya lebih keras
   * daripada di terapkan-massal: job yang sudah lahir tidak bisa ditarik kembali. Mengulang batch
   * dari awal karena satu baris gagal menghasilkan artikel ganda untuk separuh daftar, dan AutoPost
   * memang tidak punya dedup apa pun.
   */
  it("hasilnya per kata kunci — yang gagal tidak menjatuhkan yang lain", async () => {
    respond = (_url, init) => {
      const body = JSON.parse(init.body);
      if (body.keyword === "b") {
        return { status: 502, body: { success: false, message: "Error Gemini: kuota habis" } };
      }
      return { success: true, data: { job_id: `job-${body.keyword}` } };
    };
    const { app } = build({ store: enrolled() });

    const res = await call(app, "/plugin/sites/s_satu/autopost", {
      aiKey: "AIzaSy",
      keywords: ["a", "b", "c"],
      values: {},
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.summary).toEqual({ total: 3, ok: 2, failed: 1 });
    const gagal = data.results.find((row) => row.keyword === "b");
    expect(gagal.status).toBe("failed");
    // Pesan dari AI ikut apa adanya — ia satu-satunya keterangan yang bisa dipakai memperbaikinya.
    expect(gagal.error).toContain("kuota habis");
    expect(data.results.find((row) => row.keyword === "a").jobId).toBe("job-a");
  });

  /**
   * Sebagian gagal TIDAK menandai situsnya merah: kegagalan per kata kunci sudah berdiri di
   * tabelnya sendiri, dan lencana merah karena satu kuota AI habis mengirim orang memeriksa
   * WordPress yang sehat.
   */
  it("cermin status ditulis SEKALI, dan sebagian gagal bukan situs bermasalah", async () => {
    respond = (_url, init) => {
      const body = JSON.parse(init.body);
      if (body.keyword === "b") return { status: 502, body: { success: false, message: "x" } };
      return { success: true, data: { job_id: "j" } };
    };
    const { app, store } = build({ store: enrolled() });

    await call(app, "/plugin/sites/s_satu/autopost", {
      aiKey: "AIzaSy",
      keywords: ["a", "b"],
      values: {},
    });

    expect(store.state.pluginSites.s_satu.error).toBe("");
    expect(store.state.pluginSites.s_satu.lastSeenAt).toBeTruthy();
  });

  it("SELURUH daftar ditolak berarti situsnya yang bermasalah", async () => {
    respond = () => ({ status: 401, body: { code: "invalid_key", message: "x", data: { status: 401 } } });
    const { app, store } = build({ store: enrolled() });

    await call(app, "/plugin/sites/s_satu/autopost", {
      aiKey: "AIzaSy",
      keywords: ["a", "b"],
      values: {},
    });

    expect(store.state.pluginSites.s_satu.error).toBeTruthy();
  });

  /**
   * Setelan yang salah ditolak dengan NOL job terlanjur dibuat.
   *
   * Payload seluruh daftar disusun di depan, sebelum satu permintaan pun berangkat — kalau tidak,
   * enum yang salah ketik baru ketahuan setelah tiga puluh artikel sudah mulai ditulis.
   */
  it("setelan yang tidak sah ditolak sebelum satu job pun dikirim", async () => {
    const { app } = build({ store: enrolled() });

    const res = await call(app, "/plugin/sites/s_satu/autopost", {
      aiKey: "AIzaSy",
      keywords: ["a", "b", "c"],
      values: { status_artikel: "entah" },
    });

    expect(res.status).toBe(422);
    expect(calls).toHaveLength(0);
  });

  it("daftar kosong dan daftar kepanjangan ditolak oleh skema route", async () => {
    const { app } = build({ store: enrolled() });

    expect((await call(app, "/plugin/sites/s_satu/autopost", {
      aiKey: "AIzaSy",
      keywords: [],
    })).status).toBe(422);

    // Tiap job adalah satu proses PHP yang hidup sampai artikelnya selesai; batas ini yang menahan
    // satu tempelan berisi seribu baris menjadi seribu di antaranya pada satu shared hosting.
    expect((await call(app, "/plugin/sites/s_satu/autopost", {
      aiKey: "AIzaSy",
      keywords: Array.from({ length: 51 }, (_, i) => `k${i}`),
    })).status).toBe(422);

    expect(calls).toHaveLength(0);
  });

  it("kata kunci wajib punya kunci AI", async () => {
    const { app } = build({ store: enrolled() });
    const res = await call(app, "/plugin/sites/s_satu/autopost", {
      aiKey: "",
      keywords: ["a"],
    });
    expect(res.status).toBe(422);
    expect(calls).toHaveLength(0);
  });

  it("pembuatan kata kunci membersihkan penomoran dan duplikat di sisi kita juga", async () => {
    respond = () => ({
      success: true,
      data: { base_keyword: "seo", requested: 4, total: 4, keywords: ["a", "A", " b ", ""] },
    });
    const { app } = build({ store: enrolled() });

    const res = await call(app, "/plugin/sites/s_satu/autopost/keywords", {
      aiKey: "AIzaSy",
      values: { base_keyword: "seo", total_keyword: 4 },
    });

    expect(calls[0].url).toBe("https://satu.rabbit.live/wp-json/rabbitroi/v1/autopost/keywords");
    const data = await res.json();
    expect(data.keywords).toEqual(["a", "b"]);
    // `requested` dan `total` dibawa KEDUANYA: daftar 2 baris untuk 4 yang diminta tampak lengkap.
    expect(data.requested).toBe(4);
    expect(data.total).toBe(2);
  });

  /**
   * Daftar job TIDAK menyentuh cermin RTDB, dan itu satu-satunya pembacaan plugin yang begitu.
   *
   * Ia di-poll tiap beberapa detik selama ada job berjalan. Lewat cermin, satu tab yang dibiarkan
   * terbuka menulis ke `pluginSites` setiap tiga detik — node yang DILANGGAN halaman itu sendiri,
   * jadi tiap tulisan menggambar ulang seluruh tabel armada di tiap browser yang membukanya.
   */
  it("daftar job tidak menulis cermin status sama sekali", async () => {
    respond = () => ({
      success: true,
      data: {
        jobs: [
          { job_id: "lama", created_at: 100, status: "done" },
          { job_id: "baru", created_at: 900, status: "running" },
        ],
        total: 2,
        summary: { running: 1, done: 1, failed: 0 },
        stale_seconds: 300,
      },
    });
    const { app, store } = build({ store: enrolled() });
    const before = structuredClone(store.state.pluginSites.s_satu);

    const res = await call(app, "/plugin/sites/s_satu/autopost/jobs?limit=50");

    expect(res.status).toBe(200);
    expect(calls[0].url).toContain("/autopost/jobs?limit=50");
    // Diurutkan dari yang TERBARU: yang dibaca orang saat membuka tab adalah yang baru dikirimnya.
    expect((await res.json()).jobs.map((job) => job.jobId)).toEqual(["baru", "lama"]);
    expect(store.state.pluginSites.s_satu).toEqual(before);
  });

  it("satu job dibaca berikut lognya", async () => {
    respond = () => ({
      success: true,
      data: {
        job_id: "9f2c1ab73de40571",
        status: "done",
        logs: ["satu", "dua"],
        final: { permalink: "https://satu.rabbit.live/x/", message: "Artikel dibuat." },
      },
    });
    const { app } = build({ store: enrolled() });

    const res = await call(app, "/plugin/sites/s_satu/autopost/job/9f2c1ab73de40571");

    expect(calls[0].url).toBe(
      "https://satu.rabbit.live/wp-json/rabbitroi/v1/autopost/job/9f2c1ab73de40571",
    );
    const data = await res.json();
    expect(data.logs).toEqual(["satu", "dua"]);
    expect(data.permalink).toBe("https://satu.rabbit.live/x/");
  });

  // `job_id` disambung jadi segmen alamat, alasan yang sama dengan `siteId()`: dibiarkan bebas, ia
  // bisa mengarahkan permintaan ke path lain di REST API situsnya.
  it("job id berbentuk aneh ditolak sebelum menyentuh jaringan", async () => {
    const { app } = build({ store: enrolled() });
    const res = await call(app, "/plugin/sites/s_satu/autopost/job/..%2Fsettings");
    expect(res.status).toBe(422);
    expect(calls).toHaveLength(0);
  });

  it("situs yang belum enroll tidak punya kunci untuk dipakai", async () => {
    const { app } = build();
    const res = await call(app, "/plugin/sites/s_satu/autopost", {
      aiKey: "AIzaSy",
      keywords: ["a"],
    });
    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe("no_key");
    expect(calls).toHaveLength(0);
  });

  /**
   * Plugin versi lama menjawab `rest_no_route` — dan itu HARUS terbaca sebagai "pluginnya belum
   * punya AutoPost", bukan sebagai kunci yang ditolak. Keduanya kegagalan izin di mata HTTP, dan
   * yang diperbaiki sangat berbeda: yang satu dengan memperbarui plugin, yang satu dengan reset +
   * enroll ulang yang justru akan membuang kunci yang masih sah.
   */
  it("plugin versi lama menyebut dirinya, bukan kunci yang salah", async () => {
    respond = () => ({
      status: 404,
      body: { code: "rest_no_route", message: "No route was found", data: { status: 404 } },
    });
    const { app } = build({ store: enrolled() });

    const res = await call(app, "/plugin/sites/s_satu/autopost/jobs");

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.code).toBe("rest_no_route");
    expect(body.error).toContain("perbarui pluginnya");
  });
});

// --- Skema -----------------------------------------------------------------------------------------------

describe("skema", () => {
  /**
   * Satu-satunya definisi field, dipakai server untuk memvalidasi dan browser untuk menggambar form.
   *
   * Ditulis dua kali, yang bergeser tidak akan berbunyi sebagai kesalahan: form menawarkan enum yang
   * ditolak server, atau lebih buruk, enum yang DITERIMA server tapi diabaikan diam-diam plugin.
   */
  it("dikirim ke browser lengkap dengan pilihan enumnya", async () => {
    const { app } = build();
    const schema = await (await call(app, "/plugin/schema")).json();

    expect(Object.keys(schema).sort()).toEqual([
      "ads-settings",
      "autopost",
      "autopost-keywords",
      "behaviour",
      "cmp",
      "header-footer",
      "landing",
      "security",
    ]);
    const action = schema.behaviour.fields.find((f) => f.name === "behaviour_action");
    expect(action.options).toEqual(["hide_ads", "cover_ads", "redirect"]);

    // CMP cuma dua field, dan yang KETIGA menjatuhkan seluruh permintaan: `cmp_referrer_policy`
    // adalah kunci penyimpanan internal plugin, bukan parameter API. Ia tidak boleh sampai ke form,
    // karena form mengirim apa yang digambarnya.
    expect(schema.cmp.fields.map((f) => f.name)).toEqual(["cmp_enabled", "cmp_code"]);

    // Keamanan menolak nama field yang tidak dikenal DAN menjatuhkan seluruh permintaan bersamanya,
    // jadi yang tidak boleh sampai ke form bukan cuma nilai yang salah melainkan nama yang salah.
    // Sembunyikan Form Login sengaja tidak punya permukaan API sama sekali; `behaviour_*` tetap
    // lewat /manage/behaviour.
    const security = schema.security.fields.map((f) => f.name);
    expect(security).toContain("test_mode_behaviour");
    expect(security).toContain("gpt_sizes");
    expect(security).not.toContain("hidden_login_form");
    expect(security).not.toContain("url_login");
    expect(security).not.toContain("aksi_login");
    expect(security.filter((name) => name.startsWith("behaviour_"))).toEqual([]);

    /**
     * AutoPost ikut dikirim walau ia BUKAN grup pengaturan.
     *
     * Ia digabung di route ini dan bukan di dalam `PLUGIN_SCHEMA` sendiri, karena `autopost-core.js`
     * mengimpor `plugin-core.js` — arah sebaliknya menutup lingkaran impor. Yang menyatukan keduanya
     * adalah pemakainya: form di browser, yang menggambar keduanya dari satu jawaban.
     */
    // Bawaan ikut dikirim bersama skemanya, dan nilainya salinan kolom "Default REST" di dokumen —
    // bukan bawaan layar wp-admin, yang berbeda di tiga tempat.
    expect(schema.autopost.defaults.generate_image).toBe(false);
    expect(schema.autopost.defaults.penjadwalan).toBe("1_hours");
    expect(schema["autopost-keywords"].fields.map((f) => f.name)).toEqual([
      "base_keyword",
      "total_keyword",
      "bahasa",
    ]);

    // DUA field yang sengaja TIDAK ada di skema: `ai_key` (kredensial — ia tidak boleh ikut jalur
    // mana pun yang menyimpan nilai form) dan `keyword` (isi permintaan, bukan setelan — digambar
    // sebagai field skema, ia akan ikut "terapkan ke situs lain" seolah ia menempel di situs).
    const autopostNames = schema.autopost.fields.map((f) => f.name);
    expect(autopostNames).not.toContain("ai_key");
    expect(autopostNames).not.toContain("keyword");
  });
});

// --- Inject kode iklan Ad Manager ----------------------------------------------------------------

describe("inject GPT", () => {
  const OPTIONS = { sizes: "300x250,88x31", slots: 2 };
  const PROPERTY = { adUnitCode: "ca-pub-8660742543707970" };
  const UNITS = [
    { adUnitCode: "23352267851", hasChildren: true, status: "ACTIVE" },
    { adUnitCode: "ca-pub-8660742543707970", hasChildren: true, status: "ACTIVE" },
    {
      adUnitCode: "ca-pub-9198385730397674-tag",
      displayName: "Ad Exchange Display",
      status: "ACTIVE",
      parentPath: [PROPERTY],
      adUnitSizes: [{ size: { width: 300, height: 250, sizeType: "PIXEL" }, environmentType: "BROWSER" }],
    },
    { adUnitCode: "header", displayName: "header", status: "ACTIVE", parentPath: [PROPERTY] },
  ];
  const HEADER = `<script async src="https://securepubads.g.doubleclick.net/tag/js/gpt.js" crossorigin="anonymous"></script>
<script>
  window.googletag = window.googletag || {cmd: []};
  googletag.cmd.push(function() {
    googletag.defineSlot('/1/lama', [[300, 250]], 'div-gpt-ad-1-0').addService(googletag.pubads());
    googletag.enableServices();
  });
</script>`;

  const STORE = () =>
    fakeStore({
      subDomains: {
        s_satu: { name: "credit.designingaround.com", parentDomain: "designingaround.com" },
        s_dua: { name: "garage.designingaround.com", parentDomain: "designingaround.com" },
        s_tanpa_gam: { name: "furniture.dekadeko.com", parentDomain: "dekadeko.com" },
      },
      pluginKeys: { s_satu: { apiKey: "K1" }, s_dua: { apiKey: "K2" }, s_tanpa_gam: { apiKey: "K3" } },
      pluginSites: {},
      gamAccounts: {
        g1: {
          name: "designingaround.com",
          networkCode: 23352267851,
          publisherId: "ca-pub-8660742543707970",
          googleCredential: "designingaround.com",
        },
      },
      googleApiConfigs: {
        c1: { name: "designingaround.com", clientId: "id", clientSecret: "secret", refreshToken: "r" },
      },
    });

  /**
   * Ad Manager, token OAuth, dan dua situs WordPress yang MENYIMPAN tulisannya — tanpa itu, uji "isi
   * header lain tidak disentuh" lulus untuk kode yang menimpa seluruh kotak.
   */
  function fakeWorld() {
    const sites = {
      "credit.designingaround.com": {
        "header-footer": { header_code: `<script>/* analytics */</script>\n${HEADER}`, footer_code: "" },
        "ads-settings": {
          kode_iklan_1: "lama",
          kode_iklan_3: "<script>googletag.display('div-gpt-ad-1-2');</script>",
          jumlah_iklan: "3",
        },
      },
      "garage.designingaround.com": {
        "header-footer": { header_code: "", footer_code: "" },
        "ads-settings": { jumlah_iklan: "1" },
      },
    };
    respond = (url, init) => {
      if (url.includes("oauth2.googleapis.com")) return { access_token: "T", expires_in: 3600 };
      if (url.includes("admanager.googleapis.com")) return { adUnits: UNITS };
      const { host, pathname } = new URL(url);
      const group = pathname.split("/").pop();
      if (init.method === "POST") Object.assign(sites[host][group], JSON.parse(init.body));
      return { success: true, data: sites[host][group] };
    };
    return sites;
  }

  it("networks menjawab akun GAM, properti, dan unit iklan — satu panggilan Ad Manager per network", async () => {
    fakeWorld();
    const { app } = build({ store: STORE() });
    const body = await (
      await call(app, "/plugin/gpt/networks", { siteIds: ["s_satu", "s_dua", "s_tanpa_gam"] })
    ).json();

    expect(body.networks.length).toBe(1);
    expect(body.networks[0]).toMatchObject({
      networkCode: "23352267851",
      accountName: "designingaround.com",
      publisherId: "ca-pub-8660742543707970",
    });
    expect(body.networks[0].error).toBe("");
    expect(body.networks[0].units.map((unit) => unit.path)).toEqual([
      "/23352267851/ca-pub-9198385730397674-tag",
      "/23352267851/header",
    ]);
    expect(body.sites.find((row) => row.subdomainId === "s_tanpa_gam").error).toContain("dekadeko.com");
    expect(calls.filter((item) => item.url.includes("admanager")).length).toBe(1);
    // WordPress tidak dihubungi sama sekali.
    expect(calls.some((item) => item.url.includes("rabbitroi"))).toBe(false);
  });

  it("preview menyusun kode SELURUH subdomain, masing-masing dengan stempel div sendiri", async () => {
    fakeWorld();
    const { app } = build({ store: STORE() });
    const body = await (
      await call(app, "/plugin/gpt/preview", { siteIds: ["s_satu", "s_dua", "s_tanpa_gam"], options: OPTIONS })
    ).json();
    const [satu, dua, tanpa] = body.sites;
    expect(satu.divStamp).toMatch(/^\d{13}$/);
    expect(dua.divStamp).not.toBe(satu.divStamp);
    expect(satu.header).toContain(
      `googletag.defineSlot('/23352267851/ca-pub-9198385730397674-tag', [[300, 250], [88, 31]], 'div-gpt-ad-${satu.divStamp}-1')`,
    );
    expect(dua.bodies[0]).toContain(`div-gpt-ad-${dua.divStamp}-0`);
    expect(tanpa.error).toContain("akun GAM");
  });

  it("kode unit yang tidak ada di network itu ditolak di baris situsnya", async () => {
    fakeWorld();
    const { app } = build({ store: STORE() });
    const body = await (
      await call(app, "/plugin/gpt/preview", {
        siteIds: ["s_satu"],
        options: OPTIONS,
        adUnitCodes: { 23352267851: "unit-network-lain" },
      })
    ).json();
    expect(body.sites[0].error).toContain("unit-network-lain");
    expect(body.sites[0].header).toBeUndefined();
  });

  it("dryRun membaca dan melaporkan rencana, tanpa satu pun POST ke situs", async () => {
    fakeWorld();
    const { app } = build({ store: STORE() });
    const body = await (
      await call(app, "/plugin/bulk/gpt-inject", { siteIds: ["s_satu", "s_dua"], options: OPTIONS, dryRun: true })
    ).json();

    expect(calls.filter((item) => item.url.includes("rabbitroi")).every((item) => item.method === "GET")).toBe(true);
    const satu = body.results.find((row) => row.subdomainId === "s_satu");
    expect(satu.detail).toMatchObject({
      dryRun: true,
      headerMode: "replaced",
      cleared: ["kode_iklan_3"],
      adUnitPath: "/23352267851/ca-pub-9198385730397674-tag",
    });
    expect(body.results.find((row) => row.subdomainId === "s_dua").detail.headerMode).toBe("appended");
  });

  it("inject mengganti blok GPT, mempertahankan isi header lain, dan mengisi kode iklan", async () => {
    const sites = fakeWorld();
    const { app } = build({ store: STORE() });
    const body = await (
      await call(app, "/plugin/bulk/gpt-inject", {
        siteIds: ["s_satu", "s_tanpa_gam"],
        options: { ...OPTIONS, divStamps: { s_satu: "1789368958539" } },
        adUnitCodes: { 23352267851: "header" },
      })
    ).json();

    expect(body.summary).toMatchObject({ total: 2, ok: 1, failed: 1 });
    const header = sites["credit.designingaround.com"]["header-footer"].header_code;
    expect(header.startsWith("<script>/* analytics */</script>\n<script async src=")).toBe(true);
    expect(header).not.toContain("RabbitROI GPT");
    expect(header).toContain("'/23352267851/header'");
    expect(header).not.toContain("/1/lama");

    const ads = sites["credit.designingaround.com"]["ads-settings"];
    expect(ads.kode_iklan_2).toContain("div-gpt-ad-1789368958539-1");
    expect(header).toContain("div-gpt-ad-1789368958539-1");
    expect(ads.kode_iklan_3).toBe("");
    expect(ads.jumlah_iklan).toBe(2);

    // Subdomain tanpa akun GAM gagal sendiri — dan TIDAK ditandai bermasalah di cermin status plugin.
    const store = STORE();
    expect(body.results.find((row) => row.subdomainId === "s_tanpa_gam").error).toContain("akun GAM");
    expect(store.state.pluginSites.s_tanpa_gam).toBeUndefined();
  });

  it("stempel div yang bukan angka ditolak sebelum satu situs pun dibaca", async () => {
    fakeWorld();
    const { app } = build({ store: STORE() });
    const res = await call(app, "/plugin/bulk/gpt-inject", {
      siteIds: ["s_satu"],
      options: { ...OPTIONS, divStamps: { s_satu: "1'); alert(1" } },
    });
    expect(res.status).toBe(422);
    expect(calls.some((item) => item.url.includes("rabbitroi"))).toBe(false);
  });

  it("pilihan yang tidak sah ditolak sekali, sebelum satu situs pun dibaca", async () => {
    fakeWorld();
    const { app } = build({ store: STORE() });
    const res = await call(app, "/plugin/bulk/gpt-inject", {
      siteIds: ["s_satu", "s_dua"],
      options: { ...OPTIONS, slots: 9 },
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(calls.length).toBe(0);
  });
});

describe("inject AdSense", () => {
  const code = (slot, client = "ca-pub-2520327538603736") => `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${client}" crossorigin="anonymous"></script>
<ins class="adsbygoogle" style="display:block" data-ad-client="${client}" data-ad-slot="${slot}" data-ad-format="auto" data-full-width-responsive="true"></ins>
<script>
(adsbygoogle = window.adsbygoogle || []).push({});
</script>`;
  const unit = (slot, displayName, size = "1x3") => ({
    name: `accounts/pub-2520327538603736/adclients/ca-pub-2520327538603736/adunits/${slot}`,
    displayName,
    state: "ACTIVE",
    contentAdsSettings: { size, type: "DISPLAY" },
  });

  const STORE = () =>
    fakeStore({
      subDomains: {
        s_pet: { name: "care.petcins.com", parentDomain: "petcins.com" },
        s_lain: { name: "garage.designingaround.com", parentDomain: "designingaround.com" },
      },
      pluginKeys: { s_pet: { apiKey: "K1" }, s_lain: { apiKey: "K2" } },
      pluginSites: {},
      adsenseAccounts: {
        a1: { name: "Dian ramadani", accountName: "accounts/pub-2520327538603736", googleCredential: "petcins" },
      },
      gamAccounts: {},
      googleApiConfigs: {
        c1: { name: "petcins", clientId: "id", clientSecret: "secret", refreshToken: "r" },
      },
    });

  function fakeWorld() {
    const sites = {
      "care.petcins.com": {
        "header-footer": { header_code: "<script>/* GPT lama */</script>" },
        "ads-settings": {
          kode_iklan_1: "<script>googletag.display('div-gpt-ad-1-0');</script>",
          kode_iklan_3: code("9999999999"),
          jumlah_iklan: "3",
        },
      },
      "garage.designingaround.com": { "ads-settings": { jumlah_iklan: "1" } },
    };
    respond = (url, init) => {
      if (url.includes("oauth2.googleapis.com")) return { access_token: "T", expires_in: 3600 };
      if (url.includes("adsense.googleapis.com") && url.includes("/adunits")) {
        return { adUnits: [unit("3445630456", "petcins 1"), unit("2172584371", "cathealth-2", "300x600")] };
      }
      if (url.includes("adsense.googleapis.com") && url.includes("/sites")) {
        return { sites: [{ domain: "petcins.com", state: "READY" }] };
      }
      const { host, pathname } = new URL(url);
      const group = pathname.split("/").pop();
      if (init.method === "POST") Object.assign(sites[host][group], JSON.parse(init.body));
      return { success: true, data: sites[host][group] };
    };
    return sites;
  }

  it("check menyebut akun, nama unit, dan ukurannya tanpa menghubungi WordPress", async () => {
    fakeWorld();
    const { app } = build({ store: STORE() });
    const body = await (
      await call(app, "/plugin/adsense/check", { siteId: "s_pet", codes: [code("3445630456"), code("2172584371")] })
    ).json();
    expect(body).toMatchObject({ name: "care.petcins.com", client: "ca-pub-2520327538603736", verified: true, siteNote: "" });
    expect(body.slots.map((row) => [row.displayName, row.size])).toEqual([
      ["petcins 1", "responsif"],
      ["cathealth-2", "300x600"],
    ]);
    expect(calls.some((item) => item.url.includes("rabbitroi"))).toBe(false);
  });

  it("slot yang tidak ada di akun yang terbaca ditolak 422", async () => {
    fakeWorld();
    const { app } = build({ store: STORE() });
    const res = await call(app, "/plugin/adsense/check", { siteId: "s_pet", codes: [code("1111111111")] });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain("1111111111");
  });

  it("publisher yang tidak terdaftar: tidak ditolak, disebut belum terverifikasi", async () => {
    fakeWorld();
    const { app } = build({ store: STORE() });
    const body = await (
      await call(app, "/plugin/adsense/check", { siteId: "s_pet", codes: [code("5", "ca-pub-1375442959645911").replace('data-ad-slot="5"', 'data-ad-slot="55555"')] })
    ).json();
    expect(body.verified).toBe(false);
    expect(body.slots[0].note).toContain("tidak terdaftar");
  });

  it("inject menulis kode iklan + jumlah slot, tidak menyentuh header, dan baris gagal berdiri sendiri", async () => {
    const sites = fakeWorld();
    const { app } = build({ store: STORE() });
    const body = await (
      await call(app, "/plugin/bulk/adsense-inject", {
        items: [
          { siteId: "s_pet", codes: [code("3445630456"), code("2172584371")] },
          { siteId: "s_lain", codes: ["bukan kode"] },
        ],
      })
    ).json();

    expect(body.summary).toMatchObject({ total: 2, ok: 1, failed: 1 });
    const ads = sites["care.petcins.com"]["ads-settings"];
    expect(ads.kode_iklan_1).toContain('data-ad-slot="3445630456"');
    expect(ads.kode_iklan_2).toContain('data-ad-slot="2172584371"');
    expect(ads.kode_iklan_3).toBe("");
    expect(ads.jumlah_iklan).toBe(2);
    expect(sites["care.petcins.com"]["header-footer"].header_code).toBe("<script>/* GPT lama */</script>");
    expect(calls.some((item) => item.url.includes("header-footer"))).toBe(false);
    expect(body.results.find((row) => row.subdomainId === "s_lain").error).toContain("bukan kode unit AdSense");
  });

  it("dryRun cuma membaca ads-settings dan melaporkan rencananya", async () => {
    fakeWorld();
    const { app } = build({ store: STORE() });
    const body = await (
      await call(app, "/plugin/bulk/adsense-inject", {
        items: [{ siteId: "s_pet", codes: [code("3445630456")] }],
        dryRun: true,
      })
    ).json();
    expect(calls.filter((item) => item.url.includes("rabbitroi")).every((item) => item.method === "GET")).toBe(true);
    expect(body.results[0].detail).toMatchObject({
      dryRun: true,
      verified: true,
      replaced: ["kode_iklan_1: GPT"],
      cleared: ["kode_iklan_3"],
      previousSlotCount: "3",
    });
  });
});

describe("situs akun AdSense", () => {
  it("subdomain dipetakan ke akun lewat daftar Situs AdSense; akun yang gagal disebut", async () => {
    respond = (url) => {
      if (url.includes("oauth2.googleapis.com")) return { access_token: "T", expires_in: 3600 };
      if (url.includes("pub-111/sites")) return { sites: [{ domain: "petcins.com", state: "READY" }, { domain: "care.petcins.com" }] };
      if (url.includes("pub-222/sites")) return { status: 403, body: { error: { message: "Permission denied" } } };
      return {};
    };
    const store = fakeStore({
      subDomains: {
        s_care: { name: "care.petcins.com" },
        s_akar: { name: "petcins.com" },
        s_lain: { name: "garage.designingaround.com" },
        s_hapus: { name: "vet.petcins.com", deletedAt: "2026-09-01" },
      },
      adsenseAccounts: {
        a1: { name: "Dian", accountName: "accounts/pub-111", googleCredential: "c" },
        a2: { name: "Muzakkir", accountName: "accounts/pub-222", googleCredential: "c" },
      },
      googleApiConfigs: { c1: { name: "c", clientId: "id", clientSecret: "s", refreshToken: "r" } },
    });
    const { app } = build({ store });
    const body = await (await call(app, "/plugin/adsense/sites")).json();
    expect(Object.keys(body.sites).sort()).toEqual(["s_akar", "s_care"]);
    expect(body.sites.s_care).toMatchObject({ accountName: "Dian", publisherId: "pub-111" });
    expect(body.accounts.find((row) => row.accountName === "Dian")).toMatchObject({ siteCount: 2, error: "" });
    expect(body.accounts.find((row) => row.accountName === "Muzakkir").error).not.toBe("");
  });
});

// --- Setup situs: landing preset, lisensi, Setting Sub, halaman legal ------------------------------

describe("setup situs", () => {
  const keyed = () =>
    fakeStore({ subDomains: structuredClone(SUBDOMAINS), pluginKeys: { s_satu: { apiKey: "K1" } } });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

  it("landing preset mengembalikan tautan berikut parameternya", async () => {
    respond = () => ({
      success: true,
      data: {
        id: 77,
        slug: "gg83kckf",
        url: "https://satu.rabbit.live/gg83kckf",
        landing: { slug: "gg83kckf", parameter_key: "abcdef", parameter_value: "wxyz" },
      },
    });
    const { app } = build({ store: keyed() });
    const res = await call(app, "/plugin/sites/s_satu/landings/create", {});
    expect(calls[0].url).toBe("https://satu.rabbit.live/wp-json/rabbitroi/v1/manage/landing/create");
    expect(await res.json()).toEqual({
      id: "77",
      slug: "gg83kckf",
      url: "https://satu.rabbit.live/gg83kckf",
      parameterKey: "abcdef",
      parameterValue: "wxyz",
      link: "https://satu.rabbit.live/gg83kckf?abcdef=wxyz",
      cloakingUrl: "",
      videoPause: "15-30",
    });
  });

  it("landing preset diberi satu URL cloaking dari daftar dan jeda video 15-30", async () => {
    respond = (url) =>
      url.endsWith("/landing/create")
        ? { success: true, data: { id: 77, slug: "gg", landing: { slug: "gg" } } }
        : {
            success: true,
            data: { id: 77, landing: { cloaking_url: "https://yt.test/a", timer_auto_pause_video: "15-30" } },
          };
    const store = keyed();
    store.state.dashboard = {
      cloakingUrls: { x: { url: "https://yt.test/a" }, y: { url: "https://yt.test/b", deletedAt: "t" } },
    };
    const { app } = build({ store });
    const body = await (await call(app, "/plugin/sites/s_satu/landings/create", {})).json();
    expect(calls[1].body).toEqual({
      id: 77,
      cloaking_url: "https://yt.test/a",
      timer_auto_pause_video: "15-30",
    });
    expect(body).toMatchObject({ cloakingUrl: "https://yt.test/a", videoPause: "15-30" });
    expect(body.presetError).toBeUndefined();
  });

  it("license key dikirim di body sebagai license_key", async () => {
    respond = () => ({ success: true, data: { active: true, changed: true } });
    const { app } = build({ store: keyed() });
    const res = await call(app, "/plugin/sites/s_satu/license", { licenseKey: "RBT0-XXXX" });
    expect(res.status).toBe(200);
    expect(calls[0].body).toEqual({ license_key: "RBT0-XXXX" });
  });

  it("Setting Sub tanpa task ditolak sebelum menyentuh situs", async () => {
    const { app } = build({ store: keyed() });
    const res = await call(app, "/plugin/sites/s_satu/deployment", { tasks: [] });
    expect(res.status).toBe(422);
    expect(calls).toHaveLength(0);
  });

  it("Setting Sub jalan di latar; sebagian gagal = partial", async () => {
    respond = () => ({
      success: true,
      data: {
        results: [
          { task: "trash", label: "Trash Content", ok: true, details: "ok" },
          { task: "theme", label: "Theme Setup", ok: false, details: "zip hilang" },
        ],
      },
    });
    const store = keyed();
    const { app } = build({ store });
    const res = await call(app, "/plugin/sites/s_satu/deployment", { tasks: ["theme", "trash"] });
    expect(await res.json()).toEqual({ started: true });
    await settle();
    // Urutan kanonik, apa pun urutan yang dikirim.
    expect(calls[0].body).toEqual({ tasks: ["trash", "theme"] });
    const task = store.state.subDomains.s_satu.siteTasks.deployment;
    expect(task.state).toBe("partial");
    expect(task.results[1].details).toBe("zip hilang");
  });

  it("halaman legal: kunci AI hanya diteruskan ke situs, tidak dicatat", async () => {
    respond = () => ({
      success: true,
      data: { created: 1, skipped: 0, pages: [{ title: "Privacy Policy", status: "created" }] },
    });
    const store = keyed();
    const { app } = build({ store });
    await call(app, "/plugin/sites/s_satu/legal-pages", {
      aiKey: "AIzaSy-0123456789abcdef",
      pages: ["Privacy Policy"],
    });
    await settle();
    expect(calls[0].body).toEqual({ ai_key: "AIzaSy-0123456789abcdef", pages: ["Privacy Policy"] });
    const task = store.state.subDomains.s_satu.siteTasks.legal;
    expect(task.state).toBe("done");
    expect(JSON.stringify(task)).not.toContain("AIzaSy");
  });

  it("Susun menu mengirim task menus saja, statusnya di slot sendiri", async () => {
    respond = () => ({
      success: true,
      data: { results: [{ task: "menus", label: "Nav Menu Setup", ok: true, details: "6 item" }] },
    });
    const store = keyed();
    const { app } = build({ store });
    await call(app, "/plugin/sites/s_satu/menus", {});
    await settle();
    expect(calls[0].url).toBe("https://satu.rabbit.live/wp-json/rabbitroi/v1/manage/deployment");
    expect(calls[0].body).toEqual({ tasks: ["menus"] });
    expect(store.state.subDomains.s_satu.siteTasks.menus.state).toBe("done");
    expect(store.state.subDomains.s_satu.siteTasks.deployment).toBeUndefined();
  });

  it("subdomain yang tidak ada tidak melahirkan baris status", async () => {
    const store = keyed();
    const { app } = build({ store });
    const res = await call(app, "/plugin/sites/s_hantu/deployment", { tasks: ["trash"] });
    expect(res.status).toBe(404);
    expect(store.state.subDomains.s_hantu).toBeUndefined();
  });
});
