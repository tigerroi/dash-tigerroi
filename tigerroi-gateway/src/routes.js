/**
 * Konfigurasi Pemetaan Gateway TigerROI (go.tigerroi.com/<slug>)
 *
 * Pemetaan resmi untuk 4 Domain Utama + 17 Subdomain WordPress TigerROI:
 * - site_code: Kode situs standar konsisten dengan tabel public.sites & ad unit GAM
 * - keitaro_alias: Alias kampanye di Keitaro tracker (https://appscity.tech/<alias>)
 * - target_domain: Hostname tujuan WordPress
 */

export const GATEWAY_ROUTES = {
  // ============================================================================
  // 1. TIKTOK MOD APK (tiktokmodapk.net) - site_code: tiktok-mod | alias: tiktok
  // ============================================================================
  "tiktok-mod": {
    site_code: "tiktok-mod",
    keitaro_alias: "tiktok",
    target_domain: "tiktokmodapk.net",
    description: "TikTok Mod APK - Root Domain",
  },
  tiktok: {
    site_code: "tiktok-mod",
    keitaro_alias: "tiktok",
    target_domain: "tiktokmodapk.net",
    description: "TikTok Short Slug",
  },
  // Subdomain 1
  insurance: {
    site_code: "tiktok-mod",
    keitaro_alias: "tiktok",
    target_domain: "insurance.tiktokmodapk.net",
    description: "Insurance Subdomain",
  },
  "tiktok-insurance": {
    site_code: "tiktok-mod",
    keitaro_alias: "tiktok",
    target_domain: "insurance.tiktokmodapk.net",
    description: "TikTok Insurance Full Slug",
  },
  // Subdomain 2
  careers: {
    site_code: "tiktok-mod",
    keitaro_alias: "tiktok",
    target_domain: "careers.tiktokmodapk.net",
    description: "Careers Subdomain",
  },
  "tiktok-careers": {
    site_code: "tiktok-mod",
    keitaro_alias: "tiktok",
    target_domain: "careers.tiktokmodapk.net",
    description: "TikTok Careers Full Slug",
  },
  // Subdomain 3
  rewards: {
    site_code: "tiktok-mod",
    keitaro_alias: "tiktok",
    target_domain: "rewards.tiktokmodapk.net",
    description: "Rewards Subdomain",
  },
  "tiktok-rewards": {
    site_code: "tiktok-mod",
    keitaro_alias: "tiktok",
    target_domain: "rewards.tiktokmodapk.net",
    description: "TikTok Rewards Full Slug",
  },
  // Subdomain 4
  mod: {
    site_code: "tiktok-mod",
    keitaro_alias: "tiktok",
    target_domain: "mod.tiktokmodapk.net",
    description: "Mod Subdomain",
  },
  "tiktok-apk": {
    site_code: "tiktok-mod",
    keitaro_alias: "tiktok",
    target_domain: "mod.tiktokmodapk.net",
    description: "TikTok Mod APK Subdomain",
  },

  // ============================================================================
  // 2. TACO BELL MENU (tacobellmenuu.us) - site_code: taco-fries | alias: taco
  // ============================================================================
  "taco-fries": {
    site_code: "taco-fries",
    keitaro_alias: "taco",
    target_domain: "tacobellmenuu.us",
    description: "Taco Bell Menu - Root Domain",
  },
  taco: {
    site_code: "taco-fries",
    keitaro_alias: "taco",
    target_domain: "tacobellmenuu.us",
    description: "Taco Short Slug",
  },
  tacobell: {
    site_code: "taco-fries",
    keitaro_alias: "taco",
    target_domain: "tacobellmenuu.us",
    description: "Taco Bell Full Slug",
  },
  // Subdomain 5
  cantina: {
    site_code: "taco-fries",
    keitaro_alias: "taco",
    target_domain: "cantina.tacobellmenuu.us",
    description: "Cantina Subdomain",
  },
  "taco-cantina": {
    site_code: "taco-fries",
    keitaro_alias: "taco",
    target_domain: "cantina.tacobellmenuu.us",
    description: "Taco Cantina Full Slug",
  },
  // Subdomain 6
  burrito: {
    site_code: "taco-fries",
    keitaro_alias: "taco",
    target_domain: "burrito.tacobellmenuu.us",
    description: "Burrito Subdomain",
  },
  "grilledcheeseburrito": {
    site_code: "taco-fries",
    keitaro_alias: "taco",
    target_domain: "burrito.tacobellmenuu.us",
    description: "Grilled Cheese Burrito Subdomain",
  },
  "taco-burrito": {
    site_code: "taco-fries",
    keitaro_alias: "taco",
    target_domain: "burrito.tacobellmenuu.us",
    description: "Taco Burrito Full Slug",
  },
  // Subdomain 7
  fries: {
    site_code: "taco-fries",
    keitaro_alias: "taco",
    target_domain: "fries.tacobellmenuu.us",
    description: "Fries Subdomain",
  },
  "nacho-fries": {
    site_code: "taco-fries",
    keitaro_alias: "taco",
    target_domain: "fries.tacobellmenuu.us",
    description: "Taco Nacho Fries Subdomain",
  },

  // ============================================================================
  // 3. TRAY DECOR (trayedit.com) - site_code: tray-decor | alias: TvH1
  // ============================================================================
  "tray-decor": {
    site_code: "tray-decor",
    keitaro_alias: "TvH1",
    target_domain: "trayedit.com",
    description: "Tray Decor - Root Domain",
  },
  tray: {
    site_code: "tray-decor",
    keitaro_alias: "TvH1",
    target_domain: "trayedit.com",
    description: "Tray Short Slug",
  },
  // Subdomain 8
  decor: {
    site_code: "tray-decor",
    keitaro_alias: "TvH1",
    target_domain: "decor.trayedit.com",
    description: "Decor Subdomain",
  },
  "decor-ideas": {
    site_code: "tray-decor",
    keitaro_alias: "TvH1",
    target_domain: "decor.trayedit.com",
    description: "Decor Ideas Full Slug",
  },
  // Subdomain 9
  materials: {
    site_code: "tray-decor",
    keitaro_alias: "TvH1",
    target_domain: "materials.trayedit.com",
    description: "Materials Subdomain",
  },
  "tray-materials": {
    site_code: "tray-decor",
    keitaro_alias: "TvH1",
    target_domain: "materials.trayedit.com",
    description: "Tray Materials Full Slug",
  },
  // Subdomain 10
  cabinets: {
    site_code: "tray-decor",
    keitaro_alias: "TvH1",
    target_domain: "cabinets.trayedit.com",
    description: "Cabinets Subdomain",
  },
  "tray-cabinets": {
    site_code: "tray-decor",
    keitaro_alias: "TvH1",
    target_domain: "cabinets.trayedit.com",
    description: "Tray Cabinets Full Slug",
  },
  // Subdomain 11
  guides: {
    site_code: "tray-decor",
    keitaro_alias: "TvH1",
    target_domain: "guides.trayedit.com",
    description: "Guides Subdomain",
  },
  "tray-guides": {
    site_code: "tray-decor",
    keitaro_alias: "TvH1",
    target_domain: "guides.trayedit.com",
    description: "Tray Guides Full Slug",
  },
  // Subdomain 12
  styling: {
    site_code: "tray-decor",
    keitaro_alias: "TvH1",
    target_domain: "styling.trayedit.com",
    description: "Styling Subdomain",
  },
  "tray-styling": {
    site_code: "tray-decor",
    keitaro_alias: "TvH1",
    target_domain: "styling.trayedit.com",
    description: "Tray Styling Full Slug",
  },

  // ============================================================================
  // 4. IHOP MENU PRICES (ihopmenuwithprices.us) - site_code: ihop-menu | alias: pBRw
  // ============================================================================
  "ihop-menu": {
    site_code: "ihop-menu",
    keitaro_alias: "pBRw",
    target_domain: "ihopmenuwithprices.us",
    description: "IHOP Menu Prices - Root Domain",
  },
  ihop: {
    site_code: "ihop-menu",
    keitaro_alias: "pBRw",
    target_domain: "ihopmenuwithprices.us",
    description: "IHOP Short Slug",
  },
  // Subdomain 13
  menu: {
    site_code: "ihop-menu",
    keitaro_alias: "pBRw",
    target_domain: "menu.ihopmenuwithprices.us",
    description: "Menu Subdomain",
  },
  "ihop-full-menu": {
    site_code: "ihop-menu",
    keitaro_alias: "pBRw",
    target_domain: "menu.ihopmenuwithprices.us",
    description: "IHOP Full Menu Slug",
  },
  // Subdomain 14
  deals: {
    site_code: "ihop-menu",
    keitaro_alias: "pBRw",
    target_domain: "deals.ihopmenuwithprices.us",
    description: "Deals Subdomain",
  },
  "ihop-deals": {
    site_code: "ihop-menu",
    keitaro_alias: "pBRw",
    target_domain: "deals.ihopmenuwithprices.us",
    description: "IHOP Deals Full Slug",
  },
  // Subdomain 15
  keto: {
    site_code: "ihop-menu",
    keitaro_alias: "pBRw",
    target_domain: "keto.ihopmenuwithprices.us",
    description: "Keto Subdomain",
  },
  "ihop-keto": {
    site_code: "ihop-menu",
    keitaro_alias: "pBRw",
    target_domain: "keto.ihopmenuwithprices.us",
    description: "IHOP Keto Full Slug",
  },
  // Subdomain 16
  hacks: {
    site_code: "ihop-menu",
    keitaro_alias: "pBRw",
    target_domain: "hacks.ihopmenuwithprices.us",
    description: "Hacks Subdomain",
  },
  "ihop-hacks": {
    site_code: "ihop-menu",
    keitaro_alias: "pBRw",
    target_domain: "hacks.ihopmenuwithprices.us",
    description: "IHOP Hacks Full Slug",
  },
  // Subdomain 17
  news: {
    site_code: "ihop-menu",
    keitaro_alias: "pBRw",
    target_domain: "news.ihopmenuwithprices.us",
    description: "News Subdomain",
  },
  "ihop-news": {
    site_code: "ihop-menu",
    keitaro_alias: "pBRw",
    target_domain: "news.ihopmenuwithprices.us",
    description: "IHOP News Full Slug",
  },
};

/**
 * Mencari rute gateway berdasarkan slug URL
 */
export function findGatewayRoute(slug) {
  if (!slug) return null;
  const clean = String(slug).toLowerCase().trim().replace(/^\/+|\/+$/g, "");
  return GATEWAY_ROUTES[clean] || null;
}
