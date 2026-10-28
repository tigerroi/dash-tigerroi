// One-off migration: gabungkan dua baris user yang ternyata SATU ORANG jadi satu.
//
//   npm run migrate:merge-users -- --from Lightman --to Nurjaman --dry
//   npm run migrate:merge-users -- --from Lightman --to Nurjaman
//
// KENAPA INI PERLU ADA. Identitas seorang advertiser tersimpan sebagai SALINAN NAMA di enam tempat
// (`adAccounts.userOwner`, `subDomains.pic`, `whitelistTopup.pic`, `roiReports.pic`,
// `roiSnapshots.pic`) plus satu tempat ber-USER ID (`users/{id}` berikut sub-nodenya). Itu yang
// membuat tabel ROI bisa dibaca tanpa menggabungkan tiga koleksi di browser — dan sekaligus yang
// membuat satu orang yang punya dua baris user berdiri DUA KALI di setiap laporan per-PIC: dua
// porsi dana di /spending, dua dasar bonus di Laba Rugi, dua saldo advertiser di Overview.
// Mengganti pemiliknya di halaman Ad Accounts hanya membetulkan baris yang ditulis SESUDAHNYA.
//
// URUTANNYA DISENGAJA: kepemilikan (`adAccounts`/`subDomains`) DULU, riwayat belakangan. Sync
// jalan tiap jam dan menulis baris baru dari kepemilikan itu; kalau run ini mati di tengah,
// kepemilikan yang sudah pindah berarti seluruh data BARU sudah benar dan menjalankan ulang
// membereskan sisanya. Dibalik, sync akan terus menulis baris bernama lama tepat setelah
// riwayatnya rapi.
//
// Idempotent: yang dicocokkan selalu nama/ID LAMA, jadi kali kedua tidak mengubah apa-apa.
//
// Yang TIDAK disentuh, dan tiap alasannya berbeda:
//   - `adAccounts.name` / `whitelistTopup.namaKode` ("TBZ 1247") — itu nama AKUN, bukan nama orang.
//     Akunnya tetap ada dan tetap bernama begitu; yang pindah cuma pemiliknya.
//   - `reminders` ("Sewa WL TBZ 1247") — sama, menyebut akun.
//   - `roles/{uid}` — hak login. Mengarsipkan baris user mencabut DATA-nya, bukan aksesnya;
//     mencabut akses adalah keputusan terpisah yang tidak boleh menumpang migrasi data.
//   - `activityLogs` (SQLite di VPS) — log audit. Yang mencatat siapa melakukan apa tidak boleh
//     ditulis ulang belakangan, atau ia berhenti jadi bukti.

import { get, ref, remove, update } from "firebase/database";
import { connect } from "../db.mjs";
import { normalizeName, snapshotKeep, userReportsPath } from "../sync-core.js";

const arg = (name) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? "" : process.argv[index + 1] || "";
};

const from = arg("--from");
const to = arg("--to");
const dry = process.argv.includes("--dry");

if (!from || !to) {
  console.error('Pakai: --from "Nama Lama" --to "Nama Baru" [--dry]');
  process.exit(1);
}
if (normalizeName(from) === normalizeName(to)) {
  console.error("--from dan --to adalah orang yang sama.");
  process.exit(1);
}

const db = await connect();
const read = async (path) => (await get(ref(db, path))).val() || {};
const toArray = (value) => (!value ? [] : Array.isArray(value) ? value : Object.values(value));

// --- Kedua baris user harus benar-benar ada -----------------------------------------------------
//
// Diperiksa sebelum satu baris pun disentuh. Nama tujuan yang tidak punya baris user berarti
// migrasi ini cuma memindahkan data ke nama kedua yang sama-sama tidak punya tarif bonus dan tidak
// pernah muncul di /spending — persis masalah yang mau diselesaikan.
const users = await read("users");
const pick = (name) =>
  Object.entries(users).filter(
    ([, u]) => u && !u.deletedAt && normalizeName(u.name) === normalizeName(name),
  );

