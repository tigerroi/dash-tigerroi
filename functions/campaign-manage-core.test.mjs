import assert from "node:assert/strict";
import test from "node:test";
import {
  accountOfCampaignRow,
  activeCopyJob,
  activeJobNames,
  assertConfirmed,
  assertNamesFree,
  budgetState,
  ConfirmRequired,
  campaignNameVerdict,
  copyJobEntry,
  adsToRepair,
  copyPlan,
  copyShortfall,
  copyNames,
  copyOutcome,
  expiredCopyJobIds,
  interimCopySuffix,
  mergeTargeting,
  metaFailureStatus,
  metaOutcomeUncertain,
  newCopyJobId,
  normalizeCountries,
  parseBudget,
  RuleError,
  stalledJobPatch,
  targetingState,
  uncertainCopyError,
} from "./campaign-manage-core.js";
import { buildCodeIndex } from "./sync-core.js";

// meta.js membaca jedanya saat diimpor; dipakai untuk menghasilkan pesan galat yang SEBENARNYA.
process.env.META_MIN_INTERVAL_MS = "0";
const { copyCampaignShell } = await import("./meta.js");

const { byCode } = buildCodeIndex({
  a: { name: "puppy.petcins.com", campaignCodes: "TvH1" },
  b: { name: "dog.petcins.com", campaignCodes: "5rx7" },
});

test("nama tanpa kode terdaftar ditolak — belanjanya tidak akan masuk ROI siapa pun", () => {
  assert.throws(() => campaignNameVerdict({}, "nPJL-06 Pros Turki", byCode), RuleError);
  assert.throws(() => campaignNameVerdict({}, "nPJL-06 Pros Turki", byCode), /npjl.*belum terdaftar/);
});

test("campaign terpetakan lewat kode tidak boleh diberi kode subdomain lain", () => {
  const row = { subDomain: "puppy.petcins.com", subDomainSource: "code" };
  assert.throws(() => campaignNameVerdict(row, "5rx7-01 Pros", byCode), /milik dog\.petcins\.com/);
  assert.deepEqual(campaignNameVerdict(row, "TvH1-07 Pros", byCode), {
    subDomain: "puppy.petcins.com",
    code: "tvh1",
    needsConfirm: false,
  });
});

test("campaign belum terpetakan atau manual boleh kode mana pun, dengan konfirmasi", () => {
  for (const row of [{}, { subDomain: "lama.petcins.com", subDomainSource: "manual" }]) {
    const verdict = campaignNameVerdict(row, "5rx7-01 Pros", byCode);
    assert.equal(verdict.subDomain, "dog.petcins.com");
    assert.equal(verdict.needsConfirm, true);
  }
});

test("konfirmasi harus menyebut subdomain yang sama dengan vonis server", () => {
  const verdict = { subDomain: "dog.petcins.com", code: "5rx7", needsConfirm: true };
  assert.throws(() => assertConfirmed(verdict, ""), ConfirmRequired);
  assert.throws(() => assertConfirmed(verdict, "puppy.petcins.com"), ConfirmRequired);
  assert.doesNotThrow(() => assertConfirmed(verdict, " DOG.petcins.com "));
  assert.doesNotThrow(() => assertConfirmed({ ...verdict, needsConfirm: false }, ""));
  try {
    assertConfirmed(verdict, "");
  } catch (error) {
    assert.equal(error.status, 409);
    assert.equal(error.subDomain, "dog.petcins.com");
  }
});

test("rencana salin: ad set yang saklarnya ACTIVE/PAUSED, dengan jumlah iklan masing-masing", () => {
  const plan = copyPlan(
    [
      { id: "s1", name: "Adset 1", status: "ACTIVE" },
      { id: "s2", name: "Adset 2", status: "PAUSED" },
      { id: "s3", name: "Lama", status: "ARCHIVED" },
    ],
    [
      { id: "a1", name: "Iklan 1", creativeId: "cr1", pageId: "p1", adSetId: "s1", status: "ACTIVE" },
      { id: "a2", name: "Iklan 2", creativeId: "cr2", pageId: "p1", adSetId: "s1", status: "PAUSED" },
      { id: "a3", name: "Iklan 3", creativeId: "cr3", pageId: "p2", adSetId: "s2", status: "ACTIVE" },
      { id: "a4", adSetId: "s2", status: "DELETED" },
      { id: "a5", adSetId: "s3", status: "ACTIVE" },
    ],
  );
  assert.deepEqual(plan, {
    adSets: [
      {
        id: "s1",
        name: "Adset 1",
        ads: 2,
        // Bahan pemulihan: nama (untuk mencocokkan yang sudah lahir), creative (yang dipakai ulang),
        // Halaman (yang disebut penolakan izinnya), dan saklar sumbernya.
        adRows: [
          { name: "Iklan 1", creativeId: "cr1", pageId: "p1", status: "ACTIVE" },
          { name: "Iklan 2", creativeId: "cr2", pageId: "p1", status: "PAUSED" },
        ],
      },
      {
        id: "s2",
        name: "Adset 2",
        ads: 1,
        adRows: [{ name: "Iklan 3", creativeId: "cr3", pageId: "p2", status: "ACTIVE" }],
      },
    ],
    adCount: 3,
  });
});

