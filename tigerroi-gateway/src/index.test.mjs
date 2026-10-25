import assert from "node:assert/strict";
import test from "node:test";
import worker from "./index.js";
import { findGatewayRoute, GATEWAY_ROUTES } from "./routes.js";

const mockEnv = {
  KEITARO_BASE_URL: "https://appscity.tech",
  FALLBACK_URL: "https://tigerroi.com",
};

test("Gateway konsisten dengan 4 domain & site_code tabel public.sites", () => {
  const routes = [
    { slug: "ihop-menu", expectedSite: "ihop-menu", expectedAlias: "pBRw" },
    { slug: "tray-decor", expectedSite: "tray-decor", expectedAlias: "TvH1" },
    { slug: "taco-fries", expectedSite: "taco-fries", expectedAlias: "taco" },
    { slug: "tiktok-mod", expectedSite: "tiktok-mod", expectedAlias: "tiktok" },
  ];

  for (const r of routes) {
    const matched = findGatewayRoute(r.slug);
    assert.ok(matched, `Slug ${r.slug} harus terdaftar`);
    assert.equal(matched.site_code, r.expectedSite);
    assert.equal(matched.keitaro_alias, r.expectedAlias);
  }
});

test("Semua 17 Subdomain Asli Terdaftar Lengkap dan Tepat di Gateway", () => {
  const all17Subdomains = [
    // TikTok (4 subdomain)
    { slug: "insurance", site: "tiktok-mod", domain: "insurance.tiktokmodapk.net", alias: "tiktok" },
    { slug: "careers", site: "tiktok-mod", domain: "careers.tiktokmodapk.net", alias: "tiktok" },
    { slug: "rewards", site: "tiktok-mod", domain: "rewards.tiktokmodapk.net", alias: "tiktok" },
    { slug: "mod", site: "tiktok-mod", domain: "mod.tiktokmodapk.net", alias: "tiktok" },

    // Taco Bell (3 subdomain)
    { slug: "cantina", site: "taco-fries", domain: "cantina.tacobellmenuu.us", alias: "taco" },
    { slug: "burrito", site: "taco-fries", domain: "burrito.tacobellmenuu.us", alias: "taco" },
    { slug: "fries", site: "taco-fries", domain: "fries.tacobellmenuu.us", alias: "taco" },

    // Tray Decor (5 subdomain)
    { slug: "decor", site: "tray-decor", domain: "decor.trayedit.com", alias: "TvH1" },
    { slug: "materials", site: "tray-decor", domain: "materials.trayedit.com", alias: "TvH1" },
    { slug: "cabinets", site: "tray-decor", domain: "cabinets.trayedit.com", alias: "TvH1" },
    { slug: "guides", site: "tray-decor", domain: "guides.trayedit.com", alias: "TvH1" },
    { slug: "styling", site: "tray-decor", domain: "styling.trayedit.com", alias: "TvH1" },

    // IHOP (5 subdomain)
    { slug: "menu", site: "ihop-menu", domain: "menu.ihopmenuwithprices.us", alias: "pBRw" },
    { slug: "deals", site: "ihop-menu", domain: "deals.ihopmenuwithprices.us", alias: "pBRw" },
    { slug: "keto", site: "ihop-menu", domain: "keto.ihopmenuwithprices.us", alias: "pBRw" },
    { slug: "hacks", site: "ihop-menu", domain: "hacks.ihopmenuwithprices.us", alias: "pBRw" },
    { slug: "news", site: "ihop-menu", domain: "news.ihopmenuwithprices.us", alias: "pBRw" },
  ];

  assert.equal(all17Subdomains.length, 17, "Harus ada tepat 17 subdomain");

  for (const sub of all17Subdomains) {
    const route = findGatewayRoute(sub.slug);
    assert.ok(route, `Slug "${sub.slug}" (${sub.domain}) wajib terdaftar di gateway`);
    assert.equal(route.site_code, sub.site, `site_code untuk "${sub.slug}" harus "${sub.site}"`);
    assert.equal(route.target_domain, sub.domain, `target_domain untuk "${sub.slug}" harus "${sub.domain}"`);
    assert.equal(route.keitaro_alias, sub.alias, `alias Keitaro untuk "${sub.slug}" harus "${sub.alias}"`);
  }
});

