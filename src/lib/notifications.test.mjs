import assert from "node:assert/strict";
import test from "node:test";
import {
  contactAlertScope,
  groupComplaint,
  groupEntry,
  isGroupChat,
  NOTIFICATION_TOPICS,
  scopedAlerts,
  topicChoiceUpdate,
  topicRecipients,
  topicSettings,
  TOPIC_KEYS,
  userAlertScope,
} from "./notifications.js";

const user = (extra) => ({ id: "u1", name: "Aca", role: "user", telegramChatId: "111", ...extra });

test("topik yang dimatikan tidak punya penerima, seberapa pun banyak yang berlangganan", () => {
  const users = [user({ notificationTopics: { reminders: true } })];
  assert.equal(topicRecipients("reminders", { users }).length, 1);
  assert.equal(
    topicRecipients("reminders", { users, settings: { reminders: { enabled: false } } }).length,
    0,
  );
});

// Bawaannya NYALA — kebalikan dari ambang peringatan ROI. Bawaan mati akan menghentikan pengingat
// yang selama ini jalan, diam-diam, pada hari fitur ini di-deploy.
test("topik yang belum pernah diatur dianggap aktif", () => {
  assert.equal(topicSettings({}, "reminders").enabled, true);
  assert.deepEqual(topicSettings({}, "reminders").roles, []);
});

test("yang belum punya chat id dilewati, bukan dijadikan penerima tanpa alamat", () => {
  const users = [user({ telegramChatId: "", notificationTopics: { reminders: true } })];
  assert.deepEqual(topicRecipients("reminders", { users }), []);
});

// Mengarsipkan orang mencabut aksesnya ke dashboard; notifikasi yang tetap mengalir ke mantan
// anggota tim adalah bocoran yang tidak terlihat di layar mana pun.
test("baris yang sudah diarsipkan tidak ikut menerima", () => {
  const users = [user({ deletedAt: "2026-08-01", notificationTopics: { reminders: true } })];
  assert.deepEqual(topicRecipients("reminders", { users }), []);
});

test("siaran per role menjangkau yang belum pernah menyentuh saklarnya", () => {
  const users = [
    user({ id: "u1", role: "keuangan" }),
    user({ id: "u2", role: "advertiser", telegramChatId: "222" }),
  ];
  const settings = { reminders: { roles: "keuangan" } };

  assert.deepEqual(
    topicRecipients("reminders", { users, settings }).map((entry) => entry.chatId),
    ["111"],
  );
});

// Inti dari "admin memilih, orangnya juga boleh memilih": siaran per role tetap berarti semua orang
// di role itu, dan yang satu orang tetap bisa membisukan dirinya sendiri.
test("saklar `false` mengalahkan siaran per role", () => {
  const users = [user({ role: "keuangan", notificationTopics: { reminders: false } })];
  const settings = { reminders: { roles: "keuangan" } };

  assert.deepEqual(topicRecipients("reminders", { users, settings }), []);
});

test("saklar `true` menerima walau role-nya tidak disiarkan", () => {
  const users = [user({ role: "advertiser", notificationTopics: { syncIssues: true } })];
  assert.equal(topicRecipients("syncIssues", { users }).length, 1);
});

// Role tersimpan sebagai teks gabungan koma. `includes` telanjang pada teks itu akan menjawab benar
// untuk "superadmin" ketika yang dicari "admin".
test("role gabungan dibaca per bagian, bukan sebagai potongan teks", () => {
  const settings = { reminders: { roles: "admin" } };
  const superadmin = [user({ role: "superadmin" })];
  const multi = [user({ role: "user,admin" })];

  assert.deepEqual(topicRecipients("reminders", { users: superadmin, settings }), []);
  assert.equal(topicRecipients("reminders", { users: multi, settings }).length, 1);
});

test("grup ikut kalau saklar topiknya menyala, dan berhenti kalau dinonaktifkan", () => {
  const groups = [{ id: "g1", label: "Tim", chatId: "-100", topics: { reminders: true } }];
  assert.equal(topicRecipients("reminders", { groups }).length, 1);
  assert.deepEqual(
    topicRecipients("reminders", { groups: [{ ...groups[0], enabled: false }] }),
    [],
  );
  assert.deepEqual(topicRecipients("roiAlerts", { groups }), []);
});

// Satu pesan per chat. Orang yang ikut lewat role SEKALIGUS lewat saklarnya sendiri, dan grup yang
// kebetulan memakai chat id yang sama dengan seseorang, tetap menerima sekali.
test("chat id kembar hanya menerima satu kali", () => {
  const users = [user({ notificationTopics: { reminders: true } })];
  const groups = [{ id: "g1", label: "Kembar", chatId: "111", topics: { reminders: true } }];

  assert.equal(topicRecipients("reminders", { users, groups }).length, 1);
});

test("topicChoiceUpdate menyimpan `false` dan membuang topik yang sudah tidak ada", () => {
  const next = topicChoiceUpdate({ reminders: true, topikLama: true }, "roiAlerts", false);

  assert.deepEqual(next, { reminders: true, roiAlerts: false });
  assert.ok(!("topikLama" in next));
});

test("registry topik sama isinya dengan daftar kuncinya", () => {
  assert.deepEqual(
    NOTIFICATION_TOPICS.map((topic) => topic.key),
    TOPIC_KEYS,
  );
  assert.equal(new Set(TOPIC_KEYS).size, TOPIC_KEYS.length);
});

