// One-off: tandai negara domain, dan pecah pajak pemerintah keluar dari Potongan Konversi.
//
//   npm run seed:payout-gov-tax -- --dry
//   npm run seed:payout-gov-tax
//
// APA YANG DIKERJAKAN. Dua hal, dan keduanya di baris yang sudah ada — tidak ada koleksi baru:
//
//   1. `domains/{id}.country` untuk domain yang negaranya sudah diketahui.
//   2. `payouts/{id}.govTaxPercent` + `potonganKonversi` yang ditulis ulang, untuk baris domain
//      yang negaranya memungut pajak.
//
// KENAPA PERLU. Sampai kolom Pajak Negara ada, skema `payouts` cuma bisa mengalikan Real Masuk,
// jadi pajak pemerintah Pakistan terpaksa disembunyikan di dalam Potongan Konversi dan fee
// perantara dihitung dari angka PENUH yang dibayarkan Google. `fix-payout-fee-double-count.mjs`
// sudah menyebutkan batas itu di badannya sendiri: Emran memungut 5% dari jumlah SETELAH pajak —
// Rp 1.796.441 pada Juli, bukan Rp 2.005.392 — dan selisih Rp 209 ribu itu diterima karena tidak
// ada tempat untuk menyimpan pembaginya. Sekarang ada.
//
// TOTALNYA TIDAK BOLEH BERGESER, DAN ITU SYARAT YANG MENGIKAT. Ketiga baris ini berstatus "Sudah
// Cair"; `payoutCostRows` membacanya sebagai Potongan pencairan di rantai Laba Rugi, dan
// menggesernya menggeser Net Profit serta dasar bonus bulan yang uangnya SUDAH dibayarkan. Jadi
// yang berubah cuma PEMISAHAN di dalamnya: Real Masuk dan Saldo Akhir tetap mendarat di angka
// sheet, dan `potonganKonversi` diturunkan sebagai SISA setelah pajak dan fee dikeluarkan.
//
// SISA RALATNYA DISEBUTKAN, bukan dipilih diam-diam. Dengan pajak 10%, fee Juli jadi Rp 1.804.852
// — sheet menghitungnya Rp 1.796.441, jadi pemisahan Fee/Konversi masih meleset Rp 8.411 (dari
// Rp 209.951 sebelumnya). Yang dijaga tetap kedua TOTAL-nya, dan itu yang dibaca rantai laba.

import { get, ref, update } from "firebase/database";
import { connect } from "../db.mjs";

// Dari sheet "Note Pencairan": D (Tanda Terima Pembayaran Google), R (Diterima Dari Binance Aca).
// R dipakai sebagai CHECKSUM dan bukan sebagai nilai — ia turunan di sana juga, dan baris yang
// tidak mendarat persis di angka itu berarti salah baca.
const SHEET = {
  "2026-05": { google: 5_380_512, binance: 4_660_000 },
  "2026-06": { google: 36_770_155, binance: 30_084_581 },
  "2026-07": { google: 40_107_832, binance: 33_071_561 },
};

// Tarif pajak pemerintah per negara — cerminan `PAYOUT_TAX_PERCENT` di src/lib/countries.js.
// Ditulis dua kali karena `functions/` dan frontend adalah dua paket yang tidak bisa saling impor,
// persis pola `campaignCommandEntry`.
const TAX_PERCENT = { PK: 10 };

// Negara yang sudah diketahui hari ini. Yang tidak disebut di sini DILEWATI, bukan ditebak dari
// akhiran domainnya: tebakan yang tersimpan tidak bisa dibedakan dari yang benar-benar diperiksa
// orang, dan di kolom ini ia memutuskan pajak sebuah pencairan.
const DOMAIN_COUNTRY = {
  "psaonlineappointment.com": "PK",
  "bispdailyupdates.pk": "PK",
  "theglobesimregistration.ph": "PH",
  "petcins.com": "ID",
  "designingaround.com": "ID",
  "masseffectstore.com": "ID",
  "stylefemale.com": "ID",
  "xiaomidriversdownload.com": "ID",
};

const ACTOR = "migration:payout-gov-tax";
const dry = process.argv.includes("--dry");
const fmt = (n) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;
const clean = (value) => String(value ?? "").trim();

const db = await connect();

// --- 1. Negara di baris domain ----------------------------------------------------------------

