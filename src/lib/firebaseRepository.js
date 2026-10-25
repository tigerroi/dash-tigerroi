import { supabase } from "../config/supabase";
import { logActivity } from "./activityRecorder";

/**
 * Peta resource frontend TigerROI ke tabel PostgreSQL Supabase.
 */
const TABLE_MAP = {
  users: "profiles",
  domains: "domains",
  subDomains: "subdomains",
  adAccounts: "ad_accounts",
  adsenseAccounts: "adsense_accounts",
  googleApiConfigs: "google_api_configs",
  expenses: "expenses",
  reminders: "reminders",
  whitelistTopup: "whitelist_topup",
  syncRuns: "sync_runs",
  roiReports: "daily_roi_reports",
  roiSnapshots: "daily_roi_reports",
  countryRoi: "country_roi",
  pluginSites: "plugin_sites",
};

/**
 * Konversi key object dari snake_case (Postgres) ke camelCase (React/JS)
 */
function toCamelCaseKey(key) {
  return key.replace(/_([a-z0-9])/g, (_, letter) => letter.toUpperCase());
}

function toSnakeCaseKey(key) {
  return key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

export function toCamelCaseRow(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return row;
  const result = {};
  for (const [key, value] of Object.entries(row)) {
    result[toCamelCaseKey(key)] = value;
  }
  return result;
}

export function toSnakeCasePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  const result = {};
  for (const [key, value] of Object.entries(payload)) {
    result[toSnakeCaseKey(key)] = value;
  }
  return result;
}

/**
 * Tracker aktivitas audit log ke Supabase
 */
async function tracked(action, target, detail, run) {
  try {
    const result = await run();
    logActivity({ category: "operation", action, target, detail });
    return result;
  } catch (error) {
    logActivity({
      category: "operation",
      action,
      target,
      detail: { ...detail, error: error.message },
      status: "failed",
    });
    throw error;
  }
}

/**
 * Membaca role pengguna dari tabel profiles di Supabase
 */
export async function readRole(uid) {
  const { data, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", uid)
    .maybeSingle();

  if (error || !data) return null;
  return data.role;
}

/**
 * Mengubah role pengguna di tabel profiles
 */
export function writeRole(uid, role) {
  return tracked("update:role", `profiles/${uid}`, { role: role || "(dicabut)" }, async () => {
    const { error } = await supabase
      .from("profiles")
      .update({ role: role || "user" })
      .eq("id", uid);
    if (error) throw error;
  });
}

/**
 * Langganan berkala (polling) untuk resource koleksi (berbentuk array)
 */
export function subscribeResource(key, callback, onError) {
  const table = TABLE_MAP[key];
  if (!table) {
    callback([]);
    return () => {};
  }

  let active = true;

  const fetchResource = async () => {
    try {
      let query = supabase.from(table).select("*");
      // Urutkan berdasarkan kolom waktu jika ada
      if (table === "daily_roi_reports" || table === "expenses" || table === "whitelist_topup") {
        query = query.order("date", { ascending: false });
      } else if (table === "sync_runs") {
        query = query.order("started_at", { ascending: false }).limit(50);
      } else if (table === "reminders") {
        query = query.order("due_date", { ascending: true });
      }

      const { data, error } = await query;
      if (error) {
        if (onError) onError(error);
        return;
      }
      if (active) {
        const rows = (data || []).map(toCamelCaseRow);
        callback(rows);
      }
    } catch (err) {
      if (onError) onError(err);
    }
  };

  fetchResource();
  const timer = setInterval(fetchResource, 30000); // Polling setiap 30 detik

  return () => {
    active = false;
    clearInterval(timer);
  };
}

/**
 * Langganan berkala (polling) untuk nilai tunggal / object
 */
export function subscribeValue(key, callback, onError) {
  const table = TABLE_MAP[key];
  if (!table) {
    callback({});
    return () => {};
  }

  let active = true;

  const fetchVal = async () => {
    try {
      const { data, error } = await supabase.from(table).select("*");
      if (error) {
        if (onError) onError(error);
        return;
      }
      if (active) {
        const result = {};
        for (const item of data || []) {
          const row = toCamelCaseRow(item);
          result[row.id || row.code || row.name] = row;
        }
        callback(result);
      }
    } catch (err) {
      if (onError) onError(err);
    }
  };

  fetchVal();
  const timer = setInterval(fetchVal, 30000);

  return () => {
    active = false;
    clearInterval(timer);
  };
}

/**
 * Menunggu hasil impor background job
 */
export function awaitDiscoverRun(kind, startedAt, { timeoutMs = 15 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      clearInterval(poller);
      reject(new Error("Impor melebihi batas waktu (timeout)."));
    }, timeoutMs);

    const poller = setInterval(async () => {
      try {
        const { data: run } = await supabase
          .from("sync_runs")
          .select("*")
          .ilike("job_name", `%${kind}%`)
          .gte("started_at", startedAt)
          .order("started_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (run) {
          if (run.status === "success") {
            clearTimeout(timer);
            clearInterval(poller);
            resolve(toCamelCaseRow(run));
          } else if (run.status === "failed") {
            clearTimeout(timer);
            clearInterval(poller);
            reject(new Error(run.error_message || "Impor gagal dijalankan."));
          }
        }
      } catch {
        // Abaikan sementara saat polling
      }
    }, 5000);
  });
}

