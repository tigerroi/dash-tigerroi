import assert from "node:assert/strict";
import test from "node:test";
import {
  authStateEntry,
  authStateProblem,
  authStateValue,
  credentialAuthResult,
  credentialHealthUpdates,
  grantedScopes,
  isCredentialAuthFailure,
  missingScopes,
  parseAuthState,
  REVOKED_STATUS,
  SCOPES,
  scopeSummary,
} from "./google-oauth-core.js";

const GAM = "https://www.googleapis.com/auth/admanager";
const ADSENSE = "https://www.googleapis.com/auth/adsense.readonly";

test("scope yang diminta adalah keduanya, dan urutannya tidak menentukan", () => {
  assert.deepEqual([...SCOPES].sort(), [GAM, ADSENSE].sort());
  assert.deepEqual(missingScopes(`${ADSENSE} ${GAM}`), []);
});

test("scope dibaca dari string dipisah spasi, dan 'tidak disebut' bukan 'diberikan'", () => {
  assert.deepEqual(grantedScopes(`${GAM} ${ADSENSE}`), [GAM, ADSENSE]);
  assert.deepEqual(grantedScopes(""), []);
  assert.deepEqual(missingScopes(""), SCOPES, "jawaban tanpa scope tidak boleh dianggap lengkap");
});

test("ringkasan izin memakai nama yang dibaca orang", () => {
  assert.equal(scopeSummary(`${GAM} ${ADSENSE}`), "Ad Manager + AdSense");
  assert.equal(scopeSummary(GAM), "Ad Manager");
  assert.equal(scopeSummary(""), "");
});

test("consent penuh: token baru tersimpan dan statusnya Connected", () => {
  const res = credentialAuthResult(
    { refresh_token: "baru", scope: `${GAM} ${ADSENSE}` },
    "2026-08-18T10:00:00.000Z",
  );
  assert.equal(res.outcome, "ok");
  assert.equal(res.update.refreshToken, "baru");
  assert.equal(res.update.status, "Connected");
  assert.equal(res.update.scopeSummary, "Ad Manager + AdSense");
  assert.equal(res.update.lastAuthActionAt, "2026-08-18T10:00:00.000Z");
  assert.equal(res.update.authMessage, "", "keterangan kegagalan lama harus dibuang");
});

/**
 * Ini kegagalan yang melahirkan seluruh modul ini: kredensial petcins.com berstatus "Connected"
 * berbulan-bulan dengan token yang cuma membawa scope Ad Manager, dan /adsense-accounts-nya kosong
 * tanpa satu pun keterangan di layar.
 */
test("scope kurang TIDAK boleh berbunyi seperti berhasil", () => {
  const res = credentialAuthResult({ refresh_token: "baru", scope: GAM });
  assert.equal(res.outcome, "partial");
  assert.equal(res.update.refreshToken, "baru", "tokennya tetap tersimpan — ia memang yang terbaru");
  assert.notEqual(res.update.status, "Connected");
  assert.deepEqual(res.missing, [ADSENSE]);
  assert.match(res.update.authMessage, /AdSense/);
});

test("tanpa refresh token, TIDAK ADA yang ditulis — token lama masih yang dipakai", () => {
  const res = credentialAuthResult({ scope: `${GAM} ${ADSENSE}` });
  assert.equal(res.outcome, "failed");
  assert.equal(res.update, null, "status Connected di sini adalah kebohongan tentang token lama");
  assert.match(res.message, /myaccount\.google\.com\/permissions/);
});

test("state membawa id kredensialnya, dan rahasianya boleh berisi apa saja kecuali titik pertama", () => {
  const state = authStateValue("-Nx1", "abc.def");
  assert.deepEqual(parseAuthState(state), { configId: "-Nx1", secret: "abc.def" });
  assert.equal(parseAuthState("tanpatitik"), null);
  assert.equal(parseAuthState(".kosong"), null);
  assert.equal(parseAuthState("kosong."), null);
  assert.equal(parseAuthState(""), null);
});

test("state hanya sah sekali, cocok, dan sebelum kedaluwarsa", () => {
  const now = Date.parse("2026-08-18T10:00:00.000Z");
  const saved = authStateEntry("rahasia", "dev@rabbitracing.live", now);

  assert.equal(authStateProblem(saved, "rahasia", now + 60_000), "");
  assert.match(authStateProblem(saved, "tebakan", now), /tidak cocok/);
  assert.match(authStateProblem(null, "rahasia", now), /tidak dikenali/);
  assert.match(
    authStateProblem(saved, "rahasia", now + 60 * 60 * 1000),
    /kedaluwarsa/,
    "state yang tidak pernah basi adalah tautan yang bisa dipakai ulang dari riwayat browser",
  );
});

