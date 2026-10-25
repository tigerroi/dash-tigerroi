import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  accountTypeOfSlug,
  accountTypeSlug,
  buildTargetRows,
  targetHistoryRows,
  targetMonthRecord,
  targetMonthUpdate,
} from "./targets.js";

// Satu domain, dua subdomain: yang satu murni Ad Exchange, yang satu murni AdSense. Itu bentuk yang
// benar-benar ada di armada — subdomain AdSense datang dari API AdSense dengan adx/adServer nol.
const store = {
  domains: [
    { id: "d1", domainUrl: "designingaround.com" },
    { id: "d2", domainUrl: "petcins.com" },
  ],
  subDomains: [
    { name: "a.designingaround.com", parentDomain: "designingaround.com" },
    { name: "b.designingaround.com", parentDomain: "designingaround.com" },
  ],
  roiReports: [
    {
      date: "2026-08-05",
      subDomain: "a.designingaround.com",
      earning: 19060293,
      adxRevenue: 19060293,
      adsenseRevenue: 0,
    },
    {
      date: "2026-08-06",
      subDomain: "b.designingaround.com",
      earning: 500000,
      adxRevenue: 0,
      adsenseRevenue: 500000,
    },
    // Bulan sebelumnya, untuk kolom Payout Sebelumnya.
    {
      date: "2026-07-20",
      subDomain: "a.designingaround.com",
      earning: 48550508,
      adxRevenue: 48550508,
      adsenseRevenue: 0,
    },
  ],
  domainTargets: {
    d1: {
      "2026-08": {
        "ad-exchanger": { target: 50000000, status: "Limit", catatan: "FOKUS ADX" },
        adsense: { target: 10000000 },
      },
    },
  },
};

