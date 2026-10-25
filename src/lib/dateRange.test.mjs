import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  currentMonthRange,
  dateKeyOf,
  daysInclusive,
  datePresets,
  filterByDateField,
  filterRunningDay,
  isRunningRow,
  matchDatePreset,
  monthKeyOf,
  monthKeysOf,
  monthLabelOf,
  monthRange,
  partialMonthsIn,
  rowsInRange,
  wholeMonthsIn,
  parseDateLike,
  shiftMonthKey,
} from "./dateRange.js";

describe("filterRunningDay", () => {
  test("baris tanpa tanggal tetap tampil", () => {
    // Menyaringnya keluar membuat data impor menghilang tanpa ada yang mengatakan kenapa.
    const rows = [
      { id: "today", date: "2026-08-07" },
      { id: "yesterday", date: "2026-08-06" },
      { id: "undated", campaign: "impor tangan" },
    ];
    assert.deepEqual(
      filterRunningDay(rows, new Date(2026, 7, 7)).map((item) => item.id),
      ["today", "undated"],
    );
  });

  test("bukan array", () => {
    assert.deepEqual(filterRunningDay(undefined, new Date(2026, 7, 7)), []);
  });
});

describe("parseDateLike", () => {
  test("bentuk tanggal yang dipakai dashboard ini", () => {
    assert.equal(parseDateLike("2026-08-07").getDate(), 7, "ISO dari sync");
    assert.equal(parseDateLike("07/08/2026").getMonth(), 7, "dd/mm/yyyy dari tabel");
    assert.equal(parseDateLike("2026-08-07 14:32").getDate(), 7, "stempel riwayat saldo");
    assert.equal(parseDateLike("bukan tanggal"), null);
    assert.equal(parseDateLike(""), null);
  });
});

test("hari berjalan dipilih lewat tandanya, bukan lewat jam browser", () => {
  // Klien yang zonanya bukan WIB punya "hari ini" yang berbeda dari hari operasi, dan baris final
  // tidak boleh ikut masuk karena tab dibiarkan terbuka melewati tengah malam.
  const rows = [
    { id: "berjalan", date: "2026-08-08", partial: true },
    { id: "selesai", date: "2026-08-07" },
    { id: "kemarin", date: "2026-08-06" },
  ];

  assert.deepEqual(
    filterRunningDay(rows, new Date(2026, 7, 20)).map((r) => r.id),
    ["berjalan"],
    "tanda partial menang atas tanggal klien",
  );
});
test("snapshot per sync: hanya hari partial TERBARU yang masuk \"Hari Ini\"", () => {
  // Baris ROI hari berjalan disimpan per sync dan bertahan beberapa hari (dashboard/roiSnapshots),
  // jadi baris `partial` dari kemarin dan lusa masih ada di daftar. "Semua yang partial" akan
  // menumpuk tiga hari snapshot ke dalam pilihan yang berbunyi "Hari Ini".
  const rows = [
    { id: "hari-ini-09", date: "2026-08-12", time: "09:01", partial: true },
    { id: "hari-ini-16", date: "2026-08-12", time: "16:01", partial: true },
    { id: "kemarin-15", date: "2026-08-11", time: "15:01", partial: true },
    { id: "lusa-final", date: "2026-08-10" },
    { id: "tanpa-tanggal", campaign: "impor tangan" },
  ];

  assert.deepEqual(
    filterRunningDay(rows, new Date(2026, 7, 12)).map((r) => r.id),
    ["hari-ini-09", "hari-ini-16", "tanpa-tanggal"],
    "seluruh sync hari itu, dan hanya hari itu",
  );

  // Hari operasinya tetap dibaca dari baris, bukan dari jam browser — klien di zona lain melihat
  // hari yang sama dengan dashboard-nya.
  assert.deepEqual(
    filterRunningDay(rows, new Date(2026, 7, 20)).map((r) => r.id),
    ["hari-ini-09", "hari-ini-16", "tanpa-tanggal"],
    "tanggal baris partial terbaru menang atas jam klien",
  );

  // Tabel tanpa baris partial sama sekali (isinya input tangan) kembali memakai jam browser.
  assert.deepEqual(
    filterRunningDay([{ id: "manual", date: "2026-08-12" }], new Date(2026, 7, 12)),
    [{ id: "manual", date: "2026-08-12" }],
  );
});

