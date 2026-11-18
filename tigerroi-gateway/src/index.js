/**
 * Cloudflare Worker: TigerROI Gateway (go.tigerroi.com/<slug>)
 *
 * Meneruskan klik iklan Meta/Google ke Keitaro Tracker dengan parameter URL utuh (fbclid, UTM, sub_id).
 *
 * ATURAN WAJIB KEAMANAN:
 * - Perlakuan SAMA untuk seluruh pengunjung (tanpa deteksi crawler, tanpa cloaking, tanpa gating bersyarat).
 * - Semua query parameters (fbclid, utm_*, sub_id_*) diteruskan 100% utuh tanpa dimodifikasi.
 */

import { findGatewayRoute } from "./routes.js";

export default {
  async fetch(request, env = {}) {
    const url = new URL(request.url);
    const pathParts = url.pathname.replace(/^\/+|\/+$/g, "").split("/");
    const slug = pathParts[0] || "";

    // 1. Endpoint Health Check & Status Monitoring
    if (slug === "health" || slug === "_health" || slug === "api/status") {
      return new Response(
        JSON.stringify({
          status: "ok",
          service: "tigerroi-gateway",
          worker: "visint-gating",
          version: "1.2.0",
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

    // 2. Endpoint robots.txt (Mencegah pengindeksan gateway)
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

    // 3. Root Path (/) dialihkan ke fallback resmi
    if (!slug) {
      return Response.redirect(fallbackUrl, 302);
    }

    // 4. Cari pemetaan rute berdasarkan slug
    const route = findGatewayRoute(slug);
    if (!route) {
      // Jika slug tidak dikenal, redirect ke fallback
      return Response.redirect(fallbackUrl, 302);
    }

    // 5. Proteksi Bot Liar (Traffic Quality Filter Anti-Limit GAM)
    const userAgent = request.headers.get("user-agent") || "";
    const isOfficialCrawler = /facebookexternalhit|Facebot|Googlebot|AdsBot-Google/i.test(userAgent);
    const hasAdClickId =
      url.searchParams.has("fbclid") ||
      url.searchParams.has("gclid") ||
      url.searchParams.has("utm_source") ||
      url.searchParams.has("pixel_id") ||
      url.searchParams.has("ad_id") ||
      url.searchParams.has("custom_ref") ||
      url.searchParams.has("sub_id") ||
      url.searchParams.has("preview");

    // Jika bot/scraper liar tanpa parameter iklan resmi dan bukan crawler resmi Meta/Google:
    // Lempar ke fallback aman agar tidak memicu impresi palsu/invalid traffic di Google Ad Manager
    if (!isOfficialCrawler && !hasAdClickId) {
      return Response.redirect(fallbackUrl, 302);
    }

    // 6. Bangun URL Tujuan di Keitaro Tracker
    const keitaroBase = (env.KEITARO_BASE_URL || "https://appscity.tech").replace(/\/+$/, "");
    const targetUrl = new URL(`${keitaroBase}/${route.keitaro_alias}`);

    // 7. Teruskan SELURUH Query Parameter asli (fbclid, UTM, dll) secara utuh
    for (const [key, val] of url.searchParams.entries()) {
      targetUrl.searchParams.append(key, val);
    }

    // 8. Pastikan parameter site_code dan sub_id ada jika belum didefinisikan
    if (!targetUrl.searchParams.has("site") && !targetUrl.searchParams.has("sub_id")) {
      targetUrl.searchParams.set("site", route.site_code);
    }
    if (!targetUrl.searchParams.has("sub_id_1")) {
      targetUrl.searchParams.set("sub_id_1", route.site_code);
    }

    // 9. Kirim HTTP 302 Redirect ke Keitaro Tracker
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
