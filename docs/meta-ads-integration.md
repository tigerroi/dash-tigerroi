# Meta (Facebook) Ads sync integration

Pulls **balance** and **today's spend** per Meta ad account into `/ad-accounts`. Separate
from the Google/GAM work — different API, different auth.

**Runtime:** the hourly `scheduledSync` Cloud Function (see
[scheduled-sync.md](scheduled-sync.md)) runs this on its own; out of schedule, run the CLI
(`sync-meta.mjs`). Both read the System User token from `functions/.env.sync` — never from the
browser. `scheduledSync` reads the same token from Secret Manager.

## How it works

- `functions/meta.js` — Graph API client. Per `act_<id>`:
  `GET /act_<id>?fields=balance,amount_spent,spend_cap,currency` +
  `GET /act_<id>/insights?fields=spend&date_preset=today`.
- `functions/sync-core.js` → `metaUpdate()` builds the update; `sync-meta.mjs` writes
  `balance`, `spendCap`, `amountSpent`, `amountDue`, `spendToday`, `currency`, `syncStatus`,
  `lastSyncActionAt`. Shows in the `Sisa Saldo` / `Batas Pengeluaran` / `Pengeluaran Hari Ini`
  columns.

## Getting the access token (Meta for Developers + Business Manager)

The sync needs **one** long-lived token with `ads_read` on every ad account you want to track.
A **System User** token is the right kind: it belongs to the business, not to a person, so it
survives password changes and does not expire.

