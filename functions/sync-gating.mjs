import { pathToFileURL } from "node:url";
import { connect } from "./db.mjs";
import {
  expiredGateCommandKeys,
  GATE_RUNS_LIMIT,
  GATING_PATH,
  gateCampaignsMap,
  gateCommandUpdate,
  gateIssue,
  gateKey,
  gatePreviewRow,
  gateProblemIssue,
  gateRunsMap,
  gateStatusEntry,
  mirrorDue,
  pendingGateCommands,
  previewTargets,
  subDomainCampaignUrls,
} from "./gating-core.js";
import {
  gateCampaign,
  listCampaigns,
  listGateRuns,
  previewCampaign,
  ungateCampaign,
} from "./keitaro-gate.js";
import { asStore } from "./store.mjs";
import { SYNC_ISSUES_PATH, syncIssuesUpdate } from "./sync-core.js";

/**
 * Gating campaign Keitaro — cermin di RTDB dan penerap antrean perintah.
 *
 * Dua arah, seperti saklar on/off campaign:
 *
 *   masuk  — `refreshGateMirror` membaca /campaigns, /gate-runs, dan pratinjau kandidat, lalu
 *            menulisnya ke `dashboard/gating` supaya halaman bisa menampilkannya tanpa API key;
 *   keluar — `applyGateCommands` mengeksekusi niat yang ditulis halaman ke antrean.
 *
 * Dijalankan dari dua tempat yang mengoper `store` yang sama (lihat store.mjs), jadi hasilnya tidak
 * bisa berbeda karena jalurnya berbeda: `scheduledGating` (scheduled-sync.js) dan CLI di bawah.
 */

// Pratinjau diambil beberapa sekaligus. Berurutan, 55 campaign berarti ~40 detik hanya untuk
// mengisi kolom yang belum tentu dibuka siapa pun; sekaligus semua, kita meletuskan puluhan
// request ke Keitaro dalam sedetik — bentuk beban yang persis dihindari antrean throttle Meta.
const PREVIEW_CONCURRENCY = Number(process.env.GATE_PREVIEW_CONCURRENCY || 4);

