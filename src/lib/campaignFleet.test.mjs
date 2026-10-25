import assert from "node:assert/strict";
import test from "node:test";
import {
  adSetEditState,
  budgetChangeNote,
  bulkResultMessage,
  campaignJobNote,
  campaignJobRows,
  copyDefaultName,
  copyJobNote,
  copyJobRows,
  countryLabel,
  filterFleetRows,
  finishedJobToasts,
  fleetFilterOptions,
  jobStateMap,
  parseCountryInput,
  runEach,
  runningCopyFor,
  sameCountries,
  sortFleetRows,
  UNMAPPED_FILTER,
} from "./campaignFleet.js";

const ROWS = [
  { userId: "u1", owner: "Nurjaman", campaign: "TvH1-06 Pros", campaignCode: "tvh1", account: "TBZ 1247", subDomain: "puppy.petcins.com", status: "Aktif", configuredStatus: "ACTIVE" },
  { userId: "u2", owner: "Aldi", campaign: "Tanpa kode", campaignCode: "", account: "Lincah", subDomain: "", status: "Tidak aktif", configuredStatus: "PAUSED" },
  { userId: "u1", owner: "Nurjaman", campaign: "5rx7-01", campaignCode: "5rx7", account: "TBZ 1247", subDomain: "dog.petcins.com", status: "Aktif", configuredStatus: "ACTIVE" },
];

test("penyaring armada: nama/kode, pemilik, akun, subdomain, status", () => {
  assert.equal(filterFleetRows(ROWS, { q: "TVH1" }).length, 1);
  assert.equal(filterFleetRows(ROWS, { owner: "u1" }).length, 2);
  assert.equal(filterFleetRows(ROWS, { account: "Lincah" }).length, 1);
  assert.deepEqual(filterFleetRows(ROWS, { subDomain: UNMAPPED_FILTER }).map((row) => row.campaign), ["Tanpa kode"]);
  assert.equal(filterFleetRows(ROWS, { subDomain: "dog.petcins.com" }).length, 1);
  assert.equal(filterFleetRows(ROWS, { status: "Aktif" }).length, 2);
  assert.equal(filterFleetRows(ROWS, {}).length, 3);
});

test("pilihan penyaring diambil dari baris yang ada", () => {
  const options = fleetFilterOptions(ROWS);
  assert.deepEqual(options.owners, [
    { value: "u2", label: "Aldi" },
    { value: "u1", label: "Nurjaman" },
  ]);
  assert.deepEqual(options.accounts, ["Lincah", "TBZ 1247"]);
  assert.deepEqual(options.subDomains, ["dog.petcins.com", "puppy.petcins.com"]);
  assert.deepEqual(options.statuses, ["Aktif", "Tidak aktif"]);
});

test("urutan: saklar On dulu, lalu nama", () => {
  assert.deepEqual(sortFleetRows(ROWS).map((row) => row.campaign), ["5rx7-01", "TvH1-06 Pros", "Tanpa kode"]);
});

test("baris job: terbaru dulu, label dan jumlah yang lahir", () => {
  const rows = copyJobRows({
    ja: { state: "done", sourceCampaignId: "1", sourceName: "A", names: ["A2"], count: 1, copies: [{ campaignId: "9", renameError: "x" }], requestedAt: "2026-09-10T00:00:00.000Z" },
    jb: { state: "running", sourceCampaignId: "2", sourceName: "B", names: { 0: "B #1", 1: "B #2" }, count: 2, progress: { done: 3, total: 10 }, requestedAt: "2026-09-11T00:00:00.000Z" },
  });
  assert.deepEqual(rows.map((row) => row.id), ["jb", "ja"]);
  assert.equal(rows[0].label, "Berjalan");
  assert.equal(rows[0].tone, "info");
  assert.deepEqual(rows[0].names, ["B #1", "B #2"]);
  assert.equal(rows[1].born, 1);
  assert.equal(rows[1].renameErrors, 1);
  assert.deepEqual(rows[0].progress, { done: 3, total: 10 });
  assert.equal(copyJobNote(rows[0]), "Menyalin ad set 3 dari 10.");
  assert.equal(copyJobNote({ state: "requested", progress: { done: 0, total: 0 } }), "Sedang disiapkan.");
  assert.match(copyJobNote(rows[1]), /belum berganti nama/);
  assert.equal(runningCopyFor(rows, "2"), true);
  assert.equal(runningCopyFor(rows, "1"), false);
  assert.deepEqual(copyJobRows(null), []);
});

