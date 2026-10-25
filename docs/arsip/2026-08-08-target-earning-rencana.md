# Target Earning per Subdomain — Rencana Implementasi (Fase 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin & Keuangan bisa set target earning bulanan per subdomain di halaman `/targets`, lihat realisasi vs target, status tercapai, dan riwayat antar bulan.

**Architecture:** Simpan hanya angka target di RTDB (`subDomainTargets/{subdomainId}/{YYYY-MM}`). Realisasi, persen, status tercapai, dan riwayat diturunkan dari `dashboard/roiReports` yang sudah ada — tidak ada snapshot bulanan. Logika turunan murni ada di `src/lib/targets.js` (unit-tested); UI di `src/components/Targets.jsx` mengikuti pola halaman lain (PageHeader + tabel + toast lewat store).

**Tech Stack:** React (fungsi komponen, tanpa framework routing — router custom di `src/routes/resolveRoute.js`), Firebase RTDB, `node --test` untuk unit test lib.

## Global Constraints

- Realisasi = **Earning** (gross Adsense): jumlah `toAmount(row.earning ?? row.adsense)`. Ad tax TIDAK ikut.
- Target di-key oleh subdomain **id**; dicocokkan ke `roiReports` lewat **nama** subdomain saat ini (`firstValue(row.subDomain)`).
- Bulan berformat `YYYY-MM`; `roiReports[].date` berformat `yyyy-mm-dd` (ambil 7 karakter pertama).
- Write target: admin + keuangan saja. Read: semua akun login.
- Commit tanpa trailer `Co-Authored-By` (aturan repo — Muhajir-only).
- Repo tidak punya test runner React; task UI diverifikasi lewat `npm run build`, bukan unit test.
- Uang ditampilkan lewat `renderCell(value, key)` — pakai key `"earning"` untuk realisasi, `"amount"` untuk target.

---

### Task 1: Logika turunan murni (`src/lib/targets.js`)

**Files:**
- Create: `src/lib/targets.js`
- Test: `src/lib/targets.test.mjs`

**Interfaces:**
- Consumes: `firstValue` dari `./firstValue`, `toAmount` dari `./toAmount.js`.
- Produces:
  - `monthKey(dateStr: string) => string` — 7 char pertama, `""` bila kosong.
  - `realizedEarning(reports: object[], subDomainName: string, month: string) => number`
  - `computeAchievement(realized: number, target: number) => { percent: number|null, achieved: boolean }`
  - `buildTargetRows(subDomains: object[], reports: object[], targets: object, month: string) => Array<{ id, name, pic, target: number, realized: number, percent: number|null, achieved: boolean }>` — `targets` = node `subDomainTargets` (`{ [subId]: { [YYYY-MM]: number } }`).
  - `targetMonths(reports: object[], targetsForSub: object, subDomainName: string) => string[]` — daftar bulan (desc) yang punya target atau realisasi, untuk riwayat satu subdomain. `targetsForSub` = `{ [YYYY-MM]: number }`.

- [ ] **Step 1: Tulis test yang gagal**

