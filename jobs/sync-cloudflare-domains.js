#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { listDnsRecords, listZones } from "../functions/cloudflare.js";

/**
 * TigerROI - Sinkronisasi Realtime Domain & Subdomain dari Cloudflare ke Supabase
 *
 * Mengambil seluruh Domain Induk (Zones) dan Subdomain (DNS Record A/CNAME)
 * dari akun Cloudflare, kemudian secara otomatis mendaftarkan domain dan subdomain
 * baru ke tabel `public.domains` dan `public.subdomains` di Supabase.
 *
 * Penggunaan:
 *   node jobs/sync-cloudflare-domains.js [--dry-run]
 */

function loadEnv() {
  const envCandidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "server", ".env"),
    path.resolve(process.cwd(), "jobs", ".env"),
  ];

  for (const envPath of envCandidates) {
    if (fs.existsSync(envPath)) {
      const lines = fs.readFileSync(envPath, "utf-8").split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx > 0) {
          const k = trimmed.slice(0, eqIdx).trim();
          const v = trimmed
            .slice(eqIdx + 1)
            .trim()
            .replace(/^["']|["']$/g, "");
          if (!process.env[k]) process.env[k] = v;
        }
      }
    }
  }

  if (!process.env.SUPABASE_URL && process.env.VITE_SUPABASE_URL) {
    process.env.SUPABASE_URL = process.env.VITE_SUPABASE_URL;
  }
}

loadEnv();

const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || "";

const args = process.argv.slice(2);
const isDryRun = args.includes("--dry-run");

// Record teknis bawaan hosting/cPanel/email yang bukan subdomain WordPress iklan
const IGNORED_PREFIXES = new Set([
  "mail",
  "webmail",
  "cpanel",
  "whm",
  "webdisk",
  "autodiscover",
  "autoconfig",
  "cpcalendars",
  "cpcontacts",
  "ftp",
  "ns1",
  "ns2",
]);

