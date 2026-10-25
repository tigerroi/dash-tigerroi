// Filter periode untuk tabel yang menyimpan riwayat harian: ROI per subdomain, ROI per negara.
//
// Baris tanpa tanggal yang terbaca tetap ditampilkan. Menyaringnya keluar berarti data hasil impor
// atau input tangan menghilang dari tabel tanpa ada yang mengatakan kenapa — dan "tidak punya
// tanggal" bukan alasan untuk menganggapnya tidak ada.

// Pilihan "Hari Ini" tabel ROI: yang dicari orang tiap membuka dashboard adalah keadaan sekarang.
// Menyaring lewat hari partial TERBARU (`runningDayKey`), bukan "semua yang partial" — baris snapshot
// bertahan beberapa hari dan semuanya bertanda partial.
// Baris hari berjalan: angkanya masih bergerak, dan sisi sync yang memberi tahu — bukan tanggalnya.
export function isPartialRow(item) {
  return item?.partial === true;
}

export function filterRunningDay(items, now = new Date()) {
  const rows = Array.isArray(items) ? items : [];
  const runningKey = runningDayKey(rows, now);
  return rows.filter((item) => {
    const date = parseDateLike(item?.date || item?.reportDate || item?.createdAt || item?.syncedAt);
    return date ? toDateKey(date) === runningKey : true;
  });
}

/**
 * Hari mana yang "hari ini" untuk baris-baris ini — hari operasi (WIB), bukan hari browser.
 *
 * Dibaca dari tanggal baris bertanda `partial` yang PALING BARU. Tanda itu ditulis sisi sync untuk
 * hari yang sedang berjalan menurut zona operasi, jadi klien yang zonanya bukan Asia/Jakarta tetap
 * melihat hari yang sama dengan dashboard-nya.
 *
 * Yang diambil hanya yang paling baru, bukan semua baris partial. Sejak baris ROI hari berjalan
 * disimpan per sync (`dashboard/roiSnapshots`, masa simpan beberapa hari), baris partial dari
 * kemarin dan lusa masih ada di daftar — "semua yang partial" akan menumpuk tiga hari snapshot ke
 * dalam pilihan yang berbunyi "Hari Ini".
 *
 * Tanpa satu pun baris partial (tabel yang isinya hasil input tangan), jam browser yang dipakai:
 * itu satu-satunya yang tersisa, dan tabel seperti itu tidak punya hari operasi untuk dibaca.
 *
 * Diekspor karena Kalender memakainya juga: petak "hari ini", batas "potensi", dan hari yang tidak
 * boleh jadi sampel median semuanya bertanya hal yang sama — hari operasi mana yang sedang
 * berjalan — dan menjawabnya dari `new Date()` berarti browser di zona lain menandai petak yang
 * berbeda dari yang ditandai sisi sync.
 */
export function runningDayKey(rows, now = new Date()) {
  let latest = "";
  for (const item of rows) {
    if (!isPartialRow(item)) continue;
    const key = rowDayKey(item);
    if (key > latest) latest = key;
  }
  return latest || toDateKey(startOfDay(now));
}

function rowDayKey(item) {
  const date = parseDateLike(item?.date || item?.reportDate || item?.createdAt || item?.syncedAt);
  return date ? toDateKey(date) : "";
}

/**
 * Apakah baris ini milik hari yang SEDANG berjalan — tanda `partial` DAN tanggalnya hari berjalan
 * (`runningDayKey`). Tanda saja tidak cukup: baris harian yang ditulis sebagai hari berjalan lalu
 * tidak pernah ditulis ulang (subdomainnya tidak muncul lagi di laporan final hari itu) membeku
 * bertanda `partial: true` selamanya. Dibaca dari tandanya saja, satu baris begitu membuat seluruh
 * 20 Agu berlabel "berjalan" di Kalender pada pertengahan September, dan hari itu dibuang dari
 * sampel "potensi".
 */
export function isRunningRow(item, runningDay) {
  return isPartialRow(item) && Boolean(runningDay) && rowDayKey(item) === runningDay;
}

