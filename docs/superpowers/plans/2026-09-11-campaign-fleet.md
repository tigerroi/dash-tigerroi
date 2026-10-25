# Halaman Campaign (duplikasi + kelola campaign Meta) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Halaman superadmin `/campaigns` yang menduplikasi campaign Meta (deep copy, lahir PAUSED) dan mengubah anggaran harian, nama, serta targeting negara/umur, lewat server kontrol.

**Architecture:** Campuran. Anggaran/nama/targeting ditulis langsung oleh server kontrol (`server/campaign-manage.js`, gerbang `requireSuperAdmin`). Salinan dicatat di RTDB `dashboard/campaignCopyJobs` supaya progresnya terbaca semua superadmin; salinan besar lewat `async_batch_requests` dan dipantau cron semenit. Aturan murni di `functions/campaign-manage-core.js`, I/O Meta di `functions/meta.js`, orkestrasi job di `functions/campaign-copy-jobs.mjs`. Tiap tulisan yang berhasil memasukkan ad account-nya ke antrean sync yang digabung per ~30 detik.

**Tech Stack:** Node ESM (`node --test`), Bun + Elysia (`bun test`), React + Vite, Firebase RTDB, Meta Marketing API v25.0.

**Spec:** [docs/superpowers/specs/2026-09-11-campaign-fleet-design.md](../specs/2026-09-11-campaign-fleet-design.md)

## Global Constraints

- Pesan commit TANPA trailer `Co-Authored-By` (CLAUDE.md, bagian Commit).
- Versi Meta API dipatok `v25.0`.
- Salinan selalu `status_option=PAUSED`, `deep_copy=true`, `rename_strategy=NO_RENAME`; nama campaign salinan diganti lewat panggilan terpisah.
- Batas iklan: ≤3 langsung, 4–51 asinkron, >51 ditolak sebelum menyentuh Meta. Jumlah salinan 1–5.
- Panggilan salin (langsung maupun batch) TIDAK PERNAH diulang otomatis (`retry: false`).
- Job ditulis `requested` SEBELUM Meta dipanggil. `requested` >10 menit atau `running` >60 menit → `unknown`. Job >7 hari dibuang.
- Vonis nama campaign memakai `matchCode` yang sama dengan sync (kode terdaftar PERTAMA di nama).
- Targeting hanya bisa diedit bila `geo_locations` berisi negara saja (`location_types` boleh). Umur 18–65.
- Hanya anggaran HARIAN, di tingkat yang memegangnya (CBO di campaign, ABO di ad set). Lifetime tidak bisa diedit.
- Seluruh fitur superadmin: `SUPERADMIN_PAGES` di UI, `requireSuperAdmin` di server.
- Tanggal dirender lewat `src/lib/formatDate.js`; filter/pilihan di alamat lewat `useUrlState` (`replace`).
- Tidak ada hex di CSS di luar blok token `src/styles.css`.
- Tulisan sungguhan ke Meta produksi dan deploy HANYA setelah pemilik mengonfirmasi di chat.

## Peta berkas

| Berkas | Tanggung jawab | Task |
|---|---|---|
| `functions/tools/meta-copy-probe.mjs` (baru) | Pembuktian bentuk `copies` di batch asinkron | 0 |
| `functions/meta.js` | Versi, opsi `retry`, salin, baca status batch, baca/ubah campaign & ad set | 1, 3, 4 |
| `functions/sync-core.js`, `functions/sync-meta.mjs` | `matchCode` pindah ke sync-core | 2 |
| `functions/campaign-manage-core.js` (baru) | Aturan murni: nama, salinan, akun, job, anggaran, targeting, status HTTP | 5, 6 |
| `functions/campaign-copy-jobs.mjs` (baru) | `startCopyJob`, `pollCopyJobs` | 7 |
| `database.rules.json` | `.validate` node `dashboard/campaignCopyJobs` | 7 |
| `server/campaign-rows.js` (baru) | `campaignRowOf` (dipindah) | 8 |
| `server/campaign-lock.js` (baru) | Penjaga tumpang-tindih bersama | 8 |
| `server/account-sync-queue.js` (baru) | Antrean sync per ad account | 8 |
| `server/campaign-manage.js` (baru) | Route `/fleet/...` | 9 |
| `server/index.js` | Wiring route, cron job salinan, lock, antrean | 10 |
| `src/config/firebasePaths.js`, `src/lib/storeSubscriptions.js`, `src/hooks/useFirebaseStore.js`, `src/lib/controlApi.js` | Langganan node job, klien route baru | 11 |
| `src/lib/campaignRows.js` (baru), `src/components/campaigns/CampaignStatusCell.jsx` (baru), `src/components/UserDetail.jsx` | Baris campaign + sel status dipakai bersama | 12 |
| `src/config/navigation.js`, `src/config/access.js`, `src/routes/resolveRoute.js`, `src/components/layout/DashboardShell.jsx` | Menu, izin, route | 13 |
| `src/lib/campaignFleet.js` (baru), `src/components/campaigns/CampaignDialogs.jsx` (baru), `src/components/CampaignAdSets.jsx`, `src/styles.css` | Aturan tampilan + dialog salin/ubah | 14 |
| `src/components/campaigns/CampaignFleet.jsx` (baru), `src/main.jsx`, `src/styles.css` | Halaman armada | 15 |
| `CLAUDE.md`, `server/README.md` | Dokumentasi, deploy, pembuktian produksi | 16 |

---

### Task 0: Pembuktian `copies` di dalam `async_batch_requests`

Tulisan sungguhan ke Meta produksi. Kode task lain yang bergantung pada bentuk jawaban batch (Task 3, 7) BELUM boleh dikerjakan sebelum task ini selesai.

**Files:**
- Create: `functions/tools/meta-copy-probe.mjs`
- Modify: `docs/superpowers/specs/2026-09-11-campaign-fleet-design.md` (lampiran hasil)

**Interfaces:**
- Consumes: `META_ACCESS_TOKEN` dari `functions/.env.sync`.
- Produces: catatan bentuk jawaban `GET /{request_set_id}/requests` (letak `copied_campaign_id`, ada tidaknya `input.name`), dipakai `readCopyBatch` di Task 3.

- [ ] **Step 1: Tulis script pembuktian**

```js
// Pembuktian satu kali: apakah `POST /{campaign_id}/copies` diterima di dalam
// `POST /act_{id}/async_batch_requests`, dan seperti apa bentuk jawabannya.
//
//   cd functions
//   node --env-file-if-exists=.env.sync tools/meta-copy-probe.mjs act_123 120210000         # baca saja
//   node --env-file-if-exists=.env.sync tools/meta-copy-probe.mjs act_123 120210000 --run   # MENULIS
//   node --env-file-if-exists=.env.sync tools/meta-copy-probe.mjs --cleanup 120219999       # MENULIS
//
// --run membuat SATU salinan PAUSED dari campaign sumber. Jalankan hanya setelah pemilik akun iklan
// menyetujui campaign sumbernya.

const VERSION = "v25.0";
const BASE = `https://graph.facebook.com/${VERSION}`;
const token = process.env.META_ACCESS_TOKEN;
if (!token) {
  console.error("META_ACCESS_TOKEN belum di-set.");
  process.exit(1);
}

async function call(method, path, params = {}) {
  const url = new URL(`${BASE}/${path}`);
  url.searchParams.set("access_token", token);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const res = await fetch(url, { method });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  return { status: res.status, version: res.headers.get("facebook-api-version"), body };
}

const print = (label, value) => console.log(`\n=== ${label} ===\n${JSON.stringify(value, null, 2)}`);
const args = process.argv.slice(2);

if (args[0] === "--cleanup") {
  const id = args[1];
  if (!/^\d+$/.test(id || "")) {
    console.error("ID campaign salinan harus angka.");
    process.exit(1);
  }
  print("hapus salinan", await call("POST", id, { status: "DELETED" }));
  process.exit(0);
}

const [actId, campaignId] = args;
if (!/^act_\d+$/.test(actId || "") || !/^\d+$/.test(campaignId || "")) {
  console.error("Pakai: meta-copy-probe.mjs act_<id> <campaign_id> [--run]");
  process.exit(1);
}

print("campaign sumber", await call("GET", campaignId, { fields: "id,name,status,account_id" }));
const ads = await call("GET", `${campaignId}/ads`, { fields: "id", limit: "100" });
print("jumlah iklan", { status: ads.status, count: ads.body?.data?.length ?? null });

const body = new URLSearchParams({
  deep_copy: "true",
  status_option: "PAUSED",
  rename_options: JSON.stringify({ rename_strategy: "NO_RENAME" }),
}).toString();
const adbatch = [{ name: "copy-0", relative_url: `${campaignId}/copies`, body }];
print("permintaan yang akan dikirim", { path: `${actId}/async_batch_requests`, adbatch });

if (!args.includes("--run")) {
  console.log("\nMode baca saja. Tambahkan --run untuk benar-benar mengirim.");
  process.exit(0);
}

const submit = await call("POST", `${actId}/async_batch_requests`, {
  name: "rabbitroi-copy-probe",
  adbatch: JSON.stringify(adbatch),
});
print("jawaban async_batch_requests", submit);
const setId = submit.body?.id;
if (!setId) process.exit(1);

for (let attempt = 1; attempt <= 30; attempt++) {
  await new Promise((resolve) => setTimeout(resolve, 10_000));
  const set = await call("GET", setId, { fields: "id,name,is_completed,success_count,error_count" });
  print(`status antrean (percobaan ${attempt})`, set);
  if (set.body?.is_completed) {
    print("isi permintaan", await call("GET", `${setId}/requests`, { fields: "id,status,result,input" }));
    process.exit(0);
  }
}
console.error("Belum selesai setelah 5 menit.");
process.exit(1);
```

- [ ] **Step 2: Minta campaign sumber ke pemilik**

Tanyakan di chat: ACT ID dan campaign ID sebuah campaign kecil (≤3 iklan) milik sendiri yang boleh disalin. Jangan menebak.

- [ ] **Step 3: Jalankan mode baca saja**

Run: `cd functions && node --env-file-if-exists=.env.sync tools/meta-copy-probe.mjs act_<id> <campaign_id>`
Expected: nama campaign, `count` iklan, dan permintaan yang akan dikirim tercetak; tidak ada tulisan.

- [ ] **Step 4: Minta konfirmasi eksplisit, lalu jalankan `--run`**

Tampilkan keluaran Step 3 ke pemilik dan tunggu "ya". Lalu:
Run: `cd functions && node --env-file-if-exists=.env.sync tools/meta-copy-probe.mjs act_<id> <campaign_id> --run`
Expected: `jawaban async_batch_requests` berisi `id`, lalu `is_completed: true` dan `isi permintaan`.

- [ ] **Step 5: Putuskan dari hasilnya**

| Yang terlihat | Tindakan |
|---|---|
| `result` (objek atau string JSON) memuat `copied_campaign_id`, dan `input.name` = `copy-0` | Lanjut; Task 3 dipakai apa adanya |
| `copied_campaign_id` ada tapi `input` tidak membawa `name` | Lanjut; `readCopyBatch` jatuh ke urutan indeks (sudah ditangani di Task 3) |
| Batch ditolak, atau `result` berisi error bentuk permintaan | **BERHENTI.** Laporkan ke pemilik; jalur asinkron didesain ulang sebelum Task 3 |

- [ ] **Step 6: Tulis lampiran hasil di spec**

Tambahkan di akhir `docs/superpowers/specs/2026-09-11-campaign-fleet-design.md`:

```markdown
## Lampiran: hasil pembuktian `copies` di batch asinkron

Tanggal: <tanggal run, format "11 Sep 2026">. Campaign sumber: <campaign_id> (<jumlah> iklan).

- Jawaban `async_batch_requests`: <tempel JSON body>
- Satu baris `/{set}/requests`: <tempel JSON satu baris>
- Keputusan: <baris tabel Step 5 yang berlaku>
```

- [ ] **Step 7: Bersihkan salinan uji (dengan konfirmasi pemilik)**

Run: `cd functions && node --env-file-if-exists=.env.sync tools/meta-copy-probe.mjs --cleanup <copied_campaign_id>`
Expected: `{"success": true}`.

- [ ] **Step 8: Commit**

```bash
git add functions/tools/meta-copy-probe.mjs docs/superpowers/specs/2026-09-11-campaign-fleet-design.md
git commit -m "chore(meta): pembuktian salin campaign lewat async_batch_requests"
```

---

### Task 1: Patok versi Meta API ke v25.0

**Files:**
- Modify: `functions/meta.js:6`
- Modify: `functions/tools/meta-check.mjs:9`
- Test: `functions/meta.test.mjs` (tambah di akhir)

**Interfaces:**
- Produces: seluruh URL Graph berawalan `https://graph.facebook.com/v25.0/`.

- [ ] **Step 1: Tulis tes yang gagal** — tambahkan di akhir `functions/meta.test.mjs`:

```js
// Versi dipatok. Tanpa itu Meta menaikkan versi yang kedaluwarsa diam-diam (v21.0 dijawab sebagai
// v26.0 pada 11 Sep 2026), dan perilaku endpoint tulis ikut bergeser tanpa satu baris kode berubah.
let versionUrl = "";
globalThis.fetch = async (url) => {
  versionUrl = String(url);
  return { ok: true, text: async () => JSON.stringify({ data: [] }) };
};
await fetchCampaignAds("120257050704180339", "tok");
assert.match(versionUrl, /^https:\/\/graph\.facebook\.com\/v25\.0\//, "versi API dipatok v25.0");

console.log("meta version test ok");
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `cd functions && node --test meta.test.mjs`
Expected: FAIL, `versi API dipatok v25.0`.

- [ ] **Step 3: Ubah versi**

`functions/meta.js` baris 6 dan `functions/tools/meta-check.mjs` baris 9:

```js
const VERSION = process.env.META_API_VERSION || "v25.0";
```

- [ ] **Step 4: Jalankan, pastikan lolos**

Run: `cd functions && node --test meta.test.mjs meta-throttle.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/meta.js functions/tools/meta-check.mjs functions/meta.test.mjs
git commit -m "fix(meta): patok versi Graph API ke v25.0"
```

---

### Task 2: `matchCode` pindah ke `sync-core.js`

**Files:**
- Modify: `functions/sync-core.js` (sesudah `buildCodeIndex`, dan `buildCampaignResolver` memakainya)
- Modify: `functions/sync-meta.mjs:6-35` (import) dan `:607-619` (hapus fungsi lokal)
- Test: `functions/sync-core.test.mjs` (sesudah blok `buildCodeIndex`, sekitar baris 372)

**Interfaces:**
- Produces: `matchCode(campaignName: string, byCode: Map<string,string>) => { subDomain: string, code: string }` — `code` adalah kode yang cocok, atau token pertama nama kalau tidak ada yang cocok.

- [ ] **Step 1: Tulis tes yang gagal**

Tambahkan `matchCode,` ke daftar import di atas `functions/sync-core.test.mjs` (urut abjad), lalu sesudah assertion `clash.conflicts`:

```js
// Kode terdaftar PERTAMA di nama yang menang — aturan yang sama dipakai sync DAN vonis nama di
// halaman Campaign, supaya dialog tidak menyetujui nama yang oleh sync dipetakan ke subdomain lain.
assert.deepEqual(matchCode("TvH1-14 Pros MEA 5rx7", index.byCode), {
  subDomain: "puppy.petcins.com",
  code: "tvh1",
});
assert.deepEqual(
  matchCode("nPJL-06 Pros Turki", index.byCode),
  { subDomain: "", code: "npjl" },
  "tanpa kode terdaftar, token pertama tetap disebut supaya pesannya bisa menunjuk kodenya",
);
assert.deepEqual(matchCode("", index.byCode), { subDomain: "", code: "" });
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `cd functions && node --test sync-core.test.mjs`
Expected: FAIL, `matchCode` bukan export.

- [ ] **Step 3: Pindahkan fungsinya**

Di `functions/sync-core.js`, tepat sesudah `buildCodeIndex`:

```js
/**
 * Kode terdaftar PERTAMA di nama campaign, dan subdomain pemiliknya.
 *
 * Token dibaca urut nama, jadi campaign yang membuka namanya dengan kode ("nPJL-06 Pros Turki …")
 * cocok pada token pertama. Kalau tidak ada yang cocok, token pertama tetap dikembalikan: menurut
 * konvensi itulah kodenya, dan menyebutnya mengubah "belum dipetakan" jadi "kode nPJL belum
 * terdaftar" — kalimat yang menyebut apa yang harus diperbaiki.
 *
 * Dipakai sync DAN vonis nama di halaman Campaign; dua aturan berbeda berarti dialog menyetujui
 * nama yang oleh sync dipetakan ke subdomain lain.
 */
export function matchCode(campaignName, byCode) {
  const tokens = parseCampaignCodes(campaignName);
  for (const token of tokens) {
    const subDomain = byCode.get(token);
    if (subDomain) return { subDomain, code: token };
  }
  return { subDomain: "", code: tokens[0] || "" };
}
```

Di `buildCampaignResolver`, ganti loop token di dalam `resolve` dengan:

```js
    const { subDomain, code } = matchCode(campaignName, byCode);
    return subDomain ? { subDomain, source: "code", code } : { subDomain: "", source: "", code: "" };
```

Di `functions/sync-meta.mjs`: hapus fungsi `matchCode` lokal berikut komentarnya (baris 607–619), tambahkan `matchCode,` ke import dari `./sync-core.js` (sesudah `latestSnapshotFor,`), dan hapus `parseCampaignCodes,` dari import itu (satu-satunya pemakainya adalah fungsi yang dihapus).

- [ ] **Step 4: Jalankan, pastikan lolos**

Run: `cd functions && npm test`
Expected: PASS seluruhnya (termasuk tes resolver lama).

- [ ] **Step 5: Commit**

```bash
git add functions/sync-core.js functions/sync-meta.mjs functions/sync-core.test.mjs
git commit -m "refactor(sync): matchCode pindah ke sync-core supaya dipakai bersama"
```

### Task 3: `meta.js` — salin campaign tanpa percobaan ulang

**Files:**
- Modify: `functions/meta.js` (`request`, `graphPost`, tambah fungsi baru sesudah `explainWriteFailure`)
- Test: `functions/meta.test.mjs`, `functions/meta-throttle.test.mjs`

**Interfaces:**
- Consumes: hasil Task 0 (bentuk baris `/requests`).
- Produces:
  - `copyCampaign(campaignId, token) => Promise<{ campaignId: string }>`
  - `submitCopyBatch(actId, token, { campaignId, count, name }) => Promise<{ requestSetId: string }>`
  - `readCopyBatch(requestSetId, token) => Promise<{ completed: boolean, requests: Array<{ name: string, status: string, campaignId: string, error: string }> }>`

- [ ] **Step 1: Tulis tes yang gagal**

Tambahkan `copyCampaign, readCopyBatch, submitCopyBatch,` ke destructuring import di atas `functions/meta.test.mjs`, lalu di akhir berkas:

```js
// --- Salin campaign ------------------------------------------------------------------------
let copyCall = "";
globalThis.fetch = async (url, options) => {
  copyCall = `${options?.method || "GET"} ${url}`;
  return { ok: true, text: async () => JSON.stringify({ copied_campaign_id: "120299", ad_object_ids: [] }) };
};
assert.deepEqual(await copyCampaign("120210", "tok"), { campaignId: "120299" });
assert.match(copyCall, /^POST .*\/120210\/copies\?/);
assert.match(copyCall, /deep_copy=true/);
assert.match(copyCall, /status_option=PAUSED/, "salinan selalu lahir mati");
assert.match(copyCall, /NO_RENAME/, "nama diganti lewat panggilan terpisah");

globalThis.fetch = async () => ({ ok: true, text: async () => JSON.stringify({}) });
await assert.rejects(() => copyCampaign("120210", "tok"), /tidak mengembalikan ID campaign salinan/);
await assert.rejects(() => copyCampaign("", "tok"), /kosong/);

let batchUrl;
globalThis.fetch = async (url, options) => {
  batchUrl = new URL(String(url));
  assert.equal(options?.method, "POST");
  return { ok: true, text: async () => JSON.stringify({ id: "6001" }) };
};
assert.deepEqual(
  await submitCopyBatch("1", "tok", { campaignId: "120210", count: 2, name: "rabbitroi-copy-j1" }),
  { requestSetId: "6001" },
);
assert.match(batchUrl.pathname, /\/act_1\/async_batch_requests$/);
const adbatch = JSON.parse(batchUrl.searchParams.get("adbatch"));
assert.deepEqual(adbatch.map((item) => item.name), ["copy-0", "copy-1"]);
assert.equal(adbatch[0].relative_url, "120210/copies");
assert.match(adbatch[0].body, /deep_copy=true/);
assert.match(adbatch[0].body, /status_option=PAUSED/);

globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes("/6001/requests")) {
    return {
      ok: true,
      text: async () => JSON.stringify({
        data: [
          { id: "r1", status: "SUCCESS", input: { name: "copy-0" }, result: JSON.stringify({ copied_campaign_id: "120301" }) },
          { id: "r2", status: "ERROR", input: { name: "copy-1" }, result: { error: { message: "Too many ads" } } },
        ],
      }),
    };
  }
  return { ok: true, text: async () => JSON.stringify({ id: "6001", is_completed: true }) };
};
assert.deepEqual(await readCopyBatch("6001", "tok"), {
  completed: true,
  requests: [
    { name: "copy-0", status: "success", campaignId: "120301", error: "" },
    { name: "copy-1", status: "error", campaignId: "", error: "Too many ads" },
  ],
});

console.log("meta copy tests ok");
```

Di `functions/meta-throttle.test.mjs`, tambahkan `copyCampaign, setCampaignStatus` ke destructuring import, lalu sebelum `console.log` terakhir:

```js
// Salinan TIDAK diulang walau kodenya sementara: kode 2 bisa datang sesudah Meta sempat membuat
// salinannya, dan mengulangnya berarti campaign kembar.
calls = 0;
globalThis.fetch = async () => {
  calls++;
  return fail({ message: "Service temporarily unavailable", code: 2 });
};
await assert.rejects(() => copyCampaign("120210", "tok"), /\(#2\)/);
assert.equal(calls, 1, "salin campaign tidak pernah diulang");

// Tulisan yang aman diulang tetap diulang.
calls = 0;
await assert.rejects(() => setCampaignStatus("120210", "tok", "PAUSED"), /\(#2\)/);
assert.equal(calls, 3, "saklar campaign tetap 1 percobaan + 2 retry");
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `cd functions && node --test meta.test.mjs meta-throttle.test.mjs`
Expected: FAIL, `copyCampaign` bukan export.

- [ ] **Step 3: Implementasi**

Di `functions/meta.js`, ganti tanda tangan dan baris retry di `request`:

```js
async function request(url, path, init, { retry = true } = {}) {
  for (let attempt = 0; ; attempt++) {
    const { res, data } = await schedule(async () => {
      const res = await fetch(url, init);
      observeUsage(res);
      return { res, data: await parseGraphBody(res) };
    });
    if (res.ok && !data.error) return data;

    // Tulisan yang tidak aman diulang (salin campaign) mematikan percobaan ulang: kode 1/2 bisa
    // datang SESUDAH Meta sempat membuat salinannya, dan mengulangnya menghasilkan campaign kembar.
    const wait = retry ? retryDelay(data.error, attempt) : null;
    if (wait === null) {
      throw new Error(`Meta ${path} -> ${describeGraphError(data.error, res.status)}`);
    }
    await sleep(wait);
  }
}
```

Ganti `graphPost`:

```js
async function graphPost(path, token, params = {}, options = {}) {
  return request(graphUrl(path, token, params), path, { method: "POST" }, options);
}
```

Tambahkan sesudah `explainWriteFailure`:

```js
// --- Salin campaign ------------------------------------------------------------------------
//
// Salinan selalu deep copy (ad set + iklan ikut), lahir PAUSED, dan TANPA ganti nama: `copies`
// cuma bisa menambah awalan/akhiran, dan awalan mendorong kode Keitaro keluar dari posisi pertama.
// Nama campaign salinannya diganti lewat `updateCampaign` sesudahnya.
//
// Tidak satu pun panggilan di bagian ini diulang otomatis (`retry: false`).
const COPY_PARAMS = {
  deep_copy: "true",
  status_option: "PAUSED",
  rename_options: JSON.stringify({ rename_strategy: "NO_RENAME" }),
};

export async function copyCampaign(campaignId, token) {
  const id = String(campaignId || "").trim();
  if (!id) throw new Error("ID campaign kosong.");
  let data;
  try {
    data = await graphPost(`${id}/copies`, token, COPY_PARAMS, { retry: false });
  } catch (error) {
    throw new Error(explainWriteFailure(error.message));
  }
  const copied = String(data?.copied_campaign_id || "");
  if (!copied) throw new Error("Meta tidak mengembalikan ID campaign salinan.");
  return { campaignId: copied };
}

// Satu permintaan `copies` per salinan di dalam SATU batch asinkron — jalur untuk campaign 4–51
// iklan. Nama tiap permintaan `copy-{indeks}` supaya hasilnya bisa dipasangkan kembali.
export async function submitCopyBatch(actId, token, { campaignId, count, name }) {
  const body = new URLSearchParams(COPY_PARAMS).toString();
  const adbatch = Array.from({ length: count }, (_, index) => ({
    name: `copy-${index}`,
    relative_url: `${campaignId}/copies`,
    body,
  }));
  let data;
  try {
    data = await graphPost(
      `${normalizeActId(actId)}/async_batch_requests`,
      token,
      { name, adbatch: JSON.stringify(adbatch) },
      { retry: false },
    );
  } catch (error) {
    throw new Error(explainWriteFailure(error.message));
  }
  const requestSetId = String(data?.id || "");
  if (!requestSetId) throw new Error("Meta tidak mengembalikan ID antrean salinan.");
  return { requestSetId };
}

export async function readCopyBatch(requestSetId, token) {
  const id = String(requestSetId || "").trim();
  if (!id) throw new Error("ID antrean salinan kosong.");
  const set = await graph(id, token, { fields: "id,is_completed,success_count,error_count" });
  const rows = await graphAll(`${id}/requests`, token, {
    fields: "id,status,result,input",
    limit: "100",
  });
  return {
    completed: Boolean(set?.is_completed),
    requests: rows.map((row) => {
      const result = parseBatchResult(row?.result);
      return {
        name: String(row?.input?.name || ""),
        status: String(row?.status || "").toLowerCase(),
        campaignId: String(result?.copied_campaign_id || ""),
        error: result?.copied_campaign_id ? "" : batchErrorMessage(result),
      };
    }),
  };
}

// `result` datang sebagai objek atau sebagai string JSON, tergantung permintaannya.
function parseBatchResult(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return { message: String(value) };
  }
}

function batchErrorMessage(result) {
  const error = result?.error || result;
  return String(error?.error_user_msg || error?.message || "");
}
```

- [ ] **Step 4: Jalankan, pastikan lolos**

Run: `cd functions && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/meta.js functions/meta.test.mjs functions/meta-throttle.test.mjs
git commit -m "feat(meta): salin campaign langsung dan lewat batch asinkron, tanpa retry"
```

---

### Task 4: `meta.js` — baca dan ubah campaign/ad set untuk form edit

**Files:**
- Modify: `functions/meta.js` (sesudah `batchErrorMessage`)
- Test: `functions/meta.test.mjs`

**Interfaces:**
- Produces:
  - `fetchCampaignForEdit(campaignId, token) => Promise<{ id, name, status, dailyBudget: number|null, lifetimeBudget: number|null, accountId }>`
  - `updateCampaign(campaignId, token, { name?, dailyBudget? }) => Promise<{ id }>`
  - `fetchAdSetForEdit(adSetId, token) => Promise<{ id, name, campaignId, status, dailyBudget: number|null, lifetimeBudget: number|null, targeting: object|null }>`
  - `updateAdSet(adSetId, token, { name?, dailyBudget?, targeting? }) => Promise<{ id }>`
  - Anggaran masuk/keluar dalam satuan UTUH; konversi `META_MINOR_UNIT` di dalam fungsi.

- [ ] **Step 1: Tulis tes yang gagal**

Tambahkan `fetchAdSetForEdit, fetchCampaignForEdit, updateAdSet, updateCampaign,` ke import `functions/meta.test.mjs` (berkas ini memakai `META_MINOR_UNIT=100`), lalu di akhir:

```js
// --- Form edit ---------------------------------------------------------------------------
globalThis.fetch = async (url) => {
  assert.match(String(url), /fields=id%2Cname%2Cstatus%2Cdaily_budget%2Clifetime_budget%2Caccount_id/);
  return {
    ok: true,
    text: async () => JSON.stringify({
      id: "120210", name: "TvH1-06", status: "ACTIVE", daily_budget: "5000000", lifetime_budget: "0", account_id: "123",
    }),
  };
};
assert.deepEqual(await fetchCampaignForEdit("120210", "tok"), {
  id: "120210",
  name: "TvH1-06",
  status: "ACTIVE",
  dailyBudget: 50000,
  // "0" dari Meta berarti "bukan jenis anggaran ini", bukan dianggarkan nol rupiah.
  lifetimeBudget: null,
  accountId: "123",
});

let editCall = "";
globalThis.fetch = async (url, options) => {
  editCall = `${options?.method || "GET"} ${url}`;
  return { ok: true, text: async () => JSON.stringify({ success: true }) };
};
assert.deepEqual(await updateCampaign("120210", "tok", { name: "TvH1-07", dailyBudget: 75000 }), { id: "120210" });
assert.match(editCall, /^POST .*\/120210\?/);
assert.match(editCall, /name=TvH1-07/);
assert.match(editCall, /daily_budget=7500000/, "satuan utuh dikali META_MINOR_UNIT");
await assert.rejects(() => updateCampaign("120210", "tok", {}), /Tidak ada yang diubah/);

globalThis.fetch = async () => ({
  ok: true,
  text: async () => JSON.stringify({
    id: "555", name: "Adset 1", campaign_id: "120210", status: "ACTIVE", daily_budget: "10000",
    targeting: { age_min: 18, geo_locations: { countries: ["TR"] }, flexible_spec: [{ interests: [{ id: "1" }] }] },
  }),
});
const editAdSet = await fetchAdSetForEdit("555", "tok");
assert.equal(editAdSet.campaignId, "120210");
assert.equal(editAdSet.dailyBudget, 100);
assert.equal(editAdSet.lifetimeBudget, null);
assert.deepEqual(editAdSet.targeting.flexible_spec, [{ interests: [{ id: "1" }] }], "targeting utuh, bukan sepotong");

let adSetUrl;
globalThis.fetch = async (url) => {
  adSetUrl = new URL(String(url));
  return { ok: true, text: async () => JSON.stringify({ success: true }) };
};
await updateAdSet("555", "tok", { targeting: { geo_locations: { countries: ["MX"] }, age_min: 21 } });
assert.deepEqual(JSON.parse(adSetUrl.searchParams.get("targeting")), {
  geo_locations: { countries: ["MX"] },
  age_min: 21,
});

console.log("meta edit tests ok");
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `cd functions && node --test meta.test.mjs`
Expected: FAIL, `fetchCampaignForEdit` bukan export.

- [ ] **Step 3: Implementasi** — tambahkan di `functions/meta.js`:

```js
// --- Baca dan ubah untuk form edit ---------------------------------------------------------

// Meta mengirim "0" untuk jenis anggaran yang tidak dipakai; nol di sini berarti "bukan jenis
// anggaran ini", bukan dianggarkan nol rupiah.
function budgetOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const major = toMajor(value);
  return major > 0 ? major : null;
}

function toMinor(major) {
  return Math.round(Number(major) * MINOR);
}

export async function fetchCampaignForEdit(campaignId, token) {
  const id = String(campaignId || "").trim();
  if (!id) throw new Error("ID campaign kosong.");
  const row = await graph(id, token, {
    fields: "id,name,status,daily_budget,lifetime_budget,account_id",
  });
  return {
    id: String(row?.id || id),
    name: row?.name || "",
    status: row?.status || "",
    dailyBudget: budgetOrNull(row?.daily_budget),
    lifetimeBudget: budgetOrNull(row?.lifetime_budget),
    accountId: String(row?.account_id || ""),
  };
}

export async function updateCampaign(campaignId, token, { name, dailyBudget } = {}) {
  const id = String(campaignId || "").trim();
  if (!id) throw new Error("ID campaign kosong.");
  const params = {};
  if (name !== undefined) params.name = String(name);
  if (dailyBudget !== undefined) params.daily_budget = String(toMinor(dailyBudget));
  if (!Object.keys(params).length) throw new Error("Tidak ada yang diubah.");
  try {
    await graphPost(id, token, params);
  } catch (error) {
    throw new Error(explainWriteFailure(error.message));
  }
  return { id };
}

// `targeting` diminta UTUH — yang menulisnya kembali harus mengirim seluruh isinya, dan potongan
// yang tidak diminta akan hilang dari ad set pada tulisan berikutnya.
export async function fetchAdSetForEdit(adSetId, token) {
  const id = String(adSetId || "").trim();
  if (!id) throw new Error("ID ad set kosong.");
  const row = await graph(id, token, {
    fields: "id,name,campaign_id,status,daily_budget,lifetime_budget,targeting",
  });
  return {
    id: String(row?.id || id),
    name: row?.name || "",
    campaignId: String(row?.campaign_id || ""),
    status: row?.status || "",
    dailyBudget: budgetOrNull(row?.daily_budget),
    lifetimeBudget: budgetOrNull(row?.lifetime_budget),
    targeting: row?.targeting && typeof row.targeting === "object" ? row.targeting : null,
  };
}

export async function updateAdSet(adSetId, token, { name, dailyBudget, targeting } = {}) {
  const id = String(adSetId || "").trim();
  if (!id) throw new Error("ID ad set kosong.");
  const params = {};
  if (name !== undefined) params.name = String(name);
  if (dailyBudget !== undefined) params.daily_budget = String(toMinor(dailyBudget));
  if (targeting !== undefined) params.targeting = JSON.stringify(targeting);
  if (!Object.keys(params).length) throw new Error("Tidak ada yang diubah.");
  try {
    await graphPost(id, token, params);
  } catch (error) {
    throw new Error(explainWriteFailure(error.message));
  }
  return { id };
}
```

- [ ] **Step 4: Jalankan, pastikan lolos**

Run: `cd functions && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/meta.js functions/meta.test.mjs
git commit -m "feat(meta): baca dan ubah nama, anggaran, targeting campaign dan ad set"
```

---

### Task 5: `campaign-manage-core.js` — nama, salinan, akun, job

**Files:**
- Create: `functions/campaign-manage-core.js`
- Test: `functions/campaign-manage-core.test.mjs`

**Interfaces:**
- Consumes: `matchCode`, `normalizeName`, `accountKeys`, `campaignRowBelongsTo` dari `./sync-core.js`.
- Produces:
  - `class RuleError extends Error` (`status = 422`)
  - `class ConfirmRequired extends Error` (`status = 409`, `needsConfirm = true`, `subDomain`)
  - `MAX_COPIES = 5`, `DIRECT_COPY_MAX_ADS = 3`, `ASYNC_COPY_MAX_ADS = 51`
  - `copyMode(adCount) => "direct" | "async"` (melempar `RuleError` di atas 51)
  - `copyNames(name, count) => string[]`
  - `campaignNameVerdict(row, name, byCode) => { subDomain, code, needsConfirm }` (melempar `RuleError`)
  - `assertConfirmed(verdict, confirmSubDomain)` (melempar `ConfirmRequired`)
  - `accountOfCampaignRow(accounts, row) => ({ id, ...account }) | null`
  - `COPY_JOBS_PATH = "dashboard/campaignCopyJobs"`, `COPY_JOB_STATES`
  - `newCopyJobId(now?, random?) => string` (bentuk `/^j[0-9a-z]{5,20}$/`)
  - `copyJobEntry({ source, userId, account, names, mode, requestedBy, now }) => object`
  - `activeCopyJob(jobs, campaignId) => jobId | ""`
  - `copyOutcome(copies) => { state: "done"|"partial"|"failed", error }`
  - `stalledJobPatch(job, now) => object | null`
  - `expiredCopyJobIds(jobs, now) => string[]`