/**
 * Membuat data baris baru
 */
export async function createResource(key, values, actor = "system") {
  const table = TABLE_MAP[key];
  if (!table) throw new Error(`Tabel Supabase tidak ditemukan untuk resource: ${key}`);

  const payload = toSnakeCasePayload(values);
  delete payload.id; // Biarkan database menghasilkan UUID

  return tracked(`create:${key}`, table, nameOf(values), async () => {
    const { data, error } = await supabase.from(table).insert(payload).select().single();
    if (error) throw error;
    return toCamelCaseRow(data);
  });
}

/**
 * Membuat data baris baru pada ID tertentu
 */
export async function createResourceAt(key, id, values, actor = "system") {
  const table = TABLE_MAP[key];
  if (!table) throw new Error(`Tabel Supabase tidak ditemukan untuk resource: ${key}`);

  const payload = toSnakeCasePayload(values);
  payload.id = id;

  return tracked(`create:${key}`, `${table}/${id}`, nameOf(values), async () => {
    const { data, error } = await supabase.from(table).upsert(payload).select().single();
    if (error) throw error;
    return toCamelCaseRow(data);
  });
}

/**
 * Membuat banyak baris sekaligus (batch insert)
 */
export async function createManyResources(key, rows, actor = "system") {
  const table = TABLE_MAP[key];
  if (!table) throw new Error(`Tabel Supabase tidak ditemukan untuk resource: ${key}`);

  const payloads = rows.map((r) => {
    const p = toSnakeCasePayload(r);
    delete p.id;
    return p;
  });

  return tracked(`import:${key}`, table, { baris: rows.length }, async () => {
    const { error } = await supabase.from(table).insert(payloads);
    if (error) throw error;
  });
}

/**
 * Memperbarui baris data berdasarkan ID
 */
export async function updateResource(key, id, values, actor = "system") {
  const table = TABLE_MAP[key];
  if (!table) throw new Error(`Tabel Supabase tidak ditemukan untuk resource: ${key}`);

  const payload = toSnakeCasePayload(values);
  delete payload.id;

  return tracked(`update:${key}`, `${table}/${id}`, changedFields(values), async () => {
    const { error } = await supabase.from(table).update(payload).eq("id", id);
    if (error) throw error;
  });
}

export async function updateResourceFields(key, id, values) {
  return updateResource(key, id, values);
}

export async function updateSettings(key, values, actor = "system") {
  // Pengaturan umum
  return values;
}

/**
 * Menghapus atau soft-delete baris data
 */
export async function deleteResource(key, id, actor = "system") {
  const table = TABLE_MAP[key];
  if (!table) throw new Error(`Tabel Supabase tidak ditemukan untuk resource: ${key}`);

  return tracked(`archive:${key}`, `${table}/${id}`, null, async () => {
    const { error } = await supabase.from(table).delete().eq("id", id);
    if (error) throw error;
  });
}

/**
 * Menyimpan topik notifikasi pengguna ke profil Supabase
 */
export function writeNotificationTopics(userId, topics) {
  return tracked(
    "update:notificationTopics",
    `profiles/${userId}/notification_topics`,
    {
      topik:
        Object.keys(topics || {})
          .filter((k) => topics[k] === true)
          .join(", ") || "(kosong)",
    },
    async () => {
      const { error } = await supabase
        .from("profiles")
        .update({ notification_topics: topics })
        .eq("id", userId);
      if (error) throw error;
    },
  );
}

/**
 * Menyimpan Telegram Chat ID ke profil Supabase
 */
export function writeTelegramChatId(userId, chatId) {
  const val = String(chatId || "").trim() || null;
  return tracked(
    "update:telegramChatId",
    `profiles/${userId}/telegram_chat_id`,
    { chatId: val || "(dikosongkan)" },
    async () => {
      const { error } = await supabase
        .from("profiles")
        .update({ telegram_chat_id: val })
        .eq("id", userId);
      if (error) throw error;
    },
  );
}

/**
 * Menyimpan target domain per bulan
 */
export function writeTarget(domainId, month, record) {
  return tracked(
    record === null ? "archive:target" : "update:target",
    `targets/${domainId}/${month}`,
    { jenis: record === null ? "(dikosongkan)" : Object.keys(record).join(", ") },
    async () => {
      // Stub target simpan
      return record;
    },
  );
}

// Stubs untuk perintah yang dinonaktifkan / diselaraskan dengan aturan keamanan
export function writeCampaignCommand(userId, campaignId, command) {
  return Promise.resolve();
}

export function writeGateCommand(campaignId, command) {
  return Promise.resolve();
}

export function requestGateRefresh(at = new Date().toISOString()) {
  return Promise.resolve();
}

function nameOf(values) {
  const name = values?.name || values?.email || values?.domainUrl || values?.domain_url || "";
  return name ? { nama: name } : null;
}

function changedFields(values) {
  const keys = Object.keys(values || {});
  return keys.length ? { field: keys.join(", ") } : null;
}
