// AutoPost — logika murni untuk menyuruh plugin RabbitROI menulis artikel dari sebuah kata kunci.
//
// Dipisah dari plugin-core.js walau memakai KUNCI YANG SAMA, dan pemisahannya bukan kerapian:
//
//   1. **Alamatnya di luar `/manage/`.** `pluginBaseUrl` menyambung `/wp-json/rabbitroi/v1/manage`;
//      AutoPost tinggal di `/wp-json/rabbitroi/v1/autopost`. Disambung lewat yang pertama, tiap
//      permintaan menjawab `rest_no_route` (404) — kegagalan yang terbaca persis seperti situs yang
//      belum memasang plugin versi baru.
//   2. **Amplop gagalnya BERBEDA.** Manajemen menjawab `{ success: false, error: { code, message } }`;
//      AutoPost menjawab `{ success: false, message, logs }` — pesannya di AKAR, tanpa `error.code`
//      sama sekali. `unwrapPlugin` membaca `body.error?.message` dan menemukan `undefined`, jadi
//      sebab yang benar-benar berguna ("Error Gemini: API key not valid") diganti kalimat umum
//      "Plugin menjawab tanpa kode" — satu-satunya keterangan yang ada, hilang.
//
// Yang TIDAK berbeda dipakai ulang apa adanya: `PluginError` (supaya `pluginFailureStatus` di
// server tetap memetakan kegagalan situs jadi 502 dan bukan 401 milik kita sendiri),
// `pluginHostname` (satu-satunya penormal hostname; dua penormal berarti satu di antaranya suatu
// hari menerima host yang ditolak yang lain), dan `normalizeField` berikut seluruh tipenya.

import { normalizeField, PluginError, pluginErrorHint, pluginHostname } from "./plugin-core.js";

export const AUTOPOST_NAMESPACE = "/wp-json/rabbitroi/v1/autopost";

/**
 * Berapa kata kunci yang boleh dikirim dalam SATU permintaan.
 *
 * Tidak ada endpoint batch di sisi plugin — satu POST = satu keyword = satu proses PHP yang hidup
 * sampai artikelnya selesai. Batas ini yang menahan satu tempelan berisi seribu baris menjadi
 * seribu proses PHP di satu shared hosting, yang bukan lagi "lambat" melainkan situs yang mati
 * untuk pengunjungnya juga.
 */
export const AUTOPOST_MAX_KEYWORDS = 50;

/**
 * Panjang maksimum kata kunci dasar generator. Plugin cuma menyisipkannya ke prompt AI
 * (`keyword.auto.php`, tanpa batas sendiri), dan yang ditempel orang sering daftar topik dipisah
 * koma, bukan satu frasa — 200 karakter menolak daftar 25 topik sebagai "Body tidak valid" untuk
 * seluruh bulk (23 Sep 2026). Tetap berbatas: teksnya masuk ke prompt yang ditagihkan per token.
 */
export const AUTOPOST_BASE_MAX = 2000;

// Batas yang sama dengan `/autopost/keywords` di sisi plugin. Ditulis di sini supaya form bisa
// menolaknya sebelum menyentuh jaringan; yang lolos ke sana dijepit diam-diam tanpa satu pun tanda.
export const AUTOPOST_MAX_GENERATED = 100;

/**
 * Hostname subdomain → alamat dasar AutoPost.
 *
 * Sama seperti `pluginBaseUrl`, yang masuk ke sini HARUS berasal dari baris `subDomains` di RTDB.
 * Bedanya cuma satu segmen alamat, dan itu satu-satunya alasan fungsi ini ada.
 */
export function autopostBaseUrl(host) {
  return `https://${pluginHostname(host)}${AUTOPOST_NAMESPACE}`;
}