export async function applyGateCommands(dbOrStore, apiKey, now = new Date()) {
  const store = asStore(dbOrStore);
  const stored = (await store.read(`${GATING_PATH}/commands`)) || {};
  const commands = pendingGateCommands(stored, now);

  const cleaned = await clearFinishedCommands(store, stored, now);
  if (!commands.length) {
    return { pending: 0, applied: 0, failed: 0, cleaned, issues: [], campaigns: null };
  }

  // Dibaca SEKALI di sini dan dioper ke penyegaran cermin: daftar yang sama menjawab dua
  // pertanyaan, dan membacanya dua kali dalam satu run berarti dua kali ~3 detik di sisi Keitaro
  // untuk jawaban yang sudah kita punya.
  let campaigns;
  try {
    campaigns = await listCampaigns(apiKey);
  } catch (error) {
    // Perintahnya TIDAK ditandai gagal. Daftar yang tidak terbaca tidak mengabarkan apa pun
    // tentang campaign-nya, dan menggagalkan perintah orang karena satu bacaan yang meleset
    // berarti ia harus menekan tombolnya lagi untuk sesuatu yang tidak pernah dicoba. Run
    // berikutnya dua menit lagi; yang benar-benar basi dibuang TTL-nya sendiri.
    const issues = commands.map((command) =>
      gateIssue(command, `Daftar campaign Keitaro gagal dibaca: ${error.message}`),
    );
    return { pending: commands.length, applied: 0, failed: 0, cleaned, issues, campaigns: null };
  }

  const byId = new Map(campaigns.map((campaign) => [String(campaign.id), campaign]));
  const issues = [];
  let applied = 0;
  let failed = 0;

  for (const command of commands) {
    const guard = guardReason(command, byId.get(command.campaignId));
    if (guard) {
      await store.update(GATING_PATH, gateCommandUpdate(command, { error: guard }, now));
      issues.push(gateIssue(command, guard));
      failed++;
      console.error(`SKIP ${command.action} ${command.campaign || command.campaignId}: ${guard}`);
      continue;
    }

    try {
      const result =
        command.action === "gate"
          ? await gateCampaign(command.campaignId, apiKey)
          : await ungateCampaign(command.campaignId, apiKey);

      await store.update(GATING_PATH, gateCommandUpdate(command, result, now));

      if (result?.status === "ok") {
        applied++;
        // `reload.ok: false` BUKAN kegagalan: perubahannya sudah tersimpan, gate-nya saja yang
        // belum menyerapnya dan akan membacanya sendiri saat polling. Dicatat sebagai catatan
        // kecil, bukan diangkat jadi isu — mengangkatnya berarti ikon peringatan di topbar menyala
        // untuk sesuatu yang selesai sendiri semenit kemudian.
        if (result?.reload?.ok === false) {
          console.log(
            `NOTE ${command.campaignId}: gate belum memuat ulang site-nya, akan menyusul.`,
          );
        }
        if (result?.verification?.cleanupComplete === false) {
          issues.push({
            source: "Gating",
            target: command.campaign || `Campaign ${command.campaignId}`,
            message: "Ada baris uji yang tertinggal di data vi-control.",
            impact: "Routing-nya benar; baris uji itu perlu dihapus manual.",
          });
        }
        console.log(`OK   ${command.action} ${command.campaign || command.campaignId}`);
        continue;
      }

      failed++;
      if (result?.status === "problem") {
        // Tersimpan tapi tidak terbukti benar. Ini bukan "gagal, coba lagi" — mengulanginya tidak
        // memperbaiki apa pun, dan yang dibutuhkan adalah seseorang yang membuka Keitaro.
        issues.push(gateProblemIssue(command, result));
      } else {
        issues.push(
          gateIssue(
            command,
            blockerText(result) || `vi-control menolak: "${result?.status || "tanpa status"}".`,
          ),
        );
      }
      console.error(`FAIL ${command.action} ${command.campaignId}: ${result?.status}`);
    } catch (error) {
      await store.update(GATING_PATH, gateCommandUpdate(command, { error: error.message }, now));
      issues.push(gateIssue(command, error.message));
      failed++;
      console.error(`FAIL ${command.action} ${command.campaignId}: ${error.message}`);
    }
  }

  return { pending: commands.length, applied, failed, cleaned, issues, campaigns };
}

/**
 * Satu perintah, dieksekusi sekarang juga — jalur interaktif server Elysia (lihat server/gating.js).
 *
 * Ia sudah tahu perintah mana yang baru ditulis, jadi tidak menyapu antrean untuk menemukannya.
 * Yang penting: ia memakai `guardReason` dan `gateCommandUpdate` yang SAMA dengan penerap cron di
 * atas, jadi menekan tombol tidak bisa menghasilkan keputusan yang berbeda dari menunggu cron —
 * termasuk penjaga gate-ganda, yang justru paling gawat kalau cuma ada di salah satu jalur.
 *
 * Perintahnya ditulis ke antrean DULU, lalu dieksekusi. Urutan ini yang membuat proses yang mati di
 * tengah panggilan ke vi-control meninggalkan perintah "pending" yang diselesaikan cron berikutnya,
 * alih-alih sebuah perubahan routing yang terjadi tanpa satu pun jejak.
 */
