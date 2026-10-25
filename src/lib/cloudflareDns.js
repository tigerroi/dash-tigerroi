/**
 * Aturan tampilan tab DNS Record (/dns-records).
 *
 * Yang di sini MENGGAMBAR; yang MEMUTUSKAN apa yang boleh ditulis tinggal di
 * `functions/cloudflare-core.js`, dan cuma tiga hal yang dicerminkan ke sini — daftar tipe, daftar
 * tipe yang bisa diproxy, dan batas TTL. Ketiganya dicerminkan karena form harus menggambar
 * pilihannya sebelum ada satu permintaan pun dikirim, dan ketiganya dijaga
 * `cloudflareDns.test.mjs`, yang membaca berkas seberangnya — persis pola `campaignCommandEntry`.
 *
 * Yang TIDAK dicerminkan adalah pemeriksaan isinya (bentuk IPv4, hostname, TTL): salinan kedua dari
 * aturan yang menolak sesuatu akan berselisih suatu hari, dan yang lebih longgar menang tanpa
 * berbunyi. Form ini mengirim lalu menggambar penolakan server apa adanya — satu tempat yang
 * memutuskan, satu kalimat yang dibaca orang.
 */

// Dicerminkan dari functions/cloudflare-core.js. Lihat catatan di kepala berkas.
export const DNS_TYPES = ["A", "AAAA", "CNAME", "TXT", "MX", "NS"];
export const PROXIABLE_TYPES = ["A", "AAAA", "CNAME"];
export const TTL_AUTO = 1;
export const TTL_MIN = 60;
export const TTL_MAX = 86_400;

/**
 * Bolehkah tipe ini disembunyikan di belakang proxy Cloudflare?
 *
 * Dipakai form untuk memutuskan kotak "Proxy" DIGAMBAR atau tidak — bukan digambar lalu dimatikan.
 * Kotak mati untuk TXT terbaca sebagai izin yang kurang; yang benar adalah proxy memang tidak punya
 * arti untuk record yang jawabannya bukan alamat tujuan HTTP.
 */
export function isProxiable(type) {
  return PROXIABLE_TYPES.includes(String(type || "").toUpperCase());
}

// Tipe yang butuh Priority. Hari ini cuma MX; berdiri sebagai fungsi supaya form tidak menyebar
// perbandingan `=== "MX"` ke tiga tempat yang harus ikut berubah bersamaan.
export function needsPriority(type) {
  return String(type || "").toUpperCase() === "MX";
}

/**
 * Nama record seperti yang DITAMPILKAN Cloudflare sendiri: bagian depannya saja.
 *
 * `care.petcins.com` di zona `petcins.com` digambar "care", dan akar zonanya "@". Alasannya bukan
 * kerapian melainkan lebar kolom: sebelas zona armada ini punya nama panjang
 * (`theglobesimregistration.ph`), dan mengulangnya di tiap baris mendorong kolom Content — yaitu
 * satu-satunya kolom yang benar-benar dibaca orang di sini — keluar layar.
 *
 * Nama PENUH tidak hilang: ia tetap yang dikirim ke server dan tetap dipakai menjodohkan dengan
 * `subDomains`.
 */
export function shortRecordName(name, zoneName) {
  const full = String(name || "").toLowerCase();
  const zone = String(zoneName || "").toLowerCase();
  if (!zone || full === zone) return "@";
  return full.endsWith(`.${zone}`) ? full.slice(0, -(zone.length + 1)) : full;
}

/**
 * TTL angka -> kata yang bisa dibaca.
 *
 * `1` HARUS diterjemahkan, dan itu seluruh alasan fungsi ini ada: ia berarti "Auto" di Cloudflare,
 * bukan satu detik. Digambar apa adanya, kolom TTL mengabarkan satu detik kepada yang membacanya —
 * angka yang akan dikejar orang sebagai kesalahan yang tidak ada.
 */
export function ttlLabel(ttl) {
  const value = Number(ttl);
  if (!Number.isFinite(value) || value === TTL_AUTO) return "Auto";
  if (value % 3600 === 0) return `${value / 3600} jam`;
  if (value % 60 === 0) return `${value / 60} menit`;
  return `${value} detik`;
}

/**
 * Nama domain apa adanya, dari kolom yang diketik orang.
 *
 * `domains.domainUrl` diketik manusia, jadi ia datang sebagai "petcins.com", "https://petcins.com",
 * "www.petcins.com/", dan ketiganya berarti zona yang sama. Tanpa penormalan ini, penjodohan zona
 * dengan barisnya di dashboard gagal untuk baris yang cuma berbeda awalan — dan yang tergambar
 * adalah "belum terdaftar" untuk domain yang jelas-jelas ada di tab sebelah.
 */
