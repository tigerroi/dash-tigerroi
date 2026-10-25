import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Elysia, status, t } from "elysia";
import {
  AUTOPOST_BASE_MAX,
  AUTOPOST_MAX_KEYWORDS,
  autopostKeywords,
  toAutopostPayload,
} from "../functions/autopost-core.js";
import { createDnsRecord, listDnsRecords, listZones } from "../functions/cloudflare.js";
import {
  GPT_MAX_SLOTS,
  gamAccountsForSite,
  normalizeGptOptions,
} from "../functions/gpt-inject-core.js";
import {
  DEPLOYMENT_TASKS,
  LEGAL_PAGES,
  PLUGIN_GROUPS,
  PluginError,
} from "../functions/plugin-core.js";
import {
  autopostGenerateKeywords,
  createSiteLanding,
  enrollOne,
  injectAdsenseOne,
  injectGptOne,
  listAutopost,
  resolveSite,
  runSiteDeployment,
  runSiteLegalPages,
  setSiteLicense,
  siteDeployment,
  submitAutopost,
  writeGroup,
} from "../functions/sync-plugin.mjs";
import { AuthError, bearerToken, requireSuperAdmin } from "./auth.js";

/**
 * Setup Sub — satu tombol untuk subdomain baru: DNS Cloudflare -> site CloudPanel + WordPress ->
 * SSL -> plugin RabbitROI + enroll.
 *
 * Yang di server CloudPanel dikerjakan `server/cloudpanel/rabbitroi-setup-sub.sh`, dipanggil lewat
 * SSH dengan kunci yang DIKUNCI ke satu perintah (forced command + sudoers satu skrip).
 *
 * Server tujuan = IP A record DOMAIN INDUK, tanpa daftar server: seluruh server CloudPanel berbagi
 * user SSH dan password root yang sama. Server yang belum menerima kunci (baru) DI-BOOTSTRAP sekali
 * dengan password root itu (`bootstrapServer`), lalu run-nya diulang lewat kunci.
 *
 * Hostname dibaca dari `subDomains/{id}`, TIDAK PERNAH dari request — alasan yang sama dengan enroll
 * plugin: yang memilih domain adalah baris yang sudah didaftarkan admin.
 *
 * Berjalan di LATAR: pasang WordPress + Let's Encrypt makan satu-dua menit, lebih lama daripada
 * batas tunggu nginx. Route menjawab sesudah status "running" ditulis ke baris subdomainnya, dan
 * halaman membaca kemajuannya dari sana (`subDomains/{id}/setup`) — node yang sudah dilanggan.
 */

// Artikel AutoPost yang terkirim di atas angka ini = langkah AutoPost dianggap selesai walau ada
// kata kunci yang ditolak (keputusan pemilik repo, 23 Sep 2026: 19 dari 20 bukan "Sebagian").
export const AUTOPOST_ENOUGH_POSTS = 15;

export const SETUP_TIMEOUT_MS = 15 * 60 * 1000;
// Baris "running" yang lebih tua dari ini dianggap proses yang mati (server di-restart di tengah).
const STALE_MS = SETUP_TIMEOUT_MS + 60 * 1000;