describe("targets", () => {
  test("slug jenis akun bolak-balik, dan yang tidak dikenal jadi kosong", () => {
    assert.equal(accountTypeSlug("Ad-Exchanger"), "ad-exchanger");
    assert.equal(accountTypeSlug("adsense"), "adsense"); // ejaan bebas huruf besar-kecil
    assert.equal(accountTypeSlug("Entah"), "");
    assert.equal(accountTypeOfSlug("adsense"), "Adsense");
    assert.equal(accountTypeOfSlug("entah"), "");
  });

  // Bentuk lama node ini adalah satu angka telanjang untuk seluruh domain, tanpa jenis akun.
  test("target bentuk LAMA jatuh utuh ke Ad-Exchanger, bukan ke keduanya", () => {
    const legacy = { d1: { "2026-05": 7000000 } };
    assert.deepEqual(targetMonthRecord(legacy, "d1", "2026-05"), {
      "ad-exchanger": { target: 7000000 },
    });
    assert.deepEqual(targetMonthRecord(legacy, "d1", "2026-06"), {});
    assert.deepEqual(targetMonthRecord(undefined, "d1", "2026-05"), {});
  });

  // Menulis anak dari sebuah angka telanjang menghapus angka itu di RTDB. Yang dikembalikan harus
  // node bulan UTUH, dengan nilai lama yang tidak ikut disunting masih di dalamnya.
  test("menyunting satu jenis tidak menghapus jenis di sebelahnya, termasuk yang bentuk lama", () => {
    const legacy = { d1: { "2026-05": 7000000 } };
    assert.deepEqual(targetMonthUpdate(legacy, "d1", "2026-05", "adsense", { target: "250000" }), {
      "ad-exchanger": { target: 7000000 },
      adsense: { target: 250000 },
    });

    assert.deepEqual(
      targetMonthUpdate(store.domainTargets, "d1", "2026-08", "adsense", {
        target: "12000000",
        status: "Limit Iklan Belum Tayang",
        kendala: "IKLAN LIMIT",
        catatan: "",
      }),
      {
        "ad-exchanger": { target: 50000000, status: "Limit", catatan: "FOKUS ADX" },
        adsense: { target: 12000000, status: "Limit Iklan Belum Tayang", kendala: "IKLAN LIMIT" },
      },
    );
  });

  test("baris yang seluruh isiannya dikosongkan dihapus, dan bulan yang habis jadi null", () => {
    const targets = { d1: { "2026-09": { adsense: { target: 1000 } } } };
    assert.equal(targetMonthUpdate(targets, "d1", "2026-09", "adsense", { target: "" }), null);

    const two = { d1: { "2026-09": { adsense: { target: 1000 }, "ad-exchanger": { target: 5 } } } };
    assert.deepEqual(targetMonthUpdate(two, "d1", "2026-09", "adsense", {}), {
      "ad-exchanger": { target: 5 },
    });
  });

  test("dua baris per domain per bulan, terurut domain lalu Adsense sebelum Ad-Exchanger", () => {
    const rows = buildTargetRows(store, "2026-08");
    assert.deepEqual(
      rows.map((row) => `${row.domain}|${row.accountType}`),
      [
        "designingaround.com|Adsense",
        "designingaround.com|Ad-Exchanger",
        "petcins.com|Adsense",
        "petcins.com|Ad-Exchanger",
      ],
    );
  });

  test("tercapai dipecah per jenis, sisa target = tercapai - target", () => {
    const rows = buildTargetRows(store, "2026-08");
    const adx = rows.find((row) => row.domain === "designingaround.com" && row.slug === "ad-exchanger");
    const adsense = rows.find((row) => row.domain === "designingaround.com" && row.slug === "adsense");

    assert.equal(adx.realized, 19060293);
    assert.equal(adx.target, 50000000);
    assert.equal(adx.remaining, -30939707);
    assert.equal(adx.status, "Limit");
    assert.equal(adx.catatan, "FOKUS ADX");

    assert.equal(adsense.realized, 500000);
    assert.equal(adsense.remaining, -9500000);
  });

  // Kolom Payout Sebelumnya adalah kolom Tercapai bulan LALU — bukan angka kedua yang diketik
  // orang, yang akan berbeda dari tetangganya suatu hari.
  test("payout sebelumnya = tercapai bulan sebelumnya, domain + jenis yang sama", () => {
    const rows = buildTargetRows(store, "2026-08");
    const adx = rows.find((row) => row.domain === "designingaround.com" && row.slug === "ad-exchanger");
    assert.equal(adx.previousPayout, 48550508);

    // Juli tidak punya baris AdSense sama sekali di data ini, tapi bulan itu PUNYA baris ROI —
    // jadi embernya ada dan berisi nol. Nol yang benar, bukan "tidak diketahui".
    const adsense = rows.find((row) => row.domain === "designingaround.com" && row.slug === "adsense");
    assert.equal(adsense.previousPayout, 0);
  });

  // "Tidak diketahui bukan nol": tanpa satu pun baris ROI, Rp 0 di kolom Tercapai adalah klaim
  // bahwa domainnya tidak menghasilkan apa-apa — dan Sisa Target yang lahir darinya adalah vonis.
  test("bulan tanpa satu pun baris ROI mengosongkan Tercapai DAN Sisa Target", () => {
    const rows = buildTargetRows(store, "2026-08");
    const petcins = rows.filter((row) => row.domain === "petcins.com");
    for (const row of petcins) {
      assert.equal(row.realized, "");
      assert.equal(row.remaining, "");
      assert.equal(row.previousPayout, "");
      assert.equal(row.target, ""); // belum pernah diisi: kosong, bukan Rp 0
    }
  });

  test("riwayat memuat bulan bertarget DAN bulan berrealisasi, terbaru dulu", () => {
    const rows = targetHistoryRows(store, "d1", "Ad-Exchanger");
    assert.deepEqual(
      rows.map((row) => row.month),
      ["2026-08", "2026-07"],
    );
    assert.equal(rows[0].realized, 19060293);
    assert.equal(rows[1].realized, 48550508);
    assert.equal(rows[1].target, ""); // Juli belum pernah ditargetkan di data ini
    assert.deepEqual(targetHistoryRows(store, "entah", "Adsense"), []);
  });
});