export async function applyOneGateCommand(dbOrStore, apiKey, entry, now = new Date()) {
  const store = asStore(dbOrStore);
  const key = gateKey(entry.campaignId);
  await store.update(`${GATING_PATH}/commands`, { [key]: entry });

  const command = {
    key,
    campaignId: String(entry.campaignId),
    campaign: entry.campaign || "",
    action: entry.action,
    expired: false,
  };

  // Dibaca segar, bukan dari cermin. Cermin boleh berumur sepuluh menit, dan yang dijaga di sini
  // adalah gate-ganda — satu-satunya kesalahan di halaman ini yang tidak bisa dibatalkan dengan
  // menekan tombol sebelahnya.
  const campaigns = await listCampaigns(apiKey);
  const campaign = campaigns.find((item) => String(item.id) === command.campaignId);

  const guard = guardReason(command, campaign);
  if (guard) {
    await store.update(GATING_PATH, gateCommandUpdate(command, { error: guard }, now));
    // "aborted", memakai kosakata vi-control apa adanya: artinya persis sama — ditolak, dan tidak
    // ada yang ditulis sama sekali. Kata kedua untuk hal yang sama hanya memaksa sisi UI memetakan
    // dua nama ke satu tampilan.
    return { status: "aborted", error: guard, command };
  }

  let result;
  try {
    result =
      command.action === "gate"
        ? await gateCampaign(command.campaignId, apiKey)
        : await ungateCampaign(command.campaignId, apiKey);
  } catch (error) {
    await store.update(GATING_PATH, gateCommandUpdate(command, { error: error.message }, now));
    throw error;
  }

  await store.update(GATING_PATH, gateCommandUpdate(command, result, now));
  return { status: result?.status || "", result, command };
}

/**
 * Kenapa sebuah perintah tidak boleh dijalankan, atau "" kalau boleh.
 *
 * Yang paling penting di sini adalah gate ganda. Pratinjau untuk campaign yang SUDAH di-gate tetap
 * menjawab `applicable: true`, dengan tujuan yang menunjuk ke URL gate itu sendiri — jadi gate
 * kedua akan memasang gate di depan gate, dan tidak ada apa pun di sisi vi-control yang
 * menghentikannya. Yang menentukan boleh atau tidak adalah `gated` dari daftar campaign, dibaca
 * ulang sedetik sebelum menulis, bukan yang dilihat orang di layar beberapa menit lalu.
 */
function guardReason(command, campaign) {
  if (command.expired) {
    return "Perintah kedaluwarsa sebelum sempat diterapkan. Coba lagi kalau masih perlu.";
  }
  if (!campaign) {
    return "Campaign ini tidak ada lagi di Keitaro.";
  }
  if (campaign.gated === null || campaign.gated === undefined) {
    return "Status gating campaign ini tidak terbaca dari Keitaro — dicoba lagi setelah terbaca.";
  }
  if (command.action === "gate" && campaign.gated === true) {
    return "Campaign ini sudah lewat gate. Menggating-nya lagi akan memasang gate di depan gate.";
  }
  if (command.action === "ungate" && campaign.gated === false) {
    return "Campaign ini memang belum lewat gate — tidak ada yang perlu dikembalikan.";
  }
  return "";
}

function blockerText(result) {
  const blockers = result?.plan?.blockers;
  return Array.isArray(blockers) && blockers.length ? blockers.join("; ") : "";
}

/**
 * Cermin: daftar campaign, pratinjau kandidat, riwayat, dan ringkasannya.
 *
 * `campaigns` boleh dioper dari penerap perintah yang baru saja membacanya — tapi hanya kalau tidak
 * ada perintah yang dieksekusi setelahnya, karena daftar itu memotret keadaan SEBELUM gating.
 */
