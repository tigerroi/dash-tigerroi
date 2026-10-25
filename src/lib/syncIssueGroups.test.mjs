import assert from "node:assert/strict";
import test from "node:test";
import { collapseIssues, splitCredentialIssues } from "./syncIssueGroups.js";

const issue = (over) => ({
  key: Math.random().toString(36).slice(2),
  source: "Sync akun GAM",
  target: "Network A",
  message: "GAM POST /v1/networks/2094/reports:run -> 401: Invalid Credentials",
  cause: "action",
  say: "Akses kita ditolak — kemungkinan besar perlu Login ulang di halaman akunnya.",
  impact: "Kolom earning di halaman GAM untuk akun ini tidak diperbarui.",
  credential: "petcins",
  ...over,
});

/**
 * Kegagalan yang melahirkan modul ini: kredensial petcins kehilangan akses, dan panel menggambar
 * sembilan kartu yang bunyinya sama persis untuk satu tombol Login yang sama.
 */
test("akun-akun satu kredensial dengan kalimat yang sama jadi SATU kartu", () => {
  const collapsed = collapseIssues([
    issue({}),
    issue({ target: "Network B", message: "GAM POST /v1/networks/3011/reports:run -> 401: Invalid Credentials" }),
    issue({ target: "Network C" }),
  ]);

  assert.equal(collapsed.length, 1);
  assert.equal(collapsed[0].count, 3, "hitungannya tetap menyebut akun, bukan kartu");
  assert.equal(collapsed[0].title, "petcins", "judulnya pindah ke kredensialnya");
  assert.deepEqual(collapsed[0].targets, ["Network A", "Network B", "Network C"]);
  assert.equal(collapsed[0].messages.length, 2, "pesan yang sama persis tidak ditulis dua kali");
});

test("satu akun tetap memakai nama akunnya, bukan nama kredensialnya", () => {
  const [only] = collapseIssues([issue({})]);
  assert.equal(only.title, "Network A");
  assert.equal(only.count, 1);
});

// Menggabungkan dua kegagalan berbeda berarti menyembunyikan salah satunya.
test("kegagalan berbeda pada kredensial yang sama tidak digabung", () => {
  const collapsed = collapseIssues([
    issue({}),
    issue({
      target: "Network B",
      cause: "provider",
      say: "Servernya membalas error — gangguan di sisi mereka.",
      message: "GAM -> 503: An error has occurred.",
    }),
  ]);
  assert.equal(collapsed.length, 2);
});

test("dua kredensial berbeda tidak pernah jadi satu kartu", () => {
  const collapsed = collapseIssues([issue({}), issue({ credential: "lightman", target: "Network B" })]);
  assert.equal(collapsed.length, 2);
  assert.deepEqual(
    collapsed.map((entry) => entry.credential),
    ["petcins", "lightman"],
  );
});

// Baris Meta, plugin, dan tahap yang gagal tidak membawa kredensial Google sama sekali. Tanpa itu
// tidak ada yang menjamin keduanya satu tindakan — dan digabung, salah satunya hilang dari layar.
test("isu tanpa kredensial berdiri sendiri walau kalimatnya sama", () => {
  const meta = {
    ...issue({}),
    credential: "",
    source: "Sync akun Meta",
    say: "Token aksesnya sudah tidak berlaku — akun ini perlu dihubungkan ulang.",
  };
  const collapsed = collapseIssues([meta, { ...meta, target: "act_2" }]);
  assert.equal(collapsed.length, 2);
  assert.equal(collapsed[0].title, "Network A");
});

test("daftar kosong tidak meledak", () => {
  assert.deepEqual(collapseIssues(), []);
  assert.deepEqual(collapseIssues([]), []);
});

const group = (label, items) => ({ label, checkedAt: "", retry: null, items });

/**
 * Keadaan yang benar-benar berdiri di panel 01 Sep 2026: satu kredensial menjatuhkan empat modul
 * sekaligus, dan panel menggambar empat kartu yang menyuruh hal yang sama persis.
 */
test("kegagalan satu kredensial di beberapa cabang jadi SATU kartu di luar cabangnya", () => {
  const { cards, groups } = splitCredentialIssues([
    group("Akun AdSense/GAM", [issue({ impact: "Kolom earning di halaman GAM tidak diperbarui." })]),
    group("Grafik Overview", [
      issue({ source: "Riwayat pendapatan GAM", impact: "Garis Pendapatan kehilangan akun ini." }),
    ]),
    group("ROI subdomain", [
      issue({ source: "Daftar situs GAM", impact: "Kolom Persetujuan Google tidak diperbarui." }),
      issue({ source: "Laporan earning GAM", impact: "Earning subdomain tidak diperbarui." }),
    ]),
  ]);

  assert.equal(cards.length, 1);
  assert.equal(cards[0].credential, "petcins");
  assert.equal(cards[0].count, 4, "empat kegagalan, satu kartu");
  assert.deepEqual(cards[0].targets, ["Network A"], "satu akun tetap satu akun");
  assert.deepEqual(cards[0].places, ["Akun AdSense/GAM", "Grafik Overview", "ROI subdomain"]);
  assert.equal(cards[0].impacts.length, 4, "akibat di tiap tempat tetap disebut");
  assert.deepEqual(groups, [], "cabang yang habis diangkat tidak digambar kosong");
});

// Gangguan sisi penyedia pulih sendiri. Diangkat ke bagian "perlu dihubungkan ulang", ia menyuruh
// orang mengerjakan sesuatu yang tidak menyelesaikan apa pun.
test("gangguan sisi penyedia tetap tinggal di cabangnya", () => {
  const provider = issue({
    cause: "provider",
    say: "Servernya membalas HTTP 503 — gangguan di sisi mereka.",
  });
  const { cards, groups } = splitCredentialIssues([group("ROI subdomain", [issue({}), provider])]);

  assert.equal(cards.length, 1);
  assert.equal(groups.length, 1);
  assert.deepEqual(
    groups[0].items.map((item) => item.cause),
    ["provider"],
  );
});

test("isu tanpa nama kredensial tidak pernah diangkat", () => {
  const { cards, groups } = splitCredentialIssues([
    group("Akun Meta", [issue({ credential: "", source: "Sync akun Meta" })]),
  ]);
  assert.deepEqual(cards, []);
  assert.equal(groups[0].items.length, 1);
});

test("dua kredensial jadi dua kartu, urut kemunculannya", () => {
  const { cards } = splitCredentialIssues([
    group("Akun AdSense", [issue({ credential: "dian", target: "Dian ramadani" })]),
    group("ROI subdomain", [issue({}), issue({ credential: "dian", target: "Dian ramadani" })]),
  ]);
  assert.deepEqual(
    cards.map((card) => [card.credential, card.count]),
    [
      ["dian", 2],
      ["petcins", 1],
    ],
  );
});