const domains = Object.entries((await get(ref(db, "domains"))).val() || {}).map(([id, row]) => ({
  id,
  ...row,
}));

const domainWrites = [];
for (const row of domains) {
  const url = clean(row.domainUrl).toLowerCase();
  const country = DOMAIN_COUNTRY[url];
  if (!country) continue;
  // Yang sudah ditandai orang tidak ditimpa: migrasi ini membawa keadaan yang diketahui saat ia
  // ditulis, dan yang menyunting baris itu belakangan tahu lebih banyak.
  if (clean(row.country)) continue;
  domainWrites.push({ id: row.id, url, country });
}

const unknownDomains = Object.keys(DOMAIN_COUNTRY).filter(
  (url) => !domains.some((row) => clean(row.domainUrl).toLowerCase() === url),
);

// --- 2. Pajak di baris pencairan --------------------------------------------------------------

const payouts = Object.entries((await get(ref(db, "payouts"))).val() || {}).map(([id, row]) => ({
  id,
  ...row,
}));

// Negara yang dipakai memutuskan pajak dibaca dari DOMAIN_COUNTRY, bukan dari `domains` yang baru
// saja ditulis di atas: dalam `--dry` node itu belum berubah, dan sebuah migrasi yang hasil
// kering-nya berbeda dari hasil basahnya tidak bisa dipakai memeriksa apa pun.
const payoutWrites = [];
const skipped = [];
const unfit = [];

for (const [month, sheet] of Object.entries(SHEET)) {
  const domain = "psaonlineappointment.com";
  const row = payouts.find((item) => item.month === month && clean(item.domain) === domain);
  if (!row) {
    console.error(`Baris ${month} ${domain} tidak ada — dihentikan.`);
    process.exit(1);
  }

  const percent = TAX_PERCENT[DOMAIN_COUNTRY[domain]];
  if (!percent) {
    console.error(`${domain} tidak berpajak menurut TAX_PERCENT — dihentikan.`);
    process.exit(1);
  }

  // Sudah dipecah pada run sebelumnya: idempotent, dan tidak menulis ulang apa pun.
  if (Number(row.govTaxPercent) === percent) {
    skipped.push(`${month} sudah bertarif ${percent}%`);
    continue;
  }

  const feePercent = Number(row.feePercent);
  if (feePercent !== 5) {
    console.error(`Baris ${month} fee-nya ${row.feePercent}%, bukan 5% — dihentikan.`);
    process.exit(1);
  }

  const realMasuk = Number(row.realMasuk);
  if (realMasuk !== sheet.google) {
    // Baris yang Real Masuk-nya belum dibetulkan `migrate:payout-fee` masih membawa angka
    // "Diterima Bank Emran", dan memecah pajak di atas angka yang salah menghasilkan tiga
    // pungutan yang semuanya rapi dan semuanya salah.
    console.error(
      `Baris ${month} Real Masuk-nya ${fmt(realMasuk)} != ${fmt(sheet.google)} dari sheet.` +
        " Jalankan `npm run migrate:payout-fee` lebih dulu. Dihentikan.",
    );
    process.exit(1);
  }

  const govTax = Math.round((realMasuk * percent) / 100);
  const fee = Math.round(((realMasuk - govTax) * feePercent) / 100);
  // Sisa, bukan angka baru: itu yang menjaga Saldo Akhir tetap mendarat di angka Binance.
  const potonganKonversi = realMasuk - govTax - fee - sheet.binance;

  // BARIS YANG RANTAINYA TIDAK MUAT DILEWATI, BUKAN DIPAKSAKAN — dan bukan pula menjatuhkan
  // seluruh run. Potongan Konversi minus berarti yang MENDARAT lebih besar daripada yang tersisa
  // setelah pajak dan fee dipungut, jadi bulan itu tidak membayar keduanya pada tarif ini. Mei
  // 2026 kehilangan 13,39% sementara Juni dan Juli kehilangan 18,18% dan 17,54%: pajak 10% + fee
  // 5% menuntut Rp 780.174 dari pencairan yang seluruhnya cuma kehilangan Rp 720.512.
  //
  // Menurunkan tarifnya sampai muat adalah presisi yang dikarang, dan memaksakan Potongan Konversi
  // minus lebih buruk lagi: ia MENAMBAH Saldo Akhir lewat pintu belakang, dan `payoutCostRows`
  // lalu melaporkan potongan pencairan yang lebih kecil daripada yang benar-benar hilang. Yang
  // dilewati tidak kehilangan apa-apa — totalnya sudah benar sejak `migrate:payout-fee`, dan yang
  // tidak terpecah cuma pemisahan di dalamnya, persis keadaan sebelum kolom pajak ada.
  if (potonganKonversi < 0) {
    unfit.push({
      month,
      loss: realMasuk - sheet.binance,
      lossPct: ((realMasuk - sheet.binance) / realMasuk) * 100,
      demanded: govTax + fee,
      percent,
      feePercent,
    });
    continue;
  }

  const saldoAkhir = realMasuk - govTax - fee - potonganKonversi;
  if (Math.abs(saldoAkhir - sheet.binance) > 1) {
    console.error(
      `Baris ${month}: Saldo Akhir turunan ${saldoAkhir} != ${sheet.binance} dari sheet. Dihentikan.`,
    );
    process.exit(1);
  }

  const beforeFee = Math.round((realMasuk * feePercent) / 100);
  payoutWrites.push({
    id: row.id,
    month,
    govTax,
    percent,
    fee,
    beforeFee,
    potonganKonversi,
    // Konversi sebagai persen bruto: itu angka yang membuat hasilnya bisa DIPERIKSA lintas bulan.
    // Ketiganya lewat rantai yang sama, jadi persennya harus berdekatan — yang menyimpang jauh
    // berarti tarifnya salah dibaca, dan itu tidak berbunyi sebagai kesalahan di mana pun.
    konversiPct: (potonganKonversi / realMasuk) * 100,
    beforeKonversi: Number(row.potonganKonversi || 0),
    saldoAkhir,
  });
}

