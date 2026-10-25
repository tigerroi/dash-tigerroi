import assert from "node:assert/strict";
import test from "node:test";
import {
  cloudflareError,
  cloudflareFailureStatus,
  CloudflareError,
  dnsRecordName,
  normalizeDnsInput,
} from "./cloudflare-core.js";

const throws = (fn, pattern) => assert.throws(fn, (error) => {
  assert.ok(error instanceof CloudflareError, `harus CloudflareError, dapat ${error?.name}`);
  assert.match(error.message, pattern);
  return true;
});

test("nama relatif dilengkapi, nama penuh dibiarkan — keduanya menghasilkan nama yang sama", () => {
  // Kegagalan yang dicegah: "care" tersimpan benar secara kebetulan, sementara
  // "care.petcins.com" yang disalin orang dari kolom di sebelahnya menjadi
  // "care.petcins.com.petcins.com" — diterima Cloudflare, dan tidak menjawab apa pun.
  assert.equal(dnsRecordName("care", "petcins.com"), "care.petcins.com");
  assert.equal(dnsRecordName("care.petcins.com", "petcins.com"), "care.petcins.com");
  assert.equal(dnsRecordName("CARE.PetCins.com", "petcins.com"), "care.petcins.com");
  // Titik di ujung adalah bentuk "fully qualified" di berkas zona; Cloudflare tidak menerimanya.
  assert.equal(dnsRecordName("care.petcins.com.", "petcins.com"), "care.petcins.com");
  assert.equal(dnsRecordName("@", "petcins.com"), "petcins.com");
  assert.equal(dnsRecordName("", "petcins.com"), "petcins.com");
  assert.equal(dnsRecordName("a.b", "petcins.com"), "a.b.petcins.com");
});

test("tipe di luar daftar putih ditolak, bukan diteruskan ke Cloudflare", () => {
  throws(() => normalizeDnsInput({ type: "SRV", name: "x", content: "y" }, "z.com"), /tidak didukung/);
  throws(() => normalizeDnsInput({ type: "", name: "x", content: "y" }, "z.com"), /tidak didukung/);
});

test("record A menuntut IPv4 yang tiap oktetnya sah", () => {
  assert.equal(
    normalizeDnsInput({ type: "A", name: "a", content: "95.216.102.108" }, "z.com").content,
    "95.216.102.108",
  );
  // "empat kelompok angka" saja meloloskan ini, dan Cloudflare menolaknya dengan kode 1004 —
  // pesan yang tidak menyebut oktet mana yang salah.
  throws(() => normalizeDnsInput({ type: "A", name: "a", content: "999.1.1.1" }, "z.com"), /IPv4/);
  throws(() => normalizeDnsInput({ type: "A", name: "a", content: "example.com" }, "z.com"), /IPv4/);
});

test("CNAME ke alamat IP ditolak dengan sebab yang menyebut jalan keluarnya", () => {
  // Kesalahan paling tenang di DNS: diterima sebagai teks oleh sebagian editor, tidak pernah
  // menjawab apa pun.
  throws(
    () => normalizeDnsInput({ type: "CNAME", name: "a", content: "1.2.3.4" }, "z.com"),
    /Pakai record A/,
  );
  assert.equal(
    normalizeDnsInput({ type: "CNAME", name: "a", content: "target.example.com" }, "z.com").content,
    "target.example.com",
  );
});

test("AAAA menolak IPv4 yang salah kamar", () => {
  throws(() => normalizeDnsInput({ type: "AAAA", name: "a", content: "1.2.3.4" }, "z.com"), /IPv6/);
  assert.ok(normalizeDnsInput({ type: "AAAA", name: "a", content: "2606:4700::1" }, "z.com"));
});

test("TXT lolos apa adanya — tidak ada bentuk yang bisa diperiksa", () => {
  const record = normalizeDnsInput(
    { type: "TXT", name: "_verify", content: "google-site-verification=abc" },
    "z.com",
  );
  assert.equal(record.content, "google-site-verification=abc");
  assert.equal(record.name, "_verify.z.com");
});

test("TTL kosong berarti Auto, dan di luar rentang ditolak sebelum menyentuh jaringan", () => {
  assert.equal(normalizeDnsInput({ type: "A", name: "a", content: "1.1.1.1" }, "z.com").ttl, 1);
  assert.equal(
    normalizeDnsInput({ type: "A", name: "a", content: "1.1.1.1", ttl: "" }, "z.com").ttl,
    1,
  );
  assert.equal(
    normalizeDnsInput({ type: "A", name: "a", content: "1.1.1.1", ttl: "300" }, "z.com").ttl,
    300,
  );
  throws(
    () => normalizeDnsInput({ type: "A", name: "a", content: "1.1.1.1", ttl: 30 }, "z.com"),
    /TTL harus/,
  );
  throws(
    () => normalizeDnsInput({ type: "A", name: "a", content: "1.1.1.1", ttl: 999999 }, "z.com"),
    /TTL harus/,
  );
});

