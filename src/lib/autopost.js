import { localStore } from "./localStore.js";
// AutoPost — sisi UI-nya.
//
// Modul murni: tidak memanggil jaringan, tidak menyentuh Firebase. Yang dijaganya adalah kosakata
// status job, kapan polling berhenti, dan tempat tinggal kunci AI.
//
// Yang TIDAK ada di sini, sengaja: label tiap tahap. Plugin mengirimnya sendiri (`stage_label`,
// "Meminta artikel ke AI (gemini)"), dan menyalinnya jadi peta kedua berarti layar ini menyebut
// tahap yang berbeda dari yang ditulis job-nya sendiri di log tepat di bawahnya — pada hari plugin
// menambah satu tahap, yang di sini diam-diam menggambar tahap yang salah. Yang dicerminkan cuma
// yang benar-benar diputuskan browser: warnanya, dan kapan berhenti bertanya.

/**
 * Batas kata kunci per pengiriman — DICERMINKAN dari `AUTOPOST_MAX_KEYWORDS` di
 * functions/autopost-core.js, persis pola `campaignCommandEntry`.
 *
 * Ditulis dua kali karena `src/` dan `functions/` adalah dua paket yang tidak bisa saling impor.
 * Beda sedikit dan yang terjadi tidak berbunyi sebagai kesalahan di sisi yang salah: form
 * menawarkan tombol Kirim yang aktif untuk daftar yang akan ditolak server, atau — arah yang lebih
 * buruk — menolak daftar yang sebenarnya sah dan tidak ada satu pun kalimat di layar yang
 * menyebutkan sebabnya. Dijaga src/lib/autopost.test.mjs, yang membaca berkas seberangnya.
 */
export const AUTOPOST_MAX_KEYWORDS = 50;

// Panjang maksimum kata kunci dasar — DICERMINKAN dari `AUTOPOST_BASE_MAX` di
// functions/autopost-core.js, dijaga src/lib/autopost.test.mjs.
export const AUTOPOST_BASE_MAX = 2000;

/**
 * Textarea → daftar kata kunci yang benar-benar dikirim. Kembaran `autopostKeywords` di
 * functions/autopost-core.js.
 *
 * Dipisah per BARIS saja, tidak per koma — sengaja berbeda dari `mediaList` di src/lib/plugin.js.
 * Kata kunci long-tail memuat koma ("wordpress seo plugin, gratis atau berbayar"), dan yang dipecah
 * di sana menghasilkan dua job untuk dua potongan kalimat yang tidak berarti apa-apa sendirian.
 *
 * Duplikat dibuang tanpa memandang kapitalisasi. AutoPost tidak punya dedup sama sekali — kata
 * kunci yang sama dikirim dua kali menghasilkan dua artikel — dan daftar yang ditempel dari
 * spreadsheet hampir selalu memuat pengulangan. Yang dihitung di layar HARUS yang sudah bersih,
 * karena angka itulah yang dijanjikan tombol Kirim.
 */
export function autopostKeywords(value) {
  const lines = Array.isArray(value) ? value : String(value ?? "").split(/[\r\n]+/);
  const seen = new Set();
  const keywords = [];
  for (const line of lines) {
    const text = String(line ?? "").trim();
    if (!text) continue;
    const fingerprint = text.toLowerCase();
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    keywords.push(text);
  }
  return keywords;
}

/**
 * Buang kata kunci yang JOB-NYA SUDAH LAHIR dari kotak isian; sisakan yang tidak.
 *
 * Yang tersisa jadi daftar untuk dikirim ulang: kata kunci yang ditolak (kuota AI habis di tengah
 * daftar, kategori tidak ada) tetap berdiri berikut sebabnya di peringatan atas tabel job, jadi
 * memperbaikinya lalu menekan Kirim lagi tidak menuntut siapa pun mengetik ulang lima puluh baris —
 * dan yang lebih penting, tidak menuntutnya MENGINGAT yang mana saja yang tadi gagal. AutoPost
 * tidak punya dedup: mengirim ulang seluruh daftar menghasilkan artikel kedua untuk tiap kata kunci
 * yang sudah berhasil.
 *
 * MEMBUANG yang berhasil, bukan MENGGANTI isinya dengan daftar yang gagal — dan bedanya baru
 * terlihat pada satu keadaan yang benar-benar terjadi: pengiriman lima puluh kata kunci berlangsung
 * beberapa detik, dan yang diketik orang ke kotak itu selama menunggu akan lenyap kalau isinya
 * ditimpa. Di sini baris yang tidak dikenali sebagai berhasil dibiarkan apa adanya, termasuk yang
 * belum ada saat tombolnya ditekan.
 *
 * Dicocokkan tanpa memandang kapitalisasi, sepola `autopostKeywords`: dua baris yang cuma berbeda
 * huruf besar-kecil dikirim sebagai SATU job, jadi keduanya harus ikut hilang begitu job itu lahir.
 * Yang tertinggal kalau tidak adalah baris yang tampak belum terkirim untuk artikel yang sudah jadi.
 */