/**
 * Kredensial yang aksesnya dicabut SESUDAH consent — kelanjutan langsung dari petcins di atas.
 *
 * Yang dijaga blok tes ini bukan penurunannya saja melainkan kedua arahnya: status yang turun
 * karena gangguan sesaat mengirim orang menekan Login untuk kredensial yang sehat, dan itu sama
 * mahalnya dengan "Connected" yang bertahan untuk kredensial yang sudah mati.
 */
test("seluruh akun satu kredensial ditolak karena izin: statusnya turun", () => {
  const configs = { k1: { name: "petcins", status: "Connected" } };
  const updates = credentialHealthUpdates(
    configs,
    [
      { credential: "petcins", ok: false, message: "GAM POST /v1/networks/2094/reports:run -> 401: Invalid Credentials" },
      { credential: "petcins", ok: false, message: "GAM POST /v1/networks/3011/reports:run -> 401: Invalid Credentials" },
    ],
    "2026-09-01T02:00:00.000Z",
  );
  assert.equal(updates.k1.status, REVOKED_STATUS);
  assert.notEqual(updates.k1.status, "Connected");
  assert.equal(updates.k1.accessLostAt, "2026-09-01T02:00:00.000Z");
  assert.match(updates.k1.authMessage, /Invalid Credentials/);
});

test("satu akun yang berhasil membatalkan penurunan — tokennya jelas masih hidup", () => {
  const configs = { k1: { name: "petcins", status: "Connected" } };
  const updates = credentialHealthUpdates(configs, [
    { credential: "petcins", ok: true },
    { credential: "petcins", ok: false, message: "GAM -> 403: PERMISSION_DENIED" },
  ]);
  assert.deepEqual(updates, {}, "yang gagal adalah network itu sendiri, bukan kredensialnya");
});

test("gangguan di sisi Google tidak menurunkan status siapa pun", () => {
  const configs = { k1: { name: "petcins", status: "Connected" } };
  for (const message of [
    "GAM GET /v1/networks/2094/reports/1:run -> 503: An error has occurred.",
    "GAM POST /v1/networks/2094/reports:run -> 500: An internal error occurred.",
    "fetch failed",
  ]) {
    assert.deepEqual(credentialHealthUpdates(configs, [{ credential: "petcins", ok: false, message }]), {}, message);
  }
});

test("kegagalan izin yang bercampur dengan kegagalan lain tidak cukup jadi bukti", () => {
  const configs = { k1: { name: "petcins", status: "Connected" } };
  const updates = credentialHealthUpdates(configs, [
    { credential: "petcins", ok: false, message: "invalid_grant" },
    { credential: "petcins", ok: false, message: "GAM -> 503: An error has occurred." },
  ]);
  assert.deepEqual(updates, {});
});

test("yang sudah turun tidak ditulis ulang tiap jam", () => {
  const configs = { k1: { name: "petcins", status: REVOKED_STATUS } };
  assert.deepEqual(
    credentialHealthUpdates(configs, [{ credential: "petcins", ok: false, message: "invalid_grant" }]),
    {},
  );
});

// Yang menaikkan status kembali hanya consent. Sync yang berhasil membuktikan tokennya hidup, BUKAN
// bahwa scope-nya lengkap — dan kolom yang naik-turun sendiri tiap jam berhenti dibaca orang.
test("sync yang berhasil TIDAK mengembalikan status ke Connected", () => {
  const configs = { k1: { name: "petcins", status: REVOKED_STATUS } };
  assert.deepEqual(credentialHealthUpdates(configs, [{ credential: "petcins", ok: true }]), {});
  const kurang = { k1: { name: "petcins", status: "Scope Kurang" } };
  assert.deepEqual(credentialHealthUpdates(kurang, [{ credential: "petcins", ok: true }]), {});
});

// Akun tanpa googleCredential memakai GAM_* dari env: tidak ada record yang bisa diturunkan.
test("akun yang memakai kredensial env tidak menurunkan record mana pun", () => {
  const configs = { k1: { name: "petcins", status: "Connected" } };
  assert.deepEqual(
    credentialHealthUpdates(configs, [{ credential: "", ok: false, message: "invalid_grant" }]),
    {},
  );
});

test("kegagalan yang lahir sebelum permintaan dikirim bukan bukti tentang tokennya", () => {
  const configs = { k1: { name: "petcins", status: "Connected" } };
  for (const message of [
    '"petcins" belum di-connect (klik Login).',
    'googleCredential "petcins" tidak ditemukan.',
  ]) {
    assert.equal(isCredentialAuthFailure(message), false, message);
  }
});
