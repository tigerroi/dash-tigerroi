import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createTable, getCoreRowModel } from "@tanstack/table-core";
import {
  EMPTY_SORT,
  headerRows,
  leafColumns,
  nextSort,
  normalizeColumns,
  sortRows,
} from "./dataTable.js";

function tableOf(columns, data = []) {
  const table = createTable({
    data,
    columns: normalizeColumns(columns),
    getCoreRowModel: getCoreRowModel(),
    state: {},
    onStateChange: () => {},
    renderFallbackValue: null,
  });
  table.setOptions((previous) => ({ ...previous, state: table.initialState }));
  return table;
}

describe("normalizeColumns", () => {
  test("bentuk lama [key, label] tetap dibaca, dan label kosong tidak bisa diurutkan", () => {
    const [name, action] = normalizeColumns([
      ["name", "Nama"],
      ["action", ""],
    ]);

    assert.equal(name.id, "name");
    assert.equal(name.header, "Nama");
    assert.equal(name.enableSorting, true);
    assert.equal(name.meta.renderKey, "name");
    assert.equal(action.enableSorting, false);
  });

  test("kunci bertitik dibaca sebagai SATU field, bukan path bersarang", () => {
    const [column] = normalizeColumns([["a.b", "AB"]]);
    assert.equal(column.accessorFn({ "a.b": 7, a: { b: 9 } }), 7);
  });

  test("definisi objek: kelompok tidak diurutkan, kolom tanpa nilai juga tidak", () => {
    const [group, display] = normalizeColumns([
      { header: "META", columns: [{ accessorKey: "spend", header: "Spend" }] },
      { id: "actions", header: "Aksi", cell: () => null },
    ]);

    assert.equal(group.enableSorting, false);
    assert.equal(group.columns[0].id, "spend");
    assert.equal(group.columns[0].enableSorting, true);
    assert.equal(display.enableSorting, false);
  });
});

describe("nextSort", () => {
  test("naik → turun → urutan asli", () => {
    let sort = EMPTY_SORT;
    sort = nextSort(sort, "roi");
    assert.deepEqual(sort, { key: "roi", direction: "asc" });
    sort = nextSort(sort, "roi");
    assert.deepEqual(sort, { key: "roi", direction: "desc" });
    sort = nextSort(sort, "roi");
    assert.deepEqual(sort, EMPTY_SORT);
    assert.deepEqual(nextSort({ key: "roi", direction: "desc" }, "date"), {
      key: "date",
      direction: "asc",
    });
  });
});

describe("sortRows", () => {
  const rows = [
    { id: "a", spend: 300, earning: 900 },
    { id: "b", spend: 100, earning: "" },
    { id: "c", spend: 200, earning: 200 },
  ];

  test("kolom accessorFn diurutkan dari nilai HITUNGANNYA", () => {
    const columns = normalizeColumns([
      { id: "profit", header: "Profit", accessorFn: (row) => row.earning - row.spend },
    ]);

    assert.deepEqual(
      sortRows(rows, { key: "profit", direction: "desc" }, columns).map((row) => row.id),
      ["a", "c", "b"],
    );
  });

  test("sel kosong tetap di bawah di KEDUA arah, lewat sortTableItems", () => {
    const columns = normalizeColumns([["earning", "Earning"]]);

    for (const direction of ["asc", "desc"]) {
      const sorted = sortRows(rows, { key: "earning", direction }, columns);
      assert.equal(sorted.at(-1).id, "b");
    }
  });

  test("meta.sortValue menang atas nilai yang digambar", () => {
    const columns = normalizeColumns([
      { accessorKey: "spend", header: "Spend", meta: { sortValue: (row) => -row.spend } },
    ]);

    assert.deepEqual(
      sortRows(rows, { key: "spend", direction: "asc" }, columns).map((row) => row.id),
      ["a", "c", "b"],
    );
  });

  test("tanpa urutan, baris dikembalikan apa adanya", () => {
    assert.equal(sortRows(rows, EMPTY_SORT, []), rows);
  });
});

describe("headerRows", () => {
  test("tanpa kelompok: satu baris kepala, tanpa rowSpan", () => {
    const rowsOfHeader = headerRows(
      tableOf([
        ["date", "Date"],
        ["pic", "PIC"],
      ]).getHeaderGroups(),
    );

    assert.equal(rowsOfHeader.length, 1);
    assert.deepEqual(
      rowsOfHeader[0].map((cell) => [cell.header.column.id, cell.rowSpan]),
      [
        ["date", 1],
        ["pic", 1],
      ],
    );
  });

  test("kolom tanpa kelompok MEMBENTANG dua baris dan tidak digambar ulang di bawah", () => {
    const table = tableOf([
      ["date", "Date"],
      {
        id: "meta",
        header: "META ADS",
        columns: [
          { accessorKey: "spend", header: "Spending" },
          { accessorKey: "adTax", header: "Ad Tax" },
        ],
      },
      ["subDomain", "Sub-Domain"],
    ]);
    const [top, bottom] = headerRows(table.getHeaderGroups());

    assert.deepEqual(
      top.map((cell) => [cell.header.column.id, cell.rowSpan, cell.header.isPlaceholder]),
      [
        ["date", 2, false],
        ["meta", 1, false],
        ["subDomain", 2, false],
      ],
    );
    assert.equal(top[1].header.colSpan, 2);
    assert.deepEqual(
      bottom.map((cell) => cell.header.column.id),
      ["spend", "adTax"],
    );
  });

  test("grup footer pertama adalah tingkat daun (baris Total)", () => {
    const table = tableOf([
      ["date", "Date"],
      { id: "meta", header: "META", columns: [{ accessorKey: "spend", header: "Spend" }] },
    ]);

    assert.deepEqual(
      table.getFooterGroups()[0].headers.map((header) => header.column.id),
      leafColumns(normalizeColumns([
        ["date", "Date"],
        { id: "meta", header: "META", columns: [{ accessorKey: "spend", header: "Spend" }] },
      ])).map((column) => column.id),
    );
  });
});
