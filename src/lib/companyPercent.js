import { shiftDateKey, toDateKey } from "./dateRange.js";
import { toPercent } from "./numbers.js";

/**
 * Tarif Potongan Company Ad Exchange, BERTANGGAL: satu domain punya beberapa tarif berturut-turut,
 * masing-masing berlaku sejak sebuah tanggal sampai tarif berikutnya menggantikannya.
 *
 * Sebelumnya ia satu kolom di `domains` — satu nilai per domain, ditimpa tiap kali berubah. Yang
 * dibayar karenanya bukan kerapian melainkan RIWAYAT: tarif petcins.com yang naik dari 10% ke 20%
 * bulan ini menghitung ulang seluruh bulan lampau dengan tarif hari ini, dan laba Juni yang sudah
 * dilaporkan berubah sendiri tanpa satu pun baris yang disunting. Alasan yang sama persis yang
 * menjadikan `invalidTraffic` dan `adxCosts` koleksi sendiri dan bukan kolom di `domains`.
 *
 * SATUANNYA TANGGAL, bukan bulan. Sebuah domain di-relink ke company lain di tengah bulan (lihat
 * `adxCosts`: 21 Mei, 11 Juni), dan tarif barunya berlaku sejak hari itu — bukan sejak tanggal 1.
 * Konsekuensinya diketahui dan diterima: yang memakai tarif ini harus menghitung PER BARIS ROI
 * HARIAN, bukan mengalikan earning sebulan dengan satu tarif. `splitByOwner` di profitLoss.js
 * memang begitu; halaman Invalid Traffic tidak, dan karena itu ia tidak memakai tarif ini sama
 * sekali.
 */

/**
 * Pencari tarif: `percentAt(domain, tanggal)` menjawab tarif yang berlaku pada hari itu.
 *
 * BELUM ADA TARIF BERARTI NULL, BUKAN 0%. Tanggal sebelum baris paling awal sebuah domain tidak
 * jatuh ke tarif paling awal itu — kalau seseorang mengisi tarif baru berlaku 1 Okt hari ini,
 * seluruh riwayat sebelumnya tidak boleh ikut terpotong dengan tarif yang belum pernah berlaku.
 * Itu persis keadaan yang koleksi ini ada untuk mencegahnya. Yang tidak punya tarif dilaporkan
 * `earningWithoutPercent` di Laba Rugi, bukan dianggap bebas potongan.
 */
export function companyPercentIndex(rows = [], field = "domain") {
  const byDomain = new Map();

  for (const row of rows || []) {
    const domain = normalize(row?.[field]);
    const from = dateKeyOf(row?.effectiveFrom);
    const percent = toPercent(row?.percent);
    // Baris tanpa domain atau tanpa tanggal berlaku tidak bisa dicari siapa pun. Tarif yang KOSONG
    // tetap masuk: ia baris yang sengaja dibuat orang, dan artinya "sejak tanggal ini tarifnya
    // tidak diketahui" — bukan "tarif sebelumnya masih berlaku".
    if (!domain || !from) continue;
    const list = byDomain.get(domain) || [];
    list.push({ from, percent, updatedAt: String(row?.updatedAt ?? "") });
    byDomain.set(domain, list);
  }

  // Diurut sekali di sini, bukan tiap kali dicari: `splitByOwner` memanggil pencarinya sekali per
  // baris ROI harian, dan sebulan penuh armada ini ribuan baris.
  //
  // Dua baris bertanggal berlaku SAMA diputus oleh `updatedAt`: yang disimpan belakangan menang.
  // Itu satu-satunya tie-break yang datanya ada, dan halaman menandai yang kalah "Ditimpa" supaya
  // keadaan itu terbaca alih-alih jadi tarif yang berpindah sendiri.
  for (const list of byDomain.values()) {
    list.sort((a, b) => a.from.localeCompare(b.from) || a.updatedAt.localeCompare(b.updatedAt));
  }

  // Baris yang berlaku pada hari itu, atau null kalau belum ada satu pun. Dibedakan dari tarifnya
  // karena baris bertarif KOSONG juga sebuah jawaban — Tarif Bonus membutuhkan bedanya.
  const entryAt = (domain, date) => {
    const list = byDomain.get(normalize(domain));
    const key = dateKeyOf(date);
    if (!list || !key) return null;
    let found = null;
    for (const entry of list) {
      if (entry.from > key) break;
      found = entry;
    }
    return found;
  };

  return {
    entryAt,
    percentAt: (domain, date) => entryAt(domain, date)?.percent ?? null,
  };
}

