import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  adTaxRateOf,
  earningAccountType,
  earningSources,
  formatAdTaxPercent,
  formatRoiPercent,
  MIN_ROI_SPEND,
  withAdTax,
} from "./adTax.js";

describe("earningAccountType", () => {
  test("earning murni AdSense = Adsense Display", () => {
    assert.equal(
      earningAccountType({ adxRevenue: 0, adServerRevenue: 0, adsenseRevenue: 500, earning: 500 }),
      "Adsense Display",
    );
  });

  test("ada earning Ad Exchange = Ad-Exchange, walau bercampur AdSense", () => {
    assert.equal(earningAccountType({ adxRevenue: 900, adsenseRevenue: 0 }), "Ad-Exchange");
    assert.equal(earningAccountType({ adServerRevenue: 300, adsenseRevenue: 100 }), "Ad-Exchange");
  });

  test("baris tanpa rincian sumber tapi punya earning = Ad-Exchange", () => {
    assert.equal(earningAccountType({ earning: 1000 }), "Ad-Exchange");
  });

  test("tanpa earning sama sekali tidak ditebak", () => {
    assert.equal(earningAccountType({}), "");
    assert.equal(earningAccountType({ earning: "" }), "");
    assert.equal(earningAccountType({ earning: 0 }), "", "earning nol bukan Ad-Exchange");
  });
});

describe("adTaxRateOf", () => {
  test("tarif datang dari Settings, dalam persen", () => {
    assert.equal(adTaxRateOf({ adTaxPercent: 5 }), 0.05);
    assert.equal(adTaxRateOf({ adTaxPercent: 11 }), 0.11);
    assert.equal(adTaxRateOf({ adTaxPercent: "7.5" }), 0.075, "form mengirim teks");
  });

  test("0% itu keputusan, field kosong bukan", () => {
    assert.equal(adTaxRateOf({ adTaxPercent: 0 }), 0);
    assert.equal(adTaxRateOf({ adTaxPercent: "" }), 0.05, "kosong = belum diatur, bukan tarif 0");
    assert.equal(adTaxRateOf({}), 0.05);
    assert.equal(adTaxRateOf(undefined), 0.05, "settings belum termuat");
    assert.equal(adTaxRateOf({ adTaxPercent: "abc" }), 0.05);
  });
});

describe("withAdTax", () => {
  test("ROI dibagi total spending, bukan spend telanjang", () => {
    const row = withAdTax({ spending: 100_000, earning: 210_000 }, 0.05);
    assert.equal(row.adTax, 5_000);
    assert.equal(row.totalSpending, 105_000);
    assert.equal(row.profit, 105_000);
    assert.equal(row.roi, 100, "(210.000 − 105.000) / 105.000");
    // Tanpa pajak angka yang sama akan terbaca 110% — selalu lebih untung daripada kenyataan.
    assert.equal(
      withAdTax({ spending: 100_000, earning: 100_000 }, 0.05).roi,
      -4.76,
      "impas masih rugi",
    );
  });

  test("angka yang sudah dibawa baris tidak dihitung ulang", () => {
    // Baris kemarin memuat pajak dengan tarif yang berlaku kemarin. Menghitung ulang dengan tarif
    // hari ini akan menulis ulang riwayat tiap kali Settings diubah.
    const row = withAdTax(
      { spending: 100_000, adTax: 20_000, totalSpending: 120_000, earning: 240_000 },
      0.05,
    );
    assert.equal(row.adTax, 20_000);
    assert.equal(row.totalSpending, 120_000);
    assert.equal(row.roi, 100, "(240.000 − 120.000) / 120.000");
  });

  test("baris lama tanpa ad tax dihitung dengan tarif berjalan", () => {
    // Uang sebagai teks berformat, dan tidak ada kolom pajak sama sekali.
    const row = withAdTax({ spending: "Rp 880.000", earning: "Rp 2.160.000" }, 0.05);
    assert.equal(row.spending, 880000);
    assert.equal(row.adTax, 44000);
    assert.equal(row.totalSpending, 924000);
    assert.equal(row.roi, 133.77);
  });

  // Dulu menjawab 0% "supaya bukan Infinity". Nol itu sendiri sebuah pernyataan — dan pernyataan
  // yang salah untuk subdomain yang menghasilkan Rp 500 tanpa belanja sepeser pun.
  test("belanja di bawah lantai tidak menghasilkan ROI, bukan menghasilkan nol", () => {
    assert.equal(withAdTax({ spending: 0, earning: 500 }, 0.05).roi, "", "bukan 0, bukan Infinity");
    // 3 Agu 2026: belanja Rp 43, earning Rp 153rb — rumus telanjang menjawab +355.456%.
    assert.equal(withAdTax({ spending: 43, earning: 153_000 }, 0.05).roi, "");
    // Tepat di lantai tetap dihitung.
    assert.equal(withAdTax({ totalSpending: MIN_ROI_SPEND, earning: 2_000 }, 0.05).roi, 100);
    // Profit TIDAK ikut dikosongkan: uangnya nyata berapa pun kecilnya pembagi.
    assert.equal(withAdTax({ spending: 0, earning: 500 }, 0.05).profit, 500);
  });

  test("nama field alternatif dari baris ROI subdomain", () => {
    const row = withAdTax({ metaAds: 100_000, adsense: 210_000 }, 0.05);
    assert.equal(row.spending, 100_000);
    assert.equal(row.earning, 210_000);
    assert.equal(row.roi, 100);
  });
});

