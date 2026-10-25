import assert from "node:assert";
import {
  assertDiscoverable,
  hostnameFrom,
  isSubdomain,
  planDomains,
  planSubdomains,
  registrableDomain,
  summarize,
  summarizeNetworks,
} from "./discover-core.js";
import { earningAccounts } from "./sync-core.js";

// hostnameFrom: only GAM names that read as a hostname become sites.
assert.equal(hostnameFrom("News.Example.com"), "news.example.com", "lowercased");
assert.equal(hostnameFrom("https://www.example.com/ads?x=1"), "example.com", "scheme/www/path off");
assert.equal(hostnameFrom("example.com."), "example.com", "trailing dot off");
assert.equal(hostnameFrom("Banner_300x250_Header"), "", "not a hostname");
assert.equal(hostnameFrom("Homepage Top"), "", "spaces are not a hostname");
assert.equal(hostnameFrom("example"), "", "no dot");
assert.equal(hostnameFrom("192.168.1.10"), "", "IP is not a site");
assert.equal(hostnameFrom(""), "");

// registrableDomain: multi-part public suffixes must not become the domain themselves.
assert.equal(registrableDomain("example.com"), "example.com");
assert.equal(registrableDomain("news.example.com"), "example.com");
assert.equal(registrableDomain("a.b.example.com"), "example.com");
assert.equal(registrableDomain("news.example.co.id"), "example.co.id", "co.id is a suffix");
assert.equal(registrableDomain("example.co.id"), "example.co.id");
assert.equal(registrableDomain("shop.example.com.au"), "example.com.au");

// GAM's Sites list returns full URLs; subsites arrive as their own hostnames.
assert.equal(hostnameFrom("https://designingaround.com/"), "designingaround.com");
assert.equal(hostnameFrom("ads.designingaround.com"), "ads.designingaround.com");
// The names an AdSense-in-GAM ad unit tree is made of are not sites.
assert.equal(hostnameFrom("ca-pub-8660742543707970:"), "", "publisher ID is not a site");
assert.equal(hostnameFrom("ca-pub-8660742543707970"), "");
assert.equal(hostnameFrom("Ad Exchange Display"), "");

// isSubdomain decides whether the cheap listings already covered the subsites, or whether the
// (expensive) report still has to run.
assert.equal(isSubdomain("ads.designingaround.com"), true);
assert.equal(isSubdomain("designingaround.com"), false, "parent site only");
assert.equal(isSubdomain("example.co.id"), false, "suffix is not a subdomain");
assert.equal(isSubdomain("news.example.co.id"), true);
assert.equal(isSubdomain(""), false);

// The screenshot's network: one site plus five subsites -> one domain, six subdomain rows.
const real = new Map(
  [
    "designingaround.com",
    "ads.designingaround.com",
    "credit.designingaround.com",
    "garage.designingaround.com",
    "social.designingaround.com",
    "wealth.designingaround.com",
  ].map((host) => [host, "23352267851"]),
);
const realDomains = planDomains(real, {});
assert.equal(realDomains.length, 1, "all six roll up to one registrable domain");
assert.equal(realDomains[0].domainUrl, "designingaround.com");
assert.equal(realDomains[0].networkCode, "23352267851");
const realSubs = planSubdomains(real, {}, { d: { domainUrl: "designingaround.com" } });
assert.equal(realSubs.records.length, 6, "the apex serves ads too, so it gets a row");
assert.equal(realSubs.orphans, 0, "every one links to the imported domain");
assert.deepEqual(
  realSubs.records.map((r) => r.parentDomain),
  Array(6).fill("designingaround.com"),
);

// planDomains: one per registrable domain, existing ones skipped, userOwner left blank.
const hosts = new Map([
  ["news.example.com", "111"],
  ["shop.example.com", "111"],
  ["blog.other.co.id", "222"],
]);
const domains = planDomains(hosts, { d1: { domainUrl: "Example.com" } });
assert.equal(domains.length, 1, "example.com already exists, other.co.id is new");
assert.equal(domains[0].domainUrl, "other.co.id");
assert.equal(domains[0].networkCode, "222");
assert.equal(domains[0].userOwner, "", "GAM has no PIC");
assert.equal(domains[0].status, "Active");

// Archived rows must not block a re-import.
assert.equal(planDomains(hosts, { d1: { domainUrl: "example.com", deletedAt: "x" } }).length, 2);

// planSubdomains: parent linked only when the domain exists; the rest counted as orphans.
const subs = planSubdomains(hosts, { s1: { name: "News.Example.com" } }, { d1: { domainUrl: "example.com" } });
assert.equal(subs.records.length, 2, "news.example.com already exists");
assert.equal(subs.records[0].name, "shop.example.com");
assert.equal(subs.records[0].parentDomain, "example.com", "linked");
assert.equal(subs.records[1].name, "blog.other.co.id");
assert.equal(subs.records[1].parentDomain, "", "other.co.id not imported yet");
assert.equal(subs.orphans, 1);
assert.equal(subs.records[0].pic, "", "GAM has no PIC");