/**
 * Amplop jawaban AutoPost → data, atau `PluginError`.
 *
 * TIGA bentuk yang harus dibaca, dan yang ketiga datang dari lapisan yang berbeda sama sekali:
 *
 *   { success: true,  data: {...} }                     <- berhasil
 *   { success: false, message, logs }                   <- handler AutoPost (AI ditolak, field kurang)
 *   { code, message, data: { status } }                 <- lapisan izin WordPress REST
 *
 * `logs` DIBAWA SERTA ke dalam error, bukan dibuang. Untuk kegagalan AI ia satu-satunya jendela ke
 * apa yang benar-benar terjadi — pesannya sendiri sering cuma "Gagal membuat konten", dan yang
 * menyebut kuota habis atau model yang tidak ada ada di baris log terakhir.
 */
export function unwrapAutopost(body, httpStatus = 0) {
  if (body === null || typeof body !== "object") {
    throw new PluginError(
      httpStatus
        ? `Situs menjawab HTTP ${httpStatus} tanpa JSON — kemungkinan bukan endpoint AutoPost (WAF, halaman login, atau plugin versi lama).`
        : "Situs menjawab tanpa JSON yang bisa dibaca.",
      { status: httpStatus },
    );
  }

  if (body.success === true) return body.data ?? {};

  if (body.success === false) {
    const message = String(body.message || "").trim();
    const error = new PluginError(
      message || `AutoPost menolak permintaannya${httpStatus ? ` (HTTP ${httpStatus})` : ""}.`,
      { status: httpStatus },
    );
    error.logs = logLines(body.logs);
    throw error;
  }

  // Bentuk WordPress REST — `invalid_key`, `rest_no_route`. `data.status` yang dipakai, bukan status
  // HTTP-nya, karena proxy di depan situs kadang menormalkan kode yang lewat.
  if (typeof body.code === "string" && body.code) {
    const status = Number(body.data?.status || httpStatus || 0);
    // `rest_no_route` punya kalimatnya sendiri: ia satu-satunya kode di sini yang TIDAK berarti
    // ada yang salah dengan kunci maupun situsnya, melainkan bahwa pluginnya belum punya AutoPost.
    const hint =
      body.code === "rest_no_route"
        ? "Plugin di situs ini belum punya endpoint AutoPost — perbarui pluginnya lebih dulu."
        : pluginErrorHint(body.code, body.message);
    throw new PluginError(hint, { code: body.code, status });
  }

  throw new PluginError(
    `Situs menjawab bentuk yang tidak dikenal${httpStatus ? ` (HTTP ${httpStatus})` : ""}.`,
    { status: httpStatus },
  );
}

export function logLines(value) {
  return (Array.isArray(value) ? value : [])
    .map((line) => String(line ?? "").trim())
    .filter(Boolean);
}

// --- Skema field ----------------------------------------------------------------------------------
//
// Sepola dengan `PLUGIN_SCHEMA`: ditulis SEKALI dan dikirim ke browser lewat `GET /plugin/schema`,
// karena server memvalidasinya dengan daftar yang sama yang dipakai form menggambar dirinya.
//
// DUA field sengaja TIDAK ada di sini, dan keduanya wajib demikian:
//
//   `ai_key`   — kredensial. Ia tidak boleh ikut jalur mana pun yang menyimpan nilai form (cache
//                antar-tab, "terapkan ke situs lain", riwayat alamat). Diperlakukan sebagai field
//                biasa, ia akan tersimpan di ketiganya tanpa satu pun keputusan yang menyebutkannya.
//   `keyword`  — bukan setelan melainkan ISI permintaan. Ia datang sebagai daftar, satu per baris,
//                dan tiap barisnya jadi satu job tersendiri; digambar sebagai field skema, ia akan
//                ikut "terapkan ke situs lain" seolah ia sebuah pengaturan yang menempel di situs.

