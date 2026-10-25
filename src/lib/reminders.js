import { shiftDateKey, toDateKey } from "./dateRange.js";

// Berapa hari sebelum jatuh tempo notifikasi mulai muncul. Due tanggal 18 → tampil sejak tanggal
// 16 sampai ditandai selesai. ponytail: konstanta; kalau nanti perlu per-reminder, jadikan field.
export const REMINDER_LEAD_DAYS = 2;

// Reminder yang perlu diperhatikan: belum selesai dan jatuh temponya sudah lewat atau tinggal
// beberapa hari lagi (REMINDER_LEAD_DAYS). Satu-satunya definisi "due", dipakai badge topbar
// maupun panel Overview — kalau keduanya menghitung sendiri, angka di badge bisa beda dengan
// daftar yang dibuka orang.
//
// Tanggal ISO "YYYY-MM-DD" dibandingkan sebagai teks (urutannya sama dengan urutan kronologis),
// jadi tidak perlu parse ke Date. ponytail: "hari ini" pakai zona browser (toDateKey) — sama
// seperti default tanggal form; kalau butuh zona operasi, ganti dengan zonedDateKey.
export function dueReminders(rows, today = toDateKey(new Date())) {
  return (Array.isArray(rows) ? rows : [])
    .filter(
      (row) =>
        row?.status !== "Selesai" &&
        row?.dueDate &&
        row.dueDate <= shiftDateKey(today, leadDaysOf(row)),
    )
    .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
}

/**
 * Jendela antisipasi untuk SATU baris, dalam hari.
 *
 * `REMINDER_LEAD_DAYS` menjawab "beri tahu saya beberapa hari sebelumnya". Untuk pengingat yang
 * berulang LEBIH SERING daripada jendela itu, antisipasi tidak berarti apa-apa: pengingat harian
 * yang baru ditandai selesai jatuh tempo lagi besok, besok masih di dalam jendela dua hari, dan
 * badge-nya tidak pernah padam. Yang terbaca orang bukan "ada tugas harian" melainkan "tombol
 * centangnya tidak bekerja" — dan badge yang selalu menyala berhenti memberi tahu apa pun.
 *
 * Jadi jendelanya dijepit ke satu hari lebih pendek dari jaraknya sendiri: harian tiap hari
 * mendapat 0 (tampil pada harinya, bukan sehari sebelumnya), harian tiap 3 hari kembali ke 2,
 * mingguan ke atas tidak berubah sama sekali.
 */
export function leadDaysOf(row) {
  const days = repeatIntervalDays(row);
  return days ? Math.min(REMINDER_LEAD_DAYS, days - 1) : REMINDER_LEAD_DAYS;
}

// Jarak satu pengulangan dalam hari, atau 0 untuk yang tidak berulang. Bulan dan tahun dijawab
// dengan panjang terpendeknya (28 dan 365) — angkanya cuma dipakai untuk dibandingkan dengan
// jendela dua hari, jadi yang penting bukan ketepatannya melainkan bahwa keduanya jauh lebih besar.
function repeatIntervalDays(row) {
  const unit = repeatUnit(row?.repeat);
  if (!unit) return 0;

  const step = Math.max(1, Math.round(Number(row?.repeatEvery) || 1));
  if (unit === "harian") return step;
  if (unit === "mingguan") return step * 7;
  return unit === "bulanan" ? step * 28 : step * 365;
}

// Tipe reminder. Sampai sekarang `type` cuma label yang tampil di kolom Tipe; sejak penandaan
// selesai bisa menulis baris Expenses, ia MEMUTUSKAN sesuatu — dan nilainya ditulis di satu tempat
// supaya pilihan di form (resources.js) dan pemeriksaan di `expenseFromReminder` tidak bisa
// berbeda karena salah ketik. Reminder yang tipenya salah ketik akan diam-diam berhenti mencatat
// pengeluaran, dan tidak ada apa pun di layar yang mengabarkannya.
export const PAYMENT_TYPE = "Pembayaran";
const GENERAL_TYPE = "Umum";
export const TYPE_OPTIONS = [PAYMENT_TYPE, GENERAL_TYPE];

/**
 * Pengingat yang berulang — tagihan sewa server tiap bulan, perpanjangan domain tiap tahun.
 *
 * Nilai `repeat` disimpan apa adanya seperti `status` ("Belum"/"Selesai"): yang tersimpan adalah
 * yang tertulis di dropdown, jadi tidak ada peta nama antara isi database dan isi layar.
 * "Tidak berulang" adalah nilai yang sah dan bukan ketiadaan — baris lama yang tidak punya field
 * ini sama artinya, dan keduanya ditangani `repeatUnit()` di bawah.
 */
export const NO_REPEAT = "Tidak berulang";
export const REPEAT_OPTIONS = [NO_REPEAT, "Harian", "Mingguan", "Bulanan", "Tahunan"];

