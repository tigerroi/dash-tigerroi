import assert from "node:assert";

const {
  campaignIdFromKey,
  expiredGateCommandKeys,
  GATE_ACTIONS,
  gateCampaignRow,
  gateCampaignsMap,
  gateCommandEntry,
  gateCommandUpdate,
  gateKey,
  gatePreviewRow,
  gateRunRow,
  gateRunsMap,
  gateStatusEntry,
  mirrorDue,
  pendingGateCommands,
  previewTargets,
  subDomainCampaignUrls,
  subDomainOfCampaign,
  toIsoUtc,
} = await import("./gating-core.js");
const { applyGateCommands } = await import("./sync-gating.mjs");

assert.deepEqual(GATE_ACTIONS, ["gate", "ungate"]);

// --- kunci RTDB ---------------------------------------------------------------------------------

// Berawalan huruf, selalu. ID campaign Keitaro adalah 1..57, dan RTDB mengembalikan node berkunci
// angka berurutan sebagai array berlubang.
assert.equal(gateKey(57), "c57");
assert.equal(gateKey(" 36 "), "c36");
assert.equal(campaignIdFromKey("c36"), "36");

// --- stempel waktu ------------------------------------------------------------------------------

// vi-control mengirim UTC dengan spasi, enam digit pecahan detik, dan offset dua digit. Dibiarkan
// apa adanya, formatDateTime membacanya sebagai jam lokal dan menggeser tiap baris riwayat 7 jam.
assert.equal(toIsoUtc("2026-08-17 05:24:31.293338+00"), "2026-08-17T05:24:31.293Z");
assert.equal(toIsoUtc("2026-08-17T05:24:31Z"), "2026-08-17T05:24:31.000Z");
assert.equal(toIsoUtc(""), "");
assert.equal(toIsoUtc("bukan tanggal"), "");

// --- baris campaign -----------------------------------------------------------------------------

const row = gateCampaignRow({
  id: 57,
  name: "ALDI T2 TBZ 1221 D4kR Prospek",
  alias: "QVgwD4kR",
  state: "active",
  gated: true,
  landingUrl: "https://go.rabbitracing.live?t=9140cae9",
  decoyUrl: "https://go.rabbitracing.live?t=80bce1b5",
});
assert.equal(row.campaignId, "57");
assert.equal(row.gated, true);

// `gated: null` berarti stream-nya gagal dibaca — TIDAK DIKETAHUI, bukan "belum di-gate". Dipetakan
// jadi false, halaman menawarkan tombol Gate untuk campaign yang mungkin sudah di-gate.
assert.equal(gateCampaignRow({ id: 3, gated: null }).gated, null);
assert.equal(gateCampaignRow({ id: 3 }).gated, null);
assert.equal(gateCampaignRow({ id: 3, gated: false }).gated, false);
assert.equal(gateCampaignRow({ name: "tanpa id" }), null);

assert.deepEqual(Object.keys(gateCampaignsMap([{ id: 1 }, { id: 44 }, { name: "x" }])), [
  "c1",
  "c44",
]);

// Pratinjau hanya untuk kandidat: yang sudah di-gate tidak punya tombol Gate, dan yang tidak
// diketahui tidak boleh ditebak.
assert.deepEqual(
  previewTargets([{ id: 1, gated: false }, { id: 2, gated: true }, { id: 3, gated: null }]),
  ["1"],
);

// --- pratinjau ----------------------------------------------------------------------------------

const preview = gatePreviewRow(
  36,
  {
    plan: {
      campaignName: "NUR T2 TBZ 1233",
      applicable: true,
      blockers: [],
      alreadyGated: false,
      landingName: "bowlsharp.com NUR 1",
      current: { landingUrl: "https://bowlsharp.com/x", botProtectionUrl: "https://yt/1" },
    },
    site: { status: "existing" },
    willSet: { landingUrl: "https://go.rabbitracing.live?t=1b88d650" },
  },
  new Date("2026-08-17T10:00:00Z"),
);
assert.equal(preview.applicable, true);
assert.equal(preview.blockerCount, 0);
// Daftar kosong disimpan sebagai objek: RTDB membuang array kosong sama sekali, dan node yang
// hilang tidak bisa dibedakan dari pratinjau yang belum pernah diambil.
assert.deepEqual(preview.blockers, {});
assert.equal(preview.willSetLandingUrl, "https://go.rabbitracing.live?t=1b88d650");

