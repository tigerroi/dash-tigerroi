import { Elysia, status, t } from "elysia";
import {
  createDnsRecord,
  deleteDnsRecord,
  listDnsRecords,
  listZones,
  updateDnsRecord,
} from "../functions/cloudflare.js";
import {
  CloudflareError,
  cloudflareFailureStatus,
  DNS_TYPES,
} from "../functions/cloudflare-core.js";
import { AuthError, bearerToken, requireSuperAdmin } from "./auth.js";

/**
 * DNS Cloudflare — jalur dari dashboard ke zona tiap domain.
 *
 * Kenapa lewat server ini dan bukan langsung dari browser, dan kenapa alasannya lebih keras
 * daripada di /plugin: token Cloudflare bisa mengubah KE MANA SETIAP DOMAIN KITA MENUNJUK. Ditaruh
 * di bundle frontend, ia terbaca siapa pun yang membuka devtools — dan yang dipegangnya bukan satu
 * situs melainkan seluruh armada sekaligus, termasuk domain yang sedang menerima trafik berbayar.
 * Cloudflare juga tidak mengirim header CORS untuk origin dashboard, jadi `fetch` dari halaman akan
 * ditolak sebelum sampai ke API-nya.
 *
 * Superadmin saja — sekelas /plugin dan /vi-control, dan dengan alasan yang paling langsung dari
 * ketiganya: menghapus satu record A membuat sebuah subdomain berhenti menjawab seketika, dan tidak
 * ada satu pun sistem di jalurnya yang akan menolak. Tidak ada `.validate` database yang bisa
 * menjaganya (tidak ada baris RTDB yang ditulis sama sekali), jadi yang menegakkan izinnya adalah
 * gerbang di berkas ini; `SUPERADMIN_PAGES` cuma menyembunyikan menunya.
 *
 * TIDAK ADA ANTREAN RTDB SEBAGAI CADANGAN, sepola /plugin: tidak ada yang bisa diantrekan — token
 * tinggal di sini, dan Cloudflare tidak menjawab browser. Server mati berarti halaman ini tidak
 * bisa melakukan apa pun, dan halamannya mengatakan begitu alih-alih menggambar tombol yang pasti
 * gagal.
 */
