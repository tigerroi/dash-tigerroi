import assert from "node:assert/strict";
import { test } from "node:test";
import { ACCOUNT_CLOSE, PAYOUT_STATUSES, payoutRows } from "./payouts.js";

const store = {
  domains: [
    { domainUrl: "xiaomidriversdownload.com" },
    { domainUrl: "psaonlineappointment.com" },
    // Sengaja tanpa baris tarif di `companyPercents` — itu keadaan yang diuji di bawah.
    { domainUrl: "dekadeko.com" },
  ],
  subDomains: [
    { name: "adx.xiaomidriversdownload.com", parentDomain: "xiaomidriversdownload.com" },
    { name: "ads.xiaomidriversdownload.com", parentDomain: "xiaomidriversdownload.com" },
    { name: "marriage.psaonlineappointment.com", parentDomain: "psaonlineappointment.com" },
    { name: "a.dekadeko.com", parentDomain: "dekadeko.com" },
  ],
  companyPercents: [
    { domain: "xiaomidriversdownload.com", effectiveFrom: "2026-04-01", percent: 10 },
    // Naik di tengah bulan: yang memakainya wajib menghitung per hari, bukan sekali per bulan.
    { domain: "xiaomidriversdownload.com", effectiveFrom: "2026-05-16", percent: 20 },
    { domain: "psaonlineappointment.com", effectiveFrom: "2026-05-01", percent: 5 },
  ],
  invalidTraffic: [
    // Dua jenis akun, satu domain, satu bulan — dijumlahkan jadi Rp 218.842, persis kolom
    // "INVALID TRAFFICT" baris April spreadsheet acuan.
    {
      month: "2026-04",
      domain: "xiaomidriversdownload.com",
      accountType: "Ad-Exchanger",
      check1: 87457,
      check2: 71068,
    },
    {
      month: "2026-04",
      domain: "xiaomidriversdownload.com",
      accountType: "Adsense",
      check1: 59975,
      check2: 342,
    },
    // Baris bentuk LAMA: tanpa Check, tanpa jenis akun, bulannya cuma di `date`.
    {
      date: "2026-05-01",
      domain: "psaonlineappointment.com",
      nominal: 27453,
    },
  ],
  roiReports: [
    // April, Ad Exchange: seluruh pendapatannya AdX, jadi seluruhnya kena tarif 10%.
    {
      date: "2026-04-11",
      subDomain: "adx.xiaomidriversdownload.com",
      earning: 26132371,
      adxRevenue: 26132371,
      adsenseRevenue: 0,
      adServerRevenue: 0,
    },
    // April, AdSense: adx/adServer nol, jadi TIDAK kena potongan Company sama sekali.
    {
      date: "2026-04-12",
      subDomain: "ads.xiaomidriversdownload.com",
      earning: 13066501,
      adxRevenue: 0,
      adsenseRevenue: 13066501,
      adServerRevenue: 0,
    },
    // Mei, dua hari yang tarifnya berbeda (10% sebelum tanggal 16, 20% sesudahnya).
    {
      date: "2026-05-10",
      subDomain: "adx.xiaomidriversdownload.com",
      earning: 1000000,
      adxRevenue: 1000000,
      adsenseRevenue: 0,
      adServerRevenue: 0,
    },
    {
      date: "2026-05-20",
      subDomain: "adx.xiaomidriversdownload.com",
      earning: 2000000,
      adxRevenue: 2000000,
      adsenseRevenue: 0,
      adServerRevenue: 0,
    },
    // Mei, AdSense murni — dipotong 5% di spreadsheet acuan, TIDAK dipotong di sini.
    {
      date: "2026-05-09",
      subDomain: "marriage.psaonlineappointment.com",
      earning: 5165000,
      adxRevenue: 0,
      adsenseRevenue: 5165000,
      adServerRevenue: 0,
    },
    // Domain tanpa satu pun baris tarif Company.
    {
      date: "2026-05-09",
      subDomain: "a.dekadeko.com",
      earning: 2081949,
      adxRevenue: 2081949,
      adsenseRevenue: 0,
      adServerRevenue: 0,
    },
    // Earning yang TIDAK diketahui: laporan gagal datang, bukan Rp 0.
    { date: "2026-04-13", subDomain: "adx.xiaomidriversdownload.com", earning: "" },
  ],
};