const blocked = gatePreviewRow(44, {
  plan: { applicable: false, blockers: ["expected exactly 1 active landing, found 0"] },
  site: { status: "new" },
});
assert.equal(blocked.applicable, false);
assert.equal(blocked.blockerCount, 1);
assert.equal(blocked.blockers.i0, "expected exactly 1 active landing, found 0");
// Site baru belum punya key, jadi vi-control mengosongkan willSet daripada menebaknya.
assert.equal(blocked.willSetLandingUrl, "");

// --- riwayat ------------------------------------------------------------------------------------

const okRun = gateRunRow({
  id: "20d81399",
  startedAt: "2026-08-17 05:21:22.656017+00",
  campaignId: "36",
  action: "gate",
  status: "ok",
  durationMs: 1415,
  plan: { huge: "x".repeat(5000) },
  beforeState: { huge: "y".repeat(5000) },
  verification: {
    landingReadBack: true,
    passRedirectsToSite: true,
    decoyLeavesGate: true,
    passLocation: "https://bowlsharp.com/hr3agan0t",
    decoyLocation: "https://youtube.com/watch",
    cleanupComplete: true,
  },
});
assert.equal(okRun.verified, true);
assert.equal(okRun.startedAt, "2026-08-17T05:21:22.656Z");
// plan & beforeState dibuang: dua objek besar per baris, dikalikan lima puluh baris, diunduh tiap
// browser yang membuka halaman ini — dan tidak satu pun ditampilkan.
assert.equal(okRun.plan, undefined);
assert.equal(okRun.beforeState, undefined);

// Ungate memakai bentuk verifikasi yang berbeda (decoy/restoredTo). Dibaca dengan aturan gate, ia
// akan tampil sebagai "tidak terverifikasi" untuk setiap ungate yang sebenarnya berhasil.
assert.equal(
  gateRunRow({ id: "a", action: "ungate", verification: { restoredTo: "https://x", decoy: "https://y" } })
    .verified,
  true,
);

// Yang ditolak sebelum menulis apa pun tidak punya verifikasi — "" dan bukan false, karena false
// terbaca sebagai "sudah diperiksa dan hasilnya buruk".
const aborted = gateRunRow({
  id: "64ebe460",
  action: "gate",
  status: "aborted",
  error: "expected exactly 1 active landing, found 0",
  verification: null,
});
assert.equal(aborted.verified, "");
assert.equal(aborted.error, "expected exactly 1 active landing, found 0");
assert.deepEqual(Object.keys(gateRunsMap([{ id: "a" }, { id: "b" }, {}])), ["a", "b"]);

// --- antrean perintah ---------------------------------------------------------------------------

// Bentuknya harus sama persis dengan yang ditulis browser (src/lib/gating.js).
const command = gateCommandEntry({ campaignId: "36", name: "NUR T2" }, "gate", "dev@rabbit", new Date("2026-08-17T10:00:00Z"));
assert.deepEqual(command, {
  campaignId: "36",
  campaign: "NUR T2",
  action: "gate",
  state: "pending",
  requestedAt: "2026-08-17T10:00:00.000Z",
  requestedBy: "dev@rabbit",
  error: null,
});
assert.throws(() => gateCommandEntry({ campaignId: "36" }, "hapus"), /Aksi gating tidak dikenal/);
assert.throws(() => gateCommandEntry({ campaignId: "" }, "gate"), /ID Keitaro/);

const now = new Date("2026-08-17T10:00:00Z");
const queue = {
  c36: { campaignId: "36", action: "gate", state: "pending", requestedAt: "2026-08-17T09:59:00Z" },
  c35: { campaignId: "35", action: "ungate", state: "pending", requestedAt: "2026-08-17T09:58:00Z" },
  c44: { campaignId: "44", action: "gate", state: "applied", requestedAt: "2026-08-17T09:00:00Z" },
  c99: { campaignId: "99", action: "gate", state: "pending", requestedAt: "2026-08-17T08:00:00Z" },
  bad: { campaignId: "x", action: "gate", state: "pending", requestedAt: "2026-08-17T09:59:00Z" },
};
const pending = pendingGateCommands(queue, now);
// Urut permintaan, bukan urut kunci; yang selesai dan yang bentuknya rusak tidak ikut.
assert.deepEqual(pending.map((c) => c.campaignId), ["99", "35", "36"]);
// Yang basi tetap dikembalikan, ditandai — dilewati diam-diam ia menggantung "Menunggu" selamanya.
assert.equal(pending.find((c) => c.campaignId === "99").expired, true);
assert.equal(pending.find((c) => c.campaignId === "36").expired, false);

