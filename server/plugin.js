import { Elysia, status, t } from "elysia";
import { AUTOPOST_MAX_KEYWORDS, AUTOPOST_SCHEMA } from "../functions/autopost-core.js";
import {
  DEPLOYMENT_TASKS,
  LEGAL_PAGES,
  PLUGIN_GROUPS,
  PLUGIN_SCHEMA,
  PluginError,
  pluginFailureStatus,
} from "../functions/plugin-core.js";
import {
  adsenseSitesFor,
  auditSites,
  autopostGenerateKeywords,
  checkAdsenseSite,
  createSiteLanding,
  enrollMany,
  enrollOne,
  gptNetworksFor,
  injectAdsenseMany,
  injectGptMany,
  listAutopost,
  listSiteLandings,
  pingOne,
  previewGptSites,
  readAutopost,
  readGroup,
  readSiteLanding,
  resetOne,
  runSiteDeployment,
  runSiteLegalPages,
  saveSiteLanding,
  setSiteLicense,
  siteDeployment,
  siteLandingLink,
  siteLegalPages,
  siteLicense,
  submitAutopost,
  syncPlugin,
  updateMany,
  updateOne,
  writeGroup,
  writeGroupMany,
} from "../functions/sync-plugin.mjs";
import { AuthError, bearerToken, requireSuperAdmin } from "./auth.js";

/**
 * Management API plugin RabbitROI — jalur dari dashboard ke tiap situs WordPress.
 *
 * Kenapa lewat server ini dan bukan langsung dari browser, dua sebab yang masing-masing sudah cukup:
 *
 *   1. **Enroll token dibagi ke seluruh armada.** Ditaruh di bundle frontend, ia terbaca siapa pun
 *      yang membuka devtools — dan satu token itu meng-enroll setiap situs kita. Ini alasan yang
 *      lebih keras daripada di gating, di mana kuncinya setidaknya cuma satu sistem.
 *   2. **Situsnya tidak akan menjawab browser.** Endpoint plugin tidak mengirim header CORS untuk
 *      origin dashboard, jadi `fetch` dari halaman akan ditolak sebelum sampai ke PHP-nya.
 *
 * Superadmin saja, sekelas /gating dan dengan alasan yang sejenis: yang diubah tombol-tombol di sini
 * adalah kode iklan dan routing situs yang sedang menerima trafik berbayar. Kode iklan yang salah
 * tidak menghasilkan error di mana pun — ia menghasilkan pendapatan nol, dan baru terbaca di laporan
 * GAM keesokan harinya.
 */
