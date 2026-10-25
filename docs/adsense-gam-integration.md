# AdSense / Ad Manager sync integration

**Verdict:** your data is **Google Ad Manager (GAM)**, not plain AdSense — every account
and domain has a numeric `networkCode` (e.g. `22771581772`) and your credentials are named
`GAM ...`. So this integrates the **Google Ad Manager API (Beta)**, keyed by network code.
See `docs/database-schema.md` for the `adsenseAccounts` / `googleApiConfigs` shape.

**Runtime:** a standalone **Node script** (`functions/sync-gam.mjs`), run manually or via
cron. **No Cloud Functions, no Blaze, no service account.**
- **GAM auth:** OAuth (clientId + clientSecret + refreshToken) held in a `googleApiConfigs`
  record — exactly what `/google-api-configs` stores. Each `adsenseAccount.googleCredential`
  picks which credential to use; empty falls back to the `GAM_*` env default.
- **RTDB writes:** the Firebase client SDK signed in as an existing app user (`db.mjs`) —
  writes go through the normal `.write: auth != null` rules.

## How it works

- **`functions/index.js`** — a Cloud Function (`oauth`) powering the **Login/Reconnect**
  button on `/google-api-configs`. It builds the consent URL, exchanges the code with the
  client secret **server-side**, and stores the refresh token on the record. Stable URL:
  `https://asia-southeast1-rabbitroi-89973.cloudfunctions.net/oauth`.
- `functions/oauth.mjs` — OAuth2 helpers reused by the CLI (consent URL, refresh→access token).
- `functions/tools/authorize.mjs` (`npm run authorize`) — CLI alternative to the button; same
  result, no deploy needed.
- `functions/gam.js` — Ad Manager REST client (create → run → poll → fetchRows), aggregates
  earning / impressions / clicks / RPM / CPC. Auth-agnostic (takes an access token).
- `functions/sync-core.js` — shared per-account logic (resolve credential → token → report →
  build the update). Writes back to `adsenseAccounts/{id}`: `syncStatus`, `lastSyncActionAt`,
  `lastSyncPublisherId`, `syncEarning`, `syncImpressions`, `syncClicks`, `syncPageRpm`, `syncCpc`.
- `functions/sync-gam.mjs` — the runtime: dipanggil `scheduledSync` tiap jam, dan bisa
  dijalankan sendiri lewat `npm run sync` (client SDK).
- `functions/discover-core.js` + `discover-sites.mjs` — the **Impor dari Google** button on
  `/domains` and `/sub-domains` (see "Site import" below).

> The `Earning (Sync)` column on `/adsense-accounts` updates live after a sync.

## Setup