// --- laporan ------------------------------------------------------------------------------------

for (const item of domainWrites) console.log(`domain  ${item.url} -> ${item.country}`);
for (const url of unknownDomains) console.log(`domain  ${url} belum terdaftar di /domains — dilewati`);
for (const note of skipped) console.log(`payout  ${note} — dilewati`);

for (const item of payoutWrites) {
  console.log(
    `payout  ${item.month}  Pajak ${item.percent}% ${fmt(item.govTax)}` +
      `  |  Fee ${fmt(item.beforeFee)} -> ${fmt(item.fee)}` +
      `  |  Konversi ${fmt(item.beforeKonversi)} -> ${fmt(item.potonganKonversi)} (${item.konversiPct.toFixed(2)}% bruto)` +
      `  |  Saldo Akhir ${fmt(item.saldoAkhir)} (tetap)`,
  );
}

for (const item of unfit) {
  console.log(
    `payout  ${item.month} DILEWATI — rantai ${item.percent}%+${item.feePercent}% menuntut ` +
      `${fmt(item.demanded)}, sementara yang hilang seluruhnya cuma ${fmt(item.loss)} ` +
      `(${item.lossPct.toFixed(2)}% bruto). Totalnya sudah benar; yang tidak terpecah cuma ` +
      "pemisahan di dalamnya.",
  );
}

if (!domainWrites.length && !payoutWrites.length) {
  console.log("\nTidak ada yang perlu ditulis.");
  process.exit(0);
}

if (dry) {
  console.log(
    `\n--dry: tidak ada yang ditulis. ${domainWrites.length} domain dan ${payoutWrites.length} baris pencairan akan disentuh` +
      (unfit.length ? `, ${unfit.length} dilewati` : "") +
      ".",
  );
  process.exit(0);
}

const now = new Date().toISOString();
for (const item of domainWrites) {
  await update(ref(db, `domains/${item.id}`), {
    country: item.country,
    updatedAt: now,
    updatedBy: ACTOR,
  });
}
for (const item of payoutWrites) {
  await update(ref(db, `payouts/${item.id}`), {
    govTaxPercent: item.percent,
    potonganKonversi: item.potonganKonversi,
    updatedAt: now,
    updatedBy: ACTOR,
  });
}

console.log(
  `\nSelesai. ${domainWrites.length} domain ditandai, ${payoutWrites.length} baris pencairan dipecah pajaknya` +
    (unfit.length ? `, ${unfit.length} dilewati karena rantainya tidak muat` : "") +
    ".",
);
process.exit(0);
