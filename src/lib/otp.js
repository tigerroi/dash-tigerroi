// Secret key → enam angka yang berumur tiga puluh detik. Yang menghitungnya otplib
// (`generateSync`, TOTP RFC 6238); yang di sini adalah semua yang harus dipahami SEBELUM secret-nya
// sampai ke sana — dan itu bagian yang paling sering salah.
//
// Kenapa berdiri sendiri dan bukan di dalam komponen: satu-satunya cara menguji "secret yang
// ditempel dari layar Google Authenticator tetap menghasilkan kode yang sama" adalah fungsi murni.

// Alfabet Base32 RFC 4648 — yang sama dipakai otplib, Google Authenticator, dan Meta.
const BASE32_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

const OTP_DIGIT_OPTIONS = [6, 7, 8];
const OTP_ALGORITHM_OPTIONS = ["sha1", "sha256", "sha512"];

// Bentuk yang dipakai hampir semua penerbit; juga nilai yang berlaku kalau URI-nya tidak menyebut.
export const DEFAULT_OTP = { digits: 6, period: 30, algorithm: "sha1" };

// 16 karakter Base32 = 10 byte. RFC 4226 menganjurkan 16 BYTE, dan otplib v13 menolak yang lebih
// pendek lewat guardrail `MIN_SECRET_BYTES` — tapi secret 16 karakter adalah yang benar-benar
// diberikan Google, Meta, dan sebagian besar layanan lain. Menolaknya di sini berarti halaman ini
// tidak bisa dipakai untuk akun yang justru paling sering dibuka, jadi guardrail-nya diturunkan
// (lihat OTP_GUARDRAIL_MIN_BYTES di OtpPage) dan batas bawahnya ditulis di sini.
const MIN_SECRET_CHARS = 16;

// Batas period yang masih masuk akal untuk sebuah TOTP. Bukan aturan RFC — penjaga salah ketik:
// period 3 detik menghasilkan kode yang tidak pernah sempat dibaca, period 0 membagi nol.
const MIN_PERIOD = 15;
const MAX_PERIOD = 300;

/**
 * Bentuk yang bisa dibaca otplib: huruf besar, tanpa spasi, tanpa padding.
 *
 * Google Authenticator menampilkan secret-nya berkelompok empat ("7YQI 6RRB AO2D ..."), dan itulah
 * yang orang salin. otplib menolaknya mentah-mentah — `Unknown letter " "` — jadi tanpa langkah ini
 * halaman ini gagal untuk cara paling wajar orang memasukkan secret-nya.
 */
export function normalizeSecret(raw) {
  return String(raw || "")
    .toUpperCase()
    .replace(/[\s._-]/g, "")
    .replace(/=+$/, "");
}

// Label yang persen-encoding-nya rusak tetap label; `decodeURIComponent` yang melempar akan
// menjatuhkan seluruh halaman demi sepotong teks hiasan.
function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isOtpAuthUri(raw) {
  return /^otpauth:\/\//i.test(String(raw || "").trim());
}

/**
 * Alasan secret ini tidak bisa dipakai, atau "" kalau tidak ada.
 *
 * Diperiksa di sini dan bukan lewat try/catch di sekitar otplib karena pesan otplib berbahasa
 * Inggris dan menyebut nama internalnya ("Invalid Base32 string: Excess padding") — yang membaca
 * layar ini sedang menyalin secret, bukan membaca stack trace.
 */
export function secretError(secret) {
  if (!secret) {
    return "";
  }

  const invalid = [...secret].find((char) => !BASE32_CHARS.includes(char));
  if (invalid) {
    // Angka 0/1/8 dan huruf O/I/L adalah salah ketik yang paling sering: tidak satu pun ada di
    // alfabet Base32, dan bentuknya mirip yang ada.
    return `Karakter "${invalid}" bukan Base32. Yang boleh hanya A–Z dan 2–7.`;
  }

  if (secret.length < MIN_SECRET_CHARS) {
    return `Secret key terlalu pendek — ${secret.length} karakter, minimal ${MIN_SECRET_CHARS}.`;
  }

  return "";
}

