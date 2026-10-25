import { Elysia, status, t } from "elysia";
import { GATING_PATH, gateCommandEntry, gatePreviewRow } from "../functions/gating-core.js";
import { listCampaigns, previewCampaign } from "../functions/keitaro-gate.js";
import { applyOneGateCommand, refreshGateMirror, syncGating } from "../functions/sync-gating.mjs";
import { AuthError, bearerToken, requireSuperAdmin } from "./auth.js";

/**
 * Endpoint gating. Semuanya superadmin, tidak ada pengecualian.
 *
 * Yang membuat server ini ada: browser tidak boleh memegang API key vi-control (ia mengubah tujuan
 * trafik iklan yang hidup), dan tanpa perantara satu-satunya jalur yang tersisa adalah antrean RTDB
 * — yang berarti operator menunggu sampai dua menit untuk melihat hasil satu klik, dan pratinjau
 * yang dibacanya bisa berumur sepuluh menit.
 *
 * Logikanya TIDAK diduplikasi di sini. Tiap route memanggil modul yang sama yang dipakai cron
 * (`functions/sync-gating.mjs`), jadi menekan tombol dan menunggu cron tidak bisa menghasilkan
 * keputusan yang berbeda — termasuk penjaga gate-ganda.
 */

// Daftar campaign dibaca ulang tiap request akan berarti ~3 detik per pemuatan halaman (vi-control
// membaca stream tiap campaign satu per satu). Cache pendek: cukup untuk satu orang membuka halaman
// dan menyaringnya, terlalu pendek untuk menyembunyikan perubahan dari siapa pun.
//
// Gate/ungate TIDAK memakai cache ini — lihat `applyOneGateCommand`, yang selalu membaca segar.
const LIST_TTL_MS = Number(process.env.GATE_LIST_CACHE_MS || 15_000);

function campaignCache() {
  let value = null;
  let at = 0;
  let inflight = null;

  return async (apiKey, force = false) => {
    if (!force && value && Date.now() - at < LIST_TTL_MS) {
      return { campaigns: value, cached: true };
    }
    // Satu pembacaan pada satu waktu. Tanpa ini, tiga orang membuka halaman bersamaan berarti tiga
    // kali 55 pembacaan stream di sisi Keitaro untuk jawaban yang identik.
    if (!inflight) {
      inflight = listCampaigns(apiKey)
        .then((list) => {
          value = list;
          at = Date.now();
          return list;
        })
        .finally(() => {
          inflight = null;
        });
    }
    return { campaigns: await inflight, cached: false };
  };
}

/**
 * `authorize` bisa dioper untuk diuji tanpa jaringan — bawaannya memverifikasi ID token sungguhan.
 *
 * Satu-satunya jahitan injeksi di file ini, dan ia ada karena alternatifnya adalah tidak menguji
 * gerbang auth sama sekali: verifikasi bawaannya mengambil kunci publik Google lalu membaca
 * `/roles/{uid}` dari RTDB, dua hal yang tidak boleh dibutuhkan sebuah unit test.
 */
