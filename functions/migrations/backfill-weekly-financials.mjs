// One-off: isi `dashboard/weeklyFinancials` April–Juli 2026 dari spreadsheet, dan betulkan belanja
// `accountCloses` Mei yang terhitung dua kali.
//
//   npm run migrate:weekly-financials -- --dry
//   npm run migrate:weekly-financials
//
// KENAPA INI PERLU ADA. Baris Pendapatan di Laba Rugi membaca `weeklyFinancials`, dan node itu baru
// mulai terisi 6 Juli 2026 — dashboard ini memang baru dibuat sekitar bulan itu. April, Mei, dan
// Juni karena itu tidak punya satu titik pun, dan yang tersisa sebagai pendapatan bulan-bulan itu
// cuma `accountCloses`. Akibatnya per 4 Sep 2026 halaman Laba Rugi melaporkan Juni 2026 dengan
// pendapatan Rp 3,25 juta dan Net Income Owner MINUS Rp 90,4 juta — untuk bulan yang menurut
// `roiReports` menghasilkan Rp 304,9 juta.
//
// Juli pun tidak selamat walau titiknya ada: 26 hari yang tersimpan berjumlah Rp 414,0 juta,
// sementara `roiReports` hari-hari yang sama berjumlah Rp 455,4 juta — titik-titik paling awal
// ditulis dengan `grossRevenue: 0`. Jadi Juli ikut ditulis ulang, bukan cuma ditambal lima harinya.
//
// ═══ ANGKANYA DARI SPREADSHEET, DAN DICOCOKKAN DENGAN BLOK RINGKASANNYA SENDIRI ═══
//
// `SHEET` di bawah adalah total bulanan sheet "DatMas | Lap.Arus Pendapatan (C)" — berskala usaha,
// termasuk domain yang akunnya ditutup. Yang ditulis ke `weeklyFinancials` adalah SISANYA setelah
// `accountCloses` dikeluarkan, karena Laba Rugi menjumlahkan keduanya
// (`revenue = Σ grossRevenue + closedEarning`). Ditulis utuh, tiap rupiah xiaomi terhitung dua kali.
//
// Hasil pengurangan itu bukan tebakan: spreadsheet menghitungnya sendiri di dua blok lain, dan
// keduanya cocok sampai rupiah terakhir —
//   Mei  148.478.544 − 78.890.471 = 69.588.073  ("EARNING BULAN MAY" di Rekap % Advertiser)
//        36.990.790 − 21.082.102 = 15.908.688  ("AD SPEND + AD TAX" di blok yang sama)
//   Juni 308.080.739 −  3.253.046 = 304.827.693 ("EARNING BULAN JUNE" di % Advertiser)
//        55.340.217 −  1.869.585 =  53.470.632 ("AD SPEND + AD TAX" di blok yang sama)
//
// ═══ MEI: BELANJA AKUN TUTUP DITURUNKAN, DAN ITU BAGIAN KEDUA MIGRASI INI ═══
//
// SUDAH DIBALIKKAN — lihat `fix-may-spend-attribution.mjs` (5 Sep 2026). Yang ditemukan bagian ini
// benar (belanja Mei memang terhitung dua kali), kesimpulannya salah: yang berlebih bukan angka
// ketikan xiaomi melainkan baris ROI empat subdomain yang sepanjang Mei berearning Rp 0 dan baru
// mulai berearning di Juni — kode campaign-nya sudah berpindah tujuan sebelum riwayat Mei
// di-backfill. Bagian ini dibiarkan berdiri apa adanya karena ia tidak lagi menurunkan apa pun:
// dengan belanja terpetakan Mei tinggal Rp 8,3 juta, `min()` di bawah memilih angka spreadsheet.
//
// Mei adalah satu-satunya bulan yang kedua sisinya bertabrakan. `roiReports` Mei mencatat belanja
// Rp 30.138.554 — seluruhnya dari akun yang masih bisa dibaca token, dan terbukti persis sama
// dengan yang dijawab Meta API — sementara `accountCloses` Mei menambahkan Rp 21.082.102 lagi.
// Bersama-sama Rp 51.220.656, untuk bulan yang seluruh akunnya paling banyak bisa membelanjakan
// Rp 41,6 juta (Rp 32,65 juta dari akun terjangkau + sisa top-up ke WL lama). Sebagian belanja
// xiaomi Mei berjalan di akun yang terjangkau, sudah tercatat di `roiReports` atas nama subdomain
// lain, lalu diketik lagi sebagai baris xiaomi.
//
// Yang diturunkan adalah baris ketikannya, ke SISA terhadap total spreadsheet:
//
//   belanja akun tutup Mei = 36.990.790 (total sheet) − 30.138.554 (roiReports) = 6.852.236
//
// Bukan angka yang dikarang: ia jatuh di bawah plafon top-up ke WL tak terlacak (Rp 8,97 juta), dan
// sesudahnya Cash Flow DAN Laba Rugi sama-sama berjumlah persis Rp 36.990.790. EARNING-nya TIDAK
// disentuh — pendapatan xiaomi memang tidak ada di `roiReports` mana pun, jadi di sana tidak ada
// yang terhitung dua kali.
//
// Konsekuensi yang diketahui: `seed:account-closes` idempotent lewat kunci turunan, jadi
// menjalankannya lagi akan MENGEMBALIKAN Rp 21.082.102. Barisnya karena itu membawa `note` yang
// menyebutkan sebabnya.
//
// ═══ BENTUK HARIANNYA DITURUNKAN, DAN CUMA TOTAL BULANANNYA YANG NYATA ═══
//
// `weeklyFinancials` berisi satu titik per HARI (grafik Overview membacanya), sementara spreadsheet
// cuma tahu bulan. Totalnya dibagi ke hari-hari menurut PORSI HARIAN `roiReports` — bentuk dari data
// nyata, bukan garis lurus yang dikarang. April tidak punya satu baris ROI pun, jadi bagiannya rata;
// itu disebutkan di sini karena tidak ada apa pun di layar yang bisa membedakannya.

