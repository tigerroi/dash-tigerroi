import { Elysia, status, t } from "elysia";
import { AuthError, bearerToken, requireAdmin } from "./auth.js";
import { rowToRun, syncLogKeep } from "./sync-runs-db.js";

const RTDB_PATH = "dashboard/syncRuns";
// Kunci yang sah = stempel 14-digit yang ditulis syncRunKey. Yang lain diabaikan, bukan dipindahkan.
const KEY_PATTERN = /^\d{14}$/;

// Berapa run TERBARU yang ditinggalkan di RTDB sebagai ekor live. Ikon peringatan topbar
// (SyncIssuesAlert) membaca tahap-gagal run terbaru dari langganan RTDB store — kalau seluruhnya
// dipindah ke SQLite, topbar kehilangan sinyal itu. Dua, bukan satu: beri margin supaya run yang
// baru selesai tidak sempat terpindah sedetik sebelum topbar membacanya.
const KEEP_LIVE = 2;

// Entry mentah RTDB -> bentuk baris yang sama dengan sqlite (rowToRun), supaya hasil merge seragam.
function entryToRun(key, entry) {
  return rowToRun({
    key,
    startedAt: entry?.startedAt || "",
    finishedAt: entry?.finishedAt || "",
    durationSec: entry?.durationSec || 0,
    ok: entry?.ok === false ? 0 : 1,
    failed: entry?.failed || 0,
    summary: entry?.summary || "",
    stages: JSON.stringify(entry?.stages || []),
  });
}

/**
 * Pindahkan titipan RTDB `dashboard/syncRuns` ke SQLite, lalu hapus dari RTDB.
 *
 * Upsert DULU, hapus belakangan: kalau penghapusan gagal, drain berikutnya meng-upsert ulang (idem-
 * poten lewat kunci) dan mencoba menghapus lagi — tidak ada baris yang hilang di antaranya. Baris
 * lama yang sudah ada di RTDB sebelum fitur ini ikut terbawa di drain pertama, jadi tidak perlu
 * skrip migrasi terpisah.
 */
export async function drainSyncRuns({
  store,
  syncRunsDb,
  keep = syncLogKeep(),
  keepLive = KEEP_LIVE,
}) {
  const runs = (await store.read(RTDB_PATH)) || {};
  const keys = Object.keys(runs).filter((key) => KEY_PATTERN.test(key));
  if (!keys.length) return { drained: 0 };

  // Semua run disalin ke SQLite (idempoten) — termasuk ekor live, supaya riwayatnya lengkap. Yang
  // TIDAK dihapus dari RTDB hanyalah `keepLive` terbaru: itu ekor yang dibaca topbar.
  syncRunsDb.upsertRuns(keys.map((key) => ({ key, entry: runs[key] })));

  const sorted = [...keys].sort();
  const drainable = sorted.slice(0, Math.max(0, sorted.length - keepLive));
  if (drainable.length) {
    const removals = {};
    for (const key of drainable) removals[key] = null;
    await store.update(RTDB_PATH, removals);
  }

  syncRunsDb.prune(keep);
  return { drained: drainable.length };
}

// Run yang mengaku berjalan lebih lama dari ini dianggap mati (Cloud Function kena batas 9 menit
// tanpa sempat menutup `syncStatus.running`), dan tidak lagi menahan tombol jalankan ulang.
const STALE_RUN_MS = 15 * 60 * 1000;

/**
 * `syncStage` (dari index.js): `{ names() , busy(), start(stage, actor) }`. Tanpa itu route
 * jalankan-ulang menjawab 503 — dipisah supaya berkas ini tetap bisa dites tanpa proses sync.
 */
export function syncRunsRoutes({ db, store, syncRunsDb, authorize, syncStage = null }) {
  // Baca halaman Settings -> admin (halaman itu admin). Sepola dengan gerbang GET jejak aktivitas.
  const check = authorize || ((token) => requireAdmin(db, token));

  return (
    new Elysia({ prefix: "/sync-runs" })
      .macro({
        admin: {
          async resolve({ headers }) {
            try {
              return { actor: await check(bearerToken(headers.authorization)) };
            } catch (error) {
              if (error instanceof AuthError) return status(error.status, { error: error.message });
              return status(503, { error: `Izin tidak bisa diperiksa sekarang: ${error.message}` });
            }
          },
        },
      })

      /**
       * Log run sync otomatis untuk halaman Settings.
       *
       * Menggabung SQLite (tempat tinggalnya sekarang) dengan RTDB yang BELUM sempat di-drain — jadi
       * run yang barusan ditulis Cloud Function tetap tampil walau cron drain belum jalan. Dedup lewat
       * kunci; kalau ada di keduanya, isinya sama.
       */
      .get(
        "",
        async () => {
          const keep = syncLogKeep();
          const byKey = new Map();
          for (const run of syncRunsDb.recent(keep)) byKey.set(run.id, run);

          // Jangan biarkan RTDB yang tak terjangkau menjatuhkan bacaan: yang sudah di SQLite tetap
          // tampil. Yang belum ter-drain baru hilang sampai drain berikutnya — bukan kehilangan data.
          try {
            const live = (await store.read(RTDB_PATH)) || {};
            for (const [key, entry] of Object.entries(live)) {
              if (KEY_PATTERN.test(key)) byKey.set(key, entryToRun(key, entry));
            }
          } catch {
            // biarkan, pakai yang dari SQLite saja
          }

          const runs = [...byKey.values()]
            .sort((left, right) => String(right.id).localeCompare(String(left.id)))
            .slice(0, keep);
          return { runs };
        },
        { admin: true },
      )

      /**
       * Jalankan SATU tahap sync sekarang, tanpa menunggu run berikutnya.
       *
       * Menjawab begitu run-nya berangkat; hasilnya tercatat di log run yang sama (ringkasannya
       * berawalan "Manual") dan badge "Syncing..." di topbar menyala selama ia berjalan. Ditolak 409
       * selama run lain berjalan — di proses ini, ATAU menurut `syncStatus.running` (di instansi 1
       * run penuhnya milik Cloud Functions, proses lain yang tidak berbagi penjaga dengan server ini).
       */
      .post(
        "/stages",
        async ({ body, actor }) => {
          if (!syncStage) return status(503, { error: "Server ini tidak bisa menjalankan sync." });
          if (!syncStage.names().includes(body.stage)) {
            return status(422, { error: `Tahap "${body.stage}" tidak ada di sync server ini.` });
          }
          const current = (await store.read("dashboard/syncStatus")) || {};
          const age = Date.now() - Date.parse(current.startedAt || "");
          if (syncStage.busy() || (current.running && age < STALE_RUN_MS)) {
            return status(409, { error: "Sync sedang berjalan — tunggu sampai selesai." });
          }
          syncStage.start(body.stage, actor?.email || actor?.uid || "");
          return { started: true, stage: body.stage };
        },
        { admin: true, body: t.Object({ stage: t.String({ minLength: 1, maxLength: 60 }) }) },
      )
  );
}
