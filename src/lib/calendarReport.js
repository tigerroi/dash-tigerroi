import { earningSources, roiPercent, withAdTax } from "./adTax.js";
import { cellText } from "./cellText.js";
import { isRunningRow, runningDayKey, shiftDateKey, toDateKey } from "./dateRange.js";
import { round } from "./numbers.js";
import { toAmount } from "./toAmount.js";

/**
 * Kalender laporan: satu sel = satu HARI OPERASI, dan seluruh isinya diturunkan di sini.
 *
 * Sumbernya `dashboard/roiReports` — baris HARIAN, satu per subdomain per hari — dan bukan
 * `roiSnapshots`. Baris snapshot kumulatif sejak tengah malam (lihat CLAUDE.md): satu subdomain
 * bisa punya sepuluh baris pada hari yang sama, dan menjumlahkannya melaporkan pendapatan
 * berkali lipat untuk hari yang sama. Yang menjumlahkan uang membaca baris harian; yang
 * menampilkan keadaan sekarang membaca snapshot, dan itu tab sebelah.
 *
 * ═══ YANG TIDAK DIKETAHUI TIDAK PERNAH JADI NOL, TERMASUK DI TINGKAT HARI ═══
 *
 * `withAdTax` sudah menegakkan aturan itu per baris. Yang mudah hilang justru di tingkat hari:
 * sebuah hari yang SELURUH laporan earning-nya gagal akan berjumlah 0, dan 0 dibagi spend yang
 * nyata berbunyi "ROI −100%" — tak terbedakan dari hari yang benar-benar rugi total. Jadi hari
 * tanpa satu pun baris berearning mengembalikan `""`, bukan 0, dan selnya menggambar "-".
 *
 * Yang dilewati tetap DIHITUNG (`earningUnknown`, `spendUnknown`, `unmapped`, `unavailable`):
 * itulah yang membuat sel bisa menyebut kenapa angkanya lebih kecil dari yang diingat orang,
 * alih-alih menyerahkannya pada dugaan.
 */

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

function isDayKey(value) {
  return DAY_KEY.test(String(value || ""));
}

// Hari dalam minggu (0 = Minggu) dari kunci ISO, lewat Date LOKAL. `new Date("2026-08-01")`
// diurai sebagai UTC dan di GMT+7 jatuh ke hari sebelumnya — kolom yang meleset satu petak.
function weekdayOf(dayKey) {
  const [year, month, day] = String(dayKey).split("-").map(Number);
  return new Date(year, month - 1, day).getDay();
}

/**
 * Petak satu bulan, Minggu–Sabtu, berikut hari-hari bulan tetangga yang menutup baris pertama dan
 * terakhir — persis kalender yang jadi acuan.
 *
 * Hari tetangga digambar, bukan dikosongkan: sel kosong di ujung baris terbaca seperti hari yang
 * datanya hilang, sementara "31" pucat di petak pertama terbaca sebagai apa adanya. `inMonth` yang
 * membedakan keduanya, dan yang menjumlahkan bulan hanya membaca yang `inMonth`.
 */
export function monthCells(monthKey) {
  const [year, month] = String(monthKey || "")
    .split("-")
    .map(Number);
  if (!year || !month || month < 1 || month > 12) return [];

  const first = new Date(year, month - 1, 1);
  // Tanggal 0 bulan berikutnya = hari terakhir bulan ini, tanpa perlu tahu panjang bulannya.
  const lastDate = new Date(year, month, 0).getDate();
  const lead = first.getDay();
  const weeks = Math.ceil((lead + lastDate) / 7);
  const cells = [];

  for (let index = 0; index < weeks * 7; index += 1) {
    const date = new Date(year, month - 1, 1 - lead + index);
    cells.push({
      key: toDateKey(date),
      day: date.getDate(),
      weekday: date.getDay(),
      inMonth: date.getMonth() === month - 1 && date.getFullYear() === year,
    });
  }

  return cells;
}

/**
 * Ringkasan per hari dari baris ROI harian: `Map<"YYYY-MM-DD", ringkasan>`.
 *
 * Uangnya lewat `withAdTax` — satu-satunya tempat ROI dihitung di sisi UI — jadi kalender, tabel
 * ROI, dan grafik tidak bisa melaporkan tiga angka berbeda untuk uang yang sama.
 *
 * Earning dan spend dijumlahkan MASING-MASING dari baris yang mengetahuinya, sama seperti
 * `aggregateRoiFinancials` di grafik Overview: subdomain yang laporan GAM-nya gagal tetap
 * menyumbang spend-nya (uang itu benar-benar keluar), dan subdomain tanpa campaign Meta tetap
 * menyumbang earning-nya (uang itu benar-benar masuk). Yang dilewati adalah SEL-nya, bukan
 * barisnya.
 */
