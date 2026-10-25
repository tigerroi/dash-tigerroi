import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  completionUpdate,
  expenseFromReminder,
  isRepeating,
  leadDaysOf,
  nextDueDate,
  NO_REPEAT,
  PAYMENT_TYPE,
  REMINDER_LEAD_DAYS,
} from "./reminders.js";
import { dueReminders } from "./reminders.js";

describe("dueReminders", () => {
  const today = "2026-08-15";
  const rows = [
    { id: "overdue", dueDate: "2026-08-10", status: "Belum" },
    { id: "today", dueDate: "2026-08-15", status: "Belum" },
    { id: "lead-edge", dueDate: "2026-08-17", status: "Belum" }, // hari ini + 2 → masih tampil
    { id: "future", dueDate: "2026-08-18", status: "Belum" }, // hari ini + 3 → belum
    { id: "done", dueDate: "2026-08-10", status: "Selesai" },
    { id: "nodate", status: "Belum" },
  ];

  test("menyertakan yang terlambat, hari ini, dan dalam 2 hari ke depan", () => {
    const ids = dueReminders(rows, today).map((r) => r.id);
    assert.deepEqual(ids, ["overdue", "today", "lead-edge"]);
  });

  test("mengecualikan yang di luar lead, Selesai, dan tanpa tanggal", () => {
    const ids = dueReminders(rows, today).map((r) => r.id);
    assert.ok(!ids.includes("future"));
    assert.ok(!ids.includes("done"));
    assert.ok(!ids.includes("nodate"));
  });

  test("due 18 mulai tampil pada tanggal 16, bukan 15", () => {
    const row = [{ id: "r", dueDate: "2026-08-18", status: "Belum" }];
    assert.equal(dueReminders(row, "2026-08-15").length, 0);
    assert.equal(dueReminders(row, "2026-08-16").length, 1);
  });

  test("lead menyeberang pergantian bulan", () => {
    const row = [{ id: "r", dueDate: "2026-09-01", status: "Belum" }];
    assert.equal(dueReminders(row, "2026-08-30").length, 1); // 30 + 2 = 01 Sep
  });

  test("urut jatuh tempo paling awal dulu", () => {
    const sorted = dueReminders(
      [
        { id: "b", dueDate: "2026-08-14", status: "Belum" },
        { id: "a", dueDate: "2026-08-01", status: "Belum" },
      ],
      today,
    ).map((r) => r.id);
    assert.deepEqual(sorted, ["a", "b"]);
  });

  test("input bukan array tidak melempar", () => {
    assert.deepEqual(dueReminders(undefined, today), []);
  });
});

