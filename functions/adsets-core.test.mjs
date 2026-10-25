import assert from "node:assert/strict";
import test from "node:test";
import { AD_SET_NOT_DELIVERING, adSetGoals, mergeAdSetRows } from "./adsets-core.js";

// Bentuk yang benar-benar dikembalikan `fetchAdSets` untuk campaign "d4k8-5 Pros MECIL Carrou LMP"
// (act_250080654510501, dibaca dari API produksi 7 Sep 2026). Disalin apa adanya: tes yang memakai
// contoh yang disederhanakan sendiri cuma menguji tebakan penulisnya tentang jawaban Meta.
const CBO_SET = {
  id: "120249777765560789",
  name: "MECIL Adset 4",
  status: "ACTIVE",
  effectiveStatus: "ACTIVE",
  startTime: "2026-09-05T00:05:00+0700",
  endTime: "",
  updatedTime: "2026-09-04T16:56:33+0700",
  // Campaign-nya CBO: Meta tidak mengirim anggaran ad set sama sekali.
  dailyBudget: null,
  lifetimeBudget: null,
  bidStrategy: "",
  optimizationGoal: "OFFSITE_CONVERSIONS",
  billingEvent: "IMPRESSIONS",
  customEventType: "CONTENT_VIEW",
  countries: ["MX", "CL"],
  ageMin: 18,
  ageMax: 65,
};

const now = new Date("2026-09-07T10:00:00+07:00");

test("tujuan optimasi dibaca per ad set — tidak ada suara yang kalah", () => {
  const goals = adSetGoals([
    CBO_SET,
    { id: "2", optimizationGoal: "LINK_CLICKS" },
    // Tanpa tujuan yang dikenali: tidak masuk peta sama sekali, jadi hasilnya jatuh ke daftar
    // cadangan di meta.js alih-alih dipaksa memakai tujuan tetangganya.
    { id: "3", optimizationGoal: "REACH" },
  ]);
  assert.deepEqual(goals.get("120249777765560789"), [
    "offsite_conversion.fb_pixel_view_content",
    "omni_view_content",
    "view_content",
  ]);
  assert.deepEqual(goals.get("2"), ["link_click"]);
  assert.equal(goals.has("3"), false);
});

test("custom conversion ikut ke tujuan ad set", () => {
  const goals = adSetGoals([
    {
      id: "9",
      optimizationGoal: "VALUE",
      customEventType: "OTHER",
      customConversionId: "1063447699853124",
    },
  ]);
  assert.deepEqual(goals.get("9"), ["offsite_conversion.custom.1063447699853124"]);
});

// Meta tidak selalu mengirim biaya untuk event hasilnya di `cost_per_action_type`. Hasilnya ada,
// belanjanya ada — kolom Biaya/hasil yang kosong di sana menyembunyikan angka yang bisa dihitung,
// sepola dengan cadangan `costPerResult(spend, results)` di baris campaign.
test("biaya/hasil dihitung dari spend ÷ hasil kalau Meta tidak mengirimkannya", () => {
  const insight = { adSetId: CBO_SET.id, spend: 40518, results: 3527, costPerResult: null };
  const [row] = mergeAdSetRows([CBO_SET], [insight], { now });
  assert.equal(row.costPerResult, 11.49);

  const [noResults] = mergeAdSetRows([CBO_SET], [{ ...insight, results: 0 }], { now });
  assert.equal(noResults.costPerResult, "", "tanpa hasil tidak ada pembagi — bukan Rp 0");

  const [fromMeta] = mergeAdSetRows([CBO_SET], [{ ...insight, costPerResult: 11.48795 }], { now });
  assert.equal(fromMeta.costPerResult, 11.48795, "angka Meta menang atas hitungan sendiri");
});

/**
 * Pembeda paling penting di berkas ini.
 *
 * Ad set yang laporannya BERHASIL tapi tidak punya baris = tidak tayang, dan nol di sana adalah
 * pernyataan yang benar. Ad set yang laporannya GAGAL tidak diketahui apa-apa, dan nol di sana
 * berbohong — persis `earningKnown` di baris ROI. Dilebur, panel ini melaporkan "Rp 0" untuk
 * campaign yang laporannya tidak pernah datang.
 */
test("tidak tayang = 0; laporan gagal = kosong", () => {
  const [idle] = mergeAdSetRows([CBO_SET], [], { now });
  assert.equal(idle.spend, 0);
  assert.equal(idle.impressions, 0);
  assert.equal(idle.results, 0);
  // Yang butuh pembagi tetap kosong walau laporannya berhasil: "CTR 0%" adalah pernyataan tentang
  // iklan yang pernah dilihat orang.
  assert.equal(idle.ctr, "");
  assert.equal(idle.cpc, "");
  assert.equal(idle.costPerResult, "");

  const [unknown] = mergeAdSetRows([CBO_SET], [], { now, metricsKnown: false });
  for (const key of ["spend", "impressions", "clicks", "results", "ctr", "cpc", "costPerResult"]) {
    assert.equal(unknown[key], "", `${key} harus kosong saat laporannya gagal`);
  }
  // Yang TIDAK ikut kosong: setelan dan statusnya sudah di tangan dari panggilan yang berhasil.
  assert.equal(unknown.status, "Aktif");
  assert.equal(unknown.optimizationGoal, "OFFSITE_CONVERSIONS");
});

