// Buttons that invoke Cloud Functions (Login/Reconnect, Cek Status, Cek Semua Akun,
// Impor dari Google, Sync ROI) only work when those functions are publicly invokable.
// Under Domain Restricted Sharing (DRS) that public `allUsers` grant is blocked, so the
// buttons would only ever error — we hide them and use the CLI fallbacks instead
// (functions/tools/authorize.mjs, tools/import-networks.mjs, sync-gam.mjs, sync-meta.mjs).
//
// When DRS is relaxed for the project and the functions are deployed, set
// VITE_FUNCTIONS_ENABLED=true to bring the buttons back.
export const FUNCTIONS_ENABLED = import.meta.env.VITE_FUNCTIONS_ENABLED === "true";