const row = (extra) => payoutRows([{ id: "p", ...extra }], store)[0];

test("tiga status, dan Account Close salah satunya", () => {
  assert.deepEqual(PAYOUT_STATUSES, ["Sudah Cair", "Pending Payment", ACCOUNT_CLOSE]);
});

test("Earning Google menjumlahkan KEDUA sumber, potongan Company hanya Ad Exchange", () => {
  const april = row({ month: "2026-04", domain: "xiaomidriversdownload.com" });

  assert.equal(april.earning, 26132371 + 13066501);
  // 10% dari bagian AdX-nya saja. Memotong seluruh earning menghasilkan Rp 1.306.650 lebih banyak
  // daripada yang benar-benar dipotong — persis 10% dari pendapatan AdSense-nya.
  assert.equal(april.company, 2613237.1);
  assert.equal(april.companyPercent, "10%");
});

test("invalid traffic menjumlahkan kedua jenis akun; tanpa baris berarti Rp 0", () => {
  const april = row({ month: "2026-04", domain: "xiaomidriversdownload.com" });
  assert.equal(april.invalidTraffic, 218842, "87.457 + 71.068 + 59.975 + 342");

  // Bulan yang belum pernah dicek tidak kehilangan apa-apa: jumlah dari himpunan kosong itu nol.
  const mei = row({ month: "2026-05", domain: "dekadeko.com" });
  assert.equal(mei.invalidTraffic, 0);
});

test("baris invalid traffic bentuk lama (tanpa Check, bulan dari date) tetap terhitung", () => {
  const mei = row({ month: "2026-05", domain: "psaonlineappointment.com" });
  assert.equal(mei.invalidTraffic, 27453);
});

test("Earning Final = Earning − Company − Invalid Traffic + Saldo Sebelumnya", () => {
  const april = row({
    month: "2026-04",
    domain: "xiaomidriversdownload.com",
    saldoSebelumnya: 116882,
  });

  assert.equal(
    april.earningFinal,
    round(39198872 - 2613237.1 - 218842 + 116882),
    "rantai yang sama dengan kolom EARNING FINAL di spreadsheet acuan",
  );
});

test("tarif Company dicari PER HARI, dan sebulan bisa memuat dua tarif", () => {
  const mei = row({ month: "2026-05", domain: "xiaomidriversdownload.com" });

  // 10% × 1jt (10 Mei) + 20% × 2jt (20 Mei). Mengalikan earning sebulan dengan salah satu tarifnya
  // menjawab Rp 300.000 atau Rp 600.000 — keduanya salah.
  assert.equal(mei.company, 500000);
  assert.equal(mei.companyPercent, "10% → 20%");
});

test("pendapatan AdSense tidak dipotong Company, dan Rp 0 di sana adalah jawaban yang benar", () => {
  const mei = row({ month: "2026-05", domain: "psaonlineappointment.com" });

  assert.equal(mei.earning, 5165000);
  assert.equal(mei.company, 0);
  // Tarifnya ADA (5% sejak 1 Mei) dan tetap disebut: Rp 0 di kolom Company adalah akibat dari
  // basis Ad Exchange yang nol, bukan dari tarif yang belum diisi — dan itu dua keadaan yang
  // diperbaiki di tempat berbeda.
  assert.equal(mei.companyPercent, "5%");
});

test("hari yang belum bertarif tidak dipotong, dan jumlahnya dilaporkan tersendiri", () => {
  const mei = row({ month: "2026-05", domain: "dekadeko.com" });

  assert.equal(mei.company, 0);
  assert.equal(
    mei.earningWithoutPercent,
    2081949,
    "supaya Rp 0 di kolom Company terbaca sebagai tarif yang belum diisi, bukan bebas potongan",
  );
});