export function setupSubRoutes({
  db,
  store,
  // User SSH berkunci, sama di tiap server. Server-nya IP apex domain induk (`pickServer`).
  sshUser = "rabbitroi",
  sshKey,
  // Login root BERSAMA seluruh server, hanya untuk bootstrap server yang belum menerima kunci.
  // Kosong = server baru harus disiapkan manual lewat bootstrap-remote.sh.
  bootstrapUser = "root",
  bootstrapPassword = "",
  // Login admin WordPress bawaan situs BARU ({ user, password }); kosong = "rabbitroi" + acak. Ikut
  // stdin SSH, bukan argumen — lihat `wpAdminHeader`.
  wpAdmin = {},
  // PAT baca repo plugin. HANYA di server kontrol: zip-nya diunduh di sini lalu dikirim lewat stdin
  // SSH, jadi server CloudPanel — yang root-nya dibagi dengan puluhan situs — tidak memegang token.
  pluginToken = "",
  cloudflareToken,
  cloudflareAccount,
  enrollToken,
  authorize,
  runRemote = sshRunner({
    sshUser,
    sshKey,
    bootstrapUser,
    bootstrapPassword,
    wpAdmin,
    pluginZip: pluginZipFetcher(pluginToken),
  }),
  // Injectable: menyentuh Cloudflare sungguhan. Menjawab { ip, note }.
  resolveDns = (host) => ensureDns({ host, token: cloudflareToken, account: cloudflareAccount }),
  // Injectable, sepola `runRemote`: keduanya menyentuh situs WordPress sungguhan, jadi test
  // memberikan versi palsunya untuk mengadu percabangan partial/failed sesudah enroll.
  applyLicense = (id, key) => setSiteLicense(store, id, key, false),
  applyConfig = (id, group, values) => writeGroup(store, id, group, values),
  // Langkah situs sesudah enroll (Setting Sub, halaman legal, AutoPost, menu). Injectable dengan
  // alasan yang sama: semuanya menyentuh WordPress sungguhan.
  runDeploy = (id, tasks) => runSiteDeployment(store, id, tasks),
  readDeploy = (id) => siteDeployment(store, id),
  runLegal = (id, aiKey, pages) => runSiteLegalPages(store, id, aiKey, pages),
  submitPosts = (id, aiKey, keywords, values = {}) =>
    submitAutopost(store, id, aiKey, keywords, values),
  generatePosts = (id, aiKey, { base, total, bahasa }) =>
    autopostGenerateKeywords(store, id, aiKey, {
      base_keyword: base,
      total_keyword: total,
      ...(bahasa ? { bahasa } : {}),
    }),
  listPosts = (id) => listAutopost(store, id, {}),
  // Kode iklan GPT (tab AdX di /plugin) dan landing dari preset ("Buat dari preset") — fungsi yang
  // SAMA dengan halaman Plugin, bukan salinannya.
  injectAdCode = (id, options) => injectGptOne(store, id, options),
  injectAdsense = (id, codes) => injectAdsenseOne(store, id, codes),
  // Cerminan `saveAdsenseSlots` di browser: `dashboard/adsenseSlots/{id}` = { name, codes }.
  saveAdsenseCodes = async (id, codes) => {
    const name = await store.read(`subDomains/${id}/name`);
    const now = new Date().toISOString();
    await store.replace(`dashboard/adsenseSlots/${id}`, {
      id,
      name: String(name || ""),
      codes: codes.filter(Boolean),
      createdAt: now,
      createdBy: "setup-sub",
      updatedAt: now,
      updatedBy: "setup-sub",
    });
  },
  // AdX kalau domainnya punya akun GAM di /gam-accounts, AdSense kalau tidak — pencocokan yang SAMA
  // dengan tab AdX (`gamAccountsForSite`), jadi yang dipilih di sini tidak bisa berselisih dengannya.
  adNetworkOf = async (id) =>
    gamAccountsForSite(await resolveSite(store, id), await store.read("gamAccounts")).length
      ? "adx"
      : "adsense",
  createLanding = (id) => createSiteLanding(store, id),
  // Landing + campaign Keitaro + gate dari tautan landing tadi — `keitaroSiteCreator` yang SAMA
  // dengan tombol di dialog Tautan landing. Tidak diberikan = langkahnya disebut tidak tersedia.
  createKeitaro = null,
  // Menu dirakit dari kategori ber-post, jadi ia menunggu job AutoPost selesai — tapi tidak selamanya.
  postPollMs = 60 * 1000,
  postWaitMs = 45 * 60 * 1000,
}) {
  const check = authorize || ((token) => requireSuperAdmin(db, token));
  // ponytail: penjaga di dalam proses; satu instansi server kontrol per database, jadi cukup.
  const running = new Set();
  /**
   * SATU antrean untuk seluruh setup, satuan maupun massal: tiap run memanggil clpctl, apt-lock-nya
   * nginx reload, dan Let's Encrypt di server CloudPanel yang sama. Sepuluh run paralel berarti
   * sepuluh reload nginx bersamaan di mesin yang melayani trafik berbayar.
   */
  let queue = Promise.resolve();
  /**
   * Run CloudPanel yang masih antre atau berjalan. Langkah situs MENUNGGU sampai nol: `clpctl
   * site:add:php` untuk sub berikutnya me-reload PHP-FPM di server yang sama, dan request situs yang
   * sedang berjalan saat itu terputus jadi 502 "tanpa JSON" — 23 Sep 2026, e-bikes/housing/kisan
   * gagal di Halaman Legal persis selama sub sesudahnya dibuat, dua sub terakhir lolos. Yang sama
   * juga membunuh proses artikel AutoPost yang sedang ditulis. Harganya: situs mulai diisi sesudah
   * SELURUH sub di bulk dibuat, bukan bergantian.
   */
  let cloudPending = 0;
  async function cloudIdle() {
    while (cloudPending) await queue;
  }
  /**
   * Antrean KEDUA untuk langkah situs yang berat (Setting Sub memasang tema + plugin, halaman legal +
   * AutoPost memanggil AI dari PHP situs). Terpisah dari antrean CloudPanel supaya sub berikutnya
   * tidak menunggu artikel sub sebelumnya; tetap berurutan karena sub satu domain tinggal di satu
   * server. Penantian job AutoPost + menu berjalan DI LUAR antrean ini.
   */
  let siteQueue = Promise.resolve();
  function inSiteQueue(work) {
    const done = siteQueue.then(work);
    siteQueue = done.catch(() => {});
    return done;
  }

  async function writeSetup(id, patch) {
    await store.update(`subDomains/${id}/setup`, { ...patch, updatedAt: new Date().toISOString() });
  }

  async function run(id, host, actor, settings = {}) {
    const notes = [];
    const step = (name) => writeSetup(id, { step: name });
    // Sesudah enroll berhasil, kegagalan lisensi/behaviour berarti "partial" (situs + plugin sudah
    // hidup), bukan "failed" — sepola SSL yang gagal setelah WordPress terpasang.
    let enrolled = false;
    let handedOff = false;
    try {
      await writeSetup(id, { state: "running", step: "dns" });
      const dns = await resolveDns(host);
      notes.push(`Server ${dns.ip}.`, dns.note);
      await writeSetup(id, { server: dns.ip });

      await step("install");
      const result = await runRemote(host, actor.email, dns.ip);
      if (result.bootstrapped) notes.push(`Server ${dns.ip} baru, disiapkan otomatis.`);
      notes.push(
        result.installedWordpress
          ? `WordPress terpasang, kredensial di ${result.credentialsFile} (server CloudPanel).`
          : "WordPress sudah ada sebelumnya.",
      );

      if (result.ssl !== "ok") {
        await writeSetup(id, {
          state: "partial",
          step: "ssl",
          ssl: "failed",
          plugin: result.plugin || "",
          detail: [...notes, `SSL gagal: ${result.sslError || "tanpa keterangan"}`].join(" "),
          finishedAt: new Date().toISOString(),
        });
        return;
      }

      await step("plugin");
      const key = await store.read(`pluginKeys/${id}/apiKey`);
      if (key) {
        notes.push("Plugin sudah ter-enroll sebelumnya.");
      } else {
        await enrollOne(store, id, enrollToken, actor.email || actor.uid);
        notes.push(`Plugin RabbitROI ${result.plugin} ter-enroll.`);
      }
      enrolled = true;

      // Lisensi milik sub ini + grup pengaturan yang SAMA untuk seluruh sub satu domain, dikirim
      // sekali dari halaman Setup Sub. Semuanya opsional; server menerapkan apa yang diberikan,
      // tidak menurunkannya. Grup diproses menurut urutan PLUGIN_GROUPS supaya langkahnya
      // deterministik.
      if (settings.licenseKey) {
        await step("license");
        const license = await applyLicense(id, settings.licenseKey);
        notes.push(
          license.active
            ? "Lisensi aktif."
            : `Lisensi tersimpan (${license.license_status || "belum aktif"}).`,
        );
      }

      for (const group of PLUGIN_GROUPS) {
        const values = settings.config?.[group];
        if (!values || !Object.keys(values).length) continue;
        await step(group);
        const applied = await applyConfig(id, group, values);
        notes.push(
          applied.unapplied?.length
            ? `${group}: ${applied.unapplied.length} field ditolak situs (${applied.unapplied.join(", ")}).`
            : `${group} tersimpan.`,
        );
      }

      await writeSetup(id, { ssl: "ok", plugin: result.plugin || "" });
      if (hasSiteSteps(id, settings)) {
        // Dilepas dari antrean CloudPanel; `running` dibersihkan langkah situs itu sendiri.
        handedOff = true;
        void siteSteps(id, settings, notes);
        return;
      }
      await writeSetup(id, {
        state: "done",
        step: "done",
        detail: notes.join(" "),
        finishedAt: new Date().toISOString(),
      });
    } catch (error) {
      await writeSetup(id, {
        state: enrolled ? "partial" : "failed",
        detail: [...notes, String(error?.message || error)].join(" "),
        finishedAt: new Date().toISOString(),
      }).catch((writeError) => console.error("[setup-sub] status gagal ditulis:", writeError));
    } finally {
      if (!handedOff) running.delete(id);
    }
  }

  /**
   * AutoPost satu sub: `{ base, total }` (kata kunci dibuat AI di situs dari kata dasar) atau teks
   * kata kunci satu per baris (bentuk lama, dari bundle yang belum dimuat ulang).
   */
  function postSpec(id, settings) {
    return autopostSpec(settings.autopost?.[id]);
  }

  function hasSiteSteps(id, settings) {
    return Boolean(
      settings.adCode ||
        settings.deployment?.length ||
        settings.legal ||
        postSpec(id, settings) ||
        settings.menus ||
        settings.landing,
    );
  }

  // Hasilnya juga ditulis ke `siteTasks/{kind}`, jadi tab Setup Situs di /plugin menggambar keadaan
  // yang sama dengan yang dijalankan dari sini.
  async function recordTask(id, kind, result) {
    await store.replace(`subDomains/${id}/siteTasks/${kind}`, {
      ...result,
      updatedAt: new Date().toISOString(),
    });
  }

  /**
   * Urutan onboarding dokumen API plugin: Setting Sub -> Halaman Legal -> AutoPost -> Menu. Setting
   * Sub PALING DEPAN karena task `trash` membuang seluruh Posts & Pages — sesudah halaman legal dan
   * artikel lahir, ia akan membuang keduanya. Menu PALING AKHIR karena isinya dirakit dari kategori
   * ber-post dan Page publish; sebelum itu ia "berhasil" dengan menu berisi Home saja.
   *
   * Semua kegagalan di sini = "partial": situs + plugin sudah hidup.
   */
  async function siteSteps(id, settings, notes) {
    const step = (name) => writeSetup(id, { step: name });
    let partial = false;
    try {
      let jobIds = [];
      if (cloudPending) {
        await step("server-wait");
        await cloudIdle();
      }
      await inSiteQueue(async () => {
        if (settings.adCode) {
          await step("adcode");
          // Gagal di sini TIDAK menghentikan langkah lain: halaman legal dan artikel tidak bergantung
          // pada kode iklan, dan yang tersering gagal adalah data dashboard, bukan situsnya.
          try {
            const network = await adNetworkOf(id);
            const codes = (settings.adsenseCodes?.[id] || []).map((c) => String(c).trim());
            if (network === "adx") {
              const { unapplied, detail } = await injectAdCode(id, settings.adCode);
              notes.push(`Kode iklan AdX: ${detail.adUnitPath}, ${settings.adCode.slots} slot.`);
              if (unapplied.length) {
                notes.push(`Kode iklan: ${unapplied.length} field ditolak situs.`);
                partial = true;
              }
            } else if (codes.some(Boolean)) {
              const { unapplied, detail } = await injectAdsense(id, codes);
              // Disimpan sesudah BERHASIL tertulis ke situs, persis tab AdSense — supaya tab itu
              // terisi kode sub ini. Gagal menyimpan tidak menggagalkan inject yang sudah terjadi.
              await saveAdsenseCodes(id, codes).catch((error) =>
                notes.push(
                  `Kode AdSense terpasang tapi gagal disimpan di dashboard: ${error.message}`,
                ),
              );
              notes.push(
                `Kode iklan AdSense: ${detail.slots.length} slot${detail.verified ? "" : " (belum terverifikasi)"}.`,
              );
              if (unapplied.length) {
                notes.push(`Kode iklan: ${unapplied.length} field ditolak situs.`);
                partial = true;
              }
            } else {
              notes.push(
                "Kode iklan dilewati: domain ini tidak punya akun GAM dan kode AdSense-nya tidak diisi.",
              );
              partial = true;
            }
          } catch (error) {
            notes.push(`Kode iklan gagal: ${error.message}`);
            partial = true;
          }
        }
        if (settings.deployment?.length) {
          await step("deployment");
          const outcome = await runDeploy(id, settings.deployment);
          await recordTask(id, "deployment", outcome);
          notes.push(`Setting Sub: ${outcome.detail}`);
          if (outcome.state !== "done") partial = true;
        }
        if (settings.legal) {
          await step("legal");
          const outcome = await runLegal(id, settings.legalAiKey, settings.legalPages || []);
          await recordTask(id, "legal", outcome);
          notes.push(`Halaman legal: ${outcome.detail}`);
          if (outcome.state !== "done") partial = true;
        }
        const spec = postSpec(id, settings);
        if (spec) {
          await step("autopost");
          let keywords = spec.keywords;
          if (!keywords) {
            // Dibuat di situsnya sendiri (AI yang sama dengan artikelnya). AI kerap mengembalikan
            // lebih sedikit dari yang diminta; selisihnya disebut, bukan disembunyikan.
            const made = await generatePosts(id, settings.autopostAiKey, spec);
            keywords = made.keywords.slice(0, AUTOPOST_MAX_KEYWORDS);
            notes.push(`Kata kunci "${spec.base}": ${keywords.length} dari ${spec.total} dibuat.`);
            if (!keywords.length) throw new Error("AI tidak mengembalikan satu kata kunci pun.");
          }
          const { results, summary } = await submitPosts(
            id,
            settings.autopostAiKey,
            keywords,
            settings.autopostValues || {},
          );
          jobIds = results.filter((row) => row.jobId).map((row) => row.jobId);
          notes.push(`AutoPost: ${summary.ok} dari ${summary.total} artikel dikirim.`);
          if (summary.failed) {
            // Beberapa kata kunci yang ditolak tidak menjadikan sub "Sebagian" selama artikelnya
            // cukup (> AUTOPOST_ENOUGH_POSTS) — situsnya sudah terisi; yang ditolak tetap disebut.
            if (summary.ok <= AUTOPOST_ENOUGH_POSTS) partial = true;
            // Kata kunci yang ditolak tidak pernah jadi job di situs, jadi di sinilah satu-satunya
            // tempat sebabnya bisa terbaca — "19 dari 20" saja tidak bisa ditindaklanjuti. Tidak
            // diulang otomatis: AutoPost tanpa dedup, dan 502 bisa datang sesudah job-nya lahir.
            const rejected = results.filter((row) => row.status === "failed");
            notes.push(
              `Ditolak: ${rejected
                .slice(0, 3)
                .map((row) => `"${row.keyword}" (${row.error || "tanpa keterangan"})`)
                .join("; ")}${rejected.length > 3 ? `; dan ${rejected.length - 3} lainnya` : ""}.`,
            );
          }
        }
      });

      // Menu dan landing sama-sama dirakit dari isi situs (kategori ber-post, URL artikel), jadi
      // keduanya menunggu artikel AutoPost yang dikirim run ini.
      if ((settings.menus || settings.landing) && jobIds.length) {
        await step("autopost-wait");
        const left = await waitForJobs(id, jobIds);
        if (left) {
          notes.push(`${left} artikel AutoPost belum selesai saat menu/landing dibuat.`);
          partial = true;
        }
      }
      if (settings.menus) {
        await step("menus");
        const outcome = await runDeploy(id, ["menus"]);
        await recordTask(id, "menus", outcome);
        // Yang menandai jadi-tidaknya `menus.ok` dari GET deployment, bukan `ok` task-nya.
        const status = await readDeploy(id).catch(() => null);
        const menus = status?.menus;
        notes.push(
          menus?.ok ? "Menu jadi." : `Menu belum lengkap: ${menus?.info || outcome.detail}`,
        );
        if (!menus?.ok) partial = true;
      }
      if (settings.landing) {
        await step("landing");
        const link = await createLanding(id);
        notes.push(link.link ? `Landing: ${link.link}.` : "Landing dibuat tanpa tautan.");
        if (link.presetError) {
          notes.push(`Setelan preset landing gagal: ${link.presetError}.`);
          partial = true;
        }
        await writeSetup(id, { landingLink: String(link.link || "") });
        // Keitaro butuh tautan landing ini, jadi ia hanya jalan di dalam langkah landing. Namanya
        // "{PIC} T2 (WL) {kode} ({host})" — awalan diturunkan dari PIC sub oleh pembuatnya.
        if (settings.keitaro) {
          await step("keitaro");
          try {
            if (!createKeitaro) throw new Error("tidak tersedia di server kontrol ini.");
            if (!link.link) throw new Error("landing tidak punya tautan.");
            const made = await createKeitaro(id, { url: link.link });
            const gate = made.gate?.status || "dilewati";
            notes.push(`Keitaro: ${made.campaign.name} (#${made.campaign.id}), gate ${gate}.`);
            if (made.gate && made.gate.status !== "ok") {
              if (made.gate.error) notes.push(`Gate: ${made.gate.error}`);
              partial = true;
            }
          } catch (error) {
            // Tidak diulang otomatis: salinan campaign yang jawabannya hilang bisa sudah lahir.
            const done = error.created?.campaign
              ? ` Sudah lahir: ${error.created.campaign.name} (#${error.created.campaign.id}).`
              : "";
            notes.push(`Keitaro gagal: ${error.message}${done}`);
            partial = true;
          }
        }
      }

      await writeSetup(id, {
        state: partial ? "partial" : "done",
        step: "done",
        detail: notes.join(" "),
        finishedAt: new Date().toISOString(),
      });
    } catch (error) {
      await writeSetup(id, {
        state: "partial",
        detail: [...notes, String(error?.message || error)].join(" "),
        finishedAt: new Date().toISOString(),
      }).catch((writeError) => console.error("[setup-sub] status gagal ditulis:", writeError));
    } finally {
      running.delete(id);
    }
  }

  /**
   * Tunggu sampai job yang DIKIRIM run ini berhenti berjalan. Menjawab berapa yang masih berjalan
   * saat batasnya habis (0 = semuanya selesai). Job yang hilang dari daftar dihitung selesai —
   * plugin memindahkan job mati ke `stalled` sendiri, jadi yang tidak terlihat bukan yang berjalan.
   * Bacaan yang gagal tidak menghentikan penantian; situs yang sedang menulis artikel bisa lambat.
   */
  async function waitForJobs(id, jobIds) {
    const deadline = Date.now() + postWaitMs;
    let left = jobIds.length;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, postPollMs));
      try {
        const { jobs } = await listPosts(id);
        left = jobs.filter(
          (job) => jobIds.includes(job.jobId) && !["done", "failed"].includes(job.status),
        ).length;
        if (!left) return 0;
      } catch {}
    }
    return left;
  }

  return new Elysia({ prefix: "/setup-sub" })
    .macro({
      superadmin: {
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
    .post(
      "/bulk",
      ({ body, actor }) => {
        // Grup harus salah satu dari PLUGIN_GROUPS: nama grup disambung jadi segmen alamat API
        // plugin di `writeGroup`, jadi yang tidak dikenal ditolak SEBELUM satu sub pun diantre —
        // bukan dibiarkan melempar di latar dan menandai tiap baris "partial".
        const badGroup = Object.keys(body.config || {}).find((g) => !PLUGIN_GROUPS.includes(g));
        if (badGroup) return status(422, { error: `Grup pengaturan tidak dikenal: ${badGroup}` });
        // Dua kunci: halaman legal dan AutoPost bisa ditagihkan ke akun AI yang berbeda. `aiKey`
        // (satu untuk keduanya) cuma cadangan untuk tab yang masih memuat bundle lama.
        const legalAiKey = String(body.legalAiKey || body.aiKey || "").trim();
        const autopostAiKey = String(body.autopostAiKey || body.aiKey || "").trim();
        const specs = Object.values(body.autopost || {}).map(autopostSpec);
        const wantsPosts = specs.some(Boolean);
        const tooMany = specs.find((spec) => spec?.keywords?.length > AUTOPOST_MAX_KEYWORDS);
        if (tooMany) {
          return status(422, {
            error: `Maksimal ${AUTOPOST_MAX_KEYWORDS} kata kunci AutoPost per subdomain.`,
          });
        }
        // Setelan artikel diperiksa DI DEPAN, dengan aturan yang sama dengan pengirimnya: yang salah
        // ditolak sebelum satu sub pun diantre, bukan sesudah Setting Sub membuang isi situsnya.
        if (wantsPosts && body.autopostValues) {
          try {
            toAutopostPayload("cek", "x".repeat(16), body.autopostValues);
          } catch (error) {
            if (error instanceof PluginError) return status(422, { error: error.message });
            throw error;
          }
        }
        if (body.adCode) {
          try {
            normalizeGptOptions(body.adCode);
          } catch (error) {
            if (error instanceof PluginError) return status(422, { error: error.message });
            throw error;
          }
        }
        if (body.legal && legalAiKey.length < 16) {
          return status(422, { error: "Kunci AI halaman legal wajib diisi." });
        }
        if (wantsPosts && autopostAiKey.length < 16) {
          return status(422, { error: "Kunci AI AutoPost wajib diisi." });
        }
        return enqueueMany(body.ids, actor, {
          licenses: body.licenses || {},
          licenseKey: body.licenseKey || "",
          config: body.config || null,
          deployment: body.deployment || [],
          legal: body.legal === true,
          legalPages: body.legalPages || [],
          autopost: body.autopost || {},
          menus: body.menus === true,
          legalAiKey,
          autopostAiKey,
          autopostValues: body.autopostValues || {},
          adCode: body.adCode || null,
          adsenseCodes: body.adsenseCodes || {},
          landing: body.landing === true,
          keitaro: body.landing === true && body.keitaro === true,
        });
      },
      {
        superadmin: true,
        body: t.Object({
          ids: t.Array(t.String({ pattern: "^[A-Za-z0-9_-]{1,64}$" }), {
            minItems: 1,
            maxItems: 50,
          }),
          // Isinya divalidasi `writeGroup`/`setSiteLicense`, bukan di sini — bentuknya saja yang
          // dibatasi. `licenses`: satu license key PER SUB (id -> key), karena tiap situs butuh
          // lisensinya sendiri. `licenseKey` (satu untuk semua) cuma cadangan untuk tab yang masih
          // memuat bundle lama selama deploy. `config`: peta grup pengaturan → nilainya, sama untuk
          // seluruh id (satu domain).
          licenses: t.Optional(
            t.Record(t.String({ pattern: "^[A-Za-z0-9_-]{1,64}$" }), t.String({ maxLength: 200 }), {
              maxProperties: 50,
            }),
          ),
          licenseKey: t.Optional(t.String({ maxLength: 200 })),
          config: t.Optional(
            t.Record(t.String({ maxLength: 32 }), t.Record(t.String(), t.Any()), {
              maxProperties: PLUGIN_GROUPS.length,
            }),
          ),
          // Langkah situs sesudah enroll. `menus` punya flag sendiri: ia harus PALING AKHIR, sesudah
          // AutoPost, bukan bagian dari Setting Sub yang destruktif. Kunci AI cuma lewat body ke
          // situs — tidak ditulis ke RTDB (baris `setup` terbaca tiap akun yang login).
          deployment: t.Optional(
            t.Array(
              t.Union(DEPLOYMENT_TASKS.filter((x) => x !== "menus").map((x) => t.Literal(x))),
              { maxItems: DEPLOYMENT_TASKS.length },
            ),
          ),
          legal: t.Optional(t.Boolean()),
          legalPages: t.Optional(
            t.Array(t.Union(LEGAL_PAGES.map((page) => t.Literal(page))), {
              maxItems: LEGAL_PAGES.length,
            }),
          ),
          // AutoPost PER SUB (tiap sub topiknya sendiri): kata dasar + jumlah untuk generator kata
          // kunci, atau teks satu kata kunci per baris (bentuk lama).
          autopost: t.Optional(
            t.Record(
              t.String({ pattern: "^[A-Za-z0-9_-]{1,64}$" }),
              t.Union([
                t.String({ maxLength: 20000 }),
                t.Object({
                  base: t.String({ maxLength: AUTOPOST_BASE_MAX }),
                  total: t.Integer({ minimum: 1, maximum: AUTOPOST_MAX_KEYWORDS }),
                  bahasa: t.Optional(t.String({ maxLength: 60 })),
                }),
              ]),
              { maxProperties: 50 },
            ),
          ),
          menus: t.Optional(t.Boolean()),
          // Setelan artikel AutoPost (AUTOPOST_FIELDS), sama untuk seluruh sub. Isinya divalidasi
          // `toAutopostPayload` di atas; field yang tidak dikirim jatuh ke AUTOPOST_DEFAULTS.
          autopostValues: t.Optional(t.Record(t.String({ maxLength: 40 }), t.Any())),
          // Kode iklan GPT dengan unit bawaan Ad Manager (sama dengan tab AdX); ukuran + jumlah slot
          // dikirim dashboard dari bawaannya, diperiksa `normalizeGptOptions` di atas.
          adCode: t.Optional(
            t.Object({
              sizes: t.String({ maxLength: 4000 }),
              slots: t.Integer({ minimum: 1, maximum: GPT_MAX_SLOTS }),
            }),
          ),
          // Kode AdSense PER SUB (Kode iklan 1…N), dipakai hanya untuk sub yang domainnya tanpa akun
          // GAM. Ditempel karena slot AdSense tidak bisa dibuat lewat API; diurai + dicocokkan
          // dengan ad unit akunnya oleh `injectAdsenseOne`, sama dengan tab AdSense.
          adsenseCodes: t.Optional(
            t.Record(
              t.String({ pattern: "^[A-Za-z0-9_-]{1,64}$" }),
              t.Array(t.String({ maxLength: 6000 }), { maxItems: GPT_MAX_SLOTS }),
              { maxProperties: 50 },
            ),
          ),
          // Landing dari preset, sesudah artikel AutoPost (preset mengisi URL artikel situs).
          landing: t.Optional(t.Boolean()),
          // Campaign Keitaro + gate dari tautan landing itu; hanya berarti bersama `landing`.
          keitaro: t.Optional(t.Boolean()),
          legalAiKey: t.Optional(t.String({ maxLength: 512 })),
          autopostAiKey: t.Optional(t.String({ maxLength: 512 })),
          aiKey: t.Optional(t.String({ maxLength: 512 })),
        }),
      },
    )
    .post(
      "/:id",
      async ({ params, actor }) => {
        const result = await enqueueMany([params.id], actor);
        if (!result.queued) return result;
        const [skip] = result.skipped;
        if (skip) return status(skip.code, { error: skip.error });
        return { ok: true, id: result.queued[0].id, host: result.queued[0].host };
      },
      {
        superadmin: true,
        params: t.Object({ id: t.String({ pattern: "^[A-Za-z0-9_-]{1,64}$" }) }),
      },
    );

  /**
   * Tandai tiap subdomain "queued" lalu masukkan ke antrean. Yang tidak bisa dijalankan (tidak ada,
   * masih berjalan) DISEBUT per baris, tidak menjatuhkan sisanya — sepola terapkan-massal /plugin.
   */
  async function enqueueMany(ids, actor, settings = {}) {
    if (!enrollToken) {
      return status(503, { error: "PLUGIN_ENROLL_TOKEN belum di-set di server kontrol." });
    }
    const queued = [];
    const skipped = [];
    for (const id of [...new Set(ids)]) {
      let site;
      try {
        site = await resolveSite(store, id);
      } catch (error) {
        skipped.push({ id, error: error.message, code: 404 });
        continue;
      }
      const previous = await store.read(`subDomains/${site.id}/setup`);
      const busy =
        running.has(site.id) ||
        (["running", "queued"].includes(previous?.state) &&
          Date.now() - Date.parse(previous.updatedAt || 0) < STALE_MS);
      if (busy) {
        skipped.push({
          id,
          host: site.name,
          error: `Setup ${site.name} masih berjalan.`,
          code: 409,
        });
        continue;
      }
      running.add(site.id);
      const now = new Date().toISOString();
      await store.replace(`subDomains/${site.id}/setup`, {
        state: "queued",
        step: "queued",
        startedAt: now,
        updatedAt: now,
        by: String(actor.email || actor.uid || ""),
      });
      // Tidak di-await: jawabannya datang lewat baris subdomain, bukan lewat request ini.
      const licenseKey = String(settings.licenses?.[id] || settings.licenseKey || "").trim();
      cloudPending += 1;
      queue = queue
        .then(() => run(site.id, site.name, actor, { ...settings, licenseKey }))
        .finally(() => {
          cloudPending -= 1;
        });
      queued.push({ id: site.id, host: site.name });
    }
    return { queued, skipped };
  }
}

/**
 * Record pengarah subdomain di Cloudflare. Dibuat HANYA kalau belum ada satu pun A/AAAA/CNAME untuk
 * nama itu; yang sudah ada tidak pernah diubah — mengarahkan ulang nama yang sedang hidup adalah
 * keputusan untuk tab DNS Record, bukan efek samping tombol ini.
 *
 * Servernya dibaca dari record zona yang SAMA (`pickServer`), jadi satu bacaan Cloudflare menjawab
 * keduanya. Tanpa token Cloudflare tidak ada server yang bisa dipilih sama sekali.
 */
export async function ensureDns({ host, token, account }) {
  if (!token)
    throw new Error("CLOUDFLARE_API_TOKEN kosong: server tujuan tidak bisa dibaca dari DNS.");
  const zone = zoneFor(await listZones(token, account), host);
  if (!zone) throw new Error(`Zona ${host} tidak ada di akun Cloudflare.`);
  const records = await listDnsRecords(token, zone.id);
  const ip = pickServer(records, zone.name);
  const action = dnsAction(records, host, ip);
  if (action === "create") {
    await createDnsRecord(token, zone.id, zone.name, {
      type: "A",
      name: host,
      content: ip,
      ttl: "",
      proxied: false,
    });
    return { ip, note: `A record ${host} -> ${ip} dibuat.` };
  }
  return {
    ip,
    note:
      action === "ok"
        ? `A record ${host} sudah mengarah ke ${ip}.`
        : `DNS ${host} sudah ada dan mengarah ke ${action} — tidak diubah.`,
  };
}

/**
 * Server = IP yang dituju A record DOMAIN INDUK (akar zona). Satu domain tinggal di satu server, jadi
 * apex adalah jawabannya — bukan mayoritas record zona, yang ikut tertarik record sisa ke server
 * lain. Tidak ada daftar server: tiap server berbagi user dan password yang sama, jadi IP-nya cukup.
 * Apex tanpa A record DITOLAK, bukan ditebak.
 */
export function pickServer(records, zoneName) {
  const apex = (records || []).find(
    (row) => row.type === "A" && row.name === zoneName && IPV4.test(row.content),
  );
  if (!apex) throw new Error(`${zoneName} belum punya A record — server tujuan tidak diketahui.`);
  return apex.content;
}

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

// Zona terpanjang yang menaungi host (a.b.example.com cocok dengan b.example.com sebelum example.com).
export function zoneFor(zones, host) {
  return (
    (zones || [])
      .filter((zone) => host === zone.name || host.endsWith(`.${zone.name}`))
      .sort((a, b) => b.name.length - a.name.length)[0] || null
  );
}

// "create" | "ok" | tujuan yang sudah ada (teks).
export function dnsAction(records, host, ip) {
  const pointing = (records || []).filter(
    (row) => row.name === host && ["A", "AAAA", "CNAME"].includes(row.type),
  );
  if (!pointing.length) return "create";
  if (pointing.some((row) => row.type === "A" && row.content === ip)) return "ok";
  return pointing.map((row) => `${row.type} ${row.content}`).join(", ");
}

/** Baris `RESULT {json}` terakhir dari keluaran skrip; tanpa baris itu = gagal, berikut ekor log. */
export function parseSetupResult(stdout, stderr = "", code = 0) {
  const line = String(stdout || "")
    .split("\n")
    .reverse()
    .find((row) => row.startsWith("RESULT "));
  if (code === 0 && line) return JSON.parse(line.slice("RESULT ".length));
  const error = String(stderr || "")
    .split("\n")
    .reverse()
    .find((row) => row.startsWith("ERROR "));
  const lines = String(stderr || stdout || "")
    .trim()
    .split("\n");
  // Stack trace PHP berakhir di "{main} thrown in phar://..."; yang menjelaskan sebabnya adalah
  // baris Fatal/Uncaught di atasnya, bukan tiga baris terakhirnya.
  const fatal = lines.find((row) => /fatal error|uncaught/i.test(row));
  const tail = [fatal, ...lines.slice(-2)].filter(Boolean).join(" ");
  throw new Error(
    error
      ? error.slice("ERROR ".length)
      : `Setup gagal (exit ${code}): ${tail || "tanpa keluaran"}`,
  );
}

// Sama persis dengan pola di rabbitroi-setup-sub.sh.
const HOST_PATTERN = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const EMAIL_PATTERN = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$/;

export const PLUGIN_REPO = process.env.PLUGIN_REPO || "tigerroi/rabbitroi-plugin";

/**
 * `rabbitroi.zip` dari rilis TERBARU — zip rilis, bukan arsip kode (repo-nya butuh `composer
 * install`). Dicermin di memori per asset id: tiap run cuma menanyakan rilis terbaru, dan 36 MB-nya
 * diunduh ulang hanya saat rilisnya berganti. Tanpa token = null, dan skrip di seberang jatuh ke
 * salinan dari situs lain di server itu.
 */
export function pluginZipFetcher(token, fetchImpl = fetch) {
  let cached = null; // { id, zip }
  return async () => {
    if (!token) return null;
    const headers = { authorization: `Bearer ${token}`, "x-github-api-version": "2022-11-28" };
    const api = `https://api.github.com/repos/${PLUGIN_REPO}/releases/latest`;
    const release = await fetchImpl(api, { headers });
    if (!release.ok)
      throw new Error(`Rilis plugin di GitHub tidak terbaca (HTTP ${release.status}).`);
    const asset = ((await release.json()).assets || []).find((row) => row.name === "rabbitroi.zip");
    if (!asset) throw new Error("Rilis terbaru plugin tidak memuat rabbitroi.zip.");
    if (cached?.id === asset.id) return cached.zip;
    const file = await fetchImpl(asset.url, {
      headers: { ...headers, accept: "application/octet-stream" },
    });
    if (!file.ok) throw new Error(`Unduhan rabbitroi.zip gagal (HTTP ${file.status}).`);
    cached = { id: asset.id, zip: Buffer.from(await file.arrayBuffer()) };
    return cached.zip;
  };
}

// Satu proses ssh; `input` ke stdin (SELALU ditutup, supaya pembaca di seberang tidak menggantung).
function sshExec(args, { input, env } = {}) {
  return new Promise((resolve) => {
    const child = spawn("ssh", args, env ? { env: { ...process.env, ...env } } : undefined);
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => (err += chunk));
    child.stdin.on("error", () => {}); // skrip yang mati duluan: sebabnya ada di stderr/exit.
    const timer = setTimeout(() => child.kill("SIGTERM"), SETUP_TIMEOUT_MS);
    child.on("close", (exit) => {
      clearTimeout(timer);
      resolve({ stdout: out, stderr: err, code: exit ?? 1 });
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ stdout: out, stderr: String(error.message), code: 1 });
    });
    child.stdin.end(input || undefined);
  });
}

