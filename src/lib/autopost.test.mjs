import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  AUTOPOST_BASE_MAX,
  AUTOPOST_MAX_KEYWORDS,
  autopostFormValues,
  autopostKeywords,
  dropPostedKeywords,
  jobLabel,
  jobTone,
  nextPollDelay,
  postedKeywords,
  runningJobs,
  submitMessage,
} from "./autopost.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const core = readFileSync(path.join(root, "functions/autopost-core.js"), "utf8");

/**
 * Dua hal ditulis DUA KALI — di sini dan di functions/autopost-core.js — karena `src/` dan
 * `functions/` adalah dua paket yang tidak bisa saling impor. Tes ini menjaganya tetap sama dengan
 * MEMBACA berkas seberangnya, persis pola `campaignCommandEntry` dan `cloudflareDns`.
 */
test("batas kata kunci dasar sama persis dengan sisi server", () => {
  const match = /export const AUTOPOST_BASE_MAX = (\d+);/.exec(core);
  assert.ok(match, "AUTOPOST_BASE_MAX harus ada di functions/autopost-core.js");
  assert.equal(AUTOPOST_BASE_MAX, Number(match[1]));
});

test("batas kata kunci sama persis dengan sisi server", () => {
  const match = /export const AUTOPOST_MAX_KEYWORDS = (\d+);/.exec(core);
  assert.ok(match, "AUTOPOST_MAX_KEYWORDS harus ada di functions/autopost-core.js");
  assert.equal(AUTOPOST_MAX_KEYWORDS, Number(match[1]));
});

test("pemecah kata kunci sama persis dengan sisi server", () => {
  const match = /export function autopostKeywords\(value\) \{([\s\S]*?)\n\}/.exec(core);
  assert.ok(match, "autopostKeywords harus ada di functions/autopost-core.js");

  // Badannya dibandingkan sebagai TEKS, bukan hasilnya untuk beberapa contoh. Yang dijaga bukan
  // "keduanya menjawab sama untuk kasus yang terpikirkan hari ini" melainkan keduanya adalah
  // aturan yang sama — dan aturan yang bergeser di satu sisi hampir selalu bergeser pada bentuk
  // yang justru tidak ada di daftar contoh.
  const mine = /export function autopostKeywords\(value\) \{([\s\S]*?)\n\}/.exec(
    readFileSync(path.join(root, "src/lib/autopost.js"), "utf8"),
  );
  assert.equal(mine[1].replace(/\s+/g, " ").trim(), match[1].replace(/\s+/g, " ").trim());
});

test("autopostKeywords: satu per baris, koma TIDAK memecah, duplikat dibuang", () => {
  // Koma dibiarkan utuh — sengaja berbeda dari `mediaList`. Kata kunci long-tail memuat koma, dan
  // yang dipecah di sana jadi dua potongan kalimat yang tidak berarti apa-apa sendirian.
  assert.deepEqual(autopostKeywords("seo plugin, gratis atau berbayar\n\n  cara pasang  "), [
    "seo plugin, gratis atau berbayar",
    "cara pasang",
  ]);

  // AutoPost tidak punya dedup sama sekali: dikirim dua kali, dua artikel lahir.
  assert.deepEqual(autopostKeywords("Best SEO Plugin\nbest seo plugin\nlainnya"), [
    "Best SEO Plugin",
    "lainnya",
  ]);

  assert.deepEqual(autopostKeywords(""), []);
  assert.deepEqual(autopostKeywords(["  a  ", "", "a"]), ["a"]);
});

test("jobLabel: 'Berhenti' tidak dilebur ke 'Gagal'", () => {
  // Keduanya `failed` di sisi plugin tapi menuntut tindakan berbeda: yang satu punya sebab yang
  // bisa diperbaiki, yang satu cuma perlu dikirim ulang.
  assert.equal(jobLabel({ status: "failed", stalled: true }), "Berhenti");
  assert.equal(jobLabel({ status: "failed" }), "Gagal");
  assert.equal(jobLabel({ status: "running" }), "Berjalan");
  assert.equal(jobLabel({ status: "done" }), "Selesai");
  assert.equal(jobLabel({}), "-");

  // Warnanya tetap merah untuk keduanya — yang berbeda kalimatnya, bukan tingkat gawatnya.
  assert.equal(jobTone({ status: "failed", stalled: true }), "danger");
  assert.equal(jobTone({ status: "running" }), "info");
  assert.equal(jobTone({}), "neutral");
});

test("nextPollDelay: berhenti sendiri kalau tidak ada yang berjalan", () => {
  // Syarat polling ini boleh ada sama sekali: tab yang dibiarkan terbuka semalaman tidak boleh
  // terus memanggil situsnya sampai pagi.
  assert.equal(nextPollDelay([{ status: "done" }, { status: "failed" }]), 0);
  assert.equal(nextPollDelay([]), 0);
  assert.equal(nextPollDelay(undefined), 0);

  const running = [{ status: "running" }];
  assert.equal(nextPollDelay(running, 0), 3000);
  assert.equal(nextPollDelay(running, 5), 8000);
  // Berjenjang naik lalu berhenti melebar — tahap `ai_request` bisa dua menit tanpa perubahan.
  assert.equal(nextPollDelay(running, 99), 15000);

  assert.equal(runningJobs([{ status: "running" }, { status: "done" }]), 1);
});