export function pluginRoutes({ db, store, enrollToken, authorize }) {
  const check = authorize || ((token) => requireSuperAdmin(db, token));

  /**
   * Bungkus tiap handler satu-situs.
   *
   * Ada karena tanpanya `PluginError` akan naik ke `onError` global dan keluar sebagai 500 berisi
   * "Ada kesalahan di sisi server kontrol" — kalimat yang menuduh server ini untuk situs WordPress
   * yang sedang mati, dan yang membuat orang mencari penyebabnya di tempat yang salah.
   */
  async function run(work) {
    try {
      return await work();
    } catch (error) {
      if (error instanceof PluginError) {
        // `code` ikut dikirim, dan itu yang dibaca halaman untuk memilih tombol berikutnya:
        // `already_enrolled` menawarkan Reset, `no_key` menawarkan Enroll, `invalid_key` tidak
        // menawarkan apa pun karena memang tidak ada yang bisa dilakukan dari sini.
        return status(pluginFailureStatus(error), { error: error.message, code: error.code || "" });
      }
      throw error;
    }
  }

  /**
   * Pekerjaan situs yang LEBIH LAMA daripada batas tunggu nginx (60 detik): Setting Sub bisa sampai
   * sepuluh menit, halaman legal satu panggilan AI per halaman. Route menjawab sesudah status
   * "running" ditulis ke `subDomains/{id}/siteTasks/{kind}`, dan halamannya membaca kemajuan dari
   * sana — node yang sudah dilanggan, sepola Setup Sub.
   */
  // ponytail: penjaga di dalam proses; plugin sendiri juga mengunci per situs (409).
  const running = new Set();
  async function startTask(id, kind, actor, work) {
    const token = `${id}:${kind}`;
    if (running.has(token)) {
      return status(409, { error: "Pekerjaan yang sama masih berjalan di situs ini." });
    }
    // Tanpa ini, id yang salah melahirkan baris `subDomains/{id}` berisi status saja.
    if (!(await store.read(`subDomains/${id}/name`))) {
      return status(404, { error: "Subdomain ini tidak ada di dashboard." });
    }
    running.add(token);
    const path = `subDomains/${id}/siteTasks/${kind}`;
    const startedAt = new Date().toISOString();
    await store.replace(path, {
      state: "running",
      startedAt,
      updatedAt: startedAt,
      by: String(actor.email || actor.uid || ""),
    });
    work()
      .then((result) => store.update(path, { ...result, updatedAt: new Date().toISOString() }))
      .catch((error) =>
        store
          .update(path, {
            state: "failed",
            detail: String(error?.message || error),
            updatedAt: new Date().toISOString(),
          })
          .catch((writeError) => console.error(`[plugin] ${kind} gagal dicatat:`, writeError)),
      )
      .finally(() => running.delete(token));
    return { started: true };
  }

  return (
    new Elysia({ prefix: "/plugin" })
      .macro({
        superadmin: {
          async resolve({ headers }) {
            try {
              return { actor: await check(bearerToken(headers.authorization)) };
            } catch (error) {
              if (error instanceof AuthError) return status(error.status, { error: error.message });
              // Bukan penolakan melainkan pemeriksaannya sendiri yang gagal. Dijawab 401, orang akan
              // mengira haknya dicabut.
              return status(503, { error: `Izin tidak bisa diperiksa sekarang: ${error.message}` });
            }
          },
        },
      })

      /**
       * Skema field — SATU-SATUNYA definisi, dipakai server untuk memvalidasi dan browser untuk
       * menggambar form.
       *
       * Ditulis dua kali (seperti `campaignCommandEntry` terpaksa), yang bergeser tidak akan
       * berbunyi sebagai kesalahan: form akan menawarkan enum yang ditolak server, atau lebih buruk,
       * enum yang DITERIMA server tapi diabaikan diam-diam oleh plugin dan tersimpan sebagai nilai
       * lama. Empat puluh field dengan enum dan batasnya masing-masing terlalu banyak untuk dijaga
       * tetap sama dengan mata.
       *
       * AutoPost DIGABUNG di sini, bukan di dalam `PLUGIN_SCHEMA` itu sendiri: `autopost-core.js`
       * mengimpor `plugin-core.js` (untuk `PluginError`, `pluginHostname`, dan `normalizeField`),
       * jadi arah sebaliknya akan menutup lingkaran impor. Yang menyatukannya adalah pemakainya —
       * form di browser, yang memang menggambar keduanya dari satu jawaban.
       */
      .get("/schema", () => ({ ...PLUGIN_SCHEMA, ...AUTOPOST_SCHEMA }), { superadmin: true })

      // Enroll: sekali per situs. Yang sudah enroll menjawab `already_enrolled` — halaman membaca
      // kodenya dan menawarkan Reset, bukan mengulang tombol yang sama.
      .post(
        "/sites/:id/enroll",
        ({ params, actor }) =>
          run(() => enrollOne(store, params.id, enrollToken, actor.email || actor.uid)),
        { superadmin: true, params: t.Object({ id: siteId() }) },
      )

      .post("/sites/:id/reset", ({ params }) => run(() => resetOne(store, params.id)), {
        superadmin: true,
        params: t.Object({ id: siteId() }),
      })

      // POST walau ia cuma membaca: ia MENULIS cermin status di RTDB, dan sebuah GET yang mengubah
      // keadaan adalah GET yang akan diulang browser, proxy, atau tombol back tanpa diminta.
      .post("/sites/:id/ping", ({ params }) => run(() => pingOne(store, params.id)), {
        superadmin: true,
        params: t.Object({ id: siteId() }),
      })

      .get(
        "/sites/:id/config/:group",
        ({ params }) => run(() => readGroup(store, params.id, params.group)),
        { superadmin: true, params: t.Object({ id: siteId(), group: groupName() }) },
      )

      /**
       * Simpan sebagian pengaturan satu situs.
       *
       * Jawabannya membawa `unapplied` — nama field yang dikirim tapi TIDAK berubah di situs. Plugin
       * mengabaikan nilai enum yang tidak sah sambil tetap menjawab 200, jadi tanpa daftar ini
       * "Tersimpan." di layar bisa berarti tidak ada satu pun yang tersimpan.
       */
      .post(
        "/sites/:id/config/:group",
        ({ params, body }) => run(() => writeGroup(store, params.id, params.group, body.values)),
        {
          superadmin: true,
          params: t.Object({ id: siteId(), group: groupName() }),
          body: t.Object({ values: t.Record(t.String(), t.Any()) }),
        },
      )

      .get("/sites/:id/landings", ({ params }) => run(() => listSiteLandings(store, params.id)), {
        superadmin: true,
        params: t.Object({ id: siteId() }),
      })

      .get(
        "/sites/:id/landings/:landingId",
        ({ params }) => run(() => readSiteLanding(store, params.id, params.landingId)),
        {
          superadmin: true,
          params: t.Object({ id: siteId(), landingId: t.String({ pattern: "^[0-9]+$" }) }),
        },
      )

      // Satu endpoint untuk create dan update, persis seperti API-nya: yang membedakan adalah ada
      // tidaknya `id` di dalam `values`.
      .post(
        "/sites/:id/landings",
        ({ params, body }) => run(() => saveSiteLanding(store, params.id, body.values)),
        {
          superadmin: true,
          params: t.Object({ id: siteId() }),
          body: t.Object({ values: t.Record(t.String(), t.Any()) }),
        },
      )

      // Landing dari preset "Buat LP Baru" + tautan dan parameternya.
      .post(
        "/sites/:id/landings/create",
        ({ params, body }) => run(() => createSiteLanding(store, params.id, body || {})),
        {
          superadmin: true,
          params: t.Object({ id: siteId() }),
          body: t.Optional(t.Object({ slug: t.Optional(t.String({ maxLength: 100 })) })),
        },
      )

      .get(
        "/sites/:id/landings/:landingId/link",
        ({ params }) => run(() => siteLandingLink(store, params.id, params.landingId)),
        {
          superadmin: true,
          params: t.Object({ id: siteId(), landingId: t.String({ pattern: "^[0-9]+$" }) }),
        },
      )

      // Lisensi. License key di BODY, dan situs cuma memantulkan versi tersamar.
      .get("/sites/:id/license", ({ params }) => run(() => siteLicense(store, params.id)), {
        superadmin: true,
        params: t.Object({ id: siteId() }),
      })

      .post(
        "/sites/:id/license",
        ({ params, body }) =>
          run(() => setSiteLicense(store, params.id, body.licenseKey, body.force === true)),
        {
          superadmin: true,
          params: t.Object({ id: siteId() }),
          body: t.Object({
            licenseKey: t.String({ minLength: 1, maxLength: 200 }),
            force: t.Optional(t.Boolean()),
          }),
        },
      )

      // Setting Sub (Deployment Tools). GET murah; POST destruktif dan jalan di latar.
      .get("/sites/:id/deployment", ({ params }) => run(() => siteDeployment(store, params.id)), {
        superadmin: true,
        params: t.Object({ id: siteId() }),
      })

      .post(
        "/sites/:id/deployment",
        ({ params, body, actor }) =>
          startTask(params.id, "deployment", actor, () =>
            runSiteDeployment(store, params.id, body.tasks),
          ),
        {
          superadmin: true,
          params: t.Object({ id: siteId() }),
          body: t.Object({
            tasks: t.Array(t.Union(DEPLOYMENT_TASKS.map((task) => t.Literal(task))), {
              minItems: 1,
              maxItems: DEPLOYMENT_TASKS.length,
            }),
          }),
        },
      )

      // Menu Main Nav + Footer (task `menus`). Tidak destruktif; slot statusnya sendiri supaya
      // hasilnya tidak tercampur dengan Setting Sub.
      .post(
        "/sites/:id/menus",
        ({ params, actor }) =>
          startTask(params.id, "menus", actor, () =>
            runSiteDeployment(store, params.id, ["menus"]),
          ),
        { superadmin: true, params: t.Object({ id: siteId() }) },
      )

      // Halaman legal (Privacy Policy dkk). Kunci AI di BODY, tidak pernah disimpan.
      .get("/sites/:id/legal-pages", ({ params }) => run(() => siteLegalPages(store, params.id)), {
        superadmin: true,
        params: t.Object({ id: siteId() }),
      })

      .post(
        "/sites/:id/legal-pages",
        ({ params, body, actor }) =>
          startTask(params.id, "legal", actor, () =>
            runSiteLegalPages(store, params.id, body.aiKey, body.pages || []),
          ),
        {
          superadmin: true,
          params: t.Object({ id: siteId() }),
          body: t.Object({
            aiKey: t.String({ minLength: 16, maxLength: 512 }),
            pages: t.Optional(
              t.Array(t.Union(LEGAL_PAGES.map((page) => t.Literal(page))), {
                maxItems: LEGAL_PAGES.length,
              }),
            ),
          }),
        },
      )

      /**
       * AutoPost — SATU-SATUNYA jalur ke namespace di luar `/manage/`, dan ia sengaja punya route
       * sendiri alih-alih menumpang `:group`.
       *
       * `groupName()` di bawah ada persis untuk MENUTUP jalan itu: `:group` disambung mentah jadi
       * segmen alamat, jadi daftar putihnya yang menahan siapa pun mengarahkannya ke endpoint mana
       * pun di plugin. AutoPost dulu jadi contoh yang disebut di sana — "endpoint yang sengaja tidak
       * didokumentasikan". Sekarang ia didokumentasikan dan dipakai, dan yang berubah bukan
       * penjagaannya melainkan bahwa ia punya pintunya sendiri: alamatnya tetap tidak pernah datang
       * dari request, bentuk payloadnya divalidasi skemanya sendiri, dan `:group` tetap tidak bisa
       * menjangkaunya.
       *
       * Kunci AI ada di BODY, tidak pernah di alamat: alamat masuk ke log akses server, riwayat
       * browser, dan header `Referer` — tiga tempat yang tidak satu pun dijaga sekeras body request.
       */
      .post(
        "/sites/:id/autopost/keywords",
        ({ params, body }) =>
          run(() => autopostGenerateKeywords(store, params.id, body.aiKey, body.values || {})),
        {
          superadmin: true,
          params: t.Object({ id: siteId() }),
          body: t.Object({
            aiKey: t.String({ minLength: 1, maxLength: 512 }),
            values: t.Optional(t.Record(t.String(), t.Any())),
          }),
        },
      )

      /**
       * Kirim N kata kunci sebagai N job. SELALU 200 kalau sampai ke sini — hasilnya per kata kunci.
       *
       * Jumlahnya dibatasi DI SINI juga, bukan hanya di `submitAutopost`: yang lolos dari sini
       * berubah jadi proses PHP yang hidup sampai artikelnya selesai, dan penjagaan yang cuma ada di
       * satu lapis adalah penjagaan yang hilang pada hari pemanggil kedua ditambahkan.
       */
      .post(
        "/sites/:id/autopost",
        ({ params, body }) =>
          run(() => submitAutopost(store, params.id, body.aiKey, body.keywords, body.values || {})),
        {
          superadmin: true,
          params: t.Object({ id: siteId() }),
          body: t.Object({
            aiKey: t.String({ minLength: 1, maxLength: 512 }),
            keywords: t.Array(t.String({ maxLength: 300 }), {
              minItems: 1,
              maxItems: AUTOPOST_MAX_KEYWORDS,
            }),
            values: t.Optional(t.Record(t.String(), t.Any())),
          }),
        },
      )

      // GET, dan di sini itu benar — berbeda dari `/ping` yang POST karena menulis cermin. Ini
      // di-poll tiap beberapa detik dan TIDAK menyentuh RTDB sama sekali; lihat `listAutopost`.
      .get(
        "/sites/:id/autopost/jobs",
        ({ params, query }) =>
          run(() =>
            listAutopost(store, params.id, {
              status: query.status || "",
              keyword: query.keyword || "",
              limit: query.limit || "",
            }),
          ),
        {
          superadmin: true,
          params: t.Object({ id: siteId() }),
          query: t.Object({
            status: t.Optional(t.String({ maxLength: 64 })),
            keyword: t.Optional(t.String({ maxLength: 300 })),
            limit: t.Optional(t.String({ pattern: "^[0-9]{1,3}$" })),
          }),
        },
      )

      // Satu job berikut lognya, dibaca saat barisnya dibuka. `job_id` 16 karakter hex — dibatasi
      // bentuknya karena ia disambung jadi segmen alamat, alasan yang sama dengan `siteId()`.
      .get(
        "/sites/:id/autopost/job/:jobId",
        ({ params }) => run(() => readAutopost(store, params.id, params.jobId)),
        {
          superadmin: true,
          params: t.Object({ id: siteId(), jobId: t.String({ pattern: "^[A-Za-z0-9]{1,64}$" }) }),
        },
      )

      /**
       * Terapkan ke banyak situs. SELALU 200, dan hasilnya per situs.
       *
       * Pola yang sama dengan gate/ungate dan alasannya sama: satu kode HTTP untuk seratus situs
       * akan meleburkan "97 berhasil, 3 mati" jadi satu kata. Yang membaca hasilnya adalah tabel per
       * situs di halaman, dan tiga status di dalamnya — `ok`, `unapplied`, `failed` — menuntut
       * tindakan yang berbeda-beda.
       */
      .post(
        "/bulk/enroll",
        ({ body, actor }) => enrollMany(store, body.siteIds, enrollToken, actor.email || actor.uid),
        { superadmin: true, body: t.Object({ siteIds: siteIdList() }) },
      )

      /**
       * Ganti versi plugin di banyak situs sekaligus.
       *
       * Aksi paling merusak di seluruh halaman ini: ia MENGGANTI plugin di situs yang sedang
       * menerima trafik berbayar. Tetap 200 dengan hasil per situs, sepola dengan endpoint massal
       * lain — batch yang berhenti di tengah karena satu situs gagal meninggalkan armada dengan dua
       * versi plugin yang berbeda tanpa catatan mana yang sudah.
       *
       * `version` kosong = rilis stabil terbaru. Bentuknya divalidasi di `normalizeVersion`
       * SEBELUM satu situs pun disentuh.
       */
      .post("/bulk/update", ({ body }) => updateMany(store, body.siteIds, body.version || ""), {
        superadmin: true,
        body: t.Object({
          siteIds: siteIdList(),
          // Dibatasi panjangnya di sini juga: yang lolos dari sini disambung jadi bagian dari
          // permintaan ke situs, dan `t.Optional` tanpa batas adalah kotak terbuka.
          version: t.Optional(t.String({ maxLength: 32 })),
        }),
      })

      .post(
        "/sites/:id/update",
        ({ params, body }) => updateOne(store, params.id, body?.version || ""),
        {
          superadmin: true,
          params: t.Object({ id: siteId() }),
          body: t.Optional(t.Object({ version: t.Optional(t.String({ maxLength: 32 })) })),
        },
      )

      .post(
        "/bulk/config/:group",
        ({ params, body }) => writeGroupMany(store, body.siteIds, params.group, body.values),
        {
          superadmin: true,
          params: t.Object({ group: groupName() }),
          body: t.Object({ siteIds: siteIdList(), values: t.Record(t.String(), t.Any()) }),
        },
      )

      /**
       * Inject kode iklan Ad Manager — alurnya dimulai dari SUBDOMAIN, bukan dari kode tempelan.
       *
       * `/gpt/networks` menjawab akun GAM, network, properti, dan unit iklan tiap subdomain terpilih —
       * dibaca dari /gam-accounts dan Ad Manager API, tanpa menghubungi WordPress. `/gpt/preview`
       * menyusun kode SELURUH subdomain terpilih (stempel div per subdomain), dan `/bulk/gpt-inject` menulis. Request tidak pernah membawa path
       * unit iklan maupun div id: yang dibawanya kode unit per network, dan server mencarinya di daftar
       * Ad Manager sebelum menyusun apa pun.
       */
      .post("/gpt/networks", ({ body }) => run(() => gptNetworksFor(store, body.siteIds)), {
        superadmin: true,
        body: t.Object({ siteIds: siteIdList() }),
      })

      .post(
        "/gpt/preview",
        ({ body }) =>
          run(() => previewGptSites(store, body.siteIds, body.options, body.adUnitCodes || {})),
        {
          superadmin: true,
          body: t.Object({
            siteIds: siteIdList(),
            options: gptOptions(),
            adUnitCodes: gptUnitCodes(),
          }),
        },
      )

      /**
       * Tulis ke banyak situs. SELALU 200 kalau pilihannya sah, hasil per situs — sepola terapkan
       * massal. `dryRun` membaca tiap situs dan melaporkan rencananya tanpa menulis apa pun.
       */
      .post(
        "/bulk/gpt-inject",
        ({ body }) =>
          run(() =>
            injectGptMany(store, body.siteIds, body.options, {
              dryRun: body.dryRun === true,
              adUnitCodes: body.adUnitCodes || {},
            }),
          ),
        {
          superadmin: true,
          body: t.Object({
            siteIds: siteIdList(),
            options: gptOptions(),
            adUnitCodes: gptUnitCodes(),
            dryRun: t.Optional(t.Boolean()),
          }),
        },
      )

      /**
       * Inject kode iklan AdSense — yang dibawa request adalah KODE UTUH yang ditempel superadmin dari
       * halaman AdSense, per subdomain. Slot AdSense tidak bisa dibuat lewat API (tertutup untuk
       * AdSense for Platforms), jadi ini satu-satunya jalan. Server mengurainya dengan daftar putih dan
       * mencocokkan tiap slot dengan ad unit akun itu sebelum apa pun ditulis; header tidak disentuh.
       */
      // Subdomain yang akun AdSense-nya terdaftar di /adsense-accounts (lewat daftar Situs tiap akun di
      // AdSense API) — satu-satunya yang ditawarkan tab AdSense.
      .get("/adsense/sites", () => run(() => adsenseSitesFor(store)), { superadmin: true })

      .post(
        "/adsense/check",
        ({ body }) => run(() => checkAdsenseSite(store, body.siteId, body.codes)),
        {
          superadmin: true,
          body: t.Object({ siteId: siteId(), codes: adsenseCodes() }),
        },
      )

      .post(
        "/bulk/adsense-inject",
        ({ body }) =>
          run(() => injectAdsenseMany(store, body.items, { dryRun: body.dryRun === true })),
        {
          superadmin: true,
          body: t.Object({
            items: t.Array(t.Object({ siteId: siteId(), codes: adsenseCodes() }), {
              minItems: 1,
              maxItems: 200,
            }),
            dryRun: t.Optional(t.Boolean()),
          }),
        },
      )

      /**
       * Cek situs — baca kode iklan, CMP, network code, landing page, dan behaviour tiap subdomain lalu
       * nilai. SELALU 200 dengan hasil per situs, sepola endpoint massal lain; tidak menulis ke situs.
       * Dibatasi 20 per request: tiap situs lima bacaan, dan halamannya mengirim per gelombang.
       */
      .post("/audit", ({ body }) => run(() => auditSites(store, body.siteIds)), {
        superadmin: true,
        body: t.Object({ siteIds: t.Array(siteId(), { minItems: 1, maxItems: 20 }) }),
      })

      // Satu siklus ping atas permintaan — jalur yang sama dengan cron, untuk memeriksa kesehatan
      // armada tanpa menunggu jadwalnya.
      .post("/sync", () => syncPlugin(store), { superadmin: true })
  );
}

