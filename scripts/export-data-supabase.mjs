import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";

// Parser env manual sederhana tanpa dependensi
function loadEnv() {
  const envPath = path.resolve(".env");
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      process.env[key] = val;
    }
  }
}
loadEnv();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌ SUPABASE_URL atau KEY tidak ditemukan di .env!");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const TABLES = [
  "profiles",
  "sites",
  "domains",
  "subdomains",
  "meta_accounts",
  "gam_accounts",
  "ad_accounts",
  "daily_stats",
  "payouts",
  "expenses",
  "whitelist_topup"
];

function escapeSqlVal(val) {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "boolean") return val ? "TRUE" : "FALSE";
  if (typeof val === "number") return String(val);
  if (typeof val === "object") {
    return "'" + JSON.stringify(val).replace(/'/g, "''") + "'::jsonb";
  }
  return "'" + String(val).replace(/'/g, "''") + "'";
}

async function exportAll() {
  console.log("Memulai ekspor data dari Supabase Cloud:", SUPABASE_URL);
  let dumpSql = "-- ==============================================================================\n" +
                "-- BACKUP DATA TIGERROI DARI SUPABASE CLOUD\n" +
                "-- ==============================================================================\n\n" +
                "SET session_replication_role = 'replica'; -- Matikan foreign key sementara\n\n";

  for (const table of TABLES) {
    console.log(`Menarik data dari tabel ${table}...`);
    try {
      const { data, error } = await supabase.from(table).select("*");
      if (error) {
        console.warn(`  ⚠️ Peringatan tabel ${table}: ${error.message}`);
        continue;
      }
      if (!data || data.length === 0) {
        console.log(`  ℹ️ Tabel ${table} kosong.`);
        continue;
      }

      console.log(`  ✅ Mengambil ${data.length} baris dari ${table}.`);
      const cols = Object.keys(data[0]);
      dumpSql += `\n-- Tabel: ${table} (${data.length} baris)\n`;
      
      // Batch insert per 100 baris
      for (let i = 0; i < data.length; i += 100) {
        const chunk = data.slice(i, i + 100);
        dumpSql += `INSERT INTO public.${table} (${cols.map(c => `"${c}"`).join(", ")}) VALUES\n`;
        const valLines = chunk.map(row => {
          return "  (" + cols.map(c => escapeSqlVal(row[c])).join(", ") + ")";
        });
        dumpSql += valLines.join(",\n") + "\nON CONFLICT DO NOTHING;\n";
      }
    } catch (err) {
      console.warn(`  ⚠️ Gagal ekspor ${table}: ${err.message}`);
    }
  }

  dumpSql += "\nSET session_replication_role = 'origin'; -- Nyalakan kembali foreign key\n";

  const outPath = path.resolve("scripts/backup_data_cloud.sql");
  fs.writeFileSync(outPath, dumpSql, "utf8");
  console.log(`\n🎉 Ekspor Selesai! File tersimpan di: ${outPath} (Ukuran: ${(dumpSql.length / 1024).toFixed(1)} KB)`);
}

exportAll();
