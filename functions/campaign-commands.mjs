import { pathToFileURL } from "node:url";
import { connect } from "./db.mjs";
import { setCampaignStatus } from "./meta.js";
import { asStore } from "./store.mjs";
import {
  campaignCommandUpdate,
  expiredCampaignCommandKeys,
  pendingCampaignCommands,
  SYNC_ISSUES_PATH,
  syncIssuesUpdate,
} from "./sync-core.js";

/**
 * Penerap perintah on/off campaign — satu-satunya tempat `users/{uid}/campaignCommands` dibaca
 * dan dieksekusi ke Meta.
 *
 * Tombol di /users/{uid} hanya menulis niat ke RTDB (lihat `campaignCommandEntry` di sync-core.js).
 * Yang benar-benar memanggil Meta adalah fungsi ini, dan ia dipanggil dari tiga tempat yang semuanya
 * mengoper `store` yang sama (lihat store.mjs), jadi hasilnya tidak bisa berbeda karena jalurnya
 * berbeda:
 *
 *   - `applyCampaignCommands` terjadwal (scheduled-sync.js) — jalur yang bekerja di bawah DRS;
 *   - callable `setCampaignStatus` (index.js) — dipakai kalau DRS sudah dilonggarkan, seketika;
 *   - CLI `node campaign-commands.mjs` — jalan darurat kalau keduanya mati.
 *
 * Satu campaign yang gagal tidak menjatuhkan sisanya: token yang ditolak untuk satu akun iklan
 * tidak ada hubungannya dengan campaign milik user lain di antrean yang sama.
 */
export async function applyCampaignCommands(dbOrStore, token, now = new Date()) {
  const store = asStore(dbOrStore);
  const users = (await store.read("users")) || {};
  const commands = pendingCampaignCommands(users, now);

  let applied = 0;
  const errors = [];
  for (const command of commands) {
    const user = users[command.userId];
    const label = command.campaign || command.campaignId;
    // Perintah yang sudah terlalu lama menggantung tidak dieksekusi. Menyalakan campaign atas
    // keputusan enam jam lalu berarti membelanjakan uang tanpa ada yang memutuskannya sekarang.
    if (command.expired) {
      const error = "Perintah kedaluwarsa sebelum sempat diterapkan. Coba lagi kalau masih perlu.";
      await store.update(`users/${command.userId}`, campaignCommandUpdate(user, command, { ok: false, error }, now));
      errors.push({ command, message: error });
      continue;
    }

    try {
      await setCampaignStatus(command.campaignId, token, command.desiredStatus);
      await store.update(`users/${command.userId}`, campaignCommandUpdate(user, command, { ok: true }, now));
      applied++;
      console.log(`OK   ${command.desiredStatus} ${label}`);
    } catch (error) {
      await store.update(
        `users/${command.userId}`,
        campaignCommandUpdate(user, command, { ok: false, error: error.message }, now),
      );
      errors.push({ command, message: error.message });
      console.error(`FAIL ${command.desiredStatus} ${label}: ${error.message}`);
    }
  }

  const cleaned = await clearFinishedCommands(store, users, now);

  // Ditulis walau kosong, sama seperti cabang syncIssues yang lain: perintah yang gagal semalam
  // tidak boleh terus menyalakan ikon peringatan setelah percobaan berikutnya berhasil.
  await store.replace(
    `${SYNC_ISSUES_PATH}/campaignCommands`,
    syncIssuesUpdate(
      "Saklar campaign",
      errors.map(({ command, message }) => ({
        source: "Nyalakan/matikan campaign",
        target: command.campaign || command.campaignId,
        message,
        impact: `Campaign ini masih ${
          command.desiredStatus === "ACTIVE" ? "nonaktif" : "aktif"
        } di Meta — perintahnya tidak jadi dijalankan.`,
      })),
      now,
    ),
  );

  return { pending: commands.length, applied, failed: errors.length, cleaned, errors };
}

// Satu perintah, dieksekusi sekarang juga. Dipakai callable: ia sudah tahu perintah mana yang baru
// saja ditulis, jadi tidak perlu menyapu seluruh antrean untuk menemukannya.
export async function applyOneCampaignCommand(dbOrStore, token, userId, campaignId, now = new Date()) {
  const store = asStore(dbOrStore);
  const user = (await store.read(`users/${userId}`)) || {};
  const stored = user.campaignCommands?.[campaignId];
  if (!stored) throw new Error("Perintah campaign tidak ditemukan.");

  const command = { userId, campaignId, campaign: stored.campaign || "", desiredStatus: stored.desiredStatus };
  try {
    await setCampaignStatus(campaignId, token, stored.desiredStatus);
  } catch (error) {
    await store.update(`users/${userId}`, campaignCommandUpdate(user, command, { ok: false, error: error.message }, now));
    throw error;
  }
  await store.update(`users/${userId}`, campaignCommandUpdate(user, command, { ok: true }, now));
  return command;
}

async function clearFinishedCommands(store, users, now) {
  let cleaned = 0;
  for (const [userId, user] of Object.entries(users)) {
    const stale = expiredCampaignCommandKeys(user?.campaignCommands, now);
    if (!stale.length) continue;
    await store.update(
      `users/${userId}/campaignCommands`,
      Object.fromEntries(stale.map((key) => [key, null])),
    );
    cleaned += stale.length;
  }
  return cleaned;
}

// Dijalankan langsung sebagai CLI, atau diimpor sebagai modul?
//
// `file://${process.argv[1]}` benar di POSIX dan TIDAK PERNAH benar di Windows: argv[1] di sana
// berbentuk `D:\...\sync.mjs`, jadi ruas kanan jadi `file://D:\...` sementara `import.meta.url`
// berbunyi `file:///D:/...`. Yang terjadi bukan error melainkan DIAM — blok di bawah dilewati,
// tidak ada yang dikerjakan, dan prosesnya keluar dengan kode 0. Persis bentuk kegagalan yang
// paling mahal: `npm run sync:roi` tampak berhasil dan databasenya tidak berubah sedikit pun.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) {
    console.error("Set META_ACCESS_TOKEN (System User token dari Business Manager).");
    process.exit(1);
  }
  const db = await connect();
  const res = await applyCampaignCommands(db, token);
  console.log(
    `Perintah campaign: ${res.applied} diterapkan, ${res.failed} gagal, dari ${res.pending} antrean. ${res.cleaned} dibersihkan.`,
  );
  process.exit(res.failed ? 1 : 0);
}
