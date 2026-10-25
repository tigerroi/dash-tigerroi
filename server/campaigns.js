import { Elysia, status, t } from "elysia";
import { adSetGoals, mergeAdSetRows } from "../functions/adsets-core.js";
import { applyOneCampaignCommand } from "../functions/campaign-commands.mjs";
import {
  fetchAdSetInsights,
  fetchAdSets,
  fetchCampaignAds,
  setAdSetStatus,
} from "../functions/meta.js";
import { CAMPAIGN_STATUSES, campaignCommandEntry } from "../functions/sync-core.js";
import { AuthError, bearerToken, mayToggleCampaign, requireUser } from "./auth.js";
import { campaignRowOf } from "./campaign-rows.js";

/**
 * Saklar on/off campaign Meta — jalur seketikanya.
 *
 * Menggantikan sisi KELUAR `scheduledCampaignCommands`. Alasannya sama dengan gating: tombol di
 * `/users/{uid}` hanya menulis niat ke `users/{uid}/campaignCommands`, dan tanpa perantara satu-
 * satunya yang mengeksekusinya adalah cron dua menitan. Yang dimatikan orang biasanya campaign yang
 * sedang membakar anggaran, jadi dua menit itu uang.
 *
 * Logikanya tidak diduplikasi: route di bawah memanggil `applyOneCampaignCommand` — modul yang sama
 * yang dipakai cron dan callable. Yang berbeda cuma kecepatannya, bukan hasilnya.
 */