- [ ] **Step 1: Tulis tes yang gagal** — `functions/campaign-manage-core.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import {
  accountOfCampaignRow,
  activeCopyJob,
  assertConfirmed,
  ConfirmRequired,
  campaignNameVerdict,
  copyJobEntry,
  copyMode,
  copyNames,
  copyOutcome,
  expiredCopyJobIds,
  newCopyJobId,
  RuleError,
  stalledJobPatch,
} from "./campaign-manage-core.js";
import { buildCodeIndex } from "./sync-core.js";

const { byCode } = buildCodeIndex({
  a: { name: "puppy.petcins.com", campaignCodes: "TvH1" },
  b: { name: "dog.petcins.com", campaignCodes: "5rx7" },
});

test("nama tanpa kode terdaftar ditolak — belanjanya tidak akan masuk ROI siapa pun", () => {
  assert.throws(() => campaignNameVerdict({}, "nPJL-06 Pros Turki", byCode), RuleError);
  assert.throws(() => campaignNameVerdict({}, "nPJL-06 Pros Turki", byCode), /npjl.*belum terdaftar/);
});

test("campaign terpetakan lewat kode tidak boleh diberi kode subdomain lain", () => {
  const row = { subDomain: "puppy.petcins.com", subDomainSource: "code" };
  assert.throws(() => campaignNameVerdict(row, "5rx7-01 Pros", byCode), /milik dog\.petcins\.com/);
  assert.deepEqual(campaignNameVerdict(row, "TvH1-07 Pros", byCode), {
    subDomain: "puppy.petcins.com",
    code: "tvh1",
    needsConfirm: false,
  });
});

test("campaign belum terpetakan atau manual boleh kode mana pun, dengan konfirmasi", () => {
  for (const row of [{}, { subDomain: "lama.petcins.com", subDomainSource: "manual" }]) {
    const verdict = campaignNameVerdict(row, "5rx7-01 Pros", byCode);
    assert.equal(verdict.subDomain, "dog.petcins.com");
    assert.equal(verdict.needsConfirm, true);
  }
});

test("konfirmasi harus menyebut subdomain yang sama dengan vonis server", () => {
  const verdict = { subDomain: "dog.petcins.com", code: "5rx7", needsConfirm: true };
  assert.throws(() => assertConfirmed(verdict, ""), ConfirmRequired);
  assert.throws(() => assertConfirmed(verdict, "puppy.petcins.com"), ConfirmRequired);
  assert.doesNotThrow(() => assertConfirmed(verdict, " DOG.petcins.com "));
  assert.doesNotThrow(() => assertConfirmed({ ...verdict, needsConfirm: false }, ""));
  try {
    assertConfirmed(verdict, "");
  } catch (error) {
    assert.equal(error.status, 409);
    assert.equal(error.subDomain, "dog.petcins.com");
  }
});

test("mode salin dari jumlah iklan: ≤3 langsung, ≤51 asinkron, lebih dari itu ditolak", () => {
  assert.equal(copyMode(0), "direct");
  assert.equal(copyMode(3), "direct");
  assert.equal(copyMode(4), "async");
  assert.equal(copyMode(51), "async");
  assert.throws(() => copyMode(52), /52 iklan/);
});

test("nama salinan: satu apa adanya, lebih dari satu diberi akhiran", () => {
  assert.deepEqual(copyNames(" TvH1-07 A ", 1), ["TvH1-07 A"]);
  assert.deepEqual(copyNames("TvH1-07 A", 3), ["TvH1-07 A #1", "TvH1-07 A #2", "TvH1-07 A #3"]);
  assert.throws(() => copyNames("TvH1-07 A", 6), /1 sampai 5/);
  assert.throws(() => copyNames("TvH1-07 A", 0), /1 sampai 5/);
  assert.throws(() => copyNames("  ", 1), /wajib diisi/);
});

test("ad account sebuah baris campaign dicari lewat kunci yang sama dengan sync", () => {
  const accounts = {
    k1: { actId: "act_1", name: "TBZ 1247" },
    k2: { actId: "act_2", name: "Lincah", deletedAt: "2026-08-01" },
  };
  assert.equal(accountOfCampaignRow(accounts, { adAccount: "act_1" }).id, "k1");
  assert.equal(accountOfCampaignRow(accounts, { account: "tbz 1247" }).id, "k1");
  assert.equal(accountOfCampaignRow(accounts, { adAccount: "act_2" }), null, "akun terhapus");
  // Baris tanpa identitas akun tidak boleh dicocokkan ke akun pertama yang kebetulan ada.
  assert.equal(accountOfCampaignRow(accounts, {}), null);
});

test("id job berbentuk yang diterima aturan database", () => {
  assert.equal(newCopyJobId(new Date(0), () => 0), "j00000");
  assert.match(newCopyJobId(), /^j[0-9a-z]{5,20}$/);
});

test("entri job lahir requested, berikut seluruh identitasnya", () => {
  const now = new Date("2026-09-11T08:00:00Z");
  assert.deepEqual(
    copyJobEntry({
      source: { campaignId: "120210", campaign: "TvH1-06" },
      userId: "u_nur",
      account: { id: "k1", actId: "act_1" },
      names: ["TvH1-07 #1", "TvH1-07 #2"],
      mode: "direct",
      requestedBy: "super@r.live",
      now,
    }),
    {
      sourceCampaignId: "120210",
      sourceName: "TvH1-06",
      userId: "u_nur",
      accountId: "k1",
      actId: "act_1",
      count: 2,
      names: ["TvH1-07 #1", "TvH1-07 #2"],
      mode: "direct",
      state: "requested",
      requestedBy: "super@r.live",
      requestedAt: "2026-09-11T08:00:00.000Z",
      updatedAt: "2026-09-11T08:00:00.000Z",
    },
  );
});

test("job aktif untuk campaign yang sama terdeteksi, yang selesai tidak", () => {
  const jobs = {
    a: { sourceCampaignId: "1", state: "done" },
    b: { sourceCampaignId: "1", state: "running" },
    c: { sourceCampaignId: "2", state: "requested" },
  };
  assert.equal(activeCopyJob(jobs, "1"), "b");
  assert.equal(activeCopyJob(jobs, "2"), "c");
  assert.equal(activeCopyJob(jobs, "3"), "");
  assert.equal(activeCopyJob(null, "1"), "");
});

test("hasil job dari salinan yang lahir", () => {
  assert.deepEqual(copyOutcome([{ campaignId: "9" }, { campaignId: "8" }]), { state: "done", error: "" });
  assert.deepEqual(copyOutcome([{ campaignId: "9" }, { campaignId: "", error: "Too many ads" }]), {
    state: "partial",
    error: "Too many ads",
  });
  assert.equal(copyOutcome([{ campaignId: "", error: "" }]).state, "failed");
  assert.equal(copyOutcome([{ campaignId: "", error: "" }]).error, "Meta tidak membuat salinan.");
});

test("job yang menggantung jadi unknown, bukan failed", () => {
  const at = "2026-09-11T08:00:00.000Z";
  const later = (minutes) => new Date(Date.parse(at) + minutes * 60_000);
  assert.equal(stalledJobPatch({ state: "requested", requestedAt: at }, later(11)).state, "unknown");
  assert.equal(stalledJobPatch({ state: "requested", requestedAt: at }, later(9)), null);
  assert.equal(stalledJobPatch({ state: "running", requestedAt: at, submittedAt: at }, later(61)).state, "unknown");
  assert.equal(stalledJobPatch({ state: "running", requestedAt: at, submittedAt: at }, later(30)), null);
  assert.equal(stalledJobPatch({ state: "done", requestedAt: at }, later(600)), null);
  assert.match(stalledJobPatch({ state: "requested", requestedAt: at }, later(11)).error, /Ads Manager/);
});

test("job selesai lebih dari 7 hari dibuang; yang masih berjalan tidak", () => {
  const old = "2026-09-01T00:00:00.000Z";
  const now = new Date("2026-09-11T00:00:00Z");
  const jobs = {
    done: { state: "done", requestedAt: old },
    unknown: { state: "unknown", requestedAt: old },
    running: { state: "running", requestedAt: old },
    fresh: { state: "failed", requestedAt: "2026-09-10T00:00:00.000Z" },
  };
  assert.deepEqual(expiredCopyJobIds(jobs, now).sort(), ["done", "unknown"]);
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `cd functions && node --test campaign-manage-core.test.mjs`
Expected: FAIL, modul tidak ditemukan.

- [ ] **Step 3: Implementasi** — `functions/campaign-manage-core.js`:

```js
import { accountKeys, campaignRowBelongsTo, matchCode, normalizeName } from "./sync-core.js";

/**
 * Aturan halaman Campaign (/campaigns): duplikasi dan edit campaign Meta.
 *
 * Murni — tidak ada jaringan dan tidak ada RTDB di sini. I/O Meta tinggal di meta.js, orkestrasi
 * job di campaign-copy-jobs.mjs, route di server/campaign-manage.js. Keputusan yang tinggal di
 * dalam pemanggil API tidak bisa diuji tanpa menghubungi Meta.
 */

// Ditolak ATURAN kita, sebelum menyentuh Meta.
export class RuleError extends Error {
  constructor(message) {
    super(message);
    this.status = 422;
  }
}

// Nama yang memetakan belanja ke subdomain yang belum pernah dilihat orangnya di layar.
export class ConfirmRequired extends Error {
  constructor(subDomain) {
    super(`Nama ini memetakan belanjanya ke ${subDomain}. Konfirmasi dulu sebelum menyimpan.`);
    this.status = 409;
    this.needsConfirm = true;
    this.subDomain = subDomain;
  }
}

export const MAX_COPIES = 5;
export const DIRECT_COPY_MAX_ADS = 3;
export const ASYNC_COPY_MAX_ADS = 51;

export function copyMode(adCount) {
  const count = Number(adCount);
  if (!Number.isInteger(count) || count < 0) {
    throw new RuleError("Jumlah iklan campaign sumber tidak terbaca.");
  }
  if (count <= DIRECT_COPY_MAX_ADS) return "direct";
  if (count <= ASYNC_COPY_MAX_ADS) return "async";
  throw new RuleError(
    `Campaign ini memuat ${count} iklan; Meta hanya bisa menyalin paling banyak ${ASYNC_COPY_MAX_ADS} iklan sekali salin.`,
  );
}

export function copyNames(name, count) {
  const base = String(name || "").trim();
  if (!base) throw new RuleError("Nama salinan wajib diisi.");
  if (base.length > 400) throw new RuleError("Nama salinan terlalu panjang (maks 400 karakter).");
  const total = Number(count);
  if (!Number.isInteger(total) || total < 1 || total > MAX_COPIES) {
    throw new RuleError(`Jumlah salinan 1 sampai ${MAX_COPIES}.`);
  }
  return total === 1 ? [base] : Array.from({ length: total }, (_, index) => `${base} #${index + 1}`);
}

/**
 * Boleh-tidaknya sebuah nama campaign, dari kode Keitaro di dalamnya.
 *
 * Nama itulah pemetaannya: `matchCode` yang sama dengan sync memutuskan subdomain mana yang
 * menerima belanjanya. Link iklan TIDAK ikut berubah (creative tidak bisa diubah link-nya), jadi
 * campaign yang sudah terpetakan lewat kode tidak boleh diberi kode subdomain lain.
 */
export function campaignNameVerdict(row, name, byCode) {
  const { subDomain, code } = matchCode(name, byCode);
  if (!subDomain) {
    throw new RuleError(
      code
        ? `Kode "${code}" di nama belum terdaftar di subdomain mana pun — belanjanya tidak akan masuk ROI siapa pun.`
        : "Nama campaign tidak membawa kode Keitaro yang terdaftar — belanjanya tidak akan masuk ROI siapa pun.",
    );
  }
  const mapped = row?.subDomainSource === "code" ? normalizeName(row?.subDomain) : "";
  if (mapped && normalizeName(subDomain) !== mapped) {
    throw new RuleError(
      `Kode ${code} milik ${subDomain}, sedangkan iklan campaign ini mengarah ke ${row.subDomain}. Link iklan tidak ikut berubah, jadi belanjanya akan tercatat di subdomain yang salah.`,
    );
  }
  return { subDomain, code, needsConfirm: !mapped };
}

export function assertConfirmed(verdict, confirmSubDomain) {
  if (verdict.needsConfirm && normalizeName(confirmSubDomain) !== normalizeName(verdict.subDomain)) {
    throw new ConfirmRequired(verdict.subDomain);
  }
}

// Ad account pemilik sebuah baris campaign, lewat kunci yang sama dengan sync. Baris tanpa identitas
// akun sama sekali tidak dicocokkan: `campaignRowBelongsTo` meloloskannya, dan di sini itu berarti
// akun PERTAMA yang kebetulan ada.
export function accountOfCampaignRow(accounts, row) {
  if (!row?.adAccount && !row?.account && !row?.actName) return null;
  for (const [id, account] of Object.entries(accounts || {})) {
    if (!account || account.deletedAt || !account.actId) continue;
    if (campaignRowBelongsTo(row, new Set(accountKeys(account)))) return { id, ...account };
  }
  return null;
}

// --- Job salinan -----------------------------------------------------------------------------

export const COPY_JOBS_PATH = "dashboard/campaignCopyJobs";
export const COPY_JOB_STATES = ["requested", "running", "done", "partial", "failed", "unknown"];
const REQUESTED_TIMEOUT_MS = 10 * 60_000;
const RUNNING_TIMEOUT_MS = 60 * 60_000;
const COPY_JOB_KEEP_MS = 7 * 86_400_000;
const ACTIVE = new Set(["requested", "running"]);

// Berawalan huruf, sepola `c57` di antrean gating: RTDB membaca kunci angka berurutan sebagai array.
export function newCopyJobId(now = new Date(), random = Math.random) {
  const suffix = Math.floor(random() * 36 ** 4)
    .toString(36)
    .padStart(4, "0");
  return `j${now.getTime().toString(36)}${suffix}`;
}

export function copyJobEntry({ source, userId, account, names, mode, requestedBy, now = new Date() }) {
  const at = now.toISOString();
  return {
    sourceCampaignId: String(source.campaignId),
    sourceName: String(source.campaign || ""),
    userId: String(userId),
    accountId: String(account.id),
    actId: String(account.actId || ""),
    count: names.length,
    names,
    mode,
    state: "requested",
    requestedBy: String(requestedBy || ""),
    requestedAt: at,
    updatedAt: at,
  };
}

export function activeCopyJob(jobs, campaignId) {
  const found = Object.entries(jobs || {}).find(
    ([, job]) => String(job?.sourceCampaignId) === String(campaignId) && ACTIVE.has(job?.state),
  );
  return found ? found[0] : "";
}

export function copyOutcome(copies) {
  const born = copies.filter((copy) => copy?.campaignId).length;
  const state = born === copies.length ? "done" : born > 0 ? "partial" : "failed";
  if (state === "done") return { state, error: "" };
  const error = copies.find((copy) => copy?.error)?.error || "Meta tidak membuat salinan.";
  return { state, error };
}

/**
 * Job yang menggantung → `unknown`, BUKAN `failed`.
 *
 * Server tidak tahu apakah salinannya sudah lahir: proses yang mati sesudah Meta menjawab tetapi
 * sebelum hasilnya ditulis meninggalkan job `requested`. Menyebutnya gagal membuat orang menyalin
 * lagi — dan salinan yang sudah lahir tidak bisa ditarik kembali.
 */
export function stalledJobPatch(job, now = new Date()) {
  const since = job?.state === "running" ? job.submittedAt || job.requestedAt : job?.requestedAt;
  const age = now.getTime() - Date.parse(since || "");
  const limit = job?.state === "requested" ? REQUESTED_TIMEOUT_MS : job?.state === "running" ? RUNNING_TIMEOUT_MS : null;
  if (limit === null || !(age > limit)) return null;
  const at = now.toISOString();
  return {
    state: "unknown",
    error: "Server tidak tahu apakah salinannya sudah lahir — periksa Ads Manager sebelum menyalin lagi.",
    updatedAt: at,
    finishedAt: at,
  };
}

// Yang masih berjalan tidak dibuang: ia harus lebih dulu jadi `unknown` lewat `stalledJobPatch`.
export function expiredCopyJobIds(jobs, now = new Date()) {
  return Object.entries(jobs || {})
    .filter(([, job]) => !ACTIVE.has(job?.state))
    .filter(([, job]) => now.getTime() - Date.parse(job?.requestedAt || "") > COPY_JOB_KEEP_MS)
    .map(([id]) => id);
}
```

- [ ] **Step 4: Jalankan, pastikan lolos**

Run: `cd functions && node --test campaign-manage-core.test.mjs`
Expected: PASS.

- [ ] **Step 5: Lint dan commit**

Run: `npx biome check --write functions/campaign-manage-core.js functions/campaign-manage-core.test.mjs`

```bash
git add functions/campaign-manage-core.js functions/campaign-manage-core.test.mjs
git commit -m "feat(campaign): aturan nama, salinan, dan job untuk halaman Campaign"
```

---

### Task 6: `campaign-manage-core.js` — anggaran, targeting, status HTTP penolakan Meta

**Files:**
- Modify: `functions/campaign-manage-core.js` (tambah di akhir)
- Test: `functions/campaign-manage-core.test.mjs` (tambah di akhir)

**Interfaces:**
- Produces:
  - `budgetState(level: "campaign"|"adset", item) => { editable: boolean, reason: string }`
  - `parseBudget(value) => number` (melempar `RuleError`)
  - `targetingState(targeting) => { editable, reason, countries: string[], ageMin: number|null, ageMax: number|null }`
  - `normalizeCountries(list) => string[]` (melempar `RuleError`)
  - `mergeTargeting(targeting, { countries?, ageMin?, ageMax? }) => object` (salinan baru; melempar `RuleError`)
  - `metaFailureStatus(message) => 422 | 502`

- [ ] **Step 1: Tulis tes yang gagal**

Tambahkan `budgetState, mergeTargeting, metaFailureStatus, normalizeCountries, parseBudget, targetingState,` ke import di atas berkas tes, lalu di akhir:

```js
test("anggaran hanya bisa diubah di tingkat yang memegangnya", () => {
  assert.deepEqual(budgetState("campaign", { dailyBudget: 50000, lifetimeBudget: null }), {
    editable: true,
    reason: "",
  });
  assert.match(budgetState("campaign", { dailyBudget: null }).reason, /dipegang ad set/);
  assert.match(budgetState("adset", { dailyBudget: null }).reason, /dipegang campaign/);
  assert.match(budgetState("adset", { dailyBudget: null, lifetimeBudget: 900000 }).reason, /lifetime/);
  assert.equal(budgetState("adset", { dailyBudget: null, lifetimeBudget: 900000 }).editable, false);
});

test("anggaran harus angka lebih dari nol — kosong bukan nol", () => {
  assert.equal(parseBudget("75000"), 75000);
  assert.equal(parseBudget(75000), 75000);
  for (const bad of ["", null, undefined, "0", -5, "abc"]) {
    assert.throws(() => parseBudget(bad), RuleError);
  }
});

const TARGETING = {
  age_min: 18,
  age_max: 65,
  geo_locations: { countries: ["tr"], location_types: ["home", "recent"] },
  flexible_spec: [{ interests: [{ id: "6003", name: "Travel" }] }],
  publisher_platforms: ["facebook", "instagram"],
};

test("targeting negara-saja bisa diedit; wilayah/kota tidak", () => {
  assert.deepEqual(targetingState(TARGETING), {
    editable: true,
    reason: "",
    countries: ["TR"],
    ageMin: 18,
    ageMax: 65,
  });
  const cities = { ...TARGETING, geo_locations: { countries: ["TR"], cities: [{ key: "1" }] } };
  assert.equal(targetingState(cities).editable, false);
  assert.match(targetingState(cities).reason, /cities/);
  // Array kosong bukan lokasi.
  const emptyRegions = { ...TARGETING, geo_locations: { countries: ["TR"], regions: [] } };
  assert.equal(targetingState(emptyRegions).editable, true);
  assert.equal(targetingState(null).editable, false);
  assert.equal(targetingState({ geo_locations: {} }).editable, false);
});

test("penggabungan targeting mengganti negara/umur saja, sisanya utuh", () => {
  const next = mergeTargeting(TARGETING, { countries: ["mx", " cl ", "MX"], ageMin: 25 });
  assert.deepEqual(next.geo_locations, { countries: ["MX", "CL"], location_types: ["home", "recent"] });
  assert.equal(next.age_min, 25);
  assert.equal(next.age_max, 65);
  assert.deepEqual(next.flexible_spec, TARGETING.flexible_spec);
  assert.deepEqual(next.publisher_platforms, TARGETING.publisher_platforms);
  assert.deepEqual(TARGETING.geo_locations.countries, ["tr"], "yang asli tidak diubah");

  assert.throws(() => mergeTargeting(TARGETING, { ageMin: 40, ageMax: 30 }), /tidak boleh lebih besar/);
  assert.throws(() => mergeTargeting(TARGETING, { ageMin: 17 }), /18 sampai 65/);
  assert.throws(() => mergeTargeting(TARGETING, { countries: ["TUR"] }), /dua huruf/);
  assert.throws(() => mergeTargeting(TARGETING, { countries: [] }), /minimal satu negara/);
  const cities = { ...TARGETING, geo_locations: { countries: ["TR"], cities: [{ key: "1" }] } };
  assert.throws(() => mergeTargeting(cities, { ageMin: 21 }), /Ads Manager/);
});

test("normalizeCountries menerima teks berkoma", () => {
  assert.deepEqual(normalizeCountries("tr, mx  id"), ["TR", "MX", "ID"]);
});

