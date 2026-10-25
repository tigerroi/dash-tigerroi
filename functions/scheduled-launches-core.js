// Jadwal tayang armada: ad set yang AKAN mulai tayang, berikut PIC-nya.
//
// Dipisah dari meta.js dan dari route server-nya dengan alasan yang sama seperti adsets-core.js:
// keputusan "mana yang terjadwal" dan "siapa pemiliknya" tidak boleh cuma bisa diuji dengan
// menghubungi Meta.

import { parseStartTime } from "./campaign-create-core.js";
import { RuleError } from "./campaign-manage-core.js";
import { metaTimeMs, normalizeName, syncTimeZone, zonedClock, zonedDateKey } from "./sync-core.js";

/**
 * Ad account yang dibaca: tidak dihapus, tidak dimatikan sync-nya, dan punya alamat Meta.
 *
 * `syncDisabled` ikut dilewati walau yang dicari bukan spend: akun yang izinnya dicabut menjawab
 * error yang sama tiap kali, dan akun yang disuspend tidak akan menayangkan jadwal apa pun.
 */
export function launchAccounts(adAccounts) {
  const accounts = [];
  for (const [id, account] of Object.entries(adAccounts || {})) {
    if (!account || account.deletedAt || account.syncDisabled || !account.actId) continue;
    accounts.push({
      id,
      actId: String(account.actId),
      name: account.name || String(account.actId),
      pic: account.userOwner || "",
    });
  }
  return accounts;
}

/**
 * Baris jadwal untuk satu ad account: hanya ad set yang saklarnya On, campaign-nya On, dan jam
 * mulainya BELUM lewat.
 *
 * Jamnya ditulis dua kali dengan sengaja. `startMs` adalah waktu absolut — yang dipakai mengadu dua
 * jadwal, jadi tidak ada zona yang bisa membuatnya meleset. `startWib` adalah jam OPERASI
 * (`YYYY-MM-DDTHH:MM`, tanpa zona) — yang digambar di layar. Diberikan dengan zonanya
 * (`+0700` apa adanya dari Meta), `formatDateTime` menggambarnya menurut jam PERANGKAT pembacanya,
 * dan dua advertiser di dua zona akan menyepakati "jam 09:00" untuk dua saat yang berbeda — persis
 * kesalahan yang tab ini ada untuk mencegahnya.
 *
 * `campaignScheduled` membedakan CAMPAIGN BARU (seluruh campaign belum tayang — Meta mengisi
 * `start_time` campaign dari ad set yang paling awal) dari AD SET yang menyusul di dalam campaign
 * yang sudah jalan. Keduanya sama-sama menyalakan trafik pada jamnya; yang berbeda cuma di mana
 * orang mencarinya di Ads Manager.
 */
export function scheduledLaunchRows(account, adSets, now = new Date(), timeZone = syncTimeZone()) {
  const nowMs = now.getTime();
  const rows = [];
  for (const set of adSets || []) {
    if (String(set?.status || "").toUpperCase() !== "ACTIVE") continue;
    if (String(set?.campaignStatus || "ACTIVE").toUpperCase() !== "ACTIVE") continue;
    const startMs = metaTimeMs(set?.startTime);
    // Jadwal yang kosong atau tidak terurai TIDAK ditebak terjadwal — aturan yang sama dengan
    // `campaignStatusLabel`: ad set tanpa jadwal memang tayang sekarang.
    if (startMs === null || startMs <= nowMs) continue;
    const start = new Date(startMs);
    const campaignStartMs = metaTimeMs(set?.campaignStartTime);
    rows.push({
      id: `${account.id}__${set.id}`,
      adSetId: String(set.id || ""),
      adSet: set.name || "",
      campaignId: String(set.campaignId || ""),
      campaign: set.campaign || "",
      campaignScheduled: campaignStartMs !== null && campaignStartMs > nowMs,
      startMs,
      startWib: `${zonedDateKey(start, timeZone)}T${zonedClock(start, timeZone)}`,
      accountId: account.id,
      account: account.name,
      pic: account.pic,
    });
  }
  return rows.sort((a, b) => a.startMs - b.startMs);
}

// --- Geser jam mulai -----------------------------------------------------------------------------

const actDigits = (value) => String(value || "").replace(/^act_/, "");

/**
 * Ad account (dari `launchAccounts`) yang memegang ad set itu, dibaca dari `account_id` MILIK META
 * — bukan dari request. Yang tidak ketemu berarti ad set di luar armada, dan route menolaknya: tanpa
 * pemeriksaan ini, penggeser jadwal adalah editor Meta untuk ad set mana pun di Business Manager.
 */
export function launchAccountOf(accounts, metaAccountId) {
  const id = actDigits(metaAccountId);
  return (id && (accounts || []).find((account) => actDigits(account.actId) === id)) || null;
}

