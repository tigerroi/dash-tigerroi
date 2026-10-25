import { Elysia, status, t } from "elysia";
import {
  assertLinkOfSubDomain,
  CREATE_JOBS_PATH,
  CTA_TYPES,
  createPlan,
  joinLink,
  MAX_IMAGES,
  MAX_VARIANTS,
  MIN_IMAGES,
  parseUrlTags,
} from "../functions/campaign-create-core.js";
import {
  runCreateJob,
  startCreateJob,
  startResumeCreateJob,
} from "../functions/campaign-create-jobs.mjs";
import { JobConflict } from "../functions/campaign-jobs.mjs";
import { metaFailureStatus, RuleError } from "../functions/campaign-manage-core.js";
import { fetchAdImages, fetchAdPixels, fetchPages, uploadAdImage } from "../functions/meta.js";
import { buildCodeIndex, normalizeName } from "../functions/sync-core.js";
import { AuthError, bearerToken, requireSuperAdmin } from "./auth.js";
import { detached } from "./campaign-manage.js";

/**
 * Halaman Campaign → tombol Buat: satu campaign, N ad set, N iklan. SUPERADMIN saja.
 *
 * Berkas sendiri, terpisah dari campaign-manage.js: yang di sana mengubah objek yang SUDAH ada dan
 * dijaga dengan membuktikan kepemilikannya (`campaignRowOf`); yang di sini melahirkan objek baru dan
 * dijaga dengan membuktikan tiap BAHANnya milik kita — ad account, Halaman, pixel, dan link.
 *
 * Tidak satu pun alamat Meta dipercaya dari request:
 *   act_…      dibaca dari `adAccounts/{accountId}` di RTDB
 *   link iklan harus salah satu Campaign URL yang tersimpan di baris subdomain itu
 *   page_id    harus ada di `GET /me/accounts` (yang benar-benar dipegang System User)
 *   pixel_id   harus milik ad account itu
 *
 * Pembuatannya berjalan DI LATAR sesudah route menjawab, sepola job salinan: satu campaign 10
 * variasi berarti 31 panggilan Meta, dan permintaan HTTP yang menggantung selama itu tidak berguna
 * bagi siapa pun — progresnya sudah ditulis ke node job yang dilanggan halaman.
 */

// 8 MB: batas kita sendiri, bukan batas Meta. Yang di depannya (nginx `client_max_body_size`) harus
// ikut dinaikkan — bawaannya 1 MB, dan yang ditolak di sana menjawab HTML 413 yang tidak menyebut
// apa pun tentang gambar.
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

const ACCOUNT_PARAMS = t.Object({ accountId: t.String({ minLength: 1, maxLength: 128 }) });

