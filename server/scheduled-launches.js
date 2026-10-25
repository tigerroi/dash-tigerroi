import { Elysia, status, t } from "elysia";
import { metaFailureStatus, RuleError } from "../functions/campaign-manage-core.js";
import { listDnsRecords, listZones } from "../functions/cloudflare.js";
import { fetchActiveAdSetSchedules, fetchAdSetForEdit, updateAdSet } from "../functions/meta.js";
import {
  launchAccountOf,
  launchAccounts,
  launchOwnerOf,
  launchServers,
  scheduledLaunchRows,
  shiftedStartTime,
} from "../functions/scheduled-launches-core.js";
import { AuthError, bearerToken, mayToggleCampaign, requireUser } from "./auth.js";

// Jawaban dipakai bersama SEMUA pembaca selama dua menit — jarak yang sama dengan cermin ad set di
// browser (`adSetCache`) dan penyegaran status campaign. Yang membuka tab ini adalah seluruh tim,
// dan tanpa cermin bersama, sepuluh advertiser yang membukanya pagi hari berarti sepuluh putaran
// pembacaan seluruh ad account ke Meta untuk jawaban yang sama.
export const SCHEDULED_CACHE_MS = 2 * 60_000;
// "Segarkan" boleh melewati cermin, tapi tidak lebih sering dari ini: tombol yang diklik berulang
// oleh beberapa orang sekaligus adalah persis bentuk request yang membuat app dicap anomali.
export const SCHEDULED_REFRESH_FLOOR_MS = 30_000;

/**
 * Jadwal tayang armada untuk tab "Terjadwal" di Overview.
 *
 * DIBACA SAAT DIMINTA, tidak dicerminkan ke RTDB — alasan yang sama dengan panel ad set: ad set
 * armada berjumlah ribuan, dan mencerminkannya berarti node yang dilanggan semua orang tumbuh untuk
 * satu tab. Konsekuensinya sama juga: tanpa server kontrol, tab ini tidak bisa dibuka.
 *
 * Gerbangnya `requireUser`: tujuan tab ini justru supaya SETIAP advertiser melihat jadwal rekannya
 * sebelum menjadwalkan miliknya sendiri. Isinya nama campaign/ad set, jam, akun, dan PIC — semuanya
 * sudah terbaca setiap akun yang login lewat `users` dan `adAccounts`.
 *
 * Akun yang GAGAL dibaca disebut di jawaban (`failedAccounts`), bukan dijatuhkan diam-diam: daftar
 * yang kehilangan satu akun terbaca sebagai "jam itu kosong", dan orang lalu menjadwalkan di jam
 * yang justru padat.
 */
