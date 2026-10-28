import assert from "node:assert/strict";
import test from "node:test";
import {
  dueLabel,
  dueReminders,
  formatDateKey,
  leadDaysOf,
  noticeUpdate,
  reminderMessage,
  reminderRows,
  remindersToSend,
} from "./reminders-core.js";
import { chatsFromUpdates } from "./telegram.mjs";

const TODAY = "2026-08-15";

const rows = [
  { id: "lewat", title: "Bayar hosting", dueDate: "2026-08-12" },
  { id: "hariIni", title: "Perpanjang domain", dueDate: TODAY, nominal: 1_200_000 },
  { id: "besok", title: "Invoice klien", dueDate: "2026-08-16" },
  { id: "h2", title: "Top-up saldo", dueDate: "2026-08-17" },
  { id: "jauh", title: "Audit tahunan", dueDate: "2026-08-30" },
  { id: "selesai", title: "Sudah dibayar", dueDate: "2026-08-10", status: "Selesai" },
];

test("yang dihapus tidak ikut dikirim", () => {
  // Hapus di dashboard cuma menandai `deletedAt`; barisnya tetap di RTDB. Sisi UI menyaringnya
  // sebelum dueReminders melihatnya, jadi saringan itu harus ada di reminderRows juga — kalau
  // tidak, badge topbar padam sementara Telegram mengirim baris yang sama tiap pagi.
  const node = {
    hidup: { title: "Bayar hosting", dueDate: TODAY },
    dihapus: { title: "asdasdasd", dueDate: TODAY, deletedAt: "2026-08-14T03:00:00.000Z" },
    tanpaDue: { title: "Belum dijadwalkan" },
  };
  assert.deepEqual(
    reminderRows(node).map((row) => row.id),
    ["hidup"],
  );
});

test("due: terlewat sampai H-2, yang selesai dan yang masih jauh dilewati", () => {
  assert.deepEqual(
    dueReminders(rows, TODAY).map((row) => row.id),
    ["lewat", "hariIni", "besok", "h2"],
  );
});

test("urutannya yang paling mendesak dulu", () => {
  const shuffled = [rows[3], rows[0], rows[2]];
  assert.deepEqual(
    dueReminders(shuffled, TODAY).map((row) => row.id),
    ["lewat", "besok", "h2"],
  );
});

test("yang sudah dikabarkan hari ini tidak dikirim dua kali", () => {
  const notices = { lewat: TODAY, besok: "2026-08-14" };
  assert.deepEqual(
    remindersToSend(rows, notices, TODAY).map((row) => row.id),
    // `besok` dikabarkan KEMARIN, jadi ia kembali hari ini — pengingat yang berbunyi sekali di
    // H-2 lalu diam pada hari H adalah pengingat yang gagal.
    ["hariIni", "besok", "h2"],
  );
});

test("penanda kiriman menyapu baris yang sudah selesai/dihapus", () => {
  const notices = { lewat: "2026-08-14", sudahDihapus: "2026-08-11", h2: TODAY };
  const update = noticeUpdate([rows[0], rows[1]], notices, TODAY);
  assert.equal(update.lewat, TODAY);
  assert.equal(update.hariIni, TODAY);
  // Tidak ada di kiriman hari ini dan penandanya lama → dibuang, supaya node ini tidak tumbuh
  // selamanya dan reminder tahunan tidak membawa penanda basi tahun depan.
  assert.equal(update.sudahDihapus, null);
  // Yang penandanya bertanggal hari ini dibiarkan: ia baru saja dikirim oleh run lain.
  assert.equal("h2" in update, false);
});

test("reminderRows memberi id dan membuang baris tanpa jatuh tempo", () => {
  const value = { a: { title: "Ada", dueDate: "2026-08-15" }, b: { title: "Tanpa tanggal" } };
  assert.deepEqual(reminderRows(value), [{ title: "Ada", dueDate: "2026-08-15", id: "a" }]);
  assert.deepEqual(reminderRows(null), []);
});

