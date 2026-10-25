// One-off migration: ganti nama PIC di baris riwayat yang sudah ditulis sync.
//
//   npm run migrate:pic-rename -- --from "Nurjaman WL 2" --to "Lightman" --dry
//   npm run migrate:pic-rename -- --from "Nurjaman WL 2" --to "Lightman"
//
// KENAPA INI PERLU ADA. Baris di `dashboard/roiReports` dan `dashboard/roiSnapshots` membawa
// SALINAN nama PIC-nya, bukan tautan ke baris user — itu yang membuat tabel ROI bisa dibaca tanpa
// menggabungkan tiga koleksi di browser. Konsekuensinya: mengganti `subDomains/{id}.pic` hanya
// mengubah baris yang ditulis SESUDAHNYA. Sync tiap jam hanya menulis ulang hari yang sedang
// dilaporkannya (kemarin + hari ini), jadi riwayat sebelum penggantian nama akan menyebut nama
// lama selamanya, dan orang yang sama berdiri dua kali di setiap laporan per-PIC — termasuk
// rincian Bonus Advertiser di halaman Laba Rugi, di mana separuh dasar bonusnya jatuh ke nama
// yang tidak punya baris user dan karena itu tidak punya tarif.
//
// Yang TIDAK disentuh: `users`, `subDomains`, `adAccounts`. Penggantian nama di sana dilakukan
// lewat halamannya masing-masing dan sudah selesai sebelum migrasi ini dijalankan — kalau belum,
// sync berikutnya akan menulis baris bernama lama lagi tepat setelah migrasi ini rapi.
//
// Idempotent: yang dicocokkan nama LAMA, jadi menjalankannya dua kali tidak mengubah apa-apa pada
// kali kedua.

import { get, ref, update } from "firebase/database";
import { connect } from "../db.mjs";

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

const db = await connect();

// Node yang membawa salinan nama PIC. Ditulis di sini apa adanya, bukan disapu dari seluruh pohon:
// sebuah migrasi yang mencari string di mana-mana akan ikut menyentuh field yang KEBETULAN berisi
// nama yang sama (keterangan pengeluaran, catatan reminder) — dan itu bukan penggantian nama PIC.
const NODES = [
  { path: "dashboard/roiReports", field: "pic" },
  { path: "dashboard/roiSnapshots", field: "pic" },
];

// Nama baru harus benar-benar ada di /users, kalau tidak migrasi ini cuma memindahkan barisnya ke
// nama kedua yang sama-sama tidak punya tarif bonus — persis masalah yang mau diselesaikan.
const users = Object.values((await get(ref(db, "users"))).val() || {}).filter((u) => !u?.deletedAt);
const target = users.find((u) => u?.name === to);
if (!target) {
  console.error(`"${to}" tidak ada di /users. Yang ada: ${users.map((u) => u.name).join(", ")}`);
  process.exit(1);
}

let total = 0;
const plan = [];
for (const node of NODES) {
  const rows = (await get(ref(db, node.path))).val() || {};
  const keys = Object.entries(rows)
    .filter(([, row]) => row?.[node.field] === from)
    .map(([key]) => key);
  const days = [...new Set(keys.map((k) => k.slice(0, 10)))].sort();
  console.log(
    `${node.path}: ${keys.length} baris` +
      (days.length ? `  (${days[0]} s/d ${days.at(-1)})` : ""),
  );
  total += keys.length;
  plan.push({ ...node, keys });
}

if (total === 0) {
  console.log(`Tidak ada baris bernama "${from}" — tidak ada yang diubah.`);
  process.exit(0);
}

if (dry) {
  console.log(`\n--dry: ${total} baris AKAN diubah "${from}" → "${to}". Tidak ada yang ditulis.`);
  process.exit(0);
}

// Ditulis per node dalam satu update: separuh baris yang berganti nama lebih buruk daripada tidak
// berganti sama sekali, karena orang yang sama lalu berdiri dua kali DI DALAM satu bulan.
for (const node of plan) {
  if (!node.keys.length) continue;
  await update(
    ref(db, node.path),
    Object.fromEntries(node.keys.map((key) => [`${key}/${node.field}`, to])),
  );
  console.log(`OK   ${node.path}: ${node.keys.length} baris`);
}

// Verifikasi dari database, bukan dari niat: yang dilaporkan berhasil adalah yang benar-benar
// terbaca kembali dengan nama baru.
let leftover = 0;
for (const node of NODES) {
  const rows = (await get(ref(db, node.path))).val() || {};
  leftover += Object.values(rows).filter((row) => row?.[node.field] === from).length;
}
console.log(
  leftover === 0
    ? `\nSelesai. ${total} baris kini bernama "${to}", tidak ada sisa "${from}".`
    : `\nMASIH ADA ${leftover} baris bernama "${from}" — jalankan ulang.`,
);
process.exit(leftover === 0 ? 0 : 1);