export function scheduledLaunchRoutes({
  db,
  store,
  metaToken,
  authorize,
  fetchAdSets,
  readAdSet = fetchAdSetForEdit,
  writeAdSet = updateAdSet,
  cloudflareToken = "",
  cloudflareAccount = "",
  readDnsRecords,
  clock,
}) {
  const check = authorize || ((token) => requireUser(db, token));
  const readAdSets = fetchAdSets || fetchActiveAdSetSchedules;
  const now = clock || (() => new Date());
  let cached = null;
  let inflight = null;

  // Seluruh record DNS akun Cloudflare, zona demi zona (berurutan, sepola pembacaan Meta di bawah).
  const dnsRecords =
    readDnsRecords ||
    (async () => {
      const records = [];
      for (const zone of await listZones(cloudflareToken, cloudflareAccount)) {
        records.push(...(await listDnsRecords(cloudflareToken, zone.id)));
      }
      return records;
    });

  /**
   * hostname subdomain → server. Yang GAGAL dibaca tidak menjatuhkan jadwal: jawabannya `servers:
   * null` berikut sebabnya, dan halaman lalu menandai SEMUA jam yang sama sebagai bentrok — server
   * yang tidak diketahui tidak bisa dibuktikan berbeda.
   */
  async function loadServers() {
    if (!cloudflareToken && !readDnsRecords) {
      return { servers: null, serverError: "CLOUDFLARE_API_TOKEN belum di-set di server." };
    }
    try {
      const hosts = Object.values((await store.read("subDomains")) || {})
        .filter((sub) => sub && !sub.deletedAt && sub.name)
        .map((sub) => sub.name);
      return { servers: launchServers(await dnsRecords(), hosts), serverError: "" };
    } catch (error) {
      return { servers: null, serverError: error.message };
    }
  }

  async function load() {
    const accounts = launchAccounts((await store.read("adAccounts")) || {});
    const at = now();
    const rows = [];
    const failedAccounts = [];
    // Berurutan: antrean `request` di meta.js sudah menjaga jeda per app, dan melepas semuanya
    // bersamaan cuma menumpuk di antrean yang sama.
    for (const account of accounts) {
      try {
        const adSets = await readAdSets(account.actId, metaToken);
        rows.push(...scheduledLaunchRows(account, adSets, at));
      } catch (error) {
        failedAccounts.push({ id: account.id, name: account.name, message: error.message });
      }
    }
    rows.sort((a, b) => a.startMs - b.startMs);
    return {
      rows,
      failedAccounts,
      accountCount: accounts.length,
      readAt: at.toISOString(),
      ...(await loadServers()),
    };
  }

  return (
    new Elysia({ prefix: "/scheduled-launches" })
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
      })
      .get(
        "",
        async ({ query }) => {
          if (!metaToken) {
            return status(503, { error: "META_ACCESS_TOKEN belum di-set di server." });
          }
          const age = cached ? now().getTime() - cached.at : Number.POSITIVE_INFINITY;
          const wantsFresh = query.refresh === "1" && age >= SCHEDULED_REFRESH_FLOOR_MS;
          if (cached && age < SCHEDULED_CACHE_MS && !wantsFresh) return cached.body;

          // Permintaan yang bersamaan menunggu pembacaan yang sama, bukan menembakkan putaran kedua.
          if (!inflight) {
            inflight = load()
              .then((body) => {
                cached = { at: now().getTime(), body };
                return body;
              })
              .finally(() => {
                inflight = null;
              });
          }
          try {
            return await inflight;
          } catch (error) {
            // Yang gagal tidak pernah ikut dicermin (lihat `adSetCache`): kegagalan yang disimpan
            // menjawab error yang sama walau Meta sudah pulih sedetik kemudian.
            return status(502, { error: error.message });
          }
        },
        {
          identified: true,
          query: t.Object({ refresh: t.Optional(t.String({ maxLength: 1 })) }),
        },
      )

      /**
       * Geser jam mulai SATU ad set yang belum tayang. Izinnya admin ATAU pemilik ad account-nya
       * (`mayToggleCampaign`, kalimat penolakannya sama dengan saklar) — pembacaan tab ini terbuka
       * untuk semua, tulisannya tidak.
       *
       * Ad set dibaca ulang dari Meta dan `account_id`-nya harus salah satu ad account armada; pemilik
       * dibaca dari ad account itu, bukan dari request. Sesudah berhasil, cermin bersama DIBUANG:
       * tanpa itu seluruh tim masih melihat jam lama — termasuk bentroknya — sampai dua menit.
       */
      .post(
        "/adsets/:adSetId/start",
        async ({ params, body, actor }) => {
          if (!metaToken) {
            return status(503, { error: "META_ACCESS_TOKEN belum di-set di server." });
          }
          try {
            const adSet = await readAdSet(params.adSetId, metaToken);
            const account = launchAccountOf(
              launchAccounts((await store.read("adAccounts")) || {}),
              adSet.accountId,
            );
            if (!account) {
              return status(404, { error: "Ad set ini bukan milik ad account di /ad-accounts." });
            }
            const owner = launchOwnerOf((await store.read("users")) || {}, account.pic);
            if (!mayToggleCampaign(actor, owner)) {
              return status(403, {
                error: "Hanya admin atau pemilik campaign yang boleh mengubah jadwalnya.",
              });
            }
            const startTime = shiftedStartTime(adSet, body.startTime, now());
            await writeAdSet(adSet.id, metaToken, { startTime });
            cached = null;
            return { adSetId: adSet.id, startTime, applied: true };
          } catch (error) {
            if (error instanceof RuleError) return status(error.status, { error: error.message });
            return status(metaFailureStatus(error?.message), {
              error: error?.message || "Meta tidak menjawab.",
            });
          }
        },
        {
          identified: true,
          params: t.Object({ adSetId: t.String({ pattern: "^[0-9]+$" }) }),
          body: t.Object({ startTime: t.String({ minLength: 1, maxLength: 40 }) }),
        },
      )
  );
}
