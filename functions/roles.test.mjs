import assert from "node:assert";
import { readFileSync } from "node:fs";
import { hasRole, isAdmin, parseRoles } from "./roles.mjs";

// --- helper yang dipakai CLI dan Cloud Functions ----------------------------

assert.deepEqual(parseRoles("admin,keuangan"), ["admin", "keuangan"]);
assert.deepEqual(parseRoles(" Admin , Keuangan "), ["admin", "keuangan"], "spasi & huruf besar");
assert.deepEqual(parseRoles(null), [], "akun tanpa entri /roles");

assert.equal(isAdmin("admin"), true);
assert.equal(isAdmin("admin,keuangan"), true, "role tambahan tidak menghapus hak admin");
assert.equal(isAdmin("keuangan,admin"), true, "urutan tidak menentukan");
assert.equal(isAdmin("user"), false);
assert.equal(isAdmin(null), false);
assert.equal(isAdmin("adminx"), false, "cocok sebagian bukan role");
// "superadmin" bukan pencocokan sebagian — ia role tersendiri yang berlaku sebagai admin, dan
// akun yang memegangnya SENDIRIAN (tanpa "admin" di sebelahnya) tetap boleh menulis dashboard/*.
assert.equal(isAdmin("superadmin"), true);
assert.equal(isAdmin("superadmin,keuangan"), true);
assert.equal(hasRole("user,advertiser", "advertiser"), true);

// --- aturan database membaca role dengan cara yang sama ---------------------
//
// Yang diuji di bawah ini adalah ekspresi yang benar-benar tertulis di database.rules.json —
// regex-nya diambil dari file itu lalu dijalankan, bukan disalin ke sini. Sebuah salinan akan
// tetap hijau justru pada saat aturannya berubah, dan itu persis kegagalan yang mau dicegah:
// UI memakai pencocokan per-role, aturan memakai perbandingan persis, dan admin yang punya role
// kedua kehilangan seluruh haknya tanpa satu pun tes menyala.

const rulesText = readFileSync(new URL("../database.rules.json", import.meta.url), "utf8");
const rules = JSON.parse(rulesText).rules;

