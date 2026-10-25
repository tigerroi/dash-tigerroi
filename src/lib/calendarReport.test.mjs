import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCalendarMonth,
  dailySummaries,
  dayDetail,
  median,
  monthCells,
  monthTotals,
  remindersByDay,
  roiRanking,
  weekdayBaselines,
} from "./calendarReport.js";

const RATE = 0.05;

// Baris ROI harian seperti yang ditulis `roiReportUpdate`: earning/spending boleh TIDAK ADA, dan
// itu bukan nol.
const row = (date, name, { earning, spending, ...extra } = {}) => ({
  date,
  subDomain: name,
  ...(earning === undefined ? {} : { earning }),
  ...(spending === undefined ? {} : { spending }),
  ...extra,
});

test("petak bulan mulai Minggu, memuat seluruh hari, dan menandai milik bulan tetangga", () => {
  // Agustus 2026: 1 Agu jatuh hari Sabtu, 31 hari.
  const cells = monthCells("2026-08");

  assert.equal(cells[0].weekday, 0);
  assert.equal(cells.length % 7, 0);
  assert.equal(cells[0].key, "2026-07-26");
  assert.equal(cells[0].inMonth, false);

  const own = cells.filter((cell) => cell.inMonth);
  assert.equal(own.length, 31);
  assert.equal(own[0].key, "2026-08-01");
  assert.equal(own[30].key, "2026-08-31");

  // Bulan yang tidak berbentuk tidak menghasilkan petak setengah jadi.
  assert.deepEqual(monthCells(""), []);
  assert.deepEqual(monthCells("2026-13"), []);
});

test("hari yang seluruh earning-nya gagal berbunyi kosong, bukan ROI -100%", () => {
  const summaries = dailySummaries(
    [
      row("2026-08-10", "a.example.com", { spending: 100_000 }),
      row("2026-08-10", "b.example.com", { spending: 50_000 }),
    ],
    RATE,
  );
  const day = summaries.get("2026-08-10");

  assert.equal(day.earning, "");
  assert.equal(day.roi, "");
  assert.equal(day.profit, "");
  assert.equal(day.earningUnknown, 2);
  // Spend-nya tetap nyata: uang itu benar-benar keluar.
  assert.equal(day.totalSpending, 157_500);
});

test("hari tanpa satu pun spend yang diketahui tidak melaporkan profit dari nol", () => {
  const summaries = dailySummaries([row("2026-08-11", "a.example.com", { earning: 90_000 })], RATE);
  const day = summaries.get("2026-08-11");

  assert.equal(day.earning, 90_000);
  assert.equal(day.totalSpending, "");
  assert.equal(day.profit, "");
  assert.equal(day.roi, "");
  assert.equal(day.spendUnknown, 1);
});

test("sebab spend yang kosong dihitung terpisah — dua sebab, dua tempat memperbaikinya", () => {
  const summaries = dailySummaries(
    [
      row("2026-08-12", "a.example.com", { earning: 10_000, metaMissing: "unmapped" }),
      row("2026-08-12", "b.example.com", { earning: 10_000, metaMissing: "unavailable" }),
      row("2026-08-12", "c.example.com", { earning: 10_000 }),
      row("2026-08-12", "d.example.com", { earning: 10_000, spending: 8_000 }),
    ],
    RATE,
  );
  const day = summaries.get("2026-08-12");

  assert.equal(day.spendUnknown, 3);
  assert.equal(day.unmapped, 1);
  assert.equal(day.unavailable, 1);
  assert.equal(day.incompleteSubDomains, 3);
  assert.equal(day.subDomains, 4);
  assert.equal(day.earning, 40_000);
  assert.equal(day.totalSpending, 8_400);
});

