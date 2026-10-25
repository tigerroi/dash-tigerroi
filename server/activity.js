import { Elysia, status, t } from "elysia";
import geoip from "geoip-lite";
import { UAParser } from "ua-parser-js";
import { AuthError, bearerToken, requireSuperAdmin, requireUser } from "./auth.js";

/**
 * Penerima jejak aktivitas dari browser tiap orang.
 *
 * KENAPA LEWAT SINI DAN BUKAN LANGSUNG KE RTDB — tiga field terpenting di sebuah baris log audit
 * tidak ada di browser sama sekali:
 *
 *   - `ip` — sebuah halaman tidak tahu alamat publiknya sendiri. Yang mengaku tahu sedang mengutip
 *     layanan pihak ketiga, atau mengarangnya.
 *   - `city` — diturunkan dari IP di atas, jadi ia mewarisi masalah yang sama.
 *   - `userAgent` — browser boleh menulis apa saja tentang dirinya sendiri; yang datang sebagai
 *     header setidaknya datang bersama koneksinya.
 *
 * Log yang tiap barisnya bisa dikarang oleh orang yang dicatatnya bukan log audit. Karena itu
 * ketiganya dicap DI SINI dan tidak pernah dibaca dari body — kalaupun browser mengirimkannya,
 * yang tertulis tetap yang dilihat server.
 *
 * Yang dipercaya dari body cuma yang memang hanya diketahui browser: apa yang diklik, halaman apa
 * yang dibuka, dan kapan menurut jamnya sendiri.
 */

// Kunci RTDB tidak boleh memuat `. $ # [ ] /`. UUID tidak pernah memuatnya, tapi id itu datang dari
// browser — dan sebuah id yang lolos ke `store.update()` sebagai "a/b" akan menulis ke cabang lain
// alih-alih menjadi satu baris.
const ID_PATTERN = "^[A-Za-z0-9_-]{8,64}$";

// Batas atas satu bacaan halaman /activity-logs — cerminan ACTIVITY_QUERY_LIMIT di sisi browser.
// Rentang yang isinya lebih dari ini dipotong dari yang TERBARU, dan halaman mengatakan ia dipotong.
const QUERY_LIMIT = 3000;

/**
 * Berapa proxy tepercaya yang berdiri di depan server ini.
 *
 * `X-Forwarded-For` DITAMBAHI tiap hop, dan yang paling kiri adalah yang ditulis KLIEN — siapa pun
 * bisa mengirim `X-Forwarded-For: 1.2.3.4` dan mengganti alamatnya sendiri di log. Yang benar-benar
 * diamati adalah entri yang ditulis proxy TERDEKAT, dihitung dari kanan.
 *
 * Satu hop adalah bawaan karena server ini berdiri di belakang satu reverse proxy. Diberi 0, yang
 * dipakai adalah alamat peer koneksi apa adanya — benar untuk server yang menghadap internet
 * langsung, dan akan mencatat alamat proxy-nya sendiri untuk yang tidak.
 */
const TRUST_HOPS = Number(process.env.TRUST_PROXY_HOPS ?? 1);

// Masa simpan. 90 hari: satu kuartal penuh, yaitu satuan yang benar-benar dipakai saat menelusuri
// ke belakang — "siapa yang mengubah tarif itu kuartal lalu" tidak terjawab oleh jendela sebulan,
// dan yang jatuh di luar jendela tidak hilang sebagian melainkan hilang seluruhnya, tanpa satu pun
// tanda di layar yang membedakannya dari "memang tidak ada aktivitas".
//
// Yang membayar perpanjangan ini adalah DISK VPS, bukan Firebase: jejak ini tinggal di SQLite lokal
// sejak pindah dari RTDB, jadi tiga kali masa simpan berarti tiga kali ukuran file dan NOL tambahan
// biaya download RTDB. Batas baca per rentang (QUERY_LIMIT) tidak ikut berubah — yang bertambah
// adalah rentang yang BISA diminta, bukan jumlah baris satu bacaan.
const RETENTION_DAYS = Number(process.env.ACTIVITY_LOG_DAYS || 90);

/**
 * Header → alamat klien.
 *
 * Dipisah dan diekspor supaya bisa diuji tanpa jaringan: yang menentukan benar-salahnya adalah
 * aritmetika indeks di atas, dan itu satu-satunya bagian yang bisa salah diam-diam.
 */
