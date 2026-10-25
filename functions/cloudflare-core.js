/**
 * Aturan DNS Cloudflare yang TIDAK menyentuh jaringan.
 *
 * Dipisah dari `cloudflare.js` dengan alasan yang sama yang memisahkan `plugin-core.js` dari
 * `plugin-api.mjs` dan `account-status.js` dari pemanggil API-nya: keputusan yang tinggal di dalam
 * pemanggil API tidak bisa diuji tanpa menghubungi Cloudflare — dan yang diputuskan di sini adalah
 * apa yang boleh ditulis ke DNS domain yang sedang menerima trafik iklan berbayar.
 *
 * Yang paling perlu dibaca sebelum menyentuh berkas ini: **satu record DNS yang salah tidak
 * berbunyi sebagai kesalahan di mana pun.** Situsnya cuma berhenti menjawab, dan yang melihatnya
 * pertama kali adalah laporan GAM keesokan harinya — pola yang sama persis dengan kode iklan yang
 * salah di /plugin. Karena itu yang dinormalkan di sini bukan cuma bentuknya melainkan yang
 * DIAM-DIAM SALAH: nama relatif yang berubah jadi `care.petcins.com.petcins.com`, TTL yang tidak
 * boleh berdampingan dengan proxy, dan tipe record yang tidak bisa diproxy sama sekali.
 */

/**
 * Tipe record yang boleh dibuat dari dashboard ini — DAFTAR PUTIH, bukan daftar hitam.
 *
 * Cloudflare mengenal dua puluhan tipe (SRV, CAA, DNSKEY, SMIMEA, ...), dan yang tidak ada di sini
 * bukan berarti berbahaya melainkan tidak pernah dipakai armada ini: 16 A + 1 CNAME di petcins.com,
 * dan bentuk yang sama di sepuluh zona lainnya. Daftar hitam yang meleset membuka tipe yang bentuk
 * `content`-nya tidak diperiksa satu pun aturan di bawah, dan yang tersimpan lalu ditolak Cloudflare
 * dengan pesan yang menyebut nomor kode saja.
 *
 * Yang butuh tipe di luar daftar ini mengerjakannya di dashboard Cloudflare — di sana ia melihat
 * form yang memang dibuat untuk tipe itu.
 */
export const DNS_TYPES = ["A", "AAAA", "CNAME", "TXT", "MX", "NS"];

/**
 * Yang bisa disembunyikan di belakang proxy Cloudflare (awan oranye).
 *
 * Bukan selera dan bukan daftar yang boleh ditambah: proxy bekerja dengan mengganti jawaban DNS
 * dengan IP milik Cloudflare, dan itu hanya berarti untuk record yang jawabannya memang sebuah
 * alamat tujuan HTTP. `proxied: true` pada TXT ditolak Cloudflare; pada MX ia akan MENGHANCURKAN
 * surat masuk domain itu tanpa satu pun pesan kesalahan.
 */
export const PROXIABLE_TYPES = ["A", "AAAA", "CNAME"];

/**
 * TTL 1 = "Auto" di layar Cloudflare, bukan "satu detik".
 *
 * Angka ajaib milik API-nya, dan ia harus punya nama di sini justru karena ia tidak terbaca sebagai
 * apa pun: sebuah kolom TTL yang menggambar "1" apa adanya mengabarkan satu detik kepada yang
 * membacanya, dan itu angka yang akan dikejar orang sebagai kesalahan.
 */
export const TTL_AUTO = 1;

// Batas yang ditegakkan Cloudflare sendiri. Ditulis di sini supaya form menolak SEBELUM menyentuh
// jaringan — 400 dari Cloudflare untuk TTL 30 detik cuma menyebut kode angka.
export const TTL_MIN = 60;
export const TTL_MAX = 86_400;

// Cloudflare memotong komentar yang lebih panjang dari ini tanpa mengeluh.
export const COMMENT_MAX = 100;

export class CloudflareError extends Error {
  constructor(message, { code = "", status = 0 } = {}) {
    super(message);
    this.name = "CloudflareError";
    this.code = code;
    this.status = status;
  }
}

