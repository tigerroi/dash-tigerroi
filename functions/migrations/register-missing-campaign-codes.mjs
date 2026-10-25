// One-off: daftarkan kode campaign Meta yang selama ini tidak menunjuk subdomain mana pun.
//
//   npm run migrate:campaign-codes -- --dry
//   npm run migrate:campaign-codes
//
// KENAPA INI PERLU ADA. `buildCampaignResolver` menempelkan spend sebuah campaign ke subdomain lewat
// kode Keitaro di depan namanya. Kode yang tidak terdaftar di `subDomains.campaignCodes` tidak
// membuat sync mengeluh — belanjanya cuma jatuh ke lantai: tidak masuk baris ROI siapa pun, tidak
// muncul sebagai isu sync, dan tidak terlihat di layar mana pun kecuali sebagai selisih terhadap
// Ads Manager. Audit 4 Sep 2026 menemukan Rp 4.809.704 (Apr-Agu) hilang dengan cara itu.
//
// Tujuan tiap kode DIBACA DARI CERMIN KEITARO (`dashboard/gating/campaigns`), bukan ditebak dari
// besar nominalnya: nama campaign di sana menyebut subdomain tujuannya di ujung namanya sendiri,
// dan itu satu-satunya sumber yang tahu ke mana trafiknya benar-benar dikirim.
//
// `gSrr` menyusul pada 5 Sep 2026, ditemukan dari ringkasan run sync ("n campaign tak terpetakan")
// — bukan dari audit yang sama. Dua kode lain yang muncul di ringkasan itu, 2W7J dan BMrd, sudah
// didaftarkan orang lewat /sub-domains sebelum script ini dijalankan lagi, dan idempotensi di
// bawah yang membuat keduanya lewat tanpa suara.
//
// DUA KODE SENGAJA TIDAK ADA DI SINI:
//
//   LrLk  Rp 2.117.998 (Mei, TBZ 1233). Campaign-nya sudah dihapus dari Keitaro, jadi tidak ada
//         satu pun catatan yang menyebut tujuannya. Kandidat terdekat cuma kemiripan nominal
//         dengan baris trends.stylefemale.com di spreadsheet (Rp 2.203.300) — itu tebakan, dan
//         tebakan yang berdiri di kolom ROI tidak bisa dibedakan dari fakta.
//   ARSIP Rp 48.584 (Apr). Bukan kode yang hilang melainkan campaign `pBRw-00` yang diganti nama
//         dengan awalan "ARSIP", sehingga token pertamanya bukan lagi kodenya. Yang memperbaikinya
//         adalah nama campaign-nya, bukan baris subdomain.
//
// Idempotent: kode yang sudah terdaftar dilewati, subdomain yang sudah ada tidak dibuat ulang, dan
// kode yang ternyata sudah diklaim subdomain LAIN menghentikan barisnya sendiri berikut sebabnya —
// dua subdomain yang mengaku memiliki satu kode tidak bisa dua-duanya benar (`buildCodeIndex`).

import { get, push, ref, update } from "firebase/database";
import { connect } from "../db.mjs";
import { buildCodeIndex, normalizeName, parseCampaignCodes } from "../sync-core.js";

const ACTOR = "migration:campaign-codes";
const dry = process.argv.includes("--dry");

// `create` hanya untuk subdomain yang memang belum pernah terdaftar. `pic` kosong bukan kelalaian:
// lihat catatan per baris.
const PLAN = [
  {
    code: "TGs9",
    subDomain: "material.dekadeko.com",
    evidence: 'Keitaro c16 "ACA T2 (WL) TGs9 Prospek (material.dekadeko.com)"',
  },
  {
    code: "mxcb",
    subDomain: "seniorpet.petcins.com",
    // Keitaro menamainya "(BLACKLIST)" — tidak menyebut subdomain — jadi yang menentukan di sini
    // spreadsheet: baris Juli seniorpet.petcins.com (Ibnu) berbunyi Rp 122.710, angka yang sama
    // persis dengan spend campaign ini, di akun milik Ibnu juga.
    evidence: "nominal Juli cocok persis dengan baris spreadsheet seniorpet.petcins.com (Ibnu)",
  },
  {
    code: "TDjc",
    subDomain: "furniture.dekadeko.com",
    evidence: 'Keitaro c20 "ALDI T2 TBZ 1221 TDjc Prospek (furniture.dekadeko.com)"',
    create: {
      parentDomain: "dekadeko.com",
      // PIC DIKOSONGKAN, dan itu keputusan: tiga sumber menyebut tiga nama untuk subdomain ini —
      // spreadsheet Mei "Bambang", nama campaign Keitaro "ALDI", sementara spend Mei-nya berjalan
      // di TBZ 1236 milik Firman. Nama tebakan di kolom ini memindahkan bonus orang lain.
      pic: "",
      status: "Active",
    },
  },
  {
    code: "NK62",
    subDomain: "bags.stylefemale.com",
    // Ditemukan 5 Sep 2026 dari keluaran `migrate:roi-spend` sendiri, di daftar "campaign yang
    // MASIH tidak ketempel": empat campaign NK62-0x berjumlah Rp 2.082.965. Barisnya sudah ada dan
    // memegang BMrd; NK62 kode KEDUA untuk subdomain yang sama.
    //
    // Kenapa ini mendesak, dan bukan cuma rapi: tanpa baris ini backfill MENANGGALKAN belanja NK62
    // dari baris Agustus yang sudah tersimpan — 27 Agu berbunyi earning Rp 853.631 dengan spend
    // NOL. Nol itu tertulis sebagai nol yang NYATA (`metaMissing` kosong), jadi tidak ada apa pun
    // di layar yang membedakannya dari hari yang benar-benar tidak beriklan, dan labanya naik semu
    // sebesar belanja yang hilang. Lantai `MIN_ROI_SPEND` menahan kolom ROI-nya, tapi tidak
    // menahan kolom Profit.
    evidence: 'Keitaro "FIRMAN T2 (WL) NK62 Prospek (bags.stylefemale.com)" (alias V6HwNK62)',
  },
  {
    code: "gSrr",
    subDomain: "bridal.stylefemale.com",
    // Barisnya sudah ada dan sudah memegang 2W7J; ini kode KEDUA untuk subdomain yang sama, dan
    // itu keadaan yang biasa — satu subdomain menaungi beberapa campaign. Tanpa baris ini
    // belanjanya jatuh ke lantai persis seperti empat kode di atas: tidak masuk ROI siapa pun,
    // dan tidak berbunyi sebagai isu sync mana pun.
    evidence: 'Keitaro "FIRMAN T2 (WL) gSrr Prospek (bridal.stylefemale.com)" (alias hzv5gSrr)',
  },
  {
    code: "5YXK",
    subDomain: "housing.bispdailyupdates.pk",
    evidence: 'Keitaro c49 "ACA T2 (tbz 1235) 5YXK Prospek (housing.bispdailyupdates.pk)"',
    create: {
      parentDomain: "bispdailyupdates.pk",
      // Di sini PIC-nya justru pasti: nama campaign menyebut ACA dan spend-nya berjalan di
      // TBZ 1235, akun milik Aca. Dua sumber yang tidak saling kenal menyebut orang yang sama.
      pic: "Aca",
      status: "Active",
    },
  },
];