// Lencana di petak menghitung SUBDOMAIN, bukan sebab. Dijumlahkan dari dua penghitung, subdomain
// yang kehilangan earning DAN spend terhitung dua kali — dan "2" untuk satu subdomain bermasalah
// mengirim orang mencari baris yang tidak ada.
test("subdomain yang kehilangan earning DAN spend dihitung sekali", () => {
  const summaries = dailySummaries(
    [
      row("2026-08-12", "a.example.com"),
      row("2026-08-12", "b.example.com", { earning: 10_000 }),
      row("2026-08-12", "c.example.com", { earning: 10_000, spending: 5_000 }),
    ],
    RATE,
  );
  const day = summaries.get("2026-08-12");

  assert.equal(day.earningUnknown, 1);
  assert.equal(day.spendUnknown, 2);
  assert.equal(day.incompleteSubDomains, 2);
  assert.equal(day.subDomains, 3);
});

test("ROI harian dihitung dari total spend berpajak, bukan dari spend telanjang", () => {
  const summaries = dailySummaries(
    [row("2026-08-13", "a.example.com", { earning: 210_000, spending: 100_000 })],
    RATE,
  );
  const day = summaries.get("2026-08-13");

  assert.equal(day.adTax, 5_000);
  assert.equal(day.totalSpending, 105_000);
  assert.equal(day.profit, 105_000);
  assert.equal(day.roi, 100);
});

test("baris hari berjalan menandai harinya, dan rincian sumber earning ikut terjumlah", () => {
  const summaries = dailySummaries(
    [
      row("2026-08-14", "a.example.com", {
        earning: 30_000,
        spending: 10_000,
        adxRevenue: 20_000,
        adServerRevenue: 4_000,
        adsenseRevenue: 6_000,
        clicks: 12,
        impressions: 900,
        partial: true,
      }),
    ],
    RATE,
  );
  const day = summaries.get("2026-08-14");

  assert.equal(day.partial, true);
  assert.equal(day.gam, 24_000);
  assert.equal(day.adsense, 6_000);
  assert.equal(day.clicks, 12);
  assert.equal(day.impressions, 900);
});

test("tanda partial yang tertinggal di hari lampau tidak membuat harinya 'berjalan'", () => {
  // Baris 20 Agu ditulis sebagai hari berjalan lalu tidak pernah ditulis ulang — subdomainnya tidak
  // muncul di laporan final. Pertengahan September, hari itu tetap hari yang sudah selesai.
  const rows = [
    row("2026-08-20", "a.example.com", { earning: 50_000, spending: 10_000 }),
    row("2026-08-20", "petcins.com", { earning: 5, partial: true }),
    row("2026-09-16", "a.example.com", { earning: 9_000, spending: 4_000, partial: true }),
  ];

  const summaries = dailySummaries(rows, RATE);
  assert.equal(summaries.get("2026-08-20").partial, false);
  assert.equal(summaries.get("2026-09-16").partial, true);

  // Hari berjalan dari pemanggil menang — Kalender membacanya dari roiReports yang belum disaring,
  // jadi baris yang tersaring tidak punya hari berjalan sendiri untuk ditebak.
  const filtered = dailySummaries([rows[1]], RATE, { runningDay: "2026-09-16" });
  assert.equal(filtered.get("2026-08-20").partial, false);
});

test("hari lampau bertanda partial yang tertinggal tetap jadi sampel potensi", () => {
  const rows = ["2026-07-06", "2026-07-13", "2026-07-20", "2026-07-27"].map((date) =>
    row(date, "a.example.com", { earning: 10_000, spending: 1000 }),
  );
  rows.push(row("2026-07-20", "b.example.com", { earning: 3, partial: true }));
  rows.push(row("2026-08-10", "a.example.com", { earning: 1_000, spending: 500, partial: true }));

  const baselines = weekdayBaselines(dailySummaries(rows, RATE), { asOf: "2026-08-10" });
  assert.equal(baselines[1].samples, 4);
});

test("median mengabaikan daftar kosong alih-alih menjawab nol", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(median([]), "");
});

