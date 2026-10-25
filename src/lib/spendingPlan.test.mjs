import assert from "node:assert/strict";
import test from "node:test";
import { buildSpendingPlan, NO_PIC } from "./spendingPlan.js";

// Sepuluh hari, dua advertiser, dana yang sama besar — persis contoh spreadsheet yang jadi acuan
// halaman ini. Tiap baris membawa `totalSpending`-nya sendiri supaya tarif ad tax tidak ikut
// menggeser angka yang sedang diuji.
function sheetRows() {
  const rows = [];
  for (let day = 1; day <= 10; day++) {
    const date = `2026-08-${String(day).padStart(2, "0")}`;
    rows.push({ date, pic: "Godek", subDomain: "a.example.com", earning: 1800000, spending: 200000, totalSpending: 200000 });
    rows.push({ date, pic: "Nur", subDomain: "b.example.com", earning: 2700000, spending: 900000, totalSpending: 900000 });
  }
  return rows;
}

const range = { from: "2026-08-01", to: "2026-08-10" };

test("ROI Owner = earning dibagi topup, dan dana dibagi sebanding dengannya", () => {
  const plan = buildSpendingPlan({
    roiReports: sheetRows(),
    range,
    nextBudget: 2000000,
    adAccounts: [
      { name: "Akun Godek", userOwner: "Godek" },
      { name: "Akun Nur", userOwner: "Nur" },
    ],
    whitelistTopup: [
      { date: "2026-08-05", namaKode: "Akun Godek", nominal: 3000000 },
      { date: "2026-08-05", namaKode: "Akun Nur", nominal: 9000000 },
    ],
  });

  const godek = plan.rows.find((row) => row.name === "Godek");
  const nur = plan.rows.find((row) => row.name === "Nur");

  assert.equal(plan.dayCount, 10);
  
  // Godek Earning: 18jt. Topup: 3jt -> ROI Owner = 600
  // Nur Earning: 27jt. Topup: 9jt -> ROI Owner = 300
  assert.equal(godek.roiOwner, 600);
  assert.equal(nur.roiOwner, 300);

  // Porsi sebanding dengan ROI Owner: 600 : 300 = 66.67% : 33.33%.
  assert.equal(godek.share, 66.67);
  assert.equal(nur.share, 33.33);
  assert.equal(godek.nextBudget, 1333333);
  assert.equal(nur.nextBudget, 666667);
  assert.equal(plan.allocated, 2000000);

  // Yang paling efisien berdiri paling atas — daftar ini dibaca untuk memutuskan.
  assert.equal(plan.rows[0].name, "Godek");
});

test("kolom Next Budget berjumlah persis sebesar dana yang diketik", () => {
  // Tiga bobot yang tidak habis dibagi: 1/3 dari 100.000 tidak bulat, dan pembulatan satu per satu
  // meninggalkan sisa yang langsung terlihat begitu kolomnya dijumlahkan.
  const rows = ["A", "B", "C"].map((pic) => ({
    date: "2026-08-01",
    pic,
    earning: 3000000,
    spending: 100000,
    totalSpending: 100000,
  }));
  const plan = buildSpendingPlan({
    roiReports: rows,
    range: { from: "2026-08-01", to: "2026-08-01" },
    nextBudget: 100000,
    adAccounts: [
      { name: "A", userOwner: "A" },
      { name: "B", userOwner: "B" },
      { name: "C", userOwner: "C" },
    ],
    whitelistTopup: [
      { date: "2026-08-01", namaKode: "A", nominal: 1000000 },
      { date: "2026-08-01", namaKode: "B", nominal: 1000000 },
      { date: "2026-08-01", namaKode: "C", nominal: 1000000 },
    ],
  });

  assert.equal(plan.allocated, 100000);
});