test("job unknown selalu menyuruh memeriksa Ads Manager", () => {
  const rows = copyJobRows({
    jrun: {
      state: "unknown",
      sourceCampaignId: "1",
      error: "Hasil salinan tidak pasti (Meta 1/copies -> x (#2)) — salinannya mungkin sudah lahir; jangan menyalin lagi sebelum periksa Ads Manager.",
      copies: [{ name: "A", campaignId: "", uncertain: true }],
      requestedAt: "2026-09-11T00:00:00.000Z",
    },
    jbare: { state: "unknown", sourceCampaignId: "2", requestedAt: "2026-09-10T00:00:00.000Z" },
  });
  assert.deepEqual(rows.map((row) => [row.label, row.tone]), [["Tidak diketahui", "warning"], ["Tidak diketahui", "warning"]]);
  for (const row of rows) assert.match(copyJobNote(row), /periksa Ads Manager/);
  assert.equal(runningCopyFor(rows, "1"), false, "unknown bukan lagi berjalan");
});

test("nama salinan bawaan bukan nama sumbernya, dan membawa kodenya", () => {
  assert.equal(copyDefaultName({ campaign: "TvH1-06 Pros" }), "TvH1-06 Pros (salinan)");
});

test("ubah ad set: umur bawaan 18/65 bukan perubahan kalau Meta tidak mengirim umur", () => {
  const current = {
    name: "Adset 1",
    dailyBudget: null,
    budget: { editable: false },
    targeting: { editable: true, countries: ["TR"], ageMin: null, ageMax: null },
  };
  const untouched = adSetEditState(current, {});
  assert.equal(untouched.values.ageMin, 18);
  assert.equal(untouched.values.ageMax, 65);
  assert.equal(untouched.changed, false);
  // Ganti nama saja: tidak ada targeting yang ikut dikirim.
  const renamed = adSetEditState(current, { name: "Adset 1 baru" });
  assert.deepEqual(renamed.changes, { name: "Adset 1 baru" });
  assert.deepEqual(renamed.lines, []);
  // Umur yang benar-benar disentuh ikut, dan hanya sisi yang disentuh.
  const aged = adSetEditState(current, { ageMin: "21" });
  assert.deepEqual(aged.changes, { ageMin: 21 });
  assert.deepEqual(aged.lines, ["Umur: 18–65 → 21–65"]);
  // Disentuh lalu dikembalikan ke nilai Meta: bukan perubahan.
  const known = { ...current, targeting: { ...current.targeting, ageMin: 25, ageMax: 40 } };
  assert.equal(adSetEditState(known, { ageMin: "25" }).changed, false);
  assert.deepEqual(adSetEditState(known, { ageMax: "45" }).changes, { ageMax: 45 });
  assert.deepEqual(adSetEditState(known, { countries: "tr, mx" }).changes, { countries: ["TR", "MX"] });
  assert.equal(adSetEditState(null, {}).changed, false, "belum terbaca: tidak ada perubahan");
});

test("negara: teks berkoma jadi kode, urutan tidak dianggap perubahan", () => {
  assert.deepEqual(parseCountryInput("tr, mx  MX"), ["TR", "MX"]);
  assert.equal(sameCountries(["TR", "MX"], ["MX", "TR"]), true);
  assert.equal(sameCountries(["TR"], ["TR", "MX"]), false);
  assert.notEqual(countryLabel("TR"), "TR", "nama negara dibaca lewat Intl.DisplayNames");
  assert.equal(countryLabel("12"), "12", "kode tidak sah dikembalikan apa adanya");
});

