// One-off migration: seed the Whitelist Top-Up collection with the historical records. Runs as
// SYNC_USER (an admin), the same way migrate-expenses.mjs does.
//
//   npm run migrate:whitelist-topup           # seed if /whitelistTopup is empty
//   npm run migrate:whitelist-topup -- --force  # seed even if rows already exist (may duplicate)
//
// Idempotent by default: refuses to re-seed a collection that already holds rows.

import { get, push, ref, set } from "firebase/database";
import { connect } from "../db.mjs";

const force = process.argv.includes("--force");

const MONTHS = [
  "JANUARY",
  "FEBRUARY",
  "MARCH",
  "APRIL",
  "MAY",
  "JUNE",
  "JULY",
  "AUGUST",
  "SEPTEMBER",
  "OCTOBER",
  "NOVEMBER",
  "DECEMBER",
];

// [date DD/MM/YYYY, namaKode, nominal, feeTopup, total, keterangan]
const rows = [
  ["03/08/2026", "TBZ 1235", 500000, 25000, 525000, "ACA"],
  ["03/08/2026", "TBZ 1268", 500000, 25000, 525000, "IBNU"],
  ["04/08/2026", "TBZ 1233", 500000, 25000, 525000, "NUR"],
  ["04/08/2026", "TBZ 1247", 500000, 25000, 525000, "NUR"],
  ["05/08/2026", "TBZ 1235", 500000, 25000, 525000, "ACA"],
  ["05/08/2026", "TBZ 1236", 500000, 25000, 525000, "FIRMAN"],
  ["05/08/2026", "TBZ 1268", 500000, 25000, 525000, "IBNU"],
  ["05/08/2026", "TBZ 1233", 500000, 25000, 525000, "NUR"],
  ["05/08/2026", "TBZ 1247", 500000, 25000, 525000, "NUR"],
  ["06/08/2026", "TBZ 1235", 500000, 25000, 525000, "ACA"],
  ["06/08/2026", "TBZ 1236", 500000, 25000, 525000, "FIRMAN"],
  ["06/08/2026", "TBZ 1268", 500000, 25000, 525000, "IBNU"],
  ["06/08/2026", "TBZ 1233", 500000, 25000, 525000, "NUR"],
  ["06/08/2026", "TBZ 1247", 500000, 25000, 525000, "NUR"],
  ["07/08/2026", "TBZ 1235", 500000, 25000, 525000, "ACA"],
  ["07/08/2026", "TBZ 1236", 500000, 25000, 525000, "FIRMAN"],
  ["07/08/2026", "TBZ 1268", 500000, 25000, 525000, "IBNU"],
  ["07/08/2026", "TBZ 1233", 500000, 25000, 525000, "NUR"],
  ["07/08/2026", "TBZ 1247", 500000, 25000, 525000, "NUR"],
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

const existing = Object.values((await get(ref(db, "whitelistTopup"))).val() || {}).filter(
  (e) => e && !e.deletedAt,
);

if (existing.length && !force) {
  console.log(
    `/whitelistTopup sudah berisi ${existing.length} baris — seeding dilewati. Pakai --force untuk tetap menambahkan.`,
  );
} else {
  const now = new Date().toISOString();
  for (const [date, namaKode, nominal, feeTopup, total, note] of rows) {
    const iso = toIsoDate(date);
    const rowRef = push(ref(db, "whitelistTopup"));
    await set(rowRef, {
      id: rowRef.key,
      bulan: MONTHS[Number(iso.slice(5, 7)) - 1] || "",
      date: iso,
      namaKode,
      nominal,
      feeTopup,
      total,
      note,
      rekeningSumber: "",
      rekeningTujuan: "",
      createdAt: now,
      createdBy: actor,
      updatedAt: now,
      updatedBy: actor,
    });
  }
  console.log(`${rows.length} baris whitelistTopup ditambahkan.`);
}

process.exit(0);