// Hari berjalan memuat setengah hari earning di atas belanja yang masih naik sampai tengah malam:
// advertiser yang laporannya datang lebih lambat terlihat lebih buruk daripada rekannya, dan dana
// berpindah karena jam, bukan karena hasil.
test("hari berjalan tidak ikut jadi riwayat, dan tidak ikut menambah hari operasi", () => {
  const plan = buildSpendingPlan({
    roiReports: [
      ...sheetRows(),
      { date: "2026-08-11", pic: "Godek", earning: 100000, totalSpending: 50000, partial: true },
    ],
    range: { from: "2026-08-01", to: "2026-08-11" },
  });

  assert.equal(plan.dayCount, 10);
  assert.equal(plan.lastDay, "2026-08-10");
  assert.equal(plan.rows.find((row) => row.name === "Godek").earning, 18000000);
});

// Rentang yang lebih panjang daripada datanya tidak boleh mengarang hari yang tidak ada barisnya.
test("hari dihitung dari baris yang ada, bukan dari panjang rentang yang dipilih", () => {
  const plan = buildSpendingPlan({
    roiReports: sheetRows(),
    range: { from: "2026-07-01", to: "2026-08-31" },
  });

  assert.equal(plan.dayCount, 10);
});

// Aturan yang sama dengan seluruh dashboard: laporan GAM yang gagal datang tanpa earning, dan nol
// yang dikarang membuat advertiser itu tampak persis seperti yang beriklan tanpa hasil.
test("earning yang tidak diketahui tidak dihitung nol, dan tidak menerima dana", () => {
  const plan = buildSpendingPlan({
    roiReports: [
      { date: "2026-08-01", pic: "Godek", spending: 100000, totalSpending: 100000 },
      { date: "2026-08-01", pic: "Nur", earning: 5000000, spending: 100000, totalSpending: 100000 },
    ],
    adAccounts: [
      { name: "Akun Godek", userOwner: "Godek" },
      { name: "Akun Nur", userOwner: "Nur" },
    ],
    whitelistTopup: [
      { date: "2026-08-01", namaKode: "Akun Godek", nominal: 1000000 },
      { date: "2026-08-01", namaKode: "Akun Nur", nominal: 1000000 },
    ],
    range: { from: "2026-08-01", to: "2026-08-01" },
    nextBudget: 1000000,
  });

  const godek = plan.rows.find((row) => row.name === "Godek");
  assert.equal(godek.earning, "");
  assert.equal(godek.roiAdvertiser, "");
  assert.equal(godek.roiOwner, "");
  assert.equal(godek.nextBudget, "");
  assert.equal(plan.earningUnknown, 1);
  // Seluruh dana jatuh ke yang tersisa; tidak ada rupiah yang hilang.
  assert.equal(plan.rows.find((row) => row.name === "Nur").nextBudget, 1000000);
});

// Subdomain yang tidak diiklankan di Meta datang tanpa spend — tanpa pembagi tidak ada ROI, dan
// "earning tanpa biaya" bukan ROI tak terhingga melainkan ROI yang tidak bisa dihitung.
test("belanja yang tidak diketahui tidak dihitung nol", () => {
  const plan = buildSpendingPlan({
    roiReports: [{ date: "2026-08-01", pic: "Godek", earning: 500000 }],
    range: { from: "2026-08-01", to: "2026-08-01" },
    nextBudget: 1000000,
  });

  assert.equal(plan.rows[0].totalSpending, "");
  assert.equal(plan.rows[0].roiAdvertiser, "");
  assert.equal(plan.rows[0].nextBudget, "");
  assert.equal(plan.spendUnknown, 1);
});