export function dailySummaries(rows, rate, { runningDay } = {}) {
  const byDate = new Map();
  const list = Array.isArray(rows) ? rows : [];
  // Hari berjalan dari pemanggil (Kalender memberinya dari roiReports yang BELUM disaring); tanpa
  // itu dibaca dari baris yang ada. Yang TIDAK boleh adalah "baris mana pun yang bertanda partial":
  // lihat `isRunningRow`.
  const running = runningDay || runningDayKey(list);

  for (const row of list) {
    const date = cellText(row?.date);
    if (!isDayKey(date)) continue;

    let day = byDate.get(date);
    if (!day) {
      day = emptyDay(date);
      byDate.set(date, day);
    }

    const money = withAdTax(row, rate);
    const sources = earningSources(row);
    const name = cellText(row?.subDomain);

    day.rows += 1;
    if (name) day.names.add(name);
    // Subdomain yang angkanya tidak utuh, sebagai HIMPUNAN dan bukan sebagai jumlah dua penghitung
    // di bawah: satu subdomain yang kehilangan earning DAN spend akan terhitung dua kali, dan
    // lencana "⚠ 2" untuk satu subdomain bermasalah adalah angka yang berbohong ke arah yang
    // membuat orang mencari baris yang tidak ada.
    if (!money.earningKnown || !money.spendingKnown) day.incomplete.add(name);
    // Hari berjalan dibaca dari TANDA di baris, bukan dari tanggalnya dibanding jam browser:
    // "hari ini" di browser yang zonanya bukan WIB adalah hari yang berbeda. Tanda yang tertinggal
    // di hari yang sudah lewat tidak dihitung.
    if (isRunningRow(row, running)) day.partial = true;

    if (money.earningKnown) {
      day.earning += money.earning;
      day.earningRows += 1;
      day.gam += sources.gam;
      day.adsense += sources.adsense;
      day.clicks += toAmount(row?.clicks);
      day.impressions += toAmount(row?.impressions);
    } else {
      day.earningUnknown += 1;
    }

    if (money.spendingKnown) {
      day.spending += money.spending;
      day.adTax += money.adTax;
      day.totalSpending += money.totalSpending;
      day.spendRows += 1;
    } else {
      day.spendUnknown += 1;
      // Dua sebab yang menuntut tindakan berbeda: yang pertama diperbaiki di /sub-domains
      // (campaign belum dipetakan), yang kedua di sync-nya. Sel yang cuma berbunyi "5 tanpa
      // spend" mengirim orang ke tempat yang salah separuh waktu.
      const reason = cellText(row?.metaMissing);
      if (reason === "unmapped") day.unmapped += 1;
      else if (reason === "unavailable") day.unavailable += 1;
    }
  }

  for (const [key, day] of byDate) byDate.set(key, sealDay(day));

  return byDate;
}

function emptyDay(date) {
  return {
    date,
    rows: 0,
    names: new Set(),
    incomplete: new Set(),
    partial: false,
    earning: 0,
    earningRows: 0,
    earningUnknown: 0,
    gam: 0,
    adsense: 0,
    clicks: 0,
    impressions: 0,
    spending: 0,
    adTax: 0,
    totalSpending: 0,
    spendRows: 0,
    spendUnknown: 0,
    unmapped: 0,
    unavailable: 0,
  };
}

function sealDay(day) {
  const earningKnown = day.earningRows > 0;
  const spendingKnown = day.spendRows > 0;
  const known = earningKnown && spendingKnown;
  const { names, incomplete, ...rest } = day;

  return {
    ...rest,
    subDomains: names.size,
    incompleteSubDomains: incomplete.size,
    earningKnown,
    spendingKnown,
    earning: earningKnown ? round(day.earning) : "",
    gam: earningKnown ? round(day.gam) : "",
    adsense: earningKnown ? round(day.adsense) : "",
    spending: spendingKnown ? round(day.spending) : "",
    adTax: spendingKnown ? round(day.adTax) : "",
    totalSpending: spendingKnown ? round(day.totalSpending) : "",
    // Profit dan ROI perlu KEDUA sisinya, alasan yang sama persis dengan `withAdTax`: "earning
    // dikurangi nol" adalah klaim bahwa hari itu tidak mengeluarkan biaya sepeser pun.
    profit: known ? round(day.earning - day.totalSpending) : "",
    roi: known ? roiPercent(day.earning, day.totalSpending) : "",
  };
}