test("label jarak: terlewat, hari ini, besok, sisanya dihitung", () => {
  assert.equal(dueLabel("2026-08-12", TODAY), "terlewat 3 hari");
  assert.equal(dueLabel(TODAY, TODAY), "hari ini");
  assert.equal(dueLabel("2026-08-16", TODAY), "besok");
  assert.equal(dueLabel("2026-08-17", TODAY), "2 hari lagi");
  // Lintas bulan tetap benar — dihitung di tengah hari UTC, bukan dengan mengurangi tanggalnya.
  assert.equal(dueLabel("2026-09-01", "2026-08-30"), "2 hari lagi");
});

test("tanggal di pesan memakai format dashboard, bukan ISO", () => {
  assert.equal(formatDateKey("2026-08-09"), "09 Agu 2026");
  assert.equal(formatDateKey(""), "");
});

test("judul yang diketik orang tidak boleh merusak HTML pesan", () => {
  const text = reminderMessage(
    [{ id: "x", title: "Bayar <b>2x</b> & sisa", dueDate: TODAY }],
    TODAY,
  );
  assert.match(text, /Bayar &lt;b&gt;2x&lt;\/b&gt; &amp; sisa/);
  assert.match(text, /15 Agu 2026 \(hari ini\)/);
});

test("nominal dan tautan hanya muncul kalau ada", () => {
  const withAll = reminderMessage([rows[1]], TODAY, "https://app/reminders");
  assert.match(withAll, /Rp 1\.200\.000/);
  assert.match(withAll, /Tandai selesai: https:\/\/app\/reminders/);
  const bare = reminderMessage([rows[2]], TODAY);
  assert.equal(/Rp/.test(bare), false);
  assert.equal(/Tandai selesai/.test(bare), false);
});

test("chat dari getUpdates: pesan pribadi, grup, dan bot yang baru ditambahkan", () => {
  const updates = [
    { message: { chat: { id: 111, type: "private", first_name: "Muhajir", username: "muh" } } },
    { message: { chat: { id: 111, type: "private", first_name: "Muhajir", username: "muh" } } },
    { my_chat_member: { chat: { id: -100222, type: "supergroup", title: "RabbitROI" } } },
  ];
  // `username` ikut sejak tab "Calon Penerima" ada: nama profil Telegram boleh sama persis untuk
  // dua orang, `@username` tidak — dan yang harus memutuskan mengaktifkan sebuah baris butuh yang
  // kedua. Grup tidak pernah punya, jadi kosong di sana benar.
  assert.deepEqual(chatsFromUpdates(updates), [
    { id: "111", title: "Muhajir", type: "private", username: "muh" },
    { id: "-100222", title: "RabbitROI", type: "supergroup", username: "" },
  ]);
});

/**
 * Cerminan `leadDaysOf` di src/lib/reminders.js. Beda sedikit di antara keduanya, dan badge topbar
 * menyala untuk baris yang tidak pernah dikirim ke Telegram — atau sebaliknya, Telegram mengirim
 * pengingat harian tiap pagi untuk baris yang di dashboard sudah padam.
 */
test("jendela antisipasi dijepit ke jarak pengulangannya", () => {
  assert.equal(leadDaysOf({ repeat: "Harian" }), 0);
  assert.equal(leadDaysOf({ repeat: "Harian", repeatEvery: 3 }), 2);
  assert.equal(leadDaysOf({ repeat: "Mingguan" }), 2);
  assert.equal(leadDaysOf({ repeat: "Bulanan" }), 2);
  assert.equal(leadDaysOf({ repeat: "Tahunan" }), 2);
  // Baris lama tanpa field ini, dan nilai yang tidak dikenali.
  assert.equal(leadDaysOf({}), 2);
  assert.equal(leadDaysOf({ repeat: "setiap purnama" }), 2);
});

test("pengingat harian tidak dikirim sehari sebelum jatuh temponya", () => {
  const harian = { id: "cek", title: "Cek harian", dueDate: "2026-08-16", repeat: "Harian" };
  assert.deepEqual(dueReminders([harian], TODAY), []);
  assert.equal(dueReminders([{ ...harian, dueDate: TODAY }], TODAY).length, 1);

  // Yang mingguan tetap dikabarkan dua hari sebelumnya, seperti sebelum ada fitur berulang.
  const mingguan = { id: "setor", dueDate: "2026-08-17", repeat: "Mingguan" };
  assert.equal(dueReminders([mingguan], TODAY).length, 1);
});