export function gatingRoutes({ db, apiKey, store, authorize }) {
  const readCampaigns = campaignCache();
  const check = authorize || ((token) => requireSuperAdmin(db, token));

  return (
    new Elysia({ prefix: "/gating" })
      /**
       * Gerbang auth untuk seluruh route di bawah, lewat macro `resolve`.
       *
       * `status(...)` dikembalikan, bukan dilempar — itu cara Elysia menghasilkan respons dari
       * dalam lifecycle. Dilempar, ia jadi 500 dan pesannya hilang dari sisi browser.
       */
      .macro({
        superadmin: {
          async resolve({ headers }) {
            try {
              const actor = await check(bearerToken(headers.authorization));
              return { actor };
            } catch (error) {
              if (error instanceof AuthError) {
                return status(error.status, { error: error.message });
              }
              // Bukan penolakan, melainkan pemeriksaannya sendiri yang gagal (RTDB tak terjangkau,
              // JWK tak bisa diambil). Dijawab 401, orang akan mengira haknya dicabut.
              return status(503, {
                error: `Izin tidak bisa diperiksa sekarang: ${error.message}`,
              });
            }
          },
        },
      })

      // Daftar campaign berikut status gating-nya. Aman di-polling.
      .get(
        "/campaigns",
        async ({ query }) => {
          const { campaigns, cached } = await readCampaigns(apiKey, query.fresh === "1");
          return { campaigns, cached };
        },
        { superadmin: true, query: t.Object({ fresh: t.Optional(t.String()) }) },
      )

      /**
       * Pratinjau, SEGAR — ini alasan utama server ini dibangun.
       *
       * Lewat antrean RTDB, yang bisa ditampilkan dialog konfirmasi hanyalah pratinjau yang diambil
       * cron sampai sepuluh menit lalu. Di sini ia diambil pada saat dialognya dibuka, jadi
       * `current → willSet` yang dibaca operator adalah keadaan Keitaro sekarang.
       */
      .get(
        "/campaigns/:id/preview",
        async ({ params }) => {
          try {
            const preview = await previewCampaign(params.id, apiKey);
            // Diratakan lewat `gatePreviewRow` — fungsi yang sama yang menulis cermin ke RTDB. Jadi
            // yang diterima browser dari sini berbentuk IDENTIK dengan baris cermin, cuma lebih
            // segar, dan sisi UI tidak perlu menyimpan salinan ketiga dari bentuk itu (yang akan
            // jadi tempat ketiga yang harus diubah tiap kali API-nya menambah field).
            return gatePreviewRow(params.id, preview);
          } catch (error) {
            return status(502, { error: error.message });
          }
        },
        { superadmin: true, params: t.Object({ id: t.Number({ minimum: 1 }) }) },
      )

      .post("/campaigns/:id/gate", ({ params, actor }) => runGate(params.id, "gate", actor), {
        superadmin: true,
        params: t.Object({ id: t.Number({ minimum: 1 }) }),
      })

      .post("/campaigns/:id/ungate", ({ params, actor }) => runGate(params.id, "ungate", actor), {
        superadmin: true,
        params: t.Object({ id: t.Number({ minimum: 1 }) }),
      })

      // Paksa cermin RTDB dibaca ulang sekarang. Dipakai tombol "Segarkan".
      .post(
        "/refresh",
        async () => {
          try {
            const res = await refreshGateMirror(store, apiKey);
            return { ok: true, ...res };
          } catch (error) {
            return status(502, { error: error.message });
          }
        },
        { superadmin: true },
      )

      // Satu siklus penuh (antrean + cermin) atas permintaan — jalur yang sama dengan cron. Ada
      // untuk memeriksa kesehatan setelah deploy tanpa menunggu dua menit.
      .post(
        "/sync",
        async () => {
          const res = await syncGating(store, apiKey);
          return {
            pending: res.pending,
            applied: res.applied,
            failed: res.failed,
            refreshed: res.refreshed,
            issues: res.issues.length,
          };
        },
        { superadmin: true },
      )
  );

  /**
   * Jalankan satu gate/ungate sekarang.
   *
   * SELALU 200, dan yang menentukan hasilnya field `status` — kosakata yang sama persis dengan
   * vi-control (`ok` / `aborted` / `problem`), diteruskan apa adanya. Memetakannya ke kode HTTP
   * akan meleburkan `aborted` (ditolak, tidak ada yang ditulis) dengan `problem` (TERSIMPAN tapi
   * verifikasinya gagal) jadi satu "4xx/5xx" — dan bedanya justru satu-satunya yang menentukan
   * apakah seseorang harus membuka Keitaro.
   */
  async function runGate(campaignId, action, actor) {
    let entry;
    try {
      entry = gateCommandEntry({ campaignId }, action, actor.email || actor.uid);
    } catch (error) {
      return status(422, { error: error.message });
    }

    try {
      const res = await applyOneGateCommand(store, apiKey, entry);
      return {
        status: res.status,
        error: res.error || res.result?.plan?.blockers?.join("; ") || "",
        runId: res.result?.runId || "",
        verification: res.result?.verification || null,
        urls: res.result?.urls || null,
        // `reload.ok: false` BUKAN kegagalan: perubahannya tersimpan, gate-nya saja yang belum
        // menyerapnya dan akan membacanya sendiri saat polling. Diteruskan sebagai catatan supaya
        // sisi UI tidak perlu menebak, dan tidak diangkat jadi error.
        reloadPending: res.result?.reload?.ok === false,
      };
    } catch (error) {
      // Perintahnya sudah tertulis di antrean sebagai pending atau failed — cron yang menyelesaikan
      // sisanya. Yang dijawab ke browser adalah kenapa jalur cepatnya tidak sampai.
      return status(502, { error: error.message });
    }
  }
}

export { GATING_PATH };
