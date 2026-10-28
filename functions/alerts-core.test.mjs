import assert from "node:assert/strict";
import test from "node:test";
import {
  alertMessage,
  alertNoticeUpdate,
  alertSettings,
  alertsToSend,
  DEFAULT_ALERTS,
  evaluateAlerts,
  runningRows,
} from "./alerts-core.js";

const on = { ...DEFAULT_ALERTS, enabled: true };

// Baris ROI apa adanya, bentuk yang ditulis `roiReportUpdate`.
function row(extra = {}) {
  return {
    date: "2026-08-25",
    time: "15:06",
    subDomain: "trends.stylefemale.com",
    pic: "Nurjaman",
    partial: true,
    spending: 500_000,
    totalSpending: 550_000,
    earning: 900_000,
    roi: 63.64,
    ...extra,
  };
}

test("mati kalau belum dinyalakan, dan itu keadaan awalnya", () => {
  assert.equal(DEFAULT_ALERTS.enabled, false);
  assert.deepEqual(evaluateAlerts([row({ roi: -90 })], DEFAULT_ALERTS), []);
});

test("ROI di bawah ambang berbunyi, yang di atasnya tidak", () => {
  assert.deepEqual(evaluateAlerts([row()], on), []);

  const alerts = evaluateAlerts([row({ roi: -80 })], on);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].rule, "lowRoi");
  assert.equal(alerts[0].subDomain, "trends.stylefemale.com");
  assert.equal(alerts[0].pic, "Nurjaman");
  // Yang dilaporkan adalah TOTAL SPEND (spend + ad tax), sama dengan kolom di tabel ROI — bukan
  // spend telanjang, yang akan membuat orang mengadu dua angka berbeda untuk uang yang sama.
  assert.equal(alerts[0].spend, 550_000);
});

// ═══ Inti dari seluruh fitur ini ═══
//
// Laporan GAM yang gagal datang membuat baris tampak seperti subdomain yang beriklan tanpa hasil.
// Kalau peringatan ikut berbunyi untuknya, ia akan berbunyi tiap kali GAM lambat — dan notifikasi
// yang sering salah adalah notifikasi yang dibisukan orang.
test("baris yang earning-nya TIDAK DIKETAHUI dilewati, bukan dinilai buruk", () => {
  const gagal = row({ earning: undefined, roi: undefined, gamMissing: true });
  assert.deepEqual(evaluateAlerts([gagal], on), []);

  // `gamStale` — angka dari sync sebelumnya di hari yang sama — TETAP dinilai: angkanya nyata,
  // hanya belum diperbarui, dan ROI yang ambruk sejak pagi tidak berhenti ambruk karena laporan
  // terakhir gagal.
  const basi = row({ roi: -80, gamStale: true });
  assert.equal(evaluateAlerts([basi], on).length, 1);
});

// id penanda jadi kunci `dashboard/alertNotices`; titik di hostname membuat RTDB menolak seluruh
// update ("invalid key ... can't contain .") tiap peringatan benar-benar berbunyi.
test("id penanda aman sebagai kunci RTDB walau subdomain berisi titik", () => {
  const [alert] = evaluateAlerts([row({ subDomain: "gifts.masseffectstore.com", roi: -80 })], on);
  assert.doesNotMatch(alert.id, /[.#$/[\]]/);
  assert.equal(alert.subDomain, "gifts.masseffectstore.com"); // pesan tetap pakai nama asli
});

test("baris yang spend-nya tidak diketahui juga dilewati", () => {
  // Subdomain yang earning-nya murni GAM tanpa iklan Meta: bukan kegagalan, dan bukan ROI buruk.
  const unmapped = row({ spending: undefined, roi: undefined, metaMissing: "unmapped" });
  assert.deepEqual(evaluateAlerts([unmapped], on), []);

  const gagalMeta = row({ spending: undefined, roi: -90, metaMissing: "unavailable" });
  assert.deepEqual(evaluateAlerts([gagalMeta], on), []);
});

// Tanpa lantai belanja, tiap campaign yang baru menyala memenuhi syarat "ROI di bawah -50%".
test("belanja di bawah minimum tidak berbunyi, walau ROI-nya jelek", () => {
  const kecil = row({ spending: 5_000, totalSpending: 5_500, earning: 100, roi: -98 });
  assert.deepEqual(evaluateAlerts([kecil], on), []);
  assert.equal(evaluateAlerts([kecil], { ...on, minSpend: 1_000 }).length, 1);
});

test("belanja jalan tanpa earning berbunyi sendiri, dan tidak dobel dengan ROI", () => {
  const nol = row({ earning: 0, roi: -100 });
  const alerts = evaluateAlerts([nol], on);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].rule, "spendNoEarning");
});