test("penolakan isian oleh Meta jadi 422, sisanya 502", () => {
  assert.equal(metaFailureStatus("Meta 120210 -> Invalid parameter — Budget too low (#100-1885272)"), 422);
  assert.equal(metaFailureStatus("Meta 120210 -> Invalid parameter (#100)"), 422);
  // #100-33 adalah izin yang kurang, bukan isian yang salah.
  assert.equal(metaFailureStatus("Meta 120210 -> Unsupported post request. (#100-33) — token Meta ini"), 502);
  assert.equal(metaFailureStatus("Meta 120210 -> Invalid OAuth access token (#190)"), 502);
  assert.equal(metaFailureStatus("fetch failed"), 502);
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `cd functions && node --test campaign-manage-core.test.mjs`
Expected: FAIL, `budgetState` bukan export.

- [ ] **Step 3: Implementasi** — tambahkan di akhir `functions/campaign-manage-core.js`:

```js
// --- Anggaran --------------------------------------------------------------------------------

// Hanya anggaran HARIAN, di tingkat yang memegangnya. Tingkat yang salah tidak diberi kotak isian:
// Meta menolaknya, dan penolakan untuk kotak yang tidak seharusnya ada tidak menerangkan apa pun.
export function budgetState(level, item) {
  if (item?.lifetimeBudget) {
    return { editable: false, reason: "Memakai anggaran seumur hidup (lifetime) — ubah di Ads Manager." };
  }
  if (item?.dailyBudget === null || item?.dailyBudget === undefined) {
    return {
      editable: false,
      reason: level === "campaign" ? "Anggaran dipegang ad set (ABO)." : "Anggaran dipegang campaign (CBO).",
    };
  }
  return { editable: true, reason: "" };
}

export function parseBudget(value) {
  const amount = Number(value);
  if (value === "" || value === null || value === undefined || !Number.isFinite(amount) || amount <= 0) {
    throw new RuleError("Anggaran harian harus angka lebih dari nol.");
  }
  return amount;
}

// --- Targeting -------------------------------------------------------------------------------

const GEO_EDITABLE_KEYS = new Set(["countries", "location_types"]);

function hasValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return Boolean(value);
}

function upperList(value) {
  return (Array.isArray(value) ? value : [])
    .map((code) => String(code || "").trim().toUpperCase())
    .filter(Boolean);
}

/**
 * Bisa-tidaknya negara dan umur sebuah ad set diubah dari sini.
 *
 * Hanya kalau lokasinya NEGARA SAJA. Ad set yang juga menargetkan wilayah, kota, atau radius
 * menyimpan lokasi yang terikat ke negaranya — mengganti negaranya berisiko bentrok dengan kota
 * yang tersisa, dan yang membetulkannya adalah Ads Manager, bukan kotak isian di sini.
 */
export function targetingState(targeting) {
  if (!targeting || typeof targeting !== "object") {
    return { editable: false, reason: "Targeting ad set ini tidak terbaca.", countries: [], ageMin: null, ageMax: null };
  }
  const geo = targeting.geo_locations || {};
  const base = {
    countries: upperList(geo.countries),
    ageMin: Number(targeting.age_min) || null,
    ageMax: Number(targeting.age_max) || null,
  };
  const other = Object.keys(geo).filter((key) => !GEO_EDITABLE_KEYS.has(key) && hasValue(geo[key]));
  if (other.length) {
    return { ...base, editable: false, reason: `Lokasi memakai ${other.join(", ")} — ubah di Ads Manager.` };
  }
  if (!base.countries.length) {
    return { ...base, editable: false, reason: "Ad set ini tidak menargetkan negara — ubah di Ads Manager." };
  }
  return { ...base, editable: true, reason: "" };
}

export function normalizeCountries(list) {
  const items = (Array.isArray(list) ? list : String(list || "").split(/[\s,]+/))
    .map((code) => String(code || "").trim().toUpperCase())
    .filter(Boolean);
  const invalid = items.filter((code) => !/^[A-Z]{2}$/.test(code));
  if (invalid.length) throw new RuleError(`Kode negara harus dua huruf ISO: ${invalid.join(", ")}.`);
  const unique = [...new Set(items)];
  if (!unique.length) throw new RuleError("Pilih minimal satu negara.");
  return unique;
}

function parseAge(value, label) {
  const age = Number(value);
  if (!Number.isInteger(age) || age < 18 || age > 65) throw new RuleError(`${label} harus 18 sampai 65.`);
  return age;
}

// Targeting BARU dari yang lama: cuma negara dan umur yang diganti, sisanya dikirim utuh. Aman untuk
// Meta yang mengganti seluruh targeting maupun yang menambal.
export function mergeTargeting(targeting, { countries, ageMin, ageMax } = {}) {
  const state = targetingState(targeting);
  if (!state.editable) throw new RuleError(state.reason);
  const next = structuredClone(targeting);
  if (countries !== undefined) {
    next.geo_locations = { ...next.geo_locations, countries: normalizeCountries(countries) };
  }
  const min = ageMin !== undefined ? parseAge(ageMin, "Umur minimum") : Number(next.age_min) || 18;
  const max = ageMax !== undefined ? parseAge(ageMax, "Umur maksimum") : Number(next.age_max) || 65;
  if (min > max) throw new RuleError("Umur minimum tidak boleh lebih besar dari umur maksimum.");
  if (ageMin !== undefined) next.age_min = min;
  if (ageMax !== undefined) next.age_max = max;
  return next;
}

/**
 * Penolakan Meta: salah isian (422) atau salah di sisi kita/Meta (502).
 *
 * Kode 100 adalah parameter yang ditolak — anggaran di bawah minimum, umur tidak sah — kecuali
 * subkode 33, yang di jawaban tulis berarti izin token yang kurang. Token, izin, dan Meta yang
 * tumbang tidak bisa diperbaiki siapa pun di dialog itu, jadi tidak boleh menyamar sebagai
 * kesalahan pengisian.
 */
export function metaFailureStatus(message) {
  const match = /\(#(\d+)(?:-(\d+))?\)/.exec(String(message || ""));
  if (!match) return 502;
  return match[1] === "100" && match[2] !== "33" ? 422 : 502;
}
```

- [ ] **Step 4: Jalankan, pastikan lolos**

Run: `cd functions && node --test campaign-manage-core.test.mjs`
Expected: PASS.

- [ ] **Step 5: Lint dan commit**

Run: `npx biome check --write functions/campaign-manage-core.js functions/campaign-manage-core.test.mjs`

```bash
git add functions/campaign-manage-core.js functions/campaign-manage-core.test.mjs
git commit -m "feat(campaign): aturan anggaran harian dan targeting negara/umur"
```

---

### Task 7: Orkestrasi job salinan + aturan database

**Files:**
- Create: `functions/campaign-copy-jobs.mjs`
- Modify: `database.rules.json` (di dalam `dashboard`, sesudah blok `telegramInbox`)
- Test: `functions/campaign-copy-jobs.test.mjs`

**Interfaces:**
- Consumes: Task 3 (`copyCampaign`, `submitCopyBatch`, `readCopyBatch`), Task 4 (`updateCampaign`), `fetchCampaignAds`, Task 5 (job helpers).
- Produces:
  - `class JobConflict extends Error` (`status = 409`)
  - `startCopyJob(store, token, { userId, row, account, names, requestedBy, enqueueSync?, now? }) => Promise<{ jobId, state, mode, copies, error }>` — `store` berbentuk `{ read(path), update(path, values) }`; `account` berbentuk `{ id, actId }`.
  - `pollCopyJobs(store, token, { now?, enqueueSync? }) => Promise<{ checked: number, changed: number }>`

- [ ] **Step 1: Tulis tes yang gagal** — `functions/campaign-copy-jobs.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// meta.js membaca jedanya saat diimpor.
process.env.META_MIN_INTERVAL_MS = "0";
const { JobConflict, pollCopyJobs, startCopyJob } = await import("./campaign-copy-jobs.mjs");
const { COPY_JOBS_PATH, RuleError } = await import("./campaign-manage-core.js");

function fakeStore(data = {}) {
  const state = structuredClone(data);
  const at = (path) => path.split("/").reduce((node, key) => node?.[key], state);
  return {
    state,
    read: async (path) => structuredClone(at(path) ?? null),
    update: async (path, values) => {
      for (const [key, value] of Object.entries(values)) {
        const parts = `${path}/${key}`.split("/");
        const last = parts.pop();
        let node = state;
        for (const part of parts) node = node[part] ??= {};
        if (value === null) delete node[last];
        else node[last] = structuredClone(value);
      }
    },
  };
}

const reply = (body, ok = true) => ({ ok, status: ok ? 200 : 400, text: async () => JSON.stringify(body) });

function metaStub({ adCount = 2, copyFails = false, onCopy = () => {} } = {}) {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    const u = new URL(String(url));
    const method = options?.method || "GET";
    calls.push(`${method} ${u.pathname}`);
    if (method === "GET" && u.pathname.endsWith("/120210/ads")) {
      return reply({
        data: Array.from({ length: adCount }, (_, i) => ({ id: `ad${i}`, adset_id: "s1", status: "ACTIVE" })),
      });
    }
    if (method === "POST" && u.pathname.endsWith("/120210/copies")) {
      onCopy();
      return copyFails
        ? reply({ error: { message: "Invalid parameter", code: 100 } }, false)
        : reply({ copied_campaign_id: "900" });
    }
    if (method === "POST" && u.pathname.endsWith("/async_batch_requests")) return reply({ id: "6001" });
    if (method === "POST") return reply({ success: true });
    throw new Error(`panggilan tak terduga: ${method} ${u.pathname}`);
  };
  return calls;
}

const ROW = { campaignId: "120210", campaign: "TvH1-06 Pros" };
const ACCOUNT = { id: "k1", actId: "act_1" };
const jobsOf = (store) => store.state.dashboard?.campaignCopyJobs || {};

test("salin langsung: job ditulis dulu, salinan diberi nama, akun masuk antrean sync", async () => {
  const store = fakeStore();
  let stateAtCopy = "";
  const calls = metaStub({ onCopy: () => (stateAtCopy = Object.values(jobsOf(store))[0]?.state) });
  const synced = [];
  const result = await startCopyJob(store, "tok", {
    userId: "u_nur",
    row: ROW,
    account: ACCOUNT,
    names: ["TvH1-07 Pros"],
    requestedBy: "super@r.live",
    enqueueSync: (id) => synced.push(id),
  });
  assert.equal(stateAtCopy, "requested", "job sudah tercatat sebelum Meta menyalin");
  assert.equal(result.state, "done");
  assert.equal(result.mode, "direct");
  assert.deepEqual(result.copies, [{ name: "TvH1-07 Pros", campaignId: "900", renameError: "" }]);
  assert.ok(calls.some((call) => call === "POST /v25.0/900"), "nama salinan diganti");
  assert.deepEqual(synced, ["k1"]);
  const job = jobsOf(store)[result.jobId];
  assert.equal(job.state, "done");
  assert.ok(job.finishedAt);
});

test("job yang masih berjalan untuk sumber yang sama menolak salinan kedua tanpa menyentuh Meta", async () => {
  const store = fakeStore({
    dashboard: { campaignCopyJobs: { jold: { sourceCampaignId: "120210", state: "running" } } },
  });
  const calls = metaStub();
  await assert.rejects(
    () => startCopyJob(store, "tok", { userId: "u", row: ROW, account: ACCOUNT, names: ["A"] }),
    JobConflict,
  );
  assert.equal(calls.length, 0);
});

test("lebih dari 51 iklan ditolak dan tidak ada job yang ditulis", async () => {
  const store = fakeStore();
  metaStub({ adCount: 52 });
  await assert.rejects(
    () => startCopyJob(store, "tok", { userId: "u", row: ROW, account: ACCOUNT, names: ["A"] }),
    RuleError,
  );
  assert.deepEqual(jobsOf(store), {});
});

test("4–51 iklan dikirim ke batch asinkron dan job berstatus running", async () => {
  const store = fakeStore();
  const calls = metaStub({ adCount: 5 });
  const result = await startCopyJob(store, "tok", {
    userId: "u",
    row: ROW,
    account: ACCOUNT,
    names: ["A #1", "A #2"],
  });
  assert.equal(result.state, "running");
  assert.equal(result.mode, "async");
  assert.ok(!calls.some((call) => call.endsWith("/copies")), "tidak ada salinan langsung");
  const job = jobsOf(store)[result.jobId];
  assert.equal(job.requestSetId, "6001");
  assert.ok(job.submittedAt);
});

test("salinan langsung yang ditolak Meta: job failed berikut sebabnya, tanpa sync", async () => {
  const store = fakeStore();
  metaStub({ copyFails: true });
  const synced = [];
  const result = await startCopyJob(store, "tok", {
    userId: "u",
    row: ROW,
    account: ACCOUNT,
    names: ["A #1", "A #2"],
    enqueueSync: (id) => synced.push(id),
  });
  assert.equal(result.state, "failed");
  assert.match(result.error, /Invalid parameter/);
  assert.equal(result.copies[1].error, "Tidak dicoba karena salinan sebelumnya gagal.");
  assert.deepEqual(synced, []);
});

test("poll: batch selesai sebagian → partial, salinan yang lahir diberi nama", async () => {
  const now = new Date("2026-09-11T08:10:00Z");
  const store = fakeStore({
    dashboard: {
      campaignCopyJobs: {
        jrun: {
          sourceCampaignId: "120210",
          accountId: "k1",
          names: ["A #1", "A #2"],
          mode: "async",
          state: "running",
          requestSetId: "6001",
          requestedAt: "2026-09-11T08:00:00.000Z",
          submittedAt: "2026-09-11T08:00:05.000Z",
        },
      },
    },
  });
  const renamed = [];
  globalThis.fetch = async (url, options) => {
    const u = new URL(String(url));
    if (options?.method === "POST") {
      renamed.push(`${u.pathname} ${u.searchParams.get("name")}`);
      return reply({ success: true });
    }
    if (u.pathname.endsWith("/6001/requests")) {
      return reply({
        data: [
          { id: "r1", status: "SUCCESS", input: { name: "copy-0" }, result: { copied_campaign_id: "901" } },
          { id: "r2", status: "ERROR", input: { name: "copy-1" }, result: { error: { message: "Too many ads" } } },
        ],
      });
    }
    return reply({ id: "6001", is_completed: true });
  };
  const synced = [];
  const res = await pollCopyJobs(store, "tok", { now, enqueueSync: (id) => synced.push(id) });
  assert.equal(res.checked, 1);
  const job = jobsOf(store).jrun;
  assert.equal(job.state, "partial");
  assert.equal(job.copies[0].campaignId, "901");
  assert.equal(job.copies[1].error, "Too many ads");
  assert.deepEqual(renamed, ["/v25.0/901 A #1"]);
  assert.deepEqual(synced, ["k1"]);
});

test("poll: batch yang tidak kunjung selesai jadi unknown; job lama dibuang", async () => {
  const now = new Date("2026-09-11T10:00:00Z");
  const store = fakeStore({
    dashboard: {
      campaignCopyJobs: {
        jslow: { state: "running", requestSetId: "7001", names: ["A"], requestedAt: "2026-09-11T08:00:00.000Z", submittedAt: "2026-09-11T08:00:00.000Z" },
        jold: { state: "done", requestedAt: "2026-09-01T00:00:00.000Z" },
      },
    },
  });
  globalThis.fetch = async () => reply({ id: "7001", is_completed: false });
  await pollCopyJobs(store, "tok", { now });
  assert.equal(jobsOf(store).jslow.state, "unknown");
  assert.equal(jobsOf(store).jold, undefined);
});

test("setiap field job yang ditulis disebut aturan database", async () => {
  const { rules } = JSON.parse(await readFile(new URL("../database.rules.json", import.meta.url), "utf8"));
  const jobRule = rules.dashboard.campaignCopyJobs.$jobId;
  assert.match(jobRule[".validate"], /j\[0-9a-z\]\{5,20\}/);

  const store = fakeStore();
  metaStub({ adCount: 5 });
  const running = await startCopyJob(store, "tok", { userId: "u", row: ROW, account: ACCOUNT, names: ["A"] });
  metaStub();
  await store.update(COPY_JOBS_PATH, { [running.jobId]: null });
  const direct = await startCopyJob(store, "tok", { userId: "u", row: ROW, account: ACCOUNT, names: ["A"] });
  const keys = new Set([
    ...Object.keys({ requestSetId: "", submittedAt: "", error: "", finishedAt: "" }),
    ...Object.keys(jobsOf(store)[direct.jobId]),
  ]);
  for (const key of keys) assert.ok(jobRule[key], `${key} tidak disebut aturan database`);
  for (const key of ["name", "campaignId", "renameError", "error"]) {
    assert.ok(jobRule.copies.$i[key], `copies/${key} tidak disebut aturan database`);
  }
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `cd functions && node --test campaign-copy-jobs.test.mjs`
Expected: FAIL, modul tidak ditemukan.

- [ ] **Step 3: Implementasi** — `functions/campaign-copy-jobs.mjs`:

```js
import {
  activeCopyJob,
  COPY_JOBS_PATH,
  copyJobEntry,
  copyMode,
  copyOutcome,
  expiredCopyJobIds,
  newCopyJobId,
  stalledJobPatch,
} from "./campaign-manage-core.js";
import { copyCampaign, fetchCampaignAds, readCopyBatch, submitCopyBatch, updateCampaign } from "./meta.js";

/**
 * Job salinan campaign — dimulai route server, diselesaikan cron semenit.
 *
 * Job ditulis `requested` SEBELUM Meta dipanggil: proses yang mati di tengah meninggalkan jejak,
 * bukan salinan tanpa catatan. Tidak ada satu pun salinan yang diulang otomatis — salinan yang
 * sudah lahir tidak bisa ditarik kembali, dan mengulangnya berarti campaign kembar.
 */

export class JobConflict extends Error {
  constructor() {
    super("Salinan campaign ini masih berjalan — tunggu sampai selesai sebelum menyalin lagi.");
    this.status = 409;
  }
}

// Pesan Meta bisa panjang; aturan database membatasi 1000 karakter.
const clip = (text) => String(text || "").slice(0, 1000);

async function renameCopy(campaignId, token, name) {
  try {
    await updateCampaign(campaignId, token, { name });
    return { renameError: "" };
  } catch (error) {
    // Ganti nama yang gagal tidak menggagalkan job: salinannya sudah lahir, dan namanya bisa
    // dibetulkan lewat fitur edit.
    return { renameError: clip(error.message) };
  }
}

export async function startCopyJob(
  store,
  token,
  { userId, row, account, names, requestedBy = "", enqueueSync = () => {}, now = new Date() },
) {
  const jobs = (await store.read(COPY_JOBS_PATH)) || {};
  if (activeCopyJob(jobs, row.campaignId)) throw new JobConflict();

  const ads = await fetchCampaignAds(row.campaignId, token);
  const mode = copyMode(ads.length);
  const jobId = newCopyJobId(now);
  await store.update(COPY_JOBS_PATH, {
    [jobId]: copyJobEntry({ source: row, userId, account, names, mode, requestedBy, now }),
  });
  const jobPath = `${COPY_JOBS_PATH}/${jobId}`;

  if (mode === "async") {
    try {
      const { requestSetId } = await submitCopyBatch(account.actId, token, {
        campaignId: row.campaignId,
        count: names.length,
        name: `rabbitroi-copy-${jobId}`,
      });
      const at = new Date().toISOString();
      await store.update(jobPath, { state: "running", requestSetId, submittedAt: at, updatedAt: at });
      return { jobId, state: "running", mode, copies: [], error: "" };
    } catch (error) {
      const at = new Date().toISOString();
      await store.update(jobPath, { state: "failed", error: clip(error.message), updatedAt: at, finishedAt: at });
      return { jobId, state: "failed", mode, copies: [], error: error.message };
    }
  }

  const copies = [];
  for (const name of names) {
    // Sesudah satu salinan ditolak, sisanya tidak dicoba: penolakan yang sama akan berulang, dan
    // yang kebetulan lolos menghasilkan salinan yang tidak diharapkan siapa pun.
    if (copies.some((copy) => !copy.campaignId)) {
      copies.push({ name, campaignId: "", error: "Tidak dicoba karena salinan sebelumnya gagal." });
      continue;
    }
    try {
      const { campaignId } = await copyCampaign(row.campaignId, token);
      copies.push({ name, campaignId, ...(await renameCopy(campaignId, token, name)) });
    } catch (error) {
      copies.push({ name, campaignId: "", error: clip(error.message) });
    }
  }
  const outcome = copyOutcome(copies);
  const at = new Date().toISOString();
  await store.update(jobPath, {
    state: outcome.state,
    copies,
    error: clip(outcome.error),
    updatedAt: at,
    finishedAt: at,
  });
  if (outcome.state !== "failed") enqueueSync(account.id);
  return { jobId, state: outcome.state, mode, copies, error: outcome.error };
}

function listOf(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : Object.values(value);
}

// Permintaan batch untuk salinan ke-`index`: lewat nama `copy-{index}`, atau urutan kalau Meta tidak
// mengembalikan nama sama sekali (lihat lampiran pembuktian di spec).
function requestFor(requests, index) {
  const named = requests.find((request) => request.name === `copy-${index}`);
  if (named) return named;
  return requests.every((request) => !request.name) ? requests[index] : null;
}

export async function pollCopyJobs(store, token, { now = new Date(), enqueueSync = () => {} } = {}) {
  const jobs = (await store.read(COPY_JOBS_PATH)) || {};
  const updates = {};
  let checked = 0;

  for (const [jobId, job] of Object.entries(jobs)) {
    if (job?.state === "running" && job.requestSetId) {
      checked++;
      let batch = null;
      try {
        batch = await readCopyBatch(job.requestSetId, token);
      } catch {
        // Bacaan status yang gagal tidak mengubah apa pun; siklus berikutnya mencoba lagi.
      }
      if (!batch?.completed) {
        const stalled = stalledJobPatch(job, now);
        if (stalled) updates[jobId] = { ...job, ...stalled };
        continue;
      }
      const copies = [];
      for (const [index, name] of listOf(job.names).entries()) {
        const request = requestFor(batch.requests, index);
        if (!request?.campaignId) {
          copies.push({ name, campaignId: "", error: clip(request?.error || "Meta tidak membuat salinan ini.") });
          continue;
        }
        copies.push({ name, campaignId: request.campaignId, ...(await renameCopy(request.campaignId, token, name)) });
      }
      const outcome = copyOutcome(copies);
      const at = now.toISOString();
      updates[jobId] = { ...job, state: outcome.state, copies, error: clip(outcome.error), updatedAt: at, finishedAt: at };
      if (outcome.state !== "failed" && job.accountId) enqueueSync(job.accountId);
      continue;
    }
    if (job?.state === "requested") {
      const stalled = stalledJobPatch(job, now);
      if (stalled) updates[jobId] = { ...job, ...stalled };
    }
  }

  for (const jobId of expiredCopyJobIds(jobs, now)) updates[jobId] = null;
  if (Object.keys(updates).length) await store.update(COPY_JOBS_PATH, updates);
  return { checked, changed: Object.keys(updates).length };
}
```

- [ ] **Step 4: Tambahkan aturan database**

Di `database.rules.json`, di dalam `"dashboard"`, sesudah blok `"telegramInbox": {...}` (beri koma sesudah kurung tutupnya):

```json
      "campaignCopyJobs": {
        "$jobId": {
          ".validate": "!newData.exists() || (newData.hasChildren(['sourceCampaignId', 'state', 'requestedAt']) && $jobId.matches(/^j[0-9a-z]{5,20}$/))",
          "sourceCampaignId": { ".validate": "newData.isString() && newData.val().matches(/^[0-9]{1,30}$/)" },
          "sourceName": { ".validate": "newData.isString() && newData.val().length <= 400" },
          "userId": { ".validate": "newData.isString() && newData.val().length <= 128" },
          "accountId": { ".validate": "newData.isString() && newData.val().length <= 128" },
          "actId": { ".validate": "newData.isString() && newData.val().length <= 64" },
          "count": { ".validate": "newData.isNumber() && newData.val() >= 1 && newData.val() <= 5" },
          "names": { "$i": { ".validate": "newData.isString() && newData.val().length <= 420" } },
          "mode": { ".validate": "newData.val() === 'direct' || newData.val() === 'async'" },
          "state": { ".validate": "newData.isString() && newData.val().matches(/^(requested|running|done|partial|failed|unknown)$/)" },
          "requestSetId": { ".validate": "newData.isString() && newData.val().length <= 64" },
          "copies": {
            "$i": {
              "name": { ".validate": "newData.isString() && newData.val().length <= 420" },
              "campaignId": { ".validate": "newData.isString() && newData.val().length <= 30" },
              "renameError": { ".validate": "newData.isString() && newData.val().length <= 1000" },
              "error": { ".validate": "newData.isString() && newData.val().length <= 1000" },
              "$other": { ".validate": false }
            }
          },
          "error": { ".validate": "newData.isString() && newData.val().length <= 1000" },
          "requestedBy": { ".validate": "newData.isString() && newData.val().length <= 200" },
          "requestedAt": { ".validate": "newData.isString() && newData.val().length <= 40" },
          "submittedAt": { ".validate": "newData.isString() && newData.val().length <= 40" },
          "updatedAt": { ".validate": "newData.isString() && newData.val().length <= 40" },
          "finishedAt": { ".validate": "newData.isString() && newData.val().length <= 40" },
          "$other": { ".validate": false }
        }
      }
```

- [ ] **Step 5: Jalankan, pastikan lolos**

Run: `cd functions && npm test`
Expected: PASS. Pastikan JSON sah: `node -e "JSON.parse(require('fs').readFileSync('../database.rules.json','utf8'))"` tanpa error.

- [ ] **Step 6: Lint dan commit**

Run: `npx biome check --write functions/campaign-copy-jobs.mjs functions/campaign-copy-jobs.test.mjs`

```bash
git add functions/campaign-copy-jobs.mjs functions/campaign-copy-jobs.test.mjs database.rules.json
git commit -m "feat(campaign): job salinan campaign berikut aturan database-nya"
```

---

### Task 8: Server — `campaignRowOf` bersama, penjaga tumpang-tindih, antrean sync

**Files:**
- Create: `server/campaign-rows.js`
- Modify: `server/campaigns.js` (hapus `campaignRowOf` lokal, baris 286–303; import dari berkas baru; buang `campaignEntries` dari import `../functions/sync-core.js`)
- Create: `server/campaign-lock.js`, `server/account-sync-queue.js`
- Test: `server/campaign-lock.test.mjs`, `server/account-sync-queue.test.mjs`

**Interfaces:**
- Produces:
  - `campaignRowOf(store, userId, campaignId) => Promise<{ user?, row?, notFound? }>` (perilaku persis sama dengan yang lama)
  - `createLock() => { run(task) => Promise, tryRun(task) => Promise | null, isBusy() => boolean }`
  - `createAccountSyncQueue({ run, lock, delayMs?, log?, setTimer? }) => { enqueue(accountId), flush() => Promise<{ ids }>, size() }`

- [ ] **Step 1: Tulis tes yang gagal**

`server/campaign-lock.test.mjs`:

```js
import { describe, expect, it } from "bun:test";
import { createLock } from "./campaign-lock.js";

describe("createLock", () => {
  it("tugas berjalan berurutan, tidak pernah bersamaan", async () => {
    const lock = createLock();
    let inside = 0;
    let peak = 0;
    const task = async () => {
      inside++;
      peak = Math.max(peak, inside);
      await Bun.sleep(5);
      inside--;
    };
    await Promise.all([lock.run(task), lock.run(task), lock.run(task)]);
    expect(peak).toBe(1);
  });

  it("tryRun menyerah saat sibuk, dan jalan lagi sesudahnya", async () => {
    const lock = createLock();
    let release;
    const busy = lock.run(() => new Promise((resolve) => (release = resolve)));
    await Bun.sleep(0);
    expect(lock.isBusy()).toBe(true);
    expect(lock.tryRun(async () => 1)).toBe(null);
    release();
    await busy;
    expect(await lock.tryRun(async () => 2)).toBe(2);
  });

  it("tugas yang melempar tidak mengunci selamanya", async () => {
    const lock = createLock();
    await expect(lock.run(async () => { throw new Error("gagal"); })).rejects.toThrow("gagal");
    expect(await lock.run(async () => "lanjut")).toBe("lanjut");
  });
});
```

`server/account-sync-queue.test.mjs`:

```js
import { describe, expect, it } from "bun:test";
import { createAccountSyncQueue } from "./account-sync-queue.js";
import { createLock } from "./campaign-lock.js";

function build({ run = async () => {} } = {}) {
  const timers = [];
  const errors = [];
  const queue = createAccountSyncQueue({
    run,
    lock: createLock(),
    delayMs: 30_000,
    setTimer: (fn, ms) => timers.push({ fn, ms }),
    log: { error: (message) => errors.push(message) },
  });
  return { queue, timers, errors };
}

describe("createAccountSyncQueue", () => {
  it("beberapa tulisan dalam satu jeda digabung jadi satu sync", async () => {
    const calls = [];
    const { queue, timers } = build({ run: async (ids) => calls.push(ids) });
    queue.enqueue("k1");
    queue.enqueue("k2");
    queue.enqueue("k1");
    expect(timers.length).toBe(1);
    expect(timers[0].ms).toBe(30_000);
    await queue.flush();
    expect(calls).toEqual([["k1", "k2"]]);
    expect(queue.size()).toBe(0);
  });

  it("id kosong diabaikan", () => {
    const { queue, timers } = build();
    queue.enqueue("");
    queue.enqueue(null);
    expect(timers.length).toBe(0);
  });

  it("sync yang gagal dicatat, tidak melempar", async () => {
    const { queue, errors } = build({ run: async () => { throw new Error("RTDB tak terjangkau"); } });
    queue.enqueue("k1");
    await queue.flush();
    expect(errors[0]).toContain("RTDB tak terjangkau");
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `cd server && bun test campaign-lock.test.mjs account-sync-queue.test.mjs`
Expected: FAIL, modul tidak ditemukan.

- [ ] **Step 3: Implementasi**

`server/campaign-lock.js`:

```js
/**
 * Penjaga tumpang-tindih untuk tulisan ke `users/{id}/campaigns`.
 *
 * Dua penulisnya — penyegaran status dua menitan dan sync akun sesudah campaign diubah dari
 * halaman Campaign — tidak boleh berjalan bersamaan: yang satu menulis baris yang barusan dibaca
 * yang lain. `tryRun` untuk cron (lewati siklus kalau sibuk), `run` untuk antrean sync (tunggu).
 */
export function createLock() {
  let active = 0;
  let tail = Promise.resolve();

  const run = (task) => {
    const result = tail.then(async () => {
      active++;
      try {
        return await task();
      } finally {
        active--;
      }
    });
    tail = result.catch(() => {});
    return result;
  };

  return {
    run,
    tryRun: (task) => (active > 0 ? null : run(task)),
    isBusy: () => active > 0,
  };
}
```

`server/account-sync-queue.js`:

```js
/**
 * Antrean sync per ad account sesudah campaign diubah dari halaman Campaign.
 *
 * Penyegaran dua menitan cuma memperbarui status/jadwal/anggaran baris yang SUDAH ada — campaign
 * salinan dan nama baru baru tampil lewat `syncCampaigns`. Sync itu berat (tujuan optimasi,
 * insights, riwayat), jadi beberapa tulisan ke satu akun dalam satu jeda dibayar SATU sync.
 */
export function createAccountSyncQueue({
  run,
  lock,
  delayMs = 30_000,
  log = console,
  setTimer = setTimeout,
}) {
  const pending = new Set();
  let timer = null;

  const flush = async () => {
    timer = null;
    if (!pending.size) return { ids: [] };
    const ids = [...pending];
    pending.clear();
    try {
      await lock.run(() => run(ids));
    } catch (error) {
      // Perubahannya sudah ada di Meta; sync per jam yang membawanya ke tabel.
      log.error(`[campaign] sync akun ${ids.join(", ")} gagal: ${error.message}`);
    }
    return { ids };
  };

  return {
    enqueue(accountId) {
      const id = String(accountId || "").trim();
      if (!id) return;
      pending.add(id);
      if (!timer) timer = setTimer(() => flush(), delayMs);
    },
    flush,
    size: () => pending.size,
  };
}
```

`server/campaign-rows.js` — pindahkan `campaignRowOf` dari `server/campaigns.js` apa adanya:

```js
import { status } from "elysia";
import { campaignEntries } from "../functions/sync-core.js";

/**
 * Baris campaign di dalam profil `userId` — atau alasan kenapa tidak ada.
 *
 * Dipakai saklar campaign/ad set DAN halaman Campaign, dan yang dijaganya sama di semuanya: ID
 * campaign yang datang dari request TIDAK PERNAH dipercaya sebagai alamat Meta. Tanpa pencarian
 * ini, endpoint mana pun jadi proxy Meta untuk campaign apa saja di Business Manager — cukup
 * mengoper ID milik akun orang lain.
 */
export async function campaignRowOf(store, userId, campaignId) {
  const user = await store.read(`users/${userId}`);
  if (!user || user.deletedAt) return { notFound: status(404, { error: "User tidak ditemukan." }) };
  const row = campaignEntries(user.campaigns).find(
    ([, item]) => String(item?.campaignId || "") === String(campaignId),
  )?.[1];
  if (!row) {
    return { user, notFound: status(404, { error: "Campaign ini bukan milik user tersebut." }) };
  }
  return { user, row };
}
```

Di `server/campaigns.js`: hapus fungsi `campaignRowOf` beserta komentarnya di akhir berkas, tambahkan `import { campaignRowOf } from "./campaign-rows.js";`, dan ubah import sync-core menjadi:

```js
import { CAMPAIGN_STATUSES, campaignCommandEntry } from "../functions/sync-core.js";
```

- [ ] **Step 4: Jalankan, pastikan lolos**

Run: `cd server && bun test`
Expected: PASS seluruhnya, termasuk `campaigns.test.mjs` yang tidak diubah.

- [ ] **Step 5: Lint dan commit**

Run: `npx biome check --write server/campaign-rows.js server/campaign-lock.js server/account-sync-queue.js server/campaigns.js server/campaign-lock.test.mjs server/account-sync-queue.test.mjs`

```bash
git add server/campaign-rows.js server/campaign-lock.js server/account-sync-queue.js server/campaigns.js server/campaign-lock.test.mjs server/account-sync-queue.test.mjs
git commit -m "refactor(server): campaignRowOf bersama, penjaga campaign, antrean sync per akun"
```

---

### Task 9: Server — route `/fleet` (salin, ubah campaign, ubah ad set)

**Files:**
- Create: `server/campaign-manage.js`
- Test: `server/campaign-manage.test.mjs`

**Interfaces:**
- Consumes: Task 4 (`fetchCampaignForEdit`, `updateCampaign`, `fetchAdSetForEdit`, `updateAdSet`), Task 5–6 (aturan), Task 7 (`startCopyJob`, `JobConflict`), Task 8 (`campaignRowOf`).
- Produces: `campaignManageRoutes({ db, store, metaToken, enqueueSync?, authorize? }) => Elysia` dengan:

| Method + path | Body/query | Jawaban 200 |
|---|---|---|
| `POST /fleet/campaigns/:campaignId/copies` | `{ userId, name, count, confirmSubDomain? }` | `{ jobId, state, mode, copies, error }` |
| `GET /fleet/campaigns/:campaignId` | `?userId=` | `{ campaign: { id, name, status, dailyBudget, lifetimeBudget, accountId, budget: { editable, reason } }, mapping: { subDomain, source, code } }` |
| `POST /fleet/campaigns/:campaignId` | `{ userId, name?, dailyBudget?, confirmSubDomain? }` | `{ campaignId, applied: true, changed: string[] }` |
| `GET /fleet/campaigns/:campaignId/adsets/:adSetId` | `?userId=` | `{ adSet: { id, name, campaignId, status, dailyBudget, lifetimeBudget, budget, targeting: { editable, reason, countries, ageMin, ageMax } } }` |
| `POST /fleet/campaigns/:campaignId/adsets/:adSetId` | `{ userId, name?, dailyBudget?, countries?, ageMin?, ageMax? }` | `{ campaignId, adSetId, applied: true, changed: string[] }` |

Jawaban gagal: 403 (bukan superadmin), 404, 409 `{ error, needsConfirm: true, subDomain }` (konfirmasi) atau `{ error }` (job berjalan), 422, 502, 503.

- [ ] **Step 1: Tulis tes yang gagal** — `server/campaign-manage.test.mjs`:

```js
import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { AuthError } from "./auth.js";
import { campaignManageRoutes } from "./campaign-manage.js";

// HARUS "localhost" — lihat campaigns.test.mjs.
const URL_BASE = "http://localhost";

function fakeStore(data = {}) {
  const state = structuredClone(data);
  const at = (path) => path.split("/").reduce((node, key) => node?.[key], state);
  return {
    state,
    read: async (path) => structuredClone(at(path) ?? null),
    update: async (path, values) => {
      for (const [key, value] of Object.entries(values)) {
        const parts = `${path}/${key}`.split("/");
        const last = parts.pop();
        let node = state;
        for (const part of parts) node = node[part] ??= {};
        if (value === null) delete node[last];
        else node[last] = structuredClone(value);
      }
    },
  };
}

const DATA = {
  users: {
    u_nur: {
      email: "nur@rabbitracing.live",
      name: "Nurjaman",
      campaigns: [
        { campaignId: "120210", campaign: "TvH1-06 Pros", adAccount: "act_1", subDomain: "puppy.petcins.com", subDomainSource: "code" },
        { campaignId: "120211", campaign: "Tanpa kode", adAccount: "act_1" },
      ],
    },
  },
  subDomains: {
    s1: { name: "puppy.petcins.com", campaignCodes: "TvH1" },
    s2: { name: "dog.petcins.com", campaignCodes: "5rx7" },
  },
  adAccounts: { k1: { actId: "act_1", name: "TBZ 1247" } },
};

const SUPER = { role: "superadmin", email: "super@r.live", uid: "s1" };

function build({ authorize, metaToken = "token", data = DATA } = {}) {
  const store = fakeStore(data);
  const synced = [];
  const app = new Elysia().use(
    campaignManageRoutes({
      db: {},
      store,
      metaToken,
      enqueueSync: (id) => synced.push(id),
      authorize: authorize || (async () => SUPER),
    }),
  );
  return { app, store, synced };
}

function send(app, path, payload) {
  const init =
    payload === undefined
      ? { headers: { authorization: "Bearer t" } }
      : {
          method: "POST",
          headers: { authorization: "Bearer t", "content-type": "application/json" },
          body: JSON.stringify(payload),
        };
  return app.handle(new Request(`${URL_BASE}${path}`, init));
}

// Kunci rute: "METHOD /path-tanpa-versi". Nilai: [body, ok?].
function metaStub(routes) {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    const u = new URL(String(url));
    const key = `${options?.method || "GET"} ${u.pathname.replace(/^\/v25\.0/, "")}`;
    calls.push({ key, params: u.searchParams });
    const handler = routes[key];
    if (!handler) throw new Error(`panggilan tak terduga: ${key}`);
    const [body, ok = true] = handler;
    return Response.json(body, { status: ok ? 200 : 400 });
  };
  return calls;
}

describe("gerbang /fleet", () => {
  it("bukan superadmin: 403 dengan kalimat halaman ini, Meta tidak disentuh", async () => {
    const calls = metaStub({});
    const { app } = build({
      authorize: async () => {
        throw new AuthError("Hanya superadmin yang boleh menjalankan gating.", 403);
      },
    });
    const res = await send(app, "/fleet/campaigns/120210/copies", { userId: "u_nur", name: "TvH1-07", count: 1 });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Hanya superadmin yang boleh mengelola campaign.");
    expect(calls.length).toBe(0);
  });

  it("tanpa META_ACCESS_TOKEN: 503", async () => {
    metaStub({});
    const { app } = build({ metaToken: "" });
    const res = await send(app, "/fleet/campaigns/120210?userId=u_nur");
    expect(res.status).toBe(503);
  });

  it("campaign yang bukan milik profil itu: 404, Meta tidak disentuh", async () => {
    const calls = metaStub({});
    const { app } = build();
    const res = await send(app, "/fleet/campaigns/999/copies", { userId: "u_nur", name: "TvH1-07", count: 1 });
    expect(res.status).toBe(404);
    expect(calls.length).toBe(0);
  });
});

describe("POST /fleet/campaigns/:id/copies", () => {
  const COPY_ROUTES = {
    "GET /120210/ads": [{ data: [{ id: "a1", adset_id: "s1" }] }],
    "POST /120210/copies": [{ copied_campaign_id: "900" }],
    "POST /900": [{ success: true }],
  };

  it("salin langsung: 200 done, nama diganti, akun masuk antrean sync", async () => {
    const calls = metaStub(COPY_ROUTES);
    const { app, store, synced } = build();
    const res = await send(app, "/fleet/campaigns/120210/copies", { userId: "u_nur", name: "TvH1-07 Pros", count: 1 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.state).toBe("done");
    expect(calls.find((call) => call.key === "POST /900").params.get("name")).toBe("TvH1-07 Pros");
    expect(synced).toEqual(["k1"]);
    expect(store.state.dashboard.campaignCopyJobs[body.jobId].requestedBy).toBe("super@r.live");
  });

  it("kode milik subdomain lain: 422, Meta tidak disentuh", async () => {
    const calls = metaStub(COPY_ROUTES);
    const { app } = build();
    const res = await send(app, "/fleet/campaigns/120210/copies", { userId: "u_nur", name: "5rx7-01 Pros", count: 1 });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain("dog.petcins.com");
    expect(calls.length).toBe(0);
  });

  it("campaign belum terpetakan: 409 minta konfirmasi, lalu jalan dengan konfirmasi", async () => {
    metaStub({
      "GET /120211/ads": [{ data: [] }],
      "POST /120211/copies": [{ copied_campaign_id: "901" }],
      "POST /901": [{ success: true }],
    });
    const { app } = build();
    const first = await send(app, "/fleet/campaigns/120211/copies", { userId: "u_nur", name: "5rx7-01 Pros", count: 1 });
    expect(first.status).toBe(409);
    expect(await first.json()).toMatchObject({ needsConfirm: true, subDomain: "dog.petcins.com" });
    const second = await send(app, "/fleet/campaigns/120211/copies", {
      userId: "u_nur",
      name: "5rx7-01 Pros",
      count: 1,
      confirmSubDomain: "dog.petcins.com",
    });
    expect(second.status).toBe(200);
  });

  it("salinan yang masih berjalan: 409 tanpa needsConfirm", async () => {
    metaStub(COPY_ROUTES);
    const { app } = build({
      data: { ...DATA, dashboard: { campaignCopyJobs: { jold: { sourceCampaignId: "120210", state: "running" } } } },
    });
    const res = await send(app, "/fleet/campaigns/120210/copies", { userId: "u_nur", name: "TvH1-07", count: 1 });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("masih berjalan");
    expect(body.needsConfirm).toBeUndefined();
  });

  it("Meta menolak isiannya: 422 berikut jobId", async () => {
    metaStub({
      ...COPY_ROUTES,
      "POST /120210/copies": [{ error: { message: "Invalid parameter", code: 100 } }, false],
    });
    const { app } = build();
    const res = await send(app, "/fleet/campaigns/120210/copies", { userId: "u_nur", name: "TvH1-07", count: 1 });
    expect(res.status).toBe(422);
    expect((await res.json()).jobId).toBeTruthy();
  });

  it("jumlah salinan di luar 1–5 ditolak validator", async () => {
    metaStub({});
    const { app } = build();
    const res = await send(app, "/fleet/campaigns/120210/copies", { userId: "u_nur", name: "TvH1-07", count: 9 });
    expect(res.status).toBe(422);
  });
});

describe("ubah campaign", () => {
  it("GET: nilai segar dari Meta berikut boleh-tidaknya anggaran diubah", async () => {
    metaStub({ "GET /120210": [{ id: "120210", name: "TvH1-06 Pros", status: "ACTIVE", daily_budget: "50000" }] });
    const { app } = build();
    const body = await (await send(app, "/fleet/campaigns/120210?userId=u_nur")).json();
    expect(body.campaign.dailyBudget).toBe(50000);
    expect(body.campaign.budget).toEqual({ editable: true, reason: "" });
    expect(body.mapping).toEqual({ subDomain: "puppy.petcins.com", source: "code", code: "" });
  });

  it("ganti nama ke kode subdomain yang sama: ditulis, akun masuk antrean sync", async () => {
    const calls = metaStub({ "POST /120210": [{ success: true }] });
    const { app, synced } = build();
    const res = await send(app, "/fleet/campaigns/120210", { userId: "u_nur", name: "TvH1-07 Pros" });
    expect(res.status).toBe(200);
    expect(calls[0].params.get("name")).toBe("TvH1-07 Pros");
    expect(synced).toEqual(["k1"]);
  });

  it("ganti nama ke kode subdomain lain: 422", async () => {
    const calls = metaStub({});
    const { app } = build();
    const res = await send(app, "/fleet/campaigns/120210", { userId: "u_nur", name: "5rx7-02 Pros" });
    expect(res.status).toBe(422);
    expect(calls.length).toBe(0);
  });

  it("anggaran untuk campaign ABO: 422 sebelum menulis", async () => {
    const calls = metaStub({ "GET /120210": [{ id: "120210", name: "TvH1-06 Pros", status: "ACTIVE" }] });
    const { app } = build();
    const res = await send(app, "/fleet/campaigns/120210", { userId: "u_nur", dailyBudget: 75000 });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain("dipegang ad set");
    expect(calls.some((call) => call.key.startsWith("POST"))).toBe(false);
  });

  it("anggaran di bawah minimum Meta: 422 dengan kalimat Meta", async () => {
    metaStub({
      "GET /120210": [{ id: "120210", daily_budget: "50000" }],
      "POST /120210": [{ error: { message: "Budget too low", code: 100, error_subcode: 1885272 } }, false],
    });
    const { app } = build();
    const res = await send(app, "/fleet/campaigns/120210", { userId: "u_nur", dailyBudget: 100 });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain("Budget too low");
  });

  it("tanpa perubahan: 422", async () => {
    metaStub({});
    const { app } = build();
    const res = await send(app, "/fleet/campaigns/120210", { userId: "u_nur" });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain("Tidak ada yang diubah");
  });
});

describe("ubah ad set", () => {
  const ADSET = {
    id: "555",
    name: "Adset 1",
    campaign_id: "120210",
    status: "ACTIVE",
    targeting: {
      age_min: 18,
      age_max: 65,
      geo_locations: { countries: ["TR"] },
      flexible_spec: [{ interests: [{ id: "1" }] }],
    },
  };

  it("ad set milik campaign lain: 404, tidak ada yang ditulis", async () => {
    const calls = metaStub({ "GET /555": [{ ...ADSET, campaign_id: "999" }] });
    const { app } = build();
    const res = await send(app, "/fleet/campaigns/120210/adsets/555", { userId: "u_nur", name: "X" });
    expect(res.status).toBe(404);
    expect(calls.some((call) => call.key.startsWith("POST"))).toBe(false);
  });

  it("GET: targeting diringkas, anggaran CBO tidak bisa diubah di ad set", async () => {
    metaStub({ "GET /555": [ADSET] });
    const { app } = build();
    const body = await (await send(app, "/fleet/campaigns/120210/adsets/555?userId=u_nur")).json();
    expect(body.adSet.targeting).toEqual({ editable: true, reason: "", countries: ["TR"], ageMin: 18, ageMax: 65 });
    expect(body.adSet.budget.reason).toContain("dipegang campaign");
  });

  it("negara diganti, isi targeting lain dikirim utuh", async () => {
    const calls = metaStub({ "GET /555": [ADSET], "POST /555": [{ success: true }] });
    const { app } = build();
    const res = await send(app, "/fleet/campaigns/120210/adsets/555", { userId: "u_nur", countries: ["tr", "mx"] });
    expect(res.status).toBe(200);
    const sent = JSON.parse(calls.find((call) => call.key === "POST /555").params.get("targeting"));
    expect(sent.geo_locations.countries).toEqual(["TR", "MX"]);
    expect(sent.flexible_spec).toEqual([{ interests: [{ id: "1" }] }]);
  });

  it("lokasi berkota: 422, tidak ada yang ditulis", async () => {
    const withCities = { ...ADSET, targeting: { ...ADSET.targeting, geo_locations: { countries: ["TR"], cities: [{ key: "1" }] } } };
    const calls = metaStub({ "GET /555": [withCities] });
    const { app } = build();
    const res = await send(app, "/fleet/campaigns/120210/adsets/555", { userId: "u_nur", ageMin: 21 });
    expect(res.status).toBe(422);
    expect(calls.some((call) => call.key.startsWith("POST"))).toBe(false);
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `cd server && bun test campaign-manage.test.mjs`
Expected: FAIL, modul tidak ditemukan.

- [ ] **Step 3: Implementasi** — `server/campaign-manage.js`:

```js
import { Elysia, status, t } from "elysia";
import { JobConflict, startCopyJob } from "../functions/campaign-copy-jobs.mjs";
import {
  accountOfCampaignRow,
  assertConfirmed,
  budgetState,
  ConfirmRequired,
  campaignNameVerdict,
  copyNames,
  mergeTargeting,
  metaFailureStatus,
  parseBudget,
  RuleError,
  targetingState,
} from "../functions/campaign-manage-core.js";
import {
  fetchAdSetForEdit,
  fetchCampaignForEdit,
  updateAdSet,
  updateCampaign,
} from "../functions/meta.js";
import { buildCodeIndex } from "../functions/sync-core.js";
import { AuthError, bearerToken, requireSuperAdmin } from "./auth.js";
import { campaignRowOf } from "./campaign-rows.js";

/**
 * Halaman Campaign (/campaigns): duplikasi dan edit campaign Meta. SUPERADMIN saja.
 *
 * Yang menegakkan izinnya gerbang di sini, bukan aturan database: anggaran, nama, dan targeting
 * tidak menulis satu pun baris RTDB. Campaign dicari di profil pemiliknya (`campaignRowOf`) dan ad
 * set dibuktikan milik campaign itu dengan membacanya ulang dari Meta — tanpa keduanya, route ini
 * jadi editor Meta untuk objek mana pun di Business Manager.
 */
const USER_ID = t.String({ minLength: 1, maxLength: 128 });
const CAMPAIGN_PARAMS = t.Object({ campaignId: t.String({ pattern: "^[0-9]+$" }) });
const ADSET_PARAMS = t.Object({
  campaignId: t.String({ pattern: "^[0-9]+$" }),
  adSetId: t.String({ pattern: "^[0-9]+$" }),
});
const BUDGET = t.Optional(t.Union([t.Number(), t.String({ maxLength: 20 })]));
const CONFIRM = t.Optional(t.String({ maxLength: 300 }));

export function campaignManageRoutes({ db, store, metaToken, enqueueSync = () => {}, authorize }) {
  const check = authorize || ((token) => requireSuperAdmin(db, token));

  const failure = (error) => {
    if (error instanceof ConfirmRequired) {
      return status(409, { error: error.message, needsConfirm: true, subDomain: error.subDomain });
    }
    if (error instanceof RuleError || error instanceof JobConflict) {
      return status(error.status, { error: error.message });
    }
    return status(metaFailureStatus(error?.message), { error: error?.message || "Meta tidak menjawab." });
  };

  const owned = async (userId, campaignId) => {
    if (!metaToken) return { stop: status(503, { error: "META_ACCESS_TOKEN belum di-set di server." }) };
    const { row, notFound } = await campaignRowOf(store, userId, campaignId);
    return notFound ? { stop: notFound } : { row };
  };

  const codeIndex = async () => buildCodeIndex((await store.read("subDomains")) || {}).byCode;
  const accountOf = async (row) => accountOfCampaignRow((await store.read("adAccounts")) || {}, row);

  const ownedAdSet = async (campaignId, adSetId) => {
    const adSet = await fetchAdSetForEdit(adSetId, metaToken);
    return adSet.campaignId === String(campaignId)
      ? { adSet }
      : { stop: status(404, { error: "Ad set ini bukan milik campaign tersebut." }) };
  };

  return new Elysia({ prefix: "/fleet" })
    .macro({
      superadmin: {
        async resolve({ headers }) {
          try {
            return { actor: await check(bearerToken(headers.authorization)) };
          } catch (error) {
            if (error instanceof AuthError) {
              return status(error.status, {
                error: error.status === 403 ? "Hanya superadmin yang boleh mengelola campaign." : error.message,
              });
            }
            return status(503, { error: `Izin tidak bisa diperiksa sekarang: ${error.message}` });
          }
        },
      },
    })

    .post(
      "/campaigns/:campaignId/copies",
      async ({ params, body, actor }) => {
        const { row, stop } = await owned(body.userId, params.campaignId);
        if (stop) return stop;
        try {
          const names = copyNames(body.name, body.count);
          assertConfirmed(campaignNameVerdict(row, names[0], await codeIndex()), body.confirmSubDomain);
          const account = await accountOf(row);
          if (!account) throw new RuleError("Ad account campaign ini tidak terdaftar di /ad-accounts.");
          const result = await startCopyJob(store, metaToken, {
            userId: body.userId,
            row,
            account,
            names,
            requestedBy: actor.email || actor.uid,
            enqueueSync,
          });
          if (result.state === "failed") {
            return status(metaFailureStatus(result.error), { error: result.error, jobId: result.jobId });
          }
          return result;
        } catch (error) {
          return failure(error);
        }
      },
      {
        superadmin: true,
        params: CAMPAIGN_PARAMS,
        body: t.Object({
          userId: USER_ID,
          name: t.String({ minLength: 1, maxLength: 400 }),
          count: t.Integer({ minimum: 1, maximum: 5 }),
          confirmSubDomain: CONFIRM,
        }),
      },
    )

    .get(
      "/campaigns/:campaignId",
      async ({ params, query }) => {
        const { row, stop } = await owned(query.userId, params.campaignId);
        if (stop) return stop;
        try {
          const campaign = await fetchCampaignForEdit(params.campaignId, metaToken);
          return {
            campaign: { ...campaign, budget: budgetState("campaign", campaign) },
            mapping: {
              subDomain: row.subDomain || "",
              source: row.subDomainSource || "",
              code: row.campaignCode || "",
            },
          };
        } catch (error) {
          return failure(error);
        }
      },
      { superadmin: true, params: CAMPAIGN_PARAMS, query: t.Object({ userId: USER_ID }) },
    )

    .post(
      "/campaigns/:campaignId",
      async ({ params, body }) => {
        const { row, stop } = await owned(body.userId, params.campaignId);
        if (stop) return stop;
        try {
          const changes = {};
          if (body.name !== undefined) {
            const name = body.name.trim();
            assertConfirmed(campaignNameVerdict(row, name, await codeIndex()), body.confirmSubDomain);
            changes.name = name;
          }
          if (body.dailyBudget !== undefined) {
            const budget = budgetState("campaign", await fetchCampaignForEdit(params.campaignId, metaToken));
            if (!budget.editable) throw new RuleError(budget.reason);
            changes.dailyBudget = parseBudget(body.dailyBudget);
          }
          if (!Object.keys(changes).length) throw new RuleError("Tidak ada yang diubah.");
          await updateCampaign(params.campaignId, metaToken, changes);
          // Penyegaran dua menitan tidak membaca nama, padahal nama itulah pemetaannya.
          if (changes.name) {
            const account = await accountOf(row);
            if (account) enqueueSync(account.id);
          }
          return { campaignId: params.campaignId, applied: true, changed: Object.keys(changes) };
        } catch (error) {
          return failure(error);
        }
      },
      {
        superadmin: true,
        params: CAMPAIGN_PARAMS,
        body: t.Object({
          userId: USER_ID,
          name: t.Optional(t.String({ minLength: 1, maxLength: 400 })),
          dailyBudget: BUDGET,
          confirmSubDomain: CONFIRM,
        }),
      },
    )

    .get(
      "/campaigns/:campaignId/adsets/:adSetId",
      async ({ params, query }) => {
        const { stop } = await owned(query.userId, params.campaignId);
        if (stop) return stop;
        try {
          const found = await ownedAdSet(params.campaignId, params.adSetId);
          if (found.stop) return found.stop;
          // Targeting mentah TIDAK dikirim ke browser: yang digambar form cuma negara dan umur, dan
          // yang ditulis kembali disusun server dari bacaan segar, bukan dari salinan di layar.
          const { targeting, ...adSet } = found.adSet;
          return { adSet: { ...adSet, budget: budgetState("adset", adSet), targeting: targetingState(targeting) } };
        } catch (error) {
          return failure(error);
        }
      },
      { superadmin: true, params: ADSET_PARAMS, query: t.Object({ userId: USER_ID }) },
    )

    .post(
      "/campaigns/:campaignId/adsets/:adSetId",
      async ({ params, body }) => {
        const { stop } = await owned(body.userId, params.campaignId);
        if (stop) return stop;
        try {
          const found = await ownedAdSet(params.campaignId, params.adSetId);
          if (found.stop) return found.stop;
          const current = found.adSet;
          const changes = {};
          if (body.name !== undefined) {
            const name = body.name.trim();
            if (!name) throw new RuleError("Nama ad set wajib diisi.");
            changes.name = name;
          }
          if (body.dailyBudget !== undefined) {
            const budget = budgetState("adset", current);
            if (!budget.editable) throw new RuleError(budget.reason);
            changes.dailyBudget = parseBudget(body.dailyBudget);
          }
          if (body.countries !== undefined || body.ageMin !== undefined || body.ageMax !== undefined) {
            changes.targeting = mergeTargeting(current.targeting, {
              countries: body.countries,
              ageMin: body.ageMin,
              ageMax: body.ageMax,
            });
          }
          if (!Object.keys(changes).length) throw new RuleError("Tidak ada yang diubah.");
          await updateAdSet(current.id, metaToken, changes);
          return {
            campaignId: params.campaignId,
            adSetId: current.id,
            applied: true,
            changed: Object.keys(changes),
          };
        } catch (error) {
          return failure(error);
        }
      },
      {
        superadmin: true,
        params: ADSET_PARAMS,
        body: t.Object({
          userId: USER_ID,
          name: t.Optional(t.String({ maxLength: 400 })),
          dailyBudget: BUDGET,
          countries: t.Optional(t.Array(t.String({ maxLength: 8 }), { maxItems: 250 })),
          ageMin: t.Optional(t.Number()),
          ageMax: t.Optional(t.Number()),
        }),
      },
    );
}
```

- [ ] **Step 4: Jalankan, pastikan lolos**

Run: `cd server && bun test`
Expected: PASS seluruhnya.

- [ ] **Step 5: Lint dan commit**

Run: `npx biome check --write server/campaign-manage.js server/campaign-manage.test.mjs`

```bash
git add server/campaign-manage.js server/campaign-manage.test.mjs
git commit -m "feat(server): route superadmin untuk salin dan ubah campaign Meta"
```

---

### Task 10: Server — wiring di `index.js`

**Files:**
- Modify: `server/index.js` (import; konstanta cron; `runCampaignCycle` baris 261–305; siklus job baru; rantai `app`; log start)

**Interfaces:**
- Consumes: Task 7 (`pollCopyJobs`), Task 8 (`createLock`, `createAccountSyncQueue`), Task 9 (`campaignManageRoutes`), `syncCampaigns` dari `../functions/sync-meta.mjs`.

`index.js` menyambung RTDB dan membuka port saat diimpor, jadi tidak ada unit test untuknya (sepola berkas itu hari ini). Verifikasinya: seluruh tes server lolos dan bundelnya terbentuk.

- [ ] **Step 1: Import**

Tambahkan (urut abjad di antara import yang sudah ada):

```js
import { pollCopyJobs } from "../functions/campaign-copy-jobs.mjs";
import { refreshCampaignStatuses, syncCampaigns } from "../functions/sync-meta.mjs";
import { createAccountSyncQueue } from "./account-sync-queue.js";
import { createLock } from "./campaign-lock.js";
import { campaignManageRoutes } from "./campaign-manage.js";
```

(Baris lama `import { refreshCampaignStatuses } from "../functions/sync-meta.mjs";` diganti yang di atas.)

- [ ] **Step 2: Konstanta cron** — sesudah `SYNC_RUNS_CRON`:

```js
/**
 * Job salinan campaign dari halaman /campaigns yang masih berjalan di antrean asinkron Meta.
 *
 * Tiap menit, digeser ke detik ke-20 supaya tidak berangkat bersamaan dengan percobaan ulang plugin
 * (detik 0) dan inbox Telegram (detik 15). Biayanya saat kosong — keadaan normalnya — satu bacaan
 * RTDB yang dijawab cache penghangat.
 */
const CAMPAIGN_JOBS_CRON = process.env.CAMPAIGN_JOBS_CRON || "20 * * * * *";
```

- [ ] **Step 3: Penjaga bersama dan antrean sync** — ganti blok `let campaignRunning = false;` sampai akhir `runCampaignCycle` dengan:

```js
/**
 * Satu penjaga untuk dua penulis `users/{id}/campaigns`: siklus campaign dua menitan dan sync akun
 * sesudah campaign diubah dari halaman /campaigns. Siklus cron MELEWATI putarannya kalau sibuk
 * (`tryRun`); antrean sync MENUNGGU (`run`) — perubahan yang baru dibuat orang tidak boleh
 * dibuang karena kebetulan berbarengan dengan penyegaran status.
 */
const campaignLock = createLock();

const accountSync = createAccountSyncQueue({
  lock: campaignLock,
  run: async (ids) => {
    const res = await syncCampaigns(db, META_TOKEN, ids);
    console.log(`[campaign] sync akun ${ids.join(", ")}: ${res.campaigns} campaign di ${res.updated} user.`);
  },
});

async function runCampaignCycle(source) {
  if (!META_TOKEN) return;
  const started = campaignLock.tryRun(async () => {
    /**
     * SEBELUM penerap antrean, dan urutan ini KEBALIKAN dari gating.
     *
     * Di gating, vi-control membaca ulang dan memverifikasi sebelum menjawab, jadi cermin disegarkan
     * SESUDAH. Di sini Meta butuh waktu menampakkan perubahan: bacaan status yang datang setelah
     * penerap akan menimpa perintah yang baru diterapkan dengan keadaan lamanya, dan tombol yang
     * baru ditekan melompat balik ke posisi semula di layar.
     */
    try {
      const res = await refreshCampaignStatuses(db, META_TOKEN);
      if (res.fields) {
        console.log(`[campaign] status disegarkan: ${res.fields} kolom di ${res.users} user.`);
      }
      for (const error of res.errors) {
        console.error(`[campaign] status ${error.name} gagal dibaca: ${error.message}`);
      }
    } catch (error) {
      // Antrean tetap jalan: yang gagal cuma pembacaan status, dan perintah yang sudah ditulis orang
      // tidak ada hubungannya dengan itu.
      console.error(`[campaign] penyegaran status gagal: ${error.message}`);
    }

    const res = await applyCampaignCommands(store, META_TOKEN);
    if (res.pending || res.cleaned) {
      console.log(
        `[campaign] ${source}: ${res.applied} diterapkan, ${res.failed} gagal, dari ${res.pending} antrean.`,
      );
    }
  });
  if (!started) {
    console.warn(`[campaign] ${source} dilewati: siklus atau sync akun sebelumnya masih jalan.`);
    return;
  }
  try {
    await started;
  } catch (error) {
    console.error(`[campaign] ${source} gagal: ${error.message}`);
  }
}

// Penjaga sendiri, terpisah dari `campaignLock`: memeriksa status batch Meta tidak menulis
// `users/{id}/campaigns`, dan sync yang ia picu sudah lewat antrean yang memakai penjaga itu.
let copyJobsRunning = false;
async function runCopyJobsCycle(source) {
  if (!META_TOKEN || copyJobsRunning) return;
  copyJobsRunning = true;
  try {
    const res = await pollCopyJobs(store, META_TOKEN, { enqueueSync: accountSync.enqueue });
    if (res.changed) console.log(`[campaign] ${source}: ${res.changed} job salinan berubah.`);
  } catch (error) {
    console.error(`[campaign] job salinan ${source} gagal: ${error.message}`);
  } finally {
    copyJobsRunning = false;
  }
}
```

- [ ] **Step 4: Rantai `app`** — sesudah blok `.use(cron({ name: "telegram-inbox", ... }))`:

```js
  .use(
    cron({
      name: "campaign-copy-jobs",
      pattern: CAMPAIGN_JOBS_CRON,
      timezone: TIMEZONE,
      catch: true,
      run: () => runCopyJobsCycle("cron"),
    }),
  )
```

Sesudah `.use(campaignRoutes({ db, store, metaToken: META_TOKEN }))`:

```js
  /**
   * Halaman Campaign (/campaigns) — salin dan ubah campaign Meta. SUPERADMIN, gerbangnya di
   * campaign-manage.js. Tiap tulisan yang berhasil memasukkan ad account-nya ke antrean sync, supaya
   * campaign salinan dan nama baru tampil di tabel tanpa menunggu sync per jam.
   */
  .use(
    campaignManageRoutes({ db, store, metaToken: META_TOKEN, enqueueSync: accountSync.enqueue }),
  )
```

Di akhir berkas, sesudah log `[plugin] percobaan ulang ...`:

```js
console.log(
  META_TOKEN
    ? `[campaign] halaman Campaign aktif — job salinan cron "${CAMPAIGN_JOBS_CRON}"`
    : "[campaign] META_ACCESS_TOKEN belum di-set — halaman Campaign tidak bisa menulis ke Meta.",
);
```

- [ ] **Step 5: Verifikasi**

Run: `cd server && bun test`
Expected: PASS.

Run: `cd server && bun build index.js --target=bun --outdir ../.tmp-build-check`
Expected: bundel terbentuk tanpa error resolusi import. Lalu hapus foldernya: `rm -rf ../.tmp-build-check` (PowerShell: `Remove-Item -Recurse -Force ..\.tmp-build-check`).

- [ ] **Step 6: Lint dan commit**

Run: `npx biome check --write server/index.js`

```bash
git add server/index.js
git commit -m "feat(server): pasang route Campaign, cron job salinan, dan antrean sync akun"
```

---

### Task 11: Frontend — langganan node job dan klien route `/fleet`

**Files:**
- Modify: `src/config/firebasePaths.js` (sesudah `pluginSites`)
- Modify: `src/lib/storeSubscriptions.js`
- Modify: `src/hooks/useFirebaseStore.js:3-9`, `:45-50`, `:107`, `:255-259`
- Modify: `src/lib/controlApi.js` (`ControlApiError`, `request`, fungsi baru di akhir)
- Test: `src/lib/firebaseCost.test.mjs`

**Interfaces:**
- Produces:
  - `store.campaignCopyJobs` (objek `{ [jobId]: job }`, hanya terisi untuk superadmin)
  - `campaignSubscriptions` di `storeSubscriptions.js`
  - `ControlApiError.body` (JSON jawaban server, atau `null`)
  - `copyCampaignNow(userId, campaignId, { name, count, confirmSubDomain? })`
  - `fetchCampaignEdit(userId, campaignId)`
  - `updateCampaignNow(userId, campaignId, { name?, dailyBudget?, confirmSubDomain? })`
  - `fetchAdSetEdit(userId, campaignId, adSetId)`
  - `updateAdSetNow(userId, campaignId, adSetId, { name?, dailyBudget?, countries?, ageMin?, ageMax? })`

- [ ] **Step 1: Tulis tes yang gagal** — di `src/lib/firebaseCost.test.mjs`, di dalam `describe("sessionNodes", ...)`:

```js
  // Isinya nama campaign dan siapa yang menyalinnya, untuk halaman yang cuma dibuka superadmin.
  it("job salinan campaign cuma dilanggan superadmin", () => {
    assert.ok(sessionNodes("superadmin", []).includes("campaignCopyJobs"));
    assert.ok(!sessionNodes("admin", []).includes("campaignCopyJobs"));
    assert.ok(!sessionNodes("advertiser", []).includes("campaignCopyJobs"));
  });
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `node --test src/lib/firebaseCost.test.mjs`
Expected: FAIL pada tes baru.

- [ ] **Step 3: Implementasi langganan**

`src/config/firebasePaths.js`, sesudah entri `pluginSites`:

```js
  // Job salinan campaign dari halaman /campaigns — ditulis server kontrol, dilanggan superadmin.
  // Cerminan `COPY_JOBS_PATH` di functions/campaign-manage-core.js.
  campaignCopyJobs: "dashboard/campaignCopyJobs",
```

`src/lib/storeSubscriptions.js`, sesudah `pluginSubscriptions`:

```js
/**
 * Job salinan campaign dari halaman /campaigns. Superadmin saja, sepola gating dan plugin: halaman
 * yang membacanya memang cuma untuk mereka, dan panel Salinan tidak digambar untuk role lain.
 */
export const campaignSubscriptions = {
  campaignCopyJobs: "object",
};
```

dan di `valueSubscriptionsFor`:

```js
    ...(isSuperAdmin(role)
      ? { ...gatingSubscriptions, ...pluginSubscriptions, ...campaignSubscriptions }
      : {}),
```

`src/hooks/useFirebaseStore.js` — rakitan langganan di sana adalah SALINAN `valueSubscriptionsFor`; salinan kedua akan lupa node baru ini suatu hari. Ganti import baris 3–9 dengan:

```js
import { canReadResource, isSuperAdmin, parseRoles, ROLE_OPTIONS } from "../config/access";
```

ganti import baris 45–50 dengan:

```js
import { valueSubscriptionsFor } from "../lib/storeSubscriptions";
```

tambahkan di `emptyStore` sesudah `pluginSites: {},`:

```js
  campaignCopyJobs: {},
```

dan ganti blok `const valueSubscriptions = { ... };` (baris 255–259) dengan:

```js
    // Satu daftar dengan penghitung biaya di /activity-logs — lihat lib/storeSubscriptions.js.
    const valueSubscriptions = valueSubscriptionsFor(role);
```

- [ ] **Step 4: Klien route `/fleet`** — di `src/lib/controlApi.js`:

`ControlApiError`:

```js
export class ControlApiError extends Error {
  constructor(message, { status = 0, offline = false, body = null } = {}) {
    super(message);
    this.status = status;
    // Dibedakan karena akibatnya berbeda: yang `offline` layak dicoba lagi lewat antrean, yang
    // ditolak server (403, 422) tidak akan berubah hasilnya lewat jalur mana pun.
    this.offline = offline;
    // Jawaban server apa adanya. Dialog halaman Campaign membaca `needsConfirm` + `subDomain` dari
    // sini untuk menanyakan konfirmasi, bukan menebaknya dari kalimat error.
    this.body = body;
  }
}
```

Di `request`, ganti `throw new ControlApiError(body?.error || ...` dengan:

```js
    throw new ControlApiError(body?.error || `Server kontrol menjawab HTTP ${res.status}.`, {
      status: res.status,
      // 502/503 = servernya hidup tapi tidak bisa menyelesaikan (Keitaro mati, RTDB tak
      // terjangkau). Antrean tidak akan lebih berhasil sekarang, tapi siklus berikutnya bisa.
      offline: res.status === 502 || res.status === 503,
      body,
    });
```

Tambahkan di akhir berkas:

```js
/**
 * Halaman Campaign (/campaigns) — salin dan ubah campaign Meta. SUPERADMIN.
 *
 * TIDAK ADA JALUR CADANGAN, sepola saklar ad set: token Meta tinggal di server, dan yang diubah di
 * sini tidak dicerminkan ke RTDB sebagai niat yang bisa diantrekan. Server yang mati berarti
 * tombolnya tidak digambar, bukan tulisan yang diam-diam menunggu.
 *
 * `userId` ikut tiap panggilan dengan alasan yang sama dengan saklar campaign: server mencari
 * campaign-nya di profil itu, dan tidak mempercayai ID yang dikirim dari sini.
 */
export function copyCampaignNow(userId, campaignId, { name, count, confirmSubDomain } = {}) {
  return request(`/fleet/campaigns/${encodeURIComponent(campaignId)}/copies`, {
    method: "POST",
    payload: { userId, name, count, confirmSubDomain },
  });
}

export function fetchCampaignEdit(userId, campaignId) {
  return request(
    `/fleet/campaigns/${encodeURIComponent(campaignId)}?userId=${encodeURIComponent(userId)}`,
  );
}

export function updateCampaignNow(userId, campaignId, changes) {
  return request(`/fleet/campaigns/${encodeURIComponent(campaignId)}`, {
    method: "POST",
    payload: { userId, ...changes },
  });
}

export function fetchAdSetEdit(userId, campaignId, adSetId) {
  return request(
    `/fleet/campaigns/${encodeURIComponent(campaignId)}/adsets/${encodeURIComponent(adSetId)}?userId=${encodeURIComponent(userId)}`,
  );
}

export function updateAdSetNow(userId, campaignId, adSetId, changes) {
  return request(
    `/fleet/campaigns/${encodeURIComponent(campaignId)}/adsets/${encodeURIComponent(adSetId)}`,
    { method: "POST", payload: { userId, ...changes } },
  );
}
```

- [ ] **Step 5: Jalankan, pastikan lolos**

Run: `npm test`
Expected: PASS.

Run: `npm run build`
Expected: build sukses.

- [ ] **Step 6: Lint dan commit**

Run: `npx biome check --write src/config/firebasePaths.js src/lib/storeSubscriptions.js src/hooks/useFirebaseStore.js src/lib/controlApi.js src/lib/firebaseCost.test.mjs`

```bash
git add src/config/firebasePaths.js src/lib/storeSubscriptions.js src/hooks/useFirebaseStore.js src/lib/controlApi.js src/lib/firebaseCost.test.mjs
git commit -m "feat(campaign): langganan job salinan dan klien route /fleet"
```

---

### Task 12: Frontend — baris campaign dan sel status dipakai bersama

Pemindahan tanpa perubahan perilaku, ditambah satu fungsi baru untuk seluruh armada.

**Files:**
- Create: `src/lib/campaignRows.js`
- Create: `src/components/campaigns/CampaignStatusCell.jsx`
- Modify: `src/components/UserDetail.jsx` (import baris 13; hapus `normalizeCampaignRows` baris 1447–1480; hapus blok baris 1482–1573: komentar "Why this campaign points…", `CampaignStatusCell`, `describeCampaignStatus`, `describeMappingSource`)
- Test: `src/lib/campaignRows.test.mjs`

**Interfaces:**
- Produces:
  - `normalizeCampaignRows(items) => row[]` (sama persis dengan yang lama)
  - `describeMappingSource(row) => string` (sama persis)
  - `fleetCampaignRows(users) => Array<row & { id: "{userId}__{campaignId}", userId, owner, command }>`
  - `<CampaignStatusCell item command canToggle onToggle />` (sama persis)

- [ ] **Step 1: Tulis tes yang gagal** — `src/lib/campaignRows.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { describeMappingSource, fleetCampaignRows, normalizeCampaignRows } from "./campaignRows.js";

test("baris lama tanpa campaignId tetap lahir, dengan alamat Meta kosong", () => {
  const [row] = normalizeCampaignRows([{ campaign: "A" }]);
  assert.equal(row.id, "A");
  assert.equal(row.campaignId, "");
  assert.equal(row.account, "-");
  assert.equal(row.dailyBudget, "-");
});

test("armada: seluruh pemilik, id unik per pemilik, perintah saklar ikut barisnya", () => {
  const rows = fleetCampaignRows([
    {
      id: "u1",
      name: "Nurjaman",
      campaigns: [{ campaignId: "1", campaign: "TvH1-06" }],
      campaignCommands: { 1: { state: "pending", desiredStatus: "PAUSED" } },
    },
    { id: "u2", email: "aldi@r.live", campaigns: [{ campaignId: "1", campaign: "TvH1-06" }] },
    { id: "u3", name: "Lama", deletedAt: "2026-08-01", campaigns: [{ campaignId: "9", campaign: "X" }] },
  ]);
  assert.deepEqual(rows.map((row) => row.id), ["u1__1", "u2__1"]);
  assert.deepEqual(rows.map((row) => row.owner), ["Nurjaman", "aldi@r.live"]);
  assert.equal(rows[0].userId, "u1");
  assert.equal(rows[0].command.state, "pending");
  assert.equal(rows[1].command, null);
});

test("sumber pemetaan disebut apa adanya", () => {
  assert.equal(describeMappingSource({ subDomainSource: "manual" }), "Dipetakan manual");
  assert.equal(describeMappingSource({ subDomain: "a.b", campaignCode: "tvh1" }), "Otomatis dari kode tvh1");
  assert.equal(
    describeMappingSource({ campaignCode: "npjl" }),
    "Kode npjl belum terdaftar di subdomain manapun",
  );
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `node --test src/lib/campaignRows.test.mjs`
Expected: FAIL, modul tidak ditemukan.

- [ ] **Step 3: Buat `src/lib/campaignRows.js`**

```js
import { firstValue } from "./firstValue.js";

/**
 * Baris campaign dari `users/{id}.campaigns` — dibaca profil user DAN halaman Campaign.
 *
 * Pindah dari UserDetail.jsx begitu pembacanya jadi dua: dua salinan penormal baris yang sama akan
 * menyebut dua status berbeda untuk satu campaign di dua halaman bertetangga.
 */

function toArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === "object") return Object.entries(value).map(([id, item]) => ({ id, ...item }));
  return [];
}

export function normalizeCampaignRows(items) {
  return toArray(items).map((item) => ({
    id: item.id || item.campaign,
    campaign: item.campaign,
    account: item.account || item.adAccount || item.actName || "-",
    subDomain: item.subDomain || "",
    campaignCode: item.campaignCode || "",
    subDomainSource: item.subDomainSource || "",
    // ID campaign di Meta — alamat yang dipakai saklar on/off. Baris lama (dan baris yang
    // diturunkan dari laporan ROI, yang tidak punya sisi Meta) datang tanpa ini, dan tombolnya
    // mati dengan alasannya alih-alih menembakkan perintah yang pasti gagal.
    campaignId: String(item.campaignId || ""),
    status: item.status || "",
    // Posisi saklar apa adanya dari Meta (`status`). Label di kolom Status diturunkan dari field
    // yang sama plus `startTime`, tapi diturunkannya di sisi sync — bukan di sini.
    configuredStatus: item.configuredStatus || "",
    startTime: item.startTime || "",
    metaMissing: Boolean(item.metaMissing),
    statusAppliedAt: item.statusAppliedAt || "",
    result: firstValue(item.result),
    resultType: item.resultType || "",
    costPerResult: firstValue(item.costPerResult, item.cpc),
    dailyBudget: firstValue(item.dailyBudget),
    spendToday: firstValue(item.spendToday),
    spendDate: firstValue(item.spendDate, item.date),
  }));
}

// Kenapa campaign ini menunjuk ke tempatnya. Tanpa ini baris yang dipetakan otomatis tidak bisa
// dibedakan dari yang diatur tangan, padahal keduanya berperilaku beda pada sync berikutnya.
export function describeMappingSource(item) {
  if (item.subDomainSource === "manual") return "Dipetakan manual";
  if (item.subDomain && item.campaignCode) return `Otomatis dari kode ${item.campaignCode}`;
  if (item.subDomain) return "Otomatis dari kode";
  return item.campaignCode
    ? `Kode ${item.campaignCode} belum terdaftar di subdomain manapun`
    : "Belum dipetakan — daftarkan kodenya di halaman Sub Domains";
}

/**
 * Seluruh campaign armada untuk halaman Campaign, dari `store.users` yang sudah dilanggan.
 *
 * `id` membawa pemiliknya: satu campaign bisa tertinggal di dua profil selama ad account-nya
 * berpindah tangan, dan dua baris ber-key sama saling menimpa di React. Perintah saklar ikut di
 * barisnya karena ia tinggal di profil pemilik, bukan di campaign.
 */
export function fleetCampaignRows(users) {
  const rows = [];
  for (const user of Array.isArray(users) ? users : []) {
    if (!user || user.deletedAt) continue;
    const commands =
      user.campaignCommands && typeof user.campaignCommands === "object" ? user.campaignCommands : {};
    for (const row of normalizeCampaignRows(user.campaigns)) {
      rows.push({
        ...row,
        id: `${user.id}__${row.campaignId || row.id}`,
        userId: user.id,
        owner: user.name || user.email || "-",
        command: commands[row.campaignId] || null,
      });
    }
  }
  return rows;
}
```

- [ ] **Step 4: Buat `src/components/campaigns/CampaignStatusCell.jsx`** — isi `CampaignStatusCell` dan `describeCampaignStatus` dipindah apa adanya dari `UserDetail.jsx` baris 1485–1555:

```jsx
import { campaignToggleState } from "../../lib/campaignCommands";
import { getCampaignTone } from "../../lib/campaignTone";
import { formatDateTime } from "../../lib/formatDate";

/**
 * Kolom Status: saklar on/off di sebelah label statusnya. Dipakai profil user DAN halaman Campaign.
 *
 * Ketiga labelnya sepakat dengan saklar — saklar On berbunyi "Aktif" atau "Terjadwal", saklar Off
 * berbunyi "Tidak aktif" — jadi yang ditambahkan pil di sebelah saklar tinggal satu hal, dan itu
 * hal yang tidak bisa ditunjukkan saklar dua posisi: campaign yang menyala tapi tayangnya belum
 * mulai. Keduanya tetap dibaca dari field yang berbeda (`configuredStatus` vs `status` yang ditulis
 * sisi sync), dan saklar tidak pernah membaca labelnya — lihat `campaignToggleState`.
 */
export function CampaignStatusCell({ item, command, canToggle, onToggle }) {
  const label = item.status || "Tidak diketahui";

  // Yang tidak berhak menekan tidak diberi tombol mati sama sekali, melainkan kolom Status seperti
  // sebelum fitur ini ada.
  if (!canToggle || !onToggle) {
    return <span className={`campaign-delivery-badge ${getCampaignTone(label)}`}>{label}</span>;
  }

  const state = campaignToggleState(item, command, { canToggle: true });
  const note = describeCampaignStatus(item, state);

  return (
    <div className="campaign-status-cell">
      <button
        aria-checked={state.on}
        aria-label={`${state.on ? "Matikan" : "Nyalakan"} campaign ${item.campaign}`}
        className={`campaign-switch${state.on ? " on" : ""}${state.pending ? " pending" : ""}`}
        disabled={state.disabled}
        onClick={() => onToggle?.(item, !state.on)}
        role="switch"
        title={state.reason || label}
        type="button"
      >
        <span className="campaign-switch-knob" />
      </button>
      <div className="campaign-status-text">
        <span className={`campaign-delivery-badge ${getCampaignTone(label)}`}>{label}</span>
        {note && <small className="muted-line">{note}</small>}
      </div>
    </div>
  );
}

function describeCampaignStatus(item, state) {
  if (state.pending || state.disabled) return state.reason;
  if (state.failed) return `Gagal: ${state.reason}`;
  // Label di sebelahnya berasal dari perintah tadi, bukan dari laporan Meta. Sampai sync berikutnya
  // membacanya ulang, keadaan yang sebenarnya bisa berbeda.
  if (item.statusAppliedAt) {
    return `Diubah dari sini ${formatDateTime(item.statusAppliedAt)}, status akhir menyusul saat sync.`;
  }
  // Pil "Terjadwal" yang tidak menyebut KAPAN cuma memindahkan pertanyaannya ke Ads Manager.
  if (item.status === "Terjadwal" && item.startTime) {
    return `Mulai tayang ${formatDateTime(item.startTime)}.`;
  }
  return "";
}
```

- [ ] **Step 5: Ubah `UserDetail.jsx`**

1. Hapus `function normalizeCampaignRows` (baris 1447–1480) dan blok baris 1482–1573 (komentar "Why this campaign points…", `CampaignStatusCell`, `describeCampaignStatus`, `describeMappingSource`).
2. Baris 13 jadi `import { toCommandMap } from "../lib/campaignCommands";`.
3. Tambahkan import:

```jsx
import { describeMappingSource, normalizeCampaignRows } from "../lib/campaignRows";
import { CampaignStatusCell } from "./campaigns/CampaignStatusCell";
```

4. Run: `npx biome check --write src/components/UserDetail.jsx src/lib/campaignRows.js src/lib/campaignRows.test.mjs src/components/campaigns/CampaignStatusCell.jsx`
   Expected: tidak ada error. Kalau biome melaporkan import tak terpakai di `UserDetail.jsx` (mis. `formatDateTime` atau `firstValue` yang cuma dipakai fungsi yang dipindah), hapus import itu lalu jalankan ulang.

- [ ] **Step 6: Jalankan, pastikan lolos**

Run: `npm test`
Expected: PASS.

Run: `npm run build`
Expected: build sukses.

- [ ] **Step 7: Commit**

```bash
git add src/lib/campaignRows.js src/lib/campaignRows.test.mjs src/components/campaigns/CampaignStatusCell.jsx src/components/UserDetail.jsx
git commit -m "refactor(campaign): baris campaign dan sel status keluar dari UserDetail"
```

---

### Task 13: Frontend — menu, izin, dan route `/campaigns`

**Files:**
- Modify: `src/config/navigation.js:196` (sesudah Ad Accounts)
- Modify: `src/config/access.js:153-160` (`SUPERADMIN_PAGES`)
- Modify: `src/routes/resolveRoute.js` (sebelum blok `/otp`)
- Modify: `src/components/layout/DashboardShell.jsx` (import + `navIcons`)
- Test: `src/config/navigation.test.mjs:24`, `src/config/access.test.mjs` (sesudah tes "plugin cuma superadmin"), `src/routes/resolveRoute.test.mjs`

**Interfaces:**
- Produces: route `{ kind: "campaigns", key: "campaigns" }`; `"campaigns"` di `SUPERADMIN_PAGES`. Halamannya dirender `main.jsx` di Task 15; sampai itu, `/campaigns` berisi kepala dashboard tanpa isi untuk superadmin dan "Akses ditolak" untuk yang lain.

- [ ] **Step 1: Tulis tes yang gagal**

`src/config/navigation.test.mjs` baris 24: `assert.equal(rows.length, 17);`

`src/config/access.test.mjs`, sesudah tes `plugin cuma superadmin — admin ikut ditolak`:

```js
  test("halaman Campaign cuma superadmin — admin ikut ditolak", () => {
    // Yang menegakkannya gerbang `requireSuperAdmin` di server/campaign-manage.js; daftar ini menjaga
    // menu dan halamannya. Halaman itu menyalin campaign dan menaikkan anggaran iklan yang hidup.
    assert.equal(canReadResource("superadmin", "campaigns"), true);
    assert.equal(canReadResource("admin", "campaigns"), false);
    assert.equal(canReadResource("keuangan", "campaigns"), false);
    assert.equal(canReadResource("advertiser", "campaigns"), false);
    assert.equal(accessDeniedReason("campaigns"), "Halaman ini hanya untuk superadmin.");
  });
```

`src/routes/resolveRoute.test.mjs`, di akhir:

```js
// `key` inilah yang membuat alamat yang diketik tangan ditolak untuk selain superadmin.
test("halaman Campaign membawa kunci aksesnya sendiri", () => {
  assert.deepEqual(resolveRoute("/campaigns", resources), { kind: "campaigns", key: "campaigns" });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `node --test src/config/navigation.test.mjs src/config/access.test.mjs src/routes/resolveRoute.test.mjs`
Expected: FAIL pada ketiga tes baru.

- [ ] **Step 3: Menu** — `src/config/navigation.js`, tepat sesudah baris Ad Accounts:

```js
  // Superadmin saja (SUPERADMIN_PAGES). Barisnya sendiri, bukan tab di bawah Ad Accounts: isinya
  // meja kerja atas campaign seluruh armada — salin, anggaran, targeting — bukan daftar akun.
  { path: "/campaigns", label: "Campaign", key: "campaigns", group: "Aset" },
```

- [ ] **Step 4: Izin** — `src/config/access.js`, tambahkan `"campaigns",` ke `SUPERADMIN_PAGES` dan satu paragraf di komentar di atasnya:

```js
// "campaigns" berdiri di sini karena TOMBOLNYA, sekelas "plugin" dan "dnsRecords": halaman itu
// menyalin campaign Meta dan menaikkan anggaran iklan yang sedang hidup. Yang benar-benar
// menegakkannya gerbang `requireSuperAdmin` di server/campaign-manage.js.
```

- [ ] **Step 5: Route** — `src/routes/resolveRoute.js`, sebelum `if (path === "/otp")`:

```js
  // Bukan salah satu `resources`: halaman armada campaign membaca `users/*/campaigns` yang sudah
  // dilanggan store dan menulis ke Meta lewat server kontrol. `key` diisi supaya gerbang izin di
  // App bekerja — "campaigns" ada di SUPERADMIN_PAGES, dan tanpa key halaman superadmin ini terbuka
  // untuk siapa saja yang mengetik alamatnya.
  if (path === "/campaigns") {
    return { kind: "campaigns", key: "campaigns" };
  }
```

- [ ] **Step 6: Ikon** — `src/components/layout/DashboardShell.jsx`: tambahkan `Megaphone,` ke import `lucide-react` (sesudah `LogOut,`) dan `campaigns: Megaphone,` ke `navIcons` (sesudah `adAccounts: Smartphone,`).

Run: `node --test src/config/navigation.test.mjs src/config/access.test.mjs src/routes/resolveRoute.test.mjs`
Expected: PASS.

- [ ] **Step 7: Lint, build, dan commit**

Run: `npx biome check --write src/config/navigation.js src/config/access.js src/routes/resolveRoute.js src/components/layout/DashboardShell.jsx src/config/navigation.test.mjs src/config/access.test.mjs src/routes/resolveRoute.test.mjs`

Run: `npm test && npm run build`
Expected: PASS dan build sukses.

```bash
git add src/config/navigation.js src/config/access.js src/routes/resolveRoute.js src/components/layout/DashboardShell.jsx src/config/navigation.test.mjs src/config/access.test.mjs src/routes/resolveRoute.test.mjs
git commit -m "feat(campaign): menu, izin superadmin, dan route halaman Campaign"
```

---

### Task 14: Frontend — aturan tampilan, dialog salin/ubah, tombol Ubah di panel ad set

**Files:**
- Create: `src/lib/campaignFleet.js`
- Create: `src/components/campaigns/CampaignDialogs.jsx`
- Modify: `src/components/CampaignAdSets.jsx` (prop `onEdit`)
- Modify: `src/styles.css` (tambah di akhir)
- Test: `src/lib/campaignFleet.test.mjs`

**Interfaces:**
- Consumes: Task 11 (`copyCampaignNow`, `fetchCampaignEdit`, `updateCampaignNow`, `fetchAdSetEdit`, `updateAdSetNow`, `ControlApiError.body`), Task 12 (bentuk baris: `userId`, `campaignId`, `campaign`, `account`, `subDomain`, `status`, `configuredStatus`, `campaignCode`).
- Produces:
  - `UNMAPPED_FILTER = "-"`
  - `filterFleetRows(rows, { q, owner, account, subDomain, status }) => row[]`
  - `fleetFilterOptions(rows) => { owners: {value,label}[], accounts: string[], subDomains: string[], statuses: string[] }`
  - `sortFleetRows(rows) => row[]` (saklar On dulu, lalu nama)
  - `copyJobRows(jobs) => job[]` (terbaru dulu; tiap job: `id, state, label, tone, sourceCampaignId, sourceName, names, count, born, renameErrors, error, mode, requestedBy, requestedAt`)
  - `copyJobNote(job) => string`, `runningCopyFor(jobs, campaignId) => boolean`
  - `countryLabel(code)`, `parseCountryInput(text) => string[]`, `sameCountries(a, b)`, `formatIdr(amount)`, `budgetChangeNote(before, after)`
  - `<CopyCampaignDialog row onClose />`, `<EditCampaignDialog row onClose />`, `<EditAdSetDialog row adSet onClose onSaved />`
  - `<CampaignAdSets ... onEdit? />` — kalau diberikan, tiap baris ad set punya tombol Ubah yang memanggil `onEdit(adSetRow)`.

- [ ] **Step 1: Tulis tes yang gagal** — `src/lib/campaignFleet.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import {
  budgetChangeNote,
  copyJobNote,
  copyJobRows,
  countryLabel,
  filterFleetRows,
  fleetFilterOptions,
  parseCountryInput,
  runningCopyFor,
  sameCountries,
  sortFleetRows,
  UNMAPPED_FILTER,
} from "./campaignFleet.js";

const ROWS = [
  { userId: "u1", owner: "Nurjaman", campaign: "TvH1-06 Pros", campaignCode: "tvh1", account: "TBZ 1247", subDomain: "puppy.petcins.com", status: "Aktif", configuredStatus: "ACTIVE" },
  { userId: "u2", owner: "Aldi", campaign: "Tanpa kode", campaignCode: "", account: "Lincah", subDomain: "", status: "Tidak aktif", configuredStatus: "PAUSED" },
  { userId: "u1", owner: "Nurjaman", campaign: "5rx7-01", campaignCode: "5rx7", account: "TBZ 1247", subDomain: "dog.petcins.com", status: "Aktif", configuredStatus: "ACTIVE" },
];

test("penyaring armada: nama/kode, pemilik, akun, subdomain, status", () => {
  assert.equal(filterFleetRows(ROWS, { q: "TVH1" }).length, 1);
  assert.equal(filterFleetRows(ROWS, { owner: "u1" }).length, 2);
  assert.equal(filterFleetRows(ROWS, { account: "Lincah" }).length, 1);
  assert.deepEqual(filterFleetRows(ROWS, { subDomain: UNMAPPED_FILTER }).map((row) => row.campaign), ["Tanpa kode"]);
  assert.equal(filterFleetRows(ROWS, { subDomain: "dog.petcins.com" }).length, 1);
  assert.equal(filterFleetRows(ROWS, { status: "Aktif" }).length, 2);
  assert.equal(filterFleetRows(ROWS, {}).length, 3);
});

test("pilihan penyaring diambil dari baris yang ada", () => {
  const options = fleetFilterOptions(ROWS);
  assert.deepEqual(options.owners, [
    { value: "u2", label: "Aldi" },
    { value: "u1", label: "Nurjaman" },
  ]);
  assert.deepEqual(options.accounts, ["Lincah", "TBZ 1247"]);
  assert.deepEqual(options.subDomains, ["dog.petcins.com", "puppy.petcins.com"]);
  assert.deepEqual(options.statuses, ["Aktif", "Tidak aktif"]);
});

test("urutan: saklar On dulu, lalu nama", () => {
  assert.deepEqual(sortFleetRows(ROWS).map((row) => row.campaign), ["5rx7-01", "TvH1-06 Pros", "Tanpa kode"]);
});

test("baris job: terbaru dulu, label dan jumlah yang lahir", () => {
  const rows = copyJobRows({
    ja: { state: "done", sourceCampaignId: "1", sourceName: "A", names: ["A2"], count: 1, copies: [{ campaignId: "9", renameError: "x" }], requestedAt: "2026-09-10T00:00:00.000Z" },
    jb: { state: "running", mode: "async", sourceCampaignId: "2", sourceName: "B", names: { 0: "B #1", 1: "B #2" }, count: 2, requestedAt: "2026-09-11T00:00:00.000Z" },
  });
  assert.deepEqual(rows.map((row) => row.id), ["jb", "ja"]);
  assert.equal(rows[0].label, "Berjalan");
  assert.equal(rows[0].tone, "info");
  assert.deepEqual(rows[0].names, ["B #1", "B #2"]);
  assert.equal(rows[1].born, 1);
  assert.equal(rows[1].renameErrors, 1);
  assert.equal(copyJobNote(rows[0]), "Meta sedang menyalin di antrean asinkron.");
  assert.match(copyJobNote(rows[1]), /belum berganti nama/);
  assert.equal(runningCopyFor(rows, "2"), true);
  assert.equal(runningCopyFor(rows, "1"), false);
  assert.deepEqual(copyJobRows(null), []);
});

test("negara: teks berkoma jadi kode, urutan tidak dianggap perubahan", () => {
  assert.deepEqual(parseCountryInput("tr, mx  MX"), ["TR", "MX"]);
  assert.equal(sameCountries(["TR", "MX"], ["MX", "TR"]), true);
  assert.equal(sameCountries(["TR"], ["TR", "MX"]), false);
  assert.notEqual(countryLabel("TR"), "TR", "nama negara dibaca lewat Intl.DisplayNames");
  assert.equal(countryLabel("12"), "12", "kode tidak sah dikembalikan apa adanya");
});

test("catatan perubahan anggaran menyebut lama, baru, dan persennya", () => {
  assert.equal(budgetChangeNote(50000, 75000), "Rp 50.000 → Rp 75.000 (+50%)");
  assert.equal(budgetChangeNote(80000, 60000), "Rp 80.000 → Rp 60.000 (-25%)");
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `node --test src/lib/campaignFleet.test.mjs`
Expected: FAIL, modul tidak ditemukan.

- [ ] **Step 3: Buat `src/lib/campaignFleet.js`**

```js
/**
 * Aturan tampilan halaman Campaign (/campaigns) dan dialognya. Murni.
 *
 * Aturan yang MEMUTUSKAN sesuatu (nama boleh atau tidak, targeting bisa diedit atau tidak) tidak
 * tinggal di sini melainkan di server (functions/campaign-manage-core.js): salinan kedua dari aturan
 * yang menolak akan berselisih suatu hari, dan yang lebih longgar menang tanpa berbunyi. Dialog
 * mengirim lalu menggambar penolakan server apa adanya.
 */

export const UNMAPPED_FILTER = "-";
const ACTIVE_JOB = new Set(["requested", "running"]);
const byText = (a, b) => String(a).localeCompare(String(b), "id-ID", { numeric: true });

export function filterFleetRows(rows, { q = "", owner = "", account = "", subDomain = "", status = "" } = {}) {
  const term = String(q).trim().toLowerCase();
  return rows.filter((row) => {
    if (term && !`${row.campaign || ""} ${row.campaignCode || ""}`.toLowerCase().includes(term)) return false;
    if (owner && row.userId !== owner) return false;
    if (account && row.account !== account) return false;
    if (subDomain === UNMAPPED_FILTER) {
      if (row.subDomain) return false;
    } else if (subDomain && row.subDomain !== subDomain) {
      return false;
    }
    if (status && row.status !== status) return false;
    return true;
  });
}

// Diambil dari baris yang ADA, supaya pilihan yang ditawarkan tidak pernah mengosongkan tabel.
export function fleetFilterOptions(rows) {
  const owners = new Map();
  const accounts = new Set();
  const subDomains = new Set();
  const statuses = new Set();
  for (const row of rows) {
    owners.set(row.userId, row.owner);
    if (row.account && row.account !== "-") accounts.add(row.account);
    if (row.subDomain) subDomains.add(row.subDomain);
    if (row.status) statuses.add(row.status);
  }
  return {
    owners: [...owners].map(([value, label]) => ({ value, label })).sort((a, b) => byText(a.label, b.label)),
    accounts: [...accounts].sort(byText),
    subDomains: [...subDomains].sort(byText),
    statuses: [...statuses].sort(byText),
  };
}

// Posisi SAKLAR, bukan label: "Terjadwal" dan "Aktif" sama-sama On.
export function sortFleetRows(rows) {
  const rank = (row) => (row.configuredStatus === "ACTIVE" ? 0 : row.configuredStatus === "PAUSED" ? 1 : 2);
  return [...rows].sort((a, b) => rank(a) - rank(b) || byText(a.campaign || "", b.campaign || ""));
}

const JOB_LABELS = {
  requested: ["Berjalan", "info"],
  running: ["Berjalan", "info"],
  done: ["Selesai", "success"],
  partial: ["Sebagian", "warning"],
  unknown: ["Tidak diketahui", "warning"],
  failed: ["Gagal", "danger"],
};

function listOf(value) {
  if (!value) return [];
  return (Array.isArray(value) ? value : Object.values(value)).filter((item) => item !== null && item !== undefined);
}

export function copyJobRows(jobs) {
  const entries = jobs && typeof jobs === "object" ? Object.entries(jobs) : [];
  return entries
    .map(([id, job]) => {
      const copies = listOf(job?.copies);
      const names = listOf(job?.names);
      const [label, tone] = JOB_LABELS[job?.state] || JOB_LABELS.unknown;
      return {
        id,
        state: job?.state || "",
        label,
        tone,
        sourceCampaignId: String(job?.sourceCampaignId || ""),
        sourceName: job?.sourceName || "",
        names,
        count: Number(job?.count) || names.length,
        born: copies.filter((copy) => copy?.campaignId).length,
        renameErrors: copies.filter((copy) => copy?.renameError).length,
        error: job?.error || "",
        mode: job?.mode || "",
        requestedBy: job?.requestedBy || "",
        requestedAt: job?.requestedAt || "",
      };
    })
    .sort((a, b) => byText(b.requestedAt, a.requestedAt));
}

export function copyJobNote(job) {
  if (ACTIVE_JOB.has(job.state)) {
    return job.mode === "async" ? "Meta sedang menyalin di antrean asinkron." : "Sedang disalin.";
  }
  if (job.state === "done") {
    return job.renameErrors ? `${job.renameErrors} salinan belum berganti nama — ubah lewat tombol Ubah.` : "";
  }
  return job.error;
}

export function runningCopyFor(jobs, campaignId) {
  return jobs.some((job) => ACTIVE_JOB.has(job.state) && job.sourceCampaignId === String(campaignId));
}

const regionNames =
  typeof Intl !== "undefined" && typeof Intl.DisplayNames === "function"
    ? new Intl.DisplayNames(["id"], { type: "region" })
    : null;

export function countryLabel(code) {
  try {
    return regionNames?.of(code) || code;
  } catch {
    return code;
  }
}

export function parseCountryInput(text) {
  return [
    ...new Set(
      String(text || "")
        .split(/[\s,]+/)
        .map((code) => code.trim().toUpperCase())
        .filter(Boolean),
    ),
  ];
}

export function sameCountries(a, b) {
  const key = (list) => [...list].map(String).sort().join(",");
  return key(a) === key(b);
}

export function formatIdr(amount) {
  return `Rp ${Math.round(Number(amount) || 0).toLocaleString("id-ID")}`;
}

export function budgetChangeNote(before, after) {
  const from = Number(before);
  const to = Number(after);
  if (!(from > 0)) return formatIdr(to);
  const percent = ((to - from) / from) * 100;
  const sign = percent > 0 ? "+" : "";
  return `${formatIdr(from)} → ${formatIdr(to)} (${sign}${percent.toLocaleString("id-ID", { maximumFractionDigits: 1 })}%)`;
}
```

- [ ] **Step 4: Jalankan, pastikan lolos**

Run: `node --test src/lib/campaignFleet.test.mjs`
Expected: PASS.

- [ ] **Step 5: Buat `src/components/campaigns/CampaignDialogs.jsx`**

```jsx
import { TriangleAlert, X } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { budgetChangeNote, countryLabel, parseCountryInput, sameCountries } from "../../lib/campaignFleet";
import {
  copyCampaignNow,
  fetchAdSetEdit,
  fetchCampaignEdit,
  updateAdSetNow,
  updateCampaignNow,
} from "../../lib/controlApi";
import { notifySuccess } from "../../lib/notify";
import { ColumnHint } from "../ui/ColumnHint";

const MAX_COPIES = 5;

function DialogShell({ title, subtitle, busy, onClose, children }) {
  return createPortal(
    <div className="modal-backdrop" role="presentation">
      <div aria-modal="true" className="confirm-dialog campaign-dialog" role="dialog">
        <header className="plugin-dialog-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button aria-label="Tutup" className="ghost-button icon-button" disabled={busy} onClick={onClose} type="button">
            <X size={16} />
          </button>
        </header>
        {children}
      </div>
    </div>,
    document.body,
  );
}

// Keterangan DEFINISI field tinggal di ikon info, sepola form plugin; keadaan yang berubah tetap teks.
function Field({ id, label, hint, children }) {
  return (
    <div className="campaign-field">
      <span className="campaign-label">
        <label htmlFor={id}>{label}</label>
        {hint && <ColumnHint icon="info" text={hint} />}
      </span>
      {children}
    </div>
  );
}

function Alert({ children }) {
  return (
    <p className="plugin-alert">
      <TriangleAlert size={15} />
      <span>{children}</span>
    </p>
  );
}

/**
 * Kirim satu tulisan. Penolakan server tetap di DALAM dialog (bukan toast yang hilang sendiri), dan
 * jawaban 409 ber-`needsConfirm` berubah jadi pertanyaan — subdomain yang ditanyakan adalah yang
 * diputuskan server, bukan tebakan dari kalimat error.
 */
function useSubmit(onDone) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmSubDomain, setConfirmSubDomain] = useState("");
  const run = async (task) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await task();
      onDone();
    } catch (err) {
      if (err?.body?.needsConfirm) {
        setConfirmSubDomain(err.body.subDomain || "");
      } else {
        setConfirmSubDomain("");
        setError(err.message);
      }
      setBusy(false);
    }
  };
  return { busy, error, confirmSubDomain, setConfirmSubDomain, run };
}

function MappingConfirm({ subDomain, busy, action, onBack, onConfirm }) {
  return (
    <div className="campaign-review">
      <p>
        Nama ini memetakan belanja campaign ke <strong>{subDomain}</strong>. Link iklan tidak ikut
        berubah — pastikan iklannya memang mengarah ke sana.
      </p>
      <div className="confirm-actions">
        <button className="ghost-button" disabled={busy} onClick={onBack} type="button">
          Kembali
        </button>
        <button className="primary-button" disabled={busy} onClick={onConfirm} type="button">
          {busy ? "Mengirim..." : action}
        </button>
      </div>
    </div>
  );
}

function ChangeReview({ lines, busy, error, onBack, onConfirm }) {
  return (
    <div className="campaign-review">
      <ul>
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p>Perubahan besar pada anggaran atau targeting mengulang fase pembelajaran Meta.</p>
      {error && <Alert>{error}</Alert>}
      <div className="confirm-actions">
        <button className="ghost-button" disabled={busy} onClick={onBack} type="button">
          Kembali
        </button>
        <button className="primary-button" disabled={busy} onClick={onConfirm} type="button">
          {busy ? "Menyimpan..." : "Ya, simpan"}
        </button>
      </div>
    </div>
  );
}

// Nilai segar dari Meta saat dialog dibuka — bukan cermin RTDB.
function useFresh(load, deps) {
  const [state, setState] = useState({ loading: true, error: "", data: null });
  useEffect(() => {
    let alive = true;
    load()
      .then((data) => alive && setState({ loading: false, error: "", data }))
      .catch((error) => alive && setState({ loading: false, error: error.message, data: null }));
    return () => {
      alive = false;
    };
    // biome-ignore lint/correctness/useExhaustiveDependencies: `load` dibentuk ulang tiap render; yang menentukan pembacaan ulang adalah `deps`.
  }, deps);
  return state;
}

export function CopyCampaignDialog({ row, onClose }) {
  const ids = useId();
  const [name, setName] = useState(row.campaign || "");
  const [count, setCount] = useState(1);
  const submit = useSubmit(onClose);

  const send = (confirmSubDomain) =>
    submit.run(async () => {
      const result = await copyCampaignNow(row.userId, row.campaignId, { name, count, confirmSubDomain });
      notifySuccess(
        result.state === "running"
          ? "Salinan dikirim ke antrean Meta — progresnya ada di panel Salinan."
          : result.state === "partial"
            ? "Sebagian salinan dibuat — lihat panel Salinan."
            : "Salinan dibuat dalam keadaan mati (PAUSED).",
      );
    });

  return (
    <DialogShell busy={submit.busy} onClose={onClose} subtitle={row.campaign} title="Duplikasi campaign">
      {submit.confirmSubDomain ? (
        <MappingConfirm
          action="Ya, salin"
          busy={submit.busy}
          onBack={() => submit.setConfirmSubDomain("")}
          onConfirm={() => send(submit.confirmSubDomain)}
          subDomain={submit.confirmSubDomain}
        />
      ) : (
        <form
          className="campaign-form"
          onSubmit={(event) => {
            event.preventDefault();
            send();
          }}
        >
          <Field
            hint="Wajib membawa kode Keitaro subdomain yang sama dengan campaign sumber — kode itulah yang memetakan belanjanya."
            id={`${ids}-name`}
            label="Nama salinan"
          >
            <input
              className="control"
              disabled={submit.busy}
              id={`${ids}-name`}
              maxLength={400}
              onChange={(event) => setName(event.target.value)}
              value={name}
            />
          </Field>
          <Field hint="Lebih dari satu salinan diberi akhiran #1, #2, dan seterusnya." id={`${ids}-count`} label="Jumlah salinan">
            <select
              className="control"
              disabled={submit.busy}
              id={`${ids}-count`}
              onChange={(event) => setCount(Number(event.target.value))}
              value={count}
            >
              {Array.from({ length: MAX_COPIES }, (_, index) => index + 1).map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </Field>
          <p className="adset-note">
            Ad set dan iklan ikut disalin. Salinan lahir mati (PAUSED): ubah anggaran dan targetingnya
            dulu, lalu nyalakan lewat saklar.
          </p>
          {submit.error && <Alert>{submit.error}</Alert>}
          <div className="confirm-actions">
            <button className="ghost-button" disabled={submit.busy} onClick={onClose} type="button">
              Batal
            </button>
            <button className="primary-button" disabled={submit.busy || !name.trim()} type="submit">
              {submit.busy ? "Menyalin..." : "Salin"}
            </button>
          </div>
        </form>
      )}
    </DialogShell>
  );
}

export function EditCampaignDialog({ row, onClose }) {
  const ids = useId();
  const fresh = useFresh(() => fetchCampaignEdit(row.userId, row.campaignId), [row.userId, row.campaignId]);
  const campaign = fresh.data?.campaign;
  const [name, setName] = useState(null);
  const [budget, setBudget] = useState(null);
  const [review, setReview] = useState(false);
  const submit = useSubmit(onClose);

  // Kotak diisi dari bacaan segar sampai orangnya mengetik (`null` = belum disentuh).
  const nameValue = name ?? campaign?.name ?? "";
  const budgetValue = budget ?? campaign?.dailyBudget ?? "";

  const changes = {};
  if (campaign && nameValue.trim() && nameValue.trim() !== campaign.name) changes.name = nameValue.trim();
  if (campaign?.budget.editable && String(budgetValue) !== String(campaign.dailyBudget)) {
    changes.dailyBudget = Number(budgetValue);
  }
  const changed = Object.keys(changes).length > 0;

  const send = (confirmSubDomain) =>
    submit.run(async () => {
      await updateCampaignNow(row.userId, row.campaignId, { ...changes, confirmSubDomain });
      notifySuccess(
        changes.name
          ? "Tersimpan di Meta. Nama baru tampil di tabel sesudah sync akun ini."
          : "Anggaran tersimpan di Meta.",
      );
    });

  let body;
  if (fresh.loading) {
    body = <p className="adset-note">Membaca campaign dari Meta…</p>;
  } else if (fresh.error) {
    body = <Alert>{fresh.error}</Alert>;
  } else if (submit.confirmSubDomain) {
    body = (
      <MappingConfirm
        action="Ya, simpan"
        busy={submit.busy}
        onBack={() => submit.setConfirmSubDomain("")}
        onConfirm={() => send(submit.confirmSubDomain)}
        subDomain={submit.confirmSubDomain}
      />
    );
  } else if (review) {
    body = (
      <ChangeReview
        busy={submit.busy}
        error={submit.error}
        lines={[`Anggaran harian: ${budgetChangeNote(campaign.dailyBudget, changes.dailyBudget)}`]}
        onBack={() => setReview(false)}
        onConfirm={() => send()}
      />
    );
  } else {
    body = (
      <form
        className="campaign-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!changed) return;
          if (changes.dailyBudget !== undefined) setReview(true);
          else send();
        }}
      >
        <Field
          hint="Nama campaign adalah pemetaannya: kode Keitaro pertama di nama menentukan subdomain yang menerima belanjanya."
          id={`${ids}-name`}
          label="Nama campaign"
        >
          <input
            className="control"
            disabled={submit.busy}
            id={`${ids}-name`}
            maxLength={400}
            onChange={(event) => setName(event.target.value)}
            value={nameValue}
          />
        </Field>
        <Field id={`${ids}-budget`} label="Anggaran harian">
          {campaign.budget.editable ? (
            <input
              className="control"
              disabled={submit.busy}
              id={`${ids}-budget`}
              min="1"
              onChange={(event) => setBudget(event.target.value)}
              type="number"
              value={budgetValue}
            />
          ) : (
            <p className="adset-note">{campaign.budget.reason}</p>
          )}
        </Field>
        {submit.error && <Alert>{submit.error}</Alert>}
        <div className="confirm-actions">
          <button className="ghost-button" disabled={submit.busy} onClick={onClose} type="button">
            Batal
          </button>
          <button className="primary-button" disabled={submit.busy || !changed} type="submit">
            {submit.busy ? "Menyimpan..." : "Simpan"}
          </button>
        </div>
      </form>
    );
  }

  return (
    <DialogShell busy={submit.busy} onClose={onClose} subtitle={row.campaign} title="Ubah campaign">
      {body}
    </DialogShell>
  );
}

export function EditAdSetDialog({ row, adSet, onClose, onSaved }) {
  const ids = useId();
  const fresh = useFresh(
    () => fetchAdSetEdit(row.userId, row.campaignId, adSet.id),
    [row.userId, row.campaignId, adSet.id],
  );
  const current = fresh.data?.adSet;
  const targeting = current?.targeting;
  const [name, setName] = useState(null);
  const [budget, setBudget] = useState(null);
  const [countriesText, setCountriesText] = useState(null);
  const [ageMin, setAgeMin] = useState(null);
  const [ageMax, setAgeMax] = useState(null);
  const [review, setReview] = useState(false);
  const submit = useSubmit(() => {
    onSaved?.();
    onClose();
  });

  const nameValue = name ?? current?.name ?? "";
  const budgetValue = budget ?? current?.dailyBudget ?? "";
  const countriesValue = countriesText ?? (targeting?.countries || []).join(", ");
  const ageMinValue = ageMin ?? targeting?.ageMin ?? 18;
  const ageMaxValue = ageMax ?? targeting?.ageMax ?? 65;
  const countries = parseCountryInput(countriesValue);

  const changes = {};
  const lines = [];
  if (current && nameValue.trim() && nameValue.trim() !== current.name) changes.name = nameValue.trim();
  if (current?.budget.editable && String(budgetValue) !== String(current.dailyBudget)) {
    changes.dailyBudget = Number(budgetValue);
    lines.push(`Anggaran harian: ${budgetChangeNote(current.dailyBudget, changes.dailyBudget)}`);
  }
  if (targeting?.editable) {
    if (!sameCountries(countries, targeting.countries)) {
      changes.countries = countries;
      lines.push(`Negara: ${targeting.countries.join(", ")} → ${countries.join(", ") || "(kosong)"}`);
    }
    if (Number(ageMinValue) !== targeting.ageMin) changes.ageMin = Number(ageMinValue);
    if (Number(ageMaxValue) !== targeting.ageMax) changes.ageMax = Number(ageMaxValue);
    if (changes.ageMin !== undefined || changes.ageMax !== undefined) {
      lines.push(`Umur: ${targeting.ageMin}–${targeting.ageMax} → ${ageMinValue}–${ageMaxValue}`);
    }
  }
  const changed = Object.keys(changes).length > 0;

  const send = () =>
    submit.run(async () => {
      await updateAdSetNow(row.userId, row.campaignId, adSet.id, changes);
      notifySuccess("Ad set tersimpan di Meta.");
    });

  let body;
  if (fresh.loading) {
    body = <p className="adset-note">Membaca ad set dari Meta…</p>;
  } else if (fresh.error) {
    body = <Alert>{fresh.error}</Alert>;
  } else if (review) {
    body = (
      <ChangeReview busy={submit.busy} error={submit.error} lines={lines} onBack={() => setReview(false)} onConfirm={send} />
    );
  } else {
    body = (
      <form
        className="campaign-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!changed) return;
          if (lines.length) setReview(true);
          else send();
        }}
      >
        <Field id={`${ids}-name`} label="Nama ad set">
          <input
            className="control"
            disabled={submit.busy}
            id={`${ids}-name`}
            maxLength={400}
            onChange={(event) => setName(event.target.value)}
            value={nameValue}
          />
        </Field>
        <Field id={`${ids}-budget`} label="Anggaran harian">
          {current.budget.editable ? (
            <input
              className="control"
              disabled={submit.busy}
              id={`${ids}-budget`}
              min="1"
              onChange={(event) => setBudget(event.target.value)}
              type="number"
              value={budgetValue}
            />
          ) : (
            <p className="adset-note">{current.budget.reason}</p>
          )}
        </Field>
        {targeting.editable ? (
          <>
            <Field hint="Kode ISO dua huruf, dipisah koma. Minat, penempatan, dan pengecualian tidak berubah." id={`${ids}-countries`} label="Negara">
              <input
                className="control"
                disabled={submit.busy}
                id={`${ids}-countries`}
                onChange={(event) => setCountriesText(event.target.value)}
                placeholder="TR, MX"
                value={countriesValue}
              />
              <small className="muted-line">{countries.map(countryLabel).join(", ") || "Belum ada negara."}</small>
            </Field>
            <div className="campaign-field-row">
              <Field id={`${ids}-age-min`} label="Umur minimum">
                <input
                  className="control"
                  disabled={submit.busy}
                  id={`${ids}-age-min`}
                  max="65"
                  min="18"
                  onChange={(event) => setAgeMin(event.target.value)}
                  type="number"
                  value={ageMinValue}
                />
              </Field>
              <Field id={`${ids}-age-max`} label="Umur maksimum">
                <input
                  className="control"
                  disabled={submit.busy}
                  id={`${ids}-age-max`}
                  max="65"
                  min="18"
                  onChange={(event) => setAgeMax(event.target.value)}
                  type="number"
                  value={ageMaxValue}
                />
              </Field>
            </div>
          </>
        ) : (
          <p className="adset-note">{targeting.reason}</p>
        )}
        {submit.error && <Alert>{submit.error}</Alert>}
        <div className="confirm-actions">
          <button className="ghost-button" disabled={submit.busy} onClick={onClose} type="button">
            Batal
          </button>
          <button className="primary-button" disabled={submit.busy || !changed} type="submit">
            {submit.busy ? "Menyimpan..." : "Simpan"}
          </button>
        </div>
      </form>
    );
  }

  return (
    <DialogShell busy={submit.busy} onClose={onClose} subtitle={adSet.name} title="Ubah ad set">
      {body}
    </DialogShell>
  );
}
```

- [ ] **Step 6: Tombol Ubah di panel ad set** — `src/components/CampaignAdSets.jsx`:

1. Import: `import { Pencil, RefreshCw } from "lucide-react";`
2. Tanda tangan: `export function CampaignAdSets({ userId, campaignId, canToggle = false, onEdit }) {`
3. Di `<thead>`, sesudah `<th className="right">CTR</th>`: `{onEdit && <th className="right">Aksi</th>}`
4. Di tiap baris, sesudah sel CTR:

```jsx
                  {/* Hanya di halaman Campaign (superadmin). Profil user tidak mengoper `onEdit`, jadi
                      kolomnya tidak ada di sana sama sekali. */}
                  {onEdit && (
                    <td className="right">
                      <button className="ghost-button adset-edit" onClick={() => onEdit(row)} type="button">
                        <Pencil size={13} />
                        Ubah
                      </button>
                    </td>
                  )}
```

- [ ] **Step 7: CSS** — tambahkan di akhir `src/styles.css`:

```css
/* Dialog halaman Campaign (src/components/campaigns/CampaignDialogs.jsx). Menumpang
   .confirm-dialog dan .plugin-dialog-head; yang berbeda cuma lebar dan susunan isiannya. */
.campaign-dialog {
  width: min(560px, 92vw);
}

.campaign-form {
  display: grid;
  gap: 14px;
}

.campaign-field {
  display: grid;
  gap: 6px;
}

.campaign-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--foreground);
  font-size: 13px;
  font-weight: 600;
}

