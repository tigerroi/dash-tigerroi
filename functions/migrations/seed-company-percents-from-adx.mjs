// One-off: turunkan tarif Potongan Company yang HILANG dari kolom Rasio di Cost Ad Exchange.
//
//   npm run seed:company-from-adx -- --dry
//   npm run seed:company-from-adx
//   npm run seed:company-from-adx -- --since=2026-08-01
//
// KENAPA INI PERLU ADA. Tarif bagi hasil sebuah domain SUDAH tercatat di dashboard — kolom
// **Rasio** di tab Cost Ad Exchange, yang mencerminkan kolom "RASIO (Turunan/induk)" di spreadsheet
// dan berbunyi "92/8": kita 92, company 8. Yang belum pernah terjadi adalah memindahkannya ke
// `companyPercents`, satu-satunya tempat yang dibaca rantai Laba Rugi. Akibatnya per 4 Sep 2026:
// Rp 47,4 juta pendapatan Ad Exchange Agustus (theglobesimregistration.ph + bispdailyupdates.pk)
// lewat TANPA potongan sama sekali, dan tiga domain lain masih dipotong 20% padahal kontraknya
// sudah turun ke 8% sejak 23 Agustus.
//
// PEMETAANNYA TERBUKTI, BUKAN DITEBAK. Enam dari sepuluh baris `companyPercents` yang sudah ada
// cocok persis dengan angka kedua rasio pada tanggal yang sama (xiaomi 90/10 → 10%, stylefemale
// 90/10 → 10%, psa/masseffect/petcins 80/20 → 20%, xiaomi 85/15 → 15%). Yang TIDAK cocok cuma
// designingaround, dan itu justru alasan `--since` ada di bawah.
//
// BARIS YANG DITULIS HANYA YANG MENGUBAH TARIF. Empat baris Cost Ad Exchange bispdailyupdates.pk
// Agustus semuanya 90/10; yang pertama menetapkan 10%, tiga sisanya tidak menandai apa pun —
// dan baris tarif yang mengulang tarif yang sama cuma memenuhi kolom "Berlaku s/d" dengan rentang
// yang tidak berarti (lihat catatan `seed-company-percents`).
//
// `--since` BAWAANNYA 1 AGUSTUS 2026, DAN ITU BUKAN KEHATI-HATIAN KOSONG. Riwayat April–Juli sudah
// diseed dari kolom Potongan spreadsheet — tarif yang BENAR-BENAR ditagihkan — dan itu tidak selalu
// sama dengan rasio kontraknya: designingaround.com berkontrak 80/20 sepanjang Mei-Juni tapi
// dipotong 74% lalu 54%. Dijalankan tanpa batas ini, migrasi ini akan menimpa bulan-bulan yang
// pencairannya sudah "Sudah Cair" dengan tarif yang tidak pernah ditagihkan kepada siapa pun.

import { get, push, ref, update } from "firebase/database";
import { connect } from "../db.mjs";

/**
 * Tarif yang berlaku pada sebuah tanggal: baris terakhir domain itu yang `effectiveFrom`-nya tidak
 * melewati tanggal tersebut.
 *
 * DITULIS ULANG DI SINI, dan itu disengaja: `companyPercentIndex` tinggal di `src/lib`, dan
 * `functions/` tidak boleh mengimpor dari sana — dua paket yang tidak saling kenal, aturan yang
 * sama yang membuat `campaignCommandEntry` ditulis dua kali. Yang dicerminkan cuma dua barisnya:
 * urut menaik menurut `effectiveFrom`, dan dua baris bertanggal sama diputus `updatedAt` (yang
 * disimpan belakangan menang). Salah menirunya tidak diam-diam: `--dry` mencetak tarif SEBELUM dan
 * SESUDAH tiap perubahan, jadi hasilnya bisa diadu sebelum satu baris pun ditulis.
 */
function percentAt(rows, domain, date) {
  const key = String(domain ?? "")
    .trim()
    .toLowerCase();
  const list = rows
    .filter(
      (row) =>
        String(row?.domain ?? "")
          .trim()
          .toLowerCase() === key && row?.effectiveFrom,
    )
    .sort(
      (a, b) =>
        String(a.effectiveFrom).localeCompare(String(b.effectiveFrom)) ||
        String(a.updatedAt ?? "").localeCompare(String(b.updatedAt ?? "")),
    );
  let found = null;
  for (const row of list) {
    if (String(row.effectiveFrom) > String(date)) break;
    found = row;
  }
  const percent = Number(found?.percent);
  return found && Number.isFinite(percent) ? percent : null;
}