// Kunci ditolak = server belum pernah di-bootstrap (exit 255 milik ssh sendiri, bukan skripnya).
export const keyRejected = ({ code, stderr }) =>
  code === 255 && /Permission denied/.test(String(stderr || ""));

// Skrip di server lebih lama dari yang dibawa server kontrol (exit 3 milik skrip, lihat
// EXPECTED_SHA di rabbitroi-setup-sub.sh). Skrip yang terlalu lama untuk mengenal argumen ketiga
// tidak pernah menjawab ini — server seperti itu diperbarui sekali lewat bootstrap manual.
export const scriptOutdated = ({ code, stdout }) =>
  code === 3 && /^OUTDATED /m.test(String(stdout || ""));

// Bentuk berkas PERSIS seperti yang ditulis heredoc `bootstrapScript` (satu \n di ujung), supaya
// sidiknya sama dengan `sha256sum` di server.
const installedForm = (body) => `${body.replace(/\n$/, "")}\n`;

const CLOUDPANEL_DIR = new URL("./cloudpanel/", import.meta.url);

/** sha256 skrip setup sebagaimana terpasang di server CloudPanel. */
export function setupScriptSha(
  body = readFileSync(new URL("rabbitroi-setup-sub.sh", CLOUDPANEL_DIR), "utf8"),
) {
  return createHash("sha256").update(installedForm(body)).digest("hex");
}
const BOOTSTRAP_FILES = ["rabbitroi-setup-sub.sh", "rabbitroi-setup-sub-ssh.sh", "bootstrap.sh"];

