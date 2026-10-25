import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { formatDate, formatDateTime, formatDayMonth, formatMonth, isDateLike } from "./formatDate.js";

describe("formatDate", () => {
  test('satu bentuk untuk semua sumber tanggal: "09 Agu 2026"', () => {
    assert.equal(formatDate("2026-08-09"), "09 Agu 2026", "ISO dari sync");
    assert.equal(formatDate("09/08/2026"), "09 Agu 2026", "bentuk lama yang masih tersimpan");
    assert.equal(formatDate("2026-08-09 14:32"), "09 Agu 2026", "stempel waktu backend");
    assert.equal(formatDate(new Date(2026, 7, 9)), "09 Agu 2026");
    assert.equal(formatDate("2026-01-05"), "05 Jan 2026", "hari & bulan satu digit tetap dua digit");
  });

  test("tanggal tanpa jam tidak lewat new Date()", () => {
    // "2026-08-09" diurai new Date() sebagai tengah malam UTC; di zona waktu negatif itu mundur
    // jadi tanggal 8. Tanggal yang bergeser satu hari tergantung siapa yang membukanya adalah
    // persis jenis kesalahan yang tidak akan pernah dilaporkan orang.
    assert.equal(formatDate("2026-08-01"), "01 Agu 2026");
    assert.equal(formatDate("2026-01-01"), "01 Jan 2026");
  });

  test("yang kosong jadi '-', yang bukan tanggal dibiarkan apa adanya", () => {
    assert.equal(formatDate(""), "-");
    assert.equal(formatDate(null), "-");
    assert.equal(formatDate(undefined), "-");
    assert.equal(formatDate("-"), "-");
    // Memformat paksa akan menghapus isi kolom yang kebetulan bukan tanggal.
    assert.equal(formatDate("ca-pub-123"), "ca-pub-123");
  });

  test("formatDateTime menyebut jamnya kalau jamnya berarti", () => {
    assert.equal(formatDateTime("2026-08-07 14:32"), "07 Agu 2026, 14:32");
    assert.equal(formatDateTime("2026-08-09"), "09 Agu 2026", "tanpa jam, tidak dikarang");
    assert.equal(formatDateTime(""), "-");
  });

  test("formatMonth untuk kunci bulan Targets", () => {
    assert.equal(formatMonth("2026-08"), "Agu 2026");
    assert.equal(formatMonth("2026-12"), "Des 2026");
    assert.equal(formatMonth("2026-08-09"), "Agu 2026");
  });

  test("formatDayMonth untuk sumbu grafik yang sempit", () => {
    assert.equal(formatDayMonth("2026-08-09"), "09 Agu");
  });

  test("isDateLike hanya mengenali bentuk tanggal", () => {
    assert.equal(isDateLike("2026-08-09"), true);
    assert.equal(isDateLike("09/08/2026"), true);
    assert.equal(isDateLike("07:35"), false, "kolom Time bukan tanggal");
    assert.equal(isDateLike("Rp 1.000"), false);
    assert.equal(isDateLike(2026), false);
  });
});
