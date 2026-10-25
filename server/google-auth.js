import { Elysia, redirect, status, t } from "elysia";
import {
  authStateEntry,
  authStateProblem,
  authStateValue,
  credentialAuthResult,
  parseAuthState,
} from "../functions/google-oauth-core.js";
import { consentUrlFor, exchangeCode } from "../functions/oauth.mjs";
import { AuthError, bearerToken, requireAdmin } from "./auth.js";

/**
 * Tombol Login/Reconnect di /google-api-configs — consent Google tanpa terminal.
 *
 * Sebelum ini consent hanya bisa dijalankan dua cara, dan keduanya tidak terpakai:
 *
 *   1. `functions/index.js` → `oauth` (gen1 onRequest). Jalur browser → Cloud Function, yang di
 *      bawah DRS tidak pernah bisa dipanggil sama sekali. Tombolnya disembunyikan
 *      (`VITE_FUNCTIONS_ENABLED=false`) justru supaya tidak ada yang menekan tombol yang pasti gagal.
 *   2. `npm run authorize -- "<nama>"` di functions/, yang menangkap redirect di localhost:4571 —
 *      artinya harus di laptop orang yang punya repo ini.
 *
 * Server ini tidak lewat `allUsers`: ia memeriksa ID token Firebase-nya sendiri, jadi DRS tidak
 * menyentuhnya. Yang dijalankannya adalah consent yang SAMA — scope yang sama dari
 * `google-oauth-core.js`, `prompt` yang sama, dan token yang mendarat di record yang sama.
 *
 * DUA HAL YANG BERBEDA DARI GATING DAN PLUGIN, dan keduanya lahir dari satu kenyataan: callback
 * Google datang sebagai GET biasa dari browser, tanpa header Authorization.
 *
 *   - **Izinnya diperiksa di awal, bukan di callback.** Yang menjaga callback adalah `state` sekali
 *     pakai yang disimpan di record kredensialnya (admin-only di RTDB), bukan role — di titik itu
 *     tidak ada identitas apa pun untuk diperiksa.
 *   - **Callback selalu menjawab redirect, tidak pernah JSON.** Yang membacanya adalah orang di
 *     depan browser yang baru kembali dari layar consent Google, bukan `fetch`.
 *
 * ADMIN, bukan superadmin. Cerminan `.write` pada `googleApiConfigs` di database.rules.json dan
 * `ADMIN_ONLY_RESOURCES` di src/config/access.js — halaman ini memang halaman admin. Gerbang
 * superadmin di sini akan menolak orang yang aturan databasenya justru mengizinkan.
 */