```javascript
// src/lib/targets.test.mjs
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildTargetRows,
  computeAchievement,
  monthKey,
  realizedEarning,
  targetMonths,
} from "./targets.js";

describe("targets", () => {
  test("monthKey memotong tanggal harian jadi YYYY-MM", () => {
    assert.equal(monthKey("2026-08-08"), "2026-08");
    assert.equal(monthKey(""), "");
    assert.equal(monthKey(undefined), "");
  });

  test("realisasi menjumlahkan earning subdomain di bulan itu, abaikan bulan/nama lain", () => {
    const reports = [
      { subDomain: "a.web.id", earning: 1000, date: "2026-08-01" },
      { subDomain: "a.web.id", adsense: 500, date: "2026-08-20" },
      { subDomain: "a.web.id", earning: 999, date: "2026-07-31" }, // bulan lain
      { subDomain: "b.web.id", earning: 777, date: "2026-08-10" }, // subdomain lain
    ];
    assert.equal(realizedEarning(reports, "a.web.id", "2026-08"), 1500);
  });

  test("pencapaian: target 0/kosong tidak membagi nol", () => {
    assert.deepEqual(computeAchievement(1500, 1000), { percent: 150, achieved: true });
    assert.deepEqual(computeAchievement(800, 1000), { percent: 80, achieved: false });
    assert.deepEqual(computeAchievement(500, 0), { percent: null, achieved: false });
  });

  test("buildTargetRows menggabungkan subdomain, target, dan realisasi", () => {
    const subDomains = [{ id: "s1", name: "a.web.id", pic: "Budi" }];
    const reports = [{ subDomain: "a.web.id", earning: 1200, date: "2026-08-05" }];
    const targets = { s1: { "2026-08": 1000 } };
    const rows = buildTargetRows(subDomains, reports, targets, "2026-08");
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0], {
      id: "s1",
      name: "a.web.id",
      pic: "Budi",
      target: 1000,
      realized: 1200,
      percent: 120,
      achieved: true,
    });
  });

  test("targetMonths menggabungkan bulan bertarget dan bulan berrealisasi, terbaru dulu", () => {
    const reports = [
      { subDomain: "a.web.id", earning: 1, date: "2026-07-02" },
      { subDomain: "a.web.id", earning: 1, date: "2026-08-02" },
    ];
    const targetsForSub = { "2026-06": 500, "2026-08": 1000 };
    assert.deepEqual(targetMonths(reports, targetsForSub, "a.web.id"), [
      "2026-08",
      "2026-07",
      "2026-06",
    ]);
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `npm test`
Expected: FAIL — `Cannot find module './targets.js'`

- [ ] **Step 3: Implementasi minimal**

```javascript
// src/lib/targets.js
import { firstValue } from "./firstValue";
import { toAmount } from "./toAmount.js";

export function monthKey(dateStr) {
  return String(dateStr || "").slice(0, 7);
}

export function realizedEarning(reports, subDomainName, month) {
  let sum = 0;
  for (const row of reports) {
    if (firstValue(row.subDomain) !== subDomainName) continue;
    if (monthKey(row.date) !== month) continue;
    sum += toAmount(row.earning ?? row.adsense);
  }
  return round(sum);
}

export function computeAchievement(realized, target) {
  if (!(target > 0)) {
    return { percent: null, achieved: false };
  }
  return { percent: round((realized / target) * 100), achieved: realized >= target };
}

export function buildTargetRows(subDomains, reports, targets, month) {
  return subDomains.map((sub) => {
    const name = firstValue(sub.name);
    const target = toAmount(targets?.[sub.id]?.[month]);
    const realized = realizedEarning(reports, name, month);
    return {
      id: sub.id,
      name,
      pic: firstValue(sub.pic),
      target,
      realized,
      ...computeAchievement(realized, target),
    };
  });
}

// Bulan yang punya target ATAU realisasi untuk satu subdomain, terbaru dulu.
export function targetMonths(reports, targetsForSub, subDomainName) {
  const months = new Set(Object.keys(targetsForSub || {}));
  for (const row of reports) {
    if (firstValue(row.subDomain) === subDomainName && monthKey(row.date)) {
      months.add(monthKey(row.date));
    }
  }
  return [...months].sort().reverse();
}

