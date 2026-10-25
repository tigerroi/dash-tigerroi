/**
 * Negara sebuah domain — satu kosakata, dipakai halaman Domains dan rantai Pencairan.
 *
 * KENAPA INI ADA. Rantai Pencairan berhenti di "Real Masuk − Fee % × Real Masuk − Potongan
 * Konversi", dan itu cukup untuk domain yang dibayar ke rekening lokal. Yang dibayar lewat bank
 * asing kehilangan lebih banyak, dan kehilangannya BERTINGKAT: pemerintah memungut lebih dulu,
 * lalu perantara memungut dari SISANYA. `migrations/fix-payout-fee-double-count.mjs` sudah
 * menyebutkan batas itu di badannya sendiri — Emran memungut 5% dari jumlah setelah pajak
 * Pakistan, bukan dari yang dibayarkan Google, dan skema `payouts` waktu itu tidak punya cara
 * mengungkapkan pembagi selain Real Masuk. Selisihnya Rp 209 ribu pada satu baris, tersembunyi di
 * dalam Potongan Konversi. Negara di baris domain-lah yang membuat langkah pajak itu ada.
 *
 * YANG DISIMPAN KODE ISO, YANG DIGAMBAR NAMANYA. "PK", "Pakistan", dan "pakistan" adalah tiga
 * negara berbeda bagi kolom yang diketik bebas — dan kolom `negara` di `gamAccounts` sudah
 * membuktikannya: ia kosong justru untuk psaonlineappointment.com, satu-satunya baris yang rantai
 * asingnya benar-benar berjalan. Karena itu ia `select`, sepola dengan Jenis Akun di Invalid
 * Traffic dan Keterangan di Pencairan: kolom yang MEMUTUSKAN sesuatu tidak boleh diketik.
 *
 * NEGARANYA DITANDAI DI DOMAIN, BUKAN DI AKUN. Yang punya rekening memang akunnya, tapi yang punya
 * baris pencairan adalah domain — `payouts` berdiri per (bulan, domain), dan begitu juga Laba per
 * Domain. Ditandai di akun, tiap pembacaan harus melewati pemetaan domain→akun yang tidak selalu
 * ada (baris AdSense menyebut nama akun, bukan domain), dan yang tidak terpetakan kehilangan
 * langkah pajaknya tanpa satu tanda pun di layar.
 */

/**
 * Negara yang bisa dipilih. Daftarnya SENGAJA pendek — bukan seluruh ISO 3166 — karena `<select>`
 * berisi 249 baris berhenti bisa dibaca, sementara yang benar-benar dipakai armada ini bisa
 * dihitung jari. Menambah satu negara adalah satu baris di sini; benderanya ikut sendiri, karena
 * ia diminta dari kode ISO-nya dan bukan digambar satu per satu.
 *
 * Indonesia di puncak karena ia jawaban untuk hampir seluruh baris, dan pilihan yang paling sering
 * dipakai tidak boleh dicari di tengah daftar alfabetis.
 */
export const COUNTRIES = [
  { code: "ID", name: "Indonesia" },
  { code: "AE", name: "Uni Emirat Arab" },
  { code: "AU", name: "Australia" },
  { code: "BD", name: "Bangladesh" },
  { code: "BR", name: "Brasil" },
  { code: "CA", name: "Kanada" },
  { code: "CN", name: "Tiongkok" },
  { code: "DE", name: "Jerman" },
  { code: "EG", name: "Mesir" },
  { code: "ES", name: "Spanyol" },
  { code: "FR", name: "Prancis" },
  { code: "GB", name: "Inggris Raya" },
  { code: "IN", name: "India" },
  { code: "IQ", name: "Irak" },
  { code: "IT", name: "Italia" },
  { code: "JP", name: "Jepang" },
  { code: "KE", name: "Kenya" },
  { code: "KH", name: "Kamboja" },
  { code: "KR", name: "Korea Selatan" },
  { code: "LK", name: "Sri Lanka" },
  { code: "MA", name: "Maroko" },
  { code: "MM", name: "Myanmar" },
  { code: "MX", name: "Meksiko" },
  { code: "MY", name: "Malaysia" },
  { code: "NG", name: "Nigeria" },
  { code: "NP", name: "Nepal" },
  { code: "PH", name: "Filipina" },
  { code: "PK", name: "Pakistan" },
  { code: "SA", name: "Arab Saudi" },
  { code: "SG", name: "Singapura" },
  { code: "TH", name: "Thailand" },
  { code: "TR", name: "Turki" },
  { code: "TW", name: "Taiwan" },
  { code: "US", name: "Amerika Serikat" },
  { code: "VN", name: "Vietnam" },
  { code: "ZA", name: "Afrika Selatan" },
];

const NAME_BY_CODE = new Map(COUNTRIES.map((row) => [row.code, row.name]));

/**
 * Pilihan untuk `<select>` di form.
 *
 * Yang KOSONG berdiri PALING DEPAN, dan itu bukan kerapian: `getInitialFieldValue` di
 * ResourceForm mengambil pilihan PERTAMA sebagai nilai awal sebuah select yang tidak punya
 * `default`. Tanpa baris kosong di puncak, tiap domain baru lahir bertanda Indonesia — negara yang
 * tidak pernah dipilih siapa pun, di kolom yang menentukan apakah pencairannya kena pajak.
 *
 * "Belum ditandai", bukan "Indonesia (bawaan)": yang belum diisi memang belum diketahui, dan
 * menebak negara yang paling sering benar menghasilkan baris yang tidak bisa dibedakan dari baris
 * yang benar-benar diperiksa orang.
 */
