import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  countryPresetEntry,
  countryPresetsFor,
  createAccountOptions,
  createCampaignPayload,
  createReviewLines,
  createSubDomainOptions,
  emptyVariant,
  filledVariants,
  nextCampaignName,
  resizeVariants,
  toggleVariantImage,
} from "./campaignCreate.js";

test("ad account: yang dihapus dan yang sync-nya mati tidak ditawarkan", () => {
  const options = createAccountOptions({
    k1: { actId: "act_1", name: "BD - R42" },
    k2: { actId: "act_2", name: "Lincah", syncDisabled: "disuspend" },
    k3: { actId: "act_3", name: "Dihapus", deletedAt: "2026-09-01" },
    k4: { name: "Tanpa actId" },
    k5: { actId: "act_5", name: "Aca WL" },
  });
  assert.deepEqual(
    options.map((item) => item.id),
    ["k5", "k1"],
  );
});

test("id-nya KUNCI RTDB baris itu, bukan nomor urutnya di array store", () => {
  // `store.adAccounts` dan `store.subDomains` datang sebagai array ber-`id` (snapshotToArray).
  // Dibaca sebagai peta, "kunci" yang terkirim adalah "0"/"1" — dan server menjawab 404 untuk tiap
  // akun yang dipilih, kegagalan yang terbaca seperti barisnya tidak ada.
  const accounts = createAccountOptions([
    { id: "-N1abc", actId: "act_1", name: "BD - R42" },
    { id: "-N2def", actId: "act_2", name: "Aca WL" },
  ]);
  assert.deepEqual(
    accounts.map((item) => item.id),
    ["-N2def", "-N1abc"],
  );
  const { targets } = createSubDomainOptions([
    {
      id: "-Nsub1",
      name: "care.petcins.com",
      campaignCodes: "mxXW",
      campaignUrl: "https://rabbitracing.live/ZLgYmxXW?bit=[race]",
    },
  ]);
  assert.deepEqual(
    targets.map((item) => item.id),
    ["-Nsub1"],
  );
});

test("subdomain tanpa Campaign URL tidak ditawarkan", () => {
  const { targets } = createSubDomainOptions({
    s1: {
      name: "care.petcins.com",
      campaignCodes: "mxXW, 9brw",
      campaignUrl:
        "https://rabbitracing.live/ZLgYmxXW?bit=[race], https://rabbitracing.live/Yz899brW?bit=[race]",
    },
    s2: { name: "belum.petcins.com", campaignCodes: "aaaa" },
    s3: { name: "dihapus.petcins.com", deletedAt: "2026-09-01", campaignUrl: "https://x/y" },
  });
  assert.equal(targets.length, 1, "yang tanpa link dan yang dihapus sama-sama tidak ditawarkan");
  // Kodenya apa adanya seperti diketik orang — itu yang dipakai sebagai awalan nama campaign.
  assert.deepEqual(
    targets[0].codes.map((pair) => pair.code),
    ["mxXW", "9brw"],
  );
  assert.equal(targets[0].codes[1].url, "https://rabbitracing.live/Yz899brW?bit=[race]");
});

test("subdomain disaring ke PIC ad account yang dipilih", () => {
  const url = (code) => `https://rabbitracing.live/ZLgY${code}?bit=[race]`;
  const rows = [
    { id: "s1", name: "care.petcins.com", pic: "Godek", campaignCodes: "aaaa", campaignUrl: url("aaaa") },
    { id: "s2", name: "dog.petcins.com", pic: " godek ", campaignCodes: "bbbb", campaignUrl: url("bbbb") },
    { id: "s3", name: "cat.petcins.com", pic: "Aca", campaignCodes: "cccc", campaignUrl: url("cccc") },
    // Belum punya PIC: bukan milik siapa pun, jadi ia ikut tersembunyi saat daftarnya disaring.
    { id: "s4", name: "tanpa.petcins.com", campaignCodes: "dddd", campaignUrl: url("dddd") },
  ];
  const mine = createSubDomainOptions(rows, { owner: "Godek" });
  assert.deepEqual(
    mine.targets.map((item) => item.id),
    ["s1", "s2"],
    "dicocokkan tanpa memandang kapitalisasi dan spasi",
  );
  assert.equal(mine.hidden, 2, "berapa yang disembunyikan ikut dilaporkan ke hint");
  // Akun tanpa User Pemilik tidak menyaring apa pun: daftar yang menyusut jadi nol untuk kolom yang
  // belum diisi adalah dialog yang tidak bisa dipakai tanpa satu pun keterangan.
  const all = createSubDomainOptions(rows, { owner: "  " });
  assert.equal(all.targets.length, 4);
  assert.equal(all.hidden, 0);
  assert.equal(createSubDomainOptions(rows).targets.length, 4, "tanpa argumen sama dengan tanpa PIC");
});