test("proxy MEMAKSA TTL Auto, karena Cloudflare menolak keduanya berdampingan", () => {
  // Dikirim bersama TTL lain, permintaannya ditolak SELURUHNYA — dan yang dibaca orang adalah
  // kegagalan menyimpan untuk kotak TTL yang bahkan tidak ia sentuh.
  const record = normalizeDnsInput(
    { type: "A", name: "a", content: "1.1.1.1", ttl: 300, proxied: true },
    "z.com",
  );
  assert.equal(record.proxied, true);
  assert.equal(record.ttl, 1);
});

test("proxy pada tipe yang tidak bisa diproxy DIPADAMKAN, bukan ditolak", () => {
  // Kotaknya memang tidak digambar untuk tipe itu, jadi `true` hanya bisa datang dari sisa nilai
  // saat orang mengganti tipe di form yang sudah terisi — dan menolaknya berarti pesan kesalahan
  // tentang kotak yang tidak ada di layar.
  const record = normalizeDnsInput(
    { type: "TXT", name: "a", content: "x", proxied: true },
    "z.com",
  );
  assert.equal(record.proxied, false);
});

test("MX menuntut priority berupa angka", () => {
  throws(
    () => normalizeDnsInput({ type: "MX", name: "@", content: "mail.z.com" }, "z.com"),
    /Priority/,
  );
  const record = normalizeDnsInput(
    { type: "MX", name: "@", content: "mail.z.com", priority: 10 },
    "z.com",
  );
  assert.equal(record.priority, 10);
  // Tipe lain tidak membawa priority sama sekali — Cloudflare menolaknya di sana.
  assert.equal(
    "priority" in normalizeDnsInput({ type: "A", name: "a", content: "1.1.1.1" }, "z.com"),
    false,
  );
});

test("isi yang kosong ditolak, dan tidak jadi record berisi teks kosong", () => {
  throws(() => normalizeDnsInput({ type: "A", name: "a", content: "  " }, "z.com"), /belum diisi/);
  throws(() => normalizeDnsInput({ type: "TXT", name: "a" }, "z.com"), /belum diisi/);
});

test("komentar melebihi batas Cloudflare ditolak, bukan dipotong diam-diam", () => {
  throws(
    () =>
      normalizeDnsInput(
        { type: "A", name: "a", content: "1.1.1.1", comment: "x".repeat(101) },
        "z.com",
      ),
    /maksimal/,
  );
  // Komentar kosong tidak dikirim sama sekali.
  assert.equal(
    "comment" in normalizeDnsInput({ type: "A", name: "a", content: "1.1.1.1" }, "z.com"),
    false,
  );
});

test("kode Cloudflare diterjemahkan jadi kalimat yang menyebut siapa yang memperbaikinya", () => {
  // "Record already exists" tidak menyebutkan bahwa yang harus dilakukan adalah menyunting yang
  // sudah ada.
  const bentrok = cloudflareError(400, { errors: [{ code: 81057, message: "Record already exists" }] });
  assert.match(bentrok.message, /Sunting yang sudah ada/);
  assert.equal(bentrok.code, "81057");

  // Token yang bentuknya rusak menjawab "Invalid request headers" — kalimat yang menuduh
  // permintaannya, bukan tokennya.
  assert.match(
    cloudflareError(400, { errors: [{ code: 6003, message: "Invalid request headers" }] }).message,
    /CLOUDFLARE_API_TOKEN/,
  );

  // Kode yang tidak dikenal tetap membawa pesan aslinya, bukan ditelan jadi kalimat umum.
  assert.match(
    cloudflareError(400, { errors: [{ code: 99999, message: "sesuatu yang baru" }] }).message,
    /sesuatu yang baru/,
  );
});

test("yang salah di sisi ORANG jadi 422; yang salah di sisi KITA naik jadi 502", () => {
  // Bentuk record yang keliru digambar sebagai pesan di form. Token yang ditolak tidak bisa
  // dikerjakan siapa pun di layar itu, jadi ia tidak boleh menyamar sebagai kesalahan pengisian.
  assert.equal(cloudflareFailureStatus(new CloudflareError("x", { code: "81057" })), 422);
  assert.equal(cloudflareFailureStatus(new CloudflareError("x", { code: "10000" })), 502);
  assert.equal(cloudflareFailureStatus(new CloudflareError("x", { code: "9103" })), 502);
  // "Yang dituju tidak ada" harus 404 — 422 di sana menyuruh orang memperbaiki isian untuk zona
  // yang tidak akan pernah ada di daftarnya, dan menyamarkan percobaan menyentuh zona akun lain.
  assert.equal(cloudflareFailureStatus(new CloudflareError("x", { code: "81044" })), 404);
  assert.equal(cloudflareFailureStatus(new CloudflareError("x", { code: "zone_not_found" })), 404);
  assert.equal(cloudflareFailureStatus(new CloudflareError("x", { code: "6003" })), 502);
  // Penolakan dari `normalizeDnsInput` tidak punya kode sama sekali — ia selalu tentang isian.
  assert.equal(cloudflareFailureStatus(new CloudflareError("x")), 422);
});
