// Rincian campaign yang menumpuk di satu subdomain, dari baris ROI.
//
// RTDB mengembalikan array sebagai objek begitu indeksnya berlubang (lihat toCampaignArray di
// useFirebaseStore) — rincian campaign tidak boleh diam-diam hilang cuma karena bentuk kirimannya
// berbeda, apalagi jadinya terbaca sebagai "belum ada campaign terpetakan".
export function toCampaignList(value) {
  if (!value) {
    return [];
  }

  return (Array.isArray(value) ? value : Object.values(value)).filter((entry) => entry?.name);
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
      if (!c || !c.name) continue;
      const sub = String(c.subDomain || c.subdomain || c.siteCode || "").trim().toLowerCase();
      if (!sub) continue;

      const item = {
        name: c.name,
        spend: Number(c.spend || c.spending || 0),
        status: c.status || "ACTIVE",
      };

      const list = map.get(sub) || [];
      if (!list.some((existing) => existing.name === c.name)) {
        list.push(item);
      }
      map.set(sub, list);

      if (sub.includes(".")) {
        const slug = sub.split(".")[0];
        const slugList = map.get(slug) || [];
        if (!slugList.some((existing) => existing.name === c.name)) {
          slugList.push(item);
        }
        map.set(slug, slugList);
      }
    }
  }
  return map;
}
