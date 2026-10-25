import { Elysia, status, t } from "elysia";
import { discoverDomains, discoverSubdomains } from "../functions/discover-sites.mjs";
import { discoverAdsenseAccounts } from "../functions/sync-adsense.mjs";
import { discoverNetworks } from "../functions/sync-gam.mjs";
import { AuthError, bearerToken, requireAdmin } from "./auth.js";

/**
 * "Impor dari Google" — jalur yang benar-benar bisa dipanggil browser.
 *
 * Empat tombol di dashboard (`/gam-accounts`, `/adsense-accounts`, `/domains`, `/sub-domains`)
 * selama ini memanggil callable `importGamNetworks` dan kawan-kawan, dan di bawah DRS itu berarti
 * tidak memanggil apa pun: `allUsers` diblokir, jadi tombolnya disembunyikan `FUNCTIONS_ENABLED`
 * dan satu-satunya jalur yang tersisa adalah CLI di `functions/`. Sebuah domain baru karena itu
 * butuh empat perintah di terminal orang yang kebetulan punya `.env.sync`.
 *
 * Server ini tidak lewat `allUsers` sama sekali — ia memverifikasi ID token Firebase sendiri
 * (lihat auth.js) — jadi tombolnya kembali hidup tanpa DRS perlu dilonggarkan.
 *
 * LOGIKANYA TIDAK DIDUPLIKASI. Yang dipanggil di bawah adalah fungsi yang SAMA dengan yang
 * dipanggil CLI (`npm run import:networks`, `npm run discover:domains`, …), sepola dengan
 * `applyOneCampaignCommand` di campaigns.js: menekan tombol tidak boleh menghasilkan baris yang
 * berbeda dari menjalankan CLI-nya.
 */

/**
 * Kunci di sini SAMA PERSIS dengan kunci koleksi di `src/config/resources.js` dan
 * `DISCOVER_CALLABLE` di `src/hooks/useFirebaseStore.js` — halaman mengirimkan kunci resource-nya
 * apa adanya. Beda satu huruf (`subdomains` vs `subDomains`), tombolnya menjawab 422 untuk
 * halaman yang jelas-jelas terdaftar.
 */
export const DISCOVER_RUNNERS = {
  gamAccounts: (db, actor) => discoverNetworks(db, actor),
  adsenseAccounts: (db, actor) => discoverAdsenseAccounts(db, actor),
  // Dimensi laporan boleh ditimpa per-deploy, sama seperti di CLI: sebuah network yang inventarisnya
  // tidak tersusun per site tidak akan mengembalikan hostname apa pun lewat `SITE`.
  domains: (db, actor) => discoverDomains(db, actor, process.env.GAM_DISCOVER_DIMENSION),
  subDomains: (db, actor) => discoverSubdomains(db, actor, process.env.GAM_DISCOVER_DIMENSION),
};

export const DISCOVER_KINDS = Object.keys(DISCOVER_RUNNERS);

/**
 * Hasil impor tinggal di RTDB, bukan di badan jawaban HTTP — dan itu bukan pilihan gaya.
 *
 * Impor domain memakan ~53 detik (delapan network GAM, masing-masing beberapa panggilan), dan yang
 * berdiri di depan server ini adalah Cloudflare, yang memutus request yang belum menjawab dalam
 * 100 detik dengan 524. Sebelum itu, Bun sendiri sudah menutup koneksi yang diam 10 detik
 * (`idleTimeout` bawaan) — itulah 502 pertama yang terlihat di layar.
 *
 * Kedua batas itu tidak bisa dinaikkan cukup jauh untuk dijamin: satu network yang daftar site-nya
 * kosong membuat impor jatuh ke laporan GAM yang di-poll sampai satu menit, dan tiga di antaranya
 * sudah melewati 100 detik. Jadi jawabannya dibalik: HTTP menjawab SEGERA bahwa impornya mulai,
 * dan yang membawa hasilnya adalah node di bawah — yang dilanggan halaman, dan yang tetap terisi
 * walau tab-nya sudah ditutup.
 */
export const DISCOVER_RUNS_PATH = "dashboard/discoverRuns";

/**
 * Baris hasil yang ditulis ke RTDB. `JSON.parse(JSON.stringify(...))` bukan kerapian: RTDB menolak
 * `undefined` di mana pun di dalam objek, dan satu field yang tidak terisi akan menggagalkan
 * penulisan SELURUH hasilnya — impor yang sebenarnya berhasil lalu tidak pernah mengabarkan apa pun.
 */
export function discoverRunRecord(record) {
  return JSON.parse(JSON.stringify(record));
}