export function parseDateLike(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return startOfDay(value);
  }

  if (typeof value === "object") {
    if (typeof value.toDate === "function") {
      return startOfDay(value.toDate());
    }
    if (typeof value.seconds === "number") {
      return startOfDay(new Date(value.seconds * 1000));
    }
    if (typeof value._seconds === "number") {
      return startOfDay(new Date(value._seconds * 1000));
    }
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value < 10000000000 ? value * 1000 : value;
    return startOfDay(new Date(ms));
  }

  const text = String(value).trim();
  const isoMatch = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);

  if (isoMatch) {
    return startOfDay(new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3])));
  }

  const localMatch = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);

  if (localMatch) {
    return startOfDay(
      new Date(Number(localMatch[3]), Number(localMatch[2]) - 1, Number(localMatch[1])),
    );
  }

  if (/^\d{10,13}$/.test(text)) {
    const num = Number(text);
    const ms = num < 10000000000 ? num * 1000 : num;
    return startOfDay(new Date(ms));
  }

  const parsed = new Date(text);

  return Number.isNaN(parsed.getTime()) ? null : startOfDay(parsed);
}

// "YYYY-MM-DD" dari tanggal lokal — bukan toISOString(), yang menggeser tanggal di GMT+7.
export function toDateKey(date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

// Geser sebuah kunci tanggal ISO sekian hari. Lewat Date, bukan aritmetika teks: "2026-08-31" + 1
// harus jadi "2026-09-01", dan bulan/tahun yang berganti sendiri adalah satu-satunya alasan fungsi
// ini tidak boleh ditulis sebagai penambahan angka pada dua digit terakhir.
//
// Yang diberi kunci yang bentuknya rusak mengembalikan "NaN-NaN-NaN" — teks yang lolos tiap
// perbandingan tanggal (huruf "N" lebih besar dari angka mana pun). Pemanggil memeriksa bentuk
// masukannya sendiri; lihat `nextDueDate` di lib/reminders.js, yang menolak sebelum sampai sini.
export function shiftDateKey(dateKey, days) {
  const [year, month, day] = String(dateKey).split("-").map(Number);
  return toDateKey(new Date(year, month - 1, day + days));
}

function shiftDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/**
 * Preset rentang tanggal untuk DateRangePicker — sama daftar & label dengan pemilih tanggal
 * Ads Manager yang jadi acuan. Semua dihitung dari `now` (bukan konstanta modul) supaya tab yang
 * dibiarkan terbuka melewati tengah malam tidak menawarkan "hari ini" yang sudah basi.
 *
 * Batas `from`/`to` berbentuk ISO `YYYY-MM-DD` (kosong = tak berbatas), persis yang dimengerti
 * `filterByDateField`. Minggu dimulai Minggu, mengikuti kolom kalendernya (Min–Sab).
 */
export function datePresets(now = new Date()) {
  const today = startOfDay(now);
  const k = toDateKey;
  const weekStart = shiftDays(today, -today.getDay());
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const prevMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const prevMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);
  return [
    { id: "today", label: "Hari Ini", from: k(today), to: k(today) },
    {
      id: "yesterday",
      label: "Kemarin",
      from: k(shiftDays(today, -1)),
      to: k(shiftDays(today, -1)),
    },
    {
      id: "today-yesterday",
      label: "Hari ini dan kemarin",
      from: k(shiftDays(today, -1)),
      to: k(today),
    },
    { id: "last7", label: "7 hari terakhir", from: k(shiftDays(today, -6)), to: k(today) },
    { id: "last14", label: "14 hari terakhir", from: k(shiftDays(today, -13)), to: k(today) },
    { id: "last28", label: "28 hari terakhir", from: k(shiftDays(today, -27)), to: k(today) },
    { id: "last30", label: "30 hari terakhir", from: k(shiftDays(today, -29)), to: k(today) },
    { id: "this-week", label: "Minggu ini", from: k(weekStart), to: k(today) },
    {
      id: "last-week",
      label: "Minggu lalu",
      from: k(shiftDays(weekStart, -7)),
      to: k(shiftDays(weekStart, -1)),
    },
    { id: "this-month", label: "Bulan ini", from: k(monthStart), to: k(today) },
    { id: "last-month", label: "Bulan lalu", from: k(prevMonthStart), to: k(prevMonthEnd) },
    { id: "all", label: "Semua tanggal", from: "", to: "" },
  ];
}

// Preset yang persis cocok dengan rentang ini, atau null kalau rentangnya kustom. "Semua tanggal"
// (kedua batas kosong) sengaja ikut cocok — itu keadaan default filter yang belum disentuh.
export function matchDatePreset(from, to, now = new Date()) {
  return datePresets(now).find((p) => p.from === (from || "") && p.to === (to || "")) || null;
}