// Berhasil: perintah ditandai applied DAN baris cerminnya ikut berubah, supaya tabel tidak
// menyangkal apa yang baru saja terjadi sampai penyegaran berikutnya.
const okUpdate = gateCommandUpdate({ key: "c36", campaignId: "36", action: "gate" }, { status: "ok", runId: "r1" }, now);
assert.equal(okUpdate["commands/c36/state"], "applied");
assert.equal(okUpdate["commands/c36/runId"], "r1");
assert.equal(okUpdate["campaigns/c36/gated"], true);
assert.equal(
  gateCommandUpdate({ key: "c35", campaignId: "35", action: "ungate" }, { status: "ok" }, now)[
    "campaigns/c35/gated"
  ],
  false,
);

// `aborted` membawa alasannya di plan.blockers — "aborted" sendiri tidak menyebut apa yang harus
// diperbaiki, dan itulah satu-satunya kalimat yang berguna bagi yang membacanya.
const abortedUpdate = gateCommandUpdate(
  { key: "c44", campaignId: "44", action: "gate" },
  { status: "aborted", plan: { blockers: ["expected exactly 1 active landing, found 0"] } },
  now,
);
assert.equal(abortedUpdate["commands/c44/state"], "failed");
assert.equal(abortedUpdate["commands/c44/error"], "expected exactly 1 active landing, found 0");
assert.equal(abortedUpdate["campaigns/c44/gated"], undefined);

// Pesan panjang dipotong: aturan database membatasi `error` pada 500 karakter, dan tulisan yang
// melanggar .validate ditolak SELURUHNYA — perintahnya akan tetap "pending" dan dicoba lagi tiap
// dua menit selamanya, atas kegagalan yang tidak pernah bisa ia catat.
const longUpdate = gateCommandUpdate({ key: "c1", campaignId: "1", action: "gate" }, { error: "x".repeat(900) }, now);
assert.ok(longUpdate["commands/c1/error"].length <= 480);

assert.deepEqual(
  expiredGateCommandKeys(
    {
      c1: { state: "applied", finishedAt: "2026-08-16T10:00:00Z" },
      c2: { state: "applied", finishedAt: "2026-08-17T09:00:00Z" },
      c3: { state: "pending", requestedAt: "2026-08-16T10:00:00Z" },
    },
    now,
  ),
  ["c1"],
);

// --- status cermin ------------------------------------------------------------------------------

const status = gateStatusEntry(
  [{ gated: true }, { gated: true }, { gated: false }, { gated: null }],
  now,
);
assert.equal(status.campaigns, 4);
assert.equal(status.gated, 2);
// Yang tidak terbaca dihitung terpisah: selisih itu persis yang membedakan "1 campaign siap
// di-gate" dari "1 campaign tidak terbaca".
assert.equal(status.ungated, 1);
assert.equal(status.unknown, 1);

assert.equal(mirrorDue({}, now), true, "belum pernah disegarkan");
assert.equal(mirrorDue({ mirroredAt: "2026-08-17T09:59:00Z" }, now), false, "baru saja");
assert.equal(mirrorDue({ mirroredAt: "2026-08-17T09:40:00Z" }, now), true, "sudah lewat jaraknya");
// Tombol "Segarkan" hanya bisa menaruh stempel; run berikutnya yang membacanya.
assert.equal(
  mirrorDue({ mirroredAt: "2026-08-17T09:59:00Z" }, now, "2026-08-17T09:59:30Z"),
  true,
  "ada yang minta disegarkan setelah cermin terakhir",
);
assert.equal(
  mirrorDue({ mirroredAt: "2026-08-17T09:59:00Z" }, now, "2026-08-17T09:58:00Z"),
  false,
  "permintaannya lebih tua dari cerminnya",
);

// --- penerap ------------------------------------------------------------------------------------

function fakeStore(data = {}) {
  const state = structuredClone(data);
  const writes = [];
  const at = (path) => path.split("/").reduce((node, key) => node?.[key], state);
  return {
    state,
    writes,
    read: async (path) => at(path) ?? null,
    update: async (path, values) => {
      writes.push({ path, values });
      for (const [key, value] of Object.entries(values)) {
        const parts = `${path}/${key}`.split("/");
        const last = parts.pop();
        let node = state;
        for (const part of parts) node = node[part] ??= {};
        if (value === null) delete node[last];
        else node[last] = value;
      }
    },
    replace: async (path, value) => {
      writes.push({ path, values: value });
      const parts = path.split("/");
      const last = parts.pop();
      let node = state;
      for (const part of parts) node = node[part] ??= {};
      node[last] = value;
    },
  };
}

