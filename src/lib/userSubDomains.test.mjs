import assert from "node:assert/strict";
import { test } from "node:test";
import { assignedSubDomains, rowsForSubDomains, subDomainNameKeys } from "./userSubDomains.js";

const subs = [
  { name: "ads.designingaround.com", pic: "Lightman" },
  { name: "wellness.stylefemale.com", pic: "lightman " },
  { name: "care.petcins.com", pic: "Aca" },
  { name: "old.petcins.com", pic: "Lightman", deletedAt: "2026-08-01" },
];

test("kepemilikan dicocokkan lewat nama, username, email, atau id — tanpa peduli besar-kecil huruf", () => {
  const user = { id: "-Ozw", name: "Lightman", email: "tbz1247@rabbitracing.live" };
  assert.deepEqual(
    assignedSubDomains(user, subs).map((item) => item.name),
    ["ads.designingaround.com", "wellness.stylefemale.com"],
  );
  assert.deepEqual(
    assignedSubDomains({ email: "Aca@rabbitracing.live" }, [
      { name: "care.petcins.com", userOwner: "aca@rabbitracing.live" },
    ]).map((item) => item.name),
    ["care.petcins.com"],
  );
  // Pencocokan singkatan 3 huruf tim (Nur, Mul, Sul, Man)
  const teamSubs = [
    { name: "rewards", pic: "Nur" },
    { name: "careers", pic: "Mul" },
    { name: "insurance", pic: "Sul" },
    { name: "mod", pic: "Man" },
  ];
  assert.deepEqual(
    assignedSubDomains({ name: "Nurjaman", username: "lightman" }, teamSubs).map((s) => s.name),
    ["rewards"],
  );
  assert.deepEqual(
    assignedSubDomains({ name: "Mulyana" }, teamSubs).map((s) => s.name),
    ["careers"],
  );
  assert.deepEqual(
    assignedSubDomains({ name: "Zulfan" }, teamSubs).map((s) => s.name),
    ["insurance"],
  );
  assert.deepEqual(
    assignedSubDomains({ name: "Mas Def" }, teamSubs).map((s) => s.name),
    ["mod"],
  );
});

test("user tanpa identitas apa pun tidak memiliki subdomain siapa pun", () => {
  assert.deepEqual(assignedSubDomains({}, subs), []);
  assert.deepEqual(assignedSubDomains({ name: "" }, subs), []);
});

test("baris ikut nama subdomain, bukan `pic` yang tertulis di baris itu", () => {
  // Subdomain yang berpindah tangan: baris lamanya masih menyebut PIC yang dulu, dan baris itu
  // tetap milik pemegangnya sekarang.
  const rows = [
    { subDomain: "ads.designingaround.com", pic: "Nurjaman WL 2", earning: 10 },
    { subDomain: "ads.designingaround.com", pic: "Lightman", earning: 20 },
    { subDomain: "care.petcins.com", pic: "Aca", earning: 30 },
  ];
  const keys = subDomainNameKeys(assignedSubDomains({ name: "Lightman" }, subs));

  assert.deepEqual(
    rowsForSubDomains(rows, keys).map((row) => row.earning),
    [10, 20],
  );
});

test("baris ber-PIC benar tapi subdomainnya bukan miliknya lagi ikut keluar", () => {
  const rows = [{ subDomain: "care.petcins.com", pic: "Lightman" }];
  assert.deepEqual(rowsForSubDomains(rows, subDomainNameKeys(["ads.designingaround.com"])), []);
});

test("nama sel yang datang sebagai array atau { value } dibandingkan sebagai nama yang sama", () => {
  const rows = [{ subDomain: ["ads.designingaround.com"] }, { subDomain: { value: "CARE.petcins.com" } }];
  assert.equal(rowsForSubDomains(rows, subDomainNameKeys([{ name: ["ads.designingaround.com"] }])).length, 1);
  assert.equal(rowsForSubDomains(rows, ["care.petcins.com"]).length, 1);
});

test("nama subdomain cocok baik dengan FQDN maupun slug pendek", () => {
  const rows = [
    { subDomain: "keto", earning: 100 },
    { subDomain: "keto.ihopmenuwithprices.us", earning: 200 },
    { subDomain: "other.domain.com", earning: 50 },
  ];
  const keys = subDomainNameKeys([{ name: "keto.ihopmenuwithprices.us" }]);
  const matched = rowsForSubDomains(rows, keys);
  assert.equal(matched.length, 2);
  assert.deepEqual(matched.map((r) => r.earning), [100, 200]);
});

test("tanpa subdomain, tabelnya kosong — bukan jatuh kembali ke pencocokan pic", () => {
  const rows = [{ subDomain: "ads.designingaround.com", pic: "Lightman" }];
  assert.deepEqual(rowsForSubDomains(rows, new Set()), []);
  assert.deepEqual(rowsForSubDomains(rows, []), []);
});
