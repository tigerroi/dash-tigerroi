// One-off: hentikan fee rekening perantara terhitung DUA KALI di tiga baris pencairan Pakistan.
//
//   npm run migrate:payout-fee -- --dry
//   npm run migrate:payout-fee
//
// APA YANG SALAH. Rantai tab Pencairan berbunyi `Saldo Akhir = Real Masuk − Nominal Fee −
// Potongan Konversi`, dengan `Nominal Fee = Fee % × Real Masuk`. Ketiga baris
// psaonlineappointment.com diseed dengan `feePercent: 5` DAN `potonganKonversi` berisi SELURUH
// kehilangan bulan itu — fee perantara sudah termasuk di dalamnya. Fee-nya karena itu dikurangkan
// dua kali, dan Saldo Akhir Juli 2026 berbunyi Rp 31.066.169 untuk pencairan yang benar-benar
// mendarat Rp 33.071.561: selisih Rp 2.005.392, persis sebesar fee-nya.
//
// KENAPA BARU KETAHUAN SEKARANG. Sampai hari ini tidak ada satu pun halaman yang MEMBACA kolom
// Saldo Akhir — ia berhenti di tabelnya sendiri, dan tidak ada apa pun di layar yang mengadunya
// dengan mutasi rekening. Sejak `payoutCostRows` ada, selisih itu masuk rantai Laba Rugi sebagai
// "Potongan pencairan": Juli 2026 berbunyi Rp 9.041.663 untuk kehilangan yang sebenarnya
// Rp 7.036.271, dan Rp 2 juta yang tidak pernah hilang itu ikut mengurangi bonus advertiser.
//
// MEI SALAH DI TEMPAT LAIN. `realMasuk`-nya diketik 4.882.513 — angka "Diterima Bank Emran",
// bukan "Tanda Terima Pembayaran Google" (5.380.512) yang dipakai baris Juni dan Juli. Kolomnya
// bernama Real Masuk REKENING dan yang dimaksudkannya adalah angka notifikasi Google, jadi baris
// Mei-lah yang menyimpang. `potonganKonversi`-nya sudah benar: 451.487 memang sisa setelah fee 5%
// dari 5.380.512 dikeluarkan dari kehilangan Rp 720.512.
//
// FEE TETAP 5% DARI REAL MASUK, DAN ITU BATAS YANG DISEBUTKAN. Emran memungut 5% dari jumlah
// SETELAH pajak pemerintah Pakistan, bukan dari yang dibayarkan Google — Rp 1.796.441 pada Juli,
// bukan Rp 2.005.392. Skema `payouts` tidak punya cara mengungkapkan pembagi selain Real Masuk,
// jadi yang dipilih adalah menjaga kedua TOTAL-nya eksak (Saldo Akhir mendarat di angka Binance,
// dan kehilangannya sebesar Penurunan Earning) sementara pemisahan Fee/Konversi di dalamnya
// meleset Rp 209 ribu. Yang terbaca di rantai laba adalah jumlahnya, dan jumlahnya benar.

import { get, ref, update } from "firebase/database";
import { connect } from "../db.mjs";

// Dari sheet "Note Pencairan", kolom D (Tanda Terima Pembayaran Google), R (Diterima Dari Binance
// Aca), dan T (Penurunan Earning). R dipakai sebagai CHECKSUM, bukan sebagai nilai: ia turunan di
// sana juga, dan baris yang tidak mendarat persis di angka itu berarti salah baca — bukan sesuatu
// yang boleh tersimpan diam-diam lalu memotong laba bulan lampau.
const SHEET = {
  "2026-05": { google: 5_380_512, binance: 4_660_000, loss: 720_512 },
  "2026-06": { google: 36_770_155, binance: 30_084_581, loss: 6_685_574 },
  "2026-07": { google: 40_107_832, binance: 33_071_561, loss: 7_036_271 },
};
const DOMAIN = "psaonlineappointment.com";
const ACTOR = "migration:payout-fee-double-count";
const dry = process.argv.includes("--dry");

const fmt = (n) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;

const db = await connect();
const rows = Object.entries((await get(ref(db, "payouts"))).val() || {}).map(([id, row]) => ({
  id,
  ...row,
}));

const planned = [];
for (const [month, sheet] of Object.entries(SHEET)) {
  const row = rows.find(
    (item) => item.month === month && String(item.domain || "").trim() === DOMAIN,
  );
  if (!row) {
    console.error(`Baris ${month} ${DOMAIN} tidak ada — tidak ada yang bisa dibetulkan.`);
    process.exit(1);
  }

  const feePercent = Number(row.feePercent);
  if (feePercent !== 5) {
    console.error(`Baris ${month} fee-nya ${row.feePercent}%, bukan 5% — dihentikan.`);
    process.exit(1);
  }

  const realMasuk = sheet.google;
  const feeNominal = Math.round((realMasuk * feePercent) / 100);
  const potonganKonversi = sheet.loss - feeNominal;
  const saldoAkhir = realMasuk - feeNominal - potonganKonversi;

  // Checksum: Saldo Akhir yang lahir dari rantai harus mendarat di angka Binance yang jadi
  // buktinya. Selisih di atas Rp 1 menghentikan seluruh run — sepola dengan seed Potongan Company
  // dan Invalid Traffic.
  if (Math.abs(saldoAkhir - sheet.binance) > 1) {
    console.error(
      `Baris ${month}: Saldo Akhir turunan ${saldoAkhir} != ${sheet.binance} dari sheet. Dihentikan.`,
    );
    process.exit(1);
  }

  const beforeReal = Number(row.realMasuk || 0);
  const before = Math.round(
    beforeReal - (beforeReal * feePercent) / 100 - Number(row.potonganKonversi || 0),
  );
  planned.push({ id: row.id, month, realMasuk, potonganKonversi, saldoAkhir, before, sheet });
}

for (const item of planned) {
  console.log(
    `${item.month}  Real Masuk ${fmt(item.realMasuk)}  |  Konversi & Gov Tax ${fmt(item.potonganKonversi)}` +
      `  |  Saldo Akhir ${fmt(item.before)} -> ${fmt(item.saldoAkhir)}` +
      `  |  Potongan pencairan ${fmt(item.sheet.loss)}`,
  );
}

if (dry) {
  console.log(`\n--dry: tidak ada yang ditulis. ${planned.length} baris akan dibetulkan.`);
  process.exit(0);
}

const now = new Date().toISOString();
for (const item of planned) {
  await update(ref(db, `payouts/${item.id}`), {
    realMasuk: item.realMasuk,
    potonganKonversi: item.potonganKonversi,
    updatedAt: now,
    updatedBy: ACTOR,
  });
}

console.log(`\nSelesai. ${planned.length} baris dibetulkan.`);
process.exit(0);