/**
 * Satu kotak masukan untuk dua bentuk yang beredar: secret Base32 telanjang, dan `otpauth://` utuh
 * hasil "tampilkan kode QR sebagai teks".
 *
 * URI-nya membawa digits/period/algorithm sendiri, dan itu alasan bentuk ini didukung: penerbit
 * yang memakai 6 digit/30 detik tidak perlu dikenali, tapi yang memakai 8 digit akan menghasilkan
 * kode yang salah tanpa satu pun pesan kalau nilainya harus ditebak orang.
 *
 * Selalu mengembalikan bentuk yang sama, jadi pemanggilnya tidak perlu membedakan keduanya.
 */
export function parseOtpInput(raw) {
  const text = String(raw || "").trim();
  const empty = { ...DEFAULT_OTP, secret: "", issuer: "", label: "", error: "" };

  if (!text) {
    return empty;
  }

  if (!isOtpAuthUri(text)) {
    const secret = normalizeSecret(text);
    return { ...empty, secret, error: secretError(secret) };
  }

  let url;
  try {
    url = new URL(text);
  } catch {
    return { ...empty, error: "URI otpauth ini tidak bisa dibaca." };
  }

  // `otpauth://totp/...` vs `otpauth://hotp/...`. HOTP berbasis counter, bukan waktu: ia tidak punya
  // hitungan mundur dan kodenya maju hanya saat dipakai. Ditolak dengan sebabnya, bukan dihitung
  // sebagai TOTP — yang akan menghasilkan enam angka yang tidak pernah diterima siapa pun.
  const strategy = url.host.toLowerCase();
  if (strategy && strategy !== "totp") {
    return { ...empty, error: "URI ini HOTP (berbasis counter). Halaman ini hanya untuk TOTP." };
  }

  const secret = normalizeSecret(url.searchParams.get("secret"));
  if (!secret) {
    return { ...empty, error: "URI otpauth ini tidak memuat secret." };
  }

  // "Issuer:label", bentuk yang dipakai Google Authenticator. Issuer di query menang kalau ada —
  // begitu yang ditulis spesifikasinya, dan yang di path sering tertinggal dari nama lama layanan.
  const path = safeDecode(url.pathname.replace(/^\//, ""));
  const separator = path.indexOf(":");
  const label = separator === -1 ? path : path.slice(separator + 1).trim();
  const issuer =
    url.searchParams.get("issuer") || (separator === -1 ? "" : path.slice(0, separator));

  const digits = Number(url.searchParams.get("digits") || DEFAULT_OTP.digits);
  const period = Number(url.searchParams.get("period") || DEFAULT_OTP.period);
  const algorithm = String(
    url.searchParams.get("algorithm") || DEFAULT_OTP.algorithm,
  ).toLowerCase();

  const parsed = {
    secret,
    issuer: issuer || "",
    label: label || "",
    digits: OTP_DIGIT_OPTIONS.includes(digits) ? digits : DEFAULT_OTP.digits,
    period:
      Number.isFinite(period) && period >= MIN_PERIOD && period <= MAX_PERIOD
        ? period
        : DEFAULT_OTP.period,
    algorithm: OTP_ALGORITHM_OPTIONS.includes(algorithm) ? algorithm : DEFAULT_OTP.algorithm,
    error: "",
  };

  return { ...parsed, error: secretError(secret) };
}

/**
 * Langkah waktu yang sedang berjalan — nomor "menit ke-" milik TOTP.
 *
 * Yang memakainya adalah kunci render: kode hanya dihitung ulang saat angka ini berubah, bukan tiap
 * detak jam. Zona waktu tidak ikut sama sekali (berbeda dari seluruh tanggal di dashboard ini):
 * TOTP dihitung dari epoch UTC, dan itulah yang membuat kode di sini sama dengan kode di ponsel.
 */
export function timeStepOf(nowMs, period = DEFAULT_OTP.period) {
  return Math.floor(nowMs / 1000 / period);
}

/** Sisa umur kode yang sedang tampil, dalam detik (1..period). */
export function secondsRemaining(nowMs, period = DEFAULT_OTP.period) {
  return period - (Math.floor(nowMs / 1000) % period);
}

/**
 * "431083" → "431 083". Dipecah dua supaya bisa disalin dengan mata, bukan hanya dengan tombol —
 * enam angka beruntun adalah bentuk yang paling mudah salah dibaca.
 */
export function formatCode(code) {
  const text = String(code || "");
  if (text.length < 6) {
    return text;
  }

  const half = Math.ceil(text.length / 2);
  return `${text.slice(0, half)} ${text.slice(half)}`;
}
