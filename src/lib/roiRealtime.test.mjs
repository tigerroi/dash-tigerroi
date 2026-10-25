import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildCountryBreakdown } from "./countryBreakdown.js";
import {
  earningSourceLabel,
  normalizeRealtimeRoiRow,
  realtimeRoiColumnTone,
  realtimeRoiRows,
} from "./roiRealtime.js";

describe("realtimeRoiRows", () => {
  const snapshots = [
    { id: "2026-08-12T09-00__a", date: "2026-08-12", time: "09:00", subDomain: "a.example.com" },
    { id: "2026-08-12T15-00__a", date: "2026-08-12", time: "15:00", subDomain: "a.example.com" },
    { id: "2026-08-12T15-00__b", date: "2026-08-12", time: "15:00", subDomain: "b.example.com" },
  ];
  const daily = [
    // Hari yang sama dengan snapshot: salinan sync terakhir, jadi tidak boleh ikut tampil.
    { id: "2026-08-12__a", date: "2026-08-12", time: "15:00", subDomain: "a.example.com" },
    { id: "2026-08-11__a", date: "2026-08-11", time: "23:00", subDomain: "a.example.com" },
    { id: "2026-08-10__b", date: "2026-08-10", time: "23:00", subDomain: "b.example.com" },
  ];
  const ids = (rows) => rows.map((row) => row.id);

  test("snapshot menggantikan baris harian hari yang sama, per subdomain", () => {
    const rows = realtimeRoiRows(snapshots, daily);
    assert.equal(rows.filter((row) => row.id === "2026-08-12__a").length, 0);
    assert.ok(ids(rows).includes("2026-08-11__a"), "hari tanpa snapshot tetap dari baris harian");
    assert.equal(rows.length, 5);
  });

  test("subdomain lain di hari yang sama tidak ikut terbuang", () => {
    // b.example.com punya snapshot 12 Agu, jadi baris hariannya 10 Agu tetap tampil — penjodohan
    // hari saja akan membuang riwayat subdomain yang kebetulan disnapshot hari ini.
    assert.ok(ids(realtimeRoiRows(snapshots, daily)).includes("2026-08-10__b"));
  });

  test("terbaru dulu: hari turun, lalu jam turun", () => {
    assert.deepEqual(ids(realtimeRoiRows(snapshots, daily)), [
      "2026-08-12T15-00__a",
      "2026-08-12T15-00__b",
      "2026-08-12T09-00__a",
      "2026-08-11__a",
      "2026-08-10__b",
    ]);
  });

  test("tanpa snapshot, tabel jadi baris harian apa adanya", () => {
    assert.deepEqual(ids(realtimeRoiRows([], daily)), [
      "2026-08-12__a",
      "2026-08-11__a",
      "2026-08-10__b",
    ]);
    assert.deepEqual(realtimeRoiRows(null, null), []);
  });
});

describe("normalizeRealtimeRoiRow", () => {
  const row = {
    id: "2026-08-12T15-00__a",
    date: "2026-08-12",
    time: "15:00",
    subDomain: "a.example.com",
    campaign: "ABCD TRAFF",
    spending: 1_000_000,
    // `earning` adalah JUMLAH ketiga sumber di bawahnya — itu yang ditulis sisi sync, dan itu
    // yang dibagi `withAdTax`. Ketiga kolom sumbernya cuma rinciannya.
    earning: 2_800_000,
    adxRevenue: 2_000_000,
    adServerRevenue: 500_000,
    adsenseRevenue: 300_000,
    flukSpend: 12_000,
    flukEarn: 34_000,
    flukRoi: 5,
    clicks: 120,
    cpc: 900,
    ecpm: 1_500,
    cpr: 4_000,
    balance: 7_000_000,
  };

  test("kolom yang dulu cuma ada di Overview ikut untuk KEDUA tabel", () => {
    // Inilah yang membuat berkas ini jadi satu tempat: tabel di /users/{uid} punya penormal
    // sendiri, dan enam kolom ini tidak pernah sampai ke sana.
    const out = normalizeRealtimeRoiRow(row, 0.05, undefined);
    assert.equal(out.flukSpend, 12_000);
    assert.equal(out.flukEarn, 34_000);
    assert.equal(out.flukRoi, 5);
    assert.equal(out.metaBalance, 7_000_000);
    assert.ok(Number(out.profit) > 0, "profit ikut dihitung");
    assert.deepEqual(out.countries, [], "tanpa rincian negara tetap array, bukan undefined");
  });

  test("eCPM dibaca dari dua nama, dan selalu keluar sebagai satu kunci", () => {
    // Pengurutan kolom membaca kunci barisnya. Dua tabel yang memakai kunci berbeda berarti yang
    // satu diam saja saat kepala kolomnya diklik.
    assert.equal(normalizeRealtimeRoiRow(row, 0).pageRpm, 1_500);
    assert.equal(normalizeRealtimeRoiRow({ ...row, ecpm: "", pageRpm: 2_100 }, 0).pageRpm, 2_100);
  });

  test("spend di bawah lantai ROI tidak menghasilkan ROI, dan spend tak dikenal tidak jadi nol", () => {
    assert.equal(normalizeRealtimeRoiRow({ ...row, spending: 43 }, 0).roi, "");
    const unmapped = normalizeRealtimeRoiRow({ ...row, spending: undefined }, 0);
    assert.equal(unmapped.spendingKnown, false);
    assert.equal(unmapped.metaSpend, "");
  });

  test("rincian negara dijodohkan lewat hari + subdomain", () => {
    const index = buildCountryBreakdown(
      [{ id: "u1", countryRoi: { k: { date: "2026-08-12", subDomain: "a.example.com" } } }],
      0,
    );
    assert.equal(normalizeRealtimeRoiRow(row, 0, index).countries.length, 1);
    assert.deepEqual(normalizeRealtimeRoiRow({ ...row, date: "2026-08-11" }, 0, index).countries, []);
  });
});

describe("earningSourceLabel", () => {
  test("baris tanpa `source` dihitung GAM, bukan ADSENSE", () => {
    assert.equal(earningSourceLabel([{}, { source: "" }]), "GAM");
    assert.equal(earningSourceLabel([]), "GAM");
    assert.equal(earningSourceLabel(undefined), "GAM");
  });

  test("dua sumber di satu tabel disebut keduanya", () => {
    assert.equal(earningSourceLabel([{ source: "adsense" }, { source: "GAM" }]), "ADSENSE / GAM");
  });
});

describe("realtimeRoiColumnTone", () => {
  test("CPR milik sisi Meta, CPC/eCPM milik sisi earning", () => {
    // CPR = spend Meta ÷ hasil; CPC di sini earning per klik. Ketiganya pernah berdiri di bawah
    // kepala kelompok yang salah.
    assert.equal(realtimeRoiColumnTone("cpr"), "meta");
    assert.equal(realtimeRoiColumnTone("cpc"), "gam");
    assert.equal(realtimeRoiColumnTone("pageRpm"), "gam");
    assert.equal(realtimeRoiColumnTone("metaBalance"), "meta");
    assert.equal(realtimeRoiColumnTone("flukRoi"), "roi");
    assert.equal(realtimeRoiColumnTone("flukSpend"), "positive");
  });
});
