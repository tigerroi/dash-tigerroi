import assert from "node:assert/strict";
import test from "node:test";
import {
  ACCOUNT_STATUSES,
  accountStatusFields,
  accountStatusFrom,
  accountStatusNote,
  accountStatusPinned,
  adLimitAlert,
  statusCheckNote,
} from "./account-status.js";

// Alert asli dari API produksi (3 Sep 2026, accounts/pub-8660742543707970). Disalin apa adanya —
// tes yang memakai contoh yang disederhanakan sendiri cuma menguji tebakan penulisnya tentang
// bentuk jawaban Google.
const THROTTLED = {
  name: "accounts/pub-8660742543707970/alerts/112fa0a5-bf13-33ce-95ac-1ad1ab34a4f8",
  severity: "SEVERE",
  message:
    "Jumlah iklan yang dapat Anda tampilkan telah dibatasi untuk satu atau beberapa produk AdSense Anda. Untuk mengetahui informasi selengkapnya, buka Pusat Kebijakan.",
  type: "adsense-traffic-throttled",
};

const UKRAINE = {
  severity: "WARNING",
  message:
    "Karena adanya perang di Ukraina, kami akan menjeda monetisasi konten yang mengeksploitasi, menyepelekan, atau membenarkan perang tersebut",
  type: "ua-conflict-policy-update",
};

const TAX = {
  severity: "WARNING",
  message: "Penting: Periksa apakah informasi pajak tambahan diperlukan dari Anda.",
  type: "youtube-check-tax-info",
};

const ready = (extra) => ({ state: "READY", alerts: [], impressions: 0, earning: 0, ...extra });

test("empat keadaan, dan urutannya adalah cascade-nya", () => {
  assert.deepEqual(ACCOUNT_STATUSES, ["Akun Close", "Limit Iklan", "Iklan Belum Tayang", "Ready"]);
});

test("akun yang ditutup Google berbunyi Akun Close, tanpa menunggu alert-nya", () => {
  // `alerts` sengaja tidak diberikan: akun tertutup tidak punya apa pun lagi untuk dibatasi, dan
  // menunggu daftar alert yang tidak akan pernah datang berarti akun paling gawat justru yang
  // statusnya tidak pernah terbaca.
  assert.deepEqual(accountStatusFrom({ state: "CLOSED" }), {
    status: "Akun Close",
    detail: "",
  });
});

test("alert pembatasan berbunyi Limit Iklan, dan keterangannya kalimat Google sendiri", () => {
  const out = accountStatusFrom(ready({ alerts: [UKRAINE, THROTTLED], impressions: 1200 }));
  assert.equal(out.status, "Limit Iklan");
  assert.equal(out.detail, THROTTLED.message);
});

test("pembatasan menang atas impresi yang masih mengalir", () => {
  // Akun yang dibatasi masih menayangkan sebagian iklannya. Dinilai dari impresi saja, ia berbunyi
  // "Ready" — dan pembatasan yang paling mahal justru yang paling tidak terlihat.
  assert.equal(
    accountStatusFrom(ready({ alerts: [THROTTLED], impressions: 999, earning: 500000 })).status,
    "Limit Iklan",
  );
});

test("notif merah yang BUKAN soal pembatasan tidak melabeli akun", () => {
  // Pajak dan pembayaran tertunda juga berdiri merah di dashboard AdSense. Disamakan, tiap akun
  // yang lupa mengisi formulir pajak berbunyi "Limit Iklan" — dan kolom ini berhenti dipercaya.
  const severeTax = { ...TAX, severity: "SEVERE", message: "Kirimkan informasi pajak Anda." };
  assert.equal(accountStatusFrom(ready({ alerts: [severeTax], impressions: 5 })).status, "Ready");
});

test("tipe alert yang berganti nama masih tertangkap lewat pesannya", () => {
  const renamed = { severity: "SEVERE", type: "policy-center-notice", message: THROTTLED.message };
  assert.equal(adLimitAlert([renamed])?.message, THROTTLED.message);
  assert.equal(accountStatusFrom(ready({ alerts: [renamed] })).status, "Limit Iklan");
});

test("nol impresi DAN nol pendapatan berarti Iklan Belum Tayang", () => {
  assert.deepEqual(accountStatusFrom(ready()), { status: "Iklan Belum Tayang", detail: "" });
});

test("pendapatan tanpa impresi tetap Ready — uang yang masuk adalah bukti iklan tayang", () => {
  // Network yang seluruh inventarisnya dilayani sumber permintaan lain mengembalikan nol impresi
  // untuk hari yang tetap menghasilkan. Dinilai dari impresi saja, ia berbunyi "Iklan Belum
  // Tayang" tepat di sebelah kolom Earning-nya sendiri yang berisi angka.
  assert.equal(accountStatusFrom(ready({ earning: 41250 })).status, "Ready");
});