// Pembagi yang mendekati nol meledakkan hasilnya, dan di sini yang meledak akan menyedot hampir
// seluruh dana berikutnya ke baris yang paling tidak berarti di tabel.
test("belanja di bawah lantai tidak menghasilkan ROI maupun jatah", () => {
  const plan = buildSpendingPlan({
    roiReports: [
      { date: "2026-08-01", pic: "Recehan", earning: 800000, totalSpending: 50 },
      { date: "2026-08-01", pic: "Nur", earning: 2700000, totalSpending: 900000 },
    ],
    adAccounts: [
      { name: "Akun Recehan", userOwner: "Recehan" },
      { name: "Akun Nur", userOwner: "Nur" },
    ],
    // Lantai yang sama berlaku untuk pembagi ROI Owner: setoran Rp 50 yang jadi pembagi akan
    // menyedot hampir seluruh dana berikutnya ke baris yang paling tidak berarti di tabel.
    whitelistTopup: [
      { date: "2026-08-01", namaKode: "Akun Recehan", nominal: 50 },
      { date: "2026-08-01", namaKode: "Akun Nur", nominal: 900000 },
    ],
    range: { from: "2026-08-01", to: "2026-08-01" },
    nextBudget: 1000000,
  });

  const recehan = plan.rows.find((row) => row.name === "Recehan");
  assert.equal(recehan.roiAdvertiser, "");
  assert.equal(recehan.roiOwner, "");
  assert.equal(recehan.nextBudget, "");
  assert.equal(plan.rows.find((row) => row.name === "Nur").nextBudget, 1000000);
});

// Uangnya nyata dan ikut total, tapi tidak ada orang yang bisa menerimanya.
test("baris tanpa PIC dihitung sebagai uang, tidak sebagai penerima", () => {
  const plan = buildSpendingPlan({
    roiReports: [{ date: "2026-08-01", earning: 4000000, totalSpending: 100000 }],
    range: { from: "2026-08-01", to: "2026-08-01" },
    nextBudget: 500000,
  });

  assert.equal(plan.rows[0].name, NO_PIC);
  assert.equal(plan.rows[0].nextBudget, "");
  assert.equal(plan.totals.earning, 4000000);
  assert.equal(plan.allocated, 0);
});

// Kolom Spending, Earning, dan ROI terisi sejak halaman dibuka; yang menunggu dana cuma dua kolom
// terakhir. Halaman yang seluruh kolomnya kosong sebelum satu angka diketik terbaca sebagai rusak.
test("tanpa dana yang diketik, tabelnya tetap menjawab kecuali dua kolom terakhir", () => {
  const plan = buildSpendingPlan({ roiReports: sheetRows(), range, nextBudget: 0 });

  assert.equal(plan.rows[0].roiAdvertiser, 900);
  assert.equal(plan.totals.totalSpending, 11000000);
  assert.ok(plan.rows.every((row) => row.nextBudget === ""));
  assert.equal(plan.allocated, 0);
});

// Total dihitung ulang dari jumlahnya, bukan dirata-ratakan: rata-rata persentase memberi bobot
// yang sama kepada advertiser berbelanja Rp 1 juta dan Rp 100 juta.
test("baris total dihitung dari jumlah uangnya, bukan dari rata-rata kolomnya", () => {
  const plan = buildSpendingPlan({ roiReports: sheetRows(), range });

  assert.equal(plan.totals.totalSpending, 11000000);
  assert.equal(plan.totals.earning, 45000000);
  // 45jt / 11jt = 409,09% — bukan rata-rata 900% dan 300%.
  assert.equal(plan.totals.roiAdvertiser, 409.09);
});

// Total top-up datang dari whitelistTopup, bukan diketik: dicocokkan ke PIC lewat pemilik
// ad account (mis. "TBZ 1247" milik "Godek"). ROI Owner memakai pembagi itu.
test("ROI Owner = earning dibagi total topup per advertiser", () => {
  const plan = buildSpendingPlan({
    roiReports: sheetRows(),
    range,
    nextBudget: 2000000,
    adAccounts: [
      { name: "TBZ 1247", userOwner: "Godek" },
      { name: "TBZ 1233", userOwner: "Nur" },
    ],
    whitelistTopup: [
      { date: "2026-08-01", namaKode: "TBZ 1247", nominal: 3000000 },
      { date: "2026-08-05", namaKode: "TBZ 1233", nominal: 9000000 },
    ],
  });

  const godek = plan.rows.find((row) => row.name === "Godek");
  const nur = plan.rows.find((row) => row.name === "Nur");

  assert.equal(godek.topup, 3000000);
  assert.equal(nur.topup, 9000000);
  // 18jt atas setoran 3jt = 600%. Bukan topup ÷ earning: 16,67% di kolom yang sama dengan 900%
  // milik ROI Advertiser terbaca sebagai orang yang rugi.
  assert.equal(godek.roiOwner, 600);
  assert.equal(nur.roiOwner, 300);
  // Dana dibagi menurut ROI Owner: 600 : 300 = 66,67% : 33,33%. Menurut ROI Advertiser (900 : 300)
  // porsinya akan 75% — yang dibagi di halaman ini uang pemilik, jadi yang menentukan porsi adalah
  // berapa kali setorannya kembali.
  assert.equal(godek.share, 66.67);
  assert.equal(plan.totals.topup, 12000000);
  assert.equal(plan.totals.roiOwner, 375);
});

