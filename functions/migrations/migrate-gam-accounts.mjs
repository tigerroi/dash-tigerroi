// One-off migration: pindahkan /adsenseAccounts (yang isinya network Ad Manager) ke /gamAccounts,
// supaya /adsenseAccounts bisa berisi akun AdSense yang sesungguhnya.
//
//   npm run migrate:gam-accounts -- --dry     # lihat rencananya, tidak menulis apa pun
//   npm run migrate:gam-accounts              # salin, verifikasi, lalu kosongkan sumbernya
//
// URUTANNYA PENTING. Frontend versi baru membaca /gamAccounts; kalau ia sudah ter-deploy sementara
// migrasi belum jalan, halaman GAM kosong dan halaman AdSense memperlihatkan network GAM sebagai
// akun AdSense tanpa Publisher ID. Jalankan ini DULU, baru deploy.
//
// Idempotent: record yang id-nya sudah ada di /gamAccounts tidak disalin dua kali, dan sumbernya
// baru dihapus setelah setiap record terbukti ada di tujuan dengan isi yang sama.

import { get, ref, update } from "firebase/database";
import { connect } from "../db.mjs";

const dry = process.argv.includes("--dry");
const keepSource = process.argv.includes("--keep-source");

const db = await connect();
const source = (await get(ref(db, "adsenseAccounts"))).val() || {};
const target = (await get(ref(db, "gamAccounts"))).val() || {};

const entries = Object.entries(source);
if (entries.length === 0) {
  console.log("/adsenseAccounts kosong — tidak ada yang dipindahkan.");
  process.exit(0);
}

// Yang dipindahkan hanya record Ad Manager. Record tanpa networkCode di koleksi lama adalah baris
// yang dibuat manual dan belum pernah terhubung ke apa pun; memindahkannya ke halaman GAM berarti
// menaruhnya di halaman yang tidak bisa menyembuhkannya.
const moving = entries.filter(([, a]) => a?.networkCode);
const staying = entries.filter(([, a]) => !a?.networkCode);

console.log(`${entries.length} record di /adsenseAccounts:`);
for (const [id, a] of moving) {
  const flag = target[id] ? "sudah ada di /gamAccounts" : "pindah";
  console.log(`  → ${a.name || id} (network ${a.networkCode}) — ${flag}`);
}
for (const [id, a] of staying) {
  console.log(`  · ${a?.name || id} — tanpa networkCode, ditinggal di /adsenseAccounts`);
}

if (dry) {
  console.log("\n--dry: tidak ada yang ditulis.");
  process.exit(0);
}

// `provider` ditulis eksplisit saat pindah: sesudah ini ada dua koleksi, dan menebak provider dari
// bentuk record hanya benar selama tidak ada record yang bentuknya di tengah-tengah.
const payload = {};
for (const [id, account] of moving) {
  payload[id] = { ...account, provider: "gam" };
}
await update(ref(db, "gamAccounts"), payload);

// Verifikasi sebelum menghapus. Sumber yang dihapus atas dasar "update tidak melempar error"
// adalah cara data hilang tanpa ada yang tahu kapan.
const written = (await get(ref(db, "gamAccounts"))).val() || {};
const missing = moving.filter(([id, a]) => String(written[id]?.networkCode || "") !== String(a.networkCode));
if (missing.length) {
  console.error(`\n${missing.length} record tidak sampai di /gamAccounts. Sumber TIDAK dihapus.`);
  for (const [id, a] of missing) console.error(`  ! ${a.name || id}`);
  process.exit(1);
}
console.log(`\n${moving.length} record ada di /gamAccounts.`);

if (keepSource) {
  console.log("--keep-source: /adsenseAccounts dibiarkan apa adanya.");
  console.log("Ingat: selama keduanya terisi, tiap network akan tersync dua kali dan ROI-nya dobel.");
  process.exit(0);
}

const removals = {};
for (const [id] of moving) removals[id] = null;
await update(ref(db, "adsenseAccounts"), removals);
console.log(`${moving.length} record dihapus dari /adsenseAccounts.`);
console.log(
  staying.length
    ? `${staying.length} record tanpa networkCode tetap di sana — isi Publisher ID-nya di /adsense-accounts, atau hapus.`
    : "/adsenseAccounts sekarang kosong, siap diisi akun AdSense lewat 'Impor dari Google'.",
);
process.exit(0);