describe("format", () => {
  test("persen ROI", () => {
    assert.equal(formatRoiPercent(133.766), "+133.77%");
    assert.equal(formatRoiPercent(-100), "-100.00%");
    assert.equal(formatRoiPercent(0), "0.00%");
    assert.equal(formatRoiPercent(""), "-");
    assert.equal(formatRoiPercent("145.45%"), "+145.45%", "baris lama berupa teks");
  });

  test("tarif untuk label kolom", () => {
    assert.equal(formatAdTaxPercent(0.05), "5%");
    assert.equal(formatAdTaxPercent(0.075), "7.5%");
    assert.equal(formatAdTaxPercent(0), "0%");
  });
});

test("earning yang tidak diketahui bukan nol", () => {
  // Baris yang laporan AdSense-nya gagal tidak membawa earning sama sekali. Dibaca sebagai 0, ia
  // menulis "ROI -100%" untuk subdomain yang sebenarnya untung.
  const unknown = withAdTax({ spending: 1000 }, 0.05);
  assert.equal(unknown.earningKnown, false);
  assert.equal(unknown.earning, "", "kosong, bukan 0");
  assert.equal(unknown.roi, "");
  assert.equal(unknown.profit, "");
  assert.equal(unknown.spending, 1000, "sisi spend tetap diketahui");
  assert.equal(unknown.totalSpending, 1050);

  // Nol yang memang dilaporkan tetap nol — dua keadaan yang berlawanan tidak boleh terlihat sama.
  const zero = withAdTax({ spending: 1000, earning: 0 }, 0.05);
  assert.equal(zero.earningKnown, true);
  assert.equal(zero.earning, 0);
  assert.equal(zero.roi, -100);
});

test("spend yang tidak teratribusi bukan nol", () => {
  // dogtraining.petcins.com: earning GAM tanpa satu pun campaign Meta yang mengarah ke sana.
  // Dibaca sebagai spend 0, barisnya menulis "Rp 0" di tiga kolom META ADS — tak terbedakan dari
  // campaign yang hari itu tidak membelanjakan apa pun — dan "ROI 0,00%" untuk subdomain yang
  // seluruh earning-nya keuntungan.
  const unknown = withAdTax({ earning: 625127 }, 0.05);
  assert.equal(unknown.spendingKnown, false);
  assert.equal(unknown.spending, "", "kosong, bukan 0");
  assert.equal(unknown.adTax, "");
  assert.equal(unknown.totalSpending, "");
  assert.equal(unknown.roi, "", "tanpa pembagi tidak ada ROI");
  assert.equal(unknown.profit, "", "earning dikurangi nol adalah klaim yang tidak kita punya");
  assert.equal(unknown.earning, 625127, "sisi earning tetap diketahui");

  // Spend yang memang nol tetap nol — itu ANGKA yang dilaporkan, dan berbeda dari spend yang tidak
  // diketahui di atas. Yang tidak ada cuma ROI-nya: pembagi di bawah lantai (lihat `roiPercent`).
  const zero = withAdTax({ spending: 0, earning: 500 }, 0.05);
  assert.equal(zero.spendingKnown, true);
  assert.equal(zero.spending, 0);
  assert.equal(zero.roi, "", "tidak ada ROI untuk dihitung, bukan 0%");
  assert.equal(zero.profit, 500);

  // Baris lama yang membawa totalSpending tanpa spending tetap dihitung — bentuk lamanya bukan
  // spend yang hilang.
  const legacy = withAdTax({ totalSpending: 1_050, earning: 2_100 }, 0.05);
  assert.equal(legacy.spendingKnown, true);
  assert.equal(legacy.roi, 100);

  // Kedua sisi hilang: tidak ada satu pun angka yang dikarang.
  const nothing = withAdTax({}, 0.05);
  assert.equal(nothing.spendingKnown, false);
  assert.equal(nothing.earningKnown, false);
  assert.equal(nothing.roi, "");
});

describe("earningSources", () => {
  test("GAM = AdX + Ad Server, AdSense berdiri sendiri", () => {
    assert.deepEqual(
      earningSources({ adxRevenue: 800, adServerRevenue: 100, adsenseRevenue: 200 }),
      { gam: 900, adsense: 200 },
    );
  });

  test("earning AdSense penuh: kolom GAM-nya nol, dan nol itu benar", () => {
    assert.deepEqual(earningSources({ adxRevenue: 0, adServerRevenue: 0, adsenseRevenue: 500 }), {
      gam: 0,
      adsense: 500,
    });
  });

  test("baris tanpa rincian sumber tidak ditebak jadi nol", () => {
    assert.deepEqual(earningSources({ earning: 1000 }), { gam: "", adsense: "" });
    assert.deepEqual(earningSources(undefined), { gam: "", adsense: "" });
  });

  test("satu sumber yang ada sudah cukup untuk menjumlahkan sisanya", () => {
    assert.deepEqual(earningSources({ adxRevenue: 700 }), { gam: 700, adsense: "" });
  });
});
