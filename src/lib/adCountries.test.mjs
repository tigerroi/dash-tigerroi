import assert from "node:assert/strict";
import test from "node:test";
import {
  AD_COUNTRY_CODES,
  adCountryOptions,
  countryCodesOf,
  countryText,
  extraCountryCode,
  filterCountryOptions,
  normalizeCountryCode,
} from "./adCountries.js";

test("daftarnya kode ISO dua huruf, tanpa kembar", () => {
  assert.equal(AD_COUNTRY_CODES.length, new Set(AD_COUNTRY_CODES).size);
  for (const code of AD_COUNTRY_CODES) assert.match(code, /^[A-Z]{2}$/);
  // Yang paling sering dipakai armada harus ada — kalau hilang, targeting armada tidak bisa
  // direproduksi dari pemilihnya.
  for (const code of ["SA", "TR", "AE", "KW", "QA", "BH", "OM", "MX", "CL", "AR"]) {
    assert.ok(AD_COUNTRY_CODES.includes(code), `${code} hilang dari daftar`);
  }
});

test("pilihan diurut NAMA, dan namanya dibaca dari Intl", () => {
  const options = adCountryOptions();
  assert.equal(options.length, AD_COUNTRY_CODES.length);
  const names = options.map((item) => item.name);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, "id-ID")));
  const saudi = options.find((item) => item.code === "SA");
  assert.notEqual(saudi.name, "SA", "nama negara tidak digambar sebagai kodenya");
});

test("kode di luar daftar ikut jadi pilihan kalau sudah terpilih", () => {
  const options = adCountryOptions(["kh"]);
  assert.ok(options.some((item) => item.code === "KH"));
  assert.equal(options.length, AD_COUNTRY_CODES.length + 1);
});

test("pencarian mengenali kode maupun nama", () => {
  const options = adCountryOptions();
  assert.deepEqual(
    filterCountryOptions(options, "sa").map((item) => item.code).includes("SA"),
    true,
  );
  assert.ok(filterCountryOptions(options, "arab").some((item) => item.code === "SA"));
  assert.equal(filterCountryOptions(options, "").length, options.length);
  assert.equal(filterCountryOptions(options, "zzzz").length, 0);
});

test("kode dua huruf yang belum ada di daftar bisa ditambahkan; yang sudah ada tidak", () => {
  assert.equal(extraCountryCode("kh"), "KH");
  assert.equal(extraCountryCode("SA"), "", "sudah ada di daftar");
  assert.equal(extraCountryCode("arab"), "", "bukan kode dua huruf");
  assert.equal(extraCountryCode(""), "");
});

test("teks kotak isian dan daftar kode saling bolak-balik tanpa kehilangan apa pun", () => {
  assert.deepEqual(countryCodesOf(" sa, tr  TR\nae "), ["SA", "TR", "AE"]);
  assert.equal(countryText(["SA", "TR"]), "SA, TR");
  assert.deepEqual(countryCodesOf(countryText(["SA", "TR"])), ["SA", "TR"]);
  assert.equal(normalizeCountryCode(" id "), "ID");
});
