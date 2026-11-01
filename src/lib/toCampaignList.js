// Rincian campaign yang menumpuk di satu subdomain, dari baris ROI.
//
// RTDB mengembalikan array sebagai objek begitu indeksnya berlubang (lihat toCampaignArray di
// useFirebaseStore) — rincian campaign tidak boleh diam-diam hilang cuma karena bentuk kirimannya
// berbeda, apalagi jadinya terbaca sebagai "belum ada campaign terpetakan".
export function toCampaignList(value) {
  if (!value) {
    return [];
  }

  return (Array.isArray(value) ? value : Object.values(value)).filter((entry) => entry?.name || entry?.campaign);
}

/**
 * Daftar Hardcode Campaign Meta yang aktif dan dipakai per subdomain armada TigerROI.
 * Berdasarkan permintaan masdef: dipanggil langsung secara hardcode di frontend
 * tanpa memerlukan seed atau migrasi database ke Supabase.
 */
export const HARDCODED_SUBDOMAIN_CAMPAIGNS = {
  // 1. decor (Tray Edit)
  "decor.trayedit.com": [
    { name: "4QCP 01 PROS TI+UE CARROU LKM 72 (10 Adset)", budget: 350000 },
    { name: "4QCP 02 PROS ITALIA CARROU LKM 73 (10 Adset)", budget: 300000 },
    { name: "ZGFR 01 PROS BIG SIX CARROU LKM 12 (5 Adset)", budget: 100000 },
  ],
  "decor": [
    { name: "4QCP 01 PROS TI+UE CARROU LKM 72 (10 Adset)", budget: 350000 },
    { name: "4QCP 02 PROS ITALIA CARROU LKM 73 (10 Adset)", budget: 300000 },
    { name: "ZGFR 01 PROS BIG SIX CARROU LKM 12 (5 Adset)", budget: 100000 },
  ],

  // 2. mod (TikTok Mod APK)
  "mod.tiktokmodapk.net": [
    { name: "TS9S 05 PROS ARAB SAUDI CARROU M 25 (10 Adset)", budget: 200000 },
    { name: "TS9S 01 PROS GULF CARROU M 21 (10 Adset)", budget: 200000 },
  ],
  "mod": [
    { name: "TS9S 05 PROS ARAB SAUDI CARROU M 25 (10 Adset)", budget: 200000 },
    { name: "TS9S 01 PROS GULF CARROU M 21 (10 Adset)", budget: 200000 },
  ],

  // 3. rewards (TikTok Mod APK)
  "rewards.tiktokmodapk.net": [
    { name: "RHGK 01 PROS EU RI CARROU LKM 11 (10 Adset)", budget: 300000 },
    { name: "WYJ7 02 PROS US CARROU LKM 15 (10 Adset)", budget: 250000 },
  ],
  "rewards": [
    { name: "RHGK 01 PROS EU RI CARROU LKM 11 (10 Adset)", budget: 300000 },
    { name: "WYJ7 02 PROS US CARROU LKM 15 (10 Adset)", budget: 250000 },
  ],

  // 4. materials (Tray Edit)
  "materials.trayedit.com": [
    { name: "4QCP 03 PROS GERMANY CARROU LKM 21 (10 Adset)", budget: 350000 },
    { name: "ZGFR 02 PROS NORDIC CARROU LKM 22 (5 Adset)", budget: 250000 },
  ],
  "materials": [
    { name: "4QCP 03 PROS GERMANY CARROU LKM 21 (10 Adset)", budget: 350000 },
    { name: "ZGFR 02 PROS NORDIC CARROU LKM 22 (5 Adset)", budget: 250000 },
  ],

  // 5. cabinets (Tray Edit)
  "cabinets.trayedit.com": [
    { name: "TvH1 01 PROS SPAIN CARROU LKM 05 (10 Adset)", budget: 300000 },
    { name: "TvH1 02 PROS UK CARROU LKM 08 (10 Adset)", budget: 200000 },
  ],
  "cabinets": [
    { name: "TvH1 01 PROS SPAIN CARROU LKM 05 (10 Adset)", budget: 300000 },
    { name: "TvH1 02 PROS UK CARROU LKM 08 (10 Adset)", budget: 200000 },
  ],

  // 6. guides (Tray Edit)
  "guides.trayedit.com": [
    { name: "TvH1 03 PROS FRANCE CARROU LKM 09 (10 Adset)", budget: 300000 },
    { name: "TvH1 04 PROS POLAND CARROU LKM 14 (10 Adset)", budget: 250000 },
  ],
  "guides": [
    { name: "TvH1 03 PROS FRANCE CARROU LKM 09 (10 Adset)", budget: 300000 },
    { name: "TvH1 04 PROS POLAND CARROU LKM 14 (10 Adset)", budget: 250000 },
  ],

  // 7. deals (IHOP Menu)
  "deals.ihopmenuwithprices.us": [
    { name: "pBRw 01 PROS US EAST CARROU LKM 31 (10 Adset)", budget: 300000 },
    { name: "pBRw 02 PROS US WEST CARROU LKM 32 (10 Adset)", budget: 250000 },
  ],
  "deals": [
    { name: "pBRw 01 PROS US EAST CARROU LKM 31 (10 Adset)", budget: 300000 },
    { name: "pBRw 02 PROS US WEST CARROU LKM 32 (10 Adset)", budget: 250000 },
  ],

  // 8. menu (IHOP Menu)
  "menu.ihopmenuwithprices.us": [
    { name: "pBRw 03 PROS CANADA CARROU LKM 33 (10 Adset)", budget: 300000 },
    { name: "pBRw 04 PROS AUSTRALIA CARROU LKM 34 (10 Adset)", budget: 200000 },
  ],
  "menu": [
    { name: "pBRw 03 PROS CANADA CARROU LKM 33 (10 Adset)", budget: 300000 },
    { name: "pBRw 04 PROS AUSTRALIA CARROU LKM 34 (10 Adset)", budget: 200000 },
  ],

  // 9. hacks (IHOP Menu)
  "hacks.ihopmenuwithprices.us": [
    { name: "pBRw 05 PROS UK CARROU LKM 35 (10 Adset)", budget: 250000 },
    { name: "pBRw 06 PROS NZ CARROU LKM 36 (10 Adset)", budget: 200000 },
  ],
  "hacks": [
    { name: "pBRw 05 PROS UK CARROU LKM 35 (10 Adset)", budget: 250000 },
    { name: "pBRw 06 PROS NZ CARROU LKM 36 (10 Adset)", budget: 200000 },
  ],

  // 10. insurance (TikTok Mod APK)
  "insurance.tiktokmodapk.net": [
    { name: "TS9S 02 PROS GULF CARROU M 18 (10 Adset)", budget: 300000 },
    { name: "TS9S 03 PROS MIDDLE EAST CARROU M 19 (10 Adset)", budget: 250000 },
  ],
  "insurance": [
    { name: "TS9S 02 PROS GULF CARROU M 18 (10 Adset)", budget: 300000 },
    { name: "TS9S 03 PROS MIDDLE EAST CARROU M 19 (10 Adset)", budget: 250000 },
  ],

  // 11. careers (TikTok Mod APK)
  "careers.tiktokmodapk.net": [
    { name: "TS9S 04 PROS ASIA CARROU M 20 (10 Adset)", budget: 250000 },
  ],
  "careers": [
    { name: "TS9S 04 PROS ASIA CARROU M 20 (10 Adset)", budget: 250000 },
  ],

  // 12. burrito (Taco Bell)
  "burrito.tacobellmenuu.us": [
    { name: "taco 01 PROS US CENTRAL CARROU 41 (10 Adset)", budget: 300000 },
    { name: "taco 02 PROS US SOUTH CARROU 42 (10 Adset)", budget: 250000 },
  ],
  "burrito": [
    { name: "taco 01 PROS US CENTRAL CARROU 41 (10 Adset)", budget: 300000 },
    { name: "taco 02 PROS US SOUTH CARROU 42 (10 Adset)", budget: 250000 },
  ],

  // 13. keto (IHOP Menu)
  "keto.ihopmenuwithprices.us": [
    { name: "pBRw 07 PROS US MIDWEST CARROU LKM 37 (10 Adset)", budget: 250000 },
  ],
  "keto": [
    { name: "pBRw 07 PROS US MIDWEST CARROU LKM 37 (10 Adset)", budget: 250000 },
  ],

  // 14. news (IHOP Menu)
  "news.ihopmenuwithprices.us": [
    { name: "pBRw 08 PROS GLOBAL CARROU LKM 38 (10 Adset)", budget: 200000 },
  ],
  "news": [
    { name: "pBRw 08 PROS GLOBAL CARROU LKM 38 (10 Adset)", budget: 200000 },
  ],

  // 15. cantina (Taco Bell)
  "cantina.tacobellmenuu.us": [
    { name: "taco 03 PROS US NORTH CARROU 43 (10 Adset)", budget: 200000 },
  ],
  "cantina": [
    { name: "taco 03 PROS US NORTH CARROU 43 (10 Adset)", budget: 200000 },
  ],

  // 16. fries (Taco Bell)
  "fries.tacobellmenuu.us": [
    { name: "taco 04 PROS US PACIFIC CARROU 44 (10 Adset)", budget: 200000 },
  ],
  "fries": [
    { name: "taco 04 PROS US PACIFIC CARROU 44 (10 Adset)", budget: 200000 },
  ],

  // 17. styling (Tray Edit)
  "styling.trayedit.com": [
    { name: "TvH1 05 PROS ITALY CARROU LKM 15 (10 Adset)", budget: 200000 },
  ],
  "styling": [
    { name: "TvH1 05 PROS ITALY CARROU LKM 15 (10 Adset)", budget: 200000 },
  ],
};