// Satuan yang dikenali, dari nilai yang tersimpan. Yang tidak dikenali (baris lama, salah ketik
// lewat impor) dibaca sebagai TIDAK berulang — sebuah pengingat yang diam lebih baik daripada
// pengingat yang jatuh temponya melompat ke tempat yang tidak diminta siapa pun.
function repeatUnit(repeat) {
  const value = String(repeat || "")
    .trim()
    .toLowerCase();
  return ["harian", "mingguan", "bulanan", "tahunan"].includes(value) ? value : "";
}

export function isRepeating(row) {
  return Boolean(repeatUnit(row?.repeat));
}

/**
 * Jatuh tempo berikutnya sesudah yang sekarang dipenuhi.
 *
 * DIHITUNG DARI `dueDate`, BUKAN DARI HARI INI — dan itu inti dari siklus tagihan. Sewa yang jatuh
 * tempo tanggal 1 dan baru dibayar tanggal 20 tetap jatuh tempo tanggal 1 bulan depan; dihitung
 * dari hari pembayaran, tanggal jatuh temponya akan merayap maju tiap bulan sampai tidak ada
 * hubungannya lagi dengan tanggal tagihan aslinya.
 *
 * Tapi ia digeser BERULANG sampai benar-benar lewat hari ini. Pengingat bulanan yang terlambat
 * setengah tahun akan menghasilkan tanggal yang masih di masa lalu kalau digeser sekali — dan
 * baris yang baru ditandai selesai akan langsung menyala lagi di badge, yang terbaca sebagai
 * tombolnya tidak bekerja.
 */
export function nextDueDate(dueDate, repeat, every = 1, today = toDateKey(new Date())) {
  const unit = repeatUnit(repeat);
  // Bentuk tanggalnya diperiksa DI SINI, bukan diserahkan ke penggesernya. `shiftDateKey("bukan
  // tanggal", 1)` mengembalikan "NaN-NaN-NaN" — sebuah teks yang lolos tiap perbandingan di bawah
  // (huruf "N" lebih besar dari angka mana pun) dan akan tertulis apa adanya ke `dueDate`. Baris
  // itu lalu hilang dari badge selamanya: ia tidak pernah jatuh tempo, dan tidak ada yang
  // mengabarkan kenapa.
  if (!unit || !isDateKey(dueDate)) return "";

  const step = Math.max(1, Math.round(Number(every) || 1));
  let next = advance(dueDate, unit, step);
  // Batas putaran: `dueDate` yang bentuknya rusak membuat `advance` mengembalikan nilai yang tidak
  // pernah melewati hari ini, dan loop tanpa batas di sini membekukan tab orang.
  for (let guard = 0; guard < 500 && next && next <= today; guard += 1) {
    next = advance(next, unit, step);
  }
  return next;
}

/**
 * Yang ditulis ke baris saat tombol "tandai selesai" ditekan.
 *
 * Yang TIDAK berulang: `status: "Selesai"`, seperti sebelumnya.
 *
 * Yang berulang: barisnya TIDAK diselesaikan melainkan DIMAJUKAN — satu baris per komitmen, bukan
 * satu baris per kejadian. Alasannya daftar itu sendiri: halaman /reminders sengaja tidak punya
 * filter tanggal (lihat resources.js), jadi baris yang menumpuk tidak punya tempat sembunyi, dan
 * satu pengingat harian akan menulis 365 baris setahun ke daftar yang dibaca seluruh tim.
 *
 * Yang hilang karenanya diakui: tidak ada riwayat per kejadian. Yang menggantikannya `activityLogs`
 * (tiap penandaan tercatat berikut siapa dan kapan) dan dua field di baris ini — kapan terakhir
 * ditandai, dan jatuh tempo mana yang dipenuhinya. Yang kedua perlu karena yang pertama saja tidak
 * bisa membedakan "tagihan Agustus dibayar telat" dari "tagihan September dibayar awal".
 */
export function completionUpdate(row, today = toDateKey(new Date())) {
  const next = nextDueDate(row?.dueDate, row?.repeat, row?.repeatEvery, today);
  if (!next) return { status: "Selesai" };

  return {
    dueDate: next,
    status: "Belum",
    lastCompletedAt: today,
    lastCompletedDueDate: row?.dueDate || "",
  };
}