/**
 * Baris tabel Potongan Company, berikut kolom turunannya: sampai kapan sebuah tarif berlaku, dan
 * apakah ia yang sedang berlaku hari ini.
 *
 * KEDUANYA DITURUNKAN, tidak disimpan. "Berlaku s/d" adalah sehari sebelum tarif berikutnya di
 * domain yang sama — disimpan, ia harus ditulis ulang ke baris LAMA tiap kali baris baru dibuat,
 * dan baris lama yang terlewat akan mengaku masih berlaku selamanya. Begitu juga statusnya, yang
 * berganti sendiri saat tanggalnya lewat tanpa ada yang menyentuh apa pun.
 */
export function companyPercentRows(items = [], _store = {}, now = new Date(), field = "domain") {
  const rows = Array.isArray(items) ? items : [];
  const today = toDateKey(now);

  // Baris satu domain, terurut — pembanding untuk mencari penggantinya. Urutannya sama persis
  // dengan `companyPercentIndex`, dan itu wajib: kolom yang menyebut sebuah baris "Aktif" sementara
  // Laba Rugi memakai baris lain untuk hari yang sama adalah dua jawaban untuk satu pertanyaan.
  const byDomain = new Map();
  for (const row of rows) {
    const domain = normalize(row?.[field]);
    if (!domain) continue;
    const list = byDomain.get(domain) || [];
    list.push(row);
    byDomain.set(domain, list);
  }
  for (const list of byDomain.values()) {
    list.sort(
      (a, b) =>
        dateKeyOf(a?.effectiveFrom).localeCompare(dateKeyOf(b?.effectiveFrom)) ||
        String(a?.updatedAt ?? "").localeCompare(String(b?.updatedAt ?? "")),
    );
  }

  return rows.map((row) => {
    const domain = normalize(row?.[field]);
    const from = dateKeyOf(row?.effectiveFrom);
    const list = byDomain.get(domain) || [];
    const position = list.indexOf(row);
    const next = position >= 0 ? list[position + 1] : null;
    const nextFrom = dateKeyOf(next?.effectiveFrom);

    return {
      ...row,
      // Kosong untuk yang terakhir, dan kosong itu benar: tarif yang belum ada penggantinya berlaku
      // sampai kapan pun. "-" yang digambar renderCell membacanya persis begitu.
      effectiveTo: nextFrom && from ? shiftDateKey(nextFrom, -1) : "",
      status: statusOf({ from, nextFrom, today }),
    };
  });
}

/**
 * Empat keadaan, dan keempatnya berarti tindakan yang berbeda.
 *
 *   Aktif      tarif yang sedang dipakai Laba Rugi hari ini.
 *   Terjadwal  tanggal berlakunya belum sampai. Belum menyentuh angka mana pun.
 *   Berakhir   sudah digantikan tarif berikutnya. Tetap dipakai untuk bulan-bulan lampau, dan itu
 *              seluruh alasan koleksi ini ada — jadi ia bukan baris mati yang boleh dihapus.
 *   Ditimpa    tarif berikutnya berlaku pada tanggal yang SAMA atau lebih awal, jadi baris ini
 *              tidak pernah berlaku satu hari pun. Hampir selalu salah ketik tanggal, dan tanpa
 *              kolom ini ia terbaca persis seperti tarif yang sudah berakhir wajar.
 */
function statusOf({ from, nextFrom, today }) {
  if (!from) return "Ditimpa";
  if (nextFrom && nextFrom <= from) return "Ditimpa";
  if (from > today) return "Terjadwal";
  if (nextFrom && nextFrom <= today) return "Berakhir";
  return "Aktif";
}

// --- bantuan ----------------------------------------------------------------------------------

function dateKeyOf(value) {
  const text = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function normalize(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}