// Rentang "bulan ini" — tanggal 1 sampai hari ini, dalam bentuk yang dimengerti <input type="date">.
// Dihitung dari `now` yang diberikan, bukan dari konstanta modul, supaya tab yang dibiarkan terbuka
// melewati pergantian bulan tidak menawarkan bulan kemarin sebagai "bulan ini".
export function currentMonthRange(now = new Date()) {
  return {
    from: toDateKey(new Date(now.getFullYear(), now.getMonth(), 1)),
    to: toDateKey(now),
  };
}

// Saring menurut satu kolom tanggal dengan batas dari/sampai yang masing-masing boleh kosong —
// kosong berarti tak berbatas, jadi mengosongkan kedua kotak mengembalikan seluruh daftar.
//
// Dibandingkan lewat toDateKey, bukan teks mentahnya: baris hasil impor lama bisa tersimpan sebagai
// "31/07/2026", yang kalau diadu string dengan "2026-08-01" akan selalu kalah.
//
// Baris yang tanggalnya tidak terbaca tetap lolos, sama seperti filterByDateRange di atas. Itu juga
// yang membuat angka ringkasan selalu sama dengan jumlah baris yang benar-benar tampil di tabel.
export function filterByDateField(items, field, { from = "", to = "" } = {}) {
  const rows = Array.isArray(items) ? items : [];

  if (!from && !to) {
    return rows;
  }

  return rows.filter((item) => {
    const date = parseDateLike(item?.[field]);
    if (!date) {
      return true;
    }

    const key = toDateKey(date);
    return (!from || key >= from) && (!to || key <= to);
  });
}

// Rentang "hari ini" sebagai { from, to } — default DateRangePicker pada tabel realtime (ROI Master,
// ROI per Negara, ROI Realtime Overview). Menggantikan RUNNING_RANGE di pemilih itu: sekarang semua
// pemilih tanggal dashboard berbicara {from,to} yang sama, dan "hari ini" cukup rentang satu hari.
export function todayRange(now = new Date()) {
  const key = toDateKey(startOfDay(now));
  return { from: key, to: key };
}

// Saring menurut rentang {from,to} pada tabel yang tanggalnya bisa datang di beberapa nama kolom
// (date/reportDate/createdAt/syncedAt) — sama seperti filterByDateRange, tapi digerakkan pemilih
// tanggal {from,to} alih-alih string preset. Baris tanpa tanggal terbaca tetap lolos, sama dengan
// filterByDateField. Kosong-kedua-batas = seluruh daftar.
export function filterByDateWindow(items, { from = "", to = "" } = {}) {
  const rows = Array.isArray(items) ? items : Object.values(items || {});
  if (!from && !to) return rows;
  return rows.filter((item) => {
    const rawDate =
      item?.date ||
      item?.tanggal ||
      item?.reportDate ||
      item?.createdAt ||
      item?.syncedAt ||
      item?.spendDate ||
      item?.periodDate ||
      item?.timestamp;
    const date = parseDateLike(rawDate);
    if (!date) return true;
    const key = toDateKey(date);
    return (!from || key >= from) && (!to || key <= to);
  });
}

// --- Bulan kalender, untuk pemilih periode grafik ----------------------------------------------
//
// Grafik "Pendapatan vs Pengeluaran" disaring dengan dua kotak tanggal. Itu tepat untuk rentang
// yang tidak biasa, tapi yang hampir selalu dicari orang adalah sebuah bulan — dan mengetik
// "2026-07-01" lalu "2026-07-31" dua kali sehari adalah pekerjaan yang tidak perlu ada. Fungsi di
// bawah menerjemahkan sebuah bulan ke rentang yang sama, jadi kotak tanggalnya tetap satu-satunya
// sumber kebenaran dan rentang yang diketik tangan tidak perlu diperlakukan khusus.

// "2026-08" dari sebuah tanggal ISO yang sudah berbentuk teks ("2026-08-08"). Berdiri di sini
// dan bukan di salah satu pemakainya karena yang membacanya tiga halaman yang tidak saling
// mengimpor (Laba Rugi, Invalid Traffic, Target) — dan bulan sebuah baris ROI yang dipotong dengan
// dua aturan berbeda adalah cara satu halaman diam-diam menjumlahkan bulan yang lain.
export function monthKey(dateStr) {
  return String(dateStr || "").slice(0, 7);
}