/**
 * Baseline per HARI DALAM MINGGU, dari riwayat: inilah "potensi" yang digambar di sel.
 *
 * MEDIAN, bukan rata-rata. Satu hari anomali — campaign baru menyala, laporan GAM setengah gagal,
 * satu subdomain viral — menggeser rata-rata dan tidak pernah kembali; median mengabaikannya
 * begitu ia jadi minoritas, dan itu justru yang dicari dari sebuah angka bernama "biasanya".
 *
 * Yang TIDAK boleh jadi sampel:
 *   - hari bertanda `partial` — setengah hari yang dibandingkan dengan hari penuh
 *   - hari yang earning-nya tidak diketahui — bukan hari sepi, melainkan hari yang laporannya gagal
 *   - hari `asOf` sendiri dan sesudahnya — hari yang sedang dinilai tidak boleh ikut menilai
 *
 * Kurang dari `minSamples` → `null`, dan sel yang menerimanya tidak menggambar apa pun. Angka
 * "biasanya" yang lahir dari dua hari bukan biasanya; ia cuma tebakan yang memakai huruf yang sama.
 *
 * Sengaja TIDAK ada proyeksi akhir hari dari bentuk kurva intraday. Bahannya cuma `roiSnapshots`,
 * yang masa simpannya 3 hari (`ROI_SNAPSHOT_DAYS`) — dua hari penuh sebagai sampel — dan angka
 * yang digambar sebesar angka nyata di sel yang sama, lahir dari dua sampel, adalah tebakan yang
 * berpakaian seperti fakta.
 */
export function weekdayBaselines(summaries, { asOf, weeks = 8, minSamples = 4 } = {}) {
  const buckets = Array.from({ length: 7 }, () => ({ earning: [], spend: [], roi: [] }));
  if (!isDayKey(asOf)) return buckets.map(() => null);

  const from = shiftDateKey(asOf, -weeks * 7);

  for (const day of iterate(summaries)) {
    if (!isDayKey(day?.date) || day.date >= asOf || day.date < from) continue;
    if (day.partial || !day.earningKnown) continue;

    const bucket = buckets[weekdayOf(day.date)];
    bucket.earning.push(day.earning);
    if (day.spendingKnown) bucket.spend.push(day.totalSpending);
    if (day.roi !== "") bucket.roi.push(day.roi);
  }

  return buckets.map((bucket) =>
    bucket.earning.length >= minSamples
      ? {
          earning: median(bucket.earning),
          totalSpending: median(bucket.spend),
          roi: median(bucket.roi),
          samples: bucket.earning.length,
        }
      : null,
  );
}

// Median dari sekumpulan angka; "" untuk daftar kosong — bukan 0, yang akan tampil sebagai
// "biasanya tidak menghasilkan apa-apa".
export function median(values) {
  const sorted = [...(values || [])]
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  if (!sorted.length) return "";

  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? round(sorted[middle])
    : round((sorted[middle - 1] + sorted[middle]) / 2);
}

/**
 * Satu bulan siap gambar: petaknya, ringkasan tiap hari, reminder yang jatuh tempo di sana, dan
 * potensinya.
 *
 * POTENSI HANYA UNTUK HARI INI DAN SESUDAHNYA. Hari lampau sudah punya angka nyata, dan dua angka
 * berdampingan di sel yang sama akan dibaca sebagai perbandingan — "kemarin seharusnya Rp 8jt"
 * adalah kalimat yang tidak menghasilkan tindakan apa pun dan tidak diminta siapa pun.
 */
