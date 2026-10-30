import assert from "node:assert/strict";
import test from "node:test";
import {
  filterRowsByOwner,
  ownerChoices,
  ownerFilterOptions,
  subDomainNames,
  subDomainOwnerIndex,
} from "./subDomainOwners.js";

const subDomains = [
  { name: "trends.rabbit.com", parentDomain: "rabbit.com", pic: "Aldi" },
  { name: "shoes.rabbit.com", parentDomain: "rabbit.com", pic: "Nur" },
  { name: "bridal.lain.com", parentDomain: "lain.com", pic: "Aldi" },
];
const domains = [{ domainUrl: "rabbit.com" }, { domainUrl: "lain.com" }];
const owners = subDomainOwnerIndex(subDomains, domains);

const rows = [
  { subDomain: "trends.rabbit.com", pic: "Aldi" },
  { subDomain: "shoes.rabbit.com", pic: "Nur" },
  { subDomain: "bridal.lain.com", pic: "Aldi" },
  // Belum terdaftar di subDomains: domain induknya dicocokkan sebagai akhiran, sama seperti di
  // Laba Rugi — kalau tidak, situs baru menghilang dari filter domain tanpa tanda apa pun.
  { subDomain: "baru.rabbit.com", pic: "Nur" },
];

test("domain induk dari subDomains, dan dari akhiran untuk yang belum terdaftar", () => {
  assert.equal(owners.domainOf("trends.rabbit.com"), "rabbit.com");
  assert.equal(owners.domainOf("baru.rabbit.com"), "rabbit.com");
  assert.equal(owners.domainOf("entah.lainnya.id"), "");

  // Domain induk dengan URL https:// dan subdomain slug pendek
  const httpsDomains = [{ domainUrl: "https://tiktokmodapk.net" }];
  const slugSubs = [{ name: "careers", parentDomain: "tiktokmodapk.net", pic: "Mul" }];
  const realOwners = subDomainOwnerIndex(slugSubs, httpsDomains);
  assert.equal(realOwners.domainOf("careers.tiktokmodapk.net"), "tiktokmodapk.net");
  assert.equal(realOwners.domainOf("careers"), "tiktokmodapk.net");
  assert.equal(realOwners.fullOf("careers"), "careers.tiktokmodapk.net");
  assert.equal(realOwners.fullOf("careers.tiktokmodapk.net"), "careers.tiktokmodapk.net");
  assert.equal(realOwners.picOf("careers.tiktokmodapk.net"), "Mul");
});

test("PIC baris lebih dulu, subDomains cuma menambal yang tidak membawanya", () => {
  assert.equal(owners.picOf("trends.rabbit.com", "Nur"), "Nur");
  assert.equal(owners.picOf("trends.rabbit.com", ""), "Aldi");
  assert.equal(owners.picOf("entah.lainnya.id", ""), "");
});

test("pilihan dropdown: nama unik, urut, tanpa yang kosong", () => {
  assert.deepEqual(ownerFilterOptions(rows, owners), {
    advertisers: ["Aldi", "Nur"],
    domains: ["lain.com", "rabbit.com"],
  });
});

test("filter kosong berarti semua, bukan yang pemiliknya tidak diketahui", () => {
  assert.equal(filterRowsByOwner(rows, owners, {}).length, rows.length);
});

test("kedua filter menyempit bersama, bukan salah satunya saja", () => {
  const byPic = filterRowsByOwner(rows, owners, { advertiser: "Aldi" });
  assert.deepEqual(
    byPic.map((row) => row.subDomain),
    ["trends.rabbit.com", "bridal.lain.com"],
  );

  const both = filterRowsByOwner(rows, owners, { advertiser: "Aldi", domain: "rabbit.com" });
  assert.deepEqual(
    both.map((row) => row.subDomain),
    ["trends.rabbit.com"],
  );
});

test("baris tanpa PIC ikut saat advertiser tidak dipilih, dan keluar begitu satu nama dipilih", () => {
  const anonim = [{ subDomain: "trends.rabbit.com" }];

  assert.equal(filterRowsByOwner(anonim, subDomainOwnerIndex([], domains), {}).length, 1);
  assert.equal(
    filterRowsByOwner(anonim, subDomainOwnerIndex([], domains), { advertiser: "Aldi" }).length,
    0,
  );
});

test("subdomain ikut disaring di sini, supaya keempat grafik memakai satu aturan", () => {
  const only = filterRowsByOwner(rows, owners, { subDomain: "shoes.rabbit.com" });

  assert.deepEqual(
    only.map((row) => row.subDomain),
    ["shoes.rabbit.com"],
  );
  // Bersama filter lain yang meniadakannya: kosong, bukan diam-diam melonggarkan salah satunya.
  assert.equal(
    filterRowsByOwner(rows, owners, { subDomain: "shoes.rabbit.com", advertiser: "Aldi" }).length,
    0,
  );
});

test("nama sel yang datang sebagai array atau { value } tetap dikenali", () => {
  const shaped = [{ subDomain: ["trends.rabbit.com"], pic: [{ value: "Aldi" }] }];

  assert.equal(filterRowsByOwner(shaped, owners, { advertiser: "Aldi" }).length, 1);
  assert.equal(filterRowsByOwner(shaped, owners, { domain: "rabbit.com" }).length, 1);
});

// `firstValue` menjatuhkan nilai kosong ke "-", dan "-" yang lolos ke sini berdiri sebagai
// subdomain bernama "-" lengkap dengan pilihan filternya sendiri.
test("baris tanpa subdomain tidak menghasilkan pilihan bernama \"-\"", () => {
  const { advertisers, domains } = ownerFilterOptions([{ pic: "Aldi" }, { subDomain: "" }], owners);

  assert.deepEqual(advertisers, []);
  assert.deepEqual(domains, []);
});

test("ownerChoices: domain menyempit ke PIC, subdomain ke PIC + domain", () => {
  const all = ownerChoices(rows, owners);
  assert.deepEqual(all.advertisers, ["Aldi", "Nur"]);
  assert.deepEqual(all.domains, ["lain.com", "rabbit.com"]);
  assert.deepEqual(all.subDomains, ["baru.rabbit.com", "bridal.lain.com", "shoes.rabbit.com", "trends.rabbit.com"]);

  const nur = ownerChoices(rows, owners, { advertiser: "Nur" });
  assert.deepEqual(nur.advertisers, ["Aldi", "Nur"], "daftar advertiser tidak ikut menyempit");
  assert.deepEqual(nur.domains, ["rabbit.com"]);
  assert.deepEqual(nur.subDomains, ["baru.rabbit.com", "shoes.rabbit.com"]);

  const aldiRabbit = ownerChoices(rows, owners, { advertiser: "Aldi", domain: "rabbit.com" });
  assert.deepEqual(aldiRabbit.subDomains, ["trends.rabbit.com"]);
});

test("subDomainNames: urut, tanpa kembar, yang kosong dibuang", () => {
  assert.deepEqual(subDomainNames([{ subDomain: "b" }, { subDomain: "a" }, { subDomain: "b" }, { subDomain: "" }]), ["a", "b"]);
});