/**
 * Mengambil daftar campaign Meta yang dipetakan secara hardcode untuk subdomain tertentu,
 * sekaligus mengalokasikan nilai total spend ke tiap campaign secara proporsional sesuai anggaran hariannya.
 */
export function getSubdomainHardcodedCampaigns(subDomainStr, totalSpend = 0) {
  if (!subDomainStr) return [];
  const clean = String(subDomainStr).trim().toLowerCase();
  const slug = clean.includes(".") ? clean.split(".")[0] : clean;

  const found =
    HARDCODED_SUBDOMAIN_CAMPAIGNS[clean] ||
    HARDCODED_SUBDOMAIN_CAMPAIGNS[slug];

  if (!found || found.length === 0) return [];

  const spendNum = Number(totalSpend || 0);
  const totalBudget = found.reduce((sum, c) => sum + (Number(c.budget) || 1), 0);

  let allocatedSum = 0;
  return found.map((c, idx) => {
    let spend = 0;
    if (spendNum > 0) {
      if (idx === found.length - 1) {
        spend = Math.max(0, spendNum - allocatedSum);
      } else {
        spend = Math.round((Number(c.budget || 1) / totalBudget) * spendNum);
        allocatedSum += spend;
      }
    }
    return {
      name: c.name,
      spend,
      budget: c.budget,
      status: c.status || "ACTIVE",
    };
  });
}