test("bulan + domain tanpa satu pun baris ROI berearning mengosongkan seluruh rantainya", () => {
  const kosong = row({ month: "2026-03", domain: "xiaomidriversdownload.com", saldoSebelumnya: 0 });

  assert.equal(kosong.earning, "");
  assert.equal(kosong.company, "");
  assert.equal(kosong.earningFinal, "");
  // Saldo Close-nya JUSTRU Rp 0, dan nol itu benar: baris ini tidak ditandai Account Close, jadi
  // tidak ada yang hangus — tak peduli earning-nya belum diketahui. Yang menjawab "" cuma baris
  // yang DITUTUP dan earning-nya belum ada: di situ ada saldo yang hangus dan besarnya belum bisa
  // dihitung.
  assert.equal(kosong.saldoClose, 0);
  assert.equal(kosong.saldoAkhir, "", "Rp 0 di sini adalah vonis atas bulan yang laporannya belum datang");
});

test("angka notifikasi yang diketik MENANG, dan selisihnya jadi kolom Sunat Google", () => {
  const base = { month: "2026-04", domain: "xiaomidriversdownload.com", saldoSebelumnya: 116882 };
  const belum = row(base);
  const sudah = row({ ...base, realMasuk: 36737889 });

  // Belum diketik: yang digambar adalah yang seharusnya datang, dan Sunat Google KOSONG — bukan
  // Rp 0, yang akan mengaku bahwa pembukuan sudah diadu dengan mutasi rekening.
  assert.equal(belum.realMasuk, belum.earningFinal);
  assert.equal(belum.sunatGoogle, "");

  assert.equal(sudah.realMasuk, 36737889);
  assert.equal(sudah.sunatGoogle, round(36737889 - belum.earningFinal));
});

test("Saldo Akhir = Real Masuk − Nominal Fee − Potongan Konversi", () => {
  const mei = row({
    month: "2026-05",
    domain: "psaonlineappointment.com",
    saldoSebelumnya: 215163,
    realMasuk: 4882513,
    feePercent: 5,
    potonganKonversi: 451487,
  });

  // Fee dihitung dari yang benar-benar masuk, bukan dari Earning Final: Rp 244.126 pada baris Mei
  // spreadsheet acuan adalah 5% dari Rp 4.882.513, bukan dari Rp 5.094.461.
  assert.equal(mei.feeNominal, 244125.65, "Rp 244.126 di spreadsheet acuan, dibulatkan saat dirender");
  assert.equal(mei.feePercent, "5%");
  assert.equal(mei.saldoAkhir, round(4882513 - 244125.65 - 451487));
});

test("fee yang kosong bukan 0% — tidak ada nominal fee yang digambar", () => {
  const tanpaFee = row({ month: "2026-04", domain: "xiaomidriversdownload.com" });

  assert.equal(tanpaFee.feePercent, "");
  assert.equal(tanpaFee.feeNominal, "");
});

