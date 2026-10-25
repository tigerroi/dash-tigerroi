import assert from "node:assert/strict";
import test from "node:test";
import {
  adSetBudgetNote,
  adSetStatusNote,
  adSetSummary,
  adSetTargetingNote,
  adSetToggleState,
} from "./adSets.js";

test("ad set yang On di bawah campaign yang mati menyebut sebabnya", () => {
  // Keadaan yang tidak bisa dibaca dari kolom mana pun: pilnya berbunyi "Aktif" (posisi saklarnya
  // sendiri) sementara angkanya Rp 0. Tanpa kalimat ini, yang dicari orang berikutnya adalah
  // kerusakan yang tidak ada.
  assert.equal(
    adSetStatusNote({ status: "Aktif", pausedByCampaign: true }),
    "Saklarnya On, campaign di atasnya mati.",
  );
  assert.equal(adSetStatusNote({ status: "Aktif", pausedByCampaign: false }), "");
});

test("yang terjadwal menyebut KAPAN", () => {
  assert.equal(
    adSetStatusNote({ status: "Terjadwal", startTime: "2026-09-20T00:05:00+0700" }),
    "Mulai tayang 20 Sep 2026, 00:05.",
  );
  // Tanpa tanggalnya, pil "Terjadwal" cuma memindahkan pertanyaannya ke Ads Manager — tapi
  // mengarang tanggal lebih buruk lagi, jadi kalimatnya memang tidak ada.
  assert.equal(adSetStatusNote({ status: "Terjadwal", startTime: "" }), "");
});

test("kolom anggaran yang kosong punya dua arti, dan keterangannya yang membedakan", () => {
  assert.equal(adSetBudgetNote({ budgetLevel: "campaign", dailyBudget: "" }), "Diatur di level campaign");
  assert.equal(adSetBudgetNote({ budgetLevel: "adset", dailyBudget: 100000 }), "Total/hari");
  assert.equal(
    adSetBudgetNote({ budgetLevel: "adset", dailyBudget: "", lifetimeBudget: 5000000 }),
    "Total seumur hidup",
  );
});

test("sasaran ditulis sependek mungkin, dan yang tidak ada tidak diarang", () => {
  assert.equal(adSetTargetingNote({ countries: ["MX", "CL"], ageMin: 18, ageMax: 65 }), "MX, CL · 18–65");
  assert.equal(adSetTargetingNote({ countries: ["ID"], ageMin: null, ageMax: null }), "ID");
  assert.equal(adSetTargetingNote({ countries: [], ageMin: 25, ageMax: null }), "25+");
  assert.equal(adSetTargetingNote({}), "");
});

test("ringkasan: saklar On dihitung dari posisinya, bukan dari labelnya", () => {
  const rows = [
    { configuredStatus: "ACTIVE", status: "Aktif", spend: 1000 },
    // Terjadwal = saklar On juga. Dihitung dari label, angkanya lebih kecil daripada jumlah baris
    // yang pilnya bukan "Tidak aktif".
    { configuredStatus: "ACTIVE", status: "Terjadwal", spend: 0 },
    { configuredStatus: "PAUSED", status: "Tidak aktif", spend: 500 },
  ];
  assert.deepEqual(adSetSummary(rows), { total: 3, active: 2, notDelivering: 0, spend: 1500 });
});

test("belanja yang tidak diketahui DILEWATI, dan yang seluruhnya tidak diketahui bukan Rp 0", () => {
  // `"" + 100` bukan 101 melainkan teks "0100" — aturan yang sama dengan tiap penjumlah uang di
  // dashboard ini.
  assert.equal(adSetSummary([{ spend: "" }, { spend: 250 }]).spend, 250);
  assert.equal(adSetSummary([{ spend: "" }, { spend: "" }]).spend, "");
  assert.deepEqual(adSetSummary([]), { total: 0, active: 0, notDelivering: 0, spend: "" });
});