export function clientIp(headers, peer = "", hops = TRUST_HOPS) {
  // Cloudflare menulisnya sendiri dan menimpanya tiap request, jadi ia tidak bisa dititipkan klien.
  const cf = String(headers?.["cf-connecting-ip"] || "").trim();
  if (cf) return normalizeIp(cf);

  const forwarded = String(headers?.["x-forwarded-for"] || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  if (hops > 0 && forwarded.length) {
    // length - hops, bukan `[0]`: dengan satu proxy yang menambahkan alamat peer di ujung, entri
    // terakhir adalah yang benar-benar diamati. `[0]` justru mengambil yang paling bisa dikarang.
    return normalizeIp(forwarded[Math.max(0, forwarded.length - hops)]);
  }

  return normalizeIp(peer || String(headers?.["x-real-ip"] || ""));
}

// "::ffff:103.94.190.1" → "103.94.190.1". Alamat IPv4 yang datang lewat socket IPv6 ditulis dalam
// bentuk terpetakan, dan bentuk itu tidak dikenali satu pun basis data geolokasi.
function normalizeIp(value) {
  const ip = String(value || "").trim();
  return ip.startsWith("::ffff:") ? ip.slice(7) : ip;
}

/**
 * IP → kota, tanpa memanggil siapa pun.
 *
 * `geoip-lite` membawa basis datanya sendiri (MaxMind GeoLite2) dan mencarinya di memori. Layanan
 * lookup daring akan berarti mengirim alamat IP seluruh tim ke pihak ketiga, satu per baris log,
 * dan menambahkan kegagalan jaringan ke jalur yang tugasnya justru mencatat.
 *
 * Yang tidak ketemu tetap KOSONG, bukan ditebak. Alamat kantor di balik VPN dan rentang CDN
 * memang tidak punya kota; sebuah "Jakarta" yang dikarang untuk baris seperti itu akan dibaca
 * sebagai fakta oleh orang yang menelusuri akses mencurigakan.
 */
export function geoOf(ip) {
  if (!ip) return { city: "", region: "", country: "" };
  try {
    const found = geoip.lookup(ip);
    if (!found) return { city: "", region: "", country: "" };
    return {
      city: String(found.city || ""),
      region: String(found.region || ""),
      country: String(found.country || ""),
    };
  } catch {
    // Basis data yang gagal dibaca tidak boleh menjatuhkan penulisan barisnya: IP-nya sendiri jauh
    // lebih berharga daripada nama kotanya.
    return { city: "", region: "", country: "" };
  }
}

// User-Agent → nama yang bisa dibaca orang. Kolom tabelnya sempit, dan string UA mentah sepanjang
// 150 karakter di tiap baris membuat kolom lain tidak terlihat — mentahnya tetap disimpan.
export function deviceOf(userAgent) {
  if (!userAgent) return { browser: "", os: "", device: "" };
  try {
    const parsed = UAParser(userAgent);
    const browser = [parsed.browser?.name, parsed.browser?.major].filter(Boolean).join(" ");
    const os = [parsed.os?.name, parsed.os?.version].filter(Boolean).join(" ");
    // `device.type` kosong berarti desktop — ua-parser hanya mengisinya untuk yang bukan.
    const device =
      [parsed.device?.vendor, parsed.device?.model].filter(Boolean).join(" ") ||
      parsed.device?.type ||
      "Desktop";
    return { browser, os, device };
  } catch {
    return { browser: "", os: "", device: "" };
  }
}

/**
 * Satu baris dari browser + apa yang diamati server = satu baris RTDB.
 *
 * `receivedAt` berdiri di sebelah `at` dan tidak menggantikannya: `at` adalah jam PERANGKAT, yang
 * boleh saja meleset berjam-jam, dan yang menjelaskan urutan aneh di tabel justru selisih keduanya.
 * Menimpa `at` dengan jam server akan menghapus satu-satunya petunjuk itu.
 */
export function activityRow(event, observed) {
  return {
    id: event.id,
    at: event.at,
    receivedAt: observed.receivedAt,
    category: event.category,
    action: event.action,
    page: event.page || "",
    label: event.label || "",
    target: event.target || "",
    detail: event.detail || "",
    status: event.status || "ok",
    actorUid: event.actorUid || "",
    actorEmail: event.actorEmail || "",
    actorRole: event.actorRole || "",
    ip: observed.ip,
    city: observed.city,
    region: observed.region,
    country: observed.country,
    browser: observed.browser,
    os: observed.os,
    device: observed.device,
    userAgent: observed.userAgent,
    /**
     * Siapa yang benar-benar mengirim baris ini.
     *
     * Berbeda dari `actorEmail` untuk satu hal yang justru paling perlu tercatat: LOGIN YANG GAGAL.
     * Percobaan yang gagal tidak punya token, jadi barisnya menunggu di localStorage perangkat itu
     * dan berangkat menumpang sesi berikutnya yang berhasil login di sana. Tanpa cap ini, baris
     * titipan tidak bisa dibedakan dari baris yang dikirim pemiliknya sendiri — dan seseorang bisa
     * menaruh kejadian atas nama orang lain di riwayat hanya dengan menyunting localStorage-nya.
     */
    reportedByUid: observed.reportedByUid,
    reportedByEmail: observed.reportedByEmail,
  };
}

export function activityRoutes({ db, activityDb, authorize, authorizeRead }) {
  const check = authorize || ((token) => requireUser(db, token));
  // Membaca halamannya SUPERADMIN, mengirim jejaknya setiap akun — asimetri yang sama dengan RTDB
  // dulu (`.read` superadmin, `.write` admin). Gerbang baca terpisah dari gerbang kirim.
  const checkRead = authorizeRead || ((token) => requireSuperAdmin(db, token));

  return (
    new Elysia({ prefix: "/activity-logs" })
      .macro({
        identified: {
          async resolve({ headers }) {
            try {
              return { actor: await check(bearerToken(headers.authorization)) };
            } catch (error) {
              if (error instanceof AuthError) return status(error.status, { error: error.message });
              return status(503, { error: `Izin tidak bisa diperiksa sekarang: ${error.message}` });
            }
          },
        },
        superadmin: {
          async resolve({ headers }) {
            try {
              return { actor: await checkRead(bearerToken(headers.authorization)) };
            } catch (error) {
              if (error instanceof AuthError) return status(error.status, { error: error.message });
              return status(503, { error: `Izin tidak bisa diperiksa sekarang: ${error.message}` });
            }
          },
        },
      })

      /**
       * Baca sepotong jejak untuk halaman /activity-logs — per rentang tanggal, bukan seluruh tabel.
       *
       * Menggantikan bacaan langsung RTDB dari browser: sejak jejak tinggal di SQLite server, halaman
       * tidak punya jalan lain ke sana. `start`/`end` dihitung browser (dengan margin ±sehari untuk
       * selisih UTC↔WIB, lihat useActivityLogs) dan disaring persis lagi di sisi UI.
       */
      .get(
        "",
        ({ query: q }) => {
          const rows = activityDb.queryRange({
            start: q.start || "",
            end: q.end || "",
            limit: QUERY_LIMIT,
          });
          return { rows, truncated: rows.length >= QUERY_LIMIT };
        },
        {
          superadmin: true,
          query: t.Object({
            start: t.Optional(t.String({ maxLength: 40 })),
            end: t.Optional(t.String({ maxLength: 40 })),
          }),
        },
      )

      /**
       * Terima satu batch.
       *
       * SETIAP akun yang login boleh mengirim — bukan superadmin, walau yang MEMBACA halamannya
       * hanya superadmin. Log yang cuma menerima kiriman superadmin adalah log yang tidak mencatat
       * satu pun orang yang aktivitasnya ingin dilihat.
       *
       * Ditulis dengan `update` berkunci id milik browser, jadi batch yang sebenarnya sampai tapi
       * jawabannya hilang di jaringan — lalu dikirim ulang lima menit kemudian — menimpa baris yang
       * sama alih-alih menggandakannya.
       */
      .post(
        "",
        async ({ body, actor, headers, server, request }) => {
          const ip = clientIp(headers, server?.requestIP?.(request)?.address || "");
          const userAgent = String(headers["user-agent"] || "").slice(0, 400);
          const observed = {
            receivedAt: new Date().toISOString(),
            ip,
            ...geoOf(ip),
            ...deviceOf(userAgent),
            userAgent,
            reportedByUid: actor.uid,
            reportedByEmail: actor.email || "",
          };

          const rows = body.events.map((event) => activityRow(event, observed));

          try {
            activityDb.insertRows(rows);
          } catch (error) {
            // 502, bukan 500: yang gagal bukan request-nya melainkan database di belakangnya, dan
            // browser HARUS menyimpan batch-nya untuk dicoba lagi. `ControlApiError` menandai
            // 502/503 sebagai `offline` — persis arti yang dibutuhkan di sini.
            return status(502, { error: `Jejak gagal disimpan: ${error.message}` });
          }

          return { stored: body.events.length, ip, city: observed.city };
        },
        {
          identified: true,
          body: t.Object({
            events: t.Array(
              t.Object({
                id: t.String({ pattern: ID_PATTERN }),
                at: t.String({ maxLength: 40 }),
                category: t.Union([
                  t.Literal("auth"),
                  t.Literal("navigation"),
                  t.Literal("interaction"),
                  t.Literal("operation"),
                ]),
                action: t.String({ maxLength: 60 }),
                page: t.Optional(t.String({ maxLength: 200 })),
                label: t.Optional(t.String({ maxLength: 120 })),
                target: t.Optional(t.String({ maxLength: 200 })),
                detail: t.Optional(t.String({ maxLength: 200 })),
                status: t.Optional(t.Union([t.Literal("ok"), t.Literal("failed")])),
                actorUid: t.Optional(t.String({ maxLength: 128 })),
                actorEmail: t.Optional(t.String({ maxLength: 200 })),
                actorRole: t.Optional(t.String({ maxLength: 60 })),
              }),
              // Sama dengan ACTIVITY_BATCH di sisi browser. Batch yang lebih besar dari ini ditolak
              // utuh — dan browser yang menumpuk seribu baris memang harus mengirimnya sepotong
              // demi sepotong, bukan sebagai satu request yang selalu gagal lalu diulang selamanya.
              { minItems: 1, maxItems: 100 },
            ),
          }),
        },
      )
  );
}

/**
 * Buang baris yang lewat masa simpan.
 *
 * Satu DELETE lewat indeks `at`, bukan baca-lalu-hapus: node ini yang paling cepat tumbuh, dan SQLite
 * menghapus rentang tanpa menarik satu baris pun ke memori.
 */
export function pruneActivityLogs(activityDb, { days = RETENTION_DAYS, now = new Date() } = {}) {
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
  return { removed: activityDb.prune(cutoff) };
}
