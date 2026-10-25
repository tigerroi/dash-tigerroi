import assert from "node:assert/strict";
import test from "node:test";
import {
  campaignCommandEntry,
  campaignToggleState,
  toCommandMap,
} from "./campaignCommands.js";

const row = { campaignId: "120210", campaign: "nPJL-06 Pros Turki", adAccount: "act_1" };

test("campaignCommandEntry: bentuk perintah yang ditulis dashboard", () => {
  const now = new Date("2026-08-12T03:04:05.000Z");
  assert.deepEqual(campaignCommandEntry(row, "PAUSED", "dev@rabbitracing.live", now), {
    campaignId: "120210",
    campaign: "nPJL-06 Pros Turki",
    adAccount: "act_1",
    desiredStatus: "PAUSED",
    state: "pending",
    requestedAt: "2026-08-12T03:04:05.000Z",
    requestedBy: "dev@rabbitracing.live",
    error: null,
  });
});

test("campaignCommandEntry: menolak status di luar ACTIVE/PAUSED", () => {
  assert.throws(() => campaignCommandEntry(row, "ARCHIVED", "a"), /tidak dikenal/);
});

test("campaignCommandEntry: menolak baris tanpa ID Meta", () => {
  assert.throws(() => campaignCommandEntry({ campaign: "x" }, "PAUSED", "a"), /ID Meta/);
});

test("toCommandMap: node kosong RTDB jadi objek kosong", () => {
  assert.deepEqual(toCommandMap(null), {});
  assert.deepEqual(toCommandMap(undefined), {});
  assert.deepEqual(toCommandMap({ 120210: { state: "pending" } }), {
    120210: { state: "pending" },
  });
});

test("posisi saklar dibaca dari configuredStatus, bukan label effective status", () => {
  // Campaign yang sedang direview: labelnya "Review", tapi saklarnya memang menyala. Kalau tombol
  // membaca label, orang akan menekannya untuk menyalakan sesuatu yang sudah menyala.
  const state = campaignToggleState(
    { ...row, status: "Review", configuredStatus: "ACTIVE" },
    undefined,
    { canToggle: true },
  );
  assert.equal(state.on, true);
  assert.equal(state.disabled, false);
});

test("status yang belum terbaca bukan 'mati' — tombolnya dinonaktifkan dengan alasannya", () => {
  const state = campaignToggleState({ ...row, status: "Aktif" }, undefined, { canToggle: true });
  assert.equal(state.known, false);
  assert.equal(state.disabled, true);
  assert.match(state.reason, /belum terbaca/);
});

test("baris tanpa ID Meta tidak bisa ditoggle sama sekali", () => {
  const state = campaignToggleState({ campaign: "Lama", configuredStatus: "ACTIVE" }, undefined, {
    canToggle: true,
  });
  assert.equal(state.disabled, true);
  assert.match(state.reason, /belum punya ID Meta/);
});

test("perintah yang menunggu menahan tombol di arah yang diminta", () => {
  // Menampilkan keadaan lama akan membuat tombol melompat balik sesaat setelah ditekan.
  const state = campaignToggleState(
    { ...row, configuredStatus: "ACTIVE" },
    { state: "pending", desiredStatus: "PAUSED" },
    { canToggle: true },
  );
  assert.equal(state.on, false);
  assert.equal(state.pending, true);
  assert.equal(state.disabled, true);
  assert.match(state.reason, /dimatikan/);
});

test("perintah gagal membiarkan tombol bisa ditekan lagi, dengan pesannya", () => {
  const state = campaignToggleState(
    { ...row, configuredStatus: "ACTIVE" },
    { state: "failed", desiredStatus: "PAUSED", error: "Token Meta kadaluarsa" },
    { canToggle: true },
  );
  assert.equal(state.disabled, false);
  assert.equal(state.failed, true);
  assert.equal(state.reason, "Token Meta kadaluarsa");
});

test("tanpa izin, tombol mati tapi posisinya tetap benar", () => {
  const state = campaignToggleState({ ...row, configuredStatus: "ACTIVE" }, undefined, {
    canToggle: false,
  });
  assert.equal(state.on, true);
  assert.equal(state.disabled, true);
  assert.match(state.reason, /admin atau pemilik/);
});

test("campaign yang sudah tidak ada di Meta tidak menyuruh menunggu sync", () => {
  const state = campaignToggleState(
    { ...row, configuredStatus: "", metaMissing: true },
    undefined,
    { canToggle: true },
  );
  assert.equal(state.on, false);
  assert.equal(state.disabled, true);
  // Bukan "tunggu sync campaign berikutnya": sync berikutnya tidak akan membawa apa-apa untuk
  // campaign yang sudah diarsipkan, dan menyuruh menunggu adalah menyuruh menunggu selamanya.
  assert.match(state.reason, /tidak ada di Meta/);
  assert.doesNotMatch(state.reason, /tunggu sync/);
});
