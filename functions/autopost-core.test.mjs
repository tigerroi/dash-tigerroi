import assert from "node:assert";
import test from "node:test";

const {
  AUTOPOST_DEFAULTS,
  AUTOPOST_FIELDS,
  AUTOPOST_KEYWORD_FIELDS,
  AUTOPOST_MAX_KEYWORDS,
  AUTOPOST_NAMESPACE,
  AUTOPOST_SCHEMA,
  autopostBaseUrl,
  autopostKeywords,
  jobList,
  jobRow,
  keywordResult,
  submitRow,
  submitSummary,
  toAutopostPayload,
  toKeywordPayload,
  unwrapAutopost,
} = await import("./autopost-core.js");

const { PLUGIN_GROUPS, PLUGIN_NAMESPACE, PluginError } = await import("./plugin-core.js");

test("alamatnya DI LUAR /manage/ — kalau tidak, tiap permintaan menjawab rest_no_route", () => {
  assert.equal(AUTOPOST_NAMESPACE, "/wp-json/rabbitroi/v1/autopost");
  assert.ok(!AUTOPOST_NAMESPACE.includes("/manage"));
  assert.equal(autopostBaseUrl("sub.domain.com"), `https://sub.domain.com${AUTOPOST_NAMESPACE}`);

  // Penormal hostname-nya dipakai bersama dengan plugin-core: bentuk yang ditolak di sana ditolak
  // di sini juga, dan yang dibersihkan di sana dibersihkan di sini.
  assert.equal(
    autopostBaseUrl("https://Sub.Domain.com/"),
    `https://sub.domain.com${AUTOPOST_NAMESPACE}`,
  );
  assert.throws(() => autopostBaseUrl("bukan host"), PluginError);
  assert.throws(() => autopostBaseUrl(""), PluginError);
});

test("AutoPost TIDAK ikut daftar putih :group — ia punya route-nya sendiri", () => {
  // `groupName()` di server menyambung `:group` mentah jadi segmen di dalam `/manage/`. AutoPost
  // tidak tinggal di sana, dan menambahkannya ke daftar ini akan menghasilkan alamat yang salah
  // sambil membuka kembali jalan yang daftar itu ada untuk menutupnya.
  assert.ok(!PLUGIN_GROUPS.includes("autopost"));
  assert.ok(!PLUGIN_GROUPS.includes("autopost-keywords"));
  assert.ok(!AUTOPOST_NAMESPACE.startsWith(PLUGIN_NAMESPACE));
});

test("unwrapAutopost: pesan gagal di AKAR, bukan di error.code", () => {
  assert.deepEqual(unwrapAutopost({ success: true, data: { job_id: "9f2c" } }), { job_id: "9f2c" });
  // `data` boleh objek kosong, tapi tidak boleh hilang.
  assert.deepEqual(unwrapAutopost({ success: true }), {});

  // Bentuk inilah yang jadi alasan modul ini terpisah dari plugin-core: `unwrapPlugin` membaca
  // `body.error?.message` dan menemukan `undefined`, jadi sebab yang benar-benar berguna hilang.
  const failure = (() => {
    try {
      unwrapAutopost(
        { success: false, message: "Error Gemini: API key not valid", logs: ["a", ""] },
        502,
      );
      return null;
    } catch (error) {
      return error;
    }
  })();
  assert.ok(failure instanceof PluginError);
  assert.equal(failure.message, "Error Gemini: API key not valid");
  assert.equal(failure.status, 502);
  // Log dibawa serta: untuk kegagalan AI ia satu-satunya jendela ke apa yang benar-benar terjadi.
  assert.deepEqual(failure.logs, ["a"]);
});

test("unwrapAutopost: rest_no_route berarti PLUGINNYA yang lama, bukan kunci yang salah", () => {
  assert.throws(
    () => unwrapAutopost({ code: "rest_no_route", message: "No route", data: { status: 404 } }),
    (error) => {
      assert.equal(error.code, "rest_no_route");
      assert.match(error.message, /perbarui pluginnya/i);
      return true;
    },
  );

  // Kode WordPress lain tetap lewat kalimat yang sama dengan sisi manajemen — satu kosakata untuk
  // satu kunci yang sama.
  assert.throws(
    () => unwrapAutopost({ code: "invalid_key", message: "x", data: { status: 401 } }),
    (error) => {
      assert.equal(error.code, "invalid_key");
      assert.equal(error.status, 401);
      return true;
    },
  );

  // Halaman HTML (WAF, halaman login) sampai ke sini sebagai null.
  assert.throws(() => unwrapAutopost(null, 403), /tanpa JSON/);
  assert.throws(() => unwrapAutopost({ hello: 1 }), /tidak dikenal/);
});