.campaign-field-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.campaign-review {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-sunken);
  font-size: 13px;
}

.campaign-review ul {
  display: grid;
  gap: 4px;
  margin: 0;
  padding-left: 18px;
}

.adset-edit {
  min-height: 28px;
  gap: 4px;
  padding: 0 10px;
  font-size: 12px;
}
```

- [ ] **Step 8: Verifikasi**

Run: `npx biome check --write src/lib/campaignFleet.js src/lib/campaignFleet.test.mjs src/components/campaigns/CampaignDialogs.jsx src/components/CampaignAdSets.jsx src/styles.css`
Run: `npm test && npm run build`
Expected: PASS (termasuk `src/lib/styles.theme.test.mjs`) dan build sukses.

- [ ] **Step 9: Commit**

```bash
git add src/lib/campaignFleet.js src/lib/campaignFleet.test.mjs src/components/campaigns/CampaignDialogs.jsx src/components/CampaignAdSets.jsx src/styles.css
git commit -m "feat(campaign): dialog salin dan ubah campaign/ad set"
```

---

### Task 15: Frontend — halaman armada `/campaigns`

**Files:**
- Create: `src/components/campaigns/CampaignFleet.jsx`
- Modify: `src/main.jsx` (lazy import sesudah `DnsRecords`; render sesudah `dnsRecords`)
- Modify: `src/styles.css` (tambah di akhir)

**Interfaces:**
- Consumes: Task 11 (`store.campaignCopyJobs`), Task 12 (`fleetCampaignRows`, `describeMappingSource`, `CampaignStatusCell`), Task 13 (route), Task 14 (penyaring, job, dialog, `CampaignAdSets onEdit`).
- Produces: `<CampaignFleet store navigate onToggleCampaign(row, active) />`.

Tidak ada unit test untuk komponen (sepola halaman lain di repo ini); seluruh keputusannya sudah diuji di `campaignFleet.test.mjs` dan `campaignRows.test.mjs`. Verifikasinya build + pemeriksaan di browser.

- [ ] **Step 1: Buat `src/components/campaigns/CampaignFleet.jsx`**

```jsx
import { ChevronDown, ChevronRight, Copy, Pencil, TriangleAlert } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { useTablePagination } from "../../hooks/useTablePagination";
import { useUrlState } from "../../hooks/useUrlState";
import { adSetCache, adSetCacheKey } from "../../lib/adSetCache";
import {
  copyJobNote,
  copyJobRows,
  filterFleetRows,
  fleetFilterOptions,
  runningCopyFor,
  sortFleetRows,
  UNMAPPED_FILTER,
} from "../../lib/campaignFleet";
import { describeMappingSource, fleetCampaignRows } from "../../lib/campaignRows";
import { CONTROL_API_ENABLED } from "../../lib/controlApi";
import { formatDateTime } from "../../lib/formatDate";
import { renderCell } from "../../lib/renderCell";
import { CampaignAdSets } from "../CampaignAdSets";
import { PageHeader } from "../ui/PageHeader";
import { TablePagination } from "../ui/TablePagination";
import { CopyCampaignDialog, EditAdSetDialog, EditCampaignDialog } from "./CampaignDialogs";
import { CampaignStatusCell } from "./CampaignStatusCell";

