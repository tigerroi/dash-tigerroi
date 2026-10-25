/**
 * Tab "Terjadwal" di Overview: seluruh jadwal tayang armada, dan jam yang SAMA PERSIS.
 *
 * Yang dijaga tab ini adalah server situs, bukan anggaran: beberapa campaign yang menyala di menit
 * yang sama mengirim trafik berbayar serentak ke hosting yang sebagian besar berbagi mesin, dan
 * yang jatuh adalah situsnya — untuk pengunjung yang datang dari iklan. Barisnya dibaca server
 * kontrol (`GET /scheduled-launches`, satu baris per AD SET); yang diputuskan di sini cuma yang
 * digambar.
 */

// Satu campaign = ad account + ID campaign. ID Meta memang unik, tapi baris tanpa ID (tidak pernah
// terjadi dari API, tapi bukan hal yang boleh menggabungkan dua campaign asing) jatuh ke namanya.
function campaignKey(row) {
  return `${row.accountId || ""}__${row.campaignId || row.campaign || row.adSetId}`;
}

/**
 * Tiap baris ad set dilengkapi PIC, subdomain, dan kunci campaign-nya, lalu diurutkan menurut jam.
 *
 * `subDomain` diisi dari baris campaign armada yang sudah dilanggan (`campaignIndex`, campaignId →
 * subdomain), bukan dari Meta: tujuan campaign adalah pemetaan dashboard ini. Yang tidak terpetakan
 * dibiarkan kosong, bukan ditebak.
 */
export function launchRows(rows, { campaignIndex = new Map() } = {}) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => Number.isFinite(Number(row?.startMs)))
    .map((row) => {
      const mapped = campaignIndex.get(String(row.campaignId || ""));
      return {
        ...row,
        startMs: Number(row.startMs),
        pic: row.pic || mapped?.owner || "",
        subDomain: mapped?.subDomain || "",
        campaignKey: campaignKey(row),
      };
    })
    .sort((a, b) => a.startMs - b.startMs);
}

/** Jumlah CAMPAIGN terjadwal (bukan ad set), untuk kepala panel. */
export function launchCampaignCount(adSetRows) {
  return new Set((adSetRows || []).map((row) => row.campaignKey)).size;
}

/**
 * Dua campaign di menit yang sama menghantam MESIN yang sama? Server yang tidak diketahui (subdomain
 * tak terpetakan, record DNS tidak ada, Cloudflare gagal dibaca) dihitung SAMA: yang tidak bisa
 * dibuktikan berbeda tidak boleh berbunyi aman — sepola earning yang tidak diketahui yang tidak
 * pernah dinilai nol.
 */
export function sameServer(a, b) {
  return !a?.server || !b?.server || a.server === b.server;
}

/**
 * Seluruh jadwal, dikelompokkan per jam WIB (sampai MENIT) — tiap kelompok satu kartu di tab
 * Terjadwal. Yang BENTROK adalah campaign yang punya tetangga di menit itu di SERVER yang sama
 * (`sameServer`): lonjakan trafik yang dijaga tab ini jatuh ke mesin, dan dua situs di dua VPS
 * berbeda yang menyala bersamaan tidak saling mengganggu.
 *
 * "Bersamaan" berarti jam mulai yang SAMA PERSIS, bukan "berdekatan": jadwal yang masih berjeda,
 * berapa pun kecilnya, sudah dipisahkan orangnya dengan sengaja. Kuncinya `startWib` terpotong di
 * menit — jam operasi, bukan detik Meta, sama dengan yang diketik orang di kotak jadwal.
 *
 * Yang dihitung CAMPAIGN, bukan ad set: lima ad set satu campaign "5 Adset" yang diluncurkan
 * bersamaan adalah bentuk armada yang disengaja. Campaign milik PIC yang SAMA tetap dihitung: server
 * situs tidak tahu siapa pemilik trafiknya. `servers` = hostname → server dari server kontrol;
 * `null` (tidak terbaca) membuat semuanya tidak diketahui, yaitu aturan lama "menit sama = bentrok".
 */
