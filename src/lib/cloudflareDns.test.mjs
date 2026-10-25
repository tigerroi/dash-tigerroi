import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  DNS_TYPES,
  hostOf,
  isProxiable,
  missingSubDomains,
  needsPriority,
  PROXIABLE_TYPES,
  recordSummary,
  shortRecordName,
  toRecordForm,
  toRecordPayload,
  zoneServer,
  toRecordRows,
  toZoneRows,
  TTL_AUTO,
  TTL_MAX,
  TTL_MIN,
  ttlLabel,
} from "./cloudflareDns.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const core = readFileSync(path.join(root, "functions/cloudflare-core.js"), "utf8");

/**
 * Tiga konstanta yang ditulis DUA KALI — di sini dan di functions/cloudflare-core.js — dan yang
 * dijaga tes ini adalah keduanya tetap sama persis, dengan MEMBACA berkas seberangnya. Persis pola
 * `campaignCommandEntry`.
 *
 * Kalau bergeser, kegagalannya tenang dengan cara yang paling buruk: form menawarkan tipe record
 * yang ditolak server (yang setidaknya berbunyi), ATAU menyembunyikan kotak proxy untuk tipe yang
 * sebenarnya bisa diproxy — dan yang kedua tidak berbunyi di mana pun, cuma sebagai record yang
 * tidak pernah bisa dinyalakan proxy-nya dari layar ini.
 */
test("daftar tipe dan tipe yang bisa diproxy sama persis dengan sisi server", () => {
  const listOf = (name) => {
    const match = new RegExp(`export const ${name} = \\[([^\\]]*)\\]`).exec(core);
    assert.ok(match, `${name} harus ada di functions/cloudflare-core.js`);
    return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  };

  assert.deepEqual(DNS_TYPES, listOf("DNS_TYPES"));
  assert.deepEqual(PROXIABLE_TYPES, listOf("PROXIABLE_TYPES"));
});

test("batas TTL sama persis dengan sisi server", () => {
  const numberOf = (name) => {
    const match = new RegExp(`export const ${name} = ([0-9_]+)`).exec(core);
    assert.ok(match, `${name} harus ada di functions/cloudflare-core.js`);
    return Number(match[1].replace(/_/g, ""));
  };

  assert.equal(TTL_AUTO, numberOf("TTL_AUTO"));
  assert.equal(TTL_MIN, numberOf("TTL_MIN"));
  assert.equal(TTL_MAX, numberOf("TTL_MAX"));
});

test("proxy hanya untuk tipe yang jawabannya alamat tujuan HTTP", () => {
  assert.ok(isProxiable("A"));
  assert.ok(isProxiable("cname"));
  // TXT yang diproxy ditolak Cloudflare; MX yang diproxy MENGHANCURKAN surat masuk domain itu
  // tanpa satu pun pesan kesalahan.
  assert.equal(isProxiable("TXT"), false);
  assert.equal(isProxiable("MX"), false);
  assert.equal(needsPriority("MX"), true);
  assert.equal(needsPriority("A"), false);
});

test("nama record dipendekkan seperti di layar Cloudflare, akar zona jadi @", () => {
  assert.equal(shortRecordName("care.petcins.com", "petcins.com"), "care");
  assert.equal(shortRecordName("petcins.com", "petcins.com"), "@");
  assert.equal(shortRecordName("a.b.petcins.com", "petcins.com"), "a.b");
  // Nama dari zona lain tidak dipotong asal-asalan: yang tidak berakhiran zonanya digambar penuh.
  assert.equal(shortRecordName("care.lain.com", "petcins.com"), "care.lain.com");
});

test("TTL 1 berbunyi Auto, bukan satu detik", () => {
  // Ini seluruh alasan `ttlLabel` ada: "1" apa adanya mengabarkan satu detik kepada pembacanya.
  assert.equal(ttlLabel(1), "Auto");
  assert.equal(ttlLabel(3600), "1 jam");
  assert.equal(ttlLabel(120), "2 menit");
  assert.equal(ttlLabel(90), "90 detik");
  assert.equal(ttlLabel(undefined), "Auto");
});

test("domainUrl yang diketik orang tetap berjodoh dengan zonanya", () => {
  // Tiga bentuk yang benar-benar ada di kolom yang diketik manusia, semuanya berarti zona yang sama.
  assert.equal(hostOf("https://www.petcins.com/"), "petcins.com");
  assert.equal(hostOf("  PETCINS.COM  "), "petcins.com");
  assert.equal(hostOf("petcins.com."), "petcins.com");
});

test("zona tanpa baris di /domains tetap tampil, ditandai", () => {
  const rows = toZoneRows(
    [
      { id: "z1", name: "petcins.com", permissions: ["#dns_records:edit"] },
      { id: "z2", name: "baru.com", permissions: ["#dns_records:read"] },
    ],
    [{ domainUrl: "https://petcins.com" }],
  );

  // Diurut menurut nama, jadi baru.com lebih dulu.
  assert.deepEqual(
    rows.map((row) => [row.name, row.registered, row.editable]),
    [
      ["baru.com", false, false],
      ["petcins.com", true, true],
    ],
  );
});