// "2026-08" dari sebuah Date, menurut jam lokal — sama seperti toDateKey, bukan UTC.
export function monthKeyOf(date) {
  return toDateKey(date).slice(0, 7);
}

// Geser kunci bulan. Dihitung lewat Date supaya "2026-01" mundur satu menjadi "2025-12".
export function shiftMonthKey(key, months) {
  const [year, month] = String(key || "")
    .split("-")
    .map(Number);
  if (!year || !month) return "";
  return monthKeyOf(new Date(year, month - 1 + months, 1));
}

/**
 * Rentang satu bulan kalender sebagai `{ from, to }` siap dipakai `<input type="date">`.
 *
 * Bulan berjalan berhenti di HARI INI, bukan di akhir bulan: meminta grafik sampai tanggal yang
 * belum terjadi hanya menambah ruang kosong di sebelah kanan, dan garis yang jatuh ke nol di sana
 * terbaca seperti kehilangan data.
 */
export function monthRange(key, now = new Date()) {
  const [year, month] = String(key || "")
    .split("-")
    .map(Number);
  if (!year || !month) return { from: "", to: "" };
  const first = new Date(year, month - 1, 1);
  // Tanggal 0 bulan berikutnya = hari terakhir bulan ini, tanpa perlu tahu panjang bulannya.
  const last = new Date(year, month, 0);
  const today = startOfDay(now);
  return {
    from: toDateKey(first),
    to: toDateKey(last > today && first <= today ? today : last),
  };
}

/**
 * Kunci bulan yang benar-benar punya data, terbaru dulu, plus bulan berjalan.
 *
 * Diturunkan dari datanya sendiri, bukan dari daftar bulan yang dikarang: sebuah pilihan "Juni"
 * yang menghasilkan grafik kosong adalah jebakan yang sama dengan pilihan "Today" yang dulu selalu
 * mengosongkan tabel ROI. Bulan berjalan selalu ikut supaya defaultnya selalu bisa dipilih kembali
 * walau sync hari ini belum menulis satu titik pun.
 */
export function monthKeysOf(items, now = new Date()) {
  const keys = new Set([monthKeyOf(startOfDay(now))]);
  for (const item of Array.isArray(items) ? items : []) {
    const date = parseDateLike(item?.date || item?.periodDate || item?.reportDate);
    if (date) keys.add(monthKeyOf(date));
  }
  return [...keys].sort().reverse();
}

/**
 * Label pilihan bulan: dua yang teratas dinamai relatif, sisanya pakai nama bulannya.
 *
 * "Bulan Lalu" hanya untuk bulan yang memang tepat sebelum bulan berjalan — kalau data bulan lalu
 * tidak ada, pilihan kedua adalah bulan lain dan menamainya "Bulan Lalu" akan berbohong.
 */
export function monthLabelOf(monthKey, monthName, now = new Date()) {
  const current = monthKeyOf(startOfDay(now));
  if (monthKey === current) return `Bulan Ini (${monthName})`;
  if (monthKey === shiftMonthKey(current, -1)) return `Bulan Lalu (${monthName})`;
  return monthName;
}

/* --- Periode sebagai RENTANG ------------------------------------------------------------------

   Dipakai halaman yang laporannya berdiri di atas satu periode dan bukan satu tanggal — Laba Rugi
   dan Cash Flow. Keduanya digerakkan `DateRangePicker` yang sama dengan seluruh dashboard, jadi
   aturan "periode mana yang memuat baris mana" tinggal di sini bersama aturan tanggal lainnya, bukan
   di salah satu modul laporannya: disalin, dua tab yang bersebelahan di kepala halaman yang sama
   akan menjawab berbeda untuk rentang yang sama. */

// Batas rentang sebagai ISO `YYYY-MM-DD`, atau "" untuk yang tidak berbentuk tanggal. Dipotong dan
// bukan diurai `new Date()`: "2026-08" telanjang diurai sebagai tengah malam UTC, yang di zona
// negatif mundur ke Juli.
export function dateKeyOf(value) {
  const key = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : "";
}

