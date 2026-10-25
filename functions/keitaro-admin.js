// Keitaro Admin API — membuat landing page + campaign untuk subdomain baru.
//
// Berbeda dari keitaro-gate.js (vi-control, yang MENGUBAH routing campaign yang sudah ada): yang di
// sini melahirkan objeknya. Key-nya Admin API Keitaro sendiri (header `Api-Key`), dan alasannya
// tinggal di server sama persis dengan key vi-control — ia bisa mengubah tujuan seluruh trafik.
//
// Bentuknya dibaca dari armada (21 Sep 2026): landing "external" + "http" bernama hostname
// subdomainnya, dan campaign = salinan "Link Master T2" (#1) yang flow `landings`-nya (flow ke-2,
// "LP Utama") diisi landing itu. Bot Protection dan Flow 3 ikut tersalin apa adanya; yang
// mengarahkan ketiganya ke gate adalah vi-control sesudahnya.

function getBase() {
  const url = process.env.KEITARO_BASE_URL;
  if (!url) return "";
  return `${url.replace(/\/+$/, "")}/admin_api/v1`;
}
const TIMEOUT_MS = Number(process.env.KEITARO_TIMEOUT_MS || 30_000);

export class KeitaroError extends Error {}

async function request(apiKey, path, { method = "GET", payload } = {}) {
  const base = getBase();
  if (!base) throw new KeitaroError("KEITARO_BASE_URL wajib diisi (lihat server/.env.example).");
  if (!apiKey) throw new KeitaroError("KEITARO_API_KEY belum di-set di server kontrol.");
  let res;
  let text;
  try {
    res = await fetch(`${base}${path}`, {
      method,
      headers: {
        "Api-Key": apiKey,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: payload ? JSON.stringify(payload) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    text = await res.text();
  } catch (error) {
    throw new KeitaroError(`Keitaro tidak bisa dihubungi: ${error.message}`);
  }
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new KeitaroError(
      `Keitaro menjawab bukan JSON (HTTP ${res.status}): ${text.slice(0, 120)}`,
    );
  }
  if (!res.ok) {
    const detail = body?.error || body?.message || JSON.stringify(body)?.slice(0, 200);
    throw new KeitaroError(`Keitaro ${method} ${path} -> ${res.status}: ${detail}`);
  }
  return body;
}

/**
 * Kode campaign = 4 karakter terakhir alias ("gmBdXw" → "BdXw"). Itu yang dipakai advertiser di
 * nama campaign Meta dan yang dicocokkan `buildCodeIndex`.
 */
export function campaignCode(alias) {
  return String(alias || "").slice(-4);
}

/**
 * Nama campaign: "{awalan} {kode} ({hostname})". Hostname di ekor dalam kurung karena itu yang
 * dibaca `subDomainOfCampaign` untuk kolom Campaign URL; kodenya token utuh untuk `parseCampaignCodes`.
 */
export function campaignNameFor(prefix, code, host) {
  return [String(prefix || "").trim(), code, `(${host})`].filter(Boolean).join(" ");
}

/**
 * Awalan nama bawaan: "{PIC} T2 (WL)" — pola armada ("ACA T2 (WL) ..."), PIC dari baris subdomainnya.
 * PIC kosong = "" (bukan "T2 (WL)" tanpa pemilik): pemanggil yang memutuskan menolak atau bertanya.
 */
export function keitaroNamePrefix(pic) {
  const name = String(pic || "").trim();
  return name ? `${name.toUpperCase()} T2 (WL)` : "";
}

/**
 * URL landing wajib https dan di hostname subdomain itu sendiri — link landing plugin. Dioper dari
 * request, jadi tanpa pemeriksaan ini endpoint ini bisa mengarahkan trafik berbayar ke mana pun.
 */
export function landingUrlComplaint(url, host) {
  let parsed;
  try {
    parsed = new URL(String(url || ""));
  } catch {
    return "URL landing tidak terbaca.";
  }
  if (parsed.protocol !== "https:") return "URL landing harus https.";
  if (parsed.hostname.toLowerCase() !== String(host).toLowerCase()) {
    return `URL landing harus di ${host}, bukan ${parsed.hostname}.`;
  }
  return "";
}

// Landing dipakai ulang kalau namanya sudah ada — mengulang setelah gagal di tengah tidak boleh
// melahirkan landing kembar. Payload-nya TIDAK ditimpa: landing yang sudah di-gate menunjuk gate.
export async function ensureLanding(apiKey, host, url) {
  const list = await request(apiKey, "/landing_pages");
  const found = (Array.isArray(list) ? list : []).find(
    (row) => row.name === host && row.state !== "deleted",
  );
  if (found) return { landing: found, reused: true };
  const landing = await request(apiKey, "/landing_pages", {
    method: "POST",
    payload: { name: host, landing_type: "external", action_type: "http", action_payload: url },
  });
  return { landing, reused: false };
}

/** Salin campaign template, beri nama berkode alias, isi flow `landings` dengan landing-nya. */
export async function createCampaignFromTemplate(apiKey, { templateId, host, prefix, landingId }) {
  const cloned = await request(apiKey, `/campaigns/${templateId}/clone`, { method: "POST" });
  const campaign = Array.isArray(cloned) ? cloned[0] : cloned;
  const template = await request(apiKey, `/campaigns/${templateId}`);
  if (!campaign?.id || !campaign.alias || campaign.alias === template.alias) {
    throw new KeitaroError(`Salinan campaign #${templateId} tidak membawa alias baru.`);
  }
  const code = campaignCode(campaign.alias);
  const name = campaignNameFor(prefix, code, host);
  await request(apiKey, `/campaigns/${campaign.id}`, { method: "PUT", payload: { name } });

  const streams = await request(apiKey, `/campaigns/${campaign.id}/streams`);
  const flow = (streams || []).find((row) => row.schema === "landings");
  if (!flow) {
    throw new KeitaroError(`Campaign #${campaign.id} tidak punya flow berskema landings.`);
  }
  await request(apiKey, `/streams/${flow.id}`, {
    method: "PUT",
    payload: { landings: [{ landing_id: Number(landingId), share: 100, state: "active" }] },
  });
  return { id: campaign.id, alias: campaign.alias, code, name, flowId: flow.id };
}
