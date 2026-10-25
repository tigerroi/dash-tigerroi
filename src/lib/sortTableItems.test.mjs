import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { sortTableItems } from "./sortTableItems.js";

describe("sortTableItems", () => {
  const rows = [
    { id: "a", name: "Budi", balance: "Rp 1.200.000", roi: "12.5%", date: "2026-05-03" },
    { id: "b", name: "Andi", balance: "Rp 950.000", roi: "-3.5%", date: "2026-05-01" },
    { id: "c", name: "Citra", balance: "Rp 2.500.000", roi: "8.0%", date: "2026-05-02" },
  ];

  test("sorts text ascending and descending", () => {
    assert.deepEqual(
      sortTableItems(rows, { key: "name", direction: "asc" }).map((item) => item.name),
      ["Andi", "Budi", "Citra"],
    );
    assert.deepEqual(
      sortTableItems(rows, { key: "name", direction: "desc" }).map((item) => item.name),
      ["Citra", "Budi", "Andi"],
    );
  });

  test("sorts currency and percentage as numbers", () => {
    assert.deepEqual(
      sortTableItems(rows, { key: "balance", direction: "asc" }).map((item) => item.id),
      ["b", "a", "c"],
    );
    assert.deepEqual(
      sortTableItems(rows, { key: "roi", direction: "asc" }).map((item) => item.id),
      ["b", "c", "a"],
    );
  });

  test("sorts date-like values chronologically", () => {
    assert.deepEqual(
      sortTableItems(rows, { key: "date", direction: "asc" }).map((item) => item.id),
      ["b", "c", "a"],
    );
  });

  test("sorts local date values chronologically", () => {
    const localDateRows = [
      { id: "a", date: "14/05/2026" },
      { id: "b", date: "03/05/2026" },
      { id: "c", date: "15/05/2026" },
    ];

    assert.deepEqual(
      sortTableItems(localDateRows, { key: "date", direction: "asc" }).map((item) => item.id),
      ["b", "a", "c"],
    );
  });

  // Kosong bukan nilai terkecil maupun terbesar: ia bukan peserta pengurutan. Tanpa tes ini,
  // "kosong terakhir" ikut dibalik `desc` dan seluruh baris tanpa nilai naik ke paling atas —
  // yang di kolom ROI per Negara (tiga per empat barisnya "" sejak lantai `MIN_ROI_SPEND`)
  // terbaca sebagai pengurutan yang tidak bekerja.
  test("keeps empty values last in BOTH directions", () => {
    const sparse = [
      { id: "a", roi: 120 },
      { id: "b", roi: "" },
      { id: "c", roi: -30 },
      { id: "d", roi: null },
      { id: "e", roi: 5 },
      { id: "f", roi: "-" },
    ];

    assert.deepEqual(
      sortTableItems(sparse, { key: "roi", direction: "desc" }).map((item) => item.id),
      ["a", "e", "c", "b", "d", "f"],
    );
    assert.deepEqual(
      sortTableItems(sparse, { key: "roi", direction: "asc" }).map((item) => item.id),
      ["c", "e", "a", "b", "d", "f"],
    );
  });

  // Yang kosong tidak saling diurutkan: urutan asalnya dipertahankan, sama seperti nilai seri.
  test("keeps original order among empty values", () => {
    const blanks = [
      { id: "a", roi: "" },
      { id: "b", roi: 10 },
      { id: "c", roi: null },
    ];

    assert.deepEqual(
      sortTableItems(blanks, { key: "roi", direction: "desc" }).map((item) => item.id),
      ["b", "a", "c"],
    );
  });

  test("returns original order when sort is empty", () => {
    assert.deepEqual(
      sortTableItems(rows, { key: "", direction: "" }).map((item) => item.id),
      ["a", "b", "c"],
    );
  });
});
