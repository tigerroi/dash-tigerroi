import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  estimateFirebaseCost,
  formatBytes,
  formatUsd,
  heavyNodesOf,
  measureNode,
  sessionize,
  SESSION_GAP_MS,
} from "./firebaseCost.js";
import { HEAVY_NODES, sessionNodes } from "./storeSubscriptions.js";

const at = (minutes) => new Date(Date.UTC(2026, 8, 8, 0, minutes)).toISOString();

const row = (overrides = {}) => ({
  actorEmail: "a@x.io",
  actorRole: "admin",
  category: "navigation",
  page: "/domains",
  at: at(0),
  ...overrides,
});

describe("sessionize", () => {
  it("menyatukan jejak yang berdekatan jadi satu muat aplikasi", () => {
    const sessions = sessionize([row({ at: at(0) }), row({ at: at(5) }), row({ at: at(29) })]);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].events, 3);
  });

  it("memotong sesi begitu jedanya melewati batas", () => {
    const sessions = sessionize([row({ at: at(0) }), row({ at: at(31) })]);
    assert.equal(sessions.length, 2);
  });

  // Login SELALU membuka sesi baru: di situ aplikasinya memang baru saja mount, dan sebuah jeda
  // yang kebetulan pendek (logout lalu login lagi) tidak mengubah itu.
  it("baris auth membuka sesi baru berapa pun jedanya", () => {
    const sessions = sessionize([row({ at: at(0) }), row({ at: at(1), category: "auth" })]);
    assert.equal(sessions.length, 2);
  });

  it("memisahkan orang yang berbeda", () => {
    const sessions = sessionize([row({ at: at(0) }), row({ at: at(1), actorEmail: "b@x.io" })]);
    assert.equal(sessions.length, 2);
  });

  // `at` datang dari jam PERANGKAT dan boleh sampah. Satu baris begitu tidak boleh memotong sesi.
  it("membuang baris yang jamnya tidak terbaca", () => {
    const sessions = sessionize([row({ at: at(0) }), row({ at: "bukan tanggal" }), row({ at: at(2) })]);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].events, 2);
  });

  it("jedanya sama dengan yang diumumkan modul", () => {
    assert.equal(SESSION_GAP_MS, 30 * 60 * 1000);
  });
});

describe("heavyNodesOf", () => {
  // Aturannya diimpor dari heavyData lewat resolveRoute, bukan ditulis ulang — dan tes ini yang
  // membuktikan jalur itu benar-benar tersambung.
  it("tab ROI menarik keduanya", () => {
    assert.deepEqual(heavyNodesOf(["/dashboard/roi"]).sort(), ["roiSnapshots", "userReports"]);
  });

  it("tab Grafik cuma menarik roiSnapshots", () => {
    assert.deepEqual(heavyNodesOf(["/dashboard/grafik"]), ["roiSnapshots"]);
  });

  it("halaman biasa tidak menarik satu pun", () => {
    assert.deepEqual(heavyNodesOf(["/domains", "/expenses"]), []);
  });

  // Form user TIDAK menggambar satu pun panel riwayat — kalau ini ikut, estimasinya naik hampir
  // 5 MB per sesi untuk sesuatu yang justru sudah dihemat.
  it("form user tidak ikut, halaman detailnya ikut", () => {
    assert.deepEqual(heavyNodesOf(["/users/abc/edit"]), []);
    assert.ok(heavyNodesOf(["/users/abc"]).includes("userReports"));
  });
});

describe("sessionNodes", () => {
  it("superadmin melanggan lebih banyak daripada advertiser", () => {
    const superadmin = sessionNodes("superadmin", ["users", "otpSecrets"]);
    const advertiser = sessionNodes("advertiser", ["users", "otpSecrets"]);
    assert.ok(superadmin.length > advertiser.length);
    assert.ok(superadmin.includes("gateCampaigns"));
    assert.ok(!advertiser.includes("gateCampaigns"));
  });

  // Node berat dipasang menurut ROUTE, bukan menurut role — ikut di bacaan dasar, sesi yang cuma
  // membuka Domains akan dilaporkan membayar sesuatu yang tidak pernah diunduhnya.
  it("tidak pernah memuat node berat", () => {
    for (const node of HEAVY_NODES) {
      assert.ok(!sessionNodes("superadmin", []).includes(node));
    }
  });

  // Isinya nama campaign dan siapa yang menyalinnya, untuk halaman yang cuma dibuka superadmin.
  it("job salinan dan job buat campaign cuma dilanggan superadmin", () => {
    for (const node of ["campaignCopyJobs", "campaignCreateJobs"]) {
      assert.ok(sessionNodes("superadmin", []).includes(node));
      assert.ok(!sessionNodes("admin", []).includes(node));
      assert.ok(!sessionNodes("advertiser", []).includes(node));
    }
  });
});

