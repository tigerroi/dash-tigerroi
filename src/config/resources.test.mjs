import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { resources, topupPic } from "./resources.js";

const topupField = (name) => resources.whitelistTopup.fields.find((field) => field.name === name);

// PIC top-up adalah `adAccounts.userOwner`, dicocokkan `buildSpendingPlan` dengan `pic` di baris
// ROI — pencocokan yang meleset memindahkan seluruh setoran seseorang ke `(tanpa PIC)`.
test("PIC top-up dibaca dari User Pemilik akun", () => {
  const store = {
    adAccounts: [
      { name: "TBZ 1235", userOwner: "Nurjaman" },
      { name: "TBZ 1247", userOwner: "Aca" },
    ],
  };

  assert.equal(topupPic({ namaKode: "TBZ 1247" }, store), "Aca");
  // Nama/kode dicocokkan tanpa peduli besar-kecil huruf dan spasi di ujung: pilihan datang dari
  // Ad Accounts, tapi baris lama yang diimpor membawa ejaan apa adanya.
  assert.equal(topupPic({ namaKode: " tbz 1235 " }, store), "Nurjaman");
  assert.equal(topupPic({ namaKode: "TBZ 9999" }, store), "");
  assert.equal(topupPic({}, store), "");
  assert.equal(topupPic({ namaKode: "TBZ 1235" }), "");
});

// Alur form: PIC dulu, lalu Nama / Kode menyempit ke akun miliknya.
test("PIC dipilih lebih dulu dan menyaring Nama / Kode", () => {
  const names = resources.whitelistTopup.fields.map((field) => field.name);
  assert.ok(names.indexOf("pic") < names.indexOf("namaKode"), "PIC harus berdiri di atas Nama / Kode");

  const where = topupField("namaKode").optionsWhere;
  assert.equal(where({ userOwner: "Aca" }, { pic: "Aca" }), true);
  assert.equal(where({ userOwner: "Nurjaman" }, { pic: "Aca" }), false);
  // PIC kosong menawarkan seluruh akun, termasuk yang belum punya pemilik.
  assert.equal(where({}, { pic: "" }), true);
});

test("PIC yang diganti melepas akun orang lain; akun tanpa PIC mengisi PIC-nya", () => {
  const store = {
    adAccounts: [
      { name: "TBZ 1235", userOwner: "Nurjaman" },
      { name: "TBZ 1247", userOwner: "Aca" },
    ],
  };

  const onPic = topupField("pic").afterChange;
  assert.equal(onPic({ pic: "Aca", namaKode: "TBZ 1235" }, store).namaKode, "");
  assert.equal(onPic({ pic: "Aca", namaKode: "TBZ 1247" }, store).namaKode, "TBZ 1247");

  const onAccount = topupField("namaKode").afterChange;
  assert.equal(onAccount({ pic: "", namaKode: "TBZ 1235" }, store).pic, "Nurjaman");
  assert.equal(onAccount({ pic: "Aca", namaKode: "TBZ 1247" }, store).pic, "Aca");
});

// Kode Jaringan di Cost Ad Exchange memakai `fallback`, BUKAN `compute`, dan perbedaannya
// menentukan. `compute` dihitung ulang tiap render dan digambar readOnly: dipakai di sana, baris
// lama yang domainnya sudah pindah network akan tertimpa kode HARI INI begitu ia disunting —
// padahal yang benar adalah kode yang dipakai waktu penyambungannya dibayar.
test("Kode Jaringan adalah nilai awal yang bisa diganti, bukan turunan yang dikunci", () => {
  const field = resources.adxCosts.fields.find((entry) => entry.name === "networkCode");

  assert.ok(field, "field networkCode tidak ada di Cost Ad Exchange");
  assert.equal(field.compute, undefined);
  assert.equal(typeof field.fallback, "function");

  const store = { domains: [{ domainUrl: "stylefemale.com", networkCode: "23349918610" }] };
  assert.equal(field.fallback({ domain: "stylefemale.com" }, store), "23349918610");
  // Domain yang belum punya barisnya menghasilkan kosong, bukan kode yang dikarang.
  assert.equal(field.fallback({ domain: "petcins.com" }, store), "");
  assert.equal(field.fallback({}, store), "");
});