export function dropPostedKeywords(text, posted) {
  const done = new Set(
    (Array.isArray(posted) ? posted : [])
      .map((keyword) =>
        String(keyword ?? "")
          .trim()
          .toLowerCase(),
      )
      .filter(Boolean),
  );
  if (!done.size) return String(text ?? "");

  return (
    String(text ?? "")
      .split(/\r?\n/)
      // Baris kosong tidak pernah ada di `done` (yang kosong sudah disaring di atas), jadi jarak yang
      // sengaja dibuat orang di antara kelompok kata kuncinya ikut bertahan.
      .filter((line) => !done.has(line.trim().toLowerCase()))
      .join("\n")
  );
}

// Kata kunci yang job-nya benar-benar lahir. `status` datang dari `submitRow` di
// functions/autopost-core.js — "ok" berarti situs menjawab dengan `job_id`, dan hanya itu yang
// boleh dihapus dari kotak isian.
export function postedKeywords(results) {
  return (Array.isArray(results) ? results : [])
    .filter((row) => row?.status === "ok")
    .map((row) => String(row?.keyword ?? ""));
}

/**
 * Kunci AI tinggal di localStorage PERANGKAT INI, dan hanya kalau orangnya memintanya.
 *
 * Tiga tempat yang sengaja TIDAK dipakai, masing-masing dengan sebabnya:
 *
 *   RTDB     — `pluginKeys` sudah jadi satu-satunya node rahasia di database ini, dan isinya kunci
 *              yang kita sendiri terbitkan. Kunci AI ditagihkan per panggilan kepada pemiliknya;
 *              disimpan di sana, ia terbaca tiap admin yang mengetik path-nya.
 *   alamat   — `useUrlState` menulis ke query, dan query masuk ke riwayat browser dan ke tiap
 *              tautan yang di-share. Satu tempelan alamat di chat menyerahkan kuncinya.
 *   .env     — satu kunci untuk seluruh armada berarti satu tagihan yang tidak bisa dipisahkan per
 *              orang, dan mengubahnya menuntut deploy.
 *
 * Bawaannya TIDAK diingat. Menyimpan kredensial diam-diam adalah keputusan yang dibuat atas nama
 * orang lain; kotak centangnya berdiri tepat di sebelah kotak isiannya, satu klik, dan yang
 * mencentangnya tahu persis apa yang ia setujui.
 */
// Satu kunci per JENIS: halaman legal dan AutoPost bisa ditagihkan ke akun AI yang berbeda.
// Nama lama milik AutoPost dipertahankan supaya kunci yang sudah diingat tidak hilang.
const AI_KEY_STORAGE = { autopost: "rabbitroi.autopost.aiKey", legal: "rabbitroi.legal.aiKey" };

export function readStoredAiKey(kind = "autopost") {
  try {
    return String(localStore()?.getItem(AI_KEY_STORAGE[kind]) || "");
  } catch {
    return "";
  }
}

export function writeStoredAiKey(value, kind = "autopost") {
  try {
    const key = String(value || "").trim();
    if (key) localStore()?.setItem(AI_KEY_STORAGE[kind], key);
    else localStore()?.removeItem(AI_KEY_STORAGE[kind]);
  } catch {
    /* Kuncinya tetap berlaku untuk sesi ini; yang hilang cuma ingatannya. */
  }
}

// --- Status job -------------------------------------------------------------------------------------

const STATUS_TONES = { running: "info", done: "success", failed: "danger" };

const STATUS_LABELS = { running: "Berjalan", done: "Selesai", failed: "Gagal" };

export function jobTone(job) {
  return STATUS_TONES[String(job?.status || "")] || "neutral";
}

