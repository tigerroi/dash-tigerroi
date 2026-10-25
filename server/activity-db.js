import { Database } from "bun:sqlite";

/**
 * Penyimpanan jejak aktivitas — SQLite lokal di VPS, bukan lagi RTDB.
 *
 * KENAPA PINDAH: node `activityLogs` adalah yang paling cepat tumbuh di seluruh database — tiap klik
 * tiap orang tiap hari — dan ia menumpang database yang dibaca halaman lain. Sebuah audit log yang
 * cuma ditulis di sini dan dibaca per rentang tanggal tidak butuh realtime RTDB; ia butuh satu file
 * yang bisa tumbuh sendiri tanpa menyeret yang lain.
 *
 * `bun:sqlite` bawaan Bun, jadi tidak ada dependency baru. Satu file, satu proses penulis (server
 * ini), pembacaan per rentang — persis yang SQLite kuat lakukan.
 */

// Kolom = persis field yang dihasilkan activityRow(). Didaftar sekali di sini supaya insert dan
// skema tidak bisa bergeser diam-diam satu sama lain.
const COLUMNS = [
  "id",
  "at",
  "receivedAt",
  "category",
  "action",
  "page",
  "label",
  "target",
  "detail",
  "status",
  "actorUid",
  "actorEmail",
  "actorRole",
  "ip",
  "city",
  "region",
  "country",
  "browser",
  "os",
  "device",
  "userAgent",
  "reportedByUid",
  "reportedByEmail",
];

export function openActivityDb(path = process.env.ACTIVITY_DB_PATH || "./activity.sqlite") {
  const db = new Database(path);
  // WAL: pembacaan halaman tidak memblokir penulisan batch yang datang lima menit sekali.
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS activity_logs (
      ${COLUMNS.map((c) => `"${c}" TEXT`).join(",\n      ")},
      PRIMARY KEY (id)
    );
    CREATE INDEX IF NOT EXISTS idx_activity_at ON activity_logs("at");
  `);

  // INSERT OR REPLACE berkunci id: batch yang sampai tapi jawabannya hilang di jaringan, lalu dikirim
  // ulang, menimpa baris yang sama alih-alih menggandakannya — sama persis dengan `update` berkunci
  // id di RTDB yang digantikannya.
  const insert = db.query(
    `INSERT OR REPLACE INTO activity_logs (${COLUMNS.map((c) => `"${c}"`).join(", ")})
     VALUES (${COLUMNS.map((c) => `$${c}`).join(", ")})`,
  );
  const insertMany = db.transaction((rows) => {
    for (const row of rows) {
      const params = {};
      for (const c of COLUMNS) params[`$${c}`] = row[c] ?? "";
      insert.run(params);
    }
    return rows.length;
  });

  return {
    db,

    insertRows(rows) {
      return insertMany(rows);
    },

    /**
     * Baris dalam rentang, TERBARU dulu dan dibatasi — cerminan `limitToLast` + `orderByChild("at")`
     * yang dulu dilakukan RTDB. `start`/`end` kosong = tanpa batas di sisi itu.
     */
    queryRange({ start = "", end = "", limit = 3000 } = {}) {
      const where = [];
      const params = {};
      if (start) {
        where.push(`"at" >= $start`);
        params.$start = start;
      }
      if (end) {
        where.push(`"at" <= $end`);
        params.$end = end;
      }
      const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
      params.$limit = limit;
      return db
        .query(`SELECT * FROM activity_logs ${clause} ORDER BY "at" DESC LIMIT $limit`)
        .all(params);
    },

    // Buang yang lewat masa simpan. Satu DELETE, bukan baca-lalu-hapus: yang menentukan cutoff sudah
    // dihitung pemanggil, dan SQLite menghapusnya lewat indeks `at` tanpa menarik satu baris pun.
    prune(cutoff) {
      const info = db.query(`DELETE FROM activity_logs WHERE "at" <= $cutoff`).run({
        $cutoff: cutoff,
      });
      return info.changes;
    },
  };
}
