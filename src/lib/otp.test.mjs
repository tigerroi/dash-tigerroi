import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_OTP,
  formatCode,
  normalizeSecret,
  parseOtpInput,
  secondsRemaining,
  secretError,
  timeStepOf,
} from "./otp.js";

test("normalizeSecret menerima bentuk yang ditampilkan aplikasi authenticator", () => {
  assert.equal(
    normalizeSecret("7YQI 6RRB AO2D CHTR 27FV IR7O UADI RLJW"),
    "7YQI6RRBAO2DCHTR27FVIR7OUADIRLJW",
  );
  assert.equal(normalizeSecret("jbswy3dp-ehpk_3pxp"), "JBSWY3DPEHPK3PXP");
  assert.equal(normalizeSecret("JBSWY3DPEHPK3PXP===="), "JBSWY3DPEHPK3PXP");
  assert.equal(normalizeSecret(null), "");
});

test("secretError menyebut karakter yang salah, bukan sekadar 'tidak valid'", () => {
  assert.equal(secretError("7YQI6RRBAO2DCHTR27FVIR7OUADIRLJW"), "");
  assert.match(secretError("JBSWY3DPEHPK3PX1"), /"1"/);
  assert.match(secretError("JBSWY3DP"), /8 karakter/);
  // Kotak yang masih kosong bukan kesalahan — orangnya belum sempat mengetik.
  assert.equal(secretError(""), "");
});

test("secret 16 karakter (10 byte) diterima — itu yang diberikan Google dan Meta", () => {
  assert.equal(secretError("JBSWY3DPEHPK3PXP"), "");
});

test("parseOtpInput: secret telanjang dinormalkan, sisanya default", () => {
  const parsed = parseOtpInput("7yqi 6rrb ao2d chtr 27fv ir7o uadi rljw");
  assert.equal(parsed.secret, "7YQI6RRBAO2DCHTR27FVIR7OUADIRLJW");
  assert.equal(parsed.digits, DEFAULT_OTP.digits);
  assert.equal(parsed.period, DEFAULT_OTP.period);
  assert.equal(parsed.algorithm, DEFAULT_OTP.algorithm);
  assert.equal(parsed.error, "");
});

test("parseOtpInput: URI otpauth membawa digits/period/algorithm-nya sendiri", () => {
  const parsed = parseOtpInput(
    "otpauth://totp/RabbitROI:tim%40rabbit.id?secret=JBSWY3DPEHPK3PXP&issuer=RabbitROI&digits=8&period=60&algorithm=SHA256",
  );
  assert.equal(parsed.secret, "JBSWY3DPEHPK3PXP");
  assert.equal(parsed.issuer, "RabbitROI");
  assert.equal(parsed.label, "tim@rabbit.id");
  assert.equal(parsed.digits, 8);
  assert.equal(parsed.period, 60);
  assert.equal(parsed.algorithm, "sha256");
  assert.equal(parsed.error, "");
});

test("parseOtpInput: nilai URI yang di luar dugaan jatuh ke default, bukan dipakai apa adanya", () => {
  const parsed = parseOtpInput("otpauth://totp/X?secret=JBSWY3DPEHPK3PXP&digits=99&period=2&algorithm=md5");
  assert.equal(parsed.digits, DEFAULT_OTP.digits);
  assert.equal(parsed.period, DEFAULT_OTP.period);
  assert.equal(parsed.algorithm, DEFAULT_OTP.algorithm);
});

test("parseOtpInput: HOTP ditolak dengan sebabnya, tidak dihitung sebagai TOTP", () => {
  const parsed = parseOtpInput("otpauth://hotp/X?secret=JBSWY3DPEHPK3PXP&counter=1");
  assert.equal(parsed.secret, "");
  assert.match(parsed.error, /HOTP/);
});

test("parseOtpInput: URI tanpa secret dan teks yang bukan URI sama-sama punya pesan", () => {
  assert.match(parseOtpInput("otpauth://totp/X?issuer=Y").error, /tidak memuat secret/);
  assert.match(parseOtpInput("otpauth://totp[").error, /tidak bisa dibaca/);
  assert.equal(parseOtpInput("   ").secret, "");
  assert.equal(parseOtpInput("   ").error, "");
});

test("langkah waktu dihitung dari epoch UTC, bukan zona operasi", () => {
  // 1787115750 jatuh di langkah 59570525 untuk period 30 detik.
  assert.equal(timeStepOf(1787115750 * 1000, 30), 59570525);
  assert.equal(timeStepOf(1787115750 * 1000, 60), 29785262);
});

test("secondsRemaining menghitung mundur 30..1, tidak pernah 0", () => {
  assert.equal(secondsRemaining(0, 30), 30);
  assert.equal(secondsRemaining(1000, 30), 29);
  assert.equal(secondsRemaining(29_000, 30), 1);
  assert.equal(secondsRemaining(30_000, 30), 30);
});

test("formatCode memecah dua supaya bisa dibaca sekali lihat", () => {
  assert.equal(formatCode("431083"), "431 083");
  assert.equal(formatCode("54843399"), "5484 3399");
  assert.equal(formatCode(""), "");
});
