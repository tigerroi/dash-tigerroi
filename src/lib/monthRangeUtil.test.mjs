import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { wholeMonthsIn } from "./dateRange.js";
import {
  isWholeMonthSpan,
  monthSpanOf,
  monthSpanRange,
  previousMonthSpanRange,
} from "./monthRangeUtil.js";

describe("monthSpanRange", () => {
  test("satu bulan jadi rentang penuh, tanggal 1 sampai hari terakhir", () => {
    assert.deepEqual(monthSpanRange("2026-08", "2026-08"), { from: "2026-08-01", to: "2026-08-31" });
    assert.deepEqual(monthSpanRange("2026-06", "2026-06"), { from: "2026-06-01", to: "2026-06-30" });
  });

  test("Februari tahun kabisat tidak dibulatkan jadi 28", () => {
    assert.deepEqual(monthSpanRange("2028-02", "2028-02"), { from: "2028-02-01", to: "2028-02-29" });
  });

  test("dua bulan dibalik kalau yang dipilih duluan justru yang belakangan", () => {
    assert.deepEqual(monthSpanRange("2026-08", "2026-06"), { from: "2026-06-01", to: "2026-08-31" });
  });

  /**
   * Inti keberadaan pemilih ini: apa pun yang dihasilkannya menutup bulannya PENUH, jadi nominal
   * invalid traffic, earning akun ditutup, dan potongan pencairan bulan itu selalu ikut. Pemilih
   * harian bisa menghasilkan "1–30 Agustus", yang menjatuhkan ketiganya sekaligus tanpa satu pun
   * angka di layar yang berubah bentuk.
   */
  test("setiap rentangnya dibaca wholeMonthsIn sebagai bulan yang UTUH", () => {
    for (const [from, to] of [
      ["2026-01", "2026-01"],
      ["2026-02", "2026-04"],
      ["2025-11", "2026-02"],
    ]) {
      const range = monthSpanRange(from, to);
      const whole = wholeMonthsIn(range);
      assert.equal(whole[0], from);
      assert.equal(whole[whole.length - 1], to);
    }
  });
});

describe("monthSpanOf", () => {
  test("membaca kembali rentang yang ditulis pemilihnya", () => {
    assert.deepEqual(monthSpanOf({ from: "2026-06-01", to: "2026-08-31" }), {
      from: "2026-06",
      to: "2026-08",
    });
  });

  // Alamat yang ditulis pemilih HARIAN sebelum halaman ini punya pemilih bulan tetap harus bisa
  // digambarkan: yang menolak membacanya akan tampil kosong di atas tabel yang justru berisi.
  test("rentang harian lama tetap terbaca sebagai bulan yang disentuhnya", () => {
    assert.deepEqual(monthSpanOf({ from: "2026-08-12", to: "2026-08-19" }), {
      from: "2026-08",
      to: "2026-08",
    });
  });

  test("sisi yang kosong memakai sisi yang ada, bukan bulan berjalan", () => {
    assert.deepEqual(monthSpanOf({ from: "", to: "2026-05-31" }), { from: "2026-05", to: "2026-05" });
  });
});

describe("isWholeMonthSpan", () => {
  test("rentang bulan penuh dikenali; yang terpotong tidak", () => {
    assert.equal(isWholeMonthSpan({ from: "2026-08-01", to: "2026-08-31" }), true);
    // Bawaan LAMA halaman ini: bulan berjalan dipotong di hari ini. Persis bentuk yang membuat
    // ketiga sumber bulanan tidak ikut, dan yang harus disebutkan "(sebagian)" di tombolnya.
    assert.equal(isWholeMonthSpan({ from: "2026-08-01", to: "2026-08-20" }), false);
    assert.equal(isWholeMonthSpan({ from: "2026-08-02", to: "2026-08-31" }), false);
  });
});

describe("previousMonthSpanRange", () => {
  test("bulan kalender penuh sebelumnya, berapa pun panjang bulannya", () => {
    // Maret 31 hari melawan SELURUH Februari — bukan 29 Jan–28 Feb, yang tidak menutup satu bulan
    // pun dan karena itu kehilangan invalid traffic, akun ditutup, serta potongan pencairan.
    assert.deepEqual(previousMonthSpanRange({ from: "2026-03-01", to: "2026-03-31" }), {
      from: "2026-02-01",
      to: "2026-02-28",
    });
    assert.deepEqual(previousMonthSpanRange({ from: "2026-01-01", to: "2026-01-31" }), {
      from: "2025-12-01",
      to: "2025-12-31",
    });
  });

  test("rentang beberapa bulan mundur sebanyak bulannya", () => {
    assert.deepEqual(previousMonthSpanRange({ from: "2026-06-01", to: "2026-08-31" }), {
      from: "2026-03-01",
      to: "2026-05-31",
    });
  });

  test("rentang harian dari alamat lama tetap dibandingkan dengan bulan penuh sebelumnya", () => {
    assert.deepEqual(previousMonthSpanRange({ from: "2026-08-01", to: "2026-08-20" }), {
      from: "2026-07-01",
      to: "2026-07-31",
    });
  });

  test("rentang tanpa batas tidak punya pembanding", () => {
    assert.deepEqual(previousMonthSpanRange({ from: "", to: "" }), { from: "", to: "" });
    assert.deepEqual(previousMonthSpanRange({ from: "2026-08-10", to: "2026-08-01" }), {
      from: "",
      to: "",
    });
  });
});