// "YYYY-MM-DD" yang benar-benar ada di kalender. Regex saja tidak cukup: "2026-13-99" lolos
// bentuknya lalu digulirkan JavaScript jadi tanggal lain diam-diam.
function isDateKey(value) {
  const text = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;

  const [year, month, day] = text.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

// Satu langkah. Hari dan minggu lewat penggeser tanggal yang sudah ada; bulan dan tahun tidak
// bisa — lihat catatan di `addMonths`.
function advance(dateKey, unit, step) {
  if (unit === "harian") return shiftDateKey(dateKey, step);
  if (unit === "mingguan") return shiftDateKey(dateKey, step * 7);
  if (unit === "bulanan") return addMonths(dateKey, step);
  return addMonths(dateKey, step * 12);
}

/**
 * Geser sekian bulan, dengan TANGGAL YANG DIJEPIT ke akhir bulan tujuan.
 *
 * `new Date(2026, 0, 31)` ditambah satu bulan menghasilkan 31 Februari, dan JavaScript
 * menggulirkannya diam-diam jadi 3 Maret. Tagihan tanggal 31 akan berpindah sendiri ke awal bulan
 * berikutnya, lalu tinggal di sana selamanya — 31 Jan → 3 Mar → 3 Apr → 3 Mei. Yang benar adalah
 * 28/29 Feb, lalu kembali ke 31 Mar.
 */
function addMonths(dateKey, months) {
  const [year, month, day] = String(dateKey).split("-").map(Number);
  if (!year || !month || !day) return "";

  const target = new Date(year, month - 1 + months, 1);
  // Hari ke-0 bulan BERIKUTNYA adalah hari terakhir bulan ini — cara baku menghitung panjang bulan
  // tanpa tabel kabisat sendiri.
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return toDateKey(new Date(target.getFullYear(), target.getMonth(), Math.min(day, lastDay)));
}

/**
 * Baris Expenses yang lahir dari sebuah reminder yang ditandai selesai — atau `null` kalau baris
 * itu tidak menghasilkan pengeluaran apa pun.
 *
 * Yang digabung dari Reminder dan Expenses BUKAN halamannya melainkan pengetikannya. Sewa server
 * jatuh tempo, dicentang di sini, lalu orang yang sama mengetik ulang nominal dan tanggalnya di
 * /expenses supaya ikut terhitung sebagai pengeluaran operasional di Laba Rugi. Semua yang
 * dibutuhkan baris expense sudah berdiri di baris reminder-nya.
 *
 * Tiga hal yang diputuskan di sini, dan ketiganya sengaja:
 *
 * 1. **Hanya tipe Pembayaran, dan hanya yang bernominal.** Reminder "Umum" tidak mengeluarkan uang
 *    sama sekali, dan nominal kosong bukan Rp 0 — baris expense nol akan terbaca di Laba Rugi
 *    sebagai pengeluaran yang benar-benar nol, bukan sebagai nominal yang belum diisi.
 *
 * 2. **`date` adalah HARI PEMBAYARAN, bukan `dueDate`.** Expenses adalah arus kas: tagihan yang
 *    jatuh tempo 1 Agustus tapi baru dibayar 20 Agustus adalah pengeluaran Agustus, dan Laba Rugi
 *    menjumlahkan per bulan dari field ini. Periode yang dipenuhinya tidak hilang — ia disebut di
 *    Keterangan dan disimpan mentah di `reminderDueDate`.
 *
 * 3. **ID-nya turunan, bukan push key.** `{reminderId}__{dueDate}` berarti klik ganda, retry
 *    setelah jaringan putus, atau baris berulang yang dimajukan lalu dikembalikan menulis ke
 *    alamat yang SAMA. Push key baru tiap kali akan menggandakan pengeluaran yang sama di Laba
 *    Rugi, dan itu tidak terlihat sampai totalnya diadu dengan rekening.
 */
export function expenseFromReminder(row, today = toDateKey(new Date())) {
  if (row?.type !== PAYMENT_TYPE) return null;
  if (!row?.id || !isDateKey(row?.dueDate)) return null;

  const nominal = Number(row?.nominal);
  if (!Number.isFinite(nominal) || nominal <= 0) return null;

  return {
    id: `${row.id}__${row.dueDate}`,
    values: {
      date: isDateKey(today) ? today : row.dueDate,
      itemName: String(row.title || "").trim() || "Pembayaran pengingat",
      qty: 1,
      nominal,
      // Kolom turunan di form Expenses (nominal × qty). Ditulis di sini juga supaya baris ini
      // tidak bergantung pada cabang fallback `expenseTotal` untuk baris lama.
      total: nominal,
      note: expenseNote(row),
      // Jejak balik ke reminder-nya. Bukan untuk dibaca kode mana pun hari ini — untuk orang yang
      // menemukan baris ini di /expenses dan bertanya dari mana ia datang.
      reminderId: row.id,
      reminderDueDate: row.dueDate,
    },
  };
}

// Keterangan reminder tetap dibawa; asal-usulnya ditambahkan, tidak menggantikannya.
function expenseNote(row) {
  const origin = `Dari pengingat "${row.title}" (jatuh tempo ${row.dueDate})`;
  const note = String(row?.note || "").trim();
  return note ? `${note} — ${origin}` : origin;
}