export function buildCalendarMonth({
  monthKey,
  roiReports = [],
  reminders = [],
  rate,
  now = new Date(),
  // Hari operasi yang sedang berjalan (WIB), bukan tanggal di jam browser. Pemanggil membacanya
  // dari baris bertanda `partial` lewat `runningDayKey` — aturan yang sama dengan pilihan "Hari
  // Ini" di tabel ROI. Jatuh ke jam browser hanya kalau tidak ada satu pun baris berjalan untuk
  // dibaca, karena di situ memang tidak ada hari operasi yang bisa ditanyakan.
  today = toDateKey(now),
  weeks = 8,
  minSamples = 4,
}) {
  const summaries = dailySummaries(roiReports, rate, { runningDay: today });
  const baselines = weekdayBaselines(summaries, { asOf: today, weeks, minSamples });
  const dueByDay = remindersByDay(reminders);

  const days = monthCells(monthKey).map((cell) => ({
    ...cell,
    isToday: cell.key === today,
    isFuture: cell.key > today,
    summary: summaries.get(cell.key) || null,
    reminders: dueByDay.get(cell.key) || [],
    potential: cell.key >= today ? baselines[cell.weekday] : null,
  }));
  const ranks = roiRanking(days);

  return {
    days: days.map((day) => ({ ...day, rank: ranks.get(day.key) || 0 })),
    totals: monthTotals(days),
  };
}

/**
 * Tiga hari ber-ROI tertinggi BULAN INI, sebagai peringkat 1–3 (`Map<kunci hari, peringkat>`).
 *
 * Hanya hari milik bulan yang sedang digambar: hari tetangga di baris pertama dan terakhir
 * dipinjam dari bulan lain, dan medali untuk 31 Juli di halaman Agustus adalah peringkat dari
 * lomba yang tidak sedang berlangsung.
 *
 * Hanya hari yang ROI-nya ADA. Sejak `roiPercent` punya lantai belanja, hari yang membelanjakan
 * Rp 43 tidak lagi bisa menang dengan +355.456% — dan itu justru yang membuat peringkat ini bisa
 * dipercaya sama sekali.
 *
 * Hari berjalan IKUT diperingkat. ROI-nya rasio yang sah walau harinya belum selesai, dan petaknya
 * sudah menyebut "berjalan" tepat di sebelah medalinya; mengeluarkannya berarti hari yang sedang
 * memimpin justru satu-satunya yang tidak terlihat memimpin.
 *
 * Seri dipecah lewat tanggal (yang lebih awal menang) supaya urutannya tidak berpindah-pindah
 * antar render untuk data yang sama.
 */
export function roiRanking(days, top = 3) {
  const ranked = (days || [])
    .filter((day) => day?.inMonth && day.summary && day.summary.roi !== "")
    .sort(
      (left, right) => right.summary.roi - left.summary.roi || left.key.localeCompare(right.key),
    )
    .slice(0, top);

  return new Map(ranked.map((day, index) => [day.key, index + 1]));
}

// Total sebulan, dari hari-hari milik bulan itu saja — hari tetangga yang ikut digambar di baris
// pertama dan terakhir adalah milik bulan lain, dan menjumlahkannya membuat Agustus memuat dua
// hari Juli.
export function monthTotals(days) {
  const total = {
    earning: 0,
    totalSpending: 0,
    earningDays: 0,
    spendDays: 0,
    earningUnknown: 0,
    spendUnknown: 0,
  };

  for (const day of days || []) {
    const summary = day?.inMonth ? day.summary : null;
    if (!summary) continue;

    total.earningUnknown += summary.earningUnknown;
    total.spendUnknown += summary.spendUnknown;
    if (summary.earningKnown) {
      total.earning += summary.earning;
      total.earningDays += 1;
    }
    if (summary.spendingKnown) {
      total.totalSpending += summary.totalSpending;
      total.spendDays += 1;
    }
  }

  const known = total.earningDays > 0 && total.spendDays > 0;

  return {
    ...total,
    earning: total.earningDays ? round(total.earning) : "",
    totalSpending: total.spendDays ? round(total.totalSpending) : "",
    profit: known ? round(total.earning - total.totalSpending) : "",
    roi: known ? roiPercent(total.earning, total.totalSpending) : "",
  };
}

/**
 * Reminder yang jatuh tempo pada tiap tanggal.
 *
 * Ini SENGAJA bukan `dueReminders` (lib/reminders.js). Yang itu menjawab "apa yang perlu
 * diperhatikan sekarang" — jatuh tempo hari ini plus jendela antisipasi, dan yang sudah lewat ikut
 * terbawa terus sampai ditandai. Di kalender, tiap baris berdiri pada TANGGALNYA sendiri; sebuah
 * pengingat yang muncul di tiga petak sekaligus tidak lagi menjawab "kapan".
 *
 * Yang sudah selesai tetap digambar, dibedakan `done`: petak yang kosong pada hari sebuah tagihan
 * dibayar terbaca sebagai tidak ada tagihan sama sekali.
 */
