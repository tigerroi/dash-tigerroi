import {
  createDnsRecord,
  listDnsRecords,
  listZones,
  updateDnsRecord,
} from "../functions/cloudflare.js";
import { CloudflareError } from "../functions/cloudflare-core.js";

/**
 * Utilitas Integrasi Cloudflare DNS untuk otomatisasi manajemen subdomain.
 *
 * Menggunakan Cloudflare API Token dengan izin minimal:
 * - Zone - Zone - Read (untuk mencari Zone ID berdasarkan nama domain)
 * - Zone - DNS - Edit (untuk membaca dan menulis DNS record subdomain)
 */

/**
 * Mencari Zone ID berdasarkan nama zona (misal: ihopmenuwithprices.us).
 *
 * @param {string} apiKey Token API Cloudflare
 * @param {string} zoneName Nama domain induk / zona
 * @returns {Promise<string>} Zone ID
 */
export async function resolveZoneId(apiKey, zoneName) {
  const cleanZone = String(zoneName || "")
    .trim()
    .toLowerCase();
  const zones = await listZones(apiKey);
  const matched = zones.find((z) => z.name.toLowerCase() === cleanZone);
  if (!matched) {
    throw new CloudflareError(
      `Zona '${cleanZone}' tidak ditemukan pada akun Cloudflare ini. Pastikan domain sudah terdaftar di Cloudflare.`,
      { status: 404 },
    );
  }
  return matched.id;
}

/**
 * Mengambil seluruh record DNS pada zona tertentu.
 *
 * @param {string} apiKey Token API Cloudflare
 * @param {string} zoneIdentifier Nama zona atau ID zona
 * @returns {Promise<{ zoneId: string, records: Array }>}
 */
export async function getZoneDnsRecords(apiKey, zoneIdentifier) {
  // Jika sudah berupa ID atau alfanumerik id (seperti 32-char hex atau id mock)
  const isId = /^[a-z0-9_-]{8,}$/i.test(zoneIdentifier) && !zoneIdentifier.includes(".");
  const zoneId = isId ? zoneIdentifier : await resolveZoneId(apiKey, zoneIdentifier);
  const records = await listDnsRecords(apiKey, zoneId);
  return { zoneId, records };
}

/**
 * Membuat atau memperbarui DNS record untuk subdomain baru (idempotent).
 *
 * @param {Object} options
 * @param {string} options.apiKey Token API Cloudflare
 * @param {string} options.zoneName Nama domain induk (contoh: ihopmenuwithprices.us)
 * @param {string} options.subdomain Label subdomain atau nama FQDN (contoh: menu atau menu.ihopmenuwithprices.us)
 * @param {string} options.content Alamat IP tujuan (record A) atau hostname target (CNAME)
 * @param {string} [options.type='A'] Tipe record: 'A' atau 'CNAME'
 * @param {boolean} [options.proxied=false] Apakah diaktifkan proxy Cloudflare (awan oranye)
 * @returns {Promise<{ action: 'created'|'updated'|'unchanged', record: Object }>}
 */
export async function syncSubdomainRecord({
  apiKey,
  zoneName,
  subdomain,
  content,
  type = "A",
  proxied = false,
}) {
  const zoneId = await resolveZoneId(apiKey, zoneName);
  const { records } = await getZoneDnsRecords(apiKey, zoneId);

  const cleanSub = String(subdomain || "")
    .trim()
    .toLowerCase();
  const cleanZone = String(zoneName || "")
    .trim()
    .toLowerCase();
  const fqdn = cleanSub.endsWith(`.${cleanZone}`) ? cleanSub : `${cleanSub}.${cleanZone}`;

  const existing = records.find(
    (r) => r.name.toLowerCase() === fqdn && r.type.toUpperCase() === type.toUpperCase(),
  );

  const recordPayload = {
    type: type.toUpperCase(),
    name: cleanSub,
    content: String(content).trim(),
    proxied: Boolean(proxied),
    ttl: 1, // Auto TTL
    comment: "Managed by TigerROI",
  };

  if (!existing) {
    const created = await createDnsRecord(apiKey, zoneId, cleanZone, recordPayload);
    return { action: "created", record: created };
  }

  // Periksa apakah ada perubahan content atau proxy status
  const isContentSame = existing.content === recordPayload.content;
  const isProxySame = existing.proxied === recordPayload.proxied;

  if (isContentSame && isProxySame) {
    return { action: "unchanged", record: existing };
  }

  const updated = await updateDnsRecord(apiKey, zoneId, cleanZone, existing.id, recordPayload);
  return { action: "updated", record: updated };
}

// Eksekusi CLI jika dipanggil langsung
if (process.argv[1] && process.argv[1].endsWith("cloudflare-dns.js")) {
  const command = process.argv[2];
  const apiKey = process.env.CLOUDFLARE_API_TOKEN;

  if (!apiKey) {
    console.error("ERROR: CLOUDFLARE_API_TOKEN belum disetel di environment.");
    process.exit(1);
  }

  (async () => {
    try {
      if (command === "list") {
        const zoneName = process.argv[3];
        if (!zoneName) {
          console.error("Penggunaan: node jobs/cloudflare-dns.js list <zoneName>");
          process.exit(1);
        }
        const { zoneId, records } = await getZoneDnsRecords(apiKey, zoneName);
        console.log(`Daftar record untuk zona ${zoneName} (ID: ${zoneId}):`);
        console.table(
          records.map((r) => ({
            name: r.name,
            type: r.type,
            content: r.content,
            proxied: r.proxied,
          })),
        );
      } else if (command === "create") {
        const zoneName = process.argv[3];
        const subdomain = process.argv[4];
        const content = process.argv[5];
        const proxied = process.argv[6] === "true";

        if (!zoneName || !subdomain || !content) {
          console.error(
            "Penggunaan: node jobs/cloudflare-dns.js create <zoneName> <subdomain> <targetIpOrHost> [proxied]",
          );
          process.exit(1);
        }

        const result = await syncSubdomainRecord({
          apiKey,
          zoneName,
          subdomain,
          content,
          proxied,
        });
        console.log(
          `[${result.action.toUpperCase()}] ${result.record.name} -> ${result.record.content} (proxied: ${result.record.proxied})`,
        );
      } else {
        console.log("Perintah tersedia: list, create");
      }
    } catch (err) {
      console.error(`Gagal: ${err.message}`);
      process.exit(1);
    }
  })();
}