// summarize: the two things worth acting on survive into the toast, examples capped at two.
const line = summarize("domain", 3, {
  skipped: ["Banner_A", "Banner_B", "Banner_C", "Banner_D"],
  errors: [{ name: "Net 1", message: "boom" }],
});
assert.match(line, /^3 domain baru ditambahkan\./);
assert.match(line, /4 nama di GAM bukan nama domain \(mis\. Banner_A, Banner_B\)/);
assert.match(line, /daftar lengkapnya ada di console/, "points at where the full list is");
assert.equal(line.includes("Banner_C"), false, "toast stays short");
assert.match(line, /1 network gagal dibaca: Net 1\./);

// Nothing imported reads as nothing imported, not as "0 ditambahkan".
assert.equal(summarize("subdomain", 0), "Tidak ada subdomain baru.");
assert.match(summarize("domain", 0, { skipped: ["X"] }), /^Tidak ada domain baru\. 1 nama di GAM/);

// summarizeNetworks: the adsense import's two zero-cases must not read the same.
const allDuplicates = summarizeNetworks(
  0,
  [{ credential: "GAM Lama", networks: 2, added: [], duplicates: ["A (1)", "B (2)"] }],
  [],
);
assert.match(allDuplicates, /2 network dari Google sudah ada di daftar/);
assert.equal(allDuplicates.includes("API access"), false, "nothing to fix in GAM here");

const sawNothing = summarizeNetworks(
  0,
  [{ credential: "GAM Baru", networks: 0, added: [], duplicates: [] }],
  [],
);
assert.match(sawNothing, /tidak mengembalikan network apa pun/);
assert.match(sawNothing, /API access/, "the zero-network case carries the fix");

// A credential that sees nothing is still worth naming when others did import something.
const mixed = summarizeNetworks(
  1,
  [
    { credential: "GAM Lama", networks: 1, added: ["A (1)"], duplicates: [] },
    { credential: "GAM Baru", networks: 0, added: [], duplicates: [] },
  ],
  [{ name: "GAM Rusak", message: "invalid_grant" }],
);
assert.match(mixed, /^1 akun baru ditambahkan\./);
assert.match(mixed, /Tidak melihat network apa pun: GAM Baru\./);
assert.match(mixed, /1 kredensial gagal dibaca: GAM Rusak\./);

// assertDiscoverable: refuse early, with a message that says what to do next. Sejak earning bisa
// datang dari dua API, yang dioper adalah hasil `earningAccounts` — daftar gabungan kedua koleksi,
// bukan lagi satu koleksi mentah.
const gamList = earningAccounts({ a: { networkCode: "1" } }, {});
const adsenseList = earningAccounts({}, { b: { publisherId: "pub-9" } });
assert.throws(() => assertDiscoverable([], { c: { refreshToken: "r" } }), /Kode Jaringan/);
assert.throws(() => assertDiscoverable(gamList, {}), /belum di-connect|terhubung/i);
assert.doesNotThrow(() => assertDiscoverable(gamList, { c: { refreshToken: "r" } }));
// Akun AdSense tanpa network GAM sama sahnya: itu justru satu-satunya bentuk yang punya untuk
// domain yang Ad Manager-nya belum disetujui.
assert.doesNotThrow(() => assertDiscoverable(adsenseList, { c: { refreshToken: "r" } }));

// earningAccounts: yang tidak punya alamat di API-nya tidak ikut, dan arsip juga tidak.
assert.equal(earningAccounts({ a: { networkCode: "1", deletedAt: "x" } }, {}).length, 0);
// Akun yang ditutup Google dan dimatikan sync-nya tidak ikut ditanya.
assert.equal(earningAccounts({ a: { networkCode: "1", syncDisabled: "Nonaktif" } }, {}).length, 0);
assert.equal(earningAccounts({ a: { name: "tanpa network" } }, {}).length, 0);
assert.equal(earningAccounts({}, { b: { name: "tanpa publisher" } }).length, 0);
assert.equal(gamList[0].provider, "gam");
assert.equal(gamList[0].path, "gamAccounts");
assert.equal(adsenseList[0].provider, "adsense");
assert.equal(adsenseList[0].path, "adsenseAccounts");
// Provider yang tertulis di record menang atas tebakan dari bentuknya.
assert.equal(earningAccounts({ a: { networkCode: "1", provider: "adsense", publisherId: "pub-1" } }, {})[0].provider, "adsense");

console.log("discover-core.test ok");