export async function refreshGateMirror(dbOrStore, apiKey, now = new Date(), preloaded = null) {
  const store = asStore(dbOrStore);
  const issues = [];

  const campaigns = preloaded || (await listCampaigns(apiKey));

  // Ditulis utuh, bukan di-merge: campaign yang dihapus di Keitaro harus ikut hilang dari tabel.
  // Baris yang bertahan karena tidak ada yang menghapusnya adalah baris yang tombolnya menunjuk ke
  // sesuatu yang tidak ada lagi.
  await store.replace(`${GATING_PATH}/campaigns`, gateCampaignsMap(campaigns));

  // Link iklan tiap subdomain, dari daftar yang baru saja dibaca. Ditulis ke baris subdomainnya
  // sendiri karena cermin di atas hanya dilanggan superadmin — lihat `subDomainCampaignUrls`.
  //
  // TIDAK menjatuhkan penyegaran cermin kalau gagal, dan itu alasan yang sama dengan riwayat di
  // bawah: yang hilang cuma satu kolom di halaman lain, sementara tabel gating-nya sudah benar.
  try {
    const subDomains = (await store.read("subDomains")) || {};
    const update = subDomainCampaignUrls(campaigns, subDomains);
    if (Object.keys(update).length) await store.update("subDomains", update);
  } catch (error) {
    issues.push({
      source: "Campaign URL subdomain",
      target: "/sub-domains",
      message: error.message,
      impact: "Kolom Campaign URL di halaman Sub Domains menampilkan link lama.",
    });
  }

  const previews = {};
  const targets = previewTargets(campaigns);
  for (const batch of chunk(targets, PREVIEW_CONCURRENCY)) {
    const results = await Promise.allSettled(
      batch.map((id) => previewCampaign(id, apiKey).then((preview) => [id, preview])),
    );
    for (const [index, result] of results.entries()) {
      if (result.status === "fulfilled") {
        const [id, preview] = result.value;
        previews[gateKey(id)] = gatePreviewRow(id, preview, now);
        continue;
      }
      const id = batch[index];
      // Satu pratinjau yang gagal tidak menjatuhkan sisanya, tapi juga tidak diam: tanpa pratinjau,
      // tombol Gate campaign itu mati dan halaman tidak punya cara mengatakan kenapa.
      issues.push({
        source: "Pratinjau gating",
        target: `Campaign ${id}`,
        message: result.reason?.message || "Pratinjau gagal diambil.",
        impact: "Tombol Gate untuk campaign ini mati sampai pratinjaunya terbaca.",
      });
    }
  }
  await store.replace(`${GATING_PATH}/previews`, previews);

  // Riwayat gagal diambil bukan alasan menjatuhkan cermin campaign yang sudah tertulis di atas:
  // yang hilang cuma panel riwayat, sementara tabel utamanya sudah benar.
  let runs = 0;
  try {
    const list = await listGateRuns(apiKey, GATE_RUNS_LIMIT);
    const rows = gateRunsMap(list);
    runs = Object.keys(rows).length;
    await store.replace(`${GATING_PATH}/runs`, rows);
  } catch (error) {
    issues.push({
      source: "Riwayat gating",
      target: "/gate-runs",
      message: error.message,
      impact: "Panel riwayat menampilkan data lama sampai pembacaan berikutnya berhasil.",
    });
  }

  await store.replace(`${GATING_PATH}/status`, gateStatusEntry(campaigns, now));
  return { campaigns: campaigns.length, previews: Object.keys(previews).length, runs, issues };
}

/**
 * Satu siklus penuh: terapkan antrean dulu, baru segarkan cermin.
 *
 * URUTAN INI KEBALIKAN dari saklar campaign Meta, dan sengaja. Di sana bacaan status dijalankan
 * SEBELUM penerap, karena Meta butuh waktu untuk menampakkan perubahan dan bacaan yang datang
 * belakangan akan menimpa perintah yang baru diterapkan dengan keadaan lamanya. Di sini
 * sebaliknya: vi-control membaca ulang dan memverifikasi hasilnya sebelum menjawab, jadi daftar
 * yang dibaca sesudahnya SUDAH memuat perubahan itu. Disegarkan lebih dulu, tabel akan menampilkan
 * keadaan sebelum gating sampai sepuluh menit berikutnya.
 */