export function hostOf(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .replace(/\.$/, "");
}

/**
 * Zona Cloudflare + barisnya di /domains.
 *
 * Sumbernya CLOUDFLARE, dan `domains` cuma melengkapi — bukan sebaliknya. Yang menentukan sebuah
 * zona bisa disunting dari sini adalah Cloudflare; sebuah zona yang belum punya baris di dashboard
 * tetap harus tampil, karena justru itulah yang perlu diketahui orang. Dijodohkan dan bukan
 * disaring: daftar yang membuang zona tak terdaftar menyembunyikan domain yang DNS-nya hidup dari
 * satu-satunya layar yang bisa memperbaikinya.
 */
export function toZoneRows(zones, domains) {
  const known = new Map();
  for (const domain of domains || []) {
    const host = hostOf(domain?.domainUrl);
    if (host) known.set(host, domain);
  }

  return (zones || [])
    .map((zone) => {
      const host = hostOf(zone?.name);
      const domain = known.get(host) || null;
      return {
        id: String(zone?.id || ""),
        name: String(zone?.name || ""),
        status: String(zone?.status || ""),
        paused: Boolean(zone?.paused),
        // Terdaftar di /domains atau tidak. Bukan penilaian: sebuah zona bisa sah-sah saja belum
        // dicatat, dan yang membacanya memutuskan sendiri apakah itu masalah.
        registered: Boolean(domain),
        domainStatus: String(domain?.status || ""),
        // Izin token atas zona INI. Zona yang cuma bisa dibaca tetap digambar, tapi tombol
        // tulisnya tidak — sepola kolom "Izin" di /google-api-configs, dan alasan yang sama:
        // tombol yang pasti ditolak lebih buruk daripada tombol yang tidak ada.
        editable:
          !Array.isArray(zone?.permissions) || zone.permissions.includes("#dns_records:edit"),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Record + tandanya terhadap `subDomains`.
 *
 * Yang dijawabnya: baris DNS ini melayani subdomain yang terdaftar di dashboard, atau tidak. Itu
 * satu-satunya hal yang tahu dashboard ini dan tidak tahu layar Cloudflare — dan ia yang membuat
 * "record ini boleh dihapus?" bisa dijawab tanpa membuka tab lain.
 */
export function toRecordRows(records, zoneName, subDomains) {
  const registered = new Set(
    (subDomains || []).map((row) =>
      String(row?.name || "")
        .toLowerCase()
        .replace(/\.$/, ""),
    ),
  );

  return (records || [])
    .map((record) => ({
      ...record,
      shortName: shortRecordName(record?.name, zoneName),
      // Hanya berarti untuk tipe yang benar-benar mengarahkan pengunjung. Sebuah TXT verifikasi
      // yang kebetulan senama dengan subdomain terdaftar bukan "yang melayani subdomain itu".
      subDomain:
        registered.has(String(record?.name || "").toLowerCase()) &&
        ["A", "AAAA", "CNAME"].includes(String(record?.type || "").toUpperCase()),
    }))
    .sort(compareRecords);
}

/**
 * Urutan baris: tipe dulu, lalu nama.
 *
 * Bukan urutan Cloudflare (yang mengembalikannya menurut waktu dibuat), karena yang dilakukan orang
 * di layar ini adalah MENCARI satu nama di antara belasan yang serupa — dan daftar berurut waktu
 * menaruh record yang paling mirip di dua ujung yang berjauhan.
 *
 * `localeCompare` dengan `numeric`, supaya "sub2" berdiri sebelum "sub10".
 */
function compareRecords(a, b) {
  const byType = String(a.type || "").localeCompare(String(b.type || ""));
  if (byType !== 0) return byType;
  return String(a.shortName || "").localeCompare(String(b.shortName || ""), undefined, {
    numeric: true,
  });
}

/**
 * Ringkasan satu zona, untuk kartu di kepala panel.
 *
 * `proxied` dihitung terpisah karena ia satu-satunya keadaan di layar ini yang mengubah JALUR
 * trafik tanpa mengubah tujuannya — dan di armada yang seluruhnya tidak diproxy, satu record yang
 * menyala adalah hal pertama yang ingin diketahui orang.
 */
export function recordSummary(rows) {
  const list = rows || [];
  return {
    total: list.length,
    proxied: list.filter((row) => row.proxied).length,
    subDomains: list.filter((row) => row.subDomain).length,
    types: [...new Set(list.map((row) => row.type))].sort().join(", "),
  };
}

/**
 * Subdomain terdaftar di dashboard yang TIDAK punya record apa pun di zona ini.
 *
 * Ia satu-satunya kesimpulan yang ditarik halaman ini, dan karena itu ia paling hati-hati:
 * subdomain tanpa record DNS tidak bisa dijangkau siapa pun — trafik iklannya mendarat di nama yang
 * tidak menjawab — dan itu tidak berbunyi sebagai apa pun di dashboard, cuma sebagai earning nol.
 *
 * TAPI ia MENYERAH begitu zona ini punya record wildcard (`*.petcins.com`): satu wildcard menjawab
 * setiap nama yang tidak punya record sendiri, jadi daftar ini akan menuduh subdomain yang justru
 * sedang bekerja. Sepola `earningKnown` — yang tidak bisa dipastikan tidak dinilai, dan halaman
 * mengatakan kenapa alih-alih diam.
 */
export function missingSubDomains(records, zoneName, subDomains) {
  const zone = hostOf(zoneName);
  if (!zone) return { names: [], wildcard: false };

  const list = records || [];
  const wildcard = list.some(
    (record) =>
      String(record?.name || "")
        .toLowerCase()
        .startsWith("*.") && ["A", "AAAA", "CNAME"].includes(String(record?.type || "")),
  );
  if (wildcard) return { names: [], wildcard: true };

  const covered = new Set(
    list
      .filter((record) => ["A", "AAAA", "CNAME"].includes(String(record?.type || "")))
      .map((record) => String(record?.name || "").toLowerCase()),
  );

  const names = (subDomains || [])
    .map((row) =>
      String(row?.name || "")
        .toLowerCase()
        .replace(/\.$/, ""),
    )
    .filter((name) => name && (name === zone || name.endsWith(`.${zone}`)))
    .filter((name) => !covered.has(name))
    .sort();

  return { names: [...new Set(names)], wildcard: false };
}

/**
 * Record -> isi form sunting. Record kosong -> form tambah.
 *
 * Satu fungsi untuk keduanya supaya tidak ada dua bentuk "isi form" yang harus tetap sepakat: yang
 * membedakan tambah dari sunting cuma ada tidaknya `id`, persis seperti di API-nya.
 */
export function toRecordForm(record, zoneName) {
  return {
    id: String(record?.id || ""),
    type: String(record?.type || "A").toUpperCase(),
    // Nama PENDEK di kotaknya, sama dengan yang dilihat orang di layar Cloudflare. Yang
    // melengkapinya jadi nama penuh adalah `dnsRecordName` di sisi server — satu tempat, dan bukan
    // penyambungan string kedua di browser yang akan berbeda suatu hari.
    name: record ? shortRecordName(record.name, zoneName) : "",
    content: String(record?.content ?? ""),
    // Kosong = Auto. Bukan "1": kotak yang berisi angka 1 mengundang orang menggantinya jadi 60
    // karena ia terbaca sebagai satu detik.
    ttl: record && Number(record.ttl) !== TTL_AUTO ? String(record.ttl) : "",
    proxied: Boolean(record?.proxied),
    priority:
      record?.priority === null || record?.priority === undefined ? "" : String(record.priority),
    comment: String(record?.comment ?? ""),
  };
}

/**
 * Server domain ini = IP yang dituju A record AKAR zonanya — aturan yang sama dengan `pickServer`
 * di server/setup-sub.js (satu domain tinggal di satu server). "" kalau apex tidak punya A record:
 * tidak ditebak dari record lain, yang bisa saja sisa ke server lama.
 */
export function zoneServer(records, zoneName) {
  const apex = (records || []).find((row) => row?.type === "A" && row?.name === zoneName);
  return String(apex?.content || "");
}

/**
 * Isi form -> body yang dikirim ke server.
 *
 * `server` (IP server domain ini) mengisi Isi record A yang DIKOSONGKAN — placeholder kotaknya
 * menyebut IP yang sama, jadi yang terkirim adalah persis yang terbaca di layar.
 *
 * `proxied` dan `priority` DIBUANG untuk tipe yang tidak memakainya, bukan dikirim sebagai nilai
 * kosong: kotaknya memang tidak digambar, dan sisa nilai dari tipe sebelumnya (orang mengganti
 * CNAME jadi TXT di form yang sudah terisi) akan ikut terkirim sebagai keadaan yang tidak pernah
 * dipilih siapa pun.
 */
export function toRecordPayload(form, server = "") {
  const type = String(form?.type || "").toUpperCase();
  const content = String(form?.content ?? "").trim();
  const payload = {
    type,
    name: String(form?.name ?? "").trim(),
    content: content || (type === "A" ? server : ""),
    ttl: String(form?.ttl ?? "").trim(),
    comment: String(form?.comment ?? "").trim(),
  };
  if (isProxiable(type)) payload.proxied = Boolean(form?.proxied);
  if (needsPriority(type)) payload.priority = String(form?.priority ?? "").trim();
  return payload;
}