/**
 * Halaman Campaign — campaign seluruh armada, disalin dan diubah dari satu tempat. SUPERADMIN.
 *
 * Tabelnya dari `users/*/campaigns` yang sudah dilanggan store, jadi tidak ada unduhan baru.
 * Tulisannya lewat server kontrol (server/campaign-manage.js); tanpa server itu tombolnya tidak
 * digambar, sepola /plugin, dan tabel serta panel Salinan tetap terbaca dari database.
 *
 * Sub Domain di sini HANYA BACA: pemetaan manual tetap diubah di profil user, supaya tidak ada dua
 * tempat yang menulis field yang sama.
 */
export function CampaignFleet({ store, navigate, onToggleCampaign }) {
  const [q, setQ] = useUrlState("q", "");
  const [owner, setOwner] = useUrlState("pemilik", "");
  const [account, setAccount] = useUrlState("akun", "");
  const [subDomain, setSubDomain] = useUrlState("subdomain", "");
  const [status, setStatus] = useUrlState("status", "");
  const [openAdSets, setOpenAdSets] = useUrlState("adset", "");
  const [dialog, setDialog] = useState(null);
  // Naik tiap ad set berhasil diubah: panelnya dipasang ulang dan membaca ke Meta, bukan ditambal.
  const [adSetVersion, setAdSetVersion] = useState(0);

  const rows = useMemo(() => fleetCampaignRows(store.users), [store.users]);
  const options = useMemo(() => fleetFilterOptions(rows), [rows]);
  const visible = useMemo(
    () => sortFleetRows(filterFleetRows(rows, { q, owner, account, subDomain, status })),
    [rows, q, owner, account, subDomain, status],
  );
  const pagination = useTablePagination(visible);
  const jobs = useMemo(() => copyJobRows(store.campaignCopyJobs), [store.campaignCopyJobs]);
  const running = jobs.filter((job) => job.label === "Berjalan").length;
  const columnCount = CONTROL_API_ENABLED ? 5 : 4;

  const onFilter = (setter) => (event) => {
    setter(event.target.value);
    pagination.setPage(1);
  };
  const closeDialog = () => setDialog(null);

  return (
    <>
      <PageHeader title="Campaign" description="Salin dan kelola campaign Meta seluruh armada." />

      {!CONTROL_API_ENABLED && (
        <p className="plugin-alert plugin-alert-inline">
          <TriangleAlert size={15} />
          <span>
            Server kontrol belum dikonfigurasi, jadi campaign tidak bisa disalin atau diubah dari sini.
            Tabel di bawah tetap dibaca dari database.
          </span>
        </p>
      )}

      {jobs.length > 0 && (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Salinan</h2>
              <p>
                {running} berjalan · {jobs.length} dalam 7 hari terakhir
              </p>
            </div>
          </div>
          <div className="table-wrap">
            <table className="data-table fleet-jobs-table">
              <thead>
                <tr>
                  <th>Salinan</th>
                  <th>Status</th>
                  <th className="center">Lahir</th>
                  <th>Diminta</th>
                  <th className="right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => {
                  const note = copyJobNote(job);
                  return (
                    <tr key={job.id}>
                      <td>
                        <strong title={job.names.join(", ")}>
                          {job.names[0] || "-"}
                          {job.count > 1 ? ` (+${job.count - 1})` : ""}
                        </strong>
                        <small className="muted-line">dari {job.sourceName || "-"}</small>
                      </td>
                      <td>
                        <span className={`badge ${job.tone}`}>{job.label}</span>
                        {note && <small className="muted-line">{note}</small>}
                      </td>
                      <td className="center">
                        {job.born} dari {job.count}
                      </td>
                      <td>
                        {formatDateTime(job.requestedAt)}
                        <small className="muted-line">{job.requestedBy || "-"}</small>
                      </td>
                      <td className="right">
                        {job.born > 0 && (
                          <button
                            className="ghost-button adset-edit"
                            onClick={() => {
                              setQ(job.names[0].replace(/ #\d+$/, ""));
                              pagination.setPage(1);
                            }}
                            type="button"
                          >
                            Lihat di tabel
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="panel">
        <div className="toolbar">
          <div className="toolbar-filters fleet-filters">
            <input
              aria-label="Cari nama atau kode campaign"
              className="control search"
              onChange={onFilter(setQ)}
              placeholder="Cari nama atau kode campaign..."
              value={q}
            />
            <select aria-label="Filter pemilik" className="control" onChange={onFilter(setOwner)} value={owner}>
              <option value="">Semua pemilik</option>
              {options.owners.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
            <select aria-label="Filter ad account" className="control" onChange={onFilter(setAccount)} value={account}>
              <option value="">Semua ad account</option>
              {options.accounts.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
            <select aria-label="Filter subdomain" className="control" onChange={onFilter(setSubDomain)} value={subDomain}>
              <option value="">Semua subdomain</option>
              <option value={UNMAPPED_FILTER}>Belum dipetakan</option>
              {options.subDomains.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
            <select aria-label="Filter status" className="control" onChange={onFilter(setStatus)} value={status}>
              <option value="">Semua status</option>
              {options.statuses.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="table-wrap campaign-table-wrap">
          <table className="data-table campaign-table fleet-table">
            <thead>
              <tr>
                <th>Kampanye</th>
                <th>Sub Domain</th>
                <th>Status</th>
                <th className="right">Anggaran</th>
                {CONTROL_API_ENABLED && <th className="right">Aksi</th>}
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td className="empty" colSpan={columnCount}>
                    Tidak ada campaign yang cocok.
                  </td>
                </tr>
              ) : (
                pagination.visibleItems.map((row) => {
                  const open = Boolean(row.campaignId) && openAdSets === row.campaignId;
                  const writable = Boolean(row.campaignId) && !row.metaMissing;
                  const copying = runningCopyFor(jobs, row.campaignId);
                  const blocked = writable ? "" : "Campaign ini tidak punya alamat di Meta.";
                  return (
                    <Fragment key={row.id}>
                      <tr>
                        <td>
                          <div className="campaign-name-cell">
                            <button
                              aria-expanded={open}
                              aria-label={`${open ? "Tutup" : "Lihat"} ad set campaign ${row.campaign}`}
                              className="adset-toggle"
                              disabled={!row.campaignId}
                              onClick={() => setOpenAdSets(open ? "" : row.campaignId)}
                              title={
                                row.campaignId
                                  ? "Lihat ad set di dalam campaign ini"
                                  : "Baris ini tidak punya ID campaign di Meta, jadi ad set-nya tidak bisa diminta."
                              }
                              type="button"
                            >
                              {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            </button>
                            <div>
                              <strong title={row.campaign}>{row.campaign}</strong>
                              <span title={`Akun: ${row.account}`}>
                                {row.account} ·{" "}
                                <a
                                  href={`/users/${row.userId}`}
                                  onClick={(event) => {
                                    event.preventDefault();
                                    navigate(`/users/${row.userId}`);
                                  }}
                                >
                                  {row.owner}
                                </a>
                              </span>
                            </div>
                          </div>
                        </td>
                        <td>
                          <span>{row.subDomain || "-"}</span>
                          <small className="muted-line">{describeMappingSource(row)}</small>
                        </td>
                        <td>
                          <CampaignStatusCell canToggle command={row.command} item={row} onToggle={onToggleCampaign} />
                        </td>
                        <td className="right">
                          <strong>{renderCell(row.dailyBudget, "dailyBudget")}</strong>
                          <small className="muted-line">
                            {row.dailyBudget === "-" ? "Di ad set atau lifetime" : "Harian, di campaign"}
                          </small>
                        </td>
                        {CONTROL_API_ENABLED && (
                          <td className="right">
                            <div className="fleet-actions">
                              <button
                                className="ghost-button adset-edit"
                                disabled={!writable || copying}
                                onClick={() => setDialog({ type: "copy", row })}
                                title={blocked || (copying ? "Salinan campaign ini masih berjalan." : "Salin campaign berikut ad set dan iklannya")}
                                type="button"
                              >
                                <Copy size={13} />
                                Duplikasi
                              </button>
                              <button
                                className="ghost-button adset-edit"
                                disabled={!writable}
                                onClick={() => setDialog({ type: "campaign", row })}
                                title={blocked || "Ubah nama atau anggaran harian"}
                                type="button"
                              >
                                <Pencil size={13} />
                                Ubah
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                      {open && (
                        <tr className="adset-detail-row">
                          <td colSpan={columnCount}>
                            <CampaignAdSets
                              campaignId={row.campaignId}
                              canToggle
                              key={`${row.campaignId}-${adSetVersion}`}
                              onEdit={CONTROL_API_ENABLED ? (adSet) => setDialog({ type: "adset", row, adSet }) : undefined}
                              userId={row.userId}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <TablePagination
          {...pagination}
          label="campaign"
          onPageChange={pagination.setPage}
          onPageSizeChange={pagination.setPageSize}
        />
      </section>

      {dialog?.type === "copy" && <CopyCampaignDialog onClose={closeDialog} row={dialog.row} />}
      {dialog?.type === "campaign" && <EditCampaignDialog onClose={closeDialog} row={dialog.row} />}
      {dialog?.type === "adset" && (
        <EditAdSetDialog
          adSet={dialog.adSet}
          onClose={closeDialog}
          onSaved={() => {
            adSetCache.invalidate(adSetCacheKey(dialog.row.userId, dialog.row.campaignId));
            setAdSetVersion((version) => version + 1);
          }}
          row={dialog.row}
        />
      )}
    </>
  );
}
```