/**
 * Skrip `bash -s` yang menulis ketiga berkas ke /tmp/rabbitroi-bootstrap lalu menjalankan
 * bootstrap.sh — padanan bootstrap-remote.sh, tanpa scp dan tanpa mesin admin di tengahnya.
 */
export function bootstrapScript(files, pubKey) {
  // Komentar boleh berspasi ("rabbit-control setup-sub"); kutip tidak — nilainya masuk kutip tunggal.
  if (!/^ssh-ed25519 [A-Za-z0-9+/=]+( [\w@. -]+)?$/.test(pubKey))
    throw new Error("Kunci publik Setup Sub (.pub) tidak sah.");
  const lines = ["set -euo pipefail", "mkdir -p /tmp/rabbitroi-bootstrap"];
  for (const [name, body] of Object.entries(files)) {
    if (body.includes("\nRABBITROI_EOF\n")) throw new Error(`${name} memuat penanda heredoc.`);
    lines.push(
      `cat > /tmp/rabbitroi-bootstrap/${name} <<'RABBITROI_EOF'`,
      installedForm(body).slice(0, -1),
      "RABBITROI_EOF",
    );
  }
  lines.push(`bash /tmp/rabbitroi-bootstrap/bootstrap.sh '${pubKey}'`);
  return `${lines.join("\n")}\n`;
}