const fromRows = pick(from);
const toRows = pick(to);
for (const [label, rows] of [
  [from, fromRows],
  [to, toRows],
]) {
  if (rows.length === 1) continue;
  const names = Object.values(users)
    .filter((u) => u && !u.deletedAt && u.name)
    .map((u) => u.name)
    .join(", ");
  console.error(
    rows.length === 0
      ? `"${label}" tidak ada di /users. Yang ada: ${names}`
      : `"${label}" punya ${rows.length} baris user aktif — bereskan dulu, migrasi ini tidak bisa menebak yang mana.`,
  );
  process.exit(1);
}

const [fromId, fromUser] = fromRows[0];
const [toId, toUser] = toRows[0];

console.log(`Menggabungkan  ${fromUser.name} (${fromId})  →  ${toUser.name} (${toId})`);
console.log(`  email     ${fromUser.email || "-"}  →  ${toUser.email || "-"}`);

// Tarif bonus yang berbeda mengubah bonus SELURUH riwayat orang ini, bukan cuma bulan depan: Laba
// Rugi menghitung ulang tiap bulan lampau dari `users.bonusPercent` hari ini. Disebutkan, bukan
// dipilihkan diam-diam.
if (String(fromUser.bonusPercent ?? "") !== String(toUser.bonusPercent ?? "")) {
  console.log(
    `\n  ⚠ Tarif bonus BERBEDA: ${fromUser.bonusPercent ?? "(kosong)"} vs ${toUser.bonusPercent ?? "(kosong)"}.` +
      `\n    Setelah digabung, seluruh riwayat ${to} memakai ${toUser.bonusPercent ?? "(kosong)"}% — termasuk bulan-bulan lampau.`,
  );
}

// --- 1. Kepemilikan: sumber kebenaran, dan karena itu duluan ------------------------------------
const OWNERSHIP = [
  { path: "adAccounts", field: "userOwner", label: "Ad account" },
  { path: "subDomains", field: "pic", label: "Sub domain" },
];

// --- 2. Riwayat yang membawa SALINAN nama -------------------------------------------------------
//
// Ditulis di sini apa adanya, bukan disapu dari seluruh pohon: migrasi yang mencari string di
// mana-mana akan ikut menyentuh field yang KEBETULAN berisi nama itu (keterangan pengeluaran,
// judul reminder) — dan itu bukan penggantian pemilik.
const HISTORY = [
  { path: "whitelistTopup", field: "pic", label: "Top-up whitelist" },
  { path: "dashboard/roiReports", field: "pic", label: "Baris ROI harian" },
  { path: "dashboard/roiSnapshots", field: "pic", label: "Baris ROI per sync" },
];

const plan = [];
for (const node of [...OWNERSHIP, ...HISTORY]) {
  const rows = await read(node.path);
  const keys = Object.entries(rows)
    .filter(([, row]) => normalizeName(row?.[node.field]) === normalizeName(from))
    .map(([key]) => key);
  const days = [...new Set(keys.map((k) => k.slice(0, 10)))]
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();
  console.log(
    `\n${node.label.padEnd(20)} ${String(keys.length).padStart(5)} baris  (${node.path}.${node.field})` +
      (days.length ? `\n${" ".repeat(21)}${days[0]} s/d ${days.at(-1)}` : ""),
  );
  plan.push({ ...node, keys });
}