/**
 * Kalimat untuk kode error Cloudflare yang benar-benar bisa ditemui dari halaman ini — apa yang
 * terjadi DAN siapa yang memperbaikinya.
 *
 * Jawaban Cloudflare berbentuk `{ success: false, errors: [{ code, message }] }`, dan `message`-nya
 * ditulis untuk yang memanggil API, bukan untuk yang menekan tombol: "Record already exists" tidak
 * menyebutkan bahwa yang harus dilakukan adalah menyunting record yang sudah ada, dan
 * "Authentication error" untuk token yang izinnya kurang tidak bisa dibedakan dari token yang
 * kedaluwarsa.
 */
const ERROR_HINTS = {
  1004: "Bentuk record ini ditolak Cloudflare — periksa isi kolom Content.",
  // Yang dijawab Cloudflare untuk token yang bentuknya sendiri rusak (salah salin, terpotong).
  // Pesan aslinya "Invalid request headers" — kalimat yang menuduh permintaannya, bukan tokennya,
  // dan yang membuat orang mencari penyebabnya di route ini alih-alih di berkas .env server.
  6003: "Token Cloudflare tidak terbaca — periksa CLOUDFLARE_API_TOKEN di server (salah salin atau terpotong).",
  9103: "Token Cloudflare ditolak — periksa CLOUDFLARE_API_TOKEN di server.",
  10000: "Token Cloudflare ditolak atau izinnya kurang — periksa CLOUDFLARE_API_TOKEN di server.",
  81044: "Record ini tidak ada lagi di Cloudflare — mungkin sudah dihapus dari sisi sana.",
  81053: "Sudah ada record dengan nama dan isi yang sama persis.",
  81057:
    "Sudah ada record lain dengan nama itu, dan Cloudflare tidak mengizinkan keduanya berdiri bersamaan. Sunting yang sudah ada.",
  81058: "Nama record ini tidak termasuk dalam zona yang dipilih.",
};

/**
 * Jawaban Cloudflare yang gagal -> `CloudflareError` yang menyebut sebabnya.
 *
 * Kode di dalam `errors[0]` lebih menentukan daripada status HTTP-nya: Cloudflare menjawab 400
 * untuk "record sudah ada" (yang diperbaiki orang di layar) maupun untuk "token ditolak" (yang
 * diperbaiki admin di server), dan keduanya menuntut tindakan yang sama sekali berbeda.
 */
export function cloudflareError(status, body) {
  const first = Array.isArray(body?.errors) ? body.errors[0] : null;
  const code = String(first?.code || "");
  const hint = ERROR_HINTS[code];
  if (hint) return new CloudflareError(hint, { code, status });

  const detail = String(first?.message || "").trim();
  if (status === 401 || status === 403) {
    return new CloudflareError(
      `Cloudflare menolak token ini${detail ? ` (${detail})` : ""} — periksa CLOUDFLARE_API_TOKEN dan izinnya.`,
      { code, status },
    );
  }
  return new CloudflareError(
    detail ? `Cloudflare menolak: ${detail}` : `Cloudflare menjawab HTTP ${status}.`,
    { code, status },
  );
}

/**
 * Status HTTP yang dijawab server kontrol untuk sebuah `CloudflareError`.
 *
 * Sepola `pluginFailureStatus`: yang salah di sisi ORANG (bentuk record, nama duplikat) jadi 422 —
 * halaman menggambarnya sebagai pesan di form, bukan sebagai server yang rusak. Yang salah di sisi
 * KITA (token) tetap naik jadi 502, karena tidak ada yang bisa dikerjakan orang di layar itu.
 */
