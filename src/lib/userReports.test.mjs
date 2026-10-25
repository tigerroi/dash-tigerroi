import assert from "node:assert";
import test from "node:test";
import { countryRoiSources, userReportBranch } from "./userReports.js";

const user = { id: "u1", campaignHistory: { lama: 1 }, countryRoi: { lama: 1 } };

test("cabang baru menang atas cabang lama", () => {
  const reports = { u1: { campaignHistory: { baru: 2 } } };
  assert.deepEqual(userReportBranch(user, reports, "campaignHistory"), { baru: 2 });
});

test("tanpa cabang baru, yang lama tetap terbaca — itu keadaan sebelum migrasi", () => {
  assert.deepEqual(userReportBranch(user, {}, "campaignHistory"), { lama: 1 });
  assert.deepEqual(userReportBranch(user, undefined, "countryRoi"), { lama: 1 });
});

test("cabang baru yang KOSONG adalah jawaban, bukan ketiadaan", () => {
  // Sesudah `--drop-legacy`, user yang memang tidak punya riwayat membawa `{}` di pohon baru.
  // Dibaca dengan `||`, ia jatuh kembali ke salinan lama yang seharusnya sudah tidak dipakai.
  assert.deepEqual(userReportBranch(user, { u1: { campaignHistory: {} } }, "campaignHistory"), {});
});

test("user yang tidak punya riwayat di mana pun tidak melempar", () => {
  assert.equal(userReportBranch({ id: "u9" }, { u1: {} }, "dailySpend"), undefined);
  assert.equal(userReportBranch(undefined, undefined, "dailySpend"), undefined);
});

test("countryRoiSources menyisir SELURUH user, bukan cuma yang sudah pindah", () => {
  const users = [{ id: "u2", countryRoi: { lama2: 1 } }, { id: "u3" }];
  const reports = { u2: { countryRoi: { baru2: 2 } } };
  assert.deepEqual(countryRoiSources(users, reports), [
    { id: "u2", countryRoi: { baru2: 2 } },
    { id: "u3", countryRoi: undefined },
  ]);
});

test("countryRoiSources membawa baris user UTUH — id-nya yang membedakan baris negara", () => {
  // `buildCountryBreakdown` menyusun id tiap baris dari `user.id`. Dibuang, dua user yang pernah
  // memegang subdomain yang sama menghasilkan key React kembar dan salah satu barisnya hilang.
  const [row] = countryRoiSources([{ id: "u1", name: "Nur", countryRoi: {} }], {});
  assert.equal(row.id, "u1");
  assert.equal(row.name, "Nur");
});

test("daftar user yang belum dimuat tidak melempar", () => {
  assert.deepEqual(countryRoiSources(undefined, {}), []);
  assert.deepEqual(countryRoiSources(null, undefined), []);
});
