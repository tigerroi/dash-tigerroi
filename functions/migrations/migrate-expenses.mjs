// One-off migration: seed the Expenses collection with the historical spending records and give
// user "Aca" the Keuangan role. Runs as SYNC_USER (an admin), the same way tools/set-role.mjs
// does.
//
//   npm run migrate:expenses           # seed if /expenses is empty, then grant Aca keuangan
//   npm run migrate:expenses -- --force  # seed even if rows already exist (may duplicate)
//
// Idempotent by default: it refuses to re-seed expenses that already hold rows, and adding a role
// the user already has is a no-op.

import { get, push, ref, set } from "firebase/database";
import { connect } from "../db.mjs";

const force = process.argv.includes("--force");

// [date DD/MM/YYYY, itemName, qty, nominal, total]
const rows = [
  ["13/04/2026", "Sewa 2 WL", 2, 200000, 400000],
  ["19/04/2026", "ADSPOWER", 1, 550000, 550000],
  ["19/04/2026", "IP FOXY STATIC INDO", 1, 170000, 170000],
  ["13/05/2026", "KEITARO", 1, 2750000, 2750000],
  ["13/05/2026", "Sewa 2 WL", 2, 200000, 400000],
  ["18/05/2026", "ADSPOWER", 1, 620000, 620000],
  ["19/05/2026", "IP FOXY STATIC INDO", 1, 180000, 180000],
  ["19/05/2026", "BELI AKUN ADSENSE EMRAN", 1, 6250000, 6250000],
  ["19/05/2026", "IP FOXY STATIC PAKISTAN", 1, 170000, 170000],
  ["20/05/2026", "Renew Domain psaonlineappointment.com", 1, 350000, 350000],
  ["02/06/2026", "Renew Domain xiaomidriversdownload.com", 1, 206139, 200000],
  ["13/06/2026", "KEITARO", 1, 2800000, 2800000],
  ["13/06/2026", "Sewa 2 WL", 2, 200000, 400000],
  ["17/06/2026", "ADSPOWER", 1, 620000, 620000],
  ["17/06/2026", "IP FOXY STATIC INDO", 1, 180000, 180000],
  ["17/06/2026", "IP FOXY STATIC PAKISTAN", 1, 180000, 180000],
  ["13/07/2026", "KEITARO", 1, 2800000, 2800000],
  ["15/07/2026", "Sewa 2 WL", 2, 400000, 800000],
  ["17/07/2026", "ADSPOWER", 1, 620000, 620000],
  ["17/07/2026", "IP FOXY STATIC INDO", 1, 180000, 180000],
  ["17/07/2026", "IP FOXY STATIC PAKISTAN", 1, 180000, 180000],
  ["24/07/2026", "Sewa 1 WL IBNU", 1, 100000, 100000],
  ["31/07/2026", "Nambah member adspower", 1, 80000, 80000],
  ["31/07/2026", "Bayar Domain Sytlefemale.com Namecheap", 1, 350000, 350000],
  ["06/08/2026", "Bayar Domain petcins.com idwebhost", 1, 240000, 240000],
  ["07/08/2026", "Bayar Domain designingaround.com domainesia", 1, 235000, 235000],
];

// DD/MM/YYYY -> YYYY-MM-DD, the value shape <input type="date"> uses and the app stores.
function toIsoDate(ddmmyyyy) {
  const [d, m, y] = ddmmyyyy.split("/");
  return `${y}-${m}-${d}`;
}

const db = await connect().catch((error) => {
  console.error(`Gagal masuk sebagai SYNC_USER: ${error.message}`);
  process.exit(1);
});

const { getAuth } = await import("firebase/auth");
const actor = getAuth().currentUser?.email || "migrate-script";

// --- 1. Grant Aca the Keuangan role -----------------------------------------------------------
const users = (await get(ref(db, "users"))).val() || {};
const aca = Object.values(users).find(
  (u) => !u?.deletedAt && String(u?.name || "").trim().toLowerCase() === "aca",
);

if (!aca?.uid) {
  console.warn('User "Aca" tidak ditemukan (atau tidak punya uid) — role tidak diubah.');
} else {
  const current = String((await get(ref(db, `roles/${aca.uid}`))).val() || "")
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
  if (current.includes("keuangan")) {
    console.log(`Aca (${aca.uid}) sudah punya role keuangan — dilewati.`);
  } else {
    const next = [...current, "keuangan"];
    // Also mirror onto the profile row so the Team table shows it.
    await set(ref(db, `roles/${aca.uid}`), next.join(","));
    console.log(`Aca (${aca.uid}) -> ${next.join(",")}`);
  }
}

// --- 2. Seed the expenses collection ----------------------------------------------------------
const existing = Object.values((await get(ref(db, "expenses"))).val() || {}).filter(
  (e) => e && !e.deletedAt,
);

if (existing.length && !force) {
  console.log(
    `/expenses sudah berisi ${existing.length} baris — seeding dilewati. Pakai --force untuk tetap menambahkan.`,
  );
} else {
  const now = new Date().toISOString();
  for (const [date, itemName, qty, nominal, total] of rows) {
    const rowRef = push(ref(db, "expenses"));
    await set(rowRef, {
      id: rowRef.key,
      date: toIsoDate(date),
      itemName,
      qty,
      nominal,
      total,
      note: "",
      createdAt: now,
      createdBy: actor,
      updatedAt: now,
      updatedBy: actor,
    });
  }
  console.log(`${rows.length} baris expenses ditambahkan.`);
}

console.log("Selesai. Aca harus refresh dashboard agar role barunya terbaca.");
process.exit(0);
