/**
 * Cloudflare Worker: TigerROI Gateway (go.tigerroi.com/<slug>)
 *
 * Mendukung 2 Mode Fleksibel:
 * - Mode A (SEBELUM Keitaro): /eat ➔ filter bot ➔ Keitaro (https://appscity.tech/8f9fdwdM?city=[tech])
 * - Mode B (SETELAH Keitaro): /to-wp/eat ➔ filter bot ➔ WordPress (https://eat.foodsfact.org)
 *
 * Proteksi Traffic Kualitas: Mengalihkan Bot & Scraper Liar ke YouTube agar Akun GAM Bebas dari Ad Limit.
 * Endpoint Monitoring: /api/blocked mengembalikan log IP yang diblokir/dilempar ke YouTube.
 */

import { findGatewayRoute } from "./routes.js";

/**
 * Daftar Video YouTube Pengaman (Bot Trap Fallbacks)
 * Permintaan dari Mas Def untuk mengalihkan bot/scraper ke YouTube
 */
export const YOUTUBE_BOT_TRAPS = [
  "https://youtu.be/3DdYl026Z6k?si=MnYlzwam7degVmE_",
  "https://youtu.be/AUgL4y3G9Vg?si=zRrgx3zPre7vEVVA",
  "https://youtu.be/lb7ctVNBRV0?si=ug4KsEXFLHBFs-zM",
  "https://youtu.be/7Z1bEhzIxFc?si=_duj16uN0QPoMCfT",
  "https://youtu.be/EQGSwZDZ3Ts?si=_xINNlx6i7fQAXJK",
];

export function getRandomYouTubeTrap(env = {}) {
  if (env.BOT_FALLBACK_URL) return env.BOT_FALLBACK_URL;
  const index = Math.floor(Math.random() * YOUTUBE_BOT_TRAPS.length);
  return YOUTUBE_BOT_TRAPS[index];
}

// Log IP terblokir di in-memory worker
export const BLOCKED_LOGS = [
  {
    id: "seed-1",
    time: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
    ip: "114.122.14.88",
    country: "ID",
    slug: "/eat",
    reason: "Akses Langsung Tanpa Parameter Iklan Meta",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0",
    redirectedTo: "https://youtu.be/EQGSwZDZ3Ts",
  },
  {
    id: "seed-2",
    time: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
    ip: "52.167.144.92",
    country: "US",
    slug: "/eat",
    reason: "Bot Scraper / Headless Crawler",
    userAgent: "curl/8.9.1 (Automated Script)",
    redirectedTo: "https://youtu.be/AUgL4y3G9Vg",
  },
];

export function recordBlockedIp(request, slug, reason, targetYouTube) {
  const ip =
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-real-ip") ||
    request.headers.get("x-forwarded-for") ||
    "114.122.14.88";
  const country =
    request.headers.get("cf-ipcountry") ||
    request.cf?.country ||
    "ID";
  const userAgent = request.headers.get("user-agent") || "Direct Browser";

  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    time: new Date().toISOString(),
    ip,
    country,
    slug: `/${slug}`,
    reason,
    userAgent: userAgent.slice(0, 120),
    redirectedTo: targetYouTube,
  };

  BLOCKED_LOGS.unshift(entry);
  if (BLOCKED_LOGS.length > 50) {
    BLOCKED_LOGS.pop();
  }
}

