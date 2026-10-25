/**
 * Aturan consent Google — bagian yang tidak menyentuh jaringan maupun RTDB.
 *
 * Dipisah dengan alasan yang sama seperti `gating-core.js` dan `plugin-core.js`: yang paling mudah
 * salah di seluruh alur ini bukan panggilan HTTP-nya, melainkan penilaian "apakah consent tadi
 * benar-benar mengubah sesuatu" — dan itu harus bisa diuji tanpa membuka satu pun koneksi.
 *
 * SATU KEGAGALAN YANG MENDASARI SELURUH FILE INI. Google menjawab consent yang sukses secara HTTP
 * meski yang diberikan orangnya lebih sedikit dari yang diminta, dan menjawab tanpa `refresh_token`
 * sama sekali kalau akun itu sudah pernah memberi izin. Ditulis polos, keduanya berakhir sebagai
 * "Connected" di layar untuk kredensial yang tokennya TIDAK berubah — persis kejadian di kredensial
 * petcins.com, yang berbulan-bulan berstatus terhubung dengan token yang hanya membawa scope Ad
 * Manager, dan halaman /adsense-accounts-nya kosong tanpa satu pun keterangan.
 */

/**
 * Scope yang diminta saat consent — SATU-SATUNYA definisinya.
 *
 * Keduanya sekaligus, bukan salah satu: satu kredensial Google bisa memegang network Ad Manager
 * maupun akun AdSense berdiri sendiri, dan token yang cuma membawa satu scope gagal di halaman
 * satunya dengan pesan izin yang bentuknya sama persis dengan token kedaluwarsa.
 *
 * Tinggal di file core (bukan di `oauth.mjs` seperti dulu) supaya server kontrol bisa membacanya
 * tanpa ikut menarik google-auth-library, dan supaya daftar ini serta pemeriksaannya di bawah tidak
 * pernah bisa bergeser satu sama lain.
 */
export const SCOPES = [
  "https://www.googleapis.com/auth/admanager",
  "https://www.googleapis.com/auth/adsense.readonly",
];

// Nama yang dibaca orang di kolom "Izin". Yang tidak terdaftar tetap dihitung sebagai scope yang
// diberikan — hanya namanya yang tidak diterjemahkan.
const SCOPE_LABELS = {
  "https://www.googleapis.com/auth/admanager": "Ad Manager",
  "https://www.googleapis.com/auth/adsense.readonly": "AdSense",
};