// Push-key RTDB. Dibatasi bentuknya, bukan dipercaya apa adanya: nilai ini disambung jadi path RTDB
// (`subDomains/${id}`), dan "/" di dalamnya akan membaca node yang sama sekali lain.
function siteId() {
  return t.String({ pattern: "^[A-Za-z0-9_-]{1,64}$" });
}

// Jumlahnya dibatasi supaya satu request tidak menahan seluruh proses selama sepuluh menit; armada
// yang lebih besar dari ini dikirim dalam beberapa gelombang oleh halamannya.
function siteIdList() {
  return t.Array(siteId(), { minItems: 1, maxItems: 200 });
}

// Bentuknya saja; isinya (ukuran, jumlah slot) diperiksa `normalizeGptOptions`, yang kalimat
// penolakannya menyebut field yang sedang dibaca orang di form.
function gptOptions() {
  return t.Object({
    sizes: t.String({ maxLength: 4000 }),
    slots: t.Union([t.Number(), t.String({ maxLength: 4 })]),
    // Stempel div per subdomain dari pratinjau (`div-gpt-ad-{stempel}-N`); yang tidak ada dibuat baru.
    divStamps: t.Optional(
      t.Record(t.String({ maxLength: 64 }), t.String({ maxLength: 20 }), { maxProperties: 200 }),
    ),
  });
}

