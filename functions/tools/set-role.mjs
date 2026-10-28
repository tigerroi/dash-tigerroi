// Grant a dashboard role by writing /roles/{uid}, the node database.rules.json checks.
//
// Normally roles are managed from the dashboard (Team -> Tambah / Edit). This script exists for
// the one case the dashboard cannot handle: the **first** admin. Until somebody has the admin
// role, nobody is allowed to write /roles at all.
//
//   npm run role:whoami                          # siapa SYNC_USER, dan role apa yang ia punya
//   npm run role:list                            # roles currently stored
//   npm run role:bootstrap                       # make SYNC_USER_EMAIL an admin
//   npm run role:bootstrap -- <email> <password> # make that account an admin instead
//   npm run role:set -- <uid> <admin|user|advertiser|keuangan|guest|none>
//   npm run role:set -- <uid> admin,keuangan          # boleh lebih dari satu, digabung koma
//   npm run role:create -- <email> <password> <role>  # akun login BARU + role-nya, tanpa baris Team
//
// `role:create` untuk akun yang bukan anggota tim — hari ini akun tamu (`guest`, lihat GUEST_PAGES
// di src/config/access.js). Halaman Team juga membuat akun login, tapi sekaligus baris `users`, dan
// baris itu membuat tamu berdiri di daftar Team, daftar penerima notifikasi, dan pilihan PIC.
// Role-nya ditulis sesudah akunnya lahir; kalau database MENOLAKNYA (aturan belum di-deploy),
// akunnya dihapus lagi — akun tanpa role terbaca sebagai "user" biasa dan membuka seluruh dashboard
// level user, persis kebalikan dari yang diminta.
//
// Signs in with the normal client SDK — no service-account key needed. Without arguments it uses
// SYNC_USER_EMAIL / SYNC_USER_PASSWORD (functions/.env.sync or server/.env). Run the bootstrap
// BEFORE deploying the rules, while /roles is still writable by any signed-in user; afterwards
// only an existing admin can write there.

import { get, ref, set } from "firebase/database";
import { connect } from "../db.mjs";
import { isAdmin, parseRoles } from "../roles.mjs";

// Sama dengan ROLE_OPTIONS di src/config/access.js dan daftar di .validate database.rules.json.
// "superadmin" diterima tapi tidak pernah disebut di teks bantuan maupun pesan error di bawah:
// role itu tidak diumumkan ke pemegang role lain.
const ROLES = ["superadmin", "admin", "user", "advertiser", "keuangan", "guest"];
const LISTED_ROLES = ROLES.filter((role) => role !== "superadmin");
const args = process.argv.slice(2);
const command = args[0];

// `role:bootstrap -- <email> <password>` promotes that account instead of the sync user.
if (command === "--bootstrap" && args[1] && args[2]) {
  process.env.SYNC_USER_EMAIL = args[1];
  process.env.SYNC_USER_PASSWORD = args[2];
}

const db = await connect().catch((error) => {
  console.error(`Gagal masuk sebagai SYNC_USER: ${error.message}`);
  process.exit(1);
});

// Sync terjadwal menulis ke `dashboard/*`, dan aturannya hanya mengizinkan admin. Kalau SYNC_USER
// bukan admin, run-nya gagal di tulisan pertama — dan dari luar itu tidak bisa dibedakan dari
// "sync belum pernah jalan". Perintah ini menjawabnya dalam satu langkah: login berhasil atau
// tidak, dan role apa yang dipegang akun itu.
if (command === "--whoami") {
  const { getAuth } = await import("firebase/auth");
  const user = getAuth().currentUser;
  const role = (await get(ref(db, `roles/${user.uid}`))).val();
  console.log(`Email : ${user.email}`);
  console.log(`UID   : ${user.uid}`);
  console.log(`Role  : ${role || "(tanpa role)"}`);
  console.log(
    isAdmin(role)
      ? "OK — akun ini boleh menulis dashboard/* dan settings/*."
      : "MASALAH — sync terjadwal akan ditolak saat menulis dashboard/*. Jadikan admin lewat\n" +
          "  npm run role:set -- " +
          user.uid +
          " admin   (dijalankan oleh akun yang sudah admin)",
  );
  process.exit(isAdmin(role) ? 0 : 1);
}

