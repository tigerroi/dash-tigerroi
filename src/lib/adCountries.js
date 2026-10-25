import { countryLabel } from "./campaignFleet.js";

/**
 * Negara yang bisa ditargetkan iklan — daftar untuk pemilih di dialog Buat campaign dan Ubah ad set.
 *
 * BUKAN `COUNTRIES` di countries.js, dan itu bukan kelalaian: yang di sana memutuskan pajak
 * pencairan sebuah domain, jadi ia sengaja pendek dan tiap barisnya keputusan. Yang di sini cuma
 * menyaring apa yang diketik ke sebuah kotak — daftar yang lebih panjang tidak membuat satu pun
 * angka bergeser, dan yang dipakai armada memang jauh lebih banyak (Kuwait, Qatar, Bahrain, Oman,
 * dan selusin negara EU tidak ada di daftar pajak itu sama sekali).
 *
 * ISINYA DARI PRODUKSI, bukan dari selera: 56 kode di bawah adalah seluruh negara yang benar-benar
 * ditargetkan 928 ad set armada pada 12 Sep 2026, diurutkan seperti aslinya menurut seberapa sering
 * dipakai (MX 406, SA 391, TR 366, … HK 5). Daftar ISO penuh sengaja TIDAK dipakai: 280 kode yang
 * dijawab `Intl.DisplayNames` memuat negara yang sudah tidak ada (Uni Soviet, Yugoslavia), wilayah
 * tak berpenghuni (Antartika), dan kode semu (EU, ZZ) — semuanya ditolak Meta, dan yang mencarinya
 * di daftar ini tidak pernah bisa tahu mana yang sah sebelum permintaannya gagal.
 *
 * YANG BELUM PERNAH DIPAKAI TETAP BISA DITAMBAHKAN: kotak pencarian pemilihnya menerima kode dua
 * huruf apa pun (`extraCountryCode`), jadi wilayah baru tidak menuntut satu baris kode di sini
 * lebih dulu. Yang memutuskan sah-tidaknya tetap Meta, dan penolakannya digambar apa adanya.
 */
export const AD_COUNTRY_CODES = [
  "MX",
  "SA",
  "TR",
  "AE",
  "CL",
  "KW",
  "NG",
  "AR",
  "QA",
  "BH",
  "OM",
  "MA",
  "KE",
  "EG",
  "CA",
  "NZ",
  "GT",
  "CO",
  "AU",
  "NE",
  "IT",
  "NL",
  "NO",
  "ES",
  "CH",
  "GB",
  "DK",
  "BE",
  "GR",
  "AT",
  "PL",
  "PT",
  "CZ",
  "SK",
  "LT",
  "HU",
  "RO",
  "FR",
  "DE",
  "EE",
  "LV",
  "MT",
  "UY",
  "CR",
  "PH",
  "VN",
  "NI",
  "BR",
  "ZA",
  "TH",
  "PA",
  "VE",
  "PE",
  "EC",
  "IE",
  "HK",
];

const KNOWN = new Set(AD_COUNTRY_CODES);

export function normalizeCountryCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

/**
 * Baris pemilih: kode + namanya, urut nama.
 *
 * Urut NAMA, bukan urut pemakaian — walau daftarnya datang terurut pemakaian. Yang dicari orang di
 * daftar 56 baris adalah satu negara yang sudah ada di kepalanya, dan urutan yang cuma diketahui
 * dari data pemakaian berarti ia harus menyisir seluruh daftar tiap kali. Yang paling sering dipakai
 * tetap ketemu lebih cepat lewat kotak pencarian di atasnya.
 */
export function adCountryOptions(extra = []) {
  const codes = [...new Set([...AD_COUNTRY_CODES, ...extra.map(normalizeCountryCode)])].filter(
    Boolean,
  );
  return codes
    .map((code) => ({ code, name: countryLabel(code) }))
    .sort((a, b) => a.name.localeCompare(b.name, "id-ID"));
}

/** Baris yang cocok dengan yang diketik — kodenya maupun namanya. */
export function filterCountryOptions(options, query) {
  const term = String(query || "")
    .trim()
    .toLowerCase();
  if (!term) return options;
  return options.filter(
    (item) => item.code.toLowerCase().includes(term) || item.name.toLowerCase().includes(term),
  );
}

/**
 * Kode dua huruf yang diketik orang tapi tidak ada di daftar — ditawarkan sebagai tambahan.
 *
 * Tanpa ini, negara yang belum pernah dipakai armada tidak bisa ditargetkan sampai ada yang
 * menambahkan satu baris di berkas ini dan men-deploy ulang hosting.
 */
export function extraCountryCode(query) {
  const code = normalizeCountryCode(query);
  return /^[A-Z]{2}$/.test(code) && !KNOWN.has(code) ? code : "";
}

/** Teks kotak isian ("SA, TR") -> daftar kode. Bentuk yang sama dengan `parseCountryInput`. */
export function countryCodesOf(text) {
  return [
    ...new Set(
      String(text || "")
        .split(/[\s,]+/)
        .map(normalizeCountryCode)
        .filter(Boolean),
    ),
  ];
}

/** Daftar kode -> teks kotak isian, bentuk yang dibaca `createCampaignPayload`/`adSetEditState`. */
export function countryText(codes) {
  return codes.join(", ");
}