export const COUNTRY_OPTIONS = [
  { value: "", label: "Belum ditandai" },
  ...COUNTRIES.map((row) => ({ value: row.code, label: row.name })),
];

/**
 * Tarif pajak pemerintah atas pencairan, per negara — BAWAAN untuk kotak isian, bukan nilai yang
 * dipakai menghitung.
 *
 * Yang menghitung selalu `govTaxPercent` yang tersimpan di baris pencairan itu sendiri. Itu
 * pelajaran `companyPercents`: tarif yang dibaca dari konstanta saat DIRENDER akan menghitung
 * ulang seluruh bulan lampau pada hari angkanya diubah — laba Juni yang sudah dilaporkan bergeser
 * sendiri tanpa satu baris pun disunting, dan yang melihatnya cuma orang yang kebetulan membuka
 * bulan lama. Di sini ia cuma mengisi kotak yang masih kosong saat baris BARU dibuat.
 *
 * Pakistan 10% — angka yang sama yang dipakai `migrations/fix-payout-fee-double-count.mjs`.
 * Negara yang tidak disebut di sini tidak berpajak sejauh yang kita tahu, dan yang ternyata
 * berpajak diketik di barisnya.
 */
export const PAYOUT_TAX_PERCENT = { PK: 10 };

/** Nama negara untuk sebuah kode ISO; kode yang tidak dikenal dikembalikan apa adanya. */
export function countryName(code) {
  const key = String(code ?? "")
    .trim()
    .toUpperCase();
  if (!key) return "";
  return NAME_BY_CODE.get(key) || key;
}

/**
 * Alamat gambar bendera. flagcdn.com melayani seluruh ISO 3166, jadi daftar di atas boleh tumbuh
 * tanpa ada bendera yang perlu digambar — itu yang membedakannya dari SVG yang ditulis sendiri.
 *
 * Bendera emoji sengaja TIDAK dipakai: Segoe UI Emoji tidak memuatnya sama sekali, jadi di Windows
 * yang muncul justru dua huruf "PK" — dan Windows adalah mesin yang membuka dashboard ini.
 */
export function flagUrl(code, width = 20) {
  const key = String(code ?? "")
    .trim()
    .toLowerCase();
  return /^[a-z]{2}$/.test(key) ? `https://flagcdn.com/w${width}/${key}.png` : "";
}

// ccTLD yang DIJUAL BEBAS ke seluruh dunia, jadi kehadirannya tidak mengatakan apa pun tentang
// pemiliknya. Tidak satu pun ada di COUNTRIES hari ini; daftarnya berdiri supaya penambahan
// berikutnya tidak diam-diam mengubah `.co` jadi tebakan "Kolombia".
const GENERIC_CCTLD = new Set(["co", "io", "ai", "tv", "me", "cc", "ly", "to", "sh", "gg", "fm"]);

// Inggris Raya memakai `.uk`, sementara kode ISO-nya GB. Satu-satunya tempat akhiran dan kode
// negara tidak sama untuk daftar di atas.
const CCTLD_ALIAS = { uk: "GB" };

/**
 * Tebakan negara dari akhiran sebuah hostname — `bispdailyupdates.pk` → PK,
 * `theglobesimregistration.ph` → PH.
 *
 * DIPAKAI SEBAGAI `fallback`, BUKAN `compute`, dan itu yang menentukan artinya: ia cuma mengisi
 * kotak yang masih kosong saat baris BARU dibuat, dan ketikan orang selalu menang. Ia memang tidak
 * bisa menjawab semuanya — psaonlineappointment.com berakhiran `.com`, dan justru itulah
 * satu-satunya domain yang rantai Pakistan-nya berjalan — jadi jawabannya usulan, bukan vonis.
 *
 * TIDAK ADA API YANG MENJAWAB INI, dan itu sudah diperiksa: `Account` di AdSense v2 membawa
 * `displayName`/`timeZone`/`state` dan `Network` di Ad Manager v1 membawa `currencyCode`/`timeZone`
 * — tidak satu pun menyebut negara. `reportTimeZone` dan `saldoCurrency` yang sudah ditulis sync
 * menjawab SETELAN AKUN dan bukan negara pemiliknya (tiga akun Pakistan berbunyi `Asia/Jakarta`),
 * dan negara registrant di RDAP/WHOIS hampir selalu diredaksi. Akhiran domain adalah satu-satunya
 * petunjuk yang benar-benar bisa dibaca sendiri.
 */
export function countryFromHost(host) {
  const clean = String(host ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[/?#].*$/, "")
    .replace(/\.$/, "");
  const parts = clean.split(".").filter(Boolean);
  if (parts.length < 2) return "";

  const suffix = parts[parts.length - 1];
  if (GENERIC_CCTLD.has(suffix)) return "";

  const code = CCTLD_ALIAS[suffix] || suffix.toUpperCase();
  return NAME_BY_CODE.has(code) ? code : "";
}

/** Peta `domain (huruf kecil) -> kode negara`, dari koleksi `domains`. */
export function countryByDomain(domains = []) {
  const index = new Map();
  for (const row of Array.isArray(domains) ? domains : []) {
    const key = String(row?.domainUrl ?? "")
      .trim()
      .toLowerCase();
    const code = String(row?.country ?? "")
      .trim()
      .toUpperCase();
    if (key && code) index.set(key, code);
  }
  return index;
}