export function remindersByDay(rows) {
  const byDay = new Map();

  for (const row of Array.isArray(rows) ? rows : []) {
    const due = cellText(row?.dueDate);
    if (!isDayKey(due)) continue;

    const list = byDay.get(due) || [];
    list.push({
      id: row.id,
      title: cellText(row?.title) || "(tanpa judul)",
      type: cellText(row?.type),
      nominal: row?.nominal,
      done: cellText(row?.status) === "Selesai",
    });
    byDay.set(due, list);
  }

  return byDay;
}

/**
 * Rincian satu hari, untuk panel yang terbuka saat tanggalnya diklik.
 *
 * `owners` (opsional, `subDomainOwnerIndex`) cuma menambal PIC baris yang tidak membawanya
 * sendiri — aturan pencocokan yang sama dengan grafik per subdomain, supaya "milik siapa" berarti
 * hal yang sama di kedua tempat.
 */
export function dayDetail(rows, dayKey, rate, owners = null) {
  const subDomains = [];
  const byPic = new Map();

  for (const row of Array.isArray(rows) ? rows : []) {
    if (cellText(row?.date) !== dayKey) continue;

    const money = withAdTax(row, rate);
    const sources = earningSources(row);
    const name = cellText(row?.subDomain);
    const pic = (owners ? owners.picOf(name, row?.pic) : cellText(row?.pic)) || "";

    subDomains.push({
      id: row.id || `${dayKey}__${name}`,
      subDomain: name,
      pic,
      earning: money.earning,
      earningKnown: money.earningKnown,
      spending: money.spending,
      totalSpending: money.totalSpending,
      spendingKnown: money.spendingKnown,
      metaMissing: cellText(row?.metaMissing),
      profit: money.profit,
      roi: money.roi,
      gam: sources.gam,
      adsense: sources.adsense,
      clicks: toAmount(row?.clicks),
      partial: row?.partial === true,
    });

    const bucket = byPic.get(pic) || {
      pic,
      earning: 0,
      totalSpending: 0,
      earningKnown: false,
      spendKnown: false,
      sites: 0,
    };
    bucket.sites += 1;
    if (money.earningKnown) {
      bucket.earning += money.earning;
      bucket.earningKnown = true;
    }
    if (money.spendingKnown) {
      bucket.totalSpending += money.totalSpending;
      bucket.spendKnown = true;
    }
    byPic.set(pic, bucket);
  }

  // Yang terbesar belanjanya dulu: sebuah hari dibaca dari uang yang dipertaruhkan, dan ROI −80%
  // pada spend Rp 20rb bukan kabar yang sama dengan ROI −80% pada spend Rp 3jt.
  subDomains.sort((left, right) => spendOf(right) - spendOf(left) || earnOf(right) - earnOf(left));

  // Diurutkan SELAGI angkanya masih numerik: "" yang masuk ke pengurangan menghasilkan NaN, dan
  // baris yang dibandingkan lewat NaN berdiri di urutan yang berpindah-pindah antar render.
  const advertisers = [...byPic.values()]
    .sort((left, right) => right.totalSpending - left.totalSpending)
    .map((item) => ({
      ...item,
      earning: item.earningKnown ? round(item.earning) : "",
      // "Rp 0" untuk advertiser yang seluruh spend-nya tidak diketahui adalah klaim bahwa uangnya
      // tidak keluar — aturan yang sama dengan `withAdTax`, dan dengan kartu subdomain tepat di
      // atas daftar ini, yang sudah menggambar "-" untuk keadaan yang persis sama.
      totalSpending: item.spendKnown ? round(item.totalSpending) : "",
      roi: item.earningKnown && item.spendKnown ? roiPercent(item.earning, item.totalSpending) : "",
    }));

  return { subDomains, advertisers };
}

function spendOf(row) {
  return row.spendingKnown ? row.totalSpending : -1;
}

function earnOf(row) {
  return row.earningKnown ? row.earning : -1;
}

function iterate(summaries) {
  if (summaries instanceof Map) return summaries.values();
  return Array.isArray(summaries) ? summaries : [];
}
