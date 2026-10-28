import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";

const envContent = fs.readFileSync(path.resolve(process.cwd(), ".env"), "utf-8");
const env = {};
for (const line of envContent.split("\n")) {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    let value = (match[2] || "").trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    env[match[1]] = value;
  }
}

const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY;
const supabaseServiceKey = env.SUPABASE_SERVICE_ROLE_KEY;

const client = createClient(supabaseUrl, supabaseServiceKey || supabaseAnonKey);

async function seed() {
  console.log("Memasukkan 4 Domain Induk...");
  const domainsData = [
    {
      domain_url: "https://ihopmenuwithprices.us",
      network_code: "23340206616",
      user_owner: "Mas Def",
      status: "Active",
    },
    {
      domain_url: "https://tacobellmenuu.us",
      network_code: "23380486168",
      user_owner: "Mas Def",
      status: "Active",
    },
    {
      domain_url: "https://tiktokmodapk.net",
      network_code: "23367555867",
      user_owner: "Mas Def",
      status: "Active",
    },
    {
      domain_url: "https://trayedit.com",
      network_code: "23344333667",
      user_owner: "Mas Def",
      status: "Active",
    },
  ];

  const { data: insertedDomains, error: domErr } = await client
    .from("domains")
    .upsert(domainsData, { onConflict: "domain_url" })
    .select();

  if (domErr) {
    console.error("Gagal insert domains:", domErr);
    return;
  }
  console.log("Berhasil insert domains:", insertedDomains?.length);

  const domainMap = {};
  insertedDomains.forEach((d) => {
    domainMap[d.domain_url] = d.id;
  });

  console.log("Memasukkan 17 Subdomain...");
  const subdomainsData = [
    // IHOP
    {
      name: "menu.ihopmenuwithprices.us",
      site_code: "ihop-menu",
      parent_domain: "https://ihopmenuwithprices.us",
      parent_domain_id: domainMap["https://ihopmenuwithprices.us"],
      campaign_codes: "pBRw",
      pic: "Mas Def",
      status: "Active",
    },
    {
      name: "deals.ihopmenuwithprices.us",
      site_code: "ihop-menu",
      parent_domain: "https://ihopmenuwithprices.us",
      parent_domain_id: domainMap["https://ihopmenuwithprices.us"],
      campaign_codes: "pBRw",
      pic: "Mas Def",
      status: "Active",
    },
    {
      name: "keto.ihopmenuwithprices.us",
      site_code: "ihop-menu",
      parent_domain: "https://ihopmenuwithprices.us",
      parent_domain_id: domainMap["https://ihopmenuwithprices.us"],
      campaign_codes: "pBRw",
      pic: "Mas Def",
      status: "Active",
    },
    {
      name: "hacks.ihopmenuwithprices.us",
      site_code: "ihop-menu",
      parent_domain: "https://ihopmenuwithprices.us",
      parent_domain_id: domainMap["https://ihopmenuwithprices.us"],
      campaign_codes: "pBRw",
      pic: "Mas Def",
      status: "Active",
    },
    {
      name: "news.ihopmenuwithprices.us",
      site_code: "ihop-menu",
      parent_domain: "https://ihopmenuwithprices.us",
      parent_domain_id: domainMap["https://ihopmenuwithprices.us"],
      campaign_codes: "pBRw",
      pic: "Mas Def",
      status: "Active",
    },

    // Taco Bell
    {
      name: "cantina.tacobellmenuu.us",
      site_code: "taco-fries",
      parent_domain: "https://tacobellmenuu.us",
      parent_domain_id: domainMap["https://tacobellmenuu.us"],
      campaign_codes: "taco",
      pic: "Mas Def",
      status: "Active",
    },
    {
      name: "burrito.tacobellmenuu.us",
      site_code: "taco-fries",
      parent_domain: "https://tacobellmenuu.us",
      parent_domain_id: domainMap["https://tacobellmenuu.us"],
      campaign_codes: "taco",
      pic: "Mas Def",
      status: "Active",
    },
    {
      name: "fries.tacobellmenuu.us",
      site_code: "taco-fries",
      parent_domain: "https://tacobellmenuu.us",
      parent_domain_id: domainMap["https://tacobellmenuu.us"],
      campaign_codes: "taco",
      pic: "Mas Def",
      status: "Active",
    },

    // TikTok Mod
    {
      name: "insurance.tiktokmodapk.net",
      site_code: "tiktok-mod",
      parent_domain: "https://tiktokmodapk.net",
      parent_domain_id: domainMap["https://tiktokmodapk.net"],
      campaign_codes: "tiktok",
      pic: "Mas Def",
      status: "Active",
    },
    {
      name: "careers.tiktokmodapk.net",
      site_code: "tiktok-mod",
      parent_domain: "https://tiktokmodapk.net",
      parent_domain_id: domainMap["https://tiktokmodapk.net"],
      campaign_codes: "tiktok",
      pic: "Mas Def",
      status: "Active",
    },
    {
      name: "rewards.tiktokmodapk.net",
      site_code: "tiktok-mod",
      parent_domain: "https://tiktokmodapk.net",
      parent_domain_id: domainMap["https://tiktokmodapk.net"],
      campaign_codes: "tiktok",
      pic: "Mas Def",
      status: "Active",
    },
    {
      name: "mod.tiktokmodapk.net",
      site_code: "tiktok-mod",
      parent_domain: "https://tiktokmodapk.net",
      parent_domain_id: domainMap["https://tiktokmodapk.net"],
      campaign_codes: "tiktok",
      pic: "Mas Def",
      status: "Active",
    },

    // Tray Edit
    {
      name: "decor.trayedit.com",
      site_code: "tray-decor",
      parent_domain: "https://trayedit.com",
      parent_domain_id: domainMap["https://trayedit.com"],
      campaign_codes: "TvH1",
      pic: "Mas Def",
      status: "Active",
    },
    {
      name: "materials.trayedit.com",
      site_code: "tray-decor",
      parent_domain: "https://trayedit.com",
      parent_domain_id: domainMap["https://trayedit.com"],
      campaign_codes: "TvH1",
      pic: "Mas Def",
      status: "Active",
    },
    {
      name: "cabinets.trayedit.com",
      site_code: "tray-decor",
      parent_domain: "https://trayedit.com",
      parent_domain_id: domainMap["https://trayedit.com"],
      campaign_codes: "TvH1",
      pic: "Mas Def",
      status: "Active",
    },
    {
      name: "guides.trayedit.com",
      site_code: "tray-decor",
      parent_domain: "https://trayedit.com",
      parent_domain_id: domainMap["https://trayedit.com"],
      campaign_codes: "TvH1",
      pic: "Mas Def",
      status: "Active",
    },
    {
      name: "styling.trayedit.com",
      site_code: "tray-decor",
      parent_domain: "https://trayedit.com",
      parent_domain_id: domainMap["https://trayedit.com"],
      campaign_codes: "TvH1",
      pic: "Mas Def",
      status: "Active",
    },
  ];

  const { data: insertedSubs, error: subErr } = await client
    .from("subdomains")
    .upsert(subdomainsData, { onConflict: "name" })
    .select();

  if (subErr) {
    console.error("Gagal insert subdomains:", subErr);
    return;
  }
  console.log("Berhasil insert subdomains:", insertedSubs?.length);
  console.log("SELESAI!");
}

seed();