test("pemulihan iklan: yang dicocokkan NAMA, dan yang tanpa creative tidak pernah dipulihkan", () => {
  const rows = [
    { name: "Iklan 1", creativeId: "cr1", status: "ACTIVE" },
    { name: "Iklan 2", creativeId: "cr2", status: "PAUSED" },
    { name: "Iklan 3", creativeId: "", status: "ACTIVE" },
    { name: "", creativeId: "cr4", status: "ACTIVE" },
  ];
  // Salinan yang kosong: dua yang bisa dipulihkan, dua yang tidak punya bahannya.
  assert.deepEqual(
    adsToRepair(rows, []).map((row) => row.name),
    ["Iklan 1", "Iklan 2"],
  );
  // Yang sudah berdiri di salinan tidak dibuatkan kembarannya — dicocokkan tanpa memandang
  // kapitalisasi, sepola `normalizeName` di sisi sync.
  assert.deepEqual(
    adsToRepair(rows, ["iklan 1"]).map((row) => row.name),
    ["Iklan 2"],
  );
  // Dua iklan sumber bernama sama menuntut dua salinan: dihitung sebagai himpunan, yang kedua
  // hilang tanpa satu pun tanda.
  const twins = [
    { name: "Kembar", creativeId: "cr1", status: "ACTIVE" },
    { name: "Kembar", creativeId: "cr2", status: "ACTIVE" },
  ];
  assert.equal(adsToRepair(twins, ["Kembar"]).length, 1);
  assert.deepEqual(adsToRepair(null, null), []);
});

test("rencana salin menolak sebelum menyentuh Meta", () => {
  const four = Array.from({ length: 4 }, (_, i) => ({ id: `a${i}`, adSetId: "s1", status: "ACTIVE" }));
  assert.throws(
    () => copyPlan([{ id: "s1", name: "Adset Gemuk", status: "ACTIVE" }], four),
    /Adset Gemuk.*lebih dari 3 iklan/,
  );
  assert.throws(() => copyPlan([{ id: "s1", name: "X", status: "ARCHIVED" }], []), /tidak punya ad set/);
  const many = Array.from({ length: 51 }, (_, i) => ({ id: `s${i}`, name: `S${i}`, status: "ACTIVE" }));
  assert.throws(() => copyPlan(many, []), /51 ad set/);
});

test("nama salinan: satu apa adanya, lebih dari satu diberi akhiran", () => {
  assert.deepEqual(copyNames(" TvH1-07 A ", 1), ["TvH1-07 A"]);
  assert.deepEqual(copyNames("TvH1-07 A", 3), ["TvH1-07 A #1", "TvH1-07 A #2", "TvH1-07 A #3"]);
  assert.throws(() => copyNames("TvH1-07 A", 6), /1 sampai 5/);
  assert.throws(() => copyNames("TvH1-07 A", 0), /1 sampai 5/);
  assert.throws(() => copyNames("  ", 1), /wajib diisi/);
});

test("ad account sebuah baris campaign dicari lewat kunci yang sama dengan sync", () => {
  const accounts = {
    k1: { actId: "act_1", name: "TBZ 1247" },
    k2: { actId: "act_2", name: "Lincah", deletedAt: "2026-08-01" },
  };
  assert.equal(accountOfCampaignRow(accounts, { adAccount: "act_1" }).id, "k1");
  assert.equal(accountOfCampaignRow(accounts, { account: "tbz 1247" }).id, "k1");
  assert.equal(accountOfCampaignRow(accounts, { adAccount: "act_2" }), null, "akun terhapus");
  // Baris tanpa identitas akun tidak boleh dicocokkan ke akun pertama yang kebetulan ada.
  assert.equal(accountOfCampaignRow(accounts, {}), null);
  // Kunci RTDB menang atas field `id` yang kebetulan tersimpan di barisnya.
  assert.equal(accountOfCampaignRow({ k9: { id: "lama", actId: "act_9" } }, { adAccount: "act_9" }).id, "k9");
});

