import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";

// Baca .env lokal
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

console.log("Supabase URL:", supabaseUrl);
console.log("Anon Key tersedia:", Boolean(supabaseAnonKey));
console.log("Service Key tersedia:", Boolean(supabaseServiceKey));

const keyToUse = supabaseServiceKey || supabaseAnonKey;
if (!supabaseUrl || !keyToUse) {
  console.error("Supabase URL atau Key tidak ditemukan di .env");
  process.exit(1);
}

const client = createClient(supabaseUrl, keyToUse);

async function check() {
  console.log("\n--- Memeriksa Tabel public.domains ---");
  const { data: domains, error: domErr } = await client.from("domains").select("*");
  if (domErr) {
    console.error("Error membaca domains:", domErr.message);
  } else {
    console.log(`Jumlah baris domains: ${domains?.length || 0}`);
    console.table(domains?.map((d) => ({ id: d.id, url: d.domain_url, status: d.status })));
  }

  console.log("\n--- Memeriksa Tabel public.subdomains ---");
  const { data: subdomains, error: subErr } = await client.from("subdomains").select("*");
  if (subErr) {
    console.error("Error membaca subdomains:", subErr.message);
  } else {
    console.log(`Jumlah baris subdomains: ${subdomains?.length || 0}`);
    console.table(
      subdomains?.map((s) => ({
        id: s.id,
        name: s.name,
        site_code: s.site_code,
        status: s.status,
      })),
    );
  }

  console.log("\n--- Memeriksa Tabel public.profiles ---");
  const { data: profiles, error: profErr } = await client.from("profiles").select("*");
  if (profErr) {
    console.error("Error membaca profiles:", profErr.message);
  } else {
    console.log(`Jumlah baris profiles: ${profiles?.length || 0}`);
    console.table(profiles?.map((p) => ({ id: p.id, name: p.name, email: p.email, role: p.role })));
  }
}

check();
