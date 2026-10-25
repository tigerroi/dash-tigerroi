// Alamat dashboard untuk tautan yang ditulis sisi functions (pesan Telegram, pendaratan OAuth).
//
// Set DASHBOARD_URL di environment (Firebase Secret atau .env.sync) untuk menentukan URL dashboard.
// Tanpa itu, fallback ke `{project-id}.web.app` — yang masih berfungsi tapi bukan domain utama.
// Jangan hardcode domain di sini: saat domain pindah, satu env var yang diganti sudah cukup.

/** `DASHBOARD_URL` menang; project yang tidak dikenal jatuh ke `web.app`-nya; tanpa project, "". */
export function dashboardUrl(env = process.env) {
  const explicit = String(env.DASHBOARD_URL || "").replace(/\/+$/, "");
  if (explicit) return explicit;
  const project = env.GCLOUD_PROJECT || env.FIREBASE_PROJECT_ID;
  if (!project) return "";
  return `https://${project}.web.app`;
}