const db = await connect();
const subDomains = (await get(ref(db, "subDomains"))).val() || {};
const domains = (await get(ref(db, "domains"))).val() || {};

const idByName = new Map();
for (const [id, sub] of Object.entries(subDomains)) {
  if (!sub || sub.deletedAt || !sub.name) continue;
  idByName.set(normalizeName(sub.name), id);
}
const knownDomains = new Set(
  Object.values(domains)
    .filter((d) => d && !d.deletedAt && d.domainUrl)
    .map((d) => normalizeName(d.domainUrl)),
);
const { byCode } = buildCodeIndex(subDomains);

const creates = [];
const patches = [];
const skipped = [];

for (const item of PLAN) {
  const code = normalizeName(item.code);
  const owner = byCode.get(code);
  if (owner && normalizeName(owner) === normalizeName(item.subDomain)) {
    skipped.push(`${item.code} -> ${item.subDomain} (sudah terdaftar)`);
    continue;
  }
  if (owner) {
    skipped.push(`${item.code} -> ${item.subDomain} DIBATALKAN: kode ini sudah dipegang ${owner}`);
    continue;
  }

  const id = idByName.get(normalizeName(item.subDomain));
  if (!id) {
    if (!item.create) {
      skipped.push(`${item.code} -> ${item.subDomain} DIBATALKAN: subdomainnya belum terdaftar`);
      continue;
    }
    if (!knownDomains.has(normalizeName(item.create.parentDomain))) {
      skipped.push(
        `${item.code} -> ${item.subDomain} DIBATALKAN: domain induk ${item.create.parentDomain} tidak ada di /domains`,
      );
      continue;
    }
    creates.push(item);
    continue;
  }

  const existing = subDomains[id]?.campaignCodes;
  const codes = parseCampaignCodes(existing);
  if (codes.includes(code)) {
    skipped.push(`${item.code} -> ${item.subDomain} (sudah ada di barisnya)`);
    continue;
  }
  // Ditulis dipisah koma, bentuk yang sama dengan yang diketik orang di formnya. `parseCampaignCodes`
  // memecah pada apa pun yang bukan huruf/angka, jadi bentuknya bebas — yang dibaca ORANG tidak.
  const next = String(existing ?? "").trim()
    ? `${String(existing).trim()}, ${item.code}`
    : item.code;
  patches.push({ ...item, id, next, before: existing ?? "" });
}

console.log(`${PLAN.length} kode direncanakan.\n`);
for (const item of creates) {
  console.log(`+ subdomain BARU ${item.subDomain}`);
  console.log(`    kode ${item.code} · domain induk ${item.create.parentDomain} · PIC ${item.create.pic || "(kosong)"}`);
  console.log(`    dasar: ${item.evidence}`);
}
for (const item of patches) {
  console.log(`~ ${item.subDomain}: "${item.before}" -> "${item.next}"`);
  console.log(`    dasar: ${item.evidence}`);
}
for (const line of skipped) console.log(`. ${line}`);

if (!creates.length && !patches.length) {
  console.log("\nTidak ada yang perlu ditulis.");
  process.exit(0);
}

if (dry) {
  console.log(`\n--dry: tidak ada yang ditulis. ${creates.length} subdomain baru, ${patches.length} baris disunting.`);
  process.exit(0);
}

const now = new Date().toISOString();
for (const item of creates) {
  const rowRef = push(ref(db, "subDomains"));
  await update(rowRef, {
    id: rowRef.key,
    name: item.subDomain,
    campaignCodes: item.code,
    ...item.create,
    createdAt: now,
    createdBy: ACTOR,
    updatedAt: now,
    updatedBy: ACTOR,
  });
}
for (const item of patches) {
  await update(ref(db, `subDomains/${item.id}`), {
    campaignCodes: item.next,
    updatedAt: now,
    updatedBy: ACTOR,
  });
}

console.log(
  `\nSelesai. ${creates.length} subdomain dibuat, ${patches.length} baris disunting.` +
    "\nKode hanya dibaca sync BERIKUTNYA — baris ROI yang sudah tersimpan tidak berubah karenanya." +
    "\nUntuk memperbaiki yang lampau: npm run migrate:roi-spend -- --dry",
);
process.exit(0);
