// Verify a Meta (Facebook) access token before wiring it into the sync.
// Prints what the token is (app, type, expiry, scopes) and every ad account it can read,
// so you can copy the ACT IDs into the dashboard's /ad-accounts page.
//
//   cd functions
//   npm run meta:check
//   npm run meta:check            # reads META_ACCESS_TOKEN from .env.sync

const VERSION = process.env.META_API_VERSION || "v25.0";
const BASE = `https://graph.facebook.com/${VERSION}`;

async function graph(path, token, params = {}) {
  const url = new URL(`${BASE}/${path}`);
  url.searchParams.set("access_token", token);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(`${path} -> ${data.error?.message || res.status}`);
  return data;
}

function expiry(unixSeconds) {
  if (!unixSeconds) return "tidak kadaluarsa";
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

const token = process.env.META_ACCESS_TOKEN;
if (!token) {
  console.error("Set META_ACCESS_TOKEN dulu (System User token dari Business Manager).");
  process.exit(1);
}

// debug_token works with the token inspecting itself — no separate app token needed.
const { data: info } = await graph("debug_token", token, { input_token: token }).catch((e) => {
  console.error(`Gagal cek token: ${e.message}`);
  process.exit(1);
});
if (!info?.is_valid) {
  console.error(`Token TIDAK valid: ${info?.error?.message || "unknown"}`);
  process.exit(1);
}
console.log(`Token valid.
  app_id     : ${info.app_id}${info.application ? ` (${info.application})` : ""}
  type       : ${info.type}
  expires    : ${expiry(info.expires_at)}
  data access: ${expiry(info.data_access_expires_at)}
  scopes     : ${(info.scopes || []).join(", ") || "-"}`);

if (!(info.scopes || []).includes("ads_read")) {
  console.warn("PERINGATAN: scope `ads_read` tidak ada — sync akan gagal baca ad account.");
}

const accounts = await graph("me/adaccounts", token, {
  fields: "account_id,name,currency,account_status,balance,amount_spent,spend_cap",
  limit: "200",
});
const rows = accounts.data || [];
if (!rows.length) {
  console.warn(
    "\nTidak ada ad account yang bisa dibaca token ini. Assign ad account-nya ke System User " +
      "di Business Settings -> Users -> System Users -> Assign Assets.",
  );
  process.exit(1);
}

console.log(`\n${rows.length} ad account terbaca (ACT ID untuk diisi di /ad-accounts):`);
// Batas dan terpakai ikut dicetak karena dari sinilah pembagi minor unit dikalibrasi: `cap`
// harus sama persis dengan angka bulat yang diketik di kartu "Batas pengeluaran akun" di Meta.
// Kalau meleset 100x, set META_MINOR_UNIT=1. `sisa` adalah yang tampil sebagai kolom Sisa Saldo.
const MINOR = Number(process.env.META_MINOR_UNIT || 1);
for (const a of rows) {
  const major = (v) => Number(v || 0) / MINOR;
  const cap = major(a.spend_cap);
  const spent = major(a.amount_spent);
  console.log(
    `  act_${a.account_id}  ${a.name || "(tanpa nama)"} — ${a.currency} ` +
      `sisa ${cap > 0 ? Math.round((cap - spent) * 100) / 100 : "-"} ` +
      `(batas ${cap || "-"} · terpakai ${spent}) · tagihan ${major(a.balance)} ` +
      `· status ${a.account_status}`,
  );
}