test("label status memakai kosakata yang sama dengan baris campaign", () => {
  const rows = mergeAdSetRows(
    [
      CBO_SET,
      { id: "2", name: "B", status: "PAUSED" },
      { id: "3", name: "C", status: "ACTIVE", startTime: "2026-09-20T00:00:00+0700" },
      { id: "4", name: "D", status: "" },
    ],
    [],
    { now },
  );
  const label = Object.fromEntries(rows.map((row) => [row.id, row.status]));
  assert.equal(label["120249777765560789"], "Aktif");
  assert.equal(label["2"], "Tidak aktif");
  // Jadwal yang belum sampai — sama seperti campaign, dan bukan "Aktif".
  assert.equal(label["3"], "Terjadwal");
  // Status yang tidak terbaca tidak ditebak jadi apa pun.
  assert.equal(label["4"], "");
});

/**
 * Ad set bersaklar On yang campaign di atasnya mati.
 *
 * Ini satu-satunya keadaan di panel ini yang tidak bisa dibaca dari kolom mana pun, dan yang
 * menjawab "kenapa ad set ini Aktif tapi Rp 0". Labelnya TETAP "Aktif" — itu posisi saklarnya
 * sendiri, aturan yang sama dengan baris campaign — dan yang menyebut sebabnya penanda ini.
 */
test("CAMPAIGN_PAUSED ditandai, tanpa mengubah label saklarnya sendiri", () => {
  const [row] = mergeAdSetRows(
    [{ ...CBO_SET, effectiveStatus: "CAMPAIGN_PAUSED" }],
    [],
    { now },
  );
  assert.equal(row.status, "Aktif");
  assert.equal(row.pausedByCampaign, true);

  const [normal] = mergeAdSetRows([CBO_SET], [], { now });
  assert.equal(normal.pausedByCampaign, false);
});

test("anggaran: CBO tidak punya angka di ad set, dan itu bukan nol", () => {
  const rows = mergeAdSetRows(
    [
      CBO_SET,
      { id: "2", name: "ABO harian", status: "ACTIVE", dailyBudget: 100000, lifetimeBudget: null },
      { id: "3", name: "ABO seumur hidup", status: "ACTIVE", dailyBudget: null, lifetimeBudget: 5000000 },
    ],
    [],
    { now },
  );
  const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
  assert.equal(byId["120249777765560789"].dailyBudget, "");
  assert.equal(byId["120249777765560789"].budgetLevel, "campaign");
  assert.equal(byId["2"].dailyBudget, 100000);
  assert.equal(byId["2"].budgetLevel, "adset");
  // Anggaran seumur hidup tetap anggaran ad set: kolom hariannya kosong, tapi bukan CBO.
  assert.equal(byId["3"].budgetLevel, "adset");
  assert.equal(byId["3"].lifetimeBudget, 5000000);
});

test("terurut spend terbesar dulu, lalu nama", () => {
  const rows = mergeAdSetRows(
    [
      { id: "1", name: "Zulu", status: "ACTIVE" },
      { id: "2", name: "Alfa", status: "ACTIVE" },
      { id: "3", name: "Besar", status: "ACTIVE" },
    ],
    [{ adSetId: "3", spend: 69419, impressions: 7057, clicks: 4708, ctr: 66.71 }],
    { now },
  );
  assert.deepEqual(
    rows.map((row) => row.name),
    ["Besar", "Alfa", "Zulu"],
  );
  assert.equal(rows[0].spend, 69419);
  assert.equal(rows[0].ctr, 66.71);
});

// Baris insights untuk ad set yang sudah tidak ada di daftar setelan (dihapus di sela dua
// panggilan) tidak boleh memunculkan baris hantu: yang digambar panel adalah ISI campaign-nya.
test("baris insights tanpa ad set-nya tidak ikut", () => {
  const rows = mergeAdSetRows([CBO_SET], [{ adSetId: "hantu", spend: 1000 }], { now });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].spend, 0);
});

/**
 * "Tidak ditayangkan" — keadaan yang dibaca operator di Ads Manager dan tidak ada di
 * satu pun field ad set.
 *
 * Angka-angkanya dari campaign RNPX-01 di API produksi (act_3100918953544891, 7 Sep 2026): 5 ad
 * set ACTIVE, tiga beriklan ACTIVE dan masih berimpresi pukul 14:00, dua beriklan DISAPPROVED dan
 * berhenti sejak pukul 02:00 dan 09:00.
 */
