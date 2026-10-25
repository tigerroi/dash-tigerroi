import { Database } from "bun:sqlite";

/**
 * Penyimpanan log "Sync Otomatis" — pindah dari RTDB `dashboard/syncRuns` ke SQLite di VPS.
 *
 * Berbeda dari jejak aktivitas, YANG MENULISNYA adalah Cloud Function `scheduledSync`, bukan server
 * ini — dan itu tidak diubah. Ia tetap menulis `dashboard/syncRuns` di RTDB sebagai TITIPAN SESAAT;
 * `drainSyncRuns` (server/sync-runs.js) memindahkannya ke sini lalu menghapusnya dari RTDB, jadi
 * jalur kritis sync jam-tiga-pagi tidak tersentuh sama sekali dan baris lama ikut terbawa sendiri.
 *
 * Tabelnya di file SQLite yang SAMA dengan jejak aktivitas (ACTIVITY_DB_PATH) — satu file, dua
 * tabel. Kunci = stempel 14-digit yang ditulis syncRunKey, jadi urutan kunci = urutan waktu.
 */

const COLUMNS = [
  "key",
  "startedAt",
  "finishedAt",
  "durationSec",
  "ok",
  "failed",
  "summary",
  "stages",
];

export function syncLogKeep() {
  return Math.max(1, Number(process.env.SYNC_LOG_KEEP) || 100);
}

export function openSyncRunsDb(path = process.env.ACTIVITY_DB_PATH || "./activity.sqlite") {
  const db = new Database(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_runs (
      "key" TEXT PRIMARY KEY,
      "startedAt" TEXT,
      "finishedAt" TEXT,
      "durationSec" INTEGER,
      "ok" INTEGER,
      "failed" INTEGER,
      "summary" TEXT,
      "stages" TEXT
    );
  `);

  const insert = db.query(
    `INSERT OR REPLACE INTO sync_runs (${COLUMNS.map((c) => `"${c}"`).join(", ")})
     VALUES (${COLUMNS.map((c) => `$${c}`).join(", ")})`,
  );
  const insertMany = db.transaction((entries) => {
    for (const { key, entry } of entries) {
      insert.run({
        $key: String(key),
        $startedAt: entry.startedAt || "",
        $finishedAt: entry.finishedAt || "",
        $durationSec: Number(entry.durationSec || 0),
        $ok: entry.ok === false ? 0 : 1,
        $failed: Number(entry.failed || 0),
        $summary: entry.summary || "",
        // stages array/object -> JSON. Dibaca balik jadi array supaya bentuknya sama dengan yang
        // dulu datang dari RTDB (SyncLogPanel membaca run.stages sebagai array).
        $stages: JSON.stringify(entry.stages || []),
      });
    }
    return entries.length;
  });

  return {
    db,

    upsertRuns(entries) {
      return insertMany(entries);
    },

    // Run terbaru dulu, dibatasi — bentuk baris sama dengan yang dulu dibaca dari RTDB.
    recent(limit = syncLogKeep()) {
      return db
        .query(`SELECT * FROM sync_runs ORDER BY "key" DESC LIMIT $limit`)
        .all({ $limit: limit })
        .map(rowToRun);
    },

    // Sisakan `keep` terbaru; sisanya dibuang. Retensi log ada di SINI sekarang, bukan di RTDB.
    prune(keep = syncLogKeep()) {
      const info = db
        .query(
          `DELETE FROM sync_runs WHERE "key" NOT IN
             (SELECT "key" FROM sync_runs ORDER BY "key" DESC LIMIT $keep)`,
        )
        .run({ $keep: keep });
      return info.changes;
    },
  };
}

export function rowToRun(row) {
  let stages = [];
  try {
    stages = JSON.parse(row.stages || "[]");
  } catch {
    stages = [];
  }
  return {
    id: row.key,
    startedAt: row.startedAt || "",
    finishedAt: row.finishedAt || "",
    durationSec: Number(row.durationSec || 0),
    ok: row.ok !== 0,
    failed: Number(row.failed || 0),
    summary: row.summary || "",
    stages,
  };
}
