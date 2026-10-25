import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  greetingMessage,
  inboxChatKey,
  inboxEntry,
  inboxSeenUpdate,
  nextOffset,
  registeredChatIds,
} from "./telegram-inbox-core.js";

/**
 * CERMINAN, dan tes yang paling menentukan di berkas ini.
 *
 * `inboxChatKey` ditulis dua kali — di sini (yang MENCATAT chat) dan di src/lib/telegramInbox.js
 * (yang membacanya dan menulis tombol Abaikan). Beda sedikit, tombol Abaikan menulis ke kunci yang
 * tidak dibaca pencatat mana pun: chat yang sama ditawarkan lagi tiap kali orangnya menyapa bot,
 * dan tidak ada satu pun pesan error yang menjelaskan kenapa.
 */
test("kunci chat sama persis dengan yang di src/lib/telegramInbox.js", () => {
  // `\r` dibuang dulu: repo ini dikerjakan di Windows, dan checkout ber-CRLF membuat pencocokan
  // sumber gagal untuk berkas yang isinya identik — tes cerminan yang menyala karena akhir baris
  // adalah tes yang akan dimatikan orang, dan yang ikut mati adalah penjagaan yang sebenarnya.
  const source = readFileSync(new URL("../src/lib/telegramInbox.js", import.meta.url), "utf8")
    .replace(/\r/g, "");
  const body = source.match(/export function inboxChatKey\(chatId\) \{\n([\s\S]*?)\n\}/)?.[1];

  assert.ok(body, "inboxChatKey tidak ditemukan di src/lib/telegramInbox.js");
  assert.equal(body.trim(), 'return `c${chatIdOf(chatId).replace("-", "n")}`;');
});

test("kunci berawalan huruf, minus jadi n", () => {
  // Kunci berupa angka membuat RTDB mengembalikan node ini sebagai array berlubang — alasan yang
  // sama dengan `c57` di antrean gating.
  assert.equal(inboxChatKey("1847784116"), "c1847784116");
  assert.equal(inboxChatKey("-1002223334445"), "cn1002223334445");
  assert.match(inboxChatKey("-1002223334445"), /^cn?[0-9]{1,20}$/);
});

test("chat yang sudah jadi penerima dikenali dari KEDUA sumber, termasuk yang diarsipkan", () => {
  const ids = registeredChatIds({
    users: [{ telegramChatId: "111" }, { telegramChatId: "" }],
    // Diarsipkan tetap dihitung terdaftar: mengeluarkan penerima adalah tindakan sengaja, dan
    // daftar tawaran tidak boleh menawarkannya kembali tiap kali orangnya menyapa bot lagi.
    groups: [{ chatId: "-222" }, { chatId: "333", deletedAt: "2026-08-01T00:00:00.000Z" }],
  });

  assert.deepEqual([...ids].sort(), ["-222", "111", "333"]);
});

test("baris baru membawa identitas chat, dan TIDAK isi pesannya", () => {
  const entry = inboxEntry({ id: "111", type: "private", title: "Putra", username: "putra" }, "T0");

  assert.deepEqual(entry, {
    chatId: "111",
    type: "private",
    title: "Putra",
    username: "putra",
    firstSeenAt: "T0",
    lastSeenAt: "T0",
  });
});

test("sapaan berikutnya tidak menyentuh firstSeenAt maupun dismissedAt", () => {
  // Inilah yang membuat tombol Abaikan berarti sesuatu: kalau `inboxSeenUpdate` membawa salah satu
  // dari keduanya, chat yang sudah diabaikan admin kembali ke daftar begitu ia mengirim pesan lagi.
  const update = inboxSeenUpdate({ id: "111", type: "private", title: "Putra S" }, "T1");

  assert.deepEqual(Object.keys(update).sort(), ["lastSeenAt", "title", "type", "username"]);
  assert.equal(update.title, "Putra S");
});

test("offset maju ke update_id tertinggi + 1, dan tidak pernah mundur", () => {
  assert.equal(nextOffset([{ update_id: 7 }, { update_id: 9 }, { update_id: 8 }]), 10);
  // Batch kosong tidak boleh mengembalikan 0: itu berarti membaca ulang seluruh antrean 24 jam,
  // dan menyapa lagi semua orang yang sudah tercatat.
  assert.equal(nextOffset([], 42), 42);
  assert.equal(nextOffset([{ update_id: 3 }], 42), 42);
});

test("bunyi sapaan berbeda untuk chat yang sudah jadi penerima", () => {
  const chat = { title: "Putra" };

  assert.match(greetingMessage(chat), /menunggu diaktifkan admin/);
  assert.match(greetingMessage(chat, { registered: true }), /sudah terdaftar/);
  assert.doesNotMatch(greetingMessage(chat, { registered: true }), /menunggu diaktifkan/);
});

test("nama profil di-escape sebelum masuk pesan HTML", () => {
  // Nama Telegram diketik orang. Satu `<` di dalamnya membuat Telegram menolak SELURUH pesan
  // dengan 400 — dan yang gagal bukan sapaan itu saja, melainkan kesan bahwa botnya bekerja.
  assert.match(greetingMessage({ title: "<script>" }), /&lt;script&gt;/);
});