- [ ] **Step 2: Render di `src/main.jsx`**

Sesudah lazy `DnsRecords`:

```jsx
// Dimuat lazy, alasan yang sama dengan DnsRecords: halaman superadmin yang dibuka sesekali.
const CampaignFleet = lazy(() =>
  import("./components/campaigns/CampaignFleet").then((module) => ({
    default: module.CampaignFleet,
  })),
);
```

Sesudah baris `{!forbidden && route.kind === "dnsRecords" && <DnsRecords store={dataStore.store} />}`:

```jsx
            {/* Superadmin saja — `forbidden` di atas yang menegakkannya lewat canReadResource, dan
                gerbang superadmin di server/campaign-manage.js yang benar-benar menahan tulisannya.
                Saklarnya memakai jalur yang sama dengan profil user (`setCampaignStatus`). */}
            {!forbidden && route.kind === "campaigns" && (
              <CampaignFleet
                navigate={navigate}
                onToggleCampaign={(row, active) => dataStore.setCampaignStatus(row.userId, row, active)}
                store={dataStore.store}
              />
            )}
```

- [ ] **Step 3: CSS** — tambahkan di akhir `src/styles.css`:

```css
/* Halaman Campaign (src/components/campaigns/CampaignFleet.jsx). Menumpang tabel campaign profil
   user; yang berbeda cuma kolom pemilik/aksi dan baris penyaring yang boleh turun ke baris kedua. */
.fleet-filters {
  flex-wrap: wrap;
  gap: 8px;
}

.fleet-filters .control {
  width: auto;
  min-width: 170px;
}

.fleet-filters .search {
  flex: 1 1 240px;
}

.fleet-table {
  min-width: 980px;
}

.fleet-actions {
  display: inline-flex;
  gap: 6px;
}

.fleet-jobs-table {
  font-size: 12px;
}
```

- [ ] **Step 4: Verifikasi otomatis**

Run: `npx biome check --write src/components/campaigns/CampaignFleet.jsx src/main.jsx src/styles.css`
Run: `npm test && npm run build`
Expected: PASS dan build sukses.

- [ ] **Step 5: Verifikasi di browser (lokal, tanpa menulis ke Meta)**

Jalankan dashboard dengan server kontrol lokal (`VITE_CONTROL_API_URL` menunjuk server yang hidup), login sebagai superadmin, lalu periksa:
- `/campaigns` muncul di grup Aset dengan ikon megafon; akun admin biasa melihat "Akses ditolak" di alamat yang sama.
- Penyaring menulis ke alamat (`?pemilik=`, `?status=`) dan bertahan setelah Back.
- Membuka satu baris menampilkan panel ad set dengan kolom Aksi; profil user `/users/{id}` TIDAK punya kolom itu.
- Dialog Duplikasi/Ubah terbuka dan menampilkan nilai segar; tekan Batal (jangan Simpan).
- Tema gelap: dialog dan panel Salinan terbaca (tombol tema di topbar).

- [ ] **Step 6: Commit**

```bash
git add src/components/campaigns/CampaignFleet.jsx src/main.jsx src/styles.css
git commit -m "feat(campaign): halaman armada Campaign untuk superadmin"
```

---

### Task 16: Dokumentasi, deploy, dan pembuktian alur lengkap di produksi

**Files:**
- Modify: `CLAUDE.md` (bagian baru sesudah "### Baris campaign bertahan, kecuali dua hal", sebelum "## Gating Keitaro")
- Modify: `server/README.md` (subbagian baru sebelum blok `docker build`, sekitar baris 300)

**Interfaces:**
- Consumes: seluruh task sebelumnya.

- [ ] **Step 1: Bagian baru di `CLAUDE.md`**

```markdown
## Halaman Campaign: salin dan kelola campaign Meta dari dashboard

`/campaigns` (SUPERADMIN, grup Aset) memuat campaign seluruh armada dan menulis ke Meta lewat server
kontrol: duplikasi (deep copy), anggaran harian, nama, dan negara/umur ad set. Aturannya di
[`functions/campaign-manage-core.js`](functions/campaign-manage-core.js), job salinannya di
[`functions/campaign-copy-jobs.mjs`](functions/campaign-copy-jobs.mjs), route-nya di
[`server/campaign-manage.js`](server/campaign-manage.js). Desainnya:
[docs/superpowers/specs/2026-09-11-campaign-fleet-design.md](docs/superpowers/specs/2026-09-11-campaign-fleet-design.md).

- **Salinan hanya untuk subdomain yang SAMA.** Link iklan tinggal di creative, dan `object_story_spec`
  tidak bisa diubah sesudah creative dibuat. Nama salinan wajib membawa kode Keitaro subdomain sumber;
  kode subdomain lain ditolak, karena belanjanya akan tercatat di subdomain yang tidak menerima
  trafiknya.
- **Vonis nama memakai `matchCode` yang sama dengan sync** (kode terdaftar PERTAMA di nama). Campaign
  yang belum terpetakan atau dipetakan manual boleh diberi kode mana pun, tapi server menjawab 409
  `needsConfirm` berikut subdomain yang dituju, dan dialog menanyakannya — subdomain yang ditanyakan
  adalah keputusan server, bukan tebakan browser.
- **Salinan lahir PAUSED, dan TIDAK PERNAH diulang otomatis** (`retry: false` di `graphPost`). Kode
  1/2 bisa datang sesudah Meta sempat membuat salinannya; mengulangnya berarti campaign kembar.
- **Job ditulis `requested` SEBELUM Meta dipanggil** (`dashboard/campaignCopyJobs`). ≤3 iklan
  disalin langsung, 4–51 lewat `async_batch_requests` yang dipantau cron semenit, >51 ditolak.
  `requested` >10 menit atau `running` >60 menit jadi `unknown` ("periksa Ads Manager"), bukan
  `failed`: server tidak tahu apakah salinannya sudah lahir.
- **Satu sumber, satu job berjalan** — 409 untuk salinan kedua.
- **Anggaran hanya HARIAN, di tingkat yang memegangnya** (campaign CBO, ad set ABO). Lifetime tidak
  bisa diedit. `"0"` dari Meta berarti "bukan jenis anggaran ini", bukan nol rupiah.
- **Targeting dibaca ulang dari Meta sesaat sebelum ditulis**, cuma `countries`/`age_min`/`age_max`
  yang diganti, lalu dikirim utuh — perubahan di Ads Manager selama form terbuka tidak tertimpa. Hanya
  ad set yang lokasinya negara saja yang bisa diedit.
- **Penolakan Meta berkode 100 (selain subkode 33) jadi 422**, sisanya 502 (`metaFailureStatus`).
- **Tiap tulisan yang mengubah baris tabel memasukkan ad account-nya ke antrean sync** (~30 detik,
  digabung per akun), karena penyegaran dua menitan tidak membaca nama dan tidak menambah baris baru.
  Antrean itu dan siklus campaign memakai SATU penjaga (`server/campaign-lock.js`): keduanya menulis
  `users/{id}/campaigns`.
- **Versi Meta API dipatok `v25.0`.** Pada 11 Sep 2026 Meta menjawab `v21.0` sebagai `v26.0` diam-diam.
- Butuh `npm run deploy:rules` (node job baru), deploy ulang server kontrol, dan hosting.
```

- [ ] **Step 2: Subbagian di `server/README.md`**

```markdown
### Halaman Campaign (`/fleet`)

SUPERADMIN (`requireSuperAdmin` di `campaign-manage.js`). Menulis ke Meta dengan `META_ACCESS_TOKEN`.

| Method + path | Guna |
|---|---|
| `POST /fleet/campaigns/:id/copies` | Duplikasi (deep copy, lahir PAUSED) |
| `GET /fleet/campaigns/:id?userId=` | Nama + anggaran segar untuk form |
| `POST /fleet/campaigns/:id` | Ubah nama / anggaran harian campaign |
| `GET /fleet/campaigns/:id/adsets/:adSetId?userId=` | Nama, anggaran, ringkasan targeting |
| `POST /fleet/campaigns/:id/adsets/:adSetId` | Ubah nama / anggaran / negara / umur ad set |

- `CAMPAIGN_JOBS_CRON` (bawaan `20 * * * * *`) memantau salinan asinkron di `dashboard/campaignCopyJobs`.
- Sync akun sesudah tulisan digabung ~30 detik dan memakai penjaga yang sama dengan siklus campaign.
- Tanpa server ini halamannya tetap terbuka (tabel dari RTDB) tapi tombolnya tidak digambar.
```

- [ ] **Step 3: Verifikasi penuh**

Run: `npm test`
Run: `cd functions && npm test`
Run: `cd server && bun test`
Run: `npx biome check .`
Run: `npm run build`
Expected: seluruhnya PASS/sukses.

- [ ] **Step 4: Commit dokumentasi**

```bash
git add CLAUDE.md server/README.md
git commit -m "docs(campaign): aturan halaman Campaign dan endpoint /fleet"
```

- [ ] **Step 5: Deploy — HANYA sesudah pemilik mengonfirmasi di chat**

Sebutkan ke pemilik apa yang akan di-deploy, lalu tunggu "ya" untuk tiap baris:

1. Aturan database: `npm run deploy:rules` dan `npm run deploy:rules:dwiki`.
2. Server kontrol: build ulang image dan jalankan ulang kedua instansi sesuai bagian Docker di `server/README.md` (`.env` dan `.env.jon`). Pastikan log start memuat `[campaign] halaman Campaign aktif`.
3. Hosting: `npm run build && firebase deploy --only hosting --project rabbitroi-89973`, lalu `npm run deploy:dwiki`.

- [ ] **Step 6: Pembuktian alur lengkap di produksi — HANYA sesudah pemilik memilih campaign dan mengonfirmasi**

Minta pemilik menunjuk satu campaign kecil (≤3 iklan) miliknya sendiri. Lalu dari `/campaigns`:

1. Duplikasi (1 salinan). Expected: toast "Salinan dibuat dalam keadaan mati (PAUSED)", panel Salinan berbunyi Selesai "1 dari 1", dan baris salinan muncul di tabel ±1 menit kemudian dengan status "Tidak aktif".
2. Ubah anggaran harian salinan (kalau CBO) atau anggaran ad set-nya (kalau ABO). Expected: layar tinjauan menyebut lama → baru; Ads Manager menunjukkan angka baru.
3. Ubah negara ad set salinan (tambah satu negara). Expected: Ads Manager menunjukkan negara baru dan minat/penempatan ad set tetap sama.
4. Nyalakan salinan lewat saklar, lalu matikan lagi. Expected: status berganti "Aktif" lalu "Tidak aktif".
5. Hapus salinan (dengan konfirmasi pemilik): `cd functions && node --env-file-if-exists=.env.sync tools/meta-copy-probe.mjs --cleanup <copied_campaign_id>`.
6. Opsional, hanya kalau pemilik menyetujui: ulangi langkah 1 pada campaign 4–51 iklan untuk membuktikan jalur asinkron (panel Salinan harus berbunyi Berjalan lalu Selesai dalam beberapa menit), lalu hapus salinannya.

Catat hasilnya (tanggal, campaign ID, apa yang terlihat) di lampiran spec, lalu:

```bash
git add docs/superpowers/specs/2026-09-11-campaign-fleet-design.md
git commit -m "docs(campaign): hasil pembuktian alur Campaign di produksi"
```

---

## Cakupan spec → task

| Bagian spec | Task |
|---|---|
| Versi dipatok v25.0 | 1 |
| Risiko `copies` di batch asinkron | 0 |
| §1 `meta.js` (salin, batch, edit) | 3, 4 |
| §1 aturan murni | 5, 6 |
| §1 route `/fleet` + `campaignRowOf` bersama | 8, 9 |
| §1 antrean sync + penjaga bersama | 8, 10 |
| §1 node job + `.validate` + langganan superadmin | 7, 11 |
| §2 duplikasi (vonis nama, mode, job requested dulu, tanpa retry, unknown, 409) | 3, 5, 7, 9 |
| §3 edit (anggaran, nama, targeting, baca ulang) | 4, 6, 9, 14 |
| §4 halaman (menu, filter di alamat, panel Salinan, pemindahan sel status, server mati) | 12, 13, 14, 15 |
| §5 penanganan gagal (tabel status) | 6, 9, 14 |
| §6 tes + dua pembuktian produksi | 0–15, 16 |
| §7 deploy + CLAUDE.md | 16 |


---

## Revisi 11 Sep 2026: salin bertahap (menggantikan Task 3, 7, 9, 10)

Pembuktian ke Meta produksi (lampiran spec) membatalkan jalur asinkron: `async_batch_requests` menolak
satu item dengan `#194` dan dua item dengan `#10` (izin app). Duplikasi jadi **salin bertahap**:
salin campaign tanpa isi → salin tiap ad set ke dalamnya (deep copy per ad set, ≤3 iklan) → ganti
nama. Lihat bagian "Revisi" di awal spec.

- **Task 3, 7, 9, 10 TIDAK dikerjakan**; penggantinya Task 17, 19, 20, 21. Task 18 mengubah kode Task 5
  yang sudah ada, Task 22 menyesuaikan kode frontend Task 14–15, Task 23 pembuktian produksi.
- **Task 4 tetap berlaku**, dikerjakan sesudah Task 17 (fungsi edit ditambahkan sesudah fungsi salin
  bertahap, bukan sesudah `batchErrorMessage` yang tidak pernah ada).
- **Task 16** memakai teks CLAUDE.md dari Task 24 (versi salin bertahap), bukan teks lamanya.
- Global Constraints berubah untuk salinan: batas **≤3 iklan per ad set, ≤50 ad set per campaign**;
  `requested` >10 menit atau `running` >30 menit → `unknown`; job >7 hari dibuang; ad set disalin
  dengan `status_option=INHERITED_FROM_SOURCE`, campaign salinan tetap `PAUSED`; iklan yang tidak ikut
  tersalin wajib terdeteksi (salinan `partial`).

Urutan: 17 → 4 → 18 → 19 → 20 → 21 → 22 → 16 (dengan teks Task 24) → 23.

### Task 17: `meta.js` — salin bertahap tanpa percobaan ulang (pengganti Task 3)

**Files:**
- Modify: `functions/meta.js` (`request`, `graphPost`, fungsi baru sesudah `explainWriteFailure`)
- Test: `functions/meta.test.mjs`, `functions/meta-throttle.test.mjs`

**Interfaces:**
- Produces:
  - `copyCampaignShell(campaignId, token) => Promise<{ campaignId: string }>` — campaign saja, `PAUSED`, tanpa ganti nama
  - `copyAdSetInto(adSetId, token, { campaignId }) => Promise<{ adSetId: string, adIds: string[] }>` — ad set + iklannya ke campaign tujuan; `adIds` adalah iklan yang BENAR-BENAR lahir
  - `graphPost(path, token, params, { retry })` — `retry: false` mematikan percobaan ulang

- [ ] **Step 1: Tulis tes yang gagal**

Tambahkan `copyAdSetInto, copyCampaignShell,` ke destructuring import di atas `functions/meta.test.mjs`, lalu di akhir berkas:

```js
// --- Salin bertahap ------------------------------------------------------------------------
let shellUrl;
globalThis.fetch = async (url, options) => {
  shellUrl = new URL(String(url));
  assert.equal(options?.method, "POST");
  return { ok: true, text: async () => JSON.stringify({ copied_campaign_id: "900", ad_object_ids: [] }) };
};
assert.deepEqual(await copyCampaignShell("120210", "tok"), { campaignId: "900" });
assert.match(shellUrl.pathname, /\/120210\/copies$/);
assert.equal(shellUrl.searchParams.get("deep_copy"), "false", "isinya disalin per ad set, bukan di sini");
assert.equal(shellUrl.searchParams.get("status_option"), "PAUSED", "salinan selalu lahir mati");
assert.match(shellUrl.searchParams.get("rename_options"), /NO_RENAME/);

globalThis.fetch = async () => ({ ok: true, text: async () => JSON.stringify({}) });
await assert.rejects(() => copyCampaignShell("120210", "tok"), /tidak mengembalikan ID campaign salinan/);
await assert.rejects(() => copyCampaignShell("", "tok"), /kosong/);

let adSetUrlCopy;
globalThis.fetch = async (url) => {
  adSetUrlCopy = new URL(String(url));
  return {
    ok: true,
    text: async () => JSON.stringify({
      copied_adset_id: "901",
      ad_object_ids: [
        { ad_object_type: "ad_set", source_id: "555", copied_id: "901" },
        { ad_object_type: "ad", source_id: "777", copied_id: "902" },
      ],
    }),
  };
};
assert.deepEqual(await copyAdSetInto("555", "tok", { campaignId: "900" }), { adSetId: "901", adIds: ["902"] });
assert.match(adSetUrlCopy.pathname, /\/555\/copies$/);
assert.equal(adSetUrlCopy.searchParams.get("campaign_id"), "900");
assert.equal(adSetUrlCopy.searchParams.get("deep_copy"), "true");
assert.equal(
  adSetUrlCopy.searchParams.get("status_option"),
  "INHERITED_FROM_SOURCE",
  "saklar ad set tetap seperti aslinya; campaign salinan yang menahannya",
);

// Deep copy MELEWATKAN iklan tanpa error kalau izin Halaman kurang — `adIds` kosong, bukan dikarang.
globalThis.fetch = async () => ({
  ok: true,
  text: async () => JSON.stringify({ copied_adset_id: "903", ad_object_ids: [{ ad_object_type: "ad_set", copied_id: "903" }] }),
});
assert.deepEqual(await copyAdSetInto("555", "tok", { campaignId: "900" }), { adSetId: "903", adIds: [] });
await assert.rejects(() => copyAdSetInto("555", "tok", { campaignId: "" }), /campaign tujuan kosong/);
await assert.rejects(() => copyAdSetInto("", "tok", { campaignId: "900" }), /kosong/);

console.log("meta staged copy tests ok");
```

Di `functions/meta-throttle.test.mjs`, tambahkan `copyCampaignShell, setCampaignStatus` ke destructuring import, lalu sebelum `console.log` terakhir:

```js
// Salinan TIDAK diulang walau kodenya sementara: kode 2 bisa datang sesudah Meta sempat membuat
// salinannya, dan mengulangnya berarti campaign kembar.
calls = 0;
globalThis.fetch = async () => {
  calls++;
  return fail({ message: "Service temporarily unavailable", code: 2 });
};
await assert.rejects(() => copyCampaignShell("120210", "tok"), /\(#2\)/);
assert.equal(calls, 1, "salin campaign tidak pernah diulang");

// Tulisan yang aman diulang tetap diulang.
calls = 0;
await assert.rejects(() => setCampaignStatus("120210", "tok", "PAUSED"), /\(#2\)/);
assert.equal(calls, 3, "saklar campaign tetap 1 percobaan + 2 retry");
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `cd functions && node --test meta.test.mjs meta-throttle.test.mjs`
Expected: FAIL, `copyCampaignShell` bukan export.

- [ ] **Step 3: Implementasi**

Di `functions/meta.js`, ganti tanda tangan dan baris retry di `request`:

```js
async function request(url, path, init, { retry = true } = {}) {
  for (let attempt = 0; ; attempt++) {
    const { res, data } = await schedule(async () => {
      const res = await fetch(url, init);
      observeUsage(res);
      return { res, data: await parseGraphBody(res) };
    });
    if (res.ok && !data.error) return data;

    // Tulisan yang tidak aman diulang (salin campaign/ad set) mematikan percobaan ulang: kode 1/2
    // bisa datang SESUDAH Meta sempat membuat salinannya, dan mengulangnya menghasilkan kembaran.
    const wait = retry ? retryDelay(data.error, attempt) : null;
    if (wait === null) {
      throw new Error(`Meta ${path} -> ${describeGraphError(data.error, res.status)}`);
    }
    // Di luar antrean: panggilan lain boleh jalan selama yang ini menunggu gilirannya lagi.
    await sleep(wait);
  }
}
```

Ganti `graphPost`:

```js
async function graphPost(path, token, params = {}, options = {}) {
  return request(graphUrl(path, token, params), path, { method: "POST" }, options);
}
```

Tambahkan sesudah `explainWriteFailure`:

```js
// --- Salin campaign, BERTAHAP --------------------------------------------------------------
//
// Bukan satu deep copy campaign: salinan langsung Meta dibatasi 3 iklan PER PANGGILAN, dan jalur
// asinkronnya (`async_batch_requests`) tertutup untuk app ini (#194 untuk satu item, #10 untuk dua —
// lihat lampiran spec). Jadi campaign disalin tanpa isinya, lalu tiap ad set disalin ke dalamnya.
//
// Tidak satu pun panggilan di bagian ini diulang otomatis (`retry: false`).
const NO_RENAME = JSON.stringify({ rename_strategy: "NO_RENAME" });

export async function copyCampaignShell(campaignId, token) {
  const id = String(campaignId || "").trim();
  if (!id) throw new Error("ID campaign kosong.");
  let data;
  try {
    data = await graphPost(
      `${id}/copies`,
      token,
      { deep_copy: "false", status_option: "PAUSED", rename_options: NO_RENAME },
      { retry: false },
    );
  } catch (error) {
    throw new Error(explainWriteFailure(error.message));
  }
  const copied = String(data?.copied_campaign_id || "");
  if (!copied) throw new Error("Meta tidak mengembalikan ID campaign salinan.");
  return { campaignId: copied };
}

/**
 * Salin satu ad set berikut iklannya ke campaign tujuan.
 *
 * `adIds` adalah iklan yang BENAR-BENAR lahir, dibaca dari `ad_object_ids`. Deep copy melewatkan
 * iklan tanpa satu pun error kalau System User tidak punya izin beriklan di Halaman yang dipakai
 * creative-nya (dibuktikan 11 Sep 2026), jadi pemanggilnya yang membandingkan jumlah ini dengan
 * jumlah iklan sumber — bukan menganggap deep copy berarti semuanya ikut.
 *
 * `INHERITED_FROM_SOURCE`: saklar tiap ad set tetap seperti aslinya. Tidak ada yang tayang karena
 * campaign salinannya lahir PAUSED.
 */
export async function copyAdSetInto(adSetId, token, { campaignId } = {}) {
  const id = String(adSetId || "").trim();
  if (!id) throw new Error("ID ad set kosong.");
  const target = String(campaignId || "").trim();
  if (!target) throw new Error("ID campaign tujuan kosong.");
  let data;
  try {
    data = await graphPost(
      `${id}/copies`,
      token,
      {
        campaign_id: target,
        deep_copy: "true",
        status_option: "INHERITED_FROM_SOURCE",
        rename_options: NO_RENAME,
      },
      { retry: false },
    );
  } catch (error) {
    throw new Error(explainWriteFailure(error.message));
  }
  const copied = String(data?.copied_adset_id || "");
  if (!copied) throw new Error("Meta tidak mengembalikan ID ad set salinan.");
  const adIds = (Array.isArray(data?.ad_object_ids) ? data.ad_object_ids : [])
    .filter((item) => item?.ad_object_type === "ad")
    .map((item) => String(item.copied_id || ""))
    .filter(Boolean);
  return { adSetId: copied, adIds };
}
```

- [ ] **Step 4: Jalankan, pastikan lolos**

Run: `cd functions && npm test`
Expected: PASS.

- [ ] **Step 5: Lint dan commit**

Run: `npx biome check --write functions/meta.js functions/meta.test.mjs functions/meta-throttle.test.mjs`

```bash
git add functions/meta.js functions/meta.test.mjs functions/meta-throttle.test.mjs
git commit -m "feat(meta): salin campaign bertahap tanpa percobaan ulang"
```

---

### Task 18: `campaign-manage-core.js` — rencana salin per ad set dan hasil yang tahu iklan hilang

Mengubah kode Task 5 yang sudah ada di `functions/campaign-manage-core.js`.

**Files:**
- Modify: `functions/campaign-manage-core.js`
- Test: `functions/campaign-manage-core.test.mjs`

**Interfaces:**
- Removes: `DIRECT_COPY_MAX_ADS`, `ASYNC_COPY_MAX_ADS`, `copyMode`.
- Produces:
  - `MAX_ADS_PER_AD_SET = 3`, `MAX_AD_SETS = 50`
  - `copyPlan(adSets, ads) => { adSets: Array<{ id, name, ads: number }>, adCount: number }` — `adSets` bentuk `fetchAdSets` (`{ id, name, status }`), `ads` bentuk `fetchCampaignAds` (`{ id, adSetId, status }`); melempar `RuleError`
  - `copyJobEntry({ source, userId, account, names, plan, requestedBy, now })` — field `mode` diganti `adSetCount` + `adCount`
  - `copyShortfall(copy) => string` — sebab salinan tidak utuh, `""` kalau utuh; `copy` berbentuk `{ campaignId, adSets, adSetsExpected, ads, adsExpected }`
  - `copyOutcome(copies)` — `done` hanya kalau tiap salinan lahir, tanpa `error`, dan jumlah ad set + iklannya utuh; `failed` kalau tidak ada yang lahir (termasuk daftar kosong)
  - `stalledJobPatch(job, now)` — `running` diukur dari `startedAt` (atau `requestedAt`), batas 30 menit

- [ ] **Step 1: Ubah tes lebih dulu** — di `functions/campaign-manage-core.test.mjs`:

1. Di import, ganti `copyMode,` dengan `copyPlan,` dan tambahkan `copyShortfall,`.
2. Ganti seluruh tes `"mode salin dari jumlah iklan: ≤3 langsung, ≤51 asinkron, lebih dari itu ditolak"` dengan:

```js
test("rencana salin: ad set yang saklarnya ACTIVE/PAUSED, dengan jumlah iklan masing-masing", () => {
  const plan = copyPlan(
    [
      { id: "s1", name: "Adset 1", status: "ACTIVE" },
      { id: "s2", name: "Adset 2", status: "PAUSED" },
      { id: "s3", name: "Lama", status: "ARCHIVED" },
    ],
    [
      { id: "a1", adSetId: "s1", status: "ACTIVE" },
      { id: "a2", adSetId: "s1", status: "PAUSED" },
      { id: "a3", adSetId: "s2", status: "ACTIVE" },
      { id: "a4", adSetId: "s2", status: "DELETED" },
      { id: "a5", adSetId: "s3", status: "ACTIVE" },
    ],
  );
  assert.deepEqual(plan, {
    adSets: [
      { id: "s1", name: "Adset 1", ads: 2 },
      { id: "s2", name: "Adset 2", ads: 1 },
    ],
    adCount: 3,
  });
});

test("rencana salin menolak sebelum menyentuh Meta", () => {
  const four = Array.from({ length: 4 }, (_, i) => ({ id: `a${i}`, adSetId: "s1", status: "ACTIVE" }));
  assert.throws(
    () => copyPlan([{ id: "s1", name: "Adset Gemuk", status: "ACTIVE" }], four),
    /Adset Gemuk.*lebih dari 3 iklan/,
  );
  assert.throws(() => copyPlan([{ id: "s1", name: "X", status: "ARCHIVED" }], []), /tidak punya ad set/);
  const many = Array.from({ length: 51 }, (_, i) => ({ id: `s${i}`, name: `S${i}`, status: "ACTIVE" }));
  assert.throws(() => copyPlan(many, []), /51 ad set/);
});
```

3. Di tes `"entri job lahir requested, berikut seluruh identitasnya"`, ganti argumen `mode: "direct",` dengan `plan: { adSets: [{ id: "s1", name: "A", ads: 1 }, { id: "s2", name: "B", ads: 2 }], adCount: 3 },` dan di objek yang diharapkan ganti baris `mode: "direct",` dengan:

```js
      adSetCount: 2,
      adCount: 3,
```

4. Ganti seluruh tes `"hasil job dari salinan yang lahir"` dengan:

```js
test("salinan yang tidak utuh menyebut sebabnya", () => {
  const whole = { campaignId: "9", adSets: 2, adSetsExpected: 2, ads: 3, adsExpected: 3 };
  assert.equal(copyShortfall(whole), "");
  assert.match(copyShortfall({ ...whole, ads: 0 }), /3 dari 3 iklan tidak ikut tersalin.*izin Create ads/);
  assert.match(copyShortfall({ ...whole, adSets: 1 }), /1 dari 2 ad set gagal disalin/);
  assert.equal(copyShortfall({ campaignId: "" }), "");
});

test("hasil job: done hanya kalau semua salinan lahir UTUH", () => {
  const whole = { campaignId: "9", adSets: 1, adSetsExpected: 1, ads: 1, adsExpected: 1, error: "" };
  assert.deepEqual(copyOutcome([whole, { ...whole, campaignId: "8" }]), { state: "done", error: "" });
  // Lahir tapi iklannya tidak ikut: bukan "Selesai".
  assert.deepEqual(copyOutcome([{ ...whole, ads: 0, error: "1 dari 1 iklan tidak ikut tersalin" }]), {
    state: "partial",
    error: "1 dari 1 iklan tidak ikut tersalin",
  });
  assert.equal(copyOutcome([whole, { campaignId: "", error: "Too many ads" }]).state, "partial");
  assert.deepEqual(copyOutcome([{ campaignId: "", error: "" }]), { state: "failed", error: "Meta tidak membuat salinan." });
  assert.equal(copyOutcome([]).state, "failed", "daftar kosong bukan keberhasilan");
});
```

5. Di tes `"job yang menggantung jadi unknown, bukan failed"`, ganti dua baris `running` dengan:

```js
  assert.equal(stalledJobPatch({ state: "running", requestedAt: at, startedAt: at }, later(31)).state, "unknown");
  assert.equal(stalledJobPatch({ state: "running", requestedAt: at, startedAt: at }, later(20)), null);
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `cd functions && node --test campaign-manage-core.test.mjs`
Expected: FAIL (`copyPlan` bukan export).

- [ ] **Step 3: Implementasi** — di `functions/campaign-manage-core.js`:

Ganti blok konstanta dan fungsi `copyMode` (dari `export const MAX_COPIES = 5;` sampai akhir `copyMode`) dengan:

```js
export const MAX_COPIES = 5;
// Batas salinan LANGSUNG Meta berlaku per panggilan, dan tiap ad set disalin dengan panggilannya
// sendiri — jadi batasnya per ad set, bukan per campaign. Jalur asinkron yang bisa lebih dari itu
// tertutup untuk app ini (lihat lampiran spec).
export const MAX_ADS_PER_AD_SET = 3;
export const MAX_AD_SETS = 50;
const COPYABLE = new Set(["ACTIVE", "PAUSED"]);

/**
 * Ad set yang akan disalin, berikut jumlah iklan yang seharusnya ikut.
 *
 * Hanya yang saklarnya ACTIVE/PAUSED: yang diarsipkan atau dihapus tidak dijalankan siapa pun.
 * Jumlah iklannya dipakai dua kali — menolak ad set di atas 3 iklan SEBELUM menyentuh Meta, dan
 * sesudahnya membandingkan dengan iklan yang benar-benar lahir (deep copy melewatkan iklan diam-diam
 * kalau izin Halaman kurang).
 */
export function copyPlan(adSets, ads) {
  const copyable = (adSets || []).filter((set) => COPYABLE.has(String(set?.status || "").toUpperCase()));
  if (!copyable.length) throw new RuleError("Campaign ini tidak punya ad set yang bisa disalin.");
  if (copyable.length > MAX_AD_SETS) {
    throw new RuleError(
      `Campaign ini memuat ${copyable.length} ad set; paling banyak ${MAX_AD_SETS} ad set sekali salin.`,
    );
  }
  const adsBySet = new Map();
  for (const ad of ads || []) {
    if (!COPYABLE.has(String(ad?.status || "").toUpperCase())) continue;
    const key = String(ad.adSetId || "");
    adsBySet.set(key, (adsBySet.get(key) || 0) + 1);
  }
  const planned = copyable.map((set) => ({ id: String(set.id), name: set.name || "", ads: adsBySet.get(String(set.id)) || 0 }));
  const tooBig = planned.filter((set) => set.ads > MAX_ADS_PER_AD_SET);
  if (tooBig.length) {
    const names = tooBig.slice(0, 3).map((set) => set.name || set.id);
    const more = tooBig.length > 3 ? ` dan ${tooBig.length - 3} lainnya` : "";
    throw new RuleError(
      `Ad set ${names.join(", ")}${more} berisi lebih dari ${MAX_ADS_PER_AD_SET} iklan; Meta hanya bisa menyalin paling banyak ${MAX_ADS_PER_AD_SET} iklan per ad set sekali salin.`,
    );
  }
  return { adSets: planned, adCount: planned.reduce((sum, set) => sum + set.ads, 0) };
}
```

Di `copyJobEntry`, ganti parameter `mode` dengan `plan`, dan ganti baris `mode,` di objek yang dikembalikan dengan:

```js
    adSetCount: plan.adSets.length,
    adCount: plan.adCount,
```

Ganti `REQUESTED_TIMEOUT_MS`/`RUNNING_TIMEOUT_MS` menjadi:

```js
const REQUESTED_TIMEOUT_MS = 10 * 60_000;
// Salin bertahap berjalan di latar: lima salinan × lima puluh ad set pada jeda 400 ms antarpanggilan
// sudah sekitar dua menit. Tiga puluh menit berarti prosesnya memang mati, bukan lambat.
const RUNNING_TIMEOUT_MS = 30 * 60_000;
```

Ganti `copyOutcome` dengan dua fungsi:

```js
// Sebab sebuah salinan yang LAHIR tidak utuh. Iklan yang hilang hampir selalu izin Halaman: deep
// copy melewatkannya tanpa error (dibuktikan 11 Sep 2026, lihat lampiran spec).
export function copyShortfall(copy) {
  if (!copy?.campaignId) return "";
  const missingAdSets = (copy.adSetsExpected || 0) - (copy.adSets || 0);
  if (missingAdSets > 0) return `${missingAdSets} dari ${copy.adSetsExpected} ad set gagal disalin.`;
  const missingAds = (copy.adsExpected || 0) - (copy.ads || 0);
  if (missingAds > 0) {
    return `${missingAds} dari ${copy.adsExpected} iklan tidak ikut tersalin — System User belum punya izin Create ads di Halaman iklan itu.`;
  }
  return "";
}

export function copyOutcome(copies) {
  const born = copies.filter((copy) => copy?.campaignId).length;
  if (!born) {
    return { state: "failed", error: copies.find((copy) => copy?.error)?.error || "Meta tidak membuat salinan." };
  }
  const flawed = copies.find((copy) => !copy?.campaignId || copy?.error);
  return flawed ? { state: "partial", error: flawed.error || "Meta tidak membuat salinan." } : { state: "done", error: "" };
}
```

Di `stalledJobPatch`, ganti baris `const since = ...` dengan:

```js
  const since = job?.state === "running" ? job.startedAt || job.requestedAt : job?.requestedAt;
```

- [ ] **Step 4: Jalankan, pastikan lolos**

Run: `cd functions && npm test`
Expected: PASS.

- [ ] **Step 5: Lint dan commit**

Run: `npx biome check --write functions/campaign-manage-core.js functions/campaign-manage-core.test.mjs`

```bash
git add functions/campaign-manage-core.js functions/campaign-manage-core.test.mjs
git commit -m "feat(campaign): rencana salin per ad set, salinan tanpa iklan tidak disebut selesai"
```

---

### Task 19: Orkestrasi job salin bertahap + aturan database (pengganti Task 7)

**Files:**
- Create: `functions/campaign-copy-jobs.mjs`
- Modify: `database.rules.json` (di dalam `dashboard`, sesudah blok `telegramInbox`)
- Test: `functions/campaign-copy-jobs.test.mjs`

**Interfaces:**
- Consumes: Task 17 (`copyCampaignShell`, `copyAdSetInto`), `fetchAdSets`, `fetchCampaignAds`, Task 4 (`updateCampaign`), Task 18 (`copyPlan`, `copyJobEntry`, `copyOutcome`, `copyShortfall`, `stalledJobPatch`, `expiredCopyJobIds`, `activeCopyJob`, `newCopyJobId`, `COPY_JOBS_PATH`).
- Produces:
  - `class JobConflict extends Error` (`status = 409`)
  - `startCopyJob(store, token, { userId, row, account, names, requestedBy?, now? }) => Promise<{ jobId, plan }>` — memeriksa, menyusun rencana, menulis job `requested`; TIDAK menulis ke Meta; melempar `JobConflict`, `RuleError`, atau galat bacaan Meta
  - `runCopyJob(store, token, { jobId, row, account, names, plan, enqueueSync?, log? }) => Promise<{ jobId, state, copies, error }>` — menyalin; TIDAK PERNAH melempar
  - `sweepCopyJobs(store, { now? }) => Promise<{ changed }>` — job menggantung → `unknown`, job >7 hari dibuang
  - `store` berbentuk `{ read(path), update(path, values) }`; `account` berbentuk `{ id, actId }`

- [ ] **Step 1: Tulis tes yang gagal** — `functions/campaign-copy-jobs.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// meta.js membaca jedanya saat diimpor.
process.env.META_MIN_INTERVAL_MS = "0";
const { JobConflict, runCopyJob, startCopyJob, sweepCopyJobs } = await import("./campaign-copy-jobs.mjs");
const { RuleError } = await import("./campaign-manage-core.js");

function fakeStore(data = {}) {
  const state = structuredClone(data);
  const at = (path) => path.split("/").reduce((node, key) => node?.[key], state);
  return {
    state,
    read: async (path) => structuredClone(at(path) ?? null),
    update: async (path, values) => {
      for (const [key, value] of Object.entries(values)) {
        const parts = `${path}/${key}`.split("/");
        const last = parts.pop();
        let node = state;
        for (const part of parts) node = node[part] ??= {};
        if (value === null) delete node[last];
        else node[last] = structuredClone(value);
      }
    },
  };
}

const reply = (body, ok = true) => ({ ok, status: ok ? 200 : 400, text: async () => JSON.stringify(body) });
const ROW = { campaignId: "120210", campaign: "TvH1-06 Pros" };
const ACCOUNT = { id: "k1", actId: "act_1" };
const jobsOf = (store) => store.state.dashboard?.campaignCopyJobs || {};

// Kunci rute: "METHOD /path" tanpa versi. Nilai: fungsi (url) => [body, ok?].
function metaStub(overrides = {}) {
  const calls = [];
  const routes = {
    "GET /120210/adsets": () => [{ data: [{ id: "s1", name: "Adset 1", status: "ACTIVE" }, { id: "s2", name: "Adset 2", status: "PAUSED" }] }],
    "GET /120210/ads": () => [{ data: [{ id: "a1", adset_id: "s1", status: "ACTIVE" }, { id: "a2", adset_id: "s2", status: "ACTIVE" }] }],
    "POST /120210/copies": () => [{ copied_campaign_id: "900" }],
    "POST /s1/copies": () => [{ copied_adset_id: "901", ad_object_ids: [{ ad_object_type: "ad", copied_id: "911" }] }],
    "POST /s2/copies": () => [{ copied_adset_id: "902", ad_object_ids: [{ ad_object_type: "ad", copied_id: "912" }] }],
    "POST /900": () => [{ success: true }],
    ...overrides,
  };
  globalThis.fetch = async (url, options) => {
    const u = new URL(String(url));
    const key = `${options?.method || "GET"} ${u.pathname.replace(/^\/v25\.0/, "")}`;
    calls.push({ key, params: u.searchParams });
    const route = routes[key];
    if (!route) throw new Error(`panggilan tak terduga: ${key}`);
    const [body, ok = true] = route(u);
    return reply(body, ok);
  };
  return calls;
}

async function started(store, calls, names = ["TvH1-07 Pros"]) {
  const { jobId, plan } = await startCopyJob(store, "tok", { userId: "u_nur", row: ROW, account: ACCOUNT, names, requestedBy: "super@r.live" });
  return { jobId, plan, calls };
}

test("start: job requested ditulis sebelum satu pun tulisan ke Meta", async () => {
  const store = fakeStore();
  const calls = metaStub();
  const { jobId, plan } = await started(store, calls);
  assert.equal(calls.some((call) => call.key.startsWith("POST")), false, "start tidak menulis ke Meta");
  assert.deepEqual(plan.adSets.map((set) => set.id), ["s1", "s2"]);
  const job = jobsOf(store)[jobId];
  assert.equal(job.state, "requested");
  assert.equal(job.adSetCount, 2);
  assert.equal(job.adCount, 2);
});

test("start: salinan yang masih berjalan untuk sumber yang sama ditolak tanpa menyentuh Meta", async () => {
  const store = fakeStore({ dashboard: { campaignCopyJobs: { jold: { sourceCampaignId: "120210", state: "running" } } } });
  const calls = metaStub();
  await assert.rejects(() => started(store, calls), JobConflict);
  assert.equal(calls.length, 0);
});

test("start: ad set di atas 3 iklan ditolak dan tidak ada job yang ditulis", async () => {
  const store = fakeStore();
  metaStub({
    "GET /120210/ads": () => [{ data: Array.from({ length: 4 }, (_, i) => ({ id: `a${i}`, adset_id: "s1", status: "ACTIVE" })) }],
  });
  await assert.rejects(() => started(store, []), RuleError);
  assert.deepEqual(jobsOf(store), {});
});

test("run: campaign kosong dulu, tiap ad set ke dalamnya, lalu ganti nama — hasilnya done", async () => {
  const store = fakeStore();
  const calls = metaStub();
  const { jobId, plan } = await started(store, calls);
  const synced = [];
  const result = await runCopyJob(store, "tok", { jobId, row: ROW, account: ACCOUNT, names: ["TvH1-07 Pros"], plan, enqueueSync: (id) => synced.push(id) });
  assert.equal(result.state, "done");
  const posts = calls.filter((call) => call.key.startsWith("POST")).map((call) => call.key);
  assert.deepEqual(posts, ["POST /120210/copies", "POST /s1/copies", "POST /s2/copies", "POST /900"]);
  assert.equal(calls.find((call) => call.key === "POST /120210/copies").params.get("deep_copy"), "false");
  assert.equal(calls.find((call) => call.key === "POST /s1/copies").params.get("campaign_id"), "900");
  assert.equal(calls.find((call) => call.key === "POST /900").params.get("name"), "TvH1-07 Pros");
  const job = jobsOf(store)[jobId];
  assert.equal(job.state, "done");
  assert.deepEqual(job.progress, { done: 2, total: 2 });
  assert.deepEqual(job.copies[0], {
    name: "TvH1-07 Pros",
    campaignId: "900",
    adSets: 2,
    adSetsExpected: 2,
    ads: 2,
    adsExpected: 2,
    error: "",
    renameError: "",
  });
  assert.deepEqual(synced, ["k1"]);
});

test("run: iklan yang dilewati Meta diam-diam membuat salinan partial berikut sebabnya", async () => {
  const store = fakeStore();
  const calls = metaStub({ "POST /s2/copies": () => [{ copied_adset_id: "902", ad_object_ids: [] }] });
  const { jobId, plan } = await started(store, calls);
  const synced = [];
  const result = await runCopyJob(store, "tok", { jobId, row: ROW, account: ACCOUNT, names: ["A"], plan, enqueueSync: (id) => synced.push(id) });
  assert.equal(result.state, "partial");
  assert.match(jobsOf(store)[jobId].copies[0].error, /1 dari 2 iklan tidak ikut tersalin/);
  assert.deepEqual(synced, ["k1"], "salinannya tetap ada, jadi akunnya tetap disync");
});

test("run: ad set yang ditolak Meta tidak menghentikan ad set lain", async () => {
  const store = fakeStore();
  const calls = metaStub({
    "POST /s1/copies": () => [{ error: { message: "Application does not have permission for this action", code: 10 } }, false],
  });
  const { jobId, plan } = await started(store, calls);
  const result = await runCopyJob(store, "tok", { jobId, row: ROW, account: ACCOUNT, names: ["A"], plan });
  assert.equal(result.state, "partial");
  assert.ok(calls.some((call) => call.key === "POST /s2/copies"), "ad set berikutnya tetap dicoba");
  assert.match(jobsOf(store)[jobId].copies[0].error, /^Adset 1: /);
});

test("run: campaign yang gagal disalin menghentikan salinan berikutnya, tanpa sync", async () => {
  const store = fakeStore();
  const calls = metaStub({ "POST /120210/copies": () => [{ error: { message: "Invalid parameter", code: 100 } }, false] });
  const { jobId, plan } = await started(store, calls, ["A #1", "A #2"]);
  const synced = [];
  const result = await runCopyJob(store, "tok", { jobId, row: ROW, account: ACCOUNT, names: ["A #1", "A #2"], plan, enqueueSync: (id) => synced.push(id) });
  assert.equal(result.state, "failed");
  assert.equal(calls.filter((call) => call.key === "POST /120210/copies").length, 1, "tidak diulang untuk salinan kedua");
  assert.equal(jobsOf(store)[jobId].copies[1].error, "Tidak dicoba karena salinan sebelumnya gagal.");
  assert.deepEqual(synced, []);
});

test("sweep: yang menggantung jadi unknown, yang lama dibuang", async () => {
  const now = new Date("2026-09-11T10:00:00Z");
  const store = fakeStore({
    dashboard: {
      campaignCopyJobs: {
        jreq: { state: "requested", requestedAt: "2026-09-11T09:45:00.000Z" },
        jrun: { state: "running", requestedAt: "2026-09-11T09:00:00.000Z", startedAt: "2026-09-11T09:00:05.000Z" },
        jnew: { state: "running", requestedAt: "2026-09-11T09:55:00.000Z", startedAt: "2026-09-11T09:55:00.000Z" },
        jold: { state: "done", requestedAt: "2026-09-01T00:00:00.000Z" },
      },
    },
  });
  await sweepCopyJobs(store, { now });
  const jobs = jobsOf(store);
  assert.equal(jobs.jreq.state, "unknown");
  assert.equal(jobs.jrun.state, "unknown");
  assert.equal(jobs.jnew.state, "running");
  assert.equal(jobs.jold, undefined);
});

test("setiap field job yang ditulis disebut aturan database", async () => {
  const { rules } = JSON.parse(await readFile(new URL("../database.rules.json", import.meta.url), "utf8"));
  const jobRule = rules.dashboard.campaignCopyJobs.$jobId;
  assert.match(jobRule[".validate"], /j\[0-9a-z\]\{5,20\}/);

  const store = fakeStore();
  const calls = metaStub({ "POST /s2/copies": () => [{ error: { message: "x", code: 10 } }, false] });
  const { jobId, plan } = await started(store, calls);
  await runCopyJob(store, "tok", { jobId, row: ROW, account: ACCOUNT, names: ["A"], plan });
  const job = jobsOf(store)[jobId];
  for (const key of Object.keys(job)) assert.ok(jobRule[key], `${key} tidak disebut aturan database`);
  for (const key of Object.keys(job.progress)) assert.ok(jobRule.progress[key], `progress/${key} tidak disebut`);
  for (const key of Object.keys(job.copies[0])) assert.ok(jobRule.copies.$i[key], `copies/${key} tidak disebut`);
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `cd functions && node --test campaign-copy-jobs.test.mjs`
Expected: FAIL, modul tidak ditemukan.

- [ ] **Step 3: Implementasi** — `functions/campaign-copy-jobs.mjs`:

```js
import {
  activeCopyJob,
  COPY_JOBS_PATH,
  copyJobEntry,
  copyOutcome,
  copyPlan,
  copyShortfall,
  expiredCopyJobIds,
  newCopyJobId,
  stalledJobPatch,
} from "./campaign-manage-core.js";
import { copyAdSetInto, copyCampaignShell, fetchAdSets, fetchCampaignAds, updateCampaign } from "./meta.js";

/**
 * Job salinan campaign, BERTAHAP: campaign tanpa isi → tiap ad set ke dalamnya → ganti nama.
 *
 * Dua langkah dengan dua kontrak. `startCopyJob` memeriksa dan mencatat — ia boleh melempar, dan
 * route menjawabkan lemparannya. `runCopyJob` menyalin di latar sesudah route menjawab, dan TIDAK
 * PERNAH melempar: tiap kegagalannya jadi status job yang dibaca halaman. Job ditulis `requested`
 * SEBELUM Meta disentuh, dan tidak ada satu pun salinan yang diulang otomatis — yang sudah lahir
 * tidak bisa ditarik kembali.
 */

export class JobConflict extends Error {
  constructor() {
    super("Salinan campaign ini masih berjalan — tunggu sampai selesai sebelum menyalin lagi.");
    this.status = 409;
  }
}

// Pesan Meta bisa panjang; aturan database membatasi 1000 karakter.
const clip = (text) => String(text || "").slice(0, 1000);

export async function startCopyJob(store, token, { userId, row, account, names, requestedBy = "", now = new Date() }) {
  const jobs = (await store.read(COPY_JOBS_PATH)) || {};
  if (activeCopyJob(jobs, row.campaignId)) throw new JobConflict();
  const adSets = await fetchAdSets(row.campaignId, token);
  const ads = await fetchCampaignAds(row.campaignId, token);
  const plan = copyPlan(adSets, ads);
  const jobId = newCopyJobId(now);
  await store.update(COPY_JOBS_PATH, {
    [jobId]: copyJobEntry({ source: row, userId, account, names, plan, requestedBy, now }),
  });
  return { jobId, plan };
}

async function renameCopy(campaignId, token, name) {
  try {
    await updateCampaign(campaignId, token, { name });
    return "";
  } catch (error) {
    // Ganti nama yang gagal tidak menggagalkan salinan: ia sudah lahir, dan namanya bisa dibetulkan
    // lewat fitur edit.
    return clip(error.message);
  }
}

async function copyOne(store, token, { jobPath, row, name, plan, progress }) {
  let campaignId;
  try {
    ({ campaignId } = await copyCampaignShell(row.campaignId, token));
  } catch (error) {
    return { name, campaignId: "", error: clip(error.message) };
  }
  const copy = {
    name,
    campaignId,
    adSets: 0,
    adSetsExpected: plan.adSets.length,
    ads: 0,
    adsExpected: plan.adCount,
    error: "",
    renameError: "",
  };
  let adSetError = "";
  for (const set of plan.adSets) {
    try {
      const { adIds } = await copyAdSetInto(set.id, token, { campaignId });
      copy.adSets++;
      copy.ads += adIds.length;
    } catch (error) {
      // Satu ad set yang ditolak tidak menghentikan sisanya: yang lain bisa saja memakai Halaman yang
      // izinnya sudah benar.
      adSetError ||= clip(`${set.name || set.id}: ${error.message}`);
    }
    progress.done++;
    await store.update(jobPath, { progress: { ...progress }, updatedAt: new Date().toISOString() });
  }
  copy.renameError = await renameCopy(campaignId, token, name);
  copy.error = adSetError || copyShortfall(copy);
  return copy;
}

export async function runCopyJob(
  store,
  token,
  { jobId, row, account, names, plan, enqueueSync = () => {}, log = console },
) {
  const jobPath = `${COPY_JOBS_PATH}/${jobId}`;
  const copies = [];
  try {
    const progress = { done: 0, total: names.length * plan.adSets.length };
    const startedAt = new Date().toISOString();
    await store.update(jobPath, { state: "running", startedAt, updatedAt: startedAt, progress });
    for (const name of names) {
      // Sesudah satu campaign gagal disalin, sisanya tidak dicoba: penolakan yang sama akan berulang,
      // dan yang kebetulan lolos menghasilkan salinan yang tidak diharapkan siapa pun.
      if (copies.some((copy) => !copy.campaignId)) {
        copies.push({ name, campaignId: "", error: "Tidak dicoba karena salinan sebelumnya gagal." });
        continue;
      }
      copies.push(await copyOne(store, token, { jobPath, row, name, plan, progress }));
    }
  } catch (error) {
    // Hanya tulisan RTDB yang bisa sampai ke sini (panggilan Meta ditangkap di dalam `copyOne`).
    copies.push({ name: "", campaignId: "", error: clip(error.message) });
  }

  const outcome = copyOutcome(copies);
  const at = new Date().toISOString();
  try {
    await store.update(jobPath, { state: outcome.state, copies, error: clip(outcome.error), updatedAt: at, finishedAt: at });
  } catch (error) {
    // Job tertinggal `running` dan disapu jadi `unknown` — kalimatnya menyuruh memeriksa Ads Manager.
    log.error(`[campaign] job salinan ${jobId} gagal dicatat: ${error.message}`);
  }
  if (copies.some((copy) => copy.campaignId)) enqueueSync(account.id);
  return { jobId, state: outcome.state, copies, error: outcome.error };
}

export async function sweepCopyJobs(store, { now = new Date() } = {}) {
  const jobs = (await store.read(COPY_JOBS_PATH)) || {};
  const updates = {};
  for (const [jobId, job] of Object.entries(jobs)) {
    const stalled = stalledJobPatch(job, now);
    if (stalled) updates[jobId] = { ...job, ...stalled };
  }
  for (const jobId of expiredCopyJobIds(jobs, now)) updates[jobId] = null;
  if (Object.keys(updates).length) await store.update(COPY_JOBS_PATH, updates);
  return { changed: Object.keys(updates).length };
}
```

- [ ] **Step 4: Aturan database** — di `database.rules.json`, di dalam `"dashboard"`, sesudah blok `"telegramInbox": {...}` (beri koma sesudah kurung tutupnya):

```json
      "campaignCopyJobs": {
        "$jobId": {
          ".validate": "!newData.exists() || (newData.hasChildren(['sourceCampaignId', 'state', 'requestedAt']) && $jobId.matches(/^j[0-9a-z]{5,20}$/))",
          "sourceCampaignId": { ".validate": "newData.isString() && newData.val().matches(/^[0-9]{1,30}$/)" },
          "sourceName": { ".validate": "newData.isString() && newData.val().length <= 400" },
          "userId": { ".validate": "newData.isString() && newData.val().length <= 128" },
          "accountId": { ".validate": "newData.isString() && newData.val().length <= 128" },
          "actId": { ".validate": "newData.isString() && newData.val().length <= 64" },
          "count": { ".validate": "newData.isNumber() && newData.val() >= 1 && newData.val() <= 5" },
          "names": { "$i": { ".validate": "newData.isString() && newData.val().length <= 420" } },
          "adSetCount": { ".validate": "newData.isNumber() && newData.val() >= 0 && newData.val() <= 50" },
          "adCount": { ".validate": "newData.isNumber() && newData.val() >= 0 && newData.val() <= 150" },
          "state": { ".validate": "newData.isString() && newData.val().matches(/^(requested|running|done|partial|failed|unknown)$/)" },
          "progress": {
            "done": { ".validate": "newData.isNumber() && newData.val() >= 0 && newData.val() <= 250" },
            "total": { ".validate": "newData.isNumber() && newData.val() >= 0 && newData.val() <= 250" },
            "$other": { ".validate": false }
          },
          "copies": {
            "$i": {
              "name": { ".validate": "newData.isString() && newData.val().length <= 420" },
              "campaignId": { ".validate": "newData.isString() && newData.val().length <= 30" },
              "adSets": { ".validate": "newData.isNumber() && newData.val() >= 0 && newData.val() <= 50" },
              "adSetsExpected": { ".validate": "newData.isNumber() && newData.val() >= 0 && newData.val() <= 50" },
              "ads": { ".validate": "newData.isNumber() && newData.val() >= 0 && newData.val() <= 150" },
              "adsExpected": { ".validate": "newData.isNumber() && newData.val() >= 0 && newData.val() <= 150" },
              "error": { ".validate": "newData.isString() && newData.val().length <= 1000" },
              "renameError": { ".validate": "newData.isString() && newData.val().length <= 1000" },
              "$other": { ".validate": false }
            }
          },
          "error": { ".validate": "newData.isString() && newData.val().length <= 1000" },
          "requestedBy": { ".validate": "newData.isString() && newData.val().length <= 200" },
          "requestedAt": { ".validate": "newData.isString() && newData.val().length <= 40" },
          "startedAt": { ".validate": "newData.isString() && newData.val().length <= 40" },
          "updatedAt": { ".validate": "newData.isString() && newData.val().length <= 40" },
          "finishedAt": { ".validate": "newData.isString() && newData.val().length <= 40" },
          "$other": { ".validate": false }
        }
      }
```

- [ ] **Step 5: Jalankan, pastikan lolos**

Run: `cd functions && npm test`
Expected: PASS. Pastikan JSON sah: `node -e "JSON.parse(require('fs').readFileSync('../database.rules.json','utf8'))"`.

- [ ] **Step 6: Lint dan commit**

Run: `npx biome check --write functions/campaign-copy-jobs.mjs functions/campaign-copy-jobs.test.mjs`

```bash
git add functions/campaign-copy-jobs.mjs functions/campaign-copy-jobs.test.mjs database.rules.json
git commit -m "feat(campaign): job salin bertahap berikut aturan database-nya"
```

---

### Task 20: Server — route `/fleet` dengan salinan di latar (pengganti Task 9)

**Files:**
- Create: `server/campaign-manage.js`
- Test: `server/campaign-manage.test.mjs`

**Interfaces:**
- Consumes: Task 4 (`fetchCampaignForEdit`, `updateCampaign`, `fetchAdSetForEdit`, `updateAdSet`), Task 5–6/18 (aturan), Task 19 (`startCopyJob`, `runCopyJob`, `JobConflict`), Task 8 (`campaignRowOf`).
- Produces: `campaignManageRoutes({ db, store, metaToken, enqueueSync?, runInBackground?, authorize? }) => Elysia`. `runInBackground(task)` menerima fungsi tanpa argumen yang mengembalikan promise; bawaannya menjalankannya tanpa ditunggu (`runCopyJob` tidak pernah melempar).

| Method + path | Body/query | Jawaban 200 |
|---|---|---|
| `POST /fleet/campaigns/:campaignId/copies` | `{ userId, name, count, confirmSubDomain? }` | `{ jobId, state: "running", adSets, ads }` — penyalinan berjalan sesudah jawaban ini |
| `GET /fleet/campaigns/:campaignId` | `?userId=` | `{ campaign: { id, name, status, dailyBudget, lifetimeBudget, accountId, budget: { editable, reason } }, mapping: { subDomain, source, code } }` |
| `POST /fleet/campaigns/:campaignId` | `{ userId, name?, dailyBudget?, confirmSubDomain? }` | `{ campaignId, applied: true, changed: string[] }` |
| `GET /fleet/campaigns/:campaignId/adsets/:adSetId` | `?userId=` | `{ adSet: { id, name, campaignId, status, dailyBudget, lifetimeBudget, budget, targeting: { editable, reason, countries, ageMin, ageMax } } }` |
| `POST /fleet/campaigns/:campaignId/adsets/:adSetId` | `{ userId, name?, dailyBudget?, countries?, ageMin?, ageMax? }` | `{ campaignId, adSetId, applied: true, changed: string[] }` |

Jawaban gagal: 403 (bukan superadmin), 404, 409 `{ error, needsConfirm: true, subDomain }` (konfirmasi) atau `{ error }` (salinan berjalan), 422, 502, 503.

- [ ] **Step 1: Tulis tes yang gagal** — `server/campaign-manage.test.mjs`:

```js
import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { AuthError } from "./auth.js";
import { campaignManageRoutes } from "./campaign-manage.js";

// HARUS "localhost" — lihat campaigns.test.mjs.
const URL_BASE = "http://localhost";

function fakeStore(data = {}) {
  const state = structuredClone(data);
  const at = (path) => path.split("/").reduce((node, key) => node?.[key], state);
  return {
    state,
    read: async (path) => structuredClone(at(path) ?? null),
    update: async (path, values) => {
      for (const [key, value] of Object.entries(values)) {
        const parts = `${path}/${key}`.split("/");
        const last = parts.pop();
        let node = state;
        for (const part of parts) node = node[part] ??= {};
        if (value === null) delete node[last];
        else node[last] = structuredClone(value);
      }
    },
  };
}

const DATA = {
  users: {
    u_nur: {
      email: "nur@rabbitracing.live",
      name: "Nurjaman",
      campaigns: [
        { campaignId: "120210", campaign: "TvH1-06 Pros", adAccount: "act_1", subDomain: "puppy.petcins.com", subDomainSource: "code" },
        { campaignId: "120211", campaign: "Tanpa kode", adAccount: "act_1" },
      ],
    },
  },
  subDomains: {
    s1: { name: "puppy.petcins.com", campaignCodes: "TvH1" },
    s2: { name: "dog.petcins.com", campaignCodes: "5rx7" },
  },
  adAccounts: { k1: { actId: "act_1", name: "TBZ 1247" } },
};

const SUPER = { role: "superadmin", email: "super@r.live", uid: "s1" };

function build({ authorize, metaToken = "token", data = DATA } = {}) {
  const store = fakeStore(data);
  const synced = [];
  const runs = [];
  const app = new Elysia().use(
    campaignManageRoutes({
      db: {},
      store,
      metaToken,
      enqueueSync: (id) => synced.push(id),
      // Tes MENUNGGU penyalinan di latar lewat `runs`; di produksi ia berjalan tanpa ditunggu.
      runInBackground: (task) => runs.push(task()),
      authorize: authorize || (async () => SUPER),
    }),
  );
  return { app, store, synced, runs };
}

function send(app, path, payload) {
  const init =
    payload === undefined
      ? { headers: { authorization: "Bearer t" } }
      : {
          method: "POST",
          headers: { authorization: "Bearer t", "content-type": "application/json" },
          body: JSON.stringify(payload),
        };
  return app.handle(new Request(`${URL_BASE}${path}`, init));
}

// Kunci rute: "METHOD /path-tanpa-versi". Nilai: [body, ok?].
function metaStub(routes) {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    const u = new URL(String(url));
    const key = `${options?.method || "GET"} ${u.pathname.replace(/^\/v25\.0/, "")}`;
    calls.push({ key, params: u.searchParams });
    const handler = routes[key];
    if (!handler) throw new Error(`panggilan tak terduga: ${key}`);
    const [body, ok = true] = handler;
    return Response.json(body, { status: ok ? 200 : 400 });
  };
  return calls;
}

// Sumber 120210: satu ad set, satu iklan.
const COPY_ROUTES = {
  "GET /120210/adsets": [{ data: [{ id: "555", name: "Adset 1", status: "ACTIVE" }] }],
  "GET /120210/ads": [{ data: [{ id: "a1", adset_id: "555", status: "ACTIVE" }] }],
  "POST /120210/copies": [{ copied_campaign_id: "900" }],
  "POST /555/copies": [{ copied_adset_id: "901", ad_object_ids: [{ ad_object_type: "ad", copied_id: "911" }] }],
  "POST /900": [{ success: true }],
};

describe("gerbang /fleet", () => {
  it("bukan superadmin: 403 dengan kalimat halaman ini, Meta tidak disentuh", async () => {
    const calls = metaStub({});
    const { app } = build({
      authorize: async () => {
        throw new AuthError("Hanya superadmin yang boleh menjalankan gating.", 403);
      },
    });
    const res = await send(app, "/fleet/campaigns/120210/copies", { userId: "u_nur", name: "TvH1-07", count: 1 });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Hanya superadmin yang boleh mengelola campaign.");
    expect(calls.length).toBe(0);
  });

  it("tanpa META_ACCESS_TOKEN: 503", async () => {
    metaStub({});
    const { app } = build({ metaToken: "" });
    expect((await send(app, "/fleet/campaigns/120210?userId=u_nur")).status).toBe(503);
  });

  it("campaign yang bukan milik profil itu: 404, Meta tidak disentuh", async () => {
    const calls = metaStub({});
    const { app } = build();
    const res = await send(app, "/fleet/campaigns/999/copies", { userId: "u_nur", name: "TvH1-07", count: 1 });
    expect(res.status).toBe(404);
    expect(calls.length).toBe(0);
  });
});

describe("POST /fleet/campaigns/:id/copies", () => {
  it("menjawab running seketika, lalu menyalin bertahap di latar", async () => {
    const calls = metaStub(COPY_ROUTES);
    const { app, store, synced, runs } = build();
    const res = await send(app, "/fleet/campaigns/120210/copies", { userId: "u_nur", name: "TvH1-07 Pros", count: 1 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ state: "running", adSets: 1, ads: 1 });
    expect(store.state.dashboard.campaignCopyJobs[body.jobId].requestedBy).toBe("super@r.live");
    await Promise.all(runs);
    expect(store.state.dashboard.campaignCopyJobs[body.jobId].state).toBe("done");
    expect(calls.find((call) => call.key === "POST /555/copies").params.get("campaign_id")).toBe("900");
    expect(calls.find((call) => call.key === "POST /900").params.get("name")).toBe("TvH1-07 Pros");
    expect(synced).toEqual(["k1"]);
  });

  it("kode milik subdomain lain: 422, Meta tidak disentuh", async () => {
    const calls = metaStub(COPY_ROUTES);
    const { app } = build();
    const res = await send(app, "/fleet/campaigns/120210/copies", { userId: "u_nur", name: "5rx7-01 Pros", count: 1 });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain("dog.petcins.com");
    expect(calls.length).toBe(0);
  });

  it("campaign belum terpetakan: 409 minta konfirmasi, lalu jalan dengan konfirmasi", async () => {
    metaStub({
      "GET /120211/adsets": [{ data: [{ id: "556", name: "Adset X", status: "PAUSED" }] }],
      "GET /120211/ads": [{ data: [] }],
      "POST /120211/copies": [{ copied_campaign_id: "905" }],
      "POST /556/copies": [{ copied_adset_id: "906", ad_object_ids: [] }],
      "POST /905": [{ success: true }],
    });
    const { app, runs } = build();
    const first = await send(app, "/fleet/campaigns/120211/copies", { userId: "u_nur", name: "5rx7-01 Pros", count: 1 });
    expect(first.status).toBe(409);
    expect(await first.json()).toMatchObject({ needsConfirm: true, subDomain: "dog.petcins.com" });
    const second = await send(app, "/fleet/campaigns/120211/copies", {
      userId: "u_nur",
      name: "5rx7-01 Pros",
      count: 1,
      confirmSubDomain: "dog.petcins.com",
    });
    expect(second.status).toBe(200);
    await Promise.all(runs);
  });

  it("salinan yang masih berjalan: 409 tanpa needsConfirm", async () => {
    metaStub(COPY_ROUTES);
    const { app } = build({
      data: { ...DATA, dashboard: { campaignCopyJobs: { jold: { sourceCampaignId: "120210", state: "running" } } } },
    });
    const res = await send(app, "/fleet/campaigns/120210/copies", { userId: "u_nur", name: "TvH1-07", count: 1 });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("masih berjalan");
    expect(body.needsConfirm).toBeUndefined();
  });

  it("ad set di atas 3 iklan: 422 sebelum job ditulis", async () => {
    const calls = metaStub({
      ...COPY_ROUTES,
      "GET /120210/ads": [{ data: Array.from({ length: 4 }, (_, i) => ({ id: `a${i}`, adset_id: "555", status: "ACTIVE" })) }],
    });
    const { app, store } = build();
    const res = await send(app, "/fleet/campaigns/120210/copies", { userId: "u_nur", name: "TvH1-07", count: 1 });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain("lebih dari 3 iklan");
    expect(store.state.dashboard).toBeUndefined();
    expect(calls.some((call) => call.key.startsWith("POST"))).toBe(false);
  });

  it("daftar ad set gagal dibaca: 502, tanpa job", async () => {
    metaStub({ "GET /120210/adsets": [{ error: { message: "Invalid OAuth access token", code: 190 } }, false] });
    const { app, store } = build();
    const res = await send(app, "/fleet/campaigns/120210/copies", { userId: "u_nur", name: "TvH1-07", count: 1 });
    expect(res.status).toBe(502);
    expect(store.state.dashboard).toBeUndefined();
  });

  it("jumlah salinan di luar 1–5 ditolak validator", async () => {
    metaStub({});
    const { app } = build();
    const res = await send(app, "/fleet/campaigns/120210/copies", { userId: "u_nur", name: "TvH1-07", count: 9 });
    expect(res.status).toBe(422);
  });
});