// --- 3. Sub-node di bawah users/{id} ------------------------------------------------------------
//
// Kuncinya memuat ID ad account (`{tanggal}__{akun}__{campaign}`, `{stempel}__{akun}`), jadi
// selama kedua orang memegang akun yang berbeda tidak ada yang bertabrakan. Tapi akun BISA
// berpindah tangan — TBZ 1247 pindah dari Nurjaman ke Lightman pada 13 Agu 2026 — dan hari
// perpindahannya punya baris di KEDUA sisi untuk kunci yang sama.
//
// Yang menang di tabrakan adalah baris yang SUDAH ADA DI TUJUAN, dan itu bukan sekadar main aman.
// `dailySpend` kumulatif sejak tengah malam dengan kunci tanggal UTC, sementara operasi berjalan
// di WIB: baris "Sync Meta 16:05" (= 23:05 WIB, hari itu hampir penuh) dan "Sync Meta 23:05"
// (= 06:05 WIB HARI BERIKUTNYA, pecahan pagi yang terkunci di tanggal UTC kemarin) berdiri di
// kunci yang sama. Yang lebih tua stempelnya justru yang mewakili harinya. Menimpanya berarti
// belanja satu hari penuh diganti pecahan beberapa jam, tanpa satu pun tanda di layar.
//
// DUA POHON, dan itu yang paling mudah terlewat waktu membaca berkas ini: keempat riwayat panel
// Profile User tinggal di `userReports/{id}` (lihat `USER_REPORTS_PATH`), sementara
// `campaignCommands` tetap di `users/{id}`. Dibaca dari satu tempat saja, penggabungan ini akan
// melaporkan "0 baris pindah" untuk riwayat yang jelas-jelas ada — dan riwayat orang yang
// digabungkan hilang tanpa satu pun pesan.
const REPORT_BRANCHES = ["campaignHistory", "dailySpend", "balanceSnapshots", "countryRoi"];
const USER_BRANCHES = ["campaignCommands"];
const fromReports = await read(userReportsPath(fromId));
const toReports = await read(userReportsPath(toId));
const sourceOf = (key) =>
  REPORT_BRANCHES.includes(key) ? [fromReports, toReports] : [fromUser, toUser];

const merged = {};
let skipped = 0;
for (const key of [...REPORT_BRANCHES, ...USER_BRANCHES]) {
  const [fromNode, toNode] = sourceOf(key);
  const mine = fromNode[key] || {};
  const theirs = toNode[key] || {};
  const clash = Object.keys(mine).filter((k) => k in theirs);
  skipped += clash.length;
  merged[key] = Object.fromEntries(Object.entries(mine).filter(([k]) => !(k in theirs)));
  console.log(
    `${key.padEnd(21)} ${String(Object.keys(merged[key]).length).padStart(5)} baris pindah  ` +
      `(${to} sudah punya ${Object.keys(theirs).length})` +
      (clash.length ? `  — ${clash.length} dilewati, ${to} sudah punya kunci itu` : ""),
  );
}

// Snapshot saldo punya JATAH SIMPAN per user (`BALANCE_SNAPSHOT_KEEP`, 60), dan jatah itu tidak
// ikut berlipat karena dua orang jadi satu: sync berikutnya membuang yang tertua sampai tersisa 60.
// Disebutkan di sini karena yang kehilangan kedalaman riwayatnya adalah panel yang sudah dibaca
// orang, dan angkanya menyusut BEBERAPA JAM setelah migrasi — bukan saat migrasi jalan.
const snapshotsAfter =
  Object.keys(merged.balanceSnapshots).length +
  Object.keys(toReports.balanceSnapshots || {}).length;
if (snapshotsAfter > snapshotKeep()) {
  console.log(
    `\n  ⚠ Snapshot saldo digabung jadi ${snapshotsAfter}, jatah simpannya ${snapshotKeep()}.` +
      `\n    Sync berikutnya membuang ${snapshotsAfter - snapshotKeep()} snapshot TERTUA — riwayat saldo jadi lebih pendek, bukan hilang.\n`,
  );
}

// Baris kampanye adalah ARRAY, bukan map — digabung lewat identitasnya sendiri supaya campaign yang
// sama tidak berdiri dua kali kalau migrasi ini dijalankan ulang.
const campaignId = (row) => String(row?.campaignId || "") || `name:${normalizeName(row?.campaign)}`;
const existingCampaigns = toArray(toUser.campaigns);
const seen = new Set(existingCampaigns.map(campaignId));
const incoming = toArray(fromUser.campaigns).filter(
  (row) => row?.campaign && !seen.has(campaignId(row)),
);
console.log(
  `campaigns${" ".repeat(12)} ${String(incoming.length).padStart(5)} baris pindah  ` +
    `(${to} sudah punya ${existingCampaigns.length}, ${toArray(fromUser.campaigns).length - incoming.length} sudah ada di sana)`,
);