export function cloudflareRoutes({ db, apiKey, accountId, authorize }) {
  const check = authorize || ((token) => requireSuperAdmin(db, token));

  /**
   * Bungkus tiap handler.
   *
   * Ada karena tanpanya `CloudflareError` naik ke `onError` global dan keluar sebagai 500 berisi
   * "Ada kesalahan di sisi server kontrol" — kalimat yang menuduh server ini untuk record yang
   * ditolak Cloudflare karena namanya bentrok, dan yang mengirim orang mencari penyebabnya di
   * tempat yang salah.
   */
  async function run(work) {
    if (!apiKey) {
      // 503 dan bukan 500: servernya hidup, fiturnya yang belum dikonfigurasi. Halaman membaca ini
      // untuk mengatakan apa yang kurang, alih-alih menyebut kegagalan yang tidak bisa diperbaiki
      // siapa pun di layar itu.
      return status(503, {
        error: "CLOUDFLARE_API_TOKEN belum di-set di server kontrol.",
        code: "no_token",
      });
    }
    try {
      return await work();
    } catch (error) {
      if (error instanceof CloudflareError) {
        // `code` ikut dikirim, sepola /plugin: halaman membacanya untuk memilih apa yang ditawarkan
        // berikutnya — `81057` menyuruh menyunting record yang sudah ada, `no_token` tidak
        // menawarkan apa pun karena tidak ada yang bisa dikerjakan dari layar itu.
        return status(cloudflareFailureStatus(error), {
          error: error.message,
          code: error.code || "",
        });
      }
      throw error;
    }
  }

  /**
   * Zona yang BENAR-BENAR milik akun ini, dicari dari Cloudflare — bukan dipercaya dari request.
   *
   * Dua hal yang dijaganya sekaligus, dan keduanya perlu:
   *
   *   1. **Kepemilikan.** Tanpa ini, endpoint ini jadi editor DNS untuk zona mana pun yang bisa
   *      disentuh token kita, cukup dengan mengoper id zona milik akun lain. Prinsip yang sama
   *      dengan `campaignRowOf` di server/campaigns.js.
   *   2. **Nama zonanya.** `normalizeDnsInput` butuh nama zona untuk melengkapi nama record, dan
   *      nama yang dikirim browser adalah klaim: dioper apa adanya, "care" di zona petcins.com bisa
   *      tersimpan sebagai "care.zonalain.com" kalau yang mengirimnya keliru — atau berbohong.
   *
   * Dibaca ULANG tiap kali dan tidak dicermin, walau itu berarti satu panggilan tambahan per
   * operasi: daftar zona berubah karena ada yang menambah domain, dan cermin yang basi menolak
   * domain yang baru dipasang orang dengan pesan "tidak ada di akun ini" — kegagalan yang terbaca
   * seperti tokennya yang salah. Sebelas zona hari ini, satu permintaan.
   */
  async function zoneOf(zoneId) {
    const zones = await listZones(apiKey, accountId);
    const zone = zones.find((row) => row.id === zoneId);
    if (!zone) {
      throw new CloudflareError("Zona ini tidak ada di akun Cloudflare yang terhubung.", {
        code: "zone_not_found",
        status: 404,
      });
    }
    return zone;
  }

  return (
    new Elysia({ prefix: "/cloudflare" })
      .macro({
        superadmin: {
          async resolve({ headers }) {
            try {
              return { actor: await check(bearerToken(headers.authorization)) };
            } catch (error) {
              if (error instanceof AuthError) return status(error.status, { error: error.message });
              // Bukan penolakan melainkan pemeriksaannya sendiri yang gagal. Dijawab 401, orang
              // akan mengira haknya dicabut.
              return status(503, { error: `Izin tidak bisa diperiksa sekarang: ${error.message}` });
            }
          },
        },
      })

      // Daftar zona = daftar domain yang bisa dibuka halaman ini. Sumbernya Cloudflare dan bukan
      // koleksi `domains` di RTDB: yang menentukan DNS sebuah domain bisa disunting dari sini adalah
      // Cloudflare, bukan ada tidaknya barisnya di dashboard. Halaman yang MENJODOHKAN keduanya
      // (lihat src/lib/cloudflareDns.js) yang menyebutkan selisihnya.
      .get("/zones", () => run(() => listZones(apiKey, accountId)), { superadmin: true })

      .get(
        "/zones/:zoneId/dns",
        ({ params }) =>
          run(async () => {
            const zone = await zoneOf(params.zoneId);
            // Nama zonanya ikut dikembalikan supaya form bisa memendekkan nama record tanpa
            // menebaknya dari baris pertama — zona yang record-nya masih kosong tidak punya baris
            // untuk ditebak.
            return { zone, records: await listDnsRecords(apiKey, zone.id) };
          }),
        { superadmin: true, params: t.Object({ zoneId: cfId() }) },
      )

      .post(
        "/zones/:zoneId/dns",
        ({ params, body }) =>
          run(async () => {
            const zone = await zoneOf(params.zoneId);
            return { record: await createDnsRecord(apiKey, zone.id, zone.name, body) };
          }),
        { superadmin: true, params: t.Object({ zoneId: cfId() }), body: dnsBody() },
      )

      .post(
        "/zones/:zoneId/dns/:recordId",
        ({ params, body }) =>
          run(async () => {
            const zone = await zoneOf(params.zoneId);
            return {
              record: await updateDnsRecord(apiKey, zone.id, zone.name, params.recordId, body),
            };
          }),
        {
          superadmin: true,
          params: t.Object({ zoneId: cfId(), recordId: cfId() }),
          body: dnsBody(),
        },
      )

      /**
       * Hapus satu record. POST, bukan DELETE — dan itu bukan kemalasan.
       *
       * CORS server ini mengizinkan `["GET", "POST"]` saja (lihat index.js), dan daftar itu berlaku
       * untuk SETIAP endpoint di sini. Melebarkannya demi satu route berarti mengubah aturan yang
       * menjaga gate/ungate dan saklar campaign juga — harga yang jauh lebih besar daripada satu
       * kata kerja HTTP yang tidak sesuai buku. Dashboard ini sudah memakai POST untuk tiap operasi
       * yang mengubah keadaan, termasuk yang cuma membaca (`/plugin/sites/:id/ping`).
       *
       * `/delete` sebagai segmen di ujung, BUKAN POST ke alamat record itu sendiri: alamat itu sudah
       * dipakai untuk menyunting, dan dua arti untuk satu alamat yang dibedakan isi body-nya adalah
       * cara sebuah penyuntingan yang body-nya gagal terurai menghapus record yang sedang disunting.
       */
      .post(
        "/zones/:zoneId/dns/:recordId/delete",
        ({ params }) =>
          run(async () => {
            const zone = await zoneOf(params.zoneId);
            return deleteDnsRecord(apiKey, zone.id, params.recordId);
          }),
        { superadmin: true, params: t.Object({ zoneId: cfId(), recordId: cfId() }) },
      )
  );
}

/**
 * Id Cloudflare: 32 karakter heksadesimal.
 *
 * Dibatasi bentuknya dan tidak dipercaya apa adanya — nilai ini disambung jadi segmen alamat API
 * (`/zones/${id}/dns_records`), dan yang boleh memuat "/" atau ".." bisa mengarahkannya ke endpoint
 * Cloudflare yang sama sekali lain. Alasan yang sama dengan `siteId()` di server/plugin.js.
 */
function cfId() {
  return t.String({ pattern: "^[0-9a-f]{32}$" });
}

/**
 * Bentuk body untuk create dan update — SATU definisi, dipakai keduanya.
 *
 * Sengaja longgar (`t.Optional`, tanpa enum ketat selain tipe): yang benar-benar memutuskan apa
 * yang sah adalah `normalizeDnsInput`, dan aturan yang ditulis DUA KALI — sekali sebagai skema
 * TypeBox di sini, sekali sebagai pemeriksaan di sana — akan berselisih suatu hari, dengan yang
 * lebih longgar menang tanpa berbunyi. Yang dijaga di sini cuma yang tidak bisa dijaga di sana:
 * batas PANJANG, supaya body sebesar megabyte tidak pernah sampai ke pengurainya.
 */
function dnsBody() {
  return t.Object({
    type: t.Union(DNS_TYPES.map((value) => t.Literal(value))),
    name: t.String({ maxLength: 255 }),
    content: t.String({ minLength: 1, maxLength: 2048 }),
    // TTL sebagai angka ATAU teks: `<input type="number">` yang dikosongkan mengirim "", dan itu
    // arti "Auto" yang sah — ditolak di sini, orang akan membaca "Body tidak valid" untuk kotak
    // yang memang boleh kosong.
    ttl: t.Optional(t.Union([t.Number(), t.String({ maxLength: 8 })])),
    proxied: t.Optional(t.Boolean()),
    priority: t.Optional(t.Union([t.Number(), t.String({ maxLength: 8 })])),
    comment: t.Optional(t.String({ maxLength: 512 })),
  });
}