test("toKeywordPayload: kunci AI dan kata dasar wajib, batas atas ditolak di sini", () => {
  assert.deepEqual(
    toKeywordPayload("AIzaSy", { base_keyword: " seo plugin ", total_keyword: 30 }),
    {
      base_keyword: " seo plugin ",
      total_keyword: 30,
      bahasa: "English",
      ai_key: "AIzaSy",
    },
  );

  assert.throws(() => toKeywordPayload("", { base_keyword: "x" }), /Kunci API AI/);
  assert.throws(() => toKeywordPayload("AIzaSy", {}), /Kata kunci dasar/);
  // Plugin menjepit 1-100 DIAM-DIAM: yang meminta 500 menerima 100 dengan `success: true`, dan
  // selisihnya tidak berbunyi sebagai kesalahan di mana pun.
  assert.throws(
    () => toKeywordPayload("AIzaSy", { base_keyword: "x", total_keyword: 500 }),
    /maksimal 100/,
  );
  assert.throws(
    () => toKeywordPayload("AIzaSy", { base_keyword: "x", total_keyword: 0 }),
    /minimal 1/,
  );
});

/**
 * Bawaan form adalah kolom "Default REST" di Lampiran E.2, dengan SATU penyimpangan — dan tes ini
 * yang menahan jumlahnya tetap satu.
 *
 * Bawaan layar wp-admin berbeda dari REST di tiga tempat (`generate_image`, `tag_otomatis`,
 * `penjadwalan`). Dua mengikuti REST, `tag_otomatis` mengikuti layar plugin; alasannya di
 * `AUTOPOST_DEFAULTS`. Nilainya sendiri tidak menentukan apa pun — seluruh field selalu dikirim —
 * dan justru itu sebabnya daftarnya harus diadu satu per satu: satu-satunya cara sebuah
 * penyimpangan BARU ketahuan adalah tes yang menyebut tiap nilainya, bukan yang memeriksa
 * sebagiannya.
 */
test("bawaan payload = Default REST, kecuali tag_otomatis yang ikut layar plugin", () => {
  const payload = toAutopostPayload("best seo plugin", "AIzaSy", {});

  assert.equal(payload.keyword, "best seo plugin");
  assert.equal(payload.ai_key, "AIzaSy");
  assert.equal(payload.bahasa, "English");
  assert.equal(payload.gaya_bahasa, "Bahasa Santai Resmi");
  assert.equal(payload.kedalaman, "Oasis of Knowledge (L4)");
  assert.equal(payload.status_artikel, "publish");
  assert.equal(payload.kategori, "Auto");
  assert.equal(payload.author_id, 1);
  assert.equal(payload.bypass_ai, "original");
  assert.equal(payload.custom_prompt, "");

  // Featured image MATI: ia menambah satu tahap scrape ke Bing di tiap job, jadi menyalakannya
  // untuk seluruh armada adalah keputusan yang harus diambil orang.
  assert.equal(payload.generate_image, false);
  // Tag otomatis MENYALA — satu-satunya yang menyimpang dari dokumen. Ia tidak menambah panggilan
  // apa pun; tag datang bersama jawaban AI yang sama.
  assert.equal(payload.tag_otomatis, true);

  // Jadwal cuma berarti untuk satu status.
  assert.ok(!Object.hasOwn(payload, "penjadwalan"));
  assert.equal(
    toAutopostPayload("x", "k", { status_artikel: "penjadwalan" }).penjadwalan,
    "1_hours",
  );

  // SELURUH field dikirim, bukan yang berubah saja — itu yang membuat apa yang tergambar di layar
  // sama dengan apa yang berangkat, dan yang membuat bawaan di atas tidak pernah diam-diam
  // digantikan bawaan lain di sisi plugin.
  assert.deepEqual(
    Object.keys(payload).sort(),
    [...AUTOPOST_FIELDS.map((field) => field.name), "keyword", "ai_key"]
      .filter((name) => name !== "penjadwalan")
      .sort(),
  );

  // Yang DIKOSONGKAN orang tidak jatuh kembali ke bawaannya — mengosongkan prompt itu disengaja.
  assert.equal(toAutopostPayload("x", "k", { custom_prompt: "" }).custom_prompt, "");
  assert.equal(
    toAutopostPayload("x", "k", { custom_prompt: "pakai tabel" }).custom_prompt,
    "pakai tabel",
  );

  assert.throws(() => toAutopostPayload("", "k", {}), /Kata kunci/);
  assert.throws(() => toAutopostPayload("x", "", {}), /Kunci API AI/);
  // Enum yang tidak sah ditolak SEBELUM menyentuh jaringan, sepola dengan `normalizeField`.
  assert.throws(
    () => toAutopostPayload("x", "k", { bypass_ai: "entah" }),
    /bukan pilihan yang sah/,
  );
  assert.throws(() => toAutopostPayload("x", "k", { author_id: "dua" }), /angka bulat/);
});

test("autopostKeywords: per baris, koma dibiarkan, duplikat dibuang", () => {
  assert.deepEqual(autopostKeywords("a, b\n\n  c  \nA, B"), ["a, b", "c"]);
  assert.deepEqual(autopostKeywords(["  x ", "", "X"]), ["x"]);
  assert.deepEqual(autopostKeywords(null), []);
});