export function discoverRoutes({ db, store, authorize, runners = DISCOVER_RUNNERS }) {
  const check = authorize || ((token) => requireAdmin(db, token));

  /**
   * SATU kunci untuk keempat jenis, bukan satu per jenis.
   *
   * Bukan sekadar penjaga duplikat (dua klik pada tombol yang sama akan membuat dua baris untuk
   * domain yang sama: keduanya membaca daftar "yang sudah ada" sebelum yang lain menulis). Keempat
   * impor menembak kuota Google yang sama, dan yang dua di antaranya menjalankan laporan GAM yang
   * di-poll sampai satu menit per network — dijalankan berbarengan, keduanya melambat dan tidak
   * ada yang selesai lebih cepat.
   *
   * Sepola dengan `running` di index.js, dan alasannya sama: `maxInstances: 1` milik Cloud
   * Functions tidak ada di sini, jadi penjaganya harus ditulis sendiri.
   */
  let busy = "";

  return new Elysia({ prefix: "/discover" })
    .macro({
      /**
       * ADMIN, bukan superadmin — cerminan `.write` pada `domains`, `subDomains`, `gamAccounts`,
       * dan `adsenseAccounts` di database.rules.json, dan `canWrite` di src/config/access.js.
       * Gerbang yang lebih tinggi di sini akan menolak orang yang aturan databasenya justru
       * mengizinkan menulis baris yang sama lewat form Tambah di halaman yang sama.
       */
      admin: {
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
      "/:kind",
      async ({ params, actor }) => {
        if (busy) {
          // 409 dan bukan 429: yang menolak bukan batas laju melainkan satu impor yang sedang
          // jalan, dan menyebut jenisnya membuat jelas bahwa yang menahan bisa jadi tab orang lain.
          return status(409, {
            error: `Impor "${busy}" sedang berjalan. Tunggu sampai selesai, lalu coba lagi.`,
          });
        }
        const kind = params.kind;
        /**
         * `actor` = email penekan tombolnya, dan itu yang tersimpan di `createdBy` baris baru —
         * sama seperti baris yang dibuat lewat form. Lewat CLI yang tercatat "import-cli", dan
         * baris yang tidak bisa ditelusuri ke siapa pun adalah baris yang tidak ada yang berani
         * hapus.
         */
        const who = actor.email || actor.uid;
        const startedAt = new Date().toISOString();
        const path = `${DISCOVER_RUNS_PATH}/${kind}`;

        // Ditulis SEBELUM jawaban dikirim: halaman melanggan node ini begitu jawabannya sampai, dan
        // node yang belum ada saat itu terbaca sebagai "tidak ada impor yang jalan".
        try {
          await store.replace(
            path,
            discoverRunRecord({ kind, state: "running", startedAt, actor: who }),
          );
        } catch (error) {
          // RTDB tak terjangkau berarti impornya pun tidak akan bisa menulis apa-apa.
          return status(503, { error: `Status impor gagal ditulis: ${error.message}` });
        }

        busy = kind;
        // SENGAJA tidak di-await. Yang ditunggu pemanggil cuma tanda bahwa impornya berangkat.
        (async () => {
          try {
            const result = await runners[kind](db, who);
            await store.replace(
              path,
              // Hasil impornya DULU, identitas run-nya sesudah: yang menyebut impor mana yang jalan
              // adalah route, dan sebuah field bernama sama di hasil tidak boleh menggantinya.
              discoverRunRecord({
                ...result,
                kind,
                state: "done",
                startedAt,
                actor: who,
                finishedAt: new Date().toISOString(),
              }),
            );
          } catch (error) {
            await store
              .replace(
                path,
                discoverRunRecord({
                  kind,
                  state: "failed",
                  startedAt,
                  actor: who,
                  error: error.message,
                  // Prasyarat yang belum terpenuhi (belum ada kredensial terhubung, belum ada
                  // network) BUKAN kegagalan server: yang harus dilakukan orangnya ada di halaman
                  // lain, bukan mencoba lagi. Lihat `preconditionError` di discover-core.js.
                  precondition: Boolean(error?.precondition),
                  finishedAt: new Date().toISOString(),
                }),
              )
              // Kegagalan menulis kegagalan tidak boleh menjatuhkan proses: tanpa pemanggil yang
              // menunggu, sebuah promise yang menolak di sini adalah unhandled rejection.
              .catch((writeError) => {
                console.error(`[discover] ${kind} gagal dicatat: ${writeError.message}`);
              });
            console.error(`[discover] ${kind} gagal: ${error.message}`);
          } finally {
            busy = "";
          }
        })();

        // 202: diterima, belum selesai. 200 di sini akan terbaca sebagai "impornya sudah beres"
        // oleh siapa pun yang membaca kodenya saja.
        return status(202, { kind, state: "running", startedAt });
      },
      {
        admin: true,
        params: t.Object({ kind: t.Union(DISCOVER_KINDS.map((kind) => t.Literal(kind))) }),
      },
    );
}