assert.ok(
  !/\.val\(\)\s*===\s*'admin'/.test(rulesText),
  "perbandingan persis dengan 'admin' menolak role gabungan — pakai .matches(/^(.*,)?admin(,.*)?$/)",
);
assert.ok(
  !/\.val\(\)\.contains\(/.test(rulesText),
  "cocok substring meloloskan nilai seperti 'adminx' — pakai .matches() yang beranchor",
);

// Mesin regex Firebase bukan mesin regex JavaScript: `^` hanya boleh berada di awal pola dan `$`
// hanya di akhir. `/(^|,)admin(,|$)/` sah menurut Node — seluruh tes di bawah ini hijau
// memakainya — tapi `firebase deploy` menolaknya sebagai "Illegal regular expression", jadi
// aturannya tidak pernah sampai ke server dan yang berlaku tetap aturan versi sebelumnya.
// Kegagalan di berkas ini memang begitu bentuknya: yang jatuh adalah deploy-nya, bukan tesnya.
for (const [, pattern] of rulesText.matchAll(/\.matches\(\/(.*?)\/\)/g)) {
  assert.ok(
    pattern.indexOf("^") <= 0,
    `anchor ^ hanya boleh di awal pola, Firebase menolak sisanya: /${pattern}/`,
  );
  const dollar = pattern.indexOf("$");
  assert.ok(
    dollar === -1 || dollar === pattern.length - 1,
    `anchor $ hanya boleh di akhir pola, Firebase menolak sisanya: /${pattern}/`,
  );
}

// Ambil regex dari sebuah ekspresi .read/.write, lalu jalankan seperti mesin aturan menjalankannya:
// .matches() adalah pencarian, bukan pencocokan penuh, jadi anchor-nya harus ada di regex itu.
function roleTest(expression) {
  const found = expression.match(/\.matches\(\/(.*?)\/\)/);
  assert.ok(found, `ekspresi tidak memeriksa role lewat .matches(): ${expression}`);
  const pattern = new RegExp(found[1]);
  return (role) => pattern.test(String(role ?? ""));
}

function check(expression, { allow, deny }) {
  const accepts = roleTest(expression);
  for (const role of allow) assert.equal(accepts(role), true, `harus diterima: "${role}"`);
  for (const role of deny) assert.equal(accepts(role), false, `harus ditolak: "${role}"`);
}

// Admin: yang menulis users, domains, settings, dashboard, dan yang membaca koleksi rahasia.
for (const expression of [
  rules.users[".write"],
  rules.domains[".write"],
  rules.subDomains[".write"],
  rules.adAccounts[".write"],
  rules.adsenseAccounts[".read"],
  rules.adsenseAccounts[".write"],
  rules.googleApiConfigs[".read"],
  rules.googleApiConfigs[".write"],
  rules.settings[".write"],
  rules.dashboard[".write"],
  rules.roles.$uid[".write"],
]) {
  check(expression, {
    allow: [
      "admin",
      "admin,keuangan",
      "keuangan,admin",
      "user,admin,advertiser",
      // Role tersendiri, bukan ejaan lain dari admin: aturannya harus menerimanya berdiri
      // sendiri, kalau tidak akun superadmin ditolak database di tulisan pertamanya.
      "superadmin",
      "superadmin,keuangan",
    ],
    deny: ["user", "keuangan", "advertiser", "", "adminx", "xadmin", "superadminx"],
  });
}

// Advertiser mendaftarkan kode Keitaro-nya sendiri. "user,advertiser" adalah kombinasi paling
// wajar untuk seorang PIC, dan itulah yang dulu ditolak.
check(rules.subDomains.$id.campaignCodes[".write"], {
  allow: ["advertiser", "user,advertiser", "admin", "admin,keuangan", "superadmin"],
  deny: ["user", "keuangan", "", "advertisers"],
});

// Keuangan: pengeluaran, top-up, dan target earning.
for (const expression of [
  rules.expenses[".read"],
  rules.expenses[".write"],
  rules.whitelistTopup[".read"],
  rules.whitelistTopup[".write"],
  rules.domainTargets[".write"],
]) {
  check(expression, {
    allow: ["keuangan", "user,keuangan", "admin", "admin,keuangan", "superadmin"],
    deny: ["user", "advertiser", ""],
  });
}

// Tamu (GUEST_PAGES di src/config/access.js) MEMBACA bahan ketiga laporan Accounting dan tidak
// pernah menulis apa pun. Dibaca dari seluruh node yang ditutup untuk Keuangan, bukan dari daftar
// yang disalin: node Accounting baru yang lupa menyebut "guest" di .read-nya membuat halaman tamu
// melaporkan laba tanpa potongan itu, tanpa satu pun pesan.
const keuanganNodes = Object.keys(rules).filter((node) =>
  /keuangan/.test(rules[node][".read"] || ""),
);
assert.ok(keuanganNodes.includes("payouts") && keuanganNodes.includes("expenses"));
for (const node of keuanganNodes) {
  check(rules[node][".read"], {
    allow: ["guest", "keuangan", "admin", "superadmin", "user,guest"],
    deny: ["user", "advertiser", "", "guests", "xguest"],
  });
  check(rules[node][".write"], {
    allow: ["keuangan", "admin", "superadmin"],
    deny: ["guest", "user,guest", "user", "advertiser", ""],
  });
}

// .validate roles/$uid: daftar role yang boleh TERSIMPAN. Sebuah role yang diterima setiap
// aturan .write tapi ditolak validasi ini tidak akan pernah bisa ditulis ke /roles — halaman Team
// menyimpannya, database menolaknya, dan pesannya cuma "permission denied".
const validate = new RegExp(rules.roles.$uid[".validate"].match(/\.matches\(\/(.*?)\/\)/)[1]);
for (const role of ["superadmin", "admin", "superadmin,keuangan", "admin,user,advertiser", "guest"]) {
  assert.ok(validate.test(role), `role sah ditolak .validate: "${role}"`);
}
for (const role of ["adminx", "superadmin,", "owner"]) {
  assert.ok(!validate.test(role), `role tak dikenal lolos .validate: "${role}"`);
}

// Sisi Cloud Functions tidak boleh punya salinan aturan role sendiri. `assertMayToggle` dulu
// memakai /(^|,)admin(,|$)/ yang ditulis di tempat, dan salinan itulah yang tidak ikut berubah
// waktu daftar role bertambah: callable menolak akun yang setiap lapisan lain terima.
const indexText = readFileSync(new URL("./index.js", import.meta.url), "utf8");
assert.ok(
  !/\/\([^/]*\|,\)admin/.test(indexText),
  "index.js menulis regex role sendiri — pakai isAdmin() dari roles.mjs",
);
assert.ok(indexText.includes('from "./roles.mjs"'), "index.js harus membaca role lewat roles.mjs");

console.log("roles.test ok");