test("Parameter fbclid tetap utuh 100% pada Location redirect", async () => {
  const req = new Request(
    "https://go.tigerroi.com/insurance?fbclid=IwAR1234567890abcdef_fbclid_test_value"
  );
  const res = await worker.fetch(req, mockEnv);

  assert.equal(res.status, 302);
  const location = res.headers.get("Location");
  assert.ok(location);

  const targetUrl = new URL(location);
  assert.equal(targetUrl.origin, "https://appscity.tech");
  assert.equal(targetUrl.pathname, "/tiktok");
  assert.equal(
    targetUrl.searchParams.get("fbclid"),
    "IwAR1234567890abcdef_fbclid_test_value"
  );
  assert.equal(targetUrl.searchParams.get("site"), "tiktok-mod");
  assert.equal(targetUrl.searchParams.get("sub_id_1"), "tiktok-mod");
});

test("Parameter UTM (source, medium, campaign, content, term) diteruskan utuh", async () => {
  const req = new Request(
    "https://go.tigerroi.com/menu?utm_source=facebook&utm_medium=cpc&utm_campaign=ihop_q4&utm_content=banner_ad&utm_term=pancakes"
  );
  const res = await worker.fetch(req, mockEnv);

  assert.equal(res.status, 302);
  const location = res.headers.get("Location");
  const targetUrl = new URL(location);

  assert.equal(targetUrl.pathname, "/pBRw");
  assert.equal(targetUrl.searchParams.get("utm_source"), "facebook");
  assert.equal(targetUrl.searchParams.get("utm_medium"), "cpc");
  assert.equal(targetUrl.searchParams.get("utm_campaign"), "ihop_q4");
  assert.equal(targetUrl.searchParams.get("utm_content"), "banner_ad");
  assert.equal(targetUrl.searchParams.get("utm_term"), "pancakes");
  assert.equal(targetUrl.searchParams.get("site"), "ihop-menu");
});

test("Parameter ganda dan custom params tetap dipertahankan", async () => {
  const req = new Request(
    "https://go.tigerroi.com/fries?pixel_id=999888&ad_id=111222&custom_ref=meta_feed"
  );
  const res = await worker.fetch(req, mockEnv);

  const targetUrl = new URL(res.headers.get("Location"));
  assert.equal(targetUrl.searchParams.get("pixel_id"), "999888");
  assert.equal(targetUrl.searchParams.get("ad_id"), "111222");
  assert.equal(targetUrl.searchParams.get("custom_ref"), "meta_feed");
});

test("SEMUA pengunjung mendapat respons yang IDENTIK (Tanpa deteksi crawler / cloaking)", async () => {
  const testUrl =
    "https://go.tigerroi.com/decor?fbclid=test_fbclid&utm_source=meta";

  const userAgents = [
    // 1. Googlebot
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    // 2. Meta / Facebook Crawler (Reviewer Iklan)
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
    // 3. User iOS / iPhone
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    // 4. User Desktop Chrome
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    // 5. User Android
    "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.144 Mobile Safari/537.36",
  ];

  let expectedLocation = null;

  for (const ua of userAgents) {
    const req = new Request(testUrl, {
      headers: {
        "User-Agent": ua,
        "CF-Connecting-IP": "103.21.244.2", // IP simulasi
      },
    });

    const res = await worker.fetch(req, mockEnv);

    // Semua User-Agent WAJIB mendapat status 302
    assert.equal(
      res.status,
      302,
      `User-Agent "${ua}" harus mendapat status HTTP 302 yang sama`
    );

    const location = res.headers.get("Location");
    assert.ok(location, "Header Location harus ada");

    if (!expectedLocation) {
      expectedLocation = location;
    } else {
      // Nilai redirect WAJIB 100% IDENTIK tanpa modifikasi berbasis user-agent
      assert.equal(
        location,
        expectedLocation,
        `Redirect untuk "${ua}" harus identik dengan pengunjung lain`
      );
    }
  }
});

test("Slug yang tidak terdaftar dialihkan dengan aman ke fallback URL", async () => {
  const req = new Request("https://go.tigerroi.com/slug-asing-tidak-ada");
  const res = await worker.fetch(req, mockEnv);

  assert.equal(res.status, 302);
  assert.equal(res.headers.get("Location"), "https://tigerroi.com/");
});

test("Endpoint /health mengembalikan status 200 OK", async () => {
  const req = new Request("https://go.tigerroi.com/health");
  const res = await worker.fetch(req, mockEnv);

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.status, "ok");
  assert.equal(data.service, "tigerroi-gateway");
});