/**
 * Baris `users` pemilik ad account itu — aturan yang SAMA dengan sync (`accountKeysByOwner`):
 * `adAccounts.userOwner` dicocokkan dengan `users.name` lewat `normalizeName`. Sengaja tidak lewat
 * baris campaign di profil: campaign yang baru dibuat di Ads Manager belum masuk profil siapa pun
 * sampai sync berikutnya, padahal justru campaign baru yang paling sering perlu digeser.
 */
export function launchOwnerOf(users, pic) {
  const want = normalizeName(pic);
  if (!want) return null;
  for (const user of Object.values(users || {})) {
    if (user && !user.deletedAt && user.name && normalizeName(user.name) === want) return user;
  }
  return null;
}

/**
 * Jam mulai baru untuk satu ad set, atau `RuleError`.
 *
 * - Yang SUDAH tayang tidak bisa digeser: `start_time` lampau tidak berarti apa pun lagi, dan yang
 *   dicari tab ini cuma jadwal yang belum menyala.
 * - `parseStartTime` yang sama dengan "Buat campaign": waktu lampau ditolak (Meta menjepitnya ke jam
 *   sekarang tanpa satu pun pesan — jadwal yang digeser lalu justru langsung tayang), tanggal yang
 *   tidak ada di kalender ditolak, zonanya WIB eksplisit.
 * - Harus sebelum `end_time`: ad set beranggaran lifetime wajib punya jam berakhir, dan Meta menolak
 *   jadwal yang mulai sesudahnya dengan pesan yang cuma menyebut nomor kode.
 */
export function shiftedStartTime(adSet, startTime, now = new Date()) {
  const current = metaTimeMs(adSet?.startTime);
  if (current === null || current <= now.getTime()) {
    throw new RuleError("Ad set ini sudah tayang — jam mulainya tidak bisa digeser lagi.");
  }
  const stamp = parseStartTime(startTime, { now });
  if (!stamp) throw new RuleError("Jam mulai baru wajib diisi.");
  const end = metaTimeMs(adSet?.endTime);
  if (end !== null && Date.parse(stamp) >= end) {
    throw new RuleError(
      "Jam mulai baru jatuh sesudah jam berakhir ad set ini — ubah jam berakhirnya di Ads Manager dulu.",
    );
  }
  return stamp;
}

// --- Server tiap subdomain -----------------------------------------------------------------------

const lowerHost = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\.$/, "");

/**
 * hostname → server (IP origin), dari record DNS Cloudflare.
 *
 * Yang memutuskan "dua campaign menghantam mesin yang sama" adalah ke mana nama-nya MENUNJUK, dan
 * itu cuma tercatat di DNS — `content` record A/AAAA adalah IP origin walau record-nya di-proxy.
 * Bukan kolom "Server" di /gam-accounts: teks ketikan per AKUN, sementara subdomain satu akun bisa
 * tinggal di mesin berbeda, dan yang diketik basi pada hari sebuah situs dipindahkan.
 *
 * CNAME diikuti sampai 5 lompatan di dalam record yang ada; yang menunjuk ke luar zona kita berhenti
 * di nama tujuannya (nama yang sama = mesin yang sama, nama berbeda = tidak bisa dipastikan sama).
 * Wildcard (`*.zona`) cuma cadangan untuk nama yang tidak punya record sendiri.
 */
export function serverIndex(records) {
  const direct = new Map();
  const alias = new Map();
  for (const record of records || []) {
    const name = lowerHost(record?.name);
    const type = String(record?.type || "").toUpperCase();
    if (!name) continue;
    if (type === "A" || type === "AAAA") {
      if (!direct.has(name)) direct.set(name, String(record.content || "").trim());
    } else if (type === "CNAME") {
      alias.set(name, lowerHost(record.content));
    }
  }
  const lookup = (name) => {
    if (direct.has(name) || alias.has(name)) return name;
    const wildcard = `*.${name.split(".").slice(1).join(".")}`;
    return direct.has(wildcard) || alias.has(wildcard) ? wildcard : "";
  };
  return (hostname) => {
    let name = lookup(lowerHost(hostname));
    if (!name) return "";
    for (let hop = 0; hop < 5; hop += 1) {
      if (direct.has(name)) return direct.get(name);
      const next = alias.get(name);
      const found = next ? lookup(next) : "";
      if (!found) return next || "";
      name = found;
    }
    return "";
  };
}

/** Peta hostname → server untuk tiap subdomain di baris jadwal (yang tidak ketemu dilewati). */
export function launchServers(records, hostnames) {
  const serverOf = serverIndex(records);
  const servers = {};
  for (const host of hostnames || []) {
    const server = serverOf(host);
    if (server) servers[lowerHost(host)] = server;
  }
  return servers;
}