test("nama yang sudah dipakai campaign lain di akun itu ditolak — sync melebur per nama", () => {
  const taken = [
    { id: "120210", name: "TvH1-06 Pros" },
    { id: "120300", name: "TvH1-08 Pros" },
    { id: "", name: "TvH1-09 Pros" },
  ];
  assert.throws(
    () => assertNamesFree([" tvh1-06 PROS"], taken),
    (error) =>
      error instanceof RuleError &&
      error.status === 422 &&
      error.message === 'Nama "tvh1-06 PROS" sudah dipakai campaign lain di ad account ini — sync akan melebur keduanya jadi satu baris.',
  );
  assert.throws(() => assertNamesFree(["TvH1-07 #1", "TvH1-09 Pros"], taken), /"TvH1-09 Pros"/);
  assert.doesNotThrow(() => assertNamesFree(["TvH1-07 #1", "TvH1-07 #2"], taken));
  // Nama-nama yang diminta sekaligus juga tidak boleh kembar satu sama lain.
  assert.throws(() => assertNamesFree(["TvH1-07", "tvh1-07"], taken), /"tvh1-07"/);
  // Ganti nama: nama campaign itu sendiri bukan bentrok, nama campaign lain tetap bentrok.
  assert.doesNotThrow(() => assertNamesFree(["TvH1-06 Pros"], taken, { exceptCampaignId: "120210" }));
  assert.throws(() => assertNamesFree(["TvH1-08 Pros"], taken, { exceptCampaignId: "120210" }), RuleError);
});

test("nama dari job salinan akun yang sama yang masih berjalan", () => {
  const jobs = {
    a: { accountId: "k1", state: "running", names: ["A #1", "A #2"] },
    b: { accountId: "k1", state: "requested", names: { 0: "B" } },
    c: { accountId: "k1", state: "done", names: ["C"] },
    d: { accountId: "k2", state: "running", names: ["D"] },
  };
  assert.deepEqual(activeJobNames(jobs, "k1").map((item) => item.name), ["A #1", "A #2", "B"]);
  assert.deepEqual(activeJobNames(null, "k1"), []);
});

test("nama sementara salinan unik per job dan per salinan", () => {
  assert.equal(interimCopySuffix("jabc12", 0), " (salinan jabc12-1)");
  assert.equal(interimCopySuffix("jabc12", 2), " (salinan jabc12-3)");
});

test("hasil salin campaign yang tidak pasti dibedakan dari penolakan yang pasti", async () => {
  // Pesan dibentuk meta.js sendiri, dari balasan yang benar-benar mungkin datang.
  const messageFor = async (respond) => {
    globalThis.fetch = async () => respond();
    return copyCampaignShell("120210", "tok").then(
      () => "",
      (error) => error.message,
    );
  };
  const json = (status, body) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });
  const raw = (status, text) => ({ ok: status < 400, status, text: async () => text });
  const uncertain = [
    await messageFor(() => json(500, { error: { message: "An unknown error occurred", code: 1 } })),
    await messageFor(() => json(500, { error: { message: "Please reduce the amount of data", code: 1, error_subcode: 99 } })),
    await messageFor(() => json(503, { error: { message: "Service temporarily unavailable", code: 2 } })),
    await messageFor(() => raw(502, "<!DOCTYPE html><html><head><title>502</title></head></html>")),
    await messageFor(() => raw(504, "")),
    await messageFor(() => json(200, {})),
    await messageFor(() => {
      throw new TypeError("fetch failed");
    }),
    await messageFor(() => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    }),
    await messageFor(() => {
      throw new DOMException("The operation was aborted.", "AbortError");
    }),
  ];
  for (const message of uncertain) assert.equal(metaOutcomeUncertain(message), true, message);
  // Bentuk galat jaringan Bun (server kontrol berjalan di Bun).
  assert.equal(metaOutcomeUncertain("Unable to connect. Is the computer able to access the url?"), true);
  assert.equal(metaOutcomeUncertain("The socket connection was closed unexpectedly."), true);

  const definite = [
    await messageFor(() => json(400, { error: { message: "Invalid parameter", code: 100 } })),
    await messageFor(() => json(400, { error: { message: "Application does not have permission for this action", code: 10 } })),
    await messageFor(() => json(403, { error: { message: "Permissions error", code: 200 } })),
    await messageFor(() => json(400, { error: { message: "Unsupported post request.", code: 100, error_subcode: 33 } })),
    await messageFor(() => json(400, { error: { message: "Invalid OAuth access token", code: 190 } })),
    await messageFor(() => raw(400, "")),
  ];
  for (const message of definite) assert.equal(metaOutcomeUncertain(message), false, message);
  assert.equal(metaOutcomeUncertain(""), false);

  assert.match(uncertainCopyError(uncertain[0]), /\(#1\).*periksa Ads Manager\.$/);
  assert.ok(uncertainCopyError("x".repeat(5000)).length < 1000, "muat di batas aturan database");
});