export const AUTOPOST_KEYWORD_FIELDS = [
  {
    name: "base_keyword",
    label: "Kata kunci dasar",
    type: "text",
    group: "Kata Kunci",
    wide: true,
    help: "Satu frasa pendek. AI mengembangkannya jadi beberapa kata kunci long-tail.",
  },
  {
    name: "total_keyword",
    label: "Jumlah kata kunci",
    type: "int",
    min: 1,
    max: AUTOPOST_MAX_GENERATED,
    group: "Kata Kunci",
    help: "1–100. AI sering mengembalikan lebih sedikit dari yang diminta; selisihnya disebutkan, bukan disembunyikan.",
  },
  {
    name: "bahasa",
    label: "Bahasa kata kunci",
    type: "text",
    group: "Kata Kunci",
  },
];

const ARTICLE_SECTION = "Artikel";
const CONTENT_SECTION = "Isi & Publikasi";

export const AUTOPOST_FIELDS = [
  { name: "bahasa", label: "Bahasa", type: "text", group: ARTICLE_SECTION },
  {
    name: "gaya_bahasa",
    label: "Gaya bahasa",
    type: "text",
    group: ARTICLE_SECTION,
    help: "Bebas teks — apa yang ditulis di sini diteruskan apa adanya ke AI.",
  },
  {
    name: "kedalaman",
    label: "Kedalaman artikel",
    type: "text",
    group: ARTICLE_SECTION,
    help: 'Menentukan jumlah poin outline: "L4" → 7 poin, "L5"/"oasis" → 10, selain itu 5.',
  },
  {
    name: "bypass_ai",
    label: "Bypass AI",
    type: "enum",
    options: ["original", "zerogpt", "sinonim"],
    optionLabels: { original: "Original", zerogpt: "ZeroGPT", sinonim: "Sinonim" },
    required: true,
    group: ARTICLE_SECTION,
  },
  {
    name: "custom_prompt",
    label: "Kustomisasi prompt",
    type: "textarea",
    group: ARTICLE_SECTION,
    wide: true,
    help: "Instruksi tambahan untuk AI. Kosongkan kalau tidak ada.",
  },

  {
    name: "status_artikel",
    label: "Status artikel",
    type: "enum",
    options: ["publish", "draft", "penjadwalan", "future"],
    optionLabels: {
      publish: "Terbit",
      draft: "Draf",
      penjadwalan: "Terjadwal",
      future: "Future",
    },
    required: true,
    group: CONTENT_SECTION,
  },
  {
    name: "penjadwalan",
    label: "Penjadwalan",
    type: "text",
    group: CONTENT_SECTION,
    help: 'Hanya dipakai kalau statusnya Terjadwal. Bentuknya <angka>_minutes atau <angka>_hours (mis. "30_minutes" atau "1_hours").',
  },
  {
    name: "author_id",
    label: "ID penulis",
    type: "int",
    min: 1,
    group: CONTENT_SECTION,
    help: "ID user WordPress di situs itu, bukan nama.",
  },
  {
    name: "kategori",
    label: "Kategori",
    type: "text",
    group: CONTENT_SECTION,
    help: '"Auto" berarti kategorinya ditentukan AI; selain itu dicari/dibuat berdasarkan slug.',
  },
  {
    name: "generate_image",
    label: "Featured image",
    type: "boolean",
    group: CONTENT_SECTION,
    help: "Scrape gambar dari Bing dan pasang sebagai featured image.",
  },
  {
    name: "tag_otomatis",
    label: "Tag otomatis",
    type: "boolean",
    group: CONTENT_SECTION,
    help: "Pasang tag saran AI.",
  },
];