// Panjang rentang dalam hari, kedua ujungnya ikut. Dihitung dari tengah malam WAKTU LOKAL di kedua
// sisi (lihat `dayOf`), jadi ia tidak pernah terpeleset karena musim panas di zona mana pun.
export function daysInclusive(from, to) {
  if (!from || !to || to < from) return 0;
  return Math.round((dayOf(to) - dayOf(from)) / DAY_MS) + 1;
}

// Baris bertanggal yang jatuh di dalam rentang. Batas yang kosong berarti tak berbatas — bentuk yang
// sama dengan `filterByDateField` di atas — tapi baris yang tanggalnya TIDAK terbaca dibuang, bukan
// diloloskan: di sana ia satu baris tabel yang hilang dari pandangan, di sini ia uang yang ikut
// dijumlah ke periode ini DAN ke periode pembandingnya sekaligus.
export function rowsInRange(rows, { from = "", to = "" } = {}) {
  return (Array.isArray(rows) ? rows : Object.values(rows || {})).filter((row) => {
    const key = dateKeyOf(row?.date);
    if (!key) return false;
    return (!from || key >= from) && (!to || key <= to);
  });
}

/**
 * Bulan-bulan yang DITUTUP PENUH oleh rentang ini, terurut.
 *
 * Dua sumber di rantai Laba Rugi berdiri per bulan dan tidak bisa dibelah per hari: nominal invalid
 * traffic (tiga hasil pengecekan, satu lump sum) dan earning akun yang ditutup (satu angka bulanan).
 * Rentang yang memotong sebuah bulan di tengah tidak punya cara membaginya, dan ketiga jawaban yang
 * mungkin tidak setara:
 *
 *   dibagi rata per hari      presisi yang dikarang — invalid traffic tidak datang harian
 *   ikut kalau bersinggungan  rentang 7 hari menanggung invalid traffic sebulan penuh, dan net
 *                             profit-nya minus karena rentangnya, bukan karena usahanya
 *   ikut kalau bulannya utuh  angkanya tidak pernah salah tempat; yang tidak ikut DISEBUTKAN
 *
 * Yang ketiga yang dipakai. Preset "Bulan lalu" menutup bulannya persis, jadi pemakaian yang paling
 * sering tetap memuat keduanya; "Bulan ini" (tanggal 1 sampai hari ini) tidak — dan itu justru
 * benar, karena kedua angka itu memang baru diinput setelah bulannya selesai.
 */
export function wholeMonthsIn({ from = "", to = "" } = {}) {
  if (!from || !to || from > to) return [];

  const months = [];
  const cursor = dayOf(`${from.slice(0, 7)}-01`);
  const last = dayOf(to);
  while (cursor <= last) {
    const key = toDateKey(cursor).slice(0, 7);
    const end = toDateKey(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0));
    if (`${key}-01` >= from && end <= to) months.push(key);
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return months;
}

/**
 * Bulan yang PUNYA baris bulanan dan bersinggungan dengan rentang, tapi tidak tertutup penuh — jadi
 * angkanya tidak ikut. Bukan hiasan: potongan yang diam-diam hilang terbaca sebagai laba yang lebih
 * besar, dan tidak ada apa pun di layar yang bisa menjelaskannya.
 *
 * Yang tidak punya barisnya sama sekali tidak disebut. Bulan berjalan hampir selalu begitu, dan
 * peringatan yang menyala tiap hari untuk keadaan yang normal berhenti dibaca dalam sepekan.
 */
export function partialMonthsIn(range, sources) {
  const period = { from: dateKeyOf(range?.from), to: dateKeyOf(range?.to) };
  const whole = new Set(wholeMonthsIn(period));
  const months = new Set();

  for (const { rows, monthOf } of sources || []) {
    for (const row of rows || []) {
      const key = monthOf(row);
      if (!/^\d{4}-\d{2}$/.test(key) || whole.has(key)) continue;
      // Bersinggungan dengan rentangnya — bulan di luar periode memang bukan urusan layar ini.
      const [year, month] = key.split("-").map(Number);
      const end = toDateKey(new Date(year, month, 0));
      if ((!period.to || `${key}-01` <= period.to) && (!period.from || end >= period.from)) {
        months.add(key);
      }
    }
  }

  return [...months].sort();
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Kunci ISO sebagai Date tengah malam WAKTU LOKAL. `new Date("2026-08-01")` diurai sebagai UTC, dan
// di zona negatif ia mundur sehari.
function dayOf(key) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}