test("id job berbentuk yang diterima aturan database", () => {
  assert.equal(newCopyJobId(new Date(0), () => 0), "j00000");
  assert.match(newCopyJobId(), /^j[0-9a-z]{5,20}$/);
});

test("entri job lahir requested, berikut seluruh identitasnya", () => {
  const now = new Date("2026-09-11T08:00:00Z");
  assert.deepEqual(
    copyJobEntry({
      source: { campaignId: "120210", campaign: "TvH1-06" },
      userId: "u_nur",
      account: { id: "k1", actId: "act_1" },
      names: ["TvH1-07 #1", "TvH1-07 #2"],
      plan: { adSets: [{ id: "s1", name: "A", ads: 1 }, { id: "s2", name: "B", ads: 2 }], adCount: 3 },
      requestedBy: "super@r.live",
      now,
    }),
    {
      sourceCampaignId: "120210",
      sourceName: "TvH1-06",
      userId: "u_nur",
      accountId: "k1",
      actId: "act_1",
      count: 2,
      names: ["TvH1-07 #1", "TvH1-07 #2"],
      adSetCount: 2,
      adCount: 3,
      state: "requested",
      requestedBy: "super@r.live",
      requestedAt: "2026-09-11T08:00:00.000Z",
      updatedAt: "2026-09-11T08:00:00.000Z",
    },
  );
});

test("job aktif untuk campaign yang sama terdeteksi, yang selesai tidak", () => {
  const jobs = {
    a: { sourceCampaignId: "1", state: "done" },
    b: { sourceCampaignId: "1", state: "running" },
    c: { sourceCampaignId: "2", state: "requested" },
  };
  assert.equal(activeCopyJob(jobs, "1"), "b");
  assert.equal(activeCopyJob(jobs, "2"), "c");
  assert.equal(activeCopyJob(jobs, "3"), "");
  assert.equal(activeCopyJob(null, "1"), "");
});

test("salinan yang tidak utuh menyebut sebabnya", () => {
  const whole = { campaignId: "9", adSets: 2, adSetsExpected: 2, ads: 3, adsExpected: 3 };
  assert.equal(copyShortfall(whole), "");
  assert.match(
    copyShortfall({ ...whole, ads: 0 }),
    /3 dari 3 iklan tidak ikut tersalin.*membuatkannya ulang dari creative iklan sumber.*izin beriklan/,
  );
  assert.match(copyShortfall({ ...whole, adSets: 1 }), /1 dari 2 ad set gagal disalin/);
  assert.equal(copyShortfall({ campaignId: "" }), "");
});

test("hasil job: done hanya kalau semua salinan lahir UTUH", () => {
  const whole = { campaignId: "9", adSets: 1, adSetsExpected: 1, ads: 1, adsExpected: 1, error: "" };
  assert.deepEqual(copyOutcome([whole, { ...whole, campaignId: "8" }]), { state: "done", error: "" });
  // Lahir tapi iklannya tidak ikut: bukan "Selesai".
  assert.deepEqual(copyOutcome([{ ...whole, ads: 0, error: "1 dari 1 iklan tidak ikut tersalin" }]), {
    state: "partial",
    error: "1 dari 1 iklan tidak ikut tersalin",
  });
  assert.equal(copyOutcome([whole, { campaignId: "", error: "Too many ads" }]).state, "partial");
  assert.deepEqual(copyOutcome([{ campaignId: "", error: "" }]), { state: "failed", error: "Meta tidak membuat salinan." });
  assert.equal(copyOutcome([]).state, "failed", "daftar kosong bukan keberhasilan");
});