test("baseline per hari dalam minggu memakai median dan menolak sampel yang tidak sah", () => {
  // Lima hari Senin sebelum asOf: empat sehat, satu partial (harus dibuang).
  const rows = [];
  const earnings = [10, 12, 8, 30];
  ["2026-07-06", "2026-07-13", "2026-07-20", "2026-07-27"].forEach((date, index) => {
    rows.push(row(date, "a.example.com", { earning: earnings[index] * 1000, spending: 1000 }));
  });
  rows.push(
    row("2026-08-03", "a.example.com", { earning: 999_000, spending: 1000, partial: true }),
    // Hari Senin yang laporannya gagal: bukan hari sepi, jadi bukan sampel.
    row("2026-06-29", "a.example.com", { spending: 1000 }),
  );

  const baselines = weekdayBaselines(dailySummaries(rows, RATE), { asOf: "2026-08-10", weeks: 8 });

  // Senin = 1. Median dari 10rb/12rb/8rb/30rb = 11rb — rata-ratanya 15rb, terseret satu hari.
  assert.equal(baselines[1].samples, 4);
  assert.equal(baselines[1].earning, 11_000);
  // Hari lain tidak punya sampel sama sekali.
  assert.equal(baselines[2], null);
});

test("baseline butuh minimal empat sampel — tiga hari bukan 'biasanya'", () => {
  const rows = ["2026-07-13", "2026-07-20", "2026-07-27"].map((date) =>
    row(date, "a.example.com", { earning: 10_000, spending: 1000 }),
  );

  const baselines = weekdayBaselines(dailySummaries(rows, RATE), { asOf: "2026-08-10" });
  assert.equal(baselines[1], null);

  const relaxed = weekdayBaselines(dailySummaries(rows, RATE), {
    asOf: "2026-08-10",
    minSamples: 3,
  });
  assert.equal(relaxed[1].samples, 3);
});

test("hari yang sedang dinilai tidak ikut menilai dirinya sendiri", () => {
  const rows = ["2026-07-06", "2026-07-13", "2026-07-20", "2026-07-27"].map((date) =>
    row(date, "a.example.com", { earning: 10_000, spending: 1000 }),
  );
  // Senin yang sama dengan asOf, angkanya jauh berbeda: kalau ikut, median bergeser.
  rows.push(row("2026-08-10", "a.example.com", { earning: 900_000, spending: 1000 }));

  const baselines = weekdayBaselines(dailySummaries(rows, RATE), { asOf: "2026-08-10" });
  assert.equal(baselines[1].samples, 4);
  assert.equal(baselines[1].earning, 10_000);
});

test("potensi hanya digambar untuk hari ini dan sesudahnya", () => {
  const rows = ["2026-07-06", "2026-07-13", "2026-07-20", "2026-07-27", "2026-08-03"].map((date) =>
    row(date, "a.example.com", { earning: 10_000, spending: 1000 }),
  );

  const { days } = buildCalendarMonth({
    monthKey: "2026-08",
    roiReports: rows,
    rate: RATE,
    now: new Date(2026, 7, 10),
  });

  const at = (key) => days.find((day) => day.key === key);

  // 3 Agu (Senin, lampau) punya angka nyata dan TIDAK menggambar potensi.
  assert.equal(at("2026-08-03").potential, null);
  assert.equal(at("2026-08-03").summary.earning, 10_000);
  // 10 Agu (hari ini) dan 17 Agu (Senin depan) menggambar potensi.
  assert.equal(at("2026-08-10").isToday, true);
  assert.equal(at("2026-08-10").potential.earning, 10_000);
  assert.equal(at("2026-08-17").isFuture, true);
  assert.equal(at("2026-08-17").potential.samples, 5);
  // Selasa tidak punya sampel: tidak ada potensi yang dikarang.
  assert.equal(at("2026-08-18").potential, null);
});