test("top-up tanpa pemilik akun tidak diserahkan ke advertiser lain", () => {
  const plan = buildSpendingPlan({
    roiReports: sheetRows(),
    range,
    adAccounts: [{ name: "TBZ 1247", userOwner: "Godek" }],
    whitelistTopup: [
      { date: "2026-08-01", namaKode: "TBZ 1247", nominal: 2000000 },
      { date: "2026-08-01", namaKode: "Akun Lepas", nominal: 5000000 },
    ],
  });

  assert.equal(plan.rows.find((row) => row.name === "Godek").topup, 2000000);
  assert.equal(plan.rows.find((row) => row.name === "Nur").topup, 0);
});

test("top-up hari berjalan tidak ikut dijumlah", () => {
  const plan = buildSpendingPlan({
    roiReports: [
      ...sheetRows(),
      { date: "2026-08-11", pic: "Godek", earning: 1, totalSpending: 1, partial: true },
    ],
    range: { from: "2026-08-01", to: "2026-08-11" },
    adAccounts: [{ name: "TBZ 1247", userOwner: "Godek" }],
    whitelistTopup: [
      { date: "2026-08-01", namaKode: "TBZ 1247", nominal: 2000000 },
      { date: "2026-08-11", namaKode: "TBZ 1247", nominal: 8000000 },
    ],
  });

  assert.equal(plan.rows.find((row) => row.name === "Godek").topup, 2000000);
});

// Baris harian yang sempat ditulis sebagai hari berjalan lalu tidak pernah ditulis ulang membeku
// bertanda `partial: true` selamanya — di RTDB hampir tiap hari punya satu-dua baris begitu.
// Dibaca sebagai "hari berjalan", seluruh top-up periode itu ikut terbuang dan kolom Total Topup
// berbunyi Rp 0 untuk periode yang di halaman Whitelist Top-Up jelas ada isinya. Yang dibuang cuma
// hari partial TERBARU, aturan yang sama dengan filterRunningDay.
test("baris partial yang tertinggal di hari lampau tidak ikut membuang top-up harinya", () => {
  const plan = buildSpendingPlan({
    roiReports: [
      ...sheetRows(),
      // Sisa hari berjalan 08-05 yang tidak pernah ditulis ulang, dan hari berjalan yang sekarang.
      { date: "2026-08-05", pic: "Godek", earning: 1, totalSpending: 1, partial: true },
      { date: "2026-08-11", pic: "Godek", earning: 1, totalSpending: 1, partial: true },
    ],
    range: { from: "2026-08-01", to: "2026-08-11" },
    adAccounts: [{ name: "TBZ 1247", userOwner: "Godek" }],
    whitelistTopup: [
      { date: "2026-08-05", namaKode: "TBZ 1247", nominal: 2000000 },
      { date: "2026-08-11", namaKode: "TBZ 1247", nominal: 8000000 },
    ],
  });

  assert.equal(plan.rows.find((row) => row.name === "Godek").topup, 2000000);
});

