import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  contactAlertScope,
  issueCause,
  NOTIFICATION_TOPICS,
  noticesToSend,
  noticeUpdate,
  notifiableAlerts,
  recoveredNotices,
  rowsOf,
  syncIssueAlerts,
  syncIssueMessage,
  syncIssueSummary,
  syncRecoveryMessage,
  scopedAlerts,
  topicRecipients,
  topicSettings,
  userAlertScope,
} from "./notifications-core.js";

const user = (extra) => ({ id: "u1", name: "Aca", role: "user", telegramChatId: "111", ...extra });

/**
 * CERMINAN, dan inilah tes yang paling menentukan di berkas ini.
 *
 * Aturan penerima ditulis dua kali — di sini (yang mengirim) dan di src/lib/notifications.js (yang
 * menghitung kolom "Penerima" di layar). Beda sedikit, halaman menjanjikan orang yang tidak pernah
 * dikirimi apa pun, dan tidak ada yang akan tahu sampai seseorang bertanya kenapa ia tidak menerima
 * apa-apa. Kunci topik adalah bagian yang paling mahal kalau meleset: kunci itulah yang tersimpan di
 * `users/{id}/notificationTopics`, jadi satu salah ketik berarti saklar yang ditekan orang tidak
 * pernah dibaca pengirim mana pun.
 */
test("daftar topik sama persis dengan yang di src/lib/notifications.js", () => {
  const source = readFileSync(new URL("../src/lib/notifications.js", import.meta.url), "utf8");
  const keys = [...source.matchAll(/^\s{4}key: "([a-zA-Z]+)",$/gm)].map((match) => match[1]);

  assert.deepEqual(
    NOTIFICATION_TOPICS.map((topic) => topic.key),
    keys,
  );
});

test("saklar orang mengalahkan siaran per role, dua arah", () => {
  const settings = { reminders: { roles: "keuangan" } };

  assert.deepEqual(topicRecipients("reminders", { users: [user({ role: "keuangan" })], settings }).map((e) => e.chatId), ["111"]);
  assert.deepEqual(
    topicRecipients("reminders", {
      users: [user({ role: "keuangan", notificationTopics: { reminders: false } })],
      settings,
    }),
    [],
  );
  assert.equal(
    topicRecipients("reminders", {
      users: [user({ role: "advertiser", notificationTopics: { reminders: true } })],
    }).length,
    1,
  );
});

test("topik yang dimatikan, chat id kosong, dan baris terarsip tidak menghasilkan penerima", () => {
  assert.deepEqual(
    topicRecipients("reminders", {
      users: [user({ notificationTopics: { reminders: true } })],
      settings: { reminders: { enabled: false } },
    }),
    [],
  );
  assert.deepEqual(
    topicRecipients("reminders", {
      users: [user({ telegramChatId: null, notificationTopics: { reminders: true } })],
    }),
    [],
  );
  assert.deepEqual(
    topicRecipients("reminders", {
      users: [user({ deletedAt: "2026-08-01", notificationTopics: { reminders: true } })],
    }),
    [],
  );
  assert.equal(topicSettings({}, "reminders").enabled, true);
});

test("grup dan orang dedupe per chat id", () => {
  const users = [user({ notificationTopics: { roiAlerts: true } })];
  const groups = [{ id: "g1", label: "Tim", chatId: "111", topics: { roiAlerts: true } }];

  assert.equal(topicRecipients("roiAlerts", { users, groups }).length, 1);
});

test("rowsOf membawa id-nya, dan node kosong jadi daftar kosong", () => {
  assert.deepEqual(rowsOf({ a: { name: "x" } }), [{ name: "x", id: "a" }]);
  assert.deepEqual(rowsOf(null), []);
});

// --- Kegagalan sync ---

const issues = {
  gamAccounts: {
    label: "GAM",
    count: 1,
    items: { i0: { source: "GAM", target: "Massequality", message: "500", impact: "earning 6 subdomain kosong" } },
  },
  plugin: { label: "Plugin", count: 0, items: {} },
};

test("isu dari seluruh cabang jadi satu daftar, berkunci cabang + target", () => {
  const alerts = syncIssueAlerts(issues);

  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].id, "gamAccounts__Massequality");
  assert.equal(alerts[0].label, "GAM");
});

