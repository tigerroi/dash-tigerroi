import { listSites as listAdsenseSites } from "./adsense.js";
import { listAdUnits, listSites } from "./gam.js";
import {
  accountToken,
  adsenseAccountName,
  earningRowsByDimension,
  normalizeName,
} from "./sync-core.js";

// Shared "Impor dari Google" logic for /domains and /sub-domains: ask Google Ad Manager which
// sites exist, turn the ones that read as hostnames into records. Returns plain objects; the
// caller writes them with whichever SDK it has (Cloud Function = admin, CLI/server = client).
// No DB access here — same split as sync-core.js.

// Enough of the public suffix list for the TLDs these sites actually use. Without it
// "news.example.co.id" would register "co.id" as the parent domain.
const MULTI_PART_SUFFIXES = new Set([
  "co.id",
  "or.id",
  "web.id",
  "my.id",
  "ac.id",
  "sch.id",
  "go.id",
  "net.id",
  "biz.id",
  "desa.id",
  "co.uk",
  "org.uk",
  "me.uk",
  "com.au",
  "net.au",
  "org.au",
  "co.nz",
  "co.za",
  "co.jp",
  "co.kr",
  "co.th",
  "com.cn",
  "com.sg",
  "com.my",
  "com.ph",
  "com.vn",
  "com.hk",
  "com.br",
  "com.mx",
  "com.tr",
  "com.ar",
]);

// Ad unit names are free text in GAM. Only the ones that read as a hostname become sites —
// "Banner_300x250_Header" is reported back instead of silently imported as a domain.
export function hostnameFrom(value) {
  const host = normalizeName(value)
    .replace(/^https?:\/\//, "")
    .split("/")[0]
    .split("?")[0]
    .replace(/^www\./, "")
    .replace(/\.$/, "");
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) return "";
  // The last label has to look like a TLD, which also rules out IP addresses.
  if (!/\.[a-z]{2,}$/.test(host)) return "";
  return host;
}

export function registrableDomain(host) {
  const parts = host.split(".");
  if (parts.length <= 2) return host;
  const lastTwo = parts.slice(-2).join(".");
  return MULTI_PART_SUFFIXES.has(lastTwo) ? parts.slice(-3).join(".") : lastTwo;
}

export function isSubdomain(host) {
  return Boolean(host) && host !== registrableDomain(host);
}

// The report dimension used for *discovery*. Verified against the live API: the REST v1 enum is
// `SITE` — the SOAP API's `SITE_NAME` is rejected with a 400, so don't "fix" this back. `URL` is
// also accepted but breaks down per page, far below the site level we want here. Distinct from
// GAM_SUBDOMAIN_DIMENSION, which Sync ROI points at ad units to attribute earnings.
const DISCOVER_DIMENSION = "SITE";

/**
 * Every hostname GAM knows about, across every adsense account's network.
 *
 * GAM exposes site names in more than one place and no single place is complete: an Ad Exchange
 * network keeps its domains under Inventory → Sites while its ad unit tree is only the default
 * "ca-pub-…" nodes, and a network set up the other way round has it reversed. So read every
 * source and merge, rather than picking one and hoping it is the populated one.
 *
 * @returns {{hosts: Map<string,string>, skipped: string[], errors: {name,message}[],
 *           sources: {sites:number, adUnits:number, report:number}}}
 *          hosts maps hostname -> the networkCode it was found under.
 */
