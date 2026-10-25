import { monthKeyOf, shiftMonthKey, toDateKey } from "./dateRange.js";

/**
 * Rentang tanggal dari sepasang KUNCI BULAN — selalu bulan penuh, dari tanggal 1 sampai hari
 * terakhir.
 *
 * Sengaja BERBEDA dari `monthRange` di dateRange.js, yang memotong bulan berjalan di hari ini
 * supaya bawaan halaman sama dengan preset "Bulan ini". Yang dituntut di sini kebalikannya: batas
 * yang MENUTUP bulannya, karena itulah satu-satunya bentuk rentang yang memuat nominal invalid
 * traffic, earning akun yang ditutup, dan potongan pencairan bulan itu (lihat `wholeMonthsIn`).
 * Dipotong di hari ini, bulan berjalan tidak pernah "penuh" — dan itu memang benar; yang tidak
 * boleh adalah bulan yang SUDAH SELESAI ikut terpotong hanya karena pemilihnya berhati-hati.
 */
export function monthSpanRange(fromMonth, toMonth) {
  const lo = fromMonth <= toMonth ? fromMonth : toMonth;
  const hi = fromMonth <= toMonth ? toMonth : fromMonth;
  const [hiYear, hiMonth] = hi.split("-").map(Number);
  return { from: `${lo}-01`, to: toDateKey(new Date(hiYear, hiMonth, 0)) };
}

/**
 * Sepasang kunci bulan dari sebuah rentang tanggal.
 *
 * Dipakai untuk MEMBACA kembali `?periode=` yang sudah beredar — termasuk yang ditulis pemilih
 * rentang harian sebelum halaman ini punya pemilih bulan. Rentang yang tidak menutup bulannya
 * tetap terbaca sebagai bulan-bulan yang disentuhnya: pemilih yang menolak menggambarkan alamat
 * yang sedang dibuka orang akan tampil kosong di atas tabel yang justru berisi.
 */
export function monthSpanOf(range) {
  const from = String(range?.from || "").slice(0, 7);
  const to = String(range?.to || "").slice(0, 7);
  const fallback = monthKeyOf(new Date());
  return { from: from || to || fallback, to: to || from || fallback };
}

/**
 * Apakah rentang ini persis sepasang bulan penuh — yaitu apakah pemilih bulan bisa menggambarkannya
 * tanpa berbohong. Alamat lama yang berbentuk "12–19 Agustus" tetap dihormati dan tetap dipakai
 * menghitung; yang dilakukan halaman cuma menyebutkan bahwa ia bukan bulan penuh.
 */
export function isWholeMonthSpan(range) {
  const span = monthSpanOf(range);
  const whole = monthSpanRange(span.from, span.to);
  return range?.from === whole.from && range?.to === whole.to;
}

/**
 * Kunci bulan yang dipilih, dari `count` bulan ke belakang sampai bulan berjalan — daftar yang
 * digambar pemilihnya. Diturunkan dari jam, bukan dari data: bulan yang belum punya baris tetap
 * harus bisa dipilih, karena "bulan ini belum ada apa-apa" adalah jawaban yang sah dan cuma bisa
 * dilihat dengan memilihnya.
 */
export function monthKeysAround(year) {
  return Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, "0")}`);
}

/**
 * Periode pembanding untuk grup Accounting: bulan kalender PENUH sebelum bulan yang dibuka —
 * Agustus diadu dengan 1–31 Juli, bukan dengan 31 hari terakhir yang berakhir 31 Juli.
 *
 * Menggantikan `previousRange`, yang menggeser rentangnya sepanjang jumlah HARI-nya. Aturan itu
 * benar untuk periode bebas (7 hari terakhir melawan 7 hari sebelumnya), dan salah di sini karena
 * dua hal. Pertama, hasilnya hampir tidak pernah menutup bulan: Maret 31 hari mundur ke
 * 29 Jan–28 Feb, dan `wholeMonthsIn` menjatuhkan nominal invalid traffic, earning akun yang
 * ditutup, DAN potongan pencairan dari sisi pembandingnya saja — jadi tiap kolom Selisih di layar
 * mengadu bulan yang lengkap dengan bulan yang tiga sumbernya hilang, dan labanya selalu terbaca
 * turun. Kedua, sejak pemilihnya hanya bisa memilih satu bulan, "sepanjang yang sama" tidak lagi
 * menjawab pertanyaan siapa pun: yang dibandingkan orang di halaman ini adalah bulan dengan bulan.
 *
 * Rentang beberapa bulan dari alamat lama mundur sebanyak itu juga (Jun–Agu melawan Mar–Mei), dan
 * rentang yang salah satu batasnya kosong tidak punya pembanding sama sekali: yang dikembalikan
 * rentang kosong, dan kolomnya menggambar "-".
 */
export function previousMonthSpanRange(range) {
  const from = String(range?.from || "");
  const to = String(range?.to || "");
  if (!from || !to || from > to) return { from: "", to: "" };

  const span = monthSpanOf(range);
  const months = monthsBetween(span.from, span.to) + 1;
  return monthSpanRange(shiftMonthKey(span.from, -months), shiftMonthKey(span.from, -1));
}

function monthsBetween(fromMonth, toMonth) {
  const [fromYear, fromIndex] = fromMonth.split("-").map(Number);
  const [toYear, toIndex] = toMonth.split("-").map(Number);
  return (toYear - fromYear) * 12 + (toIndex - fromIndex);
}