/**
 * Bawaan form — kolom "Default REST" di Lampiran E.2, dengan SATU penyimpangan yang disengaja.
 *
 * Bawaan REST berbeda dari bawaan layar `page=rabbitroi-auto-post` di tiga tempat. Dua di antaranya
 * mengikuti REST, satu mengikuti layar plugin:
 *
 *   penjadwalan     `5_minutes` di layar plugin, `1_hours` di REST   -> REST
 *   generate_image  menyala di layar plugin, `false` di REST         -> REST
 *   tag_otomatis    menyala di layar plugin, `false` di REST         -> LAYAR PLUGIN (true)
 *
 * Yang membedakan kedua sakelar itu adalah HARGA menyalakannya, bukan selera. `generate_image`
 * menambah satu tahap tersendiri ke tiap job — `featured_image` di 75%, yang men-scrape Bing dan
 * bisa gagal sendiri tanpa menjatuhkan artikelnya — jadi menyalakannya untuk seluruh armada adalah
 * keputusan yang harus diambil orang, bukan yang diwarisi dari kotak yang tidak ia sentuh.
 * `tag_otomatis` tidak menambah panggilan apa pun: tag datang bersama jawaban AI yang sama, dan
 * artikel tanpa tag adalah kerugian yang baru terbaca berminggu-minggu kemudian di halaman arsip
 * yang tidak punya satu pun jalan masuk.
 *
 * Karena form SELALU mengirim seluruh field ini (lihat `toAutopostPayload`), bawaan di sini tidak
 * pernah bisa diam-diam berbeda dari yang dikirim: yang tergambar di layar adalah yang berangkat.
 * Nilainya jadi tidak menentukan apa pun selain titik awal yang dilihat orang — dan justru itu yang
 * membuat penyimpangan di atas boleh ada sama sekali: ia menggeser sakelar yang terlihat, bukan
 * perilaku yang tersembunyi. Yang tidak boleh adalah menyimpang TANPA menuliskannya di sini, karena
 * satu-satunya cara memeriksa daftar ini adalah mengadunya dengan dokumen.
 */
export const AUTOPOST_DEFAULTS = {
  bahasa: "English",
  gaya_bahasa: "Bahasa Santai Resmi",
  kedalaman: "Oasis of Knowledge (L4)",
  status_artikel: "publish",
  penjadwalan: "1_hours",
  author_id: 1,
  kategori: "Auto",
  generate_image: false,
  tag_otomatis: true,
  bypass_ai: "original",
  custom_prompt: "",
};

// Lampiran E.1, kolom "Default REST". `base_keyword` wajib dan karena itu tidak punya bawaan —
// kosong di sini berarti kotaknya kosong, bukan sebuah nilai yang dikirim.
export const AUTOPOST_KEYWORD_DEFAULTS = {
  base_keyword: "",
  total_keyword: 20,
  bahasa: "English",
};

export const AUTOPOST_SCHEMA = {
  autopost: {
    title: "AutoPost",
    fields: AUTOPOST_FIELDS,
    defaults: AUTOPOST_DEFAULTS,
    // Satu kolom TIDAK dipakai: hampir tiap field di sini pendek, dan tab ini sudah panjang karena
    // daftar job di bawahnya.
  },
  "autopost-keywords": {
    title: "Kata Kunci",
    fields: AUTOPOST_KEYWORD_FIELDS,
    defaults: AUTOPOST_KEYWORD_DEFAULTS,
    columns: 1,
  },
};

// --- Payload --------------------------------------------------------------------------------------

function aiKeyOf(value) {
  const key = String(value ?? "").trim();
  if (!key) {
    throw new PluginError(
      "Kunci API AI wajib diisi — providernya dibaca dari awalan kunci itu sendiri.",
    );
  }
  return key;
}

function payloadOf(fields, values, defaults) {
  const payload = {};
  for (const field of fields) {
    // Bawaan dipakai untuk field yang tidak dikirim sama sekali, bukan untuk yang DIKOSONGKAN
    // orang: mengosongkan "Kustomisasi prompt" adalah tindakan yang disengaja, dan bawaan yang
    // menang atasnya akan mengembalikan instruksi yang baru saja dihapus.
    const raw = Object.hasOwn(values || {}, field.name) ? values[field.name] : defaults[field.name];
    const normalized = normalizeField(field, raw);
    if (normalized === null) continue;
    payload[field.name] = normalized;
  }
  return payload;
}

/**
 * Nilai form → body `POST /autopost/keywords`.
 *
 * Berbeda dari `toPluginPayload`, ini BUKAN partial: tidak ada yang tersimpan di situs untuk
 * ditimpa — tiap permintaan berdiri sendiri, dan field yang tidak dikirim jatuh ke bawaan REST yang
 * tidak selalu sama dengan yang tergambar di layar.
 */