/**
 * Login bersamanya boleh bukan root (armada ini: `rabbitroi` + password, ber-sudo). Maka naik lewat
 * `sudo -S`, yang membaca password dari BARIS PERTAMA stdin — sisanya dibaca `bash -s` sebagai
 * skripnya. Password tidak pernah masuk argumen perintah.
 */
export function bootstrapCommand(user, password, script) {
  if (user === "root") return { command: "bash -s", input: script };
  return { command: "sudo -S -p '' bash -s", input: `${password}\n${script}` };
}

/**
 * Siapkan server baru lewat login root bersama: user `rabbitroi`, forced command, sudoers — persis
 * bootstrap.sh. Password lewat SSH_ASKPASS (OpenSSH >= 8.4), tidak pernah di argumen proses.
 *
 * ponytail: password dikirim ke IP apex apa pun yang ada di zona Cloudflare kita. Zona yang apex-nya
 * menunjuk hosting orang lain akan menerima password root armada; tambah daftar izin CIDR kalau
 * zona pihak ketiga pernah masuk akun Cloudflare ini.
 */
export async function bootstrapServer({ ip, user, password, sshKey, exec = sshExec }) {
  if (!password)
    throw new Error(
      `Server ${ip} menolak kunci Setup Sub dan SETUP_SUB_ROOT_PASSWORD kosong — jalankan bootstrap-remote.sh ${ip}.`,
    );
  if (!sshKey) throw new Error("SETUP_SUB_SSH_KEY kosong: kunci publik untuk bootstrap tidak ada.");
  const files = Object.fromEntries(
    BOOTSTRAP_FILES.map((name) => [name, readFileSync(new URL(name, CLOUDPANEL_DIR), "utf8")]),
  );
  const script = bootstrapScript(files, readFileSync(`${sshKey}.pub`, "utf8").trim());
  const run = bootstrapCommand(user, password, script);
  const askpass = join(dirname(sshKey), "askpass.sh");
  writeFileSync(askpass, "#!/bin/sh\nprintf '%s\\n' \"$RABBITROI_ROOT_PASSWORD\"\n", {
    mode: 0o700,
  });
  const result = await exec(
    [
      "-o",
      "StrictHostKeyChecking=accept-new",
      "-o",
      `UserKnownHostsFile=${dirname(sshKey)}/known_hosts`,
      "-o",
      "PubkeyAuthentication=no",
      "-o",
      "PreferredAuthentications=password,keyboard-interactive",
      "-o",
      "NumberOfPasswordPrompts=1",
      "-o",
      "ConnectTimeout=15",
      `${user}@${ip}`,
      run.command,
    ],
    {
      input: run.input,
      env: {
        SSH_ASKPASS: askpass,
        SSH_ASKPASS_REQUIRE: "force",
        RABBITROI_ROOT_PASSWORD: password,
      },
    },
  );
  if (result.code !== 0) {
    const tail = String(result.stderr || result.stdout)
      .trim()
      .split("\n")
      .slice(-3)
      .join(" ");
    throw new Error(
      `Bootstrap server ${ip} gagal (exit ${result.code}): ${tail || "tanpa keluaran"}`,
    );
  }
}