describe("filterByDateField", () => {
  const rows = [
    { id: "awal", date: "2026-08-01" },
    { id: "tengah", date: "2026-08-10" },
    { id: "akhir", date: "2026-08-31" },
    { id: "bulan-lalu", date: "2026-07-31" },
    { id: "impor-lama", date: "31/07/2026" },
    { id: "tanpa-tanggal", itemName: "kertas" },
  ];
  const ids = (range) => filterByDateField(rows, "date", range).map((item) => item.id);

  test("menyaring pada kedua batas, inklusif", () => {
    assert.deepEqual(ids({ from: "2026-08-01", to: "2026-08-31" }), [
      "awal",
      "tengah",
      "akhir",
      "tanpa-tanggal",
    ]);
  });

  test("batas kosong berarti tak berbatas", () => {
    assert.deepEqual(ids({ from: "2026-08-10", to: "" }), ["tengah", "akhir", "tanpa-tanggal"]);
    assert.deepEqual(ids({ to: "2026-07-31" }), ["bulan-lalu", "impor-lama", "tanpa-tanggal"]);
    // Mengosongkan keduanya adalah cara melihat seluruh riwayat lagi.
    assert.deepEqual(ids({}), rows.map((row) => row.id));
  });

  test("tanggal impor lama dibandingkan sebagai tanggal, bukan teks", () => {
    // "31/07/2026" diadu string dengan "2026-08-01" akan selalu kalah dan ikut terbawa.
    assert.ok(!ids({ from: "2026-08-01", to: "2026-08-31" }).includes("impor-lama"));
    assert.ok(ids({ from: "2026-07-01", to: "2026-07-31" }).includes("impor-lama"));
  });

  test("dari > sampai tidak menyisakan baris bertanggal", () => {
    assert.deepEqual(ids({ from: "2026-08-31", to: "2026-08-01" }), ["tanpa-tanggal"]);
  });
});

describe("datePresets", () => {
  // Rabu 12 Agu 2026 — pekannya Min 9 Agu s/d Sab 15 Agu.
  const now = new Date(2026, 7, 12, 10, 0, 0);
  const byId = Object.fromEntries(datePresets(now).map((p) => [p.id, p]));

  test("preset harian & jendela dihitung dari now", () => {
    assert.deepEqual(byId.today, { id: "today", label: "Hari Ini", from: "2026-08-12", to: "2026-08-12" });
    assert.deepEqual(byId.yesterday.from, "2026-08-11");
    assert.deepEqual(byId.yesterday.to, "2026-08-11");
    // 7 hari terakhir termasuk hari ini → 6 Agu s/d 12 Agu.
    assert.deepEqual(byId.last7, { id: "last7", label: "7 hari terakhir", from: "2026-08-06", to: "2026-08-12" });
    assert.deepEqual(byId.last30.from, "2026-07-14");
  });

  test("minggu (Min–Sab) & bulan", () => {
    assert.deepEqual(byId["this-week"], {
      id: "this-week",
      label: "Minggu ini",
      from: "2026-08-09",
      to: "2026-08-12",
    });
    assert.deepEqual(byId["last-week"], {
      id: "last-week",
      label: "Minggu lalu",
      from: "2026-08-02",
      to: "2026-08-08",
    });
    assert.deepEqual(byId["this-month"].from, "2026-08-01");
    assert.deepEqual(byId["last-month"], {
      id: "last-month",
      label: "Bulan lalu",
      from: "2026-07-01",
      to: "2026-07-31",
    });
  });

  test("matchDatePreset mengenali rentang & default kosong", () => {
    assert.equal(matchDatePreset("2026-08-12", "2026-08-12", now)?.id, "today");
    assert.equal(matchDatePreset("2026-08-06", "2026-08-12", now)?.id, "last7");
    // Kedua batas kosong = "Semua tanggal" (keadaan filter yang belum disentuh).
    assert.equal(matchDatePreset("", "", now)?.id, "all");
    // Rentang yang bukan preset apa pun → null (label jatuh ke tanggalnya sendiri).
    assert.equal(matchDatePreset("2026-08-03", "2026-08-19", now), null);
  });
});