export function toKeywordPayload(aiKey, values) {
  const payload = payloadOf(AUTOPOST_KEYWORD_FIELDS, values, AUTOPOST_KEYWORD_DEFAULTS);
  if (!payload.base_keyword) {
    throw new PluginError("Kata kunci dasar wajib diisi.");
  }
  return { ...payload, ai_key: aiKeyOf(aiKey) };
}

/**
 * Satu kata kunci + setelan form → body `POST /autopost`.
 *
 * Seluruh field dikirim, termasuk yang tidak disentuh siapa pun. Alasannya bawaan REST yang berbeda
 * dari yang tergambar di layar, dan `tag_otomatis` adalah contoh yang hidup: ia menyala di form ini
 * dan `false` di REST kalau tidak dikirim. Mengirim hanya yang berubah berarti sakelar yang MENYALA
 * di layar menghasilkan artikel tanpa tag — dan tidak ada apa pun yang membedakan itu dari AI yang
 * kebetulan tidak menyarankan tag apa pun.
 */
export function toAutopostPayload(keyword, aiKey, values) {
  const text = String(keyword ?? "").trim();
  if (!text) throw new PluginError("Kata kunci tidak boleh kosong.");

  const payload = payloadOf(AUTOPOST_FIELDS, values, AUTOPOST_DEFAULTS);

  // Jadwal cuma berarti untuk satu status, dan mengirimnya di status lain adalah field yang
  // menunggu untuk disalahpahami saat seseorang membaca ulang permintaannya.
  if (payload.status_artikel !== "penjadwalan") delete payload.penjadwalan;

  return { ...payload, keyword: text, ai_key: aiKeyOf(aiKey) };
}

/**
 * Textarea → daftar kata kunci yang benar-benar dikirim.
 *
 * Dipisah per BARIS saja, tidak per koma — sengaja berbeda dari `mediaList`. Kata kunci long-tail
 * memuat koma ("wordpress seo plugin, gratis atau berbayar"), dan yang dipecah di sana menghasilkan
 * dua job untuk dua potongan kalimat yang tidak berarti apa-apa sendirian.
 *
 * Duplikat dibuang tanpa memandang kapitalisasi: AutoPost tidak punya dedup sama sekali — kata
 * kunci yang sama dikirim dua kali menghasilkan dua artikel, dan daftar yang ditempel dari
 * spreadsheet hampir selalu memuat pengulangan.
 */
export function autopostKeywords(value) {
  const lines = Array.isArray(value) ? value : String(value ?? "").split(/[\r\n]+/);
  const seen = new Set();
  const keywords = [];
  for (const line of lines) {
    const text = String(line ?? "").trim();
    if (!text) continue;
    const fingerprint = text.toLowerCase();
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    keywords.push(text);
  }
  return keywords;
}

// --- Jawaban -----------------------------------------------------------------------------------------

/**
 * Jawaban `/autopost/keywords` → daftar bersih + berapa yang benar-benar datang.
 *
 * `requested` dan `total` DIBAWA KEDUANYA, bukan dilebur. AI kerap mengembalikan lebih sedikit dari
 * yang diminta, dan itu satu-satunya cara mengetahuinya: 20 diminta, 13 datang, dan yang tergambar
 * di layar tanpa kedua angka itu cuma daftar berisi 13 baris yang tampak lengkap.
 */
export function keywordResult(data) {
  const keywords = autopostKeywords(
    (Array.isArray(data?.keywords) ? data.keywords : []).map((item) => String(item ?? "")),
  );
  return {
    baseKeyword: String(data?.base_keyword || ""),
    bahasa: String(data?.bahasa || ""),
    requested: Number(data?.requested || 0),
    total: keywords.length,
    keywords,
  };
}

