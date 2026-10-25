import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ACCOUNT_STATUSES } from "./accountStatus.js";

/**
 * CERMINAN, dan satu-satunya tes yang benar-benar menentukan di berkas ini.
 *
 * Kosakata status ditulis dua kali — di `functions/account-status.js` (yang MENULIS kolom Status
 * tiap sync) dan di sini (yang menawarkan pilihannya di form). Beda sedikit, dan yang terjadi
 * bukan error melainkan diam: nilai yang ditulis sync tidak ada di daftar pilihan, form membukanya
 * sebagai kotak kosong, dan Simpan menuliskan nilai lain ke akun yang tidak diminta siapa pun.
 *
 * Yang dibandingkan TEKS bloknya, bukan hasil beberapa contoh: sebuah keadaan kelima yang
 * ditambahkan di satu sisi tidak akan tertangkap oleh contoh yang ditulis sebelum keadaan itu ada.
 */
const mirror = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r/g, "");

// Blok diambil dari deklarasi pertama sampai penutup daftarnya. Komentar di antaranya sengaja
// TIDAK ikut dibandingkan (`stripComments`): kedua berkas menerangkan hal yang berbeda kepada
// pembaca yang berbeda, dan menuntut komentarnya sama persis cuma melahirkan tes yang dimatikan
// orang pertama kali ia mengganggu.
function statusBlock(source) {
  const start = source.indexOf("export const ACCOUNT_CLOSED =");
  assert.notEqual(start, -1, "deklarasi ACCOUNT_CLOSED tidak ditemukan");
  const head = "export const ACCOUNT_STATUSES = [";
  const listStart = source.indexOf(head, start);
  assert.notEqual(listStart, -1, "daftar ACCOUNT_STATUSES tidak ditemukan");
  const end = source.indexOf("];", listStart);
  assert.notEqual(end, -1, "penutup daftar ACCOUNT_STATUSES tidak ditemukan");
  return stripComments(source.slice(start, end + 2));
}

function stripComments(block) {
  return block
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n")
    .trim();
}

test("kosakata status sama persis dengan yang di functions/account-status.js", () => {
  assert.equal(
    statusBlock(mirror("./accountStatus.js")),
    statusBlock(mirror("../../functions/account-status.js")),
  );
});

test("empat keadaan, urut dari yang paling menghentikan pendapatan", () => {
  assert.deepEqual(ACCOUNT_STATUSES, [
    "Akun Close",
    "Limit Iklan",
    "Iklan Belum Tayang",
    "Ready",
  ]);
});

test("resources.js menawarkan kosakata ini, bukan daftar yang diketik ulang", () => {
  const source = mirror("../config/resources.js");
  assert.match(source, /import \{[^}]*\bACCOUNT_STATUSES\b[^}]*\} from "\.\.\/lib\/accountStatus\.js";/);
  // Kosakata lama tidak boleh tertinggal di salah satu dari dua halaman: kolom yang sama dengan
  // dua daftar pilihan berbeda berarti satu halaman menulis nilai yang halaman sebelahnya baca
  // sebagai lencana tanpa nada.
  assert.doesNotMatch(source, /"Lepas Limit"/);
});

// --- Kolom "Status dari Google" -------------------------------------------------------------
//
// Ia pembanding yang menentukan apakah kolom Status sedang dipegang orang
// (`accountStatusPinned` di functions/account-status.js). Yang dijaga di sini bukan aturannya —
// itu tinggal di sisi sync dan diuji di sana — melainkan tiga syarat sisi layar yang gagal
// tanpa suara: kolomnya harus ADA di kedua halaman (tanpa itu, baris yang dikunci berdiri tanpa
// satu pun tanda tentang apa kata Google hari ini), dan isiannya harus TIDAK bisa diketik.
test("kedua halaman akun memuat kolom Status dari Google", () => {
  const source = mirror("../config/resources.js");
  assert.equal(source.match(/\["statusAuto", "Status dari Google"\]/g)?.length, 2);
});

test("Status dari Google tidak bisa diketik siapa pun", () => {
  // Kotak yang bisa diketik berarti kunci di kolom sebelahnya bisa dilepas dengan mengarang
  // jawaban Google — dan sesudahnya tidak ada apa pun di baris itu yang menyebutkan bahwa
  // statusnya tidak pernah dibaca dari Google sama sekali. `compute` menjamin readOnly-nya
  // (ResourceForm menggambar tiap field ber-`compute` begitu).
  const source = mirror("../config/resources.js");
  const fields = source.match(/name: "statusAuto",[\s\S]{0,200}?\n {6}\},/g) || [];
  assert.equal(fields.length, 2);
  for (const field of fields) assert.match(field, /compute: \(values\) => values\.statusAuto/);
});

test("kolomnya berlencana, sepola kolom Status di sebelahnya", () => {
  // Dua kolom berkosakata sama yang satu berlencana dan satu tidak terbaca seolah yang kedua cuma
  // catatan tentang yang pertama — alasan yang sama yang menjadikan `adApproval` lencana.
  assert.match(mirror("./renderCell.jsx"), /const badgeKeys = \[\n {2}"status",\n(?:.*\n)*? {2}"statusAuto",/);
});