test("postedKeywords: hanya yang job-nya benar-benar lahir", () => {
  // "ok" berarti situs menjawab dengan job_id. Yang ditolak tidak ada di sisi situs sama sekali,
  // jadi ia tidak boleh ikut hilang dari kotak isian.
  assert.deepEqual(
    postedKeywords([
      { keyword: "a", status: "ok", jobId: "j1" },
      { keyword: "b", status: "failed", error: "kuota habis" },
      { keyword: "c", status: "ok", jobId: "j3" },
    ]),
    ["a", "c"],
  );
  assert.deepEqual(postedKeywords([]), []);
  assert.deepEqual(postedKeywords(null), []);
});

test("dropPostedKeywords: yang berhasil dibuang, yang gagal tetap berdiri", () => {
  const text = "a\nb\nc";
  assert.equal(dropPostedKeywords(text, ["a", "c"]), "b");

  // Tidak ada yang berhasil = kotak isian tidak disentuh sama sekali. Itu jalur yang dilewati
  // pengiriman yang seluruhnya ditolak, dan membuang apa pun di sana berarti menghapus kata kunci
  // yang tidak pernah terkirim ke mana-mana.
  assert.equal(dropPostedKeywords(text, []), text);
  assert.equal(dropPostedKeywords(text, null), text);
  assert.equal(dropPostedKeywords(text, ["", "   "]), text);
});

test("dropPostedKeywords: dua baris yang cuma beda kapitalisasi ikut hilang bersama job-nya", () => {
  // `autopostKeywords` mengirimnya sebagai SATU job, jadi menyisakan salah satunya berarti baris
  // yang tampak belum terkirim untuk artikel yang sudah jadi.
  assert.equal(dropPostedKeywords("Best SEO Plugin\nbest seo plugin\nlainnya", ["Best SEO Plugin"]), "lainnya");
  // Spasi di ujung baris tidak menyelamatkannya dari pembuangan — yang dikirim sudah di-trim.
  assert.equal(dropPostedKeywords("  a  \nb", ["a"]), "b");
});

test("dropPostedKeywords: yang tidak dikenali dibiarkan APA ADANYA", () => {
  // Pengiriman lima puluh kata kunci berlangsung beberapa detik, dan yang diketik orang ke kotak itu
  // selama menunggu tidak boleh ikut terhapus. Karena itu yang dibuang cuma yang cocok, bukan
  // seluruh isinya diganti daftar yang gagal.
  assert.equal(dropPostedKeywords("a\nb\nbaru diketik", ["a"]), "b\nbaru diketik");

  // Jarak yang sengaja dibuat orang di antara kelompok kata kuncinya bertahan: baris kosong tidak
  // pernah ada di daftar yang berhasil.
  assert.equal(dropPostedKeywords("a\n\nb", ["a"]), "\nb");

  assert.equal(dropPostedKeywords("", ["a"]), "");
  assert.equal(dropPostedKeywords(null, ["a"]), "");
});

test("submitMessage: menyebut JOB, bukan artikel", () => {
  // 202 datang sebelum satu kata pun ditulis. "3 artikel dibuat" akan diadu orang dengan daftar
  // postingnya beberapa detik kemudian, dan tidak akan cocok.
  const ok = submitMessage({ total: 3, ok: 3, failed: 0 }, "sub.domain.com");
  assert.equal(ok.tone, "success");
  assert.match(ok.message, /3 job dibuat/);
  assert.doesNotMatch(ok.message, /artikel dibuat/);

  assert.equal(submitMessage({ total: 3, ok: 2, failed: 1 }).tone, "warning");
  // Semuanya ditolak bukan peringatan melainkan kegagalan: tidak ada satu pun yang perlu dipantau.
  assert.equal(submitMessage({ total: 3, ok: 0, failed: 3 }).tone, "error");

  // NASIB DAFTARNYA ikut disebut: kotak isian berubah sendiri sesudah tombolnya ditekan, dan
  // perubahan yang tidak diumumkan pada kotak yang baru saja diisi orang terbaca seperti isinya
  // hilang.
  assert.match(ok.message, /dikosongkan/);
  assert.match(submitMessage({ total: 3, ok: 2, failed: 1 }).message, /masih ada di daftar/);
  assert.match(submitMessage({ total: 3, ok: 2, failed: 1 }).message, /yang berhasil sudah dibuang/);
  // Nol berhasil: tidak ada yang dibuang, dan kalimatnya tidak boleh mengaku sebaliknya.
  assert.match(submitMessage({ total: 3, ok: 0, failed: 3 }).message, /tidak ada yang dibuang/);
});

test("autopostFormValues: bawaan datang dari skema server, bukan diketik ulang", () => {
  const group = {
    fields: [
      { name: "bahasa", type: "text" },
      { name: "generate_image", type: "boolean" },
      { name: "author_id", type: "int" },
    ],
    defaults: { bahasa: "English", generate_image: true, author_id: 1 },
  };
  const toFormValue = (field, value) =>
    field.type === "boolean" ? value === true : String(value ?? "");

  assert.deepEqual(autopostFormValues(group, toFormValue), {
    bahasa: "English",
    generate_image: true,
    author_id: "1",
  });

  assert.deepEqual(autopostFormValues(null, toFormValue), {});
});