export function scopeLabel(scope) {
  return (
    SCOPE_LABELS[scope] ||
    String(scope || "").replace(/^https:\/\/www\.googleapis\.com\/auth\//, "")
  );
}

// Jawaban token Google menaruh scope sebagai satu string dipisah spasi. Bisa juga tidak ada sama
// sekali — dan "tidak disebut" bukan "tidak diberikan", jadi yang keluar dari sini daftar kosong
// dan pemanggilnya yang memutuskan (lihat catatan di `credentialAuthResult`).
export function grantedScopes(scope) {
  return String(scope || "")
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function missingScopes(granted) {
  const have = new Set(grantedScopes(Array.isArray(granted) ? granted.join(" ") : granted));
  return SCOPES.filter((scope) => !have.has(scope));
}

/**
 * Ringkasan untuk kolom "Izin": "Ad Manager + AdSense", "Ad Manager".
 *
 * Kolom ini ada karena pertanyaan "kredensial mana yang belum bisa membaca AdSense" sebelumnya
 * hanya bisa dijawab dengan menembak `tokeninfo` satu per satu dari terminal. Yang belum pernah
 * login lewat tombol tidak punya nilai ini, dan kosong di sana berarti "belum diketahui" — bukan
 * "tidak punya izin apa-apa".
 */
export function scopeSummary(granted) {
  const list = grantedScopes(Array.isArray(granted) ? granted.join(" ") : granted);
  return list.map(scopeLabel).join(" + ");
}

// Nilai yang ditulis di kolom Status. "Connected" dipertahankan apa adanya karena itu yang dibaca
// tombol Login/Reconnect di ResourceList — dan yang sudah tersimpan di record lama.
export const CONNECTED_STATUS = "Connected";
export const PARTIAL_STATUS = "Scope Kurang";

/**
 * Jawaban Google → apa yang ditulis ke record, dan bagaimana hasilnya disebut.
 *
 * Tiga hasil, dan meleburnya menghapus satu-satunya hal yang menentukan tindakan berikutnya —
 * persis seperti `ok`/`unapplied`/`failed` di plugin dan `ok`/`aborted`/`problem` di gating:
 *
 * | `ok`      | token baru datang, seluruh scope diberikan — tidak ada yang perlu dilakukan lagi |
 * | `partial` | token baru datang, TAPI scope-nya kurang — tersimpan, dan tetap tidak bisa dipakai untuk API yang scope-nya hilang |
 * | `failed`  | Google tidak mengembalikan refresh token — TIDAK ADA yang berubah, token lama masih yang dipakai |
 *
 * `failed` adalah yang paling menipu dari ketiganya. Consent-nya berhasil, browsernya kembali
 * dengan selamat, dan tidak ada satu pun error di jalurnya — yang tidak terjadi cuma pergantian
 * tokennya. Karena itu di sini TIDAK ADA yang ditulis ke record: status "Connected" untuk token
 * lama yang scope-nya justru sedang diperbaiki adalah kebohongan yang membuat orang berhenti
 * mencari.
 */
export function credentialAuthResult(tokens, now = new Date().toISOString()) {
  const granted = grantedScopes(tokens?.scope);
  const missing = missingScopes(granted);

  if (!tokens?.refresh_token) {
    return {
      outcome: "failed",
      update: null,
      missing,
      message:
        "Google tidak mengembalikan refresh token, jadi kredensial ini masih memakai token yang lama. " +
        "Cabut akses aplikasi di myaccount.google.com/permissions lalu ulangi Login.",
    };
  }

  const update = {
    refreshToken: tokens.refresh_token,
    // Disimpan mentah supaya yang membacanya nanti tidak bergantung pada daftar label hari ini.
    scopes: granted.join(" "),
    scopeSummary: scopeSummary(granted),
    status: missing.length ? PARTIAL_STATUS : CONNECTED_STATUS,
    lastAuthActionAt: now,
  };

  if (!missing.length) {
    // Dikosongkan, bukan dibiarkan: keterangan kegagalan yang tertinggal dari percobaan sebelumnya
    // akan terbaca sebagai kegagalan yang baru saja terjadi.
    update.authMessage = "";
    return { outcome: "ok", update, missing, message: "" };
  }

  const message = `Token tersimpan, tapi izin ${missing
    .map(scopeLabel)
    .join(" dan ")} tidak diberikan — centang semua izin saat consent lalu ulangi Login.`;
  update.authMessage = message;
  return { outcome: "partial", update, missing, message };
}

/**
 * Nilai `state` untuk satu percobaan consent: id kredensialnya, titik, lalu rahasia sekali pakai.
 *
 * Id-nya ikut di dalam state karena itu satu-satunya yang dikembalikan Google kepada kita — callback
 * datang sebagai GET biasa dari browser, tanpa header, tanpa sesi. Titik sebagai pemisah aman: kunci
 * push RTDB hanya berisi huruf, angka, `-`, dan `_`.
 *
 * Rahasianya yang menjadikan callback tidak bisa dipalsukan, jadi ia harus dibandingkan dengan yang
 * TERSIMPAN di record kredensial itu — bukan sekadar "berbentuk benar".
 */
export function authStateValue(configId, secret) {
  return `${configId}.${secret}`;
}

export function parseAuthState(state) {
  const raw = String(state || "");
  const dot = raw.indexOf(".");
  if (dot <= 0 || dot === raw.length - 1) return null;
  return { configId: raw.slice(0, dot), secret: raw.slice(dot + 1) };
}

// Umur satu percobaan consent. Cukup untuk memilih akun Google dan membaca layar izin, jauh lebih
// pendek dari umur sebuah tab yang dibiarkan terbuka.
export const AUTH_STATE_TTL_MS = 15 * 60 * 1000;

export function authStateEntry(secret, actor, now = Date.now()) {
  return {
    secret,
    actor: String(actor || ""),
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + AUTH_STATE_TTL_MS).toISOString(),
  };
}

/**
 * Kenapa sebuah callback ditolak — atau `""` kalau sah.
 *
 * Dibandingkan dengan yang tersimpan, dan yang tersimpan dihapus oleh pemanggilnya begitu dipakai:
 * sebuah `state` yang bisa dipakai dua kali adalah tautan yang, kalau bocor dari riwayat browser,
 * memasang kredensial Google milik siapa pun ke record ini.
 */
export function authStateProblem(saved, secret, now = Date.now()) {
  if (!saved?.secret) {
    return "Percobaan login ini tidak dikenali lagi — mungkin sudah dipakai. Klik Login sekali lagi.";
  }
  if (String(saved.secret) !== String(secret || "")) {
    return "Percobaan login ini tidak cocok dengan yang tersimpan. Klik Login sekali lagi.";
  }
  if (saved.expiresAt && Date.parse(saved.expiresAt) < now) {
    return "Percobaan login ini sudah kedaluwarsa. Klik Login sekali lagi.";
  }
  return "";
}

// --- Kredensial yang aksesnya hilang SESUDAH consent ---------------------------------------------
//
// `credentialAuthResult` di atas menjaga kebohongan pada saat consent. Yang tidak dijaga siapa pun
// adalah kebohongan yang datang BELAKANGAN: kredensial yang tokennya sah pada hari ia disimpan,
// lalu aksesnya dicabut — orangnya keluar dari network, izin aplikasinya dicabut di
// myaccount.google.com, atau refresh token-nya dimatikan Google. Status hanya pernah ditulis oleh
// tombol Login, jadi kolom Status di /google-api-configs berhenti di "Connected" selamanya
// sementara seluruh laporan kredensial itu ditolak tiap jam.
//
// Persis kejadian petcins: sembilan network berbunyi gagal di panel isu sync, dan satu-satunya
// halaman yang seharusnya menjelaskannya justru menulis bahwa kredensialnya terhubung.

// Nilai yang ditulis saat aksesnya terbukti hilang. Bukan "Disconnected": yang dibaca orang di
// kolom itu harus menyebut TINDAKANNYA, karena tombol di sebelahnya cuma berbunyi "Login".
export const REVOKED_STATUS = "Perlu Dihubungkan";

// Kegagalan yang menyangkut KREDENSIALNYA, bukan satu laporan yang sedang gagal.
//
// Sengaja sempit. 5xx, timeout, dan 429 tidak mengatakan apa pun tentang izin — menurunkan status
// karena itu berarti tiap gangguan sesaat di sisi Google mengirim orang menekan tombol Login untuk
// kredensial yang tidak pernah bermasalah, dan status yang salah ke arah ini menghabiskan waktu
// yang sama dengan status yang salah ke arah sebelumnya.
//
// "belum di-connect" dan "tidak ditemukan" juga TIDAK termasuk: keduanya lahir sebelum satu pun
// permintaan dikirim (`resolveCredential`), jadi keduanya bukan bukti tentang token yang ada —
// dan yang pertama sudah berarti record itu memang belum pernah dihubungkan.
const CREDENTIAL_AUTH_FAILURE =
  /invalid_grant|invalid credentials|permission_denied|insufficient permission|unauthorized|login required|expired token|token .*(kedaluwarsa|expired|revoked|invalid)/i;

// Status HTTP dibaca dari BENTUK yang ditulis pelempar errornya (`-> 401:`, `(HTTP 403)`), bukan
// dari angka tiga digit di mana pun dalam teks — alasan yang sama dengan `statusOf` di
// syncIssueCause.js: `act_5031` juga tiga digit.
function authStatusOf(text) {
  const match = /(?:->|HTTP|status)\s*:?\s*(\d{3})\b/i.exec(text);
  const status = match ? Number(match[1]) : 0;
  return status === 401 || status === 403;
}

export function isCredentialAuthFailure(message) {
  const text = String(message || "");
  return CREDENTIAL_AUTH_FAILURE.test(text) || authStatusOf(text);
}

/**
 * Hasil sync per akun -> status yang perlu ditulis ke `googleApiConfigs`.
 *
 * `outcomes`: `[{ credential, ok, message }]`, satu per akun yang benar-benar dicoba run ini.
 * Yang keluar: `{ [configId]: update }` — kosong kalau tidak ada yang perlu diubah.
 *
 * TIGA ATURAN, dan ketiganya ada karena arah sebaliknya juga bisa berbohong:
 *
 * 1. **Satu akun yang berhasil sudah cukup membatalkan penurunan.** Token yang baru saja dipakai
 *    membaca satu network jelas masih hidup; yang gagal di sebelahnya adalah masalah network itu
 *    sendiri, dan menurunkan status kredensialnya mengirim orang memperbaiki yang tidak rusak.
 * 2. **Kegagalan yang bukan soal izin membatalkannya juga.** Kredensial yang seluruh laporannya
 *    kena 503 tidak kehilangan apa pun.
 * 3. **Yang TIDAK dilakukan sama sekali: menaikkan status kembali.** "Connected" hanya boleh
 *    ditulis oleh consent yang berhasil — satu network GAM yang kembali terbaca tidak membuktikan
 *    scope AdSense-nya ada, dan status yang naik-turun sendiri tiap jam adalah kolom yang berhenti
 *    dibaca orang. Yang mengembalikannya adalah tombol Login, satu-satunya yang benar-benar tahu
 *    izin apa yang diberikan.
 */
export function credentialHealthUpdates(configs, outcomes, now = new Date().toISOString()) {
  const byName = new Map();
  for (const outcome of outcomes || []) {
    // Akun tanpa `googleCredential` memakai GAM_* dari env: tidak ada record yang bisa diturunkan,
    // dan menebak record mana yang dimaksud lebih buruk daripada diam.
    const name = String(outcome?.credential || "").trim();
    if (!name) continue;
    const state = byName.get(name) || { ok: false, auth: 0, other: 0, message: "" };
    if (outcome.ok) state.ok = true;
    else if (isCredentialAuthFailure(outcome.message)) {
      state.auth += 1;
      if (!state.message) state.message = String(outcome.message || "");
    } else state.other += 1;
    byName.set(name, state);
  }

  const updates = {};
  for (const [id, cfg] of Object.entries(configs || {})) {
    const state = byName.get(String(cfg?.name || "").trim());
    if (!state || state.ok || state.other || !state.auth) continue;
    // Sudah turun sejak run sebelumnya: menulis ulang tiap jam cuma menggeser stempel waktunya dan
    // membanjiri activity log dengan perubahan yang tidak mengubah apa pun.
    if (cfg.status === REVOKED_STATUS) continue;
    updates[id] = {
      status: REVOKED_STATUS,
      accessLostAt: now,
      authMessage:
        `Sync ditolak Google untuk seluruh akun kredensial ini — aksesnya perlu dihubungkan ulang ` +
        `lewat tombol Login. Pesan terakhir: ${state.message}`,
    };
  }
  return updates;
}