/**
 * Dua baris di depan zip pada stdin: username dan password admin WordPress. Kosong keduanya berarti
 * skrip memakai "rabbitroi" + password acak. Baris baru di dalamnya akan menggeser zip, jadi ditolak.
 */
export function wpAdminHeader({ user = "", password = "" } = {}) {
  if (user && !/^[A-Za-z0-9._-]{1,60}$/.test(user))
    throw new Error("SETUP_SUB_WP_ADMIN_USER tidak sah (huruf, angka, titik, garis).");
  if (/[\r\n]/.test(password)) throw new Error("SETUP_SUB_WP_ADMIN_PASSWORD memuat baris baru.");
  return Buffer.from(`${user}\n${user ? password : ""}\n`);
}

function sshRunner({ sshUser, sshKey, bootstrapUser, bootstrapPassword, wpAdmin, pluginZip }) {
  return async (host, email, ip) => {
    // Diperiksa di sini JUGA: kalau forced command di seberang lupa dipasang, string ini jatuh ke
    // shell root-less `rabbitroi` apa adanya.
    if (!HOST_PATTERN.test(host)) throw new Error(`Nama host tidak sah untuk setup: ${host}`);
    if (!EMAIL_PATTERN.test(email || ""))
      throw new Error("Email akun ini tidak bisa dipakai sebagai email admin WordPress.");
    if (!IPV4.test(ip || "")) throw new Error(`IP server tidak sah: ${ip}`);
    const zip = await pluginZip();
    const input = Buffer.concat([wpAdminHeader(wpAdmin), zip || Buffer.alloc(0)]);
    const args = ["-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new"];
    // known_hosts di SEBELAH kuncinya: unit systemd memasang ProtectHome=true, jadi ~/.ssh tidak
    // terlihat sama sekali dan satu-satunya tempat yang bisa ditulis adalah /opt/rabbitroi-control.
    if (sshKey) args.push("-i", sshKey, "-o", `UserKnownHostsFile=${dirname(sshKey)}/known_hosts`);
    // Argumen dikirim sebagai SATU string perintah (begitulah SSH bekerja); di seberang ia jadi
    // SSH_ORIGINAL_COMMAND dan diperiksa ketat oleh skripnya. `host` datang dari RTDB, `email` dari
    // token yang terverifikasi. Zip plugin lewat stdin (kosong = tanpa zip), dan skripnya SELALU
    // menghabiskan stdin — jadi tulisan ini tidak pernah patah di tengah.
    // Sidik ikut tiap run: server yang skripnya lama menjawab OUTDATED, dipasang ulang lewat
    // bootstrap (jalur password), lalu run-nya diulang — tanpa membuat kunci ini bisa menjalankan
    // kode kiriman. ponytail: yang diadu cuma skrip setup; ubahan di pembungkus ssh atau
    // bootstrap.sh saja tidak memicu pemasangan ulang.
    const sha = setupScriptSha();
    const call = () => sshExec([...args, `${sshUser}@${ip}`, `${host} ${email} ${sha}`], { input });
    let result = await call();
    let bootstrapped = false;
    if (keyRejected(result) || scriptOutdated(result)) {
      await bootstrapServer({ ip, user: bootstrapUser, password: bootstrapPassword, sshKey });
      bootstrapped = true;
      result = await call();
    }
    return { ...parseSetupResult(result.stdout, result.stderr, result.code), bootstrapped };
  };
}

/** Isian AutoPost satu sub -> `{ base, total }`, `{ keywords }`, atau null (tidak ada yang dikirim). */
export function autopostSpec(value) {
  if (value && typeof value === "object") {
    const base = String(value.base || "").trim();
    const bahasa = String(value.bahasa || "").trim();
    return base
      ? {
          base,
          total: Math.min(Number(value.total) || 1, AUTOPOST_MAX_KEYWORDS),
          ...(bahasa ? { bahasa } : {}),
        }
      : null;
  }
  const keywords = autopostKeywords(value);
  return keywords.length ? { keywords } : null;
}