// Gate ganda: pratinjau untuk campaign yang SUDAH di-gate tetap menjawab applicable:true dengan
// tujuan yang menunjuk ke URL gate itu sendiri. Tanpa penjaga ini, gate kedua memasang gate di
// depan gate — dan tidak ada apa pun di sisi vi-control yang menghentikannya.
{
  const store = fakeStore({
    dashboard: {
      gating: {
        commands: {
          c57: { campaignId: "57", action: "gate", state: "pending", requestedAt: now.toISOString() },
        },
      },
    },
  });
  globalThis.fetch = async (url) => {
    assert.ok(url.endsWith("/campaigns"), `tidak boleh memanggil ${url}`);
    return new Response(JSON.stringify([{ id: 57, gated: true }]), { status: 200 });
  };
  const res = await applyGateCommands(store, "key", now);
  assert.equal(res.failed, 1);
  assert.equal(res.applied, 0);
  assert.match(store.state.dashboard.gating.commands.c57.error, /sudah lewat gate/);
}

// Daftar campaign yang gagal dibaca TIDAK menggagalkan perintahnya. Bacaan yang meleset tidak
// mengabarkan apa pun tentang campaign-nya, dan menggagalkan perintah orang karenanya berarti ia
// harus menekan tombolnya lagi untuk sesuatu yang tidak pernah dicoba.
{
  const store = fakeStore({
    dashboard: {
      gating: {
        commands: {
          c36: { campaignId: "36", action: "gate", state: "pending", requestedAt: now.toISOString() },
        },
      },
    },
  });
  globalThis.fetch = async () => new Response(JSON.stringify({ error: "bad gateway" }), { status: 502 });
  const res = await applyGateCommands(store, "key", now);
  assert.equal(res.failed, 0);
  assert.equal(store.state.dashboard.gating.commands.c36.state, "pending");
  assert.match(res.issues[0].message, /Keitaro sedang down|gagal dibaca/);
}

// Jalan yang benar: gate dieksekusi, perintahnya applied, cerminnya ikut berubah.
{
  const store = fakeStore({
    dashboard: {
      gating: {
        campaigns: { c36: { campaignId: "36", gated: false } },
        commands: {
          c36: { campaignId: "36", action: "gate", state: "pending", requestedAt: now.toISOString() },
        },
      },
    },
  });
  globalThis.fetch = async (url, options) => {
    if (url.endsWith("/campaigns")) {
      return new Response(JSON.stringify([{ id: 36, gated: false }]), { status: 200 });
    }
    assert.equal(options.method, "POST");
    assert.ok(url.endsWith("/campaigns/36/gate"));
    return new Response(JSON.stringify({ runId: "r9", status: "ok", verification: { cleanupComplete: true } }), {
      status: 200,
    });
  };
  const res = await applyGateCommands(store, "key", now);
  assert.equal(res.applied, 1);
  assert.equal(store.state.dashboard.gating.commands.c36.state, "applied");
  assert.equal(store.state.dashboard.gating.campaigns.c36.gated, true);
  assert.deepEqual(res.issues, []);
}

// `problem` = tersimpan TAPI verifikasinya gagal. Digabung dengan "gagal", yang membacanya akan
// mengira tidak ada yang berubah — padahal routing-nya sudah berubah dan tidak terbukti benar.
{
  const store = fakeStore({
    dashboard: {
      gating: {
        commands: {
          c36: { campaignId: "36", action: "gate", state: "pending", requestedAt: now.toISOString() },
        },
      },
    },
  });
  globalThis.fetch = async (url) =>
    url.endsWith("/campaigns")
      ? new Response(JSON.stringify([{ id: 36, gated: false }]), { status: 200 })
      : new Response(JSON.stringify({ runId: "r7", status: "problem" }), { status: 200 });
  const res = await applyGateCommands(store, "key", now);
  assert.equal(res.failed, 1);
  assert.equal(res.issues[0].source, "Verifikasi gating");
  assert.match(res.issues[0].impact, /periksa manual/i);
}