// { networkCode: adUnitCode } — dicari di daftar unit Ad Manager, tidak dipercaya apa adanya.
function gptUnitCodes() {
  return t.Optional(
    t.Record(t.String({ pattern: "^[0-9]{1,20}$" }), t.String({ maxLength: 100 }), {
      maxProperties: 50,
    }),
  );
}

// Bentuknya saja; isinya diurai `normalizeAdsenseCodes`, yang kalimat penolakannya menyebut nomor
// kotaknya.
function adsenseCodes() {
  return t.Array(t.String({ maxLength: 6000 }), { minItems: 1, maxItems: 5 });
}

/**
 * `:group` HARUS dari daftar, dan ini bukan sekadar validasi rapi.
 *
 * Nilainya disambung mentah jadi segmen alamat di API plugin (`/${group}`). Dibiarkan bebas, siapa
 * pun yang lolos gerbang superadmin bisa mengarahkannya ke endpoint plugin mana pun.
 *
 * AutoPost dulu jadi contoh yang disebut di sini. Ia sekarang dipakai — dan justru karena itu ia
 * TIDAK ditambahkan ke daftar ini: alamatnya di luar `/manage/` (`groupName` cuma bisa menghasilkan
 * segmen di dalamnya), amplop gagalnya lain, dan payloadnya punya skemanya sendiri. Ia punya
 * route-nya sendiri di atas. Yang dijaga daftar ini tetap sama: segmen yang datang dari request
 * hanya boleh salah satu dari empat grup pengaturan, dan tidak ada yang lain.
 */
function groupName() {
  return t.Union(PLUGIN_GROUPS.map((group) => t.Literal(group)));
}