test("tiga hari ber-ROI tertinggi bulan itu dapat peringkat 1-3", () => {
  const rows = [
    // ROI: 100%, 300%, 42,86%, 900% (spend + 5% ad tax).
    row("2026-08-04", "a.example.com", { earning: 210_000, spending: 100_000 }),
    row("2026-08-05", "a.example.com", { earning: 420_000, spending: 100_000 }),
    row("2026-08-06", "a.example.com", { earning: 150_000, spending: 100_000 }),
    row("2026-08-07", "a.example.com", { earning: 1_050_000, spending: 100_000 }),
    // Hari milik bulan tetangga yang ikut digambar di baris pertama: ROI-nya tertinggi dari
    // semuanya, dan justru karena itu ia tidak boleh ikut lomba bulan ini.
    row("2026-07-31", "a.example.com", { earning: 9_000_000, spending: 100_000 }),
    // Belanja di bawah lantai: ROI-nya "" dan tidak bisa menang dengan angka enam digit.
    row("2026-08-08", "a.example.com", { earning: 153_000, spending: 43 }),
  ];

  const { days } = buildCalendarMonth({
    monthKey: "2026-08",
    roiReports: rows,
    rate: RATE,
    now: new Date(2026, 7, 10),
  });
  const rankOf = (key) => days.find((day) => day.key === key).rank;

  assert.equal(rankOf("2026-08-07"), 1);
  assert.equal(rankOf("2026-08-05"), 2);
  assert.equal(rankOf("2026-08-04"), 3);
  assert.equal(rankOf("2026-08-06"), 0, "peringkat empat tidak dapat medali");
  assert.equal(rankOf("2026-07-31"), 0, "hari bulan tetangga tidak ikut lomba bulan ini");
  assert.equal(rankOf("2026-08-08"), 0, "ROI yang tidak sah tidak bisa menang");
});

// Urutan yang berpindah-pindah antar render untuk data yang sama membuat medali berkedip.
test("ROI yang seri dipecah lewat tanggal, yang lebih awal menang", () => {
  const days = ["2026-08-12", "2026-08-05", "2026-08-20"].map((key) => ({
    key,
    inMonth: true,
    summary: { roi: 120 },
  }));

  assert.deepEqual([...roiRanking(days, 2)], [
    ["2026-08-05", 1],
    ["2026-08-12", 2],
  ]);
});

test("reminder berdiri pada tanggal jatuh temponya, bukan di jendela antisipasi", () => {
  const byDay = remindersByDay([
    { id: "r1", title: "Sewa server", dueDate: "2026-08-18", status: "Belum" },
    { id: "r2", title: "Domain", dueDate: "2026-08-18", status: "Selesai" },
    { id: "r3", title: "Tanpa tanggal", dueDate: "" },
  ]);

  assert.equal(byDay.get("2026-08-18").length, 2);
  assert.equal(byDay.get("2026-08-18")[0].done, false);
  assert.equal(byDay.get("2026-08-18")[1].done, true);
  assert.equal(byDay.size, 1);
});

test("total bulan tidak memungut hari milik bulan tetangga", () => {
  const rows = [
    row("2026-07-31", "a.example.com", { earning: 500_000, spending: 100_000 }),
    row("2026-08-01", "a.example.com", { earning: 200_000, spending: 100_000 }),
    row("2026-08-02", "a.example.com", { earning: 100_000, spending: 100_000 }),
  ];

  const { days, totals } = buildCalendarMonth({
    monthKey: "2026-08",
    roiReports: rows,
    rate: RATE,
    now: new Date(2026, 7, 10),
  });

  // 31 Juli ikut digambar di baris pertama, lengkap dengan angkanya.
  const july = days.find((day) => day.key === "2026-07-31");
  assert.equal(july.inMonth, false);
  assert.equal(july.summary.earning, 500_000);

  assert.equal(totals.earning, 300_000);
  assert.equal(totals.totalSpending, 210_000);
  assert.equal(totals.profit, 90_000);
  assert.equal(monthTotals([]).earning, "");
});