const totalRows = plan.reduce((n, node) => n + node.keys.length, 0);
if (dry) {
  console.log(
    `\n--dry: ${totalRows} baris AKAN berganti pemilik "${from}" → "${to}", ` +
      `${Object.values(merged).reduce((n, m) => n + Object.keys(m).length, 0) + incoming.length} baris riwayat AKAN pindah, ` +
      `baris user "${from}" AKAN diarsipkan. Tidak ada yang ditulis.` +
      (skipped
        ? `\n       ${skipped} baris riwayat dilewati karena kuncinya sudah ada di ${to} (baris ${to} yang dipertahankan).`
        : ""),
  );
  process.exit(0);
}

// --- Menulis ------------------------------------------------------------------------------------
//
// Per node dalam satu update: separuh baris yang berganti pemilik lebih buruk daripada tidak
// berganti sama sekali, karena orang yang sama lalu berdiri dua kali DI DALAM satu bulan.
for (const node of plan) {
  if (!node.keys.length) continue;
  await update(
    ref(db, node.path),
    Object.fromEntries(node.keys.map((key) => [`${key}/${node.field}`, toUser.name])),
  );
  console.log(`OK   ${node.path}: ${node.keys.length} baris → ${toUser.name}`);
}

const payload = { updatedAt: new Date().toISOString(), updatedBy: "merge-users" };
const reportsPayload = {};
for (const [key, rows] of Object.entries(merged)) {
  const target = REPORT_BRANCHES.includes(key) ? reportsPayload : payload;
  for (const [k, row] of Object.entries(rows)) target[`${key}/${k}`] = row;
}
if (incoming.length) payload.campaigns = [...existingCampaigns, ...incoming];
await update(ref(db, `users/${toId}`), payload);
console.log(`OK   users/${toId}: baris campaign digabung`);
if (Object.keys(reportsPayload).length) {
  await update(ref(db, userReportsPath(toId)), reportsPayload);
  console.log(`OK   ${userReportsPath(toId)}: riwayat digabung`);
}

// Baris panel "Saldo & Pengeluaran Advertiser" DIHAPUS, bukan dibiarkan basi. `advertiserSpendRows`
// hanya menulis user yang punya ad account, dan tidak pernah menghapus: dibiarkan, panel Overview
// menampilkan baris hantu bernama "Lightman" dengan saldo terakhirnya selamanya.
await remove(ref(db, `dashboard/advertiserSpend/${fromId}`));
console.log(`OK   dashboard/advertiserSpend/${fromId}: dihapus`);

// Diarsipkan, bukan dihapus. `deletedAt` mengeluarkannya dari tiap dropdown, tiap laporan, dan tiap
// pengiriman notifikasi (keduanya memakai chat Telegram yang sama — dibiarkan aktif, tiap pengingat
// datang dua kali ke ponsel yang sama). Sub-nodenya sengaja TIDAK dihapus — termasuk cabangnya di
// `userReports/{fromId}`: selama migrasi ini belum diperiksa orang, salinan itu satu-satunya jalan
// pulang.
await update(ref(db, `users/${fromId}`), {
  deletedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  updatedBy: "merge-users",
});
console.log(`OK   users/${fromId}: diarsipkan`);

// --- Verifikasi dari database, bukan dari niat --------------------------------------------------
let leftover = 0;
for (const node of [...OWNERSHIP, ...HISTORY]) {
  const rows = await read(node.path);
  const n = Object.values(rows).filter(
    (row) => normalizeName(row?.[node.field]) === normalizeName(from),
  ).length;
  if (n) console.log(`SISA ${node.path}.${node.field}: ${n} baris`);
  leftover += n;
}
const after = await read(`users/${fromId}`);
if (!after.deletedAt) {
  console.log(`SISA users/${fromId} belum diarsipkan`);
  leftover++;
}
console.log(
  leftover === 0
    ? `\nSelesai. ${totalRows} baris kini milik "${toUser.name}", dan "${from}" sudah diarsipkan.`
    : `\nMASIH ADA ${leftover} sisa — jalankan ulang.`,
);
process.exit(leftover === 0 ? 0 : 1);
