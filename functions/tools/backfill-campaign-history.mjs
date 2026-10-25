// One-off backfill for "Riwayat Spend Campaign" (userReports/{id}.campaignHistory).
//
// The regular Meta sync only re-fetches a short trailing window each run (CAMPAIGN_HISTORY_WINDOW,
// default 3 days), so a freshly enabled feature starts nearly empty. This pulls the full retention
// window (CAMPAIGN_HISTORY_DAYS, default 90) once, per day, and writes the same rows the sync would.
//
//   export META_ACCESS_TOKEN=...
//   npm run meta:backfill-history            # all owned ad accounts, last 90 days
//   npm run meta:backfill-history -- 60      # last 60 days
//   npm run meta:backfill-history -- 90 <adAccountId> <adAccountId>   # only these accounts
//
// Idempotent: keys are `date__account__campaign`, so re-running overwrites the same rows rather than
// duplicating them. It never touches `campaigns`, `dailySpend`, or `balanceSnapshots`.

import { get, ref, update } from "firebase/database";
import { connect } from "../db.mjs";
import { fetchCampaignResultGoals, fetchCampaignSpend } from "../meta.js";
import {
  buildCodeIndex,
  campaignHistoryDays,
  campaignHistoryEntries,
  expiredCampaignHistoryKeys,
  normalizeName,
  parseCampaignCodes,
  userReportsPath,
} from "../sync-core.js";

// Same resolution as sync-meta's matchCode: first registered code in the name wins, and the leading
// token is reported even when nothing matches so an unmapped row still says which code to register.
function matchCode(campaignName, byCode) {
  const tokens = parseCampaignCodes(campaignName);
  for (const token of tokens) {
    const subDomain = byCode.get(token);
    if (subDomain) return { subDomain, code: token };
  }
  return { subDomain: "", code: tokens[0] || "" };
}

async function backfill(db, token, { days, only }) {
  const accounts = (await get(ref(db, "adAccounts"))).val() || {};
  const users = (await get(ref(db, "users"))).val() || {};
  const subDomains = (await get(ref(db, "subDomains"))).val() || {};
  const { byCode } = buildCodeIndex(subDomains);
  const resolve = (name) => matchCode(name, byCode);
  const now = new Date();
  const until = now.toISOString().slice(0, 10);
  const since = new Date(now.getTime() - (days - 1) * 86_400_000).toISOString().slice(0, 10);

  const userIdByName = new Map();
  for (const [id, user] of Object.entries(users)) {
    if (user && !user.deletedAt && user.name) userIdByName.set(normalizeName(user.name), id);
  }

  // userId -> { [key]: row } to accumulate before one write per user.
  const rowsByUser = new Map();
  const errors = [];
  let scanned = 0;
  for (const [accountId, account] of Object.entries(accounts)) {
    if (account?.deletedAt || !account?.actId) continue;
    if (only.length && !only.includes(accountId)) continue;
    const ownerId = account.userOwner && userIdByName.get(normalizeName(account.userOwner));
    if (!ownerId) continue;

    let goals = null;
    try {
      goals = await fetchCampaignResultGoals(account.actId, token);
    } catch {
      // Kolom Hasil jatuh ke daftar cadangan — spend-nya tetap terbaca.
    }
    let dayRows;
    try {
      dayRows = await fetchCampaignSpend(account.actId, token, { since, until }, goals);
    } catch (error) {
      errors.push({ name: account.name || account.actId, message: error.message });
      continue;
    }
    scanned++;
    const bucket = rowsByUser.get(ownerId) || {};
    for (const [key, row] of campaignHistoryEntries(accountId, account, dayRows, resolve, now)) {
      bucket[key] = row;
    }
    rowsByUser.set(ownerId, bucket);
  }

  let written = 0;
  for (const [userId, bucket] of rowsByUser) {
    const payload = {};
    for (const [key, row] of Object.entries(bucket)) {
      payload[`campaignHistory/${key}`] = row;
    }
    // Buang yang sudah lewat masa simpan sekalian, supaya rentang backfill yang lebih panjang dari
    // retensi tidak meninggalkan baris yang tak akan pernah dibersihkan sync harian.
    const reportsPath = userReportsPath(userId);
    const stored = (await get(ref(db, `${reportsPath}/campaignHistory`))).val() || {};
    const existing = { ...stored, ...bucket };
    for (const key of expiredCampaignHistoryKeys(existing, now)) {
      if (!(key in bucket)) payload[`campaignHistory/${key}`] = null;
    }
    if (Object.keys(payload).length === 0) continue;
    await update(ref(db, reportsPath), payload);
    written += Object.keys(bucket).length;
  }

  return { scanned, written, users: rowsByUser.size, errors, since, until };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) {
    console.error("Set META_ACCESS_TOKEN (System User token dari Business Manager).");
    process.exit(1);
  }
  const args = process.argv.slice(2);
  const days = Number(args[0]) > 0 ? Number(args[0]) : campaignHistoryDays();
  const only = args.filter((a) => !/^\d+$/.test(a));
  const db = await connect();
  const res = await backfill(db, token, { days, only });
  console.log(
    `Backfill riwayat spend campaign ${res.since}..${res.until}: ${res.written} baris ke ${res.users} user dari ${res.scanned} akun.`,
  );
  for (const e of res.errors) console.error(`Akun ${e.name}: ${e.message}`);
  process.exit(res.errors.length ? 1 : 0);
}

export { backfill };