export function cloudflareFailureStatus(error) {
  const code = String(error?.code || "");
  if (code === "10000" || code === "9103" || code === "6003") return 502;
  /**
   * "Yang dituju tidak ada" HARUS 404, dan ia diperiksa SEBELUM cabang 422 di bawahnya.
   *
   * Dua yang jatuh ke sini: record yang sudah dihapus dari sisi Cloudflare (81044), dan zona yang
   * bukan milik akun ini (`zone_not_found`, dilempar `zoneOf` di server/cloudflare.js). Keduanya
   * sempat terbaca 422 karena cabang "punya kode berarti isian yang salah" menelannya lebih dulu —
   * dan 422 di sana berbohong dua kali: ia menyuruh orang memperbaiki isian untuk zona yang tidak
   * akan pernah ada di daftarnya, dan ia menyamarkan satu-satunya jawaban yang menandai percobaan
   * menyentuh zona milik akun lain.
   */
  if (code === "81044" || code === "zone_not_found") return 404;
  if (code) return 422;
  return error?.status >= 500 ? 502 : 422;
}

/**
 * Nama record yang LENGKAP, dari apa pun yang diketik orang.
 *
 * Cloudflare menyimpan nama penuh (`care.petcins.com`), sementara yang diketik orang hampir selalu
 * bagian depannya saja (`care`) — itu yang ditampilkan dashboard Cloudflare sendiri di kolom
 * namanya. Tanpa penormalan ini, "care" tersimpan sebagai `care` di zona `petcins.com` — yang
 * DITERIMA Cloudflare dan menjadi `care.petcins.com`, benar secara kebetulan — sementara
 * "care.petcins.com" yang disalin orang dari kolom di sebelahnya menjadi
 * `care.petcins.com.petcins.com`, yang juga diterima dan tidak menjawab apa pun.
 *
 * "@" adalah cara Cloudflare (dan setiap editor zona) menyebut akar domain.
 */
export function dnsRecordName(input, zoneName) {
  const zone = String(zoneName || "")
    .trim()
    .toLowerCase()
    .replace(/\.$/, "");
  const raw = String(input || "")
    .trim()
    .toLowerCase()
    // Titik di ujung adalah bentuk "fully qualified" di berkas zona, dan orang menyalinnya dari
    // sana. Cloudflare tidak menerimanya.
    .replace(/\.$/, "");

  if (!zone) return raw;
  if (!raw || raw === "@" || raw === zone) return zone;
  // Sudah lengkap: dibiarkan apa adanya, termasuk kalau ia beberapa tingkat di dalam zona.
  if (raw.endsWith(`.${zone}`)) return raw;
  return `${raw}.${zone}`;
}

/**
 * Isi form -> record yang siap dikirim ke Cloudflare, atau lempar `CloudflareError`.
 *
 * Melempar dan bukan mengembalikan daftar kesalahan: yang memanggilnya adalah satu route yang
 * menulis satu record, dan pesan pertama yang menghentikannya sudah cukup untuk diperbaiki orang.
 *
 * Yang diperiksa di sini adalah yang bisa diketahui TANPA Cloudflare. Sisanya (nama yang bentrok,
 * zona yang bukan milik akun ini) memang cuma bisa dijawab Cloudflare, dan jawabannya lewat
 * `cloudflareError` di atas.
 */