test("catatan perubahan anggaran menyebut lama, baru, dan persennya", () => {
  assert.equal(budgetChangeNote(50000, 75000), "Rp 50.000 → Rp 75.000 (+50%)");
  assert.equal(budgetChangeNote(80000, 60000), "Rp 80.000 → Rp 60.000 (-25%)");
});

test("panel Pekerjaan memuat kedua jenis job, terbaru dulu", () => {
  const rows = campaignJobRows(
    {
      j1: {
        sourceCampaignId: "120210",
        sourceName: "TvH1-06 Pros",
        names: ["TvH1-07 Pros"],
        count: 1,
        state: "done",
        copies: [{ campaignId: "900" }],
        requestedAt: "2026-09-12T01:00:00.000Z",
      },
    },
    {
      j2: {
        accountId: "k1",
        accountName: "BD - R42",
        name: "TvH1-08 Pros MEA",
        subDomain: "puppy.petcins.com",
        variants: 2,
        state: "partial",
        campaignId: "901",
        adSets: [{ adId: "1" }, { adId: "", error: "creative ditolak" }],
        error: "1 dari 2 iklan lahir",
        requestedAt: "2026-09-12T02:00:00.000Z",
      },
    },
  );
  assert.deepEqual(
    rows.map((row) => row.kind),
    ["create", "copy"],
    "terbaru dulu",
  );
  const [create, copy] = rows;
  assert.equal(create.kindLabel, "Buat");
  assert.equal(create.title, "TvH1-08 Pros MEA");
  assert.equal(create.subtitle, "ke puppy.petcins.com");
  // Yang lahir dihitung dari IKLAN, bukan ad set: ad set tanpa iklan adalah persis keadaan yang
  // ditinggalkan app Development Mode.
  assert.equal(create.born, 1);
  assert.equal(create.count, 2);
  assert.equal(copy.kindLabel, "Salin");
  assert.equal(copy.subtitle, "dari TvH1-06 Pros");
  assert.equal(campaignJobNote(create), "1 dari 2 iklan lahir");
  // Baris job BUAT tidak boleh membuat tombol Duplikasi baris mana pun tampak sedang berjalan.
  assert.equal(runningCopyFor(rows, "120210"), false);
});

test("job buat yang berjalan menyebut progres iklannya", () => {
  const [row] = campaignJobRows(
    {},
    { j1: { name: "x", state: "running", variants: 3, progress: { done: 1, total: 3 } } },
  );
  assert.equal(campaignJobNote(row), "Membuat iklan 1 dari 3.");
  const [none] = campaignJobRows({}, { j1: { name: "x", state: "running", variants: 3 } });
  assert.equal(campaignJobNote(none), "Sedang disiapkan.");
  const [unknown] = campaignJobRows({}, { j1: { name: "x", state: "unknown", variants: 1 } });
  assert.match(campaignJobNote(unknown), /periksa Ads Manager/);
});

test("toast hasil: satu per perpindahan, dan pembacaan pertama tidak berbunyi", () => {
  const copyJobs = {
    j1: {
      sourceCampaignId: "1",
      sourceName: "TvH1-06 Pros",
      names: ["TvH1-07 Pros"],
      count: 1,
      state: "running",
      requestedAt: "2026-09-12T07:00:00.000Z",
    },
  };
  const running = campaignJobRows(copyJobs, {});
  // Pembacaan PERTAMA sesi tidak menoast apa pun: node job menyimpan tujuh hari riwayat, dan tanpa
  // aturan ini membuka halaman memuntahkan toast tentang pekerjaan yang sudah lama selesai.
  assert.deepEqual(finishedJobToasts(null, running), []);
  const before = jobStateMap(running);
  assert.deepEqual(before, { j1: "running" });

  const done = campaignJobRows(
    { j1: { ...copyJobs.j1, state: "done", copies: [{ campaignId: "900", ads: 5, adsExpected: 5 }] } },
    {},
  );
  const [ok] = finishedJobToasts(before, done);
  assert.equal(ok.tone, "success");
  // Iklan disebut terpisah dari campaign-nya: itu yang menerangkan utuh-tidaknya sebuah salinan.
  assert.equal(ok.message, 'Salinan "TvH1-07 Pros" selesai — 1 campaign, 5 iklan lahir.');
  // Dibaca lagi tanpa perpindahan: diam. Yang sudah selesai tidak diumumkan tiap kali node-nya
  // berubah karena job lain menulis progres.
  assert.deepEqual(finishedJobToasts(jobStateMap(done), done), []);

  // Job yang muncul pertama kali sudah selesai bukan pekerjaan yang kita saksikan berjalan.
  assert.deepEqual(finishedJobToasts({}, done), []);
});