test("pajak negara memungut duluan, dan fee dihitung dari SISANYA", () => {
  // Juli 2026 psaonlineappointment.com, angka sheet "Note Pencairan": Google membayar
  // Rp 40.107.832 dan Rp 33.071.561 mendarat di Binance — kehilangan Rp 7.036.271.
  const juli = row({
    month: "2026-07",
    domain: "psaonlineappointment.com",
    realMasuk: 40107832,
    govTaxPercent: 10,
    feePercent: 5,
    potonganKonversi: 1220635,
  });

  assert.equal(juli.govTaxPercent, "10%");
  assert.equal(juli.govTaxNominal, 4010783.2);
  // INI SELURUH GUNANYA KOLOM PAJAK: 5% dari sisa setelah pajak (Rp 1.804.852), bukan 5% dari
  // yang dibayarkan Google (Rp 2.005.392). Emran memungut dari jumlah setelah pajak Pakistan, dan
  // sampai langkah ini ada, skema payouts tidak punya cara mengungkapkan pembagi selain Real Masuk.
  assert.equal(juli.feeNominal, round((40107832 - 4010783.2) * 0.05));
  assert.ok(juli.feeNominal < 40107832 * 0.05, "pembaginya bukan lagi Real Masuk");
  // Kedua ujung rantainya tetap mendarat di angka yang jadi buktinya. Toleransi Rp 1 karena
  // ketiga pungutannya dibulatkan ke rupiah utuh saat diketik, disiplin yang sama dengan checksum
  // di seed Potongan Company dan Invalid Traffic.
  assert.ok(Math.abs(juli.saldoAkhir - 33071561) <= 1, "mendarat di angka Binance");
  assert.ok(Math.abs(juli.realMasuk - juli.saldoAkhir - 7036271) <= 1, "sebesar Penurunan Earning");
});

test("pajak yang kosong bukan 0% — rantainya identik dengan sebelum kolom ini ada", () => {
  // Syarat yang mengikat: baris yang sudah tersimpan tidak boleh bergeser sedikit pun. Tanpa
  // tarif pajak, pembagi fee kembali Real Masuk dan Saldo Akhir sama persis dengan rumus lama.
  const tanpaPajak = row({
    month: "2026-05",
    domain: "psaonlineappointment.com",
    realMasuk: 4882513,
    feePercent: 5,
    potonganKonversi: 451487,
  });

  assert.equal(tanpaPajak.govTaxPercent, "");
  assert.equal(tanpaPajak.govTaxNominal, "");
  assert.equal(tanpaPajak.feeNominal, 244125.65);
  assert.equal(tanpaPajak.saldoAkhir, round(4882513 - 244125.65 - 451487));
});

test("pajak tanpa fee tetap memotong; akun yang ditutup tidak dipajaki apa pun", () => {
  // Fee kosong tidak boleh menelan pajaknya — keduanya pungutan yang berdiri sendiri.
  const pajakSaja = row({
    month: "2026-07",
    domain: "psaonlineappointment.com",
    realMasuk: 1000000,
    govTaxPercent: 10,
  });
  assert.equal(pajakSaja.feeNominal, "");
  assert.equal(pajakSaja.saldoAkhir, 900000);

  // Real Masuk nol: tidak ada yang mendarat, jadi tidak ada yang dipungut siapa pun.
  const ditutup = row({
    month: "2026-05",
    domain: "xiaomidriversdownload.com",
    govTaxPercent: 10,
    status: ACCOUNT_CLOSE,
  });
  assert.equal(ditutup.govTaxNominal, 0);
  assert.equal(ditutup.saldoAkhir, 0);
});

test("akun yang ditutup Google menghanguskan seluruh saldonya", () => {
  const ditutup = row({
    month: "2026-05",
    domain: "xiaomidriversdownload.com",
    status: ACCOUNT_CLOSE,
  });

  assert.equal(ditutup.saldoClose, ditutup.earningFinal);
  assert.equal(ditutup.realMasuk, 0, "tidak ada yang mendarat di rekening");
  assert.equal(ditutup.saldoAkhir, 0);
  assert.equal(ditutup.sunatGoogle, "", "tidak ada angka notifikasi untuk diadu");
});

test("status selain Account Close tidak menghanguskan apa pun", () => {
  const cair = row({ month: "2026-05", domain: "xiaomidriversdownload.com", status: "Sudah Cair" });

  assert.equal(cair.saldoClose, 0);
  assert.equal(cair.realMasuk, cair.earningFinal);
});

test("bulan dibaca dari `date` untuk baris yang tidak membawa `month`", () => {
  const lama = row({ date: "2026-04-01", domain: "xiaomidriversdownload.com" });

  assert.equal(lama.month, "2026-04");
  assert.equal(lama.earning, 39198872);
});

function round(value) {
  return Math.round(value * 100) / 100;
}
