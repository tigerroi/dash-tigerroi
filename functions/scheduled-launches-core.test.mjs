import assert from "node:assert/strict";
import test from "node:test";
import {
  launchAccountOf,
  launchAccounts,
  launchOwnerOf,
  scheduledLaunchRows,
  serverIndex,
  shiftedStartTime,
} from "./scheduled-launches-core.js";

const NOW = new Date("2026-09-17T05:00:00Z"); // 12:00 WIB
const ACCOUNT = { id: "acc1", actId: "act_1", name: "TBZ 1247", pic: "Godek" };

function set(overrides = {}) {
  return {
    id: "120001",
    name: "Adset #1",
    status: "ACTIVE",
    effectiveStatus: "ACTIVE",
    // Bentuk offset Meta apa adanya: tanpa titik dua.
    startTime: "2026-09-18T09:00:00+0700",
    campaignId: "900",
    campaign: "RNPX-02",
    campaignStatus: "ACTIVE",
    campaignStartTime: "2026-09-18T09:00:00+0700",
    ...overrides,
  };
}

test("launchAccounts melewati akun yang dihapus, dimatikan, atau tanpa actId", () => {
  const accounts = launchAccounts({
    a: { actId: "act_1", name: "TBZ", userOwner: "Godek" },
    b: { actId: "act_2", deletedAt: "2026-09-01" },
    c: { actId: "act_3", syncDisabled: "Nonaktif" },
    d: { name: "tanpa alamat" },
  });
  assert.deepEqual(accounts, [{ id: "a", actId: "act_1", name: "TBZ", pic: "Godek" }]);
});

test("hanya jadwal MASA DEPAN, dan jamnya jam operasi tanpa zona", () => {
  const rows = scheduledLaunchRows(
    ACCOUNT,
    [
      set(),
      set({ id: "120002", startTime: "2026-09-16T09:00:00+0700" }),
      set({ id: "120003", startTime: "" }),
      set({ id: "120004", startTime: "bukan tanggal" }),
    ],
    NOW,
    "Asia/Jakarta",
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].adSetId, "120001");
  assert.equal(rows[0].startWib, "2026-09-18T09:00");
  assert.equal(rows[0].startMs, Date.parse("2026-09-18T02:00:00Z"));
  assert.equal(rows[0].pic, "Godek");
  assert.equal(rows[0].id, "acc1__120001");
});

test("saklar ad set atau campaign yang mati tidak terhitung terjadwal", () => {
  const rows = scheduledLaunchRows(
    ACCOUNT,
    [set({ status: "PAUSED" }), set({ id: "2", campaignStatus: "PAUSED" })],
    NOW,
    "Asia/Jakarta",
  );
  assert.deepEqual(rows, []);
});

test("campaign baru dibedakan dari ad set yang menyusul di campaign yang sudah jalan", () => {
  const rows = scheduledLaunchRows(
    ACCOUNT,
    [
      set({ id: "1", startTime: "2026-09-19T10:00:00+0700" }),
      set({
        id: "2",
        startTime: "2026-09-18T20:00:00+0700",
        campaignStartTime: "2026-09-01T00:00:00+0700",
      }),
    ],
    NOW,
    "Asia/Jakarta",
  );
  // Urut menurut jam mulai.
  assert.deepEqual(
    rows.map((row) => [row.adSetId, row.campaignScheduled]),
    [
      ["2", false],
      ["1", true],
    ],
  );
});

test("launchAccountOf mencocokkan account_id Meta dengan atau tanpa awalan act_", () => {
  const accounts = [ACCOUNT, { ...ACCOUNT, id: "acc2", actId: "22" }];
  assert.equal(launchAccountOf(accounts, "1").id, "acc1");
  assert.equal(launchAccountOf(accounts, "act_22").id, "acc2");
  assert.equal(launchAccountOf(accounts, "999"), null);
  assert.equal(launchAccountOf(accounts, ""), null);
});

test("launchOwnerOf memakai aturan nama yang sama dengan sync, melewati yang diarsipkan", () => {
  const users = {
    u1: { name: "Godek", email: "g@x", deletedAt: "2026-01-01" },
    u2: { name: " godek ", email: "g2@x" },
  };
  assert.equal(launchOwnerOf(users, "GODEK").email, "g2@x");
  assert.equal(launchOwnerOf(users, ""), null);
  assert.equal(launchOwnerOf(users, "Aca"), null);
});

test("shiftedStartTime: jam baru WIB, menolak yang sudah tayang, lampau, dan melewati end_time", () => {
  const adSet = set({ endTime: "2026-09-20T00:00:00+0700" });
  assert.equal(shiftedStartTime(adSet, "2026-09-18T10:30", NOW), "2026-09-18T10:30:00+07:00");
  assert.throws(() => shiftedStartTime(set({ startTime: "2026-09-17T11:00:00+0700" }), "2026-09-18T10:30", NOW), /sudah tayang/);
  assert.throws(() => shiftedStartTime(adSet, "2026-09-17T11:00", NOW), /sudah lewat/);
  assert.throws(() => shiftedStartTime(adSet, "2026-09-20T01:00", NOW), /jam berakhir/);
  assert.throws(() => shiftedStartTime(adSet, "", NOW), /wajib/);
});

test("serverIndex: A langsung, CNAME diikuti, wildcard cadangan, yang tidak ada kosong", () => {
  const serverOf = serverIndex([
    { type: "A", name: "care.petcins.com", content: "94.130.38.76", proxied: true },
    { type: "CNAME", name: "www.petcins.com", content: "care.petcins.com" },
    { type: "A", name: "*.sheetz.us", content: "10.0.0.2" },
    { type: "CNAME", name: "ext.petcins.com", content: "host.lain.net" },
    { type: "TXT", name: "petcins.com", content: "v=spf1" },
  ]);
  assert.equal(serverOf("CARE.petcins.com."), "94.130.38.76");
  assert.equal(serverOf("www.petcins.com"), "94.130.38.76");
  assert.equal(serverOf("apa.sheetz.us"), "10.0.0.2");
  assert.equal(serverOf("ext.petcins.com"), "host.lain.net");
  assert.equal(serverOf("petcins.com"), "");
  assert.equal(serverOf(""), "");
});
