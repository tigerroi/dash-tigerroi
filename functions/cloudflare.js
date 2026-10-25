import { CloudflareError, cloudflareError, normalizeDnsInput } from "./cloudflare-core.js";

/**
 * Cloudflare API v4 — zona dan record DNS armada.
 *
 * Auth: satu API token, header Bearer, backend-ke-backend. **Token ini TIDAK BOLEH sampai ke
 * browser**, dan alasannya lebih keras daripada di vi-control: ia bisa MENGUBAH KE MANA SETIAP
 * DOMAIN KITA MENUNJUK. Satu record A yang diganti mengalihkan seluruh trafik iklan sebuah
 * subdomain ke mesin lain, dan tidak ada satu pun sistem di jalurnya yang akan menolak — DNS memang
 * kerjanya begitu. Bundle frontend dibaca siapa pun yang membuka devtools, jadi tidak ada satu pun
 * pemanggil modul ini di `src/`; yang memanggilnya cuma `server/cloudflare.js`.
 *
 * Sepola `keitaro-gate.js`: `apiKey` DIOPER, tidak dibaca dari `process.env` di dalam modul ini.
 * Yang membaca env adalah pemanggilnya, satu tempat, dan itu yang membuat modul ini bisa diuji
 * tanpa menitipkan token ke lingkungan test.
 */

const BASE = "https://api.cloudflare.com/client/v4";

// Cloudflare menjawab dalam ratusan milidetik untuk operasi DNS. Batas ini bukan untuk menunggu
// yang lambat melainkan supaya permintaan yang MENGGANTUNG tidak menahan request yang menunggunya
// di sisi browser sampai proxy-nya sendiri menyerah.
const TIMEOUT_MS = Number(process.env.CLOUDFLARE_TIMEOUT_MS || 20_000);

/**
 * Jumlah baris per halaman saat mengambil daftar.
 *
 * Cloudflare membatasi 100 untuk `dns_records` dan 50 untuk `zones`, dan yang melebihi batasnya
 * DITOLAK — bukan dipotong diam-diam. Nilainya dipisah per endpoint karena satu angka untuk
 * keduanya berarti salah satunya selalu salah.
 */
const ZONE_PAGE = 50;
const RECORD_PAGE = 100;

async function request(path, apiKey, { method = "GET", payload } = {}) {
  if (!apiKey) {
    throw new CloudflareError("CLOUDFLARE_API_TOKEN belum di-set.", { code: "no_token" });
  }

  // Batas waktu, bukan sekadar berharap: fetch tanpa batas waktu yang menggantung di dalam
  // proses server akan menahan slot-nya sampai lawan bicaranya memutuskan, dan itu bisa tidak
  // pernah.
  let res;
  let body;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        ...(payload ? { "Content-Type": "application/json" } : {}),
      },
      body: payload ? JSON.stringify(payload) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await res.text();
    body = text ? safeJson(text) : null;
  } catch (error) {
    if (error instanceof CloudflareError) throw error;
    if (error.name === "TimeoutError") {
      throw new CloudflareError(
        `Cloudflare tidak menjawab dalam ${Math.round(TIMEOUT_MS / 1000)} detik.`,
        { status: 504 },
      );
    }
    throw new CloudflareError(`Cloudflare tidak bisa dihubungi: ${error.message}`, { status: 503 });
  }

  /**
   * `success: false` DENGAN status 200 adalah bentuk yang benar-benar dipakai Cloudflare, jadi
   * `res.ok` saja tidak cukup untuk menyimpulkan berhasil.
   *
   * Ini kegagalan diam yang sama bentuknya dengan plugin RabbitROI yang menjawab 200 berisi nilai
   * lama (lihat plugin-core.js): dibaca dari status HTTP-nya saja, layar akan berbunyi "Tersimpan."
   * untuk record yang tidak pernah berubah.
   */
  if (!res.ok || body?.success === false) {
    throw cloudflareError(res.status, body);
  }

  return body;
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    // Bukan JSON berarti yang menjawab bukan Cloudflare — proxy perusahaan, halaman error, atau
    // captive portal. Potongan isinya ikut dibawa: "Unexpected token <" tidak menyebut siapa pun.
    throw new CloudflareError(`Cloudflare menjawab bukan JSON: ${text.slice(0, 120)}`, {
      status: 502,
    });
  }
}

/**
 * Ambil SELURUH halaman sebuah daftar.
 *
 * Bukan optimasi yang ditunda: halaman DNS menggambar apa yang ada, dan daftar yang berhenti di
 * halaman pertama akan MENYEMBUNYIKAN record — sebuah zona dengan 120 record akan tampil dengan 100
 * di antaranya, dan yang hilang tidak berbunyi sebagai apa pun. Orang lalu membuat ulang record
 * yang sebenarnya sudah ada, dan Cloudflare menolaknya dengan pesan "sudah ada" untuk sesuatu yang
 * tidak terlihat di layar.
 */