// Satu network yang gagal dengan tiga pesan error berbeda dalam sehari adalah SATU kegagalan bagi
// orang yang harus memperbaikinya.
test("pesan error yang berubah tidak menghasilkan penanda baru", () => {
  const pertama = syncIssueAlerts(issues)[0];
  const kedua = syncIssueAlerts({
    ...issues,
    gamAccounts: {
      ...issues.gamAccounts,
      items: { i0: { ...issues.gamAccounts.items.i0, message: "timeout" } },
    },
  })[0];

  assert.equal(pertama.id, kedua.id);
});

test("yang sudah dikabarkan hari ini tidak dikirim lagi", () => {
  const alerts = syncIssueAlerts(issues);
  const notices = { gamAccounts__Massequality: "2026-08-26" };

  assert.deepEqual(noticesToSend(alerts, notices, "2026-08-26"), []);
  assert.equal(noticesToSend(alerts, notices, "2026-08-27").length, 1);
});

// Tanpa penyapuan, node ini tumbuh mengikuti jumlah akun yang pernah gagal — dan akun yang gagal
// lagi dua minggu kemudian membawa penanda basi yang membuatnya terlihat "sudah dikabarkan".
test("penanda milik isu yang sudah pulih dihapus", () => {
  const update = noticeUpdate(
    syncIssueAlerts(issues),
    [],
    { sudahPulih: "2026-08-20" },
    "2026-08-26",
  );

  assert.equal(update.gamAccounts__Massequality.day, "2026-08-26");
  assert.equal(update.gamAccounts__Massequality.state, "failed");
  assert.equal(update.sudahPulih, null);
});

// Hari deploy, seluruh penanda di node ini masih berbentuk teks tanggal. Dibaca sebagai "belum
// pernah dikabarkan", pagi itu chat menerima ulang tiap kegagalan yang sudah dikabarkan sejam lalu.
test("penanda lama berbentuk teks tetap dibaca sebagai sudah dikabarkan", () => {
  const alerts = syncIssueAlerts(issues);

  assert.deepEqual(noticesToSend(alerts, { gamAccounts__Massequality: "2026-08-26" }, "2026-08-26"), []);
});

// --- Asal masalah -------------------------------------------------------------------------------
//
// Yang membaca chat ini memutuskan satu hal: perlu dikerjakan sekarang atau tidak. Dua golongan
// pertama menuntut tindakan yang berlawanan, jadi salah menggolongkan lebih buruk daripada tidak
// menggolongkan sama sekali — itu sebabnya ada golongan ketiga.
test("izin dan token digolongkan sebagai sisi kita", () => {
  for (const message of [
    "GAM POST /v1/networks/2094/reports:run -> 401: Invalid Credentials",
    "Meta /act_1247 -> Permissions error (#200)",
    "VI_CONTROL_API_KEY belum di-set.",
    "AdSense GET /v2/accounts -> 403: insufficient authentication scopes",
  ]) {
    assert.equal(issueCause(message).key, "action", message);
  }
});

test("5xx, timeout, dan hosting tumbang digolongkan sebagai sisi penyedia", () => {
  for (const message of [
    "GAM POST /v1/networks/2094/reports:run -> 503: The service is currently unavailable.",
    "GAM report timed out",
    "vi-control tidak bisa dihubungi: fetch failed",
    "Error establishing a database connection",
    "balasan non-JSON (HTTP 502): <html>Bad Gateway</html>",
  ]) {
    assert.equal(issueCause(message).key, "provider", message);
  }
});

// Menebak "ini sisi mereka" untuk pesan yang tidak dikenali membuat orang MENUNGGU sesuatu yang
// tidak akan pernah pulih sendiri — sepola dengan earning yang tidak diketahui, yang juga tidak
// dibulatkan ke tebakan terdekat.
test("yang tidak dikenali tidak ditebak", () => {
  const cause = issueCause("Sesuatu yang aneh terjadi di baris 12");

  assert.equal(cause.key, "unknown");
  assert.equal(cause.say, "");
});

// `act_5031` dan `networks/4030` juga tiga digit. Salah bacanya bukan pesan yang aneh, melainkan
// pesan yang percaya diri menyebut golongan yang salah.
test("angka tiga digit di dalam ID bukan status HTTP", () => {
  assert.equal(issueCause("Meta act_5031 gagal dibaca").key, "unknown");
});