### 1. Create the OAuth client (once)
1. [Cloud Console](https://console.cloud.google.com) → project `rabbitroi-89973` →
   **APIs & Services → Library** → enable **Google Ad Manager API**.
2. **APIs & Services → OAuth consent screen** → configure (add your Google account as a test
   user if the app stays in "Testing").
3. **APIs & Services → Credentials → Create credentials → OAuth client ID** →
   **Web application** → add authorized redirect URIs (both, exactly):
   - `https://asia-southeast1-rabbitroi-89973.cloudfunctions.net/oauth`  ← for the in-app button
   - `http://localhost:4571/callback`  ← for the CLI fallback (optional)
   → Create. Copy the **Client ID** and **Client Secret**.

### 2. Add the credential in the app
`/google-api-configs/new` → paste **Client ID** + **Client Secret**, name it (e.g. `GAM Sandi Primary`).
On each Adsense account (`/adsense-accounts`), set **Koneksi Google API** to that name
(leave empty to use the `GAM_*` env default instead).

### 3. Daftarkan alamat callback server kontrol
Tombol **Login** memakai server kontrol (`server/`), bukan Cloud Function: jalur browser → Cloud
Function diblokir DRS dan tidak pernah bisa dipakai. Sekali per OAuth client:

- `CONTROL_PUBLIC_URL` di `server/.env` = alamat publik server (`https://dashboard-api.adsgo.live`).
- Tambahkan `<CONTROL_PUBLIC_URL>/google/callback` ke **Authorized redirect URIs** OAuth client itu
  di Google Cloud Console. Dicocokkan karakter demi karakter; yang tidak terdaftar ditolak dengan
  `redirect_uri_mismatch`, yang tidak menyebut nilai mana yang diharapkannya.

Verifikasi tanpa menekan tombolnya tujuh kali — sekaligus menyebut scope yang benar-benar dibawa
token tiap kredensial saat ini:

```
cd functions && npm run oauth:check
```

Selengkapnya: [server/README.md](../server/README.md#tombol-login-google-google-api-configs).

### 4. Connect from the app — the button
Di `/google-api-configs`, klik **Login** pada kredensialnya → pilih akun Google yang **memiliki
network GAM itu** → setujui **kedua** izin (Ad Manager dan AdSense). Kolom **Izin** lalu menyebut
apa yang benar-benar diberikan, dan Status jadi **Connected**. **Reconnect** menjalankan hal yang
sama untuk kredensial yang sudah terhubung.

**Tiga hasil, dan ketiganya berbunyi berbeda di layar** — "tersimpan" tidak berarti "terhubung":

| toast hijau | token baru, kedua izin diberikan |
|---|---|
| toast kuning | token tersimpan, izinnya kurang — halaman AdSense akan tetap kosong sampai consent diulang |
| toast merah | Google tidak mengembalikan refresh token; **tidak ada yang berubah**, token lama masih yang dipakai. Cabut akses di [myaccount.google.com/permissions](https://myaccount.google.com/permissions) lalu ulangi |

Pastikan akun Google itu punya akses laporan di **GAM → Admin → Access & authorization → Users**,
dan **Admin → Global settings → API access** dalam keadaan ON.

**CLI alternative** (tanpa server kontrol): `npm run authorize "GAM Sandi Primary"` — butuh
`SYNC_USER_EMAIL`/`SYNC_USER_PASSWORD` di `functions/.env.sync`, memakai redirect localhost yang
tidak perlu didaftarkan ulang di Google.

> **Kredensial yang consent-nya lebih tua dari scope AdSense tetap berstatus "Connected".** Token
> yang sudah terbit tidak ikut berubah saat `adsense.readonly` ditambahkan ke `SCOPES`, dan
> mengaktifkan AdSense Management API di Cloud Console juga tidak mengubahnya — yang keluar adalah
> `403 insufficient authentication scopes`, yang bentuknya sama persis dengan token kedaluwarsa.
> Satu-satunya perbaikannya consent ulang. Kolom **Izin** kosong berarti "belum pernah login lewat
> tombol", bukan "tidak punya izin apa-apa".

### 5. Confirm metric/dimension names
The right revenue metric depends on the network type: **Ad Exchange** → `AD_EXCHANGE_REVENUE`,
**AdSense-in-GAM** → `ADSENSE_REVENUE`, **Ad Server** → `AD_SERVER_GROSS_REVENUE`. The wrong one
returns **0** even when impressions/clicks have data. Defaults suit Ad Exchange; verify in the
[API Explorer](https://developers.google.com/ad-manager/api/beta/reference/rest/v1/networks.reports),
then override without code changes (order stays impressions, clicks, revenue):
```
GAM_METRICS=IMPRESSIONS,CLICKS,AD_EXCHANGE_REVENUE
GAM_DIMENSIONS=DATE,AD_UNIT_NAME
```
Report payload uses the GA v1 schema (`dateRange.fixed.{startDate,endDate}`); money comes as
`doubleValue` in currency units (not micros).

**Date range:** the sync pulls **yesterday** by default. `GAM_RANGE_DAYS=90` widens the window to
backfill the **per-day ROI rows** for the last 90 days (ending yesterday).

It does **not** widen the single-number account columns (Earning/Impressions/Clicks on
`/gam-accounts` and `/adsense-accounts`). Those read `period.settledDayRange` — yesterday alone —
because they sit next to `lastSyncReportDate`, which names one day: a three-day total labelled
"yesterday" is a number that lies. The same report decides the account Status column, and through a
widened window an account that stopped serving two days ago still reads "Ready" on the strength of
one impression from the first day of the range.

### 6. Sync
Sync tidak dipicu dari browser: `scheduledSync` menjalankannya tiap jam (lihat
[scheduled-sync.md](scheduled-sync.md)). Di luar jadwal, jalankan sendiri dengan `npm run sync`
(butuh `SYNC_USER_*` di `.env.sync`), atau lewat cron mesin sendiri, e.g.
```
0 6 * * *  cd .../functions && /usr/local/bin/node --env-file-if-exists=.env.sync sync-gam.mjs >> /tmp/gam-sync.log 2>&1
```

## Security note

`clientSecret` and `refreshToken` are stored in `googleApiConfigs` (RTDB). Current rules let
any authenticated user read them. Before production, tighten `googleApiConfigs` read to admins
only in `database.rules.json`. (This follows the existing schema decision to keep secrets in RTDB.)

## Sub-domain sync (`/sub-domains` → "Sync dari GAM")

`sync-subdomains.mjs` (`npm run sync:roi`, juga satu tahap di `scheduledSync`) runs a
per-**site** GAM report and fills `subDomains` `revenueToday` / `ecpm` / `cpc`, matching the
dimension value to `subDomains.name` (case-insensitive). It runs across every adsense account's
network.

- Matching is by name. If your GAM names differ, the toast reports the **unmatched GAM names**
  so you can see the real values and either rename subdomains or change the dimension — or
  click **Impor dari Google** to create them from GAM's own names (see "Site import" below).
- The dimension is **`SITE`** (default) — the same one "Impor dari Google" creates subdomains
  from, so the names line up by construction. It used to default to `AD_UNIT_NAME`, which on an
  Ad Exchange network returns `Ad Exchange Display` and matched **nothing**: 0 subdomains filled,
  no error. Override per network with `GAM_SUBDOMAIN_DIMENSION=AD_UNIT_NAME` only if that
  network really does name its ad units after hostnames.
- Domains stay pure config — no per-domain metric is pulled.
- **Overview join (`/sub-domains` → "Sync ROI"):** the same sync upserts
  `dashboard/roiReports/{YYYY-MM-DD}__{subdomainId}` (one row per day, overwritten by every sync)
  and — for the running day only — `dashboard/roiSnapshots/{YYYY-MM-DD}T{HH-mm}__{subdomainId}`
  (one row per sync, kept `ROI_SNAPSHOT_DAYS`), so the Overview "Laporan ROI Realtime" table shows
  real per-subdomain **Earning / Clicks / CPC / Page RPM** for every sync of the day. Both are
  keyed deterministically (idempotent; manual push-id rows untouched). Snapshot rows are cumulative
  since midnight — never sum them across a day. The per-user detail page (`/users/:id`) picks
  these up automatically via its `pic === user.name` fallback — no extra step.
- **Spend → ROI:** if a Meta token is configured, the same sync pulls **per-campaign** spend
  (`fetchCampaignSpend`) and attributes it to subdomains via a campaign→subdomain map built
  from every user's `campaigns[]` (`campaign` name → `subDomain`). Matched subdomains get real
  **Spending / ROI / Profit**; unmatched campaigns are reported in the toast. Subdomains with
  no campaign mapping keep Spending/ROI "-" (not faked).
- **ROI per country (`users/{id}.countryRoi`):** a second report per network breaks the same
  earnings down by **site × country** (`GAM_COUNTRY_DIMENSIONS`, default
  `COUNTRY_CODE,COUNTRY_NAME`) and is joined to Meta's `breakdowns=country` spend on the ISO
  code — Meta only ever names a country by code, GAM by name, which is why both are asked for.
  Rows land on the subdomain's PIC and are charged the ad tax before ROI — rate set by an admin
  on `/settings`, see `docs/meta-ads-integration.md`. This report is **non-fatal**: a network that rejects the
  country dimensions is named in the summary and subdomain ROI is unaffected — the enum names
  differ by network type, so verify them in the API Explorer before overriding.

## Site import (`/domains` and `/sub-domains` → "Impor dari Google")

Both pages have an **Impor dari Google** button that fills the list from the Google Ad Manager
API alone — no spreadsheet.

**Three sources, merged.** No single GAM endpoint holds the whole site list, so discovery reads
all of them per network and de-duplicates rather than picking one and hoping:

1. **`networks.sites.list`** (`listSites`) — GAM → **Inventory → Sites**, the authoritative
   domain list, subsites included. This is the one that matters on an Ad Exchange network,
   whose ad unit tree is often just the default `ca-pub-…` nodes carrying no hostname at all.
2. **`networks.adUnits.list`** (`listAdUnits`) — hostnames only when whoever set up the network
   named the ad units that way. Configuration, so it finds sites with zero traffic.
3. **A report** — only run when 1 and 2 produced no host *below* its registrable domain
   (`isSubdomain`), because a report costs a create/run/poll round trip. It is the one source
   that sees a subsite that earns but isn't registered anywhere listable. Its dimension is
   **`SITE`** — override with `GAM_DISCOVER_DIMENSION`. Note this is **not**
   `GAM_SUBDOMAIN_DIMENSION`, which points Sync ROI at ad units to attribute earnings.

> **`SITE`, not `SITE_NAME`.** The SOAP API calls this dimension `SITE_NAME` and the REST v1 API
> rejects that with a 400 — verified against the live API, along with `SITE_ID`, `DOMAIN` and
> `AD_EXCHANGE_SITE_NAME`, all invalid. `URL` is accepted but breaks down per page, below the
> site level. Subsites arrive **only** through this report: `networks.sites.list` returns just
> the parent site (confirmed on two live networks), so this fallback is what makes
> `care.petcins.com` and its siblings importable at all.

The result reports `sources: { sites, adUnits, report }` — how many hostnames each endpoint
contributed. All three at zero means the network has no site list to read, which is a different
problem from a parsing one; it goes to the browser console (and stdout on the CLI).

Logic lives in `functions/discover-core.js` (no DB access — same split as `sync-core.js`):

- `hostnameFrom` — only GAM names that read as a hostname become sites. `Banner_300x250_Header`
  and `ca-pub-8660742543707970` are **skipped and reported back** rather than imported as
  domains. Strips scheme/`www.`/path (Sites returns full URLs), rejects IPs. The toast names two
  examples; the full skipped list goes to the console, since it is the whole diagnosis when
  nothing imports.
- `registrableDomain` — `news.example.co.id` → `example.co.id`, not `co.id`. The multi-part
  public suffixes that matter (`.co.id`, `.my.id`, `.com.au`, …) are listed in the file.
- `planDomains` / `planSubdomains` — build the records, skipping what already exists
  (case-insensitive; archived rows don't block a re-import).

**Import domains first, then subdomains** — a subdomain only gets its `parentDomain` filled if
that domain already exists; the toast counts the ones left unlinked.

Two fields are deliberately left blank because Google has no equivalent: `domains.userOwner` and
`subDomains.pic`. **A subdomain with no PIC will not appear on any user's detail page** until
someone sets one, so fill the PIC column after importing.

Run it two ways — button (the `importGamDomains` / `importGamSubdomains` callables, hanya saat
`VITE_FUNCTIONS_ENABLED=true`), atau CLI:

```
cd functions
npm run discover:domains
npm run discover:subdomains
```

## Not built yet (say the word)

- **Meta Ads sync for `/ad-accounts` balance** is separate from this (`sync-meta.mjs`); the
  Facebook Marketing API auth still needs the System User token (see meta doc).

## Test

`cd functions && npm test` — self-checks the row aggregation (money-as-micros, empty rows).