export async function collectHosts(accounts, configs, dimension) {
  const hosts = new Map();
  const skipped = new Set();
  const errors = [];
  // Endpoints that failed while others succeeded. Not fatal, but the reason a source
  // contributed nothing is exactly what you need when a site you can see in GAM never imports.
  const sourceFailures = [];
  const sources = { sites: 0, adUnits: 0, report: 0 };

  for (const { account, provider, label } of accounts || []) {
    const code = String(account.networkCode || "");

    let token;
    try {
      token = await accountToken(account, configs);
    } catch (e) {
      errors.push({ name: label, message: e.message });
      continue;
    }

    const found = new Map(); // hostname -> which source produced it, this account only
    const take = (names, source) => {
      for (const raw of names) {
        const host = hostnameFrom(raw);
        if (!host) {
          if (raw) skipped.add(raw);
          continue;
        }
        if (found.has(host)) continue;
        found.set(host, source);
        sources[source]++;
      }
    };

    const failures = [];
    try {
      const sites =
        provider === "adsense"
          ? await listAdsenseSites(adsenseAccountName(account), token)
          : await listSites(code, token);
      take(
        sites.map((site) => site.url),
        "sites",
      );
    } catch (e) {
      failures.push(`sites: ${e.message}`);
    }
    // Ad unit hanya ada di sisi Ad Manager. Di AdSense padanannya bersarang di bawah ad client,
    // dan namanya tidak pernah berupa hostname — jadi tidak ada yang bisa dipanen dari sana.
    if (provider === "gam") {
      try {
        take(
          (await listAdUnits(code, token)).map((unit) => unit.displayName || unit.adUnitCode),
          "adUnits",
        );
      } catch (e) {
        failures.push(`adUnits: ${e.message}`);
      }
    }

    // A report costs a create/run/poll round trip, so only pay for it when the two cheap
    // listings left something out — nothing at all, or parent domains with no subdomain under
    // any of them. That last case is the one that matters: a subsite serving ads shows up in
    // reporting even when the listings above return only its parent.
    if (![...found.keys()].some(isSubdomain)) {
      try {
        const rows = await earningRowsByDimension(
          account,
          configs,
          dimension || DISCOVER_DIMENSION,
        );
        take(
          rows.map((row) => row.key),
          "report",
        );
      } catch (e) {
        failures.push(`report: ${e.message}`);
      }
    }

    if (found.size === 0) {
      errors.push({
        name: label,
        message: failures.join(" | ") || "Google tidak mengembalikan nama site apa pun.",
      });
      continue;
    }
    // One source answering does not make the others' silence fine — report it either way.
    for (const message of failures) sourceFailures.push({ name: label, message });
    for (const host of found.keys()) if (!hosts.has(host)) hosts.set(host, code);
  }

  return { hosts, skipped: [...skipped], errors, sourceFailures, sources };
}

function namesOf(collection, field) {
  return new Set(
    Object.values(collection || {})
      .filter((item) => item && !item.deletedAt)
      .map((item) => normalizeName(item[field]))
      .filter(Boolean),
  );
}

// Records to create for /domains: one per registrable domain GAM knows, minus what already
// exists. userOwner stays empty — GAM has no idea who the PIC is, and an obvious blank in the
// form beats a guess nobody can audit.
export function planDomains(hosts, existingDomains) {
  const seen = namesOf(existingDomains, "domainUrl");
  const records = [];
  for (const [host, networkCode] of hosts) {
    const domainUrl = registrableDomain(host);
    if (seen.has(domainUrl)) continue;
    seen.add(domainUrl);
    records.push({ domainUrl, userOwner: "", networkCode, status: "Active" });
  }
  return records;
}

// Records to create for /sub-domains: one per hostname, linked to its parent domain when that
// domain already exists. pic stays empty for the same reason userOwner does — but note that a
// subdomain without a PIC will not show up on any user's detail page until someone sets one.
export function planSubdomains(hosts, existingSubs, existingDomains) {
  const seen = namesOf(existingSubs, "name");
  const domains = namesOf(existingDomains, "domainUrl");
  const records = [];
  let orphans = 0;
  for (const host of hosts.keys()) {
    if (seen.has(host)) continue;
    seen.add(host);
    const parent = registrableDomain(host);
    const linked = domains.has(parent);
    if (!linked) orphans++;
    records.push({
      name: host,
      parentDomain: linked ? parent : "",
      pic: "",
      status: "Active",
    });
  }
  return { records, orphans };
}

