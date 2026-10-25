import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  decodeRange,
  encodeRange,
  readParam,
  readRecord,
  recordPatch,
  writeParams,
} from "./urlState.js";

describe("readParam", () => {
  test("membaca nilai yang ada", () => {
    assert.equal(readParam("?q=masse", "q"), "masse");
  });

  test("parameter yang tidak ada jatuh ke bawaan halaman", () => {
    assert.equal(readParam("?q=masse", "status", "all"), "all");
  });

  test("nilai kosong yang ditulis eksplisit tetap kosong, bukan bawaan", () => {
    assert.equal(readParam("?status=", "status", "all"), "");
  });
});

describe("writeParams", () => {
  test("menambah tanpa membuang filter di sebelahnya", () => {
    assert.equal(writeParams("?status=enrolled", { q: "masse" }), "?status=enrolled&q=masse");
  });

  test("nilai kosong menghapus parameternya", () => {
    assert.equal(writeParams("?q=masse&status=enrolled", { q: "" }), "?status=enrolled");
  });

  test("query yang habis jadi string kosong, bukan tanda tanya menggantung", () => {
    assert.equal(writeParams("?q=masse", { q: "" }), "");
  });

  test("spasi dan karakter alamat tetap utuh sampai kembali", () => {
    const search = writeParams("", { q: "meta ads&roi" });
    assert.equal(readParam(search, "q"), "meta ads&roi");
  });
});

describe("encodeRange / decodeRange", () => {
  const fallback = { from: "2026-08-01", to: "2026-08-31" };

  test("rentang yang sama dengan bawaan tidak ditulis ke alamat", () => {
    assert.equal(encodeRange({ from: "2026-08-01", to: "2026-08-31" }, fallback), "");
  });

  test("rentang yang dipilih orang bolak-balik utuh", () => {
    const encoded = encodeRange({ from: "2026-07-01", to: "2026-07-31" }, fallback);
    assert.deepEqual(decodeRange(encoded, fallback), { from: "2026-07-01", to: "2026-07-31" });
  });

  test("dikosongkan orang ('semua tanggal') berbeda dari belum disentuh", () => {
    const encoded = encodeRange({ from: "", to: "" }, fallback);
    assert.notEqual(encoded, "");
    assert.deepEqual(decodeRange(encoded, fallback), { from: "", to: "" });
    assert.deepEqual(decodeRange("", fallback), fallback);
  });

  test("satu sisi saja tetap terbaca", () => {
    assert.deepEqual(decodeRange("2026-07-01..", fallback), { from: "2026-07-01", to: "" });
    assert.deepEqual(decodeRange("..2026-07-31", fallback), { from: "", to: "2026-07-31" });
  });
});

describe("readRecord / recordPatch", () => {
  const fields = ["status", "domain"];

  test("hanya field yang dikenal yang dibaca", () => {
    const values = readRecord("?f_status=Aktif&f_lain=x&q=masse", "f_", fields);
    assert.deepEqual(values, { status: "Aktif" });
  });

  test("field yang dikosongkan ikut dikirim supaya parameternya terhapus", () => {
    assert.deepEqual(recordPatch("f_", fields, { status: "Aktif" }), {
      f_status: "Aktif",
      f_domain: "",
    });
  });

  test("bolak-balik lewat query", () => {
    const search = writeParams("", recordPatch("f_", fields, { status: "Aktif", domain: "a.com" }));
    assert.deepEqual(readRecord(search, "f_", fields), { status: "Aktif", domain: "a.com" });
  });
});