test("pesan gagal mengelompokkan per asal masalah", () => {
  const text = syncIssueMessage(
    syncIssueAlerts({
      gamAccounts: {
        label: "Akun GAM",
        items: { i0: { target: "Detik", message: "GAM -> 401: Invalid Credentials" } },
      },
      plugin: {
        label: "Plugin situs",
        items: { i0: { target: "a.example.com", message: "GET -> 503: unavailable" } },
      },
    }),
    "",
  );

  assert.ok(text.includes("PERLU DIPERIKSA ORANG"));
  assert.ok(text.includes("GANGGUAN DI SISI PENYEDIA"));
  // Yang menuntut tindakan berdiri lebih dulu: penerima yang berhenti membaca di layar pertama
  // harus sudah melewati bagian yang tidak akan pulih sendiri.
  assert.ok(text.indexOf("PERLU DIPERIKSA ORANG") < text.indexOf("GANGGUAN DI SISI PENYEDIA"));
});

// Satu hosting yang menjatuhkan tiga puluh situs sekaligus melewati batas 4096 karakter Telegram,
// dan yang hilang bukan baris yang kelebihan melainkan seluruh notifikasinya.
test("kelompok yang kepanjangan diringkas, bukan dibiarkan menjatuhkan pesannya", () => {
  const items = {};
  for (let i = 0; i < 12; i++) {
    items[`i${i}`] = { target: `situs${String(i).padStart(2, "0")}.example.com`, message: "GET -> 503: unavailable" };
  }
  const text = syncIssueMessage(syncIssueAlerts({ plugin: { label: "Plugin", items } }), "");

  assert.ok(text.includes("+6 lainnya"));
  assert.ok(!text.includes("situs11.example.com"));
  assert.ok(text.includes("situs00.example.com"));
});

// --- Sync pulih ---------------------------------------------------------------------------------

test("yang pernah dikabarkan gagal dan sekarang bersih dihitung pulih", () => {
  const notices = {
    gamAccounts__Massequality: { day: "2026-08-26", state: "failed", label: "GAM", target: "Massequality" },
  };
  const pulih = recoveredNotices([], notices, "2026-08-26");

  assert.equal(pulih.length, 1);
  assert.equal(pulih[0].target, "Massequality");
});

// Pemulihan atas sesuatu yang tidak pernah diberitahukan bukan kabar baik, cuma pesan tambahan.
test("yang tidak pernah dikabarkan tidak dikabarkan pulih", () => {
  assert.deepEqual(recoveredNotices([], {}, "2026-08-26"), []);
  assert.deepEqual(
    recoveredNotices([], { x: { day: "2026-08-25", state: "failed" } }, "2026-08-26"),
    [],
  );
});

test("yang masih gagal tidak dikabarkan pulih", () => {
  const notices = { gamAccounts__Massequality: { day: "2026-08-26", state: "failed" } };

  assert.deepEqual(recoveredNotices(syncIssueAlerts(issues), notices, "2026-08-26"), []);
});

// Batasnya dua pesan per target per hari: satu gagal, satu pulih. Akun yang berkedip tiap jam kalau
// tidak akan mengirim dua puluh empat pesan dalam sehari.
test("yang sudah dikabarkan pulih tidak dikabarkan gagal lagi hari itu", () => {
  const marks = noticeUpdate(
    [],
    [{ id: "gamAccounts__Massequality", label: "GAM", target: "Massequality" }],
    { gamAccounts__Massequality: { day: "2026-08-26", state: "failed" } },
    "2026-08-26",
  );

  assert.equal(marks.gamAccounts__Massequality.state, "recovered");
  assert.deepEqual(noticesToSend(syncIssueAlerts(issues), marks, "2026-08-26"), []);
  // Besoknya penandanya disapu, dan kegagalan yang bertahan kembali dikabarkan.
  assert.equal(noticesToSend(syncIssueAlerts(issues), marks, "2026-08-27").length, 1);
});