Prerequisites: you are an **admin** of the Business Manager
([business.facebook.com](https://business.facebook.com)) that owns the ad accounts.

1. **Create the app** — [developers.facebook.com](https://developers.facebook.com) → *My Apps*
   → *Create App* → use case **Other** → type **Business** → pick the Business Manager as the
   app's business. Note the **App ID**.
2. **Add the Marketing API product** to the app (*Add Product* → Marketing API → Set up).
   The app can stay in *Development* mode — a System User token still reads the ad accounts
   that business owns; App Review is only needed for other people's accounts.
3. **Create the System User** — Business Settings → *Users* → **System Users** → *Add* →
   name it (e.g. `rabbitroi-sync`) → role **Employee** is enough (Admin also works).
4. **Assign the assets** — with the System User selected: *Add Assets* → **Ad Accounts** →
   tick every account → permission **View performance** (that is the read side of `ads_read`).
   Also *Add Assets* → **Apps** → your app → **Develop/Manage**. Anything not assigned here is
   invisible to the token.
5. **Generate the token** — System User → **Generate new token** → select your app → tick
   **`ads_read`** (add **`read_insights`** only if you later need page/post insights) →
   *Generate*. **Copy it now** — Meta shows it exactly once. Leave *Token expiration* at
   **Never**.
6. **Verify before wiring it in**:
   ```bash
   cd functions
   META_ACCESS_TOKEN=EAAG... npm run meta:check
   ```
   It prints the token's app, type, expiry and scopes, then every ad account the token can
   read with its **ACT ID** — those are the ids to enter in the dashboard. An empty list means
   step 4 was missed.

Short-lived alternative (testing only): Graph API Explorer → pick the app → *Generate Access
Token* with `ads_read`. That token lasts ~1–2 hours; exchange it for a ~60-day one with
`GET /oauth/access_token?grant_type=fb_exchange_token&client_id=<app-id>&client_secret=<secret>&fb_exchange_token=<short-token>`.
It still expires, so use a System User token for anything running unattended.

## Setup

1. Get the token (above), then put it where the runtime you use reads it:
   - **CLI (current runtime)** — `functions/.env.sync`: `META_ACCESS_TOKEN=EAAG...`, run
     `npm run sync:meta` (all accounts) or `npm run sync:meta <id1> <id2>`. Check with
     `npm run meta:check`.
   - **Scheduled function** — `cd functions && firebase functions:secrets:set META_ACCESS_TOKEN
     --project rabbitroi-89973`, then redeploy `scheduledSync`.
   - **Cloud Functions** (only once DRS is relaxed) — `cd functions &&
     firebase functions:secrets:set META_ACCESS_TOKEN --project rabbitroi-89973 && npm run deploy`.
2. Add ad accounts in the app (`/ad-accounts`) with the real **ACT ID** from `meta:check`
   (with or without the `act_` prefix).
3. Run `npm run sync:meta`, or wait for the next scheduled run.

**Rotating the token:** generate a new System User token, replace the value in every place
above. Revoke the old one in Business Settings → System Users → *Remove token*.

## Caveats to verify against your account

- **"Sisa Saldo" = `spend_cap - amount_spent`**, angka yang sama dengan kartu *Batas pengeluaran
  akun -> Jumlah yang tersisa* di Ads Manager. Field `balance` milik Meta **bukan** sisa saldo —
  itu tagihan berjalan yang belum ditagih, dan ia naik saat beriklan; nilainya tetap disimpan
  sebagai `amountDue` tapi tidak ditampilkan. Akun tanpa batas pengeluaran (`spend_cap` 0) tidak
  punya angka sisa: kolomnya `""` (tampil "-"), bukan 0.
- **Currency units**: `balance`/`amount_spent`/`spend_cap`/`daily_budget` dibagi
  `META_MINOR_UNIT`; `insights.spend` sudah dalam satuan utuh dan tidak dibagi. **Default 1**,
  benar untuk IDR — Meta mengirim rupiah penuh (`spend_cap` 1075000 = batas Rp 1.075.000, sudah
  diverifikasi lewat `npm run meta:check` terhadap kartu batas di Ads Manager). Mata uang bersen
  (USD, EUR) perlu `META_MINOR_UNIT=100`. Cara mengecek: kolom `Batas Pengeluaran` harus sama
  persis dengan angka yang diketik di kartu batas Meta.
- **What counts as a "result" (the CPR column)**: Ads Manager's *Hasil* follows each campaign's
  optimization goal, and the API does not send that column. `fetchCampaignSpend` therefore reads
  `actions` and takes the first `action_type` present from `META_RESULT_ACTIONS` (default
  `offsite_conversion.fb_pixel_purchase,purchase,offsite_conversion.fb_pixel_lead,lead,complete_registration,link_click`).
  CPR = attributed spend ÷ those results. If your campaigns optimize for a different event, set
  `META_RESULT_ACTIONS` — otherwise CPR is counting the wrong thing. No recognized action means
  no CPR at all (`-`), never `Rp 0`.

## Balance history (the two "Riwayat Saldo" panels on a user profile)

`adAccounts/{id}` only ever holds the latest numbers — every sync overwrites them — so nothing
recorded what a balance *was*. `syncCampaigns` now also writes the history the profile page reads:

- **`users/{id}/dailySpend`** — one row per day per ad account per campaign, keyed
  `{YYYY-MM-DD}__{adAccountId}__{campaign}`. Re-running the sync on the same day updates the day's
  rows instead of appending duplicates. An account whose spend Meta did not break down by campaign
  gets one row keyed `{YYYY-MM-DD}__{adAccountId}`.
- **`users/{id}/balanceSnapshots`** — one row per ad account per sync, keyed
  `{YYYYMMDDHHmm}__{adAccountId}`, carrying the balance, that day's reduction, and how it moved
  since the previous snapshot.

Both accumulate under `users/{id}`, which every browser subscribes to on load, so the same sync
prunes them: `BALANCE_HISTORY_DAYS` (default 30) for daily spend, `BALANCE_SNAPSHOT_KEEP`
(default 60) snapshots per user. Only keys in the shapes above are pruned — rows entered by hand
or imported look different and are left alone.

These panels are filled **only** by the Meta sync (`npm run sync:meta`, the scheduled run, or **Sync Saldo
& Campaign** on a user profile). *Sync ROI* in the topbar runs `/sync/subdomains`, which writes
`subDomains/*` and `dashboard/roiReports/*` and never touches `users/*`.

## Campaign status and budget

`fetchCampaignSettings` reads the `/campaigns` edge (`name,effective_status,daily_budget`) because
insights carries none of it. Without it the Kampanye table wrote `"Aktif"` for every row regardless
of the truth, and the Anggaran column was never filled.

`daily_budget` only exists on campaigns budgeted at campaign level (CBO). When the budget sits on
the ad sets, Meta has no campaign-level figure to give and the column stays blank — a `0` there
would read as "not budgeted".

## ROI per negara (Profile User → "ROI per Negara")

The only place a country appears in Meta's data is the insights `country` breakdown, so this table
takes one extra call per ad account: `fetchCampaignSpendByCountry` reads
`level=campaign&breakdowns=country&fields=campaign_name,spend`. Meta names countries by ISO code
(`ID`), GAM names them in full (`Indonesia`), so the GAM side is asked for both — see
`GAM_COUNTRY_DIMENSIONS` (default `COUNTRY_CODE,COUNTRY_NAME`), reported alongside the site
dimension because a country on its own says nothing about which subdomain earned it.

Spend reaches a subdomain through the same campaign mapping as subdomain ROI below, and a subdomain
reaches a user through its PIC. The formula is not the one Overview uses — it charges the ad tax the
advertiser actually pays:

```text
Spending       = Meta Spend
Ad Tax         = Spending × tarif         (halaman Settings, default 5%)
Total Spending = Spending + Ad Tax
ROI%           = (Earning − Total Spending) / Total Spending × 100
```

The same formula now backs the subdomain rows in `dashboard/roiReports` — one number cannot be two
ROIs depending on which table you read it in.

Both country reports are non-fatal: an ad account or network that rejects them is reported in the
sync summary and leaves subdomain ROI — whose numbers are already in hand — untouched.

## Test

`cd functions && npm test` — runs `meta.test.mjs` (parsing, minor-unit division, empty insights)
and `sync-core.test.mjs` (history keys, snapshot deltas, pruning, status labels, CPR, ROI per
negara). The UI's copy of the country formula is covered by `npm test` at the repo root
(`src/lib/countryRoi.test.mjs`).

## Campaign → subdomain mapping (what makes ROI work)

Sync ROI can only compute Spending / ROI / Profit for a subdomain it can attribute spend to, and
Meta itself has no idea which site a campaign drives traffic to. The link is the **Keitaro link
code**: every tracking link has a short id (`pBRw`, `TvH1`) and the advertisers put it at the
front of the campaign name — `nPJL-06 Pros Turki Carrou LKM 85 10 Adset` is the `nPJL` link.

Registering that code on the subdomain it points to is what joins the two sides. A subdomain owns
as many codes as it has links, so **one subdomain carries many campaigns** and their spend
accumulates on it rather than replacing it.

The chain, in order:

1. **`/ad-accounts` → User Pemilik** — decides whose profile the account's campaigns land under.
   Required; without it `syncCampaigns` skips the account and reports it as unowned.
2. **`/sub-domains` → Edit → Kode Campaign** — the codes of every link pointing at that
   subdomain, comma-separated. Writable by **admins and advertisers**: the advertisers cut the
   links, and making them wait on an admin is what leaves ROI blank. An advertiser's form shows
   that field alone (`advertiserFields` in the resource config) and saves it alone, because the
   rule grants exactly `subDomains/{id}/campaignCodes` and the audit fields sit under the
   admin-only parent. The column itself is display-only.
3. **Meta sync** (`npm run sync:meta`) — `syncCampaigns` writes each account's
   campaigns into `users/{ownerId}.campaigns[]` and resolves each one's `subDomain` from the
   codes, recording `subDomainSource: "code"` and the matched `campaignCode`.
4. **`/users/:id` → Manajemen Kampanye → Sub Domain** — per-campaign override for a campaign
   whose name does not carry its code. Saved immediately with `subDomainSource: "manual"`, which
   the sync then never re-derives — including a deliberate blank. Options list **every**
   subdomain, not just the user's: a freshly imported subdomain has no PIC yet, and scoping the
   list would make it unmappable until one is set.
5. **Sync ROI** (`/sub-domains`) — attributes spend through the same resolver and fills
   ROI/Profit.

Codes are matched as whole tokens, never as substrings — four characters is short enough that
`TvH1` would otherwise match inside an unrelated word. A code claimed by two subdomains cannot
be right for both, so the first owner keeps it and the clash is reported in the sync summary
instead of a winner being picked silently per run.

Rows for campaigns Meta stops returning are kept rather than dropped: a failed fetch or a
campaign paused for a day must not erase a manual mapping, which no API can recover.

## Not built

- Per-campaign spend, delivery status, ROI joins — out of scope for now.