test("advertiser yang punya top-up tapi tidak ada baris ROI tetap muncul di tabel", () => {
  const plan = buildSpendingPlan({
    roiReports: sheetRows(),
    range,
    adAccounts: [
      { name: "TBZ 1247", userOwner: "Godek" },
      { name: "TBZ 9999", userOwner: "Advertiser Baru" },
    ],
    whitelistTopup: [
      { date: "2026-08-01", namaKode: "TBZ 1247", nominal: 2000000 },
      { date: "2026-08-01", namaKode: "TBZ 9999", nominal: 5000000 },
    ],
  });

  const baru = plan.rows.find((row) => row.name === "Advertiser Baru");
  assert.ok(baru);
  assert.equal(baru.topup, 5000000);
  assert.equal(baru.rows, 0);
  assert.equal(baru.spending, "");
  assert.equal(baru.earning, "");
  assert.equal(baru.roiOwner, "");
  assert.equal(baru.nextBudget, "");
});

test("top-up dicocokkan berdasarkan ACT ID / Kode Meta dari ad accounts", () => {
  const plan = buildSpendingPlan({
    roiReports: sheetRows(),
    range,
    adAccounts: [
      { name: "TBZ 1247", actId: "act_250080654510501", userOwner: "Godek" },
      { name: "TBZ 1233", actId: "951641072800026", userOwner: "Nur" },
    ],
    whitelistTopup: [
      // Dicocokkan dengan prefix act_
      { date: "2026-08-01", namaKode: "act_250080654510501", nominal: 1000000 },
      // Dicocokkan tanpa prefix act_
      { date: "2026-08-02", namaKode: "250080654510501", nominal: 2000000 },
      // Dicocokkan dengan angka ID langsung
      { date: "2026-08-03", namaKode: "951641072800026", nominal: 4000000 },
    ],
  });

  const godek = plan.rows.find((row) => row.name === "Godek");
  const nur = plan.rows.find((row) => row.name === "Nur");

  assert.equal(godek.topup, 3000000);
  assert.equal(nur.topup, 4000000);
  assert.equal(plan.totals.topup, 7000000);
});

test("top-up dicocokkan dengan format gabungan Nama dan Kode", () => {
  const plan = buildSpendingPlan({
    roiReports: sheetRows(),
    range,
    adAccounts: [
      { name: "TBZ 1247", actId: "act_250080654510501", userOwner: "Godek" },
    ],
    whitelistTopup: [
      { date: "2026-08-01", namaKode: "TBZ 1247 (act_250080654510501)", nominal: 2500000 },
      { date: "2026-08-02", namaKode: "TBZ-1247", nominal: 1500000 },
    ],
  });

  const godek = plan.rows.find((row) => row.name === "Godek");
  assert.equal(godek.topup, 4000000);
});

test("top-up dan PIC dicocokkan lewat resolusi user (ID, username, email)", () => {
  const plan = buildSpendingPlan({
    roiReports: sheetRows(), // PIC is "Godek"
    range,
    users: [
      { id: "usr_1", name: "Godek", username: "godek_dev", email: "godek@example.com" },
    ],
    adAccounts: [
      // userOwner tersimpan sebagai username atau userId
      { name: "TBZ 1247", actId: "act_111", userOwner: "godek_dev" },
      { name: "TBZ 1248", actId: "act_222", userOwner: "usr_1" },
    ],
    whitelistTopup: [
      { date: "2026-08-01", namaKode: "TBZ 1247", nominal: 1000000 },
      { date: "2026-08-02", namaKode: "TBZ 1248", nominal: 2000000 },
    ],
  });

  const godek = plan.rows.find((row) => row.name === "Godek");
  assert.equal(godek.topup, 3000000);
});