/**
 * Mengelompokkan rincian campaign Meta Ads per subdomain dari seluruh profil pengguna,
 * sehingga badge "Campaign digabung" di tabel ROI dapat menampilkan nama campaign dan spend-nya saat di-hover.
 */
export function buildCampaignsBySubDomain(users) {
  const map = new Map();
  for (const user of Array.isArray(users) ? users : []) {
    const campaigns = Array.isArray(user?.campaigns)
      ? user.campaigns
      : Object.values(user?.campaigns || {});

    for (const c of campaigns) {
      if (!c) continue;
      const campaignName = c.name || c.campaign || c.campaignName;
      if (!campaignName) continue;
      const sub = String(c.subDomain || c.subdomain || c.siteCode || "").trim().toLowerCase();
      if (!sub) continue;

      const item = {
        name: campaignName,
        spend: Number(c.spend || c.spending || c.spendToday || 0),
        budget: Number(c.dailyBudget || c.budget || 0),
        spendToday: Number(c.spendToday || 0),
        status: c.status || "ACTIVE",
      };

      const list = map.get(sub) || [];
      if (!list.some((existing) => existing.name === campaignName)) {
        list.push(item);
      }
      map.set(sub, list);

      if (sub.includes(".")) {
        const slug = sub.split(".")[0];
        const slugList = map.get(slug) || [];
        if (!slugList.some((existing) => existing.name === campaignName)) {
          slugList.push(item);
        }
        map.set(slug, slugList);
      }
    }
  }
  return map;
}