test("ad account membawa pemiliknya, yang jadi penyaring subdomain", () => {
  const options = createAccountOptions([
    { id: "k1", actId: "act_1", name: "BD - R42", userOwner: "Godek" },
    { id: "k2", actId: "act_2", name: "TBZ 1247" },
  ]);
  assert.deepEqual(
    options.map((item) => item.owner),
    ["Godek", ""],
  );
});

test("usulan nama: nomor urut berikutnya per kode, dibaca dari nama yang sudah ada", () => {
  const names = ["tbxW-01 Pros MEA Carrou SM 01", "tbxW-03 Pros EU", "P5bH-09 Pros"];
  assert.equal(nextCampaignName("tbxW", names), "tbxW-04 ");
  // Kode yang belum pernah dipakai mulai dari 01.
  assert.equal(nextCampaignName("Zvq2", names), "Zvq2-01 ");
  assert.equal(nextCampaignName("", names), "");
  // Kode berkarakter regex tidak boleh meledak jadi pola.
  assert.equal(nextCampaignName("a.b", ["a.b-07 x", "axb-09 y"]), "a.b-08 ");
});

test("jumlah ad set = panjang daftar variasi, dan yang tak terbaca tidak mengubah apa pun", () => {
  const rows = [
    { title: "a", body: "b", images: ["h1", "h2"] },
    { title: "c", body: "d", images: ["h3"] },
  ];
  assert.equal(resizeVariants(rows, 4, 10).length, 4);
  assert.deepEqual(resizeVariants(rows, 4, 10).slice(0, 2), rows, "yang sudah diketik tidak bergeser");
  assert.deepEqual(resizeVariants(rows, 4, 10)[3], emptyVariant());
  // Menyusut membuang dari BELAKANG, sama dengan tombol X di tiap barisnya.
  assert.deepEqual(resizeVariants(rows, 1, 10), [rows[0]]);
  // Dijepit batas server, bukan batas kedua yang disalin ke sini.
  assert.equal(resizeVariants(rows, 99, 10).length, 10);
  // Kotak yang sedang dikosongkan orang untuk mengetik ulang tidak boleh menghapus empat variasi.
  assert.deepEqual(resizeVariants(rows, "", 10), rows);
  assert.deepEqual(resizeVariants(rows, 0, 10), rows);
  assert.deepEqual(resizeVariants(rows, "abc", 10), rows);
});

test("variasi LENGKAP butuh judul, body, DAN gambarnya sendiri", () => {
  const rows = [
    { title: "a", body: "b", images: ["h1", "h2"] },
    { title: "c", body: "  ", images: ["h1", "h2"] },
    { title: "", body: "d", images: ["h1", "h2"] },
    // Teksnya lengkap, gambarnya kurang: ditolak server berikut nomor iklannya, jadi tombol Buat
    // tidak boleh hidup untuk keadaan ini.
    { title: "e", body: "f", images: ["h1"] },
    { title: "g", body: "h" },
  ];
  assert.equal(filledVariants(rows, 2).length, 1);
  // Batas minimalnya dari jawaban server, bukan angka kedua di sini.
  assert.equal(filledVariants(rows, 1).length, 2);
});