test("pil merah menyebut SEBABNYA, dan sebab yang berbeda diperbaiki di tempat berbeda", () => {
  // Satu iklan, ditolak: kalimat tunggal.
  assert.equal(
    adSetStatusNote({
      notDelivering: true,
      effectiveStatus: "ACTIVE",
      ads: { total: 1, deliverable: 0, blockers: { DISAPPROVED: 1 } },
    }),
    "Iklannya ditolak Meta.",
  );
  // Beberapa iklan, semuanya tertahan: jumlahnya disebut — "iklannya ditolak" tanpa angka
  // menyembunyikan bahwa yang harus dibanding ada lima.
  assert.equal(
    adSetStatusNote({
      notDelivering: true,
      effectiveStatus: "ACTIVE",
      ads: { total: 5, deliverable: 0, blockers: { DISAPPROVED: 5 } },
    }),
    "Semua iklannya (5) ditolak Meta.",
  );
  // Campuran: yang disebut penahan TERBANYAK, berikut porsinya.
  assert.equal(
    adSetStatusNote({
      notDelivering: true,
      effectiveStatus: "ACTIVE",
      ads: { total: 3, deliverable: 0, blockers: { DISAPPROVED: 1, PAUSED: 2 } },
    }),
    "2 dari 3 iklannya dimatikan.",
  );
  assert.equal(
    adSetStatusNote({ notDelivering: true, effectiveStatus: "ACTIVE", ads: { total: 0 } }),
    "Tidak ada iklan di dalamnya.",
  );
  // Yang ditahan di tingkat AD SET tidak bicara soal iklannya sama sekali.
  assert.equal(
    adSetStatusNote({ notDelivering: true, effectiveStatus: "PENDING_REVIEW" }),
    "Ad set-nya masih direview Meta.",
  );
  // Keadaan yang belum pernah kita lihat tetap menyebut namanya, bukan diam: nama teknisnya masih
  // bisa dicari, sementara kalimat kosong menghapus satu-satunya petunjuk yang ada.
  assert.equal(
    adSetStatusNote({ notDelivering: true, effectiveStatus: "SOMETHING_NEW" }),
    "Meta menyebut ad set ini SOMETHING_NEW.",
  );
});

test("campaign yang mati menang atas sebab lain", () => {
  // Ad set di bawah campaign yang dimatikan memang tidak tayang, tapi sebabnya berdiri di baris
  // atasnya — dan itu yang harus dibaca lebih dulu.
  assert.equal(
    adSetStatusNote({
      pausedByCampaign: true,
      notDelivering: true,
      ads: { total: 1, deliverable: 0, blockers: { DISAPPROVED: 1 } },
    }),
    "Saklarnya On, campaign di atasnya mati.",
  );
});

test("ringkasan memisahkan yang aktif dari yang tidak tayang", () => {
  // "Yang aktif 5, tiga tayang dan dua tidak" — bentuk RNPX-01 apa adanya.
  const rows = [
    { configuredStatus: "ACTIVE", notDelivering: false, spend: 46528 },
    { configuredStatus: "ACTIVE", notDelivering: false, spend: 12945 },
    { configuredStatus: "ACTIVE", notDelivering: false, spend: 7763 },
    { configuredStatus: "ACTIVE", notDelivering: true, spend: 13443 },
    { configuredStatus: "ACTIVE", notDelivering: true, spend: 2441 },
    { configuredStatus: "PAUSED", notDelivering: false, spend: 0 },
  ];
  const summary = adSetSummary(rows);
  assert.equal(summary.active, 5);
  assert.equal(summary.notDelivering, 2);
  // Belanjanya tetap dijumlahkan penuh: yang berhenti tayang siang tadi tetap menghabiskan uang
  // pagi ini, dan itu justru angka yang dicari orang.
  assert.equal(summary.spend, 83120);
});

test("saklar ad set: posisinya dari configuredStatus, bukan dari labelnya", () => {
  // Labelnya bisa berbunyi "Tidak ditayangkan" untuk ad set yang saklarnya justru On — dan saklar
  // yang membaca label akan tampak mati untuk ad set yang tidak ada yang mematikannya.
  const state = adSetToggleState(
    { id: "1", configuredStatus: "ACTIVE", status: "Tidak ditayangkan" },
    { canToggle: true },
  );
  assert.equal(state.on, true);
  assert.equal(state.disabled, false);
});

test("yang tidak berhak tidak diberi saklar yang hidup, berikut sebabnya", () => {
  const state = adSetToggleState({ id: "1", configuredStatus: "ACTIVE" }, { canToggle: false });
  assert.equal(state.disabled, true);
  // Kalimat yang sama persis dengan saklar campaign: yang menjaga keduanya satu aturan, dan dua
  // kalimat berbeda membuat orang mengira ada dua izin.
  assert.equal(state.reason, "Hanya admin atau pemilik campaign yang boleh mengubah status.");
});

test("yang diarsipkan Meta tidak bisa dinyalakan dari sini", () => {
  // Tombol yang PASTI gagal lebih buruk daripada tombol mati yang menyebutkan sebabnya.
  const archived = adSetToggleState(
    { id: "1", configuredStatus: "ARCHIVED" },
    { canToggle: true },
  );
  assert.equal(archived.disabled, true);
  assert.match(archived.reason, /ARCHIVED/);

  const unknown = adSetToggleState({ id: "1", configuredStatus: "" }, { canToggle: true });
  assert.equal(unknown.disabled, true);
  assert.match(unknown.reason, /tidak terbaca/);
});

test("selama perintahnya di jalan, saklarnya dikunci dan menyebutkannya", () => {
  const state = adSetToggleState(
    { id: "1", configuredStatus: "ACTIVE" },
    { canToggle: true, pending: true },
  );
  assert.equal(state.pending, true);
  assert.equal(state.disabled, true);
  // Posisinya TIDAK ikut berubah: yang sudah pasti cuma bahwa permintaannya sedang dikirim.
  assert.equal(state.on, true);
});
