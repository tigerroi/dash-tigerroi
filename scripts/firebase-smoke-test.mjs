import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { getDatabase, ref, get, set, remove } from "firebase/database";

// Skrip uji koneksi Firebase & Realtime Database untuk TigerROI.
// Membaca kredensial dari .env (root) dan menguji autentikasi serta hak akses database.

function loadEnv() {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) {
    console.error("❌ File .env tidak ditemukan di root project!");
    console.error("   Salin .env.example menjadi .env terlebih dahulu lalu isi nilainya.");
    process.exit(1);
  }

  const content = readFileSync(envPath, "utf-8");
  const env = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      env[key] = val;
    }
  }
  return env;
}

async function main() {
  console.log("==================================================");
  console.log("   TIGERROI - FIREBASE & RTDB SMOKE TEST");
  console.log("==================================================\n");

  const env = loadEnv();

  const apiKey = env.VITE_FIREBASE_API_KEY || env.FIREBASE_API_KEY;
  const authDomain = env.VITE_FIREBASE_AUTH_DOMAIN || env.FIREBASE_AUTH_DOMAIN;
  const projectId = env.VITE_FIREBASE_PROJECT_ID || env.FIREBASE_PROJECT_ID;
  const databaseURL = env.VITE_FIREBASE_DATABASE_URL || env.FIREBASE_DATABASE_URL;
  const appId = env.VITE_FIREBASE_APP_ID || env.FIREBASE_APP_ID;

  if (!apiKey || !projectId || !databaseURL) {
    console.error("❌ Konfigurasi Firebase di .env belum lengkap!");
    console.error("   Pastikan VITE_FIREBASE_API_KEY, VITE_FIREBASE_PROJECT_ID, dan VITE_FIREBASE_DATABASE_URL terisi.");
    process.exit(1);
  }

  console.log("📋 Menggunakan konfigurasi Firebase:");
  console.log(`   - Project ID   : ${projectId}`);
  console.log(`   - Auth Domain  : ${authDomain || "(default)"}`);
  console.log(`   - Database URL : ${databaseURL}`);
  console.log("");

  // Inisialisasi Firebase App
  const app = initializeApp({
    apiKey,
    authDomain,
    projectId,
    databaseURL,
    appId,
  });

  const auth = getAuth(app);
  const db = getDatabase(app);

  // Ambil email & password dari argumen CLI atau input interaktif
  let email = process.argv[2] || env.TEST_EMAIL || env.SYNC_USER_EMAIL;
  let password = process.argv[3] || env.TEST_PASSWORD || env.SYNC_USER_PASSWORD;

  if (!email || !password) {
    console.log("ℹ️  Masukkan akun Firebase Auth Anda untuk pengujian:");
    const rl = readline.createInterface({ input, output });
    try {
      if (!email) email = await rl.question("   Email: ");
      if (!password) password = await rl.question("   Password: ");
    } finally {
      rl.close();
    }
  }

  email = String(email || "").trim();
  password = String(password || "").trim();

  if (!email || !password) {
    console.error("❌ Email dan password tidak boleh kosong.");
    process.exit(1);
  }

  // 1. Tes Login Authentication
  console.log(`\n⏳ [1/4] Menguji login Firebase Auth (${email})...`);
  let userCredential;
  try {
    userCredential = await signInWithEmailAndPassword(auth, email, password);
    console.log(`   ✅ Login BERHASIL!`);
    console.log(`      UID: ${userCredential.user.uid}`);
  } catch (err) {
    console.error(`   ❌ Login GAGAL: ${err.code} - ${err.message}`);
    console.error("\n💡 Tips Troubleshooting:");
    console.error("   - Pastikan Email/Password provider aktif di Firebase Console > Authentication > Sign-in method.");
    console.error("   - Pastikan user sudah terdaftar di tab Authentication > Users.");
    process.exit(1);
  }

  const uid = userCredential.user.uid;

  // 2. Tes Membaca Role Pengguna
  console.log(`\n⏳ [2/4] Memeriksa role pengguna di /roles/${uid}...`);
  let role = null;
  try {
    const roleSnapshot = await get(ref(db, `roles/${uid}`));
    role = roleSnapshot.val();
    if (role) {
      console.log(`   ✅ Role ditemukan: "${role}"`);
    } else {
      console.log(`   ⚠️  Pengguna ini BELUM memiliki entri di /roles/${uid}`);
      console.log(`      (Akses tulis database akan ditolak sampai peran admin/superadmin diatur di console).`);
    }
  } catch (err) {
    console.error(`   ❌ Gagal membaca /roles/${uid}: ${err.message}`);
  }

  // 3. Tes Membaca Database (Read Test)
  console.log(`\n⏳ [3/4] Menguji akses BACA database (/dashboard)...`);
  try {
    const dashSnap = await get(ref(db, "dashboard/syncRuns"));
    console.log(`   ✅ Akses baca BERHASIL! (Status node dashboard/syncRuns terbaca: ${dashSnap.exists() ? "ada data" : "node kosong"})`);
  } catch (err) {
    console.error(`   ❌ Akses baca GAGAL: ${err.message}`);
  }

  // 4. Tes Menulis ke Database (Write Test)
  console.log(`\n⏳ [4/4] Menguji akses TULIS database (/dashboard/smokeTest)...`);
  const testRef = ref(db, "dashboard/smokeTest");
  try {
    await set(testRef, {
      testedBy: uid,
      email,
      testedAt: new Date().toISOString(),
      note: "Smoke test otomatis TigerROI",
    });
    console.log(`   ✅ Tulis data BERHASIL!`);

    // Bersihkan data tes
    await remove(testRef);
    console.log(`   ✅ Pembersihan node tes BERHASIL!`);
  } catch (err) {
    console.error(`   ❌ Akses tulis GAGAL: ${err.message}`);
    if (err.message.includes("Permission denied")) {
      console.log("\n💡 Solusi 'Permission denied':");
      console.log(`   Database rules menuntut hak akses 'admin' atau 'superadmin'.`);
      console.log(`   Buka Firebase Console > Realtime Database > Data:`);
      console.log(`   Tambahkan node 'roles' -> '${uid}' dengan nilai '"superadmin"'.`);
    }
  }

  console.log("\n==================================================");
  console.log("   PENGUJIAN SELESAI");
  console.log("==================================================\n");
  process.exit(0);
}

main().catch((err) => {
  console.error("Error tidak terduga:", err);
  process.exit(1);
});