describe("pengingat berulang", () => {
  const today = "2026-08-25";

  test("yang tidak berulang tetap ditandai Selesai", () => {
    assert.deepEqual(completionUpdate({ dueDate: "2026-08-20" }, today), { status: "Selesai" });
    assert.deepEqual(completionUpdate({ dueDate: "2026-08-20", repeat: NO_REPEAT }, today), {
      status: "Selesai",
    });
    assert.equal(isRepeating({ repeat: NO_REPEAT }), false);
  });

  test("empat satuannya menggeser dari jatuh tempo, bukan dari hari ini", () => {
    // Jatuh tempo 20 Agu, ditandai 25 Agu (telat 5 hari). Yang bulanan harus jatuh 20 Sep —
    // dihitung dari hari penandaan, tanggalnya akan merayap maju tiap bulan.
    assert.equal(nextDueDate("2026-08-20", "Bulanan", 1, today), "2026-09-20");
    assert.equal(nextDueDate("2026-08-20", "Tahunan", 1, today), "2027-08-20");
    // Harian dan mingguan dari 20 Agu sudah lewat hari ini, jadi digeser berulang sampai melewatinya.
    assert.equal(nextDueDate("2026-08-20", "Harian", 1, today), "2026-08-26");
    assert.equal(nextDueDate("2026-08-20", "Mingguan", 1, today), "2026-08-27");
  });

  test("yang terlambat berbulan-bulan tidak berhenti di masa lalu", () => {
    // Digeser sekali saja, hasilnya 01 Feb — masih lewat, dan badge menyala lagi seketika. Itu
    // terbaca sebagai tombolnya tidak bekerja.
    assert.equal(nextDueDate("2026-01-01", "Bulanan", 1, today), "2026-09-01");
  });

  test("dibayar lebih awal tetap maju satu periode penuh", () => {
    assert.equal(nextDueDate("2026-09-01", "Bulanan", 1, today), "2026-10-01");
  });

  test("tanggal 31 dijepit ke akhir bulan, dan kembali ke 31 sesudahnya", () => {
    // JavaScript menggulirkan 31 Feb jadi 3 Mar diam-diam, dan tagihannya tidak pernah kembali
    // ke tanggal 31.
    assert.equal(nextDueDate("2026-01-31", "Bulanan", 1, "2026-01-31"), "2026-02-28");
    assert.equal(nextDueDate("2026-02-28", "Bulanan", 1, "2026-02-28"), "2026-03-28");
    // Tahun kabisat.
    assert.equal(nextDueDate("2028-01-31", "Bulanan", 1, "2028-01-31"), "2028-02-29");
  });

  test("kelipatan bebas: setiap 2 minggu, setiap 3 bulan", () => {
    assert.equal(nextDueDate("2026-09-01", "Mingguan", 2, today), "2026-09-15");
    assert.equal(nextDueDate("2026-09-01", "Bulanan", 3, today), "2026-12-01");
    // Kosong / 0 / sampah dibaca sebagai 1, bukan sebagai nol langkah — nol langkah adalah loop
    // yang tidak pernah melewati hari ini.
    assert.equal(nextDueDate("2026-09-01", "Bulanan", "", today), "2026-10-01");
    assert.equal(nextDueDate("2026-09-01", "Bulanan", 0, today), "2026-10-01");
  });

  test("baris berulang dimajukan, bukan diselesaikan", () => {
    const update = completionUpdate(
      { dueDate: "2026-08-20", repeat: "Bulanan", repeatEvery: 1 },
      today,
    );
    assert.deepEqual(update, {
      dueDate: "2026-09-20",
      status: "Belum",
      lastCompletedAt: "2026-08-25",
      // Kapan ditandai saja tidak bisa membedakan "tagihan Agustus dibayar telat" dari "tagihan
      // September dibayar awal".
      lastCompletedDueDate: "2026-08-20",
    });
  });

  test("baris yang sudah dimajukan tidak lagi jatuh tempo", () => {
    const row = { id: "sewa", dueDate: "2026-08-20", status: "Belum", repeat: "Bulanan" };
    assert.equal(dueReminders([row], today).length, 1);

    const next = { ...row, ...completionUpdate(row, today) };
    assert.equal(dueReminders([next], today).length, 0);
  });


  test("harian tidak menyala sehari sebelumnya — badge-nya akan permanen", () => {
    const harian = { id: "cek", dueDate: "2026-08-26", status: "Belum", repeat: "Harian" };
    // Besok, dan jendela antisipasi dua hari akan memasukkannya — baris yang baru saja ditandai
    // selesai langsung menyala lagi, dan itu terbaca sebagai tombol yang tidak bekerja.
    assert.equal(dueReminders([harian], "2026-08-25").length, 0);
    assert.equal(dueReminders([{ ...harian, dueDate: "2026-08-25" }], "2026-08-25").length, 1);
    assert.equal(leadDaysOf(harian), 0);
  });

  test("yang berulang lebih jarang dari jendelanya tidak berubah sama sekali", () => {
    assert.equal(leadDaysOf({ repeat: "Mingguan" }), REMINDER_LEAD_DAYS);
    assert.equal(leadDaysOf({ repeat: "Bulanan" }), REMINDER_LEAD_DAYS);
    assert.equal(leadDaysOf({ repeat: "Tahunan" }), REMINDER_LEAD_DAYS);
    assert.equal(leadDaysOf({}), REMINDER_LEAD_DAYS);
    // Harian tiap 3 hari kembali ke jendela penuh: antisipasinya berarti lagi.
    assert.equal(leadDaysOf({ repeat: "Harian", repeatEvery: 3 }), REMINDER_LEAD_DAYS);
    const mingguan = { id: "s", dueDate: "2026-08-27", status: "Belum", repeat: "Mingguan" };
    assert.equal(dueReminders([mingguan], "2026-08-25").length, 1);
  });

  test("satuan yang tidak dikenali dibaca sebagai tidak berulang", () => {
    // Baris lama tanpa field ini, dan nilai sampah dari impor. Jatuh tempo yang melompat ke tempat
    // yang tidak diminta siapa pun lebih buruk daripada pengingat yang diam.
    assert.equal(nextDueDate("2026-08-20", "setiap purnama", 1, today), "");
    assert.equal(nextDueDate("2026-08-20", undefined, 1, today), "");
    assert.deepEqual(completionUpdate({ dueDate: "2026-08-20" }, today), { status: "Selesai" });
  });

  test("tanggal yang rusak menghasilkan kosong, bukan tanggal karangan", () => {
    assert.equal(nextDueDate("", "Harian", 1, today), "");
    assert.equal(nextDueDate("bukan tanggal", "Bulanan", 1, today), "");
    // `shiftDateKey` mengembalikan "NaN-NaN-NaN" untuk masukan ini, dan teks itu lolos tiap
    // perbandingan tanggal (huruf "N" > angka mana pun) — tertulis ke `dueDate`, barisnya tidak
    // akan pernah jatuh tempo lagi dan tidak ada yang mengabarkan kenapa.
    assert.equal(nextDueDate("bukan tanggal", "Harian", 1, today), "");
    // Bentuknya benar tapi tanggalnya tidak ada di kalender; JavaScript menggulirkannya diam-diam.
    assert.equal(nextDueDate("2026-13-99", "Mingguan", 1, today), "");
    assert.equal(nextDueDate("2026-02-30", "Bulanan", 1, today), "");
    // Yang rusak tidak dimajukan sama sekali — ia diselesaikan seperti pengingat biasa.
    assert.deepEqual(completionUpdate({ dueDate: "2026-02-30", repeat: "Bulanan" }, today), {
      status: "Selesai",
    });
  });
});

