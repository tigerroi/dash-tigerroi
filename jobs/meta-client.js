/**
 * Klien Meta Marketing API — READ-ONLY
 * Hanya menggunakan izin ads_read dan read_insights.
 *
 * Dokumentasi: https://developers.facebook.com/docs/marketing-api/reference/ad-account
 * Keamanan: Tidak ada fungsi penulisan (POST/DELETE status atau salin campaign).
 */

const VERSION = process.env.META_API_VERSION || "v22.0";
const BASE = `https://graph.facebook.com/${VERSION}`;
const MINOR = Number(process.env.META_MINOR_UNIT || 1); // IDR = 1, USD/EUR = 100

const MIN_INTERVAL_MS = Number(process.env.META_MIN_INTERVAL_MS ?? 400);
const MAX_RETRIES = Number(process.env.META_MAX_RETRIES ?? 3);
const RETRY_BASE_MS = Number(process.env.META_RETRY_BASE_MS ?? 1000);

// Kode error sementara dari Meta yang layak diulang
const RETRYABLE_CODES = new Set([1, 2, 4, 17, 32, 341, 613, 80000, 80001, 80002, 80003, 80004]);

let queue = Promise.resolve();
let nextCallAt = 0;
let backoffUntil = 0;

const sleep = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

function schedule(task) {
  const run = queue.then(async () => {
    const delay = Math.max(0, Math.max(nextCallAt, backoffUntil) - Date.now());
    if (delay > 0) await sleep(delay);
    try {
      return await task();
    } finally {
      nextCallAt = Date.now() + MIN_INTERVAL_MS;
    }
  });

  queue = run.then(
    () => {},
    () => {},
  );
  return run;
}

function observeUsage(res) {
  const header = res?.headers?.get?.("x-app-usage") || res?.headers?.get?.("x-ad-account-usage");
  if (!header) return;
  try {
    const usage = JSON.parse(header);
    const peak = Math.max(...Object.values(usage).filter((v) => typeof v === "number"), 0);
    if (peak >= 95) backoffUntil = Date.now() + 60_000;
    else if (peak >= 75) backoffUntil = Date.now() + 10_000;
  } catch {
    // Abaikan jika format header bukan json valid
  }
}

function retryDelay(error, attempt) {
  if (attempt >= MAX_RETRIES || !RETRYABLE_CODES.has(error?.code)) return null;
  const minutes = Number(error?.error_data?.estimated_time_to_regain_access) || 0;
  if (minutes > 0) return Math.min(minutes * 60_000, 300_000);
  return 2 ** attempt * RETRY_BASE_MS;
}

function graphUrl(path, token, params = {}) {
  const url = new URL(`${BASE}/${path}`);
  url.searchParams.set("access_token", token);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) {
      url.searchParams.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
    }
  }
  return url;
}

async function parseGraphBody(res) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    const snippet = text.replace(/\s+/g, " ").trim().slice(0, 100);
    return {
      error: {
        message: `Respons non-JSON dari Meta (HTTP ${res.status}): ${snippet}`,
      },
    };
  }
}

function describeGraphError(error, status) {
  if (!error) return `HTTP ${status}`;
  const code = [error.code, error.error_subcode].filter(Boolean).join("-");
  const msg = error.message || `HTTP ${status}`;
  return code ? `${msg} (#${code})` : msg;
}

async function requestGraph(path, token, params = {}) {
  const url = graphUrl(path, token, params);

  for (let attempt = 0; ; attempt++) {
    const { res, data } = await schedule(async () => {
      const res = await fetch(url, { method: "GET" });
      observeUsage(res);
      return { res, data: await parseGraphBody(res) };
    });

    if (res.ok && !data.error) {
      return data;
    }

    const wait = retryDelay(data.error, attempt);
    if (wait === null) {
      throw new Error(`Meta API error pada /${path}: ${describeGraphError(data.error, res.status)}`);
    }
    await sleep(wait);
  }
}

async function graphAll(path, token, params = {}) {
  let url = graphUrl(path, token, params);
  const rows = [];

  for (let page = 0; url && page < 50; page++) {
    const data = await schedule(async () => {
      const res = await fetch(url, { method: "GET" });
      observeUsage(res);
      return parseGraphBody(res);
    });

    if (data.error) {
      throw new Error(`Meta API pagination error pada /${path}: ${describeGraphError(data.error, 400)}`);
    }

    rows.push(...(data.data || []));
    url = data.paging?.next ? new URL(data.paging.next) : null;
  }

  return rows;
}

function normalizeActId(actId) {
  const raw = String(actId || "").trim();
  return raw.startsWith("act_") ? raw : `act_${raw}`;
}

function toMajor(minorString) {
  const n = Number(minorString);
  return Number.isFinite(n) ? n / MINOR : 0;
}

/**
 * Mengambil ringkasan saldo, limit, dan status akun iklan Meta.
 */
export async function fetchAccountOverview(actId, token) {
  const id = normalizeActId(actId);
  const acc = await requestGraph(id, token, {
    fields: "id,name,balance,amount_spent,spend_cap,currency,account_status",
  });

  const spendCap = toMajor(acc.spend_cap);
  const amountSpent = toMajor(acc.amount_spent);

  return {
    id: acc.id || id,
    name: acc.name || "",
    currency: acc.currency || "IDR",
    accountStatus: acc.account_status,
    spendCap,
    amountSpent,
    balance: toMajor(acc.balance),
    remainingBudget: spendCap > 0 ? Math.max(0, Math.round((spendCap - amountSpent) * 100) / 100) : 0,
  };
}

/**
 * Mengambil data spend, impressions, clicks harian di level campaign.
 * Rentang waktu: { since: "YYYY-MM-DD", until: "YYYY-MM-DD" }
 */
export async function fetchCampaignInsights(actId, token, dateRange) {
  const id = normalizeActId(actId);
  const params = {
    level: "campaign",
    fields: "campaign_id,campaign_name,spend,impressions,clicks,cpc",
    limit: "500",
  };

  if (dateRange?.since && dateRange?.until) {
    params.time_range = { since: dateRange.since, until: dateRange.until };
    params.time_increment = "1"; // Return per hari
  } else {
    params.date_preset = "today";
  }

  const rows = await graphAll(`${id}/insights`, token, params);

  return rows.map((r) => ({
    date: r.date_start || dateRange?.since || new Date().toISOString().slice(0, 10),
    campaignId: String(r.campaign_id || ""),
    campaignName: r.campaign_name || "",
    spend: Number(r.spend || 0),
    impressions: Number(r.impressions || 0),
    clicks: Number(r.clicks || 0),
    cpc: Number(r.cpc || 0),
  }));
}