// --- Campaign URL -> baris subdomain --------------------------------------------------------
{
  const subDomains = {
    s1: { name: "dogtraining.petcins.com", campaignCodes: "vXDz, HLCZ" },
    s2: { name: "cosplay.masseffectstore.com" },
    s3: { name: "puppy.petcins.com", campaignCodes: "TvH1" },
    s4: { name: "gone.petcins.com", campaignCodes: "vXDz", deletedAt: "2026-08-01" },
    s5: { name: "marriage.psaonlineappointment.com" },
    s6: { name: "seniorpet.petcins.com" },
    s7: { name: "fitness.stylefemale.com", campaignCodes: "P5bH" },
  };
  const url = (n) => `https://rabbitracing.live/${n}?bit=[race]`;
  const campaigns = [
    { id: 11, name: "NURTZ T2 1234 vXDz Prospek (dogtraining.petcins.com)", campaignUrl: url("a") },
    // Nama yang menyebut subdomain yang sama tanpa TLD-nya: dicocokkan sebagai awalan.
    { id: 40, name: "NURTZ T2 1238 HLCZ Prospek (dogtraining.petcins)", campaignUrl: url("b") },
    // Kurung yang tidak ditutup — hostname-nya tetap utuh.
    { id: 10, name: "NURTH T2 1238 5rx7 Prospek (cosplay.masseffectstore.com(Visint))", campaignUrl: url("c") },
    // TLD hilang, satu-satunya yang cocok.
    { id: 21, name: "FIR T2 (WL) tSZh Prospek (marriage.psaonlineappointment)", campaignUrl: url("d") },
    // Catatan sesudah kurung tidak ikut terbaca.
    { id: 22, name: "IBNU T2 1236 mxcb Prospek (seniorpet.petcins.com) BLACKLIST", campaignUrl: url("e") },
    // Nama salah ketik ("fitnes"), tapi kodenya terdaftar — cadangan yang menangkapnya.
    { id: 23, name: "ALDI T2 TBZ 1221 P5bH Prospek (fitnes.stylefemale)", campaignUrl: url("f") },
    // Bukan hostname sama sekali, dan tidak ada kode terdaftar: tidak mendarat di baris mana pun.
    { id: 1, name: "FIRMAN T2 (WL) 5mJY TRAFF (SUB)", campaignUrl: url("g") },
    { id: 2, name: "Link Master T2", campaignUrl: url("h") },
  ];

  const update = subDomainCampaignUrls(campaigns, subDomains);
  // Dua campaign, dua link, satu baris — dan urutannya urutan daftar campaign-nya.
  assert.equal(update["s1/campaignUrl"], `${url("a")}, ${url("b")}`);
  assert.equal(update["s2/campaignUrl"], url("c"));
  assert.equal(update["s5/campaignUrl"], url("d"));
  assert.equal(update["s6/campaignUrl"], url("e"));
  assert.equal(update["s7/campaignUrl"], url("f"), "kode menangkap nama yang salah ketik");
  // Belum punya campaign: dikosongkan, bukan dilewati — link yang bertahan setelah campaign-nya
  // dihapus adalah link mati yang mengaku hidup.
  assert.equal(update["s3/campaignUrl"], null);
  assert.ok(!("s4/campaignUrl" in update), "baris terhapus tidak disentuh");
}

// Subdomain yang TIDAK terdaftar tidak pernah jadi tebakan, dan nama yang menyebut dua subdomain
// sekaligus dibaca dari BELAKANG — tujuannya ditulis di ujung nama.
{
  const keyByHost = new Map([
    ["health.bispdailyupdates.pk", "k1"],
    ["news.bispdailyupdates.pk", "k2"],
  ]);
  const none = new Map();
  assert.equal(
    subDomainOfCampaign("NUR T2 (WL) 3NSD Prospek (belum-terdaftar.bispdailyupdates.pk)", keyByHost, none),
    "",
  );
  assert.equal(
    subDomainOfCampaign("dari health.bispdailyupdates.pk ke (news.bispdailyupdates.pk)", keyByHost, none),
    "k2",
  );
  // TLD hilang DAN lebih dari satu yang cocok: memilih salah satunya berarti link sebuah campaign
  // mendarat di baris yang salah, tanpa apa pun di layar yang bisa menunjukkannya.
  const ambigu = new Map([
    ["a.designingaround.com", "k1"],
    ["a.designingaround.net", "k2"],
  ]);
  assert.equal(subDomainOfCampaign("ACA T2 K4RY Prospek (a.designingaround)", ambigu, none), "");
}

// Cermin membawa campaignUrl. Tanpa itu, join di atas tidak punya apa pun untuk ditulis.
assert.equal(
  gateCampaignRow({ id: 91, campaignUrl: "https://rabbitracing.live/JsFTQbDw?bit=[race]" }).campaignUrl,
  "https://rabbitracing.live/JsFTQbDw?bit=[race]",
);

console.log("gating-core: ok");
