import assert from "node:assert/strict";
import test from "node:test";
import {
  detectedContactEntry,
  dismissUpdate,
  inboxChatKey,
  inboxRows,
  pendingChats,
  registeredChatIds,
} from "./telegramInbox.js";

const inbox = {
  c111: { chatId: "111", title: "Putra", username: "putra", lastSeenAt: "2026-08-27T02:00:00Z" },
  c222: { chatId: "222", title: "Godek", lastSeenAt: "2026-08-27T05:00:00Z" },
  cn100333: { chatId: "-100333", title: "Grup Ops", lastSeenAt: "2026-08-27T01:00:00Z" },
};

test("kunci berawalan huruf, minus jadi n", () => {
  assert.equal(inboxChatKey("1847784116"), "c1847784116");
  assert.equal(inboxChatKey("-1002223334445"), "cn1002223334445");
});

test("kunci RTDB ikut terbawa — itulah alamat yang ditulis tombol Abaikan", () => {
  assert.deepEqual(
    inboxRows(inbox).map((row) => row.key),
    ["c111", "c222", "cn100333"],
  );
});

test('yang sudah jadi penerima hilang dari daftar tawaran, dari KEDUA sumber', () => {
  const rows = pendingChats(inbox, {
    users: [{ telegramChatId: "111" }],
    groups: [{ chatId: "-100333" }],
  });

  assert.deepEqual(
    rows.map((row) => row.chatId),
    ["222"],
  );
});

test("penerima yang DIARSIPKAN tidak kembali sebagai tawaran", () => {
  // Mengeluarkan penerima adalah tindakan sengaja. Menghitungnya "belum terdaftar" berarti daftar
  // ini menawarkan kembali orang yang baru saja dikeluarkan, tiap kali ia menyapa botnya lagi.
  const rows = pendingChats(inbox, {
    users: [],
    groups: [{ chatId: "222", deletedAt: "2026-08-20T00:00:00Z" }],
  });

  assert.equal(
    rows.some((row) => row.chatId === "222"),
    false,
  );
});

test("yang sudah diabaikan tidak ditawarkan lagi", () => {
  const dismissed = { ...inbox, c222: { ...inbox.c222, dismissedAt: "2026-08-27T06:00:00Z" } };

  assert.deepEqual(
    pendingChats(dismissed, {}).map((row) => row.chatId),
    ["111", "-100333"],
  );
});

test("terbaru di atas — yang baru menekan Start adalah yang sedang ditunggu seseorang", () => {
  assert.deepEqual(
    pendingChats(inbox, {}).map((row) => row.chatId),
    ["222", "111", "-100333"],
  );
});

test("aktivasi menghasilkan baris notificationGroups penuh: ketiga topik, lingkup penuh", () => {
  const entry = detectedContactEntry({ chatId: "111", title: "Putra", username: "putra" });

  assert.equal(entry.label, "Putra");
  assert.equal(entry.chatId, "111");
  assert.equal(entry.enabled, true);
  // Kosong = seluruh armada, dan itulah kenapa aktivasi tetap satu tindakan sengaja.
  assert.equal(entry.pic, "");
  assert.deepEqual(entry.topics, { reminders: true, roiAlerts: true, syncIssues: true });
});

test("chat tanpa nama tetap punya label — chat id-nya sendiri", () => {
  // `groupComplaint` menolak label kosong, jadi baris tanpa nama profil harus tetap membawa
  // sesuatu: tombol Aktifkan yang menghasilkan baris yang ditolak database bukan tombol.
  assert.equal(detectedContactEntry({ chatId: "-100333" }).label, "-100333");
  assert.equal(detectedContactEntry({ chatId: "111", username: "putra" }).label, "putra");
});

test("abaikan mencatat siapa dan kapan, dan tidak menyentuh apa pun selain itu", () => {
  assert.deepEqual(Object.keys(dismissUpdate("aca@rabbit.id", "T9")).sort(), [
    "dismissedAt",
    "dismissedBy",
  ]);
});

test("registeredChatIds melewati chat id kosong", () => {
  const ids = registeredChatIds({ users: [{ telegramChatId: "" }, {}], groups: [{ chatId: "9" }] });
  assert.deepEqual([...ids], ["9"]);
});
