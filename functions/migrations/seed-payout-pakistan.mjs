// One-off: baris pencairan Agustus 2026 untuk tiga domain yang dibayar ke rekening Pakistan.
//
//   npm run seed:payout-pakistan -- --dry
//   npm run seed:payout-pakistan
//
// KENAPA PERLU. `/payouts` Agustus baru memuat designingaround.com dan stylefemale.com. Tiga domain
// yang dibayar lewat Meezan bank (psaonlineappointment.com, bispdailyupdates.pk,
// theglobesimregistration.ph) tidak punya baris, jadi `payoutCostRows` tidak menemukan apa pun dan
// Potongan Pencairan Agustus berbunyi Rp 0 — sementara sheet "Note Pencairan" mencatat Rp 9.426.006
// yang hilang di jalan. Tanpa itu laba Agustus kelebihan sebesar angka itu, dan bonus advertiser
// ikut kelebihan ±Rp 1 juta.
//
// SUMBERNYA "Note Pencairan", BUKAN "DatMas | Laporan Pencairan". Baris Laporan Pencairan untuk
// ketiganya tidak mengisi fee maupun potongan konversi (Saldo Akhir = Real Masuk), jadi ia tidak
// mengatakan apa pun tentang yang hilang. Rantainya ada di Note Pencairan: Tanda Terima Google →
// pajak → fee Emran → konversi → Diterima dari Binance.
//
// PAJAKNYA 5% UNTUK AGUSTUS, BUKAN 10% SEPERTI JULI. Itu yang dibaca dari sheet (Juli: 3.992.090
// dari 39.920.902; Agustus: 1.073.805 dari 21.476.092), dan dituliskan di baris ini — bukan dibaca
// dari `PAYOUT_TAX_PERCENT` — alasan yang sama dengan tarif Company yang bertanggal.
//
// TOTALNYA YANG DIJAGA, pemisahannya tidak. Dashboard memungut pajak dari Real Masuk, sheet dari
// "Diterima Emran" (sesudah potongan bank Rp 405 rb dll.), jadi pajak dan fee di sini sedikit
// berbeda dari sheet. `potonganKonversi` diturunkan sebagai SISA supaya Saldo Akhir mendarat di
// angka Binance, dan selisih di atas Rp 1 menghentikan run — sepola `seed-payout-gov-tax`.
//
// Idempotent: baris bulan + domain yang sudah ada DILEWATI, tidak ditimpa. Yang menyuntingnya lebih
// dulu tahu lebih banyak daripada script ini.

import { get, push, ref, set } from "firebase/database";
import { connect } from "../db.mjs";

const MONTH = "2026-08";
const MEEZAN = { bank: "Meezan bank", namaRekening: "Imran Aslam", noRekening: "PK88MEZN0026010114310624" };
const TAX_PERCENT = 5;
const FEE_PERCENT = 5;

// Dari "Note Pencairan": Tanda Terima Pembayaran Google, Diterima Dari Binance, dan total yang
// hilang (dipakai sebagai CHECKSUM). Kode PIP dari "DatMas | Laporan Pencairan", VERBATIM.
const ROWS = [
  {
    domain: "psaonlineappointment.com",
    google: 21_881_579,
    binance: 18_680_592,
    loss: 3_200_987,
    kodePip: "Pembayaran otomatis: Transfer bank ke rekening bank  • • • •  0624. GG104J4XZJ",
  },
  {
    domain: "bispdailyupdates.pk",
    google: 2_549_535,
    binance: 1_958_880,
    loss: 590_655,
    kodePip: "Pembayaran otomatis: Transfer bank ke rekening bank  • • • •  0624. GG104J5DAG",
  },
  {
    domain: "theglobesimregistration.ph",
    google: 41_268_172,
    binance: 35_633_808,
    loss: 5_634_364,
    kodePip: "Pembayaran otomatis: Transfer bank ke rekening bank  • • • •  0624. GG104IXI7H",
  },
];

const ACTOR = "migration:payout-pakistan";
const dry = process.argv.includes("--dry");
const fmt = (n) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;

const db = await connect();
const existing = Object.values((await get(ref(db, "payouts"))).val() || {}).filter(
  (row) => !row?.deletedAt && row.month === MONTH,
);

const writes = [];
for (const item of ROWS) {
  if (item.google - item.binance !== item.loss) {
    console.error(`${item.domain}: Google − Binance != total potongan sheet — dihentikan.`);
    process.exit(1);
  }
  if (existing.some((row) => String(row.domain || "").trim() === item.domain)) {
    console.log(`${item.domain} ${MONTH} sudah ada — dilewati`);
    continue;
  }

  // Rumus yang sama dengan `payoutRows` (src/lib/payouts.js): pajak dari Real Masuk, fee dari sisa
  // sesudah pajak, konversi sesudahnya.
  const govTax = Math.round((item.google * TAX_PERCENT) / 100);
  const fee = Math.round(((item.google - govTax) * FEE_PERCENT) / 100);
  const potonganKonversi = item.google - govTax - fee - item.binance;
  if (potonganKonversi < 0) {
    console.error(`${item.domain}: pajak + fee melebihi yang hilang (${fmt(item.loss)}) — dihentikan.`);
    process.exit(1);
  }
  const saldoAkhir = item.google - govTax - fee - potonganKonversi;
  if (Math.abs(saldoAkhir - item.binance) > 1) {
    console.error(`${item.domain}: Saldo Akhir ${saldoAkhir} != Binance ${item.binance} — dihentikan.`);
    process.exit(1);
  }

  writes.push({ item, govTax, fee, potonganKonversi, saldoAkhir });
}

for (const { item, govTax, fee, potonganKonversi, saldoAkhir } of writes) {
  console.log(
    `${item.domain}: Real Masuk ${fmt(item.google)} − pajak ${TAX_PERCENT}% ${fmt(govTax)}` +
      ` − fee ${FEE_PERCENT}% ${fmt(fee)} − konversi ${fmt(potonganKonversi)}` +
      ` = Saldo Akhir ${fmt(saldoAkhir)} (potongan ${fmt(item.loss)})`,
  );
}
const total = writes.reduce((sum, { item }) => sum + item.loss, 0);
console.log(`${writes.length} baris, potongan pencairan ${fmt(total)}.`);

if (dry || !writes.length) {
  if (dry) console.log("--dry: tidak ada yang ditulis.");
  process.exit(0);
}

const now = new Date().toISOString();
for (const { item, potonganKonversi } of writes) {
  await set(push(ref(db, "payouts")), {
    month: MONTH,
    date: `${MONTH}-01`,
    domain: item.domain,
    realMasuk: item.google,
    govTaxPercent: TAX_PERCENT,
    feePercent: FEE_PERCENT,
    potonganKonversi,
    ...MEEZAN,
    kodePip: item.kodePip,
    status: "Sudah Cair",
    createdAt: now,
    createdBy: ACTOR,
    updatedAt: now,
    updatedBy: ACTOR,
  });
}
console.log("Selesai.");
process.exit(0);
