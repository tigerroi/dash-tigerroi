import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ACTIVITY_MAX_BUFFER,
  activityEvent,
  appendBuffer,
  dropSent,
  nextBatch,
  readBuffer,
  sanitizeDetail,
  writeBuffer,
} from "./activityLog.js";

// localStorage tiruan: satu peta, plus mode "penuh" untuk menguji kuota yang habis.
function fakeStorage({ full = false } = {}) {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => {
      if (full) throw new Error("QuotaExceededError");
      map.set(key, value);
    },
    map,
  };
}

test("nilai field yang berbau rahasia diredaksi, namanya tetap terbaca", () => {
  const detail = sanitizeDetail({
    email: "orang@rabbit.id",
    password: "sangat-rahasia",
    apiKey: "abc123",
    refreshToken: "1//0g",
    secret: "JBSWY3DPEHPK3PXP",
  });

  assert.match(detail, /email=orang@rabbit\.id/);
  // Kejadiannya tercatat, isinya tidak — "password diubah" memang harus terbaca di log audit.
  assert.match(detail, /password=•••/);
  assert.match(detail, /apiKey=•••/);
  assert.match(detail, /refreshToken=•••/);
  assert.match(detail, /secret=•••/);
  assert.doesNotMatch(detail, /sangat-rahasia|abc123|JBSWY3DPEHPK3PXP/);
});

test("kategori yang tidak dikenal jatuh ke operation, bukan tersimpan apa adanya", () => {
  // Kategori bebas berarti penyaring di halaman diam-diam kehilangan baris: yang tidak cocok
  // dengan satu pun pilihan tidak akan pernah tampil di pilihan mana pun.
  assert.equal(activityEvent({ category: "ngawur", action: "x" }).category, "operation");
  assert.equal(activityEvent({ category: "auth", action: "login" }).category, "auth");
});

test("identitas disalin ke baris, bukan dirujuk", () => {
  const event = activityEvent({
    category: "auth",
    action: "login",
    actor: { uid: "u1", email: "a@b.c", role: "admin" },
  });

  assert.equal(event.actorUid, "u1");
  assert.equal(event.actorEmail, "a@b.c");
  // Role yang berlaku SAAT itu — dirujuk lewat uid, baris lama ikut berubah tiap kali dropdown
  // Role di halaman Team diubah.
  assert.equal(event.actorRole, "admin");
});

test("status selain failed selalu ok", () => {
  assert.equal(activityEvent({ action: "x", status: "failed" }).status, "failed");
  assert.equal(activityEvent({ action: "x", status: "aneh" }).status, "ok");
});

test("tiap baris punya id sendiri", () => {
  const a = activityEvent({ action: "x" });
  const b = activityEvent({ action: "x" });
  assert.notEqual(a.id, b.id);
});

test("penyangga membuang yang TERTUA saat penuh", () => {
  const storage = fakeStorage();
  const rows = Array.from({ length: ACTIVITY_MAX_BUFFER + 10 }, (_, i) =>
    activityEvent({ action: `klik-${i}` }),
  );
  writeBuffer(storage, rows);

  const kept = readBuffer(storage);
  assert.equal(kept.length, ACTIVITY_MAX_BUFFER);
  // Yang tersisa adalah yang paling baru: perangkat yang lama offline tidak boleh berhenti
  // mencatat justru pada jam-jam yang paling ingin dibaca sesudahnya.
  assert.equal(kept.at(-1).action, `klik-${ACTIVITY_MAX_BUFFER + 9}`);
});

test("localStorage yang menolak menulis tidak melempar", () => {
  // Mode privat sebagian browser menolak setItem. Mencatat aktivitas tidak boleh jadi alasan
  // sebuah tombol berhenti bekerja.
  const storage = fakeStorage({ full: true });
  assert.equal(writeBuffer(storage, [activityEvent({ action: "x" })]), false);
  assert.doesNotThrow(() => appendBuffer(storage, activityEvent({ action: "x" })));
  assert.deepEqual(readBuffer(storage), []);
});

test("isi yang rusak dibaca sebagai penyangga kosong", () => {
  const storage = fakeStorage();
  storage.map.set("rabbitroi.activityLog.v1", "{bukan json");
  assert.deepEqual(readBuffer(storage), []);
});

test("yang terkirim dibuang lewat ID, bukan lewat jumlahnya", () => {
  const storage = fakeStorage();
  const first = activityEvent({ action: "satu" });
  const second = activityEvent({ action: "dua" });
  writeBuffer(storage, [first, second]);

  const batch = nextBatch(storage, 1);
  assert.deepEqual(
    batch.map((row) => row.action),
    ["satu"],
  );

  // Sela antara kiriman berangkat dan jawabannya datang diisi klik baru. Memotong dari depan
  // sejumlah yang terkirim akan membuang "dua" — baris yang belum pernah dikirim ke mana pun.
  appendBuffer(storage, activityEvent({ action: "tiga" }));
  const rest = dropSent(
    storage,
    batch.map((row) => row.id),
  );
  assert.deepEqual(
    rest.map((row) => row.action),
    ["dua", "tiga"],
  );
});