test("alur 3 langkah: Whitelist Topup (Nama/Kode) -> Ad Accounts (Nama Akun Ads -> User Pemilik) -> Proyeksi Budget (Advertiser)", () => {
  const plan = buildSpendingPlan({
    roiReports: [
      { date: "2026-08-01", pic: "Nurjaman WL 2", earning: 2000000, spending: 500000, totalSpending: 500000 },
      { date: "2026-08-01", pic: "Aca", earning: 3000000, spending: 1000000, totalSpending: 1000000 },
    ],
    range: { from: "2026-08-01", to: "2026-08-01" },
    // 1. Data Ad Accounts: mencocokkan Nama Akun Ads dan menyimpan User Pemilik
    adAccounts: [
      { name: "TBZ 1235", userOwner: "Nurjaman" },
      { name: "TBZ 1247", userOwner: "Aca" },
    ],
    // 2. Data Whitelist Topup: Nama/Kode dicocokkan ke Nama Akun Ads
    whitelistTopup: [
      { date: "2026-08-01", namaKode: "TBZ 1235", nominal: 1500000 },
      { date: "2026-08-01", namaKode: "TBZ 1247", nominal: 2500000 },
    ],
  });

  // 3. Dicocokkan ke baris Advertiser di Proyeksi Budget
  const nurjaman = plan.rows.find((row) => row.name === "Nurjaman WL 2");
  const aca = plan.rows.find((row) => row.name === "Aca");

  assert.ok(nurjaman, "Baris Nurjaman WL 2 ditemukan");
  assert.ok(aca, "Baris Aca ditemukan");
  assert.equal(nurjaman.topup, 1500000);
  assert.equal(aca.topup, 2500000);
  assert.equal(plan.totals.topup, 4000000);
});

test("kolom PIC di baris top-up menang atas pemilik akun hari ini", () => {
  const plan = buildSpendingPlan({
    roiReports: [
      { date: "2026-08-01", pic: "Nurjaman", earning: 2000000, spending: 500000, totalSpending: 500000 },
      { date: "2026-08-01", pic: "Aca", earning: 3000000, spending: 1000000, totalSpending: 1000000 },
    ],
    range: { from: "2026-08-01", to: "2026-08-01" },
    // Akun sudah berpindah ke Aca; setoran bulan ini tetap milik Nurjaman karena barisnya menyebut
    // namanya sendiri.
    adAccounts: [{ name: "TBZ 1235", userOwner: "Aca" }],
    whitelistTopup: [
      { date: "2026-08-01", namaKode: "TBZ 1235", pic: "Nurjaman", nominal: 1500000 },
    ],
  });

  assert.equal(plan.rows.find((row) => row.name === "Nurjaman").topup, 1500000);
  assert.equal(plan.rows.find((row) => row.name === "Aca").topup, 0);
});

test("PIC kosong jatuh ke pemetaan akun, dan Keterangan tidak pernah dibaca sebagai PIC", () => {
  const plan = buildSpendingPlan({
    roiReports: [
      { date: "2026-08-01", pic: "Nurjaman", earning: 2000000, spending: 500000, totalSpending: 500000 },
      { date: "2026-08-01", pic: "Aca", earning: 3000000, spending: 1000000, totalSpending: 1000000 },
    ],
    range: { from: "2026-08-01", to: "2026-08-01" },
    adAccounts: [{ name: "TBZ 1235", userOwner: "Aca" }],
    whitelistTopup: [
      // Baris lama: tanpa kolom PIC, dengan keterangan yang kebetulan menyebut nama orang lain.
      { date: "2026-08-01", namaKode: "TBZ 1235", note: "Nurjaman", nominal: 1500000 },
    ],
  });

  assert.equal(plan.rows.find((row) => row.name === "Aca").topup, 1500000);
  assert.equal(plan.rows.find((row) => row.name === "Nurjaman").topup, 0);
});

// Sisa saldo & Perlu Transfer -------------------------------------------------

const balanceCase = ({ accounts, budget = 4000000 }) =>
  buildSpendingPlan({
    roiReports: [
      { date: "2026-08-01", pic: "Nur", earning: 3000000, spending: 1000000, totalSpending: 1000000 },
      { date: "2026-08-01", pic: "Aca", earning: 3000000, spending: 1000000, totalSpending: 1000000 },
    ],
    range: { from: "2026-08-01", to: "2026-08-01" },
    whitelistTopup: [
      { date: "2026-08-01", pic: "Nur", nominal: 1000000 },
      { date: "2026-08-01", pic: "Aca", nominal: 1000000 },
    ],
    adAccounts: accounts,
    nextBudget: budget,
  });