import { get, ref, update } from "firebase/database";
import { connect } from "../db.mjs";

const ACTOR = "migration:weekly-financials";
const dry = process.argv.includes("--dry");

// Total bulanan sheet "DatMas | Lap.Arus Pendapatan (C)" — 76 baris, April–Juli 2026.
const SHEET = {
  "2026-04": { earning: 41_710_637, totalSpending: 10_981_828 },
  "2026-05": { earning: 148_478_544, totalSpending: 36_990_790 },
  "2026-06": { earning: 308_080_739, totalSpending: 55_340_217 },
  "2026-07": { earning: 471_858_842, totalSpending: 139_251_408 },
};
// Tarif pajak iklan yang dipakai memecah "Ad Spend + Ad Tax" jadi dua kolom. Spreadsheet cuma
// menyimpan jumlahnya; Laba Rugi menampilkan keduanya sebagai baris terpisah, dan yang wajib dijaga
// adalah Total belanja = Belanja + Pajak — bukan ketepatan pecahannya.
const AD_TAX_RATE = 0.05;

const round2 = (n) => Math.round(n * 100) / 100;
const rp = (n) => Math.round(n).toLocaleString("id-ID");

function daysOf(month) {
  const [year, mon] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  return Array.from({ length: last }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}

/**
 * Membagi `total` ke hari-hari menurut `weights`, dengan sisa terbesar.
 *
 * Pembulatan sisa terbesar, bukan pembulatan per hari: yang kedua meleset beberapa rupiah dari
 * total bulanan, dan angka yang meleset dari spreadsheet adalah persis yang migrasi ini ada untuk
 * membereskannya. Bobot yang seluruhnya nol jatuh ke pembagian rata — bulan yang tidak punya bentuk
 * harian sama sekali.
 */
function spread(total, days, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  const share = sum > 0 ? weights.map((w) => w / sum) : days.map(() => 1 / days.length);
  const raw = share.map((s) => total * s);
  const floors = raw.map((v) => Math.floor(v * 100) / 100);
  let rest = round2(total - floors.reduce((a, b) => a + b, 0));
  const order = raw
    .map((v, i) => ({ i, frac: v - floors[i] }))
    .sort((a, b) => b.frac - a.frac);
  const out = [...floors];
  for (const { i } of order) {
    if (rest <= 0) break;
    const step = Math.min(0.01, rest);
    out[i] = round2(out[i] + step);
    rest = round2(rest - step);
  }
  return out;
}

const db = await connect();
const roiReports = Object.entries((await get(ref(db, "dashboard/roiReports"))).val() || {}).map(
  ([key, row]) => ({ ...row, date: row?.date || key.split("__")[0] }),
);
const closes = Object.entries((await get(ref(db, "accountCloses"))).val() || {}).map(
  ([id, row]) => ({ id, ...row }),
);
const existing = (await get(ref(db, "dashboard/weeklyFinancials"))).val() || {};

// Bentuk harian dari baris ROI. Yang tidak diketahui tidak menyumbang bobot — bukan nol yang
// dikarang, cuma hari yang tidak punya suara dalam pembagian.
const daily = new Map();
for (const row of roiReports) {
  const date = String(row.date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
  const entry = daily.get(date) || { earning: 0, spending: 0 };
  if (row.earning !== "" && row.earning != null) entry.earning += Number(row.earning) || 0;
  if (row.totalSpending !== "" && row.totalSpending != null)
    entry.spending += Number(row.totalSpending) || 0;
  daily.set(date, entry);
}

const monthOf = (row) => String(row?.month || String(row?.date || "").slice(0, 7));
const points = {};
const closeEdits = [];
const summary = [];

for (const [month, sheet] of Object.entries(SHEET)) {
  const rows = closes.filter((row) => monthOf(row) === month);
  const closedEarning = rows.reduce((a, r) => a + (Number(r.earning) || 0), 0);
  const closedSpendNow = rows.reduce((a, r) => a + (Number(r.totalSpending) || 0), 0);
  const days = daysOf(month);
  const roiSpend = days.reduce((a, d) => a + (daily.get(d)?.spending || 0), 0);

  // Belanja akun tutup yang MASIH masuk akal: total bulan itu dikurangi belanja yang sudah berdiri
  // di baris ROI. Kalau yang tersimpan sudah lebih kecil, ia dibiarkan — migrasi ini membetulkan
  // yang tumpang tindih, bukan menyamakan semua bulan ke satu rumus.
  const closedSpend = Math.min(closedSpendNow, Math.max(0, round2(sheet.totalSpending - roiSpend)));
  if (closedSpend !== closedSpendNow) {
    const factor = closedSpendNow > 0 ? closedSpend / closedSpendNow : 0;
    for (const row of rows) {
      const before = Number(row.totalSpending) || 0;
      closeEdits.push({ id: row.id, month, subDomain: row.subDomain, before, after: round2(before * factor) });
    }
  }

  const earning = round2(sheet.earning - closedEarning);
  const spending = round2(sheet.totalSpending - closedSpend);
  const earningPerDay = spread(earning, days, days.map((d) => daily.get(d)?.earning || 0));
  const spendPerDay = spread(spending, days, days.map((d) => daily.get(d)?.spending || 0));

  days.forEach((date, i) => {
    const totalSpending = spendPerDay[i];
    const totalSpend = round2(totalSpending / (1 + AD_TAX_RATE));
    const [y, m, d] = date.split("-");
    points[date] = {
      date,
      period: `${d}/${m}/${y.slice(2)}`,
      grossRevenue: earningPerDay[i],
      totalSpend,
      adTax: round2(totalSpending - totalSpend),
      totalSpending,
      partial: false,
      // Penanda bahwa titik ini TIDAK datang dari sync: totalnya nyata (spreadsheet), bentuk
      // hariannya diturunkan. Tanpa ini keduanya tidak bisa dibedakan siapa pun.
      source: "spreadsheet",
      updatedAt: new Date().toISOString(),
      updatedBy: ACTOR,
    };
  });

  summary.push({
    month,
    days: days.length,
    hadPoints: days.filter((d) => existing[d]).length,
    roiEarning: days.reduce((a, d) => a + (daily.get(d)?.earning || 0), 0),
    roiSpend,
    closedEarning,
    closedSpendNow,
    closedSpend,
    earning,
    spending,
    flat: days.every((d) => !(daily.get(d)?.earning || daily.get(d)?.spending)),
  });
}

console.log("bulan | titik lama | pendapatan ditulis | belanja ditulis | akun tutup (belanja) | bentuk harian\n");
for (const s of summary) {
  const closed =
    s.closedSpend === s.closedSpendNow
      ? `${rp(s.closedSpendNow)} (tetap)`
      : `${rp(s.closedSpendNow)} -> ${rp(s.closedSpend)}`;
  console.log(
    [
      s.month,
      `${s.hadPoints}/${s.days}`,
      rp(s.earning),
      rp(s.spending),
      closed,
      s.flat ? "RATA (tidak ada baris ROI)" : "porsi harian roiReports",
    ].join(" | "),
  );
}

console.log("\nSesudahnya, Laba Rugi tiap bulan akan berbunyi:");
for (const s of summary) {
  console.log(
    `  ${s.month}: pendapatan ${rp(s.earning + s.closedEarning)} · belanja ${rp(s.spending + s.closedSpend)}` +
      ` (spreadsheet: ${rp(SHEET[s.month].earning)} · ${rp(SHEET[s.month].totalSpending)})`,
  );
}

if (closeEdits.length) {
  console.log("\nBaris accountCloses yang belanjanya diturunkan:");
  for (const e of closeEdits) console.log(`  ${e.month} ${e.subDomain}: ${rp(e.before)} -> ${rp(e.after)}`);
}

const wrote = Object.keys(points).length;
if (dry) {
  console.log(`\n--dry: tidak ada yang ditulis. ${wrote} titik harian, ${closeEdits.length} baris accountCloses.`);
  process.exit(0);
}

for (const [date, point] of Object.entries(points)) {
  await update(ref(db, `dashboard/weeklyFinancials/${date}`), point);
}
for (const edit of closeEdits) {
  await update(ref(db, `accountCloses/${edit.id}`), {
    totalSpending: edit.after,
    note: `Belanja diturunkan dari Rp ${rp(edit.before)}: sebagian sudah berdiri di roiReports atas nama subdomain lain (audit 4 Sep 2026). Menjalankan seed:account-closes lagi akan mengembalikannya.`,
    updatedAt: new Date().toISOString(),
    updatedBy: ACTOR,
  });
}

console.log(`\nSelesai. ${wrote} titik harian ditulis, ${closeEdits.length} baris accountCloses disunting.`);
process.exit(0);