async function fetchAll(path, apiKey, perPage) {
  const rows = [];
  const separator = path.includes("?") ? "&" : "?";
  for (let page = 1; ; page += 1) {
    const body = await request(`${path}${separator}page=${page}&per_page=${perPage}`, apiKey);
    rows.push(...(Array.isArray(body?.result) ? body.result : []));
    const info = body?.result_info;
    // `total_pages` yang tidak ada berarti jawabannya bukan daftar berhalaman; berhenti alih-alih
    // mengulang permintaan yang sama selamanya.
    if (!info?.total_pages || page >= info.total_pages) break;
    // Pagar terakhir kalau `total_pages` berbohong. Sebelas zona hari ini; seratus halaman adalah
    // batas yang tidak akan pernah tercapai kecuali oleh perulangan yang rusak.
    if (page >= 100) break;
  }
  return rows;
}

/**
 * Zona (domain) yang dipegang akun ini.
 *
 * `accountId` MENYARING, dan itu bukan kerapian: sebuah token bisa punya akses ke beberapa akun,
 * dan daftar tanpa saringan akan memuat domain milik orang lain di layar yang tombolnya menghapus
 * record DNS.
 */
export function listZones(apiKey, accountId) {
  const query = accountId ? `?account.id=${encodeURIComponent(accountId)}` : "";
  return fetchAll(`/zones${query}`, apiKey, ZONE_PAGE).then((zones) =>
    zones.map((zone) => ({
      id: String(zone?.id || ""),
      name: String(zone?.name || ""),
      status: String(zone?.status || ""),
      paused: Boolean(zone?.paused),
      // Izin yang benar-benar dimiliki token INI atas zona ini. Dibawa ke layar supaya tombol yang
      // pasti ditolak tidak digambar sebagai tombol yang bekerja — sepola kolom "Izin" di
      // /google-api-configs.
      permissions: Array.isArray(zone?.permissions) ? zone.permissions.map(String) : [],
    })),
  );
}

export function listDnsRecords(apiKey, zoneId) {
  return fetchAll(`/zones/${encodeURIComponent(zoneId)}/dns_records`, apiKey, RECORD_PAGE).then(
    (records) => records.map(toRecord),
  );
}

/**
 * Satu record Cloudflare -> bentuk yang dipakai dashboard.
 *
 * Dipetakan dan tidak dioper apa adanya: jawaban Cloudflare membawa `meta`, `settings`, `tags`, dan
 * `proxiable` yang tidak dibaca satu baris pun di layar, dan mengirimkannya berarti bentuk internal
 * API pihak ketiga jadi kontrak halaman ini — pada hari salah satunya berubah, yang pecah adalah
 * komponen, bukan modul ini.
 */
function toRecord(record) {
  return {
    id: String(record?.id || ""),
    type: String(record?.type || ""),
    name: String(record?.name || ""),
    content: String(record?.content ?? ""),
    ttl: Number(record?.ttl ?? 1),
    proxied: Boolean(record?.proxied),
    // `proxiable` milik Cloudflare, bukan turunan tipe: sebuah CNAME ke nama yang tidak bisa
    // diproxy menjawab `false` walau tipenya ada di PROXIABLE_TYPES.
    proxiable: Boolean(record?.proxiable),
    priority: record?.priority === undefined ? null : Number(record.priority),
    comment: String(record?.comment ?? ""),
    modifiedOn: String(record?.modified_on || ""),
  };
}

export async function createDnsRecord(apiKey, zoneId, zoneName, input) {
  const payload = normalizeDnsInput(input, zoneName);
  const body = await request(`/zones/${encodeURIComponent(zoneId)}/dns_records`, apiKey, {
    method: "POST",
    payload,
  });
  return toRecord(body?.result);
}

/**
 * PUT, bukan PATCH — dan itu keputusan, bukan kebiasaan.
 *
 * PATCH menambal field yang disebutkan saja, dan justru itu yang berbahaya di sini: form ini
 * mengirim seluruh isinya, jadi kotak yang DIKOSONGKAN orang (komentar, priority) tidak akan pernah
 * benar-benar terhapus lewat PATCH — nilai lamanya bertahan di Cloudflare sementara layar
 * menunjukkan kotak kosong. PUT membuat yang tersimpan sama persis dengan yang terbaca di form.
 *
 * Ini kebalikan yang disengaja dari POST partial di /plugin, dan bedanya ada pada apa yang dibaca
 * form: di sana form dibuka atas keadaan yang bisa berubah di sela-sela oleh orang lain, sehingga
 * hanya SELISIHNYA yang boleh dikirim. Di sini satu record adalah satu baris utuh yang baru saja
 * dibaca ulang, dan tidak ada bagian dari baris itu yang dipegang orang lain.
 */
export async function updateDnsRecord(apiKey, zoneId, zoneName, recordId, input) {
  const payload = normalizeDnsInput(input, zoneName);
  const body = await request(
    `/zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(recordId)}`,
    apiKey,
    { method: "PUT", payload },
  );
  return toRecord(body?.result);
}

export async function deleteDnsRecord(apiKey, zoneId, recordId) {
  await request(
    `/zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(recordId)}`,
    apiKey,
    { method: "DELETE" },
  );
  return { id: recordId, deleted: true };
}