const ACTOR = "migration:company-from-adx";
const dry = process.argv.includes("--dry");
const argOf = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const since = argOf("since", "2026-08-01");
if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) {
  console.error(`--since tidak sah: ${since} (bentuknya YYYY-MM-DD).`);
  process.exit(1);
}

/**
 * Bagian COMPANY dari sebuah rasio "turunan/induk".
 *
 * Angka KEDUA, dan itu disebutkan di kepala spreadsheet-nya sendiri ("Induk = Company"). Dibaca
 * terbalik, tiap domain akan dipotong 90% alih-alih 10% — kesalahan yang besarnya sembilan kali
 * lipat dan tidak berbunyi sebagai kesalahan apa pun di layar mana pun.
 */
function companyShare(ratio) {
  const parts = String(ratio ?? "")
    .split("/")
    .map((part) => Number(String(part).replace(/[^\d.]/g, "")));
  if (parts.length !== 2 || !parts.every((n) => Number.isFinite(n))) return null;
  // Keduanya harus berjumlah 100: "90/10" sah, "90/20" salah ketik yang akan memotong terlalu
  // banyak tanpa ada yang memeriksanya lagi.
  if (Math.round(parts[0] + parts[1]) !== 100) return null;
  return parts[1];
}

const db = await connect();
const adxCosts = Object.values((await get(ref(db, "adxCosts"))).val() || {});
const existing = Object.entries((await get(ref(db, "companyPercents"))).val() || {}).map(
  ([id, row]) => ({ id, ...row }),
);

const rows = adxCosts
  .filter((row) => row && !row.deletedAt && row.domain && String(row.date || "") >= since)
  .sort((a, b) => String(a.date).localeCompare(String(b.date)));

const planned = [];
const skipped = [];
for (const row of rows) {
  const percent = companyShare(row.ratio);
  const label = `${row.date} ${row.domain} (${row.ratio || "tanpa rasio"})`;
  if (percent === null) {
    skipped.push(`${label} — rasionya tidak terbaca`);
    continue;
  }
  // Dinilai terhadap baris yang sudah ada DITAMBAH yang sudah direncanakan: dua baris berturut-turut
  // untuk domain yang sama harus diadu dengan tarif yang baru saja ditetapkan yang pertama, bukan
  // dengan keadaan sebelum migrasi ini jalan.
  const current = percentAt([...existing, ...planned], row.domain, row.date);
  if (current === percent) {
    skipped.push(`${label} — tarifnya sudah ${percent}% pada tanggal itu`);
    continue;
  }
  planned.push({
    domain: row.domain,
    effectiveFrom: row.date,
    percent,
    // `updatedAt` ikut karena `companyPercentIndex` memakainya untuk memutus dua baris bertanggal
    // sama: yang disimpan belakangan menang.
    updatedAt: new Date().toISOString(),
    from: current,
    companyName: row.companyName || "",
  });
}

console.log(`${rows.length} baris Cost Ad Exchange sejak ${since}.\n`);
for (const item of planned) {
  const before = item.from === null ? "belum punya tarif" : `${item.from}%`;
  console.log(
    `+ ${item.effectiveFrom} ${item.domain}: ${before} -> ${item.percent}%  (${item.companyName})`,
  );
}
for (const line of skipped) console.log(`. ${line}`);

if (!planned.length) {
  console.log("\nTidak ada tarif yang perlu ditambahkan.");
  process.exit(0);
}
if (dry) {
  console.log(`\n--dry: tidak ada yang ditulis. ${planned.length} baris tarif akan dibuat.`);
  process.exit(0);
}

for (const item of planned) {
  const rowRef = push(ref(db, "companyPercents"));
  await update(rowRef, {
    id: rowRef.key,
    domain: item.domain,
    effectiveFrom: item.effectiveFrom,
    percent: item.percent,
    note: `Dari kolom Rasio di Cost Ad Exchange${item.companyName ? ` (${item.companyName})` : ""}`,
    createdAt: item.updatedAt,
    createdBy: ACTOR,
    updatedAt: item.updatedAt,
    updatedBy: ACTOR,
  });
}

console.log(`\nSelesai. ${planned.length} baris tarif dibuat.`);
process.exit(0);
