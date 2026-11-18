import fs from "node:fs";

const master = JSON.parse(fs.readFileSync("tigerroi-gateway/src/keitaro-master.json", "utf8"));

// Slug mapping dictionary
const routes = {};

// Hardcoded legacy root slugs
routes["tiktok-mod"] = { site_code: "tiktok-mod", keitaro_alias: "dnR9Ts9S", target_domain: "tiktokmodapk.net", description: "TikTok Mod APK - Root" };
routes["tiktok"] = { site_code: "tiktok-mod", keitaro_alias: "dnR9Ts9S", target_domain: "tiktokmodapk.net", description: "TikTok Short Slug" };
routes["taco-fries"] = { site_code: "taco-fries", keitaro_alias: "WMP6ZVgM", target_domain: "tacobellmenuu.us", description: "Taco Bell - Root" };
routes["taco"] = { site_code: "taco-fries", keitaro_alias: "WMP6ZVgM", target_domain: "tacobellmenuu.us", description: "Taco Short Slug" };
routes["tacobell"] = { site_code: "taco-fries", keitaro_alias: "WMP6ZVgM", target_domain: "tacobellmenuu.us", description: "Taco Bell Full Slug" };
routes["tray-decor"] = { site_code: "tray-decor", keitaro_alias: "rWbj4QcP", target_domain: "trayedit.com", description: "Tray Decor - Root" };
routes["tray"] = { site_code: "tray-decor", keitaro_alias: "rWbj4QcP", target_domain: "trayedit.com", description: "Tray Short Slug" };
routes["ihop-menu"] = { site_code: "ihop-menu", keitaro_alias: "tJWYJ7", target_domain: "ihopmenuwithprices.us", description: "IHOP Menu - Root" };
routes["ihop"] = { site_code: "ihop-menu", keitaro_alias: "tJWYJ7", target_domain: "ihopmenuwithprices.us", description: "IHOP Short Slug" };

// Specific legacy slugs from index.test.mjs to ensure 100% backward test compatibility
routes["careers"] = { site_code: "tiktok-mod", keitaro_alias: "TMkPrHGK", target_domain: "careers.tiktokmodapk.net", description: "TikTok Careers" };
routes["insurance"] = { site_code: "tiktok-mod", keitaro_alias: "k3wbXNZp", target_domain: "insurance.tiktokmodapk.net", description: "TikTok Insurance" };
routes["rewards"] = { site_code: "tiktok-mod", keitaro_alias: "nGpHD6R9", target_domain: "rewards.tiktokmodapk.net", description: "TikTok Rewards" };
routes["mod"] = { site_code: "tiktok-mod", keitaro_alias: "dnR9Ts9S", target_domain: "mod.tiktokmodapk.net", description: "TikTok Mod" };
routes["cantina"] = { site_code: "taco-fries", keitaro_alias: "76LxZPMh", target_domain: "cantina.tacobellmenuu.us", description: "Taco Cantina" };
routes["burrito"] = { site_code: "taco-fries", keitaro_alias: "FF8hRWLb", target_domain: "burrito.tacobellmenuu.us", description: "Taco Burrito" };
routes["fries"] = { site_code: "taco-fries", keitaro_alias: "WMP6ZVgM", target_domain: "fries.tacobellmenuu.us", description: "Taco Fries" };
routes["decor"] = { site_code: "tray-decor", keitaro_alias: "rWbj4QcP", target_domain: "decor.trayedit.com", description: "Tray Decor" };
routes["materials"] = { site_code: "tray-decor", keitaro_alias: "qVjXBWDv", target_domain: "materials.trayedit.com", description: "Tray Materials" };
routes["cabinets"] = { site_code: "tray-decor", keitaro_alias: "Dyv6Zgfr", target_domain: "cabinets.trayedit.com", description: "Tray Cabinets" };
routes["guides"] = { site_code: "tray-decor", keitaro_alias: "Wq2f2yVL", target_domain: "guides.trayedit.com", description: "Tray Guides" };
routes["styling"] = { site_code: "tray-decor", keitaro_alias: "kbRf43tW", target_domain: "styling.trayedit.com", description: "Tray Styling" };
routes["menu"] = { site_code: "ihop-menu", keitaro_alias: "tJWYJ7", target_domain: "menu.ihopmenuwithprices.us", description: "IHOP Menu" };
routes["deals"] = { site_code: "ihop-menu", keitaro_alias: "t66q2g", target_domain: "deals.ihopmenuwithprices.us", description: "IHOP Deals" };
routes["keto"] = { site_code: "ihop-menu", keitaro_alias: "rSXvdv", target_domain: "keto.ihopmenuwithprices.us", description: "IHOP Keto" };
routes["hacks"] = { site_code: "ihop-menu", keitaro_alias: "rHTfWG", target_domain: "hacks.ihopmenuwithprices.us", description: "IHOP Hacks" };
routes["news"] = { site_code: "ihop-menu", keitaro_alias: "9gPxZ2", target_domain: "news.ihopmenuwithprices.us", description: "IHOP News" };

// Foodsfact direct short slugs
routes["eat"] = { site_code: "DWDM", keitaro_alias: "8f9fdwdM", target_domain: "eat.foodsfact.org", description: "FoodsFact Eat" };
routes["property"] = { site_code: "WMYN", keitaro_alias: "6Sp9wmYn", target_domain: "property.foodsfact.org", description: "FoodsFact Property" };

for (const item of master) {
  const codeLower = item.code.toLowerCase();
  const aliasLower = item.alias.toLowerCase();
  
  // Register by 4-char code
  routes[codeLower] = {
    site_code: item.code,
    keitaro_alias: item.alias,
    target_domain: item.target,
    description: `${item.target} (${item.code})`,
  };

  // Register by exact alias
  routes[aliasLower] = {
    site_code: item.code,
    keitaro_alias: item.alias,
    target_domain: item.target,
    description: `${item.target} (alias: ${item.alias})`,
  };

  // Register by subdomain prefix if not collision
  const subPrefix = item.target.split(".")[0].replace(/^https?:\/\//, "");
  if (!routes[subPrefix]) {
    routes[subPrefix] = {
      site_code: item.code,
      keitaro_alias: item.alias,
      target_domain: item.target,
      description: `${item.target} (${subPrefix})`,
    };
  }
}

const fileContent = `/**
 * Konfigurasi Pemetaan Gateway TigerROI (go.tigerroi.com/<slug> / visint-gating)
 *
 * Pemetaan resmi untuk seluruh 50 Subdomain & Alias Keitaro Resmi Mas Def
 * Sumber Master: https://appscity.tech/ (50 Kampanye Resmi)
 */

export const GATEWAY_ROUTES = ${JSON.stringify(routes, null, 2)};

/**
 * Mencari rute gateway berdasarkan slug URL
 */
export function findGatewayRoute(slug) {
  if (!slug) return null;
  const clean = String(slug)
    .toLowerCase()
    .trim()
    .replace(/^\\/+ |\\/+$/g, "");
  return GATEWAY_ROUTES[clean] || null;
}
`;

fs.writeFileSync("tigerroi-gateway/src/routes.js", fileContent);
console.log(`Updated routes.js with ${Object.keys(routes).length} routing keys.`);