export function campaignCreateRoutes({
  db,
  store,
  metaToken,
  enqueueSync = () => {},
  runInBackground = detached,
  authorize,
}) {
  const check = authorize || ((token) => requireSuperAdmin(db, token));
  // Nama campaign yang sedang dibuat proses ini. Dua klik yang datang bersamaan sama-sama membaca
  // daftar job sebelum yang lain sempat menulis, dan pemeriksaan RTDB saja meloloskan keduanya.
  const creating = new Set();

  const failure = (error) => {
    if (error instanceof RuleError || error instanceof JobConflict) {
      return status(error.status, { error: error.message });
    }
    return status(metaFailureStatus(error?.message), {
      error: error?.message || "Meta tidak menjawab.",
    });
  };

  /**
   * Ad account dari RTDB, bukan dari request.
   *
   * Akun yang sync-nya dimatikan ditolak berikut sebabnya: itu penanda akun yang disuspend Meta,
   * dan campaign yang lahir di sana tidak akan pernah tayang — kegagalan yang baru terbaca
   * berhari-hari kemudian sebagai angka nol.
   */
  const accountOf = async (accountId) => {
    if (!metaToken)
      return { stop: status(503, { error: "META_ACCESS_TOKEN belum di-set di server." }) };
    const row = (await store.read(`adAccounts/${accountId}`)) || null;
    if (!row || row.deletedAt || !row.actId) {
      return { stop: status(404, { error: "Ad account itu tidak ada di /ad-accounts." }) };
    }
    if (row.syncDisabled) {
      return {
        stop: status(422, {
          error: `Sync ad account ini dimatikan (${row.syncDisabled}), jadi campaign baru tidak akan tayang.`,
        }),
      };
    }
    return { account: { ...row, id: accountId } };
  };

  return (
    new Elysia({ prefix: "/fleet" })
      .macro({
        superadmin: {
          async resolve({ headers }) {
            try {
              return { actor: await check(bearerToken(headers.authorization)) };
            } catch (error) {
              if (error instanceof AuthError) {
                return status(error.status, {
                  error:
                    error.status === 403
                      ? "Hanya superadmin yang boleh membuat campaign."
                      : error.message,
                });
              }
              return status(503, { error: `Izin tidak bisa diperiksa sekarang: ${error.message}` });
            }
          },
        },
      })

      /**
       * Bahan form: pixel, Halaman, dan pustaka gambar akun itu.
       *
       * Ketiganya dalam satu jawaban karena dialog yang sama membutuhkannya pada detik yang sama —
       * tiga route berarti tiga keadaan gagal untuk satu dialog. Batasnya ikut dikirim supaya form
       * tidak menyimpan salinan angka yang suatu hari berbeda dari yang ditegakkan server.
       */
      .get(
        "/accounts/:accountId/assets",
        async ({ params }) => {
          const { account, stop } = await accountOf(params.accountId);
          if (stop) return stop;
          try {
            const [pixels, pages, images] = await Promise.all([
              fetchAdPixels(account.actId, metaToken),
              fetchPages(metaToken),
              fetchAdImages(account.actId, metaToken, { limit: 200 }),
            ]);
            return {
              account: { id: account.id, actId: account.actId, name: account.name || "" },
              pixels,
              // Halaman yang System User tidak bisa pakai beriklan tidak ditawarkan: iklannya pasti
              // ditolak, dan penolakannya baru terbaca sesudah seluruh form diisi.
              pages: pages.filter((page) => page.canAdvertise),
              images,
              limits: {
                minImages: MIN_IMAGES,
                maxImages: MAX_IMAGES,
                maxVariants: MAX_VARIANTS,
                maxImageBytes: MAX_IMAGE_BYTES,
                ctaTypes: CTA_TYPES,
              },
            };
          } catch (error) {
            return failure(error);
          }
        },
        { superadmin: true, params: ACCOUNT_PARAMS },
      )

      // Unggah satu gambar ke pustaka ad account. Bukan ke RTDB dan bukan ke disk server: yang
      // dipakai creative adalah hash milik akun itu, dan salinan kedua di tempat lain tidak dibaca
      // siapa pun.
      .post(
        "/accounts/:accountId/images",
        async ({ params, body }) => {
          const { account, stop } = await accountOf(params.accountId);
          if (stop) return stop;
          const file = body?.file;
          if (!file || typeof file.arrayBuffer !== "function") {
            return status(422, { error: "Tidak ada berkas gambar di permintaan ini." });
          }
          if (file.size > MAX_IMAGE_BYTES) {
            return status(422, {
              error: `Gambar ${file.name || ""} berukuran ${Math.round(file.size / 1024)} KB; batasnya ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`,
            });
          }
          if (file.type && !IMAGE_TYPES.includes(file.type)) {
            return status(422, {
              error: `Jenis berkas ${file.type} tidak didukung — pakai JPG, PNG, GIF, atau WebP.`,
            });
          }
          try {
            const image = await uploadAdImage(account.actId, metaToken, {
              fileName: file.name || "gambar.jpg",
              data: new Uint8Array(await file.arrayBuffer()),
              contentType: file.type || "image/jpeg",
            });
            return { image };
          } catch (error) {
            return failure(error);
          }
        },
        { superadmin: true, params: ACCOUNT_PARAMS, body: t.Object({ file: t.Any() }) },
      )

      .post(
        "/campaigns",
        async ({ body, actor }) => {
          const { account, stop } = await accountOf(body.accountId);
          if (stop) return stop;
          try {
            const subDomains = (await store.read("subDomains")) || {};
            const row = subDomains[body.subDomainId];
            if (!row || row.deletedAt || !row.name) {
              throw new RuleError("Subdomain itu tidak ada di /sub-domains.");
            }
            const subDomain = String(Array.isArray(row.name) ? row.name[0] : row.name);
            // Alamatnya wajib salah satu Campaign URL baris ini; parameternya diketik dan cuma
            // diperiksa bentuknya. Yang tidak dipercaya dari request tetap TUJUANnya — sebuah
            // penanda yang salah menghasilkan trafik yang tidak tercatat, bukan trafik yang pergi
            // ke tempat yang bukan milik kita.
            const link = assertLinkOfSubDomain(row, body.link);
            const plan = createPlan({
              ...body,
              subDomain,
              link: joinLink(link, parseUrlTags(body.urlTags)),
              byCode: buildCodeIndex(subDomains).byCode,
            });
            await assertPageAndPixel(plan, account, metaToken);

            const key = `${account.id}:${normalizeName(plan.name)}`;
            if (creating.has(key)) {
              throw new JobConflict(
                "Campaign dengan nama itu sedang dibuat — tunggu sampai selesai sebelum mengulanginya.",
              );
            }
            creating.add(key);
            let handedOff = false;
            try {
              const { jobId } = await startCreateJob(store, metaToken, {
                plan,
                account,
                requestedBy: actor.email || actor.uid,
              });
              runInBackground(() =>
                runCreateJob(store, metaToken, { jobId, plan, account, enqueueSync }).finally(() =>
                  creating.delete(key),
                ),
              );
              handedOff = true;
              return {
                jobId,
                state: "running",
                name: plan.name,
                subDomain: plan.subDomain,
                adSets: plan.names.length,
              };
            } finally {
              if (!handedOff) creating.delete(key);
            }
          } catch (error) {
            return failure(error);
          }
        },
        {
          superadmin: true,
          body: t.Object({
            accountId: t.String({ minLength: 1, maxLength: 128 }),
            subDomainId: t.String({ minLength: 1, maxLength: 128 }),
            link: t.String({ minLength: 1, maxLength: 500 }),
            urlTags: t.Optional(t.String({ maxLength: 500 })),
            // Kapan ad set mulai tayang. Bentuknya diperiksa `parseStartTime`, bukan di sini: yang
            // menolak tanggal lampau harus satu tempat, dan tempat itu yang juga menulis zonanya.
            startTime: t.Optional(t.String({ maxLength: 40 })),
            name: t.String({ minLength: 1, maxLength: 400 }),
            dailyBudget: t.Union([t.Number(), t.String({ maxLength: 20 })]),
            countries: t.Array(t.String({ maxLength: 8 }), { maxItems: 250 }),
            ageMin: t.Optional(t.Number()),
            ageMax: t.Optional(t.Number()),
            pageId: t.String({ minLength: 1, maxLength: 30 }),
            pixelId: t.String({ minLength: 1, maxLength: 30 }),
            // Daftar tingkat-campaign, OPSIONAL dan cuma untuk bundel browser yang belum ikut
            // ter-deploy: server naik lebih dulu, dan tanpa ini tiap tab yang sedang terbuka
            // menjawab 422 selama jeda di antaranya. Gambar yang sebenarnya milik tiap iklan.
            images: t.Optional(t.Array(t.String({ maxLength: 64 }), { maxItems: MAX_IMAGES })),
            cta: t.String({ maxLength: 40 }),
            variants: t.Array(
              t.Object({
                title: t.String({ maxLength: 255 }),
                body: t.String({ maxLength: 2000 }),
                images: t.Optional(t.Array(t.String({ maxLength: 64 }), { maxItems: MAX_IMAGES })),
              }),
              { maxItems: MAX_VARIANTS },
            ),
          }),
        },
      )

      /**
       * Lanjutkan job `partial`: variasi yang belum beriklan dibuat dari rencana yang tersimpan di
       * job-nya, bukan dari form yang diisi ulang. Aturan apa yang boleh dilanjutkan tinggal di
       * `resumeCreatePlan`; ad account-nya dibaca ulang dari RTDB seperti job baru.
       */
      .post(
        "/create-jobs/:jobId/resume",
        async ({ params }) => {
          const job = await store.read(`${CREATE_JOBS_PATH}/${params.jobId}`);
          if (!job) return status(404, { error: "Pekerjaan itu sudah tidak ada." });
          const { account, stop } = await accountOf(job.accountId);
          if (stop) return stop;
          const key = `${account.id}:${normalizeName(job.name)}`;
          if (creating.has(key)) {
            return status(409, { error: "Pekerjaan ini sedang berjalan." });
          }
          creating.add(key);
          let handedOff = false;
          try {
            const { resume } = await startResumeCreateJob(store, params.jobId);
            runInBackground(() =>
              runCreateJob(store, metaToken, {
                jobId: params.jobId,
                plan: resume.plan,
                account,
                resume,
                enqueueSync,
              }).finally(() => creating.delete(key)),
            );
            handedOff = true;
            return { jobId: params.jobId, state: "running" };
          } catch (error) {
            return failure(error);
          } finally {
            if (!handedOff) creating.delete(key);
          }
        },
        {
          superadmin: true,
          params: t.Object({ jobId: t.String({ pattern: "^j[0-9a-z]{5,20}$" }) }),
        },
      )
  );
}

/**
 * Halaman dan pixel dibuktikan milik kita SEBELUM satu objek pun lahir.
 *
 * Meta menolak keduanya sendiri — tapi penolakannya datang di tengah jalan, sesudah campaign dan
 * sebagian ad set sudah berdiri. Diperiksa di depan, yang salah isi ditolak dengan nol objek
 * terlanjur lahir; alasan yang sama dengan payload AutoPost yang disusun di depan.
 */
async function assertPageAndPixel(plan, account, token) {
  const [pages, pixels] = await Promise.all([
    fetchPages(token),
    fetchAdPixels(account.actId, token),
  ]);
  const page = pages.find((item) => item.id === plan.pageId);
  if (!page) {
    throw new RuleError(
      "Halaman itu tidak dipegang System User — buka Business Manager dan berikan Halamannya dengan izin Create ads.",
    );
  }
  if (!page.canAdvertise) {
    throw new RuleError(`System User belum punya izin beriklan di Halaman ${page.name}.`);
  }
  if (!pixels.some((item) => item.id === plan.pixelId)) {
    throw new RuleError(`Pixel itu bukan milik ad account ${account.name || account.actId}.`);
  }
}