// Pesan hijau yang datang sejam setelah pesan merah terbaca sebagai "semuanya sudah beres" — dan
// yang paling mudah luput justru kegagalan yang masih tersisa.
test("pesan pulih menyebutkan yang masih gagal", () => {
  const pulih = [{ id: "plugin__a", label: "Plugin", target: "a.example.com" }];

  assert.ok(syncRecoveryMessage(pulih, 2, "").includes("Masih ada 2 bagian"));
  assert.ok(!syncRecoveryMessage(pulih, 0, "").includes("Masih ada"));
});

test("pesan memuat akibatnya dan meng-escape balasan HTML dari situs yang tumbang", () => {
  const text = syncIssueMessage(
    syncIssueAlerts({
      plugin: {
        label: "Plugin",
        items: { i0: { target: "a.example.com", message: "<html>502</html>", impact: "versi tidak terbaca" } },
      },
    }),
    "https://contoh.web.app/settings?tab=logs",
  );

  assert.ok(text.includes("&lt;html&gt;502&lt;/html&gt;"));
  assert.ok(text.includes("Akibat: versi tidak terbaca"));
  assert.ok(!/<html>/.test(text));
});

test("ringkasan menyebut penerima yang kosong sebagai sebabnya sendiri", () => {
  assert.match(syncIssueSummary([], 0, 0), /tidak ada kegagalan baru/);
  assert.match(syncIssueSummary([{}], 0, 0), /belum|tidak ada penerima/);
  assert.equal(syncIssueSummary([{}, {}], 1, 2), "2 kegagalan ke 1/2 chat");
  assert.equal(syncIssueSummary([], 0, 0, 3), "tidak ada kegagalan baru, 3 pulih");
});

// Tanpa angka ini, run yang menemukan enam hosting tumbang menulis kalimat yang persis sama dengan
// run yang tidak menemukan apa-apa — dan satu-satunya jejak bahwa penyaringan ini bekerja hilang.
test("ringkasan menyebut gangguan penyedia yang tidak jadi dikirimkan", () => {
  assert.equal(
    syncIssueSummary([], 0, 0, 0, 6),
    "tidak ada kegagalan baru, 6 gangguan penyedia tidak dikabarkan",
  );
  assert.match(syncIssueSummary([{}, {}], 2, 2, 0, 1), /2 kegagalan ke 2\/2 chat, 1 gangguan/);
});

// --- Yang tidak berangkat ke Telegram -----------------------------------------------------------
//
// Retry sudah mengurus golongan `provider` sendiri (1→5 menit, maks 5×), dan sebagian besar 5xx
// pulih di percobaan kedua. Yang tersisa dari notifikasinya cuma pesan merah untuk sesuatu yang
// tidak boleh dikerjakan siapa pun, disusul pesan hijau yang mencabutnya.

test("gangguan sisi penyedia tidak ikut dikirimkan", () => {
  const alerts = syncIssueAlerts({
    gamAccounts: {
      label: "Akun GAM",
      items: { i0: { target: "Detik", message: "GAM -> 401: Invalid Credentials" } },
    },
    plugin: {
      label: "Plugin situs",
      items: {
        i0: { target: "a.example.com", message: "GET -> 503: unavailable" },
        i1: { target: "b.example.com", message: "Error establishing a database connection" },
      },
    },
  });

  const keluar = notifiableAlerts(alerts);

  assert.equal(alerts.length, 3);
  assert.deepEqual(
    keluar.map((alert) => alert.target),
    ["Detik"],
  );
});

// Menebak yang tidak dikenali sebagai sisi penyedia lalu membisukannya adalah persis cara sebuah
// kegagalan yang perlu orang lewat tanpa pernah dilihat siapa pun — sepola dengan `earningKnown`.
test("yang belum bisa dipastikan tetap dikirimkan", () => {
  const alerts = syncIssueAlerts({
    gamAccounts: {
      label: "Akun GAM",
      items: { i0: { target: "Detik", message: "Sesuatu yang aneh terjadi di baris 12" } },
    },
  });

  assert.equal(notifiableAlerts(alerts).length, 1);
});

// Yang disaring cuma jalan keluarnya ke Telegram. Isu golongan penyedia yang lolos ke sini tetap
// dikelompokkan seperti biasa — penyaringnya berdiri di pemanggil, bukan di penyusun pesan.
test("penyaringan tidak menyentuh daftar isu maupun penyusun pesannya", () => {
  const alerts = syncIssueAlerts({
    plugin: { label: "Plugin", items: { i0: { target: "a.example.com", message: "-> 503" } } },
  });

  assert.equal(alerts.length, 1);
  assert.ok(syncIssueMessage(alerts, "").includes("GANGGUAN DI SISI PENYEDIA"));
});