// "@namagrup" akan tersimpan rapi, tidak mengeluh di mana pun, dan gagal diam-diam tiap kali
// dikirimi — kegagalannya cuma ada di log Cloud Function yang tidak dibuka siapa pun.
test("chat id grup harus angka, dan tidak boleh kembar", () => {
  const ok = groupEntry({ label: "Tim", chatId: " -1002223334445 ", topics: { reminders: true } });

  assert.equal(ok.chatId, "-1002223334445");
  assert.equal(ok.topics.roiAlerts, false);
  assert.equal(groupComplaint(ok, []), "");
  assert.match(groupComplaint(groupEntry({ label: "Tim", chatId: "@tim" }), []), /angka/);
  assert.match(groupComplaint(groupEntry({ label: "", chatId: "-100" }), []), /Nama/);
  assert.match(
    groupComplaint(ok, [{ chatId: "-1002223334445" }]),
    /sudah terdaftar/,
  );
});

// --- Lingkup Peringatan ROI -------------------------------------------------------------------
//
// Satu-satunya topik yang disaring, dan alasannya bukan teknis: peringatan ROI berlaku untuk SATU
// subdomain, dan yang bisa menindaklanjutinya cuma orang yang memegangnya.

const alerts = [
  { id: "lowRoi__a", pic: "Aca", subDomain: "a.example.com" },
  { id: "lowRoi__b", pic: "Nur", subDomain: "b.example.com" },
  { id: "lowRoi__c", pic: "", subDomain: "c.example.com" },
];

test("admin menerima seluruh armada, PIC hanya subdomainnya sendiri", () => {
  assert.deepEqual(scopedAlerts(alerts, userAlertScope({ role: "admin", name: "Budi" })), alerts);
  assert.deepEqual(
    scopedAlerts(alerts, userAlertScope({ role: "superadmin", name: "Budi" })),
    alerts,
  );
  assert.deepEqual(
    scopedAlerts(alerts, userAlertScope({ role: "advertiser", name: "Aca" })).map((a) => a.id),
    ["lowRoi__a"],
  );
});

// `subDomains.pic` diketik orang dan bentuknya berbeda-beda menurut umur datanya — persis alasan
// `assignedSubDomains` mencocokkan longgar di kedua sisi.
test("nama dicocokkan tanpa peduli huruf besar/kecil dan spasi, dan username ikut dicoba", () => {
  assert.equal(scopedAlerts(alerts, userAlertScope({ role: "user", name: " aca " })).length, 1);
  assert.equal(
    scopedAlerts(alerts, userAlertScope({ role: "user", name: "", username: "Nur" })).length,
    1,
  );
});

// Yang bukan admin dan tidak memegang subdomain mana pun memang tidak menerima apa-apa — halaman
// suntingnya menyebutkan itu, supaya "saya tidak pernah dikirimi" punya jawabannya di layar.
test("yang tidak memegang subdomain apa pun tidak menerima baris mana pun", () => {
  assert.deepEqual(scopedAlerts(alerts, userAlertScope({ role: "user", name: "Entah" })), []);
  assert.deepEqual(scopedAlerts(alerts, userAlertScope({ role: "user" })), []);
});

// Baris tanpa PIC cuma sampai ke penerima berlingkup penuh: tidak ada yang mengklaimnya.
test("baris tanpa PIC tidak jatuh ke siapa pun kecuali yang berlingkup penuh", () => {
  assert.ok(scopedAlerts(alerts, { all: true }).some((row) => row.id === "lowRoi__c"));
  assert.ok(
    !scopedAlerts(alerts, userAlertScope({ role: "user", name: "Aca" })).some(
      (row) => row.id === "lowRoi__c",
    ),
  );
});

test("kontak non-tim menerima semuanya kecuali PIC-nya diisi", () => {
  assert.deepEqual(scopedAlerts(alerts, contactAlertScope({ label: "Grup Tim" })), alerts);
  assert.deepEqual(
    scopedAlerts(alerts, contactAlertScope({ label: "Muhajir", pic: "Nur" })).map((a) => a.id),
    ["lowRoi__b"],
  );
});

// Lingkup yang tidak diketahui dibaca sebagai "semua": penerima yang bentuk barisnya belum
// terhitung lebih baik menerima kelebihan daripada diam-diam berhenti menerima.
test("lingkup yang tidak diketahui tidak menyaring apa pun", () => {
  assert.deepEqual(scopedAlerts(alerts, undefined), alerts);
  assert.deepEqual(scopedAlerts(alerts, {}), alerts);
});

test("penerima membawa lingkupnya sendiri, dan grup dikenali dari tanda id-nya", () => {
  const users = [
    { id: "u1", name: "Aca", role: "user", telegramChatId: "111", notificationTopics: { roiAlerts: true } },
  ];
  const groups = [{ id: "g1", label: "Tim", chatId: "-100", topics: { roiAlerts: true } }];
  const recipients = topicRecipients("roiAlerts", { users, groups });

  assert.deepEqual(recipients.find((r) => r.chatId === "111").scope.picKeys, ["aca"]);
  assert.equal(recipients.find((r) => r.chatId === "-100").scope.all, true);
  assert.equal(isGroupChat("-100"), true);
  assert.equal(isGroupChat("6374611345"), false);
});