function round(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `npm test`
Expected: PASS (semua test targets + test lain tetap hijau)

- [ ] **Step 5: Commit**

```bash
git add src/lib/targets.js src/lib/targets.test.mjs
git commit -m "feat(targets): logika turunan target vs realisasi earning per subdomain"
```

---

### Task 2: Storage & akses (RTDB path, rule, write helper, izin)

**Files:**
- Modify: `src/config/firebasePaths.js`
- Modify: `src/lib/firebaseRepository.js`
- Modify: `database.rules.json`
- Modify: `src/config/access.js`

**Interfaces:**
- Consumes: `firebasePaths`, `set`, `ref`, `database` (sudah diimpor di repository).
- Produces:
  - `writeTarget(subdomainId: string, month: string, amount: number|null) => Promise<void>` di `firebaseRepository.js`.
  - `canWriteTargets(role: string) => boolean` di `access.js`.
  - Path RTDB `subDomainTargets` (readable semua login, writable admin+keuangan).

- [ ] **Step 1: Daftarkan path**

Di `src/config/firebasePaths.js`, tambahkan di dalam objek `firebasePaths`:

```javascript
  subDomainTargets: "subDomainTargets",
```

- [ ] **Step 2: Tambah helper write di repository**

Di `src/lib/firebaseRepository.js`, tambahkan fungsi baru (di akhir file):

```javascript
// Target earning per subdomain per bulan: satu angka di subDomainTargets/{id}/{YYYY-MM}.
// amount null menghapus target bulan itu (bukan menyimpannya sebagai 0).
export function writeTarget(subdomainId, month, amount) {
  return set(
    ref(database, `${firebasePaths.subDomainTargets}/${subdomainId}/${month}`),
    amount === null ? null : amount,
  );
}
```

- [ ] **Step 3: Tambah rule RTDB**

Di `database.rules.json`, tambahkan node baru sebaris dengan `expanses` (di dalam objek `rules`, sebelum `settings`):

```json
    "subDomainTargets": {
      ".read": "auth != null",
      ".write": "auth != null && (root.child('roles').child(auth.uid).val().contains('admin') || root.child('roles').child(auth.uid).val().contains('keuangan'))"
    },
```

- [ ] **Step 4: Tambah helper izin**

Di `src/config/access.js`, tambahkan setelah `canEditCampaignCodes`:

```javascript
// Target earning: dibaca semua akun login, ditulis admin + keuangan (aturan database yang
// menegakkannya; ini hanya menyembunyikan input dari yang tak berhak).
export function canWriteTargets(role) {
  return isAdmin(role) || hasRole(role, "keuangan");
}
```

- [ ] **Step 5: Verifikasi build & rule valid**

Run: `npm run build`
Expected: build sukses tanpa error.

Run: `node -e "JSON.parse(require('fs').readFileSync('database.rules.json','utf8')); console.log('rules JSON valid')"`
Expected: `rules JSON valid`

- [ ] **Step 6: Commit**

```bash
git add src/config/firebasePaths.js src/lib/firebaseRepository.js database.rules.json src/config/access.js
git commit -m "feat(targets): path RTDB, write helper, dan izin admin+keuangan"
```

---

### Task 3: Store — subscribe target & aksi simpan

**Files:**
- Modify: `src/hooks/useFirebaseStore.js`

**Interfaces:**
- Consumes: `writeTarget` (Task 2), `subscribeValue` (sudah ada).
- Produces:
  - `store.subDomainTargets` — objek `{ [subId]: { [YYYY-MM]: number } }`.
  - `saveTarget(subdomainId, month, amount)` di return value hook.

- [ ] **Step 1: Impor writeTarget**

Di `src/hooks/useFirebaseStore.js`, tambahkan `writeTarget` ke daftar impor dari `../lib/firebaseRepository`.

- [ ] **Step 2: Beri nilai awal di store**

Di objek `emptyStore`, tambahkan setelah `roiReports: []`:

```javascript
  subDomainTargets: {},
```

- [ ] **Step 3: Subscribe sebagai object**

Di objek `dashboardSubscriptions`, tambahkan:

```javascript
  // Target earning per subdomain per bulan. Object bertingkat {subId: {YYYY-MM: angka}}, diikuti
  // seperti data lain supaya angka yang baru disimpan langsung tampil di tabel yang terbuka.
  subDomainTargets: "object",
```

- [ ] **Step 4: Tambah aksi saveTarget**

Setelah fungsi `saveRoiSettings`, tambahkan:

```javascript
  // Simpan/hapus target earning satu subdomain untuk satu bulan. Kosong => hapus (null), bukan 0.
  const saveTarget = async (subdomainId, month, amount) => {
    try {
      const parsed = amount === "" || amount === null ? null : Number(amount);
      if (parsed !== null && !Number.isFinite(parsed)) {
        notifyError(new Error("invalid"), "Target harus berupa angka.");
        return;
      }
      await writeTarget(subdomainId, month, parsed);
      notifySuccess(parsed === null ? "Target dihapus." : "Target tersimpan.");
    } catch (error) {
      notifyError(error, "Target gagal disimpan. Coba lagi.");
    }
  };
```

- [ ] **Step 5: Ekspor saveTarget**

Di objek `return { ... }` hook, tambahkan `saveTarget,` (mis. setelah `saveRoiSettings,`).

- [ ] **Step 6: Verifikasi build**

Run: `npm run build`
Expected: build sukses.

- [ ] **Step 7: Commit**

```bash
git add src/hooks/useFirebaseStore.js
git commit -m "feat(targets): subscribe target di store dan aksi saveTarget"
```

---

### Task 4: Halaman `/targets` — tabel bulan terpilih + edit inline

**Files:**
- Create: `src/components/Targets.jsx`
- Modify: `src/routes/resolveRoute.js`
- Modify: `src/config/navigation.js`
- Modify: `src/components/layout/DashboardShell.jsx`
- Modify: `src/main.jsx`

**Interfaces:**
- Consumes: `buildTargetRows` (Task 1), `saveTarget` (Task 3), `store.subDomains`, `store.roiReports`, `store.subDomainTargets`, `canWriteTargets` (Task 2), `renderCell`, `PageHeader`.
- Produces: komponen `Targets` dan route `kind: "targets"`.

- [ ] **Step 1: Tambah route**

Di `src/routes/resolveRoute.js`, setelah blok `/settings`:

```javascript
  if (path === "/targets") {
    return { kind: "targets" };
  }
```

- [ ] **Step 2: Tambah nav item + ikon**

Di `src/config/navigation.js`, tambahkan item sebelum `/settings`:

```javascript
  { path: "/targets", label: "Target", key: "targets" },
```

Di `src/components/layout/DashboardShell.jsx`, impor ikon `Target` dari `lucide-react` (tambah ke daftar impor `lucide-react` yang sudah ada) dan tambahkan ke objek `navIcons`:

```javascript
  targets: Target,
```

(Nav memakai `canReadResource(role, "targets")` yang bernilai true untuk semua akun login — target bukan resource admin-only — jadi item tampil untuk semua; input edit-nya yang dibatasi.)

- [ ] **Step 3: Tulis komponen Targets**

```jsx
// src/components/Targets.jsx
import { useMemo, useState } from "react";
import { buildTargetRows } from "../lib/targets";
import { renderCell } from "../lib/renderCell";
import { PageHeader } from "./ui/PageHeader";

const currentMonth = new Date().toISOString().slice(0, 7);

export function Targets({ store, onSaveTarget, readOnly }) {
  const [month, setMonth] = useState(currentMonth);
  const subDomains = store.subDomains || [];
  const roiReports = store.roiReports || [];
  const targets = store.subDomainTargets || {};
  const rows = useMemo(
    () => buildTargetRows(subDomains, roiReports, targets, month),
    [subDomains, roiReports, targets, month],
  );

  // Simpan hanya bila angkanya berubah — blur tanpa edit tak perlu menulis ulang.
  const commit = (row, event) => {
    const next = event.target.value;
    if (Number(next || 0) === Number(row.target || 0)) return;
    onSaveTarget(row.id, month, next);
  };

  return (
    <div className="page-stack">
      <PageHeader
        title="Target Earning"
        description="Target earning bulanan per subdomain dan realisasinya."
      />

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Target Bulan</h2>
            <p>Pilih bulan untuk melihat atau menetapkan target.</p>
          </div>
          <div className="header-actions">
            <input
              aria-label="Pilih bulan target"
              className="control compact-control"
              type="month"
              value={month}
              onChange={(event) => setMonth(event.target.value)}
            />
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Subdomain</th>
                <th>PIC / User</th>
                <th>Target</th>
                <th>Realisasi</th>
                <th>%</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td className="empty" colSpan={6}>
                    Tidak ada subdomain.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.name}</td>
                    <td>{row.pic}</td>
                    <td>
                      {readOnly ? (
                        renderCell(row.target, "amount")
                      ) : (
                        <input
                          aria-label={`Target ${row.name}`}
                          className="control"
                          type="number"
                          min="0"
                          defaultValue={row.target || ""}
                          key={`${row.id}-${month}`}
                          onBlur={(event) => commit(row, event)}
                        />
                      )}
                    </td>
                    <td>{renderCell(row.realized, "earning")}</td>
                    <td>{row.percent === null ? "-" : `${row.percent.toFixed(0)}%`}</td>
                    <td>
                      {row.target > 0 ? (
                        <span className={`badge ${row.achieved ? "success" : "danger"}`}>
                          {row.achieved ? "Tercapai" : "Belum"}
                        </span>
                      ) : (
                        <span className="badge muted">Belum diset</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Render di main.jsx**

Di `src/main.jsx`, impor `Targets` dan `canWriteTargets`, lalu tambahkan blok render setelah blok `route.kind === "settings"`:

```jsx
        {route.kind === "targets" && (
          <Targets
            store={dataStore.store}
            onSaveTarget={dataStore.saveTarget}
            readOnly={!canWriteTargets(role)}
          />
        )}
```

(Impor: tambahkan `Targets` dari `./components/Targets`, dan `canWriteTargets` ke impor dari `./config/access`.)

- [ ] **Step 5: Verifikasi build & jalankan app**

Run: `npm run build`
Expected: build sukses.

Verifikasi manual (dev server, login sebagai admin): buka `/targets`, ganti bulan lewat month picker, isi angka target di satu baris lalu klik luar (blur) → toast "Target tersimpan", kolom % & Status ikut berubah. Login sebagai user biasa → kolom Target tampil read-only (tanpa input).

- [ ] **Step 6: Commit**

```bash
git add src/components/Targets.jsx src/routes/resolveRoute.js src/config/navigation.js src/components/layout/DashboardShell.jsx src/main.jsx
git commit -m "feat(targets): halaman /targets dengan tabel target vs realisasi & edit inline"
```

---

### Task 5: Riwayat per subdomain

**Files:**
- Modify: `src/components/Targets.jsx`

**Interfaces:**
- Consumes: `targetMonths`, `realizedEarning`, `computeAchievement` (Task 1).
- Produces: panel riwayat yang muncul saat sebuah subdomain dipilih.

- [ ] **Step 1: Perluas impor**

Di `src/components/Targets.jsx`, tambahkan ke impor dari `../lib/targets`:

```javascript
import { buildTargetRows, computeAchievement, realizedEarning, targetMonths } from "../lib/targets";
```

- [ ] **Step 2: State subdomain terpilih + baris riwayat**

Tambahkan setelah `const [month, setMonth] = useState(currentMonth);`:

```javascript
  const [selected, setSelected] = useState(null); // { id, name }

  const historyRows = useMemo(() => {
    if (!selected) return [];
    const targetsForSub = targets[selected.id] || {};
    return targetMonths(roiReports, targetsForSub, selected.name).map((m) => {
      const target = Number(targetsForSub[m] || 0);
      const realized = realizedEarning(roiReports, selected.name, m);
      return { month: m, target, realized, ...computeAchievement(realized, target) };
    });
  }, [selected, targets, roiReports]);
```

- [ ] **Step 3: Jadikan nama subdomain bisa diklik**

Ganti sel nama di tabel utama (`<td>{row.name}</td>`) menjadi:

```jsx
                    <td>
                      <button
                        className="ghost-button"
                        type="button"
                        onClick={() => setSelected({ id: row.id, name: row.name })}
                      >
                        {row.name}
                      </button>
                    </td>
```

- [ ] **Step 4: Panel riwayat**

Sebelum penutup `</div>` terakhir (`page-stack`), tambahkan:

```jsx
      {selected && (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Riwayat — {selected.name}</h2>
              <p>Target vs realisasi tiap bulan.</p>
            </div>
            <div className="header-actions">
              <button className="ghost-button" type="button" onClick={() => setSelected(null)}>
                Tutup
              </button>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Bulan</th>
                  <th>Target</th>
                  <th>Realisasi</th>
                  <th>%</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {historyRows.length === 0 ? (
                  <tr>
                    <td className="empty" colSpan={5}>
                      Belum ada target atau realisasi.
                    </td>
                  </tr>
                ) : (
                  historyRows.map((row) => (
                    <tr key={row.month}>
                      <td>{row.month}</td>
                      <td>{renderCell(row.target, "amount")}</td>
                      <td>{renderCell(row.realized, "earning")}</td>
                      <td>{row.percent === null ? "-" : `${row.percent.toFixed(0)}%`}</td>
                      <td>
                        {row.target > 0 ? (
                          <span className={`badge ${row.achieved ? "success" : "danger"}`}>
                            {row.achieved ? "Tercapai" : "Belum"}
                          </span>
                        ) : (
                          <span className="badge muted">Belum diset</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
```

- [ ] **Step 5: Verifikasi build & manual**

Run: `npm run build`
Expected: build sukses.

Manual: buka `/targets`, klik nama subdomain → panel riwayat muncul dengan baris per bulan (terbaru dulu), tombol Tutup menyembunyikannya.

- [ ] **Step 6: Commit**

```bash
git add src/components/Targets.jsx
git commit -m "feat(targets): panel riwayat target vs realisasi per subdomain"
```

---

## Catatan Fase 2 (di luar rencana ini)

Analitik agregat (total semua subdomain, ranking pencapaian, kontribusi per PIC, tren antar bulan) dibangun di atas `src/lib/targets.js` + `buildTargetRows` yang sama — rencana terpisah setelah Fase 1 terverifikasi jalan.