// Isu yang tadi pagi gagal dengan 401 lalu sore ini gagal dengan 503 MASIH gagal. Kabar "pulih"
// untuknya adalah kabar baik yang tidak benar — karena itu `recoveredNotices` dibacakan daftar
// PENUH, bukan hasil `notifiableAlerts`.
test("golongan yang berpindah ke sisi penyedia tidak terbaca sebagai pulih", () => {
  const alerts = syncIssueAlerts({
    gamAccounts: {
      label: "Akun GAM",
      items: { i0: { target: "Massequality", message: "GAM -> 503: unavailable" } },
    },
  });
  const notices = { gamAccounts__Massequality: { day: "2026-08-26", state: "failed" } };

  assert.deepEqual(recoveredNotices(alerts, notices, "2026-08-26"), []);
  // Dibacakan hasil saringan, ia akan berbunyi "pulih" — itulah jebakan yang dijaga tes ini.
  assert.equal(recoveredNotices(notifiableAlerts(alerts), notices, "2026-08-26").length, 1);
});

// --- Lingkup Peringatan ROI -------------------------------------------------------------------
//
// CERMINAN `userAlertScope`/`contactAlertScope`/`scopedAlerts` di src/lib/notifications.js. Beda
// sedikit, halaman menggambar lingkup yang berbeda dari yang benar-benar dikirim — dan seorang
// advertiser yang di layar "menerima 3 subdomain" tapi chatnya sepi tidak punya cara tahu yang mana
// yang bohong.
const roiAlerts = [
  { id: "lowRoi__a", pic: "Aca" },
  { id: "lowRoi__b", pic: "Nur" },
  { id: "lowRoi__c", pic: "" },
];

test("admin menerima semuanya, PIC hanya barisnya sendiri, yang tanpa PIC hanya ke lingkup penuh", () => {
  assert.deepEqual(scopedAlerts(roiAlerts, userAlertScope({ role: "admin" })), roiAlerts);
  assert.deepEqual(
    scopedAlerts(roiAlerts, userAlertScope({ role: "advertiser", name: "aca" })).map((a) => a.id),
    ["lowRoi__a"],
  );
  assert.deepEqual(scopedAlerts(roiAlerts, userAlertScope({ role: "user", name: "Entah" })), []);
});

test("kontak non-tim menerima semuanya kecuali PIC-nya diisi", () => {
  assert.deepEqual(scopedAlerts(roiAlerts, contactAlertScope({})), roiAlerts);
  assert.deepEqual(
    scopedAlerts(roiAlerts, contactAlertScope({ pic: "Nur" })).map((a) => a.id),
    ["lowRoi__b"],
  );
});

// "user,admin" harus terbaca sebagai admin; "superadmin" TIDAK boleh terbaca sebagai "admin" lewat
// pencocokan potongan teks.
test("role gabungan menentukan lingkup penuh per bagian, bukan per potongan teks", () => {
  assert.equal(userAlertScope({ role: "user,admin" }).all, true);
  assert.equal(userAlertScope({ role: "superadmin" }).all, true);
  assert.equal(userAlertScope({ role: "administrasi", name: "Aca" }).all, false);
});

test("penerima membawa lingkupnya, dan itu yang dipakai pengirim", () => {
  const users = [
    { id: "u1", name: "Aca", role: "user", telegramChatId: "111", notificationTopics: { roiAlerts: true } },
    { id: "u2", name: "Budi", role: "admin", telegramChatId: "222", notificationTopics: { roiAlerts: true } },
  ];
  const recipients = topicRecipients("roiAlerts", { users });
  const rowsFor = (chatId) =>
    scopedAlerts(roiAlerts, recipients.find((entry) => entry.chatId === chatId).scope).map(
      (row) => row.id,
    );

  assert.deepEqual(rowsFor("111"), ["lowRoi__a"]);
  assert.deepEqual(rowsFor("222"), ["lowRoi__a", "lowRoi__b", "lowRoi__c"]);
});