export function launchSlots(adSetRows, { servers = null } = {}) {
  const serverOf = (subDomain) =>
    servers?.[
      String(subDomain || "")
        .trim()
        .toLowerCase()
    ] || "";
  const slots = new Map();
  for (const row of adSetRows || []) {
    const minute = String(row?.startWib || "").slice(0, 16);
    if (minute.length !== 16) continue;
    const slot = slots.get(minute) || { minute, startMs: row.startMs, campaigns: new Map() };
    const campaign = slot.campaigns.get(row.campaignKey) || {
      id: row.campaignKey,
      campaignId: row.campaignId,
      campaign: row.campaign,
      campaignScheduled: Boolean(row.campaignScheduled),
      account: row.account,
      pic: row.pic,
      subDomain: row.subDomain,
      server: serverOf(row.subDomain),
      adSets: [],
    };
    campaign.adSets.push(row);
    slot.campaigns.set(row.campaignKey, campaign);
    slots.set(minute, slot);
  }

  const totalAdSets = new Map();
  for (const row of adSetRows || []) {
    totalAdSets.set(row.campaignKey, (totalAdSets.get(row.campaignKey) || 0) + 1);
  }

  return [...slots.values()]
    .map((slot) => {
      const list = [...slot.campaigns.values()];
      const campaigns = list
        .map((campaign) => ({
          ...campaign,
          clash: list.some((other) => other.id !== campaign.id && sameServer(campaign, other)),
          level: campaign.campaignScheduled ? "Campaign baru" : "Ad set baru",
          adSetCount: campaign.adSets.length,
          adSetTotal: totalAdSets.get(campaign.id) || campaign.adSets.length,
        }))
        .sort(
          (a, b) =>
            String(a.pic || "").localeCompare(String(b.pic || "")) ||
            String(a.campaign || "").localeCompare(String(b.campaign || "")),
        );
      return {
        minute: slot.minute,
        clash: campaigns.some((campaign) => campaign.clash),
        clashCount: campaigns.filter((campaign) => campaign.clash).length,
        day: slot.minute.slice(0, 10),
        startMs: slot.startMs,
        campaigns,
      };
    })
    .sort((a, b) => a.startMs - b.startMs);
}

/**
 * Peta campaignId → { subDomain, owner } dari baris campaign armada (`fleetCampaignRows`).
 *
 * `owner` jadi cadangan PIC untuk ad account yang kolom User Pemilik-nya belum diisi: campaign itu
 * tetap tinggal di profil seseorang, dan "(tanpa PIC)" untuk campaign yang pemiliknya jelas terbaca
 * di halaman sebelah adalah sel kosong yang tidak perlu.
 */
export function campaignIndexOf(fleetRows) {
  const index = new Map();
  for (const row of fleetRows || []) {
    const id = String(row?.campaignId || "");
    if (!id || index.has(id)) continue;
    index.set(id, {
      subDomain: row.subDomain || "",
      owner: row.owner && row.owner !== "-" ? row.owner : "",
    });
  }
  return index;
}

/** Pilihan penyaring PIC, dari baris yang ada. */
export function launchPics(rows) {
  return [...new Set((rows || []).map((row) => row.pic).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
}

// --- Geser jam mulai -----------------------------------------------------------------------------

const WIB_MS = 7 * 3_600_000;

// Jam operasi "YYYY-MM-DDTHH:MM" (WIB, tanpa zona) — bentuk `startWib`, kotak `datetime-local`, dan
// yang dibaca `parseStartTime` di server. Zona tetap +07:00, sama dengan server: yang dijadwalkan
// adalah jam OPERASI, bukan jam perangkat yang mengetiknya.
export function wibMinute(ms) {
  return new Date(ms + WIB_MS).toISOString().slice(0, 16);
}

function wibMs(minute) {
  return Date.parse(`${minute}:00+07:00`);
}

/**
 * Usulan jam baru: menit terdekat SESUDAH `minute`, berlangkah 15 menit, yang tidak dipakai kartu
 * mana pun. "Bentrok" berarti menit yang sama persis, jadi menit yang kosong sudah cukup; langkah
 * 15 menit cuma supaya usulannya jam yang wajar diketik orang, bukan 09:01.
 */
export function freeMinuteAfter(slots, minute, stepMinutes = 15) {
  const taken = new Set((slots || []).map((slot) => slot.minute));
  let ms = wibMs(minute);
  if (!Number.isFinite(ms)) return "";
  do ms += stepMinutes * 60_000;
  while (taken.has(wibMinute(ms)));
  return wibMinute(ms);
}

/**
 * Tulisan untuk menggeser SATU campaign: SELURUH ad set terjadwalnya bergeser dengan selisih yang
 * sama (`from` → `to`), termasuk yang mulai di jam lain — jarak antar ad set yang disusun orangnya
 * tetap utuh. Menyamakan semuanya ke satu jam justru membuat campaign-nya menyala serentak.
 */
export function shiftPlan(adSetRows, campaignKey, from, to) {
  const delta = wibMs(to) - wibMs(from);
  if (!Number.isFinite(delta)) return [];
  return (adSetRows || [])
    .filter((row) => row.campaignKey === campaignKey)
    .map((row) => ({
      adSetId: row.adSetId,
      adSet: row.adSet,
      from: wibMinute(row.startMs),
      startTime: wibMinute(row.startMs + delta),
    }));
}

/**
 * Email pemilik ad account (PIC) — aturan nama yang sama dengan sync (`accountKeysByOwner`):
 * `users.name` dicocokkan tanpa memandang spasi tepi dan kapitalisasi. Hanya untuk MENGGAMBAR
 * tombolnya; yang menegakkan izinnya server.
 */
export function launchOwnerEmail(users, pic) {
  const want = String(pic || "")
    .trim()
    .toLowerCase();
  if (!want) return "";
  const list = Array.isArray(users) ? users : Object.values(users || {});
  const owner = list.find(
    (user) =>
      user &&
      !user.deletedAt &&
      String(user.name || "")
        .trim()
        .toLowerCase() === want,
  );
  return owner?.email || "";
}