test("token tanpa daftar izin dianggap boleh menulis", () => {
  // Kalau `permissions` tidak dikirim sama sekali, yang salah bukan izinnya melainkan bentuk
  // jawabannya — dan menyembunyikan tombol karenanya membuat halaman tampak hanya-baca untuk token
  // yang sebenarnya penuh. Cloudflare tetap yang menolak kalau memang tidak boleh.
  assert.equal(toZoneRows([{ id: "z", name: "a.com" }], [])[0].editable, true);
});

test("hanya record pengarah yang ditandai sebagai subdomain terdaftar", () => {
  const rows = toRecordRows(
    [
      { id: "1", type: "A", name: "care.petcins.com", content: "1.1.1.1" },
      // TXT yang kebetulan senama BUKAN "yang melayani subdomain itu".
      { id: "2", type: "TXT", name: "care.petcins.com", content: "v=spf1" },
      { id: "3", type: "A", name: "lain.petcins.com", content: "1.1.1.1" },
    ],
    "petcins.com",
    [{ name: "care.petcins.com" }],
  );

  const byId = Object.fromEntries(rows.map((row) => [row.id, row.subDomain]));
  assert.deepEqual(byId, { 1: true, 2: false, 3: false });
});

test("baris diurut per tipe lalu nama, dengan angka dibaca sebagai angka", () => {
  const rows = toRecordRows(
    [
      { id: "1", type: "A", name: "sub10.z.com" },
      { id: "2", type: "A", name: "sub2.z.com" },
      { id: "3", type: "CNAME", name: "aaa.z.com" },
    ],
    "z.com",
    [],
  );
  assert.deepEqual(
    rows.map((row) => row.shortName),
    ["sub2", "sub10", "aaa"],
  );
});

test("ringkasan menghitung proxy terpisah", () => {
  const rows = toRecordRows(
    [
      { id: "1", type: "A", name: "a.z.com", proxied: true },
      { id: "2", type: "A", name: "b.z.com", proxied: false },
    ],
    "z.com",
    [],
  );
  const summary = recordSummary(rows);
  assert.equal(summary.total, 2);
  assert.equal(summary.proxied, 1);
});

test("subdomain tanpa record pengarah disebutkan", () => {
  const result = missingSubDomains(
    [{ type: "A", name: "ada.z.com" }],
    "z.com",
    [{ name: "ada.z.com" }, { name: "hilang.z.com" }, { name: "lain.domainlain.com" }],
  );
  // Subdomain milik zona LAIN tidak ikut dituduh.
  assert.deepEqual(result.names, ["hilang.z.com"]);
  assert.equal(result.wildcard, false);
});

test("wildcard membuat halaman MENYERAH menyimpulkan, bukan menuduh", () => {
  // Satu wildcard menjawab tiap nama yang tidak punya record sendiri, jadi daftar "hilang" akan
  // menuduh subdomain yang justru sedang bekerja. Sepola `earningKnown`: yang tidak bisa dipastikan
  // tidak dinilai.
  const result = missingSubDomains(
    [{ type: "A", name: "*.z.com" }],
    "z.com",
    [{ name: "hilang.z.com" }],
  );
  assert.deepEqual(result.names, []);
  assert.equal(result.wildcard, true);
});

test("TTL Auto digambar sebagai kotak KOSONG, bukan angka 1", () => {
  // Kotak berisi "1" mengundang orang menggantinya jadi 60 karena ia terbaca sebagai satu detik.
  assert.equal(toRecordForm({ ttl: 1, type: "A" }, "z.com").ttl, "");
  assert.equal(toRecordForm({ ttl: 300, type: "A" }, "z.com").ttl, "300");
});

test("form kosong lahir sebagai record A", () => {
  const form = toRecordForm(null, "z.com");
  assert.equal(form.type, "A");
  assert.equal(form.id, "");
  assert.equal(form.name, "");
});

test("proxied dan priority DIBUANG untuk tipe yang tidak memakainya", () => {
  // Sisa nilai dari tipe sebelumnya — orang mengganti CNAME jadi TXT di form yang sudah terisi —
  // tidak boleh ikut terkirim sebagai keadaan yang tidak pernah dipilih siapa pun.
  const payload = toRecordPayload({
    type: "TXT",
    name: "a",
    content: "x",
    proxied: true,
    priority: "10",
  });
  assert.equal("proxied" in payload, false);
  assert.equal("priority" in payload, false);

  const mx = toRecordPayload({ type: "MX", name: "@", content: "mail.z.com", priority: "10" });
  assert.equal(mx.priority, "10");
  assert.equal("proxied" in mx, false);
});

test("Isi record A yang kosong jatuh ke server domain (A record apex)", () => {
  const records = [
    { type: "A", name: "care.petcins.com", content: "1.1.1.1" },
    { type: "A", name: "petcins.com", content: "95.216.102.108" },
  ];
  const server = zoneServer(records, "petcins.com");
  assert.equal(server, "95.216.102.108");
  assert.equal(zoneServer([records[0]], "petcins.com"), "", "tanpa apex tidak ditebak");
  assert.equal(toRecordPayload({ type: "A", name: "x", content: "" }, server).content, server);
  assert.equal(toRecordPayload({ type: "A", name: "x", content: "2.2.2.2" }, server).content, "2.2.2.2");
  assert.equal(toRecordPayload({ type: "CNAME", name: "x", content: "" }, server).content, "");
});