function cleanHost(val) {
  return String(val || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .replace(/\.$/, "");
}

export async function run() {
  const startedAt = new Date().toISOString();
  console.log("========================================================================");
  console.log("   TIGERROI - SINKRONISASI DOMAIN & SUBDOMAIN CLOUDFLARE KE SUPABASE   ");
  console.log(`   Waktu Mulai: ${startedAt}                                           `);
  console.log("========================================================================");

  if (!CLOUDFLARE_API_TOKEN) {
    console.error("❌ CLOUDFLARE_API_TOKEN belum disetel di environment atau .env.");
    process.exit(1);
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("❌ SUPABASE_URL atau SUPABASE_SERVICE_ROLE_KEY belum disetel.");
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1. Ambil data domain & subdomain yang ada di Supabase saat ini
  console.log("\n📥 Membaca data domain dan subdomain saat ini dari Supabase...");
  const [{ data: existingDomains, error: domErr }, { data: existingSubdomains, error: subErr }] =
    await Promise.all([
      supabase.from("domains").select("id, domain_url, network_code, status"),
      supabase.from("subdomains").select("id, name, site_code, parent_domain, parent_domain_id, pic"),
    ]);

  if (domErr) throw new Error(`Gagal membaca tabel domains: ${domErr.message}`);
  if (subErr) throw new Error(`Gagal membaca tabel subdomains: ${subErr.message}`);

  const dbDomainsMap = new Map();
  for (const d of existingDomains || []) {
    dbDomainsMap.set(cleanHost(d.domain_url), d);
  }

  const dbSubdomainsMap = new Map();
  for (const s of existingSubdomains || []) {
    dbSubdomainsMap.set(cleanHost(s.name), s);
  }

  console.log(`✅ Supabase memuat: ${dbDomainsMap.size} domain induk dan ${dbSubdomainsMap.size} subdomain terdaftar.`);

  // 2. Ambil seluruh Zona dari Cloudflare API
  console.log("\n🌐 Menghubungi Cloudflare API untuk mengambil daftar Zona (Domain Induk)...");
  const zones = await listZones(CLOUDFLARE_API_TOKEN);
  console.log(`✅ Ditemukan ${zones.length} Zona aktif di Cloudflare.`);

  let newDomainsCount = 0;
  let newSubdomainsCount = 0;

  // 3. Proses Sinkronisasi Domain Induk ke public.domains
  for (const zone of zones) {
    const host = cleanHost(zone.name);
    if (!host) continue;

    if (!dbDomainsMap.has(host)) {
      console.log(`   ➕ Menemukan Domain Induk baru: ${host}`);
      const domainUrl = `https://${host}`;

      if (!isDryRun) {
        const { data: insertedDom, error: insertDomErr } = await supabase
          .from("domains")
          .insert({
            domain_url: domainUrl,
            status: "Active",
            updated_at: new Date().toISOString(),
          })
          .select("id, domain_url, status")
          .single();

        if (insertDomErr) {
          console.warn(`   ⚠️ Gagal menyimpan domain ${host}: ${insertDomErr.message}`);
        } else if (insertedDom) {
          dbDomainsMap.set(host, insertedDom);
          newDomainsCount++;
          console.log(`   ✅ Tersimpan ke public.domains (ID: ${insertedDom.id})`);
        }
      } else {
        newDomainsCount++;
      }
    }
  }

  // 4. Proses Sinkronisasi Subdomain dari DNS Records tiap Zona
  console.log("\n🔍 Memeriksa DNS Record A & CNAME untuk mendeteksi subdomain baru...");

  for (const zone of zones) {
    const zoneHost = cleanHost(zone.name);
    const parentDom = dbDomainsMap.get(zoneHost);
    const parentDomainUrl = parentDom?.domain_url || `https://${zoneHost}`;
    const parentDomainId = parentDom?.id || null;

    // Cari site_code yang umum digunakan oleh subdomain pada domain induk ini
    let existingSiteCode = "";
    for (const s of existingSubdomains || []) {
      const sHost = cleanHost(s.name);
      if (sHost.endsWith(`.${zoneHost}`) && s.site_code) {
        existingSiteCode = s.site_code;
        break;
      }
    }

    if (!existingSiteCode) {
      // Fallback site_code cerdas dari nama domain
      if (zoneHost.includes("ihop")) existingSiteCode = "ihop-menu";
      else if (zoneHost.includes("trayedit")) existingSiteCode = "tray-decor";
      else if (zoneHost.includes("tacobell")) existingSiteCode = "taco-fries";
      else if (zoneHost.includes("tiktok")) existingSiteCode = "tiktok-mod";
      else existingSiteCode = zoneHost.split(".")[0];
    }

    let records = [];
    try {
      records = await listDnsRecords(CLOUDFLARE_API_TOKEN, zone.id);
    } catch (recErr) {
      console.warn(`   ⚠️ Gagal membaca DNS records zona ${zone.name}: ${recErr.message}`);
      continue;
    }

    // Filter record yang merupakan subdomain iklan
    for (const r of records) {
      const type = String(r.type || "").toUpperCase();
      if (type !== "A" && type !== "CNAME") continue;

      const fullHost = cleanHost(r.name);
      if (!fullHost || fullHost === zoneHost) continue; // Abaikan domain apex / root
      if (!fullHost.endsWith(`.${zoneHost}`)) continue; // Harus subdomain dari zona ini

      const subPrefix = fullHost.slice(0, -(zoneHost.length + 1));
      if (IGNORED_PREFIXES.has(subPrefix) || subPrefix.startsWith("_")) continue;

      // Cek apakah subdomain sudah terdaftar di Supabase
      if (!dbSubdomainsMap.has(fullHost)) {
        console.log(`   ➕ Menemukan Subdomain baru: ${fullHost} (Tipe: ${type}, Target: ${r.content})`);

        if (!isDryRun) {
          const { data: insertedSub, error: insertSubErr } = await supabase
            .from("subdomains")
            .insert({
              name: fullHost,
              site_code: existingSiteCode,
              parent_domain: parentDomainUrl,
              parent_domain_id: parentDomainId,
              status: "Active",
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .select("id, name, site_code")
            .single();

          if (insertSubErr) {
            console.warn(`   ⚠️ Gagal menyimpan subdomain ${fullHost}: ${insertSubErr.message}`);
          } else if (insertedSub) {
            dbSubdomainsMap.set(fullHost, insertedSub);
            newSubdomainsCount++;
            console.log(`   ✅ Tersimpan ke public.subdomains (${insertedSub.site_code})`);
          }
        } else {
          newSubdomainsCount++;
        }
      }
    }
  }

  // 5. Catat riwayat eksekusi ke tabel sync_runs
  const finishedAt = new Date().toISOString();
  console.log("\n========================================================================");
  console.log(`🏁 Selesai pada: ${finishedAt}`);
  console.log(`   Total Domain Induk Baru Ditambahkan: ${newDomainsCount}`);
  console.log(`   Total Subdomain Baru Ditambahkan    : ${newSubdomainsCount}`);
  console.log("========================================================================");

  try {
    await supabase.from("sync_runs").insert({
      job_name: "sync-cloudflare-domains",
      status: "success",
      started_at: startedAt,
      finished_at: finishedAt,
      rows_synced: newDomainsCount + newSubdomainsCount,
      details: {
        new_domains: newDomainsCount,
        new_subdomains: newSubdomainsCount,
        total_zones: zones.length,
      },
    });
  } catch (logErr) {
    console.warn(`Peringatan: Gagal mencatat log ke sync_runs: ${logErr.message}`);
  }
}

if (process.argv[1] && process.argv[1].endsWith("sync-cloudflare-domains.js")) {
  run().catch((err) => {
    console.error("❌ Fatal Error:", err.message);
    process.exit(1);
  });
}