// Akun ber-`syncDisabled` DILEWATI seluruh modul sync, jadi `syncStatus`-nya membeku di nilai
// terakhir sebelum saklarnya digeser — hampir selalu `true`, yang dirender "Synced". Label itu
// menyebut berhasil untuk akun yang justru tidak dihubungi sama sekali.
test("akun yang sync-nya dimatikan berbunyi Nonaktif, bukan Synced", () => {
  const rows = resources.adAccounts.derive([
    { id: "a1", name: "TBZ 1221", syncStatus: true },
    { id: "a2", name: "TBZ 1247", syncStatus: true, syncDisabled: "Nonaktif" },
  ]);

  assert.equal(rows[0].syncStatus, true);
  assert.equal(rows[1].syncStatus, "Nonaktif");
  // Barisnya disalin, bukan disunting di tempat: `items` datang dari store yang dilanggan realtime,
  // dan menulis ke dalamnya mengubah data yang dibaca halaman lain.
  assert.equal(rows[1].syncDisabled, "Nonaktif");
});

// Kolom "Sync Meta" dibuang karena keadaannya sudah terbaca dari Status Sync. Saklarnya TETAP di
// form — tanpa itu, akun yang disuspend Meta tidak bisa dimatikan dari mana pun.
test("Sync Meta hilang dari kolom tapi tetap ada di form", () => {
  const columnKeys = resources.adAccounts.columns.map(([key]) => key);
  assert.equal(columnKeys.includes("syncDisabled"), false);
  assert.ok(resources.adAccounts.fields.some((field) => field.name === "syncDisabled"));
});

// Cerminan `database.rules.json`, dan yang dijaganya adalah bug yang benar-benar terjadi: field
// `telegramChatId` pernah berdiri di form Team. Form ini mengisi tiap kotak yang kosong dengan
// STRING KOSONG lalu mengirim semuanya sekaligus, sementara `.validate` pada
// `users/$uid/telegramChatId` menuntut angka — jadi `""` menolak SELURUH tulisannya. Akibatnya
// admin maupun superadmin tidak bisa menyunting anggota tim yang belum punya chat id, dan tidak
// bisa membuat anggota baru sama sekali; yang terbaca di layar cuma "Perubahan gagal disimpan".
//
// Yang diperiksa bukan satu nama field melainkan ATURANNYA: tiap anak `users/$uid` yang punya
// `.write` atau `.validate` sendiri sudah punya pintunya sendiri di suatu tempat (halaman
// Notifikasi, saklar campaign), dan form serba-guna ini tidak boleh jadi pintu kedua yang menulis
// field yang sama tanpa membawa aturannya.
test("form Team tidak menulis field yang punya aturan sendiri di database.rules.json", async () => {
  const url = new URL("../../database.rules.json", import.meta.url);
  const { rules } = JSON.parse(await readFile(url, "utf8"));
  const guarded = Object.entries(rules.users.$uid)
    .filter(([key]) => !key.startsWith("."))
    .filter(([, node]) => JSON.stringify(node).includes('".validate"') || node[".write"])
    .map(([key]) => key);

  // Kalau daftarnya kosong, tes ini tidak menjaga apa pun — dan itu sendiri sebuah kegagalan.
  assert.ok(guarded.includes("telegramChatId"), "aturan telegramChatId hilang dari rules");

  const fieldNames = resources.users.fields.map((field) => field.name);
  for (const key of guarded) {
    assert.equal(
      fieldNames.includes(key),
      false,
      `${key} punya aturan sendiri di database.rules.json — jangan ditulis lewat form Team`,
    );
  }
});
