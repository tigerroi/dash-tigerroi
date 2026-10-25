import { Elysia, status, t } from "elysia";
import {
  createCampaignFromTemplate,
  ensureLanding,
  KeitaroError,
  keitaroNamePrefix,
  landingUrlComplaint,
} from "../functions/keitaro-admin.js";
import { gateCampaign } from "../functions/keitaro-gate.js";
import { parseCampaignCodes } from "../functions/sync-core.js";
import { AuthError, bearerToken, requireSuperAdmin } from "./auth.js";

/** Kegagalan yang sudah punya status HTTP-nya; `created` = yang sudah lahir di Keitaro. */
export class KeitaroFailure extends Error {
  constructor(httpStatus, message, { created = {}, code } = {}) {
    super(message);
    this.status = httpStatus;
    this.created = created;
    this.code = code;
  }
}

/**
 * Keitaro untuk subdomain baru: landing page → campaign (salinan template) → gate vi-control.
 * SATU fungsi, dipakai tombol di dialog Tautan landing (/plugin) DAN langkah Setup Sub — dua
 * penyusun nama/urutan untuk satu campaign akan berselisih suatu hari.
 *
 * Hostname dari `subDomains/{id}`, TIDAK PERNAH dari pemanggil; URL landing dari pemanggil tapi wajib
 * berdiri di hostname itu (`landingUrlComplaint`). Awalan nama yang kosong = "{PIC} T2 (WL)" dari
 * baris subdomainnya; PIC yang juga kosong ditolak SEBELUM Keitaro disentuh.
 *
 * Tanpa retry otomatis: salinan campaign yang jawabannya hilang bisa saja sudah lahir. Yang gagal di
 * tengah menyebut apa yang sudah lahir (`created`), dan landing dipakai ulang saat diulang.
 */
export function keitaroSiteCreator({ store, apiKey, viControlKey, templateId }) {
  return async function createKeitaroForSite(id, { url, namePrefix, gate = true } = {}) {
    if (!apiKey) {
      throw new KeitaroFailure(503, "KEITARO_API_KEY belum di-set di server kontrol.", {
        code: "no_token",
      });
    }
    const sub = await store.read(`subDomains/${id}`);
    if (!sub?.name || sub.deletedAt) throw new KeitaroFailure(404, "Subdomain tidak ditemukan.");
    const host = String(sub.name).trim().toLowerCase();
    const complaint = landingUrlComplaint(url, host);
    if (complaint) throw new KeitaroFailure(422, complaint);
    const prefix = String(namePrefix || "").trim() || keitaroNamePrefix(sub.pic);
    if (!prefix) {
      throw new KeitaroFailure(
        422,
        `PIC ${host} kosong — isi kolom PIC di /sub-domains; nama campaign Keitaro diawali nama PIC.`,
      );
    }

    const created = {};
    try {
      const { landing, reused } = await ensureLanding(apiKey, host, url);
      created.landing = { id: landing.id, reused };
      created.campaign = await createCampaignFromTemplate(apiKey, {
        templateId,
        host,
        prefix,
        landingId: landing.id,
      });
    } catch (error) {
      if (!(error instanceof KeitaroError)) throw error;
      throw new KeitaroFailure(502, error.message, { created });
    }

    // Kode didaftarkan ke subdomainnya: tanpa itu belanja Meta ber-kode ini tidak masuk ROI siapa pun.
    const codes = parseCampaignCodes(sub.campaignCodes);
    if (!codes.includes(created.campaign.code.toLowerCase())) {
      const next = [sub.campaignCodes, created.campaign.code].filter(Boolean).join(", ");
      await store.update(`subDomains/${id}`, { campaignCodes: next });
    }

    // Gate paling akhir dan tidak menjatuhkan hasilnya: campaign + landing sudah lahir, dan
    // gate yang gagal bisa diulang dari /vi-control.
    let gated = null;
    if (gate !== false) {
      try {
        gated = await gateCampaign(created.campaign.id, viControlKey);
      } catch (error) {
        gated = { status: "failed", error: error.message };
      }
    }
    return { ...created, gate: gated };
  };
}

/** Superadmin, sepola /vi-control: yang dilahirkan di sini menentukan ke mana trafik iklan dikirim. */
export function keitaroRoutes({ db, store, apiKey, viControlKey, templateId, authorize, create }) {
  const check = authorize || ((token) => requireSuperAdmin(db, token));
  const createForSite = create || keitaroSiteCreator({ store, apiKey, viControlKey, templateId });

  return new Elysia({ prefix: "/keitaro" })
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
      "/sites/:id/campaign",
      async ({ params, body }) => {
        try {
          return await createForSite(params.id, body);
        } catch (error) {
          if (!(error instanceof KeitaroFailure)) throw error;
          return status(error.status, {
            error: error.message,
            ...(error.code ? { code: error.code } : {}),
            ...(error.status === 502 ? { created: error.created } : {}),
          });
        }
      },
      {
        superadmin: true,
        params: t.Object({ id: t.String({ minLength: 1 }) }),
        body: t.Object({
          url: t.String({ minLength: 1 }),
          namePrefix: t.Optional(t.String({ maxLength: 120 })),
          gate: t.Optional(t.Boolean()),
        }),
      },
    );
}