test("gambar tiap iklan berdiri sendiri, dan urutan klik jadi urutan kartunya", () => {
  const rows = [emptyVariant(), emptyVariant()];
  let next = toggleVariantImage(rows, 0, "h2", 3);
  next = toggleVariantImage(next, 0, "h1", 3);
  assert.deepEqual(next[0].images, ["h2", "h1"], "urutan klik dipertahankan");
  assert.deepEqual(next[1].images, [], "iklan lain tidak ikut berubah");
  // Klik kedua melepas.
  assert.deepEqual(toggleVariantImage(next, 0, "h2", 3)[0].images, ["h1"]);
  // Batas maksimalnya menahan, bukan menggeser: kartu ke-4 pada batas 3 tidak menggantikan yang
  // pertama — yang sudah dipilih orang tidak boleh hilang karena satu klik yang tidak berlaku.
  const full = toggleVariantImage(toggleVariantImage(next, 0, "h3", 3), 0, "h4", 3);
  assert.deepEqual(full[0].images, ["h2", "h1", "h3"]);
});

const FORM = {
  accountId: "k1",
  urlTags: "bit=[race]",
  subDomainId: "s1",
  subDomainName: "care.petcins.com",
  code: "mxXW",
  link: "https://rabbitracing.live/ZLgYmxXW?bit=[race]",
  name: "  mxXW-01 Pros MEA  ",
  dailyBudget: "20000",
  countries: " sa, tr ",
  ageMin: 18,
  ageMax: 65,
  pageId: "127",
  pixelId: "181",
  cta: "WATCH_MORE",
  variants: [
    { title: " Judul A ", body: " Body A ", images: ["hash1", "hash2"] },
    { title: "", body: "", images: [] },
  ],
};

test("ringkasan menyebut jadwalnya, dan yang kosong menyebut ARTINYA", () => {
  const lines = createReviewLines({ ...FORM, startTime: "2026-09-20T01:59" }, { minImages: 2 });
  assert.match(lines.join("\n"), /Mulai tayang: 20 Sep 2026, 01:59 WIB/);
  const bare = createReviewLines(FORM, { minImages: 2 });
  assert.match(bare.join("\n"), /Mulai tayang: begitu campaign dinyalakan \(tanpa jadwal\)/);
});

test("ringkasan menyebut BERAPA objek yang akan lahir, bukan cuma satu campaign", () => {
  const lines = createReviewLines(FORM, {
    accountLabel: "BD - R42",
    pageName: "Sonet Media 01",
    minImages: 2,
  });
  assert.match(lines[0], /^1 ad set \+ 1 iklan/);
  assert.match(lines.join("\n"), /care\.petcins\.com \(kode mxXW\)/);
  assert.match(lines.join("\n"), /Rp 20\.000/);
  assert.match(lines.join("\n"), /Gambar per iklan: 2/);
});

test("ringkasan memisahkan alamat dari parameternya, sama seperti yang dibaca Meta", () => {
  const lines = createReviewLines(FORM, { accountLabel: "BD - R42", pageName: "SM 01", images: ["a"] });
  const text = lines.join("\n");
  assert.match(text, /Link: https:\/\/rabbitracing\.live\/ZLgYmxXW$/m, "tanpa query");
  assert.match(text, /Parameter URL: bit=\[race\]/);
  // Yang dikosongkan disebut apa adanya — baris kosong tidak bisa dibedakan dari baris yang lupa
  // digambar, dan iklan tanpa penanda [race] tidak tercatat Keitaro.
  const bare = createReviewLines({ ...FORM, urlTags: "  " }, { images: [] });
  assert.match(bare.join("\n"), /Parameter URL: \(tanpa parameter\)/);
});

test("payload mengirim KUNCI, bukan alamat Meta — dan tidak membawa batas apa pun", () => {
  const payload = createCampaignPayload(FORM, 2);
  // Link PENUH apa adanya: yang memotong query-nya server, satu tempat.
  assert.equal(payload.link, "https://rabbitracing.live/ZLgYmxXW?bit=[race]");
  assert.equal(payload.urlTags, "bit=[race]");
  assert.equal(payload.startTime, "", "tanpa jadwal dikirim kosong, bukan dihilangkan");
  assert.deepEqual(payload.countries, ["SA", "TR"]);
  assert.equal(payload.name, "mxXW-01 Pros MEA");
  // Gambar ikut DI DALAM variasinya, dan tidak ada daftar tingkat campaign lagi.
  assert.deepEqual(payload.variants, [
    { title: "Judul A", body: "Body A", images: ["hash1", "hash2"] },
  ]);
  assert.equal(payload.images, undefined);
  assert.equal(payload.accountId, "k1");
  assert.equal(payload.subDomainId, "s1");
  assert.equal(payload.actId, undefined);
  assert.equal(payload.subDomainName, undefined);
  assert.equal(payload.dailyBudget, 20000);
});