/**
 * Label satu job — dan `stalled` punya labelnya SENDIRI, tidak dilebur ke "Gagal".
 *
 * Keduanya `status: "failed"` di sisi plugin, tapi menuntut tindakan yang berbeda. Gagal biasa
 * punya sebab yang tertulis dan bisa diperbaiki (kunci AI ditolak, kuota habis, kategori tidak
 * ada); `stalled` berarti proses PHP-nya dibunuh server di tengah jalan — tidak ada yang salah
 * dengan permintaannya, dan yang perlu dilakukan cuma mengirimnya lagi. Dilebur, orang akan
 * memeriksa kunci AI yang tidak pernah bermasalah.
 */
export function jobLabel(job) {
  if (job?.stalled === true) return "Berhenti";
  return STATUS_LABELS[String(job?.status || "")] || job?.status || "-";
}

function isJobRunning(job) {
  return String(job?.status || "") === "running";
}

export function runningJobs(jobs) {
  return (jobs || []).filter(isJobRunning).length;
}

/**
 * Berapa lama sampai daftar job ditanyakan lagi — `0` berarti berhenti.
 *
 * Dokumen API menyarankan 2-5 detik dengan backoff. Backoff-nya ada karena tahap terpanjang
 * (`ai_request`, menunggu jawaban AI) bisa berlangsung dua menit tanpa satu pun perubahan yang
 * terbaca di layar, dan bertanya empat puluh kali selama itu adalah empat puluh permintaan yang
 * menjawab hal yang sama — lewat server kontrol, ke shared hosting yang sedang menulis artikel.
 *
 * BERHENTI SENDIRI begitu tidak ada job berjalan, dan itu syaratnya boleh ada sama sekali: tab yang
 * dibiarkan terbuka semalaman tidak boleh terus memanggil situsnya sampai pagi. Job yang mati tanpa
 * kabar tetap berakhir — plugin memindahkannya ke `failed`/`stalled` sendiri setelah `stale_seconds`
 * — jadi polling ini punya ujung walau tidak ada satu pun job yang selesai dengan benar.
 */
export function nextPollDelay(jobs, ticks = 0) {
  if (!runningJobs(jobs)) return 0;
  const step = Math.max(0, Number(ticks) || 0);
  return Math.min(3000 + step * 1000, 15000);
}

/**
 * Ringkasan satu baris untuk toast pengiriman.
 *
 * Kata "job", bukan "artikel": yang benar-benar terjadi pada titik ini adalah situsnya MENERIMA
 * permintaan (HTTP 202, sebelum satu kata pun ditulis). "3 artikel dibuat" untuk tiga job yang
 * baru saja mengantre adalah kalimat yang akan diadu orang dengan daftar postingnya, dan tidak
 * akan cocok selama beberapa menit berikutnya.
 */
export function submitMessage(summary, siteName) {
  const { total = 0, ok = 0, failed = 0 } = summary || {};
  const parts = [`${ok} job dibuat`];
  if (failed) parts.push(`${failed} ditolak`);
  // Nasib DAFTARNYA disebut, bukan cuma hasilnya: kotak isian berubah sendiri sesudah tombol ini
  // ditekan — yang berhasil dibuang, yang ditolak tinggal — dan perubahan yang tidak diumumkan pada
  // kotak yang baru saja diisi orang terbaca seperti isinya hilang.
  const fate = failed
    ? ` Yang ditolak masih ada di daftar untuk dikirim ulang; ${ok > 0 ? "yang berhasil sudah dibuang" : "tidak ada yang dibuang"}.`
    : " Daftarnya dikosongkan — semuanya sudah jadi job.";
  return {
    tone: failed ? (ok ? "warning" : "error") : "success",
    message: `${total} kata kunci dikirim ke ${siteName}: ${parts.join(", ")}. Artikelnya menyusul — pantau di daftar job.${fate}`,
  };
}

/**
 * Skema + bawaannya → nilai awal form.
 *
 * Bawaan datang dari SERVER bersama skemanya, bukan diketik ulang di sini. Dua di antaranya
 * (`generate_image`, `tag_otomatis`) berbeda dari bawaan REST — menyala di form, `false` kalau
 * tidak dikirim — dan daftar kedua di browser adalah cara selisih itu diam-diam berbalik pada hari
 * salah satunya diubah.
 */
export function autopostFormValues(group, toFormValue) {
  const values = {};
  for (const field of group?.fields || []) {
    values[field.name] = toFormValue(field, group?.defaults?.[field.name]);
  }
  return values;
}
