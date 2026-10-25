import { credentialHealthUpdates } from "./google-oauth-core.js";
import { asStore } from "./store.mjs";

/**
 * Kredensial Google yang seluruh akunnya ditolak karena izin berhenti berstatus "Connected".
 *
 * Modul sendiri, dipakai sync GAM maupun sync AdSense. Bukan di `sync-core.js` — file itu sengaja
 * tidak menyentuh database sama sekali ("No DB access here"), dan bukan di salah satu modul sync,
 * karena yang mengimpor dari saudaranya adalah bentuk ketergantungan yang membuat satu run CLI
 * memuat API yang tidak dipakainya.
 *
 * Keputusannya butuh SELURUH hasil run, jadi ia tidak bisa tinggal di dalam loop per akun: satu
 * akun yang berhasil sudah cukup membuktikan tokennya hidup, dan itu tidak bisa diketahui pada
 * akun yang sedang gagal. Aturannya sendiri di `credentialHealthUpdates` — tanpa jaringan, tanpa
 * RTDB, dan karena itu bisa diuji.
 *
 * Hanya dipanggil dari run PENUH, alasan yang sama dengan daftar isu di sebelahnya: run untuk
 * satu-dua akun tidak tahu apa-apa tentang akun lain milik kredensial yang sama, dan "tidak ada
 * yang berhasil" di sana berarti "tidak ada yang dicoba".
 */
export async function applyCredentialHealth(db, configs, outcomes) {
  const updates = credentialHealthUpdates(configs, outcomes);
  const store = asStore(db);
  for (const [id, values] of Object.entries(updates)) {
    console.error(`CRED ${configs?.[id]?.name || id}: status -> ${values.status}`);
    await store.update(`googleApiConfigs/${id}`, values);
  }
  return updates;
}
