import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CAUSE_ORDER, ISSUE_CAUSES, issueCause } from "./syncIssueCause.js";

/**
 * CERMINAN, dan tes yang paling menentukan di berkas ini.
 *
 * Aturan penggolongan ditulis dua kali — di functions/notifications-core.js (yang mengirim pesan
 * Telegram) dan di src/lib/syncIssueCause.js (yang menulis panel isu sync di topbar). Beda sedikit,
 * dan untuk isu yang SAMA layar menyebut "gangguan sementara, dicoba ulang otomatis" sementara chat
 * menyebut "perlu login ulang" — yang dipercaya orang adalah yang lebih menenangkan, dan akun yang
 * izinnya mati dibiarkan mati berhari-hari.
 *
 * Yang dibandingkan adalah TEKS bloknya, bukan hasil beberapa contoh: satu pola baru yang ditambah
 * di satu sisi tidak akan tertangkap oleh contoh yang ditulis sebelum pola itu ada.
 */
const mirror = (path) =>
  readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r/g, "");

// Blok diambil dari kepala deklarasinya sampai penutup di kolom 0. `indexOf` atas potongan tanpa
// `export` sengaja: yang di functions tidak mengekspor CAUSE_ORDER dan CAUSE_RULES, yang di sini
// mengekspor salah satunya — dan awalan itu bukan bagian dari aturannya.
function block(source, head, close) {
  const start = source.indexOf(head);
  assert.notEqual(start, -1, `blok tidak ditemukan: ${head}`);
  const end = source.indexOf(`\n${close}`, start);
  assert.notEqual(end, -1, `penutup tidak ditemukan untuk: ${head}`);
  return source.slice(start + head.length, end);
}

test("aturan golongan sama persis dengan yang di functions/notifications-core.js", () => {
  const here = mirror("./syncIssueCause.js");
  const there = mirror("../../functions/notifications-core.js");

  for (const [head, close] of [
    ["const ISSUE_CAUSES = {", "};"],
    ["const CAUSE_RULES = [", "];"],
    ["function statusOf(text) {", "}"],
    ["function issueCause(message) {", "}"],
  ]) {
    assert.equal(block(here, head, close), block(there, head, close), head);
  }

  const order = (source) => /const CAUSE_ORDER = (\[[^\]]*\])/.exec(source)?.[1];
  assert.equal(order(here), order(there));
  assert.ok(order(here), "CAUSE_ORDER tidak ditemukan");
});

// Tiap golongan harus punya kalimatnya sendiri: urutan yang menyebut kunci yang tidak ada berarti
// satu kelompok isu tidak pernah tergambar sama sekali di panel.
test("tiap golongan di urutan punya judul dan keterangannya", () => {
  for (const key of CAUSE_ORDER) {
    assert.ok(ISSUE_CAUSES[key], key);
    assert.ok(ISSUE_CAUSES[key].heading, key);
    assert.ok(ISSUE_CAUSES[key].note, key);
  }
  assert.deepEqual([...CAUSE_ORDER].sort(), Object.keys(ISSUE_CAUSES).sort());
});

// Dua pesan yang benar-benar berdiri di panel hari ini (28 Agu 2026). Keduanya 5xx, dan keduanya
// sebelumnya tampil sebagai URL API mentah.
test("500/503 dari GAM digolongkan sebagai gangguan penyedia", () => {
  const runs = issueCause(
    "GAM GET /networks/23352267851/operations/reports/runs/10661827362 -> 500: An internal error occurred. Please try again later.",
  );
  assert.equal(runs.key, "provider");
  assert.match(runs.say, /gangguan di sisi mereka/i);

  assert.equal(
    issueCause("GAM POST /networks/23352267851/reports/8298846231:run -> 503: An error has occurred.").key,
    "provider",
  );
});

// Yang tidak dikenali TIDAK ditebak jadi "sisi mereka": orang akan menunggu sesuatu yang tidak
// akan pernah pulih sendiri. `say` kosong, dan di panel pesan aslinya yang berdiri sendirian.
test("pesan yang tidak dikenali jadi golongan yang belum bisa dipastikan, tanpa kalimat karangan", () => {
  const cause = issueCause("Sesuatu yang aneh terjadi di baris 12");
  assert.equal(cause.key, "unknown");
  assert.equal(cause.say, "");
});

test("izin yang bermasalah tidak ikut golongan yang menunggu", () => {
  assert.equal(issueCause("GAM POST /v1/networks/2094/reports:run -> 401: Invalid Credentials").key, "action");
  assert.equal(issueCause("Meta #190 invalid_grant").key, "action");
});