export default {
  async fetch(request, env = {}) {
    const url = new URL(request.url);
    const cleanPath = url.pathname.replace(/^\/+|\/+$/g, "");
    const pathParts = cleanPath.split("/");

    let isDirectToWp = false;
    let slug = pathParts[0] || "";
    if (slug === "to-wp" || slug === "wp") {
      isDirectToWp = true;
      slug = pathParts[1] || "";
    }

    // 1. Endpoint Health Check & Status Monitoring
    if (slug === "health" || slug === "_health" || slug === "api/status") {
      return new Response(
        JSON.stringify({
          status: "ok",
          service: "tigerroi-gateway",
          worker: "visint-gating",
          version: "1.5.0",
          timestamp: new Date().toISOString(),
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
          },
        },
      );
    }

    // 2. Endpoint Log IP Terblokir untuk Dashboard
    if (slug === "blocked" || slug === "api/blocked" || (slug === "api" && pathParts[1] === "blocked")) {
      return new Response(
        JSON.stringify({
          status: "ok",
          service: "tigerroi-gateway",
          total: BLOCKED_LOGS.length,
          items: BLOCKED_LOGS,
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
          },
        },
      );
    }

    // 3. Endpoint robots.txt (Mencegah pengindeksan gateway)
    if (slug === "robots.txt") {
      return new Response("User-agent: *\nDisallow: /\n", {
        status: 200,
        headers: {
          "Content-Type": "text/plain",
          "Cache-Control": "public, max-age=86400",
        },
      });
    }

    const fallbackUrl = env.FALLBACK_URL || "https://tigerroi.com";

    // 4. Root Path (/) dialihkan ke fallback resmi
    if (!slug) {
      return Response.redirect(fallbackUrl, 302);
    }

    // 5. Cari pemetaan rute berdasarkan slug
    const route = findGatewayRoute(slug);
    if (!route) {
      // Jika slug tidak dikenal, redirect ke fallback
      return Response.redirect(fallbackUrl, 302);
    }

    // 6. Proteksi Bot Liar (Traffic Quality Filter Anti-Limit GAM)
    const userAgent = request.headers.get("user-agent") || "";
    const isBotSignature =
      /bot|crawl|spider|scraper|headless|curl|wget|python|httpclient|postman|bytespider|semrush|ahrefs|mj12bot|dotbot|petalbot|yandex|censys|shodan/i.test(
        userAgent,
      );
    const isOfficialCrawler =
      /facebookexternalhit|Facebot|Googlebot|AdsBot-Google/i.test(userAgent);
    const hasAdClickId =
      url.searchParams.has("fbclid") ||
      url.searchParams.has("gclid") ||
      url.searchParams.has("utm_source") ||
      url.searchParams.has("pixel_id") ||
      url.searchParams.has("ad_id") ||
      url.searchParams.has("custom_ref") ||
      url.searchParams.has("sub_id") ||
      url.searchParams.has("city") ||
      url.searchParams.has("preview");

    // Jika terdeteksi bot scraper liar ATAU pengunjung tanpa parameter iklan resmi Meta/Google:
    // Lempar langsung ke YouTube (sesuai arahan Mas Def) dan catat di log IP
    if (isBotSignature && !isOfficialCrawler) {
      const trap = getRandomYouTubeTrap(env);
      recordBlockedIp(request, slug, "Bot Scraper / Crawler Terdeteksi", trap);
      return Response.redirect(trap, 302);
    }
    if (!isOfficialCrawler && !hasAdClickId) {
      const trap = getRandomYouTubeTrap(env);
      recordBlockedIp(request, slug, "Akses Tanpa Parameter Iklan Meta", trap);
      return Response.redirect(trap, 302);
    }

    // 7. Bangun URL Tujuan: Keitaro (Sebelum) ATAU WordPress Hetzner (Setelah)
    let targetUrl;
    if (isDirectToWp) {
      // Mode B (Visint SETELAH Keitaro): Diteruskan dari Keitaro ke Visint, lalu ke WordPress
      targetUrl = new URL(`https://${route.target_domain}`);
    } else {
      // Mode A (Visint SEBELUM Keitaro): Pengunjung buka Visint, lalu diteruskan ke Keitaro
      const keitaroBase = (env.KEITARO_BASE_URL || "https://appscity.tech").replace(/\/+$/, "");
      targetUrl = new URL(`${keitaroBase}/${route.keitaro_alias}`);
      if (!targetUrl.searchParams.has("city")) {
        targetUrl.searchParams.set("city", "[tech]");
      }
    }

    // 8. Teruskan SELURUH Query Parameter asli (fbclid, UTM, dll) secara utuh
    for (const [key, val] of url.searchParams.entries()) {
      targetUrl.searchParams.append(key, val);
    }

    // 9. Pastikan parameter site_code dan sub_id ada jika belum didefinisikan
    if (!targetUrl.searchParams.has("site") && !targetUrl.searchParams.has("sub_id")) {
      targetUrl.searchParams.set("site", route.site_code);
    }
    if (!targetUrl.searchParams.has("sub_id_1")) {
      targetUrl.searchParams.set("sub_id_1", route.site_code);
    }

    // 10. Kirim HTTP 302 Redirect
    return new Response(null, {
      status: 302,
      headers: {
        Location: targetUrl.toString(),
        "Cache-Control": "no-store, no-cache, must-revalidate",
        Pragma: "no-cache",
        "X-Gateway-Site": route.site_code,
      },
    });
  },
};
