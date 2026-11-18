/**
 * Konfigurasi Pemetaan Gateway TigerROI (go.tigerroi.com/<slug> / visint-gating)
 *
 * Pemetaan resmi untuk 9 Domain Utama & 45 Subdomain WordPress TigerROI:
 * Mendukung Slug Subdomain dan Kode Campaign Keitaro 4-Karakter (https://appscity.tech/<alias>)
 */

export const GATEWAY_ROUTES = {
  // ============================================================================
  // 1. TIKTOK MOD APK (tiktokmodapk.net) - site_code: tiktok-mod | alias: tiktok
  // ============================================================================
  "tiktok-mod": { site_code: "tiktok-mod", keitaro_alias: "tiktok", target_domain: "tiktokmodapk.net", description: "TikTok Mod APK - Root Domain" },
  tiktok: { site_code: "tiktok-mod", keitaro_alias: "tiktok", target_domain: "tiktokmodapk.net", description: "TikTok Short Slug" },
  insurance: { site_code: "tiktok-mod", keitaro_alias: "tiktok", target_domain: "insurance.tiktokmodapk.net", description: "Insurance Subdomain" },
  "tiktok-insurance": { site_code: "tiktok-mod", keitaro_alias: "tiktok", target_domain: "insurance.tiktokmodapk.net", description: "TikTok Insurance Full Slug" },
  careers: { site_code: "tiktok-mod", keitaro_alias: "tiktok", target_domain: "careers.tiktokmodapk.net", description: "Careers Subdomain" },
  "tiktok-careers": { site_code: "tiktok-mod", keitaro_alias: "tiktok", target_domain: "careers.tiktokmodapk.net", description: "TikTok Careers Full Slug" },
  rewards: { site_code: "tiktok-mod", keitaro_alias: "tiktok", target_domain: "rewards.tiktokmodapk.net", description: "Rewards Subdomain" },
  "tiktok-rewards": { site_code: "tiktok-mod", keitaro_alias: "tiktok", target_domain: "rewards.tiktokmodapk.net", description: "TikTok Rewards Full Slug" },
  mod: { site_code: "tiktok-mod", keitaro_alias: "tiktok", target_domain: "mod.tiktokmodapk.net", description: "Mod Subdomain" },
  "tiktok-apk": { site_code: "tiktok-mod", keitaro_alias: "tiktok", target_domain: "mod.tiktokmodapk.net", description: "TikTok Mod APK Subdomain" },

  // ============================================================================
  // 2. TACO BELL MENU (tacobellmenuu.us) - site_code: taco-fries | alias: taco
  // ============================================================================
  "taco-fries": { site_code: "taco-fries", keitaro_alias: "taco", target_domain: "tacobellmenuu.us", description: "Taco Bell Menu - Root Domain" },
  taco: { site_code: "taco-fries", keitaro_alias: "taco", target_domain: "tacobellmenuu.us", description: "Taco Short Slug" },
  tacobell: { site_code: "taco-fries", keitaro_alias: "taco", target_domain: "tacobellmenuu.us", description: "Taco Bell Full Slug" },
  cantina: { site_code: "taco-fries", keitaro_alias: "taco", target_domain: "cantina.tacobellmenuu.us", description: "Cantina Subdomain" },
  "taco-cantina": { site_code: "taco-fries", keitaro_alias: "taco", target_domain: "cantina.tacobellmenuu.us", description: "Taco Cantina Full Slug" },
  burrito: { site_code: "taco-fries", keitaro_alias: "taco", target_domain: "burrito.tacobellmenuu.us", description: "Burrito Subdomain" },
  "taco-burrito": { site_code: "taco-fries", keitaro_alias: "taco", target_domain: "burrito.tacobellmenuu.us", description: "Taco Burrito Full Slug" },
  grilledcheeseburrito: { site_code: "taco-fries", keitaro_alias: "taco", target_domain: "burrito.tacobellmenuu.us", description: "Grilled Cheese Burrito Subdomain" },
  fries: { site_code: "taco-fries", keitaro_alias: "taco", target_domain: "fries.tacobellmenuu.us", description: "Fries Subdomain" },
  "nacho-fries": { site_code: "taco-fries", keitaro_alias: "taco", target_domain: "fries.tacobellmenuu.us", description: "Taco Nacho Fries Subdomain" },
  // Slug Langsung Kode Keitaro Taco Bell (Cb3K, DFNQ, RWLB, ZPMH, ZVGM)
  cb3k: { site_code: "taco-fries", keitaro_alias: "Cb3K", target_domain: "news.tacobellmenuu.us", description: "Taco Bell News (Cb3K)" },
  dfnq: { site_code: "taco-fries", keitaro_alias: "DFNQ", target_domain: "finance.tacobellmenuu.us", description: "Taco Bell Finance (DFNQ)" },
  rwlb: { site_code: "taco-fries", keitaro_alias: "RWLB", target_domain: "burrito.tacobellmenuu.us", description: "Taco Bell Burrito (RWLB)" },
  zpmh: { site_code: "taco-fries", keitaro_alias: "ZPMH", target_domain: "cantina.tacobellmenuu.us", description: "Taco Bell Cantina (ZPMH)" },
  zvgm: { site_code: "taco-fries", keitaro_alias: "ZVGM", target_domain: "fries.tacobellmenuu.us", description: "Taco Bell Fries (ZVGM)" },

  // ============================================================================
  // 3. TRAY DECOR (trayedit.com) - site_code: tray-decor | alias: TvH1
  // ============================================================================
  "tray-decor": { site_code: "tray-decor", keitaro_alias: "TvH1", target_domain: "trayedit.com", description: "Tray Decor - Root Domain" },
  tray: { site_code: "tray-decor", keitaro_alias: "TvH1", target_domain: "trayedit.com", description: "Tray Short Slug" },
  decor: { site_code: "tray-decor", keitaro_alias: "TvH1", target_domain: "decor.trayedit.com", description: "Decor Subdomain" },
  "decor-ideas": { site_code: "tray-decor", keitaro_alias: "TvH1", target_domain: "decor.trayedit.com", description: "Decor Ideas Full Slug" },
  materials: { site_code: "tray-decor", keitaro_alias: "TvH1", target_domain: "materials.trayedit.com", description: "Materials Subdomain" },
  "tray-materials": { site_code: "tray-decor", keitaro_alias: "TvH1", target_domain: "materials.trayedit.com", description: "Tray Materials Full Slug" },
  cabinets: { site_code: "tray-decor", keitaro_alias: "TvH1", target_domain: "cabinets.trayedit.com", description: "Cabinets Subdomain" },
  "tray-cabinets": { site_code: "tray-decor", keitaro_alias: "TvH1", target_domain: "cabinets.trayedit.com", description: "Tray Cabinets Full Slug" },
  guides: { site_code: "tray-decor", keitaro_alias: "TvH1", target_domain: "guides.trayedit.com", description: "Guides Subdomain" },
  "tray-guides": { site_code: "tray-decor", keitaro_alias: "TvH1", target_domain: "guides.trayedit.com", description: "Tray Guides Full Slug" },
  styling: { site_code: "tray-decor", keitaro_alias: "TvH1", target_domain: "styling.trayedit.com", description: "Styling Subdomain" },
  "tray-styling": { site_code: "tray-decor", keitaro_alias: "TvH1", target_domain: "styling.trayedit.com", description: "Tray Styling Full Slug" },
  // Slug Langsung Kode Keitaro Tray Edit (2yVL, 4QcP, 43TW, BWDv, ZGFR)
  "2yvl": { site_code: "tray-decor", keitaro_alias: "2yVL", target_domain: "guides.trayedit.com", description: "Tray Guides (2yVL)" },
  "4qcp": { site_code: "tray-decor", keitaro_alias: "4QcP", target_domain: "decor.trayedit.com", description: "Tray Decor (4QcP)" },
  "43tw": { site_code: "tray-decor", keitaro_alias: "43TW", target_domain: "styling.trayedit.com", description: "Tray Styling (43TW)" },
  bwdv: { site_code: "tray-decor", keitaro_alias: "BWDv", target_domain: "materials.trayedit.com", description: "Tray Materials (BWDv)" },
  zgfr: { site_code: "tray-decor", keitaro_alias: "ZGFR", target_domain: "cabinets.trayedit.com", description: "Tray Cabinets (ZGFR)" },

  // ============================================================================
  // 4. IHOP MENU PRICES (ihopmenuwithprices.us) - site_code: ihop-menu | alias: pBRw
  // ============================================================================
  "ihop-menu": { site_code: "ihop-menu", keitaro_alias: "pBRw", target_domain: "ihopmenuwithprices.us", description: "IHOP Menu Prices - Root Domain" },
  ihop: { site_code: "ihop-menu", keitaro_alias: "pBRw", target_domain: "ihopmenuwithprices.us", description: "IHOP Short Slug" },
  menu: { site_code: "ihop-menu", keitaro_alias: "pBRw", target_domain: "menu.ihopmenuwithprices.us", description: "Menu Subdomain" },
  "ihop-full-menu": { site_code: "ihop-menu", keitaro_alias: "pBRw", target_domain: "menu.ihopmenuwithprices.us", description: "IHOP Full Menu Slug" },
  deals: { site_code: "ihop-menu", keitaro_alias: "pBRw", target_domain: "deals.ihopmenuwithprices.us", description: "Deals Subdomain" },
  "ihop-deals": { site_code: "ihop-menu", keitaro_alias: "pBRw", target_domain: "deals.ihopmenuwithprices.us", description: "IHOP Deals Full Slug" },
  keto: { site_code: "ihop-menu", keitaro_alias: "pBRw", target_domain: "keto.ihopmenuwithprices.us", description: "Keto Subdomain" },
  "ihop-keto": { site_code: "ihop-menu", keitaro_alias: "pBRw", target_domain: "keto.ihopmenuwithprices.us", description: "IHOP Keto Full Slug" },
  hacks: { site_code: "ihop-menu", keitaro_alias: "pBRw", target_domain: "hacks.ihopmenuwithprices.us", description: "Hacks Subdomain" },
  "ihop-hacks": { site_code: "ihop-menu", keitaro_alias: "pBRw", target_domain: "hacks.ihopmenuwithprices.us", description: "IHOP Hacks Full Slug" },
  news: { site_code: "ihop-menu", keitaro_alias: "pBRw", target_domain: "news.ihopmenuwithprices.us", description: "News Subdomain" },
  "ihop-news": { site_code: "ihop-menu", keitaro_alias: "pBRw", target_domain: "news.ihopmenuwithprices.us", description: "IHOP News Full Slug" },
  // Slug Langsung Kode Keitaro IHOP (6Q2G, PXZ2, TFWG, WYJ7, XVDV)
  "6q2g": { site_code: "ihop-menu", keitaro_alias: "6Q2G", target_domain: "deals.ihopmenuwithprices.us", description: "IHOP Deals (6Q2G)" },
  pxz2: { site_code: "ihop-menu", keitaro_alias: "PXZ2", target_domain: "news.ihopmenuwithprices.us", description: "IHOP News (PXZ2)" },
  tfwg: { site_code: "ihop-menu", keitaro_alias: "TFWG", target_domain: "hacks.ihopmenuwithprices.us", description: "IHOP Hacks (TFWG)" },
  wyj7: { site_code: "ihop-menu", keitaro_alias: "WYJ7", target_domain: "menu.ihopmenuwithprices.us", description: "IHOP Menu (WYJ7)" },
  xvdv: { site_code: "ihop-menu", keitaro_alias: "XVDV", target_domain: "keto.ihopmenuwithprices.us", description: "IHOP Keto (XVDV)" },

  // ============================================================================
  // 5. FOODSFACT.ORG (5 Subdomain) - Kode Resmi: 8f9fdwdM, 6Sp9wmYn, 3bRStX5X, s6c34SVN, CLHNtg1D
  // ============================================================================
  "insurance-food": { site_code: "4SVN", keitaro_alias: "s6c34SVN", target_domain: "insurance.foodsfact.org", description: "FoodsFact Insurance" },
  "4svn": { site_code: "4SVN", keitaro_alias: "s6c34SVN", target_domain: "insurance.foodsfact.org", description: "FoodsFact Insurance (4SVN)" },
  s6c34svn: { site_code: "4SVN", keitaro_alias: "s6c34SVN", target_domain: "insurance.foodsfact.org", description: "FoodsFact Insurance (s6c34SVN)" },
  eat: { site_code: "DWDM", keitaro_alias: "8f9fdwdM", target_domain: "eat.foodsfact.org", description: "FoodsFact Eat" },
  dwdm: { site_code: "DWDM", keitaro_alias: "8f9fdwdM", target_domain: "eat.foodsfact.org", description: "FoodsFact Eat (DWDM)" },
  "8f9fdwdm": { site_code: "DWDM", keitaro_alias: "8f9fdwdM", target_domain: "eat.foodsfact.org", description: "FoodsFact Eat (8f9fdwdM)" },
  "ff-guides": { site_code: "TG1D", keitaro_alias: "CLHNtg1D", target_domain: "guides.foodsfact.org", description: "FoodsFact Guides" },
  tg1d: { site_code: "TG1D", keitaro_alias: "CLHNtg1D", target_domain: "guides.foodsfact.org", description: "FoodsFact Guides (TG1D)" },
  clhntg1d: { site_code: "TG1D", keitaro_alias: "CLHNtg1D", target_domain: "guides.foodsfact.org", description: "FoodsFact Guides (CLHNtg1D)" },
  "food-finance": { site_code: "TX5X", keitaro_alias: "3bRStX5X", target_domain: "finance.foodsfact.org", description: "FoodsFact Finance" },
  tx5x: { site_code: "TX5X", keitaro_alias: "3bRStX5X", target_domain: "finance.foodsfact.org", description: "FoodsFact Finance (TX5X)" },
  "3brstx5x": { site_code: "TX5X", keitaro_alias: "3bRStX5X", target_domain: "finance.foodsfact.org", description: "FoodsFact Finance (3bRStX5X)" },
  property: { site_code: "WMYN", keitaro_alias: "6Sp9wmYn", target_domain: "property.foodsfact.org", description: "FoodsFact Property" },
  wmyn: { site_code: "WMYN", keitaro_alias: "6Sp9wmYn", target_domain: "property.foodsfact.org", description: "FoodsFact Property (WMYN)" },
  "6sp9wmyn": { site_code: "WMYN", keitaro_alias: "6Sp9wmYn", target_domain: "property.foodsfact.org", description: "FoodsFact Property (6Sp9wmYn)" },

  // ============================================================================
  // 6. CMHHEALTHS.COM (6 Subdomain) - Kode: 7KL2, BZP2, J69X, JS43, TDJ6, YNXM
  // ============================================================================
  dosage: { site_code: "7KL2", keitaro_alias: "7KL2", target_domain: "dosage.cmhhealths.com", description: "CMH Dosage" },
  "7kl2": { site_code: "7KL2", keitaro_alias: "7KL2", target_domain: "dosage.cmhhealths.com", description: "CMH Dosage (7KL2)" },
  weightloss: { site_code: "BZP2", keitaro_alias: "BZP2", target_domain: "weightloss.cmhhealths.com", description: "CMH Weight Loss" },
  bzp2: { site_code: "BZP2", keitaro_alias: "BZP2", target_domain: "weightloss.cmhhealths.com", description: "CMH Weight Loss (BZP2)" },
  diabetes: { site_code: "J69X", keitaro_alias: "J69X", target_domain: "diabetes.cmhhealths.com", description: "CMH Diabetes" },
  j69x: { site_code: "J69X", keitaro_alias: "J69X", target_domain: "diabetes.cmhhealths.com", description: "CMH Diabetes (J69X)" },
  sideeffects: { site_code: "JS43", keitaro_alias: "JS43", target_domain: "sideeffects.cmhhealths.com", description: "CMH Side Effects" },
  js43: { site_code: "JS43", keitaro_alias: "JS43", target_domain: "sideeffects.cmhhealths.com", description: "CMH Side Effects (JS43)" },
  injections: { site_code: "TDJ6", keitaro_alias: "TDJ6", target_domain: "injections.cmhhealths.com", description: "CMH Injections" },
  tdj6: { site_code: "TDJ6", keitaro_alias: "TDJ6", target_domain: "injections.cmhhealths.com", description: "CMH Injections (TDJ6)" },
  fitness: { site_code: "YNXM", keitaro_alias: "YNXM", target_domain: "fitness.cmhhealths.com", description: "CMH Fitness" },
  ynxm: { site_code: "YNXM", keitaro_alias: "YNXM", target_domain: "fitness.cmhhealths.com", description: "CMH Fitness (YNXM)" },

  // ============================================================================
  // 7. UNIQUEINFO24.COM (5 Subdomain) - Kode: 245R, G9SQ, N1BD, SBS6, WNJC
  // ============================================================================
  "insurance-ui": { site_code: "245R", keitaro_alias: "245R", target_domain: "insurance.uniqueinfo24.com", description: "UniqueInfo Insurance" },
  "245r": { site_code: "245R", keitaro_alias: "245R", target_domain: "insurance.uniqueinfo24.com", description: "UniqueInfo Insurance (245R)" },
  travel: { site_code: "G9SQ", keitaro_alias: "G9SQ", target_domain: "travel.uniqueinfo24.com", description: "UniqueInfo Travel" },
  g9sq: { site_code: "G9SQ", keitaro_alias: "G9SQ", target_domain: "travel.uniqueinfo24.com", description: "UniqueInfo Travel (G9SQ)" },
  health: { site_code: "N1BD", keitaro_alias: "N1BD", target_domain: "health.uniqueinfo24.com", description: "UniqueInfo Health" },
  n1bd: { site_code: "N1BD", keitaro_alias: "N1BD", target_domain: "health.uniqueinfo24.com", description: "UniqueInfo Health (N1BD)" },
  loan: { site_code: "SBS6", keitaro_alias: "SBS6", target_domain: "loan.uniqueinfo24.com", description: "UniqueInfo Loan" },
  sbs6: { site_code: "SBS6", keitaro_alias: "SBS6", target_domain: "loan.uniqueinfo24.com", description: "UniqueInfo Loan (SBS6)" },
  wnjc: { site_code: "WNJC", keitaro_alias: "WNJC", target_domain: "finance.uniqueinfo24.com", description: "UniqueInfo Finance (WNJC)" },

  // ============================================================================
  // 8. VELOCITYTV.COM.PK (4 Subdomain) - Kode: 2DB4, N4D6, WRGB, XCGM
  // ============================================================================
  "insurance-vel": { site_code: "2DB4", keitaro_alias: "2DB4", target_domain: "insurance.velocitytv.com.pk", description: "VelocityTV Insurance" },
  "2db4": { site_code: "2DB4", keitaro_alias: "2DB4", target_domain: "insurance.velocitytv.com.pk", description: "VelocityTV Insurance (2DB4)" },
  "vel-finance": { site_code: "N4D6", keitaro_alias: "N4D6", target_domain: "finance.velocitytv.com.pk", description: "VelocityTV Finance" },
  n4d6: { site_code: "N4D6", keitaro_alias: "N4D6", target_domain: "finance.velocitytv.com.pk", description: "VelocityTV Finance (N4D6)" },
  "vel-news": { site_code: "WRGB", keitaro_alias: "WRGB", target_domain: "news.velocitytv.com.pk", description: "VelocityTV News" },
  wrgb: { site_code: "WRGB", keitaro_alias: "WRGB", target_domain: "news.velocitytv.com.pk", description: "VelocityTV News (WRGB)" },
  dollar: { site_code: "XCGM", keitaro_alias: "XCGM", target_domain: "dollar.velocitytv.com.pk", description: "VelocityTV Dollar" },
  xcgm: { site_code: "XCGM", keitaro_alias: "XCGM", target_domain: "dollar.velocitytv.com.pk", description: "VelocityTV Dollar (XCGM)" },

  // ============================================================================
  // 9. WORKMONEY24.COM (5 Subdomain) - Kode: 4R2M, DQN2, FGCD, KVD1, X8PJ
  // ============================================================================
  skills: { site_code: "4R2M", keitaro_alias: "4R2M", target_domain: "skills.workmoney24.com", description: "WorkMoney Skills" },
  "4r2m": { site_code: "4R2M", keitaro_alias: "4R2M", target_domain: "skills.workmoney24.com", description: "WorkMoney Skills (4R2M)" },
  freelance: { site_code: "DQN2", keitaro_alias: "DQN2", target_domain: "freelance.workmoney24.com", description: "WorkMoney Freelance" },
  dqn2: { site_code: "DQN2", keitaro_alias: "DQN2", target_domain: "freelance.workmoney24.com", description: "WorkMoney Freelance (DQN2)" },
  passiveincome: { site_code: "FGCD", keitaro_alias: "FGCD", target_domain: "passiveincome.workmoney24.com", description: "WorkMoney Passive Income" },
  fgcd: { site_code: "FGCD", keitaro_alias: "FGCD", target_domain: "passiveincome.workmoney24.com", description: "WorkMoney Passive Income (FGCD)" },
  affiliate: { site_code: "KVD1", keitaro_alias: "KVD1", target_domain: "affiliate.workmoney24.com", description: "WorkMoney Affiliate" },
  kvd1: { site_code: "KVD1", keitaro_alias: "KVD1", target_domain: "affiliate.workmoney24.com", description: "WorkMoney Affiliate (KVD1)" },
  wfh: { site_code: "X8PJ", keitaro_alias: "X8PJ", target_domain: "wfh.workmoney24.com", description: "WorkMoney WFH" },
  x8pj: { site_code: "X8PJ", keitaro_alias: "X8PJ", target_domain: "wfh.workmoney24.com", description: "WorkMoney WFH (X8PJ)" },

  // ============================================================================
  // 10. ZIPERTO.ORG (5 Subdomain) - Kode: 2FGP, 4C9L, PSHM, RYLV, T7PV
  // ============================================================================
  family: { site_code: "2FGP", keitaro_alias: "2FGP", target_domain: "family.ziperto.org", description: "Ziperto Family" },
  "2fgp": { site_code: "2FGP", keitaro_alias: "2FGP", target_domain: "family.ziperto.org", description: "Ziperto Family (2FGP)" },
  "zip-guides": { site_code: "4C9L", keitaro_alias: "4C9L", target_domain: "guides.ziperto.org", description: "Ziperto Guides" },
  "4c9l": { site_code: "4C9L", keitaro_alias: "4C9L", target_domain: "guides.ziperto.org", description: "Ziperto Guides (4C9L)" },
  hard: { site_code: "PSHM", keitaro_alias: "PSHM", target_domain: "hard.ziperto.org", description: "Ziperto Hard" },
  pshm: { site_code: "PSHM", keitaro_alias: "PSHM", target_domain: "hard.ziperto.org", description: "Ziperto Hard (PSHM)" },
  subs: { site_code: "RYLV", keitaro_alias: "RYLV", target_domain: "subs.ziperto.org", description: "Ziperto Subs" },
  rylv: { site_code: "RYLV", keitaro_alias: "RYLV", target_domain: "subs.ziperto.org", description: "Ziperto Subs (RYLV)" },
  gaming: { site_code: "T7PV", keitaro_alias: "T7PV", target_domain: "gaming.ziperto.org", description: "Ziperto Gaming" },
  t7pv: { site_code: "T7PV", keitaro_alias: "T7PV", target_domain: "gaming.ziperto.org", description: "Ziperto Gaming (T7PV)" },
};

/**
 * Mencari rute gateway berdasarkan slug URL
 */
export function findGatewayRoute(slug) {
  if (!slug) return null;
  const clean = String(slug)
    .toLowerCase()
    .trim()
    .replace(/^\/+|\/+$/g, "");
  return GATEWAY_ROUTES[clean] || null;
}