test("ad set yang seluruh iklannya ditolak berbunyi tidak ditayangkan", () => {
  const sets = [
    { id: "tayang", name: "tayang", status: "ACTIVE", effectiveStatus: "ACTIVE" },
    { id: "ditolak", name: "ditolak", status: "ACTIVE", effectiveStatus: "ACTIVE" },
  ];
  const ads = [
    { adSetId: "tayang", status: "ACTIVE", effectiveStatus: "ACTIVE" },
    { adSetId: "ditolak", status: "ACTIVE", effectiveStatus: "DISAPPROVED" },
  ];
  const rows = mergeAdSetRows(sets, [], { now, ads });
  const byId = Object.fromEntries(rows.map((row) => [row.id, row]));

  assert.equal(byId.tayang.status, "Aktif");
  assert.equal(byId.tayang.notDelivering, false);
  assert.equal(byId.ditolak.status, AD_SET_NOT_DELIVERING);
  assert.equal(byId.ditolak.notDelivering, true);
  // Rekap iklannya ikut, karena kalimat di bawah pilnya harus menyebut SEBABNYA.
  assert.deepEqual(byId.ditolak.ads, { total: 1, deliverable: 0, blockers: { DISAPPROVED: 1 } });
});

test("satu iklan yang masih hidup sudah cukup — ad set-nya tayang", () => {
  const rows = mergeAdSetRows(
    [{ id: "a", name: "a", status: "ACTIVE", effectiveStatus: "ACTIVE" }],
    [],
    {
      now,
      ads: [
        { adSetId: "a", effectiveStatus: "DISAPPROVED" },
        { adSetId: "a", effectiveStatus: "ACTIVE" },
      ],
    },
  );
  assert.equal(rows[0].status, "Aktif");
  assert.equal(rows[0].ads.deliverable, 1);
});

/**
 * Penjaga paling penting di keadaan baru ini: daftar iklan yang GAGAL dibaca tidak boleh
 * menghasilkan vonis. `ads: null` berarti tidak diketahui, bukan "tidak punya iklan" — sepola
 * earning yang tidak diketahui, yang tidak pernah dinilai sebagai nol.
 */
test("tanpa daftar iklan, tidak ada yang divonis tidak ditayangkan", () => {
  const rows = mergeAdSetRows(
    [{ id: "a", name: "a", status: "ACTIVE", effectiveStatus: "ACTIVE" }],
    [],
    { now },
  );
  assert.equal(rows[0].status, "Aktif");
  assert.equal(rows[0].notDelivering, false);
  assert.equal(rows[0].ads, null);
});

test("ad set aktif tanpa satu pun iklan tidak menayangkan apa pun", () => {
  const rows = mergeAdSetRows(
    [{ id: "a", name: "a", status: "ACTIVE", effectiveStatus: "ACTIVE" }],
    [],
    { now, ads: [] },
  );
  assert.equal(rows[0].status, AD_SET_NOT_DELIVERING);
  assert.deepEqual(rows[0].ads, { total: 0, deliverable: 0, blockers: {} });
});

test("keadaan efektif ad set sendiri juga menahannya, tanpa perlu daftar iklan", () => {
  const rows = mergeAdSetRows(
    [{ id: "a", name: "a", status: "ACTIVE", effectiveStatus: "PENDING_REVIEW" }],
    [],
    { now },
  );
  assert.equal(rows[0].status, AD_SET_NOT_DELIVERING);
});

/**
 * Tiga yang SENGAJA tidak ikut merah.
 *
 * CAMPAIGN_PAUSED: sebabnya berdiri di baris tepat di atasnya yang sudah berbunyi "Tidak aktif",
 * dan mewarnai merah seluruh ad set milik campaign yang memang sedang dimatikan orang menghapus
 * arti merahnya. "Terjadwal": belum waktunya tayang, bukan kegagalan. Saklar Off: tidak ada yang
 * diharapkan tayang.
 */
test("campaign yang dimatikan, jadwal yang belum sampai, dan saklar Off tidak ikut merah", () => {
  const ads = [
    { adSetId: "camp", effectiveStatus: "CAMPAIGN_PAUSED" },
    { adSetId: "jadwal", effectiveStatus: "DISAPPROVED" },
    { adSetId: "mati", effectiveStatus: "ADSET_PAUSED" },
  ];
  const rows = mergeAdSetRows(
    [
      { id: "camp", name: "camp", status: "ACTIVE", effectiveStatus: "CAMPAIGN_PAUSED" },
      {
        id: "jadwal",
        name: "jadwal",
        status: "ACTIVE",
        effectiveStatus: "ACTIVE",
        startTime: "2026-09-20T00:00:00+0700",
      },
      { id: "mati", name: "mati", status: "PAUSED", effectiveStatus: "PAUSED" },
    ],
    [],
    { now, ads },
  );
  const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
  assert.equal(byId.camp.status, "Aktif");
  assert.equal(byId.camp.pausedByCampaign, true);
  assert.equal(byId.jadwal.status, "Terjadwal");
  assert.equal(byId.mati.status, "Tidak aktif");
  for (const row of rows) assert.equal(row.notDelivering, false);
});