export async function syncGating(dbOrStore, apiKey, now = new Date()) {
  const store = asStore(dbOrStore);
  const applied = await applyGateCommands(store, apiKey, now);

  const status = (await store.read(`${GATING_PATH}/status`)) || {};
  const requestedAt = (await store.read(`${GATING_PATH}/refreshRequestedAt`)) || "";
  // Sesuatu yang benar-benar terjadi selalu memaksa penyegaran; kalau tidak, tabel akan menyangkal
  // perubahan yang baru saja diminta orang sampai jarak sepuluh menitnya lewat.
  const due = applied.applied > 0 || applied.failed > 0 || mirrorDue(status, now, requestedAt);

  let mirror = null;
  const issues = [...applied.issues];
  if (due) {
    try {
      // Daftar hasil bacaan penerap hanya boleh dipakai ulang kalau tidak ada yang berubah
      // sesudahnya — kalau ada, ia sudah jadi potret masa lalu.
      const reusable = applied.applied === 0 ? applied.campaigns : null;
      mirror = await refreshGateMirror(store, apiKey, now, reusable);
      issues.push(...mirror.issues);
    } catch (error) {
      issues.push({
        source: "Cermin gating",
        target: "/campaigns",
        message: error.message,
        impact: "Tabel gating menampilkan keadaan dari penyegaran terakhir yang berhasil.",
      });
    }
  }

  await writeIssues(store, issues, now);
  return { ...applied, mirror, refreshed: due, issues };
}

// Ditulis walau kosong, sama seperti cabang syncIssues yang lain: perintah yang gagal sepuluh menit
// lalu tidak boleh terus menyalakan ikon peringatan setelah percobaan berikutnya berhasil.
function writeIssues(store, issues, now) {
  return store.replace(`${SYNC_ISSUES_PATH}/gating`, syncIssuesUpdate("VI Control", issues, now));
}

async function clearFinishedCommands(store, commands, now) {
  const stale = expiredGateCommandKeys(commands, now);
  if (!stale.length) return 0;
  await store.update(
    `${GATING_PATH}/commands`,
    Object.fromEntries(stale.map((key) => [key, null])),
  );
  return stale.length;
}

function chunk(items, size) {
  const batches = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  return batches;
}

// CLI — jalan darurat kalau fungsi terjadwalnya mati, dan cara menjalankan gating tanpa menunggu
// dua menit. `node sync-gating.mjs` menjalankan satu siklus penuh; `gate 36` / `ungate 36`
// menembakkan satu aksi langsung, melewati antrean.
// Dijalankan langsung sebagai CLI, atau diimpor sebagai modul?
//
// `file://${process.argv[1]}` benar di POSIX dan TIDAK PERNAH benar di Windows: argv[1] di sana
// berbentuk `D:\...\sync.mjs`, jadi ruas kanan jadi `file://D:\...` sementara `import.meta.url`
// berbunyi `file:///D:/...`. Yang terjadi bukan error melainkan DIAM — blok di bawah dilewati,
// tidak ada yang dikerjakan, dan prosesnya keluar dengan kode 0. Persis bentuk kegagalan yang
// paling mahal: `npm run sync:roi` tampak berhasil dan databasenya tidak berubah sedikit pun.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const apiKey = process.env.VI_CONTROL_API_KEY;
  if (!apiKey) {
    console.error("Set VI_CONTROL_API_KEY (API key vi-control).");
    process.exit(1);
  }

  const [action, campaignId] = process.argv.slice(2);
  const db = await connect();

  if (action === "gate" || action === "ungate") {
    if (!/^\d+$/.test(String(campaignId || ""))) {
      console.error(`Pakai: node sync-gating.mjs ${action} <campaignId>`);
      process.exit(1);
    }
    const result =
      action === "gate"
        ? await gateCampaign(campaignId, apiKey)
        : await ungateCampaign(campaignId, apiKey);
    console.log(JSON.stringify(result, null, 2));
    // Cermin ikut disegarkan supaya dashboard tidak menyangkal apa yang baru saja terjadi di CLI.
    await refreshGateMirror(db, apiKey);
    process.exit(result?.status === "ok" ? 0 : 1);
  }

  const res = await syncGating(db, apiKey);
  console.log(
    `Gating: ${res.applied} diterapkan, ${res.failed} gagal, dari ${res.pending} antrean. ` +
      (res.mirror
        ? `Cermin: ${res.mirror.campaigns} campaign, ${res.mirror.previews} pratinjau, ${res.mirror.runs} riwayat.`
        : "Cermin belum waktunya disegarkan."),
  );
  process.exit(res.failed ? 1 : 0);
}
