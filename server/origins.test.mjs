import { cors } from "@elysiajs/cors";
import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { corsOrigins, landingOrigin, originMatcher, parseOrigins } from "./origins.js";

describe("parseOrigins", () => {
  it("memangkas spasi dan membuang entri kosong", () => {
    expect(parseOrigins(" https://a.com , https://b.com ,, ")).toEqual([
      "https://a.com",
      "https://b.com",
    ]);
  });

  // Env yang KOSONG jatuh ke bawaan, bukan ke daftar kosong: daftar izin kosong berarti tiap
  // dashboard tertolak CORS, dengan gejala yang sama persis dengan server yang mati.
  it("jatuh ke bawaan saat env kosong", () => {
    expect(parseOrigins("", "https://x.com")).toEqual(["https://x.com"]);
    expect(parseOrigins(undefined, "https://x.com")).toEqual(["https://x.com"]);
  });
});

describe("originMatcher", () => {
  it("entri biasa diteruskan apa adanya, bukan jadi pola", () => {
    expect(originMatcher("https://rabbitroi-89973.web.app")).toBe(
      "https://rabbitroi-89973.web.app",
    );
    expect(originMatcher("http://localhost:5173")).toBe("http://localhost:5173");
  });

  it("wildcard menerima subdomain, sampai ke dalam", () => {
    const rule = originMatcher("https://*.rabbitracing.live");
    expect(rule.test("https://app.rabbitracing.live")).toBe(true);
    expect(rule.test("https://a.b.rabbitracing.live")).toBe(true);
    expect(rule.test("https://gate-01.rabbitracing.live")).toBe(true);
  });

  /**
   * Yang dijaga jangkar di kedua ujung, dan tiap barisnya adalah domain yang bisa DIDAFTARKAN siapa
   * saja hari ini. Tanpa `^...$`, ketiganya lolos — dan tidak ada satu pun permintaan yang gagal
   * untuk mengabarkannya: yang salah baru terlihat pada hari seseorang memakainya.
   */
  it("menolak domain yang cuma MIRIP", () => {
    const rule = originMatcher("https://*.rabbitracing.live");
    expect(rule.test("https://a.rabbitracing.live.penyerang.id")).toBe(false);
    expect(rule.test("https://a.notrabbitracing.live")).toBe(false);
    expect(rule.test("https://rabbitracingXlive")).toBe(false);
    expect(rule.test("https://a.rabbitracing.liveX")).toBe(false);
  });

  // Apex TIDAK ikut, sepola sertifikat wildcard. Kalau ia juga boleh, ia ditulis sebagai entri
  // tersendiri — menebaknya di sini berarti daftar izin memuat nama yang tidak tertulis di mana pun.
  it("wildcard tidak menerima apex-nya sendiri", () => {
    expect(originMatcher("https://*.rabbitracing.live").test("https://rabbitracing.live")).toBe(
      false,
    );
  });

  // Skema ikut dicocokkan: origin yang sama lewat HTTP adalah halaman yang isinya bisa disisipi
  // siapa pun di jalur jaringannya.
  it("skema ikut dicocokkan", () => {
    expect(originMatcher("https://*.rabbitracing.live").test("http://a.rabbitracing.live")).toBe(
      false,
    );
  });

  /**
   * Wildcard yang menyisakan SATU label membuka seluruh TLD, dan bentuk itu lahir dari satu label
   * yang terhapus saat menyunting — bukan dari niat. Dibiarkan lolos, ia jadi CORS terbuka yang
   * tertulis seperti CORS tertutup.
   */
  it("menolak wildcard yang membuka seluruh TLD", () => {
    expect(() => originMatcher("https://*.live")).toThrow(/membuka seluruh TLD/);
    expect(() => originMatcher("https://*.com")).toThrow(/membuka seluruh TLD/);
  });

  it("menolak * di luar label paling kiri, dan origin berpath", () => {
    expect(() => originMatcher("https://*.*.rabbitracing.live")).toThrow(/label paling kiri/);
    expect(() => originMatcher("https://*.rabbitracing.live/admin")).toThrow(/tidak boleh punya path/);
  });
});

describe("landingOrigin", () => {
  /**
   * `appUrl` OAuth dulu `ORIGINS[0]` apa adanya. Sejak daftar ini boleh memuat wildcard, entri
   * pertama bisa berupa pola — dan yang mendarat sesudah consent Google diarahkan ke
   * "https://*.contoh.com", alamat yang tidak pernah ada. Kegagalannya jauh dari sebabnya: yang
   * berubah satu koma di ALLOWED_ORIGINS, yang rusak login Google.
   */
  it("melewati wildcard dan memilih alamat sungguhan pertama", () => {
    expect(
      landingOrigin(["https://*.rabbitracing.live", "https://rabbitroi-89973.web.app"]),
    ).toBe("https://rabbitroi-89973.web.app");
  });

  it("daftar yang seluruhnya wildcard tidak menghasilkan alamat karangan", () => {
    expect(landingOrigin(["https://*.rabbitracing.live"])).toBe("");
    expect(landingOrigin([])).toBe("");
  });
});

/**
 * Diadu dengan @elysiajs/cors yang SUNGGUHAN, bukan cuma dengan regex-nya sendiri.
 *
 * Yang diuji di sini bukan pola buatan kita melainkan bahwa `cors` memang mencocokkan RegExp dengan
 * header `Origin` UTUH. Kalau versi berikutnya mencocokkannya dengan hostname saja (tanpa skema),
 * tiap pola di atas berhenti cocok — dan gejalanya "Failed to fetch" di dashboard, bukan tes merah.
 */
describe("dipasang ke @elysiajs/cors", () => {
  const app = new Elysia()
    .use(
      cors({
        origin: corsOrigins([
          "https://rabbitroi-89973.web.app",
          "https://rabbitracing.live",
          "https://*.rabbitracing.live",
        ]),
        methods: ["GET", "POST"],
        allowedHeaders: ["Authorization", "Content-Type"],
      }),
    )
    .get("/livez", () => "ok");

  const allowed = async (origin) => {
    const res = await app.handle(
      new Request("http://localhost/livez", { headers: { Origin: origin } }),
    );
    return res.headers.get("access-control-allow-origin");
  };

  it("meloloskan apex dan subdomain rabbitracing.live", async () => {
    expect(await allowed("https://rabbitracing.live")).toBe("https://rabbitracing.live");
    expect(await allowed("https://app.rabbitracing.live")).toBe("https://app.rabbitracing.live");
    expect(await allowed("https://a.b.rabbitracing.live")).toBe("https://a.b.rabbitracing.live");
  });

  it("dashboard yang sudah ada tidak ikut berubah", async () => {
    expect(await allowed("https://rabbitroi-89973.web.app")).toBe(
      "https://rabbitroi-89973.web.app",
    );
  });

  it("origin lain tetap tidak dipantulkan", async () => {
    expect(await allowed("https://penyerang.id")).not.toBe("https://penyerang.id");
    expect(await allowed("https://rabbitracing.live.penyerang.id")).not.toBe(
      "https://rabbitracing.live.penyerang.id",
    );
  });
});