if (command === "--list") {
  const roles = (await get(ref(db, "roles"))).val() || {};
  const entries = Object.entries(roles);
  if (!entries.length) console.log("Belum ada role tersimpan di /roles.");
  for (const [uid, role] of entries) console.log(`  ${uid} -> ${role}`);
  process.exit(0);
}

if (command === "--bootstrap") {
  // connect() already signed us in, so the uid we need is the current user's.
  const { getAuth } = await import("firebase/auth");
  const uid = getAuth().currentUser?.uid;
  if (!uid) {
    console.error("Tidak bisa membaca uid dari sesi SYNC_USER.");
    process.exit(1);
  }
  await set(ref(db, `roles/${uid}`), "admin");
  console.log(`${process.env.SYNC_USER_EMAIL} (${uid}) -> admin`);
  process.exit(0);
}

if (command === "--create") {
  const [, email, password, roleArg] = args;
  const roles = parseRoles(roleArg);
  if (!email || !password || !roles.length || roles.some((r) => !ROLES.includes(r))) {
    console.error(`Pakai: npm run role:create -- <email> <password> <${LISTED_ROLES.join("|")}>`);
    process.exit(1);
  }
  const { deleteApp, getApp, initializeApp } = await import("firebase/app");
  const { createUserWithEmailAndPassword, getAuth } = await import("firebase/auth");
  // App kedua, sepola createTeamAccount di src/lib/teamAccounts.js: membuat akun lewat app utama
  // mengganti sesi SYNC_USER dengan akun baru, dan tulisan role sesudahnya ditolak.
  const secondary = initializeApp(getApp().options, `create-${Date.now()}`);
  try {
    const { user } = await createUserWithEmailAndPassword(getAuth(secondary), email, password);
    try {
      await set(ref(db, `roles/${user.uid}`), roles.join(","));
    } catch (error) {
      await user.delete();
      console.error(`Role ditolak database (${error.message}) — akun ${email} dibatalkan.`);
      console.error("Deploy aturan database dulu: npm run deploy:rules");
      process.exit(1);
    }
    console.log(`${email} (${user.uid}) -> ${roles.join(",")}`);
  } catch (error) {
    console.error(`Gagal membuat ${email}: ${error.code || error.message}`);
    process.exit(1);
  } finally {
    await deleteApp(secondary);
  }
  process.exit(0);
}

const [uid, role] = args;
if (!uid || !role) {
  console.error("Pakai: npm run role:set -- <uid> <admin|user|advertiser|keuangan|guest|none>");
  console.error("       npm run role:bootstrap   (jadikan SYNC_USER admin pertama)");
  process.exit(1);
}
// Boleh lebih dari satu, digabung koma ("admin,keuangan") — bentuk yang sama dengan yang
// ditulis halaman Team dan yang diterima .validate di database.rules.json.
const wanted = role === "none" ? [] : parseRoles(role);
const unknown = wanted.filter((r) => !ROLES.includes(r));
if (role !== "none" && (wanted.length === 0 || unknown.length > 0)) {
  console.error(
    `Role tidak dikenal: ${unknown.join(", ") || role}. Pilih ${LISTED_ROLES.join(" / ")} atau none.`,
  );
  console.error(`Boleh digabung dengan koma, mis. "admin,keuangan".`);
  process.exit(1);
}

await set(ref(db, `roles/${uid}`), wanted.length ? wanted.join(",") : null);
console.log(`${uid} -> ${wanted.length ? wanted.join(",") : "(tanpa role)"}`);
console.log("User harus refresh halaman dashboard agar role barunya terbaca.");
process.exit(0);