export function normalizeDnsInput(input, zoneName) {
  const type = String(input?.type || "").toUpperCase();
  if (!DNS_TYPES.includes(type)) {
    throw new CloudflareError(
      `Tipe record "${type || "(kosong)"}" tidak didukung dari sini. Pilih salah satu: ${DNS_TYPES.join(", ")}.`,
    );
  }

  const name = dnsRecordName(input?.name, zoneName);
  if (!name) throw new CloudflareError("Nama record belum diisi.");

  const content = String(input?.content ?? "").trim();
  if (!content) throw new CloudflareError("Isi (content) record belum diisi.");
  assertContent(type, content);

  /**
   * Proxy dipaksa mati untuk tipe yang tidak bisa diproxy — TIDAK ditolak sebagai kesalahan.
   *
   * Kotaknya memang tidak digambar untuk tipe itu (lihat `isProxiable` di src/lib/cloudflareDns.js),
   * jadi `true` di sini hanya bisa datang dari sisa nilai saat orang mengganti tipe di form yang
   * sudah terisi — dan menolaknya berarti pesan kesalahan tentang kotak yang tidak ada di layar.
   */
  const proxied = PROXIABLE_TYPES.includes(type) && Boolean(input?.proxied);

  /**
   * Proxy MENUNTUT TTL auto, dan itu aturan Cloudflare, bukan pilihan kita.
   *
   * Record yang diproxy dijawab dari jaringan Cloudflare, jadi TTL-nya milik mereka. Dikirim
   * bersama TTL lain, permintaannya ditolak seluruhnya — dan yang dibaca orang adalah kegagalan
   * menyimpan untuk kotak TTL yang bahkan tidak ia sentuh.
   */
  const ttl = proxied ? TTL_AUTO : normalizeTtl(input?.ttl);

  const record = { type, name, content, ttl, proxied };

  if (type === "MX") {
    const priority = Number(input?.priority);
    if (!Number.isInteger(priority) || priority < 0 || priority > 65_535) {
      throw new CloudflareError("Record MX butuh Priority berupa angka 0-65535.");
    }
    record.priority = priority;
  }

  const comment = String(input?.comment ?? "").trim();
  if (comment) {
    if (comment.length > COMMENT_MAX) {
      throw new CloudflareError(`Komentar maksimal ${COMMENT_MAX} karakter.`);
    }
    record.comment = comment;
  }

  return record;
}

function normalizeTtl(value) {
  // Kosong = Auto. Bukan "pakai bawaan Cloudflare" melainkan pilihan yang sama dengan yang
  // ditampilkan layar Cloudflare untuk record yang TTL-nya tidak disentuh siapa pun.
  if (value === "" || value === null || value === undefined) return TTL_AUTO;
  const ttl = Number(value);
  if (ttl === TTL_AUTO) return TTL_AUTO;
  if (!Number.isInteger(ttl) || ttl < TTL_MIN || ttl > TTL_MAX) {
    throw new CloudflareError(
      `TTL harus ${TTL_AUTO} (Auto) atau antara ${TTL_MIN} dan ${TTL_MAX} detik.`,
    );
  }
  return ttl;
}

// IPv4 yang tiap oktetnya benar-benar 0-255. Regex "empat kelompok angka" meloloskan 999.1.1.1,
// yang ditolak Cloudflare dengan kode 1004 — pesan yang tidak menyebut oktet mana yang salah.
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
// Hostname, tanpa menuntut TLD yang dikenal: nama internal dan nama di bawah zona sendiri sah.
const HOSTNAME = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))*$/i;

function assertContent(type, content) {
  if (type === "A") {
    const match = IPV4.exec(content);
    const octetsOk = match?.slice(1).every((part) => Number(part) <= 255);
    if (!octetsOk) {
      throw new CloudflareError(`Record A butuh alamat IPv4, bukan "${content}".`);
    }
    return;
  }

  if (type === "AAAA") {
    // Bentuk IPv6 punya delapan cara ditulis (ringkasan "::", campuran IPv4 di ujung); yang
    // diperiksa di sini cuma bahwa ia BUKAN IPv4 yang salah kamar — kesalahan yang benar-benar
    // terjadi. Sisanya diserahkan ke Cloudflare, yang memang punya penguraiannya.
    if (!content.includes(":")) {
      throw new CloudflareError(`Record AAAA butuh alamat IPv6, bukan "${content}".`);
    }
    return;
  }

  if (type === "CNAME" || type === "NS" || type === "MX") {
    if (!HOSTNAME.test(content.replace(/\.$/, ""))) {
      throw new CloudflareError(`Record ${type} butuh nama host, bukan "${content}".`);
    }
    if (IPV4.test(content)) {
      // Kesalahan paling sering dan paling tenang: CNAME ke alamat IP diterima sebagai teks oleh
      // sebagian editor DNS dan tidak pernah menjawab apa pun.
      throw new CloudflareError(
        `Record ${type} harus menunjuk ke nama host, bukan alamat IP. Pakai record A untuk itu.`,
      );
    }
  }
}