test("preset negara: per ADVERTISER, bukan global", () => {
  const rows = [
    { id: "p1", advertiser: "Godek", name: "MEA", countries: "SA, TR" },
    { id: "p2", advertiser: " godek ", name: "LATAM", countries: "MX, CL" },
    { id: "p3", advertiser: "Aca", name: "MEA", countries: "AE" },
    // Yang diarsipkan tidak ikut: langganannya satu node nilai, jadi `deletedAt` disaring di sini.
    { id: "p4", advertiser: "Godek", name: "Lama", countries: "NG", deletedAt: "2026-09-01" },
  ];
  assert.deepEqual(
    countryPresetsFor(rows, "Godek").map((item) => item.name),
    ["LATAM", "MEA"],
    "urut nama, dan pemiliknya dicocokkan tanpa memandang kapitalisasi",
  );
  assert.equal(countryPresetsFor(rows, "Godek")[1].countries, "SA, TR");
  assert.deepEqual(
    countryPresetsFor(rows, "Aca").map((item) => item.name),
    ["MEA"],
    "nama yang sama milik dua advertiser adalah dua preset",
  );
  // Akun tanpa pemilik tidak punya preset — "kosong" bukan nama seorang advertiser.
  assert.deepEqual(countryPresetsFor(rows, ""), []);
});

test("preset yang disimpan dinormalkan, dan yang tidak lengkap ditolak", () => {
  assert.deepEqual(countryPresetEntry({ advertiser: " Godek ", name: " MEA ", countries: "sa, tr sa" }), {
    advertiser: "Godek",
    name: "MEA",
    // Kodenya dinormalkan lewat aturan yang sama dengan pemilih negaranya, tanpa kembar.
    countries: "SA, TR",
  });
  assert.throws(() => countryPresetEntry({ name: "MEA", countries: "SA" }), /pilih ad account/);
  assert.throws(() => countryPresetEntry({ advertiser: "Godek", countries: "SA" }), /Beri nama/);
  assert.throws(() => countryPresetEntry({ advertiser: "Godek", name: "MEA" }), /Pilih negaranya/);
  assert.throws(
    () => countryPresetEntry({ advertiser: "Godek", name: "x".repeat(61), countries: "SA" }),
    /terlalu panjang/,
  );
});

test("tiap field preset yang ditulis disebut aturan database", async () => {
  const { rules } = JSON.parse(await readFile(new URL("../../database.rules.json", import.meta.url), "utf8"));
  const rule = rules.dashboard.countryPresets.$presetId;
  // `createResource` menempelkan LIMA field ke apa pun yang disimpannya (id, createdAt, createdBy,
  // updatedAt, updatedBy), dan `$other: false` di aturannya menolak SELURUH tulisan kalau salah satu
  // tidak disebut — kegagalan yang di layar cuma berbunyi "Preset negara gagal disimpan", tanpa
  // menyebut field mana. `updatedBy` yang terlewat sudah cukup.
  for (const key of [
    "advertiser",
    "name",
    "countries",
    "id",
    "createdAt",
    "createdBy",
    "updatedAt",
    "updatedBy",
  ]) {
    assert.ok(rule[key], `${key} tidak disebut aturan database`);
  }
  // Arsip, bukan hapus.
  for (const key of ["deletedAt", "deletedBy"]) assert.ok(rule[key], `${key} tidak disebut`);
  assert.equal(rule.$other[".validate"], false);
  // Superadmin saja yang boleh menulis — halaman yang membacanya memang cuma untuk mereka.
  assert.match(rules.dashboard.countryPresets[".write"], /superadmin/);
});