test("yang tidak bisa dipastikan menjawab null, bukan menebak Ready", () => {
  // Tiap bentuk "belum diketahui" dijawab sama: nilai lama dibiarkan berdiri, dan sebabnya
  // ditulis di kolom sebelahnya. Sekali kegagalan API dibaca sebagai "Ready", yang dilihat orang
  // di kolom Status bukan lagi keadaan akun melainkan keadaan sync.
  assert.equal(accountStatusFrom({ alerts: [], impressions: 0, earning: 0 }), null);
  assert.equal(accountStatusFrom({ state: "STATE_UNSPECIFIED", alerts: [] }), null);
  assert.equal(accountStatusFrom({ state: "READY", impressions: 0, earning: 0 }), null);
  assert.equal(accountStatusFrom({ state: "READY", alerts: [], earning: 0 }), null);
  assert.equal(accountStatusFrom({ state: "READY", alerts: [], impressions: 0 }), null);
  assert.equal(accountStatusFrom(), null);
});

test("NEEDS_ATTENTION bukan keadaan kelima, dan tidak menghentikan tayangan", () => {
  assert.equal(
    accountStatusFrom({ state: "NEEDS_ATTENTION", alerts: [TAX], impressions: 12, earning: 0 })
      .status,
    "Ready",
  );
});

test("keterangan 'tidak bisa dicek' dipotong satu kalimat", () => {
  const google =
    "AdSense Management API has not been used in project 285277773008 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/adsense.googleapis.com/overview?project=285277773008 then retry.";
  assert.equal(
    statusCheckNote(new Error(google)),
    "Tidak bisa dicek: AdSense Management API has not been used in project 285277773008 before or it is disabled.",
  );
  assert.equal(statusCheckNote(""), "Tidak bisa dicek: sebabnya tidak disebutkan.");
});

// --- Status yang dipegang orang ------------------------------------------------------------

test("dipegang orang begitu kolom Status berbeda dari yang dibaca sync", () => {
  assert.equal(accountStatusPinned({ status: "Ready", statusAuto: "Limit Iklan" }), true);
  assert.equal(accountStatusPinned({ status: "Ready", statusAuto: "Ready" }), false);
});

test("tanpa pembanding tidak ada yang dipegang", () => {
  // Baris yang ditulis sebelum kolom `statusAuto` ada. Batas yang diketahui: suntingan yang dibuat
  // sebelum fitur ini di-deploy ditimpa SEKALI, dan sesudah itu barisnya punya pembandingnya.
  assert.equal(accountStatusPinned({ status: "Limit Iklan" }), false);
  assert.equal(accountStatusPinned({ statusAuto: "Ready" }), false);
  assert.equal(accountStatusPinned({}), false);
  assert.equal(accountStatusPinned(), false);
});

test("spasi tidak menjadikan dua nilai yang sama sebagai selisih", () => {
  assert.equal(accountStatusPinned({ status: " Ready ", statusAuto: "Ready" }), false);
});

test("yang tidak dipegang menerima ketiga kolomnya", () => {
  assert.deepEqual(
    accountStatusFields(
      { status: "Ready", statusAuto: "Ready", statusDetail: "Tidak bisa dicek: ..." },
      { status: "Limit Iklan", detail: "Jumlah iklan ... dibatasi" },
    ),
    {
      status: "Limit Iklan",
      statusAuto: "Limit Iklan",
      statusDetail: "Jumlah iklan ... dibatasi",
    },
  );
});

test("keterangan DIHAPUS, bukan ditulis kosong, begitu akunnya berhasil dicek", () => {
  const out = accountStatusFields(
    { status: "Ready", statusAuto: "Ready" },
    {
      status: "Ready",
      detail: "",
    },
  );
  assert.equal(out.statusDetail, null);
});

test("yang dipegang orang cuma menerima apa kata Google, bukan statusnya", () => {
  const account = { status: "Ready", statusAuto: "Limit Iklan", statusDetail: "Banding #123" };
  assert.deepEqual(accountStatusFields(account, { status: "Iklan Belum Tayang", detail: "" }), {
    statusAuto: "Iklan Belum Tayang",
  });
});

test("kuncinya lepas sendiri begitu Google menyebut hal yang sama", () => {
  const held = { status: "Ready", statusAuto: "Limit Iklan" };
  const after = { ...held, ...accountStatusFields(held, { status: "Ready", detail: "" }) };
  assert.equal(accountStatusPinned(after), false);
});

test("sebab kegagalan tidak menimpa keterangan yang ditulis orang", () => {
  assert.deepEqual(
    accountStatusNote({ status: "Ready", statusAuto: "Limit Iklan" }, new Error("403")),
    {},
  );
  assert.deepEqual(accountStatusNote({ status: "Ready", statusAuto: "Ready" }, new Error("403")), {
    statusDetail: "Tidak bisa dicek: 403",
  });
});