/**
 * Satu baris job, dalam bentuk yang dipakai tabel.
 *
 * `stalled` DIPERTAHANKAN sebagai field tersendiri walau statusnya sudah `failed`. Keduanya
 * menuntut tindakan yang berbeda: gagal biasa punya sebab yang tertulis di `message` dan bisa
 * diperbaiki (kunci AI, kuota, kategori), sementara `stalled` berarti proses PHP-nya dibunuh server
 * — tidak ada yang salah dengan permintaannya, dan yang perlu dilakukan cuma mengirimnya lagi.
 */
export function jobRow(job) {
  const id = String(job?.job_id ?? "").trim();
  if (!id) return null;

  const final = job?.final && typeof job.final === "object" ? job.final : null;
  return {
    jobId: id,
    source: String(job?.source || ""),
    status: String(job?.status || ""),
    stage: String(job?.stage || ""),
    stageLabel: String(job?.stage_label || ""),
    progress: Number(job?.progress || 0),
    keyword: String(job?.keyword || ""),
    message: String(job?.message || ""),
    postId: Number(job?.post_id || 0),
    stalled: job?.stalled === true,
    createdAt: Number(job?.created_at || 0),
    updatedAt: Number(job?.updated_at || job?.last_update || 0),
    idleSeconds: Number(job?.idle_seconds || 0),
    ageSeconds: Number(job?.age_seconds || 0),
    // `logs` hilang sama sekali dari `/jobs` tanpa `include_logs`, diganti `log_count`. Keduanya
    // dibawa: daftar yang kosong di sana berarti "tidak diminta", bukan "tidak ada log".
    logs: logLines(job?.logs),
    logCount: Number(job?.log_count ?? (Array.isArray(job?.logs) ? job.logs.length : 0)),
    permalink: String(final?.permalink || ""),
    finalMessage: String(final?.message || ""),
  };
}

/**
 * Jawaban `/autopost/jobs` → baris + ringkasannya.
 *
 * Diurutkan dari yang TERBARU, bukan dipercaya apa adanya: yang dibaca orang saat membuka tab ini
 * adalah apa yang baru saja ia kirim, dan urutan yang datang dari sisi plugin tidak dijanjikan
 * di dokumen mana pun.
 */
export function jobList(data) {
  const jobs = (Array.isArray(data?.jobs) ? data.jobs : [])
    .map(jobRow)
    .filter(Boolean)
    .sort((left, right) => right.createdAt - left.createdAt);

  const summary = data?.summary && typeof data.summary === "object" ? data.summary : {};
  return {
    jobs,
    total: Number(data?.total || jobs.length),
    summary: {
      running: Number(summary.running || 0),
      done: Number(summary.done || 0),
      failed: Number(summary.failed || 0),
    },
    // Ambang "berhenti berdetak" datang dari situsnya, bukan diketik di sini: yang memutuskan
    // sebuah job mati adalah plugin, dan angka kedua di sisi kita akan berselisih dengannya.
    staleSeconds: Number(data?.stale_seconds || 0),
    serverTime: Number(data?.server_time || 0),
  };
}

/**
 * Hasil satu pengiriman — sekosakata dengan `bulkRow` di plugin-core.js.
 *
 * BEDANYA satu, dan itu yang menentukan: di sini tidak ada `unapplied`. AutoPost bukan partial
 * update yang bisa "tersimpan tapi tidak berubah"; ia menerima atau menolak, dan yang diterima
 * menghasilkan `job_id` yang bisa dipantau. Yang menggantikan tempat `unapplied` adalah tahap
 * job-nya sendiri, yang baru terbaca beberapa menit kemudian.
 */
export function submitRow(keyword, { jobId = "", error = "" } = {}) {
  return {
    keyword: String(keyword || ""),
    jobId: String(jobId || ""),
    status: jobId ? "ok" : "failed",
    error: String(error || ""),
  };
}

export function submitSummary(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return {
    total: list.length,
    ok: list.filter((row) => row.status === "ok").length,
    failed: list.filter((row) => row.status === "failed").length,
  };
}