export function googleAuthRoutes({ db, store, publicUrl, appUrl, authorize, exchange }) {
  const check = authorize || ((token) => requireAdmin(db, token));
  const swap = exchange || exchangeCode;
  const callbackUrl = publicUrl ? `${String(publicUrl).replace(/\/+$/, "")}/google/callback` : "";
  const appBase = String(appUrl || "").replace(/\/+$/, "");

  /**
   * Kembali ke halaman kredensial dengan hasilnya di query.
   *
   * Selalu ke `/google-api-configs`, tidak pernah ke alamat yang datang dari request: sebuah
   * redirect yang tujuannya bisa ditentukan pemanggil adalah open redirect, dan yang ini berdiri di
   * ujung alur OAuth — tempat orang paling siap mempercayai halaman mana pun yang muncul.
   */
  function backToApp(outcome, extra = {}) {
    const params = new URLSearchParams({ googleAuth: outcome });
    for (const [key, value] of Object.entries(extra)) {
      if (value) params.set(key, String(value));
    }
    return redirect(`${appBase}/google-api-configs?${params}`, 302);
  }

  // `code` ikut dikembalikan karena dua kegagalan ini berujung ke tempat berbeda: yang tidak ada
  // sudah tidak bisa diperbaiki dari halaman itu (404), yang belum lengkap diperbaiki di formnya
  // sendiri (422).
  async function loadConfig(configId) {
    const cfg = await store.read(`googleApiConfigs/${configId}`);
    if (!cfg || cfg.deletedAt) {
      return { code: 404, error: "Kredensial ini tidak ada (atau sudah diarsipkan)." };
    }
    if (!cfg.clientId || !cfg.clientSecret) {
      return { code: 422, error: "Client ID / Client Secret belum diisi pada kredensial ini." };
    }
    return { cfg };
  }

  return (
    new Elysia({ prefix: "/google" })
      .macro({
        admin: {
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
       * Langkah 1: URL consent untuk satu kredensial. Halaman yang mengarahkan browsernya ke sana.
       *
       * POST walau yang diminta terasa seperti bacaan: ia MENULIS `authState` ke record — sebuah
       * percobaan consent yang tercatat, sekali pakai. GET yang menulis adalah GET yang akan diulang
       * browser, tombol back, atau prefetch tanpa diminta, dan tiap pengulangan membatalkan diam-diam
       * percobaan yang sedang berjalan di tab sebelah.
       */
      .post(
        "/configs/:configId/consent",
        async ({ params, actor }) => {
          if (!callbackUrl) {
            // 503 dan bukan 500: yang kurang adalah konfigurasi host, bukan request orangnya.
            return status(503, {
              error:
                "CONTROL_PUBLIC_URL belum di-set di server, jadi alamat callback OAuth tidak bisa dibentuk.",
            });
          }

          const { cfg, error, code } = await loadConfig(params.configId);
          if (error) return status(code, { error });

          const secret = crypto.randomUUID().replaceAll("-", "");
          // Ditulis DULU, baru URL-nya diberikan. Dibalik, ada jendela di mana orangnya sudah di
          // layar Google sementara callback-nya tidak akan pernah dikenali.
          await store.update(`googleApiConfigs/${params.configId}`, {
            authState: authStateEntry(secret, actor.email || actor.uid),
          });

          return {
            url: consentUrlFor(cfg, callbackUrl, authStateValue(params.configId, secret)),
            callbackUrl,
          };
        },
        { admin: true, params: t.Object({ configId: t.String({ minLength: 1 }) }) },
      )

      /**
       * Langkah 2: Google mengembalikan orangnya ke sini.
       *
       * Tanpa gerbang auth, dan itu bukan kelalaian — request ini datang dari redirect browser, yang
       * tidak bisa membawa header apa pun. Yang menjaganya `state`: sekali pakai, berumur pendek,
       * dan dibandingkan dengan yang tersimpan di record kredensial (yang hanya admin bisa tulis).
       */
      .get(
        "/callback",
        async ({ query }) => {
          // Orangnya menekan "Batal" di layar Google. Bukan kegagalan sistem, dan tidak ada yang
          // perlu ditulis ke mana pun.
          if (query.error) return backToApp("denied");

          const parsed = parseAuthState(query.state);
          if (!parsed) return backToApp("failed", { msg: "Balasan Google tidak membawa state." });

          const { cfg, error } = await loadConfig(parsed.configId);
          if (error) return backToApp("failed", { msg: error });

          const problem = authStateProblem(cfg.authState, parsed.secret);
          if (problem) return backToApp("failed", { name: cfg.name, msg: problem });

          // Dihapus SEBELUM code-nya ditukar, bukan sesudah: sebuah `state` yang masih sah setelah
          // dipakai adalah tautan yang — kalau bocor dari riwayat browser atau dari log proxy —
          // memasang kredensial Google milik siapa pun ke record ini. Kalau penukarannya gagal,
          // yang hilang cuma satu klik.
          await store.update(`googleApiConfigs/${parsed.configId}`, { authState: null });

          if (!query.code) {
            return backToApp("failed", {
              name: cfg.name,
              msg: "Google tidak mengirim authorization code.",
            });
          }

          let tokens;
          try {
            tokens = await swap(cfg, callbackUrl, query.code);
          } catch (err) {
            return backToApp("failed", { name: cfg.name, msg: err.message });
          }

          const result = credentialAuthResult(tokens);
          if (!result.update)
            return backToApp(result.outcome, { name: cfg.name, msg: result.message });

          await store.update(`googleApiConfigs/${parsed.configId}`, result.update);
          return backToApp(result.outcome, { name: cfg.name, msg: result.message });
        },
        {
          // Semua opsional: yang menentukan jalannya adalah ADA tidaknya tiap field, dan sebuah 422
          // di sini berupa JSON mentah untuk orang yang sedang menunggu halaman kembali.
          query: t.Object(
            {
              code: t.Optional(t.String()),
              state: t.Optional(t.String()),
              error: t.Optional(t.String()),
              scope: t.Optional(t.String()),
            },
            { additionalProperties: true },
          ),
        },
      )
  );
}