// One sentence the toast can show as-is. A bare count hides the two things worth acting on:
// names that were not hostnames, and networks that could not be read at all. Only a couple of
// examples go in the line — the full lists are logged, because a toast that quotes twenty ad
// unit names is one nobody finishes reading.
export function summarize(noun, created, { skipped = [], errors = [], extra = "" } = {}) {
  const sample = (list) => list.slice(0, 2).join(", ");
  const parts = [created > 0 ? `${created} ${noun} baru ditambahkan.` : `Tidak ada ${noun} baru.`];
  if (extra) parts.push(extra);
  if (skipped.length) {
    parts.push(
      `${skipped.length} nama di GAM bukan nama domain (mis. ${sample(skipped)}) — daftar lengkapnya ada di console.`,
    );
  }
  if (errors.length) {
    parts.push(`${errors.length} network gagal dibaca: ${sample(errors.map((e) => e.name))}.`);
  }
  return parts.join(" ");
}

// Yang harus diperiksa ketika Google tidak mengembalikan apa pun — beda API, beda tempat
// perbaikannya, dan saran GAM yang muncul di halaman AdSense mengirim orang ke setelan yang tidak
// ada di akunnya.
const NOTHING_SEEN_FIX = {
  gam: "Di GAM, pastikan Admin → Global settings → API access sudah ON, dan akun yang dipakai login terdaftar di Admin → Access & authorization → Users.",
  adsense:
    "Pastikan akun Google yang dipakai consent memang punya akun AdSense yang sudah disetujui, dan AdSense Management API sudah di-enable di project OAuth-nya.",
};

// Summary for the account import on /gam-accounts and /adsense-accounts. "Nothing was added" has
// two very different causes — Google returned no account at all, or it returned only accounts
// already in the list — and a bare count tells them apart for nobody. The first case is the one
// with something to fix, so it carries the fix.
export function summarizeNetworks(created, perCredential, errors, kind = "gam") {
  const parts = [];
  if (created > 0) {
    parts.push(`${created} akun baru ditambahkan.`);
  } else if (perCredential.some((c) => c.networks > 0)) {
    const dupes = perCredential.reduce((sum, c) => sum + c.duplicates.length, 0);
    parts.push(`Tidak ada akun baru — ${dupes} network dari Google sudah ada di daftar.`);
  } else {
    parts.push(
      `Tidak ada akun baru — Google tidak mengembalikan network apa pun. ${NOTHING_SEEN_FIX[kind] || NOTHING_SEEN_FIX.gam}`,
    );
  }
  const blind = perCredential.filter((c) => c.networks === 0).map((c) => c.credential);
  if (created > 0 && blind.length) {
    parts.push(`Tidak melihat network apa pun: ${blind.join(", ")}.`);
  }
  if (errors.length) {
    parts.push(
      `${errors.length} kredensial gagal dibaca: ${errors.map((e) => e.name).join(", ")}.`,
    );
  }
  return parts.join(" ");
}

/**
 * Kegagalan yang sebabnya ADA DI DASHBOARD, bukan di Google.
 *
 * Dibedakan karena tindakan berikutnya berbeda: yang ini diperbaiki dengan mengisi sesuatu di
 * layar (hubungkan kredensial, impor network dulu), sementara laporan GAM yang gagal cuma bisa
 * dicoba lagi. Server kontrol menjawabnya 422 dan bukan 502 — dan 502 untuk "belum ada kredensial"
 * mengirim orang memeriksa server yang sebenarnya sehat.
 */
export function preconditionError(message) {
  const error = new Error(message);
  error.precondition = true;
  return error;
}

// Both entry points need at least one network to ask and one connected credential to ask with.
export function assertDiscoverable(accounts, configs) {
  if ((accounts || []).length === 0) {
    throw preconditionError(
      "Belum ada akun GAM (Kode Jaringan) atau AdSense (Publisher ID). Jalankan 'Impor dari Google' di halaman GAM atau AdSense dulu.",
    );
  }
  const connected = Object.values(configs || {}).filter((c) => c?.refreshToken);
  if (connected.length === 0 && !process.env.GAM_REFRESH_TOKEN) {
    throw preconditionError("Belum ada Google credential yang terhubung.");
  }
}