test("toast hasil: gagal dan sebagian menyebut sebabnya, yang panjang menunjuk panel", () => {
  const job = (state, error) => ({
    j1: {
      sourceCampaignId: "1",
      sourceName: "TvH1-06 Pros",
      names: ["TvH1-07 Pros"],
      count: 1,
      state,
      error,
      copies: [{ campaignId: state === "failed" ? "" : "900", ads: 0, adsExpected: 1 }],
      requestedAt: "2026-09-12T07:00:00.000Z",
    },
  });
  const before = { j1: "running" };
  const [failed] = finishedJobToasts(before, campaignJobRows(job("failed", "Nama sudah dipakai."), {}));
  assert.equal(failed.tone, "warning");
  assert.equal(failed.message, 'Salinan "TvH1-07 Pros" gagal. Nama sudah dipakai.');

  const long = `Adset 1: iklan tidak bisa dibuatkan ulang (Halaman 1057042520835849) — ${"x".repeat(200)}`;
  const [partial] = finishedJobToasts(before, campaignJobRows(job("partial", long), {}));
  // Kalimat Meta utuh tidak dipotong di tengah: ekornya justru yang menyebut tindakannya.
  assert.equal(
    partial.message,
    'Salinan "TvH1-07 Pros" selesai sebagian — 1 dari 1 campaign, 0 dari 1 iklan lahir. Sebabnya ada di panel Pekerjaan.',
  );

  // `unknown` tanpa kalimat tetap menyuruh memeriksa Ads Manager, sepola panelnya.
  const [unsure] = finishedJobToasts(before, campaignJobRows(job("unknown", ""), {}));
  assert.match(unsure.message, /hasilnya tidak pasti\. Server tidak tahu.*Ads Manager/);
});

test("toast hasil: job BUAT campaign memakai kosakatanya sendiri", () => {
  const createJobs = {
    j2: {
      accountId: "k1",
      name: "mxXW-01 Pros MEA",
      variants: 2,
      state: "running",
      requestedAt: "2026-09-12T07:00:00.000Z",
    },
  };
  const before = jobStateMap(campaignJobRows({}, createJobs));
  const done = campaignJobRows(
    {},
    { j2: { ...createJobs.j2, state: "done", adSets: [{ adId: "1" }, { adId: "2" }] } },
  );
  const [toast] = finishedJobToasts(before, done);
  assert.equal(toast.message, 'Campaign "mxXW-01 Pros MEA" selesai — 2 iklan lahir.');
});

test("tindakan massal: satu yang gagal tidak menghentikan sisanya, dan disebut namanya", async () => {
  const seen = [];
  const result = await runEach(
    [{ campaign: "A" }, { campaign: "B" }, { campaign: "C" }],
    async (row) => {
      seen.push(row.campaign);
      if (row.campaign === "B") throw new Error("ditolak Meta");
    },
  );
  assert.deepEqual(seen, ["A", "B", "C"]);
  assert.equal(result.done, 2);
  assert.equal(
    bulkResultMessage("Dimatikan", result),
    "Dimatikan 2 dari 3 campaign. Gagal — B: ditolak Meta",
  );
  assert.equal(bulkResultMessage("Dimatikan", { done: 3, failed: [] }), "Dimatikan 3 dari 3 campaign.");
});