test("keywordResult: `requested` dan `total` DIBAWA KEDUANYA", () => {
  // AI kerap mengembalikan lebih sedikit dari yang diminta, dan daftar 2 baris untuk 20 yang
  // diminta tampak lengkap tanpa kedua angka itu berdampingan.
  const result = keywordResult({
    base_keyword: "seo",
    bahasa: "English",
    requested: 20,
    total: 20,
    keywords: ["a", "A", " b ", ""],
  });
  assert.equal(result.requested, 20);
  assert.equal(result.total, 2);
  assert.deepEqual(result.keywords, ["a", "b"]);
});

test("jobRow: `stalled` bertahan sebagai field tersendiri walau statusnya failed", () => {
  const row = jobRow({
    job_id: "9f2c1ab73de40571",
    source: "rest",
    status: "failed",
    stage: "stalled",
    stage_label: "Berhenti",
    progress: 100,
    keyword: "best seo plugin",
    stalled: true,
    created_at: 1757308800,
    log_count: 4,
  });
  assert.equal(row.status, "failed");
  assert.equal(row.stalled, true);
  assert.equal(row.logCount, 4);
  // `logs` kosong di sini berarti "tidak diminta", bukan "tidak ada log" — `logCount` yang
  // membedakannya.
  assert.deepEqual(row.logs, []);

  const done = jobRow({
    job_id: "a1",
    status: "done",
    final: { message: "Artikel dibuat.", permalink: "https://x/y/" },
    logs: ["satu", " "],
  });
  assert.equal(done.permalink, "https://x/y/");
  assert.equal(done.finalMessage, "Artikel dibuat.");
  assert.deepEqual(done.logs, ["satu"]);
  assert.equal(done.logCount, 2);

  assert.equal(jobRow({}), null);
  assert.equal(jobRow(null), null);
});

test("jobList: diurutkan dari yang TERBARU, bukan dipercaya apa adanya", () => {
  const list = jobList({
    jobs: [
      { job_id: "lama", created_at: 100 },
      { job_id: "baru", created_at: 900 },
      { job_id: "" },
    ],
    total: 137,
    summary: { running: 3, done: 128, failed: 6 },
    stale_seconds: 300,
  });
  assert.deepEqual(
    list.jobs.map((job) => job.jobId),
    ["baru", "lama"],
  );
  assert.equal(list.total, 137);
  assert.deepEqual(list.summary, { running: 3, done: 128, failed: 6 });
  // Ambang "berhenti berdetak" datang dari situsnya; angka kedua di sisi kita akan berselisih.
  assert.equal(list.staleSeconds, 300);

  const empty = jobList(null);
  assert.deepEqual(empty.jobs, []);
  assert.deepEqual(empty.summary, { running: 0, done: 0, failed: 0 });
});

test("submitRow / submitSummary: dua status saja, tidak ada `unapplied`", () => {
  // AutoPost bukan partial update — tidak ada "tersimpan tapi tidak berubah". Yang menggantikan
  // tempat itu adalah tahap job-nya sendiri, yang baru terbaca beberapa menit kemudian.
  const rows = [
    submitRow("a", { jobId: "j1" }),
    submitRow("b", { error: "Kuota habis." }),
    submitRow("c", { jobId: "j3" }),
  ];
  assert.deepEqual(rows[0], { keyword: "a", jobId: "j1", status: "ok", error: "" });
  assert.equal(rows[1].status, "failed");
  assert.deepEqual(submitSummary(rows), { total: 3, ok: 2, failed: 1 });
  assert.deepEqual(submitSummary(null), { total: 0, ok: 0, failed: 0 });
});

test("skema: tiap enum yang SELALU dikirim menandai dirinya `required`", () => {
  // Kotak "(tidak diubah)" hanya benar untuk grup yang POST-nya partial. Di sini seluruh field
  // dikirim, jadi yang tidak dipilih jatuh ke bawaan REST — yang tidak selalu sama dengan yang
  // tergambar di layar.
  for (const field of AUTOPOST_FIELDS) {
    if (field.type !== "enum") continue;
    assert.equal(field.required, true, `${field.name} harus required`);
  }

  // Tiap field punya bawaan, dan tiap bawaan punya fieldnya — bawaan yatim tidak pernah terkirim,
  // dan field tanpa bawaan diam-diam jatuh ke bawaan REST.
  const names = AUTOPOST_FIELDS.map((field) => field.name).sort();
  assert.deepEqual(Object.keys(AUTOPOST_DEFAULTS).sort(), names);

  assert.equal(AUTOPOST_SCHEMA.autopost.fields, AUTOPOST_FIELDS);
  assert.equal(AUTOPOST_SCHEMA["autopost-keywords"].fields, AUTOPOST_KEYWORD_FIELDS);
  assert.ok(AUTOPOST_MAX_KEYWORDS > 0);
});