describe("estimateFirebaseCost", () => {
  const sizes = { users: 1024, domains: 512, roiSnapshots: 2048, userReports: 4096 };

  it("menjumlah per orang dan membagi per hari yang ADA jejaknya", () => {
    const out = estimateFirebaseCost({
      rows: [row({ at: at(0) }), row({ at: at(60) })],
      sizes,
      resourceKeys: ["users", "domains"],
    });
    assert.equal(out.sessions, 2);
    assert.equal(out.dayCount, 1);
    assert.equal(out.rows.length, 1);
    // Dua muat × (users + domains). Node dashboard tidak punya ukuran di peta ini, jadi ia tidak
    // ikut dijumlah — dan itu yang diperiksa baris berikutnya.
    assert.equal(out.bytes, 2 * (1024 + 512));
    assert.equal(out.bytesPerDay, out.bytes);
  });

  // Nol untuk node yang belum terukur adalah klaim bahwa node itu tidak berisi apa-apa. Ia
  // dikembalikan sebagai daftar, dan panelnya menyebutkannya.
  it("node yang belum terukur dilaporkan, bukan dinilai nol", () => {
    const out = estimateFirebaseCost({
      rows: [row()],
      sizes: { users: 1024 },
      resourceKeys: ["users", "domains"],
    });
    assert.ok(out.unknownNodes.includes("domains"));
    assert.equal(out.bytes, 1024);
  });

  it("sesi yang membuka halaman berat membayar lebih daripada yang tidak", () => {
    const plain = estimateFirebaseCost({
      rows: [row({ page: "/domains" })],
      sizes,
      resourceKeys: ["users"],
    });
    const heavy = estimateFirebaseCost({
      rows: [row({ page: "/dashboard/roi" })],
      sizes,
      resourceKeys: ["users"],
    });
    assert.equal(heavy.bytes - plain.bytes, 2048 + 4096);
    assert.equal(heavy.rows[0].heavySessions, 1);
    assert.equal(plain.rows[0].heavySessions, 0);
  });

  // Berpindah halaman TIDAK mengunduh ulang apa pun: sepuluh kunjungan dalam satu sesi tetap satu
  // muat aplikasi. Ini pembeda utamanya dari "kunjungan halaman × ukuran database".
  it("kunjungan halaman beruntun tidak menggandakan unduhan", () => {
    const once = estimateFirebaseCost({ rows: [row()], sizes, resourceKeys: ["users"] });
    const many = estimateFirebaseCost({
      rows: [row({ at: at(0) }), row({ at: at(1) }), row({ at: at(2) })],
      sizes,
      resourceKeys: ["users"],
    });
    assert.equal(many.bytes, once.bytes);
    assert.equal(many.rows[0].events, 3);
  });

  it("rentang tanpa jejak tidak membagi dengan nol", () => {
    const out = estimateFirebaseCost({ rows: [], sizes });
    assert.equal(out.bytesPerDay, 0);
    assert.equal(out.costPerMonth, 0);
  });

  it("harga dihitung per GiB", () => {
    const out = estimateFirebaseCost({
      rows: [row()],
      sizes: { users: 1024 ** 3 },
      resourceKeys: ["users"],
    });
    assert.equal(out.cost, 1);
  });
});

describe("measureNode", () => {
  it("mengukur panjang JSON-nya", () => {
    assert.equal(measureNode({ a: 1 }), 7);
  });

  it("nilai yang belum ada menjawab null, bukan nol", () => {
    assert.equal(measureNode(undefined), null);
    assert.equal(measureNode(null), null);
  });
});

describe("format", () => {
  it("byte naik satuan", () => {
    assert.equal(formatBytes(1024), "1,00 KB");
    assert.equal(formatBytes(3.12 * 1024 ** 2), "3,12 MB");
    assert.equal(formatBytes(0), "-");
  });

  // Dolar, bukan rupiah: yang ditagihkan Google memang USD, dan angkanya kecil — dua desimal
  // membuat unduhan 200 MB berbunyi "$0,00".
  it("dolar dengan empat desimal untuk angka kecil", () => {
    assert.equal(formatUsd(0.0031), "$0,0031");
    assert.equal(formatUsd(120.5), "$120,50");
  });
});