test("rincian hari diurutkan menurut uang yang dipertaruhkan, dan dikelompokkan per PIC", () => {
  const rows = [
    row("2026-08-09", "kecil.example.com", { earning: 1_000, spending: 20_000, pic: "Budi" }),
    row("2026-08-09", "besar.example.com", { earning: 900_000, spending: 300_000, pic: "Ani" }),
    row("2026-08-09", "tanpa-spend.example.com", { earning: 50_000, pic: "Budi" }),
    row("2026-08-08", "hari-lain.example.com", { earning: 10_000, spending: 10_000, pic: "Ani" }),
  ];

  const { subDomains, advertisers } = dayDetail(rows, "2026-08-09", RATE);

  assert.deepEqual(
    subDomains.map((item) => item.subDomain),
    ["besar.example.com", "kecil.example.com", "tanpa-spend.example.com"],
  );
  // Baris tanpa spend jatuh ke bawah tanpa berpura-pura spend-nya nol.
  assert.equal(subDomains[2].spendingKnown, false);
  assert.equal(subDomains[2].totalSpending, "");

  assert.deepEqual(
    advertisers.map((item) => item.pic),
    ["Ani", "Budi"],
  );
  assert.equal(advertisers[0].totalSpending, 315_000);
  assert.equal(advertisers[1].earning, 51_000);
});

test("PIC baris yang kosong ditambal indeks pemilik, aturan yang sama dengan grafik", () => {
  const owners = { picOf: (name, rowPic) => rowPic || (name ? "Pemilik Terdaftar" : "") };
  const { advertisers } = dayDetail(
    [row("2026-08-09", "a.example.com", { earning: 10_000, spending: 5_000 })],
    "2026-08-09",
    RATE,
    owners,
  );

  assert.equal(advertisers[0].pic, "Pemilik Terdaftar");
});

// "Rp 0" dan "tidak diketahui" adalah dua kabar yang berbeda, dan daftar per advertiser sempat
// meleburnya — kartu subdomain tepat di atasnya sudah membedakannya sejak awal.
test("advertiser yang seluruh spend-nya tidak diketahui tidak dilaporkan Rp 0", () => {
  const { advertisers } = dayDetail(
    [
      row("2026-08-09", "tanpa-spend.example.com", { earning: 50_000, pic: "Budi" }),
      row("2026-08-09", "besar.example.com", { earning: 900_000, spending: 300_000, pic: "Ani" }),
    ],
    "2026-08-09",
    RATE,
  );

  const budi = advertisers.find((item) => item.pic === "Budi");
  assert.equal(budi.totalSpending, "", "spend yang tidak diketahui bukan nol");
  assert.equal(budi.roi, "", "tanpa pembagi yang diketahui tidak ada ROI untuk dihitung");
  assert.equal(budi.earning, 50_000, "sisi yang diketahui tetap dilaporkan");
  // Yang spend-nya nyata tidak ikut berubah, dan urutannya tetap menurut uang yang keluar.
  assert.equal(advertisers[0].pic, "Ani");
  assert.equal(advertisers[0].totalSpending, 315_000);
});

// Hari operasi (WIB) dan hari di jam browser adalah dua hari yang berbeda tiap kali tab dibuka dari
// zona lain — atau dibiarkan terbuka melewati tengah malam sebelum sync berikutnya jalan.
test("petak hari ini dibaca dari hari operasi yang diberikan, bukan dari jam browser", () => {
  const { days } = buildCalendarMonth({
    monthKey: "2026-08",
    roiReports: [row("2026-08-09", "a.example.com", { earning: 10_000, spending: 1_000 })],
    rate: RATE,
    now: new Date(2026, 7, 10),
    today: "2026-08-09",
  });
  const at = (key) => days.find((day) => day.key === key);

  assert.equal(at("2026-08-09").isToday, true);
  assert.equal(at("2026-08-10").isToday, false);
  assert.equal(at("2026-08-10").isFuture, true, "sehari sesudah hari operasi belum terjadi");
});
