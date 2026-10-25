import { connect } from "../db.mjs";
import { syncFillRate } from "../sync-fill-rate.mjs";

// Satu run tab Rasio Penayangan dari terminal — MENULIS ke RTDB (dashboard/fillRate,
// dashboard/fillRateStatus, dashboard/syncIssues/fillRate), sama persis dengan cron server kontrol.
//
//   cd functions && npm run sync:fill-rate
const db = await connect();
console.log(await syncFillRate(db));
process.exit(0);
