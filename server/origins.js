// Daftar origin yang boleh memanggil server kontrol — diurai dari `ALLOWED_ORIGINS`.
//
// Dipisah dari index.js supaya bisa diuji tanpa menyalakan server: index.js melakukan `connect()`
// dan memasang cron di tingkat modul, jadi apa pun yang mengimpornya untuk memeriksa satu daftar
// akan ikut login ke Firebase dan menembakkan siklus gating.

/**
 * Entri berpola `https://*.contoh.com` — satu-satunya bentuk wildcard yang dikenal.
 *
 * `*` HANYA boleh jadi label paling kiri. Wildcard di tengah ("https://a.*.com") tidak ditawarkan
 * bukan karena sulit, melainkan karena ia tidak punya arti yang bisa dibaca sekali lihat — dan
 * daftar ini adalah daftar izin: yang harus bisa dibaca sekali lihat justru siapa saja yang masuk.
 */
const WILDCARD = /^([a-z][a-z0-9+.-]*:\/\/)\*\.(.+)$/i;

export function parseOrigins(raw, fallback = "") {
  return String(raw || fallback || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function isWildcardOrigin(entry) {
  return WILDCARD.test(String(entry || ""));
}

/**
 * Satu entri → nilai yang dimengerti @elysiajs/cors: string apa adanya, atau RegExp untuk wildcard.
 *
 * Yang dicocokkan `cors` adalah header `Origin` UTUH ("https://sub.contoh.com" — skema + host,
 * tanpa path), jadi polanya dijangkarkan di KEDUA ujung. Tanpa jangkar, "https://contoh.com" akan
 * cocok dengan "https://contoh.com.penyerang.id", dan titiknya wajib di-escape supaya
 * "https://a.contohXcom" tidak ikut lolos — dua kesalahan yang tidak berbunyi sebagai apa pun,
 * karena yang salah hanya terlihat pada hari ada yang mendaftarkan domain miripnya.
 *
 * SKEMA IKUT DICOCOKKAN. `https://*.contoh.com` tidak menerima `http://` — origin yang sama lewat
 * HTTP adalah halaman yang isinya bisa disisipi siapa pun di jalur jaringannya.
 */
export function originMatcher(entry) {
  const text = String(entry || "");
  const wildcard = text.match(WILDCARD);
  if (!wildcard) return text;

  const [, scheme, suffix] = wildcard;
  assertWildcardSuffix(text, suffix);

  // `[a-z0-9-]+(\.[a-z0-9-]+)*` = satu label ATAU lebih, jadi "a.b.contoh.com" ikut — "semua
  // subdomain" memang berarti sampai ke dalam. Yang TIDAK ikut adalah apex-nya sendiri
  // ("https://contoh.com"), sepola sertifikat wildcard: kalau ia juga boleh, ia ditulis sebagai
  // entri tersendiri. Menebaknya di sini berarti daftar izin memuat satu nama yang tidak tertulis
  // di mana pun.
  return new RegExp(
    `^${escapeRegex(scheme)}[a-z0-9-]+(\\.[a-z0-9-]+)*\\.${escapeRegex(suffix)}$`,
    "i",
  );
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Wildcard yang cuma menyisakan SATU label membuka seluruh TLD, dan itu ditolak keras.
 *
 * `https://*.live` menerima setiap domain .live di dunia — dan bentuk itu lahir dari satu label
 * yang terhapus saat menyunting, bukan dari niat. Dibiarkan lolos, ia jadi CORS terbuka yang
 * tertulis seperti CORS tertutup: log start tetap mencetak satu baris yang tampak wajar, dan tidak
 * ada satu pun permintaan yang gagal untuk mengabarkannya.
 *
 * Dilempar, bukan dilewati diam-diam: entri yang dibuang menghasilkan dashboard yang tertolak CORS
 * dengan gejala yang sama persis dengan server mati, dan yang mencarinya akan mulai dari tempat
 * yang salah. Yang dilempar hanya bentuk BARU ini — entri string biasa tidak diperiksa sama sekali,
 * jadi tidak ada konfigurasi yang sudah jalan hari ini yang bisa mulai menolak naik karenanya.
 */
function assertWildcardSuffix(entry, suffix) {
  if (suffix.includes("*")) {
    throw new Error(`ALLOWED_ORIGINS "${entry}": * hanya boleh jadi label paling kiri.`);
  }
  if (suffix.includes("/")) {
    throw new Error(`ALLOWED_ORIGINS "${entry}": origin tidak boleh punya path.`);
  }
  if (suffix.split(".").filter(Boolean).length < 2) {
    throw new Error(
      `ALLOWED_ORIGINS "${entry}": wildcard menyisakan satu label ("${suffix}") — itu membuka seluruh TLD. Tulis domain lengkapnya.`,
    );
  }
}

export function corsOrigins(entries) {
  return (entries || []).map(originMatcher);
}

/**
 * Tempat orang mendarat sesudah consent Google — dan ia WAJIB alamat sungguhan.
 *
 * `appUrl` dulu `ORIGINS[0]` apa adanya. Sejak daftar ini boleh memuat wildcard, entri pertama bisa
 * berupa pola: yang mendarat sesudah OAuth lalu diarahkan ke "https://*.contoh.com", alamat yang
 * tidak pernah ada. Kegagalannya jauh dari sebabnya — yang berubah adalah satu koma di
 * ALLOWED_ORIGINS, yang rusak adalah login Google.
 */
export function landingOrigin(entries) {
  return (entries || []).find((entry) => !isWildcardOrigin(entry)) || "";
}