test("hasil job: partial diturunkan dari catatan salinan, bukan dari `error` pemanggil", () => {
  const whole = { campaignId: "9", name: "TvH1-07", adSets: 2, adSetsExpected: 2, ads: 2, adsExpected: 2, error: "", renameError: "" };
  assert.deepEqual(copyOutcome([{ ...whole, ads: 1 }]), {
    state: "partial",
    error:
      "1 dari 2 iklan tidak ikut tersalin, dan membuatkannya ulang dari creative iklan sumber juga tidak berhasil — periksa izin beriklan System User di Halaman iklan itu.",
  });
  // Ganti nama yang gagal: salinannya tertinggal bernama sementara.
  const renamed = copyOutcome([whole, { ...whole, campaignId: "8", renameError: "Invalid name (#100)" }]);
  assert.equal(renamed.state, "partial");
  assert.match(renamed.error, /^Salinan 8 masih bernama sementara — ganti nama ke "TvH1-07" gagal \(Invalid name \(#100\)\); ubah lewat tombol Ubah\.$/);
  // Keduanya sekaligus: kedua sebabnya terbaca.
  const both = copyOutcome([{ ...whole, ads: 1, renameError: "x" }]);
  assert.match(both.error, /iklan tidak ikut tersalin.* Salinan 9 masih bernama sementara/);
});

test("hasil job: salinan yang hasilnya tidak pasti membuat job unknown, bukan failed", () => {
  const whole = { campaignId: "9", adSets: 1, adSetsExpected: 1, ads: 1, adsExpected: 1, error: "" };
  const unsure = { name: "B", campaignId: "", uncertain: true, error: uncertainCopyError("Meta 1/copies -> x (#2)") };
  assert.deepEqual(copyOutcome([unsure]), { state: "unknown", error: unsure.error });
  assert.equal(copyOutcome([whole, unsure]).state, "unknown");
  assert.match(copyOutcome([{ campaignId: "", uncertain: true }]).error, /periksa Ads Manager/);
});

test("job yang menggantung jadi unknown, bukan failed", () => {
  const at = "2026-09-11T08:00:00.000Z";
  const later = (minutes) => new Date(Date.parse(at) + minutes * 60_000);
  assert.equal(stalledJobPatch({ state: "requested", requestedAt: at }, later(11)).state, "unknown");
  assert.equal(stalledJobPatch({ state: "requested", requestedAt: at }, later(9)), null);
  assert.equal(stalledJobPatch({ state: "running", requestedAt: at, startedAt: at }, later(31)).state, "unknown");
  assert.equal(stalledJobPatch({ state: "running", requestedAt: at, startedAt: at }, later(20)), null);
  // `running` diukur dari aktivitas terakhir: job besar yang masih bergerak bukan job yang mati.
  const moving = { state: "running", requestedAt: at, startedAt: at, updatedAt: later(25).toISOString() };
  assert.equal(stalledJobPatch(moving, later(50)), null);
  assert.equal(stalledJobPatch(moving, later(56)).state, "unknown");
  // `requested` tetap dari permintaannya, walau updatedAt lebih baru.
  assert.equal(stalledJobPatch({ state: "requested", requestedAt: at, updatedAt: later(9).toISOString() }, later(11)).state, "unknown");
  assert.equal(stalledJobPatch({ state: "done", requestedAt: at }, later(600)), null);
  assert.match(stalledJobPatch({ state: "requested", requestedAt: at }, later(11)).error, /Ads Manager/);
});

test("job selesai lebih dari 7 hari dibuang; yang masih berjalan tidak", () => {
  const old = "2026-09-01T00:00:00.000Z";
  const now = new Date("2026-09-11T00:00:00Z");
  const jobs = {
    done: { state: "done", requestedAt: old },
    unknown: { state: "unknown", requestedAt: old },
    running: { state: "running", requestedAt: old },
    fresh: { state: "failed", requestedAt: "2026-09-10T00:00:00.000Z" },
  };
  assert.deepEqual(expiredCopyJobIds(jobs, now).sort(), ["done", "unknown"]);
});

test("anggaran hanya bisa diubah di tingkat yang memegangnya", () => {
  assert.deepEqual(budgetState("campaign", { dailyBudget: 50000, lifetimeBudget: null }), {
    editable: true,
    reason: "",
  });
  assert.match(budgetState("campaign", { dailyBudget: null }).reason, /dipegang ad set/);
  assert.match(budgetState("adset", { dailyBudget: null }).reason, /dipegang campaign/);
  assert.match(budgetState("adset", { dailyBudget: null, lifetimeBudget: 900000 }).reason, /lifetime/);
  assert.equal(budgetState("adset", { dailyBudget: null, lifetimeBudget: 900000 }).editable, false);
});

test("anggaran harus angka lebih dari nol — kosong bukan nol", () => {
  assert.equal(parseBudget("75000"), 75000);
  assert.equal(parseBudget(75000), 75000);
  for (const bad of ["", null, undefined, "0", -5, "abc"]) {
    assert.throws(() => parseBudget(bad), RuleError);
  }
});

const TARGETING = {
  age_min: 18,
  age_max: 65,
  geo_locations: { countries: ["tr"], location_types: ["home", "recent"] },
  flexible_spec: [{ interests: [{ id: "6003", name: "Travel" }] }],
  publisher_platforms: ["facebook", "instagram"],
};

test("targeting negara-saja bisa diedit; wilayah/kota tidak", () => {
  assert.deepEqual(targetingState(TARGETING), {
    editable: true,
    reason: "",
    countries: ["TR"],
    ageMin: 18,
    ageMax: 65,
  });
  const cities = { ...TARGETING, geo_locations: { countries: ["TR"], cities: [{ key: "1" }] } };
  assert.equal(targetingState(cities).editable, false);
  assert.match(targetingState(cities).reason, /cities/);
  // Array kosong bukan lokasi.
  const emptyRegions = { ...TARGETING, geo_locations: { countries: ["TR"], regions: [] } };
  assert.equal(targetingState(emptyRegions).editable, true);
  assert.equal(targetingState(null).editable, false);
  assert.equal(targetingState({ geo_locations: {} }).editable, false);
});

test("penggabungan targeting mengganti negara/umur saja, sisanya utuh", () => {
  const next = mergeTargeting(TARGETING, { countries: ["mx", " cl ", "MX"], ageMin: 25 });
  assert.deepEqual(next.geo_locations, { countries: ["MX", "CL"], location_types: ["home", "recent"] });
  assert.equal(next.age_min, 25);
  assert.equal(next.age_max, 65);
  assert.deepEqual(next.flexible_spec, TARGETING.flexible_spec);
  assert.deepEqual(next.publisher_platforms, TARGETING.publisher_platforms);
  assert.deepEqual(TARGETING.geo_locations.countries, ["tr"], "yang asli tidak diubah");

  assert.throws(() => mergeTargeting(TARGETING, { ageMin: 40, ageMax: 30 }), /tidak boleh lebih besar/);
  assert.throws(() => mergeTargeting(TARGETING, { ageMin: 17 }), /18 sampai 65/);
  assert.throws(() => mergeTargeting(TARGETING, { countries: ["TUR"] }), /dua huruf/);
  assert.throws(() => mergeTargeting(TARGETING, { countries: [] }), /minimal satu negara/);
  const cities = { ...TARGETING, geo_locations: { countries: ["TR"], cities: [{ key: "1" }] } };
  assert.throws(() => mergeTargeting(cities, { ageMin: 21 }), /Ads Manager/);
});

test("normalizeCountries menerima teks berkoma", () => {
  assert.deepEqual(normalizeCountries("tr, mx  id"), ["TR", "MX", "ID"]);
});

test("penolakan isian oleh Meta jadi 422, sisanya 502", () => {
  assert.equal(metaFailureStatus("Meta 120210 -> Invalid parameter — Budget too low (#100-1885272)"), 422);
  assert.equal(metaFailureStatus("Meta 120210 -> Invalid parameter (#100)"), 422);
  // #100-33 adalah izin yang kurang, bukan isian yang salah.
  assert.equal(metaFailureStatus("Meta 120210 -> Unsupported post request. (#100-33) — token Meta ini"), 502);
  assert.equal(metaFailureStatus("Meta 120210 -> Invalid OAuth access token (#190)"), 502);
  assert.equal(metaFailureStatus("fetch failed"), 502);
});
