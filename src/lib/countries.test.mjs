import assert from "node:assert/strict";
import { test } from "node:test";
import {
  COUNTRIES,
  COUNTRY_OPTIONS,
  PAYOUT_TAX_PERCENT,
  countryByDomain,
  countryFromHost,
  countryName,
  flagUrl,
} from "./countries.js";

test("pilihan kosong berdiri paling depan", () => {
  // getInitialFieldValue di ResourceForm mengambil pilihan PERTAMA sebagai nilai awal select yang
  // tidak punya `default`. Kalau Indonesia yang di puncak, tiap domain baru lahir bertanda
  // Indonesia — negara yang tidak pernah dipilih siapa pun, di kolom yang menentukan pajaknya.
  assert.equal(COUNTRY_OPTIONS[0].value, "");
  assert.equal(COUNTRY_OPTIONS.length, COUNTRIES.length + 1);
});

test("kode ISO unik dan berbentuk dua huruf besar", () => {
  // Kode yang kembar menghasilkan dua <option> dengan value yang sama: yang kedua tidak akan
  // pernah bisa terpilih, dan yang tersimpan bukan yang diklik orang.
  const codes = COUNTRIES.map((row) => row.code);
  assert.equal(new Set(codes).size, codes.length);
  for (const code of codes) assert.match(code, /^[A-Z]{2}$/);
});

test("tiap negara berpajak ada di daftar pilihan", () => {
  // Tarif untuk negara yang tidak bisa dipilih tidak akan pernah terpakai — dan tidak berbunyi
  // sebagai kesalahan di mana pun.
  for (const code of Object.keys(PAYOUT_TAX_PERCENT)) {
    assert.ok(
      COUNTRIES.some((row) => row.code === code),
      `${code} punya tarif pajak tapi tidak ada di COUNTRIES`,
    );
  }
});

test("nama negara dibaca dari kodenya; yang tidak dikenal dikembalikan apa adanya", () => {
  assert.equal(countryName("PK"), "Pakistan");
  assert.equal(countryName("pk"), "Pakistan");
  // Baris lama yang berisi teks bebas tetap terbaca di layar alih-alih hilang jadi "-".
  assert.equal(countryName("Pakistan"), "PAKISTAN");
  assert.equal(countryName(""), "");
  assert.equal(countryName(null), "");
});

test("alamat bendera dari kode ISO huruf kecil", () => {
  assert.equal(flagUrl("PK"), "https://flagcdn.com/w20/pk.png");
  assert.equal(flagUrl("PK", 40), "https://flagcdn.com/w40/pk.png");
  // Nilai yang bukan kode dua huruf tidak boleh jadi URL — yang tergambar akan ikon rusak.
  assert.equal(flagUrl("Pakistan"), "");
  assert.equal(flagUrl(""), "");
});

test("ccTLD jadi usulan negara", () => {
  assert.equal(countryFromHost("bispdailyupdates.pk"), "PK");
  assert.equal(countryFromHost("theglobesimregistration.ph"), "PH");
  assert.equal(countryFromHost("sub.example.com.pk"), "PK");
  assert.equal(countryFromHost("https://foo.bar.ph/path?x=1"), "PH");
  // Inggris Raya memakai .uk, kodenya GB.
  assert.equal(countryFromHost("shop.co.uk"), "GB");
});

test("akhiran yang tidak menandakan apa pun tidak ditebak", () => {
  // Justru domain yang rantai Pakistan-nya berjalan berakhiran .com — inilah sebabnya tebakan ini
  // `fallback` dan bukan `compute`.
  assert.equal(countryFromHost("psaonlineappointment.com"), "");
  assert.equal(countryFromHost("designingaround.com"), "");
  // ccTLD yang dijual bebas ke seluruh dunia tidak mengatakan apa pun tentang pemiliknya.
  assert.equal(countryFromHost("start.io"), "");
  assert.equal(countryFromHost("brand.co"), "");
  // Akhiran negara yang belum ada di daftar tidak boleh jadi kode yang tidak punya nama.
  assert.equal(countryFromHost("situs.zw"), "");
  assert.equal(countryFromHost("localhost"), "");
  assert.equal(countryFromHost(""), "");
});

test("peta domain -> negara melewati baris yang belum ditandai", () => {
  const index = countryByDomain([
    { domainUrl: "psaonlineappointment.com", country: "PK" },
    { domainUrl: "  PetCins.com  ", country: " id " },
    { domainUrl: "designingaround.com" },
    { domainUrl: "", country: "PK" },
  ]);

  assert.equal(index.get("psaonlineappointment.com"), "PK");
  assert.equal(index.get("petcins.com"), "ID");
  assert.equal(index.has("designingaround.com"), false);
  assert.equal(index.size, 2);
});