test("Perlu Transfer = Next Budget dikurangi sisa saldo, dan porsinya tidak ikut bergeser", () => {
  const plan = balanceCase({
    accounts: [
      { name: "TBZ 1", userOwner: "Nur", balance: 500000 },
      { name: "TBZ 2", userOwner: "Aca", balance: 0 },
    ],
  });

  const nur = plan.rows.find((row) => row.name === "Nur");
  const aca = plan.rows.find((row) => row.name === "Aca");

  // ROI Owner keduanya sama, jadi porsinya tetap sama rata — saldo TIDAK menyentuh pembobotan.
  assert.equal(nur.share, 50);
  assert.equal(aca.share, 50);
  assert.equal(nur.nextBudget, 2000000);
  assert.equal(aca.nextBudget, 2000000);

  assert.equal(nur.balance, 500000);
  assert.equal(nur.transfer, 1500000);
  assert.equal(aca.balance, 0);
  assert.equal(aca.transfer, 2000000);

  // Next Budget tetap berjumlah persis sebesar dana yang diketik; Perlu Transfer sengaja lebih
  // kecil, dan selisihnya adalah uang yang sudah ada di akun.
  assert.equal(plan.totals.nextBudget, 4000000);
  assert.equal(plan.totals.balance, 500000);
  assert.equal(plan.totals.transfer, 3500000);
});

test("saldo yang melebihi porsinya tidak menghasilkan transfer negatif", () => {
  const plan = balanceCase({
    accounts: [
      { name: "TBZ 1", userOwner: "Nur", balance: 9000000 },
      { name: "TBZ 2", userOwner: "Aca", balance: 0 },
    ],
  });

  assert.equal(plan.rows.find((row) => row.name === "Nur").transfer, 0);
});

test("beberapa akun satu advertiser dijumlah; akun yang sync-nya mati tidak ikut", () => {
  const plan = balanceCase({
    accounts: [
      { name: "TBZ 1", userOwner: "Nur", balance: 300000 },
      { name: "TBZ 1b", userOwner: "Nur", balance: 200000 },
      // Disuspend Meta: saldonya beku, dan uang di akun yang tidak bisa membelanjakan apa pun tidak
      // boleh mengurangi transfer berikutnya.
      { name: "TBZ 1c", userOwner: "Nur", balance: 7000000, syncDisabled: true },
      { name: "TBZ 2", userOwner: "Aca", balance: 0 },
    ],
  });

  const nur = plan.rows.find((row) => row.name === "Nur");
  assert.equal(nur.balance, 500000);
  assert.equal(nur.transfer, 1500000);
});

test("saldo yang tidak diketahui bukan nol: transfernya penuh, dan barisnya menandainya", () => {
  const plan = balanceCase({
    accounts: [
      // Akun tanpa `balance` sama sekali — belum pernah berhasil disync.
      { name: "TBZ 1", userOwner: "Nur" },
      { name: "TBZ 2", userOwner: "Aca", balance: 0 },
    ],
  });

  const nur = plan.rows.find((row) => row.name === "Nur");
  assert.equal(nur.balance, "");
  assert.equal(nur.balanceKnown, false);
  assert.equal(nur.transfer, 2000000);

  // Baris Aca membawa saldo yang benar-benar nol, jadi totalnya tetap dilaporkan.
  assert.equal(plan.totals.balance, 0);
  assert.equal(plan.totals.transfer, 4000000);
});

test("tanpa dana yang diketik, kolom Perlu Transfer kosong — bukan sebesar saldo", () => {
  const plan = balanceCase({
    accounts: [{ name: "TBZ 1", userOwner: "Nur", balance: 500000 }],
    budget: 0,
  });

  const nur = plan.rows.find((row) => row.name === "Nur");
  assert.equal(nur.nextBudget, "");
  assert.equal(nur.transfer, "");
  assert.equal(nur.balance, 500000);
});