test("currentMonthRange dari tanggal 1 sampai hari ini", () => {
  assert.deepEqual(currentMonthRange(new Date(2026, 7, 10)), {
    from: "2026-08-01",
    to: "2026-08-10",
  });
  // toDateKey lokal, bukan toISOString — di GMT+7 tengah malam itu menggeser tanggalnya mundur.
  assert.deepEqual(currentMonthRange(new Date(2026, 0, 1, 0, 30)), {
    from: "2026-01-01",
    to: "2026-01-01",
  });
});

describe("pemilih bulan grafik", () => {
  const now = new Date(2026, 7, 11); // 11 Agustus 2026

  test("bulan berjalan berhenti di hari ini, bulan lewat sampai akhir bulannya", () => {
    // Meminta grafik sampai tanggal yang belum terjadi hanya menambah ruang kosong di kanan, dan
    // garis yang jatuh ke nol di sana terbaca seperti kehilangan data.
    assert.deepEqual(monthRange("2026-08", now), { from: "2026-08-01", to: "2026-08-11" });
    assert.deepEqual(monthRange("2026-07", now), { from: "2026-07-01", to: "2026-07-31" });
    assert.deepEqual(monthRange("2026-02", now), { from: "2026-02-01", to: "2026-02-28" });
    assert.deepEqual(monthRange("2024-02", now), { from: "2024-02-01", to: "2024-02-29" }, "kabisat");
    // Bulan yang seluruhnya di masa depan tidak dipotong ke hari ini — itu akan membuat `to`
    // jatuh sebelum `from`, dan rentang terbalik menyaring habis seluruh baris.
    assert.deepEqual(monthRange("2026-09", now), { from: "2026-09-01", to: "2026-09-30" });
    assert.deepEqual(monthRange(""), { from: "", to: "" });
  });

  test("bulan diturunkan dari datanya, bukan dari daftar yang dikarang", () => {
    // Pilihan bulan yang menghasilkan grafik kosong adalah jebakan yang sama dengan pilihan
    // "Today" yang dulu selalu mengosongkan tabel ROI.
    const rows = [
      { date: "2026-08-03" },
      { date: "2026-07-28" },
      { date: "2026-07-01" },
      { date: "2026-05-19" },
      { periodDate: "2026-04-02" },
      { campaign: "tanpa tanggal" },
    ];
    assert.deepEqual(monthKeysOf(rows, now), [
      "2026-08",
      "2026-07",
      "2026-05",
      "2026-04",
    ], "terbaru dulu, tanpa Juni yang memang tidak punya data");

    // Bulan berjalan selalu ikut, supaya defaultnya tetap bisa dipilih kembali walau sync hari ini
    // belum menulis satu titik pun.
    assert.deepEqual(monthKeysOf([{ date: "2026-07-28" }], now), ["2026-08", "2026-07"]);
    assert.deepEqual(monthKeysOf([], now), ["2026-08"]);
    assert.deepEqual(monthKeysOf(undefined, now), ["2026-08"]);
  });

  test("dua pilihan teratas dinamai relatif, dan hanya kalau memang benar", () => {
    assert.equal(monthLabelOf("2026-08", "Agu 2026", now), "Bulan Ini (Agu 2026)");
    assert.equal(monthLabelOf("2026-07", "Jul 2026", now), "Bulan Lalu (Jul 2026)");
    // Kalau data bulan lalu tidak ada, pilihan kedua adalah bulan lain — menamainya "Bulan Lalu"
    // akan berbohong tentang bulan mana yang sedang dilihat.
    assert.equal(monthLabelOf("2026-05", "Mei 2026", now), "Mei 2026");
  });

  test("kunci bulan lokal, dan mundur menyeberang tahun", () => {
    assert.equal(monthKeyOf(new Date(2026, 7, 11)), "2026-08");
    assert.equal(shiftMonthKey("2026-01", -1), "2025-12");
    assert.equal(shiftMonthKey("2026-12", 1), "2027-01");
    assert.equal(shiftMonthKey("", -1), "");
  });
});

/**
 * Periode sebagai RENTANG — dipakai Laba Rugi dan Cash Flow, yang keduanya digerakkan
 * `DateRangePicker` yang sama dengan seluruh dashboard.
 */