test("saldo menipis berbunyi untuk baris yang ROI-nya justru sehat", () => {
  const alerts = evaluateAlerts([row({ metaBalance: 50_000 })], on);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].rule, "lowBalance");
  assert.equal(alerts[0].balance, 50_000);
});

test("tiap aturan bisa dimatikan sendiri-sendiri", () => {
  const buruk = row({ roi: -80, metaBalance: 10_000 });
  assert.equal(evaluateAlerts([buruk], on).length, 2);
  assert.equal(evaluateAlerts([buruk], { ...on, lowBalance: false }).length, 1);
  assert.equal(evaluateAlerts([buruk], { ...on, lowRoi: false, lowBalance: false }).length, 0);
});

test("yang paling merugikan berdiri di atas", () => {
  const alerts = evaluateAlerts(
    [
      row({ subDomain: "a.com", metaBalance: 1_000, roi: 200 }),
      row({ subDomain: "b.com", roi: -60 }),
      row({ subDomain: "c.com", earning: 0, roi: -100 }),
      row({ subDomain: "d.com", roi: -95 }),
    ],
    on,
  );
  assert.deepEqual(
    alerts.map((a) => a.subDomain),
    ["c.com", "d.com", "b.com", "a.com"],
  );
});

test("setelan yang tidak terbaca jatuh ke bawaannya, bukan ke nol", () => {
  // Ambang 0 yang lahir dari kotak yang dikosongkan akan membuat SELURUH armada memenuhi syarat.
  const config = alertSettings({ enabled: true, minSpend: "", roiThreshold: "bukan angka" });
  assert.equal(config.minSpend, DEFAULT_ALERTS.minSpend);
  assert.equal(config.roiThreshold, DEFAULT_ALERTS.roiThreshold);
  // Yang berbentuk teks dari <input type="number"> tetap diterima sebagai angka.
  assert.equal(alertSettings({ minSpend: "250000" }).minSpend, 250_000);
});

test("hari berjalan dibaca dari baris, dan hanya hari terbarunya", () => {
  const rows = runningRows({
    a: { date: "2026-08-24", partial: true, subDomain: "kemarin.com" },
    b: { date: "2026-08-25", partial: true, subDomain: "hari-ini.com" },
    c: { date: "2026-08-25", partial: false, subDomain: "final.com" },
  });
  assert.deepEqual(
    rows.map((r) => r.subDomain),
    ["hari-ini.com"],
  );
  assert.deepEqual(runningRows(null), []);
});

test("sekali sehari per aturan per subdomain", () => {
  const alerts = evaluateAlerts([row({ roi: -80 })], on);
  const id = alerts[0].id;

  assert.equal(alertsToSend(alerts, {}, "2026-08-25").length, 1);
  assert.equal(alertsToSend(alerts, { [id]: "2026-08-25" }, "2026-08-25").length, 0);
  // Keadaan yang bertahan sampai besok memang perlu disebut lagi.
  assert.equal(alertsToSend(alerts, { [id]: "2026-08-24" }, "2026-08-25").length, 1);
});

test("penanda yang sudah pulih disapu, yang hari ini dipertahankan", () => {
  const alerts = evaluateAlerts([row({ roi: -80 })], on);
  const update = alertNoticeUpdate(
    alerts,
    { "lowRoi__sudah-pulih.com": "2026-08-20" },
    "2026-08-25",
  );

  assert.equal(update[alerts[0].id], "2026-08-25");
  assert.equal(update["lowRoi__sudah-pulih.com"], null);
});

test("pesan memakai HTML dan menyebut ambangnya", () => {
  const alerts = evaluateAlerts([row({ subDomain: "invoice_agustus.com", roi: -80 })], on);
  const text = alertMessage(alerts, on, "https://contoh.web.app/dashboard/roi");

  assert.match(text, /Peringatan ROI/);
  assert.match(text, /25 Agu 2026/);
  assert.match(text, /-80\.00%/);
  // Judul diketik orang: satu `_` di Markdown membuat Telegram menolak SELURUH pesan dengan 400,
  // dan pesan yang ditolak diam-diam adalah peringatan yang tidak pernah sampai.
  assert.match(text, /invoice_agustus\.com/);
  assert.match(text, /Ambang: ROI ≤ -50%/);
});

test("nama yang membawa karakter HTML di-escape", () => {
  const alerts = evaluateAlerts([row({ subDomain: "a<b>.com", roi: -80 })], on);
  const text = alertMessage(alerts, on, "");
  assert.match(text, /a&lt;b&gt;\.com/);
});