describe("ubah campaign", () => {
  it("GET: nilai segar dari Meta berikut boleh-tidaknya anggaran diubah", async () => {
    metaStub({ "GET /120210": [{ id: "120210", name: "TvH1-06 Pros", status: "ACTIVE", daily_budget: "50000" }] });
    const { app } = build();
    const body = await (await send(app, "/fleet/campaigns/120210?userId=u_nur")).json();
    expect(body.campaign.dailyBudget).toBe(50000);
    expect(body.campaign.budget).toEqual({ editable: true, reason: "" });
    expect(body.mapping).toEqual({ subDomain: "puppy.petcins.com", source: "code", code: "" });
  });

  it("ganti nama ke kode subdomain yang sama: ditulis, akun masuk antrean sync", async () => {
    const calls = metaStub({ "POST /120210": [{ success: true }] });
    const { app, synced } = build();
    const res = await send(app, "/fleet/campaigns/120210", { userId: "u_nur", name: "TvH1-07 Pros" });
    expect(res.status).toBe(200);
    expect(calls[0].params.get("name")).toBe("TvH1-07 Pros");
    expect(synced).toEqual(["k1"]);
  });

  it("ganti nama ke kode subdomain lain: 422", async () => {
    const calls = metaStub({});
    const { app } = build();
    expect((await send(app, "/fleet/campaigns/120210", { userId: "u_nur", name: "5rx7-02 Pros" })).status).toBe(422);
    expect(calls.length).toBe(0);
  });

  it("anggaran untuk campaign ABO: 422 sebelum menulis", async () => {
    const calls = metaStub({ "GET /120210": [{ id: "120210", name: "TvH1-06 Pros", status: "ACTIVE" }] });
    const { app } = build();
    const res = await send(app, "/fleet/campaigns/120210", { userId: "u_nur", dailyBudget: 75000 });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain("dipegang ad set");
    expect(calls.some((call) => call.key.startsWith("POST"))).toBe(false);
  });

  it("anggaran di bawah minimum Meta: 422 dengan kalimat Meta", async () => {
    metaStub({
      "GET /120210": [{ id: "120210", daily_budget: "50000" }],
      "POST /120210": [{ error: { message: "Budget too low", code: 100, error_subcode: 1885272 } }, false],
    });
    const { app } = build();
    const res = await send(app, "/fleet/campaigns/120210", { userId: "u_nur", dailyBudget: 100 });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain("Budget too low");
  });

  it("tanpa perubahan: 422", async () => {
    metaStub({});
    const { app } = build();
    const res = await send(app, "/fleet/campaigns/120210", { userId: "u_nur" });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain("Tidak ada yang diubah");
  });
});

describe("ubah ad set", () => {
  const ADSET = {
    id: "555",
    name: "Adset 1",
    campaign_id: "120210",
    status: "ACTIVE",
    targeting: { age_min: 18, age_max: 65, geo_locations: { countries: ["TR"] }, flexible_spec: [{ interests: [{ id: "1" }] }] },
  };

  it("ad set milik campaign lain: 404, tidak ada yang ditulis", async () => {
    const calls = metaStub({ "GET /555": [{ ...ADSET, campaign_id: "999" }] });
    const { app } = build();
    expect((await send(app, "/fleet/campaigns/120210/adsets/555", { userId: "u_nur", name: "X" })).status).toBe(404);
    expect(calls.some((call) => call.key.startsWith("POST"))).toBe(false);
  });

  it("GET: targeting diringkas, anggaran CBO tidak bisa diubah di ad set", async () => {
    metaStub({ "GET /555": [ADSET] });
    const { app } = build();
    const body = await (await send(app, "/fleet/campaigns/120210/adsets/555?userId=u_nur")).json();
    expect(body.adSet.targeting).toEqual({ editable: true, reason: "", countries: ["TR"], ageMin: 18, ageMax: 65 });
    expect(body.adSet.budget.reason).toContain("dipegang campaign");
  });

  it("negara diganti, isi targeting lain dikirim utuh", async () => {
    const calls = metaStub({ "GET /555": [ADSET], "POST /555": [{ success: true }] });
    const { app } = build();
    const res = await send(app, "/fleet/campaigns/120210/adsets/555", { userId: "u_nur", countries: ["tr", "mx"] });
    expect(res.status).toBe(200);
    const sent = JSON.parse(calls.find((call) => call.key === "POST /555").params.get("targeting"));
    expect(sent.geo_locations.countries).toEqual(["TR", "MX"]);
    expect(sent.flexible_spec).toEqual([{ interests: [{ id: "1" }] }]);
  });

  it("lokasi berkota: 422, tidak ada yang ditulis", async () => {
    const withCities = { ...ADSET, targeting: { ...ADSET.targeting, geo_locations: { countries: ["TR"], cities: [{ key: "1" }] } } };
    const calls = metaStub({ "GET /555": [withCities] });
    const { app } = build();
    expect((await send(app, "/fleet/campaigns/120210/adsets/555", { userId: "u_nur", ageMin: 21 })).status).toBe(422);
    expect(calls.some((call) => call.key.startsWith("POST"))).toBe(false);
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `cd server && bun test campaign-manage.test.mjs`
Expected: FAIL, modul tidak ditemukan.

- [ ] **Step 3: Implementasi** — `server/campaign-manage.js`:

```js
import { Elysia, status, t } from "elysia";
import { JobConflict, runCopyJob, startCopyJob } from "../functions/campaign-copy-jobs.mjs";
import {
  accountOfCampaignRow,
  assertConfirmed,
  budgetState,
  ConfirmRequired,
  campaignNameVerdict,
  copyNames,
  mergeTargeting,
  metaFailureStatus,
  parseBudget,
  RuleError,
  targetingState,
} from "../functions/campaign-manage-core.js";
import { fetchAdSetForEdit, fetchCampaignForEdit, updateAdSet, updateCampaign } from "../functions/meta.js";
import { buildCodeIndex } from "../functions/sync-core.js";
import { AuthError, bearerToken, requireSuperAdmin } from "./auth.js";
import { campaignRowOf } from "./campaign-rows.js";

/**
 * Halaman Campaign (/campaigns): salin dan ubah campaign Meta. SUPERADMIN saja.
 *
 * Yang menegakkan izinnya gerbang di sini, bukan aturan database: anggaran, nama, dan targeting
 * tidak menulis satu pun baris RTDB. Campaign dicari di profil pemiliknya (`campaignRowOf`) dan ad
 * set dibuktikan milik campaign itu dengan membacanya ulang dari Meta — tanpa keduanya, route ini
 * jadi editor Meta untuk objek mana pun di Business Manager.
 *
 * Salinan dijalankan DI LATAR sesudah route menjawab: satu salinan bisa berarti puluhan panggilan
 * (campaign, lalu tiap ad set), dan progresnya sudah ditulis ke node job yang dilanggan halaman.
 */
const USER_ID = t.String({ minLength: 1, maxLength: 128 });
const CAMPAIGN_PARAMS = t.Object({ campaignId: t.String({ pattern: "^[0-9]+$" }) });
const ADSET_PARAMS = t.Object({
  campaignId: t.String({ pattern: "^[0-9]+$" }),
  adSetId: t.String({ pattern: "^[0-9]+$" }),
});
const BUDGET = t.Optional(t.Union([t.Number(), t.String({ maxLength: 20 })]));
const CONFIRM = t.Optional(t.String({ maxLength: 300 }));

// `runCopyJob` tidak pernah melempar, jadi menjalankannya tanpa ditunggu tidak meninggalkan
// penolakan yang tak tertangani.
const detached = (task) => {
  task();
};

export function campaignManageRoutes({
  db,
  store,
  metaToken,
  enqueueSync = () => {},
  runInBackground = detached,
  authorize,
}) {
  const check = authorize || ((token) => requireSuperAdmin(db, token));

  const failure = (error) => {
    if (error instanceof ConfirmRequired) {
      return status(409, { error: error.message, needsConfirm: true, subDomain: error.subDomain });
    }
    if (error instanceof RuleError || error instanceof JobConflict) {
      return status(error.status, { error: error.message });
    }
    return status(metaFailureStatus(error?.message), { error: error?.message || "Meta tidak menjawab." });
  };

  const owned = async (userId, campaignId) => {
    if (!metaToken) return { stop: status(503, { error: "META_ACCESS_TOKEN belum di-set di server." }) };
    const { row, notFound } = await campaignRowOf(store, userId, campaignId);
    return notFound ? { stop: notFound } : { row };
  };

  const codeIndex = async () => buildCodeIndex((await store.read("subDomains")) || {}).byCode;
  const accountOf = async (row) => accountOfCampaignRow((await store.read("adAccounts")) || {}, row);

  const ownedAdSet = async (campaignId, adSetId) => {
    const adSet = await fetchAdSetForEdit(adSetId, metaToken);
    return adSet.campaignId === String(campaignId)
      ? { adSet }
      : { stop: status(404, { error: "Ad set ini bukan milik campaign tersebut." }) };
  };

  return new Elysia({ prefix: "/fleet" })
    .macro({
      superadmin: {
        async resolve({ headers }) {
          try {
            return { actor: await check(bearerToken(headers.authorization)) };
          } catch (error) {
            if (error instanceof AuthError) {
              return status(error.status, {
                error: error.status === 403 ? "Hanya superadmin yang boleh mengelola campaign." : error.message,
              });
            }
            return status(503, { error: `Izin tidak bisa diperiksa sekarang: ${error.message}` });
          }
        },
      },
    })

    .post(
      "/campaigns/:campaignId/copies",
      async ({ params, body, actor }) => {
        const { row, stop } = await owned(body.userId, params.campaignId);
        if (stop) return stop;
        try {
          const names = copyNames(body.name, body.count);
          assertConfirmed(campaignNameVerdict(row, names[0], await codeIndex()), body.confirmSubDomain);
          const account = await accountOf(row);
          if (!account) throw new RuleError("Ad account campaign ini tidak terdaftar di /ad-accounts.");
          const { jobId, plan } = await startCopyJob(store, metaToken, {
            userId: body.userId,
            row,
            account,
            names,
            requestedBy: actor.email || actor.uid,
          });
          runInBackground(() => runCopyJob(store, metaToken, { jobId, row, account, names, plan, enqueueSync }));
          return { jobId, state: "running", adSets: plan.adSets.length, ads: plan.adCount };
        } catch (error) {
          return failure(error);
        }
      },
      {
        superadmin: true,
        params: CAMPAIGN_PARAMS,
        body: t.Object({
          userId: USER_ID,
          name: t.String({ minLength: 1, maxLength: 400 }),
          count: t.Integer({ minimum: 1, maximum: 5 }),
          confirmSubDomain: CONFIRM,
        }),
      },
    )

    .get(
      "/campaigns/:campaignId",
      async ({ params, query }) => {
        const { row, stop } = await owned(query.userId, params.campaignId);
        if (stop) return stop;
        try {
          const campaign = await fetchCampaignForEdit(params.campaignId, metaToken);
          return {
            campaign: { ...campaign, budget: budgetState("campaign", campaign) },
            mapping: { subDomain: row.subDomain || "", source: row.subDomainSource || "", code: row.campaignCode || "" },
          };
        } catch (error) {
          return failure(error);
        }
      },
      { superadmin: true, params: CAMPAIGN_PARAMS, query: t.Object({ userId: USER_ID }) },
    )

    .post(
      "/campaigns/:campaignId",
      async ({ params, body }) => {
        const { row, stop } = await owned(body.userId, params.campaignId);
        if (stop) return stop;
        try {
          const changes = {};
          if (body.name !== undefined) {
            const name = body.name.trim();
            assertConfirmed(campaignNameVerdict(row, name, await codeIndex()), body.confirmSubDomain);
            changes.name = name;
          }
          if (body.dailyBudget !== undefined) {
            const budget = budgetState("campaign", await fetchCampaignForEdit(params.campaignId, metaToken));
            if (!budget.editable) throw new RuleError(budget.reason);
            changes.dailyBudget = parseBudget(body.dailyBudget);
          }
          if (!Object.keys(changes).length) throw new RuleError("Tidak ada yang diubah.");
          await updateCampaign(params.campaignId, metaToken, changes);
          // Penyegaran dua menitan tidak membaca nama, padahal nama itulah pemetaannya.
          if (changes.name) {
            const account = await accountOf(row);
            if (account) enqueueSync(account.id);
          }
          return { campaignId: params.campaignId, applied: true, changed: Object.keys(changes) };
        } catch (error) {
          return failure(error);
        }
      },
      {
        superadmin: true,
        params: CAMPAIGN_PARAMS,
        body: t.Object({
          userId: USER_ID,
          name: t.Optional(t.String({ minLength: 1, maxLength: 400 })),
          dailyBudget: BUDGET,
          confirmSubDomain: CONFIRM,
        }),
      },
    )

    .get(
      "/campaigns/:campaignId/adsets/:adSetId",
      async ({ params, query }) => {
        const { stop } = await owned(query.userId, params.campaignId);
        if (stop) return stop;
        try {
          const found = await ownedAdSet(params.campaignId, params.adSetId);
          if (found.stop) return found.stop;
          // Targeting mentah TIDAK dikirim ke browser: yang digambar form cuma negara dan umur, dan
          // yang ditulis kembali disusun server dari bacaan segar, bukan dari salinan di layar.
          const { targeting, ...adSet } = found.adSet;
          return { adSet: { ...adSet, budget: budgetState("adset", adSet), targeting: targetingState(targeting) } };
        } catch (error) {
          return failure(error);
        }
      },
      { superadmin: true, params: ADSET_PARAMS, query: t.Object({ userId: USER_ID }) },
    )

    .post(
      "/campaigns/:campaignId/adsets/:adSetId",
      async ({ params, body }) => {
        const { stop } = await owned(body.userId, params.campaignId);
        if (stop) return stop;
        try {
          const found = await ownedAdSet(params.campaignId, params.adSetId);
          if (found.stop) return found.stop;
          const current = found.adSet;
          const changes = {};
          if (body.name !== undefined) {
            const name = body.name.trim();
            if (!name) throw new RuleError("Nama ad set wajib diisi.");
            changes.name = name;
          }
          if (body.dailyBudget !== undefined) {
            const budget = budgetState("adset", current);
            if (!budget.editable) throw new RuleError(budget.reason);
            changes.dailyBudget = parseBudget(body.dailyBudget);
          }
          if (body.countries !== undefined || body.ageMin !== undefined || body.ageMax !== undefined) {
            changes.targeting = mergeTargeting(current.targeting, {
              countries: body.countries,
              ageMin: body.ageMin,
              ageMax: body.ageMax,
            });
          }
          if (!Object.keys(changes).length) throw new RuleError("Tidak ada yang diubah.");
          await updateAdSet(current.id, metaToken, changes);
          return { campaignId: params.campaignId, adSetId: current.id, applied: true, changed: Object.keys(changes) };
        } catch (error) {
          return failure(error);
        }
      },
      {
        superadmin: true,
        params: ADSET_PARAMS,
        body: t.Object({
          userId: USER_ID,
          name: t.Optional(t.String({ maxLength: 400 })),
          dailyBudget: BUDGET,
          countries: t.Optional(t.Array(t.String({ maxLength: 8 }), { maxItems: 250 })),
          ageMin: t.Optional(t.Number()),
          ageMax: t.Optional(t.Number()),
        }),
      },
    );
}
```

- [ ] **Step 4: Jalankan, pastikan lolos**

Run: `cd server && bun test`
Expected: PASS seluruhnya.

- [ ] **Step 5: Lint dan commit**

Run: `npx biome check --write server/campaign-manage.js server/campaign-manage.test.mjs`

```bash
git add server/campaign-manage.js server/campaign-manage.test.mjs
git commit -m "feat(server): route superadmin untuk salin bertahap dan ubah campaign Meta"
```

---

### Task 21: Server — wiring di `index.js` (pengganti Task 10)

**Files:**
- Modify: `server/index.js` (import; konstanta cron; `runCampaignCycle` baris 261–305; siklus penyapu job; rantai `app`; log start)

**Interfaces:**
- Consumes: Task 19 (`sweepCopyJobs`), Task 8 (`createLock`, `createAccountSyncQueue`), Task 20 (`campaignManageRoutes`), `syncCampaigns` dari `../functions/sync-meta.mjs`.

`index.js` menyambung RTDB dan membuka port saat diimpor, jadi tidak ada unit test untuknya. Verifikasinya: seluruh tes server lolos dan bundelnya terbentuk.

- [ ] **Step 1: Import** — ganti baris `import { refreshCampaignStatuses } from "../functions/sync-meta.mjs";` dan tambahkan (urut abjad di antara import yang ada):

```js
import { sweepCopyJobs } from "../functions/campaign-copy-jobs.mjs";
import { refreshCampaignStatuses, syncCampaigns } from "../functions/sync-meta.mjs";
import { createAccountSyncQueue } from "./account-sync-queue.js";
import { createLock } from "./campaign-lock.js";
import { campaignManageRoutes } from "./campaign-manage.js";
```

- [ ] **Step 2: Konstanta cron** — sesudah `SYNC_RUNS_CRON`:

```js
/**
 * Penyapu job salinan campaign dari halaman /campaigns: yang menggantung jadi `unknown`, yang lebih
 * dari 7 hari dibuang. Tidak ada yang dipantau di Meta — penyalinan berjalan di dalam proses ini
 * sesudah route menjawab — jadi lima menit sekali cukup. Biayanya satu bacaan RTDB yang dijawab
 * cache penghangat.
 */
const CAMPAIGN_JOBS_CRON = process.env.CAMPAIGN_JOBS_CRON || "20 */5 * * * *";
```

- [ ] **Step 3: Penjaga bersama dan antrean sync** — ganti blok `let campaignRunning = false;` sampai akhir `runCampaignCycle` dengan:

```js
/**
 * Satu penjaga untuk dua penulis `users/{id}/campaigns`: siklus campaign dua menitan dan sync akun
 * sesudah campaign diubah dari halaman /campaigns. Siklus cron MELEWATI putarannya kalau sibuk
 * (`tryRun`); antrean sync MENUNGGU (`run`) — perubahan yang baru dibuat orang tidak boleh
 * dibuang karena kebetulan berbarengan dengan penyegaran status.
 */
const campaignLock = createLock();

const accountSync = createAccountSyncQueue({
  lock: campaignLock,
  run: async (ids) => {
    const res = await syncCampaigns(db, META_TOKEN, ids);
    console.log(`[campaign] sync akun ${ids.join(", ")}: ${res.campaigns} campaign di ${res.updated} user.`);
  },
});

async function runCampaignCycle(source) {
  if (!META_TOKEN) return;
  const started = campaignLock.tryRun(async () => {
    /**
     * SEBELUM penerap antrean, dan urutan ini KEBALIKAN dari gating.
     *
     * Di gating, vi-control membaca ulang dan memverifikasi sebelum menjawab, jadi cermin disegarkan
     * SESUDAH. Di sini Meta butuh waktu menampakkan perubahan: bacaan status yang datang setelah
     * penerap akan menimpa perintah yang baru diterapkan dengan keadaan lamanya, dan tombol yang
     * baru ditekan melompat balik ke posisi semula di layar.
     */
    try {
      const res = await refreshCampaignStatuses(db, META_TOKEN);
      if (res.fields) {
        console.log(`[campaign] status disegarkan: ${res.fields} kolom di ${res.users} user.`);
      }
      for (const error of res.errors) {
        console.error(`[campaign] status ${error.name} gagal dibaca: ${error.message}`);
      }
    } catch (error) {
      // Antrean tetap jalan: yang gagal cuma pembacaan status, dan perintah yang sudah ditulis orang
      // tidak ada hubungannya dengan itu.
      console.error(`[campaign] penyegaran status gagal: ${error.message}`);
    }

    const res = await applyCampaignCommands(store, META_TOKEN);
    if (res.pending || res.cleaned) {
      console.log(
        `[campaign] ${source}: ${res.applied} diterapkan, ${res.failed} gagal, dari ${res.pending} antrean.`,
      );
    }
  });
  if (!started) {
    console.warn(`[campaign] ${source} dilewati: siklus atau sync akun sebelumnya masih jalan.`);
    return;
  }
  try {
    await started;
  } catch (error) {
    console.error(`[campaign] ${source} gagal: ${error.message}`);
  }
}

async function runCopyJobsSweep(source) {
  try {
    const res = await sweepCopyJobs(store);
    if (res.changed) console.log(`[campaign] ${source}: ${res.changed} job salinan disapu.`);
  } catch (error) {
    console.error(`[campaign] penyapu job salinan ${source} gagal: ${error.message}`);
  }
}
```

- [ ] **Step 4: Rantai `app`** — sesudah blok `.use(cron({ name: "telegram-inbox", ... }))`:

```js
  .use(
    cron({
      name: "campaign-copy-jobs",
      pattern: CAMPAIGN_JOBS_CRON,
      timezone: TIMEZONE,
      catch: true,
      run: () => runCopyJobsSweep("cron"),
    }),
  )
```

Sesudah `.use(campaignRoutes({ db, store, metaToken: META_TOKEN }))`:

```js
  /**
   * Halaman Campaign (/campaigns) — salin bertahap dan ubah campaign Meta. SUPERADMIN, gerbangnya di
   * campaign-manage.js. Salinan berjalan di latar proses ini; tiap tulisan yang berhasil memasukkan
   * ad account-nya ke antrean sync, supaya campaign salinan dan nama baru tampil di tabel tanpa
   * menunggu sync per jam.
   */
  .use(campaignManageRoutes({ db, store, metaToken: META_TOKEN, enqueueSync: accountSync.enqueue }))
```

Di akhir berkas, sesudah log `[plugin] percobaan ulang ...`:

```js
console.log(
  META_TOKEN
    ? `[campaign] halaman Campaign aktif — penyapu job salinan cron "${CAMPAIGN_JOBS_CRON}"`
    : "[campaign] META_ACCESS_TOKEN belum di-set — halaman Campaign tidak bisa menulis ke Meta.",
);
```

- [ ] **Step 5: Verifikasi**

Run: `cd server && bun test`
Expected: PASS.

Run: `cd server && bun build index.js --target=bun --outdir ../.tmp-build-check`
Expected: bundel terbentuk tanpa error resolusi import. Lalu hapus: `rm -rf ../.tmp-build-check` (PowerShell: `Remove-Item -Recurse -Force ..\.tmp-build-check`).

- [ ] **Step 6: Lint dan commit**

Run: `npx biome check --write server/index.js`

```bash
git add server/index.js
git commit -m "feat(server): pasang route Campaign, penyapu job salinan, dan antrean sync akun"
```

---

### Task 22: Frontend — panel Salinan dan dialog mengikuti salin bertahap

Mengubah kode Task 14 yang sudah ada.

**Files:**
- Modify: `src/lib/campaignFleet.js` (`copyJobRows`, `copyJobNote`)
- Modify: `src/lib/campaignFleet.test.mjs` (tes `"baris job: terbaru dulu, label dan jumlah yang lahir"`)
- Modify: `src/components/campaigns/CampaignDialogs.jsx` (`CopyCampaignDialog`: toast dan catatan)

**Interfaces:**
- Consumes: bentuk job Task 19 — `state`, `progress: { done, total }`, `adSetCount`, `adCount`, `copies[i]: { name, campaignId, adSets, adSetsExpected, ads, adsExpected, error, renameError }`; tidak ada lagi `mode`. Route salin Task 20 SELALU menjawab `{ jobId, state: "running", adSets, ads }`.
- Produces: tiap baris `copyJobRows` membawa `progress: { done, total }` (nol kalau tidak ada) dan tidak lagi `mode`; `copyJobNote` untuk job berjalan menyebut progres ad set.

- [ ] **Step 1: Ubah tes lebih dulu** — di `src/lib/campaignFleet.test.mjs`, pada tes `"baris job: terbaru dulu, label dan jumlah yang lahir"`:

1. Ganti objek `jb` dengan:

```js
    jb: { state: "running", sourceCampaignId: "2", sourceName: "B", names: { 0: "B #1", 1: "B #2" }, count: 2, progress: { done: 3, total: 10 }, requestedAt: "2026-09-11T00:00:00.000Z" },
```

2. Ganti baris `assert.equal(copyJobNote(rows[0]), "Meta sedang menyalin di antrean asinkron.");` dengan:

```js
  assert.deepEqual(rows[0].progress, { done: 3, total: 10 });
  assert.equal(copyJobNote(rows[0]), "Menyalin ad set 3 dari 10.");
  assert.equal(copyJobNote({ state: "requested", progress: { done: 0, total: 0 } }), "Sedang disiapkan.");
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `node --test src/lib/campaignFleet.test.mjs`
Expected: FAIL pada `progress` / catatan berjalan.

- [ ] **Step 3: Implementasi**

`src/lib/campaignFleet.js` — di objek yang dikembalikan `copyJobRows`, ganti baris `mode: job?.mode || "",` dengan:

```js
        progress: {
          done: Number(job?.progress?.done) || 0,
          total: Number(job?.progress?.total) || 0,
        },
```

Ganti cabang job aktif di `copyJobNote`:

```js
  if (ACTIVE_JOB.has(job.state)) {
    // Salinan berjalan bertahap di server: campaign dulu, lalu tiap ad set ke dalamnya.
    return job.progress?.total ? `Menyalin ad set ${job.progress.done} dari ${job.progress.total}.` : "Sedang disiapkan.";
  }
```

`src/components/campaigns/CampaignDialogs.jsx` — di `CopyCampaignDialog`, ganti blok `notifySuccess(...)` di dalam `send` dengan:

```jsx
      await copyCampaignNow(row.userId, row.campaignId, { name, count, confirmSubDomain });
      notifySuccess("Salinan sedang dibuat di latar — progresnya ada di panel Salinan.");
```

(`const result = await ...` sebelumnya dihapus bersama percabangannya.) Lalu ganti paragraf `<p className="adset-note">Ad set dan iklan ikut disalin. ...</p>` dengan:

```jsx
          <p className="adset-note">
            Campaign disalin dulu, lalu tiap ad set berikut iklannya. Salinan lahir mati (PAUSED): ubah
            anggaran dan targetingnya dulu, lalu nyalakan lewat saklar.
          </p>
          <p className="adset-note">
            Iklan hanya ikut tersalin kalau System User punya izin Create ads di Halaman Facebook
            iklannya; yang tidak ikut disebut di panel Salinan.
          </p>
```

- [ ] **Step 4: Verifikasi**

Run: `npx biome check --write src/lib/campaignFleet.js src/lib/campaignFleet.test.mjs src/components/campaigns/CampaignDialogs.jsx`
Run: `npm test && npm run build`
Expected: PASS dan build sukses.

- [ ] **Step 5: Commit**

```bash
git add src/lib/campaignFleet.js src/lib/campaignFleet.test.mjs src/components/campaigns/CampaignDialogs.jsx
git commit -m "feat(campaign): panel Salinan menyebut progres ad set, dialog mengikuti salin bertahap"
```

---

### Task 23: Script pembuktian salin bertahap + uji produksi (dikerjakan controller bersama pemilik)

Menggantikan isi `functions/tools/meta-copy-probe.mjs` (versi Task 0 menguji jalur asinkron yang sudah dibuang) dengan pembuktian jalur yang benar-benar dipakai, lewat fungsi `meta.js` yang sama dengan server.

**Files:**
- Modify: `functions/tools/meta-copy-probe.mjs` (ganti seluruh isinya)
- Modify: `docs/superpowers/specs/2026-09-11-campaign-fleet-design.md` (lampiran hasil)

**Interfaces:**
- Consumes: Task 17 (`copyCampaignShell`, `copyAdSetInto`), `fetchAdSets`, `fetchCampaignAds`, Task 4 (`updateCampaign` tidak dipakai — nama salinan dibiarkan sama), Task 18 (`copyPlan`).

- [ ] **Step 1: Ganti isi script**

```js
// Pembuktian salin BERTAHAP ke Meta produksi, lewat fungsi meta.js yang sama dengan server:
// campaign tanpa isi -> tiap ad set ke dalamnya -> hitung iklan yang benar-benar lahir.
//
//   cd functions
//   node --env-file-if-exists=.env.sync tools/meta-copy-probe.mjs <campaign_id>          # baca saja
//   node --env-file-if-exists=.env.sync tools/meta-copy-probe.mjs <campaign_id> --run    # MENULIS
//   node --env-file-if-exists=.env.sync tools/meta-copy-probe.mjs --cleanup <campaign_id> # MENULIS
//
// --run membuat SATU salinan PAUSED. Jalankan hanya setelah pemilik akun iklan menyetujuinya.
import { copyPlan } from "../campaign-manage-core.js";
import { copyAdSetInto, copyCampaignShell, fetchAdSets, fetchCampaignAds } from "../meta.js";

const token = process.env.META_ACCESS_TOKEN;
if (!token) {
  console.error("META_ACCESS_TOKEN belum di-set.");
  process.exit(1);
}
const print = (label, value) => console.log(`\n=== ${label} ===\n${JSON.stringify(value, null, 2)}`);
const args = process.argv.slice(2);

if (args[0] === "--cleanup") {
  const id = args[1];
  if (!/^\d+$/.test(id || "")) {
    console.error("ID campaign salinan harus angka.");
    process.exit(1);
  }
  const url = new URL(`https://graph.facebook.com/v25.0/${id}`);
  url.searchParams.set("access_token", token);
  url.searchParams.set("status", "DELETED");
  print("hapus salinan", await (await fetch(url, { method: "POST" })).json());
  process.exit(0);
}

const campaignId = args[0];
if (!/^\d+$/.test(campaignId || "")) {
  console.error("Pakai: meta-copy-probe.mjs <campaign_id> [--run]");
  process.exit(1);
}

const plan = copyPlan(await fetchAdSets(campaignId, token), await fetchCampaignAds(campaignId, token));
print("rencana salin", plan);
if (!args.includes("--run")) {
  console.log("\nMode baca saja. Tambahkan --run untuk benar-benar menyalin.");
  process.exit(0);
}

const { campaignId: copied } = await copyCampaignShell(campaignId, token);
print("campaign salinan", { campaignId: copied });
let ads = 0;
for (const set of plan.adSets) {
  try {
    const result = await copyAdSetInto(set.id, token, { campaignId: copied });
    ads += result.adIds.length;
    print(`ad set ${set.name}`, { ...result, adsExpected: set.ads });
  } catch (error) {
    print(`ad set ${set.name} GAGAL`, { message: error.message });
  }
}
print("ringkasan", { campaignId: copied, ads, adsExpected: plan.adCount, cleanup: `--cleanup ${copied}` });
process.exit(0);
```

- [ ] **Step 2: Verifikasi dan commit** (boleh dikerjakan subagent)

Run: `node --check functions/tools/meta-copy-probe.mjs`

```bash
git add functions/tools/meta-copy-probe.mjs
git commit -m "chore(meta): script pembuktian salin bertahap memakai fungsi server"
```

- [ ] **Step 3: Uji produksi — HANYA sesudah pemilik memastikan System User sudah diberi Halaman dengan izin Create ads, dan menyetujui runnya**

1. `cd functions && node --env-file-if-exists=.env.sync tools/meta-copy-probe.mjs 120257531552730339` (baca saja; campaign uji tbxW-01).
2. Dengan persetujuan: tambah `--run`. Expected: `ringkasan.ads === ringkasan.adsExpected` (1 dari 1).
3. Kalau `ads < adsExpected`: izin Halaman belum berlaku — laporkan ke pemilik, jangan dianggap lolos.
4. Dengan persetujuan: `--cleanup <campaignId salinan>`.
5. Tambahkan baris hasil ke tabel lampiran spec, lalu commit:

```bash
git add docs/superpowers/specs/2026-09-11-campaign-fleet-design.md
git commit -m "docs(campaign): hasil pembuktian salin bertahap di produksi"
```

---

### Task 24: Teks CLAUDE.md untuk Task 16 (versi salin bertahap)

Task 16 Step 1 memakai blok di bawah ini, BUKAN blok lamanya. Task 16 Step 2 (`server/README.md`) memakai tabel yang sama dengan Task 16, dengan dua baris ini menggantikan dua butir terakhirnya:

```markdown
- `CAMPAIGN_JOBS_CRON` (bawaan `20 */5 * * * *`) menyapu job salinan yang menggantung di `dashboard/campaignCopyJobs` dan membuang yang lebih dari 7 hari. Penyalinannya sendiri berjalan di latar proses ini sesudah route menjawab.
- Sync akun sesudah tulisan digabung ~30 detik dan memakai penjaga yang sama dengan siklus campaign.
```

Blok CLAUDE.md (sesudah "### Baris campaign bertahan, kecuali dua hal", sebelum "## Gating Keitaro"):

```markdown
## Halaman Campaign: salin dan kelola campaign Meta dari dashboard

`/campaigns` (SUPERADMIN, grup Aset) memuat campaign seluruh armada dan menulis ke Meta lewat server
kontrol: duplikasi, anggaran harian, nama, dan negara/umur ad set. Aturannya di
[`functions/campaign-manage-core.js`](functions/campaign-manage-core.js), job salinannya di
[`functions/campaign-copy-jobs.mjs`](functions/campaign-copy-jobs.mjs), route-nya di
[`server/campaign-manage.js`](server/campaign-manage.js). Desain dan hasil pembuktiannya:
[docs/superpowers/specs/2026-09-11-campaign-fleet-design.md](docs/superpowers/specs/2026-09-11-campaign-fleet-design.md).

- **Salinan BERTAHAP, bukan satu deep copy**: campaign tanpa isinya (`deep_copy=false`, PAUSED) →
  tiap ad set ACTIVE/PAUSED disalin ke dalamnya (`POST /{ad_set}/copies`, `campaign_id`,
  `deep_copy=true`, `INHERITED_FROM_SOURCE`) → ganti nama. Salinan langsung Meta dibatasi 3 iklan per
  panggilan, dan jalur asinkronnya (`async_batch_requests`) TERTUTUP untuk app ini: satu item ditolak
  `#194` (minimal dua, tidak tertulis di dokumentasi), dua item ditolak `#10` (izin app). Batasnya
  jadi ≤3 iklan per ad set dan ≤50 ad set per campaign, ditolak 422 sebelum menyentuh Meta.
- **Deep copy MELEWATKAN iklan diam-diam kalau System User tidak punya izin Create ads di Halaman
  Facebook creative-nya** — campaign dan ad set tersalin, iklannya tidak, tanpa satu pun error
  (dibuktikan 11 Sep 2026). Karena itu jumlah iklan yang lahir (`ad_object_ids` bertipe `ad`) diadu
  dengan jumlah iklan sumber, dan selisihnya membuat salinan `partial` berikut sebabnya. Tiap Halaman
  yang dipakai iklan armada harus diberikan ke System User di Business Manager.
- **Salinan hanya untuk subdomain yang SAMA.** Link iklan tinggal di creative, dan `object_story_spec`
  tidak bisa diubah. Nama salinan wajib membawa kode Keitaro subdomain sumber; kode subdomain lain
  ditolak.
- **Vonis nama memakai `matchCode` yang sama dengan sync** (kode terdaftar PERTAMA). Campaign yang
  belum terpetakan atau dipetakan manual boleh kode mana pun, tapi server menjawab 409 `needsConfirm`
  berikut subdomain yang dituju, dan dialog menanyakannya.
- **Salinan lahir PAUSED dan TIDAK PERNAH diulang otomatis** (`retry: false` di `graphPost`): kode
  1/2 bisa datang sesudah Meta sempat membuat salinannya.
- **Job ditulis `requested` SEBELUM Meta disentuh, lalu route menjawab dan penyalinan berjalan di
  latar** dengan progres per ad set di `dashboard/campaignCopyJobs`. `requested` >10 menit atau
  `running` >30 menit → `unknown` ("periksa Ads Manager"), bukan `failed`. Satu sumber, satu job
  berjalan (409). Cron lima menitan cuma menyapu yang menggantung dan membuang job >7 hari.
- **Anggaran hanya HARIAN, di tingkat yang memegangnya** (campaign CBO, ad set ABO). `"0"` dari Meta
  berarti "bukan jenis anggaran ini", bukan nol rupiah.
- **Targeting dibaca ulang dari Meta sesaat sebelum ditulis**, cuma `countries`/`age_min`/`age_max`
  yang diganti, lalu dikirim utuh. Hanya ad set yang lokasinya negara saja yang bisa diedit.
- **Penolakan Meta berkode 100 (selain subkode 33) jadi 422**, sisanya 502 (`metaFailureStatus`).
- **Tulisan yang mengubah baris tabel memasukkan ad account-nya ke antrean sync** (~30 detik, digabung
  per akun), memakai SATU penjaga dengan siklus campaign (`server/campaign-lock.js`).
- **Versi Meta API dipatok `v25.0`.** Pada 11 Sep 2026 Meta menjawab `v21.0` dan `v25.0` sebagai
  `v26.0` diam-diam.
- Butuh `npm run deploy:rules` (node job baru), deploy ulang server kontrol, dan hosting.
```

---