// `authorize` bisa dioper untuk diuji tanpa jaringan, sepola dengan gatingRoutes.
export function campaignRoutes({ db, store, metaToken, authorize }) {
  const check = authorize || ((token) => requireUser(db, token));
  return (
    new Elysia({ prefix: "/campaigns" })
      .macro({
        /**
         * Identitas saja, izinnya diperiksa di dalam handler.
         *
         * Berbeda dari gating (yang cukup superadmin), boleh-tidaknya di sini bergantung pada BARIS
         * USER YANG DITUJU — dan itu belum diketahui saat macro jalan.
         */
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

      /**
       * Nyalakan/matikan satu campaign, sekarang juga.
       *
       * `userId` di body dan bukan cuma `campaignId` karena /users dikunci push-key: campaign tinggal
       * di dalam baris profil seseorang, dan tanpa tahu baris mana, kepemilikannya tidak bisa
       * diperiksa sama sekali.
       */
      .post(
        "/:campaignId/status",
        async ({ params, body, actor }) => {
          if (!metaToken) {
            return status(503, { error: "META_ACCESS_TOKEN belum di-set di server." });
          }

          // Baris campaign dicari di profil user itu sendiri, BUKAN dipercaya dari request —
          // lihat `campaignRowOf`. Kepemilikannya diperiksa lebih dulu: 403 untuk orang lain harus
          // datang sebelum 404, supaya endpoint ini tidak jadi cara memeriksa ID campaign siapa
          // yang ada di profil siapa.
          const { user, row, notFound } = await campaignRowOf(
            store,
            body.userId,
            params.campaignId,
          );
          if (!user) return notFound;
          if (!mayToggleCampaign(actor, user)) {
            // 403, bukan 401: tokennya sah, orangnya yang bukan admin dan bukan pemilik campaign ini.
            return status(403, {
              error: "Hanya admin atau pemilik campaign yang boleh mengubah statusnya.",
            });
          }
          if (notFound) return notFound;

          let command;
          try {
            command = campaignCommandEntry(row, body.status, actor.email || actor.uid);
          } catch (error) {
            return status(422, { error: error.message });
          }

          // Ditulis ke antrean DULU, lalu dieksekusi — urutan yang sama dengan gating, dan alasannya
          // sama: proses yang mati di tengah panggilan ke Meta meninggalkan perintah "pending" yang
          // diselesaikan cron berikutnya, bukan perubahan status tanpa jejak.
          await store.update(`users/${body.userId}/campaignCommands`, {
            [command.campaignId]: command,
          });

          try {
            await applyOneCampaignCommand(store, metaToken, body.userId, command.campaignId);
          } catch (error) {
            // `applyOneCampaignCommand` sudah menandai perintahnya `failed` berikut sebabnya, jadi
            // tabel di layar akan menyebutnya sendiri. Yang dijawab di sini kenapa jalur cepat gagal.
            return status(502, { error: error.message });
          }

          return {
            campaignId: command.campaignId,
            campaign: row.campaign || "",
            status: body.status,
            applied: true,
          };
        },
        {
          identified: true,
          params: t.Object({ campaignId: t.String({ pattern: "^[0-9]+$" }) }),
          body: t.Object({
            userId: t.String({ minLength: 1, maxLength: 128 }),
            status: t.Union(CAMPAIGN_STATUSES.map((value) => t.Literal(value))),
          }),
        },
      )

      /**
       * Ad set di dalam satu campaign — daftar, status, dan angkanya hari ini.
       *
       * DIBACA SAAT DIMINTA, tidak dicerminkan ke RTDB: satu ad account memuat ratusan ad set (960
       * di TBZ 1247), jadi mencerminkan armada tiap jam berarti belasan ribu baris ditulis ulang
       * untuk panel yang dibuka sesekali — dan yang dicari orang di sini justru keadaan pada detik
       * ini, bukan cermin sejam lalu.
       *
       * Gerbangnya `requireUser` saja, BUKAN `mayToggleCampaign`: ini pembacaan, dan baris campaign
       * yang jadi induknya sudah terbaca setiap akun yang login (`users` ber-`.read: auth != null`
       * di database.rules.json). Gerbang yang lebih ketat di sini akan menutup panel justru di
       * halaman yang tabelnya sendiri terbuka. Yang tetap dijaga adalah alamat Meta-nya —
       * `campaignRowOf`, sama dengan endpoint saklar di atas.
       *
       * Periodenya HARI INI (`date_preset=today` di sisi Meta, zona ad account-nya), sama dengan
       * tabel induknya yang memang LIVE. Riwayat per hari sudah punya tempatnya sendiri di panel
       * "Riwayat Spend Campaign"; dua periode berbeda di satu layar cuma akan diadu orang.
       */
      .get(
        "/:campaignId/adsets",
        async ({ params, query }) => {
          if (!metaToken) {
            return status(503, { error: "META_ACCESS_TOKEN belum di-set di server." });
          }

          const { user, row, notFound } = await campaignRowOf(
            store,
            query.userId,
            params.campaignId,
          );
          if (!user || notFound) return notFound;

          let adSets;
          try {
            adSets = await fetchAdSets(params.campaignId, metaToken);
          } catch (error) {
            return status(502, { error: error.message });
          }

          // Angkanya diminta terpisah, dan gagalnya TIDAK menjatuhkan panel: daftar ad set berikut
          // status dan anggarannya sudah di tangan, dan itu setengah dari yang dicari orang.
          // `metricsKnown: false` yang membuat kolom angkanya kosong alih-alih nol — nol di sana
          // tak terbedakan dari ad set yang memang tidak tayang hari ini.
          let insights = [];
          let metricsKnown = true;
          let metricsError = "";
          try {
            insights = await fetchAdSetInsights(
              params.campaignId,
              metaToken,
              undefined,
              adSetGoals(adSets),
            );
          } catch (error) {
            metricsKnown = false;
            metricsError = error.message;
          }

          // Iklan di dalam tiap ad set — satu panggilan untuk seluruh campaign. Ia satu-satunya
          // sumber untuk "aktif tapi tidak ditayangkan" pada ad set yang efektifnya ACTIVE.
          // Gagalnya juga tidak menjatuhkan panel, dan yang penting: `ads: null` membuat
          // `mergeAdSetRows` TIDAK menyimpulkan apa pun — bukan menyimpulkan "tidak punya iklan".
          let ads = null;
          try {
            ads = await fetchCampaignAds(params.campaignId, metaToken);
          } catch (error) {
            // Sebabnya menumpang keterangan yang sama: keduanya menjawab "kenapa panel ini tidak
            // lengkap", dan dua baris merah untuk satu panel adalah dua kali kalimat yang sama.
            metricsError = metricsError || error.message;
          }

          return {
            campaignId: String(params.campaignId),
            campaign: row.campaign || "",
            adSets: mergeAdSetRows(adSets, insights, { metricsKnown, ads }),
            metricsKnown,
            metricsError,
            // Dipisah dari `metricsKnown` karena akibatnya berbeda: yang ini mematikan kolom
            // Status-nya, bukan kolom angkanya.
            adsKnown: ads !== null,
          };
        },
        {
          identified: true,
          params: t.Object({ campaignId: t.String({ pattern: "^[0-9]+$" }) }),
          query: t.Object({ userId: t.String({ minLength: 1, maxLength: 128 }) }),
        },
      )

      /**
       * Nyalakan/matikan satu AD SET, sekarang juga.
       *
       * TIGA hal yang membedakannya dari saklar campaign di atas, dan ketiganya disengaja:
       *
       *   - **Tidak ada antrean RTDB sebagai cadangan.** Saklar campaign punya karena baris
       *     campaign dicerminkan di RTDB dan cron bisa mengurasnya; ad set tidak dicerminkan sama
       *     sekali, jadi tidak ada baris untuk ditandai "menunggu" — dan panelnya sendiri memang
       *     tidak bisa dibuka kalau server ini mati. Polanya /plugin: server mati = saklarnya tidak
       *     ada, bukan saklar yang diam-diam mengantre.
       *   - **Ad set-nya dibuktikan milik campaign yang dituju**, dibaca ulang dari Meta dan bukan
       *     dipercaya dari request. Tanpa itu, `campaignRowOf` cuma membuktikan campaign-nya milik
       *     orang itu sementara ID ad set yang dioper bisa milik ad account mana pun di Business
       *     Manager — dan Meta akan menurutinya.
       *   - **Izinnya `mayToggleCampaign`, bukan `requireUser`** seperti pembacaan panelnya. Ini
       *     tulisan ke iklan yang sedang hidup; yang boleh membacanya jauh lebih banyak daripada
       *     yang boleh mematikannya.
       */
      .post(
        "/:campaignId/adsets/:adSetId/status",
        async ({ params, body, actor }) => {
          if (!metaToken) {
            return status(503, { error: "META_ACCESS_TOKEN belum di-set di server." });
          }

          const { user, notFound } = await campaignRowOf(store, body.userId, params.campaignId);
          if (!user) return notFound;
          if (!mayToggleCampaign(actor, user)) {
            return status(403, {
              error: "Hanya admin atau pemilik campaign yang boleh mengubah statusnya.",
            });
          }
          if (notFound) return notFound;

          let adSets;
          try {
            adSets = await fetchAdSets(params.campaignId, metaToken);
          } catch (error) {
            return status(502, { error: error.message });
          }
          const adSet = adSets.find((item) => item.id === String(params.adSetId));
          if (!adSet) {
            return status(404, { error: "Ad set ini bukan milik campaign tersebut." });
          }

          try {
            await setAdSetStatus(adSet.id, metaToken, body.status);
          } catch (error) {
            return status(502, { error: error.message });
          }

          return {
            campaignId: String(params.campaignId),
            adSetId: adSet.id,
            adSet: adSet.name || "",
            status: body.status,
            applied: true,
          };
        },
        {
          identified: true,
          params: t.Object({
            campaignId: t.String({ pattern: "^[0-9]+$" }),
            adSetId: t.String({ pattern: "^[0-9]+$" }),
          }),
          body: t.Object({
            userId: t.String({ minLength: 1, maxLength: 128 }),
            status: t.Union(CAMPAIGN_STATUSES.map((value) => t.Literal(value))),
          }),
        },
      )
  );
}