describe("expenseFromReminder", () => {
  const today = "2026-08-20";
  const bill = {
    id: "-Nabc",
    type: PAYMENT_TYPE,
    title: "Sewa server",
    dueDate: "2026-08-01",
    nominal: 250000,
    note: "VPS Singapura",
  };

  test("baris Pembayaran bernominal jadi satu baris expense", () => {
    const expense = expenseFromReminder(bill, today);

    assert.equal(expense.values.itemName, "Sewa server");
    assert.equal(expense.values.qty, 1);
    assert.equal(expense.values.nominal, 250000);
    // Kolom turunan ikut ditulis, jadi baris ini tidak bergantung pada fallback nominal x qty.
    assert.equal(expense.values.total, 250000);
  });

  test("tanggalnya HARI PEMBAYARAN, bukan jatuh temponya", () => {
    // Tagihan 1 Agustus yang baru dibayar 20 Agustus adalah pengeluaran kas 20 Agustus. Periode
    // yang dipenuhinya tetap tersimpan mentah, supaya keduanya tidak tertukar.
    const expense = expenseFromReminder(bill, today);

    assert.equal(expense.values.date, "2026-08-20");
    assert.equal(expense.values.reminderDueDate, "2026-08-01");
    assert.match(expense.values.note, /jatuh tempo 2026-08-01/);
    assert.match(expense.values.note, /VPS Singapura/);
  });

  test("ID-nya turunan reminder + jatuh tempo, jadi klik ganda menimpa bukan menggandakan", () => {
    assert.equal(expenseFromReminder(bill, today).id, "-Nabc__2026-08-01");
    // Periode berikutnya dari reminder berulang yang sama adalah baris expense yang BERBEDA.
    assert.equal(
      expenseFromReminder({ ...bill, dueDate: "2026-09-01" }, today).id,
      "-Nabc__2026-09-01",
    );
  });

  test("tipe Umum tidak menghasilkan pengeluaran apa pun", () => {
    assert.equal(expenseFromReminder({ ...bill, type: "Umum" }, today), null);
  });

  test("nominal kosong atau nol bukan pengeluaran Rp 0", () => {
    // Baris expense nol akan terbaca di Laba Rugi sebagai pengeluaran yang benar-benar nol, bukan
    // sebagai nominal yang belum diisi.
    assert.equal(expenseFromReminder({ ...bill, nominal: "" }, today), null);
    assert.equal(expenseFromReminder({ ...bill, nominal: 0 }, today), null);
    assert.equal(expenseFromReminder({ ...bill, nominal: "bukan angka" }, today), null);
  });

  test("jatuh tempo yang bentuknya rusak tidak jadi ID", () => {
    // Kalau lolos, ID-nya "-Nabc__bukan tanggal" — satu alamat yang menampung SEMUA periode baris
    // itu, jadi pembayaran bulan berikutnya menimpa pembayaran bulan ini.
    assert.equal(expenseFromReminder({ ...bill, dueDate: "bukan tanggal" }, today), null);
    assert.equal(expenseFromReminder({ ...bill, dueDate: "2026-02-30" }, today), null);
    assert.equal(expenseFromReminder({ ...bill, id: "" }, today), null);
  });

  test("judul kosong tetap menghasilkan nama item yang terbaca", () => {
    const expense = expenseFromReminder({ ...bill, title: "   " }, today);
    assert.equal(expense.values.itemName, "Pembayaran pengingat");
  });
});