describe("dateRange: periode sebagai rentang", () => {
  test("bulan yang tertutup PENUH oleh rentang, dan cuma itu", () => {
    assert.deepEqual(wholeMonthsIn({ from: "2026-07-01", to: "2026-08-31" }), [
      "2026-07",
      "2026-08",
    ]);
    // Sehari kurang di salah satu ujungnya sudah cukup: nominal bulanan tidak bisa dibelah.
    assert.deepEqual(wholeMonthsIn({ from: "2026-07-02", to: "2026-08-31" }), ["2026-08"]);
    assert.deepEqual(wholeMonthsIn({ from: "2026-07-01", to: "2026-08-30" }), ["2026-07"]);
    assert.deepEqual(wholeMonthsIn({ from: "2026-08-01", to: "2026-08-10" }), []);
    assert.deepEqual(wholeMonthsIn({ from: "", to: "" }), []);
  });

  test("bulan yang punya baris tapi tidak tertutup penuh disebutkan; yang kosong tidak", () => {
    const rows = [{ month: "2026-08" }, { month: "2026-07" }];
    const monthOf = (row) => row.month;

    assert.deepEqual(
      partialMonthsIn({ from: "2026-07-01", to: "2026-08-10" }, [{ rows, monthOf }]),
      ["2026-08"],
      "Juli utuh, Agustus terpotong",
    );
    // Bulan yang tidak punya barisnya sama sekali tidak disebut: peringatan yang menyala tiap hari
    // untuk keadaan yang normal berhenti dibaca dalam sepekan.
    assert.deepEqual(
      partialMonthsIn({ from: "2026-08-01", to: "2026-08-10" }, [{ rows: [], monthOf }]),
      [],
    );
    // Bulan di luar rentangnya bukan urusan layar ini.
    assert.deepEqual(
      partialMonthsIn({ from: "2026-09-01", to: "2026-09-10" }, [{ rows, monthOf }]),
      [],
    );
  });

  test("rowsInRange membuang baris yang tanggalnya tidak terbaca", () => {
    // Kebalikan dari `filterByDateField`, yang MELOLOSKAN-nya: di sana ia satu baris tabel yang
    // hilang dari pandangan, di sini ia uang yang ikut dijumlah ke periode ini DAN ke periode
    // pembandingnya sekaligus.
    const rows = [{ date: "2026-08-05" }, { date: "" }, { date: "2026-09-01" }];

    assert.deepEqual(rowsInRange(rows, { from: "2026-08-01", to: "2026-08-31" }), [
      { date: "2026-08-05" },
    ]);
    // Batas yang kosong berarti tak berbatas — tapi baris tanpa tanggal tetap dibuang.
    assert.equal(rowsInRange(rows, {}).length, 2);
  });

  test("dateKeyOf memotong, tidak mengurai — dan menolak yang bukan tanggal", () => {
    // "2026-08" telanjang diurai `new Date()` sebagai tengah malam UTC, yang di zona negatif mundur
    // ke Juli.
    assert.equal(dateKeyOf("2026-08-05T09:00:00Z"), "2026-08-05");
    assert.equal(dateKeyOf("2026-08"), "");
    assert.equal(dateKeyOf(""), "");
    assert.equal(dateKeyOf(null), "");
  });

  test("daysInclusive menghitung kedua ujungnya", () => {
    assert.equal(daysInclusive("2026-08-01", "2026-08-01"), 1);
    assert.equal(daysInclusive("2026-08-01", "2026-08-31"), 31);
    assert.equal(daysInclusive("2026-08-31", "2026-08-01"), 0, "terbalik = kosong");
  });
});

test("isRunningRow: tanda partial saja tidak cukup, tanggalnya harus hari berjalan", () => {
  const running = "2026-09-16";
  assert.equal(isRunningRow({ date: "2026-09-16", partial: true }, running), true);
  assert.equal(isRunningRow({ date: "2026-08-20", partial: true }, running), false);
  assert.equal(isRunningRow({ date: "2026-09-16" }, running), false);
  assert.equal(isRunningRow({ date: "2026-09-16", partial: true }, ""), false);
});
